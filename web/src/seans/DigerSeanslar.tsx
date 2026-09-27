import { useEffect, useRef, useState } from 'react'
import { danisanApi, notApi, YetkisizHata, type DanisanSeansi, type NotAramaSonucu, type SeansNotu } from '../api'
import { NotOkuma } from '../not/NotOkuma'
import { katla } from '../katla'
import { ASGARI_VURGU, vurguParcalari } from '../not/vurgu'
import { DurumSimgeleri } from '../takvim/DurumSimgeleri'
import { durumSimgeMetni, type DurumAlanlari } from '../takvim/durumSimgesi'
import { zamanMetni } from '../tarih'
import { okumaPenceresiniAc } from './okumaPenceresi'

/**
 * "Diğer seanslar" paneli (tasarım §7 N5-N9, 2026-09-27 değişikliği) — not
 * sayfasının sağ sütunu.
 *
 * - Liste (N5): danışanın açık seans DIŞINDAKİ bütün seansları, yeniden
 *   eskiye. Kullanıcı kararı (2026-09-27): eski bir seans açıkken sonraki
 *   seanslar da görünür. Açık seansın yerinde tıklanamayan bir "Bu seans ·
 *   <tarih-saat>" işareti durur: üstündekiler sonraki, altındakiler önceki
 *   seanslar. Kaynak `DanisanSeansi` kayıtları (aşağıda "Liste kaynağı").
 * - Gelecekteki (`baslangic > simdi`) NOTU YAZILMAMIŞ seans listelenmez:
 *   okunacak bir şey yok. Notu olan (açılmış-boş `''` dahil) gelecek seans
 *   listelenir. Sınır uygulamanın geri kalanıyla aynı: geçmiş = `baslangic
 *   <= simdi` (`danisan/dosyaOzeti.ts`, `seansGruplari.ts`); tam şimdi
 *   başlayan seans gelecek SAYILMAZ. `simdi` uygulamadaki TEK "şimdi"
 *   (`useDakikalikSimdi`, `TakvimSekmesi`'nden gelir); karşılaştırma 16
 *   karakterlik duvar saati dizgileriyle, `Date` YOK.
 * - İşaretin yeri (`sonrakiMi`): sunucunun sırası `baslangic DESC, id
 *   DESC` (`danisan_seanslari`, `SORGU_DANISAN_NOT`); açık seans da o sıraya
 *   KENDİ güncel başlangıcıyla (`seansBaslangici`) ve kimliğiyle yerleşir.
 *   Aynı dakikada başlayan başka bir seans, kimliği büyükse işaretin
 *   üstünde. Açık seans kimliğiyle elenir: seans taşınınca liste yeniden
 *   İSTENMEZ (listedeki kaydı ESKİ başlangıcı taşır), işaret yeni yerine
 *   geçer.
 * - Arama (N6): gecikmeli, yalnızca bu danışanın RESMÎ notlarında,
 *   `duz_metin` üzerinde Türkçe harf duyarsız (sunucu, `notApi.notAra`).
 *   Kesme (`once`) GÖNDERİLMEZ: sonraki seansların notları da aranır; açık
 *   seansın kendi notu sonuçlardan istemcide atılır. İki harften kısa terim
 *   istek atmaz. Terim hiçbir yere yazılmaz (yalnızca o sorgunun adresinde).
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
 * # Geç dönen not yanıtı — `acikIdRef` NEYİ DÜZELTİR
 *
 * Render zaten kimlik eşleşmesine bakar (`gosterilen = acikNot?.id ===
 * acik.id ? acikNot : null`): açık seans değişince yanlış notun yanlış
 * tarihin altında görünmesi bu satırla TEK BAŞINA engellenir. `acikIdRef`
 * bambaşka bir riski kapatır: A açılıp (istek başlar) listeye dönülüp B
 * açılırsa (B'nin kendi isteği gelir, notu GÖRÜNÜR), sonra A'nın GEÇ yanıtı
 * gelirse — bu kontrol OLMASAYDI geç yanıt `acikNot`'u A'ya çevirirdi ve
 * render B ile eşleşmediği için ekrandaki not sessizce "Not yükleniyor…"a
 * DÖNERDİ; B için yeni bir istek bir daha hiç atılmayacağı için bu dönüş
 * KALICI olurdu. `acikIdRef` yanıtı yalnızca hâlâ açık olan seansın
 * kimliğiyle eşleşiyorsa yazar; geç gelen yabancı yanıt sessizce atılır.
 */
