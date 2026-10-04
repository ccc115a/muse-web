'use strict';

const { Tensor, TensorBuffer, prod, stridesFor, sameShape } = require('./tensor');
const { computeGrads, oneHotForward } = require('./engine');
const storage = require('./storage');

const tf = {};

tf.Tensor = Tensor;

tf.tensor1d = (data, dtype) => {
  dtype = dtype || 'float32';
  const arr = dtype === 'int32' ? Int32Array.from(data) : Float32Array.from(data);
  return new Tensor(arr, [arr.length], dtype);
};

tf.tensor2d = (data, shape, dtype) => {
  dtype = dtype || 'float32';
  const arr = dtype === 'int32' ? Int32Array.from(data) : Float32Array.from(data);
  return new Tensor(arr, shape.slice(), dtype);
};

tf.variable = (t) => new Tensor(t.data, t.shape.slice(), 'float32', [], null, true);

tf.randomNormal = (shape, mean, stddev, dtype) => {
  mean = mean === undefined ? 0 : mean;
  stddev = stddev === undefined ? 1 : stddev;
  const size = prod(shape);
  const data = new Float32Array(size);
  for (let i = 0; i < size; i += 2) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const mag = Math.sqrt(-2 * Math.log(u));
    data[i] = mean + stddev * mag * Math.cos(2 * Math.PI * v);
    if (i + 1 < size) data[i + 1] = mean + stddev * mag * Math.sin(2 * Math.PI * v);
  }
  return new Tensor(data, shape.slice(), dtype || 'float32');
};

tf.buffer = (shape, dtype) => new TensorBuffer(shape, dtype);

tf.range = (start, stop, step, dtype) => {
  step = step === undefined ? 1 : step;
  dtype = dtype || 'float32';
  const vals = [];
  for (let v = start; v < stop; v += step) vals.push(v);
  const arr = dtype === 'int32' ? Int32Array.from(vals) : Float32Array.from(vals);
  return new Tensor(arr, [vals.length], dtype);
};

tf.oneHot = (indices, depth) => {
  const { data, shape } = oneHotForward(indices.data, indices.shape, depth);
  return new Tensor(data, shape, 'float32');
};

tf.add = (a, b) => a.add(b);
tf.matMul = (a, b, transposeA, transposeB) => a.matMul(b, transposeA, transposeB);
tf.softmax = (x, axis) => x.softmax(axis);
tf.multinomial = (logits, numSamples) => logits.multinomial(numSamples);
tf.getBackend = () => 'tf0-pure-js';
tf.tidy = (fn) => fn();

tf.losses = {
  softmaxCrossEntropy: (labels, logits) => logits.softmaxCrossEntropyWith(labels),
};

tf.train = {
  adam: (learningRate, beta1, beta2, epsilon) => {
    learningRate = learningRate === undefined ? 0.001 : learningRate;
    beta1 = beta1 === undefined ? 0.9 : beta1;
    beta2 = beta2 === undefined ? 0.999 : beta2;
    epsilon = epsilon === undefined ? 1e-8 : epsilon;
    const state = new Map();
    let t = 0;
    return {
      minimize(lossFn, returnCost, varList) {
        const loss = lossFn();
        const grads = computeGrads(loss, varList);
        t++;
        const biasCorrected = learningRate * Math.sqrt(1 - Math.pow(beta2, t)) / (1 - Math.pow(beta1, t));
        for (let i = 0; i < varList.length; i++) {
          const v = varList[i];
          let s = state.get(v.id);
          if (!s) {
            s = { m: new Float32Array(v.size), v: new Float32Array(v.size) };
            state.set(v.id, s);
          }
          const g = grads[i];
          for (let j = 0; j < v.size; j++) {
            s.m[j] = beta1 * s.m[j] + (1 - beta1) * g[j];
            s.v[j] = beta2 * s.v[j] + (1 - beta2) * g[j] * g[j];
            v.data[j] -= biasCorrected * s.m[j] / (Math.sqrt(s.v[j]) + epsilon);
          }
        }
        if (!returnCost) {
          loss.dispose();
          return null;
        }
        return loss;
      },
    };
  },
};

tf.saveWeights = storage.saveWeights;
tf.loadWeights = storage.loadWeights;
tf.save = storage.save;
tf.load = storage.load;

module.exports = tf;
