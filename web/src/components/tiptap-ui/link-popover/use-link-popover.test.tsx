import { act, renderHook } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { notUzantilari } from '@/not/uzantilar'
import { useLinkHandler } from './use-link-popover'

// Bağlantı penceresinin "uygula" yolu GERÇEK TipTap'la ve uygulamanın
// kendi şemasıyla (`notUzantilari`): şemasız adres sessizce REDDEDİLMEZ
// (dal sonu incelemesi M2), izinsiz şema ne bağlantı ne metin olur.
let acik: Editor | null = null
afterEach(() => {
  acik?.destroy()
  acik = null
})

function kur(html: string) {
  acik?.destroy()
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: notUzantilari({ duzenlenebilir: true }),
    content: html,
  })
  acik = editor
  const kanca = renderHook(() => useLinkHandler({ editor }))
  return { editor, kanca }
}

function uygula(kanca: ReturnType<typeof kur>['kanca'], adres: string) {
  act(() => kanca.result.current.setUrl(adres))
  act(() => kanca.result.current.setLink())
}

describe('useLinkHandler.setLink (gerçek TipTap)', () => {
  it('seçili metne yazılan şemasız adres https:// ile bağlantı olur', () => {
    const { editor, kanca } = kur('<p>Kaynak makale burada</p>')
    // "makale" seçili (1 = paragrafın başı).
    act(() => { editor.commands.setTextSelection({ from: 8, to: 14 }) })
    expect(editor.state.doc.textBetween(8, 14)).toBe('makale')
    uygula(kanca, 'www.ornek.com')
    const a = editor.view.dom.querySelector('a')
    expect(a?.getAttribute('href')).toBe('https://www.ornek.com')
    expect(a?.textContent).toBe('makale')
    expect(a?.getAttribute('target')).toBe('_blank')
  })

  it('seçim yokken yazılan e-posta, görünen metni kendisi olan bir mailto: bağlantısı olarak eklenir', () => {
    const { editor, kanca } = kur('<p>Yaz: </p>')
    act(() => { editor.commands.focus('end') })
    uygula(kanca, 'ad@ornek.com')
    const a = editor.view.dom.querySelector('a')
    expect(a?.getAttribute('href')).toBe('mailto:ad@ornek.com')
    expect(a?.textContent).toBe('ad@ornek.com')
  })

  it('izinsiz şema: bağlantı olmaz ve (seçim yokken) adres metin olarak da EKLENMEZ', () => {
    for (const adres of ['javascript:alert(1)', 'file:///etc/passwd']) {
      const { editor, kanca } = kur('<p>Kaynak makale</p>')
      act(() => { editor.commands.setTextSelection({ from: 8, to: 14 }) })
      const once = editor.getHTML()
      uygula(kanca, adres)
      expect(editor.getHTML(), adres).toBe(once)

      act(() => { editor.commands.focus('end') })
      uygula(kanca, adres)
      expect(editor.getHTML(), adres).toBe(once)
      expect(editor.getText(), adres).not.toContain(adres)
    }
  })
})
