import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

// Dosyadaki bütün fikstürler bu andan ÖNCE (geçmişte); Yaklaşan yalnızca B3 testlerinde.
const SIMDI = '2026-09-20T12:00'

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
        simdi={SIMDI}
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
        simdi={SIMDI}
      />,
    )
    expect(screen.getByText('Planlandı')).toBeDefined()
    expect(screen.getByText('Gelmedi')).toBeDefined()
    expect(screen.getByText('İptal')).toBeDefined()
  })

  it('notu olmayan seans "Not yazılmamış" olarak görünür', () => {
    render(
      <SeansListesi seanslar={[seans({ not_ilk_satiri: null })]} secili={null} onSecim={() => {}} simdi={SIMDI} />,
    )
    expect(screen.getByText('Not yazılmamış')).toBeDefined()
  })

  it('boş not, yazılmamış nottan ayrı gösterilir', () => {
    render(
      <SeansListesi seanslar={[seans({ not_ilk_satiri: '' })]} secili={null} onSecim={() => {}} simdi={SIMDI} />,
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
        simdi={SIMDI}
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
        simdi={SIMDI}
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
        simdi={SIMDI}
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
        simdi={SIMDI}
      />,
    )
    expect(screen.getByText(/1\.234,50 TL/)).toBeDefined()
  })

  it('ücreti girilmemiş seans "—" ile gösterilir, 0,00 TL DEĞİL', () => {
    render(
      <SeansListesi seanslar={[seans({ ucret_kurus: null })]} secili={null} onSecim={() => {}} simdi={SIMDI} />,
    )
    expect(screen.queryByText(/0,00 TL/)).toBeNull()
    expect(screen.getByText('—')).toBeDefined()
  })

  it('ücretsiz (0 kuruş) seans "0,00 TL" ile gösterilir, "—" DEĞİL', () => {
    render(
      <SeansListesi seanslar={[seans({ ucret_kurus: 0 })]} secili={null} onSecim={() => {}} simdi={SIMDI} />,
    )
    expect(screen.getByText('0,00 TL')).toBeDefined()
    expect(screen.queryByText('—')).toBeNull()
  })

  it('bir seansa tıklamak onSecim\'i o seansın randevu kimliğiyle çağırır', () => {
    const onSecim = vi.fn()
    render(
      <SeansListesi
        seanslar={[seans({ appointment_id: 7, baslangic: '2026-09-14T10:00' }), seans({ appointment_id: 8, baslangic: '2026-09-07T10:00' })]}
        secili={null}
        onSecim={onSecim}
        simdi={SIMDI}
      />,
    )
    screen.getAllByRole('button')[1].click()
    expect(onSecim).toHaveBeenCalledExactlyOnceWith(8)
  })

  it('seans yoksa boş durum mesajı gösterilir, boş bir liste DEĞİL', () => {
    render(<SeansListesi seanslar={[]} secili={null} onSecim={() => {}} simdi={SIMDI} />)
    expect(screen.getByText('Bu danışanın kayıtlı bir seansı yok.')).toBeDefined()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  // `data-yuklendi`: `e2e/kabuk.spec.ts`nin senkronizasyon bariyeri (bkz.
  // `useDanisanSeanslari.ts` modül başlığı). Varsayılan `true`: prop'u hiç
  // geçmeyen çağıranlar (bu dosyadaki diğer testler) eskisi gibi davranır.
  it('yuklendi prop verilmezse data-yuklendi="evet" olur (varsayılan)', () => {
    render(<SeansListesi seanslar={[seans()]} secili={null} onSecim={() => {}} simdi={SIMDI} />)
    expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet')
  })

  it('yuklendi=false iken boş listede bile data-yuklendi="hayir" olur', () => {
    render(<SeansListesi seanslar={[]} secili={null} onSecim={() => {}} yuklendi={false} simdi={SIMDI} />)
    expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('hayir')
  })

  it('yuklendi=true iken dolu listede data-yuklendi="evet" olur', () => {
    render(<SeansListesi seanslar={[seans()]} secili={null} onSecim={() => {}} yuklendi={true} simdi={SIMDI} />)
    expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet')
  })
})

describe('SeansListesi — seçili satır görünür alana gelir (tasarım B2/B3)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('açılışta seçili satır bir kez (en yakın kenara); aynı seçimle yeniden çizim kaydırmaz; seçim değişince ve kaydırma isteğiyle yeniden', () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    const iki = [
      seans({ appointment_id: 1, baslangic: '2026-09-14T10:00' }),
      seans({ appointment_id: 2, baslangic: '2026-09-07T10:00' }),
    ]
    const { rerender } = render(<SeansListesi seanslar={iki} secili={2} onSecim={() => {}} simdi={SIMDI} />)
    expect(kaydir).toHaveBeenCalledTimes(1)
    expect(kaydir.mock.contexts[0]).toBe(screen.getAllByRole('button')[1])
    expect(kaydir).toHaveBeenLastCalledWith({ block: 'nearest' })

    // Liste tazelemesi (yeni dizi, aynı seçim) KAYDIRMAZ.
    rerender(<SeansListesi seanslar={[...iki]} secili={2} onSecim={() => {}} simdi={SIMDI} />)
    expect(kaydir).toHaveBeenCalledTimes(1)

    rerender(<SeansListesi seanslar={iki} secili={1} onSecim={() => {}} simdi={SIMDI} />)
    expect(kaydir).toHaveBeenCalledTimes(2)
    expect(kaydir.mock.contexts[1]).toBe(screen.getAllByRole('button')[0])

    rerender(<SeansListesi seanslar={iki} secili={1} onSecim={() => {}} kaydirmaIstegi={1} simdi={SIMDI} />)
    expect(kaydir).toHaveBeenCalledTimes(3)
  })
})

