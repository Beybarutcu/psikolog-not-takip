pub mod appointments;
pub mod attachments;
/// Yedek **alma** ve yedek klasörü ayarı — kilit kapısının içinde.
pub mod backup;
pub mod clients;
pub mod notes;
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
