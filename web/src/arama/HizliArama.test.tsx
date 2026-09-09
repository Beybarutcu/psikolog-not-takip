import aramaKaynagi from './HizliArama.tsx?raw'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AramaSonucu, AramaYaniti } from '../api'
import { ARAMA_SINIRI } from '../api'
import { GECIKME_MS, HizliArama } from './HizliArama'

const danisanSonucu: AramaSonucu = {
  tur: 'danisan',
  client_id: 12,
  danisan_adi: 'Ayşe Yılmaz',
  appointment_id: null,
  tarih: null,
  parca: 'Ayşe Yılmaz',
}

const notSonucu: AramaSonucu = {
  tur: 'not',
  client_id: 12,
  danisan_adi: 'Ayşe Yılmaz',
  appointment_id: 101,
  tarih: '2026-09-07T10:00',
  parca: '…uyku düzeni ve kaygı üzerine konuşuldu…',
}

/** `AramaYaniti` kısayolu: testlerin çoğu kırpılmayla ilgilenmiyor. */
function yanit(sonuclar: AramaSonucu[], kirpildi = false): AramaYaniti {
  return { sonuclar, kirpildi }
}

function kur(ozel: Partial<React.ComponentProps<typeof HizliArama>> = {}) {
  const props = {
    ara: vi.fn().mockResolvedValue(yanit([danisanSonucu, notSonucu])),
    onDanisanSec: vi.fn(),
    onSeansSec: vi.fn(),
    // Gecikme testlerde kısaltılıyor (NotEditoru'nun `gecikmeMs` deseni).
    // Varsayılanın 250 ms olduğu ayrıca sabitleniyor.
    gecikmeMs: 5,
    ...ozel,
  }
  return { ...props, ...render(<HizliArama {...props} />) }
}

async function ac() {
  await userEvent.keyboard('{Control>}k{/Control}')
}

const kutu = () => screen.getByRole('searchbox', { name: 'Danışan adı veya not içeriği' })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HizliArama — açılış ve kapanış', () => {
  it('Ctrl+K ile acilir', async () => {
    kur()
    expect(screen.queryByRole('dialog')).toBeNull()
    await ac()
    expect(screen.getByRole('dialog', { name: 'Hızlı arama' })).toBeDefined()
    expect(kutu()).toBeDefined()
  })

  it('`aria-modal="true"` DER -- artik gercekten modal', async () => {
    // Etiket eskiden BİLEREK yoktu: panel satır içi bir `div`di, odak
    // tuzağı, backdrop ve `inert` yoktu; etiket ekran okuyucu
    // kullanıcısına yalan söylerdi. Bugün üçü de var (aşağıdaki testler),
    // dolayısıyla etiket gerçeği anlatıyor.
    kur()
    await ac()
    const kutucuk = screen.getByRole('dialog', { name: 'Hızlı arama' })
    expect(kutucuk.getAttribute('aria-modal')).toBe('true')
  })

  it('Cmd+K ile de acilir (macOS)', async () => {
    kur()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    expect(screen.getByRole('dialog', { name: 'Hızlı arama' })).toBeDefined()
  })

  it('yalin K aramayi ACMAZ', async () => {
    // Ters yön: "her tuşta açılan" bir arayüz de üstteki testleri geçerdi ve
    // not yazarken önüne bir katman açardı.
    kur()
    await userEvent.keyboard('k')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Ctrl+K tarayicinin kendi davranisini engeller', async () => {
    kur()
    const olay = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(olay)
    expect(olay.defaultPrevented).toBe(true)
  })

  it('Escape ile kapanir ve sorgu temizlenir', async () => {
    kur()
    await ac()
    await userEvent.type(kutu(), 'kaygi')
    expect((kutu() as HTMLInputElement).value).toBe('kaygi')

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()

    await ac()
    expect((kutu() as HTMLInputElement).value).toBe('')
  })

  it('kapaninca sonuclar EKRANDA KALMAZ', async () => {
    // Ekran görünürken danışan odada olabilir; sonuçlar not içeriğinden
    // parça taşıyor. "Kapandı ama liste duruyor" en somut sızıntı biçimi.
    kur()
    await ac()
    await userEvent.type(kutu(), 'kaygi')
    await screen.findByText(/uyku düzeni ve kaygı üzerine konuşuldu/)

    await userEvent.keyboard('{Escape}')
    expect(document.body.textContent).not.toContain('uyku düzeni ve kaygı')

    // Yeniden açılınca da eski sonuçlar geri gelmez.
    await ac()
    expect(document.body.textContent).not.toContain('uyku düzeni ve kaygı')
  })

  it('kapaninca sonuclar STATE ten de silinir, ekrandan gizlenmekle kalmaz', async () => {
    // Türetme (sonuçlar sorguya bağlı) kapalıyken listeyi zaten gizler —
    // yani "gizlendi mi" testi, `setYanit(null)`'ı kaldıran bir mutasyonu
    // YAKALAMAZ. Gözlemlenebilir hâli: aynı sorguyla yeniden açmak. Bayat
    // yanıt state'te durursa yeni istek daha dönmeden ESKİ not parçası
    // ekrana gelir.
    let ikinciTur = false
    const ara = vi.fn(async () =>
      // İkinci turda arama hiç bitmiyor: ekranda ne varsa bayat olandır.
      ikinciTur ? new Promise<AramaYaniti>(() => {}) : yanit([notSonucu]),
    )
    kur({ ara })
    await ac()
    await userEvent.type(kutu(), 'kaygi')
    await screen.findByText(/uyku düzeni ve kaygı üzerine konuşuldu/)

    await userEvent.keyboard('{Escape}')
    ikinciTur = true
    await ac()
    await userEvent.type(kutu(), 'kaygi')

    expect(await screen.findByText(/aranıyor/i)).toBeDefined()
    expect(document.body.textContent).not.toContain('uyku düzeni ve kaygı')
  })

  it('kapat dugmesi de ayni temizligi yapar', async () => {
    kur()
    await ac()
    await userEvent.type(kutu(), 'kaygi')
    await screen.findByText(/uyku düzeni ve kaygı üzerine konuşuldu/)

    await userEvent.click(screen.getByRole('button', { name: 'Aramayı kapat' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.textContent).not.toContain('uyku düzeni ve kaygı')
  })
})

