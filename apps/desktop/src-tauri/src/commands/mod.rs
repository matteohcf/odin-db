// Tauri command signatures must take State and Channel by value.
#![allow(clippy::needless_pass_by_value)]

pub mod app;
pub mod connections;
pub mod documents;
pub mod indexes;
pub mod operations;
pub mod perf_lab;
pub mod profiles;
