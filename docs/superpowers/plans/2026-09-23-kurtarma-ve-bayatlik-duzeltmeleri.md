# Kurtarma ve bayatlık düzeltmeleri — uygulama planı

> **Ajan çalışanlar için:** GEREKLİ ALT BECERİ: Bu planı görev görev uygulamak
> için `superpowers:subagent-driven-development` kullanın. Adımlar onay kutusu
> (`- [ ]`) sözdizimiyle yazılmıştır.

**Amaç:** `master`'ın bütününe yapılan taze gözle denetimin bulduğu bir Critical
ve altı Important'ı kapatmak. Bunların hiçbiri "test yeşil ama korumuyor"
sınıfından değil; hepsi **parçaların birleştiği, hiç düşünülmemiş kavşaklar**.

**Kaynak:** 2026-09-23 tarihli bütünsel `master` denetimi (HEAD `f47a270`).
Tüm testler yeşilken bulundular: web 921, cargo 704, clippy temiz, e2e 28/28.

**Mimari:** Yeni özellik yok. Var olan iki mekanizmaya alıcı eklemek
(`yazmaSaati` tabanlı tek yazma yolu + yayılım), bir kapıyı doğru yere taşımak
(şema sürümü kontrolü geri yüklemede **yerleştirmeden önce**) ve bir zaman
ölçümünü uykuya dayanıklı hâle getirmek.

## Global kısıtlar

Her görevin gereksinimleri bunları da kapsar:

