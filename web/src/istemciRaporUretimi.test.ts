// Plan 4 Görev 7 — İSTEMCİDE RAPOR METNİ ÜRETİLEMEZ (yapısal koruma).
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
// üretelim" diyerek istemci üretimini geri getirir ve sunucunun özel not
// güvencesinin dışından ikinci bir rapor yolu açar. Bu dosya o yolun
// YAPITAŞLARINI yasaklar.
//
// # Kurallar (web/src üretim kaynaklarının TAMAMINDA)
//
// 1. `veriRaporuMetni` adı hiçbir yerde geçmez (tanım ya da çağrı).
// 2. `new Blob(` / `new File(` yalnızca `api.ts`'te olabilir (bugün sıfır:
//    iki indirme de sunucu yanıtını `yanit.blob()` ile alıyor).
// 3. Her `createObjectURL(...)` `api.ts`'tedir ve argümanı
//    `await <yanıt>.blob()`'dur — istemcide kurulmuş bir içerik değil.
// 4. `text/plain` dizgisi hiçbir yerde geçmez.
//
// # Neden TypeScript sözdizim ağacı, neden düzenli ifade değil
//
// "Yorumları ayıkla, sonra ara" yaklaşımı dizgi içindeki `/*` ya da `//`
// (ve `"` içeren bir düzenli ifade literali) yüzünden KÖR olabilir: Görev 3
// incelemesinde çekirdek tarayıcıda tam bu kör nokta bulundu. Ağaçta yorum
// hiçbir düğüm değildir ve dizgi bir dizgi düğümüdür; aşağıdaki "tarayıcının
// kendisi" bloğu bu iki yönü sentetik kaynaklarla ölçer.
//
// # Dosya kümesi DİZİNDEN türetilir
//
// `import.meta.glob` `web/src`'yi özyinelemeli gezer; yarın eklenecek bir
// dosya hiçbir şey yapılmadan kapsanır (on ikinci biçim). Test dosyaları ve
// test kurulumu dışarıda: onlar üretim paketine girmez ve Blob taklidi
// kurmaları meşrudur.

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const tumKaynaklar = import.meta.glob(['./**/*.ts', './**/*.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const TEST_KURULUMU = './test-kurulum.ts'

const uretimKaynaklari = Object.fromEntries(
  Object.entries(tumKaynaklar).filter(
    ([yol]) => !/\.test\.tsx?$/.test(yol) && yol !== TEST_KURULUMU,
  ),
)

type Bulgular = {
  veriRaporuMetni: number
  yeniBlob: string[]
  objectUrlArgumanlari: string[]
  textPlain: number
}

/** Kaynağı sözdizim ağacı üzerinden inceler; yorumlar düğüm DEĞİLDİR. */
function incele(ad: string, kaynak: string): Bulgular {
  const kok = ts.createSourceFile(
    ad,
    kaynak,
    ts.ScriptTarget.Latest,
    true,
    ad.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const b: Bulgular = { veriRaporuMetni: 0, yeniBlob: [], objectUrlArgumanlari: [], textPlain: 0 }
  const ziyaret = (d: ts.Node) => {
    if (ts.isIdentifier(d) && d.text === 'veriRaporuMetni') b.veriRaporuMetni += 1
    if (ts.isNewExpression(d)) {
      const ifade = d.expression
      const ad = ts.isIdentifier(ifade)
        ? ifade.text
        : ts.isPropertyAccessExpression(ifade)
          ? ifade.name.text
          : ''
      if (ad === 'Blob' || ad === 'File') b.yeniBlob.push(d.getText(kok))
    }
    if (
      ts.isCallExpression(d) &&
      ts.isPropertyAccessExpression(d.expression) &&
      d.expression.name.text === 'createObjectURL'
    ) {
      b.objectUrlArgumanlari.push(d.arguments.map((a) => a.getText(kok)).join(', '))
    }
    if (
      (ts.isStringLiteralLike(d) || ts.isTemplateLiteralToken(d)) &&
      d.text.toLowerCase().includes('text/plain')
    ) {
      b.textPlain += 1
    }
    ts.forEachChild(d, ziyaret)
  }
  ziyaret(kok)
  return b
}

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
       const z = "*/"`,
    )
    expect(b.veriRaporuMetni).toBe(1)
    expect(b.yeniBlob).toHaveLength(1)
    expect(b.objectUrlArgumanlari).toHaveLength(1)
  })

  it('EKSI YON: yorumdaki ad ve ornek kod sayilmaz', () => {
    const b = incele(
      'x.ts',
      `// veriRaporuMetni(d) eskiden new Blob([m], { type: 'text/plain' }) uretirdi
       /* URL.createObjectURL(new Blob([m])) */
       const hic = 1`,
    )
    expect(b).toEqual({ veriRaporuMetni: 0, yeniBlob: [], objectUrlArgumanlari: [], textPlain: 0 })
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
      './danisan/DanisanKarti.tsx',
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
    // Okuma boş değil: api.ts'teki iki indirme GERÇEKTEN bulunuyor — boş
    // bir okuma aşağıdaki "yok" iddialarını hiçbir şeyi sınamayan yeşile
    // çevirirdi.
    const api = bulgular.find(([y]) => y === './api.ts')?.[1]
    expect(api?.objectUrlArgumanlari.length).toBeGreaterThanOrEqual(2)
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

  it('her createObjectURL api.ts te ve argumani SUNUCU YANITININ blobu', () => {
    const ihlal = bulgular.flatMap(([y, b]) =>
      b.objectUrlArgumanlari
        .filter((arg) => y !== './api.ts' || !/^await \w+\.blob\(\)$/.test(arg))
        .map((arg) => `${y}: createObjectURL(${arg})`),
    )
    expect(ihlal).toEqual([])
  })

  it('`text/plain` hicbir uretim kaynaginda gecmiyor', () => {
    const ihlal = bulgular.filter(([, b]) => b.textPlain > 0).map(([y]) => y)
    expect(ihlal).toEqual([])
  })
})
