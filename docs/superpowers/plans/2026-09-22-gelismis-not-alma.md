# Gelişmiş not alma: Markdown editör, etiketler, notlarda arama — uygulama planı

> **Ajan çalışanlar için:** GEREKLİ ALT BECERİ: Bu planı görev görev uygulamak
> için `superpowers:subagent-driven-development` (önerilen) ya da
> `superpowers:executing-plans` kullanın. Adımlar takip için onay kutusu
> (`- [ ]`) sözdizimiyle yazılmıştır.

**Amaç:** Terapist notlarını biçimlendirerek yazabilsin (kalın, başlık, liste,
onay kutusu), seanslara etiket koyabilsin ve bir etikete ya da not içeriğine
göre aradığında doğrudan o danışanın dosyasına, o seans seçili hâlde gitsin.

**Mimari:** Not **düz metin** olarak saklanmaya devam eder; Markdown yalnızca
yazım ve görüntüleme katmanıdır. Görüntüleme, dış paket olmadan kendi
yazdığımız bir çeviriciyle kaynaktan doğrudan React elemanları üretir. Etiketler
şemanın 5. sürümünde iki yeni tabloda durur ve seansın resmî notuna bağlıdır.
Notlarda arama Plan 3'ten beri var; yalnızca etiket adlarını da arar hâle gelir
ve sonuçları takvim yerine danışan dosyasına yönlendirir.

**Teknoloji:** React 19 + TypeScript + Tailwind 4 + Vitest (web), Axum +
rusqlite/SQLCipher + `cargo test` (sunucu/çekirdek), Playwright (e2e).

**Tasarım belgesi:** `docs/superpowers/specs/2026-09-17-odak-takvim-ve-notlar-design.md`
§6 (Markdown), §7 (Etiketler), §8 (Arama).

**Tasarımdan sapma — kayıt için:** Tasarım §8 "Ctrl+K bugün yalnızca danışan
adında arıyor" diyor; bu **yanlıştı**. `core/src/store/search.rs::SORGU_NOT`
Plan 3'ten beri not içeriğinde Türkçe harf katlamalı `LIKE` araması yapıyor ve
eşleşen parçayı döndürüyor. §8'den kalan iş yalnızca: etiket adlarını aramak ve
not sonucunu danışan dosyasına yönlendirmek.

**Kullanıcı kararı (2026-09-22):** Etiketler danışan veri raporuna (KVKK md. 11,
şifreli PDF) **girer**. Gerekçe: etiketler resmî nota bağlı ve danışan hakkında
işlenen veridir; danışanın görmesi istenmeyen bir sınıflandırma özel nota yazılır.

## Genel kısıtlar

Her görevin gereksinimleri bunları da kapsar:

- Tüm kod, yorum ve arayüz metni **Türkçe**. Commit mesajları **ASCII**
  (başlık ve gövde), sonunda `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Sunucu yalnızca `127.0.0.1` dinler (`YEREL_ADRES`).
- Her rota handler'ının **ilk satırı** `guard::acik_baglanti`'dir, handler başına
  tam bir kez; gövde çözümlemesi kapıdan sonra (`guard::govde_coz` / `guard::Sorgu<T>`).
  Rota modülleri `audit::kaydet` **çağırmaz**.
- `audit_log` silinemez. Oraya **not içeriği, not başlığı, şablon adı, dosya adı,
  arama terimi ve etiket adı** yazılmaz. `ayrinti` yalnızca kapalı `Ayrinti`
  enum'undan gelir. Etiket işlemleri denetime yalnızca **kimlikle** geçer.
- **Terapistin bakmadığı şey için silinemez görüntüleme kaydı düşmez.** Görünmeyen
  bir sekmeden, açılışta kendiliğinden ya da her yeniden montajda tekrarlanan
  istek eklenmez. Okuma yolları için hacim: kendi kendini yenileyen ekranlar
  `LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK)`.
- **Not içeriği düz metin olarak kalır.** `progress_notes.icerik`'in biçimi
  değişmez; göç, var olan notlara dokunmaz. Eski notlar (`Veri:` başlıklı) ve
  yeni notlar (`## Veri` başlıklı) ikisi de doğru görünür.
- **`dangerouslySetInnerHTML` yasak** (Görev 1 bunu yapısal testle zorlar).
  Markdown çevirici HTML dizgisi üretmez; not içeriğindeki `<script>` gibi
  metinler metin olarak görünür.
- Özel notlar (`private_notes`) ayrı tabloda ve **etiket almaz**. `ozelNotApi`
  yalnızca `api.ts`, `useSeansNotlari.ts`, `SeansPaneli.tsx`'te geçebilir
  (`web/src/istemciRaporUretimi.test.ts`); izin listesi **genişletilmez**.
- **Çapraz önbellek kuralı:** aynı seansı gösteren her ekran (takvim seans paneli,
  danışan dosyası, dosyanın seans listesi) bir yazmadan sonra aynı değeri
  göstermelidir. Plan 5'in son incelemesinde bu kural iki Critical üretti. Tek
  yazma yolu `AnaEkran` üzerinden kurulur, yamalar `useDanisanSeanslari.yamala`
  ve `useSeansNotlari`'na yayılır (`yazmaSaati.ts` mekanizmasıyla).
- Zaman duvar saati (16 karakter, zaman dilimi yok); para tam sayı kuruş,
  ekrana yalnızca `web/src/para.ts::tlMetni`. Seans zamanı yalnızca
  `web/src/tarih.ts::zamanMetni`.
- Yeni npm paketi ve yeni Rust crate'i **eklenmez**.
- Metin kırpmaları **karakter** üzerinden (`chars()`), bayt üzerinden değil.
- Windows'ta `cargo` şu PATH önekiyle çağrılır:
  `C:\StrawberryPerl\perl\bin;C:\Users\axres\AppData\Local\bin\NASM`
