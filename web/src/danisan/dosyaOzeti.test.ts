import { describe, expect, it } from 'vitest'
import { borcToplami } from '../borc'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { ayrilmaEki, ayYil, baslangicAyi, dosyaOzeti, gunluTarihSaat, kisaTarih, kronolojik } from './dosyaOzeti'

const SIMDI = '2026-09-24T12:00' // Perşembe

/** Varsayılan bitiş başlangıcın saatinde :50 (başlangıçlar tam saat). */
function r(oz: Partial<Randevu> & { id: number; baslangic: string }): Randevu {
  return {
    client_id: 1,
    danisan_adi: 'Ayşe Kaya',
    bitis: `${oz.baslangic.slice(0, 14)}50`,
    durum: 'planlandi',
    ucret: 90000,
    odendi: false,
    seri_id: null,
    ...oz,
  }
}

describe('kronolojik (tek sıra: baslangic ASC, id ASC)', () => {
  // Birincil anahtar görünür olsun diye (bkz. docs/test-yesil-ama-korumuyor.md
  // #8) kimlik sırası başlangıç sırasının TERSİ kuruldu.
  it('önce başlangıç, eşitlikte küçük kimlik; girdi sırası önemsiz', () => {
    const liste = [
      { id: 1, baslangic: '2026-09-10T10:00' },
      { id: 9, baslangic: '2026-03-03T10:00' },
      { id: 4, baslangic: '2026-03-03T10:00' },
      { id: 2, baslangic: '2026-05-05T10:00' },
    ]
    const beklenen = [4, 9, 2, 1]
    expect([...liste].sort(kronolojik).map((x) => x.id)).toEqual(beklenen)
    expect([...liste].reverse().sort(kronolojik).map((x) => x.id)).toEqual(beklenen)
  })
})

describe('dosyaOzeti (tasarım B2)', () => {
  it('boş liste: hiçbir parça yok', () => {
    expect(dosyaOzeti([], SIMDI)).toEqual({
      geldiSayisi: 0, ilkGeldi: null, sonGeldi: null, siradaki: null, isaretlenmemis: 0, odenmemisKurus: 0,
    })
  })

  it('"N. seans" yalnızca geldi sayar (§5.1); gelmedi, iptal, planlı sayılmaz', () => {
    const o = dosyaOzeti([
      r({ id: 1, baslangic: '2026-09-01T10:00', durum: 'geldi' }),
      r({ id: 2, baslangic: '2026-09-08T10:00', durum: 'gelmedi' }),
      r({ id: 3, baslangic: '2026-09-10T10:00', durum: 'iptal' }),
      r({ id: 4, baslangic: '2026-09-15T10:00', durum: 'planlandi' }),
      r({ id: 5, baslangic: '2026-10-01T10:00', durum: 'geldi' }),
    ], SIMDI)
    expect(o.geldiSayisi).toBe(2)
  })

  it('ilk geldi: en erken başlangıç, eşitlikte KÜÇÜK kimlik; girdi sırası önemsiz', () => {
    const liste = [
      r({ id: 9, baslangic: '2026-03-03T10:00', durum: 'geldi' }),
      r({ id: 4, baslangic: '2026-03-03T10:00', durum: 'geldi' }),
      r({ id: 1, baslangic: '2026-05-05T10:00', durum: 'geldi' }),
    ]
    expect(dosyaOzeti(liste, SIMDI).ilkGeldi?.id).toBe(4)
    expect(dosyaOzeti([...liste].reverse(), SIMDI).ilkGeldi?.id).toBe(4)
  })

  it('"Son": baslangic <= simdi olan en son geldi; TAM şimdi başlayan dahil, geleceğe işaretlenmiş geldi hariç', () => {
    const o = dosyaOzeti([
      r({ id: 1, baslangic: '2026-09-17T10:00', durum: 'geldi' }),
      r({ id: 2, baslangic: SIMDI, durum: 'geldi' }),
      r({ id: 3, baslangic: '2026-09-30T10:00', durum: 'geldi' }),
      r({ id: 4, baslangic: '2026-09-23T10:00', durum: 'gelmedi' }),
    ], SIMDI)
    expect(o.sonGeldi?.id).toBe(2)
  })

  it('"Sıradaki": planlı ∧ baslangic > simdi, en erken, eşitlikte küçük kimlik; TAM şimdi başlayan ve süren seans sıradaki DEĞİL', () => {
    const o = dosyaOzeti([
      r({ id: 1, baslangic: SIMDI, durum: 'planlandi' }),
      r({ id: 2, baslangic: '2026-09-24T11:30', bitis: '2026-09-24T12:20', durum: 'planlandi' }),
      r({ id: 8, baslangic: '2026-09-24T14:00', durum: 'planlandi' }),
      r({ id: 7, baslangic: '2026-09-24T14:00', durum: 'planlandi' }),
      r({ id: 3, baslangic: '2026-09-24T13:00', durum: 'iptal' }),
      r({ id: 4, baslangic: '2026-09-24T13:30', durum: 'geldi' }),
    ], SIMDI)
    expect(o.siradaki?.id).toBe(7)
  })

  it('işaretlenmemiş: planlı ∧ bitis <= simdi; TAM şimdi biten sayılır, süren sayılmaz, işaretlenmiş sayılmaz', () => {
    const o = dosyaOzeti([
      r({ id: 1, baslangic: '2026-09-24T11:10', bitis: SIMDI, durum: 'planlandi' }),
      r({ id: 2, baslangic: '2026-09-24T11:30', bitis: '2026-09-24T12:20', durum: 'planlandi' }),
      r({ id: 3, baslangic: '2026-09-22T10:00', durum: 'planlandi' }),
      r({ id: 4, baslangic: '2026-09-22T11:00', durum: 'gelmedi' }),
    ], SIMDI)
    expect(o.isaretlenmemis).toBe(2)
  })

  it('"Ödenmemiş" borç kuralının KENDİSİ (borcToplami): gelmedi dahil, iptal ve ödenmiş hariç', () => {
    const liste = [
      r({ id: 1, baslangic: '2026-09-01T10:00', durum: 'geldi' }),
      r({ id: 2, baslangic: '2026-09-08T10:00', durum: 'gelmedi' }),
      r({ id: 3, baslangic: '2026-09-10T10:00', durum: 'iptal' }),
      r({ id: 4, baslangic: '2026-09-15T10:00', durum: 'geldi', odendi: true }),
      r({ id: 5, baslangic: '2026-09-16T10:00', durum: 'geldi', ucret: null }),
    ]
    expect(dosyaOzeti(liste, SIMDI).odenmemisKurus).toBe(180000)
    expect(dosyaOzeti(liste, SIMDI).odenmemisKurus).toBe(borcToplami(liste))
  })
})

