/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    // `web/` dışındaki dosyaların METİN olarak (`?raw`) okunmasına izin
    // verir. Tek kullanıcısı `seans/sablon.test.ts`: şablon kodlarının
    // kapalı kümesi hem `core/src/store/schema.rs`'te (iki `CHECK` ve
    // `templates` tohumu) hem `web/src/seans/sablon.ts`'te yazılıdır ve o
    // test şemayı okuyup iki kopyanın ayrışmadığını doğrular. Bu yalnızca
    // geliştirme/test sunucusunu ilgilendirir — ürün derlemesini Rust
    // sunucusu `dist`'ten sunar, `dist`'e yalnızca içe aktarılan modüller
    // girer ve bu test hiçbir uygulama modülünden erişilebilir değildir.
    // İzin verilen kök, ihtiyacın TAM olarak yettiği kadar dar: `..` tüm
    // depoyu (`server/`, `.superpowers/`, kök dosyaları) `?raw` ile
    // okunabilir kılıyordu.
    fs: { allow: ['../core/src/store'] },
  },
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
