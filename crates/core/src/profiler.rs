//! The database profiler: its level, and the slow operations it recorded (ADR-0042).

use bson::{Bson, Document, doc};
use serde::{Deserialize, Serialize};

use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::ejson::EJsonDocument;

/// Entries returned at most; the profiler's collection is capped anyway.
const MAX_ENTRIES: i64 = 500;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ProfilingLevel {
    Off,
    /// Operations slower than the threshold.
    Slow,
    All,
}

impl ProfilingLevel {
    fn code(self) -> i32 {
        match self {
            Self::Off => 0,
            Self::Slow => 1,
            Self::All => 2,
        }
    }

    fn from_code(code: i64) -> Self {
        match code {
            1 => Self::Slow,
            2 => Self::All,
            _ => Self::Off,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ProfilingStatus {
    pub level: ProfilingLevel,
    /// Operations at least this long count as slow, in milliseconds.
    pub slow_ms: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ProfileQuery {
    pub database: String,
    /// Only operations on this collection.
    pub collection: Option<String>,
    /// Only operations at least this long, in milliseconds.
    pub min_millis: Option<f64>,
}

/// One recorded operation, with what tells whether it needs an index.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ProfileEntry {
    /// Milliseconds since the epoch.
    pub at: f64,
    pub op: String,
    pub ns: String,
    pub millis: f64,
    pub docs_examined: Option<f64>,
    pub keys_examined: Option<f64>,
    pub returned: Option<f64>,
    /// `COLLSCAN` or `IXSCAN { field: 1 }`, as the server summarises the plan.
    pub plan_summary: Option<String>,
    pub app_name: Option<String>,
    pub command: Option<EJsonDocument>,
}

pub async fn status(
    handle: &ConnectionHandle,
    database: &str,
) -> Result<ProfilingStatus, CoreError> {
    let reply = handle
        .client
        .database(database)
        .run_command(doc! { "profile": -1 })
        .await?;
    Ok(ProfilingStatus {
        level: ProfilingLevel::from_code(reply.get("was").map_or(0, integer)),
        #[allow(clippy::cast_precision_loss)]
        slow_ms: reply.get("slowms").map_or(100, integer) as f64,
    })
}

/// Changes what the database records. A server setting, so read-only profiles cannot.
pub async fn set_status(
    handle: &ConnectionHandle,
    database: &str,
    status: ProfilingStatus,
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    if !status.slow_ms.is_finite() || status.slow_ms < 0.0 {
        return Err(CoreError::Validation(
            "the threshold must be 0 ms or more".into(),
        ));
    }
    #[allow(clippy::cast_possible_truncation)]
    let slow_ms = status.slow_ms.round() as i64;
    handle
        .client
        .database(database)
        .run_command(doc! { "profile": status.level.code(), "slowms": slow_ms })
        .await?;
    Ok(())
}

/// Recorded operations, most recent first.
pub async fn entries(
    handle: &ConnectionHandle,
    query: ProfileQuery,
) -> Result<Vec<ProfileEntry>, CoreError> {
    let mut filter = Document::new();
    if let Some(collection) = query.collection.filter(|name| !name.is_empty()) {
        filter.insert("ns", format!("{}.{collection}", query.database));
    }
    if let Some(min) = query.min_millis.filter(|min| *min > 0.0) {
        filter.insert("millis", doc! { "$gte": min });
    }
    let mut cursor = handle
        .client
        .database(&query.database)
        .collection::<Document>("system.profile")
        .find(filter)
        .sort(doc! { "ts": -1 })
        .limit(MAX_ENTRIES)
        .await?;
    let mut entries = Vec::new();
    while cursor.advance().await? {
        entries.push(entry(&cursor.deserialize_current()?));
    }
    Ok(entries)
}

fn entry(document: &Document) -> ProfileEntry {
    let text = |key: &str| document.get_str(key).ok().map(str::to_owned);
    #[allow(clippy::cast_precision_loss)]
    let number = |key: &str| document.get(key).map(|value| integer(value) as f64);
    ProfileEntry {
        #[allow(clippy::cast_precision_loss)]
        at: document
            .get_datetime("ts")
            .map_or(0.0, |ts| ts.timestamp_millis() as f64),
        op: text("op").unwrap_or_default(),
        ns: text("ns").unwrap_or_default(),
        millis: number("millis").unwrap_or(0.0),
        docs_examined: number("docsExamined"),
        keys_examined: number("keysExamined"),
        returned: number("nreturned"),
        plan_summary: text("planSummary"),
        app_name: text("appName"),
        command: document
            .get_document("command")
            .ok()
            .cloned()
            .map(EJsonDocument::from),
    }
}

/// Servers report these counters as Int32, Int64 or Double depending on version.
#[expect(
    clippy::wildcard_enum_match_arm,
    reason = "every non-numeric BSON type counts as 0"
)]
fn integer(value: &Bson) -> i64 {
    match value {
        Bson::Int32(value) => i64::from(*value),
        Bson::Int64(value) => *value,
        #[allow(clippy::cast_possible_truncation)]
        Bson::Double(value) => *value as i64,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_entry_whatever_the_number_types() {
        let entry = entry(&doc! {
            "op": "query",
            "ns": "shop.users",
            "millis": 152_i64,
            "docsExamined": 120_000,
            "keysExamined": 0.0,
            "nreturned": 3,
            "planSummary": "COLLSCAN",
            "command": { "find": "users", "filter": { "email": "a@b.c" } },
        });
        assert_eq!(entry.millis, 152.0);
        assert_eq!(entry.docs_examined, Some(120_000.0));
        assert_eq!(entry.keys_examined, Some(0.0));
        assert_eq!(entry.plan_summary.as_deref(), Some("COLLSCAN"));
        assert!(entry.command.is_some());
        assert!(entry.app_name.is_none());
    }

    #[test]
    fn levels_round_trip_through_their_codes() {
        for level in [
            ProfilingLevel::Off,
            ProfilingLevel::Slow,
            ProfilingLevel::All,
        ] {
            assert_eq!(ProfilingLevel::from_code(i64::from(level.code())), level);
        }
    }
}
