import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/bitget-api': {
        target: 'https://api.bitget.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/bitget-api/, '')
      },
      '/anthropic-api': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/anthropic-api/, '')
      },
      '/local-server': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/local-server/, '')
      }
    }
  }
})