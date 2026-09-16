//! Danışan veri raporunun **içeriği** (KVKK md. 11) — Plan 4 Görev 6.
//!
//! Bu modül veritabanından düz bir [`RaporIcerigi`] kurar; PDF'e çevirme ve
//! şifreleme `crate::pdf`'in işidir, uç nokta sırası
//! `server::routes::veri_raporu`'nundur.
//!
//! # Neden sunucuda
//!
//! Rapor Plan 3'te istemcide düz `.txt` olarak üretiliyordu ve sunucu ayrı bir
//! "kayıt" ucuyla yalnızca **haberdar ediliyordu**: istemcinin "kaydettim"
//! demesine güveniliyordu ve notlar `?limit=200` tavanına takılıyordu. Artık
//! raporu üreten taraf onu loglayan taraftır ve notlar **limitsizdir**.
//!
//! # Özel not buraya YAPISAL olarak giremez
//!
//! Notlar yalnızca resmî not tablosundan okunur; terapistin özel notlarının
//! tablosu bu dosyada ne sorguda ne adda geçer. Koruma bir filtreye değil,
//! **sorgunun hangi tabloya baktığına** dayanır (bkz. `store::notes` modül
//! başlığı). `store::search`'teki çekirdek geneli tarama bu dosyayı dizinden
//! kendiliğinden kapsar: burada özel not tablosunun adı ya da özel not API'si
//! geçerse o test kırılır.
//!
//! # Danışan ekseni: `a.client_id`, notun kopyası değil
//!
//! `progress_notes.client_id` denormalize bir kopyadır ve randevu başka bir
//! danışana taşındığında **güncellenmez** (`notes::danisan_notlari` belgesi).
//! Rapor kopyadan filtrelenseydi B'nin seans notu A'ya verilen belgede yer
//! alırdı. Hem filtre hem sıralama randevu tablosundan okunur
//! (`rapora_tasinan_randevunun_notu_yeni_danisana_gider`).
//!
//! # Risk notu rapora GİRMEZ
//!
//! Plan 3'teki istemci raporu da içermiyordu; bu görev içeriği taşır, kararı
//! değiştirmez. Sorgu sütunu hiç okumaz (`risk_notu_rapora_girmez_basvuru_nedeni_girer`).
//!
//! # Ekler: ad ve üstveri — içerik ASLA
//!
//! Dosya adı, tür, eklenme tarihi, boyut. İçerik BLOB'u sorguya hiç girmez.
//!
//! Dosya adı rapora **girer** (Plan 4 Görev 7 kararı; Görev 6'da yalnızca
//! üstveri yazılıyordu ve bu yanlıştı): KVKK md. 11 raporu danışanın **kendi
//! verisine erişimidir**, dosya adları o verinin parçasıdır, rapor şifrelidir
//! ve danışanın kendisine verilir; Plan 3'teki istemci raporunda da vardı.
//! Adlar yükleme sırasında zaten doğrulanıyor (denetim karakteri, çift yönlü
//! metin, sıfır genişlikli karakter reddi — `attachments::dosya_adi_dogrula`).
//! Korunan: `ek_adi_rapora_girer_ek_icerigi_girmez`.
//!
//! # Log yazmaz — `disa_aktarim_kaydi` ayrı
//!
//! `rapor_icerigi` salt okur. Denetim satırı, raporun **fiilen üretildiği**
//! adımda uç nokta tarafından `disa_aktarim_kaydi` ile yazılır; üretim
//! başarısız olursa satır yazılmaz, satır yazılamazsa baytlar verilmez
//! (fail-closed; HTTP seviyesinde
//! `kayit_yazilamazsa_500_doner_ve_pdf_verilmez`).

use crate::pdf::{RaporBolumu, RaporIcerigi};
use crate::store::audit::{kaydet, Cihaz, Eylem, LogHacmi};
use crate::store::clients::DepoHatasi;
use rusqlite::{Connection, OptionalExtension};

/// Raporun son satırı: dosyanın neyi İÇERMEDİĞİNİ açıkça söyler. Raporu
/// okuyan danışan olabilir; bu bir gizleme değil, kapsam beyanıdır.
pub const OZEL_NOT_BEYANI: &str = "Terapistin özel notları bu rapora dahil değildir.";

