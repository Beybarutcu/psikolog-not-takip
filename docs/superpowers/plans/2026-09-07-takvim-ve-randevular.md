# Takvim ve Randevular — Uygulama Planı (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uygulamanın ana ekranı olan haftalık takvim: danışan kaydı açma, randevu oluşturma, tekrarlayan seri kurma, çakışma uyarısı ve geldi/gelmedi/iptal işaretleme.

**Architecture:** Plan 1'in şifreli veritabanı ve oturum katmanı üzerine kurulur. Yeni iki tablo (`clients`, `appointments`) şema sürüm 2 ile gelir; veri erişimi `core` içindeki iki depo modülünde toplanır, `server` bunları HTTP'ye açar ve React tarafı haftalık ızgara olarak gösterir. Randevu ile seans **aynı kayıttır** — not, Plan 3'te bu kayda bağlanacaktır.

**Tech Stack:** Plan 1 ile aynı — Rust (rusqlite/SQLCipher, axum), React + TypeScript + Tailwind, Vitest, Playwright.

**Önkoşul:** Plan 1'in tamamı bitmiş olmalı. Bu plan `open_encrypted`, `migrate`, `audit::kaydet`, `Oturum` ve `AppState` üzerine inşa eder.

## Global Constraints

Plan 1'in tüm global kısıtları geçerlidir (dış ağ isteği yok, sunucu yalnızca `127.0.0.1`, anahtar diske yazılmaz, Türkçe arayüz, TDD zorunlu, Rust 1.83+/Node 22). Bu plana özgü ek kısıtlar:

- **Para birimi kuruş cinsinden tam sayıdır.** Ücret alanı `INTEGER`; 450 TL = `45000`. Kayan noktalı sayı kullanılmaz — 0.1 + 0.2 tutmayan bir muhasebe, güvenilmez bir muhasebedir.
- **Randevu saatleri yerel duvar saatidir**, zaman dilimi taşımaz. Biçim: `YYYY-AA-GGTSS:DD` (örnek `2026-09-07T14:00`), saniye yok. Gerekçe: terapistin 14:00'ü, yaz saati uygulaması değişse de 14:00'tür. UTC'de saklamak, saat değişiminde tüm gelecek randevuları bir saat kaydırır.
- **Kilitli oturumda hiçbir veri uç noktası yanıt vermez.** Danışan ve randevu uç noktaları, oturum kapalıysa `401` döner ve gövdede veri taşımaz.
- **Her veri okuma ve yazma erişim loguna yazılır** (`audit::kaydet`). Liste sorguları tek bir `goruntuleme` kaydı üretir, dönen her satır için ayrı kayıt üretmez.
- **Yazma işlemi ile log kaydı aynı transaction içinde olmalıdır.** Ayrı yapılırsa "kayıt güncellendi ama log yazılmadı" durumu doğar ve KVKK'nın loglama zorunluluğu anlamsızlaşır. Bir yazma fonksiyonu hem veriyi hem logu yazıyorsa, ikisini `conn.transaction()` içine alıp birlikte commit et.
- **Randevu durumları tam olarak şunlardır:** `planlandi`, `geldi`, `gelmedi`, `iptal`. Danışan durumları: `aktif`, `arsiv`.
- **Silme yerine iptal esastır.** Randevu kaydı fiziksel olarak yalnızca yanlışlıkla oluşturulmuşsa silinir; geçmiş randevular `iptal` durumuna alınır.

---

## Plan 1'in son incelemesinden devralınan zorunlu maddeler

Plan 1 tamamlandıktan sonra dalın tamamına bakan bir inceleme yapıldı. Aşağıdaki maddeler
Plan 1'i birleştirmeyi engellemiyordu ama **Plan 2 bunları içermeden yazılırsa hatalar
kalıcılaşır.** Görev sıralamasına dahil edilmeleri gerekir.

### Z1. `keystore.json` yedeğe dahil edilmeli — en kritik madde

`yedek_al` yalnızca `veri.db`'yi kopyalıyor. Ama o dosya, `keystore.json` içindeki sarmalanmış
veri anahtarı olmadan **açılamaz**; parola ve kurtarma kodu tek başına yetmez, ikisi de yalnızca
o dosyadaki sarmalamayı çözer. Keystore ise uygulama veri dizininde kalıyor.

**Sonuç: disk bozulursa veya Mac çalınırsa, USB'deki yedeğin tamamı sonsuza kadar okunamaz.**
Tasarımın üçüncü başarı ölçütü ("bilgisayar bozulursa veri kaybolmasın") bugünkü mimariyle
karşılanmıyor. Bu bir kod hatası değil, Görev 5 ile Görev 8 arasındaki mimari boşluk.

Yapılacaklar:
1. `yedek_al`, `keystore.json`'ı da hedef klasöre kopyalasın. Dosya zaten AEAD sarmalı olduğu
   için bulut klasöründe durması güvenli — tasarımın "dosya zaten şifreli" gerekçesiyle tutarlı.
2. `geri_yukle` her ikisini birlikte geri yüklesin; biri varken diğeri yoksa **hiçbirini**
   yükleme, çünkü eşleşmeyen bir çift veriyi erişilemez bırakır.
3. `KeystoreBozukEkrani` metni düzeltilsin: bugün "yedekten geri yükleyin" diyor, bu tavsiye
   **yanlış** (veritabanı yedeği bozuk keystore'u onarmaz) ve "teknik desteğe başvurun" diyor,
   oysa ürün tek kişilik bir muayenehane için.
4. Kurulum sihirbazı kullanıcıya "yedek klasörünüz hem verinizi hem anahtarınızı içerir" bilgisini
   versin.

### Z2. `migrate` çerçevesi yeniden yazılmalı — Görev 1'e dahil

Mevcut `migrate` sürümü **yazıyor ama hiç okumuyor**; tüm betikleri koşulsuz çalıştırıp
`schema_version`'ı `CURRENT_VERSION` yapıyor. İki sonucu var:
- **Sürüm düşürme sessizce veriyi bozar.** Uygulama imzasız olduğu için kullanıcı eski bir `.app`
  geri koyabilir; v3 veritabanı v2 ikilisiyle açıldığında `migrate` hata vermeden sürümü 2'ye
  geri yazar, v3 tabloları ortada kalır ve sonraki hiçbir teşhis doğru olmaz.
- Plan 3 zaten "duplicate column hatasını yut" gibi bir kaçamak planlıyor — kalıp ikinci
  genişletmede çatlıyor.

Yeni `migrate`: mevcut sürümü **okusun**, yalnızca eksik adımları **sırayla** uygulasın, hepsini
**tek transaction** içinde çalıştırsın ve `okunan_surum > CURRENT_VERSION` ise açmayı
**reddetsin** (anlaşılır bir hata mesajıyla).

### Z3. `dokun()` çağrılmalı

`Oturum::dokun()` yazıldı ve test edildi ama **hiçbir yerden çağrılmıyor**. Yani boşta kalma
kilidi bugün "son etkinlikten 5 dakika sonra" değil, **"kilit açıldıktan 5 dakika sonra"**
çalışıyor. Plan 1'de görünmez (ekranda veri yok). Plan 3'te doğrudan ürün sözünü kırar:
50 dakikalık seansta not yazan psikolog 5. dakikada kilitlenir ve 2 saniyede bir çalışan otomatik
kayıt 401 almaya başlar.

`guard::acik_baglanti` (veya eşdeğeri) her **başarılı** istekte oturuma dokunmalı. Ayrıca arayüz
durumu periyodik yoklamalı — bugün `App.tsx` durumu yalnızca bir kez çekiyor, yani sunucu
kilitlense bile ekranda danışan verisi görünmeye devam eder.

### Z4. Kilit açmada `open_encrypted` kullanılmamalı

`open_encrypted` "dosya yoksa oluştur" semantiğine sahip. Kurulumda doğru, **kilit açmada
tehlikeli**: `keystore.json` yerinde ama `veri.db` yoksa (yanlışlıkla silindi, senkronizasyon
klasörü yuttu, yarım geri yükleme), kilit açma **başarılı olur**, boş bir veritabanı yaratılır ve
kullanıcı içeri girip her şeyin silinmiş olduğunu görür — hiçbir uyarı olmadan.

`open_existing` ekle (SQLite `OPEN_READWRITE`, `OPEN_CREATE` yok) ve kilit açmada onu kullan.

### Z5. `audit_log.ayrinti` kapalı bir enum'a dönüşmeli

Alan şu an serbest metin; kural yalnızca belgelenmiş, derleyici zorlamıyor. `audit_log`
tetikleyicilerle **silinemez** olduğu için oraya bir kez yazılan hassas veri hiçbir zaman geri
alınamaz — KVKK açısından en kötü hata sınıfı.

Şu anda **5** çağrı yeri var. Plan 2 sonrası ~15, Plan 3 sonrası ~30 olacak. `Option<&str>`
yerine kapalı bir enum (`Ayrinti::Arsivlendi`, `Ayrinti::Durum(...)` gibi) **şimdi** yapılmalı.

### Z6. Diğer devralınan maddeler

- **`Keystore.version` kontrol edilmeli:** sabit var, yazılıyor, taşınıyor ama `load` hiç bakmıyor.
  İleride yeni bir keystore formatı eski bir ikiliyle açılırsa "dosya bozuk" denir — oysa dosya
  sağlamdır, sadece daha yenidir. `load` içinde tek bir sürüm kontrolü yeterli.
- **Parola değiştirme akışı hiç uçtan uca test edilmedi:** mevcut bir keystore dosyasının
  **üzerine** ikinci kez `save` çağırmak hiç denenmedi. Plan 2 parola değiştirmeyi eklerse,
  test edilmemiş bir `rename` yolu üretim akışı hâline gelir.
- **Kurtarma kodu yenilenemiyor:** kod bir kez gösteriliyor, hiçbir yerde saklanmıyor (doğru), ama
  kâğıt kaybolursa yeni kod üretmenin yolu yok. `change_password` de kurtarma sarmalamasını
  kasten koruyor. Açık oturumda parola ile doğrulayıp yeni kod üreten bir uç nokta gerekli (~30 satır).
- **"Artan gecikme" sözünün sahibi yok:** tasarım iki yerde söz veriyor (1s, 2s, 4s...), hiçbir
  planda geçmiyor. `/api/kilit-ac` sınırsız deneme kabul ediyor. Plan 2 veya Plan 4 sahiplenmeli.
- **`/api` altında 404 yok:** `fallback(assets::statik)` tüm router'a uygulandığı için
  `/api/yanlisyol` isteği `200` + HTML dönüyor ve arayüz bunu sessizce boş nesne olarak alıyor.
  Plan 2 ve 3 birlikte 15'ten fazla uç nokta ekliyor; yolu bir harf yanlış yazılan bir `fetch`
  sessizce "başarılı boş yanıt" verecek. `/api` altını kendi 404'ü olan bir alt router'a taşı.
- **`-wal`/`-shm` yan dosyalarının şifreli olduğu test edilmeli:** SQLCipher varsayılan olarak
  şifreler ama bu doğrulanmadı. Not yazımı başlayınca WAL sürekli dolu olacak ve o dosya diskte
  duracak.
- **`geri_yukle` açık bağlantı varken çalışmaz:** dosyayı `rename` ile değiştiriyor. Bugün sunucu
  her istekte yeni bağlantı açıp kapattığı için sorun yok. Performans için uzun ömürlü bir
  bağlantı havuzuna geçilirse geri yükleme **sessizce** bozulur.

---

## Dosya Yapısı

Plan 1'in yapısına eklenenler:

```
core/src/
├─ store/
│  ├─ schema.rs            # DEGISIR: V2 migration eklenir
│  ├─ clients.rs           # YENI: danisan deposu
│  └─ appointments.rs      # YENI: randevu deposu, cakisma, tekrarlayan seri
server/src/
├─ routes/
│  ├─ clients.rs           # YENI
│  └─ appointments.rs      # YENI
├─ guard.rs                # YENI: kilitli oturum korumasi
web/src/
├─ screens/
│  └─ AnaEkran.tsx         # DEGISIR: placeholder yerine takvim
├─ takvim/
│  ├─ HaftalikTakvim.tsx   # YENI: izgara ve gezinme
│  ├─ RandevuBloku.tsx     # YENI: izgaradaki tek randevu
│  ├─ RandevuPaneli.tsx    # YENI: olusturma/duzenleme
│  └─ hafta.ts             # YENI: tarih yardimcilari (saf fonksiyonlar)
e2e/
└─ takvim.spec.ts          # YENI
```

`hafta.ts` bilinçli olarak ayrı bir dosyadır: tarih aritmetiği saf fonksiyonlarla, React'tan bağımsız test edilir. Takvim hatalarının çoğu bu aritmetikte olur ve bileşen testinin içinde aramak zordur.

---

### Task 1: `migrate` çerçevesi ve şema sürüm 2

**Files:**
- Modify: `core/src/store/schema.rs`
- Test: aynı dosyanın test bloğu

**Bu görev iki iş yapıyor.** Şema sürüm 2'yi eklemeden önce `migrate`'in kendisi yeniden
yazılmalı — Plan 1'in son incelemesinden gelen zorunlu madde. Mevcut `migrate` sürümü **yazıyor
ama hiç okumuyor**: tüm betikleri koşulsuz çalıştırıp `schema_version`'ı `CURRENT_VERSION` yapıyor.

- **Sürüm düşürme sessizce veriyi bozar.** Uygulama imzasız olduğu için kullanıcı eski bir `.app`
  geri koyabilir. v3 veritabanı v2 ikilisiyle açıldığında `migrate` hata vermeden sürümü 2'ye
  geri yazar, v3 tabloları ortada kalır ve sonraki hiçbir teşhis doğru olmaz.
- Plan 3 zaten "duplicate column hatasını yut" gibi bir kaçamak planlıyor — kalıp ikinci
  genişletmede çatlıyor.

**Interfaces:**
- Consumes: `store::db::open_encrypted`
- Produces:
  - `pub const CURRENT_VERSION: i64 = 2`
  - `pub fn okunan_surum(conn: &Connection) -> Result<i64, MigrateHatasi>` — `app_meta` yoksa `0`
  - `pub fn migrate(conn: &Connection) -> Result<(), MigrateHatasi>` — mevcut sürümü **okur**,
    yalnızca eksik adımları **sırayla** uygular, hepsini **tek transaction** içinde çalıştırır
  - `pub enum MigrateHatasi { SurumDusuk { veritabani: i64, uygulama: i64 }, BozukSurum(String), Sqlite(rusqlite::Error) }`
    — `veritabani > uygulama` ise açmayı **reddeder** ve sürümü **geri yazmaz**

`migrate`'in dönüş tipi değişiyor; çağıranlar (`server/src/routes/setup.rs` ve
`server/src/routes/session.rs`) buna göre güncellenmeli. İkisi de hatayı zaten kontrol ediyor,
yalnızca hata tipi değişecek.

