import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HaftalikTakvim } from './HaftalikTakvim'
import { haftaninBasi } from './hafta'

const randevu = {
  id: 1, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
  baslangic: '2026-09-07T14:00', bitis: '2026-09-07T15:00',
  durum: 'planlandi', ucret: 45000, odendi: false, seri_id: null,
}

function kur(ozel = {}) {
  const props = {
    randevular: [randevu],
    haftaBasi: haftaninBasi(new Date(2026, 8, 7)),
    // Görev 6'da kullanılacak (bugün vurgusu, şimdi çizgisi); bu görevde
    // yalnızca geçiriliyor. `simdi` zorunlu bir prop olduğu için `kur()`
    // burada sabit bir değer veriyor (Görev 6 AYNI değeri kullanacak).
    simdi: '2026-09-09T14:30',
    onRandevuSec: vi.fn(),
    onBosSaatSec: vi.fn(),
    ...ozel,
  }
  render(<HaftalikTakvim {...props} />)
  return props
}

describe('HaftalikTakvim', () => {
  // Hafta başlığı ve gezinme okları Görev 5'te `TakvimSekmesi`nin tek araç
  // çubuğuna taşındı (bkz. `TakvimSekmesi.test.tsx` — "araç çubuğu (Görev
  // 5)"); burada yalnızca ızgaranın kendi içeriği (gün adları, randevular)
  // ölçülüyor.
  it('yedi günü gösterir', () => {
    kur()
    for (const gun of ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']) {
      expect(screen.getByText(gun)).toBeDefined()
    }
  })

  it('randevuyu danışan adıyla gösterir', () => {
    kur()
    expect(screen.getByText('Ayşe Yılmaz')).toBeDefined()
  })

  it('randevuya tıklayınca seçimi bildirir', async () => {
    const props = kur()
    await userEvent.click(screen.getByText('Ayşe Yılmaz'))
    expect(props.onRandevuSec).toHaveBeenCalledWith(randevu)
  })

  it('boş saate tıklayınca o saati bildirir', async () => {
    const props = kur()
    await userEvent.click(screen.getByLabelText('8 Eylül 10:00 boş'))
    expect(props.onBosSaatSec).toHaveBeenCalledWith('2026-09-08T10:00')
  })

  it('iptal edilmiş randevuyu ayrı biçimde işaretler', () => {
    kur({ randevular: [{ ...randevu, durum: 'iptal' }] })
    expect(screen.getByText('Ayşe Yılmaz').closest('button')?.className).toContain('line-through')
  })

  // e2e/takvim.spec.ts'teki "kopya olusmaz" testinin senkronizasyon
  // bariyeri bu özniteliğe dayanıyor: güncelleme ızgarada başka hiçbir
  // gözlemlenebilir iz bırakmıyor (blok yalnızca adı gösteriyor, React aynı
  // key ile aynı DOM'u üretiyor). Öznitelik kaldırılırsa o e2e testi tekrar
  // körleşir — bu yüzden burada birim testiyle sabitleniyor.
  it('randevu bloğu ücreti data-ucret olarak (kuruş) yayar', () => {
    kur()
    expect(screen.getByText('Ayşe Yılmaz').closest('button')?.getAttribute('data-ucret'))
      .toBe('45000')
  })

  it('ücretsiz randevuda data-ucret özniteliği hiç basılmaz', () => {
    kur({ randevular: [{ ...randevu, ucret: null }] })
    expect(screen.getByText('Ayşe Yılmaz').closest('button')?.hasAttribute('data-ucret'))
      .toBe(false)
  })

  it('randevusuz hafta boş ızgara gösterir, hata vermez', () => {
    kur({ randevular: [] })
    expect(screen.getByRole('table')).toBeDefined()
    expect(screen.getByText('Pzt')).toBeDefined()
  })
})

