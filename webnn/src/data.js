// data.js — 字元詞表、編解碼、取 batch（對應 mini_llm_numpy.data）。
export function buildVocab(...texts) {
  const set = new Set(texts.join(""));
  const chars = [...set].sort();
  const stoi = {}, itos = {};
  chars.forEach((ch, i) => { stoi[ch] = i; itos[i] = ch; });
  return { stoi, itos, vocab: chars.length };
}

export function makeCodec(stoi, itos) {
  return {
    encode: (s) => [...s].map((c) => stoi[c]),
    decode: (l) => [...l].map((i) => itos[i]).join(""),
  };
}

export function getBatch(rng, data, batch, seq) {
  // data: number[]；回傳 {x, y}: Int32Array(batch*seq)
  const x = new Int32Array(batch * seq), y = new Int32Array(batch * seq);
  const ix = rng.integers(0, data.length - seq, batch);
  for (let b = 0; b < batch; b++)
    for (let t = 0; t < seq; t++) {
      x[b * seq + t] = data[ix[b] + t];
      y[b * seq + t] = data[ix[b] + t + 1];
    }
  return { x, y };
}
