import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AramaSonucu, AramaYaniti } from '../api'

/**
 * Hızlı arama (Ctrl+K / Cmd+K): danışan adı ve **resmî** seans notu içeriği.
 *
 * # Ekranda not içeriği var — bu yüzden kapanınca hiçbir şey kalmaz
 *
 * Sonuçlar not içeriğinden parça (`parca`) taşıyor ve bu ekran tam da seans
 * sırasında, danışanın karşısında kullanılır. Kapatma (Escape ya da düğme)
 * yalnızca katmanı gizlemez: sorgu ve sonuç listesi **state'ten silinir**.
 * Gizlenmiş ama duran bir liste, katman bir sonraki açılışta eski danışanın
 * notunu yeni danışanın önünde gösterirdi.
 *
 * Özel notların buraya hiç gelmemesi arayüzün kararı değil: sunucudaki
 * `store::search` `private_notes` tablosunu hiç tanımıyor (ne `JOIN`, ne
 * `UNION`, ne dışlayıcı `WHERE`). Bu bileşenin de `ara` prop'undan başka
 * veri kaynağı yoktur.
 *
 * # Arama terimi hiçbir yere yazılmaz
 *
 * Sunucu tarafında sorgu metni, sonuç sayısı ve eşleşen danışan kimlikleri
 * `audit_log`'a **yazılmıyor** (satırlar silinemez olduğu için oraya düşen
 * bir terim kalıcı olurdu). Arayüz de aynı kurala uyar: sorgu ve sonuç
 * parçaları `console`'a düşmez.
 *
 * # "Daha fazla sonuç var" işareti artık SUNUCUDAN geliyor
 *
 * `GET /api/ara` yanıtı `kirpildi` alanını taşıyor ve bu bir tahmin değil,
 * ölçüm: sunucu her iki sorguyu da `LIMIT sinir + 1` ile çalıştırıp düşen
 * eşleşme olup olmadığına bakıyor.
 *
 * Eskiden bu bilgi arayüzde **sezgiyle** üretiliyordu ("sonuç sayısı ==
 * `ARAMA_SINIRI`") ve sezgi iki yönde de yanlıştı: tam 50 eşleşmede
 * (hiçbiri düşmemişken) uyarıyor, iki kipin bütçesi ayrı ayrı dolduğunda
 * uyarmayı kaçırıyordu. Bunu söylemeyen bir arayüzde terapist "bu kadarmış"
 * sanar ve var olan bir notu bulamadığını fark etmez.
 *
 * Gösterilen sonuç sayısı ekrana yazılır, hiçbir loga yazılmaz — sunucuda
 * da `kirpildi` `audit_log`'a girmez.
 */
type Props = {
  ara: (sorgu: string) => Promise<AramaYaniti>
  onDanisanSec: (clientId: number) => void
  /** `tarih` randevunun `baslangic`'i (`YYYY-AA-GGTSS:DD`) — çağıran taraf
   * hangi haftaya gideceğini ondan bilir. */
  onSeansSec: (appointmentId: number, tarih: string) => void
  /** Testlerde kısaltılır (`NotEditoru`'nun `gecikmeMs` deseni). */
  gecikmeMs?: number
}

/** Yazma durduktan sonra istek atılana kadar beklenen süre. */
export const GECIKME_MS = 250

/**
 * Katmanın içindeki odaklanabilir öğeler — **belge sırasında**.
 *
 * Görünürlük süzgeci YOK (`offsetParent`, `getBoundingClientRect`): jsdom
 * düzen hesaplamıyor ve öyle bir süzgeç testlerde listeyi boşaltıp odak
 * tuzağını sessizce etkisizleştirirdi (üçüncü biçim: "ortama bağlı
 * etkisizleşen test"). Katmanın içinde gizli bir odaklanabilir öğe zaten
 * yok; koşullu render edilenler DOM'da hiç bulunmuyor.
 */
