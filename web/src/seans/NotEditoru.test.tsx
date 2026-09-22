import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { YetkisizHata } from '../api'
import { NotEditoru } from './NotEditoru'
import { taslakOku, taslaklariUnut } from './taslak'

// # SAHTE SAAT — bu dosyada GERÇEK ZAMANA bağlı tek bir iddia yok
//
// Önceki hâli 20/50/80 ms'lik GERÇEK zamanlayıcılarla `userEvent.type`'ın
// tuş hızına güveniyordu: yüklü bir makinede iki tuş arası gecikmeyi aşıyor,
// editör araya bir kayıt sıkıştırıyor ve "tam bir kez kaydeder" / "gecikme
// dolmadan kaydetmez" iddiaları ÜRÜN DOĞRU ÇALIŞIRKEN kırılıyordu (tam paket
// koşusunda 5 koşunun 2'sinde; bkz. Plan 4 Görev 4 inceleme I1).
//
// Şimdi saat `vi.useFakeTimers()` ile duruyor ve YALNIZCA `ilerle(ms)` ile
// ilerliyor. "Hızlı yazma" bir yarış değil, bir olgu: `yaz()` harfleri
// aralarında tam olarak verilen sahte süreyle gönderiyor.
//
// `userEvent` burada BİLEREK yok: Testing Library'nin `asyncWrapper`'ı her
// `userEvent` çağrısının sonunda `setTimeout(0)` bekliyor ve sahte saati
// yalnızca `jest` globali varsa ilerletiyor (Vitest'te yok) — saat durunca
// ilk `userEvent` çağrısı sonsuza kadar asılı kalıyor. Aynı sebeple
// `waitFor`/`findBy*` de yok: yerlerine saat ilerletilip EŞZAMANLI iddia
// kuruluyor, ki bu da onlardan güçlü (koşul "sonunda" değil, TAM O ANDA
// doğru olmalı). Editör yalnızca `onChange` dinliyor; `fireEvent.change`
// ölçülen yolu değiştirmiyor.

