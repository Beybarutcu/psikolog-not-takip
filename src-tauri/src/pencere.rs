//! Pencere ve gezinme kararları (tasarım 2026-09-26 §8 P2, P3, P6b; §9).
//!
//! Saf fonksiyonlar; Tauri'nin `on_navigation` / `on_new_window` geri
//! çağrıları (`main.rs::korumali_pencere`) yalnızca bu kararları UYGULAR.
//!
//! - Uygulama penceresi (ana ve okuma) YALNIZCA kendi yerel kökenine gider.
//! - `window.open` isteği: kendi kökeninde tam olarak `/?okuma=<id>` ise
//!   okuma penceresi; `http(s)`/`mailto` ise sistemin varsayılan
//!   uygulamasında açılır ve istek reddedilir; başka her şey reddedilir.
//! - Yerel/loopback adresler (`localhost`, `127.0.0.0/8`, `::1`, `0.0.0.0`,
//!   ondalık/onaltılık/sekizlik IPv4 kodlamaları) ASLA dışarıda açılmaz:
//!   oturum sunucuda süreç genelidir, sistem tarayıcısına verilen yerel
//!   adres uygulamanın kilidini atlardı (controller ruling F14).

use tauri::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PencereKarari {
    OkumaPenceresi { randevu_id: i64 },
    DisaAc,
    Reddet,
}

fn ayni_koken(adres: &Url, koken: &Url) -> bool {
    adres.origin() == koken.origin()
}

pub fn gezinme_izni(adres: &Url, koken: &Url) -> bool {
    ayni_koken(adres, koken)
}

pub fn pencere_karari(adres: &Url, koken: &Url) -> PencereKarari {
    if ayni_koken(adres, koken) {
        return match okuma_kimligi(adres) {
            Some(randevu_id) => PencereKarari::OkumaPenceresi { randevu_id },
            None => PencereKarari::Reddet,
        };
    }
    if disa_acilir_mi(adres) {
        PencereKarari::DisaAc
    } else {
        PencereKarari::Reddet
    }
}

pub fn disa_acilir_mi(adres: &Url) -> bool {
    match adres.scheme() {
        "mailto" => true,
        "http" | "https" => !yerel_adres_mi(adres),
        _ => false,
    }
}

/// `adres`in konağı yerel/loopback mi (127.0.0.0/8, ::1, 0.0.0.0,
/// `localhost` ve türevleri). Sistem tarayıcısına/posta uygulamasına asla
/// verilmez (controller ruling F14): oturum sunucuda süreç genelidir,
/// yerel adresin dışarı sızması kilit ekranını atlatır.
fn yerel_adres_mi(adres: &Url) -> bool {
    let Some(sunucu) = adres.host_str() else { return true };
    // IPv6 parantezlerini soy, tek bir sondaki noktayı (DNS kok etiketi:
    // "localhost." == "localhost") kaldir, kucuk harfe cevir.
    let sunucu = sunucu.trim_start_matches('[').trim_end_matches(']');
    let sunucu = sunucu.strip_suffix('.').unwrap_or(sunucu).to_ascii_lowercase();
    if sunucu == "localhost" || sunucu.ends_with(".localhost") {
        return true;
    }
    match sunucu.parse::<std::net::IpAddr>() {
        // `Url::host_str` "special" semalar (http/https) icin ondalik,
        // onaltilik ve sekizlik IPv4 yazimlarini WHATWG kurallarina gore
        // zaten noktali-onlu forma normallestirir; bu yuzden burada tekrar
        // ozel bir ayristirma gerekmez.
        Ok(std::net::IpAddr::V6(v6)) => {
            let v6 = v6.to_ipv4_mapped().map(std::net::IpAddr::V4).unwrap_or(std::net::IpAddr::V6(v6));
            v6.is_loopback() || v6.is_unspecified()
        }
        Ok(ip) => ip.is_loopback() || ip.is_unspecified(),
        Err(_) => false,
    }
}

/// Tam olarak `/?okuma=<pozitif tam sayı, başında sıfır yok>`; başka sorgu
/// parametresi ya da parça (`#`) yok.
fn okuma_kimligi(adres: &Url) -> Option<i64> {
    if adres.path() != "/" || adres.fragment().is_some() {
        return None;
    }
    let mut ciftler = adres.query_pairs();
    let (anahtar, deger) = ciftler.next()?;
    if anahtar != "okuma" || ciftler.next().is_some() {
        return None;
    }
    if deger.is_empty() || deger.starts_with('0') || !deger.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    deger.parse::<i64>().ok()
}

#[cfg(test)]
mod testler {
    use super::*;

    fn u(s: &str) -> Url {
        s.parse().unwrap()
    }
    fn koken() -> Url {
        u("http://127.0.0.1:51234/")
    }

