# Cell 4 — Pre-training（對應原 pretrain.py）
# 經實測：numpy 版與 torch 版收斂曲線完全一致（full：pretrain 5.7→0.29 / finetune 5.1→0.23），
# 之前答句亂純粹是 fast 預設訓練量不夠，不是程式錯。
import time
import numpy as np

PRESET = "standard"  # "fast"：~2分鐘只驗流程；"standard"：~6-8分鐘，答對（預設）；"full"：~20-40分鐘，原專案同等最佳
if PRESET == "full":
    # 原專案規模：d=128 / heads=4 / layers=4 / seq=64 / batch=32 / iters=500 / lr=5e-4
    cfg = {"d": 128, "heads": 4, "layers": 4, "seq": 64, "vocab": vocab_size}
    PRETRAIN_ITERS, BATCH_SIZE, LR, LOG_EVERY = 500, 32, 5e-4, 10
elif PRESET == "standard":
    # 完整 1M 模型 + 短 seq：本地實測 pretrain→0.35 / finetune→0.34，首題答對，瀏覽器約 6-8 分鐘
    cfg = {"d": 128, "heads": 4, "layers": 4, "seq": 32, "vocab": vocab_size}
    PRETRAIN_ITERS, BATCH_SIZE, LR, LOG_EVERY = 300, 32, 5e-4, 10
else:
    cfg = {"d": 64, "heads": 2, "layers": 2, "seq": 32, "vocab": vocab_size}
    PRETRAIN_ITERS, BATCH_SIZE, LR, LOG_EVERY = 120, 16, 5e-4, 10

rope = build_rope(cfg["d"] // cfg["heads"], cfg["seq"] * 2)  # 同原版：長度 seq*2
params = init_params(cfg["vocab"], cfg["d"], cfg["layers"])
opt = adam_init(params)
n_params = sum(v.size for v in params.values())
print(f"模型參數: {n_params:,} | d={cfg['d']} heads={cfg['heads']} layers={cfg['layers']} seq={cfg['seq']}")

t0 = time.time()
for it in range(1, PRETRAIN_ITERS + 1):
    xb, yb = get_batch(pretrain_data, BATCH_SIZE, cfg["seq"])
    logits, cache = forward(params, xb, rope, cfg)
    loss, grads = ce_loss_and_bwd(params, logits, cache, yb)
    gn = clip_grads(grads, 1.0)
    adam_step(params, grads, opt, LR, it)
    if it % LOG_EVERY == 0 or it == 1:
        rate = it / max(time.time() - t0, 1e-6)
        eta = (PRETRAIN_ITERS - it) / max(rate, 1e-6)
        print(f"Pretrain Step {it:4d} | Loss: {loss:.4f} | grad_norm: {gn:.3f} | "
              f"{rate:.1f}it/s ETA {eta:.0f}s")

print(f"預訓練完成！({time.time()-t0:.0f}s) 權重在記憶體 `params` ✅")
