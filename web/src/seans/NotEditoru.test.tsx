import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YetkisizHata } from '../api'
import { NotEditoru } from './NotEditoru'
import { taslakOku, taslaklariUnut } from './taslak'

// `taslakAnahtari` ZORUNLU bir prop: taslak deposu not kimliğine göre
// ayrılmasaydı bir seansın kaydedilmemiş metni başka bir seansın editörüne
// geri yüklenirdi. Varsayılanı olsaydı, prop'u geçirmeyi unutan bir çağrı
// yeri sessizce o sızıntıyı üretirdi.
function kur(ozel = {}) {
  const props = {
    baslangicIcerik: '',
    baslangicSablon: 'dap',
    onKaydet: vi.fn().mockResolvedValue(undefined),
    gecikmeMs: 20,
    taslakAnahtari: 'not-1',
    ...ozel,
  }
  render(<NotEditoru {...props} />)
  return props
}

function alan() {
  return screen.getByLabelText('Seans notu') as HTMLTextAreaElement
}

// Depo modül düzeyinde (bileşen ağacının dışında) yaşıyor — testler arası
// sızmaması için her testten önce boşaltılıyor.
beforeEach(() => {
  taslaklariUnut()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NotEditoru', () => {
  it('kaydet butonu yoktur', () => {
    kur()
    expect(screen.queryByRole('button', { name: /kaydet/i })).toBeNull()
  })

  it('yazdiktan sonra kendiliginden kaydeder', async () => {
    const props = kur()
    await userEvent.type(screen.getByLabelText('Seans notu'), 'merhaba')
    await waitFor(() => expect(props.onKaydet).toHaveBeenCalled())
    expect(props.onKaydet).toHaveBeenCalledWith(
      expect.objectContaining({ icerik: expect.stringContaining('merhaba') }),
    )
  })

  it('hizli yazarken her tusa kayit atmaz', async () => {
    const props = kur({ gecikmeMs: 50 })
    await userEvent.type(screen.getByLabelText('Seans notu'), 'abcdefghij')
    await waitFor(() => expect(props.onKaydet).toHaveBeenCalled())
    expect(props.onKaydet.mock.calls.length).toBeLessThan(5)
  })

  it('kaydedildi gostergesi cikar', async () => {
    kur()
    await userEvent.type(screen.getByLabelText('Seans notu'), 'x')
    expect(await screen.findByText(/kaydedildi/i)).toBeDefined()
  })

  it('kayit basarisiz olursa uyarir ve icerigi silmez', async () => {
    kur({ onKaydet: vi.fn().mockRejectedValue(new Error('ağ hatası')) })
    await userEvent.type(screen.getByLabelText('Seans notu'), 'onemli not')
    expect(await screen.findByText(/kaydedilemedi/i)).toBeDefined()
    expect((screen.getByLabelText('Seans notu') as HTMLTextAreaElement).value).toContain(
      'onemli not',
    )
  })

  it('sablon secilince basliklar bos editore eklenir', async () => {
    kur()
    await userEvent.selectOptions(screen.getByLabelText('Şablon'), 'soap')
    const alan = screen.getByLabelText('Seans notu') as HTMLTextAreaElement
    expect(alan.value).toContain('Öznel')
    expect(alan.value).toContain('Plan')
  })

  it('dolu editorde sablon degisimi mevcut metni ezmez', async () => {
    kur({ baslangicIcerik: 'yazilmis onemli not' })
    await userEvent.selectOptions(screen.getByLabelText('Şablon'), 'soap')
    const alan = screen.getByLabelText('Seans notu') as HTMLTextAreaElement
    expect(alan.value).toContain('yazilmis onemli not')
  })
})

// "2 sn sonra kaydeder" testinin tek başına koruduğu şey yoktur: HER tuş
// vuruşunda kaydeden bir editör de onu geçer. Aynı biçimde "boşta kaydetmez"
// testini HİÇ kaydetmeyen bir editör de geçer. İki yön birlikte ölçülüyor.
describe('NotEditoru — otomatik kaydın iki yönü', () => {
  it('kullanici hicbir sey yazmadiysa acilan editor kayit ATMAZ', async () => {
    const props = kur({ baslangicIcerik: 'gecen haftadan kalan not', gecikmeMs: 20 })
    // Gecikmenin birkaç katı beklenir: "henüz zamanı gelmedi" ile
    // "hiç kaydetmiyor" burada karışmasın.
    await new Promise((coz) => setTimeout(coz, 120))
    expect(props.onKaydet).not.toHaveBeenCalled()
    // Aynı editör yazınca kaydediyor — yukarıdaki sessizlik "hiç kaydetmeyen
    // editör" yüzünden değil.
    await userEvent.type(alan(), ' ek')
    await waitFor(() => expect(props.onKaydet).toHaveBeenCalledTimes(1))
  })

  it('yazma durunca tam bir kez kaydeder, gecikme dolmadan kaydetmez', async () => {
    const props = kur({ gecikmeMs: 80 })
    await userEvent.type(alan(), 'uzunca bir cumle')
    // Yazma bitti ama gecikme dolmadı: bu ana kadar hiç istek olmamalı.
    expect(props.onKaydet).not.toHaveBeenCalled()
    await waitFor(() => expect(props.onKaydet).toHaveBeenCalledTimes(1))
    expect(props.onKaydet).toHaveBeenCalledWith({ sablon: 'dap', icerik: 'uzunca bir cumle' })
  })
})

