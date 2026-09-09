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
  // Arşivleme geri alınamaz SANILAN bir işlemdir (aslında değil — kayıtlar
  // duruyor), bu yüzden randevu silmedeki iki adımlı onay deseni burada da
  // uygulanıyor. Onay state'i ONAYLANAN DANIŞANIN KENDİSİDİR: Görev 10
  // inceleme Bulgu 1'de panelin iç state'i bir seçimden diğerine sızıyordu ve
  // çözüm state'i seçime bağlamaktı (`key` prop'u). Burada aynı ilke, bu kez
  // state'in kendisi seçimi taşıyacak biçimde: başka bir danışanın
  // "Arşivle"sine basmak onayı devretmez, tümüyle değiştirir; onay metni de
  // her zaman state'teki danışanın adını gösterir.
  const [arsivOnayi, setArsivOnayi] = useState<Danisan | null>(null)
  const [arsivBilgisi, setArsivBilgisi] = useState<string | null>(null)
  const [arsivSuruyor, setArsivSuruyor] = useState(false)

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
      // Sunucudan gelen mesaj OLDUĞU GİBİ gösteriliyor: doğrulama hataları
      // hangi alanın (ad mı, telefon mu) neden reddedildiğini söylüyor
      // (bkz. `store::clients` doğrulayıcıları). Burada onu genel bir
      // "Danışan eklenemedi." ile değiştirmek, kullanıcıya neyi
      // düzelteceğini söylememek olurdu — bu kod tabanında tekrar eden
      // "her hata parola hatasıdır" sınıfının ta kendisi.
      setDanisanHata(e instanceof Error ? e.message : 'Danışan eklenemedi.')
    }
  }

  // Arşivleme SİLME DEĞİLDİR. `clients::arsivle` Plan 2 Görev 3'te yazılmış
  // ama hiçbir yerden çağrılmıyordu: danışan eklenebiliyor, arşivlenemiyordu
  // ve hem bu liste hem de randevu panelindeki açılır menü sınırsız
  // büyüyordu (`seriyi_sil` ile aynı bulgu sınıfı, bkz. dal incelemesi I4a).
  async function danisanArsivle(danisan: Danisan) {
    setArsivSuruyor(true)
    try {
      await takvimApi.danisanArsivle(danisan.id)
      setDanisanHata(null)
      setArsivOnayi(null)
      // Sunucudan YENİDEN ÇEKİLMİYOR: sonuç yerel olarak kesin biçimde
      // bilinebilir (tek bir id listeden düşer) ve her `danisanlariGetir`
      // çağrısı sunucuda kalıcı bir `goruntuleme` satırı üretme riski taşır
      // (bkz. Plan 3 Görev 2 ve `durumDegis`/`sil` için aynı gerekçe).
      setDanisanlar((onceki) => onceki.filter((d) => d.id !== danisan.id))
      // Kullanıcı "hiçbir şey olmadı" da sanmamalı: ad listeden düşüyor VE
      // ne olduğu açıkça yazılıyor.
      setArsivBilgisi(
        `${danisan.ad_soyad} arşivlendi. Kayıtları silinmedi; yalnızca listede görünmüyor.`,
      )
    } catch (e) {
      setDanisanHata(e instanceof Error ? e.message : 'Danışan arşivlenemedi.')
    } finally {
      setArsivSuruyor(false)
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
        {arsivBilgisi && <p className="mt-1 text-sm text-slate-600">{arsivBilgisi}</p>}

        {danisanlar.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2 text-sm text-slate-700">
            {danisanlar.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1"
              >
                <span>{d.ad_soyad}</span>
                {/* Erişilebilir ad bilerek yalnızca "Arşivle": danışan adını
                    da içerseydi takvimdeki randevu düğmesiyle aynı ada sahip
                    ikinci bir düğme oluşur ve ad ile arama yapan testler
                    (ve ekran okuyucu kullanıcısı) hangisinin randevu,
                    hangisinin arşivleme olduğunu ayırt edemezdi. Hangi
                    danışan olduğu onay metninde açıkça yazıyor. */}
                <button
                  type="button"
                  className="text-slate-500 underline disabled:opacity-50"
                  title="Danışanı arşivle"
                  disabled={arsivSuruyor}
                  onClick={() => {
                    setArsivBilgisi(null)
                    setArsivOnayi(d)
                  }}
                >
                  Arşivle
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* İki adımlı onay. Metin ne olduğunu ve ne OLMADIĞINI birlikte
            söylüyor: kullanıcı ne "sildim, gitti" ne de "hiçbir şey olmadı"
            sanmalı. */}
        {arsivOnayi && (
          <div className="mt-2 rounded bg-amber-50 p-2">
            <p className="text-sm text-amber-900">
              {arsivOnayi.ad_soyad} arşivlensin mi? Danışan listeden ve randevu seçiminden
              kaldırılır. Geçmiş randevuları, notları ve dosyaları silinmez — kayıtlar
              durmaya devam eder, yalnızca listede görünmez.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                className="rounded bg-amber-700 px-3 py-1 text-sm text-white disabled:opacity-50"
                disabled={arsivSuruyor}
                onClick={() => void danisanArsivle(arsivOnayi)}
              >
                Evet, arşivle
              </button>
              <button
                className="rounded border px-3 py-1 text-sm"
                disabled={arsivSuruyor}
                onClick={() => setArsivOnayi(null)}
              >
                Vazgeç
              </button>
            </div>
          </div>
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
