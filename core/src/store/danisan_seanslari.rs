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
//! # Önizleme: ilk ANLAMLI satır (son inceleme M3)
//!
//! `onizleme` notun ilk BOŞ OLMAYAN ve şablon başlığı OLMAYAN satırını
//! alır. Eskiden yalnızca ilk satırı alıyordu ve iki yalan üretiyordu: boş
//! satırla başlayan dolu bir not `""` dönüyor, arayüz "Not açıldı, henüz
//! boş" yazıyordu; DAP şablonlu HER notun önizlemesi "Veri:" oluyordu —
//! listede on seansın hepsi aynı görünüyordu.
//!
//! Şablon başlıkları elle İKİNCİ kez yazılmıyor: `templates` tablosundan
//! (şemanın tohumu, `schema.rs` V3) okunuyor. Arayüzün kopyası
//! (`web/src/seans/sablon.ts`) tohumla `sablon.test.ts` üzerinden eşit
//! tutuluyor. Arayüz, not kaydedildikten sonra listeyi YENİDEN ÇEKMEDEN
//! (silinemez `goruntuleme` satırı) aynı önizlemeyi yerelde hesaplıyor
//! (`web/src/seans/onizleme.ts`); iki uygulamanın ayrışmaması ORTAK bir
//! örnek dosyasıyla korunuyor (`core/src/store/onizleme_ornekleri.json`) —
//! bu modülün testi o dosyayı `include_str!` ile okur, TS testi de aynısını.
//!
//! `""` YALNIZCA içerik `trim()` sonrası tamamen boşsa döner. Yalnızca
//! şablon başlıklarından oluşan bir not (şablon eklenmiş, hiçbir şey
//! yazılmamış) boş SAYILMAZ: ilk başlık ("Veri:") döner — ekranda gerçekten
//! duran şey odur ve "henüz boş" demek içerik varken boş demek olurdu.
//!
//! ## Görev 3: Markdown biçimine uyum (eski VE yeni not, ikisi de)
//!
//! Not editörü Markdown'a geçtikten sonra (Görev 1-2) yeni şablon başlıkları
//! `"Veri:"` değil `"## Veri"` biçiminde eklenir; var olan notlar göç ETMEZ
//! (bkz. `store` modül başlığındaki "not içeriği düz metin kalır" kuralı) —
//! yani danışan dosyasında eski VE yeni biçimli notlar YAN YANA durur.
//! `sablon_baslik_eslesmesi` başlık satırını iki biçimde de tanır;
//! `bicimden_arindir` önizlemeye giren satırdaki Markdown blok önekini
//! (`#`, `-`, `1.`, `>`, `- [ ]`) ve satır içi `**`/`*` işaretlerini atar --
//! yoksa liste satırı "- **Danışan** kaygılı" önizlemede ham işaretleriyle
//! görünürdü. Önek OLMAYAN karakterler (kapanmamış `**`, boşluksuz `#etiket`)
//! olduğu gibi kalır; kural arayüzün kapalı kümesiyle (`web/src/not/markdown.tsx`)
//! birebir aynı tutulur.
//!
//! # Önizleme kırpması KARAKTER üzerinden
//!
//! `onizleme` seçtiği satırı `AZAMI_ONIZLEME` **karakterinde** kırpar
//! (`chars().take`, bayt değil).
//! Türkçe harfler (ı, ğ, ş, ö, ü, ç) UTF-8'de çok baytlıdır; bayt üzerinden
//! kırpma bir karakterin ortasından kesip geçersiz UTF-8 üretebilirdi.
//! İkinci satır (ve varsa devamı) SQL sorgusuyla diskten okunur --
//! `p.icerik` sütunu bütünüyle bir `String`'e girer, satır bazında
//! sınırlanmaz. Garanti daha dar: bu fonksiyonun DÖNÜŞ değerine (dolayısıyla
//! `DanisanSeansi`'ye ve JSON yanıtına) yalnızca kırpılmış TEK satır girer;
//! `onizleme` çağrısından sonra geri kalanı hiçbir yere taşınmadan düşer.
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
//! # Etiketler (Plan 6 Görev 6): TEK ek sorgu, N+1 DEĞİL
//!
//! Her seans ada göre sıralı etiket adlarını taşır (`etiketler`). Danışan
//! dosyası listenin üstünde "Etikete göre süz" seçimini ve her satırda
//! seansın etiketlerini bu alandan kurar; seans başına ayrı bir istek atmak
//! hem N+1 sorgu hem de seans başına bir görüntüleme demek olurdu.
//!
//! Adlar ana sorgudan AYRI, TEK bir sorguyla okunur ve randevu kimliğine göre
//! gruplanır. `GROUP_CONCAT` bilerek kullanılmadı: etiket adı serbest metin
//! (virgül, noktalı virgül içerebilir) ve SQLite'ın `GROUP_CONCAT`'i grup
//! içindeki sırayı garanti etmez -- ayırıcıya ve sıraya güvenen bir çözüm
//! "a, b" adlı tek etiketi iki etikete bölebilirdi.
//!
//! Başka danışanın etiketi listeye GİREMEZ ve bunu sağlayan şey ek sorgunun
//! filtresi DEĞİL: adlar yalnızca ana sorgunun (`WHERE a.client_id = ?1`)
//! döndürdüğü seans satırlarına, randevu kimliğiyle eklenir; haritada kalan
//! başka her kimlik düşer. Etiket bağı `progress_note_tags.appointment_id`'ye
//! bağlı olduğu için randevu başka danışana taşınınca etiketleri de onunla
//! gider (bkz. yukarıdaki KRİTİK bölüm). Ek sorgudaki `a.client_id` filtresi
//! yalnızca okunan satırları bu danışanla SINIRLAR (bütün etiket bağlarını
//! belleğe çekmemek için); kaldırılması ekranda hiçbir şeyi değiştirmez ve
//! bu yüzden hiçbir test onu kırmızıya döndüremez — mutasyonla ölçüldü, bkz.
//! Görev 6 raporu. Koruma ana sorgunun filtresidir ve o
//! `baska_danisanin_etiketi_listeye_sizmaz` ile ölçülüyor.
//!
//! Sıra `store::tags::etiket_sirasi` (Türk alfabesi): `seans_etiketleri`
//! ile AYNI fonksiyon, yani seans panelindeki çipler ile dosya listesindeki
//! satır aynı sırayı gösterir (Görev 6 inceleme MINOR-3).
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
use crate::store::tags::etiket_sirasi;
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
    /// Seansın etiket ADLARI, `ad_anahtar` sırasıyla (bkz. modül başlığı
    /// "Etiketler"). Etiketsiz seansta boş dizi -- `None` değil: "etiket yok"
    /// tek bir anlama sahip.
    pub etiketler: Vec<String>,
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
            // Etiket adı not içeriği kadar hassas (bkz. `store::tags` modül
            // başlığı): yalnızca SAYI basılır.
            .field("etiketler", &format_args!("<{} gizli>", self.etiketler.len()))
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
    // Sablon basliklari TOHUMDAN (templates tablosu) -- bkz. modul basligi.
    let basliklar = sablon_baslik_satirlari(conn)?;

    let mut ifade = conn.prepare(
        "SELECT a.id, a.baslangic, a.durum, a.ucret, a.odendi, p.icerik
           FROM appointments a
           LEFT JOIN progress_notes p ON p.appointment_id = a.id
          WHERE a.client_id = ?1
          ORDER BY a.baslangic DESC, a.id DESC",
    )?;
    let mut liste = ifade
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
                not_ilk_satiri: icerik.map(|m| onizleme(&m, &basliklar)),
                etiketler: Vec::new(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(ifade);

    // Etiketler: TEK ek sorgu (bkz. modul basligi "Etiketler" -- N+1 degil,
    // GROUP_CONCAT degil). `a.client_id` filtresi okumayi bu danisanla
    // sinirlar; sizintiyi onleyen sey asagidaki eslemenin yalnizca `liste`
    // satirlarina (ana sorgunun filtresi) yapilmasi.
    let mut etiket_ifadesi = conn.prepare(
        "SELECT pt.appointment_id, t.ad
           FROM progress_note_tags pt
           JOIN tags t ON t.id = pt.tag_id
           JOIN appointments a ON a.id = pt.appointment_id
          WHERE a.client_id = ?1
          ORDER BY pt.appointment_id",
    )?;
    let mut etiket_haritasi: std::collections::HashMap<i64, Vec<String>> =
        std::collections::HashMap::new();
    for satir in etiket_ifadesi
        .query_map([client_id], |s| Ok((s.get::<_, i64>(0)?, s.get::<_, String>(1)?)))?
    {
        let (randevu_id, ad) = satir?;
        etiket_haritasi.entry(randevu_id).or_default().push(ad);
    }
    drop(etiket_ifadesi);
    for seans in &mut liste {
        if let Some(mut adlar) = etiket_haritasi.remove(&seans.appointment_id) {
            adlar.sort_by(|a, b| etiket_sirasi(a, b));
            seans.etiketler = adlar;
        }
    }

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

/// Şablon başlıklarının notta göründüğü satırların KÖK adları (`"Veri"`,
/// `"Değerlendirme"`, …) -- ne kolon eklenmiş (`"Veri:"`, eski biçim) ne `#`
/// önekli (`"## Veri"`, yeni biçim, bkz. `sablon_baslik_eslesmesi`). Hangi
/// biçimin nasıl tanınacağı burada DEĞİL, orada kurulur; TEK kaynak bu liste.
///
/// Kaynak `templates.basliklar` (JSON dizi) -- şemanın tohumu; liste burada
/// ikinci kez elle yazılmıyor. Çözülemeyen bir satır (bozuk JSON) atlanır:
/// önizleme bir kolaylıktır ve bozuk bir şablon satırı danışanın TÜM seans
/// listesini açılamaz hâle getirmemeli -- en kötü sonuç başlığın önizlemede
/// görünmesi.
fn sablon_baslik_satirlari(conn: &Connection) -> Result<Vec<String>, DepoHatasi> {
    let mut ifade = conn.prepare("SELECT basliklar FROM templates")?;
    let ham = ifade
        .query_map([], |s| s.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ham.iter().filter_map(|j| serde_json::from_str::<Vec<String>>(j).ok()).flatten().collect())
}

/// Bir satırın başındaki Markdown başlık önekini (`#`, `##` ya da `###` +
/// TAM OLARAK BİR boşluk) ayıklar; varsa önek atılmış GÖVDEYİ döner.
///
/// Arayüzdeki kapalı kümenin (`web/src/not/desenler.ts::BASLIK_DUZENLI`,
/// `/^(#{1,3}) (.*)$/`) BİREBİR karşılığı: dört ve üzeri `#` başlık SAYILMAZ
/// (`#### x` arayüzde de düz metin kalır) ve boşluksuz `#etiket` başlık
/// SAYILMAZ (öneki atılmadan olduğu gibi kalması gereken bir biçim -- görev
/// talimatı). `#` ASCII (1 bayt/karakter) olduğu için bayt dilimlemesi
/// karakter sınırını asla bölmez.
fn baslik_onekini_ayikla(satir: &str) -> Option<&str> {
    let hash_sayisi = satir.chars().take_while(|c| *c == '#').count();
    if hash_sayisi == 0 || hash_sayisi > 3 {
        return None;
    }
    satir[hash_sayisi..].strip_prefix(' ')
}

/// Şablon başlığı satırını HER İKİ biçimde tanır; tanırsa (önizlemenin
/// yalnızca başlıklardan oluşan bir notta YEDEK olarak döneceği) görüntü
/// metnini döner:
///
/// - **Eski biçim** (`"{baslik}:"`): iki nokta olduğu gibi kalır -- Markdown
///   öneki değil, notun kendi metnidir, atılmaz.
/// - **Yeni biçim** (`"#{1,3} {baslik}"`, Görev 2'den beri editörün ürettiği
///   biçim, bkz. `web/src/seans/sablon.ts::sablonMetni`): `#` öneki atılmış
///   hâliyle, yalnızca başlık adı.
///
/// Her iki biçimde de TAM eşleşme aranır: `"Veri: ek metin"` ya da
/// `"## Veri ek metin"` başlık SAYILMAZ -- başlıkla aynı satıra yazılmış asıl
/// not metnidir (bkz. `baslikla_ayni_satirda_metin_baslik_sayilmaz` testi).
/// Şablonda OLMAYAN bir başlık (örn. `"### Serbest başlık"`) da burada
/// eşleşmez: çağıran onu normal içerik satırı gibi işler, yalnızca `#`
/// önekini atar (bkz. `sablonda_olmayan_baslik_onek_atilir_atlanmaz` testi).
fn sablon_baslik_eslesmesi(satir: &str, basliklar: &[String]) -> Option<String> {
    if let Some(govde) = baslik_onekini_ayikla(satir) {
        return basliklar.iter().find(|b| b.as_str() == govde).cloned();
    }
    basliklar.iter().map(|b| format!("{b}:")).find(|eski| eski == satir)
}

/// `**icerik**` (bitişik, en KISA kapanışla, iç boş OLAMAZ) eşleşmelerinin
/// bayt aralıklarını soldan sağa bulur: `(tam_baslangic, tam_bitis,
/// ic_baslangic, ic_bitis)`. Arayüzdeki `markdown.tsx::KALIN_DUZENLI`
/// (`/\*\*(.+?)\*\*/g`) ile AYNI lazy/global tarama kuralı: bir açılıştan
/// sonra iç boş kalırsa (`****`) o açılış eşleşmez, tarama açılıştan BİR
/// SONRAKİ karakterden devam eder (regex motorunun başarısız denemeden sonra
/// başlangıç konumunu bir ilerletmesiyle birebir).
fn kalin_araliklari(metin: &str) -> Vec<(usize, usize, usize, usize)> {
    let mut sonuclar = Vec::new();
    let mut ara = 0usize;
    while let Some(rel) = metin[ara..].find("**") {
        let acilis = ara + rel;
        let ic_baslangic = acilis + 2;
        if let Some(rel2) = metin.get(ic_baslangic..).and_then(|s| s.find("**")) {
            let kapanis = ic_baslangic + rel2;
            if kapanis > ic_baslangic {
                sonuclar.push((acilis, kapanis + 2, ic_baslangic, kapanis));
                ara = kapanis + 2;
                continue;
            }
        }
        ara = acilis + 1;
    }
    sonuclar
}

/// `*icerik*` için `kalin_araliklari` ile AYNI kural, tek yıldızla (bkz.
/// `markdown.tsx::ITALIK_DUZENLI`, `/\*(.+?)\*/g`). Yalnızca kalın
/// geçişinden ARTA KALAN metin parçaları üzerinde çağrılır -- kalın içeriği
/// tekrar ayrıştırılmaz (bkz. `markdown.tsx` modül başlığındaki kural).
fn italik_araliklari(metin: &str) -> Vec<(usize, usize, usize, usize)> {
    let mut sonuclar = Vec::new();
    let mut ara = 0usize;
    while ara < metin.len() {
        let Some(rel) = metin[ara..].find('*') else { break };
        let acilis = ara + rel;
        let ic_baslangic = acilis + 1;
        if let Some(rel2) = metin.get(ic_baslangic..).and_then(|s| s.find('*')) {
            let kapanis = ic_baslangic + rel2;
            if kapanis > ic_baslangic {
                sonuclar.push((acilis, kapanis + 1, ic_baslangic, kapanis));
                ara = kapanis + 1;
                continue;
            }
        }
        ara = acilis + 1;
    }
    sonuclar
}

/// Satır içi `**kalın**`/`*italik*` işaretlerini kaldırır, İÇERİĞİ olduğu
/// gibi bırakır (`"**Danışan** kaygılı"` -> `"Danışan kaygılı"`). Kapanışı
/// bulunamayan tek bir `*`/`**` METİN olarak kalır -- arayüzdeki
/// `markdown.tsx::satirIci` ile aynı, yalnızca React düğümleri yerine düz
/// metin üretir.
fn bicim_isaretlerini_kaldir(metin: &str) -> String {
    let mut sonuc = String::with_capacity(metin.len());
    let mut konum = 0usize;
    for (acilis, kapanis, ic_b, ic_s) in kalin_araliklari(metin) {
        if acilis > konum {
            sonuc.push_str(&italik_isaretlerini_kaldir(&metin[konum..acilis]));
        }
        sonuc.push_str(&metin[ic_b..ic_s]);
        konum = kapanis;
    }
    if konum < metin.len() {
        sonuc.push_str(&italik_isaretlerini_kaldir(&metin[konum..]));
    }
    sonuc
}

fn italik_isaretlerini_kaldir(metin: &str) -> String {
    let mut sonuc = String::with_capacity(metin.len());
    let mut konum = 0usize;
    for (acilis, kapanis, ic_b, ic_s) in italik_araliklari(metin) {
        if acilis > konum {
            sonuc.push_str(&metin[konum..acilis]);
        }
        sonuc.push_str(&metin[ic_b..ic_s]);
        konum = kapanis;
    }
    if konum < metin.len() {
        sonuc.push_str(&metin[konum..]);
    }
    sonuc
}

/// Önizlemeye giren TEK satırdaki Markdown blok önekini (başlık, madde,
/// numaralı liste, alıntı, onay kutusu) atar, ardından satır içi
/// kalın/italik işaretlerini kaldırır. Önekli OLMAYAN her karakter --
/// örneğin kapanmamış `**`, boşluksuz `#etiket`, tek başına `*` -- Markdown
/// sayılmaz ve olduğu gibi kalır (arayüzdeki `markdown.tsx` çeviricisiyle
/// aynı davranış, bkz. o dosyanın modül başlığı).
fn bicimden_arindir(satir: &str) -> String {
    let govde = if let Some(g) = baslik_onekini_ayikla(satir) {
        g
    } else if let Some(g) = onay_kutusu_ayikla(satir) {
        g
    } else if let Some(g) = satir.strip_prefix("- ") {
        g
    } else if let Some(g) = numarali_onekini_ayikla(satir) {
        g
    } else if let Some(g) = satir.strip_prefix('>') {
        g.strip_prefix(' ').unwrap_or(g)
    } else {
        satir
    };
    bicim_isaretlerini_kaldir(govde)
}

/// `"- [ ] "` / `"- [x] "` / `"- [X] "` önekini ayıklar; arayüzdeki
/// `ONAY_KUTUSU_DUZENLI` (`/^- \[([ xX])\] ?(.*)$/`) gibi kapanıştan sonraki
/// boşluk OPSİYONELDİR -- önce boşluklu biçim denenir, yoksa boşluksuz.
/// (Düz `"- "` maddeyle karışmaması için `bicimden_arindir`'de bu kontrol
/// `- ` kontrolünden ÖNCE gelir.)
fn onay_kutusu_ayikla(satir: &str) -> Option<&str> {
    for onek in ["- [ ] ", "- [x] ", "- [X] ", "- [ ]", "- [x]", "- [X]"] {
        if let Some(govde) = satir.strip_prefix(onek) {
            return Some(govde);
        }
    }
    None
}

/// `"1. "`, `"12. "` gibi numaralı liste önekini ayıklar (bkz.
/// `NUMARALI_DUZENLI`, `/^\d+\. (.*)$/`): en az bir rakam, ardından TAM
/// OLARAK `". "`.
fn numarali_onekini_ayikla(satir: &str) -> Option<&str> {
    let basamak_sonu = satir.find(|c: char| !c.is_ascii_digit())?;
    if basamak_sonu == 0 {
        return None;
    }
    satir[basamak_sonu..].strip_prefix(". ")
}

/// Notun önizlemesi: ilk boş olmayan, şablon başlığı olmayan satır; Markdown
/// öneki ve satır içi işaretleri atılmış hâliyle, `AZAMI_ONIZLEME`
/// KARAKTERDE kırpılır (bkz. modül başlığı).
///
/// # Eski VE yeni başlık biçimi
///
/// Görev 2'den önce şablon başlıkları `"Veri:"` satırı olarak eklenirdi;
/// Görev 2'den sonra editör `"## Veri"` üretir (`sablon.ts::sablonMetni`).
/// Var olan notlar göç ETMEZ (bkz. modül başlığı) -- bu yüzden önizleme
/// ikisini de tanımalı, yoksa eski notların önizlemesi bozulur.
/// `sablon_baslik_eslesmesi` her iki biçimi de sınar.
///
/// # `\r\n` VE tek başına `\r` normalleştirilir
///
/// `str::lines()` `"\r\n"`'yi doğru böler ama TEK BAŞINA `"\r"`'yi (eski
/// Mac satır sonu) BÖLMEZ -- öyle bir not, satır ayracına hiç rastlamadan
/// `\r`'yi bir "satırın" İÇİNDE taşır ve hem başlık karşılaştırmasını hem
/// dönen metni bozar. Arayüz çeviricisi (`markdown.tsx`) aynı normalleşmeyi
/// giriş anında yapıyor; burada da GİRİŞTE yapılır, `progress_notes.icerik`
/// diskte DEĞİŞMEZ (yalnızca bu fonksiyonun yerel değişkeni).
///
/// # Kırpma KARAKTER üzerinden
///
/// Türkçe harfler çok baytlı, bayt kırpması UTF-8'i ortasından bölerdi.
/// Kırpma Markdown ayıklamasından SONRA uygulanır: `AZAMI_ONIZLEME` "ekranda
/// görünecek 120 karakter" sözleşmesidir, atılan `**`/`##` önekleri bu
/// sayıma girmemeli.
fn onizleme(metin: &str, baslik_satirlari: &[String]) -> String {
    let normal = metin.replace("\r\n", "\n").replace('\r', "\n");

    // Yalnizca basliklardan olusan notun yedegi: ilk baslik (bkz. modul
    // basligi -- `""` yalnizca TAMAMEN bos icerik icin).
    let mut ilk_baslik: Option<String> = None;
    for satir in normal.lines() {
        let s = satir.trim();
        if s.is_empty() {
            continue;
        }
        if let Some(baslik_adi) = sablon_baslik_eslesmesi(s, baslik_satirlari) {
            ilk_baslik.get_or_insert(baslik_adi);
            continue;
        }
        return bicimden_arindir(s).chars().take(AZAMI_ONIZLEME).collect();
    }
    ilk_baslik.unwrap_or_default().chars().take(AZAMI_ONIZLEME).collect()
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
        tags::{etiket_ekle, etiket_kaldir},
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

    /// Son inceleme M3: onizleme ilk ANLAMLI satirdir. Ornekler arayuzle
    /// ORTAK dosyadan okunur (`web/src/seans/onizleme.test.ts` ayni dosyayi
    /// okur): arayuz kayittan sonra onizlemeyi yerelde hesapliyor ve iki
    /// uygulama ayrisirsa liste, yeniden cekilene kadar sunucununkinden
    /// farkli bir satir gosterirdi. Her ornek GERCEK yoldan gecer (not
    /// kaydet -> liste), yalnizca yardimci fonksiyondan degil.
    #[test]
    fn onizleme_ortak_ornekleri_saglar() {
        let ornekler: Vec<serde_json::Value> = serde_json::from_str(include_str!(
            "onizleme_ornekleri.json"
        ))
        .unwrap();
        // Bos bir ornek dosyasi bu testi TOTOLOJIK yapardi (birinci bicim).
        assert!(ornekler.len() >= 10, "ornek dosyasi beklenenden kucuk");
        let (_d, c) = kurulum();
        for (i, o) in ornekler.iter().enumerate() {
            let ad = o["ad"].as_str().unwrap();
            let icerik = o["icerik"].as_str().unwrap();
            let beklenen = o["beklenen"].as_str().unwrap();
            let cid = danisan(&c, &format!("Danisan {i}"));
            let rid = randevu(&c, cid, "2026-09-14T10:00");
            not_kaydet(&c, rid, "dap", icerik, Cihaz::Masaustu).unwrap();
            let liste = danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();
            assert_eq!(liste[0].not_ilk_satiri.as_deref(), Some(beklenen), "ornek: {ad}");
        }
    }

    /// Baslik listesi TOHUMDAN (templates tablosu) okunur, elle yazilmis bir
    /// kopyadan DEGIL: tabloya yeni bir baslik eklenince o satir da
    /// atlanir. Elle yazilmis bir liste bu testi kirar. Iki yon: tabloda
    /// OLMAYAN "Gozlem:" satiri atlanmaz (her seyi atlayan bir uygulama da
    /// ilk iddiayi gecerdi -- yedinci bicim).
    #[test]
    fn baslik_listesi_sablon_tablosundan_turetilir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-14T10:00");
        not_kaydet(&c, rid, "dap", "Gözlem:\nsakin görünüyordu", Cihaz::Masaustu).unwrap();

        let once = danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();
        assert_eq!(once[0].not_ilk_satiri.as_deref(), Some("Gözlem:"));

        c.execute(
            "UPDATE templates SET basliklar = '[\"Gözlem\",\"Plan\"]' WHERE kod = 'serbest'",
            [],
        )
        .unwrap();
        let sonra = danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();
        assert_eq!(sonra[0].not_ilk_satiri.as_deref(), Some("sakin görünüyordu"));
    }

    // --- Gorev 3 incelemesi (CRITICAL duzeltmesi): Markdown bicimi/onek
    // arindirma senaryolarinin TAMAMI (yeni bicim baslik, liste/onay/numarali
    // onekleri, kalin/italik arindirma, \r normallestirmesi, cok baytli
    // kirpma) `onizleme_ornekleri.json`'a tasindi -- o dosyayi HEM bu
    // modulun `onizleme_ortak_ornekleri_saglar` testi HEM
    // `web/src/seans/onizleme.test.ts` okuyor, iki uygulamanin sessizce
    // ayrismasinin bekcisi artik SADECE o dosya. Burada yalnizca bu module
    // OZGU olan iki test kalir: sablon basligi tablosundan TURETILDIGI
    // (asagida) ve `AZAMI_ONIZLEME` sabitinin duz sayiyla pinlendigi
    // (yukarida) -- ikisi de TS tarafinin sinamadigi, yalnizca sunucu
    // deposuna ait davranislar.

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

    #[test]
    fn etiketsiz_seans_bos_etiket_listesi_doner() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        randevu(&c, cid, "2026-09-14T10:00");
        let liste = danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();
        assert!(liste[0].etiketler.is_empty());
    }

    #[test]
    fn her_seans_kendi_etiketlerini_ada_gore_sirali_tasir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let eski = randevu(&c, cid, "2026-09-07T10:00");
        let yeni = randevu(&c, cid, "2026-09-14T10:00");
        // Sira `tags::etiket_sirasi` (Turk alfabesi, harf duyarsiz): ne
        // ekleme sirasi (rowid) ne ham `ad`'in bayt sirasi ("Zor" 'Z' < 'k'
        // ile basa gelirdi) ne de `ad_anahtar`'in bayt sirasi ("çocukluk"
        // 'z'den sonra gelirdi). Ekleme sirasi beklenenin tersi.
        etiket_ekle(&c, yeni, "Zor", Cihaz::Masaustu).unwrap();
        etiket_ekle(&c, yeni, "uyku", Cihaz::Masaustu).unwrap();
        etiket_ekle(&c, yeni, "kaygi", Cihaz::Masaustu).unwrap();
        etiket_ekle(&c, yeni, "çocukluk", Cihaz::Masaustu).unwrap();
        etiket_ekle(&c, eski, "kaygi", Cihaz::Masaustu).unwrap();

        let liste = danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();
        assert_eq!(liste[0].appointment_id, yeni);
        assert_eq!(liste[0].etiketler, vec!["çocukluk", "kaygi", "uyku", "Zor"]);
        assert_eq!(liste[1].appointment_id, eski);
        assert_eq!(liste[1].etiketler, vec!["kaygi"]);
    }

    #[test]
    fn kaldirilan_etiket_listede_gorunmez() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-14T10:00");
        let e = etiket_ekle(&c, rid, "kaygi", Cihaz::Masaustu).unwrap();
        etiket_ekle(&c, rid, "uyku", Cihaz::Masaustu).unwrap();
        etiket_kaldir(&c, rid, e.id, Cihaz::Masaustu).unwrap();

        let liste = danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();
        assert_eq!(liste[0].etiketler, vec!["uyku"]);
    }

    #[test]
    fn baska_danisanin_etiketi_listeye_sizmaz() {
        let (_d, c) = kurulum();
        let ayse = danisan(&c, "Ayse");
        let mehmet = danisan(&c, "Mehmet");
        let r_ayse = randevu(&c, ayse, "2026-09-14T10:00");
        let r_mehmet = randevu(&c, mehmet, "2026-09-14T12:00");
        etiket_ekle(&c, r_ayse, "aile", Cihaz::Masaustu).unwrap();
        etiket_ekle(&c, r_mehmet, "MEHMETIN_ETIKETI", Cihaz::Masaustu).unwrap();

        let liste = danisan_seanslari(&c, ayse, Cihaz::Masaustu).unwrap();
        assert_eq!(liste.len(), 1);
        // Iki yon: Ayse'nin etiketi GELIR (hic etiket dondurmeyen bir sorgu
        // da "sizmiyor" testini gecerdi), Mehmet'inki gelmez.
        assert_eq!(liste[0].etiketler, vec!["aile"]);
        let metin = format!("{:?}", liste.iter().map(|s| s.etiketler.clone()).collect::<Vec<_>>());
        assert!(!metin.contains("MEHMETIN_ETIKETI"));
    }

    #[test]
    fn randevu_baska_danisana_tasinirsa_etiketleri_de_onunla_gider() {
        let (_d, c) = kurulum();
        let ayse = danisan(&c, "Ayse");
        let mehmet = danisan(&c, "Mehmet");
        let rid = randevu(&c, ayse, "2026-09-14T10:00");
        etiket_ekle(&c, rid, "tasinan", Cihaz::Masaustu).unwrap();

        randevu_danisani_degistir(&c, rid, mehmet);

        assert!(danisan_seanslari(&c, ayse, Cihaz::Masaustu).unwrap().is_empty());
        let liste = danisan_seanslari(&c, mehmet, Cihaz::Masaustu).unwrap();
        assert_eq!(liste[0].etiketler, vec!["tasinan"]);
    }

    #[test]
    fn debug_ciktisi_etiket_adini_basmaz() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-14T10:00");
        etiket_ekle(&c, rid, "GIZLI_ETIKET", Cihaz::Masaustu).unwrap();

        let liste = danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();
        let hata_ayikla = format!("{:?}", liste[0]);
        assert!(!hata_ayikla.contains("GIZLI_ETIKET"));
        assert!(hata_ayikla.contains("<1 gizli>"));
    }

    #[test]
    fn json_ciktisi_etiketler_alanini_dizi_olarak_tasir() {
        let (_d, c) = kurulum();
        let cid = danisan(&c, "Ayse");
        let rid = randevu(&c, cid, "2026-09-14T10:00");
        etiket_ekle(&c, rid, "kaygi", Cihaz::Masaustu).unwrap();
        let liste = danisan_seanslari(&c, cid, Cihaz::Masaustu).unwrap();
        let json = serde_json::to_value(&liste[0]).unwrap();
        assert_eq!(json["etiketler"], serde_json::json!(["kaygi"]));
    }
}
