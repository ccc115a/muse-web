// kernels.js — L0 原始數學核心：全部手寫，零依賴。
// 速度關鍵：分塊 (blocking) + ikj 迴圈序 + 4 路展開，讓 V8/JIT 吃好吃滿。
// 轉置一律用「專用 kernel 直接算」（gemmAT/gemmBT/bmm 系），絕不先轉置再乘。

const BS = 64;

// C[M*N] = A[M*K] @ B[K*N]（C 會先清零）
export function gemm(C, A, B, M, N, K) {
  C.fill(0);
  for (let i0 = 0; i0 < M; i0 += BS) {
    const i1 = Math.min(i0 + BS, M);
    for (let k0 = 0; k0 < K; k0 += BS) {
      const k1 = Math.min(k0 + BS, K);
      for (let j0 = 0; j0 < N; j0 += BS) {
        const j1 = Math.min(j0 + BS, N);
        for (let i = i0; i < i1; i++) {
          const aR = i * K, cR = i * N;
          for (let k = k0; k < k1; k++) {
            const a = A[aR + k], bR = k * N;
            let j = j0;
            for (; j + 3 < j1; j += 4) {
              C[cR + j] += a * B[bR + j];
              C[cR + j + 1] += a * B[bR + j + 1];
              C[cR + j + 2] += a * B[bR + j + 2];
              C[cR + j + 3] += a * B[bR + j + 3];
            }
            for (; j < j1; j++) C[cR + j] += a * B[bR + j];
          }
        }
      }
    }
  }
}

// C[K*N] = A[M*K]^T @ B[M*N]（dW 用，不物化轉置）
export function gemmAT(C, A, B, M, N, K) {
  C.fill(0);
  for (let m = 0; m < M; m++) {
    const aR = m * K, bR = m * N;
    for (let i = 0; i < K; i++) {
      const a = A[aR + i], cR = i * N;
      let j = 0;
      for (; j + 3 < N; j += 4) {
        C[cR + j] += a * B[bR + j];
        C[cR + j + 1] += a * B[bR + j + 1];
        C[cR + j + 2] += a * B[bR + j + 2];
        C[cR + j + 3] += a * B[bR + j + 3];
      }
      for (; j < N; j++) C[cR + j] += a * B[bR + j];
    }
  }
}

// C[M*K] = A[M*N] @ B[K*N]^T（dx 用，不物化轉置）
export function gemmBT(C, A, B, M, N, K) {
  for (let i = 0; i < M; i++) {
    const aR = i * N, cR = i * K;
    for (let j = 0; j < K; j++) {
      const bR = j * N;
      let s = 0;
      for (let n = 0; n < N; n++) s += A[aR + n] * B[bR + n];
      C[cR + j] = s;
    }
  }
}

// 批次版：batch 個 (T,K)@(K,N)->(T,N)，A/B/C 以 batchStride 間隔
export function bmm(C, A, B, batch, T, N, K, cs, as, bs) {
  for (let b = 0; b < batch; b++)
    gemm(C.subarray(b * cs, b * cs + T * N),
         A.subarray(b * as, b * as + T * K),
         B.subarray(b * bs, b * bs + K * N), T, N, K);
}
// C[b] = A[b]^T @ B[b]：A(T,K),B(T,N) -> C(K,N)
export function bmmAT(C, A, B, batch, T, N, K, cs, as, bs) {
  for (let b = 0; b < batch; b++)
    gemmAT(C.subarray(b * cs, b * cs + K * N),
           A.subarray(b * as, b * as + T * K),
           B.subarray(b * bs, b * bs + T * N), T, N, K);
}
// C[b] = A[b] @ B[b]^T：A(T,N),B(S,N) -> C(T,S)
export function bmmBT(C, A, B, batch, T, S, N, cs, as, bs) {
  for (let b = 0; b < batch; b++)
    gemmBT(C.subarray(b * cs, b * cs + T * S),
           A.subarray(b * as, b * as + T * N),
           B.subarray(b * bs, b * bs + S * N), T, S, N);
}

// (B,T,H,D) <-> (B,H,T,D) 轉置拷貝（0213 是對合函數，正反同一 kernel）
export function permute0213(out, inp, B, T, H, D) {
  for (let b = 0; b < B; b++)
    for (let t = 0; t < T; t++)
      for (let h = 0; h < H; h++) {
        const s = ((b * T + t) * H + h) * D;
        const q = ((b * H + h) * T + t) * D;
        for (let d = 0; d < D; d++) out[q + d] = inp[s + d];
      }
}

// rows(R,D) softmax（f64 累加保精度），out 與 max 可選存供反向用
export function softmaxRows(out, inp, R, D) {
  for (let r = 0; r < R; r++) {
    const o = r * D;
    let m = -Infinity;
    for (let i = 0; i < D; i++) if (inp[o + i] > m) m = inp[o + i];
    let s = 0;
    for (let i = 0; i < D; i++) { const e = Math.exp(inp[o + i] - m); out[o + i] = e; s += e; }
    for (let i = 0; i < D; i++) out[o + i] /= s;
  }
}

// softmax 反向：ds = p * (dp - sum(dp*p))，scores 另有 1/sqrt 縮放由呼叫方處理
export function softmaxBwd(ds, p, dp, R, D) {
  for (let r = 0; r < R; r++) {
    const o = r * D;
    let dot = 0;
    for (let i = 0; i < D; i++) dot += dp[o + i] * p[o + i];
    for (let i = 0; i < D; i++) ds[o + i] = p[o + i] * (dp[o + i] - dot);
  }
}

