//! Ortak tarih/saat biçim doğrulaması.
//!
//! Beklenen biçim: `YYYY-AA-GGTSS:DD` (yerel duvar saati, zaman dilimi yok).
//!
//! Bu fonksiyon bir gizlilik kapısı görevi görür: `store::audit::Ayrinti`
//! içindeki `AralikBaslangici`/`SeriSilme` varyantları, ham (doğrulanmamış)
//! bir dizginin erişim loguna sızmasını bu fonksiyonla engeller;
//! `store::appointments` de randevu başlangıç/bitiş zamanlarının biçimini
//! aynı fonksiyonla doğrular. Önceden `audit.rs` içinde yerel bir kopyası
//! vardı; randevu deposu ikinci bir kopya ihtiyacı doğurunca ortak bu modüle
//! taşındı -- iki (veya daha fazla) kopyadan biri güncellenip diğeri
//! unutulursa sessiz bir tutarsızlık doğar, bu yüzden TEK tanım burada
//! tutulur ve diğer modüller buradan içe aktarır.
//!
//! # Biçim YETMEZ: takvim de kontrol edilir
//! Bu fonksiyon uzun süre yalnızca uzunluk/ayıraç/rakam kontrolü yaptı ve
//! `"2026-02-30T14:00"`, `"2026-13-45T99:99"` gibi biçimce kusursuz ama
//! takvimde var olmayan damgaları geçirdi. Bu yalnızca "çirkin veri" değildi:
//! böyle bir randevu `geldi` işaretlendiğinde `appointments::son_temasi_isaretle`
//! günü `clients::son_temasi_tazele` -> `yil_ekle` -> `tarih_gecerli_mi`
//! zincirine veriyor, o zincir günü GERÇEKTEN çözümlediği için reddediyor ve
//! **durum güncellemesinin tamamı geri alınıyordu** -- üstelik hata mesajı
//! kullanıcının hiç dokunmadığı bir alanı ("Son temas tarihi") adlandırıyordu.
//! Doğru düzeltme mesajı değiştirmek değil, geçersiz günün veritabanına HİÇ
//! girmemesiydi; bu yüzden kontrol kaynakta, tek kapıda yapılıyor.
//!
//! Duvar saati sözleşmesi korunur: dizgi yalnızca **doğrulamak için**
//! ayrıştırılır, `Date`/`OffsetDateTime`'a çevrilip geri yazılmaz; saklanan
//! dizgi neyse odur.
pub fn zaman_gecerli_mi(s: &str) -> bool {
    let b = s.as_bytes();
    let bicim = b.len() == 16
        && b[4] == b'-'
        && b[7] == b'-'
        && b[10] == b'T'
        && b[13] == b':'
        && b.iter().enumerate().all(|(i, c)| matches!(i, 4 | 7 | 10 | 13) || c.is_ascii_digit());
    if !bicim {
        return false;
    }
    // Gün gerçekten takvimde var mı? `tarih_gecerli_mi` ile AYNI mekanizma
    // (`tarih_coz`) kullanılıyor: iki ayrı takvim kuralı kopyası tutulsaydı
    // biri güncellenip diğeri unutulurdu (bu modülün var oluş nedeni).
    if tarih_coz(&s[0..10]).is_none() {
        return false;
    }
    // Saat/dakika. `bicim` bu dört karakterin rakam olduğunu garanti eder,
    // dolayısıyla ayrıştırma başarısız olamaz; yine de `is_some_and` ile
    // panik yolu bırakılmıyor.
    let saat_ok = s[11..13].parse::<u8>().is_ok_and(|h| h <= 23);
    let dakika_ok = s[14..16].parse::<u8>().is_ok_and(|d| d <= 59);
    saat_ok && dakika_ok
}

/// Yalnızca TARİH (saat yok) biçimi: `YYYY-AA-GG`, 10 karakter.
///
/// `zaman_gecerli_mi`'nin kardeşi ama AYNI ŞEY DEĞİL: o 16 karakterlik duvar
/// saati damgasını (`YYYY-AA-GGTSS:DD`) doğrular, bu 10 karakterlik takvim
/// gününü. İkisini karıştırmak sessiz bir hatadır (`"2026-09-07"` bir randevu
/// zamanı olarak geçersizdir, `"2026-09-07T14:00"` bir doğum tarihi olarak
/// geçersizdir), bu yüzden iki ayrı ad ve iki ayrı uzunluk kontrolü var.
///
/// Biçimin ötesinde TAKVİMDE VAR OLMA da kontrol edilir: `"2026-02-30"` ve
/// `"2025-02-29"` biçimce kusursuzdur ama gerçek gün değildir. Danışan
/// dosyasındaki `dogum_tarihi`/`riza_tarihi` alanları saklama süresi
/// hesabına (`clients::son_temasi_tazele`) ve rıza takibine girdiği için
/// var olmayan bir gün burada durdurulur, veritabanına yazılmaz.
pub fn tarih_gecerli_mi(s: &str) -> bool {
    let b = s.as_bytes();
    let bicim = b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter().enumerate().all(|(i, c)| matches!(i, 4 | 7) || c.is_ascii_digit());
    if !bicim {
        return false;
    }
    tarih_coz(s).is_some()
}

