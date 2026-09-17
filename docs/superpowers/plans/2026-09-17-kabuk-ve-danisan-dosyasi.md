# Üç sekmeli kabuk ve danışan dosyası — uygulama planı

> **Ajan çalışanlar için:** GEREKLİ ALT BECERİ: Bu planı görev görev uygulamak
> için `superpowers:subagent-driven-development` (önerilen) ya da
> `superpowers:executing-plans` kullanın. Adımlar takip için onay kutusu
> (`- [ ]`) sözdizimiyle yazılmıştır.

**Amaç:** Uygulamayı açınca takvim görünsün, danışana tıklayınca o danışanın
bütün seans geçmişi ve notları okunabilsin, yönetim/KVKK işleri aradığında
bulacağın yere çekilsin.

**Mimari:** Ana ekran bugün tek bir dikey yığın. Üç sekmeli bir kabuğa
bölünüyor (Takvim · Danışanlar · Ayarlar). Veri akışları zaten
`screens/anaEkranKancalari/` altındaki altı kancada ayrılmış durumda;
kancalara **dokunulmuyor**, yalnızca hangi sekmenin hangi kancayı render
ettiği değişiyor. Tek yeni sunucu ucu, danışanın seans listesidir.

**Teknoloji:** React 19 + TypeScript + Tailwind 4 + Vitest (web), Axum +
rusqlite/SQLCipher + `cargo test` (sunucu/çekirdek), Playwright (e2e).

**Tasarım belgesi:** `docs/superpowers/specs/2026-09-17-odak-takvim-ve-notlar-design.md`

## Genel kısıtlar

Her görevin gereksinimleri bunları da kapsar:

- Tüm kod, yorum, commit mesajı ve arayüz metni **Türkçe**.
- Sunucu yalnızca `127.0.0.1` dinler (`YEREL_ADRES`); `0.0.0.0` asla.
- Her rota handler'ının **ilk satırı** `guard::acik_baglanti`'dir ve handler
  başına tam olarak bir kez geçer. Gövde çözümlemesi kapıdan **sonra**
  (`guard::govde_coz` / `guard::Sorgu<T>`).
- Rota modülleri `audit::kaydet` **çağırmaz**; hacim kararını çekirdek verir.
- `audit_log`'a **not içeriği, not başlığı, şablon adı, dosya adı, arama
  terimi, etiket adı** yazılmaz. `audit_log` üzerinde `UPDATE`/`DELETE` yok.
- Özel notlar (`private_notes`) ayrı tabloda kalır. Bu planda eklenen hiçbir
  dosya `ozelNotApi`'yi ya da `store::notes::ozel_*`'ı çağırmaz.
- Zaman duvar saati (`YYYY-AA-GGTSS:DD`, 16 karakter), para tam sayı kuruş.
- Para ekrana yalnızca `web/src/para.ts::tlMetni` ile yazılır.
- Yeni npm paketi eklenmez.
- Windows'ta `cargo` şu PATH önekiyle çağrılır:
  `C:\StrawberryPerl\perl\bin;C:\Users\axres\AppData\Local\bin\NASM`
- `cargo test --workspace` öncesi `npm --prefix web run build` gerekir
  (`rust_embed`).
- Mutasyonu geri alırken `git checkout --` kullanılır, dosya kopyalanmaz
  (Windows'ta `Copy-Item` mtime'ı koruyor, cargo mutasyonlu derlemeyi
  kullanabiliyor).

## Her görevin bitiş ölçütü

Bir görev, yazdığı testler **kendi korumasını kırarak** kanıtlanmadan bitmiş
sayılmaz. Her görevin son adımı bir **mutasyon turudur**: korumayı üretim
kodunda bilerek boz, testin kırmızıya döndüğünü gör, `git checkout --` ile
geri al, yeşili doğrula. Kırmızıya dönmeyen test yeniden yazılır.
`docs/test-yesil-ama-korumuyor.md` bu projede bulunmuş on üç "yeşil ama
korumuyor" biçimini listeler; test yazmadan önce okuyun.

## Dosya yapısı

**Yeni:**

| Dosya | Sorumluluk |
|---|---|
| `web/src/kabuk/Sekmeler.tsx` | Erişilebilir sekme şeridi (`tablist`), seçili sekme dışarıdan verilir |
| `web/src/kabuk/sekme.ts` | `SekmeKodu` kapalı kümesi ve adları |
| `web/src/ayarlar/AyarlarSekmesi.tsx` | Yedekleme, parola, depolama, saklama süresi |
| `web/src/takvim/TakvimSekmesi.tsx` | Takvim, randevu paneli, seans paneli, ay özeti düğmesi |
| `web/src/danisan/DanisanlarSekmesi.tsx` | Solda liste, sağda dosya |
| `web/src/danisan/DanisanDosyasi.tsx` | Dosyanın Seanslar/Bilgiler alt sekmeleri |
| `web/src/danisan/SeansListesi.tsx` | Sol kolon: danışanın seansları |
| `web/src/danisan/DosyaBilgileri.tsx` | Bilgiler alt sekmesi (eski `DanisanKarti` içeriği) |
| `web/src/screens/anaEkranKancalari/useDanisanSeanslari.ts` | Seçili danışanın seans listesi akışı |
| `core/src/store/danisan_seanslari.rs` | `danisan_seanslari(conn, client_id, cihaz)` |
| `server/src/routes/danisan_seanslari.rs` | `GET /api/danisanlar/{id}/seanslar` |

**Değişen:**

| Dosya | Değişiklik |
|---|---|
| `web/src/screens/AnaEkran.tsx` | Yığın yerine sekme kabuğu; kancalar aynı kalır |
| `web/src/danisan/DanisanKarti.tsx` | İçeriği `DosyaBilgileri`'ne taşınır, dosya silinir |
| `web/src/ozet/AyOzeti.tsx` | Kutu değil, panel; açıklama paragrafı içine taşınır |
| `web/src/api.ts` | `danisanApi.seanslar` |
| `core/src/store/mod.rs`, `server/src/routes/mod.rs`, `server/src/lib.rs` | Yeni modül ve rota |
| `playwright.config.ts`, `e2e/` | Yeni spec ve portu |