- Tüm kod, yorum ve arayüz metni **Türkçe**. Commit mesajları **ASCII**
  (başlık VE gövde), sonunda `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Sunucu yalnızca `127.0.0.1` dinler.
- `audit_log` silinemez. Not içeriği, not başlığı, şablon adı, dosya adı,
  arama terimi, etiket adı denetime girmez; `ayrinti` kapalı `Ayrinti`
  enum'undan. **Etkisiz işlem loglanmaz.**
- **Terapistin bakmadığı şey için silinemez `Goruntuleme` satırı düşmez.**
  Bu planda bayatlığı çözerken "her şeyi yeniden çek" YASAK; hangi isteğin
  hangi `LogHacmi` ile loglandığına bakıp **log yazmayan ya da birleşen**
  yolu seçin. Özellikle: `clients::getir` ve `clients::saklama_suresi_dolanlar`
  `HerCagri`'dir (her çağrı bir satır); `appointments::aralik_getir` ve
  `ozet::ay_ozeti` `OturumBasi(5 dk)`'dır.
- Özel notlar aramaya, danışan dosyasına, veri raporuna girmez; `ozelNotApi`
  izin listesi (`api.ts`, `useSeansNotlari.ts`, `SeansPaneli.tsx`) genişlemez.
- Yedek **çift** alınır (veri + anahtar); eksik çiftten geri yükleme reddedilir.
- Zaman duvar saati (16 karakter, zaman dilimi yok); para tam sayı kuruş;
  metin kırpmaları karakter tabanlı.
- Yeni npm paketi / Rust crate'i eklenmez.
- Windows'ta cargo: PowerShell'de
  `$env:PATH = "C:\StrawberryPerl\perl\bin;C:\Users\axres\AppData\Local\bin\NASM;" + $env:PATH`.
  `cargo test --workspace` öncesi `npm --prefix web run build` (`rust_embed`).
- **TS kontrolü için `npm --prefix web run build`**; `npx tsc --noEmit -p .`
  bu projede sessizce hiçbir şey kontrol etmiyor.

## Her görevin bitiş ölçütü

**commit → mutasyonu uygula → testin kırmızıya döndüğünü gör →
`git checkout -- <dosya>` → yeşili doğrula.** (`git checkout --` commit
edilmemiş işi de siler; bu projede beş kez saatler kaybedildi.)
`docs/test-yesil-ama-korumuyor.md`'u test yazmadan önce okuyun.

---

### Görev 1: Geri yükleme canlı veritabanını yok etmesin (CRITICAL)

**Dosyalar:**
- Değiştir: `core/src/backup.rs` (doğrulama ~359-430, başarıda `.onceki` silme ~468)
- Değiştir: `server/src/routes/restore.rs` (~265, ~279-286)
- Test: `core/src/backup.rs` `mod testler`, `server/tests/yedekleme_api.rs`

**Sorun:** `geri_yukle`'nin doğrulaması yedeğin **şema sürümünü okumuyor**
(yalnızca çiftin varlığı, keystore yapısı, `PRAGMA quick_check`). `SurumDusuk`
kapısı `migrate`'in içinde ve `migrate` **dosyalar yerine konduktan sonra**
çalışıyor; o noktada `veri.db.onceki` silinmiş oluyor.

**Senaryo:** Terapist yeni sürümle yedek almış, sonra eski kuruluma dönüyor
(ya da bilgisayar değişiyor). Yedeği seçiyor, parola doğru, `quick_check` "ok"
diyor → mevcut `veri.db` + `keystore.json` siliniyor → `migrate` `SurumDusuk`
ile patlıyor → 500. **O gün girilen, henüz yedeklenmemiş seans notları kalıcı
olarak yok olmuş** ve uygulama o veritabanını açamıyor.

**İki katmanlı düzeltme — ikisi de yapılacak:**

1. **Kapıyı öne al:** `geri_yukle`'nin doğrulama adımında (zaten AÇIK olan
   bağlantıda) `schema::okunan_surum` okunsun; `CURRENT_VERSION`'dan büyükse
   **yerleştirmeye hiç geçilmeden** ayrı bir hata dönsün — `BozukYedek`
   DEĞİL (modülün kendi ilkesi: "eksik ≠ bozuk ≠ yanlış anahtar"; kullanıcıya
   "yedeğiniz bozuk" demek onu sağlam yedeği silmeye iter). Yeni varyant
   örn. `YedekIleriSurumlu { yedek: i64, uygulama: i64 }`; arayüz mesajı
   "Bu yedek uygulamanın desteklediğinden yeni bir sürümle alınmış.
   Uygulamayı güncelleyin." gibi **yol gösteren** bir cümle olsun.
2. **Geri alınabilir yerleştirme:** `.db.onceki` / `.json.onceki` dosyaları
   `migrate` BAŞARILI olana kadar silinmesin; `migrate` herhangi bir nedenle
   patlarsa eski dosyalar geri konsun ve hata dönsün. Bu, `SurumDusuk` dışındaki
   nedenleri de (örn. `UcretKisitiIhlali` taşıyan eski bir yedek) kapsar.
   Sıralamayı `restore.rs`'te değil `core/src/backup.rs`'te kur ki geri alma
   dosya işlemleriyle aynı yerde yaşasın.

- [ ] **Adım 1: Önce KIRMIZI testi yaz** — `geri_yukle` + `migrate` zinciri,
  `user_version`'ı `CURRENT_VERSION + 1` yapılmış bir yedekle: (a) geri yükleme
  reddedilir, (b) **mevcut `veri.db` ve `keystore.json` DEĞİŞMEDEN durur**
  (içerik karşılaştırması — yalnızca "dosya var" değil), (c) hata `BozukYedek`
  değil yeni varyant. Ayrıca `migrate`'in başka bir nedenle patladığı durum için
  ikinci bir test (eski dosyaların geri konduğu).
- [ ] **Adım 2:** testlerin kırmızı olduğunu gör (`cargo test -p psikolog-core backup`).
- [ ] **Adım 3:** iki katmanı uygula.
- [ ] **Adım 4:** testlerin geçtiğini gör; `server/tests/yedekleme_api.rs`'e
  HTTP düzeyinde karşılığını ekle (400/409 + gövdede yol gösteren mesaj,
  hassas veri yok).
- [ ] **Adım 5: IMPORTANT-6 — "geri yükleme göçten geçer" testi.** Bugün hiçbir
  test eski şemalı bir yedeği geri yükleyip göçün koştuğunu doğrulamıyor
  (`restore.rs:279` silinse muhtemelen hiçbir test kırılmaz). **v4 şemalı**
  (bu dalda `CURRENT_VERSION` 5) dolu bir yedek kur (danışan + randevu + resmî
  not + özel not + ek), geri yükle, sonra: sürüm 5, veri birebir aynı, etiket
  tabloları mevcut. Mutasyon: `restore.rs`'teki `migrate` çağrısını kaldır →
  bu test kırmızı.
- [ ] **Adım 6: Mutasyon turu** — (1) sürüm kontrolünü kaldır → Adım 1 testi
  kırmızı; (2) `.onceki` geri alma dalını kaldır → geri alma testi kırmızı;
  (3) Adım 5'in mutasyonu.
- [ ] **Adım 7: Commit** — `git commit -m "Geri yukleme: ileri surumlu yedek yerlestirmeden once reddedilir, migrate patlarsa eski dosyalar geri konur"`

---

### Görev 2: Ay özeti ve danışan bakiyesi randevu yazmalarında tazelensin

**Dosyalar:**
- Değiştir: `web/src/screens/AnaEkran.tsx` (~343-355 ve ~426-452),
  `web/src/screens/anaEkranKancalari/useDanisanDosyasi.ts` (~202-212)
- Test: `web/src/screens/AnaEkran.yayilim.test.tsx`

**Sorun (IMPORTANT-1):** `setOzetTazeleme` yalnızca durum ve ödeme
yazmalarında artıyor. Randevu **oluşturma, güncelleme (ücret/danışan/saat),
silme, seri silme** özete hiç ulaşmıyor — oysa üçü de `AyOzeti`'nin saydığı
rakamları değiştiriyor ve özet aynı sekmede, aynı anda ekranda olabiliyor.
Senaryo: özet açık, *Bekleyen 450,00 TL*; terapist çift girilmiş bir seansı
siliyor; sunucuda borç 0, **ekranda hâlâ 450,00 TL** ve hiçbir istek atılmıyor.

**Sorun (IMPORTANT-2):** `dosya.randevuYamala` yalnızca `{durum, odendi}`
alıyor ve yalnızca durum/ödeme yazmalarından çağrılıyor. Kartın `randevular`
listesi (Bilgiler'deki **bakiyenin** kaynağı) randevu oluşturma/silme/ücret
değişiminden haberdar değil. Senaryo: dosya açık, *Bakiye 450,00 TL*; takvimde
ücret 450 → 900 düzeltiliyor; Danışanlar'a dönülüyor → **Bakiye hâlâ 450,00**,
ama AYNI dosyanın Seanslar listesi 900,00 gösteriyor — iki sayı çelişiyor.
Kendiliğinden de düzelmiyor: aynı danışanın çipine tekrar tıklamak
`dosya.ac(aynı id)` → React bail-out → istek yok.

**Kısıt (denetim maliyeti):** `AyOzeti` kapalıyken monte değil; açıkken
`ozet::ay_ozeti` `OturumBasi(5 dk)` — mevcut `durumDegis` deseniyle aynı,
ek maliyet yok. Kart için **tam kartı yeniden çekmeyin**: `clients::getir`
`HerCagri`'dir (her çağrı silinemez satır). Yalnızca `takvimApi.randevulariGetir`
(`appointments::aralik_getir`, `OturumBasi`) penceresini yeniden çekin ya da
yerel yamayı genişletin.

- [ ] **Adım 1: Önce KIRMIZI testler** — (a) özet açıkken randevu silme →
  bekleyen tutar güncellenir; (b) ücret güncelleme → özet ve kart bakiyesi
  ikisi de yeni değeri gösterir; (c) aynı dosyada Seanslar listesindeki tutar
  ile Bilgiler'deki bakiye **çelişmez**; (d) bu yollar `GET /api/danisanlar/{id}`
  (kart, `HerCagri`) isteği ATMAZ — istek yolu sayımıyla ölç.
- [ ] **Adım 2-4:** kırmızı gör, uygula, geçir.
- [ ] **Adım 5: Mutasyon turu** — özet tazelemesini kaldır → (a) kırmızı;
  kart yamasını kaldır → (b)(c) kırmızı; kart tam yeniden çekmeye çevir →
  (d) kırmızı.
- [ ] **Adım 6: Commit**

---

### Görev 3: "Saklama süresi doldu" işareti bayat kalmasın

**Dosyalar:**
- Değiştir: `core/src/store/appointments.rs` (~345-347, ~428-451),
  `server/src/routes/appointments.rs` (durum yanıtı),
  `web/src/api.ts`, `web/src/screens/AnaEkran.tsx`,
  `web/src/screens/anaEkranKancalari/useDanisanListesi.ts` (~72-80),
  `web/src/screens/anaEkranKancalari/useDanisanDosyasi.ts`
- Test: ilgili Rust ve web testleri

**Sorun:** Bir seans "geldi" işaretlenince sunucu `clients.son_temas` ve
`saklama_bitis`'i tazeliyor (+7 yıl). İstemcide bu iki alan hiçbir yere
yayılmıyor:
1. **Bilgiler → Saklama süresi** eski tarihi gösteriyor; süresi dolmuş bir
   danışan terapiye dönüp "Geldi" işaretlendiğinde sunucu 2031 derken ekran
   hâlâ "Saklama süresi doldu (10.01.2024)" amber kutusunu basıyor.
2. **Ayarlar → Saklama süresi dolan dosyalar** listesi `cekildiRef` ile oturum
   başına BİR KEZ çekiliyor; gerekçe yorumu "liste gün içinde değişmez" diyor
   ama `son_temasi_isaretle` yüzünden bu **yanlış**. Terapist danışanı listede
   görür, seansı "Geldi" işaretler, Ayarlar'a döner: **danışan hâlâ listede.**

Bu, insanın imha kararını besleyen tek ekran ("imha kararı her zaman sizindir").
Bayat bir "süresi doldu" işareti, saklanması gereken bir dosyanın elle
silinmesine yol açabilir.

**Kısıt:** `clients::saklama_suresi_dolanlar` `HerCagri`'dir — listeyi yeniden
çekmek her seferinde silinemez bir satır demek. **Yeniden çekmeyin**: durum
yazmasının yanıtına güncellenmiş `son_temas`/`saklama_bitis` ekleyin
(transaction zaten hesaplıyor) ve istemcide **yerel olarak** hem karta yamayın
hem danışanı `saklamaDolanlar`'dan düşürün.

- [ ] **Adım 1: Önce KIRMIZI testler** — Rust: durum yanıtı güncellenmiş iki
  alanı taşır (ve yalnızca "geldi" işaretlemesinde değişir). Web: süresi dolmuş
  danışanın seansı "Geldi" işaretlenince (a) Bilgiler'deki uyarı kalkar,
  (b) Ayarlar listesinden düşer, (c) `GET /api/saklama-suresi-dolanlar`
  **yeniden istenmez** (istek sayımı, eşitlik).
- [ ] **Adım 2-4:** kırmızı gör, uygula, geçir. `useDanisanListesi`'deki
  "liste gün içinde değişmez" yorumunu gerçeğe göre düzelt.
- [ ] **Adım 5: Mutasyon turu** — yayılımı kaldır → (a)(b) kırmızı; yerel
  düşürme yerine yeniden çekmeye çevir → (c) kırmızı.
- [ ] **Adım 6: Commit**

---

### Görev 4: Boşta kalma kilidi uykuyu saysın

**Dosyalar:**
- Değiştir: `core/src/session.rs` (~2, ~54), gerekirse `server/src/guard.rs` (~221)
- Test: `core/src/session.rs` `mod testler`

**Sorun:** Oturum ömrü tamamen `std::time::Instant` ile ölçülüyor. macOS'ta
`Instant` monotonik saat üzerine kurulu ve **sistem uykusunda ilerlemiyor**.
İstemci de karar vermiyor (`bostaKalma` yalnızca sunucuya soruyor).
**Senaryo:** terapist gün sonunda MacBook'un kapağını kapatır (ekranda bir
danışanın notu açık); ertesi sabah açar: 300 saniyelik pencere dolmamıştır,
sunucu "açık" der, bütün takvim, danışan adları ve açık not geri gelir.
Modülün kendi tehdit modeli ("danışan odadan çıkarken ekranda açık kalan notu
koruma altına alır") tam burada tutmuyor. Kod tabanında uyku/duvar saati
konusunda tek bir yorum bile yok — bilinçli bir takas değil, kör nokta.

**Düzeltme:** `Oturum.ac`/`dokun` monotonik damganın YANINDA bir duvar saati
damgası da tutsun; `acik_mi` **ikisinden biri** sınırı aşarsa kilitlesin.
Gerekçe yorumda: duvar saati tek başına saat değişimine (kullanıcı saati geri
alır) açık, monotonik tek başına uykuya; ikisinin birleşimi her iki saldırıyı
da kapatır. Duvar saati geriye giderse (negatif fark) bu bir uyarı işaretidir
ve **kilitlemek** güvenli taraftır.

- [ ] **Adım 1: Önce KIRMIZI test** — zaman kaynakları enjekte edilebilir olsun
  (şu an `Instant::now()` doğrudan çağrılıyorsa, test edilebilir bir saat
  soyutlaması ekleyin; mevcut `kilit_suresi_ayarla` kalıbına bakın). Testler:
  (a) monotonik ilerlemedi ama duvar saati 8 saat ilerledi → KİLİTLİ;
  (b) duvar saati geri gitti → KİLİTLİ; (c) ikisi de sınırın altında → açık;
  (d) mevcut davranış (monotonik sınırı aştı) → kilitli.
- [ ] **Adım 2-4:** kırmızı gör, uygula, geçir.
- [ ] **Adım 5: Mutasyon turu** — duvar saati kolunu kaldır → (a)(b) kırmızı.
- [ ] **Adım 6: Commit**

---

### Görev 5: Etiket arama sıralamasını test et

**Dosyalar:**
- Değiştir/Test: `core/src/store/search.rs` (~280-286, ~564)

**Sorun (IMPORTANT-5, mutasyonla kanıtlandı):** `ORDER BY kullanim DESC,
t.ad COLLATE NOCASE LIMIT ?2` sıralamasını hiçbir test korumuyor. Mutasyon
(`kullanim DESC` → `ASC` **ve** Rust sort'u ters çevir) → 44/44 YEŞİL kaldı.
Sebebi 8. biçim: etiket bütçesini ölçen tek kapsamlı test 60 etiketin her
birini tam bir seansa bağlıyor, yani hepsinin `kullanim`'ı 1 ve **birincil
sıralama anahtarı kurulumda görünmez**. `LIMIT` sorgunun içinde olduğu için
sıra, hangi etiketlerin hayatta kalacağını da belirliyor; danışan/not kipleri
için bunu engelleyen `siralama_hangi_satirlarin_hayatta_kalacagini_belirler`
testi üçüncü kipe yayılmamış.

- [ ] **Adım 1:** farklı `kullanim` sayılarıyla (3/2/1) kurulmuş sıralama testi;
  51+ etiketle "en çok kullanılan kesilmiyor" testi; eşitlikte Türk alfabesi
  iddiası.
- [ ] **Adım 2:** mutasyonu uygula (`DESC`→`ASC`), testlerin kırmızıya
  döndüğünü gör, geri al.
- [ ] **Adım 3: Commit**

---

### Görev 6: Küçük ama gerçek pürüzler

**Dosyalar:** aşağıda madde madde.

- [ ] **6a — Ctrl+K macOS'ta metin alanını bozmasın.**
  `web/src/arama/HizliArama.tsx:160-172` `document` seviyesinde koşulsuz
  `keydown` dinliyor, `preventDefault()` yapıp hızlı aramayı açıyor —
  `NotEditoru`'nun textarea'sı odaktayken de. Hedef platform macOS ve orada
  Ctrl+K metin alanlarında standart **"satır sonuna kadar sil"**. Gerekçe
  yorumu "tarayıcının adres çubuğu aramasını engelle" diyor ama üründe adres
  çubuğu yok (Tauri). Düzeltme: macOS'ta yalnızca `metaKey` (Cmd+K) kabul
  edilsin, ya da olayın hedefi bir metin alanıysa yutulmasın. `event.key`
  yerine `event.code` kullanın (aynı sınıf bulgu yüzünden `NotEditoru` zaten
  `event.code`'a geçti). Test: textarea odaktayken Ctrl+K arama AÇMAZ ve
  `defaultPrevented` false; Cmd+K açar.
- [ ] **6b — Kurtarma kodu alanı `type="password"` olsun ya da gerekçesi
  yazılsın.** `web/src/screens/KilitEkrani.tsx:36`,
  `web/src/screens/GeriYuklemeEkrani.tsx:283` `type="text"`. Kod tabanının
  kendi kuralı ters yönde ve testli (`AnaEkran.test.tsx:3270`: "parola
  alanlari `type=password`", gerekçe "ekran görünürken danışan odada
  olabilir"). Kurtarma kodu paroladan daha güçlü bir sır. Kâğıttan yazarken
  görmek isteniyorsa "Göster" düğmeli bir alan yapın; hangisini seçerseniz
  gerekçeyi yorumda yazın ve testle sabitleyin.
- [ ] **6c — Göç hatasında yön ver.** `server/src/routes/restore.rs:281-285`
  bütün `MigrateHatasi` varyantlarını tek "Veritabanı hazırlanamadı."
  metnine düzleştiriyor. Modülün kendi ilkesi "eksik ≠ bozuk ≠ yanlış anahtar".
  En azından `SurumDusuk` ayrı ve yol gösteren bir mesaj almalı (Görev 1
  bunu zaten yerleştirmeden önce yakalıyor; burası ikinci savunma hattı).
- [ ] **6d — İki sabit yalnızca yorumla eşleşiyor.**
  `HizliArama.tsx:98` `ASGARI_SORGU=2` ↔ `core/src/store/search.rs:210`;
  `web/src/bostaKalma.ts:8` `300_000` ↔ `core/src/session.rs:7` `300`.
  Depoda bu desenin emsali var (`server/src/routes/backup.rs`'in
  `src-tauri/src/main.rs`'i okuyan testi). Aynı kalıpta çapraz kontrol testi
  yazın; mutasyon: bir tarafı değiştir → test kırmızı.
- [ ] **6e — Boş not iki editörde aynı açılsın.** `web/src/seans/SeansPaneli.tsx:363`
  boş içeriği `sablonMetni(...)` ile açıyor, `web/src/danisan/DanisanDosyasi.tsx:291`
  ham (`''`) açıyor: aynı seans takvimde şablon başlıklarıyla, dosyada bomboş
  görünüyor. Veri kaybı yok (imza kontrolü iki yönde de yazma üretmiyor) ama
  "iki ekran aynı seansı aynı gösterir" kuralının dışında. Birini seçin,
  gerekçelendirin, testle sabitleyin.
- [ ] **Mutasyon turu ve commit** — her madde için ayrı commit; her birinde
  korumayı kıran mutasyon koşulsun.

---

## Son doğrulama (Görev 6'dan sonra)

`npm --prefix web run build` · `npm --prefix web run test` ·
`cargo test --workspace` · `cargo clippy --workspace --all-targets -- -D warnings` ·
`npx playwright test` — hepsi yeşil olmalı.

---

### Görev 7: Denetim kaydı okunabilir olsun

**Dosyalar:**
- Değiştir: `server/src/routes/` (yeni salt okunur uç), `server/src/lib.rs`,
  `web/src/api.ts`, `web/src/ayarlar/AyarlarSekmesi.tsx`
- Test: `server/tests/notlar_api.rs`, `web/src/ayarlar/AyarlarSekmesi.test.tsx`

**Sorun (denetim kaydı alt incelemesi, Important):** `audit::son_kayitlar`
(`core/src/store/audit.rs:416`) üretimde **hiçbir yerden** çağrılmıyor — ne
HTTP rotası, ne Tauri komutu, ne ekran; bütün çağrı yerleri `#[cfg(test)]`.
Modülün kendi ilkesi: *"denetlenebilir olmayan bir denetim kaydı, olmayan
denetim kaydıyla aynı şeydir"* (`audit.rs:36-37`). Hacim politikasının bütün
gerekçesi logun **okunabilirliği**, ama okuyan yok. KVKK 2018/10 açısından:
terapistten "şu tarihte bu dosyaya kim, hangi cihazdan erişti" istendiğinde
yanıt yalnızca SQLCipher veritabanını elle açarak verilebilir.

