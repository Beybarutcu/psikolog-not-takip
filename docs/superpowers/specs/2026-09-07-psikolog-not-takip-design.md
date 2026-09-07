# Terapi Notu ve Randevu Takip Uygulaması — Tasarım Dokümanı

**Tarih:** 2026-09-07
**Durum:** Onaylandı, uygulama planı bekliyor

## 1. Problem ve Kullanıcı

Serbest çalışan tek bir psikolog, danışanlarıyla yaptığı seansların notlarını, randevularını ve
ücret takibini tek yerden yürütmek istiyor. Bugün bunu kağıt/Word/takvim karışımıyla yapıyor.

Verinin tamamı sağlık verisi olduğu için (KVKK md. 6 — özel nitelikli kişisel veri) bulut tabanlı
bir ürün kullanmak istemiyor. Uygulama kullanıcının kendi makinesinde çalışacak, veri o makineden
çıkmayacak.

**Kullanıcı teknik değil.** Kurulum "indir, kur, ikona tıkla" olmalı; terminal, Docker, ayar
dosyası düzenleme gibi hiçbir adım kabul edilebilir değil. Bu, tasarımın her kararında birinci
kısıt.

### Başarı ölçütü

1. Seans bitiminde not yazmak, kağıda yazmaktan hızlı olmalı (randevuya tıkla → yaz → bitti).
2. Beş yıl sonra "2026'da bu danışanla ne konuşmuştuk" sorusu 10 saniyede yanıtlanabilmeli.
3. Bilgisayar çalınırsa veri okunamamalı; bilgisayar bozulursa veri kaybolmamalı.

## 2. Kapsam

### v1'de var

- Danışan dosyası (iletişim, başvuru nedeni, rıza durumu, ekli dosyalar)
- Seans notları (şablonlu, otomatik kayıtlı, resmî not + özel not ayrımı)
- Randevu takvimi (tekrarlayan randevular, geldi/gelmedi/iptal)
- Ücret ve ödeme takibi (seans içinde, ay sonu özeti)
- Şifreli otomatik yedekleme ve geri yükleme
- Yerel ağ üzerinden telefon erişimi (kısıtlı görünüm)
- Erişim logu ve saklama süresi takibi (KVKK gereği)

### v1'de bilinçli olarak yok

