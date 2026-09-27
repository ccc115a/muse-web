// tests/gradcheck.mjs — JS 引擎手寫反向 vs 數值梯度。
import { RNG } from "../src/rng.js";
import { initParams, buildRope, forward, ceLossAndBwd } from "../src/model.js";

const cfg = { d: 8, heads: 2, layers: 1, seq: 4, vocab: 12 };
const rng = new RNG(7);
const P = initParams(rng, cfg.vocab, cfg.d, cfg.layers);
const rope = buildRope(cfg.d / cfg.heads, cfg.seq * 2);
const brng = new RNG(0);
const B = 2;
const xb = brng.integers(0, cfg.vocab, B * cfg.seq);
const yb = brng.integers(0, cfg.vocab, B * cfg.seq);

function lossOf(p) {
  const { logits } = forward(p, xb, rope, cfg);
  // 與 ceLossAndBwd 相同的 fused CE（只求值）
  const R = B * cfg.seq, V = cfg.vocab;
  let total = 0;
  for (let r = 0; r < R; r++) {
    const o = r * V;
    let m = -Infinity;
    for (let v = 0; v < V; v++) if (logits.d[o + v] > m) m = logits.d[o + v];
    let s = 0;
    for (let v = 0; v < V; v++) s += Math.exp(logits.d[o + v] - m);
    total += m + Math.log(s) - logits.d[o + yb[r]];
  }
  return total / R;
}

const fwd = forward(P, xb, rope, cfg);
const { loss, grads } = ceLossAndBwd(P, fwd.logits, fwd.cache, yb, cfg);
if (!Number.isFinite(loss)) { console.error("loss 非有限值 ❌"); process.exit(1); }
console.log(`loss=${loss.toFixed(4)}`);

const srng = new RNG(1);
const eps = 1e-3;
let worst = 0;
const keys = Object.keys(P);
for (const k of keys) {
  const p = P[k].d, g = grads[k].d;
  if (p.length !== g.length) throw new Error(`${k} 形狀不一致`);
  for (let s = 0; s < Math.min(4, p.length); s++) {
    const i = Math.floor(srng.random() * p.length);
    const old = p[i];
    p[i] = old + eps; const lp = lossOf(P);
    p[i] = old - eps; const lm = lossOf(P);
    p[i] = old;
    const num = (lp - lm) / (2 * eps), ana = g[i];
    worst = Math.max(worst, Math.abs(num - ana) / Math.max(1e-8, Math.abs(num) + Math.abs(ana)));
  }
}
console.log(`worst relative error: ${worst.toExponential(2)}`);
if (!Number.isFinite(worst) || worst > 8e-2) { console.error("GRADCHECK FAILED ❌"); process.exit(1); }
console.log("GRADCHECK PASSED ✅");
