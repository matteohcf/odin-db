//! Integration tests against a real MongoDB in Docker (ADR-0020).
//! Ignored by default so `cargo test` stays Docker-free: run with `pnpm test:integration`.
//! `MONGO_VERSION` selects the server image tag (default 8.0).

// Fixture helpers are not `#[test]` functions, so clippy's test exemption does not reach them.
#![allow(clippy::expect_used)]

use bson::{Binary, Bson, DateTime, Decimal128, Document, doc, oid::ObjectId, spec::BinarySubtype};
use odin_core::backup::{
    BackupRequest, BackupScope, RestoreRequest, RestoreSource, ToolConnection, backup,
    locate_tools, restore, tools_version,
};
use odin_core::connection::{ConnectionHandle, ConnectionManager, test_connection};
use odin_core::ejson::{EJsonDocument, EJsonValue};
use odin_core::indexes::{self, CreateIndexRequest};
use odin_core::profiles::{self, ConnectionProfile, ProfileInput};
use odin_core::query::{
    AggregateRequest, CursorRegistry, FindRequest, Namespace, count_documents, preview_aggregation,
};
use odin_core::secrets::{MemoryStore, Secret};
use odin_core::shell::{HIGH_WATERMARK, ShellEvent, ShellOptions, ShellSession, locate_mongosh};
use odin_core::storage::Storage;
use odin_core::transfer::{
    CsvColumn, CsvType, ExportFormat, ExportRequest, ExportSource, ImportFormat, ImportOptions,
    JsonMode, TransferProgress, export_documents, import_documents,
};
use odin_core::{CoreError, browse, documents};
use std::str::FromStr;
use std::sync::Arc;
use testcontainers_modules::mongo::Mongo;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ImageExt};
use tokio_util::sync::CancellationToken;

struct Fixture {
    _container: ContainerAsync<Mongo>,
    uri: String,
    manager: ConnectionManager,
    storage: Storage,
    secrets: MemoryStore,
}

impl Fixture {
    async fn start() -> Self {
        let tag = std::env::var("MONGO_VERSION").unwrap_or_else(|_| "8.0".into());
        let container = Mongo::default()
            .with_tag(tag)
            .start()
            .await
            .expect("mongo container starts");
        let port = container
            .get_host_port_ipv4(27017)
            .await
            .expect("mapped port");
        Self {
            _container: container,
            uri: format!("mongodb://127.0.0.1:{port}/?directConnection=true"),
            manager: ConnectionManager::default(),
            storage: Storage::open_in_memory().expect("storage"),
            secrets: MemoryStore::default(),
        }
    }

    fn profile(&self, read_only: bool) -> ConnectionProfile {
        profiles::create(
            &self.storage,
            &self.secrets,
            ProfileInput {
                name: format!("test read_only={read_only}"),
                connection_string: self.uri.clone(),
                password: None,
                read_only,
            },
        )
        .expect("profile created")
    }

    async fn connect(&self, read_only: bool) -> Arc<ConnectionHandle> {
        let info = self
            .manager
            .connect(&self.profile(read_only), None)
            .await
            .expect("connects");
        self.manager.get(info.id).await.expect("registered")
    }

    async fn seed(&self, handle: &ConnectionHandle, ns: &Namespace, count: i32) {
        let docs: Vec<Document> = (0..count).map(|i| doc! { "n": i }).collect();
        handle
            .client
            .database(&ns.database)
            .collection::<Document>(&ns.collection)
            .insert_many(docs)
            .await
            .expect("seeded");
    }
}

fn namespace(collection: &str) -> Namespace {
    Namespace {
        database: "odin_test".into(),
        collection: collection.into(),
    }
}