- [ ] **Step 1: Başarısız testleri yaz**

Önce `migrate` çerçevesinin testleri:

```rust
    #[test]
    fn bos_veritabaninda_okunan_surum_sifir() {
        let dir = tempfile::tempdir().unwrap();
        let c = crate::store::db::open_encrypted(
            &dir.path().join("v.db"),
            &crate::crypto::keyring::generate_data_key(),
        )
        .unwrap();
        assert_eq!(okunan_surum(&c).unwrap(), 0, "app_meta yokken 0 donmeli");
    }

    #[test]
    fn ileri_surumlu_veritabani_reddedilir_ve_surum_geri_yazilmaz() {
        let (_d, c) = baglanti();
        // Kullanici eski bir .app geri koymus: veritabani uygulamadan yeni.
        c.execute(
            "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version','99')
             ON CONFLICT(anahtar) DO UPDATE SET deger=excluded.deger",
            [],
        )
        .unwrap();

        let hata = migrate(&c).unwrap_err();
        assert!(
            matches!(hata, MigrateHatasi::SurumDusuk { veritabani: 99, uygulama: 2 }),
            "ileri surumlu veritabani acilmamali: {hata:?}"
        );

        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham, "99", "reddedilen migrate surumu ASLA geri yazmamali");
    }

    #[test]
    fn sayiya_cevrilemeyen_surum_panik_degil_hata_uretir() {
        let (_d, c) = baglanti();
        c.execute(
            "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version','abc')
             ON CONFLICT(anahtar) DO UPDATE SET deger=excluded.deger",
            [],
        )
        .unwrap();
        assert!(matches!(migrate(&c).unwrap_err(), MigrateHatasi::BozukSurum(_)));
    }

    #[test]
    fn migrate_ucuncu_kez_calistirilabilir() {
        // baglanti() zaten bir kez calistiriyor; iki kez daha.
        let (_d, c) = baglanti();
        migrate(&c).unwrap();
        migrate(&c).unwrap();
    }
```

Sonra şema sürüm 2 testlerini mevcut test bloğuna ekle:

```rust
    #[test]
    fn surum_iki_olarak_kaydedilir() {
        let (_d, c) = baglanti();
        // deger sutunu TEXT'tir; metin okuyup ayristir. Gerekce Plan 1 Gorev 6'da.
        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham.parse::<i64>().unwrap(), 2);
    }

    #[test]
    fn danisan_ve_randevu_tablolari_olusur() {
        let (_d, c) = baglanti();
        for tablo in ["clients", "appointments"] {
            let sayi: i64 = c
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [tablo],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(sayi, 1, "{tablo} tablosu yok");
        }
    }

    #[test]
    fn ucret_alani_tam_sayidir() {
        let (_d, c) = baglanti();
        let tip: String = c
            .query_row(
                "SELECT type FROM pragma_table_info('appointments') WHERE name='ucret'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tip, "INTEGER", "ucret kurus cinsinden tam sayi olmali");
    }

    #[test]
    fn olmayan_danisana_randevu_eklenemez() {
        let (_d, c) = baglanti();
        let sonuc = c.execute(
            "INSERT INTO appointments (client_id, baslangic, bitis, durum, olusturma_zamani, guncelleme_zamani)
             VALUES (999, '2026-09-07T14:00', '2026-09-07T15:00', 'planlandi', 'z', 'z')",
            [],
        );
        assert!(sonuc.is_err(), "yabanci anahtar kisiti calismalı");
    }

    #[test]
    fn v1_veritabani_veri_kaybetmeden_v2ye_yukselir() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = crate::crypto::keyring::generate_data_key();

        // V1 durumunu taklit et: yalnizca V1 tablolari ve surum 1.
        {
            let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
            c.execute_batch(V1).unwrap();
            c.execute(
                "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version','1')
                 ON CONFLICT(anahtar) DO UPDATE SET deger=excluded.deger",
                [],
            )
            .unwrap();
            c.execute(
                "INSERT INTO audit_log (olay_zamani, eylem, varlik, varlik_id, cihaz)
                 VALUES ('2026-09-01T09:00:00Z','giris','session','-','masaustu')",
                [],
            )
            .unwrap();
        }

        let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
        migrate(&c).unwrap();

        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham.parse::<i64>().unwrap(), 2);

        let log_sayisi: i64 = c.query_row("SELECT count(*) FROM audit_log", [], |r| r.get(0)).unwrap();
        assert_eq!(log_sayisi, 1, "yukseltme eski erisim logunu silmemeli");
    }
```

Son test bu görevin varlık sebebidir: kullanıcı Plan 1 sürümünü kurup veri girmiş olabilir; yükseltme onun verisini kaybettiremez.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core schema`
Expected: FAIL — sürüm hâlâ 1, `clients` ve `appointments` yok.

- [ ] **Step 3: Minimum uygulamayı yaz**

`CURRENT_VERSION`'ı 2 yap ve V2 betiğini ekle:

```rust
pub const CURRENT_VERSION: i64 = 2;

const V2: &str = r#"
CREATE TABLE IF NOT EXISTS clients (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    ad_soyad          TEXT NOT NULL,
    telefon           TEXT,
    durum             TEXT NOT NULL DEFAULT 'aktif',
    olusturma_zamani  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_clients_durum ON clients(durum);

CREATE TABLE IF NOT EXISTS appointments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id         INTEGER NOT NULL REFERENCES clients(id),
    baslangic         TEXT NOT NULL,
    bitis             TEXT NOT NULL,
    durum             TEXT NOT NULL DEFAULT 'planlandi',
    ucret             INTEGER,
    odendi            INTEGER NOT NULL DEFAULT 0,
    seri_id           TEXT,
    olusturma_zamani  TEXT NOT NULL,
    guncelleme_zamani TEXT NOT NULL,
    CHECK (durum IN ('planlandi','geldi','gelmedi','iptal')),
    CHECK (bitis > baslangic)
);

CREATE INDEX IF NOT EXISTS ix_app_baslangic ON appointments(baslangic);
CREATE INDEX IF NOT EXISTS ix_app_client ON appointments(client_id);
CREATE INDEX IF NOT EXISTS ix_app_seri ON appointments(seri_id);
"#;

