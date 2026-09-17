import type { DanisanSeansi } from '../api'
import { yerelGun } from '../screens/anaEkranKancalari/yerelGun'
import type { useDanisanDosyasi } from '../screens/anaEkranKancalari/useDanisanDosyasi'
import type { useDanisanListesi } from '../screens/anaEkranKancalari/useDanisanListesi'
import { DanisanKarti } from './DanisanKarti'

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
 * # Sol kolonun JSX'i AnaEkran'dan TAŞINDI, DAVRANIŞI DEĞİŞMEDİ
 *
 * Arama kutusu, "Danışan ekle" formu ve iki adımlı arşiv onayı bugünkü
 * `AnaEkran.tsx`'teki ile birebir aynı; yalnızca kapsayıcı bileşen
 * değişti. `liste` kancası (`useDanisanListesi`) hâlâ `AnaEkran`'da
 * çağrılıyor — bu bileşen yalnızca SONUCU görüyor (bkz. `AnaEkran.tsx`
 * modül başlığı "Kancalar AnaEkran.tsx'te çağrılır, bileşene prop iner").
 *
 * # Sağ kolon: bugün `DanisanKarti`, YARIN `DanisanDosyasi` (Görev 6-7)
 *
 * Ürün tasarımı sağ kolonda Seanslar/Bilgiler alt sekmeli bir "dosya"
 * öngörüyor (`DanisanDosyasi`, Görev 6). O bileşen henüz yok; bu görevin
 * işi yalnızca İKİ KOLONLU kabuğu ve seans listesi VERİ AKIŞINI kurmak.
 * Sağ kolon bu yüzden şimdilik bugünkü `DanisanKarti`'yi barındırıyor —
 * Görev 7 onu `DosyaBilgileri`'ye (aynı içerik, yeni ad) taşıyacak ve bu
 * bileşen o zaman `DanisanDosyasi`'ye geçecek.
 *
 * `seanslar` prop'u bu yüzden BURADA henüz EKRANA BASILMIYOR: veri akışı
 * (`useDanisanSeanslari`, çağıranın sorumluluğu) hazır ve doğru — yalnızca
 * tüketen bileşen (`SeansListesi`/`DanisanDosyasi`) henüz yok. Prop'u kabul
 * etmemek, Görev 6'nın onu AnaEkran'a kadar geri gidip yeniden bağlaması
 * demek olurdu.
 */
export function DanisanlarSekmesi({
  liste,
  dosya,
  seanslar,
  onDanisanSec,
  veriRaporuIndir,
}: {
  liste: ReturnType<typeof useDanisanListesi>
  dosya: ReturnType<typeof useDanisanDosyasi>
  /** Açık danışanın seans listesi (`useDanisanSeanslari`, çağıran taraf
   * sağlıyor). Bkz. modül başlığı — Görev 6'ya kadar ekrana BASILMAZ. */
  seanslar: DanisanSeansi[]
  onDanisanSec: (clientId: number) => void
  veriRaporuIndir: (danisanId: number, parola: string) => Promise<void>
}) {
  const { seciliDanisanId, kart } = dosya
  // Yerel değişkene alınıyor: `liste.arsivOnayi` üzerinden daralan tür bir
  // callback'in içine taşınmaz, `AnaEkran`'daki gerekçeyle aynı (onay
  // metniyle "Evet, arşivle"nin AYNI danışanı görmesi bu satırla garanti).
  const { arsivOnayi } = liste

  return (
    <div className="grid grid-cols-[18rem_1fr] gap-6" data-testid="danisanlar-sekmesi">
      {/* SOL KOLON — AnaEkran.tsx'teki eski danışan listesi bölümüyle
          birebir aynı JSX, yalnızca `liste`/`onDanisanSec` prop üzerinden. */}
      <div>
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
          <div className="mt-2 flex flex-col items-start gap-2">
            <div>
              <label className="block text-sm" htmlFor="yeni-danisan-ad-soyad">
                Ad soyad
              </label>
              <input
                id="yeni-danisan-ad-soyad"
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
            duymuyor, danışanın listeden düşmesini de göremiyordu. */}
        {liste.arsivBilgisi && (
          <p role="status" className="mt-1 text-sm text-slate-600">
            {liste.arsivBilgisi}
          </p>
        )}

        {liste.danisanlar.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2 text-sm text-slate-700">
            {liste.danisanlar.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded bg-slate-100 px-3 py-1"
              >
                {/* Erişilebilir ad "Ayşe Yılmaz dosyasını aç": takvimdeki
                    randevu bloğunun adı düz "Ayşe Yılmaz" ve iki özdeş adlı
                    düğme hem ekran okuyucu kullanıcısını hem de ada göre
                    arayan testleri belirsiz bırakırdı. */}
                <button
                  type="button"
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

      {/* SAĞ KOLON — dosya. Bkz. modül başlığı: bugün `DanisanKarti`,
          Görev 6-7 `DanisanDosyasi`/`DosyaBilgileri`ye taşıyacak. */}
      <div data-testid="danisan-dosyasi-sag-kolon" data-seans-sayisi={seanslar.length}>
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
              <DanisanKarti
                // Bkz. AnaEkran.tsx'teki aynı gerekçe: birincil hat
                // (`kart` türetmesi + bu koşullu render) danışan değişince
                // `kart.dosya`'yı `null` yapıp bileşeni unmount ediyor; bu
                // `key` bugün ulaşılamaz ama gevşeyen bir türetmede yük
                // taşımaya hazır duruyor.
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
      </div>
    </div>
  )
}