**Kapsam (küçük tutun):** Ayarlar sekmesinde salt okunur bir liste — tarih,
eylem, varlık türü, varlık kimliği, cihaz, (varsa) `ayrinti` metni. Süzgeç:
tarih aralığı ve varlık türü yeterli. **Yeni bir denetim satırı üretmeyin**:
denetim kaydını okumak bir `Goruntuleme` satırı yazmamalı (aksi hâlde log
kendini besler); bunu yorumda gerekçelendirin ve testle sabitleyin.
Liste sayfalanmalı (`son_kayitlar` zaten `LIMIT` alıyor); 10 yılda ~190k satır
bekleniyor, hepsini tek seferde çekmeyin.

- [ ] **Adım 1:** kilitli oturumda 401 (kapı ilk satır), `Sorgu<T>` ile
  süzgeç, rota modülü `audit::kaydet` çağırmaz; kilitli-401 tablosuna satır.
- [ ] **Adım 2:** Ayarlar'da liste; hassas veri yok (içerik/ad yok, yalnızca
  kimlik ve tür) — bunu testle sabitleyin.
- [ ] **Adım 3: Mutasyon** — ucu okurken `kaydet` çağıran bir mutasyon ekle →
  "denetim okumak log yazmaz" testi kırmızı.
- [ ] **Adım 4: Commit**

