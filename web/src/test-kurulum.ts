/**
 * Vitest kurulum dosyası — her test dosyasından ÖNCE çalışır.
 *
 * # Neden var: `testTimeout` `waitFor`'u yönetmiyor (dal incelemesi M6)
 *
 * `vite.config.ts`'teki `testTimeout` yalnızca **testin tamamı** için bir
 * bütçedir. Testing Library'nin `waitFor`/`findBy*` yardımcılarının **kendi**
 * varsayılan zaman aşımı vardır (1000 ms) ve o, `testTimeout`'tan tümüyle
 * bağımsızdır. Dal incelemesinde yük altında kırılan iddia tam olarak buydu:
 * test 20 saniyelik bütçesinin içindeydi, kırılan şey `waitFor`'un kendi 1
 * saniyesiydi. `testTimeout`'u büyütmek o sınıfı kapatmıyordu.
 *
 * # Neden 5 saniye
 *
 * Bu paketin en yavaş dosyası (`AnaEkran.test.tsx`) gerçek bir React ağacını
 * `userEvent` ile sürüyor; tek bir `waitFor` birkaç `fetch` turunun ardından
 * çözülüyor. Boştaki makinede bunlar 50-150 ms; yüklü bir makinede (CI, ya da
 * yerel `cargo build` ile aynı anda) 1 saniyeyi aşabiliyor. 5 saniye o payı
 * verir ama **gerçek bir asılı kalmayı hâlâ yakalar**: bir koşul hiç
 * sağlanmıyorsa test yine kırılır, yalnızca biraz daha geç.
 *
 * Bu bir iddiayı ZAYIFLATMAZ: `waitFor` aynı koşulu bekler, yalnızca daha
 * uzun bekler. Zaman aşımıyla düşen bir test kırık bir testten ayırt edilemez
 * ve "flake" diye görmezden gelinmeye başlanır — asıl zarar odur.
 */
import { configure } from '@testing-library/react'
import { createElement } from 'react'
import { vi } from 'vitest'
import type { BicimliYuzeyProps } from './not/BicimliYuzey'

configure({ asyncUtilTimeout: 5_000 })

// jsdom `scrollIntoView` uygulamıyor. Tasarım A6'nın kaydırması bu casusla
// SAYILIR (tıklamada 1, sekme dönüşünde/tazelemede 0).
Element.prototype.scrollIntoView = function scrollIntoView() {}

// # Not yüzeyinin test yüzeyi (tasarım §11 "Test yüzeyi kararı")
//
// jsdom'da `contenteditable` üzerinde `userEvent.type`/`fireEvent.change`
// güvenilir değil. `NotEditoru`, `SeansPaneli`, `AnaEkran`, `DanisanDosyasi`
// sözleşme testleri metni AYNI sözleşmeyi (`html`, `onChange`, `etiket`,
// `editable`) sağlayan bir `<textarea>` ile sürer; gerçek TipTap yüzeyi
// `not/BicimliYuzey.test.tsx`, `seans/NotEditoru.gercekYuzey.test.tsx` ve
// e2e'de sınanır. Gerçeği isteyen dosya bu taklidi kendi `vi.mock`'uyla
// (`importOriginal`) geri alır.
vi.mock('./not/BicimliYuzey', () => ({
  BicimliYuzey: ({ html, onChange, etiket, editable = true }: BicimliYuzeyProps) =>
    createElement('textarea', {
      'aria-label': etiket,
      value: html,
      readOnly: !editable,
      onChange: (olay: { target: { value: string } }) => onChange?.(olay.target.value),
    }),
}))

// jsdom Range geometri API'lerini, `elementFromPoint`'i, ResizeObserver'ı
// ve `window.matchMedia`'yı uygulamıyor; gerçek TipTap/ProseMirror ve
// şablonun açılır pencereleri bunlara dokunabiliyor (şablonun
// `useIsBreakpoint`'i araç çubuğu kurulurken `matchMedia` çağırır —
// preflight F1). Boş dikdörtgenler ve "hiçbir sorgu eşleşmez" yanıtı
// yerleşim İDDİA etmez, yalnızca çökmeyi önler (yerleşim e2e'de ölçülür).
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (sorgu: string) =>
    ({
      matches: false,
      media: sorgu,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}
const bosDikdortgen = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) } as DOMRect
Range.prototype.getBoundingClientRect = () => bosDikdortgen
Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
if (typeof document.elementFromPoint !== 'function') document.elementFromPoint = () => null
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
