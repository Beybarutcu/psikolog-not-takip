# İlk dalga kullanıcı deneyimi iyileştirmeleri — tasarım

**Tarih:** 2026-09-24 (denetim sonrası düzeltme: 2026-09-25)
**Durum:** bölüm bölüm onaylandı; beş mercekli kod denetiminden geçti; yazılı
belge kullanıcı incelemesinde

## 1. Sorun

Uygulamanın temel parçaları yerinde (takvim, danışan dosyası, notlar), güvenlik
işleri de istendiği gibi arka planda. Günlük zahmet bu parçalar arasındaki küçük
boşluklardan geliyor. Kodla doğrulanmış bugünkü durum:

- Takvimde bugünün sütunu ayrışmıyor, şu anki saati gösteren bir işaret yok,
  bugüne dönmenin tek yolu "Önceki hafta"ya art arda basmak.
- Kabuk satırının altında iki ayrı çubuk var (Takvim sekmesinin araç satırı ve
  hafta gezinmesi) ve temel yazı boyu 18 piksel (`web/src/index.css`);
  1280×820 pencerede akşam saatleri görünür alanın altında kalıyor.
- Randevu formundaki başlangıç zamanı değiştirilemiyor. Boş hücreler yalnızca
  tam saat verdiği için 10:30'da başlayan randevu kurulamıyor. Taşımanın tek
  yolu silip yeniden kurmak; silme notu, özel notu ve etiketleri de götürüyor.
  Sunucu taşımayı zaten destekliyor (`PUT /api/randevular/{id}`,
  `core/src/store/appointments.rs::guncelle` başlangıcı ve bitişi değiştirir;
  not, özel not ve etiketler randevu kimliğine bağlı).
- Süre alanı 15'er dakika adımlı (`RandevuPaneli.tsx`, `step={15}`), varsayılan
  60 dakika; 50 dakikalık seans için elverişsiz.
- Randevuya tıklayınca seans paneli takvimin ve ay özetinin altında açılıyor;
  sayfa panele kaymıyor. Randevu formu takvimin yanında duruyor ve formdaki
  "Güncelle" (`useTakvimAkisi.ts::kaydet`, `panelKapat()`) seans panelini de
  kapatıyor.
- **Hata:** ücret alanı yazıyı İngilizce sayı gibi okuyor
  (`RandevuPaneli.tsx::tldenKurusa`, `Math.round(Number(tl) * 100)`, ve
  `kaydet()` içindeki `Number.isNaN(Number(...))` ön kontrolü). `1.250` hata
  vermeden 1,25 TL olarak kaydediliyor; `450,50` ise "sayısal değer olmalı"
  hatası veriyor.
- Terapist gelmeyen danışandan ücret alıyor, ama uygulama ödenmemiş bir
  "gelmedi" seansı borç saymıyor (`core/src/store/ozet.rs` modül başlığı:
  *"Gelmedi ücretlendirmesi psikoloğun politikasına bağlı bir ürün kararıdır"*;
  `DosyaBilgileri.tsx` bakiyesi `r.durum === 'geldi' && !r.odendi`). Bakiye ve
  ay sonu özeti alacağı eksik gösteriyor.
- Her yeni not DAP başlıklarıyla açılıyor (`core/src/store/notes.rs`,
  `VARSAYILAN_SABLON = "dap"`). Terapist analitik (psikodinamik) çalışıyor;
  süreç notu düz anlatı olarak yazılıyor ve bu başlıklar her seferinde siliniyor.
- Mac koyu moddayken kök zemin koyulaşıyor (`index.css`'teki
  `prefers-color-scheme: dark` bloğu) ama bileşenler koyu moda göre
  tasarlanmadığı için beyaz kalıyor ve metinler okunmaz hâle geliyor.
- Danışanlar sekmesinde arama kutusu yok; liste ile dosya birlikte kayıyor.
- Danışan dosyası yalnızca bir ad ve düz bir seans listesiyle açılıyor.
  Gelecekteki planlı randevular listenin en üstünü dolduruyor ve hepsinde
  "Not yazılmamış" yazıyor; ay ya da yıl ayrımı yok.
- Not editörü her açılışta "Yaz" kipinde başlıyor; eski bir notu okumak ham
  Markdown işaretleriyle küçük bir kutuda okumak demek.

## 2. Hedef

Bir cümlede: **uygulamayı açınca bugünü gör; randevuya tıklayınca hemen notuna
ve formuna ulaş; danışanı açınca uzun geçmişini rahatça oku; para doğru
sayılsın.**

Yeni büyük bir özellik yok: yeni sekme, yeni alt sistem, yeni sunucu ucu ya da
şema değişikliği yok. Hepsi var olan ekran ve akışların iyileştirilmesi.
Sunucu davranışı üç yerde değişir, üçü de var olan uçların içinde kalır: borç
kuralı (§5.1), yeni notun varsayılan şablonu (A7) ve taşınan "geldi" seansının
son temas tarihini güncellemesi (A4).

