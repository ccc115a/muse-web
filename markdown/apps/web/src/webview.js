// VSCode Webview 側邊預覽：重用同一 preview.js renderer，經 postMessage 收 md
import { renderPreview } from './preview.js';

const el = document.getElementById('preview');
const vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;

async function render(md) {
  await renderPreview(el, md ?? '');
  vscode?.postMessage({ type: 'rendered', ok: true });
}

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg?.type === 'md') render(msg.text);
});

// VSCode 會在載入後 post 第一份內容；若 1s 沒收到，顯示提示
setTimeout(() => {
  if (!el.innerHTML) el.innerHTML = '<p style="color:#57606a">等待編輯器內容…（在 .md 檔執行「MD-GH: 開啟側邊預覽」）</p>';
}, 1000);
