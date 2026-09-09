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
    ekYukle: vi.fn().mockResolvedValue(undefined),
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

  it('risk notu gorunur', () => {
    kur()
    expect(screen.getByText(/Geçmişte bir kez kendine zarar verme/)).toBeDefined()
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
    expect(screen.getByText(/gelinmiş ve ödenmemiş/i)).toBeDefined()
  })

  it('bakiye NEYI SAYMADIGINI da soyler', () => {
    // Neyi saydığını yazmak yetmiyor: "gelmedi" işaretli seanslar sayının
    // dışında ve bu, gelmeyen seansları ücretlendiren bir terapist için
    // sessizce eksik bir bakiyedir. Ekran o dışlamayı açıkça yazmalı.
    kur()
    expect(screen.getByText(/gelmedi olarak işaretlenen seanslar bu sayıya girmez/i))
      .toBeDefined()
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
      ekYukle: vi.fn().mockResolvedValue(undefined),
      onRizaKaydet: vi.fn().mockResolvedValue(undefined),
      onKapat: vi.fn(),
    }
    const { rerender } = render(<DanisanKarti danisan={danisan} {...ortak} />)

    await userEvent.click(screen.getByRole('button', { name: 'Veri raporu dışa aktar' }))
    await screen.findByRole('link', { name: /raporu indir/i })

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
      ekYukle,
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
      ekYukle: vi.fn().mockResolvedValue(undefined),
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
