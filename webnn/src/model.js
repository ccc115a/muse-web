// model.js — mini Transformer（RMSNorm + RoPE + SwiGLU + tied embedding），
// 與 mini_llm_numpy 同架構。显式 reverse-mode：forward 存 cache，backward 逐層回傳。
import { Tensor } from "./tensor.js";
import * as K from "./kernels.js";

export function initParams(rng, vocab, d, nLayers) {
  const P = {};
  const init = (fin, fout) => {
    const t = new Tensor(new Float32Array(fin * fout), [fin, fout]);
    rng.standardNormalArray(t.d);
    const s = 1 / Math.sqrt(fin);
    for (let i = 0; i < t.d.length; i++) t.d[i] *= s;
    return t;
  };
  const ones = () => new Tensor(new Float32Array(d).fill(1), [d]);
  P.emb = init(vocab, d);
  P.n_out = ones();
  for (let l = 0; l < nLayers; l++) {
    P[`b${l}q`] = init(d, d); P[`b${l}k`] = init(d, d);
    P[`b${l}v`] = init(d, d); P[`b${l}o`] = init(d, d);
    P[`b${l}1`] = init(d, 4 * d); P[`b${l}3`] = init(d, 4 * d);
    P[`b${l}2`] = init(4 * d, d);
    P[`b${l}n1`] = ones(); P[`b${l}n2`] = ones();
  }
  return P;
}

export function buildRope(headDim, end, theta = 10000.0) {
  const hd2 = headDim >> 1;
  const cos = new Float32Array(end * hd2), sin = new Float32Array(end * hd2);
  for (let t = 0; t < end; t++)
    for (let i = 0; i < hd2; i++) {
      const a = t / Math.pow(theta, (2 * i) / headDim);
      cos[t * hd2 + i] = Math.cos(a);
      sin[t * hd2 + i] = Math.sin(a);
    }
  return { cos, sin };
}

