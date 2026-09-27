"""手寫反向傳播的數值梯度檢查（finite difference vs 解析梯度）。"""
import numpy as np

from mini_llm_numpy import build_rope, ce_loss_and_bwd, forward, init_params


def _loss(logits, yb):
    B, T, V = logits.shape
    m = logits.max(-1, keepdims=True)
    e = np.exp((logits - m).astype(np.float64))
    logp = (logits - m - np.log(e.sum(-1, keepdims=True))).astype(np.float32)
    return float(-logp[np.arange(B)[:, None], np.arange(T), yb].mean())


def test_backward_matches_numeric_grad():
    cfg = {"d": 8, "heads": 2, "layers": 1, "seq": 4, "vocab": 12}
    params = init_params(cfg["vocab"], cfg["d"], cfg["layers"])
    rope = build_rope(cfg["d"] // cfg["heads"], cfg["seq"] * 2)
    rng = np.random.default_rng(0)
    xb = rng.integers(0, cfg["vocab"], size=(2, cfg["seq"]))
    yb = rng.integers(0, cfg["vocab"], size=(2, cfg["seq"]))

    def loss_fn(p):
        logits, _ = forward(p, xb, rope, cfg)
        return _loss(logits, yb)

    logits, cache = forward(params, xb, rope, cfg)
    _, grads = ce_loss_and_bwd(params, logits, cache, yb)

    assert set(grads) == set(params), "每個參數都該有梯度"
    for k in params:  # 不可用 zip：grads 插入順序與 params 不同
        assert params[k].shape == grads[k].shape
        assert np.all(np.isfinite(grads[k]))

    srng = np.random.default_rng(1)
    eps, errs = 1e-3, []
    for k, v in params.items():
        for _ in range(min(4, v.size)):
            ix = tuple(srng.integers(0, s) for s in v.shape)
            old = float(v[ix])
            v[ix] = np.float32(old + eps)
            lp = loss_fn(params)
            v[ix] = np.float32(old - eps)
            lm = loss_fn(params)
            v[ix] = np.float32(old)
            num, ana = (lp - lm) / (2 * eps), float(grads[k][ix])
            errs.append(abs(num - ana) / max(1e-8, abs(num) + abs(ana)))
    assert sum(errs) / len(errs) < 0.03, f"平均相對誤差過大: {errs}"
    assert max(errs) < 0.08, f"最大相對誤差過大: {max(errs):.2e}"
