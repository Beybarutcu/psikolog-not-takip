import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EkBilgisi } from '../api'
import { RizaBolumu } from './RizaBolumu'

const onamEki: EkBilgisi = {
  id: 5,
  client_id: 12,
  dosya_adi: 'onam-formu.pdf',
  mime: 'application/pdf',
  tur: 'onam',
  boyut: 1024,
  eklenme_zamani: '2026-03-01T09:00:00Z',
}

const testEki: EkBilgisi = {
  id: 6,
  client_id: 12,
  dosya_adi: 'beck-envanteri.pdf',
  mime: 'application/pdf',
  tur: 'test',
  boyut: 2048,
  eklenme_zamani: '2026-03-02T09:00:00Z',
}

function kur(ozel: Partial<React.ComponentProps<typeof RizaBolumu>> = {}) {
  const props = {
    rizaTarihi: null as string | null,
    rizaDosyaId: null as number | null,
    ekler: [onamEki, testEki],
    onKaydet: vi.fn().mockResolvedValue(undefined),
    ...ozel,
  }
  return { ...props, ...render(<RizaBolumu {...props} />) }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RizaBolumu — rıza yoksa bilgi cümlesi', () => {
  it('riza alinmamissa bilgi cumlesi gosterir', () => {
    kur()
    expect(screen.getByText(/onam kaydı yok/i)).toBeDefined()
  })

  it('ARTI YON: riza alinmissa cumle YOKTUR ve tarih gorunur', () => {
    // Bu yarı olmadan "her zaman gösteren" bir bileşen de üstteki testi
    // geçerdi (tek yönlü mutasyon kapsamı).
    kur({ rizaTarihi: '2026-03-01' })
    expect(screen.queryByText(/onam kaydı yok/i)).toBeNull()
    expect(screen.getByText(/01\.03\.2026/)).toBeDefined()
  })

  it('bos dizgi de "riza yok" sayilir', () => {
    // Sunucuda boş dizgi göndermek alanı NULL yapıyor; ama bir güncelleme
    // yolu boş dizgiyi olduğu gibi geri döndürürse `!== null` kontrolü
    // sessizce "rıza var" derdi.
    kur({ rizaTarihi: '   ' })
    expect(screen.getByText(/onam kaydı yok/i)).toBeDefined()
  })

  // --- İncelemeci düzeltmesi (Görev 7): alarm DEĞİL, bilgi -------------
  //
  // İlk sürümde metin değişmişti ama `role="alert"` + amber kalmıştı —
  // terapist kendi danışan dosyasında imzalanmış bir onam için hâlâ sarı
  // bir alarm kutusu ve ekran okuyucuda kesintili (assertive) bir duyuru
  // görüyordu. İkisi BİRLİKTE anlam taşır (2. biçim): yalnızca birincisi
  // olsaydı, bölümü TÜMDEN SİLMEK de testi geçirirdi.

  it('onam kaydı yokken role="alert" BULUNMAZ (alarm degil bilgi)', () => {
    kur()
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('onam kaydı yokken de tarih kaydetmeyi ve imzalı dosya secmeyi SUNAR', () => {
    kur()
    expect(screen.getByLabelText('Açık rıza tarihi')).toBeDefined()
    expect(screen.getByLabelText('İmzalı onam dosyası')).toBeDefined()
  })
})

describe('RizaBolumu — imzalı onam dosyası', () => {
  it('bagli onam dosyasi indirme baglantisiyla gorunur', () => {
    kur({ rizaTarihi: '2026-03-01', rizaDosyaId: 5 })
    const bag = screen.getByRole('link', { name: /onam-formu\.pdf/ })
    expect(bag.getAttribute('href')).toBe('/api/ekler/5')
  })

  // Kullanıcı isteği 2026-09-27: seçimin doğal genişliği en uzun seçeneğinki;
  // yerleşim `e2e/uzun-metin.spec.ts`'te ölçülür (1024 px'te belge 1553 px'e
  // taşıyordu).
  it('uzun dosya adlı seçim bölümüne sığar (max-w-full); bağlı belge adı satırında bölünür', () => {
    const uzunEk = { ...onamEki, id: 9, dosya_adi: 'onam-' + 'imzaliformtaramasi'.repeat(9) + '.txt' }
    kur({ ekler: [uzunEk], rizaTarihi: '2026-03-01', rizaDosyaId: 9 })
    const secici = screen.getByLabelText('İmzalı onam dosyası')
    expect(secici.classList.contains('max-w-full')).toBe(true)
    for (const sinif of ['min-w-0', 'max-w-full']) expect(secici.parentElement!.classList.contains(sinif), sinif).toBe(true)
    const bag = screen.getByRole('link', { name: `İmzalı onam belgesi: ${uzunEk.dosya_adi}` })
    expect(bag.parentElement!.className).toContain('[overflow-wrap:anywhere]')
  })

  it('yalnizca `onam` turundeki ekler secilebilir', () => {
    // Beck envanteri bir test sonucudur, onam belgesi değil; onu "imzalı
    // onam" diye bağlamak dosyayı yanlış gösterirdi.
    kur()
    const secici = screen.getByLabelText('İmzalı onam dosyası') as HTMLSelectElement
    const metinler = Array.from(secici.options).map((o) => o.textContent ?? '')
    expect(metinler.some((m) => m.includes('onam-formu.pdf'))).toBe(true)
    expect(metinler.some((m) => m.includes('beck-envanteri.pdf'))).toBe(false)
  })

  // --- Dal incelemesi I3: onam bağlantısı da SPA'yı yıkmaz -------------
  //
  // İki bağlantı vardı (`DosyaBilgileri` ek listesi ve buradaki onam
  // bağlantısı) ve ikisi de aynı hataya sahipti. Yalnızca birini
  // düzeltmek, kod tabanındaki tanıdık hata sınıfı olurdu ("kilit_ac
  // düzeltildi, kilitle unutuldu").

  it('I3: onam baglantisi GEZINMEYI IPTAL eder ve fetchten gecer', async () => {
    const gercekFetch = globalThis.fetch
    const gercekOlustur = URL.createObjectURL
    const gercekSerbest = URL.revokeObjectURL
    const yollar: string[] = []
    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL) => {
      yollar.push(String(girdi))
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        blob: async () => new Blob(['PDF']),
      } as unknown as Response
    }) as unknown as typeof fetch
    URL.createObjectURL = vi.fn(() => 'blob:onam') as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
    try {
      kur({ rizaTarihi: '2026-03-01', rizaDosyaId: 5 })
      const bag = screen.getByRole('link', { name: /onam-formu\.pdf/ })
      // Dinleyici DOCUMENT uzerinde (gerekce icin bkz. DosyaBilgileri.test).
      let iptalEdildi = false
      document.addEventListener('click', (e) => {
        iptalEdildi = e.defaultPrevented
      })

      await userEvent.click(bag)

      expect(iptalEdildi, 'tikla gezinme iptal edilmeli').toBe(true)
      await waitFor(() => expect(yollar).toContain('/api/ekler/5'))
    } finally {
      globalThis.fetch = gercekFetch
      URL.createObjectURL = gercekOlustur
      URL.revokeObjectURL = gercekSerbest
    }
  })

  it('I3: 401de bolum EKRANDA KALIR, hata gosterilir', async () => {
    const gercekFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ hata: 'Oturum kilitli. Lütfen parolanızı girin.' }),
      blob: async () => new Blob([]),
    })) as unknown as typeof fetch
    try {
      kur({ rizaTarihi: '2026-03-01', rizaDosyaId: 5 })
      await userEvent.click(screen.getByRole('link', { name: /onam-formu\.pdf/ }))

      await waitFor(() =>
        expect(screen.getByText('Oturum kilitli. Lütfen parolanızı girin.')).toBeDefined(),
      )
      // Bölüm hâlâ ekranda: "sayfa gezinmedi"nin birim testi karşılığı.
      expect(screen.getByRole('region', { name: 'Onam' })).toBeDefined()
    } finally {
      globalThis.fetch = gercekFetch
    }
  })

  it('bagli dosya listede yoksa baglanti YERINE aciklama gosterilir', () => {
    // `attachments::sil` sarkan `riza_dosya_id`'yi temizliyor; yine de
    // ekranda "indir" diyen ölü bir bağlantı bırakmak, tıklayınca 404 veren
    // bir söz olurdu.
    kur({ rizaTarihi: '2026-03-01', rizaDosyaId: 99 })
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/bağlı onam dosyası bulunamadı/i)).toBeDefined()
  })
})

