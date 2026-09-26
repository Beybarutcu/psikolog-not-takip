/**
 * Okuma penceresi adresi (tasarım P2). Açan yarı (`okumaPenceresiniAc`) ve
 * okuyan yarı (`okumaKimligi`) ikisi de burada; `App.tsx` yalnızca çağırır.
 *
 * `window.open` bu kod tabanında YASAK (`istemciRaporUretimi.test.ts`: yeni
 * pencere/belge danışan verisini sunucunun güvencesi dışına çıkarabilir).
 * Buradaki TEK çağrı adıyla istisnadır ve o test çağrının metnini birebir
 * sabitler: aynı kökenden, yalnızca bir randevu KİMLİĞİ taşıyan bir adres;
 * pencere notu sunucudan kendisi ister (özel not yolu yok) ve kilitte
 * içeriği kaldırır. Masaüstünde Tauri isteği `on_new_window`'da yakalar ve
 * pencereyi kendisi kurar (`src-tauri/src/pencere.rs`); tarayıcıda aynı ad
 * ikinci kez istenince var olan pencere kullanılır (P3).
 *
 * # `null` dönüşü HATA DEĞİLDİR
 *
 * Tauri pencereyi kendisi kurup isteği reddettiği için (`Deny`) masaüstünde
 * `window.open` BAŞARIDA da `null` döner. Bu yüzden dönüş değeri yalnızca
 * öne getirmek için kullanılır: "açılamadı" uyarısı ya da aynı pencerede
 * `/?okuma=` adresine gezinme gibi bir yedek yol YOK (o yol ana pencereyi,
 * yazılmamış not sayfasıyla birlikte, okuma ekranına çevirirdi). Ölçen
 * test: `okumaPenceresi.test.ts`.
 */
export function okumaPenceresiniAc(randevuId: number): void {
  window.open(`/?okuma=${randevuId}`, `okuma-${randevuId}`)?.focus()
}

/**
 * `?okuma=<id>` (tasarım P2): pozitif tam sayı, başında sıfır yok, en fazla
 * 15 hane (güvenli tam sayı); değilse `null`. Bu `null` TEK BAŞINA "ana
 * ekran adresi" anlamına GELMEZ (bkz. aşağıdaki `okumaParametresiVarMi`):
 * adreste `okuma` anahtarı geçerken kimliği gramer dışıysa `App.tsx` yine
 * ana ekrana düşmez, `OkumaAdresiGecersiz` gösterir.
 *
 * # F15 — bu gramer Rust'takiyle (`src-tauri/src/pencere.rs::okuma_kimligi`)
 *   BİREBİR AYNI DEĞİL
 *
 * Rust tarafı `i64`'e sığan HER pozitif, başında sıfırsız tam sayıyı kabul
 * eder (19 haneye kadar); burası tasarımın verdiği ≤15 hane sınırını korur
 * (bkz. preflight.md F15, controller ruling — sınır Görev 6'dan buraya
 * taşındı). Sonuç: 16-19 haneli bir `okuma=` değeriyle Tauri GERÇEK bir
 * `okuma-*` penceresi açabilir ama bu fonksiyon o pencere için `null`
 * döner. `App.tsx` bunu YALNIZ BAŞINA "ana ekran adresi" saymaz — adreste
 * `okuma` anahtarı geçip geçmediğine `okumaParametresiVarMi` ile ayrıca
 * bakar ve öyleyse ana ekrana asla düşmez (bkz. App.test.tsx "9.6"/"9.7").
 */
export function okumaKimligi(arama: string): number | null {
  const deger = new URLSearchParams(arama).get('okuma')
  if (deger === null || !/^[1-9]\d{0,14}$/.test(deger)) return null
  return Number(deger)
}

/**
 * Adreste `okuma` anahtarı VAR MI — değeri geçerli olsun olmasın (F15,
 * yukarıdaki başlık). `okumaKimligi` ile birlikte kullanılır: anahtar var
 * ama `okumaKimligi` `null` dönüyorsa (gramer dışı hane sayısı, `0`,
 * negatif, boş değer, vb.) bu adres yine de bir okuma penceresidir — ana
 * ekrana ASLA düşmemeli, kilit yoklaması yine çalışmalı ve kullanıcıya
 * kimliğin geçersiz olduğu söylenmeli.
 *
 * Tekrarlanan `okuma` parametresi (`?okuma=1&okuma=2`) TEK BAŞINA geçersiz
 * SAYILMAZ: `URLSearchParams.get` her zaman İLK değeri döner, `okumaKimligi`
 * de yalnızca o ilk değeri sınar — ikinci değer sessizce yok sayılır.
 */
export function okumaParametresiVarMi(arama: string): boolean {
  return new URLSearchParams(arama).has('okuma')
}
