use std::sync::Arc;

use odin_core::operations::{OperationId, OperationRegistry};
use tauri::State;

/// Returns `false` if the operation already finished.
#[tauri::command]
#[specta::specta]
pub fn cancel_operation(registry: State<'_, Arc<OperationRegistry>>, id: OperationId) -> bool {
    registry.cancel(id)
}
