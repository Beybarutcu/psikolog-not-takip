//! Parola değiştirme.
//!
//! `keystore::change_password` Plan 1'den beri **yazılmış ve test
//! edilmişti** ama hiçbir çağrı yeri yoktu: kullanıcı parolasını
//! değiştiremiyordu. Bu, bu kod tabanında tekrar eden "kodda var, üründe
//! yok" sınıfının bir örneği daha (`backup::*`, `appointments::seriyi_sil`,
//! `clients::arsivle`, `attachments::depolama_durumu`,
//! `clients::saklama_suresi_dolanlar` hep aynı şekilde açıkta kalmıştı).
//!
//! Bu modül `backup::yedek_al_ve_kaydet` ile aynı sınıftadır: **dosya
//! işlemi + denetim kaydı** bir arada, çekirdekte. Rota katmanı ikinci bir
//! denetim satırı yazmaz (`notlar_api.rs::rota_modulleri_audit_kaydet_cagirmaz`).
//!
//! # KRİTİK: mevcut parola DOĞRULANIR
//!
//! Yalnızca yeni parola istemek yetmez. Oturum açıkken bilgisayarın başına
//! geçen biri parolayı değiştirip terapisti kendi verisinden kilitleyebilir
//! (ve yeni parolayla erişimi sürdürebilirdi). `parolayi_degistir` bu
//! yüzden **önce** mevcut parolayı `unlock_with_password` ile sınar.
//!
//! # KRİTİK: parola hiçbir biçimde loga girmez
//!
//! `audit_log` satırları **silinemez** (bkz. `schema::V1` tetikleyicileri):
//! oraya düşen bir parola kalıcı olurdu. Yazılan satır
//! `duzenleme | session | parola`'dır ve `ayrinti` **`None`**'dır --
//! `Ayrinti` kapalı bir enum ve parola taşıyan bir varyantı yok. Hata
//! tiplerinin hiçbiri de parola taşımaz (`ParolaHatasi`'nin hiçbir
//! varyantında alan yoktur), dolayısıyla `Debug`/`Display` çıktısı bir
//! panik mesajına ya da `eprintln!`e düşse bile parola sızmaz.
//!
//! # KURTARMA KODU: parola değişse de ÇALIŞMAYA DEVAM EDER
//!
//! Veri anahtarı iki ayrı sırla sarmalanır: parola ve kurtarma kodu.
//! `keystore::change_password` yalnızca **parola sarmalamasını** yeniler,
//! `recovery` alanını değiştirmeden kopyalar. Karar ve gerekçesi orada
//! yazılı; özeti: kurtarma kodunu geçersiz kılmak, kullanıcının bunu ancak
//! parolasını **unuttuğu** anda -- yani kurtarmanın tek işe yarayacağı
//! anda -- fark etmesi demek olurdu. Kullanıcıya da söylenir (arayüz metni)
//! ve `tests::parola_degisince_kurtarma_kodu_ayni_anahtari_acmaya_devam_eder`
//! ile korunur.
//!
//! # ESKİ YEDEKLER: eski parolayla açılır
//!
//! Bir yedek **çifttir**: `yedek-<damga>.db` + `yedek-<damga>.keystore.json`
//! (bkz. `backup` modül başlığı). Yedeğin anahtar dosyası, yedek alındığı
//! ANDAKİ sarmalamayı taşır; sonradan yapılan bir parola değişikliği ona
//! dokunmaz ve dokunmamalıdır -- geçmişteki bir dosyayı bugünkü bir
//! parolayla yeniden yazmak, o yedeği geri yüklemenin tek yolu olan
//! anahtarı kaybetme riskini yaratırdı. Sonuç: **bugünden önce alınmış
//! yedekler ESKİ parolayla açılır.** Bu, Plan 2 Görev 12'nin kanıt testinin
//! (`yedekleme_api.rs::geri_yuklenen_cift_eski_parolayla_calisir`)
//! doğruladığı davranıştır ve bilinçlidir; arayüz kullanıcıya bunu yazar.
//!
//! # Sıra: denetim kaydı ÖNCE (fail-closed), dosya yazımı SONRA
//!
//! `backup::yedek_al_ve_kaydet` fail-OPEN'dır (yedek alındıysa log
//! yazılamasa bile geri alınmaz), çünkü orada geri alınacak şey harici bir
//! diske yazılmış bir dosyadır. Burada durum tersidir ve fail-CLOSED
//! seçildi:
//!
//! - Denetim satırı **açık bir transaction içinde** yazılır, sonra keystore
//!   diske yazılır, en sonunda transaction commit edilir. Dosya yazımı
//!   başarısız olursa transaction düşer ve satır geri alınır: *olmamış bir
//!   parola değişikliği için kalıcı bir kayıt kalmaz.*
//! - Denetim satırı yazılamıyorsa parola **hiç değiştirilmez**
//!   (`KayitYazilamadi`) -- Plan 1'in kurulum/kilit-açma kararıyla aynı:
//!   *kaydedilemeyecek bir erişimi vermeyiz.* Parola değiştirmek acil bir
//!   güvenlik eylemi değildir; reddedip nedenini söylemek doğru olandır.
//!   (Karşıt karar için bkz. `routes::session::kilitle` -- kilitleme her
//!   zaman fail-open'dır.)
//!
//! Geriye tek bir dar pencere kalır: dosya yazıldıktan SONRA `commit`
//! başarısız olursa parola DEĞİŞMİŞ ama kayıt tamamlanmamış olur. Bu durum
//! ayrı bir varyantla (`KayitTamamlanamadi`) ve **parolanın değiştiğini
//! açıkça söyleyen** bir mesajla raporlanır; sessiz geçilmez.