## 3. Kullanıcı kararları

| Konu | Karar |
|---|---|
| Terapötik yaklaşım | Analitik (psikodinamik), BDT değil |
| Gelmeyen danışan | **Ücretlendirilir** → "gelmedi" borca girer |
| İptal | Söz edilmedi → iptal borca **girmez** |
| Randevuya tıklayınca imleç | **Hiçbir zaman** kendiliğinden bir alana gitmez; sayfa yalnızca kayar |
| Seans süresi | **Değişken** → 45 / 50 / 60 / 90 hazır düğmeleri; varsayılan 60 kalır |
| Borç kuralının yeri | Arayüzde tek işlev + sunucuda aynı kural, **ortak örnek dosyasıyla** bağlı |
| Var olan randevunun formu | **Seans bölümünün başına** taşınır (not ile birlikte görünür); boş saatten açılan yeni randevu formu takvimin yanında kalır |
| İşaretlenmiş seansı taşıma | **Serbest**; "geldi" seans taşınınca son temas tarihi ve saklama süresi de güncellenir (yalnızca ileri) |
| Sıra | Tek tasarım, iki plan: önce **A** (takvim ve randevu), sonra **B** (danışan dosyası) |
| Etiket fikirleri | Şimdilik ertelendi |

## 4. Plan A — Takvim ve randevu

### A1. Tek araç çubuğu
Kabuk satırı (uygulama adı, sekmeler, `Kilitle`) **aynen kalır**. Altındaki iki
çubuk — `TakvimSekmesi`'nin araç satırı ve `HaftalikTakvim`'deki hafta
gezinmesi — tek satıra iner:
`‹ 21–27 Eylül 2026 ›  Bugün` … sağda `Hızlı arama (⌘K)` ve `Ay sonu özeti`.

- Oklar ekran okuyucuya yine "Önceki hafta" / "Sonraki hafta" olarak okunur.
- Hafta başlığı kararlı bir kanca taşır (sabit `id`); e2e seçicileri bu kancaya
  taşınır.
- Tarih aralığına tıklamak bir gün seçici açar; seçilen günün haftasına gidilir.
  Bunun için göreli `haftaDegis(±1)`'in yanına mutlak bir `haftayaGit(tarih)`
  eklenir.
- "Bugün" düğmesi `haftayaGit(bugün)` çağırır; zaten bu haftadayken soluk
  görünür.

### A2. Bugün ve şimdi
**Tek "şimdi" kaynağı.** `web/src/screens/anaEkranKancalari/yerelGun.ts`'e
yerel duvar saati dizgisini (`YYYY-AA-GGTSS:DD`) döndüren tek bir yardımcı
eklenir; takvimin açılış haftası, "Bugün", bu bölümdeki bütün hesaplar ve
`useDanisanSeanslari`'nin varsayılan `simdi`'si onu kullanır. Testler var olan
desenle (`vi.setSystemTime` + sahte zamanlayıcılar) yazılır; ikinci bir
enjeksiyon mekanizması eklenmez. "Geçmiş" her yerde aynı tanımdır:
`baslangic <= simdi` (bugünkü `seansSecimi.ts::varsayilanSeans` sınırı).

- Bugünün sütunu hafifçe renklenir; sütun başlığındaki gün numarası dolgulu bir
  dairenin içinde durur.
- Bugünün sütununda şu anki saatin hizasında ince bir çizgi. Görünen aralığın
  (08:00–21:00) dışındaysa ya da görünen hafta bu hafta değilse çizilmez.
