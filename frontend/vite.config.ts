import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  // 本地开发时后端在 3000 端口，代理 API 与 WebSocket 避免跨域/404
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/projects': 'http://localhost:3000',
      '/files': 'http://localhost:3000',
      '/exec': 'http://localhost:3000',
      '/docker': 'http://localhost:3000',
      '/ws': { target: 'http://localhost:3000', ws: true },
    },
  },
})
