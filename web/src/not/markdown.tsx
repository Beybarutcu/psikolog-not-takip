import type { ReactNode } from 'react'

/**
 * Notun Markdown kaynağını React elemanlarına çevirir — KAPALI bir küme.
 *
 * # Neden kendi çeviricimiz
 *
 * Proje paket eklemeden ilerliyor (TL biçimlendirici de elle yazıldı) ve HTML
 * üreten bir çevirici not içeriğini DOM'a enjekte eden bir yol açardı. Bu
 * fonksiyon HTML DİZGİSİ ÜRETMEZ: her parça bir React elemanı ya da düz metin
 * düğümüdür, React metni kendisi kaçırır. Not içindeki `<script>` bu yüzden
 * ekranda harfi harfine görünür.
 *
 * # Kapalı küme
 *
 * Kalın, italik, üç başlık düzeyi, madde/numaralı liste, alıntı, onay kutusu.
 * Kümede olmayan her şey (bağlantı, tablo, kod bloğu, HTML) METİN kalır —
 * sessizce yutulmaz, çünkü terapistin yazdığı her karakter görünmelidir.
 *
 * # Saklama biçimi değişmez
 *
 * Not düz metin olarak saklanır; bu fonksiyon yalnızca görüntülemedir. Eski
 * (`Veri:` başlıklı) notlar paragraf olarak okunur.
 *
 * # Bitişik/iç içe `**`/`*` kuralı (tasarım notu)
 *
 * CommonMark'ın tam öncelik kurallarını uygulamıyoruz (kapalı küme, ayrıştırıcı
 * elle yazılı). Belirsizliği önlemek için sabit bir sıralama seçildi:
 *
 * 1. Önce KALIN (`**...**`) satırın TAMAMI üzerinde soldan sağa, en KISA
 *    kapanışla eşleştirilir (lazy regex). Eşleşen içerik satır içi olarak
 *    TEKRAR ayrıştırılmaz (iç içe kalın/italik desteklenmez) — bu, "kalının
 *    içinde italik de var mı" sorusunu tamamen ortadan kaldırır.
 * 2. Kalın geçişinden ARTA KALAN düz metin parçaları üzerinde İTALİK
 *    (`*...*`) aynı şekilde soldan sağa, en kısa kapanışla aranır.
 * 3. Kapanışı bulunamayan bir işaret (`**` ya da `*`) METİN olarak kalır.
 *
 * Sonuç olarak `**a** *b*` iki ayrı eleman üretir (`<strong>a</strong>` ve
 * `<em>b</em>`) çünkü kalın geçişi kendi çiftini bulup tüketir, italik geçişi
 * yalnızca kalanı görür. `***metin***` ise KALIN önce eşleştiği için (soldaki
 * ikinci `*`'tan başlayıp sağdaki ikinci `*`'ta kapanan en kısa çift)
 * `<strong>*metin</strong>*` üretir: baştaki tek yıldız kalın içeriğin bir
 * parçası olarak düz metin kalır, sondaki tek yıldız kalın geçişi dışında
 * kalıp eşleşmediği için düz metin olarak görünür. Tuhaf görünse de
 * DETERMİNİSTİKTİR ve `markdown.test.tsx` bu tam çıktıyı sabitler — üç
 * yıldızı desteklemek iç içe biçim ayrıştırması gerektirir ve kapalı küme
 * bunu içermiyor.
 *
 * # Satır sonu normalleştirmesi (yalnızca GÖRÜNTÜLEME)
 *
 * Proje Windows'ta geliştirilip macOS'ta kullanılıyor; CRLF (`\r\n`) ya da
 * tek başına `\r` (eski Mac) içeren bir not gerçekçi bir girdi. JavaScript'te
 * `.` `\r`'yi eşlemiyor ve `$` çoklu-satır kipinde olmadığı sürece satır
 * sonunu değil dizginin sonunu bekliyor — bu yüzden `(.*)$` gibi bloğu
 * sınıflandıran regex'ler bir satır `\r` ile bittiğinde İÇERİĞE `\r`'yi dahil
 * edip başlık/madde/alıntı desenini KAÇIRIR, satır sessizce paragrafa düşer.
 * Regex'leri tek tek yamamak yerine GİRİŞTE normalleştiriyoruz (`\r\n` ve
 * yalnız `\r` → `\n`): yeni bir blok türü eklendiğinde de bu koruma otomatik
 * geçerli kalır. Bu fonksiyon SAF kalır — normalleştirme yalnızca yerel bir
 * değişkende olur, saklanan not (`progress_notes.icerik`) DEĞİŞMEZ, bu
 * yalnızca görüntüleme anında uygulanan bir dönüşümdür.
 */
