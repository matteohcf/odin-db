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
use odin_core::catalog::{CollectionOptions, NewCollectionKind};
use odin_core::connection::{ConnectionHandle, ConnectionManager, test_connection};
use odin_core::documents::{ConvertTarget, FieldChange};
use odin_core::ejson::{EJsonDocument, EJsonValue};
use odin_core::indexes::{self, CreateIndexRequest};
use odin_core::profiles::{self, ConnectionProfile, ProfileInput};
use odin_core::query::{
    AggregateRequest, CursorRegistry, FindRequest, Namespace, QueryOptions, count_documents,
    preview_aggregation,
};
use odin_core::secrets::{MemoryStore, Secret, SecretStore};
use odin_core::shell::{
    self, HIGH_WATERMARK, ShellEvent, ShellOptions, ShellSession, locate_mongosh,
};
use odin_core::storage::Storage;
use odin_core::transfer::{
    CsvColumn, CsvType, ExportFormat, ExportRequest, ExportSource, ImportFormat, ImportMode,
    ImportOptions, JsonMode, TransferProgress, export_documents, import_documents,
};
use odin_core::{CoreError, browse, catalog, documents, explain, schema};
use std::str::FromStr;
use std::sync::Arc;
use testcontainers_modules::mongo::Mongo;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ContainerRequest, ImageExt};
use tokio_util::sync::CancellationToken;

struct Fixture {
    container: ContainerAsync<Mongo>,
    uri: String,
    manager: ConnectionManager,
    storage: Storage,
    secrets: MemoryStore,
}

impl Fixture {
    async fn start() -> Self {
        Self::start_with(Mongo::default().into()).await
    }

