//! Randevu (appointment) deposu.
//!
//! Tasarım kararı gereği randevu ve seans aynı kayıttır (ileride not bu
//! kayıtlara bağlanacak); bu modül `appointments` tablosu üzerinde
//! oluşturma, aralık sorgusu, alan/durum güncelleme ve silme işlemlerini
//! sağlar.
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
//! `olustur`, `guncelle` (gövdesi `guncelle_ve_son_temas`), `durum_guncelle`,
//! `odeme_guncelle`, `sil`, `seri_olustur` ve `seriyi_sil` veriyi değiştirir; hepsi tabloya yazdıktan hemen sonra
//! `audit::kaydet` çağırır. Bu adımlar
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
//! Yukarıdaki mutasyon fonksiyonlarının hepsi kendi
//! `unchecked_transaction()`'ını içeride açar. SQLite iç içe transaction'ı
//! desteklemez ("cannot start a transaction within a transaction"): bu
//! fonksiyonları **başka bir transaction'ın içinden** çağırmayın. Bu sessiz
//! bir veri bozulması değil, `rusqlite::Error` olarak dönen gürültülü bir
//! hatadır -- ama derleyici yakalamaz.

use crate::store::audit::{
    kaydet, Ayrinti, Cihaz, Eylem, LogHacmi, BIRLESTIRME_PENCERESI_DK,
};
use crate::store::clients::{son_temasi_tazele, DepoHatasi, VARSAYILAN_SAKLAMA_YILI};
use crate::store::zaman::zaman_gecerli_mi;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, Date, Month, OffsetDateTime};

pub const GECERLI_DURUMLAR: [&str; 4] = ["planlandi", "geldi", "gelmedi", "iptal"];

/// Ücretin (kuruş) uygulama katmanındaki alt sınırı.
///
/// `GECERLI_DURUMLAR` ile aynı sınıftan bir sabit: kural **iki yerde**
/// yazılıdır — burada ve `schema::V4`'teki
/// `CHECK (ucret IS NULL OR ucret >= 0)` kısıtında. İkisinin ayrışması
/// sessiz bir hatadır (uygulama reddeder, veritabanı kabul eder ya da
/// tersi), bu yüzden
/// `schema::tests::ucret_alt_siniri_semada_ve_uygulama_katmaninda_ayni`
/// ayrışmayı **iki yönlü** yakalar: sınırdaki değer veritabanınca kabul
/// edilmeli, bir altı hem uygulama katmanınca hem `CHECK` tarafından
/// reddedilmelidir.
///
/// Sabit `V4` betiğine gömülmüyor (`format!` ile üretilmiyor): bir göç
/// adımı **tarihsel** metindir; sabitten türetilseydi bugün yükselen bir
/// veritabanı ile dün yükselmiş bir veritabanı farklı şemalar alırdı.
pub const ASGARI_UCRET: i64 = 0;

/// Ücretin (kuruş) uygulama katmanındaki üst sınırı: seans başına
/// 1 000 000 TL.
///
/// # Bulgu (Plan 4 Görev 3 incelemesi)
///
/// Üst sınır yoktu. İki `i64::MAX / 2 + 1` ücretli seans, ay özetindeki
/// `SUM(ucret)`'i taşırıyordu: SQLite `integer overflow` → özet ekranı HTTP
/// 500. Sınır makul bir seans ücretinin çok üstündedir ama toplamları güvenli
/// tutar: `i64` taşması için bir ayda ~9,2 × 10¹⁰ azami ücretli seans
/// gerekir. Ayrıca JSON'u okuyan JavaScript'in tam sayı hassasiyeti 2⁵³
/// (~9 × 10¹⁵ kuruş); tek bir ücret onun çok altındadır, bir aylık toplamın
/// bu sınırı aşması için de ~9 × 10⁷ azami ücretli seans gerekir.
///
/// **Yalnızca uygulama katmanında.** `ASGARI_UCRET`'in aksine bu sınır
/// `schema::V4`'teki `CHECK`'te YOKTUR ve oraya eklenmedi: var olan bir
/// tabloya `CHECK` eklemek yeni bir göç (tablo yeniden kurma) ister ve tek
/// yazma yolu (`olustur`, `guncelle`, `seri_olustur`) zaten
/// `ucret_gecerli_mi`'den geçer. Ham SQL'le yazılan bir değer bu sınırı
/// aşabilir; bu bilinçli bir sınırdır.
pub const AZAMI_UCRET: i64 = 100_000_000;

/// Bir ücret değerinin uygulama katmanınca kabul edilip edilmediği:
/// `ASGARI_UCRET..=AZAMI_UCRET`.
///
/// `None` (ücretsiz/girilmemiş seans) geçerlidir — şemadaki `ucret IS NULL`
/// kolunun karşılığı.
pub fn ucret_gecerli_mi(ucret: Option<i64>) -> bool {
    ucret.is_none_or(|u| (ASGARI_UCRET..=AZAMI_UCRET).contains(&u))
}

/// `ucret_gecerli_mi` reddettiğinde dönen hata; üç yazma yolu aynı metni verir.
fn ucret_hatasi() -> DepoHatasi {
    DepoHatasi::GecersizVeri(format!(
        "Ücret {} ile {} TL arasında olmalı.",
        ASGARI_UCRET / 100,
        AZAMI_UCRET / 100
    ))
}

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

/// `durum_guncelle` çağrısının "geldi" işaretlemesi danışanın `son_temas`/
/// `saklama_bitis` alanlarını GERÇEKTEN ileri taşıdığında döndürdüğü sonuç
/// (bkz. `son_temasi_isaretle`).
///
/// # Neden var (Plan 7 Görev 3)
/// Sunucu bu iki alanı tazeliyordu ama istemciye hiç yayılmıyordu: Bilgiler
/// sekmesindeki saklama kutusu ve Ayarlar'daki "saklama süresi dolan
/// dosyalar" listesi bayat kalıyordu (bkz. `server::routes::appointments::
/// durum` ve `web/src/screens/anaEkranKancalari/useDanisanDosyasi.ts`/
/// `useDanisanListesi.ts`). Yeniden çekmek ikisi de `LogHacmi::HerCagri`
/// olduğu için (silinemez satır) yasak; çözüm durum yazmasının yanıtına bu
/// iki alanı eklemek -- transaction zaten hesaplıyor, ek sorgu yok.
///
/// # Neden `Option` değil `durum_guncelle`nin dönüş tipinde
/// `son_temasi_isaretle` yalnızca GERÇEKTEN ileri taşındığında (`ileri_mi`)
/// bir değer üretir -- "gelmedi"/"iptal" işaretlemesi ya da geriye dönük bir
/// "geldi" (son temas zaten daha ileriyse) hiçbir şeyi değiştirmez, o zaman
/// `None`. İstemci yalnızca GERÇEKTEN değişen alanları alır (brief kısıtı).
///
/// `Debug` elle yazılır (`derive` YOK): `client_id`/`son_temas`/
/// `saklama_bitis` `clients::Danisan` ile aynı sınıftan KVKK verisidir (bkz.
/// o tipin elle yazılmış `Debug`'ı) -- `Result::unwrap_err` gibi standart
/// kütüphane çağrıları `Debug` istediği için (bkz. bu modüldeki
/// `..._unwrap_err()` testleri) türetmemek seçenek değil, üçü de gizlenir.
#[derive(Clone, Serialize)]
pub struct SonTemasSonucu {
    pub client_id: i64,
    pub son_temas: String,
    pub saklama_bitis: String,
}

impl std::fmt::Debug for SonTemasSonucu {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SonTemasSonucu")
            .field("client_id", &"<gizli>")
            .field("son_temas", &"<gizli>")
            .field("saklama_bitis", &"<gizli>")
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

/// Mevcut bir randevunun DEĞİŞTİRİLEBİLİR alanları (bkz. `guncelle`).
///
/// Kasıtlı olarak `YeniRandevu` ile aynı alanları taşır ama ayrı bir tiptir:
/// ikisi aynı yapı olsaydı, ileride `YeniRandevu`'ya eklenen bir alan
/// (örn. `seri_id`) sessizce güncellenebilir hale gelirdi.
///
/// `durum` BURADA YOK: kendi uç noktası (`durum_guncelle`) var ve o,
/// `Ayrinti::Durum` ile ayrı bir log satırı yazıyor -- durumu buradan da
/// güncellenebilir kılmak aynı değişiklik için iki farklı log izi üretirdi.
/// `seri_id` ve `id` de yok: seri üyeliği ve kimlik oluşturmada belirlenir,
/// düzenlemeyle değişmez.
#[derive(Clone, Deserialize)]
pub struct RandevuGuncelleme {
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
    if !ucret_gecerli_mi(yeni.ucret) {
        return Err(ucret_hatasi());
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
    kaydet(&tx, Eylem::Ekleme, "appointment", &id.to_string(), cihaz, None, LogHacmi::HerCagri)?;

    let randevu = tx.query_row(&format!("{SECIM} WHERE a.id = ?1"), [id], satirdan)?;

    tx.commit()?;
    Ok(randevu)
}

/// `baslangic` (dahil) ile `bitis` (hariç) arasındaki randevuları zamana
/// göre sıralı listeler. Salt okunur olduğundan transaction gerektirmez.
///
/// # Log: birleştirilir (Plan 3 Görev 2)
/// Kaç satır dönerse dönsün satır başına log yazılmaz; dahası, `goruntuleme`
/// kaydı `BIRLESTIRME_PENCERESI_DK` boyunca **birleştirilir**. Gerekçe:
/// bu fonksiyon takvim ekranının yenileme yoludur ve arayüzde mount'ta, her
/// hafta değişiminde ve **her mutasyondan sonra** çalışır -- "Geldi"
/// işaretlemek tek bir kullanıcı eylemi olduğu hâlde bir `duzenleme` + bir
/// `goruntuleme` satırı üretiyordu. `audit_log` satırları silinemediği için
/// bu kirlilik kalıcıdır ve logu okunamaz hâle getirir (bkz.
/// `store::audit` modül başlığındaki hacim politikası).
///
/// Birleştirme anahtarı `(goruntuleme, "appointment", "liste")`'dir: aynı
/// pencerede farklı bir haftaya gitmek de tek satır sayılır. Bu bilinçlidir
/// -- takvimde gezinmek kuralın "loglanmaz" tarafındadır; ayakta kalan satır
/// o gezinme oturumunun İLK erişimini (ve `Ayrinti` ile onun hafta
/// başlangıcını) taşır. Randevu verisini DEĞİŞTİREN her işlem elbette kendi
/// satırını yazmaya devam eder.
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

    // Liste tek bir goruntuleme kaydi uretir, satir basina degil -- ve o tek
    // kayit da pencere boyunca birlestirilir (bkz. fonksiyon dokumantasyonu).
    // Var olan satira DOKUNULMAZ; yalnizca "yazma" karari verilir.
    kaydet(
        conn,
        Eylem::Goruntuleme,
        "appointment",
        "liste",
        cihaz,
        Some(Ayrinti::AralikBaslangici(baslangic.to_string())),
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;
    Ok(liste)
}

/// Bir randevunun durumunu günceller. Güncelleme ve erişim logu tek
/// transaction'da yazılır.
///
/// # Dönüş değeri: `Some` yalnızca son temas GERÇEKTEN ileri taşındıysa
/// Plan 7 Görev 3: "geldi" işaretlemesi danışanın `son_temas`/
/// `saklama_bitis`ini ileri taşıdıysa (`son_temasi_isaretle`) bu iki alan
/// burada döner -- çağıran (rota katmanı) onu yanıta ekler, istemci de
/// kartı ve saklama listesini YENİDEN ÇEKMEDEN yerelde yamar (bkz.
/// `SonTemasSonucu`). Diğer tüm durumlarda (`gelmedi`/`iptal`/`planlandi`,
/// ya da geriye dönük bir "geldi") `None` -- test:
/// `gelmedi_iptal_son_temasi_degistirmez`.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (SQLite iç içe transaction
/// desteklemez, bkz. modül başlığındaki uyarı).
pub fn durum_guncelle(
    conn: &Connection,
    id: i64,
    durum: &str,
    cihaz: Cihaz,
) -> Result<Option<SonTemasSonucu>, DepoHatasi> {
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
        LogHacmi::HerCagri,
    )?;

