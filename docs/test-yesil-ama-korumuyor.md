# "Test yeşil ama hiçbir şey korumuyor" — on üç biçim

Bu belge, Plan 1–3 boyunca yapılan bağımsız incelemelerde **fiilen bulunmuş** hata
biçimlerini toplar. Her biri gerçek bir vakadan çıktı; hiçbiri kuramsal değil.

Ortak nokta şu: bu testlerin hepsi yeşildi, bir kapsam raporunda hepsi "test var"
diye görünüyordu, ve hiçbiri korumayı iddia ettiği şeyi korumuyordu.

**Nasıl kullanılır:** yeni bir koruma testi yazarken listeyi gözden geçir ve sor —
"koruduğunu söylediğim şey bozulunca bu test gerçekten kırılır mı?" Emin değilsen
**mutasyonla dene**: korumayı geçici olarak kaldır, testin kırıldığını gör, geri al.

> **Windows tuzağı:** `Copy-Item` dosyanın değişiklik zamanını korur. Mutasyonu
> "yedekten geri kopyalayarak" geri alırsan cargo crate'i taze sayıp **mutasyonlu**
> derlemeyi kullanabilir. Geri aldıktan sonra `Compiling` satırını gördüğünü
> doğrula, yoksa "mutasyon yakalanmadı" sonucu sahtedir. (Bu tuzak bu projede bir
> kez sahte "geçti" üretti.)

---

## 1. Totolojik assertion

İddia, ölçtüğü şeyden bağımsız olarak her zaman doğru.

*Vaka:* `json.get("danisanlar")` bir **dizi** üzerinde her zaman `None` döner —
test "danışan verisi sızmıyor" diyordu, hiçbir şey ölçmüyordu.

*Vaka:* ölçüm testinde `assert_eq!(taze_yazilan, YAZMA)` — sayaç `for i in 0..30`
içinde koşulsuz artıyordu.

## 2. Koruma kaldırılınca yine geçen test

*Vaka:* depo fonksiyonlarındaki transaction kaldırıldı, atomiklik testleri yeşil
kaldı. Düzeltme sonrası aynı mutasyon üç testi kırıyor.

*Vaka:* `mime_dogrula`'nın uzunluk ve denetim karakteri blokları **tamamen
silindi**, 39/39 yeşil kaldı. O denetim karakteri kontrolü `Content-Type`
başlığına CRLF enjeksiyonunu engelleyen tek şeydi.

## 3. Ortama bağlı etkisizleşen test

Test, çalıştığı ortamın rastlantısal bir özelliği yüzünden hiçbir şey ölçmüyor.

*Vaka:* zaman dilimi koruması, makine zaten UTC'deyse gerilemeyi yakalayamıyordu —
ve CI runner'ları tipik olarak UTC. Test yeşil, koruma yok. Düzeltme: `vite.config.ts`
`test.env`'de TZ `Europe/Istanbul`'a sabitlendi. Bozuk varyant TZ sabitken 3 test
patlatıyor, `TZ=UTC` iken 12 test de **sessizce** yeşil geçiyor.

## 4. Hep temiz mount yapan bileşen testleri

`render()` ile başlayan her test, kullanıcının **asla yaşamadığı** bir başlangıç
durumunu test eder. Prop değişimi hiç ölçülmez.

*Vaka (Critical):* panele `key` verilmemişti. Panel açıkken başka bir randevuya
tıklanınca iç durum eskisinden kalıyordu — silme onayı **açık** geliyor ve "Evet,
sil" **yanlış kaydı** siliyordu. 8 testin hepsi her seferinde temiz mount yapıyordu.

*Karşı ilaç:* `rerender` kullan; geçişleri test et, başlangıç durumlarını değil.

## 5. Kiplerin kesişimini kimsenin test etmemesi

Her test bir kipi ölçüyor; kiplerin **kesiştiği** yer ölçülmüyor.

*Vaka (Critical):* mevcut bir randevuda "Kaydet" güncellemek yerine **kopya
oluşturuyordu**. 8 panel testinin hepsi ya "yeni kayıt" kipini ya "düzenleme"
kipini test ediyordu; ikisinin kesiştiği düğmeyi hiçbiri test etmiyordu.

## 6. İşlem öncesi durumla tatmin olan assertion

İddia, işlem **tamamlanmadan** doğru olduğu için anında geçiyor.

*Vaka:* `await expect(bloklar).toHaveCount(1)` — "kopya oluşmadı" iddiası.
`toHaveCount` koşul sağlanana kadar *bekler*, ama tıklama anında sayı zaten 1
olduğu için sunucu cevabı dönmeden tatmin oluyordu. Mutasyonla kanıtlandı: POST
regresyonunda o satır **geçiyor**, yalnızca alttaki ücret assertion'ı patlıyor.

