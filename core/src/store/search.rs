//! Danışan adı ve **resmî** seans notu içeriğinde arama.
//!
//! # KRİTİK: `private_notes` bu modülde HİÇ sorgulanmaz
//!
//! Global kısıt: *özel notlar hiçbir dışa aktarım sorgusuna, hiçbir rapora ve
//! hiçbir liste uç noktasına dahil edilmez; bunu sağlayan tek mekanizma ayrı
//! tablo olmasıdır — bir `WHERE gizli = 0` filtresine güvenilmez, unutulan
//! tek bir sorgu koruma sözünü bozar.*
//!
//! Arama tam olarak o "unutulan tek sorgu"nun en olası adayıdır: bir arama
//! fonksiyonu doğal olarak "her yerde ara" diye yazılır. Bu modülde kural
//! `notes.rs` ile **aynı biçimde** uygulanır — ve gerekçesi de kopyalanır,
//! yalnızca şablonu değil (Plan 2 Görev 4'ün bulgusu: *şablon kopyalandı,
//! arkasındaki muhakeme kopyalanmadı*):
//!
//! - Sorgular **yalnızca** `clients`, `appointments` ve `progress_notes`
//!   tablolarına bakar. Terapistin özel notunu dışarıda bırakan bir `WHERE`
//!   koşulu **yoktur ve olmamalıdır**: dışlayıcı `WHERE` deseni (kod
//!   tabanındaki tek örneği `appointments::cakisanlari_bul`'daki
//!   `durum != 'iptal'`) buraya kopyalanmaz. Özel notun sızmaması bir
//!   filtrenin değil, **sorgunun hangi tabloya baktığının** sonucudur.
//! - Ne `UNION`, ne `JOIN`, ne "bir de şuna bakalım" diye açılmış ikinci bir
//!   sorgu. Üretim kodunda `private_notes` dizgisi **hiç geçmez**; bu
//!   yapısal olarak da test edilir (`kaynak_kodda_private_notes_gecmez`).
//!
//! ## Terapistin kendi araması bile özel notu görmez — neden?
//!
//! "Ama arayan zaten terapistin kendisi, kendi notunu görmesinde ne sakınca
//! var?" sorusunun yanıtı özel notun **tanımındadır**: özel not, *danışana
//! gösterilmeyecek olan* nottur. Arama sonuçları ekranda görünür; ekran
//! görünürken danışan odada olabilir (Ctrl+K hızlı arama tam da seans
//! sırasında, danışanın karşısında kullanılır). Özel notu arama sonucuna
//! koymak, onu kazara gösterilebilir hâle getirir — yani özel not olmaktan
//! çıkarır. Özel nota erişimin tek yolu `notes::ozel_not_getir`'dir: adında
//! `ozel` geçer, tek bir randevuya bağlıdır ve terapist onu bilerek açar.
//!
//! # KRİTİK: FTS5 değil `LIKE` — bu bir performans tercihi değil
//!
//! SQLCipher ile FTS5 birlikte çalışır, ama FTS5 ek indeks tabloları üretir
//! ve o tabloların içeriği aranabilir metnin **kopyasıdır**. Özel notlar
//! indekslenirse "özel not ayrı tablodadır" güvencesi bir tablo sınırı
//! olmaktan çıkıp "indeksi doğru yapılandırdık" vaadine dönüşür — takibi zor,
//! ihlali sessiz. Tek psikologlu bir uygulamada birkaç bin nota `LIKE`
//! yeterince hızlıdır. Performans sorun olursa ayrı bir görevle FTS5'e
//! geçilir ve özel notlar indeks dışında bırakılır.
//!
//! # KRİTİK: ARAMA TERİMİ ERİŞİM LOGUNA ASLA YAZILMAZ
//!
//! `audit_log` tetikleyicilerle korunur: satır güncellenemez, **silinemez**.
//! Bir arama terimi ("intihar", "boşanma", "istismar") tek başına — hangi
//! danışan bağlamına oturduğu bilinmese bile — özel nitelikli sağlık verisi
//! taşır ve oraya düşerse kalıcıdır. Bu yüzden:
//! - `ayrinti` her zaman `None`'dır (`Ayrinti` kapalı bir enum'dur; sorgu
//!   metni taşıyan bir varyant **eklenmez** — bkz. `store::audit` başlığı),
//! - `varlik_id` **sabittir** (`"genel"`), sorgudan türetilmez,
//! - sonuç sayısı da yazılmaz: "kaç sonuç döndü" bilgisi arka arkaya
//!   yapılan aramalarla bir terimin varlığını sızdırabilir.
//!
//! # Hacim kararı: `OturumBasi`, `HerCagri` değil — ve neden loglanıyor
//!
//! `LogHacmi`'nin `Default`'u yoktur; seçim açık yapılmak zorundadır
//! (bkz. `store::audit` başlığı). Arama iki kategorinin tam ortasındadır:
//!
//! - **"Loglanmaz" tarafı:** Ctrl+K hızlı arama gezinme hareketidir ve
//!   kullanıcı yazdıkça (her tuş vuruşunda) çalışır. `HerCagri` seçilseydi
//!   12 harflik bir sorgu 11 silinemez satır üretirdi; `audit`'in kendi
//!   kuralı bunu reddediyor: *denetlenebilir olmayan bir denetim kaydı,
//!   olmayan denetim kaydıyla aynı şeydir.*
//! - **"Loglanır" tarafı:** takvim yenilemesi veya danışan listesinden farklı
//!   olarak arama, **not içeriğini okur** ve **danışan sınırlarını aşar** —
//!   tek çağrıda birden çok kişinin seans notundan parça döndürür. Bu,
//!   "kullanıcı hangi ekranda" bilgisi değil, gerçek bir veri erişimidir;
//!   `clients::getir`'in loglanma gerekçesiyle aynı sınıftadır.
//!
//! Karar: **`LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK)`** — cihaz başına,
//! 5 dakikalık pencere başına en fazla bir satır. Log şunu söyler: *"bu
//! terapist 14:03'te bu cihazdan not içeriğinde arama yaptı."* Bu, hesabı
//! verilebilir en fazla bilgidir.
//!
//! ## Sabit `varlik_id` burada neden gizleme yaratmıyor
//!
//! `notes::danisan_notlari` birleştirme anahtarına `liste:<client_id>` yazar,
//! çünkü sabit bir `"liste"` kimliği **farklı danışanların dosyalarına**
//! erişimi tek satırın arkasına saklardı. Burada aynı şablonu kopyalamak
//! yanlış olurdu ve nedeni şudur: arama belirli bir kaydın açılması değildir;
//! ayırt edici tek bilgi sorgu metnidir ve **o metin zaten hiçbir koşulda
//! loglanamaz**. Yani iki ayrı arama için iki satır yazmak, birbirinin
//! **tıpatıp aynısı** olan iki satır yazmaktır — hiçbir denetim sorusunu
//! yanıtlamaz, yalnızca hacim üretir. Gizlenen bir şey yok; çünkü
//! kaydedilebilir bir ayrım da yok.
//!
//! ## Çok kısa sorgu log yazmaz
//!
//! `ASGARI_SORGU` altındaki bir sorgu hiçbir tabloyu okumaz, dolayısıyla
//! **hiçbir satır yazmaz**. Desen `notes::danisan_notlari` ile aynıdır:
//! *önce kontrol, yoksa dön, sonra logla.* Aksi hâlde Görev 7'de rota
//! açılınca arayüzün her ilk tuş vuruşu (`?q=a`) dışarıdan tetiklenebilir,
//! sınırsız ve **silinemez** bir gürültü yolu açardı.
//!
//! # `%` ve `_` kullanıcı metninde joker değildir
//!
//! `LIKE` deseni doğrudan kullanıcı girdisinden üretilir. Kaçırılmazsa
//! `%` tüm notları, `_` de tek harflik farkları eşleştirir: iki karakterlik
//! bir "arama" tüm veritabanını dökerdi. `like_deseni` `\`, `%` ve `_`
//! karakterlerini `\` ile kaçırır ve sorgular `ESCAPE '\'` kullanır. Sorgu
//! metni **parametre** olarak bağlanır; SQL hiçbir yerde `format!` ile
//! kurulmaz.
//!
//! # Sonuç sınırı — `notes.rs`'ten bilinçli olarak FARKLI
//!
//! `notes::danisan_notlari` limitine karışmaz ("sınırı koymak rotanın işi").
//! Burada karışılır: `limit` `1..=AZAMI_SONUC` aralığına **kırpılır**.
//! Gerekçe: `danisan_notlari` zaten tek bir danışanla sınırlıdır, arama ise
//! tüm veritabanına bakar — sınırsız bir arama, iki harflik bir sorguyla
//! *her danışanın adını ve her notun bir parçasını* tek yanıtta döndürür;
//! bu bir arama değil, toplu dışa aktarımdır. `limit = -1` SQLite'ta
//! "sınırsız" demektir (`notes.rs`'te öğrenilen ders), bu yüzden kırpma alt
//! uçtan da yapılır: negatif veya sıfır bir limit `1`'e çekilir, sessizce
//! "hepsi" anlamına gelmez.
//!
//! # Türkçe katlama (`katla`) — SQL ile Rust aynı sonucu vermek zorundadır
//!
//! SQLite'ın `lower()`'ı ve `LIKE`'ın harf katlaması **yalnızca ASCII**'dir:
//! "KAYGI" ile "kaygi" eşleşir ama "kaygı" ile "kaygi" eşleşmez. Türkçede bu
//! kabul edilemez; `ı/İ/I/i`, `ş/Ş`, `ğ/Ğ`, `ü/Ü`, `ö/Ö`, `ç/Ç` aynı harfin
//! biçimleridir. Bu yüzden hem sorgu (Rust'ta `katla`) hem sütun (SQL'de
//! `lower()` + 12 `replace()`) aynı ASCII biçime katlanır.
//!
//! İki uygulamanın **aynı** kalması bir kısıttır: ayrışırlarsa arama sessizce
//! sonuç bulamaz hâle gelir. Katlama üç yerde geçer (`katla_karakter`,
//! `SORGU_DANISAN`, `SORGU_NOT`) ve davranışsal testlerle her iki sorgu
//! üzerinde ayrı ayrı iki yönlü olarak sabitlenir.
//!
//! `katla_karakter` **1:1**'dir — her karakter tam olarak bir karaktere
//! gider. `parca_cikar` bu değişmezliğe dayanır: katlanmış metindeki eşleşme
//! konumu, ham metindeki karakter konumuyla aynıdır.

