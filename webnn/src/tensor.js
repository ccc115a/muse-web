// tensor.js — 最小 Tensor：Float32Array + row-major shape + view（零拷貝轉置視角）。
export class Tensor {
  constructor(data, shape) {
    this.d = data;          // Float32Array
    this.sh = shape;        // number[]
  }
  static zeros(...shape) {
    return new Tensor(new Float32Array(numel(shape)), shape);
  }
  static empty(...shape) {
    return new Tensor(new Float32Array(numel(shape)), shape);
  }
  static from(arr, shape) {
    return new Tensor(Float32Array.from(arr), shape);
  }
  get size() { return this.d.length; }
  rows() {  // 最後一維是特徵維時，前導展平的行數
    const n = this.sh[this.sh.length - 1];
    return this.d.length / n;
  }
  feat() { return this.sh[this.sh.length - 1]; }
  view(...shape) {
    if (numel(shape) !== this.d.length) throw new Error("view 元素數不符");
    return new Tensor(this.d, shape);  // 共享 buffer
  }
  clone() {
    return new Tensor(Float32Array.from(this.d), this.sh.slice());
  }
}

export function numel(shape) {
  return shape.reduce((a, b) => a * b, 1);
}
