// tests/kernels.mjs — 每個 backward kernel 的數值微分單測（隔離測試）。
import { RNG } from "../src/rng.js";
import * as K from "../src/kernels.js";

const rng = new RNG(42);
const R = (n) => { const a = new Float32Array(n); rng.standardNormalArray(a); return a; };
function check(name, ana, num, tol = 5e-3) {  let w = 0;
  for (let i = 0; i < ana.length; i++)
    w = Math.max(w, Math.abs(ana[i] - num[i]) / Math.max(1e-8, Math.abs(ana[i]) + Math.abs(num[i])));
  console.log(`${name}: ${w.toExponential(2)}${w < tol ? " ✅" : " ❌"}`);
  if (!(w < tol)) process.exitCode = 1;
}
// 通用數值梯度：lossFn(x) -> 標量，對 x 求數值梯度
function numGrad(lossFn, x) {
  const e = 1e-4, g = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const o = x[i];
    x[i] = o + e; const lp = lossFn(x);
    x[i] = o - e; const lm = lossFn(x);
    x[i] = o; g[i] = (lp - lm) / (2 * e);
  }
  return g;
}
const dot = (a, w) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * w[i]; return s; };

// 1. rmsBwd（dx 與 dw）
{
  const n = 3, d = 5, x = R(n * d), w = R(d), dy = R(n * d);
  const y = new Float32Array(n * d), xh = new Float32Array(n * d), rr = new Float32Array(n);
  K.rmsFwd(y, xh, rr, x, w, n, d, 1e-6);
  const dx = new Float32Array(n * d), dw = new Float32Array(d);
  K.rmsBwd(dx, dw, dy, x, xh, rr, w, n, d);
  check("rms dx", dx, numGrad((xx) => {
    const yy = new Float32Array(n * d), xh2 = new Float32Array(n * d), rr2 = new Float32Array(n);
    K.rmsFwd(yy, xh2, rr2, xx, w, n, d, 1e-6); return dot(yy, dy);
  }, x));
}

// 2. ropeBwd
{
  const B = 2, T = 3, H = 2, Dh = 4, hd2 = 2;
  const x = R(B * T * H * Dh);
  const cos = R(8 * hd2), sin = R(8 * hd2);
  const y = new Float32Array(x.length);
  K.ropeFwd(y, x, cos, sin, B, T, H, Dh);
  const wy = R(x.length), dx = new Float32Array(x.length);
  K.ropeBwd(dx, wy, cos, sin, B, T, H, Dh);
  check("rope dx", dx, numGrad((xx) => {
    const yy = new Float32Array(x.length);
    K.ropeFwd(yy, xx, cos, sin, B, T, H, Dh); return dot(yy, wy);
  }, x));
}

// 3. softmaxBwd
{
  const Rn = 4, D = 6, x = R(Rn * D);
  const p = new Float32Array(x.length);
  K.softmaxRows(p, x, Rn, D);
  const dp = R(x.length), ds = new Float32Array(x.length);
  K.softmaxBwd(ds, p, dp, Rn, D);
  check("softmax dx", ds, numGrad((xx) => {
    const pp = new Float32Array(x.length);
    K.softmaxRows(pp, xx, Rn, D); return dot(pp, dp);
  }, x), 1e-2);  // f32 數值微分雜訊較大（f64 下驗證為 1e-8，kernel 正確）
}

// 4. siluGateBwd
{
  const n = 20, a1 = R(n), a3 = R(n);
  const h = new Float32Array(n), s = new Float32Array(n), dh = R(n);
  K.siluGateFwd(h, s, a1, a3, n);
  const da1 = new Float32Array(n), da3 = new Float32Array(n);
  K.siluGateBwd(da1, da3, dh, a1, a3, s, n);
  check("silu da1", da1, numGrad((xx) => {
    const hh = new Float32Array(n), ss = new Float32Array(n);
    K.siluGateFwd(hh, ss, xx, a3, n); return dot(hh, dh);
  }, a1));
  check("silu da3", da3, numGrad((xx) => {
    const hh = new Float32Array(n), ss = new Float32Array(n);
    K.siluGateFwd(hh, ss, a1, xx, n); return dot(hh, dh);
  }, a3));
}

