import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { YedekListesi } from '../api'
import { GeriYuklemeEkrani, type GeriYuklemeSebebi } from './GeriYuklemeEkrani'

type GeriYukleGirdi = {
  dizin?: string
  dosya_adi: string
  parola?: string
  kurtarma_kodu?: string
}
type GeriYukleMock = Mock<(girdi: GeriYukleGirdi) => Promise<unknown>>

const VERI_DIZINI = '/Users/psikolog/Library/Application Support/psikolog-not-takip'

const LISTE: YedekListesi = {
  hedef_dizin: '/Volumes/YEDEK/terapi',
  yedekler: [
    { dosya_adi: 'yedek-2026-09-08.db', tarih: '2026-09-08', boyut: 2 * 1024 * 1024 },
    { dosya_adi: 'yedek-2026-09-07.db', tarih: '2026-09-07', boyut: 1024 * 1024 },
  ],
}

function kur(
  secenek: {
    sebep?: GeriYuklemeSebebi
    liste?: YedekListesi
    listeHatasi?: Error
    geriYukle?: GeriYukleMock
    onTamamlandi?: () => void
    oncekileriKaldir?: (damga: string) => Promise<{ tasinan: number; damga: string }>
  } = {},
) {
  const yedekleriGetir = vi.fn(async () => {
    if (secenek.listeHatasi) throw secenek.listeHatasi
    return secenek.liste ?? LISTE
  })
  const geriYukle: GeriYukleMock =
    secenek.geriYukle ?? vi.fn(async (_g: GeriYukleGirdi) => ({ tarih: '2026-09-08' }))
  const oncekileriKaldir =
    secenek.oncekileriKaldir ?? vi.fn(async (_d: string) => ({ tasinan: 2, damga: _d }))
  const sonuc = render(
    <GeriYuklemeEkrani
      veriDizini={VERI_DIZINI}
      sebep={secenek.sebep ?? 'veritabani-bozuk'}
      yedekleriGetir={yedekleriGetir}
      geriYukle={geriYukle}
      oncekileriKaldir={oncekileriKaldir}
      onTamamlandi={secenek.onTamamlandi ?? (() => {})}
    />,
  )
  return { ...sonuc, yedekleriGetir, geriYukle, oncekileriKaldir }
}

