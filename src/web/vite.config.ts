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
  define: {
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'import.meta.env.VITE_NODE_VERSION': JSON.stringify(process.version)
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
