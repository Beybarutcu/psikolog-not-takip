# Takvim ve randevu (ilk dalga, Plan A) — uygulama planı

> **Ajan çalışanlar için:** GEREKLİ ALT BECERİ: Bu planı görev görev uygulamak
> için `superpowers:subagent-driven-development` (önerilen) ya da
> `superpowers:executing-plans` kullanın. Adımlar onay kutusu (`- [ ]`)
> sözdizimiyle yazılmıştır.

**Amaç:** Uygulamayı açınca bugünü görmek, randevuya tıklayınca formuna ve
notuna aynı yerde ulaşmak, randevuyu silmeden taşımak ve parayı doğru saymak.

**Mimari:** Yeni sekme, alt sistem, uç ya da şema yok. Var olan
`useTakvimAkisi` → `TakvimSekmesi` → `HaftalikTakvim` / `RandevuPaneli` /
`SeansPaneli` zinciri genişletiliyor; sunucuda üç davranış değişiyor (borç
kuralı, varsayılan şablon, taşınan "geldi" seansının son teması), üçü de var
olan uçların içinde. İki kural iki dilde yazılı kalıyor ve ortak bir JSON
örnek dosyasıyla birbirine bağlanıyor (`onizleme_ornekleri.json` deseni).

**Teknoloji:** Rust (rusqlite/SQLCipher, Axum, Tauri 2.11), React 19 + TS +
Tailwind 4, Vitest + Testing Library, Playwright.

**Tasarım:** `docs/superpowers/specs/2026-09-24-ilk-dalga-kullanici-deneyimi-design.md`
(§3 kararlar, §4 A1–A8, §5.1). Bu plan o belgeden argüman yürütür; iki
belge birlikte okunur. §5.2 ve §6 (danışan dosyası) **Plan B**'dir, burada yok.

## Global kısıtlar

Her görevin gereksinimleri bunları da kapsar:

- Tüm kod, yorum ve arayüz metni **Türkçe**. Commit mesajları **ASCII**
  (başlık VE gövde), sonunda `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Sunucu yalnızca `127.0.0.1` dinler. Veri makineden çıkmaz.
- `audit_log` silinemez; içine not içeriği/başlığı, şablon adı, dosya adı,
  arama terimi, etiket adı girmez. **Salt okuma ve etkisiz işlem satır
  yazmaz.** Yeni denetim satırı türü eklenmez.
- **Terapistin bakmadığı şey için silinemez `Goruntuleme` satırı düşmez.**
  `clients::getir` ve `clients::saklama_suresi_dolanlar` `HerCagri`'dir —
  bunları "tazelemek için" yeniden çağırmak YASAK; yanıt yamanır.
  `appointments::aralik_getir`, not okumaları ve `ay_ozeti` `OturumBasi(5 dk)`.
- Özel notlar aramaya, danışan dosyasına, veri raporuna girmez; `ozelNotApi`
  izin listesi (`api.ts`, `useSeansNotlari.ts`, `SeansPaneli.tsx`) genişlemez.
- Zaman duvar saati `YYYY-AA-GGTSS:DD` (16 karakter, saat dilimi yok); para
  tam sayı kuruş.
- **Randevuya tıklayınca imleç hiçbir alana kendiliğinden gitmez**
  (kullanıcı kararı). Odak yalnızca kullanıcının açıkça açtığı bir şeyde
  (ör. gün seçici) verilir.
- Yeni npm paketi / Rust crate'i eklenmez.
- Windows'ta cargo: PowerShell'de
  `$env:PATH = "C:\StrawberryPerl\perl\bin;C:\Users\axres\AppData\Local\bin\NASM;" + $env:PATH`.
  `cargo test --workspace` öncesi `npm --prefix web run build` (`rust_embed`).
- **TS kontrolü için `npm --prefix web run build`**; `npx tsc --noEmit -p .`
  bu projede sessizce hiçbir şey kontrol etmiyor.
- Proje `jest-dom` kullanmıyor: `toBeInTheDocument` YOK; `toBeDefined()`,
  `toBeNull()`, `.textContent`, `getAttribute` kullanılır.

## Her görevin bitiş ölçütü

1. Testler yazılır, **kırmızı** görülür, kod yazılır, **yeşil** görülür.
2. **commit.**
3. Görevin "Mutasyonlar" listesindeki her mutasyon için: mutasyonu uygula →
   ilgili testin **kırmızıya döndüğünü gör** → `git checkout -- <dosya>` →
   yeşili doğrula. (`git checkout --` commit edilmemiş işi de siler; bu
   projede beş kez saatler kaybedildi — **önce commit**.)
4. Raporda her mutasyon için "hangi mutasyon → hangi test kırıldı" satırı.
5. `docs/test-yesil-ama-korumuyor.md` test yazmadan önce okunur.

## İnceleme odağı

Tasarımın ima ettiği ama hiçbir görevin olağan akışının kendiliğinden
sınamadığı, bir terapistin başına en olası gelecek beş durum. Her birinin
testi sahibi olan göreve eklendi:

1. **Yazılmamış not varken randevuyu taşımak** → editördeki metin kaybolmaz,
   editör yeniden monte edilmez, taslak korunur. (Görev 10, test 10.4)
2. **Başka haftaya taşıma ile hızlı hafta gezinmesi çakışınca** → ızgara son
   istenen haftayı, seçim taşınan randevuyu gösterir; geç dönen eski hafta
   yanıtı hiçbir şeyi ezmez. (Görev 10, test 10.2 ve 10.3)
3. **Gece yarısı geçerken uygulama açık** → "Bugün" vurgusu, şimdi çizgisi ve
   bilgi satırı dakikalık tikle yeni güne geçer. (Görev 6, test 6.5)
4. **Eski biçimde kayıtlı ücretle açılan randevu** (`45050` kuruş) → alan
   `450,50` gösterir ve hiçbir alana dokunmadan "Güncelle" ücreti
   **değiştirmez**. (Görev 1, test 1.6)
5. **Ücretsiz (0) ya da ücreti girilmemiş "gelmedi" seansı** → borca girmez;
   bakiye ile ay özeti aynı sayıyı verir. (Görev 2, ortak örnekler + test 2.6)

---

### Görev 1: Ücret alanı Türkçe yazımı doğru okur (A5)

**Dosyalar:**
- Değiştir: `web/src/para.ts`
- Değiştir: `web/src/para.test.ts`
- Değiştir: `web/src/takvim/RandevuPaneli.tsx` (`tldenKurusa` ~90-93, `ucretTl` ~104, `kaydet` ~179-183, ücret alanı ~250-260)
- Değiştir: `web/src/takvim/RandevuPaneli.test.tsx` (`Bulgu 5` ~272, `C1` ~481)
- Değiştir: `e2e/takvim.spec.ts` (~113 ve ~138: alan değerleri)

**Arayüzler:**
- Üretir (`para.ts`):
  - `export const AZAMI_UCRET_KURUS = 100_000_000`
  - `export const UCRET_BICIM_HATASI = 'Ücreti ör. 1.250 ya da 450,50 biçiminde yazın.'`
  - `export const UCRET_SINIR_HATASI = 'Ücret en fazla 1.000.000 TL olabilir.'`
  - `export type UcretOkuma = { kurus: number | null } | { hata: string }`
  - `export function ucretOku(metin: string): UcretOkuma`
  - `export function tlSayisi(kurus: number): string` (`"1.250,50"`, " TL" eksiz)
  - `tlMetni(kurus)` davranışı değişmez; `${tlSayisi(kurus)} TL` olur.

- [ ] **Adım 1: Başarısız testleri yaz** (`web/src/para.test.ts` sonuna)

```ts
import {
  AZAMI_UCRET_KURUS, UCRET_BICIM_HATASI, UCRET_SINIR_HATASI, tlSayisi, ucretOku,
} from './para'