use crate::crypto::keyring::CryptoError;
use crate::store::audit::{kaydet, Cihaz, Eylem, LogHacmi};
use crate::store::keystore::{self, Keystore};
use rusqlite::Connection;
use std::path::Path;

/// Yeni parolanın en az karakter sayısı — `routes::setup::kurulum`'daki
/// ilk kurulum kuralıyla **aynı**. Kurulumda 8 karakter isteyip
/// değiştirirken 3 karaktere izin vermek, kuralı ilk günden sonra
/// anlamsızlaştırırdı.
pub const ASGARI_PAROLA_UZUNLUGU: usize = 8;

/// `audit_log.varlik` — oturum olaylarıyla aynı varlık.
const VARLIK: &str = "session";

/// `audit_log.varlik_id` — **sabit**. Parolanın kendisinden, uzunluğundan
/// ya da herhangi bir parçasından türetilmez.
const VARLIK_ID: &str = "parola";

/// Parola değiştirme hataları.
///
/// # Varyantlar BİLEREK ayrıktır
///
/// "Mevcut parola yanlış" ile "yeni parola çok kısa" aynı hata değildir ve
/// aynı mesajı vermek bu kod tabanında **dört katmanda** bulunmuş bir hata
/// sınıfıdır ("her hata parola hatasıdır"): doğru parolasını girmiş bir
/// kullanıcıya yanlış sebebi söylemek, onu parolasını unuttuğu sonucuna ve
/// oradan da veriyi sıfırlamaya götürür.
///
/// Hiçbir varyant **alan taşımaz**: `Debug`/`Display` çıktısı bir panik
/// mesajına, bir `eprintln!`e ya da bir HTTP gövdesine düşse bile ne
/// parola ne de anahtar sızabilir.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ParolaHatasi {
    #[error("Mevcut parolanız hatalı. Parolanız değişmedi.")]
    MevcutParolaYanlis,
    #[error("Yeni parola en az 8 karakter olmalı. Parolanız değişmedi.")]
    YeniParolaKisa,
    #[error("Yeni parola mevcut parolanızla aynı. Parolanız değişmedi.")]
    YeniParolaAyni,
    /// Anahtar kaydı yapısal olarak bozuk ya da KDF/şifreleme başarısız.
    /// **Kullanıcı hatası değildir** ve onu dosyayı silmeye itmemelidir.
    #[error(
        "Anahtar dosyası okunamıyor; parola değiştirilemedi. Bu dosyayı silmeyin, \
         silerseniz verilerinize bir daha erişilemez. Yedekten geri yükleme gerekebilir."
    )]
    AnahtarKaydiBozuk,
    /// Yeni sarmalanmış anahtar diske yazılamadı (disk dolu, izin yok).
    /// Denetim satırı geri alınır; **parola değişmez**.
    #[error("Anahtar dosyası kaydedilemedi; parolanız DEĞİŞMEDİ. Diskte yer olduğundan emin olun.")]
    Yazilamadi,
    /// Denetim kaydı yazılamadı — fail-closed: **parola değişmez**.
    #[error("Denetim kaydı oluşturulamadığı için parola değiştirilmedi; parolanız DEĞİŞMEDİ.")]
    KayitYazilamadi,
    /// Dosya yazıldıktan SONRA denetim kaydı kalıcılaştırılamadı: parola
    /// **DEĞİŞTİ**. Sessiz geçilmez.
    #[error(
        "Parolanız DEĞİŞTİ ancak denetim kaydı tamamlanamadı. Bundan sonra yeni parolanızı \
         kullanın."
    )]
    KayitTamamlanamadi,
}

