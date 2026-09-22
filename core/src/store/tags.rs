//! Etiket deposu (Görev 4) — seansın resmî notuna atanan serbest metin
//! etiketler ("kaygı", "aile", "ilaç değişimi").
//!
//! # KRİTİK: Etiket ADI erişim loguna ASLA yazılmaz
//!
//! Etiket adı KVKK açısından not içeriği kadar hassastır — "kriz", "ilaç
//! değişimi" gibi bir sınıflandırma tek başına özel nitelikli sağlık
//! verisidir. `store::audit` modül başlığındaki kural burada da aynen
//! geçerlidir: bu modüldeki her `kaydet` çağrısı yalnızca (eylem, varlık,
//! varlık **kimliği**, cihaz) taşır — `ad` hiçbir zaman `varlik_id` ya da
//! `ayrinti` olarak geçirilmez. `etiketli_seanslar`'ın denetim satırı bile
//! `tag_id` (kimlik) taşır, etiketin ADINI değil.
//!
//! # Hacim: `OturumBasi`, `HerCagri` DEĞİL
//!
//! Etiket ekleme/kaldırma, not düzenlemesi gibi sık ve kendi kendini
//! yenileyen bir işlemdir (terapist bir seansta birkaç etiketi art arda
//! deneyip düzeltebilir) — bkz. `store::notes` modül başlığındaki aynı
//! muhakeme: `HerCagri` seçilseydi ekleme/kaldırma denemeleri silinemez log
//! satırları biriktirirdi. Bu yüzden hem ekleme/kaldırma hem görüntüleme
//! yolları `LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK)` kullanır.
//! `etiket_ekle` ve `etiket_kaldir` BİLEREK AYNI (eylem, varlık, varlık_id)
//! üçlüsünü paylaşır (`Duzenleme`/`progress_note`/appointment_id) — ikisi de
//! sonuçta "bu seansın resmî notu değişti" demektir.
//!
//! # `ad_katli`: Türkçe katlama `search::katla`'dan YENİDEN KULLANILIR
//!
//! "Kaygı", "kaygı" ve "KAYGI" aynı etiket olmalı. Bu katlama kuralı
//! `store::search::katla` içinde zaten tanımlı (SQL tarafındaki `lower()` +
//! 12 `replace()` zincirinin Rust karşılığı); burada İKİNCİ bir katlama
//! fonksiyonu YAZILMAZ — arama ile etiket eşleşmesi ayrışırsa "kaygı"
//! etiketi taşıyan bir seans aramada bulunamayabilir. Fonksiyon bu yüzden
//! `pub(crate)` yapılıp doğrudan çağrılır.
//!
//! # `private_notes`'a hiçbir referans yok
//!
//! Etiketler yalnızca `appointment_id` (seans kimliği) ile tutulur, hangi
//! not türüne değil — şema bunu `progress_note_tags`'in yalnızca
//! `appointments(id)`'e bağlı olmasıyla yapısal olarak zorlar. Özel not
//! yapısal olarak etiket ALAMAZ: bu modülde `private_notes` tablosu hiç
//! geçmez ve workspace-geneli yapısal tarama
//! (`search.rs::workspace_genelinde_ozel_not_yalnizca_izinli_modullerde_gecer`,
//! kök `Cargo.toml`'daki `members`'tan türetilir) bu dosyayı otomatik
//! kapsar — yeni bir dosya eklendiğinde izin listesine elle eklenmesi
//! GEREKMEZ.
//!
//! # `Debug` elle yazılır
//!
//! `Etiket.ad` ve `EtiketliSeans.danisan_adi`/`baslangic` türetilmiş
//! `Debug`'la basılırsa (bu kod tabanında dört kez tekrarlanan bulgu, bkz.
//! `audit::Ayrinti`, `notes::SeansNotu`, `clients::Danisan`,
//! `danisan_seanslari::DanisanSeansi`) bir panik mesajına ya da loga ham
//! hâliyle düşebilirdi; ikisi de elle yazılır ve hassas alanlar `<gizli>`
//! basılır.

use crate::store::audit::{kaydet, Cihaz, Eylem, LogHacmi, BIRLESTIRME_PENCERESI_DK};
use crate::store::clients::DepoHatasi;
use crate::store::search::katla;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

