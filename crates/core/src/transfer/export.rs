use std::path::{Path, PathBuf};

use bson::{Bson, Document};
use mongodb::Cursor;
use serde::Deserialize;
use tokio::fs::{self, File};
use tokio::io::{AsyncWriteExt, BufWriter};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::csv_values::{format_cell, get_path};
use super::{ProgressReporter, TransferProgress, TransferSummary};
use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::ejson::EJsonDocument;
use crate::query::{self, FindRequest, Namespace};

/// Rows buffered to discover CSV columns when none are given.
const CSV_SAMPLE: usize = 1000;
const READ_BATCH: u32 = 1000;

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExportSource {
    Find { request: FindRequest },
    Aggregate { pipeline: Vec<EJsonDocument> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    JsonArray,
    Ndjson,
    Csv,
}

/// Canonical keeps every BSON type and is the default (ADR-0007); relaxed is
/// friendlier to other tools but loses numeric types on re-import.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum JsonMode {
    Canonical,
    Relaxed,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub source: ExportSource,
    pub format: ExportFormat,
    pub json_mode: JsonMode,
    /// CSV columns as dotted paths; empty means "discover from the data".
    pub csv_fields: Vec<String>,
}

/// Streams the source into `path`. Data goes to a sibling `.partial` file that is
/// renamed at the end, so a cancelled or failed export never leaves a truncated file.
pub async fn export_documents(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    request: ExportRequest,
    path: &Path,
    progress: mpsc::Sender<TransferProgress>,
    cancel: CancellationToken,
) -> Result<TransferSummary, CoreError> {
    let cursor = match request.source.clone() {
        ExportSource::Find { mut request } => {
            request.batch_size = READ_BATCH;
            query::find_cursor(handle, namespace, request).await?
        }
        ExportSource::Aggregate { pipeline } => {
            query::aggregate_cursor(
                handle,
                namespace,
                pipeline,
                READ_BATCH,
                &query::QueryOptions::default(),
            )
            .await?
        }
    };

    let partial = partial_path(path);
    let result = write_all(
        cursor,
        &request,
        &partial,
        ProgressReporter::new(progress),
        &cancel,
    )
    .await;
    match result {
        Ok(summary) => {
            fs::rename(&partial, path).await.map_err(|error| {
                CoreError::Internal(format!("cannot finish the export file: {error}"))
            })?;
            Ok(summary)
        }
        Err(error) => {
            let _ = fs::remove_file(&partial).await;
            Err(error)
        }
    }
}

/// Where a file is written until it is complete, then renamed into place.
pub(crate) fn partial_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(std::ffi::OsStr::to_os_string)
        .unwrap_or_default();
    name.push(".partial");
    path.with_file_name(name)
}

async fn write_all(
    mut cursor: Cursor<Document>,
    request: &ExportRequest,
    path: &Path,
    mut reporter: ProgressReporter,
    cancel: &CancellationToken,
) -> Result<TransferSummary, CoreError> {
    let file = File::create(path).await.map_err(|error| {
        CoreError::Validation(format!("cannot create {}: {error}", path.display()))
    })?;
    let mut out = Output {
        writer: BufWriter::new(file),
        bytes: 0,
    };
    let mut count = 0_u64;

    match request.format {
        ExportFormat::JsonArray | ExportFormat::Ndjson => {
            let array = request.format == ExportFormat::JsonArray;
            if array {
                out.write(b"[\n").await?;
            }
            while next(&mut cursor, cancel).await? {
                let document = cursor.deserialize_current()?;
                if array && count > 0 {
                    out.write(b",\n").await?;
                }
                out.write(&to_json(document, request.json_mode)?).await?;
                if !array {
                    out.write(b"\n").await?;
                }
                count += 1;
                reporter.report(count, out.bytes);
            }
            if array {
                out.write(b"\n]\n").await?;
            }
        }
        ExportFormat::Csv => {
            let mut buffered = Vec::new();
            let fields = if request.csv_fields.is_empty() {
                while buffered.len() < CSV_SAMPLE && next(&mut cursor, cancel).await? {
                    buffered.push(cursor.deserialize_current()?);
                }
                discover_fields(&buffered)
            } else {
                request.csv_fields.clone()
            };
            out.write(&csv_record(fields.iter().map(String::as_str))?)
                .await?;
            for document in buffered {
                out.write(&csv_row(&document, &fields)?).await?;
                count += 1;
                reporter.report(count, out.bytes);
            }
            while next(&mut cursor, cancel).await? {
                out.write(&csv_row(&cursor.deserialize_current()?, &fields)?)
                    .await?;
                count += 1;
                reporter.report(count, out.bytes);
            }
        }
    }

    out.writer
        .flush()
        .await
        .map_err(|error| write_error(&error))?;
    reporter.finish(count, out.bytes);
    #[allow(clippy::cast_precision_loss)]
    Ok(TransferSummary {
        documents: count as f64,
        bytes: out.bytes as f64,
    })
}

