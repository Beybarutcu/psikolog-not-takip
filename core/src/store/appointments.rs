//! Randevu (appointment) deposu.
//!
//! Tasarım kararı gereği randevu ve seans aynı kayıttır (ileride not bu
//! kayıtlara bağlanacak); bu modül `appointments` tablosu üzerinde
//! oluşturma, aralık sorgusu, durum güncelleme ve silme işlemlerini sağlar.
//! Desen `store::clients` (Plan 2 Görev 3) ile birebir aynıdır: `DepoHatasi`
//! oradan içe aktarılır, `Debug` elle yazılır, yazma + audit log tek
//! transaction'da yapılır.
//!
//! # Hassas veri kuralı (bkz. `store::audit`)
//! `Randevu.danisan_adi` KVKK kapsamında özel nitelikli/kişisel veridir. Bu
//! modüldeki hiçbir fonksiyon bunu `audit::kaydet`'in `ayrinti` alanına
//! yazmaz; `varlik_id` alanına da yalnızca sayısal randevu kimliği yazılır,
//! isim asla yazılmaz.
//!
//! # Yazma + log aynı transaction'da
//! `olustur`, `durum_guncelle` ve `sil` veriyi değiştirir; üçü de tabloya
//! yazdıktan hemen sonra `audit::kaydet` çağırır. Bu adımlar
//! `conn.unchecked_transaction()` ile TEK transaction'a alınır -- log yazımı
//! başarısız olursa veri değişikliği de geri alınır, "randevu değişti ama
//! loglanmadı" durumu oluşmaz (bkz. `tests` modülündeki `..._atomik_...`
//! testleri: bu garanti `audit_log` tablosunu bilerek bozup hem pozitif hem
//! negatif yönde test edilir). `Connection::transaction()` (`&mut self`)
//! değil `unchecked_transaction()` (`&self`) kullanılıyor çünkü bu depo
//! fonksiyonlarının imzası (brief'te sabit) `&Connection` alıyor; bu güvenli
//! çünkü bu fonksiyonlar `schema::migrate`'i çağırmıyor, dolayısıyla iç içe
//! transaction riski yok. `aralik_getir` salt okunur olduğundan (veri
//! durumu değişmiyor) ayrı transaction gerektirmiyor.
//!
//! # UYARI — iç içe transaction açılamaz
//! `olustur`, `durum_guncelle` ve `sil` kendi `unchecked_transaction()`'ını
//! içeride açar. SQLite iç içe transaction'ı desteklemez ("cannot start a
//! transaction within a transaction"): bu üç fonksiyonu **başka bir
//! transaction'ın içinden** çağırmayın. Bu sessiz bir veri bozulması değil,
//! `rusqlite::Error` olarak dönen gürültülü bir hatadır -- ama derleyici
//! yakalamaz.

use crate::store::audit::{kaydet, Ayrinti, Cihaz, Eylem};
use crate::store::clients::DepoHatasi;
use crate::store::zaman::zaman_gecerli_mi;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, Date, Month, OffsetDateTime};

pub const GECERLI_DURUMLAR: [&str; 4] = ["planlandi", "geldi", "gelmedi", "iptal"];

/// Bir seride üretilebilecek azami randevu sayısı (ilk randevu dahil).
/// Bkz. `seri_olustur` -- terapi süreci sonsuz olmadığı için sonsuz seri
/// kurulamaması kabul edilebilir bir bedel.
pub const AZAMI_TEKRAR: u32 = 52;

/// Randevu (= seans) kaydı — asgari alanlar.
///
/// `Debug` türetilmiyor. `clients::Danisan`'daki desenden farklı olarak
/// yalnızca `danisan_adi` gizlenmiyor: `client_id` + `baslangic` + `bitis` +
/// `durum` bir arada ("42 numaralı danışan, 2026-09-07T14:00, gelmedi")
/// isim olmadan da kimliklenebilir bir kişinin bir seansa katılıp
/// katılmadığını söyler -- bu KVKK kapsamında özel nitelikli sağlık
/// verisidir. Bu yüzden `client_id`, `danisan_adi`, `baslangic`, `bitis` ve
/// `durum` `Debug` çıktısında gizlenir; yalnızca `id` (ve doğrudan
/// hassas olmayan `ucret`/`odendi`/`seri_id`) görünür kalır -- hata
/// ayıklarken kayda bakmak isteyen zaten `id` ile veritabanından okuyabilir.
/// `Serialize` ise arayüz için TÜM alanları İÇERİR -- gizleme yalnızca
/// `Debug` çıktısı içindir.
#[derive(Clone, Serialize)]
pub struct Randevu {
    pub id: i64,
    pub client_id: i64,
    pub danisan_adi: String,
    pub baslangic: String,
    pub bitis: String,
    pub durum: String,
    pub ucret: Option<i64>,
    pub odendi: bool,
    pub seri_id: Option<String>,
}

impl std::fmt::Debug for Randevu {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Randevu")
            .field("id", &self.id)
            .field("client_id", &"<gizli>")
            .field("danisan_adi", &"<gizli>")
            .field("baslangic", &"<gizli>")
            .field("bitis", &"<gizli>")
            .field("durum", &"<gizli>")
            .field("ucret", &self.ucret)
            .field("odendi", &self.odendi)
            .field("seri_id", &self.seri_id)
            .finish()
    }
}

