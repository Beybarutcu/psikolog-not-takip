import { dakikaFarki } from './hafta'

/**
 * Takvim ızgarasındaki randevu bloğunun yerleşimi — **saf fonksiyonlar**.
 *
 * # Blok süresi kadar yer kaplar
 *
 * Eskiden her blok süresinden bağımsız, tek satırlık bir şeritti: 50
 * dakikalık bir seans saatin yarısını bile kaplamıyor, 90 dakikalık bir seans
 * 50 dakikalıktan ayırt edilemiyordu. Artık blok başladığı saatin hücresine
 * mutlak konumla yerleşir; üst kenarı başlangıç dakikası, yüksekliği süresi
 * kadardır ve gerekirse sonraki saatlerin hücrelerine taşar.
 *
 * Değerler PİKSEL cinsinden, çünkü satır yüksekliği pencereden ölçülüyor
 * (`HaftalikTakvim`, tasarım A3) ve blok başka satırlara taştığında yüzde,
 * yalnızca başladığı hücreye göre hesaplanırdı.
 *
 * # Duvar saati
 *
 * Süre `hafta.ts::dakikaFarki` ile, başlangıç dakikası dizginin kendisinden
 * okunur (bkz. duvar saati sözleşmesi, `zamandanDate`).
 */

/** Blok bundan kısa çizilmez: bir satır `text-xs` metin + dolgu okunur kalsın. */
const EN_AZ_YUKSEKLIK = 18

/** Art arda iki seans (10:00–10:50, 11:00) birbirine yapışık görünmesin. */
const ALT_BOSLUK = 2

type Zamanli = { baslangic: string; bitis: string }

export type BlokKonumu = {
  /** Başladığı saat hücresinin üst kenarından uzaklık (px). */
  ust: number
  /** Blok yüksekliği (px). */
  yukseklik: number
}

function dakikaninIcinde(zaman: string): number {
  return Number(zaman.slice(14, 16))
}

function gununDakikasi(zaman: string): number {
  return Number(zaman.slice(11, 13)) * 60 + dakikaninIcinde(zaman)
}

export function blokKonumu(randevu: Zamanli, satirYuksekligi: number, izgaraBitisSaati: number): BlokKonumu {
  const pikselDakika = satirYuksekligi / 60
  const ust = dakikaninIcinde(randevu.baslangic) * pikselDakika

  // Izgaranın dışına taşan kısım çizilmez: 20:30'da başlayan 50 dakikalık bir
  // seans 21:00'de kesilir, tablonun altından sayfaya sarkmaz.
  const izgarayaKalan = izgaraBitisSaati * 60 - gununDakikasi(randevu.baslangic)
  const sure = Math.min(dakikaFarki(randevu.baslangic, randevu.bitis), izgarayaKalan)

  const yukseklik = Math.max(EN_AZ_YUKSEKLIK, sure * pikselDakika - ALT_BOSLUK)
  return { ust, yukseklik }
}

export type Sutun = { sutun: number; sutunSayisi: number }

/**
 * Aynı günde zamanı çakışan randevuları yan yana sütunlara dağıtır.
 *
 * Uygulama çakışmada uyarır ama kayda izin verir (`cakisanlari_bul`), yani
 * aynı saate iki blok gerçekten düşebilir. Süre kadar uzayan bloklar üst üste
 * binseydi alttaki tamamen görünmez olurdu.
 *
 * Birbirine zincirle bağlı çakışanlar bir KÜME oluşturur; kümedeki her blok
 * boş olan ilk sütuna oturur ve kümenin bütün blokları aynı genişliği paylaşır
 * (sütun sayısı = kümedeki en fazla sütun). Biri bittiği dakikada başlayan
 * randevu (10:00–10:50 ve 10:50) çakışma sayılmaz.
 */
export function cakismaSutunlari<T extends Zamanli & { id: number }>(randevular: T[]): Map<number, Sutun> {
  const sonuc = new Map<number, Sutun>()

  const gunlere = new Map<string, T[]>()
  for (const r of randevular) {
    const gun = r.baslangic.slice(0, 10)
    const liste = gunlere.get(gun)
    if (liste) liste.push(r)
    else gunlere.set(gun, [r])
  }

  for (const liste of gunlere.values()) {
    const sirali = liste
      .map((r) => {
        const bas = gununDakikasi(r.baslangic)
        // Bozuk (bitişi başlangıcından önce) bir kayıt en az bir dakika
        // sürüyormuş gibi yerleşir: sütun hesabı onu kaybetmez.
        const bit = bas + Math.max(1, dakikaFarki(r.baslangic, r.bitis))
        return { id: r.id, bas, bit }
      })
      .sort((a, b) => a.bas - b.bas || b.bit - a.bit || a.id - b.id)

    let kume: { id: number; sutun: number }[] = []
    let sutunSonlari: number[] = []
    let kumeSonu = -Infinity

    const kumeyiKapat = () => {
      for (const k of kume) sonuc.set(k.id, { sutun: k.sutun, sutunSayisi: sutunSonlari.length })
      kume = []
      sutunSonlari = []
    }

    for (const r of sirali) {
      if (r.bas >= kumeSonu) kumeyiKapat()
      let sutun = sutunSonlari.findIndex((son) => son <= r.bas)
      if (sutun === -1) {
        sutun = sutunSonlari.length
        sutunSonlari.push(r.bit)
      } else {
        sutunSonlari[sutun] = r.bit
      }
      kume.push({ id: r.id, sutun })
      kumeSonu = Math.max(kumeSonu, r.bit)
    }
    kumeyiKapat()
  }

  return sonuc
}
