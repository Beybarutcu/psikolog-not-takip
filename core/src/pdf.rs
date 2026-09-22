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
//! `printpdf` (Noto Sans **tamamı** gömülü — `printpdf` `text_layout`
//! özelliği olmadan alt kümeleme yapmaz, dosya başına ~320 KB; ToUnicode
//! haritalı) →
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

/// Ardışık dikey boşluğun (boş satırlar + bölüm aralıkları) üst sınırı: üç
/// gövde satırı. Karar: boşluk görsel biçimdir, veri değildir. Yapıştırılmış
/// bir notta yüzlerce boş satır sayfalarca boş kâğıt ya da (eski hatada)
/// sayfa dışına itilmiş, görünmez metin üretmemeli. Üç satır, paragrafları
/// ayırmaya yeter; sayfa başında bekleyen boşluk ise tamamen yutulur.
const AZAMI_BOSLUK_PT: f32 = 3.0 * GOVDE_PT * SATIR_ARALIGI;

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
///
/// **CPU-yoğun ve eşzamanlıdır** (debug derlemede 20 000 satır ≈ 12 sn):
/// async bağlamda doğrudan değil `tokio::task::spawn_blocking` içinde
/// çağrılmalıdır, yoksa çalışma zamanı iş parçacığını bloklar.
///
/// # Bellekte kalan düz metin
///
/// Bizim tuttuğumuz şifresiz PDF baytları ve dosya anahtarı `Zeroizing`
/// içindedir. Ancak **silinemeyen kopyalar vardır** ve bu fonksiyon onları
/// sıfırladığını iddia etmez: `printpdf`'in ara yapıları, şifrelemeden önce
/// düz nesneleri tutan `lopdf::Document`, `EncryptionState`'in içindeki
/// anahtar kopyası ve parola türevleri bu kütüphanelerin bellek yönetimine
/// bırakılmıştır.
pub fn sifreli_pdf(icerik: &RaporIcerigi, parola: &str) -> Result<Vec<u8>, PdfHatasi> {
    if parola.chars().count() < ASGARI_PAROLA {
        return Err(PdfHatasi::ParolaCokKisa);
    }

    let duz = Zeroizing::new(duz_pdf(icerik)?);

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
///
/// Fontta olmayan bir karakteri (emoji, CJK…) `printpdf` glif 0 olarak yazar
/// ve `/W` tablosuna koymaz; okuyucu onu `/DW` = 1000, yani **1 em** genişlikte
/// çizer. Sarma hesabı da aynı genişliği kullanır; aksi hâlde (eski `.notdef`
/// / 0 genişlik) böyle bir satır hiç sarılmadan sağdan taşardı.
fn genislik(font: &ParsedFont, metin: &str, punto: f32) -> f32 {
    let em = u32::from(font.units_per_em.max(1));
    let birim: u32 = metin
        .chars()
        .map(|k| {
            font.lookup_glyph_index(k as u32)
                .and_then(|gid| font.get_glyph_width(gid))
                .map_or(em, u32::from)
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
    /// Boş satırlardan ve bölüm aralıklarından biriken, henüz uygulanmamış
    /// dikey boşluk (pt).
    bekleyen_bosluk: f32,
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

    /// Metin satırı çizer. Boş satır yalnızca bekleyen boşluğa eklenir.
    ///
    /// Değişmez: `y` yalnızca bir çizim işlemiyle birlikte azalır. Böylece
    /// `islemler` boşken `y == ust()` olur ve sayfaya sığmayan her satır
    /// (boş olmayan sayfada) yeni sayfa açar; `y` hiçbir zaman alt kenarın
    /// altına inmez.
    fn satir(&mut self, metin: &str, punto: f32) {
        let yukseklik = punto * SATIR_ARALIGI;
        if metin.is_empty() {
            self.bosluk(yukseklik);
            return;
        }
        // Sayfa başındaki boşluk yutulur.
        let bosluk = if self.islemler.is_empty() {
            0.0
        } else {
            self.bekleyen_bosluk
        };
        self.bekleyen_bosluk = 0.0;
        if self.y - bosluk - yukseklik < Self::alt() && !self.islemler.is_empty() {
            self.sayfayi_kapat();
        } else {
            self.y -= bosluk;
        }
        let taban = self.y - punto;
        self.y -= yukseklik;
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

    /// Dikey boşluk hemen uygulanmaz; bir sonraki metin satırına kadar
    /// bekler ve ardışık boşluklar `AZAMI_BOSLUK_PT`'de katlanır.
    fn bosluk(&mut self, pt: f32) {
        self.bekleyen_bosluk = (self.bekleyen_bosluk + pt).min(AZAMI_BOSLUK_PT);
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
        bekleyen_bosluk: 0.0,
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

    /// Şifresi çözülmüş belgede bir metin gösterme işleminin (`Tj`/`TJ`)
    /// **okuyucunun çizeceği** konumu.
    #[derive(Debug)]
    struct MetinIslemi {
        sayfa: usize,
        /// Taban çizgisinin başlangıcı (pt, sayfa kutusu koordinatları).
        x0: f32,
        y: f32,
        /// Son glifin bittiği x (pt).
        x1: f32,
        sayfa_genislik: f32,
        sayfa_yukseklik: f32,
    }

    /// CID fontun `/W` + `/DW` genişlik tablosu (1/1000 em). `printpdf`'in
    /// ya da `genislik`'in değil, PDF okuyucusunun kullandığı ölçü budur.
    fn cid_genislikleri(doc: &lopdf::Document, font: &lopdf::Dictionary) -> (BTreeMap<u16, f32>, f32) {
        let coz = |o: &lopdf::Object| -> lopdf::Object {
            match o {
                lopdf::Object::Reference(id) => doc.get_object(*id).unwrap().clone(),
                d => d.clone(),
            }
        };
        let sayi = |o: &lopdf::Object| -> f32 {
            match coz(o) {
                lopdf::Object::Integer(i) => i as f32,
                lopdf::Object::Real(r) => r,
                d => panic!("sayi bekleniyordu: {d:?}"),
            }
        };
        assert_eq!(font.get(b"Subtype").unwrap().as_name().unwrap(), b"Type0", "yalniz CID font olculur");
        let torunlar = coz(font.get(b"DescendantFonts").unwrap());
        let cid = coz(&torunlar.as_array().unwrap()[0]);
        let cid = cid.as_dict().unwrap();
        let dw = cid.get(b"DW").map(&sayi).unwrap_or(1000.0);
        let mut tablo = BTreeMap::new();
        if let Ok(w) = cid.get(b"W") {
            let w = coz(w);
            let w = w.as_array().unwrap();
            let mut i = 0;
            while i < w.len() {
                let ilk = sayi(&w[i]) as u16;
                match coz(&w[i + 1]) {
                    lopdf::Object::Array(dizi) => {
                        for (k, g) in dizi.iter().enumerate() {
                            tablo.insert(ilk + k as u16, sayi(g));
                        }
                        i += 2;
                    }
                    son => {
                        let son = sayi(&son) as u16;
                        for g in ilk..=son {
                            tablo.insert(g, sayi(&w[i + 2]));
                        }
                        i += 3;
                    }
                }
            }
        }
        (tablo, dw)
    }

    /// Her sayfanın içerik akışını ayrıştırıp her metin işleminin başlangıç
    /// konumunu ve bitiş x'ini çıkarır. Metin matrisi `BT`/`Td`/`Tm` ile izlenir;
    /// ilerleme fontun PDF'teki `/W` tablosundan hesaplanır. Bu ayrıştırıcının
    /// modellemediği bir işleç (`cm`, `Tc`, `Tw`, `Tz`, `T*`, `'`, `"`) görülürse
    /// **panikler** — ölçmediği şeyi ölçmüş gibi yapmaz.
    fn metin_islemleri(doc: &lopdf::Document) -> Vec<MetinIslemi> {
        let mut sonuc = Vec::new();
        for (sira, (_, sayfa_id)) in doc.get_pages().into_iter().enumerate() {
            let sayfa = doc.get_dictionary(sayfa_id).unwrap();
            let kutu: Vec<f32> = sayfa
                .get(b"MediaBox")
                .expect("sayfada MediaBox")
                .as_array()
                .unwrap()
                .iter()
                .map(|o| o.as_float().unwrap())
                .collect();
            assert_eq!((kutu[0], kutu[1]), (0.0, 0.0), "MediaBox orijini");
            let (sayfa_genislik, sayfa_yukseklik) = (kutu[2], kutu[3]);

            let fontlar: BTreeMap<Vec<u8>, (BTreeMap<u16, f32>, f32)> = doc
                .get_page_fonts(sayfa_id)
                .unwrap()
                .into_iter()
                .map(|(ad, f)| (ad, cid_genislikleri(doc, f)))
                .collect();

            let icerik = doc.get_and_decode_page_content(sayfa_id).unwrap();
            // Metin matrisi [a b c d e f]; BT'de birim matris.
            let mut tm = [1.0f32, 0.0, 0.0, 1.0, 0.0, 0.0];
            let mut tlm = tm;
            let mut font: Option<&(BTreeMap<u16, f32>, f32)> = None;
            let mut punto = 0.0f32;
            for islem in &icerik.operations {
                let o = &islem.operands;
                match islem.operator.as_str() {
                    "BT" => {
                        tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
                        tlm = tm;
                    }
                    "Tf" => {
                        font = Some(&fontlar[o[0].as_name().unwrap()]);
                        punto = o[1].as_float().unwrap();
                    }
                    "Td" => {
                        let (tx, ty) = (o[0].as_float().unwrap(), o[1].as_float().unwrap());
                        tlm[4] += tx * tlm[0] + ty * tlm[2];
                        tlm[5] += tx * tlm[1] + ty * tlm[3];
                        tm = tlm;
                    }
                    "Tm" => {
                        for (k, d) in o.iter().enumerate() {
                            tm[k] = d.as_float().unwrap();
                        }
                        tlm = tm;
                    }
                    "Tj" | "TJ" => {
                        let (tablo, dw) = font.expect("Tf'siz metin");
                        let mut birim = 0.0f32;
                        let mut dizgiler = Vec::new();
                        if islem.operator == "Tj" {
                            dizgiler.push(&o[0]);
                        } else {
                            for p in o[0].as_array().unwrap() {
                                match p {
                                    lopdf::Object::String(..) => dizgiler.push(p),
                                    kaydirma => birim -= kaydirma.as_float().unwrap(),
                                }
                            }
                        }
                        for d in dizgiler {
                            for cift in d.as_str().unwrap().chunks(2) {
                                let gid = u16::from_be_bytes([cift[0], cift[1]]);
                                birim += tablo.get(&gid).copied().unwrap_or(*dw);
                            }
                        }
                        assert_eq!((tm[1], tm[2]), (0.0, 0.0), "donuk/egik metin olculmuyor");
                        let (x0, y) = (tm[4], tm[5]);
                        let ilerleme = birim / 1000.0 * punto * tm[0];
                        tm[4] += ilerleme;
                        sonuc.push(MetinIslemi {
                            sayfa: sira,
                            x0,
                            y,
                            x1: x0 + ilerleme,
                            sayfa_genislik,
                            sayfa_yukseklik,
                        });
                    }
                    op @ ("cm" | "Tc" | "Tw" | "Tz" | "TL" | "T*" | "'" | "\"") => {
                        panic!("olcum ayristiricisi bu isleci modellemiyor: {op}")
                    }
                    _ => {}
                }
            }
        }
        sonuc
    }

    /// Her metin işlemi sayfa kutusunun içinde başlar ve biter.
    fn hepsi_sayfa_icinde(islemler: &[MetinIslemi]) {
        for m in islemler {
            assert!(
                (0.0..=m.sayfa_yukseklik).contains(&m.y)
                    && (0.0..=m.sayfa_genislik).contains(&m.x0)
                    && (0.0..=m.sayfa_genislik).contains(&m.x1),
                "sayfa {} disinda metin: {m:?}",
                m.sayfa + 1
            );
        }
    }

    fn cozulmus(ic: &RaporIcerigi) -> lopdf::Document {
        parolayla_yukle(&sifreli_pdf(ic, "dogru-parola-123").unwrap(), "dogru-parola-123").unwrap()
    }

    /// İnceleme bulgusu I1: boş satırlar ve bölüm aralıkları çizim işlemi
    /// eklemeden aşağı iniyordu; sayfa başında sayfa kırılmadığı için `y`
    /// eksiye düşüyor, sonraki metin sayfanın altına (görünmez) yazılıyordu.
    /// `extract_text` sayfa dışındaki metni de bulur; bu yüzden burada
    /// metnin varlığı değil **koordinatı** ölçülür.
    ///
    /// Karar: ardışık dikey boşluk `AZAMI_BOSLUK_PT`'de katlanır ve sayfa
    /// başında yutulur; incelemenin üç vakası bu yüzden tek sayfaya sığar.
    /// Dördüncü vaka, sayfa sonuna denk gelen bekleyen boşluğu ölçer: orada
    /// sayfa kutusu yetmez, taban çizgisinin alt kenar boşluğunun üstünde
    /// kaldığı da iddia edilir.
    #[test]
    fn ardisik_bos_satirlar_metni_sayfa_disina_itmez() {
        let bolum = |satirlar: Vec<String>| RaporIcerigi {
            baslik: "RAPOR".into(),
            bolumler: vec![RaporBolumu { baslik: "B".into(), satirlar }],
        };
        let vakalar = [
            (
                "1 satir + 200 bos satir",
                bolum(
                    std::iter::once("ilk".to_string())
                        .chain(std::iter::repeat_n(String::new(), 200))
                        .chain(std::iter::once("BOSLUK-SONRASI-KANARYA".to_string()))
                        .collect(),
                ),
                4,
                Some(1),
                "BOSLUK-SONRASI-KANARYA",
            ),
            (
                "tek paragrafta 300 satir sonu",
                bolum(vec![format!("ust{}ALT-KANARYA", "\n".repeat(300))]),
                4,
                Some(1),
                "ALT-KANARYA",
            ),
            (
                "bos baslik + 100 bos bolum",
                RaporIcerigi {
                    baslik: String::new(),
                    bolumler: (0..100)
                        .map(|_| RaporBolumu { baslik: String::new(), satirlar: vec![] })
                        .chain(std::iter::once(RaporBolumu { baslik: "SON".into(), satirlar: vec![] }))
                        .collect(),
                },
                1,
                Some(1),
                "SON",
            ),
            (
                "her satirdan sonra 3 bos satir, 200 kez",
                bolum(
                    (0..200)
                        .flat_map(|i| [format!("satir-{i}"), String::new(), String::new(), String::new()])
                        .chain(std::iter::once("SAYFALI-KANARYA".to_string()))
                        .collect(),
                ),
                203,
                None,
                "SAYFALI-KANARYA",
            ),
        ];
        let alt_kenar = Pt::from(Mm(KENAR_MM)).0;
        for (ad, ic, beklenen_islem, beklenen_sayfa, kanarya) in vakalar {
            let doc = cozulmus(&ic);
            let islemler = metin_islemleri(&doc);
            // Boş bir liste "hepsi sayfa içinde" iddiasını kendiliğinden geçirir.
            assert_eq!(islemler.len(), beklenen_islem, "{ad}: metin islemi sayisi");
            hepsi_sayfa_icinde(&islemler);
            for m in &islemler {
                assert!(m.y >= alt_kenar, "{ad}: alt kenar boslugunun altinda metin: {m:?}");
            }
            let sayfa = doc.get_pages().len();
            match beklenen_sayfa {
                Some(n) => assert_eq!(sayfa, n, "{ad}: bosluk sayfa uretmemeli"),
                None => assert!(sayfa > 1, "{ad}: vaka sayfa sonunu olcmeli"),
            }
            let sayfalar: Vec<u32> = doc.get_pages().keys().copied().collect();
            assert!(doc.extract_text(&sayfalar).unwrap().contains(kanarya), "{ad}");
        }
    }

    /// Yalnızca "geçerli PDF + `/Encrypt` sözlüğü var" ölçülür. Eskiden burada
    /// ham baytlarda kanarya aranıyordu; içerik akışı sıkıştırılıp glif
    /// kimliğine çevrildiği için o iddia **şifresiz** dosyada da geçiyordu
    /// (inceleme M3) ve kaldırıldı. Şifrelemenin gerçekten içeriği kapattığını
    /// `yanlis_parolayla_icerik_okunamaz` ve `baslik_ustverisi_de_ham_baytlarda_gecmez`
    /// ölçer.
    #[test]
    fn dosya_gecerli_pdf_ve_sifreleme_sozlugu_tasir() {
        let pdf = sifreli_pdf(&icerik(), "dogru-parola-123").unwrap();
        assert!(pdf.starts_with(b"%PDF-"), "gecerli bir PDF olmali");
        let doc = lopdf::Document::load_mem(&pdf).unwrap();
        assert!(doc.is_encrypted(), "sifreleme sozlugu olmali");
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

    /// İki çıktının baytlarını karşılaştırmak anahtarı ölçmez: AES IV'leri ve
    /// U/O tuzları her seferinde rastgele, sabit bir anahtarla da baytlar
    /// farklı çıkar (o test sabit anahtar mutasyonunda yeşil kaldığı için
    /// silindi, inceleme M3). Burada **dosya şifreleme anahtarının kendisi**
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
        hepsi_sayfa_icinde(&metin_islemleri(&doc));
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

    /// İnceleme bulgusu M1: önceki sürüm satırları `sar`'ın kendi kullandığı
    /// `genislik` ile ölçüyordu (`genislik * 0.5` mutasyonunda yeşil kaldı).
    /// Burada bitiş x'i üretilen PDF'in içerik akışından ve fontun PDF'teki
    /// `/W` tablosundan, yani okuyucunun çizeceği gibi hesaplanır; sınır sağ
    /// kenar boşluğudur (sayfa kenarından daha sıkı).
    #[test]
    fn sarilan_satirlar_sayfa_genisligini_asmaz() {
        let ic = RaporIcerigi {
            baslik: "RAPOR".into(),
            bolumler: vec![RaporBolumu {
                baslik: "B".into(),
                satirlar: vec!["uzun ".repeat(2000), "A".repeat(500), TURKCE.repeat(40)],
            }],
        };
        let islemler = metin_islemleri(&cozulmus(&ic));
        assert!(islemler.len() > 50, "sarma gercekten olmali");
        hepsi_sayfa_icinde(&islemler);
        let sag = Pt::from(Mm(SAYFA_GENISLIK_MM - KENAR_MM)).0;
        for m in &islemler {
            assert!(m.x1 <= sag + 0.01, "sag kenar boslugunu asan satir: {m:?}");
        }
        // Tek basina sigmayan kelime karakterlerine bolunur, karakter kaybolmaz.
        let font = font().unwrap();
        let dev = "A".repeat(500);
        let parcalar = sar(font, &dev, GOVDE_PT, Dizgici::azami_genislik());
        assert!(parcalar.len() > 1);
        assert_eq!(parcalar.concat(), dev);
    }

    /// İnceleme bulgusu M2: fontta olmayan bir karakter (emoji, CJK) sarma
    /// hesabında okuyucunun çizdiğinden dar sayılırsa satır sağdan taşar.
    /// `printpdf` böyle bir karakteri glif 0 olarak yazar ve `/W`'ye koymaz;
    /// okuyucu `/DW` genişliğini kullanır. Ölçü yine içerik akışından.
    #[test]
    fn fontta_olmayan_glifler_de_sarilir() {
        for (ad, satir) in [("emoji", "😀".repeat(500)), ("CJK", "漢".repeat(500))] {
            let ic = RaporIcerigi {
                baslik: "RAPOR".into(),
                bolumler: vec![RaporBolumu { baslik: "B".into(), satirlar: vec![satir] }],
            };
            let islemler = metin_islemleri(&cozulmus(&ic));
            assert!(islemler.len() > 3, "{ad}: 500 karakterlik satir sarilmali");
            hepsi_sayfa_icinde(&islemler);
            let sag = Pt::from(Mm(SAYFA_GENISLIK_MM - KENAR_MM)).0;
            for m in &islemler {
                assert!(m.x1 <= sag + 0.01, "{ad}: tasan satir: {m:?}");
            }
        }
    }

    /// Görev 7 inceleme notu: "Randevular ve ödemeler" bölümündeki bir
    /// randevu satırı artık etiket listesiyle bitebiliyor
    /// (`· Etiketler: aile, ilaç değişimi, öfke, ...`) ve bu liste uzun,
    /// çok baytlı olabilir. `pdf.rs` içeriğe kör olduğu için (`RaporBolumu.
    /// satirlar` düz `String`'dir), sarma yolunu bu GERÇEK biçimi taklit
    /// eden tek bir uzun satırla doğrulamak yeterli — ayrı bir
    /// `veri_raporu.rs` entegrasyon testine gerek yok.
    #[test]
    fn uzun_cok_baytli_etiket_listesi_tasiyan_randevu_satiri_dogru_sarilir() {
        let etiketler: Vec<String> = (0..60)
            .map(|i| format!("çok-baytlı-etiket-öğe-{i:02}"))
            .collect();
        let satir = format!(
            "- 01.09.2026 10:00 · Planlandı · Ücret: 450,00 TL · Ödendi: Evet · Etiketler: {}",
            etiketler.join(", ")
        );
        let ic = RaporIcerigi {
            baslik: "RAPOR".into(),
            bolumler: vec![RaporBolumu { baslik: "Randevular ve ödemeler (1)".into(), satirlar: vec![satir.clone()] }],
        };
        let pdf = sifreli_pdf(&ic, "dogru-parola-123").unwrap();

        let islemler = metin_islemleri(&cozulmus(&ic));
        assert!(islemler.len() > 5, "uzun etiket listesi gercekten sarilmali");
        hepsi_sayfa_icinde(&islemler);
        let sag = Pt::from(Mm(SAYFA_GENISLIK_MM - KENAR_MM)).0;
        for m in &islemler {
            assert!(m.x1 <= sag + 0.01, "sag kenar boslugunu asan satir: {m:?}");
        }

        // Hicbir etiket adi/karakter sarma sirasinda KAYBOLMAMALI.
        let metin = metin_cikar(&pdf, "dogru-parola-123").unwrap();
        let sade: String = metin.chars().filter(|c| !c.is_whitespace()).collect();
        let beklenen: String = satir.chars().filter(|c| !c.is_whitespace()).collect();
        assert!(sade.contains(&beklenen), "etiket listesi eksiksiz cikmadi:\n{metin}");
    }

    #[test]
    fn debug_icerigi_basmaz() {
        let s = format!("{:?}", icerik());
        assert!(!s.contains(KANARYA) && !s.contains("Seans notları"));
    }
}
