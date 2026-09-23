import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { etiketAdiNormallestir, etiketAnahtari, etiketSirasi } from '../etiket/etiketAdi'
import { notOnizlemesi } from '../seans/onizleme'
import { taslaklariUnut } from '../seans/taslak'
import { AnaEkran } from './AnaEkran'

/**
 * Son inceleme — takvim ile danışan dosyasının AYNI seansa bakması.
 *
 * Bu dosya `AnaEkran.test.tsx`'ten AYRI: o dosya 3600+ satır (bölünmesi ayrı
 * bir görev, defterde ertelenmiş) ve buradaki bütün testler tek bir sınıfı
 * ölçüyor — bir ekranda yapılan yazmanın DİĞER ekranın önbelleğine
 * yayılması (C1/C2), ve o yayılımın dayandığı kabuk kararları (I1-I3, M1).
 *
 * Sunucu taklidi YAZMALARI GERÇEKTEN uygular (not, ödeme, durum) ve her
 * okuma o anki değeri döndürür: "ekran bayat mı" sorusu ancak böyle
 * ölçülebilir — sabit yanıt dönen bir taklit, yeniden çekmeyen ama
 * yamalamayan bir istemciyi de yeşil geçirirdi.
 *
 * Plan 6 Görev 6: etiket uçları da aynı taklitte (sözlük, seansın
 * etiketleri, ekleme, kaldırma, etiketli seanslar) — yine YAZMAYI GERÇEKTEN
 * uygulayan bir bellek içi depo (`etiketDeposu`, `baglar`), sunucunun
 * `store::tags` kurallarıyla: kimlik Türkçe küçük harf, ad 1-40 karakter,
 * zaten bağlıysa ekleme etkisiz, bağlı değilse kaldırma 404, kullanımı
 * sıfıra düşen etiket sözlükten silinir.
 *
 * İki ayrı bekletme var, ikisi de "METHOD yol" anahtarlı:
 *   - `onceBekle`: istek İŞLENMEDEN bekler (sunucu yazmayı henüz yapmadı).
 *   - `sonraBekle`: yanıt ANLIK GÖRÜNTÜSÜ alındıktan SONRA bekler (sunucu
 *     okumayı eski değerle yaptı, yanıt geç geliyor) — `yazmaSaati`nin
 *     kapattığı yarışın tam kurulumu.
 */

const BUGUN_SAATI = new Date(2026, 8, 9, 12, 0) // Çarşamba; hafta başı 2026-09-07

const danisanlar = [
  { id: 1, ad_soyad: 'Ayşe Yılmaz', telefon: null, durum: 'aktif' },
  { id: 2, ad_soyad: 'Mehmet Demir', telefon: null, durum: 'aktif' },
]

// Ayşe'nin iki seansı: 201 GEÇMİŞTE (bu hafta Pazartesi), 202 GELECEKTE
// (sonraki hafta). 202 "geldi", 450 TL, ödenmemiş: kartın bakiyesi ve ay
// özetinin borcu bu seanstan.
const R201 = {
  id: 201, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
  baslangic: '2026-09-07T10:00', bitis: '2026-09-07T11:00',
  durum: 'planlandi', ucret: null as number | null, odendi: false, seri_id: null,
}
const R202 = {
  id: 202, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
  baslangic: '2026-09-14T10:00', bitis: '2026-09-14T11:00',
  durum: 'geldi', ucret: 45000 as number | null, odendi: false, seri_id: null,
}
const R203 = {
  id: 203, client_id: 2, danisan_adi: 'Mehmet Demir',
  baslangic: '2026-09-08T13:00', bitis: '2026-09-08T14:00',
  durum: 'planlandi', ucret: null as number | null, odendi: false, seri_id: null,
}
const TUMU = [R201, R202, R203]
type RandevuKaydi = Omit<(typeof TUMU)[number], 'seri_id'> & { seri_id: string | null }

const dosyalar: Record<number, unknown> = {
  1: {
    id: 1, ad_soyad: 'Ayşe Yılmaz', telefon: '0555 111 22 33', durum: 'aktif',
    dogum_tarihi: null, basvuru_nedeni: null, risk_notu: null,
    riza_tarihi: '2026-03-01', riza_dosya_id: null, son_temas: null, saklama_bitis: null,
  },
  2: {
    id: 2, ad_soyad: 'Mehmet Demir', telefon: null, durum: 'aktif',
    dogum_tarihi: null, basvuru_nedeni: null, risk_notu: null,
    riza_tarihi: null, riza_dosya_id: null, son_temas: null, saklama_bitis: null,
  },
}

type NotKaydi = { sablon: string; icerik: string }
type Istek = { method: string; yol: string; govde: unknown }

let notlar: Record<number, NotKaydi>
let odemeler: Record<number, boolean>
let durumlar: Record<number, string>
let istekler: Istek[]
let onceBekle: Record<string, Promise<void> | undefined>
let sonraBekle: Record<string, Promise<void> | undefined>
/**
 * AYNI URL'e giden BİRDEN FAZLA isteği BAĞIMSIZ bekletmek için (Görev 2
 * inceleme CRITICAL: kartın mount okuması ile `randevularTazele`nin okuması
 * AYNI URL'e gidiyor). `onceBekle`/`sonraBekle`'de `"METHOD yol#N"` anahtarı
 * (N = o URL'e giden KAÇINCI istek) varsa o kullanılır, yoksa eski
 * davranışa (URL'in HER çağrısını aynı kapıyla bekletme) düşülür.
 */
let cagriSayaci: Record<string, number>
let seanslarHatasi: boolean
/** Etiket sözlüğü (sunucudaki `tags`): kimlik → görünen ad. */
let etiketDeposu: Map<number, string>
/** Seans → bağlı etiket kimlikleri (sunucudaki `progress_note_tags`). */
let baglar: Record<number, number[]>
let sonrakiEtiketId: number
/** Kurulursa HER istek 401 döner (oturum kilitlendi). */
let yetkisiz: boolean
/**
 * SQLite'ın `AUTOINCREMENT`'SİZ `INTEGER PRIMARY KEY` kuralı: yeni kimlik =
 * o anki en büyük kimlik + 1, yani silinen EN BÜYÜK kimlik yeniden verilir
 * (Görev 6 inceleme IMPORTANT-1). Varsayılan KAPALI (artan sayaç, şemanın
 * bugünkü `AUTOINCREMENT` davranışı); açıkken istemcinin kimliği tek başına
 * kalıcı kimlik saymadığı ölçülür.
 */
let idYenidenKullan: boolean
/** Kurulursa `POST .../etiketler` 500 döner. */
let etiketEklemeHatasi: boolean
/**
 * Randevu yazmaları (son inceleme I1): sunucu PUT/DELETE'i GERÇEKTEN
 * uygular, her okuma `tumu()` üzerinden o anki hâli görür.
 */
let randevuDegisiklikleri: Record<number, Partial<RandevuKaydi>>
let silinenRandevular: Set<number>
/**
 * Randevu paneli bugün başlangıcı DÜZENLEMİYOR (yalnızca danışan, süre,
 * ücret); "saati değişen randevu" bu yüzden PUT'un sunucuda yeni bir
 * başlangıçla sonuçlandığı taklitle kuruluyor. Ölçülen şey başarılı bir
 * randevu yazmasından sonra açık panelin SUNUCUNUN o anki hâlini göstermesi.
 */
let putBaslangici: Record<number, string>
/**
 * Takvimden OLUŞTURULAN randevular ("Bayatlık" bloğu) ve testin kendi
 * eklediği kurulum satırları (ör. seri üyesi). `TUMU` sabit kalır.
 */
let eklenenler: RandevuKaydi[]
let sonrakiId: number

/** Sunucunun o anki randevuları: silinenler yok, yazmalar uygulanmış. */
function tumu(): RandevuKaydi[] {
  return [...TUMU, ...eklenenler]
    .filter((r) => !silinenRandevular.has(r.id))
    .map((r) => ({ ...r, ...randevuDegisiklikleri[r.id] }))
}

/** Randevu silinince bağları gider; kullanımı sıfıra düşen etiket de (tetikleyici). */
function randevuyuSil(id: number) {
  silinenRandevular.add(id)
  delete baglar[id]
  for (const tid of [...etiketDeposu.keys()]) if (kullanim(tid) === 0) etiketDeposu.delete(tid)
}

/** Kurulum kolaylığı: seansa adıyla etiket bağlar, etiketin kimliğini döner. */
function etiketBagla(randevuId: number, ad: string): number {
  let id = [...etiketDeposu].find(([, a]) => etiketAnahtari(a) === etiketAnahtari(ad))?.[0]
  if (id === undefined) {
    id = idYenidenKullan ? Math.max(0, ...etiketDeposu.keys()) + 1 : sonrakiEtiketId++
    etiketDeposu.set(id, ad)
  }
  baglar[randevuId] = [...new Set([...(baglar[randevuId] ?? []), id])]
  return id
}

function kullanim(tagId: number): number {
  return Object.values(baglar).filter((l) => l.includes(tagId)).length
}

function etiketSatiri(tagId: number) {
  return { id: tagId, ad: etiketDeposu.get(tagId)!, kullanim: kullanim(tagId) }
}

function seansinEtiketleri(randevuId: number) {
  return (baglar[randevuId] ?? [])
    .map(etiketSatiri)
    .sort((a, b) => etiketSirasi(a.ad, b.ad))
}

function kapi() {
  let ac!: () => void
  const bekle = new Promise<void>((c) => {
    ac = c
  })
  return { bekle, ac }
}

function json(govde: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => govde } as unknown as Response
}

function randevuAnlik(r: RandevuKaydi) {
  return { ...r, odendi: odemeler[r.id] ?? r.odendi, durum: durumlar[r.id] ?? r.durum }
}

function notYaniti(id: number) {
  const r = tumu().find((x) => x.id === id)!
  const k = notlar[id] ?? { sablon: 'serbest', icerik: '' }
  return {
    appointment_id: id, client_id: r.client_id, seans_zamani: r.baslangic,
    ...k, guncelleme_zamani: '2026-09-09T09:00:00Z',
  }
}