    let sonuc = if sabit_durum == "geldi" { son_temasi_isaretle(&tx, id)? } else { None };

    tx.commit()?;
    Ok(sonuc)
}

/// Bir randevunun "ödendi" işaretini koyar (`true`) ya da geri alır
/// (`false`). Güncelleme ve erişim logu tek transaction'da yazılır.
///
/// # Neden var (Plan 4 Görev 1)
/// `appointments.odendi` sütunu Plan 2'den beri vardı ama hiçbir yazma yolu
/// yoktu (yalnızca `INSERT`'te `0`): danışan bakiyesi hiçbir zaman
/// azalmıyordu. Tasarım §6: ödeme takibi ayrı bir modül değil, randevu
/// panelindeki bir işarettir.
///
/// # Sözleşme
/// - `durum` ne olursa olsun işaretlenebilir (ön ödeme, iptal edilmiş ama
///   ücreti alınmış seans olağandır) — testle sabit:
///   `odeme_iptal_edilmis_randevuda_da_isaretlenebilir`.
/// - Değer zaten aynıysa da yazılır ve **loglanır**: bir kullanıcı eylemi =
///   bir satır (`LogHacmi::HerCagri`). "Değişmedi" dalı gereksiz karmaşa.
/// - 0 satır etkilenirse `Bulunamadi` döner ve **log yazılmaz** (hacim
///   politikası: hiçbir satırı etkilemeyen mutasyon loglanmaz).
/// - Loga yalnızca `Ayrinti::OdemeAlindi` / `OdemeGeriAlindi` (birim
///   varyantlar) girer; ücret, tutar, danışan adı girmez.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (SQLite iç içe transaction
/// desteklemez, bkz. modül başlığındaki uyarı).
pub fn odeme_guncelle(
    conn: &Connection,
    id: i64,
    odendi: bool,
    cihaz: Cihaz,
) -> Result<(), DepoHatasi> {
    let tx = conn.unchecked_transaction()?;

    let etkilenen = tx.execute(
        "UPDATE appointments SET odendi = ?1, guncelleme_zamani = ?2 WHERE id = ?3",
        rusqlite::params![odendi, simdi(), id],
    )?;
    if etkilenen == 0 {
        return Err(DepoHatasi::Bulunamadi);
    }
    let ayrinti = if odendi { Ayrinti::OdemeAlindi } else { Ayrinti::OdemeGeriAlindi };
    kaydet(
        &tx,
        Eylem::Duzenleme,
        "appointment",
        &id.to_string(),
        cihaz,
        Some(ayrinti),
        LogHacmi::HerCagri,
    )?;

    tx.commit()?;
    Ok(())
}

/// Randevu "geldi" olarak işaretlendiğinde danışanın son temas tarihini ve
/// saklama süresi bitişini tazeler.
///
/// # Neden burada
/// `clients::son_temasi_tazele` Plan 3 Görev 4'te yazıldı; **çağrı yeri
/// olmadan bırakılsaydı** `clients::arsivle` ile tam olarak aynı duruma
/// düşerdi (yazılmış, test edilmiş, hiç çağrılmayan fonksiyon -- Plan 2'nin
/// devrettiği maddelerden biri buydu). Danışanın "son teması", GERÇEKLEŞMİŞ
/// son seansıdır: planlanmış ama gelinmemiş bir randevu temas değildir, bu
/// yüzden yalnızca `geldi` bu yolu tetikler.
///
/// # Neden geriye gitmez
/// Kullanıcı eski bir randevuyu sonradan "geldi" işaretleyebilir. Son temas
/// bu yüzden yalnızca İLERİ taşınır; aksi hâlde geçmişe dönük bir düzeltme
/// saklama süresini kısaltır ve dosya erkenden imha listesine düşerdi.
/// Tekdüzelik kararı burada, çağıranda verilir: `son_temasi_tazele` kendisi
/// koşulsuzdur (bir yanlış girilmiş tarihi geri almak isteyen bir çağıran da
/// olabilir).
///
/// Ayrı bir log satırı YAZMAZ: bunu tetikleyen kullanıcı eylemi (durum
/// değişikliği) hemen yukarıda zaten loglandı; ikinci satır aynı tek eylem
/// için ikinci bir silinemez kayıt olurdu (bkz. hacim politikası).
///
/// # Dönüş değeri (Plan 7 Görev 3)
/// Yalnızca `ileri_mi` doğruysa (yani `son_temas`/`saklama_bitis` GERÇEKTEN
/// değiştiyse) `Some(SonTemasSonucu)` döner -- `son_temasi_tazele` zaten
/// `saklama_bitis`i hesaplayıp döndürüyor, burada ikinci bir sorguya gerek
/// yok. Geriye gitmeyen (`ileri_mi == false`) ya da hiç temas kaydı
/// olmayacak bir çağrı olamaz -- ama "değişmedi" hâli her ihtimalde `None`.
fn son_temasi_isaretle(
    tx: &Connection,
    randevu_id: i64,
) -> Result<Option<SonTemasSonucu>, DepoHatasi> {
    let (client_id, baslangic) = tx.query_row(
        "SELECT client_id, baslangic FROM appointments WHERE id = ?1",
        [randevu_id],
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
    )?;

    // `baslangic` 16 karakterlik duvar saati damgasıdır (`olustur`/`guncelle`
    // bunu doğrular); son temas ise yalnızca GÜN tutar.
    let Some(gun) = baslangic.get(0..10) else {
        return Err(DepoHatasi::GecersizVeri("Randevu başlangıcı çözümlenemedi.".into()));
    };

    let mevcut: Option<String> =
        tx.query_row("SELECT son_temas FROM clients WHERE id = ?1", [client_id], |r| r.get(0))?;

    let ileri_mi = match &mevcut {
        None => true,
        Some(m) => m.as_str() < gun,
    };
    if !ileri_mi {
        return Ok(None);
    }
    let saklama_bitis = son_temasi_tazele(tx, client_id, gun, VARSAYILAN_SAKLAMA_YILI)?;
    Ok(Some(SonTemasSonucu { client_id, son_temas: gun.to_string(), saklama_bitis }))
}

/// `guncelle`'nin tam sonucu: guncellenen kayit ve -- kayit "geldi" ise ve
/// tasima son temasi GERCEKTEN ilerlettiyse -- yeni son temas (tasarim A4).
///
/// `Debug` türetilebilir (`SeriCakismasi` ile aynı gerekçe): iki alan da
/// KVKK alanlarını gizleyen elle yazılmış `Debug`'larını kullanır, bu tip
/// yeni bir alan eklemez.
#[derive(Debug)]
pub struct GuncellemeSonucu {
    pub randevu: Randevu,
    pub son_temas: Option<SonTemasSonucu>,
}

/// Mevcut bir randevunun alanlarını (danışan, başlangıç, bitiş, ücret)
/// günceller ve güncellenmiş kaydı döndürür. Güncelleme ve erişim logu tek
/// transaction'da yazılır.
///
/// Gövde `guncelle_ve_son_temas`'tadır; bu fonksiyon yalnızca kaydı döndüren
/// ince bir sarmalayıcıdır (imzası Plan A Görev 9'dan önceki hâliyle aynı,
/// testlerdeki çağrı yerleri dokunulmadan kaldı). Son temas sonucunu isteyen
/// tek çağıran rota katmanıdır (`PUT /randevular/{id}`).
///
/// # Neden ayrı bir fonksiyon -- `olustur` düzenleme için kullanılamaz
/// Düzenleme akışı `olustur` ile taklit edilemez: `olustur` her çağrıda YENİ
/// bir satır ekler. Bu fonksiyon yokken arayüzün "Kaydet" düğmesi mevcut bir
/// randevuda basıldığında kaydın KOPYASINI üretiyordu (bkz. dal incelemesi
/// C1) -- ücreti değiştirilen randevu değişmemiş hâlde kalıyor, yanına
/// ikincisi ekleniyordu. `cakisanlari_bul`'un `haric_id` parametresi zaten
/// bu akış için (bkz. o fonksiyonun dokümantasyonu) yazılmıştı.
///
/// # Seri davranışı -- YALNIZCA bu tekil randevu değişir
/// Randevu bir serinin üyesiyse (`seri_id` dolu) bile bu fonksiyon SADECE
/// verilen `id`'li satırı günceller; serinin diğer üyelerine dokunmaz ve
/// `seri_id`'yi değiştirmez. Bu bilinçli: "bu haftaki seansı bir saat
/// kaydıralım" tamamen olağan bir istektir ve seri, kural olarak değil tek
/// tek satırlar olarak materialize edildiği için (bkz. `seri_olustur`)
/// tekil düzenleme zaten modelin desteklediği akıştır. Testle korunur:
/// `guncelleme_seri_uyesini_tekil_gunceller_digerlerine_dokunmaz`.
///
/// Seri işlemleri (`seri_sayisi`, `seriyi_sil`, `seri_silinecek_not_sayisi`)
/// ZAMANA göredir (tasarım A4): kesme `baslangic >= bu_tarihten_itibaren`
/// ile yapılır, serideki SIRA ile değil. Taşınmış bir üye YENİ tarihine göre
/// dahil/hariç kalır -- kesmeden sonraya taşınan üye "bu ve sonrakiler"
/// silinirken gider, kesmeden önceye taşınan üye kalır. Testle korunur:
/// `seri_silme_zamana_gore_ileri_tasinmis_uye_kesmeden_sonraysa_silinir`,
/// `seri_silme_zamana_gore_geri_tasinmis_uye_kesmeden_onceyse_korunur`,
/// `seri_silinecek_not_sayisi_tasinmis_uyeyi_yeni_tarihine_gore_sayar`.
///
/// # Loga ne yazılır
/// `Eylem::Duzenleme` + `varlik_id` = randevu kimliği, `ayrinti` YOK
/// (`None`). Eski/yeni değerler (danışan kimliği, saat, ücret) loga
/// YAZILMAZ: `audit_log` hassas veri taşımaz (bkz. `store::audit`) ve
/// `Ayrinti` kapalı bir enum olduğu için zaten serbest metin kabul etmez.
/// Neyin değiştiğini bilmek gerekiyorsa kaydın kendisi `id` ile okunabilir.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (SQLite iç içe transaction
/// desteklemez, bkz. modül başlığındaki uyarı).
pub fn guncelle(
    conn: &Connection,
    id: i64,
    yeni: &RandevuGuncelleme,
    cihaz: Cihaz,
) -> Result<Randevu, DepoHatasi> {
    guncelle_ve_son_temas(conn, id, yeni, cihaz).map(|s| s.randevu)
}

/// `guncelle`'nin gövdesi; kayda EK OLARAK son temas sonucunu da döndürür
/// (bkz. `GuncellemeSonucu`).
///
/// # Taşınan "geldi" seansı son temasını ilerletir (tasarım A4)
/// Kullanıcı kararı (2026-09-25): işaretlenmiş seanslar da taşınabilir.
/// "Geldi" işaretli bir seans taşınınca danışanın `son_temas`/
/// `saklama_bitis`i `durum_guncelle` ile AYNI işlevden
/// (`son_temasi_isaretle`) geçer -- dolayısıyla aynı iki kural geçerlidir:
/// yalnızca İLERİ gider (seansı geçmişe taşımak saklama süresini
/// kısaltmaz, bkz. o fonksiyonun "Neden geriye gitmez" bölümü) ve ayrı bir
/// log satırı YAZMAZ (taşıma tek kullanıcı eylemidir, tek `Duzenleme`
/// satırı). `son_temas` yalnızca GERÇEKTEN ilerlediyse `Some` olur; planlı/
/// gelmedi/iptal seansı taşımak ya da "geldi"yi geriye taşımak `None`.
/// Testler: `geldi_seansi_ileri_tasininca_son_temas_ilerler`,
/// `geldi_seansi_geri_tasininca_son_temas_gerilemez`,
/// `planli_seansi_tasimak_son_temasa_dokunmaz`, `tasima_tek_log_satiri_yazar`.
/// Taşıma danışanı da değiştirirse son temas TAŞINAN kaydın (UPDATE sonrası)
/// danışanına yazılır, eski danışanınki değişmez:
/// `geldi_seansi_baska_danisana_tasininca_yeni_danisan_ilerler_eskisi_degismez`.
///
/// Son temas güncellemesi taşımayla AYNI transaction'dadır (log satırından
/// sonra, `commit`'ten önce): son temas yazılamazsa taşıma ve log satırı da
/// geri alınır. Test: `tasima_son_temas_yazilamazsa_tasima_ve_log_da_geri_alinir`.
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (SQLite iç içe transaction
/// desteklemez, bkz. modül başlığındaki uyarı).
pub fn guncelle_ve_son_temas(
    conn: &Connection,
    id: i64,
    yeni: &RandevuGuncelleme,
    cihaz: Cihaz,
) -> Result<GuncellemeSonucu, DepoHatasi> {
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
    if !ucret_gecerli_mi(yeni.ucret) {
        return Err(ucret_hatasi());
    }

    let tx = conn.unchecked_transaction()?;

    // Danisan var mi? Yabanci anahtar kisiti (PRAGMA foreign_keys=ON) bunu
    // zaten yakalar ama ham bir SQLite hatasi olarak -- ki `depo_hatasi`
    // onu 500'e esler. Acik kontrol, kullaniciya anlasilir bir 400 dondurur.
    let danisan_var: bool =
        tx.query_row("SELECT 1 FROM clients WHERE id = ?1", [yeni.client_id], |_| Ok(true))
            .optional()?
            .unwrap_or(false);
    if !danisan_var {
        return Err(DepoHatasi::GecersizVeri("Danışan bulunamadı.".into()));
    }

    let etkilenen = tx.execute(
        "UPDATE appointments
            SET client_id = ?1, baslangic = ?2, bitis = ?3, ucret = ?4, guncelleme_zamani = ?5
          WHERE id = ?6",
        rusqlite::params![
            yeni.client_id,
            yeni.baslangic,
            yeni.bitis,
            yeni.ucret,
            simdi(),
            id
        ],
    )?;
    if etkilenen == 0 {
        return Err(DepoHatasi::Bulunamadi);
    }
    kaydet(&tx, Eylem::Duzenleme, "appointment", &id.to_string(), cihaz, None, LogHacmi::HerCagri)?;

    let durum: String =
        tx.query_row("SELECT durum FROM appointments WHERE id = ?1", [id], |r| r.get(0))?;
    // Tasarim A4 (kullanici karari 2026-09-25): isaretlenmis seanslar da
    // tasinabilir. "geldi" seansi tasininca son temas `durum_guncelle` ile
    // AYNI islevden gecer: yalnizca ileri gider, ayri log satiri yazmaz.
    let son_temas = if durum == "geldi" { son_temasi_isaretle(&tx, id)? } else { None };

    let randevu = tx.query_row(&format!("{SECIM} WHERE a.id = ?1"), [id], satirdan)?;

    tx.commit()?;
    Ok(GuncellemeSonucu { randevu, son_temas })
}

/// Bir randevu silinirse **kaç not** yok olacağını söyler; hiçbir şey
/// değiştirmez (dal incelemesi I2).
///
/// # Neden var: silme SESSİZCE klinik kayıt yok ediyordu
/// `progress_notes.appointment_id` ve `private_notes.appointment_id`
/// `ON DELETE CASCADE` taşır (bkz. `schema::V3`). "Bu randevu kalıcı olarak
/// silinsin mi?" diyen onay metni notlardan hiç söz etmiyordu; terapist bir
/// takvim satırını sildiğini sanarken seans notunu ve özel notunu da
/// siliyordu. Onay metninin ne gideceğini söyleyebilmesi için sayının
/// **silmeden önce** bilinmesi gerekiyor.
///
/// Sayı, resmî not + özel notun TOPLAMIDIR. Özel notun VARLIĞI (içeriği
/// değil) burada görünür: sayıyı gören tek kişi zaten o notu yazan
/// terapisttir ve alternatif, ona kaç kaydını yok edeceğini söylememektir.
///
/// `cakisanlari_bul` / `seri_sayisi` ile aynı sınıf: kullanıcıya veri
/// göstermeyen, onay kutusunu hazırlayan bir kontrol → **log YAZMAZ**.
/// Var olmayan randevu için `0` döner, hata değil: onay akışı zaten
/// silmede `404` alacaktır.
pub fn silinecek_not_sayisi(conn: &Connection, id: i64) -> Result<usize, DepoHatasi> {
    let adet: i64 = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM progress_notes WHERE appointment_id = ?1)
              + (SELECT COUNT(*) FROM private_notes  WHERE appointment_id = ?1)",
        [id],
        |r| r.get(0),
    )?;
    Ok(adet as usize)
}

