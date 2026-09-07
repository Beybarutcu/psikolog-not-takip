use crate::crypto::keyring::DataKey;
use std::time::{Duration, Instant};

/// Varsayilan bosta kalma kilit suresi (saniye). Bu sure boyunca islem
/// yapilmazsa oturum kendiliginden kilitlenir; danisan odadan cikarken
/// ekranda acik kalan notu koruma altina alir.
pub const VARSAYILAN_KILIT_SURESI_SN: u64 = 300;

/// Bellekte acik veri anahtarini tutan oturum. Zaman disaridan `Instant`
/// olarak verilir; boylece testler gercekten beklemek zorunda kalmaz ve
/// `Instant::now()` bu modulun icinde asla cagrilmaz.
pub struct Oturum {
    anahtar: Option<DataKey>,
    son_islem: Option<Instant>,
    kilit_suresi: Duration,
}

impl Oturum {
    /// Kapali (anahtarsiz) bir oturum olusturur.
    pub fn kapali() -> Self {
        Self {
            anahtar: None,
            son_islem: None,
            kilit_suresi: Duration::from_secs(VARSAYILAN_KILIT_SURESI_SN),
        }
    }

    /// Bosta kalma kilit suresini ayarlar.
    pub fn kilit_suresi_ayarla(&mut self, sn: u64) {
        self.kilit_suresi = Duration::from_secs(sn);
    }

    /// Oturumu verilen anahtarla acar ve son islem zamanini `now` olarak isaretler.
    pub fn ac(&mut self, anahtar: DataKey, now: Instant) {
        self.anahtar = Some(anahtar);
        self.son_islem = Some(now);
    }

    /// Oturumu kilitler: anahtar `None`'a set edilir, `Zeroizing` dusurulunce
    /// bellek sifirlanir. Anahtarin baska bir kopyasi tutulmaz.
    pub fn kilitle(&mut self) {
        self.anahtar = None;
        self.son_islem = None;
    }

    /// Oturum gercekten acik mi? Anahtar varsa VE bosta kalma suresi
    /// asilmamissa `true` doner.
    pub fn acik_mi(&self, now: Instant) -> bool {
        match (&self.anahtar, self.son_islem) {
            (Some(_), Some(son)) => now.duration_since(son) <= self.kilit_suresi,
            _ => false,
        }
    }

    /// Kullanici etkilesimini isaretler ve bosta kalma suresini sifirlar.
    /// Oturum zaten suresi dolmussa (yani `acik_mi(now)` yanlissa) hicbir
    /// sey yapmaz - suresi dolmus bir oturum dokunmayla dirilmemelidir.
    pub fn dokun(&mut self, now: Instant) {
        if self.acik_mi(now) {
            self.son_islem = Some(now);
        }
    }

    /// Oturum acikken anahtarin bir kopyasini doner; degilse `None`.
    pub fn anahtar(&self, now: Instant) -> Option<DataKey> {
        if self.acik_mi(now) {
            self.anahtar.clone()
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use std::time::{Duration, Instant};

    #[test]
    fn yeni_oturum_kapalidir() {
        let t = Instant::now();
        assert!(!Oturum::kapali().acik_mi(t));
    }

    #[test]
    fn acilan_oturum_anahtari_verir() {
        let t = Instant::now();
        let key = generate_data_key();
        let mut o = Oturum::kapali();
        o.ac(key.clone(), t);
        assert!(o.acik_mi(t));
        assert_eq!(o.anahtar(t).unwrap().as_ref(), key.as_ref());
    }

    #[test]
    fn sure_dolunca_kendiliginden_kilitlenir() {
        let t = Instant::now();
        let mut o = Oturum::kapali();
        o.ac(generate_data_key(), t);

        let sonra = t + Duration::from_secs(VARSAYILAN_KILIT_SURESI_SN + 1);
        assert!(!o.acik_mi(sonra));
        assert!(o.anahtar(sonra).is_none());
    }

    #[test]
    fn dokunmak_sureyi_uzatir() {
        let t = Instant::now();
        let mut o = Oturum::kapali();
        o.ac(generate_data_key(), t);

        let orta = t + Duration::from_secs(200);
        o.dokun(orta);

        let sonra = orta + Duration::from_secs(200);
        assert!(o.acik_mi(sonra), "dokunma sonrasi sure yeniden baslamali");
    }

    #[test]
    fn kilitlenince_anahtar_verilmez() {
        let t = Instant::now();
        let mut o = Oturum::kapali();
        o.ac(generate_data_key(), t);
        o.kilitle();
        assert!(o.anahtar(t).is_none());
    }

    #[test]
    fn kilit_suresi_ayarlanabilir() {
        let t = Instant::now();
        let mut o = Oturum::kapali();
        o.kilit_suresi_ayarla(60);
        o.ac(generate_data_key(), t);
        assert!(o.acik_mi(t + Duration::from_secs(59)));
        assert!(!o.acik_mi(t + Duration::from_secs(61)));
    }

    #[test]
    fn suresi_dolmus_oturuma_dokunmak_diriltmez() {
        let t = Instant::now();
        let mut o = Oturum::kapali();
        o.ac(generate_data_key(), t);

        let sonra = t + Duration::from_secs(VARSAYILAN_KILIT_SURESI_SN + 1);
        o.dokun(sonra);
        assert!(
            !o.acik_mi(sonra),
            "suresi dolmus oturum dokunmayla dirilmemeli"
        );
        assert!(o.anahtar(sonra).is_none());
    }
}
