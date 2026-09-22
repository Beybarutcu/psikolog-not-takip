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
//! satırları biriktirirdi. **Görüntüleme yolları (`seans_etiketleri`,
//! `etiketli_seanslar`) da aynı kuralı izler** — `seans_etiketleri` seans
//! paneli her açılışta çalışacak bir yoldur; `HerCagri` olsaydı panel her
//! açılışta silinemez bir satır bırakırdı (inceleme bulgusu, bkz. iki yönlü
//! hacim testleri: `seans_etiketleri_otuz_goruntuleme_tam_bir_satir_uretir`,
//! `seans_etiketleri_pencere_disindaki_eski_satiri_susturmaz` ve
//! `etiketli_seanslar` için aynı çiftler). Bu yüzden BÜTÜN dört yol
//! (`etiket_ekle`, `etiket_kaldir`, `seans_etiketleri`, `etiketli_seanslar`)
//! `LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK)` kullanır. `etiket_ekle`
//! ve `etiket_kaldir` BİLEREK AYNI (eylem, varlık, varlık_id) üçlüsünü
//! paylaşır (`Duzenleme`/`progress_note`/appointment_id) — ikisi de
//! sonuçta "bu seansın resmî notu değişti" demektir.
//!
//! # KRİTİK: hiçbir satırı etkilemeyen işlem loglanmaz (inceleme düzeltmesi)
//!
//! `store::audit` modül başlığındaki kural ("hiçbir satırı etkilemeyen
//! mutasyonlar loglanmaz — aksi hâlde dışarıdan tetiklenebilir, sınırsız ve
//! silinemez bir gürültü yolu açılır", desen `appointments.rs`'teki
//! `etkilenen == 0 → Bulunamadi`) burada da uygulanır:
//! - `etiket_kaldir` `DELETE`'in **etkilediği satır sayısına** bakar
//!   (`Connection::execute`'ın döndürdüğü değer). Sıfırsa (bilinmeyen
//!   `tag_id`, ya da bu seansa hiç bağlanmamış bir etiket) `DepoHatasi::Bulunamadi`
//!   döner ve **log YAZILMAZ** — "seansın resmî notu değişti" demek, hiçbir
//!   şey değişmediğinde yalandır.
//! - `etiket_ekle` aynı şekilde `progress_note_tags` `INSERT`'inin
//!   (`ON CONFLICT ... DO NOTHING`) GERÇEKTEN bir satır ekleyip eklemediğine
//!   bakar. Etiket zaten bu seansa bağlıysa (terapist aynı etikete iki kez
//!   tıklarsa) çağrı hata VERMEZ (idempotent, dönüş değeri mevcut etiket) ama
//!   **log yazmaz**.
//!
//! # `ad_anahtar`: KİMLİK için AYRI bir normalleşme — `search::katla` BURADA
//! KULLANILMAZ (inceleme düzeltmesi)
//!
//! İlk sürümde bu modül `store::search::katla`'yı (arama modülünün YUMUŞAK
//! eşleşme kuralı) yeniden kullanıyordu. Bu YANLIŞTI: `katla` harf
//! işaretlerini de düzleştirir (`ş->s`, `ı->i`, `ğ->g`, `ü->u`, `ö->o`,
//! `ç->c`) — arama için doğru (kullanıcı aksansız yazabilir) ama KİMLİK için
//! yanlıştır, çünkü ANLAMI FARKLI kelimeleri tek etikete birleştirir: "yas"
//! (matem) ile "yaş" aynı `ad_katli`'ya giderdi ve ikinci ekleyen kişinin
//! yazdığı ad sessizce ilkinin görünen adını alırdı — terapist "yaş" yazsa
//! bile seansa "yas" etiketi bağlanmış görünürdü (yanlış klinik
//! sınıflandırma).
//!
//! Bu yüzden kimlik `ad_anahtar_uret` ile üretilir: yalnızca BÜYÜK/küçük
//! harf farkını yok sayar, harf işaretlerini KORUR. "Kaygı"/"kaygı"/"KAYGI"
//! yine aynı etiket, ama "yas"/"yaş" FARKLI etikettir. `store::search::katla`
//! bu modülde HİÇ kullanılmaz ve `search.rs`'te `pub(crate)` DEĞİLDİR —
//! Görev 7'de arama tarafında etiket eşleşmesi için gerektiğinde (orada
//! YUMUŞAK eşleşme doğru davranıştır) ayrıca açılacaktır.
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
//! # Sözlük temizliği tetikleyicide, burada DEĞİL
//!
//! Bir etiketin son bağı gidince (`etiket_kaldir` ile TEKİL, ya da randevu
//! silinip `ON DELETE CASCADE` ile TOPLU) sözlükten de silinmesi
//! `schema.rs`'teki `progress_note_tags_temizle_kullanilmayan` tetikleyicisi
//! ile yapılır (bkz. o modülün V5 dokümantasyonu) — burada AYRICA elle bir
//! `DELETE FROM tags` YOKTUR. Tek temizlik yolu tetikleyicidir: hem tekil
//! kaldırmayı hem cascade silmeyi kapsar, ikinci bir kopyası unutulup
//! ayrışamaz.
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
/// boşluğa indirilir (`split(bosluk_mu)` ikisini birden yapar). Doğrulamadan
/// ÖNCE çağrılır ki `"kaygı "` ile `"kaygı"` aynı ada normalleşsin ve aynı
/// satır veritabanına yazılsın.
///
/// Boşluk kümesi `store::bosluk_mu` (son inceleme M5): `split_whitespace`
/// U+FEFF'i boşluk saymaz, arayüzün `etiketAdiNormallestir`'i sayardı —
/// BOM'lu yapıştırılmış bir ad iki tarafta farklı kimliğe normalleşirdi.
fn normallesmis_ad(ad: &str) -> String {
    ad.split(super::bosluk_mu).filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" ")
}