- Araç çubuğunun altında bilgi satırı; yalnızca görünen hafta bu haftaysa:
  - **"Bugün N seans"** = bugünün yerel günündeki, durumu `iptal` OLMAYAN
    randevular. N = 0 ise "Bugün seans yok".
  - **"sıradaki HH:DD Ad"** = bugünün yerel gününde, `planlandi` ∧
    `baslangic > simdi` olan en erken randevu (eşitlikte küçük `id`). Şu anda
    süren seans "sıradaki" değildir. Yoksa bu parça yazılmaz. Ad
    `danisan_adi` olduğu gibi yazılır (kısaltma yok). Ada tıklamak o randevuyu
    seçer (A6'daki yol, kaydırma dahil).
- Çizgi, bilgi satırı ve bugün vurgusu **aynı dakikalık tikten** beslenir
  (`setInterval` 60 sn); testler `advanceTimersByTime(60_000)` ile ilerletir.
- Boş bir saat hücresinin üzerine gelince soluk "+ 14:00" belirir.
- Hepsi ekrandaki hafta listesinden hesaplanır; sunucuya yeni istek gitmez.

### A3. Hafta tek parça sığar
- `index.css`'teki 18 piksel temel yazı boyu ve `max-width: 1024px`'te yazıyı
  küçülten kural kaldırılır. Temel yazı boyu tek değerde sabitlenir: **16 ya da
  17 piksel**; seçim uygulamayı tarayıcı panelinde ikisiyle de açıp
  kaydedilir ve kullanıcı Mac'te son kararı verir.
- Saat satırı yüksekliği:
  `max(36px, (100dvh − ızgaranın üst kenarı − alt boşluk) / 13)`.
- Pencere (`src-tauri/src/main.rs`, bugün `inner_size(1280.0, 820.0)`)
  **1200×760** açılır, `min_inner_size(1024.0, 680.0)`.
- Boş saatten açılan yeni randevu formu takvimin yanında durur; pencere
  genişliği formu ve ızgarayı yan yana sığdırmıyorsa form ızgaranın altına
  iner (`flex-wrap`) — ne form ne ızgara sıkışır.
- **Kabul ölçütü:** 1200×760 ve 1280×800'de gün başlığı ile 20:00–21:00
  satırının alt kenarı sayfa kaydırılmadan görünür. 1024×680'de satırlar 36
  pikselde kalır ve sayfanın kayması kabul edilir. Ölçüm Playwright'ta
  `setViewportSize` + `boundingBox` ile otomatik yapılır.

### A4. Randevu formu: tarih, saat, süre, taşıma
- Değiştirilemeyen saat yazısının yerine **Tarih** (`type="date"`,
  `min="2000-01-01"`, `max="2099-12-31"` — danışan kartının randevu penceresiyle
  aynı) ve **Başlangıç** (`type="time"`, 5 dakika adımlı) alanları gelir. Yeni
  randevuda tıklanan hücreyle dolu açılır.
- Süre alanı 5 dakika adımlı; yanında **45 / 50 / 60 / 90** düğmeleri.
  Varsayılan 60 dakika.
- Formun üstünde okunur özet: "Perşembe, 24 Eylül · 14:00–14:50".
- Var olan randevuda tarih ya da saat değiştirilip "Güncelle"ye basılınca
  randevu **taşınır**: aynı `PUT /api/randevular/{id}`, aynı kimlik. Not, özel
  not, etiketler ve ödeme işareti onunla gider. Durum (geldi/gelmedi/iptal)
  korunur.
- **Taşınan "geldi" seansı:** `appointments::guncelle`, kayıt `geldi` ise aynı
  transaction'da var olan `son_temasi_isaretle`'yi çağırır. Bu işlev yalnızca
  ileri gider: seans ileri taşınırsa son temas ve saklama bitişi ilerler; geri
  taşınırsa gerilemez (saklama en kötü ihtimalle uzun kalır, asla kısa değil).
  PUT yanıtı `Randevu`'ya ek olarak isteğe bağlı `son_temas` ve
  `saklama_bitis` alanlarını taşır — ikisi birlikte ya var ya yok; danışan
  kimliği zaten `Randevu.client_id`'dedir (`DurumYaniti` emsali, Plan 7
  Görev 3). Arayüz bunları durum değişikliğiyle
  aynı yoldan yayar (dosya alanlarını yerel yama, saklama listesinden düşme).
  Son temas güncellemesi ayrı denetim satırı yazmaz (bugünkü durum
  değişikliğiyle aynı).
- **Çakışma kontrolü** güncellemede taşınan kaydı zaten dışlıyor (`haric_id`
  zinciri paneldan SQL'e kadar mevcut ve testli). Yeni mekanizma yok; yalnızca
  başlangıç form state'ine taşınırken çakışma efektinin bağımlılığında kalması
  ve `haricId`'nin geçmesi bir panel testiyle sabitlenir.
- **Seri üyeleri:** yalnızca bu randevu taşınır, `seri_id` değişmez; formda
  "Yalnızca bu randevu taşınır." bilgi satırı. Seri işlemleri ("bu ve sonraki
  seri randevularını sil", seri sayısı) **zamana göre** çalışır: kesme noktası
  tıklanan üyenin kaydedilmiş `baslangic`'idir, taşınmış bir üye yeni tarihine
  göre dahil ya da hariç kalır. Bu kabul edilir ve iki çekirdek testiyle
  sabitlenir (kesmenin sonrasına taşınmış üye silinir; öncesine taşınmış üye
  silinmez).
- Tam saatte başlamayan randevuların bloğunda başlangıç saati de yazar
  ("10:50 Ayşe Kaya"). Izgara saatliktir (`hucreAnahtari` saate göre gruplar);
  böyle bir randevu başladığı saatin satırında durur.

### A5. Ücret alanı Türkçe yazımı doğru okur
Tek bir `ucretOku(metin)` işlevi `web/src/para.ts`'e, `tlMetni`'nin yanına
konur; hem `tldenKurusa`'nın hem `kaydet()` içindeki ön kontrolün yerini alır.
Dönüşü: kuruş (`number`), `null` (girilmedi) ya da hata metni.

**Dilbilgisi.** Baştaki/sondaki boşluklar kırpılır. "TL", "tl" ya da "₺"
yalnızca başta ya da sonda, en fazla bir kez yer alabilir ve atılır. Kalan
metin şu üç kalıptan birine **tam** uymalıdır:

- **A)** `^\d{1,3}(\.\d{3})+(,\d{1,2})?$` — noktalar binlik, virgülden sonrası kuruş
- **B)** `^\d+(,\d{1,2})?$` — noktasız, isteğe bağlı virgüllü kuruş
- **C)** `^\d+\.\d{1,2}$` — nokta ondalık, 1–2 hane

