import { useEffect, useState } from 'react'
import {
  ekIndir,
  ekIndirmeYolu,
  EK_TURLERI,
  type DanisanDosyasi,
  type EkBilgisi,
  type SeansNotu,
} from '../api'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { boyutBicimle, kalanGun, tarihBicimle, tlBicimle } from './bicim'
import { RizaBolumu } from './RizaBolumu'
import { veriRaporuMetni } from './veriRaporu'

/**
 * Danışan kartı: kimlik, başvuru nedeni, risk notu, bakiye, rıza durumu,
 * saklama süresi, ekli dosyalar ve veri raporu.
 *
 * # Kart, özel nota HİÇ dokunmaz
 *
 * Buradaki hiçbir prop özel not taşımıyor ve bileşenin `ozelNotApi`'ye giden
 * bir yolu yok. Veri raporunu besleyen `notlariGetir` `SeansNotu[]`
 * döndürür — o tip `progress_notes`'un şeklidir (`sablon` + `client_id`
 * alanları `OzelNot`'ta YOKTUR), yani özel notu buraya geçirmek tip
 * seviyesinde de mümkün değildir. Koruma bir filtreye değil, kaynağın
 * kendisine dayanıyor (planın bağlayıcı kısıtı).
 *
 * # Bakiye neyi sayar
 *
 * **Gelinmiş** (`durum === 'geldi'`) ve **ödenmemiş** seansların ücreti.
 * Kural İÇEREN biçimde yazıldı; `durum != 'iptal'` gibi dışlayıcı bir
 * desen kopyalanmadı (kod tabanındaki tek örneği `cakisanlari_bul` ve o
 * desenin buraya yayılmaması bilinçli bir karar). Sonuç olarak gelecekteki
 * bir randevu borç sayılmaz, iptal sayılmaz; "gelmedi" de sayılmaz çünkü
 * ücretlendirilip ücretlendirilmeyeceği terapistin politikasına bağlıdır ve
 * uygulama o politikayı bilmiyor. Etiket neyi saydığını **yazar**: kapsamı
 * söylemeyen bir "Bakiye: 0,00 ₺", ücreti hiç girilmemiş bir dosyada
 * "borcu yok" diye okunur.
 *
 * # Risk notu KATLANMIŞ gösterilir
 *
 * `GecmisNotlar`'ın katlama kararı burada da geçerli ve daha güçlü: risk
 * notu bu ekrandaki en hassas tek alan, kart danışanın adının hemen altında
 * duruyor ve terapist kartı danışan odadayken açıyor (telefon, rıza, ek
 * dosya işleri için). Notun var olduğu görünür kalır — bağlam bu —, içeriği
 * yalnızca istenince basılır.
 *
 * # Kartın danışanı ÜRETİMDE DEĞİŞMEZ
 *
 * `AnaEkran` kartı `kart = kartVerisi.id === seciliDanisanId ? kartVerisi :
 * BOS_KART` ile türetiyor ve `{kart.dosya !== null && <DanisanKarti … />}`
 * ile basıyor. Danışan değiştiği anda `kart.dosya` `null` olur ve bu
 * bileşen UNMOUNT edilir; yani monte bir kartın `danisan.id`'si hiçbir
 * zaman değişmez.
 *
 * Bunun sonucu, bu dosyadaki "danışan değişimi" savunmalarının
 * (`gorunenRapor` ve `ekForm` türetmeleri, `RizaBolumu`'nün `key`'i)
 * bugün **ulaşılamaz** olmasıdır. Bilerek duruyorlar — birincil hat
 * gevşetilirse yük taşımaya başlarlar — ama bir koruma sözü olarak
 * sayılmamalılar: koruma `AnaEkran`'daki türetmenin kendisidir ve
 * `AnaEkran.test.tsx` > "baska danisana gecince onceki kartin verisi
 * EKRANDA KALMAZ" testinde ölçülür. Buradaki sentetik `rerender` testleri
 * "birincil hat unutulursa ne kalır" sorusunu ölçüyor, "bugün ne çalışıyor"
 * sorusunu değil.
 *
 * # Veri raporu programatik olarak İNDİRİLMEZ
 *
 * "Dışa aktar"a basmak raporu hazırlar ve bir indirme **bağlantısı**
 * gösterir; dosyayı kullanıcı kendisi indirir. Rapor danışanın kimliğini,
 * başvuru nedenini ve tüm resmî not içeriklerini taşıyan düz bir metin
 * dosyasıdır — diske yazılmasının bir tıkla daha ayrılması, kazara üretilen
 * bir kopyayı önler. Üretilen blob URL'i kart kapanınca serbest bırakılır.
 *
 * # Dışa aktarım önce KAYDEDİLİR (fail-closed) — dal incelemesi C1
 *
 * Rapor tamamen burada, istemcide üretiliyor; sunucu dosyanın diske
 * yazıldığını başka hiçbir yerden göremez. Rapor için çekilen not listesi
 * (`GET /api/danisanlar/{id}/notlar`) `goruntuleme` yazıyor ve 5 dakikalık
 * pencerede **birleşiyor** — seans paneli aynı danışan için az önce
 * açıldıysa dışa aktarım silinemez denetim kaydında **hiçbir iz
 * bırakmıyordu**. Oysa tasarım §4 dışa aktarmayı açıkça sayıyor ve kod
 * tabanı doğrusunu zaten biliyor: tek bir ek indirmesi bile
 * `Eylem::DisaAktarma` + `LogHacmi::HerCagri` ile yazılıyor.
 *
 * Bu yüzden `raporHazirla`'nın İLK adımı `raporKaydiOlustur()`'dur ve
 * **sıra bir güvencedir**: kayıt reddedilirse (kilitli oturum, bilinmeyen
 * danışan, disk hatası) rapor hiç üretilmez — ne notlar çekilir, ne metin
 * kurulur, ne indirme bağlantısı görünür. Plan 1'in kurulum/kilit-açma
 * kararıyla aynı gerekçe: *kaydedilemeyecek bir erişime izin verilmez.*
 * Ters sıra ("önce üret, sonra kaydet") kaydın başarısız olduğu durumda
 * kullanıcının elinde kayıtsız bir kopya bırakırdı.
 *
 * PLAN 4 NOTU: dışa aktarım sunucu tarafına taşınacak ve parola korumalı
 * üretilecek (tasarım §10); o zaman raporu ÜRETEN uç nokta kendi kaydını
 * yazacak ve bu iki adımlı düzen kaldırılacak. Bugünkü hâl, o güne kadarki
 * asgari doğru davranıştır.
 */
