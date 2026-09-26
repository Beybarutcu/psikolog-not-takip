import type { DanisanSeansi } from '../api'
import { ayYil, kronolojik } from './dosyaOzeti'

/**
 * Danışan dosyasındaki seans listesinin düzeni (tasarım B3) — saf işlev.
 *
 * - `yaklasan`: `baslangic > simdi` olan satırlar (durumdan bağımsız), EN
 *   YAKIN üstte (`baslangic ASC, appointment_id ASC`): grup "sırada ne var"
 *   diye açılır. "Geçmiş" her yerde aynı tanımdır: `baslangic <= simdi`
 *   (A2), yani tam şimdi başlayan seans geçmiştedir.
 * - `aylar`: geçmiş seanslar takvim ayına göre. En yeni ay ve ay içinde en
 *   yeni seans üstte (`baslangic DESC, appointment_id DESC`, sunucunun
 *   sırası; yine de burada AÇIKÇA sıralanır, girdi sırasına güvenilmez).
 *   Başlık "Eylül 2026 · 4 seans": sayı o gruptaki `geldi` satırları (§5.1),
 *   `geldi` yoksa yalnızca ay adı.
 *
 * Sıra `dosyaOzeti.ts::kronolojik`'tir (ilk/son seansın ve numaranın da
 * TEK sırası); burada ayrı bir karşılaştırıcı yazılmaz.
 *
 * Girdi ÇAĞIRANIN süzdüğü listedir ("Gruplama var olan süzgeçlerden sonra
 * yapılır"): sayı GÖRÜNEN satırları sayar. Karşılaştırmalar 16 karakterlik
 * duvar saati dizgileriyle yapılır.
 */
export type AyGrubu = { anahtar: string; baslik: string; seanslar: DanisanSeansi[] }
export type SeansGruplari = { yaklasan: DanisanSeansi[]; aylar: AyGrubu[] }

function artan(a: DanisanSeansi, b: DanisanSeansi): number {
  return kronolojik({ baslangic: a.baslangic, id: a.appointment_id }, { baslangic: b.baslangic, id: b.appointment_id })
}

export function seansGruplari(seanslar: readonly DanisanSeansi[], simdi: string): SeansGruplari {
  const yaklasan = seanslar.filter((s) => s.baslangic > simdi).sort(artan)
  const gecmis = seanslar.filter((s) => s.baslangic <= simdi).sort((a, b) => artan(b, a))
  const aylar: AyGrubu[] = []
  for (const s of gecmis) {
    const anahtar = s.baslangic.slice(0, 7)
    const son = aylar[aylar.length - 1]
    if (son !== undefined && son.anahtar === anahtar) son.seanslar.push(s)
    else aylar.push({ anahtar, baslik: '', seanslar: [s] })
  }
  for (const g of aylar) {
    const geldi = g.seanslar.filter((s) => s.durum === 'geldi').length
    g.baslik = geldi > 0 ? `${ayYil(g.anahtar)} · ${geldi} seans` : ayYil(g.anahtar)
  }
  return { yaklasan, aylar }
}
