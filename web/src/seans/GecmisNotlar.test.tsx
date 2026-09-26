import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { SeansNotu } from '../api'
import { GecmisNotlar } from './GecmisNotlar'

function not(ozel: Partial<SeansNotu> = {}): SeansNotu {
  return {
    appointment_id: 1,
    client_id: 1,
    danisan_adi: 'Ayşe Yılmaz',
    sablon: 'dap',
    icerik: '<h2>Veri</h2><p>Danışan geldi.</p>',
    onizleme: null,
    guncelleme_zamani: '2026-09-01T12:00:00Z',
    seans_zamani: '2026-09-01T10:00',
    ...ozel,
  }
}

describe('GecmisNotlar', () => {
  it('genisletilince not NotOkuma ile bicimli gosterilir (duz metin degil)', () => {
    render(<GecmisNotlar notlar={[not()]} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Veri').tagName).toBe('H2')
    expect(screen.getByText('Danışan geldi.').tagName).toBe('P')
  })

  it('etiketsiz eski not da paragraf olarak acilir, kaybolmaz', () => {
    render(<GecmisNotlar notlar={[not({ icerik: 'Veri:\nDanışan geldi.' })]} />)
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText(/Veri:/).tagName).toBe('P')
  })
})

// Sunucu `ORDER BY a.baslangic DESC` uyguluyor. Bileşen listeyi
// `guncelleme_zamani`'na göre yeniden sıralarsa sunucunun bildiği gerçek
// seans sırası sessizce bozulur.
//
// Kurulum bilerek şöyle: geliş sırası `guncelleme_zamani`'na göre NE ARTAN
// NE AZALAN sıraya denk geliyor. Tek bir yöne göre kurulsaydı, ters yöndeki
// sıralama mutasyonu testi yeşil bırakırdı — sıralama anahtarının testte
// görünmez kalması (sekizinci biçim) tam olarak budur.
//
//   geliş (seans):  31.08 · 24.08 · 17.08   (a.baslangic DESC — doğru sıra)
//   son düzenleme:  05.09 · 31.08 · 20.09   (ne artan ne azalan)
//
// İnceleme I3'ün ölçtüğü şey de bu kurulumda görünür: son düzenleme
// tarihleri sırasız, seans tarihleri sıralı. Ekranda YALNIZCA son düzenleme
// gösterilseydi (eski hâl) kullanıcı sırasız bir liste görürdü.
const gecmisNotlar: SeansNotu[] = [
  {
    appointment_id: 90,
    client_id: 1,
    danisan_adi: 'Ayşe Yılmaz',
    seans_zamani: '2026-08-31T10:00',
    sablon: 'dap',
    icerik: 'gecen hafta konusulanlar',
    onizleme: null,
    guncelleme_zamani: '2026-09-05T06:00:00Z',
  },
  {
    appointment_id: 80,
    client_id: 1,
    danisan_adi: 'Ayşe Yılmaz',
    seans_zamani: '2026-08-24T10:00',
    sablon: 'soap',
    icerik: 'iki hafta onceki seans',
    onizleme: null,
    guncelleme_zamani: '2026-08-31T06:00:00Z',
  },
  {
    appointment_id: 70,
    client_id: 1,
    danisan_adi: 'Ayşe Yılmaz',
    seans_zamani: '2026-08-17T10:00',
    sablon: 'serbest',
    icerik: 'uc hafta onceki seans',
    onizleme: null,
    guncelleme_zamani: '2026-09-20T06:00:00Z',
  },
]

