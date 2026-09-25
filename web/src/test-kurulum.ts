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

configure({ asyncUtilTimeout: 5_000 })

// jsdom `scrollIntoView` uygulamıyor. Tasarım A6'nın kaydırması bu casusla
// SAYILIR (tıklamada 1, sekme dönüşünde/tazelemede 0).
Element.prototype.scrollIntoView = function scrollIntoView() {}