- `cargo test --workspace` öncesi `npm --prefix web run build` gerekir (`rust_embed`).
- **TS kontrolü için `npm --prefix web run build`** kullanılır;
  `npx tsc --noEmit -p .` bu projenin solution-style tsconfig'inde sessizce
  hiçbir şey kontrol etmez.

## Her görevin bitiş ölçütü

Bir görev, yazdığı testler **kendi korumasını kırarak** kanıtlanmadan bitmiş
sayılmaz. Son adım her zaman bir **mutasyon turudur**, şu sırayla:
**commit → mutasyonu uygula → testin kırmızıya döndüğünü gör →
`git checkout -- <dosya>` → yeşili doğrula.** (`git checkout --` commit
edilmemiş işi de siler; bu projede beş kez saatler kaybedildi. Dosya kopyalayarak
geri alma: Windows'ta `Copy-Item` mtime'ı koruduğu için cargo bayat derleme
kullanabiliyor.) Kırmızıya dönmeyen test yeniden yazılır.
`docs/test-yesil-ama-korumuyor.md` bu projede bulunmuş on üç "yeşil ama
korumuyor" biçimini listeler; test yazmadan önce okuyun.

## Dosya yapısı

**Yeni:**

| Dosya | Sorumluluk |
|---|---|
| `web/src/not/markdown.tsx` | Kapalı Markdown kümesini React elemanlarına çevirir; HTML üretmez |
| `web/src/not/bicim.ts` | Saf fonksiyon: seçime biçim uygula (araç çubuğu ve kısayollar) |
| `web/src/not/BicimCubugu.tsx` | Biçim düğmeleri |
| `web/src/not/NotGorunumu.tsx` | Notun biçimli okuma görünümü |
| `web/src/etiket/EtiketSatiri.tsx` | Seansın etiket çipleri + ekleme kutusu |
| `web/src/etiket/EtiketliSeanslar.tsx` | Bir etiketi taşıyan seansların listesi |
| `web/src/screens/anaEkranKancalari/useEtiketler.ts` | Etiket sözlüğü ve seçili seansın etiketleri |
| `core/src/store/tags.rs` | Etiket deposu |
| `server/src/routes/tags.rs` | Etiket uçları |

**Değişen:** `web/src/seans/NotEditoru.tsx`, `web/src/seans/sablon.ts`,
`web/src/seans/GecmisNotlar.tsx`, `web/src/seans/SeansPaneli.tsx`,
`web/src/danisan/DanisanDosyasi.tsx`, `web/src/danisan/SeansListesi.tsx`,
`web/src/arama/HizliArama.tsx`, `web/src/screens/AnaEkran.tsx`, `web/src/api.ts`,
`core/src/store/schema.rs`, `core/src/store/danisan_seanslari.rs`,
`core/src/store/search.rs`, `core/src/store/veri_raporu.rs`,
`core/src/store/mod.rs`, `server/src/routes/mod.rs`, `server/src/lib.rs`,
`server/tests/notlar_api.rs`, `playwright.config.ts`.

---

### Görev 1: Markdown çevirici

**Dosyalar:**
- Oluştur: `web/src/not/markdown.tsx`
- Test: `web/src/not/markdown.test.tsx`

**Arayüzler:**
- Üretir: `export function markdownOgeleri(kaynak: string): ReactNode`
- Tüketir: yok.

**Kapalı küme** (tasarım §6):

| Biçim | Kaynak | Çıktı |
|---|---|---|
| Kalın | `**metin**` | `<strong>` |
| İtalik | `*metin*` | `<em>` |
| Başlık | `# `, `## `, `### ` satır başında | `<h3>`, `<h4>`, `<h5>` (not içinde sayfa başlığıyla yarışmasın diye bir kademe aşağıda) |
| Madde listesi | `- ` satır başında | `<ul><li>` |
| Numaralı liste | `1. ` (herhangi bir sayı + `. `) | `<ol><li>` |
| Alıntı | `> ` satır başında | `<blockquote>` |
| Onay kutusu | `- [ ] ` / `- [x] ` | `<li>` içinde **salt okunur** `<input type="checkbox" disabled>` |
| Paragraf | diğer satırlar; boş satır paragrafı böler | `<p>` |

Satır içi biçimler (kalın/italik) başlık, liste öğesi, alıntı ve paragraf
içinde çalışır. Kümede olmayan her şey (tablo, bağlantı, resim, kod bloğu,
HTML etiketi) **olduğu gibi metin** olarak görünür.

- [ ] **Adım 1: Başarısız testleri yaz**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { markdownOgeleri } from './markdown'

function ciz(kaynak: string) {
  return render(<div data-testid="kok">{markdownOgeleri(kaynak)}</div>)
}