// Izgara 08:00–21:00. Bu aralığın DIŞINDAKİ randevular sunucudan
// çekiliyordu ama hiçbir hücreye düşmüyor, dolayısıyla ekranda HİÇ
// görünmüyorlardı: takvimde olmayan bir randevu, olmayan bir randevudur.
describe('HaftalikTakvim — görünen aralık dışındaki randevular', () => {
  const erken = {
    ...randevu, id: 2, danisan_adi: 'Erken Danışan',
    baslangic: '2026-09-08T07:30', bitis: '2026-09-08T08:30',
  }
  const gec = {
    ...randevu, id: 3, danisan_adi: 'Geç Danışan',
    baslangic: '2026-09-09T21:30', bitis: '2026-09-09T22:30',
  }

  const bolum = () => screen.getByRole('region', { name: 'Görünen aralık dışındaki randevular' })

  it('aralik dışındaki randevu ızgarada GÖRÜNMÜYOR (bu bölümün varlık sebebi)', () => {
    // ÖN KOŞUL. Bu satır olmadan aşağıdaki testler, randevu ızgarada da
    // görünüyor olsa bile yeşil kalırdı ve bölüm gereksiz bir tekrar
    // olurdu.
    kur({ randevular: [erken] })
    const izgara = screen.getByRole('table')
    expect(izgara.textContent).not.toContain('Erken Danışan')
  })

  it('erken ve geç randevuları GERÇEK sayıyla bildirir', () => {
    // Sayı tahmin değil: ızgaranın kendi hücre kimliklerinden türüyor.
    // Aralık İÇİNDEKİ randevu (14:00) sayıya KARIŞMAMALI.
    kur({ randevular: [randevu, erken, gec] })
    const b = bolum()
    expect(b.textContent).toContain('2 randevu var')
    expect(b.textContent).toContain('08:00–21:00')
    expect(b.textContent).toContain('Erken Danışan')
    expect(b.textContent).toContain('Geç Danışan')
    expect(b.textContent).not.toContain('Ayşe Yılmaz')

    // Ve aralık içindeki randevu ızgarada DURUYOR (bölüm, çalışan bir
    // şeyi bozmadı).
    expect(screen.getByRole('table').textContent).toContain('Ayşe Yılmaz')
  })

  it('gizli randevuya tıklanınca seçim bildirilir (ULAŞILABİLİR)', () => {
    // Görünür kılmak yetmez: kullanıcı o randevuyu açıp saatini
    // düzeltebilmeli.
    const props = kur({ randevular: [erken] })
    screen
      .getByRole('button', { name: /Erken Danışan — 08\.09 07:30 \(aralık dışı\) randevusunu aç/ })
      .click()
    expect(props.onRandevuSec).toHaveBeenCalledWith(erken)
  })

  it('hepsi aralik ICINDEYSE bolum HIC gorunmez', () => {
    // Her zaman uyaran bir arayüz uyarıyı anlamsızlaştırır. Sınır
    // değerleri de aralığın İÇİNDE sayılmalı: 08:00 ilk hücre,
    // 20:00 son hücre (21:00 ızgaraya dahil DEĞİL).
    const sinirdakiler = [
      { ...randevu, id: 4, baslangic: '2026-09-07T08:00', bitis: '2026-09-07T09:00' },
      { ...randevu, id: 5, baslangic: '2026-09-07T20:00', bitis: '2026-09-07T21:00' },
    ]
    kur({ randevular: sinirdakiler })
    expect(
      screen.queryByRole('region', { name: 'Görünen aralık dışındaki randevular' }),
    ).toBeNull()
    // ÖN KOŞUL: sınırdakiler gerçekten ızgarada.
    expect(screen.getByRole('table').textContent).toContain('Ayşe Yılmaz')
  })

  it('tam 21:00 ızgaranın DIŞINDADIR ve bildirilir', () => {
    // Üst sınır HARİÇ (`CALISMA_BITIS` son satır değil). Bu kayma sessiz
    // olurdu: 21:00'deki randevu ne ızgarada ne uyarıda görünseydi
    // tamamen kaybolurdu.
    kur({
      randevular: [
        { ...randevu, id: 6, danisan_adi: 'Tam Yirmibir', baslangic: '2026-09-07T21:00', bitis: '2026-09-07T22:00' },
      ],
    })
    expect(bolum().textContent).toContain('1 randevu var')
    expect(bolum().textContent).toContain('Tam Yirmibir')
  })
})