#[derive(Clone, Deserialize)]
pub struct YeniRandevu {
    pub client_id: i64,
    pub baslangic: String,
    pub bitis: String,
    pub ucret: Option<i64>,
}

fn simdi() -> String {
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .expect("nanosaniye sifirlanamadi")
        .format(&Rfc3339)
        .expect("zaman bicimlendirilemedi")
}

const SECIM: &str = "SELECT a.id, a.client_id, c.ad_soyad, a.baslangic, a.bitis, a.durum,
                            a.ucret, a.odendi, a.seri_id
                     FROM appointments a JOIN clients c ON c.id = a.client_id";

fn satirdan(r: &rusqlite::Row) -> Result<Randevu, rusqlite::Error> {
    Ok(Randevu {
        id: r.get(0)?,
        client_id: r.get(1)?,
        danisan_adi: r.get(2)?,
        baslangic: r.get(3)?,
        bitis: r.get(4)?,
        durum: r.get(5)?,
        ucret: r.get(6)?,
        odendi: r.get::<_, i64>(7)? != 0,
        seri_id: r.get(8)?,
    })
}

/// Yeni bir randevu oluşturur. Ekleme ve erişim logu tek transaction'da
/// yazılır.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (SQLite iç içe transaction
/// desteklemez, bkz. modül başlığındaki uyarı).
pub fn olustur(
    conn: &Connection,
    yeni: &YeniRandevu,
    cihaz: Cihaz,
) -> Result<Randevu, DepoHatasi> {
    if !zaman_gecerli_mi(&yeni.baslangic) || !zaman_gecerli_mi(&yeni.bitis) {
        return Err(DepoHatasi::GecersizVeri(
            "Tarih biçimi YYYY-AA-GGTSS:DD olmalı.".into(),
        ));
    }
    if yeni.bitis <= yeni.baslangic {
        return Err(DepoHatasi::GecersizVeri(
            "Randevu bitişi başlangıcından sonra olmalı.".into(),
        ));
    }
    if yeni.ucret.is_some_and(|u| u < 0) {
        return Err(DepoHatasi::GecersizVeri("Ücret negatif olamaz.".into()));
    }

    let tx = conn.unchecked_transaction()?;

    let z = simdi();
    tx.execute(
        "INSERT INTO appointments
           (client_id, baslangic, bitis, durum, ucret, odendi, olusturma_zamani, guncelleme_zamani)
         VALUES (?1, ?2, ?3, 'planlandi', ?4, 0, ?5, ?5)",
        rusqlite::params![yeni.client_id, yeni.baslangic, yeni.bitis, yeni.ucret, z],
    )?;
    let id = tx.last_insert_rowid();
    kaydet(&tx, Eylem::Ekleme, "appointment", &id.to_string(), cihaz, None)?;

    let randevu = tx.query_row(&format!("{SECIM} WHERE a.id = ?1"), [id], satirdan)?;

    tx.commit()?;
    Ok(randevu)
}

/// `baslangic` (dahil) ile `bitis` (hariç) arasındaki randevuları zamana
/// göre sıralı listeler. Salt okunur olduğundan transaction gerektirmez.
/// Kaç satır dönerse dönsün tek bir "goruntuleme" kaydı üretir -- satır
/// başına ayrı log gürültü üretir.
pub fn aralik_getir(
    conn: &Connection,
    baslangic: &str,
    bitis: &str,
    cihaz: Cihaz,
) -> Result<Vec<Randevu>, DepoHatasi> {
    if !zaman_gecerli_mi(baslangic) || !zaman_gecerli_mi(bitis) {
        return Err(DepoHatasi::GecersizVeri(
            "Tarih biçimi YYYY-AA-GGTSS:DD olmalı.".into(),
        ));
    }

    let mut stmt = conn.prepare(&format!(
        "{SECIM} WHERE a.baslangic >= ?1 AND a.baslangic < ?2 ORDER BY a.baslangic"
    ))?;
    let liste = stmt
        .query_map([baslangic, bitis], satirdan)?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    // Liste tek bir goruntuleme kaydi uretir, satir basina degil.
    kaydet(
        conn,
        Eylem::Goruntuleme,
        "appointment",
        "liste",
        cihaz,
        Some(Ayrinti::AralikBaslangici(baslangic.to_string())),
    )?;
    Ok(liste)
}