// `aria-modal="true"` bir SÖZDÜR: "arkadaki her şey atıl". Aşağıdaki
// testler o sözün dört parçasını da ölçüyor. Biri bile kalkarsa etiket
// yeniden yalan söylemeye başlar ve o zaman etiketin kendisi de kalkmalı
// (dürüstlük gereği bir kez zaten kaldırılmıştı).
describe('HizliArama — gerçek modal davranışı', () => {
  // `document.body`ye elle eklenen öğeler RTL'in `cleanup`ı tarafından
  // KALDIRILMAZ. Temizlenmezlerse bir sonraki teste sızar ve orada hâlâ
  // ODAKLI olurlar -- "odak nereye döndü" iddiaları sessizce yanlış şeyi
  // ölçmeye başlar (bu test dosyasında bir kez tam olarak bu oldu).
  let eklenenler: HTMLElement[] = []

  afterEach(() => {
    for (const oge of eklenenler) oge.remove()
    eklenenler = []
    ;(document.activeElement as HTMLElement | null)?.blur()
  })

  /** Katmanın dışında kalan, odaklanabilir bir "arka plan" öğesi. */
  function arkaPlanli(ozel: Partial<React.ComponentProps<typeof HizliArama>> = {}) {
    const disarisi = document.createElement('button')
    disarisi.textContent = 'Arka plandaki düğme'
    document.body.appendChild(disarisi)
    eklenenler.push(disarisi)
    const props = kur(ozel)
    return { ...props, disarisi }
  }

  it('acilinca odak arama kutusuna gider', async () => {
    kur()
    await ac()
    expect(document.activeElement).toBe(kutu())
  })

  it('kapaninca odak TETIKLEYEN ogeye geri doner', async () => {
    // Ctrl+K sayfanın herhangi bir yerinden basılabilir; odak açma
    // düğmesine değil, kullanıcının BULUNDUĞU yere dönmeli. Aksi hâlde
    // klavye kullanıcısı her aramadan sonra sayfanın başına atılır.
    const { disarisi } = arkaPlanli()
    disarisi.focus()
    expect(document.activeElement).toBe(disarisi)

    await ac()
    expect(document.activeElement).toBe(kutu())

    await userEvent.keyboard('{Escape}')
    expect(document.activeElement).toBe(disarisi)
  })

  it('odak yakalanacak bir oge yoksa ACMA DUGMESINE doner', async () => {
    // Ctrl+K odak `body`deyken basıldığında yedek hat: `body.focus()`
    // hiçbir şey yapmaz ve kullanıcı odağı KAYBEDERDİ.
    kur()
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)
    await ac()
    await userEvent.keyboard('{Escape}')
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Hızlı arama (Ctrl+K)' }),
    )
  })

  it('arkadaki icerik `inert` olur ve kapaninca geri alinir', async () => {
    const { disarisi } = arkaPlanli()
    expect(disarisi.hasAttribute('inert')).toBe(false)

    await ac()
    expect(disarisi.hasAttribute('inert')).toBe(true)
    // Katmanın KENDİSİ atıl olmamalı: kendi kabını da `inert` yapan bir
    // uygulama katmanı kullanılamaz kılardı.
    const kutucuk = screen.getByRole('dialog', { name: 'Hızlı arama' })
    expect(kutucuk.closest('[inert]')).toBeNull()

    await userEvent.keyboard('{Escape}')
    expect(disarisi.hasAttribute('inert')).toBe(false)
  })

  it('katman disinda ZATEN duran bir `inert` sessizce KALDIRILMAZ', async () => {
    // Kapanış temizliği yalnızca KENDİ eklediklerini geri almalı; başka
    // bir katmanın koyduğu `inert`i silmek onu sessizce erişilebilir
    // kılardı.
    const { disarisi } = arkaPlanli()
    disarisi.setAttribute('inert', '')

    await ac()
    await userEvent.keyboard('{Escape}')
    expect(disarisi.hasAttribute('inert')).toBe(true)
  })

  it('Tab odagi katmanin ICINDE tutar (ileri ve geri)', async () => {
    // `inert` desteklemeyen bir tarayıcıda tuzak ikinci savunma hattı;
    // jsdom `inert` semantiğini uygulamıyor, dolayısıyla burada ölçülen
    // ŞEY tuzağın kendisi.
    kur()
    await ac()
    await userEvent.type(kutu(), 'kaygi')
    await screen.findByText(/uyku düzeni ve kaygı üzerine konuşuldu/)

    const panel = screen.getByRole('dialog', { name: 'Hızlı arama' })
    const odaklanabilir = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'),
      )
    const ogeler = odaklanabilir()
    expect(ogeler.length).toBeGreaterThan(1)

    // Son öğeden ileri Tab -> ilk öğeye sarar.
    ogeler[ogeler.length - 1].focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(ogeler[0])

    // İlk öğeden geri Tab -> son öğeye sarar.
    ogeler[0].focus()
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(ogeler[ogeler.length - 1])
  })

  it('backdrop tiklamasi kapatir, panel ici tiklama KAPATMAZ', async () => {
    kur()
    await ac()
    // Panel içine tıklamak kapatmamalı (yoksa kullanıcı metin seçemez).
    await userEvent.click(screen.getByRole('dialog', { name: 'Hızlı arama' }))
    expect(screen.queryByRole('dialog')).not.toBeNull()

    const backdrop = screen.getByRole('dialog', { name: 'Hızlı arama' }).parentElement
    expect(backdrop).not.toBeNull()
    await userEvent.click(backdrop as HTMLElement)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('kapaninca portal kabi govdeden KALKAR', async () => {
    // Gizlenmiş ama duran bir katman kabı, ekranda görünmeyen bir not
    // parçasını DOM'da bırakırdı.
    kur()
    const oncekiSayi = document.body.children.length
    await ac()
    expect(document.body.children.length).toBe(oncekiSayi + 1)
    await userEvent.keyboard('{Escape}')
    expect(document.body.children.length).toBe(oncekiSayi)
  })
})

