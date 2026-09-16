//! Danışan veri raporu → AES-256 parola korumalı PDF.
//!
//! Bu modül veritabanını **bilmez**: düz bir [`RaporIcerigi`] alır, şifreli
//! PDF baytları döndürür. Neyin rapora girdiğine (ve özel notun girmediğine)
//! depo katmanı karar verir.
//!
//! # Biçim kararı
//!
//! Rapor danışana verilir (KVKK md. 11) ve danışanın işletim sistemi
//! bilinmez. Parola korumalı PDF macOS Önizleme, tarayıcılar ve Adobe
//! Reader'da ek yazılımsız açılır; AES şifreli ZIP macOS'un yerleşik Arşiv
//! İzlencesi'nde açılmaz. Şifreleme PDF 2.0 standart güvenlik işleyicisi,
//! V5/R6 (AES-256, `AESV3`). RC4, AES-128 ya da şifresiz bir yol **yoktur**;
//! biçim değişikliği bir ürün kararıdır (`sifreleme_aes256_dir` testi).
//!
//! # Hat
//!
//! `printpdf` (gömülü Noto Sans, alt kümelenmiş, ToUnicode haritalı) →
//! baytlar → `lopdf::Document::load_mem` → `encrypt(V5)` → `save_to`.
//! `printpdf`'in kendi `lopdf` bağımlılığı farklı sürümde olduğu için
//! belge nesnesi değil **baytlar** devredilir.

use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

use lopdf::encryption::crypt_filters::{Aes256CryptFilter, CryptFilter};
use lopdf::{EncryptionState, EncryptionVersion, Permissions};
use printpdf::{
    Mm, Op, ParsedFont, PdfDocument, PdfFontHandle, PdfPage, PdfSaveOptions, Point, Pt, TextItem,
};
use rand::RngCore;
use zeroize::Zeroizing;

/// Asgari parola uzunluğu — **karakter** cinsinden (`chars().count()`).
pub const ASGARI_PAROLA: usize = 8;

/// Noto Sans Regular, SIL Open Font License 1.1 (lisans metni aynı dizinde
/// `OFL.txt`). Türkçe glifleri (`ç ğ ı İ ö ş ü` ve büyükleri) içerir.
const NOTO_SANS: &[u8] = include_bytes!("../assets/fonts/NotoSans-Regular.ttf");

// Sayfa düzeni: A4, 20 mm kenar boşluğu, 11 pt gövde.
const SAYFA_GENISLIK_MM: f32 = 210.0;
const SAYFA_YUKSEKLIK_MM: f32 = 297.0;
const KENAR_MM: f32 = 20.0;
const GOVDE_PT: f32 = 11.0;
const BOLUM_BASLIK_PT: f32 = 13.0;
const RAPOR_BASLIK_PT: f32 = 16.0;
const SATIR_ARALIGI: f32 = 1.4;

/// Rapora girecek düz içerik. `Debug` elle yazılmıştır: içerik basılmaz.
pub struct RaporIcerigi {
    pub baslik: String,
    pub bolumler: Vec<RaporBolumu>,
}

/// Raporun bir bölümü. `Debug` elle yazılmıştır: içerik basılmaz.
pub struct RaporBolumu {
    pub baslik: String,
    pub satirlar: Vec<String>,
}

impl std::fmt::Debug for RaporIcerigi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RaporIcerigi")
            .field("baslik", &"<gizli>")
            .field("bolum_sayisi", &self.bolumler.len())
            .finish()
    }
}

impl std::fmt::Debug for RaporBolumu {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RaporBolumu")
            .field("baslik", &"<gizli>")
            .field("satir_sayisi", &self.satirlar.len())
            .finish()
    }
}

/// PDF üretim hatası. `Uretim`/`Sifreleme` mesajları kütüphane hatasıdır;
/// rapor içeriği ya da parola taşımaz.
#[derive(Debug, thiserror::Error)]
pub enum PdfHatasi {
    #[error("parola en az {ASGARI_PAROLA} karakter olmali")]
    ParolaCokKisa,
    #[error("PDF uretilemedi: {0}")]
    Uretim(String),
    #[error("PDF sifrelenemedi: {0}")]
    Sifreleme(String),
}