// idx: Int32Array(B*T)。回傳 {logits: Tensor(R,V), cache}
export function forward(P, idx, rope, cfg) {
  const { d, heads: nh, layers: L } = cfg;
  const B = idx.length / cfg.seq, T = cfg.seq, R = B * T, hd = d / nh;
  const { cos, sin } = rope;
  const x = new Tensor(new Float32Array(R * d), [R, d]);
  K.gather(x.d, P.emb.d, idx, R, d);
  const caches = [];
  let cur = x;
  for (let l = 0; l < L; l++) {
    const W = { q: P[`b${l}q`].d, k: P[`b${l}k`].d, v: P[`b${l}v`].d, o: P[`b${l}o`].d };
    // attn block
    const h1 = Tensor.empty(R, d), xh1 = Tensor.empty(R, d), r1 = new Float32Array(R);
    K.rmsFwd(h1.d, xh1.d, r1, cur.d, P[`b${l}n1`].d, R, d, 1e-6);
    const q = Tensor.empty(R, d), k = Tensor.empty(R, d), v = Tensor.empty(R, d);
    K.gemm(q.d, h1.d, W.q, R, d, d);
    K.gemm(k.d, h1.d, W.k, R, d, d);
    K.gemm(v.d, h1.d, W.v, R, d, d);
    const qr = Tensor.empty(B, T, nh, hd), kr = Tensor.empty(B, T, nh, hd);
    K.ropeFwd(qr.d, q.d, cos, sin, B, T, nh, hd);
    K.ropeFwd(kr.d, k.d, cos, sin, B, T, nh, hd);
    const qt = Tensor.empty(B, nh, T, hd), kt = Tensor.empty(B, nh, T, hd),
          vt = Tensor.empty(B, nh, T, hd);
    K.permute0213(qt.d, qr.d, B, T, nh, hd);
    K.permute0213(kt.d, kr.d, B, T, nh, hd);
    K.permute0213(vt.d, v.d, B, T, nh, hd);
    const BH = B * nh;
    const scores = Tensor.empty(BH, T, T), prob = Tensor.empty(BH, T, T),
          attOut = Tensor.empty(BH, T, hd);
    K.bmmBT(scores.d, qt.d, kt.d, BH, T, T, hd, T * T, T * hd, T * hd);
    const inv = 1 / Math.sqrt(hd);
    for (let i = 0; i < scores.d.length; i++) scores.d[i] *= inv;
    K.addCausalMask(scores.d, BH, T);
    K.softmaxRows(prob.d, scores.d, BH * T, T);
    K.bmm(attOut.d, prob.d, vt.d, BH, T, hd, T, T * hd, T * T, T * hd);
    const oBack = Tensor.empty(B, T, nh, hd);   // (B,H,T,D) 轉回 (B,T,H,D)
    K.permute0213(oBack.d, attOut.d, B, nh, T, hd);
    const oFlat = new Tensor(oBack.d, [R, d]);  // 展平視角（連續故零拷貝）
    const att = Tensor.empty(R, d);
    K.gemm(att.d, oFlat.d, W.o, R, d, d);
    const xMid = Tensor.empty(R, d);
    for (let i = 0; i < R * d; i++) xMid.d[i] = cur.d[i] + att.d[i];
    // ffn block
    const h2 = Tensor.empty(R, d), xh2 = Tensor.empty(R, d), r2 = new Float32Array(R);
    K.rmsFwd(h2.d, xh2.d, r2, xMid.d, P[`b${l}n2`].d, R, d, 1e-6);
    const a1 = Tensor.empty(R, 4 * d), a3 = Tensor.empty(R, 4 * d);
    K.gemm(a1.d, h2.d, P[`b${l}1`].d, R, 4 * d, d);
    K.gemm(a3.d, h2.d, P[`b${l}3`].d, R, 4 * d, d);
    const sGate = Tensor.empty(R, 4 * d), h = Tensor.empty(R, 4 * d);
    K.siluGateFwd(h.d, sGate.d, a1.d, a3.d, R * 4 * d);
    const f = Tensor.empty(R, d);
    K.gemm(f.d, h.d, P[`b${l}2`].d, R, d, 4 * d);
    const xOut = Tensor.empty(R, d);
    for (let i = 0; i < R * d; i++) xOut.d[i] = xMid.d[i] + f.d[i];
    caches.push({ xIn: cur, h1, xh1, r1, q, k, v, qr, kr, qt, kt, vt, scores, prob, attOut, oBack, xMid, h2, xh2, r2, a1, a3, sGate, h, W });
    cur = xOut;
  }
  const h = Tensor.empty(R, d), xh = Tensor.empty(R, d), rn = new Float32Array(R);
  K.rmsFwd(h.d, xh.d, rn, cur.d, P.n_out.d, R, d, 1e-6);
  const logits = Tensor.empty(R, cfg.vocab);
  K.gemmBT(logits.d, h.d, P.emb.d, R, d, cfg.vocab);  // tied：logits = h @ E^T
  return { logits, cache: { xEmb: x, idx, h, xh, rn, cur, caches, rope } };
}

