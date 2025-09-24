import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 5173,
    open: false,
    proxy: {
      '/api': 'http://127.0.0.1:4100',
      '/v1': 'http://127.0.0.1:4100'
    }
  },
  preview: {
    port: 5173
  }
})
