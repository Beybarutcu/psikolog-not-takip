# Çekirdek: Güvenli Veri Katmanı ve Çalışan Kabuk — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Açıldığında ana parola soran, şifreli veritabanını çözen, boşta kalınca kilitlenen, her gün şifreli yedek alıp geri yükleyebilen ve macOS'ta `.dmg` üretilen bir uygulama iskeleti.

**Architecture:** Cargo workspace içinde üç Rust crate'i (`core` — kripto ve veri, `server` — Axum HTTP API, `src-tauri` — masaüstü kabuk) ve bir Vite/React arayüzü. Tauri penceresi kendi başlattığı yerel Axum sunucusuna bağlanır; telefon da ileride aynı sunucuya bağlanacağı için tek arayüz kodu vardır. Veri anahtarı yalnızca bellekte tutulur, diskte parola ve kurtarma koduyla ayrı ayrı sarmalanmış hâlde durur.

**Tech Stack:** Rust 2021 (rusqlite + SQLCipher, argon2, chacha20poly1305, axum 0.8, tokio, rust-embed), Tauri 2, React 19 + TypeScript + Vite + Tailwind 4, Vitest, Playwright, GitHub Actions.

## Global Constraints

- **Hedef platform macOS**, geliştirme Windows'ta yapılır. Platforma özgü her çağrı (Keychain, Bonjour, yerel ağ izni) bir trait arkasına alınır ve Windows'ta stub uygulamasıyla derlenir. Bu plan içinde platforma özgü çağrı **yoktur**; kural sonraki planlar için geçerlidir.
- **Uygulama hiçbir dış ağ isteği yapmaz.** Telemetri, güncelleme kontrolü, CDN'den font/script çekme yasaktır. Tüm varlıklar binary'e gömülür.
- **Sunucu yalnızca `127.0.0.1`'e bağlanır.** Yerel ağa açılma bu planın kapsamında değildir (Plan 4).
- **Veri anahtarı asla diske düz yazılmaz** ve loglanmaz. Anahtar tutan tipler `zeroize::Zeroizing` ile sarılır.
- **KDF parametreleri:** Argon2id, `m_cost = 65536` (64 MiB), `t_cost = 3`, `p_cost = 1`. Bu değerler `KdfParams::default()` içinde tek yerde tanımlıdır.
- **Veri anahtarı 32 bayt**, sarmalama XChaCha20-Poly1305 (24 baytlık nonce) ile yapılır.
- **Arayüz metinleri Türkçedir.** Hata mesajları kullanıcıya ne yapması gerektiğini söyler, teknik terim içermez.
- **TDD zorunludur:** her görevde önce başarısız test, sonra minimum uygulama.
- **Rust sürümü:** 1.83+ (edition 2021). **Node:** 22 LTS.

---

## Dosya Yapısı

```
psikolog-not-takip/
├─ Cargo.toml                      # workspace: core, server, src-tauri
├─ core/
│  ├─ Cargo.toml
│  └─ src/
│     ├─ lib.rs                    # modul agaci, ortak Error tipi
│     ├─ crypto/
│     │  ├─ mod.rs
│     │  ├─ keyring.rs             # anahtar uretme, sarmalama, cozme
│     │  └─ recovery.rs            # kurtarma kodu uretme ve normallestirme
│     ├─ store/
│     │  ├─ mod.rs
│     │  ├─ keystore.rs            # keystore.json okuma/yazma, kilit acma
│     │  ├─ db.rs                  # SQLCipher baglantisi acma
│     │  ├─ schema.rs              # migration'lar
│     │  └─ audit.rs               # erisim logu yazma
│     ├─ backup.rs                 # 7 gun donusumlu sifreli yedek
│     └─ session.rs                # acik oturum, bosta kalma kilidi
├─ server/
│  ├─ Cargo.toml
│  └─ src/
│     ├─ lib.rs                    # router kurulumu
│     ├─ state.rs                  # AppState (oturum + yollar)
│     ├─ routes/
│     │  ├─ mod.rs
│     │  ├─ setup.rs               # ilk kurulum
│     │  ├─ session.rs             # unlock / lock / status
│     │  └─ backup.rs              # yedek listele / geri yukle
│     └─ assets.rs                 # gomulu React ciktisini sunma
├─ src-tauri/
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  └─ src/main.rs                  # sunucuyu baslatir, pencereyi acar
├─ web/
│  ├─ package.json
│  ├─ vite.config.ts
│  ├─ index.html
│  └─ src/
│     ├─ main.tsx
│     ├─ api.ts                    # fetch sarmalayicilari
│     ├─ App.tsx                   # kilit durumuna gore yonlendirme
│     └─ screens/
│        ├─ KurulumSihirbazi.tsx   # parola + kurtarma kodu
│        ├─ KilitEkrani.tsx
│        └─ AnaEkran.tsx           # bu planda placeholder govde
├─ e2e/
│  └─ kurulum.spec.ts              # Playwright
└─ .github/workflows/ci.yml
```

**Sorumluluk sınırları:** `core` hiçbir HTTP veya Tauri tipi tanımaz, saf kütüphanedir ve testlerinin tamamı Windows'ta çalışır. `server` yalnızca `core`'u HTTP'ye açar. `src-tauri` yalnızca pencere açar ve sunucuyu başlatır — iş mantığı içermez.

---

### Task 1: Workspace iskeleti ve CI

Bu görev projeyi derlenebilir hâle getirir ve **ilk günden macOS `.dmg` üretir**. CI'ı sona bırakmak, "kod bitti ama Mac'te hiç açılmadı" durumunu doğurur.

**Files:**
- Create: `Cargo.toml`, `core/Cargo.toml`, `core/src/lib.rs`
- Create: `web/package.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`
- Create: `.github/workflows/ci.yml`, `.gitignore`

**Interfaces:**
- Consumes: yok (ilk görev)
- Produces: `psikolog_core` crate adı; `cargo test -p psikolog-core` çalışır durumda

- [ ] **Step 1: Workspace ve core crate'ini oluştur**

`Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["core", "server", "src-tauri"]

[workspace.package]
version = "0.1.0"
edition = "2021"
rust-version = "1.83"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
anyhow = "1"
zeroize = { version = "1", features = ["derive"] }
rand = "0.8"
hex = "0.4"
time = { version = "0.3", features = ["formatting", "parsing", "macros"] }
```

`core/Cargo.toml`:

```toml
[package]
name = "psikolog-core"
version.workspace = true
edition.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
zeroize.workspace = true
rand.workspace = true
hex.workspace = true
time.workspace = true
argon2 = "0.5"
chacha20poly1305 = "0.10"
rusqlite = { version = "0.32", features = ["bundled-sqlcipher-vendored-openssl"] }

[dev-dependencies]
tempfile = "3"
```

`core/src/lib.rs`:

```rust
pub mod crypto;
pub mod store;
```

`core/src/crypto/mod.rs`:

```rust
pub mod keyring;
pub mod recovery;
```

`core/src/store/mod.rs`:

```rust
pub mod db;
pub mod keystore;
pub mod schema;
pub mod audit;
```

Bu modüllerin dosyalarını şimdilik boş oluştur (`core/src/crypto/keyring.rs` vb.), sonraki görevler dolduracak.

- [ ] **Step 2: Derlemenin çalıştığını doğrula**

Run: `cargo build`
Expected: `Finished` — SQLCipher ve vendored OpenSSL derlendiği için ilk yapı birkaç dakika sürer, bu normaldir.

- [ ] **Step 3: Web iskeletini oluştur**

```bash
npm create vite@latest web -- --template react-ts --yes
cd web && npm install && npm install -D tailwindcss @tailwindcss/vite && cd ..
```

