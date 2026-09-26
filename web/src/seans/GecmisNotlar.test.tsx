import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SeansNotu } from '../api'
import { GecmisNotlar } from './GecmisNotlar'

function not(ozel: Partial<SeansNotu> = {}): SeansNotu {
  return {
    appointment_id: 1,
    client_id: 1,
    danisan_adi: 'Ayşe Yılmaz',
    sablon: 'dap',
    icerik: '## Veri\n\nDanışan geldi.',
    onizleme: null,
    guncelleme_zamani: '2026-09-01T12:00:00Z',
    seans_zamani: '2026-09-01T10:00',
    ...ozel,
  }
}

describe('GecmisNotlar', () => {
  it('genisletilince not NotGorunumu ile bicimli gosterilir (duz metin degil)', () => {
    render(<GecmisNotlar notlar={[not()]} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Veri').tagName).toBe('H4')
    expect(screen.getByText('Danışan geldi.').tagName).toBe('P')
  })

  it('eski (Veri:) bicimli not da duz paragraf olarak acilir, kaybolmaz', () => {
    render(<GecmisNotlar notlar={[not({ icerik: 'Veri:\nDanışan geldi.' })]} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText(/Veri:/).tagName).toBe('P')
  })
})