/// Etiket KİMLİĞİ için Türkçe'ye duyarlı küçük harfe çevirme.
///
/// `store::search::katla` (aramanın YUMUŞAK eşleşmesi) ile KARIŞTIRILMASIN:
/// `katla` harf işaretlerini de düzleştirir ve bu ARAMA için doğrudur
/// (kullanıcı aksansız yazabilir, "kaygı" araması "kaygı" içeren her notu
/// bulmalı) ama KİMLİK için YANLIŞTIR — anlamı farklı kelimeleri (`"yas"`
/// matem, `"yaş"` harf işaretli farklı kelime) tek etikete birleştirirdi.
/// Bu fonksiyon yalnızca BÜYÜK/küçük harf farkını yok sayar, harf
/// işaretlerini KORUR: `"Kaygı"`/`"kaygı"`/`"KAYGI"` aynı anahtara gider,
/// `"yas"`/`"yaş"` FARKLI kalır.
///
/// Rust'ın `str::to_lowercase()`'i Türkçe'ye duyarlı DEĞİLDİR: `'I'` ASCII
/// kuralıyla `'i'` yapar, oysa Türkçede büyük noktasız `I`'nın küçüğü
/// noktasız `ı`'dır (büyük noktalı `İ`'nin küçüğü noktalı `i`'dir — bu ikisi
/// zaten `to_lowercase()`'in Unicode kuralıyla doğru sonucu verir). Bu
/// yüzden `I`/`İ` ÖNCE elle çevrilir, GERİ KALAN karakterler
/// `to_lowercase()`'e bırakılır (Unicode'un genel küçültme kuralı
/// `ş/Ş`, `ğ/Ğ`, `ü/Ü`, `ö/Ö`, `ç/Ç` için zaten doğru sonucu verir — bunlar
/// harf işaretini KORUYARAK küçülür, `katla`'nın aksine).
///
/// `"ISIK"` (tamamı büyük, noktasız `I`) `"ısık"`a gider — `"ışık"`a DEĞİL:
/// büyük harfte harf işareti bilgisi zaten kaybolmuştur (`I` hem `ı`'nın hem
/// -yanlış yazılmış- `ı`'nın büyüğü olabilir), bu fonksiyon var olmayan bir
/// işareti UYDURMAZ; yalnızca büyük/küçük dönüşümü yapar.
///
/// Arayüzdeki eşi (`web/src/etiket/etiketAdi.ts::etiketAnahtari`) ile ORTAK
/// örnek dosyasına bağlı (son inceleme M3): `etiket_kimlik_ornekleri.json`,
/// ölçen test `kimlik_ortak_ornekleri_saglar`.
fn ad_anahtar_uret(normal_ad: &str) -> String {
    normal_ad
        .chars()
        .map(|k| match k {
            'I' => 'ı',
            'İ' => 'i',
            d => d,
        })
        .collect::<String>()
        .to_lowercase()
}

/// Etiket sıralamasının alfabesi (Görev 6 inceleme MINOR-3). Türk alfabesi
/// (a b c ç d e f g ğ h ı i j k l m n o ö p r s ş t u ü v y z) + Türkçede
/// olmayan ama etiket adında geçebilecek `q`, `w`, `x` Latin alfabesindeki
/// yerlerinde.
const TURKCE_ALFABE: &str = "abcçdefgğhıijklmnoöpqrsştuüvwxyz";

/// Bir adın sıralama anahtarı: `ad_anahtar_uret` (Türkçe küçük harf) sonrası
/// her karakter için (sınıf, sıra). Sınıf 0: alfabe dışı ASCII (boşluk,
/// rakam, noktalama — harflerden ÖNCE, kod noktasıyla); sınıf 1: alfabe
/// harfi (alfabedeki sırasıyla); sınıf 2: diğer her şey (kod noktasıyla).
/// Şapkalı `â`/`î`/`û` temel harfle aynı yere düşer (eşitlik aşağıda
/// çözülür).
fn sira_anahtari(ad: &str) -> Vec<(u8, u32)> {
    ad_anahtar_uret(ad)
        .chars()
        .map(|k| {
            let temel = match k {
                'â' => 'a',
                'î' => 'i',
                'û' => 'u',
                d => d,
            };
            match TURKCE_ALFABE.chars().position(|h| h == temel) {
                Some(i) => (1, i as u32),
                None if (temel as u32) < 0x80 => (0, temel as u32),
                None => (2, temel as u32),
            }
        })
        .collect()
}

