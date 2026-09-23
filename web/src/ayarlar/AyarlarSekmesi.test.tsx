/// <reference types="node" />
// `tsconfig.app.json`'ın `types` alanı yalnızca `vite/client`'ı listeliyor;
// `node:fs`/`node:path`/`process` bu yüzden aşağıdaki üçlü-slash referansı
// olmadan bilinmiyor. `@types/node` zaten bir devDependency (bkz.
// `package.json`) -- yeni paket eklenmiyor, yalnızca bu TEK dosyaya var
// olan tipler açılıyor.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useParolaFormu } from '../screens/anaEkranKancalari/useParolaFormu'
import { useYedekleme } from '../screens/anaEkranKancalari/useYedekleme'
import { AyarlarSekmesi } from './AyarlarSekmesi'

// =====================================================================
// YAPISAL TEST — panellerin ana ekrana geri sızmasını engeller
// =====================================================================

// `import.meta.url` KULLANILMIYOR: bu projede jsdom test ortamında modül
// üst seviyesinde `import.meta.url` `http://localhost:3000/...` gibi bir
// jsdom taban adresine çözülüyor (yalnızca bir `it()` gövdesi İÇİNDE
// çağrıldığında gerçek `file://` adresi geliyor — ölçülmüş, bkz. görev
// raporu). `process.cwd()` vitest'i çalıştıran `web/` dizinini GÜVENİLİR
// biçimde veriyor; test çalışma dizini burada zaten `web/`.
const SRC_KOKU = path.join(process.cwd(), 'src')

/**
 * Bu testin varlık sebebi ürün kararının kendisi: yedekleme ve parola
 * panelleri ana ekranı işgal ediyordu. Bir sonraki düzenlemede "küçük bir
 * yedek uyarısı" diye geri eklenmesi kolaydır; bu test onu derleme zamanında
 * değil ama test zamanında yakalar.
 *
 * Brief'teki özgün tasarım SABİT bir dosya listesi okuyordu (`AnaEkran.tsx`
 * ve henüz var olmayan `TakvimSekmesi.tsx`, `DanisanlarSekmesi.tsx`) — bu,
 * `docs/test-yesil-ama-korumuyor.md`'un 12. biçimi: yapısal iddianın dosya
 * kümesi, ihlalin gerçekleşebileceği kavşağı dışarıda bırakıyordu (ve iki
 * dosya henüz yazılmadığı için `readFileSync` doğrudan PATLARDI). Burada
 * dosya kümesi DİZİNDEN TÜRETİLİYOR: `web/src` altındaki her `.ts`/`.tsx`
 * taranıyor, yarın eklenecek bir dosya hiçbir şey yapılmadan kapsanıyor.
 */
const YASAK = [
  'Yedekten geri yükle',
  'Şimdi yedek al',
  'Parolayı değiştir',
  'Yedek klasörünü değiştir',
]

/**
 * Taramanın DIŞINDA tutulan tek şey `ayarlar/**` (panellerin meşru evi) ve
 * aşağıdaki üç "kapı ekranı". İkincisi "ilgisiz göründükleri" için değil —
 * bu tam olarak 12. biçimin düştüğü tuzak — MİMARİ OLARAK bu regresyonun
 * oralarda GERÇEKLEŞEMEMESİ yüzünden dışarıda: `App.tsx` bu üçünü
 * `AnaEkran`'IN YERİNE, birbirini dışlayan dallarda render ediyor (bkz.
 * `App.tsx`) — `AnaEkran` hiçbir zaman bunları içermez, bunlar hiçbir zaman
 * `AnaEkran`'ı içermez. Üçü de tasarım §8'in istediği kendi meşru geri
 * yükleme düğmesine/başlığına sahip (bozuk anahtar, ilk kurulum, elle geri
 * yükleme ekranının kendi başlığı).
 *
 * Mutasyonla sınandı (bkz. görev raporu) — ama üçü AYNI GEREKÇEYLE kırmızı
 * dönmüyor, bu yüzden hepsini tek cümlede eşitlemek yanlış olurdu:
 * `KeystoreBozukEkrani.tsx` ve `KurulumSihirbazi.tsx`'teki düğme metni
 * "Yedekten geri yükle" ile KELİMESİ KELİMESİNE aynı — küme boşaltılınca bu
 * ikisi gerçekten KIRMIZI döner, kelime-sınırı savunması onları kurtarmaz.
 * `GeriYuklemeEkrani.tsx`'in başlığı ise "Yedekten geri yükleme" (fazladan
 * "me" eki) — küme boşaltılsa bile kelime-sınırı lookahead'i (ardından gelen
 * "m" harfi) bunu zaten eler; burada kalması bir GÜVENLİK MARJI (başlık
 * yarın "Yedekten geri yükle"ye kısaltılırsa yine dışarıda kalsın diye),
 * bugünkü davranış için zorunlu değil.
 */