struct Output {
    writer: BufWriter<File>,
    bytes: u64,
}

impl Output {
    async fn write(&mut self, data: &[u8]) -> Result<(), CoreError> {
        self.writer
            .write_all(data)
            .await
            .map_err(|error| write_error(&error))?;
        self.bytes += data.len() as u64;
        Ok(())
    }
}

async fn next(
    cursor: &mut Cursor<Document>,
    cancel: &CancellationToken,
) -> Result<bool, CoreError> {
    tokio::select! {
        biased;
        () = cancel.cancelled() => Err(CoreError::Cancelled),
        advanced = cursor.advance() => Ok(advanced?),
    }
}

fn to_json(document: Document, mode: JsonMode) -> Result<Vec<u8>, CoreError> {
    let value = match mode {
        JsonMode::Canonical => Bson::Document(document).into_canonical_extjson(),
        JsonMode::Relaxed => Bson::Document(document).into_relaxed_extjson(),
    };
    serde_json::to_vec(&value).map_err(|error| CoreError::Internal(error.to_string()))
}

fn discover_fields(documents: &[Document]) -> Vec<String> {
    let mut fields: Vec<String> = Vec::new();
    for document in documents {
        for key in document.keys() {
            if !fields.iter().any(|field| field == key) {
                fields.push(key.clone());
            }
        }
    }
    fields
}

fn csv_row(document: &Document, fields: &[String]) -> Result<Vec<u8>, CoreError> {
    let cells: Vec<String> = fields
        .iter()
        .map(|field| {
            get_path(document, field)
                .map(format_cell)
                .unwrap_or_default()
        })
        .collect();
    csv_record(cells.iter().map(String::as_str))
}

fn csv_record<'a>(cells: impl IntoIterator<Item = &'a str>) -> Result<Vec<u8>, CoreError> {
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(cells)
        .map_err(|error| CoreError::Internal(error.to_string()))?;
    writer
        .into_inner()
        .map_err(|error| CoreError::Internal(error.to_string()))
}

fn write_error(error: &std::io::Error) -> CoreError {
    CoreError::Internal(format!("cannot write the export file: {error}"))
}

#[cfg(test)]
mod tests {
    use bson::doc;

    use super::*;

    #[test]
    fn discovers_fields_in_first_seen_order() {
        let documents = [doc! { "_id": 1, "a": 1 }, doc! { "_id": 2, "b": 1, "a": 2 }];
        assert_eq!(discover_fields(&documents), ["_id", "a", "b"]);
    }

    #[test]
    fn csv_rows_quote_and_flatten_values() {
        let row = csv_row(
            &doc! { "name": "Ada, Countess", "address": { "city": "London" }, "tags": ["x"] },
            &[
                "name".into(),
                "address.city".into(),
                "tags".into(),
                "missing".into(),
            ],
        )
        .expect("row");
        assert_eq!(
            String::from_utf8(row).expect("utf8"),
            "\"Ada, Countess\",London,\"[\"\"x\"\"]\",\n"
        );
    }

    #[test]
    fn partial_file_sits_next_to_the_target() {
        assert_eq!(
            partial_path(Path::new("/tmp/out.json")),
            Path::new("/tmp/out.json.partial")
        );
    }
}
