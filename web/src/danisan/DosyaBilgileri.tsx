import { useEffect, useRef, useState } from 'react'
import { ekIndir, ekIndirmeYolu, EK_TURLERI, type DanisanDosyasi, type EkBilgisi } from '../api'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { borcToplami } from '../borc'
import { tlMetni } from '../para'
import { boyutBicimle, kalanGun, tarihBicimle } from './bicim'
import { RizaBolumu } from './RizaBolumu'

/**
 * `DanisanDosyasi`nin "Bilgiler" alt sekmesi: kimlik, başvuru nedeni, risk
 * notu, bakiye, onam durumu, saklama süresi, ekli dosyalar ve veri raporu
 * (Plan 5 Görev 7 — eskiden `DanisanKarti`, içeriği buraya taşındı).
 *
 * # Neden taşındı, ne DEĞİŞTİ ne KALDI
 *
 * Ürün kararı (kullanıcının kendi sözleriyle): KVKK ve güvenlikle ilgili
 * bölümler ekranda "laf" gibi, uygulamanın amacı buymuş gibi duruyordu; bu
 * bölümler istenildiğinde gidilip ULAŞILACAK şeyler olmalı. Rıza zaten
 * terapiye başlarken kâğıt üzerinde imzalanıyor; bu ekranın işi onu
 * DENETLEMEK değil, imzalı kâğıdı (tarih + dosya) SAKLAYABİLMEK. Görev 6 bu
 * içeriği ana ekrandan "Bilgiler" alt sekmesinin ARKASINA taşıdı (görünürlük
 * kararı); Görev 7 burada yalnızca DİLİ değiştirdi: suçlayıcı uyarı
 * cümleleri bilgi cümlelerine çevrildi (bkz. `RizaBolumu.tsx` ve aşağıdaki
 * "Veri raporu" bölümü). HİÇBİR YETENEK kaybolmadı — onam tarihi kaydetme,
 * imzalı onam dosyası yükleme, ekli dosyalar, saklama süresi ve KVKK veri
 * raporu dışa aktarma hepsi aynen çalışıyor; ölçüsü `DosyaBilgileri.test.tsx`.
 *
 * # Bilgiler, özel nota HİÇ dokunmaz
 *
 * Buradaki hiçbir prop özel not taşımıyor ve bileşenin `ozelNotApi`'ye giden
 * bir yolu yok. Bu bölüm not da ÇEKMİYOR: veri raporu Plan 4'ten beri
 * sunucuda üretiliyor ve sunucu onu yalnızca resmî not tablosundan kuruyor
 * (bkz. aşağıdaki "Danışan veri raporu" bölümü).
 *
 * # Bakiye neyi sayar
 *
 * Borç kuralı tek bir yerde yazılı: `web/src/borc.ts::borcaGirerMi` (tasarım
 * §5.1). Bir seans borca girer ⇔ durumu `geldi` YA DA `gelmedi` ∧ ödenmemiş
 * ∧ ücreti > 0 — terapist gelmeyen seansı ücretlendiriyor (kullanıcı kararı
 * 2026-09-25), bu artık uygulamanın bilmediği bir politika değil. `iptal` ve
 * `planlandi` hiçbir zaman sayılmaz. Bu bileşen kuralı KENDİ YAZMAZ,
 * `borcToplami(randevular)` çağırır — sunucudaki eşi (`ozet.rs`) ve Plan
 * B'deki dosya başlığı özeti aynı işlevi kullanacak. Etiket neyi saydığını
 * **yazar**: kapsamı söylemeyen bir "Bakiye: 0,00 TL", ücreti hiç girilmemiş
 * bir dosyada "borcu yok" diye okunur.
 *
 * # "Ödenmemiş" artık gerçek (Plan 4 Görev 2)
 *
 * Dal incelemesi I1'de `appointments.odendi`'nin hiçbir yazma yolu yoktu;
 * `!r.odendi` süzgeci hiçbir satırı elemiyordu ve etiket bunu açıkça
 * söylüyordu. Plan 4 Görev 1 `PATCH /api/randevular/{id}/odeme`'yi, Görev 2
 * seans panelinin alt satırındaki "Ödendi" kutusunu ekledi: süzgeç artık
 * gerçekten eliyor ve açıklama "gelinmiş ve ödenmemiş seanslar" diyor.
 *
 * Bölüm açıkken seans panelinin alt satırından bir seans "ödendi" ya da bir
 * durum işaretlenirse, çağıran (`AnaEkran` ya da `DanisanDosyasi`) bu
 * bölümün `randevular` listesini YERELDE yamar; bölüm yeniden çekilmez
 * (silinemez bir `goruntuleme` satırı). Bu bileşen yalnızca prop'tan
 * hesaplar.
 *
 * # Risk notu KATLANMIŞ gösterilir
 *
 * Önceki notlar panelinin kuralı (not içeriği yalnızca istenince açılır,
 * `seans/OncekiNotlar.tsx` N7) burada daha da güçlü geçerli: risk notu bu
 * ekrandaki en hassas tek alan ve terapist bu sekmeyi danışan odadayken
 * açabiliyor (telefon, onam, ek dosya işleri için). Notun var olduğu
 * görünür kalır — bağlam bu —, içeriği yalnızca istenince basılır.
 *
 * # Bu bölümün danışanı ÜRETİMDE DEĞİŞMEZ
 *
 * İki çağıran yolu da aynı invaryantı garanti eder: `AnaEkran`
 * (`useDanisanDosyasi`) `kart = kartVerisi.id === seciliDanisanId ?
 * kartVerisi : BOS_KART` türetip `{kart.dosya !== null && <DosyaBilgileri
 * … />}` ile, kendi `key`iyle basıyor; `DanisanlarSekmesi` → `DanisanDosyasi`
 * yolunda ise AYNI `kart` türetmesi `DanisanDosyasi`ye prop olarak geliyor ve
 * `DanisanDosyasi`nin kendisi `DanisanlarSekmesi`nin verdiği
 * `key={`danisan-${kart.dosya.id}`}` ile UNMOUNT/REMOUNT ediliyor. Her iki
 * yolda da danışan değiştiği anda bu bileşenin bir örneği ya doğrudan ya da
 * ebeveyni üzerinden UNMOUNT edilir; yani monte bir örneğin `danisan.id`'si
 * hiçbir zaman değişmez.
 *
 * Bunun sonucu, bu dosyadaki "danışan değişimi" savunmalarının
 * (`raporForm` ve `ekForm` türetmeleri, `RizaBolumu`'nün `key`'i)
 * bugün **ulaşılamaz** olmasıdır. Bilerek duruyorlar — birincil hat
 * gevşetilirse yük taşımaya başlarlar — ama bir koruma sözü olarak
 * sayılmamalılar: koruma yukarıdaki türetme + koşullu render'ın kendisidir
 * ve `AnaEkran.test.tsx` > "baska danisana gecince onceki kartin verisi
 * EKRANDA KALMAZ" testinde ölçülür. Buradaki sentetik `rerender` testleri
 * (`DosyaBilgileri.test.tsx`) "birincil hat unutulursa ne kalır" sorusunu
 * ölçüyor, "bugün ne çalışıyor" sorusunu değil.
 *
 * # Veri raporu SUNUCUDA üretilir, parolalı PDF olarak iner (Plan 4 Görev 7)
 *
 * Plan 3'te rapor burada düz `.txt` olarak üretiliyordu; sunucu ayrı bir
 * "kayıt" ucuyla yalnızca haberdar ediliyordu ve notlar `?limit=200`
 * tavanına takılıyordu. Artık:
 *
 * - "Danışan veri raporu dışa aktar" bir parola formu açar; iki alan
 *   eşleşmezse ya da parola `RAPOR_PAROLA_ASGARI` karakterden kısaysa istek
 *   **gitmez** (sunucu da aynı sınırı uygular; buradaki kontrol yalnızca
 *   gidiş-dönüşü kısaltır).
 * - İstek gidince iki alan state'ten **hemen** silinir — başarıda da
 *   hatada da. Sunucunun `400` ana parola reddinde silinen şey terapistin
 *   ANA PAROLASIDIR; DOM'da (`value` özniteliği) fazladan kalmamalı. Hata
 *   metni olduğu gibi `role="alert"` ile gösterilir.
 * - Alanlar `autocomplete="off"`: bu parola kullanıcının DEĞİL, danışanın
 *   parolasıdır. `new-password` tarayıcıya "bu site için yeni hesap parolası"
 *   der ve tarayıcı onu uygulamanın adresine KAYDETMEYİ önerebilir; kabul
 *   edilirse danışan parolası terapistin parola yöneticisinde bu uygulamanın
 *   girişi olarak durur ve bir gün ana parola alanına kendiliğinden dolar.
 *   (Tarayıcılar `off`'u parola alanlarında her zaman onurlandırmaz; bu bir
 *   ipucudur, güvence değil. Güvence sunucunun ana parola reddidir.)
 * - Form SATIR İÇİDİR (`role="group"`, modal değil): açılınca odak ilk
 *   parola alanına geçer — açan düğme DOM'dan kalktığı için aksi hâlde odak
 *   `body`'ye düşerdi —, Esc vazgeçer (istek uçuştayken değil), kapanınca
 *   (Vazgeç, Esc, başarı) odak "Danışan veri raporu dışa aktar" düğmesine
 *   döner.
 * - İndirmeyi, denetim kaydını ve 401 davranışını `danisanApi.veriRaporuIndir`
 *   ile sunucu üstleniyor; bu bileşen ne not çeker, ne metin kurar, ne Blob
 *   üretir. İstemcide rapor metni üretilemeyeceği `istemciRaporUretimi.test.ts`'te
 *   `web/src`'nin tamamında yapısal olarak ölçülüyor.
 * - Başlık ve açıklama Görev 7'de değişti: eski "Veri raporu — Danışanın
 *   kendi verisine erişim talebi için (KVKK md. 11)." KVKK madde numarasıyla
 *   açılan, denetim havası taşıyan bir cümleydi. Yenisi aynı bilgiyi (kim
 *   isteyebilir, ne biçimde gelir) düz cümleyle veriyor; özel notların
 *   rapora girmediği uyarısı — davranışsal bir gerçek, ton meselesi değil —
 *   korundu.
 */
