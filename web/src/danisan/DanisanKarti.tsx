import { useEffect, useState } from 'react'
import {
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
 * # Veri raporu programatik olarak İNDİRİLMEZ
 *
 * "Dışa aktar"a basmak raporu hazırlar ve bir indirme **bağlantısı**
 * gösterir; dosyayı kullanıcı kendisi indirir. Rapor danışanın kimliğini,
 * başvuru nedenini ve tüm resmî not içeriklerini taşıyan düz bir metin
 * dosyasıdır — diske yazılmasının bir tıkla daha ayrılması, kazara üretilen
 * bir kopyayı önler. Üretilen blob URL'i kart kapanınca serbest bırakılır.
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
  ekYukle: (dosya: File, tur: string) => Promise<void>
  onRizaKaydet: (alan: { riza_tarihi: string; riza_dosya_id: number | null }) => Promise<void>
  onKapat: () => void
}

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
  ekYukle,
  onRizaKaydet,
  onKapat,
}: Props) {
  const [rapor, setRapor] = useState<Rapor | null>(null)
  const [raporHatasi, setRaporHatasi] = useState<string | null>(null)
  const [raporSuruyor, setRaporSuruyor] = useState(false)
  const [ekSuruyor, setEkSuruyor] = useState(false)
  // Yükleme formu HANGİ danışan için doldurulduğunu taşıyor ve ekrana giden
  // hâli render sırasında türetiliyor (aşağıda). A için seçilmiş bir dosya
  // B'nin kartında durursa, "Yükle"ye basmak o dosyayı B'nin dosyasına
  // ekler — yanlış danışanın dosyasına belge. Sıfırlamayı bir efekte
  // bırakmak, seçim değişimi ile efekt arasındaki karede aynı riski açık
  // bırakırdı (`AnaEkran`'daki `seansVerisi` ile aynı gerekçe).
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
        <dd>{danisan.risk_notu ?? 'Kayıtlı değil'}</dd>
        {/* Etiket kapsamı yazıyor; çıplak "Bakiye" yanıltıcı olurdu. */}
        <dt className="font-medium text-slate-600">Bakiye (gelinmiş ve ödenmemiş seanslar)</dt>
        <dd>{tlBicimle(bakiyeKurus)}</dd>
      </dl>

      <div className="mt-3">
        <RizaBolumu
          // `key`: rıza formu prop'lardan İLK MOUNT'ta dolduruluyor. Danışan
          // değişip bileşen yeniden mount edilmezse A'nın rıza tarihi B'nin
          // formunda durur ve "Kaydet" B'ye A'nın tarihini yazardı.
          // Çağıran taraf (`AnaEkran`) karta zaten `key` veriyor; bu ikinci
          // savunma hattı (`SeansPaneli`/`NotEditoru` ile aynı ilke).
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
                {/* İçerik gömülü GÖSTERİLMEZ: sunucu `Content-Disposition:
                    attachment` gönderiyor ve bağlantı dosyayı indirir. */}
                <a className="text-slate-700 underline" href={ekIndirmeYolu(ek.id)}>
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