describe('HizliArama — sorgu eşiği ve geciktirme', () => {
  it('iki karakterden kisa sorguda arama yapmaz', async () => {
    const { ara } = kur()
    await ac()
    await userEvent.type(kutu(), 'k')
    await new Promise((coz) => setTimeout(coz, 40))
    expect(ara).not.toHaveBeenCalled()
    expect(screen.getByText(/en az 2 karakter/i)).toBeDefined()
  })

  it('ARTI YON: iki karakterde arama YAPAR', async () => {
    // Bu yarı olmadan "hiç arama yapmayan" bir bileşen de üstteki testi
    // geçerdi (tek yönlü mutasyon kapsamı).
    const { ara } = kur()
    await ac()
    await userEvent.type(kutu(), 'ka')
    await waitFor(() => expect(ara).toHaveBeenCalledWith('ka'))
  })

  it('bosluklardan ibaret sorgu arama yapmaz', async () => {
    const { ara } = kur()
    await ac()
    await userEvent.type(kutu(), '   ')
    await new Promise((coz) => setTimeout(coz, 40))
    expect(ara).not.toHaveBeenCalled()
  })

  it('hizli yazilan sorgu TEK istek uretir', async () => {
    // Her tuş vuruşu bir istek olsaydı 5 harflik bir sorgu 4 gereksiz
    // istek atardı; her biri sunucuda not içeriği okur ve (birleştirilse
    // bile) silinemez bir denetim satırı üretme riski taşır.
    //
    // # Neden `userEvent.type` DEĞİL (dal incelemesi M6)
    //
    // Bu test yüke duyarlıydı: testte `gecikmeMs` 5 ms ve `userEvent.type`
    // tuşlar arasında gerçek zamanda **await ediyor**. Yüklü bir makinede
    // iki tuş arasındaki duraklama 5 ms'yi aşabiliyor, debounce doluyor ve
    // **ürün doğru çalıştığı hâlde** ikinci bir istek çıkıyordu. Tam paket
    // koşusunda ara sıra kırılıyor, tek başına 4/4 geçiyordu.
    //
    // Beş değişiklik olayı burada TEK BİR SENKRON BLOKTA gönderiliyor:
    // aralarında hiçbir `await` yok, dolayısıyla JS tek iş parçacığında
    // hiçbir zamanlayıcı geri çağrısı araya giremez. "Hızlı yazma" artık
    // bir zamanlama yarışı değil, bir olgu.
    //
    // İddia ZAYIFLAMADI, güçlendi: yazma sırasında HİÇBİR isteğin
    // atılmadığı da artık ölçülüyor. Debounce'suz bir sürüm (her tuşta
    // `ara()`) burada beş çağrıyla, `setTimeout`u tümüyle kaldıran bir
    // sürüm de ilk iddiada kırılır.
    const { ara, gecikmeMs } = kur()
    await ac()

    const alan = kutu() as HTMLInputElement
    for (const parca of ['k', 'ka', 'kay', 'kayg', 'kaygi']) {
      fireEvent.change(alan, { target: { value: parca } })
    }
    expect(alan.value).toBe('kaygi')
    // Tuşlar arasında hiçbir istek atılmadı.
    expect(ara).not.toHaveBeenCalled()

    await waitFor(() => expect(ara).toHaveBeenCalled())
    // Bekleyen başka bir zamanlayıcı yok; yine de gecikmenin birkaç katı
    // beklenip ikinci bir isteğin BELİRMEDİĞİ doğrulanıyor.
    await new Promise((coz) => setTimeout(coz, gecikmeMs * 8))
    expect(ara).toHaveBeenCalledTimes(1)
    expect(ara).toHaveBeenCalledWith('kaygi')
  })

  it('sorgu tumuyle silinince sonuclar ekrandan kalkar', async () => {
    kur()
    await ac()
    await userEvent.type(kutu(), 'kaygi')
    await screen.findByText(/uyku düzeni ve kaygı üzerine konuşuldu/)
    await userEvent.clear(kutu())
    await waitFor(() =>
      expect(document.body.textContent).not.toContain('uyku düzeni ve kaygı'),
    )
  })

  it('varsayilan gecikme 250 ms', () => {
    // Testler kısa bir gecikmeyle çalışıyor; ürünün gerçek değeri burada
    // sabitlenmezse plandaki 250 ms sessizce kayabilirdi.
    expect(GECIKME_MS).toBe(250)
  })
})

