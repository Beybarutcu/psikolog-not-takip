# Danışan Dosyası ve Seans Notları — Uygulama Planı (Plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uygulamanın asıl işi: danışan dosyasının tam hâli, seans notu editörü (otomatik kayıtlı, şablonlu), resmî not ile terapistin özel notunun ayrılması, ekli dosyalar ve not içinde arama.

**Architecture:** Plan 1'in şifreli veritabanı ve Plan 2'nin randevu kaydı üzerine kurulur. `clients` tablosu rıza ve saklama alanlarıyla genişletilir; `progress_notes` ve `private_notes` **ayrı tablolar** olarak eklenir. Seans notu bir randevuya bağlanır — randevu ile seans aynı kayıttır. Arama, SQLite FTS5 yerine düz `LIKE` ile yapılır (gerekçe Arama görevinde).

**Tech Stack:** Plan 1 ve 2 ile aynı — Rust (rusqlite/SQLCipher, axum), React + TypeScript + Tailwind, Vitest, Playwright.

**Önkoşul:** Plan 1 ve Plan 2 tamamlanmış olmalı. Bu plan `open_encrypted`, `migrate`, `audit::kaydet`, `Oturum`, `AppState`, `guard::acik_baglanti`, `clients` ve `appointments` depoları üzerine inşa eder.

## Global Constraints

Plan 1 ve Plan 2'nin tüm global kısıtları geçerlidir. Bu plana özgü ek kısıtlar:

- **Özel notlar hiçbir dışa aktarım sorgusuna, hiçbir rapora ve hiçbir liste uç noktasına dahil edilmez.** Bunu sağlayan tek mekanizma ayrı tablo olmasıdır; bir `WHERE gizli = 0` filtresine güvenilmez — unutulan tek bir sorgu koruma sözünü bozar.
- **Not editörü otomatik kaydeder, 2 saniyede bir.** Kaydet butonu yoktur. İncelenen ürünlerin en sık şikayeti not kaybıydı.
- **Not içerikleri hiçbir zaman erişim loguna yazılmaz.** Log yalnızca "hangi notu, ne zaman, hangi cihazdan" bilgisini tutar; içerik logda görünürse log dosyası ikinci bir sızıntı yüzeyi olur.
- **Yazma işlemi ile log kaydı aynı transaction içinde olmalıdır.** Ayrı yapılırsa "not kaydedildi ama log yazılmadı" durumu doğar. Not editörü 2 saniyede bir yazdığı için bu katmanda özellikle önemlidir: kısmi başarısızlık sık karşılaşılacak bir durumdur, istisna değil.
- **Ekli dosyalar veritabanı içinde BLOB olarak saklanır**, ayrı dosya olarak değil — yedek tek dosya kalsın diye. Dosya başına üst sınır **20 MB**, toplam uyarı eşiği 500 MB.
- **Saklama süresi otomatik silme yapmaz.** Süresi dolan dosyalar yalnızca listelenir; silme kararını her zaman insan verir.
- Şema sürümü bu planda **3**'e çıkar. `migrate`, Plan 2'de yeniden yazılmış olan
  sürüm-okuyan/transaction'lı çerçeveyi kullanmalı; koşulsuz `execute_batch` zinciri **değil**.
- **`Oturum::dokun()` her başarılı istekte çağrılmalıdır.** Çağrılmazsa boşta kalma kilidi
  "kilit açıldıktan 5 dakika sonra" anlamına gelir ve not editörü seansın 5. dakikasında 401
  almaya başlar — bu planın önlemeye çalıştığı not kaybının ta kendisi.
- **`audit_log.ayrinti` kapalı bir enum'dur** (Plan 2'de dönüştürüldü). Serbest metin yazma;
  log tetikleyicilerle silinemez olduğu için oraya düşen not içeriği kalıcıdır.

**Plan 2'nin dal incelemesinden devredilen bağlayıcı kısıtlar:**

- **Denetim kaydı hacmi bir tasarım kısıtıdır, ayrıntı değil.** `audit_log` tetikleyicilerle
  silinemez. Not editörü 2 saniyede bir yazacağı için "her yazma bir log satırı" kuralı bir
  saatlik not yazımında ~1800 silinemez satır üretir. Kural Task 2'de tek yerde yazılır ve
  bu plandaki **her** yazma yolu ona uyar.
- **Birleştirme (coalescing) asla var olan bir satırı silerek veya güncelleyerek yapılmaz.**
  Tetikleyiciler bunu zaten reddeder ve logun tüm değeri değiştirilemezliğidir. Birleştirme
  "yazma" kararıdır, "üzerine yazma" değil.
- **Otomatik kayıt sırasında 401 gelirse yazılmamış not içeriği sessizce düşürülemez.**
  Plan 2'de boşta kalma kilidi ekrana bağlandı; artık oturum yazma sırasında gerçekten
  kilitlenebilir. Kullanıcının yazdığı metin kaybolursa bu planın önlemeye çalıştığı hatanın
  ta kendisi olur. Davranış Task 8'de açıkça kararlaştırılır ve testle korunur.
- **Dışlayıcı `WHERE` desenini kopyalama.** Kod tabanındaki tek örnek `cakisanlari_bul`'daki
  `durum != 'iptal'`. Özel notların ayrı tabloda tutulması kuralı bu desene kaymamalıdır —
  Plan 2 Görev 4'ün bulgusu (şablon kopyalandı, arkasındaki muhakeme kopyalanmadı) bu planda
  en çok burada tekrar etme riski taşıyor.
- **`Ayrinti`'ye eklenecek hiçbir varyant doğrulanmamış metin taşımaz.** Not içeriği bir yana,
  **not başlığı, şablon adı ve dosya adı bile** loga girmez. `zaman_gecerli_mi` gibi dar bir
  doğrulayıcısı olmayan `String` varyantı eklenmez.

---

## Dosya Yapısı

```
core/src/store/
├─ schema.rs          # DEGISIR: V3 migration
├─ clients.rs         # DEGISIR: riza, saklama, son temas alanlari
├─ notes.rs           # YENI: progress_notes + private_notes deposu
├─ templates.rs       # YENI: not sablonlari
├─ attachments.rs     # YENI: ekli dosyalar (BLOB)
└─ search.rs          # YENI: danisan adi + not icerigi aramasi
server/src/routes/
├─ notes.rs           # YENI
├─ attachments.rs     # YENI
└─ search.rs          # YENI
web/src/
├─ seans/
│  ├─ SeansPaneli.tsx     # YENI: sol baglam + sag editor
│  ├─ NotEditoru.tsx      # YENI: otomatik kayitli editor
│  ├─ GecmisNotlar.tsx    # YENI: son 3 seans, katlanmis
│  └─ sablon.ts           # YENI: DAP/SOAP/serbest sablon tanimlari
├─ danisan/
│  ├─ DanisanKarti.tsx    # YENI
│  └─ RizaBolumu.tsx      # YENI: aydinlatma/aciк riza + onam dosyasi
└─ arama/
   └─ HizliArama.tsx      # YENI: Ctrl+K
```

`sablon.ts` ayrı bir dosyadır: şablon tanımları veri, bileşen değil. Kullanıcı şablonları
düzenleyebildiği için bunların serileştirme biçimi test edilebilir olmalı.

---

### Task 1: Şema sürüm 3 — not tabloları ve danışan dosyası alanları

**Files:**
- Modify: `core/src/store/schema.rs`
- Test: aynı dosyanın test bloğu

**Interfaces:**
- Produces: `pub const CURRENT_VERSION: i64 = 3`; `migrate` V1→V2→V3 sırayla uygular

- [ ] **Step 1: Başarısız testleri yaz**

