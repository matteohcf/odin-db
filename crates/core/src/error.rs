use serde::{Deserialize, Serialize};

/// Stable error classification exposed to the UI, which switches on it exhaustively.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    Cancelled,
    Validation,
    Internal,
}

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("operation cancelled")]
    Cancelled,
    #[error("invalid input: {0}")]
    Validation(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl CoreError {
    #[must_use]
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::Cancelled => ErrorKind::Cancelled,
            Self::Validation(_) => ErrorKind::Validation,
            Self::Internal(_) => ErrorKind::Internal,
        }
    }
}
