// src/model.js — v3 同架構 Transformer（RMSNorm + RoPE rotate-half + SwiGLU + tied embedding）。
// 初始化尺度沿用已驗證的 numpy 版：Linear uniform(-1/sqrt(fin), 1/sqrt(fin))，與 torch 預設一致。
'use strict';
const tf = require('@tensorflow/tfjs-node');

function varUniform(rows, cols) {
  const s = 1 / Math.sqrt(rows);
  return tf.randomUniform([rows, cols], -s, s, 'float32');
}
function varOnes(n) {
  return tf.ones([n], 'float32');
}

class DistillTransformer {
  // cfg: {vocab, d, heads, layers, seq}
  constructor(cfg) {
    this.cfg = cfg;
    const { vocab, d, layers } = cfg;
    this.vars = {};
    this.initVals = {};  // variable() 直接持有 initial tensor（已實證），供訓練循環配對 dispose
    const V = (name, t) => {
      this.vars[name] = tf.variable(t, true, name);
      this.initVals[name] = t;
      return this.vars[name];
    };
    V('emb', varUniform(vocab, d, 'emb'));    V('n_out', varOnes(d, 'n_out'));
    for (let l = 0; l < layers; l++) {
      V(`b${l}q`, varUniform(d, d, `b${l}q`));
      V(`b${l}k`, varUniform(d, d, `b${l}k`));
      V(`b${l}v`, varUniform(d, d, `b${l}v`));
      V(`b${l}o`, varUniform(d, d, `b${l}o`));
      V(`b${l}1`, varUniform(d, 4 * d, `b${l}1`));
      V(`b${l}3`, varUniform(d, 4 * d, `b${l}3`));
      V(`b${l}2`, varUniform(4 * d, d, `b${l}2`));
      V(`b${l}n1`, varOnes(d, `b${l}n1`));
      V(`b${l}n2`, varOnes(d, `b${l}n2`));
    }
    this.varList = Object.values(this.vars);
    // RoPE cos/sin 表（rotate-half 版）：[T, hd/2]
    const hd = d / cfg.heads;
    const hd2 = hd / 2;
    const cosA = [], sinA = [];
    for (let t = 0; t < cfg.seq; t++) {
      for (let i = 0; i < hd2; i++) {
        const a = t / Math.pow(10000, (2 * i) / hd);
        cosA.push(Math.cos(a)); sinA.push(Math.sin(a));
      }
    }
    this.cosTable = tf.tensor2d(cosA, [cfg.seq, hd2]);
    this.sinTable = tf.tensor2d(sinA, [cfg.seq, hd2]);
    // causal mask [seq, seq]
    const m = [];
    for (let i = 0; i < cfg.seq; i++) {
      for (let j = 0; j < cfg.seq; j++) m.push(j > i ? -1e9 : 0);
    }
    this.causalMask = tf.tensor2d(m, [cfg.seq, cfg.seq]);
  }

  rmsNorm(x, w) {
    return x.div(x.square().mean(-1, true).add(1e-6).sqrt()).mul(w);
  }

  // q,k: [B,nh,T,hd]；回傳旋轉後同形狀
  rope(q, k, T) {
    const hd2 = this.cfg.d / this.cfg.heads / 2;
    const cos = this.cosTable.slice([0, 0], [T, hd2]).reshape([1, 1, T, hd2]);
    const sin = this.sinTable.slice([0, 0], [T, hd2]).reshape([1, 1, T, hd2]);
    const rot = (t) => {
      const [a, b] = tf.split(t, 2, -1);
      return tf.concat([a.mul(cos).sub(b.mul(sin)), a.mul(sin).add(b.mul(cos))], -1);
    };
    return [rot(q), rot(k)];
  }

  // idx: int32 [B,T]；回傳 logits [B*T, vocab]
  logits(idx) {
    const { d, heads: nh, layers, seq } = this.cfg;
    const B = idx.shape[0], T = idx.shape[1];
    const hd = d / nh;
    let x = tf.gather(this.vars.emb, idx.reshape([B * T]));  // [R,d]
    for (let l = 0; l < layers; l++) {
      const V = this.vars;
      const h1 = this.rmsNorm(x, V[`b${l}n1`]);
      const q = h1.matMul(V[`b${l}q`]).reshape([B, T, nh, hd]).transpose([0, 2, 1, 3]);
      const k = h1.matMul(V[`b${l}k`]).reshape([B, T, nh, hd]).transpose([0, 2, 1, 3]);
      const v = h1.matMul(V[`b${l}v`]).reshape([B, T, nh, hd]).transpose([0, 2, 1, 3]);
      const [qr, kr] = this.rope(q, k, T);
      const scores = qr.matMul(kr, false, true).div(Math.sqrt(hd))
        .add(this.causalMask.slice([0, 0], [T, T]).reshape([1, 1, T, T]));
      const o = tf.matMul(tf.softmax(scores), v)  // [B,nh,T,hd]
        .transpose([0, 2, 1, 3]).reshape([B * T, d]).matMul(V[`b${l}o`]);
      const xMid = x.add(o);
      const h2 = this.rmsNorm(xMid, V[`b${l}n2`]);
      const a1 = h2.matMul(V[`b${l}1`]);
      const gated = a1.mul(a1.sigmoid()).mul(h2.matMul(V[`b${l}3`]));
      x = xMid.add(gated.matMul(V[`b${l}2`]));
    }
    const h = this.rmsNorm(x, this.vars.n_out);
    return h.matMul(this.vars.emb, false, true);  // tied
  }

  // multinomial 生成（原 model.generate 語義，temperature=1）
  generate(idxArr, maxNew) {
    const { seq, vocab } = this.cfg;
    const out = idxArr.slice();
    for (let s = 0; s < maxNew; s++) {
      const cond = out.slice(-seq);
      const T = cond.length;
      const next = tf.tidy(() => {
        const lg = this.logits(tf.tensor2d([cond], [1, T], 'int32'));
        // multinomial 吃 logits（未歸一化對數機率）；餵 probs 會被再 exp 一次、分佈壓平
        return tf.multinomial(lg.slice([T - 1, 0], [1, vocab]), 1).dataSync()[0];
      });
      out.push(next);
    }
    return out;
  }

  // 權重存檔/讀檔（JSON，對應 .pt；tied 的 emb 只存一份）
  saveWeights(path) {
    const fs = require('fs');
    const data = {};
    for (const k of Object.keys(this.vars)) data[k] = [...this.vars[k].dataSync()];
    fs.writeFileSync(path, JSON.stringify({ cfg: this.cfg, weights: data }));
  }
  loadWeights(path) {
    const fs = require('fs');
    const tf = require('@tensorflow/tfjs-node');
    const { weights } = JSON.parse(fs.readFileSync(path, 'utf8'));
    for (const k of Object.keys(weights)) {
      const t = tf.tensor(weights[k], this.vars[k].shape);
      this.vars[k].assign(t);
      tf.dispose(this.initVals[k]);  // assign 不清舊值；initVals 永遠指向當前內容
      this.initVals[k] = t;
    }
  }
  paramCount() {
    return this.varList.reduce((a, t) => a + t.size, 0);
  }
}

module.exports = { DistillTransformer };
