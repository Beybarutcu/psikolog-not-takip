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
//! başlığı). `store::search`'teki workspace geneli tarama bu dosyayı dizinden
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
//! # Randevular ve ödemeler (dal incelemesi kararı D1)
//!
//! Danışanın **bütün** randevuları — notlu ya da notsuz, iptal edilmiş
//! olanlar dahil, limitsiz — seans zamanı, durum, ücret ve ödendi bilgisiyle
//! girer. Seans notları bölümü yalnızca notu olan seansları gösterir; ödeme
//! ve devam bilgisi de md. 11'in "elimdeki her şey"inin parçasıdır. Ekseni
//! notlarla aynı: `a.client_id`, sıra `a.baslangic ASC, a.id ASC`. Ücret
//! web'in `tlMetni`'siyle aynı biçimde yazılır (`tl_metni`).
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

/// Randevu durum kodunun rapordaki Türkçe etiketi. Bilinmeyen kod olduğu
/// gibi (şema `CHECK` kısıtı bugün dört değere izin veriyor).
fn durum_adi(kod: &str) -> &str {
    match kod {
        "planlandi" => "Planlandı",
        "geldi" => "Geldi",
        "gelmedi" => "Gelmedi",
        "iptal" => "İptal",
        diger => diger,
    }
}

