// optim.js — AdamW（bias correction，1-D 參數跳過 decay）+ 全域梯度裁剪。
export function adamInit(params) {
  const st = {};
  for (const k in params) {
    st[k] = { m: new Float64Array(params[k].d.length), v: new Float64Array(params[k].d.length) };
  }
  return st;
}

export function clipGrads(grads, maxNorm = 1.0) {
  let total = 0;
  for (const k in grads) {
    const g = grads[k].d;
    for (let i = 0; i < g.length; i++) total += g[i] * g[i];
  }
  total = Math.sqrt(total);
  if (total > maxNorm) {
    const s = maxNorm / (total + 1e-12);
    for (const k in grads) {
      const g = grads[k].d;
      for (let i = 0; i < g.length; i++) g[i] *= s;
    }
  }
  return total;
}

export function adamStep(params, grads, state, lr, t, wd = 0.01, b1 = 0.9, b2 = 0.95) {
  const c1 = 1 - Math.pow(b1, t), c2 = 1 - Math.pow(b2, t);
  for (const k in params) {
    const p = params[k].d, g = grads[k].d, { m, v } = state[k];
    const decay = params[k].sh.length > 1;  // norm 層不 decay
    for (let i = 0; i < p.length; i++) {
      const gi = g[i];
      m[i] = b1 * m[i] + (1 - b1) * gi;
      v[i] = b2 * v[i] + (1 - b2) * gi * gi;
      let upd = (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
      if (decay) upd += wd * p[i];
      p[i] -= lr * upd;
    }
  }
}
