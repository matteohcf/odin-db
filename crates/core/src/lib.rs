//! Domain logic for odin-db. This crate must never depend on Tauri (ADR-0004).

pub mod browse;
pub mod connection;
pub mod documents;
pub mod ejson;
pub mod error;
pub mod operations;
pub mod profiles;
pub mod query;
pub mod secrets;
pub mod storage;
pub mod synthetic;

pub use error::{CoreError, ErrorKind};
