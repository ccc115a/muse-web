# tf0

`tf0` is a from-scratch, **pure Node.js**, zero-dependency re-implementation
of just the slice of the TensorFlow.js API that `llm-tf.js` needs: dense
tensors, reverse-mode automatic differentiation, and an Adam optimizer.
No native addon, no GPU, no `@tensorflow/tfjs-node` — it's about 600 lines
in `tf0/index.js`.

`llm-tf.js` itself is **unmodified** except for one line:

```diff
- const tf = require('@tensorflow/tfjs-node');
+ const tf = require('./tf0');
```

## Run it

```bash
node llm-tf.js --file sample.txt --iters 1000 --seq_len 16 --batch_size 16 --gen_len 100
```

No `npm install` needed — there are no dependencies.

## How it works

- **Tensors** (`tf0/index.js`, class `Tensor`) wrap a flat typed array
  (`Float32Array`/`Int32Array`) plus a shape, and hold references to the
  parent tensors that produced them and a `gradFn` closure that computes
  local gradients. This builds an ordinary dynamic computation graph, the
  same way PyTorch's autograd or `tf.GradientTape` work.
- **Backward pass** (`computeGrads`) does a topological sort from the loss
  tensor back through the graph, then walks it in reverse, accumulating
  gradients at every node. This correctly handles tensors that are reused
  more than once in the graph — e.g. `tokenEmbedding`, which is used both
  for the embedding lookup *and* the output projection (weight tying),
  gets gradient contributions from both uses summed together.
- **Ops implemented**: `add`, `div`, `square`, `sqrt`, `relu`, `mean`,
  `reshape`, `expandDims`, `tile`, `transpose`, `slice`, batched `matMul`
  (with `transposeA`/`transposeB`, used for both the plain 2D projections
  and the 4D `[batch, heads, time, headDim]` attention matmuls),
  `softmax`, `oneHot`, `softmaxCrossEntropy`, and `multinomial` sampling.
  That's the complete set `llm-tf.js` calls.
- **`tf.tidy` / `tensor.dispose()`** are effectively no-ops (beyond
  dropping references) — plain V8 garbage collection handles memory at
  the sizes this toy model runs at, so there's no need to replicate
  TensorFlow.js's manual tensor-lifetime bookkeeping.
- **Adam optimizer** (`tf.train.adam`) is a standard implementation with
  bias-corrected moment estimates, keyed off each variable tensor's id.

## Performance notes

This is pure JS looping over typed arrays — no BLAS, no SIMD, no GPU. At
the model's default tiny size (`dim=32`, 4 heads, `hidden=128`), that's
enough: 1000 iterations at the script's defaults
(`seq_len=16, batch_size=16`) run in roughly a minute on a typical machine.
It will not scale to real-sized transformers — the M x K x N triple loops
in `matMulForward`/`matMulBackward` are the hot path — but for the toy
character-level demo `llm-tf.js` implements, it's plenty fast and needs
no native build step at all, which is handy in environments where
`@tensorflow/tfjs-node`'s native binding can be a pain to install.

## Files

- `tf0/index.js` — the library.
- `llm-tf.js` — your original script, with the one-line `require` swap.
- `sample.txt` — a small sample corpus (classical Chinese poetry) to try
  it with immediately.
