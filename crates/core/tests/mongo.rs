//! Integration tests against a real MongoDB in Docker (ADR-0020).
//! Ignored by default so `cargo test` stays Docker-free: run with `pnpm test:integration`.
//! `MONGO_VERSION` selects the server image tag (default 8.0).

// Fixture helpers are not `#[test]` functions, so clippy's test exemption does not reach them.
#![allow(clippy::expect_used)]

use bson::{Binary, Bson, DateTime, Decimal128, Document, doc, oid::ObjectId, spec::BinarySubtype};
use odin_core::connection::{ConnectionHandle, ConnectionManager, test_connection};
use odin_core::ejson::{EJsonDocument, EJsonValue};
use odin_core::indexes::{self, CreateIndexRequest};
use odin_core::profiles::{self, ConnectionProfile, ProfileInput};
use odin_core::query::{
    AggregateRequest, CursorRegistry, FindRequest, Namespace, count_documents, preview_aggregation,
};
use odin_core::secrets::{MemoryStore, Secret};
use odin_core::storage::Storage;
use odin_core::{CoreError, browse, documents};
use std::str::FromStr;
use std::sync::Arc;
use testcontainers_modules::mongo::Mongo;
use testcontainers_modules::testcontainers::runners::AsyncRunner;
use testcontainers_modules::testcontainers::{ContainerAsync, ImageExt};

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