fn find_all(batch_size: u32) -> FindRequest {
    FindRequest {
        filter: EJsonDocument::from(doc! {}),
        projection: None,
        sort: Some(EJsonDocument::from(doc! { "n": 1 })),
        skip: None,
        limit: None,
        batch_size,
    }
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn connects_lists_and_reports_server_version() {
    let fx = Fixture::start().await;
    let info = test_connection(&fx.uri, None)
        .await
        .expect("test connection");
    assert_ne!(info.server_version, "");

    let handle = fx.connect(false).await;
    let ns = namespace("people");
    fx.seed(&handle, &ns, 3).await;

    let databases = browse::list_databases(&handle).await.expect("databases");
    assert!(databases.iter().any(|db| db.name == "odin_test"));
    let collections = browse::list_collections(&handle, "odin_test")
        .await
        .expect("collections");
    assert_eq!(collections.len(), 1);
    assert_eq!(collections[0].name, "people");

    // Connecting the same profile again reuses the client.
    assert_eq!(fx.manager.list().await.len(), 1);
    fx.manager
        .disconnect(handle.info.id)
        .await
        .expect("disconnects");
    assert!(matches!(
        fx.manager.get(handle.info.id).await,
        Err(CoreError::NotConnected)
    ));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn pages_through_results_with_a_server_cursor() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = namespace("paged");
    fx.seed(&handle, &ns, 250).await;
    let cursors = CursorRegistry::default();

    let first = cursors
        .find(&handle, &ns, find_all(100))
        .await
        .expect("first page");
    assert_eq!(first.documents.len(), 100);
    let cursor = first.cursor_id.expect("more results");

    let second = cursors.fetch_more(cursor, 100).await.expect("second page");
    assert_eq!(second.documents.len(), 100);
    assert_eq!(second.cursor_id, Some(cursor));

    let last = cursors.fetch_more(cursor, 100).await.expect("last page");
    assert_eq!(last.documents.len(), 50);
    assert_eq!(last.cursor_id, None, "exhausted cursor is released");
    assert!(matches!(
        cursors.fetch_more(cursor, 100).await,
        Err(CoreError::NotFound(_))
    ));

    let count = count_documents(
        &handle,
        &ns,
        EJsonDocument::from(doc! { "n": { "$lt": 10 } }),
    )
    .await
    .expect("count");
    assert!((count - 10.0).abs() < f64::EPSILON);
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn small_results_do_not_keep_a_cursor_open() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = namespace("small");
    fx.seed(&handle, &ns, 5).await;

    let page = CursorRegistry::default()
        .find(&handle, &ns, find_all(100))
        .await
        .expect("page");
    assert_eq!(page.documents.len(), 5);
    assert_eq!(page.cursor_id, None);
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn writes_round_trip_every_bson_type_exactly() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = namespace("typed");
    let id = ObjectId::new();
    let original = doc! {
        "_id": id,
        "int32": 5_i32,
        "int64": 5_i64,
        "int64_max": i64::MAX,
        "double": 5.0_f64,
        "decimal": Decimal128::from_str("0.1").expect("decimal"),
        "date": DateTime::from_millis(1_700_000_000_000),
        "binary": Binary { subtype: BinarySubtype::Uuid, bytes: vec![7; 16] },
        "nested": { "list": [1_i32, 2_i64, 3.5_f64] },
    };

    let inserted = documents::insert(&handle, &ns, EJsonDocument::from(original.clone()))
        .await
        .expect("insert");
    assert_eq!(inserted, EJsonValue::from(Bson::ObjectId(id)));

    let mut changed = original.clone();
    changed.insert("int32", 6_i32);
    documents::replace(
        &handle,
        &ns,
        inserted.clone(),
        EJsonDocument::from(changed.clone()),
    )
    .await
    .expect("replace");

    let page = CursorRegistry::default()
        .find(&handle, &ns, find_all(10))
        .await
        .expect("read back");
    let stored = Document::try_from(page.documents[0].clone()).expect("document");
    assert_eq!(stored, changed, "every field keeps its BSON type");

    documents::delete(&handle, &ns, inserted.clone())
        .await
        .expect("delete");
    assert!(matches!(
        documents::delete(&handle, &ns, inserted).await,
        Err(CoreError::NotFound(_))
    ));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn read_only_profiles_reject_every_write() {
    let fx = Fixture::start().await;
    let handle = fx.connect(true).await;
    let ns = namespace("locked");
    let id = EJsonValue::from(Bson::Int32(1));

    assert!(matches!(
        documents::insert(&handle, &ns, EJsonDocument::from(doc! { "a": 1 })).await,
        Err(CoreError::ReadOnly)
    ));
    assert!(matches!(
        documents::replace(
            &handle,
            &ns,
            id.clone(),
            EJsonDocument::from(doc! { "a": 2 })
        )
        .await,
        Err(CoreError::ReadOnly)
    ));
    assert!(matches!(
        documents::delete(&handle, &ns, id).await,
        Err(CoreError::ReadOnly)
    ));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn wrong_credentials_are_reported_as_auth_errors() {
    let fx = Fixture::start().await;
    let uri = fx.uri.replace("mongodb://", "mongodb://nobody@");
    let result = test_connection(&uri, Some(Secret::new("wrong"))).await;
    assert!(matches!(result, Err(CoreError::Auth(_))), "got {result:?}");
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn aggregates_with_paging_and_safe_previews() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = namespace("agg");
    fx.seed(&handle, &ns, 300).await;
    let cursors = CursorRegistry::default();
    let stage = |d: Document| EJsonDocument::from(d);

    let page = cursors
        .aggregate(
            &handle,
            &ns,
            AggregateRequest {
                pipeline: vec![
                    stage(doc! { "$match": { "n": { "$gte": 100 } } }),
                    stage(doc! { "$sort": { "n": 1 } }),
                ],
                batch_size: 150,
            },
        )
        .await
        .expect("aggregate");
    assert_eq!(page.documents.len(), 150);
    let cursor = page.cursor_id.expect("more results");
    let rest = cursors.fetch_more(cursor, 150).await.expect("rest");
    assert_eq!(rest.documents.len(), 50);
    assert_eq!(rest.cursor_id, None);

    let preview = preview_aggregation(
        &handle,
        &ns,
        vec![stage(
            doc! { "$group": { "_id": null, "total": { "$sum": 1 } } },
        )],
        20,
    )
    .await
    .expect("preview");
    let total = Document::try_from(preview[0].clone()).expect("doc");
    assert_eq!(total.get_i32("total").ok(), Some(300));

    let writes = preview_aggregation(&handle, &ns, vec![stage(doc! { "$out": "copy" })], 20).await;
    assert!(matches!(writes, Err(CoreError::Validation(_))));
    let collections = browse::list_collections(&handle, "odin_test")
        .await
        .expect("list");
    assert!(
        collections.iter().all(|c| c.name != "copy"),
        "preview must not write"
    );
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn read_only_profiles_cannot_run_write_stages() {
    let fx = Fixture::start().await;
    let handle = fx.connect(true).await;
    let result = CursorRegistry::default()
        .aggregate(
            &handle,
            &namespace("locked"),
            AggregateRequest {
                pipeline: vec![EJsonDocument::from(doc! { "$out": "copy" })],
                batch_size: 10,
            },
        )
        .await;
    assert!(matches!(result, Err(CoreError::ReadOnly)));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn creates_lists_and_drops_indexes() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = namespace("indexed");
    fx.seed(&handle, &ns, 10).await;

    let name = indexes::create(
        &handle,
        &ns,
        CreateIndexRequest {
            keys: EJsonDocument::from(doc! { "n": -1 }),
            name: None,
            unique: true,
            sparse: false,
            hidden: false,
            expire_after_seconds: None,
            partial_filter: Some(EJsonDocument::from(doc! { "n": { "$gt": 2 } })),
        },
    )
    .await
    .expect("create");
    assert_eq!(name, "n_-1");

    let listed = indexes::list(&handle, &ns).await.expect("list");
    assert_eq!(
        listed.iter().map(|i| i.name.as_str()).collect::<Vec<_>>(),
        ["_id_", "n_-1"]
    );
    let created = &listed[1];
    assert!(created.unique);
    assert!(created.partial_filter.is_some());
    assert!(created.size.is_some(), "sizes come from $collStats");

    assert!(matches!(
        indexes::drop(&handle, &ns, "_id_").await,
        Err(CoreError::Validation(_))
    ));
    indexes::drop(&handle, &ns, "n_-1").await.expect("drop");
    assert_eq!(indexes::list(&handle, &ns).await.expect("list").len(), 1);

    let read_only = fx.connect(true).await;
    assert!(matches!(
        indexes::drop(&read_only, &ns, "anything").await,
        Err(CoreError::ReadOnly)
    ));
}

fn temp_path(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("odin-it-{}-{name}", uuid::Uuid::now_v7()))
}

fn progress() -> tokio::sync::mpsc::Sender<TransferProgress> {
    // Progress is lossy by design; tests only care about results.
    tokio::sync::mpsc::channel(1024).0
}

fn find_everything() -> ExportSource {
    ExportSource::Find {
        request: find_all(1000),
    }
}

async fn read_back(handle: &ConnectionHandle, ns: &Namespace) -> Vec<Document> {
    let page = CursorRegistry::default()
        .find(handle, ns, find_all(1000))
        .await
        .expect("read back");
    page.documents
        .into_iter()
        .map(|d| Document::try_from(d).expect("doc"))
        .collect()
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn json_exports_round_trip_exactly() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let source = namespace("source");
    let typed = doc! {
        "_id": ObjectId::new(),
        "n": 1_i32,
        "long": i64::MAX,
        "double": 5.0_f64,
        "decimal": Decimal128::from_str("0.1").expect("decimal"),
        "date": DateTime::from_millis(1_700_000_000_000),
        "nested": { "list": [1_i32, "two"] },
    };
    handle
        .client
        .database("odin_test")
        .collection::<Document>("source")
        .insert_one(typed.clone())
        .await
        .expect("seed");

    for format in [ExportFormat::JsonArray, ExportFormat::Ndjson] {
        let path = temp_path("export.json");
        let request = ExportRequest {
            source: find_everything(),
            format,
            json_mode: JsonMode::Canonical,
            csv_fields: Vec::new(),
        };
        let summary = export_documents(
            &handle,
            &source,
            request,
            &path,
            progress(),
            CancellationToken::new(),
        )
        .await
        .expect("export");
        assert!((summary.documents - 1.0).abs() < f64::EPSILON);

        let target = namespace(&format!("target_{format:?}"));
        let imported = import_documents(
            &handle,
            &target,
            path.clone(),
            ImportOptions {
                format: ImportFormat::Json,
                stop_on_error: false,
            },
            progress(),
            CancellationToken::new(),
        )
        .await
        .expect("import");
        assert!((imported.inserted - 1.0).abs() < f64::EPSILON);
        assert_eq!(
            read_back(&handle, &target).await,
            vec![typed.clone()],
            "{format:?} keeps every type"
        );
        let _ = std::fs::remove_file(path);
    }
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn csv_round_trips_with_explicit_column_types() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let source = namespace("people");
    handle
        .client
        .database("odin_test")
        .collection::<Document>("people")
        .insert_many([
            doc! { "_id": 1, "name": "Ada, Countess", "age": 36, "address": { "city": "London" } },
            doc! { "_id": 2, "name": "Alan", "age": 41, "address": { "city": "Wilmslow" } },
        ])
        .await
        .expect("seed");

    let path = temp_path("people.csv");
    let request = ExportRequest {
        source: find_everything(),
        format: ExportFormat::Csv,
        json_mode: JsonMode::Canonical,
        csv_fields: vec![
            "_id".into(),
            "name".into(),
            "age".into(),
            "address.city".into(),
        ],
    };
    export_documents(
        &handle,
        &source,
        request,
        &path,
        progress(),
        CancellationToken::new(),
    )
    .await
    .expect("export");

    let column = |header: &str, field: &str, kind| CsvColumn {
        header: header.into(),
        field: field.into(),
        kind,
    };
    let options = ImportOptions {
        format: ImportFormat::Csv {
            columns: vec![
                column("_id", "_id", CsvType::Int32),
                column("name", "name", CsvType::String),
                column("age", "age", CsvType::Int32),
                column("address.city", "address.city", CsvType::String),
            ],
        },
        stop_on_error: false,
    };
    let target = namespace("people_copy");
    let summary = import_documents(
        &handle,
        &target,
        path.clone(),
        options,
        progress(),
        CancellationToken::new(),
    )
    .await
    .expect("import");
    assert!((summary.inserted - 2.0).abs() < f64::EPSILON);
    assert_eq!(
        read_back(&handle, &source).await,
        read_back(&handle, &target).await
    );
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn import_reports_failures_and_can_stop_at_the_first() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let path = temp_path("dupes.ndjson");
    std::fs::write(&path, "{\"_id\": 1}\n{\"_id\": 1}\n[2]\n{\"_id\": 3}\n").expect("write");

    let run = |stop_on_error: bool, collection: &str| {
        let handle = std::sync::Arc::clone(&handle);
        let path = path.clone();
        let ns = namespace(collection);
        async move {
            import_documents(
                &handle,
                &ns,
                path,
                ImportOptions {
                    format: ImportFormat::Json,
                    stop_on_error,
                },
                progress(),
                CancellationToken::new(),
            )
            .await
            .expect("import")
        }
    };

    let skipping = run(false, "dupes_skip").await;
    assert!(
        (skipping.inserted - 2.0).abs() < f64::EPSILON,
        "{skipping:?}"
    );
    assert!(
        (skipping.failed - 2.0).abs() < f64::EPSILON,
        "duplicate key and non-document"
    );
    assert!(!skipping.stopped);

    let stopping = run(true, "dupes_stop").await;
    assert!(stopping.stopped);
    assert!(stopping.inserted < 2.0, "{stopping:?}");
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn failed_exports_leave_no_file_and_read_only_blocks_imports() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let path = temp_path("broken.json");
    let request = ExportRequest {
        source: ExportSource::Aggregate {
            pipeline: vec![EJsonDocument::from(doc! { "$notAStage": {} })],
        },
        format: ExportFormat::JsonArray,
        json_mode: JsonMode::Canonical,
        csv_fields: Vec::new(),
    };
    let result = export_documents(
        &handle,
        &namespace("any"),
        request,
        &path,
        progress(),
        CancellationToken::new(),
    )
    .await;
    assert!(result.is_err());
    assert!(!path.exists());

    let read_only = fx.connect(true).await;
    let result = import_documents(
        &read_only,
        &namespace("locked"),
        path,
        ImportOptions {
            format: ImportFormat::Json,
            stop_on_error: false,
        },
        progress(),
        CancellationToken::new(),
    )
    .await;
    assert!(matches!(result, Err(CoreError::ReadOnly)));
}

/// Needs mongodump/mongorestore: on `PATH`, or in `ODIN_TOOLS_DIR` (CI downloads them).
#[tokio::test]
#[ignore = "requires Docker and MongoDB Database Tools"]
async fn backs_up_and_restores_a_database_with_the_tools() {
    let dir = std::env::var_os("ODIN_TOOLS_DIR").map(std::path::PathBuf::from);
    let tools = locate_tools(dir.as_deref())
        .expect("database tools: set ODIN_TOOLS_DIR or add them to PATH");
    assert!(tools_version(&tools).await.is_some());

    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    fx.seed(&handle, &namespace("users"), 250).await;
    let archive = temp_path("shop.archive.gz");
    let (events, mut received) = tokio::sync::mpsc::channel(256);

    let connection = || ToolConnection {
        uri: &fx.uri,
        password: None,
        read_only: false,
    };
    let summary = backup(
        &tools,
        connection(),
        &BackupRequest {
            scope: BackupScope::Database {
                database: "odin_test".into(),
            },
            gzip: true,
        },
        &archive,
        events.clone(),
        CancellationToken::new(),
    )
    .await
    .expect("backup");
    assert!(
        (summary.documents - 250.0).abs() < f64::EPSILON,
        "{summary:?}"
    );
    assert!(archive.exists());

    let restored = restore(
        &tools,
        connection(),
        &RestoreRequest {
            source: RestoreSource::Archive,
            drop: false,
            database: Some("odin_test".into()),
            rename_to: Some("odin_copy".into()),
        },
        &archive,
        events,
        CancellationToken::new(),
    )
    .await
    .expect("restore");
    assert!(
        (restored.documents - 250.0).abs() < f64::EPSILON,
        "{restored:?}"
    );
    let copy = Namespace {
        database: "odin_copy".into(),
        collection: "users".into(),
    };
    assert_eq!(read_back(&handle, &copy).await.len(), 250);
    assert!(received.try_recv().is_ok(), "tool output is streamed");

    let read_only = ToolConnection {
        uri: &fx.uri,
        password: None,
        read_only: true,
    };
    let refused = restore(
        &tools,
        read_only,
        &RestoreRequest {
            source: RestoreSource::Archive,
            drop: true,
            database: None,
            rename_to: None,
        },
        &archive,
        tokio::sync::mpsc::channel(1).0,
        CancellationToken::new(),
    )
    .await;
    assert!(matches!(refused, Err(CoreError::ReadOnly)));
    let _ = std::fs::remove_file(archive);
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn byte_count(bytes: f64) -> usize {
    bytes as usize
}

/// Needs mongosh: on `PATH`, or `ODIN_MONGOSH` (CI downloads it).
fn mongosh() -> std::path::PathBuf {
    let configured = std::env::var_os("ODIN_MONGOSH").map(std::path::PathBuf::from);
    locate_mongosh(configured.as_deref()).expect("mongosh: set ODIN_MONGOSH or add it to PATH")
}

async fn shell_output_until(
    events: &mut tokio::sync::mpsc::Receiver<ShellEvent>,
    session: &ShellSession,
    needle: &str,
) -> String {
    let mut seen = String::new();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
    while !seen.contains(needle) {
        let event = tokio::time::timeout_at(deadline, events.recv())
            .await
            .unwrap_or_else(|_| panic!("timed out waiting for {needle:?}; got {seen:?}"))
            .unwrap_or_else(|| panic!("shell closed before {needle:?}; got {seen:?}"));
        match event {
            ShellEvent::Output { data, bytes } => {
                session.acknowledge(byte_count(bytes));
                seen.push_str(&data);
            }
            ShellEvent::Exited { code } => {
                panic!("shell exited ({code:?}) before {needle:?}; got {seen:?}")
            }
        }
    }
    seen
}

#[tokio::test]
#[ignore = "requires Docker and mongosh"]
async fn shell_runs_commands_and_exits() {
    let fx = Fixture::start().await;
    let (events, mut received) = tokio::sync::mpsc::channel(64);
    let shell = mongosh();
    let session = ShellSession::open(
        ShellOptions {
            mongosh: &shell,
            uri: &fx.uri,
            password: None,
            cols: 120,
            rows: 40,
        },
        events,
    )
    .expect("open shell");

    session
        .write("db.runCommand({ ping: 1 }).ok + 41\r")
        .expect("write");
    shell_output_until(&mut received, &session, "42").await;

    session.write("exit\r").expect("write");
    loop {
        match tokio::time::timeout(std::time::Duration::from_secs(20), received.recv()).await {
            Ok(Some(ShellEvent::Exited { .. })) => break,
            Ok(Some(ShellEvent::Output { bytes, .. })) => session.acknowledge(byte_count(bytes)),
            other => panic!("expected exit, got {other:?}"),
        }
    }
}

#[tokio::test]
#[ignore = "requires Docker and mongosh"]
async fn shell_output_floods_are_throttled_until_acknowledged() {
    let fx = Fixture::start().await;
    let (events, mut received) = tokio::sync::mpsc::channel(4096);
    let shell = mongosh();
    let session = ShellSession::open(
        ShellOptions {
            mongosh: &shell,
            uri: &fx.uri,
            password: None,
            cols: 200,
            rows: 50,
        },
        events,
    )
    .expect("open shell");
    shell_output_until(&mut received, &session, ">").await;

    // About 4 MB of output, far above the high watermark.
    session
        .write("for (let i = 0; i < 40000; i++) print('x'.repeat(100))\r")
        .expect("write");
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    let mut unacknowledged = 0_usize;
    while let Ok(event) = received.try_recv() {
        if let ShellEvent::Output { bytes, .. } = event {
            unacknowledged += byte_count(bytes);
        }
    }
    assert!(
        unacknowledged <= HIGH_WATERMARK + 16 * 1024,
        "reader kept going without credit: {unacknowledged} bytes"
    );
    assert!(
        unacknowledged >= HIGH_WATERMARK / 2,
        "flood should reach the watermark: {unacknowledged}"
    );

    // Acknowledging lets the rest through.
    session.acknowledge(unacknowledged);
    session.write("print('done-' + 'marker')\r").expect("write");
    shell_output_until(&mut received, &session, "done-marker").await;
    session.close();
}

#[tokio::test]
#[ignore = "requires Docker and mongosh"]
async fn shell_answers_the_password_prompt_through_the_pty() {
    let container = Mongo::default()
        .with_tag(std::env::var("MONGO_VERSION").unwrap_or_else(|_| "8.0".into()))
        .with_env_var("MONGO_INITDB_ROOT_USERNAME", "root")
        .with_env_var("MONGO_INITDB_ROOT_PASSWORD", "s3cr3t-pw")
        .start()
        .await
        .expect("mongo container starts");
    let port = container.get_host_port_ipv4(27017).await.expect("port");
    let uri = format!("mongodb://root@127.0.0.1:{port}/?authSource=admin&directConnection=true");

    // The image restarts mongod after creating the user: wait until auth works.
    let mut ready = false;
    for _ in 0..60 {
        if test_connection(&uri, Some(Secret::new("s3cr3t-pw")))
            .await
            .is_ok()
        {
            ready = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    assert!(ready, "authenticated server never became ready");

    let (events, mut received) = tokio::sync::mpsc::channel(64);
    let shell = mongosh();
    let session = ShellSession::open(
        ShellOptions {
            mongosh: &shell,
            uri: &uri,
            password: Some(Secret::new("s3cr3t-pw")),
            cols: 120,
            rows: 40,
        },
        events,
    )
    .expect("open shell");
    session
        .write("db.runCommand({ connectionStatus: 1 }).authInfo.authenticatedUsers[0].user\r")
        .expect("write");
    let output = shell_output_until(&mut received, &session, "root").await;
    assert!(
        !output.contains("s3cr3t-pw"),
        "the password must never be echoed"
    );
    session.close();
}
