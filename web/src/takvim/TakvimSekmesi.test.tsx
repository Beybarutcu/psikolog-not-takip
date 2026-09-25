import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { yerelGun } from '../screens/anaEkranKancalari/yerelGun'
import type { useSeansNotlari } from '../screens/anaEkranKancalari/useSeansNotlari'
import type { useTakvimAkisi } from '../screens/anaEkranKancalari/useTakvimAkisi'
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
    panelAcik: false,
    oturumKapandi: vi.fn(),
    haftaDegis: vi.fn(),
    // Görev 5: mutlak gezinme ("Bugün" düğmesi, gün seçici). Sonraki
    // görevler bu taklide başka alanlar ekleyecek.
    haftayaGit: vi.fn(),
    randevuSec: vi.fn(),
    bosSaatSec: vi.fn(),
    panelKapat: vi.fn(),
    kaydet: vi.fn(async () => {}),
    durumDegis: vi.fn(async () => ({})),
    odemeDegis: vi.fn(async () => {}),
    sil: vi.fn(async () => {}),
    seriSil: vi.fn(async () => {}),
  }
}

function bosSeansAkisi(): ReturnType<typeof useSeansNotlari> {
  return {
    seans: { id: null, not: null, ozelNot: null, ozelHata: null, gecmisNotlar: [], hata: null },
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
})