- Ölçek/test sonuçları ve ilerleme grafiği (v2'de ilk sırada)
- SMS/e-posta randevu hatırlatması — bir sağlayıcıya danışan verisi göndermek gerekirdi.
  Yerine: panoya hazır hatırlatma metni kopyalama, kullanıcı kendi gönderir.
- Telesağlık, e-fatura, çoklu kullanıcı, bulut senkronizasyon

## 3. Mimari

Tek bir uygulama, tek bir arayüz kodu, iki cihaz.

```
+------------------- Kullanicinin bilgisayari --------------------+
|                                                                 |
|  Tauri penceresi  ----->  http://127.0.0.1:7700                 |
|  (masaustu gorunumu)              |                             |
|                                   v                             |
|                        Gomulu Axum HTTP sunucusu                |
|                        (yalnizca yerel aga baglanir)            |
|                                   |                             |
|                                   v                             |
|                        SQLCipher (AES-256) tek dosya            |
|                                   |                             |
|                                   v                             |
|                        Gunluk sifreli yedek (7 gun donusumlu)   |
+-----------------------------------+-----------------------------+
                                    | ayni Wi-Fi
                          http://192.168.x.x:7700
                                    |
                             Telefon tarayicisi
                             (kisitli gorunum)
```

| Katman | Seçim | Gerekçe |
|---|---|---|
| Masaüstü kabuk | Tauri 2 | Tek `.exe`, harici runtime yok, ~10 MB |
| Veri | SQLite + SQLCipher (AES-256) | Diskte tamamen şifreli; yedek = tek dosya |
| Sunucu | Gömülü Axum (Rust) | Ayrıca kurulan servis yok; uygulama kapanınca kapanır |
| Arayüz | React + TypeScript + Tailwind | Tek kod tabanı, masaüstü ve telefonda responsive |

Tauri penceresi de telefon da aynı yerel sunucuya bağlanır; bu yüzden **iki ayrı arayüz kodu
yoktur** ve cihazlar arasında senkronizasyon problemi oluşmaz (tek yazıcı, tek veritabanı).

### Reddedilen alternatifler

- **Electron + Node:** daha hızlı geliştirilir ama kurulum ~150 MB ve Windows'ta SQLCipher
  entegrasyonu kırılgan.
- **Sadece masaüstü, telefon yok:** telefonda not girme ihtiyacı karşılanmıyor.
- **VPN ile her yerden erişim:** ek kurulum adımı ve genişleyen risk yüzeyi; teknik olmayan
  kullanıcı için v1'de gereksiz.

## 4. Güvenlik

### Anahtar zinciri

```
Ana parola     --Argon2id-->  ana anahtar       --sarmalar-->  veri anahtari  -->  SQLCipher
Kurtarma kodu  --Argon2id-->  kurtarma anahtari --sarmalar-->  ayni veri anahtari
```

Veritabanı rastgele üretilmiş bir *veri anahtarı* ile şifrelenir; bu anahtar hem ana paroladan
hem de kurtarma kodundan türetilen anahtarlarla ayrı ayrı sarmalanmış olarak saklanır.

- Parola değiştirmek veritabanını yeniden şifrelemeyi gerektirmez, yalnızca sarmalama yenilenir.
- Kurulumda 24 karakterlik kurtarma kodu üretilir ve yazdırılması istenir.
- Parola ve kurtarma kodunun ikisi de kaybolursa veri kurtarılamaz. Bu, kurulum ekranında
  yumuşatılmadan belirtilir.

### Oturum ve kilit

- Açılışta ana parola sorulur; anahtar yalnızca bellekte tutulur.
- 5 dakika hareketsizlikte otomatik kilit (süre ayarlanabilir). Kilitliyken arama dahil hiçbir
  veri dönmez.
- Parola denemelerinde artan gecikme (1s, 2s, 4s...). Kalıcı hesap kilidi yok — kullanıcıyı kendi
  verisinden mahrum bırakır, saldırganı durdurmaz.

### Telefon erişimi

- Varsayılan **kapalı**. Masaüstünden açıldığında 6 haneli eşleştirme kodu ve QR kod gösterilir.
- Telefon bir kereye mahsus eşleşir, sonrasında 6 haneli PIN ile girer (KVKK 2018/10'un uzaktan
  erişimde iki kademeli doğrulama şartını karşılar).
- Sunucu yalnızca yerel ağ arayüzüne bağlanır; internete açılmaz.
- Eşleşmiş cihazlar listelenir ve tek tıkla iptal edilebilir.

### Erişim logu

KVKK Kurul Kararı 2018/10 gereği her görüntüleme, düzenleme, dışa aktarma ve silme; zamanı,
işlemi, kaydı ve cihazı (masaüstü/telefon) ile loglanır. `audit_log` tablosunda UPDATE ve DELETE
veritabanı tetikleyicisiyle engellenir — uygulama isteseydi bile geçmişi değiştiremez.

## 5. Veri modeli

| Tablo | İçerik | Kritik alanlar |
|---|---|---|
| `clients` | Danışan kartı | rıza tarihi, onam dosyası, son temas, saklama bitiş tarihi, aktif/arşiv |
| `appointments` | Randevu **ve** seans kaydı | başlangıç/bitiş, durum, ücret, ödendi mi, tekrar kuralı |
| `progress_notes` | Resmî seans notu | randevu bağı, şablon tipi, içerik, güncelleme zamanı |
| `private_notes` | Terapistin özel notu | ayrı tablo; dışa aktarım ve raporlara dahil değil |
| `attachments` | Onam formu, test PDF'i | veritabanı içinde BLOB (yedek tek dosya kalsın diye) |
| `audit_log` | Erişim kaydı | yalnızca ekleme; UPDATE/DELETE tetikleyiciyle bloke |
| `devices` | Eşleşmiş telefonlar | PIN özeti, eşleşme tarihi, iptal tarihi |
| `templates` | Not şablonları | kullanıcı tanımlı başlıklar |

### İki tasarım kararının gerekçesi

**Randevu ve seans aynı kayıttır.** Ayrı tablolara bölmek "randevu var ama seans kaydı yok" gibi
tutarsız durumlar üretir ve kullanıcıyı aynı bilgiyi iki yerde aramaya zorlar. Randevunun kendisi
seans kaydıdır; not ona bağlanır.

**Resmî not ile özel not ayrı tablolardadır.** Uluslararası pratikte ilerleme notu (tarih, süre,
yöntem, semptom, plan — danışan ve üçüncü taraflar erişebilir) ile terapistin süreç notu (kendi
hipotezleri, izlenimleri) ayrılır; ayrı tutulmazsa ikincisi korumasını kaybeder. Özel notlar
hiçbir dışa aktarım sorgusuna dahil edilmez ve arayüzde farklı renkte, ayrı sekmede gösterilir.

## 6. Ekranlar ve akış

**Takvim ana ekrandır**; her şey takvimden açılır.

### Seans akışı (en kritik yol)

Takvimde randevuya tıklanır → ekran ikiye bölünür:

- **Sol:** danışanın bağlamı — son 3 seansın notu (katlanmış), başvuru nedeni, risk notu.
- **Sağ:** bugünkü not editörü, imleç hazır.

Not editörü:

- **Otomatik kayıt, 2 saniyede bir.** Kaydet butonu yoktur; "kaydedildi 14:32" göstergesi vardır.
  (İncelenen ürünlerin en sık şikayeti not kaybıydı.)
- Varsayılan şablon **DAP** (Veri / Değerlendirme / Plan); SOAP ve serbest metin seçenektir.
  Şablonlar kullanıcı tarafından düzenlenebilir — sabit form değil, hazır başlıklardır.
- İki sekme: "Seans Notu" ve görsel olarak ayrışmış "Özel Notlarım".

Panelin altında tek satırda: geldi/gelmedi/iptal + ücret + ödendi. Ödeme takibi ayrı modül
değildir; ayrı ekranda aynı seansı ikinci kez girmek kullanıcıyı yorar.

### Diğer ekranlar

- **Danışan kartı:** iletişim, aydınlatma/açık rıza durumu (tarih + imzalı PDF), seans geçmişi,
  bakiye, ekli dosyalar, "danışan veri raporu dışa aktar" (KVKK md. 11).
- **Ay sonu özeti:** seans sayısı, tahsilat, borçlu danışanlar. Tek sayfa.
- **Hızlı arama (Ctrl+K):** danışan adı veya not içeriği. Kilitliyken sonuç dönmez.

### Telefon görünümü (kasten dar)

Bugünün programı, seansa hızlı not, danışanın son notunu okuma. Danışan ekleme/silme, dışa
aktarma ve ayar değiştirme telefonda **yoktur** — küçük ekranda yanlışlıkla yapılan geri
alınamaz işlemin riski, sağladığı kolaylıktan büyüktür.

## 7. Yedekleme ve saklama

- Günde bir kez otomatik şifreli yedek; hedef klasörü kullanıcı seçer (USB, Drive/Dropbox klasörü
  olabilir — dosya zaten şifreli olduğundan sağlayıcı içeriği okuyamaz).
- **Son 7 günün yedeği dönüşümlü tutulur.** Tek dosya olsaydı bozuk veritabanı yedeğin üzerine
  yazıldığında yedek de kaybolurdu.
- Uygulama içinden "geri yükle" ekranı; her yedeğin tarihi ve boyutu listelenir.
- Yedek alınamazsa (disk dolu, klasör erişilemez) ana ekranda kalıcı uyarı çıkar; sessiz geçilmez.
- **Saklama süresi:** son temas tarihine göre hesaplanır. Varsayılan 7 yıl, ayarlanabilir; çocuk
  danışanlar için "21 yaşına kadar" seçeneği. Türkiye'de bağlayıcı tek sayı yoktur (TPD etik
  yönetmeliği süre vermez; Sağlık Bakanlığı arşiv düzenlemesinde psikolojik görüşme kartı 5 yıl,
  APA 7 yıl önerir) — bu yüzden sabitlenmez.
