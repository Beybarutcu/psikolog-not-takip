import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DanisanDosyasi, EkBilgisi } from '../api'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { DosyaBilgileri } from './DosyaBilgileri'

const danisan: DanisanDosyasi = {
  id: 12,
  ad_soyad: 'Ayşe Yılmaz',
  telefon: '0555 111 22 33',
  durum: 'aktif',
  dogum_tarihi: '1990-04-15',
  basvuru_nedeni: 'Yoğun kaygı ve uyku sorunu',
  risk_notu: 'Geçmişte bir kez kendine zarar verme',
  riza_tarihi: '2026-03-01',
  riza_dosya_id: 5,
  son_temas: '2026-09-07',
  saklama_bitis: '2033-09-07',
}

const ekler: EkBilgisi[] = [
  {
    id: 5,
    client_id: 12,
    dosya_adi: 'onam-formu.pdf',
    mime: 'application/pdf',
    tur: 'onam',
    boyut: 1024,
    eklenme_zamani: '2026-03-01T09:00:00Z',
  },
  {
    id: 6,
    client_id: 12,
    dosya_adi: 'beck-envanteri.pdf',
    mime: 'application/pdf',
    tur: 'test',
    boyut: 2 * 1024 * 1024,
    eklenme_zamani: '2026-03-02T09:00:00Z',
  },
]

function randevu(ozel: Partial<Randevu>): Randevu {
  return {
    id: 1,
    client_id: 12,
    danisan_adi: 'Ayşe Yılmaz',
    baslangic: '2026-09-07T10:00',
    bitis: '2026-09-07T11:00',
    durum: 'geldi',
    ucret: 45000,
    odendi: false,
    seri_id: null,
    ...ozel,
  }
}

let uretilenBloblar: Blob[]
const gercekOlustur = URL.createObjectURL
const gercekSerbest = URL.revokeObjectURL

beforeEach(() => {
  uretilenBloblar = []
  // jsdom `createObjectURL`i uygulamıyor; hem taklit ediliyor hem de üretilen
  // Blob yakalanıyor (rapor içeriğini ölçmenin tek yolu bu).
  URL.createObjectURL = vi.fn((b: Blob) => {
    uretilenBloblar.push(b)
    return `blob:rapor-${uretilenBloblar.length}`
  }) as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
})

afterEach(() => {
  URL.createObjectURL = gercekOlustur
  URL.revokeObjectURL = gercekSerbest
  vi.restoreAllMocks()
})

function kur(ozel: Partial<React.ComponentProps<typeof DosyaBilgileri>> = {}) {
  const props = {
    danisan,
    ekler,
    randevular: [randevu({ id: 1, durum: 'geldi', odendi: false, ucret: 45000 })],
    bugun: '2026-09-09',
    veriRaporuIndir: vi.fn().mockResolvedValue(undefined),
    ekYukle: vi.fn().mockResolvedValue(undefined),
    ekSil: vi.fn().mockResolvedValue(undefined),
    onRizaKaydet: vi.fn().mockResolvedValue(undefined),
    onKapat: vi.fn(),
    ...ozel,
  }
  return { ...props, ...render(<DosyaBilgileri {...props} />) }
}

describe('DosyaBilgileri — kimlik ve bağlam', () => {
  it('son inceleme I2: veri raporu açıklaması etiketlerin rapora GİRDİĞİNİ ve özel notların girmediğini söyler (alert DEĞİL)', () => {
    kur()
    const aciklama = screen.getByText(/Seans etiketleri rapora dahil edilir/)
    expect(aciklama.textContent).toContain('terapistin özel notları dahil edilmez')
    expect(aciklama.closest('[role="alert"]')).toBeNull()
  })

  it('iletisim, basvuru nedeni ve bakiye gorunur', () => {
    kur()
    // Ad artık `DanisanDosyasi` başlığında (son inceleme I2); bu bölüm adı İKİNCİ kez basmaz.
    expect(screen.queryByText('Ayşe Yılmaz')).toBeNull()
    expect(screen.getByRole('region', { name: 'Danışan bilgileri' })).toBeDefined()
    expect(screen.getByText(/0555 111 22 33/)).toBeDefined()
    expect(screen.getByText(/Yoğun kaygı ve uyku sorunu/)).toBeDefined()
    // 45000 kuruş = 450,00 TL.
    expect(screen.getByText('450,00 TL')).toBeDefined()
  })

  it('telefon yoksa "kayitli degil" der, bos satir birakmaz', () => {
    kur({ danisan: { ...danisan, telefon: null, basvuru_nedeni: null } })
    expect(screen.getAllByText(/kayıtlı değil/i).length).toBeGreaterThan(0)
  })

  it('risk notu KENDILIGINDEN basilmaz, katlanmis gelir', () => {
    // Kart danışanın adının hemen altında ve terapist onu danışan odadayken
    // açıyor. Kendiliğinden basılan bir risk notu omzun üstünden okunur.
    kur()
    expect(document.body.textContent).not.toContain('Geçmişte bir kez kendine zarar verme')
    // Notun VAR OLDUĞU görünür kalıyor: bağlam bu.
    expect(screen.getByRole('button', { name: 'Risk notunu göster' })).toBeDefined()
  })

  it('istenince acilir ve tekrar kapanir', async () => {
    kur()
    const dugme = screen.getByRole('button', { name: 'Risk notunu göster' })
    expect(dugme.getAttribute('aria-expanded')).toBe('false')

    await userEvent.click(dugme)
    expect(screen.getByText(/Geçmişte bir kez kendine zarar verme/)).toBeDefined()

    // Geri kapanabiliyor: açılıp bir daha kapanmayan bir alan, katlamayı
    // kartın ömrü boyunca tek seferlik bir gecikmeye indirger.
    await userEvent.click(screen.getByRole('button', { name: 'Risk notunu gizle' }))
    expect(document.body.textContent).not.toContain('Geçmişte bir kez kendine zarar verme')
  })

  it('risk notu yoksa katlama dugmesi de YOKTUR', () => {
    // Boş bir notu açtırmak için düğme koymak, "bir şey gizleniyor"
    // izlenimi verirdi.
    kur({ danisan: { ...danisan, risk_notu: null } })
    expect(screen.queryByRole('button', { name: /risk notunu/i })).toBeNull()
  })
})

