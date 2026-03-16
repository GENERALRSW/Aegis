import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: command === 'serve' ? {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://aegis-backend-2-production.up.railway.app',
        changeOrigin: true,
        secure: true,
      }
    }
  } : {},
}))