```rust
    #[test]
    fn surum_uc_olarak_kaydedilir() {
        let (_d, c) = baglanti();
        // deger sutunu TEXT'tir; metin okuyup ayristir. Gerekce Plan 1 Gorev 6'da.
        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham.parse::<i64>().unwrap(), 3);
    }

    #[test]
    fn not_ve_ek_tablolari_olusur() {
        let (_d, c) = baglanti();
        for tablo in ["progress_notes", "private_notes", "attachments", "templates"] {
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
    fn danisan_tablosuna_riza_ve_saklama_alanlari_eklenir() {
        let (_d, c) = baglanti();
        for sutun in ["riza_tarihi", "riza_dosya_id", "son_temas", "saklama_bitis", "dogum_tarihi"] {
            let sayi: i64 = c
                .query_row(
                    "SELECT count(*) FROM pragma_table_info('clients') WHERE name=?1",
                    [sutun],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(sayi, 1, "clients.{sutun} yok");
        }
    }

    #[test]
    fn bir_randevuya_yalnizca_bir_resmi_not_baglanir() {
        let (_d, c) = baglanti();
        c.execute_batch(
            "INSERT INTO clients (ad_soyad, durum, olusturma_zamani) VALUES ('Ayse','aktif','z');
             INSERT INTO appointments (client_id, baslangic, bitis, durum, olusturma_zamani, guncelleme_zamani)
             VALUES (1,'2026-09-07T14:00','2026-09-07T15:00','planlandi','z','z');
             INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, guncelleme_zamani)
             VALUES (1,1,'dap','ilk not','z');",
        )
        .unwrap();

        let ikinci = c.execute(
            "INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, guncelleme_zamani)
             VALUES (1,1,'dap','ikinci not','z')",
            [],
        );
        assert!(ikinci.is_err(), "randevu basina tek resmi not olmali");
    }

    #[test]
    fn ozel_not_ayri_tabloda_ve_randevuya_bagli() {
        let (_d, c) = baglanti();
        c.execute_batch(
            "INSERT INTO clients (ad_soyad, durum, olusturma_zamani) VALUES ('Ayse','aktif','z');
             INSERT INTO appointments (client_id, baslangic, bitis, durum, olusturma_zamani, guncelleme_zamani)
             VALUES (1,'2026-09-07T14:00','2026-09-07T15:00','planlandi','z','z');
             INSERT INTO private_notes (appointment_id, client_id, icerik, guncelleme_zamani)
             VALUES (1,1,'kendi hipotezim','z');",
        )
        .unwrap();

        let sayi: i64 = c.query_row("SELECT count(*) FROM private_notes", [], |r| r.get(0)).unwrap();
        assert_eq!(sayi, 1);
    }

    #[test]
    fn v2_veritabani_veri_kaybetmeden_v3e_yukselir() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = crate::crypto::keyring::generate_data_key();

        {
            let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
            c.execute_batch(V1).unwrap();
            c.execute_batch(V2).unwrap();
            c.execute(
                "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version','2')
                 ON CONFLICT(anahtar) DO UPDATE SET deger=excluded.deger",
                [],
            )
            .unwrap();
            c.execute(
                "INSERT INTO clients (ad_soyad, durum, olusturma_zamani)
                 VALUES ('Eski Danisan','aktif','2026-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        }

        let c = crate::store::db::open_encrypted(&yol, &key).unwrap();
        migrate(&c).unwrap();

        let ham: String = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ham.parse::<i64>().unwrap(), 3);

        let ad: String =
            c.query_row("SELECT ad_soyad FROM clients WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Eski Danisan", "yukseltme mevcut danisani kaybetmemeli");
    }
```

Son test bu görevin varlık sebebidir: kullanıcı Plan 2 sürümünü kurup danışan girmiş olabilir.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core schema`
Expected: FAIL — sürüm 2, yeni tablolar ve sütunlar yok.

- [ ] **Step 3: Minimum uygulamayı yaz**

```rust
pub const CURRENT_VERSION: i64 = 3;

const V3: &str = r#"
-- Danisan dosyasinin tam hali. ALTER TABLE ... ADD COLUMN, sutun zaten varsa
-- hata verir; migrate() bunu ayri ayri calistirip "duplicate column" hatasini
-- yutar (asagidaki sutun_ekle yardimcisi).

CREATE TABLE IF NOT EXISTS progress_notes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id    INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    client_id         INTEGER NOT NULL REFERENCES clients(id),
    sablon            TEXT NOT NULL DEFAULT 'dap',
    icerik            TEXT NOT NULL DEFAULT '',
    guncelleme_zamani TEXT NOT NULL,
    CHECK (sablon IN ('dap','soap','serbest'))
);

CREATE INDEX IF NOT EXISTS ix_pnotes_client ON progress_notes(client_id);

CREATE TABLE IF NOT EXISTS private_notes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id    INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
    client_id         INTEGER NOT NULL REFERENCES clients(id),
    icerik            TEXT NOT NULL DEFAULT '',
    guncelleme_zamani TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_prnotes_client ON private_notes(client_id);

CREATE TABLE IF NOT EXISTS attachments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id         INTEGER NOT NULL REFERENCES clients(id),
    dosya_adi         TEXT NOT NULL,
    mime              TEXT NOT NULL,
    tur               TEXT NOT NULL DEFAULT 'diger',
    boyut             INTEGER NOT NULL,
    icerik            BLOB NOT NULL,
    eklenme_zamani    TEXT NOT NULL,
    CHECK (tur IN ('onam','test','diger'))
);

CREATE INDEX IF NOT EXISTS ix_att_client ON attachments(client_id);

CREATE TABLE IF NOT EXISTS templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ad          TEXT NOT NULL UNIQUE,
    basliklar   TEXT NOT NULL,
    yerlesik    INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO templates (ad, basliklar, yerlesik) VALUES
    ('DAP',  '["Veri","Değerlendirme","Plan"]', 1),
    ('SOAP', '["Öznel","Nesnel","Değerlendirme","Plan"]', 1),
    ('Serbest', '[]', 1);
"#;

const V3_SUTUNLAR: &[(&str, &str)] = &[
    ("clients", "dogum_tarihi TEXT"),
    ("clients", "riza_tarihi TEXT"),
    ("clients", "riza_dosya_id INTEGER"),
    ("clients", "son_temas TEXT"),
    ("clients", "saklama_bitis TEXT"),
    ("clients", "basvuru_nedeni TEXT"),
    ("clients", "risk_notu TEXT"),
];

fn sutun_ekle(conn: &Connection, tablo: &str, tanim: &str) -> Result<(), rusqlite::Error> {
    let sonuc = conn.execute(&format!("ALTER TABLE {tablo} ADD COLUMN {tanim}"), []);
    match sonuc {
        Ok(_) => Ok(()),
        // Sutun zaten varsa migration yeniden calistirilmis demektir; idempotent olmali.
        Err(rusqlite::Error::SqliteFailure(_, Some(ref m))) if m.contains("duplicate column") => {
            Ok(())
        }
        Err(e) => Err(e),
    }
}

pub fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(V1)?;
    conn.execute_batch(V2)?;
    conn.execute_batch(V3)?;
    for (tablo, tanim) in V3_SUTUNLAR {
        sutun_ekle(conn, tablo, tanim)?;
    }
    conn.execute(
        "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version', ?1)
         ON CONFLICT(anahtar) DO UPDATE SET deger = excluded.deger",
        [CURRENT_VERSION.to_string()],
    )?;
    Ok(())
}
```

`appointment_id`'nin `UNIQUE` olması, "bir randevu = bir seans = bir resmî not" kuralını
veritabanı seviyesinde uygular. Uygulama katmanında tutulan bir kural er geç ihlal edilir.

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core schema`
Expected: önceki testler + yeni 6 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store/schema.rs
git commit -m "feat(veri): sema surum 3 - not tablolari ve danisan dosyasi alanlari"
```

---

### Task 2: Denetim kaydı hacim politikası ve bağlantı ömrü

**Not deposundan ÖNCE yapılmalıdır.** Task 3 ve sonrası bu kurala göre yazılacak; sonradan
uygulanırsa her yazma yolunu tek tek dolaşmak gerekir ve o sırada üretilmiş log satırları
**silinemez**.

`audit_log` tetikleyicilerle korunuyor: satır güncellenemez, silinemez. Bu, KVKK Karar
2018/10'un istediği şey. Ama aynı özellik gürültünün de kalıcı olması demek. Bugünkü desen
"her yazma bir log satırı" ve not editörü **2 saniyede bir** yazacak: bir saatlik seans notu
~1800 satır üretir. Log okunamaz hâle gelirse var olma amacını yitirir — denetlenebilir
olmayan bir denetim kaydı, olmayan denetim kaydıyla aynı şeydir.

Plan 2 aynı sınıftan **iki mevcut ihlal** bıraktı; ikisi de burada kapanır:
- `AnaEkran.yukle()` mount'ta, her hafta değişiminde ve **her mutasyondan sonra** çalışıyor;
  her çalışma bir `goruntuleme` satırı yazıyor. "Geldi" işaretlemek iki satır üretiyor.
- `seriyi_sil` 0 satır silse bile log yazıyor (`sil`/`durum_guncelle`'de bu kontrol var).
  Plan 2 bunu HTTP'ye açtığı için artık dışarıdan tetiklenebilir bir gürültü yolu.

**Files:**
- Modify: `core/src/store/audit.rs` (kuralın tek yeri + birleştirme yardımcısı)
- Modify: `core/src/store/appointments.rs` (`seriyi_sil` 0 satır kontrolü, görüntüleme logu)
- Modify: `web/src/screens/AnaEkran.tsx` (gereksiz yeniden yükleme kaynaklı log)
- Test: `core/src/store/audit.rs`, `core/src/store/appointments.rs` test blokları

**Interfaces:**
- Produces: `pub fn son_kayit_yakin_mi(conn, eylem, varlik, varlik_id, pencere_dk: i64) -> Result<bool, rusqlite::Error>`
  — birleştirme kararını veren tek fonksiyon. **Yazıp yazmamaya** karar verir; var olan
  satıra asla dokunmaz.
- `audit.rs` modül başlığına kural yazılır: hangi işlem loglanır, hangisi loglanmaz, gerekçesiyle.

**Kural (modül başlığında yazılacak hâli):**

*Loglanır:* veriyi değiştiren ve sonradan hesabı verilmesi gereken işlemler (oluşturma,
düzenleme, silme, arşivleme, dışa aktarma) ve **belirli bir danışanın dosyasına erişim**.

*Loglanmaz:* gezinmenin yan etkisi olan tekrarlı okumalar (takvim yenilemesi), doğrulama
sorguları (çakışma kontrolü — Plan 2 Görev 5'te bu karar verildi ve testle korundu), ve
**ara otomatik kayıtlar**.

*Not kayıtları:* not başına, düzenleme oturumu başına **bir** satır. Otomatik kayıt başına
değil.

- [ ] **Step 1: Başarısız testleri yaz**

Testler kuralı kanıtlamalı, varlığını değil:

- Arka arkaya 30 otomatik kayıt **tam olarak 1** log satırı üretir. (Sayan test; "en az 1"
  değil, **eşitlik**.)
- Birleştirme penceresi geçtikten sonra yeni bir satır yazılır — yani birleştirme logu
  tamamen susturmuyor.
- Birleştirme **farklı bir notu** ya da **farklı bir eylemi** gizlemez: aynı pencere içinde
  başka bir nota yazınca ayrı satır oluşur, aynı nota silme yapınca ayrı satır oluşur.
- Birleştirme var olan satırı **değiştirmez**: 30 kayıt sonrası ilk satırın zaman değeri ilk
  yazımdaki değerle aynıdır.
- `seriyi_sil` eşleşen kayıt yokken log **yazmaz**.
- Takvim listesi tekrar tekrar çağrıldığında görüntüleme satırı **birikmez**.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core audit`
Expected: `son_kayit_yakin_mi` tanımlı değil; hacim testleri kırmızı.