/** Sahte saati `ms` ilerletir; zamanlayıcıların başlattığı sözleri ve React güncellemelerini boşaltır. */
async function ilerle(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

/**
 * Metni HARF HARF yazar. Her harften sonra sahte saat `aralikMs` ilerler;
 * `0` ise harfler arasında hiç zaman geçmez.
 */
async function yaz(alanEl: HTMLTextAreaElement, metin: string, aralikMs = 0) {
  for (const harf of metin) {
    fireEvent.change(alanEl, { target: { value: alanEl.value + harf } })
    if (aralikMs > 0) await ilerle(aralikMs)
  }
}

function sablonSec(kod: string) {
  fireEvent.change(screen.getByLabelText('Şablon'), { target: { value: kod } })
}

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
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('NotEditoru', () => {
  it('kaydet butonu yoktur', () => {
    kur()
    expect(screen.queryByRole('button', { name: /kaydet/i })).toBeNull()
  })

  it('yazdiktan sonra kendiliginden kaydeder', async () => {
    const props = kur()
    await yaz(alan(), 'merhaba')
    await ilerle(20)
    expect(props.onKaydet).toHaveBeenCalledTimes(1)
    expect(props.onKaydet).toHaveBeenCalledWith({ sablon: 'dap', icerik: 'merhaba' })
  })

  it('hizli yazarken her tusa kayit atmaz', async () => {
    // Tuş aralığı (10 ms) gecikmenin (50 ms) altında: her tuş zamanlayıcıyı
    // baştan kurar. Eski iddia "5'ten az" idi ve yük altında kırılıyordu;
    // saat sahteyken sonuç TAM OLARAK bir kayıt, son hâlle.
    const props = kur({ gecikmeMs: 50 })
    await yaz(alan(), 'abcdefghij', 10)
    expect(props.onKaydet).not.toHaveBeenCalled()
    await ilerle(40)
    expect(props.onKaydet).toHaveBeenCalledTimes(1)
    expect(props.onKaydet).toHaveBeenCalledWith({ sablon: 'dap', icerik: 'abcdefghij' })
  })

  it('kaydedildi gostergesi cikar', async () => {
    kur()
    await yaz(alan(), 'x')
    expect(screen.queryByText(/kaydedildi/i)).toBeNull()
    await ilerle(20)
    expect(screen.getByText(/kaydedildi/i)).toBeDefined()
  })

  it('kayit basarisiz olursa uyarir ve icerigi silmez', async () => {
    kur({ onKaydet: vi.fn().mockRejectedValue(new Error('ağ hatası')) })
    await yaz(alan(), 'onemli not')
    await ilerle(20)
    expect(screen.getByText(/kaydedilemedi/i)).toBeDefined()
    expect(alan().value).toContain('onemli not')
  })

  it('sablon secilince basliklar bos editore eklenir', () => {
    kur()
    sablonSec('soap')
    expect(alan().value).toContain('Öznel')
    expect(alan().value).toContain('Plan')
  })

  it('dolu editorde sablon degisimi mevcut metni ezmez', () => {
    kur({ baslangicIcerik: 'yazilmis onemli not' })
    sablonSec('soap')
    expect(alan().value).toContain('yazilmis onemli not')
  })
})

// "2 sn sonra kaydeder" testinin tek başına koruduğu şey yoktur: HER tuş
// vuruşunda kaydeden bir editör de onu geçer. Aynı biçimde "boşta kaydetmez"
// testini HİÇ kaydetmeyen bir editör de geçer. İki yön birlikte ölçülüyor.
describe('NotEditoru — otomatik kaydın iki yönü', () => {
  it('kullanici hicbir sey yazmadiysa acilan editor kayit ATMAZ', async () => {
    const props = kur({ baslangicIcerik: 'gecen haftadan kalan not', gecikmeMs: 20 })
    // Gecikmenin çok katı ilerletilir: "henüz zamanı gelmedi" ile "hiç
    // kaydetmiyor" burada karışmasın.
    await ilerle(10_000)
    expect(props.onKaydet).not.toHaveBeenCalled()
    // Aynı editör yazınca kaydediyor — yukarıdaki sessizlik "hiç kaydetmeyen
    // editör" yüzünden değil.
    await yaz(alan(), ' ek')
    await ilerle(20)
    expect(props.onKaydet).toHaveBeenCalledTimes(1)
    expect(props.onKaydet).toHaveBeenCalledWith({
      sablon: 'dap',
      icerik: 'gecen haftadan kalan not ek',
    })
  })

  it('yazma durunca tam bir kez kaydeder, gecikme dolmadan kaydetmez', async () => {
    const props = kur({ gecikmeMs: 80 })
    // Tuşlar arası 79 ms: gecikmenin HEMEN altı. Her tuş zamanlayıcıyı
    // sıfırlamasaydı (ör. yalnızca ilk tuşta kurulsaydı) burada kayıt olurdu.
    await yaz(alan(), 'uzunca bir cumle', 79)
    // Yazma bitti ve son tuştan beri 79 ms geçti: gecikme dolmadı.
    expect(props.onKaydet).not.toHaveBeenCalled()
    await ilerle(1)
    expect(props.onKaydet).toHaveBeenCalledTimes(1)
    expect(props.onKaydet).toHaveBeenCalledWith({ sablon: 'dap', icerik: 'uzunca bir cumle' })
    // Kayıt tek: başka bekleyen zamanlayıcı yok.
    await ilerle(10_000)
    expect(props.onKaydet).toHaveBeenCalledTimes(1)
  })
})

// Kayıt kararı `imza()` ile veriliyor ve `imza()` BİLEREK şablonu da içeriyor.
// Gerekçesi fonksiyonun üstünde yazılıydı ama YAZILI GEREKÇE BİR KORUMA
// DEĞİLDİR: `imza`'yı yalnızca içeriğe indirgemek (`[kayit.icerik]`) tüm
// seans testlerini yeşil bırakıyordu. Zarar somut: terapist dolu bir notta
// DAP→SOAP seçer, içerik değişmez, imza aynı kalır, efekt hemen döner —
// taslak yazılmaz, zamanlayıcı kurulmaz, gösterge boş kalır. Ekranda SOAP,
// veritabanında `dap`; bir sonraki açılışta seçim sessizce geri döner.
describe('NotEditoru — sablon-yalniz degisim', () => {
  it('dolu notta yalnizca sablon degisimi de kaydedilir', async () => {
    const props = kur({ baslangicIcerik: 'gecen haftadan kalan not', gecikmeMs: 20 })

    // TEK eylem şablon seçimi: tuşa basılmıyor, içerik hiç değişmiyor.
    sablonSec('soap')

    await ilerle(20)
    expect(props.onKaydet).toHaveBeenCalledTimes(1)
    expect(props.onKaydet).toHaveBeenCalledWith({
      sablon: 'soap',
      icerik: 'gecen haftadan kalan not',
    })
    // Gösterge de sessiz kalmamalı: kullanıcı bir şeyin olduğunu görmeli.
    expect(screen.getByText(/kaydedildi/i)).toBeDefined()
  })

  it('sablon-yalniz degisim 401 aninda da taslakta korunur ve geri yuklendigi SOYLENIR', async () => {
    // Kesişim testi: şablon-yalnız değişim × 401. `baslangicDurumu`'ndaki
    // `farkli` karşılaştırması da şablonu içerir; yalnızca içeriğe
    // bakılsaydı (`taslak.icerik !== sunucuIcerik`) kurtarılan şablon
    // "kurtarılacak bir şey yok" sayılıp depodan DÜŞÜRÜLÜR, kullanıcıya
    // hiçbir şey söylenmez ve seçim sessizce eski hâline dönerdi.
    const kilitli = vi.fn().mockRejectedValue(new YetkisizHata('Oturum kilitli.'))
    const ortak = {
      baslangicIcerik: 'gecen haftadan kalan not',
      baslangicSablon: 'dap',
      gecikmeMs: 20,
      taslakAnahtari: 'not-77',
    }
    const { unmount } = render(<NotEditoru {...ortak} onKaydet={kilitli} />)

    sablonSec('soap')
    await ilerle(20)
    expect(kilitli).toHaveBeenCalled()
    unmount()
    // Kilit açılması zaman alır: bu arada unmount tahliyesinin 401 reddi
    // yerleşir ve taslak artık "canlı" (uçuşta) değildir — ancak o zaman bir
    // KİLİT kurtarmasıdır ve şerit gösterilir (bkz. `taslak.ts` "Canlı
    // taslak"). Sekme değişiminde aynı taslak uçuştayken şerit GÖSTERİLMEZ.
    await ilerle(0)

    // Kilit açıldı. Sunucu hâlâ ESKİ şablonu döndürüyor (kayıt olmamıştı).
    const acik = vi.fn().mockResolvedValue(undefined)
    render(<NotEditoru {...ortak} onKaydet={acik} />)

    expect((screen.getByLabelText('Şablon') as HTMLSelectElement).value).toBe('soap')
    expect(screen.getByText(/geri yüklendi/i)).toBeDefined()
    await ilerle(20)
    expect(acik).toHaveBeenCalledWith({
      sablon: 'soap',
      icerik: 'gecen haftadan kalan not',
    })
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

    await yaz(alan(), 'danisan bugun cok kaygiliydi')
    await ilerle(20)
    expect(kilitli).toHaveBeenCalled()
    // Kullanıcıya kaydedilemediği ve metnin korunduğu söyleniyor.
    expect(screen.getByText(/kaydedilemedi/i)).toBeDefined()

    // App'in yaptığı şey: görsel perde değil, gerçek unmount.
    unmount()
    // Kilit açılması zaman alır: bu arada unmount tahliyesinin 401 reddi
    // yerleşir ve taslak artık "canlı" (uçuşta) değildir — ancak o zaman bir
    // KİLİT kurtarmasıdır ve şerit gösterilir (bkz. `taslak.ts` "Canlı
    // taslak"). Sekme değişiminde aynı taslak uçuştayken şerit GÖSTERİLMEZ.
    await ilerle(0)

    // Kilit açıldı; AnaEkran yeniden mount edildi. Sunucudan gelen içerik
    // ESKİ hâl (yazılan metin hiç kaydedilemedi).
    const acik = vi.fn().mockResolvedValue(undefined)
    editorCiz(acik)

    expect(alan().value).toContain('danisan bugun cok kaygiliydi')
    expect(screen.getByText(/geri yüklendi/i)).toBeDefined()
    // Kullanıcı kaldığı yerden devam edebiliyor VE geri yüklenen metin
    // ekranda kalmakla yetinmiyor, ilk fırsatta sunucuya yazılıyor.
    await ilerle(20)
    expect(acik).toHaveBeenCalledWith(
      expect.objectContaining({ icerik: 'danisan bugun cok kaygiliydi' }),
    )
  })

  it('kayit basarili olduysa yeniden mount TEMIZ gelir (yanlis kurtarma uyarisi yok)', async () => {
    const kaydet = vi.fn().mockResolvedValue(undefined)
    const { unmount } = editorCiz(kaydet)

    await yaz(alan(), 'kaydedilmis metin')
    await ilerle(20)
    expect(screen.getByText(/kaydedildi/i)).toBeDefined()
    expect(taslakOku('not-42')).toBeUndefined()

    unmount()
    const ikinci = vi.fn().mockResolvedValue(undefined)
    // Sunucu artık kaydedilmiş metni döndürüyor.
    editorCiz(ikinci, { baslangicIcerik: 'kaydedilmis metin' })

    expect(screen.queryByText(/geri yüklendi/i)).toBeNull()
    await ilerle(10_000)
    expect(ikinci).not.toHaveBeenCalled()
  })

  it('taslak not kimligine baglidir: baska seansin editorune sizmaz', async () => {
    const kilitli = vi.fn().mockRejectedValue(new YetkisizHata('Oturum kilitli.'))
    const { unmount } = editorCiz(kilitli, { taslakAnahtari: 'not-42' })
    await yaz(alan(), 'ayse hanimin seansi')
    await ilerle(20)
    expect(kilitli).toHaveBeenCalled()
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

    await yaz(alan(), 'not metni')
    await ilerle(20)
    expect(screen.getByText(/kaydedilemedi/i)).toBeDefined()

    basarisiz = false
    fireEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }))
    // Zamanlayıcı BEKLENMİYOR: düğme kaydı hemen dener.
    await ilerle(0)
    expect(onKaydet).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/kaydedildi/i)).toBeDefined()
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
    // Gecikme uzun ve saat sahte: birinci seansın metni hiç kaydedilemeden
    // geçiş oluyor.
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

    await yaz(alan(), 'birinci seansin notu')

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