*Karşı ilaç:* her "değişmemeli" iddiasını bir **senkronizasyon bariyerinin
arkasına** al.

## 7. Mutasyon kapsamının tek yönlü olması

Koruma yalnızca bir yönde sınanıyor.

*Vaka:* denetim kaydı birleştirme penceresi `0` yapılınca (log çoğalır) 7 test
kırılıyordu. Pencere **bir yıla** çıkarılınca (log susar) **tek test bile
kırılmadı**. Bir terapist bir yıl boyunca her gün not düzenlese denetim kaydında
tek satır kalırdı.

*Vaka:* "aşırı sıkı ama inandırıcı" bir tarih doğrulayıcı mutasyonu (12 saatlik
kadran + ayın 28'inden sonrası yok) **tüm eksi yön testlerini geçti**; onu yalnızca
artı yön testleri yakaladı.

*Karşı ilaç:* "çok az" kadar "çok fazla" da bir hata modudur. Bir doğrulayıcı için
hem "geçersizi reddediyor" hem "geçerliyi kabul ediyor" testi yaz — yoksa **her
şeyi reddeden** bir uygulama da testi geçer. Bir arama için hem "bulmaması
gerekeni bulmuyor" hem "bulması gerekeni buluyor" — yoksa **hiçbir şey
döndürmeyen** bir arama tüm koruma testlerini geçer.

## 8. Test kurulumunun birincil sıralama anahtarını görünmez kılması

*Vaka:* `ORDER BY eklenme_zamani DESC, id DESC` → `ASC, id DESC` yapılınca 39/39
yeşil kaldı. Test iki kaydı **aynı saniyede** ekliyordu, zaman damgaları eşitti,
dolayısıyla fiilen yalnızca `id DESC` ölçülüyordu. Mutasyon altındaki gerçek
sonuç: danışan dosyasında 2019 onam formu bugünkü mahkeme raporunun üstünde.

*Not:* aynı testin emsali (`notes.rs`) **farklı tarihlerle** kuruluyordu ve orada
anahtar gerçekten sınanıyordu. Şablon kopyalanmış, kurulumu anlamlı kılan kısım
kopyalanmamıştı.

## 9. Yapısal iddianın, kısıtladığı yapının **dışındaki** metinle tatmin edilmesi

*Vaka:* "her veri handler'ı `acik_baglanti`'den geçer" testi ham kaynakta token
sayıyordu. Bir handler kapısız bırakıldı **ve** başka bir handler'ın üstüne
`/// Ornek: let conn = acik_baglanti(&s)?;` **doküman satırı** eklendi → test geçti.

*Akraba biçim:* iki karşıt kusur birbirini götürüyor. Bir handler kapıyı atlar,
başkası iki kez çağırırsa toplam sayı tutar ve test geçer.

*Karşı ilaç:* yorumları ele; kaynağı birim birim parçala ve **her parçanın** ayrı
ayrı kuralı sağladığını iddia et. Sayı karşılaştırması yerine **bire bir eşleme**.

## 10. Gerekçe yorumunun testin yerine geçmesi

Bir karar ayrıntılı bir yorumla belgelenmiş — yorum önlediği hatayı **isim isim**
tarif ediyor — ve sıfır testle korunuyor.

*Vaka:* editörün "değişti mi" imzası bilerek şablonu içeriyordu; üstündeki yorum
tam olarak şunu yazıyordu: şablon değişip içerik değişmezse kayıt hiç tetiklenmez.
Mutasyon (imzadan şablonu çıkar) 32/32 yeşil bıraktı. Gerçek sonuç: ekranda SOAP,
veritabanında `dap`.

*En ince hâli — gerekçe yalnızca test edilmemiş değil, **yanlış**:* bir tarih
farkı fonksiyonundaki `Date.UTC` kullanımı "yaz saati kaymasına karşı koruma" diye
belgelenmişti. Fonksiyon `Math.round((b-a)/86400000)` kullanıyor; ±1 saatlik kayma
±0,042 gün eder ve `Math.round` bunu **her durumda** emiyor. Altı saat diliminde,
yaz saati sınırlarını kapsayan altı tarih çiftiyle ölçüldü: **sıfır fark**.
Mutasyonun kaçması test ortamından değil, **korunacak bir hata olmamasından**.

*Karşı ilaç:* **yorum bir koruma değildir.** Yazdığın her gerekçe yorumu için sor:
"bunun tarif ettiği hata testle yakalanıyor mu?" Yakalanamıyorsa (bazen gerçekten
yakalanamaz) yorumun bunu **açıkça söylemesi** gerekir — koruma ima etmemeli.

## 11. Üretimde ulaşılamayan bir durumun test edilmesi

Testin kurduğu geçişi çağıran taraf **hiç üretemez**.

*Vaka:* bir panelin `key` prop'ları, aynı örneği farklı bir kimlikle `rerender`
ederek ölçülüyordu. Üretimde imkânsız: bir üst bileşen paneli zaten kimliğe göre
`key`liyor, dolayısıyla o örneğin kimliği ömrü boyunca sabit. Mutasyon kırmızı,
test dürüst — ama ölçtüğü savunma hattına **çağrı zinciri hiç girmiyor**. Gerçekten
yük taşıyan `key` ise hiçbir testle ölçülmüyordu.

*Dördüncü biçimin aynadaki hâli:* #4 test başlangıç durumundan hiç çıkmaz,
#11 test uygulamanın giremeyeceği bir duruma girer.

*Karşı ilaç:* derinlemesine savunma meşrudur; yanlış olan **yedek hattın
birincilmiş gibi sunulması ve birincil hattın ölçülmemesi**. Hangi hattın yük
taşıdığını yaz ve **onu** ölç.

## 12. Yapısal iddianın dosya kümesinin, ihlalin gerçekleşebileceği kavşağı dışarıda bırakması

*Vaka (Critical):* özel notun KVKK veri raporuna girmediğini doğrulayan kaynak
taraması üç dosyayı kapsıyordu — ve o üç dosya `ozelNotApi`'yi **zaten hiç içe
aktarmıyordu, aktarmaya ihtiyaçları da yoktu**. Onu içe aktaran ve raporun not
kaynağını seçen **tek dosya** taranmıyordu. Mutasyon (rapora özel not ekle):
313/313 yeşil, `tsc` ve `vite build` de geçiyor.

*Aynı biçimin katman ekseninde tekrarı:* "çağrı yeri olmayan çekirdek fonksiyon"
taraması **çekirdek→HTTP** yönünde eksiksiz yapıldı ve sınıf kapalı ilan edildi;
**HTTP→arayüz** yönü hiç taranmadı ve üç uç nokta orada açıkta kaldı. *Taramanın
varlığı, sınıfın kapalı olduğu izlenimini üretti.*

*Karşı ilaç:* taramayı "ilgili görünen dosyalar" üzerinden değil, **"ihlalin
gerçekleşebileceği kavşak"** üzerinden tanımla. Ve dosya kümesini elle yazma —
**dizinden türet**, ki yarın eklenecek dosya hiçbir şey yapılmadan kapsansın.

## 13. Koşullu kararın tetikleyicisinin yalnızca yorumda yaşaması

Onuncu biçim geçmiş zamanlı (yorum, kodun bugün önlediği bir hatayı tarif eder).
Bu **gelecek** zamanlı: yorum *"şu koşul olursa bu kararı yeniden ver"* der.
Koşul kodda gözlenebilir bir olaydır ama hiçbir test, tip ya da lint onu izlemez —
koşul sessizce gerçekleşir ve karar, artık geçerli olmayan bir gerekçeyle
yürürlükte kalır.

*Vaka:* bağlantı ömrü kararı *"ekli dosyalar (20 MB'a kadar BLOB) yazma yoluna
girerse yeniden gözden geçir"* diye şartlandırıldı. Ekler iki görev sonra tam o
yola girdi. Ölçüm tekrarlanmadı, kimse fark etmedi — çünkü tetikleyicinin kendisi
bir koruma değil, bir **cümleydi**.

*Karşı ilaç:* koşullu bir karar yazdığında **koşulun kendisini de çalıştırılabilir
yap** — tetikleyici gerçekleştiğinde kırılan bir test. (Bu projede:
`ekler_yazma_yolundaysa_olcum_blob_senaryosunu_da_icermeli`.)

---

## Özet — test yazarken sorulacak dört soru

1. **Koruduğunu söylediğim şey bozulunca bu test kırılır mı?** Emin değilsen
   mutasyonla dene.
2. **İki yönü de sınadım mı?** "Çok az" kadar "çok fazla" da bir hata modu.
3. **Testin girdiği duruma uygulama gerçekten girebiliyor mu?** Ve ihlalin
   gerçekleşebileceği duruma **giriyor mu**?
4. **Bu yorumun tarif ettiği hata testle yakalanıyor mu?** Yakalanamıyorsa yorum
   bunu açıkça söylesin.
