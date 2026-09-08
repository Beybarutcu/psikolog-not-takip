import { useEffect, useState } from 'react'
import type { Danisan } from '../api'
import type { Randevu } from './HaftalikTakvim'
import { dakikaFarki, yerelZaman, zamandanDate } from './hafta'

const VARSAYILAN_SURE_DK = 60

type Kayit = {
  client_id: number
  baslangic: string
  bitis: string
  ucret: number | null
  tekrar_sayisi?: number
}

type Props = {
  zaman: string
  randevu: Randevu | null
  danisanlar: Danisan[]
  onKaydet: (kayit: Kayit) => Promise<void>
  onDurumDegis: (id: number, durum: string) => Promise<void>
  onSil: (id: number) => Promise<void>
  onKapat: () => void
  cakismaKontrol: (baslangic: string, bitis: string, haricId?: number) => Promise<Randevu[]>
}

function bitisHesapla(baslangic: string, sureDk: number): string {
  const d = zamandanDate(baslangic)
  d.setMinutes(d.getMinutes() + sureDk)
  return yerelZaman(d)
}

// Kullanıcı TL girer ("450"), sunucuya kuruş (tam sayı, 45000) gider. Ücret *
// 100 kayan noktalı yuvarlama hatasına açıktır (ör. 19.99 * 100 tam olarak
// 1999 çıkmayabilir) — bu yüzden çarpımdan sonra Math.round ile en yakın
// kuruşa yuvarlanır, sonucu doğrudan sunucuya tam sayı olarak gönderiyoruz.
function tldenKurusa(tl: string): number | null {
  if (tl.trim() === '') return null
  return Math.round(Number(tl) * 100)
}

export function RandevuPaneli({
  zaman, randevu, danisanlar, onKaydet, onDurumDegis, onSil, onKapat, cakismaKontrol,
}: Props) {
  const baslangic = randevu?.baslangic ?? zaman
  const [clientId, setClientId] = useState<number | ''>(randevu?.client_id ?? '')
  const [sureDk, setSureDk] = useState(
    randevu ? dakikaFarki(randevu.baslangic, randevu.bitis) : VARSAYILAN_SURE_DK,
  )
  const [ucretTl, setUcretTl] = useState(randevu?.ucret != null ? String(randevu.ucret / 100) : '')
  const [tekrar, setTekrar] = useState(false)
  const [haftaSayisi, setHaftaSayisi] = useState('8')
  const [cakisanlar, setCakisanlar] = useState<Randevu[]>([])
  const [hata, setHata] = useState<string | null>(null)
  const [silOnayi, setSilOnayi] = useState(false)

  const bitis = bitisHesapla(baslangic, sureDk)

  useEffect(() => {
    let iptal = false
    void cakismaKontrol(baslangic, bitis, randevu?.id).then((liste) => {
      if (!iptal) setCakisanlar(liste)
    })
    return () => {
      iptal = true
    }
  }, [baslangic, bitis, randevu?.id, cakismaKontrol])

  async function kaydet() {
    if (clientId === '') {
      setHata('Lütfen bir danışan seçin.')
      return
    }
    setHata(null)
    await onKaydet({
      client_id: Number(clientId),
      baslangic,
      bitis,
      ucret: tldenKurusa(ucretTl),
      ...(tekrar ? { tekrar_sayisi: Number(haftaSayisi) } : {}),
    })
  }

  return (
    <aside className="w-80 border-l bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{randevu ? 'Randevu' : 'Yeni randevu'}</h3>
        <button className="text-slate-500" onClick={onKapat}>
          Kapat
        </button>
      </div>

      <p className="mt-1 text-sm text-slate-600">
        {baslangic.replace('T', ' ')} – {bitis.slice(11)}
      </p>

      <label className="mt-4 block text-sm" htmlFor="danisan">
        Danışan
      </label>
      <select
        id="danisan"
        className="mt-1 w-full rounded border p-2"
        value={clientId}
        onChange={(e) => setClientId(e.target.value === '' ? '' : Number(e.target.value))}
      >
        <option value="">Seçiniz…</option>
        {danisanlar.map((d) => (
          <option key={d.id} value={d.id}>
            {d.ad_soyad}
          </option>
        ))}
      </select>

      <label className="mt-3 block text-sm" htmlFor="sure">
        Süre (dakika)
      </label>
      <input
        id="sure"
        type="number"
        min={15}
        step={15}
        className="mt-1 w-full rounded border p-2"
        value={sureDk}
        onChange={(e) => setSureDk(Number(e.target.value))}
      />

      <label className="mt-3 block text-sm" htmlFor="ucret">
        Ücret (TL)
      </label>
      <input
        id="ucret"
        type="number"
        min={0}
        className="mt-1 w-full rounded border p-2"
        value={ucretTl}
        onChange={(e) => setUcretTl(e.target.value)}
      />

      {!randevu && (
        <div className="mt-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={tekrar}
              onChange={(e) => setTekrar(e.target.checked)}
            />
            Her hafta tekrarla
          </label>
          {tekrar && (
            <>
              <label className="mt-2 block text-sm" htmlFor="hafta">
                Kaç hafta
              </label>
              <input
                id="hafta"
                type="number"
                min={2}
                max={52}
                className="mt-1 w-full rounded border p-2"
                value={haftaSayisi}
                onChange={(e) => setHaftaSayisi(e.target.value)}
              />
            </>
          )}
        </div>
      )}

      {cakisanlar.length > 0 && (
        <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-800">
          Bu saatte başka randevu var: {cakisanlar.map((r) => r.danisan_adi).join(', ')}
        </p>
      )}

      {hata && <p className="mt-3 text-sm text-red-600">{hata}</p>}

      <button className="mt-4 w-full rounded bg-slate-900 py-2 text-white" onClick={() => void kaydet()}>
        Kaydet
      </button>

      {randevu && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-1">
            {(
              [
                ['Geldi', 'geldi'],
                ['Gelmedi', 'gelmedi'],
                ['İptal', 'iptal'],
              ] as const
            ).map(([etiket, kod]) => (
              <button
                key={kod}
                className="rounded border py-1 text-sm"
                onClick={() => void onDurumDegis(randevu.id, kod)}
              >
                {etiket}
              </button>
            ))}
          </div>

          {silOnayi ? (
            <div className="mt-3 rounded bg-red-50 p-2">
              <p className="text-sm text-red-800">Bu randevu kalıcı olarak silinsin mi?</p>
              <div className="mt-2 flex gap-2">
                <button
                  className="rounded bg-red-700 px-3 py-1 text-sm text-white"
                  onClick={() => void onSil(randevu.id)}
                >
                  Evet, sil
                </button>
                <button className="rounded border px-3 py-1 text-sm" onClick={() => setSilOnayi(false)}>
                  Vazgeç
                </button>
              </div>
            </div>
          ) : (
            <button
              className="mt-3 w-full text-sm text-red-700 underline"
              onClick={() => setSilOnayi(true)}
            >
              Sil
            </button>
          )}
        </>
      )}
    </aside>
  )
}
