import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DanisanSeansi, NotAramaSonucu, NotAramaYaniti, SeansNotu } from '../api'
import { ARAMA_GECIKMESI_MS, DigerSeanslar } from './DigerSeanslar'

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
// Sunucu sırası: yeniden eskiye, eşitlikte büyük kimlik önce
// (`danisan_seanslari`: `ORDER BY a.baslangic DESC, a.id DESC`). Bu seans
// 14 Eylül (300), "şimdi" 27 Eylül 12:00 (`SIMDI`).
//
// - 500: gelecekte ve notu YOK -> listede yok (okunacak bir şey yok).
// - 450: gelecekte ama notu VAR -> listede, işaretin üstünde.
// - 400: bu seanstan sonra, geçmişte -> işaretin üstünde.
// - 301: AYNI dakikada başlayan başka bir seans (çift kayıt). Sunucu
//   sırasında 300'ün ÜSTÜNDE (büyük kimlik): işaretin üstünde.
// - 300: bu seansın kendisi -> listede YOK, yerinde "Bu seans" işareti.
// - 299: AYNI dakikada, kimliği KÜÇÜK: sunucu sırasında 300'ün ALTINDA,
//   işaretin altında (eşitlikte `>=` kıyası onu yanlışlıkla üste alırdı).
// - 200, 100: bu seanstan önceki seanslar -> işaretin altında.
const LISTE: DanisanSeansi[] = [
  seans({ appointment_id: 500, baslangic: '2026-10-05T10:00', not_ilk_satiri: null, durum: 'planlandi', odendi: false }),
  seans({ appointment_id: 450, baslangic: '2026-10-01T10:00', not_ilk_satiri: 'GELECEK NOTLU', durum: 'planlandi', odendi: false }),
  seans({ appointment_id: 400, baslangic: '2026-09-21T10:00', not_ilk_satiri: 'SONRAKI SEANS' }),
  seans({ appointment_id: 301, baslangic: '2026-09-14T10:00', not_ilk_satiri: 'AYNI DAKIKA' }),
  seans({ appointment_id: 300, baslangic: '2026-09-14T10:00', not_ilk_satiri: 'BU SEANS' }),
  seans({ appointment_id: 299, baslangic: '2026-09-14T10:00', not_ilk_satiri: 'AYNI DAKIKA KUCUK KIMLIK' }),
  seans({ appointment_id: 200, baslangic: '2026-09-07T10:00', not_ilk_satiri: 'Uyku düzeni iyileşmiş', durum: 'gelmedi', odendi: false }),
  seans({ appointment_id: 100, baslangic: '2026-08-31T10:00', not_ilk_satiri: null }),
]
const SIMDI = '2026-09-27T12:00'
const ISARET = 'BU SEANS ISARETI'
function not(id: number, icerik: string): SeansNotu {
  return {
    appointment_id: id, client_id: 1, danisan_adi: 'Ayşe Yılmaz', seans_zamani: '2026-09-07T10:00',
    sablon: 'serbest', icerik, onizleme: null, guncelleme_zamani: 'z',
  }
}
/** `notApi.notAra` yanıtı (sunucudaki `NotAramaYaniti`). */
function yanit(sonuclar: NotAramaSonucu[], kirpildi = false): NotAramaYaniti {
  return { sonuclar, kirpildi }
}
async function ilerle(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}
function kur(ozel: Partial<React.ComponentProps<typeof DigerSeanslar>> = {}) {
  const props = {
    danisanId: 1, seansId: 300, seansBaslangici: '2026-09-14T10:00', simdi: SIMDI,
    onSeansaGit: vi.fn(), onGenislikDegisti: vi.fn(), ...ozel,
  }
  const sonuc = render(<DigerSeanslar {...props} />)
  return { ...props, rerender: sonuc.rerender }
}
const bolge = () => screen.getByRole('region', { name: 'Diğer seanslar' })
/** Listenin BÜTÜN öğeleri, işaret dahil, ekrandaki sırayla. */
const ogeler = () => within(bolge()).queryAllByRole('listitem')
const isaretMi = (li: HTMLElement) => li.getAttribute('aria-current') === 'true'
/** Açılabilen satırlar (işaret hariç). */
const satirlar = () => ogeler().filter((li) => !isaretMi(li))
const isaret = () => ogeler().find(isaretMi)
/**
 * Ekrandaki sıra: her satırın tarih-saati, işaretin yerinde `ISARET`.
 * Satır metni tarih-saatle başlar (`zamanMetni`).
 */
