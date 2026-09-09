import raporKaynagi from './veriRaporu.ts?raw'
import kartKaynagi from './DanisanKarti.tsx?raw'
import { describe, expect, it } from 'vitest'
import type { DanisanDosyasi, EkBilgisi, SeansNotu } from '../api'
import { veriRaporuMetni } from './veriRaporu'

const danisan: DanisanDosyasi = {
  id: 12,
  ad_soyad: 'Ayşe Yılmaz',
  telefon: '0555 111 22 33',
  durum: 'aktif',
  dogum_tarihi: '1990-04-15',
  basvuru_nedeni: 'Yoğun kaygı',
  // Risk notu terapistin klinik değerlendirmesidir, danışanın verisi
  // değildir — raporda YOKTUR (aşağıda testli).
  risk_notu: 'RISK-DEGERLENDIRMESI',
  riza_tarihi: '2026-03-01',
  riza_dosya_id: 5,
  son_temas: '2026-09-07',
  saklama_bitis: '2033-09-07',
}

const notlar: SeansNotu[] = [
  {
    appointment_id: 101,
    client_id: 12,
    seans_zamani: '2026-09-07T10:00',
    sablon: 'dap',
    icerik: 'BIRINCI-SEANS-METNI',
    guncelleme_zamani: '2026-09-07T12:00:00Z',
  },
  {
    appointment_id: 102,
    client_id: 12,
    seans_zamani: '2026-09-14T10:00',
    sablon: 'soap',
    icerik: 'IKINCI-SEANS-METNI',
    guncelleme_zamani: '2026-09-14T12:00:00Z',
  },
]

const ekler: EkBilgisi[] = [
  {
    id: 5,
    client_id: 12,
    dosya_adi: 'onam-formu.pdf',
    mime: 'application/pdf',
    tur: 'onam',
    boyut: 1024,
    eklenme_zamani: '2026-03-01T09:00:00Z',
  },
]

describe('veriRaporuMetni', () => {
  it('danisanin kimlik ve rıza alanlarini tasir', () => {
    const metin = veriRaporuMetni(danisan, notlar, ekler)
    expect(metin).toContain('Ayşe Yılmaz')
    expect(metin).toContain('0555 111 22 33')
    expect(metin).toContain('1990-04-15')
    expect(metin).toContain('2026-03-01')
  })

  it('TUM resmi notlarin icerigini tasir, ilkiyle yetinmez', () => {
    // Yalnızca ilk notu yazan bir sürüm KVKK md. 11'i eksik karşılar ve
    // eksikliği hiçbir yerde görünmez.
    const metin = veriRaporuMetni(danisan, notlar, ekler)
    expect(metin).toContain('BIRINCI-SEANS-METNI')
    expect(metin).toContain('IKINCI-SEANS-METNI')
    expect(metin).toContain('SEANS NOTLARI (2)')
  })

  it('sablon kodunu okunur ada cevirir', () => {
    const metin = veriRaporuMetni(danisan, notlar, ekler)
    expect(metin).toContain('DAP')
    expect(metin).toContain('SOAP')
  })

  it('risk notunu RAPORA KOYMAZ', () => {
    // Risk notu terapistin klinik değerlendirmesi; danışanın erişim talebine
    // verilecek veri değil. `DanisanDosyasi`'nın tamamını dökümleyen bir
    // sürüm (ör. `JSON.stringify(danisan)`) bunu sessizce sızdırırdı.
    const metin = veriRaporuMetni(danisan, notlar, ekler)
    expect(metin).not.toContain('RISK-DEGERLENDIRMESI')
  })

  it('ekleri USTVERI olarak listeler', () => {
    const metin = veriRaporuMetni(danisan, notlar, ekler)
    expect(metin).toContain('EKLİ DOSYALAR (1)')
    expect(metin).toContain('onam-formu.pdf')
    expect(metin).toContain('1024 bayt')
  })

  it('neyin DAHIL OLMADIGINI acikca yazar', () => {
    // Raporu okuyan danışan olabilir; eksikliğin sessiz kalması, dosyanın
    // tam olduğu izlenimini verirdi.
    const metin = veriRaporuMetni(danisan, notlar, ekler)
    expect(metin).toMatch(/özel notları bu rapora dahil değildir/i)
    expect(metin).toMatch(/içerik dahil değildir/i)
  })

  it('kirpilmis olabilecegini SOYLER, sessizce eksik kalmaz', () => {
    const metin = veriRaporuMetni(danisan, notlar, ekler, true)
    expect(metin).toMatch(/rapora GİRMEMİŞ olabilir/i)
  })

  it('ARTI YON: kirpilmamis raporda o uyari YOKTUR', () => {
    // Her raporda duran bir uyarı, gerçekten kırpılmış olanı görünmez yapar.
    const metin = veriRaporuMetni(danisan, notlar, ekler)
    expect(metin).not.toMatch(/rapora GİRMEMİŞ olabilir/i)
  })

  it('bos dosyada uydurma deger yerine "kayitli degil" yazar', () => {
    const bos: DanisanDosyasi = {
      ...danisan,
      telefon: null,
      dogum_tarihi: null,
      basvuru_nedeni: null,
      riza_tarihi: null,
      son_temas: null,
      saklama_bitis: null,
    }
    const metin = veriRaporuMetni(bos, [], [])
    expect(metin).not.toContain('null')
    expect(metin).not.toContain('undefined')
    expect(metin).toContain('(kayıtlı değil)')
    expect(metin).toContain('SEANS NOTLARI (0)')
  })
})

