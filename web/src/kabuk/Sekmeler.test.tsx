import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sekmeler } from './Sekmeler'
import { SEKME_KODLARI } from './sekme'

describe('Sekmeler', () => {
  it('her sekme kodu için bir sekme çizer', () => {
    render(<Sekmeler secili="takvim" onSecim={() => {}} />)
    expect(screen.getAllByRole('tab')).toHaveLength(SEKME_KODLARI.length)
  })

  it('yalnızca seçili sekme aria-selected taşır', () => {
    render(<Sekmeler secili="danisanlar" onSecim={() => {}} />)
    expect(
      screen.getByRole('tab', { name: 'Danışanlar' }).getAttribute('aria-selected'),
    ).toBe('true')
    expect(
      screen.getByRole('tab', { name: 'Takvim' }).getAttribute('aria-selected'),
    ).toBe('false')
  })

  it('tıklanan sekmenin kodunu bildirir', async () => {
    const onSecim = vi.fn()
    render(<Sekmeler secili="takvim" onSecim={onSecim} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Ayarlar' }))
    expect(onSecim).toHaveBeenCalledWith('ayarlar')
  })

  it('uyarı noktası yalnızca istenen sekmede ve metinle birlikte çıkar', () => {
    render(<Sekmeler secili="takvim" onSecim={() => {}} uyaran="ayarlar" />)
    const ayarlar = screen.getByRole('tab', { name: /Ayarlar/ })
    // Nokta GÖRSEL; sekmenin erişilebilir adı uyarıyı SÖZLE de taşımalı,
    // yoksa ekran okuyucu kullanan biri için uyarı hiç yok demektir.
    const ayarlarLabel = ayarlar.getAttribute('aria-label')
    expect(ayarlarLabel).toBeTruthy()
    expect(ayarlarLabel).toMatch(/ilgilenilmesi gereken/i)
    expect(
      screen.getByRole('tab', { name: 'Takvim' }).getAttribute('aria-label'),
    ).toBeNull()
  })
})
