# Danışan listesi ve dosya (Plan B) — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Danışanlar sekmesinde liste Türkçe harf duyarsız aranabilsin ve klavyeyle gezilebilsin; danışan dosyası adın altında tek satırlık bir özetle ("14. seans · Mart 2026'dan beri · Son · Sıradaki · Ödenmemiş") açılsın; uzun geçmiş katlı "Yaklaşan", aylara bölünmüş, numaralı ve kendi içinde kayan bir listeyle okunsun.

**Architecture:** Yeni sunucu ucu, şema değişikliği, istek ya da denetim satırı YOK. Türkçe katlama arayüzde tek modüle (`web/src/katla.ts`) iner ve sunucudaki `search.rs::katla`ya ortak örnek dosyasıyla (`core/src/store/katlama_ornekleri.json`) bağlanır. Liste süzmesi (`danisanAramasi.ts`), dosya özeti (`dosyaOzeti.ts`) ve liste düzeni (`seansGruplari.ts`, `seansNumaralari`) saf işlevlerdir; bileşenler yalnızca çizer. "Şimdi" uygulamanın tek kaynağından gelir: `DanisanlarSekmesi` `useDakikalikSimdi()`'yi çağırır (takvimdeki `TakvimSekmesi` emsali) ve `DanisanDosyasi`'ne prop olarak indirir. Özetin ve numaraların tek kaynağı `kart.randevular`; liste satırları `useDanisanSeanslari`'nın (süzülmüş) listesidir.

**Tech Stack:** React 19 + TypeScript 6 + Vite 8 + Tailwind 4, Vitest 5 + Testing Library + jsdom (TZ `Europe/Istanbul`), Playwright 1.63 (`page.clock`), Rust (yalnızca `core/src/store/search.rs` testi).

**Spec:** `docs/superpowers/specs/2026-09-24-ilk-dalga-kullanici-deneyimi-design.md` (bağlayıcı): §3, §5.2, §6 B1–B3, §7 (B ile ilgili satırlar), §8, §9 (B4 kalkar; `katla` ortak modüle taşınır; ortak örnek dosyası bu planda eklenir). Görev başlıkları madde kodlarını taşır.

**Görev bölümü hakkında:** Yöneticinin önerdiği beş görev AYNEN korundu (sıra, kapsam). Repo kırmızı kalmasın diye görevlerin içine konan ek işler:
- (a) **Görev 2** altı e2e dosyasındaki on "danışan eklendi" bariyerini (`getByText(ad)`) dosya başlığına (`heading level 2`) çevirir. B1'le ekleme dosyayı açar; ad hem listede hem başlıkta durur ve Playwright'ın katı kipi `getByText(ad)`'da iki öğe bulup kırılır.
- (b) **Görev 3** `SeansListesi`'ne "seçili satırı görünür alana getir" efektini ve `kaydirmaIstegi` sayacını koyar: B2 bağlantıları buna muhtaç. Görev 4 aynı mekanizmayı gruplanmış listede kullanır; ikinci bir mekanizma yazılmaz.
- (c) **Görev 4** `AnaEkran.yayilim.test.tsx`'in iki yardımcısını (`listeSatiri`, `listeMetni`) ve iki öncülünü, `SeansListesi.test.tsx`'teki bir fikstürü günceller. B3'le gelecekteki satırlar katlı gruba girer ve liste açıkça sıralanır. Bu testlerin fikstüründe R202 "gelecekte" (BUGUN_SAATI 9 Eylül, R202 14 Eylül). Gerekçeler adımlarda.

## Global Constraints

- Tüm kod, yorum ve arayüz metni Türkçe. Commit mesajları Türkçe ve ASCII harflerle (repo geleneği: `Arayuz: ...`, `Temizlik: ...`), sonunda boş satır + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Bu planın dosyası (`docs/superpowers/plans/2026-09-26-danisan-listesi-ve-dosya.md`) görevlerle birlikte commit EDİLMEZ; yöneticinin kararı.
- Sunucu yalnızca `127.0.0.1` dinler; yeni ağ çağrısı, yeni sunucu ucu, şema değişikliği YOK (tasarım §2, §8).
- Liste süzmesi, dosya özeti, gruplama ve numaralama sunucuya istek ATMAZ ve `audit_log`'a satır düşürmez (tasarım §8). B2 bağlantısının seçtiği seansın notu, var olan kurala göre yalnızca görünürken okunur (`useDosyaNotu`); yeni bir okuma yolu açılmaz.
- `katla` `toLowerCase`/`toLocaleLowerCase` KULLANMAZ; çıktının kod noktası sayısı ve UTF-16 uzunluğu girdiyle aynıdır (tasarım §5.2). Etiket kimliği (`etiket/etiketAdi.ts::etiketAnahtari`) `katla` ile BİRLEŞTİRİLMEZ.
- İmleç hiçbir alana kendiliğinden gitmez: arama kutusu açılışta odak ALMAZ. Ad alanı yalnızca kullanıcı formu açınca odak alır. Seçim (takvimden, aramadan, B2'den) yalnızca KAYDIRIR (`scrollIntoView({ block: 'nearest' })`), odak vermez (tasarım §3, A6, B1).
- Zaman duvar saati `YYYY-AA-GGTSS:DD` (16 karakter), karşılaştırmalar dizgiyle. `Date`'e yalnızca haftanın gününü bulmak için `takvim/hafta.ts::zamandanDate` ile çevrilir; `new Date(dizgi)`, `toISOString` YOK. "Geçmiş" her yerde `baslangic <= simdi` (A2). Para tam sayı kuruş, metni `para.ts::tlMetni`.
- Borç kuralı yeniden yazılmaz: "Ödenmemiş" `borc.ts::borcToplami(kart.randevular)`, Bilgiler'deki bakiyeyle AYNI çağrı (tasarım §5.1).
- `cargo` yalnızca PowerShell'den ve şu önekle: `$env:PATH = "C:\StrawberryPerl\perl\bin;C:\Users\axres\AppData\Local\bin\NASM;" + $env:PATH`. `cargo test --workspace` öncesi `npm --prefix web run build` (`rust_embed` `web/dist` ister).
- TypeScript YALNIZCA `npm --prefix web run build` ile denetlenir (`tsc -b`); `npx tsc --noEmit -p .` bu depoda hiçbir şey denetlemez.
- Web testleri `web/` dizininde `npx vitest run [dosya]`. Lint `npm --prefix web run lint` (oxlint): 0 hata, uyarı sayısı ARTMAZ. Bugün 18 satır "warning"; her görev öncesi ve sonrası sayıyı yaz.
- E2E: depo kökünden, aynı PATH önekiyle `npx playwright test [e2e/dosya] --reporter=line`. Her spec dosyasının `playwright.config.ts` `SUNUCULAR`'da kendi portu var. Yeni `e2e/danisan-dosyasi.spec.ts` oraya port `7709` ile eklenir. Saate bağlı e2e senaryoları TARAYICI saatini `page.clock.setFixedTime` ile sabitler; sunucu saati değişmez.
- Git worktree açılmaz; `CARGO_TARGET_DIR` ayarlanmaz ya da paylaşılmaz. Derleme sırasında `target/debug/sunucu.exe`'yi tutan demo ya da dev sunucusu çalışmaz.
- Mutasyon testinden ÖNCE commit. Mutasyon YALNIZCA `git checkout -- <dosya>` ile geri alınır (Windows `Copy-Item` mtime tuzağı; bkz. `docs/test-yesil-ama-korumuyor.md`). `git checkout --` commit edilmemiş işi de siler: mutasyondan önce `git status` temiz olmalı.
- Proje `jest-dom` kullanmaz: `toBeInTheDocument` yok. Onun yerine `toBeDefined()`, `toBeNull()`, `.textContent`, `getAttribute` kullanılır.
- Yeni bağımlılık YOK (paket de crate de).
- `web/src` üretim kodunda `window.open` yalnızca `web/src/seans/okumaPenceresi.ts`'te; pano, yazdırma, `data:` ve `new Blob` hiç yok (`istemciRaporUretimi.test.ts` yapısal testleri yeni dosyaları da tarar).

## Review Focus

Tasarımın ima ettiği ama olağan akışın kendiliğinden sınamadığı, bir terapistin başına en olası gelecek beş durum; her birinin testi sahibi olan göreve yazıldı:

1. **Türkçe harf ve dil kenarları.** "İpek Işık" "ipek" ya da "IŞIK" ile bulunamıyor: `'İ'.toLowerCase()` iki kod noktası üretir, `'I'.toLowerCase()` `i` verir ama `ı` vermez. Ya da özet "Mart 2025'dan beri" yazıyor: Türkçe ek sayının okunuşuna uyar ("2025'ten", "2026'dan", "2040'tan"). → Görev 1: `katla.test.ts` ortak örnekleri, zorunlu altı örnek ve `toLowerCase` yapısal yasağı; Rust `katlama_ortak_ornekleri_saglar`. Görev 2: `danisanAramasi.test.ts` ("IŞIK" → yalnızca İpek Işık; "ipek" → İpek Işık + Ipek Sahin; "kazim" "Kâzım"ı BULMAZ, ⌘K ile aynı kural). Görev 3: `dosyaOzeti.test.ts` `ayrilmaEki` tablosu (2000–2100 arası 23 yıl). Görev 5: e2e B1.
2. **Gece yarısı ve İstanbul saati.** 00:00–03:00 arasında UTC günü hâlâ dündür. `toISOString` kullanan bir "şimdi" dünkü 23:00 seansını "Sıradaki" sayar, "Son"u kaybeder ve onu "Yaklaşan"a koyar. → Görev 3: `DanisanlarSekmesi.test.tsx` "İstanbul 00:30" (özet: "Son: 24 Eylül", "Sıradaki: Cuma 25 Eylül 01:00"). Görev 4: aynı saatte Yaklaşan yalnızca 01:00'ı içerir, 23:00 "Eylül 2026 · 1 seans" grubundadır. Görev 5: e2e saati `page.clock` ile sabit.
3. **Tam "şimdi"de başlayan, süren ya da biten seans ve dakikalık tik.** 14:00 seansı 14:00'te hâlâ "Sıradaki" ya da "Yaklaşan"da kalıyor; süren seans "işaretlenmemiş" sayılıyor. → Görev 3: `dosyaOzeti.test.ts` ("TAM şimdi başlayan Sıradaki değil", "TAM şimdi biten işaretlenmemiş sayılır, süren sayılmaz", "TAM şimdi başlayan geldi Son'dur") ve tik testi (13:59 → 14:00 özet değişir). Görev 4: `seansGruplari.test.ts` ("TAM şimdi başlayan geçmiştedir") ve tik testi (satır Yaklaşan'dan Eylül grubuna geçer).
4. **Aylar arasında taşınan randevu.** Takvimde 31 Ağustos'tan 10 Eylül'e taşınan seans eski ay başlığında kalıyor; ya da numaralar/"…'dan beri" eski sırayla görünüyor; ya da etiket süzgeci numarayı değiştiriyor. → Görev 4: `DanisanDosyasi.test.tsx`: "taşınan randevu ay değiştirir": boşalan ay başlığı kalkar, `#n` yeniden sıralanır, özet "Eylül 2026'dan beri" olur. "Süzgeç sonra gruplama; numara süzgeçten bağımsız" testi de burada. `dosyaOzeti.test.ts` `seansNumaralari` eşitlikte küçük kimlik.
5. **Uzun geçmişte kaydırma doğruluğu.** Ekranda: B2 bağlantısı listenin dibindeki ilk seansı seçiyor ama satır görünmüyor; zaten seçili seansın bağlantısı hiç kaydırmıyor; Yaklaşan'daki seans seçiliyken grup katlı kalıyor; liste sayfayı uzatıp notu ekrandan itiyor; ay başlığı yapışmıyor. → Görev 3: `DanisanDosyasi.test.tsx` "ZATEN seçili seansın bağlantısı da yeniden getirir" ve `SeansListesi.test.tsx` kaydırma sayımı. Görev 4: "seçili seans Yaklaşan'daysa grup ZORLA açık" ve "Yaklaşan'daki seçim kaydırılır"; sütun sınıfları. Görev 5: e2e `toBeInViewport`, yapışkan başlık `y` ölçümü, `window.scrollY` değişmez, not görünür kalır.

## File Structure

**Çekirdek (Rust)**
- Oluştur `core/src/store/katlama_ornekleri.json`: Türkçe katlamanın ortak örnekleri `{ girdi, katli }`.
- Değiştir `core/src/store/search.rs`: modül başlığı ve `katla_karakter` yorumu istemci eşini anar; yeni test `katlama_ortak_ornekleri_saglar`.

**Arayüz (web/src)**
- Oluştur `katla.ts` (+ `katla.test.ts`): arayüzdeki TEK katlama (tasarım §5.2, §9).
- Değiştir `not/vurgu.ts`: `katla`'yı `../katla`'dan alır, kendi kopyası silinir. Değiştir `not/vurgu.test.ts`: katlama testleri `katla.test.ts`'e taşınır. Değiştir `seans/OncekiNotlar.tsx`: `katla` içe aktarımı.
- Oluştur `danisan/danisanAramasi.ts` (+ test): `danisanSuz` (B1 eşleşmesi).
- Değiştir `danisan/DanisanlarSekmesi.tsx`: arama kutusu, ↑/↓/Enter/Esc, eşleşmeyen ad kısayolu, `<form>` (Enter/Esc), ad alanına kullanıcı açınca odak, yapışkan sol kolon; `useDakikalikSimdi` → `DanisanDosyasi`.
- Değiştir `screens/anaEkranKancalari/useDanisanListesi.ts`: `ekle(): Promise<Danisan | null>`, yeniden çekme ayrı `try`. Oluştur `useDanisanListesi.test.ts`.
- Oluştur `danisan/dosyaOzeti.ts` (+ test): `dosyaOzeti`, `kronolojik`, tarih ve ek metinleri, (Görev 4) `seansNumaralari`.
- Oluştur `danisan/DosyaOzetiSatiri.tsx`: başlık özeti ve bağlantıları (B2).
- Oluştur `danisan/seansGruplari.ts` (+ test): Yaklaşan ve ay grupları (B3).
- Değiştir `danisan/DanisanDosyasi.tsx`: `simdi` prop'u, özet satırı, `ozettenSec`, `kaydirmaIstegi`, numara haritası, kendi içinde kayan liste sütunu.
- Değiştir `danisan/SeansListesi.tsx`: seçili satırı görünür alana getirme (G3); gruplanmış düzen, `#n`, `data-not`, gelecekte "Not yazılmamış" yok (G4).
- Değiştir testler: `danisan/{DanisanlarSekmesi,DanisanDosyasi,SeansListesi}.test.tsx`, `screens/AnaEkran.yayilim.test.tsx` (G4).

**E2E**
- Değiştir `e2e/{editor,kabuk,notlar,notlar-gelismis,takvim,yedekleme}.spec.ts` (G2 bariyerleri).
- Oluştur `e2e/danisan-dosyasi.spec.ts`. Değiştir `playwright.config.ts` (G5).

## Her görevin bitiş ölçütü

1. Önce `docs/test-yesil-ama-korumuyor.md` okunur (on üç biçim).
2. Testler yazılır ve **kırmızı** görülür (beklenen hata mesajıyla). Kod yazılır ve **yeşil** görülür.
3. Görevin sonundaki "Tam doğrulama" komutları koşulur ve sayılar rapora yazılır. Başlangıç: web vitest 1407, cargo 805, e2e 47, lint 18 uyarı.
4. **Commit.**
5. Görevin "Mutasyonlar" listesindeki her mutasyon için: uygula → adı verilen testin kırmızıya döndüğünü gör → `git checkout -- <dosya>` → yeşili yeniden gör. Rust'ta geri almadan sonra `Compiling psikolog-...` satırını gör (bayat derleme tuzağı). Raporda "mutasyon → kırılan test" satırları olur.
6. Bir test ürün doğru çalıştığı hâlde öncülü tasarım gereği değiştiği için değişiyorsa, raporda adıyla, gerekçesiyle ve yerine gelen iddiayla yazılır (ör. "gelecekteki satırda 'Not yazılmamış' vardır"). Hiçbir iddia gerekçesiz gevşetilmez; takılınca "BLOCKED" deyip durulur, kapsam sessizce daraltılmaz.

---

### Task 1: Ortak `katla` ve ortak örnek dosyası (spec §5.2, §9)

**Files:**
- Create: `web/src/katla.ts`
- Create: `web/src/katla.test.ts`
- Create: `core/src/store/katlama_ornekleri.json`
- Modify: `web/src/not/vurgu.ts` (L6–24: yorum, `KATLAMA`, `katla` silinir; içe aktarma eklenir)
- Modify: `web/src/not/vurgu.test.ts` (tamamı; aşağıda)
- Modify: `web/src/seans/OncekiNotlar.tsx` (L4 içe aktarma)
- Modify: `core/src/store/search.rs` (modül başlığı "# Türkçe katlama" bölümü ~L189–205; `katla_karakter` yorumu ~L425–437; yeni test `katlama_karakter_sayisini_korur`'un ardına, ~L2034)

**Interfaces:**
- Produces: `export function katla(metin: string): string` (`web/src/katla.ts`).
- Removes: `not/vurgu.ts`'in `katla` dışa aktarımı. Vurgu ve önceki notlar araması `../katla`'yı kullanır; `ASGARI_VURGU`, `eslesmeAraliklari`, `vurguParcalari`, `NotVurgusu` aynen kalır.
- Produces (Rust, test): `store::search::tests::katlama_ortak_ornekleri_saglar`.
- Consumes: `search.rs`'in özel `fn katla(metin: &str) -> String` işlevi (test modülü `use super::*` ile görür).

- [ ] **Adım 1: Ortak örnek dosyasını yaz** (`core/src/store/katlama_ornekleri.json`)

```json
[
  { "girdi": "İpek", "katli": "ipek" },
  { "girdi": "IŞIK", "katli": "isik" },
  { "girdi": "ŞAHİN ĞÜÖÇ", "katli": "sahin guoc" },
  { "girdi": "Kâzım", "katli": "kâzim" },
  { "girdi": "ÂDEM", "katli": "Âdem" },
  { "girdi": "İstanbul", "katli": "istanbul" },
  { "girdi": "ı", "katli": "i" },
  { "girdi": "I", "katli": "i" },
  { "girdi": "i", "katli": "i" },
  { "girdi": "şŞ", "katli": "ss" },
  { "girdi": "ğĞ", "katli": "gg" },
  { "girdi": "üÜ", "katli": "uu" },
  { "girdi": "öÖ", "katli": "oo" },
  { "girdi": "çÇ", "katli": "cc" },
  { "girdi": "Çağrı Öztürk", "katli": "cagri ozturk" },
  { "girdi": "Yılmaz", "katli": "yilmaz" },
  { "girdi": "ABCXYZ abcxyz", "katli": "abcxyz abcxyz" },
  { "girdi": "0123 -_.@", "katli": "0123 -_.@" },
  { "girdi": "", "katli": "" },
  { "girdi": "ÉÀß Ωω", "katli": "ÉÀß Ωω" },
  { "girdi": "I\u0307", "katli": "i\u0307" },
  { "girdi": "Aİ😀", "katli": "ai😀" }
]
```

(`"I\u0307"`: `I` + birleşen üst nokta. Katlama yalnızca `I`'yı çevirir, birleşen işaret aynen kalır; iki kod noktası iki kod noktası kalır. Emoji UTF-16'da iki birimdir ve tek kod noktasıdır; her iki uzunluk da korunur.)

- [ ] **Adım 2: Başarısız TS testlerini yaz** (`web/src/katla.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import ornekler from '../../core/src/store/katlama_ornekleri.json'
// Sunucunun katlama kuralı metin olarak (`?raw`; emsal `not/vurgu.test.ts`).
import aramaKaynagi from '../../core/src/store/search.rs?raw'
import katlaKaynagi from './katla.ts?raw'
import { katla } from './katla'

const kodNoktasi = (m: string) => [...m].length

// Tasarım §5.2: kural İKİ dilde yazılı; bu dosyayı
// `search.rs::tests::katlama_ortak_ornekleri_saglar` de okur. Kuralı bir
// tarafta değiştirip dosyayı güncelleyen, öbür tarafın testini kırar.
describe('katla — sunucuyla ORTAK örnekler (tasarım §5.2)', () => {
  it('örnek dosyası tam (boş dosya döngüyü totolojik yapardı)', () => {
    expect(ornekler.length).toBeGreaterThanOrEqual(22)
  })
  it('tasarımın zorunlu örnekleri dosyada', () => {
    const girdiler = ornekler.map((o) => o.girdi)
    for (const z of ['İpek', 'IŞIK', 'ŞAHİN ĞÜÖÇ', 'Kâzım', 'ÂDEM', 'İstanbul']) expect(girdiler, z).toContain(z)
  })
  for (const o of ornekler) {
    it(`${JSON.stringify(o.girdi)} -> ${JSON.stringify(o.katli)}; kod noktası ve UTF-16 uzunluğu korunur`, () => {
      const k = katla(o.girdi)
      expect(k).toBe(o.katli)
      expect(kodNoktasi(k)).toBe(kodNoktasi(o.girdi))
      // Vurgu (`not/vurgu.ts::eslesmeAraliklari`) katlanmış metindeki
      // UTF-16 konumunu ham metinde kullanır.
      expect(k.length).toBe(o.girdi.length)
    })
  }
})

// Sunucudaki `KATLANAN_HARFLER` ile AYNI küme.
const KATLANAN: Array<[string, string]> = [
  ['ı', 'i'], ['İ', 'i'], ['I', 'i'], ['i', 'i'], ['ş', 's'], ['Ş', 's'], ['ğ', 'g'],
  ['Ğ', 'g'], ['ü', 'u'], ['Ü', 'u'], ['ö', 'o'], ['Ö', 'o'], ['ç', 'c'], ['Ç', 'c'],
]

describe('katla — harf tablosu', () => {
  for (const [harf, ascii] of KATLANAN) it(`${harf} -> ${ascii}`, () => expect(katla(harf)).toBe(ascii))
})

// Preflight F21 (eskiden `not/vurgu.test.ts`'te): istemci kuralı sunucununkinin
// KOPYASI; ikisi yalnızca yorumla bağlı kalsaydı sunucuya eklenen bir harf
// aramayı listeden/vurgudan sessizce ayırırdı.
describe('sunucunun katlama kollarıyla aynı (core/src/store/search.rs)', () => {
  const govde = /fn katla_karakter\(k: char\) -> char \{([\s\S]*?)\n\}/.exec(aramaKaynagi)?.[1] ?? ''
  const sunucuEslemesi: Array<[string, string]> = [...govde.matchAll(/((?:'[^']'\s*\|\s*)*'[^']')\s*=>\s*'([^'])'/g)].flatMap(
    ([, harfler, hedef]) => [...harfler.matchAll(/'([^'])'/g)].map(([, h]) => [h, hedef] as [string, string]),
  )

  it('sunucu kaynağı gerçekten okundu (boş okuma iddiaları yeşile çevirmesin)', () => {
    expect(sunucuEslemesi.length).toBeGreaterThanOrEqual(14)
    expect(govde).toContain('to_ascii_lowercase')
  })
  it('sunucunun her katlama kolu istemcide aynı sonucu verir; istemci tablosu sunucununkiyle aynı küme', () => {
    for (const [harf, hedef] of sunucuEslemesi) expect(katla(harf), harf).toBe(hedef)
    expect(new Set(sunucuEslemesi.map(([h]) => h))).toEqual(new Set(KATLANAN.map(([h]) => h)))
  })
})

// Tasarım §5.2: `'İ'.toLowerCase()` iki kod noktası üretir. Kural davranışla
// da ölçülüyor; bu yapısal iddia, ASCII kolunu `toLowerCase`'e geri döndüren
// ve yalnızca ASCII girdiyle sınanan bir değişikliği yakalar. Yorumlar
// çıkarılır: modül başlığı bu adları gerekçe olarak anıyor.
describe('katla.ts yapısı', () => {
  it('üretim kodunda toLowerCase / toLocaleLowerCase YOK', () => {
    const kod = katlaKaynagi.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(kod).toContain('export function katla')
    expect(kod).not.toMatch(/toLowerCase|toLocaleLowerCase/)
  })
})
```

- [ ] **Adım 3: Kırmızıyı gör** — web/ içinde `npx vitest run src/katla.test.ts` → FAIL (`./katla` çözülemiyor).

- [ ] **Adım 4: `katla.ts`'i yaz** (`web/src/katla.ts`)

```ts
/**
 * Türkçe harf katlaması — arayüzdeki TEK kopya (tasarım §5.2, §9).
 *
 * Sunucudaki `core/src/store/search.rs::katla_karakter` ve SQL `lower()` +
 * 12 `replace()` zinciriyle AYNI kural. İstemci ile sunucu
 * `core/src/store/katlama_ornekleri.json` ortak örnekleriyle bağlı
 * (`katla.test.ts`, `search.rs::tests::katlama_ortak_ornekleri_saglar`).
 * Kullananlar: önceki notlarda vurgu ve arama eşiği (`not/vurgu.ts`,
 * `seans/OncekiNotlar.tsx`), danışan listesi araması
 * (`danisan/danisanAramasi.ts`, tasarım B1).
 *
 * Kod noktası başına bir eşleme: `ı İ I i` → `i`, `ş Ş` → `s`, `ğ Ğ` → `g`,
 * `ü Ü` → `u`, `ö Ö` → `o`, `ç Ç` → `c`. Geri kalandan yalnızca ASCII
 * `A`–`Z` küçülür (`Â` → `Â`). `toLowerCase`/`toLocaleLowerCase`
 * KULLANILMAZ: `'İ'.toLowerCase()` iki kod noktası (`i` + U+0307) üretir,
 * "İpek" katlanınca "ipek"i içermez ve katlanmış metindeki konum ham metinden
 * kayar (vurgu buna dayanır). Çıktının kod noktası sayısı ve UTF-16 uzunluğu
 * girdiyle aynıdır.
 *
 * Etiket kimliği (`etiket/etiketAdi.ts::etiketAnahtari`) bununla
 * BİRLEŞTİRİLMEZ: kimlik harf farklarını korur, arama korumaz.
 */
const KATLAMA: Readonly<Record<string, string>> = {
  ı: 'i', İ: 'i', I: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c',
}

export function katla(metin: string): string {
  let sonuc = ''
  for (const k of metin) {
    const eslesen = KATLAMA[k]
    if (eslesen !== undefined) sonuc += eslesen
    else if (k >= 'A' && k <= 'Z') sonuc += String.fromCharCode(k.charCodeAt(0) + 32)
    else sonuc += k
  }
  return sonuc
}
```

- [ ] **Adım 5: Vurgu modülünü ortak işleve bağla**

`web/src/not/vurgu.ts`: L6–24'ü (yorum bloğu `/** Türkçe harf katlaması — sunucudaki ...`, `const KATLAMA`, `export function katla`) SİL. İçe aktarmaların sonuna (L4'ün ardına) şunu ekle:

```ts
// Türkçe katlama ortak modülde (tasarım §9): vurgu ve danışan araması AYNI işlevi kullanır.
import { katla } from '../katla'
```

`web/src/seans/OncekiNotlar.tsx` L4 `import { ASGARI_VURGU, katla, vurguParcalari } from '../not/vurgu'` satırını şu iki satırla değiştir:

```ts
import { katla } from '../katla'
import { ASGARI_VURGU, vurguParcalari } from '../not/vurgu'
```

`web/src/not/vurgu.test.ts`'in YENİ tamamı (katlama testleri `katla.test.ts`'e taşındı; asgari uzunluk ve vurgu testleri aynen kalır):

```ts
import { describe, expect, it } from 'vitest'
// Sunucunun arama eşiği metin olarak (`?raw`, `vite.config.ts`
// `server.fs.allow` bu dizini açıyor; emsal `seans/sablon.test.ts`).
import aramaKaynagi from '../../../core/src/store/search.rs?raw'
import { ASGARI_VURGU, eslesmeAraliklari, vurguParcalari } from './vurgu'

// Katlama kuralının kendisi (harf tablosu, sunucu kolları, ortak örnekler)
// `web/src/katla.test.ts`'te (tasarım §9: ortak modül).
describe('sunucunun arama eşiğiyle aynı (core/src/store/search.rs)', () => {
  it('asgari vurgu uzunluğu sunucunun ASGARI_SORGU değeri', () => {
    const asgari = /const ASGARI_SORGU: usize = (\d+);/.exec(aramaKaynagi)?.[1]
    expect(asgari).toBeDefined()
    expect(ASGARI_VURGU).toBe(Number(asgari))
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
  it('emoji ve İ içeren metinde konumlar ham metinle hizalı (UTF-16 uzunluğu korunur)', () => {
    const metin = '😀 İpek geldi'
    const [[bas, son]] = eslesmeAraliklari(metin, 'ipek')
    expect(metin.slice(bas, son)).toBe('İpek')
  })
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

- [ ] **Adım 6: Yeşili gör** — web/ içinde `npx vitest run src/katla.test.ts src/not/vurgu.test.ts src/seans` → PASS.

- [ ] **Adım 7: Rust testi ve yorumlar** (`core/src/store/search.rs`)

Modül başlığındaki "# Türkçe katlama (`katla`) — SQL ile Rust aynı sonucu vermek zorundadır" bölümünün sonuna (`//! konumu, ham metindeki karakter konumuyla aynıdır.` satırından sonra) şunu ekle:

```rust
//!
//! İstemcide AYNI kural `web/src/katla.ts`'te (danışan listesi araması ve
//! önceki notlar vurgusu; tasarım §5.2). İkisi `katlama_ornekleri.json`
//! ortak örnekleriyle bağlı: `tests::katlama_ortak_ornekleri_saglar` ve
//! `web/src/katla.test.ts` aynı dosyayı okur.
```

`katla_karakter`'in doc yorumundaki `/// (`her_katlanan_harf_*_iki_yonlu_calisir`, harf harf).` satırından sonra şunu ekle:

```rust
/// İstemci eşi `web/src/katla.ts`; ortak örnekler `katlama_ornekleri.json`.
```

Test modülünde `katlama_karakter_sayisini_korur`'un kapanışından hemen sonra (`// --- Kacirma ---` satırından önce):

```rust
    /// Tasarim §5.2: katlama kurali IKI dilde yazili; bu dosyayi
    /// `web/src/katla.test.ts` de okur. SQL zinciri ile bu islevin esitligi
    /// `her_katlanan_harf_*` testlerinde (tasarimin istedigi gibi).
    #[test]
    fn katlama_ortak_ornekleri_saglar() {
        let ornekler: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("katlama_ornekleri.json")).unwrap();
        assert!(ornekler.len() >= 22, "ornek dosyasi beklenenden kucuk");
        for zorunlu in ["İpek", "IŞIK", "ŞAHİN ĞÜÖÇ", "Kâzım", "ÂDEM", "İstanbul"] {
            assert!(
                ornekler.iter().any(|o| o["girdi"] == zorunlu),
                "zorunlu ornek eksik: {zorunlu}"
            );
        }
        for o in &ornekler {
            let girdi = o["girdi"].as_str().unwrap();
            let katli = o["katli"].as_str().unwrap();
            assert_eq!(katla(girdi), katli, "ornek: {girdi:?}");
            assert_eq!(katla(girdi).chars().count(), girdi.chars().count(), "1:1 degil: {girdi:?}");
        }
    }
```

Çalıştır (PowerShell, PATH önekiyle): `npm --prefix web run build; cargo test -p psikolog-core katlama` → `katlama_ortak_ornekleri_saglar` ve `katlama_karakter_sayisini_korur` PASS.

- [ ] **Adım 8: Tam doğrulama**

`npm --prefix web run build` (hata yok); `npm --prefix web run lint` (uyarı 18'i geçmez); web/ içinde `npx vitest run` (PASS, sayıyı yaz); `cargo test --workspace` (PASS, 805 + 1); `npx playwright test e2e/editor.spec.ts --reporter=line` (önceki notlarda Türkçe arama ve vurgu, `katla`'nın tek e2e tüketicisi) PASS.

- [ ] **Adım 9: Commit**

```bash
git add web/src/katla.ts web/src/katla.test.ts web/src/not/vurgu.ts web/src/not/vurgu.test.ts web/src/seans/OncekiNotlar.tsx core/src/store/katlama_ornekleri.json core/src/store/search.rs
git commit -m "Ortak katla: arayuz ve sunucu katlamasi ortak ornek dosyasiyla bagli

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Mutasyonlar:**
- `katla.ts`: `İ: 'i',` girdisini sil → `katla.test.ts` "İpek", "İstanbul", "ŞAHİN ĞÜÖÇ" ve "İ -> i" kırılır.
- `katla.ts`: ASCII kolunu `sonuc += k.toLowerCase()` yap → "üretim kodunda toLowerCase YOK" kırılır.
- `katla.ts`: `for (const k of metin)` → `for (const k of metin.toLocaleLowerCase('tr'))` → "ÂDEM" (`Â` katlanmamalı) ve "ÉÀß Ωω" örnekleri (yalnızca ASCII küçülür) ile yapısal "toLowerCase / toLocaleLowerCase YOK" testi kırılır. ("İpek" ve "IŞIK" bu mutasyonda geçer: `tr` yerelinde tek kod noktası üretirler. Bu yüzden ASCII dışı büyük harf örnekleri dosyada ZORUNLU.)
- `search.rs`: `'ç' | 'Ç' => 'c'` → `'ç' => 'c'` → Rust `katlama_ortak_ornekleri_saglar` ("ŞAHİN ĞÜÖÇ") ve TS "sunucunun her katlama kolu…" kırılır (geri al, `Compiling psikolog-core` gör).
- `katlama_ornekleri.json`: `"Kâzım"` satırının `katli`'sini `"kazim"` yap → hem Rust hem TS örnek testi kırılır.

---

### Task 2: B1 — Danışan listesinde arama (spec §6 B1, §5.2 eşleşme kuralı)

**Files:**
- Create: `web/src/danisan/danisanAramasi.ts`, `web/src/danisan/danisanAramasi.test.ts`
- Create: `web/src/screens/anaEkranKancalari/useDanisanListesi.test.ts`
- Modify: `web/src/screens/anaEkranKancalari/useDanisanListesi.ts` (`ekle`, ~L132–156)
- Modify: `web/src/danisan/DanisanlarSekmesi.tsx` (L1–7 içe aktarmalar; modül başlığı L21–27; `const { arsivOnayi } = liste` ardı; sol kolon L91–196)
- Modify: `web/src/danisan/DanisanlarSekmesi.test.tsx` (`sahteListe().ekle`; yeni describe dosya sonuna)
- Modify (e2e bariyerleri): `e2e/editor.spec.ts` L66, `e2e/kabuk.spec.ts` L39, `e2e/notlar-gelismis.spec.ts` L58, `e2e/notlar.spec.ts` L64, `e2e/takvim.spec.ts` L15, L61, L104, L250, `e2e/yedekleme.spec.ts` L38, L77

**Interfaces:**
- Produces: `export function danisanSuz<T extends { ad_soyad: string }>(liste: readonly T[], sorgu: string): T[]`: `katla(ad).includes(katla(sorgu.trim()))`, boş sorgu herkesi (aynı sırayla) verir.
- Changes: `useDanisanListesi().ekle: () => Promise<Danisan | null>` (eskiden `Promise<void>`). Başarıda POST yanıtındaki `Danisan`, aksi hâlde `null`.
- DOM kancaları (Görev 5 e2e'si kullanır): arama kutusu `role=searchbox`, ad "Danışan ara", yer tutucu "Danışan ara…"; sol kolon `data-testid="danisan-listesi-sutunu"`; vurgulu satır `li[data-vurgulu="evet"]`; açma düğmesi `id="danisan-ac-<id>"`; kısayol düğmesi `'<ad>' adıyla yeni danışan ekle`; bilgi satırı "Arşivlenmiş danışanlar bu listede aranmaz; ⌘K hızlı arama arşivi de tarar."

- [ ] **Adım 1: Başarısız saf işlev testlerini yaz** (`web/src/danisan/danisanAramasi.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { danisanSuz } from './danisanAramasi'

// Sunucu sırası (`ad_soyad COLLATE NOCASE`, yalnızca ASCII katlar): 'I' < 'İ'.
const LISTE = [
  { id: 1, ad_soyad: 'Ayşe Kaya' },
  { id: 2, ad_soyad: 'Ipek Sahin' },
  { id: 5, ad_soyad: 'Kâzım Can' },
  { id: 3, ad_soyad: 'İpek Işık' },
]
const adlar = (sorgu: string) => danisanSuz(LISTE, sorgu).map((d) => d.ad_soyad)

describe('danisanSuz (tasarım B1, §5.2)', () => {
  it('boş ya da yalnızca boşluk sorgu herkesi AYNI sırayla verir', () => {
    expect(adlar('')).toEqual(['Ayşe Kaya', 'Ipek Sahin', 'Kâzım Can', 'İpek Işık'])
    expect(adlar('   ')).toEqual(['Ayşe Kaya', 'Ipek Sahin', 'Kâzım Can', 'İpek Işık'])
  })
  it('İ/ı/I/i aynı harf: "ipek" ve "İPEK" iki İpek\'i de bulur, sıra korunur', () => {
    expect(adlar('ipek')).toEqual(['Ipek Sahin', 'İpek Işık'])
    expect(adlar('İPEK')).toEqual(['Ipek Sahin', 'İpek Işık'])
  })
  it('"IŞIK" yalnızca "İpek Işık"ı bulur (toLowerCase "ışık"ı "işik"ten ayırırdı)', () => {
    expect(adlar('IŞIK')).toEqual(['İpek Işık'])
    expect(adlar('isik')).toEqual(['İpek Işık'])
  })
  it('sorgu kırpılır; kelime içinden eşleşir; ş/s aynı harf', () => {
    expect(adlar('  ayşe ')).toEqual(['Ayşe Kaya'])
    expect(adlar('aya')).toEqual(['Ayşe Kaya'])
    expect(adlar('ŞAHİN')).toEqual(['Ipek Sahin'])
  })
  // Tasarım §5.2: `Â` → `Â` (katlanmaz), ⌘K sunucu aramasıyla AYNI kural.
  // "kazim" "Kâzım"ı BULMAZ; "kâz" bulur. Bilinçli sınır, iki aramada aynı.
  it('â katlanmaz: "kâz" bulur, "kazim" bulmaz', () => {
    expect(adlar('kâz')).toEqual(['Kâzım Can'])
    expect(adlar('kazim')).toEqual([])
  })
  it('girdi dizisi değiştirilmez', () => {
    const kopya = [...LISTE]
    danisanSuz(LISTE, 'ipek')
    expect(LISTE).toEqual(kopya)
  })
})
```

- [ ] **Adım 2: Kırmızıyı gör** — `npx vitest run src/danisan/danisanAramasi.test.ts` → FAIL (`./danisanAramasi` yok).

- [ ] **Adım 3: Saf işlevi yaz** (`web/src/danisan/danisanAramasi.ts`)

```ts
import { katla } from '../katla'

/**
 * Danışan listesi araması (tasarım B1, §5.2): ekrandaki AKTİF listeyi
 * süzer. Sunucuya istek YOK, denetim kaydına satır YOK; asgari uzunluk da
 * yok (istek gitmediği için).
 *
 * Eşleşme `katla(ad).includes(katla(sorgu.trim()))`: ⌘K hızlı aramasıyla
 * (sunucu, `search.rs`) AYNI Türkçe katlama. Boş sorgu herkesi verir. Sıra
 * korunur (sunucunun sıralaması; burada ikinci bir Türkçe sıralama yazılmaz).
 */
export function danisanSuz<T extends { ad_soyad: string }>(liste: readonly T[], sorgu: string): T[] {
  const hedef = katla(sorgu.trim())
  if (hedef === '') return [...liste]
  return liste.filter((d) => katla(d.ad_soyad).includes(hedef))
}
```

Yeşili gör: `npx vitest run src/danisan/danisanAramasi.test.ts` → PASS.

- [ ] **Adım 4: Başarısız kanca testlerini yaz** (`web/src/screens/anaEkranKancalari/useDanisanListesi.test.ts`)

```ts
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Danisan } from '../../api'
import { useDanisanListesi } from './useDanisanListesi'

