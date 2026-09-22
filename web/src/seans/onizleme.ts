import { SABLONLAR } from './sablon'

/**
 * Seans listesindeki not önizlemesinin azami uzunluğu, KARAKTER (kod noktası)
 * cinsinden. Sunucudaki `store::danisan_seanslari::AZAMI_ONIZLEME` ile aynı.
 */
export const AZAMI_ONIZLEME = 120

/**
 * Şablon başlıklarının KÖK adları (`"Veri"`, `"Değerlendirme"`, …) -- ne
 * kolon eklenmiş (`"Veri:"`, eski biçim) ne `#` önekli (`"## Veri"`, yeni
 * biçim). Hangi biçimin nasıl tanınacağı burada DEĞİL, `sablonBasligiEslesmesi`
 * içinde kurulu; liste ikinci kez elle yazılmıyor -- `SABLONLAR`dan (şema
 * tohumuyla `sablon.test.ts` üzerinden eşit tutulan tek kaynak) türetiliyor.
 */
const BASLIK_ADLARI = new Set(Object.values(SABLONLAR).flat())

/**
 * Notun seans listesindeki önizlemesi — sunucudaki
 * `store::danisan_seanslari::onizleme`'nin İSTEMCİ EŞİ.
 *
 * # Neden istemcide de var
 *
 * Not kaydedildiğinde danışan dosyasının seans listesi YENİDEN ÇEKİLMİYOR
 * (`useDanisanSeanslari.yamala`, çağıran: `AnaEkran::seansNotuKaydet`): her
 * çekme sunucuda SİLİNEMEZ bir `goruntuleme` satırı yazar ve sonuç (tek
 * seansın önizlemesi) yerelde kesin olarak hesaplanabilir. Hesaplanmasaydı
 * takvimde yazılan not dosya listesinde "Not yazılmamış" kalırdı --
 * tasarımın "eksik not gözden kaçmasın" sinyali YANLIŞ bilgi verirdi (son
 * inceleme C2).
 *
 * # İki uygulama ayrışamaz (Görev 3 incelemesi CRITICAL'i)
 *
 * Not editörü Markdown'a geçtikten sonra sunucu tarafı güncellendi ama BU
 * dosya unutulmuştu: yalnızca eski `"Veri:"` biçimini tanıyordu, `"## Veri"`
 * biçimini de satır içi `**`/`*` işaretlerini de arındırmıyordu. Sonuç: bir
 * not kaydedildiği AN çapraz önbellek kuralını (bkz. proje geneli kısıtları)
 * ihlal ediyordu -- kayıttan hemen sonra bu fonksiyonun ürettiği (ham,
 * yanlış) değer, liste yeniden çekildiğinde sunucunun ürettiği (arındırılmış,
 * doğru) değerle çakışmıyordu; aynı seans anlık olarak iki farklı önizleme
 * gösteriyordu. Bu fonksiyon artık sunucudaki Rust `onizleme`nin BİREBİR
 * karşılığı: iki başlık biçimi (`"Veri:"` VE `"#{1,3} Veri"`), blok öneki
 * arındırma (`#`, `-`, `1.`, `>`, `- [ ]`/`- [x]`), satır içi `**`/`*`
 * arındırma (kural `web/src/not/markdown.tsx::satirIci` ile AYNI: kalın önce
 * kendi çiftini tüketerek eşleşir, italik yalnızca kalandan aranır, kapanışsız
 * işaret metin kalır) ve `\r\n`/tek başına `\r` normalleştirmesi.
 *
 * Kural iki dilde yazılı, ayrışmaları ORTAK örnek dosyasıyla ölçülüyor:
 * `core/src/store/onizleme_ornekleri.json` hem bu dosyanın testi
 * (`onizleme.test.ts`) hem sunucunun `onizleme_ortak_ornekleri_saglar` testi
 * tarafından okunur.
 *
 * Kırpma `Array.from` ile KOD NOKTASI üzerinden: Rust'ın `chars()`ı Unicode
 * skaler değerlerini sayar, UTF-16 birimi sayan `slice` bir vekil çiftin
 * (emoji) ortasından keserdi. Kırpma Markdown ayıklamasından SONRA uygulanır
 * -- atılan `**`/`##` önekleri 120 karakter sayımına girmemeli.
 */