describe('HizliArama — sonuçlar', () => {
  it('sonuc secilince ilgili seansa gider', async () => {
    const { onSeansSec, onDanisanSec } = kur()
    await ac()
    await userEvent.type(kutu(), 'kaygi')

    // Erişilebilir ad saati de taşıyor: aynı gün iki seansı olan bir
    // danışanda yalnızca tarih ayırt edici olmazdı.
    const dugme = await screen.findByRole('button', { name: /07\.09\.2026 10:00 seansına git/ })
    await userEvent.click(dugme)

    expect(onSeansSec).toHaveBeenCalledWith(101, '2026-09-07T10:00')
    expect(onDanisanSec).not.toHaveBeenCalled()
    // Seansa gidince arama kapanır ve sonuçlar ekranda kalmaz.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.body.textContent).not.toContain('uyku düzeni ve kaygı')
  })

  it('danisan sonucu secilince dosyaya gider', async () => {
    const { onSeansSec, onDanisanSec } = kur()
    await ac()
    await userEvent.type(kutu(), 'ayse')

    const dugme = await screen.findByRole('button', { name: /danışan dosyasını aç/ })
    await userEvent.click(dugme)

    expect(onDanisanSec).toHaveBeenCalledWith(12)
    expect(onSeansSec).not.toHaveBeenCalled()
  })

  it('sonuc yoksa bunu soyler', async () => {
    const { ara } = kur({ ara: vi.fn().mockResolvedValue(yanit([])) })
    await ac()
    await userEvent.type(kutu(), 'zzzz')
    await waitFor(() => expect(ara).toHaveBeenCalled())
    expect(await screen.findByText(/sonuç bulunamadı/i)).toBeDefined()
  })

  it('yanit beklenirken "sonuc bulunamadi" DEMEZ', async () => {
    // Türetilen liste yanıt gelene kadar boş; ayrım yapılmasaydı ekranda
    // henüz sorulmamış bir sorunun cevabı görünürdü.
    let coz: (s: AramaYaniti) => void = () => {}
    const ara = vi.fn(() => new Promise<AramaYaniti>((c) => { coz = c }))
    kur({ ara })
    await ac()
    await userEvent.type(kutu(), 'kaygi')

    expect(await screen.findByText(/aranıyor/i)).toBeDefined()
    expect(screen.queryByText(/sonuç bulunamadı/i)).toBeNull()

    // SENKRONİZASYON BARİYERİ (dal incelemesi M6 ile aynı sınıf, altıncı
    // biçim). "Aranıyor…" metni istek ATILMADAN da görünür: `bekleniyor`
    // yalnızca "sorgu yeterince uzun ve yanıt yok" demek. Yüklü bir
    // makinede `userEvent.type` tuşlar arasında gerçekten bekliyor,
    // 5 ms'lik debounce ARA bir önek için ('ka') dolabiliyor ve son
    // sorgunun ('kaygi') zamanlayıcısı hâlâ beklerken `coz` o ara isteğe
    // işaret ediyor. O hâlde `coz(...)` BAYAT bir sorguyu çözer, ekranda
    // hiçbir şey değişmez ve test **ürün doğru çalıştığı hâlde** kırılır
    // (tam paket koşusunda bir kez oldu). Bariyer, çözülecek isteğin
    // gerçekten SON sorguya ait olmasını garanti eder.
    await waitFor(() => expect(ara).toHaveBeenCalledWith('kaygi'))
    coz(yanit([]))
    expect(await screen.findByText(/sonuç bulunamadı/i)).toBeDefined()
  })

  it('sorgu degisince onceki sorgunun sonuclari BIR KARE bile gorunmez', async () => {
    // Sonuçlar hangi sorguya ait olduklarıyla birlikte tutuluyor ve render
    // sırasında süzülüyor; efekte bırakılsaydı arada bir kare boyunca
    // önceki sorgunun not parçaları ekranda kalırdı.
    const bekleyen = vi.fn(async (q: string) => yanit(q === 'kaygi' ? [notSonucu] : []))
    kur({ ara: bekleyen })
    await ac()
    await userEvent.type(kutu(), 'kaygi')
    await screen.findByText(/uyku düzeni ve kaygı üzerine konuşuldu/)

    await userEvent.type(kutu(), 'x')
    expect(document.body.textContent).not.toContain('uyku düzeni ve kaygı')
  })

  it('hata durumunda hata gosterilir ve eski sonuclar SILINIR', async () => {
    let basarisiz = false
    const ara = vi.fn(async (q: string) => {
      if (basarisiz) throw new Error('Arama yapılamadı.')
      return yanit(q === 'kaygi' ? [notSonucu] : [])
    })
    kur({ ara })
    await ac()
    await userEvent.type(kutu(), 'kaygi')
    await screen.findByText(/uyku düzeni ve kaygı üzerine konuşuldu/)

    basarisiz = true
    await userEvent.type(kutu(), 'x')
    await screen.findByText('Arama yapılamadı.')
    // Bayat sonuçlar ekranda kalırsa kullanıcı hatayı görmezden gelip
    // eskisine tıklar.
    expect(document.body.textContent).not.toContain('uyku düzeni ve kaygı')
  })
})

