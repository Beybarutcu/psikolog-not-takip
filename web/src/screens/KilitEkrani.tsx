import { useState } from 'react'

type Props = {
  kilitAc: (girdi: { parola?: string; kurtarma_kodu?: string }) => Promise<unknown>
  onAcildi: () => void
}

export function KilitEkrani({ kilitAc, onAcildi }: Props) {
  const [parola, setParola] = useState('')
  const [kurtarmaModu, setKurtarmaModu] = useState(false)
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
      <input
        id="giris"
        type={kurtarmaModu ? 'text' : 'password'}
        autoFocus
        className="mt-1 w-full rounded-lg border p-2"
        value={parola}
        onChange={(e) => setParola(e.target.value)}
      />
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
        onClick={() => { setKurtarmaModu(!kurtarmaModu); setParola(''); setHata(null) }}
      >
        {kurtarmaModu ? 'Parolayla gir' : 'Parolamı unuttum'}
      </button>
    </form>
  )
}