/// Tam sayı kuruş → `1.234,50 TL`.
///
/// Web'deki `web/src/para.ts::tlMetni` ile **aynı biçim** (binlik ayraç
/// nokta, ondalık virgül, kuruş iki hane, negatifte işaret başta). `Intl`
/// ya da yerel ayar kullanılmaz: ekran ile rapor aynı tutarı aynı metinle
/// göstermeli. Web tarafındaki tablonun Rust karşılığı
/// `tl_metni_web_tlmetni_ile_ayni_bicimdedir`.
fn tl_metni(kurus: i64) -> String {
    let isaret = if kurus < 0 { "-" } else { "" };
    let mutlak = kurus.unsigned_abs();
    let lira = (mutlak / 100).to_string();
    let mut lira_metni = String::with_capacity(lira.len() + lira.len() / 3);
    for (i, k) in lira.chars().enumerate() {
        if i > 0 && (lira.len() - i) % 3 == 0 {
            lira_metni.push('.');
        }
        lira_metni.push(k);
    }
    format!("{isaret}{lira_metni},{:02} TL", mutlak % 100)
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

    // Randevular ve odemeler (dal incelemesi karari D1): notlu ya da notsuz
    // TUM randevular, LIMIT YOK. Danisan ekseni yetkili kaynak `a.client_id`
    // (tasinan randevu yeni danisanda). Iptal edilmis randevu da danisanin
    // verisidir, durum etiketiyle girer.
    let mut stmt = conn.prepare(
        "SELECT a.baslangic, a.durum, a.ucret, a.odendi
         FROM appointments a
         WHERE a.client_id = ?1
         ORDER BY a.baslangic ASC, a.id ASC",
    )?;
    let randevular = stmt
        .query_map([client_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<i64>>(2)?,
                r.get::<_, i64>(3)? != 0,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    let mut randevu_satirlari: Vec<String> = randevular
        .iter()
        .map(|(baslangic, durum, ucret, odendi)| {
            let ucret = match ucret {
                Some(k) => format!("Ücret: {}", tl_metni(*k)),
                None => "Ücret girilmemiş".to_string(),
            };
            format!(
                "- {} · {} · {ucret} · Ödendi: {}",
                seans_zamani_tr(baslangic),
                durum_adi(durum),
                if *odendi { "Evet" } else { "Hayır" }
            )
        })
        .collect();
    if randevu_satirlari.is_empty() {
        randevu_satirlari.push("Kayıtlı randevu yok.".to_string());
    }
    let randevu_bolumu = RaporBolumu {
        baslik: format!("Randevular ve ödemeler ({})", randevular.len()),
        satirlar: randevu_satirlari,
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
        bolumler: vec![kimlik, randevu_bolumu, seans_notlari, ek_bolumu, kapsam],
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
            durum_guncelle, guncelle as randevu_guncelle, odeme_guncelle,
            olustur as randevu_olustur, RandevuGuncelleme, YeniRandevu,
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

    // (d2) Esitlik bozucu: ayni danisana ayni `baslangic` ile iki randevu
    // kurulabiliyor (cakisma uyarir, engellemez). O zaman sirayi YALNIZCA
    // `p.appointment_id ASC` verir. Notlar randevularin TERSI sirayla
    // kaydediliyor: not tablosunun ekleme/satir sirasi `DESC` ile ayni sonucu
    // verir, dolayisiyla ikincil anahtar ters cevrilirse bu test kirilir.
    #[test]
    fn ayni_baslangicli_notlar_randevu_kimligine_gore_artan_siralanir() {
        let (_d, c) = baglanti();
        let cid = danisan(&c, "Ayse Yilmaz");
        let ilk = randevu(&c, cid, "2026-05-10T10:00", "2026-05-10T11:00");
        let ikinci = randevu(&c, cid, "2026-05-10T10:00", "2026-05-10T11:00");
        // On kosul: iki randevu GERCEKTEN ayni baslangicta ve kimlik sirasi belli
        // -- yoksa test birincil anahtari olcerdi (bicim 8).
        assert!(ilk < ikinci, "on kosul: randevu kimlikleri artan");
        let baslangiclar: Vec<String> = c
            .prepare("SELECT baslangic FROM appointments WHERE client_id = ?1")
            .unwrap()
            .query_map([cid], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(baslangiclar.len(), 2);
        assert_eq!(baslangiclar[0], baslangiclar[1], "on kosul: esit baslangic");

        // Ekleme sirasi randevu kimliginin TERSI.
        not_kaydet(&c, ikinci, "dap", "ESIT-IKINCI-RANDEVU", Cihaz::Masaustu).unwrap();
        not_kaydet(&c, ilk, "dap", "ESIT-ILK-RANDEVU", Cihaz::Masaustu).unwrap();

        let metin = duz(&rapor_icerigi(&c, cid).unwrap());
        let yer = |k: &str| metin.find(k).unwrap_or_else(|| panic!("{k} yok: {metin}"));
        assert!(
            yer("ESIT-ILK-RANDEVU") < yer("ESIT-IKINCI-RANDEVU"),
            "esit baslangicta randevu kimligine gore ARTAN olmali: {metin}"
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

    fn ucretli_randevu(c: &Connection, cid: i64, bas: &str, ucret: Option<i64>) -> i64 {
        let bitis = format!("{}T23:59", &bas[..10]);
        randevu_olustur(
            c,
            &YeniRandevu { client_id: cid, baslangic: bas.into(), bitis, ucret },
            Cihaz::Masaustu,
        )
        .unwrap()
        .id
    }

    // (i) karar D1: notsuz ve iptal edilmis randevular da, ucret/odendi ile
    #[test]
    fn randevular_ve_odemeler_notsuz_ve_iptal_randevulari_da_icerir() {
        let (_d, c) = baglanti();
        let cid = danisan(&c, "Ayse Yilmaz");
        let baska = danisan(&c, "Mehmet Demir");
        // Ekleme sirasi tarih sirasinin NE AYNISI NE TERSI (bicim 8).
        let orta = ucretli_randevu(&c, cid, "2026-05-10T10:00", Some(123450));
        let eski = ucretli_randevu(&c, cid, "2026-01-10T09:30", Some(45000));
        ucretli_randevu(&c, cid, "2026-09-10T16:15", None);
        durum_guncelle(&c, eski, "geldi", Cihaz::Masaustu).unwrap();
        odeme_guncelle(&c, eski, true, Cihaz::Masaustu).unwrap();
        durum_guncelle(&c, orta, "iptal", Cihaz::Masaustu).unwrap();
        // Yalnizca ESKI'nin notu var: bolum notlu seanslarla sinirli kalirsa
        // orta ve yeni gorunmez.
        not_kaydet(&c, eski, "dap", "NOTLU", Cihaz::Masaustu).unwrap();
        ozel_not_kaydet(&c, orta, "OZEL-KANARYA-RANDEVU", Cihaz::Masaustu).unwrap();
        ucretli_randevu(&c, baska, "2026-03-03T11:00", Some(777700));

        let metin = duz(&rapor_icerigi(&c, cid).unwrap());
        assert!(metin.contains("Randevular ve ödemeler (3)"), "{metin}");
        let satir_eski = "- 10.01.2026 09:30 · Geldi · Ücret: 450,00 TL · Ödendi: Evet";
        let satir_orta = "- 10.05.2026 10:00 · İptal · Ücret: 1.234,50 TL · Ödendi: Hayır";
        let satir_yeni = "- 10.09.2026 16:15 · Planlandı · Ücret girilmemiş · Ödendi: Hayır";
        let yer = |k: &str| metin.find(k).unwrap_or_else(|| panic!("`{k}` yok:\n{metin}"));
        assert!(
            yer(satir_eski) < yer(satir_orta) && yer(satir_orta) < yer(satir_yeni),
            "randevular seans zamanina gore artan olmali:\n{metin}"
        );
        // EKSI YON: baskasinin randevusu ve ozel not yok.
        assert!(!metin.contains("7.777,00 TL") && !metin.contains("03.03.2026"), "{metin}");
        assert!(!metin.contains("OZEL-KANARYA-RANDEVU"), "{metin}");
    }

    #[test]
    fn randevular_ve_odemeler_gelmedi_etiketi_ve_bos_durum() {
        let (_d, c) = baglanti();
        let cid = danisan(&c, "Ayse Yilmaz");
        assert!(duz(&rapor_icerigi(&c, cid).unwrap()).contains("Randevular ve ödemeler (0)"));
        assert!(duz(&rapor_icerigi(&c, cid).unwrap()).contains("Kayıtlı randevu yok."));
        let r = ucretli_randevu(&c, cid, "2026-02-02T08:00", Some(0));
        durum_guncelle(&c, r, "gelmedi", Cihaz::Masaustu).unwrap();
        let metin = duz(&rapor_icerigi(&c, cid).unwrap());
        assert!(
            metin.contains("- 02.02.2026 08:00 · Gelmedi · Ücret: 0,00 TL · Ödendi: Hayır"),
            "{metin}"
        );
        assert!(!metin.contains("Kayıtlı randevu yok."), "{metin}");
    }

    // Esitlik bozucu: ayni baslangicta sira yalnizca `a.id ASC`.
    #[test]
    fn ayni_baslangicli_randevular_kimlige_gore_artan() {
        let (_d, c) = baglanti();
        let cid = danisan(&c, "Ayse Yilmaz");
        ucretli_randevu(&c, cid, "2026-05-10T10:00", Some(100));
        ucretli_randevu(&c, cid, "2026-05-10T10:00", Some(200));
        let metin = duz(&rapor_icerigi(&c, cid).unwrap());
        let yer = |k: &str| metin.find(k).unwrap_or_else(|| panic!("`{k}` yok:\n{metin}"));
        assert!(yer("Ücret: 1,00 TL") < yer("Ücret: 2,00 TL"), "{metin}");
    }

    #[test]
    fn tasinan_randevu_randevular_bolumunde_yeni_danisana_gider() {
        let (_d, c) = baglanti();
        let a = danisan(&c, "Ayse Yilmaz");
        let b = danisan(&c, "Mehmet Demir");
        let rid = ucretli_randevu(&c, a, "2026-09-07T14:00", Some(98765));
        assert!(duz(&rapor_icerigi(&c, a).unwrap()).contains("987,65 TL"), "on kosul");
        randevu_guncelle(
            &c,
            rid,
            &RandevuGuncelleme {
                client_id: b,
                baslangic: "2026-09-07T14:00".into(),
                bitis: "2026-09-07T23:59".into(),
                ucret: Some(98765),
            },
            Cihaz::Masaustu,
        )
        .unwrap();
        let a_metin = duz(&rapor_icerigi(&c, a).unwrap());
        let b_metin = duz(&rapor_icerigi(&c, b).unwrap());
        assert!(!a_metin.contains("987,65 TL") && a_metin.contains("Randevular ve ödemeler (0)"));
        assert!(b_metin.contains("- 07.09.2026 14:00 · Planlandı · Ücret: 987,65 TL"), "{b_metin}");
    }

    /// `web/src/para.test.ts`'teki tablonun aynisi: iki taraf ayni tutari ayni
    /// metinle gostermeli.
    #[test]
    fn tl_metni_web_tlmetni_ile_ayni_bicimdedir() {
        for (kurus, beklenen) in [
            (45000, "450,00 TL"),
            (0, "0,00 TL"),
            (45050, "450,50 TL"),
            (1, "0,01 TL"),
            (99, "0,99 TL"),
            (99999, "999,99 TL"),
            (100000, "1.000,00 TL"),
            (123450, "1.234,50 TL"),
            (1234567, "12.345,67 TL"),
            (123456789, "1.234.567,89 TL"),
            (100000000000, "1.000.000.000,00 TL"),
            (-150, "-1,50 TL"),
            (-123456, "-1.234,56 TL"),
        ] {
            assert_eq!(tl_metni(kurus), beklenen, "{kurus}");
        }
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
