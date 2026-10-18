//! Models the user already runs in Ollama, reached over its local HTTP API.

use odin_core::CoreError;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::prompt::answer_schema;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub name: String,
    #[cfg_attr(feature = "specta", specta(type = f64))]
    pub size: u64,
    /// "1.5B", as Ollama reports it.
    pub parameter_size: Option<String>,
}

#[derive(Deserialize)]
struct Tags {
    models: Vec<Tag>,
}

#[derive(Deserialize)]
struct Tag {
    name: String,
    size: u64,
    details: Option<Details>,
}

#[derive(Deserialize)]
struct Details {
    parameter_size: Option<String>,
}

#[derive(Deserialize)]
struct ChatResponse {
    message: Message,
}

#[derive(Deserialize)]
struct Message {
    content: String,
}

/// Only plain HTTP(S) addresses: the URL comes from a setting the user typed.
fn endpoint(base: &str, path: &str) -> Result<reqwest::Url, CoreError> {
    let url = reqwest::Url::parse(base.trim())
        .and_then(|url| url.join(path))
        .map_err(|error| CoreError::Validation(format!("invalid Ollama address: {error}")))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(CoreError::Validation(
            "the Ollama address must start with http:// or https://".into(),
        ));
    }
    Ok(url)
}

#[allow(clippy::needless_pass_by_value)]
fn network(error: reqwest::Error) -> CoreError {
    CoreError::Network(format!("Ollama: {error}"))
}

pub async fn list_models(base: &str) -> Result<Vec<OllamaModel>, CoreError> {
    let body = reqwest::Client::new()
        .get(endpoint(base, "/api/tags")?)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(network)?
        .bytes()
        .await
        .map_err(network)?;
    let tags: Tags = serde_json::from_slice(&body)
        .map_err(|error| CoreError::Network(format!("Ollama answered unexpectedly: {error}")))?;
    Ok(tags
        .models
        .into_iter()
        .map(|tag| OllamaModel {
            name: tag.name,
            size: tag.size,
            parameter_size: tag.details.and_then(|details| details.parameter_size),
        })
        .collect())
}

/// One non-streaming chat turn with the answer schema as `format`; returns the raw JSON text.
pub async fn complete(
    base: &str,
    model: &str,
    system: &str,
    user: &str,
    cancel: &CancellationToken,
) -> Result<String, CoreError> {
    let request = serde_json::json!({
        "model": model,
        "stream": false,
        "think": false,
        "format": answer_schema(),
        "options": { "temperature": 0 },
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
    });
    let send = reqwest::Client::new()
        .post(endpoint(base, "/api/chat")?)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(request.to_string())
        .send();
    let response = tokio::select! {
        () = cancel.cancelled() => return Err(CoreError::Cancelled),
        response = send => response.and_then(reqwest::Response::error_for_status).map_err(network)?,
    };
    let body = tokio::select! {
        () = cancel.cancelled() => return Err(CoreError::Cancelled),
        body = response.bytes() => body.map_err(network)?,
    };
    let chat: ChatResponse = serde_json::from_slice(&body)
        .map_err(|error| CoreError::Network(format!("Ollama answered unexpectedly: {error}")))?;
    Ok(chat.message.content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_http_addresses() {
        assert_eq!(
            endpoint("http://localhost:11434", "/api/tags")
                .unwrap()
                .as_str(),
            "http://localhost:11434/api/tags"
        );
        assert!(endpoint("file:///etc/passwd", "/api/tags").is_err());
        assert!(endpoint("not a url", "/api/tags").is_err());
    }
}
