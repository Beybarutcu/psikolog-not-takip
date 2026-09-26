# Seans notu sayfası ve biçimli editör — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Randevuya tıklayınca takvim ızgarasının yerine o seansın not sayfası açılsın; not Word gibi biçimli (TipTap) yazılsın ve HTML olarak saklansın; önceki notlarda Türkçe harf duyarsız arama, vurgulu geniş okuma ve salt okunur ayrı okuma penceresi olsun; takvim blokları "gelmedi" ve "ödeme alınmadı"yı simgeyle söylesin.

**Architecture:** Sunucu, resmî notun HTML'inden düz metni (`duz_metin`) KENDİSİ çıkarır ve aynı işlemde yazar; arama, önizleme, veri raporu ve yeni danışana özel not araması yalnızca bu sütuna bakar, istemcide ikinci bir kural yazılmaz. Arayüzde not yüzeyi tek bir bileşendir (`not/BicimliYuzey.tsx`, TipTap Simple Editor şablonundan kurulu); `NotEditoru`'nun otomatik kayıt / taslak / 401 / `sunucuHali` sözleşmesi aynen kalır, yalnızca metin kutusu değişir; Vitest'te bu modül bir `<textarea>` test yüzeyiyle değiştirilir. Takvim sekmesi seçili randevu varken `SeansSayfasi`'ni çizer; Tauri kabuğu her pencereye gezinme koruması ve `?okuma=<id>` okuma pencereleri kurar.

**Tech Stack:** Rust (rusqlite/SQLCipher, Axum 0.8, Tauri 2.11 + `tauri-plugin-opener` 2), React 19 + TypeScript 6 + Vite 8 + Tailwind 4, TipTap 3 (Simple Editor şablonu, `@tiptap/*` 3.31), `lucide-react`, Vitest 5 + Testing Library + jsdom, Playwright (Chromium).

**Spec:** `docs/superpowers/specs/2026-09-26-seans-notu-sayfasi-ve-editor-design.md` (bağlayıcı). Bu plan onun §4–§11 maddelerini (T, E, S, N, P) görevlere böler; madde kodları görev başlıklarında geçer.

**Görev bölümü hakkında:** Yöneticinin verdiği on bir görev AYNEN korundu (numara, sıra, kapsam). Üç ek iş görevlerin içine kondu, çünkü yapılmazsa görev kırmızı bırakırdı: (a) Görev 4, `web/src/istemciRaporUretimi.test.ts`'in "kod olmayan uzantılar" kümesine `scss`'i ekler (şablonun `.scss` dosyaları yoksa o test kırılır); (b) Görev 8, aynı testin `window.open` yasağına TEK adlı istisnayı (`web/src/seans/okumaPenceresi.ts`) ekler (tasarım P2 `window.open` istiyor, bugünkü yapısal test onu her yerde yasaklıyor); (c) Görev 4, şablonun `link-popover`'ındaki `window.open`'lı "yeni pencerede aç" düğmesini kaldırır (aynı yasak).

## Global Constraints

- Tüm kod, yorum ve arayüz metni Türkçe; commit mesajları Türkçe ve ASCII harflerle (repo geleneği: `Tasarim: ...`), sonunda boş satır + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Sunucu yalnızca `127.0.0.1` dinler; hiçbir veri makineden çıkmaz; uygulamaya yeni bir ağ çağrısı (yazı tipi CDN'i, telemetri, uzak görsel) girmez — şablonun Google Fonts `@import url(...)`'u silinir.
- `audit_log`'a not içeriği, not başlığı, şablon adı, arama terimi, sonuç sayısı GİRMEZ; `ayrinti` yeni yollarda hep `None`.
- `private_notes` aramaya, önizlemeye, veri raporuna, okuma penceresine ve önceki notlar paneline girmez; `ozelNotApi`/`OzelNot` yalnızca bugünkü üç izinli web dosyasında geçer (`api.ts`, `useSeansNotlari.ts`, `SeansPaneli.tsx`).
- Terapistin bakmadığı bir şey için `Goruntuleme` satırı düşmez: not okuması (`notGetir`) yalnızca kullanıcı o notu açınca, özel not yalnızca sekmeye girilince, önceki seans listesi yalnızca sayfa açılınca istenir.
- Parolalar, kurtarma kodu ve anahtarlar hiçbir loga, URL'ye ya da `eprintln!`'e girmez; Tauri'nin hata satırları URL basmaz.
- `cargo` yalnızca PowerShell'den ve şu önekle: `$env:PATH = "C:\StrawberryPerl\perl\bin;C:\Users\axres\AppData\Local\bin\NASM;" + $env:PATH`.
- `cargo test --workspace` öncesi `npm --prefix web run build` (`rust_embed` `web/dist` ister).
- TypeScript YALNIZCA `npm --prefix web run build` ile denetlenir (`tsc -b`); `npx tsc --noEmit -p .` bu depoda hiçbir şey denetlemez.
- Web testleri `web/` dizininde `npx vitest run [dosya]`; lint `npm --prefix web run lint` (oxlint) — uyarı sayısı artmaz (bugün 20 satır "warning"; her görev öncesi ve sonrası sayıyı yaz).
- E2E: depo kökünden, aynı PATH önekiyle `npx playwright test [e2e/dosya] --reporter=line`; her spec dosyasının `playwright.config.ts` `SUNUCULAR`'da kendi portu var, yeni `e2e/editor.spec.ts` oraya port `7708` ile eklenir.
- Git worktree açılmaz, `CARGO_TARGET_DIR` ayarlanmaz/paylaşılmaz; derleme sırasında `target/debug/sunucu.exe`'yi tutan demo/dev sunucusu çalışmaz.
- Mutasyon testinden ÖNCE commit; mutasyon YALNIZCA `git checkout -- <dosya>` ile geri alınır (Windows `Copy-Item` mtime tuzağı; bkz. `docs/test-yesil-ama-korumuyor.md`).
- Proje `jest-dom` kullanmaz: `toBeInTheDocument` yok; `toBeDefined()`, `toBeNull()`, `.textContent`, `getAttribute` kullanılır.
- Zaman duvar saati `YYYY-AA-GGTSS:DD` (16 karakter), para tam sayı kuruş; `Date`'e çevrilmez (`zamandanDate`/`zamanMetni` kullanılır).
- Randevuya tıklamak imleci hiçbir alana götürmez (editöre otomatik odak YOK).
- Yeni bağımlılıklar yalnızca: `lucide-react`; TipTap CLI'nin eklediği paketler (resim paketi hariç, `lodash.throttle` + tipi kaldırılır); `tauri-plugin-opener`. Başka paket/crate yok.
- `web/src` üretim kodunda `window.open` yalnızca `web/src/seans/okumaPenceresi.ts`'te, pano/yazdırma/`data:`/`new Blob` hiç yok (`istemciRaporUretimi.test.ts`).

## Review Focus

Tasarımın ima ettiği ama olağan akışın kendiliğinden sınamadığı, bir terapistin başına en olası gelecek beş durum; her birinin testi sahibi olan göreve yazıldı:

1. **Editör açılan notu kendi biçimine normalleştirir (`<b>`→`<strong>`, `''`→`<p></p>`) ve bu bir "değişiklik" sayılıp PUT + silinemez `Duzenleme` satırı üretir.** Terapist yalnızca notu açtı. → Görev 4 test 4.3–4.4 (`BicimliYuzey`: açılışta ve geri alınca `onChange` ham dizgiyi bildirir) ve Görev 5 test 5.1–5.2 (`NotEditoru.gercekYuzey.test.tsx`: gerçek TipTap ile açılış ve "yaz-geri al" `onKaydet` çağırmaz; artı yön: gerçek yazma bir kez kaydeder).
2. **Düz metin çıkarımı HTML'in kıyısında bozulur**: `&amp;`/`&#305;`/`&nbsp;` çözülmez, iç içe liste ve onay kutusu satırları birleşir ya da `[x]` taşır, `<script>` içeriği ya da etiket adları metne sızar → arama "strong"u bulur, PDF'te `<p>` görünür. → Görev 2, `duz_metin_ornekleri.json` (≥25 örnek) + `kontrolsuz_girdi_panik_uretmez` + `veri_raporu` HTML testi.
3. **Biçim etiketleri bir ifadeyi bölünce Türkçe katlamalı arama ve vurgu kaçırır** ("çok <strong>önemli</strong>" / "ön<strong>em</strong>li", "KAYGI" ↔ "kaygı"). → Görev 2 `bicim_etiketleri_bolse_de_metin_bulunur_etiket_adi_bulunmaz`, Görev 3 `her_katlanan_harf_danisan_not_aramasinda_iki_yonlu_calisir`, Görev 4 test 4.9 (`NotOkuma` işaretler arası vurgu).
4. **"Bu seansa git" başka haftadaki bir seansa gider**: seçim hafta yüklenmeden yapılırsa sayfa kapanır ya da geç dönen eski hafta yanıtı seçimi ezer; giden seansın yazılmamış notu kaybolur. → Görev 7 `useTakvimAkisi.test.ts` 7.1–7.4 (bekleyen seçim, hafta koruması, silinmiş hedef) ve Görev 8 test 8.6 (ikinci tık ve `Bu seansa git` `onSeansaGit`'i çağırır) ile 8.9 (`AnaEkran.test.tsx` bütünleşik: başka haftaya "Bu seansa git" giden editörün bekleyen metnini PUT eder, hedef seans kendi haftasında açılır).
5. **Okuma penceresi kilitten sonra açık kalır**: ana pencerede "Kilitle" ya da boşta kalma sonrası ayrı pencerede danışan adı ve not ekranda durur. → Görev 9 test 9.3–9.5 (5 sn içinde kilit ekranı, ad ekranda yok, ana pencerede yoklama yok) ve Görev 10 e2e "okuma penceresi kilitte içeriği kaldırır".

## File Structure

**Çekirdek / sunucu (Rust)**
- Oluştur `core/src/store/duz_metin.rs` — `html_duz_metin(&str) -> String`: etiket, varlık, boşluk kuralının TEK uygulaması.
- Oluştur `core/src/store/duz_metin_ornekleri.json` — düz metin kuralının ortak örnekleri.
- Değiştir `core/src/store/mod.rs` — `pub mod duz_metin;`.
- Değiştir `core/src/store/schema.rs` — `CURRENT_VERSION = 6`, `V6_SUTUNLAR` (`progress_notes.duz_metin`), `duz_metni_doldur` göç adımı.
- Değiştir `core/src/store/notes.rs` — `not_kaydet` `duz_metin`'i aynı işlemde yazar; `SeansNotu` += `danisan_adi`, `onizleme`.
- Değiştir `core/src/store/danisan_seanslari.rs` — önizleme `duz_metin`'den; Markdown yardımcıları silinir.
- Yeniden yaz `core/src/store/onizleme_ornekleri.json` — HTML girdili önizleme örnekleri.
- Değiştir `core/src/store/search.rs` — not araması `duz_metin` üzerinde; yeni `danisan_notlarinda_ara` + `NotAramaSonucu`.
- Değiştir `core/src/store/veri_raporu.rs` — not satırları `duz_metin`'den.
- Değiştir `server/src/routes/notes.rs`, `server/src/lib.rs` — `GET /api/danisanlar/{id}/not-ara`.
- Değiştir `server/tests/notlar_api.rs` — yeni uç, yapısal sayımlar (38→39, 20→21).
- Oluştur `src-tauri/src/pencere.rs` — saf `pencere_karari` / `gezinme_izni` / `disa_acilir_mi`.
- Değiştir `src-tauri/src/main.rs`, `src-tauri/Cargo.toml` — opener eklentisi, korumalı pencere kurucusu, okuma pencereleri, ana pencere kapanınca çıkış.

**Arayüz (web/src)**
- Oluştur `takvim/durumSimgesi.ts` (erişilebilir ad eki) ve `takvim/DurumSimgeleri.tsx` (UserX / TurkishLira) — takvim bloğu ve önceki notlar satırı ortak kullanır.
- Değiştir `takvim/RandevuBloku.tsx` — simgeler + `aria-label`.
- Şablon (CLI): `components/tiptap-*/**`, `hooks/*`, `lib/tiptap-utils.ts`, `styles/*.scss`, `scss.d.ts` — proje kodu sayılır; Türkçeleştirilir, resim/tema/regex yardımı/`window.open` silinir.
- Oluştur `not/uzantilar.ts` — editör ve okuma görünümünün ORTAK uzantı listesi, bağlantı kuralı.
- Oluştur `not/vurgu.ts` — Türkçe katlama (`katla`), `eslesmeAraliklari`, `vurguParcalari`, `NotVurgusu` TipTap eklentisi.
- Oluştur `not/htmlBos.ts` — boş editör kuralı (şablon ekleme için).
- Oluştur `not/stiller.ts`, `not/not-yuzeyi.scss` — şablon düğüm stilleri + uygulama teması.
- Oluştur `not/AracCubugu.tsx` — Türkçe araç çubuğu.
- Oluştur `not/BicimliYuzey.tsx` — düzenlenebilir yüzey (E8 eşlemesi burada).
- Oluştur `not/NotOkuma.tsx` — salt okunur görünüm + vurgu + ilk eşleşmeye kaydırma.
- Değiştir `test-kurulum.ts` — `BicimliYuzey` test yüzeyi, jsdom geometri/ResizeObserver taklitleri.
- Değiştir `seans/NotEditoru.tsx` — `BicimliYuzey`'e geçer; Yaz/Önizle, biçim çubuğu, `execCommand` yolu, `kisayolTusu` silinir.
- Değiştir `seans/sablon.ts` — şablon metni HTML.
- Sil `not/{bicim.ts,bicim.test.ts,BicimCubugu.tsx,markdown.tsx,markdown.test.tsx,desenler.ts,NotGorunumu.tsx}`, `seans/onizleme.ts(+test)`, (Görev 8) `seans/GecmisNotlar.tsx(+test)`.
- Oluştur `seans/SeansSayfasi.tsx` — not sayfası (üst satır, gizli randevu formu, editör alanı, sağ sütun).
- Değiştir `seans/SeansPaneli.tsx` — yalnızca sekmeler + editörler + etiketler.
- Değiştir `seans/SeansAltSatiri.tsx` — `gomulu` görünümü (üst satırda kenarlıksız).
- Oluştur `seans/OncekiNotlar.tsx` — önceki notlar listesi, arama, geniş okuma, yeni pencere menüsü.
- Oluştur `seans/okumaPenceresi.ts` — `okumaPenceresiniAc(id)` (tek `window.open`) ve `okumaKimligi(search)`.
- Oluştur `screens/OkumaPenceresi.tsx` — salt okunur okuma ekranı.
- Değiştir `App.tsx` — `?okuma=` dalı ve 5 sn'lik durum yoklaması.
- Değiştir `takvim/TakvimSekmesi.tsx`, `screens/anaEkranKancalari/useTakvimAkisi.ts` (`randevuyaGit`, `gecisBekliyor`), `screens/anaEkranKancalari/useSeansNotlari.ts` (Görev 8: geçmiş not isteği kalkar), `screens/AnaEkran.tsx` (önizleme yaması), `api.ts` (`SeansNotu` alanları, `notApi.notAra`).
- Değiştir `index.css` (şablon değişkenleri), `vite.config.ts` + `tsconfig.json` + `tsconfig.app.json` (`@` takma adı), `.oxlintrc.json` (şablon dizinleri lint dışı), `package.json`.

**E2E**
- Oluştur `e2e/editor.spec.ts`; değiştir `playwright.config.ts`, `e2e/{takvim,notlar,notlar-gelismis,kabuk,odeme,yerlesim}.spec.ts`.

## Her görevin bitiş ölçütü

1. Önce `docs/test-yesil-ama-korumuyor.md` okunur (on üç biçim).
2. Testler yazılır, **kırmızı** görülür (beklenen hata mesajıyla), kod yazılır, **yeşil** görülür.
3. Görevin sonundaki "Tam doğrulama" komutları koşulur ve sayılar rapora yazılır.
4. **Commit.**
5. Görevin "Mutasyonlar" listesindeki her mutasyon: uygula → adı verilen testin kırmızıya döndüğünü gör → `git checkout -- <dosya>` → yeşili yeniden gör. Rust'ta geri almadan sonra `Compiling psikolog-...` satırını gör (bayat derleme tuzağı). Raporda "mutasyon → kırılan test" satırları.
6. Bir test ürün doğru çalıştığı hâlde öncülü tasarım gereği ortadan kalktığı için siliniyorsa (ör. "ızgara ile panel aynı anda görünür"), raporda adıyla ve yerine gelen testle yazılır. Hiçbir iddia gerekçesiz gevşetilmez; "BLOCKED" deyip dur, sessizce kapsam daraltma.

---

### Task 1: Takvim durum simgeleri (spec §4 T1–T4)

**Files:**
- Create: `web/src/takvim/durumSimgesi.ts`
- Create: `web/src/takvim/DurumSimgeleri.tsx`
- Create: `web/src/takvim/RandevuBloku.test.tsx`
- Modify: `web/src/takvim/RandevuBloku.tsx` (tüm dönüş JSX'i, ~26–72)
- Modify: `web/src/screens/AnaEkran.test.tsx` (L14 `blokAdi`)
- Modify: `web/src/screens/AnaEkran.yayilim.test.tsx` (L15 `blokAdi`)
- Modify: `e2e/takvim.spec.ts` (ilk test ~L35; yeni test dosya sonuna)
- Modify: `web/package.json`, `web/package-lock.json` (`lucide-react`)

**Interfaces:**
- Produces (`durumSimgesi.ts`):
  - `export type DurumAlanlari = { durum: string; odendi: boolean; ucret: number | null }`
  - `export function gelmediMi(r: DurumAlanlari): boolean`
  - `export function durumSimgeMetni(r: DurumAlanlari): string` — `''`, `', gelmedi'`, `', ödeme alınmadı'` ya da `', gelmedi, ödeme alınmadı'`.
- Produces (`DurumSimgeleri.tsx`): `export function DurumSimgeleri({ randevu }: { randevu: DurumAlanlari }): JSX.Element | null` — `<span data-testid="durum-simgeleri" aria-hidden="true" class="… shrink-0">`, içinde `data-simge="gelmedi"` (`title="Gelmedi"`) ve/veya `data-simge="odeme"` (`title="Ödeme alınmadı"`). Görev 8 bunu önceki notlar satırında kullanır.
- Consumes: `borcaGirerMi` (`web/src/borc.ts`) — kural yeniden yazılmaz.

- [ ] **Adım 1: Paketi ekle**

Çalıştır: `npm --prefix web install lucide-react`
Beklenen: `web/package.json` `dependencies` altında `lucide-react` belirir. (İkonlar ağaç sallamayla yalnızca içe aktarılanlar pakete girer.)

- [ ] **Adım 2: Başarısız testleri yaz** (`web/src/takvim/RandevuBloku.test.tsx`)

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ornekler from '../../../core/src/store/borc_ornekleri.json'
import type { Randevu } from './HaftalikTakvim'
import { RandevuBloku } from './RandevuBloku'
import { durumSimgeMetni } from './durumSimgesi'

const temel: Randevu = {
  id: 1, client_id: 1, danisan_adi: 'Zeynep Yıldız',
  baslangic: '2026-09-07T10:00', bitis: '2026-09-07T10:50',
  durum: 'planlandi', ucret: 45000, odendi: false, seri_id: null,
}
const tamKonum = { ust: 0, yukseklik: 48, sutun: 0, sutunSayisi: 1 }

function ciz(ozel: Partial<Randevu> = {}, konum = tamKonum) {
  render(<RandevuBloku randevu={{ ...temel, ...ozel }} onSec={vi.fn()} konum={konum} />)
  return screen.getByRole('button')
}

describe('RandevuBloku — durum simgeleri (tasarım T1-T4)', () => {
  it('T3: durumu olmayan blokta ad değişmez ve simge yok', () => {
    const b = ciz()
    expect(screen.getByRole('button', { name: '10:00 Zeynep Yıldız' })).toBe(b)
    expect(b.querySelector('[data-simge]')).toBeNull()
  })

  it('T1/T3: gelmedi + ücretli + ödenmemiş -> iki simge, ad iki eki taşır', () => {
    const b = ciz({ durum: 'gelmedi' })
    expect(screen.getByRole('button', { name: '10:00 Zeynep Yıldız, gelmedi, ödeme alınmadı' })).toBe(b)
    expect(b.querySelector('[data-simge="gelmedi"]')?.getAttribute('title')).toBe('Gelmedi')
    expect(b.querySelector('[data-simge="odeme"]')?.getAttribute('title')).toBe('Ödeme alınmadı')
  })

  it('T1: geldi + ücretli + ödenmemiş -> yalnızca ₺ simgesi', () => {
    const b = ciz({ durum: 'geldi' })
    expect(screen.getByRole('button', { name: '10:00 Zeynep Yıldız, ödeme alınmadı' })).toBe(b)
    expect(b.querySelector('[data-simge="gelmedi"]')).toBeNull()
    expect(b.querySelector('[data-simge="odeme"]')).not.toBeNull()
  })

  it('T2: geldi+ödendi, planlandı ve iptal simge taşımaz (ücretli, ödenmemiş olsa da)', () => {
    for (const ozel of [{ durum: 'geldi', odendi: true }, { durum: 'planlandi' }, { durum: 'iptal' }]) {
      const { unmount } = render(
        <RandevuBloku randevu={{ ...temel, ...ozel }} onSec={vi.fn()} konum={tamKonum} />,
      )
      const b = screen.getByRole('button')
      expect(b.getAttribute('aria-label'), JSON.stringify(ozel)).toBe('10:00 Zeynep Yıldız')
      expect(b.querySelector('[data-simge]'), JSON.stringify(ozel)).toBeNull()
      unmount()
    }
  })

  it('ücretsiz (0) ya da ücreti girilmemiş gelmedi yalnızca "gelmedi" simgesi taşır', () => {
    for (const ucret of [0, null]) {
      const { unmount } = render(
        <RandevuBloku randevu={{ ...temel, durum: 'gelmedi', ucret }} onSec={vi.fn()} konum={tamKonum} />,
      )
      expect(screen.getByRole('button').getAttribute('aria-label')).toBe('10:00 Zeynep Yıldız, gelmedi')
      unmount()
    }
  })

  it('T4: yarım genişlikte simge kutusu küçülmez ve adın İÇİNDE değildir', () => {
    const b = ciz({ durum: 'gelmedi' }, { ...tamKonum, sutun: 1, sutunSayisi: 2 })
    const simgeler = b.querySelector('[data-testid="durum-simgeleri"]') as HTMLElement
    const ad = b.querySelector('[data-testid="blok-adi"]') as HTMLElement
    expect(simgeler.className).toContain('shrink-0')
    expect(simgeler.getAttribute('aria-hidden')).toBe('true')
    expect(ad.className).toContain('min-w-0')
    expect(ad.contains(simgeler)).toBe(false)
  })
})

// Ödeme simgesi borç kuralının KENDİSİNDEN türer (tasarım T1): kural
// `borc.ts`'te, örnekleri sunucuyla ortak. Simge metni kuralı yeniden
// yazsaydı bu döngü bir satırda ayrışırdı.
describe('durumSimgeMetni — borç kuralıyla ORTAK örnekler', () => {
  it('örnek dosyası tam', () => expect(ornekler.length).toBeGreaterThanOrEqual(24))
  for (const o of ornekler) {
    it(o.ad, () => {
      const metin = durumSimgeMetni({ durum: o.durum, odendi: o.odendi, ucret: o.ucret })
      expect(metin.includes('ödeme alınmadı')).toBe(o.borca_girer)
      expect(metin.includes('gelmedi')).toBe(o.durum === 'gelmedi')
    })
  }
})
```

- [ ] **Adım 3: Kırmızıyı gör**

Çalıştır (web/): `npx vitest run src/takvim/RandevuBloku.test.tsx`
Beklenen: FAIL — `./durumSimgesi` çözülemiyor.

- [ ] **Adım 4: Yardımcıyı ve simge bileşenini yaz**

`web/src/takvim/durumSimgesi.ts`:

```ts
import { borcaGirerMi } from '../borc'

/**
 * Takvim bloğunun (ve önceki notlar satırının) durum simgeleri — tasarım T1-T3.
 *
 * Simgeler yalnızca iki şeyi söyler: danışan gelmedi (`UserX`) ve ücret
 * alınmadı (`TurkishLira`). "Ödeme alınmadı" borç kuralının KENDİSİDİR
 * (`borc.ts::borcaGirerMi`, sunucuyla ortak örnekler): burada ikinci bir
 * kural yazılmaz. Geldi+ödendi, planlandı ve iptal simge taşımaz (T2).
 *
 * Erişilebilir ad simgenin anlamını SONA ekler (T3): "10:00 Ad, gelmedi,
 * ödeme alınmadı". Simgeler `aria-hidden`; anlam yalnızca bu metinle gider.
 */
export type DurumAlanlari = { durum: string; odendi: boolean; ucret: number | null }

export function gelmediMi(r: DurumAlanlari): boolean {
  return r.durum === 'gelmedi'
}

export function durumSimgeMetni(r: DurumAlanlari): string {
  return (gelmediMi(r) ? ', gelmedi' : '') + (borcaGirerMi(r) ? ', ödeme alınmadı' : '')
}
```

`web/src/takvim/DurumSimgeleri.tsx`:

```tsx
import { TurkishLira, UserX } from 'lucide-react'
import { borcaGirerMi } from '../borc'
import { gelmediMi, type DurumAlanlari } from './durumSimgesi'

/**
 * En fazla iki küçük simge (tasarım T1). `shrink-0`: dar (yarım genişlik)
 * blokta ad kırpılır, simge kırpılmaz (T4). `title` fareyle üstüne gelince
 * Türkçe açıklamayı gösterir; ekran okuyucu anlamı çağıranın erişilebilir
 * adından alır (`durumSimgeMetni`), bu yüzden kutu `aria-hidden`.
 */
export function DurumSimgeleri({ randevu }: { randevu: DurumAlanlari }) {
  const gelmedi = gelmediMi(randevu)
  const borc = borcaGirerMi(randevu)
  if (!gelmedi && !borc) return null
  return (
    <span data-testid="durum-simgeleri" aria-hidden="true" className="flex shrink-0 items-center gap-0.5 pt-px">
      {gelmedi && (
        <span data-simge="gelmedi" title="Gelmedi">
          <UserX size={12} strokeWidth={2.5} />
        </span>
      )}
      {borc && (
        <span data-simge="odeme" title="Ödeme alınmadı">
          <TurkishLira size={12} strokeWidth={2.5} />
        </span>
      )}
    </span>
  )
}
```

- [ ] **Adım 5: Bloğu bağla** (`web/src/takvim/RandevuBloku.tsx`)

İçe aktarmalara ekle: `import { DurumSimgeleri } from './DurumSimgeleri'` ve `import { durumSimgeMetni } from './durumSimgesi'`. Fonksiyon gövdesinin başına `const saat = randevu.baslangic.slice(11, 16)`. `<button>`'a `aria-label={`${saat} ${randevu.danisan_adi}${durumSimgeMetni(randevu)}`}` ekle (yorum: "Erişilebilir ad tasarım T3: simgelerin anlamı sona eklenir; durumsuz blokta ad metinle birebir aynı"). `className`'de `flex items-start` → `flex items-start gap-0.5`. İç `<span className="min-w-0 break-words">` → `<span data-testid="blok-adi" className="min-w-0 flex-1 break-words">` ve içinde `randevu.baslangic.slice(11, 16)` yerine `saat`. Bu span'in hemen ARDINA (düğmenin son çocuğu olarak) `<DurumSimgeleri randevu={randevu} />`. Var olan "gerçek metin boşluğu" yorumu yerinde kalır.

- [ ] **Adım 6: Yeşili gör** — `npx vitest run src/takvim/RandevuBloku.test.tsx` → PASS.

- [ ] **Adım 7: Birim test yardımcılarını genişlet**

`web/src/screens/AnaEkran.test.tsx` L14 ve `web/src/screens/AnaEkran.yayilim.test.tsx` L15:

```ts
// Ad durum eklerini taşıyabilir (tasarım T3): "10:00 Ad, gelmedi, ödeme alınmadı".
const blokAdi = (ad: string) => new RegExp(`^\\d{2}:\\d{2} ${ad}(, gelmedi)?(, ödeme alınmadı)?$`)
```

Çalıştır (web/): `npx vitest run` → hepsi PASS (bugünkü sayıyı + 30 yeni testi yaz).

- [ ] **Adım 8: E2E'yi güncelle ve T4'ü gerçek yerleşimde ölç** (`e2e/takvim.spec.ts`)

İlk testte (`danisan ekle, randevu olustur, geldi isaretle`) ücret 450 ve ödenmemiş: "Geldi"den sonra ad `, ödeme alınmadı` eki alır ve TAM ad eşleşmesi bloğu kaybeder. Satırı değiştir:

```ts
  const blok = page
    .getByTestId('takvim-izgara')
    .getByRole('button', { name: /^10:00 Ayşe Yılmaz(, gelmedi)?(, ödeme alınmadı)?$/ })
```

ve dosyanın sonuna:

```ts
// Tasarım T4: dar (yarım genişlik) blokta ad kırpılır, simge KIRPILMAZ.
// jsdom yerleşim ölçmediği için tek bekçi gerçek tarayıcıdır.
test('yarim genislikteki blokta gelmedi ve odeme simgeleri kirpilmaz', async ({ page }) => {
  await kurulumYap(page)
  const ad = 'Simge Deneme'
  await page.getByRole('tab', { name: 'Danışanlar', exact: true }).click()
  await page.getByRole('button', { name: 'Danışan ekle' }).click()
  await page.getByLabel('Ad soyad').fill(ad)
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByText(ad, { exact: true }).first()).toBeVisible()
  await page.getByRole('tab', { name: 'Takvim', exact: true }).click()

  // İlk boş 16:00 hücresinin GÜNÜ; ikinci randevu aynı güne, çakışan saate.
  const ilkHucre = page.locator('button[aria-label$="16:00 boş"]').first()
  const gun = ((await ilkHucre.getAttribute('aria-label')) ?? '').replace(/ 16:00 boş$/, '')
  await ilkHucre.click()
  await page.getByLabel('Danışan', { exact: true }).selectOption({ label: ad })
  await page.getByLabel('Ücret (TL)').fill('450')
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click()
  const izgara = page.getByTestId('takvim-izgara')
  const ilk = izgara.getByRole('button', { name: new RegExp(`^16:00 ${ad}`) })
  await expect(ilk).toBeVisible()

  await page.getByRole('button', { name: `${gun} 17:00 boş`, exact: true }).click()
  await page.getByLabel('Danışan', { exact: true }).selectOption({ label: ad })
  await page.getByLabel('Başlangıç', { exact: true }).fill('16:30')
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click()
  const ikinci = izgara.getByRole('button', { name: `16:30 ${ad}`, exact: true })
  await expect(ikinci).toBeVisible()

  await ilk.click()
  await page.getByRole('button', { name: 'Gelmedi', exact: true }).click()
  // BARİYER: durum ızgaraya yansıdı (ad eki ve data-durum).
  await expect(ilk).toHaveAttribute('data-durum', 'gelmedi')
  await expect(ilk).toHaveAccessibleName(`16:00 ${ad}, gelmedi, ödeme alınmadı`)

  const blokKutu = await ilk.boundingBox()
  const ikinciKutu = await ikinci.boundingBox()
  expect(blokKutu).not.toBeNull()
  expect(ikinciKutu).not.toBeNull()
  // ÖN KOŞUL: gerçekten yan yana yarım genişlik (tam genişlikte test hiçbir şey ölçmezdi).
  expect((blokKutu?.x ?? 0) + (blokKutu?.width ?? 0)).toBeLessThanOrEqual((ikinciKutu?.x ?? 0) + 1)
  for (const simge of ['gelmedi', 'odeme']) {
    const k = await ilk.locator(`[data-simge="${simge}"]`).boundingBox()
    expect(k, simge).not.toBeNull()
    expect(k!.width, simge).toBeGreaterThan(8)
    expect(k!.x, simge).toBeGreaterThanOrEqual(blokKutu!.x - 0.5)
    expect(k!.x + k!.width, simge).toBeLessThanOrEqual(blokKutu!.x + blokKutu!.width + 0.5)
    expect(k!.y + k!.height, simge).toBeLessThanOrEqual(blokKutu!.y + blokKutu!.height + 0.5)
  }
})
```

Çalıştır (kök, PATH önekiyle): `npx playwright test e2e/takvim.spec.ts --reporter=line` → PASS.

- [ ] **Adım 9: Tam doğrulama**

`npm --prefix web run build` (hata yok), `npm --prefix web run lint` (uyarı sayısı değişmedi), web/ içinde `npx vitest run` (PASS), `npx playwright test --reporter=line` (PASS).

- [ ] **Adım 10: Commit**

```bash
git add web/package.json web/package-lock.json web/src/takvim/durumSimgesi.ts web/src/takvim/DurumSimgeleri.tsx web/src/takvim/RandevuBloku.tsx web/src/takvim/RandevuBloku.test.tsx web/src/screens/AnaEkran.test.tsx web/src/screens/AnaEkran.yayilim.test.tsx e2e/takvim.spec.ts
git commit -m "Takvim: gelmedi ve odeme alinmadi simgeleri, erisilebilir ad eki

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Mutasyonlar:**
- `durumSimgeMetni`'de `borcaGirerMi(r)` → `!r.odendi` → ortak örneklerden "planlandi odenmedi ucretli" ve T2 testi kırılır.
- `DurumSimgeleri`'den `shrink-0`'ı sil → T4 birim testi kırılır.
- `aria-label`'dan `durumSimgeMetni(...)` çağrısını sil → T1/T3 testleri ve e2e `toHaveAccessibleName` kırılır.

---

### Task 2: Sunucu düz metin, önizleme ve danışan adı (spec §6 S1–S6, S5b)

**Files:**
- Create: `core/src/store/duz_metin.rs`
- Create: `core/src/store/duz_metin_ornekleri.json`
- Modify: `core/src/store/mod.rs` (modül listesi)
- Modify: `core/src/store/schema.rs` (`CURRENT_VERSION` L4; `V6_SUTUNLAR` + `duz_metni_doldur` `V3_SUTUNLAR`'ın altına; `adimlari_uygula` `if mevcut < 5` bloğunun altına; testler L692, ~L1836, ~L1917 ve yeni test)
- Modify: `core/src/store/notes.rs` (`SeansNotu` L155–183, `randevunun_danisani` L219–231, `not_getir`, `not_kaydet`, `ozel_not_getir`/`ozel_not_kaydet` çağrı biçimi, `danisan_notlari` sorgusu, testler)
- Modify: `core/src/store/danisan_seanslari.rs` (modül başlığının "Önizleme" ve "Görev 3" bölümleri, ana sorgu `p.icerik`, `sablon_baslik_satirlari` görünürlüğü, L320–549 yardımcılar, testler)
- Rewrite: `core/src/store/onizleme_ornekleri.json`
- Modify: `core/src/store/search.rs` (`SORGU_NOT`, `ara` içindeki not demeti, "Türkçe katlama" başlık cümlesi, yeni test)
- Modify: `core/src/store/veri_raporu.rs` (not sorgusu ~L322–348, yeni test)
- Modify: `server/tests/notlar_api.rs` (yeni test)
- Modify: `web/src/api.ts` (`SeansNotu` ~L531)
- Modify: `web/src/screens/AnaEkran.tsx` (L10 import, `seansNotuKaydet` L430–435 ve üstündeki yorum)
- Delete: `web/src/seans/onizleme.ts`, `web/src/seans/onizleme.test.ts`
- Modify (fixture): `web/src/danisan/DanisanDosyasi.test.tsx` (`not()` L61), `web/src/seans/SeansPaneli.test.tsx` (`resmiNot`, `gecmisNotlar`), `web/src/seans/GecmisNotlar.test.tsx`, `web/src/screens/AnaEkran.test.tsx` (`notYaniti` resmî dalı), `web/src/screens/AnaEkran.yayilim.test.tsx` (L6 import, `notYaniti` L258, `/seanslar` L454)

**Interfaces:**
- Produces (Rust): `pub fn html_duz_metin(html: &str) -> String` (`psikolog_core::store::duz_metin`).
- Produces (Rust): `SeansNotu { appointment_id: i64, client_id: i64, danisan_adi: String, seans_zamani: String, sablon: String, icerik: String, onizleme: Option<String>, guncelleme_zamani: String }` — `onizleme` not satırı yoksa `None`.
- Produces (Rust, crate içi): `pub(crate) fn onizleme(duz_metin: &str, baslik_satirlari: &[String]) -> String`, `pub(crate) fn sablon_baslik_satirlari(conn: &Connection) -> Result<Vec<String>, DepoHatasi>` (`danisan_seanslari`).
- Produces (Rust): `schema::CURRENT_VERSION == 6`; `progress_notes.duz_metin TEXT NOT NULL DEFAULT ''`.
- Produces (TS): `SeansNotu` += `danisan_adi: string`, `onizleme: string | null`.
- Removes (TS): `web/src/seans/onizleme.ts::notOnizlemesi`, `AZAMI_ONIZLEME`.

- [ ] **Adım 1: Ortak örnek dosyasını yaz** (`core/src/store/duz_metin_ornekleri.json`)

```json
[
  { "ad": "bos girdi", "html": "", "beklenen": "" },
  { "ad": "etiketsiz duz metin oldugu gibi", "html": "Danışan geldi", "beklenen": "Danışan geldi" },
  { "ad": "iki paragraf arada bir bos satir", "html": "<p>bir</p><p>iki</p>", "beklenen": "bir\n\niki" },
  { "ad": "br satir sonu", "html": "<p>bir<br>iki</p>", "beklenen": "bir\niki" },
  { "ad": "kendiliginden kapanan br", "html": "<p>bir<br/>iki<br />üç</p>", "beklenen": "bir\niki\nüç" },
  { "ad": "baslik ve paragraf", "html": "<h2>Veri</h2><p>metin</p>", "beklenen": "Veri\n\nmetin" },
  { "ad": "satir ici bicim metni bolmez", "html": "<p>çok <strong>önemli</strong> bir <em>konu</em></p>", "beklenen": "çok önemli bir konu" },
  { "ad": "kelime ortasindaki bicim", "html": "<p>ön<strong>em</strong>li</p>", "beklenen": "önemli" },
  { "ad": "ic ice liste", "html": "<ul><li><p>bir</p><ul><li><p>iki</p></li></ul></li><li><p>üç</p></li></ul>", "beklenen": "bir\n\niki\n\nüç" },
  { "ad": "onay listesi isaret tasimaz", "html": "<ul data-type=\"taskList\"><li data-checked=\"true\" data-type=\"taskItem\"><label><input type=\"checkbox\" checked=\"checked\"><span></span></label><div><p>ödev tamam</p></div></li><li data-checked=\"false\" data-type=\"taskItem\"><label><input type=\"checkbox\"><span></span></label><div><p>ödev bekliyor</p></div></li></ul>", "beklenen": "ödev tamam\n\nödev bekliyor" },
  { "ad": "adli varliklar cozulur", "html": "<p>a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &apos;f&apos; g&nbsp;h</p>", "beklenen": "a & b <c> \"d\" 'e' 'f' g h" },
  { "ad": "sayisal varliklar cozulur", "html": "<p>&#305;&#x130;&#X15F;&#231;</p>", "beklenen": "ıİşç" },
  { "ad": "bilinmeyen ve gecersiz varlik oldugu gibi kalir", "html": "<p>&bilinmeyen; &#xZZ; &#0; &amp x</p>", "beklenen": "&bilinmeyen; &#xZZ; &#0; &amp x" },
  { "ad": "etiket adlari ve oznitelikler metne girmez", "html": "<p><span style=\"color:red\" data-x=\"strong\">kırmızı</span> <mark data-color=\"#ffe4e6\">vurgu</mark></p>", "beklenen": "kırmızı vurgu" },
  { "ad": "script ve style icerigi atilir", "html": "<p>önce</p><script>var s = \"<p>sızıntı</p>\";</script><style>p { color: red }</style><p>sonra</p>", "beklenen": "önce\n\nsonra" },
  { "ad": "yorum atilir", "html": "<p>a<!-- gizli yorum --> b</p>", "beklenen": "a b" },
  { "ad": "oznitelik icindeki buyuktur isareti", "html": "<p title=\"a>b\" data-y='c>d'>metin</p>", "beklenen": "metin" },
  { "ad": "bosluklar teke iner", "html": "<p>  çok    boşluk\t\tvar  </p>", "beklenen": "çok boşluk var" },
  { "ad": "pre icinde ic bosluk korunur, satir basi kirpilir", "html": "<pre><code>a  b\n  c</code></pre>", "beklenen": "a  b\nc" },
  { "ad": "ardisik bos paragraflar teke iner", "html": "<p>a</p><p></p><p></p><p>b</p>", "beklenen": "a\n\nb" },
  { "ad": "bas ve son bosluk kirpilir", "html": "<p>   </p><p> a </p><p></p>", "beklenen": "a" },
  { "ad": "alinti", "html": "<blockquote><p>alıntı</p></blockquote><p>sonra</p>", "beklenen": "alıntı\n\nsonra" },
  { "ad": "kapanmamis etiket geri kalanla atilir", "html": "<p>metin <strong", "beklenen": "metin" },
  { "ad": "etiket olmayan kucuktur isareti metindir", "html": "<p>3 < 5 ve 7 > 2</p>", "beklenen": "3 < 5 ve 7 > 2" },
  { "ad": "CRLF ve tek CR satir sonu sayilir", "html": "bir\r\niki\rüç", "beklenen": "bir\niki\nüç" },
  { "ad": "tablo hucreleri birlesmez", "html": "<table><tr><td>a</td><td>b</td></tr></table>", "beklenen": "a\n\nb" },
  { "ad": "buyuk harfli etiket adi", "html": "<P>Bir<BR>İki</P>", "beklenen": "Bir\nİki" },
  { "ad": "doctype ve islem talimati atilir", "html": "<!DOCTYPE html><?xml x?><p>x</p>", "beklenen": "x" },
  { "ad": "BOM bosluk sayilir", "html": "<p>﻿Uyku</p>", "beklenen": "Uyku" },
  { "ad": "eski duz metnin satir sonu korunur", "html": "İlk satır\nİkinci satır", "beklenen": "İlk satır\nİkinci satır" }
]
```

- [ ] **Adım 2: Başarısız Rust testlerini yaz**

`core/src/store/duz_metin.rs` (yalnızca test modülü ve boş gövdeli imza; derlensin diye):

```rust
//! HTML -> düz metin (tasarım 2026-09-26 §6 S2-S3).

pub fn html_duz_metin(_html: &str) -> String {
    String::new()
}

#[cfg(test)]
mod testler {
    use super::*;

    /// Kuralın TAMAMI ortak örnek dosyasında; sunucu tek uygulamadır
    /// (istemcide eşi yok). Boş bir dosya bu döngüyü totolojik yapardı.
    #[test]
    fn ortak_ornekleri_saglar() {
        let ornekler: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("duz_metin_ornekleri.json")).unwrap();
        assert!(ornekler.len() >= 25, "ornek dosyasi beklenenden kucuk");
        for o in &ornekler {
            let ad = o["ad"].as_str().unwrap();
            let html = o["html"].as_str().unwrap();
            let beklenen = o["beklenen"].as_str().unwrap();
            assert_eq!(html_duz_metin(html), beklenen, "ornek: {ad}");
        }
    }

    /// Girdi arayüzün kendi editöründen gelir ama uç nokta ham gövde alır:
    /// bozuk HTML panik değil, bir metin üretmeli.
    #[test]
    fn kontrolsuz_girdi_panik_uretmez() {
        for girdi in [
            "<", "&", "&#", "&#x", "&#x;", "<!--", "<!", "<?", "</", "<a", "<a \"", "<a '",
            "&#99999999999;", "&#xD800;", "\u{0}", "<p>", "</p></p></p>", "<script>", "ş<", "&ş;",
        ] {
            let _ = html_duz_metin(girdi);
        }
    }

    #[test]
    fn etiket_adi_ve_oznitelik_hicbir_bicimde_metne_girmez() {
        let d = html_duz_metin(r#"<p><strong class="span" data-a="em">kalın</strong></p>"#);
        assert_eq!(d, "kalın");
        for yok in ["strong", "span", "class", "data-a", "em", "<", ">"] {
            assert!(!d.contains(yok), "{yok} metne girdi: {d}");
        }
    }
}
```

`core/src/store/mod.rs`'e `pub mod veri_raporu;` satırının altına:

```rust
/// HTML not içeriğinden düz metin (tasarım 2026-09-26 S2-S3): arama,
/// önizleme ve veri raporu bu metne bakar; istemcide eşi yoktur.
pub mod duz_metin;
```

- [ ] **Adım 3: Kırmızıyı gör**

Çalıştır (PowerShell, PATH önekiyle): `cargo test -p psikolog-core duz_metin`
Beklenen: `ortak_ornekleri_saglar` "etiketsiz duz metin oldugu gibi" örneğinde, `etiket_adi_...` testinde FAIL.

- [ ] **Adım 4: Kuralı yaz** (`core/src/store/duz_metin.rs`, testlerin ÜSTÜ tümüyle)

```rust
//! HTML -> düz metin (tasarım 2026-09-26 §6 S2-S3).
//!
//! # Neden sunucuda ve neden tek fonksiyon
//!
//! Resmî not artık HTML saklar (`progress_notes.icerik`). Arama (`search`),
//! seans listesi önizlemesi (`danisan_seanslari::onizleme`), danışana özel
//! not araması ve veri raporu (PDF) HTML'e değil bu fonksiyonun ürettiği
//! `progress_notes.duz_metin` sütununa bakar. Sütunu yalnızca sunucu yazar
//! (`notes::not_kaydet`, aynı işlemde); istemci düz metin GÖNDERMEZ ve
//! kuralın istemcide eşi yoktur — iki uygulama yapısal olarak ayrışamaz.
//! Kural `duz_metin_ornekleri.json` ile sabitlenir.
//!
//! # Kural
//!
//! - Etiketler atılır; etiket adı ve öznitelikler metne GİRMEZ ("strong"
//!   aranınca not bulunmaz).
//! - Blok öğeleri (`BLOK_OGELERI`) açılışta ve kapanışta satır sonu üretir;
//!   `br` de. Tasarımın saydığı küme (`p`, `h1-6`, `li`, `blockquote`, `pre`,
//!   `br`, `tr`) + `td`/`th`/`div`/`ul`/`ol`/`hr`/`table` (bunlar olmadan
//!   tablo hücreleri ve onay listesi satırları birbirine yapışırdı).
//! - `script`/`style` içeriği tümüyle atılır; yorumlar ve `<!…>`/`<?…>`
//!   bildirimleri atılır.
//! - Varlıklar: `&amp; &lt; &gt; &quot; &apos; &nbsp;` ve sayısal
//!   (`&#305;`, `&#x130;`). `&nbsp;` düz boşluğa döner (arama "iki kelime"yi
//!   bulsun). Bilinmeyen/geçersiz varlık OLDUĞU GİBİ kalır.
//! - `pre` dışında boşluk/sekme kümesi tek boşluğa iner; ham `\n` (eski düz
//!   metin notları) satır sonu olarak korunur. `pre` içinde iç boşluk korunur.
//! - Her satır kırpılır (`store::bosluk_mu`: U+FEFF dâhil), ardışık boş
//!   satırlar TEK boş satıra iner, baştaki/sondaki boş satırlar atılır.
//! - Onay kutusu (`<input type="checkbox">`) metin taşımaz: `[ ]`/`[x]` yok.
//! - `<`'den sonra harf, `/`, `!` ya da `?` gelmiyorsa etiket değildir
//!   ("3 < 5"). Kapanmamış bir etiket (`<strong`) geri kalanla atılır.
//!
//! Girdi kendi editörümüzün şemasından gelir ama uç nokta ham gövde alır;
//! fonksiyon her girdiye bir metin döndürür, panik üretmez
//! (`kontrolsuz_girdi_panik_uretmez`).

/// Açılışı ve kapanışı satır sonu üreten öğeler (bkz. modül başlığı).
const BLOK_OGELERI: &[&str] = &[
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "br", "tr", "td",
    "th", "div", "ul", "ol", "hr", "table",
];

/// İçeriği metne HİÇ girmeyen öğeler.
const ICERIGI_ATILANLAR: &[&str] = &["script", "style"];

struct Etiket {
    ad: String,
    kapanis: bool,
}

pub fn html_duz_metin(html: &str) -> String {
    let normal = html.replace("\r\n", "\n").replace('\r', "\n");
    let k: Vec<char> = normal.chars().collect();
    let mut ham = String::with_capacity(normal.len());
    let mut pre = 0usize;
    let mut atlanan: Option<String> = None;
    let mut i = 0usize;
    while i < k.len() {
        if k[i] == '<' {
            if let Some((etiket, sonraki)) = etiket_oku(&k, i) {
                i = sonraki;
                let Some(Etiket { ad, kapanis }) = etiket else { continue };
                if let Some(beklenen) = &atlanan {
                    if kapanis && ad == *beklenen {
                        atlanan = None;
                    }
                    continue;
                }
                if !kapanis && ICERIGI_ATILANLAR.contains(&ad.as_str()) {
                    atlanan = Some(ad);
                    continue;
                }
                if ad == "pre" {
                    pre = if kapanis { pre.saturating_sub(1) } else { pre + 1 };
                }
                if BLOK_OGELERI.contains(&ad.as_str()) {
                    ham.push('\n');
                }
                continue;
            }
        }
        if atlanan.is_some() {
            i += 1;
            continue;
        }
        let (karakter, sonraki) =
            if k[i] == '&' { varlik_coz(&k, i).unwrap_or(('&', i + 1)) } else { (k[i], i + 1) };
        metin_ekle(&mut ham, karakter, pre > 0);
        i = sonraki;
    }
    satirlari_duzenle(&ham)
}

/// `bas` konumundaki `<`'i okur. `Some((Some(etiket), sonraki))`: bir etiket;
/// `Some((None, sonraki))`: atlanan bir yorum/bildirim ya da kapanmamış
/// etiket; `None`: etiket değil, `<` düz metindir.
fn etiket_oku(k: &[char], bas: usize) -> Option<(Option<Etiket>, usize)> {
    let sonraki = *k.get(bas + 1)?;
    if sonraki == '!' || sonraki == '?' {
        if k.get(bas + 1..bas + 4) == Some(&['!', '-', '-'][..]) {
            let son = bul(k, bas + 4, &['-', '-', '>']).map_or(k.len(), |p| p + 3);
            return Some((None, son));
        }
        let son = k[bas..].iter().position(|c| *c == '>').map_or(k.len(), |p| bas + p + 1);
        return Some((None, son));
    }
    let kapanis = sonraki == '/';
    let ad_bas = if kapanis { bas + 2 } else { bas + 1 };
    if !k.get(ad_bas).is_some_and(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let mut j = ad_bas;
    while j < k.len() && k[j].is_ascii_alphanumeric() {
        j += 1;
    }
    let ad = k[ad_bas..j].iter().collect::<String>().to_ascii_lowercase();
    let mut tirnak: Option<char> = None;
    while j < k.len() {
        let c = k[j];
        match tirnak {
            Some(t) if c == t => tirnak = None,
            Some(_) => {}
            None if c == '"' || c == '\'' => tirnak = Some(c),
            None if c == '>' => return Some((Some(Etiket { ad, kapanis }), j + 1)),
            None => {}
        }
        j += 1;
    }
    Some((None, k.len()))
}

fn bul(k: &[char], bas: usize, aranan: &[char]) -> Option<usize> {
    (bas..k.len()).find(|&i| k[i..].starts_with(aranan))
}

/// `&…;` varlığını çözer: `(karakter, sonraki_konum)`. Tanınmayan ya da
/// geçersiz varlık `None` (çağıran `&`'yi düz metin sayar).
fn varlik_coz(k: &[char], bas: usize) -> Option<(char, usize)> {
    // En uzun desteklenen biçim `&#x10FFFF;` (10 karakter).
    let son = (bas + 1..k.len().min(bas + 12)).find(|&i| k[i] == ';')?;
    let govde: String = k[bas + 1..son].iter().collect();
    let karakter = match govde.as_str() {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => ' ',
        _ => {
            let sayi = govde.strip_prefix('#')?;
            let (taban, rakamlar) = match sayi.strip_prefix(['x', 'X']) {
                Some(onaltilik) => (16, onaltilik),
                None => (10, sayi),
            };
            if rakamlar.is_empty() || !rakamlar.chars().all(|c| c.is_digit(taban)) {
                return None;
            }
            let deger = u32::from_str_radix(rakamlar, taban).ok()?;
            if deger == 0 {
                return None;
            }
            char::from_u32(deger)?
        }
    };
    Some((karakter, son + 1))
}

fn metin_ekle(ham: &mut String, k: char, pre_icinde: bool) {
    if k == '\n' {
        ham.push('\n');
        return;
    }
    if !pre_icinde && matches!(k, ' ' | '\t' | '\u{0C}') {
        if !ham.ends_with(' ') {
            ham.push(' ');
        }
        return;
    }
    ham.push(k);
}

fn satirlari_duzenle(ham: &str) -> String {
    let mut sonuc = String::with_capacity(ham.len());
    let mut bos_bekliyor = false;
    for satir in ham.split('\n') {
        let s = satir.trim_matches(super::bosluk_mu);
        if s.is_empty() {
            bos_bekliyor = !sonuc.is_empty();
            continue;
        }
        if !sonuc.is_empty() {
            sonuc.push('\n');
            if bos_bekliyor {
                sonuc.push('\n');
            }
        }
        bos_bekliyor = false;
        sonuc.push_str(s);
    }
    sonuc
}
```

- [ ] **Adım 5: Yeşili gör** — `cargo test -p psikolog-core duz_metin` → 3 PASS.

- [ ] **Adım 6: Göç testlerini yaz** (`core/src/store/schema.rs` test modülü)

`surum_bes_olarak_kaydedilir` → adı `surum_alti_olarak_kaydedilir`, yorumuna "Görev 2 (2026-09-26): 5 -> 6 (`progress_notes.duz_metin`)" ekle, `assert_eq!(…, 5)` → `6`. `v4_veritabani_veri_kaybetmeden_v5e_yukselir` (~L1836) ve `migrate_v5_ikinci_kez_calisinca_etiket_verisini_bozmaz` (~L1917) içindeki `assert_eq!(ham.parse::<i64>().unwrap(), 5)` → `CURRENT_VERSION` (bu iki testin konusu V5 tabloları; düz sayı pini `surum_alti_...`'da). Yeni testler:

```rust
    #[test]
    fn v5_veritabani_duz_metin_sutunuyla_doldurularak_guncel_surume_yukselir() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = crate::crypto::keyring::generate_data_key();
        v4_veritabani(&yol, &key);
        {
            let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
            c.execute_batch(V5).unwrap();
            c.execute("UPDATE app_meta SET deger='5' WHERE anahtar='schema_version'", []).unwrap();
            c.execute(
                "UPDATE progress_notes SET icerik = '<p>eski <strong>kalın</strong> &amp; not</p>' WHERE id = 1",
                [],
            )
            .unwrap();
            // ON KOSUL: sutun henuz YOK; yoksa asagidaki "dolduruldu" iddiasi
            // onceki bir gocten gelmis olabilirdi.
            let var: i64 = c
                .query_row(
                    "SELECT count(*) FROM pragma_table_info('progress_notes') WHERE name='duz_metin'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(var, 0, "on kosul: V5 veritabaninda duz_metin olmamali");
        }
        let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
        migrate(&c).unwrap();
        assert_eq!(okunan_surum(&c).unwrap(), 6);
        let (icerik, duz): (String, String) = c
            .query_row("SELECT icerik, duz_metin FROM progress_notes WHERE id = 1", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(icerik, "<p>eski <strong>kalın</strong> &amp; not</p>", "goc icerige dokunmamali");
        assert_eq!(duz, "eski kalın & not", "goc var olan notlarin duz metnini doldurmali");
        // Tasarim S2: ozel notlara duz metin sutunu EKLENMEZ (aranmaz, raporlanmaz).
        let ozel: i64 = c
            .query_row(
                "SELECT count(*) FROM pragma_table_info('private_notes') WHERE name='duz_metin'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ozel, 0);
        assert_eq!(randevu_ve_not_sayilari(&c), (1, 1, 1), "goc kayit kaybetmemeli");
    }

    #[test]
    fn v6_ikinci_kez_calisinca_duz_metni_bozmaz() {
        let (_d, c) = baglanti();
        c.execute_batch(
            "INSERT INTO clients (ad_soyad, durum, olusturma_zamani) VALUES ('A','aktif','z');
             INSERT INTO appointments (client_id, baslangic, bitis, durum, odendi, olusturma_zamani, guncelleme_zamani)
               VALUES (1,'2026-09-07T14:00','2026-09-07T15:00','planlandi',0,'z','z');
             INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, duz_metin, guncelleme_zamani)
               VALUES (1,1,'serbest','<p>x</p>','x','z');",
        )
        .unwrap();
        migrate(&c).unwrap();
        migrate(&c).unwrap();
        let duz: String =
            c.query_row("SELECT duz_metin FROM progress_notes WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(duz, "x");
    }
```

(`appointments` sütun listesi V4 tanımıyla uyuşmuyorsa `v3_veritabani`'daki INSERT'i örnek al; `ucret` NULL olabilir.)

- [ ] **Adım 7: Kırmızıyı gör** — `cargo test -p psikolog-core schema` → `surum_alti_...` (5≠6), `v5_veritabani_...` (sütun yok) FAIL.

- [ ] **Adım 8: Göçü yaz** (`schema.rs`)

`pub const CURRENT_VERSION: i64 = 6;`. `V3_SUTUNLAR`'ın altına:

```rust
/// Surum 6 (2026-09-26, tasarim S2): resmi notun duz metni. Sunucu her not
/// yaziminda HTML'den turetir (`store::duz_metin`); arama, onizleme ve rapor
/// bu sutuna bakar. Ozel not tablosuna EKLENMEZ.
const V6_SUTUNLAR: &[(&str, &str)] = &[("progress_notes", "duz_metin TEXT NOT NULL DEFAULT ''")];

/// V6 sutunu eklendikten sonra var olan notlarin duz metnini doldurur.
/// Idempotent: her calismada `icerik`ten yeniden hesaplar.
fn duz_metni_doldur(tx: &Connection) -> Result<(), MigrateHatasi> {
    let satirlar: Vec<(i64, String)> = {
        let mut ifade = tx.prepare("SELECT id, icerik FROM progress_notes")?;
        let okunan = ifade
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        okunan
    };
    let mut yaz = tx.prepare("UPDATE progress_notes SET duz_metin = ?1 WHERE id = ?2")?;
    for (id, icerik) in satirlar {
        yaz.execute(rusqlite::params![crate::store::duz_metin::html_duz_metin(&icerik), id])?;
    }
    Ok(())
}
```

`adimlari_uygula`'da `if mevcut < 5 { … }` bloğunun altına:

```rust
    if mevcut < 6 {
        for (tablo, tanim) in V6_SUTUNLAR {
            sutun_ekle(&tx, tablo, tanim)?;
        }
        duz_metni_doldur(&tx)?;
    }
```

- [ ] **Adım 9: Yeşili gör** — `cargo test -p psikolog-core schema` → PASS. `cargo test -p psikolog-core backup` → PASS (`v4_dolu_veritabani` yardımcısı önce güncel göçü koşup sonra V5'i geri alıyor; V6 sütunu kalır, `sutun_ekle` "duplicate column"u yutar).

- [ ] **Adım 10: Not deposu testlerini yaz** (`notes.rs` test modülü)

```rust
    #[test]
    fn not_kaydet_duz_metni_ayni_islemde_yazar_ve_onizlemeyi_dondurur() {
        let (_d, c, _cid, rid) = kurulum();
        let ilk = not_kaydet(&c, rid, "dap", "<h2>Veri</h2><p><strong>Kaygı</strong> &amp; uyku</p>", Cihaz::Masaustu)
            .unwrap();
        let duz = |c: &rusqlite::Connection| -> String {
            c.query_row("SELECT duz_metin FROM progress_notes WHERE appointment_id = ?1", [rid], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(duz(&c), "Veri\n\nKaygı & uyku");
        assert_eq!(ilk.onizleme.as_deref(), Some("Kaygı & uyku"));
        assert_eq!(ilk.danisan_adi, "Ayse Yilmaz");
        // UPSERT'in UPDATE dali da duz metni tazeler.
        not_kaydet(&c, rid, "dap", "<p>ikinci hâl</p>", Cihaz::Masaustu).unwrap();
        assert_eq!(duz(&c), "ikinci hâl");
        let okunan = not_getir(&c, rid, Cihaz::Masaustu).unwrap();
        assert_eq!(okunan.onizleme.as_deref(), Some("ikinci hâl"));
        assert_eq!(okunan.danisan_adi, "Ayse Yilmaz");
    }

    #[test]
    fn notu_olmayan_randevunun_onizlemesi_yoktur_bos_notunki_bos_dizgidir() {
        let (_d, c, _cid, rid) = kurulum();
        assert_eq!(not_getir(&c, rid, Cihaz::Masaustu).unwrap().onizleme, None);
        not_kaydet(&c, rid, "serbest", "", Cihaz::Masaustu).unwrap();
        assert_eq!(not_getir(&c, rid, Cihaz::Masaustu).unwrap().onizleme, Some(String::new()));
    }

    #[test]
    fn danisan_notlari_danisan_adini_ve_onizlemeyi_tasir() {
        let (_d, c, cid, rid) = kurulum();
        not_kaydet(&c, rid, "serbest", "<p>liste <em>önizlemesi</em></p>", Cihaz::Masaustu).unwrap();
        let liste = danisan_notlari(&c, cid, 10, None, Cihaz::Masaustu).unwrap();
        assert_eq!(liste[0].danisan_adi, "Ayse Yilmaz");
        assert_eq!(liste[0].onizleme.as_deref(), Some("liste önizlemesi"));
    }
```

`not_guncellemesi_audit_basarisiz_olursa_eski_icerik_korunur`'un sonuna:

```rust
        let duz: String = c
            .query_row("SELECT duz_metin FROM progress_notes WHERE appointment_id = ?1", [rid], |r| r.get(0))
            .unwrap();
        assert_eq!(duz, "ilk hali", "duz metin de ayni islemde geri alinmali");
```

`seans_notu_debug_ciktisi_icerigi_basmaz`'daki `SeansNotu { … }`'ya `danisan_adi: "GIZLI_DANISAN_ADI".into(), onizleme: Some("GIZLI_ONIZLEME".into()),` ekle ve:

```rust
        assert!(!metin.contains("GIZLI_DANISAN_ADI"), "Debug danisan adini basmamali: {metin}");
        assert!(!metin.contains("GIZLI_ONIZLEME"), "Debug onizlemeyi basmamali: {metin}");
```

- [ ] **Adım 11: Kırmızıyı gör** — `cargo test -p psikolog-core notes` → derleme hatası (alanlar yok) — beklenen.

- [ ] **Adım 12: Not deposunu değiştir** (`notes.rs`)

İçe aktarmalara: `use crate::store::danisan_seanslari::{onizleme, sablon_baslik_satirlari};` ve `use crate::store::duz_metin::html_duz_metin;`.

`SeansNotu`'ya (`client_id`'nin altına ve `icerik`'in altına):

```rust
    /// Randevunun danışanının adı (`clients.ad_soyad`, randevunun KENDİ
    /// danışanı — notun kopyası değil). Okuma penceresinin başlığı ayrı bir
    /// danışan isteği (ve denetim satırı) istemesin diye (tasarım S5b).
    pub danisan_adi: String,
```

```rust
    /// Sunucunun `duz_metin`'den hesapladığı önizleme (tasarım S5):
    /// `danisan_seanslari::onizleme` — dosya listesindeki `not_ilk_satiri`
    /// ile AYNI fonksiyon. Not satırı yoksa `None`, boş notta `Some("")`.
    pub onizleme: Option<String>,
```

`Debug` impl'ine `.field("danisan_adi", &"<gizli>")` ve `.field("onizleme", &self.onizleme.as_ref().map(|_| "<gizli>"))`.

`randevunun_danisani` → üçlü döner:

```rust
fn randevunun_danisani(
    conn: &Connection,
    appointment_id: i64,
) -> Result<(i64, String, String), DepoHatasi> {
    conn.query_row(
        "SELECT a.client_id, a.baslangic, c.ad_soyad
           FROM appointments a JOIN clients c ON c.id = a.client_id
          WHERE a.id = ?1",
        [appointment_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .optional()?
    .ok_or(DepoHatasi::Bulunamadi)
}
```

`ozel_not_getir`: `randevunun_danisani(conn, appointment_id)?;` aynen kalır; `ozel_not_kaydet`: `let (client_id, _, _) = …`.

`not_getir`: ilk satır `let (client_id, seans_zamani, danisan_adi) = …`; sorgu `SELECT sablon, icerik, duz_metin, guncelleme_zamani …` dörtlü okur; logdan önce `let basliklar = sablon_baslik_satirlari(conn)?;`; `Some((sablon, icerik, duz, zaman)) => SeansNotu { appointment_id, client_id, danisan_adi, seans_zamani, sablon, onizleme: Some(onizleme(&duz, &basliklar)), icerik, guncelleme_zamani: zaman }`; `None` dalında `danisan_adi` ve `onizleme: None`.

`not_kaydet`: `let (client_id, seans_zamani, danisan_adi) = …`; `let duz = html_duz_metin(icerik);` ve `let basliklar = sablon_baslik_satirlari(conn)?;` işlemden ÖNCE; INSERT:

```rust
    tx.execute(
        "INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, duz_metin, guncelleme_zamani)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(appointment_id) DO UPDATE SET
             sablon = excluded.sablon,
             icerik = excluded.icerik,
             duz_metin = excluded.duz_metin,
             guncelleme_zamani = excluded.guncelleme_zamani",
        rusqlite::params![appointment_id, client_id, sablon, icerik, duz, zaman],
    )?;
```

dönüşte `danisan_adi, onizleme: Some(onizleme(&duz, &basliklar)),`. Doküman yorumuna: "Düz metin (`html_duz_metin`) AYNI işlemde yazılır: log başarısızsa düz metin de geri alınır."

`danisan_notlari`: sorgudan önce `let basliklar = sablon_baslik_satirlari(conn)?;`; sorgu:

```sql
SELECT p.appointment_id, a.client_id, c.ad_soyad, a.baslangic, p.sablon, p.icerik,
       p.duz_metin, p.guncelleme_zamani
FROM progress_notes p
JOIN appointments a ON a.id = p.appointment_id
JOIN clients c ON c.id = a.client_id
WHERE a.client_id = ?1 AND (?3 IS NULL OR a.baslangic < ?3)
ORDER BY a.baslangic DESC, p.appointment_id DESC
LIMIT ?2
```

eşleme `danisan_adi: r.get(2)?, seans_zamani: r.get(3)?, sablon: r.get(4)?, icerik: r.get(5)?, onizleme: Some(onizleme(&r.get::<_, String>(6)?, &basliklar)), guncelleme_zamani: r.get(7)?`.

- [ ] **Adım 13: Önizlemeyi düz metne bağla** (`danisan_seanslari.rs`)

- `sablon_baslik_satirlari` → `pub(crate) fn`.
- Ana sorgu `…, a.odendi, p.icerik` → `…, a.odendi, p.duz_metin`; eşlemede `let duz: Option<String> = s.get(5)?;` ve `not_ilk_satiri: duz.map(|m| onizleme(&m, &basliklar)),`.
- `baslik_onekini_ayikla`, `sablon_baslik_eslesmesi`, `kalin_araliklari`, `italik_araliklari`, `bicim_isaretlerini_kaldir`, `italik_isaretlerini_kaldir`, `bicimden_arindir`, `onay_kutusu_ayikla`, `numarali_onekini_ayikla` SİL. `onizleme`'yi şununla değiştir:

```rust
/// Notun önizlemesi (tasarım S5): `duz_metin`'in ilk dolu satırı; şablon
/// başlığı olan satır ("Veri", "Değerlendirme", …; TAM eşleşme, tohumdan)
/// atlanır; `AZAMI_ONIZLEME` KARAKTERDE kırpılır. Yalnızca başlıklardan
/// oluşan not boş SAYILMAZ: ilk başlık döner. `""` yalnızca metin tümüyle
/// boşsa. Düz metin HTML'den türediği için biçim işareti ayıklamak gerekmez;
/// `SeansNotu::onizleme` de BU fonksiyondan gelir.
pub(crate) fn onizleme(duz_metin: &str, baslik_satirlari: &[String]) -> String {
    let mut ilk_baslik: Option<&str> = None;
    for satir in duz_metin.lines() {
        let s = satir.trim_matches(super::bosluk_mu);
        if s.is_empty() {
            continue;
        }
        if baslik_satirlari.iter().any(|b| b == s) {
            ilk_baslik.get_or_insert(s);
            continue;
        }
        return s.chars().take(AZAMI_ONIZLEME).collect();
    }
    ilk_baslik.unwrap_or_default().chars().take(AZAMI_ONIZLEME).collect()
}
```

- Modül başlığında "# Önizleme: ilk ANLAMLI satır" bölümünün "Arayüz, not kaydedildikten sonra…" cümlesini "Arayüz, kayıttan sonra listeyi YENİDEN ÇEKMEDEN `PUT` yanıtının `onizleme` alanıyla yamalar (`SeansNotu::onizleme` bu fonksiyondan gelir; istemcide eşi yok)." yap; "## Görev 3: Markdown biçimine uyum" bölümünü sil, yerine: "## 2026-09-26: HTML not, düz metin önizleme — önizleme `progress_notes.duz_metin`'den türer (`store::duz_metin`); başlık satırı yalnızca TAM ad eşleşmesiyle tanınır."
- `baslik_listesi_sablon_tablosundan_turetilir`: not içeriği `"<h2>Gözlem</h2><p>sakin görünüyordu</p>"`; ilk iddia `Some("Gözlem")`, UPDATE sonrası `Some("sakin görünüyordu")` (aynen).
- `ilk_satir_yalnizca_ilk_satirdir_ve_kirpilir`: içerik `format!("<p>{uzun}</p><p>{ikinci_satir}</p>")`.
- `onizleme_ortak_ornekleri_saglar`: döngü içinde `let not = not_kaydet(…).unwrap();` ve `assert_eq!(not.onizleme.as_deref(), Some(beklenen), "PUT yaniti ayni onizlemeyi tasimali: {ad}");`; eşik `>= 15`; test yorumundaki "`web/src/seans/onizleme.test.ts` ayni dosyayi okur" cümlesi → "istemcide eşi yok; `SeansNotu::onizleme` ile liste önizlemesi AYNI fonksiyondan (yukarıdaki iki iddia)". Bölüm yorumu "Gorev 3 incelemesi …" → "Ornekler HTML girdiyle `onizleme_ornekleri.json`'da".

- [ ] **Adım 14: Önizleme örneklerini yeniden yaz** (`core/src/store/onizleme_ornekleri.json`, TAMAMI)

```json
[
  { "ad": "duz paragraf", "icerik": "<p>Danışan bugün daha rahattı</p>", "beklenen": "Danışan bugün daha rahattı" },
  { "ad": "bos paragraflardan sonra ilk dolu satir", "icerik": "<p></p><p>   </p><p>Uyku düzeni iyileşmiş</p><p>ikinci satır</p>", "beklenen": "Uyku düzeni iyileşmiş" },
  { "ad": "DAP sablonlu not baslik satirlarini atlar", "icerik": "<h2>Veri</h2><p></p><p>İş yerinde çatışma yaşamış</p><h2>Değerlendirme</h2><p></p><h2>Plan</h2><p></p>", "beklenen": "İş yerinde çatışma yaşamış" },
  { "ad": "SOAP ilk bolum bos, sonraki dolu", "icerik": "<h2>Öznel</h2><p></p><h2>Nesnel</h2><p>Göz teması kurdu</p>", "beklenen": "Göz teması kurdu" },
  { "ad": "baslik adiyla baslayan metin baslik SAYILMAZ", "icerik": "<h2>Veri annesiyle görüşmüş</h2><h2>Plan</h2>", "beklenen": "Veri annesiyle görüşmüş" },
  { "ad": "yalnizca sablon basliklari: ilk baslik doner", "icerik": "<h2>Veri</h2><p></p><h2>Değerlendirme</h2><p></p><h2>Plan</h2><p></p>", "beklenen": "Veri" },
  { "ad": "tamamen bos not", "icerik": "", "beklenen": "" },
  { "ad": "yalnizca bos paragraf", "icerik": "<p></p>", "beklenen": "" },
  { "ad": "bicim etiketleri onizlemede gorunmez", "icerik": "<p><strong>Danışan</strong> <em>kaygılı</em> görünüyordu</p>", "beklenen": "Danışan kaygılı görünüyordu" },
  { "ad": "liste maddesi", "icerik": "<ul><li><p>İlk madde</p></li><li><p>ikinci</p></li></ul>", "beklenen": "İlk madde" },
  { "ad": "onay listesi isaret tasimaz", "icerik": "<ul data-type=\"taskList\"><li data-checked=\"true\" data-type=\"taskItem\"><label><input type=\"checkbox\" checked=\"checked\"><span></span></label><div><p>ödev tamam</p></div></li></ul>", "beklenen": "ödev tamam" },
  { "ad": "varliklar cozulmus gorunur", "icerik": "<p>Tom &amp; Jerry &quot;tanışma&quot;</p>", "beklenen": "Tom & Jerry \"tanışma\"" },
  { "ad": "br ile bolunmus paragrafin ilk satiri", "icerik": "<p>Birinci satır<br>ikinci satır</p>", "beklenen": "Birinci satır" },
  { "ad": "BOM bosluk sayilir", "icerik": "<p>﻿Uyku düzeni iyileşmiş</p>", "beklenen": "Uyku düzeni iyileşmiş" },
  { "ad": "sablonda olmayan baslik atlanmaz", "icerik": "<h3>Serbest başlık</h3><p>metin</p>", "beklenen": "Serbest başlık" },
  { "ad": "kod blogu", "icerik": "<pre><code>let x = 1;</code></pre>", "beklenen": "let x = 1;" },
  { "ad": "etiketsiz eski duz not", "icerik": "Danışan geldi\nikinci", "beklenen": "Danışan geldi" },
  { "ad": "baslik eslesmesi harf duyarlidir (tohumdaki bicim)", "icerik": "<h2>veri</h2><p>x</p>", "beklenen": "veri" },
  { "ad": "alinti", "icerik": "<blockquote><p>Annesi: \"Yorgunum\"</p></blockquote>", "beklenen": "Annesi: \"Yorgunum\"" }
]
```

- [ ] **Adım 15: Aramayı ve raporu düz metne bağla**

`search.rs`: `SORGU_NOT`'ta iki `p.icerik` → `p.duz_metin` (SELECT listesi ve `lower(p.icerik)`); doküman yorumuna "Not metni `duz_metin`'den (HTML değil): biçim etiketi araya girse de metin bulunur, etiket adı eşleşmez (tasarım S4)." Test modülüne:

```rust
    #[test]
    fn bicim_etiketleri_bolse_de_metin_bulunur_etiket_adi_bulunmaz() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "serbest", "<p>çok <strong>önemli</strong> bir <em>konu</em></p>", Cihaz::Masaustu)
            .unwrap();
        // ARTI YÖN: etiketin böldüğü ifade Türkçe katlamayla bulunur; parça düz metin.
        let bulunan = sonuclar_of(&c, "COK ONEMLI", 20, Cihaz::Masaustu).unwrap();
        let not = bulunan.iter().find(|s| s.tur == "not").expect("bicimle bolunmus ifade bulunmali");
        assert!(not.parca.contains("çok önemli bir konu"), "{}", not.parca);
        assert!(!not.parca.contains('<'), "parca HTML tasimamali: {}", not.parca);
        // EKSİ YÖN: etiket adı ve öznitelik metin değildir.
        for terim in ["strong", "<em>", "p>"] {
            assert!(
                sonuclar_of(&c, terim, 20, Cihaz::Masaustu).unwrap().iter().all(|s| s.tur != "not"),
                "{terim} not buldu"
            );
        }
    }
```

`veri_raporu.rs`: not sorgusunda `p.icerik` → `p.duz_metin`, döngü değişkeni `icerik` → `duz_metin`; modül başlığına "# Not satırları düz metindir — `progress_notes.duz_metin` (tasarım S6); PDF'te HTML etiketi görünmez." Test:

```rust
    #[test]
    fn not_satirlari_duz_metinden_gelir_html_etiketi_gorunmez() {
        let (_d, c) = baglanti();
        let cid = danisan(&c, "Ayse Yilmaz");
        let r = randevu(&c, cid, "2026-09-01T10:00", "2026-09-01T11:00");
        not_kaydet(&c, r, "dap", "<h2>Veri</h2><p><strong>HTMLKANARYA</strong> &amp; devam</p>", Cihaz::Masaustu)
            .unwrap();
        let metin = duz(&rapor_icerigi(&c, cid).unwrap());
        assert!(metin.contains("HTMLKANARYA & devam"), "{metin}");
        assert!(metin.contains("Veri"), "{metin}");
        for etiket in ["<h2>", "<p>", "<strong>", "&amp;"] {
            assert!(!metin.contains(etiket), "rapor HTML tasimamali: {etiket}\n{metin}");
        }
    }
```

- [ ] **Adım 16: HTTP testini yaz** (`server/tests/notlar_api.rs`, `not_yanitlari_seans_zamanini_tasir`'ın altına)

```rust
#[tokio::test]
async fn not_yaniti_sunucunun_onizlemesini_ve_danisan_adini_tasir() {
    let (_d, s, cid, rid) = dolu_state().await;
    let (kod, yanit) = cagir(
        &s,
        "PUT",
        &format!("/api/randevular/{rid}/not"),
        Some(json!({"sablon":"dap","icerik":"<h2>Veri</h2><p><strong>Kaygı</strong> azaldı</p>"})),
    )
    .await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(yanit["onizleme"], json!("Kaygı azaldı"));
    assert_eq!(yanit["danisan_adi"], json!("Ayse Yilmaz"));
    let (_, okunan) = cagir(&s, "GET", &format!("/api/randevular/{rid}/not"), None).await;
    assert_eq!(okunan["onizleme"], json!("Kaygı azaldı"));
    // Notu olmayan randevu: önizleme `null` (dosya listesindeki `not_ilk_satiri` ile aynı anlam).
    let bos = randevu_ekle(&s, cid, "2026-09-08").await;
    let (_, bos_not) = cagir(&s, "GET", &format!("/api/randevular/{bos}/not"), None).await;
    assert!(bos_not["onizleme"].is_null(), "{bos_not}");
    assert_eq!(bos_not["danisan_adi"], json!("Ayse Yilmaz"));
}
```

- [ ] **Adım 17: Yeşili gör (Rust)** — `npm --prefix web run build`, sonra `cargo test --workspace` → PASS (yapısal `private_notes` testleri dâhil). Hata ayıklarken `cargo test -p psikolog-core` ve `cargo test -p psikolog-server --test notlar_api`.

- [ ] **Adım 18: İstemci tipini ve yamayı değiştir**

`web/src/api.ts` `SeansNotu`:

```ts
export type SeansNotu = {
  appointment_id: number
  client_id: number
  /** Randevunun danışanı — okuma penceresinin başlığı (tasarım S5b). */
  danisan_adi: string
  /** Randevunun başlangıcı — yerel naive biçim (`2026-09-07T10:00`). */
  seans_zamani: string
  sablon: string
  /** HTML (tasarım S1). Boş dizge "not yok". */
  icerik: string
  /**
   * Sunucunun `duz_metin`'den hesapladığı önizleme (tasarım S5) — dosya
   * listesindeki `not_ilk_satiri` ile AYNI fonksiyon. Not satırı yoksa
   * `null`, boş notta `''`. İstemcide eşi YOK.
   */
  onizleme: string | null
  guncelleme_zamani: string
}
```

`web/src/screens/AnaEkran.tsx`: L10 `import { notOnizlemesi } from '../seans/onizleme'` sil; `seansNotuKaydet`'in son satırı `seanslar.yamala(id, { not_ilk_satiri: yeni.onizleme })`; üstteki yorumda "`seanslar.yamala` — dosya listesindeki önizleme (`not_ilk_satiri`, sunucuyla AYNI kural: `seans/onizleme.ts`)" → "(`not_ilk_satiri`, PUT yanıtının sunucuda hesaplanan `onizleme`'si — istemcide eşi yok)".

`Remove-Item web/src/seans/onizleme.ts, web/src/seans/onizleme.test.ts` (dosya sistemi silmesi; `git rm` DEĞİL — silme, commit adımındaki `git add` ile sahnelenir; `git rm`'lenmiş yol `git add`'e verilirse `pathspec did not match` ile bütün komut düşer).

Test fikstürleri (derleme `tsc -b` testleri de denetler):
- `DanisanDosyasi.test.tsx` `not()`: `danisan_adi: 'Ayşe Kaya', onizleme: null,`.
- `SeansPaneli.test.tsx` `resmiNot` ve `gecmisNotlar`'ın üç öğesi: `danisan_adi: 'Ayşe Yılmaz', onizleme: null,`.
- `GecmisNotlar.test.tsx` fikstürü: aynı iki alan.
- `AnaEkran.test.tsx` `notYaniti` resmî dalı: yanıta `danisan_adi: randevu.danisan_adi, onizleme: id in sunucuNotlari ? onizlemeTaklidi(kayit.icerik) : null,`; dosyanın üst kısmına:

```ts
// Sunucunun önizlemesinin TAKLİDİ (istemcide gerçek eşi yok, tasarım S5):
// etiketleri at, ilk dolu satır. Yalnızca sahte sunucu yanıtı için.
const onizlemeTaklidi = (icerik: string) =>
  icerik.replace(/<[^>]*>/g, '\n').split('\n').map((s) => s.trim()).find((s) => s !== '') ?? ''
```

- `AnaEkran.yayilim.test.tsx`: L6 import'u sil, aynı `onizlemeTaklidi`'ni ekle; `notYaniti` (L258) dönüşüne `danisan_adi: r.danisan_adi, onizleme: notlar[id] ? onizlemeTaklidi(notlar[id].icerik) : null,`; L454 `notOnizlemesi(` → `onizlemeTaklidi(`.

- [ ] **Adım 19: Yeşili gör (web)** — `npm --prefix web run build` (tip hatası yok), web/ içinde `npx vitest run` → PASS (onizleme.test.ts'in testleri düştü; sayıyı yaz). `npm --prefix web run lint` → uyarı sayısı aynı.

- [ ] **Adım 20: E2E** — `npx playwright test e2e/notlar.spec.ts e2e/notlar-gelismis.spec.ts e2e/kabuk.spec.ts --reporter=line` → PASS (arama ve dosya listesi önizlemesi düz metin notlarla aynı davranır).

- [ ] **Adım 21: Commit**

```bash
git add core/src/store/duz_metin.rs core/src/store/duz_metin_ornekleri.json core/src/store/mod.rs core/src/store/schema.rs core/src/store/notes.rs core/src/store/danisan_seanslari.rs core/src/store/onizleme_ornekleri.json core/src/store/search.rs core/src/store/veri_raporu.rs server/tests/notlar_api.rs web/src/api.ts web/src/screens/AnaEkran.tsx web/src/seans/onizleme.ts web/src/seans/onizleme.test.ts web/src/danisan/DanisanDosyasi.test.tsx web/src/seans/SeansPaneli.test.tsx web/src/seans/GecmisNotlar.test.tsx web/src/screens/AnaEkran.test.tsx web/src/screens/AnaEkran.yayilim.test.tsx
git commit -m "Sunucu: duz_metin sutunu, arama/onizleme/rapor duz metinden, SeansNotu onizleme ve danisan adi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Mutasyonlar:**
- `not_kaydet`'te `duz_metin = excluded.duz_metin,` satırını sil → `not_kaydet_duz_metni_ayni_islemde_yazar_…` ("ikinci hâl") kırılır.
- `SORGU_NOT`'un `WHERE`'inde `lower(p.duz_metin)` → `lower(p.icerik)` → `bicim_etiketleri_bolse_de_…` ("strong" not buldu) kırılır.
- `varlik_coz`'dan `"amp" => '&',` sil → ortak örnek "adli varliklar cozulur" kırılır.
- `ICERIGI_ATILANLAR`'ı `&[]` yap → "script ve style icerigi atilir" kırılır.
- `adimlari_uygula`'dan `duz_metni_doldur(&tx)?;` sil → `v5_veritabani_duz_metin_…` kırılır.
- `veri_raporu`'nda `p.duz_metin` → `p.icerik` → `not_satirlari_duz_metinden_gelir_…` kırılır.
- `AnaEkran.seansNotuKaydet`'te `yeni.onizleme` → `null` → yayılım testi "takvimde not yazılınca dosya listesindeki önizleme YENİ metni gösterir" kırılır.

---

### Task 3: Sunucu — danışana özel not araması (spec §6 S8)

**Files:**
- Modify: `core/src/store/search.rs` (içe aktarma `OptionalExtension`; `SORGU_ETIKET`'in altına yeni sorgu; `ara`'nın altına yeni fonksiyon ve tip; "Türkçe katlama" başlığındaki "üç yerde" → "dört yerde"; testler)
- Modify: `server/src/routes/notes.rs` (içe aktarma, yeni sorgu tipi ve handler)
- Modify: `server/src/lib.rs` (`/danisanlar/{id}/seanslar` rotasının altına)
- Modify: `server/tests/notlar_api.rs` (L185 kilitli uç listesi, L~300 sorgu tablosu, L2356 toplam, yeni test)
- Modify: `web/src/api.ts` (`notApi`'ye `notAra`, yeni tip)
- Modify: `web/src/api.test.ts` (`notApi` bloğu ve "hiçbir fonksiyonu ozel-not yoluna gitmez")

**Interfaces:**
- Produces (Rust): `pub struct NotAramaSonucu { pub appointment_id: i64, pub seans_zamani: String, pub parca: String }` (`Serialize`, elle `Debug`).
- Produces (Rust): `pub fn danisan_notlarinda_ara(conn: &Connection, client_id: i64, sorgu: &str, once: Option<&str>, cihaz: Cihaz) -> Result<Vec<NotAramaSonucu>, DepoHatasi>`.
- Produces (HTTP): `GET /api/danisanlar/{id}/not-ara?q=<terim>&once=<YYYY-AA-GGTSS:DD>` → `200 [{appointment_id, seans_zamani, parca}]`, yeniden eskiye, ≤ 50; kilitliyken 401; `q` eksikse 400 "Sorgu parametreleri eksik veya geçersiz."; olmayan danışan 404 (terim ≥ 2 karakterken).
- Produces (TS): `export type NotAramaSonucu = { appointment_id: number; seans_zamani: string; parca: string }`; `notApi.notAra(danisanId: number, sorgu: string, once?: string): Promise<NotAramaSonucu[]>`.
- Denetim: `Goruntuleme | arama | danisan:<client_id>`, `OturumBasi(BIRLESTIRME_PENCERESI_DK)`, `ayrinti` yok. (Genel aramanın sabit `genel` kimliğinden farkı bilerek: danışan terimden ÖNCE seçildiği için kimliği terimi sızdırmaz ve farklı danışanların aramaları tek satırın arkasına saklanmaz.)

- [ ] **Adım 1: Başarısız depo testlerini yaz** (`search.rs` test modülü, sonuna)

```rust
    // --- Danışana özel not araması (tasarım S8) --------------------------

    fn danisan_adiyla(c: &rusqlite::Connection, ad: &str) -> i64 {
        danisan_ekle(c, &YeniDanisan { ad_soyad: ad.into(), telefon: None }, Cihaz::Masaustu)
            .unwrap()
            .id
    }

    #[test]
    fn danisan_not_aramasi_yalnizca_bu_danisanin_resmi_notlarini_bulur() {
        let (_d, c, cid, rid) = kurulum();
        not_kaydet(&c, rid, "serbest", "<p>Ayşe <strong>KAYGI</strong> anlattı</p>", Cihaz::Masaustu).unwrap();
        ozel_not_kaydet(&c, rid, "OZELKAYGI hipotezi", Cihaz::Masaustu).unwrap();
        let mehmet = danisan_adiyla(&c, "Mehmet Demir");
        let r2 = randevu_ekle(&c, mehmet, "2026-09-08");
        not_kaydet(&c, r2, "serbest", "<p>BASKASININ kaygısı</p>", Cihaz::Masaustu).unwrap();

        let bulunan = danisan_notlarinda_ara(&c, cid, "kaygı", None, Cihaz::Masaustu).unwrap();
        // ARTI YÖN: bu danışanın resmî notu bulunur, parça düz metin.
        assert_eq!(bulunan.len(), 1, "yalnizca bu danisanin resmi notu");
        assert_eq!(bulunan[0].appointment_id, rid);
        assert_eq!(bulunan[0].seans_zamani, "2026-09-07T14:00");
        assert!(bulunan[0].parca.contains("Ayşe KAYGI anlattı"), "{}", bulunan[0].parca);
        // EKSİ YÖN: başka danışan ve özel not girmez.
        let metin: String = bulunan.iter().map(|s| s.parca.as_str()).collect();
        assert!(!metin.contains("BASKASININ") && !metin.contains("OZELKAYGI"), "{metin}");
        assert!(danisan_notlarinda_ara(&c, cid, "OZELKAYGI", None, Cihaz::Masaustu).unwrap().is_empty());
    }

    #[test]
    fn danisan_not_aramasi_once_kesin_kucuktur_ve_yeniden_eskiye_siralanir() {
        let (_d, c, cid, _rid) = kurulum();
        // EKLEME SIRASI tarih sırasının ne aynısı ne tersi (sekizinci biçim).
        let orta = randevu_ekle(&c, cid, "2026-09-14");
        let eski = randevu_ekle(&c, cid, "2026-09-01");
        let yeni = randevu_ekle(&c, cid, "2026-09-21");
        for r in [orta, eski, yeni] {
            not_kaydet(&c, r, "serbest", "<p>ortak terim</p>", Cihaz::Masaustu).unwrap();
        }
        let kimlikler = |once: Option<&str>| -> Vec<i64> {
            danisan_notlarinda_ara(&c, cid, "ortak", once, Cihaz::Masaustu)
                .unwrap()
                .iter()
                .map(|s| s.appointment_id)
                .collect()
        };
        assert_eq!(kimlikler(None), vec![yeni, orta, eski]);
        assert_eq!(kimlikler(Some("2026-09-14T14:00")), vec![eski], "ayni baslangicli seans GIRMEZ");
    }

    #[test]
    fn danisan_not_aramasi_en_fazla_elli_sonuc_dondurur() {
        let (_d, c, cid, _rid) = kurulum();
        for i in 0..55 {
            let r = randevu_ekle(&c, cid, &gun(i));
            not_kaydet(&c, r, "serbest", "<p>çok tekrar</p>", Cihaz::Masaustu).unwrap();
        }
        assert_eq!(danisan_notlarinda_ara(&c, cid, "tekrar", None, Cihaz::Masaustu).unwrap().len(), 50);
    }

    #[test]
    fn danisan_not_aramasi_kisa_terimde_tablo_okumaz_log_yazmaz() {
        let (_d, c, cid, rid) = kurulum();
        not_kaydet(&c, rid, "serbest", "<p>a b</p>", Cihaz::Masaustu).unwrap();
        let once = arama_log_sayisi(&c);
        for kisa in ["", " ", "a", " ş "] {
            assert!(danisan_notlarinda_ara(&c, cid, kisa, None, Cihaz::Masaustu).unwrap().is_empty());
        }
        // Kısa terimde olmayan danışan bile hata değil: hiçbir tablo okunmaz.
        assert!(danisan_notlarinda_ara(&c, 999, "a", None, Cihaz::Masaustu).unwrap().is_empty());
        assert_eq!(arama_log_sayisi(&c), once);
    }

    #[test]
    fn danisan_not_aramasi_olmayan_danisanda_bulunamadi_doner_log_yazmaz() {
        let (_d, c, _cid, _rid) = kurulum();
        let once = arama_log_sayisi(&c);
        assert!(matches!(
            danisan_notlarinda_ara(&c, 999, "kaygi", None, Cihaz::Masaustu),
            Err(DepoHatasi::Bulunamadi)
        ));
        assert_eq!(arama_log_sayisi(&c), once);
    }

    #[test]
    fn danisan_not_aramasi_terimi_ve_sonuc_sayisini_loga_yazmaz_danisani_yazar() {
        let (_d, c, cid, rid) = kurulum();
        not_kaydet(&c, rid, "serbest", "<p>COKGIZLITERIM notu</p>", Cihaz::Masaustu).unwrap();
        assert_eq!(danisan_notlarinda_ara(&c, cid, "COKGIZLITERIM", None, Cihaz::Masaustu).unwrap().len(), 1);
        let kayitlar = crate::store::audit::son_kayitlar(&c, 100).unwrap();
        let arama: Vec<_> = kayitlar.iter().filter(|k| k.varlik == VARLIK_ARAMA).collect();
        assert_eq!(arama.len(), 1);
        assert_eq!(arama[0].varlik_id, format!("danisan:{cid}"));
        assert!(arama[0].ayrinti.is_none());
        for k in &kayitlar {
            let hepsi = format!("{} {} {} {:?}", k.eylem, k.varlik, k.varlik_id, k.ayrinti).to_lowercase();
            assert!(!hepsi.contains("cokgizli"), "terim loga sizdi: {hepsi}");
        }
        // Pencere içinde ikinci danışan araması birleşir; genel arama AYRI satırdır.
        danisan_notlarinda_ara(&c, cid, "baska", None, Cihaz::Masaustu).unwrap();
        sonuclar_of(&c, "baska", 20, Cihaz::Masaustu).unwrap();
        let sayi = crate::store::audit::son_kayitlar(&c, 100)
            .unwrap()
            .iter()
            .filter(|k| k.varlik == VARLIK_ARAMA)
            .count();
        assert_eq!(sayi, 2, "danisan aramasi birlesir, genel arama ayri satir");
    }

    #[test]
    fn her_katlanan_harf_danisan_not_aramasinda_iki_yonlu_calisir() {
        let (_d, c, cid, _rid) = kurulum();
        for (sira, (harf, ascii)) in KATLANAN_HARFLER.iter().enumerate() {
            let r = randevu_ekle(&c, cid, &gun(sira));
            // Kelime bir biçim etiketiyle bölünmüş (tasarım S4 + inceleme odağı 3).
            let icerik = format!(
                "<p>Seans{sira:02}: sqlkatla{harf}z ve <strong>rustkatla</strong>{ascii}z gecti.</p>"
            );
            not_kaydet(&c, r, "dap", &icerik, Cihaz::Masaustu).unwrap();
            for sorgu in [format!("sqlkatla{ascii}z"), format!("rustkatla{harf}z")] {
                let bulunan = danisan_notlarinda_ara(&c, cid, &sorgu, None, Cihaz::Masaustu).unwrap();
                assert!(
                    bulunan.iter().any(|s| s.parca.contains(&format!("Seans{sira:02}"))),
                    "'{harf}' <-> '{ascii}': '{sorgu}' Seans{sira:02} notunu bulmali"
                );
            }
        }
    }
```

- [ ] **Adım 2: Kırmızıyı gör** — `cargo test -p psikolog-core search` → derleme hatası (`danisan_notlarinda_ara` yok).

- [ ] **Adım 3: Depo fonksiyonunu yaz** (`search.rs`)

`use rusqlite::Connection;` → `use rusqlite::{Connection, OptionalExtension};`. `SORGU_ETIKET`'in altına:

```rust
/// Danışana özel not araması (tasarım S8). `SORGU_NOT` ile AYNI katlama
/// zinciri ve `duz_metin`; danışan filtresi `a.client_id` (notun kopyası
/// değil), kesme KESİN küçük. Özel not tablosu bu sorguda da yok.
const SORGU_DANISAN_NOT: &str = "SELECT p.appointment_id, a.baslangic, p.duz_metin
 FROM progress_notes p
 JOIN appointments a ON a.id = p.appointment_id
 WHERE a.client_id = ?1 AND (?3 IS NULL OR a.baslangic < ?3)
   AND replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(p.duz_metin),'ı','i'),'İ','i'),'ş','s'),'Ş','s'),'ğ','g'),'Ğ','g'),'ü','u'),'Ü','u'),'ö','o'),'Ö','o'),'ç','c'),'Ç','c') LIKE ?2 ESCAPE '\\'
 ORDER BY a.baslangic DESC, p.appointment_id DESC
 LIMIT ?4";
```

`ara` fonksiyonunun altına:

```rust
/// Danışana özel not aramasının bir satırı (önceki notlar paneli).
/// `Debug` elle: `seans_zamani` ve `parca` `AramaSonucu` ile aynı gerekçeyle
/// `<gizli>`.
#[derive(Clone, Serialize)]
pub struct NotAramaSonucu {
    pub appointment_id: i64,
    pub seans_zamani: String,
    pub parca: String,
}

impl std::fmt::Debug for NotAramaSonucu {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NotAramaSonucu")
            .field("appointment_id", &self.appointment_id)
            .field("seans_zamani", &"<gizli>")
            .field("parca", &"<gizli>")
            .finish()
    }
}

/// Bir danışanın **resmî** notlarında arar (tasarım S8): önceki notlar
/// panelinin "Önceki notlarda ara" kutusu.
///
/// `ara` ile aynı kurallar: yalnızca `progress_notes.duz_metin`, Türkçe
/// katlama, `%`/`_` kaçırma, parça `parca_cikar`'dan; `ASGARI_SORGU` altı
/// terim HİÇBİR tabloyu okumaz ve log yazmaz. Olmayan danışan `Bulunamadi`
/// (log yok). Sonuçlar yeniden eskiye, en fazla `AZAMI_SONUC`; `once`
/// verilirse yalnızca o andan KESİN önce başlamış seanslar.
///
/// Denetim `Goruntuleme | arama | danisan:<client_id>` (`OturumBasi`,
/// `ayrinti` yok): terim ve sonuç sayısı YAZILMAZ. Kimlik genel aramanın
/// sabit `genel`'i değil, çünkü danışan terimden ÖNCE seçilir — kimliği
/// yazmak terimi sızdırmaz, yazmamak farklı danışanların notlarında yapılan
/// aramaları tek satırın arkasına saklardı.
pub fn danisan_notlarinda_ara(
    conn: &Connection,
    client_id: i64,
    sorgu: &str,
    once: Option<&str>,
    cihaz: Cihaz,
) -> Result<Vec<NotAramaSonucu>, DepoHatasi> {
    let katli_sorgu = katla(sorgu.trim());
    if katli_sorgu.chars().count() < ASGARI_SORGU {
        return Ok(Vec::new());
    }
    let var: Option<i64> = conn
        .query_row("SELECT id FROM clients WHERE id = ?1", [client_id], |r| r.get(0))
        .optional()?;
    if var.is_none() {
        return Err(DepoHatasi::Bulunamadi);
    }
    let desen = like_deseni(&katli_sorgu);
    let mut stmt = conn.prepare(SORGU_DANISAN_NOT)?;
    let sonuclar = stmt
        .query_map(rusqlite::params![client_id, desen, once, AZAMI_SONUC], |r| {
            let duz: String = r.get(2)?;
            Ok(NotAramaSonucu {
                appointment_id: r.get(0)?,
                seans_zamani: r.get(1)?,
                parca: parca_cikar(&duz, &katli_sorgu),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    kaydet(
        conn,
        Eylem::Goruntuleme,
        VARLIK_ARAMA,
        &format!("danisan:{client_id}"),
        cihaz,
        None,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;
    Ok(sonuclar)
}
```

Modül başlığındaki "Katlama üç yerde geçer (`katla_karakter`, `SORGU_DANISAN`, `SORGU_NOT`)" → "dört yerde (… `SORGU_NOT`, `SORGU_DANISAN_NOT`)".

- [ ] **Adım 4: Yeşili gör** — `cargo test -p psikolog-core search` → PASS (yapısal `private_notes` taramaları dâhil).

- [ ] **Adım 5: HTTP testlerini yaz** (`server/tests/notlar_api.rs`)

`kilitliyken_gorev7_uclarinin_hepsi_401_doner_ve_veri_sizdirmaz`'daki `uclar` listesine `("GET", format!("/api/danisanlar/{cid}/seanslar"), None),` satırının altına:

```rust
        // Tasarim S8: danisana ozel not aramasi da kapinin icinde.
        ("GET", format!("/api/danisanlar/{cid}/not-ara?q=RESMI"), None),
```

ve `assert_eq!(uclar.len(), 20, …)` → `assert_eq!(uclar.len(), 21, "POST /ekler ile birlikte yirmi iki uc kapsanmali");`.

`kilitliyken_govde_ve_sorgu_alan_her_uc_once_401_doner` tablosuna `("notes.rs", "danisan_listesi", …)` girdisinin altına:

```rust
        (
            "notes.rs",
            "danisan_not_ara",
            "GET",
            format!("/api/danisanlar/{cid}/not-ara?x={KANARYA}"),
            None,
        ),
```

`her_veri_handleri_acik_baglantidan_gecer`: yorum listesine "Tasarım S8 (2026-09-26): `routes::notes::danisan_not_ara` — toplam 38 -> 39." ve `assert_eq!(toplam, 39, "toplam veri handler'i sayisi 39 olmali");`.

Yeni test (`not_yaniti_sunucunun_onizlemesini_…`'nın altına):

```rust
#[tokio::test]
async fn danisan_not_aramasi_bu_danisanin_onceki_resmi_notlarini_dondurur() {
    let (_d, s) = kurulu_state().await;
    let ayse = danisan_ekle(&s, "Ayse Yilmaz").await;
    let mehmet = danisan_ekle(&s, "Mehmet Demir").await;
    let eski = randevu_ekle(&s, ayse, "2026-09-01").await;
    let simdiki = randevu_ekle(&s, ayse, "2026-09-08").await;
    let sonraki = randevu_ekle(&s, ayse, "2026-09-15").await;
    let baskasi = randevu_ekle(&s, mehmet, "2026-09-02").await;
    for (rid, icerik) in [
        (eski, "<p>ESKI <strong>KAYGI</strong> notu</p>"),
        (simdiki, "<p>SIMDIKI kaygi</p>"),
        (sonraki, "<p>SONRAKI kaygi</p>"),
        (baskasi, "<p>BASKASI kaygi</p>"),
    ] {
        cagir(&s, "PUT", &format!("/api/randevular/{rid}/not"), Some(json!({"sablon":"serbest","icerik":icerik})))
            .await;
    }
    cagir(&s, "PUT", &format!("/api/randevular/{eski}/ozel-not"), Some(json!({"icerik":"OZELKAYGI"}))).await;

    let (kod, sonuc) = cagir(
        &s,
        "GET",
        &format!("/api/danisanlar/{ayse}/not-ara?q=kayg%C4%B1&once=2026-09-08T14%3A00"),
        None,
    )
    .await;
    assert_eq!(kod, StatusCode::OK);
    let liste = sonuc.as_array().expect("dizi");
    assert_eq!(liste.len(), 1, "{sonuc}");
    assert_eq!(liste[0]["appointment_id"], json!(eski));
    assert_eq!(liste[0]["seans_zamani"], json!("2026-09-01T14:00"));
    let parca = liste[0]["parca"].as_str().unwrap();
    assert!(parca.contains("ESKI KAYGI notu") && !parca.contains('<'), "{parca}");
    for yok in ["SIMDIKI", "SONRAKI", "BASKASI", "OZELKAYGI"] {
        assert!(!sonuc.to_string().contains(yok), "{yok} sizdi: {sonuc}");
    }
    // ARTI YÖN: kesme `once`'den geliyor — verilmezse sonrakiler de döner.
    let (_, hepsi) = cagir(&s, "GET", &format!("/api/danisanlar/{ayse}/not-ara?q=kaygi"), None).await;
    assert_eq!(hepsi.as_array().unwrap().len(), 3, "{hepsi}");
    // Kısa terim boş liste (400 değil), olmayan danışan 404.
    let (kod, kisa) = cagir(&s, "GET", &format!("/api/danisanlar/{ayse}/not-ara?q=k"), None).await;
    assert_eq!((kod, kisa), (StatusCode::OK, json!([])));
    let (kod, _) = cagir(&s, "GET", "/api/danisanlar/9999/not-ara?q=kaygi", None).await;
    assert_eq!(kod, StatusCode::NOT_FOUND);
    // Terim loga girmedi.
    assert!(!audit_dokumu(&s).await.to_lowercase().contains("kayg"));
}
```

- [ ] **Adım 6: Kırmızıyı gör** — `npm --prefix web run build`; `cargo test -p psikolog-server --test notlar_api` → yeni test 404 (rota yok), tablo/sayım testleri FAIL.

- [ ] **Adım 7: Rotayı yaz**

`server/src/routes/notes.rs` içe aktarmalarına `use psikolog_core::store::search::{danisan_notlarinda_ara, NotAramaSonucu};`. `ListeSorgusu`'nun altına:

```rust
#[derive(Deserialize)]
pub struct NotAramaSorgusu {
    pub q: String,
    /// `ListeSorgusu::once` ile aynı: biçim doğrulanmaz, parametre olarak
    /// SQL'e gider (dizge karşılaştırması).
    pub once: Option<String>,
}
```

`danisan_listesi`'nin altına:

```rust
/// `GET /api/danisanlar/{id}/not-ara?q=&once=` — danışanın **resmî**
/// notlarında arama (tasarım S8, önceki notlar paneli). Kurallar ve denetim
/// kaydı `store::search::danisan_notlarinda_ara`'da; bu handler ikinci bir
/// satır yazmaz, terimi hiçbir yere düşürmez. Özel not bu uca giremez: depo
/// fonksiyonu yalnızca `progress_notes.duz_metin` okur.
pub async fn danisan_not_ara(
    State(s): State<AppState>,
    Path(id): Path<i64>,
    q: Result<Sorgu<NotAramaSorgusu>, ApiHata>,
) -> Result<Json<Vec<NotAramaSonucu>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let Sorgu(q) = q?;
    let sonuc = danisan_notlarinda_ara(&conn, id, &q.q, q.once.as_deref(), Cihaz::Masaustu)
        .map_err(depo_hatasi)?;
    Ok(Json(sonuc))
}
```

`server/src/lib.rs`'te `.route("/danisanlar/{id}/seanslar", …)` satırının altına:

```rust
        // Tasarim S8: onceki notlar panelinin aramasi -- danisanin RESMI
        // notlarinda, `once` kesmesiyle. Terim sorgu dizesinde (hizli arama
        // `/ara?q=` ile ayni karar); loga girmez.
        .route("/danisanlar/{id}/not-ara", get(routes::notes::danisan_not_ara))
```

- [ ] **Adım 8: Yeşili gör** — `cargo test --workspace` → PASS.

- [ ] **Adım 9: İstemci fonksiyonu (test önce)** — `web/src/api.test.ts` `describe('notApi — resmî seans notu')` sonuna:

```ts
  it('notAra terimi kodlar, `once`u yalnızca verilince koyar', async () => {
    await notApi.notAra(3, 'kaygı & uyku', '2026-09-07T10:00')
    expect(cagrilar[0].yol).toBe('/api/danisanlar/3/not-ara?q=kayg%C4%B1%20%26%20uyku&once=2026-09-07T10%3A00')
    expect(cagrilar[0].method).toBe('GET')
    await notApi.notAra(3, 'x y')
    expect(cagrilar[1].yol).toBe('/api/danisanlar/3/not-ara?q=x%20y')
  })
```

ve "notApi'nin hiçbir fonksiyonu ozel-not yoluna gitmez" testine `await notApi.notAra(3, 'terim')` ekle, `toHaveLength(3)` → `toHaveLength(4)`; "notApi ile ozelNotApi ayrı nesnelerdir…" testindeki anahtar listesi → `['notGetir', 'notKaydet', 'danisanNotlari', 'notAra']` (yeni fonksiyon nesnenin SONUNA eklenir). Kırmızıyı gör: `npx vitest run src/api.test.ts` → `notApi.notAra is not a function`.

`web/src/api.ts`'e `SeansNotu`'nun altına:

```ts
/** `GET /api/danisanlar/{id}/not-ara` satırı (sunucudaki `NotAramaSonucu`, tasarım S8). */
export type NotAramaSonucu = {
  appointment_id: number
  /** Seansın başlangıcı — duvar saati. */
  seans_zamani: string
  /** Eşleşmenin çevresinden düz metin parça (sunucuda `parca_cikar`). */
  parca: string
}
```

`notApi`'ye:

```ts
  // Önceki notlar panelinin araması (tasarım S8) — yalnızca RESMÎ notlar,
  // yalnızca bu danışan, `once` verilirse yalnızca o seanstan önce. Terim
  // sunucuda loga yazılmaz; burada da hiçbir yere düşürülmez.
  notAra: (danisanId: number, sorgu: string, once?: string) =>
    istek<NotAramaSonucu[]>(
      `/api/danisanlar/${danisanId}/not-ara?q=${encodeURIComponent(sorgu)}` +
        (once === undefined ? '' : `&once=${encodeURIComponent(once)}`),
    ),
```

Yeşili gör: `npx vitest run src/api.test.ts` → PASS.

- [ ] **Adım 10: Tam doğrulama** — `npm --prefix web run build`, `npm --prefix web run lint`, web/ `npx vitest run`, `cargo test --workspace`. (Arayüz davranışı değişmedi; e2e gerekmez.)

- [ ] **Adım 11: Commit**

```bash
git add core/src/store/search.rs server/src/routes/notes.rs server/src/lib.rs server/tests/notlar_api.rs web/src/api.ts web/src/api.test.ts
git commit -m "Sunucu: danisana ozel not aramasi (not-ara), terim loga girmez

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Mutasyonlar:**
- `SORGU_DANISAN_NOT`'tan `a.client_id = ?1 AND` sil (parametreyi `?1 = ?1` ile tut) → `…yalnizca_bu_danisanin_resmi_notlarini_bulur` ve HTTP testi (BASKASI sızdı) kırılır.
- `a.baslangic < ?3` → `<=` → `…once_kesin_kucuktur…` kırılır.
- `format!("danisan:{client_id}")` → `VARLIK_ID_ARAMA` → `…danisani_yazar` (2 ≠ 1) kırılır.
- `ASGARI_SORGU` erken dönüşünü sil → `…kisa_terimde_tablo_okumaz_log_yazmaz` kırılır.
- `katla(sorgu.trim())` → `sorgu.trim().to_lowercase()` → `her_katlanan_harf_danisan_not_aramasinda_…` kırılır.

---

### Task 4: TipTap kurulumu, `BicimliYuzey`, `NotOkuma` ve test yüzeyi (spec §5 E1–E4, E10–E11, §6 S7)

**Files:**
- Modify: `web/tsconfig.json`, `web/tsconfig.app.json` (`paths`), `web/vite.config.ts` (`resolve.alias`)
- Create (CLI, sonra düzenlenir): `web/src/components/tiptap-{extension,icons,node,ui,ui-primitive}/**`, `web/src/hooks/{use-composed-ref,use-is-breakpoint,use-menu-navigation,use-tiptap-editor}.ts`, `web/src/lib/tiptap-utils.ts`, `web/src/styles/{_variables,_keyframe-animations}.scss`, `web/src/scss.d.ts`
- Delete (CLI çıktısından): `web/src/components/tiptap-templates/`, `web/src/components/tiptap-node/{image-node,image-upload-node}/`, `web/src/components/tiptap-ui/image-upload-button/`, `web/src/components/tiptap-icons/{image-plus-icon,moon-star-icon,sun-icon}.tsx`, `web/src/hooks/{use-cursor-visibility,use-element-rect,use-scrolling,use-throttled-callback,use-unmount,use-window-size}.ts`
- Modify: `web/src/index.css` (CLI'nin eklediği iki `@import`), `web/package.json`, `web/package-lock.json`, `web/.oxlintrc.json`
- Modify: `web/src/istemciRaporUretimi.test.ts` (`KOD_OLMAYAN_UZANTILAR`)
- Create: `web/src/not/uzantilar.ts`, `web/src/not/vurgu.ts`, `web/src/not/vurgu.test.ts`, `web/src/not/stiller.ts`, `web/src/not/not-yuzeyi.scss`, `web/src/not/AracCubugu.tsx`, `web/src/not/BicimliYuzey.tsx`, `web/src/not/BicimliYuzey.test.tsx`, `web/src/not/NotOkuma.tsx`, `web/src/not/NotOkuma.test.tsx`, `web/src/sablonKodu.test.ts`
- Modify: `web/src/test-kurulum.ts`

**Interfaces:**
- Produces: `export type BicimliYuzeyProps = { html: string; onChange?: (html: string) => void; etiket: string; editable?: boolean; vurgu?: string }` ve `export function BicimliYuzey(props: BicimliYuzeyProps): JSX.Element` (`web/src/not/BicimliYuzey.tsx`). Sözleşme: `onChange` YALNIZCA kullanıcı belgeyi değiştirdiğinde çağrılır; belge dışarıdan gelen son `html`'in normalleşmiş hâline dönünce o HAM dizgiyle çağrılır (E8); `html` prop'u son bildirilenden ve son dış değerden farklıysa içerik geri alma yığınına GİRMEDEN değiştirilir. ProseMirror öğesi `role="textbox"`, `aria-label={etiket}`, `aria-multiline="true"`.
- Produces: `export function NotOkuma({ html, vurgu }: { html: string; vurgu?: string }): JSX.Element` (`web/src/not/NotOkuma.tsx`) — `editable: false`, aynı uzantılar; `vurgu` ≥ 2 karakterse bütün eşleşmeler `.not-vurgu` ile işaretlenir ve ilki `scrollIntoView({ block: 'center' })` ile görünür alana getirilir.
- Produces: `export function notUzantilari({ duzenlenebilir }: { duzenlenebilir: boolean }): Extensions`, `export function baglantiIzinliMi(adres: string): boolean` (`web/src/not/uzantilar.ts`).
- Produces: `export function katla(metin: string): string`, `export const ASGARI_VURGU = 2`, `export function eslesmeAraliklari(metin: string, terim: string): Array<[number, number]>`, `export function vurguParcalari(metin: string, terim: string): Array<{ metin: string; vurgu: boolean }>`, `export const NotVurgusu: Extension` + komut `editor.commands.vurguAyarla(terim: string)` (`web/src/not/vurgu.ts`).
- Test yüzeyi (Vitest, `test-kurulum.ts`): `./not/BicimliYuzey` modülü `<textarea aria-label={etiket} value={html} readOnly={!editable} onChange={e => onChange?.(e.target.value)}>` ile değiştirilir. Gerçek yüzeyi isteyen test dosyası en üstte `vi.mock('<yol>/BicimliYuzey', async (importOriginal) => await importOriginal())` yazar. `NotOkuma` HİÇBİR yerde taklit edilmez (jsdom'da gerçek TipTap).

- [ ] **Adım 1: `@` takma adını kur**

`web/tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] }
  }
}
```

(Kök `compilerOptions` yalnızca TipTap CLI'si için: CLI `tsconfig-paths` ile KÖK `tsconfig.json`'u okur, `references`'ı izlemez; takma ad orada yoksa dosyaları `web/@/` altına yazar.) `web/tsconfig.app.json` `compilerOptions`'a `"paths": { "@/*": ["./src/*"] },` (TS 6'da `baseUrl` gerekmez, yollar tsconfig'e göreli). `web/vite.config.ts`: `import { fileURLToPath, URL } from 'node:url'` ve `defineConfig({ plugins: …, resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }, build: …` (Vitest aynı yapılandırmayı kullanır).

- [ ] **Adım 2: Şablonu kur**

Çalıştır (depo kökü, PowerShell): `'' | npx -y @tiptap/cli@3.19.4 add simple-editor --cwd web`
(Sürüm 2026-09-26 denemesindeki; tek soru "Press Enter"dır ve boş satır onu geçer.)

Doğrula:
- `Test-Path web/src/components/tiptap-ui/mark-button/mark-button.tsx` → `True`; `Test-Path web/@` → `False`.
- `web/src/index.css` en üstünde iki satır: `@import './styles/_variables.scss';` ve `@import './styles/_keyframe-animations.scss';` (`@import 'tailwindcss'`'ten ÖNCE).
- `web/package.json`'a Tasarım E1'deki paketler eklendi.

Sapmalar (her biri raporda yazılır):
- Dosyalar `web/@/` altına düştüyse: `Move-Item web/@/* web/src/ -Force; Remove-Item web/@ -Recurse -Force` ve `index.css`'teki iki yolu `./styles/…` yap (içe aktarmalar `@/…` olduğu için başka değişiklik gerekmez).
- CLI soru bekleyip kalıyor ya da ağ hatası veriyorsa: aynı günün CLI çıktısı `C:\Users\axres\AppData\Local\Temp\claude\C--Users-axres-Documents-GitHub-psikolog-not-takip\856523c9-432e-46b7-adce-10d15b2dc49a\scratchpad\tiptap-deneme\@` altında. `Copy-Item -Recurse <o dizin>\* web\src\`, `Copy-Item <…>\tiptap-deneme\src\scss.d.ts web\src\`, iki `@import`'u elle ekle, paketleri kur: `npm --prefix web install @floating-ui/react@^0.27.20 @radix-ui/react-dropdown-menu@^2.1.24 @radix-ui/react-popover@^1.1.23 @tiptap/core@^3.31.3 @tiptap/extension-find-and-replace@^3.31.3 @tiptap/extension-highlight@^3.31.3 @tiptap/extension-horizontal-rule@^3.31.3 @tiptap/extension-list@^3.31.3 @tiptap/extension-subscript@^3.31.3 @tiptap/extension-superscript@^3.31.3 @tiptap/extension-text-align@^3.31.3 @tiptap/extension-typography@^3.31.3 @tiptap/extensions@^3.31.3 @tiptap/pm@^3.31.3 @tiptap/react@^3.31.3 @tiptap/starter-kit@^3.31.3 clsx@^2.1.1 react-hotkeys-hook@^5.3.3` ve `npm --prefix web install -D @base-ui/react@^1.8.0 class-variance-authority@^0.7.1 sass-embedded@^1.105.0`.

- [ ] **Adım 3: Kullanılmayanı sil** (tasarım E1)

```powershell
Remove-Item -Recurse -Force web/src/components/tiptap-templates, web/src/components/tiptap-node/image-node, web/src/components/tiptap-node/image-upload-node, web/src/components/tiptap-ui/image-upload-button
Remove-Item -Force web/src/components/tiptap-icons/image-plus-icon.tsx, web/src/components/tiptap-icons/moon-star-icon.tsx, web/src/components/tiptap-icons/sun-icon.tsx
Remove-Item -Force web/src/hooks/use-cursor-visibility.ts, web/src/hooks/use-element-rect.ts, web/src/hooks/use-scrolling.ts, web/src/hooks/use-throttled-callback.ts, web/src/hooks/use-unmount.ts, web/src/hooks/use-window-size.ts
npm --prefix web uninstall @tiptap/extension-image lodash.throttle @types/lodash.throttle
```

`web/src/lib/tiptap-utils.ts`'ten `MAX_FILE_SIZE` ve `handleImageUpload`'ı sil. (`tiptap-templates` silinince Google Fonts `@import url(...)`'u, `body`/`html`/`#root` genel kuralları ve tema düğmesi de gider.) Kalan her `tiptap-ui-primitive/*` ve `tiptap-icons/*` dosyasının bir içe aktaranı olmalı: `rg -l "tiptap-ui-primitive/<ad>\"" web/src` boş dönen primitifi sil.

- [ ] **Adım 4: Koyu tema kurallarını sil** (tasarım E4)

Betiği scratchpad'e yaz (`…\scratchpad\karanlik-sil.mjs`, projeye girmez):

```js
// SCSS: `//` satır yorumlarını ve seçicisinde `.dark` geçen kural bloklarını
// (iç içe `.dark & { … }` dâhil) siler. `url(https://…)` yorum sayılmaz.
import { readFileSync, writeFileSync } from 'node:fs'
for (const dosya of process.argv.slice(2)) {
  const kaynak = readFileSync(dosya, 'utf8').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  let cikti = ''
  let i = 0
  while (i < kaynak.length) {
    const ac = kaynak.indexOf('{', i)
    if (ac === -1) { cikti += kaynak.slice(i); break }
    const onceki = Math.max(kaynak.lastIndexOf('}', ac - 1), kaynak.lastIndexOf(';', ac - 1), kaynak.lastIndexOf('{', ac - 1), i - 1)
    const secici = kaynak.slice(onceki + 1, ac).replace(/\/\*[\s\S]*?\*\//g, '')
    if (/\.dark\b/.test(secici)) {
      let derinlik = 1
      let j = ac + 1
      while (j < kaynak.length && derinlik > 0) {
        if (kaynak[j] === '{') derinlik++
        else if (kaynak[j] === '}') derinlik--
        j++
      }
      cikti += kaynak.slice(i, onceki + 1)
      i = j
    } else {
      cikti += kaynak.slice(i, ac + 1)
      i = ac + 1
    }
  }
  writeFileSync(dosya, cikti)
}
```

Çalıştır: `node <scratchpad>\karanlik-sil.mjs (Get-ChildItem web/src/components, web/src/styles -Recurse -Filter *.scss).FullName`. Doğrula: `rg -n "\.dark" web/src/components web/src/styles` boş; `npm --prefix web run build` SCSS derleme hatası vermiyor.

- [ ] **Adım 5: Dış adresleri, regex yardımını ve `window.open`'ı kaldır**

- `components/tiptap-ui/search-and-replace/search-and-replace.tsx`: `REGEX_DOCS_URL`, `REGEX_SEARCH_EXAMPLES`, `REGEX_REPLACE_EXAMPLES`, `RegexExampleButton`, `applyRegexExample` ve JSX'teki `tiptap-search-replace-regex-toggle` bloğunu (anahtar + `useRegex &&` yardım kutusu, MDN bağlantısı dâhil) sil; `toggleUseRegex`/`useRegex` kullanılmayan değişken kalırsa yapıbozumdan çıkar. (Terapist için düzenli ifade gereksiz ve yardım kutusu dışarı bağlanıyordu.) Sonra kullanılmayan içe aktarmaları (ör. `Switch`, `ArrowRightIcon`) temizle; `switch` primitifinin içe aktaranı kalmadıysa sil ve `@base-ui/react` başka yerde kullanılmıyorsa (`rg "@base-ui/react" web/src`) kaldır.
- `components/tiptap-ui/link-popover/use-link-popover.ts`: `openLink` fonksiyonunu ve dönüşteki `openLink`'i sil. `link-popover.tsx`: `openLink` prop'unu (tip, yapıbozum, geçiriş) ve "Open in new window" düğmesinin `ButtonGroup`'unu sil, `ExternalLinkIcon` içe aktarmasını kaldır. Gerekçe (yoruma yaz): "`window.open` üretim kodunda yasak (`istemciRaporUretimi.test.ts`); bağlantılar okuma görünümünde tıklanarak açılır (tasarım E10)."

- [ ] **Adım 6: Türkçeleştir** (tasarım E3)

| Dosya | Eski → Yeni |
|---|---|
| `tiptap-ui/blockquote-button/blockquote-button.tsx`, `use-blockquote.ts` | `"Blockquote"` → `"Alıntı"` |
| `tiptap-ui/code-block-button/code-block-button.tsx`, `use-code-block.ts` | `"Code Block"` → `"Kod bloğu"` |
| `tiptap-ui/color-highlight-button/use-color-highlight.ts` | `Default/Gray/Brown/Orange/Yellow/Green/Blue/Purple/Pink/Red background` → `Varsayılan/Gri/Kahverengi/Turuncu/Sarı/Yeşil/Mavi/Mor/Pembe/Kırmızı`; `"Remove highlight"` → `"Vurguyu kaldır"` |
| `tiptap-ui/color-highlight-popover/color-highlight-popover.tsx` | `"Highlight text"` → `"Metni vurgula"`; `tooltip="Highlight"` → `"Vurgu rengi"`; `` `${color.label} highlight color` `` → `` `${color.label} vurgu rengi` ``; `"Remove highlight"` (3 yer) → `"Vurguyu kaldır"`; `"Highlight colors"` → `"Vurgu renkleri"` |
| `tiptap-ui/heading-dropdown-menu/heading-dropdown-menu.tsx`, `use-heading-dropdown-menu.ts` | `"Format text as heading"` → `"Başlık biçimi"`; `"Heading"` → `"Başlık"` |
| `tiptap-ui/heading-button/use-heading.ts` | `` `Heading ${level}` `` → `` `Başlık ${level}` `` |
| `tiptap-ui/link-popover/link-popover.tsx`, `use-link-popover.ts` | `"Link"` → `"Bağlantı"`; `"Paste a link..."` → `"Bağlantıyı yapıştırın…"`; `"Apply link"` → `"Bağlantıyı uygula"`; `"Remove link"` → `"Bağlantıyı kaldır"` |
| `tiptap-ui/list-dropdown-menu/*.ts(x)`, `tiptap-ui/list-button/use-list.ts` | `"List options"` → `"Liste seçenekleri"`; `"List"` → `"Liste"`; `"Bullet List"` → `"Madde listesi"`; `"Ordered List"` → `"Numaralı liste"`; `"Task List"` → `"Yapılacaklar listesi"` |
| `tiptap-ui/mark-button/use-mark.ts` | `getFormattedMarkName` gövdesi → `return ISARET_ADLARI[type]` ve üstüne `const ISARET_ADLARI: Record<Mark, string> = { bold: 'Kalın', italic: 'İtalik', underline: 'Altı çizili', strike: 'Üstü çizili', code: 'Satır içi kod', superscript: 'Üst simge', subscript: 'Alt simge' }` |
| `tiptap-ui/text-align-button/use-text-align.ts` | `Align left/center/right/justify` → `Sola hizala`/`Ortala`/`Sağa hizala`/`İki yana yasla` |
| `tiptap-ui/undo-redo-button/use-undo-redo.ts` | `"Undo"` → `"Geri al"`; `"Redo"` → `"Yinele"` |
| `tiptap-ui/search-and-replace/*.ts(x)` | `"Search and replace"` → `"Bul ve değiştir"`; `"Previous result"` → `"Önceki sonuç"`; `"Next result"` → `"Sonraki sonuç"`; `"Close"` → `"Kapat"`; `"Search"` → `"Bul"`; `"Replace"` → `"Değiştir"`; `"Replace current result"` → `"Bu sonucu değiştir"`; `"Replace all results"` → `"Tümünü değiştir"`; `"Match case"` → `"Büyük/küçük harf"`; `"Whole words"` → `"Tam sözcük"` |
| `tiptap-ui-primitive/toolbar/toolbar.tsx` (~L172) | `aria-label="toolbar"` → `aria-label="Biçim araçları"` |

Sonra kalan görünür İngilizceyi bul ve Türkçeleştir: `rg -n "(aria-label|tooltip|placeholder|title|label)[=:] *[\"'\`][A-Z][a-z]" web/src/components` ve `rg -n ">[A-Z][a-z]+( [a-z]+)*<" web/src/components` (JSX metni: ör. sonuç sayacı, "No results"). Kalan her eşleşme ya Türkçeleşir ya da raporda "görünmüyor" gerekçesiyle yazılır.

- [ ] **Adım 7: Lint ve yapısal testi şablona uydur**

`web/.oxlintrc.json`'a (şablon kodu CLI'nin kalıbıyla 59 uyarı üretiyor; kendi kodumuz lint'e tabi kalır):

```json
  "ignorePatterns": ["src/components/tiptap-*/**", "src/hooks/**", "src/lib/**"],
```

`web/src/istemciRaporUretimi.test.ts` `KOD_OLMAYAN_UZANTILAR`'a `'scss',` (yanına yorum: "şablonun stil dosyaları; kod değil, `sablonKodu.test.ts` dış adres ve koyu tema için ayrıca tarar").

- [ ] **Adım 8: Başarısız testleri yaz**

`web/src/sablonKodu.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

// Şablon (TipTap CLI) kodu projenin kodudur (tasarım E1): dışarıya
// bağlanmaz (§9 "yeni hiçbir dış bağlantı yok"), koyu tema ve resim/tema
// bileşeni taşımaz (E2, E4). Küme DİZİNDEN türetilir (on ikinci biçim).
const stiller = import.meta.glob(['./**/*.scss', './index.css'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>
const kod = Object.fromEntries(
  Object.entries(
    import.meta.glob(['./components/**/*.{ts,tsx}', './hooks/**/*.ts', './lib/**/*.ts', './not/**/*.{ts,tsx}'], {
      query: '?raw', import: 'default', eager: true,
    }) as Record<string, string>,
  ).filter(([yol]) => !/\.test\./.test(yol)),
)

describe('şablon kodu dışarı bağlanmaz, koyu tema ve resim taşımaz', () => {
  it('küme gerçekten okundu', () => {
    expect(Object.keys(stiller)).toContain('./styles/_variables.scss')
    expect(Object.keys(stiller)).toContain('./index.css')
    expect(Object.keys(stiller).length).toBeGreaterThan(15)
    expect(Object.keys(kod).some((y) => y.startsWith('./components/tiptap-ui/'))).toBe(true)
  })
  it('stillerde uzak @import/url, Google Fonts ve .dark yok', () => {
    const ihlal: string[] = []
    for (const [yol, metin] of Object.entries(stiller)) {
      if (/@import\s+url\(/i.test(metin)) ihlal.push(`${yol}: @import url(`)
      if (/url\(\s*["']?(https?:)?\/\//i.test(metin)) ihlal.push(`${yol}: uzak url(`)
      if (/fonts\.(googleapis|gstatic)/i.test(metin)) ihlal.push(`${yol}: Google Fonts`)
      if (/\.dark\b/.test(metin)) ihlal.push(`${yol}: .dark`)
    }
    expect(ihlal).toEqual([])
  })
  it('kodda uzak adres yok (SVG ad alanı hariç), resim/tema bileşeni yok', () => {
    const ihlal: string[] = []
    for (const [yol, metin] of Object.entries(kod)) {
      if (/https?:\/\//.test(metin.replaceAll('http://www.w3.org/2000/svg', ''))) ihlal.push(`${yol}: uzak adres`)
      if (/image-upload|ImageUpload|extension-image|theme-toggle|ThemeToggle/.test(metin)) ihlal.push(`${yol}: resim/tema`)
    }
    expect(ihlal).toEqual([])
  })
})
```

`web/src/not/vurgu.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { eslesmeAraliklari, katla, vurguParcalari } from './vurgu'

// Sunucudaki `store::search::katla_karakter` ile AYNI küme (KATLANAN_HARFLER).
const KATLANAN: Array<[string, string]> = [
  ['ı', 'i'], ['İ', 'i'], ['I', 'i'], ['i', 'i'], ['ş', 's'], ['Ş', 's'], ['ğ', 'g'],
  ['Ğ', 'g'], ['ü', 'u'], ['Ü', 'u'], ['ö', 'o'], ['Ö', 'o'], ['ç', 'c'], ['Ç', 'c'],
]

describe('katla', () => {
  for (const [harf, ascii] of KATLANAN) it(`${harf} -> ${ascii}`, () => expect(katla(harf)).toBe(ascii))
  it('ASCII büyük harf küçülür, diğerleri değişmez; uzunluk KORUNUR (konum eşlemesi buna dayanır)', () => {
    expect(katla('KAYGI Âb')).toBe('kaygi Âb')
    for (const m of ['Işık ÇAĞRI şĞüÜöÖçÇ', 'KAYGI kaygı', 'İstanbul', 'emoji 😀 x']) {
      expect(katla(m).length).toBe(m.length)
    }
  })
})

describe('eslesmeAraliklari', () => {
  it('Türkçe harf duyarsız, iki yönlü', () => {
    expect(eslesmeAraliklari('Kaygı ve KAYGI', 'kaygi')).toEqual([[0, 5], [9, 14]])
    expect(eslesmeAraliklari('kaygi', 'KAYGI')).toEqual([[0, 5]])
  })
  it('iki karakterden kısa terim eşleşmez; terim kırpılır', () => {
    expect(eslesmeAraliklari('aaa', 'a')).toEqual([])
    expect(eslesmeAraliklari('ab ab', ' ab ')).toEqual([[0, 2], [3, 5]])
  })
  it('eşleşmeler üst üste binmez', () => expect(eslesmeAraliklari('aaaa', 'aa')).toEqual([[0, 2], [2, 4]]))
})

describe('vurguParcalari', () => {
  it('metni böler, birleşimi aslıdır', () => {
    const p = vurguParcalari('Bugün kaygı azaldı', 'KAYGI')
    expect(p).toEqual([
      { metin: 'Bugün ', vurgu: false },
      { metin: 'kaygı', vurgu: true },
      { metin: ' azaldı', vurgu: false },
    ])
    expect(p.map((x) => x.metin).join('')).toBe('Bugün kaygı azaldı')
  })
  it('eşleşme yoksa tek düz parça', () => {
    expect(vurguParcalari('abc', 'xy')).toEqual([{ metin: 'abc', vurgu: false }])
  })
})
```

`web/src/not/BicimliYuzey.test.tsx`:

```tsx
import { act, render, screen, within } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { describe, expect, it, vi } from 'vitest'
import { BicimliYuzey } from './BicimliYuzey'

// GERÇEK TipTap: `test-kurulum.ts` bu modülü textarea test yüzeyiyle
// değiştiriyor; bu dosya asıl bileşeni geri alır.
vi.mock('./BicimliYuzey', async (importOriginal) => await importOriginal<typeof import('./BicimliYuzey')>())

function editorAl(): Editor {
  const pm = document.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null
  if (!pm?.editor) throw new Error('TipTap editörü bulunamadı')
  return pm.editor
}

describe('BicimliYuzey (gerçek TipTap)', () => {
  it('4.1 HTML içeriği yükler; etiket erişilebilir ad, yüzey düzenlenebilir', () => {
    render(<BicimliYuzey html="<p>Merhaba <strong>dünya</strong></p>" onChange={vi.fn()} etiket="Seans notu" />)
    const alan = screen.getByRole('textbox', { name: 'Seans notu' })
    expect(alan.querySelector('strong')?.textContent).toBe('dünya')
    expect(alan.getAttribute('contenteditable')).toBe('true')
    expect(alan.getAttribute('aria-multiline')).toBe('true')
  })

  it('4.2 araç çubuğu Türkçe, resim ve tema düğmesi yok', () => {
    render(<BicimliYuzey html="" onChange={vi.fn()} etiket="Seans notu" />)
    const cubuk = screen.getByRole('toolbar', { name: 'Biçim araçları' })
    for (const ad of ['Geri al', 'Yinele', 'Başlık biçimi', 'Liste seçenekleri', 'Alıntı', 'Kod bloğu', 'Kalın', 'İtalik', 'Altı çizili', 'Üstü çizili', 'Satır içi kod', 'Metni vurgula', 'Bağlantı', 'Üst simge', 'Alt simge', 'Sola hizala', 'Ortala', 'Sağa hizala', 'İki yana yasla', 'Bul ve değiştir']) {
      expect(within(cubuk).getByRole('button', { name: ad }), ad).toBeDefined()
    }
    expect(within(cubuk).queryByRole('button', { name: /image|resim|theme|tema|dark|koyu/i })).toBeNull()
  })

  it('4.3 E8: açılış ve normalleştirme onChange ÜRETMEZ', () => {
    for (const html of ['', 'düz metin', '<p>Merhaba <b>dünya</b></p>', '<h2>Veri</h2><p></p>', '<p><span style="color:red">x</span></p>']) {
      const onChange = vi.fn()
      const { unmount } = render(<BicimliYuzey html={html} onChange={onChange} etiket="Seans notu" />)
      expect(onChange, html).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('4.4 E8: belge normalleşmiş ilk hâle dönünce DIŞARIDAN gelen HAM dizgi bildirilir', () => {
    const ham = '<p>Merhaba <b>dünya</b></p>'
    const onChange = vi.fn()
    render(<BicimliYuzey html={ham} onChange={onChange} etiket="Seans notu" />)
    const editor = editorAl()
    act(() => { editor.commands.insertContent('x') })
    // ARTI YÖN: gerçek değişiklik yüzeyin kendi biçimiyle bildirilir.
    expect(onChange.mock.lastCall?.[0]).toContain('x')
    expect(onChange.mock.lastCall?.[0]).toContain('<strong>dünya</strong>')
    act(() => { editor.commands.undo() })
    expect(onChange).toHaveBeenLastCalledWith(ham)
  })

  it('4.5 dışarıdan gelen yeni html uygulanır; onChange tetiklenmez ve geri alınamaz', () => {
    const onChange = vi.fn()
    const { rerender } = render(<BicimliYuzey html="" onChange={onChange} etiket="Seans notu" />)
    rerender(<BicimliYuzey html="<h2>Veri</h2><p></p>" onChange={onChange} etiket="Seans notu" />)
    const editor = editorAl()
    expect(editor.getHTML()).toBe('<h2>Veri</h2><p></p>')
    expect(onChange).not.toHaveBeenCalled()
    act(() => { editor.commands.undo() })
    expect(editor.getHTML()).toBe('<h2>Veri</h2><p></p>')
  })

  it('4.6 kendi bildirdiği html prop olarak geri gelince belge yeniden kurulmaz', () => {
    let son = ''
    const onChange = vi.fn((h: string) => { son = h })
    const { rerender } = render(<BicimliYuzey html="<p>a</p>" onChange={onChange} etiket="Seans notu" />)
    const editor = editorAl()
    act(() => { editor.commands.insertContent('b') })
    const belge = editor.state.doc
    rerender(<BicimliYuzey html={son} onChange={onChange} etiket="Seans notu" />)
    expect(editor.state.doc).toBe(belge)
  })

  it('4.7 S7/E11 şema süzgeci: betik, olay özniteliği, javascript: bağlantısı ve resim düşer', () => {
    render(
      <BicimliYuzey
        html={'<p onclick="alert(1)">güvenli</p><script>alert(2)</script><p><a href="javascript:alert(3)">tıkla</a> <img src="x" onerror="alert(4)"></p>'}
        onChange={vi.fn()}
        etiket="Seans notu"
      />,
    )
    const alan = screen.getByRole('textbox', { name: 'Seans notu' })
    expect(alan.textContent).toContain('güvenli')
    expect(alan.textContent).toContain('tıkla')
    expect(alan.querySelector('script, img, [onclick], [onerror], a[href^="javascript"]')).toBeNull()
    const html = editorAl().getHTML()
    for (const yok of ['<script', 'onclick', 'onerror', 'javascript:', '<img']) expect(html, yok).not.toContain(yok)
  })

  it('4.8 E10 bağlantı target=_blank rel="noopener noreferrer"; yalnızca http/https/mailto bağlantı olur', () => {
    render(
      <BicimliYuzey
        html={'<p><a href="https://ornek.invalid/a">dış</a> <a href="mailto:a@ornek.invalid">posta</a> <a href="file:///etc/passwd">dosya</a> <a href="ftp://ornek.invalid">ftp</a></p>'}
        onChange={vi.fn()}
        etiket="Seans notu"
      />,
    )
    const alan = screen.getByRole('textbox', { name: 'Seans notu' })
    const dis = alan.querySelector('a[href="https://ornek.invalid/a"]')
    expect(dis?.getAttribute('target')).toBe('_blank')
    expect(dis?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(alan.querySelector('a[href^="mailto:"]')).not.toBeNull()
    expect(alan.querySelector('a[href^="file:"], a[href^="ftp:"]')).toBeNull()
    expect(alan.textContent).toContain('dosya')
  })

  it('editable=false: düzenlenemez ve araç çubuğu yok', () => {
    render(<BicimliYuzey html="<p>okunur</p>" etiket="Not" editable={false} />)
    expect(screen.getByRole('textbox', { name: 'Not' }).getAttribute('contenteditable')).toBe('false')
    expect(screen.queryByRole('toolbar')).toBeNull()
  })
})
```

`web/src/not/NotOkuma.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotOkuma } from './NotOkuma'

afterEach(() => vi.restoreAllMocks())

const vurgular = (kap: HTMLElement) => [...kap.querySelectorAll('.not-vurgu')].map((e) => e.textContent)

describe('NotOkuma (gerçek TipTap, salt okunur)', () => {
  it('4.9 vurgu Türkçe harf duyarsız; ilk eşleşme görünür alana kaydırılır', () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    const { container } = render(
      <NotOkuma html="<p>Çok <strong>KAYGI</strong>lı bir gün; kaygı azaldı</p>" vurgu="kaygi" />,
    )
    expect(container.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false')
    expect(vurgular(container)).toEqual(['KAYGI', 'kaygı'])
    expect(kaydir).toHaveBeenCalledTimes(1)
    expect((kaydir.mock.contexts[0] as HTMLElement).classList.contains('not-vurgu')).toBe(true)
  })

  it('4.10 biçim etiketinin böldüğü kelime de işaretlenir (inceleme odağı 3)', () => {
    const { container } = render(<NotOkuma html="<p>ön<strong>em</strong>li bir konu</p>" vurgu="ONEMLI" />)
    expect(vurgular(container).join('')).toBe('önemli')
  })

  it('vurgu yoksa ya da tek karakterse işaret ve kaydırma yok', () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    for (const vurgu of ['', 'k']) {
      const { container, unmount } = render(<NotOkuma html="<p>kaygı</p>" vurgu={vurgu} />)
      expect(vurgular(container), vurgu).toEqual([])
      unmount()
    }
    expect(kaydir).not.toHaveBeenCalled()
  })

  it('vurgu değişince yeni terim işaretlenir, eskisi kalkar', () => {
    const { container, rerender } = render(<NotOkuma html="<p>uyku ve kaygı</p>" vurgu="uyku" />)
    expect(vurgular(container)).toEqual(['uyku'])
    rerender(<NotOkuma html="<p>uyku ve kaygı</p>" vurgu="kaygı" />)
    expect(vurgular(container)).toEqual(['kaygı'])
  })
})
```

- [ ] **Adım 9: Kırmızıyı gör** — web/: `npx vitest run src/not src/sablonKodu.test.ts` → FAIL (`./BicimliYuzey`, `./NotOkuma`, `./vurgu` yok; `sablonKodu` şablonda kalıntı varsa onu da gösterir).

- [ ] **Adım 10: `vurgu.ts`'i yaz**

```ts
import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Türkçe harf katlaması — sunucudaki `store::search::katla_karakter`'in
 * istemci eşi (yalnızca VURGU için; arama sunucuda yapılır). UTF-16
 * birimi başına 1:1: katlanmış metindeki konum ham metindeki konumdur.
 */
const KATLAMA: Record<string, string> = {
  ı: 'i', İ: 'i', I: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c',
}

export function katla(metin: string): string {
  let sonuc = ''
  for (const birim of metin.split('')) {
    const eslesen = KATLAMA[birim]
    if (eslesen !== undefined) sonuc += eslesen
    else if (birim >= 'A' && birim <= 'Z') sonuc += birim.toLowerCase()
    else sonuc += birim
  }
  return sonuc
}

/** Sunucudaki `ASGARI_SORGU` (2) ile aynı: daha kısa terim vurgulanmaz. */
export const ASGARI_VURGU = 2

export function eslesmeAraliklari(metin: string, terim: string): Array<[number, number]> {
  const hedef = katla(terim.trim())
  if (hedef.length < ASGARI_VURGU) return []
  const katli = katla(metin)
  const araliklar: Array<[number, number]> = []
  let konum = katli.indexOf(hedef)
  while (konum !== -1) {
    araliklar.push([konum, konum + hedef.length])
    konum = katli.indexOf(hedef, konum + hedef.length)
  }
  return araliklar
}

export function vurguParcalari(metin: string, terim: string): Array<{ metin: string; vurgu: boolean }> {
  const parcalar: Array<{ metin: string; vurgu: boolean }> = []
  let onceki = 0
  for (const [bas, son] of eslesmeAraliklari(metin, terim)) {
    if (bas > onceki) parcalar.push({ metin: metin.slice(onceki, bas), vurgu: false })
    parcalar.push({ metin: metin.slice(bas, son), vurgu: true })
    onceki = son
  }
  if (onceki < metin.length || parcalar.length === 0) parcalar.push({ metin: metin.slice(onceki), vurgu: false })
  return parcalar
}

type VurguDurumu = { terim: string; susler: DecorationSet }
const vurguAnahtari = new PluginKey<VurguDurumu>('notVurgusu')

/**
 * Her metin bloğunda işaretler (kalın, vurgu…) metni kaç düğüme bölerse
 * bölsün blok TEK dizgi olarak aranır; `konumlar[i]` dizginin i. biriminin
 * belge konumudur. Satır içi atom düğümler (ör. satır sonu) tek yer
 * tutucuyla sayılır.
 */
function suslemeleriKur(belge: PMNode, terim: string): DecorationSet {
  if (katla(terim.trim()).length < ASGARI_VURGU) return DecorationSet.empty
  const suslemeler: Decoration[] = []
  belge.descendants((dugum, konum) => {
    if (!dugum.isTextblock) return true
    let metin = ''
    const konumlar: number[] = []
    dugum.forEach((cocuk, ofset) => {
      const bas = konum + 1 + ofset
      if (cocuk.isText) {
        const t = cocuk.text ?? ''
        for (let i = 0; i < t.length; i++) {
          metin += t[i]
          konumlar.push(bas + i)
        }
      } else {
        metin += '\uFFFC'
        konumlar.push(bas)
      }
    })
    for (const [bas, son] of eslesmeAraliklari(metin, terim)) {
      suslemeler.push(Decoration.inline(konumlar[bas], konumlar[son - 1] + 1, { class: 'not-vurgu' }))
    }
    return false
  })
  return DecorationSet.create(belge, suslemeler)
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    notVurgusu: {
      /** Terimi (Türkçe harf duyarsız) bütün eşleşmelerde işaretler; boş terim temizler. */
      vurguAyarla: (terim: string) => ReturnType
    }
  }
}

/** Önceki notlarda aranan terimin okuma görünümündeki vurgusu (tasarım N7). Belgeyi DEĞİŞTİRMEZ. */
export const NotVurgusu = Extension.create({
  name: 'notVurgusu',
  addCommands() {
    return {
      vurguAyarla:
        (terim: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(vurguAnahtari, terim)
          return true
        },
    }
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<VurguDurumu>({
        key: vurguAnahtari,
        state: {
          init: () => ({ terim: '', susler: DecorationSet.empty }),
          apply: (tr, onceki) => {
            const yeni = tr.getMeta(vurguAnahtari) as string | undefined
            if (yeni === undefined && !tr.docChanged) return onceki
            const terim = yeni ?? onceki.terim
            return { terim, susler: suslemeleriKur(tr.doc, terim) }
          },
        },
        props: { decorations: (durum) => vurguAnahtari.getState(durum)?.susler },
      }),
    ]
  },
})
```

- [ ] **Adım 11: Uzantılar, stiller, araç çubuğu, yüzey ve okuma görünümünü yaz**

`web/src/not/uzantilar.ts`:

```ts
import type { Extensions } from '@tiptap/core'
import { FindAndReplace } from '@tiptap/extension-find-and-replace'
import { Highlight } from '@tiptap/extension-highlight'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TextAlign } from '@tiptap/extension-text-align'
import { Typography } from '@tiptap/extension-typography'
import { Placeholder, Selection } from '@tiptap/extensions'
import { StarterKit } from '@tiptap/starter-kit'
import { HorizontalRule } from '@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension'
import { NotVurgusu } from './vurgu'

/**
 * Not editörünün ve okuma görünümünün ORTAK şeması (tasarım E2, S7).
 *
 * Saklanan HTML hiçbir yerde `innerHTML` ile basılmaz: okuma görünümü de
 * bu uzantılarla kurulmuş bir TipTap örneğidir, dolayısıyla şemada olmayan
 * etiket (resim, betik, stil) ve öznitelik (`on*`) ayrıştırmada düşer.
 * Resim uzantısı bilerek YOK (E2: yapıştırılan/sürüklenen resim düşer).
 *
 * Bağlantılar (E10): yalnızca `http:`/`https:`/`mailto:`; `javascript:`,
 * `file:` vb. ayrıştırmada bağlantı olmaktan çıkar, metin kalır. Hepsi
 * `target="_blank"` ile açılır: Tauri bu isteği `on_new_window`'da yakalar
 * ve sistem tarayıcısına devreder, uygulama penceresi asla başka siteye
 * gitmez (P6b). Düzenlenebilir yüzeyde tıklama bağlantıyı AÇMAZ (imleci
 * koyar, Word gibi düzenlenir); okuma görünümünde tıklama açar.
 */
const IZINLI_BAGLANTI = /^(https?:\/\/|mailto:)/i

export function baglantiIzinliMi(adres: string): boolean {
  return IZINLI_BAGLANTI.test(adres.trim())
}

export function notUzantilari({ duzenlenebilir }: { duzenlenebilir: boolean }): Extensions {
  return [
    StarterKit.configure({
      horizontalRule: false,
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: !duzenlenebilir,
        enableClickSelection: duzenlenebilir,
        autolink: true,
        defaultProtocol: 'https',
        isAllowedUri: (adres) => baglantiIzinliMi(adres),
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer', class: null },
      },
    }),
    HorizontalRule,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight.configure({ multicolor: true }),
    Typography,
    Superscript,
    Subscript,
    Selection,
    FindAndReplace.configure({ searchDebounceMs: 300, injectCSS: false }),
    Placeholder.configure({ placeholder: duzenlenebilir ? 'Notunuzu yazın…' : '' }),
    NotVurgusu,
  ]
}
```

`web/src/not/stiller.ts`:

```ts
// Şablonun düğüm stilleri + uygulama teması (tasarım E4). Düzenlenebilir
// yüzey de okuma görünümü de bu modülü içe aktarır: aynı tipografi (E12).
import '@/components/tiptap-node/blockquote-node/blockquote-node.scss'
import '@/components/tiptap-node/code-block-node/code-block-node.scss'
import '@/components/tiptap-node/heading-node/heading-node.scss'
import '@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss'
import '@/components/tiptap-node/list-node/list-node.scss'
import '@/components/tiptap-node/paragraph-node/paragraph-node.scss'
import './not-yuzeyi.scss'
```

`web/src/not/not-yuzeyi.scss`:

```scss
// Tasarım E4: şablon değişkenleri uygulamanın AÇIK temasına bağlanır —
// slate tonları, uygulamanın yazı tipi (`--sans`, index.css), 16 px gövde.
:root {
  --tt-brand-color-50: #f8fafc;
  --tt-brand-color-100: #f1f5f9;
  --tt-brand-color-200: #e2e8f0;
  --tt-brand-color-300: #cbd5e1;
  --tt-brand-color-400: #94a3b8;
  --tt-brand-color-500: #475569;
  --tt-brand-color-600: #334155;
  --tt-brand-color-700: #1e293b;
  --tt-brand-color-800: #0f172a;
  --tt-brand-color-900: #0f172a;
  --tt-brand-color-950: #020617;
  --tt-cursor-color: #0f172a;
  --tt-selection-color: rgba(100, 116, 139, 0.25);
}

.tiptap.ProseMirror.not-yuzeyi {
  font-family: var(--sans);
  font-size: 16px;
  line-height: 1.6;
  color: #0f172a;
  min-height: 16rem;
  padding: 0.75rem 1rem;
  outline: none;
  overflow-wrap: break-word;
}

.tiptap.ProseMirror.not-okuma {
  min-height: 0;
  padding: 0.5rem 0.75rem;
}

.tiptap.ProseMirror.not-yuzeyi p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
  color: #94a3b8;
}

// Önceki notlarda aranan terim (tasarım N7).
.not-vurgu {
  background-color: #fde68a;
  border-radius: 2px;
}

// Bul-değiştir sonuçları (`FindAndReplace`, `injectCSS: false`).
.find-and-replace-result {
  background-color: #fef3c7;
}
.find-and-replace-result-current {
  background-color: #fcd34d;
}

.not-bul-paneli {
  position: absolute;
  top: calc(var(--tt-toolbar-height, 44px) + 0.25rem);
  right: 0.5rem;
  z-index: 20;
}
```

`web/src/not/AracCubugu.tsx`:

```tsx
import { BlockquoteButton } from '@/components/tiptap-ui/blockquote-button'
import { CodeBlockButton } from '@/components/tiptap-ui/code-block-button'
import { ColorHighlightPopover } from '@/components/tiptap-ui/color-highlight-popover'
import { HeadingDropdownMenu } from '@/components/tiptap-ui/heading-dropdown-menu'
import { LinkPopover } from '@/components/tiptap-ui/link-popover'
import { ListDropdownMenu } from '@/components/tiptap-ui/list-dropdown-menu'
import { MarkButton } from '@/components/tiptap-ui/mark-button'
import { SearchAndReplaceButton } from '@/components/tiptap-ui/search-and-replace'
import { TextAlignButton } from '@/components/tiptap-ui/text-align-button'
import { UndoRedoButton } from '@/components/tiptap-ui/undo-redo-button'
import { Spacer } from '@/components/tiptap-ui-primitive/spacer'
import { Toolbar, ToolbarGroup, ToolbarSeparator } from '@/components/tiptap-ui-primitive/toolbar'

/**
 * Not editörünün araç çubuğu (tasarım E2): şablonun `MainToolbarContent`'i,
 * masaüstü düzeniyle (uygulama en az 1024 px). Kısayolları TipTap'ın kendi
 * tuş haritaları uygular (E5); düğmeler yalnızca aynı komutları çağırır.
 */
export function AracCubugu({ bulAcik, onBulDegistir }: { bulAcik: boolean; onBulDegistir: () => void }) {
  return (
    <Toolbar aria-label="Biçim araçları">
      <ToolbarGroup>
        <UndoRedoButton action="undo" />
        <UndoRedoButton action="redo" />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <HeadingDropdownMenu modal={false} levels={[1, 2, 3]} />
        <ListDropdownMenu modal={false} types={['bulletList', 'orderedList', 'taskList']} />
        <BlockquoteButton />
        <CodeBlockButton />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <MarkButton type="bold" />
        <MarkButton type="italic" />
        <MarkButton type="underline" />
        <MarkButton type="strike" />
        <MarkButton type="code" />
        <ColorHighlightPopover />
        <LinkPopover />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <MarkButton type="superscript" />
        <MarkButton type="subscript" />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup>
        <TextAlignButton align="left" />
        <TextAlignButton align="center" />
        <TextAlignButton align="right" />
        <TextAlignButton align="justify" />
      </ToolbarGroup>
      <Spacer />
      <ToolbarGroup>
        <SearchAndReplaceButton
          aria-expanded={bulAcik}
          data-active-state={bulAcik ? 'on' : 'off'}
          onClick={onBulDegistir}
        />
      </ToolbarGroup>
    </Toolbar>
  )
}
```

`web/src/not/BicimliYuzey.tsx`:

```tsx
import { EditorContent, EditorContext, useEditor } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { SearchAndReplace } from '@/components/tiptap-ui/search-and-replace'
import { AracCubugu } from './AracCubugu'
import { notUzantilari } from './uzantilar'
import './stiller'

/**
 * Biçimli not yüzeyi (tasarım E1-E4, E8, E10-E11): TipTap Simple Editor
 * şablonundan kurulu, HTML alır ve HTML bildirir.
 *
 * # Açılışta yazma yok (E8)
 *
 * TipTap yüklediği HTML'i kendi biçimine normalleştirir (`<b>` → `<strong>`,
 * `''` → `<p></p>`). Bu bir "değişiklik" değildir: `onChange` yalnızca
 * kullanıcı belgeyi değiştirdiğinde çağrılır ve belge dışarıdan gelen son
 * değerin NORMALLEŞMİŞ hâline dönünce (yaz-sil, geri al) o dış değerin HAM
 * dizgisiyle çağrılır. Böylece `NotEditoru`'nun "sunucudaki hâl" imzası
 * normalleşmeden etkilenmez; kullanıcı tek tuşa basmadan PUT ve silinemez
 * denetim satırı üretilmez.
 *
 * # Dışarıdan gelen değer
 *
 * `html` prop'u yalnızca başlangıç değeri değildir: şablon ekleme ve
 * `sunucuHali` benimseme onu değiştirir. Yeni değer bu yüzeyin son
 * bildirdiği değer ya da son dış değer DEĞİLSE içerik değiştirilir;
 * değişiklik `onChange` üretmez ve geri alma yığınına GİRMEZ (sunucudan
 * benimsenen hâlden Ctrl+Z ile eski metne dönüp onu PUT etmek, öbür ekranda
 * yazılanı silerdi).
 *
 * # Test yüzeyi
 *
 * Vitest'te bu modül `test-kurulum.ts`'te bir `<textarea>` ile değiştirilir
 * (tasarım §11); gerçek yüzey `BicimliYuzey.test.tsx`'te ve e2e'de sınanır.
 */
export type BicimliYuzeyProps = {
  html: string
  onChange?: (html: string) => void
  /** Erişilebilir ad: "Seans notu", "Özel notum" (hangi tabloya yazıldığını söyler). */
  etiket: string
  editable?: boolean
  /** Vurgulanacak terim (bkz. `not/vurgu.ts`); okuma görünümüyle aynı eklenti. */
  vurgu?: string
}

export function BicimliYuzey({ html, onChange, etiket, editable = true, vurgu = '' }: BicimliYuzeyProps) {
  const [bulAcik, setBulAcik] = useState(false)
  const bilinenDis = useRef<{ ham: string; normal: string | null }>({ ham: html, normal: null })
  const sonBildirilen = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    extensions: notUzantilari({ duzenlenebilir: editable }),
    content: html,
    editable,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': etiket,
        'aria-multiline': 'true',
        ...(editable ? {} : { 'aria-readonly': 'true' }),
        class: 'not-yuzeyi',
      },
    },
    // `onCreate` KULLANILMAZ: TipTap `create` olayını `setTimeout(0)` ile
    // yayıyor; normalleşmiş ilk hâl o zamana kadar bilinmezse ilk tuş
    // vuruşları eşlemeyi kaçırırdı. Aşağıdaki efekt ilk boyamadan hemen
    // sonra (kullanıcı tek tuşa basmadan) okur.
    onUpdate: ({ editor: e }) => {
      const yeni = e.getHTML()
      const { ham, normal } = bilinenDis.current
      const bildirilecek = yeni === normal ? ham : yeni
      sonBildirilen.current = bildirilecek
      onChangeRef.current?.(bildirilecek)
    },
  })

  useEffect(() => {
    if (editor === null) return
    if (bilinenDis.current.normal === null) {
      bilinenDis.current = { ham: bilinenDis.current.ham, normal: editor.getHTML() }
    }
    if (html === sonBildirilen.current || html === bilinenDis.current.ham) return
    editor.chain().setMeta('addToHistory', false).setContent(html, { emitUpdate: false }).run()
    bilinenDis.current = { ham: html, normal: editor.getHTML() }
    sonBildirilen.current = null
  }, [editor, html])

  useEffect(() => {
    editor?.setEditable(editable, false)
  }, [editor, editable])

  useEffect(() => {
    editor?.commands.vurguAyarla(vurgu)
  }, [editor, vurgu])

  return (
    <EditorContext.Provider value={{ editor }}>
      <div className="not-editoru relative flex flex-col rounded border border-slate-300 bg-white">
        {editable && <AracCubugu bulAcik={bulAcik} onBulDegistir={() => setBulAcik((a) => !a)} />}
        {editable && (
          <SearchAndReplace
            className="not-bul-paneli"
            open={bulAcik}
            onOpen={() => setBulAcik(true)}
            onClose={() => setBulAcik(false)}
            scrollIntoViewOptions={{ block: 'center' }}
          />
        )}
        <EditorContent editor={editor} role="presentation" />
      </div>
    </EditorContext.Provider>
  )
}
```

`web/src/not/NotOkuma.tsx`:

```tsx
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect } from 'react'
import { notUzantilari } from './uzantilar'
import './stiller'

/**
 * Salt okunur not görünümü (tasarım S7, E12): önceki notlar paneli, okuma
 * penceresi ve geçmiş listesi. `innerHTML` YOK — editörle aynı uzantılarla
 * kurulmuş `editable: false` bir TipTap örneği; şemada olmayan her şey
 * ayrıştırmada düşer. `vurgu` verilirse bütün eşleşmeler işaretlenir ve
 * ilki ekranın ortasına getirilir (N7). Bu bileşen HİÇBİR yazma yapmaz.
 */
export function NotOkuma({ html, vurgu = '' }: { html: string; vurgu?: string }) {
  const editor = useEditor(
    {
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      extensions: notUzantilari({ duzenlenebilir: false }),
      content: html,
      editable: false,
      editorProps: { attributes: { class: 'not-yuzeyi not-okuma', 'aria-readonly': 'true' } },
    },
    [html],
  )

  useEffect(() => {
    if (editor === null) return
    editor.commands.vurguAyarla(vurgu)
    if (vurgu.trim() === '') return
    editor.view.dom.querySelector('.not-vurgu')?.scrollIntoView({ block: 'center' })
  }, [editor, vurgu])

  return <EditorContent editor={editor} />
}
```

- [ ] **Adım 12: Test yüzeyini ve jsdom taklitlerini ekle** (`web/src/test-kurulum.ts` sonuna)

```ts
import { createElement } from 'react'
import { vi } from 'vitest'
import type { BicimliYuzeyProps } from './not/BicimliYuzey'

// # Not yüzeyinin test yüzeyi (tasarım §11 "Test yüzeyi kararı")
//
// jsdom'da `contenteditable` üzerinde `userEvent.type`/`fireEvent.change`
// güvenilir değil. `NotEditoru`, `SeansPaneli`, `AnaEkran`, `DanisanDosyasi`
// sözleşme testleri metni AYNI sözleşmeyi (`html`, `onChange`, `etiket`,
// `editable`) sağlayan bir `<textarea>` ile sürer; gerçek TipTap yüzeyi
// `not/BicimliYuzey.test.tsx`, `seans/NotEditoru.gercekYuzey.test.tsx` ve
// e2e'de sınanır. Gerçeği isteyen dosya bu taklidi kendi `vi.mock`'uyla
// (`importOriginal`) geri alır.
vi.mock('./not/BicimliYuzey', () => ({
  BicimliYuzey: ({ html, onChange, etiket, editable = true }: BicimliYuzeyProps) =>
    createElement('textarea', {
      'aria-label': etiket,
      value: html,
      readOnly: !editable,
      onChange: (olay: { target: { value: string } }) => onChange?.(olay.target.value),
    }),
}))

// jsdom Range geometri API'lerini, `elementFromPoint`'i ve ResizeObserver'ı
// uygulamıyor; gerçek TipTap/ProseMirror ve şablonun açılır pencereleri
// bunlara dokunabiliyor. Boş dikdörtgenler yerleşim İDDİA etmez, yalnızca
// çökmeyi önler (yerleşim e2e'de ölçülür).
const bosDikdortgen = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect
Range.prototype.getBoundingClientRect = () => bosDikdortgen
Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
if (typeof document.elementFromPoint !== 'function') document.elementFromPoint = () => null
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
```

(Dosyanın mevcut `import { configure } …` satırıyla birlikte içe aktarmalar dosyanın başına toplanır.)

- [ ] **Adım 13: Yeşili gör** — web/: `npx vitest run src/not src/sablonKodu.test.ts src/istemciRaporUretimi.test.ts` → PASS; `npx vitest run` → hepsi PASS (test yüzeyi henüz kullanılmıyor; mevcut testler etkilenmez). Takma ad ya da gerçek yüzey geri alma (`vi.mock` + `importOriginal`) çalışmazsa — `BicimliYuzey.test.tsx` bir textarea görür — aynı satırı `vi.unmock('./BicimliYuzey')` ile değiştir ve raporda yaz.

- [ ] **Adım 14: Tam doğrulama**

- `npm --prefix web run build` → hata yok. Şablon dosyalarında `noUnusedLocals`/`verbatimModuleSyntax` hatası çıkarsa (2026-09-26 denemesinde bu bayraklarla temiz derlendi) yalnızca o satırı düzelt ve raporda listele.
- Derlenen stil değişkenleri gerçekten pakette: `rg -c "tt-gray-light-50" web/dist/assets/*.css` ≥ 1 ve `rg -c "fonts.googleapis" web/dist` = 0. İlki 0 ise `index.css`'teki iki `@import`'u sil, aynı iki dosyayı `web/src/not/stiller.ts`'in başından `import '@/styles/_variables.scss'` / `import '@/styles/_keyframe-animations.scss'` ile içe aktar ve raporda yaz.
- `npm --prefix web run lint` → uyarı sayısı Görev 3 sonundakiyle aynı.
- `cargo test --workspace` (web derlemesinden sonra) → PASS (Rust tarafı değişmedi; `rust_embed` yeni paketi gömer).
- E2E gerekmez (arayüzde henüz kullanıcıya görünen değişiklik yok).

- [ ] **Adım 15: Commit**

```bash
git add web/tsconfig.json web/tsconfig.app.json web/vite.config.ts web/package.json web/package-lock.json web/.oxlintrc.json web/src/index.css web/src/scss.d.ts web/src/components web/src/hooks web/src/lib web/src/styles web/src/not/uzantilar.ts web/src/not/vurgu.ts web/src/not/vurgu.test.ts web/src/not/stiller.ts web/src/not/not-yuzeyi.scss web/src/not/AracCubugu.tsx web/src/not/BicimliYuzey.tsx web/src/not/BicimliYuzey.test.tsx web/src/not/NotOkuma.tsx web/src/not/NotOkuma.test.tsx web/src/sablonKodu.test.ts web/src/istemciRaporUretimi.test.ts web/src/test-kurulum.ts
git commit -m "Editor: TipTap Simple Editor kurulumu, BicimliYuzey, NotOkuma ve test yuzeyi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Mutasyonlar:**
- `BicimliYuzey` `onUpdate`'te `yeni === normal ? ham : yeni` → `yeni` → test 4.4 kırılır.
- Dış değer efektinde `setMeta('addToHistory', false)`'u sil → test 4.5 kırılır.
- `notUzantilari`'da `isAllowedUri` satırını sil → test 4.8 (`file:`/`ftp:` bağlantı oldu) kırılır.
- `suslemeleriKur`'da blok metnini düğüm düğüm ara (her `cocuk.text` için ayrı `eslesmeAraliklari`) → test 4.10 kırılır.
- `katla`'dan `İ: 'i'` sil → `katla` testi ve `NotOkuma` İ'li bir terimde kırılır (test tablosundaki `İ -> i`).
- `not-yuzeyi.scss`'e `@import url("https://ornek.invalid/x.css");` ekle → `sablonKodu.test.ts` kırılır.

---

### Task 5: `NotEditoru` → `BicimliYuzey`; Markdown yığını kalkar (spec §5 E5–E9, E12–E13)

**Files:**
- Create: `web/src/not/htmlBos.ts`, `web/src/not/htmlBos.test.ts`
- Create: `web/src/seans/NotEditoru.gercekYuzey.test.tsx`
- Create: `web/src/htmlBasmaYok.test.ts` (yapısal `innerHTML` taraması `not/markdown.test.tsx`'ten TAŞINIR)
- Modify: `web/src/seans/NotEditoru.tsx` (içe aktarmalar L1–15; modül başlığı son paragrafı; L140–220 silinir; bileşen içi L249–261, L291–295, L346–362, L433–529 bölgeleri; JSX L582–635)
- Modify: `web/src/seans/sablon.ts` (`sablonMetni` ve üstündeki başlık), `web/src/seans/sablon.test.ts` (L10–16)
- Modify: `web/src/seans/GecmisNotlar.tsx` (L3 içe aktarma, L131–137), `web/src/seans/GecmisNotlar.test.tsx`
- Modify: `web/src/seans/NotEditoru.test.tsx` (L778–995 silinir; şablon testleri; yeni testler)
- Modify: `web/src/seans/SeansPaneli.test.tsx` (L479–484), `web/src/danisan/DanisanDosyasi.test.tsx` (L286–288)
- Modify: `web/src/etiket/EtiketSatiri.tsx` (L78–79 yorum)
- Delete: `web/src/not/bicim.ts`, `web/src/not/bicim.test.ts`, `web/src/not/BicimCubugu.tsx`, `web/src/not/markdown.tsx`, `web/src/not/markdown.test.tsx`, `web/src/not/desenler.ts`, `web/src/not/NotGorunumu.tsx`
- Modify (e2e): `e2e/notlar.spec.ts` (L146, L347, L350), `e2e/kabuk.spec.ts` (L174), `e2e/takvim.spec.ts` (taşıma testindeki iki `toHaveValue(not)`), `e2e/notlar-gelismis.spec.ts` (`kelimeSec`, testler 1 ve 4, L211, L242)

**Interfaces:**
- Produces: `export function htmlBosMu(html: string): boolean` — etiketler ve boşluk (`&nbsp;` dâhil) atılınca hiçbir şey kalmıyorsa `true`.
- Produces: `sablonMetni(kod)` → `SABLONLAR[kod].map(b => `<h2>${b}</h2><p></p>`).join('')` (`serbest` ve bilinmeyen kod `''`).
- `NotEditoru` prop'ları DEĞİŞMEZ (`baslangicIcerik`, `baslangicSablon`, `onKaydet`, `gecikmeMs`, `taslakAnahtari`, `etiket`, `sablonSecilebilir`, `sunucuHali`); içerik artık HTML dizgisidir. Taslak anahtarları (`not-<id>` takvim ve dosyada ortak, `ozel-<id>`) aynen kalır.
- Removes: `not/bicim.ts` (`bicimUygula`, `BicimTuru`, `Secim`), `not/BicimCubugu.tsx`, `not/markdown.tsx`, `not/desenler.ts`, `not/NotGorunumu.tsx`; `NotEditoru`'nun Yaz/Önizle anahtarı, biçim çubuğu, `execCommand` yolu ve `kisayolTusu` (kısayolları TipTap uygular, E5).

- [ ] **Adım 1: Başarısız testleri yaz**

`web/src/not/htmlBos.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { htmlBosMu } from './htmlBos'

describe('htmlBosMu — şablon ekleme kuralı (tasarım E9)', () => {
  for (const bos of ['', '   ', '<p></p>', '<p> </p>', '<p>&nbsp;</p>', '<p><br></p>', '<p></p><p></p>']) {
    it(`boş: ${JSON.stringify(bos)}`, () => expect(htmlBosMu(bos)).toBe(true))
  }
  // İki yön: her şeyi boş sayan bir kural dolu notun üstüne şablon yazardı.
  for (const dolu of ['<p>a</p>', 'düz metin', '<h2>Veri</h2><p></p>', '<ul><li><p>x</p></li></ul>']) {
    it(`dolu: ${JSON.stringify(dolu)}`, () => expect(htmlBosMu(dolu)).toBe(false))
  }
})
```

`web/src/seans/NotEditoru.gercekYuzey.test.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NotEditoru } from './NotEditoru'
import { taslaklariUnut } from './taslak'

// GERÇEK TipTap yüzeyiyle editör sözleşmesi (tasarım E8, inceleme odağı 1).
// Diğer NotEditoru testleri textarea test yüzeyini kullanıyor; normalleştirme
// yalnızca gerçek yüzeyde olur.
vi.mock('../not/BicimliYuzey', async (importOriginal) => await importOriginal<typeof import('../not/BicimliYuzey')>())

function editorAl(): Editor {
  const pm = document.querySelector('.ProseMirror') as (HTMLElement & { editor?: Editor }) | null
  if (!pm?.editor) throw new Error('TipTap editörü bulunamadı')
  return pm.editor
}

async function ilerle(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

beforeEach(() => {
  taslaklariUnut()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('NotEditoru + gerçek TipTap yüzeyi', () => {
  it('5.1 E8: açılış normalleştirmesi (ne zamanlayıcıyla ne unmount tahliyesiyle) kayıt ÜRETMEZ', async () => {
    const onKaydet = vi.fn().mockResolvedValue(undefined)
    const icerikler = ['', 'düz metin', '<p>Merhaba <b>dünya</b></p>', '<h2>Veri</h2><p></p><h2>Plan</h2><p></p>']
    for (const [i, icerik] of icerikler.entries()) {
      const { unmount } = render(
        <NotEditoru baslangicIcerik={icerik} baslangicSablon="dap" onKaydet={onKaydet} gecikmeMs={20} taslakAnahtari={`e8-${i}`} />,
      )
      await ilerle(200)
      unmount()
    }
    expect(onKaydet).not.toHaveBeenCalled()
  })

  it('5.2 E8: yazıp geri alınca kayıt yok ve durum temiz; ARTI YÖN: gerçek yazma TAM bir kez kaydeder', async () => {
    const onKaydet = vi.fn().mockResolvedValue(undefined)
    render(
      <NotEditoru baslangicIcerik="<p>Merhaba <b>dünya</b></p>" baslangicSablon="serbest" onKaydet={onKaydet} gecikmeMs={20} taslakAnahtari="e8-geri" />,
    )
    const editor = editorAl()
    act(() => { editor.commands.insertContent('x') })
    act(() => { editor.commands.undo() })
    await ilerle(200)
    expect(onKaydet).not.toHaveBeenCalled()
    // `NotEditoru`'nun durum bölgesi DOM'da yüzeyin (araç çubuğu) ÖNÜNDE.
    expect(screen.getAllByRole('status')[0].textContent).toBe('')

    act(() => { editor.commands.insertContent('Y') })
    await ilerle(200)
    expect(onKaydet).toHaveBeenCalledTimes(1)
    const kayit = onKaydet.mock.calls[0][0] as { icerik: string }
    expect(kayit.icerik).toContain('Y')
    expect(kayit.icerik).toContain('<strong>dünya</strong>')
  })
})
```

`web/src/seans/NotEditoru.test.tsx` — `describe('NotEditoru', …)` içine (mevcut `sablon secilince…` testinin altına):

```ts
  it('5.3 E9: <p></p> boş sayılır; şablon seçilince HTML başlıkları eklenir', () => {
    kur({ baslangicIcerik: '<p></p>', baslangicSablon: 'serbest' })
    sablonSec('dap')
    expect(alan().value).toBe('<h2>Veri</h2><p></p><h2>Değerlendirme</h2><p></p><h2>Plan</h2><p></p>')
  })

  it('5.4 dolu HTML notta şablon değişimi metni ezmez', () => {
    kur({ baslangicIcerik: '<p>yazılmış</p>' })
    sablonSec('soap')
    expect(alan().value).toBe('<p>yazılmış</p>')
  })

  it('5.5 sunucudaki hâle geri dönünce "Kaydedilmemiş…" yazısı kalkar ve kayıt GİTMEZ (geri alma)', async () => {
    const props = kur({ baslangicIcerik: '<p>a</p>' })
    fireEvent.change(alan(), { target: { value: '<p>ab</p>' } })
    expect(screen.getByRole('status').textContent).toBe('Kaydedilmemiş değişiklikler var…')
    fireEvent.change(alan(), { target: { value: '<p>a</p>' } })
    expect(screen.getByRole('status').textContent).toBe('')
    await ilerle(200)
    expect(props.onKaydet).not.toHaveBeenCalled()
  })
```

`web/src/htmlBasmaYok.test.ts`: `not/markdown.test.tsx`'in L206–L272 bloğunu (başlık yorumu + `tumKaynaklar` + `uretimKaynaklari` + `describe('yapısal: …')`) AYNEN buraya taşı; yalnızca üç değişiklik: glob `['./**/*.ts', './**/*.tsx']`, bilinen dosya iddiası `expect(yollar).toContain('./seans/sablon.ts')` (ve `path` içe aktarması kalkar), eşik `toBeGreaterThan(25)` → `toBeGreaterThan(100)` (şablon kodu eklendi; boş tarama yine ayırt edilir). Başlık yorumuna ekle: "Tasarım S7: saklanan not HTML'i okuma görünümünde bile `innerHTML` ile basılmaz (`not/NotOkuma.tsx`); bu tarama o sözün yapısal bekçisidir ve şablon kodunu da (`components/`, `hooks/`, `lib/`) kapsar." Test dosyasının başı:

```ts
import { describe, expect, it } from 'vitest'
```

- [ ] **Adım 2: Kırmızıyı gör** — web/: `npx vitest run src/not/htmlBos.test.ts src/seans/NotEditoru.gercekYuzey.test.tsx src/seans/NotEditoru.test.tsx` → FAIL (`./htmlBos` yok; gerçek yüzey testleri editör bulamıyor — `NotEditoru` hâlâ textarea çiziyor; 5.3 `## ` biçimi; 5.5 durum "Kaydedilmemiş…"de kalıyor).

- [ ] **Adım 3: Boşluk kuralını ve şablonu yaz**

`web/src/not/htmlBos.ts`:

```ts
/**
 * Editör "boş" mu (tasarım E9: dolu editörde şablon değişimi metni ezmez).
 * İçerik artık HTML: TipTap boş belgeyi `<p></p>` olarak bildirir, yani
 * eski `icerik.trim() === ''` ölçütü yazılmış hiçbir şey yokken de "dolu"
 * derdi. Etiketler ve boşluk (`&nbsp;` dâhil) atılınca hiçbir şey
 * kalmıyorsa boştur. Şablon başlığı (`<h2>Veri</h2>`) METİNDİR: başlıklı bir
 * not boş sayılmaz, şablon değişimi onu ezmez.
 */
export function htmlBosMu(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === ''
}
```

`web/src/seans/sablon.ts`: "# Başlıklar Markdown ikinci düzey başlığı (`## `)" bölümünü şununla değiştir: "# Başlıklar HTML ikinci düzey başlık + boş paragraf (tasarım E9) — boş editörde şablon seçilince her başlık `<h2>` ve ardından yazılacak boş bir `<p>` olur. Başlık ADLARI (`SABLONLAR`) ve `templates` tohumu AYNI; `sablon.test.ts` şemayı okuyarak doğrular. Sunucu önizlemesi (`danisan_seanslari::onizleme`) bu başlık satırlarını atlar." Gövde:

```ts
export function sablonMetni(sablon: string): string {
  if (!sablonKodMu(sablon)) return ''
  return SABLONLAR[sablon].map((baslik) => `<h2>${baslik}</h2><p></p>`).join('')
}
```

`web/src/seans/sablon.test.ts` ilk test: ad "sablon metni basliklari HTML ikinci duzey baslik ve bos paragraf olarak, sirasiyla uretir"; yorumu buna göre; `expect(sablonMetni('dap')).toBe('<h2>Veri</h2><p></p><h2>Değerlendirme</h2><p></p><h2>Plan</h2><p></p>')`.

- [ ] **Adım 4: `NotEditoru`'yu yüzeye bağla** (`web/src/seans/NotEditoru.tsx`)

- İçe aktarmalar (L1–6) şunlar olur:

```ts
import { useEffect, useRef, useState } from 'react'
import { YetkisizHata } from '../api'
import { BicimliYuzey } from '../not/BicimliYuzey'
import { htmlBosMu } from '../not/htmlBos'
import { SABLON_ADLARI, SABLON_KODLARI, sablonMetni } from './sablon'
```

- Modül başlığına, "# Not içeriği hiçbir loga girmez"in üstüne:

```
 * # İçerik HTML'dir (tasarım E7)
 *
 * Metin kutusu biçimli bir yüzeydir (`not/BicimliYuzey.tsx`, TipTap); bu
 * bileşenin otomatik kayıt, taslak, 401 ve `sunucuHali` sözleşmesi aynen
 * korunur, yalnızca "içerik" bir HTML dizgisidir. Yüzey açılışta yaptığı
 * normalleştirmeyi değişiklik olarak BİLDİRMEZ (E8), bu yüzden aşağıdaki
 * imza karşılaştırması ham sunucu değeri üzerinden doğru kalır.
```

  ve son paragrafı "Bu dosyada içeriği yazdıran tek yer not yüzeyidir (`BicimliYuzey`)." yap.
- `degisenAralikHesapla` ve `yerelDuzenlemeDene` fonksiyonlarını (başlık yorumlarıyla, L140–220) SİL.
- Bileşen içinde: `gorunum` state'i, `alanRef`, `bekleyenSecimRef`, `sonSecimRef` (L249–261) SİL; `anahtar !== taslakAnahtari` bloğundaki son üç satırı (`setGorunum('yaz')`, `bekleyenSecimRef.current = null`, `sonSecimRef.current = null`) ve onların yorumunu SİL.
- Kayıt efektinde imza eşitliği dalı:

```ts
    if (imza(kayit) === sonKaydedilen.current) {
      // (var olan yorum aynen)
      if (ucustaki.current === null) taslakDus(taslakAnahtari)
      // Ekran sunucudaki hâle döndü (yaz-sil, Ctrl+Z): "Kaydedilmemiş
      // değişiklikler var…" artık yalan. Uçuştaki kaydın durumu
      // ("Yazılıyor…") ezilmez.
      setDurum((d) => (d.tur === 'bekliyor' ? { tur: 'temiz' } : d))
      return
    }
```

- `icerikDegistir`'in yorumunu "Metnin TEK giriş noktası: not yüzeyinin `onChange`'i. Otomatik kayıt, taslak saklama ve 401'de geri yükleme `icerik` state'i değiştiği için kendiliğinden çalışır; ayrı bir kayıt yolu YOK." yap.
- `bicimUygulaVeYaz`, `kisayolTusu`, `useLayoutEffect(…, [icerik, gorunum])`, `onizlemeyeGec`, `yazmayaGec` SİL (yorumlarıyla; E5: kısayolları TipTap'ın tuş haritası uygular, Türkçe Q `ı` → `keyCode` düşüşü ProseMirror'da, e2e Görev 10'da).
- `sablonDegis`: `if (icerik.trim() === '') setIcerik(sablonMetni(yeni))` → `if (htmlBosMu(icerik)) setIcerik(sablonMetni(yeni))`.
- `const alanId = …` satırını SİL (`sablonId` kalır).
- JSX'te Yaz/Önizle `role="group"` bloğunu ve yorumunu (L582–613) ve `gorunum === 'yaz' ? … : …` bloğunu (L615–635) şununla değiştir:

```tsx
      {/* Görünen başlık; erişilebilir ad yüzeyin kendi `aria-label`'ında
          (`etiket`). `<label>` DEĞİL: bağlı bir form alanı yok. */}
      <span className="mb-1 text-sm text-slate-700">{etiket}</span>
      <BicimliYuzey html={icerik} onChange={icerikDegistir} etiket={etiket} />
```

- [ ] **Adım 5: Okuma yerlerini `NotOkuma`'ya geçir ve Markdown yığınını sil**

`web/src/seans/GecmisNotlar.tsx`: `import { NotGorunumu } from '../not/NotGorunumu'` → `import { NotOkuma } from '../not/NotOkuma'`; `<NotGorunumu kaynak={not.icerik} />` → `<NotOkuma html={not.icerik} />`; üstündeki yorum "`NotOkuma` blok elemanları üretir (salt okunur TipTap, tasarım S7)".

`web/src/seans/GecmisNotlar.test.tsx`: fikstür `icerik: '<h2>Veri</h2><p>Danışan geldi.</p>'`; ilk test adı "genisletilince not NotOkuma ile bicimli gosterilir (duz metin degil)", `expect(screen.getByText('Veri').tagName).toBe('H2')`; ikinci test adı "etiketsiz eski not da paragraf olarak acilir, kaybolmaz" (içerik aynen `'Veri:\nDanışan geldi.'`, `getByText(/Veri:/).tagName` `'P'`).

`web/src/etiket/EtiketSatiri.tsx` L78–79: "(bkz. `not/markdown.test.tsx`'teki yapısal tarama)" → "(bkz. `htmlBasmaYok.test.ts`'teki yapısal tarama)".

Sil: `Remove-Item web/src/not/bicim.ts, web/src/not/bicim.test.ts, web/src/not/BicimCubugu.tsx, web/src/not/markdown.tsx, web/src/not/markdown.test.tsx, web/src/not/desenler.ts, web/src/not/NotGorunumu.tsx` (`git rm` DEĞİL: silme commit adımındaki `git add` ile sahnelenir). Doğrula: `rg -n "not/(bicim|BicimCubugu|markdown|desenler|NotGorunumu)" web/src` → yalnızca yorum yoksa boş; varsa yorumu güncelle.

- [ ] **Adım 6: Var olan testleri yeni sözleşmeye uydur**

- `NotEditoru.test.tsx`: `describe('NotEditoru — bicim cubugu, kisayollar ve onizleme (Görev 2)', …)` (L778–956) ve `describe('NotEditoru — execCommand ile yerli geri alma yığınının korunması (IMPORTANT-3)', …)` (L957–995) SİL. Bunların içindeki "DAP şablonu seçilince boş editöre "## Veri" eklenir" testi 5.3 ile kapsandı; "biçim uygulandıktan sonra 401 gelirse taslak KAYBOLMAZ" testinin sözleşmesi `NotEditoru — 401 sirasinda yazilmamis icerik` bloğunda ölçülüyor (biçim yolu artık yok). Raporda iki bloğu adıyla yaz.
- `SeansPaneli.test.tsx` L479–484: yorum "başlıklar HTML ikinci düzey başlık (`sablon.ts::sablonMetni`)", iddialar `toContain('<h2>Veri</h2>')`, `toContain('<h2>Değerlendirme</h2>')`, `toContain('<h2>Plan</h2>')`.
- `DanisanDosyasi.test.tsx` L286–288: aynı üç iddia.

- [ ] **Adım 7: Yeşili gör** — web/: `npx vitest run` → PASS (sayıyı yaz; silinen Markdown testleri düşer). `npm --prefix web run build` → hata yok. `npm --prefix web run lint` → uyarı sayısı artmadı.

- [ ] **Adım 8: E2E'yi gerçek editöre uydur**

Gerçek yüzey `contenteditable` bir `div` (`role="textbox"`, `aria-label` = etiket): `getByLabel('Seans notu', { exact: true })` onu bulur, `fill()` çalışır, `toHaveValue` ÇALIŞMAZ → `toHaveText`.

- `e2e/notlar.spec.ts`: L146 `toHaveValue(icerik)` → `toHaveText(icerik)`; L347 `toHaveValue(resmi)` → `toHaveText(resmi)`; L350 `toHaveValue(gizli)` → `toHaveText(gizli)`.
- `e2e/kabuk.spec.ts` L174: `.toHaveValue('Geçen haftanın notu')` → `.toHaveText('Geçen haftanın notu')`.
- `e2e/takvim.spec.ts` taşıma testi: iki `toHaveValue(not)` → `toHaveText(not)`.
- `e2e/notlar-gelismis.spec.ts`: L211 ve L242 `toHaveValue(new RegExp(…))` → `toHaveText(new RegExp(…))`. `kelimeSec` yardımcısını SİL ve yerine:

```ts
/**
 * Editördeki SON sözcüğü klavyeyle seçer: satır sonuna git, Ctrl+Shift+←.
 * Klavye ProseMirror'un seçimini eşzamanlı günceller (DOM seçimi API'si
 * `selectionchange`'i beklerdi ve bekleme sabit süre isterdi).
 */
async function sonSozcuguSec(page: Page, alan: Locator) {
  await alan.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Control+Shift+ArrowLeft')
}

/** Araç çubuğundaki bir düğme (Türkçe ad). */
function aracDugmesi(page: Page, ad: string): Locator {
  return seansPaneli(page).getByRole('toolbar', { name: 'Biçim araçları' }).getByRole('button', { name: ad, exact: true })
}
```

Test 1'i şununla değiştir:

```ts
test('bicim cubugu: secili kelime kalinlasir, isaret gorunmez, sayfa yenilenince kalici', async ({ page }) => {
  await kurulumYap(page)
  const ad = 'Gamze Aydemir'
  const kelime = 'KALINSOZ25'
  const cumle = `Danisan bu hafta ilerleme kaydetti ${kelime}`

  const blok = await danisanVeRandevu(page, ad, '08:00')
  const alan = await seansiAc(page, blok)
  await alan.fill(cumle)
  await sonSozcuguSec(page, alan)
  await aracDugmesi(page, 'Kalın').click()

  // ARTI YÖN: gerçek <strong> — ve EKSİ YÖN: metinde işaret yok (Markdown
  // yığını gitti; ekranda `**` görünmez, tasarım §1).
  await expect(alan.locator('strong')).toHaveText(kelime)
  await expect(alan).toHaveText(cumle)
  await kaydedildiBekle(page)

  await page.reload()
  await kurulumYap(page)
  const yenidenAlan = await seansiAc(page, blok)
  await expect(yenidenAlan.locator('strong')).toHaveText(kelime)
  await expect(yenidenAlan).toHaveText(cumle)
})
```

Ctrl+Z testini (test 4) şununla değiştir (dosya başlığındaki "Ctrl+Z testi neden burada" bölümünü "TipTap'ın geri alma yığını (prosemirror-history) gerçek tarayıcıda: tek Ctrl+Z yalnızca son biçimi geri alır" diye güncelle):

```ts
test('Ctrl+Z gercek tarayicida: yalnizca bicimi geri alir, cumle kaybolmaz, sunucudaki hal bicimsiz', async ({ page }) => {
  await kurulumYap(page)
  const ad = 'Onur Aslan'
  const kelime = 'GERIALKANARYA28'
  const cumle = `Danisan devam plani ile ilgili konustu ${kelime}`

  const blok = await danisanVeRandevu(page, ad, '11:00')
  const alan = await seansiAc(page, blok)
  await alan.fill(cumle)
  // BARİYER + geri alma grubu ayrımı: kayıt ~2 sn sürer, ProseMirror'un
  // 500 ms'lik birleştirme penceresi kapanır; Ctrl+B ayrı bir adım olur.
  await kaydedildiBekle(page)

  await sonSozcuguSec(page, alan)
  await page.keyboard.press('Control+b')
  await expect(alan.locator('strong')).toHaveText(kelime)

  // ASIL İDDİA: TEK Ctrl+Z yalnızca biçimi geri alır; cümle TAM kalır.
  await page.keyboard.press('Control+z')
  await expect(alan.locator('strong')).toHaveCount(0)
  await expect(alan).toHaveText(cumle)
  // Bekleyen kayıt yok: ya hiç yazılmadı (sunucudaki hâle dönüldü) ya da
  // biçimsiz hâl yazıldı. İkisinde de sunucudaki metin biçimsiz.
  await expect(page.getByRole('status').filter({ hasText: /Kaydedilmemiş|Yazılıyor/ })).toHaveCount(0)

  await page.reload()
  await kurulumYap(page)
  const yenidenAlan = await seansiAc(page, blok)
  await expect(yenidenAlan).toHaveText(cumle)
  await expect(yenidenAlan.locator('strong')).toHaveCount(0)
})
```

Çalıştır (kök, PATH önekiyle): `npx playwright test --reporter=line` → PASS.

- [ ] **Adım 9: Tam doğrulama** — `npm --prefix web run build`, `npm --prefix web run lint`, web/ `npx vitest run`, `cargo test --workspace`, `npx playwright test --reporter=line`.

- [ ] **Adım 10: Commit**

```bash
git add web/src/not/htmlBos.ts web/src/not/htmlBos.test.ts web/src/seans/NotEditoru.tsx web/src/seans/NotEditoru.test.tsx web/src/seans/NotEditoru.gercekYuzey.test.tsx web/src/htmlBasmaYok.test.ts web/src/seans/sablon.ts web/src/seans/sablon.test.ts web/src/seans/GecmisNotlar.tsx web/src/seans/GecmisNotlar.test.tsx web/src/seans/SeansPaneli.test.tsx web/src/danisan/DanisanDosyasi.test.tsx web/src/etiket/EtiketSatiri.tsx web/src/not/bicim.ts web/src/not/bicim.test.ts web/src/not/BicimCubugu.tsx web/src/not/markdown.tsx web/src/not/markdown.test.tsx web/src/not/desenler.ts web/src/not/NotGorunumu.tsx e2e/notlar.spec.ts e2e/kabuk.spec.ts e2e/takvim.spec.ts e2e/notlar-gelismis.spec.ts
git commit -m "Editor: NotEditoru bicimli yuzeye gecti, Yaz/Onizle ve Markdown yigini kalkti

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Mutasyonlar:**
- `BicimliYuzey`'de ham-dizgi eşlemesini kaldır (`yeni === normal ? ham : yeni` → `yeni`) → 5.2 (geri almadan sonra kayıt gitti) kırılır. (Görev 4'ün 4.4'ü de.)
- `NotEditoru`'da `setDurum((d) => …'temiz'…)` satırını sil → 5.5 ve 5.2'nin durum iddiası kırılır.
- `sablonDegis`'te `htmlBosMu(icerik)` → `icerik.trim() === ''` → 5.3 kırılır.
- `htmlBosMu`'da `&nbsp;` değişimini sil → `htmlBos.test.ts` "`<p>&nbsp;</p>`" kırılır.
- `GecmisNotlar`'da `<NotOkuma html=…>` → `<p>{not.icerik}</p>` → `GecmisNotlar.test` (H2) kırılır.

---

### Task 6: Tauri — okuma pencereleri, gezinme koruması, dış bağlantılar (spec §8 P2, P3, P5, P6b; §9)

**Files:**
- Create: `src-tauri/src/pencere.rs`
- Modify: `src-tauri/src/main.rs` (tamamı: içe aktarmalar, kurucu, `main`, test `pencere_boyutu_ve_tema_sabit`)
- Modify: `src-tauri/Cargo.toml` (`tauri-plugin-opener = "2"`), `Cargo.lock`

**Interfaces:**
- Produces (`pencere.rs`):
  - `#[derive(Debug, Clone, PartialEq, Eq)] pub enum PencereKarari { OkumaPenceresi { randevu_id: i64 }, DisaAc, Reddet }`
  - `pub fn pencere_karari(adres: &Url, koken: &Url) -> PencereKarari` — aynı köken + tam olarak `/?okuma=<pozitif tam sayı>` → okuma penceresi; aynı kökenin başka her adresi → Reddet; `http(s)` (yerel/loopback DEĞİLSE) ve `mailto` → DisaAc; başka her şey → Reddet.
  - `pub fn gezinme_izni(adres: &Url, koken: &Url) -> bool` — yalnızca aynı köken.
  - `pub fn disa_acilir_mi(adres: &Url) -> bool`
- Produces (`main.rs`): `fn korumali_pencere<'a>(app: &'a AppHandle, etiket: &str, adres: Url, koken: Url) -> WebviewWindowBuilder<'a, Wry, AppHandle>` (her pencere bundan kurulur), `fn okuma_penceresi_ac(app: &AppHandle, randevu_id: i64, koken: &Url)` (etiket `okuma-<id>`; varsa `set_focus`), `fn disarida_ac(app: &AppHandle, adres: &Url)`.
- Consumes: web tarafı `window.open('/?okuma=<id>', 'okuma-<id>')` (Görev 8) ve `target="_blank"` bağlantılar (Görev 4).

- [ ] **Adım 1: Başarısız testleri yaz** (`src-tauri/src/pencere.rs`; gövdeler `todo!()` DEĞİL, derlensin diye `PencereKarari::Reddet` / `false` döner)

```rust
//! Pencere ve gezinme kararları (tasarım 2026-09-26 §8 P2, P3, P6b; §9).

use tauri::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PencereKarari {
    OkumaPenceresi { randevu_id: i64 },
    DisaAc,
    Reddet,
}

pub fn pencere_karari(_adres: &Url, _koken: &Url) -> PencereKarari {
    PencereKarari::Reddet
}

pub fn gezinme_izni(_adres: &Url, _koken: &Url) -> bool {
    false
}

pub fn disa_acilir_mi(_adres: &Url) -> bool {
    false
}

#[cfg(test)]
mod testler {
    use super::*;

    fn u(s: &str) -> Url {
        s.parse().unwrap()
    }
    fn koken() -> Url {
        u("http://127.0.0.1:51234/")
    }

    #[test]
    fn okuma_adresi_okuma_penceresi_acar() {
        assert_eq!(
            pencere_karari(&u("http://127.0.0.1:51234/?okuma=42"), &koken()),
            PencereKarari::OkumaPenceresi { randevu_id: 42 }
        );
    }

    #[test]
    fn bozuk_ya_da_baska_okuma_adresi_reddedilir() {
        for a in [
            "http://127.0.0.1:51234/?okuma=abc",
            "http://127.0.0.1:51234/?okuma=0",
            "http://127.0.0.1:51234/?okuma=-3",
            "http://127.0.0.1:51234/?okuma=",
            "http://127.0.0.1:51234/?okuma=007",
            "http://127.0.0.1:51234/?okuma=99999999999999999999",
            "http://127.0.0.1:51234/baska?okuma=4",
            "http://127.0.0.1:51234/?okuma=4&x=1",
            "http://127.0.0.1:51234/?x=1&okuma=4",
            "http://127.0.0.1:51234/?okuma=4#k",
            "http://127.0.0.1:51234/api/danisanlar",
            "http://127.0.0.1:9999/?okuma=4",
        ] {
            assert_eq!(pencere_karari(&u(a), &koken()), PencereKarari::Reddet, "{a}");
        }
    }

    #[test]
    fn dis_baglantilar_sistem_uygulamasinda_acilir() {
        for a in ["https://ornek.com/yol?q=1", "http://ornek.com", "mailto:ayse@ornek.com"] {
            assert_eq!(pencere_karari(&u(a), &koken()), PencereKarari::DisaAc, "{a}");
            assert!(disa_acilir_mi(&u(a)), "{a}");
        }
    }

    #[test]
    fn tehlikeli_semalar_reddedilir() {
        for a in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,x",
            "ftp://ornek.com",
            "about:blank",
            "tel:5551234",
        ] {
            assert_eq!(pencere_karari(&u(a), &koken()), PencereKarari::Reddet, "{a}");
            assert!(!gezinme_izni(&u(a), &koken()), "{a}");
        }
    }

    /// Oturum sunucuda süreç geneli tutuluyor: Safari'ye verilen yerel adres
    /// (başka yazımla da olsa: `localhost`, `[::1]`) kilit ekranını atlayıp
    /// veriye ulaşırdı. Yerel adres ASLA dışarıda açılmaz.
    #[test]
    fn yerel_adresler_sistem_tarayicisina_verilmez() {
        for a in [
            "http://localhost:51234/api/danisanlar",
            "http://LOCALHOST:51234/",
            "http://uygulama.localhost/",
            "http://127.0.0.2/",
            "http://[::1]:51234/",
            "http://0.0.0.0:51234/",
        ] {
            assert_eq!(pencere_karari(&u(a), &koken()), PencereKarari::Reddet, "{a}");
            assert!(!gezinme_izni(&u(a), &koken()), "{a}");
        }
    }

    #[test]
    fn gezinme_yalnizca_ayni_kokene_izinli() {
        for a in ["http://127.0.0.1:51234/", "http://127.0.0.1:51234/?okuma=3", "http://127.0.0.1:51234/api/durum"] {
            assert!(gezinme_izni(&u(a), &koken()), "{a}");
        }
        for a in ["http://127.0.0.1:51235/", "https://127.0.0.1:51234/", "https://ornek.com/"] {
            assert!(!gezinme_izni(&u(a), &koken()), "{a}");
        }
    }
}
```

`src-tauri/src/main.rs`'in en üstüne (`#![cfg_attr…]`'dan sonra) `mod pencere;`.

- [ ] **Adım 2: Kırmızıyı gör** — PowerShell (PATH önekiyle): `cargo test -p psikolog-tauri pencere` → `okuma_adresi…`, `dis_baglantilar…`, `gezinme_yalnizca…` FAIL.

- [ ] **Adım 3: Kararları yaz** (`pencere.rs`, test modülünün üstü)

```rust
//! Pencere ve gezinme kararları (tasarım 2026-09-26 §8 P2, P3, P6b; §9).
//!
//! Saf fonksiyonlar; Tauri'nin `on_navigation` / `on_new_window` geri
//! çağrıları (`main.rs::korumali_pencere`) yalnızca bu kararları UYGULAR.
//!
//! - Uygulama penceresi (ana ve okuma) YALNIZCA kendi yerel kökenine gider.
//! - `window.open` isteği: kendi kökeninde tam olarak `/?okuma=<id>` ise
//!   okuma penceresi; `http(s)`/`mailto` ise sistemin varsayılan
//!   uygulamasında açılır ve istek reddedilir; başka her şey reddedilir.
//! - Yerel/loopback adresler (`localhost`, `127.0.0.0/8`, `::1`, `0.0.0.0`)
//!   ASLA dışarıda açılmaz: oturum sunucuda süreç genelidir, sistem
//!   tarayıcısına verilen yerel adres uygulamanın kilidini atlardı.

use tauri::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PencereKarari {
    OkumaPenceresi { randevu_id: i64 },
    DisaAc,
    Reddet,
}

fn ayni_koken(adres: &Url, koken: &Url) -> bool {
    adres.origin() == koken.origin()
}

pub fn gezinme_izni(adres: &Url, koken: &Url) -> bool {
    ayni_koken(adres, koken)
}

pub fn pencere_karari(adres: &Url, koken: &Url) -> PencereKarari {
    if ayni_koken(adres, koken) {
        return match okuma_kimligi(adres) {
            Some(randevu_id) => PencereKarari::OkumaPenceresi { randevu_id },
            None => PencereKarari::Reddet,
        };
    }
    if disa_acilir_mi(adres) {
        PencereKarari::DisaAc
    } else {
        PencereKarari::Reddet
    }
}

pub fn disa_acilir_mi(adres: &Url) -> bool {
    match adres.scheme() {
        "mailto" => true,
        "http" | "https" => !yerel_adres_mi(adres),
        _ => false,
    }
}

fn yerel_adres_mi(adres: &Url) -> bool {
    let Some(sunucu) = adres.host_str() else { return true };
    let sunucu = sunucu.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    if sunucu == "localhost" || sunucu.ends_with(".localhost") {
        return true;
    }
    match sunucu.parse::<std::net::IpAddr>() {
        Ok(ip) => ip.is_loopback() || ip.is_unspecified(),
        Err(_) => false,
    }
}

/// Tam olarak `/?okuma=<pozitif tam sayı, başında sıfır yok>`; başka sorgu
/// parametresi ya da parça (`#`) yok.
fn okuma_kimligi(adres: &Url) -> Option<i64> {
    if adres.path() != "/" || adres.fragment().is_some() {
        return None;
    }
    let mut ciftler = adres.query_pairs();
    let (anahtar, deger) = ciftler.next()?;
    if anahtar != "okuma" || ciftler.next().is_some() {
        return None;
    }
    if deger.is_empty() || deger.starts_with('0') || !deger.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    deger.parse::<i64>().ok()
}
```

- [ ] **Adım 4: Yeşili gör** — `cargo test -p psikolog-tauri pencere` → PASS.

- [ ] **Adım 5: Yapısal testi genişlet** (`main.rs` `pencere_boyutu_ve_tema_sabit`, var olan üç `assert!`'in altına)

```rust
        assert!(kurucu.contains(".inner_size(720.0, 800.0)"), "okuma penceresi boyutu (P2)");
        assert!(kurucu.contains(".on_navigation(") && kurucu.contains(".on_new_window("), "gezinme korumasi (P6b)");
        assert!(kurucu.contains("NewWindowResponse::Deny"), "yeni pencere istegi webview'e birakilmaz");
        assert!(kurucu.contains(".plugin(tauri_plugin_opener::init())"), "opener eklentisi (P6b)");
        assert!(kurucu.contains("WindowEvent::Destroyed") && kurucu.contains("exit(0)"), "ana pencere kapaninca cikis (P5)");
        assert!(kurucu.contains("korumali_pencere(app.handle(), ANA_PENCERE"), "ana pencere de korumali kurucudan");
```

Kırmızıyı gör: `cargo test -p psikolog-tauri pencere_boyutu` → FAIL.

- [ ] **Adım 6: Kabuğu bağla**

`src-tauri/Cargo.toml` `[dependencies]`'e `tauri-plugin-opener = "2"`.

`src-tauri/src/main.rs` (veri dizini ve `sunucuyu_baslat` aynen; içe aktarmalar ve `main` şöyle):

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod pencere;

use pencere::{gezinme_izni, pencere_karari, PencereKarari};
use psikolog_core::crypto::keyring::KdfParams;
use psikolog_server::{router, AppState, YEREL_ADRES};
use std::path::PathBuf;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, Wry};
use tauri_plugin_opener::OpenerExt;

/// Ana pencerenin etiketi; kapanınca uygulama çıkar (tasarım P5).
const ANA_PENCERE: &str = "ana";

// (veri_dizini ve sunucuyu_baslat değişmeden)

/// Her pencerenin ORTAK kurucusu (tasarım P6b, §9). Gezinme yalnızca kendi
/// kökenine; başka bir `http(s)`/`mailto` adresine gezinme de yeni pencere
/// isteği de sistemin varsayılan uygulamasına devredilir ve REDDEDİLİR.
/// `window.open` isteği hiçbir zaman webview'in kendi penceresine
/// bırakılmaz (`Deny`): okuma penceresini bu kurucu kendisi açar.
fn korumali_pencere<'a>(
    app: &'a AppHandle,
    etiket: &str,
    adres: Url,
    koken: Url,
) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    let gezinme_app = app.clone();
    let gezinme_koken = koken.clone();
    let yeni_app = app.clone();
    WebviewWindowBuilder::new(app, etiket, WebviewUrl::External(adres))
        .theme(Some(tauri::Theme::Light))
        .on_navigation(move |hedef| {
            if gezinme_izni(hedef, &gezinme_koken) {
                return true;
            }
            if pencere_karari(hedef, &gezinme_koken) == PencereKarari::DisaAc {
                disarida_ac(&gezinme_app, hedef);
            }
            false
        })
        .on_new_window(move |hedef, _ozellikler| {
            match pencere_karari(&hedef, &koken) {
                PencereKarari::OkumaPenceresi { randevu_id } => {
                    okuma_penceresi_ac(&yeni_app, randevu_id, &koken)
                }
                PencereKarari::DisaAc => disarida_ac(&yeni_app, &hedef),
                PencereKarari::Reddet => {}
            }
            NewWindowResponse::Deny
        })
}

/// Salt okunur okuma penceresi (tasarım P1-P3): etiket `okuma-<id>`, aynı
/// seans ikinci kez istenirse var olan öne gelir. Başlık danışan adı
/// TAŞIMAZ (pencere listelerinde görünür); ad sayfanın içinde.
fn okuma_penceresi_ac(app: &AppHandle, randevu_id: i64, koken: &Url) {
    let etiket = format!("okuma-{randevu_id}");
    if let Some(var_olan) = app.get_webview_window(&etiket) {
        let _ = var_olan.set_focus();
        return;
    }
    let mut adres = koken.clone();
    adres.set_path("/");
    adres.set_query(Some(&format!("okuma={randevu_id}")));
    let app = app.clone();
    let koken = koken.clone();
    // Pencere webview'in kendi geri çağrısının İÇİNDE kurulmaz (Windows'ta
    // olay döngüsü kilitlenebilir); ayrı bir görevde.
    tauri::async_runtime::spawn(async move {
        let sonuc = korumali_pencere(&app, &etiket, adres, koken)
            .title("Seans notu (salt okunur)")
            .inner_size(720.0, 800.0)
            .build();
        if sonuc.is_err() {
            eprintln!("okuma penceresi acilamadi");
        }
    });
}

/// Sistemin varsayılan tarayıcısı/posta uygulaması. Hata satırı ADRES
/// BASMAZ: bağlantı hassas bilgi taşıyabilir.
fn disarida_ac(app: &AppHandle, adres: &Url) {
    if app.opener().open_url(adres.as_str(), None::<&str>).is_err() {
        eprintln!("baglanti sistem uygulamasinda acilamadi");
    }
}

fn main() {
    let port = sunucuyu_baslat(veri_dizini());
    let koken: Url = format!("http://{YEREL_ADRES}:{port}/").parse().expect("yerel adres gecersiz");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            korumali_pencere(app.handle(), ANA_PENCERE, koken.clone(), koken.clone())
                .title("Terapi Notlari")
                .inner_size(1200.0, 760.0)
                .min_inner_size(1024.0, 680.0)
                .theme(Some(tauri::Theme::Light))
                .build()?;
            Ok(())
        })
        // Tasarım P5: ana pencere kapanınca uygulama çıkar, okuma pencereleri
        // de kapanır (yoksa son okuma penceresi kapanana kadar süreç yaşardı).
        .on_window_event(|pencere, olay| {
            if pencere.label() == ANA_PENCERE && matches!(olay, tauri::WindowEvent::Destroyed) {
                pencere.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("uygulama baslatilamadi");
}
```

(Opener eklentisi yalnızca Rust tarafından çağrılır; `capabilities/` dizini açılmaz, JS'e opener izni VERİLMEZ.)

- [ ] **Adım 7: Yeşili gör** — `cargo build -p psikolog-tauri` (ilk derleme yeni crate'leri indirir), `npm --prefix web run build`, `cargo test --workspace` → PASS. `cargo clippy -p psikolog-tauri --all-targets -- -D warnings` → temiz.

- [ ] **Adım 8: Commit**

```bash
git add src-tauri/src/pencere.rs src-tauri/src/main.rs src-tauri/Cargo.toml Cargo.lock
git commit -m "Tauri: okuma pencereleri, gezinme korumasi, dis baglantilar sistemde

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Mutasyonlar:**
- `yerel_adres_mi`'den `ends_with(".localhost")` ve `is_loopback()` kontrollerini sil → `yerel_adresler_sistem_tarayicisina_verilmez` kırılır.
- `okuma_kimligi`'nde `ciftler.next().is_some()` kontrolünü sil → "`?okuma=4&x=1`" satırı kırılır.
- `ayni_koken` → `adres.host_str() == koken.host_str()` (port/şema yok) → `gezinme_yalnizca…` ("51235", "https") kırılır.
- `.on_new_window(...)` bloğunu sil → yapısal test kırılır.

**Elle (Mac, kullanıcıya bırakılır — raporda):** okuma penceresi 720×800 açık temayla açılır; aynı satır ikinci kez istenince öne gelir; nottaki `https://` bağlantı Safari'de açılır, uygulama penceresi yerinde kalır; ana pencere kapanınca okuma pencereleri de kapanır.

---

### Task 7: Seans notu sayfası (spec §7 N1–N4, N8 `randevuyaGit`)

**Files:**
- Create: `web/src/seans/SeansSayfasi.tsx`, `web/src/seans/SeansSayfasi.test.tsx`
- Create: `web/src/seans/SeansAltSatiri.test.tsx` (SeansPaneli testlerinden taşınan alt satır testleri)
- Create: `web/src/screens/anaEkranKancalari/useTakvimAkisi.test.ts`
- Modify: `web/src/seans/SeansPaneli.tsx` (başlık L207–249, geçmiş sütunu L254–257, alt satır L411–418, props L76–130, içe aktarmalar, modül başlığı)
- Modify: `web/src/seans/SeansPaneli.test.tsx`, `web/src/seans/GecmisNotlar.test.tsx`
- Modify: `web/src/seans/SeansAltSatiri.tsx` (`gomulu` prop'u)
- Modify: `web/src/screens/anaEkranKancalari/useTakvimAkisi.ts` (`randevuyaGit`, `gecisBekliyor`, `yukle` başarı dalı, `oturumKapandi`)
- Modify: `web/src/takvim/TakvimSekmesi.tsx` (içe aktarmalar; L334–478 ızgara/seans bölümü; modül başlığı)
- Modify: `web/src/takvim/TakvimSekmesi.test.tsx` (`bosTakvim`, L297–395)
- Modify: `web/src/screens/AnaEkran.test.tsx`, `web/src/screens/AnaEkran.yayilim.test.tsx`
- Modify (e2e): `e2e/takvim.spec.ts`, `e2e/notlar.spec.ts`, `e2e/kabuk.spec.ts`, `e2e/odeme.spec.ts`, `e2e/yerlesim.spec.ts`

**Interfaces:**
- Produces (`useTakvimAkisi`): `randevuyaGit(id: number, baslangic: string): void` ve `gecisBekliyor: boolean` (dönüşe eklenir). Hedef görünen haftada ve listedeyse hemen `randevuSec(hedef, { kaydir: true })`; değilse seçim KAPATILIR (açık editörler unmount tahliyesiyle bekleyen metni yazar), hedef hafta açılır ve seçim o haftanın yüklemesi dönünce yapılır; hedef listede yoksa geçiş sessizce biter. `panelKapat` haftayı DEĞİŞTİRMEZ ("Takvime dön" aynı haftayı gösterir).
- Produces: `export function SeansSayfasi(props: { randevu: Randevu; seansAkisi: ReturnType<typeof useSeansNotlari>; danisanlar: Danisan[]; onTakvimeDon: () => void; onDanisanAc: (clientId: number) => void; onDurumDegis: (durum: string) => Promise<void>; onOdemeDegis: (odendi: boolean) => Promise<void>; onRandevuKaydet: (kayit: Parameters<ReturnType<typeof useTakvimAkisi>['kaydet']>[0]) => Promise<void>; onRandevuSil: (id: number) => Promise<void>; onSeriSil: (seriId: string, buTarihtenItibaren: string) => Promise<void>; etiket: EtiketBaglami; ref?: React.Ref<HTMLElement> })` — `<section id="seans-bolumu" data-testid="seans-bolumu" aria-labelledby="seans-sayfasi-basligi">` (erişilebilir ad "Seans").
- Changes: `SeansPaneli` props → `{ randevu, not, ozelNot, ozelHata?, onNotKaydet, onOzelNotKaydet, onOzelSekme, onOzelYenidenDene?, etiket? }` (başlık, geçmiş ve alt satır sayfaya taşındı; kök `<div>`, bölge değil).
- Changes: `SeansAltSatiri` += `gomulu?: boolean` (üst satırda kenarlıksız/boşluksuz).
- Test ikizleri: `bosTakvim()` (TakvimSekmesi.test) += `randevuyaGit: vi.fn(), gecisBekliyor: false`.

- [ ] **Adım 1: Kanca testlerini yaz** (`web/src/screens/anaEkranKancalari/useTakvimAkisi.test.ts`)

```ts
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Randevu } from '../../takvim/HaftalikTakvim'
import { useTakvimAkisi } from './useTakvimAkisi'

const t = vi.hoisted(() => ({
  haftalar: {} as Record<string, unknown[]>,
  kapilar: {} as Record<string, Promise<void>>,
  cagrilar: [] as string[],
}))

// Hafta listesi haftanın ilk gününe göre (`YYYY-AA-GG`) verilir; bir hafta
// için "kapı" kurulursa o yanıt kapı açılana kadar bekletilir.
vi.mock('../../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../../api')>()
  return {
    ...gercek,
    takvimApi: {
      ...gercek.takvimApi,
      randevulariGetir: async (baslangic: string) => {
        const gun = baslangic.slice(0, 10)
        t.cagrilar.push(gun)
        const kapi = t.kapilar[gun]
        if (kapi) await kapi
        return t.haftalar[gun] ?? []
      },
    },
  }
})

const A: Randevu = {
  id: 1, client_id: 1, danisan_adi: 'Ayşe Yılmaz', baslangic: '2026-09-08T10:00', bitis: '2026-09-08T11:00',
  durum: 'planlandi', ucret: null, odendi: false, seri_id: null,
}
const B: Randevu = { ...A, id: 2, baslangic: '2026-08-25T10:00', bitis: '2026-08-25T11:00' }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 9, 12, 0)) // hafta başı 7 Eylül
  t.haftalar = {}
  t.kapilar = {}
  t.cagrilar = []
})
afterEach(() => vi.useRealTimers())

function kur() {
  return renderHook(() => useTakvimAkisi({ onYetkisiz: vi.fn() }))
}

describe('useTakvimAkisi.randevuyaGit (tasarım N8, inceleme odağı 4)', () => {
  it('7.1 başka haftadaki seans: seçim kapanır, hafta değişir, seçim hafta YÜKLENİNCE yapılır', async () => {
    t.haftalar = { '2026-09-07': [A], '2026-08-24': [B] }
    const { result } = kur()
    await waitFor(() => expect(result.current.randevular).toHaveLength(1))
    act(() => result.current.randevuSec(A))
    act(() => result.current.randevuyaGit(B.id, B.baslangic))
    expect(result.current.seciliRandevu).toBeNull()
    expect(result.current.gecisBekliyor).toBe(true)
    await waitFor(() => expect(result.current.seciliRandevu?.id).toBe(B.id))
    expect(result.current.haftaBasi.getTime()).toBe(new Date(2026, 7, 24).getTime())
    expect(result.current.gecisBekliyor).toBe(false)
    expect(result.current.kaydirmaIstegi).toBe(B.id)
  })

  it('7.2 aynı haftadaki seans: yeni istek YOK, hemen seçilir', async () => {
    const A2: Randevu = { ...A, id: 3, baslangic: '2026-09-10T10:00', bitis: '2026-09-10T11:00' }
    t.haftalar = { '2026-09-07': [A, A2] }
    const { result } = kur()
    await waitFor(() => expect(result.current.randevular).toHaveLength(2))
    const istek = t.cagrilar.length
    act(() => result.current.randevuSec(A))
    act(() => result.current.randevuyaGit(A2.id, A2.baslangic))
    expect(result.current.seciliRandevu?.id).toBe(A2.id)
    expect(result.current.gecisBekliyor).toBe(false)
    expect(t.cagrilar.length).toBe(istek)
  })

  it('7.3 hedef o haftada yoksa (silinmiş) seçim açılmaz, geçiş biter', async () => {
    t.haftalar = { '2026-09-07': [A], '2026-08-24': [] }
    const { result } = kur()
    await waitFor(() => expect(result.current.randevular).toHaveLength(1))
    act(() => result.current.randevuyaGit(B.id, B.baslangic))
    await waitFor(() => expect(result.current.gecisBekliyor).toBe(false))
    expect(result.current.seciliRandevu).toBeNull()
  })

  it('7.4 hafta koruması: geç dönen ESKİ hafta yanıtı hedefi ve listeyi EZMEZ', async () => {
    let ac!: () => void
    t.kapilar = { '2026-09-07': new Promise<void>((r) => { ac = r }) }
    t.haftalar = { '2026-09-07': [A], '2026-08-24': [B] }
    const { result } = kur()
    act(() => result.current.randevuyaGit(B.id, B.baslangic))
    await waitFor(() => expect(result.current.seciliRandevu?.id).toBe(B.id))
    await act(async () => { ac() })
    expect(result.current.randevular.map((r) => r.id)).toEqual([B.id])
    expect(result.current.seciliRandevu?.id).toBe(B.id)
  })

  it('panelKapat haftayı değiştirmez ("Takvime dön" aynı haftayı gösterir)', async () => {
    t.haftalar = { '2026-09-07': [A], '2026-08-24': [B] }
    const { result } = kur()
    act(() => result.current.randevuyaGit(B.id, B.baslangic))
    await waitFor(() => expect(result.current.seciliRandevu?.id).toBe(B.id))
    act(() => result.current.panelKapat())
    expect(result.current.seciliRandevu).toBeNull()
    expect(result.current.haftaBasi.getTime()).toBe(new Date(2026, 7, 24).getTime())
  })
})
```

- [ ] **Adım 2: Kırmızıyı gör** — web/: `npx vitest run src/screens/anaEkranKancalari/useTakvimAkisi.test.ts` → `result.current.randevuyaGit is not a function`.

- [ ] **Adım 3: Kancayı genişlet** (`useTakvimAkisi.ts`)

`kaydirmaIstegi` state'inin altına:

```ts
  // "Bu seansa git" (tasarım N8): hedef başka haftadaysa seçim o haftanın
  // yüklemesi dönünce yapılır. Kimlik REF'te (yukle'nin bağımlılığı olmasın);
  // `gecisBekliyor` ızgaranın yerine "Seans açılıyor…" gösterilsin diye.
  const bekleyenSecimRef = useRef<number | null>(null)
  const [gecisBekliyor, setGecisBekliyor] = useState(false)
```

`oturumKapandi` gövdesine `bekleyenSecimRef.current = null` ve `setGecisBekliyor(false)`.

`yukle`'nin başarı dalında `setHata(null)`'dan hemen ÖNCE (seçim tazeleme güncelleyicisinden SONRA — son yazan kazanır):

```ts
      const bekleyen = bekleyenSecimRef.current
      if (bekleyen !== null) {
        bekleyenSecimRef.current = null
        setGecisBekliyor(false)
        const hedef = gelen.find((r) => r.id === bekleyen)
        if (hedef !== undefined) {
          seciliIdRef.current = hedef.id
          setSeciliBosSaat(null)
          setSeciliRandevu(hedef)
          setKaydirmaIstegi(hedef.id)
        }
      }
```

`catch` dalında hafta korumasının ÖNÜNE: `if (bekleyenSecimRef.current !== null) { bekleyenSecimRef.current = null; setGecisBekliyor(false) }`.

`randevuSec`'in altına:

```ts
  /**
   * "Bu seansa git" / önceki notlarda açık satıra ikinci tık (tasarım N8).
   * Önce açık seans KAPANIR: editörler unmount tahliyesiyle bekleyen
   * metni YAZAR (bugünkü seans değişimi kuralı) ve eski seansın notu yeni
   * seansın sayfasına bir kare bile sızmaz.
   */
  function randevuyaGit(id: number, baslangic: string) {
    const hedefHafta = haftaninBasi(zamandanDate(baslangic))
    const ayniHafta = hedefHafta.getTime() === haftaBasi.getTime()
    const listede = randevular.find((r) => r.id === id)
    if (ayniHafta && listede !== undefined) {
      randevuSec(listede, { kaydir: true })
      return
    }
    panelKapat()
    bekleyenSecimRef.current = id
    setGecisBekliyor(true)
    if (ayniHafta) void yukle()
    else setHaftaBasi(hedefHafta)
  }
```

Dönüşe `randevuyaGit,` ve `gecisBekliyor,`.

- [ ] **Adım 4: Yeşili gör** — `npx vitest run src/screens/anaEkranKancalari/useTakvimAkisi.test.ts` → PASS.

- [ ] **Adım 5: Sayfa ve bileşen testlerini yaz**

`web/src/seans/SeansSayfasi.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SeansNotu } from '../api'
import type { EtiketBaglami } from '../etiket/EtiketSatiri'
import type { useSeansNotlari } from '../screens/anaEkranKancalari/useSeansNotlari'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { SeansSayfasi } from './SeansSayfasi'
import { taslaklariUnut } from './taslak'

vi.mock('../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../api')>()
  return {
    ...gercek,
    takvimApi: {
      ...gercek.takvimApi,
      cakismaKontrol: async () => ({ cakisanlar: [], cakisan_hafta_sayisi: 0, kontrol_edilen_hafta: 1 }),
    },
  }
})

const randevu: Randevu = {
  id: 101, client_id: 1, danisan_adi: 'Ayşe Yılmaz', baslangic: '2026-09-07T10:00', bitis: '2026-09-07T11:00',
  durum: 'planlandi', ucret: 45000, odendi: false, seri_id: null,
}
const resmiNot: SeansNotu = {
  appointment_id: 101, client_id: 1, danisan_adi: 'Ayşe Yılmaz', seans_zamani: '2026-09-07T10:00',
  sablon: 'serbest', icerik: '<p>bu seansin resmi notu</p>', onizleme: 'bu seansin resmi notu',
  guncelleme_zamani: '2026-09-07T06:00:00Z',
}
const GIZLI = 'GIZLI-OZEL-SAYFA'

function akis(ozel: Partial<ReturnType<typeof useSeansNotlari>['seans']> = {}): ReturnType<typeof useSeansNotlari> {
  return {
    seans: { id: randevu.id, not: resmiNot, ozelNot: null, ozelHata: null, gecmisNotlar: [], hata: null, ...ozel },
    notKaydet: vi.fn(async () => {}),
    notYansit: vi.fn(),
    ozelNotKaydet: vi.fn(async () => {}),
    ozelSekmeAcildi: vi.fn(),
    ozelYenidenDene: vi.fn(),
    yenidenDene: vi.fn(),
  }
}

const etiket: EtiketBaglami = {
  etiketler: [], hata: null, onYenidenDene: vi.fn(), sozluk: null, onSozlukIste: vi.fn(),
  onEkle: vi.fn(async () => {}), onKaldir: vi.fn(async () => {}), onEtiketAc: vi.fn(),
  yazmaHatasi: null, onYazmaHatasiTemizle: vi.fn(),
}

function kur(ozel: Partial<React.ComponentProps<typeof SeansSayfasi>> = {}) {
  const props = {
    randevu,
    seansAkisi: akis(),
    danisanlar: [{ id: 1, ad_soyad: 'Ayşe Yılmaz', telefon: null, durum: 'aktif' }],
    onTakvimeDon: vi.fn(),
    onDanisanAc: vi.fn(),
    onDurumDegis: vi.fn().mockResolvedValue(undefined),
    onOdemeDegis: vi.fn().mockResolvedValue(undefined),
    onRandevuKaydet: vi.fn(async () => {}),
    onRandevuSil: vi.fn(async () => {}),
    onSeriSil: vi.fn(async () => {}),
    etiket,
    ...ozel,
  }
  return { ...props, ...render(<SeansSayfasi {...props} />) }
}

beforeEach(() => taslaklariUnut())
afterEach(() => vi.restoreAllMocks())

describe('SeansSayfasi (tasarım N1-N4)', () => {
  it('7.5 üst satır: Takvime dön, danışan adı (dosyaya), tarih-saat; bölge adı "Seans"', async () => {
    const p = kur()
    const sayfa = screen.getByRole('region', { name: 'Seans' })
    expect(sayfa.getAttribute('data-testid')).toBe('seans-bolumu')
    expect(sayfa.textContent).toContain('7 Eylül 2026, 10:00')
    await userEvent.click(screen.getByRole('button', { name: 'Takvime dön' }))
    expect(p.onTakvimeDon).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Ayşe Yılmaz dosyasını aç' }))
    expect(p.onDanisanAc).toHaveBeenCalledWith(1)
  })

  it('7.6 N3: randevu formu KAPALI başlar; "Randevuyu düzenle" açar, "Kapat" gizler', async () => {
    kur()
    expect(screen.queryByRole('heading', { name: 'Randevu' })).toBeNull()
    const dugme = screen.getByRole('button', { name: 'Randevuyu düzenle' })
    expect(dugme.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(dugme)
    expect(screen.getByRole('heading', { name: 'Randevu' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Güncelle' })).toBeDefined()
    const kapat = screen.getByRole('button', { name: 'Kapat' })
    expect(kapat.getAttribute('aria-expanded')).toBe('true')
    await userEvent.click(kapat)
    expect(screen.queryByRole('heading', { name: 'Randevu' })).toBeNull()
  })

  it('7.7 N2: durum, ücret ve Ödendi üst satırda; yazma yolu çağıranın', async () => {
    const p = kur()
    const grup = screen.getByRole('group', { name: 'Seans durumu' })
    await userEvent.click(within(grup).getByRole('button', { name: 'Gelmedi' }))
    expect(p.onDurumDegis).toHaveBeenCalledWith('gelmedi')
    expect(screen.getByText('450,00 TL')).toBeDefined()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ödendi' }))
    expect(p.onOdemeDegis).toHaveBeenCalledWith(true)
  })

  it('7.8 N4: editör alanı sekmeli; özel not sekmeye girilmeden istenmez', async () => {
    const p = kur()
    expect((screen.getByLabelText('Seans notu') as HTMLTextAreaElement).value).toBe('<p>bu seansin resmi notu</p>')
    expect(p.seansAkisi.ozelSekmeAcildi).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    expect(p.seansAkisi.ozelSekmeAcildi).toHaveBeenCalledTimes(1)
  })

  it('7.9 not okunamazsa hata ve Yeniden dene; durum düğmeleri YİNE var, önceki notlar sütunu yok', async () => {
    const p = kur({ seansAkisi: akis({ not: null, hata: 'Sunucuya ulaşılamadı.' }) })
    expect(screen.getByRole('alert').textContent).toContain('Sunucuya ulaşılamadı.')
    await userEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }))
    expect(p.seansAkisi.yenidenDene).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('group', { name: 'Seans durumu' })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Önceki seans notları' })).toBeNull()
  })

  it('7.10 özel not sağ sütunda HİÇBİR biçimde görünmez (özel sekme açık, geçmiş açılmış)', async () => {
    const gecmis: SeansNotu = { ...resmiNot, appointment_id: 90, seans_zamani: '2026-08-31T10:00', icerik: '<p>gecen hafta</p>' }
    kur({
      seansAkisi: akis({
        ozelNot: { appointment_id: 101, icerik: GIZLI, guncelleme_zamani: 'z' },
        gecmisNotlar: [gecmis],
      }),
    })
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    expect((screen.getByLabelText('Özel notum') as HTMLTextAreaElement).value).toBe(GIZLI)
    const sutun = screen.getByRole('region', { name: 'Önceki seans notları' })
    for (const d of within(sutun).getAllByRole('button')) await userEvent.click(d)
    expect(sutun.textContent).toContain('gecen hafta')
    expect(sutun.textContent).not.toContain(GIZLI)
  })
})
```

`web/src/seans/SeansAltSatiri.test.tsx`: `SeansPaneli.test.tsx`'teki `describe('SeansPaneli — alt satır: durum, ücret, ödendi', …)` bloğunu (9 test) AYNEN buraya taşı, adı `describe('SeansAltSatiri — durum, ücret, ödendi', …)`; dosyanın başı:

```tsx
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { SeansAltSatiri } from './SeansAltSatiri'

const ornekRandevu: Randevu = {
  id: 101, client_id: 1, danisan_adi: 'Ayşe Yılmaz', baslangic: '2026-09-07T10:00', bitis: '2026-09-07T11:00',
  durum: 'planlandi', ucret: null, odendi: false, seri_id: null,
}
type SatirProps = React.ComponentProps<typeof SeansAltSatiri>

function propsKur(ozel: Partial<SatirProps> = {}) {
  return {
    randevu: ornekRandevu,
    onDurumDegis: vi.fn().mockResolvedValue(undefined),
    onOdemeDegis: vi.fn().mockResolvedValue(undefined),
    ...ozel,
  }
}
function satir(ozel: Partial<SatirProps> = {}) {
  return <SeansAltSatiri {...propsKur(ozel)} />
}
function kur(ozel: Partial<SatirProps> = {}) {
  const props = propsKur(ozel)
  return { ...props, ...render(<SeansAltSatiri {...props} />) }
}

afterEach(() => vi.restoreAllMocks())
```

Taşınan testlerdeki `rerender(panel({…}))` → `rerender(satir({…}))`. (Kullanılmayan içe aktarma kalırsa sil.)

`web/src/seans/GecmisNotlar.test.tsx`: `SeansPaneli.test.tsx`'teki `describe('SeansPaneli — geçmiş bağlam', …)` testlerini buraya taşı (fikstür `gecmisNotlar` ile; her `kur()` → `render(<GecmisNotlar notlar={gecmisNotlar} />)`, boş durum testi `notlar={[]}`), BİR istisna: "gecmis bolumu DOM sirasinda sekmelerden ONCE gelir" silinir (tasarım N5 önceki notları sağ sütuna koydu; raporda yaz).

`web/src/takvim/TakvimSekmesi.test.tsx`: `bosTakvim()`'e `randevuyaGit: vi.fn(), gecisBekliyor: false,`. `10.7 DOM sirasi …` ve `10.9 "Takvime dön" …` testlerini şu üçüyle DEĞİŞTİR (`10.8` ve "izgaradaki blok…" kalır):

```tsx
  it('7.11 N1: seçili randevuyken ızgara ve boş saat formu YOK, not sayfası var; ay özeti sayfadan SONRA', async () => {
    taklit.ayOzeti = async (ay: string) => ({ ay, seans_sayisi: 0, tahsilat_kurus: 0, bekleyen_kurus: 0, borclular: [] })
    const props = seciliProplar()
    const { rerender } = render(<TakvimSekmesi {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ay sonu özeti' }))
    const sayfa = screen.getByTestId('seans-bolumu')
    expect(screen.queryByTestId('takvim-izgara')).toBeNull()
    expect(sayfa.compareDocumentPosition(screen.getByRole('region', { name: 'Ay sonu özeti' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Hafta araç çubuğu yerinde (Takvim sekmesi seçili kalır).
    expect(screen.getByRole('button', { name: 'Sonraki hafta' })).toBeDefined()

    // GEÇİŞ (dördüncü biçim): seçim boş saate döndü -> ızgara ve YANINDA yeni randevu formu.
    rerender(<TakvimSekmesi {...props} takvim={{ ...props.takvim, seciliRandevu: null, seciliBosSaat: '2026-09-08T09:00' }} />)
    expect(screen.queryByTestId('seans-bolumu')).toBeNull()
    const yeni = screen.getByRole('heading', { name: 'Yeni randevu' })
    expect(screen.getByTestId('takvim-izgara').parentElement!.contains(yeni)).toBe(true)
  })

  it('7.12 "Takvime dön" takvim.panelKapat\'ı çağırır, haftaya DOKUNMAZ', async () => {
    const props = seciliProplar()
    render(<TakvimSekmesi {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'Takvime dön' }))
    expect(props.takvim.panelKapat).toHaveBeenCalledTimes(1)
    expect(props.takvim.haftaDegis).not.toHaveBeenCalled()
    expect(props.takvim.haftayaGit).not.toHaveBeenCalled()
  })

  it('7.13 seçim A\'dan B\'ye DOĞRUDAN değişince (Bu seansa git yolu) sayfa yeniden kurulur: açık form B\'ye sızmaz', async () => {
    const props = seciliProplar()
    const { rerender } = render(<TakvimSekmesi {...props} />)
    await userEvent.click(screen.getByRole('button', { name: 'Randevuyu düzenle' }))
    expect(screen.getByRole('heading', { name: 'Randevu' })).toBeDefined()
    const b: Randevu = { ...secili, id: 102, danisan_adi: 'Mehmet Demir' }
    rerender(<TakvimSekmesi {...props} takvim={{ ...props.takvim, randevular: [secili, b], seciliRandevu: b }} />)
    expect(screen.queryByRole('heading', { name: 'Randevu' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Mehmet Demir dosyasını aç' })).toBeDefined()
  })

  it('7.14 geçiş bekliyorken ızgaranın yerinde "Seans açılıyor…" durur', () => {
    const props = varsayilanProplar()
    render(<TakvimSekmesi {...props} takvim={{ ...props.takvim, gecisBekliyor: true }} />)
    expect(screen.getByRole('status').textContent).toBe('Seans açılıyor…')
    expect(screen.queryByTestId('takvim-izgara')).toBeNull()
  })
```

(`seciliProplar` bu testlerde `seansAkisi`'ni boş bıraktığı için sayfa "Seans notu yükleniyor…" gösterir; formun ve üst satırın çizilmesi buna bağlı değil.)

- [ ] **Adım 6: Kırmızıyı gör** — web/: `npx vitest run src/seans src/takvim` → `./SeansSayfasi` yok; TakvimSekmesi 7.11–7.14 FAIL.

- [ ] **Adım 7: Alt satırı ve SeansPaneli'ni sadeleştir**

`web/src/seans/SeansAltSatiri.tsx`: `Props`'a

```ts
  /**
   * Not sayfasının üst satırında (tasarım N2): üst kenarlık ve boşluk yok.
   * Danışan dosyası ayrı satır görünümünü korur.
   */
  gomulu?: boolean
```

imzaya `gomulu = false`, kök `className`: `gomulu ? 'flex flex-wrap items-center gap-3' : 'mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3'`.

`web/src/seans/SeansPaneli.tsx`:
- İçe aktarmalardan `GecmisNotlar`, `SeansAltSatiri`, `zamanMetni` kalkar.
- `Props`'tan `gecmisNotlar`, `onKapat`, `onDanisanAc`, `onDurumDegis`, `onOdemeDegis` (belgeleriyle) kalkar; imzadan da.
- Kök `<section aria-labelledby="seans-paneli-basligi" className="mt-4 rounded-lg border border-slate-300 p-4">` → `<div>`; başlık bloğu (danışan düğmesi, "Takvime dön", "Seansı kapat"; L207–249) ve `lg:flex-row` sarmalayıcıyla sol `GecmisNotlar` sütunu (L251–258) SİLİNİR — sekme şeridi ve paneller doğrudan kökün çocukları olur; en alttaki `<SeansAltSatiri …/>` (L411–418) SİLİNİR.
- Modül başlığının ilk cümlesi: "Not sayfasının editör alanı (tasarım N4): iki sekmeli not alanı ve resmî sekmede etiketler. Üst satır (danışan, tarih, durum/ödeme, Takvime dön) ve önceki notlar `SeansSayfasi`'nde." "# Alt satır" bölümünü sil. "# Özel not sekmeye GEÇİLİNCE yüklenir" bölümündeki "Panel açılışında iki istek gider (resmî not + geçmiş)" → "Sayfa açılışında özel not istenmez".

`web/src/seans/SeansPaneli.test.tsx`: `propsKur` ve `Harness`'tan kaldırılan beş prop çıkar. `describe('SeansPaneli — başlıktaki danışan adı')`, `…geçmiş bağlam`, `…alt satır…`, `…kapatma` blokları ve "ozel not gecmis listesinde gorunmez (tum gecmis acikken bile)" testi SİLİNİR (taşındıkları yer: `SeansSayfasi.test.tsx` 7.5 ve 7.10, `GecmisNotlar.test.tsx`, `SeansAltSatiri.test.tsx`; "Takvime don … kaydirir" testi tasarım gereği düştü — sayfa ızgaranın YERİNE açılıyor).

- [ ] **Adım 8: Sayfayı yaz** (`web/src/seans/SeansSayfasi.tsx`)

```tsx
import { useState } from 'react'
import { takvimApi, type Danisan } from '../api'
import type { EtiketBaglami } from '../etiket/EtiketSatiri'
import type { useSeansNotlari } from '../screens/anaEkranKancalari/useSeansNotlari'
import type { useTakvimAkisi } from '../screens/anaEkranKancalari/useTakvimAkisi'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { RandevuPaneli } from '../takvim/RandevuPaneli'
import { zamanMetni } from '../tarih'
import { GecmisNotlar } from './GecmisNotlar'
import { SeansAltSatiri } from './SeansAltSatiri'
import { SeansPaneli } from './SeansPaneli'

/**
 * Seans notu sayfası (tasarım §7 N1-N4): takvimde bir randevuya tıklayınca
 * ızgaranın YERİNE açılır; Takvim sekmesi seçili kalır.
 *
 * - Üst satır (N2): "Takvime dön" (seçimi kapatır, hafta aynı kalır),
 *   danışan adı (dosyaya), tarih-saat, durum/ücret/Ödendi (`SeansAltSatiri`
 *   — bugünkü yazma yolları) ve "Randevuyu düzenle".
 * - Randevu formu (N3) KAPALI başlar: randevu güncellemek seyrek bir iş ve
 *   not alırken yer kaplamamalı. "Güncelle" sonrası açık kalır.
 * - Editör alanı (N4): `SeansPaneli` (sekmeler, şablon, editör, etiketler).
 *   Not okunamazsa editör AÇILMAZ, ama durum/ödeme yine işaretlenebilir.
 * - Sağ sütun: önceki notlar (Görev 8'de `OncekiNotlar`).
 *
 * Bu bileşen seans kimliğiyle `key`lidir (`TakvimSekmesi`): başka bir seansa
 * geçiş formu, sekmeyi ve alt satırın iyimser "Ödendi"sini sıfırlar; taşıma
 * (aynı kimlik, yeni başlangıç) sayfayı yeniden monte ETMEZ.
 */
type Props = {
  randevu: Randevu
  seansAkisi: ReturnType<typeof useSeansNotlari>
  danisanlar: Danisan[]
  onTakvimeDon: () => void
  onDanisanAc: (clientId: number) => void
  onDurumDegis: (durum: string) => Promise<void>
  onOdemeDegis: (odendi: boolean) => Promise<void>
  onRandevuKaydet: (kayit: Parameters<ReturnType<typeof useTakvimAkisi>['kaydet']>[0]) => Promise<void>
  onRandevuSil: (id: number) => Promise<void>
  onSeriSil: (seriId: string, buTarihtenItibaren: string) => Promise<void>
  etiket: EtiketBaglami
  /** Kullanıcı seçiminde sayfanın başına kaydırma (`TakvimSekmesi`). */
  ref?: React.Ref<HTMLElement>
}

export function SeansSayfasi({
  randevu, seansAkisi, danisanlar, onTakvimeDon, onDanisanAc, onDurumDegis, onOdemeDegis,
  onRandevuKaydet, onRandevuSil, onSeriSil, etiket, ref,
}: Props) {
  const [formAcik, setFormAcik] = useState(false)
  const seans = seansAkisi.seans
  return (
    <section
      ref={ref}
      id="seans-bolumu"
      data-testid="seans-bolumu"
      aria-labelledby="seans-sayfasi-basligi"
      className="scroll-mt-2"
    >
      <h2 id="seans-sayfasi-basligi" className="sr-only">Seans</h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 pb-3">
        <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onTakvimeDon}>
          <span aria-hidden="true">← </span>Takvime dön
        </button>
        <button
          type="button"
          className="text-lg font-semibold underline"
          aria-label={`${randevu.danisan_adi} dosyasını aç`}
          onClick={() => onDanisanAc(randevu.client_id)}
        >
          {randevu.danisan_adi}
        </button>
        <span data-testid="seans-zamani" className="text-sm text-slate-600">{zamanMetni(randevu.baslangic)}</span>
        <SeansAltSatiri gomulu randevu={randevu} onDurumDegis={onDurumDegis} onOdemeDegis={onOdemeDegis} />
        <button
          type="button"
          className="ml-auto rounded border px-3 py-1 text-sm"
          aria-expanded={formAcik}
          aria-controls="seans-randevu-formu"
          onClick={() => setFormAcik((acik) => !acik)}
        >
          {formAcik ? 'Kapat' : 'Randevuyu düzenle'}
        </button>
      </div>

      {formAcik && (
        <div id="seans-randevu-formu" className="mt-3">
          <RandevuPaneli
            key={`randevu-${randevu.id}`}
            gomulu
            zaman={randevu.baslangic}
            randevu={randevu}
            danisanlar={danisanlar}
            onKaydet={onRandevuKaydet}
            onSil={onRandevuSil}
            onSeriSil={onSeriSil}
            seriSayisiAl={takvimApi.seriSayisi}
            silinecekNotSayisiAl={takvimApi.silinecekNotSayisi}
            onKapat={onTakvimeDon}
            cakismaKontrol={takvimApi.cakismaKontrol}
          />
        </div>
      )}

      <div className="mt-4 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          {seans.hata === null ? (
            <SeansPaneli
              randevu={randevu}
              not={seans.not}
              ozelNot={seans.ozelNot}
              ozelHata={seans.ozelHata}
              onNotKaydet={seansAkisi.notKaydet}
              onOzelNotKaydet={seansAkisi.ozelNotKaydet}
              onOzelSekme={seansAkisi.ozelSekmeAcildi}
              onOzelYenidenDene={seansAkisi.ozelYenidenDene}
              etiket={etiket}
            />
          ) : (
            // Yükleme başarısızsa editör AÇILMAZ: "yükleniyor…" yazan bir alan
            // sonsuza kadar öyle kalırdı (eski bölümün kuralı).
            <div role="alert" className="rounded border border-red-300 bg-red-50 p-3">
              <p className="text-sm text-red-800">Seans notu yüklenemedi. {seans.hata}</p>
              <button
                type="button"
                className="mt-2 rounded border border-red-300 px-2 py-1 text-sm"
                onClick={seansAkisi.yenidenDene}
              >
                Yeniden dene
              </button>
            </div>
          )}
        </div>
        {seans.hata === null && (
          <div className="w-80 shrink-0">
            <GecmisNotlar notlar={seans.gecmisNotlar} />
          </div>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Adım 9: Takvim sekmesini bağla** (`web/src/takvim/TakvimSekmesi.tsx`)

- İçe aktarmalardan `SeansAltSatiri`, `SeansPaneli` kalkar; `import { SeansSayfasi } from '../seans/SeansSayfasi'`.
- L334–478 (ızgara+form `div` ve `seciliRandevu !== null && <section …>`) şununla DEĞİŞİR (ızgara `div`'inin ve boş saat formunun içi AYNEN korunur):

```tsx
      {seciliRandevu !== null ? (
        <SeansSayfasi
          // Anahtar YALNIZCA kimlik: başka seans sekmeyi/formu sıfırlar, taşıma
          // (yeni başlangıç) editörü yeniden monte ETMEZ (ölçen test:
          // `AnaEkran.test.tsx` > "10.4").
          key={`seans-${seciliRandevu.id}`}
          ref={seansBolumuRef}
          randevu={seciliRandevu}
          seansAkisi={seansAkisi}
          danisanlar={danisanlar}
          onTakvimeDon={takvim.panelKapat}
          // Seans kimliği de gidiyor: dosya BU seans seçili açılır (son inceleme I3).
          onDanisanAc={(clientId) => onDanisanAc(clientId, seciliRandevu.id)}
          onDurumDegis={(durum) => onDurumDegis(seciliRandevu.id, durum)}
          onOdemeDegis={(odendi) => onOdemeDegis(seciliRandevu.id, odendi)}
          onRandevuKaydet={onRandevuKaydet}
          onRandevuSil={onRandevuSil}
          onSeriSil={onSeriSil}
          etiket={etiketBaglami(seciliRandevu.id)}
        />
      ) : takvim.gecisBekliyor ? (
        // "Bu seansa git" başka bir haftaya: hafta yüklenene kadar (tasarım N8).
        <p role="status" className="text-sm text-slate-600">Seans açılıyor…</p>
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          {/* ızgara div'i ve seciliBosSaat formu — mevcut kod */}
        </div>
      )}
```

- Modül başlığında "`data-testid="takvim-izgara"` neden var" bölümünün "Plan A Görev 10'dan beri … `SeansPaneli` başlığındaki "Takvime dön" ızgarayı BU seçiciyle bulup kaydırıyor" paragrafını sil; yeni bölüm ekle: "# Not sayfası ızgaranın YERİNE (tasarım N1) — seçili randevu varken ızgara ve boş saat formu çizilmez, `SeansSayfasi` çizilir; hafta araç çubuğu, bugün satırı ve ay özeti yerinde kalır. Kaydırma isteği (A6) artık sayfanın başına."
- Kaydırma efekti (`seansBolumuRef`) AYNEN kalır; `useRef<HTMLElement>(null)` tipi `SeansSayfasi`'nin `ref`'iyle uyumlu.

- [ ] **Adım 10: Birim testlerini sayfaya uydur** (`AnaEkran.test.tsx`, `AnaEkran.yayilim.test.tsx`)

Her iki dosyaya üst düzey yardımcı:

```ts
/** Not sayfasında randevu formu KAPALI başlar (tasarım N3); formla çalışan testler önce açar. */
async function randevuFormunuAc() {
  await userEvent.click(await screen.findByRole('button', { name: 'Randevuyu düzenle' }))
}
```

Kurallar (her biri tasarımın doğrudan sonucu; iddia GEVŞETİLMEZ):
1. Var olan bir randevu seçildikten SONRA `Tarih`, `Başlangıç`, `Süre`, `Ücret (TL)`, `Danışan` alanlarına, `Güncelle`/`Sil`/`Bu ve sonraki tüm tekrarları sil` düğmelerine ya da `Randevu` başlığına dokunan her testte seçimden hemen sonra `await randevuFormunuAc()`. Bu dosyada bilinen yerler: "A için silme onayı…", "mevcut randevuda Güncelle PUT gönderir…", "silme takvimi yeniden çekmez…", "yeniden yükleme, panelin elindeki randevuyu TAZELER" (L976), "10.2 …", "10.4 …", "10.5 …", "10.6 …", iki "R11 …" testi.
2. `name: 'Seansı kapat'` → `name: 'Takvime dön'` (L1422, L1434, L1813, L1826). "R12 not okunamazsa hata kutusunda "Seansi kapat" var…" (L2448) → adı "R12 not okunamazsa üst satırdaki Takvime dön sayfayı kapatır", `within(uyari).getByRole('button', { name: 'Seansı kapat' })` → `screen.getByRole('button', { name: 'Takvime dön' })`.
3. Sayfa açıkken ızgaradaki BAŞKA bir bloğa ya da boş saate tıklanan her testte (A→B seans geçişleri, "A'da form alanları doldurulup boş bir saate geçilince…", "seans geçişi × uçuştaki istek" bloğu) tıklamadan önce `await userEvent.click(screen.getByRole('button', { name: 'Takvime dön' }))`. Giden seansın unmount tahliyesi aynen çalışır; testlerin ölçtüğü "bekleyen metin GİDEN seansa yazılır" iddiaları değişmez.
4. "Panel kapanır" türü iddialarda (`queryByRole('heading', { name: 'Randevu' })).toBeNull()` — L1015, L1026, L1912) form artık zaten kapalı başladığı için iddia totolojikleşir → `expect(screen.queryByTestId('seans-bolumu')).toBeNull()`.
5. "A için silme onayı açıkken B seçilince onay B üzerinde sızmaz" (L347): A → `randevuFormunuAc` → `Sil` (onay açık) → `Takvime dön` → B → `randevuFormunuAc` → onay YOK. (Doğrudan A→B geçişinin `key` koruması `TakvimSekmesi.test.tsx` 7.13'te.)
6. "10.1 izgarada randevuya tiklamak seans bolumunu BIR kez kaydirir…" aynen geçmeli (kaydırma sayfanın başına; `kaydir.mock.contexts[0]` `getByTestId('seans-bolumu')`).
7. Sayfa açıkken IZGARADAKİ bloğun özniteliğini ya da metnini okuyan iddialardan önce (`data-durum`, `data-odendi`, `data-ucret`, `blokAdi(...)` ile blok arama — ör. '"Geldi" isaretlemek not isteklerini YENIDEN ATMAZ' ve '"Ödendi" isaretlemek…' testlerinin son iddiaları, "10.2 …" sonrası blok konumu) `await userEvent.click(screen.getByRole('button', { name: 'Takvime dön' }))`; iyimser yamanın bloğa yansıdığı iddiası AYNEN kalır (sayfa kapanınca ızgara aynı önbellekten çizilir).
8. "Seans" bölgesinin ANLAMI değişti: eskiden `SeansPaneli`'nin kök `<section>`'ıydı (başlığı tek dizge "Ad — tarih") ve yalnızca not yüklenince çiziliyordu; şimdi `SeansSayfasi`'nin bölgesi, not okunamasa da açık (N2: durum/ödeme yine işaretlenir). Dönüşüm:
   - `…region', { name: 'Seans' }).textContent).toMatch(/<Ad> — …/)` (L1627, L1635, L1674, L1678, L1736, L2225, L2243, L2370, L2433, L2441) → `expect(sayfaBasligi()).toMatch(/<Ad> — …/)` — düzenli ifade AYNEN; yardımcı dosyanın üstüne:

```ts
/** Not sayfasının üst satırı "Ad — tarih" biçiminde (tasarım N2: danışan düğmesi + tarih-saat). */
function sayfaBasligi(): string {
  const sayfa = screen.getByRole('region', { name: 'Seans' })
  const ad = within(sayfa).getByRole('button', { name: /dosyasını aç$/ }).textContent
  return `${ad} — ${within(sayfa).getByTestId('seans-zamani').textContent}`
}
```

   - Not YÜKLENEMEYEN dal: "not yuklenemezse panel ACILMAZ…" (L1926) ve yükleme hatası `it.each`'i (L1951, "Ön koşul: gerçekten HATA dalındayız") `queryByRole('region', { name: 'Seans' })).toBeNull()` → `expect(screen.queryByRole('tab', { name: 'Seans Notu' })).toBeNull()` (editör alanı çizilmedi); L1926 testinin adı "not yuklenemezse EDITOR acilmaz; sayfa hata ve yeniden deneme gosterir".
   - Seçimin KAPANDIĞI dallar (L1261 boş saat, L1719 hafta değişimi, L1814 `Takvime dön` sonrası, L1833, L1913 401/kilit) `region 'Seans'` null iddiası AYNEN: sayfa tümüyle kalkar.
9. Sayfa açıkken "yeni haftanın listesi geldi" BARİYERİ olarak ızgara bloğunu bekleyen yerler (ör. "10.2 …" L2240 `findByRole('button', { name: blokAdi('Ayşe Yılmaz') })`): ızgara çizilmediği için bariyer `await waitFor(() => expect(haftaYanitiOkundu[haftaGetSayaci]).toBe(true))` (bu bloğun kendi sayacı: son hafta GET'inin gövdesi okundu) ve ardından `await waitFor(() => expect(sayfaBasligi()).toMatch(/<yeni tarih>/))` olur. Aynı testte ızgara bloğu hakkındaki iddia (konum, "aralık dışı" satırı) varsa kural 7'deki gibi `Takvime dön`'den SONRA yapılır.

Yeni test (`AnaEkran.test.tsx`, "seans paneli (Görev 9)" bloğu):

```ts
  it('7.15 sayfa açıkken ızgara YOK; "Takvime dön" aynı haftayı ve ızgarayı geri getirir', async () => {
    await seansAc()
    const baslik = document.querySelector('#hafta-basligi')?.textContent
    expect(screen.queryByTestId('takvim-izgara')).toBeNull()
    expect(screen.getByTestId('seans-bolumu')).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: 'Takvime dön' }))
    expect(screen.getByTestId('takvim-izgara')).toBeDefined()
    expect(screen.queryByTestId('seans-bolumu')).toBeNull()
    expect(document.querySelector('#hafta-basligi')?.textContent).toBe(baslik)
  })
```

(`seansAc` bu bloğun var olan yardımcısı; yoksa bloğun ilk testinin blok tıklamasını kullan.)

- [ ] **Adım 11: Yeşili gör** — web/: `npx vitest run` → PASS; `npm --prefix web run build`; `npm --prefix web run lint`. Değişen/taşınan/silinen her testi raporda adıyla listele.

- [ ] **Adım 12: E2E'yi sayfaya uydur**

- `e2e/takvim.spec.ts`:
  - Test 1: `Geldi`'den sonra `await page.getByRole('button', { name: 'Takvime dön', exact: true }).click()`, sonra `expect(blok).toHaveAttribute('data-durum', 'geldi')`.
  - Ücret testi: `bloklar.first().click()` → `await page.getByRole('button', { name: 'Randevuyu düzenle' }).click()` → ücret `450,00` → `500` → Güncelle → `await expect(page.getByText(/^Güncellendi \d{2}:\d{2}$/)).toBeVisible()` → `Takvime dön` → `data-ucret="50000"` bariyeri ve `toHaveCount(1)` → blok → `Randevuyu düzenle` → `toHaveValue('500,00')`. "Seansı kapat" satırları kalkar.
  - Taşıma testi, `Kaydedildi` bariyerinden sonrasını şununla değiştir:

```ts
  await page.getByRole('button', { name: 'Randevuyu düzenle' }).click()
  const tarihAlani = page.getByLabel('Tarih', { exact: true })
  const [yil, ay, gun] = (await tarihAlani.inputValue()).split('-').map(Number)
  const eski = new Date(Date.UTC(yil, ay - 1, gun))
  const yeni = new Date(Date.UTC(yil, ay - 1, gun + 1))
  const yeniMetin = yeni.toISOString().slice(0, 10)
  const hucreAdi = (d: Date) => `${d.getUTCDate()} ${AYLAR[d.getUTCMonth()]} 10:00 boş`
  const ayniHafta = yeni.getUTCDay() !== 1

  await tarihAlani.fill(yeniMetin)
  await page.getByRole('button', { name: 'Güncelle', exact: true }).click()
  // Form açık kalır ve söyler (tasarım N3); sayfa taşınan seansı gösterir, not onunla.
  await expect(page.getByText(/^Güncellendi \d{2}:\d{2}$/)).toBeVisible()
  const sayfa = page.getByRole('region', { name: 'Seans', exact: true })
  await expect(sayfa).toContainText(`${yeni.getUTCDate()} ${AYLAR[yeni.getUTCMonth()]}`)
  await expect(page.getByLabel('Seans notu', { exact: true })).toHaveText(not)

  // "Takvime dön" YENİ haftayı gösterir (tasarım N3): blok ertesi günün sütununda.
  await page.getByRole('button', { name: 'Takvime dön', exact: true }).click()
  await expect(page.getByRole('button', { name: hucreAdi(yeni), exact: true })).toHaveCount(0)
  const yeniGun11 = `${yeni.getUTCDate()} ${AYLAR[yeni.getUTCMonth()]} 11:00 boş`
  await expect(page.getByRole('button', { name: yeniGun11, exact: true })).toHaveCount(1)
  if (ayniHafta) {
    await expect(page.getByRole('button', { name: hucreAdi(eski), exact: true })).toHaveCount(1)
  }
  await expect(bloklar).toHaveCount(1)

  // Not SUNUCUDAN da onunla geliyor: sayfa yeniden monte olur, metin GET yanıtından.
  await bloklar.first().click()
  await expect(page.getByLabel('Seans notu', { exact: true })).toHaveText(not)
```

  (Eski "ön koşul: ertesi günün 10:00 hücresi şu an BOŞ" satırı sayfa açıkken ızgara olmadığı için kalkar; ertesi günün hücresinin BOŞALMADAN DOLU olduğu "0" iddiası, aynı günün 11:00 hücresinin görünür olmasıyla ekranda-gün bariyerine bağlı kalır.)
  - Seri testi: `bloklar.first().click()`'ten sonra `Randevuyu düzenle`.
  - Görev 1'in yarım genişlik testi: `Gelmedi`'den sonra `Takvime dön`, sonra `data-durum`/ad bariyeri ve ölçümler.
- `e2e/notlar.spec.ts`: "danisan dosyasi…" testinde `Geldi`'den sonra `Takvime dön`; "randevu silme onayi…" testinde ilk `Sil`'den önce `Randevuyu düzenle`, `Vazgeç`'ten sonraki `expect(blok).toBeVisible()` → `await expect(page.getByLabel('Özel notum', { exact: true })).toHaveText(gizli)` (sayfa ve not yerinde), silme sonrası `expect(blok).toHaveCount(0)` aynen.
- `e2e/kabuk.spec.ts` test 2 sonu: `await expect(page.getByTestId('seans-bolumu')).toBeVisible()` (sekme değişimi seçimi sıfırlamadı) → `Takvime dön` → `await expect(blok).toBeVisible()`.
- `e2e/odeme.spec.ts` `durumIsaretle`: `aria-pressed` iddiasından sonra

```ts
  // Sayfa ızgaranın yerinde (tasarım N1): bloğun durumunu görmek için takvime
  // dön, sonra seansı yeniden aç (satır locator'ı yeniden çözülür).
  await page.getByRole('button', { name: 'Takvime dön', exact: true }).click()
  await expect(blok(page, ad)).toHaveAttribute('data-durum', kod)
  await blok(page, ad).click()
  await expect(satir.getByRole('button', { name: etiket, exact: true })).toHaveAttribute('aria-pressed', 'true')
```

- `e2e/yerlesim.spec.ts` son test: `oncesi` ölçümünü bloğa tıklamadan ÖNCE al; aç → sayfa sonuna kaydır → `Geldi` → `aria-pressed` → `Takvime dön` → `sonrasi` ölç, `toBe(oncesi?.height)`. Yorumun "ızgaranın ilk satır yüksekliğinin kaydırmadan ÖNCE ve SONRA AYNI" cümlesine "(sayfa ızgaranın yerinde açıldığı için ölçüm takvime dönüşte)" ekle.

Çalıştır: `npx playwright test --reporter=line` → PASS.

- [ ] **Adım 13: Tam doğrulama** — `npm --prefix web run build`, `npm --prefix web run lint`, web/ `npx vitest run`, `cargo test --workspace`, `npx playwright test --reporter=line`.

- [ ] **Adım 14: Commit**

```bash
git add web/src/seans/SeansSayfasi.tsx web/src/seans/SeansSayfasi.test.tsx web/src/seans/SeansAltSatiri.tsx web/src/seans/SeansAltSatiri.test.tsx web/src/seans/SeansPaneli.tsx web/src/seans/SeansPaneli.test.tsx web/src/seans/GecmisNotlar.test.tsx web/src/screens/anaEkranKancalari/useTakvimAkisi.ts web/src/screens/anaEkranKancalari/useTakvimAkisi.test.ts web/src/takvim/TakvimSekmesi.tsx web/src/takvim/TakvimSekmesi.test.tsx web/src/screens/AnaEkran.test.tsx web/src/screens/AnaEkran.yayilim.test.tsx e2e/takvim.spec.ts e2e/notlar.spec.ts e2e/kabuk.spec.ts e2e/odeme.spec.ts e2e/yerlesim.spec.ts
git commit -m "Takvim: randevuya tiklayinca seans notu sayfasi, randevu formu kapali baslar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Mutasyonlar:**
- `randevuyaGit`'te `panelKapat()` satırını sil → 7.1 (`seciliRandevu` null değil) kırılır.
- `yukle`'deki bekleyen seçim bloğunu hafta korumasının (`if (gorunenHafta.current !== istenen) return`) ÖNÜNE taşı → 7.4 kırılır.
- `SeansSayfasi`'nin `key`'ini kaldır → 7.13 kırılır.
- `useState(false)` → `useState(true)` (form açık başlar) → 7.6 kırılır.
- `TakvimSekmesi`'nde sayfa yerine eski düzen (ızgara + sayfa birlikte) → 7.11 ve 7.15 kırılır.

---

### Task 8: Önceki notlar paneli (spec §7 N5–N9)

**Files:**
- Create: `web/src/seans/okumaPenceresi.ts` (yalnızca `okumaPenceresiniAc`; Görev 9 `okumaKimligi`'ni ekler)
- Create: `web/src/seans/OncekiNotlar.tsx`, `web/src/seans/OncekiNotlar.test.tsx`
- Modify: `web/src/seans/SeansSayfasi.tsx` (sağ sütun, `onSeansaGit`, genişlik state'i), `web/src/seans/SeansSayfasi.test.tsx`
- Modify: `web/src/takvim/TakvimSekmesi.tsx` (`onSeansaGit={takvim.randevuyaGit}`), `web/src/takvim/TakvimSekmesi.test.tsx` (`bosSeansAkisi`)
- Modify: `web/src/screens/anaEkranKancalari/useSeansNotlari.ts` (geçmiş not isteği ve `gecmisNotlar` kalkar)
- Modify: `web/src/istemciRaporUretimi.test.ts` (`window.open` adlı istisnası)
- Modify: `web/src/screens/AnaEkran.test.tsx`, `web/src/screens/AnaEkran.yayilim.test.tsx`
- Delete: `web/src/seans/GecmisNotlar.tsx`, `web/src/seans/GecmisNotlar.test.tsx`

**Interfaces:**
- Produces: `export function okumaPenceresiniAc(randevuId: number): void` — TEK çağrı: ``window.open(`/?okuma=${randevuId}`, `okuma-${randevuId}`)?.focus()``.
- Produces: `export const ARAMA_GECIKMESI_MS = 300` ve `export function OncekiNotlar(props: { danisanId: number; seansId: number; seansBaslangici: string; onSeansaGit: (id: number, baslangic: string) => void; onGenislikDegisti: (genis: boolean) => void }): JSX.Element` — `<section aria-labelledby="onceki-notlar-basligi">` (erişilebilir ad "Önceki seans notları"), arama kutusu `<input type="search" aria-label="Önceki notlarda ara">`, satırlar `<li><button>…</button></li>`, bağlam menüsü `role="menu"` + `role="menuitem"` "Yeni pencerede aç", geniş okumada "Listeye dön", tarih düğmesi (açık satır — ikinci tık) ve "Bu seansa git".
- Consumes: `danisanApi.seanslar(clientId)` (sayfa açılışında TEK istek — var olan `Goruntuleme | danisan_seanslari` satırı), `notApi.notAra(danisanId, terim, seansBaslangici)` (Görev 3), `notApi.notGetir(id)` (YALNIZCA kullanıcı bir notu açınca; notu yazılmamış satırda hiç), `takvim.randevuyaGit` (Görev 7), `DurumSimgeleri`/`durumSimgeMetni` (Görev 1), `NotOkuma` ve `vurguParcalari`/`katla`/`ASGARI_VURGU` (Görev 4).
- Changes: `SeansSayfasi` props += `onSeansaGit: (id: number, baslangic: string) => void`; `SeansVerisi` → `{ id, not, ozelNot, ozelHata, hata }` (`gecmisNotlar` kalkar); `useSeansNotlari` artık `/api/danisanlar/{id}/notlar` İSTEMEZ.

- [ ] **Adım 1: Başarısız testleri yaz**

`web/src/seans/OncekiNotlar.test.tsx`:

```tsx
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DanisanSeansi, NotAramaSonucu, SeansNotu } from '../api'
import { ARAMA_GECIKMESI_MS, OncekiNotlar } from './OncekiNotlar'

const t = vi.hoisted(() => ({ seanslar: vi.fn(), notAra: vi.fn(), notGetir: vi.fn(), pencere: vi.fn() }))
vi.mock('../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../api')>()
  return {
    ...gercek,
    danisanApi: { ...gercek.danisanApi, seanslar: t.seanslar },
    notApi: { ...gercek.notApi, notAra: t.notAra, notGetir: t.notGetir },
  }
})
vi.mock('./okumaPenceresi', () => ({ okumaPenceresiniAc: t.pencere }))

function seans(ozel: Partial<DanisanSeansi>): DanisanSeansi {
  return {
    appointment_id: 0, baslangic: '', durum: 'geldi', ucret_kurus: 45000, odendi: true,
    not_ilk_satiri: null, etiketler: [], ...ozel,
  }
}
// Sunucu sırası: yeniden eskiye. Bu seans 14 Eylül; bir SONRAKİ ve bir de kendisi listede.
const LISTE: DanisanSeansi[] = [
  seans({ appointment_id: 400, baslangic: '2026-09-21T10:00', not_ilk_satiri: 'SONRAKI SEANS' }),
  seans({ appointment_id: 300, baslangic: '2026-09-14T10:00', not_ilk_satiri: 'BU SEANS' }),
  seans({ appointment_id: 200, baslangic: '2026-09-07T10:00', not_ilk_satiri: 'Uyku düzeni iyileşmiş', durum: 'gelmedi', odendi: false }),
  seans({ appointment_id: 100, baslangic: '2026-08-31T10:00', not_ilk_satiri: null }),
]
function not(id: number, icerik: string): SeansNotu {
  return {
    appointment_id: id, client_id: 1, danisan_adi: 'Ayşe Yılmaz', seans_zamani: '2026-09-07T10:00',
    sablon: 'serbest', icerik, onizleme: null, guncelleme_zamani: 'z',
  }
}
async function ilerle(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}
function kur() {
  const props = {
    danisanId: 1, seansId: 300, seansBaslangici: '2026-09-14T10:00',
    onSeansaGit: vi.fn(), onGenislikDegisti: vi.fn(),
  }
  render(<OncekiNotlar {...props} />)
  return props
}
const bolge = () => screen.getByRole('region', { name: 'Önceki seans notları' })
const satirlar = () => within(bolge()).queryAllByRole('listitem')
const kutu = () => screen.getByRole('searchbox', { name: 'Önceki notlarda ara' })

beforeEach(() => {
  vi.useFakeTimers()
  t.seanslar.mockReset().mockResolvedValue(LISTE)
  t.notAra.mockReset().mockResolvedValue([])
  t.notGetir.mockReset()
  t.pencere.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('OncekiNotlar (tasarım N5-N9)', () => {
  it('8.1 N5: yalnızca BU seanstan önceki seanslar, yeniden eskiye; simgeler; "Not yazılmamış"; not İSTENMEZ', async () => {
    kur()
    await ilerle(0)
    const s = satirlar()
    expect(s).toHaveLength(2)
    expect(s[0].textContent).toContain('7 Eylül 2026, 10:00')
    expect(s[0].textContent).toContain('Uyku düzeni iyileşmiş')
    expect(s[0].querySelector('[data-simge="gelmedi"]')).not.toBeNull()
    expect(s[0].querySelector('[data-simge="odeme"]')).not.toBeNull()
    expect(s[1].textContent).toContain('31 Ağustos 2026, 10:00')
    expect(s[1].textContent).toContain('Not yazılmamış')
    expect(bolge().textContent).not.toContain('BU SEANS')
    expect(bolge().textContent).not.toContain('SONRAKI SEANS')
    expect(t.seanslar).toHaveBeenCalledTimes(1)
    expect(t.seanslar).toHaveBeenCalledWith(1)
    expect(t.notGetir).not.toHaveBeenCalled()
  })

  it('8.2 N6: arama gecikmeli; tek harf istek atmaz; terim ve kesme sunucuya; parçada terim vurgulu', async () => {
    const sonuc: NotAramaSonucu[] = [{ appointment_id: 200, seans_zamani: '2026-09-07T10:00', parca: 'Danışan bugün KAYGI anlattı' }]
    t.notAra.mockResolvedValue(sonuc)
    kur()
    await ilerle(0)
    fireEvent.change(kutu(), { target: { value: 'k' } })
    await ilerle(1000)
    expect(t.notAra).not.toHaveBeenCalled()
    fireEvent.change(kutu(), { target: { value: 'kaygı' } })
    await ilerle(ARAMA_GECIKMESI_MS - 1)
    expect(t.notAra).not.toHaveBeenCalled()
    await ilerle(1)
    expect(t.notAra).toHaveBeenCalledTimes(1)
    expect(t.notAra).toHaveBeenCalledWith(1, 'kaygı', '2026-09-14T10:00')
    const s = satirlar()
    expect(s).toHaveLength(1)
    expect(s[0].querySelector('mark')?.textContent).toBe('KAYGI')
    expect(s[0].querySelector('[data-simge="gelmedi"]')).not.toBeNull()
  })

  it('8.3 eşleşme yoksa bunu SÖYLER ("önceki seans yok" gibi görünmez)', async () => {
    kur()
    await ilerle(0)
    fireEvent.change(kutu(), { target: { value: 'yokterim' } })
    await ilerle(ARAMA_GECIKMESI_MS)
    expect(bolge().textContent).toContain('Bu terim önceki notlarda geçmiyor.')
    expect(bolge().textContent).not.toContain('Bu seanstan önce kayıtlı seans yok.')
  })

  it('8.4 N7: tek tık geniş okuma açar, notu ister, bütün eşleşmeleri vurgular; "Listeye dön" kapatır', async () => {
    t.notAra.mockResolvedValue([{ appointment_id: 200, seans_zamani: '2026-09-07T10:00', parca: 'KAYGI' }])
    t.notGetir.mockResolvedValue(not(200, '<p>Danışan <strong>KAYGI</strong> anlattı; kaygı azaldı</p>'))
    const p = kur()
    await ilerle(0)
    fireEvent.change(kutu(), { target: { value: 'kaygi' } })
    await ilerle(ARAMA_GECIKMESI_MS)
    fireEvent.click(within(satirlar()[0]).getByRole('button'))
    await ilerle(0)
    expect(p.onGenislikDegisti).toHaveBeenLastCalledWith(true)
    expect(t.notGetir).toHaveBeenCalledWith(200)
    expect([...bolge().querySelectorAll('.not-vurgu')].map((e) => e.textContent)).toEqual(['KAYGI', 'kaygı'])
    expect(within(bolge()).getByRole('button', { name: 'Bu seansa git' })).toBeDefined()
    fireEvent.click(within(bolge()).getByRole('button', { name: 'Listeye dön' }))
    expect(p.onGenislikDegisti).toHaveBeenLastCalledWith(false)
    expect(satirlar()).toHaveLength(1)
  })

  it('8.5 notu yazılmamış seans açılınca istek ATILMAZ (bakılmayan not için görüntüleme satırı yok)', async () => {
    kur()
    await ilerle(0)
    fireEvent.click(within(satirlar()[1]).getByRole('button'))
    await ilerle(0)
    expect(t.notGetir).not.toHaveBeenCalled()
    expect(bolge().textContent).toContain('Bu seans için not yazılmamış.')
  })

  it('8.6 N8: açık satırın tarihine ikinci tık ve "Bu seansa git" o seansa geçer', async () => {
    t.notGetir.mockResolvedValue(not(200, '<p>eski</p>'))
    const p = kur()
    await ilerle(0)
    fireEvent.click(within(satirlar()[0]).getByRole('button'))
    await ilerle(0)
    fireEvent.click(within(bolge()).getByRole('button', { name: '7 Eylül 2026, 10:00' }))
    expect(p.onSeansaGit).toHaveBeenLastCalledWith(200, '2026-09-07T10:00')
    fireEvent.click(within(bolge()).getByRole('button', { name: 'Bu seansa git' }))
    expect(p.onSeansaGit).toHaveBeenCalledTimes(2)
  })

  it('8.7 N9: sağ tık menüsü ve Ctrl/Cmd+tık okuma penceresini açar; seçim ve not isteği YOK', async () => {
    t.notGetir.mockResolvedValue(not(200, '<p>eski</p>'))
    const p = kur()
    await ilerle(0)
    const dugme = within(satirlar()[0]).getByRole('button')
    fireEvent.contextMenu(dugme, { clientX: 10, clientY: 20 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Yeni pencerede aç' }))
    expect(t.pencere).toHaveBeenLastCalledWith(200)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(dugme, { ctrlKey: true })
    fireEvent.click(dugme, { metaKey: true })
    expect(t.pencere).toHaveBeenCalledTimes(3)
    expect(p.onGenislikDegisti).not.toHaveBeenCalled()
    expect(t.notGetir).not.toHaveBeenCalled()
    // "Bu seansa git"e sağ tık da aynı menüyü açar.
    fireEvent.click(dugme)
    await ilerle(0)
    fireEvent.contextMenu(within(bolge()).getByRole('button', { name: 'Bu seansa git' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('liste yüklenemezse hata gösterilir, "önceki seans yok" DENMEZ', async () => {
    t.seanslar.mockRejectedValue(new Error('Veritabanı okunamadı.'))
    kur()
    await ilerle(0)
    expect(within(bolge()).getByRole('alert').textContent).toContain('Veritabanı okunamadı.')
    expect(bolge().textContent).not.toContain('Bu seanstan önce kayıtlı seans yok.')
  })
})
```

`web/src/istemciRaporUretimi.test.ts`: `OZEL_NOT_IZINLI_DOSYALAR`'ın altına

```ts
/**
 * `window.open`'ın TEK adlı istisnası (tasarım 2026-09-26 P2): okuma
 * penceresi. Dar ve çalıştırılabilir: yalnızca bu dosyada, TEK çağrı ve
 * çağrının metni BİREBİR aşağıdaki (aynı kökenden, yalnızca randevu kimliği
 * taşıyan adres; pencere notu sunucudan kendisi ister). Adres, ad ya da
 * çağrı sayısı değişirse test kırılır.
 */
const OKUMA_PENCERESI_DOSYASI = './seans/okumaPenceresi.ts'
const OKUMA_PENCERESI_CAGRISI = 'window.open(`/?okuma=${randevuId}`, `okuma-${randevuId}`)'

function pencereAcmaCagrilari(ad: string, kaynak: string): string[] {
  const kok = ts.createSourceFile(ad, kaynak, ts.ScriptTarget.Latest, true, betikTuru(ad))
  const bulunan: string[] = []
  const ziyaret = (d: ts.Node) => {
    if (ts.isCallExpression(d) && ts.isPropertyAccessExpression(d.expression) && d.expression.name.text === 'open') {
      bulunan.push(d.getText(kok))
    }
    ts.forEachChild(d, ziyaret)
  }
  ziyaret(kok)
  return bulunan
}
```

"pano / yazdirma / yeni pencere …" testinin gövdesi:

```ts
    const ihlal = bulgular.flatMap(([y, b]) =>
      b.yasakApi
        .filter((m) => !(y === OKUMA_PENCERESI_DOSYASI && m === 'window.open'))
        .map((m) => `${y}: ${m}`),
    )
    expect(ihlal).toEqual([])
```

ve altına:

```ts
  it('window.open istisnası dar: yalnızca okuma penceresi dosyasında, TEK çağrı, adres birebir', () => {
    const kaynak = uretimKaynaklari[OKUMA_PENCERESI_DOSYASI]
    expect(kaynak, `${OKUMA_PENCERESI_DOSYASI} taranan kaynaklar arasında yok`).toBeDefined()
    expect(pencereAcmaCagrilari(OKUMA_PENCERESI_DOSYASI, kaynak)).toEqual([OKUMA_PENCERESI_CAGRISI])
    // Körlüğe karşı: istisna gerçekten bir yasakApi bulgusunu süzüyor.
    expect(bulgular.find(([y]) => y === OKUMA_PENCERESI_DOSYASI)?.[1].yasakApi).toEqual(['window.open'])
  })
```

- [ ] **Adım 2: Kırmızıyı gör** — web/: `npx vitest run src/seans/OncekiNotlar.test.tsx src/istemciRaporUretimi.test.ts` → `./OncekiNotlar` yok; istisna testi dosyayı bulamıyor.

- [ ] **Adım 3: Pencere açıcıyı yaz** (`web/src/seans/okumaPenceresi.ts`)

```ts
/**
 * Okuma penceresi adresi (tasarım P2). Açan yarı burada; okuyan yarı
 * (`okumaKimligi`) Görev 9'da aynı dosyaya eklenir.
 *
 * `window.open` bu kod tabanında YASAK (`istemciRaporUretimi.test.ts`: yeni
 * pencere/belge danışan verisini sunucunun güvencesi dışına çıkarabilir).
 * Buradaki TEK çağrı adıyla istisnadır ve o test çağrının metnini birebir
 * sabitler: aynı kökenden, yalnızca bir randevu KİMLİĞİ taşıyan bir adres;
 * pencere notu sunucudan kendisi ister (özel not yolu yok) ve kilitte
 * içeriği kaldırır. Masaüstünde Tauri isteği `on_new_window`'da yakalar ve
 * pencereyi kendisi kurar (`src-tauri/src/pencere.rs`); tarayıcıda aynı ad
 * ikinci kez istenince var olan pencere kullanılır (P3).
 */
export function okumaPenceresiniAc(randevuId: number): void {
  window.open(`/?okuma=${randevuId}`, `okuma-${randevuId}`)?.focus()
}
```

- [ ] **Adım 4: Paneli yaz** (`web/src/seans/OncekiNotlar.tsx`)

```tsx
import { useEffect, useState } from 'react'
import { danisanApi, notApi, YetkisizHata, type DanisanSeansi, type NotAramaSonucu, type SeansNotu } from '../api'
import { NotOkuma } from '../not/NotOkuma'
import { ASGARI_VURGU, katla, vurguParcalari } from '../not/vurgu'
import { DurumSimgeleri } from '../takvim/DurumSimgeleri'
import { durumSimgeMetni, type DurumAlanlari } from '../takvim/durumSimgesi'
import { zamanMetni } from '../tarih'
import { okumaPenceresiniAc } from './okumaPenceresi'

/**
 * Önceki notlar paneli (tasarım §7 N5-N9) — not sayfasının sağ sütunu.
 *
 * - Liste (N5): danışanın BU seanstan önceki seansları, yeniden eskiye.
 *   Tek kaynak `danisanApi.seanslar` (sayfa açılışında TEK istek; o istek
 *   sunucuda `danisan_seanslari` görüntüleme satırı yazar). Kesme istemcide
 *   ve KESİN küçük: bu seansın kendisi ve sonrakiler listede yok; seans
 *   taşınınca liste yeniden İSTENMEZ, yeni başlangıçla süzülür.
 * - Arama (N6): gecikmeli, yalnızca bu danışanın RESMÎ notlarında,
 *   `duz_metin` üzerinde Türkçe harf duyarsız (sunucu, `notApi.notAra`).
 *   İki harften kısa terim istek atmaz. Terim hiçbir yere yazılmaz.
 * - Geniş okuma (N7): tek tık sütunu yarıya büyütür (`onGenislikDegisti`),
 *   notu editörle aynı tipografiyle salt okunur gösterir, aranan terimi
 *   vurgular ve ilkine kaydırır. Not YALNIZCA açılınca istenir; notu
 *   yazılmamış seans için hiç istenmez (bakılmayan bir şey için silinemez
 *   görüntüleme satırı yok).
 * - Seansa geçiş (N8): açık satırın tarihine ikinci tık ya da "Bu seansa
 *   git" (`takvim.randevuyaGit`).
 * - Yeni pencere (N9): sağ tık menüsü "Yeni pencerede aç" ya da Cmd/Ctrl+tık.
 *
 * Özel not bu panele HİÇBİR yoldan giremez: yalnızca resmî not uçları.
 */
export const ARAMA_GECIKMESI_MS = 300

type Props = {
  danisanId: number
  seansId: number
  seansBaslangici: string
  onSeansaGit: (id: number, baslangic: string) => void
  onGenislikDegisti: (genis: boolean) => void
}

type Satir = { id: number; baslangic: string; parca: string | null; seans: DanisanSeansi | undefined }
type AcikNot = { id: number; not: SeansNotu } | { id: number; hata: string }

function alanlar(s: DanisanSeansi): DurumAlanlari {
  return { durum: s.durum, odendi: s.odendi, ucret: s.ucret_kurus }
}

export function OncekiNotlar({ danisanId, seansId, seansBaslangici, onSeansaGit, onGenislikDegisti }: Props) {
  const [seanslar, setSeanslar] = useState<DanisanSeansi[] | null>(null)
  const [listeHatasi, setListeHatasi] = useState<string | null>(null)
  const [terim, setTerim] = useState('')
  const [arama, setArama] = useState<{ terim: string; sonuclar: NotAramaSonucu[] } | null>(null)
  const [aramaHatasi, setAramaHatasi] = useState<{ terim: string; mesaj: string } | null>(null)
  const [acik, setAcik] = useState<{ id: number; baslangic: string } | null>(null)
  const [acikNot, setAcikNot] = useState<AcikNot | null>(null)
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null)

  useEffect(() => {
    let iptal = false
    danisanApi.seanslar(danisanId).then(
      (gelen) => {
        if (!iptal) setSeanslar(gelen)
      },
      (e: unknown) => {
        if (iptal || e instanceof YetkisizHata) return
        setListeHatasi(e instanceof Error ? e.message : 'Önceki seanslar yüklenemedi.')
      },
    )
    return () => {
      iptal = true
    }
  }, [danisanId])

  const kirpilmis = terim.trim()
  const aramaEtkin = katla(kirpilmis).length >= ASGARI_VURGU
  useEffect(() => {
    if (!aramaEtkin) return
    let iptal = false
    const zamanlayici = setTimeout(() => {
      notApi.notAra(danisanId, kirpilmis, seansBaslangici).then(
        (sonuclar) => {
          if (!iptal) setArama({ terim: kirpilmis, sonuclar })
        },
        (e: unknown) => {
          if (iptal || e instanceof YetkisizHata) return
          setAramaHatasi({ terim: kirpilmis, mesaj: e instanceof Error ? e.message : 'Arama yapılamadı.' })
        },
      )
    }, ARAMA_GECIKMESI_MS)
    return () => {
      iptal = true
      clearTimeout(zamanlayici)
    }
  }, [aramaEtkin, kirpilmis, danisanId, seansBaslangici])

  useEffect(() => {
    if (menu === null) return
    const kapat = () => setMenu(null)
    const tus = (olay: KeyboardEvent) => {
      if (olay.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', kapat)
    document.addEventListener('keydown', tus)
    return () => {
      document.removeEventListener('mousedown', kapat)
      document.removeEventListener('keydown', tus)
    }
  }, [menu])

  const seansBul = (id: number) => seanslar?.find((s) => s.appointment_id === id)
  const gecerliArama = aramaEtkin && arama?.terim === kirpilmis ? arama : null
  const gecerliHata = aramaEtkin && aramaHatasi?.terim === kirpilmis ? aramaHatasi.mesaj : null
  const oncekiler = (seanslar ?? []).filter((s) => s.baslangic < seansBaslangici && s.appointment_id !== seansId)
  const satirlar: Satir[] = aramaEtkin
    ? (gecerliArama?.sonuclar ?? []).map((s) => ({
        id: s.appointment_id, baslangic: s.seans_zamani, parca: s.parca, seans: seansBul(s.appointment_id),
      }))
    : oncekiler.map((s) => ({ id: s.appointment_id, baslangic: s.baslangic, parca: null, seans: s }))

  function yeniPencere(id: number) {
    setMenu(null)
    okumaPenceresiniAc(id)
  }

  function menuAc(olay: React.MouseEvent, id: number) {
    olay.preventDefault()
    setMenu({ id, x: olay.clientX, y: olay.clientY })
  }

  function satiriAc(olay: React.MouseEvent, s: { id: number; baslangic: string; seans?: DanisanSeansi }) {
    if (olay.metaKey || olay.ctrlKey) {
      olay.preventDefault()
      yeniPencere(s.id)
      return
    }
    setMenu(null)
    if (acik?.id === s.id) {
      onSeansaGit(s.id, s.baslangic)
      return
    }
    setAcik({ id: s.id, baslangic: s.baslangic })
    onGenislikDegisti(true)
    setAcikNot(null)
    // Notu yazılmamış seans: istek YOK (bakılmayan not için görüntüleme satırı olmaz).
    if (s.seans !== undefined && s.seans.not_ilk_satiri === null) return
    notApi.notGetir(s.id).then(
      (not) => setAcikNot({ id: s.id, not }),
      (e: unknown) => {
        if (e instanceof YetkisizHata) return
        setAcikNot({ id: s.id, hata: e instanceof Error ? e.message : 'Not yüklenemedi.' })
      },
    )
  }

  function listeyeDon() {
    setAcik(null)
    setAcikNot(null)
    onGenislikDegisti(false)
  }

  const menuOgesi = menu !== null && (
    <div
      role="menu"
      aria-label="Seans seçenekleri"
      className="fixed z-30 rounded border border-slate-300 bg-white py-1 text-sm shadow"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(olay) => olay.stopPropagation()}
    >
      <button type="button" role="menuitem" className="block w-full px-3 py-1 text-left hover:bg-slate-100" onClick={() => yeniPencere(menu.id)}>
        Yeni pencerede aç
      </button>
    </div>
  )

  if (acik !== null) {
    const seans = seansBul(acik.id)
    const gosterilen = acikNot?.id === acik.id ? acikNot : null
    const notYok = seans?.not_ilk_satiri === null || (gosterilen !== null && 'not' in gosterilen && gosterilen.not.icerik === '')
    return (
      <section aria-labelledby="onceki-notlar-basligi" className="flex max-h-[calc(100vh-8rem)] flex-col">
        <h3 id="onceki-notlar-basligi" className="sr-only">Önceki seans notları</h3>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2 text-sm">
          <button type="button" className="underline" onClick={listeyeDon}>
            <span aria-hidden="true">← </span>Listeye dön
          </button>
          <button type="button" className="font-medium" onClick={(olay) => satiriAc(olay, { id: acik.id, baslangic: acik.baslangic, seans })}>
            {zamanMetni(acik.baslangic)}
          </button>
          {seans !== undefined && <DurumSimgeleri randevu={alanlar(seans)} />}
          <button
            type="button"
            className="ml-auto rounded border px-2 py-0.5"
            onClick={(olay) => {
              if (olay.metaKey || olay.ctrlKey) yeniPencere(acik.id)
              else onSeansaGit(acik.id, acik.baslangic)
            }}
            onContextMenu={(olay) => menuAc(olay, acik.id)}
          >
            Bu seansa git
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto pt-2">
          {notYok ? (
            <p className="text-sm text-slate-600">Bu seans için not yazılmamış.</p>
          ) : gosterilen === null ? (
            <p className="text-sm text-slate-600">Not yükleniyor…</p>
          ) : 'hata' in gosterilen ? (
            <p role="alert" className="text-sm text-red-800">Not yüklenemedi. {gosterilen.hata}</p>
          ) : (
            <NotOkuma html={gosterilen.not.icerik} vurgu={aramaEtkin ? kirpilmis : ''} />
          )}
        </div>
        {menuOgesi}
      </section>
    )
  }

  return (
    <section aria-labelledby="onceki-notlar-basligi" className="flex max-h-[calc(100vh-8rem)] flex-col">
      <h3 id="onceki-notlar-basligi" className="text-sm font-semibold text-slate-700">Önceki seans notları</h3>
      <input
        type="search"
        aria-label="Önceki notlarda ara"
        placeholder="Önceki notlarda ara"
        className="mt-2 rounded border border-slate-300 px-2 py-1 text-sm"
        value={terim}
        onChange={(olay) => setTerim(olay.target.value)}
      />
      {listeHatasi !== null ? (
        <p role="alert" className="mt-2 text-sm text-red-800">Önceki seanslar yüklenemedi. {listeHatasi}</p>
      ) : seanslar === null ? (
        <p className="mt-2 text-sm text-slate-600">Yükleniyor…</p>
      ) : gecerliHata !== null ? (
        <p role="alert" className="mt-2 text-sm text-red-800">Arama yapılamadı. {gecerliHata}</p>
      ) : aramaEtkin && gecerliArama === null ? (
        <p className="mt-2 text-sm text-slate-600">Aranıyor…</p>
      ) : satirlar.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">
          {aramaEtkin ? 'Bu terim önceki notlarda geçmiyor.' : 'Bu seanstan önce kayıtlı seans yok.'}
        </p>
      ) : null}
      <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-auto">
        {satirlar.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className="w-full rounded border border-slate-200 px-2 py-1 text-left text-sm hover:bg-slate-50"
              onClick={(olay) => satiriAc(olay, s)}
              onContextMenu={(olay) => menuAc(olay, s.id)}
            >
              <span className="flex items-center gap-1">
                <span className="font-medium tabular-nums">{zamanMetni(s.baslangic)}</span>
                {s.seans !== undefined && (
                  <>
                    <DurumSimgeleri randevu={alanlar(s.seans)} />
                    <span className="sr-only">{durumSimgeMetni(alanlar(s.seans))}</span>
                  </>
                )}
              </span>
              <span className="block truncate text-slate-600">
                {s.parca !== null
                  ? vurguParcalari(s.parca, kirpilmis).map((p, i) => (p.vurgu ? <mark key={i}>{p.metin}</mark> : <span key={i}>{p.metin}</span>))
                  : s.seans?.not_ilk_satiri || 'Not yazılmamış'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {menuOgesi}
    </section>
  )
}
```

- [ ] **Adım 5: Yeşili gör** — `npx vitest run src/seans/OncekiNotlar.test.tsx src/istemciRaporUretimi.test.ts` → PASS.

- [ ] **Adım 6: Sayfaya ve kancaya bağla**

`SeansSayfasi.tsx`: `import { GecmisNotlar } …` → `import { OncekiNotlar } from './OncekiNotlar'`; `Props`'a `onSeansaGit: (id: number, baslangic: string) => void` (belgesi: "Önceki notlardan seansa geçiş (tasarım N8, `takvim.randevuyaGit`)"); gövdeye `const [oncekiGenis, setOncekiGenis] = useState(false)`; sağ sütun:

```tsx
        {seans.hata === null && (
          // Geniş okuma (N7): sütun sayfanın yarısına büyür; editör aynı
          // düğümde kalır (yazılmamış metin kaybolmaz).
          <div className={oncekiGenis ? 'w-1/2 shrink-0' : 'w-80 shrink-0'}>
            <OncekiNotlar
              danisanId={randevu.client_id}
              seansId={randevu.id}
              seansBaslangici={randevu.baslangic}
              onSeansaGit={onSeansaGit}
              onGenislikDegisti={setOncekiGenis}
            />
          </div>
        )}
```

Modül başlığındaki "Sağ sütun: önceki notlar (Görev 8'de `OncekiNotlar`)" → "Sağ sütun: `OncekiNotlar` (N5-N9)".

`TakvimSekmesi.tsx`: `<SeansSayfasi …>`'ya `onSeansaGit={takvim.randevuyaGit}`.

`useSeansNotlari.ts`:
- `GECMIS_SEANS_SAYISI` ve belgesini SİL; `SeansVerisi` ve `BOS_SEANS`'tan `gecmisNotlar` kalkar.
- Ana efektte `const [gelenNot, gelenGecmis] = await Promise.all([...])` (içindeki "`once` ZORUNLU…" yorumuyla) → `const gelenNot = await notApi.notGetir(seansId)`; üstteki yorumun "İkisi birlikte: … sessiz bir yalan." paragrafı kalkar, "Özel not burada YOK…" paragrafı KALIR; `setSeansVerisi` çağrısından `gecmisNotlar: gelenGecmis` ve üstündeki "Bu seansın KENDİ notu geçmiş listesine girmez…" yorumu kalkar. Bağımlılıklar (`seansId`, `seansDanisanId`, `seansBaslangici`, `seansTazeleme`, `notSaati`) AYNEN (taşımada not yeniden okunur — A6).
- `notYansit`:

```ts
  const notYansit = useCallback(
    (id: number, yeni: SeansNotu) => {
      notSaati.yazmaBitti(id, yeni)
      setSeansVerisi((onceki) => (onceki.id === id ? { ...onceki, not: yeni } : onceki))
    },
    [notSaati],
  )
```

  ve belgesinden "Önceki seans notları listesinde bu seans varsa…" maddesi kalkar (önceki notlar paneli sayfa her açıldığında kendi listesini çeker; dosyada düzeltilen eski not takvime dönünce taze gelir).
- Kanca başlığı "resmî not + geçmiş notlar (panel açılışında)" → "resmî not (sayfa açılışında)".

`Remove-Item web/src/seans/GecmisNotlar.tsx, web/src/seans/GecmisNotlar.test.tsx` (`git rm` DEĞİL: silme commit adımındaki `git add` ile sahnelenir).

- [ ] **Adım 7: Test ikizlerini ve bütünleşik testleri güncelle**

- `TakvimSekmesi.test.tsx` `bosSeansAkisi`: `seans`'tan `gecmisNotlar: []` kalkar.
- `SeansSayfasi.test.tsx`: `akis()`'tan `gecmisNotlar` kalkar; `kur()`'a `onSeansaGit: vi.fn()`; dosyanın başına `const oncekiApi = vi.hoisted(() => ({ seanslar: vi.fn(), notGetir: vi.fn() }))`, var olan `vi.mock('../api', …)` dönüşüne `danisanApi: { ...gercek.danisanApi, seanslar: oncekiApi.seanslar }`, `notApi: { ...gercek.notApi, notGetir: oncekiApi.notGetir }` ekle; `beforeEach`'e `oncekiApi.seanslar.mockReset().mockResolvedValue([])` ve `oncekiApi.notGetir.mockReset()`. 7.9'daki `queryByRole('region', { name: 'Önceki seans notları' })).toBeNull()` aynen (hata varken sütun yok). 7.10'u şununla değiştir:

```tsx
  it('7.10 özel not önceki notlar sütununda HİÇBİR biçimde görünmez (özel sekme açık, eski not açılmış)', async () => {
    oncekiApi.seanslar.mockResolvedValue([{ appointment_id: 90, baslangic: '2026-08-31T10:00', durum: 'geldi', ucret_kurus: null, odendi: false, not_ilk_satiri: 'gecen hafta', etiketler: [] }])
    oncekiApi.notGetir.mockResolvedValue({ ...resmiNot, appointment_id: 90, icerik: '<p>gecen hafta</p>' })
    kur({ seansAkisi: akis({ ozelNot: { appointment_id: 101, icerik: GIZLI, guncelleme_zamani: 'z' } }) })
    await userEvent.click(screen.getByRole('tab', { name: 'Özel Notlarım' }))
    expect((screen.getByLabelText('Özel notum') as HTMLTextAreaElement).value).toBe(GIZLI)
    const sutun = screen.getByRole('region', { name: 'Önceki seans notları' })
    await userEvent.click(await within(sutun).findByRole('button', { name: /31 Ağustos 2026, 10:00/ }))
    await waitFor(() => expect(sutun.textContent).toContain('gecen hafta'))
    expect(sutun.textContent).not.toContain(GIZLI)
    expect(oncekiApi.notGetir).toHaveBeenCalledWith(90)
  })

  it('8.8 geniş okuma sütunu yarıya büyütür; editör AYNI düğüm kalır (yazılmamış metin kaybolmaz)', async () => {
    oncekiApi.seanslar.mockResolvedValue([{ appointment_id: 90, baslangic: '2026-08-31T10:00', durum: 'geldi', ucret_kurus: null, odendi: false, not_ilk_satiri: 'gecen hafta', etiketler: [] }])
    oncekiApi.notGetir.mockResolvedValue({ ...resmiNot, appointment_id: 90, icerik: '<p>gecen hafta</p>' })
    kur()
    const editor = screen.getByLabelText('Seans notu') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: '<p>yazılıyor</p>' } })
    const sutun = screen.getByRole('region', { name: 'Önceki seans notları' }).parentElement!
    expect(sutun.className).toContain('w-80')
    await userEvent.click(await screen.findByRole('button', { name: /31 Ağustos 2026, 10:00/ }))
    await waitFor(() => expect(sutun.className).toContain('w-1/2'))
    expect(screen.getByLabelText('Seans notu')).toBe(editor)
    expect(editor.value).toBe('<p>yazılıyor</p>')
  })
```

  (İçe aktarmalara `fireEvent`, `waitFor` eklenir.)
- `AnaEkran.test.tsx`:
  - `notYaniti`'nin `/api/danisanlar/\d+/notlar` dalını SİL (artık kimse istemiyor); dosya başındaki "Randevu seçilince panel üç istek daha atıyor…" yorumunu "Seans sayfası açılınca `.../not` istenir; `.../ozel-not` yalnızca özel sekmede; önceki notlar paneli `/api/danisanlar/{id}/seanslar`'ı (ve aramada `/not-ara`'yı) ister — `oncekiNotlarYaniti`" yap.
  - `notYaniti`'nin ALTINA ayrı bir yardımcı. `notYaniti`'ne EKLENMEZ: "danışan kartı ve hızlı arama" bloğu (L2904 → L2969) `notYaniti`'nden SONRA kendi `/seanslar` fikstürünü döndürüyor; oraya sızsaydı o bloğun seans listeleri `sunucuGecmisi`'nden gelirdi.

```ts
/**
 * Önceki notlar paneli (tasarım N5-N6) — sunucunun `danisan_seanslari` ve
 * `danisan_notlarinda_ara` taklidi, `sunucuGecmisi`'nden. Liste yeniden
 * eskiye ve KESMESİZ (kesme istemcinin işi: taklit kesseydi istemcideki
 * süzgecin yokluğu görünmezdi); arama sunucu gibi `once` ile keser.
 * Yalnızca seans sayfasını ölçen bloklar çağırır (Görev 9 ve Görev 10
 * blokları); diğer bloklarda istek var olan `/api/danisanlar` geri
 * dönüşüne düşer (dizi döner, istemci süzgeci hepsini eler).
 */
function oncekiNotlarYaniti(yol: string): Response | null {
  const seanslar = /^\/api\/danisanlar\/(\d+)\/seanslar$/.exec(yol)
  if (seanslar) {
    return jsonYanit(
      sunucuGecmisi
        .filter((n) => n.client_id === Number(seanslar[1]))
        .sort((a, b) => (a.seans_zamani < b.seans_zamani ? 1 : -1))
        .map((n) => ({
          appointment_id: n.appointment_id, baslangic: n.seans_zamani, durum: 'geldi', ucret_kurus: null,
          odendi: false, not_ilk_satiri: onizlemeTaklidi(n.icerik), etiketler: [],
        })),
    )
  }
  const ara = /^\/api\/danisanlar\/(\d+)\/not-ara\?(.*)$/.exec(yol)
  if (ara) {
    const q = new URLSearchParams(ara[2])
    const once = q.get('once') ?? '9999'
    const terim = (q.get('q') ?? '').toLocaleLowerCase('tr')
    return jsonYanit(
      sunucuGecmisi
        .filter((n) => n.client_id === Number(ara[1]) && n.seans_zamani < once && n.icerik.toLocaleLowerCase('tr').includes(terim))
        .map((n) => ({ appointment_id: n.appointment_id, seans_zamani: n.seans_zamani, parca: onizlemeTaklidi(n.icerik) })),
    )
  }
  return null
}
```

  - "seans paneli (Görev 9)" bloğunun `fetch`'inde (L1151) ve "seans bölümü, Güncelle ve kaydırma" bloğunun `fetch`'inde (L2077) `const notlar = notYaniti(…); if (notlar) return notlar` satırının hemen altına `const onceki = oncekiNotlarYaniti(yol); if (onceki) return onceki`. "seans geçişi × uçuştaki istek" bloğu (L2577) ya da başka bir blok bu isteği `beklenmeyen istek` diye fırlatıyorsa oraya da aynı satır.
  - Görev 9 bloğundaki `gecmisSunucuHatasi` dalı (L1137): `/\/notlar/.test(yol)` → `/\/seanslar$/.test(yol)` (bu dal `notYaniti`'nden ÖNCE; hata yanıtı yardımcıdan önce döner).
  - "gecmis liste bu seansin KENDI notunu icermez ve en fazla ucu gosterir" (L1476) → adı "önceki notlar paneli bu seansı İÇERMEZ, önceki HER seansı listeler, notları açılmadan İSTEMEZ"; testin başına `sunucuNotlari[90] = { sablon: 'dap', icerik: 'birinci gecmis' }`; `/notlar?limit=3` iddiası → `expect(istekler.filter((i) => /\/seanslar$/.test(i.yol))).toHaveLength(1)` ve `expect(istekler.some((i) => /\/randevular\/(88|89|90)\/not$/.test(i.yol))).toBe(false)`; `within(gecmis).getAllByRole('button')` → `await within(gecmis).findAllByRole('listitem')` `toHaveLength(3)`; son adım: `await userEvent.click(within(gecmis).getAllByRole('button')[0])` → `expect(await within(gecmis).findByText('birinci gecmis')).toBeDefined()` ve `expect(istekler.filter((i) => i.yol === '/api/randevular/90/not')).toHaveLength(1)`.
  - "gecmiste bir seans acilinca SONRAKI seanslarin notlari listelenmez" (L1519): `gecmisIstegi` ve `once=` iddiaları kalkar (kesme istemcide); testin başına `sunucuNotlari[88] = { sablon: 'dap', icerik: 'GERCEKTEN ONCEKI' }`; `getAllByRole('button')` (1) → `await within(gecmis).findAllByRole('listitem')` (1); satır açılınca `expect(await within(gecmis).findByText('GERCEKTEN ONCEKI')).toBeDefined()`; `document.body.textContent` `HENUZ YASANMAMIS` içermez (aynen).
  - "\"Geldi\" isaretlemek not isteklerini YENIDEN ATMAZ" ve "\"Ödendi\" isaretlemek YALNIZCA tek PATCH…": `/\/notlar/` sayımları → `expect(istekler.filter((i) => /\/seanslar$/.test(i.yol))).toHaveLength(1)`. (Görev 7 kuralı 7: blok `data-durum` iddiasından önce `Takvime dön`.)
  - "gecmis notlar yuklenemezse BOS LISTE gosterilmez" (L1971) → adı "önceki seanslar yüklenemezse BOŞ LİSTE gösterilmez; editör YİNE açılır"; iddialar: `(await screen.findByRole('alert')).textContent` `Gecmis notlar okunamadi.` içerir, `screen.queryByText('Bu seanstan önce kayıtlı seans yok.')` null, `expect(await screen.findByLabelText('Seans notu')).toBeDefined()` (eskiden `toBeNull()`: liste notla aynı `Promise.all`'daydı; artık ayrı istek, not yine açılır — tasarım N5'in doğrudan sonucu).
  - "10.4 …": `within(gecmis()).(query|get)AllByRole('button')` → `…AllByRole('listitem')`; bariyer yorumu "liste YENİ başlangıçla istemcide süzüldü (yeniden İSTENMEDİ); resmî not yeniden okundu" olur ve `waitFor(… listitem … 1)`'in altına `await waitFor(() => expect(notGetSayisi(randevuA.id)).toBe(2))`.
  - "10.5 …": adı "…; önceki liste YENİ başlangıçla süzülür, yeniden İSTENMEZ"; `button` → `listitem`; `gecmisIstekleri().at(-1)!.yol … once=` iddiası → `expect(istekler.filter((i) => /\/seanslar$/.test(i.yol))).toHaveLength(1)`. Bariyer (özel notu sıfırlayabilecek TEK çağrı, taşıma sonrası not yanıtının `setSeansVerisi`'si): `await waitFor(() => expect(notGetSayisi(randevuA.id)).toBe(2))` ve ardından `await act(() => new Promise<void>((r) => setTimeout(r, 0)))` (bu blokta yalnızca `Date` sahte; bir makro görev sınırı, yanıtın mikro görev zincirinin bitmesini bekler). `gecmisIstekleri` artık kullanılmıyorsa SİL.
  - Yeni bütünleşik test ("seans bölümü, Güncelle ve kaydırma" bloğu; inceleme odağı 4):

```ts
  it('8.9 "Bu seansa git" başka haftaya: giden editörün bekleyen metni YAZILIR, hedef seans o haftada açılır', async () => {
    const eskiSeans = { ...randevuA, id: 88, baslangic: '2026-08-31T10:00', bitis: '2026-08-31T11:00' }
    sunucuRandevulari = [...sunucuRandevulari, eskiSeans]
    sunucuGecmisi = [{
      appointment_id: 88, client_id: 1, seans_zamani: '2026-08-31T10:00',
      sablon: 'serbest', icerik: '<p>GECEN HAFTA NOTU</p>', guncelleme_zamani: ZAMAN,
    }]
    sunucuNotlari[88] = { sablon: 'serbest', icerik: '<p>GECEN HAFTA NOTU</p>' }
    await seansAc()
    await userEvent.type(screen.getByLabelText('Seans notu'), 'YARIM KALAN')
    const bolge = await screen.findByRole('region', { name: 'Önceki seans notları' })
    await userEvent.click(await within(bolge).findByRole('button', { name: /31 Ağustos 2026, 10:00/ }))
    await userEvent.click(await within(bolge).findByRole('button', { name: 'Bu seansa git' }))

    await waitFor(() =>
      expect((notYazmalari(randevuA.id).at(-1)?.govde as { icerik: string } | undefined)?.icerik).toContain('YARIM KALAN'),
    )
    await waitFor(() => expect(screen.getByRole('region', { name: 'Seans' }).textContent).toContain('31 Ağustos 2026, 10:00'))
    expect(haftaBasligi()).toContain('31 Ağustos')
    expect(notGetSayisi(88)).toBe(1)
    expect((screen.getByLabelText('Seans notu') as HTMLTextAreaElement).value).toBe('<p>GECEN HAFTA NOTU</p>')
  })
```

- `AnaEkran.yayilim.test.tsx`:
  - L434 `/api/danisanlar/(\d+)/notlar` dalını SİL (artık kimse istemiyor). L443 `/seanslar` dalı önceki notlar panelini de besler (aynen).
  - M4 testinde `toContain('Seans: 7 Eylül 2026, 10:00')` → `toContain('7 Eylül 2026, 10:00')`.
  - "dosyada ESKİ bir seansın notu düzeltilince…" testinin son satırı → `await waitFor(() => expect(gecmis.textContent).toContain('ilk hali duzeltildi'))` (not artık satır AÇILINCA istenir; eskiden liste notların kendisini taşıyordu). Takvime dönüşte sayfa yeniden kurulur, liste taze çekilir, satır açılınca taze not okunur; iddia metni aynen — geçmiyorsa kök nedeni yaz, iddiayı gevşetme. `gecmis` referansı geniş okumada da geçerli: `OncekiNotlar` iki görünümde de AYNI kök `<section>`'ı çizer.

- [ ] **Adım 8: Yeşili gör** — web/: `npx vitest run` → PASS; `npm --prefix web run build`; `npm --prefix web run lint`.

- [ ] **Adım 9: E2E** — `npx playwright test --reporter=line` → PASS (önceki notlar paneli yeni senaryolarını Görev 10 ekler; burada var olan akışların bozulmadığı ölçülür).

- [ ] **Adım 10: Commit**

```bash
git add web/src/seans/okumaPenceresi.ts web/src/seans/OncekiNotlar.tsx web/src/seans/OncekiNotlar.test.tsx web/src/seans/SeansSayfasi.tsx web/src/seans/SeansSayfasi.test.tsx web/src/takvim/TakvimSekmesi.tsx web/src/takvim/TakvimSekmesi.test.tsx web/src/screens/anaEkranKancalari/useSeansNotlari.ts web/src/istemciRaporUretimi.test.ts web/src/screens/AnaEkran.test.tsx web/src/screens/AnaEkran.yayilim.test.tsx web/src/seans/GecmisNotlar.tsx web/src/seans/GecmisNotlar.test.tsx
git commit -m "Seans sayfasi: onceki notlar paneli, arama, genis okuma, yeni pencere

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Mutasyonlar:**
- `oncekiler` süzgecinde `<` → `<=` → 8.1 ("BU SEANS" göründü) kırılır.
- `aramaEtkin` eşiğini `>= 1` yap → 8.2 (tek harf istek attı) kırılır.
- `satiriAc`'taki "notu yazılmamış seans: istek YOK" dönüşünü sil → 8.5 kırılır.
- `NotOkuma`'ya `vurgu` geçirme (`vurgu=""`) → 8.4 kırılır.
- `okumaPenceresi.ts`'te adresi `/?okuma=${randevuId}&x=1` yap → yapısal istisna testi kırılır; aynı çağrıyı `OncekiNotlar.tsx`'e kopyala → "pano / yazdirma / yeni pencere" testi kırılır.
- `randevuyaGit`'ten `panelKapat()`'ı sil → 8.9 (bekleyen metin yazılmadı ya da eski sayfa kaldı) kırılır.

---

### Task 9: Okuma penceresi (spec §8 P1, P2, P4, P6)

**Files:**
- Modify: `web/src/seans/okumaPenceresi.ts` (`okumaKimligi`)
- Create: `web/src/seans/okumaPenceresi.test.ts`
- Create: `web/src/screens/OkumaPenceresi.tsx`, `web/src/screens/OkumaPenceresi.test.tsx`
- Modify: `web/src/App.tsx` (içe aktarmalar, `okumaId` state'i, yoklama efekti, render dalı), `web/src/App.test.tsx`

**Interfaces:**
- Produces: `export function okumaKimligi(arama: string): number | null` — `?okuma=` değeri `^[1-9]\d{0,14}$` ise sayı, değilse `null`.
- Produces: `export const OKUMA_YOKLAMA_MS = 5_000` (`App.tsx`) ve `export function OkumaPenceresi({ randevuId }: { randevuId: number }): JSX.Element`.
- Davranış: `App`, `?okuma=<id>` görünce kilit açıkken `AnaEkran` YERİNE `OkumaPenceresi`'ni çizer ve oturum açık olduğu sürece `/api/durum`'u 5 sn'de bir sorar (bu uç oturuma dokunmaz, denetim satırı yazmaz); kilitliyse bugünkü akışla `KilitEkrani` (içerik unmount). Parametresiz ana pencerede yoklama YOK. Not okuması `notApi.notGetir` — bugünkü tek `Goruntuleme | progress_note | <id>` satırı (P6), fazlası değil.

- [ ] **Adım 1: Başarısız testleri yaz**

`web/src/seans/okumaPenceresi.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { okumaKimligi } from './okumaPenceresi'

describe('okumaKimligi (tasarım P2)', () => {
  it('geçerli kimlik', () => {
    expect(okumaKimligi('?okuma=42')).toBe(42)
    expect(okumaKimligi('?okuma=1')).toBe(1)
  })
  it('geçersiz ya da yok -> null (ana ekran)', () => {
    for (const a of ['', '?', '?okuma=', '?okuma=0', '?okuma=007', '?okuma=-1', '?okuma=1.5', '?okuma=abc', '?okuma=1234567890123456', '?baska=4']) {
      expect(okumaKimligi(a), a).toBeNull()
    }
  })
})
```

`web/src/screens/OkumaPenceresi.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IstekHatasi, type SeansNotu } from '../api'
import { OkumaPenceresi } from './OkumaPenceresi'

const t = vi.hoisted(() => ({ notGetir: vi.fn() }))
vi.mock('../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../api')>()
  return { ...gercek, notApi: { ...gercek.notApi, notGetir: t.notGetir } }
})

const not: SeansNotu = {
  appointment_id: 42, client_id: 1, danisan_adi: 'Ayşe Yılmaz', seans_zamani: '2026-09-07T10:00',
  sablon: 'serbest', icerik: '<p>OKUMA <strong>KANARYA</strong></p>', onizleme: 'OKUMA KANARYA',
  guncelleme_zamani: 'z',
}

beforeEach(() => t.notGetir.mockReset())

describe('OkumaPenceresi (tasarım P1)', () => {
  it('9.1 başlıkta danışan adı ve tarih-saat; not salt okunur; düzenleme/özel not/durum YOK; pencere başlığı ad taşımaz', async () => {
    t.notGetir.mockResolvedValue(not)
    const onceki = document.title
    render(<OkumaPenceresi randevuId={42} />)
    const baslik = await screen.findByRole('heading', { level: 1 })
    expect(baslik.textContent).toContain('Ayşe Yılmaz')
    expect(baslik.textContent).toContain('7 Eylül 2026, 10:00')
    expect(screen.getByText('KANARYA').tagName).toBe('STRONG')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(t.notGetir).toHaveBeenCalledTimes(1)
    expect(t.notGetir).toHaveBeenCalledWith(42)
    expect(document.title).toBe(onceki)
  })

  it('9.2 olmayan seans (404) anlaşılır mesaj; boş not "yazılmamış" der', async () => {
    t.notGetir.mockRejectedValueOnce(new IstekHatasi('Kayıt bulunamadı.', 404))
    const { unmount } = render(<OkumaPenceresi randevuId={7} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Bu seans bulunamadı')
    unmount()
    t.notGetir.mockResolvedValueOnce({ ...not, icerik: '' })
    render(<OkumaPenceresi randevuId={42} />)
    expect(await screen.findByText('Bu seans için not yazılmamış.')).toBeDefined()
  })
})
```

`web/src/App.test.tsx` sonuna:

```tsx
describe('App — okuma penceresi (tasarım P2, P4)', () => {
  const gercekFetch = globalThis.fetch
  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = gercekFetch
    window.history.replaceState({}, '', '/')
    vi.restoreAllMocks()
  })

  function sunucu(kilitli: () => boolean) {
    const cagrilar: string[] = []
    globalThis.fetch = vi.fn(async (girdi: RequestInfo | URL) => {
      const yol = typeof girdi === 'string' ? girdi : girdi.toString()
      cagrilar.push(yol)
      if (yol.startsWith('/api/durum')) {
        return { ok: true, json: async () => ({ kurulum_gerekli: false, kilitli: kilitli(), keystore_bozuk: false, veri_dizini: '/veri' }) } as unknown as Response
      }
      if (yol === '/api/randevular/42/not') {
        return {
          ok: true,
          json: async () => ({
            appointment_id: 42, client_id: 1, danisan_adi: 'Ayşe Yılmaz', seans_zamani: '2026-09-07T10:00',
            sablon: 'serbest', icerik: '<p>OKUMA-KANARYA</p>', onizleme: 'OKUMA-KANARYA', guncelleme_zamani: 'z',
          }),
        } as unknown as Response
      }
      if (yol.startsWith('/api/danisanlar') || yol.startsWith('/api/randevular')) {
        return { ok: true, json: async () => [] } as unknown as Response
      }
      throw new Error(`beklenmeyen istek: ${yol}`)
    }) as unknown as typeof fetch
    return cagrilar
  }
  const durumSayisi = (c: string[]) => c.filter((y) => y.startsWith('/api/durum')).length

  it('9.3 ?okuma=<id> ana ekranı ÇİZMEZ; yalnızca o not istenir', async () => {
    window.history.replaceState({}, '', '/?okuma=42')
    const cagrilar = sunucu(() => false)
    render(<App />)
    expect(await screen.findByText('OKUMA-KANARYA')).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Terapi Notları' })).toBeNull()
    expect(cagrilar.filter((y) => !y.startsWith('/api/durum'))).toEqual(['/api/randevular/42/not'])
  })

  it('9.4 P4: kilitlenince en geç 5 sn içinde not ve danışan adı ekrandan KALKAR, kilit ekranı gelir', async () => {
    window.history.replaceState({}, '', '/?okuma=42')
    let kilitli = false
    const cagrilar = sunucu(() => kilitli)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    render(<App />)
    expect(await screen.findByText('OKUMA-KANARYA')).toBeDefined()
    kilitli = true
    const once = durumSayisi(cagrilar)
    // Düz sayı, sabit DEĞİL: tasarım P4 "en geç 5 saniye"; sabit büyütülürse bu test kırılır.
    await act(() => vi.advanceTimersByTimeAsync(4_999))
    expect(durumSayisi(cagrilar)).toBe(once)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(await screen.findByRole('heading', { name: 'Kilitli' })).toBeDefined()
    expect(document.body.textContent).not.toContain('OKUMA-KANARYA')
    expect(document.body.textContent).not.toContain('Ayşe Yılmaz')
  })

  it('9.5 ana pencerede (parametresiz) durum 5 sn\'de bir YOKLANMAZ', async () => {
    const cagrilar = sunucu(() => false)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Terapi Notları' })).toBeDefined()
    const once = durumSayisi(cagrilar)
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    expect(durumSayisi(cagrilar)).toBe(once)
  })
})
```

(Sabit App.tsx'ten dışa aktarılır ama test onu İÇE AKTARMAZ: iddia tasarımın sayısını ölçer.)

- [ ] **Adım 2: Kırmızıyı gör** — web/: `npx vitest run src/seans/okumaPenceresi.test.ts src/screens/OkumaPenceresi.test.tsx src/App.test.tsx` → `okumaKimligi`/`OkumaPenceresi` yok; 9.3 ana ekranı çizer, 9.4 kilitte içerik kalır.

- [ ] **Adım 3: Kodu yaz**

`web/src/seans/okumaPenceresi.ts`'e (başlık yorumundaki "okuyan yarı Görev 9'da" cümlesini "okuyan yarı `okumaKimligi`, `App.tsx`'te" yap):

```ts
/**
 * `?okuma=<id>` (tasarım P2): pozitif tam sayı, başında sıfır yok, en fazla
 * 15 hane (güvenli tam sayı); değilse `null` — pencere ana ekranı çizer.
 */
export function okumaKimligi(arama: string): number | null {
  const deger = new URLSearchParams(arama).get('okuma')
  if (deger === null || !/^[1-9]\d{0,14}$/.test(deger)) return null
  return Number(deger)
}
```

`web/src/screens/OkumaPenceresi.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { IstekHatasi, notApi, YetkisizHata, type SeansNotu } from '../api'
import { NotOkuma } from '../not/NotOkuma'
import { zamanMetni } from '../tarih'

/**
 * Okuma penceresi (tasarım §8 P1): tek bir seansın RESMÎ notu, salt okunur.
 * Düzenleme, özel not, etiket, ödeme, durum ve seansa geçiş YOK; pencereler
 * arası mesaj yolu kurulmaz — pencere yalnızca bakmak için.
 *
 * - Not `notApi.notGetir` ile okunur: bir notun okunmasının bugün yazdığı
 *   `Goruntuleme | progress_note | <id>` satırı (P6), fazlası değil. Danışan
 *   adı yanıttan (`SeansNotu.danisan_adi`, S5b): ayrı danışan isteği yok.
 * - Başlık sayfanın İÇİNDE. `document.title` ve Tauri pencere başlığı
 *   danışan adı TAŞIMAZ (pencere listelerinde, ekran paylaşımında görünür).
 * - Kilit (P4): `App` durumu 5 sn'de bir sorar; kilitliyse bu bileşeni
 *   gerçekten kaldırır. Bir 401 de merkezi dinleyiciyle aynı yere gider.
 */
type Durum = { tur: 'yukleniyor' } | { tur: 'hazir'; not: SeansNotu } | { tur: 'hata'; mesaj: string }

export function OkumaPenceresi({ randevuId }: { randevuId: number }) {
  const [durum, setDurum] = useState<Durum>({ tur: 'yukleniyor' })

  useEffect(() => {
    let iptal = false
    notApi.notGetir(randevuId).then(
      (not) => {
        if (!iptal) setDurum({ tur: 'hazir', not })
      },
      (e: unknown) => {
        if (iptal || e instanceof YetkisizHata) return
        setDurum({
          tur: 'hata',
          mesaj:
            e instanceof IstekHatasi && e.durum === 404
              ? 'Bu seans bulunamadı; silinmiş olabilir.'
              : e instanceof Error
                ? e.message
                : 'Not yüklenemedi.',
        })
      },
    )
    return () => {
      iptal = true
    }
  }, [randevuId])

  return (
    <main className="mx-auto max-w-3xl p-6">
      {durum.tur === 'yukleniyor' && <p className="text-slate-500">Not yükleniyor…</p>}
      {durum.tur === 'hata' && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">
          {durum.mesaj}
        </p>
      )}
      {durum.tur === 'hazir' && (
        <article aria-labelledby="okuma-basligi">
          <h1 id="okuma-basligi" className="text-xl font-semibold text-slate-900">
            {durum.not.danisan_adi}{' '}
            <span className="font-normal text-slate-600">· {zamanMetni(durum.not.seans_zamani)}</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">Salt okunur</p>
          <div className="mt-4 rounded border border-slate-200">
            {durum.not.icerik === '' ? (
              <p className="p-3 text-slate-600">Bu seans için not yazılmamış.</p>
            ) : (
              <NotOkuma html={durum.not.icerik} />
            )}
          </div>
        </article>
      )}
    </main>
  )
}
```

`web/src/App.tsx`:
- İçe aktarmalar: `import { OkumaPenceresi } from './screens/OkumaPenceresi'`, `import { okumaKimligi } from './seans/okumaPenceresi'`.
- Bileşenin üstüne:

```ts
/** Okuma penceresinin kilit yoklama aralığı (tasarım P4: içerik en geç 5 sn'de kalkar). */
export const OKUMA_YOKLAMA_MS = 5_000
```

- `App()` içinde ilk satırlardan biri: `const [okumaId] = useState(() => okumaKimligi(window.location.search))` (yorum: "Tasarım P2: adres bir kez okunur; okuma penceresi ana ekranı HİÇ çizmez").
- `useBostaKalmaKontrolu(oturumAcik, yenile)`'nin altına:

```ts
  // Tasarım P4: okuma penceresi hiç istek atmadan açık kalabilir; ana
  // pencerede "Kilitle" ya da boşta kalma kilidi buraya ancak bir 401 ile
  // ulaşırdı. `/api/durum` 5 sn'de bir sorulur (oturuma DOKUNMAZ, denetim
  // satırı yazmaz); kilitliyse aşağıdaki koşullu render içeriği unmount eder.
  // Ana pencere yoklamaz: orada her istek zaten 401 yoluyla kilide götürür.
  useEffect(() => {
    if (okumaId === null || !oturumAcik) return
    const zamanlayici = setInterval(() => {
      void yenile()
    }, OKUMA_YOKLAMA_MS)
    return () => clearInterval(zamanlayici)
  }, [okumaId, oturumAcik, yenile])
```

- Render: `if (durum.kilitli) return <KilitEkrani …/>` satırının altına `if (okumaId !== null) return <OkumaPenceresi randevuId={okumaId} />`.

- [ ] **Adım 4: Yeşili gör** — `npx vitest run src/seans/okumaPenceresi.test.ts src/screens/OkumaPenceresi.test.tsx src/App.test.tsx` → PASS; `npx vitest run` → PASS; `npm --prefix web run build`; `npm --prefix web run lint`.

- [ ] **Adım 5: E2E** — `npx playwright test --reporter=line` → PASS (okuma penceresinin uçtan uca senaryosu Görev 10'da).

- [ ] **Adım 6: Commit**

```bash
git add web/src/seans/okumaPenceresi.ts web/src/seans/okumaPenceresi.test.ts web/src/screens/OkumaPenceresi.tsx web/src/screens/OkumaPenceresi.test.tsx web/src/App.tsx web/src/App.test.tsx
git commit -m "Okuma penceresi: ?okuma= salt okunur not, 5 sn'de kilit yoklamasi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Mutasyonlar:**
- Yoklama efektinden `okumaId === null ||` koşulunu sil → 9.5 kırılır.
- `OKUMA_YOKLAMA_MS`'i 60_000 yap → 9.4 kırılır (test düz 5 000 ms ilerletir); 4_000 yap → 9.4'ün "4 999 ms'de henüz sorulmadı" iddiası kırılır.
- `if (okumaId !== null) return <OkumaPenceresi …/>` satırını `if (durum.kilitli)`'nin ÜSTÜNE taşı → 9.4 (kilitte içerik kaldı) kırılır.
- `OkumaPenceresi`'nde `useEffect` yerine her render'da `notGetir` → 9.1 (`toHaveBeenCalledTimes(1)`) kırılır.

---

### Task 10: Uçtan uca editör ve okuma senaryoları (spec §11, E5, E6, E10, E11, S7, N6–N9, P2–P4)

**Files:**
- Create: `e2e/editor.spec.ts`
- Modify: `playwright.config.ts` (`SUNUCULAR`'a `editor`, port 7708)

**Interfaces:**
- Consumes: bütün önceki görevlerin arayüzü — blok adı `"SS:DD Ad"` (+ durum eki, Görev 1), ProseMirror öğesi `aria-label="Seans notu"` (Görev 4–5), `Takvime dön` (Görev 7), bölge "Önceki seans notları", arama kutusu "Önceki notlarda ara", "Listeye dön", "Bu seansa git", menü öğesi "Yeni pencerede aç" (Görev 8), `?okuma=<id>` ve 5 sn yoklama (Görev 9).
- Produces: yok (yalnızca test). Dosyanın testleri sırayla ve aynı sunucuda koşar; her test kendi danışanını ve kendi saatlerini kullanır. Kilitleyen test EN SONDA (sonraki testin kilit açma maliyeti olmasın).

- [ ] **Adım 1: Projeyi kaydet** (`playwright.config.ts`, `SUNUCULAR`'ın sonuna)

```ts
  // Seans notu sayfası ve biçimli editör (tasarım 2026-09-26 §11): biçim
  // kalıcılığı, Türkçe Q kısayolu, yapıştırma temizliği, önceki notlarda
  // arama + geniş okuma, dış bağlantı, okuma penceresi ve kilit.
  { ad: 'editor', spec: 'editor.spec.ts', port: 7708 },
```

- [ ] **Adım 2: Testleri yaz** (`e2e/editor.spec.ts`)

```ts
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { kurulumYap } from './yardimcilar'

/**
 * Seans notu sayfası ve biçimli editörün uçtan uca doğrulaması (tasarım
 * 2026-09-26 §11). Birim testler not yüzeyini jsdom'da bir `<textarea>`
 * test yüzeyiyle sürer (`test-kurulum.ts`); GERÇEK TipTap/ProseMirror'un
 * tarayıcıdaki davranışı — girdi kuralları, klavye eşlemesi, yapıştırma
 * ayrıştırması, bağlantı tıklaması, `window.open` — yalnızca burada ölçülür.
 *
 * # Paylaşılan sunucu durumu — saat seçimi
 *
 * Bu dosya kendi sunucusunda ve kendi veri dizininde koşar (port 7708).
 * Testler aynı sunucuyu paylaşır ve sırayla koşar; her test kendi danışanını
 * ve kendi saatlerini kullanır. "Önceki seans" gerektiren testlerde iki
 * randevu da haftanın İLK boş gününe düşer (`.first()`), yani aynı güne;
 * erken saat "önceki"dir.
 *
 * # Dış bağlantı ağa ÇIKMAZ
 *
 * `ornek.invalid` hiçbir zaman çözülmeyen ayrılmış bir alan adı ve her test
 * bağlamında `context.route` ile yerelde karşılanır: test bir yeni sekme
 * açıldığını ölçer, internete istek atmaz.
 */

test.beforeEach(async ({ context }) => {
  await context.route('https://ornek.invalid/**', (istek) =>
    istek.fulfill({ status: 200, contentType: 'text/html', body: '<p>dis</p>' }),
  )
})

/** Otomatik kaydın "sunucuya yazıldı" göstergesi (bkz. `notlar.spec.ts`). */
async function kaydedildiBekle(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Kaydedildi \d{2}:\d{2}$/ })).toBeVisible()
}

/** Danışan ekler ve Takvim sekmesine döner. */
async function danisanEkle(page: Page, ad: string) {
  await page.getByRole('tab', { name: 'Danışanlar', exact: true }).click()
  await page.getByRole('button', { name: 'Danışan ekle' }).click()
  await page.getByLabel('Ad soyad').fill(ad)
  await page.getByRole('button', { name: 'Ekle', exact: true }).click()
  await expect(page.getByText(ad, { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: 'Takvim', exact: true }).click()
}

/** Izgaradaki blok (blok adı `SS:DD Ad`; durumsuz randevuda ek yok). */
function blokBul(page: Page, ad: string, saat: string): Locator {
  return page.getByTestId('takvim-izgara').getByRole('button', { name: `${saat} ${ad}`, exact: true })
}

/** Haftanın ilk boş gününde verilen saate randevu kurar, bloğu döndürür. */
async function randevuKur(page: Page, ad: string, saat: string): Promise<Locator> {
  await page.locator(`button[aria-label$="${saat} boş"]`).first().click()
  await page.getByLabel('Danışan', { exact: true }).selectOption({ label: ad })
  await page.getByRole('button', { name: 'Kaydet' }).click()
  const blok = blokBul(page, ad, saat)
  await expect(blok).toBeVisible()
  return blok
}

/** Bloğa tıklar; not sayfası ızgaranın yerine açılır. Editörü döndürür. */
async function seansiAc(page: Page, blok: Locator): Promise<Locator> {
  await blok.click()
  const alan = page.getByLabel('Seans notu', { exact: true })
  await expect(alan).toBeVisible()
  return alan
}

async function takvimeDon(page: Page) {
  await page.getByRole('button', { name: 'Takvime dön', exact: true }).click()
  await expect(page.getByTestId('takvim-izgara')).toBeVisible()
}

/** İmlecin solundaki sözcüğü klavyeyle seçer (macOS'ta Option, diğerlerinde Ctrl). */
async function oncekiSozcuguSec(page: Page) {
  await page.keyboard.press(process.platform === 'darwin' ? 'Alt+Shift+ArrowLeft' : 'Control+Shift+ArrowLeft')
}

/**
 * Editöre HTML yapıştırır: gerçek bir `paste` olayı, `text/html` taşıyan
 * `DataTransfer` ile. ProseMirror yapıştırmayı `clipboardData`'dan okur;
 * sistem panosuna dokunulmaz.
 */
async function htmlYapistir(alan: Locator, html: string) {
  await alan.click()
  await alan.evaluate((el, html) => {
    const veri = new DataTransfer()
    veri.setData('text/html', html)
    veri.setData('text/plain', html.replace(/<[^>]*>/g, ''))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: veri, bubbles: true, cancelable: true }))
  }, html)
}

async function randevuKimligi(request: APIRequestContext, ad: string, saat: string): Promise<number> {
  const yanit = await request.get('/api/randevular?baslangic=2000-01-01T00:00&bitis=2100-01-01T00:00')
  expect(yanit.status()).toBe(200)
  const liste: Array<{ id: number; danisan_adi: string; baslangic: string }> = await yanit.json()
  const bulunan = liste.find((r) => r.danisan_adi === ad && r.baslangic.slice(11, 16) === saat)
  expect(bulunan, `${ad} ${saat}`).toBeDefined()
  return bulunan!.id
}

async function sunucuNotu(request: APIRequestContext, id: number): Promise<string> {
  const yanit = await request.get(`/api/randevular/${id}/not`)
  expect(yanit.status()).toBe(200)
  return ((await yanit.json()) as { icerik: string }).icerik
}

// ---------------------------------------------------------------------------

test('bicim kalici: "## " basliga, Ctrl/Cmd+B kalina doner; isaret ne ekranda ne sunucuda', async ({ page, request }) => {
  await kurulumYap(page)
  const ad = 'Aylin Korkmaz'
  await danisanEkle(page, ad)
  const alan = await seansiAc(page, await randevuKur(page, ad, '09:00'))

  await alan.click()
  await page.keyboard.type('## Gözlem')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Danışan bugün KALIN30')
  await oncekiSozcuguSec(page)
  await page.keyboard.press('ControlOrMeta+b')

  await expect(alan.locator('h2')).toHaveText('Gözlem')
  await expect(alan.locator('strong')).toHaveText('KALIN30')
  await expect(alan).not.toContainText('##')
  await expect(alan).not.toContainText('**')
  await kaydedildiBekle(page)

  const icerik = await sunucuNotu(request, await randevuKimligi(request, ad, '09:00'))
  expect(icerik).toContain('<h2>Gözlem</h2>')
  expect(icerik).toContain('<strong>KALIN30</strong>')
  expect(icerik).not.toContain('##')
  expect(icerik).not.toContain('**')

  await page.reload()
  await kurulumYap(page)
  const yeniden = await seansiAc(page, blokBul(page, ad, '09:00'))
  await expect(yeniden.locator('h2')).toHaveText('Gözlem')
  await expect(yeniden.locator('strong')).toHaveText('KALIN30')
})

test('Turkce Q: I tusu "ı" uretse de Ctrl/Cmd+I italik yapar (keyCode dusumu, tasarim E5)', async ({ page }) => {
  await kurulumYap(page)
  const ad = 'Burcu Işık'
  await danisanEkle(page, ad)
  const alan = await seansiAc(page, await randevuKur(page, ad, '10:00'))
  await alan.click()
  await page.keyboard.type('Danışan anlattı EGIK31')
  await oncekiSozcuguSec(page)

  // Türkçe Q'da I tuşu `key: 'ı'` üretir; `Mod-i` eşlemesi `key`le bulunamaz.
  // ProseMirror'un tuş haritası ASCII olmayan `key`de `keyCode`'a (73 = I)
  // düşer. Playwright'ın klavyesi düzen seçemediği için olay elle kurulur.
  await alan.evaluate((el, mac) => {
    const olay = new KeyboardEvent('keydown', {
      key: 'ı', code: 'KeyI', ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true,
    })
    Object.defineProperty(olay, 'keyCode', { get: () => 73 })
    el.dispatchEvent(olay)
  }, process.platform === 'darwin')

  await expect(alan.locator('em')).toHaveText('EGIK31')
  await expect(alan).toHaveText('Danışan anlattı EGIK31')
})

test('yapistirma: gorsel, betik, cerceve ve olay ozniteligi duser; sunucudaki HTML temiz (tasarim E11)', async ({ page, request }) => {
  await kurulumYap(page)
  const ad = 'Cem Kaya'
  await danisanEkle(page, ad)
  const alan = await seansiAc(page, await randevuKur(page, ad, '11:00'))

  await htmlYapistir(
    alan,
    '<p>YAPISTIR32 <b>kalin</b></p><img src="/yok.png" onerror="window.__xss = 1">' +
      '<script>window.__xss = 2</script><p onclick="window.__xss = 3">tikla</p>' +
      '<iframe src="https://ornek.invalid/cerceve"></iframe>',
  )
  await expect(alan.locator('strong')).toHaveText('kalin')
  await expect(alan).toContainText('tikla')
  await expect(alan.locator('img, script, iframe, [onclick], [onerror]')).toHaveCount(0)
  await alan.getByText('tikla').click()
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  await kaydedildiBekle(page)

  const icerik = await sunucuNotu(request, await randevuKimligi(request, ad, '11:00'))
  expect(icerik).toContain('YAPISTIR32')
  expect(icerik).toContain('<strong>kalin</strong>')
  for (const yasak of ['<img', '<script', '<iframe', 'onclick', 'onerror', '__xss', 'ornek.invalid']) {
    expect(icerik, yasak).not.toContain(yasak)
  }
})

test('onceki notlarda arama Turkce harf duyarsiz; genis okumada vurgulu; "Bu seansa git" o seansi acar (N6-N8)', async ({ page, request }) => {
  await kurulumYap(page)
  const ad = 'Deniz Şahin'
  const eskiNot = 'Danışan KAYGI anlattı; kaygı azaldı. ARAMA33'
  await danisanEkle(page, ad)
  const onceki = await seansiAc(page, await randevuKur(page, ad, '12:00'))
  await onceki.fill(eskiNot)
  await kaydedildiBekle(page)
  await takvimeDon(page)

  const alan = await seansiAc(page, await randevuKur(page, ad, '15:00'))
  await alan.fill('Bu seansin YARIM33 metni')
  const bolge = page.getByRole('region', { name: 'Önceki seans notları' })
  const darGenislik = (await bolge.boundingBox())!.width

  await bolge.getByRole('searchbox', { name: 'Önceki notlarda ara' }).fill('kaygi')
  const satirlar = bolge.getByRole('listitem')
  await expect(satirlar).toHaveCount(1)
  await expect(satirlar.locator('mark').first()).toHaveText('KAYGI')

  await satirlar.getByRole('button').click()
  await expect(bolge.locator('.not-vurgu')).toHaveText(['KAYGI', 'kaygı'])
  // N7: sütun sayfanın yarısına büyür; bu seansın editörü ve yazılanı yerinde.
  await expect.poll(async () => (await bolge.boundingBox())!.width).toBeGreaterThan(darGenislik * 1.5)
  await expect(alan).toHaveText('Bu seansin YARIM33 metni')

  await bolge.getByRole('button', { name: 'Bu seansa git' }).click()
  await expect(page.getByRole('region', { name: 'Seans', exact: true })).toContainText(', 12:00')
  await expect(page.getByLabel('Seans notu', { exact: true })).toHaveText(eskiNot)
  // Giden seansın yazılanı kaybolmadı (tahliye ya da otomatik kayıt).
  const id15 = await randevuKimligi(request, ad, '15:00')
  await expect.poll(() => sunucuNotu(request, id15)).toContain('YARIM33')
})

test('dis baglanti: editorde tiklamak gezinmez; okuma gorunumunde yeni sekmede acilir, uygulama yerinde kalir', async ({ page, context, request }) => {
  await kurulumYap(page)
  const ad = 'Fikret Oral'
  await danisanEkle(page, ad)
  const onceki = await seansiAc(page, await randevuKur(page, ad, '14:00'))
  await htmlYapistir(onceki, '<p>Kaynak BAGLANTI34: <a href="https://ornek.invalid/makale">makale</a></p>')
  const editordeki = onceki.getByRole('link', { name: 'makale' })
  await expect(editordeki).toHaveAttribute('href', 'https://ornek.invalid/makale')
  await kaydedildiBekle(page)
  const icerik = await sunucuNotu(request, await randevuKimligi(request, ad, '14:00'))
  expect(icerik).toContain('href="https://ornek.invalid/makale"')
  expect(icerik).toContain('noopener')

  const adres = page.url()
  // EKSİ YÖN için SINIRLI pencere: tıkta açılan bir sekme (`window.open` ya da
  // yerli `target=_blank`) aynı tıkın içinde doğar ve 2 sn içinde `page`
  // olayı üretir. Sabit bekleme değil: olay gelirse hemen kırılır.
  const acilanSekme = context.waitForEvent('page', { timeout: 2_000 }).then(() => true, () => false)
  await editordeki.click()
  expect(await acilanSekme).toBe(false)
  expect(page.url()).toBe(adres)
  // Tık bağlantıyı AÇMADI ama işlendi: seçim bağlantıda (E10: editörde bağlantı düzenlenir).
  // TipTap editör örneğini ProseMirror kök öğesine `editor` olarak asar.
  const baglantidaMi = () =>
    onceki.evaluate((el) => (el as unknown as { editor: { isActive: (ad: string) => boolean } }).editor.isActive('link'))
  await expect.poll(baglantidaMi).toBe(true)

  await takvimeDon(page)
  await seansiAc(page, await randevuKur(page, ad, '17:00'))
  const bolge = page.getByRole('region', { name: 'Önceki seans notları' })
  await bolge.getByRole('button', { name: /, 14:00/ }).click()
  const [dis] = await Promise.all([
    context.waitForEvent('page'),
    bolge.getByRole('link', { name: 'makale' }).click(),
  ])
  await dis.waitForURL('https://ornek.invalid/makale')
  expect(page.url()).toBe(adres)
  await expect(page.getByLabel('Seans notu', { exact: true })).toBeVisible()
  await dis.close()
})

test('okuma penceresi kilitte icerigi kaldirir: sag tik "Yeni pencerede ac", salt okunur, ayni seans ayni pencere (P2-P4)', async ({ page, context }) => {
  await kurulumYap(page)
  const ad = 'Ece Yurt'
  const kanarya = 'PENCERE35 eski seansin notu'
  await danisanEkle(page, ad)
  const onceki = await seansiAc(page, await randevuKur(page, ad, '13:00'))
  await onceki.fill(kanarya)
  await kaydedildiBekle(page)
  await takvimeDon(page)
  await seansiAc(page, await randevuKur(page, ad, '16:00'))

  const bolge = page.getByRole('region', { name: 'Önceki seans notları' })
  const satir = bolge.getByRole('button', { name: /, 13:00/ })
  await satir.click({ button: 'right' })
  const [pencere] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('menuitem', { name: 'Yeni pencerede aç' }).click(),
  ])
  await expect(pencere).toHaveURL(/\/\?okuma=\d+$/)
  await expect(pencere.getByRole('heading', { level: 1 })).toContainText(ad)
  await expect(pencere.getByText(kanarya)).toBeVisible()
  await expect(pencere.getByRole('textbox')).toHaveCount(0)
  await expect(pencere.getByRole('button')).toHaveCount(0)
  expect(await pencere.title()).not.toContain(ad)
  // Ana pencere yerinde: aynı seans sayfası açık, geniş okumaya geçilmedi.
  await expect(page.getByLabel('Seans notu', { exact: true })).toBeVisible()
  await expect(bolge.getByRole('button', { name: 'Listeye dön' })).toHaveCount(0)

  // P3: aynı seans ikinci kez (Cmd/Ctrl+tık) istenince AYNI pencere kullanılır.
  const sayfaSayisi = context.pages().length
  await Promise.all([pencere.waitForEvent('framenavigated'), satir.click({ modifiers: ['ControlOrMeta'] })])
  await expect(pencere.getByText(kanarya)).toBeVisible()
  expect(context.pages()).toHaveLength(sayfaSayisi)

  // P4: ana pencerede Kilitle -> okuma penceresi 5 sn'lik yoklamayla kilit ekranına.
  await page.getByRole('button', { name: 'Kilitle' }).click()
  await expect(page.getByRole('heading', { name: 'Kilitli' })).toBeVisible()
  // 5 sn yoklama + istek ve çizim payı; genel 15 sn bütçesinden BİLEREK dar.
  await expect(pencere.getByRole('heading', { name: 'Kilitli' })).toBeVisible({ timeout: 7_000 })
  await expect(pencere.getByText(kanarya)).toHaveCount(0)
  await expect(pencere.getByText(ad)).toHaveCount(0)
  await pencere.close()
})
```

- [ ] **Adım 3: Koş ve yeşili gör** — depo kökünden, PowerShell, PATH önekiyle: `npx playwright test e2e/editor.spec.ts --reporter=line` → 6 passed. Bir test kırmızıysa kök nedeni bul (ürün mü, test mi) ve yaz; iddiayı gevşetme, `waitForTimeout` ekleme.

- [ ] **Adım 4: Bütün e2e** — `npx playwright test --reporter=line` → hepsi PASS (dokuz spec dosyası; `SUNUCULAR` ↔ `e2e/` uyum denetimi yeni dosyayı tanır).

- [ ] **Adım 5: Commit**

```bash
git add e2e/editor.spec.ts playwright.config.ts
git commit -m "E2E: bicimli editor, onceki notlar, dis baglanti ve okuma penceresi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Mutasyonlar** (her biri ürün kodunda; e2e `web/dist`'i yeniden derler):
- `uzantilar.ts`'te `openOnClick: !duzenlenebilir` → `true` → "dis baglanti" testinin `acilanSekme === false` iddiası kırılır (editörde tık yeni sekme açtı).
- `uzantilar.ts`'te `HTMLAttributes.target: '_blank'` → `null` → aynı testin okuma yarısı kırılır (ana sayfa gezinir, yeni sekme gelmez). (Salt okunur görünümde tık tarayıcının yerli bağlantı davranışıdır; `openOnClick` orada belirleyici değil — bu yüzden mutasyon `target` üzerinden.)
- `App.tsx`'te yoklama efektini sil → "okuma penceresi kilitte…" (7 sn içinde "Kilitli" yok) kırılır.
- `okumaPenceresi.ts`'te pencere adını `okuma-${randevuId}` → `_blank` → aynı testin P3 iddiası (sayfa sayısı arttı) kırılır. (Yapısal istisna testi de kırılır; bu mutasyon için beklenen.)
- `OncekiNotlar.tsx`'te `NotOkuma`'ya `vurgu` geçirme → "onceki notlarda arama…" kırılır.
- `uzantilar.ts`'te `StarterKit.configure({ …, bold: false })` → "bicim kalici" (`<strong>` yok) ve "yapistirma" (`<b>` kalına dönmedi) kırılır.

---

### Task 11: Temizlik ve son doğrulama (spec §11)

**Files:**
- Modify: `web/src/api.ts` (`notApi.danisanNotlari` ve yorumu kalkar; `danisanApi` başlığı), `web/src/api.test.ts`
- Modify: `web/src/danisan/DosyaBilgileri.tsx` (iki yorum)
- Modify: `e2e/notlar-gelismis.spec.ts` (modül başlığı)
- Modify: tarama bulduğu başka yorum/metin kalıntıları (listeyi rapora yaz)

**Interfaces:**
- Removes: `notApi.danisanNotlari` (Görev 8'den beri çağıranı yok). Sunucudaki `GET /api/danisanlar/{id}/notlar` ucu ve `store::notes::danisan_notlari` KALIR: veri raporu ve e2e `kapaliYollar` (kilitliyken 401) onları kullanır; kaldırılması ayrı bir karar (raporda "sonraki iş" olarak yaz).
- Produces: yok.

- [ ] **Adım 1: Ölü istemci fonksiyonunu kaldır (test önce)**

`web/src/api.test.ts`:
- "danisanNotlari verilen limiti sorguya koyar" ve "danisanNotlari `once` verilince kesmeyi sorguya koyar, verilmeyince KOYMAZ" testlerini SİL (raporda adlarıyla; yerine gelen: `notAra` testi, Görev 3).
- "notApi'nin hiçbir fonksiyonu ozel-not yoluna gitmez": `await notApi.danisanNotlari(3, 4)` satırını sil, `toHaveLength(4)` → `toHaveLength(3)`.
- "notApi ile ozelNotApi ayrı nesnelerdir…": `toEqual(['notGetir', 'notKaydet', 'danisanNotlari', 'notAra'])` → `toEqual(['notGetir', 'notKaydet', 'notAra'])`.

Kırmızıyı gör: web/ `npx vitest run src/api.test.ts` → anahtar listesi iddiası kırılır (`danisanNotlari` hâlâ var).

`web/src/api.ts`:
- `notApi`'den `danisanNotlari` ve üstündeki "Danışanın geçmiş notları — YALNIZCA resmî notlar…" yorum bloğunu SİL.
- `danisanApi` başlığındaki "not içeriği için tek yol `notApi.danisanNotlari`, yani yalnızca **resmî** notlara giden fonksiyondur." → "not içeriği için tek yol `notApi`'dir (`notGetir`, `notAra`): yalnızca **resmî** notlara giden fonksiyonlar."

Yeşili gör: `npx vitest run src/api.test.ts` → PASS.

- [ ] **Adım 2: Yorum kalıntılarını temizle**

- `web/src/danisan/DosyaBilgileri.tsx` modül başlığı: "`GecmisNotlar`'ın katlama kararı burada da geçerli ve daha güçlü:" → "Önceki notlar panelinin kuralı (not içeriği yalnızca istenince açılır, `seans/OncekiNotlar.tsx` N7) burada daha da güçlü geçerli:". JSX yorumu: "KATLANMIŞ — `GecmisNotlar` ile aynı gerekçe, oradan daha güçlüsüyle:" → "KATLANMIŞ — önceki notlar panelindeki gerekçe (içerik yalnızca istenince), daha güçlüsüyle:".
- `e2e/notlar-gelismis.spec.ts` başlığı: "(Markdown editörü + biçim çubuğu, etiketler, arama)" → "(biçimli editör + araç çubuğu, etiketler, arama)"; zincir tarifindeki "biçim çubuğu → textarea → otomatik kayıt" → "araç çubuğu → editör → otomatik kayıt".
- Tarama (depo kökü):

```bash
git grep -n -i -E "markdown|Yaz/Önizle|'Önizle'|Önizle'ye|BicimCubugu|NotGorunumu|GecmisNotlar|gecmisNotlar|GECMIS_SEANS_SAYISI|danisanNotlari|execCommand|bicimUygula|kisayolTusu" -- . ':!docs' ':!**/package-lock.json' ':!Cargo.lock'
```

Beklenen: ÇIKTI YOK. Her kalan satırı düzelt (yorumsa bugünkü davranışı anlatacak biçimde yeniden yaz, kodsa ölü olduğunu doğrulayıp sil) ve dosya:satır olarak rapora yaz. "Önizleme" (not satırı önizlemesi, `onizleme` alanı) ve `core/src/pdf.rs`'teki "macOS Önizleme" uygulaması KAVRAM olarak yaşıyor — tarama onları bilerek yakalamaz.

- [ ] **Adım 3: Tam doğrulama** (hepsi yeşil; sayıları rapora yaz)

```powershell
$env:PATH = "C:\StrawberryPerl\perl\bin;C:\Users\axres\AppData\Local\bin\NASM;" + $env:PATH
npm --prefix web run build
npm --prefix web run lint
cd web; npx vitest run; cd ..
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
npx playwright test --reporter=line
```

- `npm --prefix web run lint`: 0 hata; "warning" satırı sayısı 20'yi geçmez (Global Constraints). Artış varsa hangi dosyada olduğunu yaz ve düzelt.
- `cargo test --workspace` çıktısında `store::duz_metin`, `store::search` ve `server/tests/notlar_api.rs`'in yeni testleri görünür; `src-tauri` `pencere::` testleri görünür.
- E2E: dokuz spec dosyası, hepsi PASS.

- [ ] **Adım 4: Kapsam denetimi** — tasarım belgesinin §4–§11 maddelerini tek tek dolaş (T1–T4, E1–E13, S1–S8, N1–N9, P1–P6b, §11) ve her birinin karşısına onu ölçen test adını yaz (rapora tablo). Testi olmayan madde varsa: elle doğrulanan Mac maddelerinden biri değilse BLOCKED de ve dur.

- [ ] **Adım 5: Mac'te elle doğrulama listesi** (bu Windows makinesinde koşulamaz; rapora "Mac'te yapılacak" başlığıyla aynen yaz)

1. Tauri: "Yeni pencerede aç" ayrı bir uygulama penceresi açar (720×800, başlıkta danışan adı YOK); aynı seans ikinci kez istenince yeni pencere açılmaz, var olan öne gelir (P3).
2. Tauri: okuma penceresi açıkken ana pencerede "Kilitle" → en geç 5 sn'de okuma penceresinde kilit ekranı (P4); ana pencere kapatılınca uygulama çıkar, okuma penceresi yetim kalmaz.
3. Tauri: nottaki `https://` bağlantısı okuma görünümünde tıklanınca VARSAYILAN tarayıcıda açılır; uygulama penceresi gezinmez (E10, P6b); `http://127.0.0.1:…` ya da `localhost` bağlantısı hiçbir yerde açılmaz.
4. Türkçe Q klavye: Cmd+B / Cmd+I / Cmd+U, Cmd+Z / Cmd+Shift+Z; Option ile yazılan karakterler (`@` Option+Q, `#` Option+3, `€` Option+E, `|` Option+7…) kısayola yutulmadan metne girer (E5).
5. Word ve Pages'ten kalın/başlık/madde işaretli metin yapıştır: biçim korunur, görsel ve renk düşer (E11); Safari'den kopyalanan bağlantı tıklanabilir kalır.
6. `docs/superpowers/specs/...` §11'deki "birim testte ölçülemez" diye işaretli başka madde varsa onu da ekle.

- [ ] **Adım 6: Commit**

```bash
git add web/src/api.ts web/src/api.test.ts web/src/danisan/DosyaBilgileri.tsx e2e/notlar-gelismis.spec.ts
git commit -m "Temizlik: olu gecmis not istemcisi ve Markdown donemi yorumlari

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Adım 2 taraması başka dosyaya dokunduysa onlar da `git add`'e AÇIKÇA eklenir; `git add -A` yok.)

**Mutasyonlar:**
- `api.ts`'e `danisanNotlari`'yı geri koy → "notApi ile ozelNotApi ayrı nesnelerdir…" kırılır.
- `notApi`'ye `/ozel-not`'a giden bir fonksiyon ekle (`ozelSizinti: (id: number) => istek(`/api/randevular/${id}/ozel-not`)`) ve "hiçbir fonksiyonu" testine çağrısını ekle → o test kırılır (yapısal ayrımın bekçisi yerinde).

