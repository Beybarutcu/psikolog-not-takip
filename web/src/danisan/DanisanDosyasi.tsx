import { useEffect, useState } from 'react'
import { notApi, takvimApi, type DanisanSeansi, type SeansNotu } from '../api'
import type { KartVerisi } from '../screens/anaEkranKancalari/useDanisanDosyasi'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { NotEditoru } from '../seans/NotEditoru'
import { SeansAltSatiri } from '../seans/SeansAltSatiri'
import { DanisanKarti } from './DanisanKarti'
import { SeansListesi } from './SeansListesi'

/**
 * Danışanın dosyası: Seanslar / Bilgiler alt sekmeleri (Plan 5 Görev 6-7).
 *
 * # Ürün amacı
 *
 * Bugüne kadar geçmiş seansları ve notları görmenin tek yolu takvimden bir
 * randevuya tıklamaktı. Bu bileşen danışana tıklandığında AÇILAN dosyanın
 * içine "Seanslar" alt sekmesini kurar: solda `SeansListesi`, sağda seçili
 * seansın notu (`NotEditoru`) ve alt satırı (`SeansAltSatiri`, durum +
 * ücret + ödendi). Not düzenlemek için takvime dönmek GEREKMEZ.
 *
 * # Kendi küçük sekme şeridi — `kabuk/Sekmeler` DEĞİL
 *
 * `kabuk/Sekmeler.tsx` uygulamanın ÜST kabuğunun şeridi (Takvim/Danışanlar/
 * Ayarlar). Burada AYRI ve daha küçük bir şerit var (Seanslar/Bilgiler) —
 * aynı bileşeni burada da kullanmak iki `tablist`in `id`/`aria-controls`
 * uzayını karıştırırdı (iki farklı `role="tab"` grubu aynı `id`leri
 * üretirdi). Bu yüzden burada kendi `id`leri olan küçük bir şerit yazıldı.
 *
 * # "Bilgiler" bugün eski `DanisanKarti`, Görev 7'de `DosyaBilgileri`
 *
 * Görev 7 `DanisanKarti`nin içeriğini `DosyaBilgileri`ye taşıyıp KVKK
 * uyarı dilini değiştirecek. Bu görevin işi yalnızca "Bilgiler" alt
 * sekmesinin YERİNİ açmak; içerik bugünkü `DanisanKarti` ile aynen kalıyor.
 *
 * # Seans notu bu bileşenin İÇİNDE yüklenir, `SeansPaneli`nin aksine
 *
 * Takvimdeki `SeansPaneli` notunu ÇAĞIRAN taraftan (`useSeansNotlari`)
 * prop olarak alır çünkü orada aynı akış "geçmiş notlar" ve "özel not"
 * sekmesiyle de paylaşılıyor. Burada ne geçmiş not listesi ne özel not
 * sekmesi var (Görev 6'nın kapsamı bilerek dar: yalnızca resmî not +
 * durum/ödeme) — bu yüzden `notApi.notGetir`/`notKaydet` doğrudan burada
 * çağrılıyor, ayrı bir kanca dosyası açmadan (bkz. plan dosya listesi:
 * bu görev yalnızca bu iki bileşeni ekliyor).
 *
 * # Seçim RENDER SIRASINDA türetilir, efektte DEĞİL
 *
 * Kod tabanının tekrar eden deseni (`useDanisanSeanslari`,
 * `useSeansNotlari`, `useDanisanDosyasi`): "hangi kayıt seçili" state'i
 * yalnızca KULLANICININ elle seçtiği kimliği tutar; ekrana giden değer her
 * render'da türetilir (`seciliManuel` listede hâlâ varsa o, yoksa en
 * yenisi). Böylece danışan değişip liste yeniden geldiğinde (bu bileşen
 * `key`li olduğu için aslında YENİDEN MOUNT olur, bkz. `DanisanlarSekmesi`)
 * ya da bir seans listeden düşerse, seçim sessizce "hiçbir şey"e değil her
 * zaman geçerli bir seansa düşer.
 *
 * # Durum/ödeme değişikliği YEREL bir yama ile yansır
 *
 * `seanslar` prop'u dışarıdan geliyor (`useDanisanSeanslari`, bu bileşenin
 * dışında çağrılıyor). Alt satırdan "Geldi" ya da "Ödendi" işaretlemek bu
 * bileşenin listeyi yeniden ÇEKMESİNİ gerektirmez (silinemez bir
 * `goruntuleme` satırı daha demek olurdu) — `useDanisanDosyasi.randevuYamala`
 * ile aynı fikir, burada `yamalar` state'i olarak.
 */
