# İlk dalga kullanıcı deneyimi iyileştirmeleri — tasarım

**Tarih:** 2026-09-24
**Durum:** bölüm bölüm onaylandı; yazılı belge kullanıcı incelemesinde

## 1. Sorun

Uygulamanın temel parçaları yerinde (takvim, danışan dosyası, notlar), güvenlik
işleri de istendiği gibi arka planda. Günlük zahmet bu parçalar arasındaki küçük
boşluklardan geliyor. Kodla doğrulanmış bugünkü durum:

- Takvimde bugünün sütunu ayrışmıyor, şu anki saati gösteren bir işaret yok,
  bugüne dönmenin tek yolu "Önceki hafta"ya art arda basmak.
- Takvimin üstünde üç ayrı çubuk var ve temel yazı boyu 18 piksel
  (`web/src/index.css`); 1280×820 pencerede akşam saatleri görünür alanın
  altında kalıyor.
- Randevu panelindeki başlangıç zamanı değiştirilemiyor. Boş hücreler yalnızca
  tam saat verdiği için 10:30'da başlayan randevu kurulamıyor. Taşımanın tek
  yolu silip yeniden kurmak; silme notu, özel notu ve etiketleri de götürüyor.
  Sunucu taşımayı zaten destekliyor (`PUT /api/randevular/{id}`,
  `core/src/store/appointments.rs::guncelle` başlangıcı ve bitişi değiştirir).
- Süre alanı 15'er dakika adımlı (`RandevuPaneli.tsx`, `step={15}`), varsayılan
  60 dakika; 50 dakikalık seans için elverişsiz.
- Randevuya tıklayınca seans paneli takvimin ve ay özetinin altında açılıyor;
  sayfa panele kaymıyor. Randevu formundaki "Güncelle" seans panelini de
  kapatıyor.
- **Hata:** ücret alanı yazıyı İngilizce sayı gibi okuyor
  (`RandevuPaneli.tsx::tldenKurusa`, `Math.round(Number(tl) * 100)`).
  `1.250` hata vermeden 1,25 TL olarak kaydediliyor; `450,50` ise "sayısal
  değer olmalı" hatası veriyor.
- Terapist gelmeyen danışandan ücret alıyor, ama uygulama ödenmemiş bir
  "gelmedi" seansı borç saymıyor (`core/src/store/ozet.rs` modül başlığı:
  *"Gelmedi ücretlendirmesi psikoloğun politikasına bağlı bir ürün kararıdır"*).
  Bakiye ve ay sonu özeti alacağı eksik gösteriyor.
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
ulaş; danışanı açınca uzun geçmişini rahatça oku; para doğru sayılsın.**

Yeni büyük bir özellik yok: yeni sekme, yeni alt sistem, yeni sunucu ucu ya da
şema değişikliği yok. Hepsi var olan ekran ve akışların iyileştirilmesi.

## 3. Kullanıcı kararları

| Konu | Karar |
|---|---|
| Terapötik yaklaşım | Analitik (psikodinamik), BDT değil |
| Gelmeyen danışan | **Ücretlendirilir** → "gelmedi" borca girer |
| İptal | Söz edilmedi → iptal borca **girmez** (varsayım, belgede açık) |
| Randevuya tıklayınca imleç | **Hiçbir zaman** kendiliğinden nota gelmez; sayfa yalnızca kayar |
| Seans süresi | **Değişken** → 45 / 50 / 60 / 90 hazır düğmeleri; varsayılan 60 kalır |
| Borç kuralının yeri | Arayüzde tek işlev + sunucuda aynı kural, **ortak örnek dosyasıyla** bağlı |
| Sıra | Tek tasarım, iki plan: önce **A** (takvim ve randevu), sonra **B** (danışan dosyası) |
| Etiket fikirleri | Şimdilik ertelendi |

## 4. Plan A — Takvim ve randevu

### A1. Tek araç çubuğu
Takvimin üstündeki üç çubuk tek satıra iner:
`‹ 21–27 Eylül 2026 ›  Bugün` … sağda `Hızlı arama (⌘K)` ve `Ay sonu özeti`.

- Oklar ekran okuyucuya yine "Önceki hafta" / "Sonraki hafta" olarak okunur
  (erişilebilir ad korunur).
- Tarih aralığına tıklamak bir gün seçici açar; seçilen günün haftasına gidilir.
- "Bugün" düğmesi bu haftaya döndürür; zaten bu haftadayken soluk görünür ve
  basılınca hiçbir şey olmaz.

### A2. Bugün ve şimdi
- Bugünün sütunu hafifçe renklenir, sütun başlığındaki gün numarası dolgulu bir
  dairenin içinde durur.