use crate::store::audit::{kaydet, Cihaz, Eylem, LogHacmi, BIRLESTIRME_PENCERESI_DK};
use crate::store::clients::DepoHatasi;
use rusqlite::Connection;
use serde::Serialize;

/// Bir aramanın çalışması için gereken en az karakter sayısı (kırpılmış ve
/// katlanmış sorgu üzerinden). Tek karakterlik bir sorgu neredeyse her notu
/// eşleştirir; sonuç listesi değil, veritabanı dökümü olur.
const ASGARI_SORGU: usize = 2;

/// Tek bir aramanın döndürebileceği en fazla sonuç. Bkz. modül başlığı —
/// sınırsız bir arama toplu dışa aktarımdır.
pub const AZAMI_SONUC: i64 = 50;

/// Döndürülen bağlam parçasının en fazla karakter sayısı (kırpma işaretleri
/// hariç).
const PARCA_UZUNLUGU: usize = 80;

/// Eşleşmenin solunda bırakılan bağlam.
const PARCA_ONCESI: usize = 30;

/// `audit_log.varlik` değeri.
const VARLIK_ARAMA: &str = "arama";

/// `audit_log.varlik_id` değeri — **sabit**. Sorgu metninden türetilmez;
/// bkz. modül başlığı ("sabit `varlik_id` burada neden gizleme yaratmıyor").
const VARLIK_ID_ARAMA: &str = "genel";

