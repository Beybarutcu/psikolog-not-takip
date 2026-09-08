import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KeystoreBozukEkrani } from './KeystoreBozukEkrani'

describe('KeystoreBozukEkrani', () => {
  it('dosyanin silinmemesi gerektigini vurgular', () => {
    render(<KeystoreBozukEkrani />)
    expect(screen.getByText(/bu dosyayı silmeyin/i)).toBeDefined()
  })

  it('kullanicinin kendi yapabilecegi somut adimlar verir, teknik destege yonlendirmez', () => {
    // Urun tek kisilik bir muayenehane icin; "teknik destek" diye bir sey yok.
    // Kullaniciya yapamayacagi bir sey soylemek, felaket aninda onu tamamen
    // caresiz birakir.
    const { container } = render(<KeystoreBozukEkrani />)
    expect(container.textContent).not.toMatch(/teknik destek/i)

    // Yerine: yedek klasorundeki CIFTIN geri yuklenebilecegini soyleyen,
    // numaralandirilmis somut adimlar.
    expect(screen.getByRole('list')).toBeDefined()
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(3)
  })

  it('yedegin iki dosyadan olustugunu ve ikisinin birlikte geri yuklendigini soyler', () => {
    // Gorev 12 oncesi bu ekran "bir yedekten geri yukleme yapmaniz gerekebilir"
    // diyordu; bu tavsiye YANLISTI, cunku veritabani yedegi bozuk bir anahtar
    // dosyasini onarmiyordu. Artik dogru: yedek bir cifttir.
    const { container } = render(<KeystoreBozukEkrani />)
    expect(container.textContent).toMatch(/iki dosyadan/i)
    expect(container.textContent).toContain('yedek-TARİH.db')
    expect(container.textContent).toContain('yedek-TARİH.keystore.json')
  })
})
