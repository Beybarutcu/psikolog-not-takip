import { useState } from 'react'
import { danisanApi, notApi } from '../api'
import { AyarlarSekmesi } from '../ayarlar/AyarlarSekmesi'
import type { DosyaAltSekme } from '../danisan/DanisanDosyasi'
import { DanisanlarSekmesi } from '../danisan/DanisanlarSekmesi'
import { Sekmeler } from '../kabuk/Sekmeler'
import { ACILIS_SEKMESI, type SekmeKodu } from '../kabuk/sekme'
import { notOnizlemesi } from '../seans/onizleme'
import { TakvimSekmesi } from '../takvim/TakvimSekmesi'
import { useDanisanDosyasi } from './anaEkranKancalari/useDanisanDosyasi'
import { useDanisanListesi } from './anaEkranKancalari/useDanisanListesi'
import { useDanisanSeanslari } from './anaEkranKancalari/useDanisanSeanslari'
import { useDosyaNotu } from './anaEkranKancalari/useDosyaNotu'
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
 *   - `useSeansNotlari`    — açık seansın resmî notu, geçmişi ve özel notu
 *   - `useDanisanDosyasi`  — açık danışan kartı, ekleri ve depolama durumu
 *   - `useDanisanListesi`  — danışan listesi, ekleme, arşivleme, saklama uyarısı
 *   - `useDanisanSeanslari`— açık danışanın Seanslar alt sekmesindeki listesi,
 *                            seçili seansı ve yamaları
 *   - `useDosyaNotu`       — danışan dosyasında seçili seansın resmî notu
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
 */
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

  // `dosya` aşağıda tanımlanıyor; closure çağrıldığı anda okunuyor, bu
  // yüzden kancaların bildirim sırası bir kısıt değil (bkz. modül başlığı).
  const takvim = useTakvimAkisi({ onYetkisiz: () => dosya.kapat() })
  // IMPORTANT-3 düzeltmesi: saklama süresi dolanlar isteği yalnızca Ayarlar
  // sekmesi GÖRÜNÜRKEN atılır. `clients::saklama_suresi_dolanlar` her
  // çağrıda `LogHacmi::HerCagri` ile SİLİNEMEZ bir `goruntuleme` satırı
  // yazıyor (bkz. `useDanisanListesi.ts` modül başlığı); veri artık yalnızca
  // Ayarlar sekmesinde gösterildiği için terapist Ayarlar'ı hiç açmasa bile
  // mount'ta atılan bir istek kalıcı, hiç görülmeyecek bir kayıt bırakırdı.
  const liste = useDanisanListesi({ ayarlarGorunur: sekme === 'ayarlar' })
  const dosya = useDanisanDosyasi({ onYetkisiz: () => takvim.oturumKapandi() })
  const seanslar = useDanisanSeanslari({
    clientId: dosya.seciliDanisanId,
    onYetkisiz: () => takvim.oturumKapandi(),
  })
  // Danışan dosyasının alt sekmesi (Seanslar/Bilgiler). BURADA, bileşende
  // değil (son inceleme M1): `DanisanDosyasi` sekme gidip gelince yeniden
  // monte oluyor ve kendi state'inde tutulan alt sekme her girişte
  // sıfırlanıyordu.
  const [dosyaAltSekme, setDosyaAltSekme] = useState<DosyaAltSekme>('seanslar')
  // Dosyada seçili seansın notu. İstek YALNIZCA görünürken (bkz.
  // `useDosyaNotu` başlığı): Danışanlar sekmesi + Seanslar alt sekmesi + kart
  // yüklenmiş (dosya bileşeni kart yüklenmeden hiç çizilmiyor; çizilmeyen bir
  // not için silinemez görüntüleme kaydı bırakılmamalı).
  const dosyaNotu = useDosyaNotu({
    appointmentId: seanslar.seciliSeansId,
    gorunur:
      sekme === 'danisanlar' &&
      dosyaAltSekme === 'seanslar' &&
      dosya.kart.dosya !== null &&
      dosya.kart.hata === null,
  })
  const yedekleme = useYedekleme()
  const seansAkisi = useSeansNotlari({
    randevu: takvim.seciliRandevu,
    onYetkisiz: () => takvim.oturumKapandi(),
    notYaz: seansNotuKaydet,
  })
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
    // görüntüleme satırı daha bırakırdı.
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

  /**
   * Aramadan seçilen seansa gider: hafta değişir, seçim `useTakvimAkisi`
   * içinde SUNUCUDAN GELEN listeden kurulur (bkz. `bekleyenSeans`).
   *
   * Açık danışan kartı burada kapatılıyor: kartın state'i başka bir kancada
   * ve gidilen seans başka bir danışana ait olabilir. Sekme DEĞİŞTİRİLMİYOR:
   * hızlı arama yalnızca `TakvimSekmesi`nin İÇİNDE render ediliyor (bkz. o
   * dosyadaki `HizliArama` çağrısı), yani bu fonksiyon zaten yalnızca Takvim
   * sekmesi açıkken tetiklenebilir.
   */
  function seansaGit(appointmentId: number, tarih: string) {
    takvim.seansaGit(appointmentId, tarih)
    dosya.kapat()
  }

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
   */
  //
  // Son inceleme C2: danışan dosyasının alt satırı da BU iki fonksiyonu
  // çağırıyor (eskiden `takvimApi`'yi doğrudan çağırıp yalnızca kendi yerel
  // yamasını tutuyordu). Dosyanın seans listesi (`seanslar.yamala`) de aynı
  // çağrıdan besleniyor — hangi ekrandan işaretlenirse işaretlensin takvim,
  // kart, ay özeti ve dosya listesi aynı değeri gösterir.
  async function durumDegis(id: number, durum: string) {
    await takvim.durumDegis(id, durum)
    dosya.randevuYamala(id, { durum })
    seanslar.yamala(id, { durum })
    setOzetTazeleme((n) => n + 1)
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
   *                              sunucuyla AYNI kural: `seans/onizleme.ts`).
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
    seanslar.yamala(id, { not_ilk_satiri: notOnizlemesi(yeni.icerik) })
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
          onSecim={setSekme}
          uyaran={ilgilenilmesiGereken ? 'ayarlar' : undefined}
        />
        <button type="button" className="ml-auto rounded-lg border px-4 py-2" onClick={kilitle}>
          Kilitle
        </button>
      </div>

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
            onSeansSec={seansaGit}
            onDurumDegis={durumDegis}
            onOdemeDegis={odemeDegis}
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
          />
        </div>
      )}
    </div>
  )
}