Boş metin → `null`. Hiçbir kalıba uymayan metin → "Ücreti ör. 1.250 ya da
450,50 biçiminde yazın." Sonuç `AZAMI_UCRET`'i (`appointments.rs`, 100.000.000
kuruş = 1.000.000 TL) aşarsa → "Ücret en fazla 1.000.000 TL olabilir."

| Girdi | Sonuç (kuruş) |
|---|---|
| `1.250` | 125000 |
| `1250` | 125000 |
| `1.250,50` | 125050 |
| `450,5` | 45050 |
| `450.50` | 45050 |
| `1.25` | 125 |
| `0450` | 45000 |
| `0` / `0,00` | 0 |
| `1250 TL` / `₺1250` | 125000 |
| `1.000.000` | 100000000 |
| `1.000.000,01` | hata (üst sınır) |
| `1.250.50`, `1250.500`, `12.50,00`, `1.2345`, `.5`, `,5`, `5.`, `5,`, `4TL50`, `-5`, `abc` | hata |

- Alanın altında gri önizleme: "= 1.250,50 TL" (`tlMetni`).
- Var olan randevu açılınca alan `tlMetni`'nin " TL" eksiz biçimiyle dolar
  (`45000` → `450,00`; bugün `450.5`).
- **Özellik:** `0..=AZAMI_UCRET` aralığındaki her kuruş için "biçimle → oku =
  aynı değer"; sınır değerleri 0, 1, 99, 100, 100.000.000 dahil.
- **Geçmiş kayıtlar otomatik düzeltilmez.** Hangi 1,25 TL'nin aslında 1.250
  olduğunu uygulama bilemez; terapiste düzeltmeden sonra geçmiş ay
  özetlerine bir kez göz atması söylenir.

### A6. Randevuya tıklayınca
**Yerleşim (kullanıcı kararı).** Var olan bir randevu seçilince randevu formu
ile seans paneli takvimin altında **tek bir seans bölümü** olarak açılır. DOM
sırası: takvim → [randevu formu + seans paneli] → ay özeti. "Takvim, ay
özetinden önce gelir" sırası korunur. Bölümün içinde form solda dar bir
kolon, seans paneli sağda; pencere ikisini yan yana sığdırmıyorsa form üstte,
not altında (`flex-wrap`). Boş bir saate tıklayınca açılan yeni randevu formu
bugünkü gibi takvimin yanında durur (A3).

**Kaydırma.**
- Kullanıcı bir randevu seçtiğinde sayfa seans bölümünün başına kayar
  (`scrollIntoView({ block: 'start' })`); form ve not birlikte görünür.
- Kullanıcı seçimi sayılan yollar: ızgarada tıklama, A2'deki "sıradaki"
  bağlantısı, görünen aralık dışındaki randevular listesindeki düğmeler.
- Kaydırma isteği `useTakvimAkisi`'nde bir **kaydırma isteği** (randevu
  kimliği) olarak tutulur; hedef onu uyguladıktan sonra temizlenir. Sekmeye geri
  dönmek, bileşenin yeniden monte olması, liste tazelenmesi, hafta değişimi ve
  taşıma sonrası tazeleme kaydırma **tetiklemez**.
- Yumuşaklık CSS ile verilir:
  `@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth } }`
  (JS'te `matchMedia` gerekmez).
- **İmleç kendiliğinden hiçbir alana gitmez** (kullanıcı kararı).
- `test-kurulum.ts`'e `Element.prototype.scrollIntoView` casusu eklenir;
  testler "tıklamada 1 kez; sekme dönüşünde, Geldi/ödeme tazelemesinde ve
  taşıma sonrasında 0 kez" ölçer.

**"Güncelle" sonrası.**
- Seans bölümü açık kalır; form kaydedilen değerleri gösterir.
- `seciliRandevu` PUT yanıtındaki `Randevu` ile hemen yamalanır.
- Hafta değişmediyse görünen hafta yeniden yüklenir. Değiştiyse
  `haftayaGit(yeni başlangıç)` yapılır ve eski kapanıştaki `yukle()`
  **çağrılmaz**; yeni haftayı efekt yükler, seçim korunur.
- `yukle()`'ye **hafta koruması** eklenir: yanıt, istek anındaki hafta hâlâ
  görünen haftaysa yazılır. Bu, var olan hızlı hafta gezinmesi yarışını da
  kapatır.
- Aynı seansın başlangıcı değişince `useSeansNotlari` **özel notu ne yeniden
  ister ne sıfırlar**; aksi hâlde özel not sekmesi açıkken taşıma "Özel not
  yükleniyor…" yazısında takılı kalırdı. Geçmiş notlar (başlangıca göre
  "önceki seanslar") yeniden istenir; resmî not da aynı istekle bir kez daha
  okunur (not okuması `OturumBasi` ile birleşir, yeni denetim satırı düşmez;
  editör yeniden monte edilmez, yazılmamış metin korunur).