pub fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Migration'lar sirayla ve idempotent uygulanir; her biri IF NOT EXISTS kullanir.
    conn.execute_batch(V1)?;
    conn.execute_batch(V2)?;
    conn.execute(
        "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version', ?1)
         ON CONFLICT(anahtar) DO UPDATE SET deger = excluded.deger",
        [CURRENT_VERSION.to_string()],
    )?;
    Ok(())
}
```

`bitis > baslangic` kontrolü metin karşılaştırmasıyla çalışır çünkü `YYYY-AA-GGTSS:DD` biçimi sözlük sırasında zaman sırasıyla aynıdır. Bu, biçimin sabit olmasının pratik faydasıdır.

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core schema`
Expected: önceki 4 test + yeni 5 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store/schema.rs
git commit -m "feat(veri): sema surum 2 - danisan ve randevu tablolari"
```

---

### Task 2: `audit_log.ayrinti` kapalı bir enum'a dönüşsün

Plan 1'in son incelemesinden gelen zorunlu madde. **Depolardan önce yapılmalı** — Task 3 ve 4
bu alana değer yazacak; `&str` olarak yazılırsa dönüştürme bir daha yapılmaz.

`ayrinti` şu an serbest metin. Kural ("hassas içerik loga girmez") yalnızca doküman yorumunda
yazılı; derleyici zorlamıyor. `audit_log` tetikleyicilerle **silinemez** olduğu için oraya bir kez
yazılan hassas veri hiçbir zaman geri alınamaz — KVKK açısından en kötü hata sınıfı: özel
nitelikli verinin, tasarımı gereği değiştirilemez bir tabloya sızması.

Şu anda **5** çağrı yeri var. Bu plan sonrası ~15, Plan 3 sonrası ~30 olacak.

**Files:**
- Modify: `core/src/store/audit.rs`
- Modify: `server/src/routes/setup.rs`, `server/src/routes/session.rs` (çağrı yerleri)
- Test: `core/src/store/audit.rs` test bloğu

**Interfaces:**
- Produces:
  - `pub enum Ayrinti { IlkKurulum, Arsivlendi, Durum(&'static str), AralikBaslangici(String), SeriSilme { adet: usize, tarihten: String } }`
  - `impl Ayrinti { pub fn metin(&self) -> String }` — veritabanına yazılan dizgi
  - `kaydet` imzası değişir: `ayrinti: Option<Ayrinti>` (eski: `Option<&str>`)
- `Durum` yalnızca `&'static str` kabul eder; çalışma zamanı dizgisi geçirilemez. Bu kasıtlı:
  randevu durumları sabit bir kümedir, kullanıcı verisi değildir.
- `AralikBaslangici` bir tarih damgası taşır, kullanıcı metni değil. **Biçimi doğrulanmalı**;
  doğrulanmayan bir `String` kapali enum'un kapattığı kapıyı yeniden açar.

- [ ] **Step 1: Başarısız testleri yaz**

```rust
    #[test]
    fn her_varyant_beklenen_metni_uretir() {
        assert_eq!(Ayrinti::IlkKurulum.metin(), "ilk kurulum");
        assert_eq!(Ayrinti::Arsivlendi.metin(), "arsivlendi");
        assert_eq!(Ayrinti::Durum("geldi").metin(), "durum: geldi");
        assert_eq!(
            Ayrinti::AralikBaslangici("2026-09-07T00:00".into()).metin(),
            "aralik: 2026-09-07T00:00"
        );
        assert_eq!(
            Ayrinti::SeriSilme { adet: 3, tarihten: "2026-09-21T00:00".into() }.metin(),
            "seri silme: 3 kayit, 2026-09-21T00:00 sonrasi"
        );
    }

    #[test]
    fn aralik_baslangici_bozuk_tarihi_reddeder() {
        // Dogrulanmayan bir String, kapali enum'un kapattigi kapiyi yeniden acar.
        let bozuk = Ayrinti::AralikBaslangici("COK_GIZLI_SEANS_NOTU".into());
        assert_eq!(bozuk.metin(), "aralik: gecersiz", "dogrulanmayan metin loga gecmemeli");
    }

    #[test]
    fn seri_silme_tarihi_de_dogrulanir() {
        let bozuk = Ayrinti::SeriSilme { adet: 1, tarihten: "COK_GIZLI".into() };
        assert!(!bozuk.metin().contains("COK_GIZLI"));
    }

    #[test]
    fn ayrintili_kayit_geri_okunur() {
        let (_d, c) = baglanti();
        kaydet(&c, Eylem::Duzenleme, "client", "7", Cihaz::Masaustu, Some(Ayrinti::Arsivlendi))
            .unwrap();
        assert_eq!(son_kayitlar(&c, 1).unwrap()[0].ayrinti.as_deref(), Some("arsivlendi"));
    }

    #[test]
    fn ayrintisiz_kayit_null_saklar() {
        let (_d, c) = baglanti();
        kaydet(&c, Eylem::Giris, "session", "-", Cihaz::Masaustu, None).unwrap();
        assert_eq!(son_kayitlar(&c, 1).unwrap()[0].ayrinti, None);
    }
```

İkinci ve üçüncü testler bu görevin can damarı: enum'un varlığı tek başına yetmez, `String`
taşıyan varyantlar doğrulanmazsa serbest metin arka kapıdan geri gelir.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core audit`
Expected: derleme hatası — `Ayrinti` tanımlı değil.

- [ ] **Step 3: Minimum uygulamayı yaz**

`Ayrinti` enum'unu ve `metin()`'i yaz. `String` taşıyan varyantlardaki dizgileri
`YYYY-AA-GGTSS:DD` biçimine karşı doğrula (Plan 1'deki `zaman_gecerli_mi` deseni); uymuyorsa
`gecersiz` yaz, ham metni **asla** loga geçirme. `kaydet` imzasını `Option<Ayrinti>` yap.

Modül başlığındaki "hassas içerik loga yazılmaz" uyarısını güncelle: kural artık **yapısal olarak**
uygulanıyor; yeni bir varyant eklerken doğrulanmamış serbest metin taşımamasına dikkat edilmeli.

Plan 1'den gelen çağrı yerlerini güncelle: `setup.rs` içindeki `Some("ilk kurulum")` →
`Some(Ayrinti::IlkKurulum)`, diğerleri `None` olarak kalır.

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test --workspace`
Expected: tüm testler PASS (Plan 1'in 83 testi + yeni 5 test).

- [ ] **Step 5: Commit**

```bash
git add core/src/store/audit.rs server/src/routes
git commit -m "feat(veri): erisim logu ayrinti alani kapali enum'a donustu"
```

---

### Task 3: Danışan deposu

Bu planda danışan kaydı **asgari** tutulur: ad soyad, telefon, durum. Rıza takibi, ekli dosyalar, saklama süresi ve seans geçmişi Plan 3'te aynı tabloya sütun eklenerek gelir. Takvim, danışan olmadan çalışamayacağı için asgari hâli buraya alındı.

**Files:**
- Create: `core/src/store/clients.rs`
- Modify: `core/src/store/mod.rs` (`pub mod clients;`)
- Test: `core/src/store/clients.rs` test bloğu

**Interfaces:**
- Consumes: `store::audit::{kaydet, Eylem, Cihaz}`
- Produces:
  - `pub struct Danisan { pub id: i64, pub ad_soyad: String, pub telefon: Option<String>, pub durum: String }` (Serialize)
  - `pub struct YeniDanisan { pub ad_soyad: String, pub telefon: Option<String> }` (Deserialize)
  - `pub fn ekle(conn: &Connection, yeni: &YeniDanisan, cihaz: Cihaz) -> Result<Danisan, DepoHatasi>`
  - `pub fn listele(conn: &Connection, arsiv_dahil: bool, cihaz: Cihaz) -> Result<Vec<Danisan>, DepoHatasi>`
  - `pub fn getir(conn: &Connection, id: i64, cihaz: Cihaz) -> Result<Danisan, DepoHatasi>`
  - `pub fn arsivle(conn: &Connection, id: i64, cihaz: Cihaz) -> Result<(), DepoHatasi>`
  - `pub enum DepoHatasi { Bulunamadi, GecersizVeri(String), Sqlite(rusqlite::Error) }`

- [ ] **Step 1: Başarısız testleri yaz**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{audit::son_kayitlar, db::open_encrypted, schema::migrate};

    fn baglanti() -> (tempfile::TempDir, rusqlite::Connection) {
        let dir = tempfile::tempdir().unwrap();
        let c = open_encrypted(&dir.path().join("v.db"), &generate_data_key()).unwrap();
        migrate(&c).unwrap();
        (dir, c)
    }

    fn yeni(ad: &str) -> YeniDanisan {
        YeniDanisan { ad_soyad: ad.to_string(), telefon: None }
    }

    #[test]
    fn eklenen_danisan_geri_okunur() {
        let (_d, c) = baglanti();
        let eklenen = ekle(&c, &yeni("Ayse Yilmaz"), Cihaz::Masaustu).unwrap();
        assert!(eklenen.id > 0);
        assert_eq!(eklenen.durum, "aktif");

        let okunan = getir(&c, eklenen.id, Cihaz::Masaustu).unwrap();
        assert_eq!(okunan.ad_soyad, "Ayse Yilmaz");
    }

    #[test]
    fn bos_ad_reddedilir() {
        let (_d, c) = baglanti();
        let hata = ekle(&c, &yeni("   "), Cihaz::Masaustu).unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn olmayan_danisan_bulunamadi_dondurur() {
        let (_d, c) = baglanti();
        assert!(matches!(getir(&c, 999, Cihaz::Masaustu).unwrap_err(), DepoHatasi::Bulunamadi));
    }

    #[test]
    fn arsivlenen_danisan_varsayilan_listede_gorunmez() {
        let (_d, c) = baglanti();
        let a = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        ekle(&c, &yeni("Mehmet"), Cihaz::Masaustu).unwrap();

        arsivle(&c, a.id, Cihaz::Masaustu).unwrap();

        let aktifler = listele(&c, false, Cihaz::Masaustu).unwrap();
        assert_eq!(aktifler.len(), 1);
        assert_eq!(aktifler[0].ad_soyad, "Mehmet");

        let hepsi = listele(&c, true, Cihaz::Masaustu).unwrap();
        assert_eq!(hepsi.len(), 2);
    }

    #[test]
    fn liste_ada_gore_siralanir() {
        let (_d, c) = baglanti();
        ekle(&c, &yeni("Zeynep"), Cihaz::Masaustu).unwrap();
        ekle(&c, &yeni("Ahmet"), Cihaz::Masaustu).unwrap();
        let liste = listele(&c, false, Cihaz::Masaustu).unwrap();
        assert_eq!(liste[0].ad_soyad, "Ahmet");
    }

    #[test]
    fn ekleme_ve_goruntuleme_erisim_loguna_yazilir() {
        let (_d, c) = baglanti();
        let e = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        getir(&c, e.id, Cihaz::Masaustu).unwrap();

        let eylemler: Vec<String> =
            son_kayitlar(&c, 10).unwrap().into_iter().map(|k| k.eylem).collect();
        assert!(eylemler.contains(&"ekleme".to_string()));
        assert!(eylemler.contains(&"goruntuleme".to_string()));
    }

    #[test]
    fn liste_sorgusu_tek_log_kaydi_uretir() {
        let (_d, c) = baglanti();
        ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        ekle(&c, &yeni("Mehmet"), Cihaz::Masaustu).unwrap();

        let once = son_kayitlar(&c, 100).unwrap().len();
        listele(&c, false, Cihaz::Masaustu).unwrap();
        let sonra = son_kayitlar(&c, 100).unwrap().len();
        assert_eq!(sonra - once, 1, "liste, satir basina log uretmemeli");
    }
}
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core clients`
Expected: derleme hatası.

- [ ] **Step 3: Minimum uygulamayı yaz**

```rust
use crate::store::audit::{kaydet, Cihaz, Eylem};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Debug, thiserror::Error)]
pub enum DepoHatasi {
    #[error("kayit bulunamadi")]
    Bulunamadi,
    #[error("gecersiz veri: {0}")]
    GecersizVeri(String),
    #[error("veritabani hatasi: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

#[derive(Debug, Clone, Serialize)]
pub struct Danisan {
    pub id: i64,
    pub ad_soyad: String,
    pub telefon: Option<String>,
    pub durum: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct YeniDanisan {
    pub ad_soyad: String,
    pub telefon: Option<String>,
}

fn simdi() -> String {
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .expect("nanosaniye sifirlanamadi")
        .format(&Rfc3339)
        .expect("zaman bicimlendirilemedi")
}

fn satirdan(r: &rusqlite::Row) -> Result<Danisan, rusqlite::Error> {
    Ok(Danisan { id: r.get(0)?, ad_soyad: r.get(1)?, telefon: r.get(2)?, durum: r.get(3)? })
}

pub fn ekle(conn: &Connection, yeni: &YeniDanisan, cihaz: Cihaz) -> Result<Danisan, DepoHatasi> {
    let ad = yeni.ad_soyad.trim();
    if ad.is_empty() {
        return Err(DepoHatasi::GecersizVeri("Danışan adı boş olamaz.".into()));
    }

    conn.execute(
        "INSERT INTO clients (ad_soyad, telefon, durum, olusturma_zamani)
         VALUES (?1, ?2, 'aktif', ?3)",
        rusqlite::params![ad, yeni.telefon, simdi()],
    )?;
    let id = conn.last_insert_rowid();
    kaydet(conn, Eylem::Ekleme, "client", &id.to_string(), cihaz, None)?;

    Ok(Danisan { id, ad_soyad: ad.to_string(), telefon: yeni.telefon.clone(), durum: "aktif".into() })
}

pub fn getir(conn: &Connection, id: i64, cihaz: Cihaz) -> Result<Danisan, DepoHatasi> {
    let danisan = conn
        .query_row(
            "SELECT id, ad_soyad, telefon, durum FROM clients WHERE id = ?1",
            [id],
            |r| satirdan(r),
        )
        .optional()?
        .ok_or(DepoHatasi::Bulunamadi)?;

    kaydet(conn, Eylem::Goruntuleme, "client", &id.to_string(), cihaz, None)?;
    Ok(danisan)
}

pub fn listele(
    conn: &Connection,
    arsiv_dahil: bool,
    cihaz: Cihaz,
) -> Result<Vec<Danisan>, DepoHatasi> {
    let mut stmt = conn.prepare(
        "SELECT id, ad_soyad, telefon, durum FROM clients
         WHERE (?1 = 1 OR durum = 'aktif')
         ORDER BY ad_soyad COLLATE NOCASE",
    )?;
    let liste = stmt
        .query_map([arsiv_dahil as i64], |r| satirdan(r))?
        .collect::<Result<Vec<_>, _>>()?;

    // Liste tek bir goruntuleme kaydi uretir, satir basina degil.
    kaydet(conn, Eylem::Goruntuleme, "client", "liste", cihaz, None)?;
    Ok(liste)
}

pub fn arsivle(conn: &Connection, id: i64, cihaz: Cihaz) -> Result<(), DepoHatasi> {
    let etkilenen = conn.execute("UPDATE clients SET durum='arsiv' WHERE id = ?1", [id])?;
    if etkilenen == 0 {
        return Err(DepoHatasi::Bulunamadi);
    }
    kaydet(conn, Eylem::Duzenleme, "client", &id.to_string(), cihaz, Some("arsivlendi"))?;
    Ok(())
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core clients`
Expected: 7 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store/clients.rs core/src/store/mod.rs
git commit -m "feat(veri): asgari danisan deposu"
```

---

### Task 4: Randevu deposu — oluşturma, aralık sorgusu, durum güncelleme

**Files:**
- Create: `core/src/store/appointments.rs`
- Modify: `core/src/store/mod.rs` (`pub mod appointments;`)
- Test: `core/src/store/appointments.rs` test bloğu

**Interfaces:**
- Consumes: `store::clients::DepoHatasi`, `store::audit::{kaydet, Eylem, Cihaz}`
- Produces:
  - `pub struct Randevu { pub id: i64, pub client_id: i64, pub danisan_adi: String, pub baslangic: String, pub bitis: String, pub durum: String, pub ucret: Option<i64>, pub odendi: bool, pub seri_id: Option<String> }` (Serialize)
  - `pub struct YeniRandevu { pub client_id: i64, pub baslangic: String, pub bitis: String, pub ucret: Option<i64> }` (Deserialize)
  - `pub fn olustur(conn: &Connection, yeni: &YeniRandevu, cihaz: Cihaz) -> Result<Randevu, DepoHatasi>`
  - `pub fn aralik_getir(conn: &Connection, baslangic: &str, bitis: &str, cihaz: Cihaz) -> Result<Vec<Randevu>, DepoHatasi>` — `baslangic` dahil, `bitis` hariç
  - `pub fn durum_guncelle(conn: &Connection, id: i64, durum: &str, cihaz: Cihaz) -> Result<(), DepoHatasi>`
  - `pub fn sil(conn: &Connection, id: i64, cihaz: Cihaz) -> Result<(), DepoHatasi>`
  - `pub const GECERLI_DURUMLAR: [&str; 4] = ["planlandi", "geldi", "gelmedi", "iptal"]`

- [ ] **Step 1: Başarısız testleri yaz**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{
        clients::{ekle as danisan_ekle, YeniDanisan},
        db::open_encrypted,
        schema::migrate,
    };

    fn kurulum() -> (tempfile::TempDir, rusqlite::Connection, i64) {
        let dir = tempfile::tempdir().unwrap();
        let c = open_encrypted(&dir.path().join("v.db"), &generate_data_key()).unwrap();
        migrate(&c).unwrap();
        let d = danisan_ekle(
            &c,
            &YeniDanisan { ad_soyad: "Ayse Yilmaz".into(), telefon: None },
            Cihaz::Masaustu,
        )
        .unwrap();
        (dir, c, d.id)
    }

    fn yeni(client_id: i64, baslangic: &str, bitis: &str) -> YeniRandevu {
        YeniRandevu {
            client_id,
            baslangic: baslangic.into(),
            bitis: bitis.into(),
            ucret: Some(45000),
        }
    }

    #[test]
    fn olusturulan_randevu_danisan_adiyla_birlikte_doner() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        assert_eq!(r.durum, "planlandi");
        assert_eq!(r.danisan_adi, "Ayse Yilmaz");
        assert_eq!(r.ucret, Some(45000));
        assert!(!r.odendi);
    }

    #[test]
    fn bitis_baslangictan_once_olamaz() {
        let (_d, c, cid) = kurulum();
        let hata = olustur(&c, &yeni(cid, "2026-09-07T15:00", "2026-09-07T14:00"), Cihaz::Masaustu)
            .unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn bozuk_tarih_bicimi_reddedilir() {
        let (_d, c, cid) = kurulum();
        let hata =
            olustur(&c, &yeni(cid, "07.09.2026 14:00", "07.09.2026 15:00"), Cihaz::Masaustu)
                .unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn aralik_sorgusu_baslangici_dahil_bitisi_haric_alir() {
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T09:00", "2026-09-07T10:00"), Cihaz::Masaustu).unwrap();
        olustur(&c, &yeni(cid, "2026-09-14T09:00", "2026-09-14T10:00"), Cihaz::Masaustu).unwrap();

        let hafta = aralik_getir(&c, "2026-09-07T00:00", "2026-09-14T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(hafta.len(), 1, "sonraki haftanin randevusu girmemeli");
        assert_eq!(hafta[0].baslangic, "2026-09-07T09:00");
    }

    #[test]
    fn aralik_sonuclari_zamana_gore_siralanir() {
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T16:00", "2026-09-07T17:00"), Cihaz::Masaustu).unwrap();
        olustur(&c, &yeni(cid, "2026-09-07T09:00", "2026-09-07T10:00"), Cihaz::Masaustu).unwrap();

        let liste = aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(liste[0].baslangic, "2026-09-07T09:00");
    }

    #[test]
    fn durum_guncellenir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        durum_guncelle(&c, r.id, "geldi", Cihaz::Masaustu).unwrap();

        let liste = aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(liste[0].durum, "geldi");
    }

    #[test]
    fn gecersiz_durum_reddedilir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        let hata = durum_guncelle(&c, r.id, "belki_gelir", Cihaz::Masaustu).unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn silinen_randevu_listede_cikmaz_ve_loglanir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        sil(&c, r.id, Cihaz::Masaustu).unwrap();

        let liste = aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
        assert!(liste.is_empty());

        let eylemler: Vec<String> = crate::store::audit::son_kayitlar(&c, 10)
            .unwrap()
            .into_iter()
            .map(|k| k.eylem)
            .collect();
        assert!(eylemler.contains(&"silme".to_string()));
    }
}
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core appointments`
Expected: derleme hatası.

- [ ] **Step 3: Minimum uygulamayı yaz**

```rust
use crate::store::audit::{kaydet, Cihaz, Eylem};
use crate::store::clients::DepoHatasi;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

pub const GECERLI_DURUMLAR: [&str; 4] = ["planlandi", "geldi", "gelmedi", "iptal"];

#[derive(Debug, Clone, Serialize)]
pub struct Randevu {
    pub id: i64,
    pub client_id: i64,
    pub danisan_adi: String,
    pub baslangic: String,
    pub bitis: String,
    pub durum: String,
    pub ucret: Option<i64>,
    pub odendi: bool,
    pub seri_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct YeniRandevu {
    pub client_id: i64,
    pub baslangic: String,
    pub bitis: String,
    pub ucret: Option<i64>,
}

/// Beklenen bicim: YYYY-AA-GGTSS:DD (yerel duvar saati, zaman dilimi yok).
pub fn zaman_gecerli_mi(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 16
        && b[4] == b'-'
        && b[7] == b'-'
        && b[10] == b'T'
        && b[13] == b':'
        && b.iter().enumerate().all(|(i, c)| {
            matches!(i, 4 | 7 | 10 | 13) || c.is_ascii_digit()
        })
}

fn simdi() -> String {
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .expect("nanosaniye sifirlanamadi")
        .format(&Rfc3339)
        .expect("zaman bicimlendirilemedi")
}

const SECIM: &str = "SELECT a.id, a.client_id, c.ad_soyad, a.baslangic, a.bitis, a.durum,
                            a.ucret, a.odendi, a.seri_id
                     FROM appointments a JOIN clients c ON c.id = a.client_id";

fn satirdan(r: &rusqlite::Row) -> Result<Randevu, rusqlite::Error> {
    Ok(Randevu {
        id: r.get(0)?,
        client_id: r.get(1)?,
        danisan_adi: r.get(2)?,
        baslangic: r.get(3)?,
        bitis: r.get(4)?,
        durum: r.get(5)?,
        ucret: r.get(6)?,
        odendi: r.get::<_, i64>(7)? != 0,
        seri_id: r.get(8)?,
    })
}

pub fn olustur(
    conn: &Connection,
    yeni: &YeniRandevu,
    cihaz: Cihaz,
) -> Result<Randevu, DepoHatasi> {
    if !zaman_gecerli_mi(&yeni.baslangic) || !zaman_gecerli_mi(&yeni.bitis) {
        return Err(DepoHatasi::GecersizVeri(
            "Tarih biçimi YYYY-AA-GGTSS:DD olmalı.".into(),
        ));
    }
    if yeni.bitis <= yeni.baslangic {
        return Err(DepoHatasi::GecersizVeri(
            "Randevu bitişi başlangıcından sonra olmalı.".into(),
        ));
    }
    if yeni.ucret.is_some_and(|u| u < 0) {
        return Err(DepoHatasi::GecersizVeri("Ücret negatif olamaz.".into()));
    }

    let z = simdi();
    conn.execute(
        "INSERT INTO appointments
           (client_id, baslangic, bitis, durum, ucret, odendi, olusturma_zamani, guncelleme_zamani)
         VALUES (?1, ?2, ?3, 'planlandi', ?4, 0, ?5, ?5)",
        rusqlite::params![yeni.client_id, yeni.baslangic, yeni.bitis, yeni.ucret, z],
    )?;
    let id = conn.last_insert_rowid();
    kaydet(conn, Eylem::Ekleme, "appointment", &id.to_string(), cihaz, None)?;

    let randevu = conn.query_row(&format!("{SECIM} WHERE a.id = ?1"), [id], |r| satirdan(r))?;
    Ok(randevu)
}

pub fn aralik_getir(
    conn: &Connection,
    baslangic: &str,
    bitis: &str,
    cihaz: Cihaz,
) -> Result<Vec<Randevu>, DepoHatasi> {
    let mut stmt =
        conn.prepare(&format!("{SECIM} WHERE a.baslangic >= ?1 AND a.baslangic < ?2 ORDER BY a.baslangic"))?;
    let liste = stmt
        .query_map([baslangic, bitis], |r| satirdan(r))?
        .collect::<Result<Vec<_>, _>>()?;

    kaydet(conn, Eylem::Goruntuleme, "appointment", "liste", cihaz, Some(baslangic))?;
    Ok(liste)
}

pub fn durum_guncelle(
    conn: &Connection,
    id: i64,
    durum: &str,
    cihaz: Cihaz,
) -> Result<(), DepoHatasi> {
    if !GECERLI_DURUMLAR.contains(&durum) {
        return Err(DepoHatasi::GecersizVeri(format!("Geçersiz randevu durumu: {durum}")));
    }
    let etkilenen = conn.execute(
        "UPDATE appointments SET durum = ?1, guncelleme_zamani = ?2 WHERE id = ?3",
        rusqlite::params![durum, simdi(), id],
    )?;
    if etkilenen == 0 {
        return Err(DepoHatasi::Bulunamadi);
    }
    kaydet(conn, Eylem::Duzenleme, "appointment", &id.to_string(), cihaz, Some(durum))?;
    Ok(())
}

pub fn sil(conn: &Connection, id: i64, cihaz: Cihaz) -> Result<(), DepoHatasi> {
    let etkilenen = conn.execute("DELETE FROM appointments WHERE id = ?1", [id])?;
    if etkilenen == 0 {
        return Err(DepoHatasi::Bulunamadi);
    }
    kaydet(conn, Eylem::Silme, "appointment", &id.to_string(), cihaz, None)?;
    Ok(())
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core appointments`
Expected: 8 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store/appointments.rs core/src/store/mod.rs
git commit -m "feat(veri): randevu deposu - olusturma, aralik sorgusu, durum"
```

---

### Task 5: Çakışma kontrolü

Aynı saate iki danışan yazmak, bu tür uygulamalarda en sık yapılan hatadır. Çakışma **engellenmez, uyarılır** — terapist bilerek üst üste randevu koyabilir (örneğin çift seansı) ve yazılımın onu durdurması hakaret olur.

**Files:**
- Modify: `core/src/store/appointments.rs`
- Test: aynı dosyanın test bloğu

**Interfaces:**
- Consumes: Task 3'ün tipleri
- Produces:
  - `pub fn cakisanlari_bul(conn: &Connection, baslangic: &str, bitis: &str, haric_id: Option<i64>) -> Result<Vec<Randevu>, DepoHatasi>` — `iptal` durumundakiler sayılmaz, `haric_id` verilen kayıt kendisiyle karşılaştırılmaz

- [ ] **Step 1: Başarısız testleri yaz**

```rust
    #[test]
    fn ust_uste_binen_randevu_bulunur() {
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();

        let cakisanlar =
            cakisanlari_bul(&c, "2026-09-07T14:30", "2026-09-07T15:30", None).unwrap();
        assert_eq!(cakisanlar.len(), 1);
    }

    #[test]
    fn bitisik_randevular_cakismaz() {
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();

        let cakisanlar =
            cakisanlari_bul(&c, "2026-09-07T15:00", "2026-09-07T16:00", None).unwrap();
        assert!(cakisanlar.is_empty(), "14-15 ile 15-16 cakismaz");
    }

    #[test]
    fn tamamen_kapsayan_randevu_cakisir() {
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();

        let cakisanlar =
            cakisanlari_bul(&c, "2026-09-07T13:00", "2026-09-07T17:00", None).unwrap();
        assert_eq!(cakisanlar.len(), 1);
    }

    #[test]
    fn iptal_edilmis_randevu_cakisma_saymaz() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();
        durum_guncelle(&c, r.id, "iptal", Cihaz::Masaustu).unwrap();

        let cakisanlar =
            cakisanlari_bul(&c, "2026-09-07T14:00", "2026-09-07T15:00", None).unwrap();
        assert!(cakisanlar.is_empty());
    }

    #[test]
    fn randevu_kendisiyle_cakismaz() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu)
            .unwrap();

        let cakisanlar =
            cakisanlari_bul(&c, "2026-09-07T14:00", "2026-09-07T15:00", Some(r.id)).unwrap();
        assert!(cakisanlar.is_empty(), "duzenlenen randevu kendini cakisma saymamalı");
    }

    #[test]
    fn baska_gunun_randevusu_cakismaz() {
        let (_d, c, cid) = kurulum();
        olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();

        let cakisanlar =
            cakisanlari_bul(&c, "2026-09-08T14:00", "2026-09-08T15:00", None).unwrap();
        assert!(cakisanlar.is_empty());
    }
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core appointments::tests::cakis`
Expected: derleme hatası — `cakisanlari_bul` yok.

- [ ] **Step 3: Minimum uygulamayı yaz**

```rust
pub fn cakisanlari_bul(
    conn: &Connection,
    baslangic: &str,
    bitis: &str,
    haric_id: Option<i64>,
) -> Result<Vec<Randevu>, DepoHatasi> {
    // Iki aralik cakisir ancak ve ancak: a.baslangic < yeni.bitis VE a.bitis > yeni.baslangic.
    // Bitisik araliklar (14-15 ile 15-16) bu kurala gore cakismaz.
    let mut stmt = conn.prepare(&format!(
        "{SECIM}
         WHERE a.durum != 'iptal'
           AND a.baslangic < ?1
           AND a.bitis > ?2
           AND (?3 IS NULL OR a.id != ?3)
         ORDER BY a.baslangic"
    ))?;
    let liste = stmt
        .query_map(rusqlite::params![bitis, baslangic, haric_id], |r| satirdan(r))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(liste)
}
```

Çakışma sorgusu erişim logu yazmaz: kullanıcının görmediği, form doğrulaması sırasında çalışan bir kontroldür ve her tuş vuruşunda log üretmesi logu kullanılamaz hâle getirir. Kullanıcı çakışan randevuyu ekranda gördüğünde zaten `aralik_getir` kaydı düşmüş olur.

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core appointments`
Expected: önceki 8 + yeni 6 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store/appointments.rs
git commit -m "feat(veri): randevu cakisma kontrolu"
```

---

### Task 6: Tekrarlayan randevu serisi

Terapide randevular tipik olarak "her hafta aynı saat" gider. Seri, **oluşturulurken tek tek kayıtlara açılır** (materialize edilir), kural olarak saklanmaz. Gerekçe: tek bir haftayı iptal etmek, saatini kaydırmak veya ücretini değiştirmek kural tabanlı bir modelde istisna yönetimi gerektirir; ayrı kayıtlarda bu işlemler zaten çalışır. Bedeli, sonsuz seri kurulamamasıdır — ki bir terapi süreci zaten sonsuz değildir.

**Files:**
- Modify: `core/src/store/appointments.rs`
- Test: aynı dosyanın test bloğu

**Interfaces:**
- Consumes: Task 3 ve 4'ün tipleri
- Produces:
  - `pub const AZAMI_TEKRAR: u32 = 52`
  - `pub fn seri_olustur(conn: &Connection, yeni: &YeniRandevu, tekrar_sayisi: u32, cihaz: Cihaz) -> Result<Vec<Randevu>, DepoHatasi>` — ilk randevu dahil `tekrar_sayisi` adet kayıt, haftalık aralıkla, ortak `seri_id`
  - `pub fn seriyi_sil(conn: &Connection, seri_id: &str, bu_tarihten_itibaren: &str, cihaz: Cihaz) -> Result<usize, DepoHatasi>`
  - `pub fn bir_hafta_sonra(zaman: &str) -> Result<String, DepoHatasi>` — duvar saatini koruyarak 7 gün ekler

- [ ] **Step 1: Başarısız testleri yaz**

```rust
    #[test]
    fn bir_hafta_sonra_ayni_saati_korur() {
        assert_eq!(bir_hafta_sonra("2026-09-07T14:00").unwrap(), "2026-09-14T14:00");
    }

    #[test]
    fn bir_hafta_sonra_ay_sinirini_gecer() {
        assert_eq!(bir_hafta_sonra("2026-09-28T14:00").unwrap(), "2026-10-05T14:00");
    }

    #[test]
    fn bir_hafta_sonra_yil_sinirini_gecer() {
        assert_eq!(bir_hafta_sonra("2026-12-29T09:30").unwrap(), "2027-01-05T09:30");
    }

    #[test]
    fn seri_haftalik_kayitlar_uretir() {
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            4,
            Cihaz::Masaustu,
        )
        .unwrap();

        assert_eq!(seri.len(), 4);
        assert_eq!(seri[0].baslangic, "2026-09-07T14:00");
        assert_eq!(seri[3].baslangic, "2026-09-28T14:00");
        assert_eq!(seri[3].bitis, "2026-09-28T15:00");
    }

    #[test]
    fn seri_uyeleri_ayni_seri_idyi_paylasir() {
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            3,
            Cihaz::Masaustu,
        )
        .unwrap();

        let id = seri[0].seri_id.clone().expect("seri_id atanmali");
        assert!(seri.iter().all(|r| r.seri_id.as_deref() == Some(id.as_str())));
    }

    #[test]
    fn azami_tekrar_asilamaz() {
        let (_d, c, cid) = kurulum();
        let hata = seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            AZAMI_TEKRAR + 1,
            Cihaz::Masaustu,
        )
        .unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn sifir_tekrar_reddedilir() {
        let (_d, c, cid) = kurulum();
        assert!(seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            0,
            Cihaz::Masaustu
        )
        .is_err());
    }

    #[test]
    fn seri_silme_yalnizca_verilen_tarihten_sonrasini_siler() {
        let (_d, c, cid) = kurulum();
        let seri = seri_olustur(
            &c,
            &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"),
            4,
            Cihaz::Masaustu,
        )
        .unwrap();
        let sid = seri[0].seri_id.clone().unwrap();

        let silinen = seriyi_sil(&c, &sid, "2026-09-21T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(silinen, 2, "21 ve 28 Eylul silinmeli");

        let kalan =
            aralik_getir(&c, "2026-09-01T00:00", "2026-10-01T00:00", Cihaz::Masaustu).unwrap();
        assert_eq!(kalan.len(), 2, "gecmis randevular korunmalı");
    }
```

Son test ürün açısından önemli: "bu seriyi iptal et" dendiğinde geçmiş seansların silinmesi, yapılmış işin kaydını yok eder.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core appointments`
Expected: derleme hatası.

- [ ] **Step 3: Minimum uygulamayı yaz**

`core/Cargo.toml`'a `uuid = { version = "1", features = ["v4"] }` ekle.

```rust
use time::{Date, Month};

pub const AZAMI_TEKRAR: u32 = 52;

pub fn bir_hafta_sonra(zaman: &str) -> Result<String, DepoHatasi> {
    if !zaman_gecerli_mi(zaman) {
        return Err(DepoHatasi::GecersizVeri("Tarih biçimi hatalı.".into()));
    }
    let hata = || DepoHatasi::GecersizVeri("Tarih çözümlenemedi.".into());

    let yil: i32 = zaman[0..4].parse().map_err(|_| hata())?;
    let ay: u8 = zaman[5..7].parse().map_err(|_| hata())?;
    let gun: u8 = zaman[8..10].parse().map_err(|_| hata())?;
    let saat_kismi = &zaman[10..]; // "T14:00"

    let ay = Month::try_from(ay).map_err(|_| hata())?;
    let tarih = Date::from_calendar_date(yil, ay, gun).map_err(|_| hata())?;
    let sonraki = tarih.saturating_add(time::Duration::days(7));

    Ok(format!(
        "{:04}-{:02}-{:02}{}",
        sonraki.year(),
        sonraki.month() as u8,
        sonraki.day(),
        saat_kismi
    ))
}

pub fn seri_olustur(
    conn: &Connection,
    yeni: &YeniRandevu,
    tekrar_sayisi: u32,
    cihaz: Cihaz,
) -> Result<Vec<Randevu>, DepoHatasi> {
    if tekrar_sayisi == 0 || tekrar_sayisi > AZAMI_TEKRAR {
        return Err(DepoHatasi::GecersizVeri(format!(
            "Tekrar sayısı 1 ile {AZAMI_TEKRAR} arasında olmalı."
        )));
    }

    let seri_id = uuid::Uuid::new_v4().to_string();
    let mut baslangic = yeni.baslangic.clone();
    let mut bitis = yeni.bitis.clone();
    let mut uretilenler = Vec::with_capacity(tekrar_sayisi as usize);

    for _ in 0..tekrar_sayisi {
        let tekil = YeniRandevu {
            client_id: yeni.client_id,
            baslangic: baslangic.clone(),
            bitis: bitis.clone(),
            ucret: yeni.ucret,
        };
        let mut randevu = olustur(conn, &tekil, cihaz)?;

        conn.execute("UPDATE appointments SET seri_id = ?1 WHERE id = ?2",
            rusqlite::params![seri_id, randevu.id])?;
        randevu.seri_id = Some(seri_id.clone());
        uretilenler.push(randevu);

        baslangic = bir_hafta_sonra(&baslangic)?;
        bitis = bir_hafta_sonra(&bitis)?;
    }

    Ok(uretilenler)
}

pub fn seriyi_sil(
    conn: &Connection,
    seri_id: &str,
    bu_tarihten_itibaren: &str,
    cihaz: Cihaz,
) -> Result<usize, DepoHatasi> {
    let silinen = conn.execute(
        "DELETE FROM appointments WHERE seri_id = ?1 AND baslangic >= ?2",
        rusqlite::params![seri_id, bu_tarihten_itibaren],
    )?;
    kaydet(
        conn,
        Eylem::Silme,
        "appointment_seri",
        seri_id,
        cihaz,
        Some(&format!("{silinen} kayit, {bu_tarihten_itibaren} sonrasi")),
    )?;
    Ok(silinen)
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core appointments`
Expected: önceki 14 + yeni 8 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store/appointments.rs core/Cargo.toml
git commit -m "feat(veri): haftalik tekrarlayan randevu serisi"
```

---

### Task 7: HTTP API ve kilit koruması

**Files:**
- Create: `server/src/guard.rs`, `server/src/routes/clients.rs`, `server/src/routes/appointments.rs`
- Modify: `server/src/lib.rs`, `server/src/routes/mod.rs`
- Test: `server/tests/takvim_api.rs`

**Interfaces:**
- Consumes: `AppState`, `core::store::{clients, appointments}`
- Produces:
  - `pub fn acik_baglanti(state: &AppState) -> Result<Connection, (StatusCode, Json<Value>)>` — oturum kilitliyse `401`
  - Uç noktalar:
    - `GET    /api/danisanlar` → `[Danisan]`
    - `POST   /api/danisanlar` `{ad_soyad, telefon?}` → `201 Danisan`
    - `GET    /api/randevular?baslangic=&bitis=` → `[Randevu]`
    - `POST   /api/randevular` `{client_id, baslangic, bitis, ucret?, tekrar_sayisi?}` → `201 [Randevu]`
    - `PATCH  /api/randevular/:id` `{durum}` → `200 {}`
    - `DELETE /api/randevular/:id` → `200 {}`
    - `GET    /api/cakisma?baslangic=&bitis=&haric_id=` → `[Randevu]`

- [ ] **Step 1: Başarısız testleri yaz**

`server/tests/takvim_api.rs` — Plan 1'in `server/tests/api.rs` dosyasındaki `cagir` yardımcısını buraya kopyala (ayrı test ikilisi, paylaşılan modül kurmaya değmez), sonra:

```rust
async fn kurulu_state() -> (tempfile::TempDir, AppState) {
    let (dir, state) = test_state();
    cagir(&state, "POST", "/api/kurulum", Some(json!({"parola":"gizliparola"}))).await;
    (dir, state)
}

#[tokio::test]
async fn kilitliyken_danisan_listesi_401_doner() {
    let (_d, s) = kurulu_state().await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json.get("danisanlar").is_none(), "kilitliyken veri sizmamalı");
}

#[tokio::test]
async fn kilitliyken_randevu_listesi_401_doner() {
    let (_d, s) = kurulu_state().await;
    cagir(&s, "POST", "/api/kilitle", None).await;
    let (kod, _) =
        cagir(&s, "GET", "/api/randevular?baslangic=2026-09-07T00:00&bitis=2026-09-14T00:00", None)
            .await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn danisan_eklenir_ve_listelenir() {
    let (_d, s) = kurulu_state().await;
    let (kod, olusan) =
        cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse Yilmaz"}))).await;
    assert_eq!(kod, StatusCode::CREATED);
    assert!(olusan["id"].as_i64().unwrap() > 0);

    let (_, liste) = cagir(&s, "GET", "/api/danisanlar", None).await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn randevu_olusturulur_ve_hafta_sorgusunda_gorunur() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let cid = d["id"].as_i64().unwrap();

    let (kod, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": cid, "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00", "ucret": 45000
    }))).await;
    assert_eq!(kod, StatusCode::CREATED);
    assert_eq!(olusan.as_array().unwrap().len(), 1, "tek randevu bile dizi doner");

    let (_, hafta) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-07T00:00&bitis=2026-09-14T00:00", None,
    ).await;
    assert_eq!(hafta.as_array().unwrap().len(), 1);
    assert_eq!(hafta[0]["danisan_adi"], "Ayse");
}

#[tokio::test]
async fn tekrar_sayisi_verilince_seri_olusur() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;

    let (kod, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00",
        "tekrar_sayisi": 4
    }))).await;
    assert_eq!(kod, StatusCode::CREATED);
    assert_eq!(olusan.as_array().unwrap().len(), 4);
}

#[tokio::test]
async fn gecersiz_tarih_400_doner() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;

    let (kod, json) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "07.09.2026 14:00", "bitis": "07.09.2026 15:00"
    }))).await;
    assert_eq!(kod, StatusCode::BAD_REQUEST);
    assert!(json["hata"].as_str().unwrap().contains("Tarih"));
}

#[tokio::test]
async fn durum_guncellenir() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    let (_, olusan) = cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;
    let id = olusan[0]["id"].as_i64().unwrap();

    let (kod, _) =
        cagir(&s, "PATCH", &format!("/api/randevular/{id}"), Some(json!({"durum":"geldi"}))).await;
    assert_eq!(kod, StatusCode::OK);

    let (_, hafta) = cagir(
        &s, "GET",
        "/api/randevular?baslangic=2026-09-07T00:00&bitis=2026-09-14T00:00", None,
    ).await;
    assert_eq!(hafta[0]["durum"], "geldi");
}

#[tokio::test]
async fn cakisma_ucu_cakisanlari_dondurur() {
    let (_d, s) = kurulu_state().await;
    let (_, d) = cagir(&s, "POST", "/api/danisanlar", Some(json!({"ad_soyad":"Ayse"}))).await;
    cagir(&s, "POST", "/api/randevular", Some(json!({
        "client_id": d["id"], "baslangic": "2026-09-07T14:00", "bitis": "2026-09-07T15:00"
    }))).await;

    let (kod, cakisanlar) = cagir(
        &s, "GET",
        "/api/cakisma?baslangic=2026-09-07T14:30&bitis=2026-09-07T15:30", None,
    ).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(cakisanlar.as_array().unwrap().len(), 1);
}
```

İlk iki test bu görevin güvenlik gerekçesidir: kilit ekranı yalnızca arayüzde durursa, telefon tarayıcısından doğrudan `/api/randevular` çağırmak tüm randevu listesini verirdi.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-server takvim_api`
Expected: derleme hatası — uç noktalar yok.

- [ ] **Step 3: Minimum uygulamayı yaz**

`server/src/guard.rs`:

```rust
use crate::state::AppState;
use axum::{http::StatusCode, Json};
use psikolog_core::store::db::open_encrypted;
use rusqlite::Connection;
use serde_json::{json, Value};

pub type ApiHata = (StatusCode, Json<Value>);

/// Acik oturumun anahtariyla veritabani baglantisi verir; kilitliyse 401.
pub fn acik_baglanti(state: &AppState) -> Result<Connection, ApiHata> {
    let key = state.acik_anahtar().ok_or((
        StatusCode::UNAUTHORIZED,
        Json(json!({ "hata": "Oturum kilitli. Lütfen parolanızı girin." })),
    ))?;
    open_encrypted(&state.db_yolu(), &key).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })))
    })
}

