/**
 * Borç kuralı — arayüzdeki TEK kopya (tasarım §5.1).
 *
 * Bir seans borca girer ⇔ `geldi` ya da `gelmedi` ∧ ödenmemiş ∧ ücret > 0.
 * Terapist gelmeyen seansı ücretlendiriyor (kullanıcı kararı 2026-09-25);
 * iptal ve planlı seans borç değildir. Sunucudaki eşi
 * `core/src/store/ozet.rs`; ikisi `core/src/store/borc_ornekleri.json` ile
 * birbirine bağlı. Bakiye (`DosyaBilgileri`) ve dosya başlığı özeti (Plan B)
 * bu dosyadan başka bir kural YAZMAZ.
 */
export type BorcAlanlari = { durum: string; odendi: boolean; ucret: number | null }

export function borcaGirerMi(r: BorcAlanlari): boolean {
  return (r.durum === 'geldi' || r.durum === 'gelmedi') && !r.odendi && (r.ucret ?? 0) > 0
}

export function borcToplami(randevular: readonly BorcAlanlari[]): number {
  return randevular.reduce((t, r) => (borcaGirerMi(r) ? t + (r.ucret ?? 0) : t), 0)
}