- Yeni randevu formundaki "Kaydet" bugünkü gibi formu kapatır.
- Seans bölümünün başlığında "Takvime dön" bağlantısı (sayfayı takvimin başına
  kaydırır). Bölümdeki "Kapat" seçimi kapatır (bugünkü `panelKapat`).

### A7. Yeni notlar Serbest açılır
`core/src/store/notes.rs::VARSAYILAN_SABLON` `"dap"`'tan `"serbest"`'e çekilir.
Henüz notu olmayan bir seans başlıksız, boş bir sayfa olarak açılır. DAP ve
SOAP seçilebilir kalır.

- Şemadaki sütun varsayılanına dokunulmaz (kod şablonu her zaman açıkça
  yazıyor; göç gerekmez).
- Var olan, içeriği boş DAP notları bugünkü gibi DAP başlıklarıyla açılmaya
  devam eder; bu kabul edilir.

### A8. Koyu mod: açık temaya sabitle
- `index.css`: `color-scheme: light`; `prefers-color-scheme: dark` bloğu
  kaldırılır.
- `src-tauri/src/main.rs`: `.theme(Some(Theme::Light))` (Tauri 2.11.5'te
  mevcut), başlık çubuğu da açık kalır.
- Gerçek bir koyu tema kapsam dışı (§8).

## 5. Ortak kurallar

### 5.1 Borç kuralı
Bir seans **borca girer** ⇔ durumu **`geldi` ya da `gelmedi`** ∧ **ödenmemiş**
∧ **ücreti > 0**. `iptal` ve `planlandi` borca girmez; ücreti `null` ya da `0`
olan seans borca girmez.

**Sayımların anlamı** (her biri ayrı tanımlıdır):

| Sayı | Tanım |
|---|---|
| Ay özeti `seans_sayisi` | yalnızca `geldi` (değişmez) |
| Ay özeti `tahsilat_kurus` | ödendi ∧ ücret girilmiş, durumdan bağımsız (değişmez) |
| Ay özeti `bekleyen_kurus` | borca giren seansların ücret toplamı |
| `borclular[].seans_sayisi` | o danışanın **borca giren** seans sayısı (`geldi` + `gelmedi`); arayüzde "(n ödenmemiş seans)" |
| Dosya başlığı seans numarası, liste `#n` (B2, B3) | yalnızca `geldi` |

**Uygulandığı yerler.**
- Sunucu `core/src/store/ozet.rs`: yalnızca `bekleyen_kurus` ifadesindeki ve
  `borclular` sorgusundaki `durum = 'geldi'` koşulu
  `durum IN ('geldi','gelmedi')` olur ve ikisi aynı `ucret > 0` koşulunu
  kullanır. `seans_sayisi` ifadesi aynen kalır.
- Arayüz: `borcaGirerMi(r: { durum, odendi, ucret })` ve
  `borcToplami(randevular)`. Bilgiler'deki bakiye ve B2'deki "Ödenmemiş" aynı
  `borcToplami(kart.randevular)` çağrısını kullanır. Seans listesi
  (`DanisanSeansi`, alanı `ucret_kurus`) borç hesabında kullanılmaz.

**Ortak örnek dosyası** `core/src/store/borc_ornekleri.json`:
`{durum, odendi, ucret, borca_girer}` satırları; ücreti `0` ve `null` olan
satırlar hem `geldi` hem `gelmedi` ile bulunur. Rust testi her satır için ayrı
bir danışan ve randevu kurup `ay_ozeti`'ni çağırır ve iki şeyi birlikte
doğrular: `borca_girer ⇔ danışan borçlular listesinde ∧ borc_kurus == ucret`, ve
`bekleyen_kurus == borca giren ücretlerin toplamı`. TS testi aynı dosyayı
`borcaGirerMi` ile okur. En az örnek sayısı korunur
(`onizleme_ornekleri.json` deseni).

**Güncellenecek testler, metinler ve yorumlar** (aynı görevde):
- `AnaEkran` testlerinde bakiyeyi düşürmek için "Gelmedi"yi tetikleyici olarak
  kullanan senaryolar "İptal"e çevrilir; "gelmedi borcu korur" ayrı bir testle
  ölçülür. Sahte sunucunun özet hesabı `borcaGirerMi`'ye bağlanır.
- e2e'deki gelmedi testi tersine çevrilir (gelmedi + ücretli + ödenmemiş →
  bekleyen ve borçlu satırı; iptal → 0). e2e'deki `KAPSAM_CUMLESI` kopyası
  `AyOzeti.tsx`'le birlikte değişir.
- `ozet.rs`'teki bağımsız hesap testinde küme ikiye bölünür (`geldi` → seans
  sayısı; `geldi|gelmedi` → bekleyen ve borçlular).
