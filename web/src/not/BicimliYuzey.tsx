import { EditorContent, EditorContext, useEditor } from '@tiptap/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SearchAndReplace } from '@/components/tiptap-ui/search-and-replace'
import { AracCubugu } from './AracCubugu'
import { notUzantilari } from './uzantilar'
import './stiller'

/**
 * Biçimli not yüzeyi (tasarım E1-E4, E8, E10-E11): TipTap Simple Editor
 * şablonundan kurulu, HTML alır ve HTML bildirir.
 *
 * # Açılışta yazma yok (E8)
 *
 * TipTap yüklediği HTML'i kendi biçimine normalleştirir (`<b>` → `<strong>`,
 * `''` → `<p></p>`). Bu bir "değişiklik" değildir: `onChange` yalnızca
 * kullanıcı belgeyi değiştirdiğinde çağrılır ve belge dışarıdan gelen son
 * değerin NORMALLEŞMİŞ hâline dönünce (yaz-sil, geri al) o dış değerin HAM
 * dizgisiyle çağrılır. Böylece `NotEditoru`'nun "sunucudaki hâl" imzası
 * normalleşmeden etkilenmez; kullanıcı tek tuşa basmadan PUT ve silinemez
 * denetim satırı üretilmez.
 *
 * # Dışarıdan gelen değer
 *
 * `html` prop'u yalnızca başlangıç değeri değildir: şablon ekleme ve
 * `sunucuHali` benimseme onu değiştirir. Yeni değer bu yüzeyin son
 * bildirdiği değer ya da son dış değer DEĞİLSE içerik değiştirilir;
 * değişiklik `onChange` üretmez ve geri alma yığınına GİRMEZ (sunucudan
 * benimsenen hâlden Ctrl+Z ile eski metne dönüp onu PUT etmek, öbür ekranda
 * yazılanı silerdi).
 *
 * # Test yüzeyi
 *
 * Vitest'te bu modül `test-kurulum.ts`'te bir `<textarea>` ile değiştirilir
 * (tasarım §11); gerçek yüzey `BicimliYuzey.test.tsx`'te ve e2e'de sınanır.
 */
export type BicimliYuzeyProps = {
  html: string
  onChange?: (html: string) => void
  /** Erişilebilir ad: "Seans notu", "Özel notum" (hangi tabloya yazıldığını söyler). */
  etiket: string
  editable?: boolean
  /** Vurgulanacak terim (bkz. `not/vurgu.ts`); okuma görünümüyle aynı eklenti. */
  vurgu?: string
}

