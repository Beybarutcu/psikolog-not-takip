/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `@/…` → `web/src/…` (TipTap şablonunun içe aktarma kökü, tasarım E1).
  // Vitest aynı yapılandırmayı kullanır.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
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
    // Testing Library'nin `waitFor`/`findBy*` yardımcılarının KENDİ zaman
    // aşımı (1000 ms) buradan yönetilmiyor; gerekçesiyle birlikte
    // `src/test-kurulum.ts`'te ayarlanıyor. Yük altında kırılan iddialar
    // aşağıdaki `testTimeout`'u değil, o sınırı aşıyordu (dal incelemesi M6).
    setupFiles: ['./src/test-kurulum.ts'],
    // Varsayılan 5 sn burada YETMİYOR ve yetmemesi bir ürün hatası değil:
    // `AnaEkran.test.tsx` gerçek bir React ağacını `userEvent` ile sürüyor,
    // her testte birkaç `fetch` turu dönüyor ve dosya tek başına ~45 sn.
    // En yavaş testler 5 sn sınırına yakın koşuyordu ve yük altında zaman
    // aşımı verdiler.
    //
    // NOT (dal incelemesi M6): buranın eski gerekçesi "CI'da bu paket
    // `cargo test`le PARALEL çalışıyor" diyordu; **yanlıştı**.
    // `.github/workflows/ci.yml` ikisini aynı iş (job) içinde SIRAYLA
    // koşuyor (`npm --prefix web run test` sonra `cargo test --workspace`).
    // Yük, paralel bir cargo koşusundan değil; runner'ın kendi paylaşımlı
    // CPU'sundan ve bu paketin kendi çalışan paralelliğinden geliyor.
    // Sınır yine de gerekli ve gerçek bir asılı kalmayı hâlâ yakalayacak
    // kadar dar: zaman aşımıyla düşen bir test kırık bir testten ayırt
    // edilemez ve "flake" diye görmezden gelinmeye başlanır — asıl zarar bu.
    testTimeout: 20_000,
  },
})
