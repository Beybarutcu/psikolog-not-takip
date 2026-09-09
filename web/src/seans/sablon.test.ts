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

  // Desenler DOSYANIN TAMAMINDA değil, YALNIZCA V3 betiğinin içinde aranır.
  //
  // Düz bir `kaynak.match(...)` dosyadaki İLK eşleşmeyi alır ve `schema.rs`
  // yoğun Türkçe gerekçe yorumlarıyla doludur: DDL'in üstündeki bir `///`
  // yorumuna eski kümeyi yazan biri, gerçek `CHECK`'leri değiştirmiş olsa
  // bile bu testleri yeşil bırakırdı — yani testin TEK VARLIK SEBEBİ olan
  // iddia bir yorumla tatmin edilirdi. Betik bir Rust ham dizgisi
  // (`r#"…"#`) olduğu için yorumlar tanım gereği onun DIŞINDADIR; kapsamı
  // ona daraltmak bu yolu kapatır.
  const v3Eslesme = kaynak.match(/const V3: &str = r#"([\s\S]*?)"#;/)
  const v3 = v3Eslesme === null ? '' : v3Eslesme[1]

  it('sema kaynagi gercekten okundu ve V3 betigi ayiklandi', () => {
    // Boş ya da bozuk bir okuma, aşağıdaki testleri "eşleşme yok, döngü
    // hiç dönmedi" yoluyla sessizce yeşile çevirebilirdi.
    expect(kaynak).toContain('CREATE TABLE IF NOT EXISTS templates')
    expect(v3Eslesme, 'schema.rs içinde `const V3: &str = r#"…"#;` bulunamadı').not.toBeNull()
    expect(v3).toContain('CREATE TABLE IF NOT EXISTS templates')
    // Kapsamın gerçekten DARALDIĞI ölçülüyor: ayıklama tüm dosyayı geri
    // verseydi (ya da desen kaçsaydı) yukarıdaki iddialar yine geçerdi.
    expect(v3.length).toBeLessThan(kaynak.length)
    // Ayıklanan parça bir SQL betiği: içinde Rust yorumu olamaz. Bu iddia
    // düşerse aşağıdaki `CHECK` aramaları yine yorumlara bakıyor demektir.
    expect(v3).not.toContain('///')
    expect(v3).not.toContain('//')
  })

  function kumeAyristir(desen: RegExp): string[] {
    const eslesme = v3.match(desen)
    expect(eslesme, `V3 betiği içinde ${desen} bulunamadı`).not.toBeNull()
    return [...eslesme![1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort()
  }

  it('progress_notes.sablon CHECK kumesi SABLONLAR anahtarlariyla ayni', () => {
    expect(kumeAyristir(/CHECK \(sablon IN \(([^)]*)\)\)/)).toEqual([...SABLON_KODLARI].sort())
  })

  it('templates.kod CHECK kumesi SABLONLAR anahtarlariyla ayni', () => {
    expect(kumeAyristir(/CHECK \(kod IN \(([^)]*)\)\)/)).toEqual([...SABLON_KODLARI].sort())
  })

  it('templates tohumundaki ad ve basliklar sablon.ts ile ayni', () => {
    const blok = v3.match(/INSERT OR IGNORE INTO templates[\s\S]*?;/)
    expect(blok, 'V3 betiği içinde templates tohumu bulunamadı').not.toBeNull()

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
