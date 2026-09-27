// tests/equiv.mjs — JS 引擎 vs numpy 版（已證與 torch 等價）：同權重同 batch 比 loss+梯度。
import { readFileSync } from "fs";
import { Tensor } from "../src/tensor.js";
import { buildRope, forward, ceLossAndBwd } from "../src/model.js";

const fx = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url)));
const { cfg } = fx;
const P = {};
for (const k in fx.params) {
  const { shape, data } = fx.params[k];
  P[k] = new Tensor(Float32Array.from(data), shape);
}
const rope = buildRope(cfg.d / cfg.heads, cfg.seq * 2);
// rope 應與 numpy 表一致（同 theta 公式）
const xb = Int32Array.from(fx.xb), yb = Int32Array.from(fx.yb);

const { logits, cache } = forward(P, xb, rope, cfg);
const { loss, grads } = ceLossAndBwd(P, logits, cache, yb, cfg);

console.log(`numpy loss=${fx.loss.toFixed(6)}  js loss=${loss.toFixed(6)}`);
if (!Number.isFinite(loss) || Math.abs(fx.loss - loss) > 1e-4) { console.error("LOSS MISMATCH ❌"); process.exit(1); }
console.log("loss match ✅");

let worst = 0, worstk = "";
for (const k in fx.grads) {
  const ref = fx.grads[k], got = grads[k].d;
  if (ref.length !== got.length) { console.error(`${k} 長度不一致 ❌`); process.exit(1); }
  let w = 0;
  for (let i = 0; i < ref.length; i++) {
    const rel = Math.abs(ref[i] - got[i]) / Math.max(1e-12, Math.abs(ref[i]) + Math.abs(got[i]));
    if (rel > w) w = rel;
  }
  console.log(`  ${k.padEnd(6)} max-rel-err=${w.toExponential(2)}${w < 1e-2 ? " ✅" : " ❌"}`);
  if (w > worst) { worst = w; worstk = k; }
}
console.log(`worst: ${worstk} ${worst.toExponential(2)}`);
if (!Number.isFinite(worst) || worst > 1e-2) { console.error("GRADIENT MISMATCH ❌"); process.exit(1); }
console.log("EQUIV PASSED ✅ — JS 引擎與 numpy/torch 版等價");
