/// <reference types="node" />
// `tsconfig.app.json`'ın `types` alanı yalnızca `vite/client`'ı listeliyor;
// `node:fs`/`node:path` bu yüzden aşağıdaki üçlü-slash referansı olmadan
// bilinmiyor. `@types/node` zaten bir devDependency, yeni paket eklenmiyor.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Tasarım A8: koyu mod açık temaya sabitlendi. Bileşenler koyu zemine göre
// tasarlanmadığı için `prefers-color-scheme: dark` kök rengini değiştirip
// metinleri okunmaz bırakıyordu.
//
// `import.meta.url` KULLANILMIYOR: brief'teki özgün kod modül üst seviyesinde
// `new URL('./index.css', import.meta.url)` kullanıyordu. Bu projede jsdom
// test ortamında modül üst seviyesinde `import.meta.url`
// `http://localhost:3000/...` gibi bir jsdom taban adresine çözülüyor
// (`AyarlarSekmesi.test.tsx`'te de ölçülmüş, aynı kısıt) — `readFileSync`
// "The URL must be of scheme file" ile PATLIYOR. `process.cwd()` vitest'i
// çalıştıran `web/` dizinini güvenilir biçimde veriyor.
const css = readFileSync(path.join(process.cwd(), 'src', 'index.css'), 'utf8')

describe('index.css — tema ve yazı boyu', () => {
  it('yalnızca açık renk şeması ilan edilir', () => {
    expect(css).toMatch(/color-scheme:\s*light\s*;/)
    expect(css).not.toMatch(/color-scheme:\s*light\s+dark/)
  })
  it('koyu mod medya sorgusu yok', () => {
    expect(css).not.toMatch(/prefers-color-scheme:\s*dark/)
  })
  it('temel yazı boyu tek değerde, dar pencerede küçülmüyor (A3)', () => {
    expect(css).not.toMatch(/max-width:\s*1024px/)
    expect(css).toMatch(/font:\s*1[67]px\/145%/)
  })
})