const KAYITLI_DEGIL: &str = "(kayıtlı değil)";

/// `YYYY-AA-GG...` → `GG.AA.YYYY`; biçim tutmazsa dizgi olduğu gibi.
fn tarih_tr(s: &str) -> String {
    let b = s.as_bytes();
    let bicim = b.len() >= 10
        && b[4] == b'-'
        && b[7] == b'-'
        && [0, 1, 2, 3, 5, 6, 8, 9].iter().all(|&i| b[i].is_ascii_digit());
    if !bicim {
        return s.to_string();
    }
    format!("{}.{}.{}", &s[8..10], &s[5..7], &s[0..4])
}

/// `YYYY-AA-GGTSS:DD` (randevu duvar saati) → `GG.AA.YYYY SS:DD`.
fn seans_zamani_tr(s: &str) -> String {
    let b = s.as_bytes();
    let bicim = b.len() >= 16 && b[10] == b'T' && b[13] == b':';
    if !bicim {
        return s.to_string();
    }
    format!("{} {}", tarih_tr(&s[..10]), &s[11..16])
}

fn sablon_adi(kod: &str) -> &str {
    match kod {
        "dap" => "DAP",
        "soap" => "SOAP",
        "serbest" => "Serbest",
        diger => diger,
    }
}

fn ek_turu_adi(kod: &str) -> &str {
    match kod {
        "onam" => "Onam",
        "test" => "Test",
        "diger" => "Diğer",
        diger => diger,
    }
}

fn alan(etiket: &str, deger: Option<String>) -> String {
    match deger {
        Some(d) if !d.trim().is_empty() => format!("{etiket}: {d}"),
        _ => format!("{etiket}: {KAYITLI_DEGIL}"),
    }
}

