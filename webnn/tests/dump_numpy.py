"""匯出 tiny 模型權重+batch+loss+梯度，供 webnn/tests/equiv.mjs 對照。"""
import json
import sys

import numpy as np

sys.path.insert(0, "/Users/Shared/ccc/115a/muse-web/webpy/packages/mini-llm-numpy/src")
from mini_llm_numpy import (  # noqa: E402
    build_rope,
    ce_loss_and_bwd,
    forward,
    init_params,
    seed,
)

seed(7)
cfg = {"d": 8, "heads": 2, "layers": 1, "seq": 4, "vocab": 12}
params = init_params(cfg["vocab"], cfg["d"], cfg["layers"])
rope = build_rope(cfg["d"] // cfg["heads"], cfg["seq"] * 2)
brng = np.random.default_rng(0)
xb = brng.integers(0, cfg["vocab"], size=2 * cfg["seq"]).astype(np.int64)
yb = brng.integers(0, cfg["vocab"], size=2 * cfg["seq"]).astype(np.int64)

logits, cache = forward(params, xb.reshape(2, 4), rope, cfg)
loss, grads = ce_loss_and_bwd(params, logits, cache, yb.reshape(2, 4))

out = {
    "cfg": cfg,
    "xb": xb.tolist(),
    "yb": yb.tolist(),
    "loss": loss,
    "params": {k: {"shape": list(v.shape), "data": v.astype(float).ravel().tolist()}
               for k, v in params.items()},
    "grads": {k: v.astype(float).ravel().tolist() for k, v in grads.items()},
}
p = "/Users/Shared/ccc/115a/muse-web/webnn/tests/fixture.json"
json.dump(out, open(p, "w"))
print(f"loss={loss:.6f}, wrote {p}")