pub fn depo_hatasi(e: psikolog_core::store::clients::DepoHatasi) -> ApiHata {
    use psikolog_core::store::clients::DepoHatasi as D;
    match e {
        D::Bulunamadi => (StatusCode::NOT_FOUND, Json(json!({ "hata": "Kayıt bulunamadı." }))),
        D::GecersizVeri(m) => (StatusCode::BAD_REQUEST, Json(json!({ "hata": m }))),
        D::Sqlite(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })))
        }
    }
}
```

`server/src/routes/clients.rs`:

```rust
use crate::guard::{acik_baglanti, depo_hatasi, ApiHata};
use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use psikolog_core::store::audit::Cihaz;
use psikolog_core::store::clients::{ekle, listele, Danisan, YeniDanisan};

pub async fn liste(State(s): State<AppState>) -> Result<Json<Vec<Danisan>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let liste = listele(&conn, false, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(liste))
}

pub async fn olustur(
    State(s): State<AppState>,
    Json(yeni): Json<YeniDanisan>,
) -> Result<(StatusCode, Json<Danisan>), ApiHata> {
    let conn = acik_baglanti(&s)?;
    let danisan = ekle(&conn, &yeni, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok((StatusCode::CREATED, Json(danisan)))
}
```

`server/src/routes/appointments.rs`:

```rust
use crate::guard::{acik_baglanti, depo_hatasi, ApiHata};
use crate::state::AppState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use psikolog_core::store::appointments::{
    aralik_getir, cakisanlari_bul, durum_guncelle, olustur as tekil_olustur, seri_olustur, sil,
    Randevu, YeniRandevu,
};
use psikolog_core::store::audit::Cihaz;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct AralikSorgusu {
    pub baslangic: String,
    pub bitis: String,
}

#[derive(Deserialize)]
pub struct CakismaSorgusu {
    pub baslangic: String,
    pub bitis: String,
    pub haric_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct YeniRandevuIstegi {
    pub client_id: i64,
    pub baslangic: String,
    pub bitis: String,
    pub ucret: Option<i64>,
    pub tekrar_sayisi: Option<u32>,
}

#[derive(Deserialize)]
pub struct DurumIstegi {
    pub durum: String,
}

pub async fn liste(
    State(s): State<AppState>,
    Query(q): Query<AralikSorgusu>,
) -> Result<Json<Vec<Randevu>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let liste =
        aralik_getir(&conn, &q.baslangic, &q.bitis, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(liste))
}

pub async fn olustur(
    State(s): State<AppState>,
    Json(istek): Json<YeniRandevuIstegi>,
) -> Result<(StatusCode, Json<Vec<Randevu>>), ApiHata> {
    let conn = acik_baglanti(&s)?;
    let yeni = YeniRandevu {
        client_id: istek.client_id,
        baslangic: istek.baslangic,
        bitis: istek.bitis,
        ucret: istek.ucret,
    };

    // Tek randevu da dizi doner: istemci tarafinda tek kod yolu kalir.
    let sonuc = match istek.tekrar_sayisi {
        Some(n) if n > 1 => seri_olustur(&conn, &yeni, n, Cihaz::Masaustu),
        _ => tekil_olustur(&conn, &yeni, Cihaz::Masaustu).map(|r| vec![r]),
    }
    .map_err(depo_hatasi)?;

    Ok((StatusCode::CREATED, Json(sonuc)))
}

pub async fn durum(
    State(s): State<AppState>,
    Path(id): Path<i64>,
    Json(istek): Json<DurumIstegi>,
) -> Result<Json<Value>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    durum_guncelle(&conn, id, &istek.durum, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(json!({})))
}