/// Etiket adlarının TEK sıralama kuralı: Türk alfabesi, büyük/küçük harf
/// duyarsız (Türkçe kural). `ORDER BY ad_anahtar` (UTF-8 bayt sırası)
/// "çocukluk", "öfke", "şiddet", "ılık"ı "z"den SONRA koyuyordu (inceleme
/// MINOR-3). Eşitlikte önce anahtarın, sonra ham adın kod noktası sırası
/// (sıra her zaman TAM ve belirlenebilir). `Intl`/yerel ayar verisi
/// kullanılmıyor: sıra platforma göre değişmemeli. İstemcinin eşi
/// `web/src/etiket/etiketAdi.ts::etiketSirasi`; ikisi ORTAK örnek dosyasıyla
/// (`etiket_siralama_ornekleri.json`) eşit tutuluyor.
pub(crate) fn etiket_sirasi(a: &str, b: &str) -> std::cmp::Ordering {
    sira_anahtari(a)
        .cmp(&sira_anahtari(b))
        .then_with(|| ad_anahtar_uret(a).cmp(&ad_anahtar_uret(b)))
        .then_with(|| a.cmp(b))
}

/// Normalleşmiş adın 1-40 KARAKTER (`chars().count()`, bayt değil)
/// aralığında olduğunu doğrular; aksi hâlde `DepoHatasi::GecersizVeri`.
/// Sınır veritabanı `CHECK (length(ad) BETWEEN 1 AND 40)` ile de tutulur
/// (SQLite'ta TEXT için `length()` karakter sayar) — burasi kullanıcıya
/// anlaşılır bir hata mesajı vermek için ÖNDEN yapılan aynı kontrol
/// (`notes::not_kaydet`'teki şablon doğrulamasıyla aynı desen). Hata mesajı
/// yalnızca UZUNLUĞU taşır, adın kendisini DEĞİL (bkz. modül başlığı: etiket
/// adı hiçbir yere -log dahil- doğrulanmamış hâliyle sızmamalı).
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

