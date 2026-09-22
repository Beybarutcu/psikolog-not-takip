import type { Randevu } from '../../takvim/HaftalikTakvim'

/** Yerelde kesin bilinen tek-satır yazmanın alanları (durum ve ödeme). */
export type RandevuYamasi = Partial<Pick<Randevu, 'durum' | 'odendi'>>

/**
 * # Uçuştaki yazma × liste okuması (Görev 2 inceleme M7)
 *
 * `durumDegis` ve `odemeDegis` sonucu listelere YEREL olarak yazıyor (yeniden
 * yükleme yok). Bir liste GET'i yazma BİTMEDEN başlar ve yazmadan SONRA
 * dönerse, sunucu okumayı eski değerle yapmış olabilir ve yanıt yerel
 * değeri ezerdi: kullanıcı "ödendi" işaretler, ekran bir an sonra işaretsiz
 * (ya da borçlu) gösterir — sunucuda `true`, ekranda `false`.
 *
 * Mantıksal saat: her okuma başlarken bir damga alır (`okumaBasladi`), her
 * BAŞARILI yazma bittiğinde bir damga alır (`yazmaBitti`). Yanıt geldiğinde
 * (`uygula`), damgası okumanınkinden BÜYÜK (okuma başladığında henüz
 * bitmemiş) yazmaların alanları yanıtın üstüne uygulanır. Okuma başlamadan
 * ÖNCE biten yazma sunucunun okumasına zaten dahildir ve dokunulmaz. Uçuşta
 * olup sonra REDDEDİLEN yazma kaydedilmez: yanıttaki sunucu değeri doğrudur.
 * Tek kullanıcılı uygulama: yerel son değer, sunucudaki son değerdir.
 *
 * # TEK mekanizma, beş kullanıcı
 *
 * Aynı seans verisine birden çok ekran bakıyor ve her birinin kendi
 * önbelleği var; yazmalar TEK yoldan (`AnaEkran`) geçip hepsine yayılıyor
 * (son inceleme C1/C2). Yayılan her önbellek bu saatle korunuyor:
 *
 *   1. takvim listesi (`useTakvimAkisi`)             — durum/ödeme
 *   2. açık danışan kartının randevuları (`useDanisanDosyasi`) — durum/ödeme
 *   3. danışan dosyasının seans listesi (`useDanisanSeanslari`) — durum/
 *      ödeme/not önizlemesi/etiket adları (Plan 6 Görev 6)
 *   4. takvimdeki açık seansın resmî notu (`useSeansNotlari`) — not
 *   5. danışan dosyasındaki seçili seansın notu (`useDosyaNotu`) — not
 *
 * Seansın etiketleri bu listede YOK ve bilerek: iki ekran onları TEK bir
 * önbellekten okuyor (`useEtiketler`), yazma-okuma yarışı kutu yalnızca
 * liste yüklüyken çizildiği için kurulamıyor. Etiket SÖZLÜĞÜ ise aynı
 * mantıksal saatin işlem kaydı hâlini kullanıyor (ekleme satır doğurur,
 * satır yaması yetmez) — bkz. `useEtiketler` modül başlığı.
 *
 * Her kanca kendi örneğini tutar — okumalar kancanın içinde, yazmalar ise
 * kancanın dışa açtığı yama fonksiyonunda (`randevuYamala`, `yamala`,
 * `notYansit`) damgalanıyor; `AnaEkran` başarılı her yazmada ilgili bütün
 * kancaların yama fonksiyonunu çağırır.
 *
 * Kayıtlar farklı alanlarla tanımlanıyor (`Randevu.id`, `DanisanSeansi.
 * appointment_id`, `SeansNotu.appointment_id`); bu yüzden fabrika kimliği
 * okuyan fonksiyonu alıyor — hepsi AYNI randevu kimliği uzayında.
 *
 * Ölçen testler: `AnaEkran.test.tsx` > "ucustaki odeme/durum yazmasi, ONCE
 * baslayip SONRA donen hafta yuklemesinde ESKI degere donmez" (takvim),
 * "kart YUKLENIRKEN odeme isaretlenirse gec donen kart yaniti ESKI bakiyeyi
 * gostermez" (kart) ve "C1 ters yaris" / "C2 seans listesi ucus" blokları
 * (seans listesi ve iki not önbelleği).
 *
 * Bileşen dışı bir fabrika: çağıran `useState(() => yazmaSaatiOlustur(...))`
 * ile TEK örnek tutar, kimliği ömür boyu sabittir (efekt bağımlılıklarına
 * girse de yeniden çalıştırma tetiklemez).
 */
export function yazmaSaatiOlustur<T, Y extends Partial<T>>(kimlik: (kayit: T) => number) {
  let saat = 0
  const bitenYazmalar = new Map<number, { yama: Y; damga: number }>()

  return {
    /** Okuma İSTEĞİ ATILMADAN hemen önce çağrılır; dönen damga `uygula`ya gider. */
    okumaBasladi(): number {
      return ++saat
    },
    /** Yalnızca BAŞARILI yazmadan sonra çağrılır. */
    yazmaBitti(id: number, yama: Y) {
      const onceki = bitenYazmalar.get(id)
      bitenYazmalar.set(id, { yama: { ...onceki?.yama, ...yama }, damga: ++saat })
    },
    /** Okuma başladığında henüz bitmemiş yazmaları yanıtın üstüne uygular. */
    uygula<U extends T>(liste: U[], okumaDamgasi: number): U[] {
      return liste.map((r) => {
        const yazma = bitenYazmalar.get(kimlik(r))
        return yazma !== undefined && yazma.damga > okumaDamgasi ? { ...r, ...yazma.yama } : r
      })
    },
  }
}

/** Takvim listesi ve kartın ortak örneği: `Randevu.id` ile, durum/ödeme yamasıyla. */
export function randevuSaatiOlustur() {
  return yazmaSaatiOlustur<Randevu, RandevuYamasi>((r) => r.id)
}
