import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ornekler from '../../../core/src/store/borc_ornekleri.json'
import type { Randevu } from './HaftalikTakvim'
import { RandevuBloku } from './RandevuBloku'
import { durumSimgeMetni } from './durumSimgesi'

const temel: Randevu = {
  id: 1, client_id: 1, danisan_adi: 'Zeynep Yıldız',
  baslangic: '2026-09-07T10:00', bitis: '2026-09-07T10:50',
  durum: 'planlandi', ucret: 45000, odendi: false, seri_id: null,
}
const tamKonum = { ust: 0, yukseklik: 48, sutun: 0, sutunSayisi: 1 }

function ciz(ozel: Partial<Randevu> = {}, konum = tamKonum) {
  render(<RandevuBloku randevu={{ ...temel, ...ozel }} onSec={vi.fn()} konum={konum} />)
  return screen.getByRole('button')
}

describe('RandevuBloku — durum simgeleri (tasarım T1-T4)', () => {
  it('T3: durumu olmayan blokta ad değişmez ve simge yok', () => {
    const b = ciz()
    expect(screen.getByRole('button', { name: '10:00 Zeynep Yıldız' })).toBe(b)
    expect(b.querySelector('[data-simge]')).toBeNull()
  })

  it('T1/T3: gelmedi + ücretli + ödenmemiş -> iki simge, ad iki eki taşır', () => {
    const b = ciz({ durum: 'gelmedi' })
    expect(screen.getByRole('button', { name: '10:00 Zeynep Yıldız, gelmedi, ödeme alınmadı' })).toBe(b)
    expect(b.querySelector('[data-simge="gelmedi"]')?.getAttribute('title')).toBe('Gelmedi')
    expect(b.querySelector('[data-simge="odeme"]')?.getAttribute('title')).toBe('Ödeme alınmadı')
  })

  it('T1: geldi + ücretli + ödenmemiş -> yalnızca ₺ simgesi', () => {
    const b = ciz({ durum: 'geldi' })
    expect(screen.getByRole('button', { name: '10:00 Zeynep Yıldız, ödeme alınmadı' })).toBe(b)
    expect(b.querySelector('[data-simge="gelmedi"]')).toBeNull()
    expect(b.querySelector('[data-simge="odeme"]')).not.toBeNull()
  })

  it('T2: geldi+ödendi, planlandı ve iptal simge taşımaz (ücretli, ödenmemiş olsa da)', () => {
    for (const ozel of [{ durum: 'geldi', odendi: true }, { durum: 'planlandi' }, { durum: 'iptal' }]) {
      const { unmount } = render(
        <RandevuBloku randevu={{ ...temel, ...ozel }} onSec={vi.fn()} konum={tamKonum} />,
      )
      const b = screen.getByRole('button')
      expect(b.getAttribute('aria-label'), JSON.stringify(ozel)).toBe('10:00 Zeynep Yıldız')
      expect(b.querySelector('[data-simge]'), JSON.stringify(ozel)).toBeNull()
      unmount()
    }
  })

  it('ücretsiz (0) ya da ücreti girilmemiş gelmedi yalnızca "gelmedi" simgesi taşır', () => {
    for (const ucret of [0, null]) {
      const { unmount } = render(
        <RandevuBloku randevu={{ ...temel, durum: 'gelmedi', ucret }} onSec={vi.fn()} konum={tamKonum} />,
      )
      expect(screen.getByRole('button').getAttribute('aria-label')).toBe('10:00 Zeynep Yıldız, gelmedi')
      unmount()
    }
  })

  it('T4: yarım genişlikte simge kutusu küçülmez ve adın İÇİNDE değildir', () => {
    const b = ciz({ durum: 'gelmedi' }, { ...tamKonum, sutun: 1, sutunSayisi: 2 })
    const simgeler = b.querySelector('[data-testid="durum-simgeleri"]') as HTMLElement
    const ad = b.querySelector('[data-testid="blok-adi"]') as HTMLElement
    expect(simgeler.className).toContain('shrink-0')
    expect(simgeler.getAttribute('aria-hidden')).toBe('true')
    expect(ad.className).toContain('min-w-0')
    expect(ad.contains(simgeler)).toBe(false)
  })
})

// Ödeme simgesi borç kuralının KENDİSİNDEN türer (tasarım T1): kural
// `borc.ts`'te, örnekleri sunucuyla ortak. Simge metni kuralı yeniden
// yazsaydı bu döngü bir satırda ayrışırdı.
describe('durumSimgeMetni — borç kuralıyla ORTAK örnekler', () => {
  it('örnek dosyası tam', () => expect(ornekler.length).toBeGreaterThanOrEqual(24))
  for (const o of ornekler) {
    it(o.ad, () => {
      const metin = durumSimgeMetni({ durum: o.durum, odendi: o.odendi, ucret: o.ucret })
      expect(metin.includes('ödeme alınmadı')).toBe(o.borca_girer)
      expect(metin.includes('gelmedi')).toBe(o.durum === 'gelmedi')
    })
  }
})
