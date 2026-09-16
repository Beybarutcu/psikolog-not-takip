# Ödeme Takibi, Ay Sonu Özeti ve Şifreli Dışa Aktarım — Uygulama Planı (Plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v1 kapsamının masaüstündeki son üç maddesini ürüne bağlamak: seans panelinden ödeme işaretleme, tek sayfalık ay sonu özeti ve KVKK md. 11 danışan veri raporunun **sunucuda, AES-256 parola korumalı PDF** olarak üretilmesi.

**Architecture:** Plan 1–3 ve yedekleme dalının üstüne kurulur. Ödeme ve özet çekirdek depo katmanında (`core/src/store/`) sorgu + denetim kaydı olarak yazılır, HTTP rotalarıyla arayüze açılır. Veri raporu bugün istemcide düz `.txt` Blob olarak üretiliyor ve sunucu yalnızca ayrı bir "kayıt" ucuyla haberdar ediliyor; bu plan üretimi sunucuya taşır: rapor içeriği çekirdekte toplanır, `core/src/pdf.rs` onu PDF'e çevirip `lopdf` ile AES-256 (şifreleme sürümü V5) parolayla şifreler, uç nokta şifreli baytları döndürür ve aynı istek içinde denetim kaydını yazar. İstemcideki rapor üretimi ve ayrı kayıt ucu **kaldırılır** — iki yol bırakmak, korumanın yanlış yolda kalmasını davet eder.

**Tech Stack:** Rust (rusqlite/SQLCipher, axum), `printpdf` (PDF üretimi, gömülü font), `lopdf` 0.45 (AES-256 V5 şifreleme), React + TypeScript + Tailwind, Vitest, Playwright.

**Önkoşul:** `master` = `88d7bd8` (Plan 1–3, yedekleme/bütünlük, `AnaEkran` kanca ayrımı). 559 Rust + 439 web + 17 e2e testi.

**Kapsam dışı (Plan 5 — telefon erişimi):** yerel ağa bağlanma, eşleştirme + 6 haneli PIN, `devices` tablosu, cihaz başına yetkilendirme, TLS, `psikolog.local`/mDNS, `Cihaz::Telefon`'un üretilmesi. Bu plan hiçbir uç noktayı `127.0.0.1` dışına açmaz.

## Global Constraints

Plan 1–3'ün bütün kısıtları geçerlidir. Özellikle:

