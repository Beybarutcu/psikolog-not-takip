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

/**
 * Taslağı KOŞULSUZ düşürür.
 *
 * `taslakTemizle`'den farkı ve tek meşru kullanımı: ekrandaki içeriğin
 * sunucudakiyle AYNI olduğu bilindiğinde. O anda depodaki kayıt son tuş
 * vuruşundan öncesine ait bir ARA hâl olabilir (kullanıcı yazıp geri
 * sildiğinde depoda öyle kalır) ve içerik karşılaştırması onu asla
 * silmezdi — kurtaracak bir şey taşımadığı hâlde sayfa ömrü boyunca
 * şifrelenmemiş düz metin sağlık verisi olarak bellekte kalırdı.
 *
 * Çağıran, uçuşta bir kayıt OLMADIĞINI da doğrulamak zorundadır: aksi hâlde
 * `taslakTemizle`'nin üstündeki yarış geri gelir.
 */
export function taslakDus(anahtar: string): void {
  taslaklar.delete(anahtar)
}

/**
 * # "Canlı" taslak: kilit kurtarması DEĞİL (son inceleme C1, ters yarış)
 *
 * Aynı resmî nota iki editör bakıyor (takvim ve danışan dosyası, aynı
 * `not-<id>` anahtarı) ve sekme değişirken biri giderken diğeri geliyor.
 * Gelen editör, giden editörün taslağını mount'ta bulabilir: giden editör
 * henüz ekrandan kalkmamıştır (yeni editör AYNI render'da kuruluyor, eskinin
 * unmount tahliyesi commit'ten SONRA çalışıyor) ya da kaydı/tahliyesi
 * uçuştadır. İki durumda da bu bir KİLİT kurtarması DEĞİLDİR — metin şu anda
 * sunucuya gidiyor — ve "oturum kilitlendiğinde kaydedilmemişti" şeridi
 * yanlış bilgi olurdu. Canlı bir taslak yine de GERİ YÜKLENİR (sunucudaki
 * eski metni göstermek, bir tuşla yazılanı ezmek demekti) ama şerit
 * gösterilmez.
 *
 * Kilit (401) kurtarmasıyla ayrım: kilitte `AnaEkran` unmount olur, bütün
 * editörler kapanır ve uçuştaki kayıtlar 401 ile biter — kilit açıldığında
 * taslağın ne sahibi ne uçuşu vardır, şerit görünür. Tahliye başka bir
 * sebeple başarısız olursa da aynı: işaret kalkar, taslak kalır, sonraki
 * mount onu olağan kurtarma olarak (şeritle) görür.
 *
 * İki SAYAÇ, küme değil: aynı anahtarın iki kaydı aynı anda uçuşta olabilir
 * (zamanlayıcının kaydı + unmount tahliyesi) ve ilk biten işareti
 * kaldırmamalı.
 */
const ucustakiler = new Map<string, number>()
const acikEditorler = new Map<string, number>()

function sayac(harita: Map<string, number>, anahtar: string, artir: boolean): void {
  const n = (harita.get(anahtar) ?? 0) + (artir ? 1 : -1)
  if (n > 0) harita.set(anahtar, n)
  else harita.delete(anahtar)
}

/** Bu anahtarın kaydı uçuşa çıktı (`true`) / bitti (`false`). */
export function taslakUcusta(anahtar: string, ucusta: boolean): void {
  sayac(ucustakiler, anahtar, ucusta)
}

/** Bu anahtarla bir editör monte oldu (`true`) / kalktı (`false`). */
export function taslakEditoru(anahtar: string, acik: boolean): void {
  sayac(acikEditorler, anahtar, acik)
}

/**
 * Taslak canlı mı: kaydı uçuşta ya da sahibi olan bir editör hâlâ monte.
 * Mount sırasında (render'da) sorulur — sorulan editörün KENDİ kaydı henüz
 * yapılmamıştır, dolayısıyla yalnızca BAŞKA editörler sayılır.
 */
export function taslakCanliMi(anahtar: string): boolean {
  return ucustakiler.has(anahtar) || acikEditorler.has(anahtar)
}

/** Yalnızca testler için: depo modül düzeyinde olduğu için testler arası sızar. */
export function taslaklariUnut(): void {
  taslaklar.clear()
  ucustakiler.clear()
  acikEditorler.clear()
}
