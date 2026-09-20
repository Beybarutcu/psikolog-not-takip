import { readdirSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

/**
 * # Yalıtım: her spec dosyası kendi sunucusunda, kendi veri dizininde
 *
 * Plan 2'ye kadar TEK bir sunucu süreci ve TEK bir veri dizini vardı; tüm
 * spec dosyaları aynı keystore'u, aynı oturumu ve aynı veritabanını
 * paylaşıyordu. `workers: 1` bunu yalnızca MASKELİYORDU: dosyalar
 * alfabetik sırayla koşuyor ve her dosya bir öncekinin bıraktığı durumu
 * (kurulmuş keystore, KİLİTLİ oturum, önceki randevular) devralıyordu.
 * Plan 3'ün `notlar.spec.ts`'i araya girip sırayı değiştirdiğinde maske
 * düştü.
 *
 * Artık her dosyanın kendi portu var; `server/src/bin/sunucu.rs` her port
 * için ayrı bir `AppState` ve ayrı bir `<taban>/<port>` veri dizini kurar.
 * Somut kazanç: `kurulum.spec.ts` gerçekten KURULMAMIŞ bir sunucu görüyor
 * (eskiden bunu yalnızca "alfabetik olarak ilk dosya" olmasına borçluydu)
 * ve hiçbir dosya başka bir dosyanın kilit durumunu devralmıyor.
 *
 * Dosya İÇİNDEKİ testler aynı sunucuyu paylaşmaya devam eder ve sırayla
 * koşar (`fullyParallel` varsayılanı `false`) -- notlar/takvim spec'leri
 * bunu bilerek kullanıyor (bkz. o dosyaların başlıkları).
 */
const SUNUCULAR = [
  { ad: 'kurulum', spec: 'kurulum.spec.ts', port: 7700 },
  { ad: 'notlar', spec: 'notlar.spec.ts', port: 7701 },
  { ad: 'takvim', spec: 'takvim.spec.ts', port: 7702 },
  { ad: 'yedekleme', spec: 'yedekleme.spec.ts', port: 7703 },
  { ad: 'odeme', spec: 'odeme.spec.ts', port: 7704 },
  { ad: 'kabuk', spec: 'kabuk.spec.ts', port: 7705 },
] as const

// Bir spec dosyası hiçbir projeye bağlı değilse Playwright onu SESSİZCE
// koşmaz -- yeni bir dosya eklenip buraya port tanımlanmazsa testleri
// hiç çalışmadan "12 passed" görürüz. Bu kontrol o sessizliği bir hataya
// çevirir (ters yön de: listede olup diskte olmayan dosya).
const diskteki: string[] = readdirSync('./e2e').filter((f) => f.endsWith('.spec.ts'))
const tanimli: string[] = SUNUCULAR.map((s) => s.spec)
const kapsanmayan = diskteki.filter((f) => !tanimli.includes(f))
const kayip = tanimli.filter((f) => !diskteki.includes(f))
if (kapsanmayan.length > 0 || kayip.length > 0) {
  throw new Error(
    `playwright.config.ts SUNUCULAR listesi e2e/ ile uyumsuz. ` +
      `Porta bağlanmamış (koşulmayacak) dosyalar: [${kapsanmayan.join(', ')}]. ` +
      `Listede olup diskte olmayan: [${kayip.join(', ')}].`,
  )
}

const PORTLAR = SUNUCULAR.map((s) => s.port)

export default defineConfig({
  testDir: './e2e',

  // Yalıtım artık yapısal (dosya başına sunucu + veri dizini), yani
  // `workers: 1` gerekmiyor: üç dosya üç ayrı sunucuya konuşuyor,
  // paylaşılan hiçbir durum kalmadı. Sınır, dosya sayısı kadar
  // paralellik -- daha fazlası boşuna, çünkü dosya içi testler zaten
  // sırayla koşuyor.
  workers: SUNUCULAR.length,

  // Varsayılan 5 sn burada YETERSİZ ve bu ÖLÇÜLDÜ: kilit açma
  // (`POST /api/kilit-ac`) Argon2id ile 64 MiB / t=3 türetme yapıyor ve
  // e2e sunucusu DEBUG profilinde derleniyor -- boştaki bu makinede tek
  // bir kilit açma ~2,1 sn, kurulum (iki sarmalama) ~4,3 sn sürüyor.
  // Yani "Aç"a basıp ana başlığı bekleyen her iddia 5 sn'lik bütçenin
  // yarısını daha ilk anda harcıyordu; yüklü bir makinede (CI) bütçe
  // aşılıyor ve test, ÜRÜN DOĞRU ÇALIŞTIĞI HÂLDE kırılıyordu.
  //
  // Bu iddiaları zayıflatmaz: hepsi aynı koşulu bekliyor, yalnızca daha
  // uzun bekliyor. Negatif iddialar (`toHaveCount(0)`) da güvende, çünkü
  // hepsi ekrandaki geçişi zaten sabitleyen bir bariyerin (ör. "Kilitli"
  // başlığı) ARDINDAN geliyor -- o noktada sayı çoktan 0.
  expect: { timeout: 15_000 },

  // Tek bir testin içinde art arda iki kilit açma olabiliyor (kurulum
  // yardımcısı + testin kendi kilitle/aç adımı); yukarıdaki ölçümle
  // varsayılan 30 sn dar kalıyor. Bu da bir iddiayı gevşetmez, yalnızca
  // testin toplam bütçesidir.
  timeout: 90_000,

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
    //
    // TEK komut, TEK süreç, ÜÇ port: `webServer` bir dizi de kabul eder
    // ama girdilerini PARALEL başlatır — üç `npm run build` aynı
    // `web/dist`'e yazar ve üç `cargo run` derleme kilidinde sıraya
    // girerdi. Süreç içindeki port başına yalıtım için bkz.
    // `server/src/bin/sunucu.rs::portlari_coz`.
    command: 'npm --prefix web run build && cargo run -p psikolog-server --bin sunucu',
    env: { PSIKOLOG_E2E_PORTLAR: PORTLAR.join(',') },
    // İlk port hazırsa hepsi hazırdır: `sunucu.rs` önce TÜM portları
    // bağlar, sonra hiç `await` etmeden hepsinin servis görevini oluşturur.
    url: `http://127.0.0.1:${PORTLAR[0]}/api/durum`,
    reuseExistingServer: false,
    // İki derleme var (vite + cargo); soğuk önbellekte 180 sn yetmiyor.
    timeout: 300_000,
  },

  projects: SUNUCULAR.map(({ ad, spec, port }) => ({
    name: ad,
    testMatch: spec,
    use: { baseURL: `http://127.0.0.1:${port}` },
  })),
})
