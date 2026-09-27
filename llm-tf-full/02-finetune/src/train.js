// src/train.js — 手寫 AdamW（decoupled decay，1-D 跳過）+ 全域梯度裁剪 + 單步訓練。
// 不用 tf.train.adam：它無 weight-decay 選項，且 grad 名映射難接裁剪。
//
// 記憶體紀律（tfjs 不會自動清這些，800 步會 OOM）:
// - tidy 內算出的中間 tensor 自動清；要帶出 tidy 的一律 tf.keep()
// - variable.assign() 不會 dispose 舊值 → assign 前手動 dispose 舊值
'use strict';
const tf = require('@tensorflow/tfjs-node');

const B1 = 0.9, B2 = 0.95, EPS = 1e-8, WD = 0.01, CLIP = 1.0;

function initState(varList, initVals) {
  const st = {};
  for (const v of varList) {
    st[v.name] = { m: tf.zerosLike(v), v: tf.zerosLike(v), p: initVals[v.name] };
  }
  return st;
}

function ceLoss(model, xb, yb, B, T) {
  const logits = model.logits(xb);  // [R, vocab]
  const target = tf.oneHot(yb.reshape([B * T]), model.cfg.vocab);
  return tf.losses.softmaxCrossEntropy(target, logits).mean();
}

// 一步訓練，回傳 {loss, gradNorm}（plain object）。assign/dispose 全手動配平。
function trainStep(model, state, xbArr, ybArr, B, T, lr, step) {
  const out = tf.tidy(() => {
    const xb = tf.tensor2d(xbArr, [B, T], 'int32');
    const yb = tf.tensor2d(ybArr, [B, T], 'int32');
    const { value, grads } = tf.variableGrads(() => ceLoss(model, xb, yb, B, T), model.varList);
    const gList = model.varList.map((v) => grads[v.name] || tf.zerosLike(v));
    const total = tf.addN(gList.map((g) => g.square().sum()));
    const norm = Math.sqrt(total.dataSync()[0]);
    const scale = Math.min(1, CLIP / (norm + 1e-12));
    const c1 = 1 - Math.pow(B1, step), c2 = 1 - Math.pow(B2, step);
    const updates = model.varList.map((v, i) => {
      const g = gList[i].mul(scale);
      const st = state[v.name];
      const newM = st.m.mul(B1).add(g.mul(1 - B1));
      const newV = st.v.mul(B2).add(g.square().mul(1 - B2));
      let upd = newM.div(c1).div(newV.div(c2).sqrt().add(EPS));
      if (v.shape.length > 1) upd = upd.add(v.mul(WD));
      const newVal = v.sub(upd.mul(lr));
      v.assign(tf.keep(newVal));
      tf.dispose(st.p);   // assign 不清舊值：先換指向再丟上一步的（已實證安全）
      st.p = newVal;
      tf.dispose(st.m);
      tf.dispose(st.v);
      st.m = tf.keep(newM);
      st.v = tf.keep(newV);
    });
    return { loss: value.dataSync()[0], gradNorm: norm };
  });
  return out;
}

module.exports = { initState, trainStep, B1, B2, EPS, WD, CLIP };
