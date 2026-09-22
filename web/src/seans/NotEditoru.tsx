import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { YetkisizHata } from '../api'
import { BicimCubugu } from '../not/BicimCubugu'
import { bicimUygula, type BicimTuru } from '../not/bicim'
import { NotGorunumu } from '../not/NotGorunumu'
import { SABLON_ADLARI, SABLON_KODLARI, sablonMetni } from './sablon'
import {
  taslakCanliMi,
  taslakDus,
  taslakEditoru,
  taslakOku,
  taslakTemizle,
  taslakUcusta,
  taslakYaz,
} from './taslak'

/**
 * Otomatik kayıtlı seans notu editörü.
 *
 * # Kaydet düğmesi yoktur
 *
 * Plan 3'ün bağlayıcı kısıtı. İncelenen ürünlerin en sık şikayeti not
 * kaybıydı ve bunun kaynağı neredeyse her zaman "kullanıcı kaydetmeden
 * kapattı"dır. Editör yazma durduktan `gecikmeMs` (varsayılan 2000 ms) sonra
 * kendiliğinden yazar; her tuş vuruşunda değil (denetim kaydı hacmi bir
 * tasarım kısıtıdır, bkz. `store::audit`).
 *
 * Tek düğme, kayıt BAŞARISIZ olduğunda beliren "Yeniden dene"dir. Bu bir
 * kaydet düğmesi değil, kurtarma yoludur: hata sonrası kullanıcı yazmayı
 * bırakmışsa (ki en olası davranış budur) yeni bir tuş vuruşu olmadan
 * yeniden denemenin başka yolu kalmaz.
 *
 * # 401 kararı: metin kaybolmaz, kilit açılınca kaldığı yerden devam eder
 *
 * Kaydetme sırasında oturum kilitlenirse (`YetkisizHata`) `api.ts` merkezi
 * dinleyicileri tetikler, `App` `AnaEkran`'ı gerçek anlamda unmount eder ve
 * bu bileşenin state'i onunla birlikte gider. Bu yüzden yazılan metin **her
 * değişiklikte** ağacın dışındaki taslak deposuna (`taslak.ts`) yazılır ve
 * yalnızca sunucu kaydı doğrulandığında oradan düşer. Kilit açılıp editör
 * yeniden mount edildiğinde taslak geri yüklenir, kullanıcıya geri
 * yüklendiği SÖYLENİR ve içerik ilk fırsatta sunucuya yazılır.
 *
 * Sessiz düşürme bu yüzden mümkün değil: metin ya sunucuda ya taslakta, ve
 * taslaktan gelen içerik kullanıcıya duyurulur.
 *
 * # Not içeriği hiçbir loga girmez
 *
 * Ne `console`'a, ne sunucu denetim kaydına. Bu dosyada içeriği yazdıran tek
 * yer `textarea`'nın kendisidir.
 */

type Kayit = { sablon: string; icerik: string }

