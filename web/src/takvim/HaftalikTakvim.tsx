import { AYLAR, GUN_ADLARI, haftaBasligi, haftaGunleri, yerelZaman, zamandanDate } from './hafta'
import { RandevuBloku } from './RandevuBloku'

export type Randevu = {
  id: number
  client_id: number
  danisan_adi: string
  baslangic: string
  bitis: string
  durum: string
  ucret: number | null
  odendi: boolean
  seri_id: string | null
}

/**
 * Izgaranın kapsadığı saat aralığı — **bir varsayım**, ölçülmüş bir kural
 * değil (planın "Açık Sorular" bölümü bunu böyle yazıyor).
 *
 * Varsayım olduğu için aralığın DIŞINA düşen randevular gerçekten oluyor:
 * 07:30'a alınmış bir acil görüşme ya da 21:30'a kayan bir seans. Bugüne
 * kadar o randevular sunucudan **çekiliyor ama hiç render edilmiyordu** ve
 * ekranda hiçbir iz bırakmıyorlardı: takvimde olmayan bir randevu, olmayan
 * bir randevudur. Aşağıdaki `gizliRandevular` bölümü bunu kapatıyor.
 */
const CALISMA_BASLANGIC = 8
const CALISMA_BITIS = 21

/** `2026-09-07T14:00` -> `07.09 14:00`. Parçalar olduğu gibi doğru;
 * `Date`'e çevrilmiyor (bkz. `hafta.ts::zamandanDate` ve duvar saati
 * sözleşmesi). */
function kisaZaman(zaman: string): string {
  const [tarih, saat] = zaman.split('T')
  const [, ay, gun] = (tarih ?? '').split('-')
  if (!ay || !gun) return zaman
  return saat ? `${gun}.${ay} ${saat.slice(0, 5)}` : `${gun}.${ay}`
}

/** Izgara hücresinin kimliği: yıl-ay-gün-saat. */
function hucreAnahtari(tarih: Date): string {
  return [
    tarih.getFullYear(),
    tarih.getMonth(),
    tarih.getDate(),
    tarih.getHours(),
  ].join('-')
}

type Props = {
  randevular: Randevu[]
  haftaBasi: Date
  onHaftaDegis: (yon: number) => void
  onRandevuSec: (randevu: Randevu) => void
  onBosSaatSec: (zaman: string) => void
}