type Props = {
  danisan: DanisanDosyasi
  ekler: EkBilgisi[]
  /** Bu danışanın **tüm** randevuları (yalnızca görünen hafta değil). */
  randevular: Randevu[]
  /** İstemcinin yerel takvim günü, `YYYY-AA-GG`. */
  bugun: string
  /** Yalnızca **resmî** notlar (`notApi.danisanNotlari`). */
  notlariGetir: () => Promise<SeansNotu[]>
  /**
   * `notlariGetir`'in sunucuya gönderdiği üst sınır.
   *
   * Yanıt "daha fazlası var" işareti taşımıyor; sayı sınıra dayanmışsa
   * rapor kırpılmış olabilir ve bunu hem ekranda hem raporun içinde
   * söylemek gerekiyor (aynı boşluğun arama tarafındaki karşılığı için
   * bkz. `HizliArama`).
   */
  notSiniri: number
  /**
   * Dışa aktarımı **denetim kaydına** yazdırır; `raporHazirla`'nın İLK adımı.
   *
   * Bkz. modül başlığındaki "Dışa aktarım önce KAYDEDİLİR" bölümü ve
   * `danisanApi.raporKaydiOlustur`.
   */
  raporKaydiOlustur: () => Promise<void>
  ekYukle: (dosya: File, tur: string) => Promise<void>
  onRizaKaydet: (alan: { riza_tarihi: string; riza_dosya_id: number | null }) => Promise<void>
  onKapat: () => void
}

const RISK_GOVDE_ID = 'danisan-risk-notu-govde'

type Rapor = {
  danisanId: number
  url: string
  dosyaAdi: string
  notSayisi: number
  kirpilmisOlabilir: boolean
}

