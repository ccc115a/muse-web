# Cell 2 — 建詞表 + encode/decode + 取 batch（對應原 pretrain.py §1）
import json
import numpy as np

all_chars = sorted(list(set(pretrain_text + finetune_text)))
vocab_size = len(all_chars)
print(f"詞表大小: {vocab_size} 字元")

stoi = {ch: i for i, ch in enumerate(all_chars)}
itos = {i: ch for i, ch in enumerate(all_chars)}

def encode(s):
    return [stoi[c] for c in s]

def decode(l):
    return "".join([itos[i] for i in l])

pretrain_data = np.array(encode(pretrain_text), dtype=np.int64)
finetune_data = np.array(encode(finetune_text), dtype=np.int64)
print(f"pretrain_data={len(pretrain_data)}, finetune_data={len(finetune_data)}")

rng = np.random.default_rng(1337)

def get_batch(data, batch_size, seq_len):
    ix = rng.integers(0, len(data) - seq_len, size=batch_size)
    x = np.stack([data[i:i + seq_len] for i in ix])
    y = np.stack([data[i + 1:i + seq_len + 1] for i in ix])
    return x, y

xb, yb = get_batch(pretrain_data, 4, 16)
print("batch 形狀:", xb.shape, yb.shape, "✅")