export function notOnizlemesi(icerik: string): string {
  // `\r\n` VE tek başına `\r` (eski Mac) -> `\n`. Bölme yalnızca `\n`
  // üzerinden yapıldığı için (JS'te satır ayracı arayan hazır bir eşdeğer
  // yok) bu adım atlanırsa tek başına `\r` içeren bir "satır" ayrılmadan
  // kalır ve hem başlık karşılaştırmasını hem dönen metni bozar (Rust
  // tarafındaki `onizleme`yle AYNI gerekçe).
  const normal = icerik.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  let ilkBaslik: string | null = null
  for (const hamSatir of normal.split('\n')) {
    const satir = hamSatir.trim()
    if (satir === '') continue
    const baslikAdi = sablonBasligiEslesmesi(satir)
    if (baslikAdi !== null) {
      ilkBaslik ??= baslikAdi
      continue
    }
    return kirp(bicimdenArindir(satir))
  }
  return kirp(ilkBaslik ?? '')
}

function kirp(metin: string): string {
  return Array.from(metin).slice(0, AZAMI_ONIZLEME).join('')
}

/**
 * Bir satırın başındaki Markdown başlık önekini (`#`, `##` ya da `###` + TAM
 * OLARAK BİR boşluk) ayıklar; varsa önek atılmış GÖVDEYİ döner. Arayüzdeki
 * kapalı kümenin (`not/desenler.ts::BASLIK_DUZENLI`, `/^(#{1,3}) (.*)$/`)
 * BİREBİR karşılığı: dört ve üzeri `#` başlık SAYILMAZ, boşluksuz `#etiket`
 * başlık SAYILMAZ.
 */
function baslikOnekiniAyikla(satir: string): string | null {
  let hashSayisi = 0
  while (hashSayisi < satir.length && satir[hashSayisi] === '#') hashSayisi++
  if (hashSayisi === 0 || hashSayisi > 3) return null
  if (satir[hashSayisi] !== ' ') return null
  return satir.slice(hashSayisi + 1)
}

/**
 * Şablon başlığı satırını HER İKİ biçimde tanır; tanırsa (önizlemenin
 * yalnızca başlıklardan oluşan bir notta YEDEK olarak döneceği) görüntü
 * metnini döner: eski biçimde iki nokta olduğu gibi kalır (Markdown öneki
 * değil, notun kendi metnidir), yeni biçimde yalnızca `#` öneki atılmış
 * başlık adı. Her iki biçimde de TAM eşleşme aranır -- `"Veri: ek metin"`
 * ya da `"## Veri ek metin"` başlık SAYILMAZ.
 */
function sablonBasligiEslesmesi(satir: string): string | null {
  const govde = baslikOnekiniAyikla(satir)
  if (govde !== null) {
    return BASLIK_ADLARI.has(govde) ? govde : null
  }
  for (const b of BASLIK_ADLARI) {
    if (`${b}:` === satir) return `${b}:`
  }
  return null
}

/**
 * `"- [ ] "` / `"- [x] "` / `"- [X] "` önekini ayıklar; kapanıştan sonraki
 * boşluk OPSİYONELDİR (`not/desenler.ts::ONAY_KUTUSU_DUZENLI`,
 * `/^- \[([ xX])\] ?(.*)$/` ile aynı) -- önce boşluklu biçim denenir.
 */
function onayKutusuAyikla(satir: string): string | null {
  for (const onek of ['- [ ] ', '- [x] ', '- [X] ', '- [ ]', '- [x]', '- [X]']) {
    if (satir.startsWith(onek)) return satir.slice(onek.length)
  }
  return null
}

/**
 * `"1. "`, `"12. "` gibi numaralı liste önekini ayıklar
 * (`not/desenler.ts::NUMARALI_DUZENLI`, `/^\d+\. (.*)$/`): en az bir rakam,
 * ardından TAM OLARAK `". "`. Parantezli biçim (`"1) "`) kapalı kümede
 * DEĞİL, değişmeden kalır.
 */
function numaraliOnekiniAyikla(satir: string): string | null {
  let i = 0
  while (i < satir.length && satir[i] >= '0' && satir[i] <= '9') i++
  if (i === 0) return null
  if (satir.slice(i, i + 2) !== '. ') return null
  return satir.slice(i + 2)
}

/**
 * Önizlemeye giren TEK satırdaki Markdown blok önekini (başlık, madde,
 * numaralı liste, alıntı, onay kutusu) atar, ardından satır içi kalın/italik
 * işaretlerini kaldırır. Önekli OLMAYAN her karakter -- kapanmamış `**`,
 * boşluksuz `#etiket`, tek başına `*`, parantezli `1)` -- Markdown sayılmaz
 * ve olduğu gibi kalır (arayüzdeki `markdown.tsx` çeviricisiyle aynı
 * davranış).
 */
