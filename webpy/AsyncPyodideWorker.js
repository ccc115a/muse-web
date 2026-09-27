// AsyncPyodideWorker.js — 主線程 Promise 封裝, 隱藏 postMessage/id 配對細節.
export class AsyncPyodideWorker {
  constructor(workerPath = "./pyodide.worker.js") {
    this.workerPath = workerPath;
    this.callbacks = new Map();
    this.requestId = 0;
    this.isReady = false;
    this._readyResolvers = [];
    this.onStdout = console.log;
    this.onStderr = console.error;
    this.onReady = null;
    this._spawn();
  }

  _spawn() {
    this.worker = new Worker(this.workerPath);
    this.isReady = false;
    this.worker.onmessage = (event) => {
      const { id, type, result, error, data } = event.data || {};
      if (type === "ready") {
        this.isReady = true;
        this._readyResolvers.splice(0).forEach((r) => r());
        if (typeof this.onReady === "function") this.onReady();
        return;
      }
      if (type === "stdout") { this.onStdout?.(data); return; }
      if (type === "stderr") { this.onStderr?.(data); return; }
      if (id !== undefined && this.callbacks.has(id)) {
        const { resolve, reject } = this.callbacks.get(id);
        this.callbacks.delete(id);
        if (type === "error") reject(new Error(error));
        else resolve(result);
      }
    };
    this.worker.onerror = (err) => console.error("Worker 嚴重錯誤:", err);
    this.worker.postMessage({ type: "init" });
  }

  ready() {
    if (this.isReady) return Promise.resolve();
    return new Promise((r) => this._readyResolvers.push(r));
  }

  _call(msg) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.callbacks.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id });
    });
  }

  run(code, context = {}) {
    return this._call({ type: "run", code, context });
  }

  loadPackages(packages) {
    return this._call({ type: "loadPackages", packages });
  }

  pipInstall(packages) {
    return this._call({ type: "pipInstall", packages });
  }

  reset() {
    return this._call({ type: "reset" });
  }

  // 死迴圈秒殺: 終止 worker, 清掉 pending promise, 重建新 worker
  restart() {
    try { this.worker.terminate(); } catch {}
    for (const { reject } of this.callbacks.values()) {
      reject(new Error("Worker 已重啟, 任務被中斷"));
    }
    this.callbacks.clear();
    this._spawn();
    return this.ready();
  }

  terminate() {
    try { this.worker.terminate(); } catch {}
    this.callbacks.clear();
  }
}