const taklit = vi.hoisted(() => ({
  danisanEkle: vi.fn(),
  danisanlariGetir: vi.fn(),
}))

vi.mock('../../api', async (importOriginal) => {
  const gercek = await importOriginal<typeof import('../../api')>()
  return {
    ...gercek,
    takvimApi: {
      ...gercek.takvimApi,
      danisanEkle: (ad: string, telefon?: string) => taklit.danisanEkle(ad, telefon),
      danisanlariGetir: () => taklit.danisanlariGetir(),
    },
  }
})

afterEach(() => {
  taklit.danisanEkle.mockReset()
  taklit.danisanlariGetir.mockReset()
})

const AYSE: Danisan = { id: 1, ad_soyad: 'Ayşe Kaya', telefon: null, durum: 'aktif' }
const YENI: Danisan = { id: 9, ad_soyad: 'Zeynep Ak', telefon: null, durum: 'aktif' }

async function kur() {
  const kanca = renderHook(() => useDanisanListesi({ ayarlarGorunur: false }))
  await waitFor(() => expect(kanca.result.current.danisanlar).toEqual([AYSE]))
  act(() => {
    kanca.result.current.setFormAcik(true)
    kanca.result.current.setYeniAdSoyad('  Zeynep Ak ')
  })
  return kanca
}

describe('useDanisanListesi.ekle (tasarım B1)', () => {
  it('POST yanıtındaki danışanı döndürür; liste yeniden çekilir; form kapanır ve boşalır', async () => {
    taklit.danisanlariGetir.mockResolvedValueOnce([AYSE]).mockResolvedValueOnce([AYSE, YENI])
    taklit.danisanEkle.mockResolvedValue(YENI)
    const { result } = await kur()

    let donen: Danisan | null = null
    await act(async () => {
      donen = await result.current.ekle()
    })

    expect(donen).toEqual(YENI)
    expect(taklit.danisanEkle).toHaveBeenCalledExactlyOnceWith('Zeynep Ak', undefined)
    expect(result.current.danisanlar).toEqual([AYSE, YENI])
    expect(result.current.formAcik).toBe(false)
    expect(result.current.yeniAdSoyad).toBe('')
    expect(result.current.hata).toBeNull()
  })

  it('yeniden çekme BAŞARISIZ olsa da ekleme başarılıdır: "eklenemedi" yok, danışan döner ve listeye yerelde eklenir', async () => {
    taklit.danisanlariGetir.mockResolvedValueOnce([AYSE]).mockRejectedValueOnce(new Error('Ağ hatası'))
    taklit.danisanEkle.mockResolvedValue(YENI)
    const { result } = await kur()

    let donen: Danisan | null = null
    await act(async () => {
      donen = await result.current.ekle()
    })

    expect(donen).toEqual(YENI)
    expect(result.current.hata).toBeNull()
    expect(result.current.danisanlar).toEqual([AYSE, YENI])
    expect(result.current.formAcik).toBe(false)
  })

  it('POST başarısızsa null döner, sunucu mesajı olduğu gibi gösterilir, alanlar ve form korunur', async () => {
    taklit.danisanlariGetir.mockResolvedValueOnce([AYSE])
    taklit.danisanEkle.mockRejectedValue(new Error('Telefon en az 7 rakam içermeli.'))
    const { result } = await kur()

    let donen: Danisan | null = YENI
    await act(async () => {
      donen = await result.current.ekle()
    })

    expect(donen).toBeNull()
    expect(result.current.hata).toBe('Telefon en az 7 rakam içermeli.')
    expect(result.current.yeniAdSoyad).toBe('  Zeynep Ak ')
    expect(result.current.formAcik).toBe(true)
    expect(taklit.danisanlariGetir).toHaveBeenCalledTimes(1)
  })

  it('boş ad: istek yok, null', async () => {
    taklit.danisanlariGetir.mockResolvedValueOnce([AYSE])
    const { result } = await kur()
    act(() => result.current.setYeniAdSoyad('   '))

    let donen: Danisan | null = YENI
    await act(async () => {
      donen = await result.current.ekle()
    })

    expect(donen).toBeNull()
    expect(result.current.hata).toBe('Lütfen ad soyad girin.')
    expect(taklit.danisanEkle).not.toHaveBeenCalled()
  })
})
```

Kırmızıyı gör: `npx vitest run src/screens/anaEkranKancalari/useDanisanListesi.test.ts` → ilk iki test FAIL (`donen` `undefined`; ikincide `hata` 'Ağ hatası').

- [ ] **Adım 5: `ekle`'yi yaz** (`web/src/screens/anaEkranKancalari/useDanisanListesi.ts`)

`import { danisanApi, takvimApi, type Danisan } from '../../api'` zaten var. `async function ekle() { ... }` fonksiyonunun TAMAMINI şununla değiştir:

```ts
  /**
   * Yeni danışanı kaydeder ve POST yanıtındaki `Danisan`'ı döndürür
   * (tasarım B1: çağıran dosyayı BU kimlikle açar). Başarısızlıkta `null`.
   *
   * Listenin yeniden çekilmesi AYRI bir `try`'da: çekme başarısız olsa bile
   * ekleme sunucuda yapılmıştır ve kullanıcıya "eklenemedi" GÖSTERİLMEZ.
   * O durumda yeni kayıt listeye yerelde eklenir; doğru sıra bir sonraki
   * çekimde gelir. Yeniden çekmenin gerekçesi aynen geçerli: liste sunucuda
   * `ad_soyad COLLATE NOCASE` ile sıralanıyor ve yeni kaydı istemcide doğru
   * yere sokmak Türkçe sıralamayı burada ikinci kez (farklı) uygulamak
   * demekti. Ekleme seyrek; hacmi sunucudaki birleştirme (`clients::listele`)
   * kapatıyor.
   */
  async function ekle(): Promise<Danisan | null> {
    if (yeniAdSoyad.trim() === '') {
      setHata('Lütfen ad soyad girin.')
      return null
    }
    let yeni: Danisan
    try {
      yeni = await takvimApi.danisanEkle(yeniAdSoyad.trim(), yeniTelefon.trim() || undefined)
    } catch (e) {
      // Sunucudan gelen mesaj OLDUĞU GİBİ gösteriliyor: doğrulama hataları
      // hangi alanın (ad mı, telefon mu) neden reddedildiğini söylüyor
      // (bkz. `store::clients` doğrulayıcıları). Genel bir "Danışan
      // eklenemedi." kullanıcıya neyi düzelteceğini söylemezdi.
      setHata(e instanceof Error ? e.message : 'Danışan eklenemedi.')
      return null
    }
    setYeniAdSoyad('')
    setYeniTelefon('')
    setFormAcik(false)
    setHata(null)
    try {
      setDanisanlar(await takvimApi.danisanlariGetir())
    } catch {
      setDanisanlar((onceki) => (onceki.some((d) => d.id === yeni.id) ? onceki : [...onceki, yeni]))
    }
    return yeni
  }
```

Yeşili gör: kanca testi PASS.

- [ ] **Adım 6: Başarısız bileşen testlerini yaz** (`web/src/danisan/DanisanlarSekmesi.test.tsx`)

`sahteListe` içindeki `ekle: async () => {},` → `ekle: async () => null,`.

Dosyanın sonuna ekle:

```tsx
/**
 * Tasarım B1. `liste` form alanları GERÇEK durumla sürülür (`useState`):
 * `sahteListe`'nin no-op ayarlayıcılarıyla formun açılıp kapanması
 * ölçülemezdi.
 */
