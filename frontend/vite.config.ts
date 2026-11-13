import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 瀏覽器只跟 Vite 同一個 origin 溝通，後端不必開 CORS。dev 和 preview 都要轉
const backendProxy = {
  '/api': 'http://localhost:8080',
  '/actuator': 'http://localhost:8080',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: { proxy: backendProxy },
  preview: { proxy: backendProxy },
})
