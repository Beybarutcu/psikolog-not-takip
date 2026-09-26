// Plan 4 Görev 7 — İSTEMCİDE RAPOR DOSYASI ÜRETİLEMEZ (yapısal koruma).
//
// # Neyin yerine geldi
//
// Plan 3'te veri raporu istemcide düz metin olarak üretiliyordu ve üç koruma
// onu bekliyordu: `AnaEkran.test.tsx`'te `raporNotlariGetir` gövdesinde
// `ozelNotApi` geçmediğini tarayan yapısal test, iki davranışsal "Blob
// metninde özel kanarya yok" testi ve `veriRaporu.test.ts`'teki kaynak
// taraması. Görev 7 istemci üretimini kaldırdı; o testler ölçtükleri kod
// gittiği için silindi. Özel notun rapora girmediğinin DAVRANIŞSAL kanıtı
// artık sunucunun HTTP testidir (`veri_raporu_sifreli_pdf_doner_ve_disa_
// aktarma_loglanir`, PDF parolayla çözülüp metni okunur).
//
// Geriye kalan risk şudur: birisi "sunucu yavaş, raporu yine burada
// üretelim" ya da "bir de Yazdır / Panoya kopyala düğmesi koyalım" diyerek
// sunucunun özel not güvencesinin dışından ikinci bir ÇIKIŞ yolu açar. Bu
// dosya, danışan verisini tarayıcıdan dosyaya, yazıcıya, panoya ya da yeni
// bir belgeye götürmenin BİLİNEN yapıtaşlarını yasaklar.
//
// # Kurallar (web/src üretim kaynaklarının TAMAMINDA)
//
// 1. `veriRaporuMetni` adı hiçbir yerde geçmez (tanım ya da çağrı).
// 2. `new Blob(` / `new File(` yalnızca `api.ts`'te olabilir (bugün sıfır:
//    iki indirme de sunucu yanıtını `yanit.blob()` ile alıyor).
// 3. `createObjectURL` YALNIZCA doğrudan `URL.createObjectURL(await
//    <yanıt>.blob())` biçiminde ve yalnızca `api.ts`'te geçer. Dolaylı her
//    erişim yasak: `URL['createObjectURL']`, `URL[x]`, `window.URL.…`,
//    `const { createObjectURL } = URL`, `const u = URL`, `'createObjectURL'`
//    dizgisi.
// 4. `text/plain` dizgisi hiçbir yerde geçmez.
// 5. `data:` ile BAŞLAYAN hiçbir dizgi ya da şablon dizgi başı yok
//    (`'data:…'`, `` `data:…` ``, `` `data:${…}` ``, JSX öznitelik değeri).
//    Bugün sıfır; ileride meşru bir `data:image/svg` gerekirse ADIYLA bir
//    istisna eklenir.
// 6. Pano, yazdırma, yeni pencere/belge ve yapay yanıt API'leri yok:
//    `clipboard` / `writeText` / `ClipboardItem` / `print` adları (erişim,
//    çağrı ya da destructuring — nerede geçerse), `window.open` (ve
//    `globalThis`/`self`/`top`/`parent` üzerinden), çıplak `open(…)`,
//    `document.write` / `document.writeln` (`x.document.write` dahil),
//    `new Response(` ve `Response.<statik>`, `window` / `document` /
//    `navigator` / `globalThis` / `self` / `URL` üzerinde köşeli parantezli
//    erişim, bunlardan destructuring ve bunların bir değişkene takma adla
//    alınması.
// 7. `web/package.json`'da dosya/PDF üreten bağımlılık yok (liste aşağıda;
//    `dependencies`, `devDependencies`, `optionalDependencies`,
//    `peerDependencies`; TAM ad eşleşmesi).
//
// # Ne ÖLÇÜLMÜYOR (dürüst sınır)
//
// Bu bir sözdizim taramasıdır, veri akışı analizi değil. Şunları
// yakalamaz: dizgi birleştirmeyle kurulan adlar (`'da' + 'ta:'`,
// `window['op' + 'en']` hariç — o köşeli parantez kuralına takılır),
// `eval` / `new Function`, bir `<a href>`'e sunucunun DIŞINDAN gelen bir
// `blob:` adresi, `<iframe srcdoc>` ya da `innerHTML` ile ekrana basılan bir
// rapor ve listede olmayan bir paket. Amacı kötü niyetli bir yazarı
// durdurmak değil, OLAĞAN bir sonraki adımın ("Yazdır", "Kopyala", "PDF
// kütüphanesi ekleyelim") sessizce geçmesini engellemektir.
//
// # Neden TypeScript sözdizim ağacı, neden düzenli ifade değil
//
// "Yorumları ayıkla, sonra ara" yaklaşımı dizgi içindeki `/*` ya da `//`
// (ve `"` içeren bir düzenli ifade literali) yüzünden KÖR olabilir: Görev 3
// incelemesinde çekirdek tarayıcıda tam bu kör nokta bulundu. Ağaçta yorum
// hiçbir düğüm değildir ve dizgi bir dizgi düğümüdür; aşağıdaki "tarayıcının
// kendisi" bloğu HER kuralı iki yönde (gerçek kodda BULUR, yorumdaki örneği
// SAYMAZ) sentetik kaynaklarla ölçer.
//
// # Dosya kümesi DİZİNDEN türetilir
//
// `import.meta.glob` `web/src`'yi özyinelemeli gezer; yarın eklenecek bir
// dosya hiçbir şey yapılmadan kapsanır (on ikinci biçim). Uzantı kümesi
// ikinci bir, UZANTISIZ glob'la karşılaştırılır: kod olmayan bilinen
// uzantılar (css, görseller…) dışında taranmayan tek bir dosya testi kırar —
// yarın bir `.mts` ya da `.vue` gelirse sessizce kümeden düşmez. Test
// dosyaları ve test kurulumu dışarıda: onlar üretim paketine girmez ve Blob /
// `URL.createObjectURL` taklidi kurmaları meşrudur.

