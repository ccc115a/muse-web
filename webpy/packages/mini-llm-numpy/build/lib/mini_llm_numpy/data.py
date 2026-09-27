"""字元級語料工具：詞表、編解碼、取 batch（對應原 pretrain.py §1 的 numpy 版）。"""
import numpy as np

__all__ = ["build_vocab", "make_codec", "get_batch"]


def build_vocab(*texts):
    """從多段文字建字元詞表。回傳 (stoi, itos, vocab_size)。"""
    all_chars = sorted(list(set("".join(texts))))
    stoi = {ch: i for i, ch in enumerate(all_chars)}
    itos = {i: ch for i, ch in enumerate(all_chars)}
    return stoi, itos, len(all_chars)


def make_codec(stoi, itos):
    """回傳 (encode, decode)：encode(str)->list[int], decode(list[int])->str。"""

    def encode(s):
        return [stoi[c] for c in s]

    def decode(l):
        return "".join([itos[i] for i in l])

    return encode, decode


def get_batch(rng, data, batch_size, seq_len):
    """隨機切 batch。回傳 (x, y)，形狀皆為 (batch_size, seq_len)。"""
    ix = rng.integers(0, len(data) - seq_len, size=batch_size)
    x = np.stack([data[i:i + seq_len] for i in ix])
    y = np.stack([data[i + 1:i + seq_len + 1] for i in ix])
    return x, y