export function HaftalikTakvim({
  randevular, haftaBasi, onHaftaDegis, onRandevuSec, onBosSaatSec,
}: Props) {
  const gunler = haftaGunleri(haftaBasi)
  const saatler = Array.from(
    { length: CALISMA_BITIS - CALISMA_BASLANGIC },
    (_, i) => CALISMA_BASLANGIC + i,
  )

  // Randevular ÖNCE hücre kimliğine göre gruplanıyor, sonra ızgara o
  // gruplardan doldurulyor. Bu bir hız iyileştirmesi değil, bir DOĞRULUK
  // kararı: "hangi randevular görünüyor" ile "hangi randevular gizli"
  // aynı tek kaynaktan türüyor.
  //
  // Ayrı iki süzgeç yazılsaydı (biri hücre için, biri uyarı için) ikisi
  // sessizce ayrışabilirdi ve uyarıdaki sayı **tahmin** olurdu -- oysa o
  // sayının gerçek olması bu bölümün bütün değeri.
  const hucreler = new Map<string, Randevu[]>()
  for (const r of randevular) {
    const anahtar = hucreAnahtari(zamandanDate(r.baslangic))
    const mevcut = hucreler.get(anahtar)
    if (mevcut) mevcut.push(r)
    else hucreler.set(anahtar, [r])
  }

  const izgaraAnahtarlari = new Set<string>()
  for (const gun of gunler) {
    for (const saat of saatler) {
      izgaraAnahtarlari.add(
        hucreAnahtari(new Date(gun.getFullYear(), gun.getMonth(), gun.getDate(), saat)),
      )
    }
  }

  // Bir randevu, ancak hücre kimliği ızgarada VARSA görünür. Dolayısıyla
  // aşağıdaki liste tam olarak "ekranda olmayanlar"dır -- saat aralığının
  // dışındakiler kadar (ileride mümkün olursa) haftanın dışındakiler de.
  const gizliRandevular = randevular.filter(
    (r) => !izgaraAnahtarlari.has(hucreAnahtari(zamandanDate(r.baslangic))),
  )

  function hucreRandevulari(gun: Date, saat: number): Randevu[] {
    return (
      hucreler.get(
        hucreAnahtari(new Date(gun.getFullYear(), gun.getMonth(), gun.getDate(), saat)),
      ) ?? []
    )
  }

  const bicimliAralik = (saat: number) => `${saat.toString().padStart(2, '0')}:00`

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-3">
        <button
          className="rounded border px-3 py-1"
          onClick={() => onHaftaDegis(-1)}
        >
          Önceki hafta
        </button>
        <h2 className="text-lg font-semibold">{haftaBasligi(haftaBasi)}</h2>
        <button
          className="rounded border px-3 py-1"
          onClick={() => onHaftaDegis(1)}
        >
          Sonraki hafta
        </button>
      </div>

      {/* GÖRÜNEN ARALIK DIŞINDAKİ RANDEVULAR.
          Bu randevular sunucudan çekiliyor ama ızgarada hiçbir hücreye
          düşmüyor; uyarı olmadan "randevu var, ekranda yok" durumu
          oluşuyordu. Sayı TAHMİN DEĞİL: yukarıdaki `gizliRandevular`
          ızgaranın kendi hücre kimliklerinden türüyor.
          Her satır tıklanabilir -- görünür kılmak yetmez, ULAŞILABİLİR de
          olmalı (randevu paneli açılır, düzenlenip ızgaraya taşınabilir). */}
      {gizliRandevular.length > 0 && (
        <section
          aria-label="Görünen aralık dışındaki randevular"
          className="mb-4 rounded border border-amber-400 bg-amber-50 p-3"
        >
          <h3 className="text-sm font-semibold text-amber-900">
            Bu haftanın görünen aralığı ({bicimliAralik(CALISMA_BASLANGIC)}–
            {bicimliAralik(CALISMA_BITIS)}) dışında {gizliRandevular.length} randevu var
          </h3>
          <ul className="mt-1 flex flex-wrap gap-2 text-sm">
            {gizliRandevular.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="rounded border border-amber-300 bg-white px-2 py-1 underline"
                  aria-label={`${r.danisan_adi} — ${kisaZaman(r.baslangic)} (aralık dışı) randevusunu aç`}
                  onClick={() => onRandevuSec(r)}
                >
                  {kisaZaman(r.baslangic)} · {r.danisan_adi}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] table-fixed border-collapse">
          <thead>
            <tr>
              <th className="w-14" />
              {gunler.map((g, i) => (
                <th key={i} className="border-b p-1 text-xs font-medium text-slate-600">
                  <div>{GUN_ADLARI[i]}</div>
                  <div className="text-sm text-slate-900">{g.getDate()}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {saatler.map((saat) => (
              <tr key={saat}>
                <td className="border-r p-1 text-right align-top text-xs text-slate-500">
                  {saat.toString().padStart(2, '0')}:00
                </td>
                {gunler.map((gun, i) => {
                  const hucredekiler = hucreRandevulari(gun, saat)
                  const zaman = yerelZaman(
                    new Date(gun.getFullYear(), gun.getMonth(), gun.getDate(), saat, 0),
                  )
                  return (
                    <td key={i} className="h-10 border border-slate-100 p-0.5 align-top">
                      {hucredekiler.length > 0 ? (
                        hucredekiler.map((r) => (
                          <RandevuBloku key={r.id} randevu={r} onSec={() => onRandevuSec(r)} />
                        ))
                      ) : (
                        <button
                          aria-label={`${gun.getDate()} ${AYLAR[gun.getMonth()]} ${saat
                            .toString()
                            .padStart(2, '0')}:00 boş`}
                          className="h-full w-full"
                          onClick={() => onBosSaatSec(zaman)}
                        />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
