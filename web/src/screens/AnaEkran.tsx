import { useCallback, useEffect, useState } from 'react'
import { takvimApi, YetkisizHata, type Danisan } from '../api'
import { HaftalikTakvim, type Randevu } from '../takvim/HaftalikTakvim'
import { haftaGunleri, haftaninBasi, yerelZaman } from '../takvim/hafta'
import { RandevuPaneli } from '../takvim/RandevuPaneli'

export function AnaEkran({ kilitle }: { kilitle: () => void }) {
  const [haftaBasi, setHaftaBasi] = useState(() => haftaninBasi(new Date()))
  const [randevular, setRandevular] = useState<Randevu[]>([])
  const [danisanlar, setDanisanlar] = useState<Danisan[]>([])
  const [hata, setHata] = useState<string | null>(null)
  const [seciliRandevu, setSeciliRandevu] = useState<Randevu | null>(null)
  const [seciliBosSaat, setSeciliBosSaat] = useState<string | null>(null)

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

  useEffect(() => {
    void takvimApi.danisanlariGetir().then(setDanisanlar).catch(() => {
      // Danışan listesi yüklenemezse panel yine açılabilir; danışan seçme
      // adımı boş listeyle gelir ve kullanıcı "danışan seçin" hatasını
      // görür — sayfanın tamamını kilitlemeye gerek yok.
    })
  }, [])

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

  function panelKapat() {
    setSeciliRandevu(null)
    setSeciliBosSaat(null)
  }

  async function kaydet(kayit: {
    client_id: number
    baslangic: string
    bitis: string
    ucret: number | null
    tekrar_sayisi?: number
  }) {
    try {
      await takvimApi.randevuOlustur(kayit)
      setHata(null)
      panelKapat()
      await yukle()
    } catch (e) {
      // Üstteki bant dar bir sayfada gözden kaçabilir (bkz. Görev 10 inceleme
      // bulgusu) — burada set edilip yeniden fırlatılıyor ki panel de kendi
      // içinde aynı hatayı gösterebilsin (RandevuPaneli'nin onKaydet'i
      // bekleyen islemCalistir'i bu reddi yakalayıp yerel hata state'ine
      // yazıyor). Merkezi 401 dinleyicisi zaten api.ts içindeki `istek`
      // fonksiyonunda, bu reddin fırlatılmasından önce tetiklenmiş oluyor —
      // burada yeniden fırlatmak o mekanizmayı etkilemez.
      setHata(e instanceof Error ? e.message : 'Randevu kaydedilemedi.')
      throw e
    }
  }

  async function durumDegis(id: number, durum: string) {
    try {
      await takvimApi.randevuDurumu(id, durum)
      setHata(null)
      await yukle()
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Randevu güncellenemedi.')
      throw e
    }
  }

  async function sil(id: number) {
    try {
      await takvimApi.randevuSil(id)
      setHata(null)
      panelKapat()
      await yukle()
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Randevu silinemedi.')
      throw e
    }
  }

  const panelAcik = seciliRandevu !== null || seciliBosSaat !== null

  return (
    <div className="p-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Terapi Notları</h1>
        <button className="rounded-lg border px-4 py-2" onClick={kilitle}>
          Kilitle
        </button>
      </div>

      {hata && <p className="mb-4 text-sm text-red-600">{hata}</p>}

      <div className="flex items-start gap-4">
        <div className="flex-1">
          <HaftalikTakvim
            randevular={randevular}
            haftaBasi={haftaBasi}
            onHaftaDegis={haftaDegis}
            onRandevuSec={randevuSec}
            onBosSaatSec={bosSaatSec}
          />
        </div>

        {panelAcik && (
          <RandevuPaneli
            // Seçim değişince (başka bir randevu ya da boş saat) bileşen
            // yeniden mount edilmeli — aksi hâlde panelin iç state'i (silme
            // onayı, doldurulmuş form alanları) önceki seçimden yeni seçime
            // sızar (bkz. Görev 10 inceleme Bulgu 1). `key` kimliği seçili
            // randevunun ya da seçili boş saatin kimliğine bağlanıyor.
            key={seciliRandevu ? `randevu-${seciliRandevu.id}` : `bos-${seciliBosSaat}`}
            zaman={seciliBosSaat ?? seciliRandevu?.baslangic ?? ''}
            randevu={seciliRandevu}
            danisanlar={danisanlar}
            onKaydet={kaydet}
            onDurumDegis={durumDegis}
            onSil={sil}
            onKapat={panelKapat}
            cakismaKontrol={takvimApi.cakismaKontrol}
          />
        )}
      </div>
    </div>
  )
}
