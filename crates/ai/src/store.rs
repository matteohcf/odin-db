//! Model files on disk: download with resume and verification, listing, deletion.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use odin_core::CoreError;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::catalog::{self, ModelSpec};

/// Progress is reported at most this often (in bytes), not per network chunk.
const PROGRESS_STEP: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadProgress {
    pub received: f64,
    pub total: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ModelState {
    Absent,
    /// A paused or interrupted download, resumable from `received` bytes.
    Partial {
        received: f64,
    },
    Installed,
}

#[derive(Debug, Clone)]
pub struct ModelStore {
    dir: PathBuf,
}

impl ModelStore {
    #[must_use]
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// The verified file of an installed model; downloads in progress are never returned.
    #[must_use]
    pub fn installed_path(&self, spec: &ModelSpec) -> Option<PathBuf> {
        let path = self.file(spec);
        path.is_file().then_some(path)
    }

    #[must_use]
    pub fn state(&self, spec: &ModelSpec) -> ModelState {
        if self.file(spec).is_file() {
            return ModelState::Installed;
        }
        match std::fs::metadata(self.partial(spec)) {
            #[allow(clippy::cast_precision_loss)]
            Ok(metadata) => ModelState::Partial {
                received: metadata.len() as f64,
            },
            Err(_) => ModelState::Absent,
        }
    }

    /// Downloads `spec`, resuming a partial file, and installs it once its SHA-256 matches.
    /// Cancelling keeps the partial file so the download can resume later.
    pub async fn download(
        &self,
        spec: &ModelSpec,
        progress: mpsc::Sender<ModelDownloadProgress>,
        cancel: CancellationToken,
    ) -> Result<(), CoreError> {
        tokio::fs::create_dir_all(&self.dir)
            .await
            .map_err(io_error)?;
        let partial = self.partial(spec);
        let digest = fetch(spec, &partial, &progress, &cancel).await?;
        if digest != spec.sha256 {
            let _ = tokio::fs::remove_file(&partial).await;
            return Err(CoreError::Integrity(format!(
                "the downloaded {} does not match its published checksum, so it was not installed; try again",
                spec.name
            )));
        }
        tokio::fs::rename(&partial, self.file(spec))
            .await
            .map_err(io_error)
    }

    /// Removes the model and any partial download of it.
    pub async fn delete(&self, spec: &ModelSpec) -> Result<(), CoreError> {
        for path in [self.file(spec), self.partial(spec)] {
            match tokio::fs::remove_file(&path).await {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                    return Err(io_error(error));
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// Bytes used by installed models and partial downloads in the catalog.
    #[must_use]
    pub fn used_bytes(&self) -> u64 {
        catalog::CATALOG
            .iter()
            .flat_map(|spec| [self.file(spec), self.partial(spec)])
            .filter_map(|path| std::fs::metadata(path).ok())
            .map(|metadata| metadata.len())
            .sum()
    }

    fn file(&self, spec: &ModelSpec) -> PathBuf {
        self.dir.join(format!("{}.gguf", spec.id))
    }

    fn partial(&self, spec: &ModelSpec) -> PathBuf {
        self.dir.join(format!("{}.gguf.partial", spec.id))
    }
}

/// Appends to `path` from where it stopped, hashing the whole file. Returns the hex SHA-256.
async fn fetch(
    spec: &ModelSpec,
    path: &Path,
    progress: &mpsc::Sender<ModelDownloadProgress>,
    cancel: &CancellationToken,
) -> Result<String, CoreError> {
    let network = |error: reqwest::Error| CoreError::Network(error.to_string());
    let mut hasher = Sha256::new();
    let mut received = hash_existing(path, &mut hasher, spec.size).await?;

    let mut request = reqwest::Client::new().get(spec.url);
    if received > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={received}-"));
    }
    let mut response = tokio::select! {
        () = cancel.cancelled() => return Err(CoreError::Cancelled),
        response = request.send() => response
            .and_then(reqwest::Response::error_for_status)
            .map_err(network)?,
    };
    // A server that ignores the range sends the whole file again.
    if received > 0 && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        received = 0;
        hasher = Sha256::new();
    }
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(received > 0)
        .truncate(received == 0)
        .open(path)
        .await
        .map_err(io_error)?;

    #[allow(clippy::cast_precision_loss)]
    let report = |received: u64| {
        // Lossy on purpose: a slow UI must not slow the download.
        let _ = progress.try_send(ModelDownloadProgress {
            received: received as f64,
            total: spec.size as f64,
        });
    };
    report(received);
    let mut reported = received;
    loop {
        let chunk = tokio::select! {
            biased;
            () = cancel.cancelled() => {
                file.flush().await.map_err(io_error)?;
                return Err(CoreError::Cancelled);
            }
            chunk = response.chunk() => chunk.map_err(network)?,
        };
        let Some(chunk) = chunk else { break };
        received += chunk.len() as u64;
        if received > spec.size {
            drop(file);
            let _ = tokio::fs::remove_file(path).await;
            return Err(CoreError::Integrity(format!(
                "the server sent more data than {} should have",
                spec.name
            )));
        }
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(io_error)?;
        if received - reported >= PROGRESS_STEP {
            reported = received;
            report(received);
        }
    }
    file.flush().await.map_err(io_error)?;
    report(received);
    Ok(hex(&hasher.finalize()))
}

/// Feeds an existing partial file to `hasher`; returns its length, or 0 if it is unusable.
async fn hash_existing(path: &Path, hasher: &mut Sha256, size: u64) -> Result<u64, CoreError> {
    let Ok(mut file) = tokio::fs::File::open(path).await else {
        return Ok(0);
    };
    let length = file.metadata().await.map_err(io_error)?.len();
    if length >= size {
        return Ok(0);
    }
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).await.map_err(io_error)?;
        if read == 0 {
            return Ok(length);
        }
        hasher.update(&buffer[..read]);
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
    })
}

#[allow(clippy::needless_pass_by_value)]
fn io_error(error: std::io::Error) -> CoreError {
    CoreError::Storage(error.to_string())
}
