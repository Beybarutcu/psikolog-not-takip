//! HTML -> düz metin (tasarım 2026-09-26 §6 S2-S3).
//!
//! # Neden sunucuda ve neden tek fonksiyon
//!
//! Resmî not artık HTML saklar (`progress_notes.icerik`). Arama (`search`),
//! seans listesi önizlemesi (`danisan_seanslari::onizleme`), danışana özel
//! not araması ve veri raporu (PDF) HTML'e değil bu fonksiyonun ürettiği
//! `progress_notes.duz_metin` sütununa bakar. Sütunu yalnızca sunucu yazar
//! (`notes::not_kaydet`, aynı işlemde); istemci düz metin GÖNDERMEZ ve
//! kuralın istemcide eşi yoktur — iki uygulama yapısal olarak ayrışamaz.
//! Kural `duz_metin_ornekleri.json` ile sabitlenir.
//!
//! # Kural
//!
//! - Etiketler atılır; etiket adı ve öznitelikler metne GİRMEZ ("strong"
//!   aranınca not bulunmaz).
//! - Blok öğeleri (`BLOK_OGELERI`) açılışta ve kapanışta satır sonu üretir;
//!   `br` de. Tasarımın saydığı küme (`p`, `h1-6`, `li`, `blockquote`, `pre`,
//!   `br`, `tr`) + `td`/`th`/`div`/`ul`/`ol`/`hr`/`table` (bunlar olmadan
//!   tablo hücreleri ve onay listesi satırları birbirine yapışırdı).
//! - `script`/`style` içeriği tümüyle atılır; yorumlar ve `<!…>`/`<?…>`
//!   bildirimleri atılır.
//! - Varlıklar: `&amp; &lt; &gt; &quot; &apos; &nbsp;` ve sayısal
//!   (`&#305;`, `&#x130;`). `&nbsp;` düz boşluğa döner (arama "iki kelime"yi
//!   bulsun). Bilinmeyen/geçersiz varlık OLDUĞU GİBİ kalır.
//! - `pre` dışında boşluk/sekme kümesi tek boşluğa iner; ham `\n` (eski düz
//!   metin notları) satır sonu olarak korunur. `pre` içinde iç boşluk korunur.
//! - Her satır kırpılır (`store::bosluk_mu`: U+FEFF dâhil), ardışık boş
//!   satırlar TEK boş satıra iner, baştaki/sondaki boş satırlar atılır.
//! - Onay kutusu (`<input type="checkbox">`) metin taşımaz: `[ ]`/`[x]` yok.
//! - `<`'den sonra harf, `/`, `!` ya da `?` gelmiyorsa etiket değildir
//!   ("3 < 5"). Kapanmamış bir etiket (`<strong`) geri kalanla atılır.
//!
//! Girdi kendi editörümüzün şemasından gelir ama uç nokta ham gövde alır;
//! fonksiyon her girdiye bir metin döndürür, panik üretmez
//! (`kontrolsuz_girdi_panik_uretmez`).

/// Açılışı ve kapanışı satır sonu üreten öğeler (bkz. modül başlığı).
const BLOK_OGELERI: &[&str] = &[
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "br", "tr", "td",
    "th", "div", "ul", "ol", "hr", "table",
];

/// İçeriği metne HİÇ girmeyen öğeler.
const ICERIGI_ATILANLAR: &[&str] = &["script", "style"];

struct Etiket {
    ad: String,
    kapanis: bool,
}

pub fn html_duz_metin(html: &str) -> String {
    let normal = html.replace("\r\n", "\n").replace('\r', "\n");
    let k: Vec<char> = normal.chars().collect();
    let mut ham = String::with_capacity(normal.len());
    let mut pre = 0usize;
    let mut atlanan: Option<String> = None;
    let mut i = 0usize;
    while i < k.len() {
        if k[i] == '<' {
            if let Some((etiket, sonraki)) = etiket_oku(&k, i) {
                i = sonraki;
                let Some(Etiket { ad, kapanis }) = etiket else { continue };
                if let Some(beklenen) = &atlanan {
                    if kapanis && ad == *beklenen {
                        atlanan = None;
                    }
                    continue;
                }
                if !kapanis && ICERIGI_ATILANLAR.contains(&ad.as_str()) {
                    atlanan = Some(ad);
                    continue;
                }
                if ad == "pre" {
                    pre = if kapanis { pre.saturating_sub(1) } else { pre + 1 };
                }
                if BLOK_OGELERI.contains(&ad.as_str()) {
                    ham.push('\n');
                }
                continue;
            }
        }
        if atlanan.is_some() {
            i += 1;
            continue;
        }
        let (karakter, sonraki) =
            if k[i] == '&' { varlik_coz(&k, i).unwrap_or(('&', i + 1)) } else { (k[i], i + 1) };
        metin_ekle(&mut ham, karakter, pre > 0);
        i = sonraki;
    }
    satirlari_duzenle(&ham)
}

