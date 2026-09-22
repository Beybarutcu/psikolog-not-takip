import { useState } from 'react'
import type { Etiket } from '../api'
import {
  ayniEtiket,
  ETIKET_AZAMI_KARAKTER,
  etiketAdiNormallestir,
  etiketAdiUzunlugu,
} from './etiketAdi'

/**
 * Bir seansın etiketleri için gereken her şey — `AnaEkran` üretir
 * (`etiketBaglami(id)`), iki ekran (takvim seans paneli, danışan dosyası)
 * AYNI nesneyi alır. Veri tek önbellekten (`useEtiketler`), yazmalar
 * `AnaEkran`'ın TEK yolundan geçer (`onEkle`/`onKaldir`); bu bileşen ne
 * istek atar ne sonuç saklar.
 */
export type EtiketBaglami = {
  /** `null` = yükleniyor (ya da `hata`). */
  etiketler: Etiket[] | null
  hata: string | null
  onYenidenDene: () => void
  /** Öneri listesi; `null` = henüz istenmedi. */
  sozluk: Etiket[] | null
  /** Kutuya odaklanıldı — sözlüğü (henüz yoksa) iste. */
  onSozlukIste: () => void
  onEkle: (ad: string) => Promise<void>
  onKaldir: (etiket: Etiket) => Promise<void>
  /** Çipe tıklandı — o etiketi taşıyan seansları aç. */
  onEtiketAc: (etiket: Etiket) => void
  /**
   * Bu seansa yapılan son yazmanın (ekleme/kaldırma) sunucu hatası. Bileşende
   * DEĞİL `useEtiketler`'de, seans kimliğiyle tutulur: Enter'dan sonra seans
   * değişirse bu bileşen sökülür ve hata yerel state'te olsaydı kaybolurdu
   * (inceleme M6). Terapist seansa dönünce görür.
   */
  yazmaHatasi: string | null
  /** Kutuya yazmaya başlandı — seansın yazma hatasını temizle. */
  onYazmaHatasiTemizle: () => void
}

type Props = EtiketBaglami & {
  /**
   * `id`/`list` öneklerini ayırmak için (ör. `takvim-12`, `dosya-12`): aynı
   * sayfada iki satır olmasa da aynı `datalist` kimliği iki kez
   * basılmamalı.
   */
  kimlik: string
}

/**
 * Seansın etiket çipleri + ekleme kutusu (Plan 6 Görev 6).
 *
 * # Mount'ta state tutar: çağıran `key` VERMEK ZORUNDA
 *
 * Kutudaki yazı (`metin`) ve doğrulama hatası (`hata`) bu bileşenin yerel
 * state'i (sunucu hataları DEĞİL — onlar `yazmaHatasi` ile yukarıdan gelir).
 * Seçili seans değişip bileşen yeniden monte EDİLMEZSE önceki seansa yazılıp
 * gönderilmemiş metin ve onun hatası YENİ seansın satırında kalır — Enter
 * ona basıldığında etiket yanlış seansa gider. Takvimde seans paneli zaten
 * seans kimliğiyle `key`li; danışan dosyasında (`DanisanDosyasi`, seçim
 * değişince yeniden monte OLMUYOR) bu satır kendi `key`iyle çizilir.
 * Ölçen test: `DanisanDosyasi.test.tsx` > "seans değişince etiket
 * kutusundaki yazı ve hata kalmaz".
 *
 * # Özel notlar etiket ALMAZ
 *
 * Bu bileşen yalnızca resmî notun yanında çizilir (`SeansPaneli`'nin "Seans
 * Notu" sekmesi, dosyanın not alanı). Etiket, sunucuda randevuya bağlı ve
 * danışan veri raporuna girer; "Özel Notlarım" sekmesinde görünmesi onu özel
 * notun bir parçası sanmaya yol açardı.
 *
 * # Ad yalnızca React METNİ olarak basılır
 *
 * Etiket adı serbest metin (`<b>`, `<script>` içerebilir) ve her yerde JSX
 * çocuğu olarak yazılır; HTML olarak yorumlanmaz (bkz. `not/markdown.test.
 * tsx`'teki yapısal tarama).
 *
 * # Doğrulama
 *
 * Boş (yalnızca boşluk) giriş Enter'da sessizce yok sayılır. 40 karakteri
 * aşan ad istek ATILMADAN reddedilir: sunucu da 400 döner, ama o hata
 * mesajı bilerek adı yankılamıyor ve Türkçe karakter taşımıyor; kullanıcıya
 * ne yapması gerektiğini söyleyen mesaj burada. Karakter sayımı sunucuyla
 * aynı (`etiketAdiUzunlugu`, kod noktası).
 */