/// Mevcut parolayı doğrular, veri anahtarını yeni parolayla yeniden
/// sarmalar, `keystore.json`'ı **atomik** olarak yazar ve denetim kaydını
/// oluşturur.
///
/// Veri anahtarı **değişmez**: açık oturum kilitlenmez, kurtarma kodu
/// çalışmaya devam eder ve şifreli veritabanına yeniden anahtarlama
/// yapılmaz (bkz. modül başlığı).
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (`store::appointments` modül
/// başlığındaki uyarıyla aynı sınıf).
pub fn parolayi_degistir(
    conn: &Connection,
    keystore_yolu: &Path,
    ks: &Keystore,
    mevcut: &str,
    yeni: &str,
    cihaz: Cihaz,
) -> Result<(), ParolaHatasi> {
    // (1) MEVCUT PAROLA. Once bu: "yeni parola cok kisa" demeden once
    // cagiranin gercekten parolayi bilip bilmedigi belirlenmeli -- aksi
    // halde uc nokta, parola bilmeyen birine parola kurallarini denetleyen
    // bir oracle sunardi.
    match keystore::unlock_with_password(ks, mevcut) {
        Ok(_) => {}
        Err(CryptoError::WrongSecret) => return Err(ParolaHatasi::MevcutParolaYanlis),
        // `Format`/`Kdf`/`Encryption` kullanici hatasi DEGILDIR.
        Err(_) => return Err(ParolaHatasi::AnahtarKaydiBozuk),
    }

    // (2) YENI PAROLA KURALLARI -- mevcut parola hatasindan AYRI mesajlar.
    if yeni.chars().count() < ASGARI_PAROLA_UZUNLUGU {
        return Err(ParolaHatasi::YeniParolaKisa);
    }
    if yeni == mevcut {
        return Err(ParolaHatasi::YeniParolaAyni);
    }

    // (3) Yeniden sarmala. `change_password` KURTARMA sarmalamasini
    // degistirmeden kopyalar (bkz. modul basligi).
    let yeni_ks = keystore::change_password(ks, mevcut, yeni).map_err(|e| match e {
        CryptoError::WrongSecret => ParolaHatasi::MevcutParolaYanlis,
        _ => ParolaHatasi::AnahtarKaydiBozuk,
    })?;

    // (4) Denetim satiri ONCE, ama COMMIT EDILMEDEN: dosya yazimi
    // basarisiz olursa satir geri alinir ve olmamis bir degisiklik icin
    // SILINEMEZ bir kayit kalmaz.
    let tx = conn.unchecked_transaction().map_err(|_| ParolaHatasi::KayitYazilamadi)?;
    kaydet(&tx, Eylem::Duzenleme, VARLIK, VARLIK_ID, cihaz, None, LogHacmi::HerCagri)
        .map_err(|_| ParolaHatasi::KayitYazilamadi)?;

    // (5) Diske ATOMIK yaz (`keystore::save` gecici dosya + rename).
    keystore::save(&yeni_ks, keystore_yolu).map_err(|_| ParolaHatasi::Yazilamadi)?;

    // (6) Artik geri donus yok: dosya degisti, kayit kaliciysa islem tamam.
    tx.commit().map_err(|_| ParolaHatasi::KayitTamamlanamadi)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::{generate_data_key, KdfParams};
    use crate::store::db::open_encrypted;
    use crate::store::keystore::SetupResult;
    use crate::store::schema::migrate;

    const ESKI: &str = "eski-parola-123";
    const YENI: &str = "yeni-parola-456";

    struct Ortam {
        _dir: tempfile::TempDir,
        conn: Connection,
        keystore_yolu: std::path::PathBuf,
        kurulum: SetupResult,
    }

    fn kur() -> Ortam {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_encrypted(&dir.path().join("veri.db"), &generate_data_key()).unwrap();
        migrate(&conn).unwrap();
        let kurulum = keystore::create(ESKI, KdfParams::test_fast()).unwrap();
        let keystore_yolu = dir.path().join("keystore.json");
        keystore::save(&kurulum.keystore, &keystore_yolu).unwrap();
        Ortam { _dir: dir, conn, keystore_yolu, kurulum }
    }

    fn degistir(o: &Ortam, mevcut: &str, yeni: &str) -> Result<(), ParolaHatasi> {
        let diskteki = keystore::load(&o.keystore_yolu).unwrap();
        parolayi_degistir(&o.conn, &o.keystore_yolu, &diskteki, mevcut, yeni, Cihaz::Masaustu)
    }

    fn log_satirlari(conn: &Connection) -> Vec<String> {
        crate::store::audit::son_kayitlar(conn, 100)
            .unwrap()
            .into_iter()
            .map(|k| format!("{}|{}|{}|{:?}", k.eylem, k.varlik, k.varlik_id, k.ayrinti))
            .collect()
    }

    #[test]
    fn parola_degisir_ve_eskisi_artik_calismaz() {
        let o = kur();
        degistir(&o, ESKI, YENI).unwrap();

        let diskteki = keystore::load(&o.keystore_yolu).unwrap();
        let acilan = keystore::unlock_with_password(&diskteki, YENI).unwrap();
        assert_eq!(
            acilan.as_ref(),
            o.kurulum.data_key.as_ref(),
            "veri anahtari DEGISMEMELI -- degisseydi sifreli veritabani acilamazdi"
        );
        assert!(
            keystore::unlock_with_password(&diskteki, ESKI).is_err(),
            "eski parola artik acmamali"
        );
    }

    #[test]
    fn parola_degisince_kurtarma_kodu_ayni_anahtari_acmaya_devam_eder() {
        // KARAR: kurtarma kodu parola degisiminden ETKILENMEZ. Bunu
        // gecersiz kilan bir uygulama, kullaniciya ancak parolasini
        // unuttugu anda -- yani kurtarmanin tek ise yarayacagi anda --
        // fark ettirirdi.
        //
        // MUTASYON: `keystore::change_password`i `recovery`yi de yeni
        // parolayla sarmalayacak sekilde degistir -> bu test kirilir.
        let o = kur();
        degistir(&o, ESKI, YENI).unwrap();

        let diskteki = keystore::load(&o.keystore_yolu).unwrap();
        let acilan = keystore::unlock_with_recovery(&diskteki, &o.kurulum.recovery_code).unwrap();
        assert_eq!(
            acilan.as_ref(),
            o.kurulum.data_key.as_ref(),
            "kurtarma kodu parola degisiminden SONRA da ayni veri anahtarini acmali"
        );
    }

    #[test]
    fn eski_bir_yedegin_anahtar_dosyasi_eski_parolayla_acilmaya_devam_eder() {
        // Bir yedek CIFTTIR ve kendi anahtar dosyasini tasir. Parola
        // degisikligi gecmisteki yedeklere DOKUNMAZ; bu bilincli ve
        // `yedekleme_api.rs::geri_yuklenen_cift_eski_parolayla_calisir`
        // testinin dogruladigi davranistir. Arayuz kullaniciya bunu yazar.
        let o = kur();
        // "Yedek": degisiklikten ONCE alinmis anahtar dosyasinin kopyasi.
        let yedek_ks = keystore::load(&o.keystore_yolu).unwrap();

        degistir(&o, ESKI, YENI).unwrap();

        assert!(
            keystore::unlock_with_password(&yedek_ks, ESKI).is_ok(),
            "eski yedegin anahtar dosyasi ESKI parolayla acilmali"
        );
        assert!(
            keystore::unlock_with_password(&yedek_ks, YENI).is_err(),
            "eski yedek YENI parolayla acilmamali -- yedek kendi anda dondu"
        );
    }

    #[test]
    fn yanlis_mevcut_parola_reddedilir_ve_dosya_degismez() {
        let o = kur();
        let once = std::fs::read(&o.keystore_yolu).unwrap();

        let hata = degistir(&o, "bambaska-parola", YENI).unwrap_err();
        assert_eq!(hata, ParolaHatasi::MevcutParolaYanlis);

        assert_eq!(
            std::fs::read(&o.keystore_yolu).unwrap(),
            once,
            "reddedilen degisiklik anahtar dosyasina DOKUNMAMALI"
        );
        assert!(log_satirlari(&o.conn).is_empty(), "reddedilen degisiklik log satiri birakmamali");
    }

    #[test]
    fn hata_mesajlari_birbirinden_ayrisik() {
        // "Her hata parola hatasidir" tuzagi: kullanici neyi duzeltecegini
        // bilmeli. Uc ret sebebi de birbirinden farkli metin uretmeli.
        let o = kur();
        let yanlis = degistir(&o, "bambaska-parola", YENI).unwrap_err();
        let kisa = degistir(&o, ESKI, "kisa").unwrap_err();
        let ayni = degistir(&o, ESKI, ESKI).unwrap_err();

        assert_eq!(yanlis, ParolaHatasi::MevcutParolaYanlis);
        assert_eq!(kisa, ParolaHatasi::YeniParolaKisa);
        assert_eq!(ayni, ParolaHatasi::YeniParolaAyni);

        let metinler = [yanlis.to_string(), kisa.to_string(), ayni.to_string()];
        for (i, a) in metinler.iter().enumerate() {
            for b in metinler.iter().skip(i + 1) {
                assert_ne!(a, b, "iki ayri ret ayni mesaji vermemeli");
            }
        }
        // Ve hicbiri "parolaniz degisti" izlenimi vermemeli.
        for m in &metinler {
            assert!(m.contains("değişmedi"), "ret mesaji degismedigini soylemeli: {m}");
        }
    }

    #[test]
    fn sinirdaki_parola_kabul_edilir_bir_kisasi_reddedilir() {
        // IKI YON: "cok az" kadar "cok fazla" da bir hata modu. Yalnizca
        // eksi yon olsaydi HER parolayi reddeden bir uygulama da gecerdi.
        let o = kur();
        let bir_kisa = "a".repeat(ASGARI_PAROLA_UZUNLUGU - 1);
        assert_eq!(degistir(&o, ESKI, &bir_kisa).unwrap_err(), ParolaHatasi::YeniParolaKisa);

        let tam_sinirda = "a".repeat(ASGARI_PAROLA_UZUNLUGU);
        degistir(&o, ESKI, &tam_sinirda).expect("sinirdaki parola kabul edilmeli");
    }

    #[test]
    fn parola_uzunlugu_karakter_sayar_bayt_degil() {
        // Turkce bir parola ("şşşşşşşş") 8 karakter ama 16 bayttir. Bayt
        // sayan bir kontrol onu kabul eder, 8 ASCII karakterlik bir parolayi
        // kabul ederken 5 harflik "şşşşş"i (10 bayt) da kabul ederdi.
        let o = kur();
        let bes_turkce = "şşşşş"; // 5 karakter, 10 bayt
        assert_eq!(
            degistir(&o, ESKI, bes_turkce).unwrap_err(),
            ParolaHatasi::YeniParolaKisa,
            "uzunluk bayt degil KARAKTER sayilmali"
        );
    }

    #[test]
    fn basarili_degisiklik_tek_bir_duzenleme_satiri_yazar() {
        let o = kur();
        degistir(&o, ESKI, YENI).unwrap();
        assert_eq!(
            log_satirlari(&o.conn),
            vec!["duzenleme|session|parola|None".to_string()],
            "parola degisikligi tek bir satir yazmali"
        );
    }

    #[test]
    fn parola_hicbir_bicimde_loga_girmez() {
        let o = kur();
        degistir(&o, ESKI, YENI).unwrap();

        for satir in log_satirlari(&o.conn) {
            let kucuk = satir.to_lowercase();
            for parca in [ESKI, YENI, "eski-parola", "yeni-parola", "parola-123", "456"] {
                assert!(
                    !kucuk.contains(&parca.to_lowercase()),
                    "parola parcasi '{parca}' loga sizmis: {satir}"
                );
            }
        }
    }

    #[test]
    fn hata_ciktilari_parolayi_tasimaz() {
        // `ParolaHatasi` alan tasimayan bir enum: `{:?}` bir panik mesajina
        // ya da `eprintln!`e dusse bile parola sizamaz. Bu, `DataKey` ve
        // `Ayrinti` icin verilen kararla ayni sinif.
        let o = kur();
        let hata = degistir(&o, "GIZLI_YANLIS_PAROLA", "GIZLI_YENI_PAROLA").unwrap_err();
        let cikti = format!("{hata} {hata:?}");
        assert!(!cikti.contains("GIZLI_YANLIS_PAROLA"), "{cikti}");
        assert!(!cikti.contains("GIZLI_YENI_PAROLA"), "{cikti}");
    }

    #[test]
    fn log_yazilamazsa_parola_degismez() {
        // FAIL-CLOSED. Denetim satiri yazilamiyorsa islem hic yapilmaz:
        // "kaydedemedigimiz bir erisimi vermeyiz" (Plan 1'in kurulum /
        // kilit-acma karariyla ayni).
        //
        // MUTASYON: `kaydet`in `?`sini `let _ =` yap -> parola degisir ve
        // bu test kirilir.
        let o = kur();
        let once = std::fs::read(&o.keystore_yolu).unwrap();
        // `audit_log`u bozarak `kaydet`i basarisiz kil (kardes depo
        // testleriyle ayni yontem).
        o.conn.execute_batch("DROP TABLE audit_log").unwrap();

        let hata = degistir(&o, ESKI, YENI).unwrap_err();
        assert_eq!(hata, ParolaHatasi::KayitYazilamadi);

        assert_eq!(
            std::fs::read(&o.keystore_yolu).unwrap(),
            once,
            "log yazilamadiysa anahtar dosyasi DEGISMEMELI"
        );
        let diskteki = keystore::load(&o.keystore_yolu).unwrap();
        assert!(
            keystore::unlock_with_password(&diskteki, ESKI).is_ok(),
            "log yazilamadiysa ESKI parola calismaya devam etmeli"
        );
        assert!(keystore::unlock_with_password(&diskteki, YENI).is_err());
    }

    #[test]
    fn dosya_yazilamazsa_denetim_satiri_geri_alinir() {
        // Ters yon: satir once yaziliyor ama COMMIT EDILMIYOR. Dosya
        // yazimi basarisiz olursa olmamis bir degisiklik icin SILINEMEZ bir
        // kayit kalmamali.
        //
        // MUTASYON: `kaydet`i `conn` uzerinde (transaction'siz) cagir ->
        // satir kalir ve bu test kirilir.
        let o = kur();
        // Keystore yolunu YAZILAMAZ yap: hedefin ust dizini artik bir
        // dizin degil, duz bir dosya. `save` once `create_dir_all` yapar ve
        // orada patlar.
        let engel = o._dir.path().join("engel");
        std::fs::write(&engel, b"ben bir dizin degilim").unwrap();
        let yazilamaz = engel.join("keystore.json");

        let diskteki = keystore::load(&o.keystore_yolu).unwrap();
        let hata =
            parolayi_degistir(&o.conn, &yazilamaz, &diskteki, ESKI, YENI, Cihaz::Masaustu)
                .unwrap_err();
        assert_eq!(hata, ParolaHatasi::Yazilamadi);

        assert!(
            log_satirlari(&o.conn).is_empty(),
            "dosya yazilamadiysa denetim satiri geri alinmali: {:?}",
            log_satirlari(&o.conn)
        );
    }

    #[test]
    fn bozuk_anahtar_kaydi_parola_hatasi_olarak_raporlanmaz() {
        // Bu kod tabanindaki dort katmanli hata sinifinin bu katmandaki
        // karsiligi: yapisal olarak bozuk bir kayit "parolaniz yanlis"
        // DEMEMELI, yoksa kullanici dogru parolasini tekrar tekrar deneyip
        // sonunda dosyayi siler.
        let o = kur();
        let mut bozuk = keystore::load(&o.keystore_yolu).unwrap();
        bozuk.password.ciphertext_hex.truncate(4);

        let hata =
            parolayi_degistir(&o.conn, &o.keystore_yolu, &bozuk, ESKI, YENI, Cihaz::Masaustu)
                .unwrap_err();
        assert_eq!(hata, ParolaHatasi::AnahtarKaydiBozuk);
        assert_ne!(hata.to_string(), ParolaHatasi::MevcutParolaYanlis.to_string());
        assert!(hata.to_string().contains("silmeyin"), "mesaj silmemeyi ogutlemeli");
    }
}
