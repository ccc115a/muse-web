const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 載入模型模組與語料
const tf = require('../tf0');

// 讀取語料建立統一詞表與字元映射
const pretrainText = fs.readFileSync(path.join(__dirname, '../corpus/pretrain.txt'), 'utf8');
const finetuneText = fs.readFileSync(path.join(__dirname, '../corpus/finetune.txt'), 'utf8');
const allText = pretrainText + finetuneText;

const chars = Array.from(new Set(allText)).sort();
const stoi = new Map(chars.map((c, i) => [c, i]));
const itos = new Map(chars.map((c, i) => [i, c]));

const vocabSize = chars.length;
const seqLen = 16;
const dim = 32;
const heads = 4;
const headDim = dim / heads;
const hidden = dim * 4;

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
    this.dim = dim;
    this.heads = heads;
    this.headDim = headDim;
    this.hidden = hidden;
    this.tokenEmbedding = variable([vocabSize, this.dim]);
    this.positionEmbedding = variable([seqLen, this.dim]);
    this.wq = variable([this.dim, this.dim]);
    this.wk = variable([this.dim, this.dim]);
    this.wv = variable([this.dim, this.dim]);
    this.wo = variable([this.dim, this.dim]);
    this.w1 = variable([this.dim, this.hidden]);
    this.w2 = variable([this.hidden, this.dim]);
    this.mask = tf.buffer([seqLen, seqLen], 'float32');
    for (let r = 0; r < seqLen; r++) for (let c = r + 1; c < seqLen; c++) this.mask.set(-1e9, r, c);
    this.mask = this.mask.toTensor();
    this.variables = [this.tokenEmbedding, this.positionEmbedding, this.wq, this.wk, this.wv, this.wo, this.w1, this.w2];
  }

  forwardStep(tokenIds) {
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
    const attnWeights = tf.softmax(scores);
    const attended = tf.matMul(attnWeights, v).transpose([0, 2, 1, 3]).reshape([batchSize * time, this.dim]);
    x = x.add(attended.matMul(this.wo).reshape([batchSize, time, this.dim]));
    const feedForward = rmsNorm(x).reshape([batchSize * time, this.dim]).matMul(this.w1).relu().matMul(this.w2).reshape([batchSize, time, this.dim]);
    x = rmsNorm(x.add(feedForward));
    const logits = x.reshape([batchSize * time, this.dim]).matMul(this.tokenEmbedding, false, true);
    
    return {
      logits,
      attnWeights,
      tokenEmbeddings,
      positionEmbeddings,
      q, k, v
    };
  }
}

const model = new TinyTransformer(vocabSize, seqLen);
const optimizer = tf.train.adam(0.003);

// 簡易單步微調API
app.post('/api/train-step', (req, res) => {
  const { textType = 'pretrain' } = req.body;
  const targetText = textType === 'finetune' ? finetuneText : pretrainText;
  
  if (targetText.length <= seqLen) {
    return res.status(400).json({ error: 'Text too short' });
  }

  const startIdx = Math.floor(Math.random() * (targetText.length - seqLen - 1));
  const chunk = targetText.slice(startIdx, startIdx + seqLen + 1);
  const inputIndices = Array.from(chunk.slice(0, seqLen)).map(c => stoi.get(c) || 0);
  const targetIndices = Array.from(chunk.slice(1, seqLen + 1)).map(c => stoi.get(c) || 0);

  const inputTensor = tf.tensor2d(inputIndices, [1, seqLen], 'int32');
  const targetTensor = tf.tensor2d(targetIndices, [1, seqLen], 'int32');
  const targetOneHot = tf.oneHot(targetTensor, vocabSize).toFloat().reshape([seqLen, vocabSize]);

  let currentLoss = 0;
  optimizer.minimize(() => {
    const { logits } = model.forwardStep(inputTensor);
    const loss = tf.losses.softmaxCrossEntropy(targetOneHot, logits).mean();
    currentLoss = loss.dataSync()[0];
    return loss;
  }, false, model.variables);

  res.json({
    loss: currentLoss,
    sampleChunk: chunk,
    vocabSize
  });
});

// 單步推論與注意力權重導出 API
app.post('/api/infer', (req, res) => {
  const { prompt = '<Q>火星' } = req.body;
  const inputChars = Array.from(prompt).slice(-seqLen);
  const inputIndices = inputChars.map(c => stoi.get(c) || 0);

  while (inputIndices.length < seqLen) {
    inputIndices.unshift(0);
  }

  const inputTensor = tf.tensor2d(inputIndices, [1, seqLen], 'int32');
  const { logits, attnWeights } = model.forwardStep(inputTensor);

  const logitsData = logits.dataSync();
  const lastTokenLogits = Array.from(logitsData.slice((seqLen - 1) * vocabSize, seqLen * vocabSize));

  // 取得最高機率的前 5 個字詞
  const topIndices = lastTokenLogits
    .map((val, idx) => ({ idx, val }))
    .sort((a, b) => b.val - a.val)
    .slice(0, 5)
    .map(item => ({
      char: itos.get(item.idx) || '?',
      logit: item.val
    }));

  // 取得 Attention 矩陣資料 [heads, seqLen, seqLen]
  const rawAttn = attnWeights.dataSync();
  const headAttnMatrices = [];
  const headSize = seqLen * seqLen;

  for (let h = 0; h < heads; h++) {
    const matrix = [];
    for (let r = 0; r < seqLen; r++) {
      const row = [];
      for (let c = 0; c < seqLen; c++) {
        row.push(rawAttn[h * headSize + r * seqLen + c]);
      }
      matrix.push(row);
    }
    headAttnMatrices.push(matrix);
  }

  res.json({
    prompt,
    inputChars,
    topPredictions: topIndices,
    attnMatrices: headAttnMatrices,
    vocabSize,
    dim,
    heads
  });
});

app.listen(PORT, () => {
  console.log(`[LLM Explainer Web Server] 正在運行於: http://localhost:${PORT}`);
});
