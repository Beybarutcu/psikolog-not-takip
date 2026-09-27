import { useState } from 'react'
import { danisanApi, etiketApi, notApi, YetkisizHata, type DanisanSeansi, type Etiket } from '../api'
import { AyarlarSekmesi } from '../ayarlar/AyarlarSekmesi'
import type { DosyaAltSekme } from '../danisan/DanisanDosyasi'
import { DanisanlarSekmesi } from '../danisan/DanisanlarSekmesi'
import { EtiketliSeanslar } from '../etiket/EtiketliSeanslar'
import type { EtiketBaglami } from '../etiket/EtiketSatiri'
import { Sekmeler } from '../kabuk/Sekmeler'
import { ACILIS_SEKMESI, type SekmeKodu } from '../kabuk/sekme'
import { TakvimSekmesi } from '../takvim/TakvimSekmesi'
import { useDanisanDosyasi } from './anaEkranKancalari/useDanisanDosyasi'
import { useDanisanListesi } from './anaEkranKancalari/useDanisanListesi'
import { useDanisanSeanslari } from './anaEkranKancalari/useDanisanSeanslari'
import { useDenetimKayitlari } from './anaEkranKancalari/useDenetimKayitlari'
import { useDosyaNotu } from './anaEkranKancalari/useDosyaNotu'
import { useEtiketler } from './anaEkranKancalari/useEtiketler'
import { useParolaFormu } from './anaEkranKancalari/useParolaFormu'
import { useSeansNotlari } from './anaEkranKancalari/useSeansNotlari'
import { useTakvimAkisi } from './anaEkranKancalari/useTakvimAkisi'
import { useYedekleme } from './anaEkranKancalari/useYedekleme'
import { yerelGun } from './anaEkranKancalari/yerelGun'