describe('tarih metinleri (Date\'e yalnızca gün adı için çevrilir)', () => {
  // Türkçe ayrılma eki sayının OKUNUŞUNA uyar: son sıfır olmayan basamağın
  // adı (bir, iki, üç… / on, yirmi, otuz…), yoksa yüz/bin → "'den".
  it.each([
    [2000, "'den"], [2001, "'den"], [2002, "'den"], [2003, "'ten"], [2004, "'ten"],
    [2005, "'ten"], [2006, "'dan"], [2007, "'den"], [2008, "'den"], [2009, "'dan"],
    [2010, "'dan"], [2019, "'dan"], [2020, "'den"], [2025, "'ten"], [2026, "'dan"],
    [2030, "'dan"], [2040, "'tan"], [2050, "'den"], [2060, "'tan"], [2070, "'ten"],
    [2080, "'den"], [2090, "'dan"], [2100, "'den"],
  ])('%i%s', (yil, ek) => expect(ayrilmaEki(yil)).toBe(ek))

  it('ayYil ve baslangicAyi', () => {
    expect(ayYil('2026-03-03T10:00')).toBe('Mart 2026')
    expect(ayYil('2026-03')).toBe('Mart 2026')
    expect(baslangicAyi('2026-03-03T10:00')).toBe("Mart 2026'dan beri")
    expect(baslangicAyi('2025-11-04T10:00')).toBe("Kasım 2025'ten beri")
    expect(baslangicAyi('2024-01-09T10:00')).toBe("Ocak 2024'ten beri")
  })

  it('kisaTarih: bu yıl yıl yazmaz, başka yıl yazar; gece yarısına yakın saat günü kaydırmaz', () => {
    expect(kisaTarih('2026-09-17T10:00', SIMDI)).toBe('17 Eylül')
    expect(kisaTarih('2025-12-30T23:30', SIMDI)).toBe('30 Aralık 2025')
    expect(kisaTarih('2026-09-01T00:15', SIMDI)).toBe('1 Eylül')
  })

  it('gunluTarihSaat: gün adı + gün ay (+ başka yılsa yıl) + saat', () => {
    expect(gunluTarihSaat('2026-09-24T14:00', SIMDI)).toBe('Perşembe 24 Eylül 14:00')
    expect(gunluTarihSaat('2026-09-25T01:00', SIMDI)).toBe('Cuma 25 Eylül 01:00')
    expect(gunluTarihSaat('2027-01-05T14:00', SIMDI)).toBe('Salı 5 Ocak 2027 14:00')
  })
})
