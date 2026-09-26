import { act, render, screen, within } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { describe, expect, it, vi } from 'vitest'
import { BicimliYuzey } from './BicimliYuzey'

// GERÇEK TipTap: `test-kurulum.ts` bu modülü textarea test yüzeyiyle
// değiştiriyor; bu dosya asıl bileşeni geri alır.
vi.mock('./BicimliYuzey', async (importOriginal) => await importOriginal<typeof import('./BicimliYuzey')>())

function editorAl(): Editor {
  const pm = document.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null
  if (!pm?.editor) throw new Error('TipTap editörü bulunamadı')
  return pm.editor
}

describe('BicimliYuzey (gerçek TipTap)', () => {
  it('4.1 HTML içeriği yükler; etiket erişilebilir ad, yüzey düzenlenebilir', () => {
    render(<BicimliYuzey html="<p>Merhaba <strong>dünya</strong></p>" onChange={vi.fn()} etiket="Seans notu" />)
    const alan = screen.getByRole('textbox', { name: 'Seans notu' })
    expect(alan.querySelector('strong')?.textContent).toBe('dünya')
    expect(alan.getAttribute('contenteditable')).toBe('true')
    expect(alan.getAttribute('aria-multiline')).toBe('true')
  })

  it('4.2 araç çubuğu Türkçe, resim ve tema düğmesi yok', () => {
    render(<BicimliYuzey html="" onChange={vi.fn()} etiket="Seans notu" />)
    const cubuk = screen.getByRole('toolbar', { name: 'Biçim araçları' })
    for (const ad of ['Geri al', 'Yinele', 'Başlık biçimi', 'Liste seçenekleri', 'Alıntı', 'Kod bloğu', 'Kalın', 'İtalik', 'Altı çizili', 'Üstü çizili', 'Satır içi kod', 'Metni vurgula', 'Bağlantı', 'Üst simge', 'Alt simge', 'Sola hizala', 'Ortala', 'Sağa hizala', 'İki yana yasla', 'Bul ve değiştir']) {
      expect(within(cubuk).getByRole('button', { name: ad }), ad).toBeDefined()
    }
    expect(within(cubuk).queryByRole('button', { name: /image|resim|theme|tema|dark|koyu/i })).toBeNull()
  })

  it('4.3 E8: açılış ve normalleştirme onChange ÜRETMEZ', () => {
    for (const html of ['', 'düz metin', '<p>Merhaba <b>dünya</b></p>', '<h2>Veri</h2><p></p>', '<p><span style="color:red">x</span></p>']) {
      const onChange = vi.fn()
      const { unmount } = render(<BicimliYuzey html={html} onChange={onChange} etiket="Seans notu" />)
      expect(onChange, html).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('4.3b E8 (preflight F12): son düğümü paragraf OLMAYAN belge açılışta ve imleç hareketinde onChange ÜRETMEZ', () => {
    // StarterKit'in `TrailingNode`'u son düğüm paragraf değilse İLK işlemde
    // (bir tık, bir seçim) sona `<p></p>` ekler; bu bir belge değişikliğidir
    // ve kullanıcı tek tuşa basmadan PUT + silinemez `Duzenleme` satırı
    // üretirdi. Kayıtlı notların çoğu liste ya da başlıkla bitebilir.
    for (const html of ['<ul><li><p>madde</p></li></ul>', '<h2>Veri</h2>', '<blockquote><p>alıntı</p></blockquote>', '<pre><code>kod</code></pre>']) {
      const onChange = vi.fn()
      const { unmount } = render(<BicimliYuzey html={html} onChange={onChange} etiket="Seans notu" />)
      const editor = editorAl()
      act(() => { editor.commands.setTextSelection(2) })
      act(() => { editor.commands.focus('end') })
      expect(onChange, html).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('4.4 E8: belge normalleşmiş ilk hâle dönünce DIŞARIDAN gelen HAM dizgi bildirilir', () => {
    const ham = '<p>Merhaba <b>dünya</b></p>'
    const onChange = vi.fn()
    render(<BicimliYuzey html={ham} onChange={onChange} etiket="Seans notu" />)
    const editor = editorAl()
    act(() => { editor.commands.insertContent('x') })
    // ARTI YÖN: gerçek değişiklik yüzeyin kendi biçimiyle bildirilir.
    expect(onChange.mock.lastCall?.[0]).toContain('x')
    expect(onChange.mock.lastCall?.[0]).toContain('<strong>dünya</strong>')
    act(() => { editor.commands.undo() })
    expect(onChange).toHaveBeenLastCalledWith(ham)
  })

  it('4.5 dışarıdan gelen yeni html uygulanır; onChange tetiklenmez ve geri alınamaz', () => {
    const onChange = vi.fn()
    const { rerender } = render(<BicimliYuzey html="" onChange={onChange} etiket="Seans notu" />)
    rerender(<BicimliYuzey html="<h2>Veri</h2><p></p>" onChange={onChange} etiket="Seans notu" />)
    const editor = editorAl()
    expect(editor.getHTML()).toBe('<h2>Veri</h2><p></p>')
    expect(onChange).not.toHaveBeenCalled()
    act(() => { editor.commands.undo() })
    expect(editor.getHTML()).toBe('<h2>Veri</h2><p></p>')
  })

  it('4.5b (preflight F31) yerel yazmadan sonra dış değer AÇILIŞTAKİ değere geri dönerse o da uygulanır', () => {
    // Üst bileşen (NotEditoru) sunucudaki hâli benimsediğinde bu hâl notun
    // açıldığı değerle aynı olabilir; yüzey onu "zaten bildiğim dış değer"
    // sayıp atlarsa ekranda yerel metin, üstte sunucu metni kalır.
    const ilk = '<p>ilk</p>'
    let son = ''
    const onChange = vi.fn((h: string) => { son = h })
    const { rerender } = render(<BicimliYuzey html={ilk} onChange={onChange} etiket="Seans notu" />)
    const editor = editorAl()
    act(() => { editor.commands.insertContent('x') })
    rerender(<BicimliYuzey html={son} onChange={onChange} etiket="Seans notu" />)
    expect(editor.getHTML()).toContain('x')
    onChange.mockClear()
    rerender(<BicimliYuzey html={ilk} onChange={onChange} etiket="Seans notu" />)
    expect(editor.getHTML()).toBe('<p>ilk</p>')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('4.6 kendi bildirdiği html prop olarak geri gelince belge yeniden kurulmaz', () => {
    let son = ''
    const onChange = vi.fn((h: string) => { son = h })
    const { rerender } = render(<BicimliYuzey html="<p>a</p>" onChange={onChange} etiket="Seans notu" />)
    const editor = editorAl()
    act(() => { editor.commands.insertContent('b') })
    const belge = editor.state.doc
    rerender(<BicimliYuzey html={son} onChange={onChange} etiket="Seans notu" />)
    expect(editor.state.doc).toBe(belge)
  })

  it('4.7 S7/E11 şema süzgeci: betik, olay özniteliği, javascript: bağlantısı ve resim düşer', () => {
    render(
      <BicimliYuzey
        html={'<p onclick="alert(1)">güvenli</p><script>alert(2)</script><p><a href="javascript:alert(3)">tıkla</a> <img src="x" onerror="alert(4)"></p>'}
        onChange={vi.fn()}
        etiket="Seans notu"
      />,
    )
    const alan = screen.getByRole('textbox', { name: 'Seans notu' })
    expect(alan.textContent).toContain('güvenli')
    expect(alan.textContent).toContain('tıkla')
    expect(alan.querySelector('script, img, [onclick], [onerror], a[href^="javascript"]')).toBeNull()
    const html = editorAl().getHTML()
    for (const yok of ['<script', 'onclick', 'onerror', 'javascript:', '<img']) expect(html, yok).not.toContain(yok)
  })

  it('4.8 E10 bağlantı target=_blank rel="noopener noreferrer"; yalnızca http/https/mailto bağlantı olur', () => {
    render(
      <BicimliYuzey
        html={'<p><a href="https://ornek.invalid/a">dış</a> <a href="mailto:a@ornek.invalid">posta</a> <a href="file:///etc/passwd">dosya</a> <a href="ftp://ornek.invalid">ftp</a></p>'}
        onChange={vi.fn()}
        etiket="Seans notu"
      />,
    )
    const alan = screen.getByRole('textbox', { name: 'Seans notu' })
    const dis = alan.querySelector('a[href="https://ornek.invalid/a"]')
    expect(dis?.getAttribute('target')).toBe('_blank')
    expect(dis?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(alan.querySelector('a[href^="mailto:"]')).not.toBeNull()
    expect(alan.querySelector('a[href^="file:"], a[href^="ftp:"]')).toBeNull()
    expect(alan.textContent).toContain('dosya')
  })

  it('4.8b E10 (preflight F13): gelen HTML\'deki target/rel ezilemez', () => {
    // Yapıştırılan ya da saklanan `<a target="_self">` bağlantıyı uygulama
    // penceresinde açmaya çalışırdı; `rel="opener"` yeni sekmeye
    // `window.opener` verirdi.
    render(
      <BicimliYuzey
        html={'<p><a href="https://ornek.invalid/b" target="_self" rel="opener">kendi</a> <a href="https://ornek.invalid/c" target="">bos</a></p>'}
        onChange={vi.fn()}
        etiket="Seans notu"
      />,
    )
    const alan = screen.getByRole('textbox', { name: 'Seans notu' })
    for (const adres of ['https://ornek.invalid/b', 'https://ornek.invalid/c']) {
      const a = alan.querySelector(`a[href="${adres}"]`)
      expect(a?.getAttribute('target'), adres).toBe('_blank')
      expect(a?.getAttribute('rel'), adres).toBe('noopener noreferrer')
    }
    const html = editorAl().getHTML()
    expect(html).not.toContain('_self')
    expect(html).not.toContain('"opener"')
  })

  it('editable=false: düzenlenemez ve araç çubuğu yok', () => {
    render(<BicimliYuzey html="<p>okunur</p>" etiket="Not" editable={false} />)
    expect(screen.getByRole('textbox', { name: 'Not' }).getAttribute('contenteditable')).toBe('false')
    expect(screen.queryByRole('toolbar')).toBeNull()
  })
})
