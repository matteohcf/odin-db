//! Domain logic for odin-db. This crate must never depend on Tauri (ADR-0004).

pub mod backup;
pub mod browse;
pub mod catalog;
pub mod compare;
pub mod connection;
pub mod documents;
pub mod ejson;
pub mod error;
pub mod explain;
pub mod gridfs;
pub mod indexes;
pub mod links;
pub mod monitor;
pub mod operations;
pub mod profiles;
pub mod query;
pub mod schema;
pub mod secrets;
pub mod shell;
pub mod ssh;
pub mod storage;
pub mod synthetic;
pub mod transfer;
pub mod users;
pub mod validation;

pub use error::{CoreError, ErrorKind};
