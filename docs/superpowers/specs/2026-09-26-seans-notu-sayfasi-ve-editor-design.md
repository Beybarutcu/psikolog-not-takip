# Seans notu sayfası, biçimli editör ve okuma penceresi — tasarım

**Tarih:** 2026-09-26
**Durum:** bölüm bölüm sohbette onaylandı; kullanıcı yazılı belgeyi ve planı
beklemeden uygulamaya geçilmesini istedi ("hallet bitir işi").

## 1. Sorun

- Not editörü düz bir metin kutusu. "Başlık" düğmesi satır başına `## `,
  "Kalın" seçimin iki yanına `**` ekliyor; terapist yazarken işaretleri görüyor
  (`## *###*` gibi karışıklıklar), son hâl ancak "Önizle"ye basınca çıkıyor.
  Araç çubuğunda simge değil "Kalın (Ctrl+B)" gibi yazılar var.
- Randevuya tıklayınca takvimin altında solda randevu formu, sağda not editörü
  açılıyor. Randevu güncellemek seyrek bir iş; not alırken formun yanda durması
  yer kaplıyor.
- Önceki notlar yan panelde en fazla üç tane, küçük bir kutuda. Terapist belli
  bir şeyi hatırlayıp o yeri bulmak istediğinde bunun bir yolu yok.
- Takvim bloğu yalnızca renkle durum söylüyor; "gelmedi" ve "ödeme alınmadı"
  bilgisi bir bakışta okunmuyor.

## 2. Hedef

Bir cümlede: **randevuya tıklayınca notun kendi sayfası açılsın; not Word gibi
biçimli yazılsın, işaret görünmesin; eski notta aranan yer bulunup rahatça
okunsun, gerekirse ayrı bir pencerede yanda dursun.**

## 3. Kullanıcı kararları