describe('SeansListesi — uzun geçmiş düzeni (tasarım B3)', () => {
  afterEach(() => vi.restoreAllMocks())

  const UZUN = [
    seans({ appointment_id: 30, baslangic: '2026-10-01T14:00', durum: 'planlandi' }),
    seans({ appointment_id: 20, baslangic: '2026-09-24T14:00', durum: 'planlandi', not_ilk_satiri: '' }),
    seans({ appointment_id: 10, baslangic: '2026-09-14T10:00', durum: 'geldi' }),
    seans({ appointment_id: 9, baslangic: '2026-09-07T10:00', durum: 'gelmedi' }),
    seans({ appointment_id: 8, baslangic: '2026-09-01T10:00', durum: 'geldi' }),
    seans({ appointment_id: 7, baslangic: '2026-08-25T10:00', durum: 'iptal' }),
  ]
  const liste = () => screen.getByTestId('seans-listesi')
  const basliklar = () => within(liste()).getAllByRole('heading').map((h) => h.textContent)
  const tarihler = () =>
    [...liste().querySelectorAll('li')].map((li) => /^\d+ \S+ \d{4}, \d{2}:\d{2}/.exec(li.textContent ?? '')?.[0])
  const satir = (t: string) => within(liste()).getByText(t).closest('button') as HTMLButtonElement
  const yaklasan = () => within(liste()).getByRole('button', { name: /^Yaklaşan \(\d+\)$/ }) as HTMLButtonElement

  it('Yaklaşan (n) en üstte ve KATLI; açınca en yakın üstte; kapatınca gizlenir', async () => {
    render(<SeansListesi seanslar={UZUN} secili={10} onSecim={() => {}} simdi={SIMDI} />)
    expect(yaklasan().textContent).toBe('Yaklaşan (2)')
    expect(yaklasan().getAttribute('aria-expanded')).toBe('false')
    expect(basliklar()).toEqual(['Yaklaşan (2)', 'Eylül 2026 · 2 seans', 'Ağustos 2026'])
    expect(tarihler()).toEqual([
      '14 Eylül 2026, 10:00', '7 Eylül 2026, 10:00', '1 Eylül 2026, 10:00', '25 Ağustos 2026, 10:00',
    ])

    await userEvent.click(yaklasan())
    expect(yaklasan().getAttribute('aria-expanded')).toBe('true')
    expect(tarihler().slice(0, 2)).toEqual(['24 Eylül 2026, 14:00', '1 Ekim 2026, 14:00'])
    await userEvent.click(yaklasan())
    expect(tarihler()).toHaveLength(4)
  })

  it('seçili seans Yaklaşan\'daysa grup ZORLA açık (düğme devre dışı); seçim geçmişe dönünce kapalı tercih geçerli', () => {
    const { rerender } = render(<SeansListesi seanslar={UZUN} secili={30} onSecim={() => {}} simdi={SIMDI} />)
    expect(yaklasan().getAttribute('aria-expanded')).toBe('true')
    expect(yaklasan().disabled).toBe(true)
    expect(within(liste()).getByRole('button', { current: true }).textContent).toContain('1 Ekim 2026, 14:00')

    rerender(<SeansListesi seanslar={UZUN} secili={10} onSecim={() => {}} simdi={SIMDI} />)
    expect(yaklasan().getAttribute('aria-expanded')).toBe('false')
    expect(yaklasan().disabled).toBe(false)
    expect(tarihler()).toHaveLength(4)
  })

  it('kullanıcı açtıysa seçim geçmişte değişse de grup açık kalır', async () => {
    const { rerender } = render(<SeansListesi seanslar={UZUN} secili={10} onSecim={() => {}} simdi={SIMDI} />)
    await userEvent.click(yaklasan())
    rerender(<SeansListesi seanslar={UZUN} secili={8} onSecim={() => {}} simdi={SIMDI} />)
    expect(yaklasan().getAttribute('aria-expanded')).toBe('true')
  })

  it('gelecekteki satır "Not yazılmamış" YAZMAZ (notsuzluk data-not\'ta); geçmişteki yazar; boş not ayrımı korunur', () => {
    render(<SeansListesi seanslar={UZUN} secili={30} onSecim={() => {}} simdi={SIMDI} />)
    expect(satir('1 Ekim 2026, 14:00').textContent).not.toContain('Not yazılmamış')
    expect(satir('1 Ekim 2026, 14:00').getAttribute('data-not')).toBe('yok')
    expect(satir('24 Eylül 2026, 14:00').textContent).toContain('Not açıldı, henüz boş')
    expect(satir('24 Eylül 2026, 14:00').getAttribute('data-not')).toBe('bos')
    expect(satir('14 Eylül 2026, 10:00').textContent).toContain('Not yazılmamış')
  })

  it('ay başlığı yapışkan; sayı o gruptaki GÖRÜNEN geldi satırları', () => {
    render(
      <SeansListesi seanslar={UZUN.filter((x) => x.appointment_id !== 10)} secili={8} onSecim={() => {}} simdi={SIMDI} />,
    )
    expect(basliklar()).toEqual(['Yaklaşan (2)', 'Eylül 2026 · 1 seans', 'Ağustos 2026'])
    const eylul = within(liste()).getByRole('heading', { name: 'Eylül 2026 · 1 seans' })
    for (const sinif of ['sticky', 'top-0', 'bg-white']) expect(eylul.className, sinif).toContain(sinif)
  })

  it('#n yalnızca haritadaki satırda (harita dışarıdan, süzgeçten bağımsız)', () => {
    const numaralar = new Map([[8, 1], [10, 2]])
    render(<SeansListesi seanslar={UZUN} secili={10} onSecim={() => {}} simdi={SIMDI} numaralar={numaralar} />)
    const numara = (t: string) => within(satir(t)).queryByTestId('seans-numarasi')?.textContent ?? null
    expect(numara('14 Eylül 2026, 10:00')).toBe('#2')
    expect(numara('1 Eylül 2026, 10:00')).toBe('#1')
    expect(numara('7 Eylül 2026, 10:00')).toBeNull()
  })

  it('TAM şimdi başlayan satır geçmiştedir: Yaklaşan yok, "Not yazılmamış" yazar', () => {
    render(
      <SeansListesi seanslar={[seans({ appointment_id: 1, baslangic: SIMDI, durum: 'planlandi' })]} secili={1} onSecim={() => {}} simdi={SIMDI} />,
    )
    expect(basliklar()).toEqual(['Eylül 2026'])
    expect(within(liste()).getByRole('button', { current: true }).textContent).toContain('Not yazılmamış')
  })

  it('Yaklaşan\'daki seans seçilince grup açılır VE satır görünür alana getirilir', () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    const { rerender } = render(<SeansListesi seanslar={UZUN} secili={10} onSecim={() => {}} simdi={SIMDI} />)
    expect(kaydir).toHaveBeenCalledTimes(1)
    rerender(<SeansListesi seanslar={UZUN} secili={30} onSecim={() => {}} simdi={SIMDI} />)
    // Grup seçimden türetilerek AÇILIR (katlı kalsaydı satır DOM'da olmazdı).
    expect(yaklasan().getAttribute('aria-expanded')).toBe('true')
    expect(kaydir).toHaveBeenCalledTimes(2)
    expect(kaydir.mock.contexts[1]).toBe(satir('1 Ekim 2026, 14:00'))
  })

  // İnceleme (Görev 4, Important): `block: 'nearest'` yukarı kaydırmada
  // satırın üst kenarını kabın üstüne koyar; kendi ayının opak yapışkan
  // başlığı (≈20–24 px) tarih, #n ve durumun üstüne biner. Gerçek tarayıcı
  // geometrisi Görev 5 e2e'sinde; burada sınıf sabitlenir.
  it('satır yapışkan başlığın ALTINA kaydırılır (scroll-mt-7 = 28 px ≥ başlık)', () => {
    render(<SeansListesi seanslar={UZUN} secili={30} onSecim={() => {}} simdi={SIMDI} />)
    const satirlar = [...liste().querySelectorAll('li > button')]
    expect(satirlar).toHaveLength(6)
    for (const b of satirlar) expect(b.className, b.textContent ?? '').toContain('scroll-mt-7')
  })

  // İnceleme (Görev 4, Minor 1): liste sütunu `overflow-y-auto` (overflow-x
  // de `auto` hesaplanır); dışa çizilen odak çerçevesi kenarlarda kırpılır.
  // B1'deki `ring-inset` gibi halka İÇTE çizilir, yerel çerçeve gizlenir.
  it('odak halkası düğmenin İÇİNDE (satırlar ve Yaklaşan düğmesi): sütun kırpmaz', () => {
    render(<SeansListesi seanslar={UZUN} secili={30} onSecim={() => {}} simdi={SIMDI} />)
    const dugmeler = [yaklasan(), ...liste().querySelectorAll('li > button')]
    expect(dugmeler).toHaveLength(7)
    for (const b of dugmeler) {
      for (const sinif of ['focus-visible:outline-hidden', 'focus-visible:ring-2', 'focus-visible:ring-inset']) {
        expect(b.className, `${b.textContent} ${sinif}`).toContain(sinif)
      }
    }
  })
})
