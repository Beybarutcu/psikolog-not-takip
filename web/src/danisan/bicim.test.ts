import { describe, expect, it } from 'vitest'
import { boyutBicimle, kalanGun, tarihBicimle, tlBicimle } from './bicim'

describe('tarihBicimle', () => {
  it('YYYY-AA-GG degerini GG.AA.YYYY yapar', () => {
    expect(tarihBicimle('2026-03-01')).toBe('01.03.2026')
  })

  it('gun ve ay sifirlarini KORUR', () => {
    // "1.3.2026" yazan bir biçimlendirme de üstteki testi geçemezdi ama
    // sıfırları düşüren bir mutasyon burada görünür olsun.
    expect(tarihBicimle('2026-12-31')).toBe('31.12.2026')
    expect(tarihBicimle('2026-01-09')).toBe('09.01.2026')
  })

  it('tanimadigi bicimi OLDUGU GIBI dondurur', () => {
    // Uydurulmuş bir tarih göstermek, ham değeri göstermekten kötüdür.
    expect(tarihBicimle('bilinmiyor')).toBe('bilinmiyor')
    expect(tarihBicimle('')).toBe('')
  })
})

describe('tlBicimle', () => {
  it('kurusu virgullu TL metnine cevirir', () => {
    expect(tlBicimle(45000)).toBe('450,00 ₺')
    expect(tlBicimle(0)).toBe('0,00 ₺')
  })

  it('kurus basamaklarini KAYBETMEZ', () => {
    // Tam sayıya yuvarlayan bir mutasyon 450,50'yi 450,00 yapar ve bunu
    // yalnızca bu vaka gösterir.
    expect(tlBicimle(45050)).toBe('450,50 ₺')
    expect(tlBicimle(1)).toBe('0,01 ₺')
  })
})

describe('boyutBicimle', () => {
  it('esiklerin HER IKI yaninda dogru birimi secer', () => {
    expect(boyutBicimle(512)).toBe('512 B')
    expect(boyutBicimle(1023)).toBe('1023 B')
    expect(boyutBicimle(1024)).toBe('1,0 KB')
    expect(boyutBicimle(1024 * 1024 - 1)).toBe('1024,0 KB')
    expect(boyutBicimle(1024 * 1024)).toBe('1,0 MB')
    expect(boyutBicimle(20 * 1024 * 1024)).toBe('20,0 MB')
  })
})

describe('kalanGun', () => {
  it('ileri tarihte POZITIF, gecmiste NEGATIF, bugunde SIFIR', () => {
    // Üç yön birlikte: yalnızca pozitif vaka yazılsaydı, farkın işaretini
    // ters çeviren bir mutasyon (bugun - bitis) yakalanmazdı.
    expect(kalanGun('2026-09-09', '2026-09-10')).toBe(1)
    expect(kalanGun('2026-09-09', '2026-09-09')).toBe(0)
    expect(kalanGun('2026-09-09', '2026-09-08')).toBe(-1)
  })

  it('artik gunu ve yil sinirini dogru sayar', () => {
    // 2028 artık yıl: 2028-02-28 -> 2028-03-01 iki gündür.
    expect(kalanGun('2028-02-28', '2028-03-01')).toBe(2)
    // 2027 artık değil: aynı aralık bir gün.
    expect(kalanGun('2027-02-28', '2027-03-01')).toBe(1)
    expect(kalanGun('2026-12-31', '2027-01-01')).toBe(1)
  })

  it('yedi yillik saklama penceresini dogru sayar', () => {
    // 2026-09-09 -> 2033-09-07: 7 yıl (2028 ve 2032 artık) eksi iki gün.
    expect(kalanGun('2026-09-09', '2033-09-07')).toBe(2555)
  })

  it('bozuk bicimde SAYI UYDURMAZ', () => {
    // `null` "hesaplanamadı" demek; `NaN` ya da 0 döndüren bir sürüm
    // ekranda "bugün doluyor" yazardı.
    expect(kalanGun('2026-09-09', 'bilinmiyor')).toBeNull()
    expect(kalanGun('', '2026-09-09')).toBeNull()
    expect(kalanGun('2026-09-09', '2026-09')).toBeNull()
  })
})