// Sunucudaki `store::search::kaynak_kodda_private_notes_gecmez` testinin
// dışa aktarım tarafındaki karşılığı. Davranışsal testler "bugünkü rapor
// özel not içermiyor" der; bu test "içerebilecek bir yol EKLENEMEZ" der.
// Sızıntının en olası biçimi, ileride birinin rapora "bir de terapistin
// kendi notlarını ekleyelim" diye ikinci bir kaynak koymasıdır.
describe('dışa aktarım kaynağında özel nota giden bir yol YOKTUR', () => {
  function kodu(kaynak: string): string {
    // Yorumlar ayıklanıyor: iki dosyanın da başlığı özel notlardan
    // BAHSEDİYOR (neden dahil olmadıklarını anlatıyor) ve bir yorum, kodun
    // yapısı hakkındaki iddiayı tatmin edemez.
    return kaynak.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  }

  it('kaynaklar gercekten okundu', () => {
    // Boş bir okuma aşağıdaki iddiaları hiçbir şeyi sınamayan yeşile
    // çevirirdi.
    expect(kodu(raporKaynagi)).toContain('export function veriRaporuMetni')
    expect(kodu(kartKaynagi)).toContain('export function DanisanKarti')
  })

  it('ne rapor uretici ne kart `ozelNotApi` / `ozel-not` gecirir', () => {
    for (const kod of [kodu(raporKaynagi), kodu(kartKaynagi)]) {
      expect(kod).not.toContain('ozelNotApi')
      expect(kod).not.toContain('ozel-not')
      expect(kod).not.toContain('OzelNot')
      expect(kod).not.toContain('private_notes')
    }
  })

  it('rapor uretici danisan nesnesini TOPLUCA dokumlemiyor', () => {
    // `JSON.stringify(danisan)` ya da `Object.entries(danisan)` bugün
    // risk notunu, yarın eklenen her yeni alanı sessizce rapora sokardı.
    // Alanların TEK TEK yazılması bilinçli bir karar.
    const kod = kodu(raporKaynagi)
    expect(kod).not.toContain('JSON.stringify')
    expect(kod).not.toContain('Object.entries')
    expect(kod).not.toContain('Object.values')
    expect(kod).not.toContain('...danisan')
  })
})
