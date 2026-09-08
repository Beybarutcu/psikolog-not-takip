const AYLAR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

// Görev 9'daki takvim ızgarası gün başlıkları için dışa aktarılır; bu
// modülde henüz kullanılmıyor.
export const GUN_ADLARI = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

function ikiHane(n: number): string {
  return n.toString().padStart(2, '0')
}

export function haftaninBasi(tarih: Date): Date {
  const d = new Date(tarih.getFullYear(), tarih.getMonth(), tarih.getDate())
  // getDay(): 0 = pazar. Pazartesi başlangıçlı haftada pazar 6. gündür.
  const gun = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - gun)
  return d
}

export function haftaGunleri(haftaBasi: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(haftaBasi)
    d.setDate(d.getDate() + i)
    return d
  })
}

export function yerelZaman(tarih: Date): string {
  return (
    `${tarih.getFullYear()}-${ikiHane(tarih.getMonth() + 1)}-${ikiHane(tarih.getDate())}` +
    `T${ikiHane(tarih.getHours())}:${ikiHane(tarih.getMinutes())}`
  )
}

export function zamandanDate(zaman: string): Date {
  const [tarih, saat] = zaman.split('T')
  const [yil, ay, gun] = tarih.split('-').map(Number)
  const [ss, dd] = saat.split(':').map(Number)
  // new Date(yil, ay-1, gun, saat, dakika) daima YEREL saat olarak kurulur (Date.UTC
  // ya da ISO-string kurucusundan farklı olarak). Bu yüzden dizgiyi elle ayrıştırıp
  // bileşenleri bu kurucuya veriyoruz. Not: güncel V8/Node, saat bileşeni olan ve
  // ofset içermeyen ISO dizgilerini (ör. "2026-06-15T09:00") ECMA-262 gereği zaten
  // YEREL olarak yorumluyor — new Date(zaman) bu belirli biçim için pratikte eşdeğer
  // sonuç verir (ölçüldü, bkz. Görev 8 raporu). Ama tek argümanlı new Date(...) hâlâ
  // KULLANILMAMALI: davranışı motora/spesifikasyon inceliğine bağlıdır (tarih-yalnız
  // dizgiler UTC sayılır, ofsetli dizgiler farklı yorumlanır, farklı motorlar arasında
  // garanti tutarlılık yoktur) — elle ayrıştırma, kurucunun her zaman yerel saat
  // ürettiğini spesifikasyon düzeyinde garanti eder ve gelecekte dizgi biçimi
  // değişirse (saniye/ofset eklenirse) sessizce kaymayı önler.
  return new Date(yil, ay - 1, gun, ss, dd)
}

export function dakikaFarki(baslangic: string, bitis: string): number {
  return (zamandanDate(bitis).getTime() - zamandanDate(baslangic).getTime()) / 60000
}

export function haftaBasligi(haftaBasi: Date): string {
  const gunler = haftaGunleri(haftaBasi)
  const ilk = gunler[0]
  const son = gunler[6]

  if (ilk.getFullYear() !== son.getFullYear()) {
    // Hafta yıl sınırını aşıyor (örn. 29 Aralık – 4 Ocak): her iki tarafın
    // yılını ayrı ayrı yaz, aksi hâlde ilk günün yılı gizlenir ve kullanıcı
    // yanlış yıla baktığını sanabilir.
    return (
      `${ilk.getDate()} ${AYLAR[ilk.getMonth()]} ${ilk.getFullYear()} – ` +
      `${son.getDate()} ${AYLAR[son.getMonth()]} ${son.getFullYear()}`
    )
  }

  const yil = son.getFullYear()
  if (ilk.getMonth() === son.getMonth()) {
    return `${ilk.getDate()} – ${son.getDate()} ${AYLAR[son.getMonth()]} ${yil}`
  }
  return `${ilk.getDate()} ${AYLAR[ilk.getMonth()]} – ${son.getDate()} ${AYLAR[son.getMonth()]} ${yil}`
}
