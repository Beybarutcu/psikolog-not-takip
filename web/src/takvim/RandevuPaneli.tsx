import { useEffect, useRef, useState } from 'react'
import type { Danisan, SeriCakismasi } from '../api'
import type { Randevu } from './HaftalikTakvim'
import { dakikaFarki, yerelZaman, zamandanDate } from './hafta'

const VARSAYILAN_SURE_DK = 60
// Çakışma kontrolü sunucuya her tuş vuruşunda gidiyordu (Görev 5'te bu uç
// noktanın bilinçli olarak log yazmadığı kararlaştırılmıştı, yani sık
// çağrılacağı biliniyordu — yine de gereksiz yük). Süre alanına art arda
// basarken tek istek gitmesi için değişiklik bu kadar süre sessiz kalınca
// gönderiliyor.
const CAKISMA_GECIKME_MS = 300

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
  // Serideki bu randevudan İTİBAREN gelen tüm tekrarları siler; geçmiş
  // korunur (bkz. sunucudaki `seriyi_sil`).
  onSeriSil: (seriId: string, buTarihtenItibaren: string) => Promise<void>
  // Onay metnindeki sayıyı üretir: kaç randevu silinecek.
  seriSayisiAl: (seriId: string, buTarihtenItibaren: string) => Promise<number>
  onKapat: () => void
  cakismaKontrol: (
    baslangic: string,
    bitis: string,
    haricId?: number,
    tekrarSayisi?: number,
  ) => Promise<SeriCakismasi>
}

// Tekrar sayısı kullanıcı tarafından serbest metin olarak giriliyor
// ("", "abc", "0", "99"). Geçerli bir seri uzunluğu değilse çakışma
// kontrolüne tekrar sayısı GÖNDERİLMEZ (sunucu 400 dönerdi) — tek hafta
// kontrolüne düşülür. Üst sınır sunucudaki AZAMI_TEKRAR ile aynı.
const AZAMI_TEKRAR = 52

