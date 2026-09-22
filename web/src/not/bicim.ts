/**
 * Not editörünün biçim uygulama mantığı — **saf fonksiyon**.
 *
 * # Neden saf
 *
 * `NotEditoru` metni yalnızca kendi `onChange` yolundan (dolayısıyla otomatik
 * kayıt, taslak saklama ve 401'de taslağın geri yüklenmesi) değiştirmelidir.
 * Bu dosya DOM'a, textarea'ya, React'e dokunmaz: girdi olarak metni ve seçim
 * sınırlarını alır, çıktı olarak yeni metni ve yeni seçimi döndürür. Çağıran
 * taraf (`NotEditoru`) sonucu KENDİ `setIcerik`'ine yazar — biçim çubuğu ve
 * kısayollar ayrı bir kayıt yolu AÇMAZ.
 *
 * # Konum birimi
 *
 * `bas`/`son` UTF-16 kod birimi cinsindendir — `textarea.selectionStart` /
 * `selectionEnd` ile aynı birim. Türkçe harfler (ç, ğ, ı, ö, ş, ü) Temel Çok
 * Dilli Düzlem'de tek kod birimidir, bu yüzden ekstra bir dönüşüm gerekmez.
 */
export type BicimTuru =
  | 'kalin'
  | 'italik'
  | 'baslik1'
  | 'baslik2'
  | 'baslik3'
  | 'madde'
  | 'numara'
  | 'alinti'
  | 'onay'

export type Secim = { metin: string; bas: number; son: number }

