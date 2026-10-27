import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // VITE_API_PROXY: otro API local (las pruebas e2e usan su propio puerto
      // para no chocar con `npm run dev`).
      '/api': process.env.VITE_API_PROXY ?? 'http://localhost:3001',
    },
  },
})
