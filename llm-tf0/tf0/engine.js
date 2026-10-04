'use strict';

const { Tensor, TensorBuffer, prod, stridesFor, sameShape } = require('./tensor');

function broadcastShapes(shapeA, shapeB) {
  const rank = Math.max(shapeA.length, shapeB.length);
  const a = new Array(rank - shapeA.length).fill(1).concat(shapeA);
  const b = new Array(rank - shapeB.length).fill(1).concat(shapeB);
  const out = new Array(rank);
  for (let i = 0; i < rank; i++) {
    const da = a[i], db = b[i];
    if (da !== db && da !== 1 && db !== 1) {
      throw new Error(`tf0: cannot broadcast shapes ${JSON.stringify(shapeA)} and ${JSON.stringify(shapeB)}`);
    }
    out[i] = Math.max(da, db);
  }
  return { aPad: a, bPad: b, outShape: out };
}

function reduceGradTo(gradData, fromShape, toShape) {
  const rank = fromShape.length;
  const tPad = new Array(rank - toShape.length).fill(1).concat(toShape);
  const outSize = prod(toShape) || 1;
  const out = new Float32Array(outSize);
  const fromStrides = stridesFor(fromShape);
  const outStrides = stridesFor(tPad);
  const size = gradData.length;
  for (let flat = 0; flat < size; flat++) {
    let rem = flat;
    let outIdx = 0;
    for (let d = 0; d < rank; d++) {
      const coord = Math.floor(rem / fromStrides[d]);
      rem -= coord * fromStrides[d];
      const oc = tPad[d] === 1 ? 0 : coord;
      outIdx += oc * outStrides[d];
    }
    out[outIdx] += gradData[flat];
  }
  return out;
}

function broadcastBinaryForward(aData, aShape, bData, bShape, fn) {
  const { aPad, bPad, outShape } = broadcastShapes(aShape, bShape);
  const outSize = prod(outShape);
  const out = new Float32Array(outSize);
  const aStrides = stridesFor(aPad);
  const bStrides = stridesFor(bPad);
  const outStrides = stridesFor(outShape);
  const rank = outShape.length;
  for (let flat = 0; flat < outSize; flat++) {
    let rem = flat;
    let aIdx = 0, bIdx = 0;
    for (let d = 0; d < rank; d++) {
      const coord = Math.floor(rem / outStrides[d]);
      rem -= coord * outStrides[d];
      aIdx += (aPad[d] === 1 ? 0 : coord) * aStrides[d];
      bIdx += (bPad[d] === 1 ? 0 : coord) * bStrides[d];
    }
    out[flat] = fn(aData[aIdx], bData[bIdx]);
  }
  return { data: out, shape: outShape };
}

function divBackwardFull(gradOut, outShape, aData, aShape, bData, bShape) {
  const { aPad, bPad } = broadcastShapes(aShape, bShape);
  const aStrides = stridesFor(aPad);
  const bStrides = stridesFor(bPad);
  const outStrides = stridesFor(outShape);
  const rank = outShape.length;
  const size = gradOut.length;
  const dAFull = new Float32Array(size);
  const dBFull = new Float32Array(size);
  for (let flat = 0; flat < size; flat++) {
    let rem = flat;
    let aIdx = 0, bIdx = 0;
    for (let d = 0; d < rank; d++) {
      const coord = Math.floor(rem / outStrides[d]);
      rem -= coord * outStrides[d];
      aIdx += (aPad[d] === 1 ? 0 : coord) * aStrides[d];
      bIdx += (bPad[d] === 1 ? 0 : coord) * bStrides[d];
    }
    const bv = bData[bIdx];
    dAFull[flat] = gradOut[flat] / bv;
    dBFull[flat] = -gradOut[flat] * aData[aIdx] / (bv * bv);
  }
  return [reduceGradTo(dAFull, outShape, aShape), reduceGradTo(dBFull, outShape, bShape)];
}