// Görev 9 için: bileşen içi `anahtar !== taslakAnahtari` sıfırlaması yoğun
// test ediliyor ve ÇALIŞIYOR — ama `key` yolundan KESİN OLARAK ZAYIF. Bu
// asimetri ölçülmeden bırakılırsa, `key`'i atlamak "zaten test edilmiş"
// görünür. İki yol EŞDEĞER DEĞİL: aşağıdaki test farkın kendisini pinliyor.
describe('NotEditoru — prop degisimi `key` yolunun yerini TUTMAZ', () => {
  const editor = (
    anahtar: string,
    kaydet: (k: { sablon: string; icerik: string }) => Promise<void>,
    anahtarli: boolean,
  ) => (
    <NotEditoru
      {...(anahtarli ? { key: anahtar } : {})}
      baslangicIcerik=""
      baslangicSablon="dap"
      onKaydet={kaydet}
      gecikmeMs={5000}
      taslakAnahtari={anahtar}
    />
  )

  it('prop degisimi giden seansin bekleyen metnini sunucuya YAZMAZ; key verilirse yazar', async () => {
    // A) `key` YOK: bileşen yeniden mount edilmez, unmount tahliyesi hiç
    //    çalışmaz. Metin kaybolmuyor (taslakta duruyor) ama sunucuya
    //    GİTMİYOR: kilit açılmadan kapatılan bir sekmede o metin gider.
    const propla = vi.fn().mockResolvedValue(undefined)
    const a = render(editor('not-a', propla, false))
    await yaz(alan(), 'a seansinin bekleyen metni')

    a.rerender(editor('not-b', propla, false))

    expect(propla).not.toHaveBeenCalled()
    expect(taslakOku('not-a')?.icerik).toBe('a seansinin bekleyen metni')
    a.unmount()

    // B) `key` VAR: geçiş gerçek bir unmount'tur, bekleyen metin
    //    zamanlayıcı beklenmeden sunucuya yazılır. Saat hiç ilerlemedi:
    //    yazma zamanlayıcıdan gelmiş OLAMAZ.
    taslaklariUnut()
    const keyle = vi.fn().mockResolvedValue(undefined)
    const b = render(editor('not-a', keyle, true))
    await yaz(alan(), 'a seansinin bekleyen metni')

    b.rerender(editor('not-b', keyle, true))

    expect(keyle).toHaveBeenCalledWith({
      sablon: 'dap',
      icerik: 'a seansinin bekleyen metni',
    })
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
    await yaz(alan(), 'yarim kalan cumle')
    expect(kaydet).not.toHaveBeenCalled()

    unmount()

    // Saat ilerlemedi: yazma zamanlayıcıdan değil, tahliyeden.
    expect(kaydet).toHaveBeenCalledWith({ sablon: 'dap', icerik: 'yarim kalan cumle' })
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
    // Tahliye yazmayı EŞZAMANLI başlatıyor (bir üstteki testin ölçtüğü yol);
    // saat yine de bol ilerletiliyor ki gecikmeli bir yol da görünsün.
    await ilerle(10_000)
    expect(kaydet).not.toHaveBeenCalled()
  })
})