describe('ucretOku — Türkçe yazım (tasarım A5)', () => {
  // Tasarımdaki tablonun TAMAMI. Tek satır bile eksik kalırsa kural
  // o satırda sessizce başka bir şey yapabilir.
  const gecerli: [string, number | null][] = [
    ['', null], ['   ', null],
    ['1.250', 125000], ['1250', 125000], ['1.250,50', 125050],
    ['450,5', 45050], ['450.50', 45050], ['1.25', 125], ['0450', 45000],
    ['0', 0], ['0,00', 0], ['1250 TL', 125000], ['1250TL', 125000],
    ['₺1250', 125000], ['tl 1250', 125000], ['  450  ', 45000],
    ['1.000.000', AZAMI_UCRET_KURUS],
  ]
  for (const [girdi, beklenen] of gecerli) {
    it(`"${girdi}" -> ${beklenen}`, () => {
      expect(ucretOku(girdi)).toEqual({ kurus: beklenen })
    })
  }

  const bicimHatasi = [
    '1.250.50', '1250.500', '12.50,00', '1.2345', '.5', ',5', '5.', '5,',
    '4TL50', '-5', 'abc', 'TL 5 TL', '1,250,00', '12.5.000',
  ]
  for (const girdi of bicimHatasi) {
    it(`"${girdi}" biçim hatası`, () => {
      expect(ucretOku(girdi)).toEqual({ hata: UCRET_BICIM_HATASI })
    })
  }

  it('üst sınırın bir kuruş üstü sınır hatası verir', () => {
    expect(ucretOku('1.000.000,01')).toEqual({ hata: UCRET_SINIR_HATASI })
    expect(ucretOku('99999999999999999999')).toEqual({ hata: UCRET_SINIR_HATASI })
  })

  it('sınır sabiti sunucudaki AZAMI_UCRET ile aynı düz sayı', () => {
    expect(AZAMI_UCRET_KURUS).toBe(100_000_000)
  })

  it('biçimle -> oku aynı değeri verir (0..AZAMI arası, sınırlar dahil)', () => {
    const degerler = [0, 1, 9, 10, 99, 100, 101, 999, 1000, 45000, 45050, 125050,
      999_999, 1_000_000, 12_345_678, AZAMI_UCRET_KURUS - 1, AZAMI_UCRET_KURUS]
    // Ayrıca sabit adımlı bir tarama (rastgele değil: sonuç tekrarlanabilir).
    for (let k = 0; k <= AZAMI_UCRET_KURUS; k += 9_876_543) degerler.push(k)
    for (const k of degerler) {
      expect(ucretOku(tlSayisi(k))).toEqual({ kurus: k })
    }
  })
})
```

- [ ] **Adım 2: Kırmızıyı gör**

Çalıştır: `npm --prefix web run test -- src/para.test.ts`
Beklenen: FAIL — `ucretOku`/`tlSayisi` dışa aktarılmıyor.

- [ ] **Adım 3: `para.ts`'e okuyucuyu yaz**

`tlMetni`'nin gövdesini `tlSayisi`'ye taşı ve `tlMetni`'yi ona bağla; modül
başlığındaki "tek kaynak" gerekçesine "okuma da burada" paragrafı ekle
(neden: `Number('1.250') = 1.25` hatası, tasarım A5).

```ts
export function tlSayisi(kurus: number): string {
  const tam = Math.round(kurus)
  const isaret = tam < 0 ? '-' : ''
  const mutlak = Math.abs(tam)
  const lira = Math.floor(mutlak / 100)
  const kurusKismi = mutlak % 100
  const liraMetni = String(lira).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${isaret}${liraMetni},${String(kurusKismi).padStart(2, '0')}`
}

export function tlMetni(kurus: number): string {
  return `${tlSayisi(kurus)} TL`
}

/** Sunucudaki `appointments::AZAMI_UCRET` ile aynı düz sayı (kuruş). */
export const AZAMI_UCRET_KURUS = 100_000_000
export const UCRET_BICIM_HATASI = 'Ücreti ör. 1.250 ya da 450,50 biçiminde yazın.'
export const UCRET_SINIR_HATASI = 'Ücret en fazla 1.000.000 TL olabilir.'

export type UcretOkuma = { kurus: number | null } | { hata: string }

// Tasarım A5 dilbilgisi: metin bu üç kalıptan birine TAM uymalı.
const BINLIKLI = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/
const DUZ = /^\d+(,\d{1,2})?$/
const NOKTA_ONDALIK = /^\d+\.\d{1,2}$/

export function ucretOku(metin: string): UcretOkuma {
  let t = metin.trim()
  if (t === '') return { kurus: null }
  // "TL", "tl" ya da "₺" yalnızca başta YA DA sonda, en fazla bir kez.
  const bastaki = /^(?:TL|tl|₺)\s*(.*)$/.exec(t)
  if (bastaki) t = bastaki[1]
  else {
    const sondaki = /^(.*?)\s*(?:TL|tl|₺)$/.exec(t)
    if (sondaki) t = sondaki[1]
  }
  let lira: string
  let kurus: string
  if (BINLIKLI.test(t) || DUZ.test(t)) {
    const [tam, ondalik = ''] = t.split(',')
    lira = tam.replace(/\./g, '')
    kurus = ondalik
  } else if (NOKTA_ONDALIK.test(t)) {
    const [tam, ondalik] = t.split('.')
    lira = tam
    kurus = ondalik
  } else {
    return { hata: UCRET_BICIM_HATASI }
  }
  // 7 anlamlı haneden uzun lira Number'a çevrilmeden reddedilir.
  if (lira.replace(/^0+/, '').length > 7) return { hata: UCRET_SINIR_HATASI }
  const deger = Number(lira) * 100 + Number(kurus.padEnd(2, '0'))
  if (deger > AZAMI_UCRET_KURUS) return { hata: UCRET_SINIR_HATASI }
  return { kurus: deger }
}
```

- [ ] **Adım 4: Yeşili gör** — `npm --prefix web run test -- src/para.test.ts` → PASS.

- [ ] **Adım 5: Panel testlerini yaz** (`RandevuPaneli.test.tsx`)

Var olanları güncelle:
- `Bulgu 5: ücret sayıya çevrilemiyorsa…`: `screen.getByText(/ücret.*sayısal/i)`
  yerine `screen.getByText('Ücreti ör. 1.250 ya da 450,50 biçiminde yazın.')`.
- `C1: mevcut randevuda alanlar kayıttan dolar…`: alan beklentisi `'450'` →
  `'450,00'`.

Yenilerini ekle (test 1.1–1.6):

```ts
  it('1.1: "1.250" 1.250 TL olarak kaydedilir (eski hata: 1,25 TL)', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.type(screen.getByLabelText('Ücret (TL)'), '1.250')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(props.onKaydet).toHaveBeenCalledWith(expect.objectContaining({ ucret: 125000 }))
  })

  it('1.2: "450,50" kabul edilir (eski hata: sayısal değil)', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.type(screen.getByLabelText('Ücret (TL)'), '450,50')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(props.onKaydet).toHaveBeenCalledWith(expect.objectContaining({ ucret: 45050 }))
  })

  it('1.3: alanın altında neyin kaydedileceği görünür', async () => {
    kur()
    expect(screen.queryByTestId('ucret-onizleme')).toBeNull()
    await userEvent.type(screen.getByLabelText('Ücret (TL)'), '1250,5')
    expect(screen.getByTestId('ucret-onizleme').textContent).toBe('= 1.250,50 TL')
  })

  it('1.4: geçersiz yazımda önizleme yok, kaydet hatayı söyler', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.type(screen.getByLabelText('Ücret (TL)'), '1.250.50')
    expect(screen.queryByTestId('ucret-onizleme')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(screen.getByText('Ücreti ör. 1.250 ya da 450,50 biçiminde yazın.')).toBeDefined()
    expect(props.onKaydet).not.toHaveBeenCalled()
  })

  it('1.5: üst sınırı aşan ücret kaydedilmez', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.type(screen.getByLabelText('Ücret (TL)'), '1.000.000,01')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(screen.getByText('Ücret en fazla 1.000.000 TL olabilir.')).toBeDefined()
    expect(props.onKaydet).not.toHaveBeenCalled()
  })

  it('1.6 (inceleme odağı 4): kuruşlu kayıt "450,50" açılır, dokunmadan Güncelle ücreti değiştirmez', async () => {
    const props = kur({ randevu: { ...mevcut, ucret: 45050 } })
    expect((screen.getByLabelText('Ücret (TL)') as HTMLInputElement).value).toBe('450,50')
    await userEvent.click(screen.getByRole('button', { name: 'Güncelle' }))
    expect(props.onKaydet).toHaveBeenCalledWith(expect.objectContaining({ ucret: 45050 }))
  })
```

- [ ] **Adım 6: Kırmızıyı gör** — `npm --prefix web run test -- src/takvim/RandevuPaneli.test.tsx` → 1.1–1.6 ve güncellenen iki test FAIL.

- [ ] **Adım 7: Paneli bağla** (`RandevuPaneli.tsx`)

- `tldenKurusa` fonksiyonunu ve üstündeki yorumu **sil**.
- `import { tlMetni, tlSayisi, ucretOku } from '../para'`.
- `useState(randevu?.ucret != null ? String(randevu.ucret / 100) : '')` →
  `useState(randevu?.ucret != null ? tlSayisi(randevu.ucret) : '')`.
- Render gövdesinde: `const ucretOkuma = ucretOku(ucretTl)`.
- `kaydet()` içindeki `ucretTrim` / `Number.isNaN` ön kontrolünü şu blokla
  değiştir:

```ts
    if ('hata' in ucretOkuma) {
      setHata(ucretOkuma.hata)
      return
    }
```

  ve `onKaydet` çağrısındaki `ucret: tldenKurusa(ucretTl)` →
  `ucret: ucretOkuma.kurus`.
- Ücret `<input>`'unun hemen altına:

```tsx
      {'kurus' in ucretOkuma && ucretOkuma.kurus !== null && (
        <p data-testid="ucret-onizleme" className="mt-1 text-xs text-slate-500">
          = {tlMetni(ucretOkuma.kurus)}
        </p>
      )}
```

- [ ] **Adım 8: Yeşili gör** — `npm --prefix web run test` → hepsi PASS.
`npm --prefix web run build` → tip hatası yok.

- [ ] **Adım 9: e2e değerlerini güncelle** (`e2e/takvim.spec.ts`)

`toHaveValue('450')` → `toHaveValue('450,00')`; `toHaveValue('500')` →
`toHaveValue('500,00')`. (`fill('500')` aynen kalır — `DUZ` kalıbı.)

Çalıştır: `npx playwright test e2e/takvim.spec.ts --reporter=line` → PASS.

- [ ] **Adım 10: Commit**

```bash
git add web/src/para.ts web/src/para.test.ts web/src/takvim/RandevuPaneli.tsx web/src/takvim/RandevuPaneli.test.tsx e2e/takvim.spec.ts
git commit -m "Ucret alani Turkce yazimi okur: 1.250 artik 1,25 TL degil"
```

**Mutasyonlar:**
- `BINLIKLI`'deki `(\.\d{3})+` → `(\.\d{1,3})+` → `"12.50,00"` / `"1.250.50"` satırları kırılmalı.
- `NOKTA_ONDALIK` dalını sil → `"450.50"`, `"1.25"` satırları kırılmalı.
- `if (deger > AZAMI_UCRET_KURUS)` satırını sil → sınır testi ve 1.5 kırılmalı.
- `tlSayisi(randevu.ucret)` → `String(randevu.ucret / 100)` → 1.6 ve C1 kırılmalı.

---

### Görev 2: Gelmedi borca girer — tek kural, iki dil (§5.1)

**Dosyalar:**
- Oluştur: `core/src/store/borc_ornekleri.json`
- Değiştir: `core/src/store/ozet.rs` (modül başlığı 12-30; sorgular ~155 ve ~167; testler)
- Oluştur: `web/src/borc.ts`, `web/src/borc.test.ts`
- Değiştir: `web/src/danisan/DosyaBilgileri.tsx` (başlık ~34-45; bakiye ~248-252; açıklama ~379-391)
- Değiştir: `web/src/danisan/DosyaBilgileri.test.tsx` (~190-242)
- Değiştir: `web/src/ozet/AyOzeti.tsx` (başlık ~6-15; `KAPSAM_CUMLESI`; borçlu satırı ~199)
- Değiştir: `web/src/ozet/AyOzeti.test.tsx` (~244)
- Değiştir: `web/src/screens/AnaEkran.test.tsx` (~2272 sahte özet; ~2511, ~2671, ~2707 tetikleyiciler)
- Değiştir: `e2e/odeme.spec.ts` (`KAPSAM_CUMLESI` ~177; gelmedi testi ~239-270; borçlu adları)
- Değiştir: `web/src/api.ts` (bakiye/borç kuralından söz eden yorum varsa)

**Arayüzler:**
- Üretir (`web/src/borc.ts`):
  - `export type BorcAlanlari = { durum: string; odendi: boolean; ucret: number | null }`
  - `export function borcaGirerMi(r: BorcAlanlari): boolean`
  - `export function borcToplami(randevular: readonly BorcAlanlari[]): number`
- Plan B, `borcToplami(kart.randevular)`'ı dosya başlığında kullanacak.

- [ ] **Adım 1: Ortak örnek dosyasını yaz** (`core/src/store/borc_ornekleri.json`)

Her `durum × odendi × ucret∈{null,0,45000}` birleşimi (4×2×3 = 24 satır):

```json
[
  { "ad": "geldi odenmedi ucretli", "durum": "geldi", "odendi": false, "ucret": 45000, "borca_girer": true },
  { "ad": "geldi odenmedi ucret 0", "durum": "geldi", "odendi": false, "ucret": 0, "borca_girer": false },
  { "ad": "geldi odenmedi ucret yok", "durum": "geldi", "odendi": false, "ucret": null, "borca_girer": false },
  { "ad": "geldi odendi ucretli", "durum": "geldi", "odendi": true, "ucret": 45000, "borca_girer": false },
  { "ad": "geldi odendi ucret 0", "durum": "geldi", "odendi": true, "ucret": 0, "borca_girer": false },
  { "ad": "geldi odendi ucret yok", "durum": "geldi", "odendi": true, "ucret": null, "borca_girer": false },
  { "ad": "gelmedi odenmedi ucretli", "durum": "gelmedi", "odendi": false, "ucret": 45000, "borca_girer": true },
  { "ad": "gelmedi odenmedi ucret 0", "durum": "gelmedi", "odendi": false, "ucret": 0, "borca_girer": false },
  { "ad": "gelmedi odenmedi ucret yok", "durum": "gelmedi", "odendi": false, "ucret": null, "borca_girer": false },
  { "ad": "gelmedi odendi ucretli", "durum": "gelmedi", "odendi": true, "ucret": 45000, "borca_girer": false },
  { "ad": "gelmedi odendi ucret 0", "durum": "gelmedi", "odendi": true, "ucret": 0, "borca_girer": false },
  { "ad": "gelmedi odendi ucret yok", "durum": "gelmedi", "odendi": true, "ucret": null, "borca_girer": false },
  { "ad": "iptal odenmedi ucretli", "durum": "iptal", "odendi": false, "ucret": 45000, "borca_girer": false },
  { "ad": "iptal odenmedi ucret 0", "durum": "iptal", "odendi": false, "ucret": 0, "borca_girer": false },
  { "ad": "iptal odenmedi ucret yok", "durum": "iptal", "odendi": false, "ucret": null, "borca_girer": false },
  { "ad": "iptal odendi ucretli", "durum": "iptal", "odendi": true, "ucret": 45000, "borca_girer": false },
  { "ad": "iptal odendi ucret 0", "durum": "iptal", "odendi": true, "ucret": 0, "borca_girer": false },
  { "ad": "iptal odendi ucret yok", "durum": "iptal", "odendi": true, "ucret": null, "borca_girer": false },
  { "ad": "planlandi odenmedi ucretli", "durum": "planlandi", "odendi": false, "ucret": 45000, "borca_girer": false },
  { "ad": "planlandi odenmedi ucret 0", "durum": "planlandi", "odendi": false, "ucret": 0, "borca_girer": false },
  { "ad": "planlandi odenmedi ucret yok", "durum": "planlandi", "odendi": false, "ucret": null, "borca_girer": false },
  { "ad": "planlandi odendi ucretli", "durum": "planlandi", "odendi": true, "ucret": 45000, "borca_girer": false },
  { "ad": "planlandi odendi ucret 0", "durum": "planlandi", "odendi": true, "ucret": 0, "borca_girer": false },
  { "ad": "planlandi odendi ucret yok", "durum": "planlandi", "odendi": true, "ucret": null, "borca_girer": false }
]
```

- [ ] **Adım 2: Rust testlerini yaz** (`ozet.rs` test modülü)

Yeni test — her satır kendi danışanı ve randevusuyla, gerçek `ay_ozeti`
yolundan (`include_str!`):

```rust
    /// Tasarim §5.1: borc kurali IKI dilde yazili; bu dosyayi
    /// `web/src/borc.test.ts` de okur. Her satir GERCEK yoldan gecer.
    #[test]
    fn borc_ortak_ornekleri_saglar() {
        let ornekler: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("borc_ornekleri.json")).unwrap();
        assert!(ornekler.len() >= 24, "ornek dosyasi beklenenden kucuk");
        let (_d, c) = kurulum();
        let mut beklenen_bekleyen = 0i64;
        let mut borclu_sayisi = 0usize;
        for (i, o) in ornekler.iter().enumerate() {
            let ad = o["ad"].as_str().unwrap();
            let durum = o["durum"].as_str().unwrap();
            let odendi = o["odendi"].as_bool().unwrap();
            let ucret = o["ucret"].as_i64();
            let girer = o["borca_girer"].as_bool().unwrap();
            let cid = danisan(&c, &format!("Ornek {i}"));
            seans(&c, cid, &format!("2026-09-{:02}T10:00", 1 + (i % 28)), ucret, durum, odendi);
            if girer {
                beklenen_bekleyen += ucret.unwrap();
                borclu_sayisi += 1;
            }
            let o_ = ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
            let borclu = o_.borclular.iter().find(|b| b.client_id == cid);
            assert_eq!(borclu.is_some(), girer, "ornek: {ad}");
            if let Some(b) = borclu {
                assert_eq!(Some(b.borc_kurus), ucret, "ornek: {ad}");
                assert_eq!(b.seans_sayisi, 1, "ornek: {ad}");
            }
        }
        let son = ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
        assert_eq!(son.bekleyen_kurus, beklenen_bekleyen);
        assert_eq!(son.borclular.len(), borclu_sayisi);
        // On kosul: iki kolu ayiran vaka (gelmedi) gercekten borclu uretti.
        assert!(borclu_sayisi >= 2, "geldi ve gelmedi borclulari uretilmedi");
    }
```

Var olanları yeni kurala çevir:
- `yalnizca_gelinmis_seanslar_sayilir_ve_tutarlar_kurusla_dogru` → adı
  `seans_sayisi_yalnizca_geldi_borc_geldi_ve_gelmedi`. Beklentiler: `seans_sayisi`
  3 (değişmez); `tahsilat_kurus` 45018 (değişmez); `bekleyen_kurus`
  `45000 + 45000 + 90000` = **180000** (Ayşe'nin gelmedisi 450 + Gelmeyen'in
  gelmedisi 900 eklenir); `borclular.len()` **2**. İkisinin tutarı eşit
  (90000) olduğu için sıra ada göre (`ORDER BY borc DESC, ad_soyad`):
  `borclular[0]` **Ayse** (`borc_kurus` 90000, `seans_sayisi` 2: geldi +
  gelmedi), `borclular[1]` **Gelmeyen** (90000, 1). İddia mesajlarını yeni
  kurala göre yaz ("gelmedi borca girer; iptal/planlandi girmez").
- `ozet_bagimsiz_hesapla_esit_ve_bekleyen_borclular_toplamidir`: `bu_ay`
  ikiye bölünür:

```rust
                let gelinen: Vec<_> = ayin_tumu.iter().copied().filter(|k| k.3 == "geldi").collect();
                let borc_kumesi: Vec<_> = ayin_tumu
                    .iter()
                    .copied()
                    .filter(|k| k.3 == "geldi" || k.3 == "gelmedi")
                    .collect();
                let beklenen_seans = gelinen.len() as i64;
```

  `toplam` ve `beklenen_borc` döngüsü `borc_kumesi` üzerinden kurulur
  (`toplam(false)` bekleyen için — `ucret > 0` süzgeci ekle:
  `.filter(|k| k.4 == odendi && k.2.is_some_and(|u| u > 0))`). Yeni ön koşul
  sayacı: `gelmedi_borcu_goruldu` (`k.3 == "gelmedi"` borçlu satır üretildi)
  ve sonda `assert!(gelmedi_borcu_goruldu, ...)`.

- [ ] **Adım 3: Kırmızıyı gör**

Çalıştır (PowerShell, cargo PATH öneki ile):
`cargo test -p psikolog-core ozet`
Beklenen: `borc_ortak_ornekleri_saglar` "gelmedi odenmedi ucretli" satırında,
diğer iki test bekleyen/borçlular iddialarında FAIL.

- [ ] **Adım 4: Sorguları değiştir** (`ozet.rs`)

- `bekleyen_kurus` ifadesi:
  `CASE WHEN durum IN ('geldi','gelmedi') AND odendi = 0 AND ucret IS NOT NULL AND ucret > 0 THEN ucret END`
- `borclular` sorgusu: `WHERE a.durum IN ('geldi','gelmedi') AND a.odendi = 0 AND a.ucret IS NOT NULL AND a.ucret > 0`
- `seans_sayisi` ifadesi (`durum = 'geldi'`) **aynen kalır**.
- Modül başlığındaki "Sayım kuralları — sözleşme" maddelerini tasarım §5.1
  tablosuna göre yeniden yaz: gelmedi'nin neden borca girdiği (kullanıcı
  kararı 2026-09-25: terapist gelmeyen seansı ücretlendiriyor),
  `borclular[].seans_sayisi` = borca giren seans sayısı, `seans_sayisi`
  yalnızca geldi.