- Açıklama metinleri: `DosyaBilgileri.tsx` bakiye cümlesi ("Bakiye: ücreti
  girilmiş ve ödenmemiş, gelinen ya da gelinmeyen seanslar. İptal edilenler
  girmez."), `AyOzeti.tsx` kural cümlesi, ve `ozet.rs` / `DosyaBilgileri.tsx`
  modül başlıkları ile `api.ts`'teki ilgili yorum.
- Mutasyon denemeleri: "gelmedi'yi borçtan çıkar" en az bir arayüz testini
  kırar; "gelmedi yalnızca `bekleyen`e eklenir, `borclular`a eklenmez"
  `bekleyen == Σ borçlular` iddiasını kırar; "gelmedi `seans_sayisi`'na
  eklenir" seans sayısı testini kırar.

**Geçmişe etkisi.** Kural değişince ücreti girilmiş ve ödenmemiş eski "gelmedi"
seansları borç olarak görünür. Ücret alınmamış olanlar için o randevunun
ücretini **0** yapmak yeterlidir (0 = ücretsiz; boş = "girilmedi" ile aynı şey
değildir). Terapiste bu, düzeltmenin takvimdeki randevu formundan yapıldığı ve
gün seçicinin (A1) o haftaya gitmeyi kolaylaştırdığı bilgisiyle söylenir.

### 5.2 Türkçe harf katlama
Danışan listesi araması (B1) sunucudaki hızlı aramayla **aynı** kuralı
kullanır. Kural kod noktası başına bir eşlemedir:

- `ı`, `İ`, `I`, `i` → `i`; `ş`, `Ş` → `s`; `ğ`, `Ğ` → `g`; `ü`, `Ü` → `u`;
  `ö`, `Ö` → `o`; `ç`, `Ç` → `c`.
- Geri kalanlardan yalnızca ASCII `A`–`Z` küçültülür; diğer her karakter olduğu
  gibi kalır (`Â` → `Â`).
- `toLowerCase` / `toLocaleLowerCase` **kullanılmaz** (JS'te `'İ'.toLowerCase()`
  iki kod noktası üretir). Çıktının kod noktası sayısı girdiyle aynıdır.

Bu, `core/src/store/search.rs`'teki SQL `replace` zincirinin (SQLite `lower()`
yalnızca ASCII küçültür) ve oradaki Rust katlama işlevinin davranışıdır.

- Arayüzde tek bir `katla(metin)`; etiket anahtarı (`etiketAnahtari`) bununla
  **birleştirilmez** (etiket kimliği harf farklarını korur).
- **Ortak örnek dosyası** `core/src/store/katlama_ornekleri.json`: `{girdi,
  katli}`. Zorunlu örnekler: `İpek`→`ipek`, `IŞIK`→`isik`,
  `ŞAHİN ĞÜÖÇ`→`sahin guoc`, `Kâzım`→`kâzim`, `ÂDEM`→`Âdem`,
  `İstanbul`→`istanbul`. Rust testi her satırı `search.rs`'teki katlama
  işleviyle, TS testi `katla` ile doğrular; SQL zinciri ile Rust işlevinin
  eşitliği var olan `her_katlanan_harf_*` testlerine bırakılır.
- B1 eşleşmesi: `katla(ad).includes(katla(sorgu.trim()))`; boş sorgu herkesi
  gösterir; asgari uzunluk yok (istek gitmez).

## 6. Plan B — Danışan listesi ve dosya

### B1. Danışan listesinde arama
- Liste yalnızca **aktif** danışanları içerir (bugünkü gibi). Tepesinde
  "Danışan ara…" kutusu; yazdıkça ekrandaki liste §5.2 kuralıyla süzülür.
  Sunucuya istek gitmez, denetim kaydına satır düşmez.
- Kutudayken ↑/↓ vurguyu taşır, Enter vurgulu danışanın dosyasını açar, Esc
  kutuyu temizler.
- Eşleşme yoksa: "'Ayşe Kaya' adıyla yeni danışan ekle" kısayolu (ekleme
  formunu bu adla açar) ve altında sabit bilgi satırı: "Arşivlenmiş danışanlar
  bu listede aranmaz; ⌘K hızlı arama arşivi de tarar."
- Ekleme formu: açılınca imleç ad alanında (kullanıcının açtığı bir form),
  Enter kaydeder, Esc kapatır. `ekle()` POST yanıtındaki `Danisan`'ı döndürür
  ve dosya bu kimlikle açılır. Listenin yeniden çekilmesi ayrı bir `try`
  içindedir: çekme başarısız olsa bile başarılı ekleme "eklenemedi"
  göstermez.
- İmleç arama kutusuna **kendiliğinden gitmez** (A6'daki kullanıcı kararıyla
  tutarlı).
- Sol kolon `sticky top-0 max-h-[100dvh] overflow-y-auto` ile kendi içinde
  kayar.

