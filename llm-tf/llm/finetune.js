#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const tf = require('../tf0');

function parseArgs() {
  const options = {
    pretrainFile: path.join(__dirname, '../corpus/pretrain.txt'),
    finetuneFile: path.join(__dirname, '../corpus/finetune.txt'),
    pretrainIters: 500,
    finetuneIters: 500,
    seq_len: 16,
    batch_size: 16,
    gen_len: 100,
    prompt: null
  };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--pretrain' || arg === '-p') options.pretrainFile = args[++index];
    else if (arg === '--finetune' || arg === '-f') options.finetuneFile = args[++index];
    else if (arg === '--pretrain_iters') options.pretrainIters = Number.parseInt(args[++index], 10);
    else if (arg === '--finetune_iters') options.finetuneIters = Number.parseInt(args[++index], 10);
    else if (arg === '--iters') {
      const iters = Number.parseInt(args[++index], 10);
      options.pretrainIters = iters;
      options.finetuneIters = iters;
    }
    else if (arg === '--seq_len') options.seq_len = Number.parseInt(args[++index], 10);
    else if (arg === '--batch_size') options.batch_size = Number.parseInt(args[++index], 10);
    else if (arg === '--gen_len') options.gen_len = Number.parseInt(args[++index], 10);
    else if (arg === '--prompt') options.prompt = args[++index];
  }
  return options;
}

function variable(shape, scale = 0.02) {
  return tf.variable(tf.randomNormal(shape, 0, scale, 'float32'));
}

function rmsNorm(x) {
  return x.div(x.square().mean(-1, true).add(1e-5).sqrt());
}

class TinyTransformer {
  constructor(vocabSize, seqLen) {
    this.vocabSize = vocabSize;
    this.seqLen = seqLen;
    this.dim = 32;
    this.heads = 4;
    this.headDim = this.dim / this.heads;
    this.hidden = this.dim * 4;
    this.tokenEmbedding = variable([vocabSize, this.dim]);
    this.positionEmbedding = variable([seqLen, this.dim]);
    this.wq = variable([this.dim, this.dim]);
    this.wk = variable([this.dim, this.dim]);
    this.wv = variable([this.dim, this.dim]);
    this.wo = variable([this.dim, this.dim]);
    this.w1 = variable([this.dim, this.hidden]);
    this.w2 = variable([this.hidden, this.dim]);
    this.mask = tf.buffer([seqLen, seqLen], 'float32');
    for (let row = 0; row < seqLen; row++) for (let column = row + 1; column < seqLen; column++) this.mask.set(-1e9, row, column);
    this.mask = this.mask.toTensor();
    this.variables = [this.tokenEmbedding, this.positionEmbedding, this.wq, this.wk, this.wv, this.wo, this.w1, this.w2];
  }

  logits(tokenIds) {
    const [batchSize, time] = tokenIds.shape;
    const tokenOneHot = tf.oneHot(tokenIds, this.vocabSize).toFloat().reshape([batchSize * time, this.vocabSize]);
    const positionOneHot = tf.oneHot(tf.range(0, time, 1, 'int32'), this.seqLen).toFloat();
    const tokenEmbeddings = tokenOneHot.matMul(this.tokenEmbedding).reshape([batchSize, time, this.dim]);
    const positionEmbeddings = positionOneHot.matMul(this.positionEmbedding).expandDims(0).tile([batchSize, 1, 1]);
    let x = tf.add(tokenEmbeddings, positionEmbeddings);
    const normalized = rmsNorm(x);
    const flat = normalized.reshape([batchSize * time, this.dim]);
    const reshapeHeads = (tensor) => tensor.reshape([batchSize, time, this.heads, this.headDim]).transpose([0, 2, 1, 3]);
    const q = reshapeHeads(flat.matMul(this.wq));
    const k = reshapeHeads(flat.matMul(this.wk));
    const v = reshapeHeads(flat.matMul(this.wv));
    const scores = tf.matMul(q, k, false, true).div(Math.sqrt(this.headDim)).add(this.mask.slice([0, 0], [time, time]));
    const attended = tf.matMul(tf.softmax(scores), v).transpose([0, 2, 1, 3]).reshape([batchSize * time, this.dim]);
    x = x.add(attended.matMul(this.wo).reshape([batchSize, time, this.dim]));
    const feedForward = rmsNorm(x).reshape([batchSize * time, this.dim]).matMul(this.w1).relu().matMul(this.w2).reshape([batchSize, time, this.dim]);
    x = rmsNorm(x.add(feedForward));
    return x.reshape([batchSize * time, this.dim]).matMul(this.tokenEmbedding, false, true);
  }

  dispose() {
    for (const tensor of this.variables) tensor.dispose();
    this.mask.dispose();
  }
}

