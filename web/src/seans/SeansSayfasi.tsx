import { useState } from 'react'
import { takvimApi, type Danisan, type DanisanSeansi } from '../api'
import type { EtiketBaglami } from '../etiket/EtiketSatiri'
import type { useSeansNotlari } from '../screens/anaEkranKancalari/useSeansNotlari'
import type { useTakvimAkisi } from '../screens/anaEkranKancalari/useTakvimAkisi'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { RandevuPaneli } from '../takvim/RandevuPaneli'
import { zamanMetni } from '../tarih'
import { OncekiNotlar } from './OncekiNotlar'
import { SeansAltSatiri } from './SeansAltSatiri'
import { SeansPaneli } from './SeansPaneli'

/**
 * Seans notu sayfası (tasarım §7 N1-N4): takvimde bir randevuya tıklayınca
 * ızgaranın YERİNE açılır; Takvim sekmesi seçili kalır.
 *
 * - Üst satır (N2): "Takvime dön" (seçimi kapatır, hafta aynı kalır),
 *   danışan adı (dosyaya), tarih-saat, durum/ücret/Ödendi (`SeansAltSatiri`
 *   — bugünkü yazma yolları) ve "Randevuyu düzenle".
 * - Randevu formu (N3) KAPALI başlar: randevu güncellemek seyrek bir iş ve
 *   not alırken yer kaplamamalı. "Güncelle" sonrası açık kalır.
 * - Editör alanı (N4): `SeansPaneli` (sekmeler, şablon, editör, etiketler).
 *   Not okunamazsa editör AÇILMAZ, ama durum/ödeme yine işaretlenebilir.
 * - Sağ sütun: `OncekiNotlar` (N5-N9). Geniş okumada (N7) sütun sayfanın
 *   yarısına büyür; editör AYNI düğümde kalır (yazılmamış metin kaybolmaz).
 *   Genişlik HANGİ danışan için açıldığıyla tutulur ve panel danışan
 *   kimliğiyle `key`lidir: randevu formdan başka danışana taşınınca (aynı
 *   seans kimliği, sayfa yeniden kurulmaz) eski danışanın açık notu yeni
 *   danışanın sayfasında KALMAZ.
 *
 * Bu bileşen seans kimliğiyle `key`lidir (`TakvimSekmesi`): başka bir seansa
 * geçiş formu, sekmeyi ve alt satırın iyimser "Ödendi"sini sıfırlar; taşıma
 * (aynı kimlik, yeni başlangıç) sayfayı yeniden monte ETMEZ.
 *
 * # Yükseklik: editör alanı ekranı doldurur (N4 "sayfanın büyük kısmı")
 *
 * Bölge en az bir ekran boyu (`100dvh`, eksi kaydırma payı): açılışta sayfanın
 * başına kaydırılıyor (`TakvimSekmesi`, A6), yani üst satırdan ekranın altına
 * kadar olan alan sayfanındır. Editör satırı kalan yüksekliği alır ve esnek
 * kutu zinciri (`SeansPaneli` > sekme gövdesi > `NotEditoru` >
 * `BicimliYuzey`) bu yüksekliği yazı yüzeyine taşır; yazı alanının kendi
 * asgarisi (16rem) kısa pencerelerde ve randevu formu açıkken geçerli (bölge
 * o zaman uzar, sayfa kayar).
 *
 * Notun UZUNLUĞU bölgeyi uzatmaz (kullanıcı isteği 2026-09-27, "araç çubuğu
 * örtmesin notu"): yazı alanı boyut sınırlamalı (`contain-size`, bkz.
 * `BicimliYuzey`), uzun not orada kayar. Eskiden not bölgeyi ve sayfayı
 * uzatıyor, sayfa kayınca şablonun yapışkan araç çubuğu notun üst satırlarını
 * örtüyordu. Şimdi üst satır (durum/ödeme), etiket satırı ve bul paneli sayfa
 * kaydırılmadan ekranda kalır. Ölçen testler: `e2e/yerlesim.spec.ts` > "not
 * sayfasinda editor ekranin kalanini doldurur", "arac cubugu notu ortmez".
 */
type Props = {
  randevu: Randevu
  seansAkisi: ReturnType<typeof useSeansNotlari>
  danisanlar: Danisan[]
  onTakvimeDon: () => void
  onDanisanAc: (clientId: number) => void
  onDurumDegis: (durum: string) => Promise<void>
  onOdemeDegis: (odendi: boolean) => Promise<void>
  onRandevuKaydet: (kayit: Parameters<ReturnType<typeof useTakvimAkisi>['kaydet']>[0]) => Promise<void>
  onRandevuSil: (id: number) => Promise<void>
  onSeriSil: (seriId: string, buTarihtenItibaren: string) => Promise<void>
  /** Önceki notlardan seansa geçiş (tasarım N8, `takvim.randevuyaGit`). */
  onSeansaGit: (id: number, baslangic: string) => void
  /**
   * Danışan dosyasının BU danışan için yüklü, taze seans listesi; yoksa
   * `null` — önceki notlar paneli o zaman listeyi kendisi ister (preflight
   * F7, bkz. `OncekiNotlar` "Liste kaynağı").
   */
  seansListesiOnbellegi: DanisanSeansi[] | null
  etiket: EtiketBaglami
  /** Kullanıcı seçiminde sayfanın başına kaydırma (`TakvimSekmesi`). */
  ref?: React.Ref<HTMLElement>
}

