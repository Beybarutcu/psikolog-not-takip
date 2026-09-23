use crate::crypto::keyring::DataKey;
use std::time::{Duration, Instant, SystemTime};

/// Varsayilan bosta kalma kilit suresi (saniye). Bu sure boyunca islem
/// yapilmazsa oturum kendiliginden kilitlenir; danisan odadan cikarken
/// ekranda acik kalan notu koruma altina alir.
pub const VARSAYILAN_KILIT_SURESI_SN: u64 = 300;

/// Bir oturum etkinliginin oldugu andaki iki saat kaynagi birlikte.
///
/// # Neden ikisi birden (uyku bulgusu)
/// Onceki surum yalnizca `Instant` (monotonik saat) tutuyordu. macOS'ta
/// `Instant` isletim sisteminin "suspend" (uyku) sayacina degil, yalnizca
/// calisir durumdaki gecen sureye dayanir -- kapak kapatilip MacBook uykuya
/// dalinca `Instant` ILERLEMEZ. Terapist gun sonunda kapagi kapatir (ekranda
/// bir danisanin notu aciktir), ertesi sabah acar: uykuda gecen saatler
/// `Instant` farkina hic yansimaz, 300 saniyelik pencere "dolmamis" gorunur
/// ve sunucu oturumu acik sayar -- butun takvim, danisan adlari ve acik not
/// geri gelir. Bu modulun kendi tehdit modeli ("danisan odadan cikarken
/// ekranda acik kalan notu koruma altina alir") tam bu senaryoda tutmuyordu.
///
/// Duvar saati (`SystemTime`) tek basina da yeterli degil: kullanici (ya da
/// isletim sistemi saat senkronizasyonu) saati GERIYE alirsa, duvar saati
/// farki kucuk/negatif cikar ve kilit hic tetiklenmeyebilir -- bu da ayri
/// bir acik.
///
/// Cozum: ikisini BIRLIKTE tutmak. `acik_mi` icin oturum "acik" sayilmasi
/// hem monotonik HEM duvar saatinin sinirin icinde kalmasini gerektirir --
/// yani ikisinden HANGISI sinir asarsa oturum kilitlenir, tek bir kolun
/// basarisiz olmasi yeter. Duvar saati GERIYE giderse (kullanici saati
/// degistirdi, senkronizasyon sicradi) bu zaten bir uyari isaretidir --
/// guvenli taraf kilitlemektir, bu yuzden negatif fark da "sinir asildi"
/// sayilir (bkz. `ZamanDamgasi::sinir_asildi_mi`).
///
/// # Ne KAPATILIYOR, ne KAPATILMIYOR (dal incelemesi bulgusu)
/// Saf uyku (mono donuk, duvar dogal akisiyla ilerliyor) kapatiliyor: (a)
/// testi bunu dogrular. Saf geriye-saat (duvar geri, mono normal) kapatiliyor:
/// (b) testi bunu dogrular. AMA su kombinasyon KAPATILMIYOR: mono donuk
/// (makine uyudu) VE biri kapak acildiginda sistem saatini GERIYE almadan,
/// dogru sinirin ALTINDA kalacak bir degere elle AYARLARSA (ornegin D0 + 1
/// saniyeye) -- `mono_asildi` yanlis, `duvar_asildi` da yanlis cikar ve
/// oturum ACIK kalir, gercekte uzerinden saatler gecmis olsa bile. Bu
/// `mono_ve_duvar_donuk_kombinasyonunda_acik_kalir_bilinen_sinir` testiyle
/// SABITLENMISTIR -- bir hata degil, BILINCLI KABUL EDILEN bir sinirdir:
/// sistem saatini elle bu sekilde ayarlayabilen biri zaten bu urunun tehdit
/// modelinin (`danisan odadan cikarken ekranda acik kalan notu koruma
/// altina alir` -- bkz. `VARSAYILAN_KILIT_SURESI_SN` dokumantasyonu)
/// disindadir; saate dayanan HERHANGI bir zaman asimi ilkesi, saati
/// kontrol edebilen bir saldirgana karsi ayni sekilde atlatilabilir. Bunu
/// platforma ozgu bir mekanizmayla (ör. `CLOCK_MONOTONIC` varyantlari,
/// libc) kapatmak bu depoya yeni bir platform bagimliligi eklerdi; karar
/// budur: KAPATILMIYOR, ve neden kapatilmadigi burada ve yukaridaki testte
/// yazili duruyor.
///
/// Iki alan HER ZAMAN birlikte, ayni "an"dan alinip birlikte saklanir (tek
/// bir struct icinde) ki biri guncellenip digeri unutulamasin.
#[derive(Clone, Copy)]
struct ZamanDamgasi {
    mono: Instant,
    duvar: SystemTime,
}

