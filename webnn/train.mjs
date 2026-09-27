// train.mjs — 命令列訓練（對應 webpy/examples/mini-llm/train.py，同 presets）。
// 用法：node train.mjs [--preset fast|standard|full]
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { RNG } from "./src/rng.js";
import { buildVocab, makeCodec, getBatch } from "./src/data.js";
import { initParams, buildRope, forward, ceLossAndBwd, generate } from "./src/model.js";
import { adamInit, clipGrads, adamStep } from "./src/optim.js";

const args = process.argv.slice(2);
const preset = args.includes("--preset") && args[args.indexOf("--preset") + 1]
  ? args[args.indexOf("--preset") + 1] : "standard";
const here = dirname(fileURLToPath(import.meta.url));

// 超參數寫死在 preset 裡，不吃命令列
let D, H, L, SEQ, preIters, ftIters, preB, ftB, LR, FTLR;
if (preset === "full") {
  [D, H, L, SEQ, preIters, ftIters, preB, ftB, LR, FTLR] =
    [128, 4, 4, 64, 500, 300, 32, 32, 5e-4, 1e-4];
} else if (preset === "standard") {
  [D, H, L, SEQ, preIters, ftIters, preB, ftB, LR, FTLR] =
    [128, 4, 4, 32, 300, 200, 32, 32, 5e-4, 1e-4];
} else {
  [D, H, L, SEQ, preIters, ftIters, preB, ftB, LR, FTLR] =
    [64, 2, 2, 32, 120, 60, 16, 16, 5e-4, 1e-4];
}
const cfg = { d: D, heads: H, layers: L, seq: SEQ };
const LOG = 10, SEED = 7, GEN_TOKENS = 100;
const savePath = join(here, `weights.${preset}.json`);
const prePath = join(here, "corpus", "pretrain.txt");
const ftPath = join(here, "corpus", "finetune.txt");
const PROMPT = "<Q>火星的大氣層怎樣？<A>";
console.log(`preset=${preset} d=${D} heads=${H} layers=${L} seq=${SEQ} ` +
  `preIters=${preIters}x${preB} ftIters=${ftIters}x${ftB}`);

const preText = readFileSync(prePath, "utf8");
const ftText = readFileSync(ftPath, "utf8");
const { stoi, itos, vocab } = buildVocab(preText, ftText);
console.log(`詞表大小: ${vocab} 字元`);
const { encode, decode } = makeCodec(stoi, itos);
const pre = encode(preText), ft = encode(ftText);
console.log(`Pretrain 資料長度: ${pre.length} | Finetune 資料長度: ${ft.length}`);

const rng = new RNG(1337);
cfg.vocab = vocab;
const rope = buildRope(cfg.d / cfg.heads, cfg.seq * 2);
const P = initParams(new RNG(SEED), vocab, cfg.d, cfg.layers);
console.log(`模型參數: ${Object.values(P).reduce((a, t) => a + t.size, 0).toLocaleString()}`);

function loop(params, data, iters, batch, lr, tag) {
  const optState = adamInit(params);
  const t0 = Date.now();
  for (let it = 1; it <= iters; it++) {
    const { x, y } = getBatch(rng, data, batch, cfg.seq);
    const { logits, cache } = forward(params, x, rope, cfg);
    const { loss, grads } = ceLossAndBwd(params, logits, cache, y, cfg);
    const gn = clipGrads(grads, 1.0);
    adamStep(params, grads, optState, lr, it);
    if (it % LOG === 0 || it === 1) {
      const el = (Date.now() - t0) / 1000;
      const rate = it / Math.max(el, 1e-6);
      console.log(`${tag} Step ${String(it).padStart(4)} | Loss: ${loss.toFixed(4)} | grad_norm: ${gn.toFixed(3)} | ${rate.toFixed(1)}it/s ETA ${((iters - it) / Math.max(rate, 1e-6)).toFixed(0)}s`);
    }
  }
}

console.log("開始 Pre-training...");
loop(P, pre, preIters, preB, LR, "Pretrain");
console.log("開始 Fine-tuning...");
loop(P, ft, ftIters, ftB, FTLR, "Finetune");

const out = { cfg, params: {} };
for (const k in P) out.params[k] = { shape: P[k].sh, data: [...P[k].d] };
writeFileSync(savePath, JSON.stringify({ vocab: { stoi, itos }, ...out }));
console.log(`權重已存 ${savePath}`);

const prompt = PROMPT;
const gen = generate(P, Int32Array.from(encode(prompt)), GEN_TOKENS, rope, cfg, new RNG(99));
console.log("=".repeat(50));
console.log(`📝 題目: ${prompt}`);
console.log(`🤖 輸出:\n${decode([...gen])}`);
console.log("=".repeat(50));
