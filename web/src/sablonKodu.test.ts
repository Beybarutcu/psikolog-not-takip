import { describe, expect, it } from 'vitest'

// Şablon (TipTap CLI) kodu projenin kodudur (tasarım E1): dışarıya
// bağlanmaz (§9 "yeni hiçbir dış bağlantı yok"), koyu tema ve resim/tema
// bileşeni taşımaz (E2, E4). Küme DİZİNDEN türetilir (on ikinci biçim).
const stiller = import.meta.glob(['./**/*.scss', './index.css'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>
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
  })
  it('stillerde uzak @import/url, Google Fonts ve .dark yok', () => {
    const ihlal: string[] = []
    for (const [yol, metin] of Object.entries(stiller)) {
      if (/@import\s+url\(/i.test(metin)) ihlal.push(`${yol}: @import url(`)
      if (/url\(\s*["']?(https?:)?\/\//i.test(metin)) ihlal.push(`${yol}: uzak url(`)
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