`web/vite.config.ts` içeriğini şununla değiştir:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
})
```

- [ ] **Step 4: Tauri kabuğunu ekle**

Kök dizinde (workspace kökü) geliştirme araçlarını kur — bunlar CI'da `npm ci` ile geri yüklenir:

```bash
npm init -y
npm install -D @tauri-apps/cli@^2 @playwright/test
```

`src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Terapi Notlari",
  "version": "0.1.0",
  "identifier": "com.psikolog.notlar",
  "build": {
    "frontendDist": "../web/dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm --prefix web run dev",
    "beforeBuildCommand": "npm --prefix web run build"
  },
  "app": {
    "windows": [
      { "title": "Terapi Notlari", "width": 1280, "height": 820, "minWidth": 900, "minHeight": 600 }
    ],
    "security": { "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'" }
  },
  "bundle": { "active": true, "targets": ["dmg"], "icon": ["icons/icon.icns"] }
}
```

`src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("uygulama baslatilamadi");
}
```

- [ ] **Step 5: CI iş akışını yaz**

`.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm', cache-dependency-path: web/package-lock.json }
      # Strawberry Perl, Git'in gomulu minimal perl'unu golgelemeli.
      # openssl-sys (SQLCipher icin) tam bir Perl kurulumu ister.
      - name: Strawberry Perl'u PATH basina al
        shell: pwsh
        run: |
          if (Test-Path 'C:\Strawberry\perl\bin') {
            'C:\Strawberry\perl\bin' | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append
          }
      # ONEMLI: npm adimlari Rust'tan ONCE gelir. cargo test --workspace,
      # src-tauri'yi de derler; generate_context!() makrosu web/dist dizininin
      # derleme aninda VAR OLMASINI ister ve o dizin .gitignore'dadir.
      - run: npm ci
      - run: npm --prefix web ci
      - run: npm --prefix web run build
      - run: cargo test --workspace

  build-macos:
    runs-on: macos-14
    strategy:
      matrix:
        target: [aarch64-apple-darwin, x86_64-apple-darwin]
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with: { targets: '${{ matrix.target }}' }
      - uses: Swatinem/rust-cache@v2
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm', cache-dependency-path: web/package-lock.json }
      - run: npm ci
      - run: npm --prefix web ci
      - run: npx tauri build --target ${{ matrix.target }}
      - uses: actions/upload-artifact@v4
        with:
          name: dmg-${{ matrix.target }}
          path: target/${{ matrix.target }}/release/bundle/dmg/*.dmg
```

**Neden universal binary değil:** vendored OpenSSL'i tek geçişte iki mimariye derlemek kırılgandır. İki ayrı `.dmg` üretmek hem basit hem şeffaftır; ileride `lipo` ile birleştirmek istenirse ayrı bir görev olur. Psikoloğun Mac'i Apple Silicon ise `aarch64` çıktısı yeterlidir.

- [ ] **Step 6: `.gitignore` yaz**

```gitignore
/target
/web/dist
/web/node_modules
/node_modules
/e2e/test-results
*.dmg
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: workspace iskeleti, Tauri kabugu ve CI"
```

---

### Task 2: Anahtar sarmalama (keyring)

Projenin en kritik kodu. Buradaki bir hata, kurtarılamayan veri demek.

**Files:**
- Modify: `core/src/crypto/keyring.rs`
- Test: aynı dosyanın `#[cfg(test)] mod tests` bloğu

**Interfaces:**
- Consumes: yok
- Produces:
  - `pub type DataKey = Zeroizing<[u8; 32]>`
  - `pub struct KdfParams { pub m_cost: u32, pub t_cost: u32, pub p_cost: u32 }` (`Default` uygular)
  - `pub struct WrappedKey { pub kdf: KdfParams, pub salt_hex: String, pub nonce_hex: String, pub ciphertext_hex: String }` (Serialize + Deserialize + Clone)
  - `pub fn generate_data_key() -> DataKey`
  - `pub fn wrap_key(secret: &str, key: &DataKey, kdf: KdfParams) -> Result<WrappedKey, CryptoError>`
  - `pub fn unwrap_key(secret: &str, wrapped: &WrappedKey) -> Result<DataKey, CryptoError>`
  - `pub enum CryptoError { WrongSecret, Kdf(String), Format(String) }`

- [ ] **Step 1: Başarısız testleri yaz**

`core/src/crypto/keyring.rs` dosyasının sonuna:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sarmalanan_anahtar_ayni_parolayla_geri_acilir() {
        let key = generate_data_key();
        let wrapped = wrap_key("dogru-parola", &key, KdfParams::test_fast()).unwrap();
        let acilan = unwrap_key("dogru-parola", &wrapped).unwrap();
        assert_eq!(key.as_ref(), acilan.as_ref());
    }

    #[test]
    fn yanlis_parola_wrong_secret_dondurur() {
        let key = generate_data_key();
        let wrapped = wrap_key("dogru-parola", &key, KdfParams::test_fast()).unwrap();
        let hata = unwrap_key("yanlis-parola", &wrapped).unwrap_err();
        assert!(matches!(hata, CryptoError::WrongSecret));
    }

    #[test]
    fn ayni_anahtar_iki_kez_sarmalaninca_ciktilar_farklidir() {
        let key = generate_data_key();
        let a = wrap_key("p", &key, KdfParams::test_fast()).unwrap();
        let b = wrap_key("p", &key, KdfParams::test_fast()).unwrap();
        assert_ne!(a.salt_hex, b.salt_hex, "her sarmalama yeni tuz uretmeli");
        assert_ne!(a.nonce_hex, b.nonce_hex, "her sarmalama yeni nonce uretmeli");
        assert_ne!(a.ciphertext_hex, b.ciphertext_hex);
    }

    #[test]
    fn uretilen_anahtarlar_birbirinden_farklidir() {
        assert_ne!(generate_data_key().as_ref(), generate_data_key().as_ref());
    }

    #[test]
    fn bozuk_sifreli_metin_wrong_secret_dondurur() {
        let key = generate_data_key();
        let mut wrapped = wrap_key("p", &key, KdfParams::test_fast()).unwrap();
        wrapped.ciphertext_hex.replace_range(0..2, "ff");
        assert!(matches!(unwrap_key("p", &wrapped).unwrap_err(), CryptoError::WrongSecret));
    }

    #[test]
    fn varsayilan_kdf_parametreleri_spec_ile_uyusur() {
        let p = KdfParams::default();
        assert_eq!((p.m_cost, p.t_cost, p.p_cost), (65536, 3, 1));
    }
}
```

`KdfParams::test_fast()` yalnızca testlerde kullanılır (`m_cost = 8`, `t_cost = 1`, `p_cost = 1`); gerçek parametrelerle her test 64 MiB bellek harcar ve test süresi dakikalara çıkar.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core keyring`
Expected: derleme hatası — `generate_data_key`, `wrap_key`, `unwrap_key` bulunamıyor.

- [ ] **Step 3: Minimum uygulamayı yaz**

`core/src/crypto/keyring.rs` başına:

```rust
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

pub const DATA_KEY_LEN: usize = 32;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;

pub type DataKey = Zeroizing<[u8; DATA_KEY_LEN]>;

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("parola veya kurtarma kodu hatali")]
    WrongSecret,
    #[error("anahtar turetilemedi: {0}")]
    Kdf(String),
    #[error("kayit bicimi bozuk: {0}")]
    Format(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdfParams {
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self { m_cost: 65536, t_cost: 3, p_cost: 1 }
    }
}

impl KdfParams {
    #[cfg(test)]
    pub fn test_fast() -> Self {
        Self { m_cost: 8, t_cost: 1, p_cost: 1 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WrappedKey {
    pub kdf: KdfParams,
    pub salt_hex: String,
    pub nonce_hex: String,
    pub ciphertext_hex: String,
}

pub fn generate_data_key() -> DataKey {
    let mut key = [0u8; DATA_KEY_LEN];
    rand::thread_rng().fill_bytes(&mut key);
    Zeroizing::new(key)
}

fn derive(secret: &str, salt: &[u8], kdf: KdfParams) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    let params = Params::new(kdf.m_cost, kdf.t_cost, kdf.p_cost, Some(32))
        .map_err(|e| CryptoError::Kdf(e.to_string()))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = Zeroizing::new([0u8; 32]);
    argon
        .hash_password_into(secret.as_bytes(), salt, out.as_mut())
        .map_err(|e| CryptoError::Kdf(e.to_string()))?;
    Ok(out)
}

pub fn wrap_key(secret: &str, key: &DataKey, kdf: KdfParams) -> Result<WrappedKey, CryptoError> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce);

    let derived = derive(secret, &salt, kdf)?;
    let cipher = XChaCha20Poly1305::new(derived.as_ref().into());
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), key.as_ref().as_slice())
        .map_err(|_| CryptoError::Kdf("sifreleme basarisiz".into()))?;

    Ok(WrappedKey {
        kdf,
        salt_hex: hex::encode(salt),
        nonce_hex: hex::encode(nonce),
        ciphertext_hex: hex::encode(ciphertext),
    })
}

pub fn unwrap_key(secret: &str, wrapped: &WrappedKey) -> Result<DataKey, CryptoError> {
    let salt = hex::decode(&wrapped.salt_hex).map_err(|e| CryptoError::Format(e.to_string()))?;
    let nonce = hex::decode(&wrapped.nonce_hex).map_err(|e| CryptoError::Format(e.to_string()))?;
    let ciphertext =
        hex::decode(&wrapped.ciphertext_hex).map_err(|e| CryptoError::Format(e.to_string()))?;
    if nonce.len() != NONCE_LEN {
        return Err(CryptoError::Format("nonce uzunlugu hatali".into()));
    }

    let derived = derive(secret, &salt, wrapped.kdf)?;
    let cipher = XChaCha20Poly1305::new(derived.as_ref().into());
    let plain = cipher
        .decrypt(XNonce::from_slice(&nonce), ciphertext.as_slice())
        .map_err(|_| CryptoError::WrongSecret)?;

    let bytes: [u8; DATA_KEY_LEN] = plain
        .as_slice()
        .try_into()
        .map_err(|_| CryptoError::Format("anahtar uzunlugu hatali".into()))?;
    Ok(Zeroizing::new(bytes))
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core keyring`
Expected: 6 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/crypto/keyring.rs
git commit -m "feat(kripto): Argon2id + XChaCha20-Poly1305 ile anahtar sarmalama"
```

---

### Task 3: Kurtarma kodu

Parola unutulduğunda tek çıkış yolu. Kullanıcı bunu **elle yazacağı** için karışan karakterler (0/O, 1/I/L) tolere edilmelidir.

**Files:**
- Modify: `core/src/crypto/recovery.rs`
- Test: aynı dosyanın test bloğu

**Interfaces:**
- Consumes: yok
- Produces:
  - `pub fn generate_recovery_code() -> String` — `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX` biçiminde, 25 karakter + 4 tire
  - `pub fn normalize_recovery_code(input: &str) -> String` — tire/boşluk siler, büyütür, `O→0`, `I→1`, `L→1`

- [ ] **Step 1: Başarısız testleri yaz**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uretilen_kod_bes_gruplu_ve_normallesince_25_karakter() {
        let kod = generate_recovery_code();
        assert_eq!(kod.split('-').count(), 5);
        assert!(kod.split('-').all(|g| g.len() == 5));
        assert_eq!(normalize_recovery_code(&kod).len(), 25);
    }

    #[test]
    fn kodlar_birbirinden_farklidir() {
        assert_ne!(generate_recovery_code(), generate_recovery_code());
    }

    #[test]
    fn kucuk_harf_bosluk_ve_tire_tolere_edilir() {
        let kod = generate_recovery_code();
        let dagilmis = format!("  {}  ", kod.to_lowercase().replace('-', " "));
        assert_eq!(normalize_recovery_code(&dagilmis), normalize_recovery_code(&kod));
    }

    #[test]
    fn karisan_karakterler_duzeltilir() {
        assert_eq!(normalize_recovery_code("OIL01"), "01101");
    }

    #[test]
    fn alfabe_karisan_karakter_icermez() {
        let kod = normalize_recovery_code(&generate_recovery_code());
        assert!(!kod.contains('O') && !kod.contains('I') && !kod.contains('L'));
    }
}
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core recovery`
Expected: derleme hatası — fonksiyonlar tanımlı değil.

- [ ] **Step 3: Minimum uygulamayı yaz**

```rust
use rand::Rng;

/// Crockford Base32 benzeri alfabe: karisan O, I, L, U cikarilmistir.
const ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUPS: usize = 5;
const GROUP_LEN: usize = 5;

pub fn generate_recovery_code() -> String {
    let mut rng = rand::thread_rng();
    let mut gruplar = Vec::with_capacity(GROUPS);
    for _ in 0..GROUPS {
        let grup: String = (0..GROUP_LEN)
            .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
            .collect();
        gruplar.push(grup);
    }
    gruplar.join("-")
}

pub fn normalize_recovery_code(input: &str) -> String {
    input
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| match c.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .collect()
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core recovery`
Expected: 5 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/crypto/recovery.rs
git commit -m "feat(kripto): kurtarma kodu uretimi ve toleransli normallestirme"
```

---

### Task 4: Şifreli veritabanını açma

**Files:**
- Modify: `core/src/store/db.rs`
- Test: aynı dosyanın test bloğu

**Interfaces:**
- Consumes: `crypto::keyring::DataKey`
- Produces:
  - `pub fn open_encrypted(path: &Path, key: &DataKey) -> Result<Connection, DbError>`
  - `pub enum DbError { WrongKey, Sqlite(rusqlite::Error), Io(std::io::Error) }`

- [ ] **Step 1: Başarısız testleri yaz**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;

    #[test]
    fn ayni_anahtarla_yazilan_veri_geri_okunur() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        let key = generate_data_key();

        {
            let c = open_encrypted(&yol, &key).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('Ayse Yilmaz');")
                .unwrap();
        }

        let c = open_encrypted(&yol, &key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse Yilmaz");
    }

    #[test]
    fn yanlis_anahtar_wrong_key_dondurur() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        {
            let c = open_encrypted(&yol, &generate_data_key()).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT);").unwrap();
        }
        let hata = open_encrypted(&yol, &generate_data_key()).unwrap_err();
        assert!(matches!(hata, DbError::WrongKey));
    }

    #[test]
    fn dosya_icinde_duz_metin_bulunmaz() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("veri.db");
        {
            let c = open_encrypted(&yol, &generate_data_key()).unwrap();
            c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('GIZLI_DANISAN_ADI');")
                .unwrap();
        }
        let bytes = std::fs::read(&yol).unwrap();
        assert!(
            !bytes.windows(17).any(|w| w == b"GIZLI_DANISAN_ADI"),
            "veritabani dosyasinda duz metin bulundu"
        );
        assert!(&bytes[..15] != b"SQLite format 3", "dosya sifrelenmemis");
    }
}
```

Üçüncü test bu görevin varlık sebebidir: SQLCipher'ın gerçekten devrede olduğunu kanıtlar. Yanlış özellik bayrağıyla derlenirse rusqlite sessizce düz SQLite kullanır ve bu test yakalar.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core store::db`
Expected: derleme hatası — `open_encrypted` tanımlı değil.

- [ ] **Step 3: Minimum uygulamayı yaz**

```rust
use crate::crypto::keyring::DataKey;
use rusqlite::Connection;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("veritabani bu parolayla acilamiyor")]
    WrongKey,
    #[error("veritabani hatasi: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("dosya hatasi: {0}")]
    Io(#[from] std::io::Error),
}

pub fn open_encrypted(path: &Path, key: &DataKey) -> Result<Connection, DbError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "key", format!("x'{}'", hex::encode(key.as_ref())))?;

    // Anahtar yanlissa ilk gercek okuma "file is not a database" ile patlar.
    match conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)) {
        Ok(_) => {}
        Err(rusqlite::Error::SqliteFailure(_, _)) => return Err(DbError::WrongKey),
        Err(e) => return Err(DbError::Sqlite(e)),
    }

    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    Ok(conn)
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core store::db`
Expected: 3 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store/db.rs
git commit -m "feat(veri): SQLCipher ile sifreli veritabani acma"
```

---

### Task 5: Keystore — kurulum, kilit açma, parola değiştirme

**Files:**
- Modify: `core/src/store/keystore.rs`
- Test: aynı dosyanın test bloğu

**Interfaces:**
- Consumes: `keyring::{DataKey, WrappedKey, KdfParams, wrap_key, unwrap_key, generate_data_key, CryptoError}`, `recovery::{generate_recovery_code, normalize_recovery_code}`
- Produces:
  - `pub struct Keystore { pub version: u32, pub password: WrappedKey, pub recovery: WrappedKey }`
  - `pub struct SetupResult { pub keystore: Keystore, pub recovery_code: String, pub data_key: DataKey }`
  - `pub fn create(password: &str, kdf: KdfParams) -> Result<SetupResult, CryptoError>`
  - `pub fn save(ks: &Keystore, path: &Path) -> std::io::Result<()>` — atomik yazar
  - `pub fn load(path: &Path) -> std::io::Result<Keystore>`
  - `pub fn exists(path: &Path) -> bool`
  - `pub fn unlock_with_password(ks: &Keystore, password: &str) -> Result<DataKey, CryptoError>`
  - `pub fn unlock_with_recovery(ks: &Keystore, code: &str) -> Result<DataKey, CryptoError>`
  - `pub fn change_password(ks: &Keystore, old: &str, new: &str) -> Result<Keystore, CryptoError>`

- [ ] **Step 1: Başarısız testleri yaz**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::KdfParams;

    fn kur() -> SetupResult {
        create("parola123", KdfParams::test_fast()).unwrap()
    }

    #[test]
    fn kurulum_parola_ve_kurtarma_koduyla_ayni_anahtari_acar() {
        let s = kur();
        let a = unlock_with_password(&s.keystore, "parola123").unwrap();
        let b = unlock_with_recovery(&s.keystore, &s.recovery_code).unwrap();
        assert_eq!(a.as_ref(), s.data_key.as_ref());
        assert_eq!(b.as_ref(), s.data_key.as_ref());
    }

    #[test]
    fn kurtarma_kodu_dagilmis_yazilsa_da_calisir() {
        let s = kur();
        let dagilmis = s.recovery_code.to_lowercase().replace('-', " ");
        let acilan = unlock_with_recovery(&s.keystore, &dagilmis).unwrap();
        assert_eq!(acilan.as_ref(), s.data_key.as_ref());
    }

    #[test]
    fn yanlis_parola_reddedilir() {
        let s = kur();
        assert!(matches!(
            unlock_with_password(&s.keystore, "yanlis").unwrap_err(),
            CryptoError::WrongSecret
        ));
    }

    #[test]
    fn parola_degisince_yeni_parola_calisir_eskisi_calismaz() {
        let s = kur();
        let yeni = change_password(&s.keystore, "parola123", "yeni-parola").unwrap();

        let acilan = unlock_with_password(&yeni, "yeni-parola").unwrap();
        assert_eq!(acilan.as_ref(), s.data_key.as_ref(), "veri anahtari degismemeli");
        assert!(unlock_with_password(&yeni, "parola123").is_err());
    }

    #[test]
    fn parola_degisince_kurtarma_kodu_gecerliligini_korur() {
        let s = kur();
        let yeni = change_password(&s.keystore, "parola123", "yeni-parola").unwrap();
        let acilan = unlock_with_recovery(&yeni, &s.recovery_code).unwrap();
        assert_eq!(acilan.as_ref(), s.data_key.as_ref());
    }

    #[test]
    fn yanlis_eski_parolayla_degistirilemez() {
        let s = kur();
        assert!(change_password(&s.keystore, "yanlis", "yeni").is_err());
    }

    #[test]
    fn diske_yazilip_geri_okunur() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("keystore.json");
        let s = kur();
        assert!(!exists(&yol));
        save(&s.keystore, &yol).unwrap();
        assert!(exists(&yol));

        let okunan = load(&yol).unwrap();
        let acilan = unlock_with_password(&okunan, "parola123").unwrap();
        assert_eq!(acilan.as_ref(), s.data_key.as_ref());
    }

    #[test]
    fn keystore_dosyasi_duz_anahtar_icermez() {
        let dir = tempfile::tempdir().unwrap();
        let yol = dir.path().join("keystore.json");
        let s = kur();
        save(&s.keystore, &yol).unwrap();

        let icerik = std::fs::read(&yol).unwrap();
        let anahtar_hex = hex::encode(s.data_key.as_ref());
        let metin = String::from_utf8_lossy(&icerik);
        assert!(!metin.contains(&anahtar_hex), "veri anahtari diske duz yazilmis");
        assert!(!icerik.windows(32).any(|w| w == s.data_key.as_ref()));
    }
}
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core keystore`
Expected: derleme hatası.

- [ ] **Step 3: Minimum uygulamayı yaz**

```rust
use crate::crypto::keyring::{
    generate_data_key, unwrap_key, wrap_key, CryptoError, DataKey, KdfParams, WrappedKey,
};
use crate::crypto::recovery::{generate_recovery_code, normalize_recovery_code};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const KEYSTORE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keystore {
    pub version: u32,
    pub password: WrappedKey,
    pub recovery: WrappedKey,
}

pub struct SetupResult {
    pub keystore: Keystore,
    pub recovery_code: String,
    pub data_key: DataKey,
}

pub fn create(password: &str, kdf: KdfParams) -> Result<SetupResult, CryptoError> {
    let data_key = generate_data_key();
    let recovery_code = generate_recovery_code();
    let keystore = Keystore {
        version: KEYSTORE_VERSION,
        password: wrap_key(password, &data_key, kdf)?,
        recovery: wrap_key(&normalize_recovery_code(&recovery_code), &data_key, kdf)?,
    };
    Ok(SetupResult { keystore, recovery_code, data_key })
}

pub fn exists(path: &Path) -> bool {
    path.exists()
}

pub fn save(ks: &Keystore, path: &Path) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // Atomik yazim: yarim yazilmis keystore, verinin tamamini erisilmez birakir.
    let gecici = path.with_extension("json.tmp");
    std::fs::write(&gecici, serde_json::to_vec_pretty(ks)?)?;
    std::fs::rename(&gecici, path)
}

pub fn load(path: &Path) -> std::io::Result<Keystore> {
    let bytes = std::fs::read(path)?;
    Ok(serde_json::from_slice(&bytes)?)
}

pub fn unlock_with_password(ks: &Keystore, password: &str) -> Result<DataKey, CryptoError> {
    unwrap_key(password, &ks.password)
}

pub fn unlock_with_recovery(ks: &Keystore, code: &str) -> Result<DataKey, CryptoError> {
    unwrap_key(&normalize_recovery_code(code), &ks.recovery)
}

pub fn change_password(ks: &Keystore, old: &str, new: &str) -> Result<Keystore, CryptoError> {
    let data_key = unlock_with_password(ks, old)?;
    Ok(Keystore {
        version: ks.version,
        password: wrap_key(new, &data_key, ks.password.kdf)?,
        recovery: ks.recovery.clone(),
    })
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core keystore`
Expected: 8 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store/keystore.rs
git commit -m "feat(veri): keystore kurulumu, kilit acma ve parola degistirme"
```

---

### Task 6: Şema, migration'lar ve değiştirilemez erişim logu

KVKK Kurul Kararı 2018/10 erişim loglarının güvenliğini şart koşuyor. Logu uygulama katmanında korumak yetmez — veritabanı seviyesinde `UPDATE`/`DELETE` engellenir.

**Files:**
- Modify: `core/src/store/schema.rs`
- Test: aynı dosyanın test bloğu

**Interfaces:**
- Consumes: `store::db::open_encrypted`
- Produces:
  - `pub fn migrate(conn: &Connection) -> Result<(), rusqlite::Error>` — idempotent
  - `pub const CURRENT_VERSION: i64 = 1`

Bu planda yalnızca `audit_log` ve `app_meta` tabloları oluşturulur; `clients`, `appointments`, `progress_notes`, `private_notes` tabloları Plan 2 ve 3'ün migration'larıyla eklenecektir.

- [ ] **Step 1: Başarısız testleri yaz**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::db::open_encrypted;

    fn baglanti() -> (tempfile::TempDir, rusqlite::Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_encrypted(&dir.path().join("veri.db"), &generate_data_key()).unwrap();
        migrate(&conn).unwrap();
        (dir, conn)
    }

    #[test]
    fn migration_surumu_kaydeder() {
        let (_d, c) = baglanti();
        let v: i64 = c
            .query_row("SELECT deger FROM app_meta WHERE anahtar='schema_version'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, CURRENT_VERSION);
    }

    #[test]
    fn migration_iki_kez_calisabilir() {
        let (_d, c) = baglanti();
        migrate(&c).unwrap();
        migrate(&c).unwrap();
    }

    #[test]
    fn audit_log_guncellenemez() {
        let (_d, c) = baglanti();
        c.execute(
            "INSERT INTO audit_log (olay_zamani, eylem, varlik, varlik_id, cihaz)
             VALUES ('2026-09-07T10:00:00Z','goruntuleme','client','1','masaustu')",
            [],
        )
        .unwrap();

        let hata = c.execute("UPDATE audit_log SET eylem='silme'", []).unwrap_err();
        assert!(hata.to_string().contains("erisim logu degistirilemez"));
    }

    #[test]
    fn audit_log_silinemez() {
        let (_d, c) = baglanti();
        c.execute(
            "INSERT INTO audit_log (olay_zamani, eylem, varlik, varlik_id, cihaz)
             VALUES ('2026-09-07T10:00:00Z','goruntuleme','client','1','masaustu')",
            [],
        )
        .unwrap();

        let hata = c.execute("DELETE FROM audit_log", []).unwrap_err();
        assert!(hata.to_string().contains("erisim logu silinemez"));
    }
}
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core schema`
Expected: derleme hatası — `migrate` tanımlı değil.

- [ ] **Step 3: Minimum uygulamayı yaz**

```rust
use rusqlite::Connection;

pub const CURRENT_VERSION: i64 = 1;

const V1: &str = r#"
CREATE TABLE IF NOT EXISTS app_meta (
    anahtar TEXT PRIMARY KEY,
    deger   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    olay_zamani  TEXT NOT NULL,
    eylem        TEXT NOT NULL,
    varlik       TEXT NOT NULL,
    varlik_id    TEXT NOT NULL,
    cihaz        TEXT NOT NULL,
    ayrinti      TEXT
);

CREATE INDEX IF NOT EXISTS ix_audit_zaman ON audit_log(olay_zamani);

-- KVKK 2018/10: erisim logu degistirilemez olmali.
CREATE TRIGGER IF NOT EXISTS audit_log_guncelleme_yasak
BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'erisim logu degistirilemez');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_silme_yasak
BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'erisim logu silinemez');
END;
"#;

pub fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(V1)?;
    conn.execute(
        "INSERT INTO app_meta (anahtar, deger) VALUES ('schema_version', ?1)
         ON CONFLICT(anahtar) DO UPDATE SET deger = excluded.deger",
        [CURRENT_VERSION.to_string()],
    )?;
    Ok(())
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core schema`
Expected: 4 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store/schema.rs
git commit -m "feat(veri): sema migration'lari ve degistirilemez erisim logu"
```

---

### Task 7: Erişim logu yazma katmanı

**Files:**
- Modify: `core/src/store/audit.rs`
- Test: aynı dosyanın test bloğu

**Interfaces:**
- Consumes: `rusqlite::Connection`
- Produces:
  - `pub enum Eylem { Goruntuleme, Duzenleme, Ekleme, Silme, DisaAktarma, Giris, Cikis }` (`as_str()` uygular)
  - `pub enum Cihaz { Masaustu, Telefon }` (`as_str()` uygular)
  - `pub fn kaydet(conn: &Connection, eylem: Eylem, varlik: &str, varlik_id: &str, cihaz: Cihaz, ayrinti: Option<&str>) -> Result<(), rusqlite::Error>`
  - `pub struct AuditKaydi { pub olay_zamani: String, pub eylem: String, pub varlik: String, pub varlik_id: String, pub cihaz: String, pub ayrinti: Option<String> }`
  - `pub fn son_kayitlar(conn: &Connection, limit: i64) -> Result<Vec<AuditKaydi>, rusqlite::Error>`

- [ ] **Step 1: Başarısız testleri yaz**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{db::open_encrypted, schema::migrate};

    fn baglanti() -> (tempfile::TempDir, rusqlite::Connection) {
        let dir = tempfile::tempdir().unwrap();
        let c = open_encrypted(&dir.path().join("v.db"), &generate_data_key()).unwrap();
        migrate(&c).unwrap();
        (dir, c)
    }

    #[test]
    fn kaydedilen_olay_geri_okunur() {
        let (_d, c) = baglanti();
        kaydet(&c, Eylem::Goruntuleme, "client", "42", Cihaz::Masaustu, None).unwrap();

        let kayitlar = son_kayitlar(&c, 10).unwrap();
        assert_eq!(kayitlar.len(), 1);
        assert_eq!(kayitlar[0].eylem, "goruntuleme");
        assert_eq!(kayitlar[0].varlik, "client");
        assert_eq!(kayitlar[0].varlik_id, "42");
        assert_eq!(kayitlar[0].cihaz, "masaustu");
    }

    #[test]
    fn olay_zamani_iso8601_utc_biciminde() {
        let (_d, c) = baglanti();
        kaydet(&c, Eylem::Giris, "session", "-", Cihaz::Masaustu, None).unwrap();
        let z = &son_kayitlar(&c, 1).unwrap()[0].olay_zamani;
        assert!(z.ends_with('Z'), "zaman UTC olmali: {z}");
        assert_eq!(z.len(), 20, "ornek: 2026-09-07T10:00:00Z");
    }

    #[test]
    fn kayitlar_en_yeniden_eskiye_siralanir() {
        let (_d, c) = baglanti();
        kaydet(&c, Eylem::Giris, "session", "1", Cihaz::Masaustu, None).unwrap();
        kaydet(&c, Eylem::Cikis, "session", "2", Cihaz::Masaustu, None).unwrap();
        let k = son_kayitlar(&c, 10).unwrap();
        assert_eq!(k[0].varlik_id, "2");
    }

    #[test]
    fn ayrinti_alani_saklanir() {
        let (_d, c) = baglanti();
        kaydet(&c, Eylem::DisaAktarma, "client", "7", Cihaz::Masaustu, Some("veri raporu")).unwrap();
        assert_eq!(son_kayitlar(&c, 1).unwrap()[0].ayrinti.as_deref(), Some("veri raporu"));
    }
}
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core audit`
Expected: derleme hatası.

- [ ] **Step 3: Minimum uygulamayı yaz**

`core/Cargo.toml` içine `time` zaten workspace'ten geliyor; formatlama için `time` özelliği `formatting` aktif olmalı (Task 1'de ayarlandı).

```rust
use rusqlite::Connection;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Debug, Clone, Copy)]
pub enum Eylem {
    Goruntuleme,
    Duzenleme,
    Ekleme,
    Silme,
    DisaAktarma,
    Giris,
    Cikis,
}

impl Eylem {
    pub fn as_str(self) -> &'static str {
        match self {
            Eylem::Goruntuleme => "goruntuleme",
            Eylem::Duzenleme => "duzenleme",
            Eylem::Ekleme => "ekleme",
            Eylem::Silme => "silme",
            Eylem::DisaAktarma => "disa_aktarma",
            Eylem::Giris => "giris",
            Eylem::Cikis => "cikis",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum Cihaz {
    Masaustu,
    Telefon,
}

impl Cihaz {
    pub fn as_str(self) -> &'static str {
        match self {
            Cihaz::Masaustu => "masaustu",
            Cihaz::Telefon => "telefon",
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AuditKaydi {
    pub olay_zamani: String,
    pub eylem: String,
    pub varlik: String,
    pub varlik_id: String,
    pub cihaz: String,
    pub ayrinti: Option<String>,
}

fn simdi_utc() -> String {
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .expect("nanosaniye sifirlanamadi")
        .format(&Rfc3339)
        .expect("zaman bicimlendirilemedi")
}

pub fn kaydet(
    conn: &Connection,
    eylem: Eylem,
    varlik: &str,
    varlik_id: &str,
    cihaz: Cihaz,
    ayrinti: Option<&str>,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO audit_log (olay_zamani, eylem, varlik, varlik_id, cihaz, ayrinti)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![simdi_utc(), eylem.as_str(), varlik, varlik_id, cihaz.as_str(), ayrinti],
    )?;
    Ok(())
}

pub fn son_kayitlar(conn: &Connection, limit: i64) -> Result<Vec<AuditKaydi>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT olay_zamani, eylem, varlik, varlik_id, cihaz, ayrinti
         FROM audit_log ORDER BY id DESC LIMIT ?1",
    )?;
    let kayitlar = stmt
        .query_map([limit], |r| {
            Ok(AuditKaydi {
                olay_zamani: r.get(0)?,
                eylem: r.get(1)?,
                varlik: r.get(2)?,
                varlik_id: r.get(3)?,
                cihaz: r.get(4)?,
                ayrinti: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(kayitlar)
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core audit`
Expected: 4 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/store/audit.rs core/Cargo.toml
git commit -m "feat(veri): erisim logu yazma ve okuma katmani"
```

---

### Task 8: Yedekleme — 7 gün dönüşümlü, bütünlük kontrollü

**Files:**
- Create: `core/src/backup.rs`
- Modify: `core/src/lib.rs` (`pub mod backup;` ekle)
- Test: `core/src/backup.rs` test bloğu

**Interfaces:**
- Consumes: `store::db::open_encrypted`, `crypto::keyring::DataKey`
- Produces:
  - `pub const SAKLANAN_YEDEK_SAYISI: usize = 7`
  - `pub struct YedekBilgisi { pub yol: PathBuf, pub tarih: String, pub boyut: u64 }`
  - `pub fn yedek_al(db_yolu: &Path, hedef_dizin: &Path, damga: &str) -> Result<YedekBilgisi, YedekHatasi>`
  - `pub fn yedekleri_listele(hedef_dizin: &Path) -> Result<Vec<YedekBilgisi>, YedekHatasi>` — en yeniden eskiye
  - `pub fn geri_yukle(yedek_yolu: &Path, db_yolu: &Path, key: &DataKey) -> Result<(), YedekHatasi>`
  - `pub enum YedekHatasi { Io(std::io::Error), BozukYedek, Db(DbError) }`

Yedek dosyası zaten SQLCipher ile şifreli olduğundan **ek şifreleme yapılmaz**; dosya olduğu gibi kopyalanır. Dosya adı `yedek-YYYY-AA-GG.db` biçimindedir, bu yüzden aynı günün ikinci yedeği öncekinin üzerine yazar ve doğal olarak 7 gün penceresi oluşur.

- [ ] **Step 1: Başarısız testleri yaz**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keyring::generate_data_key;
    use crate::store::{db::open_encrypted, schema::migrate};

    fn ornek_db(dir: &Path, key: &crate::crypto::keyring::DataKey) -> PathBuf {
        let yol = dir.join("veri.db");
        let c = open_encrypted(&yol, key).unwrap();
        migrate(&c).unwrap();
        c.execute_batch("CREATE TABLE t(ad TEXT); INSERT INTO t VALUES ('Ayse');").unwrap();
        drop(c);
        yol
    }

    #[test]
    fn yedek_alinir_ve_ayni_anahtarla_acilir() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);

        let bilgi = yedek_al(&db, &hedef, "2026-09-07").unwrap();
        assert!(bilgi.yol.exists());
        assert!(bilgi.boyut > 0);

        let c = open_encrypted(&bilgi.yol, &key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse");
    }

    #[test]
    fn yediden_fazla_yedek_birikmez_en_eski_silinir() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);

        for gun in 1..=10 {
            yedek_al(&db, &hedef, &format!("2026-09-{gun:02}")).unwrap();
        }

        let liste = yedekleri_listele(&hedef).unwrap();
        assert_eq!(liste.len(), SAKLANAN_YEDEK_SAYISI);
        assert_eq!(liste[0].tarih, "2026-09-10", "en yeni basta olmali");
        assert_eq!(liste[6].tarih, "2026-09-04", "8 gun oncesi silinmis olmali");
    }

    #[test]
    fn ayni_gun_iki_kez_yedek_alinca_tek_dosya_kalir() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);

        yedek_al(&db, &hedef, "2026-09-07").unwrap();
        yedek_al(&db, &hedef, "2026-09-07").unwrap();
        assert_eq!(yedekleri_listele(&hedef).unwrap().len(), 1);
    }

    #[test]
    fn bozuk_yedek_geri_yuklenmez_ve_mevcut_veri_korunur() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let bilgi = yedek_al(&db, &hedef, "2026-09-07").unwrap();

        std::fs::write(&bilgi.yol, b"bu bir veritabani degil").unwrap();
        let hata = geri_yukle(&bilgi.yol, &db, &key).unwrap_err();
        assert!(matches!(hata, YedekHatasi::BozukYedek));

        // Mevcut veritabani bozulmamis olmali.
        let c = open_encrypted(&db, &key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse");
    }

    #[test]
    fn geri_yukleme_veriyi_yedekteki_haline_dondurur() {
        let d = tempfile::tempdir().unwrap();
        let hedef = d.path().join("yedekler");
        let key = generate_data_key();
        let db = ornek_db(d.path(), &key);
        let bilgi = yedek_al(&db, &hedef, "2026-09-07").unwrap();

        {
            let c = open_encrypted(&db, &key).unwrap();
            c.execute("UPDATE t SET ad='Degistirildi'", []).unwrap();
        }

        geri_yukle(&bilgi.yol, &db, &key).unwrap();

        let c = open_encrypted(&db, &key).unwrap();
        let ad: String = c.query_row("SELECT ad FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(ad, "Ayse");
    }
}
```

Dördüncü test bu görevin can damarı: **geri yükleme, doğrulamadan önce mevcut veriye dokunmamalıdır.** Bozuk bir yedeği körlemesine kopyalamak, tek bir işlemde hem yedeği hem asıl veriyi kaybettirir.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core backup`
Expected: derleme hatası.

- [ ] **Step 3: Minimum uygulamayı yaz**

```rust
use crate::crypto::keyring::DataKey;
use crate::store::db::{open_encrypted, DbError};
use std::path::{Path, PathBuf};

pub const SAKLANAN_YEDEK_SAYISI: usize = 7;
const ONEK: &str = "yedek-";
const UZANTI: &str = "db";

#[derive(Debug, thiserror::Error)]
pub enum YedekHatasi {
    #[error("dosya hatasi: {0}")]
    Io(#[from] std::io::Error),
    #[error("yedek dosyasi okunamiyor veya bozuk")]
    BozukYedek,
    #[error("veritabani hatasi: {0}")]
    Db(#[from] DbError),
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct YedekBilgisi {
    pub yol: PathBuf,
    pub tarih: String,
    pub boyut: u64,
}

pub fn yedek_al(db_yolu: &Path, hedef_dizin: &Path, damga: &str) -> Result<YedekBilgisi, YedekHatasi> {
    std::fs::create_dir_all(hedef_dizin)?;
    let hedef = hedef_dizin.join(format!("{ONEK}{damga}.{UZANTI}"));

    // Once gecici dosyaya yaz, sonra tasi: yarim kalan kopya yedek gibi gorunmesin.
    let gecici = hedef.with_extension("part");
    std::fs::copy(db_yolu, &gecici)?;
    std::fs::rename(&gecici, &hedef)?;

    eskileri_temizle(hedef_dizin)?;

    let boyut = std::fs::metadata(&hedef)?.len();
    Ok(YedekBilgisi { yol: hedef, tarih: damga.to_string(), boyut })
}

pub fn yedekleri_listele(hedef_dizin: &Path) -> Result<Vec<YedekBilgisi>, YedekHatasi> {
    if !hedef_dizin.exists() {
        return Ok(Vec::new());
    }
    let mut liste = Vec::new();
    for girdi in std::fs::read_dir(hedef_dizin)? {
        let girdi = girdi?;
        let yol = girdi.path();
        let Some(ad) = yol.file_name().and_then(|s| s.to_str()) else { continue };
        let Some(tarih) = ad.strip_prefix(ONEK).and_then(|s| s.strip_suffix(&format!(".{UZANTI}")))
        else {
            continue;
        };
        liste.push(YedekBilgisi {
            yol: yol.clone(),
            tarih: tarih.to_string(),
            boyut: girdi.metadata()?.len(),
        });
    }
    // Dosya adindaki tarih ISO oldugu icin metin siralamasi tarih siralamasidir.
    liste.sort_by(|a, b| b.tarih.cmp(&a.tarih));
    Ok(liste)
}

fn eskileri_temizle(hedef_dizin: &Path) -> Result<(), YedekHatasi> {
    let liste = yedekleri_listele(hedef_dizin)?;
    for eski in liste.iter().skip(SAKLANAN_YEDEK_SAYISI) {
        std::fs::remove_file(&eski.yol)?;
    }
    Ok(())
}

pub fn geri_yukle(yedek_yolu: &Path, db_yolu: &Path, key: &DataKey) -> Result<(), YedekHatasi> {
    // Once yedegin gercekten acilabildigini dogrula; ancak ondan sonra uzerine yaz.
    match open_encrypted(yedek_yolu, key) {
        Ok(c) => {
            c.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))
                .map_err(|_| YedekHatasi::BozukYedek)?;
        }
        Err(_) => return Err(YedekHatasi::BozukYedek),
    }

    let gecici = db_yolu.with_extension("restore");
    std::fs::copy(yedek_yolu, &gecici)?;
    std::fs::rename(&gecici, db_yolu)?;

    // WAL dosyalari eski veritabanina aitti, birakilirsa tutarsizlik uretir.
    for ek in ["db-wal", "db-shm"] {
        let _ = std::fs::remove_file(db_yolu.with_extension(ek));
    }
    Ok(())
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core backup`
Expected: 5 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/backup.rs core/src/lib.rs
git commit -m "feat(yedek): 7 gun donusumlu yedek, dogrulamali geri yukleme"
```

---

### Task 9: Oturum — açık anahtar tutma ve boşta kalma kilidi

**Files:**
- Create: `core/src/session.rs`
- Modify: `core/src/lib.rs` (`pub mod session;`)
- Test: `core/src/session.rs` test bloğu

**Interfaces:**
- Consumes: `crypto::keyring::DataKey`
- Produces:
  - `pub const VARSAYILAN_KILIT_SURESI_SN: u64 = 300`
  - `pub struct Oturum` — `Oturum::kapali()`, `ac(DataKey, now: Instant)`, `kilitle()`, `acik_mi(now: Instant) -> bool`, `anahtar(now: Instant) -> Option<DataKey>`, `dokun(now: Instant)`, `kilit_suresi_ayarla(sn: u64)`
  - Zaman `Instant` olarak **dışarıdan verilir**; böylece testler `sleep` beklemeden çalışır.

- [ ] **Step 1: Başarısız testleri yaz**

```rust
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
}
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-core session`
Expected: derleme hatası.

- [ ] **Step 3: Minimum uygulamayı yaz**

```rust
use crate::crypto::keyring::DataKey;
use std::time::{Duration, Instant};

pub const VARSAYILAN_KILIT_SURESI_SN: u64 = 300;

pub struct Oturum {
    anahtar: Option<DataKey>,
    son_islem: Option<Instant>,
    kilit_suresi: Duration,
}

impl Oturum {
    pub fn kapali() -> Self {
        Self {
            anahtar: None,
            son_islem: None,
            kilit_suresi: Duration::from_secs(VARSAYILAN_KILIT_SURESI_SN),
        }
    }

    pub fn kilit_suresi_ayarla(&mut self, sn: u64) {
        self.kilit_suresi = Duration::from_secs(sn);
    }

    pub fn ac(&mut self, anahtar: DataKey, now: Instant) {
        self.anahtar = Some(anahtar);
        self.son_islem = Some(now);
    }

    pub fn kilitle(&mut self) {
        // DataKey = Zeroizing<..>, dusurulunce bellek sifirlanir.
        self.anahtar = None;
        self.son_islem = None;
    }

    pub fn acik_mi(&self, now: Instant) -> bool {
        match (&self.anahtar, self.son_islem) {
            (Some(_), Some(son)) => now.duration_since(son) <= self.kilit_suresi,
            _ => false,
        }
    }

    pub fn dokun(&mut self, now: Instant) {
        if self.acik_mi(now) {
            self.son_islem = Some(now);
        }
    }

    pub fn anahtar(&self, now: Instant) -> Option<DataKey> {
        if self.acik_mi(now) {
            self.anahtar.clone()
        } else {
            None
        }
    }
}
```

`DataKey`'in `clone()` edilebilmesi için `Zeroizing<[u8;32]>` zaten `Clone` uygular.

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-core session`
Expected: 6 test PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/session.rs core/src/lib.rs
git commit -m "feat(oturum): bellekte anahtar tutma ve bosta kalma kilidi"
```

---

### Task 10: HTTP API — kurulum, kilit açma, kilitleme

**Files:**
- Create: `server/Cargo.toml`, `server/src/lib.rs`, `server/src/state.rs`, `server/src/routes/mod.rs`, `server/src/routes/setup.rs`, `server/src/routes/session.rs`
- Test: `server/tests/api.rs`

**Interfaces:**
- Consumes: `psikolog_core::{crypto::keyring::KdfParams, store::keystore, store::db, store::schema, store::audit, session::Oturum}`
- Produces:
  - `pub struct AppState { pub veri_dizini: PathBuf, pub oturum: Arc<Mutex<Oturum>>, pub kdf: KdfParams }`
  - `pub fn router(state: AppState) -> axum::Router`
  - Uç noktalar:
    - `GET  /api/durum` → `{ "kurulum_gerekli": bool, "kilitli": bool }`
    - `POST /api/kurulum` gövde `{ "parola": string }` → `201 { "kurtarma_kodu": string }`; kurulum zaten yapılmışsa `409`
    - `POST /api/kilit-ac` gövde `{ "parola": string }` veya `{ "kurtarma_kodu": string }` → `200 {}` / `401 { "hata": "..." }`
    - `POST /api/kilitle` → `200 {}`

`server/Cargo.toml`:

```toml
[package]
name = "psikolog-server"
version.workspace = true
edition.workspace = true

[dependencies]
psikolog-core = { path = "../core" }
axum = "0.8"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "net"] }
tower = "0.5"
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true

[dev-dependencies]
tempfile = "3"
http-body-util = "0.1"
tower = { version = "0.5", features = ["util"] }
```

- [ ] **Step 1: Başarısız testleri yaz**

`server/tests/api.rs`:

```rust
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use psikolog_core::crypto::keyring::KdfParams;
use psikolog_server::{router, AppState};
use tower::ServiceExt;

fn test_state() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::yeni(dir.path().to_path_buf(), KdfParams { m_cost: 8, t_cost: 1, p_cost: 1 });
    (dir, state)
}

async fn cagir(state: &AppState, method: &str, yol: &str, govde: Option<serde_json::Value>) -> (StatusCode, serde_json::Value) {
    let istek = Request::builder()
        .method(method)
        .uri(yol)
        .header("content-type", "application/json")
        .body(match govde {
            Some(v) => Body::from(v.to_string()),
            None => Body::empty(),
        })
        .unwrap();

    let yanit = router(state.clone()).oneshot(istek).await.unwrap();
    let kod = yanit.status();
    let bytes = yanit.into_body().collect().await.unwrap().to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(serde_json::json!({}));
    (kod, json)
}

#[tokio::test]
async fn ilk_acilista_kurulum_gerekli_bildirilir() {
    let (_d, s) = test_state();
    let (kod, json) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(kod, StatusCode::OK);
    assert_eq!(json["kurulum_gerekli"], true);
    assert_eq!(json["kilitli"], true);
}

#[tokio::test]
async fn kurulum_kurtarma_kodu_dondurur_ve_oturumu_acar() {
    let (_d, s) = test_state();
    let (kod, json) = cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    assert_eq!(kod, StatusCode::CREATED);

    let kurtarma = json["kurtarma_kodu"].as_str().unwrap();
    assert_eq!(kurtarma.split('-').count(), 5);

    let (_, durum) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(durum["kurulum_gerekli"], false);
    assert_eq!(durum["kilitli"], false, "kurulum sonrasi oturum acik olmali");
}

#[tokio::test]
async fn ikinci_kurulum_reddedilir() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    let (kod, _) = cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"baska"}))).await;
    assert_eq!(kod, StatusCode::CONFLICT);
}

#[tokio::test]
async fn dogru_parola_kilidi_acar() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, _) = cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"parola":"gizli123"}))).await;
    assert_eq!(kod, StatusCode::OK);

    let (_, durum) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(durum["kilitli"], false);
}

#[tokio::test]
async fn yanlis_parola_401_dondurur_ve_kilitli_kalir() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, json) = cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"parola":"yanlis"}))).await;
    assert_eq!(kod, StatusCode::UNAUTHORIZED);
    assert!(json["hata"].as_str().unwrap().contains("hatali"));

    let (_, durum) = cagir(&s, "GET", "/api/durum", None).await;
    assert_eq!(durum["kilitli"], true);
}

#[tokio::test]
async fn kurtarma_koduyla_kilit_acilir() {
    let (_d, s) = test_state();
    let (_, json) = cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    let kurtarma = json["kurtarma_kodu"].as_str().unwrap().to_string();
    cagir(&s, "POST", "/api/kilitle", None).await;

    let (kod, _) = cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"kurtarma_kodu": kurtarma}))).await;
    assert_eq!(kod, StatusCode::OK);
}

#[tokio::test]
async fn giris_ve_cikis_erisim_loguna_yazilir() {
    let (_d, s) = test_state();
    cagir(&s, "POST", "/api/kurulum", Some(serde_json::json!({"parola":"gizli123"}))).await;
    cagir(&s, "POST", "/api/kilitle", None).await;
    cagir(&s, "POST", "/api/kilit-ac", Some(serde_json::json!({"parola":"gizli123"}))).await;

    let kayitlar = s.audit_dokumu().unwrap();
    let eylemler: Vec<&str> = kayitlar.iter().map(|k| k.eylem.as_str()).collect();
    assert!(eylemler.contains(&"giris"));
    assert!(eylemler.contains(&"cikis"));
}
```

Son test için `AppState`'e bir yardımcı gerekir:
`pub fn audit_dokumu(&self) -> anyhow::Result<Vec<AuditKaydi>>` — açık oturumun anahtarıyla veritabanını açıp `son_kayitlar(&conn, 50)` döndürür.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `cargo test -p psikolog-server`
Expected: derleme hatası — `psikolog_server` crate'i boş.

- [ ] **Step 3: Minimum uygulamayı yaz**

`server/src/state.rs`:

```rust
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

    pub fn acik_anahtar(&self) -> Option<DataKey> {
        self.oturum.lock().unwrap().anahtar(Instant::now())
    }

    pub fn audit_dokumu(&self) -> anyhow::Result<Vec<AuditKaydi>> {
        let key = self.acik_anahtar().ok_or_else(|| anyhow::anyhow!("oturum kilitli"))?;
        let conn = psikolog_core::store::db::open_encrypted(&self.db_yolu(), &key)?;
        Ok(psikolog_core::store::audit::son_kayitlar(&conn, 50)?)
    }
}
```

`server/Cargo.toml`'a `anyhow.workspace = true` ekle.

`server/src/routes/session.rs`:

```rust
use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use psikolog_core::store::{
    audit::{kaydet, Cihaz, Eylem},
    db::open_encrypted,
    keystore,
    schema::migrate,
};
use serde::Deserialize;
use serde_json::json;
use std::time::Instant;

#[derive(Deserialize)]
pub struct KilitAcIstegi {
    pub parola: Option<String>,
    pub kurtarma_kodu: Option<String>,
}

pub async fn durum(State(s): State<AppState>) -> Json<serde_json::Value> {
    let kurulum_gerekli = !keystore::exists(&s.keystore_yolu());
    let kilitli = s.acik_anahtar().is_none();
    Json(json!({ "kurulum_gerekli": kurulum_gerekli, "kilitli": kilitli }))
}

pub async fn kilit_ac(
    State(s): State<AppState>,
    Json(istek): Json<KilitAcIstegi>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Ok(ks) = keystore::load(&s.keystore_yolu()) else {
        return (StatusCode::CONFLICT, Json(json!({ "hata": "once kurulum yapilmali" })));
    };

    let sonuc = match (&istek.parola, &istek.kurtarma_kodu) {
        (Some(p), _) => keystore::unlock_with_password(&ks, p),
        (_, Some(k)) => keystore::unlock_with_recovery(&ks, k),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "hata": "parola girilmedi" }))),
    };

    match sonuc {
        Ok(key) => {
            let conn = match open_encrypted(&s.db_yolu(), &key) {
                Ok(c) => c,
                Err(e) => {
                    return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })))
                }
            };
            let _ = migrate(&conn);
            let _ = kaydet(&conn, Eylem::Giris, "session", "-", Cihaz::Masaustu, None);
            s.oturum.lock().unwrap().ac(key, Instant::now());
            (StatusCode::OK, Json(json!({})))
        }
        Err(_) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "hata": "Parola veya kurtarma kodu hatali." })),
        ),
    }
}

pub async fn kilitle(State(s): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    if let Some(key) = s.acik_anahtar() {
        if let Ok(conn) = open_encrypted(&s.db_yolu(), &key) {
            let _ = kaydet(&conn, Eylem::Cikis, "session", "-", Cihaz::Masaustu, None);
        }
    }
    s.oturum.lock().unwrap().kilitle();
    (StatusCode::OK, Json(json!({})))
}
```

`server/src/routes/setup.rs`:

```rust
use crate::state::AppState;
use axum::{extract::State, http::StatusCode, Json};
use psikolog_core::store::{
    audit::{kaydet, Cihaz, Eylem},
    db::open_encrypted,
    keystore,
    schema::migrate,
};
use serde::Deserialize;
use serde_json::json;
use std::time::Instant;

#[derive(Deserialize)]
pub struct KurulumIstegi {
    pub parola: String,
}

pub async fn kurulum(
    State(s): State<AppState>,
    Json(istek): Json<KurulumIstegi>,
) -> (StatusCode, Json<serde_json::Value>) {
    if keystore::exists(&s.keystore_yolu()) {
        return (StatusCode::CONFLICT, Json(json!({ "hata": "kurulum zaten yapilmis" })));
    }
    if istek.parola.chars().count() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "hata": "Parola en az 8 karakter olmali." })),
        );
    }

    let kurulum = match keystore::create(&istek.parola, s.kdf) {
        Ok(k) => k,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })))
        }
    };
    if let Err(e) = keystore::save(&kurulum.keystore, &s.keystore_yolu()) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })));
    }

    let conn = match open_encrypted(&s.db_yolu(), &kurulum.data_key) {
        Ok(c) => c,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })))
        }
    };
    if let Err(e) = migrate(&conn) {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "hata": e.to_string() })));
    }
    let _ = kaydet(&conn, Eylem::Giris, "session", "-", Cihaz::Masaustu, Some("ilk kurulum"));

    s.oturum.lock().unwrap().ac(kurulum.data_key, Instant::now());
    (StatusCode::CREATED, Json(json!({ "kurtarma_kodu": kurulum.recovery_code })))
}
```

`server/src/routes/mod.rs`:

```rust
pub mod session;
pub mod setup;
```

`server/src/lib.rs`:

```rust
pub mod routes;
pub mod state;

pub use state::AppState;

use axum::{
    routing::{get, post},
    Router,
};

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/durum", get(routes::session::durum))
        .route("/api/kurulum", post(routes::setup::kurulum))
        .route("/api/kilit-ac", post(routes::session::kilit_ac))
        .route("/api/kilitle", post(routes::session::kilitle))
        .with_state(state)
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `cargo test -p psikolog-server`
Expected: 7 test PASS.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(api): kurulum, kilit acma ve kilitleme uc noktalari"
```

---

### Task 11: Kurulum sihirbazı ve kilit ekranı (React)

**Files:**
- Create: `web/src/api.ts`, `web/src/App.tsx`, `web/src/screens/KurulumSihirbazi.tsx`, `web/src/screens/KilitEkrani.tsx`, `web/src/screens/AnaEkran.tsx`
- Modify: `web/src/main.tsx`, `web/index.html`
- Test: `web/src/screens/KurulumSihirbazi.test.tsx`

**Interfaces:**
- Consumes: Task 10'un uç noktaları
- Produces:
  - `api.durumAl(): Promise<{ kurulum_gerekli: boolean; kilitli: boolean }>`
  - `api.kurulumYap(parola: string): Promise<{ kurtarma_kodu: string }>`
  - `api.kilitAc(girdi: { parola?: string; kurtarma_kodu?: string }): Promise<void>` — hata durumunda sunucunun `hata` metniyle `throw`
  - `api.kilitle(): Promise<void>`

- [ ] **Step 1: Test altyapısını kur ve başarısız testi yaz**

```bash
npm --prefix web install -D vitest @testing-library/react @testing-library/user-event jsdom @vitejs/plugin-react
```

`web/vite.config.ts` içine ekle:

```ts
  test: { environment: 'jsdom', globals: true },
```

`web/package.json` betiklerine ekle: `"test": "vitest run"`.

`web/src/screens/KurulumSihirbazi.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { KurulumSihirbazi } from './KurulumSihirbazi'

describe('KurulumSihirbazi', () => {
  it('kisa parolayi reddeder ve sunucuya gitmez', async () => {
    const kurulumYap = vi.fn()
    render(<KurulumSihirbazi kurulumYap={kurulumYap} onTamam={() => {}} />)

    await userEvent.type(screen.getByLabelText('Ana parola'), 'kisa')
    await userEvent.type(screen.getByLabelText('Parola tekrar'), 'kisa')
    await userEvent.click(screen.getByRole('button', { name: 'Devam et' }))

    expect(screen.getByText(/en az 8 karakter/i)).toBeDefined()
    expect(kurulumYap).not.toHaveBeenCalled()
  })

  it('parolalar eslesmezse uyarir', async () => {
    const kurulumYap = vi.fn()
    render(<KurulumSihirbazi kurulumYap={kurulumYap} onTamam={() => {}} />)

    await userEvent.type(screen.getByLabelText('Ana parola'), 'gizliparola')
    await userEvent.type(screen.getByLabelText('Parola tekrar'), 'baskaparola')
    await userEvent.click(screen.getByRole('button', { name: 'Devam et' }))

    expect(screen.getByText(/ayni degil/i)).toBeDefined()
    expect(kurulumYap).not.toHaveBeenCalled()
  })

  it('kurtarma kodunu gosterir ve onaylanmadan devam ettirmez', async () => {
    const kurulumYap = vi.fn().mockResolvedValue({ kurtarma_kodu: 'ABCDE-FGHJK-MNPQR-STVWX-YZ234' })
    const onTamam = vi.fn()
    render(<KurulumSihirbazi kurulumYap={kurulumYap} onTamam={onTamam} />)

    await userEvent.type(screen.getByLabelText('Ana parola'), 'gizliparola')
    await userEvent.type(screen.getByLabelText('Parola tekrar'), 'gizliparola')
    await userEvent.click(screen.getByRole('button', { name: 'Devam et' }))

    expect(await screen.findByText('ABCDE-FGHJK-MNPQR-STVWX-YZ234')).toBeDefined()

    const devam = screen.getByRole('button', { name: 'Kurulumu bitir' })
    expect(devam.hasAttribute('disabled')).toBe(true)

    await userEvent.click(screen.getByLabelText(/kurtarma kodunu kaydettim/i))
    expect(devam.hasAttribute('disabled')).toBe(false)

    await userEvent.click(devam)
    expect(onTamam).toHaveBeenCalled()
  })
})
```

Üçüncü test ürün açısından kritik: kullanıcı kurtarma kodunu **görmeden ve onaylamadan** kuruluma devam edememelidir; aksi hâlde parolasını unuttuğunda verisi gider.

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `npm --prefix web run test`
Expected: FAIL — `KurulumSihirbazi` modülü bulunamıyor.

- [ ] **Step 3: Minimum uygulamayı yaz**

`web/src/screens/KurulumSihirbazi.tsx`:

```tsx
import { useState } from 'react'

type Props = {
  kurulumYap: (parola: string) => Promise<{ kurtarma_kodu: string }>
  onTamam: () => void
}

export function KurulumSihirbazi({ kurulumYap, onTamam }: Props) {
  const [parola, setParola] = useState('')
  const [tekrar, setTekrar] = useState('')
  const [hata, setHata] = useState<string | null>(null)
  const [kurtarmaKodu, setKurtarmaKodu] = useState<string | null>(null)
  const [onaylandi, setOnaylandi] = useState(false)

  async function devamEt() {
    if (parola.length < 8) return setHata('Parola en az 8 karakter olmalı.')
    if (parola !== tekrar) return setHata('Girdiğiniz iki parola aynı değil.')
    setHata(null)
    try {
      const sonuc = await kurulumYap(parola)
      setKurtarmaKodu(sonuc.kurtarma_kodu)
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'Kurulum yapılamadı.')
    }
  }

  if (kurtarmaKodu) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h1 className="text-2xl font-semibold">Kurtarma kodunuz</h1>
        <p className="mt-3 text-sm text-slate-600">
          Parolanızı unutursanız verilerinize erişmenin <strong>tek yolu</strong> bu koddur.
          Yazdırıp güvenli bir yerde saklayın. Bu kod bir daha gösterilmeyecek.
        </p>
        <p className="my-6 rounded-lg bg-slate-100 p-4 text-center font-mono text-lg tracking-wider">
          {kurtarmaKodu}
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={onaylandi}
            onChange={(e) => setOnaylandi(e.target.checked)}
          />
          <span>Kurtarma kodunu kaydettim, güvenli bir yerde duruyor.</span>
        </label>
        <button
          className="mt-6 w-full rounded-lg bg-slate-900 py-2 text-white disabled:opacity-40"
          disabled={!onaylandi}
          onClick={onTamam}
        >
          Kurulumu bitir
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-semibold">Hoş geldiniz</h1>
      <p className="mt-3 text-sm text-slate-600">
        Bir ana parola belirleyin. Tüm kayıtlarınız bu parolayla şifrelenecek ve bu bilgisayardan
        hiçbir yere gönderilmeyecek.
      </p>

      <label className="mt-6 block text-sm" htmlFor="parola">Ana parola</label>
      <input
        id="parola"
        type="password"
        className="mt-1 w-full rounded-lg border p-2"
        value={parola}
        onChange={(e) => setParola(e.target.value)}
      />

      <label className="mt-4 block text-sm" htmlFor="tekrar">Parola tekrar</label>
      <input
        id="tekrar"
        type="password"
        className="mt-1 w-full rounded-lg border p-2"
        value={tekrar}
        onChange={(e) => setTekrar(e.target.value)}
      />

      {hata && <p className="mt-3 text-sm text-red-600">{hata}</p>}

      <button className="mt-6 w-full rounded-lg bg-slate-900 py-2 text-white" onClick={devamEt}>
        Devam et
      </button>
    </div>
  )
}
```

`web/src/api.ts`:

```ts
async function istek<T>(yol: string, secenekler?: RequestInit): Promise<T> {
  const yanit = await fetch(yol, {
    headers: { 'content-type': 'application/json' },
    ...secenekler,
  })
  const govde = await yanit.json().catch(() => ({}))
  if (!yanit.ok) throw new Error(govde.hata ?? 'Beklenmeyen bir hata oluştu.')
  return govde as T
}

export const api = {
  durumAl: () => istek<{ kurulum_gerekli: boolean; kilitli: boolean }>('/api/durum'),
  kurulumYap: (parola: string) =>
    istek<{ kurtarma_kodu: string }>('/api/kurulum', {
      method: 'POST',
      body: JSON.stringify({ parola }),
    }),
  kilitAc: (girdi: { parola?: string; kurtarma_kodu?: string }) =>
    istek<Record<string, never>>('/api/kilit-ac', {
      method: 'POST',
      body: JSON.stringify(girdi),
    }),
  kilitle: () => istek<Record<string, never>>('/api/kilitle', { method: 'POST' }),
}
```

`web/src/screens/KilitEkrani.tsx`:

```tsx
import { useState } from 'react'

type Props = {
  kilitAc: (girdi: { parola?: string; kurtarma_kodu?: string }) => Promise<unknown>
  onAcildi: () => void
}

export function KilitEkrani({ kilitAc, onAcildi }: Props) {
  const [parola, setParola] = useState('')
  const [kurtarmaModu, setKurtarmaModu] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const [bekliyor, setBekliyor] = useState(false)

  async function gonder(e: React.FormEvent) {
    e.preventDefault()
    setBekliyor(true)
    setHata(null)
    try {
      await kilitAc(kurtarmaModu ? { kurtarma_kodu: parola } : { parola })
      onAcildi()
    } catch (err) {
      setHata(err instanceof Error ? err.message : 'Açılamadı.')
    } finally {
      setBekliyor(false)
    }
  }

  return (
    <form className="mx-auto max-w-sm p-8" onSubmit={gonder}>
      <h1 className="text-xl font-semibold">Kilitli</h1>
      <label className="mt-6 block text-sm" htmlFor="giris">
        {kurtarmaModu ? 'Kurtarma kodu' : 'Ana parola'}
      </label>
      <input
        id="giris"
        type={kurtarmaModu ? 'text' : 'password'}
        autoFocus
        className="mt-1 w-full rounded-lg border p-2"
        value={parola}
        onChange={(e) => setParola(e.target.value)}
      />
      {hata && <p className="mt-3 text-sm text-red-600">{hata}</p>}
      <button
        type="submit"
        disabled={bekliyor}
        className="mt-6 w-full rounded-lg bg-slate-900 py-2 text-white disabled:opacity-40"
      >
        {bekliyor ? 'Açılıyor…' : 'Aç'}
      </button>
      <button
        type="button"
        className="mt-3 w-full text-sm text-slate-500 underline"
        onClick={() => { setKurtarmaModu(!kurtarmaModu); setParola(''); setHata(null) }}
      >
        {kurtarmaModu ? 'Parolayla gir' : 'Parolamı unuttum'}
      </button>
    </form>
  )
}
```

`web/src/screens/AnaEkran.tsx` (bu planda yalnızca kilidin açıldığını gösteren gövde; takvim Plan 2'de gelir):

```tsx
export function AnaEkran({ kilitle }: { kilitle: () => void }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">Terapi Notları</h1>
      <p className="mt-2 text-slate-600">Takvim burada olacak.</p>
      <button className="mt-6 rounded-lg border px-4 py-2" onClick={kilitle}>
        Kilitle
      </button>
    </div>
  )
}
```

`web/src/App.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { AnaEkran } from './screens/AnaEkran'
import { KilitEkrani } from './screens/KilitEkrani'
import { KurulumSihirbazi } from './screens/KurulumSihirbazi'

type Durum = { kurulum_gerekli: boolean; kilitli: boolean } | null

export default function App() {
  const [durum, setDurum] = useState<Durum>(null)

  const yenile = useCallback(async () => setDurum(await api.durumAl()), [])
  useEffect(() => { void yenile() }, [yenile])

  if (!durum) return <p className="p-8 text-slate-500">Yükleniyor…</p>
  if (durum.kurulum_gerekli) {
    return <KurulumSihirbazi kurulumYap={api.kurulumYap} onTamam={yenile} />
  }
  if (durum.kilitli) return <KilitEkrani kilitAc={api.kilitAc} onAcildi={yenile} />
  return <AnaEkran kilitle={async () => { await api.kilitle(); await yenile() }} />
}
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `npm --prefix web run test`
Expected: 3 test PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(arayuz): kurulum sihirbazi, kilit ekrani ve durum yonlendirmesi"
```

---

### Task 12: Tauri kabuğunu sunucuya bağlama ve uçtan uca test

**Files:**
- Modify: `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
- Create: `server/src/assets.rs`, `e2e/kurulum.spec.ts`, `playwright.config.ts`
- Modify: `server/src/lib.rs` (statik varlık rotası), `.github/workflows/ci.yml` (e2e adımı)

**Interfaces:**
- Consumes: `psikolog_server::{router, AppState}`
- Produces:
  - `pub fn sunucuyu_baslat(veri_dizini: PathBuf) -> u16` — boş port bulur, arka planda dinlemeye başlar, portu döndürür
  - `GET /` ve bilinmeyen yollar → gömülü `index.html` (SPA geri dönüşü)

- [ ] **Step 1: Başarısız uçtan uca testi yaz**

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:7700' },
  webServer: {
    command: 'cargo run -p psikolog-server --bin sunucu',
    url: 'http://127.0.0.1:7700/api/durum',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
```

`e2e/kurulum.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('kurulum, kilitleme ve tekrar acma', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Ana parola').fill('gizliparola')
  await page.getByLabel('Parola tekrar').fill('gizliparola')
  await page.getByRole('button', { name: 'Devam et' }).click()

  const kod = await page.locator('.font-mono').textContent()
  expect(kod).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/)

  await page.getByLabel(/kurtarma kodunu kaydettim/i).check()
  await page.getByRole('button', { name: 'Kurulumu bitir' }).click()

  await expect(page.getByRole('heading', { name: 'Terapi Notları' })).toBeVisible()

  await page.getByRole('button', { name: 'Kilitle' }).click()
  await expect(page.getByRole('heading', { name: 'Kilitli' })).toBeVisible()

  await page.getByLabel('Ana parola').fill('yanlisparola')
  await page.getByRole('button', { name: 'Aç' }).click()
  await expect(page.getByText(/hatali/i)).toBeVisible()

  await page.getByLabel('Ana parola').fill('gizliparola')
  await page.getByRole('button', { name: 'Aç' }).click()
  await expect(page.getByRole('heading', { name: 'Terapi Notları' })).toBeVisible()
})
```

Test için `psikolog-server` içinde `sunucu` adlı bir ikili gerekir: geçici bir veri dizini kullanır ve `7700` portunda dinler.

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Run: `npx playwright test`
Expected: FAIL — `sunucu` ikili hedefi yok, sunucu ayağa kalkmıyor.

- [ ] **Step 3: Statik varlıkları sun ve ikilileri yaz**

`server/Cargo.toml`'a ekle:

```toml
rust-embed = { version = "8", features = ["mime-guess"] }

[[bin]]
name = "sunucu"
path = "src/bin/sunucu.rs"
```

`server/src/assets.rs`:

```rust
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};

#[derive(rust_embed::Embed)]
#[folder = "../web/dist"]
struct Varliklar;

pub async fn statik(uri: Uri) -> Response {
    let yol = uri.path().trim_start_matches('/');
    let aday = if yol.is_empty() { "index.html" } else { yol };

    match Varliklar::get(aday) {
        Some(dosya) => (
            [(header::CONTENT_TYPE, dosya.metadata.mimetype())],
            dosya.data.into_owned(),
        )
            .into_response(),
        // SPA geri donusu: bilinmeyen yollar index.html'e duser.
        None => match Varliklar::get("index.html") {
            Some(d) => ([(header::CONTENT_TYPE, "text/html")], d.data.into_owned()).into_response(),
            None => (StatusCode::NOT_FOUND, "arayuz bulunamadi").into_response(),
        },
    }
}
```

`server/src/lib.rs`'i güncelle — `assets` modülünü tanıt ve router'a geri dönüş rotasını ekle:

```rust
pub mod assets;
pub mod routes;
pub mod state;

pub use state::AppState;

use axum::{
    routing::{get, post},
    Router,
};

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/durum", get(routes::session::durum))
        .route("/api/kurulum", post(routes::setup::kurulum))
        .route("/api/kilit-ac", post(routes::session::kilit_ac))
        .route("/api/kilitle", post(routes::session::kilitle))
        // API rotalari eslesmezse arayuz sunulur (SPA geri donusu).
        .fallback(assets::statik)
        .with_state(state)
}
```

`server/src/bin/sunucu.rs`:

```rust
use psikolog_core::crypto::keyring::KdfParams;
use psikolog_server::{router, AppState};

#[tokio::main]
async fn main() {
    let dizin = std::env::var("PSIKOLOG_VERI_DIZINI")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join("psikolog-e2e"));
    let _ = std::fs::remove_dir_all(&dizin);

    let state = AppState::yeni(dizin, KdfParams::default());
    let dinleyici = tokio::net::TcpListener::bind("127.0.0.1:7700").await.unwrap();
    axum::serve(dinleyici, router(state)).await.unwrap();
}
```

`src-tauri/Cargo.toml`'a `psikolog-server = { path = "../server" }` ve `tokio` ekle; `src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use psikolog_core::crypto::keyring::KdfParams;
use psikolog_server::{router, AppState};
use std::path::PathBuf;

fn veri_dizini() -> PathBuf {
    // macOS: ~/Library/Application Support/com.psikolog.notlar
    dirs::data_dir().expect("veri dizini bulunamadi").join("com.psikolog.notlar")
}

fn sunucuyu_baslat(veri_dizini: PathBuf) -> u16 {
    let dinleyici = std::net::TcpListener::bind("127.0.0.1:0").expect("port acilamadi");
    let port = dinleyici.local_addr().unwrap().port();

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("calisma zamani kurulamadi");
        rt.block_on(async move {
            let state = AppState::yeni(veri_dizini, KdfParams::default());
            let dinleyici = tokio::net::TcpListener::from_std(dinleyici).unwrap();
            axum::serve(dinleyici, router(state)).await.unwrap();
        });
    });

    port
}

fn main() {
    let port = sunucuyu_baslat(veri_dizini());
    let adres = format!("http://127.0.0.1:{port}");

    tauri::Builder::default()
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "ana",
                tauri::WebviewUrl::External(adres.parse().unwrap()),
            )
            .title("Terapi Notlari")
            .inner_size(1280.0, 820.0)
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("uygulama baslatilamadi");
}
```

`src-tauri/Cargo.toml` bağımlılıklarına `dirs = "5"` ekle. `tauri.conf.json` içindeki `app.windows` dizisini boşalt (`"windows": []`) — pencere artık kodda oluşturuluyor.

Not: `Varliklar` gömmesi `web/dist` dizininin var olmasını gerektirir; `cargo build` öncesi `npm --prefix web run build` çalıştırılmalıdır. CI'da bu sıra zaten kuruludur.

- [ ] **Step 4: Testin geçtiğini doğrula**

```bash
npm --prefix web run build
npx playwright install chromium
npx playwright test
```
Expected: 1 test PASS.

- [ ] **Step 5: CI'a uçtan uca adımı ekle**

`.github/workflows/ci.yml` içindeki `test` işine, **`cargo test --workspace` adımından sonra** (Playwright, derlenmiş `sunucu` ikilisini çalıştırır):

```yaml
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
```

Adım sırasını bozma: npm adımları → `cargo test` → Playwright. `web/dist`, Rust derlemesinden önce var olmak zorundadır.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(kabuk): Tauri penceresini gomulu sunucuya bagla, uctan uca test"
```

---

## Planın Bitiş Durumu

Bu plan tamamlandığında elde olan:

- macOS'ta çift tıklanınca açılan, ilk açılışta parola belirleten ve kurtarma kodu gösteren bir uygulama
- Diskte tamamen şifreli, düz metin sızdırmadığı testle kanıtlanmış bir veritabanı
- Değiştirilemezliği testle doğrulanmış erişim logu
- Yedek alma, listeleme ve **doğrulamadan üzerine yazmayan** geri yükleme
- Boşta kalınca kilitlenen oturum
- Her push'ta çalışan testler ve indirilebilir `.dmg` artefaktları

**Bu planda kasten yok:** danışan ve randevu tabloları (Plan 2), not editörü (Plan 3), telefon erişimi ve dışa aktarma (Plan 4), Touch ID ve Bonjour (Plan 4), günlük yedeğin zamanlayıcıyla otomatik tetiklenmesi (Plan 4 — bu planda yedek fonksiyonları hazır ama çağıran zamanlayıcı yok).

## Açık Soru

CI şu an iki mimariye de `.dmg` üretiyor. Psikoloğun Mac'i Apple Silicon ise `x86_64-apple-darwin` satırı kaldırılabilir ve CI süresi yarıya iner. Hedef makine öğrenilince karara bağlanmalı.