- **Özel notlar hiçbir dışa aktarıma, rapora ve özet sorgusuna girmez.** Tasarım §5: *"`private_notes` … dışa aktarım ve raporlara dahil değil"*. Tek mekanizma ayrı tablodur; `WHERE gizli = 0` gibi bir filtreye güvenilmez.
- **Dışa aktarımlar her zaman parola korumalı üretilir** (tasarım §10, KVKK Kurul Kararı 2018/10). Şifresiz dışa aktarım yolu **kalmamalıdır** — istemcideki `.txt` Blob üretimi bu planda kaldırılır.
- **Her dışa aktarma loglanır** (tasarım §4): `Eylem::DisaAktarma` + `LogHacmi::HerCagri`. Kayıt yazılamazsa dışa aktarım baytları **döndürülmez** (fail-closed).
- **Parola hiçbir biçimde loga, URL'ye, `Debug` çıktısına, yanıt gövdesine girmez.** İstek gövdesinde gelir.
- `audit_log` tetikleyicilerle silinemez; `UPDATE`/`DELETE audit_log` yazılmaz. `Ayrinti` **kapalı enum**'dur: doğrulanmamış `String` taşıyan varyant eklenmez; danışan adı, not içeriği, dosya adı loga girmez.
- **Para tam sayı kuruş** (`i64`); kayan nokta yok. Arayüz TL gösterir, sunucuya kuruş gider.
- **Duvar saati sözleşmesi:** `YYYY-AA-GGTSS:DD`, 16 karakter, zaman dilimi yok; tarih aralıkları sözlüksel karşılaştırılır, `Date`/`OffsetDateTime`'a çevirip geri yazılmaz. Ay damgası `YYYY-AA` (7 karakter) biçimindedir ve takvimde geçerli olmalıdır.
- Her veri handler'ının **ilk satırı** `let conn = acik_baglanti(&s)?;` ve kapı **tam bir kez** çağrılır; yapısal test dosya kümesini `server/src/routes/` dizininden türetir. Yeni rota modülü eklendiğinde bu testin toplam sayısı ve modül dağılımı güncellenir.
- Sorgu parametreleri `guard::Sorgu<T>` ile alınır (çıplak `axum::extract::Query` yasak, yapısal testli).
- Hassas veri taşıyan her yeni tipin `Debug`'ı **elle** yazılır; `Serialize` arayüzün ihtiyacı kadar veri taşır.
- Mevcut sözleşmeler bozulmaz: `PATCH /api/randevular/{id} {durum}` (bit düzeyinde kilitli test), `/api/durum`'un alanları, 401 mekanizması (`web/src/api.ts` `istek()` içinde throw'dan **önce senkron**), taslak deposu bellekte.
- **Test disiplini:** `docs/test-yesil-ama-korumuyor.md` — on üç hata biçimi. Her görev raporu, korumaların **mutasyonla** kırıldığını gösterir. Windows'ta mutasyon geri alma `git checkout --` ile yapılır ve `Compiling` satırı görülür.
- **Plan yazım kuralı (Plan 2'nin dersi):** bu plandaki testler sözleşmedir; uygulama kodu imza + SQL + davranış olarak verilir. Örnek uygulama kodu ile test çelişirse **test kazanır**.

**Ortam:** `cargo` PowerShell'den ve `$env:PATH = "C:\StrawberryPerl\perl\bin;C:\Users\axres\AppData\Local\bin\NASM;C:\Users\axres\.cargo\bin;" + $env:PATH` önekiyle çağrılır. `cargo test --workspace` `web/dist` olmadan derlenmez — önce `npm --prefix web run build`.

---

## Dosya Yapısı

```
core/src/store/
├─ appointments.rs     # DEGISIR: odeme_guncelle
├─ audit.rs            # DEGISIR: Ayrinti::OdemeAlindi / Ayrinti::OdemeGeriAlindi
├─ ozet.rs             # YENI: ay_ozeti (seans sayisi, tahsilat, borclular)
├─ veri_raporu.rs      # YENI: rapor_icerigi (danisan + TUM resmi notlar + ek ustverisi)
├─ clients.rs          # DEGISIR: veri_raporu_kaydi KALDIRILIR
├─ search.rs           # DEGISIR: ozel not taramasi core/src tamamina + ozel_not_ cagrilarina genisler
└─ mod.rs              # DEGISIR
core/src/pdf.rs        # YENI: RaporIcerigi -> AES-256 sifreli PDF baytlari (DB bilmez)
core/assets/fonts/     # YENI: NotoSans-Regular.ttf + OFL.txt (Turkce glifler)
server/src/routes/
├─ appointments.rs     # DEGISIR: PATCH /randevular/{id}/odeme
├─ ozet.rs             # YENI: GET /ay-ozeti?ay=YYYY-AA
├─ veri_raporu.rs      # YENI: POST /danisanlar/{id}/veri-raporu {parola}
└─ clients.rs          # DEGISIR: rapor_kaydi_uc KALDIRILIR
web/src/
├─ api.ts              # DEGISIR: odemeGuncelle, ayOzeti, veriRaporuIndir; raporKaydiOlustur KALDIRILIR
├─ seans/SeansPaneli.tsx        # DEGISIR: alt satir (durum + ucret + odendi)
├─ ozet/AyOzeti.tsx             # YENI
├─ danisan/DanisanKarti.tsx     # DEGISIR: parola diyalogu, sunucudan indirme
└─ danisan/veriRaporu.ts        # KALDIRILIR (+ testi)
e2e/odeme.spec.ts               # YENI (playwright.config.ts'e port 7704 ile)
```

`pdf.rs` veritabanını bilmez: yalnızca düz bir `RaporIcerigi` alır. Böylece "rapora ne girer" kararı tek yerde (`store/veri_raporu.rs`) kalır ve o dosya depo katmanının yapısal taramasının kapsamındadır.

---

### Task 1: Ödeme işaretleme — depo ve HTTP

`appointments.odendi` sütunu Plan 2'den beri var ama **hiçbir yazma yolu yok**: yalnızca `INSERT`'te 0 yazılıyor. Sonuç olarak danışan kartındaki bakiye hiçbir zaman azalmıyor (dal incelemesi I1). Tasarım §6: *"Panelin altında tek satırda: geldi/gelmedi/iptal + ücret + ödendi. Ödeme takibi ayrı modül değildir."*

**Files:**
- Modify: `core/src/store/appointments.rs` (yeni `odeme_guncelle`)
- Modify: `core/src/store/audit.rs` (iki birim varyant)
- Modify: `server/src/routes/appointments.rs`, `server/src/lib.rs`
- Test: `core/src/store/appointments.rs` test bloğu, `server/tests/takvim_api.rs`, `server/tests/notlar_api.rs` (yapısal sayı)

**Interfaces:**
- Produces:
  - `pub fn odeme_guncelle(conn: &Connection, id: i64, odendi: bool, cihaz: Cihaz) -> Result<(), DepoHatasi>`
  - `Ayrinti::OdemeAlindi`, `Ayrinti::OdemeGeriAlindi` (birim varyantlar; `metin()` → `"odeme: alindi"` / `"odeme: geri alindi"`)
  - `PATCH /api/randevular/{id}/odeme` gövde `{"odendi": bool}` → `204`
- Davranış:
  - Tek `unchecked_transaction()`: `UPDATE appointments SET odendi = ?1, guncelleme_zamani = ?2 WHERE id = ?3`; etkilenen 0 ise `DepoHatasi::Bulunamadi` **ve log yazılmaz**; aksi hâlde `kaydet(tx, Eylem::Duzenleme, "appointment", id, cihaz, Some(varyant), LogHacmi::HerCagri)`; açık `commit()`.
  - Değer zaten aynıysa da yazılır ve loglanır (kullanıcı eylemi = bir satır; "değişmedi" dalı gereksiz karmaşa).
  - `durum` ne olursa olsun işaretlenebilir (ön ödeme olağan). Sözleşme bu; testle sabitlenir.
  - Ücret, danışan adı, tutar **loga girmez**.
  - `PATCH /api/randevular/{id} {durum}` uç noktasına **dokunulmaz** — ödeme ayrı yol. Gövde şekline göre dallanan bir handler, yazım hatasını sessizce yanlış dala düşürürdü (Plan 2'de `PUT` ayrımı aynı gerekçeyle yapıldı).

- [ ] **Step 1: Başarısız testleri yaz (çekirdek)**

```rust
    #[test]
    fn odeme_isaretlenir_ve_geri_alinir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        assert!(!r.odendi, "on kosul: yeni randevu odenmemis");

        odeme_guncelle(&c, r.id, true, Cihaz::Masaustu).unwrap();
        let hafta = aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
        assert!(hafta.iter().find(|x| x.id == r.id).unwrap().odendi);

        odeme_guncelle(&c, r.id, false, Cihaz::Masaustu).unwrap();
        let hafta = aralik_getir(&c, "2026-09-07T00:00", "2026-09-08T00:00", Cihaz::Masaustu).unwrap();
        assert!(!hafta.iter().find(|x| x.id == r.id).unwrap().odendi, "geri alma da yazilmali (iki yon)");
    }

    #[test]
    fn olmayan_randevuya_odeme_bulunamadi_doner_ve_log_yazmaz() {
        let (_d, c, _cid) = kurulum();
        let once = crate::store::audit::son_kayitlar(&c, 1000).unwrap().len();
        assert!(matches!(odeme_guncelle(&c, 999_999, true, Cihaz::Masaustu), Err(DepoHatasi::Bulunamadi)));
        assert_eq!(crate::store::audit::son_kayitlar(&c, 1000).unwrap().len(), once);
    }

    #[test]
    fn odeme_her_cagrida_bir_log_satiri_yazar_ve_tutari_icermez() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        let once = crate::store::audit::son_kayitlar(&c, 1000).unwrap().len();
        odeme_guncelle(&c, r.id, true, Cihaz::Masaustu).unwrap();
        odeme_guncelle(&c, r.id, true, Cihaz::Masaustu).unwrap();
        let kayitlar = crate::store::audit::son_kayitlar(&c, 1000).unwrap();
        assert_eq!(kayitlar.len(), once + 2, "HerCagri: iki eylem iki satir, birlesme yok");
        let son = &kayitlar[0];
        assert_eq!(son.ayrinti.as_deref(), Some("odeme: alindi"));
        let hepsi = format!("{kayitlar:?}");
        assert!(!hepsi.contains("45000") && !hepsi.contains("450"), "tutar loga girmemeli");
    }

    #[test]
    fn odeme_iptal_edilmis_randevuda_da_isaretlenebilir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        durum_guncelle(&c, r.id, "iptal", Cihaz::Masaustu).unwrap();
        odeme_guncelle(&c, r.id, true, Cihaz::Masaustu).unwrap();
    }

    #[test]
    fn odeme_audit_basarisiz_olursa_yazma_geri_alinir() {
        let (_d, c, cid) = kurulum();
        let r = olustur(&c, &yeni(cid, "2026-09-07T14:00", "2026-09-07T15:00"), Cihaz::Masaustu).unwrap();
        c.execute_batch("DROP TABLE audit_log").unwrap();
        assert!(odeme_guncelle(&c, r.id, true, Cihaz::Masaustu).is_err());
        let odendi: i64 = c.query_row("SELECT odendi FROM appointments WHERE id = ?1", [r.id], |x| x.get(0)).unwrap();
        assert_eq!(odendi, 0, "log yazilamadiysa odeme de yazilmamali");
    }
```

- [ ] **Step 2: Başarısız HTTP testlerini yaz** (`server/tests/takvim_api.rs`, dosyanın mevcut yardımcılarıyla)

Üç test: (a) `PATCH /api/randevular/{id}/odeme {"odendi":true}` → `204` ve ardından `GET /api/randevular?...` yanıtında `odendi: true`; (b) olmayan kimlik → `404` gövdesi `{"hata": ...}`; (c) **kilitliyken** `401` **ve** kilit açılıp okununca `odendi` hâlâ `false` (işlem uygulanmamış). Ayrıca `put_eklendikten_sonra_patch_durum_sozlesmesi_degismez` testi yeşil kalmalı.

- [ ] **Step 3: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core odeme` ve `cargo test -p psikolog-server odeme`
Expected: derleme hatası — `odeme_guncelle` / rota tanımlı değil.

- [ ] **Step 4: Uygula**

Yukarıdaki imza ve davranış. Handler'ın ilk satırı `let conn = acik_baglanti(&s)?;`. Hata eşlemesi mevcut `depo_hatasi` ile. Yapısal testteki (`her_veri_handleri_acik_baglantidan_gecer`) toplam ve modül dağılımını bir artır.

- [ ] **Step 5: Testlerin geçtiğini ve korumaların gerçek olduğunu doğrula**

Run: `cargo test --workspace`
Expected: hepsi PASS. Mutasyonlar (raporla): transaction kaldır → atomiklik testi kırılır; `etkilenen == 0` kontrolünü kaldır → "log yazmaz" testi kırılır; `odendi` yerine sabit `true` yaz → "geri alınır" testi kırılır.

- [ ] **Step 6: Commit**

```bash
git add core/src/store/appointments.rs core/src/store/audit.rs server/src/routes/appointments.rs server/src/lib.rs server/tests/takvim_api.rs server/tests/notlar_api.rs
git commit -m "feat(odeme): randevu odendi isaretlenebilsin (depo + HTTP)"
```

---

### Task 2: Seans panelinin alt satırı — durum, ücret, ödendi

**Files:**
- Modify: `web/src/api.ts` (`takvimApi.odemeGuncelle`)
- Modify: `web/src/seans/SeansPaneli.tsx`, `web/src/screens/anaEkranKancalari/useTakvimAkisi.ts`, `web/src/screens/AnaEkran.tsx`
- Modify: `web/src/danisan/DanisanKarti.tsx` (bakiye etiketi)
- Test: `web/src/seans/SeansPaneli.test.tsx`, `web/src/screens/AnaEkran.test.tsx`, `web/src/api.test.ts`

**Interfaces:**
- Consumes: `PATCH /api/randevular/{id}/odeme` (Task 1), mevcut `takvimApi.randevuDurumu`.
- Produces: `takvimApi.odemeGuncelle(id: number, odendi: boolean): Promise<void>`; `SeansPaneli` yeni prop'ları `onDurumDegis(durum)`, `onOdemeDegis(odendi)`, `randevu.ucret`/`randevu.odendi`/`randevu.durum` okur.

Davranış:
- Panelin altında **tek satır**: `Geldi` / `Gelmedi` / `İptal` düğmeleri (seçili olan `aria-pressed="true"`), ücret TL olarak (`450,00 TL`; ücret yoksa "Ücret girilmemiş"), ve `Ödendi` onay kutusu.
- Ödeme değişince istek atılır ve takvim **yeniden yüklenmeden** seçili randevunun kopyası tazelenir. Denetim hacmi kuralı: bir ödeme işaretleme **tek** `PATCH` üretir; not/geçmiş istekleri yeniden atılmaz (mevcut `"Geldi" isaretlemek not isteklerini YENIDEN ATMAZ` testinin kardeşini yaz).
- İstek başarısız olursa onay kutusu eski hâline döner ve hata `role="alert"` ile bildirilir (iyimser güncelleme sessizce yalan söylemez).
- Danışan kartındaki bakiye etiketi (yedekleme dalında "ödendi işaretleme yolu yok" diye dürüstleştirilmişti) artık gerçeği söyler: *"Bakiye: gelinmiş ve ödenmemiş seanslar. 'Gelmedi' olarak işaretlenen seanslar bu sayıya girmez."*

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
it('odendi kutusu isaretlenince TEK istek gider ve kutu isaretli kalir', async () => {
  const onOdemeDegis = vi.fn().mockResolvedValue(undefined)
  kur({ randevu: { ...ornekRandevu, ucret: 45000, odendi: false }, onOdemeDegis })
  const kutu = screen.getByRole('checkbox', { name: 'Ödendi' })
  expect(kutu).not.toBeChecked()
  await userEvent.click(kutu)
  expect(onOdemeDegis).toHaveBeenCalledTimes(1)
  expect(onOdemeDegis).toHaveBeenCalledWith(true)
  expect(kutu).toBeChecked()
})

it('odeme istegi basarisiz olursa kutu ESKI haline doner ve hata duyurulur', async () => {
  const onOdemeDegis = vi.fn().mockRejectedValue(new Error('Kayıt bulunamadı.'))
  kur({ randevu: { ...ornekRandevu, ucret: 45000, odendi: false }, onOdemeDegis })
  const kutu = screen.getByRole('checkbox', { name: 'Ödendi' })
  await userEvent.click(kutu)
  expect(await screen.findByRole('alert')).toHaveTextContent('Kayıt bulunamadı.')
  expect(kutu).not.toBeChecked()
})

it('ucret TL olarak gosterilir; ucret yoksa bunu soyler', () => {
  const { rerender } = kur({ randevu: { ...ornekRandevu, ucret: 45050 } })
  expect(screen.getByText('450,50 TL')).toBeInTheDocument()
  rerender(panel({ randevu: { ...ornekRandevu, ucret: null } }))
  expect(screen.getByText('Ücret girilmemiş')).toBeInTheDocument()
})

it('secili durum aria-pressed ile belirtilir', () => {
  kur({ randevu: { ...ornekRandevu, durum: 'gelmedi' } })
  expect(screen.getByRole('button', { name: 'Gelmedi' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'Geldi' })).toHaveAttribute('aria-pressed', 'false')
})
```

`kur`/`panel`/`ornekRandevu` dosyadaki mevcut yardımcılarla uyumlu hâle getirilir; iddiaların kendisi değişmez. `AnaEkran.test.tsx`'e: ödeme işaretlemek **yalnızca** `PATCH /api/randevular/{id}/odeme` üretir (istek listesi sayılır; not ve geçmiş yolları yeniden istenmez) ve seans değişince (`key={seans-...}`) kutu yeni randevunun değerini gösterir.

- [ ] **Step 2: Başarısız olduklarını doğrula** — Run: `npm --prefix web run test -- SeansPaneli AnaEkran` — Expected: FAIL.

- [ ] **Step 3: Uygula** — yukarıdaki davranış. `aria-pressed`, `role="alert"`, TL biçimi `Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 })` ile.

- [ ] **Step 4: Geçtiklerini doğrula** — Run: `npm --prefix web run build` ve `npm --prefix web run test`. Mutasyonlar: geri dönüşü (rollback) kaldır → ikinci test kırılır; tazeleme yerine `yukle()` çağır → AnaEkran istek sayısı testi kırılır.

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/api.test.ts web/src/seans/SeansPaneli.tsx web/src/seans/SeansPaneli.test.tsx web/src/screens/AnaEkran.tsx web/src/screens/AnaEkran.test.tsx web/src/screens/anaEkranKancalari/useTakvimAkisi.ts web/src/danisan/DanisanKarti.tsx
git commit -m "feat(seans): panel alt satiri -- durum, ucret ve odendi"
```

---

### Task 3: Ay sonu özeti — depo ve HTTP

Tasarım §6: *"Ay sonu özeti: seans sayısı, tahsilat, borçlu danışanlar. Tek sayfa."*

**Files:**
- Create: `core/src/store/ozet.rs`
- Modify: `core/src/store/mod.rs`
- Create: `server/src/routes/ozet.rs`; Modify: `server/src/routes/mod.rs`, `server/src/lib.rs`
- Test: `core/src/store/ozet.rs` test bloğu, `server/tests/takvim_api.rs`, `server/tests/notlar_api.rs` (yapısal sayı)

**Interfaces:**
- Produces:
  - `pub struct AyOzeti { pub ay: String, pub seans_sayisi: i64, pub tahsilat_kurus: i64, pub bekleyen_kurus: i64, pub borclular: Vec<Borclu> }` (`Serialize`, elle `Debug`)
  - `pub struct Borclu { pub client_id: i64, pub ad_soyad: String, pub borc_kurus: i64, pub seans_sayisi: i64 }` (`Serialize`, elle `Debug`: `client_id` ve `ad_soyad` `<gizli>`)
  - `pub fn ay_ozeti(conn: &Connection, ay: &str, cihaz: Cihaz) -> Result<AyOzeti, DepoHatasi>`
  - `GET /api/ay-ozeti?ay=YYYY-AA` → `200` `AyOzeti` JSON; geçersiz ay → `400 {"hata": ...}`

Sayım kuralları (sözleşme — testlerle sabitlenir):
- Yalnızca `durum = 'geldi'` randevular sayılır. `gelmedi`, `iptal`, `planlandi` **sayılmaz**. (Ürün kararı açık: "gelmedi" ücretlendirmesi psikoloğun politikasına bağlı; bugünkü arayüz de sayılmadığını açıkça yazıyor. Karar değişirse tek yer burası.)
- Ay aralığı: `baslangic >= 'YYYY-AA-01T00:00' AND baslangic < '<sonraki ay>-01T00:00'` (sözlüksel; Aralık → sonraki yılın Ocak'ı).
- `tahsilat_kurus` = geldi ∧ odendi ∧ ucret NOT NULL toplamı; `bekleyen_kurus` = geldi ∧ ¬odendi ∧ ucret NOT NULL toplamı; `seans_sayisi` = geldi sayısı (ücretsiz seanslar dahil).
- `borclular`: geldi ∧ ¬odendi ∧ ucret NOT NULL ∧ ucret > 0 olanların danışan başına toplamı; **arşivlenmiş danışanlar dahil** (borç arşivle kaybolmaz); sıralama `borc_kurus DESC, ad_soyad COLLATE NOCASE ASC, client_id ASC`.
- Danışan adı yetkili kaynaktan: `JOIN clients c ON c.id = a.client_id`.
- Log: `Eylem::Goruntuleme`, varlık `"ozet"`, `varlik_id = "ay:YYYY-AA"`, `ayrinti = None`, `LogHacmi::OturumBasi(BIRLESTIRME_PENCERESI_DK)` (ekran ay değiştirdikçe tekrar çağrılır; ay farklıysa anahtar farklı). Geçersiz ay → log **yazılmaz**.
- `private_notes` bu modülde **geçmez** (Task 5'in genişletilmiş taraması da kapsar).

- [ ] **Step 1: Başarısız testleri yaz**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{
        appointments::{durum_guncelle, odeme_guncelle, olustur, YeniRandevu},
        audit::{son_kayitlar, Cihaz},
        clients::{arsivle, ekle as danisan_ekle, YeniDanisan},
        db::open_encrypted,
        schema::migrate,
    };

    fn kurulum() -> (tempfile::TempDir, rusqlite::Connection) {
        let dir = tempfile::tempdir().unwrap();
        let c = open_encrypted(&dir.path().join("v.db"), &generate_data_key()).unwrap();
        migrate(&c).unwrap();
        (dir, c)
    }

    fn danisan(c: &rusqlite::Connection, ad: &str) -> i64 {
        danisan_ekle(c, &YeniDanisan { ad_soyad: ad.into(), telefon: None }, Cihaz::Masaustu).unwrap().id
    }

    /// Randevu olusturur, durumunu ve odemesini ayarlar.
    fn seans(c: &rusqlite::Connection, cid: i64, bas: &str, ucret: Option<i64>, durum: &str, odendi: bool) -> i64 {
        let bitis = format!("{}T23:59", &bas[..10]);
        let r = olustur(c, &YeniRandevu { client_id: cid, baslangic: bas.into(), bitis, ucret }, Cihaz::Masaustu).unwrap();
        if durum != "planlandi" { durum_guncelle(c, r.id, durum, Cihaz::Masaustu).unwrap(); }
        if odendi { odeme_guncelle(c, r.id, true, Cihaz::Masaustu).unwrap(); }
        r.id
    }

    #[test]
    fn yalnizca_gelinmis_seanslar_sayilir_ve_tutarlar_kurusla_dogru() {
        let (_d, c) = kurulum();
        let a = danisan(&c, "Ayse");
        seans(&c, a, "2026-09-02T10:00", Some(45000), "geldi", true);
        seans(&c, a, "2026-09-09T10:00", Some(45000), "geldi", false);
        seans(&c, a, "2026-09-16T10:00", Some(45000), "gelmedi", false);
        seans(&c, a, "2026-09-23T10:00", Some(45000), "iptal", false);
        seans(&c, a, "2026-09-30T10:00", Some(45000), "planlandi", false);
        seans(&c, a, "2026-09-25T10:00", None, "geldi", false);

        let o = ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
        assert_eq!(o.seans_sayisi, 3, "yalnizca geldi (ucretsiz dahil)");
        assert_eq!(o.tahsilat_kurus, 45000);
        assert_eq!(o.bekleyen_kurus, 45000, "gelmedi/iptal/planlandi borca girmez");
    }

    #[test]
    fn ay_siniri_dahil_haric_dogru_ve_aralik_yil_devrediyor() {
        let (_d, c) = kurulum();
        let a = danisan(&c, "Ayse");
        seans(&c, a, "2026-08-31T23:00", Some(100), "geldi", true);
        seans(&c, a, "2026-09-01T00:00", Some(200), "geldi", true);
        seans(&c, a, "2026-09-30T23:30", Some(400), "geldi", true);
        seans(&c, a, "2026-10-01T00:00", Some(800), "geldi", true);
        seans(&c, a, "2026-12-31T23:00", Some(1600), "geldi", true);
        seans(&c, a, "2027-01-01T00:00", Some(3200), "geldi", true);

        assert_eq!(ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap().tahsilat_kurus, 600);
        assert_eq!(ay_ozeti(&c, "2026-12", Cihaz::Masaustu).unwrap().tahsilat_kurus, 1600);
        assert_eq!(ay_ozeti(&c, "2027-01", Cihaz::Masaustu).unwrap().tahsilat_kurus, 3200);
    }

    #[test]
    fn borclular_tutara_gore_sonra_ada_gore_siralanir_ve_arsivliler_dahildir() {
        let (_d, c) = kurulum();
        // Ekleme sirasi, beklenen siranin NE AYNISI NE TERSI (bicim 8).
        let z = danisan(&c, "Zeynep");
        let b = danisan(&c, "Burak");
        let a = danisan(&c, "Ali");
        seans(&c, z, "2026-09-03T10:00", Some(30000), "geldi", false);
        seans(&c, b, "2026-09-04T10:00", Some(90000), "geldi", false);
        seans(&c, a, "2026-09-05T10:00", Some(30000), "geldi", false);
        seans(&c, a, "2026-09-06T10:00", Some(0), "geldi", false);
        arsivle(&c, b, Cihaz::Masaustu).unwrap();

        let o = ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
        let sira: Vec<&str> = o.borclular.iter().map(|x| x.ad_soyad.as_str()).collect();
        assert_eq!(sira, ["Burak", "Ali", "Zeynep"], "tutar DESC, esitlikte ad ASC; arsivli Burak dahil");
        assert_eq!(o.borclular[1].seans_sayisi, 1, "0 TL'lik seans borc sayilmaz");
    }

    #[test]
    fn odenmis_danisan_borclular_listesinden_cikar() {
        let (_d, c) = kurulum();
        let a = danisan(&c, "Ayse");
        let r = seans(&c, a, "2026-09-02T10:00", Some(45000), "geldi", false);
        assert_eq!(ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap().borclular.len(), 1, "on kosul");
        odeme_guncelle(&c, r, true, Cihaz::Masaustu).unwrap();
        assert!(ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap().borclular.is_empty());
    }

    #[test]
    fn gecersiz_ay_reddedilir_gecerli_ay_kabul_edilir_ve_gecersizde_log_yazilmaz() {
        let (_d, c) = kurulum();
        let once = son_kayitlar(&c, 1000).unwrap().len();
        for kotu in ["2026-9", "2026-13", "2026-00", "2026-09-01", "", "abcd-ef"] {
            assert!(matches!(ay_ozeti(&c, kotu, Cihaz::Masaustu), Err(DepoHatasi::GecersizVeri(_))), "{kotu}");
        }
        assert_eq!(son_kayitlar(&c, 1000).unwrap().len(), once);
        for iyi in ["2026-01", "2026-12", "2028-02"] {
            assert!(ay_ozeti(&c, iyi, Cihaz::Masaustu).is_ok(), "{iyi}");
        }
    }

    #[test]
    fn ozet_goruntulemesi_ay_basina_birlesir_farkli_ay_ayri_satir() {
        let (_d, c) = kurulum();
        let once = son_kayitlar(&c, 1000).unwrap().len();
        for _ in 0..5 { ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap(); }
        ay_ozeti(&c, "2026-08", Cihaz::Masaustu).unwrap();
        let yeni: Vec<_> = son_kayitlar(&c, 1000).unwrap().into_iter().take(son_kayitlar(&c, 1000).unwrap().len() - once).collect();
        assert_eq!(yeni.len(), 2, "5 x Eylul = 1 satir, Agustos = 1 satir");
        assert!(yeni.iter().all(|k| k.ayrinti.is_none()));
    }

    #[test]
    fn debug_danisan_adini_ve_kimligini_basmaz_serialize_basar() {
        let (_d, c) = kurulum();
        let a = danisan(&c, "COKGIZLIAD");
        seans(&c, a, "2026-09-02T10:00", Some(45000), "geldi", false);
        let o = ay_ozeti(&c, "2026-09", Cihaz::Masaustu).unwrap();
        let hata_ayikla = format!("{o:?} {:?}", Ok::<_, ()>(&o));
        assert!(!hata_ayikla.contains("COKGIZLIAD"));
        assert!(serde_json::to_string(&o).unwrap().contains("COKGIZLIAD"), "arti yon: arayuz adi gormeli");
    }
}
```

Ay sonu hacim testinin yanında **pencere dışı** satır ekleyip (mevcut `eski_satir_ekle` deseni, `audit.rs` testleri) iki satır beklendiğini gösteren susturma yönü testini de yaz (biçim 7).

- [ ] **Step 2: HTTP testleri** — (a) geçerli ay `200` ve alanlar; (b) `?ay=2026-13` → `400 {"hata"}`; (c) `ay` yok → `400 {"hata"}` (JSON, `guard::Sorgu`); (d) kilitliyken `401` ve gövdede danışan adı yok.

- [ ] **Step 3: Başarısız olduklarını doğrula** — `cargo test -p psikolog-core ozet` → derleme hatası.

- [ ] **Step 4: Uygula** — `ay_gecerli_mi(ay)`: 7 karakter, `-` konumu 4, yıl 4 rakam, ay `01..=12`; sonraki ay dizgisi hesaplanır. Tek SQL ile toplamlar (`SUM(CASE ...)`), ikinci SQL ile borçlular (`GROUP BY a.client_id`). Handler ilk satırı kapı; yapısal sayıyı güncelle.

- [ ] **Step 5: Doğrula** — `cargo test --workspace`. Mutasyonlar: `durum = 'geldi'` koşulunu kaldır → ilk test; `<` yerine `<=` → sınır testi; sıralamayı `ad ASC` yap → borçlular testi; pencereyi 525600 yap → susturma testi.

- [ ] **Step 6: Commit**

```bash
git add core/src/store/ozet.rs core/src/store/mod.rs server/src/routes/ozet.rs server/src/routes/mod.rs server/src/lib.rs server/tests/takvim_api.rs server/tests/notlar_api.rs
git commit -m "feat(ozet): ay sonu ozeti -- seans sayisi, tahsilat, borclular"
```

---

### Task 4: Ay sonu özeti ekranı

**Files:**
- Create: `web/src/ozet/AyOzeti.tsx`, `web/src/ozet/AyOzeti.test.tsx`
- Modify: `web/src/api.ts` (`ozetApi.ayOzeti(ay: string): Promise<AyOzeti>`), `web/src/screens/AnaEkran.tsx`
- Test: `web/src/api.test.ts` (`Object.keys(ozetApi)` pinlenir), `web/src/screens/AnaEkran.test.tsx`

**Interfaces:**
- Consumes: `GET /api/ay-ozeti?ay=` (Task 3).
- Produces: `export function AyOzeti({ bugun, onDanisanAc }: { bugun: string /* YYYY-AA-GG */; onDanisanAc: (id: number) => void })`

Davranış:
- AnaEkran'da "Ay sonu özeti" düğmesiyle açılır; başlık `Eylül 2026` (Türkçe ay adı; `web/src/takvim/hafta.ts`'teki `AYLAR` tek kaynaktır).
- `Önceki ay` / `Sonraki ay` düğmeleri; ay değişince tek istek.
- Üç sayı: "Gelinen seans", "Tahsilat", "Bekleyen" (TL biçimi Task 2 ile aynı yardımcıdan).
- Borçlular listesi; bir satıra tıklamak `onDanisanAc(client_id)` çağırır. Borçlu yoksa "Bu ay bekleyen ödeme yok."
- Kapsam cümlesi her zaman görünür: *"Yalnızca 'geldi' olarak işaretlenen seanslar sayılır; 'gelmedi' ve 'iptal' dahil değildir."*
- Yanıt beklerken önceki ayın rakamları **gösterilmez** (bayat veri, biçim 6'nın arayüz hâli): ay değiştiği anda sayılar "…" olur.
- 401 → merkezi mekanizma (bileşen kendi özel akışını kurmaz).

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
it('ay degisince ONCEKI ayin rakamlari gosterilmez, tek istek gider', async () => {
  const eylul = kapi<AyOzeti>()
  const ekim = kapi<AyOzeti>()
  const ayOzeti = vi.fn((ay: string) => (ay === '2026-09' ? eylul.promise : ekim.promise))
  render(<AyOzeti bugun="2026-09-16" onDanisanAc={vi.fn()} />, { ayOzeti })
  eylul.coz({ ay: '2026-09', seans_sayisi: 7, tahsilat_kurus: 315000, bekleyen_kurus: 45000, borclular: [] })
  expect(await screen.findByText('3.150,00 TL')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: 'Sonraki ay' }))
  expect(ayOzeti).toHaveBeenLastCalledWith('2026-10')
  expect(ayOzeti).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('3.150,00 TL')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Ekim 2026' })).toBeInTheDocument()
})

