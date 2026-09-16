import type { Randevu } from '../../takvim/HaftalikTakvim'

/** Yerelde kesin bilinen tek-satır yazmanın alanları (durum ve ödeme). */
export type RandevuYamasi = Partial<Pick<Randevu, 'durum' | 'odendi'>>

/**
 * # Uçuştaki yazma × randevu listesi okuması (Görev 2 inceleme M7)
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
 * TEK mekanizma, iki kullanıcı: takvim listesi (`useTakvimAkisi`) ve açık
 * danışan kartının randevuları (`useDanisanDosyasi`). Her kanca kendi
 * örneğini tutar — okumalar ve yazmalar aynı kancanın içinde damgalanıyor.
 *
 * Ölçen testler: `AnaEkran.test.tsx` > "ucustaki odeme/durum yazmasi, ONCE
 * baslayip SONRA donen hafta yuklemesinde ESKI degere donmez" (takvim) ve
 * "kart YUKLENIRKEN odeme isaretlenirse gec donen kart yaniti ESKI bakiyeyi
 * gostermez" (kart).
 *
 * Bileşen dışı bir fabrika: çağıran `useState(yazmaSaatiOlustur)` ile TEK
 * örnek tutar, kimliği ömür boyu sabittir (efekt bağımlılıklarına girse de
 * yeniden çalıştırma tetiklemez).
 */
export function yazmaSaatiOlustur() {
  let saat = 0
  const bitenYazmalar = new Map<number, { yama: RandevuYamasi; damga: number }>()

  return {
    /** Okuma İSTEĞİ ATILMADAN hemen önce çağrılır; dönen damga `uygula`ya gider. */
    okumaBasladi(): number {
      return ++saat
    },
    /** Yalnızca BAŞARILI yazmadan sonra çağrılır. */
    yazmaBitti(id: number, yama: RandevuYamasi) {
      const onceki = bitenYazmalar.get(id)
      bitenYazmalar.set(id, { yama: { ...onceki?.yama, ...yama }, damga: ++saat })
    },
    /** Okuma başladığında henüz bitmemiş yazmaları yanıtın üstüne uygular. */
    uygula<T extends Randevu>(liste: T[], okumaDamgasi: number): T[] {
      return liste.map((r) => {
        const yazma = bitenYazmalar.get(r.id)
        return yazma !== undefined && yazma.damga > okumaDamgasi ? { ...r, ...yazma.yama } : r
      })
    },
  }
}

export type YazmaSaati = ReturnType<typeof yazmaSaatiOlustur>