type Props = {
  kart: KartVerisi
  seanslar: DanisanSeansi[]
  bugun: string
  veriRaporuIndir: (danisanId: number, parola: string) => Promise<void>
  ekYukle: (dosya: File, tur: string) => Promise<void>
  ekSil: (ekId: number) => Promise<void>
  onRizaKaydet: (alan: { riza_tarihi: string; riza_dosya_id: number | null }) => Promise<void>
  onKapat: () => void
}

type AltSekme = 'seanslar' | 'bilgiler'

type NotAkisi = { appointmentId: number; not: SeansNotu | null; hata: string | null }

type Yama = { durum?: string; odendi?: boolean }

export function DanisanDosyasi({
  kart,
  seanslar,
  bugun,
  veriRaporuIndir,
  ekYukle,
  ekSil,
  onRizaKaydet,
  onKapat,
}: Props) {
  const [altSekme, setAltSekme] = useState<AltSekme>('seanslar')
  const [seciliManuel, setSeciliManuel] = useState<number | null>(null)
  const [notAkisi, setNotAkisi] = useState<NotAkisi | null>(null)
  const [notTazeleme, setNotTazeleme] = useState(0)
  // Durum/ödeme değişikliklerinin yerel yaması: randevu kimliğine göre.
  // Danışan değişince bu bileşen tümüyle unmount edildiği için (bkz. modül
  // başlığı) burada danışana özgü bir sıfırlama GEREKMEZ.
  const [yamalar, setYamalar] = useState<Record<number, Yama>>({})

  const seanslarYamali = seanslar.map((s) => {
    const yama = yamalar[s.appointment_id]
    return yama === undefined ? s : { ...s, ...yama }
  })

  // "En yeni seçili" (bkz. modül başlığı): manuel seçim listede hâlâ
  // geçerliyse o, değilse listenin ilki (sunucu en yeniden eskiye
  // döndürür, bkz. `api.ts::danisanApi.seanslar`).
  const manuelGecerli =
    seciliManuel !== null && seanslarYamali.some((s) => s.appointment_id === seciliManuel)
  const secili = manuelGecerli ? seciliManuel : (seanslarYamali[0]?.appointment_id ?? null)
  const seciliSeans = seanslarYamali.find((s) => s.appointment_id === secili) ?? null

  const notGorunen = notAkisi !== null && notAkisi.appointmentId === secili ? notAkisi : null

  useEffect(() => {
    if (secili === null) return
    let iptal = false
    notApi.notGetir(secili).then(
      (n) => {
        if (iptal) return
        setNotAkisi({ appointmentId: secili, not: n, hata: null })
      },
      (e: unknown) => {
        // 401: `api.ts`teki merkezi dinleyici (App.tsx) senkron olarak
        // devreye girip ekranı kilitler — bu bileşenin burada AYRICA
        // `onYetkisiz` çağırması gerekmiyor (`useDanisanSeanslari`nin
        // aksine, o listeyi TUTAN taraf; burada yalnızca görüntüleniyor).
        if (iptal) return
        setNotAkisi({
          appointmentId: secili,
          not: null,
          hata: e instanceof Error ? e.message : 'Not yüklenemedi.',
        })
      },
    )
    return () => {
      iptal = true
    }
  }, [secili, notTazeleme])

  async function notKaydet(kayit: { sablon: string; icerik: string }) {
    if (secili === null) return
    const yeni = await notApi.notKaydet(secili, kayit.sablon, kayit.icerik)
    setNotAkisi((onceki) =>
      onceki !== null && onceki.appointmentId === secili ? { ...onceki, not: yeni } : onceki,
    )
  }

  async function durumDegis(durum: string) {
    if (seciliSeans === null) return
    const id = seciliSeans.appointment_id
    await takvimApi.randevuDurumu(id, durum)
    setYamalar((onceki) => ({ ...onceki, [id]: { ...onceki[id], durum } }))
  }

  async function odemeDegis(odendi: boolean) {
    if (seciliSeans === null) return
    const id = seciliSeans.appointment_id
    await takvimApi.odemeGuncelle(id, odendi)
    setYamalar((onceki) => ({ ...onceki, [id]: { ...onceki[id], odendi } }))
  }

  // `SeansAltSatiri` `Randevu` (takvimin tipi) bekliyor ama `DanisanSeansi`
  // bitiş saatini ve seri kimliğini TAŞIMIYOR. Bileşen bu iki alanı hiç
  // OKUMUYOR (yalnızca `durum`/`ucret`/`odendi`, bkz. `SeansAltSatiri.tsx`);
  // aşağıdaki `bitis`/`seri_id` yalnızca tip sözleşmesini doldurmak için
  // konan, ekranda hiçbir yere gitmeyen zararsız dolgu değerlerdir.
  const seciliRandevu: Randevu | null =
    seciliSeans === null || kart.dosya === null
      ? null
      : {
          id: seciliSeans.appointment_id,
          client_id: kart.dosya.id,
          danisan_adi: kart.dosya.ad_soyad,
          baslangic: seciliSeans.baslangic,
          bitis: seciliSeans.baslangic,
          durum: seciliSeans.durum,
          ucret: seciliSeans.ucret_kurus,
          odendi: seciliSeans.odendi,
          seri_id: null,
        }

  const seanslarSekmesiSecili = altSekme === 'seanslar'

  return (
    <div>
      <div role="tablist" aria-label="Danışan dosyası bölümleri" className="flex gap-1">
        <button
          type="button"
          role="tab"
          id="danisan-dosyasi-sekme-seanslar"
          aria-selected={seanslarSekmesiSecili}
          aria-controls={seanslarSekmesiSecili ? 'danisan-dosyasi-panel-seanslar' : undefined}
          tabIndex={seanslarSekmesiSecili ? 0 : -1}
          onClick={() => setAltSekme('seanslar')}
          className={
            'rounded-t border-b-2 px-3 py-1 text-sm ' +
            (seanslarSekmesiSecili
              ? 'border-slate-900 font-medium text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800')
          }
        >
          Seanslar
        </button>
        <button
          type="button"
          role="tab"
          id="danisan-dosyasi-sekme-bilgiler"
          aria-selected={!seanslarSekmesiSecili}
          aria-controls={!seanslarSekmesiSecili ? 'danisan-dosyasi-panel-bilgiler' : undefined}
          tabIndex={seanslarSekmesiSecili ? -1 : 0}
          onClick={() => setAltSekme('bilgiler')}
          className={
            'rounded-t border-b-2 px-3 py-1 text-sm ' +
            (!seanslarSekmesiSecili
              ? 'border-slate-900 font-medium text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800')
          }
        >
          Bilgiler
        </button>
      </div>

      {seanslarSekmesiSecili ? (
        <div
          role="tabpanel"
          id="danisan-dosyasi-panel-seanslar"
          aria-labelledby="danisan-dosyasi-sekme-seanslar"
          className="mt-3 grid grid-cols-[16rem_1fr] gap-4"
        >
          <SeansListesi seanslar={seanslarYamali} secili={secili} onSecim={setSeciliManuel} />

          <div>
            {seciliSeans === null ? (
              <p className="text-sm text-slate-500">Bu danışanın kayıtlı bir seansı yok.</p>
            ) : (
              <>
                {notGorunen?.hata != null ? (
                  <div role="alert" className="rounded border border-red-300 bg-red-50 p-3">
                    <p className="text-sm text-red-800">Not yüklenemedi. {notGorunen.hata}</p>
                    <button
                      type="button"
                      className="mt-2 rounded border border-red-300 px-2 py-1 text-sm"
                      onClick={() => setNotTazeleme((n) => n + 1)}
                    >
                      Yeniden dene
                    </button>
                  </div>
                ) : notGorunen?.not == null ? (
                  <p className="text-sm text-slate-600">Seans notu yükleniyor…</p>
                ) : (
                  <NotEditoru
                    key={`danisan-not-${seciliSeans.appointment_id}`}
                    baslangicIcerik={notGorunen.not.icerik}
                    baslangicSablon={notGorunen.not.sablon}
                    taslakAnahtari={`danisan-not-${seciliSeans.appointment_id}`}
                    onKaydet={notKaydet}
                  />
                )}

                {seciliRandevu !== null && (
                  <SeansAltSatiri
                    randevu={seciliRandevu}
                    onDurumDegis={durumDegis}
                    onOdemeDegis={odemeDegis}
                  />
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div
          role="tabpanel"
          id="danisan-dosyasi-panel-bilgiler"
          aria-labelledby="danisan-dosyasi-sekme-bilgiler"
          className="mt-3"
        >
          {kart.dosya !== null && (
            <DanisanKarti
              danisan={kart.dosya}
              ekler={kart.ekler}
              randevular={kart.randevular}
              bugun={bugun}
              veriRaporuIndir={veriRaporuIndir}
              ekYukle={ekYukle}
              ekSil={ekSil}
              onRizaKaydet={onRizaKaydet}
              onKapat={onKapat}
            />
          )}
        </div>
      )}
    </div>
  )
}
