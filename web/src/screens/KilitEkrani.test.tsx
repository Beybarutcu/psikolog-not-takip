import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { KilitEkrani } from './KilitEkrani'

function kur() {
  const kilitAc = vi.fn(async (_g: { parola?: string; kurtarma_kodu?: string }) => ({}))
  const onAcildi = vi.fn()
  const sonuc = render(<KilitEkrani kilitAc={kilitAc} onAcildi={onAcildi} />)
  return { ...sonuc, kilitAc, onAcildi }
}

async function kurtarmaModunaGec() {
  await userEvent.click(screen.getByRole('button', { name: 'Parolamı unuttum' }))
}

describe('KilitEkrani — kurtarma kodu alani (Gorev 6b)', () => {
  it('ana parola alani type=password (kod tabaninin kendi kurali)', () => {
    kur()
    const alan = screen.getByLabelText('Ana parola') as HTMLInputElement
    expect(alan.type).toBe('password')
  })

  it('kurtarma kodu alani VARSAYILAN gizli: type=password, "Goster" dugmesiyle GECICI gorunur olur', async () => {
    // Kurtarma kodu paroladan DAHA GÜÇLÜ bir sır: tek başına, ana parola
    // hiç bilinmeden bile oturumu açar. Ekran görünürken danışan odada
    // olabilir -- kod tabanının "parola alanları type=password" kuralı
    // (bkz. `AnaEkran.test.tsx`) buraya da aynı gerekçeyle uygulanır.
    kur()
    await kurtarmaModunaGec()

    const alan = screen.getByLabelText('Kurtarma kodu') as HTMLInputElement
    expect(alan.type).toBe('password')

    await userEvent.click(screen.getByRole('button', { name: 'Göster' }))
    expect(alan.type).toBe('text')

    await userEvent.click(screen.getByRole('button', { name: 'Gizle' }))
    expect(alan.type).toBe('password')
  })

  it('"Goster" dugmesi yalnizca kurtarma modunda gorunur', () => {
    kur()
    expect(screen.queryByRole('button', { name: 'Göster' })).toBeNull()
  })

  it('parola moduna geri donunce kurtarma kodu tekrar gizlenir', async () => {
    kur()
    await kurtarmaModunaGec()
    await userEvent.click(screen.getByRole('button', { name: 'Göster' }))
    expect((screen.getByLabelText('Kurtarma kodu') as HTMLInputElement).type).toBe('text')

    // Parola moduna geri dön, sonra tekrar kurtarma moduna geç: "Göster"in
    // önceki tur sızıp yeni girilen kodu göstermemesi gerekir.
    await userEvent.click(screen.getByRole('button', { name: 'Parolayla gir' }))
    await kurtarmaModunaGec()
    expect((screen.getByLabelText('Kurtarma kodu') as HTMLInputElement).type).toBe('password')
  })

  it('kurtarma kodu dogru alanla gonderilir', async () => {
    const { kilitAc, onAcildi } = kur()
    await kurtarmaModunaGec()
    await userEvent.type(screen.getByLabelText('Kurtarma kodu'), 'ABCDE-FGHJK')
    await userEvent.click(screen.getByRole('button', { name: 'Aç' }))

    await waitFor(() => expect(kilitAc).toHaveBeenCalledWith({ kurtarma_kodu: 'ABCDE-FGHJK' }))
    expect(onAcildi).toHaveBeenCalled()
  })
})
