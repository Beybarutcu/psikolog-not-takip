import { describe, expect, it } from 'vitest'
import { zamanMetni } from './tarih'

describe('zamanMetni', () => {
  it('gün ve saati Türkçe ay adıyla yazar', () => {
    expect(zamanMetni('2026-09-07T10:00')).toBe('7 Eylül 2026, 10:00')
  })

  it('tek haneli günü baştaki sıfır olmadan yazar', () => {
    expect(zamanMetni('2026-01-05T09:05')).toBe('5 Ocak 2026, 09:05')
  })

  it('saniyeli bir zamanda saati SS:DD ile keser', () => {
    expect(zamanMetni('2026-12-31T23:59:00')).toBe('31 Aralık 2026, 23:59')
  })

  it('biçimi tanınmayan bir değeri olduğu gibi döndürür', () => {
    expect(zamanMetni('gecersiz')).toBe('gecersiz')
    expect(zamanMetni('')).toBe('')
  })
})