it('aralik -> ocak yil devreder', async () => {
  const ayOzeti = vi.fn().mockResolvedValue(bosOzet('2026-12'))
  render(<AyOzeti bugun="2026-12-05" onDanisanAc={vi.fn()} />, { ayOzeti })
  await userEvent.click(screen.getByRole('button', { name: 'Sonraki ay' }))
  expect(ayOzeti).toHaveBeenLastCalledWith('2027-01')
})

it('borclu satirina tiklamak danisani acar; borclu yoksa bunu soyler', async () => {
  const onDanisanAc = vi.fn()
  const ayOzeti = vi.fn().mockResolvedValue({
    ...bosOzet('2026-09'),
    borclular: [{ client_id: 42, ad_soyad: 'Ayşe Yılmaz', borc_kurus: 90000, seans_sayisi: 2 }],
  })
  const { unmount } = render(<AyOzeti bugun="2026-09-16" onDanisanAc={onDanisanAc} />, { ayOzeti })
  await userEvent.click(await screen.findByRole('button', { name: /Ayşe Yılmaz/ }))
  expect(onDanisanAc).toHaveBeenCalledWith(42)
  unmount()

  render(<AyOzeti bugun="2026-09-16" onDanisanAc={onDanisanAc} />, { ayOzeti: vi.fn().mockResolvedValue(bosOzet('2026-09')) })
  expect(await screen.findByText('Bu ay bekleyen ödeme yok.')).toBeInTheDocument()
})

