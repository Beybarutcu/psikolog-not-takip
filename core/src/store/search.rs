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
//! erişimi tek satırın arkasına saklardı. Burada aynı şablon kopyalanmıyor —
//! ama gerekçe *"ayırt edilecek başka bir şey yok"* **değildir**; öyle demek
//! olduğundan fazlasını iddia etmek olurdu. İki arama pekâlâ ayrışır: hangi
//! danışanların eşleştiği ve **kimin not içeriğinden** parça döndüğü gerçek
//! bir ayrımdır, üstelik danışan kimliği bu kod tabanında zaten loglanabilir
//! bir bilgidir (`notes::danisan_notlari` tam da onu yazar).
//!
//! Gerekçe şudur: aramanın sonuç kümesi **sorgu metninin bir fonksiyonudur**
//! ve o metin hiçbir koşulda loglanamaz. Eşleşen danışan kimliklerini yazmak,
//! sorguyu yazmamakla elde edilen korumayı arkadan delerdi — art arda
//! aramaların eşleşme listeleri terimi geri kurmaya yeter ("kaygı" arayınca
//! dönen üç danışanın kim olduğu, terimin kendisinden az şey söylemez). Yani
//! burada kaydedilmeyen bir ayrım **vardır** ve bilerek kaydedilmemektedir.
//! Bedeli açıktır ve kabul edilmiştir: log *"bu terapist 14:03'te bu cihazdan
//! arama yaptı"* der, *"neyi buldu"* demez.
//!
//! # İki kip tek bütçeyi paylaşır — biri diğerini silemez
//!
//! `ara` iki ayrı sorgu çalıştırır (danışan adı, not içeriği) ve **tek** bir
//! `limit` bütçesi vardır. Naif birleştirme — ikisini arka arkaya ekleyip
//! sondan kırpmak — sessiz bir kullanıcı hatası üretir: danışan adlarında
//! yaygın bir terim ("Yılmaz") 61 danışanla eşleşirse, aynı terimi içeren
//! seans notu listenin altına değil **tamamen dışına** düşer. Terapist notun
//! var olduğunu asla göremez; arayüzde "sonuç yok" ile "sonuç kırpıldı"
//! ayırt edilemez.
//!
//! Bu yüzden bütçe paylaştırılır: her kipin `limit / 2` büyüklüğünde bir
//! **garanti tabanı** vardır, kullanılmayan taban diğerine devredilir. 61
//! danışan + 1 not, 50 sınırıyla: not kipi 1 satırlık payını alır, kalan 49
//! danışanlara gider. 40 + 40 ise 25 + 25 olur. Tek kip eşleşiyorsa bütçenin
//! tamamını o kullanır — taban bir tavan değildir. Toplam, `take` ile
//! **yapısal olarak** sınırlanır (sondan `truncate` değil): iki sorgu da
//! `LIMIT` dolusu satır döndürdüğünde bile üst sınır aşılamaz.
//!
//! ## Üçüncü kip (Görev 7): etiket, bütçenin ARTANINI alır — payı bozmaz
//!
//! Danışan/not paylaşımı yukarıdaki iki testle (`danisan_adlarinda_yaygin_
//! terim_...`, `iki_kip_de_bolsa_...`) TAM sayılarla sabitlenmiş; etiketi
//! üçüncü bir eşit ortak yapmak (ör. `limit / 3` tabanı) bu iki testi kırardı
//! çünkü etiket eşleşmesi yokken bile danışan/not payı küçülürdü. Bunun
//! yerine etiket **son sıradadır**: önce danışan/not payı yukarıdaki kuralla
//! hesaplanır (değişmeden), etiket yalnızca `kalan = toplam - danisan_payi -
//! not_payi` bütçesini alır. Danışan/not eşleşmesi azsa (aramaların büyük
//! çoğunluğu) etiket bütçenin neredeyse tamamını kullanır; ikisi de bol
//! eşleşiyorsa (`toplam`ı doldurmuşlarsa) etiket o aramada hiç görünmez.
//! Bu sessiz bir kayıp DEĞİLDİR: `kirpildi` etiketin kendi payını aşıp
//! aşmadığına da bakar (bkz. aşağıdaki "Kırpılma" bölümü).
//!
//! ## Kırpılma SESSİZ değil: `AramaYaniti::kirpildi`
//!
//! Bütçe paylaştırması sessiz kaybı **hafifletti, kaldırmadı**: 61 danışan
//! eşleşirse 12'si hâlâ düşer. Terapist "bu kadarmış" sanar ve var olan bir
//! notu bulamadığını fark etmez. Bu yüzden yanıt artık `kirpildi` bayrağı
//! taşıyor ve arayüz kullanıcıyı aramayı **daraltmaya** yönlendiriyor.
//!
//! Bayrak bir tahmin **değil**, ölçüm: her iki sorgu da `LIMIT sinir + 1`
//! ile çalışır. Fazladan gelen satır bütçeye katılmaz, yalnızca "en az bir
//! eşleşme daha var" demektir. "Sonuç sayısı == sınır" biçimindeki
//! *istemci* sezgisi (Görev 6'dan kalan geçici çözüm) tam 50 eşleşmede
//! **yanlış** uyarır ve iki kipin bütçesi ayrı ayrı dolduğunda uyarmayı
//! **kaçırır**; bu bayrak ikisini de düzeltir.
//!
//! **Sonuç sayısı ve kırpılma bilgisi LOGA YAZILMAZ** (bkz. yukarıdaki
//! "arama terimi erişim loguna asla yazılmaz"): bu, yalnızca gövde
//! meselesidir. `kaydet` çağrısı `kirpildi`'yı görmez bile.
//!
//! Sıralama sözleşmesi: önce danışanlar (ada göre, `COLLATE NOCASE`), sonra
//! notlar (en yeni seanstan en eskiye). `LIMIT` her sorgunun **içinde**
//! olduğu için sıralama hangi satırların hayatta kalacağını da belirler —
//! `ASC`'ye dönmüş bir `ORDER BY` terapiste en yeni değil **en eski** 50 notu
//! gösterirdi; testlerle sabitlenir.
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
///
/// # İstemcide de AYNI sayı var, derleyici bunu KONTROL ETMEZ (Görev 6d)
///
/// `web/src/arama/HizliArama.tsx` kendi `ASGARI_SORGU` sabitini tutar (bkz.
/// o dosyadaki yorum -- kontrol yalnızca sunucuda olsaydı her tek harfte
/// gereksiz bir istek giderdi). İki sabit yalnızca YORUMLA eşleşiyor;
/// biri değişip diğeri unutulursa (istemci "en az 2 karakter" derken
/// sunucu 3'ten aşağısını reddeder, ya da tersi) kullanıcı "yazmaya devam
/// edin" ile "sonuç yok" arasında yanlış bir mesaj görür. Çapraz kontrol
/// testi bunu sabitler: `tests::asgari_sorgu_istemciyle_ayni`.
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
///
/// # Not metni `duz_metin`'den (HTML değil)
/// Resmî not artık HTML saklar; arama HTML'e değil `store::duz_metin`'in
/// ürettiği `progress_notes.duz_metin` sütununa bakar: biçim etiketi araya
/// girse de metin bulunur, etiket adı ("strong") eşleşmez (tasarım S4).
const SORGU_NOT: &str = "SELECT p.appointment_id, a.client_id, c.ad_soyad, a.baslangic, p.duz_metin
 FROM progress_notes p
 JOIN appointments a ON a.id = p.appointment_id
 JOIN clients c ON c.id = a.client_id
 WHERE replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(p.duz_metin),'ı','i'),'İ','i'),'ş','s'),'Ş','s'),'ğ','g'),'Ğ','g'),'ü','u'),'Ü','u'),'ö','o'),'Ö','o'),'ç','c'),'Ç','c') LIKE ?1 ESCAPE '\\'
 ORDER BY a.baslangic DESC, p.appointment_id DESC
 LIMIT ?2";

/// Etiket adı araması (Görev 7).
///
/// # KRİTİK: burada `katla` (YUMUŞAK eşleşme) kullanılır, `tags::ad_anahtar_uret` (KİMLİK) DEĞİL
///
/// `store::tags` modül başlığı bu ikisini bilerek ayırıyor: `ad_anahtar_uret`
/// yalnızca büyük/küçük harfi yok sayar, harf işaretlerini KORUR ("yas" ≠
/// "yaş") — bu KİMLİK için doğrudur, aksi hâlde anlamı farklı iki etiket tek
/// satıra birleşirdi. Arama başka bir sorunu çözüyor: danışan odada
/// olabildiği için terapist hızlıca, aksansız yazabilir ("kaygi" yazıp
/// "Kaygı" etiketini bulmalı) — tıpkı danışan adı ve not içeriği aramasında
/// olduğu gibi. Bu yüzden burada `katla` (ve aynı `lower()` + 12 `replace()`
/// SQL zinciri) kullanılır; `ad_anahtar_uret` bu dosyaya HİÇ girmez.
///
/// `kullanim`: kaç seansa bağlı olduğu (`tags::etiketleri_listele` ile aynı
/// `LEFT JOIN ... COUNT` deseni) — sonuç listesinde gösterilir, sıralamayı da
/// besler (bkz. `ara` içindeki Rust-tarafı sıralama).
///
/// # SINIR: buradaki `ORDER BY` GÖSTERİM sırası DEĞİLDİR (dal incelemesi M3)
///
/// Bu `ORDER BY` yalnızca **hangi satırların getirileceğini** belirler:
/// `LIMIT` sorgunun içinde olduğu için sıra, kesimin nereden yapılacağına
/// karar verir. Kullanıcının gördüğü sıra ise her zaman Rust tarafında
/// yeniden kurulur (`ara` içindeki `sort_by`: kullanım azalan, eşitlikte
/// `tags::etiket_sirasi` — Türk alfabesi).
///
/// İkisi **farklı harmanlamalar** kullanır ve bu bilerek böyledir: SQLite'ın
/// `COLLATE NOCASE`'i ASCII'dir ve Türkçe harfleri kod noktasına göre dizer
/// ('ç' U+00E7, 'z' U+007A'dan sonra gelir), `etiket_sirasi` ise Türk
/// alfabesine göre dizer. Sonuç: **eşit kullanımlı 51 ve üzeri etiket**
/// olduğunda hangi etiketlerin sınıra sığıp hangilerinin düşeceği Türk
/// alfabesi sırasına göre değil, `COLLATE NOCASE` sırasına göre belirlenir.
/// Gösterilen listenin kendi sırası yine doğrudur; **kesim** noktası
/// ayrışır.
///
/// Bu bir **kusur değil, kabul edilmiş bir sınırdır**: SQLite'a Türkçe
/// harmanlama öğretmek ya yeni bir bağımlılık ya da 12 `replace()` zincirinin
/// `ORDER BY`'a da taşınması demek olurdu; pratik etkisi ise yalnızca
/// "aynı kullanım sayısına sahip 50'den fazla etiket" durumunda, yalnızca
/// listenin kuyruğunda görülür ve `kirpildi` bayrağı kullanıcıyı zaten
/// aramayı daraltmaya yönlendirir.
///
/// **Bu yorum bir koruma değildir** (10. biçim): tarif ettiği durumu
/// yakalayan bir test YOKTUR ve davranış bilerek değiştirilmemiştir. Sınır
/// burada yalnızca **yazılıdır** ki bir sonraki okuyan onu kusur sanıp
/// "düzeltmesin" ya da farkında olmadan ona güvenmesin.
const SORGU_ETIKET: &str = "SELECT t.id, t.ad, COUNT(pt.appointment_id) AS kullanim
 FROM tags t
 LEFT JOIN progress_note_tags pt ON pt.tag_id = t.id
 WHERE replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(t.ad),'ı','i'),'İ','i'),'ş','s'),'Ş','s'),'ğ','g'),'Ğ','g'),'ü','u'),'Ü','u'),'ö','o'),'Ö','o'),'ç','c'),'Ç','c') LIKE ?1 ESCAPE '\\'
 GROUP BY t.id, t.ad
 ORDER BY kullanim DESC, t.ad COLLATE NOCASE
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
    /// `"danisan"`, `"not"` veya `"etiket"`.
    pub tur: String,
    /// `tur == "etiket"` iken anlamsız: `0` (hiçbir danışanın kimliği
    /// olamaz — `clients.id` `AUTOINCREMENT`, 1'den başlar).
    pub client_id: i64,
    /// `tur == "etiket"` iken boş dizgi.
    pub danisan_adi: String,
    pub appointment_id: Option<i64>,
    pub tarih: Option<String>,
    /// Eşleşmenin çevresinden alınan bağlam parçası. `tur == "etiket"` iken
    /// boş dizgi — etiket adının kendisi zaten kısa, ayrıca bir bağlama
    /// gerek yok (bkz. `etiket_adi`).
    pub parca: String,
    /// Yalnızca `tur == "etiket"` iken dolu: etiketin kimliği.
    pub tag_id: Option<i64>,
    /// Yalnızca `tur == "etiket"` iken dolu: etiketin görünen adı.
    pub etiket_adi: Option<String>,
    /// Yalnızca `tur == "etiket"` iken dolu: etiketin kaç seansa bağlı olduğu.
    pub kullanim: Option<i64>,
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
            .field("tag_id", &self.tag_id)
            .field("etiket_adi", &"<gizli>")
            .field("kullanim", &self.kullanim)
            .finish()
    }
}

