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
    command: 'cargo run -p psikolog-server --bin sunucu',
    url: 'http://127.0.0.1:7700/api/durum',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
