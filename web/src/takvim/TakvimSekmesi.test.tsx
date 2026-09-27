import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DanisanSeansi } from '../api'
import { yerelGun } from '../screens/anaEkranKancalari/yerelGun'
import type { useSeansNotlari } from '../screens/anaEkranKancalari/useSeansNotlari'
import type { useTakvimAkisi } from '../screens/anaEkranKancalari/useTakvimAkisi'
import type { Randevu } from './HaftalikTakvim'
import { TakvimSekmesi } from './TakvimSekmesi'

afterEach(() => vi.useRealTimers())

// Aynı desen `AyOzeti.test.tsx`'te: `ozetApi.ayOzeti` test başına
// değiştirilebilir bir taklitle çağrılıyor, geri kalan `../api` GERÇEK
// kalıyor (bu bileşen `aramaApi`/`takvimApi`'yi doğrudan içe aktarıyor,
// bkz. `TakvimSekmesi.tsx` modül başlığı — o ikisi bu testte hiç
// çağrılmıyor çünkü aşağıdaki varsayılan proplar arama kutusuna yazdırmıyor
// ve randevu panelini açmıyor).
const taklit = vi.hoisted(() => ({
  ayOzeti: async (ay: string): Promise<unknown> => ({
    ay,
    seans_sayisi: 0,
    tahsilat_kurus: 0,
    bekleyen_kurus: 0,
    borclular: [],
  }),
}))

vi.mock('../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../api')>()
  return {
    ...gercek,
    ozetApi: { ayOzeti: (ay: string) => taklit.ayOzeti(ay) },
  }
})

function bosTakvim(): ReturnType<typeof useTakvimAkisi> {
  return {
    haftaBasi: new Date(2026, 8, 7), // Pazartesi, 7 Eylül 2026
    randevular: [],
    hata: null,
    seciliRandevu: null,
    seciliBosSaat: null,
    oturumKapandi: vi.fn(),
    haftaDegis: vi.fn(),
    // Görev 5: mutlak gezinme ("Bugün" düğmesi, gün seçici). Sonraki
    // görevler bu taklide başka alanlar ekleyecek.
    haftayaGit: vi.fn(),
    randevuSec: vi.fn(),
    bosSaatSec: vi.fn(),
    panelKapat: vi.fn(),
    kaydet: vi.fn(async () => null),
    durumDegis: vi.fn(async () => ({})),
    odemeDegis: vi.fn(async () => {}),
    sil: vi.fn(async () => {}),
    seriSil: vi.fn(async () => {}),
    // Plan A Görev 10 (tasarım A6): kullanıcı seçiminin kaydırma isteği.
    kaydirmaIstegi: null,
    kaydirmaTamam: vi.fn(),
    // Görev 7 (tasarım N8): "Bu seansa git" ve bekleyen geçiş.
    randevuyaGit: vi.fn(),
    gecisBekliyor: false,
  }
}

function bosSeansAkisi(): ReturnType<typeof useSeansNotlari> {
  return {
    seans: { id: null, not: null, ozelNot: null, ozelHata: null, hata: null },
    notKaydet: vi.fn(async () => {}),
    notYansit: vi.fn(),
    ozelNotKaydet: vi.fn(async () => {}),
    ozelSekmeAcildi: vi.fn(),
    ozelYenidenDene: vi.fn(),
    yenidenDene: vi.fn(),
  }
}

