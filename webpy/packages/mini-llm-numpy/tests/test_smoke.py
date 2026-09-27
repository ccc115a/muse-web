"""冒煙測試：data 工具 + 幾步訓練 loss 下降 + 生成形狀正確。"""
import numpy as np

from mini_llm_numpy import (
    adam_init,
    adam_step,
    build_rope,
    build_vocab,
    ce_loss_and_bwd,
    clip_grads,
    forward,
    generate,
    get_batch,
    init_params,
    make_codec,
)


def test_vocab_codec_roundtrip():
    s = "<Q>ab<A>紅色bcd"
    stoi, itos, vs = build_vocab(s, "其他字")
    assert vs == len(set(s + "其他字"))
    encode, decode = make_codec(stoi, itos)
    assert decode(encode(s)) == s


def test_tiny_training_converges_and_generates():
    text = ("<Q>哪顆行星最大？<A>木星\n<Q>火星什麼顏色？<A>紅色\n" * 20)
    stoi, itos, vs = build_vocab(text)
    encode, decode = make_codec(stoi, itos)
    data = np.array(encode(text), dtype=np.int64)
    cfg = {"d": 16, "heads": 2, "layers": 1, "seq": 8, "vocab": vs}
    rng = np.random.default_rng(0)
    rope = build_rope(cfg["d"] // cfg["heads"], cfg["seq"] * 2)
    params = init_params(vs, cfg["d"], cfg["layers"])
    opt = adam_init(params)

    first, last = None, None
    for t in range(1, 11):
        xb, yb = get_batch(rng, data, 8, cfg["seq"])
        logits, cache = forward(params, xb, rope, cfg)
        loss, grads = ce_loss_and_bwd(params, logits, cache, yb)
        assert np.isfinite(loss)
        clip_grads(grads, 1.0)
        adam_step(params, grads, opt, 5e-4, t)
        first = loss if first is None else first
        last = loss
    assert last < first, f"loss 應下降: {first:.4f} -> {last:.4f}"

    idx = np.array([encode("<Q>")], dtype=np.int64)
    out = generate(params, idx, 5, rope, cfg)
    assert out.shape == (1, len(idx[0]) + 5)
    assert decode(out[0].tolist()).startswith("<Q>")
