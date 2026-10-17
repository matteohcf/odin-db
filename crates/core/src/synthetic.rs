//! Deterministic synthetic data for performance benchmarks and tests (Milestone 0, ADR-0003).

use std::str::FromStr;

use bson::{Binary, DateTime, Decimal128, Document, doc, oid::ObjectId, spec::BinarySubtype};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::CoreError;
use crate::ejson::EJsonDocument;

const MAX_DOCUMENTS: u32 = 5_000_000;
const MAX_BATCH_SIZE: u32 = 10_000;
const MAX_TERMINAL_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DocumentStreamOptions {
    pub count: u32,
    pub batch_size: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TerminalStreamOptions {
    pub total_bytes: u32,
    pub chunk_bytes: u32,
}

/// Streams `count` documents covering the common BSON types, in batches.
pub async fn stream_documents(
    options: DocumentStreamOptions,
    tx: mpsc::Sender<Vec<EJsonDocument>>,
    cancel: CancellationToken,
) -> Result<(), CoreError> {
    if options.count > MAX_DOCUMENTS {
        return Err(CoreError::Validation(format!(
            "count must be at most {MAX_DOCUMENTS}"
        )));
    }
    if options.batch_size == 0 || options.batch_size > MAX_BATCH_SIZE {
        return Err(CoreError::Validation(format!(
            "batch size must be between 1 and {MAX_BATCH_SIZE}"
        )));
    }

    let mut index = 0;
    while index < options.count {
        let end = options.count.min(index + options.batch_size);
        let batch = (index..end)
            .map(|i| EJsonDocument::from(sample_document(i)))
            .collect();
        send_or_cancel(&tx, batch, &cancel).await?;
        index = end;
    }
    Ok(())
}

/// Streams ANSI-colored log lines totalling roughly `total_bytes`, in chunks.
pub async fn stream_terminal_output(
    options: TerminalStreamOptions,
    tx: mpsc::Sender<String>,
    cancel: CancellationToken,
) -> Result<(), CoreError> {
    if u64::from(options.total_bytes) > MAX_TERMINAL_BYTES || options.chunk_bytes == 0 {
        return Err(CoreError::Validation(
            "invalid terminal stream options".into(),
        ));
    }

    let total = options.total_bytes as usize;
    let chunk_target = options.chunk_bytes as usize;
    let mut sent = 0;
    let mut line = 0_u32;
    while sent < total {
        let mut chunk = String::with_capacity(chunk_target + 128);
        while chunk.len() < chunk_target {
            chunk.push_str(&log_line(line));
            line += 1;
        }
        sent += chunk.len();
        send_or_cancel(&tx, chunk, &cancel).await?;
    }
    Ok(())
}

async fn send_or_cancel<T>(
    tx: &mpsc::Sender<T>,
    value: T,
    cancel: &CancellationToken,
) -> Result<(), CoreError> {
    tokio::select! {
        biased;
        () = cancel.cancelled() => Err(CoreError::Cancelled),
        result = tx.send(value) => result.map_err(|_| CoreError::Cancelled),
    }
}

fn sample_document(i: u32) -> Document {
    let seed = u64::from(i)
        .wrapping_mul(6_364_136_223_846_793_005)
        .wrapping_add(1);
    let mut oid = [0_u8; 12];
    oid[..4].copy_from_slice(&0x6500_0000_u32.to_be_bytes());
    oid[8..].copy_from_slice(&i.to_be_bytes());

    doc! {
        "_id": ObjectId::from_bytes(oid),
        "name": format!("User {i}"),
        "email": format!("user{i}@example.com"),
        "age": i32::try_from(18 + seed % 60).unwrap_or(18),
        "views": i64::try_from(seed % 10_000_000_000).unwrap_or(0),
        "score": f64::from(i % 1000) / 7.0,
        "balance": Decimal128::from_str(&format!("{}.{:02}", seed % 100_000, seed % 100))
            .unwrap_or_else(|_| Decimal128::from_bytes([0; 16])),
        "active": seed % 3 != 0,
        "createdAt": DateTime::from_millis(1_600_000_000_000 + i64::from(i) * 60_000),
        "tags": ["alpha", "beta", if i.is_multiple_of(2) { "even" } else { "odd" }],
        "address": { "city": format!("City {}", i % 500), "zip": format!("{:05}", i % 100_000) },
        "avatar": Binary { subtype: BinarySubtype::Generic, bytes: i.to_be_bytes().to_vec() },
    }
}

fn log_line(i: u32) -> String {
    const LEVELS: [(&str, &str); 4] = [
        ("\x1b[32m", "INFO "),
        ("\x1b[36m", "DEBUG"),
        ("\x1b[33m", "WARN "),
        ("\x1b[31m", "ERROR"),
    ];
    let (color, level) = LEVELS[i as usize % LEVELS.len()];
    format!(
        "\x1b[90m{i:>8}\x1b[0m {color}{level}\x1b[0m db.users.find({{ _id: ObjectId(\"65000000{i:016x}\") }}) \x1b[2mtook {}ms\x1b[0m\r\n",
        i % 97
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn streams_requested_count_in_batches() {
        let (tx, mut rx) = mpsc::channel(4);
        let options = DocumentStreamOptions {
            count: 1_050,
            batch_size: 500,
        };
        let producer = tokio::spawn(stream_documents(options, tx, CancellationToken::new()));

        let mut sizes = Vec::new();
        while let Some(batch) = rx.recv().await {
            sizes.push(batch.len());
        }
        assert!(producer.await.expect("task joins").is_ok());
        assert_eq!(sizes, vec![500, 500, 50]);
    }

    #[tokio::test]
    async fn stops_when_cancelled() {
        let (tx, _rx) = mpsc::channel(1);
        let cancel = CancellationToken::new();
        cancel.cancel();
        let options = DocumentStreamOptions {
            count: 10_000,
            batch_size: 10,
        };
        assert!(matches!(
            stream_documents(options, tx, cancel).await,
            Err(CoreError::Cancelled)
        ));
    }

    #[tokio::test]
    async fn rejects_invalid_batch_size() {
        let (tx, _rx) = mpsc::channel(1);
        let options = DocumentStreamOptions {
            count: 10,
            batch_size: 0,
        };
        assert!(matches!(
            stream_documents(options, tx, CancellationToken::new()).await,
            Err(CoreError::Validation(_))
        ));
    }
}
