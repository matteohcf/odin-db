//! Files stored in `GridFS` buckets: a `<bucket>.files` collection describes them and
//! `<bucket>.chunks` holds their bytes.

use std::path::Path;

use bson::Bson;
use bson::doc;
use mongodb::options::GridFsBucketOptions;
use serde::Serialize;
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio_util::compat::{FuturesAsyncReadCompatExt, FuturesAsyncWriteCompatExt};
use tokio_util::sync::CancellationToken;

use crate::connection::ConnectionHandle;
use crate::ejson::EJsonValue;
use crate::error::CoreError;
use crate::transfer::partial_path;

fn bucket(handle: &ConnectionHandle, database: &str, name: &str) -> mongodb::gridfs::GridFsBucket {
    handle.client.database(database).gridfs_bucket(
        GridFsBucketOptions::builder()
            .bucket_name(name.to_owned())
            .build(),
    )
}

/// The bucket of a `<bucket>.files` collection, if it is one.
#[must_use]
pub fn bucket_of(collection: &str) -> Option<&str> {
    collection
        .strip_suffix(".files")
        .filter(|name| !name.is_empty())
}

/// A file name safe to offer in a save dialog: `filename` comes from document data and
/// may hold path separators (`../../x`) or control characters.
#[must_use]
pub fn safe_file_name(filename: &str) -> String {
    let base = filename.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "file".to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// How far a file transfer has come, in bytes.
#[derive(Debug, Clone, Copy, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FileProgress {
    pub done: f64,
    pub total: f64,
}

/// Bytes moved per read: large enough to be fast, small enough to cancel promptly.
const CHUNK: usize = 256 * 1024;

/// Writes the file's bytes to `path`, through a `.partial` sibling renamed at the
/// end, so a failed or cancelled download never leaves a truncated file. Returns
/// the byte count. Progress is lossy: a slow listener misses updates, not data.
pub async fn download(
    handle: &ConnectionHandle,
    database: &str,
    bucket_name: &str,
    id: EJsonValue,
    path: &Path,
    progress: mpsc::Sender<FileProgress>,
    cancel: CancellationToken,
) -> Result<u64, CoreError> {
    let id = Bson::try_from(id)?;
    let gridfs = bucket(handle, database, bucket_name);
    let total = gridfs
        .find_one(doc! { "_id": id.clone() })
        .await?
        .ok_or(CoreError::NotFound("file"))?
        .length;
    let stream = gridfs.open_download_stream(id).await?;
    let partial = partial_path(path);
    let copied = async {
        let mut file = fs::File::create(&partial).await.map_err(io)?;
        let bytes =
            copy_reporting(&mut stream.compat(), &mut file, total, &progress, &cancel).await?;
        file.flush().await.map_err(io)?;
        Ok::<u64, CoreError>(bytes)
    }
    .await;
    match copied {
        Ok(bytes) => {
            fs::rename(&partial, path).await.map_err(io)?;
            Ok(bytes)
        }
        Err(error) => {
            let _ = fs::remove_file(&partial).await;
            Err(error)
        }
    }
}

/// Stores the file at `path` in the bucket under its file name; returns its new id.
/// A cancelled or failed upload removes the chunks already written.
pub async fn upload(
    handle: &ConnectionHandle,
    database: &str,
    bucket_name: &str,
    path: &Path,
    progress: mpsc::Sender<FileProgress>,
    cancel: CancellationToken,
) -> Result<EJsonValue, CoreError> {
    handle.ensure_writable()?;
    let filename = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| CoreError::Validation("the path has no file name".into()))?;
    let mut source = fs::File::open(path).await.map_err(io)?;
    let total = source.metadata().await.map_err(io)?.len();
    let upload = bucket(handle, database, bucket_name)
        .open_upload_stream(filename)
        .await?;
    let id = upload.id().clone();
    let mut target = upload.compat_write();
    let written = async {
        copy_reporting(&mut source, &mut target, total, &progress, &cancel).await?;
        // Closing writes the last chunk and the files document.
        target.shutdown().await.map_err(io)
    }
    .await;
    if let Err(error) = written {
        let _ = target.into_inner().abort().await;
        return Err(error);
    }
    Ok(EJsonValue::from(id))
}

async fn copy_reporting<R, W>(
    reader: &mut R,
    writer: &mut W,
    total: u64,
    progress: &mpsc::Sender<FileProgress>,
    cancel: &CancellationToken,
) -> Result<u64, CoreError>
where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    let mut buffer = vec![0; CHUNK];
    let mut done: u64 = 0;
    loop {
        let read = tokio::select! {
            read = reader.read(&mut buffer) => read.map_err(io)?,
            () = cancel.cancelled() => return Err(CoreError::Cancelled),
        };
        if read == 0 {
            return Ok(done);
        }
        writer.write_all(&buffer[..read]).await.map_err(io)?;
        done += read as u64;
        #[allow(clippy::cast_precision_loss)]
        let _ = progress.try_send(FileProgress {
            done: done as f64,
            total: total as f64,
        });
    }
}

#[allow(clippy::needless_pass_by_value)] // Shaped for `map_err`.
fn io(error: std::io::Error) -> CoreError {
    CoreError::Internal(format!("file error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offers_only_a_plain_file_name() {
        assert_eq!(safe_file_name("report.pdf"), "report.pdf");
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_file_name("C:\\Windows\\evil.exe"), "evil.exe");
        assert_eq!(safe_file_name("a\nb:c?.txt"), "a_b_c_.txt");
        assert_eq!(safe_file_name(".."), "file");
        assert_eq!(safe_file_name(""), "file");
    }

    #[test]
    fn recognizes_bucket_files_collections() {
        assert_eq!(bucket_of("fs.files"), Some("fs"));
        assert_eq!(bucket_of("photos.files"), Some("photos"));
        assert_eq!(bucket_of("fs.chunks"), None);
        assert_eq!(bucket_of(".files"), None);
        assert_eq!(bucket_of("users"), None);
    }
}
