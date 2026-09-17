import { useState } from 'react'
import { aramaApi, takvimApi, type Danisan } from '../api'
import { HizliArama } from '../arama/HizliArama'
import { AyOzeti } from '../ozet/AyOzeti'
import { SeansAltSatiri } from '../seans/SeansAltSatiri'
import { SeansPaneli } from '../seans/SeansPaneli'
import type { useSeansNotlari } from '../screens/anaEkranKancalari/useSeansNotlari'
import type { useTakvimAkisi } from '../screens/anaEkranKancalari/useTakvimAkisi'
import { HaftalikTakvim } from './HaftalikTakvim'
import { RandevuPaneli } from './RandevuPaneli'

/**
 * Takvim sekmesi: ürünün asıl işi (Görev 3 ürün kararı). Eskiden takvim ana
 * ekranın EN ALTINDA, ay özeti kutusunun ve yedekleme/parola panellerinin
 * ARKASINDA duruyordu — bu bileşen onu kendi sekmesine alıp en üste
 * çıkarıyor. Sekme geçişi (hangi sekmenin göründüğü) henüz burada
 * BAĞLANMIYOR; bu Görev 8'in işi (bkz. `AnaEkran.tsx` modül başlığı) —
 * bu bileşen şimdilik AnaEkran tarafından her zaman çizilen tek bölüm.
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
  onDanisanAc: (clientId: number) => void
  onSeansSec: (appointmentId: number, tarih: string) => void
  onDurumDegis: (id: number, durum: string) => Promise<void>
  onOdemeDegis: (id: number, odendi: boolean) => Promise<void>
  kilitle: () => void
}

export function TakvimSekmesi({
  takvim,
  seansAkisi,
  ozet,
  danisanlar,
  onDanisanAc,
  onSeansSec,
  onDurumDegis,
  onOdemeDegis,
  kilitle,
}: Props) {
  // Bkz. modül başlığı: kapalı başlama kuralı burada yaşıyor.
  const [ozetAcik, setOzetAcik] = useState(false)

  const { seciliRandevu, seciliBosSaat } = takvim
  const seans = seansAkisi.seans

  return (
    <div data-testid="takvim-sekmesi">
      <div className="mb-4 flex items-center justify-end gap-2">
        {/* Hızlı arama her zaman monte: Ctrl+K dinleyicisi bileşenin kendi
            içinde. Kapalıyken yalnızca kısayolu duyuran bir düğme basar;
            hiçbir istek atmaz. */}
        <HizliArama ara={aramaApi.ara} onDanisanSec={onDanisanAc} onSeansSec={onSeansSec} />
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

      {takvim.hata && <p className="mb-4 text-sm text-red-600">{takvim.hata}</p>}

      <div className="flex items-start gap-4">
        <div className="flex-1" data-testid="takvim-izgara">
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
            // sızar (bkz. Görev 10 inceleme Bulgu 1, AnaEkran'dan taşındı).
            key={seciliRandevu ? `randevu-${seciliRandevu.id}` : `bos-${seciliBosSaat}`}
            zaman={seciliBosSaat ?? seciliRandevu?.baslangic ?? ''}
            randevu={seciliRandevu}
            danisanlar={danisanlar}
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

      {/* Ay özeti burada, TAKVİMDEN SONRA: sıralama testi
          ("takvim, ay özeti panelinden önce gelir") tam olarak bunu ölçüyor.
          Borçlu satırı GERÇEK danışan kartını açar: danışan çipiyle aynı
          `onDanisanAc` yolu. Açık/kapalı state (yukarıda) burada kuruluyor —
          panel takvimin ÜSTÜNDE değil, üst satırın altında açılan bir panel
          (Görev 3 ürün kararı); "altında" DOM sırasında takvimden SONRA
          anlamına geliyor, takvimi aşağı itip önüne geçmiyor. */}
      {ozetAcik && (
        <AyOzeti bugun={ozet.bugun} disTazeleme={ozet.disTazeleme} onDanisanAc={onDanisanAc} />
      )}

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
            onDurumDegis={(durum) => onDurumDegis(seciliRandevu.id, durum)}
            onOdemeDegis={(odendi) => onOdemeDegis(seciliRandevu.id, odendi)}
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
        ))}
    </div>
  )
}
