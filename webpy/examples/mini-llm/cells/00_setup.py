# Cell 0 — 安裝 numpy（Pyodide 官方移植版，瀏覽器保證可用）
try:
    import micropip
except ModuleNotFoundError:
    # 舊版 Worker 若沒預載 micropip，在此自行補載（新版 Worker 已預載，走不到這裡）
    import pyodide_js
    await pyodide_js.loadPackage("micropip")
    import micropip

await micropip.install("numpy")

import numpy as np
print("numpy", np.__version__, "載入成功 ✅")