it('kapsam cumlesi her zaman gorunur', async () => {
  render(<AyOzeti bugun="2026-09-16" onDanisanAc={vi.fn()} />, { ayOzeti: vi.fn().mockResolvedValue(bosOzet('2026-09')) })
  expect(await screen.findByText(/'gelmedi' ve 'iptal' dahil değildir/)).toBeInTheDocument()
})
```

`kapi`, `bosOzet` ve `render(..., { ayOzeti })` enjeksiyonu test dosyasında tanımlanır (API modülü `vi.mock` ile ya da prop üzerinden; mevcut `SeansPaneli.test.tsx`'teki kapı deseni emsaldir).

- [ ] **Step 2: Başarısız olduklarını doğrula** — `npm --prefix web run test -- AyOzeti` → FAIL.
- [ ] **Step 3: Uygula.**
- [ ] **Step 4: Doğrula** — `npm --prefix web run build`, `npm --prefix web run test`. Mutasyonlar: ay değişiminde eski veriyi temizleme satırını kaldır → ilk test; Aralık devrini `+1` ay sayısıyla yap → ikinci test.
- [ ] **Step 5: Commit**

```bash
git add web/src/ozet web/src/api.ts web/src/api.test.ts web/src/screens/AnaEkran.tsx web/src/screens/AnaEkran.test.tsx
git commit -m "feat(ozet): ay sonu ozeti ekrani"
```

---

### Task 5: AES-256 parola korumalı PDF üretimi

`core/src/pdf.rs` veritabanını bilmez: düz bir `RaporIcerigi` alır, şifreli PDF baytları döndürür.

**Biçim kararı (gerekçe):** Rapor danışana verilir (KVKK md. 11); danışanın hangi işletim sistemini kullandığı bilinmez. **Parola korumalı PDF** macOS Önizleme, Windows'taki tarayıcılar ve Adobe Reader'da ek yazılım olmadan açılır. AES-256 şifreli ZIP ise macOS'un yerleşik Arşiv İzlencesi'nde **açılmaz**. `lopdf` 0.45 `EncryptionVersion::V5` (AES-256, `Aes256CryptFilter`) ile şifreli yazmayı destekler (`Document::encrypt(&EncryptionState)`, `EncryptionState: TryFrom<EncryptionVersion>`).

**Durdurma koşulu:** `printpdf` → `lopdf::Document::load_mem` → `encrypt(V5)` → `save_to` hattı Step 3'teki testleri geçen bir dosya üretemezse **BLOCKED** raporla (hangi adımın neden başarısız olduğunu kanıtla). Şifresiz PDF'e, RC4'e, AES-128'e ya da ZIP'e **sessizce geçme** — biçim değişikliği bir ürün kararıdır.

**Files:**
- Create: `core/src/pdf.rs`, `core/assets/fonts/NotoSans-Regular.ttf`, `core/assets/fonts/OFL.txt`
- Modify: `core/Cargo.toml` (`printpdf`, `lopdf = "0.45"`; sürümleri sabitle), `core/src/lib.rs`
- Modify: `core/src/store/search.rs` (özel not yapısal taramasının genişletilmesi — aşağıda)
- Test: `core/src/pdf.rs` test bloğu, `core/src/store/search.rs` test bloğu

**Interfaces:**
- Produces:
  - `pub struct RaporIcerigi { pub baslik: String, pub bolumler: Vec<RaporBolumu> }` (elle `Debug`: içerik `<gizli>`)
  - `pub struct RaporBolumu { pub baslik: String, pub satirlar: Vec<String> }` (elle `Debug`)
  - `pub enum PdfHatasi { ParolaCokKisa, Uretim(String), Sifreleme(String) }` — `Uretim`/`Sifreleme` mesajları kütüphane hatasıdır, **rapor içeriği taşımaz**
  - `pub const ASGARI_PAROLA: usize = 8;`
  - `pub fn sifreli_pdf(icerik: &RaporIcerigi, parola: &str) -> Result<Vec<u8>, PdfHatasi>`

Davranış:
- Parola `ASGARI_PAROLA` karakterden (bayt değil, `chars().count()`) kısaysa `ParolaCokKisa`.
- Kullanıcı parolası = sahip parolası = verilen parola (danışan dosyayı açabilir; ayrı bir sahip parolası üretip saklamak yeni bir sır yönetimi demek). İzinler: yazdırma ve kopyalama açık (danışanın kendi verisi).
- 32 baytlık dosya şifreleme anahtarı `rand` ile her çağrıda yeni üretilir.
- Uzun satırlar sayfa genişliğinde sarılır, taşan içerik yeni sayfaya geçer (seans notları uzundur; kırpılmış bir KVKK raporu sessiz bir yanlış beyandır).
- Gömülü font Türkçe glifleri (`ç ğ ı İ ö ş ü Ç Ğ Ö Ş Ü`) içerir; Noto Sans (SIL OFL 1.1) `include_bytes!` ile gömülür, `OFL.txt` aynı dizinde.

**Özel not taramasının genişletilmesi (biçim 12):** `depo_katmaninda_ozel_not_tablosu_yalnizca_izinli_modullerde_gecer` bugün yalnızca `core/src/store/` dizinine düz bakıyor ve yalnızca `private_notes` **tablo adını** arıyor. Yeni bir rapor modülü `notes::ozel_not_getir`'i çağırsa ya da `core/src/pdf.rs` gibi `store` dışı bir dosya tabloya dokunsa yakalanmaz. Testi şöyle genişlet:
1. Dosya kümesi `core/src/` altından **özyinelemeli** türetilir (`dosyalar.len()` alt sınırı buna göre yükseltilir).
2. `private_notes` dizgisi yalnızca `OZEL_NOTA_DOKUNABILEN` modüllerinde geçebilir (mevcut kural, yeni kapsam).
3. **Yeni kural:** `ozel_not_` önekli fonksiyon adları yalnızca `store/notes.rs` içinde tanımlanabilir/geçebilir (`OzelNot` tipi de). Başka bir çekirdek modül onları çağıramaz.
4. Mutasyonla kanıtla: geçici `core/src/store/rapor_denemesi.rs` içinde `crate::store::notes::ozel_not_getir` çağır → test kırılır; geçici `core/src/pdf_denemesi.rs` içinde `"private_notes"` geçir → test kırılır; ikisini sil.

- [ ] **Step 1: Başarısız testleri yaz**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const KANARYA: &str = "SIFRESIZ-SIZINTI-KANARYASI-4F7A";
    const TURKCE: &str = "Çağrı İşık — ğüşöç ĞÜŞÖÇ ı İ";

    fn icerik() -> RaporIcerigi {
        RaporIcerigi {
            baslik: "DANIŞAN VERİ RAPORU".into(),
            bolumler: vec![RaporBolumu {
                baslik: "Seans notları".into(),
                satirlar: vec![KANARYA.into(), TURKCE.into(), "uzun ".repeat(2000)],
            }],
        }
    }

    fn metin_cikar(pdf: &[u8], parola: &str) -> Result<String, String> {
        let mut doc = lopdf::Document::load_mem(pdf).map_err(|e| e.to_string())?;
        if doc.is_encrypted() {
            doc.decrypt(parola).map_err(|e| e.to_string())?;
        }
        let sayfalar: Vec<u32> = doc.get_pages().keys().copied().collect();
        doc.extract_text(&sayfalar).map_err(|e| e.to_string())
    }

    #[test]
    fn dosya_sifrelidir_ve_ham_baytlarda_icerik_gecmez() {
        let pdf = sifreli_pdf(&icerik(), "dogru-parola-123").unwrap();
        assert!(pdf.starts_with(b"%PDF-"), "gecerli bir PDF olmali");
        let doc = lopdf::Document::load_mem(&pdf).unwrap();
        assert!(doc.is_encrypted(), "sifreleme sozlugu olmali");
        let ham = String::from_utf8_lossy(&pdf);
        assert!(!ham.contains(KANARYA), "icerik duz metin olarak dosyada gorunmemeli");
    }

    #[test]
    fn dogru_parolayla_acilir_ve_turkce_metin_dogru_cikar() {
        let pdf = sifreli_pdf(&icerik(), "dogru-parola-123").unwrap();
        let metin = metin_cikar(&pdf, "dogru-parola-123").unwrap();
        assert!(metin.contains(KANARYA), "arti yon: dogru parolayla icerik okunmali");
        for harf in ["ç", "ğ", "ı", "İ", "ö", "ş", "ü", "Ç", "Ğ", "Ö", "Ş", "Ü"] {
            assert!(metin.contains(harf), "Turkce glif kayboldu: {harf}");
        }
    }

    #[test]
    fn yanlis_parolayla_icerik_okunamaz() {
        let pdf = sifreli_pdf(&icerik(), "dogru-parola-123").unwrap();
        match metin_cikar(&pdf, "yanlis-parola-999") {
            Err(_) => {}
            Ok(metin) => assert!(!metin.contains(KANARYA), "yanlis parola icerigi acmamali"),
        }
    }

    #[test]
    fn sifreleme_aes256_dir() {
        let pdf = sifreli_pdf(&icerik(), "dogru-parola-123").unwrap();
        let doc = lopdf::Document::load_mem(&pdf).unwrap();
        let sifre = doc.get_encrypted().expect("Encrypt sozlugu");
        assert_eq!(sifre.get(b"V").unwrap().as_i64().unwrap(), 5, "V5 = AES-256");
        assert_eq!(sifre.get(b"R").unwrap().as_i64().unwrap(), 6);
    }

    #[test]
    fn her_uretimde_farkli_anahtar_kullanilir() {
        let a = sifreli_pdf(&icerik(), "dogru-parola-123").unwrap();
        let b = sifreli_pdf(&icerik(), "dogru-parola-123").unwrap();
        assert_ne!(a, b, "ayni icerik ve parola ayni baytlari uretmemeli");
    }

    #[test]
    fn kisa_parola_reddedilir_sinirdaki_kabul_edilir() {
        assert!(matches!(sifreli_pdf(&icerik(), "1234567"), Err(PdfHatasi::ParolaCokKisa)));
        assert!(sifreli_pdf(&icerik(), "12345678").is_ok());
        assert!(sifreli_pdf(&icerik(), "şşşşşşşş").is_ok(), "sinir KARAKTER, bayt degil");
    }

    #[test]
    fn uzun_icerik_kirpilmaz_birden_fazla_sayfaya_yayilir() {
        let mut ic = icerik();
        ic.bolumler[0].satirlar.push("SON-SATIR-KANARYASI".into());
        let pdf = sifreli_pdf(&ic, "dogru-parola-123").unwrap();
        let doc = { let mut d = lopdf::Document::load_mem(&pdf).unwrap(); d.decrypt("dogru-parola-123").unwrap(); d };
        assert!(doc.get_pages().len() > 1, "2000 kelimelik satir tek sayfaya sigmamali");
        assert!(metin_cikar(&pdf, "dogru-parola-123").unwrap().contains("SON-SATIR-KANARYASI"));
    }

    #[test]
    fn debug_icerigi_basmaz() {
        let s = format!("{:?}", icerik());
        assert!(!s.contains(KANARYA) && !s.contains("Seans notları"));
    }
}
```

