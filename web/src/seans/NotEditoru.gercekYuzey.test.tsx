import { act, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotEditoru } from './NotEditoru'
import { taslaklariUnut } from './taslak'

// GERÇEK TipTap yüzeyiyle editör sözleşmesi (tasarım E8, inceleme odağı 1).
// Diğer NotEditoru testleri textarea test yüzeyini kullanıyor; normalleştirme
// yalnızca gerçek yüzeyde olur.
vi.mock('../not/BicimliYuzey', async (importOriginal) => await importOriginal<typeof import('../not/BicimliYuzey')>())

function editorAl(): Editor {
  const pm = document.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null
  if (!pm?.editor) throw new Error('TipTap editörü bulunamadı')
  return pm.editor
}

async function ilerle(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

beforeEach(() => {
  taslaklariUnut()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('NotEditoru + gerçek TipTap yüzeyi', () => {
  it('5.1 E8: açılış normalleştirmesi (ne zamanlayıcıyla ne unmount tahliyesiyle) kayıt ÜRETMEZ', async () => {
    const onKaydet = vi.fn().mockResolvedValue(undefined)
    const icerikler = ['', 'düz metin', '<p>Merhaba <b>dünya</b></p>', '<h2>Veri</h2><p></p><h2>Plan</h2><p></p>']
    for (const [i, icerik] of icerikler.entries()) {
      const { unmount } = render(
        <NotEditoru baslangicIcerik={icerik} baslangicSablon="dap" onKaydet={onKaydet} gecikmeMs={20} taslakAnahtari={`e8-${i}`} />,
      )
      await ilerle(200)
      unmount()
    }
    expect(onKaydet).not.toHaveBeenCalled()
  })

  it('5.2 E8: yazıp geri alınca kayıt yok ve durum temiz; ARTI YÖN: gerçek yazma TAM bir kez kaydeder', async () => {
    const onKaydet = vi.fn().mockResolvedValue(undefined)
    render(
      <NotEditoru baslangicIcerik="<p>Merhaba <b>dünya</b></p>" baslangicSablon="serbest" onKaydet={onKaydet} gecikmeMs={20} taslakAnahtari="e8-geri" />,
    )
    const editor = editorAl()
    act(() => { editor.commands.insertContent('x') })
    act(() => { editor.commands.undo() })
    await ilerle(200)
    expect(onKaydet).not.toHaveBeenCalled()
    // `NotEditoru`'nun durum bölgesi DOM'da yüzeyin (araç çubuğu) ÖNÜNDE.
    expect(screen.getAllByRole('status')[0].textContent).toBe('')

    act(() => { editor.commands.insertContent('Y') })
    await ilerle(200)
    expect(onKaydet).toHaveBeenCalledTimes(1)
    const kayit = onKaydet.mock.calls[0][0] as { icerik: string }
    expect(kayit.icerik).toContain('Y')
    expect(kayit.icerik).toContain('<strong>dünya</strong>')
  })
})