function tileForward(data, shape, reps) {
  const outShape = shape.map((d, i) => d * reps[i]);
  const outSize = prod(outShape);
  const out = new Float32Array(outSize);
  const inStrides = stridesFor(shape);
  const outStrides = stridesFor(outShape);
  const rank = shape.length;
  for (let flat = 0; flat < outSize; flat++) {
    let rem = flat;
    let inIdx = 0;
    for (let d = 0; d < rank; d++) {
      const coord = Math.floor(rem / outStrides[d]);
      rem -= coord * outStrides[d];
      const inCoord = shape[d] === 1 ? 0 : coord % shape[d];
      inIdx += inCoord * inStrides[d];
    }
    out[flat] = data[inIdx];
  }
  return { data: out, shape: outShape };
}

function tileBackward(gradOut, shape, reps) {
  const outShape = shape.map((d, i) => d * reps[i]);
  const inSize = prod(shape);
  const gradIn = new Float32Array(inSize);
  const inStrides = stridesFor(shape);
  const outStrides = stridesFor(outShape);
  const rank = shape.length;
  const outSize = prod(outShape);
  for (let flat = 0; flat < outSize; flat++) {
    let rem = flat;
    let inIdx = 0;
    for (let d = 0; d < rank; d++) {
      const coord = Math.floor(rem / outStrides[d]);
      rem -= coord * outStrides[d];
      const inCoord = coord % shape[d];
      inIdx += inCoord * inStrides[d];
    }
    gradIn[inIdx] += gradOut[flat];
  }
  return gradIn;
}

function transposeForward(data, shape, perm) {
  const rank = shape.length;
  const outShape = perm.map((p) => shape[p]);
  const inStrides = stridesFor(shape);
  const outStrides = stridesFor(outShape);
  const size = data.length;
  const out = new Float32Array(size);
  const coord = new Array(rank);
  for (let flat = 0; flat < size; flat++) {
    let rem = flat;
    for (let d = 0; d < rank; d++) {
      coord[d] = Math.floor(rem / outStrides[d]);
      rem -= coord[d] * outStrides[d];
    }
    let inIdx = 0;
    for (let d = 0; d < rank; d++) inIdx += coord[d] * inStrides[perm[d]];
    out[flat] = data[inIdx];
  }
  return { data: out, shape: outShape };
}

function sliceForward(data, shape, begin, size) {
  const rank = shape.length;
  const inStrides = stridesFor(shape);
  const outStrides = stridesFor(size);
  const outSize = prod(size);
  const out = new Float32Array(outSize);
  const coord = new Array(rank);
  for (let flat = 0; flat < outSize; flat++) {
    let rem = flat;
    for (let d = 0; d < rank; d++) {
      coord[d] = Math.floor(rem / outStrides[d]);
      rem -= coord[d] * outStrides[d];
    }
    let inIdx = 0;
    for (let d = 0; d < rank; d++) inIdx += (coord[d] + begin[d]) * inStrides[d];
    out[flat] = data[inIdx];
  }
  return { data: out, shape: size.slice() };
}

function sliceBackward(gradOut, shape, begin, size) {
  const rank = shape.length;
  const inStrides = stridesFor(shape);
  const outStrides = stridesFor(size);
  const outSize = prod(size);
  const gradIn = new Float32Array(prod(shape));
  const coord = new Array(rank);
  for (let flat = 0; flat < outSize; flat++) {
    let rem = flat;
    for (let d = 0; d < rank; d++) {
      coord[d] = Math.floor(rem / outStrides[d]);
      rem -= coord[d] * outStrides[d];
    }
    let inIdx = 0;
    for (let d = 0; d < rank; d++) inIdx += (coord[d] + begin[d]) * inStrides[d];
    gradIn[inIdx] += gradOut[flat];
  }
  return gradIn;
}

