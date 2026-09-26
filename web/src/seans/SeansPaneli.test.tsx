import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OzelNot, SeansNotu } from '../api'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { SeansPaneli } from './SeansPaneli'
import { taslakOku, taslaklariUnut } from './taslak'

const randevu: Randevu = {
  id: 101,
  client_id: 1,
  danisan_adi: 'Ayşe Yılmaz',
  baslangic: '2026-09-07T10:00',
  bitis: '2026-09-07T11:00',
  durum: 'planlandi',
  ucret: null,
  odendi: false,
  seri_id: null,
}

const resmiNot: SeansNotu = {
  appointment_id: 101,
  client_id: 1,
  danisan_adi: 'Ayşe Yılmaz',
  seans_zamani: '2026-09-07T10:00',
  sablon: 'dap',
  icerik: 'bu seansin resmi notu',
  onizleme: null,
  guncelleme_zamani: '2026-09-07T06:00:00Z',
}

// Sızıntı testlerinin kanaryası. Bu dizge resmî sekmede ve resmî nota giden
// hiçbir istekte GÖRÜNMEMELİ (sağ sütun: `SeansSayfasi.test.tsx` > "7.10").
const GIZLI = 'GIZLI-OZEL-ABC'

const ozelNot: OzelNot = {
  appointment_id: 101,
  icerik: GIZLI,
  guncelleme_zamani: '2026-09-07T06:00:00Z',
}

type PanelProps = React.ComponentProps<typeof SeansPaneli>

function propsKur(ozel: Partial<PanelProps> = {}) {
  return {
    randevu,
    not: resmiNot,
    ozelNot,
    onNotKaydet: vi.fn().mockResolvedValue(undefined),
    onOzelNotKaydet: vi.fn().mockResolvedValue(undefined),
    onOzelSekme: vi.fn(),
    ...ozel,
  }
}

function kur(ozel: Partial<PanelProps> = {}) {
  const props = propsKur(ozel)
  const sonuc = render(<SeansPaneli {...props} />)
  return { ...props, ...sonuc }
}

const resmiSekme = () => screen.getByRole('tab', { name: 'Seans Notu' })
const ozelSekme = () => screen.getByRole('tab', { name: 'Özel Notlarım' })