### B2. Dosya başlığında özet satırı
Adın altında soluk, tek satır:
"14. seans · Mart 2026'dan beri · Son: 17 Eylül · Sıradaki: Perşembe 24 Eylül
14:00 · Ödenmemiş: 1.800,00 TL (+2 işaretlenmemiş)"

**Tek kaynak `kart.randevular`** (`useDanisanDosyasi`'nin 2000–2100
penceresinden gelen, takvimdeki her yazmadan sonra `randevularTazele` /
yamayla hemen tazelenen `Randevu[]`). Bütün parçalar bu diziden, A2'deki tek
"şimdi" ile hesaplanır:

| Parça | Tanım |
|---|---|
| "N. seans" | `geldi` sayısı |
| "…'dan beri" | ilk `geldi` seansın ayı; **bağlantıdır** ve o ilk seansı seçer ("ilk seans" bağlantısı budur) |
| "Son" | en son `geldi` seans (`baslangic <= simdi`); bağlantı |
| "Sıradaki" | `planlandi` ∧ `baslangic > simdi`, en erken; bağlantı |
| "(+N işaretlenmemiş)" | `planlandi` ∧ `bitis <= simdi` (bitmiş ama işaretlenmemiş; süren seans sayılmaz) |
| "Ödenmemiş" | `borcToplami(kart.randevular)`; yalnızca > 0 ise |

- Olmayan parça yazılmaz. Satır, kartın randevuları yüklenince görünür ve iki
  alt sekmede (Seanslar, Bilgiler) de görünür; "Ödenmemiş" Bilgiler'deki
  bakiyeyle aynı işlevden gelir, bir test iki sayının eşitliğini sabitler.
- Bağlantılar Seanslar alt sekmesine geçer ve o seansı seçer. Seans etiket
  süzgecinde gizliyse süzgeç "Tüm seanslar"a çekilir; katlı "Yaklaşan"
  grubundaysa grup açılır; satır görünür alana getirilir.
- Uyarı rengi yok; onam, saklama süresi gibi bilgiler bu satıra girmez. Yeni
  istek yok; denetim kaydına satır düşmez.

### B3. Uzun geçmiş düzeni
- **"Yaklaşan (n)"** = `baslangic > simdi` olan satırlar (durumdan bağımsız).
  Listenin en üstünde, varsayılan katlı. Açıklığı seçimden türetilir: seçili
  seans Yaklaşan'daysa grup zorla açıktır; kullanıcının kapatması yalnızca öyle
  değilken geçerlidir.
- Gelecekteki satırlarda "Not yazılmamış" yazmaz.
- Ardından geçmiş seanslar **aylara göre** gruplanır. Başlık: "Eylül 2026 ·
  4 seans", sayı o grupta **görünen** (süzgeç sonrası) `geldi` satırları;
  `geldi` yoksa yalnızca ay adı. Ay başlıkları liste kapsayıcısı içinde
  yapışkandır (`position: sticky`).
- `geldi` satırlarında sıra numarası ("#14"): `kart.randevular`'daki `geldi`
  seansların `baslangic ASC, id ASC` sırası; `appointment_id → n` haritası tek
  bir saf işlevde hesaplanıp listeye verilir. Süzgeç numarayı değiştirmez;
  haritada olmayan satırda numara gösterilmez.
- Seans listesi kendi alanında kayar; sağdaki not hep görünür. Seçili satır
  görünür alana getirilir (takvimden, aramadan ya da B2 bağlantısından
  gelindiğinde de).
- Gruplama var olan süzgeçlerden sonra yapılır.

### B4. Okunaklı eski notlar
**Kapsam:** resmî not editörü, hem takvimdeki seans bölümünde hem danışan
dosyasında. Özel not editörü her zaman **Yaz**'da açılır.

**Karar** `NotEditoru`'nun içinde, ilk durum başlatıcısında ve
`taslakAnahtari` değişince **bir kez** verilir (kayıttan sonra kip değişmez).
Gereken bilgi (sunucudaki ham içerik, `guncelleme_zamani`) prop olarak gelir.

**Oku** ⇔ geri yüklenmiş bir taslak yok ∧ sunucudaki içerik dolu (kırpılınca
boş değil ve yalnızca şablon başlıklarından ibaret değil) ∧
`yerelGun(new Date(guncelleme_zamani)) < bugün`. Aksi hâlde **Yaz**.
`guncelleme_zamani` UTC RFC3339'dur; `zamandanDate` ya da `slice(0, 10)`
kullanılmaz.

- Okurken "Düzenle" düğmesi ya da metne çift tıklama Yaz'a geçer ve metin
  alanına odak verir (imleç sonda) — kullanıcının açık eylemi olduğu için A6
  kararıyla çelişmez. "Önizle" düğmesinin adı "Oku" olur.
- Yazarken ve okurken aynı yazı boyu, aynı satır aralığı, aynı metin rengi,
  `max-width: 70ch`. Okurken başlıklar bölüm başı gibi ayrışır.