describe('markdownOgeleri', () => {
  it('kalın ve italik satır içinde çalışır', () => {
    ciz('Bugün **çok kaygılı** ve *yorgun* görünüyordu.')
    expect(screen.getByText('çok kaygılı').tagName).toBe('STRONG')
    expect(screen.getByText('yorgun').tagName).toBe('EM')
  })

  it('üç başlık düzeyi bir kademe aşağıda çizilir', () => {
    ciz('# Bir\n## İki\n### Üç')
    expect(screen.getByText('Bir').tagName).toBe('H3')
    expect(screen.getByText('İki').tagName).toBe('H4')
    expect(screen.getByText('Üç').tagName).toBe('H5')
  })

  it('madde ve numaralı listeler ayrı listeler olur', () => {
    ciz('- elma\n- armut\n\n1. bir\n2. iki')
    expect(screen.getByText('elma').closest('ul')).not.toBeNull()
    expect(screen.getByText('bir').closest('ol')).not.toBeNull()
    expect(screen.getByText('elma').closest('ul')).toBe(screen.getByText('armut').closest('ul'))
  })

  it('onay kutusu salt okunur ve işaret durumunu taşır', () => {
    ciz('- [ ] ödev ver\n- [x] ölçek uygula')
    const kutular = screen.getAllByRole('checkbox')
    expect(kutular).toHaveLength(2)
    expect((kutular[0] as HTMLInputElement).checked).toBe(false)
    expect((kutular[1] as HTMLInputElement).checked).toBe(true)
    expect((kutular[0] as HTMLInputElement).disabled).toBe(true)
  })

  it('alıntı blockquote olur', () => {
    ciz('> Danışanın kendi cümlesi')
    expect(screen.getByText('Danışanın kendi cümlesi').closest('blockquote')).not.toBeNull()
  })

  it('HTML etiketi METİN olarak görünür, DOM elemanı olmaz', () => {
    const { getByTestId } = ciz('<script>alert(1)</script> <b>kalın değil</b>')
    const kok = getByTestId('kok')
    expect(kok.querySelector('script')).toBeNull()
    expect(kok.querySelector('b')).toBeNull()
    expect(kok.textContent).toContain('<script>alert(1)</script>')
  })

  it('kümede olmayan sözdizimi metin olarak kalır', () => {
    const { getByTestId } = ciz('[bağlantı](http://ornek) | tablo |')
    expect(getByTestId('kok').querySelector('a')).toBeNull()
    expect(getByTestId('kok').textContent).toContain('[bağlantı](http://ornek)')
  })

  it('kapanmamış işaret metin olarak kalır', () => {
    ciz('yarım **kalın')
    expect(screen.getByText(/yarım \*\*kalın/)).toBeInTheDocument()
  })

  it('eski biçimli (Veri:) not düz paragraf olarak okunur', () => {
    ciz('Veri:\nDanışan geldi.\n\nPlan:\nHaftaya.')
    expect(screen.getByText(/Danışan geldi/).tagName).toBe('P')
  })

  it('boş kaynak hiçbir şey çizmez', () => {
    const { getByTestId } = ciz('')
    expect(getByTestId('kok').childElementCount).toBe(0)
  })
})
```

Yapısal test (aynı dosyaya ya da `web/src/istemciRaporUretimi.test.ts`'in
yanına): `web/src` altındaki hiçbir üretim dosyası `dangerouslySetInnerHTML`
ve `innerHTML` içermez. Dosya kümesi `import.meta.glob` ile dizinden türetilir;
**asgari dosya sayısı koruması** konur (glob boşa düşerse sıfır dosya taranıp
yeşil kalmasın — `AyarlarSekmesi.test.tsx`'teki tarama emsaldir).

- [ ] **Adım 2: Testlerin başarısız olduğunu gör**

Çalıştır: `npm --prefix web run test -- markdown`
Beklenen: FAIL — `markdown.tsx` yok.

- [ ] **Adım 3: Çeviriciyi yaz**

İki katman: **blok** ayrıştırma (satırları başlık / liste / alıntı / paragraf
bloklarına grupla) ve **satır içi** ayrıştırma (`**` ve `*` çiftlerini bul).
Her ikisi de `ReactNode` döndürür; hiçbir yerde HTML dizgisi kurulmaz. Anahtarlar
(`key`) blok ve parça indeksinden türetilir.

```tsx
import type { ReactNode } from 'react'

/**
 * Notun Markdown kaynağını React elemanlarına çevirir — KAPALI bir küme.
 *
 * # Neden kendi çeviricimiz
 *
 * Proje paket eklemeden ilerliyor (TL biçimlendirici de elle yazıldı) ve HTML
 * üreten bir çevirici not içeriğini DOM'a enjekte eden bir yol açardı. Bu
 * fonksiyon HTML DİZGİSİ ÜRETMEZ: her parça bir React elemanı ya da düz metin
 * düğümüdür, React metni kendisi kaçırır. Not içindeki `<script>` bu yüzden
 * ekranda harfi harfine görünür.
 *
 * # Kapalı küme
 *
 * Kalın, italik, üç başlık düzeyi, madde/numaralı liste, alıntı, onay kutusu.
 * Kümede olmayan her şey (bağlantı, tablo, kod bloğu, HTML) METİN kalır —
 * sessizce yutulmaz, çünkü terapistin yazdığı her karakter görünmelidir.
 *
 * # Saklama biçimi değişmez
 *
 * Not düz metin olarak saklanır; bu fonksiyon yalnızca görüntülemedir. Eski
 * (`Veri:` başlıklı) notlar paragraf olarak okunur.
 */
export function markdownOgeleri(kaynak: string): ReactNode {
  // blok ayrıştırma + satirIci(...) ile satır içi ayrıştırma
}
```

Onay kutusu `disabled` ve `readOnly`'dir: okuma görünümünde tıklanıp notu
değiştirmemeli (not değişikliği yalnızca editörden, otomatik kayıt yolundan
geçer).

- [ ] **Adım 4: Testlerin geçtiğini gör**

Çalıştır: `npm --prefix web run test -- markdown`
Beklenen: PASS.

- [ ] **Adım 5: Mutasyon turu**

1. Satır içi çevirmeyi kaldır (metni olduğu gibi döndür) → kalın/italik testi kırmızı.
2. Paragrafı `<span dangerouslySetInnerHTML={{ __html: satir }} />` ile çiz →
   HTML testi **ve** yapısal tarama kırmızı.
3. Onay kutusundan `disabled`'ı kaldır → onay kutusu testi kırmızı.
4. Yapısal taramanın glob'unu boşa düşür → asgari sayı koruması kırmızı.

- [ ] **Adım 6: Commit**

```bash
git add web/src/not
git commit -m "Markdown cevirici: kapali kume, React elemanlari, HTML uretmez"
```

---

### Görev 2: Biçim çubuğu, kısayollar, önizleme ve şablon başlıkları

**Dosyalar:**
- Oluştur: `web/src/not/bicim.ts`, `web/src/not/BicimCubugu.tsx`, `web/src/not/NotGorunumu.tsx`
- Değiştir: `web/src/seans/NotEditoru.tsx`, `web/src/seans/sablon.ts`, `web/src/seans/GecmisNotlar.tsx`
- Test: `web/src/not/bicim.test.ts`, `web/src/seans/NotEditoru.test.tsx`, `web/src/seans/sablon.test.ts`

**Arayüzler:**
- Tüketir: `markdownOgeleri` (Görev 1).
- Üretir:

```ts
export type BicimTuru = 'kalin' | 'italik' | 'baslik1' | 'baslik2' | 'baslik3' | 'madde' | 'numara' | 'alinti' | 'onay'

