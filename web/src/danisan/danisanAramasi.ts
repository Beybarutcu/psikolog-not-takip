import { katla } from '../katla'

/**
 * Danışan listesi araması (tasarım B1, §5.2): ekrandaki AKTİF listeyi
 * süzer. Sunucuya istek YOK, denetim kaydına satır YOK; asgari uzunluk da
 * yok (istek gitmediği için).
 *
 * Eşleşme `katla(ad).includes(katla(sorgu.trim()))`: ⌘K hızlı aramasıyla
 * (sunucu, `search.rs`) AYNI Türkçe katlama. Boş sorgu herkesi verir. Sıra
 * korunur (sunucunun sıralaması; burada ikinci bir Türkçe sıralama yazılmaz).
 */
export function danisanSuz<T extends { ad_soyad: string }>(liste: readonly T[], sorgu: string): T[] {
  const hedef = katla(sorgu.trim())
  if (hedef === '') return [...liste]
  return liste.filter((d) => katla(d.ad_soyad).includes(hedef))
}
