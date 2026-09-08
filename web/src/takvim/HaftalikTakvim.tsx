import { GUN_ADLARI, haftaBasligi, haftaGunleri, yerelZaman, zamandanDate } from './hafta'
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

const CALISMA_BASLANGIC = 8
const CALISMA_BITIS = 21
const AYLAR_UZUN = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

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

  function hucreRandevulari(gun: Date, saat: number): Randevu[] {
    return randevular.filter((r) => {
      const b = zamandanDate(r.baslangic)
      return (
        b.getFullYear() === gun.getFullYear() &&
        b.getMonth() === gun.getMonth() &&
        b.getDate() === gun.getDate() &&
        b.getHours() === saat
      )
    })
  }

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
                          aria-label={`${gun.getDate()} ${AYLAR_UZUN[gun.getMonth()]} ${saat
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
