import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('görev onay kutusunun erişilebilir etiketi Türkçe (Görev 10 bulgusu, E3)', () => {
    // TipTap'ın TaskItem varsayılanı İngilizce ("Task item checkbox for …");
    // bu bir E3 ihlali. `uzantilar.ts` `a11y.checkboxLabel` ile Türkçe,
    // bilgilendirici bir etiket vermeli.
    render(
      <BicimliYuzey
        html='<ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label><input type="checkbox"></label><div><p>sudan cik</p></div></li></ul>'
        onChange={vi.fn()}
        etiket="Seans notu"
      />,
    )
    const alan = screen.getByRole('textbox', { name: 'Seans notu' })
    const kutu = alan.querySelector('input[type="checkbox"]')
    const etiket = kutu?.getAttribute('aria-label') ?? ''
    expect(etiket).toContain('sudan cik')
    expect(etiket).not.toMatch(/task item checkbox/i)
    expect(etiket).toMatch(/görev|onay kutusu/i)
  })

  // Kullanıcı isteği 2026-09-27 ("araç çubuğu örtmesin notu"). jsdom yerleşim
  // ölçmez: burada YAPI ve sınıflar; örtmeme, sayfanın kaymaması ve imlecin
  // görünürlüğü gerçek tarayıcıda (`e2e/yerlesim.spec.ts` > "arac cubugu notu
  // ortmez").
  it('araç çubuğu yazı alanının DIŞINDA ve üstünde; yazı alanı kendi kaydırma kabı, boyu nottan bağımsız', () => {
    render(<BicimliYuzey html={'<p>satır</p>'.repeat(80)} onChange={vi.fn()} etiket="Seans notu" />)
    const cubuk = screen.getByRole('toolbar', { name: 'Biçim araçları' })
    const alan = screen.getByTestId('not-yazi-alani')
    const yuzey = screen.getByRole('textbox', { name: 'Seans notu' })
    const kok = alan.parentElement!
    expect(kok.classList.contains('not-editoru')).toBe(true)
    // Çubuk kökün DOĞRUDAN çocuğu (`not-yuzeyi.scss`'teki `.not-editoru >
    // .tiptap-toolbar[data-variant='fixed']` kuralı ona böyle uyar), yazı
    // alanının içinde değil ve ondan ÖNCE.
    expect(cubuk.parentElement).toBe(kok)
    expect(cubuk.getAttribute('data-variant')).toBe('fixed')
    expect(alan.contains(cubuk)).toBe(false)
    expect(cubuk.compareDocumentPosition(alan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(alan.contains(yuzey)).toBe(true)
    for (const sinif of ['flex-1', 'flex-col', 'min-h-64', 'overflow-y-auto', 'contain-size']) {
      expect(alan.classList.contains(sinif), sinif).toBe(true)
    }
    for (const sinif of ['flex', 'flex-1', 'flex-col']) expect(kok.classList.contains(sinif), sinif).toBe(true)
    // İmleç kaydırması kenardan 16 px içeride durur (bkz. bileşen).
    const editor = editorAl()
    expect(editor.view.someProp('scrollThreshold')).toBe(16)
    expect(editor.view.someProp('scrollMargin')).toBe(16)
  })

  // İnceleme I1: pay sabit değil (eski `scroll-pt-60`, 240 px, panelden
  // büyüktü), panelin ÖLÇÜLEN alt kenarı. jsdom yerleşim ölçmez: kutular
  // taklit edilir; eşleşmenin gerçekten panelin altına geldiği
  // `e2e/yerlesim.spec.ts` > "bul paneli"nde ölçülür.
  it('bul paneli açıkken yazı alanı panelin ölçülen alt kenarını üst kaydırma payı alır; kapanınca kalkar', () => {
    render(<BicimliYuzey html="<p>metin</p>" onChange={vi.fn()} etiket="Seans notu" />)
    const alan = screen.getByTestId('not-yazi-alani')
    const bulDugmesi = within(screen.getByRole('toolbar', { name: 'Biçim araçları' })).getByRole('button', { name: 'Bul ve değiştir' })
    expect(alan.classList.contains('not-yazi-alani')).toBe(true)
    expect(alan.classList.contains('not-bul-acik')).toBe(false)
    const kutu = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const k = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 300, x: 0, y: top, width: 300, height: bottom - top, toJSON: () => ({}) })
      if (this.getAttribute('role') === 'dialog') return k(100, 321.3)
      if (this === alan) return k(96, 352)
      return k(0, 0)
    })
    try {
      act(() => bulDugmesi.click())
      expect(screen.getByRole('dialog', { name: 'Bul ve değiştir' })).toBeDefined()
      expect(alan.classList.contains('not-bul-acik')).toBe(true)
      // 321,3 − 96 = 225,3 → yukarı yuvarlanır (pay panelden küçük olamaz).
      expect(alan.style.getPropertyValue('--bul-paneli-alti')).toBe('226px')
      act(() => bulDugmesi.click())
      expect(alan.classList.contains('not-bul-acik')).toBe(false)
      expect(alan.style.getPropertyValue('--bul-paneli-alti')).toBe('')
    } finally {
      kutu.mockRestore()
    }
    // Kural diskten (Vitest CSS işlemez): üst pay ölçülen kenar + nefes payı,
    // ama en az bir satırlık şerit bırakır; alt pay şeridi bir satırın
    // altına indirmez.
    const scss = readFileSync(path.join(process.cwd(), 'src/not/not-yuzeyi.scss'), 'utf8')
    const kural = /\.not-yazi-alani\.not-bul-acik\s*\{([^}]*)\}/.exec(scss)
    expect(kural, 'bul paneli kaydırma payı kuralı yok').not.toBeNull()
    expect(kural![1]).toMatch(/--bul-paneli-payi:\s*calc\(var\(--bul-paneli-alti, 15rem\) \+ 0\.25rem\);/)
    expect(kural![1]).toMatch(/scroll-padding-top:\s*min\(var\(--bul-paneli-payi\), calc\(100% - 1\.5rem\)\);/)
    expect(kural![1]).toMatch(/scroll-padding-bottom:\s*clamp\(0px, calc\(100% - var\(--bul-paneli-payi\) - 1\.5rem\), 1rem\);/)
  })

  it('bul panelinde bulunan eşleşmenin KENDİSİ görünür alana kaydırılır, paragrafı değil (inceleme I1)', async () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    try {
      render(<BicimliYuzey html={`<p>${'uzun bir paragraf '.repeat(60)}HEDEF sonu</p>`} onChange={vi.fn()} etiket="Seans notu" />)
      act(() => {
        within(screen.getByRole('toolbar', { name: 'Biçim araçları' })).getByRole('button', { name: 'Bul ve değiştir' }).click()
      })
      const panel = screen.getByRole('dialog', { name: 'Bul ve değiştir' })
      fireEvent.change(within(panel).getByLabelText('Bul'), { target: { value: 'hedef' } })
      await waitFor(() => expect(kaydir).toHaveBeenCalled())
      const hedef = kaydir.mock.contexts.at(-1) as Element
      expect(hedef.classList.contains('find-and-replace-result-current')).toBe(true)
      expect(hedef.textContent).toBe('HEDEF')
      expect(kaydir.mock.calls.at(-1)?.[0]).toMatchObject({ block: 'nearest' })
    } finally {
      kaydir.mockRestore()
    }
  })

  it('şablonun yapışkan araç çubuğu kuralı yüzeyde ezilir: static, küçülmez; asgari yükseklik ProseMirror\'da değil', () => {
    // Stil diskten okunur: Vitest CSS işlemediği için `?raw` boş dizgi döner
    // (bkz. `sablonKodu.test.ts`).
    const scss = readFileSync(path.join(process.cwd(), 'src/not/not-yuzeyi.scss'), 'utf8')
    const kural = /\.not-editoru > \.tiptap-toolbar\[data-variant='fixed'\]\s*\{([^}]*)\}/.exec(scss)
    expect(kural, 'araç çubuğu kuralı yok').not.toBeNull()
    expect(kural![1]).toMatch(/position:\s*static;/)
    expect(kural![1]).toMatch(/flex-shrink:\s*0;/)
    const yuzeyKurali = /\.tiptap\.ProseMirror\.not-yuzeyi\s*\{([^}]*)\}/.exec(scss)
    expect(yuzeyKurali).not.toBeNull()
    expect(yuzeyKurali![1]).not.toMatch(/min-height/)
    expect(yuzeyKurali![1]).toMatch(/overflow-wrap:\s*anywhere;/)
    expect(scss).toMatch(/\.not-editoru \.tiptap\.ProseMirror\.not-yuzeyi\s*\{\s*flex:\s*1 0 auto;/)
  })

  it('editable=false: düzenlenemez ve araç çubuğu yok', () => {
    render(<BicimliYuzey html="<p>okunur</p>" etiket="Not" editable={false} />)
    expect(screen.getByRole('textbox', { name: 'Not' }).getAttribute('contenteditable')).toBe('false')
    expect(screen.queryByRole('toolbar')).toBeNull()
  })
})