/// Danışan adı araması.
///
/// Arşiv durumu **filtrelenmez**: arşivlenmiş bir danışanın dosyasını
/// bulabilmek aramanın işidir ve dışlayıcı `WHERE` deseni bu modüle
/// girmez (bkz. modül başlığı).
const SORGU_DANISAN: &str = "SELECT id, ad_soyad FROM clients
 WHERE replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(ad_soyad),'ı','i'),'İ','i'),'ş','s'),'Ş','s'),'ğ','g'),'Ğ','g'),'ü','u'),'Ü','u'),'ö','o'),'Ö','o'),'ç','c'),'Ç','c') LIKE ?1 ESCAPE '\\'
 ORDER BY ad_soyad COLLATE NOCASE
 LIMIT ?2";

/// Resmî seans notu içeriği araması.
///
/// # DİKKAT: yalnızca `progress_notes`
/// Terapistin özel notu bu sorguya ne `JOIN`'lenir ne `UNION`'lanır; onu
/// dışarıda bırakan bir `WHERE` koşulu da yoktur — sorgu o tabloyu hiç
/// tanımaz (bkz. modül başlığı).
///
/// # Danışan bilgisi `appointments`'tan okunur, notun kopyasından değil
/// `progress_notes.client_id` denormalize bir **kopyadır**; yetkili kaynak
/// `appointments.client_id`'dir ve `appointments::guncelle` bir randevuyu
/// başka bir danışana taşırken o kopyaya **dokunmaz**. Arama sonucundaki
/// `client_id`/`danisan_adi` kopyadan okunsaydı, "randevuyu yanlış danışana
/// girmişim, düzelteyim" gibi tamamen olağan bir eylemden sonra B'nin seans
/// notundan bir parça, ekranda **A'nın adıyla** görünürdü. Aynı sınıf bulgu
/// `notes::danisan_notlari` dokümanında ayrıntılı yazılıdır; burada da testle
/// korunur (`randevu_baska_danisana_tasininca_arama_dogru_danisani_gosterir`).
const SORGU_NOT: &str = "SELECT p.appointment_id, a.client_id, c.ad_soyad, a.baslangic, p.icerik
 FROM progress_notes p
 JOIN appointments a ON a.id = p.appointment_id
 JOIN clients c ON c.id = a.client_id
 WHERE replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(p.icerik),'ı','i'),'İ','i'),'ş','s'),'Ş','s'),'ğ','g'),'Ğ','g'),'ü','u'),'Ü','u'),'ö','o'),'Ö','o'),'ç','c'),'Ç','c') LIKE ?1 ESCAPE '\\'
 ORDER BY a.baslangic DESC, p.appointment_id DESC
 LIMIT ?2";

/// Tek bir arama sonucu.
///
/// `Debug` **türetilmiyor**. Bu kod tabanında türetilmiş `Debug` dört kez
/// sızıntı üretti (`crypto::keyring::DataKey`, `audit::Ayrinti`,
/// `appointments::Randevu`, `clients::Danisan`); `{:?}` bir panik mesajına,
/// bir hata satırına veya bir loga düşer. Burada risk daha da doğrudandır:
/// `parca` **not içeriğinin bir kesiti**, `danisan_adi` kişisel veri,
/// `client_id` + `tarih` ikilisi ise isim olmadan bile "42 numaralı danışan
/// şu saatte seansa geldi" bilgisini verir (`Randevu::Debug` ile aynı
/// muhakeme). Dördü de `<gizli>` basılır; `tur` ve `appointment_id` görünür
/// kalır — hata ayıklarken kayda bakmak isteyen zaten kimlikle veritabanından
/// okuyabilir.
///
/// `Serialize` ise **tüm** alanları verir; ayrım kasıtlıdır: arayüzün veriye
/// ihtiyacı var, panik mesajının yok.
#[derive(Clone, Serialize)]
pub struct AramaSonucu {
    /// `"danisan"` veya `"not"`.
    pub tur: String,
    pub client_id: i64,
    pub danisan_adi: String,
    pub appointment_id: Option<i64>,
    pub tarih: Option<String>,
    /// Eşleşmenin çevresinden alınan bağlam parçası.
    pub parca: String,
}

impl std::fmt::Debug for AramaSonucu {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AramaSonucu")
            .field("tur", &self.tur)
            .field("client_id", &"<gizli>")
            .field("danisan_adi", &"<gizli>")
            .field("appointment_id", &self.appointment_id)
            .field("tarih", &"<gizli>")
            .field("parca", &"<gizli>")
            .finish()
    }
}

/// Türkçe harf katlaması — **1:1**, her karakter tam olarak bir karaktere
/// gider (bkz. modül başlığı; `parca_cikar` bu değişmezliğe dayanır).
///
/// SQL karşılığı `SORGU_DANISAN`/`SORGU_NOT` içindeki `lower()` + 12
/// `replace()` zinciridir: SQLite'ın `lower()`'ı ASCII olduğu için büyük
/// Türkçe harfler ayrıca eşlenir. İkisi ayrışırsa arama sessizce çalışmaz —
/// davranışsal testler her iki sorgu üzerinde bunu sabitler.
fn katla_karakter(k: char) -> char {
    match k {
        'ı' | 'İ' | 'I' | 'i' => 'i',
        'ş' | 'Ş' => 's',
        'ğ' | 'Ğ' => 'g',
        'ü' | 'Ü' => 'u',
        'ö' | 'Ö' => 'o',
        'ç' | 'Ç' => 'c',
        d => d.to_ascii_lowercase(),
    }
}

fn katla(metin: &str) -> String {
    metin.chars().map(katla_karakter).collect()
}