function meanForward(data, shape, axis, keepDims) {
  if (axis === undefined || axis === null) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return { data: new Float32Array([sum / data.length]), shape: [] };
  }
  const rank = shape.length;
  const ax = axis < 0 ? axis + rank : axis;
  const axisSize = shape[ax];
  const strides = stridesFor(shape);
  const reducedShape = shape.filter((_, i) => i !== ax);
  const reducedStrides = stridesFor(reducedShape);
  const outSize = prod(reducedShape) || 1;
  const sums = new Float32Array(outSize);
  const coord = new Array(rank);
  for (let flat = 0; flat < data.length; flat++) {
    let rem = flat;
    for (let d = 0; d < rank; d++) {
      coord[d] = Math.floor(rem / strides[d]);
      rem -= coord[d] * strides[d];
    }
    let outIdx = 0, od = 0;
    for (let d = 0; d < rank; d++) {
      if (d === ax) continue;
      outIdx += coord[d] * reducedStrides[od];
      od++;
    }
    sums[outIdx] += data[flat];
  }
  for (let i = 0; i < sums.length; i++) sums[i] /= axisSize;
  const finalShape = keepDims ? shape.map((d, i) => (i === ax ? 1 : d)) : reducedShape;
  return { data: sums, shape: finalShape };
}

function meanBackward(gradOut, shape, axis, keepDims) {
  const size = prod(shape);
  const gradIn = new Float32Array(size);
  if (axis === undefined || axis === null) {
    const g = gradOut[0] / size;
    gradIn.fill(g);
    return gradIn;
  }
  const rank = shape.length;
  const ax = axis < 0 ? axis + rank : axis;
  const axisSize = shape[ax];
  const strides = stridesFor(shape);
  const reducedShape = shape.filter((_, i) => i !== ax);
  const reducedStrides = stridesFor(reducedShape);
  const coord = new Array(rank);
  for (let flat = 0; flat < size; flat++) {
    let rem = flat;
    for (let d = 0; d < rank; d++) {
      coord[d] = Math.floor(rem / strides[d]);
      rem -= coord[d] * strides[d];
    }
    let outIdx = 0, od = 0;
    for (let d = 0; d < rank; d++) {
      if (d === ax) continue;
      outIdx += coord[d] * reducedStrides[od];
      od++;
    }
    gradIn[flat] = gradOut[outIdx] / axisSize;
  }
  return gradIn;
}

function oneHotForward(indicesData, indicesShape, depth) {
  const size = indicesData.length;
  const out = new Float32Array(size * depth);
  for (let i = 0; i < size; i++) {
    const idx = indicesData[i];
    if (idx >= 0 && idx < depth) out[i * depth + idx] = 1;
  }
  return { data: out, shape: [...indicesShape, depth] };
}

function softmaxForward(data, shape, axis) {
  const rank = shape.length;
  const ax = axis < 0 ? axis + rank : axis;
  const strides = stridesFor(shape);
  const axisSize = shape[ax];
  const axisStride = strides[ax];
  const reducedShape = shape.filter((_, i) => i !== ax);
  const reducedStrides = stridesFor(reducedShape);
  const outerSize = data.length / axisSize;
  const out = new Float32Array(data.length);
  for (let outIdx = 0; outIdx < outerSize; outIdx++) {
    let rem = outIdx, base = 0, od = 0;
    for (let d = 0; d < rank; d++) {
      if (d === ax) continue;
      const coord = Math.floor(rem / reducedStrides[od]);
      rem -= coord * reducedStrides[od];
      base += coord * strides[d];
      od++;
    }
    let maxVal = -Infinity;
    for (let a = 0; a < axisSize; a++) {
      const v = data[base + a * axisStride];
      if (v > maxVal) maxVal = v;
    }
    let sum = 0;
    for (let a = 0; a < axisSize; a++) {
      const e = Math.exp(data[base + a * axisStride] - maxVal);
      out[base + a * axisStride] = e;
      sum += e;
    }
    for (let a = 0; a < axisSize; a++) out[base + a * axisStride] /= sum;
  }
  return { data: out, shape: shape.slice() };
}