export function BicimliYuzey({ html, onChange, etiket, editable = true, vurgu = '' }: BicimliYuzeyProps) {
  const [bulAcik, setBulAcik] = useState(false)
  const bilinenDis = useRef<{ ham: string; normal: string | null }>({ ham: html, normal: null })
  const sonBildirilen = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    extensions: notUzantilari({ duzenlenebilir: editable }),
    content: html,
    editable,
    editorProps: {
      // İmleç yazı alanının kenarına 16 px'ten fazla yaklaşınca kaydırma
      // onu kenardan 16 px içeri alır (varsayılan: eşik 0, pay 5). Satır
      // yüksekliği 1.6 (25,6 px) ve imleç dikdörtgeni yazı tipi boyu kadar:
      // eşiksiz kaydırma (ör. Ctrl+End'in yerli kaydırması imleci kenara
      // hizalar) son satırın alt payını kabın dışında bırakıyordu (ölçüldü,
      // e2e "arac cubugu notu ortmez" (c)). Yazı alanı pencerenin içinde
      // olduğundan pencere bu eşik yüzünden kaymaz.
      scrollThreshold: 16,
      scrollMargin: 16,
      attributes: {
        role: 'textbox',
        'aria-label': etiket,
        'aria-multiline': 'true',
        ...(editable ? {} : { 'aria-readonly': 'true' }),
        class: 'not-yuzeyi',
      },
    },
    // `onCreate` KULLANILMAZ: TipTap `create` olayını `setTimeout(0)` ile
    // yayıyor; normalleşmiş ilk hâl o zamana kadar bilinmezse ilk tuş
    // vuruşları eşlemeyi kaçırırdı. Aşağıdaki efekt ilk boyamadan hemen
    // sonra (kullanıcı tek tuşa basmadan) okur.
    onUpdate: ({ editor: e }) => {
      const yeni = e.getHTML()
      const { ham, normal } = bilinenDis.current
      const bildirilecek = yeni === normal ? ham : yeni
      sonBildirilen.current = bildirilecek
      onChangeRef.current?.(bildirilecek)
    },
  })

  useEffect(() => {
    if (editor === null) return
    if (bilinenDis.current.normal === null) {
      bilinenDis.current = { ham: bilinenDis.current.ham, normal: editor.getHTML() }
    }
    // Son dış değerle eşitlik YALNIZCA yüzey o değerden beri hiçbir şey
    // bildirmediyse atlama sebebidir (ilk açılış, tekrar gelen aynı değer).
    // Yerel yazmadan sonra dış değer açılıştakine geri dönerse (sunucudaki
    // hâlin benimsenmesi) o da uygulanır (preflight F31, test 4.5b).
    if (html === sonBildirilen.current) return
    if (sonBildirilen.current === null && html === bilinenDis.current.ham) return
    editor.chain().setMeta('addToHistory', false).setContent(html, { emitUpdate: false }).run()
    bilinenDis.current = { ham: html, normal: editor.getHTML() }
    sonBildirilen.current = null
  }, [editor, html])

  useEffect(() => {
    editor?.setEditable(editable, false)
  }, [editor, editable])

  useEffect(() => {
    editor?.commands.vurguAyarla(vurgu)
  }, [editor, vurgu])

  // Bul paneli açıkken panelin yazı alanında örttüğü şeridin boyu (panelin
  // alt kenarı − yazı alanının üst kenarı) yazı alanında
  // `--bul-paneli-alti` değişkenine yazılır; `not-yuzeyi.scss` üst kaydırma
  // payını ondan kurar (bkz. aşağıdaki çapa). Ölçülür, sabit DEĞİL: panelin
  // boyu yazı tipine göre değişir (Windows/Chromium'da 221 px; macOS'ta
  // farklı olabilir) ve sabit bir pay (eski `scroll-pt-60`, 240 px) panelden
  // büyük olup görünen şeridi daraltıyordu (inceleme I1). Panel ile yazı
  // alanı birlikte kaydığından fark kaydırmayla değişmez; yalnızca panelin
  // boyu değişince yeniden ölçülür. Değişken DOM'a doğrudan yazılır:
  // `EditorContent`'e `style` verilmiyor, React onu ezmez; ölçüm yeniden
  // çizim gerektirmez.
  const panelRef = useRef<HTMLDivElement>(null)
  const yaziAlaniRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const panel = panelRef.current
    const alan = yaziAlaniRef.current
    if (!bulAcik || panel === null || alan === null) return
    const olc = () => {
      const alt = Math.ceil(panel.getBoundingClientRect().bottom - alan.getBoundingClientRect().top)
      if (alt > 0) alan.style.setProperty('--bul-paneli-alti', `${alt}px`)
    }
    olc()
    const gozcu = new ResizeObserver(olc)
    gozcu.observe(panel)
    return () => {
      gozcu.disconnect()
      alan.style.removeProperty('--bul-paneli-alti')
    }
  }, [bulAcik])

  return (
    <EditorContext.Provider value={{ editor }}>
      {/* # Araç çubuğu notu ÖRTMEZ: çubuk üstte, not kendi kabında kayar
          (kullanıcı isteği 2026-09-27)

          Eskiden yüzey içeriğiyle uzuyor ve SAYFA kayıyordu; şablonun
          araç çubuğu `position: sticky; top: 0` ve opak olduğu için dar
          sütunda iki-üç satıra kırılan (69–105 px) çubuk, kayan notun üst
          satırlarını örtüyordu; ProseMirror'un imleci gösteren kaydırması
          (en yakın kayan ata + pencere) imleci de onun altında
          bırakabiliyordu. Artık dikey esnek bir sütun:

          - araç çubuğu akışta (`position: static`, küçülmez —
            not-yuzeyi.scss), yazının ÜSTÜNDE, onunla çakışmaz;
          - yazı alanı (`EditorContent`) kendi kaydırma kabı:
            `flex-1 overflow-y-auto`, asgarisi 16rem (`min-h-64`, eskiden
            ProseMirror'daydı). ProseMirror kabı doldurur (`flex: 1 0
            auto`, boş notta tıklanan her yer yazı yüzeyi) ve uzun notta
            kabın içinde kayar; imleç kaydırması önce bu kabı kaydırır.

          # Notun uzunluğu yüzeyin boyunu belirlemez (`contain-size`)

          Yazı alanı boyut sınırlamalı: tarayıcı onun içerik boyunu 0
          sayar, boyu yalnızca asgarisinden (16rem) ve çağıranın verdiği
          esnek paydan gelir. Böylece zincirin hiçbir halkası (`NotEditoru`,
          `SeansPaneli`, not sayfası bölgesi, danışan dosyasının not
          sütunu) uzun notla uzamaz ve her halkanın esnek asgarisi
          "sabit satırlar + 16rem" olarak kalır. `min-h-0` ile yapılan
          ilk deneme ölçümde çakışma üretti: sınırlı sütun (danışan
          dosyası, 1024x680) asgarinin altına inince yazı alanı etiket
          satırının üstüne taşıyordu. Kısa pencerede ya da randevu formu
          açıkken zincir asgarisinde durur, sayfa kayar; hiçbir şey
          üst üste binmez. Ölçen test: `e2e/yerlesim.spec.ts` > "arac
          cubugu notu ortmez".

          # Kaydırma zinciri yazı alanında durur (`overscroll-contain`)

          Notun başında yukarı ya da sonunda aşağı tekerlek/dokunmatik
          kaydırma sayfaya geçmez (inceleme M5): not okunurken sayfa
          açılış konumundan (A6) kayıp durum ve etiket satırlarını
          ekrandan çıkarıyordu. Ölçen test: aynı e2e, adım (e). */}
      <div className="not-editoru relative flex flex-1 flex-col rounded border border-slate-300 bg-white">
        {editable && <AracCubugu bulAcik={bulAcik} onBulDegistir={() => setBulAcik((a) => !a)} />}
        {editable && (
          // Yüksekliksiz çapa, araç çubuğunun HEMEN altında: çubuk dar
          // sütunda iki-üç satıra kırıldığında (bkz. `AracCubugu`) panel
          // sabit bir yükseklikten açılsaydı alttaki satırları ve "Bul ve
          // değiştir"in kendisini örterdi.
          //
          // Eşleşmeye gitme `block: 'nearest'` (eskiden `center`):
          // `scrollIntoView` yazı alanıyla birlikte PENCEREYİ de kaydırır ve
          // `center` eşleşmeyi pencerenin ortasına almak için sayfayı
          // oynatıyordu (ölçüldü: 1200x760 not sayfasında 92 px yukarı; etiket
          // satırı ekrandan çıkıyordu). `nearest` eşleşme yazı alanının
          // içine girince durur; yazı alanı ekranda olduğundan pencere
          // kıpırdamaz. Kaydırılan eşleşmenin KENDİSİ, paragrafı değil
          // (`scrollCurrentResultIntoView`, inceleme I1).
          //
          // Panel yazı alanının sağ üstünü örter (304x221 px, ölçüldü): panel
          // açıkken (`not-bul-acik`) yazı alanının panelin altına kadarki
          // üst şeridi kaydırma hedefi sayılmaz, yani eşleşme panelin ALTINA
          // gelir. Pay panelin ÖLÇÜLEN alt kenarıdır (yukarıdaki efekt,
          // `--bul-paneli-alti`) ve yazı alanı çok kısaysa en az bir satırlık
          // şerit bırakacak kadar kısılır (`not-yuzeyi.scss`).
          <div className="relative">
            <SearchAndReplace
              ref={panelRef}
              className="not-bul-paneli"
              open={bulAcik}
              onOpen={() => setBulAcik(true)}
              onClose={() => setBulAcik(false)}
              scrollIntoViewOptions={{ block: 'nearest' }}
            />
          </div>
        )}
        <EditorContent
          ref={yaziAlaniRef}
          editor={editor}
          role="presentation"
          data-testid="not-yazi-alani"
          className={
            'not-yazi-alani flex min-h-64 flex-1 flex-col overflow-y-auto overscroll-contain contain-size' +
            (bulAcik ? ' not-bul-acik' : '')
          }
        />
      </div>
    </EditorContext.Provider>
  )
}
