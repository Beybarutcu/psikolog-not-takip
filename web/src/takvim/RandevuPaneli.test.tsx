import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RandevuPaneli } from './RandevuPaneli'

const danisanlar = [
  { id: 1, ad_soyad: 'Ayşe Yılmaz', telefon: null, durum: 'aktif' },
  { id: 2, ad_soyad: 'Mehmet Demir', telefon: null, durum: 'aktif' },
]

const mevcut = {
  id: 7, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
  baslangic: '2026-09-07T14:00', bitis: '2026-09-07T15:00',
  durum: 'planlandi', ucret: 45000, odendi: false, seri_id: null,
}

// Çakışma yanıtı I2 ile çıplak dizi olmaktan çıkıp nesne oldu (hafta
// sayısını taşıyor); testlerin kısa yazılabilmesi için iki yardımcı.
const temizCakisma = { cakisanlar: [], cakisan_hafta_sayisi: 0, kontrol_edilen_hafta: 1 }

function cakismaYaniti(
  cakisanlar: (typeof mevcut)[],
  cakisan_hafta_sayisi = cakisanlar.length,
  kontrol_edilen_hafta = 1,
) {
  return { cakisanlar, cakisan_hafta_sayisi, kontrol_edilen_hafta }
}

function kur(ozel = {}) {
  const props = {
    zaman: '2026-09-07T14:00',
    randevu: null as typeof mevcut | null,
    danisanlar,
    onKaydet: vi.fn().mockResolvedValue(undefined),
    onSil: vi.fn().mockResolvedValue(undefined),
    onSeriSil: vi.fn().mockResolvedValue(undefined),
    seriSayisiAl: vi.fn().mockResolvedValue({ adet: 9, notAdedi: 0 }),
    silinecekNotSayisiAl: vi.fn().mockResolvedValue(0),
    onKapat: vi.fn(),
    cakismaKontrol: vi.fn().mockResolvedValue(temizCakisma),
    ...ozel,
  }
  render(<RandevuPaneli {...props} />)
  return props
}

