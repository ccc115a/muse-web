// MD-GH VSCode 插件：側邊 GitHub 級預覽 + 匯出獨立 HTML
// 不碰 git/GitHub：存檔、push、版本控制全部你在 VSCode 自己做
import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { exportMarkdownToHtml } from '@md-gh/core';

let panel = null;

function getWebviewHtml(context, panel) {
  const built = vscode.Uri.joinPath(context.extensionUri, 'media', 'webview', 'webview.html');
  if (fs.existsSync(built.fsPath)) {
    let html = fs.readFileSync(built.fsPath, 'utf8');
    html = html.replace(/(src|href)="\.\//g, (_, attr) => `${attr}="${panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview')).toString()}/`);
    return html;
  }
  return `<!doctype html><html><body><p>尚未建置 Webview bundle。請跑：<code>npm run build:webview --workspace=@md-gh/web</code></p></body></html>`;
}

function postCurrentMd() {
  const ed = vscode.window.activeTextEditor;
  if (!ed || !panel) return;
  const text = ed.document.languageId === 'markdown' ? ed.document.getText() : '';
  panel.webview.postMessage({ type: 'md', text });
}

export function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('md-gh.openPreview', () => {
      if (panel) {
        panel.reveal(vscode.ViewColumn.Beside);
      } else {
        panel = vscode.window.createWebviewPanel('mdGhPreview', 'MD 預覽（GitHub 顯示）', vscode.ViewColumn.Beside, {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        });
        panel.webview.html = getWebviewHtml(context, panel);
        panel.onDidDispose(() => (panel = null), null, context.subscriptions);
      }
      postCurrentMd();
    }),

    vscode.workspace.onDidChangeTextDocument((e) => {
      const ed = vscode.window.activeTextEditor;
      if (panel && ed && e.document === ed.document && ed.document.languageId === 'markdown') {
        panel.webview.postMessage({ type: 'md', text: ed.document.getText() });
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => postCurrentMd()),

    vscode.commands.registerCommand('md-gh.exportHtml', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return vscode.window.showWarningMessage('先開啟一個 .md 檔。');
      const md = ed.document.getText();
      const html = exportMarkdownToHtml(md);
      const srcPath = ed.document.uri.fsPath;
      const outPath = srcPath.replace(/\.md$/i, '.html');
      await vscode.workspace.fs.writeFile(vscode.Uri.file(outPath), Buffer.from(html, 'utf8'));
      const doc = await vscode.workspace.openTextDocument(outPath);
      await vscode.window.showTextDocument(doc, { preview: true });
      vscode.window.showInformationMessage(`已匯出：${path.basename(outPath)}（獨立檔，可放任何靜態主機）`);
    })
  );
}

export function deactivate() {}