function softmaxBackward(gradOut, outData, shape, axis) {
  const rank = shape.length;
  const ax = axis < 0 ? axis + rank : axis;
  const strides = stridesFor(shape);
  const axisSize = shape[ax];
  const axisStride = strides[ax];
  const reducedShape = shape.filter((_, i) => i !== ax);
  const reducedStrides = stridesFor(reducedShape);
  const outerSize = gradOut.length / axisSize;
  const gradIn = new Float32Array(gradOut.length);
  for (let outIdx = 0; outIdx < outerSize; outIdx++) {
    let rem = outIdx, base = 0, od = 0;
    for (let d = 0; d < rank; d++) {
      if (d === ax) continue;
      const coord = Math.floor(rem / reducedStrides[od]);
      rem -= coord * reducedStrides[od];
      base += coord * strides[d];
      od++;
    }
    let dot = 0;
    for (let a = 0; a < axisSize; a++) dot += gradOut[base + a * axisStride] * outData[base + a * axisStride];
    for (let a = 0; a < axisSize; a++) {
      const idx = base + a * axisStride;
      gradIn[idx] = outData[idx] * (gradOut[idx] - dot);
    }
  }
  return gradIn;
}

function matMulForward(aData, aShape, bData, bShape, transposeA, transposeB) {
  const aBatch = aShape.slice(0, -2);
  const bBatch = bShape.slice(0, -2);
  const batchDims = aBatch.length >= bBatch.length ? aBatch : bBatch;
  const batchSize = prod(batchDims) || 1;
  const [aRows, aCols] = aShape.slice(-2);
  const [bRows, bCols] = bShape.slice(-2);
  const M = transposeA ? aCols : aRows;
  const K = transposeA ? aRows : aCols;
  const N = transposeB ? bRows : bCols;
  const outShape = [...batchDims, M, N];
  const out = new Float32Array(batchSize * M * N);
  const aStride = aRows * aCols, bStride = bRows * bCols;
  for (let bi = 0; bi < batchSize; bi++) {
    const aOff = bi * aStride, bOff = bi * bStride, oOff = bi * M * N;
    for (let i = 0; i < M; i++) {
      for (let j = 0; j < N; j++) {
        let sum = 0;
        for (let k = 0; k < K; k++) {
          const aIdx = transposeA ? aOff + k * aCols + i : aOff + i * aCols + k;
          const bIdx = transposeB ? bOff + j * bCols + k : bOff + k * bCols + j;
          sum += aData[aIdx] * bData[bIdx];
        }
        out[oOff + i * N + j] = sum;
      }
    }
  }
  return { data: out, shape: outShape };
}

function matMulBackward(gradOut, outShape, aData, aShape, bData, bShape, transposeA, transposeB) {
  const aBatch = aShape.slice(0, -2);
  const bBatch = bShape.slice(0, -2);
  const batchDims = aBatch.length >= bBatch.length ? aBatch : bBatch;
  const batchSize = prod(batchDims) || 1;
  const [aRows, aCols] = aShape.slice(-2);
  const [bRows, bCols] = bShape.slice(-2);
  const M = transposeA ? aCols : aRows;
  const K = transposeA ? aRows : aCols;
  const N = transposeB ? bRows : bCols;
  const aStride = aRows * aCols, bStride = bRows * bCols;
  const dA = new Float32Array(aData.length);
  const dB = new Float32Array(bData.length);
  for (let bi = 0; bi < batchSize; bi++) {
    const aOff = bi * aStride, bOff = bi * bStride, oOff = bi * M * N;
    for (let i = 0; i < M; i++) {
      for (let k = 0; k < K; k++) {
        let sum = 0;
        for (let j = 0; j < N; j++) {
          const bIdx = transposeB ? bOff + j * bCols + k : bOff + k * bCols + j;
          sum += gradOut[oOff + i * N + j] * bData[bIdx];
        }
        const aIdx = transposeA ? aOff + k * aCols + i : aOff + i * aCols + k;
        dA[aIdx] += sum;
      }
    }
    for (let k = 0; k < K; k++) {
      for (let j = 0; j < N; j++) {
        let sum = 0;
        for (let i = 0; i < M; i++) {
          const aIdx = transposeA ? aOff + k * aCols + i : aOff + i * aCols + k;
          sum += aData[aIdx] * gradOut[oOff + i * N + j];
        }
        const bIdx = transposeB ? bOff + j * bCols + k : bOff + k * bCols + j;
        dB[bIdx] += sum;
      }
    }
  }
  return [dA, dB];
}

// 動態綁定 Tensor 原型方法以避免循環依賴
Tensor.prototype.toFloat = function() {
  if (this.dtype === 'float32') return this;
  const data = Float32Array.from(this.data);
  return new Tensor(data, this.shape.slice(), 'float32', [this], (g) => [g]);
};