- [ ] **Step 3: Minimum uygulamayı yaz**

`son_kayit_yakin_mi`'yi yaz ve `seriyi_sil`'e 0 satır kontrolü ekle. Takvim görüntüleme
logunu kurala uydur. **Var olan satırlara dokunan hiçbir SQL yazma.**

- [ ] **Step 4: Bağlantı ömrü kararını ver ve belgele**

`guard::acik_baglanti` her istekte taze bir SQLCipher bağlantısı açıyor. Bugün doğru (ham
hex anahtar sayesinde KDF maliyeti yok), ama not editörü 2 saniyede bir yazacak: her 2
saniyede bir aç + WAL checkpoint + WAL yıkımı.

Bu görevde **ölç, sonra karar ver**: art arda 30 otomatik kayıt simüle eden bir test yaz,
süreyi ve WAL davranışını gözle. Sonuç ne olursa olsun kararı `guard.rs`'e yorum olarak yaz.

Değiştirmeye karar verirsen, Plan 1'den ertelenmiş şu madde **aynı kararın parçasıdır**,
ayrı ele alınamaz: `unchecked_transaction` iç içe transaction kontrolü yapmıyor; bugün
sorun değil çünkü her istek taze bağlantı alıyor. Havuzlanmış bağlantıda bu **artık doğru
değildir**.

Değiştirmemeye karar verirsen gerekçeyi ve hangi ölçümün bunu desteklediğini yaz. Ölçmeden
"yeterince hızlı" deme.

- [ ] **Step 5: Testlerin geçtiğini doğrula**

Run: `cargo test --workspace` ve `npm --prefix web run test`
Expected: hepsi PASS.

- [ ] **Step 6: Commit**

```bash
git add core/src/store web/src/screens server/src/guard.rs
git commit -m "feat(log): denetim kaydi hacim politikasi ve baglanti omru karari"
```

---

### Task 3: Not deposu — resmî not ve özel not

**Files:**
- Create: `core/src/store/notes.rs`
- Modify: `core/src/store/mod.rs`
- Test: `core/src/store/notes.rs` test bloğu

**Interfaces:**
- Consumes: `store::audit::{kaydet, Eylem, Cihaz}`, `store::clients::DepoHatasi`
- Produces:
  - `pub struct SeansNotu { pub appointment_id: i64, pub client_id: i64, pub sablon: String, pub icerik: String, pub guncelleme_zamani: String }` (Serialize)
  - `pub struct OzelNot { pub appointment_id: i64, pub icerik: String, pub guncelleme_zamani: String }` (Serialize)
  - `pub fn not_getir(conn: &Connection, appointment_id: i64, cihaz: Cihaz) -> Result<SeansNotu, DepoHatasi>` — yoksa boş bir not döndürür, hata değil
  - `pub fn not_kaydet(conn: &Connection, appointment_id: i64, sablon: &str, icerik: &str, cihaz: Cihaz) -> Result<SeansNotu, DepoHatasi>` — upsert
  - `pub fn ozel_not_getir(conn: &Connection, appointment_id: i64, cihaz: Cihaz) -> Result<OzelNot, DepoHatasi>`
  - `pub fn ozel_not_kaydet(conn: &Connection, appointment_id: i64, icerik: &str, cihaz: Cihaz) -> Result<OzelNot, DepoHatasi>`
  - `pub fn danisan_notlari(conn: &Connection, client_id: i64, limit: i64, cihaz: Cihaz) -> Result<Vec<SeansNotu>, DepoHatasi>` — en yeniden eskiye, **yalnızca resmî notlar**

- [ ] **Step 1: Başarısız testleri yaz**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{
        appointments::{olustur as randevu_olustur, YeniRandevu},
        audit::son_kayitlar,
        clients::{ekle as danisan_ekle, YeniDanisan},
        db::open_encrypted,
        schema::migrate,
    };

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

    #[test]
    fn olmayan_not_bos_olarak_doner_hata_degil() {
        let (_d, c, _cid, rid) = kurulum();
        let not = not_getir(&c, rid, Cihaz::Masaustu).unwrap();
        assert_eq!(not.icerik, "");
        assert_eq!(not.sablon, "dap", "varsayilan sablon DAP olmali");
    }

    #[test]
    fn not_kaydedilir_ve_geri_okunur() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "Danisan bugun daha iyiydi.", Cihaz::Masaustu).unwrap();
        let not = not_getir(&c, rid, Cihaz::Masaustu).unwrap();
        assert_eq!(not.icerik, "Danisan bugun daha iyiydi.");
    }

    #[test]
    fn ikinci_kayit_ustune_yazar_yeni_satir_acmaz() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "ilk", Cihaz::Masaustu).unwrap();
        not_kaydet(&c, rid, "dap", "ikinci", Cihaz::Masaustu).unwrap();

        let sayi: i64 =
            c.query_row("SELECT count(*) FROM progress_notes", [], |r| r.get(0)).unwrap();
        assert_eq!(sayi, 1);
        assert_eq!(not_getir(&c, rid, Cihaz::Masaustu).unwrap().icerik, "ikinci");
    }

    #[test]
    fn gecersiz_sablon_reddedilir() {
        let (_d, c, _cid, rid) = kurulum();
        let hata = not_kaydet(&c, rid, "benim_sablonum", "x", Cihaz::Masaustu).unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn ozel_not_resmi_nottan_bagimsiz_saklanir() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "resmi icerik", Cihaz::Masaustu).unwrap();
        ozel_not_kaydet(&c, rid, "kendi hipotezim", Cihaz::Masaustu).unwrap();

        assert_eq!(not_getir(&c, rid, Cihaz::Masaustu).unwrap().icerik, "resmi icerik");
        assert_eq!(ozel_not_getir(&c, rid, Cihaz::Masaustu).unwrap().icerik, "kendi hipotezim");
    }

    #[test]
    fn danisan_notlari_yalnizca_resmi_notlari_dondurur() {
        let (_d, c, cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "resmi icerik", Cihaz::Masaustu).unwrap();
        ozel_not_kaydet(&c, rid, "GIZLI_HIPOTEZ", Cihaz::Masaustu).unwrap();

        let notlar = danisan_notlari(&c, cid, 50, Cihaz::Masaustu).unwrap();
        assert_eq!(notlar.len(), 1);
        assert!(
            !notlar.iter().any(|n| n.icerik.contains("GIZLI_HIPOTEZ")),
            "ozel not dan danisan not listesine sizmamalı"
        );
    }

    #[test]
    fn danisan_notlari_en_yeniden_eskiye_siralanir() {
        let (_d, c, cid, rid1) = kurulum();
        let r2 = randevu_olustur(
            &c,
            &YeniRandevu {
                client_id: cid,
                baslangic: "2026-09-14T14:00".into(),
                bitis: "2026-09-14T15:00".into(),
                ucret: None,
            },
            Cihaz::Masaustu,
        )
        .unwrap();

        not_kaydet(&c, rid1, "dap", "eski", Cihaz::Masaustu).unwrap();
        not_kaydet(&c, r2.id, "dap", "yeni", Cihaz::Masaustu).unwrap();

        let notlar = danisan_notlari(&c, cid, 50, Cihaz::Masaustu).unwrap();
        assert_eq!(notlar[0].icerik, "yeni");
    }

    #[test]
    fn not_icerigi_erisim_loguna_yazilmaz() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "COK_GIZLI_SEANS_ICERIGI", Cihaz::Masaustu).unwrap();
        ozel_not_kaydet(&c, rid, "COK_GIZLI_OZEL_NOT", Cihaz::Masaustu).unwrap();

        for kayit in son_kayitlar(&c, 100).unwrap() {
            let hepsi = format!("{} {} {} {:?}", kayit.eylem, kayit.varlik, kayit.varlik_id, kayit.ayrinti);
            assert!(!hepsi.contains("COK_GIZLI"), "not icerigi loga sizmis: {hepsi}");
        }
    }

    #[test]
    fn ozel_not_erisimi_ayri_varlik_adiyla_loglanir() {
        let (_d, c, _cid, rid) = kurulum();
        ozel_not_kaydet(&c, rid, "x", Cihaz::Masaustu).unwrap();
        let varliklar: Vec<String> =
            son_kayitlar(&c, 20).unwrap().into_iter().map(|k| k.varlik).collect();
        assert!(varliklar.contains(&"private_note".to_string()));
    }
}
```

Altıncı ve sekizinci testler bu planın iki bağlayıcı kısıtını doğrudan doğrular: özel notun
sızmaması ve not içeriğinin loga girmemesi.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core notes`
Expected: derleme hatası.

