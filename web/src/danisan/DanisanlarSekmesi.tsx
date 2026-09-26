import { useEffect, useRef, useState, type KeyboardEvent as TusOlayi } from 'react'
import { useDakikalikSimdi, yerelGun } from '../screens/anaEkranKancalari/yerelGun'
import type { useDanisanDosyasi } from '../screens/anaEkranKancalari/useDanisanDosyasi'
import type { useDanisanListesi } from '../screens/anaEkranKancalari/useDanisanListesi'
import type { useDanisanSeanslari } from '../screens/anaEkranKancalari/useDanisanSeanslari'
import type { useDosyaNotu } from '../screens/anaEkranKancalari/useDosyaNotu'
import type { EtiketBaglami } from '../etiket/EtiketSatiri'
import { DanisanDosyasi, type DosyaAltSekme } from './DanisanDosyasi'
import { danisanSuz } from './danisanAramasi'

/**
 * Danışanlar sekmesi: solda danışan listesi, sağda açık danışanın dosyası
 * (Plan 5 Görev 5 — ürün amacı: "terapist bir danışana tıkladığında o
 * danışanın dosyası açılsın").
 *
 * # İKİ KOLON, `AnaEkran`'daki YIĞINLI düzenin yerine
 *
 * Eskiden danışan çipleri ve açık kart AnaEkran'da alt alta, tam genişlikte
 * duruyordu (kart açıksa sayfa aşağı kayar, liste gözden kaybolurdu). Bu
 * bileşen ikisini `grid grid-cols-[18rem_1fr]` ile YAN YANA koyar: liste
 * her zaman görünür kalır, kart onun yanında açılır.
 *
 * # Sol kolon: arama, ekleme, liste (tasarım B1)
 *
 * Liste yalnızca AKTİF danışanlar (sunucu arşivi göndermez). Tepedeki
 * "Danışan ara…" kutusu ekrandaki listeyi `danisanAramasi.ts::danisanSuz`
 * ile (tasarım §5.2 Türkçe katlama, `katla.ts`) süzer: istek YOK, denetim
 * satırı YOK. Kutudayken ↑/↓ vurguyu taşır, Enter vurgulu dosyayı açar, Esc
 * temizler. Eşleşme yoksa "'<ad>' adıyla yeni danışan ekle" kısayolu formu o
 * adla açar; altındaki sabit satır arşivin burada aranmadığını, ⌘K'nın
 * taradığını söyler.
 *
 * Bilinen sınır: kutunun `aria-activedescendant`'ı düz bir `<ul>` içindeki
 * açma düğmesini gösteriyor (listbox/option değil); ekran okuyucular vurgu
 * değişimini duyurmayabilir. Listbox rolü, listeyi `getByRole('list')` ile
 * bulan testleri (ör. `AnaEkran.test.tsx` arşiv testleri) ve düğmelerin
 * kendi rollerini değiştirirdi; bilerek yapılmadı.
 *
 * İmleç arama kutusuna KENDİLİĞİNDEN gitmez (A6 kullanıcı kararı). Ekleme
 * formunun ad alanına yalnızca kullanıcı formu AÇINCA gider
 * (`adOdakIstegi`). Enter kaydeder, Esc kapatır. `ekle()` POST yanıtındaki
 * danışanı döndürür ve dosya o kimlikle açılır.
 *
 * Kolon kendi içinde kayar (`sticky top-0 self-start max-h-[100dvh]
 * overflow-y-auto`). `liste` kancası (`useDanisanListesi`) hâlâ `AnaEkran`'da
 * çağrılıyor ve bu bileşen yalnızca SONUCU görüyor. Arama ve vurgu bu
 * bileşenin yerel durumu: sekmeden çıkınca sıfırlanır; dönüşte liste
 * "eksik" görünmez.
 *
 * # Sağ kolon: `DanisanDosyasi` (Seanslar/Bilgiler alt sekmeleri, Görev 6)
 *
 * `seanslar` (`useDanisanSeanslari`) ve `dosyaNotu` (`useDosyaNotu`)
 * `AnaEkran`'da çağrılan kancaların dönüşleri; bu bileşen onları ve
 * `AnaEkran`'ın TEK yazma yollarını (`onNotKaydet`, `onDurumDegis`,
 * `onOdemeDegis`) `DanisanDosyasi`ye bağlıyor. `DanisanDosyasi`nin Seanslar
 * alt sekmesi solda `SeansListesi`yi, sağda seçili seansın notunu gösterir. "Bilgiler"
 * alt sekmesi `DosyaBilgileri`yi barındırıyor (eskiden `DanisanKarti`;
 * Görev 7 aynı içeriği taşıyıp KVKK uyarı dilini bilgi diline çevirdi).
 *
 * Eskiden burada `data-seans-sayisi` diye GEÇİCİ bir test probu vardı
 * (Görev 5): seans verisi henüz render edilmediği için akışın tek kanıtı
 * bir öznitelikti. Bu görev probu KALDIRDI; testler artık gerçek render'ı
 * (`SeansListesi`nin ekrana bastığı satırları) ölçüyor.
 */