/**
 * Ana ekran: sekme kabuğu (Takvim / Danışanlar / Ayarlar) + tüm veri
 * akışlarının kancaları.
 *
 * # Veri akışları KANCALARDA, ekran yalnızca bağlıyor
 *
 * Altı ayrı yükleme akışı var ve her birinin kendi yaşam döngüsü kuralları
 * (`store::audit` hacim politikası yüzünden hangi isteğin ne zaman
 * atılabileceği, 401'de neyin ekrandan silineceği, geciken yanıtların hangi
 * state'i ezmeyeceği). Hepsi tek bir bileşende dokuz `useEffect` olarak
 * durduğunda bir akışın kuralını okumak için diğer beşini de okumak
 * gerekiyordu. Ayrım akış başına:
 *
 *   - `useTakvimAkisi`     — görünen haftanın randevuları ve SEÇİM (omurga)
 *   - `useSeansNotlari`    — açık seansın resmî notu ve özel notu
 *   - `useDanisanDosyasi`  — açık danışan kartı, ekleri ve depolama durumu
 *   - `useDanisanListesi`  — danışan listesi, ekleme, arşivleme, saklama uyarısı
 *   - `useDenetimKayitlari`— Ayarlar > Denetim kaydı: salt okunur liste, süzgeç,
 *                            sayfalama (Görev 7 Plan 7)
 *   - `useDanisanSeanslari`— açık danışanın Seanslar alt sekmesindeki listesi,
 *                            seçili seansı ve yamaları
 *   - `useDosyaNotu`       — danışan dosyasında seçili seansın resmî notu
 *   - `useEtiketler`       — seansların etiketleri (İKİ ekranın ORTAK tek
 *                            önbelleği), sözlük, açık etiketli seanslar paneli
 *   - `useYedekleme`       — otomatik/elle yedek ve KALICI uyarı
 *   - `useParolaFormu`     — parola değiştirme (yükleme değil, ama kendi başına
 *                            bir akış; parolalar form kapanınca siliniyor)
 *
 * # 401 temizliği İKİ (aslında ÜÇ) YÖNLÜ ve bu yüzden burada bağlanıyor
 *
 * Takvim yüklemesi 401 alırsa açık danışan kartı da kapanmalı; seans, danışan
 * ve seans-listesi akışları 401 alırsa takvim seçimi kapanmalı. Kancalar
 * birbirini doğrudan göremez, dolayısıyla bağ burada, geri çağrılarla
 * kuruluyor. Kancalar bu geri çağrıları içeride bir `ref`te tutuyor — böylece
 * efekt bağımlılıkları İLKEL kimliklerle sınırlı kalıyor ve her render yeni
 * bir istek atmıyor (silinemez `goruntuleme` satırları).
 *
 * Temizliğin KAPSAMI akışa göre farklı ve bilerek öyle: seans/özel not/seans-
 * listesi 401'i yalnızca takvim seçimini kapatır (açık kart hassas veri
 * göstermiyor demek değil — kart kendi isteğini attığında kendi 401'ini
 * alır), takvim ve kart 401'i ikisini birden kapatır.
 *
 * # Sekme kabuğu — Görev 8
 *
 * `sekme` state'i BURADA yaşıyor: hangi panelin (Takvim/Danışanlar/Ayarlar)
 * göründüğü, açık danışan dosyasının hangi akışları tetiklediğiyle (401
 * temizliği, `danisanaGit`) iç içe. Yalnızca SEÇİLİ sekmenin paneli monte
 * edilir (`DanisanDosyasi`'nin kendi Seanslar/Bilgiler alt sekmeleriyle AYNI
 * desen) — bunun kazancı, panelin İÇİNDE yaşayan durumlar (ör.
 * `TakvimSekmesi`'ndeki `ozetAcik`, `DanisanDosyasi`'nin alt sekme seçimi)
 * için gerçek: görünmeyen bir sekmenin interaktif öğeleri DOM'da aynı anda
 * durmaz (mutasyon 3'ün ölçtüğü kural, bkz. `AnaEkran.test.tsx` "sekme
 * izolasyonu"). Kancaların KENDİSİ (`useTakvimAkisi`, `useYedekleme` vb.)
 * BURADA, AnaEkran'da yaşadığı için panel montajından BAĞIMSIZ çalışmaya
 * devam eder — bu yüzden IMPORTANT-3: saklama süresi dolanlar isteği gibi,
 * SİLİNEMEZ bir denetim kaydı yazan bir isteği görünmeyen bir sekmede
 * durdurmak için panel montajına güvenilemez, kancaya AÇIKÇA bir
 * `ayarlarGorunur` parametresi geçmek gerekiyor (bkz. `useDanisanListesi`
 * çağrısı aşağıda).
 *
 * `danisanaGit(clientId)` TEK giriş noktası: sekme state'i burada, açık
 * danışan dosyası `useDanisanDosyasi`'de — biri diğerini görmediği için bu
 * fonksiyon ikisini birleştiriyor. Danışana giden HER yol (seans
 * panelindeki danışan adı düğmesi — bkz. `SeansPaneli.tsx`, inceleme
 * CRITICAL-1: randevu ÇİPİNİN kendisi DEĞİL, çip yalnızca seansı seçer —
 * hızlı arama, ay özetindeki borçlu satırı, danışan listesindeki çip,
 * saklama süresi hatırlatması) AYNI fonksiyonu çağırıyor; ayrı bir
 * "yalnızca sekme değiştir" ya da "yalnızca dosya aç" yolu YOK — biri
 * unutulup diğeri çağrılırsa (ör. dosya açılır ama sekme değişmez)
 * kullanıcı Takvim sekmesinde kalır ve hiçbir şey olmamış sanır.
 *
 * # TEK yazma yolu, her önbelleğe yayılım (son inceleme C1/C2)
 *
 * Aynı seansa iki ekran bakıyor: takvim (`useTakvimAkisi` + `useSeansNotlari`)
 * ve danışan dosyası (`useDanisanSeanslari` + `useDosyaNotu`), artı açık kart
 * (`useDanisanDosyasi`) ve ay özeti. Eskiden dosya `takvimApi`/`notApi`'yi
 * doğrudan çağırıp sonucu yalnızca kendi yerel state'ine yazıyordu: dosyada
 * yazılan not takvime dönünce ESKİ görünüyor ve tek bir tuş eski metni PUT
 * edip yazılanı sunucudan SİLİYORDU (klinik not kaybı); dosyada işaretlenen
 * ödeme sekme gidip gelince kayboluyor, kartın bakiyesi hiç tazelenmiyordu;
 * takvimde yazılan not dosya listesinde "Not yazılmamış" kalıyordu.
 *
 * Şimdi üç yazma (`seansNotuKaydet`, `durumDegis`, `odemeDegis`) YALNIZCA
 * burada ve başarılı her yazmanın sonucu, hangi ekrandan gelirse gelsin,
 * ilgili BÜTÜN önbelleklere aynı çağrıdan yayılıyor. İki ekranı ayrı ayrı
 * yamalamak değil: tek yol, çok alıcı. Her alıcı yamayı kendi `yazmaSaati`ne
 * de işliyor, ki o an uçuşta olan bir okuma yazmayı ezmesin.
 *
 * ## Etiket yazmaları (Plan 6 Görev 6): aynı kural
 *
 * `etiketEkle` / `etiketKaldir` de YALNIZCA burada. Alıcılar:
 *
 *   | Önbellek                              | Nasıl                                   |
 *   |---------------------------------------|-----------------------------------------|
 *   | seansın etiketleri (takvim + dosya)   | `etiketler.eklendi/kaldirildi` — TEK    |
 *   |                                       | harita, iki ekran aynı girdiyi okur     |
 *   | dosyanın seans listesindeki satır     | `seanslar.yamala({ etiketler })`        |
 *   |                                       | (+ o kancanın `yazmaSaati`'ı)           |
 *   | sözlük                                | `eklendi/kaldirildi` içinde: istendiyse |
 *   |                                       | yazmadan SONRA sunucudan yeniden okunur |
 *   |                                       | (yalnızca en son okuma yazar)           |
 *   | açık etiketli seanslar paneli         | kaldırmada satır düşer; eklemede panel  |
 *   |                                       | tek istekle tazelenir                   |
 *
 * ## Takvimin randevu yazmaları da etiket paneline yayılır (son inceleme I1)
 *
 * Etiketli seanslar panelinin satırları (danışan adı, saat) RANDEVUDAN
 * geliyor. Takvimdeki üç randevu yazması (`randevuKaydet`, `randevuSil`,
 * `randevuSeriSil` — kaydet/düzenle, sil, seriyi sil) BAŞARILI olunca
 * `etiketler.randevularDegisti()` çağrılır: panel AÇIKSA tek istekle yeniden
 * okunur (kapalıysa istek yok), sözlük istendiyse tazelenir (silinen randevu
 * bir etiketin son kullanımı olabilir). Bu olmasaydı panel taşınan seansı
 * eski danışanın adıyla, silineni hâlâ listede gösterir ve silinen satıra
 * tıklamak dosyada başka bir seansı açardı. Takvim bu yazmaları
 * `takvim.kaydet/sil/seriSil`'e doğrudan değil BURAYA bağlı prop'larla
 * yapar (`durumDegis`/`odemeDegis` ile aynı desen).
 *
 * Seansın etiketleri için İKİ önbellek YOK: takvim paneli ve dosya aynı
 * `useEtiketler` girdisini okuyor — notta C1'i üreten "iki kopyadan biri
 * bayat" durumu burada kurulamıyor.
 *
 * ## 401 temizliği etiketleri de kapsar
 *
 * Etiketli seanslar paneli sekme panellerinin DIŞINDA ve bütün danışanların
 * adlarını taşıyor; takvim seçimini kapatmak onu kapatmaz. Bu yüzden her 401
 * geri çağrısı (`oturumKapandi`, takvimin `onYetkisiz`'i) `etiketler.
 * temizle`'yi de çağırır.
 *
 * ## Aynı üç yazma dosyanın SEANS LİSTESİNE de yayılır (BAYATLIK olarak)
 *
 * Etiket panelindeki sorunun eşi: oluşturma, düzenleme/taşıma, silme ve seri
 * iptali dosyanın seans listesine alan yaması olarak yayılamaz (satır ekler,
 * çıkarır ya da başka danışanın dosyasına taşır). Aynı üç sarmalayıcı
 * başarıda `seanslar.yapiDegisti(<etkilenen danışanlar>)` çağırır; liste
 * bayatlanır ve yalnızca GÖRÜNÜR olduğunda bir kez yeniden çekilir (bkz.
 * `useDanisanSeanslari` "Bayatlık"). Taşımada eski danışan da bildirilir ve
 * bu yüzden ESKİ danışan `await`ten ÖNCE okunur: yazma başarılı olunca
 * `takvim.seciliRandevu` artık yeni danışanı taşır.
 *
 * ## Aynı üç yazma AY ÖZETİNE ve açık kartın BAKİYESİNE de yayılır (Görev 2)
 *
 * Üçüncü ve dördüncü alıcı, seans listesiyle AYNI gerekçeyle: özet açıkken
 * ya da kart açıkken görünmez kalan bir randevu oluşturma/silme/seri iptali/
 * ücret değişimi terapiste YANLIŞ bir borç söyletebilir (`AyOzeti`nin
 * saydığı rakamlar ve `DosyaBilgileri`'ndeki bakiye ikisi de bu üç yazmadan
 * etkileniyor). `setOzetTazeleme` özeti (açıksa) TEK bir `GET /api/ay-ozeti`
 * ile tazeler; `dosya.randevularTazele` kartın randevu penceresini YENİDEN
 * ÇEKER — kartın TAMAMINI DEĞİL (`clients::getir` `HerCagri`'dir, bkz.
 * `useDanisanDosyasi.randevularTazele` gerekçesi), yalnızca
 * `takvimApi.randevulariGetir` (`OturumBasi`, ek denetim maliyeti yok).
 * Seans listesindeki bayatlık deseninden FARKI: kartın kendi `gorunur`
 * kısıtı yok, dolayısıyla erteleme değil, yazma başarılı olur olmaz hemen
 * tazeleniyor (bkz. o fonksiyonun gerekçesi).
 */