pub async fn kaldir(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Value>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    sil(&conn, id, Cihaz::Masaustu).map_err(depo_hatasi)?;
    Ok(Json(json!({})))
}

pub async fn cakisma(
    State(s): State<AppState>,
    Query(q): Query<CakismaSorgusu>,
) -> Result<Json<Vec<Randevu>>, ApiHata> {
    let conn = acik_baglanti(&s)?;
    let liste = cakisanlari_bul(&conn, &q.baslangic, &q.bitis, q.haric_id).map_err(depo_hatasi)?;
    Ok(Json(liste))
}
```

`server/src/lib.rs` router'ına ekle (fallback'ten **önce**):

```rust
        .route("/api/danisanlar", get(routes::clients::liste).post(routes::clients::olustur))
        .route(
            "/api/randevular",
            get(routes::appointments::liste).post(routes::appointments::olustur),
        )
        .route(
            "/api/randevular/{id}",
            axum::routing::patch(routes::appointments::durum)
                .delete(routes::appointments::kaldir),
        )
        .route("/api/cakisma", get(routes::appointments::cakisma))
```

`server/src/routes/mod.rs`'e `pub mod appointments;` ve `pub mod clients;`, `server/src/lib.rs`'e `pub mod guard;` ekle.

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-server`
Expected: Plan 1'in 7 testi + yeni 8 test PASS.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(api): danisan ve randevu uc noktalari, kilit korumasi"
```

---

### Task 8: Hafta aritmetiği (saf fonksiyonlar)

**Files:**
- Create: `web/src/takvim/hafta.ts`
- Test: `web/src/takvim/hafta.test.ts`

**Interfaces:**
- Produces:
  - `export function haftaninBasi(tarih: Date): Date` — pazartesi 00:00
  - `export function haftaGunleri(haftaBasi: Date): Date[]` — 7 gün
  - `export function yerelZaman(tarih: Date): string` — `YYYY-AA-GGTSS:DD`
  - `export function zamandanDate(zaman: string): Date`
  - `export function dakikaFarki(baslangic: string, bitis: string): number`
  - `export function haftaBasligi(haftaBasi: Date): string` — örn. `7 – 13 Eylül 2026`

- [ ] **Step 1: Başarısız testleri yaz**

```ts
import { describe, expect, it } from 'vitest'
import {
  dakikaFarki, haftaBasligi, haftaGunleri, haftaninBasi, yerelZaman, zamandanDate,
} from './hafta'

