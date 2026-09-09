import { render, screen, waitFor, within } from '@testing-library/react'
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
  sablon: 'dap',
  icerik: 'bu seansin resmi notu',
  guncelleme_zamani: '2026-09-07T06:00:00Z',
}

// Sızıntı testlerinin kanaryası. Bu dizge resmî sekmede, geçmiş listesinde
// ve resmî nota giden hiçbir istekte GÖRÜNMEMELİ.
const GIZLI = 'GIZLI-OZEL-ABC'

const ozelNot: OzelNot = {
  appointment_id: 101,
  icerik: GIZLI,
  guncelleme_zamani: '2026-09-07T06:00:00Z',
}

// Sunucu `ORDER BY a.baslangic DESC` uyguluyor ama yanıtta seans tarihi
// YOK; yalnızca `guncelleme_zamani` var (geçen ayki bir seansın notu bugün
// düzeltilmiş olabilir). Bileşen listeyi o alana göre yeniden sıralarsa
// sunucunun bildiği gerçek seans sırası sessizce bozulur.
//
// Kurulum bilerek şöyle: geliş sırası `guncelleme_zamani`'na göre NE ARTAN
// NE AZALAN sıraya denk geliyor. Tek bir yöne göre kurulsaydı, ters yöndeki
// sıralama mutasyonu testi yeşil bırakırdı — sıralama anahtarının testte
// görünmez kalması (sekizinci biçim) tam olarak budur.
//
//   geliş:  DAP(05.09) · SOAP(31.08) · Serbest(20.09)
//   artan:  SOAP · DAP · Serbest
//   azalan: Serbest · DAP · SOAP
const gecmisNotlar: SeansNotu[] = [
  {
    appointment_id: 90,
    client_id: 1,
    sablon: 'dap',
    icerik: 'gecen hafta konusulanlar',
    guncelleme_zamani: '2026-09-05T06:00:00Z',
  },
  {
    appointment_id: 80,
    client_id: 1,
    sablon: 'soap',
    icerik: 'iki hafta onceki seans',
    guncelleme_zamani: '2026-08-31T06:00:00Z',
  },
  {
    appointment_id: 70,
    client_id: 1,
    sablon: 'serbest',
    icerik: 'uc hafta onceki seans',
    guncelleme_zamani: '2026-09-20T06:00:00Z',
  },
]