// Bakiye para meselesidir: yanlış bir sayı, hiç sayı olmamasından kötüdür.
// Sayılan küme İÇEREN (whitelist) bir kuralla tanımlı — dışlayıcı `WHERE`
// deseni (`durum != 'iptal'`) bu kod tabanında bilerek yayılmıyor.
describe('DosyaBilgileri — bakiye ne sayar, ne saymaz', () => {
  it('gelinmis ve odenmemis seanslarin ucreti TOPLANIR', () => {
    kur({
      randevular: [
        randevu({ id: 1, durum: 'geldi', odendi: false, ucret: 45000 }),
        randevu({ id: 2, durum: 'geldi', odendi: false, ucret: 30000 }),
      ],
    })
    expect(screen.getByText('750,00 TL')).toBeDefined()
  })

  // Plan 4 Görev 4 inceleme I2: kart eskiden kendi biçimini (`"1800,00 ₺"`)
  // basıyordu, ay sonu özeti `"1.800,00 TL"`. Aynı borç iki ekranda farklı
  // görünüyordu. Binlik ayraç yalnızca 1000 TL üstünde görünür; 450 TL'lik
  // kurulumlar onu hiç sınamıyordu.
  it('bakiye ay sonu ozetiyle AYNI bicimde: binlik ayrac nokta, para birimi TL', () => {
    kur({
      randevular: [
        randevu({ id: 1, durum: 'geldi', odendi: false, ucret: 150000 }),
        randevu({ id: 2, durum: 'geldi', odendi: false, ucret: 30000 }),
      ],
    })
    expect(screen.getByText('1.800,00 TL')).toBeDefined()
    expect(document.body.textContent).not.toContain('₺')
    expect(document.body.textContent).not.toContain('1800,00')
  })

  it('odenmis seans bakiyeye GIRMEZ', () => {
    kur({
      randevular: [
        randevu({ id: 1, durum: 'geldi', odendi: true, ucret: 45000 }),
        randevu({ id: 2, durum: 'geldi', odendi: false, ucret: 30000 }),
      ],
    })
    expect(screen.getByText('300,00 TL')).toBeDefined()
  })

  it('planlanmis, iptal ve gelmedi durumlari bakiyeye GIRMEZ', () => {
    // Gelecek bir randevu henüz borç değildir; iptal edilen de. "Gelmedi"
    // ücretlendirmesi terapistin politikasına bağlı olduğu için bu ekran
    // onu borç saymaz — etiket neyi saydığını açıkça yazar.
    kur({
      randevular: [
        randevu({ id: 1, durum: 'planlandi', odendi: false, ucret: 45000 }),
        randevu({ id: 2, durum: 'iptal', odendi: false, ucret: 45000 }),
        randevu({ id: 3, durum: 'gelmedi', odendi: false, ucret: 45000 }),
      ],
    })
    expect(screen.getByText('0,00 TL')).toBeDefined()
  })

  it('ucreti girilmemis seans bakiyeyi bozmaz', () => {
    kur({
      randevular: [
        randevu({ id: 1, durum: 'geldi', odendi: false, ucret: null }),
        randevu({ id: 2, durum: 'geldi', odendi: false, ucret: 30000 }),
      ],
    })
    expect(screen.getByText('300,00 TL')).toBeDefined()
  })

  it('bakiye etiketi NEYI saydigini soyler', () => {
    // "Bakiye: 0,00 TL" tek başına, ücreti hiç girilmemiş bir dosyada
    // "borcu yok" diye okunur. Etiket kapsamı yazmazsa sayı yanıltıcıdır.
    kur()
    expect(screen.getByText(/gelinmiş ve ödenmemiş seanslar/i)).toBeDefined()
  })

  it('bakiye NEYI SAYMADIGINI da soyler', () => {
    // Neyi saydığını yazmak yetmiyor: "gelmedi" işaretli seanslar sayının
    // dışında ve bu, gelmeyen seansları ücretlendiren bir terapist için
    // sessizce eksik bir bakiyedir. Ekran o dışlamayı açıkça yazmalı.
    kur()
    expect(screen.getByText(/'Gelmedi' olarak işaretlenen seanslar bu sayıya girmez/i))
      .toBeDefined()
  })

  it('Plan 4: etiket GERCEGI soyler -- odeme isaretleme yolu artik VAR', () => {
    // Dal incelemesi I1'de etiket "işaretleme yolu henüz yok" diye
    // dürüstleştirilmişti. Plan 4 Görev 2 seans panelinin alt satırına
    // "Ödendi" kutusunu (`PATCH /api/randevular/{id}/odeme`) ekledi: sayı
    // artık ödemelerle GERÇEKTEN azalıyor. O cümle kalsaydı, bu kez var
    // olan bir mekanizmayı yok diye anlatırdı.
    kur()
    expect(
      screen.getByText(
        "Bakiye: gelinmiş ve ödenmemiş seanslar. 'Gelmedi' olarak işaretlenen seanslar bu sayıya girmez.",
      ),
    ).toBeDefined()
    // EKSI YON: artık yanlış olan eski ibare ekranda KALMAMALI.
    expect(document.body.textContent).not.toContain('işaretleme yolu henüz yok')
    expect(document.body.textContent).not.toContain('bu tutardan düşmez')
  })
})

