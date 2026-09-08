import type { Randevu } from './HaftalikTakvim'

const DURUM_BICIMI: Record<string, string> = {
  planlandi: 'bg-slate-800 text-white',
  geldi: 'bg-emerald-700 text-white',
  gelmedi: 'bg-amber-600 text-white',
  iptal: 'bg-slate-200 text-slate-500 line-through',
}

export function RandevuBloku({ randevu, onSec }: { randevu: Randevu; onSec: () => void }) {
  return (
    <button
      onClick={onSec}
      className={`w-full truncate rounded px-1 py-0.5 text-left text-xs ${
        DURUM_BICIMI[randevu.durum] ?? DURUM_BICIMI.planlandi
      }`}
    >
      {randevu.danisan_adi}
    </button>
  )
}