- [ ] **Step 3: Minimum uygulamayı yaz**

```rust
use crate::store::audit::{kaydet, Cihaz, Eylem};
use crate::store::clients::DepoHatasi;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

pub const GECERLI_SABLONLAR: [&str; 3] = ["dap", "soap", "serbest"];

#[derive(Debug, Clone, Serialize)]
pub struct SeansNotu {
    pub appointment_id: i64,
    pub client_id: i64,
    pub sablon: String,
    pub icerik: String,
    pub guncelleme_zamani: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OzelNot {
    pub appointment_id: i64,
    pub icerik: String,
    pub guncelleme_zamani: String,
}

fn simdi() -> String {
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .expect("nanosaniye sıfırlanamadı")
        .format(&Rfc3339)
        .expect("zaman biçimlendirilemedi")
}

fn randevunun_danisani(conn: &Connection, appointment_id: i64) -> Result<i64, DepoHatasi> {
    conn.query_row("SELECT client_id FROM appointments WHERE id = ?1", [appointment_id], |r| {
        r.get(0)
    })
    .optional()?
    .ok_or(DepoHatasi::Bulunamadi)
}

pub fn not_getir(
    conn: &Connection,
    appointment_id: i64,
    cihaz: Cihaz,
) -> Result<SeansNotu, DepoHatasi> {
    let client_id = randevunun_danisani(conn, appointment_id)?;

    let mevcut = conn
        .query_row(
            "SELECT sablon, icerik, guncelleme_zamani FROM progress_notes WHERE appointment_id = ?1",
            [appointment_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        )
        .optional()?;

    // Erisim logu yalnizca hangi notun goruntulendigini tutar; icerik ASLA loglanmaz.
    kaydet(conn, Eylem::Goruntuleme, "progress_note", &appointment_id.to_string(), cihaz, None)?;

    Ok(match mevcut {
        Some((sablon, icerik, zaman)) => {
            SeansNotu { appointment_id, client_id, sablon, icerik, guncelleme_zamani: zaman }
        }
        // Not yoksa bos bir not doneriz: editor acilirken hata gostermek anlamsiz.
        None => SeansNotu {
            appointment_id,
            client_id,
            sablon: "dap".into(),
            icerik: String::new(),
            guncelleme_zamani: simdi(),
        },
    })
}

pub fn not_kaydet(
    conn: &Connection,
    appointment_id: i64,
    sablon: &str,
    icerik: &str,
    cihaz: Cihaz,
) -> Result<SeansNotu, DepoHatasi> {
    if !GECERLI_SABLONLAR.contains(&sablon) {
        return Err(DepoHatasi::GecersizVeri(format!("Geçersiz not şablonu: {sablon}")));
    }
    let client_id = randevunun_danisani(conn, appointment_id)?;
    let zaman = simdi();

    conn.execute(
        "INSERT INTO progress_notes (appointment_id, client_id, sablon, icerik, guncelleme_zamani)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(appointment_id) DO UPDATE SET
             sablon = excluded.sablon,
             icerik = excluded.icerik,
             guncelleme_zamani = excluded.guncelleme_zamani",
        rusqlite::params![appointment_id, client_id, sablon, icerik, zaman],
    )?;

    kaydet(conn, Eylem::Duzenleme, "progress_note", &appointment_id.to_string(), cihaz, None)?;

    Ok(SeansNotu {
        appointment_id,
        client_id,
        sablon: sablon.to_string(),
        icerik: icerik.to_string(),
        guncelleme_zamani: zaman,
    })
}

pub fn ozel_not_getir(
    conn: &Connection,
    appointment_id: i64,
    cihaz: Cihaz,
) -> Result<OzelNot, DepoHatasi> {
    randevunun_danisani(conn, appointment_id)?;

    let mevcut = conn
        .query_row(
            "SELECT icerik, guncelleme_zamani FROM private_notes WHERE appointment_id = ?1",
            [appointment_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()?;

    kaydet(conn, Eylem::Goruntuleme, "private_note", &appointment_id.to_string(), cihaz, None)?;

    Ok(match mevcut {
        Some((icerik, zaman)) => OzelNot { appointment_id, icerik, guncelleme_zamani: zaman },
        None => OzelNot { appointment_id, icerik: String::new(), guncelleme_zamani: simdi() },
    })
}

pub fn ozel_not_kaydet(
    conn: &Connection,
    appointment_id: i64,
    icerik: &str,
    cihaz: Cihaz,
) -> Result<OzelNot, DepoHatasi> {
    let client_id = randevunun_danisani(conn, appointment_id)?;
    let zaman = simdi();

    conn.execute(
        "INSERT INTO private_notes (appointment_id, client_id, icerik, guncelleme_zamani)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(appointment_id) DO UPDATE SET
             icerik = excluded.icerik,
             guncelleme_zamani = excluded.guncelleme_zamani",
        rusqlite::params![appointment_id, client_id, icerik, zaman],
    )?;

    kaydet(conn, Eylem::Duzenleme, "private_note", &appointment_id.to_string(), cihaz, None)?;

    Ok(OzelNot { appointment_id, icerik: icerik.to_string(), guncelleme_zamani: zaman })
}

pub fn danisan_notlari(
    conn: &Connection,
    client_id: i64,
    limit: i64,
    cihaz: Cihaz,
) -> Result<Vec<SeansNotu>, DepoHatasi> {
    // DIKKAT: bu sorgu YALNIZCA progress_notes okur. private_notes'a asla katilmaz.
    let mut stmt = conn.prepare(
        "SELECT p.appointment_id, p.client_id, p.sablon, p.icerik, p.guncelleme_zamani
         FROM progress_notes p
         JOIN appointments a ON a.id = p.appointment_id
         WHERE p.client_id = ?1
         ORDER BY a.baslangic DESC
         LIMIT ?2",
    )?;
    let notlar = stmt
        .query_map(rusqlite::params![client_id, limit], |r| {
            Ok(SeansNotu {
                appointment_id: r.get(0)?,
                client_id: r.get(1)?,
                sablon: r.get(2)?,
                icerik: r.get(3)?,
                guncelleme_zamani: r.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    kaydet(conn, Eylem::Goruntuleme, "progress_note", "liste", cihaz, None)?;
    Ok(notlar)
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core notes`
Expected: 9 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store/notes.rs core/src/store/mod.rs
git commit -m "feat(veri): resmi ve ozel not deposu, ayri tablolarda"
```

---

### Task 4: Danışan dosyasının tam hâli

**Plan 2'den devredilen iki madde bu göreve aittir:**

1. **`ad_soyad` uzunluk sınırı yok, telefon doğrulanmıyor.** Plan 2 Görev 3'te bilerek
   ertelendi: "danışan dosyasının tam hâli Plan 3'te yazılıyor, doğrulama oraya daha doğal
   düşüyor." Sınırsız bir ad alanı hem arayüzü bozar hem de arama sorgularını yavaşlatır.
   Telefon biçimi katı olmasın (yurt dışı numaraları, dahili hatlar) ama boş olmayan çöp
   veri sessizce kabul edilmesin.
2. **`clients::arsivle`'nin çağrı yeri yok.** Fonksiyon Plan 2 Görev 3'te yazıldı ve test
   edildi; rota hiç eklenmedi. Bugün bir danışan eklenebiliyor ama **arşivlenemiyor** —
   `listele(conn, false, ...)` filtresi doğru çalışıyor ama hiçbir şey `'arsiv'` yazamıyor.
   Sonuç: danışan listesi ve randevu açılır menüsü sınırsız büyür. Bu görevde rota ve
   arayüz bağlantısı eklenir.
   Arşivleme **fiziksel silme değildir** (Plan 2 Görev 3'te doğrulandı) ve arayüz metni bunu
   doğru anlatmalı: kayıtlar duruyor, yalnızca listede görünmüyor.


**Files:**
- Modify: `core/src/store/clients.rs`
- Test: aynı dosyanın test bloğu

**Interfaces:**
- Produces (mevcutlara ek):
  - `Danisan` genişler: `dogum_tarihi`, `basvuru_nedeni`, `risk_notu`, `riza_tarihi`, `riza_dosya_id`, `son_temas`, `saklama_bitis` alanları
  - `pub fn guncelle(conn: &Connection, id: i64, alan: &DanisanGuncelleme, cihaz: Cihaz) -> Result<Danisan, DepoHatasi>`
  - `pub struct DanisanGuncelleme { ... }` (hepsi `Option<...>`, yalnızca verilenler güncellenir)
  - `pub fn son_temasi_tazele(conn: &Connection, client_id: i64, tarih: &str, saklama_yili: i64) -> Result<(), DepoHatasi>` — `saklama_bitis`'i yeniden hesaplar
  - `pub fn saklama_suresi_dolanlar(conn: &Connection, bugun: &str, cihaz: Cihaz) -> Result<Vec<Danisan>, DepoHatasi>`
  - `pub const VARSAYILAN_SAKLAMA_YILI: i64 = 7`

- [ ] **Step 1: Başarısız testleri yaz**

```rust
    #[test]
    fn danisan_alanlari_guncellenir() {
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();

        let g = DanisanGuncelleme {
            basvuru_nedeni: Some("Kaygi".into()),
            risk_notu: Some("Yok".into()),
            ..Default::default()
        };
        let guncel = guncelle(&c, d.id, &g, Cihaz::Masaustu).unwrap();

        assert_eq!(guncel.basvuru_nedeni.as_deref(), Some("Kaygi"));
        assert_eq!(guncel.ad_soyad, "Ayse", "verilmeyen alanlar degismemeli");
    }

    #[test]
    fn riza_tarihi_ve_dosyasi_kaydedilir() {
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        let g = DanisanGuncelleme {
            riza_tarihi: Some("2026-09-07".into()),
            ..Default::default()
        };
        let guncel = guncelle(&c, d.id, &g, Cihaz::Masaustu).unwrap();
        assert_eq!(guncel.riza_tarihi.as_deref(), Some("2026-09-07"));
    }

    #[test]
    fn son_temas_saklama_bitisini_yeniden_hesaplar() {
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();

        son_temasi_tazele(&c, d.id, "2026-09-07", VARSAYILAN_SAKLAMA_YILI).unwrap();

        let guncel = getir(&c, d.id, Cihaz::Masaustu).unwrap();
        assert_eq!(guncel.son_temas.as_deref(), Some("2026-09-07"));
        assert_eq!(guncel.saklama_bitis.as_deref(), Some("2033-09-07"), "7 yil sonrasi");
    }

    #[test]
    fn saklama_suresi_dolanlar_listelenir() {
        let (_d, c) = baglanti();
        let eski = ekle(&c, &yeni("Eski"), Cihaz::Masaustu).unwrap();
        let yeni_d = ekle(&c, &yeni("Yeni"), Cihaz::Masaustu).unwrap();

        son_temasi_tazele(&c, eski.id, "2015-01-01", VARSAYILAN_SAKLAMA_YILI).unwrap();
        son_temasi_tazele(&c, yeni_d.id, "2026-01-01", VARSAYILAN_SAKLAMA_YILI).unwrap();

        let dolanlar = saklama_suresi_dolanlar(&c, "2026-09-07", Cihaz::Masaustu).unwrap();
        assert_eq!(dolanlar.len(), 1);
        assert_eq!(dolanlar[0].ad_soyad, "Eski");
    }

    #[test]
    fn saklama_suresi_dolan_danisan_otomatik_silinmez() {
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Eski"), Cihaz::Masaustu).unwrap();
        son_temasi_tazele(&c, d.id, "2015-01-01", VARSAYILAN_SAKLAMA_YILI).unwrap();

        saklama_suresi_dolanlar(&c, "2026-09-07", Cihaz::Masaustu).unwrap();

        let sayi: i64 = c.query_row("SELECT count(*) FROM clients", [], |r| r.get(0)).unwrap();
        assert_eq!(sayi, 1, "listeleme silme yapmamali");
    }

    #[test]
    fn artik_yil_29_subat_saklama_hesabinda_patlamaz() {
        let (_d, c) = baglanti();
        let d = ekle(&c, &yeni("Ayse"), Cihaz::Masaustu).unwrap();
        son_temasi_tazele(&c, d.id, "2024-02-29", VARSAYILAN_SAKLAMA_YILI).unwrap();
        let guncel = getir(&c, d.id, Cihaz::Masaustu).unwrap();
        assert!(guncel.saklama_bitis.is_some(), "29 Subat + 7 yil hesaplanabilmeli");
    }