- Süresi dolan dosyalar ana ekranda hatırlatma olarak listelenir. **Otomatik silme yoktur**;
  silme kararını her zaman insan verir.

## 8. Hata durumları

| Durum | Davranış |
|---|---|
| Parola yanlış | Artan gecikme; kalıcı kilit yok |
| Veritabanı bozuk | Açılışta bütünlük kontrolü; bozuksa geri yükleme ekranına düşer |
| Port dolu | Sıradaki boş porta geçer, telefon adresini günceller |
| Telefon bağlanamıyor | Ağ kontrolü + QR kod; IP elle yazdırılmaz |
| Aynı not iki cihazda açık | Not düzeyinde yumuşak kilit ve uyarı; sessiz üzerine yazma yok |
| Uygulama çökerse | Taslak zaten yazılmıştır; açılışta "yarım kalmış not" en üstte |
| Disk dolu | Yedek başarısız → ana ekranda kalıcı uyarı |

## 9. Test stratejisi

TDD ile ilerlenir; her katmanda önce test yazılır.

1. **Kripto ve veri katmanı (birim):** anahtar sarmalama, parola değişimi sonrası erişim,
   kurtarma kodu ile açma, yedek al → geri yükle turu, saklama tarihi hesabı. Bunlardaki hata
   doğrudan veri kaybı demektir; en yüksek öncelik.
2. **Erişim logu (entegrasyon):** her API çağrısının log ürettiği ve logun değiştirilemediği.
3. **Kritik akış (uçtan uca, Playwright):** giriş → randevu → not → otomatik kayıt → kilit →
   tekrar giriş → notun yerinde olması. Ayrıca telefon eşleştirme akışı.

## 10. KVKK notları (kullanıcıya iletilecek)

- Tek kişilik muayenehaneler, Kurul'un 04.09.2025 tarihli 2025/1572 sayılı kararı ile **VERBİS
  kaydından muaftır** (çalışan sayısı 10'un, bilanço 10 milyon TL'nin altında). Muafiyet, KVKK
  uyumundan muafiyet değildir.
- Danışandan **yazılı aydınlatma + açık rıza** alınmalıdır; uygulama bunu danışan kartında
  tarih ve imzalı PDF olarak takip eder.
- Danışan kendi verisini talep edebilir ve 30 gün içinde yanıtlanmalıdır (md. 11); "danışan veri
  raporu dışa aktar" bunu karşılar.
- Dışa aktarımlar her zaman parola korumalı üretilir (2018/10 kararı, taşınabilir ortama aktarım).

Bu doküman hukuki danışmanlık değildir; KVKK maddeleri tasarım gereksinimi çıkarmak için
özetlenmiştir.