/** Etiket yazma hatasının ekrandaki metni: ne denendi + sunucunun mesajı. */
function yazmaHataMetni(ne: string, e: unknown): string {
  return `${ne} ${e instanceof Error ? e.message : ''}`.trim()
}

export function AnaEkran({
  kilitle,
  onGeriYukle,
}: {
  kilitle: () => void
  /**
   * Geri yükleme ekranını açar (tasarım §7: "uygulama içinden geri yükle
   * ekranı"). Ekranın üç felaket yolu (bozuk veritabanı, okunamayan anahtar
   * dosyası, yeni bilgisayar) `App` tarafından yönetiliyor; bu, her şey
   * çalışırken kullanılan dördüncü yol.
   */
  onGeriYukle: () => void
}) {
  // Sekme kabuğu (bkz. modül başlığı). `ACILIS_SEKMESI`: uygulamanın amacı
  // takvim, terapist her açılışta önce başka bir sekmeyi geçmek zorunda
  // kalmamalı. Diğer kancalardan ÖNCE tanımlanıyor: `liste`nin saklama
  // hatırlatması isteği (IMPORTANT-3) `sekme === 'ayarlar'` değerine ihtiyaç
  // duyuyor.
  const [sekme, setSekme] = useState<SekmeKodu>(ACILIS_SEKMESI)

  // `dosya` ve `etiketler` aşağıda tanımlanıyor; closure çağrıldığı anda
  // okunuyor, bu yüzden kancaların bildirim sırası bir kısıt değil (bkz.
  // modül başlığı).
  const takvim = useTakvimAkisi({
    onYetkisiz: () => {
      dosya.kapat()
      etiketler.temizle()
    },
  })
  // IMPORTANT-3 düzeltmesi: saklama süresi dolanlar isteği yalnızca Ayarlar
  // sekmesi GÖRÜNÜRKEN atılır. `clients::saklama_suresi_dolanlar` her
  // çağrıda `LogHacmi::HerCagri` ile SİLİNEMEZ bir `goruntuleme` satırı
  // yazıyor (bkz. `useDanisanListesi.ts` modül başlığı); veri artık yalnızca
  // Ayarlar sekmesinde gösterildiği için terapist Ayarlar'ı hiç açmasa bile
  // mount'ta atılan bir istek kalıcı, hiç görülmeyecek bir kayıt bırakırdı.
  const liste = useDanisanListesi({ ayarlarGorunur: sekme === 'ayarlar' })
  // Denetim kaydı (Görev 7 Plan 7): AYNI `ayarlarGorunur` deseni, ama farklı
  // gerekçeyle -- bkz. `useDenetimKayitlari` modül başlığı ("okumak yeni bir
  // satır yazmaz" ama "terapistin bakmadığı şey için istek atılmaz" hâlâ
  // geçerli).
  const denetim = useDenetimKayitlari({ ayarlarGorunur: sekme === 'ayarlar' })
  const dosya = useDanisanDosyasi({ onYetkisiz: () => oturumKapandi() })
  // Danışan dosyasının alt sekmesi (Seanslar/Bilgiler). BURADA, bileşende
  // değil (son inceleme M1): `DanisanDosyasi` sekme gidip gelince yeniden
  // monte oluyor ve kendi state'inde tutulan alt sekme her girişte
  // sıfırlanıyordu.
  const [dosyaAltSekme, setDosyaAltSekme] = useState<DosyaAltSekme>('seanslar')
  const seanslar = useDanisanSeanslari({
    clientId: dosya.seciliDanisanId,
    // Bayat listenin yeniden çekilmesi yalnızca liste EKRANDAYKEN: görünmeyen
    // bir sekmeden silinemez görüntüleme kaydı düşmesin.
    gorunur: sekme === 'danisanlar' && dosyaAltSekme === 'seanslar',
    onYetkisiz: () => oturumKapandi(),
  })
  // Dosyada seçili seansın notu. İstek YALNIZCA görünürken (bkz.
  // `useDosyaNotu` başlığı): Danışanlar sekmesi + Seanslar alt sekmesi + kart
  // yüklenmiş (dosya bileşeni kart yüklenmeden hiç çizilmiyor; çizilmeyen bir
  // not için silinemez görüntüleme kaydı bırakılmamalı).
  const dosyaSeanslariGorunur =
    sekme === 'danisanlar' &&
    dosyaAltSekme === 'seanslar' &&
    dosya.kart.dosya !== null &&
    dosya.kart.hata === null
  const dosyaNotu = useDosyaNotu({
    appointmentId: seanslar.seciliSeansId,
    gorunur: dosyaSeanslariGorunur,
  })
  const yedekleme = useYedekleme()
  const seansAkisi = useSeansNotlari({
    randevu: takvim.seciliRandevu,
    onYetkisiz: () => oturumKapandi(),
    notYaz: seansNotuKaydet,
  })
  // Etiketlerin istendiği TEK seans: o an bir panelde GÖRÜNEN (bkz.
  // `useEtiketler` "İstek zamanlaması"). Takvimde seans paneli yalnızca not
  // yüklemesi hatasızken çiziliyor (`TakvimSekmesi`); dosyada `useDosyaNotu`
  // ile AYNI görünürlük şartı. Görünmeyen sekmedeki seçim istek ÜRETMEZ.
  const gorunenSeansId =
    sekme === 'takvim'
      ? takvim.seciliRandevu !== null && seansAkisi.seans.hata === null
        ? takvim.seciliRandevu.id
        : null
      : dosyaSeanslariGorunur
        ? seanslar.seciliSeansId
        : null
  const etiketler = useEtiketler({
    gorunenSeansId,
    onYetkisiz: () => takvim.oturumKapandi(),
  })

  /**
   * Seans/dosya/liste akışlarının 401'i: takvim seçimi kapanır VE etiket
   * state'i (özellikle sekmelerin dışındaki etiketli seanslar paneli)
   * temizlenir (bkz. modül başlığı "401 temizliği etiketleri de kapsar").
   */
  function oturumKapandi() {
    takvim.oturumKapandi()
    etiketler.temizle()
  }
  const parola = useParolaFormu()
  // Ay sonu özetinin KAPALI başlama state'i artık `TakvimSekmesi`'nde
  // yaşıyor (Görev 3): o bileşen `AyOzeti`'ni koşullu mount eden JSX'i de
  // taşıyor, dolayısıyla "kapalı başlar" kuralı tek bir dosyada, doğrudan
  // test edilebilir kalıyor (bkz. `TakvimSekmesi.tsx` modül başlığı).
  //
  // Açık özetin DIŞARIDAN tazelenme sayacı (dal incelemesi I1) BURADA
  // kalıyor: kart bakiyesi durum/ödeme yazmasından sonra yerelde yamanıyor
  // (`dosya.randevuYamala`, bu bileşenin GÖRDÜĞÜ bir kanca) — özet ise
  // yalnızca ay değişince istek atıyordu; özet açıkken "Ödendi" işaretlenince
  // kart `0,00 TL`, özet aynı borcu hâlâ gösteriyordu. Sayaç `TakvimSekmesi`ye
  // `ozet.disTazeleme` olarak PROP'la geçiyor — `dosya` kancası ona görünmüyor
  // (bkz. `TakvimSekmesi.tsx`'teki "neden PROP" gerekçesi). Özet kapalıyken
  // sayaç artsa da istek GİTMEZ: `AyOzeti` monte değil, açıldığında zaten tek
  // bir taze istek atar.
  //
  // Görev 2 inceleme IMPORTANT-1: yalnızca durum/ödeme DEĞİL, takvimin üç
  // randevu yazması da (`randevuKaydet`/`randevuSil`/`randevuSeriSil`) bu
  // sayacı artırır — oluşturma, silme ve seri iptali de `AyOzeti`nin saydığı
  // rakamları değiştiriyor (bkz. o fonksiyonların yorumu).
  const [ozetTazeleme, setOzetTazeleme] = useState(0)

  /**
   * Danışan dosyasına giden TEK yol (bkz. modül başlığı). Eski adı
   * `danisanKartiAc`'tı; Görev 8 sekmeyi de değiştirdiği için yeniden
   * adlandırıldı — davranış (arşiv bilgisini temizle, dosyayı aç) AYNEN
   * korunuyor, yalnızca `setSekme('danisanlar')` EKLENDİ.
   *
   * Danışanlar sekmesindeyken bir çipe tıklamak da AYNI fonksiyonu çağırır:
   * `setSekme('danisanlar')` o durumda no-op'tur (zaten o sekmedeyiz), ayrı
   * bir dal yazmak yalnızca iki farklı davranışın senkron kalması riskini
   * eklerdi.
   */
  function danisanaGit(clientId: number, appointmentId?: number) {
    liste.setArsivBilgisi(null)
    // Seçim ve alt sekme: takvimdeki bir seanstan gelindiyse dosya O seans
    // seçili, Seanslar alt sekmesinde açılır (son inceleme I3). Başka bir
    // danışana geçilince ikisi de sıfırlanır — bir danışanda seçilmiş seans
    // ya da açık bırakılmış Bilgiler, başka danışanın dosyasına taşınmaz.
    // AYNI danışana yeniden tıklamak (seans kimliği olmadan) hiçbir şeyi
    // sıfırlamaz ve YENİDEN ÇEKMEZ: dosyanın verisi tek yazma yolundan taze
    // tutuluyor (bkz. modül başlığı), yeniden çekmek yalnızca silinemez bir
    // görüntüleme satırı daha bırakırdı. İstisna: takvimden gelinen seans
    // yüklü listede YOKSA `seansSec` listeyi bayat sayar ve görünür olunca
    // yeniden çekilir (bkz. `useDanisanSeanslari` "Bayatlık").
    if (appointmentId !== undefined) {
      seanslar.seansSec(clientId, appointmentId)
      setDosyaAltSekme('seanslar')
    } else if (clientId !== dosya.seciliDanisanId) {
      seanslar.seansSec(clientId, null)
      setDosyaAltSekme('seanslar')
    }
    dosya.ac(clientId)
    setSekme('danisanlar')
  }

  // Görev 7: hızlı aramanın not sonucuna tıklamak artık takvim haftasına
  // GİTMEZ — `danisanaGit(clientId, appointmentId)` çağrılır, tıpkı seans
  // panelindeki danışan çipi gibi (bkz. `HizliArama.tsx` ve
  // `TakvimSekmesi.tsx` modül başlıkları). Eski `seansaGit` sarmalayıcısı ve
  // onu besleyen `useTakvimAkisi.seansaGit`/`bekleyenSeans` (hafta-yarışı
  // koruması) kaldırıldı: başka hiçbir çağıranı yoktu (inceleme düzeltmesi,
  // dead-code temizliği).

  // Veri raporu SUNUCUDA üretilir (Plan 4 Görev 6–7): bu ekran not çekmez,
  // metin kurmaz; yalnızca parolayı ve YEREL günü sunucuya iletir. Gün
  // TIKLAMA ANINDA hesaplanır — kart gece yarısından önce açılıp sonra
  // kullanılırsa render anındaki `bugun` dünü taşırdı. Testli:
  // `AnaEkran.test.tsx` > "yerel gün: gece yarısı ile 03:00 arası".
  /**
   * Alt satırın durum/ödeme işlemleri. Takvim listesi ve seçili randevu
   * `useTakvimAkisi`'nde tazeleniyor; AÇIK DANIŞAN KARTININ bakiyesi de aynı
   * randevudan hesaplandığı için kartın listesi burada yerelde yamanıyor
   * (Görev 2 inceleme M5 — kart yeniden çekilmez, bkz. `randevuYamala`).
   * Yama yalnızca istek BAŞARILIYSA: ret önce `await`ten fırlar.
   *
   * Açık AY SONU ÖZETİ ise yamanamaz (toplamlar sunucuda hesaplanıyor) ve
   * YENİDEN İSTENİR: tek bir `GET /api/ay-ozeti`. Tazeleme de yalnızca
   * başarıda — reddedilen bir yazma sunucuda hiçbir şeyi değiştirmedi.
   * Ölçen testler: `AnaEkran.test.tsx` > "ozet ACIKKEN ... TEK yeni istekle
   * tazelenir", "ozet KAPALIYKEN ... ozet istegi YOK", "odeme yazmasi
   * REDDEDILIRSE ...".
   *
   * `durumDegis` ayrıca "Geldi" yazmasının yanıtındaki `son_temas`/
   * `saklama_bitis`i (varsa) kartın dosyasına ve saklama hatırlatması
   * listesine yayar (Görev 3, bkz. fonksiyon içindeki gerekçe ve
   * `AnaEkran.yayilim.test.tsx`).
   */
  //
  // Son inceleme C2: danışan dosyasının alt satırı da BU iki fonksiyonu
  // çağırıyor (eskiden `takvimApi`'yi doğrudan çağırıp yalnızca kendi yerel
  // yamasını tutuyordu). Dosyanın seans listesi (`seanslar.yamala`) de aynı
  // çağrıdan besleniyor — hangi ekrandan işaretlenirse işaretlensin takvim,
  // kart, ay özeti ve dosya listesi aynı değeri gösterir.
  async function durumDegis(id: number, durum: string) {
    const yanit = await takvim.durumDegis(id, durum)
    dosya.randevuYamala(id, { durum })
    seanslar.yamala(id, { durum })
    setOzetTazeleme((n) => n + 1)
    // Görev 3: "Geldi" işaretlemesi sunucuda danışanın `son_temas`/
    // `saklama_bitis`ini ileri taşımışsa (`appointments::son_temasi_
    // isaretle`) yanıt bu iki alanı (+ `client_id`) taşır -- üçü BİRLİKTE
    // gelir ya da hiç gelmez (bkz. `api.ts::DurumYaniti`). Kart da saklama
    // listesi de YENİDEN ÇEKİLMEZ (`clients::getir` ve `clients::
    // saklama_suresi_dolanlar` ikisi de `LogHacmi::HerCagri` -- silinemez
    // satır): sonuç zaten kesin biliniyor, ikisi de YERELDE yamanır. Bu
    // olmasaydı süresi dolmuş bir danışan terapiye dönüp "Geldi"
    // işaretlense bile Bilgiler sekmesi "süresi doldu" demeye devam eder,
    // Ayarlar'daki liste de danışanı taşımaya devam ederdi -- imha kararını
    // besleyen TEK ekran bayat kalırdı (bkz. KVKK notu, brief).
    if (
      yanit.client_id !== undefined &&
      yanit.son_temas !== undefined &&
      yanit.saklama_bitis !== undefined
    ) {
      dosya.dosyaAlanlariniYama(yanit.client_id, {
        son_temas: yanit.son_temas,
        saklama_bitis: yanit.saklama_bitis,
      })
      liste.saklamaDolandanDus(yanit.client_id, yanit.saklama_bitis)
    }
  }

  async function odemeDegis(id: number, odendi: boolean) {
    await takvim.odemeDegis(id, odendi)
    dosya.randevuYamala(id, { odendi })
    seanslar.yamala(id, { odendi })
    setOzetTazeleme((n) => n + 1)
  }

  /**
   * Resmî notun TEK yazma yolu (son inceleme C1). Takvimdeki editör
   * (`useSeansNotlari.notKaydet` → `notYaz`) ve danışan dosyasındaki editör
   * (`DanisanDosyasi` → `onNotKaydet`) ikisi de buraya geliyor; başarılı
   * kaydın sonucu ÜÇ önbelleğe birden yayılıyor:
   *
   *   - `seansAkisi.notYansit` — takvimde bu seans açıksa editörün notu,
   *   - `dosyaNotu.notYansit`  — dosyada bu seans seçiliyse editörün notu,
   *   - `seanslar.yamala`      — dosya listesindeki önizleme (`not_ilk_satiri`,
   *                              PUT yanıtının sunucuda hesaplanan
   *                              `onizleme`'si — istemcide eşi yok).
   *
   * Reddedilen kayıt hiçbir şeyi yamamaz: ret `await`ten fırlar ve editöre
   * ulaşır (editör hatayı gösterir, metin taslakta kalır).
   *
   * Özel not bu yoldan GEÇMEZ ve geçmemeli: onun tek yazma yolu
   * `useSeansNotlari` içinde, ayrı uç noktada (yalnızca izinli üç dosyada
   * geçebilir — `istemciRaporUretimi.test.ts`).
   */
  async function seansNotuKaydet(id: number, kayit: { sablon: string; icerik: string }) {
    const yeni = await notApi.notKaydet(id, kayit.sablon, kayit.icerik)
    seansAkisi.notYansit(id, yeni)
    dosyaNotu.notYansit(id, yeni)
    seanslar.yamala(id, { not_ilk_satiri: yeni.onizleme })
  }

  /**
   * Etiket eklemenin TEK yolu (bkz. modül başlığı "Etiket yazmaları"). Takvim
   * paneli de dosya da buraya gelir; sonuç seansın ortak etiket önbelleğine,
   * sözlüğe ve dosyanın seans listesindeki satıra aynı çağrıdan yayılır.
   * Ret (400, 404, ağ) hiçbir şeyi yamamaz: `await`ten fırlar ve
   * `EtiketSatiri`'na ulaşır.
   */
  async function etiketEkle(appointmentId: number, ad: string) {
    let etiket: Etiket
    try {
      etiket = await etiketApi.etiketEkle(appointmentId, ad)
    } catch (e) {
      if (e instanceof YetkisizHata) etiketler.yetkisiz()
      // Hata SEANSA bağlı tutulur (inceleme M6): Enter'dan sonra seans
      // değiştiyse satır sökülmüştür; terapist seansa dönünce görür.
      else etiketler.yazmaHatasiKaydet(appointmentId, yazmaHataMetni(`"${ad}" etiketi eklenemedi.`, e))
      throw e
    }
    const adlar = etiketler.eklendi(appointmentId, etiket)
    if (adlar !== null) seanslar.yamala(appointmentId, { etiketler: adlar })
  }

  /** Etiket kaldırmanın TEK yolu; `etiketEkle` ile aynı yayılım. */
  async function etiketKaldir(appointmentId: number, etiket: Etiket) {
    try {
      await etiketApi.etiketKaldir(appointmentId, etiket.id)
    } catch (e) {
      if (e instanceof YetkisizHata) etiketler.yetkisiz()
      else
        etiketler.yazmaHatasiKaydet(
          appointmentId,
          yazmaHataMetni(`"${etiket.ad}" etiketi kaldırılamadı.`, e),
        )
      throw e
    }
    const adlar = etiketler.kaldirildi(appointmentId, etiket)
    if (adlar !== null) seanslar.yamala(appointmentId, { etiketler: adlar })
  }

  /**
   * Takvimin üç randevu yazması (bkz. modül başlığı "Takvimin randevu
   * yazmaları"). Yayılım yalnızca BAŞARIDA: ret `await`ten fırlar, panel
   * (`RandevuPaneli`) hatayı gösterir, etiket paneli yeniden okunmaz.
   *
   * Görev 2 inceleme IMPORTANT-1/IMPORTANT-2: üçü de `AyOzeti`'nin saydığı
   * rakamları (gelinen seans, tahsilat, bekleyen) ve açık danışan kartının
   * bakiyesini değiştirebilir — oluşturma/güncelleme (ücret/danışan/saat
   * dahil), silme ve seri iptali. `setOzetTazeleme` özeti (açıksa, TEK
   * `GET /api/ay-ozeti` ile) tazeler; `dosya.randevularTazele` kartın
   * randevu penceresini (`clients::getir` DEĞİL, yalnızca
   * `takvimApi.randevulariGetir`) — bkz. `useDanisanDosyasi.randevularTazele`
   * gerekçesi. `durumDegis`/`odemeDegis`teki TEK ALAN yamasından farklı:
   * burada satır ekleniyor/çıkıyor/taşınıyor ya da ücret gibi henüz kartın
   * yama tipinde OLMAYAN bir alan değişiyor, bu yüzden yama değil yeniden
   * çekme.
   *
   * İstisna — son temas (Plan A Görev 9, tasarım A4): taşınan "geldi"
   * seansının PUT yanıtı `son_temas`/`saklama_bitis` taşıyorsa bu iki alan
   * `durumDegis`teki gibi YAMANIR (yeniden çekilemezler, bkz. fonksiyon
   * içi). Ölçen testler: `AnaEkran.yayilim.test.tsx` > "Plan A Görev 9".
   */
  async function randevuKaydet(kayit: Parameters<typeof takvim.kaydet>[0]) {
    // Düzenleme kipinde ESKİ danışan (taşıma iki dosyayı birden değiştirir);
    // yeni kayıtta seçili randevu yok, yalnızca `kayit.client_id`.
    const eskiDanisan = takvim.seciliRandevu?.client_id ?? null
    const yanit = await takvim.kaydet(kayit)
    etiketler.randevularDegisti()
    seanslar.yapiDegisti([kayit.client_id, eskiDanisan])
    dosya.randevularTazele([kayit.client_id, eskiDanisan])
    setOzetTazeleme((n) => n + 1)
    // Tasarım A4: taşınan "geldi" seansı son temas ilerlettiyse kart ve
    // saklama listesi YEREL yamanır (`durumDegis` ile aynı gerekçe: ikisi de
    // `HerCagri`, yeniden çekilmez).
    if (yanit && yanit.son_temas !== undefined && yanit.saklama_bitis !== undefined) {
      dosya.dosyaAlanlariniYama(yanit.client_id, {
        son_temas: yanit.son_temas,
        saklama_bitis: yanit.saklama_bitis,
      })
      liste.saklamaDolandanDus(yanit.client_id, yanit.saklama_bitis)
    }
  }

  async function randevuSil(id: number) {
    // Silinen randevunun danışanı İSTEKTEN ÖNCE okunuyor: başarıdan sonra
    // kayıt listeden kalkıyor. Bulunamazsa `null` — "bilinmiyor", liste yine
    // bayat sayılır.
    const danisan = takvim.randevular.find((r) => r.id === id)?.client_id ?? null
    await takvim.sil(id)
    etiketler.randevularDegisti()
    seanslar.yapiDegisti([danisan])
    dosya.randevularTazele([danisan])
    setOzetTazeleme((n) => n + 1)
  }

  async function randevuSeriSil(seriId: string, buTarihtenItibaren: string) {
    // Seri tek danışanın; panel serinin bir üyesiyle açık.
    const danisan =
      takvim.seciliRandevu?.seri_id === seriId ? takvim.seciliRandevu.client_id : null
    await takvim.seriSil(seriId, buTarihtenItibaren)
    etiketler.randevularDegisti()
    seanslar.yapiDegisti([danisan])
    dosya.randevularTazele([danisan])
    setOzetTazeleme((n) => n + 1)
  }

  /**
   * Not sayfasının diğer seanslar panelinin listesi (Görev 8, preflight F7):
   * danışan dosyasının seans listesi (`useDanisanSeanslari`) AYNI danışan
   * için yüklü, hatasız ve taze ise o liste; değilse `null` ve panel TEK
   * istek atar. Her `/seanslar` okuması silinemez bir `Goruntuleme` satırı;
   * dosyanın listesi tek yazma yolundan (not, durum, ödeme, etiket) zaten
   * yamanıyor. Bayat liste (`yuklendi === false`) verilmez: silinen ya da
   * taşınan bir seans panelde görünürdü.
   */
  function seansListesiOnbellegi(clientId: number): DanisanSeansi[] | null {
    return dosya.seciliDanisanId === clientId && seanslar.yuklendi && seanslar.hata === null
      ? seanslar.seanslar
      : null
  }

  /**
   * Bir seansın `EtiketSatiri` bağlamı. İki ekran da BUNU çağırıyor: aynı
   * önbellek girdisi (`seansDurumu`), aynı yazma yolu.
   */
  function etiketBaglami(appointmentId: number): EtiketBaglami {
    const durum = etiketler.seansDurumu(appointmentId)
    return {
      etiketler: durum.liste,
      hata: durum.hata,
      onYenidenDene: () => etiketler.yenidenDene(appointmentId),
      sozluk: etiketler.sozluk,
      onSozlukIste: etiketler.sozlukIste,
      onEkle: (ad) => etiketEkle(appointmentId, ad),
      onKaldir: (etiket) => etiketKaldir(appointmentId, etiket),
      onEtiketAc: etiketler.etiketAc,
      yazmaHatasi: etiketler.yazmaHatasi(appointmentId),
      onYazmaHatasiTemizle: () => etiketler.yazmaHatasiKaydet(appointmentId, null),
    }
  }

  /**
   * Sekme değişimi. Etiketli seanslar paneli Ayarlar'a geçince KAPANIR
   * (inceleme M4, kontrol kararı): Ayarlar ekranında başka danışanların adları
   * kalmamalı. Takvim ↔ Danışanlar arasında açık kalır — terapist aynı
   * etiketin seansları arasında gezinirken sekme değişiyor (`danisanaGit`).
   */
  function sekmeSec(yeni: SekmeKodu) {
    if (yeni === 'ayarlar') etiketler.etiketKapat()
    setSekme(yeni)
  }

  function veriRaporuIndir(danisanId: number, parola: string): Promise<void> {
    return danisanApi.veriRaporuIndir(danisanId, parola, yerelGun(new Date()))
  }

  // Ayarlar sekmesinde çıkacak uyarı noktası (bkz. `kabuk/Sekmeler.tsx`
  // modül başlığı — tasarım §4: "hiç yedek alınmamışsa bu bir sarı kutu
  // olarak ana ekranı işgal etmez, Ayarlar sekmesinde bir nokta olarak
  // durur"). `yedekleme.yedek === null`: henüz hiç yanıt gelmedi YA DA klasör
  // hiç seçilmedi; `yedekler.length === 0`: klasör seçili ama liste boş —
  // ikisi de "şu an güvenilir bir yedek yok" anlamına gelir ve nokta AYNI
  // şekilde görünür.
  const yedekYok = yedekleme.yedek === null || yedekleme.yedek.yedekler.length === 0
  // IMPORTANT-4 düzeltmesi: nokta yalnızca "hiç yedek yok" durumunu değil,
  // "yedekler var ama BUGÜNKÜ otomatik yedek BAŞARISIZ oldu" durumunu da
  // kapsamalı. Tasarım §7: "Yedek alınamazsa (disk dolu, klasör erişilemez)
  // ana ekranda KALICI uyarı çıkar; sessiz geçilmez." Yedekleme artık
  // Ayarlar sekmesinin İÇİNDE olduğu için bu uyarı Takvim'den GÖRÜNMEZ —
  // nokta onun yerini tutmalı, yoksa terapist Ayarlar'ı açmadıkça disk dolu
  // uyarısından habersiz kalır.
  const ilgilenilmesiGereken = yedekYok || yedekleme.uyari !== null
  // KAYIT İÇİN (bilinçli kapsam dışı bırakma): nokta `liste.saklamaDolanlar`ı
  // KASITLI OLARAK kapsamıyor. Noktanın bunu bilebilmesi için saklama
  // listesinin AÇILIŞTA (Ayarlar'a hiç girilmeden) sorgulanması gerekirdi —
  // tam da IMPORTANT-3'ün kapattığı SİLİNEMEZ görüntüleme kaydını geri
  // getirir. Hatırlatma yalnızca Ayarlar'da, kullanıcı oraya gittiğinde
  // görünür; "noktaya saklamayı da ekleyelim" IMPORTANT-3'ü YENİDEN AÇAR.

  return (
    <div className="p-8">
      {/* Tasarım §4: "Üstte tek satır: uygulama adı, sekmeler, sağda
          `Kilitle`." Kilitle eskiden yalnızca Takvim sekmesinin içindeydi
          (son inceleme I1): risk notu ya da açık bir dosya ekrandayken
          kilitlemek için önce Takvim'e geçmek gerekiyordu. Kabuğun satırında
          olduğu için artık HER sekmede erişilebilir. */}
      <div className="mb-4 flex items-center gap-6">
        <h1 className="text-2xl font-semibold">Terapi Notları</h1>
        <Sekmeler
          secili={sekme}
          onSecim={sekmeSec}
          uyaran={ilgilenilmesiGereken ? 'ayarlar' : undefined}
        />
        <button type="button" className="ml-auto rounded-lg border px-4 py-2" onClick={kilitle}>
          Kilitle
        </button>
      </div>

      {/* Etiketli seanslar sekme panellerinin DIŞINDA (bkz. `EtiketliSeanslar`
          modül başlığı): bir satırdan dosyaya geçilince açık kalır. Satır
          tıklaması danışana giden TEK yoldan (`danisanaGit`) geçer. */}
      {etiketler.acik !== null && (
        <EtiketliSeanslar
          key={`etiketli-${etiketler.acik.etiket.id}`}
          acik={etiketler.acik}
          onSeansAc={(clientId, appointmentId) => danisanaGit(clientId, appointmentId)}
          onKapat={etiketler.etiketKapat}
          onYenidenDene={etiketler.acikYenidenDene}
        />
      )}

      {sekme === 'takvim' && (
        <div
          role="tabpanel"
          id="sekme-panel-takvim"
          aria-labelledby="sekme-takvim"
          className="mt-4"
        >
          {/* Takvim ürünün asıl işi (Görev 3 ürün kararı). Hızlı arama ve ay
              özeti düğmesi bu bileşenin İÇİNDE — bkz. `TakvimSekmesi.tsx`
              modül başlığı. Kilitle kabuğun üst satırında (yukarıda). */}
          <TakvimSekmesi
            takvim={takvim}
            seansAkisi={seansAkisi}
            ozet={{ bugun: yerelGun(new Date()), disTazeleme: ozetTazeleme }}
            danisanlar={liste.danisanlar}
            onDanisanAc={danisanaGit}
            onDurumDegis={durumDegis}
            onOdemeDegis={odemeDegis}
            onRandevuKaydet={randevuKaydet}
            onRandevuSil={randevuSil}
            onSeriSil={randevuSeriSil}
            etiketBaglami={etiketBaglami}
            onEtiketAc={etiketler.etiketAc}
            seansListesiOnbellegi={seansListesiOnbellegi}
          />
        </div>
      )}

      {sekme === 'danisanlar' && (
        <div
          role="tabpanel"
          id="sekme-panel-danisanlar"
          aria-labelledby="sekme-danisanlar"
          className="mt-4"
        >
          <DanisanlarSekmesi
            liste={liste}
            dosya={dosya}
            seanslar={seanslar}
            dosyaNotu={dosyaNotu}
            altSekme={dosyaAltSekme}
            onAltSekme={setDosyaAltSekme}
            onDanisanSec={(id) => danisanaGit(id)}
            veriRaporuIndir={veriRaporuIndir}
            onNotKaydet={seansNotuKaydet}
            onDurumDegis={durumDegis}
            onOdemeDegis={odemeDegis}
            etiketBaglami={etiketBaglami}
          />
        </div>
      )}

      {sekme === 'ayarlar' && (
        <div
          role="tabpanel"
          id="sekme-panel-ayarlar"
          aria-labelledby="sekme-ayarlar"
          className="mt-4"
        >
          {/* Yedekleme, parola, depolama ve saklama panelleri Ayarlar
              sekmesinde (Görev 2, ürün kararı: asıl iş olan takvim en altta
              kalıyordu). Kancalar burada kalıyor — yalnızca prop olarak
              geçiriliyor — çünkü 401 temizliği bu dosyada bağlanıyor (bkz.
              modül başlığı). */}
          <AyarlarSekmesi
            yedekleme={yedekleme}
            parola={parola}
            saklama={{ dolanlar: liste.saklamaDolanlar, onAc: (id) => danisanaGit(id) }}
            depolama={dosya.depolama}
            onGeriYukle={onGeriYukle}
            denetim={denetim}
          />
        </div>
      )}
    </div>
  )
}
