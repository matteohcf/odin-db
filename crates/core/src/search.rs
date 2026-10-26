//! Searching values (and optionally field names) across collections (ADR-0055). The server
//! cannot match text in fields it does not know, so documents are read and matched here, a
//! bounded number per collection.

use bson::{Bson, Document, doc};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::CoreError;
use crate::browse::{self, CollectionKind};
use crate::connection::ConnectionHandle;
use crate::ejson::EJsonValue;
use crate::query::Namespace;
use crate::sampling::SCAN_TIME_LIMIT;

/// More hits than anyone reads; past it the search stops.
const MAX_HITS: usize = 1000;
const PREVIEW: usize = 80;
const BATCH: u32 = 500;

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    /// `None` searches every database except `admin`, `local` and `config`.
    pub database: Option<String>,
    /// `None` searches every collection of the database(s).
    pub collection: Option<String>,
    pub text: String,
    pub regex: bool,
    pub case_sensitive: bool,
    /// Also match field names, not only string values.
    pub field_names: bool,
    /// Documents read per collection at most.
    pub documents_per_collection: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub namespace: Namespace,
    pub id: EJsonValue,
    /// Where the match is, array positions included (`items.2.sku`).
    pub path: String,
    /// The matching value around the match, or the field name.
    pub preview: String,
    pub field_name: bool,
    /// The value is text, shown in quotes; ids and numbers are not.
    pub quoted: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum SearchUpdate {
    /// Starting on the `done + 1`th of `total` collections.
    Scanning {
        namespace: Namespace,
        done: u32,
        total: u32,
    },
    Hits(Vec<SearchHit>),
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SearchSummary {
    pub collections: u32,
    pub documents: f64,
    pub hits: f64,
    /// Collections with more documents than were read.
    pub partial_collections: u32,
    /// The search stopped at the hit limit.
    pub truncated: bool,
}

/// One match: its path, preview, whether it is a field name, whether the value is text.
pub(crate) type Found = (String, String, bool, bool);

pub(crate) struct Matcher {
    pattern: Regex,
    field_names: bool,
}

impl Matcher {
    pub(crate) fn new(request: &SearchRequest) -> Result<Self, CoreError> {
        let text = request.text.trim();
        if text.is_empty() {
            return Err(CoreError::Validation(
                "enter something to search for".into(),
            ));
        }
        let source = if request.regex {
            text.to_owned()
        } else {
            regex::escape(text)
        };
        let pattern = RegexBuilder::new(&source)
            .case_insensitive(!request.case_sensitive)
            .size_limit(1 << 20)
            .build()
            .map_err(|error| CoreError::Validation(format!("regular expression: {error}")))?;
        Ok(Self {
            pattern,
            field_names: request.field_names,
        })
    }

    /// Every match in `document`, with its path.
    pub(crate) fn find(&self, document: &Document) -> Vec<Found> {
        let mut found = Vec::new();
        self.walk_document(document, "", &mut found);
        found
    }

    fn walk_document(&self, document: &Document, prefix: &str, found: &mut Vec<Found>) {
        for (key, value) in document {
            let path = if prefix.is_empty() {
                key.clone()
            } else {
                format!("{prefix}.{key}")
            };
            if self.field_names && self.pattern.is_match(key) {
                found.push((path.clone(), key.clone(), true, false));
            }
            self.walk_value(value, &path, found);
        }
    }

    fn walk_value(&self, value: &Bson, path: &str, found: &mut Vec<Found>) {
        match value {
            Bson::String(text) => {
                if let Some(at) = self.pattern.find(text) {
                    found.push((
                        path.to_owned(),
                        preview(text, at.start(), at.end()),
                        false,
                        true,
                    ));
                }
            }
            // References and numbers match by their text, so an id finds the documents
            // pointing at it. The preview says what the value is.
            Bson::ObjectId(id) => {
                let hex = id.to_hex();
                if self.pattern.is_match(&hex) {
                    found.push((
                        path.to_owned(),
                        format!("ObjectId(\"{hex}\")"),
                        false,
                        false,
                    ));
                }
            }
            Bson::Int32(_) | Bson::Int64(_) | Bson::Double(_) | Bson::Decimal128(_) => {
                let text = match value {
                    Bson::Int32(n) => n.to_string(),
                    Bson::Int64(n) => n.to_string(),
                    Bson::Double(n) => n.to_string(),
                    Bson::Decimal128(n) => n.to_string(),
                    _ => String::new(),
                };
                if self.pattern.is_match(&text) {
                    found.push((path.to_owned(), text, false, false));
                }
            }
            Bson::Document(inner) => self.walk_document(inner, path, found),
            Bson::Array(items) => {
                for (index, item) in items.iter().enumerate() {
                    self.walk_value(item, &format!("{path}.{index}"), found);
                }
            }
            _ => {}
        }
    }
}

/// The text around a match, cut on character boundaries with an ellipsis where it is cut.
fn preview(text: &str, start: usize, end: usize) -> String {
    if text.chars().count() <= PREVIEW {
        return text.to_owned();
    }
    let context = PREVIEW.saturating_sub(text[start..end].chars().count()) / 2;
    let from = text[..start]
        .char_indices()
        .rev()
        .nth(context.saturating_sub(1))
        .map_or(0, |(index, _)| index);
    let to = text[end..]
        .char_indices()
        .nth(context)
        .map_or(text.len(), |(index, _)| end + index);
    let mut out = String::new();
    if from > 0 {
        out.push('…');
    }
    out.push_str(&text[from..to]);
    if to < text.len() {
        out.push('…');
    }
    out
}

async fn namespaces(
    handle: &ConnectionHandle,
    request: &SearchRequest,
) -> Result<Vec<Namespace>, CoreError> {
    let databases = match &request.database {
        Some(database) => vec![database.clone()],
        None => browse::list_databases(handle)
            .await?
            .into_iter()
            .map(|database| database.name)
            .filter(|name| !matches!(name.as_str(), "admin" | "local" | "config"))
            .collect(),
    };
    let mut namespaces = Vec::new();
    for database in databases {
        if let Some(collection) = &request.collection {
            namespaces.push(Namespace {
                database,
                collection: collection.clone(),
            });
            continue;
        }
        // Views repeat their source's data; system collections are internal.
        let mut collections: Vec<_> = browse::list_collections(handle, &database)
            .await?
            .into_iter()
            .filter(|c| c.kind != CollectionKind::View && !c.name.starts_with("system."))
            .map(|c| c.name)
            .collect();
        collections.sort();
        namespaces.extend(collections.into_iter().map(|collection| Namespace {
            database: database.clone(),
            collection,
        }));
    }
    Ok(namespaces)
}

pub async fn search(
    handle: &ConnectionHandle,
    request: SearchRequest,
    updates: mpsc::Sender<SearchUpdate>,
    cancel: CancellationToken,
) -> Result<SearchSummary, CoreError> {
    let matcher = Matcher::new(&request)?;
    let namespaces = namespaces(handle, &request).await?;
    let total = u32::try_from(namespaces.len()).unwrap_or(u32::MAX);
    let limit = i64::from(request.documents_per_collection.max(1));
    let mut summary = SearchSummary::default();
    let mut hits = 0_usize;

    for (done, namespace) in namespaces.into_iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(CoreError::Cancelled);
        }
        // Progress is lossy: a full channel only skips an update.
        let _ = updates.try_send(SearchUpdate::Scanning {
            namespace: namespace.clone(),
            done: u32::try_from(done).unwrap_or(u32::MAX),
            total,
        });
        let collection = namespace.collection(handle)?;
        let mut cursor = collection
            .find(doc! {})
            .limit(limit + 1)
            .batch_size(BATCH)
            .max_time(SCAN_TIME_LIMIT)
            .await?;
        let mut read = 0_i64;
        let mut batch = Vec::new();
        loop {
            let next = tokio::select! {
                () = cancel.cancelled() => return Err(CoreError::Cancelled),
                next = cursor.advance() => next.map_err(CoreError::from),
            };
            let next = match next {
                // Too slow to read in full: what was read is searched, the rest is not.
                Err(CoreError::TimeLimit(_)) => {
                    summary.partial_collections += 1;
                    break;
                }
                next => next?,
            };
            if !next {
                break;
            }
            read += 1;
            if read > limit {
                summary.partial_collections += 1;
                break;
            }
            let document = cursor.deserialize_current()?;
            let id = EJsonValue::from(document.get("_id").cloned().unwrap_or(Bson::Null));
            for (path, preview, field_name, quoted) in matcher.find(&document) {
                batch.push(SearchHit {
                    namespace: namespace.clone(),
                    id: id.clone(),
                    path,
                    preview,
                    field_name,
                    quoted,
                });
                hits += 1;
                // One past the limit proves there was more to find.
                if hits > MAX_HITS {
                    batch.pop();
                    hits -= 1;
                    summary.truncated = true;
                    break;
                }
            }
            if summary.truncated {
                break;
            }
        }
        #[allow(clippy::cast_precision_loss)]
        {
            summary.documents += read.min(limit) as f64;
        }
        summary.collections += 1;
        if !batch.is_empty() {
            // Hits are results, not progress: wait for room rather than drop them.
            if updates.send(SearchUpdate::Hits(batch)).await.is_err() {
                return Err(CoreError::Cancelled);
            }
        }
        if summary.truncated {
            break;
        }
    }
    #[allow(clippy::cast_precision_loss)]
    {
        summary.hits = hits as f64;
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(text: &str) -> SearchRequest {
        SearchRequest {
            database: None,
            collection: None,
            text: text.into(),
            regex: false,
            case_sensitive: false,
            field_names: false,
            documents_per_collection: 100,
        }
    }

    #[test]
    fn finds_values_in_nested_documents_and_arrays() {
        let matcher = Matcher::new(&request("milano")).expect("valid");
        let found = matcher.find(&doc! {
            "city": "Milano",
            "address": { "street": "Via Roma", "town": "MILANO centro" },
            "tags": ["x", "a milanos"],
            "n": 5,
        });
        let paths: Vec<_> = found.iter().map(|(path, ..)| path.as_str()).collect();
        assert_eq!(paths, ["city", "address.town", "tags.1"]);
    }

    #[test]
    fn ids_and_numbers_match_by_their_text() {
        let id = bson::oid::ObjectId::parse_str("65f0a1c30000000000000001").expect("oid");
        let found = Matcher::new(&request("65f0a1c30000000000000001"))
            .expect("valid")
            .find(&doc! { "customerId": id, "other": "x" });
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].0, "customerId");
        assert_eq!(found[0].1, "ObjectId(\"65f0a1c30000000000000001\")");
        let numbers = Matcher::new(&request("1234")).expect("valid").find(&doc! {
            "zip": 1234, "big": 99_991_234_i64, "price": 12.5,
        });
        let paths: Vec<_> = numbers.iter().map(|(path, ..)| path.as_str()).collect();
        assert_eq!(paths, ["zip", "big"]);
    }

    #[test]
    fn matches_field_names_only_when_asked_and_respects_case_and_regex() {
        let mut names = request("^e?mail$");
        names.regex = true;
        names.field_names = true;
        let found = Matcher::new(&names)
            .expect("valid")
            .find(&doc! { "email": "x", "mail": "y" });
        assert_eq!(found.len(), 2);
        assert!(found.iter().all(|(_, _, field, _)| *field));

        let mut exact = request("Rome");
        exact.case_sensitive = true;
        assert_eq!(
            Matcher::new(&exact)
                .expect("valid")
                .find(&doc! { "c": "rome" })
                .len(),
            0
        );
        // Plain text is literal: a dot is a dot.
        assert_eq!(
            Matcher::new(&request("a.c"))
                .expect("valid")
                .find(&doc! { "c": "abc" })
                .len(),
            0
        );
        let mut broken = request("(");
        broken.regex = true;
        assert!(Matcher::new(&broken).is_err());
        assert!(Matcher::new(&request("  ")).is_err());
    }

    #[test]
    fn previews_cut_long_text_around_the_match() {
        let text = format!("{}needle{}", "a".repeat(200), "é".repeat(200));
        let start = 200;
        let shown = preview(&text, start, start + 6);
        assert!(shown.starts_with('…') && shown.ends_with('…'), "{shown}");
        assert!(shown.contains("needle"));
        assert!(shown.chars().count() <= PREVIEW + 2);
        assert_eq!(preview("short", 0, 5), "short");
    }
}