Tensor.prototype.reshape = function(newShape) {
  const size = prod(newShape);
  if (size !== this.size) {
    throw new Error(`tf0: cannot reshape tensor of size ${this.size} into shape ${JSON.stringify(newShape)}`);
  }
  const gradFn = (gradOut) => [gradOut];
  return new Tensor(this.data, newShape.slice(), 'float32', [this], gradFn);
};

Tensor.prototype.expandDims = function(axis) {
  const newShape = this.shape.slice();
  const ax = axis < 0 ? axis + newShape.length + 1 : axis;
  newShape.splice(ax, 0, 1);
  return this.reshape(newShape);
};

Tensor.prototype.tile = function(reps) {
  const { data, shape } = tileForward(this.data, this.shape, reps);
  const gradFn = (gradOut) => [tileBackward(gradOut, this.shape, reps)];
  return new Tensor(data, shape, 'float32', [this], gradFn);
};

Tensor.prototype.transpose = function(perm) {
  const { data, shape } = transposeForward(this.data, this.shape, perm);
  const invPerm = new Array(perm.length);
  perm.forEach((p, i) => (invPerm[p] = i));
  const gradFn = (gradOut) => [transposeForward(gradOut, shape, invPerm).data];
  return new Tensor(data, shape, 'float32', [this], gradFn);
};

Tensor.prototype.slice = function(begin, size) {
  const { data, shape } = sliceForward(this.data, this.shape, begin, size);
  const gradFn = (gradOut) => [sliceBackward(gradOut, this.shape, begin, size)];
  return new Tensor(data, shape, 'float32', [this], gradFn);
};

Tensor.prototype.square = function() {
  const n = this.size;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = this.data[i] * this.data[i];
  const gradFn = (gradOut) => {
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) g[i] = gradOut[i] * 2 * this.data[i];
    return [g];
  };
  return new Tensor(data, this.shape.slice(), 'float32', [this], gradFn);
};

Tensor.prototype.sqrt = function() {
  const n = this.size;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.sqrt(this.data[i]);
  const gradFn = (gradOut) => {
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) g[i] = gradOut[i] * 0.5 / data[i];
    return [g];
  };
  return new Tensor(data, this.shape.slice(), 'float32', [this], gradFn);
};

Tensor.prototype.relu = function() {
  const n = this.size;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = this.data[i] > 0 ? this.data[i] : 0;
  const gradFn = (gradOut) => {
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) g[i] = this.data[i] > 0 ? gradOut[i] : 0;
    return [g];
  };
  return new Tensor(data, this.shape.slice(), 'float32', [this], gradFn);
};

Tensor.prototype.mean = function(axis, keepDims) {
  const { data, shape } = meanForward(this.data, this.shape, axis, keepDims);
  const gradFn = (gradOut) => [meanBackward(gradOut, this.shape, axis, keepDims)];
  return new Tensor(data, shape, 'float32', [this], gradFn);
};

Tensor.prototype.add = function(other) {
  const bIsTensor = other instanceof Tensor;
  const bData = bIsTensor ? other.data : new Float32Array([other]);
  const bShape = bIsTensor ? other.shape : [];
  const { data, shape } = broadcastBinaryForward(this.data, this.shape, bData, bShape, (x, y) => x + y);
  const parents = bIsTensor ? [this, other] : [this];
  const gradFn = (gradOut) => {
    const gA = reduceGradTo(gradOut, shape, this.shape);
    if (!bIsTensor) return [gA];
    const gB = reduceGradTo(gradOut, shape, other.shape);
    return [gA, gB];
  };
  return new Tensor(data, shape, 'float32', parents, gradFn);
};

Tensor.prototype.div = function(other) {
  const bIsTensor = other instanceof Tensor;
  const bData = bIsTensor ? other.data : new Float32Array([other]);
  const bShape = bIsTensor ? other.shape : [];
  const { data, shape } = broadcastBinaryForward(this.data, this.shape, bData, bShape, (x, y) => x / y);
  const parents = bIsTensor ? [this, other] : [this];
  const gradFn = (gradOut) => {
    const [gA, gB] = divBackwardFull(gradOut, shape, this.data, this.shape, bData, bShape);
    return bIsTensor ? [gA, gB] : [gA];
  };
  return new Tensor(data, shape, 'float32', parents, gradFn);
};

