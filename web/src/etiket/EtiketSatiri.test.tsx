import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    yazmaHatasi: null,
    onYazmaHatasiTemizle: vi.fn(),
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

  // Kullanıcı isteği 2026-09-27 ("uzun metinleri de"): yerleşim
  // `e2e/uzun-metin.spec.ts`'te ölçülür; burada tek satır tasarımın sınıfları
  // ve tam adın `title`'da olduğu.
  it('uzun etiket çipte üç noktayla kısalır, tamamı title\'da; × küçülmez', () => {
    const uzun: Etiket = { id: 3, ad: 'kaygıuykusuzlukdikkat'.repeat(2).slice(0, 40), kullanim: 1 }
    kur({ etiketler: [uzun] })
    const liste = screen.getByRole('list', { name: 'Seansın etiketleri' })
    const cip = within(liste).getByRole('listitem')
    const ad = within(cip).getByRole('button', { name: `${uzun.ad} etiketli seansları göster` })
    expect(ad.getAttribute('title')).toBe(uzun.ad)
    for (const sinif of ['min-w-0', 'truncate']) expect(ad.classList.contains(sinif), sinif).toBe(true)
    for (const sinif of ['min-w-0', 'max-w-full']) {
      expect(cip.classList.contains(sinif), `çip ${sinif}`).toBe(true)
      expect(liste.classList.contains(sinif), `liste ${sinif}`).toBe(true)
    }
    expect(within(cip).getByRole('button', { name: `${uzun.ad} etiketini kaldır` }).classList.contains('shrink-0')).toBe(true)
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

  // macOS'ta "kâ" (ölü tuş ya da basılı tutma) bir IME birleştirmesidir:
  // Return harfi onaylar, etiket eklemez. Safari birleştirmeyi bitiren
  // Enter'ı `compositionend`'den SONRA, `isComposing: false` ve `keyCode`
  // 229 ile gönderir (bkz. `DanisanlarSekmesi.aramaTusu`).
  it('IME birleştirmesi sürerken Enter eklemez (isComposing ya da Safari keyCode 229); birleştirme dışında ekler', async () => {
    const { onEkle } = kur()
    await userEvent.type(kutu(), 'kâ')
    fireEvent.keyDown(kutu(), { key: 'Enter', isComposing: true })
    fireEvent.keyDown(kutu(), { key: 'Enter', keyCode: 229 })
    expect(onEkle).not.toHaveBeenCalled()
    expect(kutu().value).toBe('kâ')

    fireEvent.keyDown(kutu(), { key: 'Enter' })
    await waitFor(() => expect(onEkle).toHaveBeenCalledExactlyOnceWith('kâ'))
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

  it('sunucu reddederse yazılan ad kutuda KALIR (mesaj yukarıdan, seansa bağlı gelir)', async () => {
    kur({ onEkle: vi.fn(async () => Promise.reject(new Error('Kayıt bulunamadı.'))) })
    await userEvent.type(kutu(), 'kaygı{Enter}')
    expect(kutu().value).toBe('kaygı')
  })

  it('seansın yazma hatası gösterilir; kutuya yazmaya başlamak onu temizletir', async () => {
    const { onYazmaHatasiTemizle } = kur({ yazmaHatasi: '"kaygı" etiketi eklenemedi. Kayıt bulunamadı.' })
    expect(screen.getByRole('alert').textContent).toBe(
      '"kaygı" etiketi eklenemedi. Kayıt bulunamadı.',
    )
    await userEvent.type(kutu(), 'k')
    expect(onYazmaHatasiTemizle).toHaveBeenCalled()
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

  it('son inceleme I2: etiketlerin veri raporunda göründüğü nötr bir bilgi satırıyla söylenir (alert DEĞİL)', () => {
    kur({ etiketler: [{ id: 5, ad: 'kaygı', kullanim: 1 }] })
    const bilgi = screen.getByText('Etiketler danışan veri raporunda görünür.')
    expect(bilgi.getAttribute('role')).toBeNull()
    expect(bilgi.closest('[role="alert"]')).toBeNull()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('etiket adı HTML olarak değil METİN olarak basılır', () => {
    const { container } = kur({ etiketler: [{ id: 5, ad: '<b>kalın</b>', kullanim: 1 }] })
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<b>kalın</b>')
  })
})
