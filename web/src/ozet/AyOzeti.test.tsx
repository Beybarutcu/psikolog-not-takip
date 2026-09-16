import { act, render as rtlRender, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { yetkisizOlunca, type AyOzeti as AyOzetiVerisi } from '../api'
import { AyOzeti, KAPSAM_CUMLESI } from './AyOzeti'

// `ozetApi.ayOzeti` test başına değiştirilebilir. `null` iken GERÇEK istemci
// çalışır (401 testi merkezî mekanizmayı gerçek `istek()` yolundan ölçer).
const taklit = vi.hoisted(() => ({
  ayOzeti: null as null | ((ay: string) => Promise<unknown>),
}))

vi.mock('../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../api')>()
  return {
    ...gercek,
    ozetApi: {
      ayOzeti: (ay: string) => (taklit.ayOzeti ?? gercek.ozetApi.ayOzeti)(ay),
    },
  }
})

function render(ui: ReactElement, { ayOzeti }: { ayOzeti: ((ay: string) => Promise<unknown>) | null }) {
  taklit.ayOzeti = ayOzeti
  return rtlRender(ui)
}

/** Yanıtı test açıkça salınana kadar bekletir (`SeansPaneli.test.tsx` deseni). */
function kapi<T>() {
  let coz!: (v: T) => void
  let reddet!: (e: unknown) => void
  const promise = new Promise<T>((c, r) => {
    coz = c
    reddet = r
  })
  return { promise, coz, reddet }
}

function bosOzet(ay: string): AyOzetiVerisi {
  return { ay, seans_sayisi: 0, tahsilat_kurus: 0, bekleyen_kurus: 0, borclular: [] }
}

/**
 * Etiketin YANINDAKİ değer. Yalnızca "ekranda 3.150,00 TL var" demek,
 * tahsilat ile bekleyeni yer değiştiren bir uygulamayı da geçirirdi.
 */
function deger(etiket: string): string {
  const dt = screen.getAllByRole('term').find((e) => e.textContent === etiket)
  if (!dt) throw new Error(`etiket yok: ${etiket}`)
  return dt.nextElementSibling?.textContent ?? ''
}

/** Kapı çözüldükten sonra bileşenin `.then` geri çağrısı ve render'ı bitene kadar bekler. */
async function yanitlarAkti(p: Promise<unknown>) {
  await act(async () => {
    await p.catch(() => {})
    await new Promise((r) => setTimeout(r, 0))
  })
}

const gercekFetch = globalThis.fetch

afterEach(() => {
  taklit.ayOzeti = null
  globalThis.fetch = gercekFetch
})

