import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DanisanSeansi, NotAramaSonucu, SeansNotu } from '../api'
import { ARAMA_GECIKMESI_MS, OncekiNotlar } from './OncekiNotlar'

const t = vi.hoisted(() => ({ seanslar: vi.fn(), notAra: vi.fn(), notGetir: vi.fn(), pencere: vi.fn() }))
vi.mock('../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../api')>()
  return {
    ...gercek,
    danisanApi: { ...gercek.danisanApi, seanslar: t.seanslar },
    notApi: { ...gercek.notApi, notAra: t.notAra, notGetir: t.notGetir },
  }
})
vi.mock('./okumaPenceresi', () => ({ okumaPenceresiniAc: t.pencere }))

function seans(ozel: Partial<DanisanSeansi>): DanisanSeansi {
  return {
    appointment_id: 0, baslangic: '', durum: 'geldi', ucret_kurus: 45000, odendi: true,
    not_ilk_satiri: null, etiketler: [], ...ozel,
  }
}
// Sunucu sırası: yeniden eskiye. Bu seans 14 Eylül; bir SONRAKİ ve bir de kendisi listede.
// AYNI dakikada başlayan başka bir seans (çift kayıt) "önceki" DEĞİL: kesme
// sunucunun aramasıyla aynı, KESİN küçük (`<`).
const LISTE: DanisanSeansi[] = [
  seans({ appointment_id: 400, baslangic: '2026-09-21T10:00', not_ilk_satiri: 'SONRAKI SEANS' }),
  seans({ appointment_id: 301, baslangic: '2026-09-14T10:00', not_ilk_satiri: 'AYNI DAKIKA' }),
  seans({ appointment_id: 300, baslangic: '2026-09-14T10:00', not_ilk_satiri: 'BU SEANS' }),
  seans({ appointment_id: 200, baslangic: '2026-09-07T10:00', not_ilk_satiri: 'Uyku düzeni iyileşmiş', durum: 'gelmedi', odendi: false }),
  seans({ appointment_id: 100, baslangic: '2026-08-31T10:00', not_ilk_satiri: null }),
]
function not(id: number, icerik: string): SeansNotu {
  return {
    appointment_id: id, client_id: 1, danisan_adi: 'Ayşe Yılmaz', seans_zamani: '2026-09-07T10:00',
    sablon: 'serbest', icerik, onizleme: null, guncelleme_zamani: 'z',
  }
}
async function ilerle(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}
function kur(ozel: Partial<React.ComponentProps<typeof OncekiNotlar>> = {}) {
  const props = {
    danisanId: 1, seansId: 300, seansBaslangici: '2026-09-14T10:00',
    onSeansaGit: vi.fn(), onGenislikDegisti: vi.fn(), ...ozel,
  }
  const sonuc = render(<OncekiNotlar {...props} />)
  return { ...props, rerender: sonuc.rerender }
}
const bolge = () => screen.getByRole('region', { name: 'Önceki seans notları' })
const satirlar = () => within(bolge()).queryAllByRole('listitem')
const kutu = () => screen.getByRole('searchbox', { name: 'Önceki notlarda ara' })

/** Elle çözülen söz: yanıtların GELİŞ SIRASINI test kurar. */
function kapi<T>() {
  let coz!: (deger: T) => void
  const soz = new Promise<T>((c) => {
    coz = c
  })
  return { soz, coz }
}