import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import paketMetni from '../package.json?raw'

const tumKaynaklar = import.meta.glob(
  [
    './**/*.ts',
    './**/*.tsx',
    './**/*.js',
    './**/*.jsx',
    './**/*.mjs',
    './**/*.cjs',
    './**/*.mts',
    './**/*.cts',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

// Yalnızca ANAHTARLAR kullanılıyor (tembel yükleyiciler hiç çağrılmaz).
const tumDosyalar = Object.keys(import.meta.glob('./**/*'))

/** Taranmadan geçmesine izin verilen, kod OLMAYAN uzantılar. */
const KOD_OLMAYAN_UZANTILAR = new Set([
  'css',
  // Şablonun stil dosyaları; kod değil, `sablonKodu.test.ts` dış adres ve
  // koyu tema için ayrıca tarar.
  'scss',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'woff',
  'woff2',
  'md',
])

const TEST_KURULUMU = './test-kurulum.ts'

const uretimKaynaklari = Object.fromEntries(
  Object.entries(tumKaynaklar).filter(
    ([yol]) => !/\.test\.[cm]?[jt]sx?$/.test(yol) && yol !== TEST_KURULUMU,
  ),
)

/** Dosya/PDF üreten ya da diske yazdıran istemci paketleri. */
const YASAK_BAGIMLILIKLAR = [
  'jspdf',
  'pdfmake',
  'pdf-lib',
  '@react-pdf/renderer',
  'html2canvas',
  'html2pdf.js',
  'file-saver',
  'xlsx',
  'docx',
]

function yasakBagimliliklar(metin: string): string[] {
  const paket = JSON.parse(metin) as Record<string, unknown>
  const bulunan: string[] = []
  for (const alan of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    const bag = paket[alan]
    if (bag === null || typeof bag !== 'object') continue
    for (const ad of Object.keys(bag)) {
      if (YASAK_BAGIMLILIKLAR.includes(ad)) bulunan.push(`${alan}.${ad}`)
    }
  }
  return bulunan
}

type Bulgular = {
  veriRaporuMetni: number
  yeniBlob: string[]
  /** Yalnızca doğrudan `URL.createObjectURL(…)` çağrılarının argümanları. */
  objectUrlArgumanlari: string[]
  /** `createObjectURL`'e doğrudan çağrı DIŞINDA her erişim. */
  dolayliObjectUrl: string[]
  textPlain: number
  dataDizgisi: string[]
  yasakApi: string[]
  /**
   * `ozelNotApi` / `OzelNot` (Identifier) ya da `'ozel-not'` / `private_notes`
   * (StringLiteral/şablon parçası) geçişleri — bkz. `OZEL_NOT_IZINLI_DOSYALAR`.
   */
  ozelNot: string[]
}

/** Her yerde (erişim, çağrı, destructuring, JSX) yasak olan adlar. */
const HER_YERDE_YASAK_ADLAR = new Set(['clipboard', 'writeText', 'ClipboardItem', 'print'])
/** Köşeli parantezle erişimi, destructuring'i ve takma adı yasak nesneler. */
const TARAYICI_NESNELERI = new Set(['window', 'document', 'navigator', 'globalThis', 'self', 'URL'])
/** `open` yalnızca bunların üstünde yasak (`<details open>` meşru). */
const PENCERE_NESNELERI = new Set(['window', 'globalThis', 'self', 'top', 'parent'])

/**
 * Özel not (`private_notes`) sızıntısı taraması — Görev 6 inceleme turu.
 *
 * # Bu koruma bir zamanlar VARDI, sessizce düştü
 *
 * `web/src/danisan/veriRaporu.test.ts` (commit `6dfa316` ile silindi)
 * `expect(kod).not.toContain('ozelNotApi' | 'ozel-not' | 'OzelNot' |
 * 'private_notes')` biçiminde bir kaynak taraması yapıyordu. Yerine gelen bu
 * dosya (`istemciRaporUretimi.test.ts`) dosya kümesini GENİŞLETTİ (glob +
 * AST altyapısı) ama bu KURALI hiç almadı — Görev 6'nın kendi mutasyon
 * turunda (`SeansListesi.tsx`'e geçici `ozelNotApi` çağrısı eklenip tam takım
 * koşturuldu) hiçbir testin kırmızıya dönmediği GÖZLEMLENDİ. Bu blok o
 * boşluğu kapatıyor.
 *
 * # İzinli dosyalar
 *
 * - `./api.ts`: `ozelNotApi`/`OzelNot`in AUTHORİTATİF tanımı ve `/ozel-not`
 *   uç noktasının TEK istemci çağrısı.
 * - `./screens/anaEkranKancalari/useSeansNotlari.ts`: `SeansPaneli`nin "Özel
 *   Notlarım" sekmesini besleyen kanca; `ozelNotApi.getir`/`.kaydet`'i
 *   ÇAĞIRAN meşru tek yer (Plan 3'ün tasarladığı ayrı sekme).
 * - `./seans/SeansPaneli.tsx`: `OzelNot` tipini yalnızca PROP olarak alıp
 *   (çağıran taraf zaten `ozelNotApi`den çekmiş) özel sekmede gösterir;
 *   kendisi `ozelNotApi`ye HİÇ gitmez ama `OzelNot` tipini import eder.
 *
 * Bunların DIŞINDAKİ hiçbir dosyada (özellikle `web/src/danisan/*`, bu
 * dosyanın seans notu okuma-yazma akışını taşıyan yeni bileşenleri) bu
 * dörtlünün hiçbiri geçmemeli.
 */
const OZEL_NOT_IZINLI_DOSYALAR = new Set([
  './api.ts',
  './screens/anaEkranKancalari/useSeansNotlari.ts',
  './seans/SeansPaneli.tsx',
])

/** `window`, `x.document`, `window.URL` → son ad; başka biçim → null. */
function sonAd(ifade: ts.Expression): string | null {
  if (ts.isIdentifier(ifade)) return ifade.text
  if (ts.isPropertyAccessExpression(ifade)) return ifade.name.text
  if (ts.isNonNullExpression(ifade) || ts.isParenthesizedExpression(ifade)) {
    return sonAd(ifade.expression)
  }
  return null
}

/**
 * Bir düğümün dizgi-benzeri METNİ — sade bir `StringLiteral`/şablon dizgisi
 * (`` `x` ``) İÇİN OLDUĞU GİBİ, parçalı bir şablonun (`` `a${b}c` ``) HER
 * parçası için AYRI AYRI (`TemplateHead`/`Middle`/`Tail`). `api.ts`teki
 * `/ozel-not` uç noktası tam olarak bu ikinci biçimde yazılıyor
 * (`` `/api/randevular/${randevuId}/ozel-not` `` — 'ozel-not' bir
 * `TemplateTail`'in içinde), `ts.isStringLiteralLike` bunu YAKALAMAZ (bkz.
 * `dataDizgisi` kuralının `TemplateHead` için yaptığı ayrı kontrolle aynı
 * gerekçe, burada Head/Middle/Tail'in ÜÇÜ birden gerekiyor çünkü aranan
 * parça baş, orta ya da son konumda olabilir).
 */
function dizgiBenzeriMetin(d: ts.Node): string | null {
  if (ts.isStringLiteralLike(d)) return d.text
  if (
    d.kind === ts.SyntaxKind.TemplateHead ||
    d.kind === ts.SyntaxKind.TemplateMiddle ||
    d.kind === ts.SyntaxKind.TemplateTail
  ) {
    return (d as ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail).text
  }
  return null
}

function betikTuru(ad: string): ts.ScriptKind {
  if (ad.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (ad.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (/\.[cm]?js$/.test(ad)) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/** Kaynağı sözdizim ağacı üzerinden inceler; yorumlar düğüm DEĞİLDİR. */
function incele(ad: string, kaynak: string): Bulgular {
  const kok = ts.createSourceFile(ad, kaynak, ts.ScriptTarget.Latest, true, betikTuru(ad))
  const b: Bulgular = {
    veriRaporuMetni: 0,
    yeniBlob: [],
    objectUrlArgumanlari: [],
    dolayliObjectUrl: [],
    textPlain: 0,
    dataDizgisi: [],
    yasakApi: [],
    ozelNot: [],
  }
  const metin = (d: ts.Node) => d.getText(kok)
  const ziyaret = (d: ts.Node) => {
    if (ts.isIdentifier(d) && d.text === 'veriRaporuMetni') b.veriRaporuMetni += 1

    // Özel not sızıntısı: bkz. `OZEL_NOT_IZINLI_DOSYALAR` başlığı. Kimlik
    // (Identifier) eşleşmesi TAM METİNLE: `onOzelNotKaydet` ya da
    // `ozelNotKaydet` gibi başka meşru adların İÇİNDE geçen alt dizgiler
    // (bkz. `TakvimSekmesi.tsx`/`SeansPaneli.tsx`teki callback adları)
    // YANLIŞLIKLA yakalanmasın diye.
    if (ts.isIdentifier(d) && (d.text === 'ozelNotApi' || d.text === 'OzelNot')) {
      b.ozelNot.push(metin(d))
    }
    if (ts.isIdentifier(d) && d.text === 'private_notes') {
      b.ozelNot.push(metin(d))
    }
    const dizgiMetni = dizgiBenzeriMetin(d)
    if (dizgiMetni !== null && (dizgiMetni.includes('ozel-not') || dizgiMetni.includes('private_notes'))) {
      b.ozelNot.push(metin(d))
    }

    if (ts.isNewExpression(d)) {
      const yapici = sonAd(d.expression)
      if (yapici === 'Blob' || yapici === 'File') b.yeniBlob.push(metin(d))
      if (yapici === 'Response') b.yasakApi.push(metin(d))
    }

    // Kural 3: `createObjectURL` adının HER geçişi sınıflandırılır.
    if (ts.isIdentifier(d) && d.text === 'createObjectURL') {
      const ust = d.parent
      const dogrudan =
        ts.isPropertyAccessExpression(ust) &&
        ust.name === d &&
        ts.isIdentifier(ust.expression) &&
        ust.expression.text === 'URL' &&
        ts.isCallExpression(ust.parent) &&
        ust.parent.expression === ust
      if (dogrudan) {
        b.objectUrlArgumanlari.push(ust.parent.arguments.map(metin).join(', '))
      } else {
        b.dolayliObjectUrl.push(metin(ust))
      }
    }
    if (ts.isStringLiteralLike(d) && d.text === 'createObjectURL') {
      b.dolayliObjectUrl.push(metin(d))
    }

    if (
      (ts.isStringLiteralLike(d) || ts.isTemplateLiteralToken(d)) &&
      d.text.toLowerCase().includes('text/plain')
    ) {
      b.textPlain += 1
    }

    // Kural 5: `data:` ile BAŞLAYAN dizgi ya da şablon başı.
    if (
      (ts.isStringLiteral(d) || ts.isNoSubstitutionTemplateLiteral(d) || ts.isTemplateHead(d)) &&
      d.text.trimStart().toLowerCase().startsWith('data:')
    ) {
      b.dataDizgisi.push(metin(d))
    }

    // Kural 6.
    if (ts.isIdentifier(d) && HER_YERDE_YASAK_ADLAR.has(d.text)) {
      b.yasakApi.push(metin(d.parent))
    }
    if (ts.isPropertyAccessExpression(d)) {
      const nesne = sonAd(d.expression)
      if (d.name.text === 'open' && nesne !== null && PENCERE_NESNELERI.has(nesne)) {
        b.yasakApi.push(metin(d))
      }
      if ((d.name.text === 'write' || d.name.text === 'writeln') && nesne === 'document') {
        b.yasakApi.push(metin(d))
      }
      if (ts.isIdentifier(d.expression) && d.expression.text === 'Response') {
        b.yasakApi.push(metin(d))
      }
    }
    if (ts.isCallExpression(d) && ts.isIdentifier(d.expression) && d.expression.text === 'open') {
      b.yasakApi.push(metin(d))
    }
    if (ts.isElementAccessExpression(d)) {
      const nesne = sonAd(d.expression)
      if (nesne !== null && TARAYICI_NESNELERI.has(nesne)) {
        if (nesne === 'URL') b.dolayliObjectUrl.push(metin(d))
        else b.yasakApi.push(metin(d))
      }
    }
    if (ts.isVariableDeclaration(d) && d.initializer !== undefined) {
      const kaynakNesne = sonAd(d.initializer)
      const sade =
        ts.isIdentifier(d.initializer) || ts.isPropertyAccessExpression(d.initializer)
      if (sade && kaynakNesne !== null && TARAYICI_NESNELERI.has(kaynakNesne)) {
        // `const { x } = window` ya da `const w = window` / `const u = URL`.
        if (kaynakNesne === 'URL') b.dolayliObjectUrl.push(metin(d))
        else b.yasakApi.push(metin(d))
      }
    }

    ts.forEachChild(d, ziyaret)
  }
  ziyaret(kok)
  return b
}

const BOS: Bulgular = {
  veriRaporuMetni: 0,
  yeniBlob: [],
  objectUrlArgumanlari: [],
  dolayliObjectUrl: [],
  textPlain: 0,
  dataDizgisi: [],
  yasakApi: [],
  ozelNot: [],
}

type Alan = Exclude<keyof Bulgular, 'veriRaporuMetni' | 'textPlain' | 'objectUrlArgumanlari'>

/**
 * Her satır bir yasak yapı: ARTI yönde gerçek kodda o alanda bulgu üretir,
 * EKSİ yönde aynı kod yorum içindeyken HİÇBİR bulgu üretmez. İlk sekizi
 * Görev 7 incelemesinin, eski sürümden GEÇEN sondalarıdır.
 */
const YASAK_YAPILAR: { ad: string; dosya: string; kod: string; alan: Alan }[] = [
  {
    ad: 'sonda 1: data:text/html + a.download',
    dosya: 'x.ts',
    kod: `const a = document.createElement('a'); a.href = 'data:text/html;charset=utf-8,' + encodeURIComponent(html); a.download = 'rapor.html'; a.click()`,
    alan: 'dataDizgisi',
  },
  {
    ad: 'sonda 2: navigator.clipboard.writeText',
    dosya: 'x.ts',
    kod: `await navigator.clipboard.writeText(not)`,
    alan: 'yasakApi',
  },
  {
    ad: 'sonda 3: window.open().document.write',
    dosya: 'x.ts',
    kod: `window.open('', '_blank')?.document.write(html)`,
    alan: 'yasakApi',
  },
  { ad: 'sonda 4: window.print()', dosya: 'x.tsx', kod: `window.print()`, alan: 'yasakApi' },
  {
    ad: 'sonda 5: new Response(metin)',
    dosya: 'x.ts',
    kod: `const r = new Response(metin)`,
    alan: 'yasakApi',
  },
  {
    ad: "sonda 6: URL['createObjectURL'](await r.blob())",
    dosya: 'x.ts',
    kod: `const u = URL['createObjectURL'](await r.blob())`,
    alan: 'dolayliObjectUrl',
  },
  {
    ad: 'sonda 7: .js dosyasinda new Blob (betik turu JS)',
    dosya: 'x.js',
    kod: `export const u = URL.createObjectURL(new Blob([metin]))`,
    alan: 'yeniBlob',
  },
  {
    ad: 'sonda 8: sablon dizgi data:${…}',
    dosya: 'x.ts',
    kod: 'const h = `data:${["text", "csv"].join("/")},` + veri',
    alan: 'dataDizgisi',
  },
  { ad: 'cift tirnakli data: (JSX)', dosya: 'x.tsx', kod: `const a = <a href="data:text/csv,x">i</a>`, alan: 'dataDizgisi' },
  { ad: 'bosluklu DATA: dizgisi', dosya: 'x.ts', kod: `const h = ' DATA:text/csv,x'`, alan: 'dataDizgisi' },
  { ad: 'yer tutucusuz sablon data:', dosya: 'x.ts', kod: 'const h = `data:text/csv,x`', alan: 'dataDizgisi' },
  { ad: 'clipboard.write', dosya: 'x.ts', kod: `navigator.clipboard.write([oge])`, alan: 'yasakApi' },
  { ad: 'ClipboardItem', dosya: 'x.ts', kod: `const o = new ClipboardItem({})`, alan: 'yasakApi' },
  { ad: 'destructuring clipboard', dosya: 'x.ts', kod: `const { clipboard: p } = navigator`, alan: 'yasakApi' },
  { ad: 'global print()', dosya: 'x.ts', kod: `print()`, alan: 'yasakApi' },
  { ad: 'globalThis.open', dosya: 'x.ts', kod: `globalThis.open(adres)`, alan: 'yasakApi' },
  { ad: 'ciplak open()', dosya: 'x.ts', kod: `open('about:blank')`, alan: 'yasakApi' },
  { ad: 'document.writeln', dosya: 'x.ts', kod: `document.writeln(html)`, alan: 'yasakApi' },
  { ad: 'Response.json statik', dosya: 'x.ts', kod: `const r = Response.json(veri)`, alan: 'yasakApi' },
  { ad: "window['open']", dosya: 'x.ts', kod: `window['op' + 'en']()`, alan: 'yasakApi' },
  { ad: 'takma ad const w = window', dosya: 'x.ts', kod: `const w = window`, alan: 'yasakApi' },
  { ad: 'URL[x]', dosya: 'x.ts', kod: `const f = URL[ad]`, alan: 'dolayliObjectUrl' },
  { ad: 'const { createObjectURL } = URL', dosya: 'x.ts', kod: `const { createObjectURL } = URL`, alan: 'dolayliObjectUrl' },
  { ad: 'const u = URL; u.createObjectURL', dosya: 'x.ts', kod: `const u = URL; u.createObjectURL(b)`, alan: 'dolayliObjectUrl' },
  { ad: 'window.URL.createObjectURL', dosya: 'x.ts', kod: `window.URL.createObjectURL(b)`, alan: 'dolayliObjectUrl' },
  { ad: "'createObjectURL' dizgisi", dosya: 'x.ts', kod: `const k = 'createObjectURL'`, alan: 'dolayliObjectUrl' },
  { ad: '.mjs dosyasinda clipboard', dosya: 'x.mjs', kod: `navigator.clipboard.writeText(x)`, alan: 'yasakApi' },
  { ad: '.jsx dosyasinda data: + JSX', dosya: 'x.jsx', kod: `const a = <a href={'data:,x'}>i</a>`, alan: 'dataDizgisi' },
  { ad: 'ozelNotApi cagrisi', dosya: 'x.ts', kod: `await ozelNotApi.getir(7)`, alan: 'ozelNot' },
  { ad: 'OzelNot tip importu', dosya: 'x.ts', kod: `import type { OzelNot } from '../api'`, alan: 'ozelNot' },
  {
    ad: "'ozel-not' duz dizgi",
    dosya: 'x.ts',
    kod: `const y = '/api/randevular/7/ozel-not'`,
    alan: 'ozelNot',
  },
  {
    ad: "'ozel-not' parcali sablon (TemplateTail)",
    dosya: 'x.ts',
    kod: 'const y = `/api/randevular/${id}/ozel-not`',
    alan: 'ozelNot',
  },
  { ad: 'private_notes tablo adi', dosya: 'x.ts', kod: `db.exec('DELETE FROM private_notes')`, alan: 'ozelNot' },
]

describe('tarayıcının kendisi (iki yön)', () => {
  it('ARTI YON: yasak yapitaslarini gercek kodda BULUR', () => {
    const b = incele(
      'x.ts',
      `const metin = veriRaporuMetni(d)
       const url = URL.createObjectURL(new Blob([metin], { type: 'text/plain' }))`,
    )
    expect(b.veriRaporuMetni).toBe(1)
    expect(b.yeniBlob).toEqual([`new Blob([metin], { type: 'text/plain' })`])
    expect(b.objectUrlArgumanlari).toEqual([`new Blob([metin], { type: 'text/plain' })`])
    expect(b.dolayliObjectUrl).toEqual([])
    expect(b.textPlain).toBe(1)
  })

  it('dizgi icindeki yorum acici ve tirnakli regex taramayi KOR ETMEZ', () => {
    // Düzenli ifadeyle yorum ayıklayan bir tarayıcı `"/*"`'ı yorum başı
    // sanıp aradaki kodu yutardı; `/"/` literalini dizgi başı sanan bir
    // tarayıcı da aynı biçimde körleşirdi.
    const b = incele(
      'x.tsx',
      `const a = "/*"
       const r = /"/
       const t = \`//\${a}\`
       const u = URL.createObjectURL(new File([veriRaporuMetni()], 'r.txt'))
       window.print()
       const z = "*/"`,
    )
    expect(b.veriRaporuMetni).toBe(1)
    expect(b.yeniBlob).toHaveLength(1)
    expect(b.objectUrlArgumanlari).toHaveLength(1)
    expect(b.yasakApi).toHaveLength(1)
  })

  it('EKSI YON: yorumdaki ad ve ornek kod sayilmaz', () => {
    const b = incele(
      'x.ts',
      `// veriRaporuMetni(d) eskiden new Blob([m], { type: 'text/plain' }) uretirdi
       /* URL.createObjectURL(new Blob([m])) */
       const hic = 1`,
    )
    expect(b).toEqual(BOS)
  })

  it.each(YASAK_YAPILAR)('ARTI YON: $ad → BULUNUR', ({ dosya, kod, alan }) => {
    const b = incele(dosya, kod)
    expect(b[alan].length).toBeGreaterThan(0)
  })

  it.each(YASAK_YAPILAR)('EKSI YON: $ad yorumdayken SAYILMAZ', ({ dosya, kod }) => {
    expect(incele(dosya, `// ${kod}\n/* ${kod} */\nconst hic = 1`)).toEqual(BOS)
  })

  it('EKSI YON: mesru benzerler yasak sayilmaz', () => {
    // Aşırı sıkı bir tarayıcı da yeşil bir yalan üretir (yedinci biçim):
    // bugünkü üretim kodunda geçen ya da açıkça zararsız olan yapılar.
    const b = incele(
      'x.tsx',
      `async function f(yanit: Response): Promise<void> {
         const url = URL.createObjectURL(await yanit.blob())
         setTimeout(() => URL.revokeObjectURL(url), 0)
         const d = <details open>ozet</details>
         const metin = 'veri: data: degil'
         const t = \`\${x}data:\`
         kutu.open = true
         dosya.write(x)
         document.createElement('a')
         window.addEventListener('x', f)
       }`,
    )
    expect(b).toEqual({ ...BOS, objectUrlArgumanlari: ['await yanit.blob()'] })
  })

  it('bagimlilik yasagi iki yonde: listedekini BULUR, baska yerde gecen adi SAYMAZ', () => {
    expect(
      yasakBagimliliklar(
        JSON.stringify({
          dependencies: { react: '1', 'file-saver': '2' },
          devDependencies: { jspdf: '3', '@react-pdf/renderer': '4' },
        }),
      ),
    ).toEqual([
      'dependencies.file-saver',
      'devDependencies.jspdf',
      'devDependencies.@react-pdf/renderer',
    ])
    expect(
      yasakBagimliliklar(
        JSON.stringify({
          name: 'jspdf',
          description: 'pdfmake ve xlsx kullanmaz',
          scripts: { docx: 'html2canvas' },
          dependencies: { react: '1', 'jspdf-degil': '1' },
        }),
      ),
    ).toEqual([])
  })
})

describe('web/src üretim kaynaklarında istemci rapor üretimi YOK', () => {
  const bulgular = Object.entries(uretimKaynaklari).map(
    ([yol, kaynak]) => [yol, incele(yol, kaynak)] as const,
  )

  it('dosya kumesi dizinden ozyinelemeli turetildi ve gercekten okundu', () => {
    const yollar = Object.keys(uretimKaynaklari)
    // Derinlik 0, 1 ve 2'den birer temsilci: glob'un özyinelemesi bozulursa
    // (ör. `./*.ts`) kavşak dosyaları sessizce kümeden düşerdi.
    for (const beklenen of [
      './api.ts',
      './danisan/DosyaBilgileri.tsx',
      './screens/AnaEkran.tsx',
      './screens/anaEkranKancalari/yerelGun.ts',
    ]) {
      expect(yollar).toContain(beklenen)
    }
    expect(yollar.length).toBeGreaterThan(30)
    // Test dosyaları kümede YOK (Blob taklidi kurmaları meşru).
    expect(yollar.some((y) => y.includes('.test.'))).toBe(false)
    expect(Object.keys(tumKaynaklar)).toContain(TEST_KURULUMU)
    // Silinen üretici geri gelmedi.
    expect(yollar).not.toContain('./danisan/veriRaporu.ts')
    // Görev 7'de taşınan/silinen eski dosya geri gelmedi.
    expect(yollar).not.toContain('./danisan/DanisanKarti.tsx')
    // Okuma boş değil: api.ts'teki iki indirme GERÇEKTEN bulunuyor — boş
    // bir okuma aşağıdaki "yok" iddialarını hiçbir şeyi sınamayan yeşile
    // çevirirdi.
    const api = bulgular.find(([y]) => y === './api.ts')?.[1]
    expect(api?.objectUrlArgumanlari.length).toBeGreaterThanOrEqual(2)
  })

  it('src altindaki kod OLMAYAN uzantilar disinda HER dosya taraniyor', () => {
    // Uzantısız glob kendisi daralırsa bu test hiçbir şey ölçmezdi: kod
    // olmayan bir dosyayı (css) ve bir test dosyasını gerçekten görüyor.
    expect(tumDosyalar).toContain('./index.css')
    expect(tumDosyalar).toContain('./api.test.ts')
    const taranmayan = tumDosyalar.filter((y) => {
      const uzanti = y.slice(y.lastIndexOf('.') + 1).toLowerCase()
      return !KOD_OLMAYAN_UZANTILAR.has(uzanti) && !(y in tumKaynaklar)
    })
    expect(taranmayan).toEqual([])
  })

  it('`veriRaporuMetni` hicbir yerde tanimli ya da cagrili degil', () => {
    const ihlal = bulgular.filter(([, b]) => b.veriRaporuMetni > 0).map(([y]) => y)
    expect(ihlal).toEqual([])
  })

  it('`new Blob(` / `new File(` yalnizca api.ts te', () => {
    const ihlal = bulgular
      .filter(([y, b]) => y !== './api.ts' && b.yeniBlob.length > 0)
      .map(([y, b]) => `${y}: ${b.yeniBlob.join(' | ')}`)
    expect(ihlal).toEqual([])
  })

  it('her createObjectURL api.ts te, DOGRUDAN ve argumani SUNUCU YANITININ blobu', () => {
    const ihlal = bulgular.flatMap(([y, b]) => [
      ...b.objectUrlArgumanlari
        .filter((arg) => y !== './api.ts' || !/^await \w+\.blob\(\)$/.test(arg))
        .map((arg) => `${y}: createObjectURL(${arg})`),
      ...b.dolayliObjectUrl.map((m) => `${y}: dolayli ${m}`),
    ])
    expect(ihlal).toEqual([])
  })

  it('`text/plain` hicbir uretim kaynaginda gecmiyor', () => {
    const ihlal = bulgular.filter(([, b]) => b.textPlain > 0).map(([y]) => y)
    expect(ihlal).toEqual([])
  })

  it('`data:` ile baslayan dizgi hicbir uretim kaynaginda yok', () => {
    const ihlal = bulgular.flatMap(([y, b]) => b.dataDizgisi.map((m) => `${y}: ${m}`))
    expect(ihlal).toEqual([])
  })

  it('pano / yazdirma / yeni pencere / document.write / Response yok', () => {
    const ihlal = bulgular.flatMap(([y, b]) => b.yasakApi.map((m) => `${y}: ${m}`))
    expect(ihlal).toEqual([])
  })

  it('web/package.json da dosya/PDF ureten bagimlilik yok', () => {
    // Okuma boş değil: bilinen bağımlılık gerçekten görünüyor.
    expect(Object.keys(JSON.parse(paketMetni).dependencies)).toContain('react')
    expect(yasakBagimliliklar(paketMetni)).toEqual([])
  })

  // Görev 6 inceleme turu — bkz. `OZEL_NOT_IZINLI_DOSYALAR` başlığı: bu
  // koruma bir zamanlar (`veriRaporu.test.ts`) vardı, dosya silinirken
  // sessizce düştü. `SeansListesi.tsx`'e geçici bir `ozelNotApi` çağrısı
  // eklenip tam takım koşturularak boşluk EMPİRİK olarak doğrulandı (hiçbir
  // test kırmızıya dönmüyordu); bu iki test o boşluğu kapatıyor.
  it('izinli DIŞINDAKİ hiçbir dosyada ozelNotApi/OzelNot/ozel-not/private_notes gecmiyor', () => {
    const ihlal = bulgular
      .filter(([y]) => !OZEL_NOT_IZINLI_DOSYALAR.has(y))
      .flatMap(([y, b]) => b.ozelNot.map((m) => `${y}: ${m}`))
    expect(ihlal).toEqual([])
  })

  // ZORUNLU ARTI YÖN (bkz. dosya başlığındaki "iki yön" ilkesi, 7. biçim):
  // yukarıdaki test tek başına `incele`nin `ozelNot`u hiç doldurmadığı bir
  // regresyonda da (boş dizi hep boş dizide kalır) YEŞİL kalırdı. Bu test
  // İZİNLİ üç dosyanın GERÇEKTEN bulgu ürettiğini iddia ederek o körlüğü
  // kapatır: okuma boş değilse, "yok" iddiası bir şeyi gerçekten sınıyordur.
  it('izinli dosyaların ÜÇÜ de ozelNot bulgusu GERÇEKTEN üretiyor (körlüğe karşı)', () => {
    for (const izinli of OZEL_NOT_IZINLI_DOSYALAR) {
      const b = bulgular.find(([y]) => y === izinli)?.[1]
      expect(b, `${izinli} taranan kaynaklar arasında yok`).toBeDefined()
      expect(b?.ozelNot.length, `${izinli} hiç ozelNot bulgusu üretmedi`).toBeGreaterThan(0)
    }
  })
})