export function SeansSayfasi({
  randevu, seansAkisi, danisanlar, onTakvimeDon, onDanisanAc, onDurumDegis, onOdemeDegis,
  onRandevuKaydet, onRandevuSil, onSeriSil, onSeansaGit, seansListesiOnbellegi, etiket, ref,
}: Props) {
  const [formAcik, setFormAcik] = useState(false)
  // Geniş okuma HANGİ danışanın paneli için açıldı (bkz. modül başlığı).
  const [genisDanisan, setGenisDanisan] = useState<number | null>(null)
  const oncekiGenis = genisDanisan === randevu.client_id
  const seans = seansAkisi.seans
  return (
    <section
      ref={ref}
      id="seans-bolumu"
      data-testid="seans-bolumu"
      aria-labelledby="seans-sayfasi-basligi"
      className="flex min-h-[calc(100dvh-1rem)] scroll-mt-2 flex-col"
    >
      <h2 id="seans-sayfasi-basligi" className="sr-only">Seans</h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 pb-3">
        <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onTakvimeDon}>
          <span aria-hidden="true">← </span>Takvime dön
        </button>
        {/* CRITICAL-1: takvimden danışana giden yol. Erişilebilir ad danışan
            listesindeki çiple AYNI kalıp ("… dosyasını aç"). */}
        <button
          type="button"
          className="text-lg font-semibold underline"
          aria-label={`${randevu.danisan_adi} dosyasını aç`}
          onClick={() => onDanisanAc(randevu.client_id)}
        >
          {randevu.danisan_adi}
        </button>
        <span data-testid="seans-zamani" className="text-sm text-slate-600">{zamanMetni(randevu.baslangic)}</span>
        {/* Durum ve ödeme notlara BAĞLI DEĞİL: not okunamasa da işaretlenebilir
            (Görev 2 inceleme I1). `key` gerekmiyor: sayfanın kendisi seans
            kimliğiyle `key`li. */}
        <SeansAltSatiri gomulu randevu={randevu} onDurumDegis={onDurumDegis} onOdemeDegis={onOdemeDegis} />
        <button
          type="button"
          className="ml-auto rounded border px-3 py-1 text-sm"
          aria-expanded={formAcik}
          // YALNIZCA açıkken: kapalı formun kabı DOM'da yok ve var olmayan bir
          // id'yi göstermek ekran okuyucuya kırık bir bağ verir (`SeansPaneli`
          // sekmelerindeki kural; ölçen test: `SeansSayfasi.test.tsx` > "7.6").
          aria-controls={formAcik ? 'seans-randevu-formu' : undefined}
          onClick={() => setFormAcik((acik) => !acik)}
        >
          {formAcik ? 'Kapat' : 'Randevuyu düzenle'}
        </button>
      </div>

      {formAcik && (
        <div id="seans-randevu-formu" className="mt-3">
          <RandevuPaneli
            // Sayfa zaten kimlikle `key`li; bu `key` aynı kalıbı korur
            // (Görev 10 inceleme Bulgu 1: iç state başka randevuya sızmasın).
            // Kimlik aynıyken (Güncelle, liste tazelemesi, Geldi) monte OLMAZ:
            // taze kayıt `RandevuPaneli`nin yeniden eşitleme efektine (R9) gelir.
            key={`randevu-${randevu.id}`}
            gomulu
            zaman={randevu.baslangic}
            randevu={randevu}
            danisanlar={danisanlar}
            onKaydet={onRandevuKaydet}
            onSil={onRandevuSil}
            onSeriSil={onSeriSil}
            seriSayisiAl={takvimApi.seriSayisi}
            silinecekNotSayisiAl={takvimApi.silinecekNotSayisi}
            onKapat={onTakvimeDon}
            cakismaKontrol={takvimApi.cakismaKontrol}
          />
        </div>
      )}

      <div className="mt-4 flex flex-1 items-stretch gap-4">
        <div className="flex min-w-0 flex-1 flex-col">
          {seans.hata === null ? (
            <SeansPaneli
              randevu={randevu}
              not={seans.not}
              ozelNot={seans.ozelNot}
              ozelHata={seans.ozelHata}
              onNotKaydet={seansAkisi.notKaydet}
              onOzelNotKaydet={seansAkisi.ozelNotKaydet}
              onOzelSekme={seansAkisi.ozelSekmeAcildi}
              onOzelYenidenDene={seansAkisi.ozelYenidenDene}
              etiket={etiket}
            />
          ) : (
            // Yükleme başarısızsa editör AÇILMAZ: "yükleniyor…" yazan bir alan
            // sonsuza kadar öyle kalırdı (eski bölümün kuralı).
            <div role="alert" className="rounded border border-red-300 bg-red-50 p-3">
              <p className="text-sm text-red-800">Seans notu yüklenemedi. {seans.hata}</p>
              <button
                type="button"
                className="mt-2 rounded border border-red-300 px-2 py-1 text-sm"
                onClick={seansAkisi.yenidenDene}
              >
                Yeniden dene
              </button>
            </div>
          )}
        </div>
        {seans.hata === null && (
          // Geniş okuma (N7): sütun sayfanın yarısına büyür; editör aynı
          // düğümde kalır. Geçiş animasyonu YOK: `_variables.scss`'teki
          // katmansız `transition: none` kuralı `transition-*` sınıflarını
          // zaten öldürür.
          <div className={oncekiGenis ? 'w-1/2 shrink-0' : 'w-80 shrink-0'}>
            <OncekiNotlar
              key={randevu.client_id}
              danisanId={randevu.client_id}
              seansId={randevu.id}
              seansBaslangici={randevu.baslangic}
              onbellek={seansListesiOnbellegi}
              onSeansaGit={onSeansaGit}
              onGenislikDegisti={(genis) => setGenisDanisan(genis ? randevu.client_id : null)}
            />
          </div>
        )}
      </div>
    </section>
  )
}
