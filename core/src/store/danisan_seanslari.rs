//! Danışanın seans listesi (Plan 5 Görev 4).
//!
//! # Ürün boşluğu: `danisan_notlari` yalnızca NOTLARI döndürüyordu
//!
//! Terapist bir danışana tıkladığında bu ana kadar dönen tek liste
//! `notes::danisan_notlari` idi ve o sorgu `progress_notes`'tan başlıyordu
//! (`JOIN appointments`). Notu yazılmamış bir randevu o sorguda **hiç
//! görünmüyordu** -- yani "notunu yazmayı unuttuğum seans" tam da görünmesi
//! gereken yerde yoktu. Bu modül tersini yapar: sorgu `appointments`'tan
//! başlar ve `progress_notes`'a `LEFT JOIN` ile bakar, böylece notu olan da
//! olmayan da aynı listede yer alır.
//!
//! # KRİTİK: danışan filtresi `appointments.client_id` üzerinden, notun
//! kopyasından DEĞİL
//!
//! `progress_notes.client_id` denormalize bir kopyadır; yetkili kaynak
//! randevunun kendisidir. `appointments::guncelle` bir randevuyu başka bir
//! danışana taşıyabilir ve o yol `progress_notes.client_id`'ye dokunmaz --
//! aynı bulgu `notes::danisan_notlari` modül başlığında da var (Plan 3'te
//! bulunmuş gerçek bir hata). Filtre kopyadan yapılsaydı randevu yanlış
//! danışana girilip düzeltildiğinde notun tam içeriği eski danışanın
//! dosyasında görünmeye devam ederdi. Bu yüzden hem `WHERE` hem `JOIN` şartı
//! `a.` (randevu) üzerinden okunur, `p.client_id` bu sorguda hiç
//! kullanılmaz.
//!
//! # Sıralama
//!
//! `a.baslangic DESC, a.id DESC` -- en yeni seans en üstte. İkincil anahtar
//! (`a.id`) aynı dakikaya denk gelen iki randevu için sıralamayı
//! belirlenebilir kılar; onsuz SQLite'ın kendi iç sırası (ekleme sırası
//! olabilir de olmayabilir de) görünür hâle gelirdi.
//!
//! # `not_ilk_satiri: Option<String>` -- `None` ile `Some("")` farklı şeyler
//!
//! Not YOKSA `None`; not açılıp boş bırakıldıysa `Some(String::new())`.
//! İkisi karıştırılırsa "bu seansın notu hiç yazılmamış" ile "terapist notu
//! açtı ama içeriği silmiş/boş bıraktı" ekranda ayırt edilemez -- oysa
//! ilki "unutulmuş" bir eylemdir, ikincisi kasıtlı olabilir.
//!
//! # Önizleme kırpması KARAKTER üzerinden
//!
//! `ilk_satir` yalnızca notun ilk satırını (`\n`'e kadar) alır ve
//! `AZAMI_ONIZLEME` **karakterinde** kırpar (`chars().take`, bayt değil).
//! Türkçe harfler (ı, ğ, ş, ö, ü, ç) UTF-8'de çok baytlıdır; bayt üzerinden
//! kırpma bir karakterin ortasından kesip geçersiz UTF-8 üretebilirdi.
//! İkinci satır (ve varsa devamı) SQL sorgusuyla diskten okunur --
//! `p.icerik` sütunu bütünüyle bir `String`'e girer, satır bazında
//! sınırlanmaz. Garanti daha dar: bu fonksiyonun DÖNÜŞ değerine (dolayısıyla
//! `DanisanSeansi`'ye ve JSON yanıtına) yalnızca kırpılmış ilk satır girer;
//! `ilk_satir` çağrısından sonra geri kalanı hiçbir yere taşınmadan düşer.
//!
//! # Denetim kaydı: `OturumBasi`, `HerCagri` DEĞİL
//!
//! Danışan dosyası (Plan 5'in kabuğu) kendi kendini yenileyen bir ekrandır
//! -- `clients::getir`'in aksine (o modülün başlığındaki not: "Plan 3'te
//! danışan dosyası ekranı kendi kendini yenileyen bir yola dönüşürse bu
//! karar o görevde yeniden verilmeli" tam olarak burada karşılığını buldu).
//! `HerCagri` seçilseydi bir dosyayı açık tutmak (arka planda periyodik
//! yenileme) onlarca **silinemez** log satırı biriktirirdi. Kural
//! `store::audit` modül başlığındaki hacim politikasının doğrudan
//! uygulanmasıdır; pencere `BIRLESTIRME_PENCERESI_DK`.
//!
//! `ayrinti` her zaman `None`'dır: not içeriği, başlığı ya da şablon adı bu
//! logun `ayrinti` alanına ASLA yazılmaz (bkz. `store::audit` modül
//! başlığındaki hassas veri kuralı). Log yalnızca "hangi danışanın
//! seansları, ne zaman, hangi cihazdan görüntülendi" sorusunu yanıtlar.
//!
//! # Var olmayan danışan: `Bulunamadi` döner, log YAZILMAZ
//!
//! `notes::danisan_notlari` ile aynı gerekçe: varlık kontrolü olmadan bu
//! fonksiyon, olmayan her `client_id` için ayrı bir birleştirme anahtarı
//! üretir ve bu, dışarıdan (rota `Path<i64>` üzerinden doğrudan kullanıcı
//! girdisi) tetiklenebilen, sınırsız ve silinemez bir gürültü yolu açardı.
//! Bu yüzden önce varlık okunur, yoksa hemen dönülür, log SONRA yazılır.
//!
//! # `ucret_kurus: Option<i64>` -- `NULL` (ücretsiz/girilmemiş) `None` kalır
//!
//! `appointments.ucret` sütunu `NULL` olabilir ve `NULL`'ün anlamı iki
//! şeyden biridir: "ücretsiz seans" ya da "ücret hiç girilmemiş" -- ikisi
//! şema düzeyinde ayırt edilmez (bkz. `schema.rs` ve `appointments` modül
//! başlığı). Kod tabanının geri kalanı bu ayrımı titizlikle TAŞIR, YUTMAZ:
//! `appointments::Randevu.ucret: Option<i64>`, `store::ozet::ay_ozeti`
//! `NULL`'ü toplamlardan bilerek dışlar. Bu alan da aynı kuralı izler:
//! `NULL` `None` olarak döner, `0`'a sadeleştirilmez -- aksi hâlde "ücreti
//! hiç girilmemiş seans" ile "ücreti 0 TL girilmiş seans" JSON'da ayırt
//! edilemez olur ve arayüz "—" (girilmemiş) gösteremez. (İlk sürümde brief'in
//! verdiği `i64` tipi izlenerek bu sadeleştirme yapılmıştı; inceleme
//! bulgusuyla düzeltildi -- brief zaten olmayan bir sütun adı (`ucret_kurus`)
//! varsayıyordu, tipini de birebir izlemek için bir gerekçe yoktu.)
//!
//! # `Debug` elle yazılır
//!
//! `not_ilk_satiri` gerçek not içeriği taşır (kırpılmış olsa da); `baslangic`
//! ise `SeansNotu`/`Randevu` ile aynı gerekçeyle (bir kişinin hangi saatte
//! terapide olduğu tek başına özel nitelikli sağlık verisidir) gizlenir.
//! Türetilmiş `Debug` bu kod tabanında dört kez ham veri sızıntısına yol
//! açtığı için (`DataKey`, `Ayrinti`, `Randevu`, `SeansNotu`) burada da elle
//! yazılır.

