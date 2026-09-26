import { TurkishLira, UserX } from 'lucide-react'
import { borcaGirerMi } from '../borc'
import { gelmediMi, type DurumAlanlari } from './durumSimgesi'

/**
 * En fazla iki küçük simge (tasarım T1). `shrink-0`: dar (yarım genişlik)
 * blokta ad kırpılır, simge kırpılmaz (T4). `title` fareyle üstüne gelince
 * Türkçe açıklamayı gösterir; ekran okuyucu anlamı çağıranın erişilebilir
 * adından alır (`durumSimgeMetni`), bu yüzden kutu `aria-hidden`.
 */
export function DurumSimgeleri({ randevu }: { randevu: DurumAlanlari }) {
  const gelmedi = gelmediMi(randevu)
  const borc = borcaGirerMi(randevu)
  if (!gelmedi && !borc) return null
  return (
    <span data-testid="durum-simgeleri" aria-hidden="true" className="flex shrink-0 items-center gap-0.5 pt-px">
      {gelmedi && (
        <span data-simge="gelmedi" title="Gelmedi">
          <UserX size={12} strokeWidth={2.5} />
        </span>
      )}
      {borc && (
        <span data-simge="odeme" title="Ödeme alınmadı">
          <TurkishLira size={12} strokeWidth={2.5} />
        </span>
      )}
    </span>
  )
}
