"""把 cells/ 組裝成 webpy 可直接讀檔開啟的筆記本。用法: python3 build_notebook.py"""
import json
from pathlib import Path

HERE = Path(__file__).parent
C = HERE / "cells"

order = [
    ("md", "00_intro.md"),
    ("code", "00_setup.py"),
    ("code", "01_data.py"),
    ("code", "02_vocab.py"),
    ("code", "03_use_package.py"),
    ("code", "04_pretrain.py"),
    ("code", "05_finetune_gen.py"),
]

cells = []
for i, (kind, name) in enumerate(order, start=1):
    cells.append({"id": f"c{i}", "kind": kind,
                  "src": (C / name).read_text(encoding="utf-8")})

out = {"app": "webpy", "cells": cells}
(HERE / "mini-llm.webpy.json").write_text(
    json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"ok: {len(cells)} cells -> mini-llm.webpy.json")
