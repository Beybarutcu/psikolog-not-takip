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