describe('RizaBolumu — rızayı kaydetme', () => {
  it('tarih ve secilen dosya ile onKaydet cagrilir', async () => {
    const { onKaydet } = kur()
    // `input[type=date]` jsdom'da karakter karakter yazmayı kabul etmez
    // (yarım değer geçersiz sayılıp temizlenir); değer doğrudan set ediliyor.
    fireEvent.change(screen.getByLabelText('Açık rıza tarihi'), { target: { value: '2026-03-01' } })
    await userEvent.selectOptions(screen.getByLabelText('İmzalı onam dosyası'), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Rızayı kaydet' }))

    await waitFor(() =>
      expect(onKaydet).toHaveBeenCalledWith({ riza_tarihi: '2026-03-01', riza_dosya_id: 5 }),
    )
  })

  it('dosya secilmezse riza_dosya_id ACIK null gider (bagi koparir)', async () => {
    // Alanı hiç göndermemek sunucuda "dokunma" demek; yanlış dosya bağlayan
    // kullanıcı onu KOPARAMAZDI (bkz. `acik_null_ayirt_et`).
    const { onKaydet } = kur({ rizaTarihi: '2026-03-01', rizaDosyaId: 5 })
    await userEvent.selectOptions(screen.getByLabelText('İmzalı onam dosyası'), '')
    await userEvent.click(screen.getByRole('button', { name: 'Rızayı kaydet' }))

    await waitFor(() => expect(onKaydet).toHaveBeenCalled())
    const gonderilen = vi.mocked(onKaydet).mock.calls[0][0]
    expect(gonderilen.riza_dosya_id).toBeNull()
    expect('riza_dosya_id' in gonderilen).toBe(true)
  })

  it('tarih bos birakilirsa kaydetmez ve nedenini soyler', async () => {
    const { onKaydet } = kur()
    await userEvent.click(screen.getByRole('button', { name: 'Rızayı kaydet' }))
    expect(onKaydet).not.toHaveBeenCalled()
    expect(screen.getByText(/rıza tarihini seçin/i)).toBeDefined()
  })

  it('kayit hatasi ekranda gorunur ve duyurulur', async () => {
    const onKaydet = vi.fn().mockRejectedValue(new Error('Rıza tarihi biçimi geçersiz.'))
    kur({ onKaydet })
    // `input[type=date]` jsdom'da karakter karakter yazmayı kabul etmez
    // (yarım değer geçersiz sayılıp temizlenir); değer doğrudan set ediliyor.
    fireEvent.change(screen.getByLabelText('Açık rıza tarihi'), { target: { value: '2026-03-01' } })
    await userEvent.click(screen.getByRole('button', { name: 'Rızayı kaydet' }))

    // Sunucudan gelen mesaj OLDUĞU GİBİ: hangi alanın neden reddedildiğini
    // yalnızca o söylüyor (AnaEkran'daki danışan ekleme ile aynı karar).
    // `getAllByRole`: eksik onam artık `alert` değil (Görev 7 düzeltmesi);
    // DOM'daki TEK `alert` bu kayıt hatasıdır, `getAllByRole` yine de
    // (tekil bir listeyle) çalışır.
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('alert')
          .map((e) => e.textContent ?? '')
          .join(' '),
      ).toContain('Rıza tarihi biçimi geçersiz.'),
    )
  })

  it('mevcut riza tarihi forma ON DOLDURULUR', async () => {
    // Aksi hâlde "yalnızca onam dosyasını değiştireyim" diyen kullanıcı
    // tarihi yeniden yazmak zorunda kalır ve unutursa doğrulama hatası alır.
    kur({ rizaTarihi: '2026-03-01', rizaDosyaId: 5 })
    expect((screen.getByLabelText('Açık rıza tarihi') as HTMLInputElement).value).toBe('2026-03-01')
    expect((screen.getByLabelText('İmzalı onam dosyası') as HTMLSelectElement).value).toBe('5')
  })
})

describe('RizaBolumu — gizlilik', () => {
  it('riza bilgileri console\'a yazilmaz', async () => {
    const gunlukler = ['log', 'info', 'warn', 'error', 'debug'] as const
    const casuslar = gunlukler.map((a) => vi.spyOn(console, a).mockImplementation(() => {}))

    const { onKaydet } = kur({ rizaTarihi: '2026-03-01', rizaDosyaId: 5 })
    await userEvent.click(screen.getByRole('button', { name: 'Rızayı kaydet' }))
    await waitFor(() => expect(onKaydet).toHaveBeenCalled())

    for (const casus of casuslar) expect(casus).not.toHaveBeenCalled()
  })
})
