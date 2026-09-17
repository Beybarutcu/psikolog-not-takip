import { useState } from 'react'
import { aramaApi, danisanApi, takvimApi } from '../api'
import { HizliArama } from '../arama/HizliArama'
import { AyarlarSekmesi } from '../ayarlar/AyarlarSekmesi'
import { DanisanKarti } from '../danisan/DanisanKarti'
import { AyOzeti } from '../ozet/AyOzeti'
import { SeansAltSatiri } from '../seans/SeansAltSatiri'
import { SeansPaneli } from '../seans/SeansPaneli'
import { HaftalikTakvim } from '../takvim/HaftalikTakvim'
import { RandevuPaneli } from '../takvim/RandevuPaneli'
import { useDanisanDosyasi } from './anaEkranKancalari/useDanisanDosyasi'
import { useDanisanListesi } from './anaEkranKancalari/useDanisanListesi'
import { useParolaFormu } from './anaEkranKancalari/useParolaFormu'
import { useSeansNotlari } from './anaEkranKancalari/useSeansNotlari'
import { useTakvimAkisi } from './anaEkranKancalari/useTakvimAkisi'
import { useYedekleme } from './anaEkranKancalari/useYedekleme'
import { yerelGun } from './anaEkranKancalari/yerelGun'

/**
 * Ana ekran: takvim, danışan listesi, danışan kartı, seans paneli, yedekleme
 * ve parola bölümlerini bir arada tutar.
 *
 * # Veri akışları KANCALARDA, ekran yalnızca bağlıyor
 *
 * Beş ayrı yükleme akışı var ve her birinin kendi yaşam döngüsü kuralları
 * (`store::audit` hacim politikası yüzünden hangi isteğin ne zaman
 * atılabileceği, 401'de neyin ekrandan silineceği, geciken yanıtların hangi
 * state'i ezmeyeceği). Hepsi tek bir bileşende dokuz `useEffect` olarak
 * durduğunda bir akışın kuralını okumak için diğer dördünü de okumak
 * gerekiyordu. Ayrım akış başına:
 *
 *   - `useTakvimAkisi`   — görünen haftanın randevuları ve SEÇİM (omurga)
 *   - `useSeansNotlari`  — açık seansın resmî notu, geçmişi ve özel notu
 *   - `useDanisanDosyasi`— açık danışan kartı, ekleri ve depolama durumu
 *   - `useDanisanListesi`— danışan listesi, ekleme, arşivleme, saklama uyarısı
 *   - `useYedekleme`     — otomatik/elle yedek ve KALICI uyarı
 *   - `useParolaFormu`   — parola değiştirme (yükleme değil, ama kendi başına
 *                          bir akış; parolalar form kapanınca siliniyor)
 *
 * # 401 temizliği İKİ YÖNLÜ ve bu yüzden burada bağlanıyor
 *
 * Takvim yüklemesi 401 alırsa açık danışan kartı da kapanmalı; seans ve
 * danışan akışları 401 alırsa takvim seçimi kapanmalı. İki kanca birbirini
 * doğrudan göremez, dolayısıyla bağ burada, geri çağrılarla kuruluyor.
 * Kancalar bu geri çağrıları içeride bir `ref`te tutuyor — böylece efekt
 * bağımlılıkları İLKEL kimliklerle sınırlı kalıyor ve her render yeni bir
 * istek atmıyor (silinemez `goruntuleme` satırları).
 *
 * Temizliğin KAPSAMI akışa göre farklı ve bilerek öyle: seans/özel not 401'i
 * yalnızca takvim seçimini kapatır (açık kart hassas veri göstermiyor
 * demek değil — kart kendi isteğini attığında kendi 401'ini alır), takvim ve
 * kart 401'i ikisini birden kapatır.
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
  // `dosya` aşağıda tanımlanıyor; closure çağrıldığı anda okunuyor, bu
  // yüzden kancaların bildirim sırası bir kısıt değil (bkz. modül başlığı).
  const takvim = useTakvimAkisi({ onYetkisiz: () => dosya.kapat() })
  const liste = useDanisanListesi()
  const dosya = useDanisanDosyasi({ onYetkisiz: () => takvim.oturumKapandi() })
  const yedekleme = useYedekleme()
  const seansAkisi = useSeansNotlari({
    randevu: takvim.seciliRandevu,
    onYetkisiz: () => takvim.oturumKapandi(),
  })
  const parola = useParolaFormu()
  // Ay sonu özeti KAPALI başlar: sunucu her görüntülemeyi denetim kaydına
  // yazıyor ve açılışta kendiliğinden istek atan bir özet, terapistin hiç
  // bakmadığı bir görüntülemeyi silinemez biçimde kaydederdi.
  const [ozetAcik, setOzetAcik] = useState(false)
  // Açık özetin DIŞARIDAN tazelenme sayacı (dal incelemesi I1). Kart
  // bakiyesi durum/ödeme yazmasından sonra yerelde yamanıyor; özet ise
  // yalnızca ay değişince istek atıyordu — özet açıkken "Ödendi" işaretlenince
  // kart `0,00 TL`, özet aynı borcu hâlâ gösteriyordu. Özet kapalıyken sayaç
  // artsa da istek GİTMEZ: `AyOzeti` monte değil, açıldığında zaten tek bir
  // taze istek atar.
  const [ozetTazeleme, setOzetTazeleme] = useState(0)

  const { seciliRandevu, seciliBosSaat } = takvim
  const { seciliDanisanId, kart } = dosya
  const seans = seansAkisi.seans
  // Yerel değişkene alınıyor: `liste.arsivOnayi` üzerinden daralan tür bir
  // callback'in içine taşınmaz (TS özelliği bir yana, onay metniyle
  // "Evet, arşivle"nin AYNI danışanı görmesi bu satırla garanti).
  const { arsivOnayi } = liste

  function danisanKartiAc(clientId: number) {
    liste.setArsivBilgisi(null)
    dosya.ac(clientId)
  }

  /**
   * Aramadan seçilen seansa gider: hafta değişir, seçim `useTakvimAkisi`
   * içinde SUNUCUDAN GELEN listeden kurulur (bkz. `bekleyenSeans`).
   *
   * Açık danışan kartı burada kapatılıyor: kartın state'i başka bir kancada
   * ve gidilen seans başka bir danışana ait olabilir.
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
  async function durumDegis(id: number, durum: string) {
    await takvim.durumDegis(id, durum)
    dosya.randevuYamala(id, { durum })
    setOzetTazeleme((n) => n + 1)
  }

  async function odemeDegis(id: number, odendi: boolean) {
    await takvim.odemeDegis(id, odendi)
    dosya.randevuYamala(id, { odendi })
    setOzetTazeleme((n) => n + 1)
  }

  function veriRaporuIndir(danisanId: number, parola: string): Promise<void> {
    return danisanApi.veriRaporuIndir(danisanId, parola, yerelGun(new Date()))
  }

  return (
    <div className="p-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Terapi Notları</h1>
        <div className="flex items-center gap-2">
          {/* Hızlı arama her zaman monte: Ctrl+K dinleyicisi bileşenin
              kendi içinde. Kapalıyken yalnızca kısayolu duyuran bir düğme
              basar; hiçbir istek atmaz. */}
          <HizliArama
            ara={aramaApi.ara}
            onDanisanSec={danisanKartiAc}
            onSeansSec={seansaGit}
          />
          <button
            type="button"
            className="rounded-lg border px-4 py-2"
            aria-expanded={ozetAcik}
            onClick={() => setOzetAcik((acik) => !acik)}
          >
            Ay sonu özeti
          </button>
          <button className="rounded-lg border px-4 py-2" onClick={kilitle}>
            Kilitle
          </button>
        </div>
      </div>

      {/* Borçlu satırı GERÇEK danışan kartını açar: danışan çipiyle aynı
          `danisanKartiAc` yolu (`AnaEkran.test.tsx` "ay sonu ozeti" bloğu
          kartın isteğini ölçer). */}
      {ozetAcik && (
        <AyOzeti
          bugun={yerelGun(new Date())}
          disTazeleme={ozetTazeleme}
          onDanisanAc={danisanKartiAc}
        />
      )}

      <div className="mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-600">Danışanlar</span>
          <button
            className="rounded border px-3 py-1 text-sm"
            onClick={() => liste.setFormAcik((acik) => !acik)}
          >
            Danışan ekle
          </button>
        </div>

        {liste.formAcik && (
          <div className="mt-2 flex items-end gap-2">
            <div>
              <label className="block text-sm" htmlFor="yeni-danisan-ad-soyad">
                Ad soyad
              </label>
              <input
                id="yeni-danisan-ad-soyad"
                className="mt-1 rounded border p-2"
                value={liste.yeniAdSoyad}
                onChange={(e) => liste.setYeniAdSoyad(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm" htmlFor="yeni-danisan-telefon">
                Telefon
              </label>
              <input
                id="yeni-danisan-telefon"
                className="mt-1 rounded border p-2"
                value={liste.yeniTelefon}
                onChange={(e) => liste.setYeniTelefon(e.target.value)}
              />
            </div>
            <button
              className="rounded bg-slate-900 px-3 py-2 text-sm text-white"
              onClick={() => void liste.ekle()}
            >
              Ekle
            </button>
          </div>
        )}

        {liste.hata && <p className="mt-1 text-sm text-red-600">{liste.hata}</p>}
        {/* `role="status"`: arşivleme sonucu ekranda sessizce beliriyordu.
            Ekran okuyucu kullanıcısı düğmeye bastıktan sonra hiçbir şey
            duymuyor, danışanın listeden düşmesini de göremiyordu. Kibar
            (`polite`) duyuru, kullanıcının o an yazdığı şeyi kesmeden işlemin
            olduğunu söyler. */}
        {liste.arsivBilgisi && (
          <p role="status" className="mt-1 text-sm text-slate-600">
            {liste.arsivBilgisi}
          </p>
        )}

        {liste.danisanlar.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2 text-sm text-slate-700">
            {liste.danisanlar.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1"
              >
                {/* Erişilebilir ad "Ayşe Yılmaz dosyasını aç": takvimdeki
                    randevu bloğunun adı düz "Ayşe Yılmaz" ve iki özdeş adlı
                    düğme hem ekran okuyucu kullanıcısını hem de ada göre
                    arayan testleri belirsiz bırakırdı (aynı gerekçe
                    yanındaki "Arşivle" düğmesinde). */}
                <button
                  type="button"
                  className="underline"
                  aria-label={`${d.ad_soyad} dosyasını aç`}
                  onClick={() => danisanKartiAc(d.id)}
                >
                  {d.ad_soyad}
                </button>
                {/* Erişilebilir ad danışanın ADINI taşır. Önceki hâlinde her
                    satırdaki düğmenin adı yalnızca "Arşivle" idi: listede on
                    danışan varken ekran okuyucu kullanıcısı on özdeş düğme
                    duyuyor, hangisinin kime ait olduğunu yalnızca GÖRSEL
                    bağlamdan (yanındaki isim) çıkarabiliyordu -- bu, yıkıcı
                    bir işlemde kabul edilemez.
                    Eski gerekçe (takvimdeki randevu düğmesiyle ad çakışması)
                    burada geçerli değil: randevu bloğunun erişilebilir adı
                    düz "Ayşe Yılmaz", buranınki "Ayşe Yılmaz adlı danışanı
                    arşivle" -- ad ile arama yapan testler ve kullanıcı ikisini
                    ayırt eder. Görünen metin kısa kalıyor (`Arşivle`); değişen
                    yalnızca erişilebilir ad. */}
                <button
                  type="button"
                  className="text-slate-500 underline disabled:opacity-50"
                  aria-label={`${d.ad_soyad} adlı danışanı arşivle`}
                  title="Danışanı arşivle"
                  disabled={liste.arsivSuruyor}
                  onClick={() => {
                    liste.setArsivBilgisi(null)
                    liste.setArsivOnayi(d)
                  }}
                >
                  Arşivle
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* İki adımlı onay. Metin ne olduğunu ve ne OLMADIĞINI birlikte
            söylüyor: kullanıcı ne "sildim, gitti" ne de "hiçbir şey olmadı"
            sanmalı. */}
        {arsivOnayi && (
          <div className="mt-2 rounded bg-amber-50 p-2">
            <p className="text-sm text-amber-900">
              {arsivOnayi.ad_soyad} arşivlensin mi? Danışan listeden ve randevu seçiminden
              kaldırılır. Geçmiş randevuları, notları ve dosyaları silinmez — kayıtlar
              durmaya devam eder, yalnızca listede görünmez.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                className="rounded bg-amber-700 px-3 py-1 text-sm text-white disabled:opacity-50"
                disabled={liste.arsivSuruyor}
                onClick={() => void liste.arsivle(arsivOnayi)}
              >
                Evet, arşivle
              </button>
              <button
                className="rounded border px-3 py-1 text-sm"
                disabled={liste.arsivSuruyor}
                onClick={() => liste.setArsivOnayi(null)}
              >
                Vazgeç
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Yedekleme, parola, depolama ve saklama panelleri Ayarlar sekmesine
          taşındı (Görev 2, ürün kararı: asıl iş olan takvim en altta
          kalıyordu). Kancalar burada kalıyor — yalnızca prop olarak
          geçiriliyor — çünkü 401 temizliği iki yönlü ve bu dosyada bağlanıyor
          (bkz. modül başlığı). Sekme geçişi henüz bağlı değil (Görev 3-8'de
          bağlanacak); bu bileşen şimdilik eskisiyle aynı yerde çiziliyor. */}
      <AyarlarSekmesi
        yedekleme={yedekleme}
        parola={parola}
        saklama={{ dolanlar: liste.saklamaDolanlar, onAc: danisanKartiAc }}
        depolama={dosya.depolama}
        onGeriYukle={onGeriYukle}
      />

      {takvim.hata && <p className="mb-4 text-sm text-red-600">{takvim.hata}</p>}

      <div className="flex items-start gap-4">
        <div className="flex-1">
          <HaftalikTakvim
            randevular={takvim.randevular}
            haftaBasi={takvim.haftaBasi}
            onHaftaDegis={takvim.haftaDegis}
            onRandevuSec={takvim.randevuSec}
            onBosSaatSec={takvim.bosSaatSec}
          />
        </div>

        {takvim.panelAcik && (
          <RandevuPaneli
            // Seçim değişince (başka bir randevu ya da boş saat) bileşen
            // yeniden mount edilmeli — aksi hâlde panelin iç state'i (silme
            // onayı, doldurulmuş form alanları) önceki seçimden yeni seçime
            // sızar (bkz. Görev 10 inceleme Bulgu 1). `key` kimliği seçili
            // randevunun ya da seçili boş saatin kimliğine bağlanıyor.
            key={seciliRandevu ? `randevu-${seciliRandevu.id}` : `bos-${seciliBosSaat}`}
            zaman={seciliBosSaat ?? seciliRandevu?.baslangic ?? ''}
            randevu={seciliRandevu}
            danisanlar={liste.danisanlar}
            onKaydet={takvim.kaydet}
            onSil={takvim.sil}
            onSeriSil={takvim.seriSil}
            seriSayisiAl={takvimApi.seriSayisi}
            silinecekNotSayisiAl={takvimApi.silinecekNotSayisi}
            onKapat={takvim.panelKapat}
            cakismaKontrol={takvimApi.cakismaKontrol}
          />
        )}
      </div>

      {seciliDanisanId !== null &&
        (kart.hata !== null ? (
          // Yükleme başarısızsa kart AÇILMAZ: yarı dolu bir danışan kartı
          // (rıza alanı boş görünen) "rıza alınmamış" diye okunurdu.
          <div role="alert" className="mt-4 rounded border border-red-300 bg-red-50 p-3">
            <p className="text-sm text-red-800">Danışan dosyası yüklenemedi. {kart.hata}</p>
            <button
              type="button"
              className="mt-2 rounded border border-red-300 px-2 py-1 text-sm"
              onClick={dosya.yenidenDene}
            >
              Yeniden dene
            </button>
          </div>
        ) : (
          kart.dosya !== null && (
            <DanisanKarti
              // İKİNCİL HAT — bugün ULAŞILAMAZ, bilerek duruyor.
              //
              // Birincil hat `useDanisanDosyasi`'ndeki `kart` türetmesi + bu
              // koşullu render: danışan değişince `kart.dosya` `null` olur ve
              // kart zaten UNMOUNT edilir, yani bu `key` hiçbir zaman
              // değişerek bir remount tetiklemez (kaldırıldığında hiçbir test
              // kırılmaz — ölçülmüş). Birincil hattın ölçüldüğü yer:
              // `AnaEkran.test.tsx` > "baska danisana gecince onceki kartin
              // verisi EKRANDA KALMAZ".
              //
              // Satır yine de duruyor: türetme bir gün "kartı monte tut,
              // yalnızca içeriği değiştir" biçiminde gevşetilirse `key` o
              // anda yük taşımaya başlar ve maliyeti sıfır. Sentetik
              // `rerender` testleri (`DanisanKarti.test.tsx` > "ikincil
              // hat") tam olarak o senaryoyu ölçüyor.
              key={`danisan-${kart.dosya.id}`}
              danisan={kart.dosya}
              ekler={kart.ekler}
              randevular={kart.randevular}
              bugun={yerelGun(new Date())}
              veriRaporuIndir={veriRaporuIndir}
              ekYukle={dosya.ekYukle}
              ekSil={dosya.ekSil}
              onRizaKaydet={dosya.rizaKaydet}
              onKapat={dosya.kapat}
            />
          )
        ))}

      {/* Seans paneli YALNIZCA mevcut bir randevu seçiliyken açılır: boş bir
          saatte henüz bir `appointment_id` yok ve not ona bağlanır. */}
      {seciliRandevu !== null &&
        (seans.hata === null ? (
          <SeansPaneli
            // Seans değişince panel yeniden mount edilmeli: sekme seçimi
            // (özellikle "Özel Notlarım") bir seanstan diğerine sızmamalı.
            key={`seans-${seciliRandevu.id}`}
            randevu={seciliRandevu}
            gecmisNotlar={seans.gecmisNotlar}
            not={seans.not}
            ozelNot={seans.ozelNot}
            ozelHata={seans.ozelHata}
            onNotKaydet={seansAkisi.notKaydet}
            onOzelNotKaydet={seansAkisi.ozelNotKaydet}
            onOzelSekme={seansAkisi.ozelSekmeAcildi}
            onOzelYenidenDene={seansAkisi.ozelYenidenDene}
            onKapat={takvim.panelKapat}
            // Alt satır (Plan 4 Görev 2). Kimlik burada, render anında
            // bağlanıyor: panel bu `key` ile yalnızca O randevu için mount
            // edildiğinden closure'daki `id` panelin ömrü boyunca doğru.
            // Her renderda taze closure'lar zararsız — panel bunları hiçbir
            // efektin bağımlılığına koymuyor, yalnızca tıklamada çağırıyor.
            onDurumDegis={(durum) => durumDegis(seciliRandevu.id, durum)}
            onOdemeDegis={(odendi) => odemeDegis(seciliRandevu.id, odendi)}
          />
        ) : (
          // Yükleme başarısızsa panel AÇILMAZ: "yükleniyor…" yazan bir panel
          // sonsuza kadar öyle kalır ve kullanıcı notunun neden gelmediğini
          // bilemez.
          <div className="mt-4">
            <div role="alert" className="rounded border border-red-300 bg-red-50 p-3">
              <p className="text-sm text-red-800">Seans notu yüklenemedi. {seans.hata}</p>
              <button
                type="button"
                className="mt-2 rounded border border-red-300 px-2 py-1 text-sm"
                onClick={seansAkisi.yenidenDene}
              >
                Yeniden dene
              </button>
            </div>
            {/* Durum ve ödeme notlara BAĞLI DEĞİL: notlar okunamasa da
                işaretlenebilmeli (Görev 2 inceleme I1). Geçmiş notlardan biri
                kalıcı olarak okunamıyorsa bu dal o danışanın HER seansında
                açılır; satır burada olmasaydı "Geldi" hiç işaretlenemez, son
                temas tazelenmez ve dosya imha hatırlatmasına erken düşerdi.
                `key` panelinkiyle aynı gerekçe: kutunun iyimser yerel değeri
                seans değişince sıfırlanmalı. */}
            <SeansAltSatiri
              key={`seans-alt-${seciliRandevu.id}`}
              randevu={seciliRandevu}
              onDurumDegis={(durum) => durumDegis(seciliRandevu.id, durum)}
              onOdemeDegis={(odendi) => odemeDegis(seciliRandevu.id, odendi)}
            />
          </div>
        ))}
    </div>
  )
}