function varsayilanProplar(ozelleştirme?: { ozetIstegi?: (ay: string) => Promise<unknown> }) {
  if (ozelleştirme?.ozetIstegi) {
    taklit.ayOzeti = ozelleştirme.ozetIstegi
  }
  return {
    takvim: bosTakvim(),
    seansAkisi: bosSeansAkisi(),
    ozet: { bugun: '2026-09-16', disTazeleme: 0 },
    danisanlar: [],
    onDanisanAc: vi.fn(),
    onDurumDegis: vi.fn(async () => {}),
    onOdemeDegis: vi.fn(async () => {}),
    onRandevuKaydet: vi.fn(async () => {}),
    onRandevuSil: vi.fn(async () => {}),
    onSeriSil: vi.fn(async () => {}),
    // Bu testlerde seans paneli hiç açılmıyor; bağlam hiç çağrılmaz.
    etiketBaglami: vi.fn(),
    onEtiketAc: vi.fn(),
    // Diğer seanslar paneli (Görev 8, preflight F7): dosyanın önbelleği boş
    // bir liste — panel bu testlerde istek atmaz ("başka seans yok").
    seansListesiOnbellegi: vi.fn((_clientId: number): DanisanSeansi[] | null => []),
  }
}

describe('TakvimSekmesi', () => {
  // Brief'teki sıralama testi `textContent.indexOf('Pzt')` /
  // `indexOf('Gelinen seans')` alt-dizi aramasıyla ölçüyordu — bu kırılgan:
  // "Ay sonu özeti" DÜĞMESİ zaten takvimden önce basılıyor ve metin araması
  // buton ile panel içeriğini ayırt etmiyor. Burada iki BİLİNEN düğümün
  // `compareDocumentPosition`'ı ölçülüyor: takvim ızgarası (`data-testid`)
  // ile açık özet panelinin (`role="region"`) DOM'daki gerçek sırası.
  // Özet KAPALI başladığı için önce açılıyor (mutasyon 1'in test ettiği kural
  // burada da doğru kalmalı: açma, `ozetIstegi` fırlatmasa da state'i
  // değiştiriyor).
  it('takvim, ay özeti panelinden önce gelir', async () => {
    render(<TakvimSekmesi {...varsayilanProplar()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Ay sonu özeti' }))

    const kok = screen.getByTestId('takvim-sekmesi')
    const izgara = screen.getByTestId('takvim-izgara')
    const ozetPaneli = screen.getByRole('region', { name: 'Ay sonu özeti' })

    expect(kok.contains(izgara)).toBe(true)
    expect(kok.contains(ozetPaneli)).toBe(true)
    // `izgara` -> `ozetPaneli` DOKÜMAN SIRASINDA İLERİDE demek: izgara önce.
    expect(
      izgara.compareDocumentPosition(ozetPaneli) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('ay özeti kapalı başlar ve istek atmaz', () => {
    const ozetIstegi = vi.fn()
    render(<TakvimSekmesi {...varsayilanProplar({ ozetIstegi })} />)
    expect(ozetIstegi).not.toHaveBeenCalled()
    // Proje bu paketin başka hiçbir testinde `jest-dom` eklentisini
    // kurmuyor (`test-kurulum.ts`'te yok) — matcher `toBeInTheDocument`
    // burada TANIMSIZ olurdu. `queryByText` zaten `null` döner; diğer tüm
    // testlerle aynı desen (`toBeNull()`).
    expect(screen.queryByText('Gelinen seans')).toBeNull()
  })
})

// Görev 5: gezinme ve başlık `HaftalikTakvim`den BURAYA taşındı — tek araç
// çubuğu (tasarım §4 A1). Oklar `HaftalikTakvim.test.tsx`teki AYNI
// senaryoyu ölçüyordu; başlık artık `#hafta-basligi` (DOM kancası, Görev
// 6'nın bugün vurgusu ve şimdi çizgisi de bunu kullanacak).
describe('TakvimSekmesi — araç çubuğu (Görev 5)', () => {
  it('hafta başlığını #hafta-basligi içinde gösterir', () => {
    render(<TakvimSekmesi {...varsayilanProplar()} />)
    const baslik = document.querySelector('#hafta-basligi')
    // bosTakvim().haftaBasi = 7 Eylül 2026 (Pazartesi).
    expect(baslik?.textContent).toBe('7 – 13 Eylül 2026')
  })

  it('ileri ve geri gezinme hafta değişimini bildirir', async () => {
    const props = varsayilanProplar()
    render(<TakvimSekmesi {...props} />)

    await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))
    expect(props.takvim.haftaDegis).toHaveBeenCalledWith(1)

    await userEvent.click(screen.getByRole('button', { name: 'Önceki hafta' }))
    expect(props.takvim.haftaDegis).toHaveBeenCalledWith(-1)
  })

  it('"Bugün" düğmesi takvim.haftayaGit\'i bugünün tarihiyle çağırır', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 24, 10, 0))
    const props = varsayilanProplar()
    render(<TakvimSekmesi {...props} />)

    await userEvent.click(screen.getByRole('button', { name: 'Bugün' }))

    expect(props.takvim.haftayaGit).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(props.takvim.haftayaGit).mock.calls[0][0]
    // Yerel GÜN karşılaştırılıyor: `haftayaGit`e giden argüman `simdi`den
    // (saat:dakika taşıyan bir Date) türüyor, saati değil günü sınıyoruz.
    expect(yerelGun(arg)).toBe('2026-09-24')
  })

  it('görünen hafta BU HAFTAYKEN "Bugün" düğmesi aria-disabled olur', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // bosTakvim().haftaBasi 7 Eylül 2026 (Pazartesi) — 10 Eylül AYNI hafta.
    vi.setSystemTime(new Date(2026, 8, 10, 10, 0))
    render(<TakvimSekmesi {...varsayilanProplar()} />)

    expect(screen.getByRole('button', { name: 'Bugün' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('hafta başlığına tıklayınca "Gidilecek gün" alanı açılır; gün girilince haftayaGit çağrılır ve alan kapanır', async () => {
    const props = varsayilanProplar()
    render(<TakvimSekmesi {...props} />)

    await userEvent.click(screen.getByRole('button', { name: '7 – 13 Eylül 2026' }))
    const gunAlani = screen.getByLabelText('Gidilecek gün')
    fireEvent.change(gunAlani, { target: { value: '2026-10-15' } })

    expect(props.takvim.haftayaGit).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(props.takvim.haftayaGit).mock.calls[0][0]
    expect(yerelGun(arg)).toBe('2026-10-15')
    // Kullanıcının açtığı alan, seçimden SONRA kendiliğinden kapanır.
    expect(screen.queryByLabelText('Gidilecek gün')).toBeNull()
  })

  // Son inceleme I1 (kontrolör R14): tarayıcı yılı rakam rakam yazarken her
  // tuşta `onChange` tam bir değerle gelir — ilk rakamda "0002-10-15", yani
  // `new Date(2, …)` = 1902. Alan eskiden ilk tuşta 1902'ye gidip kapanıyordu.
  it('R14 I1: yil rakam rakam yazilirken 2000-2099 disindaki ara degerler gezinmez ve alani KAPATMAZ; tam gun gider', async () => {
    const props = varsayilanProplar()
    render(<TakvimSekmesi {...props} />)

    await userEvent.click(screen.getByRole('button', { name: '7 – 13 Eylül 2026' }))
    const gunAlani = screen.getByLabelText('Gidilecek gün')
    // Tarayıcının kendi seçicisi de aynı pencereyi göstersin (danışan
    // kartının ve randevu formunun penceresi).
    expect(gunAlani.getAttribute('min')).toBe('2000-01-01')
    expect(gunAlani.getAttribute('max')).toBe('2099-12-31')

    for (const ara of ['0002-10-15', '0020-10-15', '0202-10-15']) {
      fireEvent.change(gunAlani, { target: { value: ara } })
      expect(props.takvim.haftayaGit).not.toHaveBeenCalled()
      // Alan AÇIK kaldı ve aynı düğüm (kullanıcı yazmaya devam ediyor).
      expect(screen.getByLabelText('Gidilecek gün')).toBe(gunAlani)
    }
    // Üst sınırın ötesi de gezinmez (iki yön).
    fireEvent.change(gunAlani, { target: { value: '2100-10-15' } })
    expect(props.takvim.haftayaGit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Gidilecek gün')).toBe(gunAlani)

    fireEvent.change(gunAlani, { target: { value: '2026-10-15' } })
    expect(props.takvim.haftayaGit).toHaveBeenCalledTimes(1)
    expect(yerelGun(vi.mocked(props.takvim.haftayaGit).mock.calls[0][0])).toBe('2026-10-15')
    expect(screen.queryByLabelText('Gidilecek gün')).toBeNull()
  })
})

// Görev 6 (tasarım A2): araç çubuğunun altındaki bilgi satırı. `bosTakvim()`
// -> `haftaBasi` her zaman 7 Eylül 2026 (Pazartesi); aşağıdaki senaryolar bu
// haftanın İÇİNDE ya da tam SINIRINDA `simdi` değerleri kullanıyor.
describe('TakvimSekmesi — bugün ve şimdi bilgi satırı (Görev 6)', () => {
  function randevu(id: number, baslangic: string, durum: string, ad: string): Randevu {
    return {
      id, client_id: id, danisan_adi: ad, baslangic,
      bitis: baslangic.slice(0, 11) + '23:00', durum,
      ucret: null, odendi: false, seri_id: null,
    }
  }

  it('6.5 hafta sınırını dakikalık tik ile geçince bilgi satırı kalkar, Bugün düğmesi aktif olur', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    // 13 Eylül 2026 Pazar 23:59 — bosTakvim().haftaBasi (7 Eylül Pazartesi)
    // İLE AYNI hafta, haftanın SON dakikası.
    vi.setSystemTime(new Date(2026, 8, 13, 23, 59))
    render(<TakvimSekmesi {...varsayilanProplar()} />)

    expect(screen.getByTestId('bugun-bilgisi').textContent).toBe('Bugün seans yok')
    expect(screen.getByRole('button', { name: 'Bugün' }).getAttribute('aria-disabled')).toBe('true')

    // `useDakikalikSimdi`nin dakikalık tiki: saat 00:00'a geçiyor, artık
    // 14 Eylül Pazartesi — YENİ hafta.
    await act(() => vi.advanceTimersByTimeAsync(60_000))

    expect(screen.queryByTestId('bugun-bilgisi')).toBeNull()
    expect(screen.getByRole('button', { name: 'Bugün' }).getAttribute('aria-disabled')).toBe('false')
  })

  it('6.6 bilgi satırı sayı ve sıradakini gösterir; ada tıklamak takvim.randevuSec\'i çağırır', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 9, 11, 30)) // 9 Eylül Çarşamba, aynı hafta.
    const props = varsayilanProplar()
    props.takvim.randevular = [
      randevu(1, '2026-09-09T14:00', 'planlandi', 'Ayşe Kaya'),
      randevu(2, '2026-09-09T09:00', 'geldi', 'X'),
      randevu(3, '2026-09-09T10:00', 'iptal', 'Y'),
    ]
    render(<TakvimSekmesi {...props} />)

    const satir = screen.getByTestId('bugun-bilgisi')
    expect(satir.textContent).toBe('Bugün 2 seans · sıradaki 14:00 Ayşe Kaya')

    // Izgaradaki blok da AYNI adı taşıyor ("14:00 Ayşe Kaya"); burada bilgi
    // satırındaki bağlantı ölçülüyor.
    fireEvent.click(within(satir).getByRole('button', { name: '14:00 Ayşe Kaya' }))
    // Plan A Görev 10: "sıradaki" bağlantısı bir KULLANICI seçimi (tasarım A6).
    expect(props.takvim.randevuSec).toHaveBeenCalledWith(props.takvim.randevular[0], { kaydir: true })
  })

  it('6.7 sıradaki yoksa yalnızca "Bugün N seans" gösterir', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 9, 11, 30))
    const props = varsayilanProplar()
    props.takvim.randevular = [
      randevu(1, '2026-09-09T09:00', 'geldi', 'X'),
      randevu(2, '2026-09-09T10:00', 'gelmedi', 'Y'),
    ]
    render(<TakvimSekmesi {...props} />)

    expect(screen.getByTestId('bugun-bilgisi').textContent).toBe('Bugün 2 seans')
  })
})

