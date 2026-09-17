# Odağı takvime ve notlara taşıma — tasarım

**Tarih:** 2026-09-17
**Durum:** onaylandı (kullanıcı kararları aşağıda işaretli)

## 1. Sorun

Uygulama çalışıyor ama **neye yaradığını yanlış anlatıyor**. Ana ekran şu
sırayla diziliyor:

1. Hızlı arama
2. Ay özeti (içinde tahsilat kurallarını anlatan bir paragraf)
3. Danışan listesi
4. Saklama süresi hatırlatması
5. Depolama uyarısı
6. Yedekleme (sarı, kalıcı uyarı kutusu)
7. Parola
8. **Takvim** — asıl iş, yedi panelin altında

Danışan kartı da aynı hâlde: telefon/doğum tarihi/başvuru nedeni/bakiyeden
sonra aydınlatma-açık rıza, saklama süresi, ekli dosyalar, veri raporu. Kartta
şu cümle yazıyor: *"Rıza alınmadan işlenen bir danışan dosyası, bu
uygulamadaki en somut KVKK uyumsuzluğudur."*

Kullanıcının sözleriyle: *"bu kvkk ve güvenlikle ilgili olan şeyler laps diye
ortada, sanki uygulamanın amacı buymuş gibi duruyorlar; bunlar istenildiğinde
gidilip ulaşılacak şeyler olmalı."* Rıza zaten terapiye başlarken kâğıt
üzerinde imzalanıyor; uygulamanın işi onu denetlemek değil, imzalı kâğıdı
saklayabilmek.

**Ve asıl istenen akış bugün hiç yok:** geçmiş notlar bileşeni
(`GecmisNotlar`) yalnızca **randevuya** tıklayınca açılan seans panelinin
içinde. **Danışana** tıklandığında geçmiş seanslar ve notlar gelmiyor.

## 2. Hedef

Bir cümlede: **uygulamayı açınca takvimi gör; danışana tıklayınca onun bütün
geçmişini oku; güvenlik işleri aradığında bulacağın yerde dursun.**

Kaldırılan hiçbir yetenek yok. Yedekleme, parola değiştirme, saklama süresi,
veri raporu, denetim kaydı — hepsi kalıyor. Yalnızca **yerleri** değişiyor ve
uyarı diliyle değil, bilgi diliyle yazılıyor. Şifreleme, `127.0.0.1` kısıtı,
ayrı özel not tablosu, silinemez `audit_log` gibi yapısal korumalara
dokunulmuyor; bunlar zaten görünmez katmanda.

## 3. Kullanıcı kararları

| Konu | Karar |
|---|---|
| Kabuk | **Üç sekme: Takvim · Danışanlar · Ayarlar** |
| Danışan dosyası | **İki kolon:** solda seans listesi, sağda seçilen seansın notu |
| Editör | **Markdown + biçim çubuğu**; not düz metin olarak saklanır |
| Not özellikleri | **Tüm notlarda arama** ve **etiketler** |
| Kapsam dışı (şimdilik) | Önceki notu yanında görme, ödev/plan takibi |

## 4. Kabuk: üç sekme

Üstte tek satır: uygulama adı, sekmeler, sağda `Kilitle`.

### Takvim sekmesi (açılış sekmesi)
- Ekranın tamamı haftalık takvim.
- Üstte: `Önceki hafta` / tarih aralığı / `Sonraki hafta`, `Hızlı arama
  (Ctrl+K)`, `Ay sonu özeti`.
- **Ay özeti kutu olarak durmuyor**, `Ay sonu özeti` düğmesine basınca açılan
  bir panelde. Tahsilat kurallarını anlatan paragraf oraya taşınıyor.
- Randevuya tıklayınca seans paneli (bugünkü davranış korunuyor).

### Danışanlar sekmesi
- Solda danışan listesi + arama kutusu, `Danışan ekle`, arşiv görünürlüğü.
- Sağda seçili danışanın **dosyası**. Dosyanın kendi içinde iki alt sekme:
  - **Seanslar** (varsayılan) — §5.
  - **Bilgiler** — telefon, doğum tarihi, başvuru nedeni, risk notu, bakiye,
    imzalı onam ve diğer ekli dosyalar, saklama süresi, veri raporu.
- Takvimden bir danışan çipine tıklamak da Danışanlar sekmesini o danışanın
  dosyası açık hâlde getirir.

### Ayarlar sekmesi
Yalnızca uygulama geneline ait yönetim işleri:
- Yedekleme: son yedek zamanı, `Şimdi yedek al`, klasör, geri yükleme.
- Parola değiştirme.
- Depolama durumu.
- Saklama süresi dolan dosyalar (varsa) — liste hâlinde, karar terapistin.

**Dil değişikliği:** yedekleme bölümü artık sarı bir uyarı kutusu değil,
durumu bildiren normal bir bölüm. Hiç yedek alınmamışsa bu bir **uyarı**
olarak Ayarlar sekmesinin başlığında küçük bir nokta ile duyurulur; ana ekranı
işgal etmez.

## 5. Danışan dosyası — Seanslar sekmesi

İki kolon:

**Sol kolon — seans listesi.** En yeni üstte. Her satır: tarih ve saat,
durum rozeti (geldi / gelmedi / iptal), ödeme rozeti, notun ilk satırı,
etiketleri. Notu olmayan randevular da listede; "not yok" olarak görünür ki
eksik not gözden kaçmasın.

**Sağ kolon — seçili seansın notu.** Markdown editörü (§6), durum/ücret/ödeme
satırı, etiket satırı. Düzenleme dosyanın içinden yapılabilir; randevuya
takvimden gitmek şart değil.