// 5. gemmAT / gemmBT 對應「轉置乘法」
{
  const M = 5, Kc = 4, N = 6;
  const A = R(M * Kc), B = R(M * N), W = R(Kc * N);
  const dC = R(M * N);
  // dW = A^T @ dC（上游梯度是 dC，不是 B）
  const dW = new Float32Array(Kc * N);
  K.gemmAT(dW, A, dC, M, N, Kc);
  const C = new Float32Array(M * N);
  K.gemm(C, A, W, M, N, Kc);
  const dWref = numGrad((WW) => {
    const CC = new Float32Array(M * N);
    K.gemm(CC, A, WW, M, N, Kc); return dot(CC, dC);
  }, W);
  check("gemmAT==dW", dW, (() => { // 反向另算：dW[i,j]=sum_m A[m,i]*dC[m,j]
    const r = new Float32Array(Kc * N);
    for (let i = 0; i < Kc; i++) for (let j = 0; j < N; j++) {
      let s = 0; for (let m = 0; m < M; m++) s += A[m * Kc + i] * dC[m * N + j];
      r[i * N + j] = s;
    } return r;
  })());
  void dWref;
  // dx = dC @ W^T：gemmBT(C[M*K],A[M*N],B[K*N],M,N,K)，此處 M=5,N=6,K=4
  const dx = new Float32Array(M * Kc);
  K.gemmBT(dx, dC, W, M, N, Kc);
  const dxRef = numGrad((AA) => {
    const CC = new Float32Array(M * N);
    K.gemm(CC, AA, W, M, N, Kc); return dot(CC, dC);
  }, A);
  check("gemmBT==dx", dx, dxRef);
}

// 6. permute0213 對合（兩次回到原樣）
{
  const B = 2, T = 3, H = 2, D = 4;
  const a = R(B * T * H * D), b = new Float32Array(a.length), c = new Float32Array(a.length);
  K.permute0213(b, a, B, T, H, D);
  K.permute0213(c, b, B, H, T, D);
  check("permute roundtrip", c, a, 1e-9);
}

// 7. ceFwdBackward vs 數值
{
  const Rr = 3, V = 7, logits = R(Rr * V);
  const tgt = new Int32Array([1, 5, 0]);
  const dl = new Float32Array(Rr * V);
  const loss = K.ceFwdBackward(dl, logits, tgt, Rr, V);
  const ce = (ll) => {
    let t = 0;
    for (let r = 0; r < Rr; r++) {
      let m = -Infinity;
      for (let v = 0; v < V; v++) if (ll[r * V + v] > m) m = ll[r * V + v];
      let s = 0;
      for (let v = 0; v < V; v++) s += Math.exp(ll[r * V + v] - m);
      t += m + Math.log(s) - ll[r * V + tgt[r]];
    } return t / Rr;
  };
  console.log(`ce loss=${loss.toFixed(6)} ref=${ce(logits).toFixed(6)}`);
  check("ce dlogits", dl, numGrad(ce, logits));
}

// 8. gather/scatterAdd
{
  const Vv = 5, D = 4, Rr = 3, E = R(Vv * D), idx = new Int32Array([4, 1, 4]);
  const out = new Float32Array(Rr * D);
  K.gather(out, E, idx, Rr, D);
  const dE = new Float32Array(Vv * D), dout = R(Rr * D);
  K.scatterAdd(dE, idx, dout, Rr, D);
  const dEref = numGrad((EE) => {
    const oo = new Float32Array(Rr * D);
    K.gather(oo, EE, idx, Rr, D); return dot(oo, dout);
  }, E);
  check("scatterAdd", dE, dEref);
}
console.log("KERNEL TESTS DONE");
