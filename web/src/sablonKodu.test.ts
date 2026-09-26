import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Şablon (TipTap CLI) kodu projenin kodudur (tasarım E1): dışarıya
// bağlanmaz (§9 "yeni hiçbir dış bağlantı yok"), koyu tema ve resim/tema
// bileşeni taşımaz (E2, E4). Küme DİZİNDEN türetilir (on ikinci biçim).
//
// Stiller `import.meta.glob(…, { query: '?raw' })` ile OKUNMAZ: Vitest CSS
// işlemeyi kapalı tuttuğu için (`test.css` varsayılanı) `.scss?raw` ve
// `.css?raw` BOŞ DİZGİ döner — tarama anahtarları görür, içeriği hiç görmez
// ve her iddia koşulsuz yeşil kalır (bu görevin mutasyon turunda
// `not-yuzeyi.scss`'e eklenen uzak `@import url(…)` böyle kaçtı). Dosyalar
// diskten okunur (`tema.test.ts` emsali, `process.cwd()` = `web/`) ve
// okumanın boş olmadığı ayrıca iddia edilir.
const SRC_KOKU = path.join(process.cwd(), 'src')
function stilDosyalari(dizin: string): string[] {
  return readdirSync(dizin).flatMap((ad) => {
    const tam = path.join(dizin, ad)
    if (statSync(tam).isDirectory()) return stilDosyalari(tam)
    return ad.endsWith('.scss') || tam === path.join(SRC_KOKU, 'index.css') ? [tam] : []
  })
}
const stiller: Record<string, string> = Object.fromEntries(
  stilDosyalari(SRC_KOKU).map((tam) => [`./${path.relative(SRC_KOKU, tam).split(path.sep).join('/')}`, readFileSync(tam, 'utf8')]),
)
const kod = Object.fromEntries(
  Object.entries(
    import.meta.glob(['./components/**/*.{ts,tsx}', './hooks/**/*.ts', './lib/**/*.ts', './not/**/*.{ts,tsx}'], {
      query: '?raw', import: 'default', eager: true,
    }) as Record<string, string>,
  ).filter(([yol]) => !/\.test\./.test(yol)),
)

describe('şablon kodu dışarı bağlanmaz, koyu tema ve resim taşımaz', () => {
  it('küme gerçekten okundu', () => {
    expect(Object.keys(stiller)).toContain('./styles/_variables.scss')
    expect(Object.keys(stiller)).toContain('./index.css')
    expect(Object.keys(stiller).length).toBeGreaterThan(15)
    expect(Object.keys(kod).some((y) => y.startsWith('./components/tiptap-ui/'))).toBe(true)
    // İÇERİK de okundu (boş dizgi her "yok" iddiasını yeşile çevirirdi).
    expect(stiller['./styles/_variables.scss']).toContain('--tt-gray-light-50')
    expect(stiller['./not/not-yuzeyi.scss']).toContain('.not-vurgu')
    expect(stiller['./index.css']).toContain("@import 'tailwindcss'")
    expect(kod['./not/uzantilar.ts']).toContain('baglantiIzinliMi')
  })
  it('stillerde uzak @import/url, Google Fonts ve .dark yok', () => {
    const ihlal: string[] = []
    for (const [yol, metin] of Object.entries(stiller)) {
      if (/@import\s+url\(/i.test(metin)) ihlal.push(`${yol}: @import url(`)
      if (/url\(\s*["']?(https?:)?\/\//i.test(metin)) ihlal.push(`${yol}: uzak url(`)
      // CSP `default-src 'self'` (`img-src` yok) `data:` görselini engeller:
      // şablonun onay kutusu tiki (`data:image/svg+xml` maskesi) bu yüzden
      // hiç görünmüyordu (dal sonu incelemesi I1). Çizim saf CSS ile yapılır.
      if (/url\(\s*["']?data:/i.test(metin)) ihlal.push(`${yol}: data: url( (CSP engeller)`)
      if (/fonts\.(googleapis|gstatic)/i.test(metin)) ihlal.push(`${yol}: Google Fonts`)
      if (/\.dark\b/.test(metin)) ihlal.push(`${yol}: .dark`)
    }
    expect(ihlal).toEqual([])
  })
  it('kodda uzak adres yok (SVG ad alanı hariç), resim/tema bileşeni yok', () => {
    const ihlal: string[] = []
    for (const [yol, metin] of Object.entries(kod)) {
      if (/https?:\/\//.test(metin.replaceAll('http://www.w3.org/2000/svg', ''))) ihlal.push(`${yol}: uzak adres`)
      if (/image-upload|ImageUpload|extension-image|theme-toggle|ThemeToggle/.test(metin)) ihlal.push(`${yol}: resim/tema`)
    }
    expect(ihlal).toEqual([])
  })
})