// targets: Int32Array(R)。回傳 {loss, grads}
export function ceLossAndBwd(P, logits, cache, targets, cfg) {
  const { d, heads: nh, layers: L } = cfg;
  const R = logits.sh[0], V = logits.sh[1], B = R / cfg.seq, T = cfg.seq, hd = d / nh;
  const dlog = Tensor.empty(R, V);
  const loss = K.ceFwdBackward(dlog.d, logits.d, targets, R, V);
  const grads = {};
  const h = cache.h;
  // tied embedding：dh = dlog @ E；dE_out[v] = sum dlog * h
  const dh = Tensor.empty(R, d);
  K.gemm(dh.d, dlog.d, P.emb.d, R, d, V);
  const dEout = Tensor.zeros(V, d);
  const dl = dlog.d, hd_ = h.d, de = dEout.d;
  for (let r = 0; r < R; r++) {
    const lr = r * V, hr = r * d;
    for (let v = 0; v < V; v++) {
      const g = dl[lr + v];
      if (g !== 0) {
        const er = v * d;
        for (let j = 0; j < d; j++) de[er + j] += g * hd_[hr + j];
      }
    }
  }
  const dxn = Tensor.empty(R, d);
  const dnOut = Tensor.zeros(d);
  K.rmsBwd(dxn.d, dnOut.d, dh.d, cache.cur.d, cache.xh.d, cache.rn, P.n_out.d, R, d);
  grads.n_out = dnOut;
  let dx = dxn;
  for (let l = L - 1; l >= 0; l--) {
    const c = cache.caches[l];
    const R4 = R * 4 * d;
    // ffn 反向
    const dhh = Tensor.empty(R, 4 * d);
    const dW2 = Tensor.empty(4 * d, d);
    K.gemmAT(dW2.d, c.h.d, dx.d, R, d, 4 * d);
    K.gemmBT(dhh.d, dx.d, P[`b${l}2`].d, R, d, 4 * d);
    const da1 = Tensor.empty(R, 4 * d), da3 = Tensor.empty(R, 4 * d);
    K.siluGateBwd(da1.d, da3.d, dhh.d, c.a1.d, c.a3.d, c.sGate.d, R4);
    const dW1 = Tensor.empty(d, 4 * d), dW3 = Tensor.empty(d, 4 * d);
    K.gemmAT(dW1.d, c.h2.d, da1.d, R, 4 * d, d);
    K.gemmAT(dW3.d, c.h2.d, da3.d, R, 4 * d, d);
    const dx1 = Tensor.empty(R, d), dx3 = Tensor.empty(R, d);
    K.gemmBT(dx1.d, da1.d, P[`b${l}1`].d, R, 4 * d, d);
    K.gemmBT(dx3.d, da3.d, P[`b${l}3`].d, R, 4 * d, d);
    // x_mid 梯度（含 residual）
    const dxMidFfn = Tensor.empty(R, d);
    const dn2 = Tensor.zeros(d);
    const dh2sum = Tensor.empty(R, d);
    for (let i = 0; i < R * d; i++) dh2sum.d[i] = dx1.d[i] + dx3.d[i];
    K.rmsBwd(dxMidFfn.d, dn2.d, dh2sum.d, c.xMid.d, c.xh2.d, c.r2, P[`b${l}n2`].d, R, d);
    grads[`b${l}n2`] = dn2;
    const dMid = Tensor.empty(R, d);
    for (let i = 0; i < R * d; i++) dMid.d[i] = dx.d[i] + dxMidFfn.d[i];
    // attn 反向：先過 Wo^T 得 dL/d(o)，再視為 (B,T,nh,hd) 轉成 (B,nh,T,hd)
    const BH = B * nh;
    const do2 = Tensor.empty(R, d);
    K.gemmBT(do2.d, dMid.d, c.W.o, R, d, d);
    const dO = Tensor.empty(BH, T, hd);
    K.permute0213(dO.d, do2.d, B, T, nh, hd);
    const dV = Tensor.empty(BH, T, hd), dP = Tensor.empty(BH, T, hd);
    K.bmmAT(dV.d, c.prob.d, dO.d, BH, T, hd, T, T * T, T * hd, T * hd);
    K.bmmBT(dP.d, dO.d, c.vt.d, BH, T, T, hd, T * T, T * hd, T * hd);
    const dS = Tensor.empty(BH, T, T);
    K.softmaxBwd(dS.d, c.prob.d, dP.d, BH * T, T);
    const inv = 1 / Math.sqrt(hd);
    for (let i = 0; i < dS.d.length; i++) dS.d[i] *= inv;
    const dQr = Tensor.empty(BH, T, hd), dKr = Tensor.empty(BH, T, hd);
    K.bmm(dQr.d, dS.d, c.kt.d, BH, T, hd, T, T * hd, T * hd, T * hd);
    K.bmmAT(dKr.d, dS.d, c.qt.d, BH, T, hd, T, T * T, T * hd, T * hd);
    const dQr4 = Tensor.empty(B, T, nh, hd), dKr4 = Tensor.empty(B, T, nh, hd);
    K.permute0213(dQr4.d, dQr.d, B, nh, T, hd);   // (B,nh,T,hd)->(B,T,nh,hd)：注意軸語意
    K.permute0213(dKr4.d, dKr.d, B, nh, T, hd);
    const dq = Tensor.empty(R, d), dk = Tensor.empty(R, d);
    K.ropeBwd(dq.d, dQr4.d, cache.rope.cos, cache.rope.sin, B, T, nh, hd);
    K.ropeBwd(dk.d, dKr4.d, cache.rope.cos, cache.rope.sin, B, T, nh, hd);
    const dv2 = Tensor.empty(B, T, nh, hd);
    K.permute0213(dv2.d, dV.d, B, nh, T, hd);
    const dWq = Tensor.empty(d, d), dWk = Tensor.empty(d, d), dWv = Tensor.empty(d, d);
    const dxq = Tensor.empty(R, d), dxk = Tensor.empty(R, d), dxv = Tensor.empty(R, d);
    K.gemmAT(dWq.d, c.h1.d, dq.d, R, d, d);
    K.gemmAT(dWk.d, c.h1.d, dk.d, R, d, d);
    K.gemmAT(dWv.d, c.h1.d, dv2.d, R, d, d);
    K.gemmBT(dxq.d, dq.d, c.W.q, R, d, d);
    K.gemmBT(dxk.d, dk.d, c.W.k, R, d, d);
    K.gemmBT(dxv.d, dv2.d, c.W.v, R, d, d);
    const dInAttn = Tensor.empty(R, d);
    const dn1 = Tensor.zeros(d);
    const dh1sum = Tensor.empty(R, d);
    for (let i = 0; i < R * d; i++) dh1sum.d[i] = dxq.d[i] + dxk.d[i] + dxv.d[i];
    K.rmsBwd(dInAttn.d, dn1.d, dh1sum.d, c.xIn.d, c.xh1.d, c.r1, P[`b${l}n1`].d, R, d);
    grads[`b${l}n1`] = dn1;
    const dxNew = Tensor.empty(R, d);
    for (let i = 0; i < R * d; i++) dxNew.d[i] = dMid.d[i] + dInAttn.d[i];
    dx = dxNew;
    grads[`b${l}q`] = dWq; grads[`b${l}k`] = dWk;
    grads[`b${l}v`] = dWv;
    // Wo 梯度：X=O2d(R,d)（oBack 展平），dY=dMid(R,d)
    const dWo = Tensor.empty(d, d);
    K.gemmAT(dWo.d, c.oBack.view(R, d).d, dMid.d, R, d, d);
    grads[`b${l}o`] = dWo;
    grads[`b${l}1`] = dW1; grads[`b${l}2`] = dW2; grads[`b${l}3`] = dW3;
  }
  const dE = Tensor.zeros(V, d);
  K.scatterAdd(dE.d, cache.idx, dx.d, R, d);
  for (let i = 0; i < V * d; i++) dE.d[i] += dEout.d[i];
  grads.emb = dE;
  return { loss, grads };
}

// 生成：multinomial 採樣（對應原 model.generate；單 prompt，B=1）
export function generate(P, idxArr, maxNew, rope, cfg, rng) {
  let idx = Int32Array.from(idxArr);
  const V = cfg.vocab;
  for (let s = 0; s < maxNew; s++) {
    const cond = idx.slice(Math.max(0, idx.length - cfg.seq));
    const T = cond.length;
    const { logits } = forward(P, cond, rope, { ...cfg, seq: T });
    const base = (T - 1) * V;  // 取最後一個位置
    let m = -Infinity;
    for (let v = 0; v < V; v++) if (logits.d[base + v] > m) m = logits.d[base + v];
    const cdf = new Float64Array(V);
    let acc = 0;
    for (let v = 0; v < V; v++) { acc += Math.exp(logits.d[base + v] - m); cdf[v] = acc; }
    for (let v = 0; v < V; v++) cdf[v] /= acc;
    const nxt = rng.choiceCDF(cdf, V);
    const grown = new Int32Array(idx.length + 1);
    grown.set(idx, 0);
    grown[idx.length] = nxt;
    idx = grown;
  }
  return idx;
}
