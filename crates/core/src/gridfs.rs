//! Files stored in `GridFS` buckets: a `<bucket>.files` collection describes them and
//! `<bucket>.chunks` holds their bytes.

use std::path::{Path, PathBuf};

use bson::Bson;
use mongodb::options::GridFsBucketOptions;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio_util::compat::{FuturesAsyncReadCompatExt, FuturesAsyncWriteCompatExt};

use crate::connection::ConnectionHandle;
use crate::ejson::EJsonValue;
use crate::error::CoreError;

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

/// Writes the file's bytes to `path`, through a `.partial` sibling renamed at the
/// end, so a failed download never leaves a truncated file. Returns the byte count.
pub async fn download(
    handle: &ConnectionHandle,
    database: &str,
    bucket_name: &str,
    id: EJsonValue,
    path: &Path,
) -> Result<u64, CoreError> {
    let id = Bson::try_from(id)?;
    let stream = bucket(handle, database, bucket_name)
        .open_download_stream(id)
        .await?;
    let partial = partial_path(path);
    let copied = async {
        let mut file = fs::File::create(&partial).await.map_err(io)?;
        let bytes = tokio::io::copy(&mut stream.compat(), &mut file)
            .await
            .map_err(io)?;
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
pub async fn upload(
    handle: &ConnectionHandle,
    database: &str,
    bucket_name: &str,
    path: &Path,
) -> Result<EJsonValue, CoreError> {
    handle.ensure_writable()?;
    let filename = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| CoreError::Validation("the path has no file name".into()))?;
    let mut source = fs::File::open(path).await.map_err(io)?;
    let upload = bucket(handle, database, bucket_name)
        .open_upload_stream(filename)
        .await?;
    let id = upload.id().clone();
    let mut target = upload.compat_write();
    tokio::io::copy(&mut source, &mut target)
        .await
        .map_err(io)?;
    // Closing writes the last chunk and the files document.
    target.shutdown().await.map_err(io)?;
    Ok(EJsonValue::from(id))
}

#[allow(clippy::needless_pass_by_value)] // Shaped for `map_err`.
fn io(error: std::io::Error) -> CoreError {
    CoreError::Internal(format!("file error: {error}"))
}

fn partial_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(std::ffi::OsStr::to_os_string)
        .unwrap_or_default();
    name.push(".partial");
    path.with_file_name(name)
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