describe('GeriYuklemeEkrani — metnin taşıdığı güvenceler', () => {
  it('KOSULSUZ ilk adim "kopyanizi alin" ve formdan ONCE geliyor', async () => {
    // Bu ekrani goren kisi panikte ve deneyecegi ilk sey genellikle geri
    // dondurulemez olandir. Kopya alindiktan sonra hicbir adim kalici zarar
    // veremez; alinmadan once her adim verebilir. Bu yuzden SIRA da bir
    // iddia: "once kopya" basligi, yedek secme basligindan ONCE olmali.
    const { container } = kur()
    await screen.findByRole('heading', { name: /yedeğinizi seçin/i })

    const basliklar = Array.from(container.querySelectorAll('h1, h2')).map(
      (e) => e.textContent ?? '',
    )
    const kopyaSirasi = basliklar.findIndex((b) => /kopyasını alın/i.test(b))
    const secmeSirasi = basliklar.findIndex((b) => /yedeğinizi seçin/i.test(b))
    expect(kopyaSirasi).toBeGreaterThanOrEqual(0)
    expect(kopyaSirasi).toBeLessThan(secmeSirasi)
  })

  it('"yeniden kurulum yapmayin" uyarisi var ve NEDENINI soyluyor', () => {
    // Panikteki kullanicinin yapacagi en olasi ve en yikici hamle budur:
    // yeni kurulum yeni bir anahtar uretip eskisinin yerine gecer.
    const { container } = kur()
    const metin = container.textContent ?? ''
    expect(metin).toMatch(/yeniden kurulum yapmayın/i)
    // Ciplak bir yasak yetmez; gerekcesi olmayan bir uyari uygulanmaz.
    expect(metin).toMatch(/yeni bir anahtar üretip/i)
    expect(metin).toMatch(/hiçbir parolayla/i)
  })

  it('veri klasorunun GERCEK yolunu kopyalanabilir bicimde gosterir', () => {
    // macOS'ta bu klasor `~/Library/Application Support/...` altindadir ve
    // Finder onu gizler; yol yazilmadan "klasorun tamamini kopyalayin"
    // adimi fiilen uygulanamaz.
    const { container } = kur()
    const kod = Array.from(container.querySelectorAll('code')).find(
      (e) => e.textContent === VERI_DIZINI,
    )
    expect(kod, 'veri dizini yolu <code> icinde gosterilmeli').toBeTruthy()
    expect(container.textContent).toMatch(/veri klasörü/i)
  })

  it('elle prosedur WAL/SHM adimini ATLAMIYOR', () => {
    // `backup::geri_yukle` yerlestirmeden sonra `veri.db-wal`/`-shm`
    // dosyalarini siler. Uygulama baglantiyi oturum boyunca acik tuttugu
    // icin veri dizininde neredeyse her zaman bir WAL vardir; adim metinden
    // duserse SQLite BASKA bir veritabanina ait WAL'i replay eder ve
    // kullanici geri yukledigi kopyayi ilk denemesinde bozar.
    const { container } = kur()
    const metin = container.textContent ?? ''
    expect(metin).toContain('veri.db-wal')
    expect(metin).toContain('veri.db-shm')

    const adimlar = screen.getAllByRole('listitem').map((e) => e.textContent ?? '')
    const walAdimi = adimlar.find((a) => a.includes('veri.db-wal'))
    expect(walAdimi, 'WAL temizligi numarali adimlar arasinda olmali').toBeTruthy()
    expect(walAdimi).toMatch(/sil/i)
  })

  it('yedegin IKI DOSYA oldugunu ve eksik ciftin listelenmedigini soyler', () => {
    const { container } = kur()
    const metin = container.textContent ?? ''
    expect(metin).toMatch(/iki dosyadan/i)
    expect(metin).toContain('yedek-TARİH.db')
    expect(metin).toContain('yedek-TARİH.keystore.json')
    expect(metin).toMatch(/ikisi de yerinde/i)
  })

  it('teknik destege yonlendirmez; adimlar kullanicinin kendi yapabilecegi seyler', () => {
    // Urun tek kisilik bir muayenehane icin; "teknik destek" diye bir sey yok.
    const { container } = kur()
    expect(container.textContent).not.toMatch(/teknik destek/i)
  })

  it('acilis metni SEBEBE gore degisiyor ve bozuk veritabaninda parolayi suclamiyor', () => {
    const { container, unmount } = kur({ sebep: 'veritabani-bozuk' })
    expect(container.textContent).toMatch(/parolanız doğru/i)
    unmount()

    const yeni = kur({ sebep: 'kurulum' })
    expect(yeni.container.textContent).toMatch(/kurulum yapmadan önce/i)
    expect(yeni.container.textContent).not.toMatch(/parolanız doğru ve anahtar/i)
  })
})