describe('DosyaBilgileri — onam ve saklama', () => {
  it('riza alinmamissa bilgi cumlesi gosterir', () => {
    kur({ danisan: { ...danisan, riza_tarihi: null, riza_dosya_id: null } })
    expect(screen.getByText(/onam kaydı yok/i)).toBeDefined()
  })

  it('ARTI YON: riza varsa o cumle YOKTUR', () => {
    kur()
    expect(screen.queryByText(/onam kaydı yok/i)).toBeNull()
  })

  // --- Görev 7: KVKK uyarı dili -> bilgi dili --------------------------
  //
  // İkisi BİRLİKTE anlam taşır (bkz. `docs/test-yesil-ama-korumuyor.md`
  // 2. biçim): yalnızca birincisi olsaydı, bölümü TÜMDEN SİLMEK de testi
  // geçirirdi. İkincisi bölümün hâlâ ÇALIŞTIĞINI, yalnızca dilinin
  // değiştiğini ölçüyor.

  it('dosya bilgileri suçlayıcı KVKK uyarısı içermez', () => {
    kur({ danisan: { ...danisan, riza_tarihi: null, riza_dosya_id: null } })
    expect(screen.queryByText(/uyumsuzluğudur/)).toBeNull()
  })

  it('onam bölümü imzalı dosya yüklemeyi hâlâ sunar', () => {
    // NOT: baş harf küçük/büyük harf DUYARSIZ eşleşmiyor -- Türkçe 'İ'
    // JS'in varsayılan (yerel olmayan) `/i` bayrağında 'i'ye KATLANMIYOR
    // (bkz. `AyarlarSekmesi.test.tsx`teki aynı tuzak); bu yüzden regex
    // baş harfi atlıyor.
    kur()
    expect(screen.getByLabelText(/mzalı onam/i)).toBeDefined()
  })

  // --- İncelemeci düzeltmesi (Görev 7): alarm DEĞİL, bilgi -------------
  //
  // İkisi BİRLİKTE anlam taşır (2. biçim, aynı ilke): yalnızca birincisi
  // olsaydı, bölümü TÜMDEN SİLMEK de testi geçirirdi; yalnızca ikincisi
  // olsaydı `role="alert"`in geri gelmesini YAKALAMAZDI.

  it('onam kaydı yokken role="alert" BULUNMAZ (alarm degil bilgi)', () => {
    kur({ danisan: { ...danisan, riza_tarihi: null, riza_dosya_id: null } })
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('onam kaydı yokken de tarih kaydetmeyi ve imzalı dosya secmeyi SUNAR', () => {
    kur({ danisan: { ...danisan, riza_tarihi: null, riza_dosya_id: null } })
    expect(screen.getByLabelText('Açık rıza tarihi')).toBeDefined()
    expect(screen.getByLabelText(/mzalı onam dosyası/i)).toBeDefined()
  })

  it('saklama bitis tarihi ve kalan sure gorunur', () => {
    // bugun 2026-09-09, bitis 2033-09-07 → 2555 gün.
    kur()
    const bolum = screen.getByRole('region', { name: 'Saklama süresi' })
    expect(bolum.textContent).toContain('07.09.2033')
    expect(bolum.textContent).toContain('2555 gün')
  })

  it('saklama suresi dolduysa bunu soyler ve OTOMATIK SILINMEDIGINI yazar', () => {
    // Plan global kısıtı: süresi dolan dosyalar yalnızca listelenir; imha
    // kararını her zaman insan verir. Ekran "silindi" izlenimi vermemeli.
    kur({ danisan: { ...danisan, saklama_bitis: '2026-09-08' } })
    const bolum = screen.getByRole('region', { name: 'Saklama süresi' })
    expect(bolum.textContent).toMatch(/süresi doldu/i)
    expect(bolum.textContent).toMatch(/kendiliğinden silinmez/i)
  })

  it('saklama bitisi hesaplanmamissa bos sayi uydurmaz', () => {
    kur({ danisan: { ...danisan, saklama_bitis: null, son_temas: null } })
    const bolum = screen.getByRole('region', { name: 'Saklama süresi' })
    expect(bolum.textContent).toMatch(/henüz hesaplanmadı/i)
    expect(bolum.textContent).not.toMatch(/gün kaldı/)
  })
})

describe('DosyaBilgileri — ekli dosyalar', () => {
  it('ekli dosyalar listelenir, icerik indirme baglantisiyla acilir', async () => {
    kur()
    const bolum = screen.getByRole('region', { name: 'Ekli dosyalar' })
    const onam = within(bolum).getByRole('link', { name: /onam-formu\.pdf/ })
    expect(onam.getAttribute('href')).toBe('/api/ekler/5')
    const beck = within(bolum).getByRole('link', { name: /beck-envanteri\.pdf/ })
    expect(beck.getAttribute('href')).toBe('/api/ekler/6')
    // Boyut okunabilir biçimde: 2 MB.
    expect(bolum.textContent).toContain('2,0 MB')
  })

  it('ek dosya ICERIGI ekrana basilmaz, yalnizca ustveri', () => {
    // Sunucu `Content-Disposition: attachment` gönderiyor; içeriği JS'e
    // çekip gömülü göstermek o kararı arayüzde geri alırdı.
    kur()
    const bolum = screen.getByRole('region', { name: 'Ekli dosyalar' })
    expect(bolum.querySelector('iframe')).toBeNull()
    expect(bolum.querySelector('embed')).toBeNull()
    expect(bolum.querySelector('object')).toBeNull()
    expect(bolum.querySelector('img')).toBeNull()
  })

  // --- Dal incelemesi I3: bağlantı SPA'yı yıkmaz ----------------------
  //
  // Düz `<a href>` iken 401 yolunda (sunucu `Content-Disposition`
  // göndermiyor) tarayıcı ham JSON'a GEZİNİYOR, React ağacı ve aynı JS
  // bağlamındaki taslak deposu yok oluyordu.

  it('I3: ek baglantisina tiklamak GEZINMEYI IPTAL eder ve fetchten gecer', async () => {
    const cagrilanYollar: string[] = []
    const gercekFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL) => {
      cagrilanYollar.push(String(girdi))
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        blob: async () => new Blob(['PDF']),
      } as unknown as Response
    }) as unknown as typeof fetch
    try {
      kur()
      const bolum = screen.getByRole('region', { name: 'Ekli dosyalar' })
      const onam = within(bolum).getByRole('link', { name: /onam-formu\.pdf/ })
      // `href` DURUYOR: bağlam menüsü / "bağlantıyı farklı kaydet" gerçek
      // bir kaynak adresi görmeli.
      expect(onam.getAttribute('href')).toBe('/api/ekler/5')

      // Tıklamanın varsayılan davranışı (gezinme) iptal ediliyor mu?
      // Dinleyici DOCUMENT uzerinde: React 18 olaylari kok kapsayicida
      // (RTL'in `div`i) dinliyor, yani ogeye takilan bir dinleyici
      // React'in `preventDefault`undan ONCE calisir ve her zaman `false`
      // gorurdu. `document` kokten sonradir.
      let iptalEdildi = false
      document.addEventListener('click', (e) => {
        iptalEdildi = e.defaultPrevented
      })
      await userEvent.click(onam)

      expect(iptalEdildi, 'tikla gezinme iptal edilmeli').toBe(true)
      await waitFor(() => expect(cagrilanYollar).toContain('/api/ekler/5'))
    } finally {
      globalThis.fetch = gercekFetch
    }
  })

  it('I3: 401de kart EKRANDAN SILINMEZ, hata gosterilir', async () => {
    // Kilitli oturum senaryosu: eskiden burada SPA belgesi ham JSON ile
    // değişiyordu. Artık kart yerinde ve kullanıcıya ne olduğu söyleniyor.
    const gercekFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ hata: 'Oturum kilitli. Lütfen parolanızı girin.' }),
      blob: async () => new Blob([]),
    })) as unknown as typeof fetch
    try {
      kur()
      const bolum = screen.getByRole('region', { name: 'Ekli dosyalar' })
      await userEvent.click(within(bolum).getByRole('link', { name: /onam-formu\.pdf/ }))

      await waitFor(() =>
        expect(screen.getByText('Oturum kilitli. Lütfen parolanızı girin.')).toBeDefined(),
      )
      // Kart hâlâ ekranda — "sayfa gezinmedi"nin birim testi karşılığı.
      expect(screen.getByRole('region', { name: 'Danışan bilgileri' })).toBeDefined()
      expect(screen.getByRole('region', { name: 'Ekli dosyalar' })).toBeDefined()
      // 401 gövdesi dosya olarak DA yazılmadı.
      expect(uretilenBloblar).toHaveLength(0)
    } finally {
      globalThis.fetch = gercekFetch
    }
  })

  it('hic ek yoksa bilgilendirici bos durum gosterir', () => {
    kur({ ekler: [] })
    const bolum = screen.getByRole('region', { name: 'Ekli dosyalar' })
    expect(bolum.textContent).toMatch(/dosya eklenmemiş/i)
    expect(within(bolum).queryAllByRole('link')).toHaveLength(0)
  })

  it('dosya secilip yuklenince ekYukle ham dosya ve tur ile cagrilir', async () => {
    const { ekYukle } = kur()
    const dosya = new File(['pdf-baytlari'], 'yeni-onam.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText('Yüklenecek dosya'), dosya)
    await userEvent.selectOptions(screen.getByLabelText('Dosya türü'), 'onam')
    await userEvent.click(screen.getByRole('button', { name: 'Dosyayı yükle' }))

    await waitFor(() => expect(ekYukle).toHaveBeenCalledWith(dosya, 'onam'))
  })

  it('dosya secilmeden yukleme yapilmaz', async () => {
    const { ekYukle } = kur()
    await userEvent.click(screen.getByRole('button', { name: 'Dosyayı yükle' }))
    expect(ekYukle).not.toHaveBeenCalled()
    expect(screen.getByText(/önce bir dosya seçin/i)).toBeDefined()
  })

  it('yukleme hatasi ekranda gorunur', async () => {
    const ekYukle = vi.fn().mockRejectedValue(new Error('Dosya en fazla 20 MB olabilir.'))
    kur({ ekYukle })
    const dosya = new File(['x'], 'buyuk.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText('Yüklenecek dosya'), dosya)
    await userEvent.click(screen.getByRole('button', { name: 'Dosyayı yükle' }))

    await waitFor(() => expect(screen.getByText('Dosya en fazla 20 MB olabilir.')).toBeDefined())
  })
})