type Props = {
  /**
   * Editörün açılış içeriği — OLDUĞU GİBİ gösterilir.
   *
   * Bu bileşen mount anında içerik SENTEZLEMEZ: `baslangicSablon` boş bir
   * nota başlıklarını EKLEMEZ. Ekleseydi, ekrandaki hâl açılışın ilk anında
   * sunucudakinden farklı olurdu ve editör kullanıcı tek tuşa basmadan bir
   * kayıt (ve silinemez bir denetim satırı) üretirdi — yalnızca not
   * AÇILDIĞI için. Şablon başlıkları iki yerde ekleniyor: boş editörde
   * kullanıcı şablonu SEÇTİĞİNDE (`sablonDegis`) ve yeni bir not için
   * çağıran taraf `sablonMetni(...)`'i buraya geçirdiğinde. İkincisi
   * bilerek çağıranın kararı: "yeni not" ile "geçen haftaki boş not"
   * ayrımını bilen taraf odur.
   */
  baslangicIcerik: string
  baslangicSablon: string
  onKaydet: (kayit: Kayit) => Promise<void>
  gecikmeMs?: number
  /**
   * Taslak deposundaki kimlik (`not-12`, `ozel-12`). Zorunludur ve seansa
   * özgüdür: ortak bir varsayılan olsaydı bir seansın kaydedilmemiş metni
   * başka bir seansın editörüne geri yüklenirdi.
   */
  taslakAnahtari: string
  /**
   * Metin alanının etiketi. Aynı editör iki farklı not türü için
   * kullanılıyor ve etiket türü söylemeli: "Seans notu" ile "Özel notum"
   * ayrı tablolara yazılır ve ikincisi danışana hiç gösterilmez. Sabit tek
   * bir etiket, kullanıcının hangi nota yazdığını ekrandan okuyamaması
   * demekti.
   */
  etiket?: string
  /**
   * Şablon seçici gösterilsin mi.
   *
   * Özel notun şablonu **yoktur**: sunucudaki `OzelNot` alanlarında `sablon`
   * yok ve `PUT .../ozel-not` gövdesi yalnızca `icerik` taşır. Seçici yine
   * de gösterilseydi iki somut zarar doğardı: (a) seçim hiçbir yere
   * yazılmadığı hâlde yazılmış gibi görünürdü, (b) boş bir özel notta
   * şablon seçmek `sablonDegis` üzerinden DAP başlıklarını özel notun
   * İÇERİĞİNE enjekte ederdi.
   */
  sablonSecilebilir?: boolean
  /**
   * Sunucuda olduğu bilinen EN SON hâl — editör monte olduktan SONRA başka
   * bir yoldan yazılmış olabilir (son inceleme C1, ters yarış).
   *
   * Takvim ile danışan dosyası aynı resmî nota iki ayrı editörle bakıyor ve
   * yalnızca biri aynı anda ekranda. Sekme değişirken giden editör bekleyen
   * metnini unmount'ta PUT ediyor; gelen editör o PUT BİTMEDEN, eski içerikle
   * monte olabiliyor. `baslangicIcerik` yalnızca mount'ta okunduğu için bu
   * editör eski metni göstermeye devam eder, terapist tek bir tuşa basınca da
   * otomatik kayıt eski metni PUT edip diğer ekranda yazılanı SİLERDİ.
   *
   * Kural: bu değer değişince (uçuşta kendi kaydı yokken)
   *   - ekrandaki metin ZATEN bu değerse (editör, uçuştaki bir tahliyenin
   *     taslağıyla açılmıştı — bkz. `taslak.ts::taslakUcusta`) yalnızca
   *     "kaydedildi" bilgisi güncellenir; bekleyen zamanlayıcı aynı metni
   *     ikinci kez yazmaz;
   *   - editör TEMİZSE (ekrandaki hâl sunucuda olduğu bilinen hâl) yeni hâli
   *     benimser;
   *   - editör KİRLİYSE (kullanıcı yazmış) DOKUNULMAZ — yazılan metin,
   *     sunucudan gelen bir değişiklik uğruna silinmez; kullanıcının kendi
   *     kaydı kazanır.
   * Kendi kaydının sonucu geri geldiğinde değer bilinen hâlle aynıdır ve
   * hiçbir şey olmaz.
   *
   * Verilmezse (özel not editörü, eski çağıranlar) davranış eskisiyle aynı.
   */
  sunucuHali?: Kayit
}

const VARSAYILAN_GECIKME_MS = 2000

// Kayıt kararı "içerik + şablon" ikilisi üzerinden verilir: yalnızca içeriğe
// bakılsaydı, dolu bir notta şablonu değiştirmek (metin aynı kalır) hiç
// kaydedilmezdi ve seçim ekranda görünüp veritabanında olmazdı.
function imza(kayit: Kayit): string {
  return JSON.stringify([kayit.sablon, kayit.icerik])
}

function saatBicimle(tarih: Date): string {
  const iki = (n: number) => String(n).padStart(2, '0')
  return `${iki(tarih.getHours())}:${iki(tarih.getMinutes())}`
}

/**
 * Eski ve yeni metin arasındaki DEĞİŞEN aralığı hesaplar: ortak önek ve
 * ortak sonek dışarıda bırakılır, geriye yalnızca farkın kapsadığı aralık
 * (eski metindeki `bas`/`son`) ve yerine geçecek parça kalır.
 *
 * `bicimUygula` her zaman metnin TAMAMINI döndürür (bkz. `not/bicim.ts`),
 * ama satır başı biçimlerde bile fiilen değişen kısım genelde küçük bir
 * aralıktır (ör. bir satırın başındaki önek). Bu fonksiyon o aralığı
 * bulur ki `execCommand('insertText', …)` yalnızca DEĞİŞEN kısmı, TEK bir
 * geri alma adımı olarak değiştirsin — bkz. `yerelDuzenlemeDene`.
 */
function degisenAralikHesapla(eski: string, yeni: string): { bas: number; son: number; parca: string } {
  const kisaUzunluk = Math.min(eski.length, yeni.length)
  let ortakOnek = 0
  while (ortakOnek < kisaUzunluk && eski[ortakOnek] === yeni[ortakOnek]) ortakOnek++

  const kalanUzunluk = kisaUzunluk - ortakOnek
  let ortakSonek = 0
  while (
    ortakSonek < kalanUzunluk &&
    eski[eski.length - 1 - ortakSonek] === yeni[yeni.length - 1 - ortakSonek]
  ) {
    ortakSonek++
  }

  return {
    bas: ortakOnek,
    son: eski.length - ortakSonek,
    parca: yeni.slice(ortakOnek, yeni.length - ortakSonek),
  }
}