export type Secim = { metin: string; bas: number; son: number }

/** Seçime biçimi uygular; yeni metni ve yeni seçimi döndürür. Saf fonksiyon. */
export function bicimUygula(girdi: Secim, tur: BicimTuru): Secim
```

`<NotGorunumu kaynak />` — `markdownOgeleri`'ni tipografi sınıflarıyla sarar.

**Davranış:**
- Satır içi (`kalin`, `italik`): seçim varsa seçimi işaretlerle sarar, seçim
  işaretlerin içinde kalır. Seçim yoksa işaret çiftini ekler, imleci aralarına
  koyar. Seçim zaten sarılıysa işaretleri **kaldırır** (aç/kapa).
- Satır başı (`baslik*`, `madde`, `numara`, `alinti`, `onay`): seçimin
  dokunduğu **her satırın** başına öneki ekler; hepsinde zaten varsa kaldırır.
  Başlık düzeyleri birbirinin yerine geçer (`# ` olan satıra `baslik2`
  uygulanırsa `## ` olur, `### #` değil).
- Kısayollar: Ctrl+B kalın, Ctrl+I italik, Ctrl+1/2/3 başlık, Ctrl+Shift+8
  madde listesi. macOS'ta Ctrl yerine Cmd (`metaKey`) de kabul edilir — hedef
  platform macOS.
- Biçim uygulanınca metin **aynı `onChange` yolundan** geçer; yani otomatik
  kayıt, taslak saklama ve 401'de taslağın geri yüklenmesi hiçbir şey
  bilmeden çalışmaya devam eder. Araç çubuğu ayrı bir kayıt yolu AÇMAZ.
- Editörün üstünde iki durumlu anahtar: **Yaz** (textarea + çubuk, varsayılan)
  ve **Önizle** (`NotGorunumu`). Önizlemedeyken otomatik kayıt çalışmaz (metin
  değişmiyor), anahtar yazmaya dönünce imleç konumu korunur.
- Şablonlar artık `## Başlık` ekler: `sablonMetni('dap')` →
  `"## Veri\n\n## Değerlendirme\n\n## Plan\n\n"`. `sablon.test.ts`
  başlık **adlarını** şemanın tohumuyla karşılaştırmaya devam eder (adlar
  değişmedi, yalnızca metin biçimi).
- `GecmisNotlar` notları `NotGorunumu` ile biçimli gösterir.
- Editörün `font-mono` sınıfı kalkar: yazarken de okunaklı olmalı.

- [ ] **Adım 1: `bicim.ts` için başarısız testleri yaz** (saf fonksiyon, tablo tabanlı)

```ts
import { describe, expect, it } from 'vitest'
import { bicimUygula } from './bicim'

describe('bicimUygula', () => {
  it('seçimi kalın işaretleriyle sarar, seçim içeride kalır', () => {
    const s = bicimUygula({ metin: 'çok kaygılı', bas: 0, son: 3 }, 'kalin')
    expect(s).toEqual({ metin: '**çok** kaygılı', bas: 2, son: 5 })
  })
  it('italik seçimi tek yıldızla sarar', () => {
    const s = bicimUygula({ metin: 'yorgun', bas: 0, son: 6 }, 'italik')
    expect(s).toEqual({ metin: '*yorgun*', bas: 1, son: 7 })
  })
  it('seçim yoksa kalın işaret çifti ekler, imleç araya girer', () => {
    const s = bicimUygula({ metin: 'ab', bas: 1, son: 1 }, 'kalin')
    expect(s).toEqual({ metin: 'a****b', bas: 3, son: 3 })
  })
  it('zaten kalın olan seçimde işaretleri kaldırır', () => {
    const s = bicimUygula({ metin: '**çok** kaygılı', bas: 2, son: 5 }, 'kalin')
    expect(s).toEqual({ metin: 'çok kaygılı', bas: 0, son: 3 })
  })
  it('çok satırlı seçimin her satırına madde öneki ekler', () => {
    const s = bicimUygula({ metin: 'bir\niki\nüç', bas: 0, son: 7 }, 'madde')
    expect(s.metin).toBe('- bir\n- iki\nüç')
  })
  it('hepsinde önek varsa kaldırır', () => {
    const s = bicimUygula({ metin: '- bir\n- iki', bas: 0, son: 11 }, 'madde')
    expect(s.metin).toBe('bir\niki')
  })
  it('başlık düzeyleri birbirinin yerine geçer', () => {
    const s = bicimUygula({ metin: '# Plan', bas: 3, son: 3 }, 'baslik2')
    expect(s.metin).toBe('## Plan')
  })
  it('Türkçe çok baytlı harflerde konumlar kaymaz', () => {
    const s = bicimUygula({ metin: 'şğüçöı', bas: 1, son: 4 }, 'kalin')
    expect(s.metin).toBe('ş**ğüç**öı')
  })
})
```

Uygulayıcı: beklentileri kendi elinle yeniden hesapla, kopyalama — yanlış bir
beklenti ya testi kırmızıda bırakır ya da (daha kötüsü) yanlış bir davranışı
sabitler. Çok baytlı testteki konumlar UTF-16 kod birimi cinsindendir
(`textarea.selectionStart` ile aynı); Türkçe harfler tek birimdir.

- [ ] **Adım 2: `NotEditoru` için başarısız testleri yaz**

