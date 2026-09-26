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
