import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DanisanDosyasi, EkBilgisi, SeansNotu } from '../api'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { DanisanKarti } from './DanisanKarti'

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

const resmiNotlar: SeansNotu[] = [
  {
    appointment_id: 1,
    client_id: 12,
    // `SeansNotu` alanı (Görev 9 incelemesi I3): randevunun başlangıcı.
    seans_zamani: '2026-09-07T10:00',
    sablon: 'dap',
    icerik: 'RESMI-NOT-ICERIGI',
    guncelleme_zamani: '2026-09-07T12:00:00Z',
  },
]

// Rapor sızıntı testinin kanaryası: özel notun içeriğini temsil eder ve
// hiçbir dışa aktarımda görünmemeli.
const GIZLI = 'GIZLI-OZEL-ABC'

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

function kur(ozel: Partial<React.ComponentProps<typeof DanisanKarti>> = {}) {
  const props = {
    danisan,
    ekler,
    randevular: [randevu({ id: 1, durum: 'geldi', odendi: false, ucret: 45000 })],
    bugun: '2026-09-09',
    notlariGetir: vi.fn().mockResolvedValue(resmiNotlar),
    notSiniri: 200,
    raporKaydiOlustur: vi.fn().mockResolvedValue(undefined),
    ekYukle: vi.fn().mockResolvedValue(undefined),
    ekSil: vi.fn().mockResolvedValue(undefined),
    onRizaKaydet: vi.fn().mockResolvedValue(undefined),
    onKapat: vi.fn(),
    ...ozel,
  }
  return { ...props, ...render(<DanisanKarti {...props} />) }
}

