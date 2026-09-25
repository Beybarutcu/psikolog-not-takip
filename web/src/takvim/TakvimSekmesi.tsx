import { useEffect, useRef, useState } from 'react'
import { aramaApi, takvimApi, type Danisan, type Etiket } from '../api'
import type { EtiketBaglami } from '../etiket/EtiketSatiri'
import { HizliArama } from '../arama/HizliArama'
import { AyOzeti } from '../ozet/AyOzeti'
import { SeansAltSatiri } from '../seans/SeansAltSatiri'
import { SeansPaneli } from '../seans/SeansPaneli'
import { useDakikalikSimdi } from '../screens/anaEkranKancalari/yerelGun'
import type { useSeansNotlari } from '../screens/anaEkranKancalari/useSeansNotlari'
import type { useTakvimAkisi } from '../screens/anaEkranKancalari/useTakvimAkisi'
import { bugunOzeti } from './bugun'
import { HaftalikTakvim, type Randevu } from './HaftalikTakvim'
import { haftaBasligi, haftaninBasi, zamandanDate } from './hafta'
import { RandevuPaneli } from './RandevuPaneli'

/**
 * Takvim sekmesi: ürünün asıl işi (Görev 3 ürün kararı). Eskiden takvim ana
 * ekranın EN ALTINDA, ay özeti kutusunun ve yedekleme/parola panellerinin
 * ARKASINDA duruyordu — bu bileşen onu kendi sekmesine alıp en üste
 * çıkarıyor. Sekme geçişi (hangi sekmenin göründüğü) `AnaEkran`da bağlanır
 * (Görev 8, bkz. o dosyanın modül başlığı): bu bileşen yalnızca `sekme ===
 * 'takvim'` iken monte edilir, kendi görünürlüğünü BİLMEZ.
 *
 * # `aramaApi` ve `takvimApi` neden PROP DEĞİL
 *
 * İkisi de durumsuz, tekil modül nesneleri (bkz. `api.ts`) — `AnaEkran` da
 * onları aynı şekilde doğrudan içe aktarıyordu, hook DÖNÜŞÜ değiller. Prop
 * olarak taşımak yalnızca dolaylama eklerdi; testler zaten `vi.mock('../api')`
 * ile bu modülü değiştirebiliyor (bkz. `AyOzeti.test.tsx`, bu bileşenin
 * kendi testi de aynı deseni kullanıyor).
 *
 * # `takvim` ve `seansAkisi` neden HALA KANCA DÖNÜŞÜ, prop'lara AYRIŞTIRILMADI
 *
 * `AnaEkran.tsx`'in modül başlığı: 401 temizliği takvim/seans/danışan
 * akışları arasında İKİ YÖNLÜ ve kancalar birbirini doğrudan göremediği için
 * bağ `AnaEkran`'da kuruluyor. O bağı burada yeniden kurmak (örn. `onYetkisiz`
 * geri çağrısını bu bileşene taşımak) akışları ÇAĞIRANI ikiye bölerdi; hook
 * çağrıları `AnaEkran`'da kalıyor, yalnızca SONUÇLARI (ve dönüştürülmüş
 * `RandevuPaneli`/`SeansPaneli` prop'ları) buraya iniyor.
 *
 * # `onDurumDegis` / `onOdemeDegis` neden PROP, `takvim.durumDegis` DEĞİL
 *
 * "Geldi" ya da "Ödendi" işaretlemek yalnızca takvim listesini değil, açık
 * danışan kartının (başka bir kancada, `useDanisanDosyasi`) yerel bakiyesini
 * ve açık ay özetinin tazeleme sayacını da güncellemesi gerekiyor — ikisi de
 * bu bileşenin GÖRMEDİĞİ state. `AnaEkran` bu üçünü birleştiren bileşik
 * fonksiyonları geçiyor; bu bileşen yalnızca hangi randevu kimliğine
 * uygulanacağını biliyor ve onu bağlıyor (eskiden `AnaEkran` içinde satır
 * içi yapılan aynı bağlama, bkz. `SeansPaneli`/`SeansAltSatiri` çağrıları).
 *
 * # Ay özeti KAPALI başlar — bu state artık BURADA yaşıyor
 *
 * Sunucu her özet görüntülemesini SİLİNEMEZ bir denetim kaydı satırına
 * yazıyor (`store::audit`). Açılışta kendiliğinden istek atan bir özet,
 * terapistin hiç bakmadığı bir görüntülemeyi kalıcı olarak kaydederdi.
 * Eskiden bu `useState(false)` `AnaEkran`'daydı; artık `AyOzeti`'ni koşullu
 * mount eden JSX de burada olduğu için state de buraya taşındı — ikisi
 * ayrı bileşenlerde olsaydı "kapalı başlama" kuralı iki dosyaya BÖLÜNMÜŞ
 * ama TEK bir yerde test edilebilir olurdu; hâlbuki kural burada, tek
 * bileşende, doğrudan test edilebilir (bkz. `TakvimSekmesi.test.tsx`
 * "ay özeti kapalı başlar ve istek atmaz").
 *
 * `disTazeleme` ise burada YAŞAMIYOR: o sayaç, bu bileşenin görmediği
 * `useDanisanDosyasi` yamasıyla birlikte `AnaEkran`'da üretiliyor (yukarıdaki
 * `onDurumDegis`/`onOdemeDegis` gerekçesiyle aynı), bu yüzden `ozet` prop'u
 * üzerinden DIŞARIDAN alınıyor — tıpkı eskiden `AyOzeti`'ye doğrudan
 * geçirildiği gibi.
 *
 * # `data-testid="takvim-izgara"` neden var
 *
 * Sıralama testi ("takvim, ay özeti panelinden önce gelir") `textContent`
 * alt-dizi aramasıyla değil, iki bilinen DOM düğümünün
 * `compareDocumentPosition`'ıyla ölçülüyor — metin tabanlı bir arama, ay
 * özeti düğmesinin ("Ay sonu özeti") kendisi takvimden ÖNCE göründüğü için
 * yanlışlıkla geçerdi (bkz. görev raporu). `id`'siz bir `<div>` sarmalayıcı
 * bu ölçümün tek çapası.
 *
 * Plan A Görev 10'dan beri bu kanca yalnızca testlerin değil: `SeansPaneli`
 * başlığındaki "Takvime dön" ızgarayı BU seçiciyle bulup kaydırıyor. Kanca
 * kaldırılır ya da adı değişirse düğme sessizce hiçbir şey yapmaz (ölçen
 * test: `TakvimSekmesi.test.tsx` > "10.9").
 *
 * # Tek araç çubuğu, tek "şimdi" kaynağı (Görev 5, tasarım §4 A1/A2)
 *
 * Hafta başlığı ve gezinme okları eskiden `HaftalikTakvim`'in İÇİNDEYDİ;
 * "Bugün" düğmesi ve gün seçiciyle birlikte tek bir satırda toplanmaları
 * gerekince BURAYA taşındı — ikinci bir yerde aynı okları/başlığı yeniden
 * kurmak, ileride biri güncellenip diğerinin unutulduğu bir çift üretirdi.
 * Başlık `<h2 id="hafta-basligi">` (DOM kancası): Görev 6'nın bugün vurgusu
 * ve şimdi çizgisi de bu satırı okuyacak.
 *
 * `simdi` (`useDakikalikSimdi`, `yerelGun.ts::simdiYerel`'in dakikada bir
 * yenilenen React durumu) BURADA okunuyor, `AnaEkran`'da DEĞİL: "Bugün"
 * düğmesinin soluklaşması (`buHafta`) ve `HaftalikTakvim`'e geçen `simdi`
 * (Görev 6) aynı tek kaynaktan besleniyor — ikinci bir `useDakikalikSimdi()`
 * çağrısı da aynı değeri üretirdi ama saniyede bir render tetikleyen bir
 * kancayı gereksiz yere ikinci bir bileşende daha çalıştırmak anlamsız.
 *
 * Gün seçici (`<input type="date">`) yalnızca kullanıcı başlığa TIKLAYINCA
 * DOM'a girer ve `autoFocus` taşır: randevuya tıklamanın imleci hiçbir
 * alana kendiliğinden GÖTÜRMEMESİ kuralıyla (global kısıtlar) çelişmiyor,
 * çünkü odak burada kullanıcının kendi açtığı bir alana gidiyor — kapalı bir
 * alana kendiliğinden odak YOK.
 */