export function DanisanlarSekmesi({
  liste,
  dosya,
  seanslar,
  dosyaNotu,
  altSekme,
  onAltSekme,
  onDanisanSec,
  veriRaporuIndir,
  onNotKaydet,
  onDurumDegis,
  onOdemeDegis,
  etiketBaglami,
}: {
  liste: ReturnType<typeof useDanisanListesi>
  dosya: ReturnType<typeof useDanisanDosyasi>
  /**
   * Açık danışanın seans listesi, seçimi ve yükleme hatası
   * (`useDanisanSeanslari`, `AnaEkran`'da çağrılıyor). Sağ kolondaki
   * `DanisanDosyasi`nin Seanslar alt sekmesinde ekrana basılıyor.
   */
  seanslar: ReturnType<typeof useDanisanSeanslari>
  /** Seçili seansın notu (`useDosyaNotu`, `AnaEkran`'da çağrılıyor). */
  dosyaNotu: ReturnType<typeof useDosyaNotu>
  altSekme: DosyaAltSekme
  onAltSekme: (sekme: DosyaAltSekme) => void
  onDanisanSec: (clientId: number) => void
  veriRaporuIndir: (danisanId: number, parola: string) => Promise<void>
  /** `AnaEkran`'ın TEK yazma yolları (son inceleme C1/C2). */
  onNotKaydet: (appointmentId: number, kayit: { sablon: string; icerik: string }) => Promise<void>
  onDurumDegis: (appointmentId: number, durum: string) => Promise<void>
  onOdemeDegis: (appointmentId: number, odendi: boolean) => Promise<void>
  /**
   * Seçili seansın etiketleri (`AnaEkran.etiketBaglami`, Plan 6 Görev 6) —
   * takvim seans paneliyle AYNI önbellek ve AYNI yazma yolu (bkz.
   * `useEtiketler` modül başlığı).
   */
  etiketBaglami: (appointmentId: number) => EtiketBaglami
}) {
  const { seciliDanisanId, kart } = dosya
  // Dosya özetinin ve liste düzeninin "şimdi"si: uygulamanın TEK kaynağı,
  // dakikada bir yenilenir (`TakvimSekmesi` emsali: kanca sekme
  // bileşeninde, `AnaEkran`'da değil; görünmeyen sekme tiklemez).
  const simdi = useDakikalikSimdi()
  // Yerel değişkene alınıyor: `liste.arsivOnayi` üzerinden daralan tür bir
  // callback'in içine taşınmaz, `AnaEkran`'daki gerekçeyle aynı (onay
  // metniyle "Evet, arşivle"nin AYNI danışanı görmesi bu satırla garanti).
  const { arsivOnayi } = liste

  // Arama (tasarım B1). `vurgu`: vurgulu satırın süzülmüş listedeki sırası.
  const [sorgu, setSorgu] = useState('')
  const [vurgu, setVurgu] = useState<number | null>(null)
  const suzulmus = danisanSuz(liste.danisanlar, sorgu)
  const etkinVurgu =
    vurgu === null || suzulmus.length === 0 ? null : Math.min(vurgu, suzulmus.length - 1)
  const vurguluId = etkinVurgu === null ? null : suzulmus[etkinVurgu].id
  const vurguluSatirRef = useRef<HTMLLIElement>(null)
  // Oklarla gezilen satır kendi içinde kayan kolonda görünür kalır. Açılışta
  // vurgu yok, yani sekmeye gelmek KAYDIRMAZ.
  useEffect(() => {
    if (vurguluId !== null) vurguluSatirRef.current?.scrollIntoView({ block: 'nearest' })
  }, [vurguluId])

  // Ad alanına odak YALNIZCA kullanıcı formu açınca ("Danışan ekle" ya da
  // kısayol). Sayaç bileşenle birlikte sıfırlanır: form açıkken sekmeye geri
  // dönmek (yeniden monte) imleci kendiliğinden bir alana GÖTÜRMEZ. `autoFocus`
  // bu ayrımı yapamazdı.
  const [adOdakIstegi, setAdOdakIstegi] = useState(0)
  const adAlaniRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (adOdakIstegi > 0) adAlaniRef.current?.focus()
  }, [adOdakIstegi])

  function sorguDegisti(yeni: string) {
    setSorgu(yeni)
    // Yazınca ilk eşleşme vurgulanır: "ayşe" + Enter ilk Ayşe'yi açar.
    setVurgu(yeni.trim() === '' ? null : 0)
  }

  function aramaTusu(olay: TusOlayi<HTMLInputElement>) {
    // IME birleştirmesi sürerken (macOS'ta "kâ": ölü tuş ya da basılı
    // tutma) Enter bir harfi onaylar, dosya açmaz; Esc birleştirmeyi iptal
    // eder, aramayı silmez. `keyCode` 229: Safari birleştirmeyi bitiren
    // keydown'da `isComposing`'i `false` verir (bkz. `EtiketSatiri.tsx`).
    if (olay.nativeEvent.isComposing || olay.keyCode === 229) return
    const n = suzulmus.length
    if (olay.key === 'ArrowDown') {
      olay.preventDefault()
      if (n > 0) setVurgu(etkinVurgu === null ? 0 : Math.min(etkinVurgu + 1, n - 1))
    } else if (olay.key === 'ArrowUp') {
      olay.preventDefault()
      if (n > 0) setVurgu(etkinVurgu === null ? n - 1 : Math.max(etkinVurgu - 1, 0))
    } else if (olay.key === 'Enter') {
      olay.preventDefault()
      if (vurguluId !== null) onDanisanSec(vurguluId)
    } else if (olay.key === 'Escape') {
      olay.preventDefault()
      setSorgu('')
      setVurgu(null)
    }
  }

  function formuAc(ad?: string) {
    if (ad !== undefined) liste.setYeniAdSoyad(ad)
    liste.setFormAcik(true)
    setAdOdakIstegi((n) => n + 1)
  }

  // `ekle()` POST yanıtındaki danışanı döndürür; dosya O kimlikle açılır ve
  // arama temizlenir (yeni danışan, düzeltilmiş adla da görünür kalsın).
  async function ekleVeAc() {
    const yeni = await liste.ekle()
    if (yeni === null) return
    setSorgu('')
    setVurgu(null)
    onDanisanSec(yeni.id)
  }

  return (
    <div className="grid grid-cols-[18rem_1fr] gap-6" data-testid="danisanlar-sekmesi">
      {/* SOL KOLON — arama (tasarım B1), ekleme formu, liste. Kendi içinde
          kayar: uzun listede sağdaki dosya yerinde kalır. `self-start`
          ZORUNLU: ızgara hücresi varsayılan olarak satır boyuna gerilir ve
          gerilen öğenin yapışacak yeri kalmaz. */}
      <div
        data-testid="danisan-listesi-sutunu"
        className="sticky top-0 self-start max-h-[100dvh] overflow-y-auto"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-600">Danışanlar</span>
          <button
            type="button"
            className="rounded border px-3 py-1 text-sm"
            onClick={() => (liste.formAcik ? liste.setFormAcik(false) : formuAc())}
          >
            Danışan ekle
          </button>
        </div>

        {/* İmleç buraya KENDİLİĞİNDEN gelmez; süzme yalnızca ekranda. */}
        <input
          type="search"
          aria-label="Danışan ara"
          placeholder="Danışan ara…"
          aria-controls={suzulmus.length > 0 ? 'danisan-listesi' : undefined}
          aria-activedescendant={vurguluId === null ? undefined : `danisan-ac-${vurguluId}`}
          className="mt-3 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={sorgu}
          onChange={(olay) => sorguDegisti(olay.target.value)}
          onKeyDown={aramaTusu}
        />

        {liste.formAcik && (
          // `<form>`: Enter iki alanda da kaydeder (örtük gönderim), Esc kapatır.
          <form
            className="mt-2 flex flex-col items-start gap-2"
            onSubmit={(olay) => {
              olay.preventDefault()
              void ekleVeAc()
            }}
            onKeyDown={(olay) => {
              if (olay.key !== 'Escape') return
              olay.preventDefault()
              liste.setFormAcik(false)
            }}
          >
            <div>
              <label className="block text-sm" htmlFor="yeni-danisan-ad-soyad">
                Ad soyad
              </label>
              <input
                id="yeni-danisan-ad-soyad"
                ref={adAlaniRef}
                className="mt-1 w-full rounded border p-2"
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
                className="mt-1 w-full rounded border p-2"
                value={liste.yeniTelefon}
                onChange={(e) => liste.setYeniTelefon(e.target.value)}
              />
            </div>
            {/* Uçuştayken devre dışı (inceleme M1): devre dışı varsayılan
                düğme Enter'la örtük gönderimi de durdurur. Asıl kilit
                kancada (`useDanisanListesi.ekle`). */}
            <button
              type="submit"
              className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
              disabled={liste.ekleniyor}
            >
              Ekle
            </button>
          </form>
        )}

        {liste.hata && <p className="mt-1 text-sm text-red-600">{liste.hata}</p>}
        {/* `role="status"`: arşivleme sonucu ekranda sessizce beliriyordu.
            Ekran okuyucu kullanıcısı düğmeye bastıktan sonra hiçbir şey
            duymuyor, danışanın listeden düşmesini de göremiyordu. */}
        {liste.arsivBilgisi && (
          <p role="status" className="mt-1 text-sm text-slate-600">
            {liste.arsivBilgisi}
          </p>
        )}

        {suzulmus.length > 0 && (
          <ul id="danisan-listesi" className="mt-2 flex flex-col gap-2 text-sm text-slate-700">
            {suzulmus.map((d) => {
              const vurgulu = d.id === vurguluId
              return (
                <li
                  key={d.id}
                  ref={vurgulu ? vurguluSatirRef : undefined}
                  // Son inceleme I2: açık dosyanın danışanı GÖRSEL olarak da
                  // vurgulanır — eskiden yalnızca `aria-current` taşıyordu.
                  data-secili={d.id === seciliDanisanId ? 'evet' : undefined}
                  // Klavye vurgusu (B1) seçimden AYRI: halka ile gösterilir.
                  // `ring-inset`: kolonun `overflow-y-auto`'su (overflow-x de
                  // `auto` hesaplanır) dışa taşan halkanın iki yanını kırpardı.
                  data-vurgulu={vurgulu ? 'evet' : undefined}
                  className={
                    'flex items-center justify-between gap-2 rounded border-l-4 px-3 py-1 ' +
                    (d.id === seciliDanisanId
                      ? 'border-slate-900 bg-slate-200 font-semibold'
                      : 'border-transparent bg-slate-100') +
                    (vurgulu ? ' ring-2 ring-inset ring-sky-400' : '')
                  }
                >
                  {/* Erişilebilir ad "Ayşe Yılmaz dosyasını aç": takvimdeki
                      randevu bloğunun adı düz "Ayşe Yılmaz" ve iki özdeş adlı
                      düğme hem ekran okuyucu kullanıcısını hem de ada göre
                      arayan testleri belirsiz bırakırdı. `id`: arama
                      kutusunun `aria-activedescendant`'ı. */}
                  <button
                    type="button"
                    id={`danisan-ac-${d.id}`}
                    className="underline"
                    aria-label={`${d.ad_soyad} dosyasını aç`}
                    aria-current={d.id === seciliDanisanId ? 'true' : undefined}
                    onClick={() => onDanisanSec(d.id)}
                  >
                    {d.ad_soyad}
                  </button>
                  {/* Erişilebilir ad danışanın ADINI taşır (bkz. AnaEkran'daki
                      aynı gerekçe: on özdeş "Arşivle" düğmesi ekran okuyucu
                      kullanıcısı için ayırt edilemezdi). */}
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
              )
            })}
          </ul>
        )}

        {sorgu.trim() !== '' && suzulmus.length === 0 && (
          <div className="mt-2 text-sm">
            <button type="button" className="text-left underline" onClick={() => formuAc(sorgu.trim())}>
              {`'${sorgu.trim()}' adıyla yeni danışan ekle`}
            </button>
            <p className="mt-1 text-xs text-slate-500">
              Arşivlenmiş danışanlar bu listede aranmaz; ⌘K hızlı arama arşivi de tarar.
            </p>
          </div>
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

      {/* SAĞ KOLON — dosya. Bkz. modül başlığı. */}
      <div data-testid="danisan-dosyasi-sag-kolon">
        {seciliDanisanId === null && (
          // Ürün amacı burada: "terapist bir danışana tıkladığında o
          // danışanın dosyası açılsın" — hiçbir şey seçilmemişken sağ kolon
          // boş bir alan DEĞİL, ne yapılacağını söyleyen bir yönlendirme.
          <p className="text-sm text-slate-500">
            Bir danışanın dosyasını açmak için soldaki listeden bir danışan seçin.
          </p>
        )}

        {seciliDanisanId !== null &&
          (kart.hata !== null ? (
            // Yükleme başarısızsa kart AÇILMAZ: yarı dolu bir danışan kartı
            // (rıza alanı boş görünen) "rıza alınmamış" diye okunurdu.
            <div role="alert" className="rounded border border-red-300 bg-red-50 p-3">
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
              <DanisanDosyasi
                // Bkz. AnaEkran.tsx'teki aynı gerekçe: birincil hat
                // (`kart` türetmesi + bu koşullu render) danışan değişince
                // `kart.dosya`'yı `null` yapıp bileşeni unmount ediyor; bu
                // `key` bugün ulaşılamaz ama gevşeyen bir türetmede yük
                // taşımaya hazır duruyor. (`DanisanDosyasi` artık kendi
                // state'i olmayan bir bileşen: seçili seans, not ve alt
                // sekme kancalarda/`AnaEkran`'da — son inceleme M1.)
                key={`danisan-${kart.dosya.id}`}
                kart={kart}
                seanslar={seanslar.seanslar}
                yuklendi={seanslar.yuklendi}
                seansHata={seanslar.hata}
                onSeansYenidenDene={seanslar.yenidenDene}
                seciliSeansId={seanslar.seciliSeansId}
                onSeansSec={(id) => seanslar.seansSec(seciliDanisanId, id)}
                not={dosyaNotu.not}
                notHata={dosyaNotu.hata}
                onNotYenidenDene={dosyaNotu.yenidenDene}
                onNotKaydet={onNotKaydet}
                onDurumDegis={onDurumDegis}
                onOdemeDegis={onOdemeDegis}
                altSekme={altSekme}
                onAltSekme={onAltSekme}
                bugun={yerelGun(new Date())}
                simdi={simdi}
                veriRaporuIndir={veriRaporuIndir}
                ekYukle={dosya.ekYukle}
                ekSil={dosya.ekSil}
                onRizaKaydet={dosya.rizaKaydet}
                onKapat={dosya.kapat}
                etiketBaglami={etiketBaglami}
              />
            )
          ))}
      </div>
    </div>
  )
}
