import { useCallback, useEffect, useState } from 'react'
import type { YedekListesi, YedekOzeti } from '../api'
import { boyutBicimle } from '../danisan/bicim'

/**
 * Yedekten geri yükleme ekranı.
 *
 * `KeystoreBozukEkrani` bu metnin emsali ve aynı iki kural burada da
 * geçerli — bir tanesi bu görevle **değişti**:
 *
 * 1. **Ürünün bugün yapamadığı bir şeyi tarif etme.** Emsal metin
 *    "uygulama şu an kendiliğinden yedek almıyor" diyordu ve doğruydu.
 *    Artık alıyor; bu ekran da yedekleri gerçekten listeliyor ve gerçekten
 *    geri yüklüyor. Metin buna göre yazıldı: koşullu ("yedeğiniz varsa")
 *    kısım duruyor çünkü klasörünü hiç seçmemiş bir kullanıcının yedeği
 *    hâlâ olmayabilir.
 * 2. **Elle prosedür, kodun yaptığı işin aynısını yaptırmalı.**
 *    `backup::geri_yukle` yerleştirmeden sonra `veri.db-wal` ve
 *    `veri.db-shm`'yi siler ("WAL dosyalari eski veritabanina aitti,
 *    birakilirsa tutarsizlik uretir"). Uygulama bağlantıyı oturum boyunca
 *    açık tuttuğu için veri dizininde neredeyse her zaman bir WAL vardır;
 *    bu adım metinden düşerse elle geri yükleyen kullanıcı SQLite'a başka
 *    bir veritabanına ait WAL'ı replay ettirir ve yeni kopyayı ilk
 *    denemesinde bozar.
 *
 * # Sıralamanın kendisi bir karar
 *
 * "Önce kopyanızı alın" **koşulsuz ve en üstte**. Bu ekranı gören kişi
 * panik hâlinde ve deneyeceği ilk şey genellikle geri döndürülemez olan
 * şeydir. Bir kopya alındıktan sonra buradaki hiçbir adım kalıcı zarar
 * veremez; alınmadan önce her adım verebilir.
 *
 * "Yeniden kurulum yapmayın" uyarısı da bu yüzden formdan **önce**
 * duruyor: yeni kurulum yeni bir veri anahtarı üretip eskisinin yerine
 * geçer ve o andan sonra mevcut kayıtlar hiçbir parolayla açılamaz. Bu,
 * panikteki bir kullanıcının yapacağı en olası ve en yıkıcı hamledir.
 */
export type GeriYuklemeSebebi = 'veritabani-bozuk' | 'anahtar-bozuk' | 'kurulum'

type Props = {
  /** `/api/durum`'un `veri_dizini` alanı — gerçek, mutlak yol. */
  veriDizini: string
  sebep: GeriYuklemeSebebi
  yedekleriGetir: (dizin?: string) => Promise<YedekListesi>
  geriYukle: (girdi: {
    dizin?: string
    dosya_adi: string
    parola?: string
    kurtarma_kodu?: string
  }) => Promise<unknown>
  /** Geri yükleme başarılı olduğunda çağrılır (App durumu tazeler). */
  onTamamlandi: () => void
  /** Ekrandan çıkış yolu. Verilmezse "Vazgeç" gösterilmez. */
  onVazgec?: () => void
}

const GIRIS_METNI: Record<GeriYuklemeSebebi, string> = {
  'veritabani-bozuk':
    'Parolanız doğru ve anahtar dosyanız yerinde, ama kayıt dosyanızın içeriği bozulmuş. ' +
    'Bu sizin yaptığınız bir hata değil; genellikle disk sorunu, ani kapanma ya da ' +
    'dosyayı senkronize eden bir programdan kaynaklanır.',
  'anahtar-bozuk':
    'Kayıtlarınızı açan anahtar dosyası okunamıyor. Kayıtlarınız hâlâ yerinde duruyor; ' +
    'eksik olan yalnızca onları açan anahtar.',
  kurulum:
    'Daha önce aldığınız bir yedeğiniz varsa, yeni kurulum yapmadan önce onu geri ' +
    'yükleyin. Sıra önemli: kurulum yaparsanız kayıtlarınız açılamaz hâle gelir.',
}