- [ ] **Adım 5: Yeşili gör** — `cargo test -p psikolog-core ozet` → PASS.

- [ ] **Adım 6: TS kuralını yaz** (`web/src/borc.test.ts` önce)

```ts
import { describe, expect, it } from 'vitest'
import ornekler from '../../core/src/store/borc_ornekleri.json'
import { borcaGirerMi, borcToplami } from './borc'

// Ortak örnekler: aynı dosyayı `ozet.rs::borc_ortak_ornekleri_saglar` de
// okuyor. Kuralı bir tarafta değiştirip dosyayı güncelleyen, öbür tarafın
// testini kırar.
describe('borcaGirerMi — sunucuyla ORTAK örnekler', () => {
  it('örnek dosyası tam (boş dosya döngüyü totolojik yapardı)', () => {
    expect(ornekler.length).toBeGreaterThanOrEqual(24)
  })
  for (const o of ornekler) {
    it(o.ad, () => {
      expect(borcaGirerMi({ durum: o.durum, odendi: o.odendi, ucret: o.ucret })).toBe(o.borca_girer)
    })
  }
  it('borcToplami yalnızca borca girenleri toplar', () => {
    const hepsi = ornekler.map((o) => ({ durum: o.durum, odendi: o.odendi, ucret: o.ucret }))
    const beklenen = ornekler.filter((o) => o.borca_girer).reduce((t, o) => t + (o.ucret ?? 0), 0)
    expect(beklenen).toBe(90000) // ön koşul: iki kol da (geldi, gelmedi) sayıldı
    expect(borcToplami(hepsi)).toBe(beklenen)
  })
})
```

Kırmızıyı gör (`npm --prefix web run test -- src/borc.test.ts`), sonra
`web/src/borc.ts`:

```ts
/**
 * Borç kuralı — arayüzdeki TEK kopya (tasarım §5.1).
 *
 * Bir seans borca girer ⇔ `geldi` ya da `gelmedi` ∧ ödenmemiş ∧ ücret > 0.
 * Terapist gelmeyen seansı ücretlendiriyor (kullanıcı kararı 2026-09-25);
 * iptal ve planlı seans borç değildir. Sunucudaki eşi
 * `core/src/store/ozet.rs`; ikisi `core/src/store/borc_ornekleri.json` ile
 * birbirine bağlı. Bakiye (`DosyaBilgileri`) ve dosya başlığı özeti (Plan B)
 * bu dosyadan başka bir kural YAZMAZ.
 */
export type BorcAlanlari = { durum: string; odendi: boolean; ucret: number | null }

export function borcaGirerMi(r: BorcAlanlari): boolean {
  return (r.durum === 'geldi' || r.durum === 'gelmedi') && !r.odendi && (r.ucret ?? 0) > 0
}

export function borcToplami(randevular: readonly BorcAlanlari[]): number {
  return randevular.reduce((t, r) => (borcaGirerMi(r) ? t + (r.ucret ?? 0) : t), 0)
}
```

- [ ] **Adım 7: Bakiye ve metinler**

`DosyaBilgileri.tsx`:
- `const bakiyeKurus = randevular.filter(...).reduce(...)` → `const bakiyeKurus = borcToplami(randevular)` (`import { borcToplami } from '../borc'`).
- Açıklama metni → `"Bakiye: ücreti girilmiş ve ödenmemiş, gelinen ya da gelinmeyen seanslar. İptal edilenler girmez."`
- "Bakiye neyi sayar" başlık yorumunu ve açıklamanın üstündeki JSX yorumunu
  yeni kurala göre yeniden yaz (gelmedi neden artık sayılıyor).

`AyOzeti.tsx`:
- `KAPSAM_CUMLESI` → `"Tahsilat, ödendi olarak işaretlenen bütün seansları içerir. Bekleyen ödemeye 'geldi' ve 'gelmedi' olarak işaretlenen, ödenmemiş seanslar girer; 'iptal' borç sayılmaz."`
- Borçlu satırı: `({b.seans_sayisi} seans)` → `({b.seans_sayisi} ödenmemiş seans)`.
- Başlık yorumu (satır 6-12) yeni kurala göre.

Testler:
- `DosyaBilgileri.test.tsx`: `planlanmis, iptal ve gelmedi durumlari bakiyeye GIRMEZ`
  → ikiye böl: `planlanmis ve iptal bakiyeye GIRMEZ` (gelmedi satırı çıkar,
  beklenti `0,00 TL`) ve **test 2.6**
  `gelmedi, ucretli ve odenmemis seans bakiyeye GIRER; ucretsizi girmez`
  (`gelmedi/45000` + `gelmedi/0` + `gelmedi/null` → `450,00 TL`).
  `bakiye NEYI SAYMADIGINI da soyler` → `/İptal edilenler girmez/`. Plan 4
  testindeki tam metin yeni cümleye; "EKSI YON" satırına eski cümlenin
  (`'Gelmedi' olarak işaretlenen seanslar bu sayıya girmez`) ekranda
  OLMADIĞI iddiasını ekle.
- `AyOzeti.test.tsx:244` → yeni `KAPSAM_CUMLESI` metni; borçlu satırı
  bekleyen testlerde `(1 seans)` → `(1 ödenmemiş seans)` (grep:
  `seans)` ile ara, hepsini çevir).