/// Bir randevunun durumunu günceller. Güncelleme ve erişim logu tek
/// transaction'da yazılır.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (SQLite iç içe transaction
/// desteklemez, bkz. modül başlığındaki uyarı).
pub fn durum_guncelle(
    conn: &Connection,
    id: i64,
    durum: &str,
    cihaz: Cihaz,
) -> Result<(), DepoHatasi> {
    // GECERLI_DURUMLAR icindeki eslesen &'static str referansi kullanilir
    // (cagirandan gelen `durum: &str` degil): boylece `Ayrinti::Durum`'a
    // yalnizca sabit, bilinen degerler gecer, kullanicidan gelen rastgele
    // metin -- bicimce eslesse bile -- asla loglanan degerin kaynagi olmaz.
    let Some(&sabit_durum) = GECERLI_DURUMLAR.iter().find(|&&d| d == durum) else {
        return Err(DepoHatasi::GecersizVeri(format!(
            "Geçersiz randevu durumu: {durum}"
        )));
    };

    let tx = conn.unchecked_transaction()?;

    let etkilenen = tx.execute(
        "UPDATE appointments SET durum = ?1, guncelleme_zamani = ?2 WHERE id = ?3",
        rusqlite::params![sabit_durum, simdi(), id],
    )?;
    if etkilenen == 0 {
        return Err(DepoHatasi::Bulunamadi);
    }
    kaydet(
        &tx,
        Eylem::Duzenleme,
        "appointment",
        &id.to_string(),
        cihaz,
        Some(Ayrinti::Durum(sabit_durum)),
    )?;

    tx.commit()?;
    Ok(())
}

/// Bir randevuyu siler. Silme ve erişim logu tek transaction'da yazılır.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (SQLite iç içe transaction
/// desteklemez, bkz. modül başlığındaki uyarı).
pub fn sil(conn: &Connection, id: i64, cihaz: Cihaz) -> Result<(), DepoHatasi> {
    let tx = conn.unchecked_transaction()?;

    let etkilenen = tx.execute("DELETE FROM appointments WHERE id = ?1", [id])?;
    if etkilenen == 0 {
        return Err(DepoHatasi::Bulunamadi);
    }
    kaydet(&tx, Eylem::Silme, "appointment", &id.to_string(), cihaz, None)?;

    tx.commit()?;
    Ok(())
}

/// Verilen aralıkla çakışan (iptal olmayan) randevuları bulur. **Engellemez,
/// yalnızca döndürür** -- ürün kararı gereği terapist bilerek üst üste
/// randevu koyabilir (çift seans, sıkıştırma, telefon görüşmesi), yazılımın
/// bunu durdurması yersizdir; çağıran taraf sonucu kullanıcıya uyarı olarak
/// gösterir.
///
/// İki aralık çakışır ancak ve ancak `a.baslangic < bitis` VE
/// `a.bitis > baslangic`. Bitişik aralıklar (14:00-15:00 ile 15:00-16:00) bu
/// kurala göre çakışmaz -- peş peşe seanslar normaldir.
///
/// `haric_id` verilirse o kayıt kendisiyle karşılaştırılmaz (düzenleme
/// akışı: bir randevuyu güncellerken onu kendi çakışması saymamak için).
///
/// Erişim logu YAZMAZ: bu, kullanıcının görmediği, form doğrulaması
/// sırasında (örn. her tuş vuruşunda) çalışan bir kontroldür. Her çağrıda
/// log üretmesi logu kullanılamaz hâle getirir -- ve log kayıtları
/// silinemediğinden bu kirlilik kalıcı olurdu. Kullanıcı çakışan randevuyu
/// ekranda gördüğünde zaten `aralik_getir` bir görüntüleme kaydı düşürmüş
/// olur, dolayısıyla erişim tamamen sessiz kalmaz.
pub fn cakisanlari_bul(
    conn: &Connection,
    baslangic: &str,
    bitis: &str,
    haric_id: Option<i64>,
) -> Result<Vec<Randevu>, DepoHatasi> {
    if !zaman_gecerli_mi(baslangic) || !zaman_gecerli_mi(bitis) {
        return Err(DepoHatasi::GecersizVeri(
            "Tarih biçimi YYYY-AA-GGTSS:DD olmalı.".into(),
        ));
    }

    let mut stmt = conn.prepare(&format!(
        "{SECIM}
         WHERE a.durum != 'iptal'
           AND a.baslangic < ?1
           AND a.bitis > ?2
           AND (?3 IS NULL OR a.id != ?3)
         ORDER BY a.baslangic"
    ))?;
    let liste = stmt
        .query_map(rusqlite::params![bitis, baslangic, haric_id], satirdan)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(liste)
}

/// `zaman` duvar saatine 7 gün ekler; yalnızca TARİH kısmı ilerletilir, saat
/// kısmı (`Tss:dd`) dizgi olarak dokunulmadan taşınır.
///
/// # Neden zaman damgasına çevirip 604800 saniye eklenmiyor
/// Randevular yerel duvar saati olarak saklanır (zaman dilimi yok, bkz.
/// `store::zaman`), çünkü terapistin 14:00'ü yaz saati uygulaması değişse
/// de 14:00'tür. Eğer bu dizgi bir `OffsetDateTime`'a/UNIX zaman damgasına
/// çevrilip üzerine 604800 saniye eklenseydi, yaz saati değişiminin olduğu
/// haftada (örn. Ekim sonu) o haftadan sonraki TÜM seri üyeleri bir saat
/// kayardı -- ve bunu kimse fark etmez, ta ki bir danışan yanlış saatte
/// gelene kadar. Bunun yerine yalnızca takvim tarihi (`time::Date`) 7 gün
/// ileri alınır, saat dizgisi (`saat_kismi`) hiç ayrıştırılmadan aynen
/// eklenir -- böylece saat kayması yapısal olarak imkânsızdır.
pub fn bir_hafta_sonra(zaman: &str) -> Result<String, DepoHatasi> {
    if !zaman_gecerli_mi(zaman) {
        return Err(DepoHatasi::GecersizVeri("Tarih biçimi hatalı.".into()));
    }
    let hata = || DepoHatasi::GecersizVeri("Tarih çözümlenemedi.".into());

    let yil: i32 = zaman[0..4].parse().map_err(|_| hata())?;
    let ay: u8 = zaman[5..7].parse().map_err(|_| hata())?;
    let gun: u8 = zaman[8..10].parse().map_err(|_| hata())?;
    let saat_kismi = &zaman[10..]; // "T14:00" -- hic dokunulmadan tasinir.

    let ay = Month::try_from(ay).map_err(|_| hata())?;
    let tarih = Date::from_calendar_date(yil, ay, gun).map_err(|_| hata())?;
    let sonraki = tarih.saturating_add(time::Duration::days(7));

    Ok(format!(
        "{:04}-{:02}-{:02}{}",
        sonraki.year(),
        sonraki.month() as u8,
        sonraki.day(),
        saat_kismi
    ))
}

