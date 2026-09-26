import { describe, expect, it } from 'vitest'
import type { DanisanSeansi } from '../api'
import { seansGruplari } from './seansGruplari'

const SIMDI = '2026-09-20T12:00'

function s(appointment_id: number, baslangic: string, durum = 'geldi'): DanisanSeansi {
  return { appointment_id, baslangic, durum, ucret_kurus: 90000, odendi: false, not_ilk_satiri: null, etiketler: [] }
}
const kimlikler = (liste: DanisanSeansi[]) => liste.map((x) => x.appointment_id)

describe('seansGruplari (tasarım B3)', () => {
  it('Yaklaşan = baslangic > simdi, durumdan bağımsız, EN YAKIN üstte; eşitlikte küçük kimlik', () => {
    const g = seansGruplari(
      [s(5, '2026-10-01T14:00', 'planlandi'), s(4, '2026-09-24T14:00', 'geldi'), s(3, '2026-09-24T14:00', 'iptal'), s(1, '2026-09-14T10:00')],
      SIMDI,
    )
    expect(kimlikler(g.yaklasan)).toEqual([3, 4, 5])
    expect(g.aylar.map((a) => kimlikler(a.seanslar))).toEqual([[1]])
  })

  it('TAM şimdi başlayan seans GEÇMİŞTİR (A2: baslangic <= simdi)', () => {
    const g = seansGruplari([s(1, SIMDI, 'planlandi')], SIMDI)
    expect(g.yaklasan).toEqual([])
    expect(g.aylar.map((a) => a.baslik)).toEqual(['Eylül 2026'])
  })

  it('geçmiş aylara göre: en yeni ay ve ay içinde en yeni üstte; yıl sınırı ayrı ay; başlık sayısı yalnızca geldi', () => {
    const liste = [
      s(1, '2026-08-25T10:00', 'iptal'), s(4, '2026-09-14T10:00'), s(2, '2026-09-01T10:00'),
      s(3, '2026-09-07T10:00', 'gelmedi'), s(9, '2025-12-30T10:00'), s(10, '2026-01-06T10:00'),
    ]
    const g = seansGruplari(liste, SIMDI)
    expect(g.aylar.map((a) => [a.baslik, kimlikler(a.seanslar)])).toEqual([
      ['Eylül 2026 · 2 seans', [4, 3, 2]],
      ['Ağustos 2026', [1]],
      ['Ocak 2026 · 1 seans', [10]],
      ['Aralık 2025 · 1 seans', [9]],
    ])
    // Girdi sırasına güvenilmez.
    expect(seansGruplari([...liste].reverse(), SIMDI)).toEqual(g)
  })

  it('aynı başlangıçlı iki geçmiş seans: büyük kimlik üstte (sunucunun `id DESC`\'i)', () => {
    const g = seansGruplari([s(4, '2026-09-14T10:00'), s(7, '2026-09-14T10:00')], SIMDI)
    expect(kimlikler(g.aylar[0].seanslar)).toEqual([7, 4])
  })

  it('boş liste', () => expect(seansGruplari([], SIMDI)).toEqual({ yaklasan: [], aylar: [] }))
})