Liste ve not arasındaki seçim **danışanın kendi randevu kaydından** türetilir
(`appointments.client_id`), notun denormalize alanından değil — bir randevu
başka bir danışana taşındığında not da onunla gider.

Özel notlar bu ekranda **ayrı tabloda kalmaya devam eder** ve yalnızca
terapistin açıkça açtığı ayrı bir alanda görünür; veri raporuna asla girmez.

## 6. Markdown editörü

**Saklama biçimi düz metin olarak kalıyor.** `progress_notes.icerik` bugün ne
tutuyorsa onu tutmaya devam eder. Bunun üç sonucu var: arama aynen çalışır,
şifreli PDF dışa aktarım aynen çalışır, ve not on yıl sonra herhangi bir
metin düzenleyicide okunabilir kalır.

**Desteklenen kapalı küme** (projenin başka yerlerindeki kapalı küme
alışkanlığıyla aynı):

| Biçim | Kaynak |
|---|---|
| Kalın | `**metin**` |
| İtalik | `*metin*` |
| Başlık | `# `, `## `, `### ` |
| Madde listesi | `- ` |
| Numaralı liste | `1. ` |
| Alıntı | `> ` |
| Onay kutusu | `- [ ] ` / `- [x] ` |

Araç çubuğu düğmeleri ve kısayollar: Ctrl+B kalın, Ctrl+I italik, Ctrl+1/2/3
başlık, Ctrl+Shift+8 madde listesi. Düğme, seçili metni sarar; seçim yoksa
işaretleri ekleyip imleci aralarına koyar.

**Görüntüleme kendi yazdığımız bir çevirici ile yapılır, dış paket
eklenmez ve `dangerouslySetInnerHTML` kullanılmaz.** Çevirici Markdown
kaynağından doğrudan React elemanları üretir. Gerekçesi ikili: proje zaten
paket eklemeden ilerliyor (TL biçimlendirici elle yazıldı), ve HTML üreten
bir çevirici not içeriğini DOM'a enjekte eden bir yol açardı.

Şablonlar (DAP/SOAP/Serbest) korunuyor; şablon başlıkları artık düz metin
yerine `## Başlık` olarak ekleniyor.

Şifreli PDF raporunda not **kaynak hâliyle** çıkar; `**` gibi işaretler
metinde görünür. Bu bilinçli bir kabul: raporun içeriği notun birebir
kendisidir ve rapor tarafında ikinci bir Markdown çevirici yazmak, iki
çeviricinin sessizce ayrışması riskini getirir.

## 7. Etiketler

Yeni tablo `tags(id, ad UNIQUE)` ve bağlantı tablosu
`progress_note_tags(note_id, tag_id)`. Etiket **yalnızca resmî notlara**
bağlanır; özel notların etiketi yoktur (özel not tablosuna dokunulmaz).

- Not altında etiket satırı: var olanlardan seç ya da yaz-ekle.
- Etikete tıklamak, o etiketi taşıyan bütün seansları listeler.
- Danışan dosyasında etikete göre süzme.

**Etiket adları denetim kaydına girmez.** Etiket adı ("ilaç değişimi",
"kriz") en az not içeriği kadar hassastır; `audit_log` silinemez olduğu için
oraya düşen şey kalıcıdır. Denetim kaydına yalnızca notun kimliği ve işlemin
türü yazılır — bu, not içeriği, dosya adı ve arama terimi için zaten geçerli
olan kuralın etiketlere genişletilmesidir.

## 8. Tüm notlarda arama

Ctrl+K bugün yalnızca danışan adında arıyor. Genişliyor:

- Sonuçlar iki grupta: **danışanlar** ve **notlar**.
- Not sonucunda danışan adı, seans tarihi ve eşleşen satır görünür.
- Sonuca tıklamak o danışanın dosyasını, o seans seçili hâlde açar.
- Etiket adları da aranır.

**Uygulama:** arama sunucu tarafında, notlar üzerinde tarama ile yapılır;
FTS5 sanal tablosu kurulmaz. Gerekçe: tek terapistin verisi küçük (yıllık
birkaç yüz not), FTS5 Türkçe için `i/ı` ve büyük harf davranışında ayrı
uğraş gerektirir, ve ikinci bir kopya tablo şifreli veritabanında not
metninin ikinci bir kopyası demektir. Karşılaştırma Türkçeye uygun küçük
harfe çevirme ile yapılır (`İ→i`, `I→ı`).

**Arama terimi denetim kaydına yazılmaz** (mevcut kural).

## 9. Ne değişmiyor

- Sunucu yalnızca `127.0.0.1` dinler.
- Veritabanı SQLCipher ile şifreli; anahtar sarmalaması aynı.
- `audit_log` tetikleyicilerle silinemez.
- Özel notlar ayrı tabloda; `WHERE gizli=0` filtresi yok.
- Veri raporu sunucuda üretilir, AES-256 parola korumalı, özel notlar dışarıda.
- Zaman duvar saati, para tam sayı kuruş.

## 10. Bölünme

| Plan | Kapsam | Teslimat |
|---|---|---|
| **Plan 5** | Üç sekmeli kabuk, Ayarlar sekmesi, danışan dosyası iki kolon + Seanslar/Bilgiler alt sekmeleri, ay özetinin panele taşınması, uyarı dilinin yeniden yazılması | Aynı yetenekler, doğru yerlerde |
| **Plan 6** | Markdown editörü ve çevirici, etiket tabloları ve arayüzü, notlarda arama | Gelişmiş not alma |

Plan 5 veri şemasına dokunmaz; Plan 6 iki yeni tablo ekler.
