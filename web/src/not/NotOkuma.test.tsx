import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotOkuma } from './NotOkuma'

afterEach(() => vi.restoreAllMocks())

const vurgular = (kap: HTMLElement) => [...kap.querySelectorAll('.not-vurgu')].map((e) => e.textContent)

describe('NotOkuma (gerçek TipTap, salt okunur)', () => {
  it('4.9 vurgu Türkçe harf duyarsız; ilk eşleşme görünür alana kaydırılır', () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    const { container } = render(
      <NotOkuma html="<p>Çok <strong>KAYGI</strong>lı bir gün; kaygı azaldı</p>" vurgu="kaygi" />,
    )
    expect(container.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false')
    expect(vurgular(container)).toEqual(['KAYGI', 'kaygı'])
    expect(kaydir).toHaveBeenCalledTimes(1)
    expect((kaydir.mock.contexts[0] as HTMLElement).classList.contains('not-vurgu')).toBe(true)
  })

  it('4.10 biçim etiketinin böldüğü kelime de işaretlenir (inceleme odağı 3)', () => {
    const { container } = render(<NotOkuma html="<p>ön<strong>em</strong>li bir konu</p>" vurgu="ONEMLI" />)
    expect(vurgular(container).join('')).toBe('önemli')
  })

  it('vurgu yoksa ya da tek karakterse işaret ve kaydırma yok', () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    for (const vurgu of ['', 'k']) {
      const { container, unmount } = render(<NotOkuma html="<p>kaygı</p>" vurgu={vurgu} />)
      expect(vurgular(container), vurgu).toEqual([])
      unmount()
    }
    expect(kaydir).not.toHaveBeenCalled()
  })

  it('vurgu değişince yeni terim işaretlenir, eskisi kalkar', () => {
    const { container, rerender } = render(<NotOkuma html="<p>uyku ve kaygı</p>" vurgu="uyku" />)
    expect(vurgular(container)).toEqual(['uyku'])
    rerender(<NotOkuma html="<p>uyku ve kaygı</p>" vurgu="kaygı" />)
    expect(vurgular(container)).toEqual(['kaygı'])
  })

  // Görev 4 incelemesi: `html` değişimi hiç ölçülmüyordu (`useEditor`'ın
  // `[html]` bağımlılığı silinse bütün testler yeşil kalıyordu). Önceki
  // notlar paneli ve okuma penceresi AYNI bileşende not değiştirir: eski
  // notun metni ya da vurgusu yeni notun yerinde kalmamalı (dördüncü biçim —
  // temiz mount değil, GEÇİŞ).
  it('html değişince YENİ not gösterilir; vurgu ve kaydırma yeni notta', () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    const { container, rerender } = render(<NotOkuma html="<p>ESKI NOT: uyku iyi</p>" vurgu="kaygı" />)
    expect(container.querySelector('.ProseMirror')?.textContent).toBe('ESKI NOT: uyku iyi')
    expect(vurgular(container)).toEqual([])
    expect(kaydir).not.toHaveBeenCalled()

    rerender(<NotOkuma html="<p>YENI NOT: <em>KAYGI</em> arttı</p>" vurgu="kaygı" />)
    const pm = container.querySelector('.ProseMirror') as HTMLElement
    expect(pm.textContent).toBe('YENI NOT: KAYGI arttı')
    expect(container.textContent).not.toContain('ESKI NOT')
    expect(pm.getAttribute('role')).toBe('document')
    expect(vurgular(container)).toEqual(['KAYGI'])
    expect(kaydir).toHaveBeenCalledTimes(1)
    expect(pm.contains(kaydir.mock.contexts[0] as HTMLElement)).toBe(true)
  })

  it('preflight F2: salt okunur görünüm metin kutusu DEĞİLDİR (okuma penceresi ve e2e buna dayanır)', () => {
    // TipTap her editöre `role="textbox"` koyar; okunur görünümde bu, ekran
    // okuyucuya "yazılabilir alan" der ve Görev 9/10'un
    // `queryByRole('textbox')` iddialarını boşa düşürürdü.
    const { container } = render(<NotOkuma html="<p>okunur not</p>" />)
    expect(container.querySelector('.ProseMirror')?.textContent).toBe('okunur not')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(container.querySelector('.ProseMirror')?.getAttribute('role')).toBe('document')
  })

  it('S7: okuma görünümü de şemaya süzer (betik, olay özniteliği, javascript: bağlantısı, resim düşer)', () => {
    const { container } = render(
      <NotOkuma html={'<p onclick="alert(1)">güvenli</p><script>alert(2)</script><p><a href="javascript:alert(3)">tıkla</a> <img src="x" onerror="alert(4)"></p>'} />,
    )
    const pm = container.querySelector('.ProseMirror') as HTMLElement
    expect(pm.textContent).toContain('güvenli')
    expect(pm.textContent).toContain('tıkla')
    expect(pm.querySelector('script, img, [onclick], [onerror], a[href^="javascript"]')).toBeNull()
  })
})