/** Sunucunun o anki hâline göre bir yanıt üretir (ANLIK GÖRÜNTÜ). */
function yanitUret(method: string, yol: string, govde: unknown): Response {
  if (yetkisiz) return json({ hata: 'Oturum kilitli.' }, 401)
  if (yol === '/api/etiketler') {
    return json(
      [...etiketDeposu.keys()]
        .map(etiketSatiri)
        .sort((a, b) => b.kullanim - a.kullanim || etiketSirasi(a.ad, b.ad)),
    )
  }
  const etiketliSeanslar = /^\/api\/etiketler\/(\d+)\/seanslar$/.exec(yol)
  if (etiketliSeanslar) {
    const tid = Number(etiketliSeanslar[1])
    // Sunucudaki `tags::etiketli_seanslar`: olmayan etiket 404.
    if (!etiketDeposu.has(tid)) return json({ hata: 'Kayıt bulunamadı.' }, 404)
    return json(
      tumu().filter((r) => (baglar[r.id] ?? []).includes(tid))
        .sort((a, b) => (a.baslangic < b.baslangic ? 1 : -1))
        .map((r) => ({
          appointment_id: r.id, client_id: r.client_id,
          danisan_adi: r.danisan_adi, baslangic: r.baslangic,
        })),
    )
  }
  const kaldir = /^\/api\/randevular\/(\d+)\/etiketler\/(\d+)$/.exec(yol)
  if (kaldir && method === 'DELETE') {
    const rid = Number(kaldir[1])
    const tid = Number(kaldir[2])
    if (!(baglar[rid] ?? []).includes(tid)) return json({ hata: 'Kayıt bulunamadı.' }, 404)
    baglar[rid] = baglar[rid].filter((t) => t !== tid)
    // Sunucudaki tetikleyici: kullanımı sıfıra düşen etiket sözlükten gider.
    if (kullanim(tid) === 0) etiketDeposu.delete(tid)
    return json({}, 204)
  }
  const seansEtiketi = /^\/api\/randevular\/(\d+)\/etiketler$/.exec(yol)
  if (seansEtiketi) {
    const rid = Number(seansEtiketi[1])
    if (method === 'POST') {
      if (etiketEklemeHatasi) return json({ hata: 'Veritabanı okunamadı.' }, 500)
      const ad = etiketAdiNormallestir((govde as { ad: string }).ad)
      const uzunluk = [...ad].length
      if (uzunluk < 1 || uzunluk > 40) {
        return json({ hata: `etiket adi 1-40 karakter olmali (verilen: ${uzunluk})` }, 400)
      }
      return json(etiketSatiri(etiketBagla(rid, ad)), 201)
    }
    return json(seansinEtiketleri(rid))
  }
  if (yol.startsWith('/api/saklama-suresi-dolanlar')) return json([])
  if (yol.startsWith('/api/depolama-durumu')) {
    return json({ toplam_boyut: 0, esik: 500 * 1024 * 1024, uyari: false })
  }
  if (yol.startsWith('/api/yedekler')) {
    return json({ hedef_dizin: '/Volumes/YEDEK', yedekler: [{ dosya_adi: 'y.db', tarih: '2026-09-09', boyut: 1 }] })
  }
  if (yol.startsWith('/api/cakisma')) {
    return json({ cakisanlar: [], cakisan_hafta_sayisi: 0, kontrol_edilen_hafta: 1 })
  }
  if (yol.startsWith('/api/ay-ozeti')) {
    // Görev 2: 202 silinmişse ya da ücreti değişmişse özet bunu YANSITMALI
    // (`tumu()` silinenleri zaten çıkarıyor, `randevuAnlik` durum/ödeme
    // yamalarını uyguluyor — aynı anlık görüntü randevu penceresinin
    // kullandığıyla). Sabit `45000` eskiden hem varlığı hem tutarı
    // görmezden geliyordu; testin "silme -> bekleyen güncellenir" ve
    // "ücret güncelleme -> özet YENİ değeri gösterir" senaryoları bu yüzden
    // sunucuyu GERÇEKTEN sorguluyor olmalı.
    const kayit202 = tumu().find((r) => r.id === 202)
    const anlik202 = kayit202 ? randevuAnlik(kayit202) : null
    const borclu = anlik202 !== null && anlik202.durum === 'geldi' && !anlik202.odendi
    const ucret = anlik202?.ucret ?? 0
    return json({
      ay: '2026-09', seans_sayisi: 3, tahsilat_kurus: 0,
      bekleyen_kurus: borclu ? ucret : 0,
      borclular: borclu
        ? [{ client_id: 1, ad_soyad: 'Ayşe Yılmaz', borc_kurus: ucret, seans_sayisi: 1 }]
        : [],
    })
  }
  const not = /^\/api\/randevular\/(\d+)\/not$/.exec(yol)
  if (not) {
    const id = Number(not[1])
    if (method === 'PUT') notlar[id] = govde as NotKaydi
    return json(notYaniti(id))
  }
  const odeme = /^\/api\/randevular\/(\d+)\/odeme$/.exec(yol)
  if (odeme && method === 'PATCH') {
    odemeler[Number(odeme[1])] = (govde as { odendi: boolean }).odendi
    return json({}, 204)
  }
  const seri = /^\/api\/randevular\/seri\/([^?]+)\?bu_tarihten_itibaren=(.+)$/.exec(yol)
  if (seri) {
    const seriId = decodeURIComponent(seri[1])
    const itibaren = decodeURIComponent(seri[2])
    const kapsam = tumu().filter((r) => r.seri_id === seriId && r.baslangic >= itibaren)
    if (method === 'DELETE') {
      for (const r of kapsam) randevuyuSil(r.id)
      return json({ silinen: kapsam.length })
    }
    return json({ adet: kapsam.length, not_adedi: 0 })
  }
  if (/^\/api\/randevular\/\d+\/silinecekler$/.test(yol)) return json({ not_adedi: 0 })
  const durum = /^\/api\/randevular\/(\d+)$/.exec(yol)
  if (durum && method === 'PUT') {
    const id = Number(durum[1])
    const g = govde as { client_id: number; baslangic: string; bitis: string; ucret: number | null }
    randevuDegisiklikleri[id] = {
      ...randevuDegisiklikleri[id],
      client_id: g.client_id,
      danisan_adi: danisanlar.find((d) => d.id === g.client_id)!.ad_soyad,
      baslangic: putBaslangici[id] ?? g.baslangic,
      bitis: g.bitis,
      ucret: g.ucret,
    }
    return json(randevuAnlik(tumu().find((r) => r.id === id)!))
  }
  if (durum && method === 'DELETE') {
    randevuyuSil(Number(durum[1]))
    return json({})
  }
  if (durum && method === 'PATCH') {
    durumlar[Number(durum[1])] = (govde as { durum: string }).durum
    return json({})
  }
  if (yol === '/api/randevular' && method === 'POST') {
    const g = govde as { client_id: number; baslangic: string; bitis: string; ucret: number | null }
    const yeni: RandevuKaydi = {
      id: sonrakiId++, client_id: g.client_id,
      danisan_adi: danisanlar.find((d) => d.id === g.client_id)!.ad_soyad,
      baslangic: g.baslangic, bitis: g.bitis, durum: 'planlandi', ucret: g.ucret,
      odendi: false, seri_id: null,
    }
    eklenenler.push(yeni)
    return json([yeni])
  }
  const aralik = /^\/api\/randevular\?baslangic=([^&]+)&bitis=([^&]+)/.exec(yol)
  if (aralik) {
    const bas = decodeURIComponent(aralik[1])
    const bit = decodeURIComponent(aralik[2])
    return json(tumu().filter((r) => r.baslangic >= bas && r.baslangic < bit).map(randevuAnlik))
  }
  const gecmis = /^\/api\/danisanlar\/(\d+)\/notlar/.exec(yol)
  if (gecmis) {
    const once = new URL(yol, 'http://x').searchParams.get('once') ?? '9999'
    return json(
      tumu().filter((r) => r.client_id === Number(gecmis[1]) && notlar[r.id] && r.baslangic < once)
        .sort((a, b) => (a.baslangic < b.baslangic ? 1 : -1))
        .map((r) => notYaniti(r.id)),
    )
  }
  const seanslar = /^\/api\/danisanlar\/(\d+)\/seanslar$/.exec(yol)
  if (seanslar) {
    if (seanslarHatasi) return json({ hata: 'Veritabanı okunamadı.' }, 500)
    return json(
      tumu().filter((r) => r.client_id === Number(seanslar[1]))
        .sort((a, b) => (a.baslangic < b.baslangic ? 1 : -1))
        .map((r) => {
          const a = randevuAnlik(r)
          return {
            appointment_id: a.id, baslangic: a.baslangic, durum: a.durum,
            ucret_kurus: a.ucret, odendi: a.odendi,
            not_ilk_satiri: notlar[a.id] ? notOnizlemesi(notlar[a.id].icerik) : null,
            etiketler: seansinEtiketleri(a.id).map((e) => e.ad),
          }
        }),
    )
  }
  if (/^\/api\/danisanlar\/\d+\/ekler$/.test(yol)) return json([])
  const dosya = /^\/api\/danisanlar\/(\d+)$/.exec(yol)
  if (dosya) return json(dosyalar[Number(dosya[1])])
  if (yol.startsWith('/api/danisanlar')) return json(danisanlar)
  throw new Error(`beklenmeyen istek: ${method} ${yol}`)
}

const gercekFetch = globalThis.fetch
let kilitle: ReturnType<typeof vi.fn<() => void>>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(BUGUN_SAATI)
  eklenenler = []
  sonrakiId = 300
  notlar = {}
  odemeler = {}
  durumlar = {}
  istekler = []
  onceBekle = {}
  sonraBekle = {}
  cagriSayaci = {}
  seanslarHatasi = false
  etiketDeposu = new Map()
  baglar = {}
  sonrakiEtiketId = 1
  yetkisiz = false
  idYenidenKullan = false
  etiketEklemeHatasi = false
  randevuDegisiklikleri = {}
  silinenRandevular = new Set()
  putBaslangici = {}
  kilitle = vi.fn<() => void>()
  taslaklariUnut()
  globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL, secenekler?: RequestInit) => {
    const yol = typeof girdi === 'string' ? girdi : girdi.toString()
    const method = secenekler?.method ?? 'GET'
    const govde = secenekler?.body ? JSON.parse(String(secenekler.body)) : null
    istekler.push({ method, yol, govde })
    const anahtar = `${method} ${yol}`
    cagriSayaci[anahtar] = (cagriSayaci[anahtar] ?? 0) + 1
    const siraliAnahtar = `${anahtar}#${cagriSayaci[anahtar]}`
    const once = onceBekle[siraliAnahtar] ?? onceBekle[anahtar]
    if (once) await once
    const yanit = yanitUret(method, yol, govde)
    const sonra = sonraBekle[siraliAnahtar] ?? sonraBekle[anahtar]
    if (sonra) await sonra
    return yanit
  }) as unknown as typeof fetch
})

afterEach(() => {
  vi.useRealTimers()
  globalThis.fetch = gercekFetch
  vi.restoreAllMocks()
  taslaklariUnut()
})

// --- yardımcılar -------------------------------------------------------------

const editor = () => screen.getByLabelText('Seans notu') as HTMLTextAreaElement
const odendiKutusu = () => screen.getByRole('checkbox', { name: 'Ödendi' }) as HTMLInputElement
const putlar = (id: number) =>
  istekler.filter((i) => i.method === 'PUT' && i.yol === `/api/randevular/${id}/not`)
const notGetleri = (id: number) =>
  istekler.filter((i) => i.method === 'GET' && i.yol === `/api/randevular/${id}/not`)

function ciz() {
  render(<AnaEkran kilitle={kilitle} onGeriYukle={vi.fn()} />)
}

/** Takvimde sonraki haftaya gider ve 202'nin seans panelini açar. */
async function takvimde202Ac() {
  await userEvent.click(await screen.findByRole('button', { name: 'Sonraki hafta' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
  await screen.findByLabelText('Seans notu')
}

/** Seans panelinin başlığındaki "… dosyasını aç" (takvimden dosyaya giden yol). */
async function paneldenDosyayaGit() {
  await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: 'Danışanlar' }).getAttribute('aria-selected')).toBe('true'),
  )
}

/** Danışanlar sekmesinde Ayşe'nin çipine tıklar; liste gelene kadar bekler. */
async function danisanlarda(ad = 'Ayşe Yılmaz') {
  await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
  await userEvent.click(await screen.findByRole('button', { name: `${ad} dosyasını aç` }))
  await waitFor(() =>
    expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet'),
  )
}

async function takvimeDon() {
  await userEvent.click(screen.getByRole('tab', { name: 'Takvim' }))
}

/** Otomatik kaydın "sunucuya yazıldı" göstergesi (2 sn gecikme, gerçek saat). */
async function kaydedildiBekle() {
  await waitFor(() =>
    expect(
      screen.getAllByRole('status').some((e) => /^Kaydedildi \d{2}:\d{2}$/.test(e.textContent ?? '')),
    ).toBe(true),
  )
}

/** Dosya listesindeki seans satırı (erişilebilir ad tarih metnini içerir). */
function listeSatiri(tarihMetni: string) {
  return within(screen.getByTestId('seans-listesi')).getByText(tarihMetni).closest('button') as HTMLElement
}

function bakiye() {
  return screen.getAllByRole('term').find((e) => e.textContent === 'Bakiye')?.nextElementSibling
    ?.textContent
}

// =============================================================================

