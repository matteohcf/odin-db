//! One-click mongosh download with a pinned version and pinned hashes (ADR-0014).

use std::fmt::Write as _;
use std::fs::File;
use std::io::BufReader;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::CoreError;

pub const MONGOSH_VERSION: &str = "2.13.0";
/// Progress is reported at most this often (in bytes), not per network chunk.
const PROGRESS_STEP: u64 = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq)]
enum ArchiveKind {
    Zip,
    TarGz,
}

#[derive(Debug, Clone, Copy)]
struct Archive {
    url: &'static str,
    sha256: &'static str,
    kind: ArchiveKind,
}

/// The official archive for this build's platform. Hashes come from MongoDB's
/// release feed and are the trust anchor: a mismatch aborts the install.
fn host_archive() -> Option<Archive> {
    let (url, sha256, kind) = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => (
            "https://downloads.mongodb.com/compass/mongosh-2.13.0-darwin-arm64.zip",
            "759814a5ea012ad434a0f5c5cb623e02724ae7245a7128224d2baebe61341949",
            ArchiveKind::Zip,
        ),
        ("macos", "x86_64") => (
            "https://downloads.mongodb.com/compass/mongosh-2.13.0-darwin-x64.zip",
            "2bf29862dfee06ba0b36c8b633ff559d4132d7554c8f08224e892c2e301667f5",
            ArchiveKind::Zip,
        ),
        ("linux", "x86_64") => (
            "https://downloads.mongodb.com/compass/mongosh-2.13.0-linux-x64.tgz",
            "b2089e67641a28aa621476c4d62c69f66b9a41484baba24d8a8b1f5f96e92d0b",
            ArchiveKind::TarGz,
        ),
        ("linux", "aarch64") => (
            "https://downloads.mongodb.com/compass/mongosh-2.13.0-linux-arm64.tgz",
            "a124ec6680c70ceabc61696bbd110f0da05d7c52524ed402ae9511b5aec7fe32",
            ArchiveKind::TarGz,
        ),
        ("windows", "x86_64") => (
            "https://downloads.mongodb.com/compass/mongosh-2.13.0-win32-x64.zip",
            "7424ffc141513133e3568015a3efc2c41dfdba909a3ef1945891da9a51aa77fa",
            ArchiveKind::Zip,
        ),
        _ => return None,
    };
    Some(Archive { url, sha256, kind })
}

/// Whether this platform has a pinned mongosh build to download.
#[must_use]
pub fn mongosh_downloadable() -> bool {
    host_archive().is_some()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub received: f64,
    /// `None` when the server does not announce the size.
    pub total: Option<f64>,
}

fn install_dir(dir: &Path) -> PathBuf {
    dir.join(format!("mongosh-{MONGOSH_VERSION}"))
}

fn executable_name() -> &'static str {
    if cfg!(windows) {
        "mongosh.exe"
    } else {
        "mongosh"
    }
}

/// The mongosh previously downloaded into `dir`, if any.
#[must_use]
pub fn installed_mongosh(dir: &Path) -> Option<PathBuf> {
    let path = install_dir(dir).join("bin").join(executable_name());
    path.is_file().then_some(path)
}

/// Downloads, verifies and installs the pinned mongosh into `dir`; returns its path.
/// Nothing is left behind on failure or cancellation.
pub async fn download_mongosh(
    dir: &Path,
    events: mpsc::Sender<DownloadProgress>,
    cancel: CancellationToken,
) -> Result<PathBuf, CoreError> {
    let archive = host_archive()
        .ok_or_else(|| CoreError::Validation("no mongosh download for this platform".into()))?;
    tokio::fs::create_dir_all(dir).await.map_err(io_error)?;
    let file = dir.join(format!("mongosh-{MONGOSH_VERSION}.download"));

    let result = async {
        let digest = fetch(archive.url, &file, &events, &cancel).await?;
        if digest != archive.sha256 {
            return Err(CoreError::Integrity(format!(
                "the downloaded mongosh does not match its published checksum, so it was not installed (got {digest}); try again"
            )));
        }
        let (file, dir) = (file.clone(), dir.to_path_buf());
        tokio::task::spawn_blocking(move || install(&file, archive.kind, &dir))
            .await
            .map_err(|error| CoreError::Internal(error.to_string()))?
    }
    .await;
    let _ = tokio::fs::remove_file(&file).await;
    result
}