// RMSNorm 前向：y = w * x / sqrt(mean(x^2)+eps)，存 xh 與 r 供反向
export function rmsFwd(y, xh, rOut, x, w, n, d, eps) {
  for (let i = 0; i < n; i++) {
    const o = i * d;
    let m = 0;
    for (let j = 0; j < d; j++) m += x[o + j] * x[o + j];
    m /= d;
    const r = 1 / Math.sqrt(m + eps);
    rOut[i] = r;
    for (let j = 0; j < d; j++) {
      const h = x[o + j] * r;
      xh[o + j] = h;
      y[o + j] = w[j] * h;
    }
  }
}

// RMSNorm 反向（標準推導）
export function rmsBwd(dx, dw, dy, x, xh, rArr, w, n, d) {
  dw.fill(0);
  for (let i = 0; i < n; i++) {
    const o = i * d, r = rArr[i], r3 = r * r * r;
    let c = 0;
    for (let j = 0; j < d; j++) {
      const dxh = dy[o + j] * w[j];
      c += dxh * x[o + j];
      dw[j] += dy[o + j] * xh[o + j];
    }
    const k = c * r3 / d;
    for (let j = 0; j < d; j++) dx[o + j] = dy[o + j] * w[j] * r - x[o + j] * k;
  }
}

// RoPE 前向（實數版，與 torch.polar 等價）：x (B,T,H,Dh)
export function ropeFwd(out, x, cos, sin, B, T, H, Dh) {
  const hd2 = Dh >> 1;
  for (let b = 0; b < B; b++)
    for (let t = 0; t < T; t++) {
      const c = cos.subarray(t * hd2, t * hd2 + hd2);
      const s = sin.subarray(t * hd2, t * hd2 + hd2);
      for (let h = 0; h < H; h++) {
        const o = ((b * T + t) * H + h) * Dh;
        for (let i = 0; i < hd2; i++) {
          const x0 = x[o + 2 * i], x1 = x[o + 2 * i + 1];
          out[o + 2 * i] = x0 * c[i] - x1 * s[i];
          out[o + 2 * i + 1] = x0 * s[i] + x1 * c[i];
        }
      }
    }
}

// RoPE 反向（轉 -θ）
export function ropeBwd(dx, dy, cos, sin, B, T, H, Dh) {
  const hd2 = Dh >> 1;
  for (let b = 0; b < B; b++)
    for (let t = 0; t < T; t++) {
      const c = cos.subarray(t * hd2, t * hd2 + hd2);
      const s = sin.subarray(t * hd2, t * hd2 + hd2);
      for (let h = 0; h < H; h++) {
        const o = ((b * T + t) * H + h) * Dh;
        for (let i = 0; i < hd2; i++) {
          const y0 = dy[o + 2 * i], y1 = dy[o + 2 * i + 1];
          dx[o + 2 * i] = y0 * c[i] + y1 * s[i];
          dx[o + 2 * i + 1] = -y0 * s[i] + y1 * c[i];
        }
      }
    }
}

// embedding gather：out[r] = E[idx[r]]
export function gather(out, E, idx, R, D) {
  for (let r = 0; r < R; r++) {
    const s = idx[r] * D, o = r * D;
    for (let j = 0; j < D; j++) out[o + j] = E[s + j];
  }
}

// embedding scatter-add：dE[idx[r]] += dx[r]
export function scatterAdd(dE, idx, dx, R, D) {
  for (let r = 0; r < R; r++) {
    const o = idx[r] * D, s = r * D;
    for (let j = 0; j < D; j++) dE[o + j] += dx[s + j];
  }
}

// SiLU 融合門：h = silu(a1) * a3；反向一起算
export function siluGateFwd(h, sOut, a1, a3, n) {
  for (let i = 0; i < n; i++) {
    const s = 1 / (1 + Math.exp(-a1[i]));
    sOut[i] = s;
    h[i] = a1[i] * s * a3[i];
  }
}
export function siluGateBwd(da1, da3, dh, a1, a3, sArr, n) {
  for (let i = 0; i < n; i++) {
    const s = sArr[i];
    const ds = s * (1 + a1[i] * (1 - s));
    da1[i] = dh[i] * a3[i] * ds;
    da3[i] = dh[i] * a1[i] * s;
  }
}

// causal mask 加法：scores (batch,T,T) 上三角加 NEG
export function addCausalMask(scores, batch, T, NEG = -1e9) {
  for (let b = 0; b < batch; b++) {
    const base = b * T * T;
    for (let i = 0; i < T; i++)
      for (let j = i + 1; j < T; j++) scores[base + i * T + j] += NEG;
  }
}

// 融合 CE：log-softmax + NLL，回傳 loss；dlogits 供反向（已除 R）
export function ceFwdBackward(dlogits, logits, targets, R, V) {
  let total = 0;
  for (let r = 0; r < R; r++) {
    const o = r * V, t = targets[r];
    let m = -Infinity;
    for (let v = 0; v < V; v++) if (logits[o + v] > m) m = logits[o + v];
    let s = 0;
    for (let v = 0; v < V; v++) { const e = Math.exp(logits[o + v] - m); dlogits[o + v] = e; s += e; }
    total += m + Math.log(s) - logits[o + t];
    for (let v = 0; v < V; v++) dlogits[o + v] /= s;
    dlogits[o + t] -= 1;
  }
  const inv = 1 / R;
  for (let i = 0; i < R * V; i++) dlogits[i] *= inv;
  return total * inv;
}