/// Katlanmış sorgudan `LIKE` deseni üretir.
///
/// `\`, `%` ve `_` kaçırılır: kullanıcının yazdığı `%` bir joker değil, düz
/// bir yüzde işaretidir. Kaçış karakteri `\`'dir ve sorgular `ESCAPE '\'`
/// bildirir. Kaçış karakterinin kendisi ilk sırada işlenir, yoksa sonradan
/// eklenen `\`'ler yeniden kaçırılırdı.
fn like_deseni(katli_sorgu: &str) -> String {
    let mut desen = String::with_capacity(katli_sorgu.len() + 2);
    desen.push('%');
    for k in katli_sorgu.chars() {
        if k == '\\' || k == '%' || k == '_' {
            desen.push('\\');
        }
        desen.push(k);
    }
    desen.push('%');
    desen
}

/// Eşleşmenin çevresinden en fazla `PARCA_UZUNLUGU` karakterlik bir bağlam
/// keser; kesilen uçlara `…` koyar.
///
/// Konum, metnin **katlanmış** hâlinde aranır ama parça **ham** metinden
/// kesilir: kullanıcı notunu yazdığı gibi görür. İki dizinin karakter
/// sayıları `katla_karakter`'in 1:1 olması sayesinde aynıdır.
///
/// Eşleşme bulunamazsa (SQL eşleştirdiği hâlde Rust eşleştiremezse — iki
/// katlamanın ayrışması) metnin başından bir parça döner; boş bir parça
/// döndürmek arayüzde sonucu görünmez kılardı.
fn parca_cikar(metin: &str, katli_sorgu: &str) -> String {
    let ham: Vec<char> = metin.chars().collect();
    let katli: Vec<char> = metin.chars().map(katla_karakter).collect();
    let hedef: Vec<char> = katli_sorgu.chars().collect();

    let konum = if hedef.is_empty() || katli.len() < hedef.len() {
        None
    } else {
        katli.windows(hedef.len()).position(|pencere| pencere == hedef.as_slice())
    };

    let baslangic = konum.unwrap_or(0).saturating_sub(PARCA_ONCESI);
    let bitis = baslangic.saturating_add(PARCA_UZUNLUGU).min(ham.len());

    let mut parca = String::new();
    if baslangic > 0 {
        parca.push('…');
    }
    parca.extend(&ham[baslangic..bitis]);
    if bitis < ham.len() {
        parca.push('…');
    }
    parca
}