/// Streams `url` into `path`, hashing as it goes. Returns the hex SHA-256.
async fn fetch(
    url: &str,
    path: &Path,
    events: &mpsc::Sender<DownloadProgress>,
    cancel: &CancellationToken,
) -> Result<String, CoreError> {
    let network = |error: reqwest::Error| CoreError::Network(error.to_string());
    let mut response = reqwest::get(url)
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(network)?;
    #[allow(clippy::cast_precision_loss)]
    let total = response.content_length().map(|length| length as f64);
    let mut file = tokio::fs::File::create(path).await.map_err(io_error)?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut reported: u64 = 0;

    loop {
        let chunk = tokio::select! {
            () = cancel.cancelled() => return Err(CoreError::Cancelled),
            chunk = response.chunk() => chunk.map_err(network)?,
        };
        let Some(chunk) = chunk else { break };
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(io_error)?;
        received += chunk.len() as u64;
        if received - reported >= PROGRESS_STEP {
            reported = received;
            // Lossy on purpose: a slow UI must not slow the download.
            #[allow(clippy::cast_precision_loss)]
            let _ = events.try_send(DownloadProgress {
                received: received as f64,
                total,
            });
        }
    }
    file.flush().await.map_err(io_error)?;
    #[allow(clippy::cast_precision_loss)]
    let _ = events.try_send(DownloadProgress {
        received: received as f64,
        total,
    });
    Ok(hex(&hasher.finalize()))
}

/// Extracts into a temporary directory, then renames it into place, so a
/// half-extracted mongosh is never found by `installed_mongosh`.
fn install(archive: &Path, kind: ArchiveKind, dir: &Path) -> Result<PathBuf, CoreError> {
    let target = install_dir(dir);
    let staging = dir.join(format!("mongosh-{MONGOSH_VERSION}.partial"));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(io_error)?;

    let extracted = match kind {
        ArchiveKind::Zip => extract_zip(archive, &staging),
        ArchiveKind::TarGz => extract_tar_gz(archive, &staging),
    };
    let finish = extracted.and_then(|()| {
        if !staging.join("bin").join(executable_name()).is_file() {
            return Err(CoreError::Validation(
                "the mongosh archive has no executable".into(),
            ));
        }
        let _ = std::fs::remove_dir_all(&target);
        std::fs::rename(&staging, &target).map_err(io_error)
    });
    if let Err(error) = finish {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    Ok(target.join("bin").join(executable_name()))
}

/// Archive entries sit under one top-level folder (`mongosh-2.13.0-darwin-arm64/`);
/// it is dropped. Paths that would escape the destination are rejected.
fn strip_top_level(path: &Path) -> Result<Option<PathBuf>, CoreError> {
    let mut components = path.components();
    components.next();
    let rest: PathBuf = components.collect();
    if rest
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(CoreError::Validation(format!(
            "unsafe path in the mongosh archive: {}",
            path.display()
        )));
    }
    Ok((!rest.as_os_str().is_empty()).then_some(rest))
}

fn extract_zip(archive: &Path, destination: &Path) -> Result<(), CoreError> {
    let mut zip = zip::ZipArchive::new(BufReader::new(File::open(archive).map_err(io_error)?))
        .map_err(archive_error)?;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(archive_error)?;
        let Some(name) = entry.enclosed_name() else {
            return Err(CoreError::Validation(
                "unsafe path in the mongosh archive".into(),
            ));
        };
        let Some(relative) = strip_top_level(&name)? else {
            continue;
        };
        let path = destination.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&path).map_err(io_error)?;
            continue;
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(io_error)?;
        }
        let mut out = File::create(&path).map_err(io_error)?;
        std::io::copy(&mut entry, &mut out).map_err(io_error)?;
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode))
                .map_err(io_error)?;
        }
    }
    Ok(())
}

