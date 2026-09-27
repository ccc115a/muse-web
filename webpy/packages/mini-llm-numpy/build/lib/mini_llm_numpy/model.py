"""mini_llm_numpy.model — 純 numpy 微型 Transformer（RMSNorm + RoPE + SwiGLU + tied embedding）.

與 `mini-llm/v3-distill` 原 torch 版 `model.py` 同架構、數學等價；
反向傳播手寫，無 torch 依賴，可跑在 Pyodide（瀏覽器 / Node）等無 torch 環境。

基本用法：
    import numpy as np
    from mini_llm_numpy import init_params, build_rope, forward, ce_loss_and_bwd,
        adam_init, clip_grads, adam_step, generate

    cfg = {"d": 64, "heads": 2, "layers": 2, "seq": 32, "vocab": 210}
    rope = build_rope(cfg["d"] // cfg["heads"], cfg["seq"] * 2)
    params = init_params(cfg["vocab"], cfg["d"], cfg["layers"])
    opt = adam_init(params)
    for t in range(1, 101):
        logits, cache = forward(params, xb, rope, cfg)
        loss, grads = ce_loss_and_bwd(params, logits, cache, yb)
        clip_grads(grads, 1.0)
        adam_step(params, grads, opt, 5e-4, t)
"""
import math

import numpy as np

__all__ = [
    "seed",
    "init_params",
    "build_rope",
    "forward",
    "ce_loss_and_bwd",
    "adam_init",
    "clip_grads",
    "adam_step",
    "generate",
]

F32 = np.float32
m_rng = np.random.default_rng(7)


def seed(s=7):
    """重設全域隨機種子（權重初始化與生成採樣共用）。"""
    global m_rng
    m_rng = np.random.default_rng(s)

# ---------- 基礎 ----------
def _init(fin, fout):
    return (m_rng.standard_normal((fin, fout)) * (1.0 / math.sqrt(fin))).astype(F32)

def _softmax(x, axis=-1):
    x = x - x.max(axis=axis, keepdims=True)
    e = np.exp(x, dtype=np.float64).astype(F32)
    return e / e.sum(axis=axis, keepdims=True)

def _silu(x):
    return (x / (1.0 + np.exp(-x))).astype(F32)

def _dsilu(x):
    s = 1.0 / (1.0 + np.exp(-x))
    return (s * (1.0 + x * (1.0 - s))).astype(F32)

def _linear_bwd(x, dy, W):
    # x:(...,fin) dy:(...,fout) W:(fin,fout)；dW 對 batch 維求和
    xs = x.reshape(-1, x.shape[-1]).astype(np.float64)
    ys = dy.reshape(-1, dy.shape[-1]).astype(np.float64)
    dW = (xs.T @ ys).astype(F32)
    dx = dy @ W.T
    return dx.astype(F32), dW

# ---------- RoPE（實數版，與原 torch.polar 等價，只是避開複數） ----------
def build_rope(head_dim, end, theta=10000.0):
    i = np.arange(0, head_dim, 2, dtype=np.float64)
    freqs = 1.0 / (theta ** (i / head_dim))
    t = np.arange(end, dtype=np.float64)
    ang = np.outer(t, freqs)
    return np.cos(ang).astype(F32), np.sin(ang).astype(F32)

def _rope_fwd(x, cos, sin):
    T = x.shape[1]  # x: (B,T,nh,hd)
    c = cos[:T].reshape(1, T, 1, -1)
    s = sin[:T].reshape(1, T, 1, -1)
    x0, x1 = x[..., 0::2], x[..., 1::2]
    out = np.empty_like(x)
    out[..., 0::2] = x0 * c - x1 * s
    out[..., 1::2] = x0 * s + x1 * c
    return out

def _rope_bwd(dy, cos, sin, T):
    c = cos[:T].reshape(1, T, 1, -1)
    s = sin[:T].reshape(1, T, 1, -1)
    y0, y1 = dy[..., 0::2], dy[..., 1::2]
    dx = np.empty_like(dy)
    dx[..., 0::2] = y0 * c + y1 * s
    dx[..., 1::2] = -y0 * s + y1 * c
    return dx

# ---------- RMSNorm ----------
def _rms_fwd(x, w, eps=1e-6):
    m = (x.astype(np.float64) ** 2).mean(-1, keepdims=True)
    r = (1.0 / np.sqrt(m + eps)).astype(F32)
    return (w * (x * r)).astype(F32), (x, w, m.astype(F32))

def _rms_bwd(dy, cache, eps=1e-6):
    x, w, m = cache
    d = x.shape[-1]
    r = (1.0 / np.sqrt(m.astype(np.float64) + eps)).astype(F32)
    dxh = dy * w
    c = (dxh.astype(np.float64) * x.astype(np.float64)).sum(-1, keepdims=True)
    dx = dxh * r - (x * (c * (r.astype(np.float64) ** 3) / d)).astype(F32)
    xh = x * r
    dw = (dy.astype(np.float64) * xh.astype(np.float64)).sum(
        axis=tuple(range(dy.ndim - 1))).astype(F32)
    return dx.astype(F32), dw

