/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    // Saat dilimini test çalışanları başlamadan önce sabit, UTC-olmayan bir
    // değere kilitler (hedef kitle Türkiye). Bu olmadan CI runner'ı UTC
    // çalışıyorsa "zamandanDate UTC olarak yorumlanmaz" testi hiçbir şeyi
    // sınamayan yeşil bir teste dönüşür: new Date(dizgi) regresyonu ancak
    // yerel saat dilimi UTC'den farklıysa saat kaymasına yol açar.
    env: { TZ: 'Europe/Istanbul' },
  },
})