/**
 * Biçimi tarayıcının KENDİ düzenleme komutuyla uygulamayı DENER —
 * mümkünse `setIcerik` ile TÜM metni programatik olarak DEĞİŞTİRMEZ.
 *
 * # Neden: yerli geri alma (Ctrl+Z) yığını (inceleme bulgusu IMPORTANT-3)
 *
 * Uygulama macOS'ta Tauri (WebKit) içinde çalışıyor. `bicimUygulaVeYaz`
 * önceki hâlinde `sonuc.metin`'i doğrudan React state'ine yazıyordu — bu,
 * textarea'nın `value`'sunu PROGRAMATİK olarak değiştirir ve
 * WebKit/Chromium'da tarayıcının YERLİ geri alma yığınını sıklıkla BOZAR:
 * terapist bir paragrafı kalın yaptıktan sonra Ctrl+Z'ye basınca kalın
 * geri alınmayabilir ya da yığın beklenmedik bir noktaya atlayabilir.
 *
 * `document.execCommand('insertText', false, parça)` bunun yerine SEÇİLİ
 * ARALIĞI tarayıcının kendi düzenleme komutuyla değiştirir: bu, yerli geri
 * alma yığınına TEK bir adım olarak girer VE gerçek bir `input` olayı
 * üretir. React bu olayı dinliyor (textarea'nın `onChange`'i), dolayısıyla
 * metin yine TEK giriş noktasından (`icerikDegistir` → `setIcerik`) geçer
 * — otomatik kayıt, taslak saklama ve 401 koruması hiçbir şey bilmeden
 * çalışmaya devam eder. Bu fonksiyon `icerikDegistir`'i KENDİSİ ÇAĞIRMAZ:
 * başarılıysa `input` olayı bunu zaten tetikleyecektir; burada tekrar
 * çağırmak state'i iki kez (ve muhtemelen çelişen değerlerle) güncellerdi.
 *
 * Yalnızca DEĞİŞEN aralık (`degisenAralikHesapla`) seçilip değiştirilir —
 * satır başı biçimlerde değişen aralık birden fazla satırı kapsayabilir,
 * `insertText` o aralığın TAMAMINA TEK ÇAĞRIDA uygulanmalı ki geri alma
 * yığınında tek adım olsun.
 *
 * # jsdom'da yok
 *
 * `document.execCommand` jsdom'da TANIMLI DEĞİL — `typeof` kontrolü bunu
 * yakalar ve çağıran taraf (`bicimUygulaVeYaz`) DÜŞÜŞ yoluna
 * (`icerikDegistir(sonuc.metin)`) geçer. Testler bu fonksiyonu bir
 * `vi.fn()` ile taklit ederek çağrı argümanlarını, ya da `false` döndürerek
 * düşüş yolunu doğrular. Gerçek geri alma davranışı yalnızca gerçek bir
 * tarayıcıda ELLE doğrulanabilir — bkz. görev raporu.
 */
function yerelDuzenlemeDene(alanEl: HTMLTextAreaElement, eskiMetin: string, yeniMetin: string): boolean {
  if (typeof document.execCommand !== 'function') return false

  const { bas, son, parca } = degisenAralikHesapla(eskiMetin, yeniMetin)
  alanEl.focus()
  alanEl.setSelectionRange(bas, son)
  try {
    return document.execCommand('insertText', false, parca) === true
  } catch {
    return false
  }
}

type Durum =
  | { tur: 'temiz' }
  | { tur: 'bekliyor' }
  | { tur: 'kaydediliyor' }
  | { tur: 'kaydedildi'; saat: string }
  | { tur: 'hata'; kilit: boolean }