/// Bir aramanın tam yanıtı: sonuçlar **ve** listenin kırpılıp
/// kırpılmadığı.
///
/// # Neden çıplak `Vec` değil
///
/// Çıplak bir liste "sonuç yok" ile "sonuç kırpıldı"yı ayırt edilemez
/// kılıyordu; bütçe paylaştırması bu kaybı hafifletti ama kaldırmadı (bkz.
/// modül başlığı). Arayüz kullanıcıyı ancak gerçek bir işaretle aramayı
/// daraltmaya yönlendirebilir.
///
/// `Debug` **türetiliyor** ve bu güvenli: `sonuclar`ın öğeleri
/// `AramaSonucu`'nun ELLE yazılmış `Debug`'ından geçer (danışan adı, tarih
/// ve not parçası `<gizli>` basılır), `kirpildi` ise bir `bool`.
#[derive(Clone, Debug, Serialize)]
pub struct AramaYaniti {
    pub sonuclar: Vec<AramaSonucu>,
    /// Eşleşen en az bir kayıt daha var ama sınıra sığmadı.
    ///
    /// Bir tahmin değil ölçüm: sorgular `LIMIT sinir + 1` ile çalışır ve
    /// fazladan gelen satır yalnızca bu bayrağı besler.
    pub kirpildi: bool,
}