beforeEach(() => {
  vi.useFakeTimers()
  t.seanslar.mockReset().mockResolvedValue(LISTE)
  t.notAra.mockReset().mockResolvedValue([])
  t.notGetir.mockReset()
  t.pencere.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('OncekiNotlar (tasarım N5-N9)', () => {
  it('8.1 N5: yalnızca BU seanstan önceki seanslar, yeniden eskiye; simgeler; "Not yazılmamış"; not İSTENMEZ', async () => {
    kur()
    await ilerle(0)
    const s = satirlar()
    expect(s).toHaveLength(2)
    expect(s[0].textContent).toContain('7 Eylül 2026, 10:00')
    expect(s[0].textContent).toContain('Uyku düzeni iyileşmiş')
    expect(s[0].querySelector('[data-simge="gelmedi"]')).not.toBeNull()
    expect(s[0].querySelector('[data-simge="odeme"]')).not.toBeNull()
    expect(s[1].textContent).toContain('31 Ağustos 2026, 10:00')
    expect(s[1].textContent).toContain('Not yazılmamış')
    expect(bolge().textContent).not.toContain('BU SEANS')
    expect(bolge().textContent).not.toContain('AYNI DAKIKA')
    expect(bolge().textContent).not.toContain('SONRAKI SEANS')
    expect(t.seanslar).toHaveBeenCalledTimes(1)
    expect(t.seanslar).toHaveBeenCalledWith(1)
    expect(t.notGetir).not.toHaveBeenCalled()
  })

  it('8.2 N6: arama gecikmeli; tek harf istek atmaz; terim ve kesme sunucuya; parçada terim vurgulu', async () => {
    const sonuc: NotAramaSonucu[] = [{ appointment_id: 200, seans_zamani: '2026-09-07T10:00', parca: 'Danışan bugün KAYGI anlattı' }]
    t.notAra.mockResolvedValue(sonuc)
    kur()
    await ilerle(0)
    fireEvent.change(kutu(), { target: { value: 'k' } })
    await ilerle(1000)
    expect(t.notAra).not.toHaveBeenCalled()
    fireEvent.change(kutu(), { target: { value: 'kaygı' } })
    await ilerle(ARAMA_GECIKMESI_MS - 1)
    expect(t.notAra).not.toHaveBeenCalled()
    await ilerle(1)
    expect(t.notAra).toHaveBeenCalledTimes(1)
    expect(t.notAra).toHaveBeenCalledWith(1, 'kaygı', '2026-09-14T10:00')
    const s = satirlar()
    expect(s).toHaveLength(1)
    expect(s[0].querySelector('mark')?.textContent).toBe('KAYGI')
    expect(s[0].querySelector('[data-simge="gelmedi"]')).not.toBeNull()
  })

  it('8.3 eşleşme yoksa bunu SÖYLER ("önceki seans yok" gibi görünmez)', async () => {
    kur()
    await ilerle(0)
    fireEvent.change(kutu(), { target: { value: 'yokterim' } })
    await ilerle(ARAMA_GECIKMESI_MS)
    expect(bolge().textContent).toContain('Bu terim önceki notlarda geçmiyor.')
    expect(bolge().textContent).not.toContain('Bu seanstan önce kayıtlı seans yok.')
  })

  it('8.4 N7: tek tık geniş okuma açar, notu ister, bütün eşleşmeleri vurgular; "Listeye dön" kapatır', async () => {
    t.notAra.mockResolvedValue([{ appointment_id: 200, seans_zamani: '2026-09-07T10:00', parca: 'KAYGI' }])
    t.notGetir.mockResolvedValue(not(200, '<p>Danışan <strong>KAYGI</strong> anlattı; kaygı azaldı</p>'))
    const p = kur()
    await ilerle(0)
    fireEvent.change(kutu(), { target: { value: 'kaygi' } })
    await ilerle(ARAMA_GECIKMESI_MS)
    fireEvent.click(within(satirlar()[0]).getByRole('button'))
    await ilerle(0)
    expect(p.onGenislikDegisti).toHaveBeenLastCalledWith(true)
    expect(t.notGetir).toHaveBeenCalledWith(200)
    expect([...bolge().querySelectorAll('.not-vurgu')].map((e) => e.textContent)).toEqual(['KAYGI', 'kaygı'])
    expect(within(bolge()).getByRole('button', { name: 'Bu seansa git' })).toBeDefined()
    fireEvent.click(within(bolge()).getByRole('button', { name: 'Listeye dön' }))
    expect(p.onGenislikDegisti).toHaveBeenLastCalledWith(false)
    expect(satirlar()).toHaveLength(1)
  })

  it('8.5 notu yazılmamış seans açılınca istek ATILMAZ (bakılmayan not için görüntüleme satırı yok)', async () => {
    kur()
    await ilerle(0)
    fireEvent.click(within(satirlar()[1]).getByRole('button'))
    await ilerle(0)
    expect(t.notGetir).not.toHaveBeenCalled()
    expect(bolge().textContent).toContain('Bu seans için not yazılmamış.')
  })

  it('8.6 N8: açık satırın tarihine ikinci tık ve "Bu seansa git" o seansa geçer', async () => {
    t.notGetir.mockResolvedValue(not(200, '<p>eski</p>'))
    const p = kur()
    await ilerle(0)
    fireEvent.click(within(satirlar()[0]).getByRole('button'))
    await ilerle(0)
    fireEvent.click(within(bolge()).getByRole('button', { name: '7 Eylül 2026, 10:00' }))
    expect(p.onSeansaGit).toHaveBeenLastCalledWith(200, '2026-09-07T10:00')
    fireEvent.click(within(bolge()).getByRole('button', { name: 'Bu seansa git' }))
    expect(p.onSeansaGit).toHaveBeenCalledTimes(2)
  })

  it('8.7 N9: sağ tık menüsü ve Ctrl/Cmd+tık okuma penceresini açar; seçim ve not isteği YOK', async () => {
    t.notGetir.mockResolvedValue(not(200, '<p>eski</p>'))
    const p = kur()
    await ilerle(0)
    const dugme = within(satirlar()[0]).getByRole('button')
    expect(screen.queryByRole('menu')).toBeNull()
    // `false`: varsayılan (tarayıcının kendi menüsü) bastırıldı.
    expect(fireEvent.contextMenu(dugme, { clientX: 10, clientY: 20 })).toBe(false)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Yeni pencerede aç' }))
    expect(t.pencere).toHaveBeenLastCalledWith(200)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(dugme, { ctrlKey: true })
    fireEvent.click(dugme, { metaKey: true })
    expect(t.pencere).toHaveBeenCalledTimes(3)
    expect(p.onGenislikDegisti).not.toHaveBeenCalled()
    expect(t.notGetir).not.toHaveBeenCalled()

    // "Bu seansa git"e sağ tık da AYNI menüyü açar ve menü ÇALIŞIR (preflight F9).
    fireEvent.click(dugme)
    await ilerle(0)
    const git = within(bolge()).getByRole('button', { name: 'Bu seansa git' })
    expect(fireEvent.contextMenu(git)).toBe(false)
    expect(screen.getByRole('menu')).toBeDefined()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Yeni pencerede aç' }))
    expect(t.pencere).toHaveBeenCalledTimes(4)
    expect(t.pencere).toHaveBeenLastCalledWith(200)
    expect(screen.queryByRole('menu')).toBeNull()
    // Ctrl/Cmd+tık "Bu seansa git"te de menüsüz pencere açar ve seansa GEÇMEZ (N9).
    fireEvent.click(git, { ctrlKey: true })
    fireEvent.click(git, { metaKey: true })
    expect(t.pencere).toHaveBeenCalledTimes(6)
    expect(t.pencere).toHaveBeenLastCalledWith(200)
    expect(p.onSeansaGit).not.toHaveBeenCalled()

    // Kapatma: Escape; menü dışına basmak; menünün İÇİNE basmak KAPATMAZ.
    fireEvent.contextMenu(git)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(git)
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeDefined()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(t.pencere).toHaveBeenCalledTimes(6)
  })

  // Taşıma (tasarım A6): sayfa AYNI seans kimliğiyle kalır, yalnızca başlangıç
  // değişir; liste yeniden İSTENMEZ ve YENİ başlangıçla süzülür. Listedeki bu
  // seansın kaydı ESKİ başlangıcı taşır: taşıma ileriyeyse o eski kayıt yeni
  // başlangıçtan "önce" kalır ve kimlik süzgeci olmadan seans kendi önceki
  // notları arasında görünürdü (dördüncü biçim: geçiş).
  it('seans ileri taşınınca liste YENİ başlangıçla süzülür, yeniden İSTENMEZ; bu seansın eski kaydı listeye GİRMEZ', async () => {
    const p = kur()
    await ilerle(0)
    expect(satirlar()).toHaveLength(2)
    p.rerender(<OncekiNotlar {...p} seansBaslangici="2026-09-28T10:00" />)
    await ilerle(0)
    const metin = bolge().textContent
    expect(metin).toContain('SONRAKI SEANS')
    expect(metin).toContain('AYNI DAKIKA')
    expect(metin).not.toContain('BU SEANS')
    expect(satirlar()).toHaveLength(4)
    expect(t.seanslar).toHaveBeenCalledTimes(1)
  })

  it('liste yüklenemezse hata gösterilir, "önceki seans yok" DENMEZ', async () => {
    t.seanslar.mockRejectedValue(new Error('Veritabanı okunamadı.'))
    kur()
    await ilerle(0)
    expect(within(bolge()).getByRole('alert').textContent).toContain('Veritabanı okunamadı.')
    expect(bolge().textContent).not.toContain('Bu seanstan önce kayıtlı seans yok.')
  })

  it('arama başarısızsa hata gösterilir; "terim geçmiyor" DENMEZ', async () => {
    t.notAra.mockRejectedValue(new Error('Arama sunucuda düştü.'))
    kur()
    await ilerle(0)
    fireEvent.change(kutu(), { target: { value: 'kaygı' } })
    await ilerle(ARAMA_GECIKMESI_MS)
    expect(within(bolge()).getByRole('alert').textContent).toContain('Arama sunucuda düştü.')
    expect(bolge().textContent).not.toContain('Bu terim önceki notlarda geçmiyor.')
  })

  it('açılan not okunamazsa hata gösterilir; "not yazılmamış" DENMEZ', async () => {
    t.notGetir.mockRejectedValue(new Error('Not okunamadı.'))
    kur()
    await ilerle(0)
    fireEvent.click(within(satirlar()[0]).getByRole('button'))
    await ilerle(0)
    expect(within(bolge()).getByRole('alert').textContent).toContain('Not okunamadı.')
    expect(bolge().textContent).not.toContain('Bu seans için not yazılmamış.')
  })

  // Preflight F19: `''` "not açılmış ama boş" demek (api.ts `DanisanSeansi`,
  // `SeansListesi` aynı ayrımı yapıyor). "Not yazılmamış" DEĞİL ve not
  // gerçekten var: açılınca istenir.
  it('boş not "Not yazılmamış" diye görünmez; açılınca istenir', async () => {
    t.seanslar.mockResolvedValue([seans({ appointment_id: 200, baslangic: '2026-09-07T10:00', not_ilk_satiri: '' })])
    t.notGetir.mockResolvedValue({ ...not(200, ''), onizleme: '' })
    kur()
    await ilerle(0)
    expect(satirlar()[0].textContent).toContain('Not açıldı, henüz boş')
    expect(satirlar()[0].textContent).not.toContain('Not yazılmamış')
    fireEvent.click(within(satirlar()[0]).getByRole('button'))
    await ilerle(0)
    expect(t.notGetir).toHaveBeenCalledWith(200)
    expect(bolge().textContent).toContain('Not açıldı, henüz boş.')
  })

  // Yanlış notu doğru tarihin altında göstermek: A'nın yanıtı B açıkken
  // B'ninkinden SONRA gelirse ekranda B'nin tarihi ve A'nın metni durur.
  it('geç dönen ESKİ not yanıtı, o sırada açılmış başka seansın okumasının yerine GEÇMEZ', async () => {
    t.seanslar.mockResolvedValue([
      seans({ appointment_id: 200, baslangic: '2026-09-07T10:00', not_ilk_satiri: 'A' }),
      seans({ appointment_id: 100, baslangic: '2026-08-31T10:00', not_ilk_satiri: 'B' }),
    ])
    const a = kapi<SeansNotu>()
    const b = kapi<SeansNotu>()
    t.notGetir.mockImplementation((id: number) => (id === 200 ? a.soz : b.soz))
    kur()
    await ilerle(0)
    fireEvent.click(within(satirlar()[0]).getByRole('button'))
    fireEvent.click(within(bolge()).getByRole('button', { name: 'Listeye dön' }))
    fireEvent.click(within(satirlar()[1]).getByRole('button'))
    b.coz(not(100, '<p>B SEANSININ NOTU</p>'))
    await ilerle(0)
    expect(bolge().textContent).toContain('B SEANSININ NOTU')
    a.coz(not(200, '<p>A SEANSININ NOTU</p>'))
    await ilerle(0)
    expect(bolge().textContent).toContain('31 Ağustos 2026, 10:00')
    expect(bolge().textContent).toContain('B SEANSININ NOTU')
    expect(bolge().textContent).not.toContain('A SEANSININ NOTU')
  })
})

// Preflight F7 (kontrolör kararı): liste danışan dosyasının seans listesi
// önbelleğinden (`useDanisanSeanslari`) beslenir; önbellekte bu danışan
// yoksa panel TEK istek atar. Her `/seanslar` okuması sunucuda silinemez bir
// `Goruntuleme | danisan_seanslari` satırıdır.
describe('OncekiNotlar — liste kaynağı (preflight F7)', () => {
  it('önbellek varsa liste ondan gelir ve İSTEK ATILMAZ; önbellek yamanınca satır tazelenir', async () => {
    const p = kur({ onbellek: LISTE })
    await ilerle(0)
    expect(t.seanslar).not.toHaveBeenCalled()
    expect(satirlar()).toHaveLength(2)
    expect(satirlar()[0].textContent).toContain('Uyku düzeni iyileşmiş')

    const yamali = LISTE.map((s) => (s.appointment_id === 200 ? { ...s, not_ilk_satiri: 'dosyada duzeltildi' } : s))
    p.rerender(<OncekiNotlar {...p} onbellek={yamali} />)
    await ilerle(0)
    expect(satirlar()[0].textContent).toContain('dosyada duzeltildi')
    expect(t.seanslar).not.toHaveBeenCalled()
  })

  it('önbellek kalkarsa (bayat) BİR istek atılır; sonraki render yeni istek atmaz', async () => {
    const p = kur({ onbellek: LISTE })
    await ilerle(0)
    t.seanslar.mockResolvedValue([seans({ appointment_id: 200, baslangic: '2026-09-07T10:00', not_ilk_satiri: 'TAZE LISTE' })])
    p.rerender(<OncekiNotlar {...p} onbellek={null} />)
    await ilerle(0)
    expect(t.seanslar).toHaveBeenCalledTimes(1)
    expect(t.seanslar).toHaveBeenCalledWith(1)
    expect(satirlar()[0].textContent).toContain('TAZE LISTE')
    p.rerender(<OncekiNotlar {...p} onbellek={null} />)
    await ilerle(0)
    expect(t.seanslar).toHaveBeenCalledTimes(1)
  })
})

// Görev 6 incelemesi: Tauri'de `on_new_window` okuma penceresini KENDİSİ
// kurar ve isteği reddeder; `window.open` başarıda da `null` döner. Panel
// bunu hata saymamalı (uyarı yok, aynı pencerede gezinme yok).
describe('OncekiNotlar — gerçek okumaPenceresiniAc ile (Tauri: window.open null)', () => {
  it('"Yeni pencerede aç" null dönen window.open ile hata GÖSTERMEZ, ekran aynı kalır', async () => {
    const gercek = await vi.importActual<typeof import('./okumaPenceresi')>('./okumaPenceresi')
    t.pencere.mockImplementation(gercek.okumaPenceresiniAc)
    const ac = vi.spyOn(window, 'open').mockReturnValue(null)
    const konsol = vi.spyOn(console, 'error')
    const adres = window.location.href
    const p = kur()
    await ilerle(0)
    fireEvent.contextMenu(within(satirlar()[0]).getByRole('button'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Yeni pencerede aç' }))
    await ilerle(0)
    expect(ac).toHaveBeenCalledWith('/?okuma=200', 'okuma-200')
    expect(within(bolge()).queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(satirlar()).toHaveLength(2)
    expect(p.onGenislikDegisti).not.toHaveBeenCalled()
    expect(window.location.href).toBe(adres)
    expect(konsol).not.toHaveBeenCalled()
  })
})