// Görev 6'dan devreden bilinen boşluk KAPANDI: `/api/ara` artık `kirpildi`
// işaretini taşıyor ve arayüz onu kullanıyor. Eskiden arayüz "sonuç sayısı
// == ARAMA_SINIRI" diye tahmin yürütüyordu; o sezgi iki yönde de yanlıştı
// ve aşağıdaki ilk iki test tam olarak o iki yönü ölçüyor.
describe('HizliArama — sunucu sonuçların kırpıldığını bildirdiğinde', () => {
  function sonuclar(adet: number): AramaSonucu[] {
    return Array.from({ length: adet }, (_, i) => ({
      ...danisanSonucu,
      client_id: i + 1,
      danisan_adi: `Danisan ${i + 1}`,
      parca: `Danisan ${i + 1}`,
    }))
  }

  it('`kirpildi` DOGRUYSA aramayi daraltma uyarisi gosterir', async () => {
    // Sayı sınırın çok ALTINDA ama sunucu kırpıldığını söylüyor: eski
    // sezgi (`sayi == 50`) burada uyarmayı KAÇIRIRDI. İki kipin bütçesi
    // ayrı ayrı dolduğunda gerçekleşen durum tam olarak bu.
    kur({ ara: vi.fn().mockResolvedValue(yanit(sonuclar(4), true)) })
    await ac()
    await userEvent.type(kutu(), 'yilmaz')
    expect(await screen.findByText(/aramayı daraltın/i)).toBeDefined()
  })

  it('`kirpildi` YANLISSA sonuc sayisi sinira ESIT olsa bile uyarmaz', async () => {
    // Eski sezginin yanlış uyardığı yön: tam 50 eşleşme var, hiçbiri
    // düşmedi. Her zaman uyaran bir arayüz uyarıyı anlamsızlaştırır.
    kur({ ara: vi.fn().mockResolvedValue(yanit(sonuclar(ARAMA_SINIRI), false)) })
    await ac()
    await userEvent.type(kutu(), 'yilmaz')
    await screen.findByRole('button', { name: /Danisan 1 — danışan dosyasını aç/ })
    expect(screen.queryByText(/aramayı daraltın/i)).toBeNull()
  })

  it('uyari GOSTERILEN sonuc sayisini ekranda yazar ama loga yazmaz', async () => {
    const casus = vi.spyOn(console, 'log').mockImplementation(() => {})
    kur({ ara: vi.fn().mockResolvedValue(yanit(sonuclar(7), true)) })
    await ac()
    await userEvent.type(kutu(), 'yilmaz')
    const uyari = await screen.findByText(/aramayı daraltın/i)
    expect(uyari.textContent).toContain('7 sonuç gösteriliyor')
    expect(casus).not.toHaveBeenCalled()
  })

  it('uyari BAYAT bir yanittan kalmaz', async () => {
    // Sorgu değişince uyarı da sonuçlarla birlikte düşmeli; aksi hâlde
    // kırpılmayan yeni bir sonuç listesinin üstünde eski uyarı durur.
    const ara = vi.fn(async (q: string) =>
      q === 'yilmaz' ? yanit(sonuclar(4), true) : yanit(sonuclar(1), false),
    )
    kur({ ara })
    await ac()
    await userEvent.type(kutu(), 'yilmaz')
    await screen.findByText(/aramayı daraltın/i)

    await userEvent.clear(kutu())
    await userEvent.type(kutu(), 'demir')
    await waitFor(() => expect(screen.queryByText(/aramayı daraltın/i)).toBeNull())
  })
})