// Görev 7 (tasarım N1): var olan bir randevu seçilince ızgaranın YERİNE not
// sayfası açılır; boş saatin yeni randevu formu ızgaranın YANINDA kalır.
// Kaydırma isteği kancada (`kaydirmaIstegi`), burada yalnızca uygulanır ve
// tüketilir (Plan A Görev 10) — artık sayfanın başına.
describe('TakvimSekmesi — not sayfası ve kaydırma (Görev 7, Plan A Görev 10)', () => {
  afterEach(() => vi.restoreAllMocks())

  const secili: Randevu = {
    id: 101, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
    baslangic: '2026-09-07T10:00', bitis: '2026-09-07T11:00',
    durum: 'planlandi', ucret: null, odendi: false, seri_id: null,
  }

  /** Var olan bir randevu SEÇİLİ; not verisi henüz yolda (panel "yükleniyor"). */
  function seciliProplar(ozel: Partial<ReturnType<typeof useTakvimAkisi>> = {}) {
    const props = varsayilanProplar()
    props.takvim = {
      ...props.takvim,
      randevular: [secili],
      seciliRandevu: secili,
      ...ozel,
    }
    return props
  }

  it('7.11 N1: seçili randevuyken ızgara ve boş saat formu YOK, not sayfası var; ay özeti sayfadan SONRA', async () => {
    // Özet açılacak: taklit, önceki bir testin (`ozetIstegi: vi.fn()`)
    // bıraktığı `undefined` dönen hâlden bilerek geri kuruluyor.
    taklit.ayOzeti = async (ay: string) => ({ ay, seans_sayisi: 0, tahsilat_kurus: 0, bekleyen_kurus: 0, borclular: [] })
    const props = seciliProplar()
    const { rerender } = render(<TakvimSekmesi {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ay sonu özeti' }))
    const sayfa = screen.getByTestId('seans-bolumu')
    expect(screen.queryByTestId('takvim-izgara')).toBeNull()
    expect(sayfa.compareDocumentPosition(screen.getByRole('region', { name: 'Ay sonu özeti' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Hafta araç çubuğu yerinde (Takvim sekmesi seçili kalır).
    expect(screen.getByRole('button', { name: 'Sonraki hafta' })).toBeDefined()

    // GEÇİŞ (dördüncü biçim): seçim boş saate döndü -> ızgara ve YANINDA yeni randevu formu.
    rerender(<TakvimSekmesi {...props} takvim={{ ...props.takvim, seciliRandevu: null, seciliBosSaat: '2026-09-08T09:00' }} />)
    expect(screen.queryByTestId('seans-bolumu')).toBeNull()
    const yeni = screen.getByRole('heading', { name: 'Yeni randevu' })
    // Izgaranın YANINDA: ızgarayla aynı satır kabında, ızgaranın içinde değil.
    expect(screen.getByTestId('takvim-izgara').parentElement!.contains(yeni)).toBe(true)
    expect(screen.getByTestId('takvim-izgara').contains(yeni)).toBe(false)
  })

  it('7.12 "Takvime dön" takvim.panelKapat\'ı çağırır, haftaya DOKUNMAZ', async () => {
    const props = seciliProplar()
    render(<TakvimSekmesi {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'Takvime dön' }))
    expect(props.takvim.panelKapat).toHaveBeenCalledTimes(1)
    expect(props.takvim.haftaDegis).not.toHaveBeenCalled()
    expect(props.takvim.haftayaGit).not.toHaveBeenCalled()
  })

  it('7.13 seçim A\'dan B\'ye DOĞRUDAN değişince (Bu seansa git yolu) sayfa yeniden kurulur: açık form B\'ye sızmaz', async () => {
    const props = seciliProplar()
    const { rerender } = render(<TakvimSekmesi {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'Randevuyu düzenle' }))
    expect(screen.getByRole('heading', { name: 'Randevu' })).toBeDefined()
    const b: Randevu = { ...secili, id: 102, danisan_adi: 'Mehmet Demir' }
    rerender(<TakvimSekmesi {...props} takvim={{ ...props.takvim, randevular: [secili, b], seciliRandevu: b }} />)
    expect(screen.queryByRole('heading', { name: 'Randevu' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Mehmet Demir dosyasını aç' })).toBeDefined()
  })

  // İnceleme I1'in (Görev 9) doğrudan geçiş yüzü: `AnaEkran.test.tsx`'teki
  // "A ozel sekmedeyken B secilince panel RESMI sekmede acilir" artık B'ye
  // "Takvime dön" üzerinden gidiyor (sayfa ızgaranın yerinde, tasarım N1) ve
  // sayfa arada tümüyle kalkıyor. Seçimin A'dan B'ye DOĞRUDAN geçtiği yollar
  // (bilgi satırındaki "sıradaki", Görev 8'in aynı haftadaki "Bu seansa git"i)
  // yalnızca sayfanın `key`ine yaslanır: o olmasa B "Özel Notlarım"da açılır
  // ve terapist seans notunu özel nota yazar.
  it('7.13b doğrudan A->B geçişinde "Özel Notlarım" sekmesi B\'ye sızmaz: B resmî sekmede açılır', async () => {
    const props = seciliProplar()
    const { rerender } = render(<TakvimSekmesi {...props} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    expect(screen.getByRole('tab', { name: 'Özel Notlarım' }).getAttribute('aria-selected')).toBe('true')
    const b: Randevu = { ...secili, id: 102, danisan_adi: 'Mehmet Demir' }
    rerender(<TakvimSekmesi {...props} takvim={{ ...props.takvim, randevular: [secili, b], seciliRandevu: b }} />)
    expect(screen.getByRole('button', { name: 'Mehmet Demir dosyasını aç' })).toBeDefined()
    expect(screen.getByRole('tab', { name: 'Seans Notu' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Özel Notlarım' }).getAttribute('aria-selected')).toBe('false')
  })

  it('8.10 diğer seanslar paneli SEÇİLİ randevunun danışanının önbelleğiyle ve takvim.randevuyaGit ile bağlanır', async () => {
    const props = seciliProplar()
    const onceki: DanisanSeansi = {
      appointment_id: 90, baslangic: '2026-08-31T10:00', durum: 'geldi', ucret_kurus: null, odendi: false,
      not_ilk_satiri: null, etiketler: [],
    }
    props.seansListesiOnbellegi = vi.fn(() => [onceki])
    render(<TakvimSekmesi {...props} />)
    // Kimlik (101) değil DANIŞAN (1): önbellek danışan başına.
    expect(props.seansListesiOnbellegi).toHaveBeenCalledWith(secili.client_id)
    expect(props.seansListesiOnbellegi).not.toHaveBeenCalledWith(secili.id)
    const bolge = screen.getByRole('region', { name: 'Diğer seanslar' })
    await userEvent.click(within(bolge).getByRole('button', { name: /31 Ağustos 2026, 10:00/ }))
    await userEvent.click(within(bolge).getByRole('button', { name: 'Bu seansa git' }))
    expect(props.takvim.randevuyaGit).toHaveBeenCalledTimes(1)
    expect(props.takvim.randevuyaGit).toHaveBeenCalledWith(90, '2026-08-31T10:00')
  })

  // 2026-09-27: panel notsuz gelecek seansları eler; "gelecek" takvimin TEK
  // `simdi`sine göre (`useDakikalikSimdi`, bkz. modül başlığı). Sayfaya
  // `simdi` geçmeseydi ya da başka bir saat geçseydi bu sınır kayardı.
  it('8.11 diğer seanslar paneli takvimin TEK simdi değeriyle süzer: notsuz gelecek seans YOK, notlu gelecek ve notsuz geçmiş VAR', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0))
    const props = seciliProplar()
    const kayit = (appointment_id: number, baslangic: string, not_ilk_satiri: string | null): DanisanSeansi => ({
      appointment_id, baslangic, durum: 'planlandi', ucret_kurus: null, odendi: false, not_ilk_satiri, etiketler: [],
    })
    // Şimdi 9 Eylül 12:00: 93 bir dakika sonra (notsuz gelecek, elenir),
    // 91 tam şimdi (gelecek sayılmaz), 92 gelecekte ama notlu.
    props.seansListesiOnbellegi = vi.fn(() => [
      kayit(92, '2026-10-01T10:00', 'HAZIRLIK NOTU'),
      kayit(93, '2026-09-09T12:01', null),
      kayit(91, '2026-09-09T12:00', null),
      kayit(90, '2026-08-31T10:00', null),
    ])
    render(<TakvimSekmesi {...props} />)
    const bolge = screen.getByRole('region', { name: 'Diğer seanslar' })
    expect(within(bolge).queryByRole('button', { name: /^9 Eylül 2026, 12:01/ })).toBeNull()
    expect(within(bolge).getByRole('button', { name: /^1 Ekim 2026, 10:00/ })).toBeDefined()
    expect(within(bolge).getByRole('button', { name: /^9 Eylül 2026, 12:00/ })).toBeDefined()
    expect(within(bolge).getByRole('button', { name: /^31 Ağustos 2026, 10:00/ })).toBeDefined()
  })

  it('7.14 geçiş bekliyorken ızgaranın yerinde "Seans açılıyor…" durur', () => {
    const props = varsayilanProplar()
    render(<TakvimSekmesi {...props} takvim={{ ...props.takvim, gecisBekliyor: true }} />)
    expect(screen.getByRole('status').textContent).toBe('Seans açılıyor…')
    expect(screen.queryByTestId('takvim-izgara')).toBeNull()
  })

  it('10.8 kaydirmaIstegi secili randevununsa seans bolumu BIR kez kaydirilir ve istek tuketilir; null ise kaydirma yok', () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    const props = seciliProplar({ kaydirmaIstegi: null })
    const { rerender } = render(<TakvimSekmesi {...props} />)
    expect(kaydir).not.toHaveBeenCalled()
    expect(props.takvim.kaydirmaTamam).not.toHaveBeenCalled()

    rerender(<TakvimSekmesi {...props} takvim={{ ...props.takvim, kaydirmaIstegi: secili.id }} />)
    expect(kaydir).toHaveBeenCalledTimes(1)
    expect(kaydir.mock.contexts[0]).toBe(screen.getByTestId('seans-bolumu'))
    expect(kaydir).toHaveBeenCalledWith({ block: 'start' })
    expect(props.takvim.kaydirmaTamam).toHaveBeenCalledTimes(1)
  })

  it('izgaradaki blok ve aralik disi dugmesi takvim.randevuSec\'i { kaydir: true } ile cagirir', async () => {
    const props = varsayilanProplar()
    const gizli: Randevu = { ...secili, id: 102, baslangic: '2026-09-08T07:30', bitis: '2026-09-08T08:30' }
    props.takvim.randevular = [secili, gizli]
    render(<TakvimSekmesi {...props} />)

    await userEvent.click(screen.getByRole('button', { name: '10:00 Ayşe Yılmaz' }))
    expect(props.takvim.randevuSec).toHaveBeenLastCalledWith(secili, { kaydir: true })
    await userEvent.click(
      screen.getByRole('button', { name: 'Ayşe Yılmaz — 08.09 07:30 (aralık dışı) randevusunu aç' }),
    )
    expect(props.takvim.randevuSec).toHaveBeenLastCalledWith(gizli, { kaydir: true })
  })
})