/// Türkçe harf katlaması — **1:1**, her karakter tam olarak bir karaktere
/// gider (bkz. modül başlığı; `parca_cikar` bu değişmezliğe dayanır).
///
/// SQL karşılığı `SORGU_DANISAN`/`SORGU_NOT` içindeki `lower()` + 12
/// `replace()` zinciridir: SQLite'ın `lower()`'ı ASCII olduğu için büyük
/// Türkçe harfler ayrıca eşlenir. İkisi ayrışırsa arama sessizce çalışmaz —
/// davranışsal testler her iki sorgu üzerinde bunu sabitler
/// (`her_katlanan_harf_*_iki_yonlu_calisir`, harf harf).
///
/// `'I'` ve `'i'` kolları **fazlalıktır** ve bilerek bırakılmıştır: ikisini
/// de aşağıdaki `d => d.to_ascii_lowercase()` kolu zaten `'i'`'ye götürür, bu
/// yüzden onları silen bir mutasyon hiçbir testi kırmaz. Burada durmalarının
/// nedeni okunabilirlik: "i ailesinin dört biçimi" tek satırda görünüyor.
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
/// Sıralama: önce danışanlar (ada göre, `COLLATE NOCASE`), sonra notlar (en
/// yeni seanstan en eskiye). Toplam sonuç sayısı kırpılmış limiti aşmaz ve
/// bütçe iki kip arasında paylaştırılır — bir kipin bolluğu diğerini
/// **tamamen** silemez (bkz. modül başlığı: "İki kip tek bütçeyi paylaşır").
pub fn ara(
    conn: &Connection,
    sorgu: &str,
    limit: i64,
    cihaz: Cihaz,
) -> Result<AramaYaniti, DepoHatasi> {
    let katli_sorgu = katla(sorgu.trim());
    // Once kontrol, SONRA log: cok kisa bir sorgu silinemez bir satir
    // birakmasin (bkz. modul basligi).
    if katli_sorgu.chars().count() < ASGARI_SORGU {
        return Ok(AramaYaniti { sonuclar: Vec::new(), kirpildi: false });
    }

    let desen = like_deseni(&katli_sorgu);
    // -1 SQLite'ta "sinirsiz" demektir; alt uctan da kirpiyoruz.
    let sinir = limit.clamp(1, AZAMI_SONUC);
    // BIR FAZLASINI iste. Fazladan gelen satir hicbir zaman kullaniciya
    // gosterilmez; yalnizca "en az bir eslesme daha var" demektir ve
    // `kirpildi`yi besler. Tahmin degil olcum: "sonuc sayisi == sinir"
    // sezgisi tam sinirdaki bir aramada YANLIS uyarirdi.
    let yoklama_siniri = sinir.saturating_add(1);

    let mut stmt = conn.prepare(SORGU_DANISAN)?;
    let danisanlar = stmt
        .query_map(rusqlite::params![desen, yoklama_siniri], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    let mut stmt = conn.prepare(SORGU_NOT)?;
    let notlar = stmt
        .query_map(rusqlite::params![desen, yoklama_siniri], |r| {
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

    // Etiket adi araması (Görev 7) -- YUMUŞAK eşleşme (`katla`, aynı `desen`),
    // `tags::ad_anahtar_uret` (KİMLİK) buraya HİÇ karışmaz (bkz. `SORGU_ETIKET`
    // dokümantasyonu).
    let mut stmt = conn.prepare(SORGU_ETIKET)?;
    let mut etiketler = stmt
        .query_map(rusqlite::params![desen, yoklama_siniri], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    // BUTCE PAYLASTIRMASI (bkz. modul basligi: "Iki kip tek butceyi paylasir").
    //
    // Iki listeyi arka arkaya ekleyip sondan `truncate` etmek, danisan
    // adlarinda yaygin bir terimin ("Yilmaz") not eslesmelerini listenin
    // altina degil TAMAMEN disina atmasi demekti. Bunun yerine her kipin
    // `sinir / 2` buyuklugunde bir GARANTI TABANI var; kullanilmayan taban
    // digerine devrediliyor, yani taban bir tavan degil. Tek kip esliyorsa
    // butcenin tamamini o kullanir.
    //
    // Toplam `take` ile YAPISAL olarak sinirli: iki sorgu da `LIMIT` dolusu
    // satir dondurse bile `danisan_payi + not_payi <= toplam` tanim geregi
    // saglanir (sondan kirpmaya guvenilmez).
    let toplam = sinir as usize;
    let taban = toplam / 2;
    // BULUNAN sayilar `sinir + 1`e kadar cikabilir (yoklama satiri). Butce
    // hesabi ESKISI GIBI, yani `sinir`e KIRPILMIS sayilar uzerinden
    // yapilir; yoklama satiri paylastirmayi etkilemez.
    let danisan_bulunan = danisanlar.len();
    let not_bulunan = notlar.len();
    let danisan_sigan = danisan_bulunan.min(toplam);
    let not_sigan = not_bulunan.min(toplam);
    let danisan_payi = danisan_sigan.min(toplam - not_sigan.min(taban));
    let not_payi = not_sigan.min(toplam - danisan_payi);
    // Kirpilma, KIPLERIN HERHANGI BIRINDE dusen bir eslesme olmasidir --
    // "toplam == sinir" degil. Iki kip de kendi payini asmissa da, tek kip
    // bolluk yapip digerini bastirmissa da dogru cevabi verir.
    let kirpildi_iki_kip = danisan_bulunan > danisan_payi || not_bulunan > not_payi;

    // ETIKET (Görev 7): ÜÇÜNCÜ kip, ama danışan/not ikilisinin PAYINDAN
    // KIRPILMAZ -- yukarıdaki iki satır (`danisan_payi`/`not_payi`) bu
    // dosyanın üç davranışsal testle (`danisan_adlarinda_yaygin_terim_...`,
    // `iki_kip_de_bolsa_...`, `kirpilma_isareti_kip_bazinda_...`) sabitlediği
    // TAM sayılarla değişmeden kalır. Etiket yalnızca bu ikisinin
    // KULLANMADIĞI artan bütçeyi (`kalan`) alır -- danışan/not eşleşmesi
    // yoksa (aramanın büyük çoğunluğu) etiket bütçenin tamamını kullanır;
    // ikisi doluysa etiket o aramada hiç görünmez ama bu SESSİZ bir kayıp
    // değildir: `kirpildi` aşağıda etiketin de payına bakar.
    let kalan = toplam.saturating_sub(danisan_payi + not_payi);
    let etiket_bulunan = etiketler.len();
    let etiket_sigan = etiket_bulunan.min(toplam);
    let etiket_payi = etiket_sigan.min(kalan);
    let kirpildi = kirpildi_iki_kip || etiket_bulunan > etiket_payi;

    // SQL sırası yalnızca "yoklama sınırına kadar hangi satırlar getirilsin"
    // sorusuna cevap verir (kullanım -- ad); GERÇEK gösterim sırası burada,
    // Rust'ta kurulur: `tags::etiketleri_listele` ile AYNI kural (kullanım
    // azalan, eşitlikte Türk alfabesi -- `etiket_sirasi`). `Intl`/SQLite
    // harmanlaması kullanılmaz (bkz. `store::tags` modül başlığı).
    etiketler.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| crate::store::tags::etiket_sirasi(&a.1, &b.1)));

    let mut sonuclar: Vec<AramaSonucu> =
        Vec::with_capacity(danisan_payi + not_payi + etiket_payi);

    for (id, ad) in danisanlar.into_iter().take(danisan_payi) {
        let parca = parca_cikar(&ad, &katli_sorgu);
        sonuclar.push(AramaSonucu {
            tur: "danisan".to_string(),
            client_id: id,
            danisan_adi: ad,
            appointment_id: None,
            tarih: None,
            parca,
            tag_id: None,
            etiket_adi: None,
            kullanim: None,
        });
    }

    for (appointment_id, client_id, danisan_adi, tarih, duz_metin) in
        notlar.into_iter().take(not_payi)
    {
        sonuclar.push(AramaSonucu {
            tur: "not".to_string(),
            client_id,
            danisan_adi,
            appointment_id: Some(appointment_id),
            tarih: Some(tarih),
            parca: parca_cikar(&duz_metin, &katli_sorgu),
            tag_id: None,
            etiket_adi: None,
            kullanim: None,
        });
    }

    for (tag_id, ad, kullanim) in etiketler.into_iter().take(etiket_payi) {
        sonuclar.push(AramaSonucu {
            tur: "etiket".to_string(),
            client_id: 0,
            danisan_adi: String::new(),
            appointment_id: None,
            tarih: None,
            parca: String::new(),
            tag_id: Some(tag_id),
            etiket_adi: Some(ad),
            kullanim: Some(kullanim),
        });
    }

    // Sorgu metni, sonuc sayisi, KIRPILMA ISARETI ve danisan kimligi loga
    // GIRMEZ; yalnizca "bu cihazdan arama yapildi" bilgisi yazilir ve
    // pencere boyunca birlestirilir (bkz. modul basligi). `kirpildi` bu
    // cagriya hicbir bicimde gecmiyor.
    kaydet(
        conn,
        Eylem::Goruntuleme,
        VARLIK_ARAMA,
        VARLIK_ID_ARAMA,
        cihaz,
        None,
        LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK),
    )?;

    Ok(AramaYaniti { sonuclar, kirpildi })
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
        tags::etiket_ekle,
    };
    use time::{format_description::well_known::Rfc3339, OffsetDateTime};

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

    /// Testlerin cogu yalnizca SONUC LISTESIYLE ilgileniyor. Kirpilma
    /// isaretini olcen testler `ara`yi DOGRUDAN cagirir (bkz.
    /// `kirpilma_isareti_*`), yani bu yardimci bayragi gizlemiyor --
    /// yalnizca onunla ilgilenmeyen cagrilari kisaltiyor.
    fn sonuclar_of(
        c: &rusqlite::Connection,
        sorgu: &str,
        limit: i64,
        cihaz: Cihaz,
    ) -> Result<Vec<AramaSonucu>, DepoHatasi> {
        Ok(ara(c, sorgu, limit, cihaz)?.sonuclar)
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
        let sonuclar = sonuclar_of(&c, "Ayse", 20, Cihaz::Masaustu).unwrap();
        assert!(sonuclar.iter().any(|s| s.tur == "danisan"));
    }

    #[test]
    fn not_icerigiyle_bulunur_ve_parca_dondurur() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "Danisan sinav kaygisindan bahsetti.", Cihaz::Masaustu).unwrap();

        let sonuclar = sonuclar_of(&c, "kaygi", 20, Cihaz::Masaustu).unwrap();
        let not_sonucu = sonuclar.iter().find(|s| s.tur == "not").expect("not bulunmali");
        assert!(not_sonucu.parca.contains("kaygi"), "eslesme parcasi dondurulmeli");
        assert_eq!(not_sonucu.danisan_adi, "Ayse Yilmaz");
    }

    #[test]
    fn ozel_notlar_arama_sonuclarina_girmez() {
        let (_d, c, _cid, rid) = kurulum();
        ozel_not_kaydet(&c, rid, "GIZLI_HIPOTEZ_KAYGI", Cihaz::Masaustu).unwrap();

        let sonuclar = sonuclar_of(&c, "GIZLI_HIPOTEZ", 20, Cihaz::Masaustu).unwrap();
        assert!(sonuclar.is_empty(), "ozel not aramada cikmamali");
    }

    #[test]
    fn buyuk_kucuk_harf_ve_turkce_karakter_tolere_edilir() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "Danışan KAYGI yaşıyor.", Cihaz::Masaustu).unwrap();
        assert!(!sonuclar_of(&c, "kaygi", 20, Cihaz::Masaustu).unwrap().is_empty());
    }

    #[test]
    fn bos_veya_cok_kisa_sorgu_bos_doner() {
        let (_d, c, _cid, _rid) = kurulum();
        assert!(sonuclar_of(&c, "", 20, Cihaz::Masaustu).unwrap().is_empty());
        assert!(sonuclar_of(&c, "a", 20, Cihaz::Masaustu).unwrap().is_empty());
    }

    #[test]
    fn joker_karakterler_kacirilir() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "normal icerik", Cihaz::Masaustu).unwrap();
        // "%" LIKE'ta her seyi eslestirir; kacirilmazsa tum notlar doner.
        assert!(sonuclar_of(&c, "%%", 20, Cihaz::Masaustu).unwrap().is_empty());
    }

    #[test]
    fn arama_sorgusu_erisim_loguna_icerik_yazmaz() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "COK_GIZLI", Cihaz::Masaustu).unwrap();
        sonuclar_of(&c, "COK_GIZLI", 20, Cihaz::Masaustu).unwrap();

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
        let sonuclar = sonuclar_of(&c, "COK_GIZLI_TERIM", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(sonuclar.len(), 1, "on kosul: arama gercekten bir sey bulmali");

        // GOREV 7 GENISLETMESI: etiket adi araması da AYNI korumayı
        // paylaşmalı -- ayrı bir gizli terimle ikinci bir arama yapılır ve
        // aşağıdaki tarama HER İKİ aramadan kalan satırları birden kapsar.
        etiket_ekle(&c, rid, "COK_GIZLI_ETIKET_TERIMI", Cihaz::Masaustu).unwrap();
        let etiket_sonuclari = sonuclar_of(&c, "COK_GIZLI_ETIKET_TERIMI", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(
            etiket_sonuclari.iter().filter(|s| s.tur == "etiket").count(),
            1,
            "on kosul: etiket arama gercekten bulmali"
        );

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
            assert!(!hepsi.contains("etiket_terimi"), "etiket arama terimi loga sizmis: {hepsi}");
            if kayit.varlik == VARLIK_ARAMA {
                assert_eq!(
                    kayit.varlik_id, VARLIK_ID_ARAMA,
                    "arama satirinin varlik_id'si sabit olmali (sorgudan/sonuc sayisindan turetilmemeli)"
                );
                assert!(kayit.ayrinti.is_none(), "arama satiri ayrinti tasimamali");
            }
        }
    }

    #[test]
    fn bicim_etiketleri_bolse_de_metin_bulunur_etiket_adi_bulunmaz() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "serbest", "<p>çok <strong>önemli</strong> bir <em>konu</em></p>", Cihaz::Masaustu)
            .unwrap();
        // ARTI YON: etiketin böldüğü ifade Türkçe katlamayla bulunur; parça düz metin.
        let bulunan = sonuclar_of(&c, "COK ONEMLI", 20, Cihaz::Masaustu).unwrap();
        let not = bulunan.iter().find(|s| s.tur == "not").expect("bicimle bolunmus ifade bulunmali");
        assert!(not.parca.contains("çok önemli bir konu"), "{}", not.parca);
        assert!(!not.parca.contains('<'), "parca HTML tasimamali: {}", not.parca);
        // EKSİ YÖN: etiket adı ve öznitelik metin değildir.
        for terim in ["strong", "<em>", "p>"] {
            assert!(
                sonuclar_of(&c, terim, 20, Cihaz::Masaustu).unwrap().iter().all(|s| s.tur != "not"),
                "{terim} not buldu"
            );
        }
    }

    // --- Etiket araması (Görev 7) ------------------------------------------

    #[test]
    fn etiket_katla_ile_yumusak_eslesir_ve_kullanim_sayisi_doner() {
        // "kaygi" (aksansiz) sorgusu "Kaygı" etiketini bulmali -- `katla`,
        // kimlik uretiminde kullanilan `tags::ad_anahtar_uret`'ten FARKLI
        // (bkz. `SORGU_ETIKET` dokumantasyonu).
        let (_d, c, cid, rid) = kurulum();
        let r2 = randevu_ekle(&c, cid, "2026-09-08");
        etiket_ekle(&c, rid, "Kaygı", Cihaz::Masaustu).unwrap();
        etiket_ekle(&c, r2, "Kaygı", Cihaz::Masaustu).unwrap();

        let sonuclar = sonuclar_of(&c, "kaygi", 20, Cihaz::Masaustu).unwrap();
        let etiket = sonuclar.iter().find(|s| s.tur == "etiket").expect("etiket bulunmali");
        assert_eq!(etiket.etiket_adi.as_deref(), Some("Kaygı"));
        assert_eq!(etiket.kullanim, Some(2), "iki seansa bagli etiketin kullanimi 2 olmali");
        assert!(etiket.tag_id.is_some());
        // Etiket sonucunun danisana/seansa ozgu alanlari anlamsiz -- bos.
        assert_eq!(etiket.client_id, 0);
        assert_eq!(etiket.appointment_id, None);
    }

    #[test]
    fn etiket_aramasinda_joker_karakterler_kacirilir() {
        let (_d, c, _cid, rid) = kurulum();
        etiket_ekle(&c, rid, "normal", Cihaz::Masaustu).unwrap();
        // "%" LIKE'ta her seyi eslestirir; kacirilmazsa "normal" etiketi de
        // (herhangi biri gibi) donerdi.
        let sonuclar = sonuclar_of(&c, "%%", 20, Cihaz::Masaustu).unwrap();
        assert!(
            sonuclar.iter().all(|s| s.tur != "etiket"),
            "kacirilmayan joker tum etiketleri eslestirirdi: {sonuclar:?}"
        );
    }

    #[test]
    fn etiket_ozel_not_gibi_ayri_bir_kip_danisan_ve_not_butcesini_bozmaz() {
        // Danisan/not butce paylasimi bu dosyanin IKI davranissal testiyle
        // (asagida) sabit sayilarla kilitli; etiketin bu ikisini KULLANMAYAN
        // artan bütçeyi aldigini (bkz. modul basligi "Ucuncu kip") tek basina
        // dogrular: hicbir danisan/not eslesmesi yokken etiket butcenin
        // TAMAMINI kullanabilmeli.
        let (_d, c, cid, _rid) = kurulum();
        for i in 0..60 {
            let r = randevu_ekle(&c, cid, &gun(i));
            etiket_ekle(&c, r, &format!("COKETIKET{i:02}"), Cihaz::Masaustu).unwrap();
        }

        let yanit = ara(&c, "COKETIKET", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        assert_eq!(
            yanit.sonuclar.iter().filter(|s| s.tur == "etiket").count(),
            50,
            "danisan/not eslesmesi yokken etiket TUM butceyi almali"
        );
        assert!(yanit.sonuclar.iter().all(|s| s.tur == "etiket"));
        assert!(yanit.kirpildi, "60 etiketten 10'u dusuyor: kirpilma isaretlenmeli");
    }

    // --- Etiket siralamasi bir sozlesmedir (Gorev 5, IMPORTANT-5) ---------
    //
    // `SORGU_ETIKET`in `ORDER BY kullanim DESC, t.ad COLLATE NOCASE` satiri
    // hicbir testle korunmuyordu: bir denetim `kullanim DESC` -> `ASC`
    // yapip asagidaki Rust-tarafi `sort_by`yi (L564) de tersine cevirince
    // 44/44 test YESIL kaldi. Sebep: butceyi olcen tek kapsamli test
    // (yukaridaki `etiket_ozel_not_gibi_...`) 60 etiketin HEPSINI birer
    // seansa bagliyor -- hepsinin kullanimi 1, yani BIRINCIL siralama
    // anahtari o kurulumda hic gorunmuyor. `LIMIT` sorgunun ICINDE oldugu
    // icin sira, hangi etiketlerin hayatta kalacagini da belirliyor --
    // tipki yukaridaki `siralama_hangi_satirlarin_hayatta_kalacagini_belirler`
    // testinin danisan/not kipleri icin kapattigi ayni tuzak, burada
    // ucuncu kipe (etiket) yayiliyor.
    //
    // ONEMLI: `ara` icindeki GERCEK GOSTERIM sirasi SQL'in `ORDER BY`'i
    // DEGIL -- SQL sirasi yalnizca "yoklama sinirina kadar hangi satirlar
    // getirilsin" sorusuna cevap verir (bkz. L559-561 yorumu). Sonuc listesi
    // HER ZAMAN Rust'ta `etiketler.sort_by(...)` ile yeniden dizilir
    // (kullanim azalan, esitlikte `tags::etiket_sirasi` -- Turk alfabesi).
    // Asagidaki testler bu GERCEKTEN UYGULANAN sirayi olcuyor.

    #[test]
    fn etiket_sonuclari_kullanim_sayisina_gore_azalan_siralanir() {
        // Adlar BILEREK kullanim sirasinin TERSINE secildi (Turk alfabesinde
        // A < M < Z ama kullanim 1 < 2 < 3): salt ada bakan bir siralama
        // (COLLATE NOCASE dahil) bu testi TERS sirada gecerdi, kullanima
        // bakan dogru siralama ise "en cok kullanilan once" verir.
        let (_d, c, cid, rid) = kurulum();
        let r2 = randevu_ekle(&c, cid, "2026-09-08");
        let r3 = randevu_ekle(&c, cid, "2026-09-09");

        etiket_ekle(&c, rid, "SIRAZZ uc", Cihaz::Masaustu).unwrap();
        etiket_ekle(&c, r2, "SIRAZZ uc", Cihaz::Masaustu).unwrap();
        etiket_ekle(&c, r3, "SIRAZZ uc", Cihaz::Masaustu).unwrap();

        etiket_ekle(&c, rid, "SIRAMM iki", Cihaz::Masaustu).unwrap();
        etiket_ekle(&c, r2, "SIRAMM iki", Cihaz::Masaustu).unwrap();

        etiket_ekle(&c, rid, "SIRAAA bir", Cihaz::Masaustu).unwrap();

        let sonuclar = sonuclar_of(&c, "SIRA", 20, Cihaz::Masaustu).unwrap();
        let etiketler: Vec<&AramaSonucu> = sonuclar.iter().filter(|s| s.tur == "etiket").collect();
        assert_eq!(etiketler.len(), 3);
        let sira: Vec<(&str, Option<i64>)> =
            etiketler.iter().map(|s| (s.etiket_adi.as_deref().unwrap(), s.kullanim)).collect();
        assert_eq!(
            sira,
            vec![
                ("SIRAZZ uc", Some(3)),
                ("SIRAMM iki", Some(2)),
                ("SIRAAA bir", Some(1)),
            ],
            "en cok kullanilan etiket once gelmeli, ada gore degil"
        );
    }

    #[test]
    fn etiket_siralamasinda_en_cok_kullanilan_kesilmiyor() {
        // `LIMIT` sorgunun ICINDE: 52 etiketten (50 YUKSEK kullanim + 2
        // DUSUK kullanim) tam olarak butceye (50) sigan sayida sonuc
        // donmeli VE hayatta kalanlar YUKSEK kullanimli olanlar olmali.
        // Emsal: `siralama_hangi_satirlarin_hayatta_kalacagini_belirler`
        // (danisan/not kipleri icin ayni ilke).
        //
        // Ayni iki randevu TUM etiketler arasinda paylasiliyor -- birden
        // fazla etiket AYNI randevuya baglanabilir (`progress_note_tags`
        // PRIMARY KEY (appointment_id, tag_id)) -- bu yuzden yalnizca 2
        // randevu yeterli.
        let (_d, c, cid, rid) = kurulum();
        let r2 = randevu_ekle(&c, cid, "2026-09-08");

        for i in 0..50 {
            let ad = format!("COKKESIK{i:02}");
            etiket_ekle(&c, rid, &ad, Cihaz::Masaustu).unwrap();
            etiket_ekle(&c, r2, &ad, Cihaz::Masaustu).unwrap();
        }
        for i in 0..2 {
            let ad = format!("AZKESIK{i:02}");
            etiket_ekle(&c, rid, &ad, Cihaz::Masaustu).unwrap();
        }

        let yanit = ara(&c, "KESIK", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        let etiketler: Vec<&AramaSonucu> =
            yanit.sonuclar.iter().filter(|s| s.tur == "etiket").collect();
        assert_eq!(etiketler.len(), 50, "butce YUKSEK kullanimli 50 etiketin TAMAMINA sigmali");
        assert!(
            etiketler.iter().all(|s| s.kullanim == Some(2)),
            "yalnizca YUKSEK kullanimli (2) etiketler hayatta kalmali, DUSUK (1) kesilmeli: {etiketler:?}"
        );
        assert!(
            etiketler
                .iter()
                .all(|s| s.etiket_adi.as_deref().is_some_and(|a| a.starts_with("COKKESIK"))),
            "DUSUK kullanimli etiketler sonuca karismamali: {etiketler:?}"
        );
        assert!(yanit.kirpildi, "52 etiketten 2'si dusuyor: kirpilma isaretlenmeli");
    }

    #[test]
    fn etiket_esit_kullanimda_turk_alfabesi_sirasina_gore_siralanir() {
        // Esitlikte ikincil anahtar Turk alfabesi (`tags::etiket_sirasi`),
        // SQL'in `COLLATE NOCASE`'i DEGIL. `COLLATE NOCASE` Turkce harfleri
        // KOD NOKTASINA gore sıralar: 'ç' (U+00E7) 'z'den (U+007A) SONRA
        // gelir; oysa Turk alfabesinde 'ç' 'c'den hemen sonra, 'd', 'z' dahil
        // cogu harften ONCE gelir (tags.rs modul basligi, MINOR-3 bulgusu).
        // `ara` icindeki GERCEK gosterim sirasi SQL'in `ORDER BY`'i degil,
        // sonradan calisan Rust `sort_by`dir (bkz. yukaridaki yorum) -- bu
        // test o GERCEK sirayi olcuyor, varsayilan/SQL sirasini degil.
        let (_d, c, _cid, rid) = kurulum();

        for ad in ["ESITSIRA Zebra", "ESITSIRA Çocuk", "ESITSIRA Deniz"] {
            etiket_ekle(&c, rid, ad, Cihaz::Masaustu).unwrap();
        }

        let sonuclar = sonuclar_of(&c, "ESITSIRA", 20, Cihaz::Masaustu).unwrap();
        let etiketler: Vec<&str> = sonuclar
            .iter()
            .filter(|s| s.tur == "etiket")
            .map(|s| s.etiket_adi.as_deref().unwrap())
            .collect();
        assert_eq!(
            etiketler,
            vec!["ESITSIRA Çocuk", "ESITSIRA Deniz", "ESITSIRA Zebra"],
            "Turk alfabesinde 'ç' 'c'den hemen sonra gelir, 'z'den once -- \
             COLLATE NOCASE (kod noktasi sirasi) bu sirayi 'Deniz, Zebra, \
             Çocuk' verirdi"
        );
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

        let sonuclar = sonuclar_of(&c, "PAYLASILAN_ISARET", 20, Cihaz::Masaustu).unwrap();
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
        // ve yorumlar haric) `private_notes` tablosunu adiyla hic anmaz ve
        // hicbir `UNION` icermez. Ozel notun disarida kalmasi bir filtrenin
        // degil, sorgunun hangi tabloya baktiginin sonucudur -- bu test tam
        // olarak onu sabitler.
        let uretim = uretim_kodu();

        assert!(
            !uretim.contains("private_notes"),
            "arama modulunun uretim kodu private_notes tablosunu adiyla anmamali"
        );
        assert!(
            !uretim.to_uppercase().contains("UNION"),
            "arama sorgularinda UNION olmamali"
        );
        // PARCALANMIS DIZGI de gorunur olmali: `"private_" "notes"` ya da
        // `concat!("private_", "notes")` bicimindeki bir kacamak, duz
        // `contains` ile gorunmez kalirdi.
        let birlesik = dizgi_parcalari_birlestir(&uretim);
        assert!(
            !birlesik.contains("private_notes"),
            "parcalanmis dizgiyle de olsa private_notes gecmemeli"
        );
    }

    /// Özel not tablosuna **kod içinde** dokunmasına izin verilen modüller
    /// (workspace köküne göre yol). Bunun dışındaki her üretim modülü için
    /// tablo adı bir ihlaldir.
    ///
    /// - `core/src/store/notes.rs`: `ozel_not_getir`/`ozel_not_kaydet`'in evi
    ///   (tek yazma/okuma yolu).
    /// - `core/src/store/schema.rs`: tabloyu ve indeksini YARATAN yer.
    /// - `core/src/store/appointments.rs`: randevu silinince kaç notun cascade
    ///   ile gideceğini sayar — **içeriğe hiç bakmaz**, yalnızca `COUNT(*)`
    ///   (bkz. `silinecek_not_adedi`).
    const OZEL_NOTA_DOKUNABILEN: [&str; 3] =
        ["core/src/store/notes.rs", "core/src/store/schema.rs", "core/src/store/appointments.rs"];

    /// Özel not **okuma/yazma API'sinin** (`ozel_not_` önekli fonksiyonlar ve
    /// `OzelNot` tipi) geçebileceği modüller: çekirdekte tanımı, sunucuda tek
    /// rota modülü. Başka hiçbir üretim modülü (`guard.rs`, `lib.rs`,
    /// `bin/sunucu.rs`, `src-tauri/src/main.rs`, yarının `export.rs`'i)
    /// onları çağıramaz, içe aktaramaz.
    const OZEL_NOT_API_EVLERI: [&str; 2] =
        ["core/src/store/notes.rs", "server/src/routes/private_notes.rs"];

    /// Özel not **rota modülünü** yönlendiriciye bağlamak için modül adının
    /// (`private_notes`) kodda geçmesi zorunlu olan yerler: `(dosya, tam metin)`.
    /// Tam metin dosyanın üretim kodunda **tam bir kez** geçmeli ve yalnızca o
    /// metin taramadan düşülür — aynı dosyada modül adının BAŞKA bir kullanımı
    /// (ör. `lib.rs`'te `routes::private_notes::getir`'i bir rapor
    /// yardımcısından çağırmak) yine ihlaldir.
    const MODUL_BAGLAMA_ISTISNALARI: [(&str, &str); 2] = [
        // `routes/mod.rs`: modül bildirimi -- dosya adı tablo adıyla aynı.
        ("server/src/routes/mod.rs", "pub mod private_notes;"),
        // `lib.rs`: özel not uç noktasının yönlendiriciye tek bağlandığı satır.
        ("server/src/lib.rs", "get(routes::private_notes::getir).put(routes::private_notes::kaydet)"),
    ];

    /// Kök `Cargo.toml`'daki `[workspace] members` listesi. Okunamazsa ya da
    /// liste bulunamazsa **panik**: boş bir üye kümesi her yasağı sessizce
    /// sağlardı.
    fn workspace_uyeleri(kok: &std::path::Path) -> Vec<String> {
        let toml = std::fs::read_to_string(kok.join("Cargo.toml"))
            .unwrap_or_else(|e| panic!("kok Cargo.toml okunamadi: {e}"));
        // `members = [...]` ile BASLAYAN satir (yorumdaki bir "members"
        // kelimesi sayilmaz); liste birden cok satira yayilabilir.
        let mut bas = None;
        let mut konum = 0usize;
        for satir in toml.split_inclusive('\n') {
            let sade = satir.trim_start();
            if sade.strip_prefix("members").is_some_and(|k| k.trim_start().starts_with('=')) {
                bas = Some(konum);
                break;
            }
            konum += satir.len();
        }
        let bas = bas.unwrap_or_else(|| panic!("kok Cargo.toml'da `members = [...]` yok"));
        let kalan = &toml[bas..];
        let ac = kalan.find('[').expect("`members` listesi `[` ile baslamali");
        let kapa = kalan.find(']').expect("`members` listesi `]` ile bitmeli");
        kalan[ac + 1..kapa]
            .split(',')
            .map(|p| p.trim().trim_matches('"').to_string())
            .filter(|p| !p.is_empty())
            .collect()
    }

    /// Workspace'in **bütün üyelerinin** `src/` dizinlerindeki her `.rs`
    /// dosyası, özyinelemeli: `(workspace köküne göre / ayraçlı yol, üretim
    /// kodu)`. Üye kümesi `Cargo.toml`'dan türetilir, elle yazılmaz: yarın
    /// eklenecek bir üye hiçbir şey yapılmadan kapsama girer.
    fn workspace_uretim_dosyalari() -> Vec<(String, String)> {
        fn yuru(kok: &std::path::Path, dizin: &std::path::Path, cikti: &mut Vec<(String, String)>) {
            let girdiler = std::fs::read_dir(dizin)
                .unwrap_or_else(|e| panic!("{} okunamadi: {e}", dizin.display()));
            for girdi in girdiler {
                let yol = girdi.expect("dizin girdisi okunamadi").path();
                if yol.is_dir() {
                    yuru(kok, &yol, cikti);
                } else if yol.extension().and_then(|u| u.to_str()) == Some("rs") {
                    let goreli = yol
                        .strip_prefix(kok)
                        .unwrap()
                        .components()
                        .map(|p| p.as_os_str().to_string_lossy().into_owned())
                        .collect::<Vec<_>>()
                        .join("/");
                    let ham = std::fs::read_to_string(&yol)
                        .unwrap_or_else(|e| panic!("{goreli} okunamadi: {e}"));
                    cikti.push((goreli, uretim_kodunu_ayikla(&ham)));
                }
            }
        }
        let kok = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("core'un ust dizini workspace koku olmali");
        let uyeler = workspace_uyeleri(kok);
        // Alt sinir: bugun uc uye. Liste ayristirmasi bozulup tek bir uyeye
        // (ya da hicbirine) inerse kume daralir ve kavsak disarida kalir.
        assert!(uyeler.len() >= 3, "workspace uye listesi beklenenden kucuk: {uyeler:?}");
        let mut dosyalar = Vec::new();
        for uye in &uyeler {
            let src = kok.join(uye).join("src");
            assert!(src.is_dir(), "workspace uyesi `{uye}` icin src/ yok: {}", src.display());
            yuru(kok, &src, &mut dosyalar);
        }
        dosyalar.sort();
        dosyalar
    }

    /// Özel not sızıntısının **workspace genelindeki** yapısal karşılığı.
    ///
    /// # Bulgu (Plan 4 dal incelemesi I2): tarama `server/src`'nin çoğunu ve `src-tauri`'yi görmüyordu
    ///
    /// Üçüncü kez biçim 12. Çekirdek taraması yalnızca `core/src`'ye, rota
    /// taraması (`server/tests/notlar_api.rs`) yalnızca `server/src/routes/`'a
    /// bakıyordu. `guard.rs`, `lib.rs`, `state.rs`, `assets.rs`,
    /// `bin/sunucu.rs` ve `src-tauri/src/main.rs` hiçbirinde yoktu.
    /// İncelemecinin mutasyonu: `guard.rs`'e `ozel_not_getir` çağıran bir
    /// `pub fn rapor_yardimcisi` + rapor rotasından çağrı → bütün yapısal
    /// testler yeşil. Küme artık kök `Cargo.toml`'daki `members`'tan türetilir
    /// ve her üyenin `src/`'si özyinelemeli taranır.
    ///
    /// # Bulgu (dal incelemesi): tarama kendi dosyasıyla sınırlıydı
    ///
    /// `kaynak_kodda_private_notes_gecmez` yalnızca `search.rs`'i okuyordu.
    /// İddia doğruydu ama kapsamı, ihlalin olabileceği kavşağı dışarıda
    /// bırakıyordu: yarın eklenecek bir `store/export.rs` (ya da
    /// `reports.rs`, `backup_export.rs`) `private_notes` tablosuna
    /// baktığında hiçbir test kırılmazdı — oysa "özel not hiçbir dışa
    /// aktarıma, rapora veya aramaya girmez" sözü tam olarak o dosyalar
    /// hakkında.
    ///
    /// # Bulgu (Plan 4): tarama `store/` ile ve tablo adıyla sınırlıydı
    ///
    /// İkinci kez aynı biçim (docs/test-yesil-ama-korumuyor.md #12): tarama
    /// yalnızca `core/src/store/`'a düz bakıyor ve yalnızca **tablo adını**
    /// arıyordu. `core/src/pdf.rs` gibi `store` dışı bir modül tabloya
    /// dokunsa, ya da yeni bir rapor modülü tablo adını hiç anmadan
    /// `notes::ozel_not_getir`'i çağırsa hiçbir test kırılmazdı. Küme artık
    /// `core/src/`'den **özyinelemeli** türetildi (üçüncü bulguda kapsam
    /// workspace'e genişledi, yukarı bakınız).
    ///
    /// # Kurallar (workspace'in bütün üretim kaynakları)
    ///
    /// 1. `private_notes` yalnızca `OZEL_NOTA_DOKUNABILEN` modüllerinde;
    ///    rota modülünün yönlendiriciye bağlandığı iki tam metin
    ///    (`MODUL_BAGLAMA_ISTISNALARI`) tam bir kez düşülür.
    /// 2. `ozel_not_` önekli adlar ve `OzelNot` tipi yalnızca
    ///    `OZEL_NOT_API_EVLERI`'nde.
    ///
    /// Elle kalan tek şey izin listeleridir ve her girdisi için iki yönlü
    /// ön koşul var — dosya diskte var mı, ve izin GERÇEKTEN gerekli mi
    /// (üretim kodunda fiilen geçiyor mu). Bayat bir izin, kuralı bir
    /// modülden sessizce kaldırırdı.
    ///
    /// Tarayıcı `uretim_kodunu_ayikla`'dır (yorum/dizgi farkındalıklı tek
    /// geçiş): yorumda kuralın kendisinden bahsetmek serbesttir, kodda ve
    /// dizgide geçmek değildir.
    #[test]
    fn workspace_genelinde_ozel_not_yalnizca_izinli_modullerde_gecer() {
        let mut dosyalar = workspace_uretim_dosyalari();
        let adlar: Vec<String> = dosyalar.iter().map(|(a, _)| a.clone()).collect();

        // Dizin okunamaz hale gelirse her iddia BOS kume uzerinde saglanirdi.
        assert!(
            dosyalar.len() >= 40,
            "workspace kaynak kumesi beklenenden kucuk, turetilememis: {adlar:?}"
        );
        // Uye turetmesi ve ozyineleme GERCEKTEN calisiyor: her uye, kok ve
        // alt dizinler birlikte kapsamda; I2'nin kor kaldigi dosyalar adiyla.
        for gerekli in [
            "core/src/lib.rs",
            "core/src/pdf.rs",
            "core/src/store/notes.rs",
            "core/src/crypto/keyring.rs",
            "server/src/lib.rs",
            "server/src/guard.rs",
            "server/src/state.rs",
            "server/src/assets.rs",
            "server/src/bin/sunucu.rs",
            "server/src/routes/veri_raporu.rs",
            "src-tauri/src/main.rs",
        ] {
            assert!(adlar.iter().any(|a| a == gerekli), "`{gerekli}` taramada yok: {adlar:?}");
        }

        // Rota baglama metinleri: dosya var, metin TAM BIR KEZ geciyor (bayat
        // ya da cogaltilmis istisna kirmizi); yalnizca o metin dusulur.
        for (dosya, metin) in MODUL_BAGLAMA_ISTISNALARI {
            let (_, uretim) = dosyalar
                .iter_mut()
                .find(|(ad, _)| ad == dosya)
                .unwrap_or_else(|| panic!("baglama istisnasi bayat: `{dosya}` artik yok"));
            assert_eq!(
                uretim.matches(metin).count(),
                1,
                "{dosya}: `{metin}` uretim kodunda tam bir kez gecmeli -- istisna bayat \
                 ya da ayni baglama cogaltilmis"
            );
            *uretim = uretim.replacen(metin, "", 1);
        }

        for izinli in OZEL_NOTA_DOKUNABILEN {
            let (_, uretim) = dosyalar
                .iter()
                .find(|(ad, _)| ad == izinli)
                .unwrap_or_else(|| panic!("izin listesi bayat: `{izinli}` artik yok"));
            // ON KOSUL: izin GERCEKTEN gerekli. Modul tabloya dokunmayi
            // birakirsa listeden de dusmeli; yoksa liste zamanla "kimin
            // dokunabildigini" degil "kimin bir zamanlar dokundugunu"
            // anlatir ve gercek bir izni sessizce genisletir.
            assert!(
                uretim.contains("private_notes"),
                "{izinli}: izin listesinde ama uretim kodunda private_notes gecmiyor -- \
                 liste bayatladi"
            );
        }

        // Ihlaller TOPLU raporlanir: bir gerileme hangi dosyalari actigini
        // tek kosuda gostersin.
        let mut ihlaller = Vec::new();
        for (ad, uretim) in &dosyalar {
            if OZEL_NOTA_DOKUNABILEN.contains(&ad.as_str()) {
                continue;
            }
            // Parcalanmis dizgi kacamagi da gorunur olmali.
            if uretim.contains("private_notes")
                || dizgi_parcalari_birlestir(uretim).contains("private_notes")
            {
                ihlaller.push(format!(
                    "{ad}: `private_notes` yalnizca {OZEL_NOTA_DOKUNABILEN:?} icinde gecebilir -- \
                     yeni bir disa aktarim/rapor modulu ozel not tablosuna uzaniyor"
                ));
            }
        }

        // --- Kural 2: ozel not API'si yalnizca kendi evlerinde ---
        for ev_adi in OZEL_NOT_API_EVLERI {
            let (_, ev) = dosyalar
                .iter()
                .find(|(ad, _)| ad == ev_adi)
                .unwrap_or_else(|| panic!("`{ev_adi}` artik yok -- kural bayatladi"));
            for isaret in ["ozel_not_", "OzelNot"] {
                // ON KOSUL: isaret evde gercekten geciyor; yoksa (yeniden
                // adlandirma) asagidaki yasak her yerde bos yere saglanir.
                assert!(
                    ev.contains(isaret),
                    "{ev_adi}: `{isaret}` uretim kodunda yok -- API yeniden adlandirildiysa \
                     ya da ev onu artik kullanmiyorsa liste guncellenmeli"
                );
            }
        }
        for (ad, uretim) in &dosyalar {
            if OZEL_NOT_API_EVLERI.contains(&ad.as_str()) {
                continue;
            }
            for isaret in ["ozel_not_", "OzelNot"] {
                if uretim.contains(isaret) || dizgi_parcalari_birlestir(uretim).contains(isaret) {
                    ihlaller.push(format!(
                        "{ad}: `{isaret}` yalnizca {OZEL_NOT_API_EVLERI:?} icinde gecebilir -- \
                         baska bir modul ozel not okuma/yazma API'sine eristi"
                    ));
                }
            }
        }
        assert!(ihlaller.is_empty(), "{} ihlal:\n{}", ihlaller.len(), ihlaller.join("\n"));
    }

    /// Uretim kodu: test blogu ve YORUMLAR cikarilmis kaynak.
    ///
    /// Yorum filtresi hem `//` satirlarini hem `/* ... */` bloklarini atar.
    /// Yalnizca `starts_with("//")`'e bakan onceki filtre, kurali bir blok
    /// yorumunun icine tasiyan mutasyonu goremezdi: modul basligindaki
    /// `private_notes` gecisleri zaten `//!` ile basliyor, ama bir blok
    /// yorumu icine yazilan bir SQL parcasi filtreden kacardi.
    fn uretim_kodu() -> String {
        uretim_kodunu_ayikla(include_str!("search.rs"))
    }

    /// `uretim_kodu`'nun kaynağı dışarıdan alan hâli — kardeş test
    /// (`workspace_genelinde_ozel_not_...`) workspace'teki her dosyayı aynı
    /// elemeden geçirmek zorunda: iki ayrı eleme, iki ayrı kaçamak demekti.
    ///
    /// # Bulgu (Plan 4 Görev 3): eleme ilk `#[cfg(test)]` geçişinde KESİYORDU
    ///
    /// Önceki hâli `split("#[cfg(test)]").next()` idi ve iki biçimde körleşti:
    ///
    /// 1. **Dosya ortasındaki test öğesi.** Bu gerçek bir dosyada açıktı:
    ///    `crypto/keyring.rs`'te `impl KdfParams` içindeki
    ///    `#[cfg(test)] fn test_fast`'ten sonraki bütün üretim kodu
    ///    (`generate_data_key`, `wrap_key`, `unwrap_key`...) hiç taranmıyordu.
    ///    Görev 5 incelemesinin mutasyonu: o satırdan SONRA `private_notes`
    ///    okuyan bir fonksiyon → yeşil; ÖNCE → kırmızı.
    /// 2. **Yorumda ya da dizgide geçen işaret.** `split` metni her yerde
    ///    aradığı için `// bkz. #[cfg(test)]` gibi bir yorum satırı da
    ///    taramayı orada bitiriyordu.
    ///
    /// Artık kaynak yorum/dizgi/karakter farkındalıklı bir tarayıcıyla
    /// yürünür; yalnızca **kodda** duran `#[cfg(test)]`'in işaretlediği
    /// `mod`, `fn` ya da `impl` öğesi denk parantezle çıkarılır, dosyanın geri
    /// kalanı taranır.
    ///
    /// # Bulgu (Plan 4 Görev 3 incelemesi): yorum ayıklaması İKİNCİ bir ayrıştırıcıydı
    ///
    /// Test öğesi elemesi dizgi farkındalıklı olduktan sonra blok yorumları
    /// hâlâ düz metinde `find("/*")` ile, satır yorumları `starts_with("//")`
    /// ile atılıyordu. Kodda bir dizgi `/*` içerip eşsiz kalınca
    /// (`"yedekler/*.db"`) dosyanın GERİ KALANI taranmıyordu; sonraki bir
    /// dizgide `*/` varsa aradaki üretim kodu siliniyordu. Artık yorum atma da
    /// aynı tek geçişte, aynı `sozcuk_disi_atla` ile yapılır: yorum yalnızca
    /// kodda başlıyorsa yorumdur. Kapsanan vakalar
    /// `uretim_kodu_elemesi_...` testinde tek tek listelenir.
    fn uretim_kodunu_ayikla(kaynak: &str) -> String {
        const ISARET: &str = "#[cfg(test)]";
        let mut cikti = String::with_capacity(kaynak.len());
        let mut i = 0usize;
        while i < kaynak.len() {
            if let Some(son) = sozcuk_disi_atla(kaynak, i) {
                // Yorum atılır; dizgi ve karakter literali korunur (SQL
                // metni dizgidedir, taranması gereken tam da odur). Satır
                // yorumunun sonundaki `\n` yoruma dahil değildir, satır
                // yapısı korunur. Blok yorum hiçbir şeyle değiştirilmez:
                // `private_/* */notes` birleşik görünür -- fazla görmek,
                // eksik görmekten iyidir.
                if !kaynak[i..].starts_with("//") && !kaynak[i..].starts_with("/*") {
                    cikti.push_str(&kaynak[i..son]);
                }
                i = son;
            } else if kaynak[i..].starts_with(ISARET) {
                let sonrasi = i + ISARET.len();
                match test_ogesi_uzunlugu(&kaynak[sonrasi..]) {
                    Some(uzunluk) => i = sonrasi + uzunluk,
                    None => {
                        cikti.push_str(ISARET);
                        i = sonrasi;
                    }
                }
            } else {
                let k = kaynak[i..].chars().next().expect("i bir karakter sinirinda");
                cikti.push(k);
                i += k.len_utf8();
            }
        }
        cikti
    }

    // Çıkarılan test öğesi türleri: `mod ad { ... }`, `mod ad;`, `fn` (önünde
    // `async`/`const`/`unsafe` olabilir) ve `impl ... { ... }`. Aradaki ek
    // öznitelikler (`#[allow(..)]`) ve görünürlük (`pub`, `pub(crate)`) kabul
    // edilir. Başka bir öğe (`const`, `use`, `static`, `struct`) çıkarılmaz ve
    // taranır: tarama o durumda fazla görür, eksik değil. Blok sonu
    // bulunamazsa (denk olmayan parantez) öğe de çıkarılmaz — aynı gerekçe.

    /// `#[cfg(test)]`'ten hemen sonraki metin çıkarılabilir bir öğeyse, öğenin
    /// sonuna kadarki bayt uzunluğu.
    fn test_ogesi_uzunlugu(s: &str) -> Option<usize> {
        let bosluk_atla = |i: usize| s.len() - s[i..].trim_start().len();
        let anahtar = |i: usize, kelime: &str| {
            s[i..].strip_prefix(kelime).is_some_and(|k| k.starts_with(char::is_whitespace))
        };
        let mut i = bosluk_atla(0);
        while s[i..].starts_with("#[") {
            i += s[i..].find(']')? + 1;
            i = bosluk_atla(i);
        }
        if s[i..].starts_with("pub") {
            i += "pub".len();
            if s[i..].starts_with('(') {
                i += s[i..].find(')')? + 1;
            }
            i = bosluk_atla(i);
        }
        if anahtar(i, "mod") {
            i = bosluk_atla(i + "mod".len());
            i += s[i..].find(|c: char| !(c.is_alphanumeric() || c == '_'))?;
            i = bosluk_atla(i);
            if s[i..].starts_with(';') {
                return Some(i + 1);
            }
        } else {
            for niteleyici in ["async", "const", "unsafe"] {
                if anahtar(i, niteleyici) {
                    i = bosluk_atla(i + niteleyici.len());
                }
            }
            if !anahtar(i, "fn") && !anahtar(i, "impl") && !s[i..].starts_with("impl<") {
                return None;
            }
            // Imzanin sonundaki ilk kod seviyesi `{`: imza icinde dizgi ya da
            // yorum olabilir, onlar atlanir. Govdesiz bir `fn f();` burada
            // cikarilmaz.
            loop {
                if let Some(son) = sozcuk_disi_atla(s, i) {
                    i = son;
                    continue;
                }
                match s.as_bytes().get(i)? {
                    b'{' => break,
                    b';' => return None,
                    _ => i += 1,
                }
            }
        }
        if !s[i..].starts_with('{') {
            return None;
        }
        Some(i + denk_parantez_sonu(&s[i..])?)
    }

    /// `i`'de bir yorum, dizgi ya da karakter literali başlıyorsa onun
    /// bittiği bayt konumu; başlamıyorsa `None`. Kapanmamış bir yorum/dizgi
    /// kaynağın sonuna kadar sürer.
    ///
    /// Tanınanlar: `//`, iç içe `/* */`, `"..."` (kaçışlarla), `r"..."`,
    /// `r#"..."#`, `br"..."`, `'x'`, `'\''`, `'\u{..}'`. `'a` bir ömür
    /// belirtecidir, karakter değil.
    fn sozcuk_disi_atla(s: &str, i: usize) -> Option<usize> {
        let b = s.as_bytes();
        let tanimlayici = |c: u8| c.is_ascii_alphanumeric() || c == b'_';
        match *b.get(i)? {
            b'/' if b.get(i + 1) == Some(&b'/') => {
                Some(s[i..].find('\n').map_or(s.len(), |n| i + n))
            }
            b'/' if b.get(i + 1) == Some(&b'*') => {
                let mut j = i;
                let mut ic = 0usize;
                while j < b.len() {
                    if s[j..].starts_with("/*") {
                        ic += 1;
                        j += 2;
                    } else if s[j..].starts_with("*/") {
                        ic -= 1;
                        j += 2;
                        if ic == 0 {
                            return Some(j);
                        }
                    } else {
                        j += 1;
                    }
                }
                Some(s.len())
            }
            b'r' if (i == 0
                || !tanimlayici(b[i - 1])
                || (b[i - 1] == b'b' && (i < 2 || !tanimlayici(b[i - 2]))))
                && matches!(b.get(i + 1), Some(b'"') | Some(b'#')) =>
            {
                let kareler = s[i + 1..].bytes().take_while(|&c| c == b'#').count();
                if b.get(i + 1 + kareler) != Some(&b'"') {
                    return None;
                }
                let kapanis = format!("\"{}", "#".repeat(kareler));
                let icerik = i + 1 + kareler + 1;
                Some(s[icerik..].find(&kapanis).map_or(s.len(), |n| icerik + n + kapanis.len()))
            }
            b'"' => {
                let mut j = i + 1;
                while j < b.len() && b[j] != b'"' {
                    j += if b[j] == b'\\' { 2 } else { 1 };
                }
                Some((j + 1).min(s.len()))
            }
            b'\'' => {
                if b.get(i + 1) == Some(&b'\\') {
                    // `'\''`: kacirilan karakterin kendisi `'` olabilir,
                    // kapanis onun ARKASINDA aranir.
                    let arka = s.get(i + 3..)?;
                    Some(i + 3 + arka.find('\'')? + 1)
                } else {
                    let k = s[i + 1..].chars().next()?;
                    let son = i + 1 + k.len_utf8();
                    (b.get(son) == Some(&b'\'')).then_some(son + 1)
                }
            }
            _ => None,
        }
    }

    /// `s` `{` ile başlar; eşleşen `}`'den hemen sonraki bayt konumu. Yorum,
    /// dizgi ve karakter içindeki parantezler sayılmaz (`sozcuk_disi_atla`).
    fn denk_parantez_sonu(s: &str) -> Option<usize> {
        let mut derinlik = 0usize;
        let mut i = 0usize;
        while i < s.len() {
            if let Some(son) = sozcuk_disi_atla(s, i) {
                i = son;
                continue;
            }
            match s.as_bytes()[i] {
                b'{' => derinlik += 1,
                b'}' => {
                    derinlik = derinlik.checked_sub(1)?;
                    if derinlik == 0 {
                        return Some(i + 1);
                    }
                }
                _ => {}
            }
            i += 1;
        }
        None
    }

    /// Elemenin kendisi. `workspace_genelinde_...` gerçek dosyalar üzerinde
    /// çalışır ve yalnızca bugünkü dosyaların biçimini sınar; bu test
    /// gerilemeyi dosyalardan bağımsız, **iki yönlü** yakalar: test öğeleri
    /// elenmeli (fazla görme), onlardan sonraki üretim kodu taranmalı
    /// (eksik görme).
    #[test]
    fn uretim_kodu_elemesi_test_ogelerini_atar_sonrasini_tarar() {
        let kaynak = [
            "fn once() { \"BIRINCI\" }",
            "// yorumdaki #[cfg(test)] taramayi kesmemeli",
            "fn yorumdan_sonra() { \"YORUM_SONRASI\" }",
            "const DIZGI: &str = \"#[cfg(test)]\";",
            "fn dizgiden_sonra() { \"DIZGI_SONRASI\" }",
            "#[cfg(test)]",
            "const TEST_SABITI: u8 = 0;",
            "impl Tip {",
            "    #[cfg(test)]",
            "    pub fn test_hizli() -> Self { Self { a: \"TEST_FN_ICERIGI\" } }",
            "    pub fn uretim() { \"IMPL_ICI_URETIM\" }",
            "}",
            "#[cfg(test)]",
            "#[allow(dead_code)]",
            "pub(crate) mod yardim {",
            "    fn f() { let _ = '{'; let _ = '\\''; let _ = \"}}\"; }",
            "    // } yorumdaki parantez",
            "    /* } /* ic } */ } */",
            "    fn g<'a>(x: &'a str) -> &'a str { let _ = r#\"}\"#; x }",
            "    mod ic { fn h() { \"TEST_ICERIGI\" } }",
            "}",
            "fn sonra() { \"UCUNCU\" }",
            "#[cfg(test)]",
            "impl<T> Baska for T { fn x() { \"TEST_IMPL_ICERIGI\" } }",
            "#[cfg(test)]",
            "mod dosya_modulu;",
            "fn en_son() { \"DORDUNCU\" }",
            "#[cfg(test)]",
            "mod tests { fn t() { \"TEST_ICERIGI\" } }",
        ]
        .join("\n");
        let uretim = uretim_kodunu_ayikla(&kaynak);
        for gorunmeli in [
            "BIRINCI",
            "YORUM_SONRASI",
            "DIZGI_SONRASI",
            "TEST_SABITI",
            "IMPL_ICI_URETIM",
            "UCUNCU",
            "DORDUNCU",
        ] {
            assert!(uretim.contains(gorunmeli), "`{gorunmeli}` taranmali:\n{uretim}");
        }
        for elenmeli in ["TEST_ICERIGI", "TEST_FN_ICERIGI", "TEST_IMPL_ICERIGI", "dosya_modulu"] {
            assert!(!uretim.contains(elenmeli), "`{elenmeli}` elenmeli:\n{uretim}");
        }
    }

    /// Yorum ayıklaması da dizgi/karakter farkındalıklı olmalı (Plan 4 Görev 3
    /// incelemesi). Her vakada `SIZINTI` üretim kodudur ve taranmalı; yorum
    /// içeriği ise elenmeli. Vakalar tek tek denenir ve TÜM başarısızlıklar
    /// birlikte raporlanır: bir gerileme hangi vakaları açtığını tek koşuda
    /// gösterir.
    #[test]
    fn uretim_kodu_elemesi_yorumu_dizgi_ve_karakterden_ayirir() {
        let vakalar: [(&str, &str); 7] = [
            (
                "dizgide essiz /* -- eskiden dosyanin geri kalani taranmiyordu",
                "pub const DESEN: &str = \"yedekler/*.db\";\nfn f() { SIZINTI }",
            ),
            (
                "bir dizgide /*, sonrakinde */ -- eskiden aradaki kod siliniyordu",
                "const A: &str = \"/*\";\nfn f() { SIZINTI }\nconst B: &str = \"*/\";",
            ),
            (
                "raw string icinde tirnak ve /*",
                "const R: &str = r#\"a \"/*\" b\"#;\nfn f() { SIZINTI }",
            ),
            (
                "karakter literali '/' ardindan '*'",
                "let (a, b) = ('/', '*');\nlet ab = ['/','*'];\nfn f() { SIZINTI }",
            ),
            (
                "karakter literali '\"' dizgi baslangici sanilmamali",
                "let t = '\"';\nconst U: &str = \"/*\";\nfn f() { SIZINTI }",
            ),
            (
                "satir yorumunda \" dizgi baslangici sanilmamali",
                "// \"tirnak acik kaldi\nconst X: &str = \" /* \";\nfn f() { SIZINTI }\n\
                 const Y: &str = \" */ \";",
            ),
            (
                "blok yorumunda \" dizgi baslangici sanilmamali",
                "/* \" */\nconst X: &str = \" /* \";\nfn f() { SIZINTI }\nconst Y: &str = \" */ \";",
            ),
        ];
        let mut hatalar = Vec::new();
        for (ad, kaynak) in vakalar {
            let uretim = uretim_kodunu_ayikla(kaynak);
            if !uretim.contains("SIZINTI") {
                hatalar.push(format!("[{ad}] SIZINTI taranmadi:\n{uretim}"));
            }
        }

        // Karsi yon: yorumlar GERCEKTEN atiliyor, dizgideki `//` ve `/*`
        // yorum sayilmiyor. Bu olmazsa modul basliklarindaki `private_notes`
        // gecisleri her dosyayi kirmizi yapardi (fazla gorme).
        let kaynak = [
            "//! MODUL_YORUMU",
            "/// BELGE_YORUMU",
            "fn a() { \"http://DIZGIDEKI_URL\" } // SATIR_SONU_YORUMU",
            "/* BLOK /* IC_ICE */ BLOK_YORUMU */ fn b() { \"BLOKTAN_SONRA\" }",
            "fn c() { \"yol/*DIZGIDEKI_DESEN*/\" }",
        ]
        .join("\n");
        let uretim = uretim_kodunu_ayikla(&kaynak);
        for gorunmeli in ["DIZGIDEKI_URL", "BLOKTAN_SONRA", "DIZGIDEKI_DESEN"] {
            if !uretim.contains(gorunmeli) {
                hatalar.push(format!("`{gorunmeli}` taranmali:\n{uretim}"));
            }
        }
        for elenmeli in
            ["MODUL_YORUMU", "BELGE_YORUMU", "SATIR_SONU_YORUMU", "IC_ICE", "BLOK_YORUMU"]
        {
            if uretim.contains(elenmeli) {
                hatalar.push(format!("`{elenmeli}` elenmeli:\n{uretim}"));
            }
        }
        assert!(hatalar.is_empty(), "{} vaka basarisiz:\n{}", hatalar.len(), hatalar.join("\n---\n"));
    }

    /// Parcalanmis dizgi kacamagini gorunur kilar: dizgi tirnaklari,
    /// bosluklar ve birlestirme noktalama isaretleri atilir, boylece
    /// `"private_" "notes"` ve `concat!("private_", "notes")` tek parcaya
    /// iner.
    fn dizgi_parcalari_birlestir(metin: &str) -> String {
        metin
            .chars()
            .filter(|k| !matches!(k, '"' | ',' | '+' | '\\' | '(' | ')') && !k.is_whitespace())
            .collect()
    }

    // --- Turkce katlama: iki tablo, iki yon -------------------------------

    #[test]
    fn turkce_katlama_not_iceriginde_iki_yonlu_calisir() {
        let (_d, c, cid, rid) = kurulum();
        let r2 = randevu_ekle(&c, cid, "2026-09-08");
        not_kaydet(&c, rid, "dap", "sınav kaygısı ISARET_A", Cihaz::Masaustu).unwrap();
        not_kaydet(&c, r2, "dap", "sinav kaygisi ISARET_B", Cihaz::Masaustu).unwrap();

        // ASCII sorgu -> Turkce metin
        let a = sonuclar_of(&c, "sinav kaygi", 20, Cihaz::Masaustu).unwrap();
        assert!(a.iter().any(|s| s.parca.contains("ISARET_A")), "ASCII sorgu Turkce metni bulmali: {a:?}");
        // Turkce sorgu -> ASCII metin
        let b = sonuclar_of(&c, "sınav kaygı", 20, Cihaz::Masaustu).unwrap();
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

        assert_eq!(sonuclar_of(&c, "ipek sahin", 20, Cihaz::Masaustu).unwrap().len(), 2);
        assert_eq!(sonuclar_of(&c, "İPEK ŞAHİN", 20, Cihaz::Masaustu).unwrap().len(), 2);
    }

    /// Katlanan HER harf ve ASCII karsiligi.
    ///
    /// SQL tarafinda ilk dordu `lower()`'in ASCII kolundan ve iki `replace`
    /// ciftinden (`'ı'->'i'`, `'İ'->'i'`) gelir; kalan on tanesi dogrudan
    /// `SORGU_DANISAN`/`SORGU_NOT` icindeki `replace` zincirinin on halkasidir.
    /// Rust tarafinda hepsi `katla_karakter`'in bir kolu.
    ///
    /// Bu tablo bir INCELEME BULGUSUNU kapatir: kurulum verisindeki adlar
    /// ("Ayse Yilmaz", "Mehmet Demir", "İpek Şahin", "Ipek Sahin") ve not
    /// metinleri, 12 `replace` ciftinin 10'unu HIC calistirmiyordu -- her
    /// biri tek tek silinse de suit 25/25 yesil kaliyordu. Sonuc: "Çağrı
    /// Öztürk" veya "Yılmaz" adli bir danisan ASCII sorguyla SESSIZCE
    /// bulunamaz hâle gelebilirdi. Asagidaki iki test her halkayi kendi
    /// verisiyle, iki yonlu olarak calistirir.
    const KATLANAN_HARFLER: [(char, char); 14] = [
        ('ı', 'i'),
        ('İ', 'i'),
        ('I', 'i'),
        ('i', 'i'),
        ('ş', 's'),
        ('Ş', 's'),
        ('ğ', 'g'),
        ('Ğ', 'g'),
        ('ü', 'u'),
        ('Ü', 'u'),
        ('ö', 'o'),
        ('Ö', 'o'),
        ('ç', 'c'),
        ('Ç', 'c'),
    ];

    #[test]
    fn her_katlanan_harf_danisan_adi_sorgusunda_iki_yonlu_calisir() {
        let (_d, c, _cid, _rid) = kurulum();

        for (sira, (harf, ascii)) in KATLANAN_HARFLER.iter().enumerate() {
            // (1) Ad TURKCE harfi icerir, sorgu ASCII'dir -> SQL `replace`
            //     zincirinin ilgili halkasi calisir.
            let turkce_ad = format!("Sqlkatla{harf}z Kayit{sira:02}");
            // (2) Ad ASCII'dir, sorgu TURKCE harf icerir -> `katla_karakter`
            //     ilgili kolu calisir.
            let ascii_ad = format!("Rustkatla{ascii}z Kayit{sira:02}");
            for ad in [&turkce_ad, &ascii_ad] {
                danisan_ekle(
                    &c,
                    &YeniDanisan { ad_soyad: ad.clone(), telefon: None },
                    Cihaz::Masaustu,
                )
                .unwrap();
            }

            let ascii_sorgu = format!("sqlkatla{ascii}z kayit{sira:02}");
            let bulunan = sonuclar_of(&c, &ascii_sorgu, AZAMI_SONUC, Cihaz::Masaustu).unwrap();
            assert!(
                bulunan.iter().any(|s| s.tur == "danisan" && s.danisan_adi == turkce_ad),
                "SQL katlamasi '{harf}' -> '{ascii}' halkasi calismiyor: \
                 '{ascii_sorgu}' sorgusu '{turkce_ad}' adini bulmali"
            );

            let turkce_sorgu = format!("rustkatla{harf}z kayit{sira:02}");
            let bulunan = sonuclar_of(&c, &turkce_sorgu, AZAMI_SONUC, Cihaz::Masaustu).unwrap();
            assert!(
                bulunan.iter().any(|s| s.tur == "danisan" && s.danisan_adi == ascii_ad),
                "katla_karakter '{harf}' -> '{ascii}' kolu calismiyor: \
                 '{turkce_sorgu}' sorgusu '{ascii_ad}' adini bulmali"
            );
        }
    }

    #[test]
    fn her_katlanan_harf_not_icerigi_sorgusunda_iki_yonlu_calisir() {
        let (_d, c, cid, _rid) = kurulum();

        for (sira, (harf, ascii)) in KATLANAN_HARFLER.iter().enumerate() {
            let r = randevu_ekle(&c, cid, &gun(sira));
            // Tek notta iki yon: TURKCE harfli kelime (ASCII sorguyla
            // aranacak) ve ASCII kelime (TURKCE sorguyla aranacak).
            let icerik =
                format!("Seans{sira:02}: sqlkatla{harf}z ve rustkatla{ascii}z gecti.");
            not_kaydet(&c, r, "dap", &icerik, Cihaz::Masaustu).unwrap();

            let ascii_sorgu = format!("sqlkatla{ascii}z");
            let bulunan = sonuclar_of(&c, &ascii_sorgu, AZAMI_SONUC, Cihaz::Masaustu).unwrap();
            assert!(
                bulunan
                    .iter()
                    .any(|s| s.tur == "not" && s.parca.contains(&format!("Seans{sira:02}"))),
                "SQL katlamasi '{harf}' -> '{ascii}' halkasi not iceriginde calismiyor: \
                 '{ascii_sorgu}' sorgusu Seans{sira:02} notunu bulmali"
            );

            let turkce_sorgu = format!("rustkatla{harf}z");
            let bulunan = sonuclar_of(&c, &turkce_sorgu, AZAMI_SONUC, Cihaz::Masaustu).unwrap();
            assert!(
                bulunan
                    .iter()
                    .any(|s| s.tur == "not" && s.parca.contains(&format!("Seans{sira:02}"))),
                "katla_karakter '{harf}' -> '{ascii}' kolu not iceriginde calismiyor: \
                 '{turkce_sorgu}' sorgusu Seans{sira:02} notunu bulmali"
            );
        }
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
            sonuclar_of(&c, "n_rmal", 20, Cihaz::Masaustu).unwrap().is_empty(),
            "_ joker karakter olarak yorumlanmis"
        );
        // ARTI YON: gercek metin hala bulunuyor -- yukaridaki bos sonuc
        // "arama hic calismiyor"dan degil, kacirmadan geliyor.
        assert!(!sonuclar_of(&c, "normal", 20, Cihaz::Masaustu).unwrap().is_empty());
    }

    #[test]
    fn kacirilan_isaretler_gercekten_aranabilir() {
        // Kacirma metni ARAMA DISI birakmamali: notta gercekten `%` varsa
        // bulunmali.
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "iyilesme %40 civarinda", Cihaz::Masaustu).unwrap();
        let sonuclar = sonuclar_of(&c, "%40", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(sonuclar.len(), 1, "literal % aranabilmeli: {sonuclar:?}");
    }

    // --- Sonuc siniri ------------------------------------------------------

    #[test]
    fn sonuc_sayisi_azami_siniri_asmaz() {
        // SABITIN KENDISINDEN TUREMEYEN IDDIA: asagidaki tek satir olmadan
        // bu test totolojikti -- `AZAMI_SONUC`'u 50'den 30'a cekmek testi
        // yesil birakiyordu, cunku hem kurulum hem beklenti ayni sabitten
        // besleniyordu. Sinir bir SOZLESME (bkz. modul basligi: sinirsiz
        // arama toplu disa aktarimdir); duz sayiyla da yazilir.
        assert_eq!(AZAMI_SONUC, 50, "azami sonuc sozlesmesi 50'dir");

        let (_d, c, cid, _rid) = kurulum();
        for i in 0..(AZAMI_SONUC as usize + 5) {
            let r = randevu_ekle(&c, cid, &gun(i));
            not_kaydet(&c, r, "dap", "ORTAKKELIME notu", Cihaz::Masaustu).unwrap();
        }
        let sonuclar = sonuclar_of(&c, "ORTAKKELIME", 10_000, Cihaz::Masaustu).unwrap();
        assert_eq!(sonuclar.len(), 50);
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
        assert_eq!(sonuclar_of(&c, "ORTAKKELIME", 50, Cihaz::Masaustu).unwrap().len(), 10);
        assert_eq!(sonuclar_of(&c, "ORTAKKELIME", -1, Cihaz::Masaustu).unwrap().len(), 1);
        assert_eq!(sonuclar_of(&c, "ORTAKKELIME", 0, Cihaz::Masaustu).unwrap().len(), 1);
    }

    // --- Siralama bir sozlesmedir ------------------------------------------
    //
    // Iki `ORDER BY` de sessizce ters cevrilebiliyordu: `a.baslangic DESC,
    // p.appointment_id DESC` -> `ASC, ASC` ve `ad_soyad COLLATE NOCASE` ->
    // `id DESC`, ikisi de 25/25 YESIL. Oysa `LIMIT` her sorgunun ICINDE
    // oldugu icin siralama HANGI SATIRLARIN HAYATTA KALACAGINI belirler:
    // `ASC` altinda terapist en yeni degil EN ESKI 50 notu gorurdu.
    // Emsal: `notes::tests::danisan_notlari_en_yeniden_eskiye_siralanir`
    // (ayni `ORDER BY`, FARKLI tarihlerle).

    #[test]
    fn not_sonuclari_en_yeni_seanstan_eskiye_siralanir() {
        let (_d, c, cid, _rid) = kurulum();
        let eski = randevu_ekle(&c, cid, "2026-03-01");
        let orta = randevu_ekle(&c, cid, "2026-03-15");
        let yeni = randevu_ekle(&c, cid, "2026-03-30");
        // Ekleme sirasi tarih sirasindan FARKLI: siralama gercekten
        // `a.baslangic`'a bakmali, ekleme/kimlik sirasina degil.
        not_kaydet(&c, orta, "dap", "SIRALIOK orta", Cihaz::Masaustu).unwrap();
        not_kaydet(&c, eski, "dap", "SIRALIOK eski", Cihaz::Masaustu).unwrap();
        not_kaydet(&c, yeni, "dap", "SIRALIOK yeni", Cihaz::Masaustu).unwrap();

        let sonuclar = sonuclar_of(&c, "SIRALIOK", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        let sira: Vec<Option<i64>> = sonuclar.iter().map(|s| s.appointment_id).collect();
        assert_eq!(
            sira,
            vec![Some(yeni), Some(orta), Some(eski)],
            "notlar en yeni seanstan en eskiye siralanmali"
        );
    }

    #[test]
    fn danisan_sonuclari_ada_gore_harf_duyarsiz_siralanir() {
        let (_d, c, _cid, _rid) = kurulum();
        // Ekleme sirasi (Alfa, Zeta, beta) beklenen siradan (Alfa, beta,
        // Zeta) farkli: `id ASC` de `id DESC` de yakalanir. Ayrica "beta"
        // KUCUK harfle basliyor: `COLLATE NOCASE` dusurulurse ikili
        // siralamada "Zeta" (Z=90) < "beta" (b=98) olur ve sira bozulur.
        for ad in ["Alfa ADSIRA", "Zeta ADSIRA", "beta ADSIRA"] {
            danisan_ekle(
                &c,
                &YeniDanisan { ad_soyad: ad.into(), telefon: None },
                Cihaz::Masaustu,
            )
            .unwrap();
        }

        let sonuclar = sonuclar_of(&c, "ADSIRA", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        let adlar: Vec<&str> = sonuclar.iter().map(|s| s.danisan_adi.as_str()).collect();
        assert_eq!(adlar, vec!["Alfa ADSIRA", "beta ADSIRA", "Zeta ADSIRA"]);
    }

    #[test]
    fn siralama_hangi_satirlarin_hayatta_kalacagini_belirler() {
        // EN ONEMLI SIRALAMA IDDIASI. `LIMIT` sorgunun ICINDE; yanlis
        // siralama sonuclari yalnizca yeniden dizmez, YANLIS SATIRLARI
        // secer -- ve kesilen satirlar arayuze hic ulasmaz.
        let (_d, c, cid, _rid) = kurulum();

        // (a) NOTLAR: 55 farkli gunde 55 not. Sinir 50 => EN YENI 50
        //     hayatta kalmali; en eski 5 gun (gun(0)..gun(4)) DUSMELI.
        for i in 0..55 {
            let r = randevu_ekle(&c, cid, &gun(i));
            not_kaydet(&c, r, "dap", "KESILENSIRA notu", Cihaz::Masaustu).unwrap();
        }
        let notlar = sonuclar_of(&c, "KESILENSIRA", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        assert_eq!(notlar.len(), 50);
        let tarihler: Vec<String> = notlar.iter().map(|s| s.tarih.clone().unwrap()).collect();
        let mut azalan = tarihler.clone();
        azalan.sort_by(|a, b| b.cmp(a));
        assert_eq!(tarihler, azalan, "tarihler azalan sirada olmali");
        assert!(
            tarihler[0].starts_with(&gun(54)),
            "en yeni seans ilk sirada olmali: {}",
            tarihler[0]
        );
        for i in 0..5 {
            assert!(
                !tarihler.iter().any(|t| t.starts_with(&gun(i))),
                "en eski 5 gun kesilmis olmali; {} hâlâ listede",
                gun(i)
            );
        }

        // (b) DANISANLAR: 55 ad, ekleme sirasi alfabetik siradan farkli
        //     (once cift numaralar, sonra tekler). Sinir 50 => alfabetik
        //     ILK 50 (K00..K49) hayatta kalmali. `id ASC` ya da `id DESC`
        //     ile siralanirsa kume degisir.
        let (_d2, c2, _cid2, _rid2) = kurulum();
        for i in (0..55).step_by(2).chain((1..55).step_by(2)) {
            danisan_ekle(
                &c2,
                &YeniDanisan { ad_soyad: format!("K{i:02} KESILENAD"), telefon: None },
                Cihaz::Masaustu,
            )
            .unwrap();
        }
        let danisanlar = sonuclar_of(&c2, "KESILENAD", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        let adlar: Vec<&str> = danisanlar.iter().map(|s| s.danisan_adi.as_str()).collect();
        let beklenen: Vec<String> = (0..50).map(|i| format!("K{i:02} KESILENAD")).collect();
        assert_eq!(adlar, beklenen.iter().map(String::as_str).collect::<Vec<_>>());
    }

    // --- Iki kip tek butceyi paylasir (bkz. modul basligi) ----------------
    //
    // ONCEKI DAVRANIS BIR KULLANICI HATASIYDI: iki liste arka arkaya eklenip
    // sondan `truncate` ediliyordu. Danisan adlarinda yaygin bir terim
    // ("Yilmaz") 61 danisanla eslesince, ayni terimi iceren seans notu
    // listenin altina degil TAMAMEN disina dusuyordu -- terapist notun
    // varligini hic goremiyordu. Asagidaki iki test o davranisi sabitler.

    #[test]
    fn danisan_adlarinda_yaygin_terim_not_eslesmesini_silmez() {
        let (_d, c, _cid, rid) = kurulum();
        // 61 danisan: tek basina limitin (50) tamamini yiyecek kadar cok.
        for i in 0..61 {
            danisan_ekle(
                &c,
                &YeniDanisan { ad_soyad: format!("ORTAKAD Danisan {i:02}"), telefon: None },
                Cihaz::Masaustu,
            )
            .unwrap();
        }
        // ...ve ayni terimi iceren TEK bir not.
        not_kaydet(&c, rid, "dap", "Seansta ORTAKAD gecti.", Cihaz::Masaustu).unwrap();

        let sonuclar = sonuclar_of(&c, "ORTAKAD", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        let danisan_sayisi = sonuclar.iter().filter(|s| s.tur == "danisan").count();
        let not_sayisi = sonuclar.iter().filter(|s| s.tur == "not").count();

        assert_eq!(sonuclar.len(), 50, "ust sinir korunmali");
        assert_eq!(
            not_sayisi, 1,
            "not kipi TAMAMEN silinmemeli: 61 danisan + 1 not => 1 not gorunmeli"
        );
        assert_eq!(danisan_sayisi, 49, "kullanilmayan not butcesi danisanlara devredilmeli");
        // Donen notun gercekten aranan not oldugunu dogrula (bos kip degil).
        let not = sonuclar.iter().find(|s| s.tur == "not").expect("not kipi temsil edilmeli");
        assert_eq!(not.appointment_id, Some(rid));
    }

    #[test]
    fn iki_kip_de_bolsa_butce_paylasilir_ve_ust_sinir_yapisal_olarak_korunur() {
        // Her iki sorgu da `LIMIT` dolusu (50) satir dondurur. `take` ile
        // paylastirma kaldirilip yerine sondan kirpma konsaydi bile toplam
        // 50 kalirdi; kirpma TAMAMEN kaldirilirsa 2x50 = 100 doner. Bu test
        // her iki mutasyonu da yakalar: toplam 50 VE dagilim 25/25.
        let (_d, c, cid, _rid) = kurulum();
        for i in 0..51 {
            danisan_ekle(
                &c,
                &YeniDanisan { ad_soyad: format!("CIFTKIP Danisan {i:02}"), telefon: None },
                Cihaz::Masaustu,
            )
            .unwrap();
            let r = randevu_ekle(&c, cid, &gun(i));
            not_kaydet(&c, r, "dap", "CIFTKIP notu", Cihaz::Masaustu).unwrap();
        }

        let sonuclar = sonuclar_of(&c, "CIFTKIP", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        assert_eq!(sonuclar.len(), 50, "toplam ust sinir asilmamali (2x50 degil)");
        assert_eq!(sonuclar.iter().filter(|s| s.tur == "danisan").count(), 25);
        assert_eq!(sonuclar.iter().filter(|s| s.tur == "not").count(), 25);
    }

    // --- Kirpilma isareti: bilinen bosluk kapaniyor --------------------
    //
    // Butce paylastirmasi sessiz kaybi HAFIFLETTI, kaldirmadi: 61 danisan
    // eslesirse 12'si hala duser ve cagiran bunu hicbir yerden ogrenemezdi.
    // Asagidaki testler `kirpildi`'yi IKI YONLU sabitler -- "hep true don"
    // ve "hep false don" mutasyonlarinin ikisi de kirilir.

    #[test]
    fn kirpilma_isareti_dusen_eslesme_varken_dogrudur() {
        let (_d, c, _cid, rid) = kurulum();
        for i in 0..61 {
            danisan_ekle(
                &c,
                &YeniDanisan { ad_soyad: format!("KIRPIK Danisan {i:02}"), telefon: None },
                Cihaz::Masaustu,
            )
            .unwrap();
        }
        not_kaydet(&c, rid, "dap", "Seansta KIRPIK gecti.", Cihaz::Masaustu).unwrap();

        let yanit = ara(&c, "KIRPIK", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        assert_eq!(yanit.sonuclar.len(), 50, "on kosul: liste gercekten dolmali");
        assert!(yanit.kirpildi, "61 danisan + 1 not, sinir 50: dusen eslesme VAR");
    }

    #[test]
    fn kirpilma_isareti_tam_sinirdaki_aramada_yanlis_uyarmaz() {
        // ARAYUZUN ESKI SEZGISININ (`sonuc sayisi == sinir`) YANLIS oldugu
        // durum: tam olarak `sinir` kadar eslesme var ve HICBIRI dusmedi.
        // Sezgi burada "daha fazlasi olabilir" derdi; bayrak demez.
        //
        // MUTASYON: `LIMIT sinir + 1` yerine `LIMIT sinir` yazip
        // `kirpildi = sonuclar.len() == toplam` demek -> bu test kirilir.
        let (_d, c, cid, _rid) = kurulum();
        for i in 0..AZAMI_SONUC {
            let r = randevu_ekle(&c, cid, &gun(i as usize));
            not_kaydet(&c, r, "dap", &format!("TAMSINIR notu {i}"), Cihaz::Masaustu).unwrap();
        }

        let yanit = ara(&c, "TAMSINIR", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        assert_eq!(yanit.sonuclar.len(), AZAMI_SONUC as usize, "on kosul: liste tam dolmali");
        assert!(!yanit.kirpildi, "tam sinirdaki arama kirpilmis SAYILMAMALI");

        // Ve BIR TANE daha eklenince bayrak donmeli (iki yon ayni kurulumda).
        let r = randevu_ekle(&c, cid, &gun(AZAMI_SONUC as usize));
        not_kaydet(&c, r, "dap", "TAMSINIR notu fazladan", Cihaz::Masaustu).unwrap();
        let yanit = ara(&c, "TAMSINIR", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        assert_eq!(yanit.sonuclar.len(), AZAMI_SONUC as usize);
        assert!(yanit.kirpildi, "sinirin bir fazlasi kirpilma olarak bildirilmeli");
    }

    #[test]
    fn kirpilma_isareti_az_sonucta_ve_bos_sonucta_kapalidir() {
        // "Hep true don" mutasyonunu yakalar: her aramada uyaran bir arayuz
        // uyariyi anlamsizlastirir.
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "AZSONUC notu", Cihaz::Masaustu).unwrap();

        let dolu = ara(&c, "AZSONUC", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        assert_eq!(dolu.sonuclar.len(), 1, "on kosul: tek sonuc donmeli");
        assert!(!dolu.kirpildi);

        let bos = ara(&c, "HICBIRSEYEUYMAZ", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        assert!(bos.sonuclar.is_empty());
        assert!(!bos.kirpildi, "sonuc yoksa kirpilma da yoktur");

        let kisa = ara(&c, "a", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        assert!(kisa.sonuclar.is_empty());
        assert!(!kisa.kirpildi, "cok kisa sorgu kirpilmis sayilmamali");
    }

    #[test]
    fn kirpilma_isareti_kip_bazinda_dusen_eslesmeyi_de_gorur() {
        // Toplam sinira DAYANMAYAN kayip: her iki kip de bol, bütçe 25/25
        // paylasiliyor ve her kipten 26+ eslesme duşuyor. "Toplam == sinir"
        // sezgisi bunu ancak tesadufen yakalardi; bayrak kip bazinda bakiyor.
        let (_d, c, cid, _rid) = kurulum();
        for i in 0..30 {
            danisan_ekle(
                &c,
                &YeniDanisan { ad_soyad: format!("IKIKIP Danisan {i:02}"), telefon: None },
                Cihaz::Masaustu,
            )
            .unwrap();
            let r = randevu_ekle(&c, cid, &gun(i));
            not_kaydet(&c, r, "dap", "IKIKIP notu", Cihaz::Masaustu).unwrap();
        }

        let yanit = ara(&c, "IKIKIP", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        assert_eq!(yanit.sonuclar.len(), 50);
        assert_eq!(yanit.sonuclar.iter().filter(|s| s.tur == "danisan").count(), 25);
        assert_eq!(yanit.sonuclar.iter().filter(|s| s.tur == "not").count(), 25);
        assert!(yanit.kirpildi, "her iki kipten de 5'er eslesme dustu");
    }

    #[test]
    fn kirpilma_isareti_loga_yazilmaz() {
        // Sonuc sayisi gibi kirpilma bilgisi de `audit_log`a girmez: art
        // arda aramalarla bir terimin varligini sizdirirdi ve satirlar
        // SILINEMEZ. Bu yalnizca govde meselesidir.
        let (_d, c, _cid, rid) = kurulum();
        for i in 0..61 {
            danisan_ekle(
                &c,
                &YeniDanisan { ad_soyad: format!("LOGKIRPIK {i:02}"), telefon: None },
                Cihaz::Masaustu,
            )
            .unwrap();
        }
        not_kaydet(&c, rid, "dap", "LOGKIRPIK notu", Cihaz::Masaustu).unwrap();

        let yanit = ara(&c, "LOGKIRPIK", AZAMI_SONUC, Cihaz::Masaustu).unwrap();
        assert!(yanit.kirpildi, "on kosul: bu arama gercekten kirpilmali");

        for kayit in crate::store::audit::son_kayitlar(&c, 200).unwrap() {
            if kayit.varlik != VARLIK_ARAMA {
                continue;
            }
            assert_eq!(kayit.varlik_id, VARLIK_ID_ARAMA, "kirpilma varlik_id'ye sizmis");
            assert!(kayit.ayrinti.is_none(), "kirpilma ayrintiya sizmis: {:?}", kayit.ayrinti);
        }
    }

    #[test]
    fn parca_tum_notu_dondurmez() {
        let (_d, c, _cid, rid) = kurulum();
        let uzun = format!("{} HEDEFKELIME {}", "a".repeat(500), "b".repeat(500));
        not_kaydet(&c, rid, "dap", &uzun, Cihaz::Masaustu).unwrap();

        let sonuclar = sonuclar_of(&c, "HEDEFKELIME", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(sonuclar.len(), 1);
        let parca = &sonuclar[0].parca;
        assert!(parca.contains("HEDEFKELIME"), "eslesme parcada olmali: {parca}");
        assert!(
            parca.chars().count() <= PARCA_UZUNLUGU + 2,
            "parca {} karakter, sinir {}: {parca}",
            parca.chars().count(),
            PARCA_UZUNLUGU + 2
        );
        // SABITTEN TUREMEYEN IDDIA. Yukaridaki sinir `PARCA_UZUNLUGU`'nun
        // kendisinden besleniyor: sabiti 80'den 200'e cekmek testi yesil
        // birakiyordu. Parca not iceriginin bir KESITIDIR; buyumus bir
        // parca sizintidir (arama sonuclari ekranda gorunur ve ekran
        // gorunurken danisan odada olabilir -- bkz. modul basligi).
        // Kirpma isaretleriyle birlikte 82 karakter duz sayiyla yazilir.
        assert!(
            parca.chars().count() <= 82,
            "parca 82 karakteri asmamali, {} karakter: {parca}",
            parca.chars().count()
        );
        // 200'de parca 158 'b' iceriyordu ve `repeat(200)` iddiasinin
        // altindan geciyordu; esik gercek pencereye gore siki tutuluyor.
        assert!(!parca.contains(&"b".repeat(50)), "notun tamami donmus: {parca}");
    }

    // --- Denetim kaydi -----------------------------------------------------

    #[test]
    fn arama_loglanir_ama_pencere_icinde_birlestirilir() {
        // IKI YONLU: "cok fazla" yonu (3 arama = 1 satir) VE "cok az" yonu
        // (log tamamen kaldirilirsa 0 satir kalir, ilk iddia kirilir).
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "kaygi notu", Cihaz::Masaustu).unwrap();

        assert_eq!(arama_log_sayisi(&c), 0, "on kosul: henuz arama yapilmadi");
        sonuclar_of(&c, "kaygi", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(arama_log_sayisi(&c), 1, "arama loglanmali");

        sonuclar_of(&c, "kaygi", 20, Cihaz::Masaustu).unwrap();
        sonuclar_of(&c, "baska", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(arama_log_sayisi(&c), 1, "pencere icinde tek satir kalmali");

        // Farkli CIHAZ ayri bir satirdir: log "hangi cihazdan" sorusunu
        // yanitlar (bkz. audit::son_kayit_yakin_mi).
        sonuclar_of(&c, "kaygi", 20, Cihaz::Telefon).unwrap();
        assert_eq!(arama_log_sayisi(&c), 2, "telefon ayri bir satir yazmali");
    }

    /// Pencerenin DISINDA duran bir `audit_log` satirini bastan eski
    /// zamanla yazar (`notes::tests::eski_satir_ekle` ile ayni desen).
    /// `audit_log`'a INSERT serbesttir; yasak olan UPDATE/DELETE'tir --
    /// var olan bir satirin zamanini geri almak tetikleyici tarafindan
    /// (dogru olarak) reddedilir, bu yuzden satir bastan eski yazilir.
    fn eski_arama_satiri_ekle(c: &rusqlite::Connection, dk_once: i64) {
        let zaman = (OffsetDateTime::now_utc() - time::Duration::minutes(dk_once))
            .replace_nanosecond(0)
            .unwrap()
            .format(&Rfc3339)
            .unwrap();
        c.execute(
            "INSERT INTO audit_log (olay_zamani, eylem, varlik, varlik_id, cihaz, ayrinti)
             VALUES (?1, 'goruntuleme', ?2, ?3, 'masaustu', NULL)",
            rusqlite::params![zaman, VARLIK_ARAMA, VARLIK_ID_ARAMA],
        )
        .unwrap();
    }

    #[test]
    fn pencere_disindaki_satir_yeni_arama_kaydini_susturmaz() {
        // LOGUN SUSTURULMA YONU. Yukaridaki test dort cagriyi da TEK
        // pencere icinde yapiyor ve pencerenin UZUNLUGUNU hic sabitlemiyor:
        // `OturumBasi(BIRLESTIRME_PENCERESI_DK)` -> `OturumBasi(525_600)`
        // (bir yil) mutasyonu 25/25 YESIL birakiyordu. O mutasyon altinda
        // denetim kaydi -- KVKK 2018/10'un istedigi kayit -- fiilen yok
        // olurdu: cihaz basina yilda bir satir.
        //
        // Emsal: `notes::tests::pencere_disindaki_satir_bes_log_yolunun
        // _hicbirini_susturmaz`.
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "PENCERE notu", Cihaz::Masaustu).unwrap();

        // Pencere 5 dk; 10 dk oncesine bir satir koy.
        eski_arama_satiri_ekle(&c, 10);
        assert_eq!(arama_log_sayisi(&c), 1, "on kosul: tek eski satir olmali");

        sonuclar_of(&c, "PENCERE", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(
            arama_log_sayisi(&c),
            2,
            "pencere DISINDAKI eski satir yeni aramayi susturmamali -- \
             birlestirme penceresi ZAMANA BAGLI olmali"
        );

        // Pencere ICINDEKI satir ise susturur: ayni cagri hemen tekrar
        // edilince yeni satir YAZILMAZ. (Iki yon ayni testte.)
        sonuclar_of(&c, "PENCERE", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(arama_log_sayisi(&c), 2, "pencere icinde tek satir kalmali");
    }

    #[test]
    fn cok_kisa_sorgu_log_satiri_birakmaz() {
        // Gorev 7'de rota acilinca `?q=a` her tuş vurusunda gelir; her biri
        // SILINEMEZ bir satir birakirsa disaridan tetiklenebilir bir gurultu
        // yolu acilir.
        let (_d, c, _cid, _rid) = kurulum();
        sonuclar_of(&c, "", 20, Cihaz::Masaustu).unwrap();
        sonuclar_of(&c, "a", 20, Cihaz::Masaustu).unwrap();
        sonuclar_of(&c, "  ", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(arama_log_sayisi(&c), 0, "cok kisa sorgu log yazmamali");
    }

    #[test]
    fn arama_audit_log_uzerinde_update_veya_delete_denemez() {
        let uretim = uretim_kodu().to_uppercase();
        assert!(!uretim.contains("UPDATE AUDIT_LOG"));
        assert!(!uretim.contains("DELETE FROM AUDIT_LOG"));
        // Bosluk/parcalanma kacamagi burada da kapali.
        let birlesik = dizgi_parcalari_birlestir(&uretim);
        assert!(!birlesik.contains("UPDATEAUDIT_LOG"));
        assert!(!birlesik.contains("DELETEFROMAUDIT_LOG"));
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

        let once = sonuclar_of(&c, "TASINAN_NOT", 20, Cihaz::Masaustu).unwrap();
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

        let sonra = sonuclar_of(&c, "TASINAN_NOT", 20, Cihaz::Masaustu).unwrap();
        assert_eq!(sonra.len(), 1);
        assert_eq!(sonra[0].client_id, b.id, "yetkili kaynak appointments olmali");
        assert_eq!(sonra[0].danisan_adi, "Mehmet Demir");
    }

    #[test]
    fn arsivlenmis_danisan_da_bulunur() {
        // Dislayici `WHERE` deseni bu modulde YOK: arsiv kaydi da aranabilir.
        let (_d, c, cid, _rid) = kurulum();
        crate::store::clients::arsivle(&c, cid, Cihaz::Masaustu).unwrap();
        assert!(sonuclar_of(&c, "Ayse", 20, Cihaz::Masaustu)
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
            tag_id: Some(123_123),
            etiket_adi: Some("COK_GIZLI_ETIKET_ADI".into()),
            kullanim: Some(7),
        };
        let metin = format!("{sonuc:?}");
        assert!(!metin.contains("COK_GIZLI_NOT_PARCASI"), "Debug parcayi basmamali: {metin}");
        assert!(!metin.contains("COK_GIZLI_ISIM"), "Debug ismi basmamali: {metin}");
        assert!(!metin.contains("424242"), "Debug client_id'yi basmamali: {metin}");
        assert!(!metin.contains("2026-09-07"), "Debug tarihi basmamali: {metin}");
        assert!(!metin.contains("COK_GIZLI_ETIKET_ADI"), "Debug etiket adini basmamali: {metin}");
        assert!(
            metin.contains("appointment_id: Some(481516)"),
            "hata ayiklama icin appointment_id gorunur kalmali: {metin}"
        );
        assert!(
            metin.contains("tag_id: Some(123123)"),
            "hata ayiklama icin tag_id gorunur kalmali: {metin}"
        );
        assert!(
            metin.contains("kullanim: Some(7)"),
            "hata ayiklama icin kullanim gorunur kalmali: {metin}"
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

        let sonuc = sonuclar_of(&c, "COK_GIZLI_NOT_PARCASI", 20, Cihaz::Masaustu);
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

    /// `ASGARI_SORGU` ile istemcideki (`HizliArama.tsx`) karşılığı yalnızca
    /// YORUMLA eşleşiyordu (Görev 6d). Emsal:
    /// `server::routes::backup::tests::baglama_kararinin_kosulu_hala_gecerli_mi`
    /// (Rust tarafından TypeScript kaynağını metin olarak okuyup sabiti
    /// arıyor). Mutasyon: bu sabiti değiştirmek (`ASGARI_SORGU: usize = 3`)
    /// -- test aranan dizgiyi bulamayıp kırmızıya döner.
    #[test]
    fn asgari_sorgu_istemciyle_ayni() {
        let yol = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("core'un ust dizini workspace koku olmali")
            .join("web/src/arama/HizliArama.tsx");
        let kaynak = std::fs::read_to_string(&yol)
            .unwrap_or_else(|e| panic!("{} okunamadi: {e}", yol.display()));
        let beklenen = format!("const ASGARI_SORGU = {ASGARI_SORGU}");
        assert!(
            kaynak.contains(&beklenen),
            "istemcideki ASGARI_SORGU (HizliArama.tsx) sunucudaki degerle \
             ({ASGARI_SORGU}) artik eslesmiyor olabilir; ikisi ayri sabitler ve \
             yalnizca yorumla baglaniyor (bkz. bu dosyadaki ASGARI_SORGU yorumu)."
        );
    }
}