---

### Görev 1: Sekme kabuğu

**Dosyalar:**
- Oluştur: `web/src/kabuk/sekme.ts`
- Oluştur: `web/src/kabuk/Sekmeler.tsx`
- Test: `web/src/kabuk/Sekmeler.test.tsx`

**Arayüzler:**
- Üretir: `SekmeKodu = 'takvim' | 'danisanlar' | 'ayarlar'`, `SEKME_ADLARI`,
  `SEKME_KODLARI`, `<Sekmeler secili onSecim />`.
- Tüketir: yok.

- [ ] **Adım 1: Kapalı kümeyi yaz**

`web/src/kabuk/sekme.ts`:

```ts
/**
 * Sekme kodları — **kapalı** küme.
 *
 * Şerit `SEKME_KODLARI`'ndan türetilir; ikinci bir elle yazılmış liste yok.
 * Yeni bir sekme eklemek `SEKME_ADLARI`'na bir satır eklemektir ve şerit
 * kendiliğinden büyür (bkz. `sablon.ts`'teki aynı desen).
 */
export type SekmeKodu = 'takvim' | 'danisanlar' | 'ayarlar'

export const SEKME_ADLARI: Record<SekmeKodu, string> = {
  takvim: 'Takvim',
  danisanlar: 'Danışanlar',
  ayarlar: 'Ayarlar',
}

export const SEKME_KODLARI = Object.keys(SEKME_ADLARI) as SekmeKodu[]

/** Açılış sekmesi. Uygulamanın amacı bu; ilk görülen şey takvim olmalı. */
export const ACILIS_SEKMESI: SekmeKodu = 'takvim'
```

- [ ] **Adım 2: Başarısız testi yaz**

`web/src/kabuk/Sekmeler.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Sekmeler } from './Sekmeler'
import { SEKME_KODLARI } from './sekme'

describe('Sekmeler', () => {
  it('her sekme kodu için bir sekme çizer', () => {
    render(<Sekmeler secili="takvim" onSecim={() => {}} />)
    expect(screen.getAllByRole('tab')).toHaveLength(SEKME_KODLARI.length)
  })

  it('yalnızca seçili sekme aria-selected taşır', () => {
    render(<Sekmeler secili="danisanlar" onSecim={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Danışanlar' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Takvim' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })

  it('tıklanan sekmenin kodunu bildirir', async () => {
    const onSecim = vi.fn()
    render(<Sekmeler secili="takvim" onSecim={onSecim} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Ayarlar' }))
    expect(onSecim).toHaveBeenCalledWith('ayarlar')
  })

  it('uyarı noktası yalnızca istenen sekmede ve metinle birlikte çıkar', () => {
    render(<Sekmeler secili="takvim" onSecim={() => {}} uyaran="ayarlar" />)
    const ayarlar = screen.getByRole('tab', { name: /Ayarlar/ })
    // Nokta GÖRSEL; sekmenin erişilebilir adı uyarıyı SÖZLE de taşımalı,
    // yoksa ekran okuyucu kullanan biri için uyarı hiç yok demektir.
    expect(ayarlar).toHaveAccessibleName(/ilgilenilmesi gereken/i)
    expect(
      screen.getByRole('tab', { name: 'Takvim' }),
    ).not.toHaveAccessibleName(/ilgilenilmesi gereken/i)
  })
})
```

- [ ] **Adım 3: Testin başarısız olduğunu gör**

Çalıştır: `npm --prefix web run test -- Sekmeler`
Beklenen: FAIL — `Sekmeler` dosyası yok.

- [ ] **Adım 4: Bileşeni yaz**

`web/src/kabuk/Sekmeler.tsx`:

```tsx
import { SEKME_ADLARI, SEKME_KODLARI, type SekmeKodu } from './sekme'

/**
 * Sekme şeridi. Seçili sekmeyi TUTMAZ, yalnızca çizer ve bildirir: seçim
 * `AnaEkran`'da, çünkü sekme değişimi başka akışları da (açık danışan
 * dosyası) etkiliyor.
 *
 * `uyaran`: başlığında küçük bir uyarı noktası çıkacak sekme. Tasarım §4:
 * hiç yedek alınmamışsa bu bir sarı kutu olarak ana ekranı işgal etmez,
 * Ayarlar sekmesinde bir nokta olarak durur. Nokta görsel olduğu için
 * erişilebilir ad da uyarıyı kelimeyle taşır.
 */
export function Sekmeler({
  secili,
  onSecim,
  uyaran,
}: {
  secili: SekmeKodu
  onSecim: (sekme: SekmeKodu) => void
  uyaran?: SekmeKodu
}) {
  return (
    <div role="tablist" aria-label="Bölümler" className="flex gap-1">
      {SEKME_KODLARI.map((kod) => {
        const aktif = kod === secili
        const uyari = kod === uyaran
        return (
          <button
            key={kod}
            role="tab"
            type="button"
            id={`sekme-${kod}`}
            aria-selected={aktif}
            aria-controls={`sekme-panel-${kod}`}
            aria-label={
              uyari
                ? `${SEKME_ADLARI[kod]} — ilgilenilmesi gereken bir şey var`
                : undefined
            }
            onClick={() => onSecim(kod)}
            className={`rounded-t border-b-2 px-4 py-2 text-sm ${
              aktif
                ? 'border-slate-900 font-semibold text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {SEKME_ADLARI[kod]}
            {uyari && (
              <span
                aria-hidden="true"
                className="ml-1 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle"
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Adım 5: Testin geçtiğini gör**

Çalıştır: `npm --prefix web run test -- Sekmeler`
Beklenen: PASS (4 test).

- [ ] **Adım 6: Mutasyon turu**

Sırayla üçünü uygula, her birinde testi çalıştır, sonra `git checkout --`:

1. `aria-selected={aktif}` → `aria-selected={true}` — "yalnızca seçili
   sekme" testi kırmızıya dönmeli.
2. `onClick={() => onSecim(kod)}` → `onClick={() => onSecim('takvim')}` —
   "tıklanan sekmenin kodunu bildirir" kırmızıya dönmeli.
3. `aria-label` koşulundaki `uyari ? … : undefined` → her zaman `undefined`
   — "uyarı noktası" testi kırmızıya dönmeli.

Üçü de kırmızıya dönmüyorsa test yeniden yazılır.

- [ ] **Adım 7: Commit**

```bash
git add web/src/kabuk
git commit -m "Sekme seridi: kapali kume, erisilebilir tablist, uyari noktasi"
```

---

### Görev 2: Ayarlar sekmesi

**Dosyalar:**
- Oluştur: `web/src/ayarlar/AyarlarSekmesi.tsx`
- Değiştir: `web/src/screens/AnaEkran.tsx` (yedekleme, parola, depolama,
  saklama bölümlerini kes ve yeni bileşene taşı)
- Test: `web/src/ayarlar/AyarlarSekmesi.test.tsx`

**Arayüzler:**
- Tüketir: `useYedekleme()`, `useParolaFormu()`, `useDanisanListesi()`'nin
  `saklamaUyarisi` alanı, `useDanisanDosyasi()`'nin depolama durumu — hepsi
  `AnaEkran`'da çağrılıp prop olarak geçirilir. Kancalar **taşınmaz**;
  `AnaEkran`'da kalır, çünkü 401 temizliği iki yönlü ve orada bağlanıyor.
- Üretir: `<AyarlarSekmesi yedekleme parola saklama depolama onGeriYukle />`.

- [ ] **Adım 1: Taşınacak bloğu belirle**

`web/src/screens/AnaEkran.tsx` içinde şu dört bölüm birebir taşınacak
(sırasıyla, JSX'in kendisi değişmeden — yalnızca prop kaynakları
parametreleşecek):

1. SAKLAMA HATIRLATMASI yorumuyla başlayan `<section>`
2. DEPOLAMA UYARISI yorumuyla başlayan blok
3. YEDEKLEME yorumuyla başlayan `<section>`
4. PAROLA yorumuyla başlayan `<section>`

Bu blokların içindeki açıklayıcı yorumlar (özellikle yedeklemenin
"KALICI UYARI" ve "iki gerçeği önceden söyler" yorumları) **taşınır,
silinmez**: gerekçeleri hâlâ geçerli.

- [ ] **Adım 2: Başarısız yapısal testi yaz**

`web/src/ayarlar/AyarlarSekmesi.test.tsx` — davranış testlerine ek olarak
şu **yapısal** test, panellerin ana ekrana geri sızmasını engeller:

```tsx
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Bu testin varlık sebebi ürün kararının kendisi: yedekleme ve parola
 * panelleri ana ekranı işgal ediyordu. Bir sonraki düzenlemede "küçük bir
 * yedek uyarısı" diye geri eklenmesi kolaydır; bu test onu derleme
 * zamanında değil ama test zamanında yakalar.
 *
 * Dosya kümesi sabit yazılmıyor: `AnaEkran.tsx` ve Takvim sekmesinin
 * kendisi taranıyor. (12. biçim: yapısal iddianın dosya kümesi, ihlalin
 * olabileceği kavşağı dışarıda bırakırsa test hiçbir şey korumaz.)
 */
const YASAK = [
  'Yedekten geri yükle',
  'Şimdi yedek al',
  'Parolayı değiştir',
  'Yedek klasörünü değiştir',
]

describe('yönetim panelleri yalnızca Ayarlar sekmesinde', () => {
  for (const dosya of [
    'src/screens/AnaEkran.tsx',
    'src/takvim/TakvimSekmesi.tsx',
    'src/danisan/DanisanlarSekmesi.tsx',
  ]) {
    it(`${dosya} yönetim metni taşımaz`, () => {
      const kaynak = readFileSync(new URL(`../../${dosya}`, import.meta.url), 'utf8')
      for (const metin of YASAK) {
        expect(kaynak).not.toContain(metin)
      }
    })
  }
})
```

Davranış testleri (aynı dosyada): yedek klasörü boşken `Şimdi yedek al`
düğmesinin klasör isteme akışını başlattığı, parola formunun kapanınca
alanları temizlediği — bu ikisi bugün `AnaEkran.test.tsx` içinde varsa
oradan taşınır, yeniden yazılmaz.

- [ ] **Adım 3: Testin başarısız olduğunu gör**

Çalıştır: `npm --prefix web run test -- AyarlarSekmesi`
Beklenen: FAIL — `AnaEkran.tsx` hâlâ `Şimdi yedek al` içeriyor.

- [ ] **Adım 4: Taşı**

`AyarlarSekmesi.tsx` dört bölümü sırayla render eder; başlığı
`<h2>Ayarlar</h2>`. Yedekleme bölümünün **kabı** `bg-amber-50` sarı kutudan
normal bir bölüme dönüşür (`rounded border p-4`); "hiç yedek yok" bilgisi
kutunun rengiyle değil, cümlesiyle verilir. `role="alert"` **kalır**: bu,
gözden kaçmaması gereken bir bilgi.

`AnaEkran.tsx` bu dört bloğu `<AyarlarSekmesi … />` ile değiştirir.

- [ ] **Adım 5: Testin geçtiğini gör**

Çalıştır: `npm --prefix web run test`
Beklenen: PASS (tüm web paketi; taşınan testler dahil).

- [ ] **Adım 6: Mutasyon turu**

`AnaEkran.tsx`'e `<p>Şimdi yedek al</p>` satırını ekle → yapısal testin
kırmızıya döndüğünü gör → `git checkout --` ile geri al.

- [ ] **Adım 7: Commit**

```bash
git add web/src
git commit -m "Ayarlar sekmesi: yedek, parola, depolama ve saklama panelleri ana ekrandan cikti"
```

---

### Görev 3: Takvim sekmesi ve ay özeti paneli

**Dosyalar:**
- Oluştur: `web/src/takvim/TakvimSekmesi.tsx`
- Değiştir: `web/src/ozet/AyOzeti.tsx` (kutu → panel; açıklama paragrafı
  panelin içine)
- Değiştir: `web/src/screens/AnaEkran.tsx`
- Test: `web/src/takvim/TakvimSekmesi.test.tsx`

**Arayüzler:**
- Tüketir: `useTakvimAkisi`, `useSeansNotlari`, `AyOzeti`, `HaftalikTakvim`,
  `RandevuPaneli`, `SeansPaneli`, `SeansAltSatiri`.
- Üretir: `<TakvimSekmesi takvim seansAkisi ozet onDanisanAc />`.

- [ ] **Adım 1: Başarısız testi yaz**

```tsx
it('takvim, ay özeti panelinden önce gelir', () => {
  render(<TakvimSekmesi {...varsayilanProplar()} />)
  const kok = screen.getByTestId('takvim-sekmesi')
  const metin = kok.textContent ?? ''
  // Sıralama testi: "Ay sonu özeti" DÜĞMESİ üstte olabilir ama özetin
  // RAKAMLARI takvimden önce gelemez. Açık özetle kurulup sıra ölçülüyor.
  expect(metin.indexOf('Gelinen seans')).toBeGreaterThan(metin.indexOf('Pzt'))
})

it('ay özeti kapalı başlar ve istek atmaz', () => {
  const ozetIstegi = vi.fn()
  render(<TakvimSekmesi {...varsayilanProplar({ ozetIstegi })} />)
  expect(ozetIstegi).not.toHaveBeenCalled()
  expect(screen.queryByText('Gelinen seans')).not.toBeInTheDocument()
})
```

İkinci test bugünkü kuralı koruyor: özet açılışta istek atmaz, çünkü sunucu
her görüntülemeyi **silinemez** biçimde denetim kaydına yazıyor.

- [ ] **Adım 2: Testin başarısız olduğunu gör**

Çalıştır: `npm --prefix web run test -- TakvimSekmesi`
Beklenen: FAIL — dosya yok.

- [ ] **Adım 3: Bileşeni yaz**

Sıra: `Hızlı arama` + `Ay sonu özeti` düğmesi + `Kilitle` üst satırda →
haftalık takvim → randevu paneli → seans paneli. Ay özeti açıkken takvimin
**üstünde değil**, üst satırın altında açılan bir panel olarak çıkar.

`AyOzeti.tsx` içindeki tahsilat kuralı paragrafı (`Tahsilat, ödendi olarak
işaretlenen bütün seansları içerir…`) panelin içinde kalır ve küçük punto
ile en alta iner: kural doğru ama başlık değil.

- [ ] **Adım 4: Testin geçtiğini gör**

Çalıştır: `npm --prefix web run test -- TakvimSekmesi`
Beklenen: PASS.

- [ ] **Adım 5: Mutasyon turu**

1. `AyOzeti`'ni koşulsuz render et (kapalı başlama kaldırılsın) → "kapalı
   başlar ve istek atmaz" kırmızıya dönmeli.
2. Takvim ile özet panelinin sırasını değiştir → sıralama testi kırmızıya
   dönmeli.

- [ ] **Adım 6: Commit**

```bash
git add web/src
git commit -m "Takvim sekmesi: takvim en ustte, ay ozeti panele tasindi"
```

---

### Görev 4: Sunucu — danışanın seans listesi

**Dosyalar:**
- Oluştur: `core/src/store/danisan_seanslari.rs`
- Değiştir: `core/src/store/mod.rs`
- Oluştur: `server/src/routes/danisan_seanslari.rs`
- Değiştir: `server/src/routes/mod.rs`, `server/src/lib.rs`
- Test: `core/src/store/danisan_seanslari.rs` içindeki `mod testler`,
  `server/tests/notlar_api.rs`

**Arayüzler:**
- Üretir:

```rust
#[derive(Clone, Serialize)]
pub struct DanisanSeansi {
    pub appointment_id: i64,
    /// `appointments.baslangic` — YETKİLİ kaynak, notun kopyası değil.
    pub baslangic: String,
    pub durum: String,
    pub ucret_kurus: i64,
    pub odendi: bool,
    /// Not YOKSA `None`. Boş metinle ("") karıştırılmaz: "not yazılmamış"
    /// ile "not açılmış ama boş bırakılmış" farklı şeylerdir ve arayüz
    /// ikisini farklı gösterir.
    pub not_ilk_satiri: Option<String>,
}

pub fn danisan_seanslari(
    conn: &Connection,
    client_id: i64,
    cihaz: Cihaz,
) -> Result<Vec<DanisanSeansi>, StoreHatasi>
```

- Tüketir: `store::audit::{kaydet, Cihaz, Eylem, LogHacmi, VarlikTuru}`.

- [ ] **Adım 1: Başarısız testleri yaz**

`core/src/store/danisan_seanslari.rs` içine:

```rust
#[test]
fn notu_olmayan_randevu_da_listede_cikar() {
    let conn = test_baglantisi();
    let danisan = danisan_ekle(&conn, "Ayşe");
    let randevu = randevu_ekle(&conn, danisan, "2026-09-14T10:00");

    let liste = danisan_seanslari(&conn, danisan, Cihaz::Masaustu).unwrap();

    // ASIL KORUMA: `danisan_notlari` yalnızca NOTLARI döndürüyor; notu
    // yazılmamış bir seans o listede hiç görünmüyordu ve "notunu yazmayı
    // unuttuğum seans" ekranda yok demekti. Burada LEFT JOIN şart.
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0].appointment_id, randevu);
    assert_eq!(liste[0].not_ilk_satiri, None);
}

#[test]
fn bos_not_ile_yazilmamis_not_ayrilir() {
    let conn = test_baglantisi();
    let danisan = danisan_ekle(&conn, "Ayşe");
    let randevu = randevu_ekle(&conn, danisan, "2026-09-14T10:00");
    not_kaydet(&conn, randevu, "", "serbest", Cihaz::Masaustu).unwrap();

    let liste = danisan_seanslari(&conn, danisan, Cihaz::Masaustu).unwrap();
    assert_eq!(liste[0].not_ilk_satiri, Some(String::new()));
}

#[test]
fn liste_randevu_tarihine_gore_yeniden_eskiye_siralanir() {
    let conn = test_baglantisi();
    let danisan = danisan_ekle(&conn, "Ayşe");
    // EKLEME SIRASI kasten tarih sırasının TERSİ değil, KARIŞIK: ekleme
    // sırasına göre dönen bir sorgu da, ters sıralayan bir sorgu da
    // kırılmalı (8. biçim: test kurulumu birincil sıralama anahtarını
    // görünmez kılmamalı).
    let orta = randevu_ekle(&conn, danisan, "2026-09-14T10:00");
    let en_yeni = randevu_ekle(&conn, danisan, "2026-09-21T10:00");
    let en_eski = randevu_ekle(&conn, danisan, "2026-09-07T10:00");

    let liste = danisan_seanslari(&conn, danisan, Cihaz::Masaustu).unwrap();
    let sira: Vec<i64> = liste.iter().map(|s| s.appointment_id).collect();
    assert_eq!(sira, vec![en_yeni, orta, en_eski]);
}

#[test]
fn baska_danisanin_seansi_listeye_girmez() {
    let conn = test_baglantisi();
    let ayse = danisan_ekle(&conn, "Ayşe");
    let mehmet = danisan_ekle(&conn, "Mehmet");
    randevu_ekle(&conn, mehmet, "2026-09-14T10:00");

    let liste = danisan_seanslari(&conn, ayse, Cihaz::Masaustu).unwrap();
    assert!(liste.is_empty());
}

#[test]
fn randevu_baska_danisana_tasinirsa_not_da_onunla_gider() {
    let conn = test_baglantisi();
    let ayse = danisan_ekle(&conn, "Ayşe");
    let mehmet = danisan_ekle(&conn, "Mehmet");
    let randevu = randevu_ekle(&conn, ayse, "2026-09-14T10:00");
    not_kaydet(&conn, randevu, "İlk satır\nİkinci", "serbest", Cihaz::Masaustu).unwrap();

    // Randevu Mehmet'e taşınır; `progress_notes.client_id` DENORMALİZE
    // alanı bayatlar. Filtre `a.client_id` üzerinden olmalı (Plan 3'te
    // bulunan gerçek hata).
    randevu_danisani_degistir(&conn, randevu, mehmet);

    assert!(danisan_seanslari(&conn, ayse, Cihaz::Masaustu).unwrap().is_empty());
    let liste = danisan_seanslari(&conn, mehmet, Cihaz::Masaustu).unwrap();
    assert_eq!(liste[0].not_ilk_satiri.as_deref(), Some("İlk satır"));
}

#[test]
fn ilk_satir_yalnizca_ilk_satirdir_ve_kirpilir() {
    let conn = test_baglantisi();
    let danisan = danisan_ekle(&conn, "Ayşe");
    let randevu = randevu_ekle(&conn, danisan, "2026-09-14T10:00");
    let uzun = "a".repeat(400);
    not_kaydet(&conn, randevu, &format!("{uzun}\ngizli ikinci satır"), "serbest", Cihaz::Masaustu)
        .unwrap();

    let liste = danisan_seanslari(&conn, danisan, Cihaz::Masaustu).unwrap();
    let ilk = liste[0].not_ilk_satiri.clone().unwrap();
    assert_eq!(ilk.chars().count(), AZAMI_ONIZLEME);
    assert!(!ilk.contains("gizli ikinci satır"));
}

#[test]
fn liste_okumasi_oturum_basi_loglanir() {
    let conn = test_baglantisi();
    let danisan = danisan_ekle(&conn, "Ayşe");
    for _ in 0..30 {
        danisan_seanslari(&conn, danisan, Cihaz::Masaustu).unwrap();
    }
    // TAM OLARAK 1: "en az 1" değil. Pencere 0'a çekilirse kırılır.
    assert_eq!(goruntuleme_sayisi(&conn, danisan), 1);
}

#[test]
fn log_satiri_not_icerigi_tasimaz() {
    let conn = test_baglantisi();
    let danisan = danisan_ekle(&conn, "Ayşe");
    let randevu = randevu_ekle(&conn, danisan, "2026-09-14T10:00");
    not_kaydet(&conn, randevu, "ÇOK GİZLİ CÜMLE", "serbest", Cihaz::Masaustu).unwrap();
    danisan_seanslari(&conn, danisan, Cihaz::Masaustu).unwrap();

    let log = tum_log_metni(&conn);
    assert!(!log.contains("ÇOK GİZLİ"));
}
```

`AZAMI_ONIZLEME` bu modülde tanımlanır: `pub const AZAMI_ONIZLEME: usize = 120;`
ve kırpma **karakter** (`chars()`) üzerinden yapılır, bayt üzerinden değil —
Türkçe harfler çok baytlı ve bayt kırpması UTF-8'i bozar.

- [ ] **Adım 2: Testlerin başarısız olduğunu gör**

Çalıştır (PowerShell, PATH önekiyle): `cargo test -p psikolog-core danisan_seanslari`
Beklenen: FAIL — modül yok.

- [ ] **Adım 3: Depoyu yaz**

```rust
pub fn danisan_seanslari(
    conn: &Connection,
    client_id: i64,
    cihaz: Cihaz,
) -> Result<Vec<DanisanSeansi>, StoreHatasi> {
    // LEFT JOIN: notu OLMAYAN randevu da listeye girer.
    // Filtre `a.client_id` üzerinde: `progress_notes.client_id`
    // denormalize bir kopyadır ve randevu taşındığında bayatlar.
    let mut ifade = conn.prepare(
        "SELECT a.id, a.baslangic, a.durum, a.ucret_kurus, a.odendi, p.icerik
           FROM appointments a
           LEFT JOIN progress_notes p ON p.appointment_id = a.id
          WHERE a.client_id = ?1
          ORDER BY a.baslangic DESC, a.id DESC",
    )?;
    let satirlar = ifade.query_map([client_id], |s| {
        let icerik: Option<String> = s.get(5)?;
        Ok(DanisanSeansi {
            appointment_id: s.get(0)?,
            baslangic: s.get(1)?,
            durum: s.get(2)?,
            ucret_kurus: s.get(3)?,
            odendi: s.get(4)?,
            not_ilk_satiri: icerik.map(|m| ilk_satir(&m)),
        })
    })?;
    let liste: Vec<DanisanSeansi> = satirlar.collect::<Result<_, _>>()?;

    // Hacim: OturumBasi. Danışan dosyası kendi kendini yenileyen bir ekran;
    // HerCagri seçilseydi bir dosyayı okurken onlarca silinemez satır
    // birikirdi (bkz. `store::audit` hacim politikası).
    kaydet(
        conn,
        Eylem::Goruntuleme,
        VarlikTuru::Danisan,
        Some(client_id),
        None, // ayrinti YOK: not içeriği/başlığı loga girmez
        cihaz,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;
    Ok(liste)
}

/// İlk satırı verir ve `AZAMI_ONIZLEME` karakterinde kırpar.
///
/// Kırpma KARAKTER üzerinden: Türkçe harfler çok baytlı, bayt kırpması
/// UTF-8'i ortasından bölerdi.
fn ilk_satir(metin: &str) -> String {
    metin
        .lines()
        .next()
        .unwrap_or("")
        .chars()
        .take(AZAMI_ONIZLEME)
        .collect()
}
```

- [ ] **Adım 4: Testlerin geçtiğini gör**

Çalıştır: `cargo test -p psikolog-core danisan_seanslari`
Beklenen: PASS (8 test).

- [ ] **Adım 5: Rotayı yaz**

`server/src/routes/danisan_seanslari.rs`:

```rust
pub async fn liste(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Vec<DanisanSeansi>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    danisan_seanslari(&conn, id, Cihaz::Masaustu)
        .map(Json)
        .map_err(depo_hatasi)
}
```

`server/src/lib.rs`'e:

```rust
.route(
    "/danisanlar/{id}/seanslar",
    get(routes::danisan_seanslari::liste),
)
```

`server/tests/notlar_api.rs` içindeki rota sayısı sabiti bir artar; kapı
tarama testleri (ilk satır `acik_baglanti`, handler başına tam bir kez, rota
modülü `audit::kaydet` çağırmaz) yeni modülü kendiliğinden kapsar çünkü
dosya kümesini dizinden türetiyorlar.

- [ ] **Adım 6: HTTP testini yaz ve geçir**

`server/tests/notlar_api.rs`: kilitli oturumda `GET
/api/danisanlar/1/seanslar` **401** döner ve gövdesinde seans verisi yoktur.

Çalıştır: `cargo test -p psikolog-server`
Beklenen: PASS.

- [ ] **Adım 7: Mutasyon turu**

1. `LEFT JOIN` → `JOIN` — "notu olmayan randevu da listede" kırmızı.
2. `WHERE a.client_id` → `WHERE p.client_id` — "randevu taşınırsa" kırmızı.
3. `ORDER BY a.baslangic DESC` → `ORDER BY a.id` — sıralama testi kırmızı.
4. `LogHacmi::OturumBasi(...)` → `LogHacmi::HerCagri` — "tam olarak 1"
   kırmızı.
5. `ayrinti` parametresine not içeriğini geçir — "log not içeriği taşımaz"
   kırmızı.
6. `.chars().take(...)` → kırpmayı kaldır — önizleme testi kırmızı.
7. Handler'ın ilk satırındaki `acik_baglanti` çağrısını aşağı al — kapı
   tarama testi kırmızı.

Her mutasyondan sonra `git checkout --` ile geri al.

- [ ] **Adım 8: Commit**

```bash
git add core server
git commit -m "Danisan seans listesi ucu: notsuz randevular dahil, yetkili kaynaktan filtre"
```

---

### Görev 5: Danışanlar sekmesi — iki kolon

**Dosyalar:**
- Oluştur: `web/src/danisan/DanisanlarSekmesi.tsx`
- Oluştur: `web/src/screens/anaEkranKancalari/useDanisanSeanslari.ts`
- Değiştir: `web/src/api.ts`
- Test: `web/src/danisan/DanisanlarSekmesi.test.tsx`

**Arayüzler:**
- Üretir: `<DanisanlarSekmesi liste dosya seanslar onDanisanSec />`,
  `useDanisanSeanslari({ clientId, onYetkisiz })`.
- Tüketir: `danisanApi.seanslar(clientId)` → `DanisanSeansi[]`.

- [ ] **Adım 1: API çağrısını ekle**

`web/src/api.ts` içinde `danisanApi` nesnesine:

```ts
seanslar: (clientId: number) =>
  istek<DanisanSeansi[]>(`/api/danisanlar/${clientId}/seanslar`),
```

- [ ] **Adım 2: Başarısız testleri yaz**

```tsx
it('danışan seçilmemişken sağ kolonda yönlendirme yazısı olur', () => {
  render(<DanisanlarSekmesi {...proplar({ seciliDanisanId: null })} />)
  expect(screen.getByText(/dosyasını açmak için soldaki listeden/i)).toBeInTheDocument()
})

it('seçili danışan değişince seans listesi yeniden çekilir', async () => {
  const seanslar = vi.fn().mockResolvedValue([])
  const { rerender } = render(<DanisanlarSekmesi {...proplar({ seciliDanisanId: 1, seanslar })} />)
  await waitFor(() => expect(seanslar).toHaveBeenCalledWith(1))
  rerender(<DanisanlarSekmesi {...proplar({ seciliDanisanId: 2, seanslar })} />)
  await waitFor(() => expect(seanslar).toHaveBeenCalledWith(2))
})

it('geciken yanıt yeni seçimin listesini ezmez', async () => {
  // 1 numaralı danışanın yanıtı GEÇ geliyor; arada 2'ye geçiliyor.
  // Geciken yanıt ekrana yazılırsa Ayşe'nin seansları Mehmet'in
  // dosyasında görünür — Plan 3'te aynı sınıf hata gerçekten oldu.
  …
  expect(screen.queryByText('14 Eylül 2026 10:00')).not.toBeInTheDocument()
})
```

- [ ] **Adım 3: Testlerin başarısız olduğunu gör**

Çalıştır: `npm --prefix web run test -- DanisanlarSekmesi`
Beklenen: FAIL.

- [ ] **Adım 4: Kancayı ve bileşeni yaz**

`useDanisanSeanslari` deseni `useDanisanDosyasi` ile aynıdır: istek
kimliğini bir `ref`te tutar, yanıt döndüğünde `ref` hâlâ aynı `clientId`'yi
gösteriyorsa yazar; 401'de `onYetkisiz` çağırır ve listeyi boşaltır.

Düzen: `grid grid-cols-[18rem_1fr]`. Sol kolon `useDanisanListesi`'nin
listesi + arama kutusu + `Danışan ekle` + arşiv onayı (bugünkü JSX taşınır).
Sağ kolon `<DanisanDosyasi …/>` (Görev 6).

- [ ] **Adım 5: Testlerin geçtiğini gör**

Çalıştır: `npm --prefix web run test -- DanisanlarSekmesi`
Beklenen: PASS.

- [ ] **Adım 6: Mutasyon turu**

1. İstek kimliği kontrolünü kaldır (yanıtı koşulsuz yaz) → "geciken yanıt"
   testi kırmızı.
2. `useEffect` bağımlılığından `clientId`'yi çıkar → "yeniden çekilir"
   testi kırmızı.

- [ ] **Adım 7: Commit**

```bash
git add web/src
git commit -m "Danisanlar sekmesi: solda liste, sagda dosya; seans listesi akisi"
```

---

### Görev 6: Dosyanın Seanslar alt sekmesi

**Dosyalar:**
- Oluştur: `web/src/danisan/DanisanDosyasi.tsx` (alt sekme kabuğu)
- Oluştur: `web/src/danisan/SeansListesi.tsx`
- Test: `web/src/danisan/SeansListesi.test.tsx`,
  `web/src/danisan/DanisanDosyasi.test.tsx`

**Arayüzler:**
- Üretir: `<DanisanDosyasi kart seanslar … />`,
  `<SeansListesi seanslar secili onSecim />`.
- Tüketir: `DanisanSeansi[]`, `tlMetni`.

- [ ] **Adım 1: Başarısız testleri yaz**

```tsx
it('her seans tarih, durum ve ödeme rozetiyle listelenir', () => { … })

it('notu olmayan seans "Not yazılmamış" olarak görünür', () => {
  render(<SeansListesi seanslar={[seans({ not_ilk_satiri: null })]} … />)
  expect(screen.getByText('Not yazılmamış')).toBeInTheDocument()
})

it('boş not, yazılmamış nottan ayrı gösterilir', () => {
  render(<SeansListesi seanslar={[seans({ not_ilk_satiri: '' })]} … />)
  expect(screen.queryByText('Not yazılmamış')).not.toBeInTheDocument()
})

it('açılışta en yeni seans seçilidir', () => { … })

it('ücret tek biçimlendiriciyle yazılır', () => {
  render(<SeansListesi seanslar={[seans({ ucret_kurus: 123450 })]} … />)
  expect(screen.getByText('1.234,50 TL')).toBeInTheDocument()
})
```

- [ ] **Adım 2: Testlerin başarısız olduğunu gör**

Çalıştır: `npm --prefix web run test -- SeansListesi`
Beklenen: FAIL.

- [ ] **Adım 3: Bileşenleri yaz**

`DanisanDosyasi` iki alt sekme çizer (`Seanslar` varsayılan, `Bilgiler`).
Alt sekme şeridi Görev 1'deki `Sekmeler` bileşeni **değildir** — o uygulama
kabuğunun şeridi; burada kendi küçük şeridi olur ki iki `tablist`
birbirinin `aria-controls`'üne karışmasın.

Seanslar alt sekmesi: solda `SeansListesi`, sağda seçili seansın
`NotEditoru` + `SeansAltSatiri`. Not düzenleme dosyanın içinden yapılabilir;
takvime gitmek gerekmez.

- [ ] **Adım 4: Testlerin geçtiğini gör**

Çalıştır: `npm --prefix web run test -- "Seans|DanisanDosyasi"`
Beklenen: PASS.

- [ ] **Adım 5: Özel not sızıntısı taramasını genişlet**

`web/src/istemciRaporUretimi.test.ts` ve çekirdekteki özel not yapısal
taraması, yeni `web/src/danisan/*` dosyalarını **zaten** kapsamalı (dosya
kümesi dizinden türetiliyor). Kapsadığını doğrula: taramaya `SeansListesi`
içine `ozelNotApi` çağrısı ekle → testin kırmızıya döndüğünü gör →
`git checkout --`. Kırmızıya dönmüyorsa tarama kümesi düzeltilir (12. biçim).

- [ ] **Adım 6: Mutasyon turu**

1. `not_ilk_satiri === null` kontrolünü `!not_ilk_satiri` yap → "boş not,
   yazılmamış nottan ayrı" kırmızı.
2. Açılış seçimini listenin sonuncusu yap → "en yeni seçili" kırmızı.
3. `tlMetni` yerine elle `toFixed(2)` yaz → ücret testi kırmızı.

- [ ] **Adım 7: Commit**

```bash
git add web/src
git commit -m "Danisan dosyasi: Seanslar alt sekmesi, solda liste sagda not"
```

---

### Görev 7: Bilgiler alt sekmesi ve uyarı dili

**Dosyalar:**
- Oluştur: `web/src/danisan/DosyaBilgileri.tsx`
- Sil: `web/src/danisan/DanisanKarti.tsx`,
  `web/src/danisan/DanisanKarti.test.tsx` (içerik taşınır)
- Değiştir: `web/src/danisan/RizaBolumu.tsx` (metin)
- Test: `web/src/danisan/DosyaBilgileri.test.tsx`

- [ ] **Adım 1: Metin kararlarını sabitle**

Değişen cümleler:

| Eski | Yeni |
|---|---|
| "Rıza alınmadan işlenen bir danışan dosyası, bu uygulamadaki en somut KVKK uyumsuzluğudur." | "İmzalı onam formunu buraya ekleyebilirsiniz." |
| "Aydınlatma ve açık rıza" | "Onam" |
| "Veri raporu — Danışanın kendi verisine erişim talebi için (KVKK md. 11)." | "Danışan veri raporu — Danışan kendi kaydını isterse, parola korumalı bir PDF olarak verilir." |

`RizaBolumu`'nun **işlevi** (tarih + imzalı dosya) korunur; yalnızca uyarı
tonu kalkar. Saklama süresi bölümünün "imha kararı her zaman sizindir"
cümlesi **kalır** — bu bir uyarı değil, ürün sözü.

- [ ] **Adım 2: Başarısız testi yaz**

```tsx
it('dosya bilgileri suçlayıcı KVKK uyarısı içermez', () => {
  render(<DosyaBilgileri {...proplar()} />)
  expect(screen.queryByText(/uyumsuzluğudur/)).not.toBeInTheDocument()
})

it('onam bölümü imzalı dosya yüklemeyi hâlâ sunar', () => {
  render(<DosyaBilgileri {...proplar()} />)
  expect(screen.getByLabelText(/imzalı onam/i)).toBeInTheDocument()
})

it('veri raporu parola olmadan indirilemez', () => { … }) // mevcut testten taşınır
```

İkinci test önemli: birinci test tek başına olsaydı, bölümü tamamen silmek
de testi geçirirdi (2. biçim: koruma kaldırıldı, test hâlâ geçiyor).

- [ ] **Adım 3–4: Taşı ve geçir**

`DanisanKarti.tsx`'in sağlam olan her şeyi (veri raporu akışı, ekler,
saklama süresi, bakiye) `DosyaBilgileri.tsx`'e taşınır. Modül başlığındaki
"bu kart not ÇEKMİYOR / `ozelNotApi`'ye yolu yok" gerekçesi **aynen taşınır**.

Çalıştır: `npm --prefix web run test`
Beklenen: PASS.

- [ ] **Adım 5: Mutasyon turu**

Onam bölümünü tamamen sil → "imzalı dosya yüklemeyi hâlâ sunar" kırmızı.
Veri raporu parola alanını kaldır → parola testi kırmızı.

- [ ] **Adım 6: Commit**

```bash
git add web/src
git commit -m "Bilgiler alt sekmesi: KVKK uyari dili bilgi diline cevrildi"
```

---

### Görev 8: Bağlama, e2e ve elle bakış

**Dosyalar:**
- Değiştir: `web/src/screens/AnaEkran.tsx`
- Oluştur: `e2e/kabuk.spec.ts`
- Değiştir: `playwright.config.ts` (yeni port 7705)
- Test: yukarıdakiler + tam takım

- [ ] **Adım 1: Takvimden danışana geçişi bağla**

Takvimdeki randevu çipinde danışan adına tıklamak: sekme `danisanlar` olur
ve o danışanın dosyası açılır. `AnaEkran` bu geçişi tek bir fonksiyonda
tutar (`danisanaGit(clientId)`), çünkü sekme state'i ve `useDanisanDosyasi`
farklı yerlerde.

- [ ] **Adım 2: e2e testini yaz**

`e2e/kabuk.spec.ts`:

```ts
test('açılışta takvim görünür, yedekleme görünmez', async ({ page }) => {
  await kilidiAc(page)
  await expect(page.getByRole('tab', { name: 'Takvim' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Şimdi yedek al')).toHaveCount(0)
})

test('danışana tıklayınca geçmiş seansları ve notu açılır', async ({ page }) => {
  await kilidiAc(page)
  await randevuVeNotOlustur(page, 'Ayşe', 'Geçen haftanın notu')
  await page.getByRole('tab', { name: 'Danışanlar' }).click()
  await page.getByRole('button', { name: /Ayşe/ }).click()
  // Senkronizasyon bariyeri: listenin YÜKLENDİĞİNİ bekle, sonra say.
  // (6. biçim: iddia, işlem ÖNCESİ durumla da sağlanmamalı.)
  await expect(page.getByTestId('seans-listesi')).toHaveAttribute('data-yuklendi', 'evet')
  await expect(page.getByText('Geçen haftanın notu')).toBeVisible()
})
```

`playwright.config.ts`'e `kabuk` projesi ve `7705` portu eklenir; config
kayıtsız spec'te hata fırlattığı için bu adım atlanamaz.

- [ ] **Adım 3: Tam takımı çalıştır**

```bash
npm --prefix web run build
```

```bash
npm --prefix web run test
```

Çalıştır (PowerShell, PATH önekiyle): `cargo test --workspace` ve
`cargo clippy --workspace --all-targets -- -D warnings`, sonra
`npx playwright test`.

Beklenen: hepsi yeşil.

- [ ] **Adım 4: Elle bakış**

Sunucuyu başlat, tarayıcıda aç ve şunları **gözle** doğrula: açılışta yalnızca
takvim var; Ayarlar sekmesinde yedekleme bölümü sarı uyarı kutusu değil;
Danışanlar sekmesinde bir danışana tıklayınca solda seansları, sağda notu
çıkıyor. Bu adım testlerin yerine geçmez, ürün kararının kendisini doğrular.

- [ ] **Adım 5: Commit**

```bash
git add .
git commit -m "Kabuk baglandi: takvimden danisana gecis, e2e kabuk spec'i"
```