describe('hafta aritmetiği', () => {
  it('haftanın başı pazartesidir', () => {
    // 2026-09-09 çarşamba
    expect(yerelZaman(haftaninBasi(new Date(2026, 8, 9, 15, 30)))).toBe('2026-09-07T00:00')
  })

  it('pazar günü aynı haftaya aittir', () => {
    // 2026-09-13 pazar → hafta başı 7 Eylül
    expect(yerelZaman(haftaninBasi(new Date(2026, 8, 13, 23, 0)))).toBe('2026-09-07T00:00')
  })

  it('pazartesi kendi haftasının başıdır', () => {
    expect(yerelZaman(haftaninBasi(new Date(2026, 8, 7, 8, 0)))).toBe('2026-09-07T00:00')
  })

  it('hafta yedi gün üretir ve ay sınırını geçer', () => {
    const gunler = haftaGunleri(haftaninBasi(new Date(2026, 8, 30)))
    expect(gunler).toHaveLength(7)
    expect(yerelZaman(gunler[0])).toBe('2026-09-28T00:00')
    expect(yerelZaman(gunler[6])).toBe('2026-10-04T00:00')
  })

  it('yerelZaman tek haneli değerleri sıfırla doldurur', () => {
    expect(yerelZaman(new Date(2026, 0, 5, 9, 5))).toBe('2026-01-05T09:05')
  })

  it('zamandanDate yerel saati korur', () => {
    const d = zamandanDate('2026-09-07T14:30')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(7)
    expect(d.getHours()).toBe(14)
    expect(d.getMinutes()).toBe(30)
  })

  it('yerelZaman ve zamandanDate birbirinin tersidir', () => {
    expect(yerelZaman(zamandanDate('2026-12-31T23:45'))).toBe('2026-12-31T23:45')
  })

  it('dakika farkı hesaplanır', () => {
    expect(dakikaFarki('2026-09-07T14:00', '2026-09-07T15:30')).toBe(90)
  })

  it('hafta başlığı ay sınırını doğru yazar', () => {
    expect(haftaBasligi(new Date(2026, 8, 7))).toBe('7 – 13 Eylül 2026')
    expect(haftaBasligi(new Date(2026, 8, 28))).toBe('28 Eylül – 4 Ekim 2026')
  })
})
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `npm --prefix web run test hafta`
Expected: FAIL — modül yok.

- [ ] **Step 3: Minimum uygulamayı yaz**

```ts
const AYLAR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

export const GUN_ADLARI = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

function ikiHane(n: number): string {
  return n.toString().padStart(2, '0')
}

export function haftaninBasi(tarih: Date): Date {
  const d = new Date(tarih.getFullYear(), tarih.getMonth(), tarih.getDate())
  // getDay(): 0 = pazar. Pazartesi başlangıçlı haftada pazar 6. gündür.
  const gun = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - gun)
  return d
}

export function haftaGunleri(haftaBasi: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(haftaBasi)
    d.setDate(d.getDate() + i)
    return d
  })
}

export function yerelZaman(tarih: Date): string {
  return (
    `${tarih.getFullYear()}-${ikiHane(tarih.getMonth() + 1)}-${ikiHane(tarih.getDate())}` +
    `T${ikiHane(tarih.getHours())}:${ikiHane(tarih.getMinutes())}`
  )
}

export function zamandanDate(zaman: string): Date {
  const [tarih, saat] = zaman.split('T')
  const [yil, ay, gun] = tarih.split('-').map(Number)
  const [ss, dd] = saat.split(':').map(Number)
  // Date(yil, ay-1, ...) yerel saat olarak kurar; UTC ayrıştırmasına düşmez.
  return new Date(yil, ay - 1, gun, ss, dd)
}

export function dakikaFarki(baslangic: string, bitis: string): number {
  return (zamandanDate(bitis).getTime() - zamandanDate(baslangic).getTime()) / 60000
}

export function haftaBasligi(haftaBasi: Date): string {
  const gunler = haftaGunleri(haftaBasi)
  const ilk = gunler[0]
  const son = gunler[6]
  const yil = son.getFullYear()

  if (ilk.getMonth() === son.getMonth()) {
    return `${ilk.getDate()} – ${son.getDate()} ${AYLAR[son.getMonth()]} ${yil}`
  }
  return `${ilk.getDate()} ${AYLAR[ilk.getMonth()]} – ${son.getDate()} ${AYLAR[son.getMonth()]} ${yil}`
}
```

`zamandanDate` içindeki yerel kurulum kritiktir: `new Date('2026-09-07T14:00')` tarayıcıya göre UTC olarak yorumlanabilir ve randevular saat kayarak görünür.

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `npm --prefix web run test hafta`
Expected: 9 test PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/takvim/hafta.ts web/src/takvim/hafta.test.ts
git commit -m "feat(takvim): hafta aritmetigi saf fonksiyonlari"
```

---

### Task 9: Haftalık takvim ızgarası

**Files:**
- Create: `web/src/takvim/HaftalikTakvim.tsx`, `web/src/takvim/RandevuBloku.tsx`
- Modify: `web/src/api.ts` (randevu ve danışan çağrıları), `web/src/screens/AnaEkran.tsx`
- Test: `web/src/takvim/HaftalikTakvim.test.tsx`

**Interfaces:**
- Consumes: `hafta.ts`, API
- Produces:
  - `export type Randevu = { id: number; client_id: number; danisan_adi: string; baslangic: string; bitis: string; durum: string; ucret: number | null; odendi: boolean; seri_id: string | null }`
  - `export function HaftalikTakvim({ randevular, haftaBasi, onHaftaDegis, onRandevuSec, onBosSaatSec }: Props)`
  - `api.randevulariGetir(baslangic, bitis)`, `api.danisanlariGetir()`, `api.randevuOlustur(...)`, `api.randevuDurumu(id, durum)`, `api.randevuSil(id)`, `api.cakismaKontrol(...)`

Izgara 08:00–21:00 arasını saatlik satırlarla gösterir; bu aralık `CALISMA_BASLANGIC` ve `CALISMA_BITIS` sabitleriyle tek yerde tanımlıdır.

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { HaftalikTakvim } from './HaftalikTakvim'
import { haftaninBasi } from './hafta'

const randevu = {
  id: 1, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
  baslangic: '2026-09-07T14:00', bitis: '2026-09-07T15:00',
  durum: 'planlandi', ucret: 45000, odendi: false, seri_id: null,
}

function kur(ozel = {}) {
  const props = {
    randevular: [randevu],
    haftaBasi: haftaninBasi(new Date(2026, 8, 7)),
    onHaftaDegis: vi.fn(),
    onRandevuSec: vi.fn(),
    onBosSaatSec: vi.fn(),
    ...ozel,
  }
  render(<HaftalikTakvim {...props} />)
  return props
}

describe('HaftalikTakvim', () => {
  it('hafta başlığını ve yedi günü gösterir', () => {
    kur()
    expect(screen.getByText('7 – 13 Eylül 2026')).toBeDefined()
    for (const gun of ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']) {
      expect(screen.getByText(gun)).toBeDefined()
    }
  })

  it('randevuyu danışan adıyla gösterir', () => {
    kur()
    expect(screen.getByText('Ayşe Yılmaz')).toBeDefined()
  })

  it('randevuya tıklayınca seçimi bildirir', async () => {
    const props = kur()
    await userEvent.click(screen.getByText('Ayşe Yılmaz'))
    expect(props.onRandevuSec).toHaveBeenCalledWith(randevu)
  })

  it('ileri ve geri gezinme hafta değişimini bildirir', async () => {
    const props = kur()
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki hafta' }))
    expect(props.onHaftaDegis).toHaveBeenCalledWith(1)

    await userEvent.click(screen.getByRole('button', { name: 'Önceki hafta' }))
    expect(props.onHaftaDegis).toHaveBeenCalledWith(-1)
  })

  it('boş saate tıklayınca o saati bildirir', async () => {
    const props = kur()
    await userEvent.click(screen.getByLabelText('8 Eylül 10:00 boş'))
    expect(props.onBosSaatSec).toHaveBeenCalledWith('2026-09-08T10:00')
  })

  it('iptal edilmiş randevuyu ayrı biçimde işaretler', () => {
    kur({ randevular: [{ ...randevu, durum: 'iptal' }] })
    expect(screen.getByText('Ayşe Yılmaz').closest('button')?.className).toContain('line-through')
  })

  it('randevusuz hafta boş ızgara gösterir, hata vermez', () => {
    kur({ randevular: [] })
    expect(screen.getByText('7 – 13 Eylül 2026')).toBeDefined()
  })
})
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `npm --prefix web run test HaftalikTakvim`
Expected: FAIL — modül yok.

- [ ] **Step 3: Minimum uygulamayı yaz**

`web/src/takvim/RandevuBloku.tsx`:

```tsx
import type { Randevu } from './HaftalikTakvim'

const DURUM_BICIMI: Record<string, string> = {
  planlandi: 'bg-slate-800 text-white',
  geldi: 'bg-emerald-700 text-white',
  gelmedi: 'bg-amber-600 text-white',
  iptal: 'bg-slate-200 text-slate-500 line-through',
}

