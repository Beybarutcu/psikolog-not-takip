/**
 * Seans notu şablonları — **kapalı** bir küme.
 *
 * # Kapalı küme, kullanıcı tanımlı şablon YOK
 *
 * `progress_notes.sablon` ve `templates.kod` veritabanında aynı kapalı kümeyi
 * (`'dap','soap','serbest'`) `CHECK` ile taşır ve `templates.kod` `UNIQUE`'tir:
 * o tablo yapısal olarak en fazla üç satır tutabilir. Kullanıcı şablonun
 * **içeriğini** (başlıklarını) düzenler, yeni bir **tür** eklemez. Bu yüzden
 * burada "yeni şablon ekle" gibi bir yol yoktur ve `NotEditoru`'nun açılır
 * listesi bu kaydın anahtarlarından türetilir — kod listesi ikinci kez elle
 * yazılmaz (`SABLON_KODLARI` `Object.keys`'ten gelir).
 *
 * # Bu dosya kümenin dördüncü kopyası
 *
 * Küme şu anda üç yerde yazılı: `schema.rs`'teki iki `CHECK` ve oradaki
 * `INSERT OR IGNORE INTO templates` tohumu. Buradaki kopya bir sunucu uç
 * noktasından türetilmiyor çünkü `templates` tablosunun bugün ne deposu ne
 * rotası var; yalnızca bu liste için bir veri handler'ı eklemek, kilitli
 * oturum sözleşmesini taşıyan handler kümesini de büyütürdü.
 *
 * Kopyanın sessizce ayrışması `sablon.test.ts` ile engellenir: o test
 * `core/src/store/schema.rs`'i **okur** ve hem `CHECK` kümelerini hem de
 * tohumlanan başlıkları buradakiyle karşılaştırır. Şemadaki bir değişiklik
 * buraya yansıtılmazsa test kırmızı olur — "arayüz DAP'ı gösteriyor ama
 * veritabanı reddediyor" sınıfı sessiz hata bu yüzden mümkün değil.
 */

export type SablonKodu = 'dap' | 'soap' | 'serbest'

/**
 * Şablon kodundan başlık listesine. `schema.rs`'teki `templates.basliklar`
 * tohumuyla birebir aynı olmalıdır (bkz. `sablon.test.ts`).
 */
export const SABLONLAR: Record<SablonKodu, string[]> = {
  dap: ['Veri', 'Değerlendirme', 'Plan'],
  soap: ['Öznel', 'Nesnel', 'Değerlendirme', 'Plan'],
  serbest: [],
}

/** Kullanıcının gördüğü ad (`templates.ad` tohumuyla aynı). */
export const SABLON_ADLARI: Record<SablonKodu, string> = {
  dap: 'DAP',
  soap: 'SOAP',
  serbest: 'Serbest',
}

/**
 * Açılır listenin kaynağı. Elle yazılmış ikinci bir liste DEĞİL: `SABLONLAR`
 * genişlerse (yalnızca şema da genişlerse mümkün) liste kendiliğinden büyür.
 */
export const SABLON_KODLARI = Object.keys(SABLONLAR) as SablonKodu[]

export function sablonKodMu(deger: string): deger is SablonKodu {
  return Object.prototype.hasOwnProperty.call(SABLONLAR, deger)
}

/**
 * Şablonun boş editöre eklenecek metni.
 *
 * Bilinmeyen kod boş metin döndürür, hata fırlatmaz: bu fonksiyonun çıktısı
 * doğrudan editörün içeriğine yazılır ve tanınmayan bir kod yüzünden
 * kullanıcının notunun yerine bir hata mesajı ya da `undefined` yazılması,
 * korunmaya çalışılan şeyin (yazılmış metin) kendisini bozardı. `serbest`
 * de zaten boş metin üretir — başlıksız şablon.
 *
 * # Başlıklar HTML ikinci düzey başlık + boş paragraf (tasarım E9)
 *
 * Boş editörde şablon seçilince her başlık `<h2>` ve ardından yazılacak boş
 * bir `<p>` olur. Başlık ADLARI (`SABLONLAR`) ve `templates` tohumu AYNI;
 * `sablon.test.ts` şemayı okuyarak doğrular. Sunucu önizlemesi
 * (`danisan_seanslari::onizleme`) bu başlık satırlarını atlar.
 */
export function sablonMetni(sablon: string): string {
  if (!sablonKodMu(sablon)) return ''
  return SABLONLAR[sablon].map((baslik) => `<h2>${baslik}</h2><p></p>`).join('')
}
