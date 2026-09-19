import { useState } from 'react'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { tlMetni } from '../para'

/**
 * Seansın alt satırı: durum (geldi / gelmedi / iptal), ücret, "Ödendi".
 *
 * Tasarım §6: ödeme takibi ayrı bir modül değil, seansın alt satırı.
 *
 * # Neden AYRI bir bileşen (Plan 4 Görev 2 inceleme I1)
 *
 * Bu satır önceden `SeansPaneli`nin içindeydi ve panel YALNIZCA seans notu
 * ile geçmiş notlar yüklendiğinde açılıyordu. Geçmiş notlardan biri kalıcı
 * olarak okunamazsa ("Yeniden dene" işe yaramaz) o danışanın BÜTÜN
 * seanslarında "Geldi" ve "Ödendi" kilitli kalıyordu. "Geldi"
 * işaretlenemeyince sunucudaki son temas — dolayısıyla saklama bitişi —
 * tazelenmiyor ve dosya imha hatırlatmasına ERKEN düşüyordu.
 *
 * Durum ve ödeme notlara bağlı değil: randevu satırının alanları. Bu yüzden
 * satır hem panelin içinde hem `AnaEkran`'ın not-yükleme-hatası dalında
 * aynı bileşenle gösteriliyor (ölçen testler: `AnaEkran.test.tsx` > "not
 * yuklenemezse de Geldi ve Odendi ..." ve "gecmis notlar yuklenemezse de
 * ...").
 *
 * # Durum prop'tan, "Ödendi" iyimser yerel kopyadan
 *
 * Seçili durum `randevu.durum`'dan okunur: çağıran taraf başarıda seçili
 * randevunun kopyasını AYNI kimlikle tazeliyor ve satır yeniden mount
 * edilmiyor. "Ödendi" kutusu iyimserdir ve reddedilirse geri döner — işaretli
 * kalan bir kutu, sunucuda olmayan bir ödemeyi "alındı" diye gösterirdi.
 * Kutunun ilk değeri yalnızca MOUNT'ta okunur; seans değişince sıfırlanması
 * çağıranın `key`ine bağlı.
 *
 * # Hata YALNIZCA burada gösterilir (inceleme M6)
 *
 * Durum/ödeme hatası `role="alert"` ile bu satırda duyurulur; takvimin
 * sayfa üstü hata bandına YAZILMAZ. Önceden ikisinde birden görünüyordu ve
 * panel kapansa da üstteki bant kalıyordu.
 */
type Props = {
  // `Pick` bilerek DAR: bileşen yalnızca `durum`/`ucret`/`odendi` okur (bkz.
  // aşağıdaki gövde). Çağıranın `DanisanSeansi`den (danışan dosyası,
  // `DanisanDosyasi.tsx`) `Randevu`nun TAŞIMADIĞI `bitis`/`seri_id`
  // alanlarını dolgu değerle üretmesini GEREKTİRMESİN diye — tam `Randevu`
  // zorunlu olsaydı o dolgu üretimi geri gelirdi ve bileşen ileride bu iki
  // alanı gerçekten okumaya başlarsa (ör. "randevuyu düzenle" düğmesi)
  // derleme zamanında YAKALANMAZDI (inceleme bulgusu, Görev 6 fix turu).
  randevu: Pick<Randevu, 'durum' | 'ucret' | 'odendi'>
  onDurumDegis: (durum: string) => Promise<void>
  onOdemeDegis: (odendi: boolean) => Promise<void>
}

const DURUMLAR = [
  ['Geldi', 'geldi'],
  ['Gelmedi', 'gelmedi'],
  ['İptal', 'iptal'],
] as const

/** Kuruş -> "450,00 TL" (biçim `para.ts`'te, tüm ekranlarla ortak). */
function ucretMetni(kurus: number | null): string {
  return kurus === null ? 'Ücret girilmemiş' : tlMetni(kurus)
}

export function SeansAltSatiri({ randevu, onDurumDegis, onOdemeDegis }: Props) {
  // "Ödendi" kutusunun EKRANDAKİ değeri. İyimser: tıklanınca hemen değişir,
  // istek reddedilirse eski değere döner. İlk değer prop'tan, yalnızca
  // MOUNT'ta okunur — seans değişince sıfırlanması çağıranın `key`ine bağlı
  // (ölçen test: `AnaEkran.test.tsx` > "seans degisince Odendi kutusu YENI
  // randevunun degerini gosterir").
  const [odendi, setOdendi] = useState(randevu.odendi)
  // Durum ya da ödeme isteği uçuşta: satırın denetimleri kilitli. Hızlı bir
  // çift tıklama iki yazma (ve sunucuda iki silinemez denetim satırı)
  // üretemesin.
  const [islemSuruyor, setIslemSuruyor] = useState(false)
  const [hata, setHata] = useState<string | null>(null)

  async function islem(calistir: () => Promise<void>, geriAl?: () => void) {
    setHata(null)
    setIslemSuruyor(true)
    try {
      await calistir()
    } catch (e) {
      geriAl?.()
      setHata(e instanceof Error ? e.message : 'İşlem tamamlanamadı.')
    } finally {
      setIslemSuruyor(false)
    }
  }

  function odemeDegis(yeni: boolean) {
    const eski = odendi
    setOdendi(yeni)
    // Geri alma ZORUNLU: istek reddedildiğinde kutu işaretli kalsaydı ekran
    // sunucuda olmayan bir ödemeyi "alındı" diye gösterirdi.
    void islem(() => onOdemeDegis(yeni), () => setOdendi(eski))
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
      <div role="group" aria-label="Seans durumu" className="flex gap-1">
        {DURUMLAR.map(([etiket, kod]) => (
          <button
            key={kod}
            type="button"
            aria-pressed={randevu.durum === kod}
            className={
              'rounded border px-3 py-1 text-sm disabled:opacity-50 ' +
              (randevu.durum === kod ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300')
            }
            disabled={islemSuruyor}
            onClick={() => void islem(() => onDurumDegis(kod))}
          >
            {etiket}
          </button>
        ))}
      </div>
      <span className="text-sm text-slate-700">{ucretMetni(randevu.ucret)}</span>
      <label className="flex items-center gap-1 text-sm">
        <input
          type="checkbox"
          checked={odendi}
          disabled={islemSuruyor}
          onChange={(olay) => odemeDegis(olay.target.checked)}
        />
        Ödendi
      </label>
      {hata !== null && (
        <p role="alert" className="w-full text-sm text-red-700">
          {hata}
        </p>
      )}
    </div>
  )
}
