/**
 * Okuma penceresi adresi (tasarım P2). Açan yarı burada; okuyan yarı
 * (`okumaKimligi`) Görev 9'da aynı dosyaya eklenir.
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