`lopdf` API adları (`is_encrypted`, `get_encrypted`, `extract_text`, `decrypt`) 0.45 sürümündeki gerçek adlara göre düzeltilebilir; **iddialar değişmez**.

- [ ] **Step 2: Başarısız olduklarını doğrula** — `cargo test -p psikolog-core pdf` → derleme hatası.
- [ ] **Step 3: Uygula** — `printpdf` ile sayfaları üret (A4, 20 mm kenar, 11 pt gövde, gömülü Noto Sans, satır sarma + sayfa taşması), baytları al; `lopdf::Document::load_mem`; `EncryptionVersion::V5 { encrypt_metadata: true, crypt_filters: {b"StdCF" => Arc::new(Aes256CryptFilter)}, file_encryption_key: &rastgele_32_bayt, stream_filter: b"StdCF".to_vec(), string_filter: b"StdCF".to_vec(), owner_password: parola, user_password: parola, permissions }` → `EncryptionState::try_from` → `doc.encrypt(&durum)` → `doc.save_to(&mut Vec<u8>)`.
- [ ] **Step 4: Özel not taramasını genişlet** — yukarıdaki dört madde.
- [ ] **Step 5: Doğrula** — `cargo test --workspace`. Mutasyonlar: `encrypt` çağrısını kaldır → "şifrelidir" testi kırılır; parolayı sabit `"x"` ile şifrele → "doğru parolayla açılır" testi kırılır; gömülü font yerine yerleşik Helvetica → Türkçe glif testi kırılır; sayfa taşmasını kaldır → uzun içerik testi kırılır. Ayrıca bir PDF'i elle Önizleme/tarayıcıda açma denemesi yapılamıyorsa raporda **açıkça** "görsel doğrulama yapılmadı" yaz.
- [ ] **Step 6: Commit**