/// İçeriği PDF'e çevirir ve verilen parolayla AES-256 (V5/R6) şifreler.
///
/// Kullanıcı parolası = sahip parolası = `parola`. İzinler: yazdırma ve
/// kopyalama açık, değiştirme kapalı. Dosya şifreleme anahtarı her çağrıda
/// yeniden rastgele üretilir.
pub fn sifreli_pdf(icerik: &RaporIcerigi, parola: &str) -> Result<Vec<u8>, PdfHatasi> {
    if parola.chars().count() < ASGARI_PAROLA {
        return Err(PdfHatasi::ParolaCokKisa);
    }

    let duz = duz_pdf(icerik)?;

    let mut belge =
        lopdf::Document::load_mem(&duz).map_err(|e| PdfHatasi::Uretim(e.to_string()))?;

    let mut anahtar = Zeroizing::new([0u8; 32]);
    rand::thread_rng().fill_bytes(anahtar.as_mut());

    let filtre: Arc<dyn CryptFilter> = Arc::new(Aes256CryptFilter);
    let surum = EncryptionVersion::V5 {
        encrypt_metadata: true,
        crypt_filters: BTreeMap::from([(b"StdCF".to_vec(), filtre)]),
        file_encryption_key: anahtar.as_ref(),
        stream_filter: b"StdCF".to_vec(),
        string_filter: b"StdCF".to_vec(),
        owner_password: parola,
        user_password: parola,
        permissions: Permissions::PRINTABLE
            | Permissions::PRINTABLE_IN_HIGH_QUALITY
            | Permissions::COPYABLE
            | Permissions::COPYABLE_FOR_ACCESSIBILITY,
    };
    let durum =
        EncryptionState::try_from(surum).map_err(|e| PdfHatasi::Sifreleme(e.to_string()))?;
    belge
        .encrypt(&durum)
        .map_err(|e| PdfHatasi::Sifreleme(e.to_string()))?;

    let mut cikti = Vec::new();
    belge
        .save_to(&mut cikti)
        .map_err(|e| PdfHatasi::Uretim(e.to_string()))?;
    Ok(cikti)
}

/// Gömülü font, süreç başına bir kez ayrıştırılır.
fn font() -> Result<&'static ParsedFont, PdfHatasi> {
    static FONT: OnceLock<Option<ParsedFont>> = OnceLock::new();
    FONT.get_or_init(|| ParsedFont::from_bytes(NOTO_SANS, 0, &mut Vec::new()))
        .as_ref()
        .ok_or_else(|| PdfHatasi::Uretim("gomulu font ayristirilamadi".into()))
}

/// Metnin verilen punto büyüklüğündeki genişliği (pt).
fn genislik(font: &ParsedFont, metin: &str, punto: f32) -> f32 {
    let birim: u32 = metin
        .chars()
        .map(|k| {
            let gid = font.lookup_glyph_index(k as u32).unwrap_or(0);
            u32::from(font.get_glyph_width(gid).unwrap_or(0))
        })
        .sum();
    birim as f32 / f32::from(font.units_per_em.max(1)) * punto
}

/// Bir paragrafı `azami` genişliğe sığacak satırlara böler. Tek başına
/// sığmayan bir kelime karakter karakter bölünür; hiçbir karakter atılmaz.
/// Boş paragraf tek bir boş satır olarak korunur.
fn sar(font: &ParsedFont, paragraf: &str, punto: f32, azami: f32) -> Vec<String> {
    let mut satirlar = Vec::new();
    let mut mevcut = String::new();
    for kelime in paragraf.split_whitespace() {
        let aday = if mevcut.is_empty() {
            kelime.to_string()
        } else {
            format!("{mevcut} {kelime}")
        };
        if genislik(font, &aday, punto) <= azami {
            mevcut = aday;
            continue;
        }
        if !mevcut.is_empty() {
            satirlar.push(std::mem::take(&mut mevcut));
        }
        if genislik(font, kelime, punto) <= azami {
            mevcut = kelime.to_string();
            continue;
        }
        for k in kelime.chars() {
            let mut aday = mevcut.clone();
            aday.push(k);
            if !mevcut.is_empty() && genislik(font, &aday, punto) > azami {
                satirlar.push(std::mem::take(&mut mevcut));
            }
            mevcut.push(k);
        }
    }
    if !mevcut.is_empty() || satirlar.is_empty() {
        satirlar.push(mevcut);
    }
    satirlar
}

