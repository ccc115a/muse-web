# Cell 5 — Fine-tuning + QA 生成實測（對應原 finetune.py §3 §4）
import time
import numpy as np

try:
    PRESET
except NameError:
    PRESET = "standard"  # 若單獨執行本 cell，預設沿用 standard 規模（cfg 沿用 Cell 4 全域）
if PRESET == "full":
    # 原專案：iters=300 / lr=1e-4
    FT_ITERS, FT_LR, FT_LOG = 300, 1e-4, 10
elif PRESET == "standard":
    FT_ITERS, FT_LR, FT_LOG = 200, 1e-4, 10
else:
    FT_ITERS, FT_LR, FT_LOG = 60, 1e-4, 10

opt_ft = adam_init(params)  # 微調用新 optimizer（同原版）
print("開始 Fine-tuning...")
t0 = time.time()
for it in range(1, FT_ITERS + 1):
    xb, yb = get_batch(finetune_data, BATCH_SIZE, cfg["seq"])
    logits, cache = forward(params, xb, rope, cfg)
    loss, grads = ce_loss_and_bwd(params, logits, cache, yb)
    gn = clip_grads(grads, 1.0)
    adam_step(params, grads, opt_ft, FT_LR, it)
    if it % FT_LOG == 0 or it == 1:
        rate = it / max(time.time() - t0, 1e-6)
        eta = (FT_ITERS - it) / max(rate, 1e-6)
        print(f"Finetune Step {it:4d} | Loss: {loss:.4f} | grad_norm: {gn:.3f} | "
              f"{rate:.1f}it/s ETA {eta:.0f}s")
print(f"微調完成！({time.time()-t0:.0f}s)")

# ---------- 實測：自動抓 finetune 第一句當考題（同原版 §4） ----------
print("\n" + "=" * 50)
print("測試對話（自動抓取訓練集第一句進行測試）")
print("=" * 50)
first_line = finetune_text.splitlines()[0].strip()
if "<A>" in first_line:
    prompt = first_line.split("<A>")[0] + "<A>"
    expected = first_line.split("<A>")[1]
else:
    prompt, expected = first_line, "(無法解析答案)"
print(f"📝 抽取到的題目: {prompt}")
print(f"🎯 預期的解答: {expected}")
print("-" * 50)
idx = np.array([encode(prompt)], dtype=np.int64)
out = generate(params, idx, 100, rope, cfg)
print(f"🤖 AI 實際輸出:\n{decode(out[0].tolist())}")
print("=" * 50)