function bicimdenArindir(satir: string): string {
  const alinti = satir.startsWith('>') ? (satir.slice(1).startsWith(' ') ? satir.slice(2) : satir.slice(1)) : null
  const govde =
    baslikOnekiniAyikla(satir) ??
    onayKutusuAyikla(satir) ??
    (satir.startsWith('- ') ? satir.slice(2) : null) ??
    numaraliOnekiniAyikla(satir) ??
    alinti ??
    satir
  return bicimIsaretleriniKaldir(govde)
}

/**
 * `**icerik**` (bitişik, en KISA kapanışla, iç boş OLAMAZ) eşleşmelerinin
 * aralıklarını soldan sağa bulur: `[tam_baslangic, tam_bitis, ic_baslangic,
 * ic_bitis]`. `markdown.tsx::KALIN_DUZENLI` (iki yıldız + lazy + iki yıldız,
 * global bayraklı) ile AYNI lazy/global tarama kuralı: bir açılıştan sonra
 * iç boş kalırsa (`"****"`)
 * o açılış eşleşmez, tarama açılıştan BİR SONRAKİ karakterden devam eder.
 */
function kalinAraliklari(metin: string): Array<[number, number, number, number]> {
  const sonuclar: Array<[number, number, number, number]> = []
  let ara = 0
  while (ara < metin.length) {
    const acilis = metin.indexOf('**', ara)
    if (acilis === -1) break
    const icBaslangic = acilis + 2
    const kapanis = metin.indexOf('**', icBaslangic)
    if (kapanis !== -1 && kapanis > icBaslangic) {
      sonuclar.push([acilis, kapanis + 2, icBaslangic, kapanis])
      ara = kapanis + 2
      continue
    }
    ara = acilis + 1
  }
  return sonuclar
}

/**
 * `*icerik*` için `kalinAraliklari` ile AYNI kural, tek yıldızla
 * (`markdown.tsx::ITALIK_DUZENLI`, tek yıldız + lazy + tek yıldız, global
 * bayraklı). Yalnızca kalın geçişinden ARTA KALAN metin parçaları üzerinde çağrılır -- kalın içeriği
 * tekrar ayrıştırılmaz.
 */
function italikAraliklari(metin: string): Array<[number, number, number, number]> {
  const sonuclar: Array<[number, number, number, number]> = []
  let ara = 0
  while (ara < metin.length) {
    const acilis = metin.indexOf('*', ara)
    if (acilis === -1) break
    const icBaslangic = acilis + 1
    if (icBaslangic >= metin.length) break
    const kapanis = metin.indexOf('*', icBaslangic)
    if (kapanis !== -1 && kapanis > icBaslangic) {
      sonuclar.push([acilis, kapanis + 1, icBaslangic, kapanis])
      ara = kapanis + 1
      continue
    }
    ara = acilis + 1
  }
  return sonuclar
}

/**
 * Satır içi `**kalın**`/`*italik*` işaretlerini kaldırır, İÇERİĞİ olduğu
 * gibi bırakır. Kapanışı bulunamayan tek bir `*`/`**` METİN olarak kalır --
 * `markdown.tsx::satirIci` ile aynı, yalnızca React düğümleri yerine düz
 * metin üretir.
 */
function bicimIsaretleriniKaldir(metin: string): string {
  let sonuc = ''
  let konum = 0
  for (const [acilis, kapanis, icBaslangic, icBitis] of kalinAraliklari(metin)) {
    if (acilis > konum) sonuc += italikIsaretleriniKaldir(metin.slice(konum, acilis))
    sonuc += metin.slice(icBaslangic, icBitis)
    konum = kapanis
  }
  if (konum < metin.length) sonuc += italikIsaretleriniKaldir(metin.slice(konum))
  return sonuc
}

function italikIsaretleriniKaldir(metin: string): string {
  let sonuc = ''
  let konum = 0
  for (const [acilis, kapanis, icBaslangic, icBitis] of italikAraliklari(metin)) {
    if (acilis > konum) sonuc += metin.slice(konum, acilis)
    sonuc += metin.slice(icBaslangic, icBitis)
    konum = kapanis
  }
  if (konum < metin.length) sonuc += metin.slice(konum)
  return sonuc
}