const KAPI_EKRANLARI = new Set([
  'screens/GeriYuklemeEkrani.tsx',
  'screens/KeystoreBozukEkrani.tsx',
  'screens/KurulumSihirbazi.tsx',
])

function tsDosyalariniTara(dizin: string): string[] {
  const sonuc: string[] = []
  for (const isim of readdirSync(dizin)) {
    const tamYol = path.join(dizin, isim)
    const goreliYol = path.relative(SRC_KOKU, tamYol).replace(/\\/g, '/')
    if (goreliYol === 'ayarlar' || goreliYol.startsWith('ayarlar/')) continue
    if (statSync(tamYol).isDirectory()) {
      sonuc.push(...tsDosyalariniTara(tamYol))
      continue
    }
    if (!/\.(ts|tsx)$/.test(isim)) continue
    if (/\.test\.(ts|tsx)$/.test(isim)) continue
    if (KAPI_EKRANLARI.has(goreliYol)) continue
    sonuc.push(tamYol)
  }
  return sonuc
}

/**
 * Düz alt-dizi arama Türkçe fiil çekimlerini de yakalardı: "Parolayı
 * değiştirir." (bkz. `api.ts`, `useParolaFormu.ts` doc yorumları)
 * "Parolayı değiştir" alt-dizisini İÇERİR ("değiştir" kökü + "ir" eki).
 * Ardından bir HARF gelmiyorsa (noktalama, tırnak, satır sonu) bu UI
 * metninin kendisidir; harf geliyorsa bir çekim ekidir ve yoksayılır.
 *
 * Karşılaştırma BÜYÜK/KÜÇÜK HARFE DUYARSIZ (inceleme bulgusu — Görev 2
 * düzeltmesi): `regex`'e yalnızca `i` bayrağı eklemek YETERSİZ olurdu,
 * çünkü JavaScript'in bayrak-bazlı büyük/küçük harf katlaması İngilizce
 * kuralını kullanıyor ('İ' -> 'i' + BİRLEŞEN NOKTA (U+0307) iki kod noktası,
 * 'I' -> 'i'). Bunun yerine hem kaynağı hem YASAK metni
 * `toLocaleLowerCase('tr')` ile TÜRKÇE kurala göre küçültüyoruz ('İ' -> 'i',
 * 'I' -> 'ı', tek kod noktası) ve regex'i küçültülmüş dizeye karşı
 * çalıştırıyoruz. Kaynak zaten tamamen küçük harfe indiği için harf sınırı
 * sınıfı da yalnızca küçük harfleri listeliyor.
 */
