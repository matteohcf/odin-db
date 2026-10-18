// Tauri command signatures must take State and Channel by value.
#![allow(clippy::needless_pass_by_value)]

pub mod ai;
pub mod app;
pub mod backup;
pub mod backups;
pub mod catalog;
pub mod compare;
pub mod connections;
pub mod documents;
pub mod gridfs;
pub mod indexes;
pub mod monitor;
pub mod operations;
pub mod perf_lab;
pub mod profiles;
pub mod shell;
pub mod transfer;
pub mod updates;
pub mod users;