describe('AyOzeti', () => {
  it('ay degisince ONCEKI ayin rakamlari gosterilmez, tek istek gider', async () => {
    const eylul = kapi<AyOzetiVerisi>()
    const ekim = kapi<AyOzetiVerisi>()
    const ayOzeti = vi.fn((ay: string) => (ay === '2026-09' ? eylul.promise : ekim.promise))
    render(<AyOzeti bugun="2026-09-16" onDanisanAc={vi.fn()} />, { ayOzeti })
    expect(screen.getByRole('heading', { name: 'Eylül 2026' })).toBeDefined()
    eylul.coz({ ay: '2026-09', seans_sayisi: 7, tahsilat_kurus: 315000, bekleyen_kurus: 45000, borclular: [] })
    await screen.findByText('3.150,00 TL')
    // Üç sayı DOĞRU etiketin yanında.
    expect(deger('Gelinen seans')).toBe('7')
    expect(deger('Tahsilat')).toBe('3.150,00 TL')
    expect(deger('Bekleyen')).toBe('450,00 TL')

    await userEvent.click(screen.getByRole('button', { name: 'Sonraki ay' }))
    expect(ayOzeti).toHaveBeenLastCalledWith('2026-10')
    expect(ayOzeti).toHaveBeenCalledTimes(2)
    // Ekim yanıtı HENÜZ gelmedi: Eylül'ün hiçbir sayısı ekranda kalmaz.
    expect(screen.queryByText('3.150,00 TL')).toBeNull()
    expect(screen.queryByText('450,00 TL')).toBeNull()
    expect(deger('Gelinen seans')).toBe('…')
    expect(deger('Tahsilat')).toBe('…')
    expect(deger('Bekleyen')).toBe('…')
    // Yanıt yokken "borç yok" da söylenmez — bu da bir iddiadır.
    expect(screen.queryByText('Bu ay bekleyen ödeme yok.')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Ekim 2026' })).toBeDefined()

    // ARTI YÖN: Ekim gelince Ekim'in sayıları görünür.
    ekim.coz({ ay: '2026-10', seans_sayisi: 2, tahsilat_kurus: 120000, bekleyen_kurus: 0, borclular: [] })
    await screen.findByText('1.200,00 TL')
    expect(deger('Gelinen seans')).toBe('2')
  })

  it('SIRA DISI yanit: Eylul istegi Ekim den SONRA donerse ekranda Ekim kalir', async () => {
    const eylul = kapi<AyOzetiVerisi>()
    const ekim = kapi<AyOzetiVerisi>()
    const ayOzeti = vi.fn((ay: string) => (ay === '2026-09' ? eylul.promise : ekim.promise))
    render(<AyOzeti bugun="2026-09-16" onDanisanAc={vi.fn()} />, { ayOzeti })

    // Eylül uçuşta kalırken Ekim'e geçilir ve Ekim ÖNCE döner.
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki ay' }))
    ekim.coz({
      ay: '2026-10', seans_sayisi: 2, tahsilat_kurus: 120000, bekleyen_kurus: 30000,
      borclular: [{ client_id: 8, ad_soyad: 'Ekim Borçlusu', borc_kurus: 30000, seans_sayisi: 1 }],
    })
    await screen.findByText('1.200,00 TL')

    // Eylül ŞİMDİ döner. Senkronizasyon bariyeri: geri çağrı çalışıp render
    // bitene kadar bekleniyor — yoksa aşağıdaki iddialar işlem ÖNCESİ
    // durumla tatmin olurdu (biçim 6).
    eylul.coz({
      ay: '2026-09', seans_sayisi: 7, tahsilat_kurus: 315000, bekleyen_kurus: 45000,
      borclular: [{ client_id: 9, ad_soyad: 'Eylül Borçlusu', borc_kurus: 45000, seans_sayisi: 1 }],
    })
    await yanitlarAkti(eylul.promise)

    expect(screen.getByRole('heading', { name: 'Ekim 2026' })).toBeDefined()
    expect(deger('Gelinen seans')).toBe('2')
    expect(deger('Tahsilat')).toBe('1.200,00 TL')
    expect(deger('Bekleyen')).toBe('300,00 TL')
    expect(screen.getByRole('button', { name: /Ekim Borçlusu/ })).toBeDefined()
    expect(document.body.textContent).not.toContain('3.150,00 TL')
    expect(document.body.textContent).not.toContain('Eylül Borçlusu')
  })

  it('SIRA DISI HATA: Eylul istegi Ekim den sonra REDDEDILIRSE Ekim ekraninda hata cikmaz', async () => {
    const eylul = kapi<AyOzetiVerisi>()
    const ekim = kapi<AyOzetiVerisi>()
    const ayOzeti = vi.fn((ay: string) => (ay === '2026-09' ? eylul.promise : ekim.promise))
    render(<AyOzeti bugun="2026-09-16" onDanisanAc={vi.fn()} />, { ayOzeti })

    await userEvent.click(screen.getByRole('button', { name: 'Sonraki ay' }))
    ekim.coz({ ay: '2026-10', seans_sayisi: 2, tahsilat_kurus: 120000, bekleyen_kurus: 0, borclular: [] })
    await screen.findByText('1.200,00 TL')

    eylul.reddet(new Error('EYLUL-HATASI'))
    await yanitlarAkti(eylul.promise)

    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toContain('EYLUL-HATASI')
    expect(deger('Tahsilat')).toBe('1.200,00 TL')
  })

  it('aralik -> ocak yil devreder', async () => {
    const ayOzeti = vi.fn().mockResolvedValue(bosOzet('2026-12'))
    render(<AyOzeti bugun="2026-12-05" onDanisanAc={vi.fn()} />, { ayOzeti })
    expect(screen.getByRole('heading', { name: 'Aralık 2026' })).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki ay' }))
    expect(ayOzeti).toHaveBeenLastCalledWith('2027-01')
    expect(screen.getByRole('heading', { name: 'Ocak 2027' })).toBeDefined()
  })

  it('ocak -> aralik geri yonde yil geri devreder', async () => {
    const ayOzeti = vi.fn().mockResolvedValue(bosOzet('2027-01'))
    render(<AyOzeti bugun="2027-01-20" onDanisanAc={vi.fn()} />, { ayOzeti })
    expect(ayOzeti).toHaveBeenCalledExactlyOnceWith('2027-01')
    await userEvent.click(screen.getByRole('button', { name: 'Önceki ay' }))
    expect(ayOzeti).toHaveBeenLastCalledWith('2026-12')
    expect(screen.getByRole('heading', { name: 'Aralık 2026' })).toBeDefined()
    // Yıl içinde geri: Aralık -> Kasım (ay sayısı sıfır dolgulu kalır).
    await userEvent.click(screen.getByRole('button', { name: 'Önceki ay' }))
    expect(ayOzeti).toHaveBeenLastCalledWith('2026-11')
    expect(ayOzeti.mock.calls.map((c) => c[0])).toEqual(['2027-01', '2026-12', '2026-11'])
  })

  it('acilis tek istek; ayni ay icin yeniden render istek atmaz', async () => {
    const ayOzeti = vi.fn().mockResolvedValue(bosOzet('2026-09'))
    const { rerender } = render(<AyOzeti bugun="2026-09-16" onDanisanAc={vi.fn()} />, { ayOzeti })
    await screen.findByText('Bu ay bekleyen ödeme yok.')
    // Üst bileşen her render'da YENİ bir geri çağrı ve (gün dönse bile) yeni
    // bir `bugun` geçirir. Özet görüntülemesi denetim kaydına düşüyor.
    rerender(<AyOzeti bugun="2026-09-16" onDanisanAc={vi.fn()} />)
    rerender(<AyOzeti bugun="2026-09-17" onDanisanAc={vi.fn()} />)
    await yanitlarAkti(Promise.resolve())
    expect(ayOzeti).toHaveBeenCalledExactlyOnceWith('2026-09')
  })

  it('borclu satirina tiklamak danisani acar; borclu yoksa bunu soyler', async () => {
    const onDanisanAc = vi.fn()
    const ayOzeti = vi.fn().mockResolvedValue({
      ...bosOzet('2026-09'),
      borclular: [
        { client_id: 42, ad_soyad: 'Ayşe Yılmaz', borc_kurus: 90000, seans_sayisi: 2 },
        { client_id: 57, ad_soyad: 'Mehmet Demir', borc_kurus: 45000, seans_sayisi: 1 },
      ],
    })
    const { unmount } = render(<AyOzeti bugun="2026-09-16" onDanisanAc={onDanisanAc} />, { ayOzeti })
    const ayse = await screen.findByRole('button', { name: /Ayşe Yılmaz/ })
    expect(ayse.textContent).toContain('900,00 TL')
    expect(ayse.textContent).toContain('2 seans')
    // Borçlu varken "borç yok" cümlesi YOK (her zaman basan bir uygulama
    // aşağıdaki artı yönü de geçerdi).
    expect(screen.queryByText('Bu ay bekleyen ödeme yok.')).toBeNull()
    await userEvent.click(ayse)
    // İKİNCİ satır kendi kimliğini taşır (her satırda ilk borçluyu açan bir
    // uygulama tek satırlı listeyle ayırt edilemezdi).
    await userEvent.click(screen.getByRole('button', { name: /Mehmet Demir/ }))
    expect(onDanisanAc.mock.calls).toEqual([[42], [57]])
    unmount()

    render(<AyOzeti bugun="2026-09-16" onDanisanAc={onDanisanAc} />, { ayOzeti: vi.fn().mockResolvedValue(bosOzet('2026-09')) })
    expect(await screen.findByText('Bu ay bekleyen ödeme yok.')).toBeDefined()
  })

  it('kapsam cumlesi her zaman gorunur: yuklenirken, yuklenince ve hata varken', async () => {
    const eylul = kapi<AyOzetiVerisi>()
    const ekim = kapi<AyOzetiVerisi>()
    const ayOzeti = vi.fn((ay: string) => (ay === '2026-09' ? eylul.promise : ekim.promise))
    render(<AyOzeti bugun="2026-09-16" onDanisanAc={vi.fn()} />, { ayOzeti })
    const cumle = () => screen.getByText(KAPSAM_CUMLESI)

    expect(KAPSAM_CUMLESI).toBe(
      "Yalnızca 'geldi' olarak işaretlenen seanslar sayılır; 'gelmedi' ve 'iptal' dahil değildir.",
    )
    expect(cumle()).toBeDefined() // yüklenirken
    eylul.coz(bosOzet('2026-09'))
    await screen.findByText('Bu ay bekleyen ödeme yok.')
    expect(cumle()).toBeDefined() // yüklenince

    await userEvent.click(screen.getByRole('button', { name: 'Sonraki ay' }))
    ekim.reddet(new Error('Disk okunamadı.'))
    expect((await screen.findByRole('alert')).textContent).toContain('Disk okunamadı.')
    expect(cumle()).toBeDefined() // hata varken
  })

  it('401 merkezi mekanizmadan gecer; bilesen kendi hata metnini basmaz', async () => {
    const dinleyici = vi.fn()
    const birak = yetkisizOlunca(dinleyici)
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({ hata: 'OTURUM-KILITLI-METNI' }),
    })) as unknown as typeof fetch
    try {
      // `ayOzeti: null` -> GERÇEK `ozetApi.ayOzeti`, gerçek `istek()`.
      render(<AyOzeti bugun="2026-09-16" onDanisanAc={vi.fn()} />, { ayOzeti: null })
      await waitFor(() => expect(dinleyici).toHaveBeenCalledTimes(1))
      await yanitlarAkti(Promise.resolve())
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('/api/ay-ozeti?ay=2026-09')
      expect(screen.queryByRole('alert')).toBeNull()
      expect(document.body.textContent).not.toContain('OTURUM-KILITLI-METNI')
      expect(deger('Tahsilat')).toBe('…')
    } finally {
      birak()
    }
  })

  // Görev 4 inceleme M2. İki yön: hata varken düğme AYNI ayı yeniden ister
  // ve başarıda sayılar görünür; yüklü özette düğme YOKTUR (her basış
  // sunucuda bir görüntüleme kaydı daha).
  it('hata sonrasi Yeniden dene AYNI ayi TEK istekle yeniden ister; basarida sayilar gorunur ve hata kalkar', async () => {
    const ikinci = kapi<AyOzetiVerisi>()
    const ayOzeti = vi
      .fn()
      .mockRejectedValueOnce(new Error('GECICI-HATA'))
      .mockReturnValueOnce(ikinci.promise)
    render(<AyOzeti bugun="2026-09-16" onDanisanAc={vi.fn()} />, { ayOzeti })

    const uyari = await screen.findByRole('alert')
    expect(uyari.textContent).toContain('GECICI-HATA')
    expect(ayOzeti).toHaveBeenCalledTimes(1)

    await userEvent.click(within(uyari).getByRole('button', { name: 'Yeniden dene' }))
    expect(ayOzeti).toHaveBeenCalledTimes(2)
    expect(ayOzeti).toHaveBeenLastCalledWith('2026-09')
    // Yeniden deneme sürerken eski hata ekranda kalmaz; sayılar "…".
    expect(screen.queryByRole('alert')).toBeNull()
    expect(deger('Tahsilat')).toBe('…')

    ikinci.coz({ ay: '2026-09', seans_sayisi: 3, tahsilat_kurus: 123450, bekleyen_kurus: 0, borclular: [] })
    await screen.findByText('1.234,50 TL')
    expect(deger('Gelinen seans')).toBe('3')
    expect(screen.queryByRole('button', { name: 'Yeniden dene' })).toBeNull()
    expect(ayOzeti).toHaveBeenCalledTimes(2)
  })

  it('401 disi hata duyurulur ve sayilar gosterilmez', async () => {
    const ayOzeti = vi.fn().mockRejectedValue(new Error('Ay YYYY-AA biçiminde olmalı.'))
    render(<AyOzeti bugun="2026-09-16" onDanisanAc={vi.fn()} />, { ayOzeti })
    const uyari = await screen.findByRole('alert')
    expect(uyari.textContent).toContain('Ay YYYY-AA biçiminde olmalı.')
    expect(deger('Gelinen seans')).toBe('—')
    expect(deger('Tahsilat')).toBe('—')
    expect(deger('Bekleyen')).toBe('—')
    expect(within(screen.getByRole('region', { name: 'Ay sonu özeti' })).queryByText('Bu ay bekleyen ödeme yok.')).toBeNull()
  })
})
