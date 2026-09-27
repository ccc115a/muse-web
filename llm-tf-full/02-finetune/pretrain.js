// pretrain.js — 對應原 pretrain.py：建詞表（存 vocab.json）→ 訓練 500 步 → 存 weights.pretrain.json
'use strict';
const fs = require('fs');
const path = require('path');
const tf = require('@tensorflow/tfjs-node');
const { DistillTransformer } = require('./src/model');
const { initState, trainStep } = require('./src/train');

const HERE = __dirname;
const BATCH = 32, SEQ = 64, ITERS = 500, LR = 5e-4;

const preText = fs.readFileSync(path.join(HERE, 'corpus', 'pretrain.txt'), 'utf8');
const ftText = fs.readFileSync(path.join(HERE, 'corpus', 'finetune.txt'), 'utf8');
const chars = [...new Set([...preText, ...ftText])].sort();
const stoi = Object.fromEntries(chars.map((c, i) => [c, i]));
console.log(`詞表大小: ${chars.length} 字元`);
fs.writeFileSync(path.join(HERE, 'vocab.json'), JSON.stringify({ stoi, vocab: chars.length }));
console.log('詞表已儲存為 vocab.json');

const encode = (s) => [...s].map((c) => stoi[c]);
const pre = encode(preText);
console.log(`Pretrain 資料長度: ${pre.length}`);

const model = new DistillTransformer({ vocab: chars.length, d: 128, heads: 4, layers: 4, seq: SEQ });
console.log(`模型參數: ${(model.paramCount() / 1e6).toFixed(2)} M | 後端: ${tf.getBackend()}`);
const state = initState(model.varList, model.initVals);

function getBatch() {
  const x = new Int32Array(BATCH * SEQ), y = new Int32Array(BATCH * SEQ);
  for (let b = 0; b < BATCH; b++) {
    const i = Math.floor(Math.random() * (pre.length - SEQ - 1));
    for (let t = 0; t < SEQ; t++) { x[b * SEQ + t] = pre[i + t]; y[b * SEQ + t] = pre[i + t + 1]; }
  }
  return [x, y];
}

console.log('開始 Pre-training...');
const t0 = Date.now();
for (let it = 0; it < ITERS; it++) {
  const [x, y] = getBatch();
  const { loss } = trainStep(model, state, x, y, BATCH, SEQ, LR, it + 1);
  if (it % 100 === 0 || it === ITERS - 1) {
    console.log(`Pretrain Step ${String(it).padStart(4)} | Loss: ${loss.toFixed(4)} | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
model.saveWeights(path.join(HERE, 'weights.pretrain.json'));
console.log('預訓練完成！模型已儲存為 weights.pretrain.json');
