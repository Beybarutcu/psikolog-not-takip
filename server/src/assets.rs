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
