/**
 * Not Markdown'unun satır başı desenleri — TEK kaynak (son inceleme M2).
 *
 * İki kullanıcı var ve ikisi AYNI deseni görmek zorunda:
 *
 *   - `markdown.tsx::siniflandirSatir` saklanan metni görüntüye çevirirken
 *     hangi satırın başlık/madde/onay kutusu/numaralı/alıntı olduğunu bunlarla
 *     belirler;
 *   - `bicim.ts` biçim çubuğu ve kısayollarda "bu satırda zaten bu biçim var
 *     mı" sorusunu (aç/kapa, madde ↔ numaralı geçişi) bunlarla yanıtlar.
 *
 * Eskiden iki dosyada birer kopya vardı ve yorum "birebir aynı" diyordu ama
 * hiçbir test bunu sınamıyordu (`docs/test-yesil-ama-korumuyor.md`, 10. biçim):
 * bir kopyaya eklenen seviye (ör. `####`) önizlemede başlık olur, biçim
 * çubuğunda başlık sayılmaz, "Başlık 1" düğmesi `# #### metin` üretirdi.
 * Tek modül bu ayrışmayı yapısal olarak kaldırır.
 *
 * Hiçbiri `g`/`y` bayrağı taşımıyor: `exec`/`test` durum tutmaz, iki modülün
 * aynı nesneyi paylaşması güvenli.
 *
 * `seans/onizleme.ts`'teki desenler BURADA DEĞİL ve bilerek: onlar sunucudaki
 * `danisan_seanslari.rs` ile eşlenen ayrı bir kural (önizleme satırı), ortak
 * örnek dosyasıyla (`onizleme_ornekleri.json`) eşit tutuluyor.
 */

/** `# `, `## `, `### ` (1-3 seviye); 1. grup işaretler, 2. grup içerik. */
export const BASLIK_DUZENLI = /^(#{1,3}) (.*)$/
/** `- [ ] ` / `- [x] ` (işaretten sonraki boşluk opsiyonel); 1. grup kutu, 2. grup içerik. */
export const ONAY_KUTUSU_DUZENLI = /^- \[([ xX])\] ?(.*)$/
/** `- ` madde; onay kutusu satırı da buna uyar, önce `ONAY_KUTUSU_DUZENLI` denenir. */
export const MADDE_DUZENLI = /^- (.*)$/
/** `1. ` numaralı madde. */
export const NUMARALI_DUZENLI = /^\d+\. (.*)$/
/** `> ` alıntı (boşluk opsiyonel). */
export const ALINTI_DUZENLI = /^> ?(.*)$/
