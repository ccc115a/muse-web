# Cell 1 — 載入蒸餾語料（優先讀同目錄的 pretrain.txt / finetune.txt）
# 注意：需用 `npx serve` 跑 webpy（http），直接 file:// 開會因 Worker 限制讀不到檔，
# 此時自動改用內嵌小語料，照樣可跑完整流程。
import numpy as np

try:
    from pyodide.http import open_url
    with open_url("./examples/mini-llm/pretrain.txt") as f:
        pretrain_text = f.read()
    with open_url("./examples/mini-llm/finetune.txt") as f:
        finetune_text = f.read()
    print(f"已從伺服器載入語料 ✅ pretrain={len(pretrain_text)} 字, finetune={len(finetune_text)} 字")
except Exception as e:
    print("讀檔失敗，改用內嵌小語料：", e)
    pretrain_text = """地球是太陽系中唯一有生命的行星。
火星的表面是紅色的。
木星是太陽系中最大的行星。
土星有明顯的光環。
金星的自轉方向與多數行星相反。
水星是最靠近太陽的行星。
地球的表面有七成被海洋覆蓋。
火星有兩個小衛星。
木星的一天大約有十小時。
土星是太陽系中第二大的行星。
"""
    finetune_text = """<Q>哪顆行星有生命？<A>地球
<Q>火星的表面是什麼顏色？<A>紅色
<Q>哪顆行星最大？<A>木星
<Q>哪顆行星有光環？<A>土星
<Q>火星有幾顆小衛星？<A>兩顆
<Q>木星的一天大約有多少小時？<A>十小時
"""
    print(f"內嵌語料 ✅ pretrain={len(pretrain_text)} 字, finetune={len(finetune_text)} 字")

print("--- pretrain 範例 ---")
print(pretrain_text[:60])
print("--- finetune 範例 ---")
print(finetune_text.splitlines()[0])
