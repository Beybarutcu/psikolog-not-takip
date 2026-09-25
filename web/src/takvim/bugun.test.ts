import { describe, expect, it } from 'vitest'
import type { Randevu } from './HaftalikTakvim'
import { bugunOzeti } from './bugun'

function r(id: number, baslangic: string, durum = 'planlandi', ad = `D${id}`): Randevu {
  return { id, client_id: id, danisan_adi: ad, baslangic, bitis: baslangic.slice(0, 11) + '23:00',
    durum, ucret: null, odendi: false, seri_id: null }
}
const SIMDI = '2026-09-24T11:30'

describe('bugunOzeti (tasarım A2)', () => {
  it('iptal OLMAYAN bugünkü randevuları sayar; başka günleri saymaz', () => {
    const o = bugunOzeti([
      r(1, '2026-09-24T09:00', 'geldi'), r(2, '2026-09-24T10:00', 'iptal'),
      r(3, '2026-09-24T14:00'), r(4, '2026-09-24T16:00', 'gelmedi'), r(5, '2026-09-25T10:00'),
    ], SIMDI)
    expect(o.sayi).toBe(3)
  })
  it('sıradaki = bugün, planlandi, başlangıcı şimdiden SONRA olan en erken', () => {
    const o = bugunOzeti([r(3, '2026-09-24T16:00'), r(2, '2026-09-24T14:00'), r(1, '2026-09-24T11:00')], SIMDI)
    expect(o.siradaki?.id).toBe(2)
  })
  it('şu anda süren (başlamış) seans sıradaki değildir', () => {
    expect(bugunOzeti([r(1, '2026-09-24T11:30')], SIMDI).siradaki).toBeNull()
  })
  it('eşit başlangıçta küçük id', () => {
    expect(bugunOzeti([r(9, '2026-09-24T14:00'), r(4, '2026-09-24T14:00')], SIMDI).siradaki?.id).toBe(4)
  })
  it('yarınki randevu sıradaki değildir; bugün kalmadıysa null', () => {
    expect(bugunOzeti([r(1, '2026-09-25T09:00')], SIMDI).siradaki).toBeNull()
  })
  it('geldi işaretli ileri saatli randevu sıradaki değildir (yalnızca planlandi)', () => {
    expect(bugunOzeti([r(1, '2026-09-24T15:00', 'geldi')], SIMDI).siradaki).toBeNull()
  })
})