// `SeansPaneli.test.tsx`'ten taşındı (Görev 7): liste artık panelin sol
// sütunu değil, not sayfasının SAĞ sütunu (tasarım N5). Oradaki "gecmis
// bolumu DOM sirasinda sekmelerden ONCE gelir" testi bu yüzden taşınmadı —
// öncülü tasarım gereği kalktı (önceki notlar editörden SONRA).
describe('GecmisNotlar — geçmiş bağlam (SeansPaneli testlerinden taşındı)', () => {
  it('son seanslarin notlari satir basliklarinda gorunur', () => {
    render(<GecmisNotlar notlar={gecmisNotlar} />)
    // Başlık: seans tarihi + şablon adı + son düzenleme.
    expect(screen.getByRole('button', { name: /31 Ağustos 2026, 10:00.*DAP.*05\.09\.2026/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /24 Ağustos 2026, 10:00.*SOAP.*31\.08\.2026/ })).toBeDefined()
    expect(
      screen.getByRole('button', { name: /17 Ağustos 2026, 10:00.*Serbest.*20\.09\.2026/ }),
    ).toBeDefined()
  })

  // İnceleme I3: sıralama anahtarı ekranda görünmüyordu. Liste
  // `a.baslangic DESC` ile geliyor ama ekrandaki tek tarih "Son düzenleme"
  // idi ve o alan sıralı DEĞİL — terapist "hangisi son seanstı" sorusuna
  // panelden cevap alamıyordu.
  it('her satirda SEANS TARIHI gorunur ve o tarihler ekranda sirali', () => {
    render(<GecmisNotlar notlar={gecmisNotlar} />)
    const gecmis = screen.getByRole('region', { name: 'Önceki seans notları' })
    const metinler = within(gecmis)
      .getAllByRole('button')
      .map((d) => d.textContent ?? '')

    // Seans tarihleri ekranda, ve azalan sırada.
    const seansTarihleri = metinler.map((m) => /Seans: (\d{1,2} \S+ \d{4})/.exec(m)?.[1])
    expect(seansTarihleri).toEqual(['31 Ağustos 2026', '24 Ağustos 2026', '17 Ağustos 2026'])

    // "Son düzenleme" hâlâ var ama SIRALI DEĞİL: ekrandaki tek tarih o
    // olsaydı liste sırasız görünürdü. Bu iddia olmadan üstteki, seans
    // tarihinin gerçekten sıralama anahtarı olduğunu göstermezdi.
    const duzenlemeler = metinler.map((m) => /Son düzenleme: (\d{2}\.\d{2}\.\d{4})/.exec(m)?.[1])
    expect(duzenlemeler).toEqual(['05.09.2026', '31.08.2026', '20.09.2026'])
  })

  it('seans tarihi zaman dilimine gore KAYMAZ (Date kullanilmiyor)', () => {
    // Gece yarısına yakın bir seans: `new Date('2026-08-31T00:30')` yerel
    // saate göre yorumlanır ve UTC'ye çevrilirse tarih bir gün kayar.
    // Kayan şey listenin sıralama anahtarı olurdu.
    render(<GecmisNotlar notlar={[{ ...gecmisNotlar[0], seans_zamani: '2026-08-31T00:30' }]} />)
    expect(screen.getByRole('button', { name: /Seans: 31 Ağustos 2026, 00:30/ })).toBeDefined()
  })

  it('liste SUNUCUDAN geldigi sirada basilir, guncelleme zamanina gore yeniden siralanmaz', () => {
    render(<GecmisNotlar notlar={gecmisNotlar} />)
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
    render(<GecmisNotlar notlar={gecmisNotlar} />)
    const dugme = screen.getByRole('button', { name: /DAP/ })
    expect(dugme.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('gecen hafta konusulanlar')).toBeNull()

    await userEvent.click(dugme)

    expect(dugme.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('gecen hafta konusulanlar')).toBeDefined()
  })

  it('acilan not tekrar tiklayinca kapanir', async () => {
    // Ters yön: "her zaman açık" bir liste de üstteki testi geçerdi.
    render(<GecmisNotlar notlar={gecmisNotlar} />)
    const dugme = screen.getByRole('button', { name: /DAP/ })
    await userEvent.click(dugme)
    await userEvent.click(dugme)
    expect(dugme.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('gecen hafta konusulanlar')).toBeNull()
  })

  it('iki gecmis not ayni anda acik olabilir', async () => {
    render(<GecmisNotlar notlar={gecmisNotlar} />)
    await userEvent.click(screen.getByRole('button', { name: /DAP/ }))
    await userEvent.click(screen.getByRole('button', { name: /SOAP/ }))
    expect(screen.getByText('gecen hafta konusulanlar')).toBeDefined()
    expect(screen.getByText('iki hafta onceki seans')).toBeDefined()
  })

  it('gecmis not yoksa bilgilendirici bos durum gosterir', () => {
    render(<GecmisNotlar notlar={[]} />)
    expect(screen.getByText(/önceki seanslarından kayıtlı not yok/i)).toBeDefined()
    expect(screen.getByText(/İlk seans ise/i)).toBeDefined()
  })
})