/// Haftalık tekrarlayan randevu serisi oluşturur: ilk randevu dahil
/// `tekrar_sayisi` adet kayıt üretir, hepsi ortak bir `seri_id` paylaşır.
///
/// # Tasarım kararı — seri materialize edilir, saklanmaz
/// Seri bir "kural" olarak veritabanında tutulmaz; oluşturma anında tek tek
/// `appointments` satırlarına açılır (bkz. modül başlığı ve brief). Böylece
/// tek bir haftayı iptal etmek (`sil`), saatini kaydırmak veya ücretini
/// değiştirmek zaten var olan tekil-kayıt akışlarıyla çalışır -- kural
/// tabanlı bir modelde bunlar istisna yönetimi gerektirirdi. Bedeli sonsuz
/// seri kurulamamasıdır (`AZAMI_TEKRAR`), ki bir terapi süreci zaten sonsuz
/// değildir.
///
/// # Atomiklik — TÜM kayıtlar + audit log TEK transaction'da
/// Bu fonksiyon `olustur`'u ÇAĞIRMAZ: `olustur` kendi
/// `unchecked_transaction()`'ını açar ve onu burada döngü içinde çağırmak
/// iç içe transaction hatası verirdi (bkz. modül başlığındaki uyarı). Bunun
/// yerine ekleme mantığı burada tek bir transaction altında tekrarlanır --
/// serinin `tekrar_sayisi` kaydından biri (ya da audit log yazımı)
/// başarısız olursa TÜMÜ geri alınır, "yarım kalmış seri" durumu oluşmaz
/// (bkz. testler, `..._atomik_...` / `audit_basarisiz_...`).
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın.
pub fn seri_olustur(
    conn: &Connection,
    yeni: &YeniRandevu,
    tekrar_sayisi: u32,
    cihaz: Cihaz,
) -> Result<Vec<Randevu>, DepoHatasi> {
    if tekrar_sayisi == 0 || tekrar_sayisi > AZAMI_TEKRAR {
        return Err(DepoHatasi::GecersizVeri(format!(
            "Tekrar sayısı 1 ile {AZAMI_TEKRAR} arasında olmalı."
        )));
    }
    if !zaman_gecerli_mi(&yeni.baslangic) || !zaman_gecerli_mi(&yeni.bitis) {
        return Err(DepoHatasi::GecersizVeri(
            "Tarih biçimi YYYY-AA-GGTSS:DD olmalı.".into(),
        ));
    }
    if yeni.bitis <= yeni.baslangic {
        return Err(DepoHatasi::GecersizVeri(
            "Randevu bitişi başlangıcından sonra olmalı.".into(),
        ));
    }
    if yeni.ucret.is_some_and(|u| u < 0) {
        return Err(DepoHatasi::GecersizVeri("Ücret negatif olamaz.".into()));
    }

    let seri_id = uuid::Uuid::new_v4().to_string();
    let tx = conn.unchecked_transaction()?;

    let mut baslangic = yeni.baslangic.clone();
    let mut bitis = yeni.bitis.clone();
    let mut uretilenler = Vec::with_capacity(tekrar_sayisi as usize);

    for _ in 0..tekrar_sayisi {
        let z = simdi();
        tx.execute(
            "INSERT INTO appointments
               (client_id, baslangic, bitis, durum, ucret, odendi, seri_id, olusturma_zamani, guncelleme_zamani)
             VALUES (?1, ?2, ?3, 'planlandi', ?4, 0, ?5, ?6, ?6)",
            rusqlite::params![yeni.client_id, baslangic, bitis, yeni.ucret, seri_id, z],
        )?;
        let id = tx.last_insert_rowid();
        kaydet(&tx, Eylem::Ekleme, "appointment", &id.to_string(), cihaz, None)?;

        let randevu = tx.query_row(&format!("{SECIM} WHERE a.id = ?1"), [id], satirdan)?;
        uretilenler.push(randevu);

        // Sonraki uyenin baslangic/bitis'i, oncekinden 7 gun sonrasidir --
        // saat bileseni `bir_hafta_sonra` tarafindan korunur (yukaridaki
        // fonksiyon dokumantasyonuna bkz.). Hata durumunda `?` ile erken
        // donus yapilir; `tx` commit edilmeden dusup geri alinir (rollback),
        // dolayisiyla o ana kadar eklenen kayitlar da kalici olmaz.
        baslangic = bir_hafta_sonra(&baslangic)?;
        bitis = bir_hafta_sonra(&bitis)?;
    }

    tx.commit()?;
    Ok(uretilenler)
}

