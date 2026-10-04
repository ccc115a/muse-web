'use strict';

// ---------------------------------------------------------------------------
// Low level shape / array helpers & Tensor class
// ---------------------------------------------------------------------------

function prod(shape) {
  let p = 1;
  for (let i = 0; i < shape.length; i++) p *= shape[i];
  return p;
}

function stridesFor(shape) {
  const s = new Array(shape.length);
  let acc = 1;
  for (let i = shape.length - 1; i >= 0; i--) {
    s[i] = acc;
    acc *= shape[i];
  }
  return s;
}

function sameShape(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

let _nextId = 1;

class Tensor {
  constructor(data, shape, dtype, parents, gradFn, isVariable) {
    this.data = data;
    this.shape = shape;
    this.dtype = dtype || 'float32';
    this.size = prod(shape);
    this.parents = parents || [];
    this.gradFn = gradFn || null;
    this.isVariable = !!isVariable;
    this.id = _nextId++;
  }

  dataSync() {
    return this.data;
  }

  dispose() {
    this.data = null;
    this.parents = [];
    this.gradFn = null;
  }
}

class TensorBuffer {
  constructor(shape, dtype) {
    this.shape = shape.slice();
    this.dtype = dtype || 'float32';
    const size = prod(shape);
    this.data = this.dtype === 'int32' ? new Int32Array(size) : new Float32Array(size);
    this.strides = stridesFor(shape);
  }

  set(value, ...idx) {
    let flat = 0;
    for (let d = 0; d < idx.length; d++) flat += idx[d] * this.strides[d];
    this.data[flat] = value;
  }

  toTensor() {
    return new Tensor(this.data, this.shape.slice(), this.dtype);
  }
}

module.exports = {
  Tensor,
  TensorBuffer,
  prod,
  stridesFor,
  sameShape
};