---

### Görev 6'ya ek maddeler (denetim kaydı alt incelemesinden)

- [ ] **6f — `saklama_suresi_dolanlar`'ın denetim satırı testsiz
  (MUTASYONLA KANITLANDI).** `core/src/store/clients.rs:688`. İki mutasyon da
  hayatta kaldı: (i) `HerCagri` → `OturumBasi`, (ii) `kaydet` çağrısını
  tamamen silmek — her ikisinde de `cargo test -p psikolog-core` 524/524 ve
  `cargo test -p psikolog-server` 179/179 yeşil. Bu, kod tabanındaki **tek
  testsiz audit yazma yolu**. Emsal test: `clients.rs::danisan_dosyasina_
  erisim_birlestirilmez`. Yazılacak test: satır yazıldığını VE aynı pencerede
  iki çağrının **iki** satır ürettiğini (birleşmediğini) iddia etsin.
- [ ] **6g — Yazılı değişmez koddan güçlü.** `audit.rs:64-66` ve
  `notes.rs:36-38` "not başına, **düzenleme oturumu başına** bir satır" diyor;
  mekanizma ise `OturumBasi(5 dk)`, yani 25 dakikalık bir yazım ~5 satır
  üretir. Metni gerçeğe göre düzeltin ("5 dakikalık pencere başına bir satır")
  — hacim yine kabul edilebilir, yanlış olan iddianın kendisi.
- [ ] **6h — `clients::getir` `HerCagri` iken kart kendi kendini tazeliyor.**
  `clients.rs:506-513` yazılı koşul: *"danışan dosyası ekranı kendi kendini
  yenileyen bir yola dönüşürse bu karar yeniden verilmeli."* O koşul
  gerçekleşti: `useDanisanDosyasi.ts:131` efektinin bağımlılığı `kartTazeleme`
  ve sayaç üç yerde artıyor (`rizaKaydet`, `ekYukle`, `ekSil`) — her biri
  kendi mutasyon satırının yanında ikinci bir `goruntuleme|client|<id>` satırı
  düşürüyor (günde ~3-6). Ya bu üç yolu birleştirmeye alın, ya da kararı
  yeniden verip yorumu gerçeğe göre güncelleyin. (`randevuYamala` bu yüzden
  bilerek tazeleme yapmıyor — aynı muhakeme buraya da uygulanabilir.)