```

Son test gerçek bir tuzaktır: 2024-02-29 + 7 yıl = 2031-02-29 diye bir tarih yoktur.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core clients`
Expected: derleme hatası.

- [ ] **Step 3: Minimum uygulamayı yaz**

`Danisan` struct'ına yeni alanları ekle, `satirdan` fonksiyonunu ve tüm `SELECT` listelerini
güncelle. `DanisanGuncelleme` için `#[derive(Default, Deserialize)]` kullan; her alan
`Option<String>` (veya uygun tip) olsun ve `guncelle` yalnızca `Some` olanları yazsın:

```rust
pub const VARSAYILAN_SAKLAMA_YILI: i64 = 7;

pub fn son_temasi_tazele(
    conn: &Connection,
    client_id: i64,
    tarih: &str,
    saklama_yili: i64,
) -> Result<(), DepoHatasi> {
    // 29 Subat + N yil gibi var olmayan tarihler icin gunu ayin son gunune cek.
    let bitis = yil_ekle(tarih, saklama_yili)?;
    let etkilenen = conn.execute(
        "UPDATE clients SET son_temas = ?1, saklama_bitis = ?2 WHERE id = ?3",
        rusqlite::params![tarih, bitis, client_id],
    )?;
    if etkilenen == 0 {
        return Err(DepoHatasi::Bulunamadi);
    }
    Ok(())
}

fn yil_ekle(tarih: &str, yil: i64) -> Result<String, DepoHatasi> {
    let hata = || DepoHatasi::GecersizVeri("Tarih çözümlenemedi.".into());
    let y: i32 = tarih.get(0..4).ok_or_else(hata)?.parse().map_err(|_| hata())?;
    let a: u8 = tarih.get(5..7).ok_or_else(hata)?.parse().map_err(|_| hata())?;
    let g: u8 = tarih.get(8..10).ok_or_else(hata)?.parse().map_err(|_| hata())?;

    let ay = time::Month::try_from(a).map_err(|_| hata())?;
    let hedef_yil = y + yil as i32;
    let son_gun = time::util::days_in_year_month(hedef_yil, ay);
    let gun = g.min(son_gun);

    let d = time::Date::from_calendar_date(hedef_yil, ay, gun).map_err(|_| hata())?;
    Ok(format!("{:04}-{:02}-{:02}", d.year(), d.month() as u8, d.day()))
}

pub fn saklama_suresi_dolanlar(
    conn: &Connection,
    bugun: &str,
    cihaz: Cihaz,
) -> Result<Vec<Danisan>, DepoHatasi> {
    let mut stmt = conn.prepare(
        "SELECT ... FROM clients
         WHERE saklama_bitis IS NOT NULL AND saklama_bitis <= ?1
         ORDER BY saklama_bitis",
    )?;
    let liste = stmt.query_map([bugun], |r| satirdan(r))?.collect::<Result<Vec<_>, _>>()?;

    kaydet(conn, Eylem::Goruntuleme, "client", "saklama_listesi", cihaz, None)?;
    // SILME YOK. Bu fonksiyon yalnizca listeler; imha karari her zaman insanindir.
    Ok(liste)
}
```

