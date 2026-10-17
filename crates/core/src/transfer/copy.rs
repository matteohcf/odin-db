//! Copies a collection or a whole database, within a deployment or to another
//! one: options, views, documents and indexes, streamed in batches.

use bson::{Document, doc};
use mongodb::results::CollectionSpecification;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::ProgressReporter;
use super::database::{DatabaseProgress, DatabaseTransferSummary, forward};
use super::import::{ImportMode, ImportSummary, write_batch};
use crate::CoreError;
use crate::catalog::{validate_collection_name, validate_database_name};
use crate::connection::ConnectionHandle;
use crate::query::Namespace;

const COPY_BATCH: u32 = 1000;
const MAX_ERRORS: usize = 20;

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CopyRequest {
    pub source_database: String,
    /// One collection, or `None` for every collection and view of the database.
    pub source_collection: Option<String>,
    pub target_database: String,
    /// Collection copies only: the new name; defaults to the source name.
    pub target_collection: Option<String>,
    pub mode: ImportMode,
    /// Drops each target collection first, indexes included. Destructive:
    /// confirmed in the UI.
    pub drop_target: bool,
    pub copy_indexes: bool,
}

/// One collection to copy and where it goes.
struct Job {
    spec: CollectionSpecification,
    target: String,
}

pub async fn copy(
    source: &ConnectionHandle,
    target: &ConnectionHandle,
    request: CopyRequest,
    progress: mpsc::Sender<DatabaseProgress>,
    cancel: CancellationToken,
) -> Result<DatabaseTransferSummary, CoreError> {
    target.ensure_writable()?;
    validate_database_name(&request.target_database)?;
    let jobs = plan(source, &request).await?;
    let same_place = source.info.id == target.info.id
        && request.source_database == request.target_database
        && jobs.iter().any(|job| job.spec.name == job.target);
    if same_place {
        return Err(CoreError::Validation(
            "choose another database or name: a collection cannot be copied onto itself".into(),
        ));
    }

    let target_db = target.client.database(&request.target_database);
    let mut existing = target_db.list_collection_names().await?;
    let mut summary = DatabaseTransferSummary::new();
    let total = jobs.len();
    for (index, job) in jobs.into_iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(CoreError::Cancelled);
        }
        let reporter = ProgressReporter::new(forward(&progress, &job.target, index, total));
        if request.drop_target && existing.contains(&job.target) {
            target_db.collection::<Document>(&job.target).drop().await?;
            existing.retain(|name| name != &job.target);
        }
        if !existing.contains(&job.target) {
            target_db
                .create_collection(&job.target)
                .with_options(job.spec.options.clone())
                .await?;
            existing.push(job.target.clone());
        }
        summary.collections += 1.0;
        if job.spec.options.view_on.is_some() {
            continue;
        }
        let from = Namespace {
            database: request.source_database.clone(),
            collection: job.spec.name.clone(),
        };
        let to = Namespace {
            database: request.target_database.clone(),
            collection: job.target.clone(),
        };
        let copied =
            copy_documents(source, target, &from, &to, request.mode, reporter, &cancel).await?;
        summary.documents += copied.inserted;
        summary.updated += copied.updated;
        summary.failed += copied.failed;
        for error in copied.errors {
            push_error(
                &mut summary,
                format!(
                    "{}, document {}: {}",
                    job.target, error.record, error.message
                ),
            );
        }
        if request.copy_indexes {
            copy_indexes(source, target, &from, &to, &mut summary).await?;
        }
    }
    Ok(summary)
}

/// The collections to copy, plain collections before the views that may read them.
async fn plan(source: &ConnectionHandle, request: &CopyRequest) -> Result<Vec<Job>, CoreError> {
    let database = source.client.database(&request.source_database);
    let filter = match &request.source_collection {
        Some(name) => doc! { "name": name },
        None => doc! {},
    };
    let mut cursor = database.list_collections().filter(filter).await?;
    let mut specs = Vec::new();
    while cursor.advance().await? {
        specs.push(cursor.deserialize_current()?);
    }
    specs.retain(|spec| !spec.name.starts_with("system."));
    specs.sort_by(|a, b| {
        (a.options.view_on.is_some(), &a.name).cmp(&(b.options.view_on.is_some(), &b.name))
    });
    match &request.source_collection {
        Some(name) => {
            let spec = specs.pop().ok_or(CoreError::NotFound("collection"))?;
            let target = request
                .target_collection
                .clone()
                .unwrap_or_else(|| name.clone());
            validate_collection_name(&target)?;
            Ok(vec![Job { spec, target }])
        }
        None => Ok(specs
            .into_iter()
            .map(|spec| Job {
                target: spec.name.clone(),
                spec,
            })
            .collect()),
    }
}

async fn copy_documents(
    source: &ConnectionHandle,
    target: &ConnectionHandle,
    from: &Namespace,
    to: &Namespace,
    mode: ImportMode,
    mut reporter: ProgressReporter,
    cancel: &CancellationToken,
) -> Result<ImportSummary, CoreError> {
    let mut cursor = from
        .collection(source)?
        .find(doc! {})
        .batch_size(COPY_BATCH)
        .await?;
    let mut summary = ImportSummary {
        inserted: 0.0,
        updated: 0.0,
        failed: 0.0,
        errors: Vec::new(),
        stopped: false,
    };
    let mut batch = Vec::with_capacity(COPY_BATCH as usize);
    let mut read = 0_u64;
    loop {
        let advanced: bool = tokio::select! {
            biased;
            () = cancel.cancelled() => return Err(CoreError::Cancelled),
            advanced = cursor.advance() => advanced?,
        };
        let finished = !advanced;
        if advanced {
            read += 1;
            batch.push((read, cursor.deserialize_current()?));
        }
        if batch.len() >= COPY_BATCH as usize || (finished && !batch.is_empty()) {
            write_batch(
                target,
                to,
                std::mem::take(&mut batch),
                mode,
                false,
                &mut summary,
            )
            .await?;
            reporter.report(read, 0);
        }
        if finished {
            break;
        }
    }
    reporter.finish(read, 0);
    Ok(summary)
}

/// Recreates the secondary indexes. A failing index (say, unique over
/// duplicates already in the target) is reported, not fatal.
async fn copy_indexes(
    source: &ConnectionHandle,
    target: &ConnectionHandle,
    from: &Namespace,
    to: &Namespace,
    summary: &mut DatabaseTransferSummary,
) -> Result<(), CoreError> {
    let mut cursor = from.collection(source)?.list_indexes().await?;
    let mut indexes = Vec::new();
    while cursor.advance().await? {
        indexes.push(cursor.deserialize_current()?);
    }
    let collection = to.collection(target)?;
    for index in indexes {
        let name = index
            .options
            .as_ref()
            .and_then(|options| options.name.clone())
            .unwrap_or_default();
        if name == "_id_" {
            continue;
        }
        if let Err(error) = collection.create_index(index).await {
            push_error(
                summary,
                format!(
                    "{}, index {name}: {}",
                    to.collection,
                    CoreError::from(error)
                ),
            );
        }
    }
    Ok(())
}

fn push_error(summary: &mut DatabaseTransferSummary, message: String) {
    if summary.errors.len() < MAX_ERRORS {
        summary.errors.push(message);
    }
}
