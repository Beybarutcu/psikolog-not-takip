import { describe, expect, it } from 'vitest'
import type { DanisanSeansi } from '../api'
import { varsayilanSeans } from './seansSecimi'

function s(appointment_id: number, baslangic: string): DanisanSeansi {
  return {
    appointment_id,
    baslangic,
    durum: 'planlandi',
    ucret_kurus: null,
    odendi: false,
    not_ilk_satiri: null,
    etiketler: [],
  }
}

const SIMDI = '2026-09-09T12:00'

// Son inceleme I3 (planın metni düzeltildi): varsayılan seçim "listenin ilki"
// (takvimdeki en ileri randevu) DEĞİL, bugünden önceki en yeni seans.
describe('varsayilanSeans', () => {
  it('geçmiş + gelecek karışık listede GEÇMİŞİN en yenisi seçilir (listenin ilki DEĞİL)', () => {
    // Sunucu sırası: en yeniden eskiye — ilk iki satır GELECEKTE (12 haftalık
    // seri gibi); eski kural 1 numarayı seçerdi.
    const liste = [
      s(1, '2026-12-02T10:00'),
      s(2, '2026-09-16T10:00'),
      s(3, '2026-09-02T10:00'),
      s(4, '2026-08-26T10:00'),
    ]
    expect(varsayilanSeans(liste, SIMDI)).toBe(3)
  })

  it('yalnız gelecek seans varsa EN YAKINI seçilir (en uzağı DEĞİL)', () => {
    const liste = [s(1, '2026-12-02T10:00'), s(2, '2026-10-07T10:00'), s(3, '2026-09-16T10:00')]
    expect(varsayilanSeans(liste, SIMDI)).toBe(3)
  })

  it('boş listede null', () => {
    expect(varsayilanSeans([], SIMDI)).toBeNull()
  })

  it('başlangıcı TAM şimdi olan seans geçmiş sayılır (<=)', () => {
    expect(varsayilanSeans([s(1, '2026-09-16T10:00'), s(2, SIMDI)], SIMDI)).toBe(2)
  })

  // Duvar saati karşılaştırması: `new Date('2026-09-09T13:00')` UTC sayılsaydı
  // İstanbul'da (UTC+3) 16:00 olurdu; ters yönde bir kayma 13:00'teki
  // seansı 12:00'den ÖNCE sayabilirdi. Karşılaştırma dizgi üzerinde.
  it('aynı gün, şimdiden SONRAKİ saat gelecektir; ÖNCEKİ saat geçmiştir (dizgi karşılaştırması)', () => {
    const liste = [s(1, '2026-09-09T13:00'), s(2, '2026-09-09T11:00')]
    expect(varsayilanSeans(liste, SIMDI)).toBe(2)
    expect(varsayilanSeans([s(1, '2026-09-09T13:00')], SIMDI)).toBe(1)
  })

  it('sıralamaya güvenmez: karışık sırada gelen listede de doğru seçer', () => {
    const liste = [s(1, '2026-08-26T10:00'), s(2, '2026-09-16T10:00'), s(3, '2026-09-02T10:00')]
    expect(varsayilanSeans(liste, SIMDI)).toBe(3)
  })
})
