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

  // Yukarıdaki tablo brief'ten kopyalanmadı, her beklenti elle yeniden
  // hesaplandı (görev talimatı). Sekizi de doğru çıktı; brief'te düzeltilmesi
  // gereken bir beklenti YOKTU — raporda da böyle belirtiliyor.

  // ------------------------------------------------------------------
  // Ek testler: brief'in tablosunun ölçmediği ama davranış açıklamasında
  // (görev brief'i "Davranış" bölümü) sözü geçen durumlar.
  // ------------------------------------------------------------------

  it('baslik ayni duzeydeyse aç/kapa ile kaldırır', () => {
    const s = bicimUygula({ metin: '## Değerlendirme', bas: 5, son: 5 }, 'baslik2')
    expect(s.metin).toBe('Değerlendirme')
  })

  it('onay kutusu öneki ekler', () => {
    const s = bicimUygula({ metin: 'ödev ver', bas: 0, son: 8 }, 'onay')
    expect(s.metin).toBe('- [ ] ödev ver')
  })

  it('numaralı liste öneki her satıra sırayla eklenir', () => {
    const s = bicimUygula({ metin: 'bir\niki', bas: 0, son: 7 }, 'numara')
    expect(s.metin).toBe('1. bir\n2. iki')
  })

  it('alıntı öneki ekler ve kaldırır', () => {
    const eklenen = bicimUygula({ metin: 'söylenen söz', bas: 0, son: 12 }, 'alinti')
    expect(eklenen.metin).toBe('> söylenen söz')
    const kaldirilan = bicimUygula({ metin: '> söylenen söz', bas: 0, son: 14 }, 'alinti')
    expect(kaldirilan.metin).toBe('söylenen söz')
  })

  it('kısmen önekli seçimde eksik olanlara eklenir, var olan bozulmaz', () => {
    const s = bicimUygula({ metin: '- bir\niki', bas: 0, son: 9 }, 'madde')
    expect(s.metin).toBe('- bir\n- iki')
  })
})