- Bugünün sütununda, şu anki saatin hizasında ince bir yatay çizgi durur;
  dakikada bir ilerler. Görünen saat aralığının (08:00–21:00) dışındaysa ya da
  görünen hafta bu hafta değilse çizilmez.
- Araç çubuğunun altında sakin bir bilgi satırı:
  "Bugün 5 seans · sıradaki 14:00 Ayşe K." Yalnızca görünen hafta bu haftaysa
  çıkar. "Sıradaki", başlangıcı şu andan sonra olan ilk planlı seanstır; yoksa
  o kısım yazılmaz. Ada tıklamak o randevuyu seçer (randevuya tıklamakla aynı
  yol, A6).
- Boş bir saat hücresinin üzerine gelince soluk "+ 14:00" belirir.
- Hepsi ekrandaki hafta listesinden hesaplanır; sunucuya yeni istek gitmez.
- Saat, test edilebilir olsun diye enjekte edilebilir bir "şimdi" kaynağından
  okunur (`yerelGun.ts`'deki mevcut yerel gün yardımcılarının yanında).

### A3. Hafta tek parça sığar
- `index.css`'teki 18 piksel temel yazı boyu ve `max-width: 1024px`'te yazıyı
  birden küçülten kural kaldırılır. Temel yazı boyu tek değerde sabitlenir:
  **16 ya da 17 piksel**; seçim uygulamayı 1280×800'de ikisiyle de açıp
  küçük yazıların okunaklılığına bakılarak yapılır ve plan içinde kaydedilir.
- Saat satırlarının yüksekliği pencere yüksekliğinden türetilir (en az ~36
  piksel), böylece 08:00–21:00 kaydırmadan görünür.
- Pencere (`src-tauri/src/main.rs`, bugün `inner_size(1280.0, 820.0)`)
  yaklaşık **1200×760** açılır ve en fazla **1024×680**'e kadar küçültülebilir
  (`min_inner_size`).

### A4. Randevu formu: tarih, saat, süre, taşıma
- Değiştirilemeyen saat yazısının yerine **Tarih** (`type="date"`) ve
  **Başlangıç** (`type="time"`, 5 dakika adımlı) alanları gelir. Yeni
  randevuda tıklanan hücreyle dolu açılır; başlangıç 10:30 gibi tam olmayan
  bir saate çekilebilir.
- Süre alanı 5 dakika adımlı olur; yanında **45 / 50 / 60 / 90** düğmeleri.
  Varsayılan süre 60 dakika kalır.
- Formun üstünde okunur bir özet: "Perşembe, 24 Eylül · 14:00–14:50".
- Var olan bir randevuda tarih ya da saat değiştirilip "Güncelle"ye
  basılınca randevu **taşınır**: aynı `PUT /api/randevular/{id}` çağrısı,
  aynı kimlik. Not, özel not, etiketler ve ödeme işareti randevu kimliğine
  bağlı olduğu için onunla gider.
- Yeni saat için çakışma kontrolü (`cakismaKontrol`) kendiliğinden çalışır;
  kontrol taşınan randevunun kendisini çakışma saymamalıdır.
- Seri üyesinde sakin bir bilgi satırı: "Yalnızca bu randevu taşınır."
  Seri kimliği (`seri_id`) değişmez.
- Randevu başka bir haftaya taşındıysa takvim o haftaya geçer ve randevu
  seçili kalır.
- Tam saatte başlamayan randevuların bloğunda başlangıç saati de yazar
  ("10:50 Ayşe"). Izgara saatliktir (`HaftalikTakvim.tsx::hucreAnahtari`
  saate göre gruplar); böyle bir randevu başladığı saatin satırında durur.

### A5. Ücret alanı Türkçe yazımı doğru okur
Okuma kuralı `web/src/para.ts`'e, `tlMetni`'nin yanına taşınır (para
metinlerinin tek kaynağı zaten orası):

1. Baştaki/sondaki boşluklar, "TL" ve "₺" yok sayılır.
2. Boş alan → `null` ("ücret girilmedi"; 0 ile aynı şey değil).
3. **Virgül varsa:** virgülden sonrası kuruştur (1 ya da 2 rakam); virgülden
   önceki noktalar binlik ayırıcıdır. `1.250,50` → 125050, `450,5` → 45050.
4. **Virgül yoksa:** noktadan sonra tam 3 rakam gelen her grup binlik
   ayırıcıdır (`1.250` → 125000, `1.250.000` → 125000000); noktadan sonra 1 ya
   da 2 rakam geliyorsa kuruştur (`450.50` → 45050).
5. Bunların dışındaki her şey (harf, eksi işareti, 3+ haneli kuruş, birden
   fazla virgül, bozuk gruplama) hata: "Ücreti ör. 1.250 ya da 450,50
   biçiminde yazın."

- Alanın altında gri önizleme: "= 1.250,50 TL" (`tlMetni` ile).
- Var olan randevu açılınca alan `1.250,50` biçiminde dolar (bugün `450.5`).
- Kural: her geçerli kuruş değeri için "biçimle → oku" aynı değeri verir.
- **Geçmiş kayıtlar otomatik düzeltilmez.** Hangi 1,25 TL'nin aslında 1.250
  olduğunu uygulama bilemez; terapiste düzeltmeden sonra geçmiş ay
  özetlerine bir kez göz atması söylenir.

### A6. Randevuya tıklayınca
- Kullanıcı bir randevu seçtiğinde (takvimde tıklama ya da A2'deki "sıradaki"
  bağlantısı) sayfa yumuşakça seans paneline kayar; `prefers-reduced-motion`
  açıksa animasyonsuz. Sekmeye geri dönmek ya da liste tazelenmesi kaydırma
  **tetiklemez**.
- **İmleç kendiliğinden hiçbir alana gitmez** (kullanıcı kararı).
- Seans paneli DOM'da ay özetinin **önüne** alınır (takvim → seans paneli → ay
  özeti). "Takvim, ay özetinden önce gelir" sırası korunur.
