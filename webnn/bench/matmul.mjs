// bench/matmul.mjs — 我們的分塊 GEMM vs tf.js CPU 後端（同形狀、同機器）。
// 形狀取自 mini-LLM 實際熱點：FFN 上投影 (B*T=1024, d=128)@(128, 512)。
import * as K from "../src/kernels.js";

const M = 1024, Kc = 128, N = 512, IT = 20;
const A = new Float32Array(M * Kc), B = new Float32Array(Kc * N), C = new Float32Array(M * N);
let s = 0.123;
for (let i = 0; i < A.length; i++) { s = (s * 16807) % 1; A[i] = s - 0.5; }
for (let i = 0; i < B.length; i++) { s = (s * 16807) % 1; B[i] = s - 0.5; }

K.gemm(C, A, B, M, N, Kc);  // warmup
let t0 = performance.now();
for (let i = 0; i < IT; i++) K.gemm(C, A, B, M, N, Kc);
const ours = (performance.now() - t0) / IT;
const gflops = (2 * M * N * Kc) / 1e9;
console.log(`webnn gemm : ${ours.toFixed(1)} ms/iter (${(gflops / (ours / 1e3)).toFixed(2)} GFLOPS)`);

const tf = await import("@tensorflow/tfjs");
await tf.setBackend("cpu");
const tA = tf.tensor2d(A, [M, Kc]), tB = tf.tensor2d(B, [Kc, N]);
tf.matMul(tA, tB).dataSync();  // warmup
t0 = performance.now();
for (let i = 0; i < IT; i++) tf.matMul(tA, tB).dataSync();
const theirs = (performance.now() - t0) / IT;
console.log(`tfjs cpu  : ${theirs.toFixed(1)} ms/iter (${(gflops / (theirs / 1e3)).toFixed(2)} GFLOPS)`);
console.log(`比值（tfjs/ours）：${(theirs / ours).toFixed(2)}x ${ours <= theirs ? "✅ 我們的快（或打平）" : "⚠️ tfjs 快"}`);
// 正確性抽查
const tC = tf.matMul(tA, tB).dataSync();
let w = 0;
for (let i = 0; i < 1000; i += 7) w = Math.max(w, Math.abs(C[i] - tC[i]) / Math.max(1e-6, Math.abs(C[i]) + Math.abs(tC[i])));
console.log(`抽查一致性 max-rel-err: ${w.toExponential(2)}`);
