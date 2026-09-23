import { useState } from 'react'

type Props = {
  kilitAc: (girdi: { parola?: string; kurtarma_kodu?: string }) => Promise<unknown>
  onAcildi: () => void
}

export function KilitEkrani({ kilitAc, onAcildi }: Props) {
  const [parola, setParola] = useState('')
  const [kurtarmaModu, setKurtarmaModu] = useState(false)
  // Kurtarma kodu VARSAYILAN olarak gizli — bkz. aşağıdaki giriş alanının
  // yorumu. Yalnızca kurtarma modunda anlamlı; parola modunda hiç okunmaz.
  const [kodGorunur, setKodGorunur] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const [bekliyor, setBekliyor] = useState(false)

  async function gonder(e: React.FormEvent) {
    e.preventDefault()
    setBekliyor(true)
    setHata(null)
    try {
      await kilitAc(kurtarmaModu ? { kurtarma_kodu: parola } : { parola })
      onAcildi()
    } catch (err) {
      setHata(err instanceof Error ? err.message : 'Açılamadı.')
    } finally {
      setBekliyor(false)
    }
  }

  return (
    <form className="mx-auto max-w-sm p-8" onSubmit={gonder}>
      <h1 className="text-xl font-semibold">Kilitli</h1>
      <label className="mt-6 block text-sm" htmlFor="giris">
        {kurtarmaModu ? 'Kurtarma kodu' : 'Ana parola'}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="giris"
          // Kurtarma kodu paroladan DAHA GÜÇLÜ bir sır -- tek başına, ana
          // parola hiç bilinmeden bile oturumu açar. Kod tabanının kendi
          // kuralı ("parola alanları `type=password`", bkz.
          // `AnaEkran.test.tsx` > "parola alanlari `type=password`")
          // buraya da aynı gerekçeyle (ekran görünürken danışan odada
          // olabilir) uygulanır: varsayılan her zaman GİZLİ.
          //
          // Fark: parola genelde ezbere yazılır, kurtarma kodu ise kağıda
          // yazılmış bir dizgiden KOPYALANIR -- kör yazmak burada çok daha
          // hataya açık. Bu yüzden (yalnızca kurtarma modunda) bir "Göster"
          // düğmesiyle GEÇİCİ olarak görünür kılınabilir; varsayılan yine
          // gizlidir ve moddan çıkınca sıfırlanır.
          type={kurtarmaModu && kodGorunur ? 'text' : 'password'}
          autoFocus
          className="w-full rounded-lg border p-2"
          value={parola}
          onChange={(e) => setParola(e.target.value)}
        />
        {kurtarmaModu && (
          <button
            type="button"
            className="shrink-0 rounded-lg border px-3 text-sm"
            onClick={() => setKodGorunur((g) => !g)}
          >
            {kodGorunur ? 'Gizle' : 'Göster'}
          </button>
        )}
      </div>
      {hata && <p className="mt-3 text-sm text-red-600">{hata}</p>}
      <button
        type="submit"
        disabled={bekliyor}
        className="mt-6 w-full rounded-lg bg-slate-900 py-2 text-white disabled:opacity-40"
      >
        {bekliyor ? 'Açılıyor…' : 'Aç'}
      </button>
      <button
        type="button"
        className="mt-3 w-full text-sm text-slate-500 underline"
        onClick={() => {
          setKurtarmaModu(!kurtarmaModu)
          setParola('')
          setHata(null)
          setKodGorunur(false)
        }}
      >
        {kurtarmaModu ? 'Parolayla gir' : 'Parolamı unuttum'}
      </button>
    </form>
  )
}
