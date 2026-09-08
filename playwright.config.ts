import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Tüm test dosyaları tek bir sunucu sürecini (bkz. webServer) paylaşıyor;
  // kurulum ucu en fazla bir kez başarıyla çağrılabilir ve kilit durumu
  // dosyalar arasında sızar. workers: 1, testlerin bu paylaşılan duruma
  // yarışmadan, sırayla erişmesini sağlar (bkz. e2e/yardimcilar.ts).
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:7700' },
  webServer: {
    // Arayüz sunucuya `rust_embed` ile GÖMÜLÜ geliyor (server/src/assets.rs,
    // kaynak: `../web/dist`) ve `web/dist` git-ignored. Yani derleme
    // yapılmadan e2e koşulursa Playwright, diskte kalmış ESKİ bundle'ı
    // doğrular ve sessizce yeşil verir — kaynakta duran hata hiç
    // çalıştırılmaz. Dal incelemesinde bu bizzat yaşandı: bir mutasyon
    // e2e'de sıfır etki yaptı çünkü `dist` bayattı. Bu yüzden derleme
    // sunucudan ÖNCE, aynı komutta zincirleniyor.
    //
    // `&&` bilinçli: Playwright komutu kabuk üzerinden çalıştırıyor
    // (Windows'ta cmd.exe, macOS/Linux'ta sh) — her ikisi de `&&`
    // anlıyor. `npm --prefix web` de her iki platformda aynı çalışır.
    command: 'npm --prefix web run build && cargo run -p psikolog-server --bin sunucu',
    url: 'http://127.0.0.1:7700/api/durum',
    reuseExistingServer: false,
    // Artık iki derleme var (vite + cargo); soğuk önbellekte 180 sn yetmiyor.
    timeout: 300_000,
  },
})