export function markdownOgeleri(kaynak: string): ReactNode {
  const satirlar = kaynak
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(siniflandirSatir)
  const bloklar: ReactNode[] = []
  let i = 0
  let blokSayaci = 0

  while (i < satirlar.length) {
    const satir = satirlar[i]

    if (satir.tur === 'bos') {
      i += 1
      continue
    }

    const anahtar = `b${blokSayaci++}`

    if (satir.tur === 'baslik') {
      const Etiket = BASLIK_ETIKETLERI[satir.seviye]
      bloklar.push(<Etiket key={anahtar}>{satirIci(satir.icerik, anahtar)}</Etiket>)
      i += 1
      continue
    }

    if (satir.tur === 'madde') {
      const ogeler: ReactNode[] = []
      let j = i
      let ogeSayaci = 0
      while (j < satirlar.length) {
        const oge = satirlar[j]
        if (oge.tur !== 'madde') break
        const liAnahtar = `${anahtar}-${ogeSayaci++}`
        ogeler.push(
          <li key={liAnahtar}>
            {oge.kutu !== null ? (
              <>
                <input type="checkbox" checked={oge.kutu} disabled readOnly /> {satirIci(oge.icerik, liAnahtar)}
              </>
            ) : (
              satirIci(oge.icerik, liAnahtar)
            )}
          </li>,
        )
        j += 1
      }
      bloklar.push(<ul key={anahtar}>{ogeler}</ul>)
      i = j
      continue
    }

    if (satir.tur === 'numarali') {
      const ogeler: ReactNode[] = []
      let j = i
      let ogeSayaci = 0
      while (j < satirlar.length) {
        const oge = satirlar[j]
        if (oge.tur !== 'numarali') break
        const liAnahtar = `${anahtar}-${ogeSayaci++}`
        ogeler.push(<li key={liAnahtar}>{satirIci(oge.icerik, liAnahtar)}</li>)
        j += 1
      }
      bloklar.push(<ol key={anahtar}>{ogeler}</ol>)
      i = j
      continue
    }

    if (satir.tur === 'alinti') {
      const satirIcerikleri: string[] = []
      let j = i
      while (j < satirlar.length) {
        const oge = satirlar[j]
        if (oge.tur !== 'alinti') break
        satirIcerikleri.push(oge.icerik)
        j += 1
      }
      bloklar.push(<blockquote key={anahtar}>{satirIci(satirIcerikleri.join('\n'), anahtar)}</blockquote>)
      i = j
      continue
    }

    // Paragraf: boş satıra ya da başka bir blok türüne kadar birlikte tutulur.
    const satirIcerikleri: string[] = []
    let j = i
    while (j < satirlar.length) {
      const oge = satirlar[j]
      if (oge.tur !== 'paragraf') break
      satirIcerikleri.push(oge.icerik)
      j += 1
    }
    bloklar.push(<p key={anahtar}>{satirIci(satirIcerikleri.join('\n'), anahtar)}</p>)
    i = j
  }

  return bloklar
}

const BASLIK_ETIKETLERI = {
  1: 'h3',
  2: 'h4',
  3: 'h5',
} as const

type SatirTuru =
  | { tur: 'bos' }
  | { tur: 'baslik'; seviye: 1 | 2 | 3; icerik: string }
  | { tur: 'madde'; kutu: boolean | null; icerik: string }
  | { tur: 'numarali'; icerik: string }
  | { tur: 'alinti'; icerik: string }
  | { tur: 'paragraf'; icerik: string }

