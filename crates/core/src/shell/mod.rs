//! Integrated mongosh shell sessions (ADR-0013, ADR-0030).

mod download;
mod flow;
mod session;

pub use download::{
    DownloadProgress, MONGOSH_VERSION, download_mongosh, installed_mongosh, mongosh_downloadable,
};
pub use flow::{FlowControl, HIGH_WATERMARK};
pub use session::{ShellEvent, ShellOptions, ShellSession, locate_mongosh};
