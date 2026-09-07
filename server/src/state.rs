use psikolog_core::crypto::keyring::{DataKey, KdfParams};
use psikolog_core::session::Oturum;
use psikolog_core::store::audit::AuditKaydi;
use psikolog_core::store::keystore::{self, Keystore};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Clone)]
pub struct AppState {
    pub veri_dizini: PathBuf,
    pub oturum: Arc<Mutex<Oturum>>,
    pub kdf: KdfParams,
    /// Kurulum işlemini (var olma kontrolü + diske yazma) tek başına
    /// serileştiren kilit. `oturum` kilidinden **AYRI** tutulur: kurulum
    /// sırasında iki eş zamanlı istek `exists()` kontrolünde ikisi de "dosya
    /// yok" görüp yazmaya kalkarsa, ikincisi birincinin keystore'unu (ve
    /// dolayısıyla parolasını) sessizce ezer — bu kilit onu engeller.
    /// Sıralama önemli: bu kilit her zaman `oturum` kilidinden ÖNCE alınır
    /// (bkz. `routes::setup::kurulum`), asla tersi değil; aksi hâlde
    /// kilitlenme (deadlock) riski oluşur.
    pub kurulum_kilidi: Arc<Mutex<()>>,
}

/// Keystore dosyasının üç olası durumu. `keystore::exists` yalnızca dosyanın
/// var olup olmadığına bakar; `keystore::load` ise "dosya yok" ile "dosya
/// bozuk" durumlarını aynı `io::Error` altında birleştirir. Bu enum, HTTP
/// katmanının bu iki durumu ayırt edip kullanıcıya doğru mesajı vermesi
/// içindir (bkz. Görev 10 inceleme Bulgu 1).
pub enum KeystoreDurumu {
    /// Henüz kurulum yapılmamış (dosya yok).
    Yok,
    /// Dosya var ama okunamıyor/ayrıştırılamıyor (bozuk).
    Bozuk,
    /// Dosya var ve başarıyla okundu.
    Var(Keystore),
}

impl AppState {
    pub fn yeni(veri_dizini: PathBuf, kdf: KdfParams) -> Self {
        Self {
            veri_dizini,
            oturum: Arc::new(Mutex::new(Oturum::kapali())),
            kdf,
            kurulum_kilidi: Arc::new(Mutex::new(())),
        }
    }

    pub fn keystore_yolu(&self) -> PathBuf {
        self.veri_dizini.join("keystore.json")
    }

    pub fn db_yolu(&self) -> PathBuf {
        self.veri_dizini.join("veri.db")
    }

    /// Keystore dosyasının `KeystoreDurumu`'ndan hangisinde olduğunu bildirir.
    pub fn keystore_durumu(&self) -> KeystoreDurumu {
        let yol = self.keystore_yolu();
        if !keystore::exists(&yol) {
            return KeystoreDurumu::Yok;
        }
        match keystore::load(&yol) {
            Ok(ks) => KeystoreDurumu::Var(ks),
            Err(_) => KeystoreDurumu::Bozuk,
        }
    }

    /// Oturumdan taze bir anahtar klonu alir. Bu klon yalnizca cagiran istek
    /// islemi suresince kullanilmali, hicbir uzun omurlu yapida (AppState
    /// alani, static, vb.) saklanmamalidir — `kilitle()` cagrildiginda
    /// zaten dagitilmis klonlar etkilenmez, bu yuzden her istekte tekrar
    /// buradan alinmalidir.
    pub fn acik_anahtar(&self) -> Option<DataKey> {
        self.oturum.lock().unwrap().anahtar(Instant::now())
    }

    pub fn audit_dokumu(&self) -> anyhow::Result<Vec<AuditKaydi>> {
        let key = self.acik_anahtar().ok_or_else(|| anyhow::anyhow!("oturum kilitli"))?;
        let conn = psikolog_core::store::db::open_encrypted(&self.db_yolu(), &key)?;
        Ok(psikolog_core::store::audit::son_kayitlar(&conn, 50)?)
    }
}