describe('DanisanlarSekmesi — arama ve ekleme (tasarım B1)', () => {
  afterEach(() => vi.restoreAllMocks())

  const UC: Danisan[] = [
    { id: 1, ad_soyad: 'Ayşe Kaya', telefon: null, durum: 'aktif' },
    { id: 2, ad_soyad: 'Ipek Sahin', telefon: null, durum: 'aktif' },
    { id: 3, ad_soyad: 'İpek Işık', telefon: null, durum: 'aktif' },
  ]

  function DurumluSekme({
    ekle = async () => null,
    onDanisanSec = () => {},
    baslangicFormAcik = false,
  }: {
    ekle?: () => Promise<Danisan | null>
    onDanisanSec?: (id: number) => void
    baslangicFormAcik?: boolean
  }) {
    const [formAcik, setFormAcik] = useState(baslangicFormAcik)
    const [yeniAdSoyad, setYeniAdSoyad] = useState('')
    const [yeniTelefon, setYeniTelefon] = useState('')
    const liste = {
      ...sahteListe(UC),
      formAcik,
      setFormAcik,
      yeniAdSoyad,
      setYeniAdSoyad,
      yeniTelefon,
      setYeniTelefon,
      ekle,
    }
    return (
      <DanisanlarSekmesi
        liste={liste}
        dosya={sahteDosya(null)}
        seanslar={bosSeanslar()}
        dosyaNotu={bosDosyaNotu()}
        altSekme="seanslar"
        onAltSekme={() => {}}
        {...ILGISIZ}
        onDanisanSec={onDanisanSec}
      />
    )
  }

  const aramaKutusu = () => screen.getByRole('searchbox', { name: 'Danışan ara' }) as HTMLInputElement
  const acmaDugmeleri = () =>
    screen.queryAllByRole('button', { name: /dosyasını aç$/ }).map((b) => b.textContent)
  const vurgulu = () => document.querySelector('li[data-vurgulu="evet"] button')?.textContent ?? null
  const BILGI = 'Arşivlenmiş danışanlar bu listede aranmaz; ⌘K hızlı arama arşivi de tarar.'

  it('kutu imleci KENDİLİĞİNDEN almaz; yazdıkça Türkçe katlamayla süzer; sunucuya istek gitmez', async () => {
    const fetchCasusu = vi.spyOn(globalThis, 'fetch')
    render(<DurumluSekme />)
    expect(document.activeElement).toBe(document.body)
    expect(aramaKutusu().getAttribute('placeholder')).toBe('Danışan ara…')

    await userEvent.type(aramaKutusu(), 'IŞIK')
    expect(acmaDugmeleri()).toEqual(['İpek Işık'])
    await userEvent.clear(aramaKutusu())
    await userEvent.type(aramaKutusu(), 'ipek')
    expect(acmaDugmeleri()).toEqual(['Ipek Sahin', 'İpek Işık'])
    await userEvent.clear(aramaKutusu())
    await userEvent.type(aramaKutusu(), '  ayşe ')
    expect(acmaDugmeleri()).toEqual(['Ayşe Kaya'])
    expect(fetchCasusu).not.toHaveBeenCalled()
  })

  it('yazınca ilk eşleşme vurgulu; ↑/↓ vurguyu taşır (uçlarda durur); Enter vurgulu dosyayı açar, imleç kutuda kalır', async () => {
    const onDanisanSec = vi.fn()
    render(<DurumluSekme onDanisanSec={onDanisanSec} />)
    await userEvent.type(aramaKutusu(), 'ipek')
    expect(vurgulu()).toBe('Ipek Sahin')
    const etkin = aramaKutusu().getAttribute('aria-activedescendant')
    expect(document.getElementById(etkin ?? '')?.textContent).toBe('Ipek Sahin')

    await userEvent.keyboard('{ArrowDown}')
    expect(vurgulu()).toBe('İpek Işık')
    await userEvent.keyboard('{ArrowDown}')
    expect(vurgulu()).toBe('İpek Işık')
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    expect(vurgulu()).toBe('Ipek Sahin')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onDanisanSec).toHaveBeenCalledExactlyOnceWith(3)
    expect(document.activeElement).toBe(aramaKutusu())
  })

  it('boş kutuda vurgu yok, ↓ ilk danışanı vurgular; Esc kutuyu temizler ve vurguyu kaldırır', async () => {
    render(<DurumluSekme />)
    await userEvent.click(aramaKutusu())
    expect(vurgulu()).toBeNull()
    await userEvent.keyboard('{ArrowDown}')
    expect(vurgulu()).toBe('Ayşe Kaya')

    await userEvent.type(aramaKutusu(), 'ayşe')
    expect(acmaDugmeleri()).toEqual(['Ayşe Kaya'])
    await userEvent.keyboard('{Escape}')
    expect(aramaKutusu().value).toBe('')
    expect(acmaDugmeleri()).toHaveLength(3)
    expect(vurgulu()).toBeNull()
    expect(aramaKutusu().getAttribute('aria-activedescendant')).toBeNull()
  })

  it('oklarla vurgulanan satır görünür alana getirilir; açılış KAYDIRMAZ', async () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<DurumluSekme />)
    expect(kaydir).not.toHaveBeenCalled()
    await userEvent.click(aramaKutusu())
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(kaydir).toHaveBeenLastCalledWith({ block: 'nearest' })
    expect(kaydir.mock.contexts.at(-1)).toBe(document.querySelector('li[data-vurgulu="evet"]'))
  })

  it('eşleşme yoksa kısayol ve sabit bilgi satırı; kısayol formu o adla açar, imleç ad alanında; Enter kaydeder, dosya YENİ kimlikle açılır, arama temizlenir', async () => {
    const yeni: Danisan = { id: 9, ad_soyad: 'Zeynep Ak', telefon: null, durum: 'aktif' }
    const ekle = vi.fn(async () => yeni)
    const onDanisanSec = vi.fn()
    render(<DurumluSekme ekle={ekle} onDanisanSec={onDanisanSec} />)

    // Eşleşme varken kısayol ve bilgi satırı YOK (boş sorguda da).
    expect(screen.queryByText(BILGI)).toBeNull()
    await userEvent.type(aramaKutusu(), 'ayş')
    expect(screen.queryByRole('button', { name: /adıyla yeni danışan ekle$/ })).toBeNull()

    await userEvent.clear(aramaKutusu())
    await userEvent.type(aramaKutusu(), '  Zeynep Ak ')
    expect(acmaDugmeleri()).toEqual([])
    expect(screen.getByText(BILGI)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: "'Zeynep Ak' adıyla yeni danışan ekle" }))
    const ad = screen.getByLabelText('Ad soyad') as HTMLInputElement
    expect(ad.value).toBe('Zeynep Ak')
    expect(document.activeElement).toBe(ad)

    await userEvent.keyboard('{Enter}')
    expect(ekle).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onDanisanSec).toHaveBeenCalledExactlyOnceWith(9))
    expect(aramaKutusu().value).toBe('')
  })

  it('ekleme başarısızsa (ekle null) dosya AÇILMAZ, arama korunur', async () => {
    const onDanisanSec = vi.fn()
    render(<DurumluSekme ekle={async () => null} onDanisanSec={onDanisanSec} />)
    await userEvent.type(aramaKutusu(), 'Zeynep Ak')
    await userEvent.click(screen.getByRole('button', { name: "'Zeynep Ak' adıyla yeni danışan ekle" }))
    await userEvent.click(screen.getByRole('button', { name: 'Ekle' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(onDanisanSec).not.toHaveBeenCalled()
    expect(aramaKutusu().value).toBe('Zeynep Ak')
  })

  it('form: "Danışan ekle" ile açılınca imleç ad alanında; Esc kapatır; form AÇIK monte olunca imleç kendiliğinden GİTMEZ', async () => {
    const { unmount } = render(<DurumluSekme />)
    await userEvent.click(screen.getByRole('button', { name: 'Danışan ekle' }))
    expect(document.activeElement).toBe(screen.getByLabelText('Ad soyad'))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByLabelText('Ad soyad')).toBeNull()
    unmount()

    // Sekmeye dönüş (yeniden monte) form açıkken olur: odak isteği YOK.
    render(<DurumluSekme baslangicFormAcik />)
    expect(screen.getByLabelText('Ad soyad')).toBeDefined()
    expect(document.activeElement).toBe(document.body)
  })

  it('sol kolon kendi içinde kayar (sticky + self-start + 100dvh + overflow)', () => {
    render(<DurumluSekme />)
    const sutun = screen.getByTestId('danisan-listesi-sutunu')
    for (const sinif of ['sticky', 'top-0', 'self-start', 'max-h-[100dvh]', 'overflow-y-auto']) {
      expect(sutun.className, sinif).toContain(sinif)
    }
    expect(sutun.contains(aramaKutusu())).toBe(true)
  })
})
```

Test dosyasının başındaki içe aktarmalar zaten `act, render, renderHook, screen, waitFor, within`, `userEvent`, `useState`, `afterEach, describe, expect, it, vi` ve `Danisan` tipini içeriyor; eksik olan yok.

Kırmızıyı gör: `npx vitest run src/danisan/DanisanlarSekmesi.test.tsx` → yeni sekiz test FAIL ("Danışan ara" adlı searchbox yok).

- [ ] **Adım 7: Bileşeni yaz** (`web/src/danisan/DanisanlarSekmesi.tsx`)

(a) L1'deki `import { yerelGun } from '../screens/anaEkranKancalari/yerelGun'` satırından ÖNCE ekle:

```ts
import { useEffect, useRef, useState, type KeyboardEvent as TusOlayi } from 'react'
```

L7'deki `import { DanisanDosyasi, type DosyaAltSekme } from './DanisanDosyasi'` satırından SONRA ekle:

```ts
import { danisanSuz } from './danisanAramasi'
```

(b) Modül başlığındaki "# Sol kolonun JSX'i AnaEkran'dan TAŞINDI, DAVRANIŞI DEĞİŞMEDİ" bölümünü (başlık dahil, L21–27) şununla değiştir:

```ts
 * # Sol kolon: arama, ekleme, liste (tasarım B1)
 *
 * Liste yalnızca AKTİF danışanlar (sunucu arşivi göndermez). Tepedeki
 * "Danışan ara…" kutusu ekrandaki listeyi `danisanAramasi.ts::danisanSuz`
 * ile (tasarım §5.2 Türkçe katlama, `katla.ts`) süzer: istek YOK, denetim
 * satırı YOK. Kutudayken ↑/↓ vurguyu taşır, Enter vurgulu dosyayı açar, Esc
 * temizler. Eşleşme yoksa "'<ad>' adıyla yeni danışan ekle" kısayolu formu o
 * adla açar; altındaki sabit satır arşivin burada aranmadığını, ⌘K'nın
 * taradığını söyler.
 *
 * İmleç arama kutusuna KENDİLİĞİNDEN gitmez (A6 kullanıcı kararı). Ekleme
 * formunun ad alanına yalnızca kullanıcı formu AÇINCA gider
 * (`adOdakIstegi`). Enter kaydeder, Esc kapatır. `ekle()` POST yanıtındaki
 * danışanı döndürür ve dosya o kimlikle açılır.
 *
 * Kolon kendi içinde kayar (`sticky top-0 self-start max-h-[100dvh]
 * overflow-y-auto`). `liste` kancası (`useDanisanListesi`) hâlâ `AnaEkran`'da
 * çağrılıyor ve bu bileşen yalnızca SONUCU görüyor. Arama ve vurgu bu
 * bileşenin yerel durumu: sekmeden çıkınca sıfırlanır; dönüşte liste
 * "eksik" görünmez.
```

(c) `const { arsivOnayi } = liste` satırının hemen ARDINA ekle:

```tsx
  // Arama (tasarım B1). `vurgu`: vurgulu satırın süzülmüş listedeki sırası.
  const [sorgu, setSorgu] = useState('')
  const [vurgu, setVurgu] = useState<number | null>(null)
  const suzulmus = danisanSuz(liste.danisanlar, sorgu)
  const etkinVurgu =
    vurgu === null || suzulmus.length === 0 ? null : Math.min(vurgu, suzulmus.length - 1)
  const vurguluId = etkinVurgu === null ? null : suzulmus[etkinVurgu].id
  const vurguluSatirRef = useRef<HTMLLIElement>(null)
  // Oklarla gezilen satır kendi içinde kayan kolonda görünür kalır. Açılışta
  // vurgu yok, yani sekmeye gelmek KAYDIRMAZ.
  useEffect(() => {
    if (vurguluId !== null) vurguluSatirRef.current?.scrollIntoView({ block: 'nearest' })
  }, [vurguluId])

  // Ad alanına odak YALNIZCA kullanıcı formu açınca ("Danışan ekle" ya da
  // kısayol). Sayaç bileşenle birlikte sıfırlanır: form açıkken sekmeye geri
  // dönmek (yeniden monte) imleci kendiliğinden bir alana GÖTÜRMEZ. `autoFocus`
  // bu ayrımı yapamazdı.
  const [adOdakIstegi, setAdOdakIstegi] = useState(0)
  const adAlaniRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (adOdakIstegi > 0) adAlaniRef.current?.focus()
  }, [adOdakIstegi])

  function sorguDegisti(yeni: string) {
    setSorgu(yeni)
    // Yazınca ilk eşleşme vurgulanır: "ayşe" + Enter ilk Ayşe'yi açar.
    setVurgu(yeni.trim() === '' ? null : 0)
  }

  function aramaTusu(olay: TusOlayi<HTMLInputElement>) {
    const n = suzulmus.length
    if (olay.key === 'ArrowDown') {
      olay.preventDefault()
      if (n > 0) setVurgu(etkinVurgu === null ? 0 : Math.min(etkinVurgu + 1, n - 1))
    } else if (olay.key === 'ArrowUp') {
      olay.preventDefault()
      if (n > 0) setVurgu(etkinVurgu === null ? n - 1 : Math.max(etkinVurgu - 1, 0))
    } else if (olay.key === 'Enter') {
      olay.preventDefault()
      if (vurguluId !== null) onDanisanSec(vurguluId)
    } else if (olay.key === 'Escape') {
      olay.preventDefault()
      setSorgu('')
      setVurgu(null)
    }
  }

  function formuAc(ad?: string) {
    if (ad !== undefined) liste.setYeniAdSoyad(ad)
    liste.setFormAcik(true)
    setAdOdakIstegi((n) => n + 1)
  }

  // `ekle()` POST yanıtındaki danışanı döndürür; dosya O kimlikle açılır ve
  // arama temizlenir (yeni danışan, düzeltilmiş adla da görünür kalsın).
  async function ekleVeAc() {
    const yeni = await liste.ekle()
    if (yeni === null) return
    setSorgu('')
    setVurgu(null)
    onDanisanSec(yeni.id)
  }