- `AnaEkran.test.tsx`:
  - Sahte `/api/ay-ozeti` (~2272): `ayseBorclu` hesabını
    `borcaGirerMi({ durum: sunucuDurumlari[202] ?? gelecekHafta.durum, odendi: sunucuOdemeleri[202] ?? gelecekHafta.odendi, ucret: 45000 })`
    ile değiştir (`import { borcaGirerMi } from '../borc'`); `seans_sayisi: 1`
    kalır.
  - ~2511 ve ~2707 `it.each` listelerindeki `['durum', … 'Gelmedi' …]` →
    `'İptal'` (iptal borçtan GERÇEKTEN düşürür; gelmedi artık düşürmez).
  - ~2671 `// Durum da bakiyeyi etkiler: "gelmedi" sayılmaz.` → `"iptal"
    sayılmaz`, tıklanan düğme `'İptal'`; pencere beklentisindeki son satır
    (`'PATCH /api/randevular/202'`) aynen kalır.
  - **Yeni test** (aynı describe'a, 2671 senaryosunun yanına):
    `takvimde "Gelmedi" isaretlenince kart bakiyesi DUSMEZ (gelmedi ucretlidir)`
    — `Gelmedi`'ye bas, `await bakiye()` hâlâ `BAKIYE_450`.
- `e2e/odeme.spec.ts`:
  - `KAPSAM_CUMLESI` kopyası yeni metne.
  - `gelmedi isaretlenen seans ne tahsilata ne borca girer` → adı
    `gelmedi isaretlenen ucretli seans BEKLEYENE girer, tahsilata girmez`.
    Beklentiler: `Gelinen seans` `0`, `Tahsilat` `0,00 TL`, `Bekleyen`
    `450,00 TL`, borçlu düğmesi `Devamsız Cem — 450,00 TL (1 ödenmemiş seans)`.
    ARTI YÖN kısmı "iptal edilince borçtan düşer" olur: `İptal` işaretle →
    `Bekleyen` `0,00 TL`, `Bu ay bekleyen ödeme yok.` görünür.
  - Dosyadaki bütün `(1 seans)` borçlu adlarını `(1 ödenmemiş seans)` yap.

- [ ] **Adım 8: Yeşili gör** — `npm --prefix web run test` PASS;
`npm --prefix web run build` PASS; `cargo test -p psikolog-core` PASS;
`npx playwright test e2e/odeme.spec.ts --reporter=line` PASS.

- [ ] **Adım 9: Commit**

```bash
git add core/src/store/borc_ornekleri.json core/src/store/ozet.rs web/src/borc.ts web/src/borc.test.ts web/src/danisan/DosyaBilgileri.tsx web/src/danisan/DosyaBilgileri.test.tsx web/src/ozet/AyOzeti.tsx web/src/ozet/AyOzeti.test.tsx web/src/screens/AnaEkran.test.tsx e2e/odeme.spec.ts
git commit -m "Gelmedi seans borca girer: tek kural, ortak orneklerle iki dil"
```

**Mutasyonlar:**
- `borcaGirerMi`'den `|| r.durum === 'gelmedi'`'yi sil → `borc.test.ts`
  gelmedi satırı VE AnaEkran "kart bakiyesi DUSMEZ" testi kırılmalı.
- `ozet.rs`'te `gelmedi`'yi yalnızca `bekleyen_kurus`'a ekle, `borclular`'dan
  çıkar → bağımsız hesap testindeki `bekleyen == borclular toplami` kırılmalı.
- `seans_sayisi` ifadesine `gelmedi` ekle → `seans_sayisi_yalnizca_geldi…`
  ve bağımsız hesap testi kırılmalı.
- `ucret > 0` koşulunu `borclular`'dan sil → ortak örneklerdeki "ucret 0"
  satırları kırılmalı.

---

### Görev 3: Yeni notlar Serbest açılır (A7)

**Dosyalar:**
- Değiştir: `core/src/store/notes.rs:116` (`VARSAYILAN_SABLON`), `:607` testi
- Değiştir: `server/tests/notlar_api.rs:596`
- Değiştir: `web/src/screens/AnaEkran.test.tsx:188` (sahte sunucunun varsayılanı)
- Değiştir: `web/src/seans/SeansPaneli.test.tsx` ya da `NotEditoru.test.tsx` (yeni web testi)

**Arayüzler:** yok (sabit değişikliği).

- [ ] **Adım 1: Testleri çevir**
  - `notes.rs::olmayan_not_bos_olarak_doner_hata_degil`:
    `assert_eq!(not.sablon, "serbest", "varsayilan sablon Serbest olmali (analitik calisma, tasarim A7)")`.
  - `notlar_api.rs::notu_olmayan_randevu_bos_not_dondurur_404_degil`:
    `assert_eq!(not["sablon"], "serbest", ...)`.
  - `AnaEkran.test.tsx:188`: `{ sablon: 'dap', icerik: '' }` → `{ sablon: 'serbest', icerik: '' }`.
  - Yeni web testi (`SeansPaneli.test.tsx`'in not yükleme desenini izle):
    sunucu `{ sablon: 'serbest', icerik: '' }` dönünce "Seans notu"
    alanının değeri `''` ve şablon seçicide seçili seçenek `Serbest`.

- [ ] **Adım 2: Kırmızıyı gör** — `cargo test -p psikolog-core olmayan_not` ve
`cargo test -p psikolog-server notu_olmayan` FAIL (web testi zaten geçebilir;
o, sahte sunucunun yeni değerine karşı editörün davranışını sabitler).

- [ ] **Adım 3: Sabiti değiştir**

```rust
/// Varsayılan şablon: henüz notu olmayan bir randevu **Serbest** (başlıksız)
/// açılır. Terapist analitik çalışıyor ve süreç notunu düz anlatı olarak
/// yazıyor; DAP başlıkları her notta silinmek zorunda kalıyordu (tasarım A7,
/// 2026-09-24). Şemadaki sütun varsayılanına dokunulmadı: kod şablonu her
/// zaman açıkça yazıyor, göç gerekmez. İçeriği boş, şablonu DAP olan eski
/// notlar DAP başlıklarıyla açılmaya devam eder.
pub const VARSAYILAN_SABLON: &str = "serbest";
```

- [ ] **Adım 4: Yeşili gör** — `npm --prefix web run build`, sonra
`cargo test --workspace` ve `npm --prefix web run test` PASS. `grep -rn "'dap'" web/src --include=*.tsx --include=*.ts | grep -v test`
ile arayüzde "yeni not DAP'tır" varsayan başka yer olmadığını doğrula
(yalnızca `sablon.ts` kapalı kümesi çıkmalı).

- [ ] **Adım 5: Commit**

```bash
git add core/src/store/notes.rs server/tests/notlar_api.rs web/src/screens/AnaEkran.test.tsx web/src/seans/SeansPaneli.test.tsx
git commit -m "Yeni seans notu Serbest sablonla acilir"
```

**Mutasyonlar:** `VARSAYILAN_SABLON` → `"dap"` → iki Rust testi kırılmalı.

---

### Görev 4: Açık tema, sabit yazı boyu, pencere boyutu (A8, A3'ün pencere kısmı)

**Dosyalar:**
- Değiştir: `web/src/index.css`
- Değiştir: `src-tauri/src/main.rs:43-50` ve aynı dosyanın test modülü
- Oluştur: `web/src/tema.test.ts`

**Arayüzler:** yok.

- [ ] **Adım 1: Yapısal testleri yaz**

`web/src/tema.test.ts` (Node `fs` ile CSS'i okur; bu proje yapısal testleri
dosyadan okuyarak yazıyor):

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Tasarım A8: koyu mod açık temaya sabitlendi. Bileşenler koyu zemine göre
// tasarlanmadığı için `prefers-color-scheme: dark` kök rengini değiştirip
// metinleri okunmaz bırakıyordu.
const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

describe('index.css — tema ve yazı boyu', () => {
  it('yalnızca açık renk şeması ilan edilir', () => {
    expect(css).toMatch(/color-scheme:\s*light\s*;/)
    expect(css).not.toMatch(/color-scheme:\s*light\s+dark/)
  })
  it('koyu mod medya sorgusu yok', () => {
    expect(css).not.toMatch(/prefers-color-scheme:\s*dark/)
  })
  it('temel yazı boyu tek değerde, dar pencerede küçülmüyor (A3)', () => {
    expect(css).not.toMatch(/max-width:\s*1024px/)
    expect(css).toMatch(/font:\s*1[67]px\/145%/)
  })
})
```

`src-tauri/src/main.rs` test modülüne:

```rust
    /// Tasarim A3/A8: pencere 1200x760 acilir, 1024x680'den kucuk olmaz ve
    /// macOS koyu modda bile ACIK temayla cizilir. Kabuk Rust tarafinda
    /// calistirilamadigi icin kaynak okunarak sabitleniyor.
    #[test]
    fn pencere_boyutu_ve_tema_sabit() {
        let kaynak = include_str!("main.rs");
        let kurucu = kaynak.split("#[cfg(test)]").next().unwrap();
        assert!(kurucu.contains(".inner_size(1200.0, 760.0)"), "varsayilan boyut");
        assert!(kurucu.contains(".min_inner_size(1024.0, 680.0)"), "asgari boyut");
        assert!(kurucu.contains(".theme(Some(tauri::Theme::Light))"), "acik tema");
    }
```

- [ ] **Adım 2: Kırmızıyı gör** — `npm --prefix web run test -- src/tema.test.ts`
ve `cargo test -p psikolog-tauri pencere_boyutu` FAIL.

- [ ] **Adım 3: Uygula**

`index.css`:

```css
:root {
  --text: #6b6375;
  --bg: #fff;

  --sans: system-ui, 'Segoe UI', Roboto, sans-serif;

  /* Tasarım A3: tek temel boy. 18px (Vite şablonundan kalma) haftayı
     1280x800'e sığdırmıyordu; dar pencerede yazıyı birden küçülten kural da
     kaldırıldı. 16 ile 17 arasındaki son karar Mac'te kullanıcının. */
  font: 16px/145% var(--sans);
  letter-spacing: 0.18px;
  /* Tasarım A8: yalnızca açık tema. Bileşenler koyu zemine göre
     tasarlanmadı; gerçek bir koyu tema ayrı bir iş. */
  color-scheme: light;
  color: var(--text);
  background: var(--bg);
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

(`@media (max-width: 1024px)` bloğu ve `@media (prefers-color-scheme: dark)`
bloğu silinir.)

`main.rs`:

```rust
            .title("Terapi Notlari")
            .inner_size(1200.0, 760.0)
            .min_inner_size(1024.0, 680.0)
            .theme(Some(tauri::Theme::Light))
            .build()?;
```

- [ ] **Adım 4: Yeşili gör** — iki test PASS; `cargo build -p psikolog-tauri`
derleniyor (Tauri 2.11.5'te `min_inner_size` ve `theme(Option<Theme>)` var).

- [ ] **Adım 5: Görsel kontrol** — dev sunucusunu tarayıcı panelinde aç
(`.claude/launch.json`'da yoksa `npm --prefix web run dev` için bir girdi
ekle), 1280×800'de 16px ve 17px ile iki ekran görüntüsü al; ikisini de
raporla, 16'da bırak (son karar kullanıcının, tasarım A3).

- [ ] **Adım 6: Commit**

```bash
git add web/src/index.css web/src/tema.test.ts src-tauri/src/main.rs
git commit -m "Acik temaya sabitle, yazi boyunu 16px yap, pencere 1200x760"
```

**Mutasyonlar:** `color-scheme: light dark` → CSS testi; `.min_inner_size`
satırını sil → Rust testi.

---

### Görev 5: Tek "şimdi" kaynağı ve tek araç çubuğu (A1, A2'nin temeli)

**Dosyalar:**
- Değiştir: `web/src/screens/anaEkranKancalari/yerelGun.ts` (`simdiYerel`, `useDakikalikSimdi`)
- Değiştir: `web/src/screens/anaEkranKancalari/useDanisanSeanslari.ts:135` (varsayılan `simdi`)
- Değiştir: `web/src/screens/anaEkranKancalari/useTakvimAkisi.ts` (açılış haftası, `haftayaGit`)
- Değiştir: `web/src/takvim/hafta.ts` (`GUN_TAM_ADLARI`)
- Değiştir: `web/src/takvim/TakvimSekmesi.tsx` (araç çubuğu)
- Değiştir: `web/src/takvim/HaftalikTakvim.tsx` (gezinme ve başlık ÇIKAR, `onHaftaDegis` prop'u kalkar)
- Değiştir: `web/src/takvim/HaftalikTakvim.test.tsx` (`hafta başlığını…`, `ileri ve geri gezinme…` testleri TakvimSekmesi'ne taşınır)
- Değiştir: `web/src/takvim/TakvimSekmesi.test.tsx` (`bosTakvim()`'e yeni alanlar; yeni testler)
- Değiştir: `e2e/takvim.spec.ts:178`, `e2e/odeme.spec.ts:165-170` (hafta başlığı seçicisi)
- Test: `web/src/screens/anaEkranKancalari/yerelGun.test.ts` (yoksa oluştur)

**Arayüzler:**
- Üretir (`yerelGun.ts`):
  - `export function simdiYerel(): string` — `yerelZaman(new Date())`
  - `export function useDakikalikSimdi(): string` — ilk değer `simdiYerel()`, her 60 sn'de yenilenir
- Üretir (`useTakvimAkisi` dönüşü): `haftayaGit(tarih: Date): void`
- Üretir (`hafta.ts`): `export const GUN_TAM_ADLARI = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar']`, `export function haftaIndeksi(tarih: Date): number` (`(getDay() + 6) % 7`)
- Değişir: `HaftalikTakvim` artık `onHaftaDegis` almaz; `simdi: string` alır (Görev 6'da kullanılır, bu görevde yalnızca geçirilir).
- DOM kancası: hafta başlığı `<h2 id="hafta-basligi">`.

- [ ] **Adım 1: Testleri yaz**

`yerelGun.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { simdiYerel, useDakikalikSimdi } from './yerelGun'

afterEach(() => vi.useRealTimers())

describe('tek şimdi kaynağı', () => {
  it('simdiYerel yerel duvar saatini 16 karakterle verir', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 24, 9, 5))
    expect(simdiYerel()).toBe('2026-09-24T09:05')
  })

  it('useDakikalikSimdi dakikada bir ilerler, gece yarısını geçer', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 8, 24, 23, 59))
    const { result } = renderHook(() => useDakikalikSimdi())
    expect(result.current).toBe('2026-09-24T23:59')
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(result.current).toBe('2026-09-25T00:00')
  })
})
```

`TakvimSekmesi.test.tsx`:
- `bosTakvim()`'e `haftayaGit: vi.fn()` ekle (sonraki görevler de buraya
  alan ekleyecek).
- Taşınan testler (HaftalikTakvim'den): hafta başlığı `7 – 13 Eylül 2026`
  `#hafta-basligi` içinde; `Sonraki hafta` → `takvim.haftaDegis(1)`,
  `Önceki hafta` → `haftaDegis(-1)`.
- Yeni: `Bugün` düğmesi `takvim.haftayaGit`'i bugünün tarihiyle çağırır
  (`vi.setSystemTime(new Date(2026, 8, 24, 10, 0))`, beklenen argüman
  `2026-09-24` yerel günü — `yerelGun(arg)` ile karşılaştır).
- Yeni: görünen hafta bu haftayken `Bugün` düğmesinin `aria-disabled`'ı
  `"true"` (soluk).
- Yeni: hafta başlığına tıklayınca `Gidilecek gün` etiketli tarih alanı
  açılır; `2026-10-15` girilince `haftayaGit` o günle çağrılır ve alan kapanır.

`useTakvimAkisi` için (var olan testlerin yanına ya da `AnaEkran.test.tsx`'in
takvim describe'ına): `haftayaGit(new Date(2026, 9, 15))` sonrası görünen
haftanın başı `12 Ekim 2026` (bir `randevulariGetir` isteği `2026-10-12T00:00`
ile gider).

- [ ] **Adım 2: Kırmızıyı gör** — `npm --prefix web run test` → yeni testler FAIL.

- [ ] **Adım 3: Uygula**

`yerelGun.ts` sonuna (import: `useEffect, useState` from `react`,
`yerelZaman` from `../../takvim/hafta`):

```ts
/**
 * Uygulamadaki TEK "şimdi" (tasarım A2). Takvimin açılış haftası, "Bugün",
 * bugün vurgusu, şimdi çizgisi, "sıradaki" ve danışan dosyasının varsayılan
 * seçimi bunu kullanır; ikinci bir saat kaynağı iki ekranın "şimdi"sini
 * testlerde ayrıştırırdı. Testler `vi.setSystemTime` ile sabitler.
 */
export function simdiYerel(): string {
  return yerelZaman(new Date())
}

/** `simdiYerel`'in dakikada bir yenilenen React durumu (tek tik). */
export function useDakikalikSimdi(): string {
  const [simdi, setSimdi] = useState(simdiYerel)
  useEffect(() => {
    const zamanlayici = setInterval(() => setSimdi(simdiYerel()), 60_000)
    return () => clearInterval(zamanlayici)
  }, [])
  return simdi
}
```

`useDanisanSeanslari.ts`: `simdi = () => yerelZaman(new Date())` →
`simdi = simdiYerel` (import). Yorumdaki "varsayılanı yerel duvar saati"
cümlesine "`yerelGun.ts::simdiYerel`, tek kaynak" ekle.

`useTakvimAkisi.ts`:

```ts
  const [haftaBasi, setHaftaBasi] = useState(() => haftaninBasi(zamandanDate(simdiYerel())))
  // ...
  // Mutlak gezinme: "Bugün" düğmesi ve gün seçici (tasarım A1). Göreli
  // `haftaDegis(±1)` yanında durur; ikisi de aynı state'i kurar.
  function haftayaGit(tarih: Date) {
    setHaftaBasi(haftaninBasi(tarih))
  }
```

ve dönüşe `haftayaGit`.

`TakvimSekmesi.tsx` üst satırı (eski `justify-end` div'inin yerine):

```tsx
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" aria-label="Önceki hafta" className="rounded border px-2 py-1"
          onClick={() => takvim.haftaDegis(-1)}>‹</button>
        <h2 id="hafta-basligi" className="text-lg font-semibold">
          <button type="button" aria-expanded={gunSecici} className="rounded px-1 hover:bg-slate-100"
            onClick={() => setGunSecici((a) => !a)}>
            {haftaBasligi(takvim.haftaBasi)}
          </button>
        </h2>
        <button type="button" aria-label="Sonraki hafta" className="rounded border px-2 py-1"
          onClick={() => takvim.haftaDegis(1)}>›</button>
        <button type="button" aria-disabled={buHafta} className={`rounded border px-3 py-1 ${buHafta ? 'text-slate-400' : ''}`}
          onClick={() => { if (!buHafta) takvim.haftayaGit(zamandanDate(simdi)) }}>
          Bugün
        </button>
        {gunSecici && (
          // Kullanıcının açtığı alan: odak burada verilir (açık eylem).
          <input type="date" aria-label="Gidilecek gün" autoFocus className="rounded border px-2 py-1"
            onChange={(e) => {
              if (e.target.value === '') return
              takvim.haftayaGit(zamandanDate(`${e.target.value}T00:00`))
              setGunSecici(false)
            }} />
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* HizliArama ve "Ay sonu özeti" — eski yerinden AYNEN taşındı. */}
        </div>
      </div>
```

Bileşen gövdesinde: `const simdi = useDakikalikSimdi()`,
`const [gunSecici, setGunSecici] = useState(false)`,
`const buHafta = haftaninBasi(zamandanDate(simdi)).getTime() === takvim.haftaBasi.getTime()`.
`HaftalikTakvim`'e `onHaftaDegis` yerine `simdi={simdi}` geçir.

`HaftalikTakvim.tsx`: üstteki gezinme `div`'ini (`Önceki hafta` / `<h2>` /
`Sonraki hafta`) sil, `onHaftaDegis` prop'unu `Props`'tan kaldır, `simdi:
string` ekle (bu görevde kullanılmıyor; Görev 6). `haftaBasligi` importu
artık `TakvimSekmesi`'nde.

e2e: `odeme.spec.ts::haftaIlerle` içindeki
`.getByRole('button', { name: 'Önceki hafta' }).locator('xpath=following-sibling::h2')`
→ `page.locator('#hafta-basligi')`; `takvim.spec.ts` `haftalar arasi gezinme`
testindeki `page.locator('h2').first()` → `page.locator('#hafta-basligi')`.
Oklar için `getByRole('button', { name: 'Sonraki hafta' })` aynen çalışır
(`aria-label`).

- [ ] **Adım 4: Yeşili gör** — `npm --prefix web run test`, `npm --prefix web run build`,
`npx playwright test e2e/takvim.spec.ts e2e/odeme.spec.ts --reporter=line` PASS.

- [ ] **Adım 5: Commit**

```bash
git add web/src/screens/anaEkranKancalari/yerelGun.ts web/src/screens/anaEkranKancalari/yerelGun.test.ts web/src/screens/anaEkranKancalari/useDanisanSeanslari.ts web/src/screens/anaEkranKancalari/useTakvimAkisi.ts web/src/takvim/hafta.ts web/src/takvim/TakvimSekmesi.tsx web/src/takvim/TakvimSekmesi.test.tsx web/src/takvim/HaftalikTakvim.tsx web/src/takvim/HaftalikTakvim.test.tsx e2e/takvim.spec.ts e2e/odeme.spec.ts
git commit -m "Takvim: tek arac cubugu, Bugun dugmesi, gun secici, tek simdi kaynagi"
```

**Mutasyonlar:** `buHafta` hesabını `false`'a sabitle → `aria-disabled`
testi; gün seçicinin `haftayaGit` çağrısını sil → seçici testi;
`setInterval` süresini 0'a değil **120_000**'e çıkar → gece yarısı testi.

---

### Görev 6: Bugün ve şimdi bir bakışta (A2)

**Dosyalar:**
- Oluştur: `web/src/takvim/bugun.ts`, `web/src/takvim/bugun.test.ts`
- Değiştir: `web/src/takvim/HaftalikTakvim.tsx` (bugün sütunu, şimdi çizgisi, boş hücre ipucu)
- Değiştir: `web/src/takvim/HaftalikTakvim.test.tsx`
- Değiştir: `web/src/takvim/TakvimSekmesi.tsx` (bilgi satırı), `TakvimSekmesi.test.tsx`

**Arayüzler:**
- Tüketir: `simdi` (Görev 5), `takvim.randevuSec` (Görev 10'da `{ kaydir: true }` seçeneği alacak; bu görevde tek argümanla çağrılır).
- Üretir (`bugun.ts`):
  - `export type BugunOzeti = { sayi: number; siradaki: Randevu | null }`
  - `export function bugunOzeti(randevular: readonly Randevu[], simdi: string): BugunOzeti`

- [ ] **Adım 1: Saf işlevin testleri** (`bugun.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import type { Randevu } from './HaftalikTakvim'
import { bugunOzeti } from './bugun'

function r(id: number, baslangic: string, durum = 'planlandi', ad = `D${id}`): Randevu {
  return { id, client_id: id, danisan_adi: ad, baslangic, bitis: baslangic.slice(0, 11) + '23:00',
    durum, ucret: null, odendi: false, seri_id: null }
}
const SIMDI = '2026-09-24T11:30'

describe('bugunOzeti (tasarım A2)', () => {
  it('iptal OLMAYAN bugünkü randevuları sayar; başka günleri saymaz', () => {
    const o = bugunOzeti([
      r(1, '2026-09-24T09:00', 'geldi'), r(2, '2026-09-24T10:00', 'iptal'),
      r(3, '2026-09-24T14:00'), r(4, '2026-09-24T16:00', 'gelmedi'), r(5, '2026-09-25T10:00'),
    ], SIMDI)
    expect(o.sayi).toBe(3)
  })
  it('sıradaki = bugün, planlandi, başlangıcı şimdiden SONRA olan en erken', () => {
    const o = bugunOzeti([r(3, '2026-09-24T16:00'), r(2, '2026-09-24T14:00'), r(1, '2026-09-24T11:00')], SIMDI)
    expect(o.siradaki?.id).toBe(2)
  })
  it('şu anda süren (başlamış) seans sıradaki değildir', () => {
    expect(bugunOzeti([r(1, '2026-09-24T11:30')], SIMDI).siradaki).toBeNull()
  })
  it('eşit başlangıçta küçük id', () => {
    expect(bugunOzeti([r(9, '2026-09-24T14:00'), r(4, '2026-09-24T14:00')], SIMDI).siradaki?.id).toBe(4)
  })
  it('yarınki randevu sıradaki değildir; bugün kalmadıysa null', () => {
    expect(bugunOzeti([r(1, '2026-09-25T09:00')], SIMDI).siradaki).toBeNull()
  })
  it('geldi işaretli ileri saatli randevu sıradaki değildir (yalnızca planlandi)', () => {
    expect(bugunOzeti([r(1, '2026-09-24T15:00', 'geldi')], SIMDI).siradaki).toBeNull()
  })
})
```

- [ ] **Adım 2: Kırmızı → `bugun.ts` → yeşil**

```ts
import type { Randevu } from './HaftalikTakvim'

/**
 * Bilgi satırının sayıları (tasarım A2). "Bugün N seans" = bugünün yerel
 * günündeki, iptal OLMAYAN randevular. "Sıradaki" = bugün, `planlandi`,
 * `baslangic > simdi` olan en erken (eşitlikte küçük id); süren seans
 * sıradaki değildir. Dizgiler duvar saati (16 karakter) olduğu için
 * sözlüksel karşılaştırma kronolojiktir.
 */
export type BugunOzeti = { sayi: number; siradaki: Randevu | null }

export function bugunOzeti(randevular: readonly Randevu[], simdi: string): BugunOzeti {
  const gun = simdi.slice(0, 10)
  const bugunku = randevular.filter((x) => x.baslangic.slice(0, 10) === gun && x.durum !== 'iptal')
  const adaylar = bugunku
    .filter((x) => x.durum === 'planlandi' && x.baslangic > simdi)
    .sort((a, b) => (a.baslangic === b.baslangic ? a.id - b.id : a.baslangic < b.baslangic ? -1 : 1))
  return { sayi: bugunku.length, siradaki: adaylar[0] ?? null }
}
```

- [ ] **Adım 3: Izgara testleri** (`HaftalikTakvim.test.tsx`; `kur()`'a `simdi: '2026-09-09T14:30'` varsayılanı ekle — 9 Eylül Çarşamba, görünen hafta 7–13 Eylül)

- **6.1** bugünün sütun başlığı `aria-current="date"` taşır; başka hiçbir başlık taşımaz.
- **6.2** şimdi çizgisi (`data-testid="simdi-cizgisi"`) tam bir tane, 9 Eylül 14:00 hücresinin içinde, `style.top` `50%`.
- **6.3** `simdi` görünen haftanın dışındaysa (`'2026-09-20T10:00'`) çizgi ve `aria-current` yok.
- **6.4** `simdi` 07:30 ya da 21:10 ise çizgi yok, `aria-current` var.
- Boş hücre düğmesinin görünür ipucu: boş hücrede `+ 14:00` metni (`aria-hidden="true"` span, `opacity-0 group-hover:opacity-100` — erişilebilir ad değişmez, `… 14:00 boş` aynen kalır).

`TakvimSekmesi.test.tsx`:
- **6.5 (inceleme odağı 3)** `vi.useFakeTimers({ toFake: ['Date','setInterval','clearInterval'] })`,
  `setSystemTime(2026-09-13 23:59)` (Pazar), takvim haftası 7 Eylül: bilgi satırı
  `Bugün seans yok`; `advanceTimersByTime(60_000)` sonrası `simdi` Pazartesi
  00:00 → görünen hafta artık "bu hafta" değil, bilgi satırı KALKAR ve `Bugün`
  düğmesi `aria-disabled="false"` olur.
- **6.6** bilgi satırı metni: randevular `[14:00 Ayşe Kaya planlandi, 09:00 X geldi, 10:00 Y iptal]`,
  şimdi 11:30 → `Bugün 2 seans · sıradaki 14:00 Ayşe Kaya`; ada tıklamak
  `takvim.randevuSec`'i o randevuyla çağırır.
- **6.7** sıradaki yoksa yalnızca `Bugün 2 seans`.

- [ ] **Adım 4: Uygula**

`HaftalikTakvim.tsx`:
- `const bugunGunu = simdi.slice(0, 10)`,
  `const simdiSaat = Number(simdi.slice(11, 13))`, `const simdiDakika = Number(simdi.slice(14, 16))`.
- Gün başlığı `th`: `const bugunMu = yerelZaman(g).slice(0, 10) === bugunGunu`;
  `aria-current={bugunMu ? 'date' : undefined}`; bugünse gün numarası
  `rounded-full bg-slate-900 px-2 text-white`, sütun hücreleri `bg-sky-50/60`.
- Hücre `td`'ye `relative` ekle; `bugunMu && saat === simdiSaat` ise hücrenin
  içine:

```tsx
<div aria-hidden="true" data-testid="simdi-cizgisi"
  className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-rose-500"
  style={{ top: `${(simdiDakika / 60) * 100}%` }} />
```

  (Saat `CALISMA_BASLANGIC..CALISMA_BITIS-1` dışındaysa hiçbir hücre eşleşmez →
  çizgi kendiliğinden yok.)
- Boş hücre düğmesi: `className="group h-full w-full text-left"` ve içine
  `<span aria-hidden="true" className="px-1 text-xs text-slate-400 opacity-0 group-hover:opacity-100">+ {saat:02}:00</span>`.

`TakvimSekmesi.tsx`, araç çubuğunun hemen altına:

```tsx
      {buHafta && (() => {
        const o = bugunOzeti(takvim.randevular, simdi)
        return (
          <p className="mb-3 text-sm text-slate-600" data-testid="bugun-bilgisi">
            {o.sayi === 0 ? 'Bugün seans yok' : `Bugün ${o.sayi} seans`}
            {o.siradaki && (
              <>
                {' · sıradaki '}
                <button type="button" className="underline"
                  onClick={() => takvim.randevuSec(o.siradaki as Randevu)}>
                  {o.siradaki.baslangic.slice(11, 16)} {o.siradaki.danisan_adi}
                </button>
              </>
            )}
          </p>
        )
      })()}
```

- [ ] **Adım 5: Yeşili gör** — `npm --prefix web run test`, `npm --prefix web run build` PASS.

- [ ] **Adım 6: Commit**

```bash
git add web/src/takvim/bugun.ts web/src/takvim/bugun.test.ts web/src/takvim/HaftalikTakvim.tsx web/src/takvim/HaftalikTakvim.test.tsx web/src/takvim/TakvimSekmesi.tsx web/src/takvim/TakvimSekmesi.test.tsx
git commit -m "Takvimde bugun vurgusu, simdi cizgisi ve bugunun bilgi satiri"
```

**Mutasyonlar:** `x.durum !== 'iptal'` → `true` (sayı testi); `x.baslangic > simdi`
→ `>=` (süren seans testi); `aria-current` koşulunu `true` yap (6.1).

---

### Görev 7: Hafta tek parça sığar (A3)

**Dosyalar:**
- Değiştir: `web/src/takvim/HaftalikTakvim.tsx` (satır yüksekliği ölçümü)
- Değiştir: `web/src/takvim/TakvimSekmesi.tsx` (ızgara + yeni randevu formu kapsayıcısı `flex-wrap`)
- Oluştur: `e2e/yerlesim.spec.ts`; Değiştir: `playwright.config.ts` (`SUNUCULAR`'a `{ ad: 'yerlesim', spec: 'yerlesim.spec.ts', port: 7707 }`)

**Arayüzler:** yok (yerleşim).

- [ ] **Adım 1: Ölçen e2e testi yaz** (`e2e/yerlesim.spec.ts`)

```ts
import { expect, test } from '@playwright/test'
import { kurulumYap } from './yardimcilar'

// Tasarım A3 kabul ölçütü: 1200x760 ve 1280x800'de gün başlığı ile 20:00
// satırının alt kenarı SAYFA KAYDIRILMADAN görünür. jsdom yerleşimi
// ölçemediği için bu tek bekçi gerçek tarayıcıdır.
for (const boyut of [{ width: 1200, height: 760 }, { width: 1280, height: 800 }]) {
  test(`hafta ${boyut.width}x${boyut.height} penceresine kaydırmadan sığar`, async ({ page }) => {
    await page.setViewportSize(boyut)
    await kurulumYap(page)
    const sonSatir = page.locator('tbody tr').last()
    await expect(sonSatir).toBeVisible()
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    const kutu = await sonSatir.boundingBox()
    expect(kutu).not.toBeNull()
    expect((kutu?.y ?? 0) + (kutu?.height ?? 0)).toBeLessThanOrEqual(boyut.height)
    const baslik = await page.locator('thead').boundingBox()
    expect(baslik?.y ?? -1).toBeGreaterThanOrEqual(0)
  })
}

test('1024x680de satirlar 36 pikselden kisa olmaz; sayfa kaymasi kabul', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 })
  await kurulumYap(page)
  const kutu = await page.locator('tbody tr').first().boundingBox()
  expect(kutu?.height ?? 0).toBeGreaterThanOrEqual(36)
})

test('1024 genisliginde yeni randevu formu izgaranin altina iner, sikismaz', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 680 })
  await kurulumYap(page)
  await page.locator('button[aria-label$="10:00 boş"]').first().click()
  const form = page.getByRole('heading', { name: 'Yeni randevu' }).locator('xpath=ancestor::aside')
  const izgara = page.getByTestId('takvim-izgara')
  const f = await form.boundingBox()
  const i = await izgara.boundingBox()
  expect(f?.width ?? 0).toBeGreaterThanOrEqual(300)
  expect(f?.y ?? 0).toBeGreaterThan((i?.y ?? 0) + (i?.height ?? 0) - 1)
})
```

- [ ] **Adım 2: Kırmızıyı gör** — `npx playwright test e2e/yerlesim.spec.ts --reporter=line` FAIL (satırlar `h-10`, 13 × 40 + başlıklar pencereyi aşıyor; form sıkışıyor).

- [ ] **Adım 3: Uygula**

`HaftalikTakvim.tsx`:

```tsx
  // Tasarım A3: satır yüksekliği pencereden türetilir, en az 36px.
  // max(36, (pencere yüksekliği − tbody'nin üst kenarı − alt boşluk) / satır sayısı)
  const tbodyRef = useRef<HTMLTableSectionElement>(null)
  const [satirYuksekligi, setSatirYuksekligi] = useState(40)
  useLayoutEffect(() => {
    function olc() {
      const ust = tbodyRef.current?.getBoundingClientRect().top ?? 0
      const kalan = window.innerHeight - ust - 16
      setSatirYuksekligi(Math.max(36, Math.floor(kalan / saatler.length)))
    }
    olc()
    window.addEventListener('resize', olc)
    return () => window.removeEventListener('resize', olc)
  }, [saatler.length, gizliRandevular.length > 0])
```

  `<tbody ref={tbodyRef}>`; `td`'deki `h-10` sınıfını kaldır,
  `style={{ height: satirYuksekligi }}` ver. Dış kaptaki `p-4` → `p-2`.
  (Ölçüm `window.scrollY === 0`'da doğru; sayfa kaymışken `top` negatif
  olabilir → `Math.max(36, …)` alt sınırı korur.)

`TakvimSekmesi.tsx`: ızgara + form kapsayıcısı
`className="flex items-start gap-4"` → `"flex flex-wrap items-start gap-4"`;
ızgara kabı `className="flex-1"` → `"min-w-0 flex-1 basis-[720px]"`;
`RandevuPaneli` (yeni randevu) `shrink-0`.

- [ ] **Adım 4: Yeşili gör** — `npx playwright test e2e/yerlesim.spec.ts --reporter=line` PASS; `npm --prefix web run test` PASS.

- [ ] **Adım 5: Commit**

```bash
git add web/src/takvim/HaftalikTakvim.tsx web/src/takvim/TakvimSekmesi.tsx e2e/yerlesim.spec.ts playwright.config.ts
git commit -m "Haftalik takvim pencereye kaydirmadan sigar"
```

**Mutasyonlar:** `Math.max(36, …)` → `Math.max(80, …)` → 1200×760 testi;
`flex-wrap`'i kaldır → form genişliği testi.

---

### Görev 8: Randevu formu — tarih, saat, süre, özet, yeniden eşitleme (A4 arayüz)

**Dosyalar:**
- Değiştir: `web/src/takvim/RandevuPaneli.tsx`
- Değiştir: `web/src/takvim/RandevuPaneli.test.tsx`
- Değiştir: `web/src/takvim/RandevuBloku.tsx`, `web/src/takvim/HaftalikTakvim.test.tsx`
- Değiştir: `web/src/screens/AnaEkran.test.tsx:960-984` (başlangıç metni artık seans paneli başlığından okunur)

**Arayüzler:**
- Tüketir: `GUN_TAM_ADLARI`, `haftaIndeksi`, `AYLAR` (`hafta.ts`), `ucretOku` (Görev 1).
- Üretir (`hafta.ts`): `export function okunurAralik(baslangic: string, bitis: string): string` → `"Perşembe, 24 Eylül · 14:00–14:50"`.
- Üretir (`RandevuPaneli` prop'u): `gomulu?: boolean` — Görev 10'da seans bölümünde `true`; `Kapat` düğmesini gizler, `aside`'ın `border-l` sınıfını kaldırır.

- [ ] **Adım 1: Testleri yaz** (`RandevuPaneli.test.tsx`)

```ts
  it('8.1: yeni randevu tıklanan hücreyle dolu açılır; 10:30 seçilebilir', async () => {
    const props = kur({ zaman: '2026-09-07T10:00' })
    expect((screen.getByLabelText('Tarih') as HTMLInputElement).value).toBe('2026-09-07')
    expect((screen.getByLabelText('Başlangıç') as HTMLInputElement).value).toBe('10:00')
    fireEvent.change(screen.getByLabelText('Başlangıç'), { target: { value: '10:30' } })
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(props.onKaydet).toHaveBeenCalledWith(
      expect.objectContaining({ baslangic: '2026-09-07T10:30', bitis: '2026-09-07T11:30' }))
  })

  it('8.2: hazır süre düğmeleri süreyi kurar; alan 5 dakika adımlı', async () => {
    const props = kur()
    expect(screen.getByLabelText('Süre (dakika)').getAttribute('step')).toBe('5')
    await userEvent.click(screen.getByRole('button', { name: '50 dk' }))
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(props.onKaydet).toHaveBeenCalledWith(expect.objectContaining({ bitis: '2026-09-07T14:50' }))
  })

  it('8.3: okunur özet', () => {
    kur({ randevu: mevcut })
    expect(screen.getByText('Pazartesi, 7 Eylül · 14:00–15:00')).toBeDefined()
  })

  it('8.4: var olan randevuyu başka güne taşımak AYNI kaydı günceller', async () => {
    const props = kur({ randevu: mevcut })
    fireEvent.change(screen.getByLabelText('Tarih'), { target: { value: '2026-09-10' } })
    await userEvent.click(screen.getByRole('button', { name: 'Güncelle' }))
    expect(props.onKaydet).toHaveBeenCalledWith(expect.objectContaining({
      baslangic: '2026-09-10T14:00', bitis: '2026-09-10T15:00', client_id: 1 }))
  })

  it('8.5: tarih ya da saat boşsa kaydetmez', async () => {
    const props = kur({ randevu: mevcut })
    fireEvent.change(screen.getByLabelText('Tarih'), { target: { value: '' } })
    await userEvent.click(screen.getByRole('button', { name: 'Güncelle' }))
    expect(screen.getByText('Tarih ve başlangıç saatini girin.')).toBeDefined()
    expect(props.onKaydet).not.toHaveBeenCalled()
  })

  it('8.6: tarih alanı kartın penceresiyle sınırlı (2000–2099)', () => {
    kur()
    const alan = screen.getByLabelText('Tarih')
    expect(alan.getAttribute('min')).toBe('2000-01-01')
    expect(alan.getAttribute('max')).toBe('2099-12-31')
  })

  it('8.7: tarih/saat değişince çakışma kontrolü YENİ aralık ve randevunun kendi id si ile sorulur', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const props = kur({ randevu: mevcut })
    fireEvent.change(screen.getByLabelText('Başlangıç'), { target: { value: '16:00' } })
    await act(async () => { vi.advanceTimersByTime(400) })
    expect(props.cakismaKontrol).toHaveBeenLastCalledWith('2026-09-07T16:00', '2026-09-07T17:00', 7, undefined)
    vi.useRealTimers()
  })

  it('8.8: seri üyesinde "Yalnızca bu randevu taşınır." yazar', () => {
    kur({ randevu: { ...mevcut, seri_id: 's1' } })
    expect(screen.getByText('Yalnızca bu randevu taşınır.')).toBeDefined()
  })

```

`kur()` yardımcısını `rerender`'ı da döndürecek şekilde genişlet
(`const r = render(...); return { ...props, rerender: (y) => r.rerender(<RandevuPaneli {...props} {...y} />) }`)
ve 8.9'u tamamla:

```ts
  it('8.9: kirli değilken prop değişince form sunucudaki yeni değerle eşitlenir', () => {
    const p = kur({ randevu: mevcut })
    p.rerender({ randevu: { ...mevcut, baslangic: '2026-09-07T16:00', bitis: '2026-09-07T17:00', ucret: 50000 } })
    expect((screen.getByLabelText('Başlangıç') as HTMLInputElement).value).toBe('16:00')
    expect((screen.getByLabelText('Ücret (TL)') as HTMLInputElement).value).toBe('500,00')
  })

  it('8.10: kullanıcı alanı değiştirdiyse prop değişimi yazdığını EZMEZ', () => {
    const p = kur({ randevu: mevcut })
    fireEvent.change(screen.getByLabelText('Ücret (TL)'), { target: { value: '600' } })
    p.rerender({ randevu: { ...mevcut, ucret: 50000 } })
    expect((screen.getByLabelText('Ücret (TL)') as HTMLInputElement).value).toBe('600')
  })

  it('8.11: gomulu kipte Kapat düğmesi yok', () => {
    kur({ randevu: mevcut, gomulu: true })
    expect(screen.queryByRole('button', { name: 'Kapat' })).toBeNull()
  })
```

`HaftalikTakvim.test.tsx`:
- **8.12** `baslangic: '2026-09-07T10:50'` olan randevunun bloğunun erişilebilir
  adı `10:50 Ayşe Yılmaz`; tam saatteki bloğun adı yalnızca `Ayşe Yılmaz`
  (var olan e2e seçicileri tam saat kullanıyor, bozulmaz).

`AnaEkran.test.tsx:960-984` (`yeniden yükleme, panelin elindeki randevuyu TAZELER`):
`/2026-09-07 10:00/` → `/7 Eylül 2026, 10:00/`, `/2026-09-07 11:00/` →
`/7 Eylül 2026, 11:00/` (seans panelinin başlığı `zamanMetni`).

- [ ] **Adım 2: Kırmızıyı gör** — `npm --prefix web run test` → yeni testler FAIL.

- [ ] **Adım 3: `hafta.ts`'e ekle**

```ts
export const GUN_TAM_ADLARI = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']

export function haftaIndeksi(tarih: Date): number {
  return (tarih.getDay() + 6) % 7
}

/** `"2026-09-24T14:00"`, `"2026-09-24T14:50"` → `"Perşembe, 24 Eylül · 14:00–14:50"`. */
export function okunurAralik(baslangic: string, bitis: string): string {
  const d = zamandanDate(baslangic)
  return `${GUN_TAM_ADLARI[haftaIndeksi(d)]}, ${d.getDate()} ${AYLAR[d.getMonth()]} · ` +
    `${baslangic.slice(11, 16)}–${bitis.slice(11, 16)}`
}
```

- [ ] **Adım 4: `RandevuPaneli`'yi değiştir**

- State: `const ilk = randevu?.baslangic ?? zaman`;
  `const [tarih, setTarih] = useState(ilk.slice(0, 10))`,
  `const [saat, setSaat] = useState(ilk.slice(11, 16))`;
  `const baslangic = `${tarih}T${saat}``; `const zamanTamam = tarih.length === 10 && saat.length === 5`.
  `bitis = zamanTamam ? bitisHesapla(baslangic, sureDk) : baslangic`.
  Çakışma efekti `zamanTamam` değilken istek atmaz (`if (!zamanTamam) return`
  efektin başında).
- **Yeniden eşitleme** (8.9/8.10): son eşitlenen değerler bir ref'te
  (`esas = { tarih, saat, sureDk, ucretTl, clientId }`). Efekt
  `[randevu?.baslangic, randevu?.bitis, randevu?.ucret, randevu?.client_id]`
  değişince: form değerleri `esas`'a eşitse (kullanıcı dokunmamış) yeni
  prop'tan kurulur ve `esas` güncellenir; değilse hiçbir şey yapılmaz. Yorum:
  "Görev 10'dan sonra panel Güncelle'de kapanmıyor; aynı kimlikle gelen taze
  kayıt formu bayat bırakmasın, ama kullanıcının yazdığını da ezmesin."
- Özet satırı: eski `<p>{baslangic.replace('T', ' ')} – {bitis.slice(11)}</p>`
  yerine `{zamanTamam && <p className="mt-1 text-sm text-slate-600">{okunurAralik(baslangic, bitis)}</p>}`.
- Danışan seçiminden sonra:

```tsx
      <div className="mt-3 flex gap-2">
        <div className="flex-1">
          <label className="block text-sm" htmlFor="tarih">Tarih</label>
          <input id="tarih" type="date" min="2000-01-01" max="2099-12-31"
            className="mt-1 w-full rounded border p-2" value={tarih}
            onChange={(e) => setTarih(e.target.value)} />
        </div>
        <div className="w-28">
          <label className="block text-sm" htmlFor="baslangic">Başlangıç</label>
          <input id="baslangic" type="time" step={300}
            className="mt-1 w-full rounded border p-2" value={saat}
            onChange={(e) => setSaat(e.target.value)} />
        </div>
      </div>
      {randevu?.seri_id && (
        <p className="mt-1 text-xs text-slate-500">Yalnızca bu randevu taşınır.</p>
      )}
```

- Süre: `min={5} step={5}`; altına
  `{[45, 50, 60, 90].map((dk) => <button key={dk} type="button" aria-pressed={sureDk === dk} className="rounded border px-2 py-0.5 text-xs" onClick={() => setSureDk(dk)}>{dk} dk</button>)}`.
- `kaydet()`'in başına (danışan kontrolünden sonra):
  `if (!zamanTamam) { setHata('Tarih ve başlangıç saatini girin.'); return }`.
- `gomulu` prop'u: `true` iken `Kapat` düğmesi render edilmez ve `aside`
  sınıfı `w-80 shrink-0 bg-white p-4` olur (kenarlık yok).
- Seri silme onayındaki `randevu.baslangic` (kesme) **kaydedilmiş** değer
  olarak kalır — formdaki yazılmamış tarih DEĞİL (tasarım A4).

`RandevuBloku.tsx`: `{randevu.baslangic.slice(14, 16) !== '00' && <span className="mr-1 tabular-nums">{randevu.baslangic.slice(11, 16)}</span>}{randevu.danisan_adi}`.

- [ ] **Adım 5: Yeşili gör** — `npm --prefix web run test`, `npm --prefix web run build`,
`npx playwright test --reporter=line` PASS.

- [ ] **Adım 6: Commit**

```bash
git add web/src/takvim/hafta.ts web/src/takvim/RandevuPaneli.tsx web/src/takvim/RandevuPaneli.test.tsx web/src/takvim/RandevuBloku.tsx web/src/takvim/HaftalikTakvim.test.tsx web/src/screens/AnaEkran.test.tsx
git commit -m "Randevu formu: tarih ve baslangic alani, hazir sureler, okunur ozet"
```

**Mutasyonlar:** çakışma efektinin bağımlılığından `baslangic`'i çıkar → 8.7;
yeniden eşitlemede "kirli mi" kontrolünü kaldır (hep eşitle) → 8.10; süre
alanının `step`'ini `15`'e geri al → 8.2; `RandevuBloku`'daki dakika koşulunu
kaldır (her blok saat taşısın) → 8.12'nin tam saat yarısı.

---

### Görev 9: Taşınan "geldi" seansı son temasını ilerletir; seri zamana göredir (A4 sunucu)

**Dosyalar:**
- Değiştir: `core/src/store/appointments.rs` (`guncelle` ~544-600; yeni `GuncellemeSonucu`; testler)
- Değiştir: `server/src/routes/appointments.rs` (`guncelle` handler ~169-183)
- Değiştir: `server/tests/takvim_api.rs` (yanıt şekli testleri)
- Değiştir: `web/src/api.ts` (`randevuGuncelle` dönüş tipi `GuncellemeYaniti`)
- Değiştir: `web/src/screens/anaEkranKancalari/useTakvimAkisi.ts` (`kaydet` yanıtı döndürür)
- Değiştir: `web/src/screens/AnaEkran.tsx` (`randevuKaydet` son temas yayılımı)
- Değiştir: `web/src/screens/AnaEkran.yayilim.test.tsx` (yayılım testi)
- Değiştir: `web/src/takvim/TakvimSekmesi.test.tsx` (`bosTakvim().kaydet` dönüşü)

**Arayüzler:**
- Üretir (Rust):
  - `pub struct GuncellemeSonucu { pub randevu: Randevu, pub son_temas: Option<SonTemasSonucu> }`
  - `pub fn guncelle_ve_son_temas(conn, id, yeni: &RandevuGuncelleme, cihaz) -> Result<GuncellemeSonucu, DepoHatasi>`
  - `guncelle` imzası değişmez: `guncelle_ve_son_temas(...).map(|s| s.randevu)` (38 test çağrısı dokunulmadan kalır).
- Üretir (HTTP): `PUT /api/randevular/{id}` yanıtı = `Randevu` alanları + isteğe bağlı `son_temas` ve `saklama_bitis` (ikisi birlikte ya var ya yok; `client_id` zaten `Randevu`'da).
- Üretir (TS): `export type GuncellemeYaniti = Randevu & { son_temas?: string; saklama_bitis?: string }`; `useTakvimAkisi.kaydet(...)` → `Promise<GuncellemeYaniti | null>` (yeni kayıtta `null`).

- [ ] **Adım 1: Çekirdek testleri yaz** (`appointments.rs` test modülü)

```rust
    #[test]
    fn geldi_seansi_ileri_tasininca_son_temas_ilerler() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).unwrap();
        let s = guncelle_ve_son_temas(
            &c, r.id, &guncelleme(cid, "2026-09-10T14:00", "2026-09-10T15:00", Some(45000)), Cihaz::Masaustu,
        ).unwrap();
        assert_eq!(s.randevu.durum, "geldi", "tasima durumu korur");
        let st = s.son_temas.expect("ileri tasima son temasi degistirmeli");
        assert_eq!(st.son_temas, "2026-09-10");
        assert_eq!(danisanin_son_temasi(&c, cid).0.as_deref(), Some("2026-09-10"));
    }

    #[test]
    fn geldi_seansi_geri_tasininca_son_temas_gerilemez() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-10T14:00", "2026-09-10T15:00"), Cihaz::Masaustu).unwrap();
        durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).unwrap();
        let s = guncelle_ve_son_temas(
            &c, r.id, &guncelleme(cid, "2026-09-07T14:00", "2026-09-07T15:00", Some(45000)), Cihaz::Masaustu,
        ).unwrap();
        assert!(s.son_temas.is_none(), "geriye tasima degismeyen alan bildirmemeli");
        assert_eq!(danisanin_son_temasi(&c, cid).0.as_deref(), Some("2026-09-10"));
    }

    #[test]
    fn planli_seansi_tasimak_son_temasa_dokunmaz() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        let s = guncelle_ve_son_temas(
            &c, r.id, &guncelleme(cid, "2026-09-10T14:00", "2026-09-10T15:00", Some(45000)), Cihaz::Masaustu,
        ).unwrap();
        assert!(s.son_temas.is_none());
        assert_eq!(danisanin_son_temasi(&c, cid).0, None, "planli seans temas degildir");
    }

    #[test]
    fn tasima_tek_log_satiri_yazar() {
        // "geldi" seansi tasimak tek bir kullanici eylemi: bir Duzenleme
        // satiri. Son temas tazelemesi ek satir YAZMAZ (durum_guncelle ile ayni).
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).unwrap();
        let sayi = |c: &rusqlite::Connection| -> i64 {
            c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap()
        };
        let once = sayi(&c);
        let s = guncelle_ve_son_temas(
            &c, r.id, &guncelleme(cid, "2026-09-10T14:00", "2026-09-10T15:00", Some(45000)), Cihaz::Masaustu,
        ).unwrap();
        assert!(s.son_temas.is_some(), "on kosul: son temas gercekten ilerledi");
        assert_eq!(sayi(&c) - once, 1);
    }

    #[test]
    fn tasima_notu_ozel_notu_etiketi_ve_odemeyi_korur() {
        use crate::store::{notes, tags};
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        notes::not_kaydet(&c, r.id, "serbest", "Seans notu metni", Cihaz::Masaustu).unwrap();
        notes::ozel_not_kaydet(&c, r.id, "Ozel not metni", Cihaz::Masaustu).unwrap();
        tags::etiket_ekle(&c, r.id, "ruya", Cihaz::Masaustu).unwrap();
        odeme_guncelle(&c, r.id, true, Cihaz::Masaustu).unwrap();

        let s = guncelle_ve_son_temas(
            &c, r.id, &guncelleme(cid, "2026-09-12T10:30", "2026-09-12T11:20", Some(45000)), Cihaz::Masaustu,
        ).unwrap();

        assert_eq!(s.randevu.id, r.id, "tasima ayni kaydi gunceller");
        assert!(s.randevu.odendi, "odeme isareti korunur");
        assert_eq!(notes::not_getir(&c, r.id, Cihaz::Masaustu).unwrap().icerik, "Seans notu metni");
        assert_eq!(notes::ozel_not_getir(&c, r.id, Cihaz::Masaustu).unwrap().icerik, "Ozel not metni");
        let etiketler: Vec<String> =
            tags::seans_etiketleri(&c, r.id, Cihaz::Masaustu).unwrap().into_iter().map(|e| e.ad).collect();
        assert_eq!(etiketler, vec!["ruya".to_string()]);
    }

    /// Seri islemleri ZAMANA gore (tasarim A4): kesme noktasindan sonra
    /// baslayan her uye -- tasinmis olsa bile -- silinir.
    #[test]
    fn seri_silme_zamana_gore_ileri_tasinmis_uye_kesmeden_sonraysa_silinir() {
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), 4, Cihaz::Masaustu)
            .unwrap();
        let seri_id = seri[0].seri_id.clone().unwrap();
        guncelle(&c, seri[1].id, &guncelleme(cid, "2026-10-05T14:00", "2026-10-05T15:00", Some(45000)), Cihaz::Masaustu)
            .unwrap();
        assert_eq!(seri_sayisi(&c, &seri_id, "2026-09-21T14:00").unwrap(), 3);
        assert_eq!(seriyi_sil(&c, &seri_id, "2026-09-21T14:00", Cihaz::Masaustu).unwrap(), 3);
        let kalan = aralik_getir(&c, "2026-09-01T00:00", "2026-11-01T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(kalan.iter().map(|r| r.id).collect::<Vec<_>>(), vec![seri[0].id]);
    }

    #[test]
    fn seri_silme_zamana_gore_geri_tasinmis_uye_kesmeden_onceyse_korunur() {
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), 4, Cihaz::Masaustu)
            .unwrap();
        let seri_id = seri[0].seri_id.clone().unwrap();
        guncelle(&c, seri[3].id, &guncelleme(cid, "2026-09-01T14:00", "2026-09-01T15:00", Some(45000)), Cihaz::Masaustu)
            .unwrap();
        // 14 Eylul'den itibaren: 14 ve 21 Eylul silinir; 7 Eylul ve 1 Eylul'e
        // tasinmis uye KALIR.
        assert_eq!(seri_sayisi(&c, &seri_id, "2026-09-14T14:00").unwrap(), 2);
        assert_eq!(seriyi_sil(&c, &seri_id, "2026-09-14T14:00", Cihaz::Masaustu).unwrap(), 2);
        let mut kalan: Vec<i64> = aralik_getir(&c, "2026-08-01T00:00", "2026-11-01T00:00", Cihaz::Masaustu)
            .unwrap().into_iter().map(|r| r.id).collect();
        kalan.sort_unstable();
        let mut beklenen = vec![seri[0].id, seri[3].id];
        beklenen.sort_unstable();
        assert_eq!(kalan, beklenen);
    }
```

(`seri_sayisi`/`seriyi_sil`'in kesmeyi `baslangic >= bu_tarihten_itibaren`
ile yaptığını modülde doğrula; farklıysa beklenen sayıları o kurala göre
düzelt ve nedenini rapora yaz. `etiket_ekle` resmî not şartı arıyorsa not
kaydı zaten önce yapılıyor.)

- [ ] **Adım 2: Kırmızıyı gör** — `cargo test -p psikolog-core appointments` → derleme hatası (`guncelle_ve_son_temas` yok).

- [ ] **Adım 3: Uygula** (`appointments.rs`)

```rust
/// `guncelle`'nin tam sonucu: guncellenen kayit ve -- kayit "geldi" ise ve
/// tasima son temasi GERCEKTEN ilerlettiyse -- yeni son temas (tasarim A4).
pub struct GuncellemeSonucu {
    pub randevu: Randevu,
    pub son_temas: Option<SonTemasSonucu>,
}
```

`guncelle`'nin gövdesini `guncelle_ve_son_temas`'a taşı; `kaydet(…Duzenleme…)`
satırından sonra, `commit`'ten önce:

```rust
    let durum: String =
        tx.query_row("SELECT durum FROM appointments WHERE id = ?1", [id], |r| r.get(0))?;
    // Tasarim A4 (kullanici karari 2026-09-25): isaretlenmis seanslar da
    // tasinabilir. "geldi" seansi tasininca son temas `durum_guncelle` ile
    // AYNI islevden gecer: yalnizca ileri gider, ayri log satiri yazmaz.
    let son_temas = if durum == "geldi" { son_temasi_isaretle(&tx, id)? } else { None };
```

ve `Ok(GuncellemeSonucu { randevu, son_temas })`. `guncelle`:

```rust
pub fn guncelle(conn: &Connection, id: i64, yeni: &RandevuGuncelleme, cihaz: Cihaz) -> Result<Randevu, DepoHatasi> {
    guncelle_ve_son_temas(conn, id, yeni, cihaz).map(|s| s.randevu)
}
```

`guncelle`'nin doküman yorumundaki "Seri davranışı" bölümüne "seri işlemleri
zamana göredir; taşınmış üye yeni tarihine göre dahil/hariç kalır" paragrafı
ve iki testin adı eklenir.

- [ ] **Adım 4: Yeşili gör** — `cargo test -p psikolog-core` PASS.

- [ ] **Adım 5: Sunucu yanıtı** — önce `server/tests/takvim_api.rs`'e test:
`geldi` randevuyu PUT ile ileri taşı → yanıt `son_temas` ve `saklama_bitis`
taşır, `id`/`baslangic` yenidir; planlı randevuyu taşı → yanıtta bu iki anahtar
**yoktur** (`yanit.get("son_temas").is_none()`). Kırmızı → handler:

```rust
#[derive(Serialize)]
pub struct GuncellemeYaniti {
    #[serde(flatten)]
    pub randevu: Randevu,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub son_temas: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saklama_bitis: Option<String>,
}
```

(`Randevu`'nun `Serialize` türettiğini doğrula.) Handler
`depo_guncelle` yerine `guncelle_ve_son_temas`'ı çağırır ve
`GuncellemeYaniti { randevu: s.randevu, son_temas: s.son_temas.as_ref().map(|t| t.son_temas.clone()), saklama_bitis: s.son_temas.map(|t| t.saklama_bitis) }`
döner. Doküman yorumuna `durum` handler'ındaki Plan 7 gerekçesine atıf.
`cargo test -p psikolog-server` PASS (var olan PUT testleri şekil değişmediği
için yeşil kalmalı — kalmazsa neden kırıldığını raporla).

- [ ] **Adım 6: İstemci yayılımı** — önce test
(`AnaEkran.yayilim.test.tsx`, var olan "Geldi işaretleme saklama uyarısını
tazeler" testinin yanında): sahte PUT yanıtı `son_temas`/`saklama_bitis`
taşıyınca açık dosyanın saklama alanı yeni tarihi gösterir ve Ayarlar'daki
saklama listesi danışanı düşürür; `GET /api/danisanlar/1` ve saklama listesi
isteği **atılmaz**. Kırmızı → uygula:

`api.ts`:

```ts
/** `PUT /api/randevular/{id}` yanıtı: kayıt + (taşınan "geldi" seansı son
 * temas GERÇEKTEN ilerlettiyse) yeni son temas. İki alan birlikte gelir. */
export type GuncellemeYaniti = Randevu & { son_temas?: string; saklama_bitis?: string }
```

`randevuGuncelle` dönüş tipi `istek<GuncellemeYaniti>`.

`useTakvimAkisi.kaydet`: PUT dalında `const yanit = await takvimApi.randevuGuncelle(...)`
ve fonksiyon sonunda `return yanit`; POST dalında `return null`. (Panelin
kapanması ve yeniden yükleme bu görevde DEĞİŞMEZ — Görev 10.)

`AnaEkran.randevuKaydet`:

```ts
    const yanit = await takvim.kaydet(kayit)
    // ... var olan dört satır ...
    // Tasarım A4: taşınan "geldi" seansı son temas ilerlettiyse kart ve
    // saklama listesi YEREL yamanır (`durumDegis` ile aynı gerekçe: ikisi de
    // `HerCagri`, yeniden çekilmez).
    if (yanit && yanit.son_temas !== undefined && yanit.saklama_bitis !== undefined) {
      dosya.dosyaAlanlariniYama(yanit.client_id, {
        son_temas: yanit.son_temas,
        saklama_bitis: yanit.saklama_bitis,
      })
      liste.saklamaDolandanDus(yanit.client_id, yanit.saklama_bitis)
    }
```

`TakvimSekmesi.test.tsx::bosTakvim()`: `kaydet: vi.fn(async () => null)`.

- [ ] **Adım 7: Yeşili gör** — `npm --prefix web run build`, `npm --prefix web run test`, `cargo test --workspace` PASS.

- [ ] **Adım 8: Commit**

```bash
git add core/src/store/appointments.rs server/src/routes/appointments.rs server/tests/takvim_api.rs web/src/api.ts web/src/screens/anaEkranKancalari/useTakvimAkisi.ts web/src/screens/AnaEkran.tsx web/src/screens/AnaEkran.yayilim.test.tsx web/src/takvim/TakvimSekmesi.test.tsx
git commit -m "Tasinan geldi seansi son temasi ilerletir; seri islemleri zamana gore"
```

**Mutasyonlar:** `if durum == "geldi"` → `if false` → ileri taşıma testi ve
sunucu yanıt testi; `son_temasi_isaretle` yerine `son_temasi_tazele`'yi koşulsuz
çağır (gerilemeye izin) → geri taşıma testi; `AnaEkran`'daki yama bloğunu sil
→ yayılım testi.

---

### Görev 10: Seans bölümü, Güncelle akışı ve kaydırma (A6)

**Dosyalar:**
- Değiştir: `web/src/screens/anaEkranKancalari/useTakvimAkisi.ts` (`randevuSec` seçeneği, kaydırma isteği, hafta koruması, `kaydet` Güncelle dalı)
- Değiştir: `web/src/screens/anaEkranKancalari/useSeansNotlari.ts:~165` (özel notu koru)
- Değiştir: `web/src/takvim/TakvimSekmesi.tsx` (seans bölümü yerleşimi, kaydırma)
- Değiştir: `web/src/seans/SeansPaneli.tsx` (`Takvime dön`)
- Değiştir: `web/src/index.css` (yumuşak kaydırma)
- Değiştir: `web/src/test-kurulum.ts` (`scrollIntoView` casusu)
- Değiştir: `web/src/screens/AnaEkran.test.tsx`, `web/src/takvim/TakvimSekmesi.test.tsx`, `web/src/seans/SeansPaneli.test.tsx`
- Değiştir: `e2e/takvim.spec.ts` (Güncelle testi (b) adımı; yeni taşıma senaryosu)

**Arayüzler:**
- Değişir: `randevuSec(randevu: Randevu, secenek?: { kaydir?: boolean }): void`
- Üretir: `kaydirmaIstegi: number | null`, `kaydirmaTamam(): void` (hook dönüşü)
- `bosTakvim()` mock'una: `kaydirmaIstegi: null, kaydirmaTamam: vi.fn()`.

- [ ] **Adım 1: Testleri yaz**

`test-kurulum.ts` sonuna:

```ts
// jsdom `scrollIntoView` uygulamıyor. Tasarım A6'nın kaydırması bu casusla
// SAYILIR (tıklamada 1, sekme dönüşünde/tazelemede 0).
Element.prototype.scrollIntoView = function scrollIntoView() {}
```

Testlerde `const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')`.

`AnaEkran.test.tsx` (takvim describe'ı, var olan sahte sunucuyla; PUT
`/api/randevular/{id}` yanıtı gövdedeki alanlarla birleştirilmiş kaydı
döndürecek şekilde genişletilir):
- **10.1** ızgarada randevuya tıklamak `scrollIntoView`'ı **1** kez çağırır;
  Danışanlar sekmesine gidip Takvim'e dönmek sayıyı **artırmaz**; "Geldi" ve
  "Ödendi" işaretlemek artırmaz.
- **10.2 (inceleme odağı 2)** randevuyu formdaki Tarih ile bir sonraki haftaya
  taşı → `Güncelle` → `#hafta-basligi` yeni haftayı gösterir, `Seans` bölümü
  açık, başlığında yeni tarih (`zamanMetni`), `Randevu` başlığı açık.
- **10.3 (inceleme odağı 2)** hafta koruması: `Sonraki hafta`'ya bas, ilk GET
  bekletilirken `Sonraki hafta`'ya tekrar bas; ikinci GET önce, birinci sonra
  dönsün (sahte fetch'e iki `Promise` kapısı). Izgara ikinci haftanın
  randevularını gösterir; geç dönen birinci hafta listesi yazılmaz.
- **10.4 (inceleme odağı 1)** "Seans notu" alanına `Yarım kalan cümle` yaz
  (kayıt gecikmesi dolmadan), sonra aynı randevuyu formdan başka güne taşı →
  editör aynı DOM düğümü (`toBe` ile önceki `getByLabelText` sonucu), değeri
  hâlâ `Yarım kalan cümle`.
- **10.5** "Özel Notlarım" sekmesi açıkken taşıma → özel not metni görünür
  kalır, `Özel not yükleniyor…` metni YOK, `GET …/ozel-not` sayısı artmaz;
  geçmiş notlar isteği yeni `once` değeriyle gider.
- **10.6** Güncelle sonrası form açık ve kaydedilen değerleri gösterir;
  yeni randevu "Kaydet" formu kapatır (var olan davranış).
- Var olan `yeniden yükleme, panelin elindeki randevuyu TAZELER` ve
  `… artık gelmiyorsa panel kapanır` testleri yeşil KALMALI.

`TakvimSekmesi.test.tsx`:
- **10.7** DOM sırası: `takvim-izgara` → `seans-bolumu` → ay özeti bölgesi
  (`compareDocumentPosition`); var olan randevu seçiliyken `Randevu`
  başlıklı form `seans-bolumu`'nun İÇİNDE, boş saat seçiliyken `Yeni randevu`
  formu ızgaranın YANINDA (`seans-bolumu` yok).
- **10.8** `kaydirmaIstegi` seçili randevunun id'siyse `scrollIntoView` bir kez
  çağrılır ve `kaydirmaTamam` çağrılır; `null`'sa çağrılmaz.
- **10.9** `Takvime dön` `takvim-izgara`'yı görünür alana kaydırır.

`e2e/takvim.spec.ts`:
- Var olan Güncelle testinin (b) adımında paneli yeniden açmadan önce
  `Seansı kapat`'a bas (bileşen yeniden monte olsun, değer sunucudan okunsun).
- **10.10** yeni test `randevu silinmeden baska gune tasinir, notu onunla gider`:
  danışan ekle; 10:00 boş hücresine tıkla; Başlangıç `10:30`; Kaydet; bloğu
  (`10:30 <ad>`) aç; "Seans notu"na `Tasima oncesi not` yaz ve kaydedildiğini
  bekle; Tarih'i ertesi güne çevir; Güncelle; blok ertesi günün sütununda;
  seans panelinde not metni `Tasima oncesi not`; ızgarada bu adla tek blok.

- [ ] **Adım 2: Kırmızıyı gör** — `npm --prefix web run test` → yeni testler FAIL.

- [ ] **Adım 3: `useTakvimAkisi`'yi değiştir**

```ts
  const [kaydirmaIstegi, setKaydirmaIstegi] = useState<number | null>(null)
  // Hafta koruması (tasarım A6): yanıt, istek anındaki hafta HÂLÂ görünen
  // haftaysa yazılır. Ref render'da tazelenir; efekt yeni hafta için
  // `yukle`'yi çağırmadan önce ref zaten yenidir.
  const gorunenHafta = useRef(haftaBasi.getTime())
  gorunenHafta.current = haftaBasi.getTime()
```

`yukle` içinde, `await`'ten önce `const istenen = haftaBasi.getTime()`,
`await`'ten hemen sonra `if (gorunenHafta.current !== istenen) return`
(catch dalında da: 401 temizliği HER durumda yapılır, `setHata` yalnızca
hafta hâlâ görünense).

```ts
  function randevuSec(randevu: Randevu, secenek?: { kaydir?: boolean }) {
    setSeciliBosSaat(null)
    setSeciliRandevu(randevu)
    // Kaydırma YALNIZCA kullanıcı seçiminde (tasarım A6); istek burada, sekme
    // yeniden monte olunca tekrar çalışmasın diye bileşenin DIŞINDA tutulur.
    if (secenek?.kaydir) setKaydirmaIstegi(randevu.id)
  }

  function kaydirmaTamam() {
    setKaydirmaIstegi(null)
  }
```

`kaydet`'in PUT dalı:

```ts
      if (seciliRandevu) {
        const yanit = await takvimApi.randevuGuncelle(seciliRandevu.id, {
          client_id: kayit.client_id, baslangic: kayit.baslangic, bitis: kayit.bitis, ucret: kayit.ucret,
        })
        setHata(null)
        // Tasarım A6: Güncelle seans bölümünü KAPATMAZ. Seçim yanıttaki taze
        // kayıtla yamanır (kimlik aynı: not/özel not efektleri yeniden
        // koşmaz, editör yeniden monte edilmez).
        const { son_temas: _st, saklama_bitis: _sb, ...randevu } = yanit
        setSeciliRandevu(randevu)
        const yeniHafta = haftaninBasi(zamandanDate(randevu.baslangic))
        if (yeniHafta.getTime() !== haftaBasi.getTime()) {
          // Başka haftaya taşındı: eski kapanıştaki `yukle` ÇAĞRILMAZ, yeni
          // haftayı efekt yükler; seçim listede bulunduğu için korunur.
          setHaftaBasi(yeniHafta)
        } else {
          await yukle()
        }
        return yanit
      }
      await takvimApi.randevuOlustur(kayit)
      setHata(null)
      panelKapat()
      await yukle()
      return null
```

(`_st`/`_sb` adları oxlint'in kullanılmayan değişken kuralına takılırsa
`const randevu: Randevu = { id: yanit.id, … }` ile açıkça kur.) Dönüşe
`kaydirmaIstegi`, `kaydirmaTamam`.

- [ ] **Adım 4: `useSeansNotlari`'nda özel notu koru**

Ana efektin başarı dalındaki `setSeansVerisi({ … ozelNot: null, ozelHata: null … })`
→ işlevsel güncelleme:

```ts
        setSeansVerisi((onceki) => ({
          id: seansId,
          not: notSaati.uygula([gelenNot], okumaDamgasi)[0] ?? gelenNot,
          // Tasarım A6: AYNI seansın başlangıcı değişince (taşıma) özel not
          // sıfırlanmaz — özel not efekti başlangıca bağlı değil ve yeniden
          // koşmaz; sıfırlansaydı sekme "Özel not yükleniyor…"da kalırdı.
          ozelNot: onceki.id === seansId ? onceki.ozelNot : null,
          ozelHata: onceki.id === seansId ? onceki.ozelHata : null,
          gecmisNotlar: gelenGecmis,
          hata: null,
        }))
```

(Resmî not taşımada bir kez daha okunur; not okuması `OturumBasi(5 dk)` ile
birleşir, yeni denetim satırı düşmez — tasarım A6.)

- [ ] **Adım 5: Yerleşim** (`TakvimSekmesi.tsx`)

- Izgaranın yanındaki `RandevuPaneli` yalnızca `seciliBosSaat !== null` iken.
- `HaftalikTakvim`'e `onRandevuSec={(r) => takvim.randevuSec(r, { kaydir: true })}`;
  Görev 6'daki "sıradaki" bağlantısı da `{ kaydir: true }`.
- Izgaranın altına, ay özetinden ÖNCE:

```tsx
      {seciliRandevu !== null && (
        <section ref={seansBolumuRef} id="seans-bolumu" data-testid="seans-bolumu"
          aria-label="Seans" className="mt-4 flex scroll-mt-2 flex-wrap items-start gap-4">
          <RandevuPaneli gomulu key={`randevu-${seciliRandevu.id}`} zaman={seciliRandevu.baslangic}
            randevu={seciliRandevu} /* diğer proplar eskisi gibi */ />
          <div className="min-w-0 flex-1 basis-[480px]">
            {/* SeansPaneli (ya da hata kutusu) — eski yerinden AYNEN taşındı */}
          </div>
        </section>
      )}
```

- Kaydırma efekti:

```tsx
  const seansBolumuRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (takvim.kaydirmaIstegi === null) return
    if (seciliRandevu?.id !== takvim.kaydirmaIstegi) return
    seansBolumuRef.current?.scrollIntoView({ block: 'start' })
    takvim.kaydirmaTamam()
  }, [takvim.kaydirmaIstegi, seciliRandevu?.id])
```

`index.css` sonuna:

```css
/* Tasarım A6: randevuya tıklayınca seans bölümüne yumuşak kaydırma;
   hareketi azaltma tercihinde animasyonsuz. */
@media (prefers-reduced-motion: no-preference) {
  html { scroll-behavior: smooth; }
}
```

`SeansPaneli.tsx` başlığına, `Seansı kapat`'ın soluna:

```tsx
        <button type="button" className="text-sm underline"
          onClick={() => document.querySelector('[data-testid="takvim-izgara"]')?.scrollIntoView({ block: 'start' })}>
          Takvime dön
        </button>
```

(Seans paneli danışan dosyasında da kullanılıyorsa `takvimeDon?: () => void`
prop'u olarak ver ve yalnızca Takvim sekmesi geçirsin — `DanisanDosyasi`'nda
bu düğme görünmemeli; `grep -n "<SeansPaneli" web/src` ile kontrol et.)

- [ ] **Adım 6: Yeşili gör** — `npm --prefix web run test`, `npm --prefix web run build`,
`npx playwright test --reporter=line` PASS.

- [ ] **Adım 7: Commit**

```bash
git add web/src/screens/anaEkranKancalari/useTakvimAkisi.ts web/src/screens/anaEkranKancalari/useSeansNotlari.ts web/src/takvim/TakvimSekmesi.tsx web/src/seans/SeansPaneli.tsx web/src/index.css web/src/test-kurulum.ts web/src/screens/AnaEkran.test.tsx web/src/takvim/TakvimSekmesi.test.tsx web/src/seans/SeansPaneli.test.tsx e2e/takvim.spec.ts
git commit -m "Seans bolumu: form ve not birlikte, Guncelle kapatmaz, tiklayinca kaydirir"
```

**Mutasyonlar:**
- Hafta korumasını (`if (gorunenHafta.current !== istenen) return`) sil → 10.3.
- `setHaftaBasi(yeniHafta)` yerine `await yukle()` (eski davranış) → 10.2.
- `ozelNot: onceki.id === seansId ? onceki.ozelNot : null` → `null` → 10.5.
- `TakvimSekmesi`'ndeki kaydırma efektinden `takvim.kaydirmaTamam()` çağrısını
  sil (istek tüketilmez) → 10.1'in "sekme dönüşünde artmaz" yarısı kırılmalı.
- `SeansPaneli`'nin `key`'ini `seans-${seciliRandevu.id}-${seciliRandevu.baslangic}`
  yap (taşımada yeniden monte) → 10.4 kırılmalı.

---

### Görev 11: Uçtan uca doğrulama ve görsel kontrol

**Dosyalar:** yalnızca gerekirse düzeltme.

- [ ] **Adım 1:** `npm --prefix web run build` → hata yok. `npm --prefix web run lint`.
- [ ] **Adım 2:** `npm --prefix web run test` → sayıları yaz (önceki: 952).
- [ ] **Adım 3:** PowerShell + cargo PATH öneki: `cargo test --workspace` ve
  `cargo clippy --workspace --all-targets -- -D warnings` → temiz.
- [ ] **Adım 4:** `npx playwright test --reporter=line` → sonuç. Bilinen
  kararsızlık (tasarım "zaten bilinenler") yüzünden düşen varsa aynı testi
  tek başına 3 kez koş; bu planın dokunduğu bir akışta düşüyorsa kararsızlık
  deme, kök nedeni bul.
- [ ] **Adım 5: Tarayıcı panelinde ekran görüntüleri** (e2e sunucusu ya da
  dev sunucusu): 1200×760, 1280×800, 1024×680'de Takvim sekmesi; bir randevu
  seçili hâlde seans bölümü; 16px/17px karşılaştırması. Görüntüleri rapora
  ekle.
- [ ] **Adım 6:** Tasarım belgesi §7'deki doğrulama listesinin Plan A'ya düşen
  her maddesini işaretle; karşılanmayan varsa göreve geri dön.
- [ ] **Adım 7: Kullanıcıya bırakılacaklar** (rapora yaz): Mac'te tarih/saat
  seçicilerin görünüşü, yumuşak kaydırma, 16/17px kararı; ücret düzeltmesi
  sonrası geçmiş ay özetlerinde tuhaf derecede küçük tutarlara bakılması;
  ücret alınmamış eski "gelmedi" seanslarının ücretinin 0 yapılması.