1. Metin seçip "Kalın" düğmesine basınca textarea değeri `**…**` içerir **ve
   otomatik kayıt bu metni gönderir** (sahte zamanlayıcı; `notKaydet` spy'ı
   yeni metinle çağrılır).
2. Ctrl+B ve Cmd+B aynı sonucu verir.
3. "Önizle"ye geçince `<strong>` görünür, textarea görünmez; "Yaz"a dönünce
   textarea aynı metinle geri gelir.
4. **Kilit koruması bozulmadı:** biçim uygulandıktan sonra 401 gelirse taslak
   kaybolmaz, kilit açılınca geri yüklenir (mevcut 401 testlerinin kalıbıyla).
5. DAP şablonu seçilince editöre `## Veri` eklenir.

- [ ] **Adım 3: Testlerin başarısız olduğunu gör**, **Adım 4: yaz**, **Adım 5: geçtiğini gör**

Çalıştır: `npm --prefix web run test -- "bicim|NotEditoru|sablon|GecmisNotlar"`

- [ ] **Adım 6: Mutasyon turu**

1. Araç çubuğu düğmesi metni `onChange` yerine doğrudan state'e yazsın
   (otomatik kayıt yolunu atla) → test 1 kırmızı.
2. Kısayolda `metaKey`'i yok say → test 2'nin Cmd yarısı kırmızı.
3. `bicimUygula`'da aç/kapa dalını kaldır → "işaretleri kaldırır" kırmızı.
4. `sablonMetni`'ni eski `Veri:` biçimine döndür → test 5 kırmızı.

- [ ] **Adım 7: Commit**

```bash
git add web/src
git commit -m "Not editoru: bicim cubugu, kisayollar, onizleme; sablonlar Markdown basligi"
```

---

### Görev 3: Not önizlemesinin Markdown'a uyumu (sunucu)

**Dosyalar:**
- Değiştir: `core/src/store/danisan_seanslari.rs` (`onizleme`)
- Test: aynı dosyadaki `mod testler`

**Arayüzler:** `DanisanSeansi.not_ilk_satiri` sözleşmesi değişmez
(`None` = not yok, `Some("")` = yalnızca tüm içerik boşsa).

Plan 5 M3, önizlemede ilk **anlamlı** satırı alıyor: boş satırları ve şablon
başlığı satırlarını (`"{baslik}:"`) atlıyor; başlıklar `templates`
tohumundan türetiliyor (`sablon_baslik_satirlari`). Görev 2'den sonra yeni
notlar başlıkları `## Veri` biçiminde taşır. Önizleme:

1. Şablon başlığını **her iki biçimde** tanır: `Veri:` ve `#{1,3} Veri`.
2. Önizlemeye giren satırdaki Markdown **öneklerini** atar (`#`, `-`, `1.`,
   `>`, `- [ ]`, `- [x]`) ve satır içi `**`/`*` işaretlerini kaldırır — liste
   satırı "- Danışan kaygılı" önizlemede "Danışan kaygılı" olur.
3. Başlık listesi yine tohumdan türetilir; ikinci kez elle yazılmaz.
4. Kırpma karakter tabanlı, `AZAMI_ONIZLEME = 120` korunur.

- [ ] **Adım 1: Başarısız testleri yaz**: `## Veri\n\n- **Danışan** kaygılı` →
  `"Danışan kaygılı"`; eski biçim `Veri:\nDanışan geldi` → `"Danışan geldi"`;
  yalnızca başlıklardan oluşan yeni biçim not → ilk başlığın adı (M3'ün mevcut
  yedek davranışı); `### Serbest başlık` (şablonda olmayan) → `"Serbest başlık"`
  (başlık olarak atlanmaz, öneki atılır); çok baytlı Türkçe metinde 120 karakter.
- [ ] **Adım 2-4:** başarısız gör, yaz, geçir. Çalıştır: `cargo test -p psikolog-core danisan_seanslari`
- [ ] **Adım 5: Mutasyon turu:** `#` biçimini tanımayı kaldır → yeni biçim testi
  kırmızı; önek atmayı kaldır → liste satırı testi kırmızı; başlık listesini
  elle yaz (`["Veri", ...]`) → mevcut `baslik_listesi_sablon_tablosundan_turetilir`
  kırmızı.
- [ ] **Adım 6: Commit** — `git commit -m "Not onizlemesi Markdown basliklarini ve oneklerini tanir"`

---

### Görev 4: Etiket şeması ve deposu

**Dosyalar:**
- Değiştir: `core/src/store/schema.rs` (`CURRENT_VERSION` 4 → 5, yeni göç adımı)
- Oluştur: `core/src/store/tags.rs`
- Değiştir: `core/src/store/mod.rs`
- Test: `schema.rs` ve `tags.rs` içindeki `mod testler`

**Şema (sürüm 5):**

```sql
CREATE TABLE tags (
  id       INTEGER PRIMARY KEY,
  ad       TEXT NOT NULL CHECK (length(ad) BETWEEN 1 AND 40),
  -- Türkçe katlanmış biçim: "Kaygı" ile "kaygı" ve "KAYGI" aynı etikettir.
  ad_katli TEXT NOT NULL UNIQUE
);

CREATE TABLE progress_note_tags (
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  tag_id         INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (appointment_id, tag_id)
);
CREATE INDEX progress_note_tags_tag ON progress_note_tags(tag_id);
```

Etiket **seansın resmî notuna** aittir ve seans kimliğiyle (`appointment_id`)
tutulur; not satırı henüz yoksa da etiket konabilir (terapist önce etiketi
koyup sonra yazabilir). `private_notes`'a hiçbir referans yoktur — özel not
yapısal olarak etiket alamaz. Randevu silinince etiket bağları da silinir.

