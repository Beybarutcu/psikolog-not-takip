import type { DanisanSeansi } from '../api'

/**
 * Danışan dosyası açıldığında hangi seansın SEÇİLİ geleceği (son inceleme I3,
 * planın metni düzeltildi).
 *
 * # "En yeni" DEĞİL, "bugünden önceki en yeni"
 *
 * Eski kural listenin ilkiydi (sunucu en yeniden eskiye sıralıyor) — yani
 * TAKVİMDEKİ en ileri randevu. 12 haftalık bir seride dosya üç ay sonraki,
 * henüz yaşanmamış, notu olmayan bir randevuyla açılıyordu; terapistin
 * dosyayı açma sebebi ise geçmiş seanslara ve notlarına ulaşmak. Kural:
 *
 *   1. `baslangic <= simdi` olan seanslar arasında EN YENİSİ;
 *   2. hiç geçmiş seans yoksa EN YAKIN gelecek seans;
 *   3. liste boşsa `null`.
 *
 * (Takvimden "… dosyasını aç" ile gelindiyse o seans seçilir — o karar
 * çağıranda, `useDanisanSeanslari`'nda; bu fonksiyon yalnızca VARSAYILAN.)
 *
 * # Karşılaştırma DUVAR SAATİ dizgileriyle
 *
 * `baslangic` ve `simdi` 16 karakterlik `YYYY-AA-GGTSS:DD` dizgileri, zaman
 * dilimi taşımaz; sabit genişlikli olduğu için sözlük sırası kronolojik
 * sıradır. `new Date(baslangic)` KULLANILMIYOR: dilimsiz ISO dizgisini
 * tarayıcılar farklı yorumlayabilir ve UTC varsayımı İstanbul'da üç saatlik
 * bir kaymayla "henüz başlamamış" seansı geçmiş sayardı (bkz.
 * `takvim/hafta.ts::zamandanDate`). `simdi` de aynı biçimde gelir
 * (`hafta.ts::yerelZaman(new Date())`) — enjekte edilebilir ki testler saati
 * kendileri seçsin.
 *
 * Sıralamaya GÜVENİLMİYOR: sunucunun `ORDER BY`ı bugün doğru ama bu kural
 * listenin sırasından bağımsız hesaplanıyor; eşit başlangıçta listede önce
 * gelen (sunucuda `id DESC`) kazanır.
 */
export function varsayilanSeans(seanslar: DanisanSeansi[], simdi: string): number | null {
  let gecmis: DanisanSeansi | null = null
  let gelecek: DanisanSeansi | null = null
  for (const s of seanslar) {
    if (s.baslangic <= simdi) {
      if (gecmis === null || s.baslangic > gecmis.baslangic) gecmis = s
    } else if (gelecek === null || s.baslangic < gelecek.baslangic) {
      gelecek = s
    }
  }
  return (gecmis ?? gelecek)?.appointment_id ?? null
}
