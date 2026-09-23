import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { KeystoreBozukEkrani } from './KeystoreBozukEkrani'

const VERI_DIZINI = '/Users/psikolog/Library/Application Support/psikolog-not-takip'

function kur(onGeriYukle: () => void = () => {}, oncekileriKaldir = vi.fn(async () => ({ tasinan: 0 }))) {
  return {
    ...render(
      <KeystoreBozukEkrani
        veriDizini={VERI_DIZINI}
        onGeriYukle={onGeriYukle}
        oncekileriKaldir={oncekileriKaldir}
      />,
    ),
    oncekileriKaldir,
  }
}

describe('KeystoreBozukEkrani', () => {
  it('dosyanin silinmemesi gerektigini vurgular', () => {
    kur()
    expect(screen.getByText(/bu dosyayı silmeyin/i)).toBeDefined()
  })

  it('`.onceki` kalintilarini kenara kaldirma eylemi BURADA da var', async () => {
    // Bu ekranda oturum TANIM GEREGI acilamaz (anahtar dosyasi okunamiyor).
    // Eylem kilit kapisinin disinda oldugu icin buradan da calisir; aksi
    // halde kullanicinin tek cikisi Finder'da elle dosya tasimak olurdu.
    const { oncekileriKaldir } = kur()
    const dugme = screen.getByRole('button', { name: /kenara kaldır/i })
    expect(dugme.textContent).toMatch(/silmez/i)

    await userEvent.click(dugme)
    expect(oncekileriKaldir).toHaveBeenCalledTimes(1)
    expect((await screen.findByRole('status')).textContent).toMatch(/bulunamadı/i)
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
    // Metin eskiden "uygulama su an kendiliginden yedek almiyor" diyordu ve o
    // an DOGRUYDU: `backup::yedek_al`'in hicbir cagri yeri yoktu. Artik var,
    // dolayisiyla o cumle bir yalana donusurdu ve kaldirildi. Kural
    // degismedi: ekran, urunun yapabildigini soyler, yapamadigini degil.
    const { container } = kur()
    const metin = container.textContent ?? ''

    // Bayat cumlenin geri gelmedigi ACIKCA olculuyor: yalnizca silmek,
    // birinin onu geri yazmasini engellemez.
    expect(metin).not.toMatch(/kendiliğinden yedek almıyor/i)

    // Yedek adimlari hala kosullu bir baslik altinda: klasorunu hic secmemis
    // bir kullanicinin yedegi olmayabilir.
    expect(screen.getByRole('heading', { name: /bir yedeğiniz varsa/i })).toBeDefined()

    // Yedegi olmayan kullanicinin yolu esit agirlikta: kendi basligi olan bir
    // bolum, sonda sikismis tek satir degil.
    expect(screen.getByRole('heading', { name: /yedeğiniz yoksa/i })).toBeDefined()
    expect(metin).toMatch(/yeniden kurulum yapmayın/i)
    expect(metin).toContain('veri.db')
    expect(metin).toContain('keystore.json')
  })

  it('uygulamanin kendi geri yukleme ekranina bir yol acar', async () => {
    // Bu ekranin en olası kullanicisi elle dosya kopyalamak zorunda
    // kalmamali: urun artik cifti kendisi yerlestiriyor ve WAL temizligini
    // kendisi yapiyor. Elle prosedur YEDEK yol olarak duruyor (yukaridaki
    // testler onu ayrica sabitliyor).
    const onGeriYukle = vi.fn()
    kur(onGeriYukle)
    await userEvent.click(screen.getByRole('button', { name: /yedekten geri yükle/i }))
    expect(onGeriYukle).toHaveBeenCalled()
  })

  it('Turkce eki dogru: "erisiminizi kaybetmenize"', () => {
    const { container } = kur()
    expect(container.textContent).toContain('erişiminizi kaybetmenize')
  })
})