describe('C1 — resmî not iki ekranda TEK yazma yolundan', () => {
  // İncelemecinin testle ÜRETTİĞİ senaryo, birebir.
  it('takvimde yükle -> dosyaya git -> yaz -> kaydet -> takvime dön: editör YENİ metni gösterir, ESKİ metin hiç PUT edilmez', async () => {
    notlar[202] = { sablon: 'serbest', icerik: 'ESKI' }
    ciz()
    await takvimde202Ac()
    expect(editor().value).toBe('ESKI')

    await paneldenDosyayaGit()
    // Takvimden gelindi: dosya O seansla açılır (I3).
    await waitFor(() => expect(editor().value).toBe('ESKI'))
    await userEvent.type(editor(), ' YENI')
    await kaydedildiBekle()
    expect(notlar[202].icerik).toBe('ESKI YENI')
    const oncekiPutSayisi = putlar(202).length

    await takvimeDon()
    // Seans paneli hâlâ 202'de; editör sunucudaki (dosyada yazılan) metni
    // gösteriyor — eskiden "ESKI" gösteriyordu.
    await waitFor(() => expect(editor().value).toBe('ESKI YENI'))

    // Terapist takvimde bir karakter yazar: otomatik kayıt YENİ metnin
    // üstüne gider, dosyada yazılanı SİLMEZ.
    await userEvent.type(editor(), '!')
    await waitFor(() => expect(putlar(202).length).toBe(oncekiPutSayisi + 1))
    const donustenSonra = putlar(202).slice(oncekiPutSayisi)
    for (const p of donustenSonra) {
      expect((p.govde as NotKaydi).icerik).toContain('ESKI YENI')
    }
    await waitFor(() => expect(notlar[202].icerik).toBe('ESKI YENI!'))
  })

  it('takvimde not yazılınca dosya listesindeki önizleme YENİ metni gösterir, dosya editörü de (yeniden çekmeden)', async () => {
    notlar[202] = { sablon: 'serbest', icerik: 'ESKI' }
    ciz()
    // Dosya önce açılır, 202 seçilir (önbelleğe ESKİ girer), sonra takvime
    // gidilip yazılır.
    await danisanlarda()
    await userEvent.click(listeSatiri('14 Eylül 2026, 10:00'))
    await waitFor(() => expect(editor().value).toBe('ESKI'))

    await takvimeDon()
    await takvimde202Ac()
    // Sayım takvim panelinin KENDİ not GET'inden SONRA alınıyor: ölçülen,
    // dosyanın dönüşte yeniden çekip çekmediği.
    const getSayisi = notGetleri(202).length
    await userEvent.type(editor(), ' TAKVIMDEN')
    await kaydedildiBekle()

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await waitFor(() => expect(editor().value).toBe('ESKI TAKVIMDEN'))
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('ESKI TAKVIMDEN')
    // Dosyanın not önbelleği YAYILIMLA tazelendi, yeniden ÇEKİLMEDİ (M1).
    expect(notGetleri(202).length).toBe(getSayisi)
  })

  // Ters yarış (inceleme yalnızca kod okumasıyla çıkarmıştı; burada ÜRETİLİYOR):
  // takvim editörü bekleyen metni unmount'ta PUT eder, dosya aynı nota AYNI
  // ANDA GET atar. PUT sunucuda GECİKİRSE GET eski metni okur. Üç savunma:
  //   - iki editör AYNI taslak anahtarını (`not-<id>`) kullanıyor: gelen
  //     editör uçuştaki metni taslaktan alır (eski metni DEĞİL);
  //   - taslak "uçuşta" işaretli: bu bir kilit kurtarması değil, "oturum
  //     kilitlendi" şeridi GÖSTERİLMEZ;
  //   - PUT bitince yayılım `sunucuHali`yi günceller, editör metni zaten
  //     gösterdiği için yalnızca "kaydedildi" sayar — aynı metin İKİNCİ kez
  //     PUT edilmez (silinemez denetim satırı).
  const KILIT_SERIDI = /Kaydedilmemiş not içeriğiniz geri yüklendi/

  it('ters yarış A: takvim tahliyesi GECİKİRKEN açılan dosya editörü ESKİ metni DEĞİL, yoldaki metni gösterir; şerit yok, çift PUT yok', async () => {
    notlar[202] = { sablon: 'serbest', icerik: 'ESKI' }
    ciz()
    await takvimde202Ac()
    const k = kapi()
    onceBekle['PUT /api/randevular/202/not'] = k.bekle
    await userEvent.type(editor(), ' T') // 2 sn dolmadan
    await paneldenDosyayaGit()
    // BARİYER: dosyanın GET'i sunucuya ulaştı ve PUT'tan ÖNCE işlendi
    // (sunucu hâlâ ESKİ).
    await waitFor(() => expect(notGetleri(202).length).toBeGreaterThan(0))
    expect(notlar[202].icerik).toBe('ESKI')
    await waitFor(() => expect(editor().value).toBe('ESKI T'))
    expect(document.body.textContent).not.toMatch(KILIT_SERIDI)

    k.ac()
    await waitFor(() => expect(notlar[202].icerik).toBe('ESKI T'))
    // Dosya editörünün 2 sn'lik zamanlayıcısı dolsun: aynı metin ikinci kez
    // YAZILMAMALI.
    await new Promise((r) => setTimeout(r, 2300))
    expect(putlar(202)).toHaveLength(1)
    expect(editor().value).toBe('ESKI T')
  }, 15_000)

  it('ters yarış B: GET eski metni OKUYUP geç dönerse (PUT ondan önce biter) dosya editörü YİNE yeni metni gösterir', async () => {
    notlar[202] = { sablon: 'serbest', icerik: 'ESKI' }
    ciz()
    await takvimde202Ac()
    const kPut = kapi()
    const kGet = kapi()
    onceBekle['PUT /api/randevular/202/not'] = kPut.bekle
    sonraBekle['GET /api/randevular/202/not'] = kGet.bekle
    await userEvent.type(editor(), ' T')
    await paneldenDosyayaGit()
    // BARİYER: GET sunucuda ESKİ metni okudu (anlık görüntü alındı), yanıt yolda.
    await waitFor(() => expect(notGetleri(202).length).toBeGreaterThan(0))
    expect(notlar[202].icerik).toBe('ESKI')

    // PUT şimdi işlenir ve GET'ten ÖNCE yanıtlanır.
    kPut.ac()
    await waitFor(() => expect(notlar[202].icerik).toBe('ESKI T'))
    await new Promise((r) => setTimeout(r, 30))
    kGet.ac()
    await waitFor(() => expect(editor().value).toBe('ESKI T'))
  })

  it('ters yarış C: dosya editörünün tahliyesi GECİKİRKEN takvime dönülürse takvim editörü yoldaki metni gösterir; sonraki tuş onun üstüne yazar', async () => {
    notlar[202] = { sablon: 'serbest', icerik: 'ESKI' }
    ciz()
    await takvimde202Ac()
    await paneldenDosyayaGit()
    await waitFor(() => expect(editor().value).toBe('ESKI'))
    const k = kapi()
    onceBekle['PUT /api/randevular/202/not'] = k.bekle
    await userEvent.type(editor(), ' D') // 2 sn dolmadan
    await takvimeDon()
    // Takvim paneli önbellekte ESKİ notu tutuyor; editör yoldaki metinle açılır.
    await waitFor(() => expect(editor().value).toBe('ESKI D'))
    expect(document.body.textContent).not.toMatch(KILIT_SERIDI)

    k.ac()
    await waitFor(() => expect(notlar[202].icerik).toBe('ESKI D'))
    const once = putlar(202).length
    await userEvent.type(editor(), '!')
    await waitFor(() => expect(putlar(202).length).toBe(once + 1))
    expect((putlar(202)[once].govde as NotKaydi).icerik).toBe('ESKI D!')
  })
  // `useSeansNotlari` `yazmaSaati`nin dördüncü kullanıcısı: takvim panelinin not
  // okuması ESKİ metni okuyup geç dönerken dosyanın tahliyesi biterse takvim
  // editörü eski metinle açılmamalı (taslak o sırada temizlenmiş olur —
  // tek savunma saat).
  it('ters yarış D: takvim panelinin not GET\'i eski metni okuyup geç dönerken dosya tahliyesi biterse takvim YENİ metni gösterir', async () => {
    notlar[202] = { sablon: 'serbest', icerik: 'ESKI' }
    ciz()
    await danisanlarda()
    await userEvent.click(listeSatiri('14 Eylül 2026, 10:00'))
    await waitFor(() => expect(editor().value).toBe('ESKI'))
    const kPut = kapi()
    const kGet = kapi()
    onceBekle['PUT /api/randevular/202/not'] = kPut.bekle
    sonraBekle['GET /api/randevular/202/not'] = kGet.bekle
    await userEvent.type(editor(), ' D')
    await takvimeDon()
    await userEvent.click(await screen.findByRole('button', { name: 'Sonraki hafta' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
    // BARİYER: takvimin GET'i sunucuda ESKİ metni okudu, yanıt yolda.
    await waitFor(() => expect(notGetleri(202).length).toBe(2))
    expect(notlar[202].icerik).toBe('ESKI')

    kPut.ac()
    await waitFor(() => expect(notlar[202].icerik).toBe('ESKI D'))
    await new Promise((r) => setTimeout(r, 30))
    kGet.ac()
    await waitFor(() => expect(editor().value).toBe('ESKI D'))
  })

  it('dosyada ESKİ bir seansın notu düzeltilince takvim panelinin "Önceki seans notları" kopyası da tazelenir', async () => {
    notlar[201] = { sablon: 'serbest', icerik: 'ilk hali' }
    ciz()
    await takvimde202Ac()
    await paneldenDosyayaGit()
    await userEvent.click(listeSatiri('7 Eylül 2026, 10:00'))
    await waitFor(() => expect(editor().value).toBe('ilk hali'))
    await userEvent.type(editor(), ' duzeltildi')
    await kaydedildiBekle()

    await takvimeDon()
    const gecmis = await screen.findByRole('region', { name: 'Önceki seans notları' })
    await userEvent.click(within(gecmis).getByRole('button', { name: /7 Eylül 2026, 10:00/ }))
    expect(gecmis.textContent).toContain('ilk hali duzeltildi')
  })
})

describe('C2 — durum/ödeme yazmaları iki ekranda TEK yoldan', () => {
  async function dosyada202Sec() {
    await danisanlarda()
    await userEvent.click(listeSatiri('14 Eylül 2026, 10:00'))
    await screen.findByLabelText('Seans notu')
  }

  it('dosyada "Ödendi" işaretlenince AYNI dosyanın Bilgiler bakiyesi 0,00 TL olur', async () => {
    ciz()
    await danisanlarda()
    await userEvent.click(screen.getByRole('tab', { name: 'Bilgiler' }))
    await waitFor(() => expect(bakiye()).toBe('450,00 TL'))
    await userEvent.click(screen.getByRole('tab', { name: 'Seanslar' }))
    await userEvent.click(listeSatiri('14 Eylül 2026, 10:00'))
    await userEvent.click(odendiKutusu())
    await waitFor(() => expect(odemeler[202]).toBe(true))
    await waitFor(() => expect(odendiKutusu().disabled).toBe(false))

    await userEvent.click(screen.getByRole('tab', { name: 'Bilgiler' }))
    expect(bakiye()).toBe('0,00 TL')
  })

  it('dosyada "Ödendi" işaretlenip Takvim -> Danışanlar gidip gelince kutu İŞARETLİ, listede "· Ödendi" VAR', async () => {
    ciz()
    await dosyada202Sec()
    await userEvent.click(odendiKutusu())
    await waitFor(() => expect(odemeler[202]).toBe(true))
    await waitFor(() => expect(odendiKutusu().disabled).toBe(false))

    await takvimeDon()
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await screen.findByLabelText('Seans notu')
    expect(odendiKutusu().checked).toBe(true)
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('· Ödendi')
  })

  it('dosyada "Ödendi" işaretlenince takvimde AYNI seans açılınca kutu İŞARETLİ', async () => {
    ciz()
    // Takvim önce 202'nin haftasını yükler (liste önbelleğe ÖDENMEMİŞ girer).
    await takvimde202Ac()
    expect(odendiKutusu().checked).toBe(false)
    await paneldenDosyayaGit()
    await screen.findByLabelText('Seans notu')
    await userEvent.click(odendiKutusu())
    await waitFor(() => expect(odemeler[202]).toBe(true))
    await waitFor(() => expect(odendiKutusu().disabled).toBe(false))
    const takvimGetleri = istekler.filter((i) => i.yol.startsWith('/api/randevular?')).length

    await takvimeDon()
    await screen.findByLabelText('Seans notu')
    expect(odendiKutusu().checked).toBe(true)
    // Takvim YENİDEN ÇEKİLMEDİ: değer yayılımdan geliyor.
    expect(istekler.filter((i) => i.yol.startsWith('/api/randevular?')).length).toBe(takvimGetleri)
  })

  it('ters yön: takvimde not yazılınca dosya listesinde "Not yazılmamış" DEĞİL, notun ilk satırı görünür', async () => {
    ciz()
    // Dosya listesi ÖNCE yüklenir (202'nin notu yok).
    await danisanlarda()
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('Not yazılmamış')

    await takvimeDon()
    await takvimde202Ac()
    await userEvent.type(editor(), 'Uyku düzeni iyileşmiş')
    await kaydedildiBekle()

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    const satir = listeSatiri('14 Eylül 2026, 10:00')
    expect(satir.textContent).not.toContain('Not yazılmamış')
    expect(satir.textContent).toContain('Uyku düzeni iyileşmiş')
  })

  it('ters yön: takvimde "Gelmedi" işaretlenince dosya listesindeki durum da "Gelmedi"', async () => {
    ciz()
    await danisanlarda()
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('Geldi')
    await takvimeDon()
    await takvimde202Ac()
    await userEvent.click(screen.getByRole('button', { name: 'Gelmedi' }))
    await waitFor(() => expect(durumlar[202]).toBe('gelmedi'))
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('Gelmedi')
  })

  // Bu projede ay özeti ile kartın farklı borç göstermesi daha önce gerçek
  // bir hataydı (dal incelemesi I1). Dosyadan yapılan ödeme de `AnaEkran.
  // odemeDegis`ten geçtiği için özetin tazeleme sayacını artırır — ama özet
  // `TakvimSekmesi`nin içinde ve dosya görünürken monte DEĞİL, dolayısıyla
  // sayacın kendisi bu an gözlemlenemez: özet açıldığında zaten TEK taze
  // istek atar. Ölçülen, kullanıcının gördüğü: dosyadan ödeme → kart bakiyesi
  // 0 → takvimde açılan özet de Ayşe'yi borçlu GÖSTERMEZ; iki ekran AYNI
  // borcu söylüyor.
  it('dosyadan ödeme: kart bakiyesi ve sonra açılan ay özeti AYNI borcu gösterir', async () => {
    ciz()
    await dosyada202Sec()
    await userEvent.click(odendiKutusu())
    await waitFor(() => expect(odemeler[202]).toBe(true))
    await waitFor(() => expect(odendiKutusu().disabled).toBe(false))
    await userEvent.click(screen.getByRole('tab', { name: 'Bilgiler' }))
    expect(bakiye()).toBe('0,00 TL')

    await takvimeDon()
    await userEvent.click(screen.getByRole('button', { name: 'Ay sonu özeti' }))
    const bolge = await screen.findByRole('region', { name: 'Ay sonu özeti' })
    await waitFor(() =>
      expect(
        within(bolge).getAllByRole('term').find((e) => e.textContent === 'Bekleyen')
          ?.nextElementSibling?.textContent,
      ).toBe('0,00 TL'),
    )
    expect(within(bolge).queryByRole('button', { name: /Ayşe Yılmaz/ })).toBeNull()
  })

  // `useDanisanSeanslari` `yazmaSaati`nin üçüncü kullanıcısı: liste okuması
  // yazmadan ÖNCE başlayıp SONRA dönerse (sunucu okumayı eski değerle yaptı)
  // yama kaybolmamalı.
  it('liste okuması uçuştayken takvimde ödenen seans, geç dönen listede ESKİ değere dönmez', async () => {
    ciz()
    await takvimde202Ac()
    const k = kapi()
    sonraBekle['GET /api/danisanlar/1/seanslar'] = k.bekle
    await paneldenDosyayaGit()
    // BARİYER: listenin okuması yola çıktı (anlık görüntü: ödenmemiş).
    await waitFor(() =>
      expect(istekler.some((i) => i.yol === '/api/danisanlar/1/seanslar')).toBe(true),
    )
    await takvimeDon()
    await screen.findByLabelText('Seans notu')
    await userEvent.click(odendiKutusu())
    await waitFor(() => expect(odemeler[202]).toBe(true))
    await waitFor(() => expect(odendiKutusu().disabled).toBe(false))

    k.ac()
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await waitFor(() =>
      expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet'),
    )
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('· Ödendi')
  })
})

describe('Bayatlık — takvimin yamanamayan yazmaları dosyanın seans listesine yayılır', () => {
  const listeGetleri = () =>
    istekler.filter((i) => i.method === 'GET' && i.yol === '/api/danisanlar/1/seanslar').length
  const listeMetni = () => screen.getByTestId('seans-listesi').textContent ?? ''
  const listeYuklendi = () =>
    waitFor(() =>
      expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet'),
    )

  // İncelemecinin testle ÜRETTİĞİ senaryo, birebir. Eskiden liste yalnızca
  // 14 ve 7 Eylül'ü içeriyordu; gelinen seans listede olmadığı için seçim
  // varsayılana (7 Eylül) düşüyor, terapist BAŞKA seansın editörünü görüyordu.
  it('dosya açıkken takvimde yeni randevu -> panelden "dosyasını aç": O seans seçili, editör onun notunu gösterir', async () => {
    notlar[201] = { sablon: 'serbest', icerik: 'GECMIS SEANS NOTU' }
    ciz()
    await danisanlarda()
    // İşlem ÖNCESİ durum (6. biçim): varsayılan 7 Eylül seçili, 21 Eylül yok.
    await waitFor(() => expect(editor().value).toBe('GECMIS SEANS NOTU'))
    expect(listeMetni()).not.toContain('21 Eylül 2026')
    const oncekiGetler = listeGetleri()

    await takvimeDon()
    await userEvent.click(await screen.findByRole('button', { name: 'Sonraki hafta' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))
    const bosSaat = (await screen.findAllByLabelText(/boş$/)).find(
      (el) => el.getAttribute('aria-label') === '21 Eylül 10:00 boş',
    )
    await userEvent.click(bosSaat!)
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(tumu().some((r) => r.id === 300)).toBe(true))
    notlar[300] = { sablon: 'serbest', icerik: 'BUGUNKU SEANS NOTU' }

    // Görünmeyen sekmeden liste isteği YOK (silinemez görüntüleme kaydı).
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
    await screen.findByLabelText('Seans notu')
    expect(listeGetleri()).toBe(oncekiGetler)

    await paneldenDosyayaGit()
    await listeYuklendi()
    const aktif = within(screen.getByTestId('seans-listesi')).getByRole('button', { current: true })
    expect(aktif.textContent).toContain('21 Eylül 2026, 10:00')
    await waitFor(() => expect(editor().value).toBe('BUGUNKU SEANS NOTU'))
    // Görünür olunca TEK yeniden çekme.
    expect(listeGetleri()).toBe(oncekiGetler + 1)
  })

  it('takvimde başka danışana taşınan randevu eski danışanın dosyasından kalkar', async () => {
    ciz()
    await danisanlarda()
    // İşlem ÖNCESİ durum: 14 Eylül Ayşe'nin listesinde.
    expect(listeMetni()).toContain('14 Eylül 2026, 10:00')

    await takvimeDon()
    await takvimde202Ac()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Güncelle' }))
    await waitFor(() => expect(tumu().find((r) => r.id === 202)!.client_id).toBe(2))

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await listeYuklendi()
    // Pozitif bariyer: liste gerçekten geldi (boş "yükleniyor" hâli değil).
    expect(listeMetni()).toContain('7 Eylül 2026, 10:00')
    expect(listeMetni()).not.toContain('14 Eylül 2026')
  })

  // Yukarıdaki senaryoda `seansSec`in ikinci savunması da listeyi tazeler;
  // bu test oluşturma BİLDİRİMİNİ tek başına ölçer (seans seçilmeden,
  // sekmeyle dönülüyor).
  it('takvimde oluşturulan randevu, sekmeyle dönülünce açık dosyanın listesinde görünür', async () => {
    ciz()
    await danisanlarda()
    expect(listeMetni()).not.toContain('21 Eylül 2026')

    await takvimeDon()
    await userEvent.click(await screen.findByRole('button', { name: 'Sonraki hafta' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))
    const bosSaat = (await screen.findAllByLabelText(/boş$/)).find(
      (el) => el.getAttribute('aria-label') === '21 Eylül 10:00 boş',
    )
    await userEvent.click(bosSaat!)
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(tumu().some((r) => r.id === 300)).toBe(true))

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await listeYuklendi()
    expect(listeMetni()).toContain('21 Eylül 2026, 10:00')
  })

  it('takvimde seri iptali ("bu ve sonrakiler") açık dosyanın listesinden o seansları kaldırır, geçmiş kalır', async () => {
    randevuDegisiklikleri[202] = { seri_id: 'seri-1' }
    eklenenler.push({
      ...R202, id: 204, baslangic: '2026-09-21T10:00', bitis: '2026-09-21T11:00',
      durum: 'planlandi', seri_id: 'seri-1',
    })
    ciz()
    await danisanlarda()
    expect(listeMetni()).toContain('14 Eylül 2026, 10:00')
    expect(listeMetni()).toContain('21 Eylül 2026, 10:00')

    await takvimeDon()
    await takvimde202Ac()
    await userEvent.click(screen.getByRole('button', { name: 'Bu ve sonraki tüm tekrarları sil' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Evet, tekrarları sil' }))
    await waitFor(() => expect(tumu().some((r) => r.seri_id === 'seri-1')).toBe(false))

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await listeYuklendi()
    expect(listeMetni()).toContain('7 Eylül 2026, 10:00')
    expect(listeMetni()).not.toContain('14 Eylül 2026')
    expect(listeMetni()).not.toContain('21 Eylül 2026')
  })

  it('takvimde silinen randevu açık dosyanın listesinden kalkar', async () => {
    ciz()
    await danisanlarda()
    expect(listeMetni()).toContain('14 Eylül 2026, 10:00')

    await takvimeDon()
    await takvimde202Ac()
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Evet, sil' }))
    await waitFor(() => expect(tumu().some((r) => r.id === 202)).toBe(false))

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await listeYuklendi()
    expect(listeMetni()).toContain('7 Eylül 2026, 10:00')
    expect(listeMetni()).not.toContain('14 Eylül 2026')
  })
})

describe('Görev 2 — randevu yazmaları ay özetine ve kart bakiyesine yayılır', () => {
  const kartGetleri = () =>
    istekler.filter((i) => i.method === 'GET' && i.yol === '/api/danisanlar/1').length

  async function ayOzetiniAc() {
    await userEvent.click(screen.getByRole('button', { name: 'Ay sonu özeti' }))
    return screen.findByRole('region', { name: 'Ay sonu özeti' })
  }

  function bekleyenTutari(bolge: HTMLElement) {
    return within(bolge).getAllByRole('term').find((e) => e.textContent === 'Bekleyen')
      ?.nextElementSibling?.textContent
  }

  /** Takvimde açık 202 panelinin ücretini değiştirip "Güncelle"ye basar. */
  async function ucretiGuncelle(yeniTl: string) {
    await userEvent.clear(screen.getByLabelText('Ücret (TL)'))
    await userEvent.type(screen.getByLabelText('Ücret (TL)'), yeniTl)
    await userEvent.click(screen.getByRole('button', { name: 'Güncelle' }))
  }

  // İncelemecinin testle ÜRETTİĞİ senaryo (IMPORTANT-1), birebir: özet
  // açıkken çift girilmiş bir seans siliniyor, ekran ANINDA (yeniden
  // çekmeden değil, tek yeni `GET /api/ay-ozeti` ile) sunucuyla eşleşmeli.
  it('(a) özet AÇIKKEN randevu silme -> bekleyen tutar güncellenir', async () => {
    ciz()
    const bolge = await ayOzetiniAc()
    await waitFor(() => expect(bekleyenTutari(bolge)).toBe('450,00 TL'))

    await takvimde202Ac()
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Evet, sil' }))
    await waitFor(() => expect(tumu().some((r) => r.id === 202)).toBe(false))

    await waitFor(() => expect(bekleyenTutari(bolge)).toBe('0,00 TL'))
  })

  // İncelemecinin testle ÜRETTİĞİ senaryo (IMPORTANT-2), birebir: dosya
  // açıkken (Bilgiler'de 450,00 TL) takvimde ücret 450 -> 900 düzeltiliyor.
  // Danışanlar'a dönmek `dosya.ac(aynı id)`yi çağırır ve bu bir NO-OP'tur
  // (bkz. `AnaEkran.tsx::danisanaGit`), yani yayılım OLMAZSA bakiye asla
  // kendiliğinden düzelmez.
  it('(b) ücret güncelleme -> özet VE kart bakiyesi ikisi de YENİ değeri gösterir', async () => {
    ciz()
    await danisanlarda()
    await userEvent.click(screen.getByRole('tab', { name: 'Bilgiler' }))
    await waitFor(() => expect(bakiye()).toBe('450,00 TL'))

    await takvimeDon()
    await takvimde202Ac()
    await ucretiGuncelle('900')
    await waitFor(() => expect(tumu().find((r) => r.id === 202)!.ucret).toBe(90000))

    const bolge = await ayOzetiniAc()
    await waitFor(() => expect(bekleyenTutari(bolge)).toBe('900,00 TL'))

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Bilgiler' }))
    await waitFor(() => expect(bakiye()).toBe('900,00 TL'))
  })

  it('(c) aynı dosyada Seanslar listesindeki tutar ile Bilgiler bakiyesi ÇELİŞMEZ', async () => {
    ciz()
    await danisanlarda()

    await takvimeDon()
    await takvimde202Ac()
    await ucretiGuncelle('900')
    await waitFor(() => expect(tumu().find((r) => r.id === 202)!.ucret).toBe(90000))

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    // Seans listesi kendi bayatlık mekanizmasıyla (önceden var, bu görevin
    // parçası değil) yeniden çekilir ve sunucunun YENİ tutarını gösterir.
    await waitFor(() =>
      expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('900,00 TL'),
    )

    await userEvent.click(screen.getByRole('tab', { name: 'Bilgiler' }))
    expect(bakiye()).toBe('900,00 TL')
  })

  // En önemli kısıt: kart tazelemesi `clients::getir`i (HerCagri, silinemez
  // satır) TETİKLEMEMELİ. Üç yazma türünü de (ücret güncelleme, silme,
  // oluşturma) sırayla deniyor.
  it('(d) özet ve kart tazelemesi GET /api/danisanlar/{id} isteği ATMAZ (kart HerCagri)', async () => {
    ciz()
    await danisanlarda()
    const baslangic = kartGetleri()

    await takvimeDon()
    await takvimde202Ac()
    await ucretiGuncelle('900')
    await waitFor(() => expect(tumu().find((r) => r.id === 202)!.ucret).toBe(90000))
    expect(kartGetleri()).toBe(baslangic)

    // Silme: 201 (7 Eylül), 202 sonraki adımda gerekiyor.
    await userEvent.click(await screen.findByRole('button', { name: 'Önceki hafta' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Evet, sil' }))
    await waitFor(() => expect(tumu().some((r) => r.id === 201)).toBe(false))
    expect(kartGetleri()).toBe(baslangic)

    // Oluşturma.
    await userEvent.click(await screen.findByRole('button', { name: 'Sonraki hafta' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))
    const bosSaat = (await screen.findAllByLabelText(/boş$/)).find(
      (el) => el.getAttribute('aria-label') === '21 Eylül 10:00 boş',
    )
    await userEvent.click(bosSaat!)
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(tumu().some((r) => r.id === 300)).toBe(true))
    expect(kartGetleri()).toBe(baslangic)
  })

  // İncelemeci bulgusu (CRITICAL): kartın İLK yükleme okuması (mount
  // efekti) ile `randevularTazele` AYNI URL'e (randevu penceresi) gidiyor.
  // Kart açılır açılmaz (ilk okuma hâlâ uçuştayken) bir randevu silinirse
  // `randevularTazele` DAHA SONRA başlayıp DAHA ÖNCE dönebilir (kart o anda
  // doğru bakiyeyi gösterir) — ama mount'un GEÇ dönen, artık BAYAT yanıtı
  // damga korumasız bunun ÜSTÜNE eski listeyi yazardı ve bakiye KALICI
  // olarak eskiye dönerdi. `yazmaSaati`nin "daha önce başlayan bir okumanın
  // geç gelen yanıtı, daha sonra başlayıp önce dönmüş bir okumayı ezmez"
  // kuralı burada da geçerli olmalı (`useDanisanSeanslari.yanitiYaz` ile
  // aynı desen, bkz. `KartVerisi.randevularDamgasi`).
  it('CRITICAL: kart ilk yüklemesi UÇUŞTAYKEN randevularTazele daha SONRA başlayıp daha ÖNCE dönerse, geç gelen ilk yükleme bakiyeyi eskiye DÖNDÜRMEZ', async () => {
    ciz()
    const tumZamanYolu = `/api/randevular?baslangic=${encodeURIComponent('2000-01-01T00:00')}&bitis=${encodeURIComponent('2100-01-01T00:00')}`
    // Kartın İLK okuması (mount efekti — bu URL'e 1. çağrı): kapıda tutuluyor.
    const k1 = kapi()
    sonraBekle[`GET ${tumZamanYolu}#1`] = k1.bekle

    // `danisanlarda()` KULLANILMIYOR: o yardımcı Seanslar listesinin
    // yüklenmesini bekliyor, ama `DanisanDosyasi` (ve onun İÇİNDEKİ Seanslar
    // listesi) yalnızca `kart.dosya !== null` iken render ediliyor — kartın
    // mount Promise.all'ı (ve onunla birlikte bu gate) çözülmeden `kart.dosya`
    // asla dolmaz. Bariyer bu yüzden İSTEĞİN ATILMASI (yanıtın DÖNMESİ değil).
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    // BARİYER: kartın ilk okuması yola çıktı (anlık görüntü: 202 hâlâ var,
    // bekleyen 450 TL) — henüz DÖNMEDİ (`sonraBekle` onu tutuyor).
    await waitFor(() => expect(istekler.some((i) => i.yol === tumZamanYolu)).toBe(true))

    await takvimeDon()
    await takvimde202Ac()
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Evet, sil' }))
    await waitFor(() => expect(tumu().some((r) => r.id === 202)).toBe(false))
    // `randevularTazele`nin (bu URL'e 2. çağrı, KAPISIZ) isteği çoktan gitti
    // ve döndü — kart bu anda (gözlemlenmese de) ZATEN doğru bakiyeyi taşır.
    await waitFor(() => expect(istekler.filter((i) => i.yol === tumZamanYolu).length).toBe(2))

    // Şimdi GEÇ kalan ilk yüklemenin kapısı açılıyor — bu, sunucudan SİLME
    // ÖNCESİ alınmış BAYAT bir anlık görüntü taşıyor (202 hâlâ orada, 450 TL).
    await act(async () => {
      k1.ac()
      await new Promise((r) => setTimeout(r, 50))
    })

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Bilgiler' }))
    // Kapı AÇILDIKTAN SONRA da (yalnızca ilk doğru anı yakalayıp geçmek
    // değil) bakiye DOĞRU kalmalı — düzeltmeden ÖNCE burası sessizce
    // "450,00 TL"ye dönerdi ve bir daha kendiliğinden düzelmezdi.
    expect(bakiye()).toBe('0,00 TL')
    await new Promise((r) => setTimeout(r, 50))
    expect(bakiye()).toBe('0,00 TL')
  })

  // MINOR (inceleme): kart HİÇ açılmamışken bir randevu yazması, kart
  // tarafında hiçbir isteğe yol açmamalı — `randevularTazele`nin erken
  // çıkışı (`useDanisanDosyasi.ts`, `hedefDanisan === null`) bunu koruyor,
  // ama Görev 2'nin testlerinde AMAÇLI ölçülmüyordu (inceleme: o satırı
  // kaldıran mutasyon başka bir testin URL öneki çakışmasıyla TESADÜFEN
  // yakalanıyordu).
  it('(minor) kart KAPALIYKEN randevu yazması yapılınca randevu-penceresi isteği ATILMAZ', async () => {
    ciz()
    const tumZamanYolu = `/api/randevular?baslangic=${encodeURIComponent('2000-01-01T00:00')}&bitis=${encodeURIComponent('2100-01-01T00:00')}`
    // Sekme hiç Danışanlar'a geçmedi — kart hiç açılmadı.
    await takvimde202Ac()
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Evet, sil' }))
    await waitFor(() => expect(tumu().some((r) => r.id === 202)).toBe(false))

    expect(istekler.filter((i) => i.yol === tumZamanYolu).length).toBe(0)
  })
})

describe('I1 — Kilitle kabuğun üst satırında, her sekmede', () => {
  it.each([['Takvim'], ['Danışanlar'], ['Ayarlar']])(
    '%s sekmesindeyken Kilitle görünür ve kilitler',
    async (sekme) => {
      ciz()
      await userEvent.click(screen.getByRole('tab', { name: new RegExp(`^${sekme}`) }))
      expect(
        screen.getByRole('tab', { name: new RegExp(`^${sekme}`) }).getAttribute('aria-selected'),
      ).toBe('true')
      await userEvent.click(screen.getByRole('button', { name: 'Kilitle' }))
      expect(kilitle).toHaveBeenCalledTimes(1)
    },
  )

  it('Kilitle, danışan dosyası (risk notu dahil) açıkken de erişilebilir', async () => {
    ciz()
    await danisanlarda()
    await userEvent.click(screen.getByRole('tab', { name: 'Bilgiler' }))
    await userEvent.click(screen.getByRole('button', { name: 'Kilitle' }))
    expect(kilitle).toHaveBeenCalledTimes(1)
  })
})

describe('I2 — açık dosyanın kime ait olduğu Seanslar alt sekmesinde de görünür', () => {
  it('Seanslar alt sekmesinde danışanın adı başlıkta', async () => {
    ciz()
    await danisanlarda()
    expect(screen.getByRole('tab', { name: 'Seanslar' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Ayşe Yılmaz' })).toBeDefined()
    // Başka danışana geçince başlık da değişir.
    await userEvent.click(screen.getByRole('button', { name: 'Mehmet Demir dosyasını aç' }))
    expect(await screen.findByRole('heading', { name: 'Mehmet Demir' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Ayşe Yılmaz' })).toBeNull()
  })
})

describe('I3 — dosya açılınca varsayılan seçim', () => {
  it('listeden açılınca bugünden önceki en yeni seans (201) seçili, gelecekteki 202 DEĞİL', async () => {
    notlar[201] = { sablon: 'serbest', icerik: 'GECMIS SEANS NOTU' }
    notlar[202] = { sablon: 'serbest', icerik: 'GELECEK SEANS NOTU' }
    ciz()
    await danisanlarda()
    await waitFor(() => expect(editor().value).toBe('GECMIS SEANS NOTU'))
    const aktif = within(screen.getByTestId('seans-listesi')).getByRole('button', { current: true })
    expect(aktif.textContent).toContain('7 Eylül 2026, 10:00')
    expect(notGetleri(202)).toHaveLength(0)
  })

  it('takvimden "dosyasını aç" ile gelinince O seans (202) seçili', async () => {
    notlar[201] = { sablon: 'serbest', icerik: 'GECMIS SEANS NOTU' }
    notlar[202] = { sablon: 'serbest', icerik: 'GELECEK SEANS NOTU' }
    ciz()
    await takvimde202Ac()
    await paneldenDosyayaGit()
    await waitFor(() => expect(editor().value).toBe('GELECEK SEANS NOTU'))
    const aktif = within(screen.getByTestId('seans-listesi')).getByRole('button', { current: true })
    expect(aktif.textContent).toContain('14 Eylül 2026, 10:00')
  })
})

describe('M1 — sekme gidip gelince dosyanın durumu korunur, not yeniden istenmez', () => {
  it('elle seçilen seans ve alt sekme korunur; seçili notun GET\'i tekrarlanmaz', async () => {
    notlar[202] = { sablon: 'serbest', icerik: 'SECILEN' }
    ciz()
    await danisanlarda()
    await userEvent.click(listeSatiri('14 Eylül 2026, 10:00'))
    await waitFor(() => expect(editor().value).toBe('SECILEN'))
    expect(notGetleri(202)).toHaveLength(1)

    // Alt sekme: Bilgiler -> Takvim -> Danışanlar => hâlâ Bilgiler.
    await userEvent.click(screen.getByRole('tab', { name: 'Bilgiler' }))
    await takvimeDon()
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    expect(screen.getByRole('tab', { name: 'Bilgiler' }).getAttribute('aria-selected')).toBe('true')

    // Seçim: Seanslar'a dönünce hâlâ 202, not önbellekten (yeni GET YOK).
    await userEvent.click(screen.getByRole('tab', { name: 'Seanslar' }))
    await waitFor(() => expect(editor().value).toBe('SECILEN'))
    const aktif = within(screen.getByTestId('seans-listesi')).getByRole('button', { current: true })
    expect(aktif.textContent).toContain('14 Eylül 2026, 10:00')
    await takvimeDon()
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await screen.findByLabelText('Seans notu')
    expect(notGetleri(202)).toHaveLength(1)
  })

  // Değişmez: görünmeyen sekmeden (silinemez görüntüleme kaydı yazan) istek
  // atılmaz. Liste yanıtı kullanıcı Takvim'e geçtikten SONRA gelir ve
  // varsayılan seçimi kurar; dosyanın not isteği Danışanlar görünene kadar
  // BEKLER.
  it('liste yanıtı Takvim sekmesindeyken gelirse dosyanın not isteği Danışanlar görünene kadar ATILMAZ', async () => {
    notlar[201] = { sablon: 'serbest', icerik: 'GECMIS' }
    ciz()
    const k = kapi()
    onceBekle['GET /api/danisanlar/1/seanslar'] = k.bekle
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await takvimeDon()
    k.ac()
    // BARİYER: liste yanıtı geldi ve işlendi (takvimdeyken).
    await waitFor(() =>
      expect(istekler.some((i) => i.yol === '/api/danisanlar/1/seanslar')).toBe(true),
    )
    await new Promise((r) => setTimeout(r, 50))
    expect(notGetleri(201)).toHaveLength(0)

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await waitFor(() => expect(editor().value).toBe('GECMIS'))
    expect(notGetleri(201)).toHaveLength(1)
  })

  it('Bilgiler alt sekmesindeyken seçili seansın notu İSTENMEZ', async () => {
    notlar[201] = { sablon: 'serbest', icerik: 'GECMIS' }
    ciz()
    const k = kapi()
    onceBekle['GET /api/danisanlar/1/seanslar'] = k.bekle
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await userEvent.click(await screen.findByRole('tab', { name: 'Bilgiler' }))
    k.ac()
    await waitFor(() => expect(bakiye()).toBe('450,00 TL'))
    await new Promise((r) => setTimeout(r, 50))
    expect(notGetleri(201)).toHaveLength(0)
  })
})

describe('I4 — seans listesi hatası "seans yok" DEĞİLDİR (AnaEkran üzerinden)', () => {
  it('500 -> "Seanslar yüklenemedi" + Yeniden dene; "seansı yok" YOK; yeniden deneme listeyi getirir', async () => {
    seanslarHatasi = true
    ciz()
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    const alarm = await screen.findByRole('alert')
    expect(alarm.textContent).toContain('Seanslar yüklenemedi')
    expect(screen.queryByText('Bu danışanın kayıtlı bir seansı yok.')).toBeNull()

    seanslarHatasi = false
    await userEvent.click(within(alarm).getByRole('button', { name: 'Yeniden dene' }))
    await waitFor(() =>
      expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet'),
    )
    expect(screen.getByTestId('seans-listesi').querySelectorAll('li')).toHaveLength(2)
  })
})

describe('M4 — seans zamanı iki ekranda TEK biçim', () => {
  it('takvim panelinin "Önceki seans notları" ve dosya listesi aynı seansı AYNI metinle gösterir', async () => {
    notlar[201] = { sablon: 'serbest', icerik: 'onceki not' }
    ciz()
    await takvimde202Ac()
    const gecmis = screen.getByRole('region', { name: 'Önceki seans notları' })
    await waitFor(() => expect(gecmis.textContent).toContain('Seans: 7 Eylül 2026, 10:00'))

    await paneldenDosyayaGit()
    await waitFor(() =>
      expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet'),
    )
    expect(listeSatiri('7 Eylül 2026, 10:00')).toBeDefined()
  })
})

// =============================================================================
// Plan 6 Görev 6 — etiketler. Aynı sınıf: bir ekranda yapılan etiket yazması
// DİĞER ekranda doğru görünmeli (seansın etiketleri iki ekranda TEK
// önbellekte; dosyanın seans listesi yayılımla), ve terapistin bakmadığı şey
// için istek atılmamalı (silinemez görüntüleme satırı).
// =============================================================================

const etiketGetleri = (id: number) =>
  istekler.filter((i) => i.method === 'GET' && i.yol === `/api/randevular/${id}/etiketler`)
const sozlukGetleri = () =>
  istekler.filter((i) => i.method === 'GET' && i.yol === '/api/etiketler')
const seanslarGetleri = () =>
  istekler.filter((i) => i.method === 'GET' && i.yol === '/api/danisanlar/1/seanslar')
const kaldirDugmesi = (ad: string) =>
  screen.queryByRole('button', { name: `${ad} etiketini kaldır` })
/** Açık etiket kutusunun öneri listesi (`<datalist>`'teki değerler). */
const oneriler = () =>
  [...document.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))

describe('Etiketler — çapraz önbellek: iki ekran, TEK yazma yolu', () => {
  it('takvimde eklenen etiket, ÖNCEDEN yüklenmiş dosya listesinin satırında görünür (liste yeniden çekilmeden)', async () => {
    ciz()
    // Dosya ÖNCE açılır: liste önbelleğe etiketsiz girer. Sonra takvimde
    // eklenir; dönüşte liste yeniden istenmediği için satırı tek güncelleyen
    // şey yayılımdır (`seanslar.yamala({ etiketler })`).
    await danisanlarda()
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).not.toContain('kaygı')
    const listeIstekleri = seanslarGetleri().length

    await takvimeDon()
    await takvimde202Ac()
    await userEvent.type(await screen.findByLabelText('Etiket ekle'), 'kaygı{Enter}')
    await waitFor(() => expect(kaldirDugmesi('kaygı')).not.toBeNull())
    expect(baglar[202]).toHaveLength(1)

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await waitFor(() =>
      expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet'),
    )
    expect(
      within(listeSatiri('14 Eylül 2026, 10:00')).getByTestId('satir-etiketleri').textContent,
    ).toBe('kaygı')
    expect(seanslarGetleri()).toHaveLength(listeIstekleri)
  })

  it('dosyada kaldırılan etiket, takvime dönünce panelde görünmez; satır da yamanır; etiketler yeniden İSTENMEZ', async () => {
    etiketBagla(202, 'kaygı')
    const uyku = etiketBagla(202, 'uyku')
    ciz()
    await takvimde202Ac()
    await waitFor(() => expect(kaldirDugmesi('kaygı')).not.toBeNull())

    await paneldenDosyayaGit()
    await waitFor(() =>
      expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('kaygı'),
    )
    // Dosya O seansla açıldı (I3); etiket satırı takvimle AYNI önbellekten.
    await userEvent.click(await screen.findByRole('button', { name: 'kaygı etiketini kaldır' }))
    await waitFor(() => expect(baglar[202]).toEqual([uyku]))
    await waitFor(() => expect(kaldirDugmesi('kaygı')).toBeNull())
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).not.toContain('kaygı')
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('uyku')

    await takvimeDon()
    // BARİYER: takvim panelinin etiket satırı YÜKLÜ çizildi (öbür etiket
    // görünüyor) — "kaygı yok" iddiası "henüz yükleniyor" ile tatmin olmasın.
    await screen.findByRole('button', { name: 'uyku etiketini kaldır' })
    expect(kaldirDugmesi('kaygı')).toBeNull()
    // İki ekran, iki sekme geçişi: 202'nin etiketleri TEK kez istendi.
    expect(etiketGetleri(202)).toHaveLength(1)
  })

  it('liste okuması uçuştayken takvimde eklenen etiket, geç dönen listede kaybolmaz', async () => {
    ciz()
    await takvimde202Ac()
    const k = kapi()
    sonraBekle['GET /api/danisanlar/1/seanslar'] = k.bekle
    await paneldenDosyayaGit()
    // BARİYER: liste okuması yola çıktı (anlık görüntü: etiketsiz).
    await waitFor(() => expect(seanslarGetleri().length).toBeGreaterThan(0))
    await takvimeDon()
    await userEvent.type(await screen.findByLabelText('Etiket ekle'), 'kaygı{Enter}')
    await waitFor(() => expect(kaldirDugmesi('kaygı')).not.toBeNull())

    k.ac()
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await waitFor(() =>
      expect(screen.getByTestId('seans-listesi').getAttribute('data-yuklendi')).toBe('evet'),
    )
    expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('kaygı')
  })
})

describe('Etiketler — geciken yanıt ve istek zamanlaması', () => {
  it('geciken yanıt yeni seçimi EZMEZ: A\'nın geç gelen etiketleri B\'nin panelinde görünmez, A\'ya yazılır', async () => {
    etiketBagla(201, 'AYSE_ETIKETI')
    etiketBagla(203, 'mehmet-etiketi')
    ciz()
    const k = kapi()
    sonraBekle['GET /api/randevular/201/etiketler'] = k.bekle
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
    // BARİYER: 201'in etiket okuması sunucuda yapıldı, yanıt yolda.
    await waitFor(() => expect(etiketGetleri(201)).toHaveLength(1))
    await userEvent.click(screen.getByRole('button', { name: 'Mehmet Demir' }))
    await waitFor(() => expect(kaldirDugmesi('mehmet-etiketi')).not.toBeNull())

    await act(async () => {
      k.ac()
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(screen.queryByText('AYSE_ETIKETI')).toBeNull()
    expect(kaldirDugmesi('mehmet-etiketi')).not.toBeNull()

    // İki yön: geç yanıt ATILMADI, İSTENEN seansa yazıldı — 201'e dönünce
    // yeniden istek olmadan görünür.
    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz' }))
    await waitFor(() => expect(kaldirDugmesi('AYSE_ETIKETI')).not.toBeNull())
    expect(etiketGetleri(201)).toHaveLength(1)
  })

  it('sözlük açılışta İSTENMEZ; etiket kutusuna ilk odakta BİR KEZ istenir; öneriler seansa bağlı olanları dışlar', async () => {
    etiketBagla(201, 'aile')
    etiketBagla(203, 'kaygı')
    ciz()
    await takvimde202Ac()
    // BARİYER: takvim panelinin etiket satırı yüklü (kutu çizili).
    await screen.findByLabelText('Etiket ekle')
    await danisanlarda()
    await screen.findByRole('button', { name: 'aile etiketini kaldır' })
    expect(sozlukGetleri()).toHaveLength(0)

    await userEvent.click(screen.getByLabelText('Etiket ekle'))
    await waitFor(() => expect(sozlukGetleri()).toHaveLength(1))
    // Dosyada varsayılan seans 201 seçili ve 'aile' ona zaten bağlı.
    await waitFor(() => expect(oneriler()).toEqual(['kaygı']))

    // Odaktan çıkıp yeniden girmek, sekme gidip gelmek: yeni istek YOK.
    await userEvent.tab()
    await userEvent.click(screen.getByLabelText('Etiket ekle'))
    await takvimeDon()
    await userEvent.click(await screen.findByLabelText('Etiket ekle'))
    await new Promise((r) => setTimeout(r, 30))
    expect(sozlukGetleri()).toHaveLength(1)
    // Takvimde 202 açık: ona hiçbir etiket bağlı değil, ikisi de önerilir.
    expect(oneriler()).toEqual(['aile', 'kaygı'])
  })

  it('sözlük okuması uçuştayken eklenen YENİ etiket, geç dönen sözlükte kaybolmaz', async () => {
    etiketBagla(203, 'kaygı')
    ciz()
    await takvimde202Ac()
    const k = kapi()
    sonraBekle['GET /api/etiketler'] = k.bekle
    await userEvent.type(await screen.findByLabelText('Etiket ekle'), 'yepyeni{Enter}')
    // BARİYER: sözlük sunucuda 'yepyeni'den ÖNCE okundu (odakta, yazmadan
    // önce), ekleme SONRA bitti.
    await waitFor(() => expect(sozlukGetleri().length).toBeGreaterThan(0))
    await waitFor(() => expect(kaldirDugmesi('yepyeni')).not.toBeNull())
    await act(async () => {
      k.ac()
      await new Promise((r) => setTimeout(r, 30))
    })

    // Başka bir seansta öneri listesi yeni etiketi içermeli.
    await userEvent.click(screen.getByRole('button', { name: 'Önceki hafta' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
    await userEvent.click(await screen.findByLabelText('Etiket ekle'))
    await waitFor(() => expect(oneriler()).toEqual(expect.arrayContaining(['kaygı', 'yepyeni'])))
    // Sözlük yazmadan sonra yeniden OKUNDU (inceleme M1 — yerel yama yok):
    // ilk okuma + eklemenin ardından bir okuma.
    expect(sozlukGetleri()).toHaveLength(2)
  })

  it('Bilgiler alt sekmesindeyken seçili seansın etiketleri İSTENMEZ; Seanslar\'a geçince istenir', async () => {
    etiketBagla(201, 'aile')
    ciz()
    const k = kapi()
    onceBekle['GET /api/danisanlar/1/seanslar'] = k.bekle
    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    await userEvent.click(await screen.findByRole('tab', { name: 'Bilgiler' }))
    k.ac()
    // BARİYER: Bilgiler içeriği gerçekten ekranda (bakiye) ve liste geldi
    // (varsayılan seçim kuruldu).
    await waitFor(() => expect(bakiye()).toBe('450,00 TL'))
    await waitFor(() => expect(seanslarGetleri()).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 50))
    expect(etiketGetleri(201)).toHaveLength(0)

    await userEvent.click(screen.getByRole('tab', { name: 'Seanslar' }))
    await screen.findByRole('button', { name: 'aile etiketini kaldır' })
    expect(etiketGetleri(201)).toHaveLength(1)
  })
})

describe('Etiketler — etiketli seanslar paneli', () => {
  it('çipten panel açılır; satıra tıklamak danisanaGit ile Danışanlar sekmesinde O seansı seçer', async () => {
    const kaygi = etiketBagla(202, 'kaygı')
    etiketBagla(203, 'kaygı')
    ciz()
    await userEvent.click(await screen.findByRole('button', { name: 'Mehmet Demir' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'kaygı etiketli seansları göster' }),
    )
    const bolge = await screen.findByRole('region', { name: 'kaygı etiketli seanslar' })
    await within(bolge).findByRole('button', { name: 'Ayşe Yılmaz — 14 Eylül 2026, 10:00' })
    expect(
      within(bolge).getByRole('button', { name: 'Mehmet Demir — 8 Eylül 2026, 13:00' }),
    ).toBeDefined()

    await userEvent.click(
      within(bolge).getByRole('button', { name: 'Ayşe Yılmaz — 14 Eylül 2026, 10:00' }),
    )
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Danışanlar' }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    )
    await screen.findByRole('heading', { name: 'Ayşe Yılmaz' })
    // O seans (202, GELECEKTE) seçili — varsayılan (201, geçmişteki en yeni)
    // DEĞİL: seçimi `appointmentId` kurdu.
    await waitFor(() =>
      expect(listeSatiri('14 Eylül 2026, 10:00').getAttribute('aria-current')).toBe('true'),
    )
    expect(listeSatiri('7 Eylül 2026, 10:00').getAttribute('aria-current')).toBeNull()
    expect(istekler.filter((i) => i.yol === `/api/etiketler/${kaygi}/seanslar`)).toHaveLength(1)
  })

  it('açık panelin etiketi bir seanstan kaldırılınca o seans panelden düşer', async () => {
    etiketBagla(202, 'kaygı')
    etiketBagla(203, 'kaygı')
    ciz()
    await userEvent.click(await screen.findByRole('button', { name: 'Mehmet Demir' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'kaygı etiketli seansları göster' }),
    )
    const bolge = await screen.findByRole('region', { name: 'kaygı etiketli seanslar' })
    await within(bolge).findByRole('button', { name: 'Mehmet Demir — 8 Eylül 2026, 13:00' })

    await userEvent.click(screen.getByRole('button', { name: 'kaygı etiketini kaldır' }))
    await waitFor(() => expect(baglar[203]).toEqual([]))
    await waitFor(() =>
      expect(
        within(bolge).queryByRole('button', { name: 'Mehmet Demir — 8 Eylül 2026, 13:00' }),
      ).toBeNull(),
    )
    expect(
      within(bolge).getByRole('button', { name: 'Ayşe Yılmaz — 14 Eylül 2026, 10:00' }),
    ).toBeDefined()
  })

  it('401: açık etiketli seanslar paneli (sekme panellerinin dışında) KAPANIR; kilitten sonra etiketler önbellekten değil yeniden istenir', async () => {
    etiketBagla(203, 'kaygı')
    ciz()
    await userEvent.click(await screen.findByRole('button', { name: 'Mehmet Demir' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'kaygı etiketli seansları göster' }),
    )
    await screen.findByRole('button', { name: 'Mehmet Demir — 8 Eylül 2026, 13:00' })
    expect(etiketGetleri(203)).toHaveLength(1)

    yetkisiz = true
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))
    // BARİYER: takvimin 401 temizliği çalıştı (seans paneli kapandı).
    await waitFor(() => expect(screen.queryByLabelText('Seans notu')).toBeNull())
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'kaygı etiketli seanslar' })).toBeNull(),
    )
    expect(document.body.textContent).not.toContain('Mehmet Demir — ')

    yetkisiz = false
    await userEvent.click(screen.getByRole('button', { name: 'Önceki hafta' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Mehmet Demir' }))
    await waitFor(() => expect(kaldirDugmesi('kaygı')).not.toBeNull())
    expect(etiketGetleri(203)).toHaveLength(2)
  })
})

// =============================================================================
// Görev 6 inceleme düzeltmeleri (IMPORTANT-1, M1, M2, M4, M6)
// =============================================================================

const panelSatiri = (bolge: HTMLElement, ad: RegExp) =>
  within(bolge).queryAllByRole('button').filter((b) => ad.test(b.textContent ?? ''))

describe('Etiketler — inceleme düzeltmeleri', () => {
  it('IMPORTANT-1: silinen etiketin kimliğini alan YENİ etiket, açık paneli başka etikete kaydırmaz', async () => {
    idYenidenKullan = true
    etiketBagla(202, 'aile')
    const kriz = etiketBagla(203, 'kriz')
    ciz()
    await userEvent.click(await screen.findByRole('button', { name: 'Mehmet Demir' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'kriz etiketli seansları göster' }),
    )
    const bolge = await screen.findByRole('region', { name: 'kriz etiketli seanslar' })
    await within(bolge).findByRole('button', { name: 'Mehmet Demir — 8 Eylül 2026, 13:00' })

    // "kriz" son seanstan kaldırılır: sunucu onu siler; panel açık kalır.
    await userEvent.click(screen.getByRole('button', { name: 'kriz etiketini kaldır' }))
    await within(bolge).findByText('Bu etiketi taşıyan seans kalmadı.')
    expect(etiketDeposu.has(kriz)).toBe(false)

    // "öfke" eklenir ve AYNI kimliği alır (kurulumun ön koşulu).
    await userEvent.type(screen.getByLabelText('Etiket ekle'), 'öfke{Enter}')
    await waitFor(() => expect(kaldirDugmesi('öfke')).not.toBeNull())
    expect([...etiketDeposu].find(([, ad]) => ad === 'öfke')?.[0]).toBe(kriz)

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    // Panel "kriz" başlığı altında "öfke" seanslarını GÖSTERMİYOR.
    expect(screen.getByRole('region', { name: 'kriz etiketli seanslar' })).toBe(bolge)
    expect(panelSatiri(bolge, /Mehmet Demir —/)).toHaveLength(0)
    expect(within(bolge).getByText('Bu etiketi taşıyan seans kalmadı.')).toBeDefined()
    expect(istekler.filter((i) => i.yol === `/api/etiketler/${kriz}/seanslar`)).toHaveLength(1)
  })

  it('M1: DELETE sözlük okumasından ÖNCE işlenip yanıtı SONRA dönerse etiket öneriden kaybolmaz', async () => {
    etiketBagla(202, 'kaygı')
    etiketBagla(203, 'kaygı')
    ciz()
    await takvimde202Ac()
    const k = kapi()
    sonraBekle[`DELETE /api/randevular/202/etiketler/1`] = k.bekle
    await userEvent.click(await screen.findByRole('button', { name: 'kaygı etiketini kaldır' }))
    // BARİYER: sunucu kaldırmayı YAPTI (kullanım 1), yanıt yolda.
    await waitFor(() => expect(baglar[202]).toEqual([]))
    await userEvent.click(screen.getByLabelText('Etiket ekle'))
    // Sözlük okuması sunucuda kaldırmadan SONRA yapıldı ve döndü.
    await waitFor(() => expect(sozlukGetleri()).toHaveLength(1))
    await act(async () => {
      k.ac()
      await new Promise((r) => setTimeout(r, 50))
    })
    await waitFor(() => expect(kaldirDugmesi('kaygı')).toBeNull())
    // Etiket 203'te hâlâ kullanılıyor: 202'den kaldırılınca ÖNERİLMELİ.
    await waitFor(() => expect(oneriler()).toEqual(['kaygı']))
  })

  it('M1: son kullanımı kaldırılan (sunucuda silinen) etiket öneride KALMAZ — sözlük yazmadan sonra yeniden okunur', async () => {
    etiketBagla(202, 'kriz')
    ciz()
    await takvimde202Ac()
    await userEvent.click(await screen.findByLabelText('Etiket ekle'))
    await waitFor(() => expect(sozlukGetleri()).toHaveLength(1))
    // BARİYER: sözlük yüklendi ('kriz' bağlı olduğu için öneride değil).
    await waitFor(() => expect(kaldirDugmesi('kriz')).not.toBeNull())
    expect(oneriler()).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'kriz etiketini kaldır' }))
    await waitFor(() => expect(kaldirDugmesi('kriz')).toBeNull())
    expect(etiketDeposu.size).toBe(0)
    await waitFor(() => expect(sozlukGetleri()).toHaveLength(2))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    // Veri en aza indirme: sözlükten silinmiş hassas bir ad öneride durmaz.
    expect(oneriler()).toEqual([])
  })

  it('M2: panel YÜKLENİRKEN kaldırılan seans, kaldırmadan önce okunmuş yanıtla geri gelmez', async () => {
    etiketBagla(202, 'kaygı')
    etiketBagla(203, 'kaygı')
    ciz()
    await userEvent.click(await screen.findByRole('button', { name: 'Mehmet Demir' }))
    const k = kapi()
    sonraBekle['GET /api/etiketler/1/seanslar'] = k.bekle
    await userEvent.click(
      await screen.findByRole('button', { name: 'kaygı etiketli seansları göster' }),
    )
    const bolge = await screen.findByRole('region', { name: 'kaygı etiketli seanslar' })
    // BARİYER: panel okuması sunucuda yapıldı (203 dahil), yanıt yolda.
    await waitFor(() =>
      expect(istekler.some((i) => i.yol === '/api/etiketler/1/seanslar')).toBe(true),
    )
    await userEvent.click(screen.getByRole('button', { name: 'kaygı etiketini kaldır' }))
    await waitFor(() => expect(baglar[203]).toEqual([]))
    await act(async () => {
      k.ac()
      await new Promise((r) => setTimeout(r, 30))
    })
    await within(bolge).findByRole('button', { name: 'Ayşe Yılmaz — 14 Eylül 2026, 10:00' })
    expect(panelSatiri(bolge, /Mehmet Demir —/)).toHaveLength(0)
  })

  it('M4: etiketli seanslar paneli Ayarlar\'a geçince KAPANIR; Takvim <-> Danışanlar arasında açık kalır', async () => {
    etiketBagla(203, 'kaygı')
    ciz()
    await userEvent.click(await screen.findByRole('button', { name: 'Mehmet Demir' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'kaygı etiketli seansları göster' }),
    )
    await screen.findByRole('button', { name: 'Mehmet Demir — 8 Eylül 2026, 13:00' })

    await userEvent.click(screen.getByRole('tab', { name: 'Danışanlar' }))
    expect(screen.getByRole('region', { name: 'kaygı etiketli seanslar' })).toBeDefined()
    await takvimeDon()
    expect(screen.getByRole('region', { name: 'kaygı etiketli seanslar' })).toBeDefined()

    await userEvent.click(screen.getByRole('tab', { name: /^Ayarlar/ }))
    expect(
      screen.getByRole('tab', { name: /^Ayarlar/ }).getAttribute('aria-selected'),
    ).toBe('true')
    expect(screen.queryByRole('region', { name: 'kaygı etiketli seanslar' })).toBeNull()
    expect(document.body.textContent).not.toContain('Mehmet Demir — ')
    // Kapandı, gizlenmedi: geri dönünce de yok.
    await takvimeDon()
    expect(screen.queryByRole('region', { name: 'kaygı etiketli seanslar' })).toBeNull()
  })

  it('M6: Enter\'dan sonra seans değişir ve ekleme reddedilirse hata KAYBOLMAZ; o seansa dönünce görünür, diğerinde görünmez', async () => {
    ciz()
    await danisanlarda()
    await userEvent.click(listeSatiri('14 Eylül 2026, 10:00'))
    await screen.findByLabelText('Etiket ekle')
    etiketEklemeHatasi = true
    const k = kapi()
    onceBekle['POST /api/randevular/202/etiketler'] = k.bekle
    await userEvent.type(screen.getByLabelText('Etiket ekle'), 'kaygı{Enter}')
    await userEvent.click(listeSatiri('7 Eylül 2026, 10:00'))
    await screen.findByLabelText('Etiket ekle')
    await act(async () => {
      k.ac()
      await new Promise((r) => setTimeout(r, 30))
    })
    // BARİYER: ekleme GERÇEKTEN reddedildi (sunucuda bağ yok).
    expect(baglar[202]).toBeUndefined()
    expect(screen.queryByText(/etiketi eklenemedi/)).toBeNull()

    await userEvent.click(listeSatiri('14 Eylül 2026, 10:00'))
    expect((await screen.findByRole('alert')).textContent).toBe(
      '"kaygı" etiketi eklenemedi. Veritabanı okunamadı.',
    )
  })
})

// =============================================================================
// Son inceleme I1 — takvimin randevu yazmaları etiketli seanslar paneline
// =============================================================================

const etiketliSeansIstekleri = () =>
  istekler.filter((i) => /^\/api\/etiketler\/\d+\/seanslar$/.test(i.yol))

/** 203'ü (Mehmet, bu hafta) takvimde seçer ve "kriz" panelini açar. */
async function krizPaneliAc() {
  await userEvent.click(await screen.findByRole('button', { name: 'Mehmet Demir' }))
  await userEvent.click(
    await screen.findByRole('button', { name: 'kriz etiketli seansları göster' }),
  )
  const bolge = await screen.findByRole('region', { name: 'kriz etiketli seanslar' })
  await within(bolge).findByRole('button', { name: 'Mehmet Demir — 8 Eylül 2026, 13:00' })
  return bolge
}

describe('Son inceleme I1 — randevu yazmaları açık etiketli seanslar panelini tazeler', () => {
  it('(1) panelde listelenen randevunun saati değişince panel YENİ saati gösterir', async () => {
    etiketBagla(202, 'kriz')
    etiketBagla(203, 'kriz')
    ciz()
    const bolge = await krizPaneliAc()
    putBaslangici[203] = '2026-09-08T15:00'
    await userEvent.click(screen.getByRole('button', { name: 'Güncelle' }))
    await within(bolge).findByRole('button', { name: 'Mehmet Demir — 8 Eylül 2026, 15:00' })
    expect(panelSatiri(bolge, /13:00/)).toHaveLength(0)
    expect(etiketliSeansIstekleri()).toHaveLength(2)
  })

  it('(2) randevu başka danışana taşınınca panel YENİ danışanın adını gösterir', async () => {
    etiketBagla(202, 'kriz')
    etiketBagla(203, 'kriz')
    ciz()
    const bolge = await krizPaneliAc()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Güncelle' }))
    await within(bolge).findByRole('button', { name: 'Ayşe Yılmaz — 8 Eylül 2026, 13:00' })
    expect(panelSatiri(bolge, /Mehmet Demir —/)).toHaveLength(0)
  })

  it('(3) randevu silinince satır panelden kalkar; diğer satır kalır', async () => {
    etiketBagla(202, 'kriz')
    etiketBagla(203, 'kriz')
    ciz()
    const bolge = await krizPaneliAc()
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Evet, sil' }))
    await waitFor(() => expect(silinenRandevular.has(203)).toBe(true))
    await waitFor(() => expect(panelSatiri(bolge, /Mehmet Demir —/)).toHaveLength(0))
    expect(
      within(bolge).getByRole('button', { name: 'Ayşe Yılmaz — 14 Eylül 2026, 10:00' }),
    ).toBeDefined()
  })

  it('(3b) etiketin SON seansı silinince panel "seans kalmadı" der (404 hata değil); sözlük yüklüyse tazelenir', async () => {
    etiketBagla(203, 'kriz')
    ciz()
    const bolge = await krizPaneliAc()
    // Sözlük bu oturumda istendi (etiket kutusuna odak).
    await userEvent.click(screen.getByLabelText('Etiket ekle'))
    await waitFor(() => expect(sozlukGetleri()).toHaveLength(1))
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Evet, sil' }))
    await within(bolge).findByText('Bu etiketi taşıyan seans kalmadı.')
    expect(etiketDeposu.size).toBe(0)
    expect(within(bolge).queryByRole('alert')).toBeNull()
    await waitFor(() => expect(sozlukGetleri()).toHaveLength(2))
  })

  it('(3c) seri silinince silinen seans panelden kalkar', async () => {
    randevuDegisiklikleri[203] = { seri_id: 's1' }
    etiketBagla(202, 'kriz')
    etiketBagla(203, 'kriz')
    ciz()
    const bolge = await krizPaneliAc()
    await userEvent.click(screen.getByRole('button', { name: 'Bu ve sonraki tüm tekrarları sil' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Evet, tekrarları sil' }))
    await waitFor(() => expect(silinenRandevular.has(203)).toBe(true))
    await waitFor(() => expect(panelSatiri(bolge, /Mehmet Demir —/)).toHaveLength(0))
    expect(
      within(bolge).getByRole('button', { name: 'Ayşe Yılmaz — 14 Eylül 2026, 10:00' }),
    ).toBeDefined()
  })

  it('(4) son bağ kaldırılıp AYNI ad yeniden eklenince (yeni kimlik) panel yeni seansı gösterir', async () => {
    const eskiKriz = etiketBagla(203, 'kriz')
    ciz()
    const bolge = await krizPaneliAc()
    await userEvent.click(screen.getByRole('button', { name: 'kriz etiketini kaldır' }))
    await within(bolge).findByText('Bu etiketi taşıyan seans kalmadı.')
    expect(etiketDeposu.has(eskiKriz)).toBe(false)

    await userEvent.type(screen.getByLabelText('Etiket ekle'), 'kriz{Enter}')
    await waitFor(() => expect(kaldirDugmesi('kriz')).not.toBeNull())
    const yeniKriz = [...etiketDeposu].find(([, ad]) => ad === 'kriz')![0]
    // Kurulumun ön koşulu: etiket YENİ kimlikle doğdu.
    expect(yeniKriz).not.toBe(eskiKriz)
    const yeniBolge = await screen.findByRole('region', { name: 'kriz etiketli seanslar' })
    await within(yeniBolge).findByRole('button', { name: 'Mehmet Demir — 8 Eylül 2026, 13:00' })
    expect(istekler.filter((i) => i.yol === `/api/etiketler/${yeniKriz}/seanslar`)).toHaveLength(1)
  })

  it('panel KAPALIYKEN (hiç açılmamış ya da kapatılmış) randevu yazmaları etiket isteği ATMAZ', async () => {
    etiketBagla(202, 'kriz')
    etiketBagla(203, 'kriz')
    ciz()
    // Hiç açılmamış panel, hiç istenmemiş sözlük: düzenle + sil.
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
    await screen.findByLabelText('Etiket ekle')
    await userEvent.click(screen.getByRole('button', { name: 'Güncelle' }))
    // BARİYER: PUT yapıldı ve takvim yeniden yüklendi (panel kapandı).
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Güncelle' })).toBeNull())
    expect(istekler.some((i) => i.method === 'PUT' && i.yol === '/api/randevular/201')).toBe(true)
    await userEvent.click(await screen.findByRole('button', { name: 'Ayşe Yılmaz' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Sil' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Evet, sil' }))
    await waitFor(() => expect(silinenRandevular.has(201)).toBe(true))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(etiketliSeansIstekleri()).toHaveLength(0)
    expect(sozlukGetleri()).toHaveLength(0)

    // Açılıp KAPATILMIŞ panel: yazma yeni istek atmaz.
    const bolge = await krizPaneliAc()
    await userEvent.click(within(bolge).getByRole('button', { name: 'Kapat' }))
    expect(screen.queryByRole('region', { name: 'kriz etiketli seanslar' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Güncelle' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Güncelle' })).toBeNull())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(etiketliSeansIstekleri()).toHaveLength(1)
    expect(sozlukGetleri()).toHaveLength(0)
  })
})

describe('Son inceleme I1 yan durumu — yeniden doğma yalnızca AYNI ad anahtarıyla', () => {
  it('panel açıkken BAŞKA adlı yeni bir etiket eklenince panel ona taşınmaz', async () => {
    const kriz = etiketBagla(203, 'kriz')
    ciz()
    const bolge = await krizPaneliAc()
    await userEvent.type(screen.getByLabelText('Etiket ekle'), 'öfke{Enter}')
    await waitFor(() => expect(kaldirDugmesi('öfke')).not.toBeNull())
    const ofke = [...etiketDeposu].find(([, ad]) => ad === 'öfke')![0]
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(screen.getByRole('region', { name: 'kriz etiketli seanslar' })).toBe(bolge)
    expect(istekler.filter((i) => i.yol === `/api/etiketler/${ofke}/seanslar`)).toHaveLength(0)
    expect(istekler.filter((i) => i.yol === `/api/etiketler/${kriz}/seanslar`)).toHaveLength(1)
  })

  it('büyük/küçük harf farkı aynı ad sayılır: "Kriz" yeniden doğunca "kriz" paneli taşınır', async () => {
    etiketBagla(203, 'kriz')
    ciz()
    const bolge = await krizPaneliAc()
    await userEvent.click(screen.getByRole('button', { name: 'kriz etiketini kaldır' }))
    await within(bolge).findByText('Bu etiketi taşıyan seans kalmadı.')
    await userEvent.type(screen.getByLabelText('Etiket ekle'), 'KRİZ{Enter}')
    const yeniBolge = await screen.findByRole('region', { name: 'KRİZ etiketli seanslar' })
    await within(yeniBolge).findByRole('button', { name: 'Mehmet Demir — 8 Eylül 2026, 13:00' })
  })
})