function odaklanabilirler(kok: HTMLElement): HTMLElement[] {
  return Array.from(
    kok.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
}

/**
 * Aramanın çalışması için gereken en az karakter — sunucudaki
 * `ASGARI_SORGU` ile aynı. İstemcide de duruyor çünkü sunucu bu durumda
 * **boş liste** dönüyor (hata değil): kontrol yalnızca sunucuda olsaydı her
 * tek harfte gereksiz bir istek gider ve kullanıcı "sonuç yok" görürdü,
 * "yazmaya devam edin" değil.
 */
const ASGARI_SORGU = 2

/** `2026-09-07T10:00` -> `07.09.2026 10:00`. Parçalar olduğu gibi doğru;
 * `Date`'e çevrilmiyor (bkz. `hafta.ts::zamandanDate`). */
function zamanBicimle(zaman: string): string {
  const [tarih, saat] = zaman.split('T')
  const [yil, ay, gun] = (tarih ?? '').split('-')
  if (!yil || !ay || !gun) return zaman
  return saat ? `${gun}.${ay}.${yil} ${saat.slice(0, 5)}` : `${gun}.${ay}.${yil}`
}

export function HizliArama({ ara, onDanisanSec, onSeansSec, gecikmeMs = GECIKME_MS }: Props) {
  const [acik, setAcik] = useState(false)
  const [sorgu, setSorgu] = useState('')
  // Yanıt HANGİ SORGUYA ait olduğuyla birlikte tutuluyor ve ekrana giden
  // liste render sırasında türetiliyor (aşağıda). Çıplak bir `sonuclar`
  // dizisi, kullanıcı sorguyu değiştirdiği an ile yeni yanıt geldiği an
  // arasında ÖNCEKİ sorgunun not parçalarını gösterirdi — bu ekran seans
  // sırasında, danışanın karşısında açılıyor.
  const [yanit, setYanit] = useState<
    { sorgu: string; sonuclar: AramaSonucu[]; kirpildi: boolean } | null
  >(null)
  const [hataKaydi, setHataKaydi] = useState<{ sorgu: string; mesaj: string } | null>(null)
  const kutuRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const acButonRef = useRef<HTMLButtonElement>(null)
  // Katman açılmadan HEMEN ÖNCE odakta olan öğe. Kapanışta odak buraya
  // döner. Ctrl+K sayfanın herhangi bir yerinden basılabilir, dolayısıyla
  // "tetikleyen öğe" her zaman açma düğmesi değildir.
  const tetikleyiciRef = useRef<HTMLElement | null>(null)
  // Portal kabı. Katman `document.body`ye taşınıyor çünkü "arkadaki her
  // şeyi `inert` yap" ancak katman uygulama ağacının DIŞINDAYSA mümkün:
  // katman ağacın içindeyken kökü `inert` yapmak katmanı da atıl kılardı.
  const kapsayiciRef = useRef<HTMLDivElement | null>(null)
  if (kapsayiciRef.current === null) {
    kapsayiciRef.current = document.createElement('div')
  }
  // İlk render'da odak efekti ÇALIŞMAMALI: `acik` başlangıçta `false` ve
  // efekt koşulsuz çalışsaydı bileşen mount olur olmaz odağı kendi açma
  // düğmesine çekerdi.
  const ilkRenderRef = useRef(true)

  // Kapanış TEK yerde: sorgu ve yanıtlar birlikte silinir. İki ayrı çağrı
  // yeri olsaydı biri sonuçları temizlemeyi unutabilirdi.
  function kapat() {
    setAcik(false)
    setSorgu('')
    setYanit(null)
    setHataKaydi(null)
  }

  /** Katmanı açar ve odağın geri döneceği öğeyi yakalar. */
  function ac() {
    const etkin = document.activeElement
    tetikleyiciRef.current =
      etkin instanceof HTMLElement && etkin !== document.body ? etkin : null
    setAcik(true)
  }

  useEffect(() => {
    function tus(olay: KeyboardEvent) {
      if ((olay.ctrlKey || olay.metaKey) && olay.key.toLowerCase() === 'k') {
        // Tarayıcının kendi kısayolunu (adres çubuğu araması) engelle.
        olay.preventDefault()
        ac()
        return
      }
      if (olay.key === 'Escape') kapat()
    }
    document.addEventListener('keydown', tus)
    return () => document.removeEventListener('keydown', tus)
  }, [])

  // (1) Portal kabını gövdeye TAK. `useLayoutEffect`: kap DOM'a girmeden
  //     yapılan bir boyama katmanı görünmez bırakırdı.
  useLayoutEffect(() => {
    const kap = kapsayiciRef.current
    if (kap === null || !acik) return
    document.body.appendChild(kap)
    return () => kap.remove()
  }, [acik])

  // (2) ARKADAKİ HER ŞEY `inert`. Bu, `aria-modal="true"` demenin bedeli:
  //     etiket "arkadaki her şey atıl" diye söz veriyor ve sözün gerçek
  //     olması gerekiyor (aksi hâlde ekran okuyucu kullanıcısı, gören bir
  //     kullanıcının kolayca fark ettiği içeriği hiç bulamaz).
  //
  //     Sıra önemli: bu efekt (1)'den SONRA bildiriliyor, yani kap zaten
  //     gövdenin bir çocuğu ve kendisi `inert` yapılmıyor. Temizlik de
  //     ters sırada değil, aynı sırada koşar; `inert` yalnızca BU efektin
  //     eklediği öğelerden kaldırılır (başkasının koyduğu bir `inert`
  //     sessizce silinmez).
  useLayoutEffect(() => {
    const kap = kapsayiciRef.current
    if (!acik) return
    const degistirilenler: HTMLElement[] = []
    for (const cocuk of Array.from(document.body.children)) {
      if (!(cocuk instanceof HTMLElement) || cocuk === kap) continue
      if (cocuk.hasAttribute('inert')) continue
      cocuk.setAttribute('inert', '')
      degistirilenler.push(cocuk)
    }
    return () => {
      for (const oge of degistirilenler) oge.removeAttribute('inert')
    }
  }, [acik])

  // (3) ODAK. Açılışta arama kutusuna, kapanışta tetikleyen öğeye.
  //     (2)'den SONRA bildirildiği için kapanışta `inert` çoktan
  //     kaldırılmış olur -- React bir commit'te önce TÜM temizlikleri,
  //     sonra tüm efekt gövdelerini koşar. Atıl bir öğeye `focus()`
  //     çağırmak gerçek tarayıcıda hiçbir şey yapmaz.
  useEffect(() => {
    if (ilkRenderRef.current) {
      ilkRenderRef.current = false
      return
    }
    if (acik) {
      kutuRef.current?.focus()
      return
    }
    const hedef = tetikleyiciRef.current ?? acButonRef.current
    tetikleyiciRef.current = null
    hedef?.focus()
  }, [acik])

  /**
   * ODAK TUZAĞI. Tab, katmanın son öğesinden ilkine (Shift+Tab tersine)
   * sarar; odak hiçbir zaman arkadaki -- artık `inert` olan -- içeriğe
   * geçmez.
   *
   * `inert` tek başına yeterli görünse de değildir: `inert` desteklemeyen
   * bir tarayıcıda (ya da katman gövdeye taşınamadığı bir durumda) tuzak
   * ikinci savunma hattı olur. Asıl yükü hangisinin taşıdığı ölçülebilir:
   * tuzak silinince `Tab odagi katmanin ICINDE tutar` testi kırılır.
   */
  function tabTuzagi(olay: React.KeyboardEvent<HTMLDivElement>) {
    if (olay.key !== 'Tab') return
    const panel = panelRef.current
    if (panel === null) return
    const ogeler = odaklanabilirler(panel)
    if (ogeler.length === 0) return
    const ilk = ogeler[0]
    const son = ogeler[ogeler.length - 1]
    const etkin = document.activeElement
    if (olay.shiftKey) {
      if (etkin === ilk || !panel.contains(etkin)) {
        olay.preventDefault()
        son.focus()
      }
      return
    }
    if (etkin === son || !panel.contains(etkin)) {
      olay.preventDefault()
      ilk.focus()
    }
  }

  const kirpilmis = sorgu.trim()

  // Ekrana giden liste ve hata, YALNIZCA o anki sorguya ait olduklarında
  // gösterilir. Sorgu kısaldığında (ya da tümüyle silindiğinde) eski
  // sonuçlar bir kare bile görünmez ve bunun için bir efektin çalışmasını
  // beklemek gerekmez.
  const gecerliYanit = yanit !== null && yanit.sorgu === kirpilmis ? yanit : null
  const sonuclar = gecerliYanit?.sonuclar ?? []
  // Uyarı da sonuçlarla AYNI türetmeden geçiyor: bayat bir yanıtın uyarısı
  // yeni sorgunun üstünde bir kare bile durmamalı.
  const sonucKirpildi = gecerliYanit?.kirpildi ?? false
  const hata = hataKaydi !== null && hataKaydi.sorgu === kirpilmis ? hataKaydi.mesaj : null
  // Sorgu yeterince uzun ama bu sorgu için henüz ne yanıt ne hata var.
  const bekleniyor =
    kirpilmis.length >= ASGARI_SORGU && yanit?.sorgu !== kirpilmis && hataKaydi?.sorgu !== kirpilmis

  useEffect(() => {
    // Kısa sorguda hiç istek ATILMAZ: sunucu da bu durumda boş liste
    // döndürüyor (hata değil), yani kontrol yalnızca orada olsaydı her tek
    // harf gereksiz bir gidiş-dönüş olurdu.
    if (!acik || kirpilmis.length < ASGARI_SORGU) return
    let iptal = false
    const zamanlayici = setTimeout(() => {
      void ara(kirpilmis)
        .then((gelen) => {
          if (iptal) return
          setYanit({ sorgu: kirpilmis, sonuclar: gelen.sonuclar, kirpildi: gelen.kirpildi })
        })
        .catch((e: unknown) => {
          if (iptal) return
          // Bayat sonuçlar gösterilmez: türetme zaten sorguya bağlı, hata
          // kaydı da aynı sorguya bağlanıyor.
          setHataKaydi({
            sorgu: kirpilmis,
            mesaj: e instanceof Error ? e.message : 'Arama yapılamadı.',
          })
        })
    }, gecikmeMs)
    return () => {
      iptal = true
      clearTimeout(zamanlayici)
    }
  }, [acik, kirpilmis, ara, gecikmeMs])

  const acmaDugmesi = (
    <button
      ref={acButonRef}
      type="button"
      className="rounded border px-3 py-1 text-sm"
      onClick={ac}
    >
      Hızlı arama (Ctrl+K)
    </button>
  )

  if (!acik) return acmaDugmesi

  const katman = (
    // Backdrop. Tıklamak katmanı kapatır (standart modal davranışı) ve
    // arkadaki içeriğin görsel olarak da devre dışı olduğunu söyler --
    // `inert` yalnızca yardımcı teknolojiye ve klavyeye görünür.
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-8"
      onMouseDown={(olay) => {
        if (olay.target === olay.currentTarget) kapat()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        // `aria-modal="true"` ARTIK DOĞRU. Eskiden bilerek yoktu: panel
        // satır içi bir `div`di, odak tuzağı, backdrop ve `inert` yoktu ve
        // etiket ekran okuyucu kullanıcısına yalan söylerdi. Bugün üçü de
        // var (bkz. yukarıdaki (1)-(3) efektleri ve `tabTuzagi`), yani
        // etiket gerçeği anlatıyor.
        aria-modal="true"
        aria-label="Hızlı arama"
        onKeyDown={tabTuzagi}
        className="w-full max-w-2xl rounded-lg border border-slate-300 bg-white p-3 shadow-xl"
      >
      <div className="flex items-center gap-2">
        <input
          ref={kutuRef}
          type="search"
          aria-label="Danışan adı veya not içeriği"
          placeholder="Danışan adı veya not içeriği…"
          className="flex-1 rounded border p-2 text-sm"
          value={sorgu}
          onChange={(e) => setSorgu(e.target.value)}
        />
        <button type="button" className="rounded border px-3 py-1 text-sm" onClick={kapat}>
          Aramayı kapat
        </button>
      </div>

      {kirpilmis.length > 0 && kirpilmis.length < ASGARI_SORGU && (
        <p className="mt-2 text-sm text-slate-600">Aramak için en az 2 karakter yazın.</p>
      )}

      {hata && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {hata}
        </p>
      )}

      {/* Sunucudan gelen ÖLÇÜLMÜŞ işaret: "olabilir" değil, "var". Metin
          kullanıcıya ne yapacağını da söylüyor -- kırpıldığını bilmek tek
          başına eşleşmeyi bulmasına yetmez. */}
      {sonucKirpildi && (
        <p className="mt-2 rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-900">
          {sonuclar.length} sonuç gösteriliyor; eşleşen başka kayıtlar da var. Aradığınızı
          kaçırmamak için aramayı daraltın (daha uzun bir sözcük ya da danışan adı yazın).
        </p>
      )}

      {/* Yanıt beklenirken "Sonuç bulunamadı." YAZILMAZ: türetilen liste
          yanıt gelene kadar boş ve o metin, henüz sorulmamış bir sorunun
          cevabı gibi görünürdü. */}
      {bekleniyor && <p className="mt-2 text-sm text-slate-600">Aranıyor…</p>}

      {!bekleniyor && kirpilmis.length >= ASGARI_SORGU && hata === null && sonuclar.length === 0 && (
        <p className="mt-2 text-sm text-slate-600">Sonuç bulunamadı.</p>
      )}

      {sonuclar.length > 0 && (
        <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto">
          {sonuclar.map((s) =>
            s.tur === 'not' && s.appointment_id !== null && s.tarih !== null ? (
              <li key={`not-${s.appointment_id}`}>
                <button
                  type="button"
                  className="w-full rounded border border-slate-200 p-2 text-left text-sm hover:bg-slate-50"
                  aria-label={`${s.danisan_adi} — ${zamanBicimle(s.tarih)} seansına git`}
                  onClick={() => {
                    // Önce kapat: sonuçlar (not parçaları) ekranda kalmasın.
                    const id = s.appointment_id as number
                    const tarih = s.tarih as string
                    kapat()
                    onSeansSec(id, tarih)
                  }}
                >
                  <span className="font-medium">{s.danisan_adi}</span>{' '}
                  <span className="text-slate-500">· {zamanBicimle(s.tarih)}</span>
                  <span className="block text-slate-600">{s.parca}</span>
                </button>
              </li>
            ) : (
              <li key={`danisan-${s.client_id}`}>
                <button
                  type="button"
                  className="w-full rounded border border-slate-200 p-2 text-left text-sm hover:bg-slate-50"
                  aria-label={`${s.danisan_adi} — danışan dosyasını aç`}
                  onClick={() => {
                    const id = s.client_id
                    kapat()
                    onDanisanSec(id)
                  }}
                >
                  <span className="font-medium">{s.danisan_adi}</span>{' '}
                  <span className="text-slate-500">· danışan dosyası</span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      </div>
    </div>
  )

  return (
    <>
      {/* Açma düğmesi katman AÇIKKEN de monte kalır: odağın geri döneceği
          öğe budur (Ctrl+K başka bir yerden basıldıysa yedek hat).
          Kapanışta unmount edilmiş bir düğmeye `focus()` çağrılamazdı. */}
      {acmaDugmesi}
      {createPortal(katman, kapsayiciRef.current)}
    </>
  )
}
