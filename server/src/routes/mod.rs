pub mod appointments;
pub mod attachments;
/// Yedek **alma** ve yedek klasörü ayarı — kilit kapısının içinde.
pub mod backup;
pub mod clients;
/// Danışanın seans listesi (Plan 5 Görev 4) -- notu olsun olmasın TÜM
/// seanslar; kapının içinde.
pub mod danisan_seanslari;
pub mod notes;
/// Ay sonu özeti (Plan 4 Görev 3) — salt okur, kapının içinde.
pub mod ozet;
/// Parola değiştirme — kilit kapısının **içinde**, `session.rs`'ten ayrı
/// bir modül; gerekçe o modülün başlığında (özet: `session.rs` kapıyı
/// kullanmayan ve denetim satırını kendisi yazan bir modüldür, bu handler
/// ikisinin de tersini yapar).
pub mod password;
/// Özel not uç noktaları **ayrı bir modüldedir**; gerekçe o modülün
/// başlığında (özet: bir dışa aktarım/rapor uç noktası liste handler'ını
/// yanlışlıkla yeniden kullanamasın).
pub mod private_notes;
/// Geri yükleme uç noktaları **ayrı bir modüldedir**; gerekçe o modülün
/// başlığında (özet: geri yüklemenin var oluş sebebi oturumun açılamadığı
/// durumdur, dolayısıyla kilit kapısının dışında olmak zorundadır — yedek
/// alma ise kapının içinde kalmalıdır).
pub mod restore;
pub mod search;
pub mod session;
pub mod setup;
/// Etiket uç noktaları (Plan 5 Görev 5) — kilit kapısının içinde; tüm
/// hacim/denetim kararları çekirdekte (`store::tags`), gerekçe o modülün
/// ve `routes::tags`'in başlığında.
pub mod tags;
/// Danışan veri raporu (Plan 4 Görev 6) — sunucuda üretilen AES-256 parola
/// korumalı PDF; kapının içinde. Özel not bu modüle giremez (yapısal:
/// `notlar_api.rs::rota_katmani_ozel_nota_yapisal_olarak_ayri_erisir`).
pub mod veri_raporu;