# ---------- Attention ----------
def _attn_fwd(x, W, cos, sin, n_heads):
    B, T, d = x.shape
    hd = d // n_heads
    q = (x @ W["q"]).reshape(B, T, n_heads, hd)
    k = (x @ W["k"]).reshape(B, T, n_heads, hd)
    v = (x @ W["v"]).reshape(B, T, n_heads, hd)
    qr, kr = _rope_fwd(q, cos, sin), _rope_fwd(k, cos, sin)
    qt, kt, vt = qr.transpose(0, 2, 1, 3), kr.transpose(0, 2, 1, 3), v.transpose(0, 2, 1, 3)
    scores = (qt @ kt.transpose(0, 1, 3, 2)) / math.sqrt(hd)
    mask = np.triu(np.ones((T, T), dtype=bool), k=1)
    scores[:, :, mask] = -1e9
    p = _softmax(scores)
    o = p @ vt  # (B,nh,T,hd)
    out = o.transpose(0, 2, 1, 3).reshape(B, T, d) @ W["o"]
    return out.astype(F32), {"q": q, "k": k, "v": v, "qr": qr, "kr": kr,
                             "p": p, "o": o, "x": x, "W": W, "T": T, "nh": n_heads}

def _attn_bwd(dout, c, cos, sin):
    B, T, d = dout.shape
    nh, hd = c["nh"], d // c["nh"]
    W = c["W"]
    # wo
    ot = c["o"].transpose(0, 2, 1, 3).reshape(B * T, d)
    dW_o = (ot.astype(np.float64).T @ dout.reshape(B * T, d).astype(np.float64)).astype(F32)
    do = (dout.reshape(B * T, d) @ W["o"].T).reshape(B, T, nh, hd).transpose(0, 2, 1, 3)
    vt = c["v"].transpose(0, 2, 1, 3)
    dv = c["p"].transpose(0, 1, 3, 2) @ do
    dp = do @ vt.transpose(0, 1, 3, 2)
    p = c["p"]
    ds = (p * (dp - (dp * p).sum(-1, keepdims=True)) / math.sqrt(hd)).astype(F32)
    qt = c["qr"].transpose(0, 2, 1, 3)
    kt = c["kr"].transpose(0, 2, 1, 3)
    dqr = (ds @ kt).transpose(0, 2, 1, 3)
    dkr = (ds.transpose(0, 1, 3, 2) @ qt).transpose(0, 2, 1, 3)
    dq = _rope_bwd(dqr, cos, sin, T).reshape(B, T, d)
    dk = _rope_bwd(dkr, cos, sin, T).reshape(B, T, d)
    dv2 = dv.transpose(0, 2, 1, 3).reshape(B, T, d)
    dx_q, dW_q = _linear_bwd(c["x"], dq, W["q"])
    dx_k, dW_k = _linear_bwd(c["x"], dk, W["k"])
    dx_v, dW_v = _linear_bwd(c["x"], dv2, W["v"])
    return (dx_q + dx_k + dx_v), {"q": dW_q, "k": dW_k, "v": dW_v, "o": dW_o}

# ---------- SwiGLU FFN ----------
def _ffn_fwd(x, W):
    a1, a3 = x @ W["w1"], x @ W["w3"]
    s = _silu(a1)
    return (s * a3) @ W["w2"], {"x": x, "a1": a1, "a3": a3, "s": s, "W": W}

def _ffn_bwd(dy, c):
    W = c["W"]
    h = c["s"] * c["a3"]
    dh, dW2 = _linear_bwd(h, dy, W["w2"])
    da3 = dh * c["s"]
    da1 = dh * c["a3"] * _dsilu(c["a1"])
    dx1, dW1 = _linear_bwd(c["x"], da1, W["w1"])
    dx3, dW3 = _linear_bwd(c["x"], da3, W["w3"])
    return (dx1 + dx3), {"w1": dW1, "w2": dW2, "w3": dW3}

# ---------- 整模型 ----------
def init_params(vocab_size, d, n_layers):
    p = {"emb": _init(vocab_size, d), "n_out": np.ones(d, dtype=F32)}
    for l in range(n_layers):
        p[f"b{l}q"] = _init(d, d); p[f"b{l}k"] = _init(d, d)
        p[f"b{l}v"] = _init(d, d); p[f"b{l}o"] = _init(d, d)
        p[f"b{l}1"] = _init(d, 4 * d); p[f"b{l}3"] = _init(d, 4 * d)
        p[f"b{l}2"] = _init(4 * d, d)
        p[f"b{l}n1"] = np.ones(d, dtype=F32); p[f"b{l}n2"] = np.ones(d, dtype=F32)
    return p