/// `YYYY-AA-GG` dizgisini `time::Date`'e çevirir; takvimde yoksa `None`.
///
/// Biçim kontrolü YAPMAZ (çağıran `tarih_gecerli_mi` üzerinden gelir ya da
/// kendi kontrolünü yapar); yalnızca ayrıştırma ve takvim geçerliliği.
pub fn tarih_coz(s: &str) -> Option<time::Date> {
    let yil: i32 = s.get(0..4)?.parse().ok()?;
    let ay: u8 = s.get(5..7)?.parse().ok()?;
    let gun: u8 = s.get(8..10)?.parse().ok()?;
    let ay = time::Month::try_from(ay).ok()?;
    time::Date::from_calendar_date(yil, ay, gun).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gecerli_bicim_kabul_edilir() {
        assert!(zaman_gecerli_mi("2026-09-07T14:00"));
    }

    /// ARTI YÖN -- sıkılaştırmanın gerçek günleri REDDETMEDİĞİ.
    ///
    /// Bu test olmasaydı `zaman_gecerli_mi`'yi `false` döndüren bir uygulama
    /// da eksi yön testlerinin hepsini geçerdi (tek yönlü mutasyon kapsamı).
    /// Fonksiyon altı giriş noktasında kullanılıyor; "her şeyi reddet" hatası
    /// randevu oluşturmayı tamamen kırardı.
    #[test]
    fn takvimde_var_olan_zamanlar_kabul_edilir() {
        assert!(zaman_gecerli_mi("2026-02-28T14:00"), "subatin son gunu");
        assert!(zaman_gecerli_mi("2028-02-29T14:00"), "2028 artik yil");
        assert!(zaman_gecerli_mi("2026-01-31T00:00"), "gun ve saat alt/ust sinirlari");
        assert!(zaman_gecerli_mi("2026-12-31T23:59"), "yilin son dakikasi");
        assert!(zaman_gecerli_mi("2026-04-30T09:05"), "30 gunluk ay");
    }

    #[test]
    fn takvimde_olmayan_zaman_reddedilir() {
        // Bicimce kusursuz (16 karakter, ayiraclar yerinde, hepsi rakam) ama
        // takvimde yok. Yalnizca bicim kontrolu yapan eski uygulama bunlari
        // GECIRIYORDU; gecen damga sonradan `son_temasi_tazele` zincirinde
        // patlayip durum guncellemesini geri aliyordu.
        assert!(!zaman_gecerli_mi("2026-02-30T14:00"), "subatin 30'u yok");
        assert!(!zaman_gecerli_mi("2026-02-29T14:00"), "2026 artik yil degil");
        assert!(!zaman_gecerli_mi("2026-13-01T00:00"), "13. ay yok");
        assert!(!zaman_gecerli_mi("2026-00-10T00:00"), "0. ay yok");
        assert!(!zaman_gecerli_mi("2026-01-32T00:00"), "32. gun yok");
        assert!(!zaman_gecerli_mi("2026-01-00T00:00"), "0. gun yok");
        assert!(!zaman_gecerli_mi("2026-04-31T00:00"), "nisan 30 cekiyor");
    }

    #[test]
    fn gecersiz_saat_ve_dakika_reddedilir() {
        assert!(!zaman_gecerli_mi("2026-01-01T24:00"), "24:00 diye bir saat yok");
        assert!(!zaman_gecerli_mi("2026-01-01T25:00"));
        assert!(!zaman_gecerli_mi("2026-01-01T00:60"));
        assert!(!zaman_gecerli_mi("2026-13-45T99:99"), "hepsi birden bozuk");
    }

    #[test]
    fn bozuk_bicim_reddedilir() {
        assert!(!zaman_gecerli_mi("07.09.2026 14:00"));
    }

    #[test]
    fn eksik_uzunluk_reddedilir() {
        assert!(!zaman_gecerli_mi("2026-09-07T14:0"));
    }

    #[test]
    fn zaman_dilimli_bicim_reddedilir() {
        assert!(!zaman_gecerli_mi("2026-09-07T14:00Z"));
    }

    #[test]
    fn gecerli_tarih_kabul_edilir() {
        assert!(tarih_gecerli_mi("2026-09-07"));
        assert!(tarih_gecerli_mi("2024-02-29"), "2024 artik yil");
    }

    #[test]
    fn takvimde_olmayan_gun_reddedilir() {
        // Bicimce kusursuz, takvimde yok. Yalnizca uzunluk/ayirac kontrolu
        // yapan bir dogrulayici bunlari GECIRIRDI.
        assert!(!tarih_gecerli_mi("2026-02-30"));
        assert!(!tarih_gecerli_mi("2025-02-29"), "2025 artik yil degil");
        assert!(!tarih_gecerli_mi("2026-13-01"));
        assert!(!tarih_gecerli_mi("2026-00-10"));
    }

    #[test]
    fn tarih_ve_zaman_dogrulayicilari_birbirinin_yerine_gecmez() {
        // Iki bicim ayri: birini digerinin yerine kullanmak sessiz bir hata
        // olurdu, bu yuzden capraz kabul EDILMEDIGI aciklikla test ediliyor.
        assert!(!tarih_gecerli_mi("2026-09-07T14:00"), "16 karakterlik zaman tarih degildir");
        assert!(!zaman_gecerli_mi("2026-09-07"), "10 karakterlik tarih zaman degildir");
    }

    #[test]
    fn bozuk_tarih_bicimi_reddedilir() {
        assert!(!tarih_gecerli_mi("07.09.2026"));
        assert!(!tarih_gecerli_mi("2026-9-7"));
        assert!(!tarih_gecerli_mi(""));
        assert!(!tarih_gecerli_mi("bugun"));
    }

    #[test]
    fn tarih_coz_gercek_gunu_dondurur() {
        let d = tarih_coz("2026-09-07").expect("gecerli tarih cozulmeli");
        assert_eq!(d.year(), 2026);
        assert_eq!(d.month() as u8, 9);
        assert_eq!(d.day(), 7);
        assert!(tarih_coz("2026-02-30").is_none());
    }
}