function gecerliTekrar(ham: string): number | undefined {
  const n = Number(ham)
  if (!Number.isInteger(n) || n < 2 || n > AZAMI_TEKRAR) return undefined
  return n
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
  zaman, randevu, danisanlar, onKaydet, onDurumDegis, onSil, onSeriSil, seriSayisiAl,
  onKapat, cakismaKontrol,
}: Props) {
  const baslangic = randevu?.baslangic ?? zaman
  const [clientId, setClientId] = useState<number | ''>(randevu?.client_id ?? '')
  const [sureDk, setSureDk] = useState(
    randevu ? dakikaFarki(randevu.baslangic, randevu.bitis) : VARSAYILAN_SURE_DK,
  )
  const [ucretTl, setUcretTl] = useState(randevu?.ucret != null ? String(randevu.ucret / 100) : '')
  const [tekrar, setTekrar] = useState(false)
  const [haftaSayisi, setHaftaSayisi] = useState('8')
  const [cakisma, setCakisma] = useState<SeriCakismasi | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const [silOnayi, setSilOnayi] = useState(false)
  // Seri silme onayı: `null` = onay açık değil, sayı = kaç randevu
  // silinecek (sunucudan alındı). Silme geri alınamaz olduğu için tekil
  // silmedeki iki adımlı onay deseni burada da uygulanıyor.
  const [seriSilOnayi, setSeriSilOnayi] = useState<number | null>(null)
  const [islemSuruyor, setIslemSuruyor] = useState(false)

  // onKaydet/onDurumDegis/onSil (ör. kayıt işlemi) tamamlanmadan panel başka
  // bir randevuya/boş saate geçiş sonucu kaldırılırsa (kaydet çağrısı
  // AnaEkran'da paneli kapatıyor), aşağıdaki finally/catch bloklarının
  // kaldırılmış bileşende setState çağırmasını önler — cakismaKontrol
  // efektindeki `iptal` bayrağıyla aynı desen.
  const gecerli = useRef(true)
  useEffect(() => () => {
    gecerli.current = false
  }, [])

  const bitis = bitisHesapla(baslangic, sureDk)

  // Seri kuruluyorsa çakışma TÜM haftalar için sorulur. Bu yokken panel
  // yalnızca 1. haftayı kontrol ediyordu: "Salı 14:00, 12 hafta" serisi, o
  // saatte zaten 8 haftalık başka bir seri varken TEMİZ görünüyor ve 8
  // çifte randevu sessizce oluşuyordu (bkz. dal incelemesi I2).
  const sorulacakTekrar = tekrar ? gecerliTekrar(haftaSayisi) : undefined

  useEffect(() => {
    let iptal = false
    const zamanlayici = setTimeout(() => {
      cakismaKontrol(baslangic, bitis, randevu?.id, sorulacakTekrar)
        .then((sonuc) => {
          if (!iptal) setCakisma(sonuc)
        })
        .catch(() => {
          // Çakışma kontrolü bir UYARI mekanizması; başarısız olması
          // kaydetmeyi engellememeli ve panelin hata alanını da
          // doldurmamalı (kullanıcının yaptığı bir işlem değil). 401
          // durumunda merkezi dinleyici (api.ts) zaten devreye giriyor.
          if (!iptal) setCakisma(null)
        })
    }, CAKISMA_GECIKME_MS)
    return () => {
      iptal = true
      clearTimeout(zamanlayici)
    }
  }, [baslangic, bitis, randevu?.id, sorulacakTekrar, cakismaKontrol])

  // Kaydet/durum/sil işlemleri sürerken düğmeleri devre dışı bırakmak ve
  // sunucudan dönen hatayı panelin içinde de göstermek için ortak sarmalayıcı.
  // Hızlı çift tıklama, düğme devre dışı kaldığı için ikinci bir çağrı
  // üretmiyor (bkz. RandevuPaneli.test.tsx).
  async function islemCalistir(islem: () => Promise<void>) {
    setHata(null)
    setIslemSuruyor(true)
    try {
      await islem()
    } catch (e) {
      if (gecerli.current) setHata(e instanceof Error ? e.message : 'İşlem tamamlanamadı.')
    } finally {
      if (gecerli.current) setIslemSuruyor(false)
    }
  }

  async function kaydet() {
    if (clientId === '') {
      setHata('Lütfen bir danışan seçin.')
      return
    }
    const ucretTrim = ucretTl.trim()
    if (ucretTrim !== '' && Number.isNaN(Number(ucretTrim))) {
      setHata('Ücret sayısal bir değer olmalı (ör. 450 veya 450.50).')
      return
    }
    // Kaydetme yolu, çakışma sorgusuyla AYNI süzgeci kullanır
    // (`sorulacakTekrar`, yani `gecerliTekrar`). Önceden burada ham
    // `Number(haftaSayisi)` vardı: "Her hafta tekrarla" işaretliyken alan
    // boşsa `Number('') = 0` gidiyor, sunucu `Some(n) if n > 1` ile
    // eşleşmediği için sessizce TEK randevu oluşturuyordu — kullanıcı seri
    // istemiş, tek kayıt almış, hiçbir hata görmemiş oluyordu. İki yol
    // ayrışmıştı; artık tek kaynak var ve geçersiz değer sessizce başka bir
    // şey yapmak yerine kullanıcıya söyleniyor.
    if (tekrar && sorulacakTekrar === undefined) {
      setHata(`Tekrar sayısı 2 ile ${AZAMI_TEKRAR} arasında bir tam sayı olmalı.`)
      return
    }
    await islemCalistir(() =>
      onKaydet({
        client_id: Number(clientId),
        baslangic,
        bitis,
        ucret: tldenKurusa(ucretTl),
        ...(sorulacakTekrar !== undefined ? { tekrar_sayisi: sorulacakTekrar } : {}),
      }),
    )
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
        type="text"
        inputMode="decimal"
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

      {/* Karar değişmedi: çakışma ENGELLEMEZ, UYARIR (üç katmanda tutarlı).
          Seri kuruluyorsa uyarı kaç haftada çakışma olduğunu da söyler. */}
      {cakisma && cakisma.cakisanlar.length > 0 && (
        <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-800">
          {cakisma.kontrol_edilen_hafta > 1
            ? `${cakisma.kontrol_edilen_hafta} haftalık serinin ` +
              `${cakisma.cakisan_hafta_sayisi} haftasında başka randevu var: `
            : 'Bu saatte başka randevu var: '}
          {cakisma.cakisanlar.map((r) => r.danisan_adi).join(', ')}
        </p>
      )}

      {hata && <p className="mt-3 text-sm text-red-600">{hata}</p>}

      {/* Düğme metni kipe göre değişiyor: düzenleme kipinde "Kaydet"
          demek, kullanıcıya yeni bir kayıt oluşturulacağını ima ediyordu
          (ve gerçekten öyle oluyordu, bkz. dal incelemesi C1). "Güncelle"
          ne olacağını doğru söyler. */}
      <button
        className="mt-4 w-full rounded bg-slate-900 py-2 text-white disabled:opacity-50"
        onClick={() => void kaydet()}
        disabled={islemSuruyor}
      >
        {randevu ? 'Güncelle' : 'Kaydet'}
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
                className="rounded border py-1 text-sm disabled:opacity-50"
                onClick={() => void islemCalistir(() => onDurumDegis(randevu.id, kod))}
                disabled={islemSuruyor}
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
                  className="rounded bg-red-700 px-3 py-1 text-sm text-white disabled:opacity-50"
                  onClick={() => void islemCalistir(() => onSil(randevu.id))}
                  disabled={islemSuruyor}
                >
                  Evet, sil
                </button>
                <button
                  className="rounded border px-3 py-1 text-sm"
                  onClick={() => setSilOnayi(false)}
                  disabled={islemSuruyor}
                >
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

          {/* Seri iptali. 52 haftalık bir seri iki tıkla kuruluyordu ama
              iptal etmenin tek yolu 52 randevuyu tek tek silmekti
              (`seriyi_sil` yazılmış ama hiçbir çağrı yeri yoktu — bkz. dal
              incelemesi I4a). Kullanıcı artık "bu randevu" ile "bu ve
              sonraki tüm tekrarlar" arasında seçim yapıyor. */}
          {randevu.seri_id && !silOnayi && (
            seriSilOnayi !== null ? (
              <div className="mt-3 rounded bg-red-50 p-2">
                <p className="text-sm text-red-800">
                  Bu randevu ve sonraki {seriSilOnayi - 1} tekrarı ({seriSilOnayi} randevu)
                  kalıcı olarak silinsin mi? Geçmiş randevular silinmez.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    className="rounded bg-red-700 px-3 py-1 text-sm text-white disabled:opacity-50"
                    onClick={() =>
                      void islemCalistir(() =>
                        onSeriSil(randevu.seri_id as string, randevu.baslangic),
                      )
                    }
                    disabled={islemSuruyor}
                  >
                    Evet, tekrarları sil
                  </button>
                  <button
                    className="rounded border px-3 py-1 text-sm"
                    onClick={() => setSeriSilOnayi(null)}
                    disabled={islemSuruyor}
                  >
                    Vazgeç
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="mt-2 w-full text-sm text-red-700 underline disabled:opacity-50"
                disabled={islemSuruyor}
                onClick={() =>
                  void islemCalistir(async () => {
                    // Onay metnindeki sayı sunucudan alınır: seri ekrandaki
                    // haftanın çok ötesine uzanabilir.
                    const adet = await seriSayisiAl(
                      randevu.seri_id as string,
                      randevu.baslangic,
                    )
                    if (gecerli.current) setSeriSilOnayi(adet)
                  })
                }
              >
                Bu ve sonraki tüm tekrarları sil
              </button>
            )
          )}
        </>
      )}
    </aside>
  )
}