/// Danışan adlarında ve **resmî** seans notu içeriklerinde arar.
///
/// Özel notlar (`private_notes`) bu aramaya **hiçbir biçimde** girmez; bkz.
/// modül başlığı. Sorgu metni erişim loguna **yazılmaz**.
///
/// `ASGARI_SORGU` karakterden kısa bir sorgu hiçbir tabloyu okumaz, hiçbir
/// log satırı bırakmaz ve boş liste döner. `limit` `1..=AZAMI_SONUC`
/// aralığına kırpılır.
///
/// Sıralama: önce danışanlar (ada göre), sonra notlar (en yeni seanstan
/// en eskiye). Toplam sonuç sayısı kırpılmış limiti aşmaz.
pub fn ara(
    conn: &Connection,
    sorgu: &str,
    limit: i64,
    cihaz: Cihaz,
) -> Result<Vec<AramaSonucu>, DepoHatasi> {
    let katli_sorgu = katla(sorgu.trim());
    // Once kontrol, SONRA log: cok kisa bir sorgu silinemez bir satir
    // birakmasin (bkz. modul basligi).
    if katli_sorgu.chars().count() < ASGARI_SORGU {
        return Ok(Vec::new());
    }

    let desen = like_deseni(&katli_sorgu);
    // -1 SQLite'ta "sinirsiz" demektir; alt uctan da kirpiyoruz.
    let sinir = limit.clamp(1, AZAMI_SONUC);

    let mut sonuclar: Vec<AramaSonucu> = Vec::new();

    let mut stmt = conn.prepare(SORGU_DANISAN)?;
    let danisanlar = stmt
        .query_map(rusqlite::params![desen, sinir], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    for (id, ad) in danisanlar {
        let parca = parca_cikar(&ad, &katli_sorgu);
        sonuclar.push(AramaSonucu {
            tur: "danisan".to_string(),
            client_id: id,
            danisan_adi: ad,
            appointment_id: None,
            tarih: None,
            parca,
        });
    }

    let mut stmt = conn.prepare(SORGU_NOT)?;
    let notlar = stmt
        .query_map(rusqlite::params![desen, sinir], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    for (appointment_id, client_id, danisan_adi, tarih, icerik) in notlar {
        sonuclar.push(AramaSonucu {
            tur: "not".to_string(),
            client_id,
            danisan_adi,
            appointment_id: Some(appointment_id),
            tarih: Some(tarih),
            parca: parca_cikar(&icerik, &katli_sorgu),
        });
    }

    sonuclar.truncate(sinir as usize);

    // Sorgu metni, sonuc sayisi ve danisan kimligi loga GIRMEZ; yalnizca
    // "bu cihazdan arama yapildi" bilgisi yazilir ve pencere boyunca
    // birlestirilir (bkz. modul basligi).
    kaydet(
        conn,
        Eylem::Goruntuleme,
        VARLIK_ARAMA,
        VARLIK_ID_ARAMA,
        cihaz,
        None,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;

    Ok(sonuclar)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{
        appointments::{
            guncelle as randevu_guncelle, olustur as randevu_olustur, RandevuGuncelleme,
            YeniRandevu,
        },
        clients::{ekle as danisan_ekle, YeniDanisan},
        db::open_encrypted,
        notes::{not_kaydet, ozel_not_kaydet},
        schema::migrate,
    };

    fn kurulum() -> (tempfile::TempDir, rusqlite::Connection, i64, i64) {
        let dir = tempfile::tempdir().unwrap();
        let c = open_encrypted(&dir.path().join("v.db"), &generate_data_key()).unwrap();
        migrate(&c).unwrap();
        let d = danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "Ayse Yilmaz".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();
        let r = randevu_olustur(
            &c,
            &YeniRandevu {
                client_id: d.id,
                baslangic: "2026-09-07T14:00".into(),
                bitis: "2026-09-07T15:00".into(),
                ucret: None,
            },
            Cihaz::Masaustu,
        )
        .unwrap();
        (dir, c, d.id, r.id)
    }

    /// Cakismayan gunler uretir: `randevu_olustur` ayni araliga ikinci bir
    /// randevu kabul etmez.
    fn gun(i: usize) -> String {
        if i < 31 {
            format!("2026-03-{:02}", i + 1)
        } else {
            format!("2026-04-{:02}", i - 30)
        }
    }

    fn randevu_ekle(c: &rusqlite::Connection, client_id: i64, tarih: &str) -> i64 {
        randevu_olustur(
            c,
            &YeniRandevu {
                client_id,
                baslangic: format!("{tarih}T14:00"),
                bitis: format!("{tarih}T15:00"),
                ucret: None,
            },
            Cihaz::Masaustu,
        )
        .unwrap()
        .id
    }

    fn arama_log_sayisi(c: &rusqlite::Connection) -> i64 {
        c.query_row(
            "SELECT COUNT(*) FROM audit_log WHERE varlik = ?1",
            [VARLIK_ARAMA],
            |r| r.get(0),
        )
        .unwrap()
    }

    // --- Brief'in yedi testi ---------------------------------------------

    #[test]
    fn danisan_adiyla_bulunur() {
        let (_d, c, _cid, _rid) = kurulum();
        let sonuclar = ara(&c, "Ayse", 20, Cihaz::Masaustu).unwrap();
        assert!(sonuclar.iter().any(|s| s.tur == "danisan"));
    }

    #[test]
    fn not_icerigiyle_bulunur_ve_parca_dondurur() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "Danisan sinav kaygisindan bahsetti.", Cihaz::Masaustu).unwrap();

        let sonuclar = ara(&c, "kaygi", 20, Cihaz::Masaustu).unwrap();
        let not_sonucu = sonuclar.iter().find(|s| s.tur == "not").expect("not bulunmali");
        assert!(not_sonucu.parca.contains("kaygi"), "eslesme parcasi dondurulmeli");
        assert_eq!(not_sonucu.danisan_adi, "Ayse Yilmaz");
    }

    #[test]
    fn ozel_notlar_arama_sonuclarina_girmez() {
        let (_d, c, _cid, rid) = kurulum();
        ozel_not_kaydet(&c, rid, "GIZLI_HIPOTEZ_KAYGI", Cihaz::Masaustu).unwrap();

        let sonuclar = ara(&c, "GIZLI_HIPOTEZ", 20, Cihaz::Masaustu).unwrap();
        assert!(sonuclar.is_empty(), "ozel not aramada cikmamali");
    }

    #[test]
    fn buyuk_kucuk_harf_ve_turkce_karakter_tolere_edilir() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "Danışan KAYGI yaşıyor.", Cihaz::Masaustu).unwrap();
        assert!(!ara(&c, "kaygi", 20, Cihaz::Masaustu).unwrap().is_empty());
    }

    #[test]
    fn bos_veya_cok_kisa_sorgu_bos_doner() {
        let (_d, c, _cid, _rid) = kurulum();
        assert!(ara(&c, "", 20, Cihaz::Masaustu).unwrap().is_empty());
        assert!(ara(&c, "a", 20, Cihaz::Masaustu).unwrap().is_empty());
    }

    #[test]
    fn joker_karakterler_kacirilir() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "normal icerik", Cihaz::Masaustu).unwrap();
        // "%" LIKE'ta her seyi eslestirir; kacirilmazsa tum notlar doner.
        assert!(ara(&c, "%%", 20, Cihaz::Masaustu).unwrap().is_empty());
    }

    #[test]
    fn arama_sorgusu_erisim_loguna_icerik_yazmaz() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "COK_GIZLI", Cihaz::Masaustu).unwrap();
        ara(&c, "COK_GIZLI", 20, Cihaz::Masaustu).unwrap();

        for kayit in crate::store::audit::son_kayitlar(&c, 50).unwrap() {
            let hepsi = format!("{} {:?}", kayit.varlik_id, kayit.ayrinti);
            assert!(!hepsi.contains("COK_GIZLI"), "arama sorgusu loga sizmis");
        }
    }

    #[test]
    fn arama_terimi_hicbir_bicimde_loga_girmez() {
        // Yukaridaki brief testi BUYUK/kucuk harfe duyarli bir dizgi ariyor;
        // oysa sorgu loga `katla`'dan gecmis (kucuk harfe inmis) hâliyle de
        // sizabilir -- o hâlde `contains("COK_GIZLI")` iddiasi tutmazdi ve
        // sizinti gorunmezdi. Burada satirin TAMAMI (eylem + varlik +
        // varlik_id + ayrinti) kucuk harfe indirgenip aranir.
        //
        // Ayrica sonuc SAYISI da yazilmamali: arka arkaya aramalarla
        // "kac sonuc dondu" bilgisi bir terimin varligini sizdirir. Bu
        // yuzden `varlik_id` sabit degerin TAM ESITI olmali.
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "COK_GIZLI_TERIM notu", Cihaz::Masaustu).unwrap();
        let sonuclar = ara(&c, "COK_GIZLI_TERIM", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(sonuclar.len(), 1, "on kosul: arama gercekten bir sey bulmali");

        let kayitlar = crate::store::audit::son_kayitlar(&c, 50).unwrap();
        assert!(
            kayitlar.iter().any(|k| k.varlik == VARLIK_ARAMA),
            "on kosul: arama satiri yazilmis olmali"
        );
        for kayit in kayitlar {
            let hepsi = format!(
                "{} {} {} {:?}",
                kayit.eylem, kayit.varlik, kayit.varlik_id, kayit.ayrinti
            )
            .to_lowercase();
            assert!(!hepsi.contains("cok_gizli"), "arama terimi loga sizmis: {hepsi}");
            assert!(!hepsi.contains("terim"), "arama terimi loga sizmis: {hepsi}");
            if kayit.varlik == VARLIK_ARAMA {
                assert_eq!(
                    kayit.varlik_id, VARLIK_ID_ARAMA,
                    "arama satirinin varlik_id'si sabit olmali (sorgudan/sonuc sayisindan turetilmemeli)"
                );
                assert!(kayit.ayrinti.is_none(), "arama satiri ayrinti tasimamali");
            }
        }
    }

    // --- Ozel not sizintisi: iki yonlu ------------------------------------

    #[test]
    fn ayni_isaret_hem_ozel_hem_resmi_notta_varsa_yalnizca_resmi_not_doner() {
        // ARTI YON + EKSI YON AYNI TESTTE.
        //
        // Yalnizca "ozel not cikmiyor" diye bakan bir test, HICBIR SEY
        // dondurmeyen bir `ara` tarafindan da gecilirdi. Burada ayni ayirt
        // edici dizgi iki tabloda birden duruyor: sonuc TAM OLARAK bir
        // tane olmali ve o da resmi nota ait olmali.
        //
        // Mutasyon: `SORGU_NOT`'a `UNION ALL ... private_notes` eklemek
        // uzunlugu 2'ye cikarir -> test kirilir.
        // Mutasyon: `ara`'yi bos liste dondurecek sekilde bozmak
        // uzunlugu 0'a dusurur -> test yine kirilir.
        let (_d, c, cid, rid) = kurulum();
        let r2 = randevu_ekle(&c, cid, "2026-09-08");

        not_kaydet(&c, rid, "dap", "PAYLASILAN_ISARET resmi notta", Cihaz::Masaustu).unwrap();
        ozel_not_kaydet(&c, r2, "PAYLASILAN_ISARET ozel notta", Cihaz::Masaustu).unwrap();

        let sonuclar = ara(&c, "PAYLASILAN_ISARET", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(sonuclar.len(), 1, "tam olarak bir sonuc beklenir: {sonuclar:?}");
        assert_eq!(sonuclar[0].tur, "not");
        assert_eq!(sonuclar[0].appointment_id, Some(rid));
        assert!(
            sonuclar[0].parca.contains("resmi notta"),
            "resmi notun parcasi donmeli: {}",
            sonuclar[0].parca
        );
        assert!(
            !sonuclar[0].parca.contains("ozel notta"),
            "ozel not icerigi sizmis: {}",
            sonuclar[0].parca
        );
    }

    #[test]
    fn kaynak_kodda_private_notes_gecmez() {
        // Davranissal testin yaninda YAPISAL kanit: uretim kodu (test blogu
        // ve yorum satirlari haric) `private_notes` tablosunu adiyla hic
        // anmaz ve hicbir `UNION` icermez. Ozel notun disarida kalmasi bir
        // filtrenin degil, sorgunun hangi tabloya baktiginin sonucudur --
        // bu test tam olarak onu sabitler.
        let uretim: String = include_str!("search.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("kaynak bos olamaz")
            .lines()
            .filter(|satir| !satir.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");

        assert!(
            !uretim.contains("private_notes"),
            "arama modulunun uretim kodu private_notes tablosunu adiyla anmamali"
        );
        assert!(
            !uretim.to_uppercase().contains("UNION"),
            "arama sorgularinda UNION olmamali"
        );
    }

    // --- Turkce katlama: iki tablo, iki yon -------------------------------

    #[test]
    fn turkce_katlama_not_iceriginde_iki_yonlu_calisir() {
        let (_d, c, cid, rid) = kurulum();
        let r2 = randevu_ekle(&c, cid, "2026-09-08");
        not_kaydet(&c, rid, "dap", "sınav kaygısı ISARET_A", Cihaz::Masaustu).unwrap();
        not_kaydet(&c, r2, "dap", "sinav kaygisi ISARET_B", Cihaz::Masaustu).unwrap();

        // ASCII sorgu -> Turkce metin
        let a = ara(&c, "sinav kaygi", 20, Cihaz::Masaustu).unwrap();
        assert!(a.iter().any(|s| s.parca.contains("ISARET_A")), "ASCII sorgu Turkce metni bulmali: {a:?}");
        // Turkce sorgu -> ASCII metin
        let b = ara(&c, "sınav kaygı", 20, Cihaz::Masaustu).unwrap();
        assert!(b.iter().any(|s| s.parca.contains("ISARET_B")), "Turkce sorgu ASCII metni bulmali: {b:?}");
        // Her iki yonde de IKI not birden bulunmali.
        assert_eq!(a.len(), 2);
        assert_eq!(b.len(), 2);
    }

    #[test]
    fn turkce_katlama_danisan_adinda_iki_yonlu_calisir() {
        let (_d, c, _cid, _rid) = kurulum();
        danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "İpek Şahin".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();
        danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "Ipek Sahin".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();

        assert_eq!(ara(&c, "ipek sahin", 20, Cihaz::Masaustu).unwrap().len(), 2);
        assert_eq!(ara(&c, "İPEK ŞAHİN", 20, Cihaz::Masaustu).unwrap().len(), 2);
    }

    #[test]
    fn katlama_karakter_sayisini_korur() {
        // `parca_cikar` bu degismezlige dayanir: katlanmis metindeki eslesme
        // konumu ham metindeki karakter konumuyla ayni olmali.
        for ornek in ["Işık ÇAĞRI şĞüÜöÖçÇ", "KAYGI kaygı", "İstanbul", "ASCII only"] {
            assert_eq!(
                katla(ornek).chars().count(),
                ornek.chars().count(),
                "katlama 1:1 olmali: {ornek}"
            );
        }
    }

    // --- Kacirma ----------------------------------------------------------

    #[test]
    fn tek_karakterlik_joker_de_kacirilir() {
        // `_` LIKE'ta TEK karakteri eslestirir: "n_rmal" kacirilmazsa
        // "normal"i bulurdu. Test 6 yalnizca `%`'i kapatiyor.
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "normal icerik", Cihaz::Masaustu).unwrap();
        assert!(
            ara(&c, "n_rmal", 20, Cihaz::Masaustu).unwrap().is_empty(),
            "_ joker karakter olarak yorumlanmis"
        );
        // ARTI YON: gercek metin hala bulunuyor -- yukaridaki bos sonuc
        // "arama hic calismiyor"dan degil, kacirmadan geliyor.
        assert!(!ara(&c, "normal", 20, Cihaz::Masaustu).unwrap().is_empty());
    }

    #[test]
    fn kacirilan_isaretler_gercekten_aranabilir() {
        // Kacirma metni ARAMA DISI birakmamali: notta gercekten `%` varsa
        // bulunmali.
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "iyilesme %40 civarinda", Cihaz::Masaustu).unwrap();
        let sonuclar = ara(&c, "%40", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(sonuclar.len(), 1, "literal % aranabilmeli: {sonuclar:?}");
    }

    // --- Sonuc siniri ------------------------------------------------------

    #[test]
    fn sonuc_sayisi_azami_siniri_asmaz() {
        let (_d, c, cid, _rid) = kurulum();
        for i in 0..(AZAMI_SONUC as usize + 5) {
            let r = randevu_ekle(&c, cid, &gun(i));
            not_kaydet(&c, r, "dap", "ORTAKKELIME notu", Cihaz::Masaustu).unwrap();
        }
        let sonuclar = ara(&c, "ORTAKKELIME", 10_000, Cihaz::Masaustu).unwrap();
        assert_eq!(sonuclar.len(), AZAMI_SONUC as usize);
    }

    #[test]
    fn negatif_limit_sinirsiz_demek_degildir() {
        // SQLite'ta `LIMIT -1` = sinirsiz. Kirpma alt uctan da yapilmali.
        let (_d, c, cid, _rid) = kurulum();
        for i in 0..10 {
            let r = randevu_ekle(&c, cid, &gun(i));
            not_kaydet(&c, r, "dap", "ORTAKKELIME notu", Cihaz::Masaustu).unwrap();
        }
        // On kosul: sinirsiz olsaydi 10 sonuc donerdi.
        assert_eq!(ara(&c, "ORTAKKELIME", 50, Cihaz::Masaustu).unwrap().len(), 10);
        assert_eq!(ara(&c, "ORTAKKELIME", -1, Cihaz::Masaustu).unwrap().len(), 1);
        assert_eq!(ara(&c, "ORTAKKELIME", 0, Cihaz::Masaustu).unwrap().len(), 1);
    }

    #[test]
    fn parca_tum_notu_dondurmez() {
        let (_d, c, _cid, rid) = kurulum();
        let uzun = format!("{} HEDEFKELIME {}", "a".repeat(500), "b".repeat(500));
        not_kaydet(&c, rid, "dap", &uzun, Cihaz::Masaustu).unwrap();

        let sonuclar = ara(&c, "HEDEFKELIME", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(sonuclar.len(), 1);
        let parca = &sonuclar[0].parca;
        assert!(parca.contains("HEDEFKELIME"), "eslesme parcada olmali: {parca}");
        assert!(
            parca.chars().count() <= PARCA_UZUNLUGU + 2,
            "parca {} karakter, sinir {}: {parca}",
            parca.chars().count(),
            PARCA_UZUNLUGU + 2
        );
        assert!(!parca.contains(&"b".repeat(200)), "notun tamami donmus");
    }

    // --- Denetim kaydi -----------------------------------------------------

    #[test]
    fn arama_loglanir_ama_pencere_icinde_birlestirilir() {
        // IKI YONLU: "cok fazla" yonu (3 arama = 1 satir) VE "cok az" yonu
        // (log tamamen kaldirilirsa 0 satir kalir, ilk iddia kirilir).
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "kaygi notu", Cihaz::Masaustu).unwrap();

        assert_eq!(arama_log_sayisi(&c), 0, "on kosul: henuz arama yapilmadi");
        ara(&c, "kaygi", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(arama_log_sayisi(&c), 1, "arama loglanmali");

        ara(&c, "kaygi", 20, Cihaz::Masaustu).unwrap();
        ara(&c, "baska", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(arama_log_sayisi(&c), 1, "pencere icinde tek satir kalmali");

        // Farkli CIHAZ ayri bir satirdir: log "hangi cihazdan" sorusunu
        // yanitlar (bkz. audit::son_kayit_yakin_mi).
        ara(&c, "kaygi", 20, Cihaz::Telefon).unwrap();
        assert_eq!(arama_log_sayisi(&c), 2, "telefon ayri bir satir yazmali");
    }

    #[test]
    fn cok_kisa_sorgu_log_satiri_birakmaz() {
        // Gorev 7'de rota acilinca `?q=a` her tuş vurusunda gelir; her biri
        // SILINEMEZ bir satir birakirsa disaridan tetiklenebilir bir gurultu
        // yolu acilir.
        let (_d, c, _cid, _rid) = kurulum();
        ara(&c, "", 20, Cihaz::Masaustu).unwrap();
        ara(&c, "a", 20, Cihaz::Masaustu).unwrap();
        ara(&c, "  ", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(arama_log_sayisi(&c), 0, "cok kisa sorgu log yazmamali");
    }

    #[test]
    fn arama_audit_log_uzerinde_update_veya_delete_denemez() {
        let uretim: String = include_str!("search.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("kaynak bos olamaz")
            .lines()
            .filter(|satir| !satir.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n")
            .to_uppercase();
        assert!(!uretim.contains("UPDATE AUDIT_LOG"));
        assert!(!uretim.contains("DELETE FROM AUDIT_LOG"));
    }

    // --- Yetkili kaynak ----------------------------------------------------

    #[test]
    fn randevu_baska_danisana_tasininca_arama_dogru_danisani_gosterir() {
        // `progress_notes.client_id` denormalize bir KOPYADIR ve
        // `appointments::guncelle` ona dokunmaz. Arama sonucu kopyadan
        // okunsaydi B'nin notu ekranda A'nin adiyla gorunurdu.
        let (_d, c, a_id, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "TASINAN_NOT icerigi", Cihaz::Masaustu).unwrap();

        let b = danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "Mehmet Demir".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();

        let once = ara(&c, "TASINAN_NOT", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(once[0].danisan_adi, "Ayse Yilmaz", "on kosul");
        assert_eq!(once[0].client_id, a_id);

        randevu_guncelle(
            &c,
            rid,
            &RandevuGuncelleme {
                client_id: b.id,
                baslangic: "2026-09-07T14:00".into(),
                bitis: "2026-09-07T15:00".into(),
                ucret: None,
            },
            Cihaz::Masaustu,
        )
        .unwrap();

        // Denormalize kopya GERCEKTEN eskimis olmali; yoksa test yetkili
        // kaynagi degil, tesadufen tutan bir kopyayi dogrulardi.
        let kopya: i64 = c
            .query_row("SELECT client_id FROM progress_notes WHERE appointment_id = ?1", [rid], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(kopya, a_id, "on kosul: kopya eskimis olmali");

        let sonra = ara(&c, "TASINAN_NOT", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(sonra.len(), 1);
        assert_eq!(sonra[0].client_id, b.id, "yetkili kaynak appointments olmali");
        assert_eq!(sonra[0].danisan_adi, "Mehmet Demir");
    }

    #[test]
    fn arsivlenmis_danisan_da_bulunur() {
        // Dislayici `WHERE` deseni bu modulde YOK: arsiv kaydi da aranabilir.
        let (_d, c, cid, _rid) = kurulum();
        crate::store::clients::arsivle(&c, cid, Cihaz::Masaustu).unwrap();
        assert!(ara(&c, "Ayse", 20, Cihaz::Masaustu)
            .unwrap()
            .iter()
            .any(|s| s.tur == "danisan"));
    }

    // --- Debug ciktisi -----------------------------------------------------

    #[test]
    fn arama_sonucu_debug_ciktisi_icerik_ve_isim_basmaz() {
        let sonuc = AramaSonucu {
            tur: "not".into(),
            client_id: 424_242,
            danisan_adi: "COK_GIZLI_ISIM".into(),
            appointment_id: Some(481_516),
            tarih: Some("2026-09-07T14:00".into()),
            parca: "COK_GIZLI_NOT_PARCASI".into(),
        };
        let metin = format!("{sonuc:?}");
        assert!(!metin.contains("COK_GIZLI_NOT_PARCASI"), "Debug parcayi basmamali: {metin}");
        assert!(!metin.contains("COK_GIZLI_ISIM"), "Debug ismi basmamali: {metin}");
        assert!(!metin.contains("424242"), "Debug client_id'yi basmamali: {metin}");
        assert!(!metin.contains("2026-09-07"), "Debug tarihi basmamali: {metin}");
        assert!(
            metin.contains("appointment_id: Some(481516)"),
            "hata ayiklama icin appointment_id gorunur kalmali: {metin}"
        );
        assert!(metin.contains("<gizli>"));

        // Serialize ise TUM alanlari icerir -- ayrim kasitli.
        let json = serde_json::to_string(&sonuc).unwrap();
        assert!(json.contains("COK_GIZLI_NOT_PARCASI"), "arayuzun veriye ihtiyaci var");
        assert!(json.contains("COK_GIZLI_ISIM"));
        assert!(json.contains("424242"));
    }

    #[test]
    fn sarmallanmis_debug_ciktilari_da_sizdirmaz() {
        // Gercek sizinti yollari: `unwrap()`/`expect()` panigi
        // `Result<Vec<AramaSonucu>, _>`'nun, `find()` ise
        // `Option<&AramaSonucu>`'nun Debug'ini basar.
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "COK_GIZLI_NOT_PARCASI burada", Cihaz::Masaustu).unwrap();

        let sonuc = ara(&c, "COK_GIZLI_NOT_PARCASI", 20, Cihaz::Masaustu);
        let metin = format!("{sonuc:?}");
        assert!(
            !metin.contains("COK_GIZLI_NOT_PARCASI"),
            "Result<Vec<..>> Debug'i icerigi basmamali: {metin}"
        );

        let liste = sonuc.unwrap();
        assert_eq!(liste.len(), 1, "on kosul: sonuc gercekten dolu olmali");
        assert!(!format!("{liste:?}").contains("COK_GIZLI_NOT_PARCASI"));
        assert!(!format!("{:?}", liste.first()).contains("COK_GIZLI_NOT_PARCASI"));
        assert!(!format!("{:?}", Some(liste[0].clone())).contains("Ayse Yilmaz"));

        // Panik mesaji: bu kod tabaninin kendi test deseni
        // (`assert_eq!(.., .., "...: {sonuclar:?}")`) basarisiz oldugunda
        // sonucun Debug'ini stderr'e basar. Gercek sizinti yolu budur.
        let onceki = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let panik = std::panic::catch_unwind(move || {
            assert_eq!(liste.len(), 99, "beklenen sonuc sayisi tutmadi: {liste:?}");
        })
        .unwrap_err();
        std::panic::set_hook(onceki);

        let mesaj = panik
            .downcast_ref::<String>()
            .cloned()
            .unwrap_or_else(|| "panik mesaji okunamadi".to_string());
        assert!(
            !mesaj.contains("COK_GIZLI_NOT_PARCASI"),
            "panik mesaji not icerigini basmamali: {mesaj}"
        );
        assert!(!mesaj.contains("Ayse Yilmaz"), "panik mesaji danisan adini basmamali: {mesaj}");
    }
}
