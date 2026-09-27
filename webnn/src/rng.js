// rng.js — 可重現的隨機數（mulberry32 + Box-Muller 高斯），對應 numpy default_rng。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = 7) {
    this.uniform = mulberry32(seed);
    this._spare = null;
  }
  random() { return this.uniform(); }
  integers(low, high, n) {
    const out = new Int32Array(n);
    const range = high - low;
    for (let i = 0; i < n; i++) out[i] = low + Math.floor(this.uniform() * range);
    return out;
  }
  choiceCDF(cdfRow, len) {
    // multinomial 一次採樣：cumsum 已算好，u ~ U[0,1)
    const u = this.uniform();
    let lo = 0, hi = len - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdfRow[mid] < u) lo = mid + 1; else hi = mid;
    }
    return lo;
  }
  standardNormalArray(out) {
    // Box-Muller，填入 Float32Array
    for (let i = 0; i < out.length; i += 2) {
      let u1 = 0;
      while (u1 === 0) u1 = this.uniform();
      const u2 = this.uniform();
      const r = Math.sqrt(-2.0 * Math.log(u1));
      out[i] = r * Math.cos(2 * Math.PI * u2);
      if (i + 1 < out.length) out[i + 1] = r * Math.sin(2 * Math.PI * u2);
    }
    return out;
  }
}
