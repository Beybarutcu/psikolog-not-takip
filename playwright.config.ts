import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:7700' },
  webServer: {
    command: 'cargo run -p psikolog-server --bin sunucu',
    url: 'http://127.0.0.1:7700/api/durum',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