Göç adımı **mevcut kalıbı izler**: `adimlari_uygula` içinde sürüm kapısı,
yarıda kalan göçün geri alınması, `app_meta` sürüm yazımı. Var olan tablolara
ve notlara dokunmaz. Katlama için `store::search`'teki `katla` fonksiyonu
`pub(crate)` yapılıp **yeniden kullanılır** (ikinci bir katlama yazılmaz; arama
ile etiket eşleşmesi aynı kuralı kullanmalı).

**Depo (`core/src/store/tags.rs`):**

```rust
#[derive(Clone, Serialize)]
pub struct Etiket { pub id: i64, pub ad: String, pub kullanim: i64 }

#[derive(Clone, Serialize)]
pub struct EtiketliSeans {
    pub appointment_id: i64,
    pub client_id: i64,        // YETKİLİ kaynak: appointments.client_id
    pub danisan_adi: String,
    pub baslangic: String,
}

/// Bütün etiketler, en çok kullanılandan aza. Sözlük: otomatik tamamlama.
pub fn etiketleri_listele(conn: &Connection, cihaz: Cihaz) -> Result<Vec<Etiket>, DepoHatasi>;
/// Bir seansın etiketleri, ada göre.
pub fn seans_etiketleri(conn: &Connection, appointment_id: i64, cihaz: Cihaz) -> Result<Vec<Etiket>, DepoHatasi>;
/// Seansa etiket koyar; aynı katlanmış adla etiket varsa onu kullanır, yoksa oluşturur.
pub fn etiket_ekle(conn: &Connection, appointment_id: i64, ad: &str, cihaz: Cihaz) -> Result<Etiket, DepoHatasi>;
/// Seanstan etiketi kaldırır; etiket artık hiçbir seansta kullanılmıyorsa sözlükten de siler.
pub fn etiket_kaldir(conn: &Connection, appointment_id: i64, tag_id: i64, cihaz: Cihaz) -> Result<(), DepoHatasi>;
/// Bir etiketi taşıyan seanslar, yeniden eskiye.
pub fn etiketli_seanslar(conn: &Connection, tag_id: i64, cihaz: Cihaz) -> Result<Vec<EtiketliSeans>, DepoHatasi>;
```

**Doğrulama:** ad `trim` edilir, iç boşluklar tek boşluğa indirilir, 1–40
**karakter** (`chars().count()`); boş ya da uzun ad → `DepoHatasi` (doğrulama
hatası). Bilinmeyen seans → `Bulunamadi`.

**Denetim (etiket adı ASLA loga girmez):**

| İşlem | Eylem | varlık | varlık_id | hacim |
|---|---|---|---|---|
| `etiket_ekle` / `etiket_kaldir` | `Duzenleme` | `progress_note` (resmî not ile aynı varlık) | appointment_id | `OturumBasi(BIRLESTIRME_PENCERESI_DK)` |
| `etiketli_seanslar` | `Goruntuleme` | `etiket` | tag_id (**kimlik**, ad değil) | `OturumBasi(...)` |
| `seans_etiketleri` | `Goruntuleme` | `progress_note` | appointment_id | `OturumBasi(...)` |
| `etiketleri_listele` | — (danışana bağlı veri döndürmüyor; yalnızca sözlük) | | | |

`ayrinti` her satırda `None`.

