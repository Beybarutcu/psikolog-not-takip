import { useEffect, useRef, useState } from 'react'
import { danisanApi, notApi, YetkisizHata, type DanisanSeansi, type NotAramaSonucu, type SeansNotu } from '../api'
import { NotOkuma } from '../not/NotOkuma'
import { ASGARI_VURGU, katla, vurguParcalari } from '../not/vurgu'
import { DurumSimgeleri } from '../takvim/DurumSimgeleri'
import { durumSimgeMetni, type DurumAlanlari } from '../takvim/durumSimgesi'
import { zamanMetni } from '../tarih'
import { okumaPenceresiniAc } from './okumaPenceresi'

/**
 * Önceki notlar paneli (tasarım §7 N5-N9) — not sayfasının sağ sütunu.
 *
 * - Liste (N5): danışanın BU seanstan önceki seansları, yeniden eskiye.
 *   Kaynak `DanisanSeansi` kayıtları (aşağıda "Liste kaynağı"). Kesme
 *   istemcide ve KESİN küçük: bu seansın kendisi ve sonrakiler listede yok;
 *   seans taşınınca liste yeniden İSTENMEZ, yeni başlangıçla süzülür.
 * - Arama (N6): gecikmeli, yalnızca bu danışanın RESMÎ notlarında,
 *   `duz_metin` üzerinde Türkçe harf duyarsız (sunucu, `notApi.notAra`).
 *   İki harften kısa terim istek atmaz. Terim hiçbir yere yazılmaz.
 * - Geniş okuma (N7): tek tık sütunu yarıya büyütür (`onGenislikDegisti`),
 *   notu editörle aynı tipografiyle salt okunur gösterir, aranan terimi
 *   vurgular ve ilkine kaydırır. Not YALNIZCA açılınca istenir; notu
 *   yazılmamış seans için hiç istenmez (bakılmayan bir şey için silinemez
 *   görüntüleme satırı yok).
 * - Seansa geçiş (N8): açık satırın tarihine ikinci tık ya da "Bu seansa
 *   git" (`takvim.randevuyaGit`).
 * - Yeni pencere (N9): satıra ya da "Bu seansa git"e sağ tık menüsü "Yeni
 *   pencerede aç", ya da Cmd/Ctrl+tık. Menü de Ctrl+tık da seçim YAPMAZ ve
 *   not İSTEMEZ (okuma penceresi notu kendisi ister).
 *
 * Özel not bu panele HİÇBİR yoldan giremez: yalnızca resmî not uçları.
 *
 * # Liste kaynağı: önce danışan dosyasının önbelleği (preflight F7)
 *
 * Her `/seanslar` okuması sunucuda silinemez bir `Goruntuleme |
 * danisan_seanslari` satırıdır. Danışan dosyası AYNI danışan için taze bir
 * liste tutuyorsa (`useDanisanSeanslari`, tek yazma yolundan yamanıyor)
 * `onbellek` o listedir ve panel İSTEK ATMAZ. Önbellek yoksa (dosya kapalı,
 * başka danışan, liste bayat ya da hatalı) panel TEK istek atar; önbellek
 * sonradan kalkarsa (ör. bu sayfadan "Güncelle" dosyanın listesini bayat
 * sayar) yine tek istek.
 *
 * # Geç dönen not yanıtı
 *
 * Not isteği açık seansın kimliğiyle karşılaştırılarak yazılır (`acikIdRef`):
 * A açılıp listeye dönülüp B açılırsa ve A'nın yanıtı B'ninkinden SONRA
 * gelirse, ekranda B'nin tarihi altında A'nın metni durmaz.
 */
export const ARAMA_GECIKMESI_MS = 300

type Props = {
  danisanId: number
  seansId: number
  seansBaslangici: string
  onSeansaGit: (id: number, baslangic: string) => void
  onGenislikDegisti: (genis: boolean) => void
  /**
   * Danışan dosyasının BU danışan için yüklü, taze seans listesi; yoksa
   * `null` (bkz. modül başlığı "Liste kaynağı").
   */
  onbellek?: DanisanSeansi[] | null
}