/// `seriyi_sil` çağrılsa kaç NOTUN yok olacağını söyler; hiçbir şey
/// değiştirmez. `seri_sayisi`'nin not karşılığı — aynı gerekçe (dal
/// incelemesi I2) ve aynı kesme (`baslangic >= bu_tarihten_itibaren`,
/// geçmiş üyeler sayılmaz çünkü silinmiyorlar).
///
/// **Log YAZMAZ** (`seri_sayisi` ile aynı sınıf).
pub fn seri_silinecek_not_sayisi(
    conn: &Connection,
    seri_id: &str,
    bu_tarihten_itibaren: &str,
) -> Result<usize, DepoHatasi> {
    if !zaman_gecerli_mi(bu_tarihten_itibaren) {
        return Err(DepoHatasi::GecersizVeri(
            "Tarih biçimi YYYY-AA-GGTSS:DD olmalı.".into(),
        ));
    }
    let adet: i64 = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM progress_notes p
                  JOIN appointments a ON a.id = p.appointment_id
                 WHERE a.seri_id = ?1 AND a.baslangic >= ?2)
              + (SELECT COUNT(*) FROM private_notes n
                  JOIN appointments a ON a.id = n.appointment_id
                 WHERE a.seri_id = ?1 AND a.baslangic >= ?2)",
        rusqlite::params![seri_id, bu_tarihten_itibaren],
        |r| r.get(0),
    )?;
    Ok(adet as usize)
}

