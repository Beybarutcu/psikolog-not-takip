import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DanisanSeansi } from '../api'
import type { KartVerisi, useDanisanDosyasi } from '../screens/anaEkranKancalari/useDanisanDosyasi'
import type { useDanisanListesi } from '../screens/anaEkranKancalari/useDanisanListesi'
import { useDanisanSeanslari } from '../screens/anaEkranKancalari/useDanisanSeanslari'
import { DanisanlarSekmesi } from './DanisanlarSekmesi'

// `danisanApi.seanslar` test başına değiştirilebilir. `null` iken GERÇEK
// istemci çalışır. Desen `AyOzeti.test.tsx`deki `taklit` ile AYNI.
const taklit = vi.hoisted(() => ({
  seanslar: null as null | ((clientId: number) => Promise<DanisanSeansi[]>),
}))

vi.mock('../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../api')>()
  return {
    ...gercek,
    danisanApi: {
      ...gercek.danisanApi,
      seanslar: (clientId: number) => (taklit.seanslar ?? gercek.danisanApi.seanslar)(clientId),
    },
  }
})

afterEach(() => {
  taklit.seanslar = null
})

function sahteKart(seciliDanisanId: number | null): KartVerisi {
  return { id: seciliDanisanId, dosya: null, ekler: [], randevular: [], hata: null }
}

function sahteDosya(seciliDanisanId: number | null): ReturnType<typeof useDanisanDosyasi> {
  return {
    seciliDanisanId,
    kart: sahteKart(seciliDanisanId),
    depolama: null,
    ac: () => {},
    kapat: () => {},
    yenidenDene: () => {},
    rizaKaydet: async () => {},
    ekYukle: async () => {},
    ekSil: async () => {},
    randevuYamala: () => {},
  }
}

function sahteListe(): ReturnType<typeof useDanisanListesi> {
  return {
    danisanlar: [],
    formAcik: false,
    setFormAcik: () => {},
    yeniAdSoyad: '',
    setYeniAdSoyad: () => {},
    yeniTelefon: '',
    setYeniTelefon: () => {},
    hata: null,
    arsivOnayi: null,
    setArsivOnayi: () => {},
    arsivBilgisi: null,
    setArsivBilgisi: () => {},
    arsivSuruyor: false,
    saklamaDolanlar: [],
    ekle: async () => {},
    arsivle: async () => {},
  }
}

function seansSayisi(): string | null {
  return screen.getByTestId('danisan-dosyasi-sag-kolon').getAttribute('data-seans-sayisi')
}

/**
 * Gerçek kullanım şeklinin (`AnaEkran`, Görev 8'de) KÜÇÜLTÜLMÜŞ hâli:
 * `useDanisanSeanslari`i BURADA çağırır ve sonucunu `DanisanlarSekmesi`ye
 * prop olarak geçirir — tıpkı `liste`/`dosya`nın da kendi kancalarından
 * geldiği gibi. `seanslar` verisinin kendisi bu görevde ekrana BASILMIYOR
 * (bkz. `DanisanlarSekmesi.tsx` modül başlığı); bu yüzden akışın
 * gözlemlenebilir kanıtı `data-seans-sayisi` — sağ kolonun her render'da
 * `useDanisanSeanslari`nin ürettiği listenin UZUNLUĞUNU taşıyan bir prob.
 */
function Kapsayici({ seciliDanisanId }: { seciliDanisanId: number | null }) {
  const { seanslar } = useDanisanSeanslari({ clientId: seciliDanisanId, onYetkisiz: () => {} })
  return (
    <DanisanlarSekmesi
      liste={sahteListe()}
      dosya={sahteDosya(seciliDanisanId)}
      seanslar={seanslar}
      onDanisanSec={() => {}}
      veriRaporuIndir={async () => {}}
    />
  )
}

