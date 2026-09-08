import { describe, expect, it } from 'vitest'
import {
  dakikaFarki, haftaBasligi, haftaGunleri, haftaninBasi, yerelZaman, zamandanDate,
} from './hafta'

describe('hafta aritmetiği', () => {
  it('haftanın başı pazartesidir', () => {
    // 2026-09-09 çarşamba
    expect(yerelZaman(haftaninBasi(new Date(2026, 8, 9, 15, 30)))).toBe('2026-09-07T00:00')
  })

  it('pazar günü aynı haftaya aittir', () => {
    // 2026-09-13 pazar → hafta başı 7 Eylül
    expect(yerelZaman(haftaninBasi(new Date(2026, 8, 13, 23, 0)))).toBe('2026-09-07T00:00')
  })

  it('pazartesi kendi haftasının başıdır', () => {
    expect(yerelZaman(haftaninBasi(new Date(2026, 8, 7, 8, 0)))).toBe('2026-09-07T00:00')
  })

  it('hafta yedi gün üretir ve ay sınırını geçer', () => {
    const gunler = haftaGunleri(haftaninBasi(new Date(2026, 8, 30)))
    expect(gunler).toHaveLength(7)
    expect(yerelZaman(gunler[0])).toBe('2026-09-28T00:00')
    expect(yerelZaman(gunler[6])).toBe('2026-10-04T00:00')
  })

  it('yerelZaman tek haneli değerleri sıfırla doldurur', () => {
    expect(yerelZaman(new Date(2026, 0, 5, 9, 5))).toBe('2026-01-05T09:05')
  })

  it('zamandanDate yerel saati korur', () => {
    const d = zamandanDate('2026-09-07T14:30')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(7)
    expect(d.getHours()).toBe(14)
    expect(d.getMinutes()).toBe(30)
  })

  it('yerelZaman ve zamandanDate birbirinin tersidir', () => {
    expect(yerelZaman(zamandanDate('2026-12-31T23:45'))).toBe('2026-12-31T23:45')
  })

  it('zamandanDate UTC olarak yorumlanmaz — saat, dizgideki yerel saatle aynı kalmalı', () => {
    // new Date('2026-06-15T09:00') tarayıcıya göre UTC olarak yorumlanabilir; bu durumda
    // yerel saat dilimi UTC değilse getHours() 9'dan farklı çıkar. zamandanDate elle
    // ayrıştırıp new Date(yil, ay-1, gun, saat, dakika) kurduğu için bu kaymayı önler.
    const zaman = '2026-06-15T09:00'
    const d = zamandanDate(zaman)
    expect(d.getHours()).toBe(9)
    expect(d.getMinutes()).toBe(0)
    // new Date(...) ile UTC ayrıştırılmış olsaydı offset karşılaştırması da tutarsız olurdu.
    expect(d.getTime()).toBe(new Date(2026, 5, 15, 9, 0).getTime())
  })

  it('dakika farkı hesaplanır', () => {
    expect(dakikaFarki('2026-09-07T14:00', '2026-09-07T15:30')).toBe(90)
  })

  it('dakika farkı gün sınırını aşan aralıkta doğru hesaplanır', () => {
    // 23:30 → ertesi gün 00:30: 60 dakika. Gün sınırını geçmeyen bir çıkarım
    // yapılırsa (örn. yalnızca saat/dakika bileşenleri karşılaştırılırsa)
    // negatif ya da yanlış bir sonuç çıkar.
    expect(dakikaFarki('2026-09-07T23:30', '2026-09-08T00:30')).toBe(60)
  })

  it('hafta başlığı ay sınırını doğru yazar', () => {
    expect(haftaBasligi(new Date(2026, 8, 7))).toBe('7 – 13 Eylül 2026')
    expect(haftaBasligi(new Date(2026, 8, 28))).toBe('28 Eylül – 4 Ekim 2026')
  })

  it('hafta başlığı yıl sınırını aşan haftada her iki yılı da yazar', () => {
    // 2026-12-28 pazartesi → hafta 2027-01-03 pazar ile biter.
    expect(haftaBasligi(new Date(2026, 11, 28))).toBe('28 Aralık 2026 – 3 Ocak 2027')
  })
})
