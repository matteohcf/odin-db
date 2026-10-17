//! Domain logic for odin-db. This crate must never depend on Tauri (ADR-0004).

pub mod backup;
pub mod browse;
pub mod connection;
pub mod documents;
pub mod ejson;
pub mod error;
pub mod indexes;
pub mod operations;
pub mod profiles;
pub mod query;
pub mod secrets;
pub mod storage;
pub mod synthetic;
pub mod transfer;

pub use error::{CoreError, ErrorKind};