// Kaydet düğmesi olmayan bir editörde kayıt durumu SADECE GÖRSEL olamaz:
// kullanıcı kaydın kendiliğinden olduğunu varsayarak yazmaya devam eder.
// Emsal `AnaEkran`'da: arşivleme sonucu `role="status"` ile duyuruluyor ve
// testi "önce YOK, sonra VAR" kalıbıyla çiviliyor. Aynı kalıp burada.
describe('NotEditoru — ekran okuyucuya duyurulanlar', () => {
  it('kayit durumu kibar canli bolgede duyurulur (once BOS, sonra DOLU)', async () => {
    kur({ gecikmeMs: 20 })

    // Bölge açılışta DOM'da ama BOŞ. (Sonradan eklenen canlı bölgeler
    // güvenilir biçimde duyurulmaz; bu yüzden kaldırılmıyor, boşalıyor.)
    expect(screen.getByRole('status').textContent).toBe('')

    await yaz(alan(), 'x')
    await ilerle(20)
    // İddia bölgenin KENDİSİ üzerinden: sayfanın başka bir yerindeki
    // "Kaydedildi" metni bunu tatmin edemesin.
    expect(screen.getByRole('status').textContent).toMatch(/kaydedildi/i)
  })

  it('kayit hatasi assertive olarak duyurulur ve kibar bolge susar', async () => {
    kur({ onKaydet: vi.fn().mockRejectedValue(new Error('ağ hatası')), gecikmeMs: 20 })

    // Önce YOK: `alert` gerçekten hataya bağlı, her kutuya serpilmiş değil.
    expect(screen.queryByRole('alert')).toBeNull()

    await yaz(alan(), 'onemli not')
    await ilerle(20)

    const uyari = screen.getByRole('alert')
    expect(uyari.textContent ?? '').toMatch(/kaydedilemedi/i)
    // Kurtarma yolu da duyurunun İÇİNDE: kullanıcı ne olduğunu duyduğunda
    // ne yapabileceğini de duyar.
    expect(within(uyari).getByRole('button', { name: 'Yeniden dene' })).toBeDefined()
    // Kibar bölge bilerek susuyor — aynı olay iki kez okunmasın.
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('401 hatasinda da duyuru yapilir ve metnin korundugu SOYLENIR', async () => {
    kur({
      onKaydet: vi.fn().mockRejectedValue(new YetkisizHata('Oturum zaman aşımına uğradı.')),
      gecikmeMs: 20,
    })
    await yaz(alan(), 'danisan bugun kaygiliydi')
    await ilerle(20)

    const uyari = screen.getByRole('alert')
    expect(uyari.textContent ?? '').toMatch(/oturum kilitlendi/i)
    expect(uyari.textContent ?? '').toMatch(/geri yüklenir/i)
  })

  it('geri yukleme seridi de canli bolgedir', async () => {
    const kilitli = vi.fn().mockRejectedValue(new YetkisizHata('Oturum kilitli.'))
    const ortak = { baslangicIcerik: '', baslangicSablon: 'dap', gecikmeMs: 20 }
    const { unmount } = render(
      <NotEditoru {...ortak} onKaydet={kilitli} taslakAnahtari="not-55" />,
    )
    await yaz(alan(), 'kaydedilemeyen metin')
    await ilerle(20)
    expect(kilitli).toHaveBeenCalled()
    unmount()
    // Kilit açılması zaman alır: bu arada unmount tahliyesinin 401 reddi
    // yerleşir ve taslak artık "canlı" (uçuşta) değildir — ancak o zaman bir
    // KİLİT kurtarmasıdır ve şerit gösterilir (bkz. `taslak.ts` "Canlı
    // taslak"). Sekme değişiminde aynı taslak uçuştayken şerit GÖSTERİLMEZ.
    await ilerle(0)

    render(
      <NotEditoru
        {...ortak}
        onKaydet={vi.fn().mockResolvedValue(undefined)}
        taslakAnahtari="not-55"
      />,
    )

    // İddia canlı bölgeler üzerinden: şerit `role="status"` taşımasaydı
    // kurtarma yalnızca GÖRSEL olurdu.
    const duyurular = screen
      .getAllByRole('status')
      .map((e) => e.textContent ?? '')
      .join(' ')
    expect(duyurular).toMatch(/geri yüklendi/i)
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

  it("mount'ta icerik SENTEZLENMEZ: baslangicSablon baslik EKLEMEZ", async () => {
    // Bilinçli karar, eksik özellik değil (bkz. `baslangicIcerik` doc'u).
    // Mount'ta başlık eklenseydi ekrandaki hâl açılışın ilk anında
    // sunucudakinden farklı olur, editör kullanıcı tek tuşa basmadan bir
    // kayıt (ve silinemez bir denetim satırı) atardı — yalnızca not
    // AÇILDIĞI için. Yeni not için başlıkları çağıran taraf geçirir.
    const props = kur({ baslangicIcerik: '', baslangicSablon: 'dap', gecikmeMs: 20 })
    expect(alan().value).toBe('')
    expect((screen.getByLabelText('Şablon') as HTMLSelectElement).value).toBe('dap')

    await ilerle(10_000)
    expect(props.onKaydet).not.toHaveBeenCalled()

    // Aynı başlıklar SEÇİM üzerinden geliyor: yol kapalı değil, yalnızca
    // mount'a bağlı değil.
    sablonSec('soap')
    expect(alan().value).toContain('Öznel')
  })

  it('ekrandaki icerik sunucudakine geri donunce taslak deposunda kalinti kalmaz', async () => {
    // Taslak deposu ŞİFRELENMEMİŞ düz metin sağlık verisi tutuyor. Kullanıcı
    // yazıp geri sildiğinde depoda ara hâl kalıyordu ve içerik
    // karşılaştırmalı temizlik onu asla düşürmezdi: kurtaracak bir şey
    // taşımayan kopya sayfa ömrü boyunca bellekte kalırdı.
    const props = kur({
      baslangicIcerik: 'gecen haftadan kalan not',
      gecikmeMs: 5000,
      taslakAnahtari: 'not-3',
    })

    await yaz(alan(), ' ek')
    expect(taslakOku('not-3')?.icerik).toBe('gecen haftadan kalan not ek')

    // Üç kez geri silme: her biri AYRI bir değişiklik (ara hâller depoya
    // yazılıyor).
    for (let i = 0; i < 3; i++) {
      fireEvent.change(alan(), { target: { value: alan().value.slice(0, -1) } })
    }
    expect(alan().value).toBe('gecen haftadan kalan not')
    expect(taslakOku('not-3')).toBeUndefined()
    // Hiçbir kayıt atılmadı: silinen tek şey fazlalık kopya.
    await ilerle(10_000)
    expect(props.onKaydet).not.toHaveBeenCalled()
  })

  it('not icerigi konsola yazilmaz', async () => {
    const casuslar = (['log', 'info', 'warn', 'error', 'debug'] as const).map((ad) =>
      vi.spyOn(console, ad).mockImplementation(() => {}),
    )
    kur({ onKaydet: vi.fn().mockRejectedValue(new Error('ağ hatası')) })

    await yaz(alan(), 'GIZLI-ICERIK-ABC')
    await ilerle(20)
    expect(screen.getByText(/kaydedilemedi/i)).toBeDefined()

    for (const casus of casuslar) {
      for (const cagri of casus.mock.calls) {
        expect(JSON.stringify(cagri)).not.toContain('GIZLI-ICERIK-ABC')
      }
    }
  })
})

// Görev 9: aynı editör iki not türü için kullanılıyor. Özel notun şablonu
// YOKTUR (sunucudaki `OzelNot`'ta alan yok, `PUT .../ozel-not` gövdesi
// yalnızca `icerik`). İki yön de ölçülüyor: seçici varsayılan olarak VAR ve
// kapatılabildiğinde gerçekten YOK.
describe('NotEditoru — sablon secici ve etiket', () => {
  it('varsayilan olarak sablon secici VAR ve etiket "Seans notu"', () => {
    kur()
    expect(screen.getByLabelText('Şablon')).toBeDefined()
    expect(screen.getByLabelText('Seans notu')).toBeDefined()
  })

  it('sablonSecilebilir=false ile secici hic render edilmez', () => {
    kur({ sablonSecilebilir: false, etiket: 'Özel notum' })
    expect(screen.queryByLabelText('Şablon')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    // Etiket türü söylemeli: iki not ayrı tablolara yazılıyor ve ikincisi
    // danışana hiç gösterilmiyor.
    expect(screen.getByLabelText('Özel notum')).toBeDefined()
    expect(screen.queryByLabelText('Seans notu')).toBeNull()
  })

  it('secici yokken bos icerige sablon basliklari ENJEKTE EDILEMEZ', async () => {
    // `sablonDegis` boş editöre başlık ekliyor. Özel notta bu yol açık
    // kalsaydı DAP başlıkları özel notun içeriğine yazılırdı.
    const props = kur({
      sablonSecilebilir: false,
      etiket: 'Özel notum',
      baslangicSablon: 'dap',
      baslangicIcerik: '',
      gecikmeMs: 20,
    })
    expect((screen.getByLabelText('Özel notum') as HTMLTextAreaElement).value).toBe('')
    await ilerle(10_000)
    expect(props.onKaydet).not.toHaveBeenCalled()
    expect(screen.queryByText('Veri:')).toBeNull()
  })

  it('secici yokken de otomatik kayit CALISIR', async () => {
    // Tek yönlü kapsam kaçağı: yalnızca "seçici yok" iddiaları yazılsaydı,
    // hiçbir şey render etmeyen bir editör de üsttekileri geçerdi.
    const props = kur({ sablonSecilebilir: false, etiket: 'Özel notum', gecikmeMs: 20 })
    await yaz(screen.getByLabelText('Özel notum') as HTMLTextAreaElement, 'ozel metin')
    await ilerle(20)
    expect(props.onKaydet).toHaveBeenCalledTimes(1)
    expect(props.onKaydet).toHaveBeenCalledWith({ sablon: 'dap', icerik: 'ozel metin' })
  })
})

// Son inceleme C1 — ters yarış. Aynı resmî nota iki editör bakıyor (takvim ve
// danışan dosyası) ve biri giderken diğeri geliyor. Uçtan uca hâli
// `AnaEkran.yayilim.test.tsx` > "ters yarış A/B/C"de; burada editörün kendi
// kuralları, prop değişimiyle (`rerender`) — üretimdeki geçiş bu (4. biçim).
describe('NotEditoru — sunucuHali: editör monte olduktan sonra başka yoldan gelen kayıt', () => {
  const temel = {
    baslangicIcerik: 'ESKI',
    baslangicSablon: 'serbest',
    gecikmeMs: 20,
    taslakAnahtari: 'not-7',
  }

  it('TEMİZ editör yeni sunucu hâlini benimser ve onu GERİ YAZMAZ', async () => {
    const onKaydet = vi.fn().mockResolvedValue(undefined)
    const r = render(
      <NotEditoru {...temel} onKaydet={onKaydet} sunucuHali={{ sablon: 'serbest', icerik: 'ESKI' }} />,
    )
    r.rerender(
      <NotEditoru {...temel} onKaydet={onKaydet} sunucuHali={{ sablon: 'serbest', icerik: 'ESKI YENI' }} />,
    )
    await ilerle(0)
    expect(alan().value).toBe('ESKI YENI')
    await ilerle(100)
    expect(onKaydet).not.toHaveBeenCalled()
  })

  it('KİRLİ editör (kullanıcı yazmış) DOKUNULMAZ: yazılan metin kazanır', async () => {
    const onKaydet = vi.fn().mockResolvedValue(undefined)
    const r = render(
      <NotEditoru {...temel} onKaydet={onKaydet} sunucuHali={{ sablon: 'serbest', icerik: 'ESKI' }} />,
    )
    fireEvent.change(alan(), { target: { value: 'ESKI benim' } })
    r.rerender(
      <NotEditoru {...temel} onKaydet={onKaydet} sunucuHali={{ sablon: 'serbest', icerik: 'ESKI YENI' }} />,
    )
    await ilerle(0)
    expect(alan().value).toBe('ESKI benim')
    await ilerle(20)
    expect(onKaydet).toHaveBeenCalledWith({ sablon: 'serbest', icerik: 'ESKI benim' })
  })

  it('öbür editörün taslağıyla açılır (şeritsiz); o metin sunucudan dönünce İKİNCİ kez yazılmaz', async () => {
    // Aynı anahtarlı ilk editör hâlâ monte ve metni taslakta (sekme değişimi:
    // yeni editör AYNI render'da kuruluyor, eskinin tahliyesi sonra).
    const onKaydet = vi.fn().mockResolvedValue(undefined)
    const ilk = render(<NotEditoru {...temel} onKaydet={onKaydet} />)
    fireEvent.change(alan(), { target: { value: 'ESKI T' } })
    const ikinci = render(
      <NotEditoru {...temel} onKaydet={onKaydet} sunucuHali={{ sablon: 'serbest', icerik: 'ESKI' }} />,
    )
    // Aynı anahtar = aynı `id`: etiket iki alanı ayırt edemez, alan kapsayıcıdan.
    const ikinciAlan = ikinci.container.querySelector('textarea') as HTMLTextAreaElement
    // Sunucudaki ESKİ metin DEĞİL, yoldaki metin.
    expect(ikinciAlan.value).toBe('ESKI T')
    // Kilit şeridi YOK: bu bir kilit kurtarması değil (taslak canlı).
    expect(within(ikinci.container).queryByText(/geri yüklendi/i)).toBeNull()
    ilk.unmount()
    ikinci.rerender(
      <NotEditoru {...temel} onKaydet={onKaydet} sunucuHali={{ sablon: 'serbest', icerik: 'ESKI T' }} />,
    )
    await ilerle(100)
    // Tek yazma: ilk editörün unmount tahliyesi. İkincinin zamanlayıcısı AYNI
    // metni tekrar göndermedi (her yazma silinemez bir denetim satırı).
    expect(onKaydet).toHaveBeenCalledTimes(1)
    expect(ikinciAlan.value).toBe('ESKI T')
  })

  it('EKSİ YÖN: sahibi ve uçuşu olmayan (kilitte kalmış) taslak ŞERİTLE geri yüklenir', async () => {
    // Canlılık işareti her taslağı sessizce geri yükleseydi, gerçek bir kilit
    // kurtarması da duyurulmadan yapılırdı (yedinci biçim: iki yön).
    const ilk = render(
      <NotEditoru {...temel} onKaydet={vi.fn().mockRejectedValue(new YetkisizHata('Oturum kilitli.'))} />,
    )
    fireEvent.change(alan(), { target: { value: 'ESKI kilitte' } })
    ilk.unmount()
    await ilerle(0)
    render(<NotEditoru {...temel} onKaydet={vi.fn().mockResolvedValue(undefined)} />)
    expect(alan().value).toBe('ESKI kilitte')
    expect(screen.getByText(/geri yüklendi/i)).toBeDefined()
  })
})

// Görev 2: biçim çubuğu, kısayollar, Yaz/Önizle anahtarı, şablon başlıkları.
// Tek kısıt: bunların HİÇBİRİ metni ayrı bir yoldan yazmaz — hepsi mevcut
// `onChange` yolundan (`icerikDegistir` → `setIcerik`) geçer; bu yüzden
// aşağıdaki testler biçim uyguladıktan SONRA otomatik kaydın ve 401
// korumasının hâlâ çalıştığını da ölçüyor (yalnızca metni değil).
describe('NotEditoru — bicim cubugu, kisayollar ve onizleme (Görev 2)', () => {
  it('secim varken Kalın düğmesine basınca metin isaretlenir VE otomatik kayıt bu metni gönderir', async () => {
    const props = kur({ gecikmeMs: 20, baslangicIcerik: 'cok kaygili' })
    const alanEl = alan()
    alanEl.setSelectionRange(0, 3)
    fireEvent.click(screen.getByRole('button', { name: 'Kalın (Ctrl+B)' }))
    expect(alanEl.value).toBe('**cok** kaygili')
    await ilerle(20)
    expect(props.onKaydet).toHaveBeenCalledTimes(1)
    expect(props.onKaydet).toHaveBeenCalledWith({ sablon: 'dap', icerik: '**cok** kaygili' })
  })

  it('Ctrl+B kalın uygular', () => {
    kur({ baslangicIcerik: 'yorgun' })
    const alanEl = alan()
    alanEl.setSelectionRange(0, 6)
    // `code` FİZİKSEL tuşu taşır (kısayol eşlemesi buna bakıyor), `key` de
    // ABD düzeninde gerçek bir tarayıcının üreteceği karakterle birlikte
    // veriliyor — test hem düzeni hem kodu yansıtsın diye.
    fireEvent.keyDown(alanEl, { key: 'b', code: 'KeyB', ctrlKey: true })
    expect(alanEl.value).toBe('**yorgun**')
  })

  it('Cmd+B (metaKey) de aynı sonucu verir — hedef platform macOS', () => {
    kur({ baslangicIcerik: 'yorgun' })
    const alanEl = alan()
    alanEl.setSelectionRange(0, 6)
    fireEvent.keyDown(alanEl, { key: 'b', code: 'KeyB', metaKey: true })
    expect(alanEl.value).toBe('**yorgun**')
  })

  // -------------------------------------------------------------------
  // İnceleme bulgusu CRITICAL-1: kullanıcı Türkçe Q klavye kullanıyor.
  // Türkçe Q'da fiziksel I tuşu Shift'siz `key === 'ı'` (U+0131, noktasız
  // i) üretir — eski `event.key === 'i'` eşlemesiyle Ctrl+I HİÇBİR
  // kombinasyonda çalışmıyordu. `code` klavye düzeninden bağımsız olduğu
  // için hem Türkçe hem ABD düzeninde aynı sonucu vermeli.
  // -------------------------------------------------------------------
  it('Ctrl+I Türkçe Q klavyede (fiziksel I tuşu, key "ı") italik uygular', () => {
    kur({ baslangicIcerik: 'yorgun' })
    const alanEl = alan()
    alanEl.setSelectionRange(0, 6)
    fireEvent.keyDown(alanEl, { key: 'ı', code: 'KeyI', ctrlKey: true })
    expect(alanEl.value).toBe('*yorgun*')
  })

  it('Cmd+I Türkçe Q klavyede de italik uygular', () => {
    kur({ baslangicIcerik: 'yorgun' })
    const alanEl = alan()
    alanEl.setSelectionRange(0, 6)
    fireEvent.keyDown(alanEl, { key: 'ı', code: 'KeyI', metaKey: true })
    expect(alanEl.value).toBe('*yorgun*')
  })

  it('Ctrl+I ABD düzeninde (key "i") de italik uygular', () => {
    kur({ baslangicIcerik: 'yorgun' })
    const alanEl = alan()
    alanEl.setSelectionRange(0, 6)
    fireEvent.keyDown(alanEl, { key: 'i', code: 'KeyI', ctrlKey: true })
    expect(alanEl.value).toBe('*yorgun*')
  })

  // -------------------------------------------------------------------
  // İnceleme bulgusu IMPORTANT-2: Shift+8 Türkçe Q'da `key === '('`, ABD
  // düzeninde `key === '*'` üretir — `event.key === '8'` hiçbir düzende
  // eşleşmiyordu, Ctrl+Shift+8 hiç çalışmıyordu.
  // -------------------------------------------------------------------
  it('Ctrl+Shift+8 Türkçe Q klavyede (key "(") madde listesi uygular', () => {
    kur({ baslangicIcerik: 'bir\niki' })
    const alanEl = alan()
    alanEl.setSelectionRange(0, 7)
    fireEvent.keyDown(alanEl, { key: '(', code: 'Digit8', ctrlKey: true, shiftKey: true })
    expect(alanEl.value).toBe('- bir\n- iki')
  })

  it('Ctrl+Shift+8 ABD düzeninde (key "*") de madde listesi uygular', () => {
    kur({ baslangicIcerik: 'bir\niki' })
    const alanEl = alan()
    alanEl.setSelectionRange(0, 7)
    fireEvent.keyDown(alanEl, { key: '*', code: 'Digit8', ctrlKey: true, shiftKey: true })
    expect(alanEl.value).toBe('- bir\n- iki')
  })

  it("Önizle'ye geçince <strong> görünür, textarea görünmez; Yaz'a dönünce textarea aynı metinle geri gelir", () => {
    kur({ baslangicIcerik: '**kalin** metin' })
    expect(screen.getByLabelText('Seans notu')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Önizle' }))
    expect(screen.queryByLabelText('Seans notu')).toBeNull()
    expect(screen.getByText('kalin').tagName).toBe('STRONG')

    fireEvent.click(screen.getByRole('button', { name: 'Yaz' }))
    expect(alan().value).toBe('**kalin** metin')
  })

  it('biçim uygulandıktan sonra 401 gelirse taslak KAYBOLMAZ, kilit açılınca geri yüklenir', async () => {
    const kilitli = vi.fn().mockRejectedValue(new YetkisizHata('Oturum kilitli.'))
    const { unmount } = render(
      <NotEditoru
        baslangicIcerik="onemli"
        baslangicSablon="dap"
        onKaydet={kilitli}
        gecikmeMs={20}
        taslakAnahtari="not-60"
      />,
    )
    const alanEl = alan()
    alanEl.setSelectionRange(0, 6)
    fireEvent.click(screen.getByRole('button', { name: 'Kalın (Ctrl+B)' }))
    expect(alanEl.value).toBe('**onemli**')

    await ilerle(20)
    expect(kilitli).toHaveBeenCalled()
    unmount()
    // Kilit açılması zaman alır: unmount tahliyesinin 401 reddi bu arada
    // yerleşir (bkz. üstteki "401 sirasinda yazilmamis icerik" bloğu).
    await ilerle(0)

    const acik = vi.fn().mockResolvedValue(undefined)
    render(
      <NotEditoru
        baslangicIcerik="onemli"
        baslangicSablon="dap"
        onKaydet={acik}
        gecikmeMs={20}
        taslakAnahtari="not-60"
      />,
    )
    expect(alan().value).toBe('**onemli**')
    expect(screen.getByText(/geri yüklendi/i)).toBeDefined()
    await ilerle(20)
    expect(acik).toHaveBeenCalledWith({ sablon: 'dap', icerik: '**onemli**' })
  })

  it('DAP şablonu seçilince boş editöre "## Veri" eklenir', () => {
    kur({ baslangicSablon: 'serbest' })
    sablonSec('dap')
    expect(alan().value).toContain('## Veri')
  })
})
