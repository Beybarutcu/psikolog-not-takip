import { Fragment, type ReactNode } from 'react'
import { tlMetni } from '../para'
import { baslangicAyi, dosyaOzeti, gunluTarihSaat, kisaTarih, type OzetRandevusu } from './dosyaOzeti'

/**
 * Dosya başlığındaki soluk özet satırı (tasarım B2). Tanımlar `dosyaOzeti.ts`
 * başlığında. Olmayan parça yazılmaz, hiç parça yoksa satır da yok. Uyarı
 * rengi yok; onam ve saklama gibi bilgiler bu satıra girmez. Yeni istek yok.
 *
 * "…'dan beri", "Son" ve "Sıradaki" BAĞLANTIDIR: `onSec` o seansı seçer.
 * Çağıran (`DanisanDosyasi.ozettenSec`) Seanslar alt sekmesine geçer, gizleyen
 * etiket süzgecini sıfırlar ve satırı görünür alana getirtir. Bağlantılar
 * `<button>`: gezinmezler, seçerler. Erişilebilir adları görünen metindir.
 */
type Parca = { anahtar: string; dugum: ReactNode }

function Baglanti({ baslik, onClick, children }: { baslik: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      title={baslik}
      onClick={onClick}
      className="underline decoration-dotted underline-offset-2 hover:text-slate-800"
    >
      {children}
    </button>
  )
}

export function DosyaOzetiSatiri({
  randevular,
  simdi,
  onSec,
}: {
  randevular: readonly OzetRandevusu[]
  simdi: string
  onSec: (appointmentId: number) => void
}) {
  const o = dosyaOzeti(randevular, simdi)
  const parcalar: Parca[] = []
  if (o.geldiSayisi > 0) parcalar.push({ anahtar: 'sayi', dugum: `${o.geldiSayisi}. seans` })
  const ilk = o.ilkGeldi
  if (ilk !== null) {
    parcalar.push({
      anahtar: 'ilk',
      dugum: <Baglanti baslik="İlk seansı seç" onClick={() => onSec(ilk.id)}>{baslangicAyi(ilk.baslangic)}</Baglanti>,
    })
  }
  const son = o.sonGeldi
  if (son !== null) {
    parcalar.push({
      anahtar: 'son',
      dugum: <Baglanti baslik="Son seansı seç" onClick={() => onSec(son.id)}>{`Son: ${kisaTarih(son.baslangic, simdi)}`}</Baglanti>,
    })
  }
  const siradaki = o.siradaki
  if (siradaki !== null) {
    parcalar.push({
      anahtar: 'siradaki',
      dugum: (
        <Baglanti baslik="Sıradaki seansı seç" onClick={() => onSec(siradaki.id)}>
          {`Sıradaki: ${gunluTarihSaat(siradaki.baslangic, simdi)}`}
        </Baglanti>
      ),
    })
  }
  if (o.odenmemisKurus > 0) {
    parcalar.push({
      anahtar: 'borc',
      dugum:
        `Ödenmemiş: ${tlMetni(o.odenmemisKurus)}` +
        (o.isaretlenmemis > 0 ? ` (+${o.isaretlenmemis} işaretlenmemiş)` : ''),
    })
  } else if (o.isaretlenmemis > 0) {
    // "(+N)" bir borca eklenen şerhtir; borç yokken kendi parçası.
    parcalar.push({ anahtar: 'isaret', dugum: `${o.isaretlenmemis} işaretlenmemiş seans` })
  }
  if (parcalar.length === 0) return null
  return (
    <p data-testid="dosya-ozeti" className="-mt-1 mb-2 text-sm text-slate-500">
      {parcalar.map((p, i) => (
        <Fragment key={p.anahtar}>
          {i > 0 && ' · '}
          {p.dugum}
        </Fragment>
      ))}
    </p>
  )
}