/// Sayfaları dolduran dizgici: satır sığmazsa yeni sayfaya geçer.
struct Dizgici<'a> {
    font: &'a ParsedFont,
    font_tutamagi: PdfFontHandle,
    sayfalar: Vec<PdfPage>,
    islemler: Vec<Op>,
    /// Bir sonraki satırın üst kenarı (pt, sayfanın altından).
    y: f32,
}

impl<'a> Dizgici<'a> {
    fn ust() -> f32 {
        Pt::from(Mm(SAYFA_YUKSEKLIK_MM - KENAR_MM)).0
    }
    fn alt() -> f32 {
        Pt::from(Mm(KENAR_MM)).0
    }
    fn sol() -> f32 {
        Pt::from(Mm(KENAR_MM)).0
    }
    fn azami_genislik() -> f32 {
        Pt::from(Mm(SAYFA_GENISLIK_MM - 2.0 * KENAR_MM)).0
    }

    fn sayfayi_kapat(&mut self) {
        let islemler = std::mem::take(&mut self.islemler);
        self.sayfalar.push(PdfPage::new(
            Mm(SAYFA_GENISLIK_MM),
            Mm(SAYFA_YUKSEKLIK_MM),
            islemler,
        ));
        self.y = Self::ust();
    }

    fn paragraf(&mut self, metin: &str, punto: f32) {
        // Satır sonları paragraf ayırıcıdır; sekme ve CR glif üretmez.
        let temiz = metin.replace('\r', "").replace('\t', "    ");
        for parca in temiz.split('\n') {
            for satir in sar(self.font, parca, punto, Self::azami_genislik()) {
                self.satir(&satir, punto);
            }
        }
    }

    fn satir(&mut self, metin: &str, punto: f32) {
        let yukseklik = punto * SATIR_ARALIGI;
        if self.y - yukseklik < Self::alt() && !self.islemler.is_empty() {
            self.sayfayi_kapat();
        }
        let taban = self.y - punto;
        self.y -= yukseklik;
        if metin.is_empty() {
            return;
        }
        self.islemler.extend([
            Op::StartTextSection,
            Op::SetFont {
                font: self.font_tutamagi.clone(),
                size: Pt(punto),
            },
            Op::SetTextCursor {
                pos: Point {
                    x: Pt(Self::sol()),
                    y: Pt(taban),
                },
            },
            Op::ShowText {
                items: vec![TextItem::Text(metin.to_string())],
            },
            Op::EndTextSection,
        ]);
    }

    fn bosluk(&mut self, pt: f32) {
        self.y -= pt;
    }
}