- Randevu formundaki "Güncelle" artık seans panelini kapatmaz; yalnızca
  takvimi tazeler.
- Seans panelinin başlığına "Takvime dön" bağlantısı eklenir (sayfayı takvimin
  başına kaydırır).

### A7. Yeni notlar Serbest açılır
`core/src/store/notes.rs::VARSAYILAN_SABLON` `"dap"`'tan `"serbest"`'e çekilir.
Henüz notu olmayan bir seans başlıksız, boş bir sayfa olarak açılır. DAP ve
SOAP şablon listesinde seçilebilir kalır. Var olan notlara dokunulmaz; şema
değişmez (`CHECK` kümesi aynı).

### A8. Koyu mod: açık temaya sabitle
- `index.css`: `color-scheme: light`, `prefers-color-scheme: dark` bloğu
  kaldırılır.
- `src-tauri/src/main.rs`: pencere teması açık (`Theme::Light`), başlık
  çubuğu da açık kalır.
- Gerçek bir koyu tema kapsam dışı (§8).

## 5. Ortak kurallar

### 5.1 Borç kuralı
Bir seans **borca girer** ⇔ durumu **`geldi` ya da `gelmedi`** ∧ **ödenmemiş**
∧ **ücreti > 0**. `iptal` ve `planlandi` borca girmez. Ücreti girilmemiş
(`null`) seans borca girmez.

- **Seans sayısı** (ay özeti `seans_sayisi`, dosya başlığı, liste numaraları)
  yalnızca `geldi` sayar; bu değişmez.
- **Tahsilat** değişmez (ödendi işaretli bütün seanslar, durumdan bağımsız).
- Uygulandığı yerler:
  - Sunucu: `core/src/store/ozet.rs` — `bekleyen_kurus` ve `borclular`
    sorgularındaki `durum = 'geldi'` koşulu `durum IN ('geldi','gelmedi')`
    olur; iki sorgu aynı `ucret > 0` koşulunu kullanır.
  - Arayüz: yeni tek işlev `borcaGirerMi(randevu)`; `DosyaBilgileri.tsx`'teki
    bakiye (bugün `r.durum === 'geldi' && !r.odendi`) ve Plan B'deki başlık
    özeti bunu kullanır.
- **Ortak örnek dosyası** `core/src/store/borc_ornekleri.json`:
  `{durum, odendi, ucret, borca_girer}` satırları. Rust testi ve TS testi aynı
  dosyayı okur; en az bir alt sınır kadar örnek olmadıkça test kırmızıdır
  (`onizleme_ornekleri.json` ile aynı desen).