describe('DosyaBilgileri — ek silme (dal incelemesi: DELETE /api/ekler/{id})', () => {
  it('tek tiklama SILMEZ; onay istenir', async () => {
    // Silme geri alınamaz (BLOB gider). Tek tıklamayla silen bir düğme,
    // yanlış satıra basan kullanıcıya hiçbir şans bırakmazdı — randevu
    // silme ve danışan arşivlemedeki iki adımlı onayın aynısı.
    const { ekSil } = kur()
    await userEvent.click(screen.getByRole('button', { name: 'onam-formu.pdf dosyasını sil' }))
    expect(ekSil).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Evet, sil' })).toBeDefined()
  })

  it('onay metni RIZA BAGININ da kopacagini soyler', async () => {
    // Sunucudaki `attachments::sil` sarkan `clients.riza_dosya_id`'yi AYNI
    // transaction'da temizliyor. Bunu yazmayan bir onay metni, rıza
    // belgesini silen kullanıcıyı "rıza bölümündeki bağ neden kayboldu"
    // sorusuyla baş başa bırakırdı. `riza_tarihi` korunuyor — metin bunu
    // da söylemeli, yoksa kullanıcı rıza kaydının tümden silindiğini sanır.
    kur()
    await userEvent.click(screen.getByRole('button', { name: 'onam-formu.pdf dosyasını sil' }))
    const onay = screen.getByText(/kalıcı olarak silinsin mi/i)
    expect(onay.textContent).toContain('onam-formu.pdf')
    expect(onay.textContent).toMatch(/geri alınamaz/i)
    expect(onay.textContent).toMatch(/rıza bağı da kaldırılır/i)
    expect(onay.textContent).toMatch(/rıza tarihi kaydı silinmez/i)
  })

  it('onaylaninca DOGRU ekin kimligiyle silinir', async () => {
    const { ekSil } = kur()
    await userEvent.click(screen.getByRole('button', { name: 'beck-envanteri.pdf dosyasını sil' }))
    await userEvent.click(screen.getByRole('button', { name: 'Evet, sil' }))
    await waitFor(() => expect(ekSil).toHaveBeenCalledWith(6))
    expect(ekSil).toHaveBeenCalledTimes(1)
  })

  it('baska bir ekin Sil dugmesi onayi DEVRETMEZ, degistirir', async () => {
    // Onay state'i onaylanan EKİN KENDİSİ (Görev 10 Bulgu 1'in dersi).
    // Çıplak bir bayrakla A'nın onayı açıkken B'nin "Sil"ine basmak,
    // ekranda B'nin adını gösterip A'yı silebilirdi.
    const { ekSil } = kur()
    await userEvent.click(screen.getByRole('button', { name: 'onam-formu.pdf dosyasını sil' }))
    await userEvent.click(screen.getByRole('button', { name: 'beck-envanteri.pdf dosyasını sil' }))

    expect(screen.getByText(/kalıcı olarak silinsin mi/i).textContent).toContain(
      'beck-envanteri.pdf',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Evet, sil' }))
    await waitFor(() => expect(ekSil).toHaveBeenCalledWith(6))
  })

  it('vazgecince hicbir istek gitmez ve onay kapanir', async () => {
    const { ekSil } = kur()
    await userEvent.click(screen.getByRole('button', { name: 'onam-formu.pdf dosyasını sil' }))
    await userEvent.click(screen.getByRole('button', { name: 'Vazgeç' }))
    expect(ekSil).not.toHaveBeenCalled()
    expect(screen.queryByText(/kalıcı olarak silinsin mi/i)).toBeNull()
  })

  it('silme basarisiz olursa hata GORUNUR ve onay acik kalir', async () => {
    // Sessizce yutulan bir hata, kullanıcıya "sildim" izlenimi verirdi;
    // dosya duruyor ama kart yenilenmediği için ekranda da öyle görünür.
    const ekSil = vi.fn().mockRejectedValue(new Error('Oturum kilitli.'))
    kur({ ekSil })
    await userEvent.click(screen.getByRole('button', { name: 'onam-formu.pdf dosyasını sil' }))
    await userEvent.click(screen.getByRole('button', { name: 'Evet, sil' }))

    const uyari = await screen.findByRole('alert')
    expect(uyari.textContent).toContain('Oturum kilitli.')
    expect(screen.getByRole('button', { name: 'Evet, sil' })).toBeDefined()
  })
})

/** Rapor parola formunun erişilebilir adı (`role="group"`). */
const FORM = { name: 'Rapor parolası belirleyin' }

// Plan 4 Görev 7: rapor SUNUCUDA üretilir, parolalı PDF olarak iner. Kart
// yalnızca parolayı toplar ve `veriRaporuIndir`'i çağırır; indirmenin kendisi
// (401, Blob, dosya adı) `api.test.ts`'te, rapor İÇERİĞİ (özel not yok,
// resmî not var, ek adı var) sunucunun HTTP testinde ölçülüyor.
describe('DosyaBilgileri — veri raporu (KVKK md. 11, parolalı PDF)', () => {
  const ac = () =>
    userEvent.click(screen.getByRole('button', { name: 'Danışan veri raporu dışa aktar' }))
  // Satır içi form: `role="group"` (M4). Sorgular ADIYLA: adsız bir
  // `queryByRole('group')` başka bir grup yüzünden yanıltabilirdi.
  const diyalog = () => screen.getByRole('group', FORM)
  const disaAktarDugmesi = () =>
    screen.getByRole('button', { name: 'Danışan veri raporu dışa aktar' })
  const parolaAlani = () => within(diyalog()).getByLabelText('Rapor parolası') as HTMLInputElement
  const tekrarAlani = () =>
    within(diyalog()).getByLabelText('Parolayı tekrar girin') as HTMLInputElement
  const olustur = () =>
    userEvent.click(within(diyalog()).getByRole('button', { name: 'Raporu oluştur' }))

  it('dugme parola formunu acar: iki password alani, autocomplete off, aciklama', async () => {
    kur()
    // Form kapalı başlar: parola alanı ancak istenince DOM'a girer.
    expect(screen.queryByRole('group', FORM)).toBeNull()
    await ac()
    expect(diyalog().tagName).toBe('FORM')
    // Modal DEĞİL: `dialog` rolü odak hapsi ve `aria-modal` sözü verirdi.
    expect(screen.queryByRole('dialog')).toBeNull()
    for (const alan of [parolaAlani(), tekrarAlani()]) {
      expect(alan.type).toBe('password')
      // Danışanın parolası: `new-password` tarayıcıya onu bu sitenin hesap
      // parolası olarak KAYDETMEYİ önerdirebilirdi (M7).
      expect(alan.getAttribute('autocomplete')).toBe('off')
    }
    expect(diyalog().textContent).toContain(
      'Bu parolayı danışana ayrıca iletin. Ana parolanızı kullanmayın.',
    )
  })

  // Görev 7 brief Adım 2, üçüncü test: "veri raporu parola olmadan
  // indirilemez" (mevcut kısayoldan taşındı — hiçbir alan doldurulmadan
  // "Raporu oluştur" tıklanması da asgari karakter kontrolüne takılıp
  // isteği durdurmalı, aşağıdaki "kisaysa" testinin sıfır-karakter ucu).
  it('veri raporu parola olmadan indirilemez', async () => {
    const veriRaporuIndir = vi.fn()
    kur({ veriRaporuIndir })
    await ac()
    await olustur()
    expect(within(diyalog()).getByRole('alert').textContent).toMatch(
      /Rapor parolası en az 8 karakter/,
    )
    expect(veriRaporuIndir).not.toHaveBeenCalled()
  })

  it('parolalar eslesmezse ya da kisaysa istek GITMEZ ve alan adiyla hata gosterilir', async () => {
    const veriRaporuIndir = vi.fn()
    kur({ veriRaporuIndir })
    await ac()
    await userEvent.type(parolaAlani(), 'kisa')
    await userEvent.type(tekrarAlani(), 'kisa')
    await olustur()
    expect(within(diyalog()).getByRole('alert').textContent).toMatch(
      /Rapor parolası en az 8 karakter/,
    )
    expect(veriRaporuIndir).not.toHaveBeenCalled()

    await userEvent.clear(parolaAlani())
    await userEvent.clear(tekrarAlani())
    await userEvent.type(parolaAlani(), 'dogru-parola-1')
    await userEvent.type(tekrarAlani(), 'dogru-parola-2')
    await olustur()
    expect(within(diyalog()).getByRole('alert').textContent).toMatch(
      /Parolayı tekrar girin: .*eşleşmiyor/,
    )
    expect(veriRaporuIndir).not.toHaveBeenCalled()
  })

  it('sinir KARAKTER sayar: 7 cok baytli karakter reddedilir, 8i istek gonderir', async () => {
    // Sunucu `chars()` sayıyor. `.length` (UTF-16) ya da bayt sayan bir
    // kontrol burada sunucudan ayrışırdı. İKİ YÖN: her şeyi reddeden bir
    // kontrol de ilk yarıyı geçerdi.
    const veriRaporuIndir = vi.fn().mockResolvedValue(undefined)
    kur({ veriRaporuIndir })
    await ac()
    await userEvent.type(parolaAlani(), 'şşşşşşş')
    await userEvent.type(tekrarAlani(), 'şşşşşşş')
    await olustur()
    expect(within(diyalog()).getByRole('alert').textContent).toMatch(/en az 8 karakter/)
    expect(veriRaporuIndir).not.toHaveBeenCalled()

    await userEvent.type(parolaAlani(), 'ş')
    await userEvent.type(tekrarAlani(), 'ş')
    await olustur()
    expect(veriRaporuIndir).toHaveBeenCalledWith(12, 'şşşşşşşş')
  })

  it('gecerli parolayla TEK istek gider, istek UCUSTAYKEN parola DOMda yok', async () => {
    let coz!: () => void
    const veriRaporuIndir = vi.fn(() => new Promise<void>((c) => (coz = c)))
    kur({ veriRaporuIndir })
    await ac()
    await userEvent.type(parolaAlani(), 'danisan-parolasi-1')
    await userEvent.type(tekrarAlani(), 'danisan-parolasi-1')
    // Ön koşul: yazılan parola GERÇEKTEN DOM'da (`value` özniteliği) —
    // yoksa aşağıdaki eksi yön hiçbir şeyi sınamazdı.
    expect(document.body.innerHTML).toContain('danisan-parolasi-1')

    await olustur()
    expect(veriRaporuIndir).toHaveBeenCalledTimes(1)
    expect(veriRaporuIndir).toHaveBeenCalledWith(12, 'danisan-parolasi-1')
    // Yanıt beklenirken: alanlar boşaltılmış ve kilitli, ikinci istek yok.
    expect(document.body.innerHTML).not.toContain('danisan-parolasi-1')
    expect(parolaAlani().disabled).toBe(true)
    await userEvent.click(within(diyalog()).getByRole('button', { name: 'Raporu oluştur' }))
    expect(veriRaporuIndir).toHaveBeenCalledTimes(1)

    coz()
    expect(await screen.findByRole('status')).toBeDefined()
  })

  it('basarida form kapanir, alanlar TEMIZLENIR (yeniden acinca bos), parola hicbir yerde yok', async () => {
    const veriRaporuIndir = vi.fn().mockResolvedValue(undefined)
    kur({ veriRaporuIndir })
    await ac()
    await userEvent.type(parolaAlani(), 'danisan-parolasi-1')
    await userEvent.type(tekrarAlani(), 'danisan-parolasi-1')
    await olustur()

    expect((await screen.findByRole('status')).textContent).toMatch(/şifreli PDF/)
    expect(veriRaporuIndir).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('group', FORM)).toBeNull()
    expect(document.body.innerHTML).not.toContain('danisan-parolasi-1')
    // Form yeniden açılınca alanlar BOŞ: parola gizli bir state'te de
    // kalmamış (kapalı formun state'i DOM'da görünmez; ancak böyle ölçülür).
    await ac()
    expect(parolaAlani().value).toBe('')
    expect(tekrarAlani().value).toBe('')
    expect(document.body.innerHTML).not.toContain('danisan-parolasi-1')
  })

  it('sunucunun 400 mesaji (ana parola reddi) oldugu gibi gosterilir, ANA PAROLA alanlardan silinir', async () => {
    const mesaj =
      'Rapor için ana parolanızı kullanmayın; danışana vereceğiniz ayrı bir parola seçin.'
    const veriRaporuIndir = vi.fn().mockRejectedValue(new Error(mesaj))
    kur({ veriRaporuIndir })
    await ac()
    await userEvent.type(parolaAlani(), 'ana-parola-123')
    await userEvent.type(tekrarAlani(), 'ana-parola-123')
    await olustur()

    expect((await within(diyalog()).findByRole('alert')).textContent).toBe(mesaj)
    // Form açık kalır (kullanıcı başka parola seçecek) ama reddedilen
    // parola — terapistin ANA parolası — ne alanda ne DOM'da duruyor.
    expect(parolaAlani().value).toBe('')
    expect(tekrarAlani().value).toBe('')
    expect(document.body.innerHTML).not.toContain('ana-parola-123')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('Vazgec istek atmaz, formu kapatir ve alanlari temizler', async () => {
    const veriRaporuIndir = vi.fn()
    kur({ veriRaporuIndir })
    await ac()
    await userEvent.type(parolaAlani(), 'vazgecilen-parola')
    await userEvent.click(within(diyalog()).getByRole('button', { name: 'Vazgeç' }))
    expect(veriRaporuIndir).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', FORM)).toBeNull()
    await ac()
    expect(parolaAlani().value).toBe('')
  })

  it('odak: ilk mountta calinmaz, acilinca ilk parola alanina gecer, Vazgec dugmeye DONDURUR', async () => {
    kur()
    // EKSİ YÖN: kart açılışında odak kimseye zorla verilmez.
    expect(document.activeElement).toBe(document.body)
    await ac()
    expect(document.activeElement).toBe(parolaAlani())
    await userEvent.click(within(diyalog()).getByRole('button', { name: 'Vazgeç' }))
    expect(screen.queryByRole('group', FORM)).toBeNull()
    expect(document.activeElement).toBe(disaAktarDugmesi())
  })

  it('Esc vazgecer: istek yok, form kapanir, alanlar temizlenir, odak dugmeye doner', async () => {
    const veriRaporuIndir = vi.fn()
    kur({ veriRaporuIndir })
    await ac()
    await userEvent.type(parolaAlani(), 'esc-ile-vazgecilen')
    await userEvent.type(tekrarAlani(), 'esc-ile-vazgecilen')
    await userEvent.keyboard('{Escape}')
    expect(veriRaporuIndir).not.toHaveBeenCalled()
    expect(screen.queryByRole('group', FORM)).toBeNull()
    expect(document.body.innerHTML).not.toContain('esc-ile-vazgecilen')
    expect(document.activeElement).toBe(disaAktarDugmesi())
    await ac()
    expect(parolaAlani().value).toBe('')
  })

  it('istek UCUSTAYKEN Esc formu kapatmaz; basarida odak dugmeye doner', async () => {
    let coz!: () => void
    const veriRaporuIndir = vi.fn(() => new Promise<void>((c) => (coz = c)))
    kur({ veriRaporuIndir })
    await ac()
    await userEvent.type(parolaAlani(), 'ucustaki-parola-1')
    await userEvent.type(tekrarAlani(), 'ucustaki-parola-1')
    await olustur()
    expect(veriRaporuIndir).toHaveBeenCalledTimes(1)
    // Alanlar kilitli; olay formun kendisine gönderiliyor.
    fireEvent.keyDown(diyalog(), { key: 'Escape' })
    expect(screen.queryByRole('group', FORM)).not.toBeNull()

    // Formu kapatan güncelleme bir kullanıcı olayından değil, sözün
    // çözülmesinden geliyor; odak ise pasif bir efektte veriliyor. `act`
    // dışında efekt Scheduler'ın ayrı görevinde (Node'da `setImmediate`)
    // koşar ve `findByRole`'un ardından gelen `setTimeout(0)` yük altında
    // ondan önce çalışabilir: iddia odak verilmeden okunur, test ara sıra
    // kırılır. `act` efektleri dönmeden boşaltır — sıra deterministik.
    await act(async () => coz())
    screen.getByRole('status')
    expect(screen.queryByRole('group', FORM)).toBeNull()
    expect(document.activeElement).toBe(disaAktarDugmesi())
  })

  it('hatada form acik kalir (dugme yok); Esc hata sonrasinda da vazgecer ve odagi dugmeye verir', async () => {
    const veriRaporuIndir = vi.fn().mockRejectedValue(new Error('Sunucu hatası.'))
    kur({ veriRaporuIndir })
    await ac()
    await userEvent.type(parolaAlani(), 'hatali-istek-1')
    await userEvent.type(tekrarAlani(), 'hatali-istek-1')
    await olustur()
    await within(diyalog()).findByRole('alert')
    expect(screen.queryByRole('button', { name: 'Danışan veri raporu dışa aktar' })).toBeNull()
    // Esc hata sonrasında da vazgeçer ve odağı düğmeye verir.
    fireEvent.keyDown(diyalog(), { key: 'Escape' })
    expect(screen.queryByRole('group', FORM)).toBeNull()
    expect(document.activeElement).toBe(disaAktarDugmesi())
  })

  it('parola console a, localStorage a, sessionStorage a YAZILMAZ; kart Blob URETMEZ', async () => {
    const gunlukler = ['log', 'info', 'warn', 'error', 'debug'] as const
    const casuslar = gunlukler.map((a) => vi.spyOn(console, a).mockImplementation(() => {}))
    localStorage.clear()
    sessionStorage.clear()
    kur()
    await ac()
    await userEvent.type(parolaAlani(), 'SIZINTI-PAROLA-77')
    await userEvent.type(tekrarAlani(), 'SIZINTI-PAROLA-77')
    await olustur()
    await screen.findByRole('status')

    for (const casus of casuslar) expect(casus).not.toHaveBeenCalled()
    for (const depo of [localStorage, sessionStorage]) {
      for (let i = 0; i < depo.length; i++) {
        expect(depo.getItem(depo.key(i) ?? '') ?? '').not.toContain('SIZINTI-PAROLA-77')
      }
    }
    // İndirme (Blob) kartın değil `danisanApi`'nin işi; kart hiç üretmez.
    expect(uretilenBloblar).toHaveLength(0)
  })
})

describe('DosyaBilgileri — kapanış ve gizlilik', () => {
  it('Kapat dugmesi onKapat cagirir', async () => {
    const { onKapat } = kur()
    await userEvent.click(screen.getByRole('button', { name: 'Danışan kartını kapat' }))
    expect(onKapat).toHaveBeenCalledTimes(1)
  })

  it('risk notu, riza ve saklama bilgisi console\'a yazilmaz', async () => {
    const gunlukler = ['log', 'info', 'warn', 'error', 'debug'] as const
    const casuslar = gunlukler.map((a) => vi.spyOn(console, a).mockImplementation(() => {}))

    kur()
    await userEvent.click(screen.getByRole('button', { name: 'Risk notunu göster' }))
    await userEvent.click(screen.getByRole('button', { name: 'Danışan veri raporu dışa aktar' }))

    for (const casus of casuslar) expect(casus).not.toHaveBeenCalled()
  })
})

// Dördüncü ve beşinci biçim: bileşen testleri hep TEMİZ MOUNT yapıyorsa,
// bir danışandan diğerine sızan state hiçbir zaman görünmez.
// UYARI — bu blok ÜRETİMDE ULAŞILAMAYAN bir durumu ölçer.
//
// Buradaki `rerender`, AYNI `DosyaBilgileri` örneğine farklı bir `danisan.id`
// veriyor. Üretimde bu OLUŞAMAZ: `AnaEkran` kartı
// `kart = kartVerisi.id === seciliDanisanId ? kartVerisi : BOS_KART` ile
// türetiyor, danışan değişince `kart.dosya` `null` olur ve kart
// `{kart.dosya !== null && <DosyaBilgileri … />}` koşulundan düşerek UNMOUNT
// EDİLİR. Yani monte bir kartın `danisan.id`'si hiçbir zaman değişmez.
//
// Aynı endişe için dört savunma var ve YALNIZCA BİRİNCİSİ yük taşıyor:
//   1. `AnaEkran`'daki `kart` türetmesi + koşullu render — BİRİNCİL HAT.
//      Ölçüldüğü yer: `AnaEkran.test.tsx` > "baska danisana gecince onceki
//      kartin verisi EKRANDA KALMAZ" (uçuşta bekletilen bir istekle, yani
//      sıfırlamayı bir efekte bırakan mutasyonu da yakalayarak).
//   2. `AnaEkran`'daki `key={danisan-…}`,
//   3. `DosyaBilgileri`'nın `raporForm` / `ekForm` türetmeleri,
//   4. `RizaBolumu`'nün `key`'i
//      — üçü de (1) çalışırken erişilemez; derinlemesine savunma olarak
//      meşru ama birincil hat DEĞİL.
//
// Aşağıdaki üç test tam olarak şunu ölçüyor: "(1) unutulur ya da bir gün
// kart monte kalacak biçimde değiştirilirse, kartın kendi türetmeleri ne
// kadarını kurtarır". Bu değerli bir sorudur; "bugün üretimde şu koruma
// çalışıyor" DEĞİLDİR.
describe('DosyaBilgileri — danışan değişimi (ikincil hat, sentetik `rerender`)', () => {
  it('A icin yazilan rapor parolasi B secilince EKRANDA KALMAZ ve B nin raporuna GITMEZ', async () => {
    const digeri: DanisanDosyasi = {
      ...danisan,
      id: 13,
      ad_soyad: 'Mehmet Demir',
      risk_notu: null,
      riza_tarihi: null,
      riza_dosya_id: null,
    }
    const veriRaporuIndir = vi.fn().mockResolvedValue(undefined)
    const ortak = {
      ekler,
      randevular: [randevu({ id: 1 })],
      bugun: '2026-09-09',
      veriRaporuIndir,
      ekYukle: vi.fn().mockResolvedValue(undefined),
      ekSil: vi.fn().mockResolvedValue(undefined),
      onRizaKaydet: vi.fn().mockResolvedValue(undefined),
      onKapat: vi.fn(),
    }
    const { rerender } = render(<DosyaBilgileri danisan={danisan} {...ortak} />)

    await userEvent.click(screen.getByRole('button', { name: 'Danışan veri raporu dışa aktar' }))
    await userEvent.type(screen.getByLabelText('Rapor parolası'), 'A-NIN-PAROLASI')
    await userEvent.type(screen.getByLabelText('Parolayı tekrar girin'), 'A-NIN-PAROLASI')
    // Ön koşul: parola gerçekten DOM'da.
    expect(document.body.innerHTML).toContain('A-NIN-PAROLASI')

    rerender(<DosyaBilgileri danisan={digeri} {...ortak} />)

    expect(document.body.innerHTML).not.toContain('A-NIN-PAROLASI')
    expect(screen.queryByRole('group', FORM)).toBeNull()
    // B için form açılınca boş gelir; "Raporu oluştur" A'nın parolasıyla
    // B'nin raporunu İSTEMEZ.
    await userEvent.click(screen.getByRole('button', { name: 'Danışan veri raporu dışa aktar' }))
    expect((screen.getByLabelText('Rapor parolası') as HTMLInputElement).value).toBe('')
    await userEvent.click(screen.getByRole('button', { name: 'Raporu oluştur' }))
    expect(veriRaporuIndir).not.toHaveBeenCalled()

    // ARTI YÖN: B'nin formu gerçekten çalışıyor ve B'nin kimliğiyle gidiyor.
    await userEvent.type(screen.getByLabelText('Rapor parolası'), 'B-NIN-PAROLASI')
    await userEvent.type(screen.getByLabelText('Parolayı tekrar girin'), 'B-NIN-PAROLASI')
    await userEvent.click(screen.getByRole('button', { name: 'Raporu oluştur' }))
    expect(veriRaporuIndir).toHaveBeenCalledWith(13, 'B-NIN-PAROLASI')
  })

  it('A icin secilmis dosya B nin kartinda B ye YUKLENMEZ', async () => {
    // En somut biçimi: terapist A'nın onam formunu seçer, telefonu çalar,
    // dönünce B'nin kartındadır ve "Yükle"ye basar. Dosya B'nin dosyasına
    // girerdi — yanlış danışanın dosyasında başkasının belgesi.
    const digeri: DanisanDosyasi = { ...danisan, id: 13, ad_soyad: 'Mehmet Demir' }
    const ekYukle = vi.fn().mockResolvedValue(undefined)
    const ortak = {
      ekler,
      randevular: [randevu({ id: 1 })],
      bugun: '2026-09-09',
      veriRaporuIndir: vi.fn().mockResolvedValue(undefined),
      ekYukle,
      ekSil: vi.fn().mockResolvedValue(undefined),
      onRizaKaydet: vi.fn().mockResolvedValue(undefined),
      onKapat: vi.fn(),
    }
    const { rerender } = render(<DosyaBilgileri danisan={danisan} {...ortak} />)

    const dosya = new File(['x'], 'A-nin-onami.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText('Yüklenecek dosya'), dosya)

    rerender(<DosyaBilgileri danisan={digeri} {...ortak} />)
    await userEvent.click(screen.getByRole('button', { name: 'Dosyayı yükle' }))

    expect(ekYukle).not.toHaveBeenCalled()
    expect(screen.getByText(/önce bir dosya seçin/i)).toBeDefined()
  })

  it('A icin acilan risk notu B nin kartini SORULMADAN acmaz', async () => {
    // `riskAcik` düz bir `boolean` olsaydı, A'nın notunu açtıktan sonra
    // B'ye geçmek B'nin risk notunu kendiliğinden ekrana basardı — hem de
    // ekrandaki en hassas alanı.
    const digeri: DanisanDosyasi = {
      ...danisan,
      id: 13,
      ad_soyad: 'Mehmet Demir',
      risk_notu: 'B-NIN-RISK-NOTU',
    }
    const ortak = {
      ekler,
      randevular: [randevu({ id: 1 })],
      bugun: '2026-09-09',
      veriRaporuIndir: vi.fn().mockResolvedValue(undefined),
      ekYukle: vi.fn().mockResolvedValue(undefined),
      ekSil: vi.fn().mockResolvedValue(undefined),
      onRizaKaydet: vi.fn().mockResolvedValue(undefined),
      onKapat: vi.fn(),
    }
    const { rerender } = render(<DosyaBilgileri danisan={danisan} {...ortak} />)
    await userEvent.click(screen.getByRole('button', { name: 'Risk notunu göster' }))
    expect(screen.getByText(/Geçmişte bir kez kendine zarar verme/)).toBeDefined()

    rerender(<DosyaBilgileri danisan={digeri} {...ortak} />)
    expect(document.body.textContent).not.toContain('B-NIN-RISK-NOTU')
    // ARTI YÖN: B'nin notu gerçekten var ve istenince açılıyor (notu hiç
    // göstermeyen bir sürüm de üstteki iddiayı geçerdi).
    await userEvent.click(screen.getByRole('button', { name: 'Risk notunu göster' }))
    expect(screen.getByText('B-NIN-RISK-NOTU')).toBeDefined()
  })

  it('A nin riza tarihi B nin formunda KALMAZ', async () => {
    // Rıza formu prop'lardan İLK MOUNT'ta doldurulur; bileşen yeniden mount
    // edilmezse "Rızayı kaydet" B'ye A'nın tarihini yazardı.
    const digeri: DanisanDosyasi = {
      ...danisan,
      id: 13,
      ad_soyad: 'Mehmet Demir',
      riza_tarihi: '2020-01-02',
      riza_dosya_id: null,
    }
    const ortak = {
      ekler,
      randevular: [randevu({ id: 1 })],
      bugun: '2026-09-09',
      veriRaporuIndir: vi.fn().mockResolvedValue(undefined),
      ekYukle: vi.fn().mockResolvedValue(undefined),
      ekSil: vi.fn().mockResolvedValue(undefined),
      onRizaKaydet: vi.fn().mockResolvedValue(undefined),
      onKapat: vi.fn(),
    }
    const { rerender } = render(<DosyaBilgileri danisan={danisan} {...ortak} />)
    expect((screen.getByLabelText('Açık rıza tarihi') as HTMLInputElement).value).toBe('2026-03-01')

    rerender(<DosyaBilgileri danisan={digeri} {...ortak} />)
    expect((screen.getByLabelText('Açık rıza tarihi') as HTMLInputElement).value).toBe('2020-01-02')
    expect((screen.getByLabelText('İmzalı onam dosyası') as HTMLSelectElement).value).toBe('')
  })
})