const BASLIK_DUZENLI = /^(#{1,3}) (.*)$/
const ONAY_KUTUSU_DUZENLI = /^- \[([ xX])\] ?(.*)$/
const MADDE_DUZENLI = /^- (.*)$/
const NUMARALI_DUZENLI = /^\d+\. (.*)$/
const ALINTI_DUZENLI = /^> ?(.*)$/

function siniflandirSatir(satir: string): SatirTuru {
  const baslikEslesme = BASLIK_DUZENLI.exec(satir)
  if (baslikEslesme) {
    return { tur: 'baslik', seviye: baslikEslesme[1].length as 1 | 2 | 3, icerik: baslikEslesme[2] }
  }

  const onayEslesme = ONAY_KUTUSU_DUZENLI.exec(satir)
  if (onayEslesme) {
    return { tur: 'madde', kutu: onayEslesme[1].toLowerCase() === 'x', icerik: onayEslesme[2] }
  }

  const maddeEslesme = MADDE_DUZENLI.exec(satir)
  if (maddeEslesme) {
    return { tur: 'madde', kutu: null, icerik: maddeEslesme[1] }
  }

  const numaraliEslesme = NUMARALI_DUZENLI.exec(satir)
  if (numaraliEslesme) {
    return { tur: 'numarali', icerik: numaraliEslesme[1] }
  }

  const alintiEslesme = ALINTI_DUZENLI.exec(satir)
  if (alintiEslesme) {
    return { tur: 'alinti', icerik: alintiEslesme[1] }
  }

  if (satir.trim() === '') {
    return { tur: 'bos' }
  }

  return { tur: 'paragraf', icerik: satir }
}

const KALIN_DUZENLI = /\*\*(.+?)\*\*/g
const ITALIK_DUZENLI = /\*(.+?)\*/g

/**
 * Bir bloğun içeriğini kalın/italik React elemanlarına çevirir. Kural için
 * modül başlığındaki "Bitişik/iç içe `**`/`*` kuralı" bölümüne bakın: kalın
 * ÖNCE ve kendi çiftini TÜKETEREK eşleşir, italik yalnızca kalandan arananır,
 * kapanışsız işaret metin kalır.
 */
function satirIci(metin: string, anahtarOnEki: string): ReactNode[] {
  const parcalar: ReactNode[] = []
  let sayac = 0
  let sonIndeks = 0
  let eslesme: RegExpExecArray | null

  KALIN_DUZENLI.lastIndex = 0
  while ((eslesme = KALIN_DUZENLI.exec(metin)) !== null) {
    if (eslesme.index > sonIndeks) {
      italikAyristirVeEkle(metin.slice(sonIndeks, eslesme.index), anahtarOnEki, parcalar, () => sayac++)
    }
    parcalar.push(<strong key={`${anahtarOnEki}-k${sayac++}`}>{eslesme[1]}</strong>)
    sonIndeks = eslesme.index + eslesme[0].length
  }
  if (sonIndeks < metin.length) {
    italikAyristirVeEkle(metin.slice(sonIndeks), anahtarOnEki, parcalar, () => sayac++)
  }

  return parcalar
}

function italikAyristirVeEkle(
  metin: string,
  anahtarOnEki: string,
  hedef: ReactNode[],
  sonrakiSayac: () => number,
): void {
  let sonIndeks = 0
  let eslesme: RegExpExecArray | null

  ITALIK_DUZENLI.lastIndex = 0
  while ((eslesme = ITALIK_DUZENLI.exec(metin)) !== null) {
    if (eslesme.index > sonIndeks) {
      hedef.push(metin.slice(sonIndeks, eslesme.index))
    }
    hedef.push(<em key={`${anahtarOnEki}-i${sonrakiSayac()}`}>{eslesme[1]}</em>)
    sonIndeks = eslesme.index + eslesme[0].length
  }
  if (sonIndeks < metin.length) {
    hedef.push(metin.slice(sonIndeks))
  }
}
