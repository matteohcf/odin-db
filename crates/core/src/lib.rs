//! Domain logic for odin-db. This crate must never depend on Tauri (ADR-0004).

pub mod ejson;
pub mod error;
pub mod operations;
pub mod synthetic;

pub use error::{CoreError, ErrorKind};
