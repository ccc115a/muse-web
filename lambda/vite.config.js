import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()], // dist 輸出單一 index.html：CSS/JS 全 inline，雙擊 file:// 也能開
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