export function GeriYuklemeEkrani({
  veriDizini,
  sebep,
  yedekleriGetir,
  geriYukle,
  onTamamlandi,
  onVazgec,
}: Props) {
  const [klasor, setKlasor] = useState('')
  const [liste, setListe] = useState<YedekListesi | null>(null)
  const [listeHatasi, setListeHatasi] = useState<string | null>(null)
  const [araniyor, setAraniyor] = useState(false)
  const [secili, setSecili] = useState<YedekOzeti | null>(null)
  const [parola, setParola] = useState('')
  const [kurtarmaModu, setKurtarmaModu] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const [suruyor, setSuruyor] = useState(false)
  const [bitti, setBitti] = useState<string | null>(null)

  const yedekleriAra = useCallback(
    async (dizin?: string) => {
      setAraniyor(true)
      setListeHatasi(null)
      try {
        const gelen = await yedekleriGetir(dizin)
        setListe(gelen)
        // Klasör kutusu sunucunun çözdüğü yolla dolduruluyor: kullanıcı
        // hangi klasöre baktığını görmeli. (Kayıtlı ayar da buradan gelir.)
        setKlasor(gelen.hedef_dizin)
      } catch (e) {
        setListe(null)
        setListeHatasi(e instanceof Error ? e.message : 'Yedekler listelenemedi.')
      } finally {
        setAraniyor(false)
      }
    },
    [yedekleriGetir],
  )

  // Açılışta kayıtlı klasöre bakılır. Hata YUTULMAZ ama ekranı da kapatmaz:
  // klasörü hiç seçmemiş bir kullanıcı burada "klasör belli değil" mesajını
  // görüp yolu kendisi yazar — bu ekranın en olası ilk hâli budur.
  useEffect(() => {
    void yedekleriAra()
  }, [yedekleriAra])

  async function uygula() {
    if (!secili) return
    setSuruyor(true)
    setHata(null)
    try {
      await geriYukle({
        dizin: klasor.trim() || undefined,
        dosya_adi: secili.dosya_adi,
        ...(kurtarmaModu ? { kurtarma_kodu: parola } : { parola }),
      })
      setBitti(secili.tarih)
      setParola('')
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Geri yükleme yapılamadı.')
    } finally {
      setSuruyor(false)
    }
  }

  if (bitti) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h1 className="text-2xl font-semibold text-emerald-800">Geri yükleme tamamlandı</h1>
        <p className="mt-3 text-sm text-slate-600">
          Kayıtlarınız <strong>{bitti}</strong> tarihli yedekten geri yüklendi. Şimdi{' '}
          <strong>o tarihteki parolanızla</strong> girin — parolanızı sonradan
          değiştirdiyseniz burada eskisi geçerlidir, çünkü yedek kendi anahtar dosyasıyla
          birlikte geri geldi.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          O yedekten sonra girdiğiniz kayıtlar bu dosyada yoktur. Az önce kopyasını aldığınız
          klasörü, her şeyin yerinde olduğundan emin olana kadar silmeyin.
        </p>
        <button
          className="mt-6 w-full rounded-lg bg-slate-900 py-2 text-white"
          onClick={onTamamlandi}
        >
          Devam et
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-semibold text-red-700">Yedekten geri yükleme</h1>
      <p className="mt-3 text-sm text-slate-600">{GIRIS_METNI[sebep]}</p>

      {/* KOSULSUZ ILK ADIM. Bundan once hicbir sey denenmemeli. */}
      <h2 className="mt-6 text-base font-semibold">Önce: kayıtlarınızın bir kopyasını alın</h2>
      <p className="mt-2 text-sm text-slate-600">
        Aşağıdaki adımlara geçmeden önce bunu yapın. Kopya elinizdeyken bundan sonra ne
        yaparsanız yapın geri dönüşü vardır; kopya olmadan bazı adımların dönüşü yoktur.
        Uygulamanın veri klasörü şurası:
      </p>
      <p className="mt-2 select-all break-all rounded-lg bg-slate-100 p-3 font-mono text-xs text-slate-800">
        <code>{veriDizini}</code>
      </p>
      <p className="mt-2 text-sm text-slate-600">
        Finder bu klasörü normalde göstermez; açmak için Finder'da{' '}
        <strong>Git &rsaquo; Klasöre Git</strong> (<kbd>⇧</kbd>+<kbd>⌘</kbd>+<kbd>G</kbd>) deyip
        yukarıdaki yolu yapıştırın. <strong>Klasörün tamamını</strong> harici bir diske ya da
        USB belleğe kopyalayın.
      </p>

      <p className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
        <strong>Yeniden kurulum yapmayın.</strong> Yeni kurulum yeni bir anahtar üretip
        eskisinin yerine geçer; o andan sonra mevcut kayıtlarınız hiçbir parolayla — kurtarma
        kodunuzla bile — açılamaz. Bu klasördeki <code>veri.db</code> ve{' '}
        <code>keystore.json</code> dosyalarını da silmeyin.
      </p>

      {/* --- Yedek klasoru ve liste --- */}
      <h2 className="mt-6 text-base font-semibold">Yedeğinizi seçin</h2>
      <p className="mt-2 text-sm text-slate-600">
        Her yedek <strong>iki dosyadan</strong> oluşur: kayıtlarınızın kopyası
        (<code>yedek-TARİH.db</code>) ve o kopyayı açan anahtar dosyası
        (<code>yedek-TARİH.keystore.json</code>). Aşağıda yalnızca <strong>ikisi de yerinde
        olan</strong> yedekler listelenir — tek dosyası kalmış bir yedek geri yüklenemez.
      </p>
      <label className="mt-4 block text-sm" htmlFor="yedek-klasoru">
        Yedek klasörü
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="yedek-klasoru"
          className="w-full rounded-lg border p-2 font-mono text-xs"
          placeholder="/Volumes/YEDEK/terapi-yedek"
          value={klasor}
          onChange={(e) => {
            setKlasor(e.target.value)
            setSecili(null)
          }}
        />
        <button
          type="button"
          className="shrink-0 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
          disabled={araniyor}
          onClick={() => void yedekleriAra(klasor.trim() || undefined)}
        >
          {araniyor ? 'Aranıyor…' : 'Yedekleri ara'}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Klasörün yolunu yazın ya da yapıştırın. Finder'da klasöre sağ tıklayıp{' '}
        <kbd>⌥</kbd> tuşuna basılıyken <strong>“… Yol Adı Olarak Kopyala”</strong> deyince yol
        panoya kopyalanır.
      </p>

      {listeHatasi && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {listeHatasi}
        </p>
      )}

      {liste !== null && liste.yedekler.length === 0 && (
        <p className="mt-3 rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          Bu klasörde geri yüklenebilir bir yedek bulunamadı. Doğru klasör mü, harici disk
          takılı mı? Klasörde <code>yedek-TARİH.db</code> dosyası olup{' '}
          <code>yedek-TARİH.keystore.json</code> dosyası yoksa o yedek geri yüklenemez ve
          burada görünmez — eksik dosyayı aramaya değer, silinmiş olmayabilir.
        </p>
      )}

      {liste !== null && liste.yedekler.length > 0 && (
        <ul className="mt-3 space-y-1">
          {liste.yedekler.map((y) => (
            <li key={y.dosya_adi}>
              <label className="flex items-center gap-2 rounded border p-2 text-sm">
                <input
                  type="radio"
                  name="yedek"
                  checked={secili?.dosya_adi === y.dosya_adi}
                  onChange={() => {
                    setSecili(y)
                    setHata(null)
                  }}
                />
                <span className="font-medium">{y.tarih}</span>
                <span className="text-slate-500">{boyutBicimle(y.boyut)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {secili && (
        <div className="mt-4 rounded border border-amber-400 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            <strong>{secili.tarih}</strong> tarihli yedek geri yüklenecek. O tarihten sonra
            girdiğiniz danışanlar, randevular ve notlar bu dosyada <strong>yoktur</strong>;
            geri yükleme onları mevcut kayıt dosyanızla birlikte değiştirir. Yukarıdaki kopyayı
            aldıysanız bu adım geri alınabilir.
          </p>
          <label className="mt-3 block text-sm text-amber-900" htmlFor="yedek-parolasi">
            {kurtarmaModu ? 'Kurtarma kodunuz' : `${secili.tarih} tarihindeki parolanız`}
          </label>
          <input
            id="yedek-parolasi"
            type={kurtarmaModu ? 'text' : 'password'}
            className="mt-1 w-full rounded-lg border p-2"
            value={parola}
            onChange={(e) => setParola(e.target.value)}
          />
          <p className="mt-1 text-xs text-amber-900">
            Yedek, <strong>alındığı tarihteki</strong> parolanızla açılır. Parolanızı o
            tarihten sonra değiştirdiyseniz burada eskisini yazın; hatırlamıyorsanız kurtarma
            kodunuz her zaman geçerlidir.
          </p>
          {hata && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {hata}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded bg-amber-700 px-3 py-1 text-sm text-white disabled:opacity-50"
              disabled={suruyor || parola === ''}
              onClick={() => void uygula()}
            >
              {suruyor ? 'Geri yükleniyor…' : 'Bu yedeği geri yükle'}
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1 text-sm"
              onClick={() => {
                setKurtarmaModu(!kurtarmaModu)
                setParola('')
                setHata(null)
              }}
            >
              {kurtarmaModu ? 'Parolayla dene' : 'Parolamı unuttum'}
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1 text-sm"
              disabled={suruyor}
              onClick={() => {
                setSecili(null)
                setParola('')
                setHata(null)
              }}
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {/* --- Elle geri yukleme: kodun yaptigi ISIN AYNISI --- */}
      <h2 className="mt-6 text-base font-semibold">Elle geri yüklemek isterseniz</h2>
      <p className="mt-2 text-sm text-slate-600">
        Yukarıdaki adım çalışmazsa (uygulama açılmıyor, klasör okunamıyor) aynı işi elle de
        yapabilirsiniz. Adımların hiçbirini atlamayın, özellikle üçüncüsünü.
      </p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600">
        <li>Uygulamayı kapatın ve yedek klasörünüzü açın.</li>
        <li>
          En yeni tarihli, <strong>ikisi de</strong> yerinde olan yedek çiftini veri
          klasörüne kopyalayın; <code>.db</code> dosyasını <code>veri.db</code>,{' '}
          <code>.keystore.json</code> dosyasını <code>keystore.json</code> olarak adlandırın.
        </li>
        <li>
          Veri klasöründe <code>veri.db-wal</code> veya <code>veri.db-shm</code> adlı dosyalar
          varsa <strong>onları da silin</strong>. Bunlar eski veritabanına ait geçici
          dosyalardır; yerinde bırakılırsa yeni kopyayla karışır ve onu da bozarlar.
          (Uygulamanın kendi geri yüklemesi bu adımı sizin için yapar.)
        </li>
        <li>
          Uygulamayı açıp <strong>o yedeğin alındığı tarihteki parolanızla</strong> girin.
        </li>
      </ol>

      <h2 className="mt-6 text-base font-semibold">Yedeğiniz yoksa</h2>
      <p className="mt-2 text-sm text-slate-600">
        Bu ekran son söz değil. Kayıtlarınız hâlâ diskte duruyor ve kopyasını aldığınız sürece
        durum geri döndürülebilir kalır. Yeniden kurulum yapmayın, veri klasöründeki dosyaları
        silmeyin; sağlam bir kopya sonradan ortaya çıkabilir (örneğin bir Time Machine
        yedeğinde ya da eski bir bilgisayarda).
      </p>

      {onVazgec && (
        <button
          type="button"
          className="mt-6 w-full text-sm text-slate-500 underline"
          onClick={onVazgec}
        >
          Geri dön
        </button>
      )}
    </div>
  )
}
