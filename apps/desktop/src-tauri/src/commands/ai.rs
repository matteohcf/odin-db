use std::sync::Arc;

use odin_ai::catalog::{self, CATALOG, ModelSpec};
use odin_ai::engine::{Assistant, EngineChoice, ollama};
use odin_ai::hardware::{self, Hardware};
use odin_ai::query::{GeneratedQuery, QueryRequest};
use odin_ai::store::{ModelDownloadProgress, ModelState};
use odin_core::CoreError;
use odin_core::operations::{OperationId, OperationRegistry};
use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;

use crate::ipc::{IpcError, StreamEvent, spawn_streaming_operation};

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub spec: ModelSpec,
    pub state: ModelState,
}

/// Everything the AI settings show: the catalog with what is on disk, and the machine.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiOverview {
    pub models: Vec<ModelEntry>,
    pub hardware: Hardware,
    pub recommended: String,
    pub used_bytes: f64,
}

fn spec(id: &str) -> Result<&'static ModelSpec, CoreError> {
    catalog::find(id).ok_or_else(|| CoreError::Validation(format!("unknown model {id}")))
}

#[tauri::command]
#[specta::specta]
pub async fn ai_overview(assistant: State<'_, Assistant>) -> Result<AiOverview, IpcError> {
    let store = assistant.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let hardware = hardware::detect();
        #[allow(clippy::cast_precision_loss)]
        AiOverview {
            models: CATALOG
                .iter()
                .map(|spec| ModelEntry {
                    spec: spec.clone(),
                    state: store.state(spec),
                })
                .collect(),
            recommended: catalog::recommended(hardware.memory_gib).id.to_owned(),
            hardware,
            used_bytes: store.used_bytes() as f64,
        }
    })
    .await
    .map_err(|error| CoreError::Internal(error.to_string()).into())
}

/// Downloads a catalog model as a cancellable operation; cancelling pauses it, and
/// downloading again resumes.
#[tauri::command]
#[specta::specta]
pub async fn download_ai_model(
    assistant: State<'_, Assistant>,
    registry: State<'_, Arc<OperationRegistry>>,
    model: String,
    channel: Channel<StreamEvent<ModelDownloadProgress>>,
) -> Result<OperationId, IpcError> {
    let spec = spec(&model)?;
    let store = assistant.store.clone();
    Ok(spawn_streaming_operation(
        &registry,
        channel,
        move |tx, cancel| async move { store.download(spec, tx, cancel).await },
    ))
}

/// Waits for a running generation to finish, off the async runtime and the main thread.
async fn unload(assistant: &Assistant) -> Result<(), CoreError> {
    let local = assistant.local.clone();
    tauri::async_runtime::spawn_blocking(move || local.unload())
        .await
        .map_err(|error| CoreError::Internal(error.to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn delete_ai_model(
    assistant: State<'_, Assistant>,
    model: String,
) -> Result<(), IpcError> {
    let spec = spec(&model)?;
    unload(&assistant).await?;
    Ok(assistant.store.delete(spec).await?)
}

/// Frees the memory of the loaded model, e.g. when the feature is turned off.
#[tauri::command]
#[specta::specta]
pub async fn unload_ai_model(assistant: State<'_, Assistant>) -> Result<(), IpcError> {
    Ok(unload(&assistant).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn list_ollama_models(url: String) -> Result<Vec<ollama::OllamaModel>, IpcError> {
    Ok(ollama::list_models(&url).await?)
}

/// Turns a description into a find query; one `data` event with the query, then completion.
#[tauri::command]
#[specta::specta]
pub async fn generate_query(
    assistant: State<'_, Assistant>,
    registry: State<'_, Arc<OperationRegistry>>,
    engine: EngineChoice,
    request: QueryRequest,
    channel: Channel<StreamEvent<GeneratedQuery>>,
) -> Result<OperationId, IpcError> {
    let assistant = assistant.inner().clone();
    Ok(spawn_streaming_operation(
        &registry,
        channel,
        move |tx, cancel| async move {
            let query = assistant.generate(engine, request, cancel).await?;
            let _ = tx.send(query).await;
            Ok(())
        },
    ))
}
