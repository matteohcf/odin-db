//! Server status and running operations, for the server monitor.

use bson::{Bson, Document, doc};
use serde::Serialize;

use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::ejson::{EJsonDocument, EJsonValue, number_of};

/// One `serverStatus` sample. Counters are cumulative since startup; the UI
/// turns two samples into rates.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub host: String,
    pub version: String,
    /// `mongod` or `mongos`.
    pub process: String,
    pub uptime_seconds: f64,
    pub connections_current: f64,
    pub connections_available: f64,
    pub opcounters: Opcounters,
    pub resident_mb: f64,
    pub virtual_mb: f64,
    pub network_bytes_in: f64,
    pub network_bytes_out: f64,
    /// Unix milliseconds, from the server's clock.
    pub sampled_at: f64,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Opcounters {
    pub insert: f64,
    pub query: f64,
    pub update: f64,
    pub delete: f64,
    pub getmore: f64,
    pub command: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CurrentOp {
    /// A number on mongod, `"shard:number"` on mongos: passed back as is to kill it.
    pub opid: EJsonValue,
    pub op: String,
    pub ns: String,
    pub secs_running: f64,
    pub client: Option<String>,
    pub app_name: Option<String>,
    pub description: Option<String>,
    pub waiting_for_lock: bool,
    /// What the operation runs, as reported (the server truncates long ones).
    pub command: Option<EJsonDocument>,
}

const MAX_OPS: i64 = 200;

pub async fn server_status(handle: &ConnectionHandle) -> Result<ServerStatus, CoreError> {
    // Leave out the heavy sections; only these fields are shown.
    let status = handle
        .client
        .database("admin")
        .run_command(doc! {
            "serverStatus": 1,
            "metrics": 0,
            "locks": 0,
            "wiredTiger": 0,
            "tcmalloc": 0,
            "transactions": 0,
            "opLatencies": 0,
        })
        .await?;
    let section = |name: &str| status.get_document(name).cloned().unwrap_or_default();
    let number = |document: &Document, key: &str| document.get(key).map_or(0.0, number_of);
    let connections = section("connections");
    let opcounters = section("opcounters");
    let memory = section("mem");
    let network = section("network");
    Ok(ServerStatus {
        host: status.get_str("host").unwrap_or_default().to_owned(),
        version: status.get_str("version").unwrap_or_default().to_owned(),
        process: status.get_str("process").unwrap_or_default().to_owned(),
        uptime_seconds: number(&status, "uptime"),
        connections_current: number(&connections, "current"),
        connections_available: number(&connections, "available"),
        opcounters: Opcounters {
            insert: number(&opcounters, "insert"),
            query: number(&opcounters, "query"),
            update: number(&opcounters, "update"),
            delete: number(&opcounters, "delete"),
            getmore: number(&opcounters, "getmore"),
            command: number(&opcounters, "command"),
        },
        resident_mb: number(&memory, "resident"),
        virtual_mb: number(&memory, "virtual"),
        network_bytes_in: number(&network, "bytesIn"),
        network_bytes_out: number(&network, "bytesOut"),
        #[allow(clippy::cast_precision_loss)]
        sampled_at: status
            .get_datetime("localTime")
            .map_or(0.0, |time| time.timestamp_millis() as f64),
    })
}

/// Operations running now, longest first. Other users' operations need the
/// `inprog` privilege; without it the list falls back to the user's own.
pub async fn current_ops(handle: &ConnectionHandle) -> Result<Vec<CurrentOp>, CoreError> {
    match list_ops(handle, true).await {
        Err(error) if unauthorized(&error) => Ok(list_ops(handle, false).await?),
        result => Ok(result?),
    }
}

fn unauthorized(error: &mongodb::error::Error) -> bool {
    const UNAUTHORIZED: i32 = 13;
    matches!(*error.kind, mongodb::error::ErrorKind::Command(ref command) if command.code == UNAUTHORIZED)
}

async fn list_ops(
    handle: &ConnectionHandle,
    all_users: bool,
) -> mongodb::error::Result<Vec<CurrentOp>> {
    let pipeline = vec![
        doc! { "$currentOp": { "allUsers": all_users, "idleConnections": false } },
        doc! { "$match": {
            "active": true,
            // Not this very listing.
            "command.pipeline.0.$currentOp": { "$exists": false },
        } },
        doc! { "$sort": { "secs_running": -1 } },
        doc! { "$limit": MAX_OPS },
    ];
    let mut cursor = handle.client.database("admin").aggregate(pipeline).await?;
    let mut ops = Vec::new();
    while cursor.advance().await? {
        let op = cursor.deserialize_current()?;
        let text = |key: &str| op.get_str(key).ok().map(str::to_owned);
        ops.push(CurrentOp {
            opid: EJsonValue::from(op.get("opid").cloned().unwrap_or(Bson::Null)),
            op: text("op").unwrap_or_default(),
            ns: text("ns").unwrap_or_default(),
            secs_running: op.get("secs_running").map_or(0.0, number_of),
            client: text("client").or_else(|| text("client_s")),
            app_name: text("appName"),
            description: text("desc"),
            waiting_for_lock: op.get_bool("waitingForLock").unwrap_or(false),
            command: op
                .get_document("command")
                .ok()
                .cloned()
                .map(EJsonDocument::from),
        });
    }
    Ok(ops)
}

/// A replica set as the connected member sees it (`replSetGetStatus`).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReplicaSetStatus {
    pub set: String,
    pub members: Vec<ReplicaMember>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReplicaMember {
    pub name: String,
    /// `PRIMARY`, `SECONDARY`, `ARBITER`, `RECOVERING`…
    pub state: String,
    pub healthy: bool,
    /// The member this connection talks to.
    pub is_self: bool,
    pub uptime_seconds: f64,
    /// Round trip from the connected member; none for itself.
    pub ping_ms: Option<f64>,
    /// How far its oplog is behind the primary's; none without a primary or for arbiters.
    pub lag_seconds: Option<f64>,
    pub sync_source: Option<String>,
    /// Why a member is unreachable or unhealthy, as the server says.
    pub message: Option<String>,
}

/// The replica set's members, or `None` when the server is not part of one (standalone,
/// mongos).
pub async fn replica_set_status(
    handle: &ConnectionHandle,
) -> Result<Option<ReplicaSetStatus>, CoreError> {
    const NOT_A_REPLICA_SET: [i32; 2] = [76, 59];
    let status = match handle
        .client
        .database("admin")
        .run_command(doc! { "replSetGetStatus": 1 })
        .await
    {
        Err(error)
            if matches!(*error.kind, mongodb::error::ErrorKind::Command(ref command)
                if NOT_A_REPLICA_SET.contains(&command.code)) =>
        {
            return Ok(None);
        }
        result => result?,
    };
    Ok(Some(parse_replica_set(&status)))
}

fn parse_replica_set(status: &Document) -> ReplicaSetStatus {
    let members: Vec<&Document> = status
        .get_array("members")
        .map(|members| members.iter().filter_map(Bson::as_document).collect())
        .unwrap_or_default();
    #[allow(clippy::cast_precision_loss)]
    let optime = |member: &Document| {
        member
            .get_datetime("optimeDate")
            .ok()
            .map(|date| date.timestamp_millis() as f64)
    };
    let primary = members
        .iter()
        .find(|member| member.get_str("stateStr").ok() == Some("PRIMARY"))
        .and_then(|member| optime(member));
    let text = |member: &Document, key: &str| {
        member
            .get_str(key)
            .ok()
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    ReplicaSetStatus {
        set: status.get_str("set").unwrap_or_default().to_owned(),
        members: members
            .into_iter()
            .map(|member| {
                let state = member.get_str("stateStr").unwrap_or_default().to_owned();
                ReplicaMember {
                    name: member.get_str("name").unwrap_or_default().to_owned(),
                    healthy: member.get("health").is_some_and(|h| number_of(h) >= 1.0),
                    is_self: member.get_bool("self").unwrap_or(false),
                    uptime_seconds: member.get("uptime").map_or(0.0, number_of),
                    ping_ms: member.get("pingMs").map(number_of),
                    lag_seconds: match (primary, optime(member)) {
                        (Some(primary), Some(own)) if state != "ARBITER" => {
                            Some(((primary - own) / 1000.0).max(0.0))
                        }
                        _ => None,
                    },
                    sync_source: text(member, "syncSourceHost"),
                    message: text(member, "lastHeartbeatMessage")
                        .or_else(|| text(member, "infoMessage")),
                    state,
                }
            })
            .collect(),
    }
}

/// Asks the server to stop an operation. Read-only profiles cannot.
pub async fn kill_op(handle: &ConnectionHandle, opid: EJsonValue) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    handle
        .client
        .database("admin")
        .run_command(doc! { "killOp": 1, "op": Bson::try_from(opid)? })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use bson::DateTime;

    #[test]
    fn replica_members_get_their_lag_behind_the_primary() {
        let at = |millis: i64| DateTime::from_millis(millis);
        let status = doc! {
            "set": "rs0",
            "members": [
                { "name": "a:27017", "stateStr": "PRIMARY", "health": 1.0, "self": true,
                  "uptime": 100, "optimeDate": at(10_000) },
                { "name": "b:27017", "stateStr": "SECONDARY", "health": 1.0, "uptime": 90,
                  "pingMs": 3_i64, "optimeDate": at(7_500), "syncSourceHost": "a:27017" },
                { "name": "c:27017", "stateStr": "(not reachable/healthy)", "health": 0.0,
                  "lastHeartbeatMessage": "connection refused" },
            ],
        };
        let parsed = parse_replica_set(&status);
        assert_eq!(parsed.set, "rs0");
        let [a, b, c] = parsed.members.as_slice() else {
            panic!("three members")
        };
        assert!(a.is_self && a.healthy && a.lag_seconds == Some(0.0));
        assert_eq!((b.lag_seconds, b.ping_ms), (Some(2.5), Some(3.0)));
        assert_eq!(b.sync_source.as_deref(), Some("a:27017"));
        assert!(!c.healthy && c.lag_seconds.is_none());
        assert_eq!(c.message.as_deref(), Some("connection refused"));
    }
}