`SELECT ...` yerine tüm sütunları açıkça yaz; `SELECT *` kullanma — sütun sırası değişince
sessizce yanlış alan okunur.

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core clients`
Expected: Plan 2'nin 7 testi + yeni 6 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store/clients.rs
git commit -m "feat(veri): danisan dosyasinin tam hali, riza ve saklama takibi"
```

---

### Task 5: Ekli dosyalar

**Files:**
- Create: `core/src/store/attachments.rs`
- Modify: `core/src/store/mod.rs`
- Test: `core/src/store/attachments.rs` test bloğu

**Interfaces:**
- Produces:
  - `pub const AZAMI_DOSYA_BOYUTU: usize = 20 * 1024 * 1024`
  - `pub struct EkBilgisi { pub id: i64, pub client_id: i64, pub dosya_adi: String, pub mime: String, pub tur: String, pub boyut: i64, pub eklenme_zamani: String }` (Serialize — **içerik alanı yok**)
  - `pub fn ekle(conn, client_id, dosya_adi, mime, tur, icerik: &[u8], cihaz) -> Result<EkBilgisi, DepoHatasi>`
  - `pub fn listele(conn, client_id, cihaz) -> Result<Vec<EkBilgisi>, DepoHatasi>`
  - `pub fn icerik_getir(conn, id, cihaz) -> Result<(EkBilgisi, Vec<u8>), DepoHatasi>`
  - `pub fn sil(conn, id, cihaz) -> Result<(), DepoHatasi>`

- [ ] **Step 1: Başarısız testleri yaz**

```rust
    #[test]
    fn dosya_eklenir_ve_icerigi_geri_okunur() {
        let (_d, c, cid) = kurulum();
        let ek = ekle(&c, cid, "onam.pdf", "application/pdf", "onam", b"PDF-icerik", Cihaz::Masaustu)
            .unwrap();
        assert_eq!(ek.boyut, 10);

        let (_bilgi, icerik) = icerik_getir(&c, ek.id, Cihaz::Masaustu).unwrap();
        assert_eq!(icerik, b"PDF-icerik");
    }

    #[test]
    fn listeleme_dosya_icerigini_dondurmez() {
        let (_d, c, cid) = kurulum();
        ekle(&c, cid, "onam.pdf", "application/pdf", "onam", b"GIZLI_ICERIK", Cihaz::Masaustu)
            .unwrap();

        let liste = listele(&c, cid, Cihaz::Masaustu).unwrap();
        let json = serde_json::to_string(&liste).unwrap();
        assert!(!json.contains("GIZLI_ICERIK"), "liste icerik tasimamalı");
        assert!(json.contains("onam.pdf"));
    }

    #[test]
    fn azami_boyut_asilirsa_reddedilir() {
        let (_d, c, cid) = kurulum();
        let buyuk = vec![0u8; AZAMI_DOSYA_BOYUTU + 1];
        let hata = ekle(&c, cid, "buyuk.bin", "application/octet-stream", "diger", &buyuk, Cihaz::Masaustu)
            .unwrap_err();
        assert!(matches!(hata, DepoHatasi::GecersizVeri(_)));
    }

    #[test]
    fn bos_dosya_reddedilir() {
        let (_d, c, cid) = kurulum();
        assert!(ekle(&c, cid, "bos.pdf", "application/pdf", "onam", b"", Cihaz::Masaustu).is_err());
    }

    #[test]
    fn gecersiz_tur_reddedilir() {
        let (_d, c, cid) = kurulum();
        assert!(ekle(&c, cid, "x.pdf", "application/pdf", "baska_tur", b"x", Cihaz::Masaustu).is_err());
    }

    #[test]
    fn silinen_dosya_listede_cikmaz_ve_loglanir() {
        let (_d, c, cid) = kurulum();
        let ek = ekle(&c, cid, "x.pdf", "application/pdf", "diger", b"x", Cihaz::Masaustu).unwrap();
        sil(&c, ek.id, Cihaz::Masaustu).unwrap();

        assert!(listele(&c, cid, Cihaz::Masaustu).unwrap().is_empty());
        let eylemler: Vec<String> =
            crate::store::audit::son_kayitlar(&c, 20).unwrap().into_iter().map(|k| k.eylem).collect();
        assert!(eylemler.contains(&"silme".to_string()));
    }

    #[test]
    fn dosya_icerigi_erisim_loguna_yazilmaz() {
        let (_d, c, cid) = kurulum();
        ekle(&c, cid, "onam.pdf", "application/pdf", "onam", b"COK_GIZLI_ICERIK", Cihaz::Masaustu)
            .unwrap();
        for kayit in crate::store::audit::son_kayitlar(&c, 50).unwrap() {
            let hepsi = format!("{} {:?}", kayit.varlik_id, kayit.ayrinti);
            assert!(!hepsi.contains("COK_GIZLI"), "dosya icerigi loga sizmis");
        }
    }
```

İkinci test önemlidir: `EkBilgisi`'nin içerik alanı taşımaması, listeleme uç noktasının
yanlışlıkla tüm PDF'leri JSON olarak göndermesini yapısal olarak imkânsız kılar.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core attachments`
Expected: derleme hatası.

- [ ] **Step 3: Minimum uygulamayı yaz**

`ekle` içinde boyut ve tür doğrulaması, `INSERT` ile BLOB yazma; `listele` içinde **içerik
sütununu seçmeyen** bir sorgu; `icerik_getir` içinde ayrı bir sorgu ve `Eylem::DisaAktarma`
ile log. Dosya adı kullanıcıdan geldiği için `trim` edilir ve boşsa reddedilir.

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core attachments`
Expected: 7 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store/attachments.rs core/src/store/mod.rs
git commit -m "feat(veri): ekli dosyalar, veritabani icinde BLOB olarak"
```

---

### Task 6: Arama

**Files:**
- Create: `core/src/store/search.rs`
- Modify: `core/src/store/mod.rs`
- Test: `core/src/store/search.rs` test bloğu

**Neden FTS5 değil:** SQLCipher ile FTS5 birlikte çalışır ama ek indeks tabloları üretir ve bu
tabloların içeriği aranabilir metnin **kopyasıdır** — yani özel notların bir kopyası da orada
durur ve "özel not ayrı tablodadır" güvencesini takip etmek zorlaşır. Tek kullanıcılı bir
uygulamada birkaç bin nota `LIKE` yeterince hızlıdır. Performans sorun olursa ayrı bir görevle
FTS5'e geçilir ve özel notlar indeks dışında bırakılır.

**Interfaces:**
- Produces:
  - `pub struct AramaSonucu { pub tur: String, pub client_id: i64, pub danisan_adi: String, pub appointment_id: Option<i64>, pub tarih: Option<String>, pub parca: String }` (Serialize)
  - `pub fn ara(conn: &Connection, sorgu: &str, limit: i64, cihaz: Cihaz) -> Result<Vec<AramaSonucu>, DepoHatasi>`

- [ ] **Step 1: Başarısız testleri yaz**

```rust
    #[test]
    fn danisan_adiyla_bulunur() {
        let (_d, c, _cid, _rid) = kurulum();
        let sonuclar = ara(&c, "Ayse", 20, Cihaz::Masaustu).unwrap();
        assert!(sonuclar.iter().any(|s| s.tur == "danisan"));
    }

    #[test]
    fn not_icerigiyle_bulunur_ve_parca_dondurur() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "Danisan sinav kaygisindan bahsetti.", Cihaz::Masaustu).unwrap();

        let sonuclar = ara(&c, "kaygi", 20, Cihaz::Masaustu).unwrap();
        let not_sonucu = sonuclar.iter().find(|s| s.tur == "not").expect("not bulunmali");
        assert!(not_sonucu.parca.contains("kaygi"), "eslesme parcasi dondurulmeli");
        assert_eq!(not_sonucu.danisan_adi, "Ayse Yilmaz");
    }

    #[test]
    fn ozel_notlar_arama_sonuclarina_girmez() {
        let (_d, c, _cid, rid) = kurulum();
        ozel_not_kaydet(&c, rid, "GIZLI_HIPOTEZ_KAYGI", Cihaz::Masaustu).unwrap();

        let sonuclar = ara(&c, "GIZLI_HIPOTEZ", 20, Cihaz::Masaustu).unwrap();
        assert!(sonuclar.is_empty(), "ozel not aramada cikmamalı");
    }

    #[test]
    fn buyuk_kucuk_harf_ve_turkce_karakter_tolere_edilir() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "Danışan KAYGI yaşıyor.", Cihaz::Masaustu).unwrap();
        assert!(!ara(&c, "kaygi", 20, Cihaz::Masaustu).unwrap().is_empty());
    }

    #[test]
    fn bos_veya_cok_kisa_sorgu_bos_doner() {
        let (_d, c, _cid, _rid) = kurulum();
        assert!(ara(&c, "", 20, Cihaz::Masaustu).unwrap().is_empty());
        assert!(ara(&c, "a", 20, Cihaz::Masaustu).unwrap().is_empty());
    }

    #[test]
    fn joker_karakterler_kacirilir() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "normal icerik", Cihaz::Masaustu).unwrap();
        // "%" LIKE'ta her seyi eslestirir; kacirilmazsa tum notlar doner.
        assert!(ara(&c, "%%", 20, Cihaz::Masaustu).unwrap().is_empty());
    }

    #[test]
    fn arama_sorgusu_erisim_loguna_icerik_yazmaz() {
        let (_d, c, _cid, rid) = kurulum();
        not_kaydet(&c, rid, "dap", "COK_GIZLI", Cihaz::Masaustu).unwrap();
        ara(&c, "COK_GIZLI", 20, Cihaz::Masaustu).unwrap();

        for kayit in crate::store::audit::son_kayitlar(&c, 50).unwrap() {
            let hepsi = format!("{} {:?}", kayit.varlik_id, kayit.ayrinti);
            assert!(!hepsi.contains("COK_GIZLI"), "arama sorgusu loga sizmis");
        }
    }
```