type Props = {
  danisan: DanisanDosyasi
  ekler: EkBilgisi[]
  /** Bu danışanın **tüm** randevuları (yalnızca görünen hafta değil). */
  randevular: Randevu[]
  /** İstemcinin yerel takvim günü, `YYYY-AA-GG`. */
  bugun: string
  /**
   * Veri raporunu sunucudan parolalı PDF olarak indirir
   * (`danisanApi.veriRaporuIndir`; `bugun`'ü çağıran taraf TIKLAMA ANINDA
   * ekler). Hata sunucunun mesajıyla fırlatılır.
   */
  veriRaporuIndir: (danisanId: number, parola: string) => Promise<void>
  ekYukle: (dosya: File, tur: string) => Promise<void>
  /**
   * Eki **kalıcı olarak** siler (`danisanApi.ekSil`).
   *
   * Geri alınamaz bir işlem; bu yüzden iki adımlı onaydan geçer (bkz.
   * `ekSilmeOnayi`). Sunucu ayrıca sarkan `riza_dosya_id`'yi temizler ve
   * onay metni bunu söyler.
   */
  ekSil: (ekId: number) => Promise<void>
  onRizaKaydet: (alan: { riza_tarihi: string; riza_dosya_id: number | null }) => Promise<void>
  onKapat: () => void
}