| Konu | Karar |
|---|---|
| Editör kütüphanesi | TipTap, hazır **Simple Editor** şablonuyla (kodu projeye kopyalanır, MIT) |
| Şablonla gelenler | hepsi kalır; **çıkanlar:** resim ekleme, karanlık tema düğmesi |
| Görünüm | uygulamanın geri kalanına uydurulur; bütün metinler Türkçe |
| Yaz/Önizle | kalkar (editör zaten son hâli gösterir) |
| Word'den yapıştırma | editörün desteklediği biçimler korunur; birebir kopya hedef değil |
| Saklama biçimi | HTML (altı çizili, renk, hizalama Markdown'a sığmıyor); eski not yok, taşıma yok |
| Bağlantılar | tıklanınca Mac'in varsayılan tarayıcısında açılır; uygulama penceresi asla başka siteye gitmez |
| Resim | bu dalgada yok; OCR ile birlikte ayrıca tasarlanacak |
| Not sayfası | yalnızca takvimden açılır; danışan dosyası kendi ekranını korur ama yeni editörü kullanır |
| Randevu formu | not sayfasında kapalı; "Randevuyu düzenle" ile açılır |
| Önceki notlar | arama kutusu; tek tıkla geniş okuma (yarım ekran), aranan kelime vurgulu ve görünür; aynı nota ikinci tıklama ya da "Bu seansa git" o seansın sayfasına geçer |
| Yeni pencere | sağ tık / Cmd+tık → "Yeni pencerede aç"; **yalnızca okunur** |
| Takvim simgeleri | gelmedi → üstü çizili kişi; ödeme alınmadı → ₺; geldi+ödendi simgesiz; iptal bugünkü gibi |

## 4. Takvim durum simgeleri (T)

- **T1.** `RandevuBloku` saat ve adın yanına, bloğun sağ üstüne en fazla iki
  simge koyar (`lucide-react`, yeni bağımlılık; yalnızca kullanılan simgeler
  pakete girer):
  - `durum === 'gelmedi'` → `UserX` ("Gelmedi").
  - `borcaGirerMi(r)` (`web/src/borc.ts`, ortak kural: geldi|gelmedi ∧
    !odendi ∧ ucret>0) → `TurkishLira` ("Ödeme alınmadı"). Kural yeniden
    yazılmaz, aynı fonksiyon çağrılır.
- **T2.** Geldi+ödendi, planlandı ve iptal simge taşımaz (iptal gri ve üstü
  çizili kalır).
- **T3.** Simgelerin `title`'ı Türkçe açıklamadır. Erişilebilir ad simge
  anlamlarını sonuna ekler: `"10:00 Zeynep Yıldız, gelmedi, ödeme alınmadı"`.
  Durumu olmayan blokta ad değişmez (`"10:00 Ayşe Kaya"`).
- **T4.** Simgeler dar (yarım genişlik) blokta da görünür; ad kırpılır, simge
  kırpılmaz.

## 5. Biçimli not editörü (E)

- **E1. Kurulum.** `npx @tiptap/cli@latest add simple-editor` şablonu `@/`
  takma adının gösterdiği yere kopyalar; önce `@` → `web/src` takma adı
  (`tsconfig.app.json` `paths` + `vite.config.ts` `resolve.alias`) kurulur ki
  dosyalar `web/src/components/tiptap-*`, `web/src/hooks`, `web/src/lib`,
  `web/src/styles` altına düşsün (takma ad yoksa CLI proje kökünde `@/` adlı
  bir klasör açıyor — denendi). CLI'nin eklediği paketler (2026-09-26
  denemesi): `@tiptap/{core,pm,react,starter-kit,extensions,extension-list,
  extension-highlight,extension-horizontal-rule,extension-subscript,
  extension-superscript,extension-text-align,extension-typography,
  extension-find-and-replace,extension-image}`, `@floating-ui/react`,
  `@radix-ui/react-dropdown-menu`, `@radix-ui/react-popover`, `clsx`,
  `lodash.throttle`, `react-hotkeys-hook`; geliştirme: `sass-embedded`,
  `@base-ui/react`, `class-variance-authority`, `@types/lodash.throttle`.
  Bul-değiştir (`extension-find-and-replace`) açık kaynak npm paketidir.
  Şablon kodu projenin kodu sayılır: düzenlenir, Türkçeleştirilir, gereksizi
  silinir (`image-node`, `image-upload-node`, `image-upload-button`,
  `theme-toggle.tsx`, `data/content.json`, `@tiptap/extension-image`).
- **E2. Özellikler.** Kalın, italik, altı çizili, üstü çizili, vurgulama rengi,
  başlık menüsü (1-3), madde/numaralı/onay listesi, alıntı, satır içi kod ve kod
  bloğu, hizalama, üst/alt simge, bağlantı, geri al/yinele; şablonda varsa
  bul-değiştir. **Çıkarılanlar:** resim ekleme düğmesi ve resim düğümü
  (yapıştırılan/sürüklenen resimler de düşer), karanlık/açık tema düğmesi.
- **E3. Türkçe.** Bütün düğme ipuçları, menü öğeleri, bağlantı açılır penceresi
  ve boş editör yer tutucusu Türkçe.
- **E4. Görünüm.** Şablonun renk/yazı tipi değişkenleri uygulamanın açık
  temasına bağlanır (slate tonları, uygulamanın yazı tipi, 16 px gövde). Koyu
  tema kuralları silinir; uygulama yalnızca açık temadır (`index.css`
  `color-scheme: light`, Tauri `Theme::Light`).