export function RandevuBloku({ randevu, onSec }: { randevu: Randevu; onSec: () => void }) {
  return (
    <button
      onClick={onSec}
      className={`w-full truncate rounded px-1 py-0.5 text-left text-xs ${
        DURUM_BICIMI[randevu.durum] ?? DURUM_BICIMI.planlandi
      }`}
    >
      {randevu.danisan_adi}
    </button>
  )
}
```

`web/src/takvim/HaftalikTakvim.tsx`:

```tsx
import { GUN_ADLARI, haftaBasligi, haftaGunleri, yerelZaman, zamandanDate } from './hafta'
import { RandevuBloku } from './RandevuBloku'

export type Randevu = {
  id: number
  client_id: number
  danisan_adi: string
  baslangic: string
  bitis: string
  durum: string
  ucret: number | null
  odendi: boolean
  seri_id: string | null
}

const CALISMA_BASLANGIC = 8
const CALISMA_BITIS = 21
const AYLAR_UZUN = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

type Props = {
  randevular: Randevu[]
  haftaBasi: Date
  onHaftaDegis: (yon: number) => void
  onRandevuSec: (randevu: Randevu) => void
  onBosSaatSec: (zaman: string) => void
}

export function HaftalikTakvim({
  randevular, haftaBasi, onHaftaDegis, onRandevuSec, onBosSaatSec,
}: Props) {
  const gunler = haftaGunleri(haftaBasi)
  const saatler = Array.from(
    { length: CALISMA_BITIS - CALISMA_BASLANGIC },
    (_, i) => CALISMA_BASLANGIC + i,
  )

  function hucreRandevulari(gun: Date, saat: number): Randevu[] {
    return randevular.filter((r) => {
      const b = zamandanDate(r.baslangic)
      return (
        b.getFullYear() === gun.getFullYear() &&
        b.getMonth() === gun.getMonth() &&
        b.getDate() === gun.getDate() &&
        b.getHours() === saat
      )
    })
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-3">
        <button
          className="rounded border px-3 py-1"
          onClick={() => onHaftaDegis(-1)}
        >
          Önceki hafta
        </button>
        <h2 className="text-lg font-semibold">{haftaBasligi(haftaBasi)}</h2>
        <button
          className="rounded border px-3 py-1"
          onClick={() => onHaftaDegis(1)}
        >
          Sonraki hafta
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] table-fixed border-collapse">
          <thead>
            <tr>
              <th className="w-14" />
              {gunler.map((g, i) => (
                <th key={i} className="border-b p-1 text-xs font-medium text-slate-600">
                  <div>{GUN_ADLARI[i]}</div>
                  <div className="text-sm text-slate-900">{g.getDate()}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {saatler.map((saat) => (
              <tr key={saat}>
                <td className="border-r p-1 text-right align-top text-xs text-slate-500">
                  {saat.toString().padStart(2, '0')}:00
                </td>
                {gunler.map((gun, i) => {
                  const hucredekiler = hucreRandevulari(gun, saat)
                  const zaman = yerelZaman(
                    new Date(gun.getFullYear(), gun.getMonth(), gun.getDate(), saat, 0),
                  )
                  return (
                    <td key={i} className="h-10 border border-slate-100 p-0.5 align-top">
                      {hucredekiler.length > 0 ? (
                        hucredekiler.map((r) => (
                          <RandevuBloku key={r.id} randevu={r} onSec={() => onRandevuSec(r)} />
                        ))
                      ) : (
                        <button
                          aria-label={`${gun.getDate()} ${AYLAR_UZUN[gun.getMonth()]} ${saat
                            .toString()
                            .padStart(2, '0')}:00 boş`}
                          className="h-full w-full"
                          onClick={() => onBosSaatSec(zaman)}
                        />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

`web/src/api.ts`'e ekle:

```ts
export const takvimApi = {
  danisanlariGetir: () => istek<Danisan[]>('/api/danisanlar'),
  danisanEkle: (ad_soyad: string, telefon?: string) =>
    istek<Danisan>('/api/danisanlar', {
      method: 'POST',
      body: JSON.stringify({ ad_soyad, telefon }),
    }),
  randevulariGetir: (baslangic: string, bitis: string) =>
    istek<Randevu[]>(
      `/api/randevular?baslangic=${encodeURIComponent(baslangic)}&bitis=${encodeURIComponent(bitis)}`,
    ),
  randevuOlustur: (govde: {
    client_id: number
    baslangic: string
    bitis: string
    ucret?: number | null
    tekrar_sayisi?: number
  }) => istek<Randevu[]>('/api/randevular', { method: 'POST', body: JSON.stringify(govde) }),
  randevuDurumu: (id: number, durum: string) =>
    istek<Record<string, never>>(`/api/randevular/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ durum }),
    }),
  randevuSil: (id: number) =>
    istek<Record<string, never>>(`/api/randevular/${id}`, { method: 'DELETE' }),
  cakismaKontrol: (baslangic: string, bitis: string, haricId?: number) => {
    const p = new URLSearchParams({ baslangic, bitis })
    if (haricId !== undefined) p.set('haric_id', String(haricId))
    return istek<Randevu[]>(`/api/cakisma?${p}`)
  },
}

export type Danisan = { id: number; ad_soyad: string; telefon: string | null; durum: string }
```

`Randevu` tipini `web/src/takvim/HaftalikTakvim.tsx`'ten içe aktar.

`AnaEkran.tsx`'i takvimi yükleyip gösterecek şekilde güncelle: hafta durumu (`useState(haftaninBasi(new Date()))`), hafta değişince `randevulariGetir` çağrısı, `onRandevuSec`/`onBosSaatSec` seçili randevuyu duruma yazar (panel Task 9'da bağlanır).

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `npm --prefix web run test`
Expected: hafta testleri + 7 takvim testi PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(takvim): haftalik izgara ve randevu bloklari"
```

---

### Task 10: Randevu paneli — oluşturma, çakışma uyarısı, durum

**Files:**
- Create: `web/src/takvim/RandevuPaneli.tsx`
- Modify: `web/src/screens/AnaEkran.tsx`
- Test: `web/src/takvim/RandevuPaneli.test.tsx`

**Interfaces:**
- Consumes: `takvimApi`, `Randevu`, `Danisan`
- Produces: `export function RandevuPaneli({ zaman, randevu, danisanlar, onKaydet, onDurumDegis, onSil, onKapat, cakismaKontrol }: Props)`

Panel iki kipte çalışır: `randevu` verilmişse düzenleme, yalnızca `zaman` verilmişse yeni kayıt.

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RandevuPaneli } from './RandevuPaneli'

const danisanlar = [
  { id: 1, ad_soyad: 'Ayşe Yılmaz', telefon: null, durum: 'aktif' },
  { id: 2, ad_soyad: 'Mehmet Demir', telefon: null, durum: 'aktif' },
]

const mevcut = {
  id: 7, client_id: 1, danisan_adi: 'Ayşe Yılmaz',
  baslangic: '2026-09-07T14:00', bitis: '2026-09-07T15:00',
  durum: 'planlandi', ucret: 45000, odendi: false, seri_id: null,
}

function kur(ozel = {}) {
  const props = {
    zaman: '2026-09-07T14:00',
    randevu: null as typeof mevcut | null,
    danisanlar,
    onKaydet: vi.fn().mockResolvedValue(undefined),
    onDurumDegis: vi.fn().mockResolvedValue(undefined),
    onSil: vi.fn().mockResolvedValue(undefined),
    onKapat: vi.fn(),
    cakismaKontrol: vi.fn().mockResolvedValue([]),
    ...ozel,
  }
  render(<RandevuPaneli {...props} />)
  return props
}

describe('RandevuPaneli', () => {
  it('yeni randevuda danışan seçilmeden kaydetmez', async () => {
    const props = kur()
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(screen.getByText(/danışan seçin/i)).toBeDefined()
    expect(props.onKaydet).not.toHaveBeenCalled()
  })

  it('danışan ve süre ile kaydeder', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(props.onKaydet).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 2,
        baslangic: '2026-09-07T14:00',
        bitis: '2026-09-07T15:00',
      }),
    )
  })

  it('ücreti kuruşa çevirir', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.clear(screen.getByLabelText('Ücret (TL)'))
    await userEvent.type(screen.getByLabelText('Ücret (TL)'), '450')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(props.onKaydet).toHaveBeenCalledWith(expect.objectContaining({ ucret: 45000 }))
  })

  it('çakışma varsa uyarır ama kaydetmeyi engellemez', async () => {
    const props = kur({ cakismaKontrol: vi.fn().mockResolvedValue([mevcut]) })
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '2')

    await waitFor(() => expect(screen.getByText(/bu saatte başka randevu var/i)).toBeDefined())

    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(props.onKaydet).toHaveBeenCalled()
  })

  it('tekrar sayısı verilince kaydete geçirilir', async () => {
    const props = kur()
    await userEvent.selectOptions(screen.getByLabelText('Danışan'), '1')
    await userEvent.click(screen.getByLabelText('Her hafta tekrarla'))
    await userEvent.clear(screen.getByLabelText('Kaç hafta'))
    await userEvent.type(screen.getByLabelText('Kaç hafta'), '8')
    await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }))

    expect(props.onKaydet).toHaveBeenCalledWith(expect.objectContaining({ tekrar_sayisi: 8 }))
  })

  it('mevcut randevuda durum düğmeleri görünür ve çalışır', async () => {
    const props = kur({ randevu: mevcut })
    await userEvent.click(screen.getByRole('button', { name: 'Geldi' }))
    expect(props.onDurumDegis).toHaveBeenCalledWith(7, 'geldi')
  })

  it('yeni randevuda durum düğmeleri görünmez', () => {
    kur()
    expect(screen.queryByRole('button', { name: 'Geldi' })).toBeNull()
  })

  it('silme onay ister', async () => {
    const props = kur({ randevu: mevcut })
    await userEvent.click(screen.getByRole('button', { name: 'Sil' }))
    expect(props.onSil).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Evet, sil' }))
    expect(props.onSil).toHaveBeenCalledWith(7)
  })
})
```

Dördüncü test, Task 4'te alınan ürün kararının arayüz karşılığıdır: çakışma uyarıdır, engel değil.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `npm --prefix web run test RandevuPaneli`
Expected: FAIL — modül yok.

- [ ] **Step 3: Minimum uygulamayı yaz**

```tsx
import { useEffect, useState } from 'react'
import type { Danisan } from '../api'
import type { Randevu } from './HaftalikTakvim'
import { dakikaFarki, yerelZaman, zamandanDate } from './hafta'

const VARSAYILAN_SURE_DK = 60

type Kayit = {
  client_id: number
  baslangic: string
  bitis: string
  ucret: number | null
  tekrar_sayisi?: number
}

type Props = {
  zaman: string
  randevu: Randevu | null
  danisanlar: Danisan[]
  onKaydet: (kayit: Kayit) => Promise<void>
  onDurumDegis: (id: number, durum: string) => Promise<void>
  onSil: (id: number) => Promise<void>
  onKapat: () => void
  cakismaKontrol: (baslangic: string, bitis: string, haricId?: number) => Promise<Randevu[]>
}

function bitisHesapla(baslangic: string, sureDk: number): string {
  const d = zamandanDate(baslangic)
  d.setMinutes(d.getMinutes() + sureDk)
  return yerelZaman(d)
}

