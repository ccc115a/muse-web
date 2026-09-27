#!/usr/bin/env python3
"""命令列版 mini-llm 訓練（對應原專案 run.sh）。

原流程：gen_data_distill.py → pretrain.py → finetune.py。
蒸餾語料已內含（pretrain.txt / finetune.txt，gen_data 需 NVIDIA_API_KEY 故略過），
此腳本做：建詞表（存 vocab.json）→ pretrain（存 pretrain.npz）→ finetune（存 finetune.npz）→ QA 實測。

用法：
    python3 train.py                  # full 預設（原專案同等規模）
    python3 train.py --preset fast    # 快速驗證版
"""
import argparse
import json
import time
from pathlib import Path

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
    seed,
)

HERE = Path(__file__).parent


def train_loop(params, rope, cfg, data, iters, batch, lr, tag, log_every):
    opt = adam_init(params)
    t0 = time.time()
    for it in range(1, iters + 1):
        xb, yb = get_batch(rng, data, batch, cfg["seq"])
        logits, cache = forward(params, xb, rope, cfg)
        loss, grads = ce_loss_and_bwd(params, logits, cache, yb)
        gn = clip_grads(grads, 1.0)
        adam_step(params, grads, opt, lr, it)
        if it % log_every == 0 or it == 1:
            print(f"{tag} Step {it:4d} | Loss: {loss:.4f} "
                  f"| grad_norm: {gn:.3f} | {time.time()-t0:.0f}s", flush=True)
    print(f"{tag}完成！({time.time()-t0:.0f}s)")


def main():
    ap = argparse.ArgumentParser(description="mini-llm 命令列訓練")
    ap.add_argument("--preset", default="standard",
                    choices=["fast", "standard", "full"])
    args = ap.parse_args()

    if args.preset == "full":
        cfg = {"d": 128, "heads": 4, "layers": 4, "seq": 64}
        pre_iters, ft_iters, pre_b, ft_b = 500, 300, 32, 32
        log_every = 10
    elif args.preset == "standard":
        cfg = {"d": 128, "heads": 4, "layers": 4, "seq": 32}
        pre_iters, ft_iters, pre_b, ft_b = 300, 200, 32, 32
        log_every = 10
    else:
        cfg = {"d": 64, "heads": 2, "layers": 2, "seq": 32}
        pre_iters, ft_iters, pre_b, ft_b = 120, 60, 16, 16
        log_every = 10

    pretrain_text = (HERE / "pretrain.txt").read_text(encoding="utf-8")
    finetune_text = (HERE / "finetune.txt").read_text(encoding="utf-8")

    seed(7)
    stoi, itos, vocab_size = build_vocab(pretrain_text, finetune_text)
    print(f"詞表大小: {vocab_size} 字元")
    (HERE / "vocab.json").write_text(
        json.dumps({"stoi": stoi, "itos": itos, "vocab_size": vocab_size},
                   ensure_ascii=False), encoding="utf-8")
    print("詞表已儲存為 vocab.json")

    encode, decode = make_codec(stoi, itos)
    pre = np.array(encode(pretrain_text), dtype=np.int64)
    ft = np.array(encode(finetune_text), dtype=np.int64)
    print(f"Pretrain 資料長度: {len(pre)} | Finetune 資料長度: {len(ft)}")

    global rng
    rng = np.random.default_rng(1337)
    cfg["vocab"] = vocab_size
    rope = build_rope(cfg["d"] // cfg["heads"], cfg["seq"] * 2)
    params = init_params(vocab_size, cfg["d"], cfg["layers"])
    print(f"模型參數: {sum(v.size for v in params.values()):,}")

    print("開始 Pre-training...")
    train_loop(params, rope, cfg, pre, pre_iters, pre_b, 5e-4, "Pretrain", log_every)
    np.savez(HERE / "pretrain.npz", **params)
    print("預訓練完成！模型已儲存為 pretrain.npz")

    print("開始 Fine-tuning...")
    train_loop(params, rope, cfg, ft, ft_iters, ft_b, 1e-4, "Finetune", log_every)
    np.savez(HERE / "finetune.npz", **params)
    print("微調完成！模型已儲存為 finetune.npz")

    # 實測：自動抓 finetune 第一句當考題（同原 finetune.py §4）
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
    out = generate(params, np.array([encode(prompt)]), 100, rope, cfg)
    print(f"🤖 AI 實際輸出:\n{decode(out[0].tolist())}")
    print("=" * 50)


if __name__ == "__main__":
    main()