impl ZamanDamgasi {
    fn yeni(mono: Instant, duvar: SystemTime) -> Self {
        Self { mono, duvar }
    }

    /// `simdi`'ye gore bu damgadan bu yana ya monotonik ya da duvar saati
    /// tarafinda `sinir` asilmis mi? Ikisinden BIRI yeterli.
    fn sinir_asildi_mi(&self, simdi: &ZamanDamgasi, sinir: Duration) -> bool {
        let mono_asildi = simdi.mono.duration_since(self.mono) > sinir;
        let duvar_asildi = match simdi.duvar.duration_since(self.duvar) {
            Ok(gecen) => gecen > sinir,
            // Duvar saati GERIYE gitti: `SystemTime::duration_since` bunu
            // `Err` ile bildirir. Bu bir uyari isaretidir (saat degistirildi
            // ya da senkronizasyon sicradi); guvenli taraf kilitlemektir, o
            // yuzden bunu da "sinir asildi" sayiyoruz.
            Err(_) => true,
        };
        mono_asildi || duvar_asildi
    }
}

/// Bellekte acik veri anahtarini tutan oturum. Zaman disaridan `Instant` VE
/// `SystemTime` olarak verilir; boylece testler gercekten beklemek zorunda
/// kalmaz ve `Instant::now()`/`SystemTime::now()` bu modulun icinde asla
/// cagrilmaz (bkz. `ZamanDamgasi` dokumantasyonu: neden ikisi birden).
pub struct Oturum {
    anahtar: Option<DataKey>,
    son_islem: Option<ZamanDamgasi>,
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

    /// Oturumu verilen anahtarla acar ve son islem zamanini `now`/`now_duvar`
    /// olarak isaretler.
    pub fn ac(&mut self, anahtar: DataKey, now: Instant, now_duvar: SystemTime) {
        self.anahtar = Some(anahtar);
        self.son_islem = Some(ZamanDamgasi::yeni(now, now_duvar));
    }

    /// Oturumu kilitler: anahtar `None`'a set edilir, `Zeroizing` dusurulunce
    /// bellek sifirlanir. Anahtarin baska bir kopyasi tutulmaz.
    pub fn kilitle(&mut self) {
        self.anahtar = None;
        self.son_islem = None;
    }

    /// Oturum gercekten acik mi? Anahtar varsa VE ne monotonik ne de duvar
    /// saati bosta kalma suresini asmamissa `true` doner. Ikisinden hangisi
    /// siniri asarsa oturum kilitli sayilir (bkz. `ZamanDamgasi`).
    pub fn acik_mi(&self, now: Instant, now_duvar: SystemTime) -> bool {
        match (&self.anahtar, &self.son_islem) {
            // `>` (asildi mi) kasitli, `<=` degil: tam sinirda
            // (now - son_islem == kilit_suresi) oturum hala ACIK sayilir. Bu
            // secim `sinirda_acik_bir_ns_sonra_kapali` testiyle
            // kilitlenmistir - karsilastirma degistirilirse o test kirilir.
            (Some(_), Some(son)) => {
                !son.sinir_asildi_mi(&ZamanDamgasi::yeni(now, now_duvar), self.kilit_suresi)
            }
            _ => false,
        }
    }

    /// Kullanici etkilesimini isaretler ve bosta kalma suresini sifirlar.
    /// Oturum zaten suresi dolmussa (yani `acik_mi(now, now_duvar)` yanlissa)
    /// hicbir sey yapmaz - suresi dolmus bir oturum dokunmayla
    /// dirilmemelidir.
    pub fn dokun(&mut self, now: Instant, now_duvar: SystemTime) {
        if self.acik_mi(now, now_duvar) {
            self.son_islem = Some(ZamanDamgasi::yeni(now, now_duvar));
        }
    }

