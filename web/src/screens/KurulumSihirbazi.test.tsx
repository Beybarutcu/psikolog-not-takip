import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { KurulumSihirbazi } from './KurulumSihirbazi'

describe('KurulumSihirbazi', () => {
  it('kisa parolayi reddeder ve sunucuya gitmez', async () => {
    const kurulumYap = vi.fn()
    render(<KurulumSihirbazi kurulumYap={kurulumYap} onTamam={() => {}} onGeriYukle={() => {}} />)

    await userEvent.type(screen.getByLabelText('Ana parola'), 'kisa')
    await userEvent.type(screen.getByLabelText('Parola tekrar'), 'kisa')
    await userEvent.click(screen.getByRole('button', { name: 'Devam et' }))

    expect(screen.getByText(/en az 8 karakter/i)).toBeDefined()
    expect(kurulumYap).not.toHaveBeenCalled()
  })

  it('parolalar eslesmezse uyarir', async () => {
    const kurulumYap = vi.fn()
    render(<KurulumSihirbazi kurulumYap={kurulumYap} onTamam={() => {}} onGeriYukle={() => {}} />)

    await userEvent.type(screen.getByLabelText('Ana parola'), 'gizliparola')
    await userEvent.type(screen.getByLabelText('Parola tekrar'), 'baskaparola')
    await userEvent.click(screen.getByRole('button', { name: 'Devam et' }))

    expect(screen.getByText(/aynı değil/i)).toBeDefined()
    expect(kurulumYap).not.toHaveBeenCalled()
  })

  it('kurtarma kodunu gosterir ve onaylanmadan devam ettirmez', async () => {
    const kurulumYap = vi.fn().mockResolvedValue({ kurtarma_kodu: 'ABCDE-FGHJK-MNPQR-STVWX-YZ234' })
    const onTamam = vi.fn()
    render(<KurulumSihirbazi kurulumYap={kurulumYap} onTamam={onTamam} onGeriYukle={() => {}} />)

    await userEvent.type(screen.getByLabelText('Ana parola'), 'gizliparola')
    await userEvent.type(screen.getByLabelText('Parola tekrar'), 'gizliparola')
    await userEvent.click(screen.getByRole('button', { name: 'Devam et' }))

    expect(await screen.findByText('ABCDE-FGHJK-MNPQR-STVWX-YZ234')).toBeDefined()

    const devam = screen.getByRole('button', { name: 'Kurulumu bitir' })
    expect(devam.hasAttribute('disabled')).toBe(true)

    await userEvent.click(screen.getByLabelText(/kurtarma kodunu kaydettim/i))
    expect(devam.hasAttribute('disabled')).toBe(false)

    await userEvent.click(devam)
    expect(onTamam).toHaveBeenCalled()
  })

  it('kurtarma kodu ekraninda yedegin iki dosyadan olustugunu soyler', async () => {
    // Kullanici yedek klasorunu elle tasiyabilir/kopyalayabilir. Yalnizca .db
    // dosyasini tasirsa yedegi geri yuklenemez hale gelir; bunu ogrenecegi tek
    // an, ogrenmenin fayda etmeyecegi an olur.
    const kurulumYap = vi.fn().mockResolvedValue({ kurtarma_kodu: 'ABCDE-FGHJK-MNPQR-STVWX-YZ234' })
    const { container } = render(<KurulumSihirbazi kurulumYap={kurulumYap} onTamam={() => {}} onGeriYukle={() => {}} />)

    await userEvent.type(screen.getByLabelText('Ana parola'), 'gizliparola')
    await userEvent.type(screen.getByLabelText('Parola tekrar'), 'gizliparola')
    await userEvent.click(screen.getByRole('button', { name: 'Devam et' }))
    await screen.findByText('ABCDE-FGHJK-MNPQR-STVWX-YZ234')

    expect(container.textContent).toMatch(/iki dosyadan/i)
    expect(container.textContent).toMatch(/birlikte/i)
  })
})