Tensor.prototype.matMul = function(other, transposeA, transposeB) {
  transposeA = !!transposeA;
  transposeB = !!transposeB;
  const { data, shape } = matMulForward(this.data, this.shape, other.data, other.shape, transposeA, transposeB);
  const gradFn = (gradOut) =>
    matMulBackward(gradOut, shape, this.data, this.shape, other.data, other.shape, transposeA, transposeB);
  return new Tensor(data, shape, 'float32', [this, other], gradFn);
};

Tensor.prototype.softmax = function(axis) {
  axis = axis === undefined ? -1 : axis;
  const { data, shape } = softmaxForward(this.data, this.shape, axis);
  const gradFn = (gradOut) => [softmaxBackward(gradOut, data, this.shape, axis)];
  return new Tensor(data, shape, 'float32', [this], gradFn);
};

Tensor.prototype.softmaxCrossEntropyWith = function(labels) {
  const [N, C] = this.shape;
  const { data: probData } = softmaxForward(this.data, this.shape, -1);
  const lossData = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let c = 0; c < C; c++) {
      const p = Math.max(probData[i * C + c], 1e-12);
      s += labels.data[i * C + c] * Math.log(p);
    }
    lossData[i] = -s;
  }
  const gradFn = (gradOut) => {
    const gLogits = new Float32Array(N * C);
    for (let i = 0; i < N; i++) {
      const go = gradOut[i];
      for (let c = 0; c < C; c++) {
        gLogits[i * C + c] = go * (probData[i * C + c] - labels.data[i * C + c]);
      }
    }
    return [gLogits, null];
  };
  return new Tensor(lossData, [N], 'float32', [this, labels], gradFn);
};

Tensor.prototype.multinomial = function(numSamples) {
  const [rows, vocab] = this.shape;
  const out = new Int32Array(rows * numSamples);
  for (let r = 0; r < rows; r++) {
    let maxV = -Infinity;
    for (let c = 0; c < vocab; c++) maxV = Math.max(maxV, this.data[r * vocab + c]);
    const exps = new Float64Array(vocab);
    let sum = 0;
    for (let c = 0; c < vocab; c++) {
      exps[c] = Math.exp(this.data[r * vocab + c] - maxV);
      sum += exps[c];
    }
    for (let c = 0; c < vocab; c++) exps[c] /= sum;
    for (let s = 0; s < numSamples; s++) {
      const rnd = Math.random();
      let acc = 0, chosen = vocab - 1;
      for (let c = 0; c < vocab; c++) {
        acc += exps[c];
        if (rnd <= acc) {
          chosen = c;
          break;
        }
      }
      out[r * numSamples + s] = chosen;
    }
  }
  return new Tensor(out, [rows, numSamples], 'int32');
};

function computeGrads(root, varList) {
  const order = [];
  const visited = new Set();
  (function visit(node) {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    for (const p of node.parents) {
      if (p instanceof Tensor) visit(p);
    }
    order.push(node);
  })(root);

  const gradMap = new Map();
  gradMap.set(root.id, new Float32Array(root.size).fill(1));

  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i];
    const grad = gradMap.get(node.id);
    if (!grad || !node.gradFn) continue;
    const parentGrads = node.gradFn(grad);
    for (let p = 0; p < node.parents.length; p++) {
      const parent = node.parents[p];
      if (!(parent instanceof Tensor)) continue;
      const pg = parentGrads[p];
      if (pg == null) continue;
      let existing = gradMap.get(parent.id);
      if (!existing) {
        existing = new Float32Array(parent.size);
        gradMap.set(parent.id, existing);
      }
      for (let j = 0; j < existing.length; j++) existing[j] += pg[j];
    }
  }

  return varList.map((v) => gradMap.get(v.id) || new Float32Array(v.size));
}

module.exports = {
  computeGrads,
  oneHotForward
};