describe('GeriYuklemeEkrani — davranış', () => {
  it('acilista kayitli klasore bakar ve yedekleri listeler', async () => {
    const { yedekleriGetir } = kur()
    expect(await screen.findByText('2026-09-08')).toBeDefined()
    expect(screen.getByText('2026-09-07')).toBeDefined()
    // Ilk cagri klasorsuz: kayitli ayar sunucuda cozuluyor.
    expect(yedekleriGetir).toHaveBeenCalledWith(undefined)
    // Ve cozulen klasor kullaniciya gosteriliyor.
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/yedek klasörü/i) as HTMLInputElement).value,
      ).toBe('/Volumes/YEDEK/terapi'),
    )
  })

  it('yedek yoksa EKSIK DOSYAYI ARAMAYI onerir, "bozuk" demez', () => {
    // "Eksik" ile "bozuk" ayri seyler: eksik dosya buyuk ihtimalle
    // tasinmistir ve bulunabilir. "Yedeginiz bozuk" demek kullaniciyi
    // saglam bir yedegi silmeye itebilir.
    const { container } = kur({ liste: { hedef_dizin: '/Volumes/YEDEK', yedekler: [] } })
    return waitFor(() => {
      const metin = container.textContent ?? ''
      expect(metin).toMatch(/geri yüklenebilir bir yedek bulunamadı/i)
      expect(metin).toMatch(/aramaya değer, silinmiş olmayabilir/i)
    })
  })

  it('yedek secilmeden parola sorulmaz; secilince ne KAYBEDILECEGI yaziyor', async () => {
    kur()
    await screen.findByText('2026-09-08')
    expect(screen.queryByLabelText(/parola/i)).toBeNull()

    await userEvent.click(screen.getAllByRole('radio')[0])
    const onay = await screen.findByLabelText(/2026-09-08 tarihindeki parolanız/i)
    expect(onay).toBeDefined()
    // Geri yukleme yikici bir islem: onay metni ne olacagini soylemeli.
    expect(document.body.textContent).toMatch(/o tarihten sonra girdiğiniz/i)
  })

  it('secilen yedegi DOSYA ADIYLA gonderir; hicbir yol istemciden gelmez', async () => {
    const geriYukle: GeriYukleMock = vi.fn(async (_g: GeriYukleGirdi) => ({
      tarih: '2026-09-08',
    }))
    kur({ geriYukle })
    await screen.findByText('2026-09-08')
    await userEvent.click(screen.getAllByRole('radio')[0])
    await userEvent.type(screen.getByLabelText(/parolanız/i), 'gizliparola')
    await userEvent.click(screen.getByRole('button', { name: 'Bu yedeği geri yükle' }))

    await waitFor(() => expect(geriYukle).toHaveBeenCalled())
    expect(geriYukle).toHaveBeenCalledWith({
      dizin: '/Volumes/YEDEK/terapi',
      dosya_adi: 'yedek-2026-09-08.db',
      parola: 'gizliparola',
    })
    // Kurtarma kodu ALANI gonderilmedi: sunucu ikisini ayri degerlendiriyor.
    expect(geriYukle.mock.calls[0][0]).not.toHaveProperty('kurtarma_kodu')
  })

  it('parolasini unutan kullanici kurtarma koduyla gonderir', async () => {
    const geriYukle: GeriYukleMock = vi.fn(async (_g: GeriYukleGirdi) => ({
      tarih: '2026-09-08',
    }))
    kur({ geriYukle })
    await screen.findByText('2026-09-08')
    await userEvent.click(screen.getAllByRole('radio')[0])
    await userEvent.click(screen.getByRole('button', { name: 'Parolamı unuttum' }))
    await userEvent.type(screen.getByLabelText(/kurtarma kodunuz/i), 'ABCDE-FGHJK')
    await userEvent.click(screen.getByRole('button', { name: 'Bu yedeği geri yükle' }))

    await waitFor(() => expect(geriYukle).toHaveBeenCalled())
    expect(geriYukle.mock.calls[0][0]).toMatchObject({ kurtarma_kodu: 'ABCDE-FGHJK' })
    expect(geriYukle.mock.calls[0][0]).not.toHaveProperty('parola')
  })

  it('kurtarma kodu alani VARSAYILAN gizli, "Goster" ile gecici gorunur olur (Gorev 6b)', async () => {
    // Kurtarma kodu paroladan DAHA GÜÇLÜ bir sır (bkz. `KilitEkrani`'deki
    // aynı karar): ekran görünürken danışan odada olabilir, dolayısıyla
    // varsayılan `type=password` ile aynı korumayı almalı. "Göster" düğmesi
    // yalnızca kurtarma modunda görünür ve geçici bir istisnadır.
    kur()
    await screen.findByText('2026-09-08')
    await userEvent.click(screen.getAllByRole('radio')[0])
    await userEvent.click(screen.getByRole('button', { name: 'Parolamı unuttum' }))

    const alan = screen.getByLabelText(/kurtarma kodunuz/i) as HTMLInputElement
    expect(alan.type).toBe('password')
    expect(screen.queryByRole('button', { name: 'Göster' })).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Göster' }))
    expect(alan.type).toBe('text')

    await userEvent.click(screen.getByRole('button', { name: 'Gizle' }))
    expect(alan.type).toBe('password')
  })

  it('sunucunun hata mesajini OLDUGU GIBI gosterir ve ekranda kalir', async () => {
    // "Bu yedek bu parolayla acilmiyor" ile "yedek eksik" ayri sorunlar ve
    // kullanici hangisini duzeltecegini bilmeli. Genellestirmek, bu kod
    // tabaninda dort katmanda bulunan hata sinifinin ta kendisi.
    const geriYukle: GeriYukleMock = vi.fn(async (_g: GeriYukleGirdi) => {
      throw new Error('Bu yedek bu parolayla açılmıyor. Hiçbir şey değiştirilmedi.')
    })
    kur({ geriYukle })
    await screen.findByText('2026-09-08')
    await userEvent.click(screen.getAllByRole('radio')[0])
    await userEvent.type(screen.getByLabelText(/parolanız/i), 'yanlis')
    await userEvent.click(screen.getByRole('button', { name: 'Bu yedeği geri yükle' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(document.body.textContent).toMatch(/Hiçbir şey değiştirilmedi/i)
    // Basarili ekrana GECMEDI.
    expect(screen.queryByRole('heading', { name: /tamamlandı/i })).toBeNull()
  })

  it('basarili olunca "o tarihteki parolanizla girin" der ve devam ettirir', async () => {
    const onTamamlandi = vi.fn()
    kur({ onTamamlandi })
    await screen.findByText('2026-09-08')
    await userEvent.click(screen.getAllByRole('radio')[0])
    await userEvent.type(screen.getByLabelText(/parolanız/i), 'gizliparola')
    await userEvent.click(screen.getByRole('button', { name: 'Bu yedeği geri yükle' }))

    expect(await screen.findByRole('heading', { name: /geri yükleme tamamlandı/i })).toBeDefined()
    // Kullanicinin bir sonraki adimda karsilasacagi sey: yedegin ALINDIGI
    // tarihteki parola. Parolasini sonradan degistirdiyse yenisi calismaz
    // ve bunu ONCEDEN bilmeli.
    expect(document.body.textContent).toMatch(/o tarihteki parolanızla/i)
    await userEvent.click(screen.getByRole('button', { name: 'Devam et' }))
    expect(onTamamlandi).toHaveBeenCalled()
  })

  it('baska bir klasore bakilabilir (yeni bilgisayar senaryosu)', async () => {
    const { yedekleriGetir } = kur({
      listeHatasi: new Error('Yedek klasörü belli değil.'),
    })
    expect(await screen.findByRole('alert')).toBeTruthy()

    await userEvent.clear(screen.getByLabelText(/yedek klasörü/i))
    await userEvent.type(screen.getByLabelText(/yedek klasörü/i), '/Volumes/USB/yedek')
    await userEvent.click(screen.getByRole('button', { name: 'Yedekleri ara' }))

    await waitFor(() => expect(yedekleriGetir).toHaveBeenCalledWith('/Volumes/USB/yedek'))
  })

  it('`.onceki` kalintilarini kenara kaldirma eylemi BU EKRANDA', async () => {
    // Inceleme (ikinci tur): geri yukleme `.onceki` kalintisina takilinca
    // durur ve tam o anda oturum cogu zaman ACILAMAZ -- eylem yalnizca
    // Ayarlar'da dursaydi kullanici ona hic ulasamaz, geriye Finder'da elle
    // dosya tasimak kalirdi (ve oradaki ilk refleks SILMEK).
    // Eylem SECIMDEN BAGIMSIZ gorunur: bu ekrana canli cift acilamadigi
    // icin gelinmis olabilir ve yedek listesi BOS gelebilir.
    const { oncekileriKaldir } = kur({ liste: { hedef_dizin: '/Volumes/YEDEK/terapi', yedekler: [] } })
    await screen.findByRole('heading', { name: 'Yedekten geri yükleme' })

    const dugme = screen.getByRole('button', { name: /kenara kaldır/i })
    // Metin ne YAPMADIGINI da soyluyor.
    expect(dugme.textContent).toMatch(/silmez/i)

    await userEvent.click(dugme)
    await waitFor(() => expect(oncekileriKaldir).toHaveBeenCalledTimes(1))
    // Damga dosya adina giriyor: YYYYAAGG-SSDD.
    expect((oncekileriKaldir as Mock).mock.calls[0][0]).toMatch(/^\d{8}-\d{4}$/)

    const bilgi = await screen.findByRole('status')
    expect(bilgi.textContent).toMatch(/2 eski dosya/)
    expect(bilgi.textContent).toMatch(/hiçbiri silinmedi/i)
  })
})