/// Bir randevu serisini, verilen tarihten (dahil) itibaren siler; öncesi
/// KORUNUR. Silme ve audit log yazımı tek transaction'da yapılır.
///
/// # Neden yalnızca ileri tarih silinir
/// "Bu seriyi iptal et" dendiğinde geçmiş seansların kaydının silinmesi
/// kabul edilemez -- bu, yapılmış işin (ve varsa ödeme/katılım bilgisinin)
/// kaydını yok eder. Bu yüzden sorgu `baslangic >= bu_tarihten_itibaren`
/// ile sınırlıdır; geçmişteki üyeler asla silinmez (bkz.
/// `seri_silme_yalnizca_verilen_tarihten_sonrasini_siler` testi).
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın.
pub fn seriyi_sil(
    conn: &Connection,
    seri_id: &str,
    bu_tarihten_itibaren: &str,
    cihaz: Cihaz,
) -> Result<usize, DepoHatasi> {
    if !zaman_gecerli_mi(bu_tarihten_itibaren) {
        return Err(DepoHatasi::GecersizVeri(
            "Tarih biçimi YYYY-AA-GGTSS:DD olmalı.".into(),
        ));
    }

    let tx = conn.unchecked_transaction()?;

    let silinen = tx.execute(
        "DELETE FROM appointments WHERE seri_id = ?1 AND baslangic >= ?2",
        rusqlite::params![seri_id, bu_tarihten_itibaren],
    )?;
    kaydet(
        &tx,
        Eylem::Silme,
        "appointment_seri",
        seri_id,
        cihaz,
        Some(Ayrinti::SeriSilme { adet: silinen, tarihten: bu_tarihten_itibaren.to_string() }),
    )?;

    tx.commit()?;
    Ok(silinen)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{
        clients::{ekle as danisan_ekle, YeniDanisan},
        db::open_encrypted,
        schema::migrate,
    };

    fn kurulum() -> (tempfile::TempDir, rusqlite::Connection, i64) {
        let dir = tempfile::tempdir().unwrap();
        let c = open_encrypted(&dir.path().join("v.db"), &generate_data_key()).unwrap();
        migrate(&c).unwrap();
        let d = danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "Ayse Yilmaz".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();
        (dir, c, d.id)
    }

    fn yeni(client_id: i64, baslangic: &str, bitis: &str) -> YeniRandevu {
        YeniRandevu {
            client_id,
            baslangic: baslangic.into(),
            bitis: bitis.into(),
            ucret: Some(45000),
        }
    }

    #[test]
    fn olusturulan_randevu_danisan_adiyla_birlikte_doner() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        assert_eq!(r.durum, "planlandi");
        assert_eq!(r.danisan_adi, "Ayse Yilmaz");
        assert_eq!(r.ucret, Some(45000));
        assert!(!r.odendi);
    }

    #[test]
    fn debug_ciktisi_danisan_adini_tarihi_ve_durumu_icermez() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        durum_guncelle(&c, r.id, "gelmedi", Cihaz::Masaustu).unwrap();
        let r = aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu)
            .unwrap()
            .remove(0);

        let cikti = format!("{:?}", r);
        assert!(!cikti.contains("Ayse"), "danisan adi Debug ciktisinda gorunmemeli: {cikti}");
        assert!(!cikti.contains("2026-09-07"), "tarih Debug ciktisinda gorunmemeli: {cikti}");
        assert!(!cikti.contains("gelmedi"), "durum Debug ciktisinda gorunmemeli: {cikti}");
        assert!(
            cikti.contains("client_id: \"<gizli>\""),
            "client_id Debug ciktisinda gizli olmali: {cikti}"
        );
        assert!(
            cikti.contains(&format!("id: {}", r.id)),
            "id Debug ciktisinda gercek degeriyle gorunmeli: {cikti}"
        );
    }

    #[test]
    fn bitis_baslangictan_once_olamaz() {
        let (_d, c, cid) = kurulum();
        let hata = olustur(&c, &yeni(cid, "2026-09-07T15:00", "2026-09-07T14:00"), Cihaz::Masaustu)
            .unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn negatif_ucret_reddedilir() {
        let (_d, c, cid) = kurulum();
        let yeni_negatif = YeniRandevu {
            client_id: cid,
            baslangic: "2026-09-07T14:00".into(),
            bitis: "2026-09-07T15:00".into(),
            ucret: Some(-1),
        };
        let hata = olustur(&c, &yeni_negatif, Cihaz::Masaustu).unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn bozuk_tarih_bicimi_reddedilir() {
        let (_d, c, cid) = kurulum();
        let hata =
            olustur(&c, &yeni(cid, "07.09.2026 14:00", "07.09.2026 15:00"), Cihaz::Masaustu)
                .unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn aralik_sorgusu_baslangici_dahil_bitisi_haric_alir() {
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T09:00", "2026-09-07T10:00"), Cihaz::Masaustu).unwrap();
        olustur(&c, &yeni(cid, "2026-09-14T09:00", "2026-09-14T10:00"), Cihaz::Masaustu).unwrap();

        let hafta = aralik_getir(&c, "2026-09-07T00:00", "2026-09-14T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(hafta.len(), 1, "sonraki haftanin randevusu girmemeli");
        assert_eq!(hafta[0].baslangic, "2026-09-07T09:00");
    }

    #[test]
    fn aralik_sorgusu_sinir_degerleri_dogru_davranir() {
        // Bulgu 2 duzeltmesi: `baslangic`'a TAM ESIT bir randevu (dahil
        // olmali) ile sorgu `bitis`'ine TAM ESIT bir randevu (haric olmali)
        // ayni testte denenir; boylece `>= baslangic AND < bitis` sinirlari
        // sadece dogru degil, testle de kanitlanmis olur.
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T00:00", "2026-09-07T01:00"), Cihaz::Masaustu).unwrap();
        olustur(&c, &yeni(cid, "2026-09-08T00:00", "2026-09-08T01:00"), Cihaz::Masaustu).unwrap();

        let liste = aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(liste.len(), 1, "sorgu bitisine tam esit randevu haric tutulmali");
        assert_eq!(liste[0].baslangic, "2026-09-07T00:00", "sorgu baslangicina tam esit randevu dahil olmali");
    }

    #[test]
    fn aralik_sonuclari_zamana_gore_siralanir() {
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T16:00", "2026-09-07T17:00"), Cihaz::Masaustu).unwrap();
        olustur(&c, &yeni(cid, "2026-09-07T09:00", "2026-09-07T10:00"), Cihaz::Masaustu).unwrap();

        let liste = aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(liste[0].baslangic, "2026-09-07T09:00");
    }

    #[test]
    fn aralik_getir_bozuk_tarih_bicimini_reddeder() {
        let (_d, c, _cid) = kurulum();
        let hata = aralik_getir(&c, "07.09.2026 00:00", "2026-09-08T00:00", Cihaz::Masaustu)
            .unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));

        let hata = aralik_getir(&c, "2026-09-07T00:00", "08.09.2026 00:00", Cihaz::Masaustu)
            .unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn durum_guncellenir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).unwrap();

        let liste = aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(liste[0].durum, "geldi");
    }

    #[test]
    fn gecersiz_durum_reddedilir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        let hata = durum_guncelle(&c, r.id, "belki_gelir", Cihaz::Masaustu).unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn silinen_randevu_listede_cikmaz_ve_loglanir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        sil(&c, r.id, Cihaz::Masaustu).unwrap();

        let liste = aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
        assert!(liste.is_empty());

        let eylemler: Vec<String> = crate::store::audit::son_kayitlar(&c, 10)
            .unwrap()
            .into_iter()
            .map(|k| k.eylem)
            .collect();
        assert!(eylemler.contains(&"silme".to_string()));
    }

    fn appointments_satir_sayisi(c: &rusqlite::Connection) -> i64 {
        c.query_row("SELECT COUNT(*) FROM appointments", [], |r| r.get(0)).unwrap()
    }

    // Bu uc test, `olustur`/`durum_guncelle`/`sil`'in veri yazma + audit log
    // yazma adimlarini tek transaction'a aldigini KANITLAR: `audit_log`
    // tablosunu kasten dusurup `kaydet`'i basarisiz kilariz. Transaction
    // yoksa (ya da `tx.commit()` cagrilmasa) veri degisikligi kalici olur,
    // log yazimi basarisiz olsa bile -- tam da onlemek istedigimiz "randevu
    // degisti ama loglanmadi" durumu. `clients.rs`'teki desenin aynisidir
    // (bkz. o dosyadaki `..._atomik_...` testleri). Bu testlerin transaction
    // OLMADAN gercekten basarisiz oldugunu dogrulamak icin `tx.commit()`/
    // `tx.execute`/`kaydet(&tx, ...)` gecici olarak dogrudan `conn`
    // kullanacak sekilde degistirilip calistirildi; cikti task-4-report.md
    // ekinde, sonra kod geri alindi.

    #[test]
    fn olustur_audit_basarisiz_olursa_yazma_geri_alinir() {
        let (_d, c, cid) = kurulum();
        c.execute("DROP TABLE audit_log", []).unwrap();

        let sonuc = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu);
        assert!(sonuc.is_err(), "audit_log yokken olustur Err donmeli");
        assert!(matches!(sonuc.unwrap_err(), DepoHatasi::Sqlite(_)));

        assert_eq!(
            appointments_satir_sayisi(&c),
            0,
            "audit log basarisiz oldugunda appointments tablosuna hicbir satir kalici yazilmamali"
        );
    }

    #[test]
    fn durum_guncelle_audit_basarisiz_olursa_durum_degismez() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();

        c.execute("DROP TABLE audit_log", []).unwrap();

        let sonuc = durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu);
        assert!(sonuc.is_err(), "audit_log yokken durum_guncelle Err donmeli");
        assert!(matches!(sonuc.unwrap_err(), DepoHatasi::Sqlite(_)));

        let durum: String = c
            .query_row("SELECT durum FROM appointments WHERE id = ?1", [r.id], |row| row.get(0))
            .unwrap();
        assert_eq!(durum, "planlandi", "audit log basarisiz oldugunda durum degisikligi geri alinmali");
    }

    #[test]
    fn sil_audit_basarisiz_olursa_kayit_silinmez() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();

        c.execute("DROP TABLE audit_log", []).unwrap();

        let sonuc = sil(&c, r.id, Cihaz::Masaustu);
        assert!(sonuc.is_err(), "audit_log yokken sil Err donmeli");
        assert!(matches!(sonuc.unwrap_err(), DepoHatasi::Sqlite(_)));

        assert_eq!(
            appointments_satir_sayisi(&c),
            1,
            "audit log basarisiz oldugunda silme geri alinmali, kayit kalmali"
        );
    }

    #[test]
    fn ust_uste_binen_randevu_bulunur() {
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();

        let cakisanlar =
            cakisanlari_bul(&c, "2026-09-07T14:30", "2026-09-07T15:30", None).unwrap();
        assert_eq!(cakisanlar.len(), 1);
    }

    #[test]
    fn bitisik_randevular_cakismaz() {
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();

        let cakisanlar =
            cakisanlari_bul(&c, "2026-09-07T15:00", "2026-09-07T16:00", None).unwrap();
        assert!(cakisanlar.is_empty(), "14-15 ile 15-16 cakismaz");
    }

    #[test]
    fn tamamen_kapsayan_randevu_cakisir() {
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();

        let cakisanlar =
            cakisanlari_bul(&c, "2026-09-07T13:00", "2026-09-07T17:00", None).unwrap();
        assert_eq!(cakisanlar.len(), 1);
    }

    #[test]
    fn bastan_kismi_cakisan_randevu_bulunur() {
        // Yeni randevu, mevcut olandan ONCE baslayip onun icinde bitiyor:
        // mevcut 14:00-15:00, yeni 13:30-14:30. Cakisma araliginin sol
        // kenarini test eder.
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();

        let cakisanlar =
            cakisanlari_bul(&c, "2026-09-07T13:30", "2026-09-07T14:30", None).unwrap();
        assert_eq!(cakisanlar.len(), 1, "13:30-14:30 ile 14:00-15:00 kismi cakismali");
    }

    #[test]
    fn yeni_randevu_mevcudun_icinde_tamamen_kaliyorsa_cakisir() {
        // Yeni randevu, mevcut olanin İCİNDE tamamen kaliyor: mevcut
        // 14:00-16:00, yeni 14:30-15:00. `tamamen_kapsayan_randevu_cakisir`
        // testinin TERSİ -- burada kapsayan degil kapsanan taraf yeni.
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T16:00"), Cihaz::Masaustu).unwrap();

        let cakisanlar =
            cakisanlari_bul(&c, "2026-09-07T14:30", "2026-09-07T15:00", None).unwrap();
        assert_eq!(cakisanlar.len(), 1, "14:30-15:00 mevcut 14:00-16:00'nin icinde kaldigi icin cakismali");
    }

    #[test]
    fn birebir_ayni_aralikli_randevu_cakisir() {
        // Mevcut ve yeni randevu tam olarak ayni araliga sahip (14:00-15:00),
        // haric_id yok. Aralik mantiginin en sinirdaki hali.
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();

        let cakisanlar =
            cakisanlari_bul(&c, "2026-09-07T14:00", "2026-09-07T15:00", None).unwrap();
        assert_eq!(cakisanlar.len(), 1, "birebir ayni aralik cakismali");
    }

    #[test]
    fn iptal_edilmis_randevu_cakisma_saymaz() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        durum_guncelle(&c, r.id, "iptal", Cihaz::Masaustu).unwrap();

        let cakisanlar =
            cakisanlari_bul(&c, "2026-09-07T14:00", "2026-09-07T15:00", None).unwrap();
        assert!(cakisanlar.is_empty());
    }

    #[test]
    fn randevu_kendisiyle_cakismaz() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();

        let cakisanlar =
            cakisanlari_bul(&c, "2026-09-07T14:00", "2026-09-07T15:00", Some(r.id)).unwrap();
        assert!(cakisanlar.is_empty(), "duzenlenen randevu kendini cakisma saymamalı");
    }

    #[test]
    fn baska_gunun_randevusu_cakismaz() {
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();

        let cakisanlar =
            cakisanlari_bul(&c, "2026-09-08T14:00", "2026-09-08T15:00", None).unwrap();
        assert!(cakisanlar.is_empty());
    }

    #[test]
    fn cakisma_bozuk_tarih_bicimini_reddeder() {
        let (_d, c, _cid) = kurulum();
        let hata = cakisanlari_bul(&c, "07.09.2026 14:00", "2026-09-07T15:00", None).unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));

        let hata = cakisanlari_bul(&c, "2026-09-07T14:00", "07.09.2026 15:00", None).unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn cakisma_kontrolu_log_yazmaz() {
        // Bu fonksiyon form dogrulamasi sirasinda her tus vurusunda
        // calisabilir; erisim logu yazsaydi log kullanilamaz hale gelirdi
        // (bkz. modul basligindaki gerekce). Cagridan once/sonra audit_log
        // satir sayisinin degismedigini dogrulayarak bunu kanitla.
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();

        let once: i64 = c
            .query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0))
            .unwrap();
        cakisanlari_bul(&c, "2026-09-07T14:30", "2026-09-07T15:30", None).unwrap();
        let sonra: i64 = c
            .query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0))
            .unwrap();

        assert_eq!(once, sonra, "cakisanlari_bul audit_log'a kayit yazmamali");
    }

    // --- Gorev 6: haftalik tekrarlayan randevu serisi ---

    #[test]
    fn bir_hafta_sonra_ayni_saati_korur() {
        assert_eq!(bir_hafta_sonra("2026-09-07T14:00").unwrap(), "2026-09-14T14:00");
    }

    #[test]
    fn bir_hafta_sonra_ay_sinirini_gecer() {
        assert_eq!(bir_hafta_sonra("2026-09-28T14:00").unwrap(), "2026-10-05T14:00");
    }

    #[test]
    fn bir_hafta_sonra_yil_sinirini_gecer() {
        assert_eq!(bir_hafta_sonra("2026-12-29T09:30").unwrap(), "2027-01-05T09:30");
    }

    #[test]
    fn bir_hafta_sonra_yaz_saati_gecisinde_saati_korur() {
        // Ekim sonu, Avrupa'da (ve eskiden Turkiye'de) yaz saati uygulamasinin
        // bittigi hafta: saat bileşeni dizgi olarak taşındığı için hiçbir
        // saat kaymasi olmamali.
        assert_eq!(bir_hafta_sonra("2026-10-25T14:00").unwrap(), "2026-11-01T14:00");
    }

    #[test]
    fn seri_haftalik_kayitlar_uretir() {
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            4,
            Cihaz::Masaustu,
        )
        .unwrap();

        assert_eq!(seri.len(), 4);
        assert_eq!(seri[0].baslangic, "2026-09-07T14:00");
        assert_eq!(seri[3].baslangic, "2026-09-28T14:00");
        assert_eq!(seri[3].bitis, "2026-09-28T15:00");
    }

    #[test]
    fn seri_uyeleri_ayni_seri_idyi_paylasir() {
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            3,
            Cihaz::Masaustu,
        )
        .unwrap();

        let id = seri[0].seri_id.clone().expect("seri_id atanmali");
        assert!(seri.iter().all(|r| r.seri_id.as_deref() == Some(id.as_str())));
    }

    #[test]
    fn azami_tekrar_asilamaz() {
        let (_d, c, cid) = kurulum();
        let hata = seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            AZAMI_TEKRAR + 1,
            Cihaz::Masaustu,
        )
        .unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn sifir_tekrar_reddedilir() {
        let (_d, c, cid) = kurulum();
        assert!(seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            0,
            Cihaz::Masaustu
        )
        .is_err());
    }

    #[test]
    fn seri_silme_yalnizca_verilen_tarihten_sonrasini_siler() {
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            4,
            Cihaz::Masaustu,
        )
        .unwrap();
        let sid = seri[0].seri_id.clone().unwrap();

        let silinen = seriyi_sil(&c, &sid, "2026-09-21T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(silinen, 2, "21 ve 28 Eylul silinmeli");

        let kalan =
            aralik_getir(&c, "2026-09-01T00:00", "2026-10-01T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(kalan.len(), 2, "gecmis randevular korunmalı");
    }

    fn appointments_satir_sayisi_gorev6(c: &rusqlite::Connection) -> i64 {
        c.query_row("SELECT COUNT(*) FROM appointments", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn seri_olustur_audit_basarisiz_olursa_hicbir_kayit_kalmaz() {
        let (_d, c, cid) = kurulum();
        c.execute("DROP TABLE audit_log", []).unwrap();

        let sonuc = seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            4,
            Cihaz::Masaustu,
        );
        assert!(sonuc.is_err(), "audit_log yokken seri_olustur Err donmeli");
        assert!(matches!(sonuc.unwrap_err(), DepoHatasi::Sqlite(_)));

        assert_eq!(
            appointments_satir_sayisi_gorev6(&c),
            0,
            "audit log basarisiz oldugunda serinin hicbir kaydi kalici yazilmamali"
        );
    }

    #[test]
    fn seriyi_sil_audit_basarisiz_olursa_silme_geri_alinir() {
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            3,
            Cihaz::Masaustu,
        )
        .unwrap();
        let sid = seri[0].seri_id.clone().unwrap();

        c.execute("DROP TABLE audit_log", []).unwrap();

        let sonuc = seriyi_sil(&c, &sid, "2026-09-07T00:00", Cihaz::Masaustu);
        assert!(sonuc.is_err(), "audit_log yokken seriyi_sil Err donmeli");
        assert!(matches!(sonuc.unwrap_err(), DepoHatasi::Sqlite(_)));

        assert_eq!(
            appointments_satir_sayisi_gorev6(&c),
            3,
            "audit log basarisiz oldugunda seri silme geri alinmali, kayitlar kalmali"
        );
    }
}
