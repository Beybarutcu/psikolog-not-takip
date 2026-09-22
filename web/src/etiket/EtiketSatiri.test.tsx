import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Etiket } from '../api'
import { EtiketSatiri, type EtiketBaglami } from './EtiketSatiri'

// Bileşenin kendi sözleşmesi: gösterdiği şey prop'lardan gelir, yaptığı her
// yazma yukarıya (`onEkle`/`onKaldir`) doğru değerle iletilir. Yayılım ve
// istek zamanlaması `AnaEkran.yayilim.test.tsx` "Etiketler" bloklarında,
// GERÇEK kancalarla.

const KAYGI: Etiket = { id: 1, ad: 'kaygı', kullanim: 3 }
const AILE: Etiket = { id: 2, ad: 'aile', kullanim: 1 }

function kur(oz: Partial<EtiketBaglami> = {}) {
  const props: EtiketBaglami = {
    etiketler: [KAYGI],
    hata: null,
    onYenidenDene: vi.fn(),
    sozluk: null,
    onSozlukIste: vi.fn(),
    onEkle: vi.fn(async () => {}),
    onKaldir: vi.fn(async () => {}),
    onEtiketAc: vi.fn(),
    ...oz,
  }
  const sonuc = render(<EtiketSatiri kimlik="t-1" {...props} />)
  return { ...props, ...sonuc }
}

const kutu = () => screen.getByLabelText('Etiket ekle') as HTMLInputElement

describe('EtiketSatiri', () => {
  it('çipler etiketi adıyla söyleyen kaldır düğmesi taşır; kaldır doğru etiketi yukarıya iletir', async () => {
    const { onKaldir } = kur({ etiketler: [AILE, KAYGI] })
    const liste = screen.getByRole('list', { name: 'Seansın etiketleri' })
    expect(within(liste).getAllByRole('listitem')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'kaygı etiketini kaldır' }))
    expect(onKaldir).toHaveBeenCalledWith(KAYGI)
  })

  it('çipe tıklamak o etiketin seanslarını açar', async () => {
    const { onEtiketAc } = kur()
    await userEvent.click(screen.getByRole('button', { name: 'kaygı etiketli seansları göster' }))
    expect(onEtiketAc).toHaveBeenCalledWith(KAYGI)
  })

  it('Enter ile ekler (boşluklar normalleşir) ve başarıda kutuyu boşaltır', async () => {
    const { onEkle } = kur()
    await userEvent.type(kutu(), '  aile   içi {Enter}')
    expect(onEkle).toHaveBeenCalledWith('aile içi')
    expect(kutu().value).toBe('')
  })

  it('boş ya da yalnızca boşluk: Enter hiçbir şey göndermez', async () => {
    const { onEkle } = kur()
    await userEvent.type(kutu(), '   {Enter}')
    expect(onEkle).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('41 karakter: istek ATILMADAN anlaşılır hata; 40 karakter kabul (Türkçe harf de TEK karakter)', async () => {
    const { onEkle } = kur()
    await userEvent.type(kutu(), 'a'.repeat(41) + '{Enter}')
    expect(onEkle).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('Etiket adı en fazla 40 karakter olabilir.')

    // İki yön: sınırın içindeki ad reddedilmez. 'ş' UTF-8'de iki bayt —
    // bayt sayan bir denetim 40 'ş'yi 80 sanıp reddederdi.
    await userEvent.clear(kutu())
    await userEvent.type(kutu(), 'ş'.repeat(40) + '{Enter}')
    expect(onEkle).toHaveBeenCalledWith('ş'.repeat(40))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('sunucu reddederse mesaj gösterilir ve yazılan ad kutuda KALIR', async () => {
    kur({ onEkle: vi.fn(async () => Promise.reject(new Error('Kayıt bulunamadı.'))) })
    await userEvent.type(kutu(), 'kaygı{Enter}')
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Etiket eklenemedi. Kayıt bulunamadı.',
    )
    expect(kutu().value).toBe('kaygı')
  })

  it('kaldırma reddedilirse mesaj gösterilir', async () => {
    kur({ onKaldir: vi.fn(async () => Promise.reject(new Error('Kayıt bulunamadı.'))) })
    await userEvent.click(screen.getByRole('button', { name: 'kaygı etiketini kaldır' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Etiket kaldırılamadı. Kayıt bulunamadı.',
    )
  })

  it('odakta sözlük istenir; öneriler sözlükten, seansa zaten bağlı olanlar HARİÇ', async () => {
    const { onSozlukIste, container } = kur({ sozluk: [KAYGI, AILE] })
    expect(onSozlukIste).not.toHaveBeenCalled()
    await userEvent.click(kutu())
    expect(onSozlukIste).toHaveBeenCalled()
    const oneriler = [...container.querySelectorAll('datalist option')].map((o) =>
      o.getAttribute('value'),
    )
    expect(oneriler).toEqual(['aile'])
    expect(kutu().getAttribute('list')).toBe(container.querySelector('datalist')?.id)
  })

  it('yükleniyor: kutu çizilmez (liste gelmeden yazma yapılamaz)', () => {
    kur({ etiketler: null })
    expect(screen.getByText('Etiketler yükleniyor…')).toBeDefined()
    expect(screen.queryByLabelText('Etiket ekle')).toBeNull()
  })

  it('yükleme hatası "etiket yok" DEĞİLDİR: hata + Yeniden dene, kutu yok', async () => {
    const { onYenidenDene } = kur({ etiketler: null, hata: 'sunucuya ulaşılamadı' })
    const alarm = screen.getByRole('alert')
    expect(alarm.textContent).toContain('Etiketler yüklenemedi. sunucuya ulaşılamadı')
    expect(screen.queryByLabelText('Etiket ekle')).toBeNull()
    await userEvent.click(within(alarm).getByRole('button', { name: 'Yeniden dene' }))
    expect(onYenidenDene).toHaveBeenCalledTimes(1)
  })

  it('etiket adı HTML olarak değil METİN olarak basılır', () => {
    const { container } = kur({ etiketler: [{ id: 5, ad: '<b>kalın</b>', kullanim: 1 }] })
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<b>kalın</b>')
  })
})