describe('RandevuPaneli', () => {
  it('yeni randevuda danışan seçilmeden kaydetmez', async () => {
    const props = kur()
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(screen.getByText(/danışan seçin/i)).toBeDefined()
    expect(props.onKaydet).not.toHaveBeenCalled()
  })

  it('danışan ve süre ile kaydeder', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(props.onKaydet).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 2,
        baslangic: '2026-09-07T14:00',
        bitis: '2026-09-07T15:00',
      }),
    )
  })

  it('ücreti kuruşa çevirir', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.clear(screen.getByLabelText('Ücret (TL)'))
    await userEvent.type(screen.getByLabelText('Ücret (TL)'), '450')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(props.onKaydet).toHaveBeenCalledWith(expect.objectContaining({ ucret: 45000 }))
  })

  it('çakışma varsa uyarır ama kaydetmeyi engellemez', async () => {
    const props = kur({ cakismaKontrol: vi.fn().mockResolvedValue(cakismaYaniti([mevcut])) })
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '2')

    await waitFor(() => expect(screen.getByText(/bu saatte başka randevu var/i)).toBeDefined())

    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(props.onKaydet).toHaveBeenCalled()
  })

  it('tekrar sayısı verilince kaydete geçirilir', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.click(screen.getByLabelText('Her hafta tekrarla'))
    await userEvent.clear(screen.getByLabelText('Kaç hafta'))
    await userEvent.type(screen.getByLabelText('Kaç hafta'), '8')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(props.onKaydet).toHaveBeenCalledWith(expect.objectContaining({ tekrar_sayisi: 8 }))
  })

  // Plan 4 Görev 2: durum düğmeleri SEANS PANELİNİN alt satırına taşındı
  // (tasarım §6: "geldi/gelmedi/iptal + ücret + ödendi" tek satırda). İki
  // panel aynı anda açık olduğundan burada kalsalardı ekranda iki "Geldi"
  // düğmesi olurdu. Çalıştıkları yer: `SeansPaneli.test.tsx` ve
  // `AnaEkran.test.tsx` ("Geldi" isaretlemek ...).
  it('durum düğmeleri randevu panelinde YOK (ne mevcut ne yeni randevuda)', () => {
    kur({ randevu: mevcut })
    expect(screen.queryByRole('button', { name: 'Geldi' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Gelmedi' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'İptal' })).toBeNull()
  })

  it('silme onay ister', async () => {
    const props = kur({ randevu: mevcut })
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    expect(props.onSil).not.toHaveBeenCalled()

    await userEvent.click(await screen.findByRole('button', { name: 'Evet, sil' }))
    expect(props.onSil).toHaveBeenCalledWith(7)
  })

  // --- Dal incelemesi I2: onay metni NOTLARDAN da söz eder --------------
  //
  // `ON DELETE CASCADE`: randevu silinince seans notu ve özel not da gider.
  // Onay metni ("Bu randevu kalıcı olarak silinsin mi?") bunu hiç
  // söylemiyordu.

  it('I2: tekil silme onayi, silinecek NOT sayisini sunucudan alir ve soyler', async () => {
    const silinecekNotSayisiAl = vi.fn().mockResolvedValue(2)
    const props = kur({ randevu: mevcut, silinecekNotSayisiAl })

    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))

    expect(silinecekNotSayisiAl).toHaveBeenCalledWith(7)
    const uyari = await screen.findByText(/2 not .*da kalıcı olarak silinecek/i)
    expect(uyari.textContent).toMatch(/geri getirilemez/i)
    // İlk tıklama hâlâ silmiyor: onay iki adımlı kalıyor.
    expect(props.onSil).not.toHaveBeenCalled()
  })

  it('I2: not YOKSA uyari cikmaz, "not yok" yazar', async () => {
    // ARTI/EKSİ yön: her silmede çıkan bir uyarı okunmaz hâle gelir ve
    // gerçekten not olan durumda işe yaramaz.
    kur({ randevu: mevcut, silinecekNotSayisiAl: vi.fn().mockResolvedValue(0) })

    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))

    expect(await screen.findByText(/seans notu veya özel not yok/i)).toBeDefined()
    expect(screen.queryByText(/kalıcı olarak silinecek/i)).toBeNull()
  })

  it('I2: sayi alinamazsa onay kutusu ACILMAZ', async () => {
    // Ne gideceğini söyleyemeyen bir onay, onay değildir. (Kilitli oturumda
    // 401 gelir; o hâlde silme de reddedilecektir.)
    const props = kur({
      randevu: mevcut,
      silinecekNotSayisiAl: vi.fn().mockRejectedValue(new Error('Oturum kilitli.')),
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))

    await waitFor(() => expect(screen.getByText('Oturum kilitli.')).toBeDefined())
    expect(screen.queryByRole('button', { name: 'Evet, sil' })).toBeNull()
    expect(props.onSil).not.toHaveBeenCalled()
  })

  it('I2: seri silme onayi da NOT sayisini soyler', async () => {
    const props = kur({
      randevu: { ...mevcut, seri_id: 'seri-abc' },
      seriSayisiAl: vi.fn().mockResolvedValue({ adet: 12, notAdedi: 7 }),
    })

    await userEvent.click(screen.getByRole('button', { name: /bu ve sonraki tüm tekrarları sil/i }))

    expect(await screen.findByText(/12 randevu/)).toBeDefined()
    const uyari = await screen.findByText(/7 not .*da kalıcı olarak silinecek/i)
    // "Geçmiş korunur" sözü notlar için de yazılı.
    expect(uyari.textContent).toMatch(/geçmiş randevuların notları korunur/i)
    expect(props.onSeriSil).not.toHaveBeenCalled()
  })

  it('I2: seri silmede not yoksa uyari cikmaz', async () => {
    kur({
      randevu: { ...mevcut, seri_id: 'seri-abc' },
      seriSayisiAl: vi.fn().mockResolvedValue({ adet: 12, notAdedi: 0 }),
    })

    await userEvent.click(screen.getByRole('button', { name: /bu ve sonraki tüm tekrarları sil/i }))

    expect(await screen.findByText(/Silinecek randevulara bağlı seans notu veya özel not yok/i))
      .toBeDefined()
    expect(screen.queryByText(/kalıcı olarak silinecek. Notlar/i)).toBeNull()
  })

  // --- Görev 10 inceleme bulguları --------------------------------------

  afterEach(() => {
    vi.useRealTimers()
  })

  it('Bulgu 2: kaydet sürerken düğme devre dışı kalır, çift tıklama tek çağrı üretir', async () => {
    let cozKaydet: () => void = () => {}
    const onKaydet = vi.fn(
      () => new Promise<void>((resolve) => {
        cozKaydet = resolve
      }),
    )
    const props = kur({ onKaydet })
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')

    const kaydetDugmesi = screen.getByRole('button', { name: 'Kaydet' })
    await userEvent.click(kaydetDugmesi)
    expect((kaydetDugmesi as HTMLButtonElement).disabled).toBe(true)

    // İşlem sürerken ikinci tıklama devre dışı düğmede yok sayılır.
    await userEvent.click(kaydetDugmesi)
    expect(props.onKaydet).toHaveBeenCalledTimes(1)

    cozKaydet()
    await waitFor(() => expect((kaydetDugmesi as HTMLButtonElement).disabled).toBe(false))
  })

  it('Bulgu 2: silme sürerken "Evet, sil" devre dışı kalır, çift tıklama tek çağrı üretir', async () => {
    let cozSil: () => void = () => {}
    const onSil = vi.fn(
      () => new Promise<void>((resolve) => {
        cozSil = resolve
      }),
    )
    const props = kur({ randevu: mevcut, onSil })
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))

    const evetSil = screen.getByRole('button', { name: 'Evet, sil' })
    await userEvent.click(evetSil)
    expect((evetSil as HTMLButtonElement).disabled).toBe(true)

    await userEvent.click(evetSil)
    expect(props.onSil).toHaveBeenCalledTimes(1)

    cozSil()
    await waitFor(() => expect((evetSil as HTMLButtonElement).disabled).toBe(false))
  })

  it('Bulgu 3: çakışma kontrolü süre değişince gecikmeli (debounce) çağrılır', async () => {
    vi.useFakeTimers()
    try {
      const cakismaKontrol = vi.fn().mockResolvedValue(temizCakisma)
      kur({ cakismaKontrol })

      // Mount anında bir zamanlayıcı kurulur ama 300ms dolmadan istek gitmez.
      await act(() => vi.advanceTimersByTimeAsync(200))
      expect(cakismaKontrol).not.toHaveBeenCalled()
      await act(() => vi.advanceTimersByTimeAsync(100))
      expect(cakismaKontrol).toHaveBeenCalledTimes(1)

      const sureAlani = screen.getByLabelText('Süre (dakika)')
      // Art arda üç değişiklik — eski yarış durumu koruması (iptal bayrağı)
      // hâlâ geçerli olmalı, ama debounce sayesinde tek istek gitmeli.
      fireEvent.change(sureAlani, { target: { value: '61' } })
      fireEvent.change(sureAlani, { target: { value: '62' } })
      fireEvent.change(sureAlani, { target: { value: '63' } })

      await act(() => vi.advanceTimersByTimeAsync(200))
      expect(cakismaKontrol).toHaveBeenCalledTimes(1) // henüz 300ms dolmadı

      await act(() => vi.advanceTimersByTimeAsync(150))
      expect(cakismaKontrol).toHaveBeenCalledTimes(2) // yalnızca son değerle
    } finally {
      vi.useRealTimers()
    }
  })

  it('Bulgu 5: ücret sayıya çevrilemiyorsa kaydetmeyi durdurur ve uyarı gösterir', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.clear(screen.getByLabelText('Ücret (TL)'))
    await userEvent.type(screen.getByLabelText('Ücret (TL)'), 'abc')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(screen.getByText(/ücret.*sayısal/i)).toBeDefined()
    expect(props.onKaydet).not.toHaveBeenCalled()
  })

  it('Bulgu 5: ücret alanı boşsa kaydetmeye devam eder (null geçerli)', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.clear(screen.getByLabelText('Ücret (TL)'))
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(props.onKaydet).toHaveBeenCalledWith(expect.objectContaining({ ucret: null }))
  })

  // --- Dal incelemesi I4a: seri silme ---------------------------------

  const seriUyesi = { ...mevcut, seri_id: 'seri-abc' }

  it('I4a: seri üyesi olmayan randevuda seri silme seçeneği görünmez', () => {
    kur({ randevu: mevcut })
    expect(screen.queryByRole('button', { name: /sonraki tüm tekrarları sil/i })).toBeNull()
  })

  it('I4a: seri üyesinde tekil silme ile seri silme birlikte sunulur', () => {
    kur({ randevu: seriUyesi })
    expect(screen.getByRole('button', { name: 'Sil' })).toBeDefined()
    expect(screen.getByRole('button', { name: /bu ve sonraki tüm tekrarları sil/i }).textContent)
      .toBeDefined()
  })

  it('I4a: seri silme iki adımlı onay ister, adet gösterir ve geçmişin korunduğunu söyler', async () => {
    const props = kur({
      randevu: seriUyesi,
      seriSayisiAl: vi.fn().mockResolvedValue({ adet: 9, notAdedi: 0 }),
    })

    await userEvent.click(screen.getByRole('button', { name: /bu ve sonraki tüm tekrarları sil/i }))
    expect(props.seriSayisiAl).toHaveBeenCalledWith('seri-abc', '2026-09-07T14:00')

    // İlk tıklama silmez: yalnızca onay açar.
    expect(props.onSeriSil).not.toHaveBeenCalled()
    const onay = await screen.findByText(/9 randevu/i)
    expect(onay.textContent).toMatch(/geçmiş randevular silinmez/i)

    await userEvent.click(screen.getByRole('button', { name: 'Evet, tekrarları sil' }))
    expect(props.onSeriSil).toHaveBeenCalledWith('seri-abc', '2026-09-07T14:00')
  })

  it('I4a: seri silme onayından vazgeçilebilir', async () => {
    const props = kur({ randevu: seriUyesi })
    await userEvent.click(screen.getByRole('button', { name: /bu ve sonraki tüm tekrarları sil/i }))
    await screen.findByRole('button', { name: 'Evet, tekrarları sil' })

    await userEvent.click(screen.getByRole('button', { name: 'Vazgeç' }))
    expect(screen.queryByRole('button', { name: 'Evet, tekrarları sil' })).toBeNull()
    expect(props.onSeriSil).not.toHaveBeenCalled()
  })

  it('I4a: seri silme sürerken düğme devre dışı kalır, çift tıklama tek çağrı üretir', async () => {
    let cozSil: () => void = () => {}
    const onSeriSil = vi.fn(
      () => new Promise<void>((resolve) => {
        cozSil = resolve
      }),
    )
    const props = kur({ randevu: seriUyesi, onSeriSil })
    await userEvent.click(screen.getByRole('button', { name: /bu ve sonraki tüm tekrarları sil/i }))

    const evet = await screen.findByRole('button', { name: 'Evet, tekrarları sil' })
    await userEvent.click(evet)
    expect((evet as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(evet)
    expect(props.onSeriSil).toHaveBeenCalledTimes(1)

    cozSil()
    await waitFor(() => expect((evet as HTMLButtonElement).disabled).toBe(false))
  })

  // --- Dal incelemesi I2: seri çapında çakışma ------------------------

  it('I2: tekrar açıkken çakışma kontrolü tekrar sayısıyla birlikte sorulur', async () => {
    const cakismaKontrol = vi.fn().mockResolvedValue(temizCakisma)
    kur({ cakismaKontrol })

    await userEvent.click(screen.getByLabelText('Her hafta tekrarla'))
    await userEvent.clear(screen.getByLabelText('Kaç hafta'))
    await userEvent.type(screen.getByLabelText('Kaç hafta'), '12')

    await waitFor(() =>
      expect(cakismaKontrol).toHaveBeenCalledWith(
        '2026-09-07T14:00',
        '2026-09-07T15:00',
        undefined,
        12,
      ),
    )
  })

  it('I2: tekrar kapalıyken tekrar sayısı gönderilmez', async () => {
    const cakismaKontrol = vi.fn().mockResolvedValue(temizCakisma)
    kur({ cakismaKontrol })

    await waitFor(() => expect(cakismaKontrol).toHaveBeenCalled())
    expect(cakismaKontrol.mock.calls[0][3]).toBeUndefined()
  })

  // Üç geçersiz biçim: boş alan (`Number('') === 0`), açıkça sıfır ve üst
  // sınırın bir üstü. Önceden yalnızca '53' deneniyordu; boş alan hem burada
  // hem kaydetme yolunda en olası kullanıcı hatası.
  for (const ham of ['', '0', '53']) {
    it(`I2: geçersiz hafta sayısı (${ham === '' ? 'boş' : ham}) tekrar sayısı olarak gönderilmez`, async () => {
      const cakismaKontrol = vi.fn().mockResolvedValue(temizCakisma)
      kur({ cakismaKontrol })

      await userEvent.click(screen.getByLabelText('Her hafta tekrarla'))
      await userEvent.clear(screen.getByLabelText('Kaç hafta'))
      if (ham !== '') await userEvent.type(screen.getByLabelText('Kaç hafta'), ham)

      await waitFor(() => expect(cakismaKontrol).toHaveBeenCalled())
      for (const cagri of cakismaKontrol.mock.calls) {
        expect(cagri[3]).toBeUndefined()
      }
    })
  }

  // --- Dal incelemesi son tur, madde 4: sessiz TEK randevu --------------
  //
  // "Her hafta tekrarla" açıkken alan boşsa `Number('') = 0` sunucuya
  // gidiyor, sunucu `Some(n) if n > 1` ile eşleşmediği için `tekil_olustur`a
  // düşüyordu: kullanıcı seri istiyor, tek kayıt alıyor, HİÇBİR hata
  // görmüyordu. Artık kaydetme yolu çakışma sorgusuyla aynı süzgeci
  // kullanıyor ve geçersiz değerde durup söylüyor.

  for (const ham of ['', '0', '53']) {
    it(`madde 4: tekrar açıkken geçersiz hafta sayısı (${ham === '' ? 'boş' : ham}) sessizce tek randevu oluşturmaz`, async () => {
      const props = kur()
      await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
      await userEvent.click(screen.getByLabelText('Her hafta tekrarla'))
      await userEvent.clear(screen.getByLabelText('Kaç hafta'))
      if (ham !== '') await userEvent.type(screen.getByLabelText('Kaç hafta'), ham)

      await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

      // Ne sessizce tek randevu oluşur...
      expect(props.onKaydet).not.toHaveBeenCalled()
      // ...ne de kullanıcı ne olduğunu bilmeden kalır.
      expect(screen.getByText(/tekrar sayısı 2 ile 52 arasında/i)).toBeDefined()
    })
  }

  it('madde 4: tekrar kapalıyken hafta alanının geçersiz kalıntı değeri kaydetmeyi engellemez', async () => {
    // Kullanıcı kutuyu işaretleyip alanı boşaltmış, sonra kutuyu geri
    // kaldırmış olabilir: bu durumda seri istemiyor, tek randevu istiyor.
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.click(screen.getByLabelText('Her hafta tekrarla'))
    await userEvent.clear(screen.getByLabelText('Kaç hafta'))
    await userEvent.click(screen.getByLabelText('Her hafta tekrarla'))

    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(props.onKaydet).toHaveBeenCalledTimes(1)
    expect(props.onKaydet.mock.calls[0][0].tekrar_sayisi).toBeUndefined()
  })

  it('I2: seri uyarısı kaç haftada çakışma olduğunu söyler ama kaydetmeyi engellemez', async () => {
    const props = kur({
      cakismaKontrol: vi.fn().mockResolvedValue(cakismaYaniti([mevcut], 8, 12)),
    })
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '2')
    await userEvent.click(screen.getByLabelText('Her hafta tekrarla'))

    await waitFor(() =>
      expect(screen.getByText(/12 haftalık serinin 8 haftasında başka randevu var/i)).toBeDefined(),
    )

    // Karar değişmedi: uyarır, engellemez.
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(props.onKaydet).toHaveBeenCalled()
  })

  it('I2: çakışma kontrolü başarısız olursa panel çökmez ve kaydetme engellenmez', async () => {
    const props = kur({ cakismaKontrol: vi.fn().mockRejectedValue(new Error('ağ hatası')) })
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')

    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(props.onKaydet).toHaveBeenCalled()
    expect(screen.queryByText(/ağ hatası/i)).toBeNull()
  })

  // --- Dal incelemesi C1: iki kipin KESİŞTİĞİ düğme -------------------
  //
  // Bu dosyadaki sekiz testin hepsi ya `randevu: null` ile kaydediyor ya
  // `randevu: mevcut` ile durum/silme deniyordu. Kaydet düğmesi her iki
  // kipte de görünüyor ama hiçbir test onu düzenleme kipinde denemiyordu —
  // C1 bu boşlukta yaşadı. Aşağıdaki testler tam o kesişimi kapsıyor.

  it('C1: mevcut randevuda düğme "Güncelle" yazar, yeni randevuda "Kaydet"', () => {
    kur({ randevu: mevcut })
    expect(screen.getByRole('button', { name: 'Güncelle' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Kaydet' })).toBeNull()
  })

  it('C1: mevcut randevuda alanlar kayıttan dolar ve güncelleme onKaydet ile bildirilir', async () => {
    const props = kur({ randevu: mevcut })

    // Düzenleme kipi: alanlar mevcut kayıttan doluyor.
    expect((screen.getByLabelText('Danışan') as HTMLSelectElement).value).toBe('1')
    expect((screen.getByLabelText('Ücret (TL)') as HTMLInputElement).value).toBe('450')

    await userEvent.clear(screen.getByLabelText('Ücret (TL)'))
    await userEvent.type(screen.getByLabelText('Ücret (TL)'), '500')
    await userEvent.click(screen.getByRole('button', { name: 'Güncelle' }))

    expect(props.onKaydet).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 1,
        baslangic: '2026-09-07T14:00',
        bitis: '2026-09-07T15:00',
        ucret: 50000,
      }),
    )
    // Düzenleme kipinde seri alanı yok, dolayısıyla tekrar_sayisi da yok:
    // mevcut bir randevuyu "8 hafta tekrarla" ile kaydetmek anlamsız.
    expect(props.onKaydet.mock.calls[0][0].tekrar_sayisi).toBeUndefined()
  })

  it('C1: mevcut randevuda tekrar (seri) alanı görünmez', () => {
    kur({ randevu: mevcut })
    expect(screen.queryByLabelText('Her hafta tekrarla')).toBeNull()
    expect(screen.queryByLabelText('Kaç hafta')).toBeNull()
  })

  it('Bulgu 4: sunucu hatası panelin içinde de gösterilir', async () => {
    const onKaydet = vi.fn().mockRejectedValue(new Error('Ücret negatif olamaz.'))
    kur({ onKaydet })
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(await screen.findByText('Ücret negatif olamaz.')).toBeDefined()
  })
})