/// Bir randevuyu siler. Silme ve erişim logu tek transaction'da yazılır.
///
/// # Seans notu ve özel not da GİDER (cascade)
/// `progress_notes` ve `private_notes` satırları `ON DELETE CASCADE` ile
/// birlikte silinir (`schema::V3`). Bu davranış değiştirilmiyor -- randevu
/// olmadan yetim bir seans notu tutulamaz -- ama artık **sessiz değil**:
/// silinen not sayısı, silmeden ÖNCE sayılıp aynı log satırının `ayrinti`
/// alanına yazılır (`Ayrinti::RandevuSilme`). Not başına ayrı satır
/// yazılmaz; gerekçe `store::audit` modül başlığındaki "Cascade silinen
/// notlar" bölümünde. Arayüz tarafındaki karşılığı, sayıyı söyleyen onay
/// metnidir (`RandevuPaneli`).
///
/// UYARI: Kendi `unchecked_transaction()`'ını içeride açar -- bunu zaten
/// açık bir transaction'ın içinden çağırmayın (SQLite iç içe transaction
/// desteklemez, bkz. modül başlığındaki uyarı).
pub fn sil(conn: &Connection, id: i64, cihaz: Cihaz) -> Result<(), DepoHatasi> {
    let tx = conn.unchecked_transaction()?;

    // ONCE say, SONRA sil: cascade calistiktan sonra sayilacak bir sey
    // kalmaz. Ayni transaction icinde oldugu icin araya baska bir yazma
    // giremez.
    let not_adedi = silinecek_not_sayisi(&tx, id)?;

    let etkilenen = tx.execute("DELETE FROM appointments WHERE id = ?1", [id])?;
    if etkilenen == 0 {
        return Err(DepoHatasi::Bulunamadi);
    }
    kaydet(
        &tx,
        Eylem::Silme,
        "appointment",
        &id.to_string(),
        cihaz,
        Some(Ayrinti::RandevuSilme { not_adedi }),
        LogHacmi::HerCagri,
    )?;

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

/// `seri_cakisanlari_bul`'un sonucu.
///
/// `Debug` türetilebilir: içindeki `Randevu` kendi elle yazılmış (hassas
/// alanları gizleyen) `Debug`'ını kullanır, bu tip yeni bir alan eklemez.
#[derive(Debug, Clone, Serialize)]
pub struct SeriCakismasi {
    /// Tüm haftaların çakışanlarının birleşimi, tekrarsız, zamana göre
    /// sıralı. Arayüz bunlardan danışan adlarını gösterir.
    pub cakisanlar: Vec<Randevu>,
    /// Kaç HAFTADA en az bir çakışma olduğu. Uyarı metni bunu söyler:
    /// "12 haftalık seri kuruyorsunuz, 8 haftada çakışma var".
    pub cakisan_hafta_sayisi: usize,
    /// Kaç haftanın kontrol edildiği (istemcinin gönderdiği tekrar sayısı).
    pub kontrol_edilen_hafta: u32,
}

/// Haftalık bir serinin TÜM üyeleri için çakışma arar (tek çağrıda).
///
/// # Neden bu, istemcide hafta hafta sormak yerine
/// Panel yalnızca İLK haftanın çakışmasını soruyordu; `tekrar_sayisi` ise
/// 52'ye kadar kayıt üretiyordu. "Salı 14:00, 12 hafta" serisi, o saatte
/// zaten 8 haftalık başka bir seri varken TEMİZ görünüyor, sessizce 8 çifte
/// randevu oluşuyordu (bkz. dal incelemesi I2).
///
/// Kontrolün sunucuda yapılmasının iki nedeni var. (1) 52 ayrı HTTP isteği
/// atmamak. (2) Hafta ilerletme `bir_hafta_sonra` ile yapılmalı: duvar saati
/// sözleşmesi gereği yalnızca TARİH kısmı ilerletilir, saat dizgisi hiç
/// ayrıştırılmaz. İstemcide `Date` nesnesiyle 7 gün eklemek yaz saati
/// değişiminde saati kaydırma riskini geri getirirdi (bkz.
/// `bir_hafta_sonra` dokümantasyonu).
///
/// `cakisanlari_bul` gibi **log YAZMAZ** ve **engellemez, yalnızca
/// döndürür** (Görev 5 kararı, testle korunuyor).
pub fn seri_cakisanlari_bul(
    conn: &Connection,
    baslangic: &str,
    bitis: &str,
    tekrar_sayisi: u32,
    haric_id: Option<i64>,
) -> Result<SeriCakismasi, DepoHatasi> {
    if tekrar_sayisi == 0 || tekrar_sayisi > AZAMI_TEKRAR {
        return Err(DepoHatasi::GecersizVeri(format!(
            "Tekrar sayısı 1 ile {AZAMI_TEKRAR} arasında olmalı."
        )));
    }
    if !zaman_gecerli_mi(baslangic) || !zaman_gecerli_mi(bitis) {
        return Err(DepoHatasi::GecersizVeri(
            "Tarih biçimi YYYY-AA-GGTSS:DD olmalı.".into(),
        ));
    }

    let mut hafta_baslangic = baslangic.to_string();
    let mut hafta_bitis = bitis.to_string();
    let mut cakisanlar: Vec<Randevu> = Vec::new();
    let mut cakisan_hafta_sayisi = 0usize;

    for _ in 0..tekrar_sayisi {
        let hafta = cakisanlari_bul(conn, &hafta_baslangic, &hafta_bitis, haric_id)?;
        if !hafta.is_empty() {
            cakisan_hafta_sayisi += 1;
        }
        for r in hafta {
            // Ayni randevu birden fazla haftayla cakisabilir (cok uzun bir
            // randevu, ya da bitisik hafta sinirlari): listede bir kez yer
            // alsin, arayuz ayni ismi iki kez yazmasin.
            if !cakisanlar.iter().any(|v| v.id == r.id) {
                cakisanlar.push(r);
            }
        }
        hafta_baslangic = bir_hafta_sonra(&hafta_baslangic)?;
        hafta_bitis = bir_hafta_sonra(&hafta_bitis)?;
    }

    cakisanlar.sort_by(|a, b| a.baslangic.cmp(&b.baslangic));
    Ok(SeriCakismasi { cakisanlar, cakisan_hafta_sayisi, kontrol_edilen_hafta: tekrar_sayisi })
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
    if !ucret_gecerli_mi(yeni.ucret) {
        return Err(ucret_hatasi());
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
        kaydet(&tx, Eylem::Ekleme, "appointment", &id.to_string(), cihaz, None, LogHacmi::HerCagri)?;

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

/// `seriyi_sil` çağrılsa KAÇ randevunun silineceğini söyler; hiçbir şey
/// değiştirmez.
///
/// Silme geri alınamaz bir işlem olduğu için onay metninin kaç kaydın
/// gideceğini söylemesi gerekiyor (bkz. dal incelemesi I4a) ve bu sayı
/// yalnızca sunucuda bilinebilir: seri, ekranda görünen haftanın çok
/// ötesine uzanabilir.
///
/// `cakisanlari_bul` ile aynı gerekçeyle **log YAZMAZ**: kullanıcıya veri
/// göstermeyen (yalnızca bir sayı dönen), onay kutusunu hazırlamak için
/// yapılan bir kontroldür; kullanıcı silmekten vazgeçse bile silinemeyen
/// loga kalıcı bir satır düşürmesi gürültüden başka bir şey üretmez.
/// Silmenin KENDİSİ elbette loglanır (bkz. `seriyi_sil`).
pub fn seri_sayisi(
    conn: &Connection,
    seri_id: &str,
    bu_tarihten_itibaren: &str,
) -> Result<usize, DepoHatasi> {
    if !zaman_gecerli_mi(bu_tarihten_itibaren) {
        return Err(DepoHatasi::GecersizVeri(
            "Tarih biçimi YYYY-AA-GGTSS:DD olmalı.".into(),
        ));
    }
    let adet: i64 = conn.query_row(
        "SELECT COUNT(*) FROM appointments WHERE seri_id = ?1 AND baslangic >= ?2",
        rusqlite::params![seri_id, bu_tarihten_itibaren],
        |r| r.get(0),
    )?;
    Ok(adet as usize)
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
/// # Gelecekteki üyelerin NOTLARI da gider (cascade)
/// Silinen her randevunun seans notu ve özel notu `ON DELETE CASCADE` ile
/// birlikte gider. 52 haftalık bir serinin iptali, o serideki gelecek
/// seansların yazılmış tüm notlarını da yok eder. Davranış doğru (yetim not
/// tutulamaz) ama **sessiz olmamalı**: sayı silmeden önce sayılıp log
/// satırının `ayrinti` alanına yazılır (`Ayrinti::SeriSilme.not_adedi`) ve
/// onay metni de aynı sayıyı söyler (bkz. `seri_silinecek_not_sayisi` ve
/// `store::audit` modül başlığındaki "Cascade silinen notlar").
///
/// # Hiçbir satır silinmediyse `Bulunamadi` -- ve LOG YAZILMAZ
/// `sil` ve `durum_guncelle` bu kontrolü zaten yapıyordu; burada eksikti.
/// 0 satır silen bir `DELETE` olmamış bir işlemdir. Plan 2 bu fonksiyonu
/// HTTP'ye açtığı için (`DELETE /randevular/seri/{seri_id}`) eksik kontrol
/// **dışarıdan tetiklenebilir bir gürültü yolu** hâline gelmişti: var
/// olmayan bir `seri_id` ile atılan her istek, `audit_log`'a silinemeyen bir
/// satır düşürüyordu. Dönüş tipi `sil`/`durum_guncelle` ile aynı hizaya
/// getirildi (404), böylece "sildim" diyen bir yanıtın arkasında gerçekten
/// bir silme olduğu garanti edilir.
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

    // ONCE say, SONRA sil (bkz. `sil`): cascade calistiktan sonra sayilacak
    // bir sey kalmaz.
    let not_adedi = seri_silinecek_not_sayisi(&tx, seri_id, bu_tarihten_itibaren)?;

    let silinen = tx.execute(
        "DELETE FROM appointments WHERE seri_id = ?1 AND baslangic >= ?2",
        rusqlite::params![seri_id, bu_tarihten_itibaren],
    )?;
    // 0 satir silindiyse ortada bir islem yok: ne veri degisti ne de
    // loglanacak bir sey var (bkz. fonksiyon dokumantasyonu). `tx` burada
    // commit edilmeden dusuyor.
    if silinen == 0 {
        return Err(DepoHatasi::Bulunamadi);
    }
    kaydet(
        &tx,
        Eylem::Silme,
        "appointment_seri",
        seri_id,
        cihaz,
        Some(Ayrinti::SeriSilme {
            adet: silinen,
            not_adedi,
            tarihten: bu_tarihten_itibaren.to_string(),
        }),
        LogHacmi::HerCagri,
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

    /// Üst sınır iki yönlü ve ÜÇ yazma yolunda da (`olustur`, `guncelle`,
    /// `seri_olustur`): sınır kabul, sınır+1 ret. `seri_olustur` eskiden
    /// kendi `u < 0` denetimini yapıyordu; ortak fonksiyona bağlanmasaydı
    /// üst sınır oradan delinirdi.
    #[test]
    fn ucret_ust_siniri_uc_yazma_yolunda_iki_yonlu() {
        assert_eq!(AZAMI_UCRET, 100_000_000, "seans basina 1 000 000 TL");
        assert!(ucret_gecerli_mi(Some(AZAMI_UCRET)));
        assert!(!ucret_gecerli_mi(Some(AZAMI_UCRET + 1)));
        assert!(!ucret_gecerli_mi(Some(i64::MAX)));
        assert!(ucret_gecerli_mi(None));

        let (_d, c, cid) = kurulum();
        let ucretli = |u: i64| YeniRandevu { ucret: Some(u), ..yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00") };

        let r = olustur(&c, &ucretli(AZAMI_UCRET), Cihaz::Masaustu).unwrap();
        assert_eq!(r.ucret, Some(AZAMI_UCRET));
        match olustur(&c, &ucretli(AZAMI_UCRET + 1), Cihaz::Masaustu).unwrap_err() {
            DepoHatasi::GecersizVeri(m) => assert_eq!(m, "Ücret 0 ile 1000000 TL arasında olmalı."),
            h => panic!("GecersizVeri bekleniyordu: {h:?}"),
        }

        let g = |u| guncelleme(cid, "2026-09-07T14:00", "2026-09-07T15:00", Some(u));
        assert!(matches!(
            guncelle(&c, r.id, &g(AZAMI_UCRET + 1), Cihaz::Masaustu).unwrap_err(),
            DepoHatasi::GecersizVeri(_)
        ));
        guncelle(&c, r.id, &g(AZAMI_UCRET - 1), Cihaz::Masaustu).unwrap();
        guncelle(&c, r.id, &g(AZAMI_UCRET), Cihaz::Masaustu).unwrap();

        let seri = |u| seri_olustur(&c, &ucretli(u), 2, Cihaz::Masaustu);
        assert!(matches!(seri(AZAMI_UCRET + 1).unwrap_err(), DepoHatasi::GecersizVeri(_)));
        assert!(matches!(seri(-1).unwrap_err(), DepoHatasi::GecersizVeri(_)));
        assert!(seri(AZAMI_UCRET).unwrap().iter().all(|x| x.ucret == Some(AZAMI_UCRET)));
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
    fn takvimde_olmayan_gune_randevu_acilamaz() {
        // Bicimce kusursuz, takvimde yok. Bu satir olusabilseydi randevu
        // "geldi" isaretlendiginde `son_temasi_isaretle` -> `son_temasi_tazele`
        // -> `yil_ekle` zinciri gunu cozumleyip reddeder ve durum
        // guncellemesinin TAMAMI geri alinirdi -- hata mesaji da kullanicinin
        // hic dokunmadigi "Son temas tarihi" alanini adlandirirdi. Kok delik
        // `zaman::zaman_gecerli_mi` icinde kapatildi; burada randevu
        // katmanindan sabitleniyor.
        let (_d, c, cid) = kurulum();
        for (bas, bit) in [
            ("2026-02-30T14:00", "2026-02-30T15:00"),
            ("2026-13-45T99:99", "2026-13-45T99:99"),
            ("2026-09-07T14:00", "2026-02-30T15:00"),
        ] {
            let hata = olustur(&c, &yeni(cid, bas, bit), Cihaz::Masaustu).unwrap_err();
            assert!(
                matches!(hata, DepoHatasi::GecersizVeri(_)),
                "{bas} - {bit} reddedilmeliydi"
            );
        }

        let sayi: i64 =
            c.query_row("SELECT COUNT(*) FROM appointments", [], |r| r.get(0)).unwrap();
        assert_eq!(sayi, 0, "gecersiz gunlu randevu veritabanina yazilmamali");
    }

    #[test]
    fn gecerli_randevu_geldi_isaretlenince_son_temas_yazilir_ve_hata_donmez() {
        // ARTI YON: takvim kontrolu eklenirken gecerli bir gunu de reddetmis
        // olsaydik ustteki eksi yon testi yine gecerdi. Bu test, tam olarak
        // gerileme raporundaki cagriyi (olustur + durum_guncelle("geldi"))
        // ucdan uca calistirir ve randevunun `planlandi` kalmadigini kanitlar.
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2028-02-29T14:00", "2028-02-29T15:00"), Cihaz::Masaustu)
            .expect("artik yilin 29 Subat'i gecerli bir gundur");
        durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).expect("gecerli gun kabul edilmeli");

        let durum: String = c
            .query_row("SELECT durum FROM appointments WHERE id = ?1", [r.id], |x| x.get(0))
            .unwrap();
        assert_eq!(durum, "geldi");
        assert_eq!(
            danisanin_son_temasi(&c, cid),
            (Some("2028-02-29".into()), Some("2035-02-28".into())),
            "son temas ve saklama bitisi yazilmali"
        );
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

    // --- Dal incelemesi I4a: seri silme sayimi ---------------------------

    #[test]
    fn seri_sayisi_silinecek_adedi_verir_ve_gecmisi_saymaz() {
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            4,
            Cihaz::Masaustu,
        )
        .unwrap();
        let sid = seri[0].seri_id.clone().unwrap();

        assert_eq!(seri_sayisi(&c, &sid, "2026-09-07T00:00").unwrap(), 4);
        assert_eq!(
            seri_sayisi(&c, &sid, "2026-09-21T00:00").unwrap(),
            2,
            "gecmis uyeler sayilmamali -- seriyi_sil de onlari silmiyor"
        );

        // Sayi, gercekten silinecek adetle birebir ayni olmali.
        let silinecek = seri_sayisi(&c, &sid, "2026-09-21T00:00").unwrap();
        let silinen = seriyi_sil(&c, &sid, "2026-09-21T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(silinen, silinecek, "onay metnindeki sayi gercekle ayni olmali");
    }

    #[test]
    fn seri_sayisi_hicbir_sey_degistirmez_ve_log_yazmaz() {
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            3,
            Cihaz::Masaustu,
        )
        .unwrap();
        let sid = seri[0].seri_id.clone().unwrap();
        let once_satir = appointments_satir_sayisi(&c);
        let once_log = crate::store::audit::son_kayitlar(&c, 200).unwrap().len();

        seri_sayisi(&c, &sid, "2026-09-07T00:00").unwrap();

        assert_eq!(appointments_satir_sayisi(&c), once_satir);
        assert_eq!(
            crate::store::audit::son_kayitlar(&c, 200).unwrap().len(),
            once_log,
            "sayim log yazmamali (silmenin kendisi loglaniyor)"
        );
    }

    #[test]
    fn seri_sayisi_gecersiz_tarihi_reddeder() {
        let (_d, c, _cid) = kurulum();
        assert!(matches!(
            seri_sayisi(&c, "yok", "07.09.2026 14:00").unwrap_err(),
            DepoHatasi::GecersizVeri(_)
        ));
    }

    // --- Dal incelemesi I2: seri capinda cakisma -------------------------

    #[test]
    fn seri_cakismasi_ilk_haftanin_otesini_de_gorur() {
        let (_d, c, cid) = kurulum();
        // Mevcut seri: 4 hafta, Pazartesi 14:00.
        seri_olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), 4, Cihaz::Masaustu)
            .unwrap();

        // Yeni seri BIR HAFTA SONRA baslar: 1. haftasi bos degil ama tekil
        // kontrol (yalnizca ilk hafta) de cakisma gorurdu. Asil kanit
        // asagida: cakisan hafta sayisi 3 -- yani 2., 3. haftalar da
        // goruluyor.
        let sonuc =
            seri_cakisanlari_bul(&c, "2026-09-14T14:00", "2026-09-14T15:00", 5, None).unwrap();
        assert_eq!(sonuc.cakisan_hafta_sayisi, 3, "14, 21, 28 Eylul cakismali");
        assert_eq!(sonuc.kontrol_edilen_hafta, 5);
        assert_eq!(sonuc.cakisanlar.len(), 3);
    }

    #[test]
    fn seri_cakismasi_ilk_hafta_temizken_sonraki_haftalari_yakalar() {
        let (_d, c, cid) = kurulum();
        // Yalnizca 3. haftaya denk gelen tek bir randevu var.
        olustur(&c, &yeni(cid, "2026-09-21T14:00", "2026-09-21T15:00"), Cihaz::Masaustu).unwrap();

        // Tekil kontrol (eski davranis) TEMIZ gorurdu:
        let tekil = cakisanlari_bul(&c, "2026-09-07T14:00", "2026-09-07T15:00", None).unwrap();
        assert!(tekil.is_empty(), "ilk hafta gercekten temiz -- eski kontrol uyarmazdi");

        let sonuc =
            seri_cakisanlari_bul(&c, "2026-09-07T14:00", "2026-09-07T15:00", 4, None).unwrap();
        assert_eq!(sonuc.cakisan_hafta_sayisi, 1);
        assert_eq!(sonuc.cakisanlar.len(), 1);
        assert_eq!(sonuc.cakisanlar[0].baslangic, "2026-09-21T14:00");
    }

    #[test]
    fn seri_cakismasi_haric_id_ile_kendini_saymaz() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        let sonuc =
            seri_cakisanlari_bul(&c, "2026-09-07T14:00", "2026-09-07T15:00", 3, Some(r.id))
                .unwrap();
        assert_eq!(sonuc.cakisan_hafta_sayisi, 0);
        assert!(sonuc.cakisanlar.is_empty());
    }

    #[test]
    fn seri_cakismasi_log_yazmaz() {
        let (_d, c, cid) = kurulum();
        seri_olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), 4, Cihaz::Masaustu)
            .unwrap();
        let once = crate::store::audit::son_kayitlar(&c, 200).unwrap().len();

        seri_cakisanlari_bul(&c, "2026-09-07T14:00", "2026-09-07T15:00", 12, None).unwrap();

        let sonra = crate::store::audit::son_kayitlar(&c, 200).unwrap().len();
        assert_eq!(sonra, once, "cakisma kontrolu log yazmamali (Gorev 5 karari)");
    }

    #[test]
    fn seri_cakismasi_gecersiz_tekrar_sayisini_reddeder() {
        let (_d, c, _cid) = kurulum();
        assert!(matches!(
            seri_cakisanlari_bul(&c, "2026-09-07T14:00", "2026-09-07T15:00", 0, None).unwrap_err(),
            DepoHatasi::GecersizVeri(_)
        ));
        assert!(matches!(
            seri_cakisanlari_bul(&c, "2026-09-07T14:00", "2026-09-07T15:00", AZAMI_TEKRAR + 1, None)
                .unwrap_err(),
            DepoHatasi::GecersizVeri(_)
        ));
    }

    #[test]
    fn seri_cakismasi_ayni_randevuyu_iki_kez_listelemez() {
        let (_d, c, cid) = kurulum();
        // Bir haftadan uzun suren (patolojik ama gecerli) bir randevu iki
        // ardisik haftayla da cakisir; listede bir kez gorunmeli.
        olustur(&c, &yeni(cid, "2026-09-07T13:00", "2026-09-21T16:00"), Cihaz::Masaustu).unwrap();

        let sonuc =
            seri_cakisanlari_bul(&c, "2026-09-07T14:00", "2026-09-07T15:00", 3, None).unwrap();
        assert_eq!(sonuc.cakisan_hafta_sayisi, 3, "uc haftanin ucu de cakisiyor");
        assert_eq!(sonuc.cakisanlar.len(), 1, "ayni kayit listede bir kez olmali");
    }

    // --- Dal incelemesi C1: alan guncelleme ------------------------------
    //
    // C1'in ozu: "Kaydet" mevcut bir randevuda KOPYA uretiyordu. Bu yuzden
    // asagidaki testlerin en onemli iddiasi "alan degisti" degil, SATIR
    // SAYISI DEGISMEDI -- kopya uretmeyi yakalayan tek assertion budur.

    fn guncelleme(client_id: i64, baslangic: &str, bitis: &str, ucret: Option<i64>) -> RandevuGuncelleme {
        RandevuGuncelleme {
            client_id,
            baslangic: baslangic.into(),
            bitis: bitis.into(),
            ucret,
        }
    }

    #[test]
    fn guncelleme_yeni_satir_yaratmaz_ve_alanlari_degistirir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        let once = appointments_satir_sayisi(&c);

        let guncel = guncelle(
            &c,
            r.id,
            &guncelleme(cid, "2026-09-07T16:00", "2026-09-07T17:30", Some(50000)),
            Cihaz::Masaustu,
        )
        .unwrap();

        assert_eq!(
            appointments_satir_sayisi(&c),
            once,
            "guncelleme KOPYA uretmemeli: satir sayisi degismemeli (dal incelemesi C1)"
        );
        assert_eq!(guncel.id, r.id, "ayni kayit donmeli, yenisi degil");
        assert_eq!(guncel.baslangic, "2026-09-07T16:00");
        assert_eq!(guncel.bitis, "2026-09-07T17:30");
        assert_eq!(guncel.ucret, Some(50000));
        assert_eq!(guncel.durum, "planlandi", "durum bu yoldan degismemeli");
    }

    #[test]
    fn guncelleme_danisani_degistirebilir() {
        let (_d, c, cid) = kurulum();
        let ikinci = danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "Mehmet Demir".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();

        let guncel = guncelle(
            &c,
            r.id,
            &guncelleme(ikinci.id, "2026-09-07T14:00", "2026-09-07T15:00", Some(45000)),
            Cihaz::Masaustu,
        )
        .unwrap();
        assert_eq!(guncel.client_id, ikinci.id);
        assert_eq!(guncel.danisan_adi, "Mehmet Demir");
    }

    #[test]
    fn guncelleme_seri_uyesini_tekil_gunceller_digerlerine_dokunmaz() {
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            3,
            Cihaz::Masaustu,
        )
        .unwrap();
        let once = appointments_satir_sayisi(&c);

        // Serinin ikinci haftasini bir saat kaydir -- kullanicinin tam
        // olarak yapmak isteyebilecegi sey (bkz. `guncelle` dokumantasyonu).
        let guncel = guncelle(
            &c,
            seri[1].id,
            &guncelleme(cid, "2026-09-14T15:00", "2026-09-14T16:00", Some(45000)),
            Cihaz::Masaustu,
        )
        .unwrap();

        assert_eq!(appointments_satir_sayisi(&c), once, "seri uyesi guncellemesi satir eklememeli");
        assert_eq!(guncel.baslangic, "2026-09-14T15:00");
        assert_eq!(
            guncel.seri_id, seri[1].seri_id,
            "seri uyeligi guncellemeyle kopmamali"
        );

        let hepsi =
            aralik_getir(&c, "2026-09-01T00:00", "2026-10-01T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(hepsi.len(), 3);
        assert_eq!(hepsi[0].baslangic, "2026-09-07T14:00", "1. hafta dokunulmamis olmali");
        assert_eq!(hepsi[2].baslangic, "2026-09-21T14:00", "3. hafta dokunulmamis olmali");
    }

    #[test]
    fn olmayan_randevu_guncellenince_bulunamadi_doner() {
        let (_d, c, cid) = kurulum();
        let hata = guncelle(
            &c,
            999,
            &guncelleme(cid, "2026-09-07T14:00", "2026-09-07T15:00", None),
            Cihaz::Masaustu,
        )
        .unwrap_err();
        assert!(matches!(hata, DepoHatasi::Bulunamadi));
    }

    #[test]
    fn guncellemede_olmayan_danisan_gecersiz_veri_doner() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        let hata = guncelle(
            &c,
            r.id,
            &guncelleme(9999, "2026-09-07T14:00", "2026-09-07T15:00", None),
            Cihaz::Masaustu,
        )
        .unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn guncellemede_gecersiz_zaman_ve_negatif_ucret_reddedilir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();

        assert!(matches!(
            guncelle(&c, r.id, &guncelleme(cid, "07.09.2026 14:00", "07.09.2026 15:00", None), Cihaz::Masaustu)
                .unwrap_err(),
            DepoHatasi::GecersizVeri(_)
        ));
        assert!(matches!(
            guncelle(&c, r.id, &guncelleme(cid, "2026-09-07T15:00", "2026-09-07T14:00", None), Cihaz::Masaustu)
                .unwrap_err(),
            DepoHatasi::GecersizVeri(_)
        ));
        assert!(matches!(
            guncelle(&c, r.id, &guncelleme(cid, "2026-09-07T14:00", "2026-09-07T15:00", Some(-1)), Cihaz::Masaustu)
                .unwrap_err(),
            DepoHatasi::GecersizVeri(_)
        ));
    }

    #[test]
    fn guncelleme_audit_basarisiz_olursa_geri_alinir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();

        c.execute("DROP TABLE audit_log", []).unwrap();

        let sonuc = guncelle(
            &c,
            r.id,
            &guncelleme(cid, "2026-09-07T16:00", "2026-09-07T17:00", Some(99900)),
            Cihaz::Masaustu,
        );
        assert!(sonuc.is_err(), "audit_log yokken guncelle Err donmeli");
        assert!(matches!(sonuc.unwrap_err(), DepoHatasi::Sqlite(_)));

        let (baslangic, ucret): (String, Option<i64>) = c
            .query_row("SELECT baslangic, ucret FROM appointments WHERE id = ?1", [r.id], |x| {
                Ok((x.get(0)?, x.get(1)?))
            })
            .unwrap();
        assert_eq!(baslangic, "2026-09-07T14:00", "audit basarisizsa guncelleme geri alinmali");
        assert_eq!(ucret, Some(45000), "audit basarisizsa ucret degisikligi geri alinmali");
    }

    #[test]
    fn guncelleme_duzenleme_logu_yazar_ve_hassas_veri_icermez() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        guncelle(
            &c,
            r.id,
            &guncelleme(cid, "2026-09-07T16:00", "2026-09-07T17:00", Some(50000)),
            Cihaz::Masaustu,
        )
        .unwrap();

        let kayitlar = crate::store::audit::son_kayitlar(&c, 20).unwrap();
        let duzenleme = kayitlar
            .iter()
            .find(|k| k.eylem == "duzenleme" && k.varlik == "appointment")
            .expect("guncelleme bir duzenleme kaydi yazmali");
        assert_eq!(duzenleme.varlik_id, r.id.to_string());

        let hepsi = format!("{kayitlar:?}");
        assert!(!hepsi.contains("Ayse Yilmaz"), "danisan adi loga yazilmamali: {hepsi}");
        assert!(!hepsi.contains("50000"), "ucret loga yazilmamali: {hepsi}");
        assert!(!hepsi.contains("16:00"), "saat loga yazilmamali: {hepsi}");
    }

    // --- Plan 3 Gorev 2: denetim kaydi hacim politikasi ------------------

    fn goruntuleme_sayisi(c: &rusqlite::Connection) -> i64 {
        c.query_row(
            "SELECT COUNT(*) FROM audit_log WHERE eylem='goruntuleme' AND varlik='appointment'",
            [],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn takvim_listesi_tekrar_cagrilinca_goruntuleme_satiri_birikmez() {
        // Plan 2'nin biraktigi ihlal: `AnaEkran.yukle()` mount'ta, her hafta
        // degisiminde ve HER MUTASYONDAN SONRA calisiyor; her calisma bir
        // `goruntuleme` satiri yaziyordu. Sayan test: 30 cagri TAM OLARAK 1
        // satir uretmeli ("en az 1" degil -- birlestirme hic calismasa da
        // "en az 1" gecerdi).
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        assert_eq!(goruntuleme_sayisi(&c), 0, "on kosul: henuz liste cagrilmadi");

        for _ in 0..30 {
            let liste =
                aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
            assert_eq!(liste.len(), 1, "birlestirme donen VERIYI etkilememeli");
        }

        assert_eq!(
            goruntuleme_sayisi(&c),
            1,
            "30 takvim yenilemesi tam olarak 1 goruntuleme satiri uretmeli"
        );
    }

    #[test]
    fn durum_isaretlemek_tek_mutasyon_satiri_birakir() {
        // "Geldi" isaretlemek TEK kullanici eylemidir; arayuz bunun ardindan
        // takvimi yeniden yukler. Once: 2 satir (duzenleme + goruntuleme).
        // Simdi: mutasyon satiri KALIR (hesabi verilmeli), yeniden yukleme
        // satiri birlestirilir.
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        // Arayuzun mount'taki ilk yuklemesi:
        aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
        let once = crate::store::audit::son_kayitlar(&c, 200).unwrap().len();

        durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).unwrap();
        aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();

        let sonra = crate::store::audit::son_kayitlar(&c, 200).unwrap().len();
        assert_eq!(
            sonra - once,
            1,
            "isaretleme + yeniden yukleme yalnizca mutasyon satirini birakmali"
        );
        let son = &crate::store::audit::son_kayitlar(&c, 1).unwrap()[0];
        assert_eq!(son.eylem, "duzenleme", "kalan satir mutasyon satiri olmali");
        assert_eq!(son.varlik_id, r.id.to_string());
    }

    #[test]
    fn seriyi_sil_eslesen_kayit_yokken_log_yazmaz() {
        // Plan 2 bu fonksiyonu HTTP'ye acti: var olmayan bir seri_id ile
        // atilan her istek silinemeyen bir log satiri dusuruyordu.
        let (_d, c, cid) = kurulum();
        seri_olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), 3, Cihaz::Masaustu)
            .unwrap();
        let once = crate::store::audit::son_kayitlar(&c, 200).unwrap().len();
        let once_satir = appointments_satir_sayisi(&c);

        for _ in 0..10 {
            let hata = seriyi_sil(&c, "boyle-bir-seri-yok", "2026-09-07T00:00", Cihaz::Masaustu)
                .unwrap_err();
            assert!(matches!(hata, DepoHatasi::Bulunamadi), "0 satir silen cagri Bulunamadi donmeli");
        }

        assert_eq!(
            crate::store::audit::son_kayitlar(&c, 200).unwrap().len(),
            once,
            "eslesen kayit yokken seriyi_sil log yazmamali"
        );
        assert_eq!(appointments_satir_sayisi(&c), once_satir, "hicbir randevu silinmemeli");
    }

    #[test]
    fn seriyi_sil_tumu_gecmiste_kalan_tarihte_de_log_yazmaz() {
        // Ayni ihlalin ikinci yolu: seri VAR ama verilen tarihten sonra
        // uyesi yok. Gecmisi koruma kurali geregi 0 satir silinir.
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            3,
            Cihaz::Masaustu,
        )
        .unwrap();
        let sid = seri[0].seri_id.clone().unwrap();
        let once = crate::store::audit::son_kayitlar(&c, 200).unwrap().len();

        let hata = seriyi_sil(&c, &sid, "2027-01-01T00:00", Cihaz::Masaustu).unwrap_err();
        assert!(matches!(hata, DepoHatasi::Bulunamadi));

        assert_eq!(crate::store::audit::son_kayitlar(&c, 200).unwrap().len(), once);
        assert_eq!(appointments_satir_sayisi(&c), 3, "gecmis korunmali");
    }

    #[test]
    fn gercek_seri_silme_hala_loglanir() {
        // Birlestirme/sifir-satir kontrolu logu TAMAMEN susturmuyor:
        // gercekten silen bir cagri hala kendi satirini yaziyor.
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            3,
            Cihaz::Masaustu,
        )
        .unwrap();
        let sid = seri[0].seri_id.clone().unwrap();
        let once = crate::store::audit::son_kayitlar(&c, 200).unwrap().len();

        assert_eq!(seriyi_sil(&c, &sid, "2026-09-07T00:00", Cihaz::Masaustu).unwrap(), 3);

        let kayitlar = crate::store::audit::son_kayitlar(&c, 200).unwrap();
        assert_eq!(kayitlar.len() - once, 1, "gercek silme tam olarak 1 satir yazmali");
        assert_eq!(kayitlar[0].eylem, "silme");
        assert_eq!(kayitlar[0].varlik, "appointment_seri");
    }

    // --- Son temas / saklama suresi baglantisi --------------------------

    fn danisanin_son_temasi(c: &rusqlite::Connection, cid: i64) -> (Option<String>, Option<String>) {
        c.query_row("SELECT son_temas, saklama_bitis FROM clients WHERE id = ?1", [cid], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap()
    }

    #[test]
    fn geldi_isaretlemek_son_temasi_ve_saklama_bitisini_tazeler() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        assert_eq!(
            danisanin_son_temasi(&c, cid),
            (None, None),
            "on kosul: randevu olusturmak tek basina temas degildir"
        );

        durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).unwrap();

        assert_eq!(
            danisanin_son_temasi(&c, cid),
            (Some("2026-09-07".into()), Some("2033-09-07".into())),
            "gerceklesen seans son temasi tazelemeli"
        );
    }

    /// Plan 7 Gorev 3: `durum_guncelle`nin DONUS DEGERI de guncellenmis
    /// alanlari tasimali -- istemci kartla saklama listesini bu yaniti
    /// kullanarak YEREL yamalar (yeniden cekmez, ikisi de `HerCagri`).
    /// Ustteki test yalnizca VERITABANINI dogruluyordu; bu test onu SUNUCUNUN
    /// CAGIRANA verdigi degerle dogrular -- ikisi ayri sey: donus degeri
    /// yanlis olsa da veritabani dogru olabilirdi (rota o zaman `{}` donerdi
    /// ve istemci hicbir zaman ogrenmezdi).
    #[test]
    fn durum_guncelle_gelince_sonuc_degisen_alanlari_tasir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();

        let sonuc = durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).unwrap();

        let SonTemasSonucu { client_id, son_temas, saklama_bitis } =
            sonuc.expect("geldi isaretlemesi ilk temasta HER ZAMAN ileri tasir");
        assert_eq!(client_id, cid);
        assert_eq!(son_temas, "2026-09-07");
        assert_eq!(saklama_bitis, "2033-09-07");
    }

    #[test]
    fn gelmedi_ve_iptal_son_temasi_degistirmez() {
        // Ters yon: her durum degisikligi temas SAYILMAMALI. Bu test
        // olmasaydi "durum ne olursa olsun tazele" diyen bir uygulama da
        // ustteki testi gecerdi.
        let (_d, c, cid) = kurulum();
        for (i, durum) in ["gelmedi", "iptal", "planlandi"].iter().enumerate() {
            let gun = format!("2026-09-0{}", i + 1);
            let r = olustur(
                &c,
                &yeni(cid, &format!("{gun}T14:00"), &format!("{gun}T15:00")),
                Cihaz::Masaustu,
            )
            .unwrap();
            let sonuc = durum_guncelle(&c, r.id, durum, Cihaz::Masaustu).unwrap();
            assert!(sonuc.is_none(), "{durum} donus degerinde de son temas tasimamali");
            assert_eq!(
                danisanin_son_temasi(&c, cid),
                (None, None),
                "{durum} bir temas degildir"
            );
        }
    }

    #[test]
    fn son_temas_geriye_gitmez() {
        let (_d, c, cid) = kurulum();
        let yeni_r = olustur(&c, &yeni(cid, "2026-09-14T14:00", "2026-09-14T15:00"), Cihaz::Masaustu)
            .unwrap();
        let eski_r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();

        durum_guncelle(&c, yeni_r.id, "geldi", Cihaz::Masaustu).unwrap();
        // Kullanici gecmis bir randevuyu SONRADAN "geldi" isaretliyor.
        let geriye_donuk = durum_guncelle(&c, eski_r.id, "geldi", Cihaz::Masaustu).unwrap();

        assert!(
            geriye_donuk.is_none(),
            "geriye giden bir isaretleme donus degerinde de None olmali -- \
             istemci degismeyen bir alani yamayacak yanlis sinyali almamali"
        );
        assert_eq!(
            danisanin_son_temasi(&c, cid).0.as_deref(),
            Some("2026-09-14"),
            "gecmise donuk duzeltme son temasi geri almamali"
        );
    }

    #[test]
    fn geldi_isaretlemek_hala_tek_log_satiri_uretir() {
        // Son temas tazelemesi AYRI bir log satiri yazmamali: "Geldi"
        // isaretlemek tek bir kullanici eylemidir (Plan 3 Gorev 2'de
        // duzeltilen "iki satir" hatasinin ayni sinifi).
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        let once = crate::store::audit::son_kayitlar(&c, 200).unwrap().len();

        durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).unwrap();

        assert_eq!(
            crate::store::audit::son_kayitlar(&c, 200).unwrap().len() - once,
            1,
            "geldi isaretlemek tam olarak 1 satir yazmali"
        );
    }

    #[test]
    fn geldi_audit_basarisiz_olursa_son_temas_da_geri_alinir() {
        // Atomiklik: durum + log + son temas TEK transaction. `audit_log`
        // dusurulunce ucu birden geri alinmali.
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        c.execute("DROP TABLE audit_log", []).unwrap();

        assert!(durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).is_err());

        assert_eq!(danisanin_son_temasi(&c, cid), (None, None), "son temas geri alinmali");
        let durum: String = c
            .query_row("SELECT durum FROM appointments WHERE id = ?1", [r.id], |x| x.get(0))
            .unwrap();
        assert_eq!(durum, "planlandi", "randevu durumu da geri alinmali");
    }

    // --- Plan A Gorev 9 (tasarim A4): tasinan "geldi" seansi -------------
    //
    // Isaretlenmis seanslar da tasinabilir (kullanici karari 2026-09-25).
    // "geldi" seansi tasininca son temas `durum_guncelle` ile AYNI islevden
    // (`son_temasi_isaretle`) gecer: yalnizca ileri gider, ayri log yazmaz.

    #[test]
    fn geldi_seansi_ileri_tasininca_son_temas_ilerler() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).unwrap();
        let s = guncelle_ve_son_temas(
            &c, r.id, &guncelleme(cid, "2026-09-10T14:00", "2026-09-10T15:00", Some(45000)), Cihaz::Masaustu,
        ).unwrap();
        assert_eq!(s.randevu.durum, "geldi", "tasima durumu korur");
        let st = s.son_temas.expect("ileri tasima son temasi degistirmeli");
        assert_eq!(st.son_temas, "2026-09-10");
        assert_eq!(danisanin_son_temasi(&c, cid).0.as_deref(), Some("2026-09-10"));
    }

    #[test]
    fn geldi_seansi_geri_tasininca_son_temas_gerilemez() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-10T14:00", "2026-09-10T15:00"), Cihaz::Masaustu).unwrap();
        durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).unwrap();
        let s = guncelle_ve_son_temas(
            &c, r.id, &guncelleme(cid, "2026-09-07T14:00", "2026-09-07T15:00", Some(45000)), Cihaz::Masaustu,
        ).unwrap();
        assert!(s.son_temas.is_none(), "geriye tasima degismeyen alan bildirmemeli");
        assert_eq!(danisanin_son_temasi(&c, cid).0.as_deref(), Some("2026-09-10"));
    }

    #[test]
    fn planli_seansi_tasimak_son_temasa_dokunmaz() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        let s = guncelle_ve_son_temas(
            &c, r.id, &guncelleme(cid, "2026-09-10T14:00", "2026-09-10T15:00", Some(45000)), Cihaz::Masaustu,
        ).unwrap();
        assert!(s.son_temas.is_none());
        assert_eq!(danisanin_son_temasi(&c, cid).0, None, "planli seans temas degildir");
    }

    /// Son inceleme T9 (kontrolor R14): tasima danisani da degistirebilir.
    /// Son temas TASINAN kaydin (UPDATE sonrasi) danisanindan okunur: yeni
    /// danisanin son temasi ilerler, eski danisaninki OLDUGU GIBI kalir
    /// (ileri tasima eski danisani da ilerletseydi hic gorusulmemis bir
    /// tarihi "son temas" sayardi).
    #[test]
    fn geldi_seansi_baska_danisana_tasininca_yeni_danisan_ilerler_eskisi_degismez() {
        let (_d, c, cid) = kurulum();
        let ikinci = danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "Mehmet Demir".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).unwrap();
        let eski_once = danisanin_son_temasi(&c, cid);
        assert_eq!(eski_once.0.as_deref(), Some("2026-09-07"), "on kosul: eski danisanin son temasi var");
        assert_eq!(danisanin_son_temasi(&c, ikinci.id), (None, None), "on kosul: yeni danisan hic gorulmedi");

        // Hem danisan hem tarih (ileri) degisiyor: eski danisana yazilsaydi
        // onun son temasi da 10 Eylul'e ilerlerdi.
        let s = guncelle_ve_son_temas(
            &c, r.id, &guncelleme(ikinci.id, "2026-09-10T14:00", "2026-09-10T15:00", Some(45000)), Cihaz::Masaustu,
        ).unwrap();

        assert_eq!(s.randevu.client_id, ikinci.id);
        assert_eq!(s.randevu.durum, "geldi", "tasima durumu korur");
        let st = s.son_temas.expect("yeni danisanin son temasi ilerledi: yanit bildirmeli");
        assert_eq!(st.client_id, ikinci.id, "yanit YENI danisani bildirir");
        assert_eq!(st.son_temas, "2026-09-10");
        assert_eq!(
            danisanin_son_temasi(&c, ikinci.id),
            (Some("2026-09-10".to_string()), Some(st.saklama_bitis.clone())),
        );
        assert_eq!(danisanin_son_temasi(&c, cid), eski_once, "eski danisanin son temasi ve saklamasi degismez");
    }

    #[test]
    fn tasima_tek_log_satiri_yazar() {
        // "geldi" seansi tasimak tek bir kullanici eylemi: bir Duzenleme
        // satiri. Son temas tazelemesi ek satir YAZMAZ (durum_guncelle ile ayni).
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).unwrap();
        let sayi = |c: &rusqlite::Connection| -> i64 {
            c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap()
        };
        let once = sayi(&c);
        let s = guncelle_ve_son_temas(
            &c, r.id, &guncelleme(cid, "2026-09-10T14:00", "2026-09-10T15:00", Some(45000)), Cihaz::Masaustu,
        ).unwrap();
        assert!(s.son_temas.is_some(), "on kosul: son temas gercekten ilerledi");
        assert_eq!(sayi(&c) - once, 1);
    }

    #[test]
    fn tasima_son_temas_yazilamazsa_tasima_ve_log_da_geri_alinir() {
        // Atomiklik: tasima + log + son temas TEK transaction. Son temas
        // yazimi (clients UPDATE) bir tetikleyiciyle bozulunca tasima da
        // denetim satiri da kalici olmamali -- "seans tasindi ama saklama
        // suresi eski" ya da "tasinmadi ama loglandi" durumu olusmamali.
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).unwrap();
        c.execute_batch(
            "CREATE TRIGGER son_temas_yazilamaz BEFORE UPDATE OF son_temas ON clients
             BEGIN SELECT RAISE(ABORT, 'son temas yazilamaz'); END;",
        )
        .unwrap();
        let log_sayisi = |c: &rusqlite::Connection| -> i64 {
            c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0)).unwrap()
        };
        let once = log_sayisi(&c);

        let sonuc = guncelle_ve_son_temas(
            &c, r.id, &guncelleme(cid, "2026-09-10T14:00", "2026-09-10T15:00", Some(45000)), Cihaz::Masaustu,
        );

        assert!(sonuc.is_err(), "son temas yazilamazsa tasima Err donmeli");
        let baslangic: String = c
            .query_row("SELECT baslangic FROM appointments WHERE id = ?1", [r.id], |x| x.get(0))
            .unwrap();
        assert_eq!(baslangic, "2026-09-07T14:00", "tasima geri alinmali");
        assert_eq!(log_sayisi(&c), once, "denetim satiri da geri alinmali");
        assert_eq!(danisanin_son_temasi(&c, cid).0.as_deref(), Some("2026-09-07"));
    }

    #[test]
    fn tasima_notu_ozel_notu_etiketi_ve_odemeyi_korur() {
        use crate::store::{notes, tags};
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        notes::not_kaydet(&c, r.id, "serbest", "Seans notu metni", Cihaz::Masaustu).unwrap();
        notes::ozel_not_kaydet(&c, r.id, "Ozel not metni", Cihaz::Masaustu).unwrap();
        tags::etiket_ekle(&c, r.id, "ruya", Cihaz::Masaustu).unwrap();
        odeme_guncelle(&c, r.id, true, Cihaz::Masaustu).unwrap();

        let s = guncelle_ve_son_temas(
            &c, r.id, &guncelleme(cid, "2026-09-12T10:30", "2026-09-12T11:20", Some(45000)), Cihaz::Masaustu,
        ).unwrap();

        assert_eq!(s.randevu.id, r.id, "tasima ayni kaydi gunceller");
        assert!(s.randevu.odendi, "odeme isareti korunur");
        assert_eq!(notes::not_getir(&c, r.id, Cihaz::Masaustu).unwrap().icerik, "Seans notu metni");
        assert_eq!(notes::ozel_not_getir(&c, r.id, Cihaz::Masaustu).unwrap().icerik, "Ozel not metni");
        let etiketler: Vec<String> =
            tags::seans_etiketleri(&c, r.id, Cihaz::Masaustu).unwrap().into_iter().map(|e| e.ad).collect();
        assert_eq!(etiketler, vec!["ruya".to_string()]);
    }

    /// Seri islemleri ZAMANA gore (tasarim A4): kesme noktasindan sonra
    /// baslayan her uye -- tasinmis olsa bile -- silinir.
    #[test]
    fn seri_silme_zamana_gore_ileri_tasinmis_uye_kesmeden_sonraysa_silinir() {
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), 4, Cihaz::Masaustu)
            .unwrap();
        let seri_id = seri[0].seri_id.clone().unwrap();
        guncelle(&c, seri[1].id, &guncelleme(cid, "2026-10-05T14:00", "2026-10-05T15:00", Some(45000)), Cihaz::Masaustu)
            .unwrap();
        assert_eq!(seri_sayisi(&c, &seri_id, "2026-09-21T14:00").unwrap(), 3);
        assert_eq!(seriyi_sil(&c, &seri_id, "2026-09-21T14:00", Cihaz::Masaustu).unwrap(), 3);
        let kalan = aralik_getir(&c, "2026-09-01T00:00", "2026-11-01T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(kalan.iter().map(|r| r.id).collect::<Vec<_>>(), vec![seri[0].id]);
    }

    #[test]
    fn seri_silme_zamana_gore_geri_tasinmis_uye_kesmeden_onceyse_korunur() {
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), 4, Cihaz::Masaustu)
            .unwrap();
        let seri_id = seri[0].seri_id.clone().unwrap();
        guncelle(&c, seri[3].id, &guncelleme(cid, "2026-09-01T14:00", "2026-09-01T15:00", Some(45000)), Cihaz::Masaustu)
            .unwrap();
        // 14 Eylul'den itibaren: 14 ve 21 Eylul silinir; 7 Eylul ve 1 Eylul'e
        // tasinmis uye KALIR.
        assert_eq!(seri_sayisi(&c, &seri_id, "2026-09-14T14:00").unwrap(), 2);
        assert_eq!(seriyi_sil(&c, &seri_id, "2026-09-14T14:00", Cihaz::Masaustu).unwrap(), 2);
        let mut kalan: Vec<i64> = aralik_getir(&c, "2026-08-01T00:00", "2026-11-01T00:00", Cihaz::Masaustu)
            .unwrap().into_iter().map(|r| r.id).collect();
        kalan.sort_unstable();
        let mut beklenen = vec![seri[0].id, seri[3].id];
        beklenen.sort_unstable();
        assert_eq!(kalan, beklenen);
    }

    // --- Dal incelemesi I2: cascade silinen notlar ----------------------
    //
    // `ON DELETE CASCADE` (schema::V3) davranisini DOGRULAYAN hicbir test
    // yoktu: `sil` sonrasi `progress_notes=0, private_notes=0` oluyor ve
    // denetim kaydinda tek satir kaliyordu. Asagidaki testler once
    // cascade'in gerceklestigini KANITLAR (yoksa "sayi dogru" iddialari
    // hicbir sey olcmezdi), sonra sayinin loga ulastigini.

    fn not_yaz(c: &rusqlite::Connection, randevu_id: i64) {
        crate::store::notes::not_kaydet(c, randevu_id, "dap", "SEANS NOTU", Cihaz::Masaustu)
            .unwrap();
        crate::store::notes::ozel_not_kaydet(c, randevu_id, "OZEL NOT", Cihaz::Masaustu).unwrap();
    }

    fn not_sayilari(c: &rusqlite::Connection) -> (i64, i64) {
        (
            c.query_row("SELECT COUNT(*) FROM progress_notes", [], |r| r.get(0)).unwrap(),
            c.query_row("SELECT COUNT(*) FROM private_notes", [], |r| r.get(0)).unwrap(),
        )
    }

    #[test]
    fn randevu_silmek_seans_notunu_ve_ozel_notu_da_siler() {
        // Davranisin KENDISI (cascade) burada sabitleniyor: bir gun yabanci
        // anahtar `ON DELETE RESTRICT`e cevrilirse ya da `PRAGMA
        // foreign_keys` kapanirsa bu test kirilir ve karar yeniden verilir.
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        not_yaz(&c, r.id);
        assert_eq!(not_sayilari(&c), (1, 1), "on kosul: iki not da yazilmis olmali");

        sil(&c, r.id, Cihaz::Masaustu).unwrap();

        assert_eq!(not_sayilari(&c), (0, 0), "randevuyla birlikte iki not da gitmeli");
    }

    #[test]
    fn silinecek_not_sayisi_resmi_ve_ozel_notu_toplar() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        // ARTI YON once: notsuz bir randevu 0 verir. "Hep 2 don" diyen bir
        // uygulama asagidaki iddiayi tek basina gecerdi.
        assert_eq!(silinecek_not_sayisi(&c, r.id).unwrap(), 0);

        crate::store::notes::not_kaydet(&c, r.id, "dap", "x", Cihaz::Masaustu).unwrap();
        assert_eq!(silinecek_not_sayisi(&c, r.id).unwrap(), 1, "yalnizca resmi not");

        crate::store::notes::ozel_not_kaydet(&c, r.id, "y", Cihaz::Masaustu).unwrap();
        assert_eq!(silinecek_not_sayisi(&c, r.id).unwrap(), 2, "resmi + ozel");
    }

    #[test]
    fn silinecek_not_sayisi_baska_randevunun_notunu_saymaz() {
        let (_d, c, cid) = kurulum();
        let a = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        let b = olustur(&c, &yeni(cid, "2026-09-08T14:00", "2026-09-08T15:00"), Cihaz::Masaustu)
            .unwrap();
        not_yaz(&c, b.id);

        assert_eq!(silinecek_not_sayisi(&c, a.id).unwrap(), 0, "komsu randevunun notu sayilmamali");
        assert_eq!(silinecek_not_sayisi(&c, b.id).unwrap(), 2);
    }

    #[test]
    fn silinecek_not_sayisi_log_yazmaz() {
        // `cakisanlari_bul` / `seri_sayisi` ile ayni sinif: onay kutusunu
        // hazirlayan kontrol, silinemez loga satir dusurmemeli.
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        not_yaz(&c, r.id);
        let once = crate::store::audit::son_kayitlar(&c, 200).unwrap().len();

        silinecek_not_sayisi(&c, r.id).unwrap();
        seri_silinecek_not_sayisi(&c, "yok", "2026-09-07T00:00").unwrap();

        assert_eq!(crate::store::audit::son_kayitlar(&c, 200).unwrap().len(), once);
    }

    #[test]
    fn randevu_silme_logu_silinen_not_sayisini_tasir() {
        // Bulgu: denetim kaydinda tek satir vardi -- `silme|appointment|1`
        // -- ve "iki klinik kayit da yok oldu" bilgisi HICBIR yerde yoktu.
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        not_yaz(&c, r.id);

        sil(&c, r.id, Cihaz::Masaustu).unwrap();

        let kayit = crate::store::audit::son_kayitlar(&c, 1).unwrap().remove(0);
        assert_eq!(kayit.eylem, "silme");
        assert_eq!(kayit.varlik, "appointment");
        assert_eq!(kayit.ayrinti.as_deref(), Some("silinen not: 2"));
    }

    #[test]
    fn notsuz_randevu_silme_logu_sifir_yazar() {
        // ARTI YON: "hep 2 yaz" diyen bir uygulama ustteki testi gecerdi.
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        sil(&c, r.id, Cihaz::Masaustu).unwrap();
        assert_eq!(
            crate::store::audit::son_kayitlar(&c, 1).unwrap()[0].ayrinti.as_deref(),
            Some("silinen not: 0")
        );
    }

    #[test]
    fn randevu_silme_not_basina_ayri_satir_yazmaz() {
        // Karar (bkz. `store::audit` "Cascade silinen notlar"): tek
        // kullanici eylemi = tek silinemez satir. 52 haftalik bir serinin
        // iptali 104 satir uretmemeli.
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        not_yaz(&c, r.id);
        let once = crate::store::audit::son_kayitlar(&c, 200).unwrap().len();

        sil(&c, r.id, Cihaz::Masaustu).unwrap();

        let sonra = crate::store::audit::son_kayitlar(&c, 200).unwrap();
        assert_eq!(sonra.len(), once + 1, "silme TAM OLARAK bir satir yazmali");
        assert!(
            !sonra.iter().any(|k| k.varlik == "progress_note" && k.eylem == "silme"),
            "not basina ayri silme satiri yazilmamali"
        );
        assert!(!sonra.iter().any(|k| k.varlik == "private_note" && k.eylem == "silme"));
    }

    #[test]
    fn seri_silmek_gelecek_uyelerin_notlarini_da_siler() {
        let (_d, c, cid) = kurulum();
        let seri =
            seri_olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), 3, Cihaz::Masaustu)
                .unwrap();
        let sid = seri[0].seri_id.clone().unwrap();
        for r in &seri {
            not_yaz(&c, r.id);
        }
        assert_eq!(not_sayilari(&c), (3, 3), "on kosul: uc seansin da notu var");

        // Ikinci haftadan itibaren sil: ILK haftanin notlari KALMALI
        // ("gecmis randevular silinmez" sozunun not tarafi).
        let silinecek_not = seri_silinecek_not_sayisi(&c, &sid, "2026-09-14T14:00").unwrap();
        assert_eq!(silinecek_not, 4, "iki randevunun resmi + ozel notu");

        let silinen = seriyi_sil(&c, &sid, "2026-09-14T14:00", Cihaz::Masaustu).unwrap();
        assert_eq!(silinen, 2);
        assert_eq!(not_sayilari(&c), (1, 1), "ilk haftanin notlari korunmali");

        let kayit = crate::store::audit::son_kayitlar(&c, 1).unwrap().remove(0);
        assert_eq!(
            kayit.ayrinti.as_deref(),
            Some("seri silme: 2 kayit, 4 not, 2026-09-14T14:00 sonrasi")
        );
    }

    #[test]
    fn seri_silinecek_not_sayisi_gecmis_uyeleri_saymaz() {
        // `seri_sayisi` ile AYNI kesme: silinmeyecek bir randevunun notu
        // uyari metnindeki sayiya girmemeli.
        let (_d, c, cid) = kurulum();
        let seri =
            seri_olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), 3, Cihaz::Masaustu)
                .unwrap();
        let sid = seri[0].seri_id.clone().unwrap();
        not_yaz(&c, seri[0].id);

        assert_eq!(
            seri_silinecek_not_sayisi(&c, &sid, "2026-09-14T14:00").unwrap(),
            0,
            "yalnizca gecmis uyenin notu var; silinecek not yok"
        );
        assert_eq!(
            seri_silinecek_not_sayisi(&c, &sid, "2026-09-07T14:00").unwrap(),
            2,
            "kesme geriye alininca ayni not sayiliyor -- kesme gercekten tarihe bagli"
        );
    }

    /// Son inceleme T9 (kontrolor R14): onay metnindeki NOT sayisi,
    /// `seri_sayisi`/`seriyi_sil` ile AYNI zaman kesmesini kullanir (tasarim
    /// A4). Tasinmis uyeler YENI tarihlerine gore sayilir. Kurulum asimetrik:
    /// kesmeden sonraya tasinan uyenin 2 notu, kesmeden onceye tasinan uyenin
    /// 1 notu var -- seri SIRASIYLA (ya da kimlikle) kesen bir uygulama 1 ya
    /// da 3 sayardi, zamanla kesen 2.
    #[test]
    fn seri_silinecek_not_sayisi_tasinmis_uyeyi_yeni_tarihine_gore_sayar() {
        let (_d, c, cid) = kurulum();
        // 7, 14, 21, 28 Eylul.
        let seri =
            seri_olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), 4, Cihaz::Masaustu)
                .unwrap();
        let sid = seri[0].seri_id.clone().unwrap();
        // 14 Eylul'deki uye (resmi + ozel not) kesmenin SONRASINA tasiniyor.
        not_yaz(&c, seri[1].id);
        guncelle(&c, seri[1].id, &guncelleme(cid, "2026-10-05T14:00", "2026-10-05T15:00", Some(45000)), Cihaz::Masaustu)
            .unwrap();
        // 28 Eylul'deki uye (yalnizca resmi not) kesmenin ONCESINE tasiniyor.
        crate::store::notes::not_kaydet(&c, seri[3].id, "dap", "SEANS NOTU", Cihaz::Masaustu).unwrap();
        guncelle(&c, seri[3].id, &guncelleme(cid, "2026-09-01T14:00", "2026-09-01T15:00", Some(45000)), Cihaz::Masaustu)
            .unwrap();

        let kesme = "2026-09-21T14:00";
        // 21 Eylul (notsuz) + 5 Ekim'e tasinan (2 not) silinecek.
        assert_eq!(seri_sayisi(&c, &sid, kesme).unwrap(), 2);
        assert_eq!(seri_silinecek_not_sayisi(&c, &sid, kesme).unwrap(), 2);

        // Sayi, silmenin GERCEKTEN goturdugu notlarla ayni: 1 Eylul'e tasinan
        // uyenin resmi notu kalir.
        assert_eq!(seriyi_sil(&c, &sid, kesme, Cihaz::Masaustu).unwrap(), 2);
        assert_eq!(not_sayilari(&c), (1, 0));
    }

    #[test]
    fn seri_silinecek_not_sayisi_gecersiz_tarihi_reddeder() {
        let (_d, c, _cid) = kurulum();
        assert!(matches!(
            seri_silinecek_not_sayisi(&c, "s", "07.09.2026 14:00"),
            Err(DepoHatasi::GecersizVeri(_))
        ));
    }

    // --- Plan 4 Gorev 1: odeme isaretleme ----------------------------------

    #[test]
    fn odeme_isaretlenir_ve_geri_alinir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        assert!(!r.odendi, "on kosul: yeni randevu odenmemis");

        odeme_guncelle(&c, r.id, true, Cihaz::Masaustu).unwrap();
        let hafta = aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
        assert!(hafta.iter().find(|x| x.id == r.id).unwrap().odendi);

        odeme_guncelle(&c, r.id, false, Cihaz::Masaustu).unwrap();
        let hafta = aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
        assert!(!hafta.iter().find(|x| x.id == r.id).unwrap().odendi, "geri alma da yazilmali (iki yon)");
    }

    #[test]
    fn olmayan_randevuya_odeme_bulunamadi_doner_ve_log_yazmaz() {
        let (_d, c, _cid) = kurulum();
        let once = crate::store::audit::son_kayitlar(&c, 1000).unwrap().len();
        assert!(matches!(odeme_guncelle(&c, 999_999, true, Cihaz::Masaustu), Err(DepoHatasi::Bulunamadi)));
        assert_eq!(crate::store::audit::son_kayitlar(&c, 1000).unwrap().len(), once);
    }

    #[test]
    fn odeme_her_cagrida_bir_log_satiri_yazar_ve_tutari_icermez() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        let once = crate::store::audit::son_kayitlar(&c, 1000).unwrap().len();
        odeme_guncelle(&c, r.id, true, Cihaz::Masaustu).unwrap();
        odeme_guncelle(&c, r.id, true, Cihaz::Masaustu).unwrap();
        let kayitlar = crate::store::audit::son_kayitlar(&c, 1000).unwrap();
        assert_eq!(kayitlar.len(), once + 2, "HerCagri: iki eylem iki satir, birlesme yok");
        let son = &kayitlar[0];
        assert_eq!(son.ayrinti.as_deref(), Some("odeme: alindi"));
        let hepsi = format!("{kayitlar:?}");
        assert!(!hepsi.contains("45000") && !hepsi.contains("450"), "tutar loga girmemeli");
    }

    #[test]
    fn odeme_geri_alma_kendi_ayrintisiyla_loglanir() {
        // Iki yon logda da ayirt edilmeli: her iki cagriya da "alindi" yazan
        // bir uygulama yukaridaki testlerin hepsini gecerdi.
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        odeme_guncelle(&c, r.id, true, Cihaz::Masaustu).unwrap();
        odeme_guncelle(&c, r.id, false, Cihaz::Masaustu).unwrap();
        let ayrintilar: Vec<Option<String>> = crate::store::audit::son_kayitlar(&c, 2)
            .unwrap()
            .into_iter()
            .map(|k| k.ayrinti)
            .collect();
        assert_eq!(
            ayrintilar,
            vec![Some("odeme: geri alindi".to_string()), Some("odeme: alindi".to_string())]
        );
    }

    #[test]
    fn odeme_iptal_edilmis_randevuda_da_isaretlenebilir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        durum_guncelle(&c, r.id, "iptal", Cihaz::Masaustu).unwrap();
        odeme_guncelle(&c, r.id, true, Cihaz::Masaustu).unwrap();
        // Hata donmemesi yetmez: yazma gercekten olmali ve durum korunmali.
        let (odendi, durum): (i64, String) = c
            .query_row("SELECT odendi, durum FROM appointments WHERE id = ?1", [r.id], |x| {
                Ok((x.get(0)?, x.get(1)?))
            })
            .unwrap();
        assert_eq!(odendi, 1, "iptal edilmis randevuda da odeme yazilmali");
        assert_eq!(durum, "iptal", "odeme isaretlemek durumu degistirmemeli");
    }

    #[test]
    fn odeme_audit_basarisiz_olursa_yazma_geri_alinir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        c.execute_batch("DROP TABLE audit_log").unwrap();
        assert!(odeme_guncelle(&c, r.id, true, Cihaz::Masaustu).is_err());
        let odendi: i64 = c.query_row("SELECT odendi FROM appointments WHERE id = ?1", [r.id], |x| x.get(0)).unwrap();
        assert_eq!(odendi, 0, "log yazilamadiysa odeme de yazilmamali");
    }
}