Altıncı ve yedinci testler iki gerçek tuzağı kapatır: kaçırılmayan joker karakter tüm notları
döndürür, ve arama sorgusunun kendisi loglanırsa log dosyası hassas kelimeler biriktirir.

Türkçe karakter toleransı için `LIKE` yeterli olmayabilir (SQLite'ın `LOWER`'ı ASCII'dir);
Rust tarafında hem sorguyu hem karşılaştırılan metni `to_lowercase()` ile normalleştirmek
gerekebilir. Uygulamada bunu çözmenin bir yolu, filtrelemeyi SQL yerine Rust'ta yapmaktır —
tek kullanıcılı bir veri kümesinde kabul edilebilir.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core search`
Expected: derleme hatası.

- [ ] **Step 3: Minimum uygulamayı yaz**

En az 2 karakterlik sorgu şartı; `%` ve `_` karakterlerini kaçır; danışan adları ve
`progress_notes` üzerinde ayrı sorgular; eşleşen yerin çevresinden ~80 karakterlik bir parça
çıkar. `private_notes` tablosuna **hiç dokunma**. Log yalnızca `Eylem::Goruntuleme`,
varlık `"arama"`, ayrıntı `None`.

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core search`
Expected: 7 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store/search.rs core/src/store/mod.rs
git commit -m "feat(veri): danisan ve not aramasi, ozel notlar haric"
```

---

### Task 7: HTTP API — notlar, ekler, arama, danışan dosyası

**Files:**
- Create: `server/src/routes/notes.rs`, `server/src/routes/attachments.rs`, `server/src/routes/search.rs`
- Modify: `server/src/lib.rs`, `server/src/routes/mod.rs`, `server/src/routes/clients.rs`
- Test: `server/tests/notlar_api.rs`

**Interfaces:**
- Uç noktalar (hepsi kilitliyken `401`):
  - `GET/PUT /api/randevular/{id}/not` — resmî not
  - `GET/PUT /api/randevular/{id}/ozel-not` — özel not
  - `GET /api/danisanlar/{id}` , `PATCH /api/danisanlar/{id}`
  - `GET /api/danisanlar/{id}/notlar?limit=`
  - `GET/POST /api/danisanlar/{id}/ekler` , `GET /api/ekler/{id}` , `DELETE /api/ekler/{id}`
  - `GET /api/ara?q=`
  - `GET /api/saklama-suresi-dolanlar`

- [ ] **Step 1: Başarısız testleri yaz**

Plan 2'deki `cagir` yardımcısını kopyala, sonra:

```rust
#[tokio::test]
async fn kilitliyken_not_ucu_401_doner() { /* kurulum, kilitle, GET .../not -> 401 */ }

#[tokio::test]
async fn not_yazilir_ve_geri_okunur() { /* PUT sonra GET, icerik esit */ }

#[tokio::test]
async fn ozel_not_ayri_uctan_gider_ve_danisan_notlarinda_gorunmez() {
    // PUT ozel-not "GIZLI", sonra GET /api/danisanlar/{id}/notlar
    // yanit govdesinde "GIZLI" GECMEMELI.
}

#[tokio::test]
async fn danisan_veri_raporu_ozel_not_icermez() {
    // Bu testin adi onemli: KVKK md.11 kapsamindaki disa aktarim,
    // terapistin ozel notlarini ASLA icermemeli.
}

#[tokio::test]
async fn ek_dosya_yuklenir_ve_liste_icerik_tasimaz() { /* POST ek, GET liste -> icerik yok */ }

#[tokio::test]
async fn arama_ozel_not_dondurmez() { /* ozel nota kelime yaz, ara, bos donmeli */ }

#[tokio::test]
async fn gecersiz_sablon_400_doner() { /* PUT not, sablon="benimki" -> 400 */ }
```

Üçüncü ve dördüncü testler bu planın en önemli güvencesini HTTP seviyesinde doğrular: özel
notun hiçbir dışa açık yoldan sızmaması.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-server notlar_api`
Expected: derleme hatası — uç noktalar yok.

- [ ] **Step 3: Minimum uygulamayı yaz**

Plan 2'deki `guard::acik_baglanti` ve `guard::depo_hatasi` desenini aynen kullan. Ek yükleme
için gövde boyutu sınırı: `axum::extract::DefaultBodyLimit` ile `AZAMI_DOSYA_BOYUTU`.

`GET /api/ekler/{id}` yanıtı `Content-Type` başlığını veritabanındaki `mime` alanından alır ve
`Content-Disposition: attachment` ile döner — tarayıcıda gömülü açılmaması için.

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-server`
Expected: Plan 1 ve 2'nin testleri + yeni 7 test PASS.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(api): not, ek dosya, arama ve danisan dosyasi uc noktalari"
```

---

### Task 8: Not editörü (otomatik kayıtlı)

**Plan 2'den devredilen iki madde bu göreve aittir:**

1. **401 sırasında yazılmamış içerik.** Global kısıtlarda bağlayıcı kural olarak yazıldı.
   Plan 2'de boşta kalma kilidi ekrana bağlandı; artık oturum **yazma sırasında** gerçekten
   kilitlenebilir. Editör 2 saniyede bir yazdığı için bu nadir bir kenar durum değil, olağan
   bir durumdur: terapist danışanı kapıya geçirir, döner, yazmaya devam eder.
   Karar açıkça verilmeli ve testle korunmalı. Kabul edilemez olan tek şey: metnin sessizce
   kaybolması. Kullanıcı ya kilidi açıp kaldığı yerden devam edebilmeli, ya da en azından
   metni kaybettiği kendisine söylenmeli.

2. **`seciliRandevu` `yukle()` sonrası bayatlıyor.** `AnaEkran.tsx`'te `key` `randevu-${id}`
   olduğu için panel, mutasyon öncesi nesneyi tutuyor. Plan 2'de görünmezdi (panel `durum`
   basmıyordu) — **not editörü bu nesneye bağlanacağı için burada görünür hâle gelir.**
   Editörün yazdığı `appointment_id`'nin bayat bir nesneden gelmediğini testle koru.


**Files:**
- Create: `web/src/seans/NotEditoru.tsx`, `web/src/seans/sablon.ts`
- Test: `web/src/seans/NotEditoru.test.tsx`, `web/src/seans/sablon.test.ts`

**Interfaces:**
- Produces:
  - `sablon.ts`: `export const SABLONLAR: Record<'dap'|'soap'|'serbest', string[]>`, `export function sablonMetni(sablon: string): string`
  - `export function NotEditoru({ baslangicIcerik, baslangicSablon, onKaydet, gecikmeMs }: Props)`

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NotEditoru } from './NotEditoru'

function kur(ozel = {}) {
  const props = {
    baslangicIcerik: '',
    baslangicSablon: 'dap',
    onKaydet: vi.fn().mockResolvedValue(undefined),
    gecikmeMs: 20,
    ...ozel,
  }
  render(<NotEditoru {...props} />)
  return props
}