export function RandevuPaneli({
  zaman, randevu, danisanlar, onKaydet, onDurumDegis, onSil, onKapat, cakismaKontrol,
}: Props) {
  const baslangic = randevu?.baslangic ?? zaman
  const [clientId, setClientId] = useState<number | ''>(randevu?.client_id ?? '')
  const [sureDk, setSureDk] = useState(
    randevu ? dakikaFarki(randevu.baslangic, randevu.bitis) : VARSAYILAN_SURE_DK,
  )
  const [ucretTl, setUcretTl] = useState(randevu?.ucret != null ? String(randevu.ucret / 100) : '')
  const [tekrar, setTekrar] = useState(false)
  const [haftaSayisi, setHaftaSayisi] = useState('8')
  const [cakisanlar, setCakisanlar] = useState<Randevu[]>([])
  const [hata, setHata] = useState<string | null>(null)
  const [silOnayi, setSilOnayi] = useState(false)

  const bitis = bitisHesapla(baslangic, sureDk)

  useEffect(() => {
    let iptal = false
    void cakismaKontrol(baslangic, bitis, randevu?.id).then((liste) => {
      if (!iptal) setCakisanlar(liste)
    })
    return () => { iptal = true }
  }, [baslangic, bitis, randevu?.id, cakismaKontrol])

  async function kaydet() {
    if (clientId === '') return setHata('Lütfen bir danışan seçin.')
    setHata(null)
    await onKaydet({
      client_id: Number(clientId),
      baslangic,
      bitis,
      ucret: ucretTl.trim() === '' ? null : Math.round(Number(ucretTl) * 100),
      ...(tekrar ? { tekrar_sayisi: Number(haftaSayisi) } : {}),
    })
  }

  return (
    <aside className="w-80 border-l bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{randevu ? 'Randevu' : 'Yeni randevu'}</h3>
        <button className="text-slate-500" onClick={onKapat}>Kapat</button>
      </div>

      <p className="mt-1 text-sm text-slate-600">{baslangic.replace('T', ' ')} – {bitis.slice(11)}</p>

      <label className="mt-4 block text-sm" htmlFor="danisan">Danışan</label>
      <select
        id="danisan"
        className="mt-1 w-full rounded border p-2"
        value={clientId}
        onChange={(e) => setClientId(e.target.value === '' ? '' : Number(e.target.value))}
      >
        <option value="">Seçiniz…</option>
        {danisanlar.map((d) => (
          <option key={d.id} value={d.id}>{d.ad_soyad}</option>
        ))}
      </select>

      <label className="mt-3 block text-sm" htmlFor="sure">Süre (dakika)</label>
      <input
        id="sure" type="number" min={15} step={15}
        className="mt-1 w-full rounded border p-2"
        value={sureDk}
        onChange={(e) => setSureDk(Number(e.target.value))}
      />

      <label className="mt-3 block text-sm" htmlFor="ucret">Ücret (TL)</label>
      <input
        id="ucret" type="number" min={0}
        className="mt-1 w-full rounded border p-2"
        value={ucretTl}
        onChange={(e) => setUcretTl(e.target.value)}
      />

      {!randevu && (
        <div className="mt-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={tekrar}
              onChange={(e) => setTekrar(e.target.checked)}
            />
            Her hafta tekrarla
          </label>
          {tekrar && (
            <>
              <label className="mt-2 block text-sm" htmlFor="hafta">Kaç hafta</label>
              <input
                id="hafta" type="number" min={2} max={52}
                className="mt-1 w-full rounded border p-2"
                value={haftaSayisi}
                onChange={(e) => setHaftaSayisi(e.target.value)}
              />
            </>
          )}
        </div>
      )}

      {cakisanlar.length > 0 && (
        <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-800">
          Bu saatte başka randevu var: {cakisanlar.map((r) => r.danisan_adi).join(', ')}
        </p>
      )}

      {hata && <p className="mt-3 text-sm text-red-600">{hata}</p>}

      <button
        className="mt-4 w-full rounded bg-slate-900 py-2 text-white"
        onClick={kaydet}
      >
        Kaydet
      </button>

      {randevu && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-1">
            {[['Geldi', 'geldi'], ['Gelmedi', 'gelmedi'], ['İptal', 'iptal']].map(([etiket, kod]) => (
              <button
                key={kod}
                className="rounded border py-1 text-sm"
                onClick={() => onDurumDegis(randevu.id, kod)}
              >
                {etiket}
              </button>
            ))}
          </div>

          {silOnayi ? (
            <div className="mt-3 rounded bg-red-50 p-2">
              <p className="text-sm text-red-800">Bu randevu kalıcı olarak silinsin mi?</p>
              <div className="mt-2 flex gap-2">
                <button className="rounded bg-red-700 px-3 py-1 text-sm text-white"
                  onClick={() => onSil(randevu.id)}>
                  Evet, sil
                </button>
                <button className="rounded border px-3 py-1 text-sm"
                  onClick={() => setSilOnayi(false)}>
                  Vazgeç
                </button>
              </div>
            </div>
          ) : (
            <button className="mt-3 w-full text-sm text-red-700 underline"
              onClick={() => setSilOnayi(true)}>
              Sil
            </button>
          )}
        </>
      )}
    </aside>
  )
}
```

`AnaEkran.tsx`: seçili randevu/zaman durumuna göre paneli göster, kaydetme sonrası haftayı yeniden yükle, paneli kapat.

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `npm --prefix web run test`
Expected: tüm web testleri PASS (hafta 9 + takvim 7 + panel 8 + Plan 1'in kurulum testleri 3).

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(takvim): randevu paneli, cakisma uyarisi ve durum islemleri"
```

---

### Task 11: Uçtan uca test

**Files:**
- Create: `e2e/takvim.spec.ts`
- Modify: `e2e/kurulum.spec.ts` (gerekirse ortak yardımcıyı ayır)

**Interfaces:**
- Consumes: Plan 1'in `sunucu` ikilisi ve Playwright yapılandırması

- [ ] **Step 1: Testi yaz**

```ts
import { expect, test } from '@playwright/test'

async function kurulumYap(page) {
  await page.goto('/')
  await page.getByLabel('Ana parola').fill('gizliparola')
  await page.getByLabel('Parola tekrar').fill('gizliparola')
  await page.getByRole('button', { name: 'Devam et' }).click()
  await page.getByLabel(/kurtarma kodunu kaydettim/i).check()
  await page.getByRole('button', { name: 'Kurulumu bitir' }).click()
}

test('danisan ekle, randevu olustur, geldi isaretle', async ({ page }) => {
  await kurulumYap(page)

  await page.getByRole('button', { name: 'Danışan ekle' }).click()
  await page.getByLabel('Ad soyad').fill('Ayşe Yılmaz')
  await page.getByRole('button', { name: 'Ekle' }).click()
  await expect(page.getByText('Ayşe Yılmaz')).toBeVisible()

  // Izgarada bos bir saate tikla; hangi hafta olursa olsun ilk bos hucre yeterli.
  await page.locator('button[aria-label$="10:00 boş"]').first().click()
  await page.getByLabel('Danışan').selectOption({ label: 'Ayşe Yılmaz' })
  await page.getByLabel('Ücret (TL)').fill('450')
  await page.getByRole('button', { name: 'Kaydet' }).click()

  const blok = page.getByRole('button', { name: 'Ayşe Yılmaz' }).first()
  await expect(blok).toBeVisible()

  await blok.click()
  await page.getByRole('button', { name: 'Geldi' }).click()
  await expect(blok).toHaveClass(/bg-emerald/)
})

test('kilitliyken randevu ucu veri sizdirmaz', async ({ page, request }) => {
  await kurulumYap(page)
  await page.getByRole('button', { name: 'Kilitle' }).click()

  const yanit = await request.get(
    '/api/randevular?baslangic=2026-01-01T00:00&bitis=2030-01-01T00:00',
  )
  expect(yanit.status()).toBe(401)
})

test('haftalar arasi gezinme calisir', async ({ page }) => {
  await kurulumYap(page)
  const baslik = page.locator('h2').first()
  const ilk = await baslik.textContent()

  await page.getByRole('button', { name: 'Sonraki hafta' }).click()
  await expect(baslik).not.toHaveText(ilk ?? '')

  await page.getByRole('button', { name: 'Önceki hafta' }).click()
  await expect(baslik).toHaveText(ilk ?? '')
})
```

İkinci test, tarayıcı arayüzünü atlayıp doğrudan API'ye giderek kilit korumasının gerçekten sunucuda olduğunu doğrular.

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Run: `npm --prefix web run build && npx playwright test takvim`
Expected: FAIL — "Danışan ekle" düğmesi yok.

- [ ] **Step 3: Eksik arayüz parçasını tamamla**

`AnaEkran.tsx`'e danışan ekleme düğmesi ve küçük bir form (ad soyad + telefon) ekle; kaydedince `takvimApi.danisanEkle` çağırıp listeyi tazele. Testin beklediği etiketler: düğme `Danışan ekle`, alan `Ad soyad`, gönder düğmesi `Ekle`.

- [ ] **Step 4: Testin geçtiğini doğrula**

Run: `npx playwright test`
Expected: Plan 1'in kurulum testi + 3 takvim testi PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(e2e): takvim akisi ve kilit korumasi dogrulamasi"
```

---

### Task 12: `keystore.json` yedeğe dahil edilsin

Plan 1'in son incelemesinden gelen **en kritik** madde. Bugün `yedek_al` yalnızca `veri.db`'yi
kopyalıyor. Ama o dosya, `keystore.json` içindeki sarmalanmış veri anahtarı olmadan **açılamaz**;
parola ve kurtarma kodu tek başına yetmez, ikisi de yalnızca o dosyadaki sarmalamayı çözer.
Keystore ise uygulama veri dizininde kalıyor.

**Sonuç: disk bozulursa veya Mac çalınırsa, yedek klasöründeki her şey sonsuza kadar okunamaz.**
Tasarımın üçüncü başarı ölçütü — "bilgisayar bozulursa veri kaybolmasın" — bugünkü mimariyle
karşılanmıyor. Bu bir kod hatası değil, iki ayrı ayrı doğru yapılmış görevin arasındaki mimari
boşluk.

**Files:**
- Modify: `core/src/backup.rs`
- Modify: `web/src/screens/KeystoreBozukEkrani.tsx`, `web/src/screens/KurulumSihirbazi.tsx`
- Test: `core/src/backup.rs` test bloğu

**Interfaces:**
- `yedek_al(db_yolu, keystore_yolu, hedef_dizin, damga, key)` — keystore yolu eklenir
- `geri_yukle(yedek_yolu, db_yolu, keystore_yolu, key)` — ikisini birlikte geri yükler
- `YedekBilgisi`'ye `keystore_var: bool` eklenir
- Yedek dosya adları: `yedek-<damga>.db` ve `yedek-<damga>.keystore.json`

- [ ] **Step 1: Başarısız testleri yaz**

```rust
    #[test]
    fn yedek_hem_veritabanini_hem_keystore_u_icerir() {
        // yedek_al sonrasi hedef dizinde iki dosya da olmali.
    }

    #[test]
    fn keystore_eksikse_geri_yukleme_reddedilir_ve_mevcut_veri_korunur() {
        // Yedek klasorunden keystore dosyasini sil, geri_yukle cagir.
        // Hata donmeli VE mevcut veri.db ile keystore.json degismemis olmali.
        // Eslesmeyen bir cifti geri yuklemek veriyi erisilemez birakir.
    }

    #[test]
    fn veritabani_eksikse_geri_yukleme_reddedilir() {
        // Simetrik durum: keystore var, .db yok.
    }

    #[test]
    fn eksik_ciftli_yedekler_listede_gorunmez() {
        // yedekleri_listele yalnizca IKI dosyasi da olan yedekleri dondurmeli;
        // aksi halde kullaniciya geri yuklenemeyecek bir yedek gosterilir.
    }

    #[test]
    fn geri_yukleme_ikisini_birlikte_yerine_koyar() {
        // Yedek al, sonra parolayi degistir (keystore degisir), sonra yedegi geri yukle
        // ve ESKI parolanin calistigini dogrula. Bu, keystore'un gercekten geri
        // yuklendiginin tek kanitidir.
    }

    #[test]
    fn yedek_keystore_dosyasinda_ham_anahtar_bulunmaz() {
        // Plan 1'deki duz metin testinin keystore karsiligi.
    }
```

Beşinci test bu görevin varlık sebebidir: yalnızca dosyanın kopyalandığını değil, **geri yüklenen
çiftin gerçekten birlikte çalıştığını** doğrular.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core backup`
Expected: derleme hatası — imzalar değişti.

- [ ] **Step 3: Minimum uygulamayı yaz**

`yedek_al` keystore'u da kopyalasın (dosya zaten AEAD sarmalı; bulut klasöründe durması güvenli —
tasarımın "dosya zaten şifreli" gerekçesiyle tutarlı). `geri_yukle` **önce ikisinin de varlığını ve
açılabilirliğini doğrulasın**, ancak ondan sonra yerlerine koysun — Plan 1'deki "doğrulamadan önce
mevcut veriye dokunma" kuralı burada iki dosya için geçerli. `yedekleri_listele` eksik çiftleri
atlasın.

- [ ] **Step 4: Arayüz metinlerini düzelt**

`KeystoreBozukEkrani` bugün iki yanlış şey söylüyor:
- *"bir yedekten geri yükleme yapmanız gerekebilir"* — bu tavsiye **yanlıştı**, çünkü veritabanı
  yedeği bozuk bir keystore'u onarmıyordu. Bu görevden sonra doğru hâle geliyor; metni, yedek
  klasöründeki çiftin geri yüklenebileceğini söyleyecek şekilde güncelle.
- *"teknik desteğe başvurun"* — ürün tek kişilik bir muayenehane için; teknik destek diye bir şey
  yok. Kullanıcının **fiilen yapabileceği** bir eylem yaz.

`KurulumSihirbazi`'nin kurtarma kodu ekranına bir cümle ekle: yedek klasörü hem veriyi hem
anahtarı içerir, ikisi birlikte saklanmalıdır.

- [ ] **Step 5: Testlerin geçtiğini doğrula**

Run: `cargo test --workspace` ve `npm --prefix web run test`
Expected: hepsi PASS.

- [ ] **Step 6: Commit**

```bash
git add core/src/backup.rs web/src/screens
git commit -m "feat(yedek): keystore yedege dahil, eksik cift geri yuklenmiyor"
```

---

## Planın Bitiş Durumu

Bitince elde olan: takvimi ana ekran olarak kullanan, danışan kaydı açılabilen, tekil ve haftalık tekrarlayan randevu oluşturulabilen, çakışmayı uyaran, geldi/gelmedi/iptal işaretlenebilen ve kilitliyken API'den veri sızdırmadığı testle kanıtlanmış bir uygulama.

**Bu planda kasten yok:** seans notu ve not editörü (Plan 3), danışan dosyasının tam hâli — rıza, ekler, saklama süresi (Plan 3), ay sonu ödeme özeti ve dışa aktarma (Plan 4), telefon erişimi (Plan 4). Ücret ve ödendi alanları veritabanında bu planda oluşur ama raporlama Plan 4'e aittir.

## Açık Sorular

1. **Çalışma saatleri 08:00–21:00 varsayıldı.** Psikoloğun gerçek çalışma aralığı öğrenilince `CALISMA_BASLANGIC`/`CALISMA_BITIS` sabitleri güncellenmeli; ileride ayarlara taşınabilir.
2. **Varsayılan seans süresi 60 dakika.** 45 veya 50 dakika çalışılıyorsa `VARSAYILAN_SURE_DK` değişmeli — terapide 50 dakika da yaygındır.
3. **Izgara saat başı çözünürlükte.** 14:30'da başlayan bir randevu, 14:00 hücresinde görünür. Yarım saatlik çözünürlük gerekiyorsa Task 8 yeniden ele alınmalı; şimdilik kayıt doğru, yalnızca görsel yerleşim kabadır.
