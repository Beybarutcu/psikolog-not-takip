import { SABLONLAR } from './sablon'

/**
 * Seans listesindeki not önizlemesinin azami uzunluğu, KARAKTER (kod noktası)
 * cinsinden. Sunucudaki `store::danisan_seanslari::AZAMI_ONIZLEME` ile aynı.
 */
export const AZAMI_ONIZLEME = 120

/** Şablon başlıklarının notta göründüğü satır biçimi: `"Veri:"`, `"Plan:"` … */
const BASLIK_SATIRLARI = new Set(
  Object.values(SABLONLAR)
    .flat()
    .map((b) => `${b}:`),
)

/**
 * Notun seans listesindeki önizlemesi — sunucudaki
 * `store::danisan_seanslari::onizleme`nin İSTEMCİ EŞİ.
 *
 * # Neden istemcide de var
 *
 * Not kaydedildiğinde danışan dosyasının seans listesi YENİDEN ÇEKİLMİYOR
 * (`useDanisanSeanslari.yamala`): her çekme sunucuda SİLİNEMEZ bir
 * `goruntuleme` satırı yazar ve sonuç (tek seansın önizlemesi) yerelde kesin
 * olarak hesaplanabilir. Hesaplanmasaydı takvimde yazılan not dosya
 * listesinde "Not yazılmamış" kalırdı — tasarımın "eksik not gözden
 * kaçmasın" sinyali YANLIŞ bilgi verirdi (son inceleme C2).
 *
 * # İki uygulama ayrışamaz
 *
 * Kural (ilk boş olmayan, şablon başlığı olmayan satır; `''` yalnızca içerik
 * tamamen boşsa; yalnızca başlıklardan oluşan notta ilk başlık; karakterde
 * kırpma) iki dilde yazılı. Ayrışmaları ORTAK örnek dosyasıyla ölçülüyor:
 * `onizlemeOrnekleri.json` hem `onizleme.test.ts` hem sunucunun
 * `onizleme_ortak_ornekleri_saglar` testi tarafından okunur. Başlık listesi
 * `SABLONLAR`dan (şema tohumuyla `sablon.test.ts` üzerinden eşit) türetiliyor,
 * ikinci kez elle yazılmıyor.
 *
 * Kırpma `Array.from` ile KOD NOKTASI üzerinden: Rust'ın `chars()`ı Unicode
 * skaler değerlerini sayar, UTF-16 birimi sayan `slice` bir vekil çiftin
 * (emoji) ortasından keserdi.
 */
export function notOnizlemesi(icerik: string): string {
  let ilkBaslik: string | null = null
  for (const hamSatir of icerik.split('\n')) {
    const satir = hamSatir.trim()
    if (satir === '') continue
    if (BASLIK_SATIRLARI.has(satir)) {
      ilkBaslik ??= satir
      continue
    }
    return Array.from(satir).slice(0, AZAMI_ONIZLEME).join('')
  }
  return Array.from(ilkBaslik ?? '').slice(0, AZAMI_ONIZLEME).join('')
}
