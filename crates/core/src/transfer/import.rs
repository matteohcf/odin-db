use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use bson::{Bson, Document};
use serde::de::{SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::csv_values::{CsvType, parse_cell, set_path, suggest_type};
use super::{ProgressReporter, TransferProgress};
use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::ejson::EJsonDocument;
use crate::query::Namespace;

const INSERT_BATCH: usize = 1000;
const MAX_REPORTED_ERRORS: usize = 100;
const PREVIEW_ROWS: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CsvColumn {
    pub header: String,
    /// Destination field, a dotted path for nested documents.
    pub field: String,
    pub kind: CsvType,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ImportFormat {
    /// A JSON array, NDJSON, or concatenated documents, in canonical or relaxed Extended JSON.
    Json,
    Csv {
        columns: Vec<CsvColumn>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ImportOptions {
    pub format: ImportFormat,
    /// Stop at the first failing document instead of skipping it.
    pub stop_on_error: bool,
    #[serde(default)]
    pub mode: ImportMode,
    /// Empty the collection before importing. Destructive: confirmed in the UI.
    #[serde(default)]
    pub drop_first: bool,
}

/// What happens to documents whose `_id` already exists in the collection.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ImportMode {
    /// Insert every document; duplicates of an existing `_id` fail.
    #[default]
    Insert,
    /// Replace the existing document with the file's version.
    Upsert,
    /// Keep the existing document and set the file's fields on it.
    Merge,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RecordError {
    /// 1-based position of the document or CSV row in the file.
    pub record: f64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub inserted: f64,
    /// Existing documents replaced or merged (upsert and merge modes).
    pub updated: f64,
    pub failed: f64,
    /// The first errors, enough to fix the file.
    pub errors: Vec<RecordError>,
    pub stopped: bool,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FilePreview {
    Json {
        documents: Vec<EJsonDocument>,
    },
    Csv {
        headers: Vec<String>,
        rows: Vec<Vec<String>>,
        suggested: Vec<CsvType>,
    },
}

/// A first look at a file so the user can confirm the format and, for CSV, the columns.
pub fn preview_file(path: &Path) -> Result<FilePreview, CoreError> {
    if is_csv(path) {
        let mut reader = csv::Reader::from_path(path).map_err(|error| read_error(path, &error))?;
        let headers: Vec<String> = reader
            .headers()
            .map_err(|error| read_error(path, &error))?
            .iter()
            .map(str::to_owned)
            .collect();
        let rows: Vec<Vec<String>> = reader
            .records()
            .take(PREVIEW_ROWS)
            .map(|record| record.map(|r| r.iter().map(str::to_owned).collect()))
            .collect::<Result<_, _>>()
            .map_err(|error| read_error(path, &error))?;
        let suggested = (0..headers.len())
            .map(|column| {
                suggest_type(
                    rows.iter()
                        .filter_map(|row| row.get(column).map(String::as_str)),
                )
            })
            .collect();
        return Ok(FilePreview::Csv {
            headers,
            rows,
            suggested,
        });
    }

    let (tx, mut rx) = mpsc::channel(PREVIEW_ROWS + 1);
    let cancel = CancellationToken::new();
    // Errors after the first few documents don't matter for a preview.
    let _ = read_json(path, &tx, &cancel, Some(PREVIEW_ROWS));
    drop(tx);
    let mut documents = Vec::new();
    while let Ok(parsed) = rx.try_recv() {
        match parsed {
            Parsed::Document(document) => documents.push(EJsonDocument::from(document)),
            Parsed::Invalid(error) if documents.is_empty() => {
                return Err(CoreError::Validation(format!(
                    "document {}: {}",
                    error.record, error.message
                )));
            }
            Parsed::Invalid(_) => break,
        }
    }
    Ok(FilePreview::Json { documents })
}

#[must_use]
pub fn is_csv(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("csv"))
}

/// Imports `path` into the collection with batched inserts. A blocking reader thread
/// parses the file and feeds a bounded channel, so memory stays flat for any file size.
pub async fn import_documents(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    path: PathBuf,
    options: ImportOptions,
    progress: mpsc::Sender<TransferProgress>,
    cancel: CancellationToken,
) -> Result<ImportSummary, CoreError> {
    handle.ensure_writable()?;
    let collection = namespace.collection(handle)?;
    if options.drop_first {
        collection.delete_many(bson::doc! {}).await?;
    }
    let total_bytes = std::fs::metadata(&path).map_or(0, |m| m.len());

    let (tx, mut rx) = mpsc::channel::<Parsed>(INSERT_BATCH * 2);
    let reader_cancel = cancel.child_token();
    let reader = tokio::task::spawn_blocking(move || match options.format {
        ImportFormat::Json => read_json(&path, &tx, &reader_cancel, None),
        ImportFormat::Csv { columns } => read_csv(&path, &columns, &tx, &reader_cancel),
    });

    let mut reporter = ProgressReporter::new(progress);
    let mut summary = ImportSummary {
        inserted: 0.0,
        updated: 0.0,
        failed: 0.0,
        errors: Vec::new(),
        stopped: false,
    };
    let mut batch: Vec<(u64, Document)> = Vec::with_capacity(INSERT_BATCH);
    let mut records = 0_u64;

    loop {
        let next = tokio::select! {
            biased;
            () = cancel.cancelled() => return Err(CoreError::Cancelled),
            next = rx.recv() => next,
        };
        let finished = next.is_none();
        match next {
            Some(Parsed::Document(document)) => {
                records += 1;
                batch.push((records, document));
            }
            Some(Parsed::Invalid(error)) => {
                records += 1;
                record_failure(&mut summary, error);
                if options.stop_on_error {
                    summary.stopped = true;
                }
            }
            None => {}
        }

        if (batch.len() >= INSERT_BATCH || (finished && !batch.is_empty())) && !summary.stopped {
            let batch = std::mem::take(&mut batch);
            write_batch(
                handle,
                namespace,
                batch,
                options.mode,
                options.stop_on_error,
                &mut summary,
            )
            .await?;
        }
        reporter.report(records, total_bytes.min(records * 200));
        if finished || summary.stopped {
            break;
        }
    }

    cancel.cancel();
    if let Ok(Err(error)) = reader.await {
        return Err(error);
    }
    reporter.finish(records, total_bytes);
    Ok(summary)
}

/// Writes numbered documents in `mode`; failures land in `summary`, keyed by number.
pub(super) async fn write_batch(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    batch: Vec<(u64, Document)>,
    mode: ImportMode,
    ordered: bool,
    summary: &mut ImportSummary,
) -> Result<(), CoreError> {
    if mode == ImportMode::Insert {
        insert_batch(&namespace.collection(handle)?, batch, ordered, summary).await
    } else {
        upsert_batch(handle, namespace, batch, mode, ordered, summary).await
    }
}

async fn insert_batch(
    collection: &mongodb::Collection<Document>,
    batch: Vec<(u64, Document)>,
    ordered: bool,
    summary: &mut ImportSummary,
) -> Result<(), CoreError> {
    let positions: Vec<u64> = batch.iter().map(|(position, _)| *position).collect();
    let documents = batch.into_iter().map(|(_, document)| document);
    match collection.insert_many(documents).ordered(ordered).await {
        Ok(result) => {
            #[allow(clippy::cast_precision_loss)]
            {
                summary.inserted += result.inserted_ids.len() as f64;
            }
            Ok(())
        }
        Err(error) => match *error.kind {
            mongodb::error::ErrorKind::InsertMany(ref failure) => {
                let write_errors = failure.write_errors.clone().unwrap_or_default();
                // Ordered inserts stop at the first error; unordered ones skip failures.
                let inserted = if ordered {
                    write_errors.first().map_or(positions.len(), |e| e.index)
                } else {
                    positions.len() - write_errors.len()
                };
                #[allow(clippy::cast_precision_loss)]
                {
                    summary.inserted += inserted as f64;
                }
                for write in write_errors {
                    record_failure(
                        summary,
                        PendingError {
                            record: positions.get(write.index).copied().unwrap_or_default(),
                            message: write.message,
                        },
                    );
                }
                summary.stopped |= ordered;
                Ok(())
            }
            _ => Err(error.into()),
        },
    }
}

/// Upserts by `_id` with the `update` command, which every supported server
/// version accepts (the driver's `bulk_write` needs MongoDB 8.0).
async fn upsert_batch(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    batch: Vec<(u64, Document)>,
    mode: ImportMode,
    ordered: bool,
    summary: &mut ImportSummary,
) -> Result<(), CoreError> {
    let positions: Vec<u64> = batch.iter().map(|(position, _)| *position).collect();
    let updates: Vec<Document> = batch
        .into_iter()
        .map(|(_, mut document)| {
            // Without an `_id` a document is new: give it one so it can be upserted.
            let id = document
                .get("_id")
                .cloned()
                .unwrap_or_else(|| bson::Bson::ObjectId(bson::oid::ObjectId::new()));
            document.insert("_id", id.clone());
            let update = match mode {
                ImportMode::Merge => bson::doc! { "$set": document },
                ImportMode::Upsert | ImportMode::Insert => document,
            };
            bson::doc! { "q": { "_id": id }, "u": update, "upsert": true }
        })
        .collect();
    let reply = handle
        .client
        .database(&namespace.database)
        .run_command(bson::doc! {
            "update": &namespace.collection,
            "updates": updates,
            "ordered": ordered,
        })
        .await?;
    let count = |key: &str| reply.get(key).map_or(0.0, crate::ejson::number_of);
    let upserted = reply.get_array("upserted").map_or(0, Vec::len);
    #[allow(clippy::cast_precision_loss)]
    let upserted = upserted as f64;
    summary.inserted += upserted;
    // `n` counts matched and upserted documents.
    summary.updated += count("n") - upserted;
    if let Ok(errors) = reply.get_array("writeErrors") {
        for error in errors.iter().filter_map(bson::Bson::as_document) {
            let index = error.get("index").map_or(0.0, crate::ejson::number_of);
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let record = positions.get(index as usize).copied().unwrap_or_default();
            record_failure(
                summary,
                PendingError {
                    record,
                    message: error.get_str("errmsg").unwrap_or("write failed").to_owned(),
                },
            );
        }
        summary.stopped |= ordered && !errors.is_empty();
    }
    Ok(())
}

fn record_failure(summary: &mut ImportSummary, error: PendingError) {
    summary.failed += 1.0;
    if summary.errors.len() < MAX_REPORTED_ERRORS {
        #[allow(clippy::cast_precision_loss)]
        summary.errors.push(RecordError {
            record: error.record as f64,
            message: error.message,
        });
    }
}

struct PendingError {
    record: u64,
    message: String,
}

enum Parsed {
    Document(Document),
    Invalid(PendingError),
}

/// Sends documents until the file ends, the receiver hangs up, or `limit` is reached.
fn read_json(
    path: &Path,
    tx: &mpsc::Sender<Parsed>,
    cancel: &CancellationToken,
    limit: Option<usize>,
) -> Result<(), CoreError> {
    let file = File::open(path).map_err(|error| read_error(path, &error))?;
    let mut reader = BufReader::new(file);
    let starts_with_array = loop {
        let buffer = reader
            .fill_buf()
            .map_err(|error| read_error(path, &error))?;
        match buffer.iter().position(|byte| !byte.is_ascii_whitespace()) {
            Some(position) => {
                let first = buffer[position];
                reader.consume(position);
                break first == b'[';
            }
            None if buffer.is_empty() => return Ok(()),
            None => {
                let length = buffer.len();
                reader.consume(length);
            }
        }
    };

    let mut sink = Sink {
        tx,
        cancel,
        sent: 0,
        limit,
    };
    if starts_with_array {
        let mut deserializer = serde_json::Deserializer::from_reader(reader);
        match deserializer.deserialize_seq(ArrayVisitor { sink: &mut sink }) {
            Ok(()) => Ok(()),
            Err(_) if sink.stopped() => Ok(()),
            Err(error) => Err(CoreError::Validation(format!("invalid JSON: {error}"))),
        }
    } else {
        for value in serde_json::Deserializer::from_reader(reader).into_iter::<serde_json::Value>()
        {
            match value {
                Ok(value) => {
                    if !sink.send(value) {
                        break;
                    }
                }
                // A malformed document makes the rest of the stream unreadable.
                Err(error) => {
                    sink.invalid(format!("invalid JSON: {error}"));
                    break;
                }
            }
        }
        Ok(())
    }
}

struct Sink<'a> {
    tx: &'a mpsc::Sender<Parsed>,
    cancel: &'a CancellationToken,
    sent: usize,
    limit: Option<usize>,
}

impl Sink<'_> {
    fn stopped(&self) -> bool {
        self.cancel.is_cancelled()
            || self.tx.is_closed()
            || self.limit.is_some_and(|limit| self.sent >= limit)
    }

    /// Returns false once nothing more should be read.
    fn send(&mut self, value: serde_json::Value) -> bool {
        if self.stopped() {
            return false;
        }
        self.sent += 1;
        let record = self.sent as u64;
        let parsed = match Bson::try_from(value) {
            Ok(Bson::Document(document)) => Parsed::Document(document),
            Ok(_) => Parsed::Invalid(PendingError {
                record,
                message: "not a document".into(),
            }),
            Err(error) => Parsed::Invalid(PendingError {
                record,
                message: format!("invalid Extended JSON: {error}"),
            }),
        };
        self.tx.blocking_send(parsed).is_ok() && !self.stopped()
    }

    fn invalid(&mut self, message: String) {
        self.sent += 1;
        let _ = self.tx.blocking_send(Parsed::Invalid(PendingError {
            record: self.sent as u64,
            message,
        }));
    }
}

struct ArrayVisitor<'a, 'b> {
    sink: &'a mut Sink<'b>,
}

impl<'de> Visitor<'de> for ArrayVisitor<'_, '_> {
    type Value = ();

    fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
        formatter.write_str("an array of documents")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<(), A::Error> {
        while let Some(value) = seq.next_element::<serde_json::Value>()? {
            if !self.sink.send(value) {
                // Stop reading without consuming the rest of a possibly huge file.
                return Err(serde::de::Error::custom("stopped"));
            }
        }
        Ok(())
    }
}

fn read_csv(
    path: &Path,
    columns: &[CsvColumn],
    tx: &mpsc::Sender<Parsed>,
    cancel: &CancellationToken,
) -> Result<(), CoreError> {
    let mut reader = csv::Reader::from_path(path).map_err(|error| read_error(path, &error))?;
    let headers = reader
        .headers()
        .map_err(|error| read_error(path, &error))?
        .clone();
    let mapping: Vec<(usize, &CsvColumn)> = columns
        .iter()
        .filter(|column| column.kind != CsvType::Skip)
        .map(|column| {
            headers
                .iter()
                .position(|header| header == column.header)
                .map(|index| (index, column))
                .ok_or_else(|| {
                    CoreError::Validation(format!("column {:?} is not in the file", column.header))
                })
        })
        .collect::<Result<_, _>>()?;

    for (row, record) in reader.records().enumerate() {
        if cancel.is_cancelled() || tx.is_closed() {
            break;
        }
        let record_number = row as u64 + 1;
        let parsed = match record {
            Err(error) => Parsed::Invalid(PendingError {
                record: record_number,
                message: error.to_string(),
            }),
            Ok(record) => build_row(&record, &mapping).map_or_else(
                |message| {
                    Parsed::Invalid(PendingError {
                        record: record_number,
                        message,
                    })
                },
                Parsed::Document,
            ),
        };
        if tx.blocking_send(parsed).is_err() {
            break;
        }
    }
    Ok(())
}

fn build_row(
    record: &csv::StringRecord,
    mapping: &[(usize, &CsvColumn)],
) -> Result<Document, String> {
    let mut document = Document::new();
    for (index, column) in mapping {
        let cell = record.get(*index).unwrap_or_default();
        if let Some(value) =
            parse_cell(cell, column.kind).map_err(|error| format!("{}: {error}", column.header))?
        {
            set_path(&mut document, &column.field, value)?;
        }
    }
    Ok(document)
}

fn read_error(path: &Path, error: &dyn std::fmt::Display) -> CoreError {
    CoreError::Validation(format!("cannot read {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use bson::doc;

    use super::*;

    fn temp_file(name: &str, contents: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("odin-test-{}-{name}", uuid::Uuid::now_v7()));
        File::create(&path)
            .and_then(|mut f| f.write_all(contents.as_bytes()))
            .expect("write temp file");
        path
    }

    fn parse_all(path: &Path) -> Vec<Result<Document, String>> {
        let (tx, mut rx) = mpsc::channel(100);
        read_json(path, &tx, &CancellationToken::new(), None).expect("read");
        drop(tx);
        let mut out = Vec::new();
        while let Ok(parsed) = rx.try_recv() {
            out.push(match parsed {
                Parsed::Document(d) => Ok(d),
                Parsed::Invalid(e) => Err(e.message),
            });
        }
        out
    }

    #[test]
    fn reads_arrays_ndjson_and_extended_json() {
        let array = temp_file("a.json", r#" [ {"a": {"$numberLong": "5"}}, {"b": 1.5} ] "#);
        let ndjson = temp_file("b.ndjson", "{\"a\": 1}\n{\"a\": 2}\n");
        assert_eq!(
            parse_all(&array),
            vec![Ok(doc! { "a": 5_i64 }), Ok(doc! { "b": 1.5 })]
        );
        assert_eq!(
            parse_all(&ndjson),
            vec![Ok(doc! { "a": 1 }), Ok(doc! { "a": 2 })]
        );
    }

    #[test]
    fn reports_non_documents_and_broken_json() {
        let mixed = temp_file("c.json", "[1, {\"ok\": true}]");
        let results = parse_all(&mixed);
        assert!(results[0].is_err());
        assert_eq!(results[1], Ok(doc! { "ok": true }));

        let broken = temp_file("d.ndjson", "{\"a\": 1}\n{\"a\": \n");
        let results = parse_all(&broken);
        assert_eq!(results[0], Ok(doc! { "a": 1 }));
        assert!(results[1].is_err());
    }

    #[test]
    fn previews_csv_with_suggested_types() {
        let path = temp_file(
            "e.csv",
            "name,age,joined\nAda,36,2024-01-31T10:00:00Z\nAlan,41,\n",
        );
        let FilePreview::Csv {
            headers,
            rows,
            suggested,
        } = preview_file(&path).expect("preview")
        else {
            panic!("expected a CSV preview");
        };
        assert_eq!(headers, ["name", "age", "joined"]);
        assert_eq!(rows.len(), 2);
        assert_eq!(suggested, [CsvType::String, CsvType::Int32, CsvType::Date]);
    }

    #[test]
    fn builds_typed_nested_rows_and_reports_bad_cells() {
        let column = |header: &str, field: &str, kind| CsvColumn {
            header: header.into(),
            field: field.into(),
            kind,
        };
        let columns = [
            column("age", "age", CsvType::Int32),
            column("city", "address.city", CsvType::String),
        ];
        let mapping: Vec<(usize, &CsvColumn)> = columns.iter().enumerate().collect();

        let good = csv::StringRecord::from(vec!["36", "Milano"]);
        assert_eq!(
            build_row(&good, &mapping),
            Ok(doc! { "age": 36, "address": { "city": "Milano" } })
        );
        let bad = csv::StringRecord::from(vec!["old", "Milano"]);
        assert!(build_row(&bad, &mapping).is_err_and(|e| e.starts_with("age:")));
    }
}
