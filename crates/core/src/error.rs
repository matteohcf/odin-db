use serde::{Deserialize, Serialize};

/// Stable error classification exposed to the UI, which switches on it exhaustively.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    Cancelled,
    Validation,
    NotFound,
    NotConnected,
    ReadOnly,
    Auth,
    Network,
    CursorExpired,
    /// The server stopped the operation at its time limit (`maxTimeMS`).
    TimeLimit,
    Database,
    Storage,
    SecretStore,
    /// A download failed verification: damaged in transit, or altered.
    Integrity,
    /// An SSH server presented a host key the profile does not trust yet.
    UnknownHostKey,
    /// An SSH server presented a different key than the one trusted before.
    HostKeyChanged,
    Internal,
}

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("operation cancelled")]
    Cancelled,
    #[error("invalid input: {0}")]
    Validation(String),
    #[error("{0} not found")]
    NotFound(&'static str),
    #[error("connection is not open")]
    NotConnected,
    #[error("this connection is read-only")]
    ReadOnly,
    #[error("authentication failed: {0}")]
    Auth(String),
    #[error("cannot reach the server: {0}")]
    Network(String),
    #[error("the result cursor expired on the server; run the query again")]
    CursorExpired,
    #[error("the server stopped it at its time limit: {0}")]
    TimeLimit(String),
    #[error("{0}")]
    Database(String),
    #[error("local storage error: {0}")]
    Storage(String),
    #[error("system keyring error: {0}")]
    SecretStore(String),
    #[error("{0}")]
    Integrity(String),
    #[error("the SSH server's host key ({0}) is not trusted yet")]
    UnknownHostKey(String),
    #[error("the SSH server's host key changed to {0}: someone may be intercepting the connection")]
    HostKeyChanged(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl CoreError {
    /// Data the UI needs to act on the error, such as a host key fingerprint.
    #[must_use]
    pub fn detail(&self) -> Option<String> {
        match self {
            Self::UnknownHostKey(fingerprint) | Self::HostKeyChanged(fingerprint) => {
                Some(fingerprint.clone())
            }
            _ => None,
        }
    }

    #[must_use]
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::Cancelled => ErrorKind::Cancelled,
            Self::Validation(_) => ErrorKind::Validation,
            Self::NotFound(_) => ErrorKind::NotFound,
            Self::NotConnected => ErrorKind::NotConnected,
            Self::ReadOnly => ErrorKind::ReadOnly,
            Self::Auth(_) => ErrorKind::Auth,
            Self::Network(_) => ErrorKind::Network,
            Self::CursorExpired => ErrorKind::CursorExpired,
            Self::TimeLimit(_) => ErrorKind::TimeLimit,
            Self::Database(_) => ErrorKind::Database,
            Self::Storage(_) => ErrorKind::Storage,
            Self::SecretStore(_) => ErrorKind::SecretStore,
            Self::Integrity(_) => ErrorKind::Integrity,
            Self::UnknownHostKey(_) => ErrorKind::UnknownHostKey,
            Self::HostKeyChanged(_) => ErrorKind::HostKeyChanged,
            Self::Internal(_) => ErrorKind::Internal,
        }
    }
}

/// Server error code for a cursor that no longer exists (e.g. idle timeout).
const CURSOR_NOT_FOUND: i32 = 43;
/// Server error code for an operation that ran past its `maxTimeMS`.
const MAX_TIME_EXPIRED: i32 = 50;

impl From<mongodb::error::Error> for CoreError {
    fn from(error: mongodb::error::Error) -> Self {
        use mongodb::error::{ErrorKind as Kind, WriteFailure};

        let message = error.to_string();
        match *error.kind {
            Kind::Authentication { .. } => Self::Auth(message),
            Kind::ServerSelection { .. }
            | Kind::Io(_)
            | Kind::DnsResolve { .. }
            | Kind::ConnectionPoolCleared { .. }
            | Kind::InvalidTlsConfig { .. } => Self::Network(message),
            Kind::InvalidArgument { .. } => Self::Validation(message),
            Kind::Command(ref command) if command.code == CURSOR_NOT_FOUND => Self::CursorExpired,
            Kind::Command(ref command) if command.code == MAX_TIME_EXPIRED => {
                Self::TimeLimit(command.message.clone())
            }
            Kind::Command(ref command) => Self::Database(command.message.clone()),
            Kind::Write(WriteFailure::WriteError(ref write)) => {
                Self::Database(write.message.clone())
            }
            _ => Self::Database(message),
        }
    }
}

impl From<rusqlite::Error> for CoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error.to_string())
    }
}