/// `audit_log.varlik` değeri — etiket ekleme/kaldırma ve seansın etiket
/// listesi görüntülemesi. Resmî notla (`notes.rs`'teki `VARLIK_RESMI`,
/// `"progress_note"`) BİLEREK AYNI: brief'in denetim tablosu bu iki işlemi
/// resmî nota ait sayar — etiket resmî nota bağlıdır, ayrı bir "not" değil.
const VARLIK_NOT: &str = "progress_note";
/// `audit_log.varlik` değeri — bir etiketi taşıyan seansların listesi.
/// `tag_id` (kimlik) taşır, etiket ADI asla değil.
const VARLIK_ETIKET: &str = "etiket";

/// Etiket adının izin verilen uzunluk aralığı, KARAKTER cinsinden (bayt
/// değil — bkz. genel proje kısıtı "metin kırpmaları karakter üzerinden").
const AD_ASGARI: usize = 1;
const AD_AZAMI: usize = 40;

/// Sözlükteki tek bir etiket. `kullanim`, o etiketin kaç seansa bağlı
/// olduğudur (otomatik tamamlama listesini kullanım sıklığına göre
/// sıralamak için).
#[derive(Clone, Serialize)]
pub struct Etiket {
    pub id: i64,
    pub ad: String,
    pub kullanim: i64,
}

impl std::fmt::Debug for Etiket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Etiket")
            .field("id", &self.id)
            .field("ad", &"<gizli>")
            .field("kullanim", &self.kullanim)
            .finish()
    }
}

/// Bir etiketi taşıyan tek bir seans (etiket dosyası ekranı için).
#[derive(Clone, Serialize)]
pub struct EtiketliSeans {
    pub appointment_id: i64,
    /// YETKİLİ kaynak `appointments.client_id`'dir — notta/etikette bir
    /// kopyası TUTULMAZ; randevu başka danışana taşınırsa sorgu (JOIN)
    /// yeni danışanı gösterir (bkz. `notes.rs`/`danisan_seanslari.rs` ile
    /// aynı bulgu ve aynı gerekçe).
    pub client_id: i64,
    pub danisan_adi: String,
    pub baslangic: String,
}

impl std::fmt::Debug for EtiketliSeans {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EtiketliSeans")
            .field("appointment_id", &self.appointment_id)
            .field("client_id", &"<gizli>")
            .field("danisan_adi", &"<gizli>")
            .field("baslangic", &"<gizli>")
            .finish()
    }
}