export function EtiketSatiri({
  kimlik,
  etiketler,
  hata: yuklemeHatasi,
  onYenidenDene,
  sozluk,
  onSozlukIste,
  onEkle,
  onKaldir,
  onEtiketAc,
  yazmaHatasi,
  onYazmaHatasiTemizle,
}: Props) {
  const [metin, setMetin] = useState('')
  const [hata, setHata] = useState<string | null>(null)
  const [mesgul, setMesgul] = useState(false)

  const girisId = `etiket-giris-${kimlik}`
  const oneriId = `etiket-onerileri-${kimlik}`

  async function ekle() {
    // Çift Enter aynı adı iki kez göndermesin. Kutu `disabled` YAPILMIYOR:
    // odak kaybolur ve terapist bir sonraki etiketi yazmak için yeniden
    // tıklamak zorunda kalırdı.
    if (mesgul) return
    const ad = etiketAdiNormallestir(metin)
    if (ad === '') return
    if (etiketAdiUzunlugu(ad) > ETIKET_AZAMI_KARAKTER) {
      setHata(`Etiket adı en fazla ${ETIKET_AZAMI_KARAKTER} karakter olabilir.`)
      return
    }
    setMesgul(true)
    setHata(null)
    try {
      await onEkle(ad)
      setMetin('')
    } catch {
      // Mesaj `yazmaHatasi` ile yukarıdan gelir (bkz. prop); yazılan ad
      // kutuda kalır ki terapist düzeltip yeniden deneyebilsin.
    } finally {
      setMesgul(false)
    }
  }

  async function kaldir(etiket: Etiket) {
    setHata(null)
    try {
      await onKaldir(etiket)
    } catch {
      // Mesaj `yazmaHatasi` ile yukarıdan gelir.
    }
  }

  const gorunenHata = hata ?? yazmaHatasi

  if (yuklemeHatasi !== null) {
    return (
      <div role="alert" className="mt-3 rounded border border-red-300 bg-red-50 p-2">
        <p className="text-sm text-red-800">Etiketler yüklenemedi. {yuklemeHatasi}</p>
        <button
          type="button"
          className="mt-1 rounded border border-red-300 px-2 py-1 text-sm"
          onClick={onYenidenDene}
        >
          Yeniden dene
        </button>
      </div>
    )
  }

  if (etiketler === null) {
    return <p className="mt-3 text-sm text-slate-500">Etiketler yükleniyor…</p>
  }

  const oneriler = (sozluk ?? []).filter((s) => !etiketler.some((e) => ayniEtiket(e, s)))

  return (
    <div className="mt-3" data-testid="etiket-satiri">
      <div className="flex flex-wrap items-center gap-2">
        <ul aria-label="Seansın etiketleri" className="flex flex-wrap gap-1">
          {etiketler.map((e) => (
            <li
              key={e.id}
              className="flex items-center rounded-full border border-sky-300 bg-sky-50 text-sm text-sky-900"
            >
              <button
                type="button"
                className="px-2 py-0.5"
                aria-label={`${e.ad} etiketli seansları göster`}
                onClick={() => onEtiketAc(e)}
              >
                {e.ad}
              </button>
              <button
                type="button"
                className="rounded-full px-1.5 py-0.5 text-sky-700 hover:bg-sky-100"
                aria-label={`${e.ad} etiketini kaldır`}
                onClick={() => void kaldir(e)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <label htmlFor={girisId} className="sr-only">
          Etiket ekle
        </label>
        <input
          id={girisId}
          type="text"
          list={oneriId}
          value={metin}
          aria-busy={mesgul}
          placeholder="Etiket ekle…"
          className="w-40 rounded border border-slate-300 px-2 py-0.5 text-sm"
          onFocus={onSozlukIste}
          onChange={(olay) => {
            setMetin(olay.target.value)
            setHata(null)
            if (yazmaHatasi !== null) onYazmaHatasiTemizle()
          }}
          onKeyDown={(olay) => {
            // IME birleştirmesi sürerken Enter bir harfi onaylar, etiketi
            // değil.
            if (olay.key !== 'Enter' || olay.nativeEvent.isComposing) return
            olay.preventDefault()
            void ekle()
          }}
        />
        <datalist id={oneriId}>
          {oneriler.map((e) => (
            <option key={e.id} value={e.ad} />
          ))}
        </datalist>
      </div>
      {gorunenHata !== null && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {gorunenHata}
        </p>
      )}
    </div>
  )
}