/// Danışanın veri raporu içeriği. **Log yazmaz** (bkz. modül başlığı).
///
/// Var olmayan danışan `DepoHatasi::Bulunamadi`.
pub fn rapor_icerigi(conn: &Connection, client_id: i64) -> Result<RaporIcerigi, DepoHatasi> {
    // `risk_notu` BILEREK okunmuyor (bkz. modul basligi).
    let danisan = conn
        .query_row(
            "SELECT ad_soyad, telefon, dogum_tarihi, basvuru_nedeni, riza_tarihi,
                    son_temas, saklama_bitis
             FROM clients WHERE id = ?1",
            [client_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .optional()?
        .ok_or(DepoHatasi::Bulunamadi)?;
    let (ad_soyad, telefon, dogum_tarihi, basvuru_nedeni, riza_tarihi, son_temas, saklama_bitis) =
        danisan;

    let kimlik = RaporBolumu {
        baslik: "Danışan bilgileri".into(),
        satirlar: vec![
            "KVKK md. 11 kapsamında, danışanın kendi verisine erişim talebi için hazırlanmıştır."
                .into(),
            format!("Ad soyad: {ad_soyad}"),
            alan("Telefon", telefon),
            alan("Doğum tarihi", dogum_tarihi.map(|d| tarih_tr(&d))),
            alan("Başvuru nedeni", basvuru_nedeni),
            alan("Açık rıza tarihi", riza_tarihi.map(|d| tarih_tr(&d))),
            alan("Son temas", son_temas.map(|d| tarih_tr(&d))),
            alan("Saklama süresi bitişi", saklama_bitis.map(|d| tarih_tr(&d))),
        ],
    };

    // LIMIT YOK: KVKK md. 11 "elimdeki her sey" demektir. Danisan filtresi ve
    // siralama YETKILI KAYNAKTAN (`a.`), notun denormalize kopyasindan degil.
    let mut stmt = conn.prepare(
        "SELECT a.baslangic, p.sablon, p.icerik
         FROM progress_notes p
         JOIN appointments a ON a.id = p.appointment_id
         WHERE a.client_id = ?1
         ORDER BY a.baslangic ASC, p.appointment_id ASC",
    )?;
    let notlar = stmt
        .query_map([client_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    let mut not_satirlari = Vec::with_capacity(notlar.len() * 3);
    if notlar.is_empty() {
        not_satirlari.push("Kayıtlı seans notu yok.".to_string());
    }
    for (baslangic, sablon, icerik) in &notlar {
        not_satirlari.push(format!(
            "Seans: {} · {}",
            seans_zamani_tr(baslangic),
            sablon_adi(sablon)
        ));
        not_satirlari.push(icerik.clone());
        not_satirlari.push(String::new());
    }
    let seans_notlari = RaporBolumu {
        baslik: format!("Seans notları ({})", notlar.len()),
        satirlar: not_satirlari,
    };

    // Ad + ustveri; `icerik` sutunu sorguya GIRMEZ (bkz. modul basligi).
    let mut stmt = conn.prepare(
        "SELECT dosya_adi, tur, eklenme_zamani, boyut FROM attachments
         WHERE client_id = ?1
         ORDER BY eklenme_zamani ASC, id ASC",
    )?;
    let ekler = stmt
        .query_map([client_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    let mut ek_satirlari: Vec<String> = ekler
        .iter()
        .map(|(ad, tur, zaman, boyut)| {
            format!(
                "- {ad} · {} · eklenme: {} · {boyut} bayt",
                ek_turu_adi(tur),
                tarih_tr(zaman)
            )
        })
        .collect();
    if ek_satirlari.is_empty() {
        ek_satirlari.push("Ekli dosya yok.".to_string());
    }
    let ek_bolumu = RaporBolumu {
        baslik: format!(
            "Ekli dosyalar ({}) — yalnızca ad ve bilgiler, dosya içerikleri dahil değildir",
            ekler.len()
        ),
        satirlar: ek_satirlari,
    };

    let kapsam = RaporBolumu { baslik: "Kapsam".into(), satirlar: vec![OZEL_NOT_BEYANI.into()] };

    Ok(RaporIcerigi {
        baslik: "DANIŞAN VERİ RAPORU".into(),
        bolumler: vec![kimlik, seans_notlari, ek_bolumu, kapsam],
    })
}

/// Veri raporunun dışa aktarıldığını denetim kaydına yazar.
///
/// Uç nokta bunu raporu **ürettikten sonra, baytları vermeden önce** çağırır;
/// hata dönerse baytlar verilmez. Emsal `attachments::icerik_getir` ve
/// `backup::yedek_al_ve_kaydet`: `DisaAktarma` + `HerCagri` — birleştirilseydi
/// art arda iki dışa aktarımdan biri denetim kaydında görünmezdi.
///
/// Ayrıntı YOK: rapor içeriği (ad, not metni) ve parola loga asla girmez.
/// Varlık kontrolü yapmaz; çağıranın sırası gereği `rapor_icerigi` zaten
/// `Bulunamadi` ile dönmüştür.
pub fn disa_aktarim_kaydi(
    conn: &Connection,
    client_id: i64,
    cihaz: Cihaz,
) -> Result<(), DepoHatasi> {
    kaydet(
        conn,
        Eylem::DisaAktarma,
        "client",
        &client_id.to_string(),
        cihaz,
        None,
        LogHacmi::HerCagri,
    )?;
    Ok(())
}

/// İndirilen dosyanın adı: `danisan-veri-raporu-YYYY-AA-GG.pdf`.
///
/// Danışan adı **bilerek yok**: dosya adları indirme geçmişine, son
/// kullanılanlar listesine ve e-posta eklerine düşer.
///
/// # Tarih istemcinin YEREL günüdür
///
/// Bu kod tabanının duvar saati sözleşmesinde "takvimi istemci bilir"
/// (emsal `GET /api/saklama-suresi-dolanlar?bugun=`). Görev 6'da ad sunucunun
/// UTC gününden üretiliyordu ve Türkiye'de 00:00–03:00 arasında alınan bir
/// rapor önceki günün adını taşıyordu. Artık gün istek gövdesinden gelir.
///
/// Geçersiz gün (`zaman::tarih_gecerli_mi`) `GecersizVeri` döner: değer bir
/// HTTP başlığına (`Content-Disposition`) yazılıyor, doğrulanmamış bir dizgi
/// başlık enjeksiyonu kapısı olurdu. Uç nokta bunu raporu üretmeden ÖNCE
/// çağırır (`gecersiz_bugun_400_doner_rapor_uretilmez_log_yazilmaz`).
pub fn rapor_dosya_adi(bugun: &str) -> Result<String, DepoHatasi> {
    if !crate::store::zaman::tarih_gecerli_mi(bugun) {
        return Err(DepoHatasi::GecersizVeri(BUGUN_GECERSIZ_MESAJI.into()));
    }
    Ok(format!("danisan-veri-raporu-{bugun}.pdf"))
}

/// `rapor_dosya_adi`'nın geçersiz gün mesajı.
pub const BUGUN_GECERSIZ_MESAJI: &str =
    "Rapor tarihi YYYY-AA-GG biçiminde geçerli bir gün olmalı.";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{
        appointments::{
            guncelle as randevu_guncelle, olustur as randevu_olustur, RandevuGuncelleme,
            YeniRandevu,
        },
        attachments::ekle as ek_ekle,
        audit::son_kayitlar,
        clients::{ekle as danisan_ekle, guncelle as danisan_guncelle, DanisanGuncelleme, YeniDanisan},
        db::open_encrypted,
        notes::{not_kaydet, ozel_not_kaydet},
        schema::migrate,
    };

    fn baglanti() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let c = open_encrypted(&dir.path().join("v.db"), &generate_data_key()).unwrap();
        migrate(&c).unwrap();
        (dir, c)
    }

    fn danisan(c: &Connection, ad: &str) -> i64 {
        danisan_ekle(c, &YeniDanisan { ad_soyad: ad.into(), telefon: None }, Cihaz::Masaustu)
            .unwrap()
            .id
    }

    fn randevu(c: &Connection, client_id: i64, baslangic: &str, bitis: &str) -> i64 {
        randevu_olustur(
            c,
            &YeniRandevu {
                client_id,
                baslangic: baslangic.into(),
                bitis: bitis.into(),
                ucret: None,
            },
            Cihaz::Masaustu,
        )
        .unwrap()
        .id
    }

    /// Baslik + bolum basliklari + satirlar, satir satir.
    fn duz(icerik: &RaporIcerigi) -> String {
        let mut s = vec![icerik.baslik.clone()];
        for b in &icerik.bolumler {
            s.push(b.baslik.clone());
            s.extend(b.satirlar.iter().cloned());
        }
        s.join("\n")
    }

    fn log_adedi(c: &Connection) -> usize {
        son_kayitlar(c, 100_000).unwrap().len()
    }

    // (a) resmi not var, ozel not yok
    #[test]
    fn resmi_not_rapora_girer_ozel_not_girmez() {
        let (_d, c) = baglanti();
        let cid = danisan(&c, "Ayse Yilmaz");
        let r1 = randevu(&c, cid, "2026-09-01T10:00", "2026-09-01T11:00");
        let r2 = randevu(&c, cid, "2026-09-08T10:00", "2026-09-08T11:00");
        not_kaydet(&c, r1, "dap", "RESMI-KANARYA-1", Cihaz::Masaustu).unwrap();
        not_kaydet(&c, r2, "soap", "RESMI-KANARYA-2", Cihaz::Masaustu).unwrap();
        ozel_not_kaydet(&c, r1, "OZEL-KANARYA", Cihaz::Masaustu).unwrap();

        let metin = duz(&rapor_icerigi(&c, cid).unwrap());
        // ARTI YON: yoksa "ozel yok" iddiasi bos bir raporla da saglanirdi.
        assert!(metin.contains("RESMI-KANARYA-1") && metin.contains("RESMI-KANARYA-2"), "{metin}");
        assert!(metin.contains("Seans: 01.09.2026 10:00 · DAP"), "{metin}");
        assert!(metin.contains("Seans: 08.09.2026 10:00 · SOAP"), "{metin}");
        assert!(metin.contains("Seans notları (2)"), "{metin}");
        assert!(!metin.contains("OZEL-KANARYA"), "ozel not rapora sizdi: {metin}");
        assert!(metin.contains("Ad soyad: Ayse Yilmaz"));
    }

    // (b) randevu tasininca not yeni danisana gider
    #[test]
    fn rapora_tasinan_randevunun_notu_yeni_danisana_gider() {
        let (_d, c) = baglanti();
        let a = danisan(&c, "Ayse Yilmaz");
        let b = danisan(&c, "Mehmet Demir");
        let rid = randevu(&c, a, "2026-09-07T14:00", "2026-09-07T15:00");
        not_kaydet(&c, rid, "dap", "TASINAN-NOT-KANARYASI", Cihaz::Masaustu).unwrap();

        // On kosul: tasinmadan once A'nin raporunda.
        assert!(duz(&rapor_icerigi(&c, a).unwrap()).contains("TASINAN-NOT-KANARYASI"));
        assert!(!duz(&rapor_icerigi(&c, b).unwrap()).contains("TASINAN-NOT-KANARYASI"));

        randevu_guncelle(
            &c,
            rid,
            &RandevuGuncelleme {
                client_id: b,
                baslangic: "2026-09-07T14:00".into(),
                bitis: "2026-09-07T15:00".into(),
                ucret: None,
            },
            Cihaz::Masaustu,
        )
        .unwrap();

        // On kosul: denormalize kopya GERCEKTEN eski -- yoksa test yetkili
        // kaynagi degil tesadufen tutan kopyayi olcerdi.
        let kopya: i64 = c
            .query_row("SELECT client_id FROM progress_notes WHERE appointment_id = ?1", [rid], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(kopya, a, "on kosul: kopya eskimis kalmali");

        let a_metin = duz(&rapor_icerigi(&c, a).unwrap());
        let b_metin = duz(&rapor_icerigi(&c, b).unwrap());
        assert!(!a_metin.contains("TASINAN-NOT-KANARYASI"), "eski danisanin raporunda kaldi");
        assert!(a_metin.contains("Seans notları (0)"));
        assert!(b_metin.contains("TASINAN-NOT-KANARYASI"), "yeni danisanin raporuna girmedi");
    }

    // (c) limitsiz
    #[test]
    fn iki_yuz_elli_notun_hepsi_rapora_girer() {
        let (_d, c) = baglanti();
        let cid = danisan(&c, "Ayse Yilmaz");
        let bas = time::macros::date!(2025 - 01 - 01);
        for i in 0..250 {
            let gun = bas + time::Duration::days(i);
            let g = format!("{:04}-{:02}-{:02}", gun.year(), u8::from(gun.month()), gun.day());
            let rid = randevu(&c, cid, &format!("{g}T10:00"), &format!("{g}T11:00"));
            not_kaydet(&c, rid, "serbest", &format!("NOT-{i:03}-SONU"), Cihaz::Masaustu).unwrap();
        }
        let metin = duz(&rapor_icerigi(&c, cid).unwrap());
        for i in 0..250 {
            assert!(metin.contains(&format!("NOT-{i:03}-SONU")), "NOT-{i:03} raporda yok");
        }
        assert!(metin.contains("Seans notları (250)"));
    }

    // (d) seans tarihine gore ARTAN; ekleme sirasi ne artan ne azalan
    #[test]
    fn notlar_seans_tarihine_gore_artan_siralanir() {
        let (_d, c) = baglanti();
        let cid = danisan(&c, "Ayse Yilmaz");
        // Ekleme sirasi: ORTA, ESKI, YENI. Kimlik sirasi (id ASC/DESC) ve
        // guncelleme zamani ne artan ne azalan tarih sirasini verir.
        let orta = randevu(&c, cid, "2026-05-10T10:00", "2026-05-10T11:00");
        let eski = randevu(&c, cid, "2026-01-10T10:00", "2026-01-10T11:00");
        let yeni = randevu(&c, cid, "2026-09-10T10:00", "2026-09-10T11:00");
        not_kaydet(&c, yeni, "dap", "SIRA-YENI", Cihaz::Masaustu).unwrap();
        not_kaydet(&c, orta, "dap", "SIRA-ORTA", Cihaz::Masaustu).unwrap();
        not_kaydet(&c, eski, "dap", "SIRA-ESKI", Cihaz::Masaustu).unwrap();

        let metin = duz(&rapor_icerigi(&c, cid).unwrap());
        let yer = |k: &str| metin.find(k).unwrap_or_else(|| panic!("{k} yok"));
        assert!(
            yer("SIRA-ESKI") < yer("SIRA-ORTA") && yer("SIRA-ORTA") < yer("SIRA-YENI"),
            "notlar seans tarihine gore artan olmali: {metin}"
        );
    }

    // (e) risk notu yok, basvuru nedeni var
    #[test]
    fn risk_notu_rapora_girmez_basvuru_nedeni_girer() {
        let (_d, c) = baglanti();
        let cid = danisan(&c, "Ayse Yilmaz");
        danisan_guncelle(
            &c,
            cid,
            &DanisanGuncelleme {
                ad_soyad: None,
                telefon: None,
                dogum_tarihi: Some("1990-04-23".into()),
                basvuru_nedeni: Some("BASVURU-KANARYASI".into()),
                risk_notu: Some("RISK-KANARYASI".into()),
                riza_tarihi: None,
                riza_dosya_id: None,
            },
            Cihaz::Masaustu,
        )
        .unwrap();

        let metin = duz(&rapor_icerigi(&c, cid).unwrap());
        assert!(metin.contains("Başvuru nedeni: BASVURU-KANARYASI"), "{metin}");
        assert!(metin.contains("Doğum tarihi: 23.04.1990"), "{metin}");
        assert!(metin.contains("Telefon: (kayıtlı değil)"), "{metin}");
        assert!(!metin.contains("RISK-KANARYASI"), "risk notu rapora girmemeli: {metin}");
    }

    // (f) ek ADI ve turu var, ek ICERIGI yok
    #[test]
    fn ek_adi_rapora_girer_ek_icerigi_girmez() {
        let (_d, c) = baglanti();
        let cid = danisan(&c, "Ayse Yilmaz");
        let baska = danisan(&c, "Mehmet Demir");
        ek_ekle(
            &c,
            cid,
            "EK-ADI-KANARYASI.pdf",
            "application/pdf",
            "onam",
            b"EK-ICERIK-KANARYASI",
            Cihaz::Masaustu,
        )
        .unwrap();
        // Baska danisanin eki: ad sorgusu danisan filtresini kaybederse gorunur.
        ek_ekle(&c, baska, "BASKASININ-EKI.pdf", "application/pdf", "test", b"x", Cihaz::Masaustu)
            .unwrap();

        let metin = duz(&rapor_icerigi(&c, cid).unwrap());
        assert!(metin.contains("Ekli dosyalar (1)"), "{metin}");
        // ARTI YON: dosya adi KVKK md. 11 kapsaminda danisanin verisidir.
        assert!(
            metin.contains("- EK-ADI-KANARYASI.pdf · Onam · eklenme: "),
            "ek adi rapora girmeli: {metin}"
        );
        assert!(metin.contains("· 19 bayt"), "{metin}");
        // EKSI YON: icerik gomulmez, baskasinin eki gelmez.
        assert!(!metin.contains("EK-ICERIK-KANARYASI"), "ek icerigi rapora girmemeli: {metin}");
        assert!(!metin.contains("BASKASININ-EKI"), "baska danisanin eki: {metin}");
    }

    #[test]
    fn son_satir_ozel_not_beyanidir() {
        let (_d, c) = baglanti();
        let cid = danisan(&c, "Ayse Yilmaz");
        let icerik = rapor_icerigi(&c, cid).unwrap();
        let son = icerik.bolumler.last().and_then(|b| b.satirlar.last()).unwrap();
        assert_eq!(son, OZEL_NOT_BEYANI);
    }

    // (g) olmayan danisan
    #[test]
    fn olmayan_danisan_bulunamadi_doner() {
        let (_d, c) = baglanti();
        assert!(matches!(rapor_icerigi(&c, 9999), Err(DepoHatasi::Bulunamadi)));
    }

    // (h) log yazmaz
    #[test]
    fn rapor_icerigi_log_yazmaz() {
        let (_d, c) = baglanti();
        let cid = danisan(&c, "Ayse Yilmaz");
        let rid = randevu(&c, cid, "2026-09-07T14:00", "2026-09-07T15:00");
        not_kaydet(&c, rid, "dap", "x", Cihaz::Masaustu).unwrap();
        ek_ekle(&c, cid, "a.pdf", "application/pdf", "test", b"y", Cihaz::Masaustu).unwrap();
        let once = log_adedi(&c);
        let icerik = rapor_icerigi(&c, cid).unwrap();
        assert!(duz(&icerik).contains("Seans notları (1)"), "on kosul: rapor bos olmamali");
        let _ = rapor_icerigi(&c, 9999);
        assert_eq!(log_adedi(&c), once, "rapor_icerigi hicbir log satiri yazmamali");
    }

    // --- disa_aktarim_kaydi: kaldirilan `clients::veri_raporu_kaydi` testlerinin karsiligi

    #[test]
    fn disa_aktarim_kaydi_ayrintisiz_tek_satir_yazar() {
        let (_d, c) = baglanti();
        let cid = danisan(&c, "Ayse Yilmaz");
        let once = log_adedi(&c);
        disa_aktarim_kaydi(&c, cid, Cihaz::Masaustu).unwrap();
        assert_eq!(log_adedi(&c), once + 1);
        let k = son_kayitlar(&c, 1).unwrap().remove(0);
        assert_eq!((k.eylem.as_str(), k.varlik.as_str()), ("disa_aktarma", "client"));
        assert_eq!(k.varlik_id, cid.to_string());
        assert_eq!(k.ayrinti, None, "ayrinti bos olmali");
    }

    #[test]
    fn disa_aktarim_kaydi_birlestirilmez_ve_farkli_danisani_gizlemez() {
        let (_d, c) = baglanti();
        let a = danisan(&c, "Ayse");
        let b = danisan(&c, "Mehmet");
        for _ in 0..3 {
            disa_aktarim_kaydi(&c, a, Cihaz::Masaustu).unwrap();
        }
        disa_aktarim_kaydi(&c, b, Cihaz::Masaustu).unwrap();
        let satirlar: Vec<String> = son_kayitlar(&c, 100)
            .unwrap()
            .into_iter()
            .map(|k| format!("{}|{}|{}", k.eylem, k.varlik, k.varlik_id))
            .collect();
        let say = |id: i64| satirlar.iter().filter(|s| **s == format!("disa_aktarma|client|{id}")).count();
        assert_eq!(say(a), 3, "her disa aktarim ayri satir");
        assert_eq!(say(b), 1);
    }

    #[test]
    fn dosya_adi_verilen_yerel_gunu_tasir_danisan_adi_tasimaz() {
        // IKI farkli gun: sabit bir ad (or. sunucunun kendi gunu) ikisini
        // birden tutturamaz.
        assert_eq!(rapor_dosya_adi("2026-09-09").unwrap(), "danisan-veri-raporu-2026-09-09.pdf");
        assert_eq!(rapor_dosya_adi("2031-01-02").unwrap(), "danisan-veri-raporu-2031-01-02.pdf");
        // Artik yil sinirinda gecerli gun kabul edilir (her seyi reddeden
        // bir dogrulayici da yukaridaki eksi yon testini gecerdi).
        assert!(rapor_dosya_adi("2028-02-29").is_ok());
    }

    #[test]
    fn dosya_adi_gecersiz_gunu_reddeder() {
        for kotu in [
            "",
            "2026-02-30",
            "2026-9-9",
            "2026-09-09T00:00",
            "2026-09-09\"\r\nX: y",
            "../../../etc",
            "bugun",
        ] {
            assert!(
                matches!(rapor_dosya_adi(kotu), Err(DepoHatasi::GecersizVeri(_))),
                "gecersiz gun kabul edildi: {kotu:?}"
            );
        }
    }

    #[test]
    fn tarih_bicimleyicileri() {
        assert_eq!(seans_zamani_tr("2026-09-07T14:05"), "07.09.2026 14:05");
        assert_eq!(tarih_tr("2026-09-16T12:00:00Z"), "16.09.2026");
        assert_eq!(tarih_tr("bozuk"), "bozuk");
        assert_eq!(seans_zamani_tr("bozuk"), "bozuk");
    }
}
