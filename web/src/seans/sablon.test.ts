// Şemanın kendisi metin olarak içe aktarılıyor (`?raw`). Node'un `fs`'i
// bilerek kullanılmıyor: `tsconfig.app.json` arayüz koduna Node tiplerini
// AÇMIYOR ve bu test uğruna açmak, uygulama kodunun yanlışlıkla Node API'si
// kullanmasını tsc'nin görmemesi demek olurdu.
import semaKaynagi from '../../../core/src/store/schema.rs?raw'
import { describe, expect, it } from 'vitest'
import { SABLONLAR, SABLON_ADLARI, SABLON_KODLARI, sablonKodMu, sablonMetni } from './sablon'

describe('sablon', () => {
  it('sablon metni basliklari sirasiyla ve arada bosluk birakarak uretir', () => {
    expect(sablonMetni('dap')).toBe('Veri:\n\nDeğerlendirme:\n\nPlan:\n\n')
  })

  it('serbest sablon bos metin uretir', () => {
    expect(sablonMetni('serbest')).toBe('')
  })

  it('bilinmeyen kod bos metin uretir, hata firlatmaz', () => {
    // Editör bu çıktıyı DOĞRUDAN içeriğe yazıyor: tanınmayan bir kod
    // yüzünden kullanıcının notunun yerine "undefined" ya da bir hata
    // mesajı geçmemeli.
    expect(sablonMetni('uydurma')).toBe('')
    expect(sablonKodMu('uydurma')).toBe(false)
  })

  it('kod listesi kayittan turetilir, ikinci kez elle yazilmaz', () => {
    // Totolojik değil: iddia SABLON_KODLARI ile SABLONLAR arasında değil,
    // her kod için ad ve başlık tanımının da bulunması üzerine.
    expect([...SABLON_KODLARI].sort()).toEqual(['dap', 'serbest', 'soap'])
    for (const kod of SABLON_KODLARI) {
      expect(SABLON_ADLARI[kod]).toBeTruthy()
      expect(Array.isArray(SABLONLAR[kod])).toBe(true)
    }
  })
})

// `sablon.ts` bu kapalı kümenin dördüncü kopyasıdır (bkz. o dosyanın
// başlığı). Aşağıdaki testler kopyayı ŞEMANIN KENDİSİNE bağlar: `schema.rs`
// okunur, `CHECK` kümeleri ve `templates` tohumu ayrıştırılır. Şema
// değişip `sablon.ts` değişmezse — ya da tersi — bu testler kırılır.
//
// Kaynak dosya bulunamazsa test SESSİZCE ATLANMAZ, patlar: yolu bozulmuş
// bir dosya okuması yüzünden yeşile dönen bir test hiçbir şeyi korumaz.
describe('sablon kumesi schema.rs ile ayrisamaz', () => {
  const kaynak = semaKaynagi

  it('sema kaynagi gercekten okundu', () => {
    // Boş ya da bozuk bir okuma, aşağıdaki testleri "eşleşme yok, döngü
    // hiç dönmedi" yoluyla sessizce yeşile çevirebilirdi.
    expect(kaynak).toContain('CREATE TABLE IF NOT EXISTS templates')
  })

  function kumeAyristir(desen: RegExp): string[] {
    const eslesme = kaynak.match(desen)
    expect(eslesme, `schema.rs içinde ${desen} bulunamadı`).not.toBeNull()
    return [...eslesme![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort()
  }

  it('progress_notes.sablon CHECK kumesi SABLONLAR anahtarlariyla ayni', () => {
    expect(kumeAyristir(/CHECK \(sablon IN \(([^)]*)\)\)/)).toEqual([...SABLON_KODLARI].sort())
  })

  it('templates.kod CHECK kumesi SABLONLAR anahtarlariyla ayni', () => {
    expect(kumeAyristir(/CHECK \(kod IN \(([^)]*)\)\)/)).toEqual([...SABLON_KODLARI].sort())
  })

  it('templates tohumundaki ad ve basliklar sablon.ts ile ayni', () => {
    const blok = kaynak.match(/INSERT OR IGNORE INTO templates[\s\S]*?;/)
    expect(blok, 'schema.rs içinde templates tohumu bulunamadı').not.toBeNull()

    const satirlar = [
      ...blok![0].matchAll(/\('([a-z]+)',\s*'([^']*)',\s*'(\[[^\]]*\])'/g),
    ].map((m) => ({ kod: m[1], ad: m[2], basliklar: JSON.parse(m[3]) as string[] }))

    // Ayrıştırmanın gerçekten satır bulduğu doğrulanıyor: boş bir dizi,
    // aşağıdaki döngüyü hiç çalıştırmadan testi yeşil bırakırdı.
    expect(satirlar.length).toBe(SABLON_KODLARI.length)

    for (const satir of satirlar) {
      expect(sablonKodMu(satir.kod)).toBe(true)
      expect(SABLON_ADLARI[satir.kod as keyof typeof SABLON_ADLARI]).toBe(satir.ad)
      expect(SABLONLAR[satir.kod as keyof typeof SABLONLAR]).toEqual(satir.basliklar)
    }
  })
})