beforeEach(() => {
  taslaklariUnut()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// WAI-ARIA tab deseni: sekme şeridi klavyede tek durak, içinde ok
// tuşlarıyla gezilir. Ayrıca aynı anda TEK `tabpanel` render edildiği
// için `aria-controls` yalnızca seçili sekmede olabilir — seçili
// olmayanınki var olmayan bir id'yi gösterirdi.
describe('SeansPaneli — sekme klavye erişimi', () => {
  it('secili olmayan sekmenin aria-controls u VAR OLMAYAN bir id gostermez', () => {
    kur()
    // Resmî sekme seçili: onun hedefi ekranda VAR.
    const resmiHedef = resmiSekme().getAttribute('aria-controls')
    expect(resmiHedef).toBe('panel-resmi')
    expect(document.getElementById(resmiHedef!)).not.toBeNull()

    // Özel sekme seçili DEĞİL: ya hedefi yok ya da hedefi ekranda var.
    const ozelHedef = ozelSekme().getAttribute('aria-controls')
    if (ozelHedef !== null) expect(document.getElementById(ozelHedef)).not.toBeNull()
    else expect(ozelHedef).toBeNull()
  })

  it('ok tusu sekmeyi degistirir ve odak da tasinir', async () => {
    kur()
    resmiSekme().focus()
    await userEvent.keyboard('{ArrowRight}')

    expect(ozelSekme().getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(ozelSekme())
    expect(await screen.findByLabelText('Özel notum')).toBeDefined()

    // Ters yön: geri dönebilmeli (tek yönlü bir uygulama yarım olurdu).
    await userEvent.keyboard('{ArrowLeft}')
    expect(resmiSekme().getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(resmiSekme())
  })

  it('Home ilk sekmeye, End son sekmeye gider', async () => {
    kur()
    resmiSekme().focus()
    await userEvent.keyboard('{End}')
    expect(ozelSekme().getAttribute('aria-selected')).toBe('true')
    await userEvent.keyboard('{Home}')
    expect(resmiSekme().getAttribute('aria-selected')).toBe('true')
  })

  it('serit klavyede TEK durak: secili olmayan sekme sekmelenebilir degil', async () => {
    kur()
    expect(resmiSekme().getAttribute('tabindex')).toBe('0')
    expect(ozelSekme().getAttribute('tabindex')).toBe('-1')

    await userEvent.click(ozelSekme())
    expect(ozelSekme().getAttribute('tabindex')).toBe('0')
    expect(resmiSekme().getAttribute('tabindex')).toBe('-1')
  })

  it('ilgisiz tuslar sekmeyi degistirmez', async () => {
    // Yalnızca "ok tuşu çalışıyor" diyen bir test, HER tuşta sekme
    // değiştiren bir uygulamayı da geçerdi.
    kur()
    resmiSekme().focus()
    await userEvent.keyboard('a')
    expect(resmiSekme().getAttribute('aria-selected')).toBe('true')
  })
})

// Özel not artık sekmeye geçilince yükleniyor; yüklenemezse BOŞ EDİTÖR
// açılmamalı — boş bir alan sunucudaki notu "yok" diye gösterir ve
// üstüne yazılan metin var olanı ezerdi.
describe('SeansPaneli — özel not yüklenemedi', () => {
  it('hata gosterilir, bos editor ACILMAZ', async () => {
    const yenidenDene = vi.fn()
    kur({ ozelNot: null, ozelHata: 'Veritabanı okunamadı.', onOzelYenidenDene: yenidenDene })
    await userEvent.click(ozelSekme())

    const uyari = screen.getByRole('alert')
    expect(uyari.textContent).toContain('Özel not yüklenemedi')
    expect(uyari.textContent).toContain('Veritabanı okunamadı.')
    expect(screen.queryByLabelText('Özel notum')).toBeNull()

    await userEvent.click(within(uyari).getByRole('button', { name: 'Yeniden dene' }))
    expect(yenidenDene).toHaveBeenCalledTimes(1)
  })

  it('sekmeye gecilince onOzelSekme cagrilir; acilista CAGRILMAZ', async () => {
    const { onOzelSekme } = kur({ ozelNot: null })
    // Panel açılışında özel not istenmez: sunucudaki `ozel_not_getir`
    // SİLİNEMEZ bir `goruntuleme | private_note` satırı yazar.
    expect(onOzelSekme).not.toHaveBeenCalled()

    await userEvent.click(ozelSekme())
    expect(onOzelSekme).toHaveBeenCalled()
    // İçerik gelmeden editör MOUNT EDİLMEZ.
    expect(screen.queryByLabelText('Özel notum')).toBeNull()
    expect(screen.getByText(/Özel not yükleniyor/)).toBeDefined()
  })
})

describe('SeansPaneli — sekmeler', () => {
  it('varsayilan olarak Seans Notu sekmesi acilir', () => {
    kur()
    expect(resmiSekme().getAttribute('aria-selected')).toBe('true')
    expect(ozelSekme().getAttribute('aria-selected')).toBe('false')
    expect(screen.getByLabelText('Seans notu')).toBeDefined()
    expect(screen.queryByLabelText('Özel notum')).toBeNull()
  })

  it('Ozel Notlarim sekmesi gorsel olarak ayrisir', async () => {
    // Aynı renkte iki sekme, karışıklığa ve yanlış yere yazmaya yol açar.
    kur()
    // Sekme düğmesi SEÇİLİ OLMASA DA ayırt edici rengini taşır: kullanıcı
    // tıklamadan önce de hangisinin özel olduğunu görebilmeli.
    expect(ozelSekme().className).toContain('violet')
    expect(resmiSekme().className).not.toContain('violet')

    expect(screen.getByRole('tabpanel').className).not.toContain('violet')
    await userEvent.click(ozelSekme())
    expect(screen.getByRole('tabpanel').className).toContain('violet')
  })

  it('ozel not sekmesinde uyari metni gorunur', async () => {
    kur()
    const uyari = /dışa aktarımlara ve danışan raporuna dahil edilmez/i
    expect(screen.queryByText(uyari)).toBeNull()

    await userEvent.click(ozelSekme())
    expect(screen.getByText(uyari)).toBeDefined()

    // Kalıcı: sekmeler arasında gidip gelince kaybolmaz.
    await userEvent.click(resmiSekme())
    await userEvent.click(ozelSekme())
    expect(screen.getByText(uyari)).toBeDefined()
  })

  it('ozel sekmede sablon secici YOKTUR', async () => {
    // Özel notun şablonu yok (`PUT .../ozel-not` gövdesi yalnızca `icerik`).
    kur()
    expect(screen.getByLabelText('Şablon')).toBeDefined()
    await userEvent.click(ozelSekme())
    expect(screen.queryByLabelText('Şablon')).toBeNull()
  })

  it('icerik gelmeden editor mount EDILMEZ', () => {
    // `baslangicIcerik` yalnızca mount'ta okunuyor: boş içerikle mount edip
    // sonra prop'u doldurmak, sunucudaki notu ekranda BOŞ göstermek olurdu.
    kur({ not: null })
    expect(screen.queryByLabelText('Seans notu')).toBeNull()
    expect(screen.getByText(/Seans notu yükleniyor/)).toBeDefined()
  })
})

// Planın en sert sözü: özel notun korunması bir `WHERE` filtresine değil,
// AYRI TABLOYA/uç noktaya dayanır. Arayüzdeki karşılığı: resmî sekme
// açıkken özel notun içeriği ekranda hiçbir yerde YOKTUR.
describe('SeansPaneli — özel not resmî tarafa sızmaz', () => {
  it('resmi sekmede ozel notun icerigi ekranin HICBIR yerinde yoktur', () => {
    kur()
    expect(document.body.textContent).not.toContain(GIZLI)
  })

  it('ARTI YON: ozel sekmede ozel notun icerigi GORUNUR', async () => {
    // Bu yarı olmadan "hiçbir şey göstermeyen" bir panel de üstteki testi
    // geçerdi (tek yönlü mutasyon kapsamı).
    kur()
    await userEvent.click(ozelSekme())
    expect((screen.getByLabelText('Özel notum') as HTMLTextAreaElement).value).toBe(GIZLI)
  })

  it('resmi sekmede yazilan metin YALNIZCA resmi kayda gider', async () => {
    const { onNotKaydet, onOzelNotKaydet, unmount } = kur()
    await userEvent.type(screen.getByLabelText('Seans notu'), ' ek')
    unmount()

    await waitFor(() => expect(onNotKaydet).toHaveBeenCalled())
    expect(onOzelNotKaydet).not.toHaveBeenCalled()
    // Resmî kayda giden gövdede özel notun içeriği yok.
    expect(JSON.stringify(vi.mocked(onNotKaydet).mock.calls)).not.toContain(GIZLI)
  })

  it('ozel sekmede yazilan metin YALNIZCA ozel kayda gider', async () => {
    const { onNotKaydet, onOzelNotKaydet, unmount } = kur()
    await userEvent.click(ozelSekme())
    await userEvent.type(screen.getByLabelText('Özel notum'), '-EK')
    unmount()

    await waitFor(() => expect(onOzelNotKaydet).toHaveBeenCalledWith(`${GIZLI}-EK`))
    // En kritik iddia: özel metin resmî uç noktaya HİÇ gitmedi.
    expect(onNotKaydet).not.toHaveBeenCalled()
  })

  it('iki sekmenin taslaklari ayri anahtarlarda tutulur', async () => {
    // Aynı anahtar kullanılsaydı, resmî sekmede yazılan metin özel sekmeye
    // "kurtarılmış taslak" olarak geri yüklenirdi (ya da tersi).
    kur({ onNotKaydet: vi.fn(() => new Promise<void>(() => {})) })
    await userEvent.type(screen.getByLabelText('Seans notu'), ' RESMI-EK')

    expect(taslakOku('not-101')?.icerik).toContain('RESMI-EK')
    expect(taslakOku('ozel-101')).toBeUndefined()

    await userEvent.click(ozelSekme())
    expect((screen.getByLabelText('Özel notum') as HTMLTextAreaElement).value).toBe(GIZLI)
    expect(screen.queryByText(/geri yüklendi/i)).toBeNull()
  })
})

describe('SeansPaneli — yeni notun şablon başlıkları', () => {
  it('sunucudaki not BOSSA sablon basliklari acilista gorunur', () => {
    // `NotEditoru` mount'ta içerik sentezlemiyor (bilinçli karar); başlıkları
    // ÇAĞIRAN TARAF geçirir. Geçirilmezse editör "DAP seçili ama başlıksız"
    // açılır.
    kur({ not: { ...resmiNot, icerik: '' } })
    const alan = screen.getByLabelText('Seans notu') as HTMLTextAreaElement
    // Bu dosya not yüzeyini `test-kurulum.ts`'in textarea test yüzeyiyle
    // sürüyor (gerçek TipTap değil); `.value` iddiaları buna dayanıyor.
    expect(alan.tagName).toBe('TEXTAREA')
    // Başlıklar HTML ikinci düzey başlık (`sablon.ts::sablonMetni`) — adlar
    // aynı, yalnızca biçim değişti.
    expect(alan.value).toContain('<h2>Veri</h2>')
    expect(alan.value).toContain('<h2>Değerlendirme</h2>')
    expect(alan.value).toContain('<h2>Plan</h2>')
  })

  it('basliklar acilista HICBIR kayit uretmez', async () => {
    // Diğer yön: başlıklar ekranda görünüyor ama editörün "sunucudaki hâl"
    // temeli de bu metin, dolayısıyla kullanıcı tek tuşa basmadan yazma (ve
    // silinemez bir denetim satırı) oluşmaz.
    //
    // SAHTE SAAT (eskiden gerçek 60 + 20 ms): editörün varsayılan gecikmesi
    // 2000 ms, yani 60 ms'lik gerçek bekleme zamanlayıcı yolunu HİÇ
    // sınamıyordu — başlıkları "değişiklik" sayan bir editör de 60 ms içinde
    // kaydetmez. Saat şimdi gecikmenin çok ötesine ilerletiliyor; unmount
    // tahliyesi ise zaten eşzamanlı başlıyor.
    vi.useFakeTimers()
    try {
      const { onNotKaydet, unmount } = kur({ not: { ...resmiNot, icerik: '' } })
      await act(() => vi.advanceTimersByTimeAsync(10_000))
      expect(onNotKaydet).not.toHaveBeenCalled()
      unmount()
      expect(onNotKaydet).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('DOLU notun basina baslik EKLENMEZ', () => {
    kur()
    expect((screen.getByLabelText('Seans notu') as HTMLTextAreaElement).value).toBe(
      'bu seansin resmi notu',
    )
  })

  it('bos ozel nota sablon basligi eklenmez', async () => {
    kur({ ozelNot: { ...ozelNot, icerik: '' } })
    await userEvent.click(ozelSekme())
    expect((screen.getByLabelText('Özel notum') as HTMLTextAreaElement).value).toBe('')
  })

  it('sunucudan Serbest sablonlu bos not gelmece gosterilir', () => {
    // Varsayılan şablon Serbest olduğunda, boş not Serbest başlıkları
    // (yani başlık yok) ile açılır. Alan değeri boş olur.
    kur({ not: { ...resmiNot, sablon: 'serbest', icerik: '' } })
    const alan = screen.getByLabelText('Seans notu') as HTMLTextAreaElement
    expect(alan.value).toBe('')
    // Şablon seçici Serbest seçili gösterir
    const sablonSecici = screen.getByLabelText('Şablon') as HTMLSelectElement
    expect(sablonSecici.value).toBe('serbest')
  })
})

// Sekme değişimi giden editörü gerçekten unmount eder; bekleyen metin
// zamanlayıcı beklenmeden sunucuya gider ve dönen kayıt üst katmandaki
// `not`/`ozelNot`'u tazeler. Harness bu tazelemeyi AnaEkran'ın yaptığı gibi
// yapıyor — sekmeye geri dönüldüğünde metnin yerinde olması BUNA bağlı.
function Harness() {
  const [not, setNot] = useState<SeansNotu>({ ...resmiNot, icerik: 'resmi' })
  const [ozel, setOzel] = useState<OzelNot>({ ...ozelNot, icerik: 'ozel' })
  return (
    <SeansPaneli
      randevu={randevu}
      not={not}
      ozelNot={ozel}
      onNotKaydet={async (kayit) => {
        setNot((o) => ({ ...o, sablon: kayit.sablon, icerik: kayit.icerik }))
      }}
      onOzelNotKaydet={async (icerik) => {
        setOzel((o) => ({ ...o, icerik }))
      }}
      onOzelSekme={vi.fn()}
    />
  )
}

describe('SeansPaneli — sekme değişimi', () => {
  it('sekme degisince yazilan icerik kaybolmaz', async () => {
    render(<Harness />)

    await userEvent.type(screen.getByLabelText('Seans notu'), ' EKLENEN')
    await userEvent.click(ozelSekme())
    await userEvent.type(screen.getByLabelText('Özel notum'), ' OZEL-EKLENEN')
    await userEvent.click(resmiSekme())

    await waitFor(() =>
      expect((screen.getByLabelText('Seans notu') as HTMLTextAreaElement).value).toBe(
        'resmi EKLENEN',
      ),
    )

    await userEvent.click(ozelSekme())
    await waitFor(() =>
      expect((screen.getByLabelText('Özel notum') as HTMLTextAreaElement).value).toBe(
        'ozel OZEL-EKLENEN',
      ),
    )
  })
})

// Görev 8'in bağlayıcı sözleşmesi: `key` ile prop değişimi EŞDEĞER DEĞİL.
// `key` verilmezse seans geçişinde unmount tahliyesi hiç çalışmaz ve giden
// seansın bekleyen metni sunucuya HİÇ yazılmaz.
//
// UYARI — bu blok İKİNCİ savunma hattını ölçer, birincisini değil.
// Buradaki `rerender`, AYNI `SeansPaneli` örneğine farklı bir `randevu.id`
// veriyor; üretimde bu durum OLUŞAMAZ, çünkü `AnaEkran` paneli
// `key={seans-${id}}` ile mount ediyor ve seans değişimi panelin tamamını
// yeniden mount eder. Yani bu testler "AnaEkran'daki `key` unutulursa
// SeansPaneli'nin iç `key`'leri ne kadarını kurtarır" sorusunu ölçüyor —
// derinlemesine savunma olarak meşru, ama birincil hat DEĞİL.
// Birincil hat (`AnaEkran.tsx`'teki `key={seans-${id}}`)
// `AnaEkran.test.tsx` içinde ölçülüyor: "A ozel sekmedeyken B secilince
// panel RESMI sekmede acilir" ve "ozel sekmede bekleyen metin, B secilince
// A NIN ozel notuna yazilir".
describe('SeansPaneli — seans değişimi (`key` yolu, ikincil hat)', () => {
  it('baska randevuya gecince giden seansin bekleyen metni O SEANSIN kaydina gider', async () => {
    const kaydetA = vi.fn().mockResolvedValue(undefined)
    const kaydetB = vi.fn().mockResolvedValue(undefined)
    const notB: SeansNotu = { ...resmiNot, appointment_id: 102, client_id: 2, icerik: 'B notu' }
    const randevuB: Randevu = {
      ...randevu,
      id: 102,
      client_id: 2,
      danisan_adi: 'Mehmet Demir',
      baslangic: '2026-09-07T13:00',
    }

    const { rerender } = render(
      <SeansPaneli
        randevu={randevu}
        not={{ ...resmiNot, icerik: 'A notu' }}
        ozelNot={ozelNot}
        onNotKaydet={kaydetA}
        onOzelNotKaydet={vi.fn()}
        onOzelSekme={vi.fn()}
      />,
    )

    await userEvent.type(screen.getByLabelText('Seans notu'), ' BEKLEYEN')

    rerender(
      <SeansPaneli
        randevu={randevuB}
        not={notB}
        ozelNot={{ ...ozelNot, appointment_id: 102, icerik: '' }}
        onNotKaydet={kaydetB}
        onOzelNotKaydet={vi.fn()}
        onOzelSekme={vi.fn()}
      />,
    )

    // Bekleyen metin A'nın kaydına gitti...
    await waitFor(() =>
      expect(kaydetA).toHaveBeenCalledWith({ sablon: 'dap', icerik: 'A notu BEKLEYEN' }),
    )
    // ...ve B'nin kaydına ASLA. `key` olmasaydı hiçbiri çağrılmaz, metin
    // yalnızca taslakta kalırdı.
    expect(kaydetB).not.toHaveBeenCalled()

    // Ekranda B'nin notu var, A'nınki taşınmadı.
    expect((screen.getByLabelText('Seans notu') as HTMLTextAreaElement).value).toBe('B notu')
    await waitFor(() => expect(taslakOku('not-101')).toBeUndefined())
    expect(taslakOku('not-102')).toBeUndefined()
  })

  it('ozel not editoru de seans degisiminde tahliye edilir', async () => {
    const ozelA = vi.fn().mockResolvedValue(undefined)
    const ozelB = vi.fn().mockResolvedValue(undefined)
    const paneli = (
      r: Randevu,
      o: OzelNot,
      kaydet: (icerik: string) => Promise<void>,
    ) => (
      <SeansPaneli
        randevu={r}
        not={resmiNot}
        ozelNot={o}
        onNotKaydet={vi.fn().mockResolvedValue(undefined)}
        onOzelNotKaydet={kaydet}
        onOzelSekme={vi.fn()}
      />
    )
    const { rerender } = render(paneli(randevu, { ...ozelNot, icerik: 'A ozel' }, ozelA))
    await userEvent.click(ozelSekme())
    await userEvent.type(screen.getByLabelText('Özel notum'), ' BEKLEYEN')

    rerender(
      paneli(
        { ...randevu, id: 102 },
        { ...ozelNot, appointment_id: 102, icerik: 'B ozel' },
        ozelB,
      ),
    )

    await waitFor(() => expect(ozelA).toHaveBeenCalledWith('A ozel BEKLEYEN'))
    expect(ozelB).not.toHaveBeenCalled()
  })
})

// Plan 6 Görev 6: etiket satırı resmî notun yanında; özel notlar etiket ALMAZ.
describe('SeansPaneli — etiketler', () => {
  const etiket = {
    etiketler: [{ id: 1, ad: 'kaygı', kullanim: 1 }],
    hata: null,
    onYenidenDene: vi.fn(),
    sozluk: null,
    onSozlukIste: vi.fn(),
    onEkle: vi.fn(async () => {}),
    onKaldir: vi.fn(async () => {}),
    onEtiketAc: vi.fn(),
    yazmaHatasi: null,
    onYazmaHatasiTemizle: vi.fn(),
  }

  it('etiket satırı "Seans Notu" sekmesinde görünür, "Özel Notlarım" sekmesinde YOK', async () => {
    kur({ etiket })
    const resmi = screen.getByRole('tabpanel')
    expect(within(resmi).getByRole('button', { name: 'kaygı etiketini kaldır' })).toBeDefined()
    expect(within(resmi).getByLabelText('Etiket ekle')).toBeDefined()

    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    // BARİYER: özel sekmenin paneli gerçekten açık (kalıcı uyarı şeridi).
    const ozel = screen.getByRole('tabpanel')
    expect(ozel.textContent).toContain('dışa aktarımlara ve danışan raporuna dahil edilmez')
    expect(screen.queryByRole('button', { name: 'kaygı etiketini kaldır' })).toBeNull()
    expect(screen.queryByLabelText('Etiket ekle')).toBeNull()
  })
})
