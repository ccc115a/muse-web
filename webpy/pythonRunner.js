// pythonRunner.js — Unified Python Runner (Node.js & Browser main-thread)
// 核心: Pyodide (Wasm CPython) = 100% Python 3.11+ 語法, 不需自寫 parser/compiler.
// Browser 重度運算請改用 AsyncPyodideWorker.js + pyodide.worker.js (避免卡住 UI)。
import { loadPyodide } from "pyodide";

export class PythonRunner {
  constructor() {
    this.pyodide = null;
    this.isReady = false;
    this._initPromise = null;
  }

  async init(options = {}) {
    if (this.isReady) return this.pyodide;
    if (this._initPromise) return this._initPromise;
    const stdout = options.stdout || ((t) => console.log(t));
    const stderr = options.stderr || ((t) => console.error(t));
    this._initPromise = loadPyodide({
      stdout: (text) => stdout(text),
      stderr: (text) => stderr(text),
      ...options.pyodideOptions,
    }).then((py) => {
      this.pyodide = py;
      this.isReady = true;
      return py;
    });
    return this._initPromise;
  }

  async run(code, context = {}) {
    if (!this.isReady) throw new Error("Pyodide 未初始化,請先呼叫 await init()");
    for (const [k, v] of Object.entries(context)) {
      this.pyodide.globals.set(k, v);
    }
    try {
      const raw = await this.pyodide.runPythonAsync(code);
      if (raw && typeof raw.toJs === "function") {
        try {
          const js = raw.toJs({ dict_converter: Object.fromEntries });
          if (typeof raw.destroy === "function") raw.destroy();
          return js;
        } catch {
          return raw;
        }
      }
      return raw;
    } catch (err) {
      throw new Error(`Python Runtime Error:\n${err.message ?? String(err)}`);
    }
  }

  async loadPackage(packages) {
    if (!this.isReady) await this.init();
    await this.pyodide.loadPackage(packages);
  }

  // pip (micropip) — 只能裝純 Python wheel, 需網路
  async pipInstall(pkgs) {
    if (!this.isReady) await this.init();
    await this.pyodide.loadPackage("micropip");
    const micropip = this.pyodide.pyimport("micropip");
    await micropip.install(pkgs);
  }

  reset() {
    // 清掉使用者全域變數 (保留初始化狀態, 不重載 wasm)
    if (!this.isReady) return;
    for (const key of this.pyodide.globals.keys()) {
      if (!key.startsWith("_") && !["__name__", "__doc__", "__package__"].includes(key)) {
        try { this.pyodide.globals.delete(key); } catch { /* ignore */ }
      }
    }
  }
}

const runner = new PythonRunner();
export default runner;