```

(d) L91–196'yı (`{/* SOL KOLON — AnaEkran.tsx'teki eski danışan listesi bölümüyle` yorumundan `liste.danisanlar.length > 0 && (...)` bloğunun kapanışına kadar) şununla değiştir. Arşiv onayı bloğu (`{arsivOnayi && (`) ve sol kolonun kapanan `</div>`'i AYNEN kalır.

```tsx
      {/* SOL KOLON — arama (tasarım B1), ekleme formu, liste. Kendi içinde
          kayar: uzun listede sağdaki dosya yerinde kalır. `self-start`
          ZORUNLU: ızgara hücresi varsayılan olarak satır boyuna gerilir ve
          gerilen öğenin yapışacak yeri kalmaz. */}
      <div
        data-testid="danisan-listesi-sutunu"
        className="sticky top-0 self-start max-h-[100dvh] overflow-y-auto"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-600">Danışanlar</span>
          <button
            type="button"
            className="rounded border px-3 py-1 text-sm"
            onClick={() => (liste.formAcik ? liste.setFormAcik(false) : formuAc())}
          >
            Danışan ekle
          </button>
        </div>

        {/* İmleç buraya KENDİLİĞİNDEN gelmez; süzme yalnızca ekranda. */}
        <input
          type="search"
          aria-label="Danışan ara"
          placeholder="Danışan ara…"
          aria-controls={suzulmus.length > 0 ? 'danisan-listesi' : undefined}
          aria-activedescendant={vurguluId === null ? undefined : `danisan-ac-${vurguluId}`}
          className="mt-3 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          value={sorgu}
          onChange={(olay) => sorguDegisti(olay.target.value)}
          onKeyDown={aramaTusu}
        />

        {liste.formAcik && (
          // `<form>`: Enter iki alanda da kaydeder (örtük gönderim), Esc kapatır.
          <form
            className="mt-2 flex flex-col items-start gap-2"
            onSubmit={(olay) => {
              olay.preventDefault()
              void ekleVeAc()
            }}
            onKeyDown={(olay) => {
              if (olay.key !== 'Escape') return
              olay.preventDefault()
              liste.setFormAcik(false)
            }}
          >
            <div>
              <label className="block text-sm" htmlFor="yeni-danisan-ad-soyad">
                Ad soyad
              </label>
              <input
                id="yeni-danisan-ad-soyad"
                ref={adAlaniRef}
                className="mt-1 w-full rounded border p-2"
                value={liste.yeniAdSoyad}
                onChange={(e) => liste.setYeniAdSoyad(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm" htmlFor="yeni-danisan-telefon">
                Telefon
              </label>
              <input
                id="yeni-danisan-telefon"
                className="mt-1 w-full rounded border p-2"
                value={liste.yeniTelefon}
                onChange={(e) => liste.setYeniTelefon(e.target.value)}
              />
            </div>
            <button type="submit" className="rounded bg-slate-900 px-3 py-2 text-sm text-white">
              Ekle
            </button>
          </form>
        )}

        {liste.hata && <p className="mt-1 text-sm text-red-600">{liste.hata}</p>}
        {/* `role="status"`: arşivleme sonucu ekranda sessizce beliriyordu.
            Ekran okuyucu kullanıcısı düğmeye bastıktan sonra hiçbir şey
            duymuyor, danışanın listeden düşmesini de göremiyordu. */}
        {liste.arsivBilgisi && (
          <p role="status" className="mt-1 text-sm text-slate-600">
            {liste.arsivBilgisi}
          </p>
        )}

        {suzulmus.length > 0 && (
          <ul id="danisan-listesi" className="mt-2 flex flex-col gap-2 text-sm text-slate-700">
            {suzulmus.map((d) => {
              const vurgulu = d.id === vurguluId
              return (
                <li
                  key={d.id}
                  ref={vurgulu ? vurguluSatirRef : undefined}
                  // Son inceleme I2: açık dosyanın danışanı GÖRSEL olarak da
                  // vurgulanır — eskiden yalnızca `aria-current` taşıyordu.
                  data-secili={d.id === seciliDanisanId ? 'evet' : undefined}
                  // Klavye vurgusu (B1) seçimden AYRI: halka ile gösterilir.
                  data-vurgulu={vurgulu ? 'evet' : undefined}
                  className={
                    'flex items-center justify-between gap-2 rounded border-l-4 px-3 py-1 ' +
                    (d.id === seciliDanisanId
                      ? 'border-slate-900 bg-slate-200 font-semibold'
                      : 'border-transparent bg-slate-100') +
                    (vurgulu ? ' ring-2 ring-sky-400' : '')
                  }
                >
                  {/* Erişilebilir ad "Ayşe Yılmaz dosyasını aç": takvimdeki
                      randevu bloğunun adı düz "Ayşe Yılmaz" ve iki özdeş adlı
                      düğme hem ekran okuyucu kullanıcısını hem de ada göre
                      arayan testleri belirsiz bırakırdı. `id`: arama
                      kutusunun `aria-activedescendant`'ı. */}
                  <button
                    type="button"
                    id={`danisan-ac-${d.id}`}
                    className="underline"
                    aria-label={`${d.ad_soyad} dosyasını aç`}
                    aria-current={d.id === seciliDanisanId ? 'true' : undefined}
                    onClick={() => onDanisanSec(d.id)}
                  >
                    {d.ad_soyad}
                  </button>
                  {/* Erişilebilir ad danışanın ADINI taşır (bkz. AnaEkran'daki
                      aynı gerekçe: on özdeş "Arşivle" düğmesi ekran okuyucu
                      kullanıcısı için ayırt edilemezdi). */}
                  <button
                    type="button"
                    className="text-slate-500 underline disabled:opacity-50"
                    aria-label={`${d.ad_soyad} adlı danışanı arşivle`}
                    title="Danışanı arşivle"
                    disabled={liste.arsivSuruyor}
                    onClick={() => {
                      liste.setArsivBilgisi(null)
                      liste.setArsivOnayi(d)
                    }}
                  >
                    Arşivle
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {sorgu.trim() !== '' && suzulmus.length === 0 && (
          <div className="mt-2 text-sm">
            <button type="button" className="text-left underline" onClick={() => formuAc(sorgu.trim())}>
              {`'${sorgu.trim()}' adıyla yeni danışan ekle`}
            </button>
            <p className="mt-1 text-xs text-slate-500">
              Arşivlenmiş danışanlar bu listede aranmaz; ⌘K hızlı arama arşivi de tarar.
            </p>
          </div>
        )}
```

Yeşili gör: `npx vitest run src/danisan src/screens/anaEkranKancalari` → PASS. Ardından `npx vitest run src/screens/AnaEkran.test.tsx` → PASS. "Danışan ekleme doğrulama hatası" testi "Ekle"ye basar; gönder düğmesi formu gönderir ve sunucu mesajı görünür.

- [ ] **Adım 8: E2E bariyerlerini güncelle**

B1'le ekleme danışanın dosyasını açar. Ad hem listedeki düğmede hem `<h2>` başlıkta durur ve `getByText(ad)` iki öğe bulur (Playwright katı kipi kırar). Bariyer artık B1'in kendisini ölçer: dosya açıldı. Aşağıdaki satırların HER birini aynı biçimle değiştir (her dosyada ilk değişen satırın üstüne bir kez yorum: `// Tasarım B1: ekleme dosyayı açar; ad hem listede hem başlıkta durur.`):

| Dosya:satır | Eski | Yeni |
|---|---|---|
| `e2e/editor.spec.ts:66` | `await expect(page.getByText(ad, { exact: true })).toBeVisible()` | `await expect(page.getByRole('heading', { level: 2, name: ad, exact: true })).toBeVisible()` |
| `e2e/kabuk.spec.ts:39` | aynı | aynı |
| `e2e/notlar-gelismis.spec.ts:58` | aynı | aynı |
| `e2e/notlar.spec.ts:64` | aynı | aynı |
| `e2e/takvim.spec.ts:15` | `await expect(page.getByText('Ayşe Yılmaz')).toBeVisible()` | `await expect(page.getByRole('heading', { level: 2, name: 'Ayşe Yılmaz', exact: true })).toBeVisible()` |
| `e2e/takvim.spec.ts:61` | `… getByText('Zeynep Kaya') …` | `… getByRole('heading', { level: 2, name: 'Zeynep Kaya', exact: true }) …` |
| `e2e/takvim.spec.ts:104` | `… getByText('Elif Şahin') …` | `… name: 'Elif Şahin' …` |
| `e2e/takvim.spec.ts:250` | `… getByText('Deniz Arslan') …` | `… name: 'Deniz Arslan' …` |
| `e2e/yedekleme.spec.ts:38` | `… getByText('Ayşe Yılmaz') …` | `… name: 'Ayşe Yılmaz' …` |
| `e2e/yedekleme.spec.ts:77` | `… getByText('Yedekten Sonra Eklenen') …` | `… name: 'Yedekten Sonra Eklenen' …` |

`.first()` taşıyan bariyerler (`odeme.spec.ts:54`, `takvim.spec.ts:174` ve `:298`, `yerlesim.spec.ts:66`) değişmez. `yedekleme.spec.ts`'teki geri yükleme sonrası `getByText('Yedekten Sonra Eklenen')).toHaveCount(0)` değişmez: kilit açılınca `AnaEkran` yeniden monte olur, dosya açık değildir.

- [ ] **Adım 9: Tam doğrulama**

`npm --prefix web run build` (hata yok); `npm --prefix web run lint` (≤ 18 uyarı); web/ `npx vitest run` (PASS, sayıyı yaz); `npx playwright test --reporter=line` (9 dosya, 47 test PASS).

- [ ] **Adım 10: Commit**

```bash
git add web/src/danisan/danisanAramasi.ts web/src/danisan/danisanAramasi.test.ts web/src/danisan/DanisanlarSekmesi.tsx web/src/danisan/DanisanlarSekmesi.test.tsx web/src/screens/anaEkranKancalari/useDanisanListesi.ts web/src/screens/anaEkranKancalari/useDanisanListesi.test.ts e2e/editor.spec.ts e2e/kabuk.spec.ts e2e/notlar-gelismis.spec.ts e2e/notlar.spec.ts e2e/takvim.spec.ts e2e/yedekleme.spec.ts
git commit -m "Danisanlar: Turkce harf duyarsiz arama, klavye, ekleme kisayolu ve yapiskan sol kolon

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Mutasyonlar:**
- `danisanAramasi.ts`: `katla(d.ad_soyad).includes(hedef)` → `d.ad_soyad.toLowerCase().includes(sorgu.trim().toLowerCase())` (ve `hedef` boş denetimi aynı kalsın) → `danisanAramasi.test.ts` "IŞIK", "İPEK" ve "ŞAHİN" testleri kırılır.
- `danisanAramasi.ts`: `sorgu.trim()` → `sorgu` → "sorgu kırpılır" testi kırılır.
- `useDanisanListesi.ts`: yeniden çekmeyi ilk `try`'ın içine taşı (tek `try`) → "yeniden çekme BAŞARISIZ olsa da…" kırılır.
- `DanisanlarSekmesi.tsx`: `ekleVeAc`'tan `onDanisanSec(yeni.id)`'yi sil → "kısayol formu o adla açar…" kırılır.
- `DanisanlarSekmesi.tsx`: `adOdakIstegi` efektini sil, ad alanına `autoFocus` ekle → "form AÇIK monte olunca imleç kendiliğinden GİTMEZ" kırılır.
- `DanisanlarSekmesi.tsx`: `aramaTusu`'ndan `Escape` dalını sil → "Esc kutuyu temizler" kırılır.
- `DanisanlarSekmesi.tsx`: sol kolondan `self-start`'ı sil → "sol kolon kendi içinde kayar" kırılır.

---

### Task 3: B2 — Dosya başlığında özet satırı (spec §6 B2, §5.1 "Ödenmemiş", A2 tek "şimdi")

**Files:**
- Create: `web/src/danisan/dosyaOzeti.ts`, `web/src/danisan/dosyaOzeti.test.ts`
- Create: `web/src/danisan/DosyaOzetiSatiri.tsx`
- Modify: `web/src/danisan/DanisanDosyasi.tsx` (içe aktarmalar; modül başlığı; `Props` += `simdi`; `suzgec`'in yanına `kaydirmaIstegi`; `ozettenSec`; `<h2>`'nin ardı; `<SeansListesi>` prop'u)
- Modify: `web/src/danisan/SeansListesi.tsx` (`Props` += `kaydirmaIstegi`; seçili satır ref'i ve efekt)
- Modify: `web/src/danisan/DanisanlarSekmesi.tsx` (`useDakikalikSimdi`, `simdi={simdi}`)
- Modify: `web/src/danisan/DanisanDosyasi.test.tsx` (`proplar` += `simdi`; `Kontrollu`; yeni describe)
- Modify: `web/src/danisan/SeansListesi.test.tsx` (yeni describe)
- Modify: `web/src/danisan/DanisanlarSekmesi.test.tsx` (`sahteKart`/`sahteDosya` randevu parametresi; yeni describe)

**Interfaces:**
- Produces (`dosyaOzeti.ts`):
  - `export type OzetRandevusu = Pick<Randevu, 'id' | 'baslangic' | 'bitis' | 'durum' | 'ucret' | 'odendi'>`
  - `export type DosyaOzeti = { geldiSayisi: number; ilkGeldi: OzetRandevusu | null; sonGeldi: OzetRandevusu | null; siradaki: OzetRandevusu | null; isaretlenmemis: number; odenmemisKurus: number }`
  - `export function kronolojik(a: { baslangic: string; id: number }, b: { baslangic: string; id: number }): number`: `baslangic ASC, id ASC` sıralaması (Görev 4 numaralar için de kullanır).
  - `export function dosyaOzeti(randevular: readonly OzetRandevusu[], simdi: string): DosyaOzeti`
  - `export function ayYil(zaman: string): string`: `"2026-03…"` → `"Mart 2026"` (hem `YYYY-AA` hem tam zaman).
  - `export function ayrilmaEki(sayi: number): string`: `"'dan" | "'den" | "'tan" | "'ten"`.
  - `export function baslangicAyi(zaman: string): string`: `"Mart 2026'dan beri"`.
  - `export function kisaTarih(zaman: string, simdi: string): string`: `"17 Eylül"`; başka yılsa `"30 Aralık 2025"`.
  - `export function gunluTarihSaat(zaman: string, simdi: string): string`: `"Perşembe 24 Eylül 14:00"`; başka yılsa `"Salı 5 Ocak 2027 14:00"`.
- Produces: `export function DosyaOzetiSatiri(p: { randevular: readonly OzetRandevusu[]; simdi: string; onSec: (appointmentId: number) => void }): JSX.Element | null`: `<p data-testid="dosya-ozeti">`. Bağlantılar `<button type="button">`; erişilebilir adları görünen metin: `"Mart 2026'dan beri"`, `"Son: 8 Eylül"`, `"Sıradaki: Perşembe 1 Ekim 14:00"`.
- Changes: `DanisanDosyasi` Props += `simdi: string` (zorunlu). `SeansListesi` Props += `kaydirmaIstegi?: number` (varsayılan 0).
- Consumes: `borc.ts::borcToplami`, `para.ts::tlMetni`, `takvim/hafta.ts::{AYLAR, GUN_TAM_ADLARI, haftaIndeksi, zamandanDate}`, `yerelGun.ts::useDakikalikSimdi`.

- [ ] **Adım 1: Başarısız saf işlev testlerini yaz** (`web/src/danisan/dosyaOzeti.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { borcToplami } from '../borc'
import type { Randevu } from '../takvim/HaftalikTakvim'
import { ayrilmaEki, ayYil, baslangicAyi, dosyaOzeti, gunluTarihSaat, kisaTarih } from './dosyaOzeti'

const SIMDI = '2026-09-24T12:00' // Perşembe

/** Varsayılan bitiş başlangıcın saatinde :50 (başlangıçlar tam saat). */
function r(oz: Partial<Randevu> & { id: number; baslangic: string }): Randevu {
  return {
    client_id: 1,
    danisan_adi: 'Ayşe Kaya',
    bitis: `${oz.baslangic.slice(0, 14)}50`,
    durum: 'planlandi',
    ucret: 90000,
    odendi: false,
    seri_id: null,
    ...oz,
  }
}

describe('dosyaOzeti (tasarım B2)', () => {
  it('boş liste: hiçbir parça yok', () => {
    expect(dosyaOzeti([], SIMDI)).toEqual({
      geldiSayisi: 0, ilkGeldi: null, sonGeldi: null, siradaki: null, isaretlenmemis: 0, odenmemisKurus: 0,
    })
  })

  it('"N. seans" yalnızca geldi sayar (§5.1); gelmedi, iptal, planlı sayılmaz', () => {
    const o = dosyaOzeti([
      r({ id: 1, baslangic: '2026-09-01T10:00', durum: 'geldi' }),
      r({ id: 2, baslangic: '2026-09-08T10:00', durum: 'gelmedi' }),
      r({ id: 3, baslangic: '2026-09-10T10:00', durum: 'iptal' }),
      r({ id: 4, baslangic: '2026-09-15T10:00', durum: 'planlandi' }),
      r({ id: 5, baslangic: '2026-10-01T10:00', durum: 'geldi' }),
    ], SIMDI)
    expect(o.geldiSayisi).toBe(2)
  })

  it('ilk geldi: en erken başlangıç, eşitlikte KÜÇÜK kimlik; girdi sırası önemsiz', () => {
    const liste = [
      r({ id: 9, baslangic: '2026-03-03T10:00', durum: 'geldi' }),
      r({ id: 4, baslangic: '2026-03-03T10:00', durum: 'geldi' }),
      r({ id: 1, baslangic: '2026-05-05T10:00', durum: 'geldi' }),
    ]
    expect(dosyaOzeti(liste, SIMDI).ilkGeldi?.id).toBe(4)
    expect(dosyaOzeti([...liste].reverse(), SIMDI).ilkGeldi?.id).toBe(4)
  })

  it('"Son": baslangic <= simdi olan en son geldi; TAM şimdi başlayan dahil, geleceğe işaretlenmiş geldi hariç', () => {
    const o = dosyaOzeti([
      r({ id: 1, baslangic: '2026-09-17T10:00', durum: 'geldi' }),
      r({ id: 2, baslangic: SIMDI, durum: 'geldi' }),
      r({ id: 3, baslangic: '2026-09-30T10:00', durum: 'geldi' }),
      r({ id: 4, baslangic: '2026-09-23T10:00', durum: 'gelmedi' }),
    ], SIMDI)
    expect(o.sonGeldi?.id).toBe(2)
  })

  it('"Sıradaki": planlı ∧ baslangic > simdi, en erken, eşitlikte küçük kimlik; TAM şimdi başlayan ve süren seans sıradaki DEĞİL', () => {
    const o = dosyaOzeti([
      r({ id: 1, baslangic: SIMDI, durum: 'planlandi' }),
      r({ id: 2, baslangic: '2026-09-24T11:30', bitis: '2026-09-24T12:20', durum: 'planlandi' }),
      r({ id: 8, baslangic: '2026-09-24T14:00', durum: 'planlandi' }),
      r({ id: 7, baslangic: '2026-09-24T14:00', durum: 'planlandi' }),
      r({ id: 3, baslangic: '2026-09-24T13:00', durum: 'iptal' }),
      r({ id: 4, baslangic: '2026-09-24T13:30', durum: 'geldi' }),
    ], SIMDI)
    expect(o.siradaki?.id).toBe(7)
  })

  it('işaretlenmemiş: planlı ∧ bitis <= simdi; TAM şimdi biten sayılır, süren sayılmaz, işaretlenmiş sayılmaz', () => {
    const o = dosyaOzeti([
      r({ id: 1, baslangic: '2026-09-24T11:10', bitis: SIMDI, durum: 'planlandi' }),
      r({ id: 2, baslangic: '2026-09-24T11:30', bitis: '2026-09-24T12:20', durum: 'planlandi' }),
      r({ id: 3, baslangic: '2026-09-22T10:00', durum: 'planlandi' }),
      r({ id: 4, baslangic: '2026-09-22T11:00', durum: 'gelmedi' }),
    ], SIMDI)
    expect(o.isaretlenmemis).toBe(2)
  })

  it('"Ödenmemiş" borç kuralının KENDİSİ (borcToplami): gelmedi dahil, iptal ve ödenmiş hariç', () => {
    const liste = [
      r({ id: 1, baslangic: '2026-09-01T10:00', durum: 'geldi' }),
      r({ id: 2, baslangic: '2026-09-08T10:00', durum: 'gelmedi' }),
      r({ id: 3, baslangic: '2026-09-10T10:00', durum: 'iptal' }),
      r({ id: 4, baslangic: '2026-09-15T10:00', durum: 'geldi', odendi: true }),
      r({ id: 5, baslangic: '2026-09-16T10:00', durum: 'geldi', ucret: null }),
    ]
    expect(dosyaOzeti(liste, SIMDI).odenmemisKurus).toBe(180000)
    expect(dosyaOzeti(liste, SIMDI).odenmemisKurus).toBe(borcToplami(liste))
  })
})

describe('tarih metinleri (Date\'e yalnızca gün adı için çevrilir)', () => {
  // Türkçe ayrılma eki sayının OKUNUŞUNA uyar: son sıfır olmayan basamağın
  // adı (bir, iki, üç… / on, yirmi, otuz…), yoksa yüz/bin → "'den".
  it.each([
    [2000, "'den"], [2001, "'den"], [2002, "'den"], [2003, "'ten"], [2004, "'ten"],
    [2005, "'ten"], [2006, "'dan"], [2007, "'den"], [2008, "'den"], [2009, "'dan"],
    [2010, "'dan"], [2019, "'dan"], [2020, "'den"], [2025, "'ten"], [2026, "'dan"],
    [2030, "'dan"], [2040, "'tan"], [2050, "'den"], [2060, "'tan"], [2070, "'ten"],
    [2080, "'den"], [2090, "'dan"], [2100, "'den"],
  ])('%i%s', (yil, ek) => expect(ayrilmaEki(yil)).toBe(ek))

  it('ayYil ve baslangicAyi', () => {
    expect(ayYil('2026-03-03T10:00')).toBe('Mart 2026')
    expect(ayYil('2026-03')).toBe('Mart 2026')
    expect(baslangicAyi('2026-03-03T10:00')).toBe("Mart 2026'dan beri")
    expect(baslangicAyi('2025-11-04T10:00')).toBe("Kasım 2025'ten beri")
    expect(baslangicAyi('2024-01-09T10:00')).toBe("Ocak 2024'ten beri")
  })

  it('kisaTarih: bu yıl yıl yazmaz, başka yıl yazar; gece yarısına yakın saat günü kaydırmaz', () => {
    expect(kisaTarih('2026-09-17T10:00', SIMDI)).toBe('17 Eylül')
    expect(kisaTarih('2025-12-30T23:30', SIMDI)).toBe('30 Aralık 2025')
    expect(kisaTarih('2026-09-01T00:15', SIMDI)).toBe('1 Eylül')
  })

  it('gunluTarihSaat: gün adı + gün ay (+ başka yılsa yıl) + saat', () => {
    expect(gunluTarihSaat('2026-09-24T14:00', SIMDI)).toBe('Perşembe 24 Eylül 14:00')
    expect(gunluTarihSaat('2026-09-25T01:00', SIMDI)).toBe('Cuma 25 Eylül 01:00')
    expect(gunluTarihSaat('2027-01-05T14:00', SIMDI)).toBe('Salı 5 Ocak 2027 14:00')
  })
})
```

Kırmızıyı gör: `npx vitest run src/danisan/dosyaOzeti.test.ts` → FAIL (`./dosyaOzeti` yok).

- [ ] **Adım 2: Saf işlevleri yaz** (`web/src/danisan/dosyaOzeti.ts`)

```ts
import { borcToplami } from '../borc'
import { AYLAR, GUN_TAM_ADLARI, haftaIndeksi, zamandanDate } from '../takvim/hafta'
import type { Randevu } from '../takvim/HaftalikTakvim'

/**
 * Danışan dosyası başlığının özeti (tasarım B2) — saf işlevler.
 *
 * TEK kaynak `kart.randevular`: `useDanisanDosyasi`'nin 2000–2100
 * penceresi, takvimdeki her yazmadan sonra `randevularTazele`/yamayla
 * tazelenir. "Şimdi" uygulamanın tek kaynağıdır (`yerelGun.ts`,
 * `useDakikalikSimdi`). Karşılaştırmalar 16 karakterlik duvar saati
 * dizgileriyle yapılır; "geçmiş" = `baslangic <= simdi` (A2). `Date`'e
 * yalnızca gün ADI için `zamandanDate` ile çevrilir.
 *
 * | Parça | Tanım |
 * |---|---|
 * | "N. seans" | `geldi` sayısı (§5.1) |
 * | "…'dan beri" | ilk `geldi`'nin ayı (`baslangic ASC, id ASC`) |
 * | "Son" | `baslangic <= simdi` olan en son `geldi` |
 * | "Sıradaki" | `planlandi` ∧ `baslangic > simdi`, en erken (eşitlikte küçük `id`) |
 * | "işaretlenmemiş" | `planlandi` ∧ `bitis <= simdi` (süren seans sayılmaz) |
 * | "Ödenmemiş" | `borcToplami` — Bilgiler'deki bakiyeyle AYNI çağrı |
 */
export type OzetRandevusu = Pick<Randevu, 'id' | 'baslangic' | 'bitis' | 'durum' | 'ucret' | 'odendi'>

export type DosyaOzeti = {
  geldiSayisi: number
  ilkGeldi: OzetRandevusu | null
  sonGeldi: OzetRandevusu | null
  siradaki: OzetRandevusu | null
  isaretlenmemis: number
  odenmemisKurus: number
}

/** `baslangic ASC, id ASC` — ilk/son seansın ve seans numarasının TEK sırası. */
export function kronolojik(a: { baslangic: string; id: number }, b: { baslangic: string; id: number }): number {
  if (a.baslangic !== b.baslangic) return a.baslangic < b.baslangic ? -1 : 1
  return a.id - b.id
}

export function dosyaOzeti(randevular: readonly OzetRandevusu[], simdi: string): DosyaOzeti {
  const geldiler = randevular.filter((r) => r.durum === 'geldi').sort(kronolojik)
  const gecmisGeldiler = geldiler.filter((r) => r.baslangic <= simdi)
  const siradakiler = randevular
    .filter((r) => r.durum === 'planlandi' && r.baslangic > simdi)
    .sort(kronolojik)
  return {
    geldiSayisi: geldiler.length,
    ilkGeldi: geldiler[0] ?? null,
    sonGeldi: gecmisGeldiler[gecmisGeldiler.length - 1] ?? null,
    siradaki: siradakiler[0] ?? null,
    isaretlenmemis: randevular.filter((r) => r.durum === 'planlandi' && r.bitis <= simdi).length,
    odenmemisKurus: borcToplami(randevular),
  }
}

/** `"2026-03-03T10:00"` ya da `"2026-03"` → `"Mart 2026"`. */
export function ayYil(zaman: string): string {
  return `${AYLAR[Number(zaman.slice(5, 7)) - 1]} ${zaman.slice(0, 4)}`
}

// Birler basamağının okunuşu: bir(den) iki(den) üç(ten) dört(ten) beş(ten)
// altı(dan) yedi(den) sekiz(den) dokuz(dan).
const BIRLER_EKI = ['', "'den", "'den", "'ten", "'ten", "'ten", "'dan", "'den", "'den", "'dan"]
// Onlar: on(dan) yirmi(den) otuz(dan) kırk(tan) elli(den) altmış(tan)
// yetmiş(ten) seksen(den) doksan(dan).
const ONLAR_EKI = ['', "'dan", "'den", "'dan", "'tan", "'den", "'tan", "'ten", "'den", "'dan"]

/**
 * Sayıya gelen ayrılma eki (`'dan/'den/'tan/'ten`). Ek sayının OKUNUŞUNUN
 * son sözcüğüne uyar: "2026'dan" (altı), "2025'ten" (beş), "2040'tan"
 * (kırk), "2000'den" (bin), "2100'den" (yüz). Tasarımın örneği ("Mart
 * 2026'dan beri") her yıl için 'dan yazmak değildir.
 */
export function ayrilmaEki(sayi: number): string {
  const birler = sayi % 10
  if (birler !== 0) return BIRLER_EKI[birler]
  const onlar = Math.floor(sayi / 10) % 10
  if (onlar !== 0) return ONLAR_EKI[onlar]
  return "'den"
}

/** `"2026-03-03T10:00"` → `"Mart 2026'dan beri"`. */
export function baslangicAyi(zaman: string): string {
  return `${ayYil(zaman)}${ayrilmaEki(Number(zaman.slice(0, 4)))} beri`
}

/** `"17 Eylül"`; `simdi`'nin yılından farklıysa `"30 Aralık 2025"`. */
export function kisaTarih(zaman: string, simdi: string): string {
  const gunAy = `${Number(zaman.slice(8, 10))} ${AYLAR[Number(zaman.slice(5, 7)) - 1]}`
  return zaman.slice(0, 4) === simdi.slice(0, 4) ? gunAy : `${gunAy} ${zaman.slice(0, 4)}`
}

/** `"Perşembe 24 Eylül 14:00"` (başka yılsa yıl da). */
export function gunluTarihSaat(zaman: string, simdi: string): string {
  const gunAdi = GUN_TAM_ADLARI[haftaIndeksi(zamandanDate(zaman))]
  return `${gunAdi} ${kisaTarih(zaman, simdi)} ${zaman.slice(11, 16)}`
}
```

Yeşili gör: `npx vitest run src/danisan/dosyaOzeti.test.ts` → PASS.

- [ ] **Adım 3: Başarısız bileşen testlerini yaz**

`web/src/danisan/DanisanDosyasi.test.tsx`:
- İçe aktarmalara ekle: `import { useState } from 'react'`, `import type { Randevu } from '../takvim/HaftalikTakvim'`, ve `import { DanisanDosyasi } from './DanisanDosyasi'` satırını `import { DanisanDosyasi, type DosyaAltSekme } from './DanisanDosyasi'` yap.
- `proplar()` varsayılanlarına `bugun: '2026-09-14',` satırının ardına `simdi: '2026-09-20T12:00',` ekle. Dosyadaki bütün fikstür seansları bu andan öncedir.
- `IKI_SEANS` tanımının hemen ardına ekle:

```tsx
/**
 * Alt sekmeyi ve seçimi GERÇEK durumla tutan sarmalayıcı (üretimde
 * `AnaEkran` + `useDanisanSeanslari`). B2 bağlantılarının "Seanslar'a geç
 * ve seç" etkisi yalnızca böyle ölçülür.
 */
function Kontrollu({
  ilkAltSekme = 'seanslar',
  ilkSecili = null,
  ...oz
}: Partial<Proplar> & { ilkAltSekme?: DosyaAltSekme; ilkSecili?: number | null }) {
  const [altSekme, setAltSekme] = useState<DosyaAltSekme>(ilkAltSekme)
  const [secili, setSecili] = useState<number | null>(ilkSecili)
  return (
    <DanisanDosyasi
      {...proplar({ ...oz, altSekme, onAltSekme: setAltSekme, seciliSeansId: secili, onSeansSec: setSecili })}
    />
  )
}

function randevu(oz: Partial<Randevu>): Randevu {
  return {
    id: 1, client_id: 12, danisan_adi: 'Ayşe Yılmaz',
    baslangic: '2026-09-14T10:00', bitis: '2026-09-14T10:50',
    durum: 'geldi', ucret: 90000, odendi: false, seri_id: null, ...oz,
  }
}
```

Dosyanın sonuna ekle:

```tsx
// Plan B Görev 3 — başlık özeti (tasarım B2). "Şimdi" = proplar'ın simdi'si (20 Eylül 12:00).
describe('DanisanDosyasi — başlık özeti (tasarım B2)', () => {
  afterEach(() => vi.restoreAllMocks())

  const RANDEVULAR = [
    randevu({ id: 1, baslangic: '2026-03-03T10:00', bitis: '2026-03-03T10:50', odendi: true }),
    randevu({ id: 2, baslangic: '2026-09-08T10:00', bitis: '2026-09-08T10:50' }),
    randevu({ id: 3, baslangic: '2026-09-15T10:00', bitis: '2026-09-15T10:50', durum: 'gelmedi' }),
    randevu({ id: 4, baslangic: '2026-09-17T10:00', bitis: '2026-09-17T10:50', durum: 'iptal' }),
    randevu({ id: 5, baslangic: '2026-09-18T10:00', bitis: '2026-09-18T10:50', durum: 'planlandi' }),
    randevu({ id: 6, baslangic: '2026-09-24T14:00', bitis: '2026-09-24T14:50', durum: 'planlandi' }),
  ]
  // Aynı seansların dosya listesi karşılığı (sunucu sırası: en yeni üstte).
  const SEANSLAR = [...RANDEVULAR].reverse().map((r) =>
    seans({ appointment_id: r.id, baslangic: r.baslangic, durum: r.durum, ucret_kurus: r.ucret, odendi: r.odendi }),
  )
  const OZET =
    "2. seans · Mart 2026'dan beri · Son: 8 Eylül · Sıradaki: Perşembe 24 Eylül 14:00 · Ödenmemiş: 1.800,00 TL (+1 işaretlenmemiş)"
  const kartIle = (randevular: Randevu[]) => ({ ...sahteKart(), randevular })
  const ozet = () => screen.getByTestId('dosya-ozeti')
  const aktifSatir = () =>
    within(screen.getByTestId('seans-listesi')).getByRole('button', { current: true }).textContent

  it('adın hemen altında tek satır; iki alt sekmede de görünür', () => {
    const { rerender } = render(
      <DanisanDosyasi {...proplar({ kart: kartIle(RANDEVULAR), seanslar: SEANSLAR, seciliSeansId: 5 })} />,
    )
    expect(ozet().textContent).toBe(OZET)
    expect(ozet().previousElementSibling).toBe(screen.getByRole('heading', { level: 2 }))
    rerender(
      <DanisanDosyasi
        {...proplar({ kart: kartIle(RANDEVULAR), seanslar: SEANSLAR, seciliSeansId: 5, altSekme: 'bilgiler' })}
      />,
    )
    expect(ozet().textContent).toBe(OZET)
  })

  it('"Ödenmemiş" Bilgiler\'deki bakiyeyle AYNI sayı (gelmedi borcu dahil)', () => {
    render(<DanisanDosyasi {...proplar({ kart: kartIle(RANDEVULAR), seanslar: SEANSLAR, altSekme: 'bilgiler' })} />)
    const ozettekiBorc = /Ödenmemiş: ([\d.,]+ TL)/.exec(ozet().textContent ?? '')?.[1]
    const bakiye = screen.getAllByRole('term').find((e) => e.textContent === 'Bakiye')?.nextElementSibling?.textContent
    expect(ozettekiBorc).toBe('1.800,00 TL')
    expect(bakiye).toBe(ozettekiBorc)
  })

  it('olmayan parça yazılmaz: randevu yoksa satır yok; borç yokken işaretlenmemiş kendi parçasıdır', () => {
    const { rerender } = render(<DanisanDosyasi {...proplar({ kart: kartIle([]) })} />)
    expect(screen.queryByTestId('dosya-ozeti')).toBeNull()
    rerender(<DanisanDosyasi {...proplar({ kart: kartIle([RANDEVULAR[4]]) })} />)
    expect(ozet().textContent).toBe('1 işaretlenmemiş seans')
    expect(within(ozet()).queryAllByRole('button')).toHaveLength(0)
  })

  it('bağlantı Seanslar alt sekmesine geçer ve o seansı seçer (Bilgiler\'den de)', async () => {
    render(<Kontrollu kart={kartIle(RANDEVULAR)} seanslar={SEANSLAR} ilkAltSekme="bilgiler" ilkSecili={5} />)
    await userEvent.click(within(ozet()).getByRole('button', { name: 'Son: 8 Eylül' }))
    expect(screen.getByRole('tab', { name: 'Seanslar' }).getAttribute('aria-selected')).toBe('true')
    expect(aktifSatir()).toContain('8 Eylül 2026, 10:00')

    await userEvent.click(within(ozet()).getByRole('button', { name: "Mart 2026'dan beri" }))
    expect(aktifSatir()).toContain('3 Mart 2026, 10:00')
    await userEvent.click(within(ozet()).getByRole('button', { name: 'Sıradaki: Perşembe 24 Eylül 14:00' }))
    expect(aktifSatir()).toContain('24 Eylül 2026, 14:00')
  })

  it('seans etiket süzgecinde gizliyse süzgeç "Tüm seanslar"a çekilir; görünüyorsa süzgeç korunur', async () => {
    const etiketli = SEANSLAR.map((s) =>
      s.appointment_id === 1 ? { ...s, etiketler: ['kaygı'] } : s.appointment_id === 2 ? { ...s, etiketler: ['uyku'] } : s,
    )
    render(<Kontrollu kart={kartIle(RANDEVULAR)} seanslar={etiketli} ilkSecili={5} />)
    const secim = () => screen.getByLabelText('Etikete göre süz') as HTMLSelectElement
    await userEvent.selectOptions(secim(), 'kaygı')
    await userEvent.click(within(ozet()).getByRole('button', { name: 'Son: 8 Eylül' }))
    expect(secim().value).toBe('')
    expect(aktifSatir()).toContain('8 Eylül 2026, 10:00')

    // EKSİ YÖN: hedef süzgeçte görünüyorsa süzgece dokunulmaz.
    await userEvent.selectOptions(secim(), 'kaygı')
    await userEvent.click(within(ozet()).getByRole('button', { name: "Mart 2026'dan beri" }))
    expect(secim().value).toBe('kaygı')
    expect(aktifSatir()).toContain('3 Mart 2026, 10:00')
  })

  it('bağlantı seçilen satırı görünür alana getirir; ZATEN seçili seansın bağlantısı da yeniden getirir', async () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<Kontrollu kart={kartIle(RANDEVULAR)} seanslar={SEANSLAR} ilkSecili={2} />)
    const satirDugmesi = (metin: string) =>
      within(screen.getByTestId('seans-listesi')).getByText(metin).closest('button')
    // Açılışta seçili satır (takvimden/aramadan gelmekle aynı yol).
    expect(kaydir).toHaveBeenCalledTimes(1)
    expect(kaydir.mock.contexts[0]).toBe(satirDugmesi('8 Eylül 2026, 10:00'))

    await userEvent.click(within(ozet()).getByRole('button', { name: "Mart 2026'dan beri" }))
    expect(kaydir).toHaveBeenCalledTimes(2)
    expect(kaydir.mock.contexts[1]).toBe(satirDugmesi('3 Mart 2026, 10:00'))
    expect(kaydir).toHaveBeenLastCalledWith({ block: 'nearest' })

    // Seçim DEĞİŞMEDİ ama kullanıcı istedi (listeyi kaydırmış olabilir).
    await userEvent.click(within(ozet()).getByRole('button', { name: "Mart 2026'dan beri" }))
    expect(kaydir).toHaveBeenCalledTimes(3)
  })

  it('özet ve bağlantılar istek ATMAZ (tek kaynak kart.randevular)', async () => {
    const fetchCasusu = vi.spyOn(globalThis, 'fetch')
    render(<Kontrollu kart={kartIle(RANDEVULAR)} seanslar={SEANSLAR} ilkSecili={5} />)
    await userEvent.click(within(ozet()).getByRole('button', { name: 'Son: 8 Eylül' }))
    expect(fetchCasusu).not.toHaveBeenCalled()
  })
})
```

`web/src/danisan/SeansListesi.test.tsx`: içe aktarmalara `afterEach` ekle (`import { afterEach, describe, expect, it, vi } from 'vitest'`). Dosyanın sonuna ekle:

```tsx
describe('SeansListesi — seçili satır görünür alana gelir (tasarım B2/B3)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('açılışta seçili satır bir kez (en yakın kenara); aynı seçimle yeniden çizim kaydırmaz; seçim değişince ve kaydırma isteğiyle yeniden', () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    const iki = [
      seans({ appointment_id: 1, baslangic: '2026-09-14T10:00' }),
      seans({ appointment_id: 2, baslangic: '2026-09-07T10:00' }),
    ]
    const { rerender } = render(<SeansListesi seanslar={iki} secili={2} onSecim={() => {}} />)
    expect(kaydir).toHaveBeenCalledTimes(1)
    expect(kaydir.mock.contexts[0]).toBe(screen.getAllByRole('button')[1])
    expect(kaydir).toHaveBeenLastCalledWith({ block: 'nearest' })

    // Liste tazelemesi (yeni dizi, aynı seçim) KAYDIRMAZ.
    rerender(<SeansListesi seanslar={[...iki]} secili={2} onSecim={() => {}} />)
    expect(kaydir).toHaveBeenCalledTimes(1)

    rerender(<SeansListesi seanslar={iki} secili={1} onSecim={() => {}} />)
    expect(kaydir).toHaveBeenCalledTimes(2)
    expect(kaydir.mock.contexts[1]).toBe(screen.getAllByRole('button')[0])

    rerender(<SeansListesi seanslar={iki} secili={1} onSecim={() => {}} kaydirmaIstegi={1} />)
    expect(kaydir).toHaveBeenCalledTimes(3)
  })
})
```

`web/src/danisan/DanisanlarSekmesi.test.tsx`:
- İçe aktarmalara ekle: `import type { Randevu } from '../takvim/HaftalikTakvim'`.
- `function sahteKart(seciliDanisanId: number | null): KartVerisi {` → `function sahteKart(seciliDanisanId: number | null, randevular: Randevu[] = []): KartVerisi {` ve gövdedeki `randevular: [],` → `randevular,`.
- `function sahteDosya(seciliDanisanId: number | null): ReturnType<…> {` → `function sahteDosya(seciliDanisanId: number | null, randevular: Randevu[] = []): ReturnType<…> {` ve `kart: sahteKart(seciliDanisanId),` → `kart: sahteKart(seciliDanisanId, randevular),`.
- Dosyanın sonuna ekle:

```tsx
/**
 * Tasarım A2/B2: dosya özetinin "şimdi"si uygulamanın TEK kaynağından
 * (`useDakikalikSimdi`, burada `DanisanlarSekmesi`'nde çağrılır). Emsal:
 * `yerelGun.test.ts` (yalnızca Date ve interval sahte).
 */
describe('DanisanlarSekmesi — dosya özeti tek "şimdi"den (tasarım A2, B2)', () => {
  afterEach(() => vi.useRealTimers())

  function randevu(oz: Partial<Randevu>): Randevu {
    return {
      id: 1, client_id: 1, danisan_adi: 'Danışan 1',
      baslangic: '2026-09-24T10:00', bitis: '2026-09-24T10:50',
      durum: 'planlandi', ucret: null, odendi: false, seri_id: null, ...oz,
    }
  }
  function ciz(randevular: Randevu[]) {
    render(
      <DanisanlarSekmesi
        liste={sahteListe()}
        dosya={sahteDosya(1, randevular)}
        seanslar={bosSeanslar()}
        dosyaNotu={bosDosyaNotu()}
        altSekme="seanslar"
        onAltSekme={() => {}}
        {...ILGISIZ}
      />,
    )
  }

  // İstanbul UTC+3: 00:30'da UTC günü hâlâ DÜN (21:30). `toISOString`'den
  // türeyen bir "şimdi" dünkü 23:00'ı gelecek sayar: "Son" kaybolur.
  it('İstanbul 00:30: dünkü 23:00 seansı "Son", bugünkü 01:00 "Sıradaki"', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 25, 0, 30))
    ciz([
      randevu({ id: 1, baslangic: '2026-09-24T23:00', bitis: '2026-09-24T23:50', durum: 'geldi' }),
      randevu({ id: 2, baslangic: '2026-09-25T01:00', bitis: '2026-09-25T01:50' }),
    ])
    expect(screen.getByTestId('dosya-ozeti').textContent).toBe(
      "1. seans · Eylül 2026'dan beri · Son: 24 Eylül · Sıradaki: Cuma 25 Eylül 01:00",
    )
  })

  it('dakikalık tik: 13:59\'da "Sıradaki" olan 14:00 seansı 14:00\'te artık sıradaki değil', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 8, 24, 13, 59))
    ciz([randevu({ id: 1, baslangic: '2026-09-24T14:00', bitis: '2026-09-24T14:50' })])
    expect(screen.getByTestId('dosya-ozeti').textContent).toBe('Sıradaki: Perşembe 24 Eylül 14:00')
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    // Süren seans ne sıradaki ne işaretlenmemiş: satırın hiçbir parçası kalmaz.
    expect(screen.queryByTestId('dosya-ozeti')).toBeNull()
  })
})
```

Kırmızıyı gör: `npx vitest run src/danisan` → yeni testler FAIL (`dosya-ozeti` yok, `kaydir` çağrılmadı). `simdi` prop'u henüz yok ve bu yüzden `tsc` de kırmızı; vitest tipleri denetlemez.

- [ ] **Adım 4: Özet satırı bileşenini yaz** (`web/src/danisan/DosyaOzetiSatiri.tsx`)

```tsx
import { Fragment, type ReactNode } from 'react'
import { tlMetni } from '../para'
import { baslangicAyi, dosyaOzeti, gunluTarihSaat, kisaTarih, type OzetRandevusu } from './dosyaOzeti'