describe('DanisanKarti — kimlik ve bağlam', () => {
  it('iletisim, basvuru nedeni ve bakiye gorunur', () => {
    kur()
    expect(screen.getByText('Ayşe Yılmaz')).toBeDefined()
    expect(screen.getByText(/0555 111 22 33/)).toBeDefined()
    expect(screen.getByText(/Yoğun kaygı ve uyku sorunu/)).toBeDefined()
    // 45000 kuruş = 450,00 TL.
    expect(screen.getByText(/450,00 ₺/)).toBeDefined()
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
describe('DanisanKarti — bakiye ne sayar, ne saymaz', () => {
  it('gelinmis ve odenmemis seanslarin ucreti TOPLANIR', () => {
    kur({
      randevular: [
        randevu({ id: 1, durum: 'geldi', odendi: false, ucret: 45000 }),
        randevu({ id: 2, durum: 'geldi', odendi: false, ucret: 30000 }),
      ],
    })
    expect(screen.getByText(/750,00 ₺/)).toBeDefined()
  })

  it('odenmis seans bakiyeye GIRMEZ', () => {
    kur({
      randevular: [
        randevu({ id: 1, durum: 'geldi', odendi: true, ucret: 45000 }),
        randevu({ id: 2, durum: 'geldi', odendi: false, ucret: 30000 }),
      ],
    })
    expect(screen.getByText(/300,00 ₺/)).toBeDefined()
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
    expect(screen.getByText(/^0,00 ₺$/)).toBeDefined()
  })

  it('ucreti girilmemis seans bakiyeyi bozmaz', () => {
    kur({
      randevular: [
        randevu({ id: 1, durum: 'geldi', odendi: false, ucret: null }),
        randevu({ id: 2, durum: 'geldi', odendi: false, ucret: 30000 }),
      ],
    })
    expect(screen.getByText(/300,00 ₺/)).toBeDefined()
  })

  it('bakiye etiketi NEYI saydigini soyler', () => {
    // "Bakiye: 0,00 ₺" tek başına, ücreti hiç girilmemiş bir dosyada
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

describe('DanisanKarti — rıza ve saklama', () => {
  it('riza alinmamissa belirgin uyari gosterir', () => {
    kur({ danisan: { ...danisan, riza_tarihi: null, riza_dosya_id: null } })
    const uyarilar = screen.getAllByRole('alert')
    expect(uyarilar.some((u) => /açık rıza kaydı yok/i.test(u.textContent ?? ''))).toBe(true)
  })

  it('ARTI YON: riza varsa o uyari YOKTUR', () => {
    kur()
    expect(
      screen.queryAllByRole('alert').some((u) => /açık rıza kaydı yok/i.test(u.textContent ?? '')),
    ).toBe(false)
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

describe('DanisanKarti — ekli dosyalar', () => {
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
      expect(screen.getByText('Ayşe Yılmaz')).toBeDefined()
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

describe('DanisanKarti — ek silme (dal incelemesi: DELETE /api/ekler/{id})', () => {
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

describe('DanisanKarti — veri raporu (KVKK md. 11)', () => {
  it('veri raporu disa aktar butonu vardir', () => {
    kur()
    expect(screen.getByRole('button', { name: 'Veri raporu dışa aktar' })).toBeDefined()
  })

  it('rapor hazirlaninca INDIRME BAGLANTISI belirir', async () => {
    // Programatik tıklama YOK: kullanıcı neyi indireceğini gördükten sonra
    // kendisi tıklar. Rapor kişisel veri taşıyan bir dosyadır.
    kur()
    expect(screen.queryByRole('link', { name: /raporu indir/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))

    const bag = await screen.findByRole('link', { name: /raporu indir/i })
    expect(bag.getAttribute('href')).toMatch(/^blob:/)
    expect(bag.getAttribute('download')).toContain('.txt')
  })

  it('dosya adinda danisanin ADI GECMEZ, yalnizca kimlik ve tarih', async () => {
    // Gerekçe `DanisanKarti.tsx`'te yazılıydı ama testli değildi: tek iddia
    // `.txt` idi ve `dosyaAdi`'na `danisan.ad_soyad` ekleyen bir mutasyon
    // tüm paketi yeşil bırakıyordu (onuncu biçim).
    //
    // Zarar somut: ad sağlık verisiyle birlikte anıldığı anda kendisi de
    // hassas veri olur ve dosya adları paylaşılan klasörlerde, yedeklerde,
    // ekran görüntülerinde ve indirme listesinde GÖRÜNÜR.
    kur()
    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
    const bag = await screen.findByRole('link', { name: /raporu indir/i })
    const ad = bag.getAttribute('download') ?? ''

    // ARTI YÖN: dosya adı gerçekten üretildi ve ayırt edici (boş bir ad da
    // aşağıdaki eksi yön iddialarını geçerdi).
    expect(ad).toBe('danisan-12-veri-raporu-2026-09-09.txt')
    // Adın hiçbir parçası, hiçbir yazımıyla geçmiyor.
    for (const parca of ['Ayşe', 'Yılmaz', 'Ayse', 'Yilmaz']) {
      expect(ad.toLocaleLowerCase('tr')).not.toContain(parca.toLocaleLowerCase('tr'))
    }
  })

  it('rapor resmi not iceriklerini TASIR', async () => {
    kur()
    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
    await screen.findByRole('link', { name: /raporu indir/i })

    expect(uretilenBloblar).toHaveLength(1)
    const metin = await uretilenBloblar[0].text()
    expect(metin).toContain('RESMI-NOT-ICERIGI')
    expect(metin).toContain('Ayşe Yılmaz')
  })

  it('rapor OZEL NOT icermez: tek kaynagi resmi not istemcisidir', async () => {
    // Yapısal iddia: rapor içeriğini besleyen `notlariGetir` `SeansNotu[]`
    // döndürür ve `notApi` dışında bir kaynağı yoktur. Aşağıdaki kurulum
    // sunucunun özel notu resmî listeye SIZDIRDIĞI durumu taklit edemez
    // (tip izin vermez); ölçülen şey, kartın ekranda ya da raporda kendi
    // başına ikinci bir kaynağa gitmemesi.
    const notlariGetir = vi.fn().mockResolvedValue(resmiNotlar)
    kur({ notlariGetir })
    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
    await screen.findByRole('link', { name: /raporu indir/i })

    const metin = await uretilenBloblar[0].text()
    expect(metin).not.toContain(GIZLI)
    expect(metin).toMatch(/özel notları bu rapora dahil değildir/i)
    // Rapor için not çekmenin TEK yolu bu prop; ikinci bir çağrı yolu yok.
    expect(notlariGetir).toHaveBeenCalledTimes(1)
  })

  it('rapor ek dosyalari USTVERI olarak listeler, icerik gommez', async () => {
    kur()
    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
    await screen.findByRole('link', { name: /raporu indir/i })
    const metin = await uretilenBloblar[0].text()
    expect(metin).toContain('onam-formu.pdf')
    expect(metin).not.toContain('pdf-baytlari')
  })

  it('not sayisi sunucu sinirina DAYANDIYSA rapor eksik olabilecegini soyler', async () => {
    // `GET /api/danisanlar/{id}/notlar` "daha fazlası var" işareti
    // taşımıyor. Kırpılmış bir erişim raporu, eksik olduğunu söylemeden
    // eksiktir — KVKK md. 11 belgesinde bu sessiz bir yanlış beyandır.
    const cok = Array.from({ length: 3 }, (_, i) => ({ ...resmiNotlar[0], appointment_id: i + 1 }))
    kur({ notlariGetir: vi.fn().mockResolvedValue(cok), notSiniri: 3 })
    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
    await screen.findByRole('link', { name: /raporu indir/i })

    expect(screen.getByText(/daha eski\s+notlar rapora girmemiş olabilir/i)).toBeDefined()
    const metin = await uretilenBloblar[0].text()
    // Uyarı raporun İÇİNDE de var: ekrandaki uyarı dosyayla birlikte
    // gitmez, dosyayı okuyan (danışan olabilir) onu göremez.
    expect(metin).toMatch(/rapora GİRMEMİŞ olabilir/i)
  })

  it('ARTI YON: sinirin altinda o uyari YOKTUR', () => {
    // Her zaman uyaran bir rapor uyarıyı anlamsızlaştırır.
    kur({ notSiniri: 200 })
    expect(screen.queryByText(/rapora girmemiş olabilir/i)).toBeNull()
  })

  // --- Dal incelemesi C1: dışa aktarım ÖNCE kaydedilir (fail-closed) ---

  it('disa aktarim, notlar cekilmeden ONCE denetim kaydini yazdirir', async () => {
    // Sıra bir güvence: kayıt yazılamıyorsa rapor da üretilmemeli. Bunu
    // ölçmenin tek yolu çağrı SIRASINI görmek — "ikisi de çağrıldı"
    // iddiası, kaydı en sona koyan bir sürümü de geçerdi.
    const sira: string[] = []
    const raporKaydiOlustur = vi.fn().mockImplementation(async () => {
      sira.push('kayit')
    })
    const notlariGetir = vi.fn().mockImplementation(async () => {
      sira.push('notlar')
      return resmiNotlar
    })
    kur({ raporKaydiOlustur, notlariGetir })

    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
    await screen.findByRole('link', { name: /raporu indir/i })

    expect(raporKaydiOlustur).toHaveBeenCalledTimes(1)
    expect(sira).toEqual(['kayit', 'notlar'])
  })

  it('FAIL-CLOSED: kayit basarisiz olursa rapor URETILMEZ', async () => {
    // KVKK 2018/10'un istediği kaydın var olma sebebi tam olarak bu: bir
    // danışanın tüm klinik dosyasını diske yazan işlem, silinemez kayıtta
    // iz bırakmadan gerçekleşmemeli. Kayıt yazılamıyorsa (kilitli oturum →
    // 401, disk hatası → 500) dışa aktarım da yapılmaz.
    const raporKaydiOlustur = vi
      .fn()
      .mockRejectedValue(new Error('Oturum kilitli. Lütfen parolanızı girin.'))
    const notlariGetir = vi.fn().mockResolvedValue(resmiNotlar)
    kur({ raporKaydiOlustur, notlariGetir })

    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
    await waitFor(() =>
      expect(screen.getByText('Oturum kilitli. Lütfen parolanızı girin.')).toBeDefined(),
    )

    // Rapor hiçbir aşamada üretilmedi: notlar bile çekilmedi.
    expect(notlariGetir).not.toHaveBeenCalled()
    expect(uretilenBloblar).toHaveLength(0)
    expect(screen.queryByRole('link', { name: /raporu indir/i })).toBeNull()
  })

  it('rapor hazirlanamazsa baglanti verilmez, hata gosterilir', async () => {
    // Boş bir rapor indirtmek "bu danışanın notu yok" diye okunurdu.
    const notlariGetir = vi.fn().mockRejectedValue(new Error('Notlar alınamadı.'))
    kur({ notlariGetir })
    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))

    await waitFor(() => expect(screen.getByText('Notlar alınamadı.')).toBeDefined())
    expect(screen.queryByRole('link', { name: /raporu indir/i })).toBeNull()
    expect(uretilenBloblar).toHaveLength(0)
  })
})

describe('DanisanKarti — kapanış ve gizlilik', () => {
  it('Kapat dugmesi onKapat cagirir', async () => {
    const { onKapat } = kur()
    await userEvent.click(screen.getByRole('button', { name: 'Danışan kartını kapat' }))
    expect(onKapat).toHaveBeenCalledTimes(1)
  })

  it('risk notu, riza ve saklama bilgisi console\'a yazilmaz', async () => {
    const gunlukler = ['log', 'info', 'warn', 'error', 'debug'] as const
    const casuslar = gunlukler.map((a) => vi.spyOn(console, a).mockImplementation(() => {}))

    kur()
    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
    await screen.findByRole('link', { name: /raporu indir/i })

    for (const casus of casuslar) expect(casus).not.toHaveBeenCalled()
  })

  it('kart kaldirilinca uretilen blob URL serbest birakilir', async () => {
    // Rapor kişisel veri taşıyor; sayfa ömrü boyunca canlı bir blob URL
    // bırakmak onu adresi bilen her koda açık tutardı.
    const { unmount } = kur()
    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
    await screen.findByRole('link', { name: /raporu indir/i })
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:rapor-1')
  })
})

// Dördüncü ve beşinci biçim: bileşen testleri hep TEMİZ MOUNT yapıyorsa,
// bir danışandan diğerine sızan state hiçbir zaman görünmez.
// UYARI — bu blok ÜRETİMDE ULAŞILAMAYAN bir durumu ölçer.
//
// Buradaki `rerender`, AYNI `DanisanKarti` örneğine farklı bir `danisan.id`
// veriyor. Üretimde bu OLUŞAMAZ: `AnaEkran` kartı
// `kart = kartVerisi.id === seciliDanisanId ? kartVerisi : BOS_KART` ile
// türetiyor, danışan değişince `kart.dosya` `null` olur ve kart
// `{kart.dosya !== null && <DanisanKarti … />}` koşulundan düşerek UNMOUNT
// EDİLİR. Yani monte bir kartın `danisan.id`'si hiçbir zaman değişmez.
//
// Aynı endişe için dört savunma var ve YALNIZCA BİRİNCİSİ yük taşıyor:
//   1. `AnaEkran`'daki `kart` türetmesi + koşullu render — BİRİNCİL HAT.
//      Ölçüldüğü yer: `AnaEkran.test.tsx` > "baska danisana gecince onceki
//      kartin verisi EKRANDA KALMAZ" (uçuşta bekletilen bir istekle, yani
//      sıfırlamayı bir efekte bırakan mutasyonu da yakalayarak).
//   2. `AnaEkran`'daki `key={danisan-…}`,
//   3. `DanisanKarti`'nın `gorunenRapor` / `ekForm` türetmeleri,
//   4. `RizaBolumu`'nün `key`'i
//      — üçü de (1) çalışırken erişilemez; derinlemesine savunma olarak
//      meşru ama birincil hat DEĞİL.
//
// Aşağıdaki üç test tam olarak şunu ölçüyor: "(1) unutulur ya da bir gün
// kart monte kalacak biçimde değiştirilirse, kartın kendi türetmeleri ne
// kadarını kurtarır". Bu değerli bir sorudur; "bugün üretimde şu koruma
// çalışıyor" DEĞİLDİR.
describe('DanisanKarti — danışan değişimi (ikincil hat, sentetik `rerender`)', () => {
  it('A icin hazirlanan rapor baglantisi B secilince EKRANDA KALMAZ', async () => {
    const digeri: DanisanDosyasi = {
      ...danisan,
      id: 13,
      ad_soyad: 'Mehmet Demir',
      risk_notu: null,
      riza_tarihi: null,
      riza_dosya_id: null,
    }
    const ortak = {
      ekler,
      randevular: [randevu({ id: 1 })],
      bugun: '2026-09-09',
      notlariGetir: vi.fn().mockResolvedValue(resmiNotlar),
      notSiniri: 200,
      raporKaydiOlustur: vi.fn().mockResolvedValue(undefined),
      ekYukle: vi.fn().mockResolvedValue(undefined),
      ekSil: vi.fn().mockResolvedValue(undefined),
      onRizaKaydet: vi.fn().mockResolvedValue(undefined),
      onKapat: vi.fn(),
    }
    const { rerender } = render(<DanisanKarti danisan={danisan} {...ortak} />)

    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
    await screen.findByRole('link', { name: /raporu indir/i })
    // Risk notu AÇILIYOR: katlanmış hâlde metin zaten DOM'da olmaz ve
    // aşağıdaki "sızmadı" iddiası hiçbir şeyi sınamayan bir yeşile
    // dönerdi.
    await userEvent.click(screen.getByRole('button', { name: 'Risk notunu göster' }))
    expect(screen.getByText(/Geçmişte bir kez kendine zarar verme/)).toBeDefined()

    rerender(<DanisanKarti danisan={digeri} {...ortak} />)

    // A'nın raporu B'nin kartında durursa terapist yanlış danışanın
    // dosyasını indirir.
    expect(screen.queryByRole('link', { name: /raporu indir/i })).toBeNull()
    expect(document.body.textContent).not.toContain('Geçmişte bir kez kendine zarar verme')
    // B'nin kendi durumu doğru: rızası yok, uyarı görünüyor.
    expect(
      screen.getAllByRole('alert').some((u) => /açık rıza kaydı yok/i.test(u.textContent ?? '')),
    ).toBe(true)

    // ARTI YÖN: A'ya dönülünce A'nın raporu yine geçerli. Bu yarı olmadan
    // "raporu hiç göstermeyen" bir sürüm de üstteki iddiayı geçerdi.
    rerender(<DanisanKarti danisan={danisan} {...ortak} />)
    expect(screen.getByRole('link', { name: /raporu indir/i }).getAttribute('href')).toBe(
      'blob:rapor-1',
    )
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
      notlariGetir: vi.fn().mockResolvedValue(resmiNotlar),
      notSiniri: 200,
      raporKaydiOlustur: vi.fn().mockResolvedValue(undefined),
      ekYukle,
      ekSil: vi.fn().mockResolvedValue(undefined),
      onRizaKaydet: vi.fn().mockResolvedValue(undefined),
      onKapat: vi.fn(),
    }
    const { rerender } = render(<DanisanKarti danisan={danisan} {...ortak} />)

    const dosya = new File(['x'], 'A-nin-onami.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText('Yüklenecek dosya'), dosya)

    rerender(<DanisanKarti danisan={digeri} {...ortak} />)
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
      notlariGetir: vi.fn().mockResolvedValue(resmiNotlar),
      notSiniri: 200,
      raporKaydiOlustur: vi.fn().mockResolvedValue(undefined),
      ekYukle: vi.fn().mockResolvedValue(undefined),
      ekSil: vi.fn().mockResolvedValue(undefined),
      onRizaKaydet: vi.fn().mockResolvedValue(undefined),
      onKapat: vi.fn(),
    }
    const { rerender } = render(<DanisanKarti danisan={danisan} {...ortak} />)
    await userEvent.click(screen.getByRole('button', { name: 'Risk notunu göster' }))
    expect(screen.getByText(/Geçmişte bir kez kendine zarar verme/)).toBeDefined()

    rerender(<DanisanKarti danisan={digeri} {...ortak} />)
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
      notlariGetir: vi.fn().mockResolvedValue(resmiNotlar),
      notSiniri: 200,
      raporKaydiOlustur: vi.fn().mockResolvedValue(undefined),
      ekYukle: vi.fn().mockResolvedValue(undefined),
      ekSil: vi.fn().mockResolvedValue(undefined),
      onRizaKaydet: vi.fn().mockResolvedValue(undefined),
      onKapat: vi.fn(),
    }
    const { rerender } = render(<DanisanKarti danisan={danisan} {...ortak} />)
    expect((screen.getByLabelText('Açık rıza tarihi') as HTMLInputElement).value).toBe('2026-03-01')

    rerender(<DanisanKarti danisan={digeri} {...ortak} />)
    expect((screen.getByLabelText('Açık rıza tarihi') as HTMLInputElement).value).toBe('2020-01-02')
    expect((screen.getByLabelText('İmzalı onam dosyası') as HTMLSelectElement).value).toBe('')
  })
})