    /// A one-node replica set, for what standalone servers cannot do (change streams).
    /// Initiated here rather than by `Mongo::repl_set()`, whose readiness check waits for a log
    /// line MongoDB 8.0 no longer prints.
    async fn start_replica_set() -> Self {
        let fixture = Self::start_with(Mongo::default().with_cmd(["--replSet", "rs"])).await;
        let client = mongodb::Client::with_uri_str(&fixture.uri)
            .await
            .expect("client");
        let admin = client.database("admin");
        admin
            .run_command(doc! {
                "replSetInitiate": { "_id": "rs", "members": [{ "_id": 0, "host": "127.0.0.1:27017" }] }
            })
            .await
            .expect("replica set initiates");
        // It elects itself before it accepts writes.
        for _ in 0..240 {
            let hello = admin.run_command(doc! { "hello": 1 }).await.expect("hello");
            if hello.get_bool("isWritablePrimary").unwrap_or(false) {
                return fixture;
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        panic!("the replica set never elected a primary");
    }

    async fn start_with(request: ContainerRequest<Mongo>) -> Self {
        let tag = std::env::var("MONGO_VERSION").unwrap_or_else(|_| "8.0".into());
        let container = request
            .with_tag(tag)
            .start()
            .await
            .expect("mongo container starts");
        let port = container
            .get_host_port_ipv4(27017)
            .await
            .expect("mapped port");
        Self {
            container,
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
                color: None,
                ssh: None,
                ssh_secret: None,
                ssh_host_key: None,
                group: None,
            },
        )
        .expect("profile created")
    }

    async fn connect(&self, read_only: bool) -> Arc<ConnectionHandle> {
        let info = self
            .manager
            .connect(&self.profile(read_only), None, None)
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
        options: QueryOptions::default(),
    }
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn connects_lists_and_reports_server_version() {
    let fx = Fixture::start().await;
    let info = test_connection(&fx.uri, None, None)
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
async fn concurrent_connects_to_one_profile_share_a_connection() {
    let fx = Fixture::start().await;
    let profile = fx.profile(false);
    let (first, second) = tokio::join!(
        fx.manager.connect(&profile, None, None),
        fx.manager.connect(&profile, None, None),
    );
    assert_eq!(first.expect("connects").id, second.expect("connects").id);
    assert_eq!(fx.manager.list().await.len(), 1);
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
        &QueryOptions::default(),
    )
    .await
    .expect("count");
    assert!((count - 10.0).abs() < f64::EPSILON);
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn samples_field_paths_for_autocompletion() {
    let fx = Fixture::start().await;
    let handle = fx.connect(true).await;
    let ns = namespace("people");
    let docs = (0..20).map(|i| doc! { "name": format!("p{i}"), "address": { "city": "Rome" } });
    handle
        .client
        .database(&ns.database)
        .collection::<Document>(&ns.collection)
        .insert_many(docs)
        .await
        .expect("seeded");

    let fields = schema::sample_fields(&handle, &ns, 100)
        .await
        .expect("sampling is allowed on read-only connections");
    let paths: Vec<_> = fields.iter().map(|field| field.path.as_str()).collect();
    assert_eq!(paths, ["_id", "address", "address.city", "name"]);
    assert_eq!(fields[0].types, ["objectId"]);
    assert!(schema::sample_fields(&handle, &ns, 0).await.is_err());
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
async fn queries_take_a_collation_a_hint_and_a_time_limit() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = namespace("names");
    handle
        .client
        .database(&ns.database)
        .collection::<Document>(&ns.collection)
        .insert_many([
            doc! { "name": "Ada" },
            doc! { "name": "ada" },
            doc! { "name": "ADA" },
            doc! { "name": "Bob" },
        ])
        .await
        .expect("seeded");
    let options = |collation: Option<Document>, hint: Option<Bson>| QueryOptions {
        collation: collation.map(EJsonDocument::from),
        hint: hint.map(EJsonValue::from),
        max_time_ms: Some(5_000),
    };
    let insensitive = Some(doc! { "locale": "en", "strength": 2 });
    let request = |options: QueryOptions| FindRequest {
        filter: EJsonDocument::from(doc! { "name": "ada" }),
        options,
        ..find_all(10)
    };

    let page = CursorRegistry::default()
        .find(&handle, &ns, request(options(insensitive.clone(), None)))
        .await
        .expect("page");
    assert_eq!(
        page.documents.len(),
        3,
        "a case-insensitive collation matches every case"
    );
    let count = count_documents(
        &handle,
        &ns,
        EJsonDocument::from(doc! { "name": "ada" }),
        &options(insensitive, None),
    )
    .await
    .expect("count");
    assert_eq!(count, 3.0);

    let hinted = CursorRegistry::default()
        .find(
            &handle,
            &ns,
            request(options(None, Some(Bson::Document(doc! { "_id": 1 })))),
        )
        .await
        .expect("hinted by keys");
    assert_eq!(hinted.documents.len(), 1);
    let missing = CursorRegistry::default()
        .find(
            &handle,
            &ns,
            request(options(None, Some(Bson::String("nope".into())))),
        )
        .await;
    assert!(missing.is_err(), "a hint naming no index is refused");
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
    let everything = || EJsonDocument::from(doc! {});
    assert!(matches!(
        documents::update_many(
            &handle,
            &ns,
            everything(),
            EJsonDocument::from(doc! { "$set": { "a": 1 } })
        )
        .await,
        Err(CoreError::ReadOnly)
    ));
    assert!(matches!(
        documents::delete_many(&handle, &ns, everything()).await,
        Err(CoreError::ReadOnly)
    ));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn wrong_credentials_are_reported_as_auth_errors() {
    let fx = Fixture::start().await;
    let uri = fx.uri.replace("mongodb://", "mongodb://nobody@");
    let result = test_connection(&uri, Some(Secret::new("wrong")), None).await;
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
                options: QueryOptions::default(),
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
                options: QueryOptions::default(),
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
                mode: ImportMode::Insert,
                drop_first: false,
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
        mode: ImportMode::Insert,
        drop_first: false,
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
                    mode: ImportMode::Insert,
                    drop_first: false,
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
            mode: ImportMode::Insert,
            drop_first: false,
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
        &BackupRequest::of(BackupScope::Database {
            database: "odin_test".into(),
        }),
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
            namespaces: Vec::new(),
            oplog_replay: false,
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
            namespaces: Vec::new(),
            oplog_replay: false,
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
    locate_mongosh(configured.as_deref(), None)
        .expect("mongosh: set ODIN_MONGOSH or add it to PATH")
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
    // Shared CI runners can take well over 30 s for that.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
    let mut ready = false;
    while std::time::Instant::now() < deadline {
        if test_connection(&uri, Some(Secret::new("s3cr3t-pw")), None)
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

/// Downloads the real pinned mongosh (about 70 MB). Opt in with `ODIN_TEST_DOWNLOADS=1`.
#[tokio::test]
#[ignore = "requires network"]
async fn downloads_verifies_and_installs_mongosh() {
    if std::env::var_os("ODIN_TEST_DOWNLOADS").is_none() {
        return;
    }
    let dir = std::env::temp_dir().join(format!("odin-download-{}", uuid::Uuid::now_v7()));
    let (tx, mut rx) = tokio::sync::mpsc::channel(1024);
    let path = shell::download_mongosh(&dir, tx, CancellationToken::new())
        .await
        .expect("download");

    assert_eq!(shell::installed_mongosh(&dir), Some(path.clone()));
    assert!(locate_mongosh(None, Some(&dir)).is_some());
    let mut last = None;
    while let Ok(progress) = rx.try_recv() {
        last = Some(progress);
    }
    let last = last.expect("progress events");
    assert_eq!(Some(last.received), last.total);
    let version = std::process::Command::new(&path)
        .arg("--version")
        .output()
        .expect("runs");
    assert_eq!(
        String::from_utf8_lossy(&version.stdout).trim(),
        shell::MONGOSH_VERSION
    );
    std::fs::remove_dir_all(dir).expect("cleanup");
}

#[tokio::test]
#[ignore = "requires network"]
async fn a_cancelled_download_leaves_nothing_behind() {
    if std::env::var_os("ODIN_TEST_DOWNLOADS").is_none() {
        return;
    }
    let dir = std::env::temp_dir().join(format!("odin-download-{}", uuid::Uuid::now_v7()));
    let cancel = CancellationToken::new();
    let (tx, mut rx) = tokio::sync::mpsc::channel(1024);
    let download = tokio::spawn({
        let (dir, cancel) = (dir.clone(), cancel.clone());
        async move { shell::download_mongosh(&dir, tx, cancel).await }
    });
    rx.recv().await.expect("download started");
    cancel.cancel();
    assert!(matches!(
        download.await.expect("joins"),
        Err(CoreError::Cancelled)
    ));
    assert!(
        std::fs::read_dir(&dir).expect("dir").next().is_none(),
        "no partial files"
    );
    std::fs::remove_dir_all(dir).expect("cleanup");
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn creates_renames_and_drops_collections_and_databases() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let names = |db: &'static str| {
        let handle = handle.clone();
        async move {
            browse::list_collections(&handle, db)
                .await
                .expect("lists")
                .into_iter()
                .map(|c| c.name)
                .collect::<Vec<_>>()
        }
    };
    let ns = |collection: &str| Namespace {
        database: "catalog_test".into(),
        collection: collection.into(),
    };

    catalog::create_collection(&handle, &ns("orders"), &CollectionOptions::default())
        .await
        .expect("creates");
    assert_eq!(names("catalog_test").await, ["orders"]);
    assert!(
        catalog::create_collection(&handle, &ns("orders"), &CollectionOptions::default())
            .await
            .is_err(),
        "an existing collection is not silently reused"
    );

    catalog::create_collection(&handle, &ns("archive"), &CollectionOptions::default())
        .await
        .expect("creates");
    assert!(
        catalog::rename_collection(&handle, &ns("orders"), "archive")
            .await
            .is_err(),
        "renaming never overwrites"
    );
    catalog::rename_collection(&handle, &ns("orders"), "orders_2026")
        .await
        .expect("renames");
    assert_eq!(names("catalog_test").await, ["archive", "orders_2026"]);

    catalog::drop_collection(&handle, &ns("archive"))
        .await
        .expect("drops");
    assert_eq!(names("catalog_test").await, ["orders_2026"]);

    catalog::drop_database(&handle, "catalog_test")
        .await
        .expect("drops");
    let databases = browse::list_databases(&handle).await.expect("lists");
    assert!(databases.iter().all(|db| db.name != "catalog_test"));
    assert!(catalog::drop_database(&handle, "admin").await.is_err());

    let read_only = fx.connect(true).await;
    assert!(matches!(
        catalog::create_collection(&read_only, &ns("x"), &CollectionOptions::default()).await,
        Err(CoreError::ReadOnly)
    ));
    assert!(matches!(
        catalog::drop_database(&read_only, "shop").await,
        Err(CoreError::ReadOnly)
    ));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn explains_collection_and_index_scans() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = namespace("plans");
    fx.seed(&handle, &ns, 300).await;
    let request = |filter: Document| explain::ExplainRequest {
        filter: EJsonDocument::from(filter),
        projection: None,
        sort: None,
        skip: None,
        limit: None,
        options: QueryOptions::default(),
    };

    let scan = explain::explain_find(&handle, &ns, request(doc! { "n": { "$lt": 10 } }))
        .await
        .expect("explains");
    assert!(scan.collection_scan);
    assert!((scan.returned - 10.0).abs() < f64::EPSILON);
    assert!((scan.documents_examined - 300.0).abs() < f64::EPSILON);

    indexes::create(
        &handle,
        &ns,
        CreateIndexRequest {
            keys: EJsonDocument::from(doc! { "n": 1 }),
            name: None,
            unique: false,
            sparse: false,
            hidden: false,
            expire_after_seconds: None,
            partial_filter: None,
        },
    )
    .await
    .expect("index");
    let indexed = explain::explain_find(&handle, &ns, request(doc! { "n": { "$lt": 10 } }))
        .await
        .expect("explains");
    assert!(!indexed.collection_scan);
    assert_eq!(indexed.indexes, ["n_1"]);
    assert!(indexed.stages.contains(&"IXSCAN".to_owned()));
    assert!((indexed.documents_examined - 10.0).abs() < f64::EPSILON);
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn sets_and_unsets_single_fields_keeping_types() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = namespace("fields");
    let collection = handle
        .client
        .database(&ns.database)
        .collection::<Document>(&ns.collection);
    collection
        .insert_one(doc! { "_id": 1, "name": "a", "count": 1_i64, "keep": true })
        .await
        .expect("seeded");
    let id = || EJsonValue::from(Bson::Int32(1));

    documents::set_field(
        &handle,
        &ns,
        id(),
        "count",
        Some(EJsonValue::from(Bson::Int64(7))),
    )
    .await
    .expect("sets");
    documents::set_field(&handle, &ns, id(), "name", None)
        .await
        .expect("unsets");
    // A JSON null from the UI is a value: the field stays, holding null.
    let null: EJsonValue = serde_json::from_value(serde_json::Value::Null).expect("null value");
    documents::set_field(&handle, &ns, id(), "nothing", Some(null))
        .await
        .expect("sets null");
    let stored = collection
        .find_one(doc! { "_id": 1 })
        .await
        .expect("finds")
        .expect("exists");
    assert_eq!(
        stored,
        doc! { "_id": 1, "count": 7_i64, "keep": true, "nothing": Bson::Null },
        "type kept, other fields untouched"
    );

    assert!(
        documents::set_field(&handle, &ns, id(), "a.b", None)
            .await
            .is_err()
    );
    assert!(
        documents::set_field(&handle, &ns, id(), "_id", None)
            .await
            .is_err()
    );
    assert!(matches!(
        documents::set_field(&handle, &ns, EJsonValue::from(Bson::Int32(99)), "x", None).await,
        Err(CoreError::NotFound(_))
    ));
    let read_only = fx.connect(true).await;
    assert!(matches!(
        documents::set_field(&read_only, &ns, id(), "keep", None).await,
        Err(CoreError::ReadOnly)
    ));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn reports_a_server_that_stops_answering() {
    let fx = Fixture::start().await;
    let mut changes = fx.manager.health_changes();
    // Fast heartbeats keep the test short; the app uses the driver's default.
    let profile = profiles::create(
        &fx.storage,
        &fx.secrets,
        ProfileInput {
            name: "heartbeat".into(),
            connection_string: format!("{}&heartbeatFrequencyMS=500", fx.uri),
            password: None,
            read_only: false,
            color: None,
            ssh: None,
            ssh_secret: None,
            ssh_host_key: None,
            group: None,
        },
    )
    .expect("profile");
    let info = fx
        .manager
        .connect(&profile, None, None)
        .await
        .expect("connects");
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(2), changes.recv())
            .await
            .is_err(),
        "a healthy connection reports nothing"
    );

    fx.container.stop().await.expect("stops");
    let change = tokio::time::timeout(std::time::Duration::from_secs(30), changes.recv())
        .await
        .expect("noticed within 30 s")
        .expect("event");
    assert_eq!(
        change,
        odin_core::connection::HealthChange {
            connection_id: info.id,
            reachable: false
        }
    );

    fx.manager.disconnect(info.id).await.expect("disconnects");
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(2), changes.recv())
            .await
            .is_err(),
        "closing a connection is not reported as a health change"
    );
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn reports_collection_storage_stats() {
    let fx = Fixture::start().await;
    let handle = fx.connect(true).await;
    let ns = namespace("stats");
    fx.seed(&handle, &ns, 120).await;
    let stats = browse::collection_stats(&handle, &ns).await.expect("stats");
    assert!((stats.documents - 120.0).abs() < f64::EPSILON);
    assert!(stats.size > 0.0 && stats.average_document_size > 0.0);
    assert!((stats.indexes - 1.0).abs() < f64::EPSILON, "the _id index");
}

/// The scheduler's cycle with the real tools: record, dump, finish, keep the newest.
#[tokio::test]
#[ignore = "requires Docker and MongoDB Database Tools"]
async fn scheduled_backups_are_recorded_and_pruned() {
    use odin_core::backup::history;
    use odin_core::backup::schedule::{self, Frequency, ScheduleInput, Timing};

    let dir = std::env::var_os("ODIN_TOOLS_DIR").map(std::path::PathBuf::from);
    let tools = locate_tools(dir.as_deref()).expect("database tools");
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    fx.seed(&handle, &namespace("events"), 50).await;
    let profile = fx.profile(false);
    let folder = temp_path("scheduled");
    std::fs::create_dir_all(&folder).expect("folder");
    let scope = BackupScope::Database {
        database: "odin_test".into(),
    };
    let created = schedule::create_schedule(
        &fx.storage,
        ScheduleInput {
            profile_id: profile.id,
            scope: scope.clone(),
            timing: Timing {
                frequency: Frequency::Hourly,
                minute: 0,
                weekday: None,
            },
            keep: 2,
            enabled: true,
        },
        &folder,
    )
    .expect("schedule");

    for _ in 0..3 {
        let archive = history::archive_path(&folder, &profile.name, &scope, &jiff::Zoned::now());
        let run = history::start_run(&fx.storage, profile.id, Some(created.id), &scope, &archive)
            .expect("start");
        let (events, mut drain) = tokio::sync::mpsc::channel(256);
        tokio::spawn(async move { while drain.recv().await.is_some() {} });
        let outcome = backup(
            &tools,
            ToolConnection {
                uri: &fx.uri,
                password: None,
                read_only: false,
            },
            &BackupRequest::of(scope.clone()),
            &archive,
            events,
            CancellationToken::new(),
        )
        .await;
        history::finish_run(&fx.storage, run, &outcome).expect("finish");
        history::prune(&fx.storage, created.id, 2).expect("prune");
        // Archive names have one-second resolution.
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    }

    let runs = history::list_runs(&fx.storage).expect("runs");
    assert_eq!(runs.len(), 2, "only the newest two are kept");
    assert!(runs.iter().all(|run| run.archive_exists && run.bytes > 0.0));
    assert!(
        runs.iter()
            .all(|run| (run.documents - 50.0).abs() < f64::EPSILON)
    );
    let files = std::fs::read_dir(&folder).expect("folder").count();
    assert_eq!(files, 2, "pruned archives are deleted from disk");
    std::fs::remove_dir_all(folder).expect("cleanup");
}

#[tokio::test]
#[ignore = "requires Docker and MongoDB Database Tools"]
async fn backup_options_contents_and_selective_restore() {
    use odin_core::backup::archive_contents;

    let dir = std::env::var_os("ODIN_TOOLS_DIR").map(std::path::PathBuf::from);
    let tools = locate_tools(dir.as_deref()).expect("database tools");
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    for name in ["orders", "users", "logs"] {
        fx.seed(&handle, &namespace(name), 20).await;
    }
    let connection = || ToolConnection {
        uri: &fx.uri,
        password: None,
        read_only: false,
    };
    let quiet = || {
        let (events, mut drain) = tokio::sync::mpsc::channel(256);
        tokio::spawn(async move { while drain.recv().await.is_some() {} });
        events
    };

    // A database backup without `logs`.
    let archive = temp_path("options.archive.gz");
    let mut request = BackupRequest::of(BackupScope::Database {
        database: "odin_test".into(),
    });
    request.exclude_collections = vec!["logs".into()];
    backup(
        &tools,
        connection(),
        &request,
        &archive,
        quiet(),
        CancellationToken::new(),
    )
    .await
    .expect("backup");
    let mut contents = archive_contents(&tools, connection(), RestoreSource::Archive, &archive)
        .await
        .expect("contents");
    contents.sort();
    assert_eq!(contents, ["odin_test.orders", "odin_test.users"]);

    // Restore only `users`, into another database.
    let summary = restore(
        &tools,
        connection(),
        &RestoreRequest {
            source: RestoreSource::Archive,
            drop: false,
            database: Some("odin_test".into()),
            rename_to: Some("odin_selected".into()),
            namespaces: vec!["odin_test.users".into()],
            oplog_replay: false,
        },
        &archive,
        quiet(),
        CancellationToken::new(),
    )
    .await
    .expect("restore");
    assert!((summary.documents - 20.0).abs() < f64::EPSILON);
    let restored = browse::list_collections(&handle, "odin_selected")
        .await
        .expect("collections");
    assert_eq!(
        restored.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
        ["users"]
    );

    // A filtered collection backup keeps only matching documents.
    let filtered = temp_path("filtered.archive.gz");
    let mut request = BackupRequest::of(BackupScope::Collection {
        database: "odin_test".into(),
        collection: "orders".into(),
    });
    request.query = Some(EJsonDocument::from(doc! { "n": { "$lt": 5 } }));
    let summary = backup(
        &tools,
        connection(),
        &request,
        &filtered,
        quiet(),
        CancellationToken::new(),
    )
    .await
    .expect("filtered backup");
    assert!((summary.documents - 5.0).abs() < f64::EPSILON);

    // Reading contents is allowed on read-only connections: it writes nothing.
    let read_only = ToolConnection {
        uri: &fx.uri,
        password: None,
        read_only: true,
    };
    assert!(
        archive_contents(&tools, read_only, RestoreSource::Archive, &archive)
            .await
            .is_ok()
    );
    let _ = std::fs::remove_file(archive);
    let _ = std::fs::remove_file(filtered);
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn imports_upsert_merge_and_replace_the_whole_collection() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = namespace("modes");
    let collection = handle
        .client
        .database(&ns.database)
        .collection::<Document>(&ns.collection);
    collection
        .insert_many([
            doc! { "_id": 1, "name": "a", "keep": true },
            doc! { "_id": 2, "name": "b" },
        ])
        .await
        .expect("seeded");
    let file = temp_path("modes.json");
    std::fs::write(
        &file,
        r#"[{"_id": 1, "name": "A"}, {"_id": 3, "name": "c"}, {"name": "no id"}]"#,
    )
    .expect("file");
    let import = |mode: ImportMode, drop_first: bool| {
        let (handle, ns, file) = (handle.clone(), ns.clone(), file.clone());
        async move {
            let (progress, mut drain) = tokio::sync::mpsc::channel(64);
            tokio::spawn(async move { while drain.recv().await.is_some() {} });
            import_documents(
                &handle,
                &ns,
                file,
                ImportOptions {
                    format: ImportFormat::Json,
                    stop_on_error: false,
                    mode,
                    drop_first,
                },
                progress,
                CancellationToken::new(),
            )
            .await
            .expect("import")
        }
    };
    let one = || async {
        collection
            .find_one(doc! { "_id": 1 })
            .await
            .expect("find")
            .expect("one")
    };

    let merged = import(ImportMode::Merge, false).await;
    assert_eq!((merged.inserted, merged.updated), (2.0, 1.0));
    assert_eq!(
        one().await,
        doc! { "_id": 1, "name": "A", "keep": true },
        "merge keeps other fields"
    );

    let upserted = import(ImportMode::Upsert, false).await;
    assert_eq!(
        (upserted.inserted, upserted.updated),
        (1.0, 2.0),
        "the id-less document is new again"
    );
    assert_eq!(
        one().await,
        doc! { "_id": 1, "name": "A" },
        "upsert replaces the document"
    );

    let replaced = import(ImportMode::Insert, true).await;
    assert_eq!(replaced.inserted, 3.0);
    assert_eq!(
        collection.count_documents(doc! {}).await.expect("count"),
        3,
        "emptied first"
    );
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn exports_a_database_to_a_folder_and_imports_it_back() {
    use odin_core::transfer::{
        DatabaseExportRequest, database_files, export_database, import_database,
    };

    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    for (name, count) in [("orders", 30), ("users", 12)] {
        fx.seed(&handle, &namespace(name), count).await;
    }
    let folder = temp_path("db-export");
    let quiet = || {
        let (progress, mut drain) = tokio::sync::mpsc::channel(64);
        tokio::spawn(async move { while drain.recv().await.is_some() {} });
        progress
    };

    let exported = export_database(
        &handle,
        "odin_test",
        &folder,
        DatabaseExportRequest {
            format: ExportFormat::Ndjson,
            json_mode: JsonMode::Canonical,
            collections: Vec::new(),
        },
        quiet(),
        CancellationToken::new(),
    )
    .await
    .expect("export");
    assert_eq!((exported.collections, exported.documents), (2.0, 42.0));

    let files = database_files(&folder).expect("files");
    assert_eq!(
        files
            .iter()
            .map(|(name, _)| name.as_str())
            .collect::<Vec<_>>(),
        ["orders", "users"]
    );
    let imported = import_database(
        &handle,
        "odin_copy",
        files,
        ImportOptions {
            format: ImportFormat::Json,
            stop_on_error: false,
            mode: ImportMode::Insert,
            drop_first: false,
        },
        quiet(),
        CancellationToken::new(),
    )
    .await
    .expect("import");
    assert_eq!(
        (imported.collections, imported.documents, imported.failed),
        (2.0, 42.0, 0.0)
    );
    let copy = handle
        .client
        .database("odin_copy")
        .collection::<Document>("orders");
    let first = copy
        .find_one(doc! { "n": 0 })
        .await
        .expect("find")
        .expect("document");
    assert!(
        matches!(first.get("n"), Some(Bson::Int32(0))),
        "canonical JSON keeps BSON types"
    );
    std::fs::remove_dir_all(folder).expect("cleanup");
}

fn copy_request(
    source_collection: Option<&str>,
    target_database: &str,
    target_collection: Option<&str>,
) -> odin_core::transfer::CopyRequest {
    odin_core::transfer::CopyRequest {
        source_database: "odin_test".into(),
        source_collection: source_collection.map(Into::into),
        target_database: target_database.into(),
        target_collection: target_collection.map(Into::into),
        mode: ImportMode::Insert,
        drop_target: false,
        copy_indexes: true,
    }
}

fn drained<T: Send + 'static>() -> tokio::sync::mpsc::Sender<T> {
    let (progress, mut drain) = tokio::sync::mpsc::channel(64);
    tokio::spawn(async move { while drain.recv().await.is_some() {} });
    progress
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn copies_a_collection_with_options_and_indexes_to_another_connection() {
    use odin_core::transfer::copy;

    let fx = Fixture::start().await;
    let source = fx.connect(false).await;
    let target = fx.connect(false).await;
    let db = source.client.database("odin_test");
    db.create_collection("people")
        .validator(doc! { "age": { "$type": "int" } })
        .await
        .expect("created");
    let docs: Vec<Document> = (0..2500)
        .map(|i| doc! { "age": i, "email": format!("p{i}@example.com"), "price": Decimal128::from_str("1.50").expect("decimal") })
        .collect();
    db.collection::<Document>("people")
        .insert_many(docs)
        .await
        .expect("seeded");
    indexes::create(
        &source,
        &namespace("people"),
        CreateIndexRequest {
            keys: EJsonDocument::from(doc! { "email": 1 }),
            name: Some("email_unique".into()),
            unique: true,
            sparse: false,
            hidden: false,
            expire_after_seconds: None,
            partial_filter: None,
        },
    )
    .await
    .expect("index");

    let summary = copy(
        &source,
        &target,
        copy_request(Some("people"), "odin_copy", Some("customers")),
        drained(),
        CancellationToken::new(),
    )
    .await
    .expect("copied");
    assert_eq!(
        (summary.collections, summary.documents, summary.failed),
        (1.0, 2500.0, 0.0)
    );
    assert!(summary.errors.is_empty(), "{:?}", summary.errors);

    let copied = target.client.database("odin_copy");
    let names: Vec<String> = indexes::list(
        &target,
        &Namespace {
            database: "odin_copy".into(),
            collection: "customers".into(),
        },
    )
    .await
    .expect("indexes")
    .into_iter()
    .map(|index| index.name)
    .collect();
    assert!(names.contains(&"email_unique".to_owned()), "{names:?}");
    let first = copied
        .collection::<Document>("customers")
        .find_one(doc! { "age": 7 })
        .await
        .expect("find")
        .expect("document");
    assert!(
        matches!(first.get("price"), Some(Bson::Decimal128(_))),
        "types survive: {first}"
    );
    // The validator came along: a string age is rejected in the copy too.
    assert!(
        copied
            .collection::<Document>("customers")
            .insert_one(doc! { "age": "old" })
            .await
            .is_err()
    );

    // Copying again inserts nothing new: every _id already exists.
    let again = copy(
        &source,
        &target,
        copy_request(Some("people"), "odin_copy", Some("customers")),
        drained(),
        CancellationToken::new(),
    )
    .await
    .expect("copied again");
    assert_eq!((again.documents, again.failed), (0.0, 2500.0));

    // Replacing the target starts from scratch.
    let mut replace = copy_request(Some("people"), "odin_copy", Some("customers"));
    replace.drop_target = true;
    let replaced = copy(
        &source,
        &target,
        replace,
        drained(),
        CancellationToken::new(),
    )
    .await
    .expect("replaced");
    assert_eq!((replaced.documents, replaced.failed), (2500.0, 0.0));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn copies_a_database_with_views_and_guards_the_target() {
    use odin_core::transfer::copy;

    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    fx.seed(&handle, &namespace("orders"), 40).await;
    fx.seed(&handle, &namespace("users"), 5).await;
    handle
        .client
        .database("odin_test")
        .create_collection("big_orders")
        .view_on("orders".to_owned())
        .pipeline(vec![doc! { "$match": { "n": { "$gte": 30 } } }])
        .await
        .expect("view");

    let summary = copy(
        &handle,
        &handle,
        copy_request(None, "odin_clone", None),
        drained(),
        CancellationToken::new(),
    )
    .await
    .expect("copied");
    assert_eq!((summary.collections, summary.documents), (3.0, 45.0));
    let view = handle
        .client
        .database("odin_clone")
        .collection::<Document>("big_orders");
    assert_eq!(view.count_documents(doc! {}).await.expect("count"), 10);

    // Merge keeps fields the target has and the source lacks.
    let clone_users = handle
        .client
        .database("odin_clone")
        .collection::<Document>("users");
    clone_users
        .update_many(doc! {}, doc! { "$set": { "note": "kept" } })
        .await
        .expect("noted");
    let mut merge = copy_request(Some("users"), "odin_clone", None);
    merge.mode = ImportMode::Merge;
    let merged = copy(&handle, &handle, merge, drained(), CancellationToken::new())
        .await
        .expect("merged");
    assert_eq!((merged.documents, merged.updated), (0.0, 5.0));
    assert_eq!(
        clone_users
            .count_documents(doc! { "note": "kept" })
            .await
            .expect("count"),
        5
    );

    assert!(matches!(
        copy(
            &handle,
            &handle,
            copy_request(Some("users"), "odin_test", None),
            drained(),
            CancellationToken::new(),
        )
        .await,
        Err(CoreError::Validation(_))
    ));
    let read_only = fx.connect(true).await;
    assert!(matches!(
        copy(
            &handle,
            &read_only,
            copy_request(Some("users"), "odin_other", None),
            drained(),
            CancellationToken::new(),
        )
        .await,
        Err(CoreError::ReadOnly)
    ));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn updates_and_deletes_by_filter() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = namespace("bulk");
    fx.seed(&handle, &ns, 20).await;
    let filter = |d: Document| EJsonDocument::from(d);

    let result = documents::update_many(
        &handle,
        &ns,
        filter(doc! { "n": { "$lt": 5 } }),
        filter(doc! { "$set": { "tier": "low" }, "$inc": { "n": 100 } }),
    )
    .await
    .expect("updated");
    assert_eq!((result.matched, result.modified), (5.0, 5.0));
    assert_eq!(
        count_documents(
            &handle,
            &ns,
            filter(doc! { "tier": "low", "n": { "$gte": 100 } }),
            &QueryOptions::default(),
        )
        .await
        .expect("count"),
        5.0
    );

    // A replacement document is refused: it would need operators.
    assert!(matches!(
        documents::update_many(&handle, &ns, filter(doc! {}), filter(doc! { "tier": "x" })).await,
        Err(CoreError::Validation(_))
    ));
    assert!(matches!(
        documents::update_many(&handle, &ns, filter(doc! {}), filter(doc! {})).await,
        Err(CoreError::Validation(_))
    ));

    let deleted = documents::delete_many(&handle, &ns, filter(doc! { "tier": "low" }))
        .await
        .expect("deleted");
    assert_eq!(deleted, 5.0);
    assert_eq!(
        count_documents(&handle, &ns, filter(doc! {}), &QueryOptions::default())
            .await
            .expect("count"),
        15.0
    );
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn counts_distinct_values_including_array_elements() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = namespace("people");
    handle
        .client
        .database("odin_test")
        .collection::<Document>("people")
        .insert_many([
            doc! { "plan": "pro", "tags": ["a", "b"], "active": true },
            doc! { "plan": "pro", "tags": ["a"], "active": true },
            doc! { "plan": "free", "tags": [], "active": false },
            doc! { "active": true },
        ])
        .await
        .expect("seeded");
    let values = |field: &'static str, filter: Document| {
        let handle = Arc::clone(&handle);
        let ns = ns.clone();
        async move {
            odin_core::query::distinct_values(&handle, &ns, field, EJsonDocument::from(filter), 100)
                .await
                .expect("distinct")
                .into_iter()
                .map(|v| (Bson::try_from(v.value).expect("bson"), v.count))
                .collect::<Vec<_>>()
        }
    };
    assert_eq!(
        values("plan", doc! {}).await,
        vec![
            (Bson::String("pro".into()), 2.0),
            (Bson::Null, 1.0),
            (Bson::String("free".into()), 1.0),
        ]
    );
    assert_eq!(
        values("tags", doc! { "active": true }).await,
        vec![
            (Bson::String("a".into()), 2.0),
            (Bson::Null, 1.0),
            (Bson::String("b".into()), 1.0),
        ]
    );
    assert!(matches!(
        odin_core::query::distinct_values(&handle, &ns, "$plan", EJsonDocument::from(doc! {}), 10)
            .await,
        Err(CoreError::Validation(_))
    ));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn monitors_the_server_and_kills_a_running_operation() {
    use odin_core::monitor::{current_ops, kill_op, server_status};

    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let status = server_status(&handle).await.expect("status");
    assert!(!status.version.is_empty() && status.process.contains("mongod"));
    assert!(status.connections_current >= 1.0 && status.uptime_seconds >= 0.0);
    assert!(status.opcounters.command > 0.0 && status.sampled_at > 0.0);

    fx.seed(&handle, &namespace("slow"), 1).await;
    let slow = {
        let handle = Arc::clone(&handle);
        tokio::spawn(async move {
            handle
                .client
                .database("odin_test")
                .collection::<Document>("slow")
                .find_one(doc! { "$where": "sleep(20000) || true" })
                .await
        })
    };
    let mut found = None;
    for _ in 0..50 {
        let ops = current_ops(&handle).await.expect("current ops");
        found = ops.into_iter().find(|op| op.ns == "odin_test.slow");
        if found.is_some() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    let op = found.expect("the slow find is listed");
    assert_eq!(op.op, "query");
    assert!(op.command.is_some());

    let read_only = fx.connect(true).await;
    assert!(matches!(
        kill_op(&read_only, op.opid.clone()).await,
        Err(CoreError::ReadOnly)
    ));
    kill_op(&handle, op.opid).await.expect("killed");
    let outcome = tokio::time::timeout(std::time::Duration::from_secs(10), slow)
        .await
        .expect("the find stops well before its 20 s sleep")
        .expect("task");
    assert!(outcome.is_err(), "the killed find fails");
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn hides_and_unhides_an_index() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = namespace("hidable");
    fx.seed(&handle, &ns, 3).await;
    let name = indexes::create(
        &handle,
        &ns,
        CreateIndexRequest {
            keys: EJsonDocument::from(doc! { "n": 1 }),
            name: None,
            unique: false,
            sparse: false,
            hidden: false,
            expire_after_seconds: None,
            partial_filter: None,
        },
    )
    .await
    .expect("index");
    let hidden = |handle: Arc<ConnectionHandle>, ns: Namespace, name: String| async move {
        indexes::list(&handle, &ns)
            .await
            .expect("list")
            .into_iter()
            .find(|index| index.name == name)
            .expect("listed")
            .hidden
    };
    indexes::set_hidden(&handle, &ns, &name, true)
        .await
        .expect("hide");
    assert!(hidden(Arc::clone(&handle), ns.clone(), name.clone()).await);
    indexes::set_hidden(&handle, &ns, &name, false)
        .await
        .expect("unhide");
    assert!(!hidden(Arc::clone(&handle), ns.clone(), name.clone()).await);
    assert!(matches!(
        indexes::set_hidden(&handle, &ns, "_id_", true).await,
        Err(CoreError::Validation(_))
    ));
    let read_only = fx.connect(true).await;
    assert!(matches!(
        indexes::set_hidden(&read_only, &ns, &name, true).await,
        Err(CoreError::ReadOnly)
    ));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn reads_and_changes_validation_rules() {
    use odin_core::validation::{
        ValidationAction, ValidationLevel, ValidationRules, get_rules, set_rules,
    };

    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = namespace("validated");
    fx.seed(&handle, &ns, 1).await;
    let none = get_rules(&handle, &ns).await.expect("rules");
    assert_eq!(none.validator, EJsonDocument::from(doc! {}));
    assert_eq!(
        (none.level, none.action),
        (ValidationLevel::Strict, ValidationAction::Error)
    );

    let schema = doc! { "$jsonSchema": { "required": ["email"], "properties": { "email": { "bsonType": "string" } } } };
    set_rules(
        &handle,
        &ns,
        ValidationRules {
            validator: EJsonDocument::from(schema.clone()),
            level: ValidationLevel::Moderate,
            action: ValidationAction::Error,
        },
    )
    .await
    .expect("set");
    let rules = get_rules(&handle, &ns).await.expect("rules");
    assert_eq!(rules.validator, EJsonDocument::from(schema));
    assert_eq!(rules.level, ValidationLevel::Moderate);
    let collection = handle
        .client
        .database("odin_test")
        .collection::<Document>("validated");
    assert!(
        collection
            .insert_one(doc! { "name": "no email" })
            .await
            .is_err()
    );
    assert!(
        collection
            .insert_one(doc! { "email": "a@b.c" })
            .await
            .is_ok()
    );

    let read_only = fx.connect(true).await;
    assert!(matches!(
        set_rules(&read_only, &ns, rules).await,
        Err(CoreError::ReadOnly)
    ));
}

/// An OpenSSH server allowing tunnels, with a password and an encrypted client key.
async fn ssh_bastion(
    network: &str,
) -> testcontainers_modules::testcontainers::ContainerAsync<
    testcontainers_modules::testcontainers::GenericImage,
> {
    use testcontainers_modules::testcontainers::GenericImage;
    use testcontainers_modules::testcontainers::core::{IntoContainerPort, WaitFor};

    let script = "apk add --no-cache openssh >/dev/null && ssh-keygen -A >/dev/null \
        && echo 'root:s3cr3t' | chpasswd \
        && mkdir -p /root/.ssh && ssh-keygen -t ed25519 -N 'kp4ss' -f /root/client_key -q \
        && cp /root/client_key.pub /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys \
        && sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/; s/^#*PasswordAuthentication.*/PasswordAuthentication yes/; s/^#*AllowTcpForwarding.*/AllowTcpForwarding yes/' /etc/ssh/sshd_config \
        && exec /usr/sbin/sshd -D -e";
    GenericImage::new("alpine", "3.20")
        .with_exposed_port(22.tcp())
        .with_wait_for(WaitFor::message_on_stderr("Server listening"))
        .with_cmd(["sh", "-c", script])
        .with_network(network)
        .start()
        .await
        .expect("ssh server starts")
}

type Container<I> = testcontainers_modules::testcontainers::ContainerAsync<I>;

/// MongoDB and an SSH bastion on a private network: only the bastion is
/// reachable from the host, as in production setups.
struct SshFixture {
    _mongo: Container<Mongo>,
    bastion: Container<testcontainers_modules::testcontainers::GenericImage>,
    mongo_name: String,
    port: u16,
}

impl SshFixture {
    async fn start() -> Self {
        let network = format!("odin-ssh-{}", ObjectId::new());
        let mongo_name = format!("odin-mongo-{}", ObjectId::new());
        let mongo = Mongo::default()
            .with_tag(std::env::var("MONGO_VERSION").unwrap_or_else(|_| "8.0".into()))
            .with_network(&network)
            .with_container_name(&mongo_name)
            .start()
            .await
            .expect("mongo starts");
        let bastion = ssh_bastion(&network).await;
        let port = bastion.get_host_port_ipv4(22).await.expect("ssh port");
        Self {
            _mongo: mongo,
            bastion,
            mongo_name,
            port,
        }
    }

    fn settings(&self, auth: odin_core::ssh::SshAuth) -> odin_core::ssh::SshSettings {
        odin_core::ssh::SshSettings {
            host: "127.0.0.1".into(),
            port: self.port,
            username: "root".into(),
            auth,
        }
    }

    fn target(&self) -> (String, u16) {
        (self.mongo_name.clone(), 27017)
    }
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn ssh_tunnels_pin_host_keys_and_check_passwords() {
    use odin_core::ssh::{SshAuth, host_fingerprint, open_tunnel};

    let fx = SshFixture::start().await;
    let password = Secret::new("s3cr3t");
    let with = |password: &Secret, pin: Option<&str>| {
        let settings = fx.settings(SshAuth::Password);
        let target = fx.target();
        let password = password.clone();
        let pin = pin.map(str::to_owned);
        async move { open_tunnel(&settings, Some(&password), pin.as_deref(), target).await }
    };

    // Unknown key: refused before any credential is sent, fingerprint reported.
    let fingerprint = match with(&password, None).await {
        Err(CoreError::UnknownHostKey(found)) => found,
        other => panic!("expected an unknown host key, got {other:?}"),
    };
    assert!(fingerprint.starts_with("SHA256:"));
    assert_eq!(
        host_fingerprint(&fx.settings(SshAuth::Password))
            .await
            .expect("fingerprint"),
        fingerprint
    );
    assert!(matches!(
        with(&password, Some("SHA256:forged")).await,
        Err(CoreError::HostKeyChanged(found)) if found == fingerprint
    ));
    assert!(matches!(
        with(&Secret::new("wrong"), Some(&fingerprint)).await,
        Err(CoreError::Auth(_))
    ));

    let tunnel = with(&password, Some(&fingerprint)).await.expect("tunnel");
    let uri = format!(
        "mongodb://127.0.0.1:{}/?directConnection=true",
        tunnel.local_port
    );
    let info = test_connection(&uri, None, None)
        .await
        .expect("mongodb through the tunnel");
    assert_ne!(info.server_version, "");
    drop(tunnel);
    assert!(
        test_connection(&uri, None, None).await.is_err(),
        "the tunnel closes when dropped"
    );
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn ssh_tunnels_authenticate_with_encrypted_private_keys() {
    use odin_core::ssh::{SshAuth, host_fingerprint, open_tunnel};
    use testcontainers_modules::testcontainers::core::ExecCommand;

    let fx = SshFixture::start().await;
    let fingerprint = host_fingerprint(&fx.settings(SshAuth::Password))
        .await
        .expect("fingerprint");
    let mut output = fx
        .bastion
        .exec(ExecCommand::new(["cat", "/root/client_key"]))
        .await
        .expect("read the client key");
    let key = String::from_utf8(output.stdout_to_vec().await.expect("stdout")).expect("utf-8");
    let key_path = temp_path("ssh-client-key");
    std::fs::write(&key_path, key).expect("write the key");
    let settings = fx.settings(SshAuth::PrivateKey {
        path: key_path.display().to_string(),
    });

    let tunnel = open_tunnel(
        &settings,
        Some(&Secret::new("kp4ss")),
        Some(&fingerprint),
        fx.target(),
    )
    .await
    .expect("tunnel with a private key");
    let uri = format!(
        "mongodb://127.0.0.1:{}/?directConnection=true",
        tunnel.local_port
    );
    test_connection(&uri, None, None)
        .await
        .expect("mongodb through the key tunnel");
    assert!(matches!(
        open_tunnel(
            &settings,
            Some(&Secret::new("bad")),
            Some(&fingerprint),
            fx.target()
        )
        .await,
        Err(CoreError::Auth(_))
    ));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn connects_a_profile_through_ssh_after_trusting_the_host_key() {
    use odin_core::ssh::SshAuth;

    let fx = SshFixture::start().await;
    let storage = Storage::open_in_memory().expect("storage");
    let secrets = MemoryStore::default();
    let manager = ConnectionManager::default();
    let profile = profiles::create(
        &storage,
        &secrets,
        ProfileInput {
            name: "behind a bastion".into(),
            connection_string: format!("mongodb://{}:27017", fx.mongo_name),
            password: None,
            read_only: false,
            color: None,
            ssh: Some(fx.settings(SshAuth::Password)),
            ssh_secret: Some(Secret::new("s3cr3t")),
            ssh_host_key: None,
            group: None,
        },
    )
    .expect("profile");
    let connect = |profile: ConnectionProfile| {
        let ssh_secret = secrets.ssh_secret(profile.id).expect("secret");
        let manager = &manager;
        async move { manager.connect(&profile, None, ssh_secret).await }
    };

    let fingerprint = match connect(profile.clone()).await {
        Err(CoreError::UnknownHostKey(found)) => found,
        other => panic!("expected an unknown host key, got {other:?}"),
    };
    profiles::trust_host_key(&storage, profile.id, &fingerprint).expect("trust");
    let trusted = profiles::get(&storage, &secrets, profile.id).expect("profile");
    let info = connect(trusted).await.expect("connects through the tunnel");
    let handle = manager.get(info.id).await.expect("handle");
    assert!(
        handle.uri.starts_with("mongodb://127.0.0.1:"),
        "{}",
        handle.uri
    );
    handle
        .client
        .database("odin_test")
        .collection::<Document>("through_ssh")
        .insert_one(doc! { "ok": true })
        .await
        .expect("writes through the tunnel");
    let uri = handle.uri.clone();
    drop(handle);
    manager.disconnect(info.id).await.expect("disconnect");
    assert!(
        test_connection(&uri, None, None).await.is_err(),
        "disconnecting closes the tunnel"
    );
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn manages_users_and_their_roles() {
    use odin_core::users::{
        RoleRef, change_password, create_user, drop_user, list_roles, list_users, set_roles,
    };

    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let role = |role: &str, db: &str| RoleRef {
        role: role.into(),
        db: db.into(),
    };
    create_user(
        &handle,
        "shop",
        "reporter",
        &Secret::new("first-pw"),
        &[role("read", "shop")],
    )
    .await
    .expect("created");
    let users = list_users(&handle).await.expect("users");
    let reporter = users.iter().find(|u| u.user == "reporter").expect("listed");
    assert_eq!(
        (reporter.db.as_str(), reporter.roles.clone()),
        ("shop", vec![role("read", "shop")])
    );
    assert_ne!(reporter.mechanisms, Vec::<String>::new());

    set_roles(
        &handle,
        "shop",
        "reporter",
        &[role("readWrite", "shop"), role("read", "analytics")],
    )
    .await
    .expect("roles");
    let reporter = list_users(&handle)
        .await
        .expect("users")
        .into_iter()
        .find(|u| u.user == "reporter")
        .expect("listed");
    assert_eq!(reporter.roles.len(), 2);
    change_password(&handle, "shop", "reporter", &Secret::new("second-pw"))
        .await
        .expect("password");
    assert!(matches!(
        change_password(&handle, "shop", "reporter", &Secret::new("")).await,
        Err(CoreError::Validation(_))
    ));

    let roles = list_roles(&handle, "shop").await.expect("roles");
    assert!(roles.iter().any(|r| r.role == "readWrite" && r.built_in));

    let read_only = fx.connect(true).await;
    assert!(matches!(
        drop_user(&read_only, "shop", "reporter").await,
        Err(CoreError::ReadOnly)
    ));
    drop_user(&handle, "shop", "reporter")
        .await
        .expect("dropped");
    assert!(
        !list_users(&handle)
            .await
            .expect("users")
            .iter()
            .any(|u| u.user == "reporter")
    );
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn uploads_and_downloads_gridfs_files_byte_for_byte() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let dir = std::env::temp_dir().join(format!("odin-gridfs-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let source = dir.join("report.bin");
    // Bigger than one 255 kB chunk, so chunking is exercised.
    let bytes: Vec<u8> = (0..600_000_u32).map(|i| (i % 251) as u8).collect();
    std::fs::write(&source, &bytes).expect("written");

    let (progress, mut seen) = tokio::sync::mpsc::channel(1024);
    let id = odin_core::gridfs::upload(
        &handle,
        "odin_test",
        "fs",
        &source,
        progress.clone(),
        CancellationToken::new(),
    )
    .await
    .expect("uploads");
    let target = dir.join("copy.bin");
    let copied = odin_core::gridfs::download(
        &handle,
        "odin_test",
        "fs",
        id.clone(),
        &target,
        progress,
        CancellationToken::new(),
    )
    .await
    .expect("downloads");
    assert_eq!(copied, bytes.len() as u64);
    let mut last = None;
    while let Ok(update) = seen.try_recv() {
        last = Some(update);
    }
    let last = last.expect("progress reported");
    assert_eq!(last.done, last.total);

    // A cancelled download leaves neither the file nor its partial copy.
    let cancel = CancellationToken::new();
    cancel.cancel();
    let cancelled = dir.join("cancelled.bin");
    let (progress, _) = tokio::sync::mpsc::channel(1);
    assert!(matches!(
        odin_core::gridfs::download(&handle, "odin_test", "fs", id, &cancelled, progress, cancel)
            .await,
        Err(CoreError::Cancelled)
    ));
    assert!(!cancelled.exists() && !dir.join("cancelled.bin.partial").exists());
    assert_eq!(std::fs::read(&target).expect("read"), bytes);
    assert!(!dir.join("copy.bin.partial").exists());

    let read_only = fx.connect(true).await;
    let (progress, _) = tokio::sync::mpsc::channel(1);
    assert!(matches!(
        odin_core::gridfs::upload(
            &read_only,
            "odin_test",
            "fs",
            &source,
            progress,
            CancellationToken::new()
        )
        .await,
        Err(CoreError::ReadOnly)
    ));
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn lists_the_whole_catalog_in_one_call() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    fx.seed(&handle, &namespace("people"), 1).await;
    fx.seed(
        &handle,
        &Namespace {
            database: "odin_other".into(),
            collection: "things".into(),
        },
        1,
    )
    .await;
    let catalog = browse::catalog(&handle).await.expect("catalog");
    let of = |name: &str| {
        catalog
            .iter()
            .find(|entry| entry.database == name)
            .map(|entry| {
                entry
                    .collections
                    .iter()
                    .map(|c| c.name.clone())
                    .collect::<Vec<_>>()
            })
    };
    assert_eq!(of("odin_test"), Some(vec!["people".to_owned()]));
    assert_eq!(of("odin_other"), Some(vec!["things".to_owned()]));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn estimates_every_collection_count_of_a_database() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    fx.seed(&handle, &namespace("small"), 3).await;
    fx.seed(&handle, &namespace("big"), 250).await;
    handle
        .client
        .database("odin_test")
        .create_collection("big_view")
        .view_on("big".to_owned())
        .pipeline(vec![])
        .await
        .expect("view");
    let counts = browse::collection_counts(&handle, "odin_test")
        .await
        .expect("counts");
    let pairs: Vec<_> = counts.iter().map(|c| (c.name.as_str(), c.count)).collect();
    // The view is left out; system.views, which defines it, is a real collection.
    assert_eq!(
        pairs,
        [("big", 250.0), ("small", 3.0), ("system.views", 1.0)]
    );
}

/// `left` holds 0..2500; `right` lacks 0..10, changes 10..20, reorders fields on the rest
/// and has three documents of its own.
async fn seed_compare_pair(handle: &ConnectionHandle) {
    let db = handle.client.database("odin_test");
    let left: Vec<Document> = (0..2500)
        .map(|i| doc! { "_id": i, "name": format!("n{i}"), "tags": ["a", "b"] })
        .collect();
    db.collection::<Document>("left")
        .insert_many(&left)
        .await
        .expect("seed left");
    let right: Vec<Document> = (0..2500)
        // 0..10 missing on the right, 10..20 changed, field order shuffled on the rest.
        .filter(|i| *i >= 10)
        .map(|i| {
            if i < 20 {
                doc! { "_id": i, "name": "changed", "tags": ["a", "b"] }
            } else {
                doc! { "tags": ["a", "b"], "name": format!("n{i}"), "_id": i }
            }
        })
        .chain((5000..5003).map(|i| doc! { "_id": i, "name": "extra" }))
        .collect();
    db.collection::<Document>("right")
        .insert_many(&right)
        .await
        .expect("seed right");
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn compares_two_collections_by_id() {
    use odin_core::compare::{self, CompareRequest};

    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    seed_compare_pair(&handle).await;
    let (tx, _rx) = tokio::sync::mpsc::channel(64);
    let summary = compare::compare(
        &handle,
        &handle,
        CompareRequest {
            left: namespace("left"),
            right: namespace("right"),
            filter: None,
        },
        tx,
        CancellationToken::new(),
    )
    .await
    .expect("compares");
    assert_eq!(summary.identical, 2480.0);
    assert_eq!(summary.different, 10.0);
    assert_eq!(summary.only_left, 10.0);
    assert_eq!(summary.only_right, 3.0);
    assert_eq!(summary.different_ids.len(), 10);

    // A filter narrows both sides.
    let (tx, _rx) = tokio::sync::mpsc::channel(64);
    let filtered = compare::compare(
        &handle,
        &handle,
        CompareRequest {
            left: namespace("left"),
            right: namespace("right"),
            filter: Some(EJsonDocument::from(doc! { "_id": { "$lt": 15 } })),
        },
        tx,
        CancellationToken::new(),
    )
    .await
    .expect("compares filtered");
    assert_eq!(
        (filtered.only_left, filtered.different, filtered.only_right),
        (10.0, 5.0, 0.0)
    );

    let pair = compare::pair(
        &handle,
        &handle,
        &namespace("left"),
        &namespace("right"),
        EJsonValue::from(Bson::Int32(3)),
    )
    .await
    .expect("pair");
    assert!(pair.left.is_some() && pair.right.is_none());
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn syncs_one_collection_into_another() {
    use odin_core::compare::{self, CompareRequest};

    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    seed_compare_pair(&handle).await;
    // A read-only target is refused before anything is written.
    let read_only = fx.connect(true).await;
    let request = |delete_extra| compare::SyncRequest {
        compare: CompareRequest {
            left: namespace("left"),
            right: namespace("right"),
            filter: None,
        },
        insert_missing: true,
        replace_different: true,
        delete_extra,
    };
    let (tx, _rx) = tokio::sync::mpsc::channel(64);
    let refused = compare::sync(
        &handle,
        &read_only,
        request(true),
        tx,
        CancellationToken::new(),
    )
    .await;
    assert!(matches!(refused, Err(CoreError::ReadOnly)));

    // Without deletes, extras stay; with them, the right ends up identical to the left.
    let (tx, _rx) = tokio::sync::mpsc::channel(64);
    let synced = compare::sync(
        &handle,
        &handle,
        request(false),
        tx,
        CancellationToken::new(),
    )
    .await
    .expect("syncs");
    assert_eq!(
        (synced.inserted, synced.replaced, synced.deleted),
        (10.0, 10.0, 0.0)
    );
    let (tx, _rx) = tokio::sync::mpsc::channel(64);
    let synced = compare::sync(
        &handle,
        &handle,
        request(true),
        tx,
        CancellationToken::new(),
    )
    .await
    .expect("syncs with deletes");
    assert_eq!((synced.identical, synced.deleted), (2500.0, 3.0));
    let (tx, _rx) = tokio::sync::mpsc::channel(64);
    let after = compare::compare(
        &handle,
        &handle,
        request(false).compare,
        tx,
        CancellationToken::new(),
    )
    .await
    .expect("compares again");
    assert_eq!(
        (
            after.identical,
            after.different,
            after.only_left,
            after.only_right
        ),
        (2500.0, 0.0, 0.0, 0.0)
    );
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn profiles_slow_operations() {
    use odin_core::profiler::{self, ProfileQuery, ProfilingLevel, ProfilingStatus};

    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = namespace("people");
    fx.seed(&handle, &ns, 50).await;

    let before = profiler::status(&handle, "odin_test")
        .await
        .expect("status");
    assert_eq!(before.level, ProfilingLevel::Off);
    let read_only = fx.connect(true).await;
    let all = ProfilingStatus {
        level: ProfilingLevel::All,
        slow_ms: 0.0,
    };
    assert!(matches!(
        profiler::set_status(&read_only, "odin_test", all.clone()).await,
        Err(CoreError::ReadOnly)
    ));
    profiler::set_status(&handle, "odin_test", all)
        .await
        .expect("turns profiling on");
    assert_eq!(
        profiler::status(&handle, "odin_test")
            .await
            .expect("status")
            .level,
        ProfilingLevel::All
    );

    let people = handle
        .client
        .database("odin_test")
        .collection::<Document>("people");
    people.find_one(doc! { "n": 42 }).await.expect("query");
    let entries = profiler::entries(
        &handle,
        ProfileQuery {
            database: "odin_test".into(),
            collection: Some("people".into()),
            min_millis: None,
        },
    )
    .await
    .expect("entries");
    let find = entries
        .iter()
        .find(|entry| entry.op == "query")
        .expect("the find was recorded");
    assert_eq!(find.ns, "odin_test.people");
    assert_eq!(find.plan_summary.as_deref(), Some("COLLSCAN"));
    // A collection scan up to the first match (n = 42).
    assert_eq!(find.docs_examined, Some(43.0));

    profiler::set_status(
        &handle,
        "odin_test",
        ProfilingStatus {
            level: ProfilingLevel::Off,
            slow_ms: 100.0,
        },
    )
    .await
    .expect("turns profiling off");
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn infers_references_between_collections_from_data() {
    use odin_core::diagram;

    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let db = handle.client.database("odin_diagram");
    let customers: Vec<ObjectId> = (0..5).map(|_| ObjectId::new()).collect();
    let products: Vec<ObjectId> = (0..5).map(|_| ObjectId::new()).collect();
    db.collection::<Document>("customers")
        .insert_many(customers.iter().map(|id| doc! { "_id": id, "name": "Ada" }))
        .await
        .expect("customers");
    db.collection::<Document>("products")
        .insert_many(products.iter().map(|id| doc! { "_id": id, "sku": "A-1" }))
        .await
        .expect("products");
    db.collection::<Document>("orders")
        .insert_many((0..20).map(|i| {
            doc! {
                "_id": ObjectId::new(),
                // Named after nothing: found by its values alone.
                "buyer": customers[i % 5],
                "items": [{ "productId": products[i % 5], "qty": 1 }],
                // Points nowhere: no edge.
                "trackingId": ObjectId::new(),
            }
        }))
        .await
        .expect("orders");

    let (tx, _rx) = tokio::sync::mpsc::channel(64);
    let found = diagram::database_diagram(&handle, "odin_diagram", tx, CancellationToken::new())
        .await
        .expect("diagram");
    let names: Vec<_> = found.collections.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["customers", "orders", "products"]);
    let orders = &found.collections[1];
    assert!(
        orders
            .fields
            .iter()
            .any(|field| field.path == "items.productId")
    );
    let mut links: Vec<_> = found
        .links
        .iter()
        .map(|link| (link.field.as_str(), link.to.as_str(), link.many))
        .collect();
    links.sort_unstable();
    assert_eq!(
        links,
        [
            ("buyer", "customers", false),
            ("items.productId", "products", true)
        ]
    );
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn advises_an_index_for_slow_collection_scans() {
    use odin_core::advisor;

    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let db = handle.client.database("odin_advisor");
    db.collection::<Document>("orders")
        .insert_many(
            (0..3000).map(|i| doc! { "n": i, "status": if i % 100 == 0 { "late" } else { "ok" } }),
        )
        .await
        .expect("orders");
    // Records every operation, so the test needs no slow query.
    db.run_command(doc! { "profile": 2, "slowms": 0 })
        .await
        .expect("profiler on");
    for _ in 0..3 {
        let mut cursor = db
            .collection::<Document>("orders")
            .find(doc! { "status": "late" })
            .sort(doc! { "n": -1 })
            .await
            .expect("find");
        while cursor.advance().await.expect("read") {}
    }

    let report = advisor::advise(&handle).await.expect("advice");
    assert!(
        report
            .sources
            .iter()
            .any(|s| s.name == "odin_advisor" && s.operations > 0.0)
    );
    let advice = report
        .advice
        .iter()
        .find(|advice| advice.collection == "orders")
        .expect("advice for orders");
    assert_eq!(
        Document::try_from(advice.keys.clone()).expect("keys"),
        doc! { "status": 1, "n": -1 }
    );
    assert!(advice.collection_scan && advice.occurrences >= 3.0);
    assert!(advice.existing.is_none());
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn compares_two_databases_structurally() {
    use odin_core::schema_compare::{self, Presence, SchemaCompareRequest};

    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    for (database, extra) in [("odin_staging", "nickname"), ("odin_prod", "email")] {
        let db = handle.client.database(database);
        db.collection::<Document>("users")
            .insert_many((0..50).map(|i| doc! { "n": i, extra: "x" }))
            .await
            .expect("users");
        db.collection::<Document>(if database == "odin_staging" {
            "drafts"
        } else {
            "audit"
        })
        .insert_one(doc! { "n": 1 })
        .await
        .expect("other");
    }
    handle
        .client
        .database("odin_prod")
        .collection::<Document>("users")
        .create_index(
            mongodb::IndexModel::builder()
                .keys(doc! { "email": 1 })
                .build(),
        )
        .await
        .expect("index");

    let (tx, _rx) = tokio::sync::mpsc::channel(64);
    let found = schema_compare::compare_schemas(
        &handle,
        &handle,
        SchemaCompareRequest {
            left_database: "odin_staging".into(),
            right_database: "odin_prod".into(),
        },
        tx,
        CancellationToken::new(),
    )
    .await
    .expect("compared");
    let presence: Vec<_> = found
        .collections
        .iter()
        .map(|c| (c.name.as_str(), c.presence))
        .collect();
    assert_eq!(
        presence,
        [
            ("audit", Presence::RightOnly),
            ("drafts", Presence::LeftOnly),
            ("users", Presence::Both)
        ]
    );
    let users = &found.collections[2];
    let fields: Vec<_> = users.fields.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(fields, ["email", "nickname"]);
    assert_eq!(users.indexes.len(), 1);
    assert!(users.indexes[0].left.is_none() && users.indexes[0].right.is_some());
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn streams_a_collections_changes_live() {
    use odin_core::changes::{self, ChangeFeed};

    let fx = Fixture::start_replica_set().await;
    let handle = fx.connect(false).await;
    let ns = namespace("live");
    fx.seed(&handle, &ns, 1).await;
    let (tx, mut rx) = tokio::sync::mpsc::channel(64);
    let cancel = CancellationToken::new();
    let watching = {
        let (handle, ns, cancel) = (Arc::clone(&handle), ns.clone(), cancel.clone());
        tokio::spawn(async move { changes::watch(&handle, &ns, tx, cancel).await })
    };
    // The stream opens asynchronously; changes before it are not reported.
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    let collection = handle
        .client
        .database("odin_test")
        .collection::<Document>("live");
    collection
        .insert_one(doc! { "_id": 42, "status": "new" })
        .await
        .expect("insert");
    collection
        .update_one(
            doc! { "_id": 42 },
            doc! { "$set": { "status": "paid" }, "$unset": { "draft": "" } },
        )
        .await
        .expect("update");
    collection
        .delete_one(doc! { "_id": 42 })
        .await
        .expect("delete");

    let mut operations = Vec::new();
    while operations.len() < 3 {
        let next = tokio::time::timeout(std::time::Duration::from_secs(10), rx.recv())
            .await
            .expect("a change in time")
            .expect("feed open");
        if let ChangeFeed::Change(change) = next {
            if change.operation == "update" {
                assert!(change.updated.is_some());
            }
            operations.push(change.operation);
        }
    }
    assert_eq!(operations, ["insert", "update", "delete"]);
    cancel.cancel();
    watching.await.expect("joined").expect("stopped cleanly");
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn collections_can_be_capped_clustered_time_series_or_views() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = |collection: &str| Namespace {
        database: "kinds_test".into(),
        collection: collection.into(),
    };
    let create = |name: &'static str, kind: NewCollectionKind, collation: Option<Document>| {
        let handle = handle.clone();
        async move {
            let options = CollectionOptions {
                kind,
                collation: collation.map(EJsonDocument::from),
            };
            catalog::create_collection(&handle, &ns(name), &options)
                .await
                .expect("creates");
        }
    };
    create(
        "capped",
        NewCollectionKind::Capped {
            size_bytes: 4096.0,
            max_documents: Some(10),
        },
        Some(doc! { "locale": "en", "strength": 2 }),
    )
    .await;
    create(
        "metrics",
        NewCollectionKind::TimeSeries {
            time_field: "at".into(),
            meta_field: Some("sensor".into()),
            granularity: Some("minutes".into()),
            expire_after_seconds: Some(3600),
        },
        None,
    )
    .await;
    create(
        "clustered",
        NewCollectionKind::Clustered {
            expire_after_seconds: None,
        },
        None,
    )
    .await;
    fx.seed(&handle, &ns("capped"), 3).await;
    create(
        "big_n",
        NewCollectionKind::View {
            source: "capped".into(),
            pipeline: vec![EJsonDocument::from(
                doc! { "$match": { "n": { "$gte": 1 } } },
            )],
        },
        None,
    )
    .await;

    let options = |name: &'static str| {
        let handle = handle.clone();
        async move { listed_options(&handle, "kinds_test", name).await }
    };
    assert_eq!(options("capped").await.get_bool("capped").ok(), Some(true));
    assert_eq!(
        options("capped")
            .await
            .get_document("collation")
            .and_then(|c| c.get_i32("strength"))
            .ok(),
        Some(2)
    );
    assert_eq!(
        options("metrics")
            .await
            .get_document("timeseries")
            .and_then(|t| t.get_str("metaField"))
            .ok(),
        Some("sensor")
    );
    assert!(
        options("clustered")
            .await
            .get_document("clusteredIndex")
            .is_ok()
    );
    assert_eq!(
        options("big_n").await.get_str("viewOn").ok(),
        Some("capped")
    );
    let viewed = handle
        .client
        .database("kinds_test")
        .collection::<Document>("big_n")
        .count_documents(doc! {})
        .await
        .expect("counts");
    assert_eq!(viewed, 2);
}

/// A collection's options as `listCollections` reports them.
async fn listed_options(handle: &ConnectionHandle, database: &str, name: &str) -> Document {
    let reply = handle
        .client
        .database(database)
        .run_command(doc! { "listCollections": 1, "filter": { "name": name } })
        .await
        .expect("lists");
    reply
        .get_document("cursor")
        .and_then(|c| c.get_array("firstBatch"))
        .ok()
        .and_then(|batch| batch.first())
        .and_then(Bson::as_document)
        .and_then(|spec| spec.get_document("options").ok())
        .cloned()
        .unwrap_or_else(|| panic!("{name} listed"))
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn fields_are_renamed_removed_and_converted_by_filter() {
    let fx = Fixture::start().await;
    let handle = fx.connect(false).await;
    let ns = namespace("reshape");
    let collection = handle
        .client
        .database(&ns.database)
        .collection::<Document>(&ns.collection);
    collection
        .insert_many([
            doc! { "_id": 1, "price": "1.5", "old": 1 },
            doc! { "_id": 2, "price": "abc", "old": 2 },
            doc! { "_id": 3, "price": 2.5 },
            doc! { "_id": 4 },
        ])
        .await
        .expect("seeded");
    let all = || EJsonDocument::from(doc! {});
    let change = |field: &'static str, change: FieldChange| {
        let handle = handle.clone();
        let ns = ns.clone();
        async move {
            documents::change_field(&handle, &ns, all(), field, &change)
                .await
                .expect("changed")
        }
    };

    let converted = change(
        "price",
        FieldChange::Convert {
            to: ConvertTarget::Double,
        },
    )
    .await;
    assert_eq!(
        (converted.matched, converted.modified),
        (2.0, 1.0),
        "abc is kept"
    );
    let first = collection
        .find_one(doc! { "_id": 1 })
        .await
        .expect("found")
        .expect("one");
    assert_eq!(first.get_f64("price").ok(), Some(1.5));

    let renamed = change(
        "old",
        FieldChange::Rename {
            to: "legacy".into(),
        },
    )
    .await;
    assert_eq!(renamed.modified, 2.0);
    let removed = change("legacy", FieldChange::Remove).await;
    assert_eq!(removed.modified, 2.0);
    assert_eq!(
        collection
            .count_documents(
                doc! { "$or": [{ "old": { "$exists": true } }, { "legacy": { "$exists": true } }] }
            )
            .await
            .expect("counts"),
        0
    );

    let read_only = fx.connect(true).await;
    assert!(matches!(
        documents::change_field(&read_only, &ns, all(), "price", &FieldChange::Remove).await,
        Err(CoreError::ReadOnly)
    ));
}

#[tokio::test]
#[ignore = "requires Docker"]
async fn replica_set_members_are_reported_and_standalones_have_none() {
    let standalone = Fixture::start().await;
    let handle = standalone.connect(false).await;
    assert_eq!(
        odin_core::monitor::replica_set_status(&handle)
            .await
            .expect("status"),
        None
    );

    let fx = Fixture::start_replica_set().await;
    let handle = fx.connect(false).await;
    let status = odin_core::monitor::replica_set_status(&handle)
        .await
        .expect("status")
        .expect("a replica set");
    assert_eq!(status.set, "rs");
    let [member] = status.members.as_slice() else {
        panic!("one member: {status:?}")
    };
    assert_eq!(member.state, "PRIMARY");
    assert!(member.healthy && member.is_self);
    assert_eq!(member.lag_seconds, Some(0.0));
}
