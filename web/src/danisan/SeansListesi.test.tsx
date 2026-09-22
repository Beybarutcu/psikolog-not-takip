import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DanisanSeansi } from '../api'
import { SeansListesi } from './SeansListesi'

function seans(oz: Partial<DanisanSeansi> = {}): DanisanSeansi {
  return {
    appointment_id: 1,
    baslangic: '2026-09-14T10:00',
    durum: 'geldi',
    ucret_kurus: 15000,
    odendi: false,
    not_ilk_satiri: null,
    etiketler: [],
    ...oz,
  }
}

describe('SeansListesi', () => {
  it('her seans tarih, durum ve ödeme rozetiyle listelenir', () => {
    render(
      <SeansListesi
        seanslar={[
          seans({
            appointment_id: 1,
            baslangic: '2026-09-14T10:00',
            durum: 'geldi',
            odendi: true,
            ucret_kurus: 15000,
          }),
        ]}
        secili={null}
        onSecim={() => {}}
      />,
    )
    expect(screen.getByText('14 Eylül 2026, 10:00')).toBeDefined()
    expect(screen.getByText('Geldi')).toBeDefined()
    expect(screen.getByText(/150,00 TL/)).toBeDefined()
    expect(screen.getByText(/Ödendi/)).toBeDefined()
  })

  it('durum kodunu Türkçe etikete çevirir (planlandı/gelmedi/iptal)', () => {
    render(
      <SeansListesi
        seanslar={[
          seans({ appointment_id: 1, durum: 'planlandi' }),
          seans({ appointment_id: 2, durum: 'gelmedi' }),
          seans({ appointment_id: 3, durum: 'iptal' }),
        ]}
        secili={null}
        onSecim={() => {}}
      />,
    )
    expect(screen.getByText('Planlandı')).toBeDefined()
    expect(screen.getByText('Gelmedi')).toBeDefined()
    expect(screen.getByText('İptal')).toBeDefined()
  })

  it('notu olmayan seans "Not yazılmamış" olarak görünür', () => {
    render(
      <SeansListesi seanslar={[seans({ not_ilk_satiri: null })]} secili={null} onSecim={() => {}} />,
    )
    expect(screen.getByText('Not yazılmamış')).toBeDefined()
  })

  it('boş not, yazılmamış nottan ayrı gösterilir', () => {
    render(
      <SeansListesi seanslar={[seans({ not_ilk_satiri: '' })]} secili={null} onSecim={() => {}} />,
    )
    expect(screen.queryByText('Not yazılmamış')).toBeNull()
    expect(screen.getByText('Not açıldı, henüz boş')).toBeDefined()
  })

  it('dolu bir notun ilk satırı olduğu gibi gösterilir', () => {
    render(
      <SeansListesi
        seanslar={[seans({ not_ilk_satiri: 'Danışan bu hafta daha rahat görünüyordu' })]}
        secili={null}
        onSecim={() => {}}
      />,
    )
    expect(screen.getByText('Danışan bu hafta daha rahat görünüyordu')).toBeDefined()
  })

  it('açılışta en yeni seans seçilidir', () => {
    // Sunucu listeyi en yeniden eskiye döndürür (bkz. api.ts::danisanApi.seanslar);
    // seanslar[0] burada bilerek EN YENİ seans.
    render(
      <SeansListesi
        seanslar={[
          seans({ appointment_id: 1, baslangic: '2026-09-14T10:00' }),
          seans({ appointment_id: 2, baslangic: '2026-09-07T10:00' }),
        ]}
        secili={null}
        onSecim={() => {}}
      />,
    )
    const butonlar = screen.getAllByRole('button')
    expect(butonlar[0].getAttribute('aria-current')).toBe('true')
    expect(butonlar[1].getAttribute('aria-current')).toBeNull()
  })

  it('dışarıdan verilen `secili` en yeniyi EZER', () => {
    render(
      <SeansListesi
        seanslar={[
          seans({ appointment_id: 1, baslangic: '2026-09-14T10:00' }),
          seans({ appointment_id: 2, baslangic: '2026-09-07T10:00' }),
        ]}
        secili={2}
        onSecim={() => {}}
      />,
    )
    const butonlar = screen.getAllByRole('button')
    expect(butonlar[0].getAttribute('aria-current')).toBeNull()
    expect(butonlar[1].getAttribute('aria-current')).toBe('true')
  })

  it('ücret tek biçimlendiriciyle (tlMetni) yazılır', () => {
    render(
      <SeansListesi
        seanslar={[seans({ ucret_kurus: 123450 })]}
        secili={null}
        onSecim={() => {}}
      />,
    )
    expect(screen.getByText(/1\.234,50 TL/)).toBeDefined()
  })

  it('ücreti girilmemiş seans "—" ile gösterilir, 0,00 TL DEĞİL', () => {
    render(
      <SeansListesi seanslar={[seans({ ucret_kurus: null })]} secili={null} onSecim={() => {}} />,
    )
    expect(screen.queryByText(/0,00 TL/)).toBeNull()
    expect(screen.getByText('—')).toBeDefined()
  })

  it('ücretsiz (0 kuruş) seans "0,00 TL" ile gösterilir, "—" DEĞİL', () => {
    render(
      <SeansListesi seanslar={[seans({ ucret_kurus: 0 })]} secili={null} onSecim={() => {}} />,
    )
    expect(screen.getByText('0,00 TL')).toBeDefined()
    expect(screen.queryByText('—')).toBeNull()
  })

  it('bir seansa tıklamak onSecim\'i o seansın randevu kimliğiyle çağırır', () => {
    const onSecim = vi.fn()
    render(
      <SeansListesi
        seanslar={[seans({ appointment_id: 7 }), seans({ appointment_id: 8 })]}
        secili={null}
        onSecim={onSecim}
      />,
    )
    screen.getAllByRole('button')[1].click()
    expect(onSecim).toHaveBeenCalledExactlyOnceWith(8)
  })

  it('seans yoksa boş durum mesajı gösterilir, boş bir liste DEĞİL', () => {
    render(<SeansListesi seanslar={[]} secili={null} onSecim={() => {}} />)
    expect(screen.getByText('Bu danışanın kayıtlı bir seansı yok.')).toBeDefined()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  // `data-yuklendi`: `e2e/kabuk.spec.ts`nin senkronizasyon bariyeri (bkz.
  // `useDanisanSeanslari.ts` modül başlığı). Varsayılan `true`: prop'u hiç
  // geçmeyen çağıranlar (bu dosyadaki diğer testler) eskisi gibi davranır.
  it('yuklendi prop verilmezse data-yuklendi="evet" olur (varsayılan)', () => {
    render(<SeansListesi seanslar={[seans()]} secili={null} onSecim={() => {}} />)
    expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet')
  })

  it('yuklendi=false iken boş listede bile data-yuklendi="hayir" olur', () => {
    render(<SeansListesi seanslar={[]} secili={null} onSecim={() => {}} yuklendi={false} />)
    expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('hayir')
  })

  it('yuklendi=true iken dolu listede data-yuklendi="evet" olur', () => {
    render(<SeansListesi seanslar={[seans()]} secili={null} onSecim={() => {}} yuklendi={true} />)
    expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet')
  })
})