describe('NotEditoru', () => {
  it('kaydet butonu yoktur', () => {
    kur()
    expect(screen.queryByRole('button', { name: /kaydet/i })).toBeNull()
  })

  it('yazdiktan sonra kendiliginden kaydeder', async () => {
    const props = kur()
    await userEvent.type(screen.getByLabelText('Seans notu'), 'merhaba')
    await waitFor(() => expect(props.onKaydet).toHaveBeenCalled())
    expect(props.onKaydet).toHaveBeenCalledWith(
      expect.objectContaining({ icerik: expect.stringContaining('merhaba') }),
    )
  })

  it('hizli yazarken her tusa kayit atmaz', async () => {
    const props = kur({ gecikmeMs: 50 })
    await userEvent.type(screen.getByLabelText('Seans notu'), 'abcdefghij')
    await waitFor(() => expect(props.onKaydet).toHaveBeenCalled())
    expect(props.onKaydet.mock.calls.length).toBeLessThan(5)
  })

  it('kaydedildi gostergesi cikar', async () => {
    kur()
    await userEvent.type(screen.getByLabelText('Seans notu'), 'x')
    expect(await screen.findByText(/kaydedildi/i)).toBeDefined()
  })

  it('kayit basarisiz olursa uyarir ve icerigi silmez', async () => {
    kur({ onKaydet: vi.fn().mockRejectedValue(new Error('ağ hatası')) })
    await userEvent.type(screen.getByLabelText('Seans notu'), 'onemli not')
    expect(await screen.findByText(/kaydedilemedi/i)).toBeDefined()
    expect((screen.getByLabelText('Seans notu') as HTMLTextAreaElement).value).toContain('onemli not')
  })

  it('sablon secilince basliklar bos editore eklenir', async () => {
    kur()
    await userEvent.selectOptions(screen.getByLabelText('Şablon'), 'soap')
    const alan = screen.getByLabelText('Seans notu') as HTMLTextAreaElement
    expect(alan.value).toContain('Öznel')
    expect(alan.value).toContain('Plan')
  })

  it('dolu editorde sablon degisimi mevcut metni ezmez', async () => {
    kur({ baslangicIcerik: 'yazilmis onemli not' })
    await userEvent.selectOptions(screen.getByLabelText('Şablon'), 'soap')
    const alan = screen.getByLabelText('Seans notu') as HTMLTextAreaElement
    expect(alan.value).toContain('yazilmis onemli not')
  })
})
```

Beşinci ve yedinci testler veri kaybının iki gerçek yolunu kapatır: başarısız kaydın sessiz
kalması ve şablon değişiminin yazılmış notu silmesi.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `npm --prefix web run test NotEditoru`
Expected: FAIL — modül yok.

- [ ] **Step 3: Minimum uygulamayı yaz**

`useEffect` içinde `setTimeout` ile geciktirilmiş kayıt (varsayılan 2000 ms); her değişiklikte
önceki zamanlayıcı iptal edilir. Kayıt durumu üç hâlli: `bekliyor` / `kaydedildi HH:MM` /
`kaydedilemedi`. Şablon değişiminde editör boşsa başlıklar eklenir, doluysa yalnızca şablon
alanı güncellenir.

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `npm --prefix web run test`
Expected: tüm web testleri PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/seans
git commit -m "feat(arayuz): otomatik kayitli not editoru ve sablonlar"
```

---

### Task 9: Seans paneli — bağlam ve iki sekmeli not

**Files:**
- Create: `web/src/seans/SeansPaneli.tsx`, `web/src/seans/GecmisNotlar.tsx`
- Modify: `web/src/api.ts`, `web/src/screens/AnaEkran.tsx`
- Test: `web/src/seans/SeansPaneli.test.tsx`

**Interfaces:**
- Produces: `export function SeansPaneli({ randevu, gecmisNotlar, not, ozelNot, onNotKaydet, onOzelNotKaydet, onKapat }: Props)`

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
  it('sol tarafta son seanslarin notlari gorunur', () => { /* baslik + tarih listesi */ })

  it('gecmis notlar katlanmis baslar, tiklayinca acilir', async () => { /* ... */ })

  it('varsayilan olarak Seans Notu sekmesi acilir', () => { /* ... */ })

  it('Ozel Notlarim sekmesi gorsel olarak ayrisir', () => {
    // Ayni renkte iki sekme, karisikliga ve yanlis yere yazmaya yol acar.
    // Bu test, ozel sekmenin ayirt edici bir sinif tasidigini dogrular.
  })

  it('ozel not sekmesinde uyari metni gorunur', () => {
    // "Bu notlar disa aktarimlara ve danisan raporuna dahil edilmez."
  })

  it('sekme degisince yazilan icerik kaybolmaz', async () => { /* ... */ })

  it('gecmis not yoksa bilgilendirici bos durum gosterir', () => { /* ilk seans */ })
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `npm --prefix web run test SeansPaneli`
Expected: FAIL.

- [ ] **Step 3: Minimum uygulamayı yaz**

İki sütunlu düzen (mobilde tek sütun, geçmiş üstte katlanmış). Özel not sekmesi farklı arka
plan ve kalıcı bir uyarı şeridi taşır. `AnaEkran`, takvimden randevu seçilince paneli açar ve
`not`/`ozelNot`/`gecmisNotlar` verilerini yükler.

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `npm --prefix web run test`
Expected: tüm web testleri PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(arayuz): seans paneli, gecmis baglam ve iki sekmeli not"
```

---

### Task 10: Danışan kartı ve hızlı arama

**Files:**
- Create: `web/src/danisan/DanisanKarti.tsx`, `web/src/danisan/RizaBolumu.tsx`, `web/src/arama/HizliArama.tsx`
- Modify: `web/src/screens/AnaEkran.tsx`
- Test: karşılık gelen `.test.tsx` dosyaları

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
  // DanisanKarti
  it('iletisim, basvuru nedeni ve bakiye gorunur', () => {})
  it('riza alinmamissa belirgin uyari gosterir', () => {})
  it('saklama bitis tarihi ve kalan sure gorunur', () => {})
  it('veri raporu disa aktar butonu vardir', () => {})
  it('ekli dosyalar listelenir, icerik indirme baglantisiyla acilir', () => {})

  // HizliArama
  it('Ctrl+K ile acilir', async () => {})
  it('iki karakterden kisa sorguda arama yapmaz', async () => {})
  it('sonuc secilince ilgili seansa gider', async () => {})
  it('Escape ile kapanir ve sorgu temizlenir', async () => {})
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `npm --prefix web run test`
Expected: FAIL.

- [ ] **Step 3: Minimum uygulamayı yaz**

`HizliArama` global bir `keydown` dinleyicisiyle açılır (`Ctrl+K` / `Cmd+K`), sorgu 250 ms
geciktirilir. `RizaBolumu`, rıza tarihi boşsa sarı bir uyarı şeridi gösterir — KVKK açısından
rızasız işlenen bir dosya en somut uyumsuzluktur.

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `npm --prefix web run test`
Expected: tüm web testleri PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(arayuz): danisan karti, riza bolumu ve hizli arama"
```

---

### Task 11: Uçtan uca test

**Files:**
- Create: `e2e/notlar.spec.ts`

- [ ] **Step 1: Testi yaz**

```ts
test('seans notu yaz, otomatik kaydedildigini dogrula, yeniden ac', async ({ page }) => {
  // kurulum -> danisan ekle -> randevu olustur -> randevuya tikla
  // not yaz -> "kaydedildi" gostergesini bekle -> sayfayi yenile -> not yerinde
})

test('ozel not danisan raporuna girmez', async ({ page, request }) => {
  // ozel nota GIZLI yaz, sonra danisan veri raporu ucunu cagir,
  // yanit govdesinde GIZLI GECMEMELI
})

test('kilitle ve tekrar ac, not korunur', async ({ page }) => {})

test('arama notu bulur, ozel notu bulmaz', async ({ page }) => {})
```

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Run: `npm --prefix web run build && npx playwright test notlar`
Expected: FAIL.

- [ ] **Step 3: Eksik arayüz parçalarını tamamla**

Testlerin beklediği etiketleri karşıla.

- [ ] **Step 4: Testin geçtiğini doğrula**

Run: `npx playwright test`
Expected: tüm e2e testleri PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test(e2e): not akisi ve ozel not sizinti dogrulamasi"
```

---

## Planın Bitiş Durumu

Bitince elde olan: takvimden randevuya tıklanınca açılan, solda danışanın son seanslarını
gösteren, sağda otomatik kaydeden şablonlu bir not editörü olan; resmî notu terapistin özel
notundan yapısal olarak ayıran; rıza ve saklama süresini takip eden; ekli dosya tutan ve not
içinde arama yapan bir uygulama.

**Bu planda kasten yok:** ay sonu ödeme özeti ve danışan veri raporunun tam hâli (Plan 4),
telefon erişimi (Plan 4), ölçek/test sonuçları ve ilerleme grafiği (v2).

## Açık Sorular

1. **Şablon başlıkları Türkçeleştirildi** (DAP → Veri/Değerlendirme/Plan). Psikolog İngilizce
   kısaltmalarla çalışıyorsa `templates` tablosundaki yerleşik kayıtlar değişmeli.
2. **Ekli dosya üst sınırı 20 MB.** Taranmış onam formları genelde 1-2 MB'tır; taranmış test
   kitapçıkları daha büyük olabilir.
3. **Arama `LIKE` ile yapılıyor.** Birkaç bin notta yeterli; kullanıcı yıllar içinde çok daha
   fazla not biriktirirse FTS5'e geçiş ayrı bir görev olmalı — özel notlar indeks dışında
   kalmak kaydıyla.