function kur(ozel: Partial<React.ComponentProps<typeof SeansPaneli>> = {}) {
  const props = {
    randevu,
    gecmisNotlar,
    not: resmiNot,
    ozelNot,
    onNotKaydet: vi.fn().mockResolvedValue(undefined),
    onOzelNotKaydet: vi.fn().mockResolvedValue(undefined),
    onKapat: vi.fn(),
    ...ozel,
  }
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

describe('SeansPaneli — geçmiş bağlam', () => {
  it('sol tarafta son seanslarin notlari gorunur', () => {
    kur()
    // Başlık (şablon adı) + tarih listesi.
    expect(screen.getByRole('button', { name: /DAP.*05\.09\.2026/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /SOAP.*31\.08\.2026/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Serbest.*20\.09\.2026/ })).toBeDefined()
  })

  it('liste SUNUCUDAN geldigi sirada basilir, guncelleme zamanina gore yeniden siralanmaz', () => {
    kur()
    const gecmis = screen.getByRole('region', { name: 'Önceki seans notları' })
    const adlar = within(gecmis)
      .getAllByRole('button')
      .map((d) => d.textContent ?? '')
    // Geliş sırası: DAP · SOAP · Serbest. `guncelleme_zamani`'na göre artan
    // ya da azalan sıralayan bir uygulama bu diziyi tutturamaz.
    expect(adlar).toHaveLength(3)
    expect(adlar[0]).toContain('DAP')
    expect(adlar[1]).toContain('SOAP')
    expect(adlar[2]).toContain('Serbest')
  })

  it('gecmis notlar katlanmis baslar, tiklayinca acilir', async () => {
    kur()
    const dugme = screen.getByRole('button', { name: /DAP/ })
    expect(dugme.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('gecen hafta konusulanlar')).toBeNull()

    await userEvent.click(dugme)

    expect(dugme.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('gecen hafta konusulanlar')).toBeDefined()
  })

  it('acilan not tekrar tiklayinca kapanir', async () => {
    // Ters yön: "her zaman açık" bir liste de üstteki testi geçerdi.
    kur()
    const dugme = screen.getByRole('button', { name: /DAP/ })
    await userEvent.click(dugme)
    await userEvent.click(dugme)
    expect(dugme.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('gecen hafta konusulanlar')).toBeNull()
  })

  it('iki gecmis not ayni anda acik olabilir', async () => {
    kur()
    await userEvent.click(screen.getByRole('button', { name: /DAP/ }))
    await userEvent.click(screen.getByRole('button', { name: /SOAP/ }))
    expect(screen.getByText('gecen hafta konusulanlar')).toBeDefined()
    expect(screen.getByText('iki hafta onceki seans')).toBeDefined()
  })

  it('gecmis not yoksa bilgilendirici bos durum gosterir', () => {
    kur({ gecmisNotlar: [] })
    expect(screen.getByText(/önceki seanslarından kayıtlı not yok/i)).toBeDefined()
    expect(screen.getByText(/İlk seans ise/i)).toBeDefined()
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

  it('ozel not gecmis listesinde gorunmez (tum gecmis acikken bile)', async () => {
    kur()
    await userEvent.click(screen.getByRole('button', { name: /DAP/ }))
    await userEvent.click(screen.getByRole('button', { name: /SOAP/ }))
    const gecmis = screen.getByRole('region', { name: 'Önceki seans notları' })
    expect(gecmis.textContent).not.toContain(GIZLI)
    // Geçmiş gerçekten dolu: boş bir bölüm de üstteki iddiayı geçerdi.
    expect(gecmis.textContent).toContain('gecen hafta konusulanlar')
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
    expect(alan.value).toContain('Veri:')
    expect(alan.value).toContain('Değerlendirme:')
    expect(alan.value).toContain('Plan:')
  })

  it('basliklar acilista HICBIR kayit uretmez', async () => {
    // Diğer yön: başlıklar ekranda görünüyor ama editörün "sunucudaki hâl"
    // temeli de bu metin, dolayısıyla kullanıcı tek tuşa basmadan yazma (ve
    // silinemez bir denetim satırı) oluşmaz.
    const { onNotKaydet, unmount } = kur({ not: { ...resmiNot, icerik: '' } })
    await new Promise((coz) => setTimeout(coz, 60))
    unmount()
    await new Promise((coz) => setTimeout(coz, 20))
    expect(onNotKaydet).not.toHaveBeenCalled()
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
      gecmisNotlar={[]}
      not={not}
      ozelNot={ozel}
      onNotKaydet={async (kayit) => {
        setNot((o) => ({ ...o, sablon: kayit.sablon, icerik: kayit.icerik }))
      }}
      onOzelNotKaydet={async (icerik) => {
        setOzel((o) => ({ ...o, icerik }))
      }}
      onKapat={vi.fn()}
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
        gecmisNotlar={[]}
        not={{ ...resmiNot, icerik: 'A notu' }}
        ozelNot={ozelNot}
        onNotKaydet={kaydetA}
        onOzelNotKaydet={vi.fn()}
        onKapat={vi.fn()}
      />,
    )

    await userEvent.type(screen.getByLabelText('Seans notu'), ' BEKLEYEN')

    rerender(
      <SeansPaneli
        randevu={randevuB}
        gecmisNotlar={[]}
        not={notB}
        ozelNot={{ ...ozelNot, appointment_id: 102, icerik: '' }}
        onNotKaydet={kaydetB}
        onOzelNotKaydet={vi.fn()}
        onKapat={vi.fn()}
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
        gecmisNotlar={[]}
        not={resmiNot}
        ozelNot={o}
        onNotKaydet={vi.fn().mockResolvedValue(undefined)}
        onOzelNotKaydet={kaydet}
        onKapat={vi.fn()}
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

describe('SeansPaneli — kapatma', () => {
  it('Seansi kapat dugmesi onKapat cagirir', async () => {
    const { onKapat } = kur()
    await userEvent.click(screen.getByRole('button', { name: 'Seansı kapat' }))
    expect(onKapat).toHaveBeenCalledTimes(1)
  })

  it('baslikta danisan adi ve saat gorunur', () => {
    kur()
    const baslik = screen.getByRole('region', { name: 'Seans' })
    expect(within(baslik).getByText(/Ayşe Yılmaz — 7 Eylül 2026, 10:00/)).toBeDefined()
  })
})
