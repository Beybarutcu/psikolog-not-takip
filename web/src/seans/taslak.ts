/**
 * Kaydedilmemiş not içeriğinin **bileşen ağacının dışındaki** deposu.
 *
 * # Neden var: 401 sırasında yazılmamış içerik
 *
 * Plan 3'ün bağlayıcı kısıtı: *otomatik kayıt sırasında 401 gelirse yazılmamış
 * not içeriği sessizce düşürülemez.* Bu nadir bir kenar durum değil, olağan
 * bir durumdur: editör 2 saniyede bir yazar, terapist danışanı kapıya geçirir
 * (5 dakika), boşta kalma kilidi devreye girer, döner ve yazmaya devam eder.
 *
 * Bugünkü mekanizma şudur: `api.ts`'teki `istek()` her 401'de dinleyicileri
 * throw'dan ÖNCE senkron tetikler, `App.tsx` bunu duyunca `AnaEkran`'ı
 * **gerçek unmount** eder (görsel perde değil — bu kilit vaadinin kendisi ve
 * korunmalı). Unmount, editörün React state'ini de yok eder. Dolayısıyla
 * "metni React state'inde tut" ile bu kısıt sağlanamaz; metnin ağacın
 * dışında, kilit boyunca yaşayan bir yerde durması gerekir. Burası orası.
 *
 * # Neden bellek — `localStorage` DEĞİL
 *
 * `localStorage`/`sessionStorage`/IndexedDB diske yazar. Not içeriği sağlık
 * verisidir ve bu uygulamanın tüm gizlilik vaadi, sağlık verisinin **yalnızca
 * SQLCipher ile şifrelenmiş veritabanında** durmasıdır. Taslağı tarayıcı
 * deposuna yazmak, aynı veriyi şifrelenmemiş biçimde ikinci bir yere
 * kopyalamak olurdu — kilidi açılmamış bir makinede bile okunabilir hâlde.
 * Bellek ise kilitliyken de zaten sürecin içinde: kullanıcının o an yazdığı
 * metin ekrandan kalkar, diske hiç düşmez, süreç kapanınca kaybolur.
 *
 * Bunun kabul edilen bedeli açıktır: uygulama kilitliyken **çökerse** ya da
 * kapatılırsa kaydedilmemiş metin gider. Alternatifi (diske düz metin sağlık
 * verisi) daha büyük bir zarardır; ve editör kilitten önce en fazla
 * `gecikmeMs` kadarlık bir pencereyi kaydetmemiş olur.
 *
 * # Anahtar başına ayrı taslak
 *
 * Taslaklar not kimliğine (`not-<randevu id>`, `ozel-<randevu id>`) göre
 * ayrılır. Tek bir ortak gözde tutulsaydı, bir seansın kaydedilmemiş metni
 * başka bir seansın editörüne geri yüklenirdi — Plan 2 Görev 10'un
 * Critical'ının (panel state'inin seçimden seçime sızması) aynısı, bu kez
 * yanlış danışanın dosyasına yazılmış not olarak.
 */

export type Taslak = { sablon: string; icerik: string }

const taslaklar = new Map<string, Taslak>()

export function taslakYaz(anahtar: string, taslak: Taslak): void {
  taslaklar.set(anahtar, taslak)
}

export function taslakOku(anahtar: string): Taslak | undefined {
  return taslaklar.get(anahtar)
}

/**
 * Kaydı doğrulanmış içeriği taslaktan düşürür.
 *
 * `kaydedilen` ile KARŞILAŞTIRIR ve yalnızca eşitse siler. Koşulsuz silmek
 * şu yarışı kaybederdi: kayıt uçarken kullanıcı yazmaya devam eder, taslak
 * yeni metinle güncellenir, sonra ESKİ metnin kaydı başarıyla döner ve
 * silme, henüz sunucuya hiç gitmemiş YENİ metni siler. Kaybolan tam olarak
 * bu deponun korumak için var olduğu şeydir.
 */
export function taslakTemizle(anahtar: string, kaydedilen: Taslak): void {
  const mevcut = taslaklar.get(anahtar)
  if (mevcut === undefined) return
  if (mevcut.icerik === kaydedilen.icerik && mevcut.sablon === kaydedilen.sablon) {
    taslaklar.delete(anahtar)
  }
}

/** Yalnızca testler için: depo modül düzeyinde olduğu için testler arası sızar. */
export function taslaklariUnut(): void {
  taslaklar.clear()
}
