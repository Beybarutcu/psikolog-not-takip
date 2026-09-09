import type { DanisanDosyasi, EkBilgisi, SeansNotu } from '../api'
import { SABLON_ADLARI, sablonKodMu } from '../seans/sablon'

/**
 * KVKK md. 11 kapsamındaki **danışan veri raporunun** metni.
 *
 * # Özel not buraya YAPISAL olarak giremez
 *
 * Not kaynağı tek bir parametredir ve tipi `SeansNotu[]` — yani
 * `progress_notes`'un şekli. `OzelNot`'ta `sablon` ve `client_id` alanları
 * **yoktur**, dolayısıyla özel bir notu bu fonksiyona geçirmek tip
 * seviyesinde de mümkün değildir. Koruma bir filtreye ("özel olanları
 * ayıkla") dayanmıyor; planın bağlayıcı kısıtı tam olarak bunu söylüyor:
 * *bir `WHERE gizli = 0` filtresine güvenilmez — unutulan tek bir sorgu
 * koruma sözünü bozar.*
 *
 * Fonksiyon ayrı bir dosyada duruyor ki bu güvence bir bileşenin içine
 * gömülü kalmasın: ileride bir "yazdır" ya da "PDF'e aktar" ekranı yazan
 * geliştirici dışa aktarım metnini burada bulur ve bu başlığı okur.
 *
 * # Ekler yalnızca ÜSTVERİ
 *
 * Dosya içerikleri rapora gömülmez (ayrı ayrı indirilirler). Gömülselerdi
 * rapor tek bir metin dosyasında onlarca megabaytlık sağlık verisi taşırdı
 * ve "ekleri dahil etmeyi unutmuşuz" diye bir sonraki adımda genişletilmeye
 * açık olurdu.
 *
 * # Metin, neyin DAHİL OLMADIĞINI da söyler
 *
 * Raporu okuyan danışan olabilir. "Terapistin özel notları dahil değildir"
 * satırı bir gizleme değil, aksine: dosyanın tam olmadığını ve neyin eksik
 * olduğunu açıkça bildirir.
 */
export function veriRaporuMetni(
  danisan: DanisanDosyasi,
  notlar: SeansNotu[],
  ekler: EkBilgisi[],
): string {
  const sablonAdi = (kod: string) => (sablonKodMu(kod) ? SABLON_ADLARI[kod] : kod)
  const satirlar: string[] = [
    'DANIŞAN VERİ RAPORU',
    'KVKK md. 11 kapsamında, danışanın kendi verisine erişim talebi için.',
    '',
    `Ad soyad: ${danisan.ad_soyad}`,
    `Telefon: ${danisan.telefon ?? '(kayıtlı değil)'}`,
    `Doğum tarihi: ${danisan.dogum_tarihi ?? '(kayıtlı değil)'}`,
    `Başvuru nedeni: ${danisan.basvuru_nedeni ?? '(kayıtlı değil)'}`,
    `Açık rıza tarihi: ${danisan.riza_tarihi ?? '(kayıtlı değil)'}`,
    `Son temas: ${danisan.son_temas ?? '(kayıtlı değil)'}`,
    `Saklama süresi bitişi: ${danisan.saklama_bitis ?? '(hesaplanmadı)'}`,
    '',
    'NOT: Terapistin özel notları bu rapora dahil değildir. Onlar ayrı bir',
    'tabloda tutulur; hiçbir dışa aktarıma, rapora veya aramaya girmez.',
    '',
    `SEANS NOTLARI (${notlar.length})`,
    '',
  ]
  for (const not of notlar) {
    satirlar.push(`--- Randevu #${not.appointment_id} · ${sablonAdi(not.sablon)}`)
    satirlar.push(`Son düzenleme: ${not.guncelleme_zamani}`)
    satirlar.push(not.icerik)
    satirlar.push('')
  }
  satirlar.push(`EKLİ DOSYALAR (${ekler.length}) — yalnızca liste, içerik dahil değildir`)
  for (const ek of ekler) {
    satirlar.push(`- ${ek.dosya_adi} (${ek.tur}, ${ek.boyut} bayt, ${ek.eklenme_zamani})`)
  }
  return satirlar.join('\n')
}
