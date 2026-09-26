import { describe, expect, it } from 'vitest'
import { baglantiAdresi, baglantiIzinliMi } from './uzantilar'

// Bağlantı penceresine YAZILAN adresin kuralı (tasarım E10, dal sonu
// incelemesi M2): şemasız adres `https://`, e-posta `mailto:` alır; izinli
// üç şema dışında hiçbir şema bağlantı olmaz.
describe('baglantiAdresi', () => {
  it('şemasız adrese https:// öneki eklenir', () => {
    expect(baglantiAdresi('www.ornek.com')).toBe('https://www.ornek.com')
    expect(baglantiAdresi('ornek.com/makale?no=3#bolum')).toBe('https://ornek.com/makale?no=3#bolum')
    expect(baglantiAdresi('ornek.com:8080/yol')).toBe('https://ornek.com:8080/yol')
    expect(baglantiAdresi('  www.ornek.com  ')).toBe('https://www.ornek.com')
  })

  it('e-posta adresine mailto: öneki eklenir', () => {
    expect(baglantiAdresi('ad@ornek.com')).toBe('mailto:ad@ornek.com')
    expect(baglantiAdresi('ayşe.yılmaz@örnek.com.tr')).toBe('mailto:ayşe.yılmaz@örnek.com.tr')
  })

  it('izinli şemalı adres olduğu gibi (kırpılmış) kalır', () => {
    expect(baglantiAdresi('https://ornek.com/a')).toBe('https://ornek.com/a')
    expect(baglantiAdresi('http://ornek.com')).toBe('http://ornek.com')
    expect(baglantiAdresi('HTTPS://ORNEK.COM')).toBe('HTTPS://ORNEK.COM')
    expect(baglantiAdresi(' mailto:ad@ornek.com ')).toBe('mailto:ad@ornek.com')
  })

  it('başka hiçbir şema bağlantı olmaz; önek eklenerek de kaçırılmaz', () => {
    for (const adres of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<p>x</p>',
      'ftp://ornek.com',
      'tel:+905551112233',
      'vbscript:msgbox(1)',
      'localhost:3000',
    ]) {
      expect(baglantiAdresi(adres), adres).toBeNull()
    }
  })

  it('boş girdi bağlantı olmaz', () => {
    expect(baglantiAdresi('')).toBeNull()
    expect(baglantiAdresi('   ')).toBeNull()
  })

  it('ürettiği her adres şemanın kendi süzgecinden (baglantiIzinliMi) geçer', () => {
    for (const girdi of ['www.ornek.com', 'ad@ornek.com', 'https://ornek.com', 'ornek.com:8080']) {
      const adres = baglantiAdresi(girdi)
      expect(adres, girdi).not.toBeNull()
      expect(baglantiIzinliMi(adres!), girdi).toBe(true)
    }
  })
})