/// Bütün etiketler, en çok kullanılandan aza (eşitlikte anahtar sütuna göre
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
          GROUP BY t.id, t.ad",
    )?;
    let mut etiketler = stmt
        .query_map([], |r| Ok(Etiket { id: r.get(0)?, ad: r.get(1)?, kullanim: r.get(2)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    // Sira SQL'de degil: `etiket_sirasi` (Turk alfabesi) bir SQLite
    // harmanlamasi degil.
    etiketler.sort_by(|a, b| b.kullanim.cmp(&a.kullanim).then_with(|| etiket_sirasi(&a.ad, &b.ad)));
    Ok(etiketler)
}

/// Bir seansın etiketleri, Türk alfabesi sırasıyla (`etiket_sirasi`).
/// Büyük/küçük harften bağımsız ve kararlı.
///
/// Log: `goruntuleme` / `progress_note` / randevu kimliği, birleştirilerek
/// (bkz. modül başlığı — bu panel her açılışta çalışan kendi kendini
/// yenileyen bir yoldur, `HerCagri` OLMAMALI).
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
          WHERE pt.appointment_id = ?1",
    )?;
    let mut etiketler = stmt
        .query_map([appointment_id], |r| {
            Ok(Etiket { id: r.get(0)?, ad: r.get(1)?, kullanim: r.get(2)? })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    etiketler.sort_by(|a, b| etiket_sirasi(&a.ad, &b.ad));

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

/// Seansa etiket koyar; aynı anahtarla etiket varsa onu kullanır, yoksa
/// oluşturur. Yazma + log **tek transaction**'da (desen `notes::not_kaydet`
/// ile aynı) — log başarısız olursa etiket bağı da geri alınır.
///
/// Aynı etiket aynı seansa iki kez eklenirse (`ON CONFLICT ... DO NOTHING`)
/// hata VERMEZ, idempotenttir: terapist aynı etikete iki kez tıklarsa ikinci
/// tıklama sessizce no-op'tur VE bu no-op **log yazmaz** (bkz. modül
/// başlığı: hiçbir satırı etkilemeyen işlem loglanmaz).
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
    let anahtar = ad_anahtar_uret(&normal);

    let tx = conn.unchecked_transaction()?;

    // Ayni anahtarla etiket VARSA onu kullan -- gorunen ad ILK yazildigi
    // haliyle kalir ("Kaygi" once eklendiyse sonraki "kaygi" cagrisi
    // gorunumu degistirmez, yalnizca ayni id'ye baglanir). YOKSA yeni satir
    // olusturulur.
    tx.execute(
        "INSERT INTO tags (ad, ad_anahtar) VALUES (?1, ?2)
         ON CONFLICT(ad_anahtar) DO NOTHING",
        rusqlite::params![normal, anahtar],
    )?;
    let (tag_id, gorunen_ad): (i64, String) = tx
        .query_row("SELECT id, ad FROM tags WHERE ad_anahtar = ?1", [&anahtar], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })?;

    // DONUS DEGERI (etkilenen satir sayisi) BURADA ONEMLI: etiket zaten bu
    // seansa bagliysa 0 doner ve asagida log YAZILMAZ (bkz. modul basligi).
    let eklendi = tx.execute(
        "INSERT INTO progress_note_tags (appointment_id, tag_id) VALUES (?1, ?2)
         ON CONFLICT(appointment_id, tag_id) DO NOTHING",
        rusqlite::params![appointment_id, tag_id],
    )? > 0;

    let kullanim: i64 = tx.query_row(
        "SELECT COUNT(*) FROM progress_note_tags WHERE tag_id = ?1",
        [tag_id],
        |r| r.get(0),
    )?;

    if eklendi {
        // Etiket ekleme/kaldirma NOT DUZENLEMESI gibi sik bir islem -- ayni
        // (eylem, varlik, varlik_id) uclusuyle `etiket_kaldir` ile
        // PAYLASILIR (bkz. modul basligi). Etiket ADI buraya ASLA gecmez.
        kaydet(
            &tx,
            Eylem::Duzenleme,
            VARLIK_NOT,
            &appointment_id.to_string(),
            cihaz,
            None,
            LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
        )?;
    }

    tx.commit()?;
    Ok(Etiket { id: tag_id, ad: gorunen_ad, kullanim })
}

/// Seanstan etiketi kaldırır. Sözlük temizliği burada DEĞİL, tetikleyicide
/// yapılır (bkz. modül başlığı ve `schema.rs`'teki
/// `progress_note_tags_temizle_kullanilmayan`).
///
/// `DELETE`'in etkilediği satır sayısı SIFIRSA (bilinmeyen `tag_id`, ya da
/// bu seansa hiç bağlanmamış bir etiket) `DepoHatasi::Bulunamadi` döner ve
/// **log yazılmaz** (bkz. modül başlığı: hiçbir satırı etkilemeyen işlem
/// loglanmaz — desen `appointments.rs`'teki `etkilenen == 0 → Bulunamadi`
/// ile aynı).
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

    let silinen = tx.execute(
        "DELETE FROM progress_note_tags WHERE appointment_id = ?1 AND tag_id = ?2",
        rusqlite::params![appointment_id, tag_id],
    )?;
    if silinen == 0 {
        // Bag zaten yoktu -- hicbir satiri etkilemeyen bir islem. `tx` burada
        // commit EDILMEDEN dusuyor (rollback), zaten hicbir yan etkisi yoktu.
        return Err(DepoHatasi::Bulunamadi);
    }

    // Sozluk temizligi ARTIK burada DEGIL: `progress_note_tags_temizle_
    // kullanilmayan` tetikleyicisi yukaridaki DELETE'ten SONRA otomatik
    // calisir (bkz. modul basligi).

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
/// başlığı). Bu yol da `OturumBasi` ile birleştirilir (bkz. modül başlığı).
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

    /// Denetim kaydındaki TÜM satırların (`olay_zamani` DAHİL — brief
    /// "bütün sütunlar" diyor, inceleme düzeltmesi), sızıntı taramasına
    /// uygun tek bir metne birleştirilmiş hâli (desen `danisan_seanslari.rs`
    /// ile aynı, genişletilmiş).
    fn tum_log_metni(c: &rusqlite::Connection) -> String {
        son_kayitlar(c, 1000)
            .unwrap()
            .into_iter()
            .map(|k| {
                format!(
                    "{} {} {} {} {} {:?}",
                    k.olay_zamani, k.eylem, k.varlik, k.varlik_id, k.cihaz, k.ayrinti
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// `dk_once` dakika onceye ait bir log satirini DOGRUDAN (API'yi
    /// kullanmadan) yazar; pencere disi senaryolari icin (desen
    /// `notes.rs`/`audit.rs` testleriyle ayni: `audit_log`'a INSERT
    /// serbesttir, yasak olan UPDATE/DELETE'tir).
    fn eski_satir_ekle(
        c: &rusqlite::Connection,
        eylem: &str,
        varlik: &str,
        varlik_id: &str,
        dk_once: i64,
    ) {
        let zaman = (time::OffsetDateTime::now_utc() - time::Duration::minutes(dk_once))
            .replace_nanosecond(0)
            .unwrap()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap();
        c.execute(
            "INSERT INTO audit_log (olay_zamani, eylem, varlik, varlik_id, cihaz, ayrinti)
             VALUES (?1, ?2, ?3, ?4, 'masaustu', NULL)",
            rusqlite::params![zaman, eylem, varlik, varlik_id],
        )
        .unwrap();
    }

    // --- Kimlik normalleşmesi (`ad_anahtar_uret`) -------------------------

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
    fn harf_isaretli_ve_isaretsiz_kelimeler_farkli_etikettir() {
        // INCELEME DUZELTMESI (Important-3): kimlik icin `search::katla`
        // kullanmak "yas" (matem) ile "yaş"i (harf isaretli, tamamen farkli
        // bir kelime) ayni etikete birlestiriyordu -- yanlis klinik
        // siniflandirma. `ad_anahtar_uret` harf isaretlerini KORUR.
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let r1 = randevu(&c, cid, "2026-09-07T10:00");
        let r2 = randevu(&c, cid, "2026-09-14T10:00");

        let yas = etiket_ekle(&c, r1, "yas", Cihaz::Masaustu).unwrap();
        let yas_isaretli = etiket_ekle(&c, r2, "yaş", Cihaz::Masaustu).unwrap();

        assert_ne!(yas.id, yas_isaretli.id, "\"yas\" ve \"yaş\" FARKLI etiket olmali");
        let toplam: i64 = c.query_row("SELECT COUNT(*) FROM tags", [], |r| r.get(0)).unwrap();
        assert_eq!(toplam, 2, "iki farkli anlamli kelime iki ayri etiket satiri birakmali");
    }

    #[test]
    fn buyuk_kucuk_harf_donusumu_harf_isaretini_koruyarak_calisir() {
        // "Işık" (basi noktasiz buyuk I) ile "ışık" (kucuk, noktasiz i)
        // AYNI etiket olmali; "İzmir" (noktali buyuk İ) ile "izmir" de AYNI.
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let r1 = randevu(&c, cid, "2026-09-07T10:00");
        let r2 = randevu(&c, cid, "2026-09-14T10:00");
        let r3 = randevu(&c, cid, "2026-09-21T10:00");
        let r4 = randevu(&c, cid, "2026-09-28T10:00");

        let a1 = etiket_ekle(&c, r1, "Işık", Cihaz::Masaustu).unwrap();
        let a2 = etiket_ekle(&c, r2, "ışık", Cihaz::Masaustu).unwrap();
        assert_eq!(a1.id, a2.id, "\"Işık\" ve \"ışık\" ayni etiket olmali");

        let b1 = etiket_ekle(&c, r3, "İzmir", Cihaz::Masaustu).unwrap();
        let b2 = etiket_ekle(&c, r4, "izmir", Cihaz::Masaustu).unwrap();
        assert_eq!(b1.id, b2.id, "\"İzmir\" ve \"izmir\" ayni etiket olmali");

        assert_ne!(a1.id, b1.id, "iki farkli kelime hala farkli etiket olmali");
    }

    #[test]
    fn tamami_buyuk_harfli_ad_turkce_kurala_gore_kucultulur() {
        // "ISIK" (tamami buyuk, noktasiz I) -> "ısık" (noktasiz kucuk i)
        // -- "ışık" DEGIL: buyuk harfte harf isareti bilgisi zaten
        // kaybolmustur, fonksiyon var olmayan bir isareti UYDURMAZ. Yine de
        // "ISIK" yazan kisi byuk olasilikla "ışık" demek istemistir; bu
        // sinir taniyan bir davranistir, mukemmel bir tahmin degil (bkz.
        // `ad_anahtar_uret` dokumantasyonu).
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let r1 = randevu(&c, cid, "2026-09-07T10:00");
        let r2 = randevu(&c, cid, "2026-09-14T10:00");

        let buyuk = etiket_ekle(&c, r1, "ISIK", Cihaz::Masaustu).unwrap();
        let kucuk_isaretsiz = etiket_ekle(&c, r2, "ısık", Cihaz::Masaustu).unwrap();
        assert_eq!(buyuk.id, kucuk_isaretsiz.id, "\"ISIK\" \"ısık\"a esitlenmeli (\"ışık\"a degil)");

        let anahtar: String = c
            .query_row("SELECT ad_anahtar FROM tags WHERE id=?1", [buyuk.id], |r| r.get(0))
            .unwrap();
        assert_eq!(anahtar, "ısık");
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

    // --- Sozluk temizligi (tetikleyici) ------------------------------------

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
        assert_eq!(kaldi, 0, "son kullanimda etiket sozlukten silinmeli (tetikleyici)");
    }

    /// Görev 6 inceleme IMPORTANT-1: tetikleyici son kullanımı giden etiketi
    /// siliyor; `AUTOINCREMENT` olmadan SQLite silinen en büyük kimliği bir
    /// sonraki etikete yeniden verir ve istemcinin kimlikle tuttuğu şey
    /// (açık etiketli seanslar paneli) başka bir etikete kayardı. Kurulum
    /// tam o durumu üretir: silinen etiket tablonun EN BÜYÜK kimliği.
    #[test]
    fn silinen_etiketin_kimligi_yeni_etikete_verilmez() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");
        etiket_ekle(&c, rid, "aile", Cihaz::Masaustu).unwrap();
        let kriz = etiket_ekle(&c, rid, "kriz", Cihaz::Masaustu).unwrap();
        etiket_kaldir(&c, rid, kriz.id, Cihaz::Masaustu).unwrap();
        let kalan: i64 = c
            .query_row("SELECT COUNT(*) FROM tags WHERE id = ?1", [kriz.id], |r| r.get(0))
            .unwrap();
        assert_eq!(kalan, 0, "on kosul: tetikleyici etiketi silmis olmali");

        let ofke = etiket_ekle(&c, rid, "öfke", Cihaz::Masaustu).unwrap();
        assert!(ofke.id > kriz.id, "yeni kimlik {} eski {}'den buyuk olmali", ofke.id, kriz.id);
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
    fn randevu_silinince_kullanilmayan_etiket_sozlukten_de_temizlenir() {
        // MINOR-1 duzeltmesi: cascade ile giden BAG'in yaninda, artik
        // hicbir seansa bagli olmayan etiket ADI da sozlukte kalmamali --
        // veri en aza indirme. Tetikleyici `ON DELETE CASCADE`'in urettigi
        // silmeyi de yakalar (bkz. schema.rs V5 dokumantasyonu).
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");
        let e = etiket_ekle(&c, rid, "kriz", Cihaz::Masaustu).unwrap();

        c.execute("DELETE FROM appointments WHERE id=?1", [rid]).unwrap();

        let hala_var: i64 =
            c.query_row("SELECT COUNT(*) FROM tags WHERE id=?1", [e.id], |r| r.get(0)).unwrap();
        assert_eq!(
            hala_var, 0,
            "randevu silinince artik kullanilmayan etiket sozlukten de silinmeli (tetikleyici)"
        );
    }

    #[test]
    fn randevu_silinince_baska_seansta_kullanilan_etiket_sozlukte_kalir() {
        // Yukaridaki testin ARTI yonu: cascade silme her etiketi
        // silmiyor, yalnizca KULLANIMI SIFIRA DUSENI.
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let r1 = randevu(&c, cid, "2026-09-07T10:00");
        let r2 = randevu(&c, cid, "2026-09-14T10:00");
        let e = etiket_ekle(&c, r1, "aile", Cihaz::Masaustu).unwrap();
        etiket_ekle(&c, r2, "aile", Cihaz::Masaustu).unwrap();

        c.execute("DELETE FROM appointments WHERE id=?1", [r1]).unwrap();

        let hala_var: i64 =
            c.query_row("SELECT COUNT(*) FROM tags WHERE id=?1", [e.id], |r| r.get(0)).unwrap();
        assert_eq!(hala_var, 1, "baska seansta hala kullanilan etiket cascade ile silinmemeli");
    }

    // --- Yetkili kaynak / siralama ------------------------------------------

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

    // --- Sizinti ---------------------------------------------------------

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
        // Katlanmis/kucultulmus hali de (search.rs'teki emsal test gibi) aranir.
        assert!(!log.contains("çokgizlietiket"), "kucultulmus etiket adi loga sizmis: {log}");
        assert!(!log.contains("cokgizlietiket"), "katlanmis etiket adi loga sizmis: {log}");
        assert!(!log.contains("COKGIZLIETIKET"));
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

    // --- Bilinmeyen kimlikler / hicbir satiri etkilemeyen islemler --------

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
    fn bilinmeyen_tag_id_ile_kaldirma_bulunamadi_doner_log_yazilmaz() {
        // INCELEME DUZELTMESI (Important-2): `etiket_kaldir` DELETE'in
        // etkiledigi satir sayisina bakmiyordu -- seansta olmayan/hic var
        // olmayan bir tag_id ile 0 satir silinip `Bulunamadi` DONMEDEN
        // "resmi not degisti" diyen yanlis bir log satiri yaziliyordu.
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");
        let once = son_kayitlar(&c, 1000).unwrap().len();

        let hata = etiket_kaldir(&c, rid, 999, Cihaz::Masaustu).unwrap_err();
        assert!(matches!(hata, DepoHatasi::Bulunamadi));
        assert_eq!(
            son_kayitlar(&c, 1000).unwrap().len(),
            once,
            "hicbir satiri etkilemeyen kaldirma islemi log birakmamali"
        );
    }

    #[test]
    fn baglanmamis_ama_var_olan_etiketi_kaldirmak_da_bulunamadi_doner() {
        // Ayirt edici senaryo: `tag_id` GERCEKTEN var (baska bir seansa
        // bagli) ama BU seansa hic baglanmamis -- yine 0 satir silinir.
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let r1 = randevu(&c, cid, "2026-09-07T10:00");
        let r2 = randevu(&c, cid, "2026-09-14T10:00");
        let e = etiket_ekle(&c, r1, "aile", Cihaz::Masaustu).unwrap();

        let hata = etiket_kaldir(&c, r2, e.id, Cihaz::Masaustu).unwrap_err();
        assert!(matches!(hata, DepoHatasi::Bulunamadi));
    }

    #[test]
    fn zaten_bagli_etiketi_eklemek_pencere_disindaki_eski_satiri_bile_yeni_satira_cevirmez() {
        // INCELEME DUZELTMESI (Important-2): `etiket_ekle` bag zaten VARSA
        // (ON CONFLICT DO NOTHING no-op) log yazmamali. Bunu MERGE
        // PENCERESININ MASKELEMEDIGI bir kurulumla sinamak icin: gercek log
        // satiri API'den DEGIL, dogrudan SQL ile PENCERE DISINA (10 dk
        // once) konur -- boylece "ikinci ekleme log birakmamali" iddiasi,
        // OturumBasi'nin zaten sustur-muyor olmasiyla degil, GERCEKTEN
        // hicbir satiri etkilemedigi icin dogrulanir (mutasyon: etkilenen
        // satir kontrolu kaldirilirsa bu test KIRILIR, `OturumBasi`
        // penceresi 10 dakikalik farki susturamaz).
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");

        c.execute("INSERT INTO tags (ad, ad_anahtar) VALUES ('aile','aile')", []).unwrap();
        let tag_id: i64 =
            c.query_row("SELECT id FROM tags WHERE ad_anahtar='aile'", [], |r| r.get(0)).unwrap();
        c.execute(
            "INSERT INTO progress_note_tags (appointment_id, tag_id) VALUES (?1, ?2)",
            rusqlite::params![rid, tag_id],
        )
        .unwrap();
        eski_satir_ekle(&c, "duzenleme", "progress_note", &rid.to_string(), 10);

        let sonuc = etiket_ekle(&c, rid, "aile", Cihaz::Masaustu).unwrap();
        assert_eq!(sonuc.id, tag_id);

        assert_eq!(
            log_sayisi(&c, "duzenleme", "progress_note", &rid.to_string()),
            1,
            "zaten bagli etiketi tekrar eklemek hicbir satiri etkilemez -- pencere disindaki \
             eski satira ragmen YENI satir eklenmemeli"
        );
        let bag_sayisi: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM progress_note_tags WHERE appointment_id=?1 AND tag_id=?2",
                rusqlite::params![rid, tag_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(bag_sayisi, 1, "bag tekil kalmali, cogalmamali");
    }

    // --- Hacim: etiket_ekle/etiket_kaldir (Duzenleme) ----------------------

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

        eski_satir_ekle(&c, "duzenleme", "progress_note", &rid.to_string(), 10);

        etiket_ekle(&c, rid, "aile", Cihaz::Masaustu).unwrap();

        assert_eq!(
            log_sayisi(&c, "duzenleme", "progress_note", &rid.to_string()),
            2,
            "pencere disindaki eski satir yeni kaydi susturmamali -- pencere zamana bagli olmali"
        );
    }

    // --- Hacim: seans_etiketleri (Goruntuleme) -----------------------------
    //
    // INCELEME DUZELTMESI (Important-1): bu goruntuleme yolu HICBIR testle
    // korunmuyordu; incelemeci mutasyonla (Goruntuleme->Duzenleme,
    // OturumBasi->HerCagri) kanitladi -- 14/14 test hala YESIL kaliyordu.

    #[test]
    fn seans_etiketleri_dogru_eylem_varlik_ve_kimlikle_loglanir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");
        etiket_ekle(&c, rid, "aile", Cihaz::Masaustu).unwrap();

        seans_etiketleri(&c, rid, Cihaz::Masaustu).unwrap();

        assert_eq!(
            log_sayisi(&c, "goruntuleme", "progress_note", &rid.to_string()),
            1,
            "seans_etiketleri goruntuleme/progress_note/appointment_id olarak loglanmali"
        );
    }

    #[test]
    fn seans_etiketleri_otuz_goruntuleme_tam_olarak_bir_satir_uretir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");
        etiket_ekle(&c, rid, "aile", Cihaz::Masaustu).unwrap();
        let ekleme_log_sayisi = log_sayisi(&c, "duzenleme", "progress_note", &rid.to_string());

        for _ in 0..30 {
            seans_etiketleri(&c, rid, Cihaz::Masaustu).unwrap();
        }

        assert_eq!(
            log_sayisi(&c, "goruntuleme", "progress_note", &rid.to_string()),
            1,
            "30 ardisik seans_etiketleri cagrisi TAM OLARAK 1 goruntuleme satiri uretmeli"
        );
        // Duzenleme satirina DOKUNULMADI -- iki eylem birbirini gizlemez.
        assert_eq!(
            log_sayisi(&c, "duzenleme", "progress_note", &rid.to_string()),
            ekleme_log_sayisi
        );
    }

    #[test]
    fn seans_etiketleri_pencere_disindaki_eski_satiri_susturmaz() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");
        etiket_ekle(&c, rid, "aile", Cihaz::Masaustu).unwrap();

        eski_satir_ekle(&c, "goruntuleme", "progress_note", &rid.to_string(), 10);

        seans_etiketleri(&c, rid, Cihaz::Masaustu).unwrap();

        assert_eq!(
            log_sayisi(&c, "goruntuleme", "progress_note", &rid.to_string()),
            2,
            "pencere disindaki eski goruntuleme satiri yenisini susturmamali"
        );
    }

    // --- Hacim: etiketli_seanslar (Goruntuleme) -----------------------------

    #[test]
    fn etiketli_seanslar_dogru_eylem_varlik_ve_kimlikle_loglanir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");
        let e = etiket_ekle(&c, rid, "aile", Cihaz::Masaustu).unwrap();

        etiketli_seanslar(&c, e.id, Cihaz::Masaustu).unwrap();

        assert_eq!(
            log_sayisi(&c, "goruntuleme", "etiket", &e.id.to_string()),
            1,
            "etiketli_seanslar goruntuleme/etiket/tag_id olarak loglanmali"
        );
    }

    #[test]
    fn etiketli_seanslar_otuz_goruntuleme_tam_olarak_bir_satir_uretir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");
        let e = etiket_ekle(&c, rid, "aile", Cihaz::Masaustu).unwrap();

        for _ in 0..30 {
            etiketli_seanslar(&c, e.id, Cihaz::Masaustu).unwrap();
        }

        assert_eq!(
            log_sayisi(&c, "goruntuleme", "etiket", &e.id.to_string()),
            1,
            "30 ardisik etiketli_seanslar cagrisi TAM OLARAK 1 goruntuleme satiri uretmeli"
        );
    }

    #[test]
    fn etiketli_seanslar_pencere_disindaki_eski_satiri_susturmaz() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");
        let e = etiket_ekle(&c, rid, "aile", Cihaz::Masaustu).unwrap();

        eski_satir_ekle(&c, "goruntuleme", "etiket", &e.id.to_string(), 10);

        etiketli_seanslar(&c, e.id, Cihaz::Masaustu).unwrap();

        assert_eq!(
            log_sayisi(&c, "goruntuleme", "etiket", &e.id.to_string()),
            2,
            "pencere disindaki eski goruntuleme satiri yenisini susturmamali"
        );
    }

    // --- siralama (Gorev 6 inceleme MINOR-3) -----------------------------------

    /// Arayuzle ORTAK ornekler (`web/src/etiket/etiketAdi.test.ts` ayni
    /// dosyayi okur): istemci ekleme/kaldirmadan sonra listeyi yerelde
    /// siraliyor; iki uygulama ayrisirsa cipler, yeniden cekilene kadar
    /// sunucununkinden farkli sirada gorunurdu.
    #[test]
    fn siralama_ortak_ornekleri_saglar() {
        let ornekler: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("etiket_siralama_ornekleri.json")).unwrap();
        // Bos bir ornek dosyasi bu testi TOTOLOJIK yapardi (birinci bicim).
        assert!(ornekler.len() >= 6, "ornek dosyasi beklenenden kucuk");
        for o in &ornekler {
            let mut girdi: Vec<String> = serde_json::from_value(o["girdi"].clone()).unwrap();
            let beklenen: Vec<String> = serde_json::from_value(o["beklenen"].clone()).unwrap();
            assert_ne!(girdi, beklenen, "ornek zaten sirali -- hicbir sey olcmez: {}", o["ad"]);
            girdi.sort_by(|a, b| etiket_sirasi(a, b));
            assert_eq!(girdi, beklenen, "ornek: {}", o["ad"]);
        }
    }

    /// Etiket KIMLIGI (son inceleme M3): `normallesmis_ad` + `ad_anahtar_uret`
    /// kurali arayuzdeki `etiketAdiNormallestir` + `etiketAnahtari` ile ORTAK
    /// ornek dosyasina bagli (`web/src/etiket/etiketAdi.test.ts` ayni
    /// dosyayi okur). Istemci ayni etiketi kimlik+ad anahtariyla taniyor
    /// (`ayniEtiket`, acik panelin yeniden dogmasi); iki kural ayrisirsa
    /// sunucunun tek etiket saydigini istemci iki etiket sayardi.
    #[test]
    fn kimlik_ortak_ornekleri_saglar() {
        let ornekler: serde_json::Value =
            serde_json::from_str(include_str!("etiket_kimlik_ornekleri.json")).unwrap();
        let anahtar = |ad: &str| ad_anahtar_uret(&normallesmis_ad(ad));
        let ayni = ornekler["ayni_anahtar"].as_array().unwrap();
        let farkli = ornekler["farkli_anahtar"].as_array().unwrap();
        // Bos bir ornek dosyasi bu testi TOTOLOJIK yapardi (birinci bicim).
        assert!(ayni.len() >= 4 && farkli.len() >= 1, "ornek dosyasi beklenenden kucuk");
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        for o in ayni {
            let beklenen = o["anahtar"].as_str().unwrap();
            let girdiler: Vec<String> = serde_json::from_value(o["girdiler"].clone()).unwrap();
            let mut kimlikler = Vec::new();
            for g in &girdiler {
                assert_eq!(anahtar(g), beklenen, "ornek: {} / girdi {g:?}", o["ad"]);
                // Veritabani yolu da AYNI etiketi verir (UNIQUE ad_anahtar).
                let rid = randevu(&c, cid, "2026-09-07T10:00");
                kimlikler.push(etiket_ekle(&c, rid, g, Cihaz::Masaustu).unwrap().id);
            }
            kimlikler.dedup();
            assert_eq!(kimlikler.len(), 1, "ornek: {}", o["ad"]);
        }
        for o in farkli {
            let (a, b) = (o["a"].as_str().unwrap(), o["b"].as_str().unwrap());
            assert_ne!(anahtar(a), anahtar(b), "ornek: {}", o["ad"]);
        }
    }

    #[test]
    fn seans_etiketleri_ve_sozluk_turk_alfabesiyle_siralanir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-07T10:00");
        for ad in ["zaman", "şiddet", "çocukluk", "ılık"] {
            etiket_ekle(&c, rid, ad, Cihaz::Masaustu).unwrap();
        }
        let adlar = |l: Vec<Etiket>| l.into_iter().map(|e| e.ad).collect::<Vec<_>>();
        let beklenen = vec!["çocukluk", "ılık", "şiddet", "zaman"];
        assert_eq!(adlar(seans_etiketleri(&c, rid, Cihaz::Masaustu).unwrap()), beklenen);
        // Hepsi esit kullanimli: sozluk de ayni sirayi verir.
        assert_eq!(adlar(etiketleri_listele(&c, Cihaz::Masaustu).unwrap()), beklenen);
    }

    // --- etiketleri_listele --------------------------------------------------

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
    fn etiketleri_listele_denetime_yazmaz() {
        // ADI DUZELTILDI (inceleme bulgusu): eski ad
        // `etiketleri_listele_ve_seans_etiketleri_denetime_yazmaz` idi ama
        // `seans_etiketleri`'ni HIC CAGIRMIYORDU -- o yol GORUNTULEME olarak
        // loglanMALIDIR (bkz. yukaridaki `seans_etiketleri_*` testleri).
        // Bu test yalnizca `etiketleri_listele`'yi sinar.
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
