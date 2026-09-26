import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect } from 'react'
import { notUzantilari } from './uzantilar'
import './stiller'

/**
 * Salt okunur not görünümü (tasarım S7, E12): önceki notlar paneli, okuma
 * penceresi ve geçmiş listesi. Saklanan HTML DOM'a doğrudan BASILMAZ —
 * editörle aynı uzantılarla kurulmuş `editable: false` bir TipTap örneği;
 * şemada olmayan her şey ayrıştırmada düşer. `vurgu` verilirse bütün
 * eşleşmeler işaretlenir ve ilki ekranın ortasına getirilir (N7). Bu
 * bileşen HİÇBİR yazma yapmaz.
 */
export function NotOkuma({ html, vurgu = '' }: { html: string; vurgu?: string }) {
  const editor = useEditor(
    {
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      extensions: notUzantilari({ duzenlenebilir: false }),
      content: html,
      editable: false,
      // `role: 'document'` (preflight F2): TipTap her editöre `role="textbox"`
      // koyar; salt okunur görünüm ekran okuyucuya yazılabilir alan diye
      // duyurulmamalı (okuma penceresi ve e2e `queryByRole('textbox')` ile
      // buna dayanır). `aria-readonly` `document` rolünde geçerli değil.
      editorProps: { attributes: { class: 'not-yuzeyi not-okuma', role: 'document' } },
    },
    [html],
  )

  useEffect(() => {
    if (editor === null) return
    editor.commands.vurguAyarla(vurgu)
    if (vurgu.trim() === '') return
    editor.view.dom.querySelector('.not-vurgu')?.scrollIntoView({ block: 'center' })
  }, [editor, vurgu])

  return <EditorContent editor={editor} />
}