// Bu planın bağlayıcı kısıtı: otomatik kayıt sırasında 401 gelirse yazılmamış
// not içeriği SESSİZCE DÜŞÜRÜLEMEZ. `api.ts` 401'de merkezi dinleyicileri
// tetikler, `App` `AnaEkran`'ı GERÇEKTEN unmount eder — yani editörün React
// state'i yok olur. Aşağıdaki testler kararın iki yarısını da ölçer: metin
// unmount'tan sağ çıkar VE kullanıcıya söylenir.
describe('NotEditoru — 401 sirasinda yazilmamis icerik', () => {
  function editorCiz(
    onKaydet: (kayit: { sablon: string; icerik: string }) => Promise<void>,
    ozel: { baslangicIcerik?: string; taslakAnahtari?: string } = {},
  ) {
    return render(
      <NotEditoru
        baslangicIcerik={ozel.baslangicIcerik ?? ''}
        baslangicSablon="dap"
        onKaydet={onKaydet}
        gecikmeMs={20}
        taslakAnahtari={ozel.taslakAnahtari ?? 'not-42'}
      />,
    )
  }

  it('401 ile unmount edilen editorun metni kilit acilinca geri gelir ve sunucuya yazilir', async () => {
    const kilitli = vi.fn().mockRejectedValue(new YetkisizHata('Oturum zaman aşımına uğradı.'))
    const { unmount } = editorCiz(kilitli)

    await userEvent.type(alan(), 'danisan bugun cok kaygiliydi')
    await waitFor(() => expect(kilitli).toHaveBeenCalled())
    // Kullanıcıya kaydedilemediği ve metnin korunduğu söyleniyor.
    expect(await screen.findByText(/kaydedilemedi/i)).toBeDefined()

    // App'in yaptığı şey: görsel perde değil, gerçek unmount.
    unmount()

    // Kilit açıldı; AnaEkran yeniden mount edildi. Sunucudan gelen içerik
    // ESKİ hâl (yazılan metin hiç kaydedilemedi).
    const acik = vi.fn().mockResolvedValue(undefined)
    editorCiz(acik)

    expect(alan().value).toContain('danisan bugun cok kaygiliydi')
    expect(screen.getByText(/geri yüklendi/i)).toBeDefined()
    // Kullanıcı kaldığı yerden devam edebiliyor VE geri yüklenen metin
    // ekranda kalmakla yetinmiyor, ilk fırsatta sunucuya yazılıyor.
    await waitFor(() =>
      expect(acik).toHaveBeenCalledWith(
        expect.objectContaining({ icerik: 'danisan bugun cok kaygiliydi' }),
      ),
    )
  })

  it('kayit basarili olduysa yeniden mount TEMIZ gelir (yanlis kurtarma uyarisi yok)', async () => {
    const kaydet = vi.fn().mockResolvedValue(undefined)
    const { unmount } = editorCiz(kaydet)

    await userEvent.type(alan(), 'kaydedilmis metin')
    await screen.findByText(/kaydedildi/i)
    expect(taslakOku('not-42')).toBeUndefined()

    unmount()
    const ikinci = vi.fn().mockResolvedValue(undefined)
    // Sunucu artık kaydedilmiş metni döndürüyor.
    editorCiz(ikinci, { baslangicIcerik: 'kaydedilmis metin' })

    expect(screen.queryByText(/geri yüklendi/i)).toBeNull()
    await new Promise((coz) => setTimeout(coz, 120))
    expect(ikinci).not.toHaveBeenCalled()
  })

  it('taslak not kimligine baglidir: baska seansin editorune sizmaz', async () => {
    const kilitli = vi.fn().mockRejectedValue(new YetkisizHata('Oturum kilitli.'))
    const { unmount } = editorCiz(kilitli, { taslakAnahtari: 'not-42' })
    await userEvent.type(alan(), 'ayse hanimin seansi')
    await waitFor(() => expect(kilitli).toHaveBeenCalled())
    unmount()

    // Kilit açıldı ama kullanıcı BAŞKA bir randevuyu açtı.
    editorCiz(vi.fn().mockResolvedValue(undefined), { taslakAnahtari: 'not-99' })
    expect(alan().value).toBe('')
    expect(screen.queryByText(/geri yüklendi/i)).toBeNull()
  })

  it('hata sonrasi Yeniden dene ile kayit tekrarlanir', async () => {
    let basarisiz = true
    const onKaydet = vi.fn(async () => {
      if (basarisiz) throw new Error('ağ hatası')
    })
    editorCiz(onKaydet)

    await userEvent.type(alan(), 'not metni')
    expect(await screen.findByText(/kaydedilemedi/i)).toBeDefined()

    basarisiz = false
    await userEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }))
    expect(await screen.findByText(/kaydedildi/i)).toBeDefined()
    expect(taslakOku('not-42')).toBeUndefined()
  })
})

