import { AYLAR } from './takvim/hafta'

/**
 * Duvar saati -> okunur Türkçe tarih: `"2026-09-07T10:00"` ->
 * `"7 Eylül 2026, 10:00"`.
 *
 * # Neden burada, tek kaynak (Plan 5 Görev 6 — `para.ts::tlMetni` ile aynı
 *   gerekçe)
 *
 * Bu biçim eskiden yalnızca `seans/SeansPaneli.tsx` içinde yerel bir
 * fonksiyondu (`seansZamani`). Danışan dosyasının Seanslar alt sekmesi
 * (`danisan/SeansListesi.tsx`) TAM OLARAK aynı biçime ihtiyaç duyunca kopya
 * yazmak yerine buraya taşındı — `para.ts`nin `tlMetni`si iki ayrı para
 * biçiminin (kartta `₺`, panelde `TL`) uyuşmazlığını nasıl çözdüyse, bu
 * dosya da aynı sınıf ayrışmayı önlüyor: iki ekran aynı seansı FARKLI
 * biçimde göstermiyor.
 *
 * `AYLAR` `takvim/hafta.ts`ten geliyor, burada İKİNCİ bir ay adı listesi
 * YOK — üçüncü bir kopya birbirinden ayrışırdı (bkz. o dosyadaki "Görev
 * 9'da da kullanılır" notu).
 *
 * # `Date`'e ÇEVRİLMİYOR
 *
 * `baslangic` yerel naive duvar saati biçiminde gelir
 * (`api.ts::DanisanSeansi`, `Randevu.baslangic` ile aynı sözleşme).
 * Dizgeyi `Date`'e çevirmek zaman dilimi yorumu ekler ve saat kaydırabilir
 * (bkz. `takvim/hafta.ts::zamandanDate`); bu yüzden parçalar burada da
 * elle ayrıştırılıyor.
 */
export function zamanMetni(zaman: string): string {
  const [tarih, saat] = zaman.split('T')
  const [yil, ay, gun] = (tarih ?? '').split('-')
  const ayAdi = AYLAR[Number(ay) - 1]
  if (!saat || ayAdi === undefined) return zaman
  return `${Number(gun)} ${ayAdi} ${yil}, ${saat.slice(0, 5)}`
}
