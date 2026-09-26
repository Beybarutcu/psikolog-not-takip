import { borcaGirerMi, type BorcAlanlari } from '../borc'

/**
 * Takvim bloğunun (ve önceki notlar satırının) durum simgeleri — tasarım T1-T3.
 *
 * Simgeler yalnızca iki şeyi söyler: danışan gelmedi (`UserX`) ve ücret
 * alınmadı (`TurkishLira`). "Ödeme alınmadı" borç kuralının KENDİSİDİR
 * (`borc.ts::borcaGirerMi`, sunucuyla ortak örnekler): burada ikinci bir
 * kural yazılmaz. Geldi+ödendi, planlandı ve iptal simge taşımaz (T2).
 *
 * Erişilebilir ad simgenin anlamını SONA ekler (T3): "10:00 Ad, gelmedi,
 * ödeme alınmadı". Simgeler `aria-hidden`; anlam yalnızca bu metinle gider.
 */
export type DurumAlanlari = BorcAlanlari

export function gelmediMi(r: DurumAlanlari): boolean {
  return r.durum === 'gelmedi'
}

export function durumSimgeMetni(r: DurumAlanlari): string {
  return (gelmediMi(r) ? ', gelmedi' : '') + (borcaGirerMi(r) ? ', ödeme alınmadı' : '')
}
