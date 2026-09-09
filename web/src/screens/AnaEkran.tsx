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
  const [danisanFormAcik, setDanisanFormAcik] = useState(false)
  const [yeniAdSoyad, setYeniAdSoyad] = useState('')
  const [yeniTelefon, setYeniTelefon] = useState('')
  const [danisanHata, setDanisanHata] = useState<string | null>(null)

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

  async function danisanEkle() {
    if (yeniAdSoyad.trim() === '') {
      setDanisanHata('Lütfen ad soyad girin.')
      return
    }
    try {
      await takvimApi.danisanEkle(yeniAdSoyad.trim(), yeniTelefon.trim() || undefined)
      setYeniAdSoyad('')
      setYeniTelefon('')
      setDanisanFormAcik(false)
      setDanisanHata(null)
      // Burada yeniden yükleme KORUNUYOR: liste sunucuda `ad_soyad COLLATE
      // NOCASE` ile sıralanıyor ve yeni kaydı istemcide doğru yere sokmak
      // Türkçe harf sıralamasını burada ikinci kez (farklı) uygulamak
      // demekti. Danışan ekleme seyrek bir işlem; hacim tarafını sunucudaki
      // birleştirme (`clients::listele`) zaten kapatıyor.
      setDanisanlar(await takvimApi.danisanlariGetir())
    } catch (e) {
      setDanisanHata(e instanceof Error ? e.message : 'Danışan eklenemedi.')
    }
  }

  async function kaydet(kayit: {
    client_id: number
    baslangic: string
    bitis: string
    ucret: number | null
    tekrar_sayisi?: number
  }) {
    try {
      // İki kip: panel mevcut bir randevuyla açıldıysa DÜZENLEME (PUT),
      // yalnızca boş bir saatle açıldıysa YENİ KAYIT (POST). Bu ayrım
      // yokken düzenleme kipinde de POST atılıyordu ve sunucu randevunun
      // KOPYASINI yaratıyordu — orijinal kayıt değişmemiş hâlde kalıyor,
      // aynı saatte ikinci bir blok beliriyordu (bkz. dal incelemesi C1).
      if (seciliRandevu) {
        // `tekrar_sayisi` bilerek geçirilmiyor: düzenleme kipinde panel o
        // alanı zaten göstermiyor ve mevcut bir randevuyu "8 hafta
        // tekrarla" ile kaydetmek anlamsız olurdu.
        await takvimApi.randevuGuncelle(seciliRandevu.id, {
          client_id: kayit.client_id,
          baslangic: kayit.baslangic,
          bitis: kayit.bitis,
          ucret: kayit.ucret,
        })
      } else {
        await takvimApi.randevuOlustur(kayit)
      }
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

  // Durum değişikliği ve silme, sunucudan YENİDEN YÜKLEMEDEN yerel listeye
  // uygulanır. Gerekçe hız değil, denetim kaydı hacmi (bkz. Plan 3 Görev 2
  // ve `store::audit` modül başlığı): `yukle()` her çağrıldığında sunucuda
  // bir `goruntuleme` satırı üretiyordu ve `audit_log` satırları SİLİNEMEZ.
  // "Geldi" işaretlemek tek bir kullanıcı eylemi olduğu hâlde iki satır
  // bırakıyordu. Sunucu tarafında da birleştirme var (aynı görev) — bu iki
  // önlem birbirinin yedeği: burada gereksiz isteği hiç atmıyoruz, orada
  // atılırsa bile satır birikmiyor.
  //
  // Bu iki işlemin sonucu yerel olarak KESİN BİÇİMDE bilinebilir: durum
  // sunucuda doğrulanmış sabit bir değer, silinen kayıt da tek bir id.
  // `kaydet` ve `seriSil` için AYNI ŞEY YAPILMADI — orada sonuç birden çok
  // satırı (ve görünen haftanın dışını) etkileyebilir, dolayısıyla yeniden
  // yükleme doğru olanı.
  async function durumDegis(id: number, durum: string) {
    try {
      await takvimApi.randevuDurumu(id, durum)
      setHata(null)
      setRandevular((onceki) => onceki.map((r) => (r.id === id ? { ...r, durum } : r)))
      // Panel açık kalır; içindeki kopya da güncellenmezse kullanıcı
      // işaretlediği durumu panelde göremez.
      setSeciliRandevu((secili) => (secili && secili.id === id ? { ...secili, durum } : secili))
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
      setRandevular((onceki) => onceki.filter((r) => r.id !== id))
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Randevu silinemedi.')
      throw e
    }
  }

  // Seriyi bu randevudan İTİBAREN iptal eder; geçmiş randevular sunucuda
  // korunuyor (bkz. `seriyi_sil`). `seriyi_sil` Görev 6'da yazılmış ve test
  // edilmişti ama hiçbir çağrı yeri yoktu — 52 haftalık bir seri iki tıkla
  // kuruluyor, iptal edilemiyordu (bkz. dal incelemesi I4a).
  async function seriSil(seriId: string, buTarihtenItibaren: string) {
    try {
      await takvimApi.seriSil(seriId, buTarihtenItibaren)
      setHata(null)
      panelKapat()
      await yukle()
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Seri silinemedi.')
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

      <div className="mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-600">Danışanlar</span>
          <button
            className="rounded border px-3 py-1 text-sm"
            onClick={() => setDanisanFormAcik((acik) => !acik)}
          >
            Danışan ekle
          </button>
        </div>

        {danisanFormAcik && (
          <div className="mt-2 flex items-end gap-2">
            <div>
              <label className="block text-sm" htmlFor="yeni-danisan-ad-soyad">
                Ad soyad
              </label>
              <input
                id="yeni-danisan-ad-soyad"
                className="mt-1 rounded border p-2"
                value={yeniAdSoyad}
                onChange={(e) => setYeniAdSoyad(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm" htmlFor="yeni-danisan-telefon">
                Telefon
              </label>
              <input
                id="yeni-danisan-telefon"
                className="mt-1 rounded border p-2"
                value={yeniTelefon}
                onChange={(e) => setYeniTelefon(e.target.value)}
              />
            </div>
            <button
              className="rounded bg-slate-900 px-3 py-2 text-sm text-white"
              onClick={() => void danisanEkle()}
            >
              Ekle
            </button>
          </div>
        )}

        {danisanHata && <p className="mt-1 text-sm text-red-600">{danisanHata}</p>}

        {danisanlar.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2 text-sm text-slate-700">
            {danisanlar.map((d) => (
              <li key={d.id} className="rounded-full bg-slate-100 px-3 py-1">
                {d.ad_soyad}
              </li>
            ))}
          </ul>
        )}
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
            onSeriSil={seriSil}
            seriSayisiAl={takvimApi.seriSayisi}
            onKapat={panelKapat}
            cakismaKontrol={takvimApi.cakismaKontrol}
          />
        )}
      </div>
    </div>
  )
}