export function DanisanKarti({
  danisan,
  ekler,
  randevular,
  bugun,
  notlariGetir,
  notSiniri,
  raporKaydiOlustur,
  ekYukle,
  onRizaKaydet,
  onKapat,
}: Props) {
  const [rapor, setRapor] = useState<Rapor | null>(null)
  const [raporHatasi, setRaporHatasi] = useState<string | null>(null)
  const [raporSuruyor, setRaporSuruyor] = useState(false)
  const [ekSuruyor, setEkSuruyor] = useState(false)
  // Ek indirme hatası. İndirme artık `fetch`'ten geçtiği için (bkz.
  // `api.ekIndir`) hata sessizce yutulamaz: eskiden tarayıcı gezinip ham
  // JSON'u ekrana basıyordu, artık kullanıcıya burada söyleniyor.
  const [indirmeHatasi, setIndirmeHatasi] = useState<string | null>(null)
  // Risk notu KAPALI açılır (gerekçe modül başlığında). State, HANGİ
  // danışan için açıldığını taşıyor ve ekrana giden hâli render sırasında
  // türetiliyor — `ekFormu` ile aynı desen. Düz bir `boolean` olsaydı,
  // A'nın notunu açtıktan sonra B'ye geçmek B'nin risk notunu SORULMADAN
  // ekrana basardı. (İkincil hat: kart bugün zaten unmount ediliyor,
  // bkz. modül başlığı.)
  const [riskAcikOlan, setRiskAcikOlan] = useState<number | null>(null)
  const riskAcik = riskAcikOlan === danisan.id
  // Yükleme formu HANGİ danışan için doldurulduğunu taşıyor ve ekrana giden
  // hâli render sırasında türetiliyor (aşağıda). A için seçilmiş bir dosya
  // B'nin kartında durursa, "Yükle"ye basmak o dosyayı B'nin dosyasına
  // ekler — yanlış danışanın dosyasına belge. Sıfırlamayı bir efekte
  // bırakmak, seçim değişimi ile efekt arasındaki karede aynı riski açık
  // bırakırdı (`AnaEkran`'daki `seansVerisi` ile aynı gerekçe).
  //
  // İKİNCİL HAT — `gorunenRapor` ile aynı durumda (bkz. modül başlığı).
  const [ekFormu, setEkFormu] = useState<{
    danisanId: number
    dosya: File | null
    tur: string
    hata: string | null
  }>({ danisanId: danisan.id, dosya: null, tur: 'diger', hata: null })

  const ekForm =
    ekFormu.danisanId === danisan.id
      ? ekFormu
      : { danisanId: danisan.id, dosya: null, tur: 'diger', hata: null }

  // Ekrana giden rapor RENDER SIRASINDA türetiliyor: state başka bir
  // danışana aitse yok sayılır. Sıfırlamayı efekte bırakmak, seçim değişimi
  // ile efektin çalışması arasındaki karede ÖNCEKİ danışanın raporunu yeni
  // kartta göstermek olurdu (`AnaEkran`'daki `seansVerisi` ile aynı desen).
  //
  // İKİNCİL HAT: `AnaEkran` danışan değişince bu kartı zaten UNMOUNT ediyor
  // (bkz. modül başlığındaki "Kartın danışanı üretimde değişmez"), yani bu
  // türetme bugün erişilemez. Ölçüldüğü tek yer sentetik `rerender`
  // testleri (`DanisanKarti.test.tsx` > "ikincil hat").
  const gorunenRapor = rapor !== null && rapor.danisanId === danisan.id ? rapor : null

  // Danışan değiştiğinde `rapor` state'i BİLEREK silinmiyor; türetme onu
  // zaten gizliyor. Bir efektle sıfırlamak iki mekanizmayı üst üste koyar
  // ve o durumda yukarıdaki türetmeyi kaldıran bir mutasyon hiçbir testi
  // kırmaz (efekt aynı işi bir kare gecikmeyle yapar, RTL o kareyi
  // göremez) — yani türetme "test yeşil ama korumuyor" durumuna düşerdi.
  // Yan etkisi: aynı karta geri dönüldüğünde hazırlanmış rapor bağlantısı
  // hâlâ geçerlidir; bu bir kayıp değil, kazanç.

  // Blob URL rapor değiştiğinde ve kart kaldırıldığında serbest bırakılır:
  // rapor kişisel veri taşıyor, sayfa ömrü boyunca canlı bir URL bırakmak
  // onu adresi bilen her koda açık tutardı.
  useEffect(() => {
    if (rapor === null) return
    const url = rapor.url
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [rapor])

  const bakiyeKurus = randevular
    .filter((r) => r.durum === 'geldi' && !r.odendi)
    .reduce((toplam, r) => toplam + (r.ucret ?? 0), 0)

  const kalan = danisan.saklama_bitis === null ? null : kalanGun(bugun, danisan.saklama_bitis)

  async function raporHazirla() {
    setRaporSuruyor(true)
    setRaporHatasi(null)
    try {
      // SIRA ÖNEMLİ — bkz. modül başlığı "Dışa aktarım önce KAYDEDİLİR".
      // Kayıt başarısız olursa (kilitli oturum → 401, bilinmeyen danışan →
      // 404, disk hatası → 500) `await` fırlatır, `catch`'e düşülür ve
      // AŞAĞIDAKİ HİÇBİR SATIR ÇALIŞMAZ: notlar çekilmez, metin üretilmez,
      // Blob oluşmaz, indirme bağlantısı gösterilmez. Fail-closed.
      await raporKaydiOlustur()
      const notlar = await notlariGetir()
      const kirpilmisOlabilir = notlar.length >= notSiniri
      const metin = veriRaporuMetni(danisan, notlar, ekler, kirpilmisOlabilir)
      const url = URL.createObjectURL(new Blob([metin], { type: 'text/plain;charset=utf-8' }))
      setRapor({
        danisanId: danisan.id,
        url,
        // Dosya adında danışanın ADI YOK: ad sağlık verisiyle birlikte
        // anıldığı anda kendisi de hassas veri olur ve dosya adları
        // paylaşılan klasörlerde, yedeklerde, ekran görüntülerinde görünür.
        // Testli (bir yorum bu iddiayı tek başına taşıyamaz):
        // `DanisanKarti.test.tsx` "dosya adinda danisanin ADI GECMEZ".
        dosyaAdi: `danisan-${danisan.id}-veri-raporu-${bugun}.txt`,
        notSayisi: notlar.length,
        kirpilmisOlabilir,
      })
    } catch (e) {
      // Boş bir rapor indirtmek "bu danışanın notu yok" diye okunurdu.
      setRaporHatasi(e instanceof Error ? e.message : 'Veri raporu hazırlanamadı.')
    } finally {
      setRaporSuruyor(false)
    }
  }

  async function dosyaYukle() {
    if (ekForm.dosya === null) {
      setEkFormu({ ...ekForm, hata: 'Önce bir dosya seçin.' })
      return
    }
    setEkSuruyor(true)
    try {
      await ekYukle(ekForm.dosya, ekForm.tur)
      setEkFormu({ danisanId: danisan.id, dosya: null, tur: ekForm.tur, hata: null })
    } catch (e) {
      setEkFormu({
        ...ekForm,
        hata: e instanceof Error ? e.message : 'Dosya yüklenemedi.',
      })
    } finally {
      setEkSuruyor(false)
    }
  }

  return (
    <section
      aria-labelledby="danisan-karti-basligi"
      className="mt-4 rounded-lg border border-slate-300 p-4"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 id="danisan-karti-basligi" className="text-lg font-semibold">
          {danisan.ad_soyad}
        </h2>
        <button
          type="button"
          className="rounded border px-3 py-1 text-sm"
          onClick={onKapat}
        >
          Danışan kartını kapat
        </button>
      </div>

      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <dt className="font-medium text-slate-600">Telefon</dt>
        <dd>{danisan.telefon ?? 'Kayıtlı değil'}</dd>
        <dt className="font-medium text-slate-600">Doğum tarihi</dt>
        <dd>{danisan.dogum_tarihi ? tarihBicimle(danisan.dogum_tarihi) : 'Kayıtlı değil'}</dd>
        <dt className="font-medium text-slate-600">Başvuru nedeni</dt>
        <dd>{danisan.basvuru_nedeni ?? 'Kayıtlı değil'}</dd>
        <dt className="font-medium text-slate-600">Risk notu</dt>
        {/* KATLANMIŞ — `GecmisNotlar` ile aynı gerekçe, oradan daha
            güçlüsüyle: risk notu ("geçmişte bir kez kendine zarar verme")
            bu ekrandaki en hassas tek alan ve kart, danışanın adının hemen
            altında duruyor. Danışan odada olabilir ve terapist kartı onun
            önünde açar (telefon, rıza, ek dosya işleri için). Kendiliğinden
            basılan bir risk notu, omzun üstünden okunabilir hâle gelir.
            Notun VAR OLDUĞU görünür kalıyor (bağlam bu), içeriği ancak
            istenince açılıyor. */}
        <dd>
          {danisan.risk_notu === null ? (
            'Kayıtlı değil'
          ) : (
            <>
              <button
                type="button"
                className="rounded border px-2 py-0.5 text-xs"
                aria-expanded={riskAcik}
                aria-controls={RISK_GOVDE_ID}
                onClick={() => setRiskAcikOlan(riskAcik ? null : danisan.id)}
              >
                {riskAcik ? 'Risk notunu gizle' : 'Risk notunu göster'}
              </button>
              {riskAcik && (
                <p id={RISK_GOVDE_ID} className="mt-1 whitespace-pre-wrap">
                  {danisan.risk_notu}
                </p>
              )}
            </>
          )}
        </dd>
        {/* Etiket kapsamı yazıyor; çıplak "Bakiye" yanıltıcı olurdu. */}
        <dt className="font-medium text-slate-600">Bakiye (gelinmiş ve ödenmemiş seanslar)</dt>
        <dd>{tlBicimle(bakiyeKurus)}</dd>
      </dl>
      {/* Etiket neyi SAYDIĞINI yazıyordu, neyi SAYMADIĞINI yazmıyordu.
          "Gelmedi" işaretli bir seansın ücretlendirilip
          ücretlendirilmeyeceği terapistin politikasına bağlı ve uygulama o
          politikayı bilmiyor; sayının dışında bırakıldığını söylememek,
          gelmeyen seansları ücretlendiren bir terapiste sessizce eksik bir
          bakiye göstermek olurdu. */}
      <p className="mt-1 text-xs text-slate-500">
        Gelmedi olarak işaretlenen seanslar bu sayıya girmez; ücretlendirme kararı sizindir.
      </p>

      <div className="mt-3">
        <RizaBolumu
          // `key`: rıza formu prop'lardan İLK MOUNT'ta dolduruluyor. Danışan
          // değişip bileşen yeniden mount edilmezse A'nın rıza tarihi B'nin
          // formunda durur ve "Kaydet" B'ye A'nın tarihini yazardı.
          //
          // İKİNCİL HAT — bugün ULAŞILAMAZ: bu kartın kendisi danışan
          // değişince unmount ediliyor (bkz. modül başlığı), dolayısıyla
          // `RizaBolumu` de her seferinde taze mount oluyor ve bu `key`
          // hiçbir zaman değişmiyor. Ölçüldüğü tek yer sentetik `rerender`
          // testi (`DanisanKarti.test.tsx` > "A nin riza tarihi B nin
          // formunda KALMAZ").
          key={`riza-${danisan.id}`}
          rizaTarihi={danisan.riza_tarihi}
          rizaDosyaId={danisan.riza_dosya_id}
          ekler={ekler}
          onKaydet={onRizaKaydet}
        />
      </div>

      <section
        aria-label="Saklama süresi"
        className="mt-3 rounded border border-slate-200 p-3 text-sm"
      >
        <h3 className="font-semibold">Saklama süresi</h3>
        {danisan.saklama_bitis === null || kalan === null ? (
          <p className="mt-1 text-slate-700">
            Saklama süresi henüz hesaplanmadı; danışanın ilk seansı işlendiğinde son temas
            tarihinden hesaplanır.
          </p>
        ) : kalan > 0 ? (
          <p className="mt-1 text-slate-700">
            {tarihBicimle(danisan.saklama_bitis)} tarihinde doluyor ({kalan} gün kaldı).
          </p>
        ) : (
          <p className="mt-1 rounded border border-amber-400 bg-amber-50 p-2 text-amber-900">
            Saklama süresi doldu ({tarihBicimle(danisan.saklama_bitis)}).
          </p>
        )}
        {/* Plan global kısıtı: süresi dolan dosyalar yalnızca listelenir,
            silme kararını her zaman insan verir. Ekran bunu her durumda
            söylüyor ki "uygulama halleder" beklentisi oluşmasın. */}
        <p className="mt-1 text-slate-600">
          Süre dolduğunda dosya kendiliğinden silinmez; imha kararı her zaman sizindir.
        </p>
      </section>

      <section
        aria-label="Ekli dosyalar"
        className="mt-3 rounded border border-slate-200 p-3 text-sm"
      >
        <h3 className="font-semibold">Ekli dosyalar</h3>
        {ekler.length === 0 ? (
          <p className="mt-1 text-slate-600">Bu danışana henüz dosya eklenmemiş.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {ekler.map((ek) => (
              <li key={ek.id}>
                {/* İçerik gömülü GÖSTERİLMEZ; dosya diske indirilir.
                    `href` duruyor (bağlam menüsü gerçek bir adres görsün)
                    ama tıklama `ekIndir`'den geçiyor: düz gezinme kilitli
                    oturumda 401 gövdesine giderek SPA'yı yıkıyor ve
                    yazılmamış not taslağını götürüyordu (bkz.
                    `api.ekIndir`, dal incelemesi I3). */}
                <a
                  className="text-slate-700 underline"
                  href={ekIndirmeYolu(ek.id)}
                  onClick={(e) => {
                    e.preventDefault()
                    setIndirmeHatasi(null)
                    void ekIndir(ek).catch((x) =>
                      setIndirmeHatasi(x instanceof Error ? x.message : 'Dosya indirilemedi.'),
                    )
                  }}
                >
                  {ek.dosya_adi}
                </a>{' '}
                <span className="text-slate-500">
                  ({ek.tur}, {boyutBicimle(ek.boyut)})
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-sm" htmlFor="ek-dosya">
              Yüklenecek dosya
            </label>
            <input
              id="ek-dosya"
              type="file"
              className="mt-1 text-sm"
              onChange={(e) =>
                setEkFormu({
                  ...ekForm,
                  dosya: e.target.files?.[0] ?? null,
                  hata: null,
                })
              }
            />
          </div>
          <div>
            <label className="block text-sm" htmlFor="ek-turu">
              Dosya türü
            </label>
            <select
              id="ek-turu"
              className="mt-1 rounded border p-1 text-sm"
              value={ekForm.tur}
              onChange={(e) => setEkFormu({ ...ekForm, tur: e.target.value })}
            >
              {EK_TURLERI.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            disabled={ekSuruyor}
            onClick={() => void dosyaYukle()}
          >
            Dosyayı yükle
          </button>
        </div>
        {ekForm.hata && (
          <p role="alert" className="mt-1 text-red-600">
            {ekForm.hata}
          </p>
        )}
        {indirmeHatasi && (
          <p role="alert" className="mt-1 text-red-600">
            {indirmeHatasi}
          </p>
        )}
      </section>

      <div className="mt-3 rounded border border-slate-200 p-3 text-sm">
        <h3 className="font-semibold">Veri raporu</h3>
        <p className="mt-1 text-slate-600">
          Danışanın kendi verisine erişim talebi için (KVKK md. 11). Terapistin özel notları
          rapora dahil edilmez.
        </p>
        <button
          type="button"
          className="mt-2 rounded border px-3 py-1 text-sm disabled:opacity-50"
          disabled={raporSuruyor}
          onClick={() => void raporHazirla()}
        >
          Veri raporu dışa aktar
        </button>
        {gorunenRapor && (
          <p className="mt-2">
            <a
              className="text-slate-700 underline"
              href={gorunenRapor.url}
              download={gorunenRapor.dosyaAdi}
            >
              Raporu indir ({gorunenRapor.notSayisi} seans notu, {ekler.length} ek)
            </a>
          </p>
        )}
        {gorunenRapor?.kirpilmisOlabilir && (
          <p className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-amber-900">
            Not sayısı sunucunun üst sınırına ({gorunenRapor.notSayisi}) dayandı; daha eski
            notlar rapora girmemiş olabilir. Raporun içinde de bu uyarı var.
          </p>
        )}
        {raporHatasi && (
          <p role="alert" className="mt-1 text-red-600">
            {raporHatasi}
          </p>
        )}
      </div>
    </section>
  )
}
