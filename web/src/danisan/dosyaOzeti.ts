import { borcToplami } from '../borc'
import { AYLAR, GUN_TAM_ADLARI, haftaIndeksi, zamandanDate } from '../takvim/hafta'
import type { Randevu } from '../takvim/HaftalikTakvim'

/**
 * Danışan dosyası başlığının özeti (tasarım B2) — saf işlevler.
 *
 * TEK kaynak `kart.randevular`: `useDanisanDosyasi`'nin 2000–2100
 * penceresi, takvimdeki her yazmadan sonra `randevularTazele`/yamayla
 * tazelenir. "Şimdi" uygulamanın tek kaynağıdır (`yerelGun.ts`,
 * `useDakikalikSimdi`). Karşılaştırmalar 16 karakterlik duvar saati
 * dizgileriyle yapılır; "geçmiş" = `baslangic <= simdi` (A2). `Date`'e
 * yalnızca gün ADI için `zamandanDate` ile çevrilir.
 *
 * | Parça | Tanım |
 * |---|---|
 * | "N. seans" | `geldi` sayısı (§5.1) |
 * | "…'dan beri" | ilk `geldi`'nin ayı (`baslangic ASC, id ASC`) |
 * | "Son" | `baslangic <= simdi` olan en son `geldi` |
 * | "Sıradaki" | `planlandi` ∧ `baslangic > simdi`, en erken (eşitlikte küçük `id`) |
 * | "işaretlenmemiş" | `planlandi` ∧ `bitis <= simdi` (süren seans sayılmaz) |
 * | "Ödenmemiş" | `borcToplami` — Bilgiler'deki bakiyeyle AYNI çağrı |
 */
export type OzetRandevusu = Pick<Randevu, 'id' | 'baslangic' | 'bitis' | 'durum' | 'ucret' | 'odendi'>

export type DosyaOzeti = {
  geldiSayisi: number
  ilkGeldi: OzetRandevusu | null
  sonGeldi: OzetRandevusu | null
  siradaki: OzetRandevusu | null
  isaretlenmemis: number
  odenmemisKurus: number
}

/**
 * `baslangic ASC, id ASC` — ilk/son seansın, sıradaki seansın ve seans
 * numarasının TEK sırası. Seans listesi de (`DanisanSeansi`, kimliği
 * `appointment_id`) kendi karşılaştırıcısını yazmaz, bunu çağırır:
 * `kronolojik({ baslangic: a.baslangic, id: a.appointment_id }, …)`.
 */
export function kronolojik(a: { baslangic: string; id: number }, b: { baslangic: string; id: number }): number {
  if (a.baslangic !== b.baslangic) return a.baslangic < b.baslangic ? -1 : 1
  return a.id - b.id
}

export function dosyaOzeti(randevular: readonly OzetRandevusu[], simdi: string): DosyaOzeti {
  const geldiler = randevular.filter((r) => r.durum === 'geldi').sort(kronolojik)
  const gecmisGeldiler = geldiler.filter((r) => r.baslangic <= simdi)
  const siradakiler = randevular
    .filter((r) => r.durum === 'planlandi' && r.baslangic > simdi)
    .sort(kronolojik)
  return {
    geldiSayisi: geldiler.length,
    ilkGeldi: geldiler[0] ?? null,
    sonGeldi: gecmisGeldiler[gecmisGeldiler.length - 1] ?? null,
    siradaki: siradakiler[0] ?? null,
    isaretlenmemis: randevular.filter((r) => r.durum === 'planlandi' && r.bitis <= simdi).length,
    odenmemisKurus: borcToplami(randevular),
  }
}

/** `"2026-03-03T10:00"` ya da `"2026-03"` → `"Mart 2026"`. */
export function ayYil(zaman: string): string {
  return `${AYLAR[Number(zaman.slice(5, 7)) - 1]} ${zaman.slice(0, 4)}`
}

// Birler basamağının okunuşu: bir(den) iki(den) üç(ten) dört(ten) beş(ten)
// altı(dan) yedi(den) sekiz(den) dokuz(dan).
const BIRLER_EKI = ['', "'den", "'den", "'ten", "'ten", "'ten", "'dan", "'den", "'den", "'dan"]
// Onlar: on(dan) yirmi(den) otuz(dan) kırk(tan) elli(den) altmış(tan)
// yetmiş(ten) seksen(den) doksan(dan).
const ONLAR_EKI = ['', "'dan", "'den", "'dan", "'tan", "'den", "'tan", "'ten", "'den", "'dan"]

/**
 * Sayıya gelen ayrılma eki (`'dan/'den/'tan/'ten`). Ek sayının OKUNUŞUNUN
 * son sözcüğüne uyar: "2026'dan" (altı), "2025'ten" (beş), "2040'tan"
 * (kırk), "2000'den" (bin), "2100'den" (yüz). Tasarımın örneği ("Mart
 * 2026'dan beri") her yıl için 'dan yazmak değildir.
 */
export function ayrilmaEki(sayi: number): string {
  const birler = sayi % 10
  if (birler !== 0) return BIRLER_EKI[birler]
  const onlar = Math.floor(sayi / 10) % 10
  if (onlar !== 0) return ONLAR_EKI[onlar]
  return "'den"
}

/** `"2026-03-03T10:00"` → `"Mart 2026'dan beri"`. */
export function baslangicAyi(zaman: string): string {
  return `${ayYil(zaman)}${ayrilmaEki(Number(zaman.slice(0, 4)))} beri`
}

/** `"17 Eylül"`; `simdi`'nin yılından farklıysa `"30 Aralık 2025"`. */
export function kisaTarih(zaman: string, simdi: string): string {
  const gunAy = `${Number(zaman.slice(8, 10))} ${AYLAR[Number(zaman.slice(5, 7)) - 1]}`
  return zaman.slice(0, 4) === simdi.slice(0, 4) ? gunAy : `${gunAy} ${zaman.slice(0, 4)}`
}

/** `"Perşembe 24 Eylül 14:00"` (başka yılsa yıl da). */
export function gunluTarihSaat(zaman: string, simdi: string): string {
  const gunAdi = GUN_TAM_ADLARI[haftaIndeksi(zamandanDate(zaman))]
  return `${gunAdi} ${kisaTarih(zaman, simdi)} ${zaman.slice(11, 16)}`
}

/**
 * Seans numarası haritası (tasarım B3, §5.1): `geldi` seanslar
 * `baslangic ASC, id ASC` sırasıyla 1..N (`appointment_id → n`). TEK kaynak
 * `kart.randevular`, süzgeçten ÖNCE: etiket süzgeci numarayı değiştirmez.
 * Haritada olmayan satırda numara gösterilmez.
 */
export function seansNumaralari(
  randevular: readonly Pick<Randevu, 'id' | 'baslangic' | 'durum'>[],
): ReadonlyMap<number, number> {
  const harita = new Map<number, number>()
  randevular
    .filter((r) => r.durum === 'geldi')
    .sort(kronolojik)
    .forEach((r, i) => harita.set(r.id, i + 1))
  return harita
}