function seans(oz: Partial<DanisanSeansi> = {}): DanisanSeansi {
  return {
    appointment_id: 1,
    baslangic: '2026-09-14T10:00',
    durum: 'geldi',
    ucret_kurus: 15000,
    odendi: false,
    not_ilk_satiri: null,
    ...oz,
  }
}

/** Test açıkça çözene kadar bekleyen bir söz (`AyOzeti.test.tsx`in `kapi`sı). */
function kapi<T>() {
  let coz!: (v: T) => void
  const promise = new Promise<T>((c) => {
    coz = c
  })
  return { promise, coz }
}

describe('DanisanlarSekmesi', () => {
  it('danışan seçilmemişken sağ kolonda yönlendirme yazısı olur', () => {
    render(
      <DanisanlarSekmesi
        liste={sahteListe()}
        dosya={sahteDosya(null)}
        seanslar={[]}
        onDanisanSec={() => {}}
        veriRaporuIndir={async () => {}}
      />,
    )
    // `jest-dom` bu pakette kurulu değil (`test-kurulum.ts`'te yok,
    // `TakvimSekmesi.test.tsx`deki aynı gerekçe): `toBeInTheDocument`
    // burada TANIMSIZ olurdu, `queryByText` + `toBeNull` deseni kullanılır.
    expect(screen.queryByText(/dosyasını açmak için soldaki listeden/i)).not.toBeNull()
  })

  it('seçili danışan değişince seans listesi yeniden çekilir', async () => {
    const cagrilanIdler: number[] = []
    taklit.seanslar = (clientId: number) => {
      cagrilanIdler.push(clientId)
      return Promise.resolve([seans({ appointment_id: clientId * 100 })])
    }

    const { rerender } = render(<Kapsayici seciliDanisanId={1} />)
    await waitFor(() => expect(cagrilanIdler).toContain(1))
    await waitFor(() => expect(seansSayisi()).toBe('1'))

    rerender(<Kapsayici seciliDanisanId={2} />)
    await waitFor(() => expect(cagrilanIdler).toContain(2))
    await waitFor(() => expect(seansSayisi()).toBe('1'))
    // İKİ ayrı çağrı: yalnızca ilk seçimde istek atılıp sonucun ikinci
    // danışan için de aynen kullanılmadığının kanıtı.
    expect(cagrilanIdler).toEqual([1, 2])
  })

  it('geciken yanıt yeni seçimin listesini ezmez', async () => {
    // 1 numaralı danışanın yanıtı GEÇ geliyor; arada 2'ye geçiliyor. Geciken
    // yanıt ekrana yazılırsa 2'nin dosyasında 1'in seansları görünür —
    // Plan 3'te aynı sınıf hata gerçekten oldu (bir danışanın notu başka
    // danışanın dosyasında görünmüştü).
    const kapi1 = kapi<DanisanSeansi[]>()
    const kapi2 = kapi<DanisanSeansi[]>()
    const istenenler: number[] = []
    taklit.seanslar = (clientId: number) => {
      istenenler.push(clientId)
      return clientId === 1 ? kapi1.promise : kapi2.promise
    }

    const { rerender } = render(<Kapsayici seciliDanisanId={1} />)
    await waitFor(() => expect(istenenler).toContain(1))

    rerender(<Kapsayici seciliDanisanId={2} />)
    await waitFor(() => expect(istenenler).toContain(2))

    // 2'nin yanıtı ÖNCE gelir: BOŞ liste.
    await act(async () => {
      kapi2.coz([])
    })
    await waitFor(() => expect(seansSayisi()).toBe('0'))

    // 1'in GECİKEN yanıtı şimdi gelir: dolu bir liste. Ekran hâlâ 2
    // numaralı danışanı gösteriyor, bu yanıt görünmemeli.
    await act(async () => {
      kapi1.coz([seans({ appointment_id: 999 }), seans({ appointment_id: 998 })])
    })
    expect(seansSayisi()).toBe('0')
  })
})
