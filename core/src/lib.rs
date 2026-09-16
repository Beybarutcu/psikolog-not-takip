pub mod backup;
pub mod crypto;
/// Parola değiştirme — `keystore::change_password`'un üründeki çağrı yeri.
pub mod parola;
/// Danışan veri raporu → AES-256 (V5) parola korumalı PDF. Veritabanını bilmez.
pub mod pdf;
pub mod session;
pub mod store;
