// finetune.js — 對應原 finetune.py：載入詞表+預訓練權重 → 微調 300 步 → 存檔 → QA 實測
'use strict';
const fs = require('fs');
const path = require('path');
const { DistillTransformer } = require('./src/model');
const { initState, trainStep } = require('./src/train');

const HERE = __dirname;
const BATCH = 32, SEQ = 64, ITERS = 300, LR = 1e-4;

const { stoi, vocab } = JSON.parse(fs.readFileSync(path.join(HERE, 'vocab.json'), 'utf8'));
const itos = Object.fromEntries(Object.entries(stoi).map(([c, i]) => [i, c]));
const encode = (s) => [...s].map((c) => stoi[c]);
const decode = (l) => l.map((i) => itos[i]).join('');

const ftText = fs.readFileSync(path.join(HERE, 'corpus', 'finetune.txt'), 'utf8');
const ft = encode(ftText);
console.log(`Finetune 資料長度: ${ft.length}`);

const model = new DistillTransformer({ vocab, d: 128, heads: 4, layers: 4, seq: SEQ });
model.loadWeights(path.join(HERE, 'weights.pretrain.json'));
console.log('成功載入 weights.pretrain.json 權重！');

function getBatch() {
  const x = new Int32Array(BATCH * SEQ), y = new Int32Array(BATCH * SEQ);
  for (let b = 0; b < BATCH; b++) {
    const i = Math.floor(Math.random() * (ft.length - SEQ - 1));
    for (let t = 0; t < SEQ; t++) { x[b * SEQ + t] = ft[i + t]; y[b * SEQ + t] = ft[i + t + 1]; }
  }
  return [x, y];
}

const state = initState(model.varList, model.initVals);
console.log('開始 Fine-tuning...');
const t0 = Date.now();
for (let it = 0; it < ITERS; it++) {
  const [x, y] = getBatch();
  const { loss } = trainStep(model, state, x, y, BATCH, SEQ, LR, it + 1);
  if (it % 100 === 0 || it === ITERS - 1) {
    console.log(`Finetune Step ${String(it).padStart(4)} | Loss: ${loss.toFixed(4)} | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
model.saveWeights(path.join(HERE, 'weights.finetune.json'));
console.log('微調完成！模型已儲存為 weights.finetune.json');

// 實測：自動抓 finetune 第一句當考題（同原版 §4）
console.log('\n' + '='.repeat(50));
console.log('測試對話（自動抓取訓練集第一句進行測試）');
console.log('='.repeat(50));
const firstLine = ftText.split('\n')[0].trim();
const [prompt, expected] = firstLine.includes('<A>')
  ? [firstLine.split('<A>')[0] + '<A>', firstLine.split('<A>')[1]]
  : [firstLine, '(無法解析答案)'];
console.log(`📝 抽取到的題目: ${prompt}`);
console.log(`🎯 預期的解答: ${expected}`);
console.log('-'.repeat(50));
const gen = model.generate(encode(prompt), 100);
console.log(`🤖 AI 實際輸出:\n${decode(gen)}`);
console.log('='.repeat(50));
