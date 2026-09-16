import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Electron 渲染进程使用 file:// 加载时需使用相对路径
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
