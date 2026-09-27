"""逐段匯出 numpy 反向中間量（dh/dxn/d_h2/dMid/dO/dQr…），供 JS 逐段比對。"""
import json
import sys

import numpy as np

sys.path.insert(0, "/Users/Shared/ccc/115a/muse-web/webpy/packages/mini-llm-numpy/src")
import mini_llm_numpy.model as M  # noqa: E402

fx = json.load(open("/Users/Shared/ccc/115a/muse-web/webnn/tests/fixture.json"))
cfg = fx["cfg"]
params = {k: np.array(v["data"], dtype=np.float32).reshape(v["shape"])
          for k, v in fx["params"].items()}
xb = np.array(fx["xb"], dtype=np.int64).reshape(2, 4)
yb = np.array(fx["yb"], dtype=np.int64).reshape(2, 4)
rope = M.build_rope(cfg["d"] // cfg["heads"], cfg["seq"] * 2)

logits, cache = M.forward(params, xb, rope, cfg)

# 手動逐步反向（照抄 ce_loss_and_bwd，但每段存檔）
B, T, V = logits.shape
m = logits.max(-1, keepdims=True)
e = np.exp((logits - m).astype(np.float64))
prob = (e / e.sum(-1, keepdims=True)).astype(np.float32)
dlog = prob.copy()
dlog[np.arange(B)[:, None], np.arange(T), yb] -= 1.0
dlog /= (B * T)
h = cache["h"]
dh = dlog @ params["emb"]
dx, dn_out = M._rms_bwd(dh, cache["cn"])
out = {"dh": dh.ravel().tolist(), "dxn": dx.ravel().tolist()}
L = len(cache["caches"])
for li in reversed(range(L)):
    c1, ca, W, c2, cf, h1, h2 = cache["caches"][li]
    d_h2, g_ffn = M._ffn_bwd(dx, cf)
    d_mid_ffn, dn2 = M._rms_bwd(d_h2, c2)
    d_mid = dx + d_mid_ffn
    out["d_h2"] = d_h2.ravel().tolist()
    out["d_mid"] = d_mid.ravel().tolist()
    nh = cfg["heads"]
    hd = cfg["d"] // nh
    dO = d_mid.reshape(B, T, nh, hd).transpose(0, 2, 1, 3)
    out["dO"] = dO.ravel().tolist()
    # 前向 cache 對照
    out["f_qt"] = ca["qr"].transpose(0, 2, 1, 3).ravel().tolist()
    out["f_kt"] = ca["kr"].transpose(0, 2, 1, 3).ravel().tolist()
    out["f_vt"] = ca["v"].transpose(0, 2, 1, 3).ravel().tolist()
    out["f_prob"] = ca["p"].ravel().tolist()
    out["f_h1"] = h1.ravel().tolist()
    # attention 反向（照抄 _attn_bwd）
    vt = ca["v"].transpose(0, 2, 1, 3)
    dv = ca["p"].transpose(0, 1, 3, 2) @ dO
    dp = dO @ vt.transpose(0, 1, 3, 2)
    ds = (ca["p"] * (dp - (dp * ca["p"]).sum(-1, keepdims=True))
          / np.sqrt(hd)).astype(np.float32)
    out["dV"] = dv.ravel().tolist()
    out["dS"] = ds.ravel().tolist()
    qt = ca["qr"].transpose(0, 2, 1, 3)
    kt = ca["kr"].transpose(0, 2, 1, 3)
    dqr = ds @ kt
    dkr = ds.transpose(0, 1, 3, 2) @ qt
    out["dQr"] = dqr.ravel().tolist()
    out["dKr"] = dkr.ravel().tolist()
    break  # 只有 1 層

json.dump(out, open("/Users/Shared/ccc/115a/muse-web/webnn/tests/stages.json", "w"))
print("stages dumped; loss check dh norm:", float((dh ** 2).sum() ** 0.5))