- Açıklama metinleri yeni kurala göre yeniden yazılır: `DosyaBilgileri.tsx`
  bakiye açıklaması ("Bakiye: ücreti girilmiş ve ödenmemiş, gelinen ya da
  gelinmeyen seanslar. İptal edilenler girmez.") ve `AyOzeti.tsx`'teki
  tahsilat/bekleyen kural cümlesi.
- **Geçmişe etkisi:** kural değişince ücreti girilmiş ve ödenmemiş eski
  "gelmedi" seansları borç olarak görünür. Ücret alınmamış olanlar için o
  seansın ücret alanını boşaltmak yeterlidir. Bu, terapiste açıkça söylenir.

### 5.2 Türkçe harf katlama
Danışan listesi araması (B1) sunucudaki hızlı aramayla **aynı** kuralı
kullanır: küçük harfe çevir, `ı/İ→i`, `ş→s`, `ğ→g`, `ü→u`, `ö→o`, `ç→c`
(`core/src/store/search.rs`, `SORGU_*` içindeki `replace` zinciri).

- Arayüzde tek bir `katla(metin)` işlevi.
- **Ortak örnek dosyası** `core/src/store/katlama_ornekleri.json`: `{girdi,
  katli}` satırları; Rust tarafında sunucunun kuralıyla, TS tarafında
  `katla` ile aynı sonucu verdiği test edilir. Alt sınır koruması aynı.

## 6. Plan B — Danışan listesi ve dosya

### B1. Danışan listesinde arama
- Listenin tepesinde "Danışan ara…" kutusu; yazdıkça ekrandaki liste §5.2
  kuralıyla süzülür. Sunucuya istek gitmez, denetim kaydına satır düşmez.
- Kutudayken ↑/↓ vurguyu taşır, Enter vurgulu danışanın dosyasını açar, Esc
  kutuyu temizler.
- Eşleşme yoksa "'Ayşe K.' adıyla yeni danışan ekle" kısayolu; ekleme
  formunu bu adla açar.
- Ekleme formu: açılınca imleç ad alanında, Enter kaydeder, Esc kapatır;
  kayıttan sonra yeni danışanın dosyası kendiliğinden açılır.
- Sol kolon ekran yüksekliğinde sabit durur ve kendi içinde kayar.
- İmleç arama kutusuna **kendiliğinden gitmez** (A6'daki kullanıcı
  kararıyla tutarlı).

### B2. Dosya başlığında özet satırı
Adın altında soluk, tek satır:
"14. seans · Mart 2026'dan beri · Son: 17 Eylül · Sıradaki: Perşembe 24 Eylül
14:00 · Ödenmemiş: 1.800,00 TL"

- **Seans numarası** = `geldi` seans sayısı. **"…'dan beri"** = ilk `geldi`
  seansın ayı. **Son** = en son `geldi` seans. **Sıradaki** = şu andan sonraki
  ilk `planlandi` seans. Olmayan parça yazılmaz.
- **Ödenmemiş** = `borcaGirerMi` ile süzülmüş seansların ücret toplamı;
  yalnızca > 0 ise görünür. Bilgiler'deki bakiyeyle aynı veriden ve aynı
  işlevle hesaplanır, iki sayı hiçbir zaman ayrışmaz.
- Tarihi geçmiş ama hâlâ `planlandi` seans varsa "(+2 işaretlenmemiş)".
- "Son", "Sıradaki" ve "İlk seans" bağlantıları listede o seansı seçer ve
  notunu açar.
- Uyarı rengi yok; onam, saklama süresi gibi bilgiler bu satıra girmez.
- Seans listesi yüklenmeden satır gösterilmez. Yeni istek yok; denetim
  kaydına satır düşmez.

### B3. Uzun geçmiş düzeni
- Listenin en üstünde katlı **"Yaklaşan (n)"** grubu. Seçili seans
  gelecekteyse ya da hiç geçmiş seans yoksa açık gelir.
- Gelecekteki satırlarda "Not yazılmamış" yazmaz (durum zaten "Planlandı").
- Ardından geçmiş seanslar **aylara göre** gruplanır: "Eylül 2026 · 4 seans".
  Ay başlıkları kaydırırken üstte kalır (`position: sticky`).
- `geldi` satırlarında küçük sıra numarası ("#14"), B2 ile aynı kural.
- Seans listesi kendi alanında kayar; sağdaki not hep görünür. Seçili satır
  görünür alana getirilir (takvimden ya da aramadan gelindiğinde de).
- Gruplama, var olan süzgeçlerden sonra yapılır.

### B4. Okunaklı eski notlar
- Not doluysa ve `guncelleme_zamani`'nın yerel günü bugünden önceyse editör
  **Oku** görünümünde açılır; boş not ya da bugün düzenlenmiş not **Yaz**'da.
- Okurken "Düzenle" düğmesi ya da metne çift tıklama yazmaya geçirir.
  "Önizle" düğmesinin adı "Oku" olur.
- Yazarken ve okurken aynı yazı boyu, aynı satır aralığı, aynı metin rengi ve
  satır başına en fazla ~70 karakter. Okurken başlıklar bölüm başı gibi
  ayrışır (biraz iri, üstte boşluk).
- Yazma alanı içerik büyüdükçe uzar (en az ~12 satır); ekranı aşarsa kendi
  içinde kayar ve biçim çubuğu üstte kalır.
- Kayıt davranışı (gecikmeli kayıt, taslak, yazma saati korumaları) değişmez.
- Takvimdeki dar "Önceki seans notları" listesi (`GecmisNotlar`) bugünkü
  sıkı görünümünü korur.

## 7. Doğrulama

- Her görev önce kırmızıya düşen testle başlar. Mutasyon denemesi sırası:
  **commit → mutasyon → kırmızıyı gör → `git checkout -- <dosya>` → yeşili
  doğrula.**
- **Ortak örnek dosyaları** (§5.1, §5.2): Rust ve TS testleri aynı dosyayı
  okur; en az örnek sayısı korunur.
- **Ücret okuma (A5):** tablo testi (§A5'teki bütün örnekler ve hata
  durumları) + çok sayıda kuruş değeri için "biçimle → oku = aynı değer".
- **Taşıma (A4):** sunucu testi — taşınan randevunun notu, özel notu,
  etiketleri ve ödeme işareti kimlikle birlikte kalır; çakışma kontrolü
  taşınan randevunun kendisini saymaz. Uçtan uca senaryo: 10:30'a randevu
  kur, not yaz, başka güne taşı, not hâlâ orada.
- **Borç kuralı (§5.1):** ay özeti testleri gelmedi+ödenmedi+ücretli seansı
  borç ve borçlu olarak sayar; iptal saymaz; seans sayısı değişmez.
- **Saate bağlı davranışlar** (A2 bugün/şimdi/sıradaki, B4 Oku/Yaz seçimi,
  B2 sıradaki): sabit, enjekte edilmiş saatle test edilir.
- **Varsayılan şablon (A7):** notu olmayan seans `serbest` döner; var olan
  notun şablonu değişmez.
- **Ekrana sığma (A3):** jsdom ölçemez. Uygulama tarayıcı panelinde
  1280×800'de açılıp ekran görüntüsüyle doğrulanır.
- **macOS'ta elle kontrol (kullanıcı):** tarih/saat seçicilerin WebKit'teki
  görünüşü, yapışkan ay başlıkları, yumuşak kaydırma, 16/17 piksel seçimi.

## 8. Değişmeyenler ve kapsam dışı

**Değişmeyenler:** veritabanı şeması; sunucu uçlarının listesi; `127.0.0.1`
kısıtı; SQLCipher ve anahtar sarmalama; özel notların ayrı tabloda kalması ve
hiçbir aramaya/rapora girmemesi; `audit_log`'un değişmezliği ve içine içerik
girmemesi (liste süzme ve özet satırı hiç satır üretmez; taşıma, var olan
"randevu düzenleme" satırını yazar); DAP/SOAP şablonları.

**Kapsam dışı (bilerek, sonraki dalgalar):** etiket iyileştirmeleri; takvim
bloklarında ve listede "eksik kalanlar" işaretleri; özel nota danışan
dosyasından erişim; kilit sonrası kaldığın yere dönme; gerçek koyu tema;
hazır süre dışındaki akıllı varsayılanlar (danışanın son ücreti/süresi);
"+1 gün / +1 hafta" düğmeleri.

## 9. Planın çözmesi gereken açık noktalar

- **Seri ve taşıma:** "bu ve sonraki seri üyelerini sil" gibi seri işlemleri
  başlangıç zamanına göre sıralıyorsa, başka haftaya taşınmış bir üyenin
  bu işlemlerdeki yeri kontrol edilmeli ve testle sabitlenmeli.
- **Çakışma kontrolünün güncellemede kendini dışlaması:** bugünkü
  `cakismaKontrol` yeni randevu için yazıldı; güncellemede taşınan kaydı
  hariç tuttuğu doğrulanmalı ya da sağlanmalı.
- **Bakiye verisinin kapsamı:** B2'deki "Ödenmemiş" ile Bilgiler'deki bakiye
  aynı randevu kümesinden hesaplanmalı (`useDanisanDosyasi`'nin bakiye için
  yüklediği pencere). Özet satırı farklı bir kümeden (ör. seans listesi)
  hesaplanırsa iki sayı ayrışabilir; plan tek bir kaynağı seçip testle
  sabitlemeli.
- **Plan 7'nin bayatlık korumaları:** taşıma, ödeme ve durum değişikliğinin
  karta ve dosyaya yayılması `yazmaSaati` / `randevularTazele` yolundan
  geçer; yeni akışlar bu yolu atlamamalı.