def forward(params, idx, rope, cfg):
    B, T = idx.shape
    cos, sin = rope
    x = params["emb"][idx]
    caches = []
    for l in range(cfg["layers"]):
        W = {"q": params[f"b{l}q"], "k": params[f"b{l}k"],
             "v": params[f"b{l}v"], "o": params[f"b{l}o"]}
        h1, c1 = _rms_fwd(x, params[f"b{l}n1"])
        a, ca = _attn_fwd(h1, W, cos, sin, cfg["heads"])
        x = x + a
        h2, c2 = _rms_fwd(x, params[f"b{l}n2"])
        f, cf = _ffn_fwd(h2, {"w1": params[f"b{l}1"], "w2": params[f"b{l}2"],
                              "w3": params[f"b{l}3"]})
        x = x + f
        caches.append((c1, ca, W, c2, cf, h1, h2))
    h, cn = _rms_fwd(x, params["n_out"])
    logits = (h @ params["emb"].T).astype(F32)
    return logits, {"x_emb": x, "idx": idx, "h": h, "cn": cn,
                    "caches": caches, "rope": rope}

def ce_loss_and_bwd(params, logits, cache, targets):
    B, T, V = logits.shape
    m = logits.max(-1, keepdims=True)
    e = np.exp((logits - m).astype(np.float64))
    prob = (e / e.sum(-1, keepdims=True)).astype(F32)
    logp = (logits - m - np.log(e.sum(-1, keepdims=True))).astype(F32)
    loss = float(-logp[np.arange(B)[:, None], np.arange(T), targets].mean())
    dlog = prob.copy()
    dlog[np.arange(B)[:, None], np.arange(T), targets] -= 1.0
    dlog /= (B * T)
    grads = {}
    h = cache["h"]
    dh = dlog @ params["emb"]  # tied embedding 反傳到 hidden
    dE_out = np.einsum("btv,btd->vd", dlog.astype(np.float64), h.astype(np.float64)).astype(F32)
    dx, dn_out = _rms_bwd(dh, cache["cn"])
    grads["n_out"] = dn_out
    L = len(cache["caches"])
    for li in reversed(range(L)):
        # 前向：h1=rms(x_in) → a=attn(h1) → x_mid=x_in+a → h2=rms(x_mid) → f=ffn(h2) → x_out=x_mid+f
        # 反向：residual 相加處梯度直接相加
        c1, ca, W, c2, cf, h1, h2 = cache["caches"][li]
        d_h2, g_ffn = _ffn_bwd(dx, cf)          # dL/dh2
        d_mid_ffn, dn2 = _rms_bwd(d_h2, c2)     # 經 norm2 回到 x_mid
        grads[f"b{li}n2"] = dn2
        d_mid = dx + d_mid_ffn                  # x_mid 的總梯度（含 residual）
        d_h1, g_att = _attn_bwd(d_mid, ca, cache["rope"][0], cache["rope"][1])
        d_in_attn, dn1 = _rms_bwd(d_h1, c1)     # 經 norm1 回到 x_in
        grads[f"b{li}n1"] = dn1
        dx = d_mid + d_in_attn                  # x_in 的總梯度（含 residual）
        grads[f"b{li}q"] = g_att["q"]; grads[f"b{li}k"] = g_att["k"]
        grads[f"b{li}v"] = g_att["v"]; grads[f"b{li}o"] = g_att["o"]
        grads[f"b{li}1"] = g_ffn["w1"]; grads[f"b{li}2"] = g_ffn["w2"]
        grads[f"b{li}3"] = g_ffn["w3"]
    dE = np.zeros_like(params["emb"])
    np.add.at(dE, cache["idx"], dx)
    grads["emb"] = (dE + dE_out).astype(F32)
    return loss, grads

# ---------- AdamW ----------
def adam_init(params):
    return {k: [np.zeros_like(v), np.zeros_like(v)] for k, v in params.items()}

def clip_grads(grads, max_norm=1.0):
    total = math.sqrt(sum(float((g.astype(np.float64) ** 2).sum()) for g in grads.values()))
    if total > max_norm:
        s = max_norm / (total + 1e-12)
        for k in grads:
            grads[k] = (grads[k] * s).astype(F32)
    return total

def adam_step(params, grads, state, lr, t, wd=0.01, b1=0.9, b2=0.95):
    for k in params:
        m, v = state[k]
        g = grads[k].astype(np.float64)
        m[:] = b1 * m + (1 - b1) * g
        v[:] = b2 * v + (1 - b2) * g * g
        mh = m / (1 - b1 ** t); vh = v / (1 - b2 ** t)
        upd = mh / (np.sqrt(vh) + 1e-8)
        if params[k].ndim > 1:  # norm 層不做 decay（常見做法）
            upd = upd + wd * params[k].astype(np.float64)
        params[k] = (params[k].astype(np.float64) - lr * upd).astype(F32)

# ---------- 生成（對應原 model.generate） ----------
def generate(params, idx, max_new_tokens, rope, cfg):
    idx = np.array(idx, dtype=np.int64)
    for _ in range(max_new_tokens):
        cond = idx[:, -cfg["seq"]:]
        logits, _ = forward(params, cond, rope, cfg)
        p = _softmax(logits[:, -1, :]).astype(np.float64)
        nxt = np.array([np.searchsorted(np.cumsum(row).clip(0, 1), m_rng.random())
                        for row in p], dtype=np.int64).reshape(-1, 1)
        nxt = np.clip(nxt, 0, p.shape[1] - 1)
        idx = np.concatenate([idx, nxt], axis=1)
    return idx