function yasakMetinGeciyorMu(kaynak: string, metin: string): boolean {
  const kaynakKucuk = kaynak.toLocaleLowerCase('tr')
  const metinKucuk = metin.toLocaleLowerCase('tr')
  const kacisli = metinKucuk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${kacisli}(?![a-zçğıöşü])`, 'u').test(kaynakKucuk)
}

describe('yönetim panelleri yalnızca Ayarlar sekmesinde', () => {
  const taranan = tsDosyalariniTara(SRC_KOKU)

  /**
   * Asgari sayı koruması. Glob bir gün boşa düşerse (yanlış kök yolu,
   * yanlış uzantı deseni, `readdirSync` sessizce boş dizi döndüren bir
   * ortam farkı) bu test SIFIR dosya tarar ve altındaki `for` döngüsü hiç
   * `it()` üretmeden koşusuz YEŞİL kalır — koruma hiç yokmuş gibi (bkz.
   * `docs/test-yesil-ama-korumuyor.md` #3, ortama bağlı etkisizleşen test).
   * Eşik bugünkü taranan dosya sayısının (33 — toplam 36 testin geri kalanı
   * bu asgari koruma testi ve 2 davranış testi) belirgin altında ama
   * "boş tarama" ile "gerçek tarama"yı kesin ayıracak kadar yüksek.
   */
  it('taranan dosya sayısı asgari korumayı karşılar', () => {
    expect(taranan.length).toBeGreaterThan(20)
  })

  for (const dosya of taranan) {
    const goreli = path.relative(SRC_KOKU, dosya).replace(/\\/g, '/')
    it(`${goreli} yönetim metni taşımaz`, () => {
      const kaynak = readFileSync(dosya, 'utf8')
      for (const metin of YASAK) {
        expect(yasakMetinGeciyorMu(kaynak, metin)).toBe(false)
      }
    })
  }
})

// =====================================================================
// DAVRANIŞ TESTLERİ — AnaEkran.test.tsx'ten taşındı, yeniden yazılmadı
// =====================================================================
//
// Kancalar (`useYedekleme`, `useParolaFormu`) `AyarlarSekmesi`'nin kendisi
// TARAFINDAN çağrılmıyor (bkz. bileşenin modül başlığı) — `AnaEkran` onları
// çağırıp prop olarak geçiriyor. Aşağıdaki `Kabuk`, `AnaEkran`'ın yaptığının
// bu iki kancayla sınırlı küçük bir kopyası: gerçek kancalar burada da
// gerçekten çağrılıyor ki taşınan testler gerçek async akışı (fetch, zamanlayıcı)
// ölçmeye devam etsin, sahte prop'larla "elbette geçer" bir teste dönüşmesin.

function jsonYanit(govde: unknown): Response {
  return { ok: true, json: async () => govde } as unknown as Response
}

function hataYaniti(kod: number, mesaj: string): Response {
  return { ok: false, status: kod, json: async () => ({ hata: mesaj }) } as unknown as Response
}

// `useDenetimKayitlari` BİLEREK burada çağrılmıyor: bu kabuk yalnızca
// yedekleme/parola akışlarının GERÇEK async davranışını ölçmek için var
// (bkz. üstteki açıklama) ve aşağıdaki `fetch` sahtesi yalnızca
// `/api/yedek(ler)` yollarını biliyor -- gerçek kanca çağrılsaydı
// `/api/denetim-kayitlari` isteği "beklenmeyen istek" hatasıyla patlardı.
// Denetim akışının kendi davranışı (gerçek veriyle satır render edilmesi,
// istek zamanlaması, süzgeç/sayfalama) BU DOSYADA DEĞİL --
// `web/src/screens/AnaEkran.test.tsx`teki `describe('AnaEkran — denetim
// kaydı (Görev 7)', ...)` bloğunda, gerçek `AnaEkran` + gerçek
// `useDenetimKayitlari` + `/api/denetim-kayitlari`i bilen kendi sahte
// `fetch`iyle test ediliyor (Görev 7 incelemesi IMPORTANT-1/2: burada
// önceden böyle bir blok OLMADIĞI hâlde var olduğu iddia ediliyordu).
function sabitDenetim() {
  return {
    kayitlar: [],
    sayfa: 0,
    sonrakiSayfaVar: false,
    baslangic: '',
    setBaslangic: () => {},
    bitis: '',
    setBitis: () => {},
    varlik: '',
    setVarlik: () => {},
    yukleniyor: false,
    hata: null,
    suzgecUygula: () => {},
    sonrakiSayfa: () => {},
    oncekiSayfa: () => {},
  }
}

function Kabuk() {
  const yedekleme = useYedekleme()
  const parola = useParolaFormu()
  return (
    <AyarlarSekmesi
      yedekleme={yedekleme}
      parola={parola}
      saklama={{ dolanlar: [], onAc: () => {} }}
      depolama={null}
      onGeriYukle={() => {}}
      denetim={sabitDenetim()}
    />
  )
}

describe('AyarlarSekmesi — davranış (AnaEkran.test.tsx içinden taşındı)', () => {
  const gercekFetch = globalThis.fetch
  const BUGUN = '2026-09-09'
  let yedekIstekleri: { damga: string; hedef_dizin?: string }[]
  let sunucuYedekDizini: string | undefined
  let sunucuYedekleri: { dosya_adi: string; tarih: string; boyut: number }[]
  let yedekListeHatasi: string | null
  let temizlikIstekleri: string[]
  let temizlikTasinan: number
  let temizlikHatasi: string | null

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 2026-09-09 Çarşamba, YEREL saat 12:00 — `yerelGun` ile aynı biçimde.
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))
    yedekIstekleri = []
    sunucuYedekDizini = undefined
    sunucuYedekleri = []
    yedekListeHatasi = null
    temizlikIstekleri = []
    temizlikTasinan = 2
    temizlikHatasi = null

    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      if (yol.startsWith('/api/onceki-dosyalari-kaldir')) {
        temizlikIstekleri.push(
          (JSON.parse((secenekler?.body as string) ?? '{}') as { damga: string }).damga,
        )
        if (temizlikHatasi) return hataYaniti(500, temizlikHatasi)
        return jsonYanit({ tasinan: temizlikTasinan })
      }
      // `/api/yedekler` ÖNCE: `/api/yedek` onun öneki.
      if (yol.startsWith('/api/yedekler')) {
        if (yedekListeHatasi) return hataYaniti(400, yedekListeHatasi)
        return jsonYanit({ hedef_dizin: sunucuYedekDizini, yedekler: sunucuYedekleri })
      }
      if (yol.startsWith('/api/yedek')) {
        const govde = JSON.parse((secenekler?.body as string) ?? '{}') as {
          damga: string
          hedef_dizin?: string
        }
        yedekIstekleri.push(govde)
        if (govde.hedef_dizin) {
          sunucuYedekDizini = govde.hedef_dizin
          yedekListeHatasi = null
        }
        sunucuYedekleri = [
          { dosya_adi: `yedek-${govde.damga}.db`, tarih: govde.damga, boyut: 4096 },
          ...sunucuYedekleri.filter((y) => y.tarih !== govde.damga),
        ]
        return jsonYanit({ tarih: govde.damga, boyut: 4096 })
      }
      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
  })

  it('klasor secilmemisse uyari cikar; klasor secilince yedek HEMEN alinir', async () => {
    // "Yedek klasörü boşken 'Şimdi yedek al' düğmesinin klasör isteme
    // akışını başlattığı" davranışı — klasör boşken açılışta OTOMATİK yedek
    // denemesi sunucudan 400 alır ve bu KALICI uyarıya dönüşür; kullanıcı
    // oradan klasör formunu açıp kaydedince yedek HEMEN alınır.
    yedekListeHatasi = 'Yedek klasörü belli değil. Yedeklerinizin bulunduğu klasörün yolunu yazın.'
    render(<Kabuk />)

    expect((await screen.findByRole('alert')).textContent).toMatch(/klasörü belli değil/i)
    // Klasör seçilmeden hiçbir yedek DENENMEZ: sunucu zaten reddederdi ve
    // her deneme boşa bir istek olurdu.
    expect(yedekIstekleri).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'Yedek klasörünü değiştir' }))
    await userEvent.type(
      screen.getByLabelText(/yedeklerin yazılacağı klasörün yolu/i),
      '/Volumes/USB/yedek',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve yedek al' }))

    // Klasörü seçmek ile ilk yedeği almak TEK işlem: ayrı bir "ayarla"
    // adımı olsaydı kullanıcı "yedeğim var" sanıp yedeksiz kalırdı.
    await waitFor(() => expect(yedekIstekleri.length).toBe(1))
    expect(yedekIstekleri[0]).toEqual({ damga: BUGUN, hedef_dizin: '/Volumes/USB/yedek' })

    // Uyarı kalkıyor ve yeni klasör ekranda.
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('region', { name: 'Yedekleme' }).textContent).toContain(
      '/Volumes/USB/yedek',
    )
  })

  it('eski dosyalari kenara kaldirma: damga yerel SAATI tasir ve sonuc gosterilir', async () => {
    // Inceleme IMPORTANT-A: geri yukleme `.onceki` kalintisina takildiginda
    // kullanicinin uygulama ICINDEKI cikis yolu bu dugme. Alternatifi
    // macOS'ta GIZLI olan `~/Library` altinda elle dosya tasimak -- ve
    // oradaki ilk refleks silmek.
    sunucuYedekleri = [{ dosya_adi: `yedek-${BUGUN}.db`, tarih: BUGUN, boyut: 4096 }]
    render(<Kabuk />)
    const bolum = await screen.findByRole('region', { name: 'Yedekleme' })

    // Dugme metni ne YAPMADIGINI da soyluyor: kullaniciya "sil" fiili
    // hicbir yerde gosterilmiyor (inceleme IMPORTANT-B ile ayni gerekce).
    const dugme = within(bolum).getByRole('button', { name: /kenara kaldır/i })
    expect(dugme.textContent).toMatch(/silmez/i)

    await userEvent.click(dugme)

    // Damga YEREL saatten turetilir (duvar saati sozlesmesi): sabit saat
    // 2026-09-09 12:00 -> `20260909-1200`. UTC'den turetilseydi Istanbul'da
    // gece yarisindan sonra bir gun geriye yazardi -- ve kullanici bu adi
    // dosya listesinde okuyor.
    await waitFor(() => expect(temizlikIstekleri).toEqual(['20260909-1200']))

    // Sonuc KENDI alaninda: `uyari` "verileriniz yedeklenmiyor" KALICI
    // uyarisidir ve iki ayri sorunu tek kutuda birlestirmek yanlis olurdu.
    const bilgi = await within(bolum).findByRole('status')
    expect(bilgi.textContent).toMatch(/2 eski dosya/)
    expect(bilgi.textContent).toMatch(/hiçbiri silinmedi/i)
    expect(within(bolum).queryByRole('alert')).toBeNull()
  })

  it('kenara kaldirma basarisiz olursa sunucunun mesaji OLDUGU GIBI gosterilir', async () => {
    // "Dosyalar tasinamadi" ile "gecersiz zaman damgasi" ayri sorunlar;
    // genel bir mesaj kullanicinin hangisini duzeltecegini gizlerdi
    // (`al`'daki kararla ayni).
    sunucuYedekleri = [{ dosya_adi: `yedek-${BUGUN}.db`, tarih: BUGUN, boyut: 4096 }]
    temizlikHatasi = 'Eski dosyalar taşınamadı: HİÇBİR DOSYA SİLİNMEDİ, verileriniz duruyor.'
    render(<Kabuk />)
    const bolum = await screen.findByRole('region', { name: 'Yedekleme' })

    await userEvent.click(within(bolum).getByRole('button', { name: /kenara kaldır/i }))

    const bilgi = await within(bolum).findByRole('status')
    expect(bilgi.textContent).toBe(temizlikHatasi)
  })

  it('form kapaninca girilen parolalar STATE ten silinir', async () => {
    // Gizlenmiş ama duran bir parola alanı, katman bir sonraki açılışta dolu
    // gelirdi (`HizliArama`'nın "kapanınca sonuçlar silinir" kararıyla aynı
    // ilke).
    sunucuYedekleri = [{ dosya_adi: `yedek-${BUGUN}.db`, tarih: BUGUN, boyut: 4096 }]
    render(<Kabuk />)
    const bolum = await screen.findByRole('region', { name: 'Parola' })

    await userEvent.click(within(bolum).getByRole('button', { name: 'Parolayı değiştir' }))
    await userEvent.type(screen.getByLabelText('Mevcut parolanız'), 'gizli-parola-123')
    await userEvent.type(screen.getByLabelText('Yeni parola'), 'yepyeni-parola')
    await userEvent.type(screen.getByLabelText('Yeni parola (tekrar)'), 'yepyeni-parola')
    expect((screen.getByLabelText('Mevcut parolanız') as HTMLInputElement).value).toBe(
      'gizli-parola-123',
    )

    await userEvent.click(within(bolum).getByRole('button', { name: 'Vazgeç' }))
    await userEvent.click(within(bolum).getByRole('button', { name: 'Parolayı değiştir' }))

    expect((screen.getByLabelText('Mevcut parolanız') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Yeni parola') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Yeni parola (tekrar)') as HTMLInputElement).value).toBe('')
  })
})