```bash
git add core/src/pdf.rs core/src/lib.rs core/Cargo.toml Cargo.lock core/assets/fonts core/src/store/search.rs
git commit -m "feat(pdf): AES-256 parola korumali PDF uretimi; ozel not taramasi core/src tamamina"
```

---

### Task 6: Danışan veri raporu uç noktası (sunucuda üretim)

Bugün rapor istemcide düz `.txt` olarak üretiliyor ve sunucu ayrı bir `POST /api/danisanlar/{id}/rapor-kaydi` ucuyla haberdar ediliyor. Bu görev üretimi sunucuya taşır ve eski yolu **kaldırır**. Ayrıca notlar artık `?limit=200` tavanına takılmaz: sunucu danışanın **tüm** resmî notlarını rapora koyar.

**Files:**
- Create: `core/src/store/veri_raporu.rs`; Modify: `core/src/store/mod.rs`
- Modify: `core/src/store/clients.rs` (`veri_raporu_kaydi` ve testlerini **kaldır**)
- Create: `server/src/routes/veri_raporu.rs`; Modify: `server/src/routes/mod.rs`, `server/src/routes/clients.rs` (`rapor_kaydi_uc` **kaldır**), `server/src/lib.rs`
- Test: `core/src/store/veri_raporu.rs` test bloğu, `server/tests/notlar_api.rs`

**Interfaces:**
- Consumes: `pdf::{sifreli_pdf, RaporIcerigi, RaporBolumu, PdfHatasi, ASGARI_PAROLA}` (Task 5), `notes::SeansNotu`, `attachments` üstverisi, `keystore` (ana parola kontrolü).
- Produces:
  - `pub fn rapor_icerigi(conn: &Connection, client_id: i64) -> Result<RaporIcerigi, DepoHatasi>` — **log yazmaz** (loglama uç noktada, üretimle aynı adımda)
  - `POST /api/danisanlar/{id}/veri-raporu` gövde `{"parola": string}` → `200`, `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="danisan-veri-raporu-YYYY-AA-GG.pdf"` (dosya adında **danışan adı yok**), gövde şifreli PDF