export const ARAMA_GECIKMESI_MS = 300

type Props = {
  danisanId: number
  seansId: number
  seansBaslangici: string
  /** Uygulamadaki TEK "şimdi" (`useDakikalikSimdi`); notsuz gelecek seansların sınırı. */
  simdi: string
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

/**
 * Satır, sunucunun sırasında (`baslangic DESC, id DESC`) açık seansın
 * ÜSTÜNDE mi (bkz. modül başlığı "İşaretin yeri").
 */
function sonrakiMi(s: { id: number; baslangic: string }, acik: { id: number; baslangic: string }): boolean {
  return s.baslangic > acik.baslangic || (s.baslangic === acik.baslangic && s.id > acik.id)
}

/** Gelecekte ve notu hiç yazılmamış: okunacak bir şey yok, listelenmez. */
function notsuzGelecek(s: DanisanSeansi, simdi: string): boolean {
  return s.baslangic > simdi && s.not_ilk_satiri === null
}

export function DigerSeanslar({
  danisanId, seansId, seansBaslangici, simdi, onSeansaGit, onGenislikDegisti, onbellek = null,
}: Props) {
  const [kendiListesi, setKendiListesi] = useState<KendiListesi | null>(null)
  const [terim, setTerim] = useState('')
  const [arama, setArama] = useState<{ terim: string; sonuclar: NotAramaSonucu[] } | null>(null)
  const [aramaHatasi, setAramaHatasi] = useState<{ terim: string; mesaj: string } | null>(null)
  const [acik, setAcik] = useState<{ id: number; baslangic: string } | null>(null)
  const [acikNot, setAcikNot] = useState<AcikNot | null>(null)
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  // Yanıt yazılırken karşılaştırılan açık seans: geç gelen yabancı yanıt
  // açık notu "Not yükleniyor…"a GERİ DÖNDÜRMESİN diye (bkz. modül başlığı).
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
        setKendiListesi({ id: danisanId, hata: e instanceof Error ? e.message : 'Seanslar yüklenemedi.' })
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
      // Terimin SON aramasının sonucu geçerlidir: başarı eski hatayı, hata
      // eski sonucu kaldırır — yoksa "Arama yapılamadı." doğru sonuçların
      // yanında (ya da eski sonuçlar hatanın altında) kalırdı.
      // Kesme YOK: sonraki seansların notları da aranır (bkz. modül başlığı).
      notApi.notAra(danisanId, kirpilmis).then(
        (sonuclar) => {
          if (iptal) return
          setArama({ terim: kirpilmis, sonuclar })
          setAramaHatasi(null)
        },
        (e: unknown) => {
          if (iptal || e instanceof YetkisizHata) return
          setAramaHatasi({ terim: kirpilmis, mesaj: e instanceof Error ? e.message : 'Arama yapılamadı.' })
          setArama(null)
        },
      )
    }, ARAMA_GECIKMESI_MS)
    return () => {
      iptal = true
      clearTimeout(zamanlayici)
    }
  }, [aramaEtkin, kirpilmis, danisanId])

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
  // Açık seans kimliğiyle elenir (listede de aramada da): taşınan seansın
  // listedeki kaydı ESKİ başlangıcı taşır (bkz. modül başlığı).
  const digerleri = (seanslar ?? []).filter((s) => s.appointment_id !== seansId)
  const satirlar: Satir[] = aramaEtkin
    ? (gecerliArama?.sonuclar ?? [])
        .filter((s) => s.appointment_id !== seansId)
        .map((s) => ({
          id: s.appointment_id, baslangic: s.seans_zamani, parca: s.parca, seans: seansBul(s.appointment_id),
        }))
    : digerleri
        .filter((s) => !notsuzGelecek(s, simdi))
        .map((s) => ({ id: s.appointment_id, baslangic: s.baslangic, parca: null, seans: s }))
  // İşaret açık seansın yerinde: üstünde sonrakiler, altında öncekiler.
  // Gelen sıra korunur; bölme sıraya değil karşılaştırmaya dayanır.
  const buSeans = { id: seansId, baslangic: seansBaslangici }
  const sonrakiler = satirlar.filter((s) => sonrakiMi(s, buSeans))
  const oncekiler = satirlar.filter((s) => !sonrakiMi(s, buSeans))

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

  function satirOgesi(s: Satir) {
    return (
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
          {/* Tek satır: üç noktayla kısalır, tamamı `title`'da
              (`e2e/uzun-metin.spec.ts`). */}
          <span className="block truncate text-slate-600" title={s.parca ?? notOnizlemesi(s.seans?.not_ilk_satiri ?? null)}>
            {s.parca !== null
              ? vurguParcalari(s.parca, kirpilmis).map((p, i) => (p.vurgu ? <mark key={i}>{p.metin}</mark> : <span key={i}>{p.metin}</span>))
              : notOnizlemesi(s.seans?.not_ilk_satiri ?? null)}
          </span>
        </button>
      </li>
    )
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
      <section aria-labelledby="diger-seanslar-basligi" className="flex max-h-[calc(100vh-8rem)] flex-col">
        <h3 id="diger-seanslar-basligi" className="sr-only">Diğer seanslar</h3>
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
    <section aria-labelledby="diger-seanslar-basligi" className="flex max-h-[calc(100vh-8rem)] flex-col">
      <h3 id="diger-seanslar-basligi" className="text-sm font-semibold text-slate-700">Diğer seanslar</h3>
      <input
        type="search"
        aria-label="Diğer seanslarda ara"
        placeholder="Diğer seanslarda ara"
        className="mt-2 rounded border border-slate-300 px-2 py-1 text-sm"
        value={terim}
        onChange={(olay) => setTerim(olay.target.value)}
      />
      {listeHatasi !== null ? (
        <p role="alert" className="mt-2 text-sm text-red-800">Diğer seanslar yüklenemedi. {listeHatasi}</p>
      ) : seanslar === null ? (
        <p className="mt-2 text-sm text-slate-600">Yükleniyor…</p>
      ) : gecerliHata !== null ? (
        <p role="alert" className="mt-2 text-sm text-red-800">Arama yapılamadı. {gecerliHata}</p>
      ) : aramaEtkin && gecerliArama === null ? (
        <p className="mt-2 text-sm text-slate-600">Aranıyor…</p>
      ) : satirlar.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">
          {aramaEtkin
            ? 'Bu terim diğer seanslarda geçmiyor.'
            : digerleri.length === 0
              ? 'Bu danışanın başka seansı yok.'
              // Elenenlerin hepsi notsuz gelecek seans: "başka seansı yok"
              // demek o seanslar varken yanlış olurdu.
              : 'Başka geçmiş seans yok; ileri tarihli seansların notu henüz yazılmamış.'}
        </p>
      ) : null}
      <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-auto">
        {sonrakiler.map(satirOgesi)}
        {satirlar.length > 0 && (
          // Açık seansın yeri: düğme DEĞİL, açılmaz, istek atmaz. Ekran
          // okuyucu listede "geçerli öğe" olarak okur.
          <li
            aria-current="true"
            className="rounded border border-dashed border-slate-400 bg-slate-100 px-2 py-1 text-sm font-medium text-slate-700"
          >
            Bu seans <span aria-hidden="true">·</span> {zamanMetni(seansBaslangici)}
          </li>
        )}
        {oncekiler.map(satirOgesi)}
      </ul>
      {menuOgesi}
    </section>
  )
}