/**
 * Dosya başlığındaki soluk özet satırı (tasarım B2). Tanımlar `dosyaOzeti.ts`
 * başlığında. Olmayan parça yazılmaz, hiç parça yoksa satır da yok. Uyarı
 * rengi yok; onam ve saklama gibi bilgiler bu satıra girmez. Yeni istek yok.
 *
 * "…'dan beri", "Son" ve "Sıradaki" BAĞLANTIDIR: `onSec` o seansı seçer.
 * Çağıran (`DanisanDosyasi.ozettenSec`) Seanslar alt sekmesine geçer, gizleyen
 * etiket süzgecini sıfırlar ve satırı görünür alana getirtir. Bağlantılar
 * `<button>`: gezinmezler, seçerler. Erişilebilir adları görünen metindir.
 */
type Parca = { anahtar: string; dugum: ReactNode }

function Baglanti({ baslik, onClick, children }: { baslik: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      title={baslik}
      onClick={onClick}
      className="underline decoration-dotted underline-offset-2 hover:text-slate-800"
    >
      {children}
    </button>
  )
}

export function DosyaOzetiSatiri({
  randevular,
  simdi,
  onSec,
}: {
  randevular: readonly OzetRandevusu[]
  simdi: string
  onSec: (appointmentId: number) => void
}) {
  const o = dosyaOzeti(randevular, simdi)
  const parcalar: Parca[] = []
  if (o.geldiSayisi > 0) parcalar.push({ anahtar: 'sayi', dugum: `${o.geldiSayisi}. seans` })
  const ilk = o.ilkGeldi
  if (ilk !== null) {
    parcalar.push({
      anahtar: 'ilk',
      dugum: <Baglanti baslik="İlk seansı seç" onClick={() => onSec(ilk.id)}>{baslangicAyi(ilk.baslangic)}</Baglanti>,
    })
  }
  const son = o.sonGeldi
  if (son !== null) {
    parcalar.push({
      anahtar: 'son',
      dugum: <Baglanti baslik="Son seansı seç" onClick={() => onSec(son.id)}>{`Son: ${kisaTarih(son.baslangic, simdi)}`}</Baglanti>,
    })
  }
  const siradaki = o.siradaki
  if (siradaki !== null) {
    parcalar.push({
      anahtar: 'siradaki',
      dugum: (
        <Baglanti baslik="Sıradaki seansı seç" onClick={() => onSec(siradaki.id)}>
          {`Sıradaki: ${gunluTarihSaat(siradaki.baslangic, simdi)}`}
        </Baglanti>
      ),
    })
  }
  if (o.odenmemisKurus > 0) {
    parcalar.push({
      anahtar: 'borc',
      dugum:
        `Ödenmemiş: ${tlMetni(o.odenmemisKurus)}` +
        (o.isaretlenmemis > 0 ? ` (+${o.isaretlenmemis} işaretlenmemiş)` : ''),
    })
  } else if (o.isaretlenmemis > 0) {
    // "(+N)" bir borca eklenen şerhtir; borç yokken kendi parçası.
    parcalar.push({ anahtar: 'isaret', dugum: `${o.isaretlenmemis} işaretlenmemiş seans` })
  }
  if (parcalar.length === 0) return null
  return (
    <p data-testid="dosya-ozeti" className="-mt-1 mb-2 text-sm text-slate-500">
      {parcalar.map((p, i) => (
        <Fragment key={p.anahtar}>
          {i > 0 && ' · '}
          {p.dugum}
        </Fragment>
      ))}
    </p>
  )
}
```

- [ ] **Adım 5: Dosyaya ve listeye bağla**

`web/src/danisan/SeansListesi.tsx`:
- L1'e `import { useEffect, useRef } from 'react'` ekle.
- `Props`'a `yuklendi?: boolean` bloğunun ardına ekle:

```ts
  /**
   * Kullanıcının "bu seansı göster" isteği sayacı (tasarım B2 bağlantıları).
   * Seçim DEĞİŞMEDEN de (zaten seçili seansın bağlantısı) satırın yeniden
   * görünür alana getirilmesi için. Varsayılan 0.
   */
  kaydirmaIstegi?: number
```

- İmzayı `export function SeansListesi({ seanslar, secili, onSecim, yuklendi = true, kaydirmaIstegi = 0 }: Props) {` yap. `const yuklendiOzniteligi = …` satırının ardına ekle (erken dönüşten ÖNCE):

```tsx
  // Seçili satır görünür alana gelir (tasarım B2/B3): açılışta (takvimden,
  // aramadan gelince), seçim değişince ve kullanıcı istediğinde. `nearest`:
  // zaten görünüyorsa hiçbir şey kaymaz. Aynı seçimle liste tazelemesi
  // kaydırmaz (bağımlılıklar değişmez). Odak verilmez (A6).
  const seciliSatirRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    seciliSatirRef.current?.scrollIntoView({ block: 'nearest' })
  }, [etkiliSecili, kaydirmaIstegi])