İçerik (`rapor_icerigi`) — `web/src/danisan/veriRaporu.ts`'in bugünkü metninden taşınır, **aynı güvencelerle**:
- Danışan alanları (ad, telefon, doğum tarihi, başvuru nedeni, rıza tarihi, son temas). **Risk notu dahil değil** — bugünkü rapor da içermiyor; bu kararı değiştirme.
- Resmî notlar: `progress_notes JOIN appointments a` ile, `a.client_id` **yetkili kaynaktan**, `ORDER BY a.baslangic ASC, p.appointment_id ASC`, **limitsiz**; her notta "Seans: GG.AA.YYYY SS:DD" ve şablon adı.
- Ekler: yalnızca **üstveri** (tür, eklenme tarihi, boyut); içerik gömülmez.
- Son satır: *"Terapistin özel notları bu rapora dahil değildir."*
- `private_notes` ve `ozel_not_*` bu dosyada **geçmez** (Task 5'in genişletilmiş taraması yapısal olarak zorlar).

Uç nokta davranışı (sıra sözleşmedir):
1. `let conn = acik_baglanti(&s)?;`
2. Parola `ASGARI_PAROLA`'dan kısaysa `400 {"hata": "Rapor parolası en az 8 karakter olmalı."}`.
3. **Parola ana parolayla aynıysa reddet:** `keystore::unlock_with_password` (mevcut API adıyla) verilen parolayla keystore'u açabiliyorsa `400 {"hata": "Rapor için ana parolanızı kullanmayın; danışana vereceğiniz ayrı bir parola seçin."}`. Gerekçe: bu parola danışana verilir; ana parola olursa danışan bütün kayıtları açabilecek anahtara sahip olur. (Argon2 maliyeti bilinçli olarak kabul edilir.)
4. `rapor_icerigi` → yoksa `404`.
5. `sifreli_pdf` → hata `500 {"hata": "Rapor üretilemedi."}` (kütüphane mesajı gövdeye konmaz).
6. `kaydet(Eylem::DisaAktarma, "client", id, Cihaz::Masaustu, None, LogHacmi::HerCagri)` → **başarısızsa baytlar döndürülmez**, `500`.
7. Baytlar döndürülür.
- İstek gövdesi tipinin `Debug`'ı parolayı basmaz; gövde `Deserialize` hatası `{"hata"}` JSON döner.
- Handler sayısı: `rapor_kaydi_uc` kalkar, `veri_raporu` eklenir → yapısal toplam **değişmez**, modül dağılımı güncellenir.

- [ ] **Step 1: Başarısız çekirdek testleri yaz** — `rapor_icerigi` için: (a) iki resmî not + bir özel not (kanarya) kur; bölümlerin düzleştirilmiş metninde resmî kanarya **var**, özel kanarya **yok**; (b) randevu başka danışana taşınınca (`appointments::guncelle`) not **yeni** danışanın raporuna girer, eskisinin raporuna girmez (Plan 3 Görev 3 Critical'ının kardeşi); (c) 250 not kurulunca 250'si de raporda (limitsiz; tavan kaldırıldı); (d) notlar seans tarihine göre artan sırada — ekleme sırası ne artan ne azalan (biçim 8); (e) risk notu raporda **yok**, başvuru nedeni **var**; (f) ek içeriği (kanarya baytları) raporda yok, ek türü var; (g) olmayan danışan → `Bulunamadi`; (h) `rapor_icerigi` hiçbir log satırı yazmaz.

- [ ] **Step 2: Başarısız HTTP testleri yaz** (`server/tests/notlar_api.rs`, mevcut yardımcılarla):

```rust
#[tokio::test]
async fn veri_raporu_sifreli_pdf_doner_ve_disa_aktarma_loglanir() {
    // kurulum: danisan + resmi not (RESMI-KANARYA) + ozel not (OZEL-KANARYA)
    // POST /api/danisanlar/{id}/veri-raporu {"parola":"danisan-parolasi-1"}
    // beklenen: 200, content-type application/pdf, content-disposition attachment,
    //   dosya adinda danisan adi YOK, ham govdede RESMI-KANARYA YOK (sifreli),
    //   lopdf ile "danisan-parolasi-1" cozulunce RESMI-KANARYA VAR, OZEL-KANARYA YOK,
    //   denetim kaydinin en ustunde "disa_aktarma|client|<id>" satiri, ayrinti bos.
}

#[tokio::test]
async fn ayni_rapor_ikinci_kez_alininca_ikinci_log_satiri_yazilir() { /* HerCagri: 2 istek = 2 satir */ }

#[tokio::test]
async fn ana_parola_rapor_parolasi_olarak_reddedilir_ve_log_yazilmaz() { /* 400 + satir sayisi degismez */ }

#[tokio::test]
async fn kisa_parola_400_sinirdaki_200() { /* 7 karakter 400, 8 karakter 200 */ }

#[tokio::test]
async fn kilitliyken_veri_raporu_401_ve_log_yazilmaz() { /* 401, govdede %PDF yok, kilit acilinca log sayisi ayni */ }

#[tokio::test]
async fn parola_hicbir_log_satirinda_ve_hata_govdesinde_gecmez() { /* yanlis/kisa/ana parola denemeleri sonrasi tum audit dokumu ve yanit govdeleri taranir */ }

#[tokio::test]
async fn eski_rapor_kaydi_ucu_artik_yok() { /* POST /api/danisanlar/{id}/rapor-kaydi -> 404 {"hata"} */ }
```

Her testin gövdesi yorumdaki iddiaları **eksiksiz** uygular. Denetim kaydının yazılamadığı yol için `audit_log` düşürülüp (`DROP TABLE`) `500` ve **gövdede `%PDF` olmadığı** doğrulanır (fail-closed).

- [ ] **Step 3: Başarısız olduklarını doğrula** — `cargo test --workspace` → derleme hatası / FAIL.
- [ ] **Step 4: Uygula** — yukarıdaki içerik ve sıra. `veri_raporu_kaydi`, `rapor_kaydi_uc`, `/rapor-kaydi` rotası ve bunlara ait testler **kaldırılır**; kaldırılan her korumanın yerini hangi yeni testin aldığını raporda eşle (kaldırılan "kayıt çağrı sırası" güvencesinin karşılığı, adım 6'nın fail-closed testi).
- [ ] **Step 5: Doğrula** — `cargo test --workspace`. Mutasyonlar: adım 6'yı adım 7'den sonraya al → fail-closed testi kırılır; `LogHacmi::OturumBasi` yap → ikinci-log testi kırılır; ana parola kontrolünü kaldır → ilgili test kırılır; `a.client_id` yerine `p.client_id` → taşınma testi kırılır; rapora özel not ekle (`notes::ozel_not_getir`) → hem davranışsal test hem Task 5'in yapısal taraması kırılır.
- [ ] **Step 6: Commit**

```bash
git add core/src/store/veri_raporu.rs core/src/store/mod.rs core/src/store/clients.rs server/src/routes/veri_raporu.rs server/src/routes/mod.rs server/src/routes/clients.rs server/src/lib.rs server/tests/notlar_api.rs
git commit -m "feat(rapor): danisan veri raporu sunucuda, AES-256 sifreli PDF; istemci kayit ucu kaldirildi"
```

---

### Task 7: Arayüz — parolalı rapor indirme, istemci üretiminin kaldırılması

**Files:**
- Modify: `web/src/api.ts` (`danisanApi.veriRaporuIndir(id: number, parola: string): Promise<void>`; `raporKaydiOlustur` **kaldır**)
- Modify: `web/src/danisan/DanisanKarti.tsx`, `web/src/screens/AnaEkran.tsx`, `web/src/screens/anaEkranKancalari/*` (rapor not çekme yolu)
- Delete: `web/src/danisan/veriRaporu.ts`, `web/src/danisan/veriRaporu.test.ts`
- Test: `web/src/danisan/DanisanKarti.test.tsx`, `web/src/screens/AnaEkran.test.tsx`, `web/src/api.test.ts`, `e2e/notlar.spec.ts`

**Interfaces:**
- Consumes: `POST /api/danisanlar/{id}/veri-raporu` (Task 6).
- Produces: `veriRaporuIndir` — `istek()` 401 kapısından geçen `fetch`, yanıt `blob()` → `URL.createObjectURL` → programatik indirme (`api.ekIndir` ile aynı desen; 401'de SPA gezinmez), URL hemen serbest bırakılır.

Davranış:
- "Danışan veri raporu dışa aktar" düğmesi bir diyalog açar: "Rapor parolası" + "Parolayı tekrar girin" (ikisi `type="password"`), açıklama: *"Bu parolayı danışana ayrıca iletin. Ana parolanızı kullanmayın."*
- İki alan eşleşmezse ya da 8 karakterden kısaysa istek **gitmez**, alan adıyla hata gösterilir.
- Sunucu `400` mesajını (ör. ana parola reddi) olduğu gibi `role="alert"` ile gösterir.
- Başarıda diyalog kapanır, alanlar **temizlenir** (parola bellekte/DOM'da kalmaz).
- Parola `console.`'a, `localStorage`/`sessionStorage`'a, URL'ye girmez.
- **İstemcide rapor metni üretmek imkânsız hâle gelir:** `veriRaporu.ts` silinir; `AnaEkran`'daki `raporNotlariGetir` ve ona bağlı gövde taraması kaldırılır.

**Kaldırılan korumaların karşılığı (biçim 12 — koruma yanlış yerde kalmasın):** Bugün `AnaEkran.test.tsx`'te (a) `raporNotlariGetir` gövdesinde `ozelNotApi` geçmediğini tarayan yapısal test ve (b) panel kapalı/açık iki davranışsal "Blob metninde özel kanarya yok" testi var. Bunlar istemci üretimini koruyordu; üretim sunucuya taşındığı için:
1. Yerine **yeni bir yapısal web testi**: `web/src` üretim kaynaklarının hiçbirinde (yorumlar ayıklanmış, `?raw` ile) `createObjectURL` çağrısının `text/plain` ya da rapor metni üreten bir çağrıyla birlikte geçmediği; `veriRaporuMetni` adının hiçbir yerde tanımlı olmadığı; `new Blob(` yalnızca `api.ts`'te (sunucu yanıtı sarmalama) geçtiği. Dosya kümesi `web/src` dizininden özyinelemeli türetilir.
2. Özel notun rapora girmediğinin davranışsal kanıtı artık Task 6'nın HTTP testi (lopdf ile çözülen metin) ve aşağıdaki e2e testidir.
Raporda eski test → yeni test eşlemesini tablo olarak ver.

- [ ] **Step 1: Başarısız testleri yaz**

```tsx
it('parolalar eslesmezse ya da kisaysa istek GITMEZ ve alan adiyla hata gosterilir', async () => {
  const veriRaporuIndir = vi.fn()
  kurKart({ veriRaporuIndir })
  await userEvent.click(screen.getByRole('button', { name: 'Danışan veri raporu dışa aktar' }))
  await userEvent.type(screen.getByLabelText('Rapor parolası'), 'kisa')
  await userEvent.type(screen.getByLabelText('Parolayı tekrar girin'), 'kisa')
  await userEvent.click(screen.getByRole('button', { name: 'Raporu oluştur' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/en az 8 karakter/)
  expect(veriRaporuIndir).not.toHaveBeenCalled()

  await userEvent.clear(screen.getByLabelText('Rapor parolası'))
  await userEvent.clear(screen.getByLabelText('Parolayı tekrar girin'))
  await userEvent.type(screen.getByLabelText('Rapor parolası'), 'dogru-parola-1')
  await userEvent.type(screen.getByLabelText('Parolayı tekrar girin'), 'dogru-parola-2')
  await userEvent.click(screen.getByRole('button', { name: 'Raporu oluştur' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/eşleşmiyor/)
  expect(veriRaporuIndir).not.toHaveBeenCalled()
})

it('gecerli parolayla TEK istek gider, basarida alanlar temizlenir', async () => {
  const veriRaporuIndir = vi.fn().mockResolvedValue(undefined)
  kurKart({ veriRaporuIndir })
  await userEvent.click(screen.getByRole('button', { name: 'Danışan veri raporu dışa aktar' }))
  await userEvent.type(screen.getByLabelText('Rapor parolası'), 'danisan-parolasi-1')
  await userEvent.type(screen.getByLabelText('Parolayı tekrar girin'), 'danisan-parolasi-1')
  await userEvent.click(screen.getByRole('button', { name: 'Raporu oluştur' }))
  expect(veriRaporuIndir).toHaveBeenCalledTimes(1)
  expect(veriRaporuIndir).toHaveBeenCalledWith(7, 'danisan-parolasi-1')
  expect(document.body.innerHTML).not.toContain('danisan-parolasi-1')
})

it('sunucunun 400 mesaji (ana parola reddi) olduğu gibi gosterilir', async () => {
  const veriRaporuIndir = vi.fn().mockRejectedValue(new Error('Rapor için ana parolanızı kullanmayın; danışana vereceğiniz ayrı bir parola seçin.'))
  kurKart({ veriRaporuIndir })
  await userEvent.click(screen.getByRole('button', { name: 'Danışan veri raporu dışa aktar' }))
  await userEvent.type(screen.getByLabelText('Rapor parolası'), 'ana-parola-123')
  await userEvent.type(screen.getByLabelText('Parolayı tekrar girin'), 'ana-parola-123')
  await userEvent.click(screen.getByRole('button', { name: 'Raporu oluştur' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('ana parolanızı kullanmayın')
})
```

`api.test.ts`: `veriRaporuIndir` `POST` gövdesinde parolayı gönderir, **URL'de parola yok**, `Object.keys(danisanApi)` listesinde `raporKaydiOlustur` **yok**, `veriRaporuIndir` **var**; 401 yanıtında dinleyiciler tetiklenir ve `location` değişmez.

e2e (`e2e/notlar.spec.ts`): mevcut `ozel not danisan raporuna girmez, resmi not girer` testi yeni akışa uyarlanır — diyalogla parola girilir, `page.waitForEvent('download')`, dosya `.pdf`, ham baytlarda **resmî kanarya da görünmez** (şifreli), ve e2e test sürecinde `lopdf` bulunmadığı için içerik doğrulaması Task 6'nın HTTP testine bırakılır; e2e burada yalnızca "şifreli PDF indi ve düz metin yok" + "istek parolayı URL'ye koymadı" (`page.on('request')`) doğrular. Testin adı ve raporu bu sınırı **açıkça** söyler (biçim 10: yorum koruma iddia etmez).

- [ ] **Step 2: Başarısız olduklarını doğrula** — `npm --prefix web run test` → FAIL.
- [ ] **Step 3: Uygula** — yukarıdaki davranış; `veriRaporu.ts` ve testini sil; `raporKaydiOlustur` zincirini (AnaEkran → kanca → kart) kaldır.
- [ ] **Step 4: Doğrula** — `npm --prefix web run build` → `cargo test --workspace` → `npm --prefix web run test` → `npx playwright test` → `cargo clippy --workspace --all-targets`. Mutasyonlar: eşleşme kontrolünü kaldır → ilk test; başarıda alan temizliğini kaldır → ikinci test; yeni yapısal teste geçici bir `new Blob([metin], { type: 'text/plain' })` satırı ekle → yapısal test kırılır.
- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/api.test.ts web/src/danisan web/src/screens e2e/notlar.spec.ts
git commit -m "feat(rapor): parolali sunucu raporu indirme; istemci rapor uretimi kaldirildi"
```

---

### Task 8: Uçtan uca ödeme ve özet akışı

**Files:**
- Create: `e2e/odeme.spec.ts`
- Modify: `playwright.config.ts` (`{ ad: 'odeme', spec: 'odeme.spec.ts', port: 7704 }`; config listeye eklenmemiş spec için zaten hata fırlatıyor)

- [ ] **Step 1: Testleri yaz**

```ts
test('geldi + odendi isaretlenen seans ay sonu ozetinde tahsilata, odenmeyen borca girer', async ({ page }) => {
  await kurulumYap(page)
  // Iki danisan, bu haftanin kullanilmamis iki saatine birer randevu (450 TL ve 300 TL).
  // Ilk randevu: panel alt satiri -> Geldi -> Ödendi kutusu.
  // Ikinci randevu: Geldi, odenmedi.
  // Ay sonu ozeti: "Tahsilat" 450,00 TL, "Bekleyen" 300,00 TL, borclular listesinde ikinci danisan.
  // Senkronizasyon bariyeri: her isaretlemeden sonra kutunun/dugmenin sunucu yanitiyla
  // guncellendigi gorulmeden bir sonraki adima gecilmez (bicim 6).
  // Ikinci danisanin odemesi isaretlenince ozet yeniden acilir: borclu listesi
  // "Bu ay bekleyen ödeme yok." der (degismemeli iddiasi DEGIL, degisme iddiasi).
})

test('gelmedi isaretlenen seans ne tahsilata ne borca girer', async ({ page }) => {
  await kurulumYap(page)
  // 450 TL'lik randevu -> Gelmedi. Ozet: Gelinen seans 0, Tahsilat 0,00 TL, Bekleyen 0,00 TL.
  // Arti yon ayni testte: ayni randevu sonradan Geldi yapilinca Bekleyen 450,00 TL olur
  // (hicbir sey saymayan bir ozet de ilk iddiayi gecerdi).
})

test('kilitliyken ay ozeti ucu veri sizdirmaz', async ({ page, request }) => {
  await kurulumYap(page)
  // Danisan "OZET-KANARYA" + geldi ve odenmemis seans; kilitle (bariyer: kilit ekrani gorunur).
  // GET /api/ay-ozeti?ay=<bu ay> -> 401, govdede OZET-KANARYA yok.
})
```

Yorumlardaki adımlar eksiksiz uygulanır; locator'larda `exact: true`; `waitForTimeout` yok.

- [ ] **Step 2: Başarısız olduklarını doğrula** — Task 1–4 birleşmeden önce yazılırsa FAIL; birleştikten sonra PASS beklenir. Bir mutasyonla gerçek olduklarını göster: `ay_ozeti`'nde `odendi` koşulunu ters çevir → ilk test kırılır.
- [ ] **Step 3: Doğrula** — `npx playwright test` iki kez ardışık tam yeşil (17 → 20).
- [ ] **Step 4: Commit**

```bash
git add e2e/odeme.spec.ts playwright.config.ts
git commit -m "test(e2e): odeme isaretleme ve ay sonu ozeti akisi"
```

---

## Planın Bitiş Durumu

Bitince: seans panelinden ödeme işaretlenebilen, danışan bakiyesinin gerçekten azaldığı, tek sayfalık ay sonu özeti olan ve KVKK md. 11 danışan veri raporunun **yalnızca sunucuda, yalnızca AES-256 parola korumalı PDF olarak** üretildiği bir uygulama. Şifresiz dışa aktarım yolu kalmaz; her dışa aktarım üretimle aynı istekte, fail-closed biçimde loglanır; rapor notları 200 tavanına takılmaz.

**Bu planda kasten yok:** telefon erişimi (Plan 5), "gelmedi" seansların ücretlendirilmesi (ürün kararı bekliyor; tek yer `store/ozet.rs` sayım kuralı), danışan başına saklama süresi (tasarım "7 yıl sabitlenmemeli, çocuk danışanlar için 21 yaşına kadar" diyor — ayrı iş), yedeklerin dışa aktarım sayılıp sayılmayacağı (bugün `Eylem::DisaAktarma` ile loglanıyor, değişmiyor).

**Tasarımda v1'de olup bu plana da girmeyen iki madde (açıkça kayıt altında):**
- **Düzenlenebilir şablonlar** (tasarım §6: *"Şablonlar kullanıcı tarafından düzenlenebilir"*). `templates` tablosu Plan 3'te kuruldu ve korunuyor ama hiçbir şey onu okumuyor/yazmıyor; başlıklar `web/src/seans/sablon.ts`'ten geliyor (Plan 3 dal incelemesi M4). Küçük, bağımsız bir plan olarak yazılmalı.
- **Parola denemelerinde artan gecikme** (tasarım §4: *"1s, 2s, 4s…"*). Kilit açma yolunda uygulanmamış (Plan 3 dal incelemesi M8). Telefon erişimiyle aynı güvenlik yüzeyine ait olduğu için Plan 5'e alınacak.

## Açık Sorular

1. **"Gelmedi" ücretlendirmesi.** Özet ve bakiye bugün "gelmedi"yi saymıyor ve bunu ekranda söylüyor. Psikolog gelmeyen seansı ücretlendiriyorsa `store/ozet.rs` sayım kuralı ve kart bakiyesi birlikte değişmeli.
2. **Rapor parolasının iletimi.** Uygulama parolayı saklamaz; psikolog danışana ayrı bir kanaldan (yüz yüze, telefonla) iletir. Kurulum kılavuzuna bir paragraf eklenmeli.
3. **Görsel doğrulama.** Şifreli PDF'in macOS Önizleme'de açıldığı otomatik testle doğrulanamıyor (CI'da Önizleme yok). İlk macOS derlemesinde elle bir kez denenmeli.