const RISK_GOVDE_ID = 'danisan-risk-notu-govde'

/** Sunucunun `pdf::ASGARI_PAROLA` sınırı (karakter, bayt değil). */
const RAPOR_PAROLA_ASGARI = 8

type RaporFormu = {
  danisanId: number
  acik: boolean
  parola: string
  tekrar: string
  hata: string | null
  indirildi: boolean
}

function bosRaporFormu(danisanId: number): RaporFormu {
  return { danisanId, acik: false, parola: '', tekrar: '', hata: null, indirildi: false }
}

export function DosyaBilgileri({
  danisan,
  ekler,
  randevular,
  bugun,
  veriRaporuIndir,
  ekYukle,
  ekSil,
  onRizaKaydet,
  onKapat,
}: Props) {
  // Rapor formu HANGİ danışan için açıldığını taşıyor ve ekrana giden hâli
  // render sırasında türetiliyor (`ekFormu` ile aynı desen): A için yazılmış
  // bir parola B'nin bölümünde durup B'nin raporuna gitmemeli.
  // İKİNCİL HAT — bölüm danışan değişince zaten unmount ediliyor (bkz. modül
  // başlığı).
  const [raporFormu, setRaporFormu] = useState<RaporFormu>(() => bosRaporFormu(danisan.id))
  const raporForm =
    raporFormu.danisanId === danisan.id ? raporFormu : bosRaporFormu(danisan.id)
  const [raporSuruyor, setRaporSuruyor] = useState(false)
  // Odak yönetimi (bkz. modül başlığı). YALNIZCA açık/kapalı GEÇİŞİNDE
  // odak taşınır: ilk mount'ta ya da hata sonrası form açık kalırken değil.
  const raporDugmesi = useRef<HTMLButtonElement>(null)
  const raporParolaAlani = useRef<HTMLInputElement>(null)
  const raporOncekiAcik = useRef(raporForm.acik)
  useEffect(() => {
    if (raporForm.acik === raporOncekiAcik.current) return
    raporOncekiAcik.current = raporForm.acik
    if (raporForm.acik) raporParolaAlani.current?.focus()
    else raporDugmesi.current?.focus()
  }, [raporForm.acik])
  const [ekSuruyor, setEkSuruyor] = useState(false)
  // Ek indirme hatası. İndirme artık `fetch`'ten geçtiği için (bkz.
  // `api.ekIndir`) hata sessizce yutulamaz: eskiden tarayıcı gezinip ham
  // JSON'u ekrana basıyordu, artık kullanıcıya burada söyleniyor.
  const [indirmeHatasi, setIndirmeHatasi] = useState<string | null>(null)
  // Ek silme GERİ ALINAMAZ: BLOB gider, yedek dışında dönüşü yok. Bu yüzden
  // iki adımlı onay — randevu/seri silme ve danışan arşivleme ile aynı desen.
  //
  // Onay state'i ONAYLANAN EKİN KENDİSİDİR, bir `boolean` ya da çıplak `id`
  // değil. Görev 10 inceleme Bulgu 1'de panelin iç state'i bir seçimden
  // diğerine sızıyordu ve çözüm state'i seçime bağlamaktı (`key` prop'u).
  // Burada aynı ilke, state seçimi kendisi taşıyacak biçimde: başka bir ekin
  // "Sil"ine basmak onayı devretmez, tümüyle değiştirir ve onay metni her
  // zaman state'teki ekin adını gösterir. Çıplak bir bayrakla, A'nın onayı
  // açıkken B'nin satırındaki "Evet, sil" A'yı silerdi.
  const [ekSilmeOnayi, setEkSilmeOnayi] = useState<EkBilgisi | null>(null)
  const [ekSilmeSuruyor, setEkSilmeSuruyor] = useState(false)
  const [ekSilmeHatasi, setEkSilmeHatasi] = useState<string | null>(null)
  // Risk notu KAPALI açılır (gerekçe modül başlığında). State, HANGİ
  // danışan için açıldığını taşıyor ve ekrana giden hâli render sırasında
  // türetiliyor — `ekFormu` ile aynı desen. Düz bir `boolean` olsaydı,
  // A'nın notunu açtıktan sonra B'ye geçmek B'nin risk notunu SORULMADAN
  // ekrana basardı. (İkincil hat: bölüm bugün zaten unmount ediliyor,
  // bkz. modül başlığı.)
  const [riskAcikOlan, setRiskAcikOlan] = useState<number | null>(null)
  const riskAcik = riskAcikOlan === danisan.id
  // Yükleme formu HANGİ danışan için doldurulduğunu taşıyor ve ekrana giden
  // hâli render sırasında türetiliyor (aşağıda). A için seçilmiş bir dosya
  // B'nin bölümünde durursa, "Yükle"ye basmak o dosyayı B'nin dosyasına
  // ekler — yanlış danışanın dosyasına belge. Sıfırlamayı bir efekte
  // bırakmak, seçim değişimi ile efekt arasındaki karede aynı riski açık
  // bırakırdı (`AnaEkran`'daki `seansVerisi` ile aynı gerekçe).
  //
  // İKİNCİL HAT — `raporForm` ile aynı durumda (bkz. modül başlığı).
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

  // Borç kuralı TEK yerde (bkz. modül başlığı, `../borc`). `odendi` seans
  // panelinin alt satırından yazılıyor (Plan 4 Görev 2).
  const bakiyeKurus = borcToplami(randevular)

  const kalan = danisan.saklama_bitis === null ? null : kalanGun(bugun, danisan.saklama_bitis)

  async function raporOlustur() {
    const { parola, tekrar } = raporForm
    // Karakter sayısı sunucuyla AYNI birimde: `[...dizgi]` kod noktası
    // sayar (Rust `chars()`); `.length` UTF-16 birimi sayardı.
    if ([...parola].length < RAPOR_PAROLA_ASGARI) {
      setRaporFormu({
        ...raporForm,
        hata: `Rapor parolası en az ${RAPOR_PAROLA_ASGARI} karakter olmalı.`,
      })
      return
    }
    if (parola !== tekrar) {
      setRaporFormu({ ...raporForm, hata: 'Parolayı tekrar girin: iki parola eşleşmiyor.' })
      return
    }
    // Parola istek gider gitmez STATE'TEN (dolayısıyla DOM'dan) silinir —
    // başarıda da hatada da (bkz. modül başlığı). Yerel `parola` değişkeni
    // bu fonksiyonun ömrüyle sınırlı.
    setRaporFormu({ ...raporForm, parola: '', tekrar: '', hata: null, indirildi: false })
    setRaporSuruyor(true)
    try {
      await veriRaporuIndir(danisan.id, parola)
      setRaporFormu({ ...bosRaporFormu(danisan.id), indirildi: true })
    } catch (e) {
      setRaporFormu({
        ...bosRaporFormu(danisan.id),
        acik: true,
        hata: e instanceof Error ? e.message : 'Veri raporu oluşturulamadı.',
      })
    } finally {
      setRaporSuruyor(false)
    }
  }

  async function ekiSil(ek: EkBilgisi) {
    setEkSilmeSuruyor(true)
    setEkSilmeHatasi(null)
    try {
      await ekSil(ek.id)
      setEkSilmeOnayi(null)
    } catch (e) {
      setEkSilmeHatasi(e instanceof Error ? e.message : 'Dosya silinemedi.')
    } finally {
      setEkSilmeSuruyor(false)
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
      // Danışanın ADI burada başlık olarak BASILMIYOR (son inceleme I2): ad
      // artık `DanisanDosyasi`'nin başlığında, iki alt sekmede de görünür.
      // Burada ikinci kez basmak Bilgiler'de aynı adlı iki başlık demekti.
      aria-label="Danışan bilgileri"
      className="mt-4 rounded-lg border border-slate-300 p-4"
    >
      <div className="mb-3 flex items-start justify-end gap-3">
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
        {/* KATLANMIŞ — önceki notlar panelindeki gerekçe (içerik yalnızca
            istenince), daha güçlüsüyle: risk notu ("geçmişte bir kez kendine zarar verme")
            bu ekrandaki en hassas tek alan ve terapist bu sekmeyi danışan
            odadayken açabilir (telefon, onam, ek dosya işleri için).
            Kendiliğinden basılan bir risk notu, omzun üstünden okunabilir
            hâle gelir. Notun VAR OLDUĞU görünür kalıyor (bağlam bu),
            içeriği ancak istenince açılıyor. */}
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
        <dt className="font-medium text-slate-600">Bakiye</dt>
        <dd>{tlMetni(bakiyeKurus)}</dd>
      </dl>
      {/* Açıklama hem neyi SAYDIĞINI hem neyi SAYMADIĞINI yazıyor; çıplak
          "Bakiye" yanıltıcı olurdu. Tasarım §5.1 (kullanıcı kararı
          2026-09-25): terapist gelmeyen seansı ücretlendiriyor, dolayısıyla
          "gelmedi" artık İÇERİDE — dışarıda kalan yalnızca `iptal`. Cümle
          `borcaGirerMi` ile AYNI kuralı Türkçe anlatıyor; ikisi ayrışırsa
          `DosyaBilgileri.test.tsx` kırılır.
          "ödenmemiş" ibaresi I1'de kaldırılmıştı (o gün işaretleme yolu
          yoktu); Plan 4 Görev 2 seans panelinin alt satırına "Ödendi"
          kutusunu ekledi ve ibare GERİ GELDİ — artık doğru. */}
      <p className="mt-1 text-xs text-slate-500">
        {'Bakiye: ücreti girilmiş ve ödenmemiş, gelinen ya da gelinmeyen seanslar. İptal edilenler girmez.'}
      </p>

      <div className="mt-3">
        <RizaBolumu
          // `key`: onam formu prop'lardan İLK MOUNT'ta dolduruluyor. Danışan
          // değişip bileşen yeniden mount edilmezse A'nın onam tarihi B'nin
          // formunda durur ve "Kaydet" B'ye A'nın tarihini yazardı.
          //
          // İKİNCİL HAT — bugün ULAŞILAMAZ: bu bölümün kendisi danışan
          // değişince unmount ediliyor (bkz. modül başlığı), dolayısıyla
          // `RizaBolumu` de her seferinde taze mount oluyor ve bu `key`
          // hiçbir zaman değişmiyor. Ölçüldüğü tek yer sentetik `rerender`
          // testi (`DosyaBilgileri.test.tsx` > "A nin riza tarihi B nin
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
            söylüyor ki "uygulama halleder" beklentisi oluşmasın. Bu cümle
            bir uyarı DEĞİL, ürün sözü — Görev 7'de KALDI. */}
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
                </span>{' '}
                {/* Erişilebilir ad dosyanın ADINI taşır: listede beş dosya
                    varken beş özdeş "Sil" düğmesi, ekran okuyucu
                    kullanıcısına hangisinin ne olduğunu yalnızca GÖRSEL
                    bağlamdan bıraktırırdı — yıkıcı bir işlemde kabul
                    edilemez (aynı gerekçe `AnaEkran`'ın "Arşivle"
                    düğmesinde). Dosya adı zaten bu satırda ekranda. */}
                <button
                  type="button"
                  className="text-slate-500 underline disabled:opacity-50"
                  aria-label={`${ek.dosya_adi} dosyasını sil`}
                  disabled={ekSilmeSuruyor}
                  onClick={() => {
                    setEkSilmeHatasi(null)
                    setEkSilmeOnayi(ek)
                  }}
                >
                  Sil
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* İki adımlı onay. Metin ne olduğunu ve YAN ETKİSİNİ birlikte
            söylüyor: silme geri alınamaz VE sunucudaki `attachments::sil`
            sarkan `riza_dosya_id`'yi aynı transaction'da temizler. İkincisi
            yazılmazsa, rıza belgesini silen kullanıcı rıza bölümündeki bağın
            neden koptuğunu hiçbir yerden öğrenemezdi. `riza_tarihi`
            korunuyor — rızanın alındığı gerçeği dosyayla birlikte gitmez. */}
        {ekSilmeOnayi && (
          <div className="mt-2 rounded bg-amber-50 p-2">
            <p className="text-sm text-amber-900">
              {ekSilmeOnayi.dosya_adi} kalıcı olarak silinsin mi? Dosyanın içeriği geri
              alınamaz. Bu dosya danışanın rıza belgesi olarak işaretliyse rıza bağı da
              kaldırılır; rıza tarihi kaydı silinmez.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="rounded bg-amber-700 px-3 py-1 text-sm text-white disabled:opacity-50"
                disabled={ekSilmeSuruyor}
                onClick={() => void ekiSil(ekSilmeOnayi)}
              >
                Evet, sil
              </button>
              <button
                type="button"
                className="rounded border px-3 py-1 text-sm"
                disabled={ekSilmeSuruyor}
                onClick={() => setEkSilmeOnayi(null)}
              >
                Vazgeç
              </button>
            </div>
          </div>
        )}
        {ekSilmeHatasi && (
          <p role="alert" className="mt-1 text-red-600">
            {ekSilmeHatasi}
          </p>
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
        <h3 className="font-semibold">Danışan veri raporu</h3>
        {/* Görev 7: KVKK madde numarasıyla açılan denetim havalı cümle
            ("Danışanın kendi verisine erişim talebi için (KVKK md. 11).")
            kaldırıldı; aynı bilgi düz, bilgilendirici bir cümleyle veriliyor.
            Özel notların rapora girmediği uyarısı KALDI — bu davranışsal bir
            gerçek, ton meselesi değil. Son inceleme I2: seans etiketlerinin
            rapora GİRDİĞİ de aynı yerde söyleniyor (kullanıcının kararı:
            etiketler rapora girer); terapist neyin danışana gittiğini tek
            cümlede görür. */}
        <p className="mt-1 text-slate-600">
          Danışan kendi kaydını isterse, parola korumalı bir PDF olarak verilir. Seans
          etiketleri rapora dahil edilir; terapistin özel notları dahil edilmez.
        </p>
        {!raporForm.acik && (
          <button
            ref={raporDugmesi}
            type="button"
            className="mt-2 rounded border px-3 py-1 text-sm disabled:opacity-50"
            disabled={raporSuruyor}
            // Açmak state'i SIFIRLAMAZ, yalnızca görünür kılar: parolayı
            // silmenin tek yeri istek anı ve sonucu (bkz. `raporOlustur`).
            // Sıfırlayan bir "aç", sonuç yolundaki temizliği ölçülemez kılardı.
            onClick={() =>
              setRaporFormu({ ...raporForm, acik: true, hata: null, indirildi: false })
            }
          >
            Danışan veri raporu dışa aktar
          </button>
        )}
        {raporForm.acik && (
          <form
            // Satır içi form: `dialog` değil (odak hapsi ve `aria-modal` yok).
            role="group"
            aria-labelledby="veri-raporu-parola-basligi"
            className="mt-2 rounded border border-slate-300 p-3"
            onKeyDown={(e) => {
              if (e.key !== 'Escape' || raporSuruyor) return
              e.preventDefault()
              setRaporFormu(bosRaporFormu(danisan.id))
            }}
            onSubmit={(e) => {
              e.preventDefault()
              void raporOlustur()
            }}
          >
            <h4 id="veri-raporu-parola-basligi" className="font-medium">
              Rapor parolası belirleyin
            </h4>
            <p className="mt-1 text-slate-600">
              Rapor bu parolayla şifrelenmiş PDF olarak iner. Bu parolayı danışana ayrıca
              iletin. Ana parolanızı kullanmayın.
            </p>
            <label className="mt-2 block" htmlFor="rapor-parolasi">
              Rapor parolası
            </label>
            <input
              ref={raporParolaAlani}
              id="rapor-parolasi"
              type="password"
              // Danışanın parolası: tarayıcı kaydetmesin (bkz. modül başlığı).
              autoComplete="off"
              className="mt-1 rounded border p-1"
              disabled={raporSuruyor}
              value={raporForm.parola}
              onChange={(e) =>
                setRaporFormu({ ...raporForm, parola: e.target.value, hata: null })
              }
            />
            <label className="mt-2 block" htmlFor="rapor-parolasi-tekrar">
              Parolayı tekrar girin
            </label>
            <input
              id="rapor-parolasi-tekrar"
              type="password"
              autoComplete="off"
              className="mt-1 rounded border p-1"
              disabled={raporSuruyor}
              value={raporForm.tekrar}
              onChange={(e) =>
                setRaporFormu({ ...raporForm, tekrar: e.target.value, hata: null })
              }
            />
            <div className="mt-2 flex gap-2">
              <button
                type="submit"
                className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                disabled={raporSuruyor}
              >
                Raporu oluştur
              </button>
              <button
                type="button"
                className="rounded border px-3 py-1 text-sm"
                disabled={raporSuruyor}
                onClick={() => setRaporFormu(bosRaporFormu(danisan.id))}
              >
                Vazgeç
              </button>
            </div>
            {raporForm.hata && (
              <p role="alert" className="mt-1 text-red-600">
                {raporForm.hata}
              </p>
            )}
          </form>
        )}
        {raporForm.indirildi && (
          <p role="status" className="mt-2 text-slate-700">
            Rapor şifreli PDF olarak indirildi. Parolayı danışana ayrıca iletin.
          </p>
        )}
      </div>
    </section>
  )
}