/// Şifrelenmemiş PDF baytları. Modül dışına **çıkmaz**; tek çağıranı
/// `sifreli_pdf`.
fn duz_pdf(icerik: &RaporIcerigi) -> Result<Vec<u8>, PdfHatasi> {
    let font = font()?;
    let mut belge = PdfDocument::new(&icerik.baslik);
    let font_id = belge.add_font(font);

    let mut d = Dizgici {
        font,
        font_tutamagi: PdfFontHandle::External(font_id),
        sayfalar: Vec::new(),
        islemler: Vec::new(),
        y: Dizgici::ust(),
    };

    d.paragraf(&icerik.baslik, RAPOR_BASLIK_PT);
    for bolum in &icerik.bolumler {
        d.bosluk(GOVDE_PT);
        d.paragraf(&bolum.baslik, BOLUM_BASLIK_PT);
        for satir in &bolum.satirlar {
            d.paragraf(satir, GOVDE_PT);
        }
    }
    d.sayfayi_kapat();

    let sayfalar = std::mem::take(&mut d.sayfalar);
    let mut uyarilar = Vec::new();
    let baytlar = belge
        .with_pages(sayfalar)
        .save(&PdfSaveOptions::default(), &mut uyarilar);
    if baytlar.is_empty() {
        return Err(PdfHatasi::Uretim("printpdf bos cikti uretti".into()));
    }
    Ok(baytlar)
}

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

    /// `lopdf` 0.45'te `load_mem` + `decrypt` şifreli nesneleri **yüklemez**
    /// (parolasız yüklemede yalnızca `/Encrypt` sözlüğü belleğe alınır,
    /// sonradan `decrypt` boş bir belgeyi "çözer"). Parolayla okumanın gerçek
    /// yolu `LoadOptions::with_password`; yanlış parola `Err` döner.
    fn parolayla_yukle(pdf: &[u8], parola: &str) -> Result<lopdf::Document, String> {
        let doc = lopdf::Document::load_mem_with_options(pdf, lopdf::LoadOptions::with_password(parola))
            .map_err(|e| e.to_string())?;
        Ok(doc)
    }

    fn metin_cikar(pdf: &[u8], parola: &str) -> Result<String, String> {
        let doc = parolayla_yukle(pdf, parola)?;
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

    /// Belge başlığı `/Info` sözlüğüne **dizgi** olarak yazılır (içerik
    /// akışı gibi sıkıştırılmaz, glif kimliğine çevrilmez). Şifreleme
    /// kalkarsa ham baytlarda okunur hâle gelen yer burasıdır; üstteki
    /// testin kanaryası Flate ile sıkıştırılmış, glif kimliklerine çevrilmiş
    /// içerik akışında durduğundan **şifresiz** dosyada da görünmez (mutasyonla
    /// ölçüldü: `encrypt` kaldırılınca o iddia yeşil kalıyor, onu `is_encrypted`
    /// kırıyor).
    ///
    /// `printpdf` başlığı UTF-16BE onaltılık dizgi (`<FEFF0042...>`) olarak
    /// yazar; düz ASCII araması şifresiz dosyada da hiçbir şey bulmazdı
    /// (ilk sürüm tam olarak böyleydi ve mutasyonda yeşil kaldı). İki biçim
    /// birden aranır.
    #[test]
    fn baslik_ustverisi_de_ham_baytlarda_gecmez() {
        const BASLIK: &str = "BASLIK-USTVERI-KANARYASI-9C2E";
        let mut ic = icerik();
        ic.baslik = BASLIK.into();
        let pdf = sifreli_pdf(&ic, "dogru-parola-123").unwrap();
        let ham = String::from_utf8_lossy(&pdf).to_uppercase();
        let utf16_hex: String = BASLIK.encode_utf16().map(|b| format!("{b:04X}")).collect();
        assert!(!ham.contains(BASLIK), "baslik duz ASCII olarak gorunmemeli");
        assert!(!ham.contains(&utf16_hex), "baslik UTF-16BE onaltilik olarak gorunmemeli");
        // Arti yon: baslik gercekten dosyada (dogru parolayla okunur).
        let doc = parolayla_yukle(&pdf, "dogru-parola-123").unwrap();
        let bilgi = doc
            .trailer
            .get(b"Info")
            .and_then(|o| o.as_reference())
            .and_then(|id| doc.get_dictionary(id))
            .expect("Info sozlugu");
        let baslik = lopdf::decode_text_string(bilgi.get(b"Title").expect("Title")).unwrap();
        assert_eq!(baslik, "BASLIK-USTVERI-KANARYASI-9C2E");
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

    /// Üstteki bayt karşılaştırması tek başına anahtarı ölçmez: AES IV'leri
    /// ve U/O tuzları zaten her seferinde rastgele, sabit bir anahtarla da
    /// baytlar farklı çıkar. Burada **dosya şifreleme anahtarının kendisi**
    /// parolayla türetilip karşılaştırılır.
    #[test]
    fn dosya_sifreleme_anahtari_her_uretimde_yenidir() {
        let anahtar = |pdf: &[u8]| {
            let doc = lopdf::Document::load_mem(pdf).unwrap();
            let alg = lopdf::encryption::PasswordAlgorithm::try_from(&doc).unwrap();
            let parola = alg.sanitize_password("dogru-parola-123").unwrap();
            alg.compute_file_encryption_key(&doc, &parola).unwrap()
        };
        let a = anahtar(&sifreli_pdf(&icerik(), "dogru-parola-123").unwrap());
        let b = anahtar(&sifreli_pdf(&icerik(), "dogru-parola-123").unwrap());
        assert_eq!(a.len(), 32, "AES-256 anahtari 32 bayt");
        assert_ne!(a, b, "her uretimde yeni anahtar");
        assert_ne!(a, vec![0u8; 32]);
    }

    /// Yazdırma ve kopyalama açık (danışanın kendi verisi); değiştirme ve
    /// not ekleme kapalı. İki yön: "hiç izin yok" da "her şey serbest" de
    /// bu testi kırar.
    #[test]
    fn izinler_yazdirma_ve_kopyalama_acik_degistirme_kapali() {
        let pdf = sifreli_pdf(&icerik(), "dogru-parola-123").unwrap();
        let doc = lopdf::Document::load_mem(&pdf).unwrap();
        let p = doc.get_encrypted().unwrap().get(b"P").unwrap().as_i64().unwrap();
        let bit = |b: u32| p & (1i64 << (b - 1)) != 0; // PDF bit numaralari 1 tabanli
        assert!(bit(3), "yazdirma acik olmali");
        assert!(bit(5), "kopyalama acik olmali");
        assert!(bit(12), "yuksek kaliteli yazdirma acik olmali");
        assert!(!bit(4), "degistirme kapali olmali");
        assert!(!bit(6), "not ekleme kapali olmali");
        assert!(!bit(11), "sayfa birlestirme kapali olmali");
    }

    #[test]
    fn kisa_parola_reddedilir_sinirdaki_kabul_edilir() {
        assert!(matches!(sifreli_pdf(&icerik(), "1234567"), Err(PdfHatasi::ParolaCokKisa)));
        assert!(sifreli_pdf(&icerik(), "12345678").is_ok());
        assert!(sifreli_pdf(&icerik(), "şşşşşşşş").is_ok(), "sinir KARAKTER, bayt degil");
        // Ters yon: 7 karakter ama 14 bayt. Bayt sayan bir uygulama bunu
        // kabul ederdi; yukaridaki satir o hatayi yakalayamaz (bayt sayisi
        // karakter sayisindan hep buyuk ya da esit).
        assert!(
            matches!(sifreli_pdf(&icerik(), "şşşşşşş"), Err(PdfHatasi::ParolaCokKisa)),
            "7 cok baytli karakter de kisa sayilmali"
        );
    }

    #[test]
    fn turkce_parolayla_sifrelenen_dosya_ayni_parolayla_acilir() {
        let pdf = sifreli_pdf(&icerik(), "şifreĞİ-ıöç").unwrap();
        assert!(metin_cikar(&pdf, "şifreĞİ-ıöç").unwrap().contains(KANARYA));
        assert!(metin_cikar(&pdf, "sifreGI-ioc").map_or(true, |m| !m.contains(KANARYA)));
    }

    #[test]
    fn uzun_icerik_kirpilmaz_birden_fazla_sayfaya_yayilir() {
        let mut ic = icerik();
        ic.bolumler[0].satirlar.push("SON-SATIR-KANARYASI".into());
        let pdf = sifreli_pdf(&ic, "dogru-parola-123").unwrap();
        let doc = parolayla_yukle(&pdf, "dogru-parola-123").unwrap();
        assert!(doc.get_pages().len() > 1, "2000 kelimelik satir tek sayfaya sigmamali");
        assert!(metin_cikar(&pdf, "dogru-parola-123").unwrap().contains("SON-SATIR-KANARYASI"));
    }

    /// Satır sarma hiçbir kelimeyi yutmamalı: 2000 "uzun"un hepsi çıkarılan
    /// metinde bulunur.
    #[test]
    fn satir_sarma_kelime_kaybetmez() {
        let pdf = sifreli_pdf(&icerik(), "dogru-parola-123").unwrap();
        let metin = metin_cikar(&pdf, "dogru-parola-123").unwrap();
        assert_eq!(metin.matches("uzun").count(), 2000);
    }

    #[test]
    fn sarilan_satirlar_sayfa_genisligini_asmaz() {
        let font = font().unwrap();
        let azami = Dizgici::azami_genislik();
        let satirlar = sar(font, &"uzun ".repeat(2000), GOVDE_PT, azami);
        assert!(satirlar.len() > 50);
        for s in &satirlar {
            assert!(genislik(font, s, GOVDE_PT) <= azami, "tasan satir: {s}");
        }
        // Tek basina sigmayan kelime karakterlerine bolunur, karakter kaybolmaz.
        let dev = "A".repeat(500);
        let parcalar = sar(font, &dev, GOVDE_PT, azami);
        assert!(parcalar.len() > 1);
        assert_eq!(parcalar.concat(), dev);
    }

    #[test]
    fn debug_icerigi_basmaz() {
        let s = format!("{:?}", icerik());
        assert!(!s.contains(KANARYA) && !s.contains("Seans notları"));
    }
}
