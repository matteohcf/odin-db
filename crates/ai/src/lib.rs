//! Natural-language queries with small local models (ADR-0040). Independent of Tauri.
//!
//! Only field paths and types reach a model, never document values; its answer is held
//! to a fixed JSON shape and checked before the UI shows it.

pub mod catalog;
pub mod engine;
pub mod hardware;
pub mod prompt;
pub mod query;
pub mod store;
