//! Where a query is generated: a downloaded model run in-process, or Ollama.

pub mod local;
pub mod ollama;

use odin_core::CoreError;
use serde::Deserialize;
use tokio_util::sync::CancellationToken;

use crate::catalog;
use crate::prompt::system_prompt;
use crate::query::{GeneratedQuery, MAX_PROMPT_CHARS, QueryRequest, parse_answer};
use crate::store::ModelStore;

/// The user's choice in settings, sent with every request.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum EngineChoice {
    /// A catalog model by id; the webview never names a file.
    Local {
        model: String,
    },
    Ollama {
        url: String,
        model: String,
    },
}

/// Generates queries with whichever engine the request names.
#[derive(Clone)]
pub struct Assistant {
    pub store: ModelStore,
    pub local: local::LocalEngine,
}

impl Assistant {
    #[must_use]
    pub fn new(store: ModelStore) -> Self {
        Self {
            store,
            local: local::LocalEngine::default(),
        }
    }

    pub async fn generate(
        &self,
        engine: EngineChoice,
        request: QueryRequest,
        cancel: CancellationToken,
    ) -> Result<GeneratedQuery, CoreError> {
        let prompt = request.prompt.trim();
        if prompt.is_empty() {
            return Err(CoreError::Validation(
                "describe the documents to find".into(),
            ));
        }
        if prompt.chars().count() > MAX_PROMPT_CHARS {
            return Err(CoreError::Validation(format!(
                "the request is longer than {MAX_PROMPT_CHARS} characters"
            )));
        }
        let today = jiff::Zoned::now().date().to_string();
        let system = system_prompt(&request, &today);
        let user = format!("Request: {prompt}");
        let answer = match engine {
            EngineChoice::Local { model } => {
                let spec = catalog::find(&model)
                    .ok_or_else(|| CoreError::Validation(format!("unknown model {model}")))?;
                let path = self.store.installed_path(spec).ok_or_else(|| {
                    CoreError::Validation(format!("{} is not downloaded", spec.name))
                })?;
                self.local.complete(path, system, user, cancel).await?
            }
            EngineChoice::Ollama { url, model } => {
                ollama::complete(&url, &model, &system, &user, &cancel).await?
            }
        };
        parse_answer(&answer, &request.fields)
    }
}
