import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// webview 模式：產出給 VSCode Webview 用的 bundle（相對路徑、單入口，多檔）
// 一般模式：單一 index.html（CSS/JS 全 inline，雙擊 file:// 也能開；同 lambda/ 作法）
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'webview' ? [] : [viteSingleFile()],
  build: {
    outDir: mode === 'webview' ? undefined : 'dist',
    emptyOutDir: true,
    rollupOptions:
      mode === 'webview'
        ? { input: 'webview.html' }
        : undefined,
  },
}));
