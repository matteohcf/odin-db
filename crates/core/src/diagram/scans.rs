//! Completed diagram scans, kept so reopening a diagram costs the server nothing (ADR-0060).

use std::fmt;

use jiff::Zoned;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{DatabaseDiagram, ScanPace};
use crate::CoreError;
use crate::profiles::ProfileId;
use crate::storage::Storage;

const MAX_KEPT: u32 = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(transparent)]
pub struct ScanId(Uuid);

impl ScanId {
    pub(crate) fn parse(value: &str) -> Result<Self, CoreError> {
        Uuid::parse_str(value)
            .map(Self)
            .map_err(|error| CoreError::Storage(format!("corrupt diagram scan id: {error}")))
    }
}

impl fmt::Display for ScanId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DiagramScanSummary {
    pub id: ScanId,
    /// Unix milliseconds.
    pub created_at: f64,
    pub pace: ScanPace,
    /// Every node, views included.
    pub collections: f64,
    pub links: f64,
    /// Collections that could not be sampled (time limit, permissions).
    pub skipped: f64,
}

impl ScanPace {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Fast => "fast",
            Self::Balanced => "balanced",
            Self::Gentle => "gentle",
        }
    }

    pub(crate) fn parse(value: &str) -> Result<Self, CoreError> {
        match value {
            "fast" => Ok(Self::Fast),
            "balanced" => Ok(Self::Balanced),
            "gentle" => Ok(Self::Gentle),
            other => Err(CoreError::Storage(format!("unknown scan pace {other}"))),
        }
    }
}

/// Saves a completed scan and deletes the database's scans beyond the newest `keep` (1–50).
pub fn save(
    storage: &Storage,
    profile_id: ProfileId,
    database: &str,
    pace: ScanPace,
    diagram: &DatabaseDiagram,
    keep: u32,
) -> Result<DiagramScanSummary, CoreError> {
    #[allow(clippy::cast_precision_loss)]
    let summary = DiagramScanSummary {
        id: ScanId(Uuid::now_v7()),
        created_at: Zoned::now().timestamp().as_millisecond() as f64,
        pace,
        collections: diagram.collections.len() as f64,
        links: diagram.links.len() as f64,
        skipped: diagram
            .collections
            .iter()
            .filter(|collection| collection.error.is_some())
            .count() as f64,
    };
    let json = serde_json::to_string(diagram)
        .map_err(|error| CoreError::Storage(format!("diagram not serializable: {error}")))?;
    storage.insert_diagram_scan(
        profile_id,
        database,
        &summary,
        &json,
        keep.clamp(1, MAX_KEPT),
    )?;
    Ok(summary)
}

/// The database's saved scans, newest first.
pub fn list(
    storage: &Storage,
    profile_id: ProfileId,
    database: &str,
) -> Result<Vec<DiagramScanSummary>, CoreError> {
    storage.list_diagram_scans(profile_id, database)
}

pub fn get(storage: &Storage, id: ScanId) -> Result<DatabaseDiagram, CoreError> {
    let json = storage.get_diagram_scan(id)?;
    serde_json::from_str(&json)
        .map_err(|error| CoreError::Storage(format!("unreadable diagram scan: {error}")))
}

/// Deletes every saved scan; returns how many.
pub fn clear(storage: &Storage) -> Result<u32, CoreError> {
    storage.clear_diagram_scans()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browse::CollectionKind;
    use crate::diagram::{DiagramCollection, DiagramLink};
    use crate::profiles::{self, ProfileInput};
    use crate::secrets::MemoryStore;

    fn collection(name: &str, kind: CollectionKind, error: Option<&str>) -> DiagramCollection {
        DiagramCollection {
            name: name.to_owned(),
            kind,
            documents: 3.0,
            fields: Vec::new(),
            error: error.map(str::to_owned),
        }
    }

    fn diagram() -> DatabaseDiagram {
        DatabaseDiagram {
            collections: vec![
                collection("active_users", CollectionKind::View, None),
                collection("orders", CollectionKind::Collection, None),
                collection("logs", CollectionKind::Collection, Some("time limit")),
            ],
            links: vec![DiagramLink {
                from: "orders".into(),
                field: "userId".into(),
                to: "users".into(),
                many: false,
                matched: 4.0,
                checked: 4.0,
            }],
        }
    }

    fn setup() -> (Storage, MemoryStore, ProfileId) {
        let storage = Storage::open_in_memory().unwrap();
        let secrets = MemoryStore::default();
        let profile = profiles::create(
            &storage,
            &secrets,
            ProfileInput {
                name: "Local".into(),
                connection_string: "mongodb://localhost:27017".into(),
                password: None,
                read_only: false,
                color: None,
                ssh: None,
                ssh_secret: None,
                ssh_host_key: None,
                group: None,
            },
        )
        .unwrap();
        (storage, secrets, profile.id)
    }

    #[test]
    fn saves_scans_and_reads_them_back() {
        let (storage, _secrets, profile) = setup();
        let saved = save(&storage, profile, "shop", ScanPace::Gentle, &diagram(), 10).unwrap();
        assert_eq!(
            (saved.pace, saved.collections, saved.links, saved.skipped),
            (ScanPace::Gentle, 3.0, 1.0, 1.0)
        );
        assert_eq!(
            list(&storage, profile, "shop").unwrap(),
            std::slice::from_ref(&saved)
        );
        assert_eq!(list(&storage, profile, "other").unwrap().len(), 0);
        let read = get(&storage, saved.id).unwrap();
        assert_eq!(read.collections[2].error.as_deref(), Some("time limit"));
        assert_eq!(read.links, diagram().links);
    }

    #[test]
    fn keeps_the_newest_scans_per_database() {
        let (storage, _secrets, profile) = setup();
        let ids: Vec<_> = (0..3)
            .map(|_| {
                save(&storage, profile, "shop", ScanPace::Fast, &diagram(), 2)
                    .unwrap()
                    .id
            })
            .collect();
        save(&storage, profile, "crm", ScanPace::Fast, &diagram(), 2).unwrap();
        let kept: Vec<_> = list(&storage, profile, "shop")
            .unwrap()
            .into_iter()
            .map(|scan| scan.id)
            .collect();
        assert_eq!(kept, [ids[2], ids[1]]);
        // Lowering the setting prunes at the next save; zero still keeps the scan just made.
        let last = save(&storage, profile, "shop", ScanPace::Fast, &diagram(), 0).unwrap();
        assert_eq!(list(&storage, profile, "shop").unwrap(), [last]);
        assert_eq!(list(&storage, profile, "crm").unwrap().len(), 1);
    }

    #[test]
    fn clearing_and_deleting_the_profile_remove_scans() {
        let (storage, secrets, profile) = setup();
        save(&storage, profile, "shop", ScanPace::Fast, &diagram(), 10).unwrap();
        save(&storage, profile, "crm", ScanPace::Fast, &diagram(), 10).unwrap();
        assert_eq!(clear(&storage).unwrap(), 2);
        assert_eq!(list(&storage, profile, "shop").unwrap().len(), 0);

        save(&storage, profile, "shop", ScanPace::Fast, &diagram(), 10).unwrap();
        profiles::delete(&storage, &secrets, profile).unwrap();
        assert_eq!(list(&storage, profile, "shop").unwrap().len(), 0);
    }

    #[test]
    fn a_missing_scan_is_not_found() {
        let (storage, _secrets, _profile) = setup();
        assert!(matches!(
            get(&storage, ScanId(Uuid::now_v7())),
            Err(CoreError::NotFound(_))
        ));
    }
}
