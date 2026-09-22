import { useCallback, useEffect, useRef, useState } from 'react'
import { notApi, type SeansNotu } from '../../api'
import { yazmaSaatiOlustur } from './yazmaSaati'

/** Notun verisi, HANGİ seansa ait olduğuyla birlikte (aynı gerekçe `SeansVerisi`'nde). */
type DosyaNotuDurumu = { id: number; not: SeansNotu | null; hata: string | null }

/**
 * Danışan dosyasının Seanslar alt sekmesinde SEÇİLİ seansın resmî notu (son
 * inceleme C1 + M1).
 *
 * # Neden bileşenden kancaya taşındı
 *
 * Bu yükleme eskiden `DanisanDosyasi`'nin içindeydi ve iki kusur taşıyordu:
 *
 * 1. (C1) Kayıt da orada, doğrudan `notApi.notKaydet` ile yapılıyor ve
 *    sonuç YALNIZCA bileşenin kendi state'ine yazılıyordu. Takvimdeki açık
 *    seansın notu (`useSeansNotlari`) bundan habersizdi: dosyada yazılan not
 *    takvime dönünce ESKİ hâliyle görünüyor, terapist tek bir tuşa basınca
 *    otomatik kayıt eski metni PUT edip dosyada yazılanı SUNUCUDAN
 *    siliyordu. Artık kayıt `AnaEkran`'ın TEK yolundan geçiyor ve her
 *    başarılı kayıt `notYansit` ile hem bu kancaya hem `useSeansNotlari`'na
 *    hem seans listesine yayılıyor.
 * 2. (M1) Danışanlar sekmesine her girişte bileşen yeniden monte oluyor ve
 *    AYNI notu yeniden istiyordu — her istek sunucuda silinemez bir
 *    `goruntuleme` satırı. Kanca `AnaEkran`'da yaşadığı için veri sekme
 *    geçişinde kaybolmaz; yayılım onu taze tuttuğu için yeniden çekmeye de
 *    gerek yoktur.
 *
 * # İstek YALNIZCA görünürken (`gorunur`)
 *
 * Kanca panel montajından bağımsız çalıştığı için, görünmeyen bir sekmeden
 * istek atmaması AÇIKÇA sağlanmalı (bkz. `AnaEkran.tsx` modül başlığı,
 * IMPORTANT-3 — aynı sınıf). `gorunur`: Danışanlar sekmesi VE Seanslar alt
 * sekmesi açık VE kart yüklenmiş. Son şart eskiden de vardı (dosya bileşeni
 * kart yüklenmeden monte olmuyordu); Seanslar alt sekmesi şartı ise yeni ve
 * daraltıcı: Bilgiler alt sekmesindeyken görülmeyecek bir not artık
 * istenmiyor.
 *
 * Bu seansın verisi zaten elde varsa (başarı ya da hata) efekt İSTEK
 * ATMAZ; hata durumunda yeniden deneme yalnızca `yenidenDene` ile.
 *
 * # Uçuştaki yazma × not okuması
 *
 * Takvim'den ayrılırken `NotEditoru` bekleyen metni unmount'ta PUT ediyor;
 * takvimden "… dosyasını aç" ile gelindiyse bu kanca aynı nota AYNI ANDA
 * GET atıyor. GET yazmadan önce okunup yazmadan SONRA dönerse eski metni
 * getirirdi. `yazmaSaati` (beşinci kullanıcı) bunu kapatıyor: okuma
 * başladıktan sonra biten yazma yanıtın üstüne uygulanır. Editör zaten
 * monte olmuşsa, geç gelen yazmayı `NotEditoru`'nun `sunucuHali` prop'u
 * (editör temizse) benimsiyor.
 *
 * # 401
 *
 * `api.ts`teki merkezi dinleyici (App.tsx) senkron olarak devreye girip
 * ekranı kilitliyor; bu kanca ayrıca `onYetkisiz` almıyor (eski bileşenle
 * AYNI davranış).
 */
export function useDosyaNotu({
  appointmentId,
  gorunur,
}: {
  appointmentId: number | null
  gorunur: boolean
}) {
  const [durum, setDurum] = useState<DosyaNotuDurumu | null>(null)
  const [tazeleme, setTazeleme] = useState(0)
  const [saat] = useState(() =>
    yazmaSaatiOlustur<SeansNotu, SeansNotu>((n) => n.appointment_id),
  )
  // Efekt "bu seansın verisi elde mi" sorusunu REF üzerinden okur: `durum`
  // bağımlılık olsaydı yanıtın kendisi efekti yeniden tetiklerdi ve hata
  // durumunda bu, sonsuz bir yeniden deneme döngüsü (her biri silinemez bir
  // log satırı) demekti.
  const durumRef = useRef(durum)
  durumRef.current = durum

  const bu = durum !== null && durum.id === appointmentId ? durum : null

  useEffect(() => {
    if (!gorunur || appointmentId === null) return
    if (durumRef.current !== null && durumRef.current.id === appointmentId) return
    let iptal = false
    const buId = appointmentId
    const okumaDamgasi = saat.okumaBasladi()
    notApi.notGetir(buId).then(
      (n) => {
        if (iptal) return
        const [yamali] = saat.uygula([n], okumaDamgasi)
        setDurum({ id: buId, not: yamali ?? n, hata: null })
      },
      (e: unknown) => {
        if (iptal) return
        setDurum({
          id: buId,
          not: null,
          hata: e instanceof Error ? e.message : 'Not yüklenemedi.',
        })
      },
    )
    return () => {
      iptal = true
    }
  }, [gorunur, appointmentId, tazeleme, saat])

  /**
   * Başarılı bir not kaydının sonucunu bu önbelleğe yansıtır (kaydın hangi
   * ekrandan geldiği fark etmez; bkz. `AnaEkran.seansNotuKaydet`). Önbellek
   * başka bir seansa aitse yalnızca saate işlenir: o seansın okuması uçuştaysa
   * geç dönen yanıt bu değeri alır.
   */
  const notYansit = useCallback(
    (id: number, yeni: SeansNotu) => {
      saat.yazmaBitti(id, yeni)
      setDurum((onceki) =>
        onceki !== null && onceki.id === id ? { id, not: yeni, hata: null } : onceki,
      )
    },
    [saat],
  )

  function yenidenDene() {
    setDurum(null)
    setTazeleme((n) => n + 1)
  }

  return { not: bu?.not ?? null, hata: bu?.hata ?? null, notYansit, yenidenDene }
}