// Görev 6 (tasarım A2): bugün vurgusu ve şimdi çizgisi. `kur()`'un varsayılan
// `simdi`'si '2026-09-09T14:30' (9 Eylül Çarşamba); görünen hafta hep
// haftaninBasi(new Date(2026, 8, 7)) yani 7–13 Eylül — 9 Eylül BU haftanın
// içinde, Çarşamba (gunler[2]).
describe('HaftalikTakvim — bugün ve şimdi (Görev 6)', () => {
  it('6.1 bugünün sütun başlığı aria-current="date" taşır; başka hiçbir başlık taşımaz', () => {
    kur()
    const basliklar = screen.getAllByRole('columnheader')
    const isaretliler = basliklar.filter((b) => b.getAttribute('aria-current') === 'date')
    expect(isaretliler.length).toBe(1)
    expect(isaretliler[0].textContent).toContain('9')
  })

  it('6.2 şimdi çizgisi tam bir tane, 9 Eylül 14:00 hücresinin içinde, style.top %50', () => {
    kur()
    const cizgiler = screen.getAllByTestId('simdi-cizgisi')
    expect(cizgiler.length).toBe(1)
    const cizgi = cizgiler[0]
    // Çizginin en yakın hücresi (td), o saatin satırındaki 9 Eylül sütunu
    // olmalı: satırın ilk hücresi (saat etiketi) "14:00" yazıyor ve çizgi o
    // satırın Çarşamba (4. td, indeks 3) hücresinde.
    const satir = cizgi.closest('tr')
    expect(satir?.querySelector('td')?.textContent).toBe('14:00')
    const hucreler = satir ? Array.from(satir.querySelectorAll('td')) : []
    // gunler[0]=Pzt(7) .. gunler[2]=Çar(9): saat hücresinden sonraki 3. td.
    expect(hucreler[3]?.contains(cizgi)).toBe(true)
    expect((cizgi as HTMLElement).style.top).toBe('50%')
  })

  it('6.3 simdi görünen haftanın dışındaysa çizgi ve aria-current yok', () => {
    kur({ simdi: '2026-09-20T10:00' })
    expect(screen.queryByTestId('simdi-cizgisi')).toBeNull()
    const basliklar = screen.getAllByRole('columnheader')
    expect(basliklar.some((b) => b.getAttribute('aria-current') === 'date')).toBe(false)
  })

  it('6.4 simdi 07:30 ise çizgi yok, aria-current var', () => {
    kur({ simdi: '2026-09-09T07:30' })
    expect(screen.queryByTestId('simdi-cizgisi')).toBeNull()
    const basliklar = screen.getAllByRole('columnheader')
    expect(basliklar.some((b) => b.getAttribute('aria-current') === 'date')).toBe(true)
  })

  it('6.4b simdi 21:10 ise çizgi yok, aria-current var', () => {
    kur({ simdi: '2026-09-09T21:10' })
    expect(screen.queryByTestId('simdi-cizgisi')).toBeNull()
    const basliklar = screen.getAllByRole('columnheader')
    expect(basliklar.some((b) => b.getAttribute('aria-current') === 'date')).toBe(true)
  })

  it('boş hücrede görünür ipucu "+ HH:00" var; erişilebilir ad DEĞİŞMEZ', () => {
    kur()
    const dugme = screen.getByLabelText('8 Eylül 10:00 boş')
    expect(dugme.textContent).toBe('+ 10:00')
    const ipucu = dugme.querySelector('span')
    expect(ipucu?.getAttribute('aria-hidden')).toBe('true')
    expect(ipucu?.className).toContain('opacity-0')
    expect(ipucu?.className).toContain('group-hover:opacity-100')
  })
})
