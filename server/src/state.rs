use psikolog_core::crypto::keyring::{DataKey, KdfParams};
use psikolog_core::session::Oturum;
use psikolog_core::store::audit::AuditKaydi;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Clone)]
pub struct AppState {
    pub veri_dizini: PathBuf,
    pub oturum: Arc<Mutex<Oturum>>,
    pub kdf: KdfParams,
}

impl AppState {
    pub fn yeni(veri_dizini: PathBuf, kdf: KdfParams) -> Self {
        Self { veri_dizini, oturum: Arc::new(Mutex::new(Oturum::kapali())), kdf }
    }

    pub fn keystore_yolu(&self) -> PathBuf {
        self.veri_dizini.join("keystore.json")
    }

    pub fn db_yolu(&self) -> PathBuf {
        self.veri_dizini.join("veri.db")
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
