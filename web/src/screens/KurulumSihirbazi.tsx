import { useState } from 'react'

type Props = {
  kurulumYap: (parola: string) => Promise<{ kurtarma_kodu: string }>
  onTamam: () => void
  /**
   * Geri yükleme ekranını açar — **kurulum yapılmadan önce**.
   *
   * Bu ekranın en tehlikeli kullanıcısı, bilgisayarı değişmiş ve elinde
   * yalnızca yedek klasörü olan kişidir; kurulum yaparsa yedeğindeki
   * kayıtlar kalıcı olarak açılamaz hâle gelir.
   */
  onGeriYukle: () => void
}

export function KurulumSihirbazi({ kurulumYap, onTamam, onGeriYukle }: Props) {
  const [parola, setParola] = useState('')
  const [tekrar, setTekrar] = useState('')
  const [hata, setHata] = useState<string | null>(null)
  const [kurtarmaKodu, setKurtarmaKodu] = useState<string | null>(null)
  const [onaylandi, setOnaylandi] = useState(false)

  async function devamEt() {
    if (parola.length < 8) return setHata('Parola en az 8 karakter olmalı.')
    if (parola !== tekrar) return setHata('Girdiğiniz iki parola aynı değil.')
    setHata(null)
    try {
      const sonuc = await kurulumYap(parola)
      setKurtarmaKodu(sonuc.kurtarma_kodu)
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Kurulum yapılamadı.')
    }
  }

  if (kurtarmaKodu) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h1 className="text-2xl font-semibold">Kurtarma kodunuz</h1>
        <p className="mt-3 text-sm text-slate-600">
          Parolanızı unutursanız verilerinize erişmenin <strong>tek yolu</strong> bu koddur.
          Yazdırıp güvenli bir yerde saklayın. Bu kod bir daha gösterilmeyecek.
        </p>
        <p
          data-testid="kurtarma-kodu"
          className="my-6 rounded-lg bg-slate-100 p-4 text-center font-mono text-lg tracking-wider"
        >
          {kurtarmaKodu}
        </p>
        <p className="mt-3 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          Yedek klasörünüzde her yedek <strong>iki dosyadan</strong> oluşur: kayıtlarınızın kopyası
          ve o kopyayı açan anahtar dosyası. Bu ikisi birbirinden ayrılmamalı — biri olmadan diğeri
          işe yaramaz, hiçbir parola ya da kurtarma kodu tek başına yeterli olmaz. Yedeklerinizi
          taşırken veya kopyalarken ikisini <strong>birlikte</strong> saklayın.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={onaylandi}
            onChange={(e) => setOnaylandi(e.target.checked)}
          />
          <span>Kurtarma kodunu kaydettim, güvenli bir yerde duruyor.</span>
        </label>
        <button
          className="mt-6 w-full rounded-lg bg-slate-900 py-2 text-white disabled:opacity-40"
          disabled={!onaylandi}
          onClick={onTamam}
        >
          Kurulumu bitir
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-semibold">Hoş geldiniz</h1>
      <p className="mt-3 text-sm text-slate-600">
        Bir ana parola belirleyin. Tüm kayıtlarınız bu parolayla şifrelenecek ve bu bilgisayardan
        hiçbir yere gönderilmeyecek.
      </p>

      <label className="mt-6 block text-sm" htmlFor="parola">Ana parola</label>
      <input
        id="parola"
        type="password"
        className="mt-1 w-full rounded-lg border p-2"
        value={parola}
        onChange={(e) => setParola(e.target.value)}
      />

      <label className="mt-4 block text-sm" htmlFor="tekrar">Parola tekrar</label>
      <input
        id="tekrar"
        type="password"
        className="mt-1 w-full rounded-lg border p-2"
        value={tekrar}
        onChange={(e) => setTekrar(e.target.value)}
      />

      {hata && <p className="mt-3 text-sm text-red-600">{hata}</p>}

      <button className="mt-6 w-full rounded-lg bg-slate-900 py-2 text-white" onClick={devamEt}>
        Devam et
      </button>

      {/* ELİNDE YEDEK OLANIN ÇIKIŞI — kurulumdan ÖNCE.
          Bu ekranın en tehlikeli kullanıcısı, bilgisayarı değişmiş ve elinde
          yalnızca yedek klasörü olan kişidir. Onun için doğru sıra "önce
          kurulum, sonra geri yükleme" DEĞİLDİR: kurulum yeni bir veri
          anahtarı üretir ve `keystore.json`'ı yazar; o andan sonra yedekteki
          kayıtlar hiçbir parolayla açılamaz. Uyarı bu yüzden düğmenin
          yanında ve kurulum akışının içinde duruyor — kullanıcının onu
          aramasına gerek kalmadan. */}
      <div className="mt-8 rounded-lg border border-amber-400 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-900">Daha önce yedek aldıysanız</h2>
        <p className="mt-2 text-sm text-amber-900">
          Bilgisayarınız değiştiyse ya da uygulamayı yeniden kurduysanız,{' '}
          <strong>kurulum yapmadan önce</strong> yedeğinizi geri yükleyin. Kurulum yeni bir
          anahtar üretir ve eskisinin yerine geçer; o andan sonra yedeğinizdeki kayıtlar
          hiçbir parolayla — kurtarma kodunuzla bile — açılamaz.
        </p>
        <button
          type="button"
          className="mt-3 w-full rounded-lg border border-amber-700 py-2 text-sm text-amber-900"
          onClick={onGeriYukle}
        >
          Yedekten geri yükle
        </button>
      </div>
    </div>
  )
}