    /// Oturum acikken anahtarin bir kopyasini doner; degilse `None`.
    pub fn anahtar(&self, now: Instant, now_duvar: SystemTime) -> Option<DataKey> {
        if self.acik_mi(now, now_duvar) {
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
    use std::time::{Duration, Instant, SystemTime};

    #[test]
    fn yeni_oturum_kapalidir() {
        let t = Instant::now();
        let td = SystemTime::now();
        assert!(!Oturum::kapali().acik_mi(t, td));
    }

    #[test]
    fn acilan_oturum_anahtari_verir() {
        let t = Instant::now();
        let td = SystemTime::now();
        let key = generate_data_key();
        let mut o = Oturum::kapali();
        o.ac(key.clone(), t, td);
        assert!(o.acik_mi(t, td));
        assert_eq!(o.anahtar(t, td).unwrap().as_ref(), key.as_ref());
    }

    #[test]
    fn sure_dolunca_kendiliginden_kilitlenir() {
        let t = Instant::now();
        let td = SystemTime::now();
        let mut o = Oturum::kapali();
        o.ac(generate_data_key(), t, td);

        let sonra = t + Duration::from_secs(VARSAYILAN_KILIT_SURESI_SN + 1);
        let sonra_td = td + Duration::from_secs(VARSAYILAN_KILIT_SURESI_SN + 1);
        assert!(!o.acik_mi(sonra, sonra_td));
        assert!(o.anahtar(sonra, sonra_td).is_none());
    }

    #[test]
    fn dokunmak_sureyi_uzatir() {
        let t = Instant::now();
        let td = SystemTime::now();
        let mut o = Oturum::kapali();
        o.ac(generate_data_key(), t, td);

        let orta = t + Duration::from_secs(200);
        let orta_td = td + Duration::from_secs(200);
        o.dokun(orta, orta_td);

        let sonra = orta + Duration::from_secs(200);
        let sonra_td = orta_td + Duration::from_secs(200);
        assert!(o.acik_mi(sonra, sonra_td), "dokunma sonrasi sure yeniden baslamali");
    }

    #[test]
    fn kilitlenince_anahtar_verilmez() {
        let t = Instant::now();
        let td = SystemTime::now();
        let mut o = Oturum::kapali();
        o.ac(generate_data_key(), t, td);
        o.kilitle();
        assert!(o.anahtar(t, td).is_none());
    }

    #[test]
    fn kilit_suresi_ayarlanabilir() {
        let t = Instant::now();
        let td = SystemTime::now();
        let mut o = Oturum::kapali();
        o.kilit_suresi_ayarla(60);
        o.ac(generate_data_key(), t, td);
        assert!(o.acik_mi(t + Duration::from_secs(59), td + Duration::from_secs(59)));
        assert!(!o.acik_mi(t + Duration::from_secs(61), td + Duration::from_secs(61)));
    }

    #[test]
    fn sinirda_acik_bir_ns_sonra_kapali() {
        // `acik_mi` icindeki sinir karsilastirmasinin ucunu kilitler: tam
        // sinirda (son_islem + kilit_suresi) oturum ACIK, bir nanosaniye
        // sonrasinda KAPALI olmali. Hem `acik_mi` hem `anahtar` uzerinden
        // dogrulanir - biri dogru digeri yanlis olabilir. Monotonik ve duvar
        // saati BIRLIKTE, ayni miktarda ilerletiliyor ki bu test yalnizca
        // sinir ucunu olcsun, iki saat kaynaginin etkilesimini degil (o
        // ayri testlerde -- asagidaki (a)-(d) -- kontrol ediliyor).
        let t = Instant::now();
        let td = SystemTime::now();
        let mut o = Oturum::kapali();
        o.kilit_suresi_ayarla(60);
        o.ac(generate_data_key(), t, td);

        let tam_sinirda = t + Duration::from_secs(60);
        let tam_sinirda_td = td + Duration::from_secs(60);
        assert!(
            o.acik_mi(tam_sinirda, tam_sinirda_td),
            "tam sinirda oturum hala acik sayilmali"
        );
        assert!(
            o.anahtar(tam_sinirda, tam_sinirda_td).is_some(),
            "tam sinirda anahtar hala verilmeli"
        );

        let sinirdan_bir_ns_sonra = tam_sinirda + Duration::from_nanos(1);
        let sinirdan_bir_ns_sonra_td = tam_sinirda_td + Duration::from_nanos(1);
        assert!(
            !o.acik_mi(sinirdan_bir_ns_sonra, sinirdan_bir_ns_sonra_td),
            "sinirdan bir ns sonra oturum kapali olmali"
        );
        assert!(
            o.anahtar(sinirdan_bir_ns_sonra, sinirdan_bir_ns_sonra_td).is_none(),
            "sinirdan bir ns sonra anahtar verilmemeli"
        );
    }

    #[test]
    fn suresi_dolmus_oturuma_dokunmak_diriltmez() {
        let t = Instant::now();
        let td = SystemTime::now();
        let mut o = Oturum::kapali();
        o.ac(generate_data_key(), t, td);

        let sonra = t + Duration::from_secs(VARSAYILAN_KILIT_SURESI_SN + 1);
        let sonra_td = td + Duration::from_secs(VARSAYILAN_KILIT_SURESI_SN + 1);
        o.dokun(sonra, sonra_td);
        assert!(
            !o.acik_mi(sonra, sonra_td),
            "suresi dolmus oturum dokunmayla dirilmemeli"
        );
        assert!(o.anahtar(sonra, sonra_td).is_none());
    }

    // --- Uyku/duvar saati bulgusu: Gorev 4 (a)-(d) ---
    //
    // Senaryo: terapist MacBook'un kapagini kapatir, makine uykuya dalar.
    // macOS'ta `Instant` uyku boyunca ILERLEMEZ (monotonik saat yalnizca
    // calisir durumdaki sureyi sayar) ama `SystemTime` (duvar saati) ilerler.
    // Asagidaki dort test, brief'teki (a)-(d) senaryolarinin birebir
    // karsiligidir.

    /// (a) Monotonik saat HIC ilerlemedi (sanki islem uykuda donmus) ama
    /// duvar saati 8 saat ilerledi (kapak 8 saat kapali kaldi) -> KILITLI
    /// olmali. Yalnizca monotonik saate bakan eski kod bunu KACIRIRDI --
    /// tam da uyku bulgusunun kendisi.
    #[test]
    fn a_mono_ilerlemedi_duvar_8_saat_ilerledi_kilitli() {
        let t = Instant::now();
        let td = SystemTime::now();
        let mut o = Oturum::kapali();
        o.ac(generate_data_key(), t, td);

        // Mono: AYNI an (uykuda gecen sure sayilmadi). Duvar: 8 saat sonra.
        let sonra_td = td + Duration::from_secs(8 * 3600);
        assert!(
            !o.acik_mi(t, sonra_td),
            "monotonik ilerlemese bile duvar saati siniri asarsa kilitlenmeli (uyku senaryosu)"
        );
        assert!(o.anahtar(t, sonra_td).is_none());
    }

    /// (b) Duvar saati GERIYE gitti (kullanici saati degistirdi ya da saat
    /// senkronizasyonu sicradi) -> KILITLI olmali, monotonik saat sinirin
    /// cok altinda olsa bile. Negatif fark bir uyari isaretidir; guvenli
    /// taraf kilitlemektir.
    #[test]
    fn b_duvar_geriye_gitti_kilitli() {
        let t = Instant::now();
        let td = SystemTime::now();
        let mut o = Oturum::kapali();
        o.ac(generate_data_key(), t, td);

        // Mono: 1 saniye ileri (sinirin cok altinda). Duvar: 1 saat GERI.
        let sonra = t + Duration::from_secs(1);
        let sonra_td = td - Duration::from_secs(3600);
        assert!(
            !o.acik_mi(sonra, sonra_td),
            "duvar saati geriye giderse kilitlenmeli, monotonik sinirin altinda olsa bile"
        );
        assert!(o.anahtar(sonra, sonra_td).is_none());
    }

    /// (c) Ikisi de sinirin altinda -> ACIK kalmali (normal kullanim, uyku
    /// veya saat oynamasi yok).
    #[test]
    fn c_ikisi_de_sinirin_altinda_acik() {
        let t = Instant::now();
        let td = SystemTime::now();
        let mut o = Oturum::kapali();
        o.kilit_suresi_ayarla(300);
        o.ac(generate_data_key(), t, td);

        let sonra = t + Duration::from_secs(120);
        let sonra_td = td + Duration::from_secs(120);
        assert!(o.acik_mi(sonra, sonra_td), "ikisi de sinirin altindayken oturum acik kalmali");
        assert!(o.anahtar(sonra, sonra_td).is_some());
    }

    /// (d) Mevcut davranis: yalnizca monotonik saat siniri asarsa da
    /// (duvar saati sinirin icinde kalsa bile -- ornegin sistem saatinin
    /// donduruldugu bir test/hata durumu) KILITLI olmali. Bu, uykuyu
    /// yakalamak icin eklenen duvar saati kolunun var olan monotonik
    /// korumayi ZAYIFLATMADIGINI dogrular.
    #[test]
    fn d_yalnizca_mono_siniri_astiginda_da_kilitli() {
        let t = Instant::now();
        let td = SystemTime::now();
        let mut o = Oturum::kapali();
        o.kilit_suresi_ayarla(60);
        o.ac(generate_data_key(), t, td);

        // Mono: 61 saniye ileri (siniri asti). Duvar: yalnizca 1 saniye ileri
        // (sinirin cok altinda).
        let sonra = t + Duration::from_secs(61);
        let sonra_td = td + Duration::from_secs(1);
        assert!(
            !o.acik_mi(sonra, sonra_td),
            "monotonik saat tek basina siniri asarsa kilitlenmeli"
        );
        assert!(o.anahtar(sonra, sonra_td).is_none());
    }

    /// **Bilinen ve kabul edilmis sinir** (dal incelemesi, "ikisi de donuk"
    /// bulgusu) -- bu bir HATA testi DEGIL, mevcut davranisi kasitli olarak
    /// SABITLEYEN bir testtir. "Boyle olMALI" demiyor, "bugun boyle ve nedeni
    /// su" diyor (bkz. `docs/test-yesil-ama-korumuyor.md` 10. bicim).
    ///
    /// Senaryo: makine uyur, mono DONAR (8 saat gecse de ilerlemez). Kapagi
    /// acan biri sistem saatini GERIYE almaz, ama onu dogru zamana degil,
    /// sinirin ALTINDA kalacak bir degere (D0 + 1 saniye) elle ayarlar. Ne
    /// `mono_asildi` ne `duvar_asildi` tetiklenir -- oturum ACIK kalir.
    ///
    /// Bu kapatilmiyor cunku: sistem saatini bu sekilde elle
    /// yonlendirebilen biri zaten bu urunun tehdit modelinin DISINDADIR
    /// (tehdit modeli: "danisan odadan cikarken ekranda acik kalan notu
    /// koruma altina alir" -- fiziksel erisimi olan ama sistem saatini
    /// degistiremeyen biri). Saate dayanan HERHANGI bir zaman asimi ilkesi
    /// saati kontrol eden bir saldirgana karsi ayni sekilde atlatilabilir;
    /// bu Gorev 4'un cozdugu sorun (macOS uykusu) degil, ayri ve daha genis
    /// bir sinif. Platforma ozgu kod (libc/`CLOCK_MONOTONIC` varyantlari) bu
    /// depoya yeni bir bagimlilik eklerdi -- KONTROL KARARI: eklenmiyor.
    ///
    /// Mekanizma ileride degisirse (ornegin platforma ozgu bir uyku
    /// algilamasi eklenirse) bu test kirilir -- o an biri bu sinirin
    /// KASITLI olarak asildigini gorur, sessizce degil.
    #[test]
    fn mono_ve_duvar_donuk_kombinasyonunda_acik_kalir_bilinen_sinir() {
        let t = Instant::now();
        let td = SystemTime::now();
        let mut o = Oturum::kapali();
        o.ac(generate_data_key(), t, td);

        // Mono: AYNI an (makine uyudu, mono donuk kaldi -- (a) testiyle
        // ayni kosul). Duvar: GERIYE degil, ama gercek zamana da degil --
        // sinirin cok altinda kalacak bir degere elle ayarlandi.
        let td_elle_ayarlanmis = td + Duration::from_secs(1);
        assert!(
            o.acik_mi(t, td_elle_ayarlanmis),
            "bilinen sinir: mono donuk + duvar saati sinirin altina elle \
             ayarlanmissa oturum ACIK kalir (bkz. modul basligi \"Ne \
             KAPATILIYOR, ne KAPATILMIYOR\")"
        );
        assert!(o.anahtar(t, td_elle_ayarlanmis).is_some());
    }
}