- Yazma alanı içerik büyüdükçe uzar (en az 12 satır); azami yüksekliği seans
  alt satırının (durum, ödeme) görünür kalmasını sağlar, aşınca kendi içinde
  kayar ve biçim çubuğu üstte kalır.
- `NotGorunumu`'na yoğunluk seçeneği ("okuma" / "sıkı"); takvimdeki
  "Önceki seans notları" (`GecmisNotlar`) "sıkı"da kalır.
- Kayıt davranışı (gecikmeli kayıt, taslak, yazma saati korumaları) değişmez.

## 7. Doğrulama

- Her görev önce kırmızıya düşen testle başlar. Mutasyon denemesi sırası:
  **commit → mutasyon → kırmızıyı gör → `git checkout -- <dosya>` → yeşili
  doğrula.**
- **Ortak örnek dosyaları** (§5.1, §5.2): Rust ve TS testleri aynı dosyayı
  okur; en az örnek sayısı korunur.
- **Ücret (A5):** §A5 tablosunun tamamı + aralık özelliği; `RandevuPaneli` ve
  e2e'deki eski biçimli ücret testleri yeni kurala göre güncellenir.
- **Taşıma (A4, A6):** çekirdek — taşınan randevunun notu, özel notu,
  etiketleri, ödeme işareti ve durumu kalır; "geldi" seans ileri taşınınca son
  temas ilerler, geri taşınınca gerilemez; seri kesmesi iki testle. Arayüz —
  başka haftaya taşıyınca hafta değişir, seçim ve seans bölümü açık kalır;
  geç dönen eski hafta yanıtı ızgarayı ezmez; özel not sekmesi açıkken taşıma
  özel notu görünür bırakır ve `/ozel-not` yeniden istenmez; tarih/saat
  değişince çakışma kontrolü yeni aralık ve `randevu.id` ile çağrılır. Uçtan
  uca — 10:30'a randevu kur, not yaz, başka güne taşı, not hâlâ orada.
- **Kaydırma (A6):** `scrollIntoView` casusu ile sayım.
- **Borç kuralı (§5.1):** yukarıdaki güncellenecek testler ve mutasyonlar.
- **Saate bağlı davranışlar** (A2, B2, B3, B4): `vi.setSystemTime` ile sabit
  saat; A2'nin dakikalık tiki; B4 için İstanbul saatiyle 00:00–03:00 sınırı
  (yerel 01:30'da düzenlenmiş not aynı gün Yaz'da, ertesi gün Oku'da).
- **B4:** canlı taslakla açılan dünkü not Yaz'da; yalnızca başlıklardan oluşan
  not Yaz'da; özel not her zaman Yaz'da; "Önizle" adını kullanan sorgular
  güncellenir.
- **Varsayılan şablon (A7):** notu olmayan seans `serbest` döner; editör boş
  açılır ve seçicide "Serbest" seçilidir; var olan notun şablonu değişmez.
  `"dap"` varsayan testler ve sahte sunucu güncellenir.
- **A1:** e2e seçicileri hafta başlığı kancasına taşınır; hafta gezinmesi
  testleri yeni yerine taşınır.
- **Ekrana sığma (A3):** Playwright ölçümü (§A3 kabul ölçütü).
- **Görsel kontrol (tarayıcı paneli, ekran görüntüsü):** A1–A3, A6 yerleşimi,
  B1 sol kolon, B3 yapışkan ay başlıkları, B4 okuma görünümü.
- **macOS'ta elle kontrol (kullanıcı):** tarih/saat seçicilerin WebKit'teki
  görünüşü, yapışkan ay başlıkları, yumuşak kaydırma, 16/17 piksel seçimi.

## 8. Değişmeyenler ve kapsam dışı

**Değişmeyenler:** veritabanı şeması; sunucu uçlarının listesi (PUT yanıtına
isteğe bağlı iki alan — `son_temas`, `saklama_bitis` — eklenir; danışan
kimliği zaten `Randevu.client_id`'de, bkz. A4; uç aynı); `127.0.0.1`
kısıtı; SQLCipher ve anahtar sarmalama; özel notların ayrı tabloda kalması
ve hiçbir aramaya/rapora girmemesi; `audit_log`'un değişmezliği ve içine içerik girmemesi (liste süzme,
özet satırı ve Oku/Yaz hiç satır üretmez; taşıma var olan "randevu düzenleme"
satırını yazar, son temas güncellemesi ek satır yazmaz); DAP/SOAP şablonları.

**Kapsam dışı (bilerek, sonraki dalgalar):** etiket iyileştirmeleri; takvim
bloklarında ve listede "eksik kalanlar" işaretleri; özel nota danışan
dosyasından erişim; kilit sonrası kaldığın yere dönme; gerçek koyu tema;
hazır süre dışındaki akıllı varsayılanlar (danışanın son ücreti/süresi);
"+1 gün / +1 hafta" düğmeleri; seans durumunu "Planlandı"ya geri alma;
arşivdeki danışanı liste aramasında bulma.