type Satir = { id: number; baslangic: string; parca: string | null; seans: DanisanSeansi | undefined }
type AcikNot = { id: number; not: SeansNotu } | { id: number; hata: string }
type KendiListesi = { id: number; liste: DanisanSeansi[] } | { id: number; hata: string }

function alanlar(s: DanisanSeansi): DurumAlanlari {
  return { durum: s.durum, odendi: s.odendi, ucret: s.ucret_kurus }
}

/** `null` = not hiç yazılmamış, `''` = açılmış ama boş (`SeansListesi` ile aynı ayrım, preflight F19). */
function notOnizlemesi(satir: string | null): string {
  if (satir === null) return 'Not yazılmamış'
  if (satir === '') return 'Not açıldı, henüz boş'
  return satir
}

export function OncekiNotlar({
  danisanId, seansId, seansBaslangici, onSeansaGit, onGenislikDegisti, onbellek = null,
}: Props) {
  const [kendiListesi, setKendiListesi] = useState<KendiListesi | null>(null)
  const [terim, setTerim] = useState('')
  const [arama, setArama] = useState<{ terim: string; sonuclar: NotAramaSonucu[] } | null>(null)
  const [aramaHatasi, setAramaHatasi] = useState<{ terim: string; mesaj: string } | null>(null)
  const [acik, setAcik] = useState<{ id: number; baslangic: string } | null>(null)
  const [acikNot, setAcikNot] = useState<AcikNot | null>(null)
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  // Yanıt yazılırken karşılaştırılan açık seans (bkz. "Geç dönen not yanıtı").
  const acikIdRef = useRef<number | null>(null)
  // Menüyü açan düğme: Escape odağı ona geri verir.
  const menuAcanRef = useRef<HTMLElement | null>(null)

  const onbellekYok = onbellek === null
  useEffect(() => {
    if (!onbellekYok) return
    let iptal = false
    danisanApi.seanslar(danisanId).then(
      (liste) => {
        if (!iptal) setKendiListesi({ id: danisanId, liste })
      },
      (e: unknown) => {
        if (iptal || e instanceof YetkisizHata) return
        setKendiListesi({ id: danisanId, hata: e instanceof Error ? e.message : 'Önceki seanslar yüklenemedi.' })
      },
    )
    return () => {
      iptal = true
    }
  }, [danisanId, onbellekYok])

  const kirpilmis = terim.trim()
  const aramaEtkin = katla(kirpilmis).length >= ASGARI_VURGU
  useEffect(() => {
    if (!aramaEtkin) return
    let iptal = false
    const zamanlayici = setTimeout(() => {
      notApi.notAra(danisanId, kirpilmis, seansBaslangici).then(
        (sonuclar) => {
          if (!iptal) setArama({ terim: kirpilmis, sonuclar })
        },
        (e: unknown) => {
          if (iptal || e instanceof YetkisizHata) return
          setAramaHatasi({ terim: kirpilmis, mesaj: e instanceof Error ? e.message : 'Arama yapılamadı.' })
        },
      )
    }, ARAMA_GECIKMESI_MS)
    return () => {
      iptal = true
      clearTimeout(zamanlayici)
    }
  }, [aramaEtkin, kirpilmis, danisanId, seansBaslangici])

  useEffect(() => {
    if (menu === null) return
    const kapat = () => setMenu(null)
    const tus = (olay: KeyboardEvent) => {
      if (olay.key !== 'Escape') return
      setMenu(null)
      menuAcanRef.current?.focus()
    }
    document.addEventListener('mousedown', kapat)
    document.addEventListener('keydown', tus)
    return () => {
      document.removeEventListener('mousedown', kapat)
      document.removeEventListener('keydown', tus)
    }
  }, [menu])

  const kendi = kendiListesi?.id === danisanId ? kendiListesi : null
  const seanslar = onbellek ?? (kendi !== null && 'liste' in kendi ? kendi.liste : null)
  const listeHatasi = onbellek === null && kendi !== null && 'hata' in kendi ? kendi.hata : null
  const seansBul = (id: number) => seanslar?.find((s) => s.appointment_id === id)
  const gecerliArama = aramaEtkin && arama?.terim === kirpilmis ? arama : null
  const gecerliHata = aramaEtkin && aramaHatasi?.terim === kirpilmis ? aramaHatasi.mesaj : null
  const oncekiler = (seanslar ?? []).filter((s) => s.baslangic < seansBaslangici && s.appointment_id !== seansId)
  const satirlar: Satir[] = aramaEtkin
    ? (gecerliArama?.sonuclar ?? []).map((s) => ({
        id: s.appointment_id, baslangic: s.seans_zamani, parca: s.parca, seans: seansBul(s.appointment_id),
      }))
    : oncekiler.map((s) => ({ id: s.appointment_id, baslangic: s.baslangic, parca: null, seans: s }))

  function yeniPencere(id: number) {
    setMenu(null)
    okumaPenceresiniAc(id)
  }

  function menuAc(olay: React.MouseEvent<HTMLElement>, id: number) {
    olay.preventDefault()
    menuAcanRef.current = olay.currentTarget
    // Klavyeden (Menü tuşu, Shift+F10) açılınca tıklama konumu yok: menü
    // düğmenin altına.
    const kutu = olay.currentTarget.getBoundingClientRect()
    setMenu({ id, x: olay.clientX || kutu.left, y: olay.clientY || kutu.bottom })
  }

  function satiriAc(olay: React.MouseEvent, s: { id: number; baslangic: string; seans: DanisanSeansi | undefined }) {
    if (olay.metaKey || olay.ctrlKey) {
      olay.preventDefault()
      yeniPencere(s.id)
      return
    }
    setMenu(null)
    if (acik?.id === s.id) {
      onSeansaGit(s.id, s.baslangic)
      return
    }
    acikIdRef.current = s.id
    setAcik({ id: s.id, baslangic: s.baslangic })
    onGenislikDegisti(true)
    setAcikNot(null)
    // Notu yazılmamış seans: istek YOK (bakılmayan not için görüntüleme satırı olmaz).
    if (s.seans !== undefined && s.seans.not_ilk_satiri === null) return
    notApi.notGetir(s.id).then(
      (not) => {
        if (acikIdRef.current === s.id) setAcikNot({ id: s.id, not })
      },
      (e: unknown) => {
        if (acikIdRef.current !== s.id || e instanceof YetkisizHata) return
        setAcikNot({ id: s.id, hata: e instanceof Error ? e.message : 'Not yüklenemedi.' })
      },
    )
  }

  function listeyeDon() {
    acikIdRef.current = null
    setAcik(null)
    setAcikNot(null)
    onGenislikDegisti(false)
  }

  const menuOgesi = menu !== null && (
    <div
      role="menu"
      aria-label="Seans seçenekleri"
      className="fixed z-30 rounded border border-slate-300 bg-white py-1 text-sm shadow"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(olay) => olay.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        // Menü kullanıcının kendi açtığı bir öğe: klavyeyle açılınca Enter
        // hemen çalışsın (randevuya tıklamanın odak kuralıyla ilgisi yok).
        autoFocus
        className="block w-full px-3 py-1 text-left hover:bg-slate-100"
        onClick={() => yeniPencere(menu.id)}
      >
        Yeni pencerede aç
      </button>
    </div>
  )

  if (acik !== null) {
    const seans = seansBul(acik.id)
    const gosterilen = acikNot?.id === acik.id ? acikNot : null
    return (
      <section aria-labelledby="onceki-notlar-basligi" className="flex max-h-[calc(100vh-8rem)] flex-col">
        <h3 id="onceki-notlar-basligi" className="sr-only">Önceki seans notları</h3>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2 text-sm">
          <button type="button" className="underline" onClick={listeyeDon}>
            <span aria-hidden="true">← </span>Listeye dön
          </button>
          <button type="button" className="font-medium" onClick={(olay) => satiriAc(olay, { id: acik.id, baslangic: acik.baslangic, seans })}>
            {zamanMetni(acik.baslangic)}
          </button>
          {seans !== undefined && (
            <>
              <DurumSimgeleri randevu={alanlar(seans)} />
              <span className="sr-only">{durumSimgeMetni(alanlar(seans))}</span>
            </>
          )}
          <button
            type="button"
            className="ml-auto rounded border px-2 py-0.5"
            onClick={(olay) => {
              if (olay.metaKey || olay.ctrlKey) {
                olay.preventDefault()
                yeniPencere(acik.id)
              } else onSeansaGit(acik.id, acik.baslangic)
            }}
            onContextMenu={(olay) => menuAc(olay, acik.id)}
          >
            Bu seansa git
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto pt-2">
          {seans?.not_ilk_satiri === null ? (
            <p className="text-sm text-slate-600">Bu seans için not yazılmamış.</p>
          ) : gosterilen === null ? (
            <p className="text-sm text-slate-600">Not yükleniyor…</p>
          ) : 'hata' in gosterilen ? (
            <p role="alert" className="text-sm text-red-800">Not yüklenemedi. {gosterilen.hata}</p>
          ) : gosterilen.not.icerik === '' ? (
            <p className="text-sm text-slate-600">
              {gosterilen.not.onizleme === null ? 'Bu seans için not yazılmamış.' : 'Not açıldı, henüz boş.'}
            </p>
          ) : (
            // `key`: başka notun görünümü bu düğümde yeniden kurulur (vurgu ve
            // kaydırma yeni notla başlar).
            <NotOkuma key={acik.id} html={gosterilen.not.icerik} vurgu={aramaEtkin ? kirpilmis : ''} />
          )}
        </div>
        {menuOgesi}
      </section>
    )
  }

  return (
    <section aria-labelledby="onceki-notlar-basligi" className="flex max-h-[calc(100vh-8rem)] flex-col">
      <h3 id="onceki-notlar-basligi" className="text-sm font-semibold text-slate-700">Önceki seans notları</h3>
      <input
        type="search"
        aria-label="Önceki notlarda ara"
        placeholder="Önceki notlarda ara"
        className="mt-2 rounded border border-slate-300 px-2 py-1 text-sm"
        value={terim}
        onChange={(olay) => setTerim(olay.target.value)}
      />
      {listeHatasi !== null ? (
        <p role="alert" className="mt-2 text-sm text-red-800">Önceki seanslar yüklenemedi. {listeHatasi}</p>
      ) : seanslar === null ? (
        <p className="mt-2 text-sm text-slate-600">Yükleniyor…</p>
      ) : gecerliHata !== null ? (
        <p role="alert" className="mt-2 text-sm text-red-800">Arama yapılamadı. {gecerliHata}</p>
      ) : aramaEtkin && gecerliArama === null ? (
        <p className="mt-2 text-sm text-slate-600">Aranıyor…</p>
      ) : satirlar.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">
          {aramaEtkin ? 'Bu terim önceki notlarda geçmiyor.' : 'Bu seanstan önce kayıtlı seans yok.'}
        </p>
      ) : null}
      <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-auto">
        {satirlar.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className="w-full rounded border border-slate-200 px-2 py-1 text-left text-sm hover:bg-slate-50"
              onClick={(olay) => satiriAc(olay, s)}
              onContextMenu={(olay) => menuAc(olay, s.id)}
            >
              <span className="flex items-center gap-1">
                <span className="font-medium tabular-nums">{zamanMetni(s.baslangic)}</span>
                {s.seans !== undefined && (
                  <>
                    <DurumSimgeleri randevu={alanlar(s.seans)} />
                    <span className="sr-only">{durumSimgeMetni(alanlar(s.seans))}</span>
                  </>
                )}
              </span>
              <span className="block truncate text-slate-600">
                {s.parca !== null
                  ? vurguParcalari(s.parca, kirpilmis).map((p, i) => (p.vurgu ? <mark key={i}>{p.metin}</mark> : <span key={i}>{p.metin}</span>))
                  : notOnizlemesi(s.seans?.not_ilk_satiri ?? null)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {menuOgesi}
    </section>
  )
}