// Bileşen testlerinin en sık gördüğü kör nokta: her test TEMİZ BİR MOUNT
// yapar. Bu editörün gerçek hayattaki kullanımı ise prop değişimidir —
// kullanıcı takvimde başka bir randevuya tıklar. Çağıran taraf `key` vermeyi
// unutursa bileşen yeniden mount EDİLMEZ.
describe('NotEditoru — prop degisimi (yeniden mount olmadan)', () => {
  it('baska seansa gecince icerik tasinmaz, geri donunce taslak geri gelir', async () => {
    const kaydet = vi.fn().mockResolvedValue(undefined)
    // Gecikme uzun: birinci seansın metni hiç kaydedilemeden geçiş oluyor.
    const birinci = (
      <NotEditoru
        baslangicIcerik=""
        baslangicSablon="dap"
        onKaydet={kaydet}
        gecikmeMs={5000}
        taslakAnahtari="not-1"
      />
    )
    const { rerender } = render(birinci)

    await userEvent.type(alan(), 'birinci seansin notu')

    rerender(
      <NotEditoru
        baslangicIcerik="ikinci seansin notu"
        baslangicSablon="soap"
        onKaydet={kaydet}
        gecikmeMs={5000}
        taslakAnahtari="not-2"
      />,
    )

    // En kritik iddia: birinci seansın metni ikinci seansın editöründe DEĞİL.
    // Orada kalsaydı ikinci randevunun notuna yazılırdı — yanlış danışanın
    // dosyasına not.
    expect(alan().value).toBe('ikinci seansin notu')
    expect((screen.getByLabelText('Şablon') as HTMLSelectElement).value).toBe('soap')
    expect(kaydet).not.toHaveBeenCalled()

    // Geri dönülünce birinci seansın kaydedilmemiş metni kaybolmuş olmamalı.
    rerender(birinci)
    expect(alan().value).toBe('birinci seansin notu')
  })
})

describe('NotEditoru — kapanirken bekleyen icerik', () => {
  it('unmount aninda bekleyen icerik zamanlayiciyi beklemeden kaydedilir', async () => {
    const kaydet = vi.fn().mockResolvedValue(undefined)
    const { unmount } = render(
      <NotEditoru
        baslangicIcerik=""
        baslangicSablon="dap"
        onKaydet={kaydet}
        gecikmeMs={5000}
        taslakAnahtari="not-7"
      />,
    )
    await userEvent.type(alan(), 'yarim kalan cumle')
    expect(kaydet).not.toHaveBeenCalled()

    unmount()

    await waitFor(() =>
      expect(kaydet).toHaveBeenCalledWith({ sablon: 'dap', icerik: 'yarim kalan cumle' }),
    )
  })

  it('degisiklik yokken unmount kayit ATMAZ', async () => {
    const kaydet = vi.fn().mockResolvedValue(undefined)
    const { unmount } = render(
      <NotEditoru
        baslangicIcerik="gecen haftadan kalan not"
        baslangicSablon="dap"
        onKaydet={kaydet}
        gecikmeMs={5000}
        taslakAnahtari="not-8"
      />,
    )
    unmount()
    await new Promise((coz) => setTimeout(coz, 50))
    expect(kaydet).not.toHaveBeenCalled()
  })
})

describe('NotEditoru — kisitlar', () => {
  it('sablon listesi kapali kumedir, yeni sablon ekleme yolu yoktur', () => {
    kur()
    const secim = screen.getByLabelText('Şablon') as HTMLSelectElement
    // İddia AÇILIR LİSTENİN KENDİSİ üzerinde: sayfanın başka bir yerindeki
    // metin bu iddiayı tatmin edemesin.
    const kodlar = within(secim)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value)
      .sort()
    expect(kodlar).toEqual(['dap', 'serbest', 'soap'])
    expect(screen.queryByRole('button', { name: /şablon/i })).toBeNull()
    expect(screen.queryByRole('textbox', { name: /şablon/i })).toBeNull()
  })

  it('not icerigi konsola yazilmaz', async () => {
    const casuslar = (['log', 'info', 'warn', 'error', 'debug'] as const).map((ad) =>
      vi.spyOn(console, ad).mockImplementation(() => {}),
    )
    kur({ onKaydet: vi.fn().mockRejectedValue(new Error('ağ hatası')) })

    await userEvent.type(alan(), 'GIZLI-ICERIK-ABC')
    await screen.findByText(/kaydedilemedi/i)

    for (const casus of casuslar) {
      for (const cagri of casus.mock.calls) {
        expect(JSON.stringify(cagri)).not.toContain('GIZLI-ICERIK-ABC')
      }
    }
  })
})
