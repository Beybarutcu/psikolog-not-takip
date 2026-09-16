import { useState } from 'react'
import { aramaApi, danisanApi, takvimApi } from '../api'
import { HizliArama } from '../arama/HizliArama'
import { boyutBicimle } from '../danisan/bicim'
import { DanisanKarti } from '../danisan/DanisanKarti'
import { AyOzeti } from '../ozet/AyOzeti'
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
      {ozetAcik && <AyOzeti bugun={yerelGun(new Date())} onDanisanAc={danisanKartiAc} />}

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

      {/* SAKLAMA HATIRLATMASI — tasarım §7: "süresi dolan dosyalar ana
          ekranda hatırlatma olarak listelenir".

          SİLME DÜĞMESİ YOK ve olmayacak: plan global kısıtı imha kararını
          her zaman insana bırakıyor. Ekran bunu açıkça yazıyor ki
          "uygulama halleder" beklentisi oluşmasın (danışan kartındaki aynı
          cümlenin eşi).

          Adlar burada görünüyor — zaten üstteki danışan listesinde de
          görünüyorlar; bu bölüm yeni bir hassas alan (risk notu, tanı, not
          içeriği) basmıyor. */}
      {liste.saklamaDolanlar.length > 0 && (
        <section
          aria-label="Saklama süresi dolan dosyalar"
          className="mb-4 rounded border border-amber-400 bg-amber-50 p-3"
        >
          <h2 className="text-sm font-semibold text-amber-900">
            Saklama süresi dolan dosyalar ({liste.saklamaDolanlar.length})
          </h2>
          <ul className="mt-1 flex flex-wrap gap-2 text-sm">
            {liste.saklamaDolanlar.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className="underline"
                  aria-label={`${d.ad_soyad} dosyasını aç (saklama süresi doldu)`}
                  onClick={() => danisanKartiAc(d.id)}
                >
                  {d.ad_soyad}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-amber-900">
            Bu dosyalar kendiliğinden silinmez; imha kararı her zaman sizindir.
          </p>
        </section>
      )}

      {/* DEPOLAMA UYARISI — plan global kısıtındaki 500 MB eşiği.
          `depolama_durumu` Görev 7'de HTTP'ye bağlanmıştı ama arayüzde
          çağrı yeri yoktu: ekler 20 MB'a kadar BLOB tutuyor ve terapist
          veritabanı şişerken hiçbir uyarı almıyordu.

          Yalnızca eşik AŞILINCA görünür ve hiçbir şeyi ENGELLEMEZ — sunucu
          da engellemiyor (`uyari === true` iken yükleme çalışmaya devam
          eder). Eşik metni sunucudan gelen `esik` alanından basılıyor;
          istemcide ikinci bir kopya tutmak iki sayının sessizce ayrışması
          demekti. */}
      {dosya.depolama?.uyari && (
        <p
          role="status"
          className="mb-4 rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900"
        >
          Ekli dosyalar {boyutBicimle(dosya.depolama.toplam_boyut)} yer kaplıyor ve{' '}
          {boyutBicimle(dosya.depolama.esik)} uyarı eşiğini aştı. Yükleme engellenmiyor;
          yedeklerinizi ve eski dosyalarınızı gözden geçirmek isteyebilirsiniz.
        </p>
      )}

      {/* YEDEKLEME — tasarım §7.
          "Yedek alınamazsa (disk dolu, klasör erişilemez) ana ekranda KALICI
          uyarı çıkar; sessiz geçilmez." Uyarı kendi kendine kaybolmaz;
          yalnızca başarılı bir yedek onu temizler.

          Bölüm HER ZAMAN görünür (uyarı olmasa da): "yedeğim alınıyor mu"
          sorusunun ekranda bir cevabı olmalı. Bu ürünün üçüncü başarı
          ölçütü "bilgisayar bozulursa veri kaybolmasın" ve o ölçüt, ancak
          kullanıcı yedeğinin durumunu görebiliyorsa karşılanır. */}
      <section
        aria-label="Yedekleme"
        className={`mb-4 rounded border p-3 text-sm ${
          yedekleme.uyari
            ? 'border-amber-400 bg-amber-50 text-amber-900'
            : 'border-slate-200 bg-slate-50 text-slate-600'
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">Yedekleme</span>
          {yedekleme.yedek !== null && yedekleme.yedek.yedekler.length > 0 ? (
            <span>
              Son yedek: <strong>{yedekleme.yedek.yedekler[0].tarih}</strong> (
              {boyutBicimle(yedekleme.yedek.yedekler[0].boyut)}) · saklanan yedek:{' '}
              {yedekleme.yedek.yedekler.length}
            </span>
          ) : (
            <span>Henüz alınmış bir yedek yok.</span>
          )}
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs disabled:opacity-50"
            disabled={yedekleme.suruyor}
            onClick={() => void yedekleme.al()}
          >
            {yedekleme.suruyor ? 'Yedek alınıyor…' : 'Şimdi yedek al'}
          </button>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            onClick={() => {
              yedekleme.setKlasorGirdisi(yedekleme.yedek?.hedef_dizin ?? '')
              yedekleme.setKlasorFormuAcik((acik) => !acik)
            }}
          >
            Yedek klasörünü değiştir
          </button>
          {/* Tasarim §7: "Uygulama icinden 'geri yukle' ekrani; her yedegin
              tarihi ve boyutu listelenir." Ekran uc felaket yolundan da
              (bozuk veritabani, okunamayan anahtar, yeni bilgisayar)
              acilabiliyor; AMA her sey CALISIRKEN de bir yol olmali:
              yanlislikla silinen bir danisan ya da bozulan bir not, ancak
              eski bir yedekten geri gelir ve o an ortada hicbir "felaket"
              yoktur. Ekranin kendisi iki adimli: burada yalnizca aciliyor,
              geri yukleme orada onaylaniyor. */}
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            onClick={onGeriYukle}
          >
            Yedekten geri yükle
          </button>
        </div>

        {yedekleme.yedek !== null && (
          <p className="mt-1 break-all font-mono text-xs">{yedekleme.yedek.hedef_dizin}</p>
        )}

        {/* KALICI UYARI. `role="status"` degil `role="alert"`: bu, gozden
            kacmamasi gereken bir durum -- kullanicinin verisi su an
            yedeklenmiyor. */}
        {yedekleme.uyari && (
          <p role="alert" className="mt-2">
            {yedekleme.uyari}
          </p>
        )}

        {yedekleme.klasorFormuAcik && (
          <div className="mt-2">
            <label className="block text-xs" htmlFor="yedek-klasoru-girdisi">
              Yedeklerin yazılacağı klasörün yolu
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="yedek-klasoru-girdisi"
                className="w-full rounded border p-2 font-mono text-xs"
                placeholder="/Volumes/YEDEK/terapi-yedek"
                value={yedekleme.klasorGirdisi}
                onChange={(e) => yedekleme.setKlasorGirdisi(e.target.value)}
              />
              <button
                type="button"
                className="shrink-0 rounded bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-50"
                disabled={yedekleme.suruyor || yedekleme.klasorGirdisi.trim() === ''}
                onClick={() => void yedekleme.al(yedekleme.klasorGirdisi.trim())}
              >
                Kaydet ve yedek al
              </button>
            </div>
            {/* Klasoru secmek ile ilk yedegi almak TEK islem: ayri bir
                "ayarla" adimi olsaydi, klasorunu secip yedegi almayan bir
                kullanici "yedegim var" sanirdi. Metin bunu soyluyor. */}
            <p className="mt-1 text-xs">
              Harici disk ya da bulut klasörü seçebilirsiniz; yedek dosyaları zaten
              şifrelidir. Kaydedince ilk yedek hemen alınır. Finder'da klasöre sağ tıklayıp{' '}
              <kbd>⌥</kbd> tuşuna basılıyken “… Yol Adı Olarak Kopyala” deyince yol panoya
              kopyalanır.
            </p>
          </div>
        )}
      </section>

      {/* PAROLA — `keystore::change_password` Plan 1'den beri yazılı ve
          testliydi ama hiçbir çağrı yeri yoktu: parola DEĞİŞTİRİLEMİYORDU.
          Bölüm her zaman görünür (yalnızca form katlanıyor): "parolamı nasıl
          değiştiririm" sorusunun ekranda bir cevabı olmalı. */}
      <section
        aria-label="Parola"
        className="mb-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600"
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">Parola</span>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            onClick={parola.acKapa}
          >
            {parola.acik ? 'Vazgeç' : 'Parolayı değiştir'}
          </button>
        </div>

        {/* `role="status"`: değişiklik ekranda sessizce olup bitiyordu.
            Metin ne olduğunu VE ne OLMADIĞINI birlikte söylüyor (arşivleme
            onayıyla aynı ilke). */}
        {parola.bilgi && (
          <p role="status" className="mt-2 text-slate-700">
            {parola.bilgi}
          </p>
        )}

        {parola.acik && (
          <div className="mt-2 max-w-md">
            <div>
              <label className="block text-xs" htmlFor="mevcut-parola">
                Mevcut parolanız
              </label>
              <input
                id="mevcut-parola"
                type="password"
                autoComplete="current-password"
                className="mt-1 w-full rounded border p-2"
                value={parola.mevcutParola}
                onChange={(e) => parola.setMevcutParola(e.target.value)}
              />
            </div>
            <div className="mt-2">
              <label className="block text-xs" htmlFor="yeni-parola">
                Yeni parola
              </label>
              <input
                id="yeni-parola"
                type="password"
                autoComplete="new-password"
                className="mt-1 w-full rounded border p-2"
                value={parola.yeniParola}
                onChange={(e) => parola.setYeniParola(e.target.value)}
              />
            </div>
            <div className="mt-2">
              <label className="block text-xs" htmlFor="yeni-parola-tekrar">
                Yeni parola (tekrar)
              </label>
              <input
                id="yeni-parola-tekrar"
                type="password"
                autoComplete="new-password"
                className="mt-1 w-full rounded border p-2"
                value={parola.yeniParolaTekrar}
                onChange={(e) => parola.setYeniParolaTekrar(e.target.value)}
              />
            </div>

            {parola.hata && (
              <p role="alert" className="mt-2 text-red-600">
                {parola.hata}
              </p>
            )}

            <button
              type="button"
              className="mt-2 rounded bg-slate-900 px-3 py-2 text-xs text-white disabled:opacity-50"
              disabled={parola.suruyor}
              onClick={() => void parola.degistir()}
            >
              {parola.suruyor ? 'Değiştiriliyor…' : 'Parolayı değiştir'}
            </button>

            {/* İKİ GERÇEĞİ ÖNCEDEN söyler; kullanıcı bunları ancak
                parolasını unuttuğunda ya da eski bir yedeği geri yüklemeye
                çalıştığında -- yani çok geç -- öğrenmemeli.

                1. Kurtarma kodu DEĞİŞMEZ: veri anahtarı hem parolayla hem
                   kurtarma koduyla ayrı ayrı sarmalanıyor ve sunucudaki
                   `change_password` yalnızca parola sarmalamasını
                   yeniliyor.
                2. Eski yedekler ESKİ parolayla açılır: her yedek kendi
                   anahtar dosyasıyla birlikte alınır ve geçmişteki o
                   dosyaya dokunulmaz. */}
            <div className="mt-2 text-xs">
              <p>Kurtarma kodunuz değişmez; aynı kod çalışmaya devam eder.</p>
              <p className="mt-1">
                Bugünden önce alınmış yedekler <strong>eski</strong> parolanızla açılır — her
                yedek kendi anahtar dosyasıyla birlikte alınır. Eski parolanızı unutmayın.
              </p>
              <p className="mt-1">Oturumunuz açık kalır; yeniden giriş yapmanız gerekmez.</p>
            </div>
          </div>
        )}
      </section>

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
            onDurumDegis={(durum) => takvim.durumDegis(seciliRandevu.id, durum)}
            onOdemeDegis={(odendi) => takvim.odemeDegis(seciliRandevu.id, odendi)}
          />
        ) : (
          // Yükleme başarısızsa panel AÇILMAZ: "yükleniyor…" yazan bir panel
          // sonsuza kadar öyle kalır ve kullanıcı notunun neden gelmediğini
          // bilemez.
          <div role="alert" className="mt-4 rounded border border-red-300 bg-red-50 p-3">
            <p className="text-sm text-red-800">Seans notu yüklenemedi. {seans.hata}</p>
            <button
              type="button"
              className="mt-2 rounded border border-red-300 px-2 py-1 text-sm"
              onClick={seansAkisi.yenidenDene}
            >
              Yeniden dene
            </button>
          </div>
        ))}
    </div>
  )
}