describe('HizliArama — gizlilik', () => {
  it('arama terimi ve not parcalari console\'a yazilmaz', async () => {
    const gunlukler = ['log', 'info', 'warn', 'error', 'debug'] as const
    const casuslar = gunlukler.map((a) => vi.spyOn(console, a).mockImplementation(() => {}))

    const { ara } = kur()
    await ac()
    await userEvent.type(kutu(), 'kaygi')
    await waitFor(() => expect(ara).toHaveBeenCalled())
    await screen.findByText(/uyku düzeni ve kaygı üzerine konuşuldu/)
    await userEvent.keyboard('{Escape}')

    for (const casus of casuslar) expect(casus).not.toHaveBeenCalled()
  })

  // Sunucudaki `store::search::kaynak_kodda_private_notes_gecmez` testinin
  // istemci karşılığı. Davranışsal testler "bugün sızmıyor" der; bu test
  // "sızdırabilecek bir yol EKLENEMEZ" der — sızıntının en olası biçimi,
  // ileride birinin aramaya "bir de özel notlara bakalım" diye ikinci bir
  // kaynak eklemesidir.
  describe('kaynak kodda özel nota giden bir yol YOKTUR', () => {
    it('kaynak gercekten okundu', () => {
      // Boş bir okuma, aşağıdaki iddiayı hiçbir şeyi sınamayan bir yeşile
      // çevirirdi.
      expect(aramaKaynagi.length).toBeGreaterThan(500)
      expect(aramaKaynagi).toContain('export function HizliArama')
    })

    it('kod bolumunde `ozelNotApi` / `ozel-not` gecmiyor', () => {
      // Yorumlar hariç tutuluyor: bu dosyanın başlığı özel notlardan
      // BAHSEDİYOR (neden gelmediklerini anlatıyor) ve bir yorum, kodun
      // yapısı hakkındaki iddiayı tatmin edemez — dokuzuncu biçim.
      const kod = aramaKaynagi
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect(kod).not.toContain('ozelNotApi')
      expect(kod).not.toContain('ozel-not')
      expect(kod).not.toContain('private_notes')
      // ARTI YÖN: yorum ayıklama kodu boşaltmadı (boş bir dizgi yukarıdaki
      // üç iddiayı da geçerdi). Sentinel olarak `kirpildi` seçildi: hem
      // kod bölümünde geçiyor hem de bu bileşenin sunucudan gelen
      // kırpılma işaretini gerçekten okuduğunu söylüyor.
      expect(kod).toContain('kirpildi')
      expect(kod).toContain('export function HizliArama')
    })
  })

  it('ekranda gorunen her sey YALNIZCA `ara` sonucundan gelir', async () => {
    // Yapısal iddia: bileşenin ikinci bir veri kaynağı yok. Sunucudaki
    // `store::search` `private_notes`'u hiç tanımıyor; istemcide de arama
    // katmanının başka bir uç noktaya gitmesi mümkün olmamalı.
    const gercekFetch = globalThis.fetch
    const sahteFetch = vi.fn()
    globalThis.fetch = sahteFetch as unknown as typeof fetch
    try {
      const { ara } = kur()
      await ac()
      await userEvent.type(kutu(), 'kaygi')
      await waitFor(() => expect(ara).toHaveBeenCalled())
      expect(sahteFetch).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = gercekFetch
    }
  })
})