    #[test]
    fn okuma_adresi_okuma_penceresi_acar() {
        assert_eq!(
            pencere_karari(&u("http://127.0.0.1:51234/?okuma=42"), &koken()),
            PencereKarari::OkumaPenceresi { randevu_id: 42 }
        );
    }

    #[test]
    fn bozuk_ya_da_baska_okuma_adresi_reddedilir() {
        for a in [
            "http://127.0.0.1:51234/?okuma=abc",
            "http://127.0.0.1:51234/?okuma=0",
            "http://127.0.0.1:51234/?okuma=-3",
            "http://127.0.0.1:51234/?okuma=",
            "http://127.0.0.1:51234/?okuma=007",
            "http://127.0.0.1:51234/?okuma=99999999999999999999",
            "http://127.0.0.1:51234/baska?okuma=4",
            "http://127.0.0.1:51234/?okuma=4&x=1",
            "http://127.0.0.1:51234/?x=1&okuma=4",
            "http://127.0.0.1:51234/?okuma=4#k",
            "http://127.0.0.1:51234/api/danisanlar",
            "http://127.0.0.1:9999/?okuma=4",
        ] {
            assert_eq!(pencere_karari(&u(a), &koken()), PencereKarari::Reddet, "{a}");
        }
    }

    #[test]
    fn dis_baglantilar_sistem_uygulamasinda_acilir() {
        for a in ["https://ornek.com/yol?q=1", "http://ornek.com", "mailto:ayse@ornek.com"] {
            assert_eq!(pencere_karari(&u(a), &koken()), PencereKarari::DisaAc, "{a}");
            assert!(disa_acilir_mi(&u(a)), "{a}");
        }
    }

    #[test]
    fn tehlikeli_semalar_reddedilir() {
        for a in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,x",
            "ftp://ornek.com",
            "about:blank",
            "tel:5551234",
        ] {
            assert_eq!(pencere_karari(&u(a), &koken()), PencereKarari::Reddet, "{a}");
            assert!(!gezinme_izni(&u(a), &koken()), "{a}");
        }
    }

    /// Oturum sunucuda süreç geneli tutuluyor: Safari'ye verilen yerel adres
    /// (başka yazımla da olsa: `localhost`, `[::1]`) kilit ekranını atlayıp
    /// veriye ulaşırdı. Yerel adres ASLA dışarıda açılmaz.
    ///
    /// Controller ruling F14 (preflight.md): 127.x.x.x, [::1], localhost,
    /// 0.0.0.0 ve ondalık/onaltılık/sekizlik IPv4 kodlamaları hiçbiri sistem
    /// açıcısına verilmez. Ek olarak preflight'ın işaret ettiği iki somut
    /// açık da buraya sabitlendi: sondaki nokta (`localhost.`,
    /// `x.localhost.`) ve IPv4 eşlemeli IPv6 (`::ffff:127.0.0.1`).
    #[test]
    fn yerel_adresler_sistem_tarayicisina_verilmez() {
        for a in [
            "http://localhost:51234/api/danisanlar",
            "http://LOCALHOST:51234/",
            "http://uygulama.localhost/",
            "http://127.0.0.2/",
            "http://[::1]:51234/",
            "http://0.0.0.0:51234/",
            // preflight F14: sondaki nokta (DNS kok etiketi) localhost
            // denetimini atlatmamali.
            "http://localhost.:51234/",
            "http://uygulama.localhost./",
            // preflight F14: IPv4 eslemeli IPv6 (::ffff:a.b.c.d) loopback'i
            // gizlememeli.
            "http://[::ffff:127.0.0.1]:51234/",
            // Controller ruling F14: loopback'in ondalik/onaltilik/sekizlik
            // IPv4 kodlamalari (WHATWG host ayristiricisi bunlari 127.0.0.1'e
            // normallestirir; `yerel_adres_mi` normallestirilmis haliyle
            // calisir).
            "http://2130706433/",
            "http://0x7f000001/",
            "http://0177.0.0.1/",
        ] {
            assert_eq!(pencere_karari(&u(a), &koken()), PencereKarari::Reddet, "{a}");
            assert!(!gezinme_izni(&u(a), &koken()), "{a}");
        }
    }

    #[test]
    fn gezinme_yalnizca_ayni_kokene_izinli() {
        for a in ["http://127.0.0.1:51234/", "http://127.0.0.1:51234/?okuma=3", "http://127.0.0.1:51234/api/durum"] {
            assert!(gezinme_izni(&u(a), &koken()), "{a}");
        }
        for a in ["http://127.0.0.1:51235/", "https://127.0.0.1:51234/", "https://ornek.com/"] {
            assert!(!gezinme_izni(&u(a), &koken()), "{a}");
        }
    }
}
