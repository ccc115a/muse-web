# Cell 3 — 引用獨立套件 packages/mini-llm-numpy（單一真相來源，此 cell 不內嵌模型程式碼）
# 瀏覽器不能 pip install 本地路徑，所以用 fetch 抓套件原始碼、寫入 Pyodide FS 再 import。
# 模型本體永遠只有一份：packages/mini-llm-numpy/src/mini_llm_numpy/model.py
from pyodide.http import open_url

_PKG_URL = "./packages/mini-llm-numpy/src/mini_llm_numpy/model.py"

try:
    with open_url(_PKG_URL) as f:
        _model_src = f.read()
except Exception as e:
    raise RuntimeError(
        "套件載入失敗：請用 `npx serve` 經 http 開 webpy（不要用 file:// 直接開），"
        f"讓 Worker 抓得到 {_PKG_URL}：{e}"
    )

with open("mini_llm_numpy_model.py", "w", encoding="utf-8") as f:
    f.write(_model_src)

from mini_llm_numpy_model import *  # noqa: F401,F403 — 匯入 init_params/forward/adam_*/generate 等
print("mini_llm_numpy 載入成功 ✅（引用自 packages/mini-llm-numpy，非內嵌）")