function makeBatch(data, batchSize, seqLen) {
  const input = new Int32Array(batchSize * seqLen);
  const target = new Int32Array(batchSize * seqLen);
  for (let batch = 0; batch < batchSize; batch++) {
    const start = Math.floor(Math.random() * (data.length - seqLen - 1));
    for (let time = 0; time < seqLen; time++) {
      input[batch * seqLen + time] = data[start + time];
      target[batch * seqLen + time] = data[start + time + 1];
    }
  }
  return { input, target };
}

function train(model, data, iters, batchSize, seqLen, lr = 0.003, phaseName = '訓練') {
  const optimizer = tf.train.adam(lr);
  const reportInterval = Math.max(1, Math.floor(iters / 10));
  console.log(`開始${phaseName} (${iters} 步, 學習率 ${lr})...`);
  for (let iteration = 0; iteration < iters; iteration++) {
    const batch = makeBatch(data, batchSize, seqLen);
    const loss = tf.tidy(() => optimizer.minimize(() => {
      const input = tf.tensor2d(batch.input, [batchSize, seqLen], 'int32');
      const target = tf.oneHot(tf.tensor1d(batch.target, 'int32'), model.vocabSize).toFloat();
      return tf.losses.softmaxCrossEntropy(target, model.logits(input)).mean();
    }, true, model.variables));
    if (iteration % reportInterval === 0 || iteration === iters - 1) {
      console.log(`Step ${String(iteration).padStart(4, ' ')} | Loss: ${loss.dataSync()[0].toFixed(4)}`);
    }
    loss.dispose();
  }
}

function generate(model, prompt, encode, decode, seqLen, length) {
  const tokens = encode(prompt);
  for (let step = 0; step < length; step++) {
    const next = tf.tidy(() => {
      const context = tokens.slice(-seqLen);
      const logits = model.logits(tf.tensor2d(context, [1, context.length], 'int32'));
      return tf.multinomial(logits.slice([context.length - 1, 0], [1, model.vocabSize]).div(0.5), 1).dataSync()[0];
    });
    tokens.push(next);
  }
  return decode(tokens);
}

function main() {
  const options = parseArgs();

  // 讀取 pretrain 與 finetune 文本以建立統一的字符表 (Vocab)
  const pretrainText = fs.existsSync(options.pretrainFile) ? fs.readFileSync(options.pretrainFile, 'utf8') : '';
  const finetuneText = fs.readFileSync(options.finetuneFile, 'utf8');

  if (!finetuneText || finetuneText.length <= options.seq_len) {
    throw new Error('微調語料長度必須大於 seq_len');
  }

  const combinedText = pretrainText + finetuneText;
  const chars = Array.from(new Set(Array.from(combinedText))).sort();
  const stoi = Object.fromEntries(chars.map((character, index) => [character, index]));
  const encode = (str) => Array.from(str, (char) => stoi[char] !== undefined ? stoi[char] : 0);
  const decode = (ids) => ids.map((id) => chars[id]).join('');

  const model = new TinyTransformer(chars.length, options.seq_len);

  console.log(`使用後端: ${tf.getBackend()} (TensorFlow native CPU)`);
  console.log(`詞表大小: ${chars.length}`);
  console.log(`模型參數總數: ${(model.variables.reduce((sum, tensor) => sum + tensor.size, 0) / 1e3).toFixed(1)} K`);

  // 預訓練階段 (若 pretrainText 存在且 pretrainIters > 0)
  if (pretrainText && options.pretrainIters > 0) {
    console.log(`\n=== 階段 1: 預訓練 (${options.pretrainFile}) ===`);
    const pretrainData = Int32Array.from(Array.from(pretrainText, (c) => stoi[c]));
    train(model, pretrainData, options.pretrainIters, options.batch_size, options.seq_len, 0.003, '預訓練');
    
    const pretrainPrompt = options.prompt || "<Q>火星的大氣層怎樣？";
    console.log(`\n=== 預訓練後生成結果 (Prompt: '${pretrainPrompt}') ===`);
    console.log(generate(model, pretrainPrompt, encode, decode, options.seq_len, options.gen_len));
  }

  // 微調階段
  console.log(`\n=== 階段 2: 微調 (Finetune: ${options.finetuneFile}) ===`);
  const finetuneData = Int32Array.from(Array.from(finetuneText, (c) => stoi[c]));
  train(model, finetuneData, options.finetuneIters, options.batch_size, options.seq_len, 0.001, '微調');

  const testPrompt = options.prompt || "<Q>火星的大氣層怎樣？";
  console.log(`\n=== 微調後生成結果 (Prompt: '${testPrompt}') ===`);
  console.log(generate(model, testPrompt, encode, decode, options.seq_len, options.gen_len));

  model.dispose();
}

main();