- **E5. Kısayollar.** TipTap'ın standartları: Cmd/Ctrl+B, I, U; başlıklar
  Cmd/Ctrl+Alt+1/2/3; listeler Cmd/Ctrl+Shift+7/8/9. Türkçe Q klavyede Cmd+I
  (`ı` üreten fiziksel I tuşu) çalışmalıdır (ProseMirror `keyCode`'a düşer;
  e2e'de sınanır). Mac'te Option ile yazılan `#`, `>` gibi karakterler
  yazılabilir kalır. (Windows'ta AltGr = Ctrl+Alt olduğu için AltGr+3 ile `#`
  yazmak Başlık 3 kısayoluna takılabilir; hedef platform Mac, kabul edildi.)
- **E6. Yazarken dönüşüm.** TipTap giriş kuralları açık: satır başında `## `
  başlık, `- ` madde, `1. ` numaralı liste, `> ` alıntı, `[ ] ` onay kutusu,
  `**x**` kalın olur; işaret kaybolur.
- **E7. Otomatik kayıt sözleşmesi değişmez.** `NotEditoru`'nun bugünkü
  davranışı aynen korunur: kaydet düğmesi yok, 2 sn gecikmeli kayıt, her
  değişiklikte taslak deposu (`taslak.ts`), 401'de taslaktan geri yükleme ve
  duyurusu, `sunucuHali` ile ters yarış koruması, unmount'ta bekleyen yazma,
  "Yeniden dene". Yalnızca metin kutusu TipTap'a döner; "içerik" artık HTML
  dizgisidir.
- **E8. Açılışta yazma yok.** Editörün yüklediği HTML'i kendi biçimine
  normalleştirmesi (ör. `<p></p>` eklemesi) bir "değişiklik" sayılmaz;
  kullanıcı tek tuşa basmadan hiçbir PUT (ve silinemez denetim satırı)
  üretilmez. Karşılaştırma normalleştirilmiş hâl üzerinden yapılır.
- **E9. Şablonlar.** `sablon.ts`'in başlık listesi aynı kalır; boş editörde
  şablon seçilince başlıklar HTML başlığı (`<h2>`) ve ardından boş paragraf
  olarak eklenir. Dolu editörde şablon değişimi metni ezmez (bugünkü kural).
- **E10. Bağlantılar.** Editörde bağlantı eklenebilir/düzenlenebilir. Tıklanan
  bağlantı yalnızca `http:`/`https:`/`mailto:` ise Mac'in varsayılan
  tarayıcısında/posta uygulamasında açılır; başka şemalar açılmaz.
- **E11. Yapıştırma.** HTML yapıştırma şemaya süzülür (TipTap/ProseMirror
  bunu kendiliğinden yapar); resim, betik, stil, bilinmeyen etiket düşer.
- **E12. Kullanıldığı yerler.** Takvimden açılan not sayfası (resmî not ve
  Özel notlarım), danışan dosyasındaki not editörü. Salt okunur görünüm
  (`NotOkuma`, `NotGorunumu`'nun yerini alır) "Diğer seanslar" panelinde, okuma penceresinde
  ve danışan dosyasının okuma yerlerinde kullanılır; hepsi aynı tipografiyle.
- **E13. Eski Markdown yığını kalkar.** `not/bicim.ts`, `not/BicimCubugu.tsx`,
  `not/markdown.tsx`, `not/desenler.ts` ve onların testleri, başka tüketicisi
  kalmadığı doğrulandıktan sonra silinir.

## 6. Saklama ve sunucu (S)

- **S1. Biçim.** `progress_notes.icerik` ve `private_notes.icerik` HTML
  saklar. Eski not olmadığı için veri taşıma yok; boş dizge "not yok"
  anlamını korur.
- **S2. Düz metin sütunu.** `progress_notes`'a `duz_metin TEXT NOT NULL
  DEFAULT ''` eklenir (şema sürüm/göç mekanizmasıyla). Sunucu her resmî not
  yazımında HTML'den düz metni kendisi çıkarır ve aynı işlemde yazar; istemci
  düz metin göndermez (tek kaynak). Özel notlara düz metin sütunu eklenmez
  (aranmaz, raporlanmaz).
- **S3. Düz metin kuralı.** Etiketler atılır; blok öğeleri (`p`, `h1-6`,
  `li`, `blockquote`, `pre`, `br`, `tr`) satır sonuna döner; HTML varlıkları
  (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&nbsp;`, sayısal) çözülür;
  art arda boş satırlar teke iner; baş/son boşluk kırpılır. Onay kutusu
  öğeleri `[ ]`/`[x]` işaretini taşımaz, yalnızca metni. Kural Rust'ta tek
  fonksiyondur ve ortak örnek dosyasıyla (`duz_metin_ornekleri.json`)
  sınanır; istemcide bir eşi gerekiyorsa aynı dosyayla sınanır.
- **S4. Arama.** Not araması (`search.rs`, LIKE) `icerik` yerine `duz_metin`
  üzerinde çalışır. Biçim etiketleri araya girse de ("çok <strong>önemli</strong>")
  metin bulunur; etiket adları ("strong", "span") eşleşmez.
- **S5. Önizleme satırı.** Seans listesi önizlemesi
  (`danisan_seanslari.rs::onizleme`) `duz_metin`'den türer: şablon başlığı
  olan satırlar ("Veri", "Değerlendirme", …) atlanır, ilk dolu satır 120 kod
  noktasına kırpılır. Markdown işaretlerini ayıklayan eski yardımcılar kalkar;
  ortak örnek dosyası (`onizleme_ornekleri.json`) yeni kurala göre yeniden
  yazılır. **İstemci eşi kalkar:** `SeansNotu` yanıtı (GET ve PUT
  `/api/randevular/{id}/not`) sunucunun hesapladığı `onizleme` alanını taşır;
  `AnaEkran.seansNotuKaydet` dosya listesini bu alanla yamar
  (`seans/onizleme.ts` ve testi silinir). Böylece iki uygulamanın ayrışması
  yapısal olarak imkânsızlaşır.
- **S5b. Danışan adı.** `SeansNotu` yanıtı `danisan_adi` alanını da taşır
  (okuma penceresinin başlığı için; ayrı bir danışan isteği ve denetim satırı
  gerekmesin).
- **S6. Rapor.** Veri raporu (PDF) not satırlarını `duz_metin`'den alır; PDF'te
  HTML etiketi görünmez.
- **S7. Güvenli gösterim.** Saklanan HTML hiçbir yerde doğrudan `innerHTML`
  ile basılmaz: okunur görünüm, editörle aynı uzantılarla kurulmuş
  `editable: false` bir TipTap örneğidir (şemada olmayan etiket ve öznitelik,
  `on*` olayları, `javascript:` bağlantıları düşer).
- **S8. Danışana özel not araması.** Yeni uç: `GET
  /api/danisanlar/{id}/not-ara?q=<terim>&once=<YYYY-AA-GGTSS:DD>` →
  `{ sonuclar: [{ appointment_id, seans_zamani, parca }], kirpildi }`,
  yeniden eskiye, en fazla 500 (`AZAMI_DANISAN_NOT_SONUCU`; genel aramanın
  50'si değişmedi); fazlası varsa en yeniler döner ve `kirpildi: true`
  (sunucu bir fazlasını ister: ölçüm, tahmin değil). *(2026-09-27: eskiden
  çıplak dizi ve en fazla 50; "Diğer seanslar" `once` göndermeyince sonraki
  seansların eşleşmeleri önceki eşleşmeleri sınırın dışına sessizce
  itiyordu.)* Yalnızca `progress_notes.duz_metin`, yalnızca o danışan;
  `once` verilirse yalnızca ondan önce başlayan seanslar (isteğe bağlı,
  panel göndermez); `search.rs`'in Türkçe harf katlama kuralını ve parça
  (snippet) üretimini yeniden kullanır. Denetim: genel aramayla aynı kural
  (`OturumBasi`, `ayrinti` yok, terim ve sonuç sayısı yazılmaz). `private_notes`
  bu uçta da hiç geçmez. Boş ya da tek karakterlik terim boş liste döner.

## 7. Seans notu sayfası (N)

- **N1. Açılış.** Takvimde bir randevuya (ızgara bloğu, bilgi satırındaki
  "sıradaki", aralık dışı listesi) tıklamak takvim ızgarasının yerine o
  randevunun not sayfasını açar. Takvim sekmesi seçili kalır. Boş saate
  tıklamak bugünkü gibi yeni randevu formunu açar (not sayfası değil).
- **N2. Üst satır.** "← Takvime dön" (takvimi aynı haftada geri getirir), danışan
  adı (danışan dosyasına bağlantı), tarih ve saat, Geldi/Gelmedi/İptal, ücret,
  Ödendi. Bu kontroller bugünkü `SeansAltSatiri` davranışını ve yazma yollarını
  kullanır.
- **N3. Randevu formu.** Kapalı başlar. "Randevuyu düzenle" onu üst satırın
  altında açar (bugünkü `RandevuPaneli`, tarih/saat/süre/ücret/danışan, Sil);
  Güncelle sonrası form açık kalır ve "Güncellendi SS:DD" der; "Kapat" ile
  gizlenir. Randevu başka bir haftaya taşınınca "Takvime dön" yeni haftayı
  açar.
- **N4. Editör alanı.** Sayfanın büyük kısmı: "Seans notu" ve "Özel notlarım"
  sekmeleri, şablon seçici, biçimli editör, altında etiketler. Özel not
  sekmesine girilmeden özel not istenmez (bugünkü kural).
- **N5. Önceki notlar paneli.** *(2026-09-27'de değişti: "Diğer seanslar", bkz.
  bölüm sonundaki değişiklik.)* Sağ sütun: aynı danışanın **bu seanstan önceki**
  seansları, yeniden eskiye; her satırda tarih-saat, durum simgesi (T1 ile aynı)
  ve notun ilk satırı ya da "Not yazılmamış". Liste uzunsa panel kendi içinde
  kayar. Bu seansın kendisi ve sonraki seanslar listede yoktur.
- **N6. Arama.** *(2026-09-27'de değişti, bkz. bölüm sonu.)* Panelin üstünde
  "Önceki notlarda ara" kutusu. Yazıldıkça
  (gecikmeli) liste terimin geçtiği seanslara daralır; satırda terimin geçtiği
  cümle parçası gösterilir, terim vurgulanır. Arama yalnızca bu danışanın
  resmî notlarında, `duz_metin` üzerinde, büyük/küçük harf ve Türkçe harf
  duyarsız yapılır. Özel notlar aranmaz. Arama terimi hiçbir loga yazılmaz.
- **N7. Geniş okuma.** Bir satıra tek tıklama, sağ sütunu sayfanın yarısına
  genişletir (editör öbür yarıda kalır) ve notu editörle aynı yazı boyunda,
  salt okunur gösterir. Aramadan gelindiyse ilk eşleşmeye kaydırılır ve bütün
  eşleşmeler vurgulanır. Üstte "← Listeye dön", tarih ve "Bu seansa git".
- **N8. Seansa geçiş.** Açık olan satıra ikinci tıklama ya da "Bu seansa git"
  o seansın not sayfasına geçer (editördeki bekleyen metin, bugünkü seans
  değişimi kuralıyla gitmeden önce kaydedilir). Hedef seans görünen haftada
  değilse takvim önce o haftaya geçer, seçim hafta yüklenince yapılır
  (`useTakvimAkisi`'ne `randevuyaGit(id, baslangic)` eklenir); "Takvime dön"
  o haftayı gösterir. Paneldeki seanslar `DanisanSeansi` kayıtlarından gelir.
- **N9. Yeni pencere.** Listedeki satıra ya da "Bu seansa git"e sağ tıklamak
  küçük bir menü açar: "Yeni pencerede aç". Cmd+tık (Windows'ta Ctrl+tık)
  aynı işi menüsüz yapar. Bkz. §8.

**Değişiklik (2026-09-27, kullanıcı kararı): "Önceki seans notları" yerine
"Diğer seanslar".** Kullanıcı: "önceki seans notları yerine diğer seanslar
olsun, eski seansı görüntülerken yeni seanslarda gözüksün". N5 ve N6 şöyle
değişti; N7-N9 aynı (sonraki seanslar için de geçerli):

- **N5'.** Panelin adı "Diğer seanslar". Danışanın açık seans **dışındaki
  bütün** seansları, yeniden eskiye (sunucu sırası `baslangic DESC, id DESC`).
  Açık seansın yerinde tıklanamayan bir **"Bu seans · <tarih-saat>"** işareti
  durur (`li`, `aria-current="true"`; düğme değil, açılmaz, istek atmaz):
  üstündekiler sonraki, altındakiler önceki seanslar. İşaret açık seansın
  güncel başlangıcıyla yerleşir (taşımada liste yeniden istenmez).
  **Gelecekteki** (`baslangic > şimdi`, uygulamanın tek "şimdi"si) ve notu
  hiç yazılmamış seans listelenmez — okunacak bir şey yok; notu olan gelecek
  seans listelenir. Tam şimdi başlayan seans gelecek sayılmaz (geçmiş =
  `baslangic <= şimdi`, danışan dosyasıyla aynı sınır). Boş durum: "Bu
  danışanın başka seansı yok."; elenenlerin hepsi notsuz gelecek seanssa
  "Geçmişte başka seans yok; yaklaşan seanslara henüz not yazılmadı." (uygulama
  bu seanslara her yerde "Yaklaşan" diyor).
- **N6'.** Kutu "Diğer seanslarda ara". Arama bütün diğer seansların resmî
  notlarında yapılır: istemci `once` kesmesini **göndermez** (uç `once`'ı
  isteğe bağlı olarak desteklemeye devam ediyor) ve açık seansın kendi
  notunu sonuçlardan atar. Sonuçlarda da işaret aynı kuralla yerleşir.
  Sunucu en fazla 500 sonuç döndürür (S8); `kirpildi` ise listenin altında
  "Yalnızca en yeni {N} eşleşme gösteriliyor; daha eskileri için terimi
  daraltın." yazar (N ekrandaki satır sayısı) — yoksa işaretin altındaki
  boşluk "önceki seanslarda geçmiyor" diye okunurdu.
  Terim yine yalnızca o sorgunun adresinde; denetim kaydı değişmedi
  (`Goruntuleme | arama | danisan:<id>`, terim ve sonuç sayısı yok).

## 8. Okuma penceresi (P)

- **P1.** Ayrı bir uygulama penceresi, tek bir seansın resmî notunu salt okunur
  gösterir: başlıkta danışan adı ve tarih-saat; altında not. Düzenleme, özel
  not, etiket, ödeme, durum ve seansa geçiş yoktur (pencereler arası mesaj
  yolu kurulmaz; pencere yalnızca bakmak içindir).
- **P2.** Adres `/?okuma=<randevu_id>`; aynı yerel sunucudan, aynı kökenden
  açılır. `App` bu parametreyi görünce kilit açıkken `AnaEkran` yerine
  `OkumaPenceresi`'ni çizer. Açan taraf `window.open(adres, 'okuma-<id>')`
  çağırır. Masaüstünde Tauri bu isteği `on_new_window` ile yakalar ve
  pencereyi kendisi kurar (etiket `okuma-<id>`, 720×800, açık tema, aynı
  gezinme koruması); tarayıcıda (geliştirme, e2e) aynı çağrı adlandırılmış
  yeni bir pencere/sekme açar.
- **P3.** Aynı seans için ikinci kez istenirse yeni pencere açılmaz, var olan
  öne gelir (Tauri: etiket zaten varsa `set_focus`; tarayıcı: aynı pencere
  adı). Farklı seanslar için birden çok okuma penceresi açılabilir.
- **P4. Kilit.** Oturum kilitlenince (boşta kalma ya da "Kilitle") okuma
  penceresi içeriği en geç 5 saniye içinde ekrandan kaldırır: pencere
  `/api/durum`'u 5 saniyede bir sorar (bu uç oturuma dokunmaz, denetim satırı
  yazmaz) ve kilitliyse bugünkü `App` akışıyla kilit ekranını gösterir;
  herhangi bir 401 de aynı yoldan kilide götürür.
- **P5.** Ana pencere kapanınca uygulama çıkar; okuma pencereleri de kapanır.
- **P6b. Gezinme koruması ve dış bağlantılar (Tauri).** Bütün pencerelerde
  `on_navigation` yalnızca uygulamanın kendi kökenine izin verir. `on_new_window`
  isteği: kendi kökeninde `?okuma=` ise okuma penceresi; `http(s):`/`mailto:`
  ise `tauri-plugin-opener` ile sistemin varsayılan uygulamasında açılır ve
  istek reddedilir; başka her şey reddedilir. Editör bağlantıları
  `target="_blank"` ile açılır, böylece aynı yoldan geçer.
- **P6. Denetim.** Okuma penceresinin açılması o notun görüntülenmesidir; bugün
  bir notun okunmasının yazdığı denetim satırıyla aynı satırı yazar, fazlasını
  değil.

## 9. Güvenlik ve değişmezler

- Her şey yerelde; yeni hiçbir dış bağlantı yok. Paketler uygulamaya gömülür.
- Uygulama penceresi (ana ve okuma) yalnızca kendi yerel adresinde gezinebilir;
  başka her adrese gezinme iptal edilir, `http(s)`/`mailto` ise sistemin
  varsayılan uygulamasına devredilir.
- Özel notlar: aramaya, "Diğer seanslar" paneline, okuma penceresine, önizlemeye,
  rapora girmez (bugünkü ayrı tablo kuralı).
- Denetim kaydına not içeriği, arama terimi, şablon adı girmez.
- Parolalar, kurtarma kodu vb. hiçbir yeni yolda görünmez.

## 10. Kapsam dışı

Resim ekleme, OCR, karanlık tema, danışan dosyasının yeni düzeni (Plan B),
danışan dosyasından not sayfasına geçiş, okuma penceresinde düzenleme.

## 11. Doğrulama

- **Test yüzeyi kararı.** jsdom'da `contenteditable` üzerinde `userEvent.type`
  güvenilir değil. Editör, metin yüzeyini tek bir bileşenden alır
  (`BicimliYuzey`: `{ html, onChange(html), etiket, editable }`). Vitest kurulum
  dosyası bu modülü, aynı sözleşmeyi bir `<textarea aria-label=etiket>` ile
  sağlayan test yüzeyiyle değiştirir; böylece `NotEditoru`, `SeansPaneli`,
  `AnaEkran`, `DanisanDosyasi` sözleşme testleri etikete göre sürmeye devam
  eder. Gerçek TipTap yüzeyi birkaç odaklı jsdom testiyle (içerik yükleme,
  `editable:false`, şema süzmesi, bağlantı özniteliği) ve e2e ile sınanır.
- Birim: editör sözleşmesi (E7, E8); düz metin kuralı ortak örneklerle Rust'ta;
  önizleme ve not araması Rust'ta; takvim simgeleri; not sayfası akışları
  (açılış, geri dönüş, form aç/kapa, diğer seanslar arama/okuma/ikinci tık,
  başka haftadaki seansa geçiş); okuma penceresi (kilitte içerik kalkar).
- E2E (Chromium): gerçek editörde yazma → otomatik kayıt → yeniden açınca aynı
  biçim; Türkçe Q Cmd/Ctrl+I; yapıştırmada resim/betik düşer; diğer seanslarda
  arama ve vurgulu okuma (eski seans açıkken sonraki seansın notu dahil); okuma penceresi `window.open` ile açılır ve kilitte
  içeriği kaldırır; bağlantıya tıklamak uygulamayı başka siteye götürmez.
- Elle (Mac): Tauri okuma penceresi, bağlantının Safari'de açılması, Türkçe
  klavye kısayolları, Word'den yapıştırma.
