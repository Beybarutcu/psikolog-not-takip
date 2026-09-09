import { beforeEach, describe, expect, it } from 'vitest'
import { taslakOku, taslakTemizle, taslakYaz, taslaklariUnut } from './taslak'

beforeEach(() => {
  taslaklariUnut()
})

describe('taslak deposu', () => {
  it('yazilan taslak ayni anahtarla geri okunur', () => {
    taslakYaz('not-1', { sablon: 'dap', icerik: 'yarim kalan' })
    expect(taslakOku('not-1')).toEqual({ sablon: 'dap', icerik: 'yarim kalan' })
  })

  it('anahtarlar birbirine karismaz', () => {
    taslakYaz('not-1', { sablon: 'dap', icerik: 'birinci' })
    taslakYaz('ozel-1', { sablon: 'serbest', icerik: 'ikinci' })
    expect(taslakOku('not-1')?.icerik).toBe('birinci')
    expect(taslakOku('ozel-1')?.icerik).toBe('ikinci')
    expect(taslakOku('not-2')).toBeUndefined()
  })

  it('kaydi dogrulanan icerik taslaktan dusulur', () => {
    taslakYaz('not-1', { sablon: 'dap', icerik: 'kaydedildi' })
    taslakTemizle('not-1', { sablon: 'dap', icerik: 'kaydedildi' })
    expect(taslakOku('not-1')).toBeUndefined()
  })

  // Yarış: kayıt uçarken kullanıcı yazmaya devam eder. Eski metnin kaydı
  // başarıyla döndüğünde koşulsuz bir silme, sunucuya HİÇ gitmemiş yeni
  // metni silerdi — bu deponun var oluş sebebinin tam tersi.
  it('kayit uctuktan sonra degisen taslak silinmez', () => {
    taslakYaz('not-1', { sablon: 'dap', icerik: 'eski metin' })
    taslakYaz('not-1', { sablon: 'dap', icerik: 'eski metin + yeni cumle' })
    taslakTemizle('not-1', { sablon: 'dap', icerik: 'eski metin' })
    expect(taslakOku('not-1')?.icerik).toBe('eski metin + yeni cumle')
  })

  it('yalnizca sablonu degismis taslak da silinmez', () => {
    taslakYaz('not-1', { sablon: 'soap', icerik: 'ayni metin' })
    taslakTemizle('not-1', { sablon: 'dap', icerik: 'ayni metin' })
    expect(taslakOku('not-1')?.sablon).toBe('soap')
  })

  // Sağlık verisi yalnızca SQLCipher ile şifrelenmiş veritabanında durur.
  // Taslak bir kolaylıktır; diske düz metin olarak yazılırsa kilit ekranının
  // arkasında olmayan ikinci bir kopya doğar.
  it('taslak tarayici depolarina (localStorage/sessionStorage) YAZILMAZ', () => {
    taslakYaz('not-1', { sablon: 'dap', icerik: 'GIZLI-SAGLIK-VERISI' })
    const tumu = [
      ...Object.keys(localStorage).map((a) => `${a}=${localStorage.getItem(a)}`),
      ...Object.keys(sessionStorage).map((a) => `${a}=${sessionStorage.getItem(a)}`),
    ].join('|')
    expect(tumu).not.toContain('GIZLI-SAGLIK-VERISI')
  })
})