/// `bas` konumundaki `<`'i okur. `Some((Some(etiket), sonraki))`: bir etiket;
/// `Some((None, sonraki))`: atlanan bir yorum/bildirim ya da kapanmamış
/// etiket; `None`: etiket değil, `<` düz metindir.
fn etiket_oku(k: &[char], bas: usize) -> Option<(Option<Etiket>, usize)> {
    let sonraki = *k.get(bas + 1)?;
    if sonraki == '!' || sonraki == '?' {
        if k.get(bas + 1..bas + 4) == Some(&['!', '-', '-'][..]) {
            let son = bul(k, bas + 4, &['-', '-', '>']).map_or(k.len(), |p| p + 3);
            return Some((None, son));
        }
        let son = k[bas..].iter().position(|c| *c == '>').map_or(k.len(), |p| bas + p + 1);
        return Some((None, son));
    }
    let kapanis = sonraki == '/';
    let ad_bas = if kapanis { bas + 2 } else { bas + 1 };
    if !k.get(ad_bas).is_some_and(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let mut j = ad_bas;
    while j < k.len() && k[j].is_ascii_alphanumeric() {
        j += 1;
    }
    let ad = k[ad_bas..j].iter().collect::<String>().to_ascii_lowercase();
    let mut tirnak: Option<char> = None;
    while j < k.len() {
        let c = k[j];
        match tirnak {
            Some(t) if c == t => tirnak = None,
            Some(_) => {}
            None if c == '"' || c == '\'' => tirnak = Some(c),
            None if c == '>' => return Some((Some(Etiket { ad, kapanis }), j + 1)),
            None => {}
        }
        j += 1;
    }
    Some((None, k.len()))
}

fn bul(k: &[char], bas: usize, aranan: &[char]) -> Option<usize> {
    (bas..k.len()).find(|&i| k[i..].starts_with(aranan))
}

/// `&…;` varlığını çözer: `(karakter, sonraki_konum)`. Tanınmayan ya da
/// geçersiz varlık `None` (çağıran `&`'yi düz metin sayar).
fn varlik_coz(k: &[char], bas: usize) -> Option<(char, usize)> {
    // En uzun desteklenen biçim `&#x10FFFF;` (10 karakter).
    let son = (bas + 1..k.len().min(bas + 12)).find(|&i| k[i] == ';')?;
    let govde: String = k[bas + 1..son].iter().collect();
    let karakter = match govde.as_str() {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        "nbsp" => ' ',
        _ => {
            let sayi = govde.strip_prefix('#')?;
            let (taban, rakamlar) = match sayi.strip_prefix(['x', 'X']) {
                Some(onaltilik) => (16, onaltilik),
                None => (10, sayi),
            };
            if rakamlar.is_empty() || !rakamlar.chars().all(|c| c.is_digit(taban)) {
                return None;
            }
            let deger = u32::from_str_radix(rakamlar, taban).ok()?;
            if deger == 0 {
                return None;
            }
            char::from_u32(deger)?
        }
    };
    Some((karakter, son + 1))
}

fn metin_ekle(ham: &mut String, k: char, pre_icinde: bool) {
    if k == '\n' {
        ham.push('\n');
        return;
    }
    if !pre_icinde && matches!(k, ' ' | '\t' | '\u{0C}') {
        if !ham.ends_with(' ') {
            ham.push(' ');
        }
        return;
    }
    ham.push(k);
}

fn satirlari_duzenle(ham: &str) -> String {
    let mut sonuc = String::with_capacity(ham.len());
    let mut bos_bekliyor = false;
    for satir in ham.split('\n') {
        let s = satir.trim_matches(super::bosluk_mu);
        if s.is_empty() {
            bos_bekliyor = !sonuc.is_empty();
            continue;
        }
        if !sonuc.is_empty() {
            sonuc.push('\n');
            if bos_bekliyor {
                sonuc.push('\n');
            }
        }
        bos_bekliyor = false;
        sonuc.push_str(s);
    }
    sonuc
}

#[cfg(test)]
mod testler {
    use super::*;

    /// Kuralın TAMAMI ortak örnek dosyasında; sunucu tek uygulamadır
    /// (istemcide eşi yok). Boş bir dosya bu döngüyü totolojik yapardı.
    #[test]
    fn ortak_ornekleri_saglar() {
        let ornekler: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("duz_metin_ornekleri.json")).unwrap();
        assert!(ornekler.len() >= 25, "ornek dosyasi beklenenden kucuk");
        for o in &ornekler {
            let ad = o["ad"].as_str().unwrap();
            let html = o["html"].as_str().unwrap();
            let beklenen = o["beklenen"].as_str().unwrap();
            assert_eq!(html_duz_metin(html), beklenen, "ornek: {ad}");
        }
    }

    /// Girdi arayüzün kendi editöründen gelir ama uç nokta ham gövde alır:
    /// bozuk HTML panik değil, bir metin üretmeli.
    #[test]
    fn kontrolsuz_girdi_panik_uretmez() {
        for girdi in [
            "<", "&", "&#", "&#x", "&#x;", "<!--", "<!", "<?", "</", "<a", "<a \"", "<a '",
            "&#99999999999;", "&#xD800;", "\u{0}", "<p>", "</p></p></p>", "<script>", "ş<", "&ş;",
        ] {
            let _ = html_duz_metin(girdi);
        }
    }

    #[test]
    fn etiket_adi_ve_oznitelik_hicbir_bicimde_metne_girmez() {
        let d = html_duz_metin(r#"<p><strong class="span" data-a="em">kalın</strong></p>"#);
        assert_eq!(d, "kalın");
        for yok in ["strong", "span", "class", "data-a", "em", "<", ">"] {
            assert!(!d.contains(yok), "{yok} metne girdi: {d}");
        }
    }
}