// `markdown.tsx::siniflandirSatir`daki desenlerle birebir aynı — çevirici
// hangi satırı hangi blok sayıyorsa, biçimleyici de "bu satırda zaten bu
// biçim var mı" sorusunu aynı desenle yanıtlar. İki dosya ayrı yaşıyor
// (`markdown.tsx` bu sabitleri dışa aktarmıyor) çünkü sorumlulukları farklı:
// biri saklanan metni GÖRÜNTÜYE çevirir, öbürü textarea SEÇİMİNİ metne.
const BASLIK_DUZENLI = /^(#{1,3}) (.*)$/
const ONAY_KUTUSU_DUZENLI = /^- \[([ xX])\] ?(.*)$/
const MADDE_DUZENLI = /^- (.*)$/
const NUMARALI_DUZENLI = /^\d+\. (.*)$/
const ALINTI_DUZENLI = /^> ?(.*)$/

const SATIR_ICI_ISARETLER: Record<'kalin' | 'italik', string> = {
  kalin: '**',
  italik: '*',
}

export function bicimUygula(girdi: Secim, tur: BicimTuru): Secim {
  if (tur === 'kalin' || tur === 'italik') {
    return satirIciBicimUygula(girdi, SATIR_ICI_ISARETLER[tur])
  }
  return satirBasiBicimUygula(girdi, tur)
}

type SatirBasiTuru = Exclude<BicimTuru, 'kalin' | 'italik'>

/**
 * Kalın/italik: seçimi işaretlerle sarar. Seçim yoksa (imleç) işaret çifti
 * eklenir ve imleç araya konur. Seçim, işaretlerin HEMEN DIŞINDA zaten
 * sarılıysa (ör. `**` `çok` `**` — işaretler seçimin dışında, bitişik)
 * işaretler kaldırılır (aç/kapa).
 */
function satirIciBicimUygula(girdi: Secim, isaret: string): Secim {
  const { metin, bas, son } = girdi
  const uzunluk = isaret.length

  if (bas === son) {
    const yeni = metin.slice(0, bas) + isaret + isaret + metin.slice(bas)
    return { metin: yeni, bas: bas + uzunluk, son: bas + uzunluk }
  }

  const secili = metin.slice(bas, son)

  const disardaSarili =
    bas >= uzunluk &&
    son + uzunluk <= metin.length &&
    metin.slice(bas - uzunluk, bas) === isaret &&
    metin.slice(son, son + uzunluk) === isaret

  if (disardaSarili) {
    const yeni = metin.slice(0, bas - uzunluk) + secili + metin.slice(son + uzunluk)
    return { metin: yeni, bas: bas - uzunluk, son: son - uzunluk }
  }

  const yeni = metin.slice(0, bas) + isaret + secili + isaret + metin.slice(son)
  return { metin: yeni, bas: bas + uzunluk, son: son + uzunluk }
}

/** Bir satırın orijinal ve (varsa) değişmiş hâli. Değişmeyen satırlarda ikisi aynıdır. */
type SatirIslemi = { orijinal: string; yeni: string }

/**
 * Satır başı biçimler (başlık, madde, numaralı liste, alıntı, onay kutusu):
 * seçimin dokunduğu HER satırın başına önek eklenir; dokunulan satırların
 * HEPSİNDE önek zaten varsa kaldırılır. Başlıklarda düzeyler birbirinin
 * yerine geçer: bir satırda BAŞKA bir düzeyde başlık zaten varsa, önek
 * KALDIRILMAZ, yeni düzeyle DEĞİŞTİRİLİR (`# ` → `baslik2` → `## `, `### #`
 * değil).
 */
function satirBasiBicimUygula(girdi: Secim, tur: SatirBasiTuru): Secim {
  const { metin, bas, son } = girdi
  const satirlar = metin.split('\n')

  const baslangicOfsetleri: number[] = []
  let ofset = 0
  for (const s of satirlar) {
    baslangicOfsetleri.push(ofset)
    ofset += s.length + 1 // +1: '\n'
  }

  const dokunanlar = satirlar.map((s, i) => {
    const basSatir = baslangicOfsetleri[i]
    const sonSatir = basSatir + s.length
    // İmleç (seçim yok): satırı İÇEREN tek satır (sınırlar dahil).
    // Seçim varsa: klasik yarı-açık aralık çakışması.
    return bas === son
      ? basSatir <= bas && bas <= sonSatir
      : basSatir < son && bas < sonSatir
  })

  const islemler = satirlarDegistir(satirlar, dokunanlar, tur)

  let yeniMetin = ''
  let yeniBas = bas
  let yeniSon = son
  let yeniOfset = 0

  islemler.forEach((islem, i) => {
    const origBas = baslangicOfsetleri[i]
    const origUzunluk = islem.orijinal.length
    const fark = islem.yeni.length - origUzunluk

    const esle = (konum: number): number | null => {
      if (konum < origBas || konum > origBas + origUzunluk) return null
      const icOfset = konum - origBas
      const yeniIcOfset = fark >= 0 ? icOfset + fark : Math.max(0, icOfset + fark)
      return yeniOfset + yeniIcOfset
    }

    const yeniBasAday = esle(bas)
    if (yeniBasAday !== null) yeniBas = yeniBasAday
    const yeniSonAday = esle(son)
    if (yeniSonAday !== null) yeniSon = yeniSonAday

    yeniMetin += islem.yeni
    if (i < islemler.length - 1) yeniMetin += '\n'
    yeniOfset += islem.yeni.length + 1
  })

  return { metin: yeniMetin, bas: yeniBas, son: yeniSon }
}

function satirlarDegistir(satirlar: string[], dokunanlar: boolean[], tur: SatirBasiTuru): SatirIslemi[] {
  if (tur === 'baslik1' || tur === 'baslik2' || tur === 'baslik3') {
    return baslikSatirlariDegistir(satirlar, dokunanlar, tur)
  }
  return listeSatirlariDegistir(satirlar, dokunanlar, tur)
}

function baslikSatirlariDegistir(
  satirlar: string[],
  dokunanlar: boolean[],
  tur: 'baslik1' | 'baslik2' | 'baslik3',
): SatirIslemi[] {
  const hedefSeviye = tur === 'baslik1' ? 1 : tur === 'baslik2' ? 2 : 3
  const dokunanIndeksler = dokunanlar.flatMap((d, i) => (d ? [i] : []))
  const hepsiHedefSeviyede =
    dokunanIndeksler.length > 0 &&
    dokunanIndeksler.every((i) => {
      const m = BASLIK_DUZENLI.exec(satirlar[i])
      return m !== null && m[1].length === hedefSeviye
    })

  return satirlar.map((s, i) => {
    if (!dokunanlar[i]) return { orijinal: s, yeni: s }
    const m = BASLIK_DUZENLI.exec(s)
    if (hepsiHedefSeviyede) {
      // Aç/kapa: hepsi zaten bu düzeyde — önek kaldırılır.
      return { orijinal: s, yeni: m !== null ? m[2] : s }
    }
    // Ya önek hiç yok (ekle) ya da BAŞKA bir düzeyde (değiştir) — ikisi de
    // aynı işlem: mevcut içeriğin önüne hedef düzeyin önekini koy.
    const icerik = m !== null ? m[2] : s
    return { orijinal: s, yeni: '#'.repeat(hedefSeviye) + ' ' + icerik }
  })
}

function listeSatirlariDegistir(
  satirlar: string[],
  dokunanlar: boolean[],
  tur: 'madde' | 'numara' | 'alinti' | 'onay',
): SatirIslemi[] {
  const desen =
    tur === 'madde'
      ? MADDE_DUZENLI
      : tur === 'numara'
        ? NUMARALI_DUZENLI
        : tur === 'alinti'
          ? ALINTI_DUZENLI
          : ONAY_KUTUSU_DUZENLI

  const dokunanIndeksler = dokunanlar.flatMap((d, i) => (d ? [i] : []))
  const hepsindeVar = dokunanIndeksler.length > 0 && dokunanIndeksler.every((i) => desen.test(satirlar[i]))

  let numaraSayaci = 1

  return satirlar.map((s, i) => {
    if (!dokunanlar[i]) return { orijinal: s, yeni: s }

    if (hepsindeVar) {
      // Aç/kapa: hepsinde zaten var — önek kaldırılır. Yakalama grupları
      // sırasıyla [tam eşleşme, ...ara gruplar, içerik] biçiminde; içerik
      // her desende SON gruptur (onayda ikinci, ötekilerde ilk).
      const m = desen.exec(s)
      return { orijinal: s, yeni: m !== null ? m[m.length - 1] : s }
    }

    if (desen.test(s)) {
      // Bu satırda zaten var ama SEÇİMDEKİ HEPSİNDE değil — dokunma.
      // Karışık seçimde var olanı bozmadan eksik olanlara eklemek, mevcut
      // bir madde/alıntı/onay satırının önekini ikiletmemek için.
      return { orijinal: s, yeni: s }
    }

    const onEk =
      tur === 'madde'
        ? '- '
        : tur === 'numara'
          ? `${numaraSayaci++}. `
          : tur === 'alinti'
            ? '> '
            : '- [ ] '
    return { orijinal: s, yeni: onEk + s }
  })
}
