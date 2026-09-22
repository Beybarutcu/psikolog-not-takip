import {
  ALINTI_DUZENLI,
  BASLIK_DUZENLI,
  MADDE_DUZENLI,
  NUMARALI_DUZENLI,
  ONAY_KUTUSU_DUZENLI,
} from './desenler'

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

// Satır başı desenleri `markdown.tsx::siniflandirSatir` ile AYNI nesneler
// (`desenler.ts`, son inceleme M2): çevirici hangi satırı hangi blok
// sayıyorsa, biçimleyici de "bu satırda zaten bu biçim var mı" sorusunu aynı
// desenle yanıtlar. Dosyalar ayrı kalıyor çünkü sorumlulukları farklı: biri
// saklanan metni GÖRÜNTÜYE çevirir, öbürü textarea SEÇİMİNİ metne.

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

type ListeAilesiTuru = 'madde' | 'numara' | 'onay'
type ListeSatirBilgisi = { tur: ListeAilesiTuru; icerik: string } | null

/**
 * Bir satırın liste ailesi (madde/numaralı liste/onay kutusu) önekini
 * algılar. ONAY deseni MUTLAKA madde deseninden ÖNCE sınanır: `- [ ] metin`
 * madde deseniyle de eşleşir (`MADDE_DUZENLI` içeriği `[ ] metin` olarak
 * yakalardı) — sıra ters olsaydı bir onay satırına `madde` uygulamak onay
 * işaretini SESSİZCE BOZARDI (inceleme bulgusu IMPORTANT-1, birinci durum:
 * `- [ ] Odev ver` + madde → `[ ] Odev ver`).
 */
function listeSatiriAlgila(satir: string): ListeSatirBilgisi {
  const onay = ONAY_KUTUSU_DUZENLI.exec(satir)
  if (onay !== null) return { tur: 'onay', icerik: onay[2] }
  const numarali = NUMARALI_DUZENLI.exec(satir)
  if (numarali !== null) return { tur: 'numara', icerik: numarali[1] }
  const madde = MADDE_DUZENLI.exec(satir)
  if (madde !== null) return { tur: 'madde', icerik: madde[1] }
  return null
}

function listeSatirlariDegistir(
  satirlar: string[],
  dokunanlar: boolean[],
  tur: 'madde' | 'numara' | 'alinti' | 'onay',
): SatirIslemi[] {
  if (tur === 'alinti') {
    return alintiSatirlariDegistir(satirlar, dokunanlar)
  }
  return listeAilesiSatirlariDegistir(satirlar, dokunanlar, tur)
}

/**
 * Alıntı, liste ailesinden (madde/numaralı/onay) BİLEREK AYRI tutuluyor.
 *
 * Blockquote bir liste ÖĞESİ işareti değil, farklı bir blok kavramı ve
 * öneki (`> `) liste önekleriyle (`- `, rakam) hiçbir karakteri PAYLAŞMIYOR
 * — IMPORTANT-1'in bozduğu üç durumun (Odev ver, `- bir`+onay, `1. bir`+
 * madde) hiçbiri alıntıyı içermiyordu, üçü de madde/numara/onay arasındaki
 * PAYLAŞILAN önek karakterlerinden ('- ' hem madde hem onayın başı,
 * rakam+'. ' numaranın) kaynaklanıyordu. Alıntıyı aileye katıp "farklı
 * türse DEĞİŞTİR" kuralını ona da uygulamak, bir alıntı satırına `madde`
 * uygulandığında `> ` işaretini SESSİZCE SİLERDİ — terapistin bilerek
 * danışanın kendi cümlesi olarak işaretlediği bir alıntının kaybolması,
 * üstüste binen önekten (kozmetik) daha ciddi bir veri kaybı olurdu.
 * Dolayısıyla alıntı burada eskisi gibi BAĞIMSIZ kalıyor: yalnızca kendi
 * deseniyle aç/kapa yapılır, başka bir liste türüyle etkileşmez.
 */
function alintiSatirlariDegistir(satirlar: string[], dokunanlar: boolean[]): SatirIslemi[] {
  const dokunanIndeksler = dokunanlar.flatMap((d, i) => (d ? [i] : []))
  const hepsindeVar = dokunanIndeksler.length > 0 && dokunanIndeksler.every((i) => ALINTI_DUZENLI.test(satirlar[i]))

  return satirlar.map((s, i) => {
    if (!dokunanlar[i]) return { orijinal: s, yeni: s }
    if (hepsindeVar) {
      const m = ALINTI_DUZENLI.exec(s)
      return { orijinal: s, yeni: m !== null ? m[1] : s }
    }
    if (ALINTI_DUZENLI.test(s)) return { orijinal: s, yeni: s }
    return { orijinal: s, yeni: '> ' + s }
  })
}

/**
 * Madde/numaralı liste/onay kutusu AYNI AİLE: bir satırda bu üçünden BİRİ
 * zaten varsa ve hedef FARKLIYSA önek KALDIRILMAZ, DEĞİŞTİRİLİR (başlık
 * düzeylerinin birbirinin yerine geçmesiyle aynı mantık, `baslikSatirlariDegistir`
 * ile karşılaştır). Üstüste binen önekler (`- [ ] - bir`, `- 1. bir` —
 * IMPORTANT-1'in ikinci ve üçüncü durumu) bu yüzden artık oluşmuyor.
 *
 * Onay → madde/numara dönüşümünde işaret durumu (`[x]`/`[ ]`) KAYBOLUR:
 * kabul edilen, bilinçli davranış — hedef tür zaten bir "işaretli/işaretsiz"
 * kavramı taşımıyor, taşınacak bir yer yok (`bicim.test.ts` bunu
 * `[x] işaretli onay -> madde` testiyle sabitliyor).
 */
function listeAilesiSatirlariDegistir(
  satirlar: string[],
  dokunanlar: boolean[],
  hedefTur: ListeAilesiTuru,
): SatirIslemi[] {
  const dokunanIndeksler = dokunanlar.flatMap((d, i) => (d ? [i] : []))
  const hepsiHedefTurde =
    dokunanIndeksler.length > 0 &&
    dokunanIndeksler.every((i) => {
      const bilgi = listeSatiriAlgila(satirlar[i])
      return bilgi !== null && bilgi.tur === hedefTur
    })

  let numaraSayaci = 1

  return satirlar.map((s, i) => {
    if (!dokunanlar[i]) return { orijinal: s, yeni: s }
    const bilgi = listeSatiriAlgila(s)

    if (hepsiHedefTurde) {
      // Aç/kapa: hepsi zaten hedef türde — önek kaldırılır.
      return { orijinal: s, yeni: bilgi !== null ? bilgi.icerik : s }
    }

    // Ya önek hiç yok (ekle) ya da AİLEDEN BAŞKA bir türde (değiştir) —
    // ikisi de aynı işlem: mevcut İÇERİĞİN önüne hedef türün önekini koy.
    const icerik = bilgi !== null ? bilgi.icerik : s
    const onEk = hedefTur === 'madde' ? '- ' : hedefTur === 'onay' ? '- [ ] ' : `${numaraSayaci++}. `
    return { orijinal: s, yeni: onEk + icerik }
  })
}