```

- Satır `<button`'una `ref={aktif ? seciliSatirRef : undefined}` ekle.

`web/src/danisan/DanisanDosyasi.tsx`:
- İçe aktarmalara `import { DosyaOzetiSatiri } from './DosyaOzetiSatiri'` ekle.
- Modül başlığında "# Başlıkta danışanın ADI — iki alt sekmede de" bölümünün ardına ekle:

```ts
 * # Başlık özeti (tasarım B2)
 *
 * Adın altında tek, soluk satır (`DosyaOzetiSatiri`, tanımlar
 * `dosyaOzeti.ts`'te): TEK kaynağı `kart.randevular` ve `simdi`
 * (`DanisanlarSekmesi`'nin `useDakikalikSimdi`'si). İki alt sekmede de
 * görünür. "Ödenmemiş" Bilgiler'deki bakiyeyle AYNI işlevden
 * (`borcToplami`) gelir. Bağlantıları (`ozettenSec`) Seanslar alt sekmesine
 * geçer ve o seansı seçer. Seans etiket süzgecinde gizliyse süzgeç
 * "Tüm seanslar"a çekilir. Satır, `kaydirmaIstegi` ile seçim değişmese de
 * görünür alana getirilir.
```

- `Props`'a `bugun: string` satırının ardına ekle:

```ts
  /**
   * Uygulamadaki TEK "şimdi" (`yerelGun.ts::useDakikalikSimdi`, çağıran
   * `DanisanlarSekmesi`): başlık özeti (B2) ve liste düzeni (B3).
   */
  simdi: string
```

- Bileşen parametrelerine `bugun,`'un ardına `simdi,` ekle.
- `const [suzgec, setSuzgec] = useState('')` satırının ardına `const [kaydirmaIstegi, setKaydirmaIstegi] = useState(0)` ekle.
- `const etkinSuzgec = …` satırından sonra ve `const gorunenSeanslar =`'dan önce ekle:

```tsx
  // B2 bağlantısı: Seanslar'a geç, seç, gizleyen süzgeci kaldır, göster.
  // Hedef yüklü listede YOKSA (bayat liste, `seansSec` yeniden çektirir)
  // süzgecin onu gizleyip gizlemeyeceği bilinemez: süzgeç yine sıfırlanır.
  function ozettenSec(appointmentId: number) {
    const hedef = seanslar.find((s) => s.appointment_id === appointmentId)
    if (etkinSuzgec !== '' && !(hedef?.etiketler.includes(etkinSuzgec) ?? false)) setSuzgec('')
    onAltSekme('seanslar')
    onSeansSec(appointmentId)
    setKaydirmaIstegi((n) => n + 1)
  }
```

- `</h2>`'nin hemen ardına ekle:

```tsx
      <DosyaOzetiSatiri randevular={kart.randevular} simdi={simdi} onSec={ozettenSec} />
```

- `<SeansListesi …>` çağrısına `kaydirmaIstegi={kaydirmaIstegi}` ekle.

`web/src/danisan/DanisanlarSekmesi.tsx`:
- `import { yerelGun } from '../screens/anaEkranKancalari/yerelGun'` → `import { useDakikalikSimdi, yerelGun } from '../screens/anaEkranKancalari/yerelGun'`.
- `const { arsivOnayi } = liste` satırının hemen ÖNÜNE ekle:

```tsx
  // Dosya özetinin ve liste düzeninin "şimdi"si: uygulamanın TEK kaynağı,
  // dakikada bir yenilenir (`TakvimSekmesi` emsali: kanca sekme
  // bileşeninde, `AnaEkran`'da değil; görünmeyen sekme tiklemez).
  const simdi = useDakikalikSimdi()
```

- `<DanisanDosyasi …>` çağrısına `bugun={yerelGun(new Date())}` satırının ardına `simdi={simdi}` ekle.

- [ ] **Adım 6: Yeşili gör** — `npx vitest run src/danisan src/screens` → PASS; `npm --prefix web run build` → hata yok.

- [ ] **Adım 7: Tam doğrulama**

`npm --prefix web run build`, `npm --prefix web run lint` (≤ 18 uyarı), web/ `npx vitest run` (PASS, sayıyı yaz), `npx playwright test --reporter=line` (47 PASS; özet satırı e2e'de yeni metin; `notlar.spec.ts`'in Bilgiler bölümündeki `getByText` iddiaları özetle çakışmaz).

- [ ] **Adım 8: Commit**

```bash
git add web/src/danisan/dosyaOzeti.ts web/src/danisan/dosyaOzeti.test.ts web/src/danisan/DosyaOzetiSatiri.tsx web/src/danisan/DanisanDosyasi.tsx web/src/danisan/DanisanDosyasi.test.tsx web/src/danisan/SeansListesi.tsx web/src/danisan/SeansListesi.test.tsx web/src/danisan/DanisanlarSekmesi.tsx web/src/danisan/DanisanlarSekmesi.test.tsx
git commit -m "Danisan dosyasi: baslik ozeti (seans sayisi, son, siradaki, odenmemis) ve baglantilari

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Mutasyonlar:**
- `dosyaOzeti.ts`: `odenmemisKurus: borcToplami(randevular)` → `randevular.filter((r) => r.durum === 'geldi' && !r.odendi).reduce((t, r) => t + (r.ucret ?? 0), 0)` → "'Ödenmemiş' Bilgiler'deki bakiyeyle AYNI sayı" ve `dosyaOzeti.test.ts` "borç kuralının KENDİSİ" kırılır.
- `dosyaOzeti.ts`: siradaki süzgecinde `r.baslangic > simdi` → `>=` → "TAM şimdi başlayan … sıradaki DEĞİL" kırılır.
- `dosyaOzeti.ts`: işaretlenmemiş süzgecinde `r.bitis <= simdi` → `r.baslangic <= simdi` → "süren sayılmaz" kırılır.
- `dosyaOzeti.ts`: `BIRLER_EKI[5]` `"'ten"` → `"'dan"` → `ayrilmaEki` "2005'ten" ve "2025'ten" ile "Kasım 2025'ten beri" kırılır.
- `DanisanDosyasi.tsx`: `ozettenSec`'ten süzgeç satırını sil → "seans etiket süzgecinde gizliyse…" kırılır.
- `DanisanDosyasi.tsx`: `setKaydirmaIstegi(...)` satırını sil → "ZATEN seçili seansın bağlantısı da yeniden getirir" (üçüncü çağrı yok) kırılır.
- `DanisanlarSekmesi.tsx`: `const simdi = useDakikalikSimdi()` → `const simdi = new Date().toISOString().slice(0, 16)` → "İstanbul 00:30" ve "dakikalık tik" kırılır.

---

### Task 4: B3 — Uzun geçmiş düzeni (spec §6 B3, §5.1 seans numarası)

**Files:**
- Create: `web/src/danisan/seansGruplari.ts`, `web/src/danisan/seansGruplari.test.ts`
- Modify: `web/src/danisan/dosyaOzeti.ts` (+ `seansNumaralari`), `web/src/danisan/dosyaOzeti.test.ts`
- Rewrite: `web/src/danisan/SeansListesi.tsx` (aşağıda tamamı)
- Modify: `web/src/danisan/SeansListesi.test.tsx` (her `<SeansListesi` çağrısına `simdi`; bir fikstür; yeni describe)
- Modify: `web/src/danisan/DanisanDosyasi.tsx` (modül başlığı; numara haritası; sol sütun; `SeansListesi` prop'ları)
- Modify: `web/src/danisan/DanisanDosyasi.test.tsx` (yeni describe)
- Modify: `web/src/danisan/DanisanlarSekmesi.test.tsx` (yeni describe)
- Modify: `web/src/screens/AnaEkran.yayilim.test.tsx` (`listeSatiri` L600–603, `listeMetni` ~L1199, test ~L856–871, ~L1679)

**Interfaces:**
- Produces (`seansGruplari.ts`): `export type AyGrubu = { anahtar: string; baslik: string; seanslar: DanisanSeansi[] }`, `export type SeansGruplari = { yaklasan: DanisanSeansi[]; aylar: AyGrubu[] }`, `export function seansGruplari(seanslar: readonly DanisanSeansi[], simdi: string): SeansGruplari`.
- Produces (`dosyaOzeti.ts`): `export function seansNumaralari(randevular: readonly Pick<Randevu, 'id' | 'baslangic' | 'durum'>[]): ReadonlyMap<number, number>`.
- Changes: `SeansListesi` Props += `simdi: string` (zorunlu), `numaralar?: ReadonlyMap<number, number>`.
- DOM (Görev 5 e2e'si kullanır): `data-testid="seans-listesi"` artık gruplar taşıyan bir `<div>` (boşken yine `<p>`). "Yaklaşan (n)" `<h3>` içinde bir düğme (`aria-expanded`; seçili seans gruptaysa `disabled`). Ay başlıkları `<h3>` ("Eylül 2026 · 4 seans"), `sticky top-0`. Satırda `data-not="yok|bos|dolu"`, numara `data-testid="seans-numarasi"` ("#14"). Liste sütunu `data-testid="seans-listesi-sutunu"`.

- [ ] **Adım 1: Başarısız saf işlev testlerini yaz**

`web/src/danisan/seansGruplari.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DanisanSeansi } from '../api'
import { seansGruplari } from './seansGruplari'

const SIMDI = '2026-09-20T12:00'

function s(appointment_id: number, baslangic: string, durum = 'geldi'): DanisanSeansi {
  return { appointment_id, baslangic, durum, ucret_kurus: 90000, odendi: false, not_ilk_satiri: null, etiketler: [] }
}
const kimlikler = (liste: DanisanSeansi[]) => liste.map((x) => x.appointment_id)

describe('seansGruplari (tasarım B3)', () => {
  it('Yaklaşan = baslangic > simdi, durumdan bağımsız, EN YAKIN üstte; eşitlikte küçük kimlik', () => {
    const g = seansGruplari(
      [s(5, '2026-10-01T14:00', 'planlandi'), s(4, '2026-09-24T14:00', 'geldi'), s(3, '2026-09-24T14:00', 'iptal'), s(1, '2026-09-14T10:00')],
      SIMDI,
    )
    expect(kimlikler(g.yaklasan)).toEqual([3, 4, 5])
    expect(g.aylar.map((a) => kimlikler(a.seanslar))).toEqual([[1]])
  })

  it('TAM şimdi başlayan seans GEÇMİŞTİR (A2: baslangic <= simdi)', () => {
    const g = seansGruplari([s(1, SIMDI, 'planlandi')], SIMDI)
    expect(g.yaklasan).toEqual([])
    expect(g.aylar.map((a) => a.baslik)).toEqual(['Eylül 2026'])
  })

  it('geçmiş aylara göre: en yeni ay ve ay içinde en yeni üstte; yıl sınırı ayrı ay; başlık sayısı yalnızca geldi', () => {
    const liste = [
      s(1, '2026-08-25T10:00', 'iptal'), s(4, '2026-09-14T10:00'), s(2, '2026-09-01T10:00'),
      s(3, '2026-09-07T10:00', 'gelmedi'), s(9, '2025-12-30T10:00'), s(10, '2026-01-06T10:00'),
    ]
    const g = seansGruplari(liste, SIMDI)
    expect(g.aylar.map((a) => [a.baslik, kimlikler(a.seanslar)])).toEqual([
      ['Eylül 2026 · 2 seans', [4, 3, 2]],
      ['Ağustos 2026', [1]],
      ['Ocak 2026 · 1 seans', [10]],
      ['Aralık 2025 · 1 seans', [9]],
    ])
    // Girdi sırasına güvenilmez.
    expect(seansGruplari([...liste].reverse(), SIMDI)).toEqual(g)
  })

  it('aynı başlangıçlı iki geçmiş seans: büyük kimlik üstte (sunucunun `id DESC`\'i)', () => {
    const g = seansGruplari([s(4, '2026-09-14T10:00'), s(7, '2026-09-14T10:00')], SIMDI)
    expect(kimlikler(g.aylar[0].seanslar)).toEqual([7, 4])
  })

  it('boş liste', () => expect(seansGruplari([], SIMDI)).toEqual({ yaklasan: [], aylar: [] }))
})
```

`web/src/danisan/dosyaOzeti.test.ts`: içe aktarmaya `seansNumaralari` ekle. Dosyanın sonuna ekle:

```ts
describe('seansNumaralari (tasarım B3, §5.1: yalnızca geldi)', () => {
  it('geldi seanslar baslangic ASC, id ASC ile 1..N; diğer durumlar haritada YOK', () => {
    const h = seansNumaralari([
      r({ id: 7, baslangic: '2026-09-14T10:00', durum: 'geldi' }),
      r({ id: 3, baslangic: '2026-09-01T10:00', durum: 'geldi' }),
      r({ id: 5, baslangic: '2026-09-07T10:00', durum: 'gelmedi' }),
      r({ id: 9, baslangic: '2026-09-14T10:00', durum: 'geldi' }),
      r({ id: 2, baslangic: '2026-10-01T10:00', durum: 'planlandi' }),
    ])
    expect([...h.entries()].sort((a, b) => a[1] - b[1])).toEqual([[3, 1], [7, 2], [9, 3]])
    expect(h.has(5)).toBe(false)
  })

  it('başlıktaki "N. seans", "ilk" ve "Son" numaralarla tutarlı', () => {
    const liste = [
      r({ id: 1, baslangic: '2026-03-03T10:00', durum: 'geldi' }),
      r({ id: 2, baslangic: '2026-09-08T10:00', durum: 'geldi' }),
      r({ id: 3, baslangic: '2026-10-01T10:00', durum: 'geldi' }),
    ]
    const o = dosyaOzeti(liste, SIMDI)
    const h = seansNumaralari(liste)
    expect(o.geldiSayisi).toBe(h.size)
    expect(h.get(o.ilkGeldi!.id)).toBe(1)
    expect(h.get(o.sonGeldi!.id)).toBe(2)
  })
})
```

Kırmızıyı gör: `npx vitest run src/danisan/seansGruplari.test.ts src/danisan/dosyaOzeti.test.ts` → FAIL.

- [ ] **Adım 2: Saf işlevleri yaz**

`web/src/danisan/seansGruplari.ts`:

```ts
import type { DanisanSeansi } from '../api'
import { ayYil } from './dosyaOzeti'

/**
 * Danışan dosyasındaki seans listesinin düzeni (tasarım B3) — saf işlev.
 *
 * - `yaklasan`: `baslangic > simdi` olan satırlar (durumdan bağımsız), EN
 *   YAKIN üstte (`baslangic ASC, appointment_id ASC`): grup "sırada ne var"
 *   diye açılır. "Geçmiş" her yerde aynı tanımdır: `baslangic <= simdi`
 *   (A2), yani tam şimdi başlayan seans geçmiştedir.
 * - `aylar`: geçmiş seanslar takvim ayına göre. En yeni ay ve ay içinde en
 *   yeni seans üstte (`baslangic DESC, appointment_id DESC`, sunucunun
 *   sırası; yine de burada AÇIKÇA sıralanır, girdi sırasına güvenilmez).
 *   Başlık "Eylül 2026 · 4 seans": sayı o gruptaki `geldi` satırları (§5.1),
 *   `geldi` yoksa yalnızca ay adı.
 *
 * Girdi ÇAĞIRANIN süzdüğü listedir ("Gruplama var olan süzgeçlerden sonra
 * yapılır"): sayı GÖRÜNEN satırları sayar. Karşılaştırmalar 16 karakterlik
 * duvar saati dizgileriyle yapılır.
 */
export type AyGrubu = { anahtar: string; baslik: string; seanslar: DanisanSeansi[] }
export type SeansGruplari = { yaklasan: DanisanSeansi[]; aylar: AyGrubu[] }

function artan(a: DanisanSeansi, b: DanisanSeansi): number {
  if (a.baslangic !== b.baslangic) return a.baslangic < b.baslangic ? -1 : 1
  return a.appointment_id - b.appointment_id
}

export function seansGruplari(seanslar: readonly DanisanSeansi[], simdi: string): SeansGruplari {
  const yaklasan = seanslar.filter((s) => s.baslangic > simdi).sort(artan)
  const gecmis = seanslar.filter((s) => s.baslangic <= simdi).sort((a, b) => artan(b, a))
  const aylar: AyGrubu[] = []
  for (const s of gecmis) {
    const anahtar = s.baslangic.slice(0, 7)
    const son = aylar[aylar.length - 1]
    if (son !== undefined && son.anahtar === anahtar) son.seanslar.push(s)
    else aylar.push({ anahtar, baslik: '', seanslar: [s] })
  }
  for (const g of aylar) {
    const geldi = g.seanslar.filter((s) => s.durum === 'geldi').length
    g.baslik = geldi > 0 ? `${ayYil(g.anahtar)} · ${geldi} seans` : ayYil(g.anahtar)
  }
  return { yaklasan, aylar }
}
```

`web/src/danisan/dosyaOzeti.ts`: dosyanın sonuna ekle:

```ts
/**
 * Seans numarası haritası (tasarım B3, §5.1): `geldi` seanslar
 * `baslangic ASC, id ASC` sırasıyla 1..N (`appointment_id → n`). TEK kaynak
 * `kart.randevular`, süzgeçten ÖNCE: etiket süzgeci numarayı değiştirmez.
 * Haritada olmayan satırda numara gösterilmez.
 */
export function seansNumaralari(
  randevular: readonly Pick<Randevu, 'id' | 'baslangic' | 'durum'>[],
): ReadonlyMap<number, number> {
  const harita = new Map<number, number>()
  randevular
    .filter((r) => r.durum === 'geldi')
    .sort(kronolojik)
    .forEach((r, i) => harita.set(r.id, i + 1))
  return harita
}
```

Yeşili gör: iki test dosyası PASS.

- [ ] **Adım 3: Başarısız bileşen testlerini yaz**

`web/src/danisan/SeansListesi.test.tsx`:
- İçe aktarmaya `within` ve `userEvent` ekle: `import { render, screen, within } from '@testing-library/react'` ve `import userEvent from '@testing-library/user-event'`.
- `function seans(...)`'ın ardına `const SIMDI = '2026-09-20T12:00'` ekle. Dosyadaki bütün fikstürler bu andan öncedir.
- Dosyadaki HER `<SeansListesi` çağrısına (var olan 15'i ve Görev 3'ün kaydırma testindeki dördü) `simdi={SIMDI}` ekle.
- **Fikstür düzeltmesi**: "bir seansa tıklamak onSecim'i o seansın randevu kimliğiyle çağırır" testinde `seanslar={[seans({ appointment_id: 7 }), seans({ appointment_id: 8 })]}` → `seanslar={[seans({ appointment_id: 7, baslangic: '2026-09-14T10:00' }), seans({ appointment_id: 8, baslangic: '2026-09-07T10:00' })]}`. Gerekçe (raporda yaz): liste artık açıkça `baslangic DESC, id DESC` sıralanıyor (B3). İki satır aynı anda başlarsa 8 üste çıkar ve `[1]` 7 olur. Test "tıklanan satırın kimliği bildirilir"i ölçer; ayrık tarihlerle aynı iddia (`[1]` → 8) korunur.
- Dosyanın sonuna ekle:

```tsx
describe('SeansListesi — uzun geçmiş düzeni (tasarım B3)', () => {
  afterEach(() => vi.restoreAllMocks())

  const UZUN = [
    seans({ appointment_id: 30, baslangic: '2026-10-01T14:00', durum: 'planlandi' }),
    seans({ appointment_id: 20, baslangic: '2026-09-24T14:00', durum: 'planlandi', not_ilk_satiri: '' }),
    seans({ appointment_id: 10, baslangic: '2026-09-14T10:00', durum: 'geldi' }),
    seans({ appointment_id: 9, baslangic: '2026-09-07T10:00', durum: 'gelmedi' }),
    seans({ appointment_id: 8, baslangic: '2026-09-01T10:00', durum: 'geldi' }),
    seans({ appointment_id: 7, baslangic: '2026-08-25T10:00', durum: 'iptal' }),
  ]
  const liste = () => screen.getByTestId('seans-listesi')
  const basliklar = () => within(liste()).getAllByRole('heading').map((h) => h.textContent)
  const tarihler = () =>
    [...liste().querySelectorAll('li')].map((li) => /^\d+ \S+ \d{4}, \d{2}:\d{2}/.exec(li.textContent ?? '')?.[0])
  const satir = (t: string) => within(liste()).getByText(t).closest('button') as HTMLButtonElement
  const yaklasan = () => within(liste()).getByRole('button', { name: /^Yaklaşan \(\d+\)$/ }) as HTMLButtonElement

  it('Yaklaşan (n) en üstte ve KATLI; açınca en yakın üstte; kapatınca gizlenir', async () => {
    render(<SeansListesi seanslar={UZUN} secili={10} onSecim={() => {}} simdi={SIMDI} />)
    expect(yaklasan().textContent).toBe('Yaklaşan (2)')
    expect(yaklasan().getAttribute('aria-expanded')).toBe('false')
    expect(basliklar()).toEqual(['Yaklaşan (2)', 'Eylül 2026 · 2 seans', 'Ağustos 2026'])
    expect(tarihler()).toEqual([
      '14 Eylül 2026, 10:00', '7 Eylül 2026, 10:00', '1 Eylül 2026, 10:00', '25 Ağustos 2026, 10:00',
    ])

    await userEvent.click(yaklasan())
    expect(yaklasan().getAttribute('aria-expanded')).toBe('true')
    expect(tarihler().slice(0, 2)).toEqual(['24 Eylül 2026, 14:00', '1 Ekim 2026, 14:00'])
    await userEvent.click(yaklasan())
    expect(tarihler()).toHaveLength(4)
  })

  it('seçili seans Yaklaşan\'daysa grup ZORLA açık (düğme devre dışı); seçim geçmişe dönünce kapalı tercih geçerli', () => {
    const { rerender } = render(<SeansListesi seanslar={UZUN} secili={30} onSecim={() => {}} simdi={SIMDI} />)
    expect(yaklasan().getAttribute('aria-expanded')).toBe('true')
    expect(yaklasan().disabled).toBe(true)
    expect(within(liste()).getByRole('button', { current: true }).textContent).toContain('1 Ekim 2026, 14:00')

    rerender(<SeansListesi seanslar={UZUN} secili={10} onSecim={() => {}} simdi={SIMDI} />)
    expect(yaklasan().getAttribute('aria-expanded')).toBe('false')
    expect(yaklasan().disabled).toBe(false)
    expect(tarihler()).toHaveLength(4)
  })

  it('kullanıcı açtıysa seçim geçmişte değişse de grup açık kalır', async () => {
    const { rerender } = render(<SeansListesi seanslar={UZUN} secili={10} onSecim={() => {}} simdi={SIMDI} />)
    await userEvent.click(yaklasan())
    rerender(<SeansListesi seanslar={UZUN} secili={8} onSecim={() => {}} simdi={SIMDI} />)
    expect(yaklasan().getAttribute('aria-expanded')).toBe('true')
  })

  it('gelecekteki satır "Not yazılmamış" YAZMAZ (notsuzluk data-not\'ta); geçmişteki yazar; boş not ayrımı korunur', () => {
    render(<SeansListesi seanslar={UZUN} secili={30} onSecim={() => {}} simdi={SIMDI} />)
    expect(satir('1 Ekim 2026, 14:00').textContent).not.toContain('Not yazılmamış')
    expect(satir('1 Ekim 2026, 14:00').getAttribute('data-not')).toBe('yok')
    expect(satir('24 Eylül 2026, 14:00').textContent).toContain('Not açıldı, henüz boş')
    expect(satir('24 Eylül 2026, 14:00').getAttribute('data-not')).toBe('bos')
    expect(satir('14 Eylül 2026, 10:00').textContent).toContain('Not yazılmamış')
  })

  it('ay başlığı yapışkan; sayı o gruptaki GÖRÜNEN geldi satırları', () => {
    render(
      <SeansListesi seanslar={UZUN.filter((x) => x.appointment_id !== 10)} secili={8} onSecim={() => {}} simdi={SIMDI} />,
    )
    expect(basliklar()).toEqual(['Yaklaşan (2)', 'Eylül 2026 · 1 seans', 'Ağustos 2026'])
    const eylul = within(liste()).getByRole('heading', { name: 'Eylül 2026 · 1 seans' })
    for (const sinif of ['sticky', 'top-0', 'bg-white']) expect(eylul.className, sinif).toContain(sinif)
  })

  it('#n yalnızca haritadaki satırda (harita dışarıdan, süzgeçten bağımsız)', () => {
    const numaralar = new Map([[8, 1], [10, 2]])
    render(<SeansListesi seanslar={UZUN} secili={10} onSecim={() => {}} simdi={SIMDI} numaralar={numaralar} />)
    const numara = (t: string) => within(satir(t)).queryByTestId('seans-numarasi')?.textContent ?? null
    expect(numara('14 Eylül 2026, 10:00')).toBe('#2')
    expect(numara('1 Eylül 2026, 10:00')).toBe('#1')
    expect(numara('7 Eylül 2026, 10:00')).toBeNull()
  })

  it('TAM şimdi başlayan satır geçmiştedir: Yaklaşan yok, "Not yazılmamış" yazar', () => {
    render(
      <SeansListesi seanslar={[seans({ appointment_id: 1, baslangic: SIMDI, durum: 'planlandi' })]} secili={1} onSecim={() => {}} simdi={SIMDI} />,
    )
    expect(basliklar()).toEqual(['Eylül 2026'])
    expect(within(liste()).getByRole('button', { current: true }).textContent).toContain('Not yazılmamış')
  })

  it('Yaklaşan\'daki seans seçilince grup açılır VE satır görünür alana getirilir', () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    const { rerender } = render(<SeansListesi seanslar={UZUN} secili={10} onSecim={() => {}} simdi={SIMDI} />)
    expect(kaydir).toHaveBeenCalledTimes(1)
    rerender(<SeansListesi seanslar={UZUN} secili={30} onSecim={() => {}} simdi={SIMDI} />)
    expect(kaydir).toHaveBeenCalledTimes(2)
    expect(kaydir.mock.contexts[1]).toBe(satir('1 Ekim 2026, 14:00'))
  })
})
```

`web/src/danisan/DanisanDosyasi.test.tsx`: dosyanın sonuna ekle:

```tsx
// Plan B Görev 4 — uzun geçmiş (tasarım B3). "Şimdi" 20 Eylül 12:00.
describe('DanisanDosyasi — uzun geçmiş (tasarım B3)', () => {
  afterEach(() => vi.restoreAllMocks())

  const RANDEVULAR = [
    randevu({ id: 6, baslangic: '2026-09-24T14:00', bitis: '2026-09-24T14:50', durum: 'planlandi' }),
    randevu({ id: 1, baslangic: '2026-09-14T10:00', bitis: '2026-09-14T10:50' }),
    randevu({ id: 2, baslangic: '2026-09-08T10:00', bitis: '2026-09-08T10:50' }),
    randevu({ id: 3, baslangic: '2026-08-31T10:00', bitis: '2026-08-31T10:50' }),
  ]
  const SEANSLAR = [
    seans({ appointment_id: 6, baslangic: '2026-09-24T14:00', durum: 'planlandi' }),
    seans({ appointment_id: 1, baslangic: '2026-09-14T10:00', etiketler: ['kaygı'] }),
    seans({ appointment_id: 2, baslangic: '2026-09-08T10:00' }),
    seans({ appointment_id: 3, baslangic: '2026-08-31T10:00', etiketler: ['kaygı'] }),
  ]
  const kartIle = (randevular: Randevu[]) => ({ ...sahteKart(), randevular })
  const liste = () => screen.getByTestId('seans-listesi')
  const basliklar = () => within(liste()).getAllByRole('heading').map((h) => h.textContent)
  const numara = (t: string) =>
    within(within(liste()).getByText(t).closest('button') as HTMLElement).queryByTestId('seans-numarasi')?.textContent ?? null

  it('gruplama süzgeçten SONRA; numara süzgeçten bağımsız (kart.randevular\'dan)', async () => {
    render(<DanisanDosyasi {...proplar({ kart: kartIle(RANDEVULAR), seanslar: SEANSLAR, seciliSeansId: 1 })} />)
    expect(basliklar()).toEqual(['Yaklaşan (1)', 'Eylül 2026 · 2 seans', 'Ağustos 2026 · 1 seans'])
    expect(numara('14 Eylül 2026, 10:00')).toBe('#3')
    expect(numara('31 Ağustos 2026, 10:00')).toBe('#1')

    await userEvent.selectOptions(screen.getByLabelText('Etikete göre süz'), 'kaygı')
    expect(basliklar()).toEqual(['Eylül 2026 · 1 seans', 'Ağustos 2026 · 1 seans'])
    expect(numara('14 Eylül 2026, 10:00')).toBe('#3')
    expect(numara('31 Ağustos 2026, 10:00')).toBe('#1')
  })

  it('B2 "Sıradaki" bağlantısı katlı Yaklaşan\'ı açar, satırı seçer ve görünür alana getirir', async () => {
    const kaydir = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<Kontrollu kart={kartIle(RANDEVULAR)} seanslar={SEANSLAR} ilkSecili={1} />)
    const dugme = within(liste()).getByRole('button', { name: 'Yaklaşan (1)' })
    expect(dugme.getAttribute('aria-expanded')).toBe('false')

    await userEvent.click(
      within(screen.getByTestId('dosya-ozeti')).getByRole('button', { name: 'Sıradaki: Perşembe 24 Eylül 14:00' }),
    )
    expect(dugme.getAttribute('aria-expanded')).toBe('true')
    const hedef = within(liste()).getByText('24 Eylül 2026, 14:00').closest('button')
    expect(hedef?.getAttribute('aria-current')).toBe('true')
    expect(kaydir.mock.contexts.at(-1)).toBe(hedef)
  })

  it('aylar arasında taşınan randevu: boşalan ay başlığı kalkar, #n ve "…\'dan beri" yeni sıraya göre', () => {
    const { rerender } = render(
      <DanisanDosyasi {...proplar({ kart: kartIle(RANDEVULAR), seanslar: SEANSLAR, seciliSeansId: 1 })} />,
    )
    expect(screen.getByTestId('dosya-ozeti').textContent).toContain("Ağustos 2026'dan beri")

    // Takvimde taşıma: kart `randevularTazele` ile, liste `yapiDegisti` ile
    // yeniden çekilir; ikisi de yeni başlangıcı taşır.
    rerender(
      <DanisanDosyasi
        {...proplar({
          kart: kartIle(
            RANDEVULAR.map((r) => (r.id === 3 ? { ...r, baslangic: '2026-09-10T10:00', bitis: '2026-09-10T10:50' } : r)),
          ),
          seanslar: SEANSLAR.map((x) => (x.appointment_id === 3 ? { ...x, baslangic: '2026-09-10T10:00' } : x)),
          seciliSeansId: 1,
        })}
      />,
    )
    expect(basliklar()).toEqual(['Yaklaşan (1)', 'Eylül 2026 · 3 seans'])
    expect(numara('8 Eylül 2026, 10:00')).toBe('#1')
    expect(numara('10 Eylül 2026, 10:00')).toBe('#2')
    expect(numara('14 Eylül 2026, 10:00')).toBe('#3')
    expect(screen.getByTestId('dosya-ozeti').textContent).toContain("Eylül 2026'dan beri")
  })

  it('liste sütunu kendi içinde kayar; not sütunu ondan ayrı', () => {
    render(
      <DanisanDosyasi
        {...proplar({ kart: kartIle(RANDEVULAR), seanslar: SEANSLAR, seciliSeansId: 1, not: not({ appointment_id: 1 }) })}
      />,
    )
    const sutun = screen.getByTestId('seans-listesi-sutunu')
    for (const sinif of ['sticky', 'top-0', 'self-start', 'max-h-[100dvh]', 'overflow-y-auto']) {
      expect(sutun.className, sinif).toContain(sinif)
    }
    expect(sutun.contains(liste())).toBe(true)
    expect(sutun.contains(screen.getByLabelText('Seans notu'))).toBe(false)
  })
})
```

`web/src/danisan/DanisanlarSekmesi.test.tsx`: dosyanın sonuna ekle:

```tsx
describe('DanisanlarSekmesi — liste düzeni tek "şimdi"den (tasarım A2, B3)', () => {
  afterEach(() => vi.useRealTimers())

  function sabitSeanslar(liste: DanisanSeansi[], secili: number): ReturnType<typeof useDanisanSeanslari> {
    return { ...bosSeanslar(), seanslar: liste, yuklendi: true, seciliSeansId: secili }
  }
  function ciz(liste: DanisanSeansi[], secili: number) {
    render(
      <DanisanlarSekmesi
        liste={sahteListe()}
        dosya={sahteDosya(1)}
        seanslar={sabitSeanslar(liste, secili)}
        dosyaNotu={bosDosyaNotu()}
        altSekme="seanslar"
        onAltSekme={() => {}}
        {...ILGISIZ}
      />,
    )
  }
  const basliklar = () =>
    within(screen.getByTestId('seans-listesi')).getAllByRole('heading').map((h) => h.textContent)

  it('İstanbul 00:30: dünkü 23:00 geçmişte (Eylül grubu), bugünkü 01:00 Yaklaşan\'da', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 25, 0, 30))
    ciz(
      [
        seans({ appointment_id: 2, baslangic: '2026-09-25T01:00', durum: 'planlandi' }),
        seans({ appointment_id: 1, baslangic: '2026-09-24T23:00', durum: 'geldi' }),
      ],
      1,
    )
    expect(basliklar()).toEqual(['Yaklaşan (1)', 'Eylül 2026 · 1 seans'])
  })

  it('dakikalık tik: 14:00 seansı 13:59\'da Yaklaşan\'da, 14:00\'te Eylül grubunda', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date(2026, 8, 24, 13, 59))
    ciz(
      [
        seans({ appointment_id: 7, baslangic: '2026-09-24T14:00', durum: 'planlandi' }),
        seans({ appointment_id: 6, baslangic: '2026-09-24T10:00', durum: 'geldi' }),
      ],
      6,
    )
    expect(basliklar()).toEqual(['Yaklaşan (1)', 'Eylül 2026 · 1 seans'])
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(basliklar()).toEqual(['Eylül 2026 · 1 seans'])
    expect(screen.getByTestId('seans-listesi').textContent).toContain('24 Eylül 2026, 14:00')
  })
})
```

Kırmızıyı gör: `npx vitest run src/danisan` → yeni testler FAIL ("Yaklaşan" düğmesi ve başlıklar yok, `seans-listesi-sutunu` yok).

- [ ] **Adım 4: `SeansListesi.tsx`'i yeniden yaz** (dosyanın YENİ tamamı)

```tsx
import { useEffect, useRef, useState } from 'react'
import type { DanisanSeansi } from '../api'
import { tlMetni } from '../para'
import { zamanMetni } from '../tarih'
import { seansGruplari } from './seansGruplari'

/**
 * Danışan dosyasının Seanslar alt sekmesinde SOL kolon (tasarım B3 — uzun
 * geçmiş düzeni). Düzenin kuralı saf işlevde (`seansGruplari.ts`); bu
 * bileşen yalnızca çizer.
 *
 * # Düzen
 *
 *   - **"Yaklaşan (n)"**: `baslangic > simdi` satırları, en yakın üstte,
 *     varsayılan KATLI. Açıklık seçimden türetilir: seçili seans buradaysa
 *     grup ZORLA açıktır (düğme devre dışı). Kullanıcının açıp kapaması
 *     yalnızca öyle değilken geçerlidir. Katlı grubun satırları DOM'da
 *     YOKTUR: kullanıcının göremediği satıra test de tıklayamaz.
 *   - Gelecekteki satır "Not yazılmamış" YAZMAZ (henüz yaşanmadı). Notsuzluk
 *     yine `data-not="yok"` ile okunur; boş not ("Not açıldı, henüz boş")
 *     ve önizleme aynen görünür.
 *   - Geçmiş seanslar AYLARA göre: "Eylül 2026 · 4 seans" (sayı GÖRÜNEN
 *     `geldi` satırları). Başlıklar kaydırma kabı içinde yapışkandır.
 *   - `geldi` satırında sıra numarası ("#14"): harita çağırandan gelir
 *     (`dosyaOzeti.ts::seansNumaralari`, `kart.randevular`, süzgeçten önce).
 *     Haritada olmayan satırda numara yok.
 *
 * Grup `<div role="group">`, landmark DEĞİL: her ay için bir `region`,
 * "Seans" adlı bölgeyi arayan seçicileri belirsizleştirirdi.
 *
 * # Kontrollü bileşen: seçimi TUTMAZ
 *
 * `secili` dışarıdan gelir, tıklama yalnızca `onSecim` ile bildirilir
 * (sahibi `useDanisanSeanslari`, son inceleme M1). `secili === null` iken
 * `seanslar[0]` (sunucunun en yenisi) vurgulanır: sahibi olmayan çağıranlar
 * için sözleşme (bkz. bu dosyanın testleri). Üretimde liste doluyken
 * `null` geçmez.
 *
 * # Seçili satır görünür alana gelir (tasarım B2/B3)
 *
 * Açılışta (takvimden, aramadan gelince), seçim değişince ve
 * `kaydirmaIstegi` artınca (B2 bağlantısı, seçim değişmese de):
 * `scrollIntoView({ block: 'nearest' })`, zaten görünüyorsa hiçbir şey kaymaz.
 * Liste tazelemesi kaydırmaz. Odak verilmez (A6).
 *
 * # Satırda etiketler (Plan 6 Görev 6)
 *
 * Etiket adları küçük, TIKLANAMAZ işaretler: satırın tamamı bir düğme ve
 * düğme içinde düğme olamaz. Süzme bu bileşende DEĞİL: `DanisanDosyasi`
 * süzülmüş listeyi geçirir.
 */
type Props = {
  seanslar: DanisanSeansi[]
  secili: number | null
  onSecim: (appointmentId: number) => void
  /**
   * `useDanisanSeanslari`nin seçili danışan için yanıtı aldığını işaretler.
   * Varsayılan `true`. `e2e/kabuk.spec.ts` bunu bir SENKRONİZASYON
   * BARİYERİ olarak okur (`data-yuklendi`).
   */
  yuklendi?: boolean
  /** Uygulamadaki TEK "şimdi" (`useDakikalikSimdi`); Yaklaşan/geçmiş sınırı. */
  simdi: string
  /** `appointment_id → n` (yalnızca `geldi`); bkz. modül başlığı. */
  numaralar?: ReadonlyMap<number, number>
  /** Bkz. modül başlığı "Seçili satır görünür alana gelir". Varsayılan 0. */
  kaydirmaIstegi?: number
}

const DURUM_ADLARI: Record<string, string> = {
  planlandi: 'Planlandı',
  geldi: 'Geldi',
  gelmedi: 'Gelmedi',
  iptal: 'İptal',
}

// Sunucu bu bileşenin bilmediği bir durum gönderirse ham kodu olduğu gibi
// göster — uydurulmuş bir Türkçe etiket, ham değeri göstermekten kötüdür.
function durumAdi(durum: string): string {
  return DURUM_ADLARI[durum] ?? durum
}

/**
 * `ucret_kurus`: `null` = "ücret hiç girilmemiş", `0` = "ücretsiz seans" —
 * ikisi ekranda AYNI görünmemeli. `null` iken `tlMetni(0)` BASILMAZ.
 */
function ucretMetni(kurus: number | null): string {
  return kurus === null ? '—' : tlMetni(kurus)
}

/**
 * `not_ilk_satiri`: `null` = "not hiç yazılmamış", `''` = "not açılmış ama
 * boş bırakılmış" — ikisi ekranda AYNI görünmemeli. Gelecekteki satırda
 * `null` HİÇBİR ŞEY yazmaz (tasarım B3).
 */
function notOnizlemesi(satir: string | null, gelecek: boolean) {
  if (satir === null) {
    return gelecek ? null : <span className="italic text-slate-400">Not yazılmamış</span>
  }
  if (satir === '') {
    return <span className="italic text-slate-400">Not açıldı, henüz boş</span>
  }
  return <span className="truncate text-slate-600">{satir}</span>
}

const BOS_NUMARALAR: ReadonlyMap<number, number> = new Map()

export function SeansListesi({
  seanslar,
  secili,
  onSecim,
  yuklendi = true,
  simdi,
  numaralar = BOS_NUMARALAR,
  kaydirmaIstegi = 0,
}: Props) {
  const etkiliSecili = secili ?? seanslar[0]?.appointment_id ?? null
  const yuklendiOzniteligi = yuklendi ? 'evet' : 'hayir'
  // Kullanıcının Yaklaşan grubu için tercihi; seçim onu ZORLA ezebilir.
  const [yaklasanIstegi, setYaklasanIstegi] = useState(false)
  const seciliSatirRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    seciliSatirRef.current?.scrollIntoView({ block: 'nearest' })
  }, [etkiliSecili, kaydirmaIstegi])

  if (seanslar.length === 0) {
    return (
      <p data-testid="seans-listesi" data-yuklendi={yuklendiOzniteligi} className="text-sm text-slate-500">
        Bu danışanın kayıtlı bir seansı yok.
      </p>
    )
  }

  const { yaklasan, aylar } = seansGruplari(seanslar, simdi)
  const zorlaAcik = yaklasan.some((s) => s.appointment_id === etkiliSecili)
  const yaklasanAcik = zorlaAcik || yaklasanIstegi

  function satir(s: DanisanSeansi, gelecek: boolean) {
    const aktif = s.appointment_id === etkiliSecili
    const numara = numaralar.get(s.appointment_id)
    return (
      <li key={s.appointment_id}>
        <button
          ref={aktif ? seciliSatirRef : undefined}
          type="button"
          aria-current={aktif ? 'true' : undefined}
          data-not={s.not_ilk_satiri === null ? 'yok' : s.not_ilk_satiri === '' ? 'bos' : 'dolu'}
          onClick={() => onSecim(s.appointment_id)}
          className={
            'flex w-full flex-col items-start gap-0.5 rounded border px-2 py-1 text-left ' +
            (aktif ? 'border-slate-900 bg-slate-100' : 'border-slate-200 hover:bg-slate-50')
          }
        >
          <span className="flex w-full items-center justify-between gap-2">
            <span className="font-medium">{zamanMetni(s.baslangic)}</span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-slate-500">
              {numara !== undefined && (
                <span data-testid="seans-numarasi" className="text-slate-400">
                  #{numara}
                </span>
              )}
              <span>{durumAdi(s.durum)}</span>
            </span>
          </span>
          <span className="flex w-full items-center justify-between gap-2 text-xs">
            {notOnizlemesi(s.not_ilk_satiri, gelecek)}
            <span className="ml-auto shrink-0 text-slate-500">
              {ucretMetni(s.ucret_kurus)}
              {s.odendi ? ' · Ödendi' : ''}
            </span>
          </span>
          {s.etiketler.length > 0 && (
            <span className="flex flex-wrap gap-1" data-testid="satir-etiketleri">
              {s.etiketler.map((ad) => (
                <span key={ad} className="rounded-full bg-sky-50 px-1.5 text-[11px] text-sky-800">
                  {ad}
                </span>
              ))}
            </span>
          )}
        </button>
      </li>
    )
  }

  return (
    <div data-testid="seans-listesi" data-yuklendi={yuklendiOzniteligi} className="flex flex-col gap-3 text-sm">
      {yaklasan.length > 0 && (
        <div role="group" aria-labelledby="seans-grubu-yaklasan">
          <h3 id="seans-grubu-yaklasan" className="sticky top-0 z-10 bg-white py-0.5">
            <button
              type="button"
              aria-expanded={yaklasanAcik}
              aria-controls={yaklasanAcik ? 'yaklasan-seanslar' : undefined}
              disabled={zorlaAcik}
              title={zorlaAcik ? 'Seçili seans bu grupta; grup açık kalır.' : undefined}
              onClick={() => setYaklasanIstegi(!yaklasanAcik)}
              className="text-xs font-medium text-slate-600 underline-offset-2 hover:underline disabled:no-underline"
            >
              {`Yaklaşan (${yaklasan.length})`}
            </button>
          </h3>
          {yaklasanAcik && (
            <ul id="yaklasan-seanslar" className="mt-1 flex flex-col gap-1">
              {yaklasan.map((s) => satir(s, true))}
            </ul>
          )}
        </div>
      )}
      {aylar.map((g) => (
        <div key={g.anahtar} role="group" aria-labelledby={`seans-ayi-${g.anahtar}`}>
          <h3
            id={`seans-ayi-${g.anahtar}`}
            className="sticky top-0 z-10 bg-white py-0.5 text-xs font-medium text-slate-600"
          >
            {g.baslik}
          </h3>
          <ul className="mt-1 flex flex-col gap-1">{g.seanslar.map((s) => satir(s, false))}</ul>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Adım 5: Dosyaya bağla** (`web/src/danisan/DanisanDosyasi.tsx`)

- `import { DosyaOzetiSatiri } from './DosyaOzetiSatiri'` satırının ardına `import { seansNumaralari } from './dosyaOzeti'` ekle.
- Modül başlığında Görev 3'ün "# Başlık özeti (tasarım B2)" bölümünün ardına ekle:

```ts
 * # Uzun geçmiş (tasarım B3)
 *
 * Liste sütunu kendi içinde kayar (`sticky top-0 self-start
 * max-h-[100dvh] overflow-y-auto`): uzun geçmiş sayfayı uzatmaz, sağdaki
 * not görünür kalır. Katlı "Yaklaşan", ay grupları ve `#n`
 * `SeansListesi`'nde. Numara haritası BURADA, `kart.randevular`'dan ve
 * süzgeçten ÖNCE hesaplanır: etiket süzgeci numarayı değiştirmez. Gruplama
 * ise süzülmüş listeyle yapılır.
```

- `const gorunenSeanslar = …` tanımının ardına ekle:

```tsx
  // B3: `geldi` sıra numarası — TEK kaynak kart.randevular, süzgeçten önce.
  const numaralar = seansNumaralari(kart.randevular)
```

- Seanslar panelinde, hata dalı dışındaki fragment'ın ilk çocuğu olan `<div>` (içinde "Etikete göre süz" ve `<SeansListesi>`) → şunu yap: `<div data-testid="seans-listesi-sutunu" className="sticky top-0 self-start max-h-[100dvh] overflow-y-auto">`. Üstüne yorum: `{/* Kendi içinde kayar (B3): uzun geçmiş sayfayı uzatmaz, not görünür kalır. `self-start`: ızgara hücresi gerilirse yapışacak yer kalmaz. */}`.
- `<SeansListesi …>` çağrısına `simdi={simdi}` ve `numaralar={numaralar}` ekle.

- [ ] **Adım 6: `AnaEkran.yayilim.test.tsx`'i B3'e uyarla**

Bu dosyanın fikstüründe R202 (14 Eylül) BUGUN_SAATI'nden (9 Eylül 12:00) SONRA: B3'le katlı Yaklaşan grubundadır. Satırı çizilmediği için tıklama ve metin iddiaları onu bulamaz. İddialar GEVŞETİLMEZ: yardımcılar grubu kullanıcının yapacağı gibi açar, sonra aynı iddiayı kurar. Negatif iddialar (`not.toContain('14 Eylül 2026')`) da açık grupta ölçülür ve anlamlı kalır.

(a) `listeSatiri` (L600–603) şununla değiştirilir:

```tsx
/**
 * Katlı "Yaklaşan" grubunu (tasarım B3) kullanıcının yapacağı gibi açar.
 * Grup zaten açıksa (seçili seans oradaysa zorla açık ve düğme devre dışı)
 * ya da hiç yoksa bir şey yapmaz. Katlı grubun satırları DOM'da yoktur;
 * tıklama ve metin iddiaları ancak açık grupta anlamlıdır.
 */
function yaklasaniAc() {
  const dugme = within(screen.getByTestId('seans-listesi')).queryByRole('button', {
    name: /^Yaklaşan \(\d+\)$/,
    expanded: false,
  }) as HTMLButtonElement | null
  if (dugme !== null && !dugme.disabled) fireEvent.click(dugme)
}

/** Dosya listesindeki seans satırı (erişilebilir ad tarih metnini içerir). */
function listeSatiri(tarihMetni: string) {
  yaklasaniAc()
  return within(screen.getByTestId('seans-listesi')).getByText(tarihMetni).closest('button') as HTMLElement
}
```

(b) "Bayatlık" describe'ındaki `const listeMetni = () => screen.getByTestId('seans-listesi').textContent ?? ''` şununla değiştirilir:

```tsx
  // Katlı Yaklaşan'daki seanslar da (14/21 Eylül, gelecekte) metne girsin:
  // pozitif iddialar onları arar, negatifler açık grupta anlamlıdır.
  const listeMetni = () => {
    yaklasaniAc()
    return screen.getByTestId('seans-listesi').textContent ?? ''
  }
```

(c) "ters yön: takvimde not yazılınca dosya listesinde 'Not yazılmamış' DEĞİL, notun ilk satırı görünür" testi (~L856–871): adı `'ters yön: takvimde not yazılınca dosya listesindeki notsuz satır notun ilk satırını gösterir'` olur. İlk iddia `expect(listeSatiri('14 Eylül 2026, 10:00').textContent).toContain('Not yazılmamış')` şununla değiştirilir:

```tsx
    // 202 GELECEKTE: tasarım B3'le gelecekteki satır "Not yazılmamış"
    // YAZMAZ; notsuzluk `data-not`ta okunur (öncül aynı: liste notsuz yüklendi).
    expect(listeSatiri('14 Eylül 2026, 10:00').getAttribute('data-not')).toBe('yok')
```

Son iki iddia (`not.toContain('Not yazılmamış')`, `toContain('Uyku düzeni iyileşmiş')`) şununla değiştirilir:

```tsx
    expect(satir.getAttribute('data-not')).toBe('dolu')
    expect(satir.textContent).toContain('Uyku düzeni iyileşmiş')
```

(d) "I4 — seans listesi hatası…" testinde (~L1679) `expect(screen.getByTestId('seans-listesi').querySelectorAll('li')).toHaveLength(2)` satırının ÖNÜNE `yaklasaniAc()` ekle. İddia 2 kalır: iki seans da çizilmiş olmalı.

Çalıştır: `npx vitest run src/screens/AnaEkran.yayilim.test.tsx`. Başka bir test kırılırsa kök nedeni yaz. Satır katlı gruptaysa aynı yardımcıyı kullan. İddia gevşetilmez; her değişiklik raporda dosya:satır ve gerekçeyle yer alır.

- [ ] **Adım 7: Yeşili gör** — `npx vitest run src/danisan src/screens` → PASS; `npm --prefix web run build` → hata yok.

- [ ] **Adım 8: Tam doğrulama**

`npm --prefix web run build`, `npm --prefix web run lint` (≤ 18 uyarı), web/ `npx vitest run` (PASS, sayıyı yaz), `npx playwright test --reporter=line` (47 PASS). `kabuk.spec.ts` "danışana tıklayınca geçmiş seansları ve notu açılır" tek seanslıdır: seans gelecekteyse varsayılan seçim odur ve grup zorla açıktır; önizleme görünür.

- [ ] **Adım 9: Commit**

```bash
git add web/src/danisan/seansGruplari.ts web/src/danisan/seansGruplari.test.ts web/src/danisan/dosyaOzeti.ts web/src/danisan/dosyaOzeti.test.ts web/src/danisan/SeansListesi.tsx web/src/danisan/SeansListesi.test.tsx web/src/danisan/DanisanDosyasi.tsx web/src/danisan/DanisanDosyasi.test.tsx web/src/danisan/DanisanlarSekmesi.test.tsx web/src/screens/AnaEkran.yayilim.test.tsx
git commit -m "Danisan dosyasi: katli Yaklasan, ay gruplari, seans numarasi ve kendi icinde kayan liste

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Mutasyonlar:**
- `seansGruplari.ts`: `s.baslangic > simdi` → `s.baslangic >= simdi` (ve geçmişte `<=` → `<`) → "TAM şimdi başlayan seans GEÇMİŞTİR" (iki dosyada) kırılır.
- `SeansListesi.tsx`: `const yaklasanAcik = zorlaAcik || yaklasanIstegi` → `= yaklasanIstegi` → "seçili seans Yaklaşan'daysa grup ZORLA açık" ve `DanisanDosyasi` "B2 'Sıradaki' bağlantısı katlı Yaklaşan'ı açar" kırılır.
- `seansGruplari.ts`: başlık sayısında `s.durum === 'geldi'` süzgecini kaldır (tüm satırları say) → "ay başlığı… GÖRÜNEN geldi satırları" ve `seansGruplari.test.ts` başlıkları kırılır.
- `DanisanDosyasi.tsx`: `seansNumaralari(kart.randevular)` → `seansNumaralari(gorunenSeanslar.map((s) => ({ id: s.appointment_id, baslangic: s.baslangic, durum: s.durum })))` → "numara süzgeçten bağımsız" kırılır.
- `dosyaOzeti.ts::seansNumaralari`: `.sort(kronolojik)` → `.sort((a, b) => (a.baslangic < b.baslangic ? -1 : 1))` → `seansNumaralari` eşitlik testi kırılabilir (id 7 ile 9 aynı anda). Kırılmazsa raporda "tanımsız sıralama; `kronolojik` olmadan kararsız" diye yaz ve testi "aynı başlangıçta küçük kimlik önce" yönünde girdiyi ters çevirerek güçlendir.
- `SeansListesi.tsx`: `notOnizlemesi`'nde `gelecek ? null :` kısmını kaldır → "gelecekteki satır 'Not yazılmamış' YAZMAZ" kırılır.
- `SeansListesi.tsx`: ay başlığından `sticky` sınıfını sil → "ay başlığı yapışkan" kırılır (e2e Görev 5'te de).
- `DanisanDosyasi.tsx`: liste sütunundan `max-h-[100dvh]`'ı sil → "liste sütunu kendi içinde kayar" kırılır.

---

### Task 5: Uçtan uca B1–B3 ve temizlik (spec §7, §8)

**Files:**
- Create: `e2e/danisan-dosyasi.spec.ts`
- Modify: `playwright.config.ts` (`SUNUCULAR`'a `danisan-dosyasi`, port 7709)
- Modify: taramanın bulduğu yorum kalıntıları (listeyi rapora yaz)

**Interfaces:**
- Consumes: Görev 2–4'ün DOM kancaları (Interfaces bölümleri): searchbox "Danışan ara", `danisan-listesi-sutunu`, `li[data-vurgulu]`, kısayol düğmesi, bilgi satırı, `dosya-ozeti` ve bağlantıları, `seans-listesi` (`data-yuklendi`), "Yaklaşan (n)", ay `<h3>`'leri, `seans-numarasi`, `seans-listesi-sutunu`, "Seans notu" etiketli editör. API: `POST /api/danisanlar` (201), `POST /api/randevular` (201, `tekrar_sayisi`), `PATCH /api/randevular/{id}` (200), `PATCH /api/randevular/{id}/odeme` (204).
- Produces: yok (yalnızca test). Dosyanın testleri sırayla ve aynı sunucuda koşar; her test kendi danışanını kurar.

- [ ] **Adım 1: Projeyi kaydet** (`playwright.config.ts`, `SUNUCULAR`'ın sonuna)

```ts
  // Danışan listesi ve dosyası (tasarım 2026-09-24 §6 B1–B3): Türkçe arama
  // ve klavye, ekleme kısayolu, başlık özeti ve bağlantıları, katlı
  // Yaklaşan, yapışkan ay başlıkları, kendi içinde kayan liste.
  { ad: 'danisan-dosyasi', spec: 'danisan-dosyasi.spec.ts', port: 7709 },
```

- [ ] **Adım 2: Testleri yaz** (`e2e/danisan-dosyasi.spec.ts`)

```ts
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { kurulumYap } from './yardimcilar'

/**
 * Danışan listesi ve dosyası (tasarım 2026-09-24 §6 B1–B3) uçtan uca.
 *
 * Birim testleri jsdom'da yerleşim ÖLÇEMEZ. Yapışkan ay başlığı, listenin
 * kendi içinde kayması, notun görünür kalması ve "satırı görünür alana
 * getirme" yalnızca burada, gerçek tarayıcıda ölçülür.
 *
 * # Saat
 *
 * B2/B3 senaryoları TARAYICININ saatini `page.clock.setFixedTime` ile
 * Perşembe 24 Eylül 2026 12:00'a (yerel) sabitler. Özet ("Son",
 * "Sıradaki") ve "Yaklaşan" gerçek saate bağlı kalsaydı test tarihe göre
 * değişirdi. Zamanlayıcılar işler, `Date` sabittir. Sunucunun saati
 * değişmez: randevular API'yle, açık tarihlerle kurulur ve bu senaryolarda
 * sunucu saate bakan bir karar vermez.
 *
 * # Paylaşılan sunucu
 *
 * Dosya kendi sunucusunda ve veri dizininde koşar (port 7709). Testler
 * sırayla koşar; her test kendi danışanını kurar. API'yle eklenen danışan
 * ekrandaki listeye ancak liste yeniden çekilince girer (açılışta çekilir):
 * `dosyayiAc` sayfayı yeniden açar.
 */

// Yumuşak kaydırma (`index.css`, hareketi azaltma tercihi yoksa) konum
// ölçümlerini animasyon boyunca oynatırdı; ölçen testler anlık kaydırma ister.
test.use({ reducedMotion: 'reduce' })

/** B2/B3 senaryolarının "şimdi"si: Perşembe 24 Eylül 2026 12:00 (yerel). */
const SIMDI = new Date(2026, 8, 24, 12, 0)

const BILGI = 'Arşivlenmiş danışanlar bu listede aranmaz; ⌘K hızlı arama arşivi de tarar.'

async function danisanlaraGec(page: Page) {
  await page.getByRole('tab', { name: 'Danışanlar', exact: true }).click()
}

function aramaKutusu(page: Page): Locator {
  return page.getByRole('searchbox', { name: 'Danışan ara', exact: true })
}

function acmaDugmeleri(page: Page): Locator {
  return page.getByTestId('danisan-listesi-sutunu').getByRole('button', { name: /dosyasını aç$/ })
}

async function dosyaYuklendi(page: Page, ad: string) {
  await expect(page.getByRole('heading', { level: 2, name: ad, exact: true })).toBeVisible()
  await expect(page.locator('[data-testid="seans-listesi"][data-yuklendi="evet"]')).toBeVisible()
}

/** Danışanı FORMLA ekler (B1: imleç ad alanında, Enter kaydeder, dosya açılır). */
async function formlaEkle(page: Page, ad: string) {
  await page.getByRole('button', { name: 'Danışan ekle', exact: true }).click()
  const adAlani = page.getByLabel('Ad soyad', { exact: true })
  await expect(adAlani).toBeFocused()
  await adAlani.fill(ad)
  await adAlani.press('Enter')
  await dosyaYuklendi(page, ad)
}

/** Listede tarih metni tam eşleşen satır düğmesi. */
function satir(liste: Locator, tarih: string): Locator {
  return liste.getByRole('button').filter({ has: liste.page().getByText(tarih, { exact: true }) })
}

async function danisanOlustur(request: APIRequestContext, ad: string): Promise<number> {
  const yanit = await request.post('/api/danisanlar', { data: { ad_soyad: ad } })
  expect(yanit.status()).toBe(201)
  return ((await yanit.json()) as { id: number }).id
}

type Kayit = { id: number; baslangic: string }

async function randevuOlustur(
  request: APIRequestContext,
  govde: { client_id: number; baslangic: string; bitis: string; ucret: number | null; tekrar_sayisi?: number },
): Promise<Kayit[]> {
  const yanit = await request.post('/api/randevular', { data: govde })
  expect(yanit.status()).toBe(201)
  return (await yanit.json()) as Kayit[]
}

async function durumYaz(request: APIRequestContext, id: number, durum: string) {
  const yanit = await request.patch(`/api/randevular/${id}`, { data: { durum } })
  expect(yanit.status()).toBe(200)
}

async function odendiYaz(request: APIRequestContext, id: number) {
  const yanit = await request.patch(`/api/randevular/${id}/odeme`, { data: { odendi: true } })
  expect(yanit.status()).toBe(204)
}

/**
 * Uzun geçmiş (SIMDI = 24 Eylül 2026 12:00'a göre):
 *  - 3 Mart – 8 Eylül her salı 10:00, 28 seans (tek seri), hepsi "geldi";
 *    8 Eylül HARİÇ hepsi ödendi.
 *  - 15 Eylül "gelmedi", ücretli, ödenmemiş (borca girer, §5.1).
 *  - 22 Eylül planlı: bitmiş, işaretlenmemiş.
 *  - 1 ve 8 Ekim 14:00 planlı (Yaklaşan).
 * Beklenen özet: "28. seans · Mart 2026'dan beri · Son: 8 Eylül · Sıradaki:
 * Perşembe 1 Ekim 14:00 · Ödenmemiş: 1.800,00 TL (+1 işaretlenmemiş)".
 * Ay grupları: Eylül 2 · Ağustos 4 · Temmuz 4 · Haziran 5 · Mayıs 4 ·
 * Nisan 4 · Mart 5 seans.
 */
async function uzunGecmisKur(request: APIRequestContext, ad: string) {
  const id = await danisanOlustur(request, ad)
  const seri = await randevuOlustur(request, {
    client_id: id, baslangic: '2026-03-03T10:00', bitis: '2026-03-03T10:50', ucret: 90000, tekrar_sayisi: 28,
  })
  expect(seri).toHaveLength(28)
  for (const r of seri) {
    await durumYaz(request, r.id, 'geldi')
    if (r.baslangic !== '2026-09-08T10:00') await odendiYaz(request, r.id)
  }
  const [gelmedi] = await randevuOlustur(request, {
    client_id: id, baslangic: '2026-09-15T10:00', bitis: '2026-09-15T10:50', ucret: 90000,
  })
  await durumYaz(request, gelmedi.id, 'gelmedi')
  for (const [baslangic, bitis] of [
    ['2026-09-22T10:00', '2026-09-22T10:50'],
    ['2026-10-01T14:00', '2026-10-01T14:50'],
    ['2026-10-08T14:00', '2026-10-08T14:50'],
  ]) {
    await randevuOlustur(request, { client_id: id, baslangic, bitis, ucret: 90000 })
  }
}

/** Sayfayı yeniden açar (liste yeniden çekilir) ve danışanın dosyasını açar. */
async function dosyayiAc(page: Page, ad: string) {
  await kurulumYap(page)
  await danisanlaraGec(page)
  await page.getByRole('button', { name: `${ad} dosyasını aç`, exact: true }).click()
  await dosyaYuklendi(page, ad)
}

// ---------------------------------------------------------------------------

test('B1: arama Turkce harf duyarsiz suzer ve istek atmaz; oklar ve Enter dosyayi acar; Esc temizler; imlec kendiliginden gelmez', async ({ page }) => {
  await kurulumYap(page)
  await danisanlaraGec(page)
  const kutu = aramaKutusu(page)
  await expect(kutu).toBeVisible()
  await expect(kutu).not.toBeFocused()
  for (const ad of ['İpek Işık', 'Ipek Sahin', 'Ayşe Kaya']) await formlaEkle(page, ad)

  // Süzme sunucuya GİTMEZ (tasarım B1, §8). Ana pencere yoklama yapmaz;
  // bariyer (`dosyaYuklendi`) son dosyanın isteklerinin bittiğini gösterir.
  const apiIstekleri: string[] = []
  page.on('request', (istek) => {
    if (new URL(istek.url()).pathname.startsWith('/api/')) apiIstekleri.push(istek.url())
  })

  await kutu.fill('IŞIK')
  await expect(acmaDugmeleri(page)).toHaveText(['İpek Işık'])
  await kutu.fill('ipek')
  await expect(acmaDugmeleri(page)).toHaveCount(2)
  expect((await acmaDugmeleri(page).allTextContents()).sort()).toEqual(['Ipek Sahin', 'İpek Işık'])
  expect(apiIstekleri).toEqual([])

  // Yazınca ilk eşleşme vurgulu; ↓ ikinciye geçer; Enter onu açar.
  const sira = await acmaDugmeleri(page).allTextContents()
  await kutu.press('ArrowDown')
  const vurgulu = page.locator('li[data-vurgulu="evet"]').getByRole('button', { name: /dosyasını aç$/ })
  await expect(vurgulu).toHaveText(sira[1])
  await kutu.press('Enter')
  await dosyaYuklendi(page, sira[1])
  await expect(kutu).toBeFocused()

  await kutu.press('Escape')
  await expect(kutu).toHaveValue('')
  expect(await acmaDugmeleri(page).count()).toBeGreaterThanOrEqual(3)
  await expect(page.locator('li[data-vurgulu="evet"]')).toHaveCount(0)
})

test('B1: eslesme yoksa kisayol formu o adla acar, imlec ad alaninda; Esc kapatir; Enter kaydeder ve dosya acilir', async ({ page }) => {
  await kurulumYap(page)
  await danisanlaraGec(page)
  const kutu = aramaKutusu(page)
  await kutu.fill('Işıl Çağrı')
  await expect(page.getByText(BILGI, { exact: true })).toBeVisible()
  const kisayol = page.getByRole('button', { name: "'Işıl Çağrı' adıyla yeni danışan ekle", exact: true })

  await kisayol.click()
  const adAlani = page.getByLabel('Ad soyad', { exact: true })
  await expect(adAlani).toHaveValue('Işıl Çağrı')
  await expect(adAlani).toBeFocused()
  await adAlani.press('Escape')
  await expect(adAlani).toHaveCount(0)

  await kisayol.click()
  await expect(adAlani).toBeFocused()
  await adAlani.press('Enter')
  await dosyaYuklendi(page, 'Işıl Çağrı')
  await expect(kutu).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Işıl Çağrı dosyasını aç', exact: true })).toHaveAttribute('aria-current', 'true')
})

test('B2+B3: ozet satiri, katli Yaklasan, ay basliklari ve #numara; baglantilar secer, grubu acar, gorunur alana getirir', async ({ page, request }) => {
  await page.clock.setFixedTime(SIMDI)
  await kurulumYap(page)
  const ad = 'Kübra Öztürk'
  await uzunGecmisKur(request, ad)
  await dosyayiAc(page, ad)

  const ozet = page.getByTestId('dosya-ozeti')
  await expect(ozet).toHaveText(
    "28. seans · Mart 2026'dan beri · Son: 8 Eylül · Sıradaki: Perşembe 1 Ekim 14:00 · Ödenmemiş: 1.800,00 TL (+1 işaretlenmemiş)",
  )

  const liste = page.getByTestId('seans-listesi')
  const yaklasan = liste.getByRole('button', { name: 'Yaklaşan (2)', exact: true })
  await expect(yaklasan).toHaveAttribute('aria-expanded', 'false')
  await expect(liste.getByText('1 Ekim 2026, 14:00', { exact: true })).toHaveCount(0)
  // Varsayılan seçim: geçmişteki en yeni (22 Eylül, bitmiş, işaretlenmemiş).
  // (Playwright `getByRole`'da `current` seçeneği yok; öznitelikle aranır.)
  await expect(liste.locator('button[aria-current="true"]')).toContainText('22 Eylül 2026, 10:00')
  await expect(liste.getByRole('heading', { name: 'Eylül 2026 · 2 seans', exact: true })).toBeVisible()
  await expect(liste.getByRole('heading', { name: 'Ağustos 2026 · 4 seans', exact: true })).toHaveCount(1)
  await expect(liste.getByRole('heading', { name: 'Mart 2026 · 5 seans', exact: true })).toHaveCount(1)
  await expect(satir(liste, '8 Eylül 2026, 10:00').getByTestId('seans-numarasi')).toHaveText('#28')
  await expect(satir(liste, '3 Mart 2026, 10:00').getByTestId('seans-numarasi')).toHaveText('#1')
  await expect(satir(liste, '15 Eylül 2026, 10:00').getByTestId('seans-numarasi')).toHaveCount(0)

  // "…'dan beri" → listenin DİBİNDEKİ ilk seans seçilir ve görünür alana gelir.
  await ozet.getByRole('button', { name: "Mart 2026'dan beri", exact: true }).click()
  const mart = satir(liste, '3 Mart 2026, 10:00')
  await expect(mart).toHaveAttribute('aria-current', 'true')
  await expect(mart).toBeInViewport()
  await expect(yaklasan).toHaveAttribute('aria-expanded', 'false')

  // "Sıradaki" → liste dipteyken EN ÜSTTEKİ katlı grup açılır, satır görünür.
  await ozet.getByRole('button', { name: 'Sıradaki: Perşembe 1 Ekim 14:00', exact: true }).click()
  await expect(yaklasan).toHaveAttribute('aria-expanded', 'true')
  const ekim = satir(liste, '1 Ekim 2026, 14:00')
  await expect(ekim).toHaveAttribute('aria-current', 'true')
  await expect(ekim).toBeInViewport()
  await expect(ekim).not.toContainText('Not yazılmamış')

  // Bilgiler: özet orada da; "Ödenmemiş" bakiyeyle aynı; "Son" Seanslar'a döner.
  await page.getByRole('tab', { name: 'Bilgiler', exact: true }).click()
  await expect(ozet).toContainText('Ödenmemiş: 1.800,00 TL')
  await expect(page.locator('dt', { hasText: /^Bakiye$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText('1.800,00 TL')
  await ozet.getByRole('button', { name: 'Son: 8 Eylül', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Seanslar', exact: true })).toHaveAttribute('aria-selected', 'true')
  const son = satir(page.getByTestId('seans-listesi'), '8 Eylül 2026, 10:00')
  await expect(son).toHaveAttribute('aria-current', 'true')
  await expect(son).toBeInViewport()
})

test('B3: seans listesi kendi icinde kayar, ay basligi yapiskan, not gorunur kalir; B1 sol kolon da kendi icinde kayar', async ({ page, request }) => {
  await page.clock.setFixedTime(SIMDI)
  await kurulumYap(page)
  const ad = 'Selin Ünal'
  await uzunGecmisKur(request, ad)
  await dosyayiAc(page, ad)

  const solSutun = page.getByTestId('danisan-listesi-sutunu')
  expect(
    await solSutun.evaluate((el) => {
      const s = getComputedStyle(el)
      return [s.position, s.overflowY, s.maxHeight !== 'none']
    }),
  ).toEqual(['sticky', 'auto', true])

  const sutun = page.getByTestId('seans-listesi-sutunu')
  const liste = page.getByTestId('seans-listesi')
  const editor = page.getByLabel('Seans notu', { exact: true })
  await expect(editor).toBeVisible()
  // ÖN KOŞUL: liste gerçekten taşıyor (kısa listede iç kaydırma hiçbir şey ölçmezdi).
  expect(await sutun.evaluate((el) => el.scrollHeight > el.clientHeight + 200)).toBe(true)
  const sayfaKaydirmasi = await page.evaluate(() => window.scrollY)

  // Liste dibe kayar: en eski satır görünür, sayfa KAYMAZ, not yerinde.
  await sutun.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(satir(liste, '3 Mart 2026, 10:00')).toBeInViewport()
  await expect(editor).toBeInViewport()
  expect(await page.evaluate(() => window.scrollY)).toBe(sayfaKaydirmasi)

  // Yapışkan ay başlığı: Nisan'ın İKİNCİ satırı kabın tepesine gelince
  // "Nisan" başlığı kabın tepesinde durur; ilk satır (7 Nisan) kabın üstünde
  // kalmıştır (ön koşul: yapışkan olmasaydı başlık da onunla gizlenirdi).
  await satir(liste, '14 Nisan 2026, 10:00').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  const nisan = liste.getByRole('heading', { name: 'Nisan 2026 · 4 seans', exact: true })
  await expect
    .poll(async () => {
      const [b, s] = [await nisan.boundingBox(), await sutun.boundingBox()]
      return b !== null && s !== null ? Math.round(Math.abs(b.y - s.y)) : 999
    })
    .toBeLessThanOrEqual(1)
  const ilkNisan = await satir(liste, '7 Nisan 2026, 10:00').boundingBox()
  const kap = await sutun.boundingBox()
  expect(ilkNisan!.y).toBeLessThan(kap!.y)
})
```

- [ ] **Adım 3: Koş ve yeşili gör** — depo kökünden, PowerShell, PATH önekiyle: `npx playwright test e2e/danisan-dosyasi.spec.ts --reporter=line` → 4 passed. Bir test kırmızıysa kök nedeni bul (ürün mü, test mi) ve yaz. İddia gevşetilmez, `waitForTimeout` eklenmez.

- [ ] **Adım 4: Yorum kalıntılarını tara** (depo kökü)

```bash
git grep -n -E "DAVRANIŞI DEĞİŞMEDİ|birebir aynı JSX|en yeniden eskiye|from '../not/vurgu'.*katla|katla.*from '../not/vurgu'|liste.setFormAcik\(\(acik\)" -- web/src e2e core/src
```

Beklenen tek çıktı: `web/src/api.ts` `danisanApi.seanslar` yorumu ("en yeniden eskiye"). O satır sunucunun sırasını anlatır ve doğrudur; kalır. Başka her satırı düzelt (yorumsa bugünkü davranışı anlatacak biçimde yeniden yaz, kodsa ölü olduğunu doğrulayıp sil) ve dosya:satır olarak rapora yaz. Ayrıca `DanisanDosyasi.tsx` "# Etikete göre süzme" bölümündeki "Süzgeç SEÇİMİ değiştirmez…" paragrafına bir cümle ekle: "İstisna: B2 bağlantısı gizli bir seansı seçerse süzgeç 'Tüm seanslar'a çekilir (`ozettenSec`)."

- [ ] **Adım 5: Tam doğrulama** (hepsi yeşil; sayıları rapora yaz)

```powershell
$env:PATH = "C:\StrawberryPerl\perl\bin;C:\Users\axres\AppData\Local\bin\NASM;" + $env:PATH
npm --prefix web run build
npm --prefix web run lint
cd web; npx vitest run; cd ..
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
npx playwright test --reporter=line
```

- Lint: 0 hata, "warning" satırı 18'i geçmez.
- `cargo test --workspace`: 805 + 1 (`katlama_ortak_ornekleri_saglar`).
- E2E: on spec dosyası, 47 + 4 = 51 test, hepsi PASS (`SUNUCULAR` ↔ `e2e/` uyum denetimi yeni dosyayı tanır).

- [ ] **Adım 6: Görsel kontrol (tarayıcı paneli)** — Uygulamayı tarayıcı panelinde aç: `.claude/launch.json`'daki `demo` girdisi. Yoksa ya da kullanılamıyorsa e2e sunucusunun komutuyla (`cargo run -p psikolog-server --bin sunucu`, `PSIKOLOG_E2E_PORTLAR` tek port, `PSIKOLOG_VERI_DIZINI` e2e yapılandırmasındaki gibi) bir girdi ekle. `uzunGecmisKur`'daki API çağrılarıyla bir danışan kur. 1280×800'de üç ekran görüntüsü al ve rapora ekle: (1) Danışanlar sekmesi, arama kutusunda "ipek", vurgulu satır; (2) uzun geçmişli dosya, liste ortada kaydırılmış, yapışkan ay başlığı ve sağda not; (3) özet satırı, Yaklaşan açık. Bitince sunucuyu DURDUR; sunucu açıkken `cargo` ya da `npm run build` koşulmaz.

- [ ] **Adım 7: Kapsam denetimi** — tasarımın §5.2, §6 B1 (6 madde), B2 (tablo + 3 madde), B3 (6 madde), §7'nin B satırları (ortak örnek dosyaları, saate bağlı davranışlar, görsel kontrol) ve §8'in B'ye değen maddelerini (liste süzme ve özet satırı satır üretmez) tek tek dolaş. Her birinin karşısına onu ölçen test adını yaz (rapora tablo). Testi olmayan madde varsa ve aşağıdaki Mac maddelerinden biri değilse BLOCKED de ve dur.

- [ ] **Adım 8: Mac'te elle doğrulama listesi** (bu Windows makinesinde koşulamaz; rapora "Mac'te yapılacak" başlığıyla aynen yaz)

1. WKWebView'da yapışkan ay başlıkları, seans listesinin ve sol kolonun `100dvh` ile kendi içinde kayması; yumuşak kaydırma (tasarım §7).
2. Türkçe Q klavyeyle "Danışan ara": İ/ı/ş/ğ/ç yazımı; ↑/↓/Enter/Esc. Esc WebKit'in arama kutusunda da temizler, kutunun "×" düğmesi süzgeci kaldırır.
3. Kısayol metninde "⌘K" doğru görünür; ⌘K arşivlenmiş danışanı gerçekten bulur.
4. 1024 genişlikte özet satırı taşmadan satır kırar; bağlantılar tıklanabilir kalır.

- [ ] **Adım 9: Commit**

```bash
git add e2e/danisan-dosyasi.spec.ts playwright.config.ts web/src/danisan/DanisanDosyasi.tsx
git commit -m "E2E: danisan aramasi, ekleme kisayolu, baslik ozeti ve uzun gecmis duzeni

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Adım 4'ün taraması başka dosyaya dokunduysa onlar da `git add`'e AÇIKÇA eklenir; `git add -A` yok. Plan dosyası commit edilmez.)

**Mutasyonlar** (her biri ürün kodunda; e2e `web/dist`'i yeniden derler):
- `SeansListesi.tsx`: ay başlığından `sticky` sınıfını sil → "B3: … ay basligi yapiskan …" (Nisan başlığı kabın üstünde, `y` farkı > 1) kırılır.
- `DanisanDosyasi.tsx`: liste sütunundan `overflow-y-auto`'yu sil → aynı testin "3 Mart görünür" iddiası kırılır. Taşan içerik kabın dışına, sayfaya akar ve `scrollTop` ataması etkisiz kalır. Not: `scrollHeight > clientHeight` ön koşulu `overflow: visible`'da da doğru olabilir; asıl bekçi görünürlük iddiasıdır.
- `SeansListesi.tsx`: seçili satırı kaydıran `useEffect`'i sil → "B2+B3 …" testinde `mart.toBeInViewport()` kırılır.
- `danisanAramasi.ts`: `katla(...)` yerine `toLowerCase()` → "B1: arama Turkce harf duyarsiz…" ("IŞIK" → İpek Işık yok) kırılır.
- `DanisanlarSekmesi.tsx`: `ekleVeAc`'tan `onDanisanSec(yeni.id)`'yi sil → `formlaEkle`'nin dosya başlığı bariyeri (iki B1 testi) kırılır.
