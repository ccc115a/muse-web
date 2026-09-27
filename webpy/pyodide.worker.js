// pyodide.worker.js — Web Worker 核心: 背景線程跑 Pyodide, 主線程零卡頓.
// 用法: 主線程用 AsyncPyodideWorker 封裝 postMessage (見 AsyncPyodideWorker.js)。
// 支援訊息: {type:"init"} {type:"run",id,code,context} {type:"loadPackages",id,packages} {type:"pipInstall",id,packages} {type:"reset",id}
importScripts("https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js");

let pyodide = null;
let initPromise = null;

async function ensureInit() {
  if (pyodide) return pyodide;
  if (!initPromise) {
    initPromise = loadPyodide({
      stdout: (text) => postMessage({ type: "stdout", data: text }),
      stderr: (text) => postMessage({ type: "stderr", data: text }),
    }).then(async (py) => {
      pyodide = py;
      // 預載 micropip：否則 Python 端 `import micropip` 會 ModuleNotFoundError
      //（Pyodide 0.25+ 內含但預設不安裝，需 loadPackage 先載入）
      try { await pyodide.loadPackage("micropip"); } catch {}
      postMessage({ type: "ready" });
      return py;
    }).catch((e) => {
      initPromise = null;
      throw e;
    });
  }
  return initPromise;
}

function toJsSafe(raw) {
  if (raw && typeof raw.toJs === "function") {
    try {
      const v = raw.toJs({ dict_converter: Object.fromEntries });
      if (typeof raw.destroy === "function") { try { raw.destroy(); } catch {} }
      return v;
    } catch { return raw; }
  }
  return raw;
}

self.onmessage = async (event) => {
  const { id, type, code, context, packages } = event.data || {};
  try {
    if (type === "init") {
      await ensureInit();
      return;
    }
    await ensureInit();

    if (type === "loadPackages") {
      await pyodide.loadPackage(packages);
      postMessage({ id, type: "packagesLoaded", result: true });
      return;
    }

    if (type === "pipInstall") {
      await pyodide.loadPackage("micropip");
      const micropip = pyodide.pyimport("micropip");
      await micropip.install([].concat(packages));
      postMessage({ id, type: "packagesLoaded", result: true });
      return;
    }

    if (type === "reset") {
      // 最乾淨的重啟是主線程 terminate() + 新建 Worker; 這裡做輕量全域清理
      for (const key of pyodide.globals.keys()) {
        if (!key.startsWith("_") && !["__name__", "__doc__", "__package__"].includes(key)) {
          try { pyodide.globals.delete(key); } catch {}
        }
      }
      postMessage({ id, type: "success", result: "reset ok" });
      return;
    }

    if (type === "run") {
      if (context) {
        for (const [k, v] of Object.entries(context)) {
          pyodide.globals.set(k, v);
        }
      }
      const raw = await pyodide.runPythonAsync(code);
      let result = toJsSafe(raw);
      // structured-clone 失敗 (e.g. 函數/特殊物件) 時降級為字串
      try { postMessage({ id, type: "success", result }); }
      catch {
        postMessage({ id, type: "success", result: String(result ?? "") });
      }
      return;
    }
  } catch (error) {
    postMessage({ id, type: "error", error: error?.message ?? String(error) });
  }
};
