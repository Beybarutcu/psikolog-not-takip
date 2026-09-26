import { EditorContent, EditorContext, useEditor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
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

  return (
    <EditorContext.Provider value={{ editor }}>
      {/* `flex-1` + yüzey kabının `flex-1`i + `.not-editoru .ProseMirror`'un
          `flex` kuralı (not-yuzeyi.scss): çağıranın verdiği yükseklik yazı
          yüzeyine kadar iner (bkz. `NotEditoru` kökü). */}
      <div className="not-editoru relative flex flex-1 flex-col rounded border border-slate-300 bg-white">
        {editable && <AracCubugu bulAcik={bulAcik} onBulDegistir={() => setBulAcik((a) => !a)} />}
        {editable && (
          // Yüksekliksiz çapa, araç çubuğunun HEMEN altında: çubuk dar
          // sütunda iki-üç satıra kırıldığında (bkz. `AracCubugu`) panel
          // sabit bir yükseklikten açılsaydı alttaki satırları ve "Bul ve
          // değiştir"in kendisini örterdi.
          <div className="relative">
            <SearchAndReplace
              className="not-bul-paneli"
              open={bulAcik}
              onOpen={() => setBulAcik(true)}
              onClose={() => setBulAcik(false)}
              scrollIntoViewOptions={{ block: 'center' }}
            />
          </div>
        )}
        <EditorContent editor={editor} role="presentation" className="flex flex-1 flex-col" />
      </div>
    </EditorContext.Provider>
  )
}