type Props = {
  takvim: ReturnType<typeof useTakvimAkisi>
  seansAkisi: ReturnType<typeof useSeansNotlari>
  /** `AyOzeti`'nin ihtiyaç duyduğu, bu bileşenin GÖRMEDİĞİ iki değer. */
  ozet: {
    /** `YYYY-AA-GG`; açılışta gösterilecek ayı belirler. */
    bugun: string
    /** Üst bileşenin tazeleme sayacı (bkz. modül başlığı). */
    disTazeleme: number
  }
  danisanlar: Danisan[]
  /**
   * Danışan dosyasına giden yol (`AnaEkran.danisanaGit`). İkinci argüman
   * seans panelinden VE hızlı aramanın not sonucundan gelirken verilir:
   * dosya O seans seçili açılır (son inceleme I3, Görev 7'de hızlı aramaya
   * da yayıldı — bkz. `HizliArama`'ya aşağıdaki geçiş). Ay özeti yalnızca
   * danışanı bilir.
   */
  onDanisanAc: (clientId: number, appointmentId?: number) => void
  onDurumDegis: (id: number, durum: string) => Promise<void>
  onOdemeDegis: (id: number, odendi: boolean) => Promise<void>
  /**
   * Randevu paneli yazmaları (`AnaEkran.randevuKaydet/randevuSil/
   * randevuSeriSil`). `onDurumDegis` ile aynı gerekçe: başarılı yazma takvim
   * listesinin yanında açık etiketli seanslar panelini de tazelemeli (son
   * inceleme I1) ve o panel bu bileşenin görmediği `useEtiketler`'de.
   *
   * Dönüş `Promise<void>` (Plan A Görev 9): `takvim.kaydet` artık PUT
   * yanıtını döndürüyor ama onu tüketen tek yer `AnaEkran.randevuKaydet`
   * (son temas yaması); bu bileşen ve `RandevuPaneli` yalnızca bitişi bekler.
   */
  onRandevuKaydet: (kayit: Parameters<ReturnType<typeof useTakvimAkisi>['kaydet']>[0]) => Promise<void>
  onRandevuSil: (id: number) => Promise<void>
  onSeriSil: (seriId: string, buTarihtenItibaren: string) => Promise<void>
  /**
   * Açık seansın etiketleri (`AnaEkran.etiketBaglami`, Plan 6 Görev 6). Veri
   * ve yazmalar `AnaEkran`'da — danışan dosyası AYNI önbellekten okuyor (bkz.
   * `useEtiketler` modül başlığı). Bu bileşen yalnızca kimliği bağlıyor.
   */
  etiketBaglami: (appointmentId: number) => EtiketBaglami
  /**
   * Hızlı aramanın etiket sonucuna tıklanınca "etiketli seanslar" panelini
   * açar (`AnaEkran`'daki `useEtiketler.etiketAc`, Görev 7). Etiket verisi ve
   * paneli AnaEkran'da yaşıyor (bkz. `etiketBaglami` gerekçesi) — bu bileşen
   * yalnızca çağırıyor.
   */
  onEtiketAc: (etiket: Etiket) => void
}