- [ ] **Adım 1: Başarısız testleri yaz** — en az şunlar:
  - göç: sürüm 4 veritabanı 5'e çıkar, var olan notlar ve randevular **aynen**
    kalır (içerik karşılaştırması); göç ikinci kez çalıştırılınca bir şey yapmaz;
    yarıda kalan göç geri alınır (mevcut `basarisiz_v4_migrate_semayi_geri_alir`
    kalıbı).
  - "Kaygı", "kaygı" ve "KAYGI" aynı etiket kimliğini verir; "Kaygı " (sondaki
    boşluk) de.
  - boş ad ve 41 karakterlik ad reddedilir; 40 karakterlik **çok baytlı**
    Türkçe ad (`"ş".repeat(40)`) kabul edilir.
  - son kullanımı kaldırılan etiket sözlükten silinir; başka seansta hâlâ
    kullanılan silinmez.
  - randevu silinince bağ silinir.
  - `etiketli_seanslar` **`a.client_id`**'den okur: randevu başka danışana
    taşınınca sonuç yeni danışanı gösterir (Plan 3'te gerçek hata sınıfı).
  - sıralama: aynı etiketli üç seans karışık eklenir, `baslangic DESC, id DESC`
    döner (8. biçim: kurulum sıralama anahtarını görünmez kılmasın).
  - **etiket adı denetim kaydına girmez:** `"ÇOKGİZLİETİKET"` ekle/kaldır/listele,
    sonra `audit_log`'un **bütün** sütunlarının metninde (katlanmış hâli dahil —
    `search.rs`'teki emsal test gibi) aranır, bulunmaz.
  - hacim: 30 ardışık `etiket_ekle`/`etiket_kaldir` aynı seans için **tam 1**
    `Duzenleme` satırı üretir; pencere dışındaki eski satır yeni kaydı susturmaz
    (7. biçim: iki yön).
  - `private_notes` tablosu bu modülde hiç geçmez (mevcut özel not yapısal
    taraması `core/src` altını dizinden türettiği için yeni dosyayı kapsar —
    kapsadığını mutasyonla doğrula).
- [ ] **Adım 2-4:** başarısız gör, yaz, geçir. `cargo test -p psikolog-core tags` ve `cargo test -p psikolog-core schema`
- [ ] **Adım 5: Mutasyon turu:** `ad_katli` yerine `ad` üzerinde UNIQUE → büyük/küçük
  harf testi kırmızı; `ayrinti`'ye ad geçir (kapalı enum izin vermiyorsa Plan 5
  Görev 4'teki gibi geçici doğrulamasız varyantla, sonra geri al) → sızıntı
  testi kırmızı; `OturumBasi` → `HerCagri` → hacim testi kırmızı; `a.client_id`
  → bir kopya alanı → taşıma testi kırmızı; göçte `ON DELETE CASCADE`'i kaldır →
  silme testi kırmızı; `tags.rs`'e `private_notes` geçen bir satır ekle →
  yapısal tarama kırmızı.
- [ ] **Adım 6: Commit** — `git commit -m "Etiket semasi (surum 5) ve deposu: ad denetime girmez"`

---

### Görev 5: Etiket uçları ve istemci çağrıları

**Dosyalar:**
- Oluştur: `server/src/routes/tags.rs`
- Değiştir: `server/src/routes/mod.rs`, `server/src/lib.rs`, `server/tests/notlar_api.rs`, `web/src/api.ts`
- Test: `server/tests/notlar_api.rs`, `web/src/api.test.ts`

**Uçlar:**

| Metot | Yol | Gövde | Döner |
|---|---|---|---|
| GET | `/api/etiketler` | — | `Etiket[]` |
| GET | `/api/randevular/{id}/etiketler` | — | `Etiket[]` |
| POST | `/api/randevular/{id}/etiketler` | `{ ad: string }` | `Etiket` |
| DELETE | `/api/randevular/{id}/etiketler/{tag_id}` | — | 204 |
| GET | `/api/etiketler/{id}/seanslar` | — | `EtiketliSeans[]` |

Etiket adı **URL'ye girmez**: ekleme gövdede, silme ve arama kimlikle.
(Arama teriminin `?q=` ile sorgu dizgisinde gitmesi Plan 5 dışı bilinen bir
borç; aynı hatayı etiket adıyla tekrarlamıyoruz.)

- [ ] **Adım 1:** her handler'ın ilk satırı `acik_baglanti`, `Json` gövdesi
  `govde_coz` ile kapıdan sonra, `spawn_blocking` gerekmez (kısa işlemler).
- [ ] **Adım 2:** `notlar_api.rs`: kilitli-401 tablosuna beş satır (tablonun
  uzunluk iddiası güncellenir); handler sayacı güncellenir; yapısal taramalar
  (kapı ilk satır, `audit::kaydet` yok, özel not rota yalıtımı) yeni modülü
  **kendiliğinden** kapsar — kapsadığını kapıyı aşağı alan bir mutasyonla
  doğrula. POST'ta 41 karakterlik ad → 400, gövdesinde ad yankılanmaz.
- [ ] **Adım 3:** `web/src/api.ts`'e `etiketApi` (beş çağrı). `ISTEMCISIZ_UCLAR`
  **çift yönlü** olduğu için istisna satırı eklenmez; çağrılar aynı görevde
  yazılır.
- [ ] **Adım 4: Mutasyon turu:** POST rotasını `get` yap → 401 tablosu kırmızı;
  bir `etiketApi` çağrısını sil → `her_http_ucunun_bir_istemci_cagri_yeri_var`
  kırmızı.
- [ ] **Adım 5: Commit** — `git commit -m "Etiket uclari ve istemci cagrilari"`

---

### Görev 6: Etiket arayüzü

**Dosyalar:**
- Oluştur: `web/src/etiket/EtiketSatiri.tsx`, `web/src/etiket/EtiketliSeanslar.tsx`,
  `web/src/screens/anaEkranKancalari/useEtiketler.ts`
- Değiştir: `web/src/seans/SeansPaneli.tsx`, `web/src/danisan/DanisanDosyasi.tsx`,
  `web/src/danisan/SeansListesi.tsx`, `web/src/screens/AnaEkran.tsx`,
  `core/src/store/danisan_seanslari.rs` (listeye etiket adları)
- Test: bileşen testleri + `AnaEkran.test.tsx` çapraz önbellek testleri

**Davranış:**
- Not editörünün altında `EtiketSatiri`: seansın etiket çipleri (her biri
  kaldır düğmeli), bir giriş kutusu (sözlükten `<datalist>` ile öneri, Enter
  ile ekle). Hem takvim seans panelinde hem danışan dosyasında aynı bileşen.
- Etiket çipine tıklamak `EtiketliSeanslar` panelini açar (bütün danışanlarda o
  etiketi taşıyan seanslar: danışan adı + `zamanMetni`); bir satıra tıklamak
  `danisanaGit(clientId, appointmentId)` çağırır (Plan 5'teki tek giriş noktası).
- Danışan dosyasının seans listesinde her satır etiketlerini gösterir ve
  listenin üstünde "Etikete göre süz" seçimi vardır (yalnızca bu danışanda
  kullanılan etiketler). Bunun için `DanisanSeansi`'ne `etiketler: string[]`
  (ada göre sıralı) eklenir — Rust yapısı + TS tipi + test; sorgu yine
  `a.client_id` üzerinden.
- **Çapraz önbellek:** etiket ekleme/kaldırma `AnaEkran` üzerinden tek yoldan
  geçer ve (a) açık seansın etiketlerini, (b) danışan dosyası seans listesindeki
  satırı (`useDanisanSeanslari.yamala`), (c) sözlüğü günceller. Takvimde eklenen
  etiket, dosyaya geçince listede görünür; dosyada eklenen, takvime dönünce
  görünür.
- **İstek zamanlaması:** sözlük (`GET /api/etiketler`) etiket kutusuna **odaklanınca**
  bir kez çekilir, açılışta değil. Seansın etiketleri, seans seçilince notla
  birlikte çekilir. Görünmeyen sekmeden istek yok.
- Geciken yanıt yeni seçimi ezmez: seans değiştirilince önceki seansın etiket
  yanıtı yeni seansa yazılmaz (`useDanisanSeanslari`'daki kimlik türetme deseni).
- Mount'ta state okuyan her yeni bileşen seçim değişiminde `key` ile yeniden
  monte edilir.
- 401'de etiket state'i temizlenir (`onYetkisiz`).

- [ ] **Adım 1: Başarısız testleri yaz** — en az: ekleme/kaldırma; sözlük
  önerisi; Enter ile ekleme; 41 karakter hata mesajı; etiket çipinden
  `EtiketliSeanslar`'a ve oradan dosyaya geçiş (sekme Danışanlar, o seans
  seçili); dosyada süzme; **çapraz önbellek iki yönde** (takvimde ekle → dosya
  listesinde görünür; dosyada kaldır → takvim panelinde görünmez); geciken
  yanıt; açılışta `GET /api/etiketler` **istenmez** (istek sayımı); 401
  temizliği. Bu dalın Plan 5 incelemelerinde düştüğü tuzaklara dikkat: içerik
  Bilgiler alt sekmesindeyse önce oraya geç (Plan 5 Görev 8 C2), izolasyonu
  `queryByRole` ile değil istek sayımıyla ölç (Görev 8 I2).
- [ ] **Adım 2-4:** başarısız gör, yaz, geçir (`npm --prefix web run test`, `npm --prefix web run build`, `cargo test -p psikolog-core danisan_seanslari`).
- [ ] **Adım 5: Mutasyon turu:** yayılımı kaldır (dosya listesini yamalama) →
  çapraz önbellek testi kırmızı; sözlüğü açılışta çek → istek sayımı kırmızı;
  kimlik kontrolünü kaldır → geciken yanıt kırmızı; `danisanaGit` yerine
  yalnızca dosyayı aç → geçiş testi kırmızı.
- [ ] **Adım 6: Commit** — `git commit -m "Etiket arayuzu: seans satiri, etiketli seanslar, dosyada suzme"`

---

### Görev 7: Aramada etiketler, sonuçtan dosyaya, rapora etiketler

**Dosyalar:**
- Değiştir: `core/src/store/search.rs`, `core/src/store/veri_raporu.rs`,
  `web/src/arama/HizliArama.tsx`, `web/src/screens/AnaEkran.tsx`,
  `web/src/takvim/TakvimSekmesi.tsx`
- Test: aynı dosyaların testleri

**Davranış:**
- Arama üçüncü bir grup döndürür: `tur: 'etiket'` (etiket kimliği, adı,
  kullanım sayısı). Eşleşme `katla` ile — danışan ve not aramasıyla aynı kural.
  Sonuca tıklamak `EtiketliSeanslar`'ı açar.
- **Not sonucuna tıklamak artık danışanın dosyasını o seans seçili açar**
  (`danisanaGit(clientId, appointmentId)`), takvim haftasına gitmez (tasarım
  §8). `seansaGit` başka bir yoldan hâlâ kullanılıyorsa kalır; yalnızca arama
  sonucu yeniden yönlendirilir. Danışan sonucu değişmez.
- Arama terimi denetim kaydına **girmez** (mevcut kural); mevcut sızıntı testi
  etiket aramasını da kapsayacak şekilde genişletilir.
- **Veri raporu:** her resmî notun altına o seansın etiketleri yazılır
  (`Etiketler: aile, kaygı`, ada göre sıralı). Etiketi olmayan seansta satır
  yoktur. Özel not dışlaması ve rapor akışı (üret → oturumu yeniden doğrula →
  denetim → baytlar) değişmez. PDF'e giden metin gömülü Noto Sans ile Türkçe
  harfleri taşır — rapor testlerinde çok baytlı etiket adıyla doğrula.

- [ ] **Adım 1: Başarısız testleri yaz** — etiket adı "Kaygı" iken "kaygi"
  araması etiketi bulur; etiket sonucu tıklanınca etiketli seanslar açılır; not
  sonucu tıklanınca Danışanlar sekmesi seçili ve o seans seçili (takvim haftası
  DEĞİŞMEZ); etiket araması terimi denetime girmez; rapor metni etiket satırını
  içerir; **özel not rapora hâlâ girmez** (mevcut test yeşil kalır).
- [ ] **Adım 2-4:** başarısız gör, yaz, geçir.
- [ ] **Adım 5: Mutasyon turu:** etiket eşleşmesinde `katla` yerine `to_lowercase`
  → Türkçe harf testi kırmızı; not sonucunu eski `onSeansSec` yoluna geri bağla
  → yönlendirme testi kırmızı; raporda etiket satırını kaldır → rapor testi kırmızı.
- [ ] **Adım 6: Commit** — `git commit -m "Aramada etiketler, sonuctan dosyaya, raporda etiketler"`

---

### Görev 8: Uçtan uca test ve tam doğrulama

**Dosyalar:**
- Oluştur: `e2e/notlar-gelismis.spec.ts`
- Değiştir: `playwright.config.ts` (yeni proje, port **7706**; config kayıtsız
  spec'te hata fırlatır)

- [ ] **Adım 1: e2e testini yaz** (mevcut spec'lerin kurulum/kilit açma
  yardımcılarını yeniden kullan; iddiaları `data-yuklendi` bariyerinin
  arkasına koy — 6. biçim):
  1. Danışan + randevu oluştur, not yaz; bir kelimeyi seçip "Kalın"a bas;
     "Önizle"de `strong` görünür; sayfayı yenileyip kilidi aç → not kalın
     işaretleriyle kaydedilmiş.
  2. Seansa "kaygı" etiketi ekle; Ctrl+K ile "KAYGI" ara → etiket sonucu →
     etiketli seanslar → satıra tıkla → Danışanlar sekmesi, o seans seçili.
  3. Not içeriğinden bir kelime ara → not sonucu → Danışanlar sekmesi, o seans
     seçili.
- [ ] **Adım 2: Tam doğrulama** — hepsi yeşil:
  `npm --prefix web run build`, `npm --prefix web run test`,
  `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`,
  `npx playwright test` (tüm projeler).
- [ ] **Adım 3: Mutasyon:** e2e 2'de etiketin aramada bulunmasını sağlayan
  sorgu dalını boz → e2e kırmızı.
- [ ] **Adım 4: Commit** — `git commit -m "Gelismis not alma e2e ve tam dogrulama"`
