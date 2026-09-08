import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KeystoreBozukEkrani } from './KeystoreBozukEkrani'

const VERI_DIZINI = '/Users/psikolog/Library/Application Support/psikolog-not-takip'

function kur() {
  return render(<KeystoreBozukEkrani veriDizini={VERI_DIZINI} />)
}

describe('KeystoreBozukEkrani', () => {
  it('dosyanin silinmemesi gerektigini vurgular', () => {
    kur()
    expect(screen.getByText(/bu dosyayı silmeyin/i)).toBeDefined()
  })

  it('kullanicinin kendi yapabilecegi somut adimlar verir, teknik destege yonlendirmez', () => {
    // Urun tek kisilik bir muayenehane icin; "teknik destek" diye bir sey yok.
    // Kullaniciya yapamayacagi bir sey soylemek, felaket aninda onu tamamen
    // caresiz birakir.
    const { container } = kur()
    expect(container.textContent).not.toMatch(/teknik destek/i)

    // Yerine: numaralandirilmis somut adimlar.
    expect(screen.getAllByRole('list').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(3)
  })

  it('yedegin iki dosyadan olustugunu ve ikisinin birlikte geri yuklendigini soyler', () => {
    // Gorev 12 oncesi bu ekran "bir yedekten geri yukleme yapmaniz gerekebilir"
    // diyordu; bu tavsiye YANLISTI, cunku veritabani yedegi bozuk bir anahtar
    // dosyasini onarmiyordu. Artik dogru: yedek bir cifttir.
    const { container } = kur()
    expect(container.textContent).toMatch(/iki dosyadan/i)
    expect(container.textContent).toContain('yedek-TARİH.db')
    expect(container.textContent).toContain('yedek-TARİH.keystore.json')
  })

  // --- Inceleme maddesi 2: veri dizininin gercek yolu gosterilir ---
  it('veri klasorunun gercek yolunu kopyalanabilir bicimde gosterir', () => {
    // macOS'ta bu klasor `~/Library/Application Support/...` altindadir ve
    // Finder onu varsayilan olarak gizler. Yol yazilmadan kullanici "bu iki
    // dosyayi veri klasorune kopyalayin" adimini fiilen uygulayamaz.
    const { container } = kur()
    const kod = Array.from(container.querySelectorAll('code')).find(
      (e) => e.textContent === VERI_DIZINI,
    )
    expect(kod, 'veri dizini yolu <code> icinde gosterilmeli').toBeTruthy()
    // Metin, yolun ne oldugunu da soylemeli; ciplak bir yol tek basina anlamsiz.
    expect(container.textContent).toMatch(/veri klasörü/i)
  })

  // --- Inceleme maddesi 3: WAL temizligi elle prosedurde de yer alir ---
  it('geri yukleme adimlarinda WAL/SHM dosyalarinin silinmesini soyler', () => {
    // `backup::geri_yukle` yerlestirmeden sonra bunlari siliyor. Uygulama
    // baglantiyi oturum boyunca acik tuttugundan cokme aninda veri dizininde
    // neredeyse her zaman bir `veri.db-wal` vardir; adim metinden duserse
    // kullanici geri yukledigi veritabanini ilk denemesinde bozar.
    const { container } = kur()
    const metin = container.textContent ?? ''
    expect(metin).toContain('veri.db-wal')
    expect(metin).toContain('veri.db-shm')

    // Ve bu, numarali adimlardan birinin ICINDE olmali -- dipnot degil.
    const adimlar = screen.getAllByRole('listitem').map((e) => e.textContent ?? '')
    const walAdimi = adimlar.find((a) => a.includes('veri.db-wal'))
    expect(walAdimi, 'WAL temizligi numarali adimlar arasinda olmali').toBeTruthy()
    expect(walAdimi).toMatch(/sil/i)
  })

  // --- Inceleme maddesi 1: var olmayan bir kurtarma yolu kesin dille anlatilmaz ---
  it('geri yukleme adimlarini kosullu sunar ve yedegi olmayana da bir yol gosterir', () => {
    // `backup::yedek_al`'i bugun hicbir akis cagirmiyor: cogu kullanicida bir
    // yedek klasoru YOKTUR. Ekran "yedek klasorunuzu acin" diye kesin bir emir
    // verirse, kullanici bulamayacagi bir klasoru arar ve eskisinden caresiz
    // kalir.
    const { container } = kur()
    const metin = container.textContent ?? ''

    // Yedek adimlari kosullu bir baslik altinda.
    expect(screen.getByRole('heading', { name: /bir yedeğiniz varsa/i })).toBeDefined()
    // Yedeklemenin kendiliginden calismadigi acikca yaziyor.
    expect(metin).toMatch(/kendiliğinden yedek almıyor/i)

    // Yedegi olmayan kullanicinin yolu esit agirlikta: kendi basligi olan bir
    // bolum, sonda sikismis tek satir degil.
    expect(screen.getByRole('heading', { name: /yedeğiniz yoksa/i })).toBeDefined()
    expect(metin).toMatch(/yeniden kurulum yapmayın/i)
    expect(metin).toContain('veri.db')
    expect(metin).toContain('keystore.json')
  })

  it('Turkce eki dogru: "erisiminizi kaybetmenize"', () => {
    const { container } = kur()
    expect(container.textContent).toContain('erişiminizi kaybetmenize')
  })
})
