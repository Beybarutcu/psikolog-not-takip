pub mod appointments;
pub mod attachments;
pub mod clients;
pub mod notes;
/// Özel not uç noktaları **ayrı bir modüldedir**; gerekçe o modülün
/// başlığında (özet: bir dışa aktarım/rapor uç noktası liste handler'ını
/// yanlışlıkla yeniden kullanamasın).
pub mod private_notes;
pub mod search;
pub mod session;
pub mod setup;
