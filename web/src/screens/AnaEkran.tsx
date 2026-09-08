import { useCallback, useEffect, useState } from 'react'
import { takvimApi, YetkisizHata } from '../api'
import { HaftalikTakvim, type Randevu } from '../takvim/HaftalikTakvim'
import { haftaGunleri, haftaninBasi, yerelZaman } from '../takvim/hafta'

export function AnaEkran({ kilitle }: { kilitle: () => void }) {
  const [haftaBasi, setHaftaBasi] = useState(() => haftaninBasi(new Date()))
  const [randevular, setRandevular] = useState<Randevu[]>([])
  const [hata, setHata] = useState<string | null>(null)
  // Panel Görev 10'da bağlanacak; şimdilik seçim yalnızca duruma yazılır.
  const [, setSeciliRandevu] = useState<Randevu | null>(null)
  const [, setSeciliBosSaat] = useState<string | null>(null)

  const yukle = useCallback(async () => {
    const gunler = haftaGunleri(haftaBasi)
    const baslangic = yerelZaman(gunler[0])
    const sonGun = gunler[6]
    const bitis = yerelZaman(new Date(
      sonGun.getFullYear(), sonGun.getMonth(), sonGun.getDate(), 23, 59,
    ))
    try {
      setRandevular(await takvimApi.randevulariGetir(baslangic, bitis))
      setHata(null)
    } catch (e) {
      if (e instanceof YetkisizHata) {
        // Oturum kilitlendi. Kilit ekranına geçiş App.tsx'teki merkezi 401
        // dinleyicisi tarafından (durum yeniden çekilerek) tetiklenecek —
        // ama bu, sunucuya bir gidiş-dönüş sürer. O kısa süre boyunca bile
        // ekranda danışan adları kalmasın diye randevu listesi burada
        // hemen temizleniyor.
        setRandevular([])
      }
      setHata(e instanceof Error ? e.message : 'Randevular yüklenemedi.')
    }
  }, [haftaBasi])

  useEffect(() => { void yukle() }, [yukle])

  function haftaDegis(yon: number) {
    setHaftaBasi((onceki) => {
      const yeni = new Date(onceki)
      yeni.setDate(yeni.getDate() + yon * 7)
      return yeni
    })
  }

  function randevuSec(randevu: Randevu) {
    setSeciliBosSaat(null)
    setSeciliRandevu(randevu)
  }

  function bosSaatSec(zaman: string) {
    setSeciliRandevu(null)
    setSeciliBosSaat(zaman)
  }

  return (
    <div className="p-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Terapi Notları</h1>
        <button className="rounded-lg border px-4 py-2" onClick={kilitle}>
          Kilitle
        </button>
      </div>

      {hata && <p className="mb-4 text-sm text-red-600">{hata}</p>}

      <HaftalikTakvim
        randevular={randevular}
        haftaBasi={haftaBasi}
        onHaftaDegis={haftaDegis}
        onRandevuSec={randevuSec}
        onBosSaatSec={bosSaatSec}
      />
    </div>
  )
}
