//! Backup and restore through MongoDB Database Tools (ADR-0015).
//!
//! Credentials never appear on the command line: the password goes into a
//! temporary `--config` file readable only by the current user, deleted when the
//! process ends.

pub mod history;
pub mod schedule;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::CoreError;
use crate::ejson::EJsonDocument;
use crate::secrets::Secret;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatabaseTools {
    pub mongodump: PathBuf,
    pub mongorestore: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ToolsStatus {
    pub available: bool,
    pub version: Option<String>,
}

/// Bundled tools first (shipped next to the app), then the user's `PATH`.
#[must_use]
pub fn locate_tools(bundled_dir: Option<&Path>) -> Option<DatabaseTools> {
    let find = |name: &str| {
        let file = if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.to_owned()
        };
        bundled_dir
            .into_iter()
            .map(Path::to_path_buf)
            .chain(
                std::env::var_os("PATH")
                    .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
                    .unwrap_or_default(),
            )
            .map(|dir| dir.join(&file))
            .find(|candidate| candidate.is_file())
    };
    Some(DatabaseTools {
        mongodump: find("mongodump")?,
        mongorestore: find("mongorestore")?,
    })
}

pub async fn tools_version(tools: &DatabaseTools) -> Option<String> {
    let output = Command::new(&tools.mongodump)
        .arg("--version")
        .output()
        .await
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .next()?
        .strip_prefix("mongodump version: ")
        .map(str::to_owned)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BackupScope {
    Deployment,
    Database {
        database: String,
    },
    Collection {
        database: String,
        collection: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BackupRequest {
    pub scope: BackupScope,
    pub gzip: bool,
    /// Database backups only: collections to leave out.
    #[serde(default)]
    pub exclude_collections: Vec<String>,
    /// Collection backups only: back up just the documents matching this filter.
    #[serde(default)]
    pub query: Option<EJsonDocument>,
    /// Whole-server backups of a replica set only: include the oplog for a
    /// point-in-time snapshot (`--oplog`).
    #[serde(default)]
    pub oplog: bool,
}

impl BackupRequest {
    /// A plain gzipped backup of `scope`, as schedules run it.
    #[must_use]
    pub fn of(scope: BackupScope) -> Self {
        Self {
            scope,
            gzip: true,
            exclude_collections: Vec::new(),
            query: None,
            oplog: false,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum RestoreSource {
    /// A single file written by `mongodump --archive`, gzipped or not.
    Archive,
    /// A directory written by `mongodump --out`.
    Directory,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RestoreRequest {
    pub source: RestoreSource,
    /// Drop each collection before restoring it. Destructive: confirmed in the UI.
    pub drop: bool,
    /// Restore only this database, optionally under a new name.
    pub database: Option<String>,
    pub rename_to: Option<String>,
    /// Restore only these namespaces (`db.collection`), as listed by
    /// `archive_contents`. Empty means everything (or the whole `database`).
    #[serde(default)]
    pub namespaces: Vec<String>,
    /// Replay the oplog of a `--oplog` backup for a point-in-time restore.
    #[serde(default)]
    pub oplog_replay: bool,
}

/// A line of tool output, classified for the UI.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ToolEvent {
    /// A collection finished, with its document count.
    Collection {
        namespace: String,
        documents: f64,
        failures: f64,
    },
    Log {
        line: String,
    },
}

#[derive(Debug, Clone, Serialize, Default)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ToolSummary {
    pub collections: f64,
    pub documents: f64,
    pub failures: f64,
}

/// Connection details the tools need. The URI must not contain a password.
pub struct ToolConnection<'a> {
    pub uri: &'a str,
    pub password: Option<&'a Secret>,
    /// Restores are refused on read-only profiles (ADR-0017).
    pub read_only: bool,
}

pub async fn backup(
    tools: &DatabaseTools,
    connection: ToolConnection<'_>,
    request: &BackupRequest,
    archive: &Path,
    events: mpsc::Sender<ToolEvent>,
    cancel: CancellationToken,
) -> Result<ToolSummary, CoreError> {
    let args = backup_args(request, archive)?;
    let result = run_tool(&tools.mongodump, connection, args, events, cancel).await;
    if result.is_err() {
        // Never leave a truncated archive that looks like a valid backup.
        let _ = tokio::fs::remove_file(archive).await;
    }
    result
}

pub async fn restore(
    tools: &DatabaseTools,
    connection: ToolConnection<'_>,
    request: &RestoreRequest,
    source: &Path,
    events: mpsc::Sender<ToolEvent>,
    cancel: CancellationToken,
) -> Result<ToolSummary, CoreError> {
    if connection.read_only {
        return Err(CoreError::ReadOnly);
    }
    run_tool(
        &tools.mongorestore,
        connection,
        restore_args(request, source),
        events,
        cancel,
    )
    .await
}

fn backup_args(request: &BackupRequest, archive: &Path) -> Result<Vec<String>, CoreError> {
    let mut args = vec![format!("--archive={}", archive.display())];
    if request.gzip {
        args.push("--gzip".into());
    }
    let only = |what: &str| CoreError::Validation(format!("{what} only apply to some backups"));
    match &request.scope {
        BackupScope::Deployment => {
            if request.oplog {
                args.push("--oplog".into());
            }
        }
        BackupScope::Database { database } => {
            args.push(format!("--db={database}"));
            for collection in &request.exclude_collections {
                args.push(format!("--excludeCollection={collection}"));
            }
        }
        BackupScope::Collection {
            database,
            collection,
        } => {
            args.push(format!("--db={database}"));
            args.push(format!("--collection={collection}"));
            if let Some(query) = &request.query {
                let json = serde_json::to_string(query)
                    .map_err(|error| CoreError::Internal(error.to_string()))?;
                args.push(format!("--query={json}"));
            }
        }
    }
    let scope_allows = match &request.scope {
        BackupScope::Deployment => {
            request.exclude_collections.is_empty() && request.query.is_none()
        }
        BackupScope::Database { .. } => !request.oplog && request.query.is_none(),
        BackupScope::Collection { .. } => !request.oplog && request.exclude_collections.is_empty(),
    };
    if !scope_allows {
        return Err(only("these options"));
    }
    Ok(args)
}

fn restore_args(request: &RestoreRequest, source: &Path) -> Vec<String> {
    let mut args = match request.source {
        RestoreSource::Archive => {
            let mut args = vec![format!("--archive={}", source.display())];
            if is_gzipped(source) {
                args.push("--gzip".into());
            }
            args
        }
        RestoreSource::Directory => vec![format!("--dir={}", source.display())],
    };
    if request.drop {
        args.push("--drop".into());
    }
    if request.oplog_replay {
        args.push("--oplogReplay".into());
    }
    for namespace in &request.namespaces {
        args.push(format!("--nsInclude={namespace}"));
    }
    if let Some(database) = request.database.as_deref().filter(|d| !d.is_empty()) {
        if request.namespaces.is_empty() {
            args.push(format!("--nsInclude={database}.*"));
        }
        if let Some(target) = request
            .rename_to
            .as_deref()
            .filter(|t| !t.is_empty() && *t != database)
        {
            args.push(format!("--nsFrom={database}.*"));
            args.push(format!("--nsTo={target}.*"));
        }
    }
    args
}

fn is_gzipped(path: &Path) -> bool {
    std::fs::File::open(path)
        .and_then(|mut file| {
            let mut magic = [0_u8; 2];
            std::io::Read::read_exact(&mut file, &mut magic).map(|()| magic == [0x1f, 0x8b])
        })
        .unwrap_or(false)
}

async fn run_tool(
    program: &Path,
    connection: ToolConnection<'_>,
    args: Vec<String>,
    events: mpsc::Sender<ToolEvent>,
    cancel: CancellationToken,
) -> Result<ToolSummary, CoreError> {
    let (mut command, config) = tool_command(program, &connection, &args)?;
    let mut child = command.spawn().map_err(|error| {
        CoreError::Internal(format!("cannot start {}: {error}", program.display()))
    })?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| CoreError::Internal("no tool output".into()))?;
    let mut lines = BufReader::new(stderr).lines();

    let mut summary = ToolSummary::default();
    let mut failure: Option<String> = None;
    loop {
        let line = tokio::select! {
            biased;
            () = cancel.cancelled() => {
                let _ = child.kill().await;
                return Err(CoreError::Cancelled);
            }
            line = lines.next_line() => line.map_err(|error| CoreError::Internal(error.to_string()))?,
        };
        let Some(line) = line else { break };
        let message = strip_timestamp(&line);
        if let Some(reason) = message.strip_prefix("Failed: ") {
            failure = Some(reason.to_owned());
        }
        let event = parse_line(message);
        if let ToolEvent::Collection {
            documents,
            failures,
            ..
        } = &event
        {
            summary.collections += 1.0;
            summary.documents += documents;
            summary.failures += failures;
        }
        // Lossy on purpose: a slow consumer must never stop us draining stderr, or the
        // tool would block on a full pipe. The summary is computed here, so it stays exact.
        let _ = events.try_send(event);
    }

    let status = child
        .wait()
        .await
        .map_err(|error| CoreError::Internal(error.to_string()))?;
    drop(config);
    if status.success() {
        Ok(summary)
    } else {
        Err(CoreError::Database(failure.unwrap_or_else(|| {
            format!("the tool exited with {status}")
        })))
    }
}

/// The tool invocation; the returned file holds the password and must outlive the process.
fn tool_command(
    program: &Path,
    connection: &ToolConnection<'_>,
    args: &[String],
) -> Result<(Command, Option<PasswordFile>), CoreError> {
    let config = connection.password.map(PasswordFile::create).transpose()?;
    let mut command = Command::new(program);
    command
        .arg(format!("--uri={}", connection.uri))
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(config) = &config {
        command.arg(format!("--config={}", config.path.display()));
    }
    Ok((command, config))
}

/// The namespaces (`db.collection`) in a backup, read with a `mongorestore`
/// dry run, which writes nothing. System namespaces are left out.
pub async fn archive_contents(
    tools: &DatabaseTools,
    connection: ToolConnection<'_>,
    source: RestoreSource,
    path: &Path,
) -> Result<Vec<String>, CoreError> {
    let request = RestoreRequest {
        source,
        drop: false,
        database: None,
        rename_to: None,
        namespaces: Vec::new(),
        oplog_replay: false,
    };
    let mut args = restore_args(&request, path);
    args.extend(["--dryRun".into(), "--verbose".into()]);
    let (mut command, config) = tool_command(&tools.mongorestore, &connection, &args)?;
    let output = command
        .output()
        .await
        .map_err(|error| CoreError::Internal(format!("cannot read the backup: {error}")))?;
    drop(config);
    let text = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        let reason = text
            .lines()
            .map(strip_timestamp)
            .find_map(|line| line.strip_prefix("Failed: "))
            .unwrap_or("the backup could not be read");
        return Err(CoreError::Validation(reason.to_owned()));
    }
    Ok(namespaces_in(&text))
}

/// Namespaces named by a verbose dry run, in order, without duplicates.
fn namespaces_in(output: &str) -> Vec<String> {
    let mut namespaces: Vec<String> = Vec::new();
    for line in output.lines().map(strip_timestamp) {
        let named = line.starts_with("archive prelude") || line.starts_with("found collection `");
        let Some(namespace) = line.split('`').nth(1).filter(|_| named) else {
            continue;
        };
        let system = namespace.starts_with("admin.")
            || namespace.starts_with("config.")
            || namespace.starts_with("local.")
            || namespace.contains(".system.");
        if !system && !namespaces.iter().any(|known| known == namespace) {
            namespaces.push(namespace.to_owned());
        }
    }
    namespaces
}

/// Tool lines start with an RFC 3339 timestamp and a tab.
fn strip_timestamp(line: &str) -> &str {
    line.split_once('\t').map_or(line, |(_, rest)| rest)
}

fn parse_line(message: &str) -> ToolEvent {
    let namespace = || message.split('`').nth(1).map(str::to_owned);
    let numbers = || {
        let inside = message
            .rsplit_once('(')
            .map(|(_, rest)| rest.trim_end_matches(')'));
        inside
            .map(|text| {
                text.split(',')
                    .filter_map(|part| part.trim().split(' ').next()?.parse::<f64>().ok())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };
    if (message.starts_with("done dumping") || message.starts_with("finished restoring"))
        && let Some(namespace) = namespace()
    {
        let numbers = numbers();
        return ToolEvent::Collection {
            namespace,
            documents: numbers.first().copied().unwrap_or(0.0),
            failures: numbers.get(1).copied().unwrap_or(0.0),
        };
    }
    ToolEvent::Log {
        line: message.to_owned(),
    }
}

/// A `--config` file holding the password, readable by the owner only, removed on drop.
struct PasswordFile {
    path: PathBuf,
}

impl PasswordFile {
    fn create(password: &Secret) -> Result<Self, CoreError> {
        let path = std::env::temp_dir().join(format!("odin-db-{}.yaml", uuid::Uuid::now_v7()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        // On Windows the per-user temp directory is already private to the user.
        let mut file = options.open(&path).map_err(|error| {
            CoreError::Internal(format!("cannot create the credentials file: {error}"))
        })?;
        let escaped = password.expose().replace('\\', "\\\\").replace('"', "\\\"");
        writeln!(file, "password: \"{escaped}\"").map_err(|error| {
            CoreError::Internal(format!("cannot write the credentials file: {error}"))
        })?;
        Ok(Self { path })
    }
}

impl Drop for PasswordFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_namespaces_from_a_dry_run() {
        let output = "2026-10-17T18:40:39.207+0200\tarchive prelude `crm.leads`\n\
            2026-10-17T18:40:39.207+0200\tarchive prelude `admin.system.version`\n\
            2026-10-17T18:40:39.207+0200\tfound collection `shop.users` bson to restore to `shop.users`\n\
            2026-10-17T18:40:39.207+0200\tfound collection metadata from `shop.users` to restore to `shop.users`\n\
            2026-10-17T18:40:39.207+0200\tarchive prelude `crm.leads`\n";
        assert_eq!(super::namespaces_in(output), ["crm.leads", "shop.users"]);
    }

    #[test]
    fn backup_options_map_to_tool_flags() {
        use super::{BackupRequest, BackupScope, backup_args};
        let path = std::path::Path::new("/tmp/a.gz");
        let mut request = BackupRequest::of(BackupScope::Database {
            database: "shop".into(),
        });
        request.exclude_collections = vec!["logs".into()];
        let args = backup_args(&request, path).unwrap();
        assert!(args.contains(&"--excludeCollection=logs".to_owned()));

        let mut request = BackupRequest::of(BackupScope::Collection {
            database: "shop".into(),
            collection: "orders".into(),
        });
        request.query = Some(crate::ejson::EJsonDocument::from(
            bson::doc! { "paid": true },
        ));
        let args = backup_args(&request, path).unwrap();
        assert!(args.contains(&r#"--query={"paid":true}"#.to_owned()));

        request.oplog = true;
        assert!(
            backup_args(&request, path).is_err(),
            "--oplog needs a whole-server backup"
        );
    }

    use super::*;

    #[test]
    fn parses_tool_output() {
        let done = strip_timestamp(
            "2026-10-17T14:53:18.248+0200\tdone dumping `shop.users` (3000 documents)",
        );
        assert_eq!(
            parse_line(done),
            ToolEvent::Collection {
                namespace: "shop.users".into(),
                documents: 3000.0,
                failures: 0.0
            }
        );
        assert_eq!(
            parse_line("finished restoring `copy.orders` (1 document, 2 failures)"),
            ToolEvent::Collection {
                namespace: "copy.orders".into(),
                documents: 1.0,
                failures: 2.0
            }
        );
        assert_eq!(
            parse_line("writing `shop.users` to archive"),
            ToolEvent::Log {
                line: "writing `shop.users` to archive".into()
            }
        );
    }

    #[test]
    fn builds_restore_arguments() {
        let request = RestoreRequest {
            source: RestoreSource::Directory,
            drop: true,
            database: Some("shop".into()),
            rename_to: Some("shop_copy".into()),
            namespaces: Vec::new(),
            oplog_replay: false,
        };
        assert_eq!(
            restore_args(&request, Path::new("/dumps/x")),
            [
                "--dir=/dumps/x",
                "--drop",
                "--nsInclude=shop.*",
                "--nsFrom=shop.*",
                "--nsTo=shop_copy.*"
            ]
        );
    }

    #[test]
    fn password_file_is_private_and_removed() {
        let file = PasswordFile::create(&Secret::new("p\"w\\d")).expect("create");
        let contents = std::fs::read_to_string(&file.path).expect("read");
        assert_eq!(contents, "password: \"p\\\"w\\\\d\"\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&file.path)
                .expect("meta")
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let path = file.path.clone();
        drop(file);
        assert!(!path.exists());
    }

    #[test]
    fn selected_namespaces_replace_the_database_filter() {
        let request = RestoreRequest {
            source: RestoreSource::Archive,
            drop: false,
            database: Some("shop".into()),
            rename_to: Some("shop_copy".into()),
            namespaces: vec!["shop.orders".into()],
            oplog_replay: true,
        };
        let args = restore_args(&request, Path::new("/dumps/x.archive"));
        assert!(args.contains(&"--nsInclude=shop.orders".to_owned()));
        assert!(!args.contains(&"--nsInclude=shop.*".to_owned()));
        assert!(args.contains(&"--nsFrom=shop.*".to_owned()));
        assert!(args.contains(&"--oplogReplay".to_owned()));
    }
}
