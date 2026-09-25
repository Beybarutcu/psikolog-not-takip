import type { Randevu } from './HaftalikTakvim'

/**
 * Bilgi satırının sayıları (tasarım A2). "Bugün N seans" = bugünün yerel
 * günündeki, iptal OLMAYAN randevular. "Sıradaki" = bugün, `planlandi`,
 * `baslangic > simdi` olan en erken (eşitlikte küçük id); süren seans
 * sıradaki değildir. Dizgiler duvar saati (16 karakter) olduğu için
 * sözlüksel karşılaştırma kronolojiktir.
 */
export type BugunOzeti = { sayi: number; siradaki: Randevu | null }

export function bugunOzeti(randevular: readonly Randevu[], simdi: string): BugunOzeti {
  const gun = simdi.slice(0, 10)
  const bugunku = randevular.filter((x) => x.baslangic.slice(0, 10) === gun && x.durum !== 'iptal')
  const adaylar = bugunku
    .filter((x) => x.durum === 'planlandi' && x.baslangic > simdi)
    .sort((a, b) => (a.baslangic === b.baslangic ? a.id - b.id : a.baslangic < b.baslangic ? -1 : 1))
  return { sayi: bugunku.length, siradaki: adaylar[0] ?? null }
}