fn extract_tar_gz(archive: &Path, destination: &Path) -> Result<(), CoreError> {
    let file = BufReader::new(File::open(archive).map_err(io_error)?);
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    for entry in tar.entries().map_err(io_error)? {
        let mut entry = entry.map_err(io_error)?;
        let name = entry.path().map_err(io_error)?.into_owned();
        let Some(relative) = strip_top_level(&name)? else {
            continue;
        };
        let path = destination.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(io_error)?;
        }
        entry.unpack(&path).map_err(io_error)?;
    }
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut out, byte| {
            let _ = write!(out, "{byte:02x}");
            out
        })
}

/// SHA-256 of a file, for tests and diagnostics.
#[cfg(test)]
fn file_sha256(path: &Path) -> String {
    use std::io::Read;
    let mut hasher = Sha256::new();
    let mut file = File::open(path).unwrap();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = file.read(&mut buffer).unwrap();
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    hex(&hasher.finalize())
}

fn io_error(error: impl std::fmt::Display) -> CoreError {
    CoreError::Internal(format!("cannot install mongosh: {error}"))
}

fn archive_error(error: impl std::fmt::Display) -> CoreError {
    CoreError::Integrity(format!("the mongosh archive is damaged: {error}"))
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("odin-mongosh-{name}-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn zip_fixture(path: &Path, entries: &[(&str, &[u8])]) {
        let mut zip = zip::ZipWriter::new(File::create(path).unwrap());
        for (name, data) in entries {
            let options = zip::write::SimpleFileOptions::default().unix_permissions(0o755);
            zip.start_file(*name, options).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
    }

    fn tar_gz_fixture(path: &Path, entries: &[(&str, &[u8])]) {
        let encoder =
            flate2::write::GzEncoder::new(File::create(path).unwrap(), flate2::Compression::fast());
        let mut tar = tar::Builder::new(encoder);
        for (name, data) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            tar.append_data(&mut header, name, *data).unwrap();
        }
        tar.into_inner().unwrap().finish().unwrap();
    }

    #[test]
    fn installs_a_zip_without_its_top_level_folder() {
        let dir = temp_dir("zip");
        let archive = dir.join("a.zip");
        let exe = format!("mongosh-x/bin/{}", executable_name());
        zip_fixture(
            &archive,
            &[(&exe, b"#!/bin/sh\n"), ("mongosh-x/LICENSE", b"text")],
        );

        let path = install(&archive, ArchiveKind::Zip, &dir).unwrap();
        assert_eq!(installed_mongosh(&dir), Some(path.clone()));
        assert!(install_dir(&dir).join("LICENSE").is_file());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o111, 0o111, "the executable bit survives");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn installs_a_tar_gz() {
        let dir = temp_dir("tgz");
        let archive = dir.join("a.tgz");
        let exe = format!("mongosh-x/bin/{}", executable_name());
        tar_gz_fixture(&archive, &[(&exe, b"#!/bin/sh\n")]);

        install(&archive, ArchiveKind::TarGz, &dir).unwrap();
        assert!(installed_mongosh(&dir).is_some());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_archive_without_mongosh_leaves_nothing_behind() {
        let dir = temp_dir("empty");
        let archive = dir.join("a.zip");
        zip_fixture(&archive, &[("mongosh-x/README", b"nothing here")]);

        assert!(install(&archive, ArchiveKind::Zip, &dir).is_err());
        assert!(installed_mongosh(&dir).is_none());
        assert!(
            !dir.join(format!("mongosh-{MONGOSH_VERSION}.partial"))
                .exists()
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn paths_escaping_the_destination_are_rejected() {
        assert!(strip_top_level(Path::new("top/../../etc/passwd")).is_err());
        assert_eq!(
            strip_top_level(Path::new("top/bin/mongosh")).unwrap(),
            Some(PathBuf::from("bin/mongosh"))
        );
        assert_eq!(strip_top_level(Path::new("top/")).unwrap(), None);
    }

    #[test]
    fn hashes_are_lowercase_hex() {
        let dir = temp_dir("hash");
        let file = dir.join("f");
        std::fs::write(&file, b"abc").unwrap();
        assert_eq!(
            file_sha256(&file),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn every_pinned_hash_is_a_sha256() {
        if let Some(archive) = host_archive() {
            assert_eq!(archive.sha256.len(), 64);
            assert!(archive.url.contains(MONGOSH_VERSION));
        }
    }
}