export function TakvimSekmesi({
  takvim,
  seansAkisi,
  ozet,
  danisanlar,
  onDanisanAc,
  onDurumDegis,
  onOdemeDegis,
  onRandevuKaydet,
  onRandevuSil,
  onSeriSil,
  etiketBaglami,
  onEtiketAc,
}: Props) {
  // Bkz. modül başlığı: kapalı başlama kuralı burada yaşıyor.
  const [ozetAcik, setOzetAcik] = useState(false)
  // Uygulamadaki TEK "şimdi" (bkz. modül başlığı) — "Bugün" düğmesi ve
  // (Görev 6'da) HaftalikTakvim'e geçen `simdi` AYNI kaynaktan.
  const simdi = useDakikalikSimdi()
  // Kullanıcının başlığa tıklamasıyla açılan gün seçici (tasarım A1).
  const [gunSecici, setGunSecici] = useState(false)
  const buHafta = haftaninBasi(zamandanDate(simdi)).getTime() === takvim.haftaBasi.getTime()

  const { seciliRandevu, seciliBosSaat } = takvim
  const seans = seansAkisi.seans

  // Kaydırma (tasarım A6): istek kancada (`kaydirmaIstegi`), yalnızca
  // kullanıcı seçiminde kurulur; burada UYGULANIR ve hemen TÜKETİLİR. Sekme
  // dönüşünde bu bileşen yeniden monte olur — istek tüketilmemiş olsaydı her
  // dönüşte sayfa yeniden kayardı. Liste tazelemesi, "Geldi"/ödeme ve taşıma
  // seçimi AYNI kimlikle tazeler: bağımlılıklar değişmez, kaydırma olmaz.
  // Yumuşaklık CSS'te (`index.css`, hareketi azaltma tercihine saygılı).
  // İmleç hiçbir alana GİTMEZ: yalnızca kaydırma, odak yok (global kısıt).
  const seansBolumuRef = useRef<HTMLElement>(null)
  const kaydirmaIstegi = takvim.kaydirmaIstegi
  const kaydirmaTamam = takvim.kaydirmaTamam
  const seciliId = seciliRandevu?.id
  useEffect(() => {
    if (kaydirmaIstegi === null) return
    if (seciliId !== kaydirmaIstegi) return
    seansBolumuRef.current?.scrollIntoView({ block: 'start' })
    kaydirmaTamam()
    // `kaydirmaTamam` bilerek bağımlılık değil: kanca her render'da yeni bir
    // fonksiyon döndürüyor; bağımlılık olsaydı efekt her render'da koşardı
    // (erken dönüşler yüzünden zararsız ama anlamsız).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kaydirmaIstegi, seciliId])

  return (
    <div data-testid="takvim-sekmesi">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label="Önceki hafta"
          className="rounded border px-2 py-1"
          onClick={() => takvim.haftaDegis(-1)}
        >
          ‹
        </button>
        <h2 id="hafta-basligi" className="text-lg font-semibold">
          <button
            type="button"
            aria-expanded={gunSecici}
            className="rounded px-1 hover:bg-slate-100"
            onClick={() => setGunSecici((acik) => !acik)}
          >
            {haftaBasligi(takvim.haftaBasi)}
          </button>
        </h2>
        <button
          type="button"
          aria-label="Sonraki hafta"
          className="rounded border px-2 py-1"
          onClick={() => takvim.haftaDegis(1)}
        >
          ›
        </button>
        <button
          type="button"
          aria-disabled={buHafta}
          className={`rounded border px-3 py-1 ${buHafta ? 'text-slate-400' : ''}`}
          onClick={() => {
            if (!buHafta) takvim.haftayaGit(zamandanDate(simdi))
          }}
        >
          Bugün
        </button>
        {gunSecici && (
          // Kullanıcının kendi açtığı alan: odak burada verilir (açık eylem,
          // bkz. global kısıtlar — imleç kendiliğinden başka hiçbir alana
          // gitmez).
          <input
            type="date"
            aria-label="Gidilecek gün"
            autoFocus
            className="rounded border px-2 py-1"
            onChange={(e) => {
              if (e.target.value === '') return
              takvim.haftayaGit(zamandanDate(`${e.target.value}T00:00`))
              setGunSecici(false)
            }}
          />
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* Hızlı arama her zaman monte: Cmd+K dinleyicisi bileşenin kendi
              içinde. Kapalıyken yalnızca kısayolu duyuran bir düğme basar;
              hiçbir istek atmaz. */}
          <HizliArama
            ara={aramaApi.ara}
            onDanisanSec={(id, appointmentId) => onDanisanAc(id, appointmentId)}
            onEtiketSec={onEtiketAc}
          />
          <button
            type="button"
            className="rounded-lg border px-4 py-2"
            aria-expanded={ozetAcik}
            onClick={() => setOzetAcik((acik) => !acik)}
          >
            Ay sonu özeti
          </button>
          {/* `Kilitle` burada DEĞİL (son inceleme I1): tasarım §4 onu
              kabuğun üst satırına koyuyor ve risk notu ya da açık bir dosya
              ekrandayken kilitlemek için Takvim'e geçmek gerekmemeli — bkz.
              `AnaEkran.tsx`. */}
        </div>
      </div>

      {/* Bilgi satırı (tasarım A2): yalnızca görünen hafta BU HAFTAYKEN
          anlamlı — başka bir haftaya gezinildiğinde "bugün" o haftada YOK,
          göstermek yanıltıcı olurdu. `bugunOzeti` AYNI `simdi` ve
          `takvim.randevular`dan türüyor — ızgaradaki sayıyla bu satırın
          sayısı İKİ AYRI süzgeçten gelmiyor. */}
      {buHafta && (() => {
        const o = bugunOzeti(takvim.randevular, simdi)
        return (
          <p className="mb-3 text-sm text-slate-600" data-testid="bugun-bilgisi">
            {o.sayi === 0 ? 'Bugün seans yok' : `Bugün ${o.sayi} seans`}
            {o.siradaki && (
              <>
                {' · sıradaki '}
                <button
                  type="button"
                  className="underline"
                  // Kullanıcı seçimi: seans bölümüne kaydırır (tasarım A6).
                  onClick={() => takvim.randevuSec(o.siradaki as Randevu, { kaydir: true })}
                >
                  {o.siradaki.baslangic.slice(11, 16)} {o.siradaki.danisan_adi}
                </button>
              </>
            )}
          </p>
        )
      })()}

      {takvim.hata && <p className="mb-4 text-sm text-red-600">{takvim.hata}</p>}

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 basis-[720px]" data-testid="takvim-izgara">
          <HaftalikTakvim
            randevular={takvim.randevular}
            haftaBasi={takvim.haftaBasi}
            // Izgaradaki blok ve "aralık dışı" listesindeki düğmeler
            // KULLANICI seçimi: seans bölümüne kaydırır (tasarım A6).
            onRandevuSec={(r) => takvim.randevuSec(r, { kaydir: true })}
            onBosSaatSec={takvim.bosSaatSec}
            simdi={simdi}
          />
        </div>

        {/* Yalnızca BOŞ SAATİN yeni randevu formu ızgaranın yanında (A3);
            var olan randevunun formu aşağıdaki seans bölümünde. */}
        {seciliBosSaat !== null && (
          <div className="shrink-0">
            <RandevuPaneli
              // Seçim değişince (başka bir boş saat) bileşen yeniden mount
              // edilmeli — aksi hâlde panelin iç state'i (doldurulmuş form
              // alanları) önceki seçimden yeni seçime sızar (bkz. Görev 10
              // inceleme Bulgu 1, AnaEkran'dan taşındı).
              key={`bos-${seciliBosSaat}`}
              zaman={seciliBosSaat}
              randevu={null}
              danisanlar={danisanlar}
              onKaydet={onRandevuKaydet}
              onSil={onRandevuSil}
              onSeriSil={onSeriSil}
              seriSayisiAl={takvimApi.seriSayisi}
              silinecekNotSayisiAl={takvimApi.silinecekNotSayisi}
              onKapat={takvim.panelKapat}
              cakismaKontrol={takvimApi.cakismaKontrol}
            />
          </div>
        )}
      </div>

      {/* SEANS BÖLÜMÜ (tasarım A6): var olan bir randevu seçilince form ile
          seans paneli takvimin ALTINDA, ay özetinden ÖNCE tek bir bölüm. Form
          solda dar kolon, seans paneli sağda; pencere ikisini yan yana
          sığdırmıyorsa `flex-wrap` formu üste, notu alta alır.

          Erişilebilir ad "Seans bölümü", "Seans" DEĞİL: içindeki seans
          paneli zaten "Seans" başlıklı bir bölge ve aynı adlı iki iç içe
          bölge, o paneli adıyla arayan her sorguyu (testler ve ekran
          okuyucunun bölge listesi) belirsiz kılardı. */}
      {seciliRandevu !== null && (
        <section
          ref={seansBolumuRef}
          id="seans-bolumu"
          data-testid="seans-bolumu"
          aria-label="Seans bölümü"
          className="mt-4 flex scroll-mt-2 flex-wrap items-start gap-4"
        >
          <RandevuPaneli
            // Başka bir randevuya geçiş bileşeni yeniden MONTE eder (iç
            // state — silme onayı, doldurulmuş alanlar — sızmasın; bkz.
            // Görev 10 inceleme Bulgu 1). Kimlik aynıyken (Güncelle, liste
            // tazelemesi, Geldi) monte OLMAZ: taze kayıt `RandevuPaneli`nin
            // yeniden eşitleme efektine (R9) gelir.
            key={`randevu-${seciliRandevu.id}`}
            gomulu
            zaman={seciliRandevu.baslangic}
            randevu={seciliRandevu}
            danisanlar={danisanlar}
            onKaydet={onRandevuKaydet}
            onSil={onRandevuSil}
            onSeriSil={onSeriSil}
            seriSayisiAl={takvimApi.seriSayisi}
            silinecekNotSayisiAl={takvimApi.silinecekNotSayisi}
            onKapat={takvim.panelKapat}
            cakismaKontrol={takvimApi.cakismaKontrol}
          />
          <div className="min-w-0 flex-1 basis-[480px]">
            {/* Seans paneli YALNIZCA mevcut bir randevu seçiliyken açılır: boş
                bir saatte henüz bir `appointment_id` yok ve not ona bağlanır. */}
            {seans.hata === null ? (
              <SeansPaneli
                // Seans değişince panel yeniden mount edilmeli: sekme seçimi
                // (özellikle "Özel Notlarım") bir seanstan diğerine sızmamalı.
                // Anahtar YALNIZCA kimlik: taşıma (yeni başlangıç) editörü
                // yeniden monte ETMEZ — yazılmamış metin yerinde kalır
                // (tasarım A6; ölçen test: `AnaEkran.test.tsx` > "10.4").
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
                onDurumDegis={(durum) => onDurumDegis(seciliRandevu.id, durum)}
                onOdemeDegis={(odendi) => onOdemeDegis(seciliRandevu.id, odendi)}
                // CRITICAL-1: aynı `onDanisanAc` — danışan çipi, hızlı arama, ay
                // özeti ile AYNI yol (bkz. `AnaEkran.tsx::danisanaGit`). Seans
                // kimliği de gidiyor: dosya BU seans seçili açılır (son inceleme
                // I3 — terapist panelde baktığı seansın dosyadaki hâlini arıyor).
                onDanisanAc={(clientId) => onDanisanAc(clientId, seciliRandevu.id)}
                etiket={etiketBaglami(seciliRandevu.id)}
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
                    işaretlenebilmeli (Görev 2 inceleme I1, AnaEkran'dan taşındı). */}
                <SeansAltSatiri
                  key={`seans-alt-${seciliRandevu.id}`}
                  randevu={seciliRandevu}
                  onDurumDegis={(durum) => onDurumDegis(seciliRandevu.id, durum)}
                  onOdemeDegis={(odendi) => onOdemeDegis(seciliRandevu.id, odendi)}
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Ay özeti burada, TAKVİMDEN (ve seans bölümünden) SONRA: sıralama
          testleri ("takvim, ay özeti panelinden önce gelir", "10.7 DOM
          sirasi") tam olarak bunu ölçüyor. Borçlu satırı GERÇEK danışan
          kartını açar: danışan çipiyle aynı `onDanisanAc` yolu. Açık/kapalı
          state (yukarıda) burada kuruluyor — panel takvimin ÜSTÜNDE değil,
          üst satırın altında açılan bir panel (Görev 3 ürün kararı); "altında"
          DOM sırasında takvimden SONRA anlamına geliyor, takvimi aşağı itip
          önüne geçmiyor. */}
      {ozetAcik && (
        <AyOzeti
          bugun={ozet.bugun}
          disTazeleme={ozet.disTazeleme}
          onDanisanAc={(id) => onDanisanAc(id)}
        />
      )}
    </div>
  )
}