/// Ad dizgisini normalleştirir: baş/son boşluk atılır, iç boşluklar tek
/// boşluğa indirilir (`split_whitespace` ikisini birden yapar). Doğrulamadan
/// ÖNCE çağrılır ki `"kaygı "` ile `"kaygı"` aynı ada normalleşsin ve aynı
/// satır veritabanına yazılsın.
fn normallesmis_ad(ad: &str) -> String {
    ad.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Normalleşmiş adın 1-40 KARAKTER (`chars().count()`, bayt değil)
/// aralığında olduğunu doğrular; aksi hâlde `DepoHatasi::GecersizVeri`.
/// Sınır veritabanı `CHECK (length(ad) BETWEEN 1 AND 40)` ile de tutulur
/// (SQLite'ta TEXT için `length()` karakter sayar) — burasi kullanıcıya
/// anlaşılır bir hata mesajı vermek için ÖNDEN yapılan aynı kontrol
/// (`notes::not_kaydet`'teki şablon doğrulamasıyla aynı desen).
fn ad_dogrula(ad: &str) -> Result<String, DepoHatasi> {
    let normal = normallesmis_ad(ad);
    let uzunluk = normal.chars().count();
    if !(AD_ASGARI..=AD_AZAMI).contains(&uzunluk) {
        return Err(DepoHatasi::GecersizVeri(format!(
            "etiket adi {AD_ASGARI}-{AD_AZAMI} karakter olmali (verilen: {uzunluk})"
        )));
    }
    Ok(normal)
}

fn randevu_var_mi(conn: &Connection, appointment_id: i64) -> Result<bool, DepoHatasi> {
    let var: Option<i64> = conn
        .query_row("SELECT id FROM appointments WHERE id = ?1", [appointment_id], |r| r.get(0))
        .optional()?;
    Ok(var.is_some())
}

/// Bütün etiketler, en çok kullanılandan aza (eşitlikte katlanmış ada göre
/// belirlenebilir bir sıra). Danışana bağlı veri DÖNDÜRMEZ — yalnızca
/// sözlük — bu yüzden denetime hiç yazmaz (bkz. brief denetim tablosu:
/// `etiketleri_listele` satırı boş).
///
/// `_cihaz`: imza brief'teki diğer etiket fonksiyonlarıyla simetrik tutulur
/// (çağıran taraf tek bir tip üzerinden geçer), ama bu fonksiyon hiçbir
/// audit satırı yazmadığı için parametre kullanılmaz.
pub fn etiketleri_listele(conn: &Connection, _cihaz: Cihaz) -> Result<Vec<Etiket>, DepoHatasi> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.ad, COUNT(pt.appointment_id) AS kullanim
           FROM tags t
           LEFT JOIN progress_note_tags pt ON pt.tag_id = t.id
          GROUP BY t.id, t.ad
          ORDER BY kullanim DESC, t.ad_katli ASC",
    )?;
    let etiketler = stmt
        .query_map([], |r| Ok(Etiket { id: r.get(0)?, ad: r.get(1)?, kullanim: r.get(2)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(etiketler)
}

/// Bir seansın etiketleri, ada göre (katlanmış ada göre sıralanır — kullanıcı
/// görünümü aynı kalır, sıralama Türkçe harf sırasından bağımsız kararlı
/// olur).
///
/// Log: `goruntuleme` / `progress_note` / randevu kimliği, birleştirilerek
/// (bkz. modül başlığı).
pub fn seans_etiketleri(
    conn: &Connection,
    appointment_id: i64,
    cihaz: Cihaz,
) -> Result<Vec<Etiket>, DepoHatasi> {
    if !randevu_var_mi(conn, appointment_id)? {
        return Err(DepoHatasi::Bulunamadi);
    }

    let mut stmt = conn.prepare(
        "SELECT t.id, t.ad,
                (SELECT COUNT(*) FROM progress_note_tags pt2 WHERE pt2.tag_id = t.id) AS kullanim
           FROM tags t
           JOIN progress_note_tags pt ON pt.tag_id = t.id
          WHERE pt.appointment_id = ?1
          ORDER BY t.ad_katli ASC",
    )?;
    let etiketler = stmt
        .query_map([appointment_id], |r| {
            Ok(Etiket { id: r.get(0)?, ad: r.get(1)?, kullanim: r.get(2)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    // Log ONCEDEN OKUNAN varliktan SONRA: olmayan bir randevu kimligi
    // (dogrudan kullanici girdisi) silinemez bir satir birakmasin (bkz.
    // `notes::danisan_notlari` ile ayni gerekce).
    kaydet(
        conn,
        Eylem::Goruntuleme,
        VARLIK_NOT,
        &appointment_id.to_string(),
        cihaz,
        None,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;
    Ok(etiketler)
}

/// Seansa etiket koyar; aynı katlanmış adla etiket varsa onu kullanır, yoksa
/// oluşturur. Yazma + log **tek transaction**'da (desen `notes::not_kaydet`
/// ile aynı) — log başarısız olursa etiket bağı da geri alınır.
///
/// Aynı etiket aynı seansa iki kez eklenirse (`ON CONFLICT ... DO NOTHING`)
/// hata VERMEZ, idempotenttir: terapist aynı etikete iki kez tıklarsa ikinci
/// tıklama sessizce no-op'tur.
pub fn etiket_ekle(
    conn: &Connection,
    appointment_id: i64,
    ad: &str,
    cihaz: Cihaz,
) -> Result<Etiket, DepoHatasi> {
    let normal = ad_dogrula(ad)?;
    if !randevu_var_mi(conn, appointment_id)? {
        return Err(DepoHatasi::Bulunamadi);
    }
    let katli = katla(&normal);

    let tx = conn.unchecked_transaction()?;

    // Ayni katlanmis adla etiket VARSA onu kullan -- gorunen ad ILK
    // yazildigi haliyle kalir ("Kaygi" once eklendiyse sonraki "kaygi"
    // cagrisi gorunumu degistirmez, yalnizca ayni id'ye baglanir). YOKSA
    // yeni satir olusturulur.
    tx.execute(
        "INSERT INTO tags (ad, ad_katli) VALUES (?1, ?2)
         ON CONFLICT(ad_katli) DO NOTHING",
        rusqlite::params![normal, katli],
    )?;
    let (tag_id, gorunen_ad): (i64, String) = tx
        .query_row("SELECT id, ad FROM tags WHERE ad_katli = ?1", [&katli], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })?;

    tx.execute(
        "INSERT INTO progress_note_tags (appointment_id, tag_id) VALUES (?1, ?2)
         ON CONFLICT(appointment_id, tag_id) DO NOTHING",
        rusqlite::params![appointment_id, tag_id],
    )?;

    let kullanim: i64 = tx.query_row(
        "SELECT COUNT(*) FROM progress_note_tags WHERE tag_id = ?1",
        [tag_id],
        |r| r.get(0),
    )?;

    // Etiket ekleme/kaldirma NOT DUZENLEMESI gibi sik bir islem -- ayni
    // (eylem, varlik, varlik_id) uclusuyle `etiket_kaldir` ile PAYLASILIR
    // (bkz. modul basligi). Etiket ADI buraya ASLA gecmez.
    kaydet(
        &tx,
        Eylem::Duzenleme,
        VARLIK_NOT,
        &appointment_id.to_string(),
        cihaz,
        None,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;

    tx.commit()?;
    Ok(Etiket { id: tag_id, ad: gorunen_ad, kullanim })
}

/// Seanstan etiketi kaldırır; etiket artık hiçbir seansta kullanılmıyorsa
/// sözlükten de silinir. Gerekçe: kullanılmayan bir etiketin otomatik
/// tamamlamada asılı kalması `etiketleri_listele`'yi zamanla artık hiçbir
/// seansa bağlı olmayan girdilerle doldururdu -- terapistin "bu etiketi bir
/// daha görmeyeceğim" beklentisiyle çelişir.
pub fn etiket_kaldir(
    conn: &Connection,
    appointment_id: i64,
    tag_id: i64,
    cihaz: Cihaz,
) -> Result<(), DepoHatasi> {
    if !randevu_var_mi(conn, appointment_id)? {
        return Err(DepoHatasi::Bulunamadi);
    }

    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "DELETE FROM progress_note_tags WHERE appointment_id = ?1 AND tag_id = ?2",
        rusqlite::params![appointment_id, tag_id],
    )?;

    let kalan: i64 = tx.query_row(
        "SELECT COUNT(*) FROM progress_note_tags WHERE tag_id = ?1",
        [tag_id],
        |r| r.get(0),
    )?;
    if kalan == 0 {
        // Son kullanimda sozlukten de sil (bkz. fonksiyon dokumantasyonu).
        tx.execute("DELETE FROM tags WHERE id = ?1", [tag_id])?;
    }

    kaydet(
        &tx,
        Eylem::Duzenleme,
        VARLIK_NOT,
        &appointment_id.to_string(),
        cihaz,
        None,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;

    tx.commit()?;
    Ok(())
}

/// Bir etiketi taşıyan seanslar, yeniden eskiye (`baslangic DESC, id DESC` —
/// ikincil anahtar aynı dakikaya denk gelen seansları belirlenebilir kılar,
/// desen `danisan_seanslari.rs`/`notes.rs` ile aynı).
///
/// Log: `varlik_id` **tag_id**'dir (kimlik), etiket ADI değil (bkz. modül
/// başlığı).
pub fn etiketli_seanslar(
    conn: &Connection,
    tag_id: i64,
    cihaz: Cihaz,
) -> Result<Vec<EtiketliSeans>, DepoHatasi> {
    // Once varlik kontrolu, SONRA log: olmayan bir tag_id silinemez bir
    // satir birakmasin (bkz. `notes::danisan_notlari` ile ayni gerekce).
    let var: Option<i64> =
        conn.query_row("SELECT id FROM tags WHERE id = ?1", [tag_id], |r| r.get(0)).optional()?;
    if var.is_none() {
        return Err(DepoHatasi::Bulunamadi);
    }

    // client_id VE danisan_adi YETKILI kaynaktan (appointments/clients)
    // okunur, notta/etikette tutulan bir kopyadan DEGIL (bkz. modul
    // basligi).
    let mut stmt = conn.prepare(
        "SELECT a.id, a.client_id, c.ad_soyad, a.baslangic
           FROM progress_note_tags pt
           JOIN appointments a ON a.id = pt.appointment_id
           JOIN clients c ON c.id = a.client_id
          WHERE pt.tag_id = ?1
          ORDER BY a.baslangic DESC, a.id DESC",
    )?;
    let seanslar = stmt
        .query_map([tag_id], |r| {
            Ok(EtiketliSeans {
                appointment_id: r.get(0)?,
                client_id: r.get(1)?,
                danisan_adi: r.get(2)?,
                baslangic: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    kaydet(
        conn,
        Eylem::Goruntuleme,
        VARLIK_ETIKET,
        &tag_id.to_string(),
        cihaz,
        None,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;
    Ok(seanslar)
}

#[cfg(test)]
mod testler {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{
        appointments::{
            guncelle as randevu_guncelle, olustur as randevu_olustur, RandevuGuncelleme,
            YeniRandevu,
        },
        audit::son_kayitlar,
        clients::{ekle as danisan_ekle, YeniDanisan},
        db::open_encrypted,
        schema::migrate,
    };

    fn kurulum() -> (tempfile::TempDir, rusqlite::Connection) {
        let dir = tempfile::tempdir().unwrap();
        let c = open_encrypted(&dir.path().join("v.db"), &generate_data_key()).unwrap();
        migrate(&c).unwrap();
        (dir, c)
    }

    fn danisan(c: &rusqlite::Connection, ad: &str) -> i64 {
        danisan_ekle(c, &YeniDanisan { ad_soyad: ad.into(), telefon: None }, Cihaz::Masaustu)
            .unwrap()
            .id
    }

    /// Verilen başlangıçla bir saatlik randevu açar.
    fn randevu(c: &rusqlite::Connection, cid: i64, baslangic: &str) -> i64 {
        let saat: i32 = baslangic[11..13].parse().unwrap();
        randevu_olustur(
            c,
            &YeniRandevu {
                client_id: cid,
                baslangic: baslangic.into(),
                bitis: format!("{}{:02}{}", &baslangic[..11], saat + 1, &baslangic[13..]),
                ucret: None,
            },
            Cihaz::Masaustu,
        )
        .unwrap()
        .id
    }

    /// Randevuyu başka bir danışana taşır; diğer alanlar korunur (desen
    /// `danisan_seanslari.rs::randevu_danisani_degistir` ile aynı).
    fn randevu_danisani_degistir(c: &rusqlite::Connection, rid: i64, yeni_danisan: i64) {
        let (baslangic, bitis, ucret): (String, String, Option<i64>) = c
            .query_row(
                "SELECT baslangic, bitis, ucret FROM appointments WHERE id = ?1",
                [rid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        randevu_guncelle(
            c,
            rid,
            &RandevuGuncelleme { client_id: yeni_danisan, baslangic, bitis, ucret },
            Cihaz::Masaustu,
        )
        .unwrap();
    }

    fn log_sayisi(c: &rusqlite::Connection, eylem: &str, varlik: &str, varlik_id: &str) -> i64 {
        c.query_row(
            "SELECT COUNT(*) FROM audit_log WHERE eylem=?1 AND varlik=?2 AND varlik_id=?3",
            [eylem, varlik, varlik_id],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// Denetim kaydındaki TÜM satırların, sızıntı taramasına uygun tek bir
    /// metne birleştirilmiş hâli (desen `danisan_seanslari.rs` ile aynı).
    fn tum_log_metni(c: &rusqlite::Connection) -> String {
        son_kayitlar(c, 1000)
            .unwrap()
            .into_iter()
            .map(|k| format!("{} {} {} {} {:?}", k.eylem, k.varlik, k.varlik_id, k.cihaz, k.ayrinti))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn ayni_etiket_buyuk_kucuk_harf_ve_bosluktan_bagimsiz_ayni_kimlige_gider() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let r1 = randevu(&c, cid, "2026-09-07T10:00");
        let r2 = randevu(&c, cid, "2026-09-14T10:00");
        let r3 = randevu(&c, cid, "2026-09-21T10:00");
        let r4 = randevu(&c, cid, "2026-09-28T10:00");

        let e1 = etiket_ekle(&c, r1, "Kaygı", Cihaz::Masaustu).unwrap();
        let e2 = etiket_ekle(&c, r2, "kaygı", Cihaz::Masaustu).unwrap();
        let e3 = etiket_ekle(&c, r3, "KAYGI", Cihaz::Masaustu).unwrap();
        let e4 = etiket_ekle(&c, r4, "Kaygı ", Cihaz::Masaustu).unwrap();

        assert_eq!(e1.id, e2.id, "kaygi/Kaygi ayni etiket kimligine gitmeli");
        assert_eq!(e1.id, e3.id, "KAYGI ayni etiket kimligine gitmeli");
        assert_eq!(e1.id, e4.id, "sondaki boslukla yazilan da ayni kimlige gitmeli");

        let toplam: i64 = c.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0)).unwrap();
        assert_eq!(toplam, 1, "dort farkli yazim TEK etiket satirinda kalmali");
    }

    #[test]
    fn bos_ve_uzun_ad_reddedilir_cok_baytli_kirk_karakter_kabul_edilir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");

        assert!(
            matches!(etiket_ekle(&c, rid, "", Cihaz::Masaustu), Err(DepoHatasi::GecersizVeri(_))),
            "bos ad reddedilmeli"
        );
        assert!(
            matches!(etiket_ekle(&c, rid, "   ", Cihaz::Masaustu), Err(DepoHatasi::GecersizVeri(_))),
            "yalnizca bosluktan olusan ad reddedilmeli"
        );

        let kirk_bir = "a".repeat(41);
        assert!(
            matches!(
                etiket_ekle(&c, rid, &kirk_bir, Cihaz::Masaustu),
                Err(DepoHatasi::GecersizVeri(_))
            ),
            "41 karakterlik ad reddedilmeli"
        );

        // KASTEN COK BAYTLI: 'ş' UTF-8'de 2 bayttir. Bayt-eksenli bir sinir
        // ("uzunluk <= 40" byte len ile yazilsaydi) bu adi 80 bayt sayardi
        // ve yanlislikla reddederdi (bkz. `danisan_seanslari.rs`'teki ayni
        // sinif bulgu).
        let cok_baytli_kirk = "ş".repeat(40);
        let sonuc = etiket_ekle(&c, rid, &cok_baytli_kirk, Cihaz::Masaustu).unwrap();
        assert_eq!(sonuc.ad.chars().count(), 40, "40 karakterlik cok baytli ad kabul edilmeli");
    }

    #[test]
    fn son_kullanimda_sozlukten_silinir_baska_seansta_kullanilan_silinmez() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let r1 = randevu(&c, cid, "2026-09-07T10:00");
        let r2 = randevu(&c, cid, "2026-09-14T10:00");

        let e1 = etiket_ekle(&c, r1, "aile", Cihaz::Masaustu).unwrap();
        etiket_ekle(&c, r2, "aile", Cihaz::Masaustu).unwrap();

        etiket_kaldir(&c, r1, e1.id, Cihaz::Masaustu).unwrap();
        let hala_var: i64 =
            c.query_row("SELECT COUNT(*) FROM tags WHERE id=?1", [e1.id], |r| r.get(0)).unwrap();
        assert_eq!(hala_var, 1, "baska seansta hala kullanilan etiket silinmemeli");

        etiket_kaldir(&c, r2, e1.id, Cihaz::Masaustu).unwrap();
        let kaldi: i64 =
            c.query_row("SELECT COUNT(*) FROM tags WHERE id=?1", [e1.id], |r| r.get(0)).unwrap();
        assert_eq!(kaldi, 0, "son kullanimda etiket sozlukten silinmeli");
    }

    #[test]
    fn randevu_silinince_etiket_bagi_da_silinir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");
        etiket_ekle(&c, rid, "kriz", Cihaz::Masaustu).unwrap();

        let bag_once: i64 =
            c.query_row("SELECT COUNT(*) FROM progress_note_tags", [], |r| r.get(0)).unwrap();
        assert_eq!(bag_once, 1, "on kosul: bag gercekten olusmus olmali");

        c.execute("DELETE FROM appointments WHERE id=?1", [rid]).unwrap();

        let bag_sonra: i64 =
            c.query_row("SELECT COUNT(*) FROM progress_note_tags", [], |r| r.get(0)).unwrap();
        assert_eq!(bag_sonra, 0, "randevu silinince etiket bagi da silinmeli (ON DELETE CASCADE)");
    }

    #[test]
    fn etiketli_seanslar_client_id_yi_yetkili_kaynaktan_okur() {
        // Plan 3'te bulunan gercek hata sinifi (notes.rs/danisan_seanslari.rs
        // modul basliklarinda anlatilan) burada da gecerli: randevu baska
        // danisana tasinirsa `etiketli_seanslar` YENI danisani gostermeli.
        let (_d, c) = kurulum();
        let ayse = danisan(&c, "Ayse");
        let mehmet = danisan(&c, "Mehmet");
        let rid = randevu(&c, ayse, "2026-09-07T10:00");
        let e = etiket_ekle(&c, rid, "aile", Cihaz::Masaustu).unwrap();

        let once = etiketli_seanslar(&c, e.id, Cihaz::Masaustu).unwrap();
        assert_eq!(once[0].client_id, ayse);
        assert_eq!(once[0].danisan_adi, "Ayse");

        randevu_danisani_degistir(&c, rid, mehmet);

        let sonra = etiketli_seanslar(&c, e.id, Cihaz::Masaustu).unwrap();
        assert_eq!(
            sonra[0].client_id, mehmet,
            "randevu tasininca etiketli seans yeni danisani gostermeli"
        );
        assert_eq!(sonra[0].danisan_adi, "Mehmet");
    }

    #[test]
    fn etiketli_seanslar_baslangica_gore_yeniden_eskiye_siralanir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        // EKLEME SIRASI kasten tarih sirasinin tersi degil, KARISIK (bkz.
        // `danisan_seanslari.rs`'teki ayni desen: kurulum sirasi siralama
        // anahtarini gorunmez kilmamali).
        let orta = randevu(&c, cid, "2026-09-14T10:00");
        let en_yeni = randevu(&c, cid, "2026-09-21T10:00");
        let en_eski = randevu(&c, cid, "2026-09-07T10:00");

        let e = etiket_ekle(&c, orta, "kaygi", Cihaz::Masaustu).unwrap();
        etiket_ekle(&c, en_yeni, "kaygi", Cihaz::Masaustu).unwrap();
        etiket_ekle(&c, en_eski, "kaygi", Cihaz::Masaustu).unwrap();

        let liste = etiketli_seanslar(&c, e.id, Cihaz::Masaustu).unwrap();
        let sira: Vec<i64> = liste.iter().map(|s| s.appointment_id).collect();
        assert_eq!(sira, vec![en_yeni, orta, en_eski]);
    }

    #[test]
    fn etiket_adi_denetim_kaydina_hicbir_bicimde_girmez() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");

        let e = etiket_ekle(&c, rid, "ÇOKGİZLİETİKET", Cihaz::Masaustu).unwrap();
        seans_etiketleri(&c, rid, Cihaz::Masaustu).unwrap();
        etiketli_seanslar(&c, e.id, Cihaz::Masaustu).unwrap();
        etiketleri_listele(&c, Cihaz::Masaustu).unwrap();
        etiket_kaldir(&c, rid, e.id, Cihaz::Masaustu).unwrap();

        let log = tum_log_metni(&c);
        assert!(!log.is_empty(), "on kosul: denetlenecek log satiri olmali");
        assert!(!log.contains("ÇOKGİZLİETİKET"), "ham etiket adi loga sizmis: {log}");
        // Katlanmis hali de (search.rs'teki emsal test gibi) aranir.
        assert!(!log.contains("cokgizlietiket"), "katlanmis etiket adi loga sizmis: {log}");
        assert!(!log.contains("COKGIZLIETIKET"));
    }

    #[test]
    fn otuz_ekle_kaldir_ayni_seans_icin_tam_olarak_bir_duzenleme_satiri_uretir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");

        for i in 0..30 {
            let e = etiket_ekle(&c, rid, &format!("etiket{i}"), Cihaz::Masaustu).unwrap();
            etiket_kaldir(&c, rid, e.id, Cihaz::Masaustu).unwrap();
        }

        assert_eq!(
            log_sayisi(&c, "duzenleme", "progress_note", &rid.to_string()),
            1,
            "30 ardisik ekle/kaldir cagrisi TAM OLARAK 1 duzenleme satiri uretmeli"
        );
    }

    #[test]
    fn pencere_disindaki_eski_satir_yeni_etiket_kaydini_susturmaz() {
        // Hacim testinin "cok az" yonu (desen `notes.rs`'teki
        // `pencere_disindaki_satir_...` ile ayni): pencere bir yila
        // cikarilsaydi bu test kirilirdi ama "otuz cagri tek satir" testi
        // hicbir sey fark etmezdi.
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");

        let zaman = (time::OffsetDateTime::now_utc() - time::Duration::minutes(10))
            .replace_nanosecond(0)
            .unwrap()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap();
        c.execute(
            "INSERT INTO audit_log (olay_zamani, eylem, varlik, varlik_id, cihaz, ayrinti)
             VALUES (?1, 'duzenleme', 'progress_note', ?2, 'masaustu', NULL)",
            rusqlite::params![zaman, rid.to_string()],
        )
        .unwrap();

        etiket_ekle(&c, rid, "aile", Cihaz::Masaustu).unwrap();

        assert_eq!(
            log_sayisi(&c, "duzenleme", "progress_note", &rid.to_string()),
            2,
            "pencere disindaki eski satir yeni kaydi susturmamali -- pencere zamana bagli olmali"
        );
    }

    #[test]
    fn bilinmeyen_seansa_etiket_eklenemez_ve_kaldirilamaz() {
        let (_d, c) = kurulum();
        assert!(matches!(
            etiket_ekle(&c, 999, "aile", Cihaz::Masaustu).unwrap_err(),
            DepoHatasi::Bulunamadi
        ));
        assert!(matches!(
            etiket_kaldir(&c, 999, 1, Cihaz::Masaustu).unwrap_err(),
            DepoHatasi::Bulunamadi
        ));
        assert!(matches!(
            seans_etiketleri(&c, 999, Cihaz::Masaustu).unwrap_err(),
            DepoHatasi::Bulunamadi
        ));
    }

    #[test]
    fn bilinmeyen_etiket_bulunamadi_doner_log_yazilmaz() {
        let (_d, c) = kurulum();
        let once = son_kayitlar(&c, 1000).unwrap().len();
        assert!(matches!(
            etiketli_seanslar(&c, 999, Cihaz::Masaustu).unwrap_err(),
            DepoHatasi::Bulunamadi
        ));
        assert_eq!(
            son_kayitlar(&c, 1000).unwrap().len(),
            once,
            "olmayan etiket kimligi silinemez bir log satiri birakmamali"
        );
    }

    #[test]
    fn debug_ciktisi_etiket_adini_ve_danisan_bilgisini_basmaz() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");
        let e = etiket_ekle(&c, rid, "COK_GIZLI_AD", Cihaz::Masaustu).unwrap();
        let etiket_debug = format!("{e:?}");
        assert!(!etiket_debug.contains("COK_GIZLI_AD"));

        let seans = etiketli_seanslar(&c, e.id, Cihaz::Masaustu).unwrap();
        let seans_debug = format!("{:?}", seans[0]);
        assert!(!seans_debug.contains("Ayse"));
        assert!(!seans_debug.contains("2026-09-07"));
    }

    #[test]
    fn etiketleri_listele_kullanima_gore_azalan_sirali_doner() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let r1 = randevu(&c, cid, "2026-09-07T10:00");
        let r2 = randevu(&c, cid, "2026-09-14T10:00");
        let r3 = randevu(&c, cid, "2026-09-21T10:00");

        let cok = etiket_ekle(&c, r1, "cok kullanilan", Cihaz::Masaustu).unwrap();
        etiket_ekle(&c, r2, "cok kullanilan", Cihaz::Masaustu).unwrap();
        let az = etiket_ekle(&c, r3, "az kullanilan", Cihaz::Masaustu).unwrap();

        let liste = etiketleri_listele(&c, Cihaz::Masaustu).unwrap();
        let konum = |id: i64| liste.iter().position(|e| e.id == id).unwrap();
        assert!(konum(cok.id) < konum(az.id), "cok kullanilan etiket once gelmeli");
        assert_eq!(liste[konum(cok.id)].kullanim, 2);
        assert_eq!(liste[konum(az.id)].kullanim, 1);
    }

    #[test]
    fn etiketleri_listele_ve_seans_etiketleri_denetime_yazmaz() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");
        etiket_ekle(&c, rid, "aile", Cihaz::Masaustu).unwrap();
        let once = son_kayitlar(&c, 1000).unwrap().len();

        for _ in 0..10 {
            etiketleri_listele(&c, Cihaz::Masaustu).unwrap();
        }

        assert_eq!(
            son_kayitlar(&c, 1000).unwrap().len(),
            once,
            "etiketleri_listele sozluk donduruyor, danisana bagli veri degil -- hic loglanmamali"
        );
    }
}
