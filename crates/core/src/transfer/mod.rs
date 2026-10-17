//! Import and export, streaming end to end (ADR-0019).

mod copy;
mod csv_values;
mod database;
mod export;
mod import;

use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::sync::mpsc;

pub use copy::{CopyRequest, copy};
pub use csv_values::CsvType;
pub use database::{
    DatabaseExportRequest, DatabaseProgress, DatabaseTransferSummary, database_files,
    export_database, import_database,
};
pub use export::{ExportFormat, ExportRequest, ExportSource, JsonMode, export_documents};
pub use import::{
    CsvColumn, FilePreview, ImportFormat, ImportMode, ImportOptions, ImportSummary, RecordError,
    import_documents, is_csv, preview_file,
};

#[derive(Debug, Clone, Copy, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub documents: f64,
    pub bytes: f64,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TransferSummary {
    pub documents: f64,
    pub bytes: f64,
}

const PROGRESS_INTERVAL: Duration = Duration::from_millis(200);

/// Throttled, lossy progress: a slow UI never slows the transfer down.
struct ProgressReporter {
    tx: mpsc::Sender<TransferProgress>,
    last: Option<Instant>,
}

impl ProgressReporter {
    fn new(tx: mpsc::Sender<TransferProgress>) -> Self {
        Self { tx, last: None }
    }

    fn report(&mut self, documents: u64, bytes: u64) {
        if self
            .last
            .is_some_and(|last| last.elapsed() < PROGRESS_INTERVAL)
        {
            return;
        }
        self.last = Some(Instant::now());
        self.send(documents, bytes);
    }

    fn finish(&mut self, documents: u64, bytes: u64) {
        self.send(documents, bytes);
    }

    #[allow(clippy::cast_precision_loss)]
    fn send(&self, documents: u64, bytes: u64) {
        let _ = self.tx.try_send(TransferProgress {
            documents: documents as f64,
            bytes: bytes as f64,
        });
    }
}