export function NotEditoru({
  baslangicIcerik,
  baslangicSablon,
  onKaydet,
  gecikmeMs = VARSAYILAN_GECIKME_MS,
  taslakAnahtari,
  etiket = 'Seans notu',
  sablonSecilebilir = true,
  sunucuHali,
}: Props) {
  // Mount anında taslak deposuna bakılır: kilit (401) yüzünden unmount olmuş
  // bir editörün yazılmamış metni burada durur ve sunucudan gelen
  // `baslangicIcerik` o metni İÇERMEZ (kaydedilememişti).
  const [ilk] = useState(() => baslangicDurumu(taslakAnahtari, baslangicIcerik, baslangicSablon))
  const [icerik, setIcerik] = useState(ilk.icerik)
  const [sablon, setSablon] = useState(ilk.sablon)
  const [geriYuklendi, setGeriYuklendi] = useState(ilk.geriYuklendi)
  const [durum, setDurum] = useState<Durum>({ tur: 'temiz' })
  const [anahtar, setAnahtar] = useState(taslakAnahtari)

  // Yaz/Önizle anahtarı (bkz. modül altındaki "Biçim çubuğu ve önizleme"
  // bölümü). Bileşen state'i: görünüm seans/özel not editörüne özgü, iki ayrı
  // panel açıkken (resmî + özel) birbirini etkilememeli.
  const [gorunum, setGorunum] = useState<'yaz' | 'onizle'>('yaz')
  const alanRef = useRef<HTMLTextAreaElement>(null)
  // Programatik bir metin değişiminden (biçim çubuğu/kısayol) ya da Yaz'a
  // dönüşten sonra textarea'ya uygulanacak seçim. `useLayoutEffect` DOM
  // güncellendikten SONRA, ekran boyanmadan ÖNCE çalışır — `requestAnimationFrame`
  // yerine bu tercih edildi çünkü rAF bir boyama karesi kaybettirebilir
  // (kullanıcı seçimin bir an için kaybolduğunu görebilir).
  const bekleyenSecimRef = useRef<{ bas: number; son: number } | null>(null)
  // Önizle'ye geçmeden HEMEN önceki seçim: Yaz'a dönünce imleç konumu korunur.
  const sonSecimRef = useRef<{ bas: number; son: number } | null>(null)

  // Sunucuda olduğu BİLİNEN son hâl — ekrandaki hâl değil. Kayıt kararı buna
  // göre verilir. Taslak geri yüklendiyse ekrandaki içerik bundan farklıdır
  // ve aşağıdaki efekt onu kaydedilmesi gereken bir değişiklik olarak görüp
  // kilit açılır açılmaz sunucuya yazar; taslak yoksa ikisi eşittir ve
  // kullanıcı hiçbir şey yazmadan hiçbir istek atılmaz.
  const sonKaydedilen = useRef(imza({ sablon: baslangicSablon, icerik: baslangicIcerik }))

  // Uçuşta olan kaydın imzası. Zamanlayıcı ateşlendikten sonra bileşen
  // kaldırılırsa aşağıdaki unmount temizliği aynı içeriği İKİNCİ kez
  // göndermesin diye tutuluyor (her yazma silinemez bir denetim satırı
  // maliyeti taşır).
  const ucustaki = useRef<string | null>(null)

  // Seçim değişince (`taslakAnahtari` başka bir seansı gösterince) bileşen
  // yeniden mount EDİLMEYEBİLİR — çağıran taraf `key` vermeyi unutabilir.
  // O durumda bir seansın metni diğerinin editöründe kalır ve oraya
  // kaydedilirdi. Render sırasında state'i sıfırlamak React'in bu iş için
  // önerdiği desen; testleri "her zaman temiz mount" yapan bir bileşen
  // testinin göremeyeceği tek regresyon sınıfı da budur.
  if (anahtar !== taslakAnahtari) {
    const yeni = baslangicDurumu(taslakAnahtari, baslangicIcerik, baslangicSablon)
    setAnahtar(taslakAnahtari)
    setIcerik(yeni.icerik)
    setSablon(yeni.sablon)
    setGeriYuklendi(yeni.geriYuklendi)
    setDurum({ tur: 'temiz' })
    sonKaydedilen.current = imza({ sablon: baslangicSablon, icerik: baslangicIcerik })
    ucustaki.current = null
    // Başka bir seansa geçildi: Önizle kipinde kalınsaydı yeni seansın
    // taslağı yanlış hâlde (eski notun görünümünde) açılırdı.
    setGorunum('yaz')
    bekleyenSecimRef.current = null
    sonSecimRef.current = null
  }

  const gecerli = useRef(true)
  useEffect(() => () => {
    gecerli.current = false
  }, [])

  // Bu anahtarın taslağının SAHİBİ olarak kayıt (bkz. `taslak.ts` "Canlı
  // taslak"): aynı notun öbür editörü (sekme değişimi) bu editör hâlâ
  // ekrandayken monte olursa taslağı bir kilit kurtarması sanmasın.
  useEffect(() => {
    taslakEditoru(taslakAnahtari, true)
    return () => taslakEditoru(taslakAnahtari, false)
  }, [taslakAnahtari])

  // Unmount sırasında (panel kapandı, başka randevu seçildi) elde bekleyen
  // içeriği hemen yazmak için son değerler bir ref'te tutuluyor. Efektin
  // temizliği sırasında state okunamaz.
  const son = useRef({ sablon, icerik, onKaydet, taslakAnahtari })
  son.current = { sablon, icerik, onKaydet, taslakAnahtari }

  async function kaydetDene(kayit: Kayit, anahtarAdi: string) {
    setDurum({ tur: 'kaydediliyor' })
    ucustaki.current = imza(kayit)
    // Uçuşta işareti (bkz. `taslak.ts` "Canlı taslak"): kayıt sürerken sekme
    // değişir ve aynı notun öbür editörü bu taslağı bulursa, onu bir kilit
    // kurtarması sanmasın.
    taslakUcusta(anahtarAdi, true)
    try {
      await onKaydet(kayit)
      // Bu iki satır `gecerli` kontrolünden ÖNCE: kayıt gerçekten olduysa
      // taslak, bileşen bu arada kaldırılmış olsa bile düşmelidir — aksi
      // hâlde bir sonraki mount sunucudakiyle aynı metni "kurtarılmış
      // taslak" diye geri yükler ve gereksiz bir yazma daha üretir.
      sonKaydedilen.current = imza(kayit)
      taslakTemizle(anahtarAdi, kayit)
      ucustaki.current = null
      if (!gecerli.current) return
      setGeriYuklendi(false)
      setDurum({ tur: 'kaydedildi', saat: saatBicimle(new Date()) })
    } catch (e) {
      // Taslak BİLEREK silinmiyor: kaydedilemeyen metnin tek kopyası o.
      ucustaki.current = null
      if (!gecerli.current) return
      setDurum({ tur: 'hata', kilit: e instanceof YetkisizHata })
    } finally {
      taslakUcusta(anahtarAdi, false)
    }
  }

  useEffect(() => {
    const kayit = { sablon, icerik }
    if (imza(kayit) === sonKaydedilen.current) {
      // Ekrandaki hâl sunucudakiyle AYNI: bu anahtardaki taslak artık
      // kurtaracak hiçbir şey taşımıyor (kullanıcı yazdığını geri aldı ya da
      // kayıt doğrulandı). Depo şifrelenmemiş düz metin sağlık verisi tutuyor;
      // fazlalık kopya sayfa ömrü boyunca bellekte kalmamalı — tasarımın
      // kabul ettiği bedel "o an kaydedilmemiş metin", "dokunulmuş her seans"
      // değil.
      //
      // `taslakTemizle` değil koşulsuz düşürme: depodaki kayıt son tuş
      // vuruşundan öncesine ait bir ara hâl olabilir ve içerik
      // karşılaştırması onu asla silmezdi. Yarışa karşı koruma, içerik
      // karşılaştırmasının yerine uçuş kontrolüdür.
      if (ucustaki.current === null) taslakDus(taslakAnahtari)
      return
    }

    // Taslak GECİKMESİZ yazılır. Gecikmeli yazılsaydı, kilit tam o gecikme
    // içinde devreye girdiğinde son yazılanlar hiçbir yerde olmazdı.
    taslakYaz(taslakAnahtari, kayit)
    setDurum({ tur: 'bekliyor' })

    const zamanlayici = setTimeout(() => {
      // Bu arada sunucuda TAM bu hâlin olduğu öğrenildiyse (başka bir
      // editörün tahliyesi aynı metni yazdı, bkz. `sunucuHali`) ikinci kez
      // yazılmaz — her yazma silinemez bir denetim satırı.
      if (imza(kayit) === sonKaydedilen.current) return
      void kaydetDene(kayit, taslakAnahtari)
    }, gecikmeMs)
    return () => clearTimeout(zamanlayici)
    // `onKaydet` bilerek bağımlılık listesinde değil: çağıran taraf her
    // render'da yeni bir kapanış (closure) üretirse zamanlayıcı sürekli
    // sıfırlanır ve otomatik kayıt hiç ateşlenmezdi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icerik, sablon, gecikmeMs, taslakAnahtari])

  // Dışarıdan gelen sunucu hâli (bkz. `sunucuHali` prop'u). Yalnızca editör
  // TEMİZKEN benimsenir: ekrandaki hâl sunucuda olduğu bilinen hâl ve uçuşta
  // kayıt yok. Benimsenince `sonKaydedilen` de güncellenir — yoksa yukarıdaki
  // kayıt efekti yeni içeriği "kaydedilmesi gereken değişiklik" sanıp geri
  // yazardı (her yazma silinemez bir denetim satırı).
  const disIcerik = sunucuHali?.icerik
  const disSablon = sunucuHali?.sablon
  useEffect(() => {
    if (disIcerik === undefined || disSablon === undefined) return
    const dis = imza({ sablon: disSablon, icerik: disIcerik })
    if (dis === sonKaydedilen.current) return
    if (ucustaki.current !== null) return
    const ekrandaki = imza({ sablon: son.current.sablon, icerik: son.current.icerik })
    if (ekrandaki === dis) {
      // Ekrandaki metin ZATEN sunucudaki: bu editör uçuştaki bir tahliyenin
      // taslağıyla açılmıştı (bkz. `taslak.ts::taslakUcusta`) ve o tahliye
      // şimdi bitti. İçerik değişmez; yalnızca "kaydedildi" bilgisi
      // güncellenir, bekleyen zamanlayıcı aynı metni ikinci kez yazmaz.
      sonKaydedilen.current = dis
      taslakTemizle(son.current.taslakAnahtari, { sablon: disSablon, icerik: disIcerik })
      setDurum({ tur: 'temiz' })
      return
    }
    if (ekrandaki !== sonKaydedilen.current) return // KİRLİ: kullanıcının metni kazanır
    sonKaydedilen.current = dis
    setIcerik(disIcerik)
    setSablon(disSablon)
    setGeriYuklendi(false)
  }, [disIcerik, disSablon])

  // Unmount: bekleyen içerik varsa zamanlayıcıyı beklemeden gönderilir.
  // Kilit (401) senaryosunda bu istek de 401 alır ve reddedilir — sorun
  // değil, taslak yerinde kalır ve kilit açılınca geri yüklenir.
  useEffect(() => () => {
    const { sablon: s, icerik: i, onKaydet: k, taslakAnahtari: a } = son.current
    const kayit = { sablon: s, icerik: i }
    if (imza(kayit) === sonKaydedilen.current || imza(kayit) === ucustaki.current) return
    // Uçuşta işareti: aynı anahtarla monte olan başka bir editör (sekme
    // değişimi, bkz. `taslak.ts` "Canlı taslak") bu taslağı bir kilit
    // kurtarması sanıp "oturum kilitlendi" şeridi göstermesin.
    taslakUcusta(a, true)
    void k(kayit)
      .then(() => taslakTemizle(a, kayit))
      .catch(() => {
        // Yutuluyor: bileşen artık ekranda değil, gösterilecek bir yer yok.
        // İçerik taslakta duruyor; hata mesajı yerine metnin kendisi korunur.
      })
      .finally(() => taslakUcusta(a, false))
  }, [])

  // Metnin TEK giriş noktası. Textarea'nın kendi `onChange`'i VE biçim
  // çubuğu/kısayollar AYNI bu fonksiyondan geçer — otomatik kayıt, taslak
  // saklama ve 401'de taslağın geri yüklenmesi hangi yoldan geldiğini
  // bilmeden, `icerik` state'i değiştiği için kendiliğinden çalışmaya devam
  // eder. Ayrı bir kayıt yolu ya da `setIcerik`'i atlayan bir yazma YOK.
  function icerikDegistir(yeni: string) {
    setIcerik(yeni)
  }

  // Biçim çubuğu düğmesi ya da klavye kısayolu: textarea'nın O ANKİ
  // seçimini `bicimUygula`'ya (saf fonksiyon, `not/bicim.ts`) verir, sonucu
  // `icerikDegistir` ile yazar ve yeni seçimi bir sonraki boyamada
  // uygulanmak üzere kuyruğa alır (bkz. aşağıdaki `useLayoutEffect`).
  function bicimUygulaVeYaz(tur: BicimTuru) {
    const alanEl = alanRef.current
    const bas = alanEl?.selectionStart ?? icerik.length
    const son = alanEl?.selectionEnd ?? icerik.length
    const sonuc = bicimUygula({ metin: icerik, bas, son }, tur)
    bekleyenSecimRef.current = { bas: sonuc.bas, son: sonuc.son }

    if (alanEl !== null && yerelDuzenlemeDene(alanEl, icerik, sonuc.metin)) {
      // Başarılı: `execCommand` gerçek bir `input` olayı üretti, textarea'nın
      // kendi `onChange`'i bunu yakalayıp `icerikDegistir`'i ZATEN çağıracak
      // — burada TEKRAR çağrılmaz (bkz. `yerelDuzenlemeDene` yorumu).
      return
    }

    // Düşüş yolu: `execCommand` yok (jsdom, eski tarayıcı) ya da başarısız.
    icerikDegistir(sonuc.metin)
  }

  // FİZİKSEL tuş koduyla (`event.code`) eşler, KARAKTERLE (`event.key`)
  // DEĞİL — inceleme bulgusu CRITICAL-1/IMPORTANT-2: kullanıcı Türkçe Q
  // klavye kullanıyor ve hedef platform macOS. Türkçe Q'da fiziksel I tuşu
  // Shift'siz `key === 'ı'` (U+0131, noktasız i) üretir, `key === 'i'`
  // hiçbir kombinasyonda eşleşmez — Ctrl+I hiç çalışmazdı. Aynı klavyede
  // Shift+8 `key === '('` üretir (ABD düzeninde `'*'`), asla `'8'` değil —
  // Ctrl+Shift+8 de hiçbir düzende çalışmazdı. `event.code` klavye
  // düzeninden bağımsızdır: fiziksel B/I/1/2/3/8 tuşu hangi dilde
  // yazılıyor olursa olsun sırasıyla `'KeyB'`/`'KeyI'`/`'Digit1'`/
  // `'Digit2'`/`'Digit3'`/`'Digit8'` üretir.
  //
  // # Alt basılıyken kısayol YOK (son inceleme M1)
  //
  // Windows Chromium AltGr'yi `ctrlKey + altKey` olarak bildirir. Türkçe Q'da
  // Markdown'un kendi karakterleri AltGr ile yazılıyor: AltGr+3 `#`, AltGr+1
  // `>`, AltGr+2 `£`... Alt denetlenmeseydi AltGr+3 "Başlık 3"e dönüşür ve
  // `#` hiç yazılamazdı. Alt'lı hiçbir kombinasyon kısayol değil; olay
  // olduğu gibi tarayıcıya bırakılır (varsayılan davranış engellenmez).
  function kisayolTusu(olay: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (olay.altKey) return
    const komutTusu = olay.ctrlKey || olay.metaKey // macOS'ta Cmd, hedef platform macOS
    if (!komutTusu) return
    let tur: BicimTuru | null = null
    if (!olay.shiftKey && olay.code === 'KeyB') tur = 'kalin'
    else if (!olay.shiftKey && olay.code === 'KeyI') tur = 'italik'
    else if (!olay.shiftKey && olay.code === 'Digit1') tur = 'baslik1'
    else if (!olay.shiftKey && olay.code === 'Digit2') tur = 'baslik2'
    else if (!olay.shiftKey && olay.code === 'Digit3') tur = 'baslik3'
    else if (olay.shiftKey && olay.code === 'Digit8') tur = 'madde' // Ctrl+Shift+8
    if (tur === null) return
    olay.preventDefault()
    bicimUygulaVeYaz(tur)
  }

  // DOM güncellendikten SONRA (boyamadan önce) bekleyen seçimi uygular: hem
  // biçim çubuğu/kısayol sonrası hem Yaz'a dönüşte kullanılır.
  useLayoutEffect(() => {
    if (bekleyenSecimRef.current === null) return
    const alanEl = alanRef.current
    if (alanEl) {
      const { bas, son } = bekleyenSecimRef.current
      alanEl.setSelectionRange(bas, son)
      alanEl.focus()
    }
    bekleyenSecimRef.current = null
  }, [icerik, gorunum])

  function onizlemeyeGec() {
    const alanEl = alanRef.current
    if (alanEl) sonSecimRef.current = { bas: alanEl.selectionStart, son: alanEl.selectionEnd }
    setGorunum('onizle')
  }

  function yazmayaGec() {
    // İmleç konumu korunur: Önizle'ye geçmeden önceki seçim geri uygulanır.
    bekleyenSecimRef.current = sonSecimRef.current
    setGorunum('yaz')
  }

  function sablonDegis(yeni: string) {
    setSablon(yeni)
    // Dolu editörde şablon değişimi yazılmış metni EZMEZ. Bu, not kaybının
    // ikinci gerçek yolu: kullanıcı yanlış şablonu seçtiğini fark edip
    // düzeltmek istediğinde yazdığı her şeyin silinmesi.
    if (icerik.trim() === '') setIcerik(sablonMetni(yeni))
  }

  const alanId = `not-alani-${taslakAnahtari}`
  const sablonId = `not-sablonu-${taslakAnahtari}`

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2">
        {sablonSecilebilir && (
          <>
            <label className="text-sm" htmlFor={sablonId}>
              Şablon
            </label>
            {/* Kapalı küme: seçenekler `sablon.ts`'teki kayıttan türetiliyor ve
                "yeni şablon ekle" yolu YOK — `templates.kod` UNIQUE ve kapalı bir
                CHECK taşıdığı için o tablo yapısal olarak en fazla üç satır
                tutabilir. Kullanıcı şablonun başlıklarını düzenler, türünü değil. */}
            <select
              id={sablonId}
              className="rounded border p-1 text-sm"
              value={sablon}
              onChange={(e) => sablonDegis(e.target.value)}
            >
              {SABLON_KODLARI.map((kod) => (
                <option key={kod} value={kod}>
                  {SABLON_ADLARI[kod]}
                </option>
              ))}
            </select>
          </>
        )}

        {/* Kibar (`polite`) canlı bölge: "Kaydedilmemiş değişiklikler var…",
            "Yazılıyor…", "Kaydedildi 14:32". Kullanıcı yazarken kesilmesin
            diye `status`, `alert` DEĞİL. Bölge metin boşken de DOM'da kalır:
            sonradan eklenen canlı bölgeler ekran okuyucularda güvenilir
            biçimde duyurulmaz. Hata kipinde bilerek boşalır — o kipin
            duyurusunu aşağıdaki `role="alert"` üstlenir. */}
        <span className="ml-auto text-sm text-slate-500" role="status">
          {durumMetni(durum)}
        </span>
      </div>

      {/* Geri yükleme şeridi de bir canlı bölge: kurtarma sessizce olursa,
          ekran okuyucu kullanıcısı ekrandaki metnin sunucudan mı taslaktan
          mı geldiğini bilemez — ve o metin henüz KAYDEDİLMEMİŞTİR. */}
      {geriYuklendi && (
        <p role="status" className="mb-2 rounded bg-amber-50 p-2 text-sm text-amber-900">
          Kaydedilmemiş not içeriğiniz geri yüklendi. Oturum kilitlendiğinde henüz
          kaydedilmemişti; kaldığınız yerden devam edebilirsiniz.
        </p>
      )}

      {/* Yaz/Önizle anahtarı: iki durumlu, `aria-pressed` seçili olanı
          söyler. Önizlemedeyken otomatik kayıt zaten çalışmaz — `icerik`
          değişmiyor, çünkü textarea o kipte DOM'da yok — ayrı bir "kayıt
          durdurma" mekanizması gerekmiyor. */}
      <div className="mb-1 flex gap-1" role="group" aria-label="Görünüm">
        <button
          type="button"
          aria-pressed={gorunum === 'yaz'}
          className={
            'rounded border px-2 py-0.5 text-xs ' +
            (gorunum === 'yaz' ? 'border-slate-400 bg-slate-100 font-medium' : 'border-slate-300')
          }
          onClick={yazmayaGec}
        >
          Yaz
        </button>
        <button
          type="button"
          aria-pressed={gorunum === 'onizle'}
          className={
            'rounded border px-2 py-0.5 text-xs ' +
            (gorunum === 'onizle' ? 'border-slate-400 bg-slate-100 font-medium' : 'border-slate-300')
          }
          onClick={onizlemeyeGec}
        >
          Önizle
        </button>
      </div>

      {gorunum === 'yaz' ? (
        <>
          <label className="text-sm" htmlFor={alanId}>
            {etiket}
          </label>
          <BicimCubugu onUygula={bicimUygulaVeYaz} />
          <textarea
            id={alanId}
            ref={alanRef}
            // `font-mono` kaldırıldı: yazarken de okunaklı olmalı (Görev 2).
            className="mt-1 min-h-64 flex-1 rounded border p-2 text-sm"
            value={icerik}
            onChange={(e) => icerikDegistir(e.target.value)}
            onKeyDown={kisayolTusu}
          />
        </>
      ) : (
        <div className="mt-1 min-h-64 flex-1 overflow-auto rounded border p-2">
          <NotGorunumu kaynak={icerik} />
        </div>
      )}

      {/* `role="alert"` (assertive): kayıt hatası ekran okuyucuya DUYURULMAK
          zorunda. Önceki hâlinde hata kipi `durumMetni`'ni boş dizgeye
          çeviriyor, yani kibar bölgeyi BOŞALTIYORDU ve kutunun kendisinin
          hiçbir `role`'ü yoktu: ekran okuyucu kullanıcısı yazmaya devam
          ederken "Kaydedilemedi" hiç duyulmuyordu. Burada kesici duyuru
          doğru olan: kaydet düğmesi yok, kullanıcı kaydın olduğunu
          varsayarak yazmaya devam ediyor ve bunu ilk fırsatta bilmeli. */}
      {durum.tur === 'hata' && (
        <div role="alert" className="mt-2 rounded bg-red-50 p-2 text-sm text-red-800">
          <p>
            Kaydedilemedi.{' '}
            {durum.kilit
              ? 'Oturum kilitlendi. Yazdıklarınız korunuyor: kilidi açıp bu seansı ' +
                'yeniden açtığınızda metin geri yüklenir.'
              : 'Yazdıklarınız ekranda duruyor ve silinmedi; yazmaya devam ederseniz ' +
                'ya da yeniden denerseniz kayıt tekrar denenir.'}
          </p>
          <button
            type="button"
            className="mt-2 rounded border border-red-300 px-2 py-1"
            onClick={() => void kaydetDene({ sablon, icerik }, taslakAnahtari)}
          >
            Yeniden dene
          </button>
        </div>
      )}
    </div>
  )
}

function baslangicDurumu(anahtar: string, sunucuIcerik: string, sunucuSablon: string) {
  const taslak = taslakOku(anahtar)
  if (taslak === undefined) {
    return { icerik: sunucuIcerik, sablon: sunucuSablon, geriYuklendi: false }
  }
  const farkli = taslak.icerik !== sunucuIcerik || taslak.sablon !== sunucuSablon
  if (!farkli) {
    // Taslak sunucudakiyle aynı: kurtarılacak bir şey yok. Depodan düşürülür
    // ve "geri yüklendi" DENMEZ — kaybolmayan bir şeyin kurtarıldığını
    // söylemek uyarıyı gürültüye çevirir ve gerçekten kurtarıldığı gün
    // fark edilmez.
    taslakTemizle(anahtar, taslak)
  }
  // CANLI bir taslak (öbür editör hâlâ ekranda ya da kaydı uçuşta — sekme
  // değişimi) KİLİT kurtarması değildir: içerik yine taslaktan gelir
  // (sunucudaki eski metin, bir tuşla yazılanı ezerdi) ama "oturum
  // kilitlendiğinde kaydedilmemişti" şeridi yanlış bilgi olurdu (bkz.
  // `taslak.ts` "Canlı taslak").
  return {
    icerik: taslak.icerik,
    sablon: taslak.sablon,
    geriYuklendi: farkli && !taslakCanliMi(anahtar),
  }
}

function durumMetni(durum: Durum): string {
  switch (durum.tur) {
    case 'temiz':
      return ''
    case 'bekliyor':
      return 'Kaydedilmemiş değişiklikler var…'
    case 'kaydediliyor':
      return 'Yazılıyor…'
    case 'kaydedildi':
      return `Kaydedildi ${durum.saat}`
    case 'hata':
      // Bilerek boş: hata kipinin duyurusunu kibar `status` bölgesi değil,
      // hata kutusunun `role="alert"`'ü yapar. İkisi birden konuşsaydı aynı
      // olay ekran okuyucuda iki kez okunurdu.
      return ''
  }
}
