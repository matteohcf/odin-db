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

/// A sharded cluster as its mongos sees it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ShardingStatus {
    pub shards: Vec<Shard>,
    /// `full` (balancing), `off`, or `autoSplitOnly` on old servers.
    pub balancer_mode: String,
    /// A balancing round is moving data right now.
    pub balancer_running: bool,
    pub collections: Vec<ShardedCollection>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Shard {
    pub id: String,
    /// The shard's replica set and members, as `rs/host:port,host:port`.
    pub host: String,
    /// Being removed: its data moves to the other shards.
    pub draining: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ShardedCollection {
    pub namespace: String,
    pub key: EJsonDocument,
    pub unique: bool,
}

/// Shards, balancer and sharded collections, or `None` when not connected to a mongos.
pub async fn sharding_status(
    handle: &ConnectionHandle,
) -> Result<Option<ShardingStatus>, CoreError> {
    const NOT_A_MONGOS: [i32; 3] = [59, 115, 13_644];
    let admin = handle.client.database("admin");
    let shards = match admin.run_command(doc! { "listShards": 1 }).await {
        Err(error)
            if matches!(*error.kind, mongodb::error::ErrorKind::Command(ref command)
                if NOT_A_MONGOS.contains(&command.code)) =>
        {
            return Ok(None);
        }
        result => result?,
    };
    // The balancer state needs a privilege some users lack: then it reads as unknown.
    let balancer = admin
        .run_command(doc! { "balancerStatus": 1 })
        .await
        .unwrap_or_default();
    let mut collections = Vec::new();
    let mut cursor = handle
        .client
        .database("config")
        .collection::<Document>("collections")
        // 8.0 also tracks unsharded collections here, marked `unsplittable`.
        .find(doc! {
            "key": { "$exists": true },
            "dropped": { "$ne": true },
            "unsplittable": { "$ne": true },
        })
        .sort(doc! { "_id": 1 })
        .limit(1000)
        .await?;
    while cursor.advance().await? {
        let entry = cursor.deserialize_current()?;
        let Ok(namespace) = entry.get_str("_id") else {
            continue;
        };
        if namespace.starts_with("config.") {
            continue;
        }
        collections.push(ShardedCollection {
            namespace: namespace.to_owned(),
            key: EJsonDocument::from(entry.get_document("key").cloned().unwrap_or_default()),
            unique: entry.get_bool("unique").unwrap_or(false),
        });
    }
    Ok(Some(parse_sharding(&shards, &balancer, collections)))
}

fn parse_sharding(
    shards: &Document,
    balancer: &Document,
    collections: Vec<ShardedCollection>,
) -> ShardingStatus {
    ShardingStatus {
        shards: shards
            .get_array("shards")
            .map(|list| {
                list.iter()
                    .filter_map(Bson::as_document)
                    .map(|shard| Shard {
                        id: shard.get_str("_id").unwrap_or_default().to_owned(),
                        host: shard.get_str("host").unwrap_or_default().to_owned(),
                        draining: shard.get_bool("draining").unwrap_or(false),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        balancer_mode: balancer.get_str("mode").unwrap_or("unknown").to_owned(),
        balancer_running: balancer.get_bool("inBalancerRound").unwrap_or(false),
        collections,
    }
}

/// Time and operations spent on one collection since the server started (`top`).
/// Cumulative: two samples give the rates.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CollectionActivity {
    pub namespace: String,
    pub total_micros: f64,
    pub total_count: f64,
    pub read_micros: f64,
    pub read_count: f64,
    pub write_micros: f64,
    pub write_count: f64,
}

/// Activity per collection, or `None` where `top` does not exist (mongos).
pub async fn collection_activity(
    handle: &ConnectionHandle,
) -> Result<Option<Vec<CollectionActivity>>, CoreError> {
    const NOT_SUPPORTED: [i32; 2] = [59, 115];
    let reply = match handle
        .client
        .database("admin")
        .run_command(doc! { "top": 1 })
        .await
    {
        Err(error)
            if matches!(*error.kind, mongodb::error::ErrorKind::Command(ref command)
                if NOT_SUPPORTED.contains(&command.code)) =>
        {
            return Ok(None);
        }
        result => result?,
    };
    Ok(Some(parse_top(&reply)))
}

fn parse_top(reply: &Document) -> Vec<CollectionActivity> {
    let Ok(totals) = reply.get_document("totals") else {
        return Vec::new();
    };
    let mut activity: Vec<CollectionActivity> = totals
        .iter()
        .filter_map(|(namespace, entry)| {
            let entry = entry.as_document()?;
            // Internal namespaces: `admin.*`, `local.*`, `config.*` and `system.*` collections.
            let (database, collection) = namespace.split_once('.')?;
            if matches!(database, "admin" | "local" | "config") || collection.starts_with("system.")
            {
                return None;
            }
            let pair = |key: &str| {
                let section = entry.get_document(key).ok();
                let number =
                    |field: &str| section.and_then(|s| s.get(field)).map_or(0.0, number_of);
                (number("time"), number("count"))
            };
            let (total_micros, total_count) = pair("total");
            let (read_micros, read_count) = pair("readLock");
            let (write_micros, write_count) = pair("writeLock");
            Some(CollectionActivity {
                namespace: namespace.clone(),
                total_micros,
                total_count,
                read_micros,
                read_count,
                write_micros,
                write_count,
            })
        })
        .collect();
    activity.sort_by(|a, b| b.total_micros.total_cmp(&a.total_micros));
    activity
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
    fn sharding_reads_shards_and_balancer() {
        let status = parse_sharding(
            &doc! { "shards": [
                { "_id": "shard01", "host": "rs1/a:27018,b:27018", "state": 1 },
                { "_id": "shard02", "host": "rs2/c:27018", "draining": true },
            ] },
            &doc! { "mode": "full", "inBalancerRound": true },
            Vec::new(),
        );
        assert_eq!(status.shards.len(), 2);
        assert!(status.shards[1].draining && !status.shards[0].draining);
        assert_eq!(status.balancer_mode, "full");
        assert!(status.balancer_running);
        let unknown = parse_sharding(&doc! {}, &doc! {}, Vec::new());
        assert_eq!(unknown.balancer_mode, "unknown");
    }

    #[test]
    fn top_keeps_user_collections_busiest_first() {
        let reply = doc! { "totals": {
            "note": "all times in microseconds",
            "shop.orders": {
                "total": { "time": 900_i64, "count": 9_i64 },
                "readLock": { "time": 600_i64, "count": 6_i64 },
                "writeLock": { "time": 300_i64, "count": 3_i64 },
            },
            "shop.users": { "total": { "time": 1_500_i64, "count": 2_i64 } },
            "admin.system.users": { "total": { "time": 99_999_i64, "count": 1_i64 } },
            "shop.system.profile": { "total": { "time": 99_999_i64, "count": 1_i64 } },
        } };
        let activity = parse_top(&reply);
        let names: Vec<_> = activity.iter().map(|a| a.namespace.as_str()).collect();
        assert_eq!(names, ["shop.users", "shop.orders"]);
        assert_eq!(
            (activity[1].read_micros, activity[1].write_count),
            (600.0, 3.0)
        );
    }

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