use crate::store::audit::{kaydet, Cihaz, Eylem, LogHacmi, BIRLESTIRME_PENCERESI_DK};
use crate::store::clients::DepoHatasi;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

/// Not önizlemesinin azami uzunluğu, KARAKTER cinsinden (bayt değil; bkz.
/// modül başlığı).
pub const AZAMI_ONIZLEME: usize = 120;

/// `audit_log.varlik` değeri -- danışan dosyasının seans listesi
/// görüntülemesi. `notes::danisan_notlari`nın kendi varlık adından
/// (`progress_note`) bilerek ayrı: bu liste yalnızca notları değil,
/// randevunun kendisini de kapsayan farklı bir görünümdür.
const VARLIK: &str = "danisan_seanslari";

/// Danışanın tek bir seansı (randevu + varsa notun ilk satırı).
#[derive(Clone, Serialize)]
pub struct DanisanSeansi {
    pub appointment_id: i64,
    /// `appointments.baslangic` -- YETKİLİ kaynak, notun kopyası değil.
    pub baslangic: String,
    pub durum: String,
    /// `appointments.ucret`'in doğrudan yansıması. `NULL` `None` kalır --
    /// "ücretsiz" ile "ücret girilmemiş" karıştırılmaz (bkz. modül başlığı).
    pub ucret_kurus: Option<i64>,
    pub odendi: bool,
    /// Not YOKSA `None`. Boş metinle ("") karıştırılmaz: "not yazılmamış"
    /// ile "not açılmış ama boş bırakılmış" farklı şeylerdir ve arayüz
    /// ikisini farklı gösterir.
    pub not_ilk_satiri: Option<String>,
}