const sira = () =>
  ogeler().map((li) => (isaretMi(li) ? ISARET : (/^\d+ \S+ \d{4}, \d\d:\d\d/.exec(li.textContent ?? '')?.[0] ?? li.textContent)))
/** Tarih-saatiyle bir satırın düğmesi (dizine bağlı değil). */
const satirDugmesi = (tarih: string) => within(bolge()).getByRole('button', { name: new RegExp(`^${tarih}`) })
const kutu = () => screen.getByRole('searchbox', { name: 'Diğer seanslarda ara' })

type SanalKonsol = {
  on(olay: 'jsdomError', dinleyici: (e: Error) => void): unknown
  off(olay: 'jsdomError', dinleyici: (e: Error) => void): unknown
}

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
  t.notAra.mockReset().mockResolvedValue(yanit([]))
  t.notGetir.mockReset()
  t.pencere.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('DigerSeanslar (tasarım N5-N9, 2026-09-27 değişikliği)', () => {
  it('8.1 N5: bu seans DIŞINDAKİ seanslar yeniden eskiye; sonrakiler "Bu seans" işaretinin ÜSTÜNDE, öncekiler ALTINDA; simgeler; "Not yazılmamış"; not İSTENMEZ', async () => {
    kur()
    await ilerle(0)
    expect(sira()).toEqual([
      '1 Ekim 2026, 10:00',
      '21 Eylül 2026, 10:00',
      '14 Eylül 2026, 10:00',
      ISARET,
      '14 Eylül 2026, 10:00',
      '7 Eylül 2026, 10:00',
      '31 Ağustos 2026, 10:00',
    ])
    const s = satirlar()
    expect(s[0].textContent).toContain('GELECEK NOTLU')
    expect(s[1].textContent).toContain('SONRAKI SEANS')
    // Aynı dakika: büyük kimlik (301) işaretin ÜSTÜNDE, küçük kimlik (299) ALTINDA.
    expect(s[2].textContent).toContain('AYNI DAKIKA')
    expect(s[2].textContent).not.toContain('KUCUK KIMLIK')
    expect(s[3].textContent).toContain('AYNI DAKIKA KUCUK KIMLIK')
    expect(s[4].textContent).toContain('Uyku düzeni iyileşmiş')
    expect(s[4].querySelector('[data-simge="gelmedi"]')).not.toBeNull()
    expect(s[4].querySelector('[data-simge="odeme"]')).not.toBeNull()
    expect(s[5].textContent).toContain('Not yazılmamış')
    // Açık seansın kendi satırı (önizlemesi) listede YOK; yerinde işaret.
    expect(bolge().textContent).not.toContain('BU SEANS')
    expect(isaret()!.textContent).toBe('Bu seans · 14 Eylül 2026, 10:00')
    expect(t.seanslar).toHaveBeenCalledTimes(1)
    expect(t.seanslar).toHaveBeenCalledWith(1)
    expect(t.notGetir).not.toHaveBeenCalled()
  })

  it('gelecekteki NOTSUZ seans listelenmez; notlu ve açılmış-boş gelecek seans listelenir; tam ŞİMDİ başlayan seans gelecek SAYILMAZ (baslangic > simdi)', async () => {
    t.seanslar.mockResolvedValue([
      seans({ appointment_id: 520, baslangic: '2026-10-12T10:00', not_ilk_satiri: '' }),
      seans({ appointment_id: 500, baslangic: '2026-10-05T10:00', not_ilk_satiri: null }),
      seans({ appointment_id: 450, baslangic: '2026-10-01T10:00', not_ilk_satiri: 'GELECEK NOTLU' }),
      seans({ appointment_id: 300, baslangic: '2026-09-14T10:00', not_ilk_satiri: 'BU SEANS' }),
    ])
    const p = kur({ simdi: '2026-10-05T09:59' })
    await ilerle(0)
    expect(sira()).toEqual(['12 Ekim 2026, 10:00', '1 Ekim 2026, 10:00', ISARET])
    expect(satirlar()[0].textContent).toContain('Not açıldı, henüz boş')

    // Saat 500'ün başlangıcına geldi: artık gelecek DEĞİL (geçmiş =
    // `baslangic <= simdi`, `dosyaOzeti`/`seansGruplari` ile aynı sınır),
    // notu yazılmamış da olsa listede. Liste yeniden İSTENMEZ.
    p.rerender(<DigerSeanslar {...p} simdi="2026-10-05T10:00" />)
    await ilerle(0)
    expect(sira()).toEqual(['12 Ekim 2026, 10:00', '5 Ekim 2026, 10:00', '1 Ekim 2026, 10:00', ISARET])
    expect(satirDugmesi('5 Ekim 2026, 10:00').textContent).toContain('Not yazılmamış')
    expect(t.seanslar).toHaveBeenCalledTimes(1)
  })

  it('"Bu seans" işareti düğme DEĞİL: tıklamak ve sağ tık hiçbir şey açmaz, istek atmaz', async () => {
    const p = kur()
    await ilerle(0)
    const li = isaret()!
    expect(li.tagName).toBe('LI')
    expect(within(li).queryByRole('button')).toBeNull()
    fireEvent.click(li)
    fireEvent.click(li, { ctrlKey: true })
    fireEvent.contextMenu(li)
    await ilerle(0)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(t.notGetir).not.toHaveBeenCalled()
    expect(t.pencere).not.toHaveBeenCalled()
    expect(p.onSeansaGit).not.toHaveBeenCalled()
    expect(p.onGenislikDegisti).not.toHaveBeenCalled()
  })

  it('8.2 N6: arama gecikmeli; tek harf istek atmaz; terim sunucuya, kesme (`once`) GİTMEZ; parçada terim vurgulu', async () => {
    const sonuc: NotAramaSonucu[] = [{ appointment_id: 200, seans_zamani: '2026-09-07T10:00', parca: 'Danışan bugün KAYGI anlattı' }]
    t.notAra.mockResolvedValue(yanit(sonuc))
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
    // Bu seanstan SONRAKİ notlar da aranır: kesme parametresi YOK (sunucu
    // `once` verilmezse bütün resmî notlarda arar).
    expect(t.notAra.mock.calls[0].slice(0, 2)).toEqual([1, 'kaygı'])
    expect(t.notAra.mock.calls[0][2]).toBeUndefined()
    const s = satirlar()
    expect(s).toHaveLength(1)
    expect(s[0].querySelector('mark')?.textContent).toBe('KAYGI')
    expect(s[0].querySelector('[data-simge="gelmedi"]')).not.toBeNull()
  })

  it('arama sonucunda açık seans GÖRÜNMEZ; sonraki seansın eşleşmesi işaretin ÜSTÜNDE, öncekininki ALTINDA', async () => {
    t.notAra.mockResolvedValue(yanit([
      { appointment_id: 400, seans_zamani: '2026-09-21T10:00', parca: 'sonra da KAYGI' },
      { appointment_id: 300, seans_zamani: '2026-09-14T10:00', parca: 'ACIK SEANSIN KAYGI PARCASI' },
      { appointment_id: 200, seans_zamani: '2026-09-07T10:00', parca: 'once KAYGI' },
    ]))
    kur()
    await ilerle(0)
    fireEvent.change(kutu(), { target: { value: 'kaygı' } })
    await ilerle(ARAMA_GECIKMESI_MS)
    expect(sira()).toEqual(['21 Eylül 2026, 10:00', ISARET, '7 Eylül 2026, 10:00'])
    expect(bolge().textContent).not.toContain('ACIK SEANSIN KAYGI PARCASI')
  })

  // İnceleme (2026-09-27): sunucu en fazla 500 sonuç döndürür; `once`
  // gönderilmeyince eski bir seans açıkken sonraki seansların eşleşmeleri de
  // bu sınıra girer. Kırpılma SÖYLENMEZSE işaretin altındaki boşluk "önceki
  // seanslarda geçmiyor" diye okunur.
  it('kırpılmış arama: sonuçların ALTINDA kaç eşleşme gösterildiğini ve terimi daraltmayı söyler (açık seans sayılmaz)', async () => {
    t.notAra.mockResolvedValue(yanit([
      { appointment_id: 400, seans_zamani: '2026-09-21T10:00', parca: 'sonra KAYGI' },
      { appointment_id: 301, seans_zamani: '2026-09-14T10:00', parca: 'ayni dakika KAYGI' },
      { appointment_id: 300, seans_zamani: '2026-09-14T10:00', parca: 'ACIK SEANS KAYGI' },
    ], true))
    kur()
    await ilerle(0)
    fireEvent.change(kutu(), { target: { value: 'kaygı' } })
    await ilerle(ARAMA_GECIKMESI_MS)
    expect(satirlar()).toHaveLength(2)
    const uyari = within(bolge()).getByText('Yalnızca en yeni 2 eşleşme gösteriliyor; daha eskileri için terimi daraltın.')
    // Listenin ALTINDA (kayan listenin dışında, hep görünür).
    const liste = within(bolge()).getByRole('list')
    expect(liste.compareDocumentPosition(uyari) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(liste.contains(uyari)).toBe(false)
    // Terim kutudan silinince uyarı da kalkar (liste kipinde kırpılma yok).
    fireEvent.change(kutu(), { target: { value: '' } })
    expect(within(bolge()).queryByText(/Yalnızca en yeni/)).toBeNull()
  })

  it('kırpılmamış arama: uyarı YOK', async () => {
    t.notAra.mockResolvedValue(yanit([{ appointment_id: 400, seans_zamani: '2026-09-21T10:00', parca: 'sonra KAYGI' }]))
    kur()
    await ilerle(0)
    fireEvent.change(kutu(), { target: { value: 'kaygı' } })
    await ilerle(ARAMA_GECIKMESI_MS)
    expect(satirlar()).toHaveLength(1)
    expect(within(bolge()).queryByText(/Yalnızca en yeni/)).toBeNull()
  })

  it('8.3 eşleşme yoksa bunu SÖYLER ("başka seans yok" gibi görünmez); işaret de gösterilmez', async () => {
    kur()
    await ilerle(0)
    fireEvent.change(kutu(), { target: { value: 'yokterim' } })
    await ilerle(ARAMA_GECIKMESI_MS)
    expect(bolge().textContent).toContain('Bu terim diğer seanslarda geçmiyor.')
    expect(bolge().textContent).not.toContain('Bu danışanın başka seansı yok.')
    expect(ogeler()).toHaveLength(0)
  })

  it('yalnızca açık seansın kendisi eşleşirse "terim geçmiyor" der (açık seans sonuç SAYILMAZ)', async () => {
    t.notAra.mockResolvedValue(yanit([{ appointment_id: 300, seans_zamani: '2026-09-14T10:00', parca: 'KAYGI' }]))
    kur()
    await ilerle(0)
    fireEvent.change(kutu(), { target: { value: 'kaygı' } })
    await ilerle(ARAMA_GECIKMESI_MS)
    expect(bolge().textContent).toContain('Bu terim diğer seanslarda geçmiyor.')
    expect(ogeler()).toHaveLength(0)
  })

  it('başka seans yoksa "Bu danışanın başka seansı yok." der; işaret gösterilmez', async () => {
    t.seanslar.mockResolvedValue([seans({ appointment_id: 300, baslangic: '2026-09-14T10:00', not_ilk_satiri: 'BU SEANS' })])
    kur()
    await ilerle(0)
    expect(bolge().textContent).toContain('Bu danışanın başka seansı yok.')
    expect(ogeler()).toHaveLength(0)
  })

  // Süzgecin eldiği tek şey notsuz gelecek seanslar: "başka seansı yok"
  // demek o seanslar varken yanlış olurdu.
  it('yalnızca notsuz gelecek seanslar varsa "başka seansı yok" DENMEZ, neden boş olduğu söylenir', async () => {
    t.seanslar.mockResolvedValue([
      seans({ appointment_id: 500, baslangic: '2026-10-05T10:00', not_ilk_satiri: null }),
      seans({ appointment_id: 300, baslangic: '2026-09-14T10:00', not_ilk_satiri: 'BU SEANS' }),
    ])
    kur()
    await ilerle(0)
    expect(bolge().textContent).toContain('Geçmişte başka seans yok; yaklaşan seanslara henüz not yazılmadı.')
    expect(bolge().textContent).not.toContain('Bu danışanın başka seansı yok.')
    expect(ogeler()).toHaveLength(0)
  })

  it('8.4 N7: tek tık geniş okuma açar, notu ister, bütün eşleşmeleri vurgular; "Listeye dön" kapatır', async () => {
    t.notAra.mockResolvedValue(yanit([{ appointment_id: 200, seans_zamani: '2026-09-07T10:00', parca: 'KAYGI' }]))
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

  // Kullanıcı kararı 2026-09-27: eski seans açıkken SONRAKİ seansın notu
  // da okunur ve oraya geçilir — N7/N8 önceki seanslarla AYNI.
  it('SONRAKİ seans: arama onu bulur, tek tık vurgulu geniş okuma, tarihe ikinci tık ve "Bu seansa git" o seansa geçer', async () => {
    t.notAra.mockResolvedValue(yanit([{ appointment_id: 400, seans_zamani: '2026-09-21T10:00', parca: 'yeni ÇARPINTI yakınması' }]))
    t.notGetir.mockResolvedValue(not(400, '<p>Bu hafta yeni <em>çarpıntı</em> yakınması</p>'))
    const p = kur()
    await ilerle(0)
    fireEvent.change(kutu(), { target: { value: 'carpinti' } })
    await ilerle(ARAMA_GECIKMESI_MS)
    expect(sira()).toEqual(['21 Eylül 2026, 10:00', ISARET])
    fireEvent.click(satirDugmesi('21 Eylül 2026, 10:00'))
    await ilerle(0)
    expect(p.onGenislikDegisti).toHaveBeenLastCalledWith(true)
    expect(t.notGetir).toHaveBeenCalledWith(400)
    expect([...bolge().querySelectorAll('.not-vurgu')].map((e) => e.textContent)).toEqual(['çarpıntı'])
    fireEvent.click(within(bolge()).getByRole('button', { name: '21 Eylül 2026, 10:00' }))
    expect(p.onSeansaGit).toHaveBeenLastCalledWith(400, '2026-09-21T10:00')
    fireEvent.click(within(bolge()).getByRole('button', { name: 'Bu seansa git' }))
    expect(p.onSeansaGit).toHaveBeenCalledTimes(2)
    expect(p.onSeansaGit).toHaveBeenLastCalledWith(400, '2026-09-21T10:00')
  })

  it('notlu GELECEK seans listeden açılır ve "Bu seansa git" ona geçer', async () => {
    t.notGetir.mockResolvedValue(not(450, '<p>hazirlik notu</p>'))
    const p = kur()
    await ilerle(0)
    fireEvent.click(satirDugmesi('1 Ekim 2026, 10:00'))
    await ilerle(0)
    expect(t.notGetir).toHaveBeenCalledWith(450)
    expect(bolge().textContent).toContain('hazirlik notu')
    fireEvent.click(within(bolge()).getByRole('button', { name: 'Bu seansa git' }))
    expect(p.onSeansaGit).toHaveBeenCalledWith(450, '2026-10-01T10:00')
  })

  it('8.5 notu yazılmamış seans açılınca istek ATILMAZ (bakılmayan not için görüntüleme satırı yok)', async () => {
    kur()
    await ilerle(0)
    fireEvent.click(satirDugmesi('31 Ağustos 2026, 10:00'))
    await ilerle(0)
    expect(t.notGetir).not.toHaveBeenCalled()
    expect(bolge().textContent).toContain('Bu seans için not yazılmamış.')
  })

  it('8.6 N8: açık satırın tarihine ikinci tık ve "Bu seansa git" o seansa geçer', async () => {
    t.notGetir.mockResolvedValue(not(200, '<p>eski</p>'))
    const p = kur()
    await ilerle(0)
    fireEvent.click(satirDugmesi('7 Eylül 2026, 10:00'))
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
    const dugme = satirDugmesi('7 Eylül 2026, 10:00')
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

  it('sağ tık menüsü SONRAKİ seansta da çalışır', async () => {
    kur()
    await ilerle(0)
    fireEvent.contextMenu(satirDugmesi('21 Eylül 2026, 10:00'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Yeni pencerede aç' }))
    expect(t.pencere).toHaveBeenLastCalledWith(400)
  })

  // Taşıma (tasarım A6): sayfa AYNI seans kimliğiyle kalır, yalnızca başlangıç
  // değişir; liste yeniden İSTENMEZ ve işaret YENİ başlangıcın yerine geçer.
  // Listedeki bu seansın kaydı ESKİ başlangıcı taşır: kimlik süzgeci olmadan
  // seans kendi eski tarihiyle kendi listesinde görünürdü (dördüncü biçim:
  // geçiş).
  it('seans ileri taşınınca işaret YENİ başlangıcın yerine geçer, liste yeniden İSTENMEZ; bu seansın eski kaydı listeye GİRMEZ', async () => {
    const p = kur()
    await ilerle(0)
    expect(sira().indexOf(ISARET)).toBe(3)
    p.rerender(<DigerSeanslar {...p} seansBaslangici="2026-09-28T10:00" />)
    await ilerle(0)
    expect(sira()).toEqual([
      '1 Ekim 2026, 10:00',
      ISARET,
      '21 Eylül 2026, 10:00',
      '14 Eylül 2026, 10:00',
      '14 Eylül 2026, 10:00',
      '7 Eylül 2026, 10:00',
      '31 Ağustos 2026, 10:00',
    ])
    expect(isaret()!.textContent).toBe('Bu seans · 28 Eylül 2026, 10:00')
    expect(bolge().textContent).not.toContain('BU SEANS')
    expect(t.seanslar).toHaveBeenCalledTimes(1)
  })

  // "Seans tarihi zaman dilimine göre KAYMAZ" koruması: gece yarısına yakın
  // bir seans `Date`'e çevrilip UTC'ye kayarsa (TZ Europe/Istanbul) bir gün
  // önce görünür.
  it('gece yarısına yakın seansın tarihi KAYMAZ (Date kullanılmıyor)', async () => {
    t.seanslar.mockResolvedValue([seans({ appointment_id: 90, baslangic: '2026-08-31T00:30', not_ilk_satiri: 'gece' })])
    kur()
    await ilerle(0)
    expect(satirlar()[0].textContent).toContain('31 Ağustos 2026, 00:30')
  })

  it('liste yüklenemezse hata gösterilir, "başka seans yok" DENMEZ', async () => {
    t.seanslar.mockRejectedValue(new Error('Veritabanı okunamadı.'))
    kur()
    await ilerle(0)
    expect(within(bolge()).getByRole('alert').textContent).toContain('Veritabanı okunamadı.')
    expect(bolge().textContent).not.toContain('Bu danışanın başka seansı yok.')
  })

  it('arama başarısızsa hata gösterilir; "terim geçmiyor" DENMEZ', async () => {
    t.notAra.mockRejectedValue(new Error('Arama sunucuda düştü.'))
    kur()
    await ilerle(0)
    fireEvent.change(kutu(), { target: { value: 'kaygı' } })
    await ilerle(ARAMA_GECIKMESI_MS)
    expect(within(bolge()).getByRole('alert').textContent).toContain('Arama sunucuda düştü.')
    expect(bolge().textContent).not.toContain('Bu terim diğer seanslarda geçmiyor.')
  })

  it('aynı terimin SON aramasının sonucu geçerli: başarı eski hatayı, hata eski sonucu kaldırır', async () => {
    // Dal sonu incelemesi (Görev 8 minor): başarısız aramanın hatası aynı
    // terimin sonraki BAŞARILI aramasında kalıyordu; "Arama yapılamadı."
    // doğru sonuçların yanında duruyordu.
    const sonuc: NotAramaSonucu[] = [{ appointment_id: 200, seans_zamani: '2026-09-07T10:00', parca: 'KAYGI anlattı' }]
    t.notAra
      .mockRejectedValueOnce(new Error('Arama sunucuda düştü.'))
      .mockResolvedValueOnce(yanit(sonuc))
      .mockRejectedValueOnce(new Error('Yine düştü.'))
    kur()
    await ilerle(0)
    fireEvent.change(kutu(), { target: { value: 'kaygı' } })
    await ilerle(ARAMA_GECIKMESI_MS)
    expect(within(bolge()).getByRole('alert').textContent).toContain('Arama sunucuda düştü.')

    // Terim değişip (gecikme dolmadan) AYNI terime döner: aynı terim yeniden aranır.
    fireEvent.change(kutu(), { target: { value: 'kaygıx' } })
    fireEvent.change(kutu(), { target: { value: 'kaygı' } })
    await ilerle(ARAMA_GECIKMESI_MS)
    expect(t.notAra).toHaveBeenCalledTimes(2)
    expect(within(bolge()).queryByRole('alert')).toBeNull()
    expect(satirlar()).toHaveLength(1)

    fireEvent.change(kutu(), { target: { value: 'kaygıy' } })
    fireEvent.change(kutu(), { target: { value: 'kaygı' } })
    await ilerle(ARAMA_GECIKMESI_MS)
    expect(t.notAra).toHaveBeenCalledTimes(3)
    expect(within(bolge()).getByRole('alert').textContent).toContain('Yine düştü.')
    expect(satirlar()).toHaveLength(0)
  })

  it('açılan not okunamazsa hata gösterilir; "not yazılmamış" DENMEZ', async () => {
    t.notGetir.mockRejectedValue(new Error('Not okunamadı.'))
    kur()
    await ilerle(0)
    fireEvent.click(satirDugmesi('7 Eylül 2026, 10:00'))
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

  // Asıl risk yanlış tarihin altında yanlış notun görünmesi DEĞİL (onu
  // render'ın kimlik süzgeci zaten engeller): A'nın GEÇ yanıtı B açıkken
  // gelirse, `acikIdRef` olmasaydı B'nin zaten yüklenmiş notu sessizce ve
  // KALICI olarak "Not yükleniyor…"a dönerdi (bkz. `DigerSeanslar.tsx` modül
  // başlığı "acikIdRef NEYİ DÜZELTİR").
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
    fireEvent.click(satirDugmesi('7 Eylül 2026, 10:00'))
    fireEvent.click(within(bolge()).getByRole('button', { name: 'Listeye dön' }))
    fireEvent.click(satirDugmesi('31 Ağustos 2026, 10:00'))
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
describe('DigerSeanslar — liste kaynağı (preflight F7)', () => {
  it('önbellek varsa liste ondan gelir ve İSTEK ATILMAZ; önbellek yamanınca satır tazelenir', async () => {
    const p = kur({ onbellek: LISTE })
    await ilerle(0)
    expect(t.seanslar).not.toHaveBeenCalled()
    expect(satirlar()).toHaveLength(6)
    expect(satirDugmesi('7 Eylül 2026, 10:00').textContent).toContain('Uyku düzeni iyileşmiş')

    const yamali = LISTE.map((s) => (s.appointment_id === 200 ? { ...s, not_ilk_satiri: 'dosyada duzeltildi' } : s))
    p.rerender(<DigerSeanslar {...p} onbellek={yamali} />)
    await ilerle(0)
    expect(satirDugmesi('7 Eylül 2026, 10:00').textContent).toContain('dosyada duzeltildi')
    expect(t.seanslar).not.toHaveBeenCalled()
  })

  it('önbellek kalkarsa (bayat) BİR istek atılır; sonraki render yeni istek atmaz', async () => {
    const p = kur({ onbellek: LISTE })
    await ilerle(0)
    t.seanslar.mockResolvedValue([seans({ appointment_id: 200, baslangic: '2026-09-07T10:00', not_ilk_satiri: 'TAZE LISTE' })])
    p.rerender(<DigerSeanslar {...p} onbellek={null} />)
    await ilerle(0)
    expect(t.seanslar).toHaveBeenCalledTimes(1)
    expect(t.seanslar).toHaveBeenCalledWith(1)
    expect(satirlar()[0].textContent).toContain('TAZE LISTE')
    p.rerender(<DigerSeanslar {...p} onbellek={null} />)
    await ilerle(0)
    expect(t.seanslar).toHaveBeenCalledTimes(1)
  })
})

// Görev 6 incelemesi: Tauri'de `on_new_window` okuma penceresini KENDİSİ
// kurar ve isteği reddeder; `window.open` başarıda da `null` döner. Panel
// bunu hata saymamalı (uyarı yok, aynı pencerede gezinme yok).
describe('DigerSeanslar — gerçek okumaPenceresiniAc ile (Tauri: window.open null)', () => {
  it('"Yeni pencerede aç" null dönen window.open ile hata GÖSTERMEZ, ekran aynı kalır', async () => {
    const gercek = await vi.importActual<typeof import('./okumaPenceresi')>('./okumaPenceresi')
    t.pencere.mockImplementation(gercek.okumaPenceresiniAc)
    const ac = vi.spyOn(window, 'open').mockReturnValue(null)
    // jsdom gezinmeyi uygulamaz, yalnızca KENDİ sanal konsoluna bildirir
    // (testin `console`'u değil — bkz. `okumaPenceresi.test.ts`).
    const dom = (globalThis as { jsdom?: { virtualConsole: SanalKonsol } }).jsdom
    expect(dom, 'jsdom örneği yok: gezinme dinlenemez').toBeDefined()
    const jsdomHatalari: string[] = []
    const dinleyici = (e: Error) => jsdomHatalari.push(e.message)
    dom!.virtualConsole.on('jsdomError', dinleyici)
    try {
      const adres = window.location.href
      const p = kur()
      await ilerle(0)
      fireEvent.contextMenu(satirDugmesi('7 Eylül 2026, 10:00'))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Yeni pencerede aç' }))
      await ilerle(0)
      expect(ac).toHaveBeenCalledWith('/?okuma=200', 'okuma-200')
      expect(within(bolge()).queryByRole('alert')).toBeNull()
      expect(screen.queryByRole('menu')).toBeNull()
      expect(satirlar()).toHaveLength(6)
      expect(p.onGenislikDegisti).not.toHaveBeenCalled()
      expect(window.location.href).toBe(adres)
      expect(jsdomHatalari).toEqual([])
    } finally {
      dom!.virtualConsole.off('jsdomError', dinleyici)
    }
  })
})