impl std::fmt::Debug for DanisanSeansi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DanisanSeansi")
            .field("appointment_id", &self.appointment_id)
            .field("baslangic", &"<gizli>")
            .field("durum", &self.durum)
            .field("ucret_kurus", &self.ucret_kurus)
            .field("odendi", &self.odendi)
            .field("not_ilk_satiri", &self.not_ilk_satiri.as_ref().map(|_| "<gizli>"))
            .finish()
    }
}

/// Bir danışanın TÜM seanslarını (notu olsun olmasın) en yeniden eskiye
/// listeler ve görüntülemeyi loglar. Bkz. modül başlığı.
pub fn danisan_seanslari(
    conn: &Connection,
    client_id: i64,
    cihaz: Cihaz,
) -> Result<Vec<DanisanSeansi>, DepoHatasi> {
    // Once varlik kontrolu, SONRA log: olmayan bir danisan kimligi
    // (rotadan dogrudan kullanici girdisi) silinemez bir satir birakmasin
    // (bkz. modul basligi ve `notes::danisan_notlari` ile ayni gerekce).
    let var: Option<i64> = conn
        .query_row("SELECT id FROM clients WHERE id = ?1", [client_id], |r| r.get(0))
        .optional()?;
    if var.is_none() {
        return Err(DepoHatasi::Bulunamadi);
    }

    // LEFT JOIN: notu OLMAYAN randevu da listeye girer -- bu satirin
    // varlik sebebi tam olarak bu (bkz. modul basligindaki urun bosluğu).
    // Filtre VE JOIN `a.` (randevu) uzerinden: `p.client_id` denormalize
    // bir kopyadir ve randevu tasindiginda bayatlar.
    let mut ifade = conn.prepare(
        "SELECT a.id, a.baslangic, a.durum, a.ucret, a.odendi, p.icerik
           FROM appointments a
           LEFT JOIN progress_notes p ON p.appointment_id = a.id
          WHERE a.client_id = ?1
          ORDER BY a.baslangic DESC, a.id DESC",
    )?;
    let liste = ifade
        .query_map([client_id], |s| {
            let icerik: Option<String> = s.get(5)?;
            Ok(DanisanSeansi {
                appointment_id: s.get(0)?,
                baslangic: s.get(1)?,
                durum: s.get(2)?,
                // NULL (ucretsiz/girilmemis) NULL/None olarak KALIR --
                // 0'a sadelestirilmez (bkz. modul basligi).
                ucret_kurus: s.get(3)?,
                odendi: s.get::<_, i64>(4)? != 0,
                not_ilk_satiri: icerik.map(|m| ilk_satir(&m)),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(ifade);

    // Hacim: OturumBasi. Danisan dosyasi kendi kendini yenileyen bir ekran;
    // HerCagri secilseydi bir dosyayi acik tutmak onlarca silinemez satir
    // biriktirirdi (bkz. modul basligi ve `store::audit` hacim politikasi).
    kaydet(
        conn,
        Eylem::Goruntuleme,
        VARLIK,
        &client_id.to_string(),
        cihaz,
        None, // ayrinti YOK: not icerigi/basligi/sablon adi loga asla girmez
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;
    Ok(liste)
}

/// İlk satırı verir ve `AZAMI_ONIZLEME` karakterinde kırpar.
///
/// Kırpma KARAKTER üzerinden: Türkçe harfler çok baytlı, bayt kırpması
/// UTF-8'i ortasından bölerdi (bkz. modül başlığı).
fn ilk_satir(metin: &str) -> String {
    metin.lines().next().unwrap_or("").chars().take(AZAMI_ONIZLEME).collect()
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
        notes::not_kaydet,
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

    /// Randevuyu başka bir danışana taşır; diğer alanlar (saat, ücret)
    /// olduğu gibi korunur. `appointments::guncelle`nin gerçek yolu --
    /// brief'te varsayılan ayrı bir "taşıma" fonksiyonu bu depoda yok.
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

    /// Belirli bir danışan için `goruntuleme`/`VARLIK` log satırı sayısı.
    fn goruntuleme_sayisi(c: &rusqlite::Connection, cid: i64) -> i64 {
        c.query_row(
            "SELECT COUNT(*) FROM audit_log WHERE eylem = 'goruntuleme' AND varlik = ?1 \
             AND varlik_id = ?2",
            rusqlite::params![VARLIK, cid.to_string()],
            |r| r.get(0),
        )
        .unwrap()
    }

    /// Denetim kaydındaki TÜM satırların, sızıntı taramasına uygun tek bir
    /// metne birleştirilmiş hâli.
    fn tum_log_metni(c: &rusqlite::Connection) -> String {
        son_kayitlar(c, 1000)
            .unwrap()
            .into_iter()
            .map(|k| format!("{} {} {} {:?}", k.eylem, k.varlik, k.varlik_id, k.ayrinti))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn notu_olmayan_randevu_da_listede_cikar() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-14T10:00");

        let liste = danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();

        // ASIL KORUMA: `danisan_notlari` yalnizca NOTLARI donduruyordu; notu
        // yazilmamis bir seans o listede hic gorunmuyordu ve "notunu
        // yazmayi unuttugum seans" ekranda yok demekti. LEFT JOIN sart.
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].appointment_id, rid);
        assert_eq!(liste[0].not_ilk_satiri, None);
    }

    #[test]
    fn bos_not_ile_yazilmamis_not_ayrilir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-14T10:00");
        not_kaydet(&c, rid, "serbest", "", Cihaz::Masaustu).unwrap();

        let liste = danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();
        assert_eq!(liste[0].not_ilk_satiri, Some(String::new()));
    }

    #[test]
    fn liste_randevu_tarihine_gore_yeniden_eskiye_siralanir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        // EKLEME SIRASI kasten tarih sirasinin TERSI degil, KARISIK: ekleme
        // sirasina gore donen bir sorgu da, ters siralayan bir sorgu da
        // kirilmali (test kurulumu birincil siralama anahtarini gorunmez
        // kilmamali).
        let orta = randevu(&c, cid, "2026-09-14T10:00");
        let en_yeni = randevu(&c, cid, "2026-09-21T10:00");
        let en_eski = randevu(&c, cid, "2026-09-07T10:00");

        let liste = danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();
        let sira: Vec<i64> = liste.iter().map(|s| s.appointment_id).collect();
        assert_eq!(sira, vec![en_yeni, orta, en_eski]);

        // IKINCIL siralama anahtari (`, a.id DESC`): yukaridaki uc randevunun
        // ucu de FARKLI baslangica sahip, yani `, a.id DESC` silinse bu iddia
        // hala gecerdi (SQLite'in kendi ic sirasi tesaduf eseri tutabilir).
        // AYNI baslangicli iki randevu ekleyip SONRA eklenenin (buyuk id)
        // ONCE gelmesini bekleyerek ikincil anahtari ayrica sinariz.
        let ayni_once = randevu(&c, cid, "2026-09-14T11:00");
        let ayni_sonra = randevu(&c, cid, "2026-09-14T11:00");
        let liste2 = danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();
        let konum = |id: i64| liste2.iter().position(|s| s.appointment_id == id).unwrap();
        assert!(
            konum(ayni_sonra) < konum(ayni_once),
            "ayni baslangicta SONRA eklenen (buyuk id) ONCE gelmeli"
        );
    }

    #[test]
    fn baska_danisanin_seansi_listeye_girmez() {
        let (_d, c) = kurulum();
        let ayse = danisan(&c, "Ayse");
        let mehmet = danisan(&c, "Mehmet");
        randevu(&c, mehmet, "2026-09-14T10:00");

        let liste = danisan_seanslari(&c, ayse, Cihaz::Masaustu).unwrap();
        assert!(liste.is_empty());
    }

    #[test]
    fn randevu_baska_danisana_tasinirsa_not_da_onunla_gider() {
        let (_d, c) = kurulum();
        let ayse = danisan(&c, "Ayse");
        let mehmet = danisan(&c, "Mehmet");
        let rid = randevu(&c, ayse, "2026-09-14T10:00");
        not_kaydet(&c, rid, "serbest", "Ilk satir\nIkinci", Cihaz::Masaustu).unwrap();

        // Randevu Mehmet'e tasinir; `progress_notes.client_id` DENORMALIZE
        // alani bayatlar. Filtre `a.client_id` uzerinden olmali (Plan 3'te
        // bulunan gercek hata, `notes.rs` modul basligindaki aynisi).
        randevu_danisani_degistir(&c, rid, mehmet);

        assert!(danisan_seanslari(&c, ayse, Cihaz::Masaustu).unwrap().is_empty());
        let liste = danisan_seanslari(&c, mehmet, Cihaz::Masaustu).unwrap();
        assert_eq!(liste[0].not_ilk_satiri.as_deref(), Some("Ilk satir"));
    }

    #[test]
    fn ilk_satir_yalnizca_ilk_satirdir_ve_kirpilir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-14T10:00");
        // KASTEN COK BAYTLI: ilk karakter ASCII ('a', 1 bayt), gerisi
        // Turkce 's' (2 bayt/karakter). AZAMI_ONIZLEME (120) bayt sayisi
        // olarak kesilseydi -- `&metin[..120]` gibi bir bayt-eksenli
        // mutasyon -- kesim tam bu 's' dizisinin ORTASINA duserdi (1 + 119
        // bayt = 120. bayt, 2'nin kati DEGIL) ve "byte index is not a char
        // boundary" ile PANIKLER; eski test verisi ("a".repeat(400)) tumu
        // 1 baytlik ASCII oldugu icin bu sinifi hic sinamiyordu -- bayt
        // kirpmasi ayni SAYIDA karakter urettigi icin testi de gecerdi.
        let uzun = format!("a{}", "ş".repeat(400));
        let ikinci_satir = "gizli ikinci satır çok gizli";
        not_kaydet(&c, rid, "serbest", &format!("{uzun}\n{ikinci_satir}"), Cihaz::Masaustu)
            .unwrap();

        let liste = danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();
        let ilk = liste[0].not_ilk_satiri.clone().unwrap();
        assert_eq!(ilk.chars().count(), AZAMI_ONIZLEME);
        assert!(!ilk.contains(ikinci_satir));
        // Kesin karakter sinirindaki tam icerik: bayt-eksenli bir kirpma
        // (hizalama tesaduf tutsa bile) burada FARKLI bir dizgi uretirdi.
        assert_eq!(ilk, format!("a{}", "ş".repeat(AZAMI_ONIZLEME - 1)));
    }

    #[test]
    fn azami_onizleme_sabiti_duz_sayiyla_pinlenir() {
        // Sabit KENDI SAYISIYLA pinlenir: yukaridaki kirpma testi
        // `AZAMI_ONIZLEME`'ye GORELI oldugu icin sabit 10 yapilsa bile o
        // test kendini ayarlar ve yesil kalirdi (`routes::notes` modulundeki
        // ayni sinif bulguyla ayni gerekce).
        assert_eq!(AZAMI_ONIZLEME, 120, "azami onizleme sozlesmesi 120 karakterdir");
    }

    #[test]
    fn liste_okumasi_oturum_basi_loglanir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        for _ in 0..30 {
            danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();
        }
        // TAM OLARAK 1: "en az 1" degil. Pencere 0'a cekilirse kirilir.
        assert_eq!(goruntuleme_sayisi(&c, cid), 1);
    }

    #[test]
    fn log_satiri_not_icerigi_tasimaz() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-14T10:00");
        not_kaydet(&c, rid, "serbest", "COK GIZLI CUMLE", Cihaz::Masaustu).unwrap();
        danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();

        let log = tum_log_metni(&c);
        assert!(!log.contains("COK GIZLI"));
    }

    // --- Brief'in yedi testinin disinda, bu modulun kendi ek koruma
    // testleri: varlik kontrolu, Debug sizintisi ve ucret NULL ayrimi.
    // Brief bunlari istemiyordu ama uculu de `notes.rs`/`clients.rs`/
    // `appointments.rs`'de zaten kurulu, testle korunan kurallarin bu
    // moduldeki birebir karsiligi.

    #[test]
    fn olmayan_danisan_bulunamadi_doner_log_yazilmaz() {
        let (_d, c) = kurulum();
        let once = son_kayitlar(&c, 1000).unwrap().len();
        let hata = danisan_seanslari(&c, 999, Cihaz::Masaustu).unwrap_err();
        assert!(matches!(hata, DepoHatasi::Bulunamadi));
        assert_eq!(
            son_kayitlar(&c, 1000).unwrap().len(),
            once,
            "olmayan danisan kimligi silinemez bir log satiri birakmamali"
        );
    }

    #[test]
    fn ucret_girilmemis_seans_null_doner_girilmis_seans_deger_doner() {
        // Sema duzeyinde `appointments.ucret` NULL "ucretsiz" ile "ucret
        // hic girilmemis"i ayirt etmez; bu fonksiyon o ayrimi YUTMAMALI --
        // `unwrap_or(0)` (eski surum) ya da baska bir sabit deger mutasyonu
        // burada kirilir.
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let bos = randevu(&c, cid, "2026-09-14T10:00"); // yardimci ucret: None acar.
        let dolu = randevu_olustur(
            &c,
            &YeniRandevu {
                client_id: cid,
                baslangic: "2026-09-15T10:00".into(),
                bitis: "2026-09-15T11:00".into(),
                ucret: Some(45000),
            },
            Cihaz::Masaustu,
        )
        .unwrap()
        .id;

        let liste = danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();
        let bul = |id: i64| liste.iter().find(|s| s.appointment_id == id).unwrap();
        assert_eq!(
            bul(bos).ucret_kurus,
            None,
            "ucret girilmemis seans NULL/None kalmali, 0'a sadelesmemeli"
        );
        assert_eq!(bul(dolu).ucret_kurus, Some(45000));
    }

    #[test]
    fn debug_ciktisi_not_icerigini_ve_baslangici_basmaz() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-14T10:00");
        not_kaydet(&c, rid, "serbest", "COK GIZLI ICERIK", Cihaz::Masaustu).unwrap();

        let liste = danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();
        let hata_ayikla = format!("{:?}", liste[0]);
        assert!(!hata_ayikla.contains("COK GIZLI ICERIK"));
        assert!(!hata_ayikla.contains("2026-09-14"));
    }
}
