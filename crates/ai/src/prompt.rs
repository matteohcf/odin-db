//! The instructions a model gets, and the shape its answer is held to.

use std::fmt::Write as _;

use crate::query::QueryRequest;

/// Enough for nested documents; more fields would crowd out the context of small models.
const MAX_FIELDS: usize = 200;

/// The system message: the task, the collection's fields, and a few worked examples.
#[must_use]
pub fn system_prompt(request: &QueryRequest, today: &str) -> String {
    let mut fields = String::new();
    for field in request.fields.iter().take(MAX_FIELDS) {
        let _ = writeln!(fields, "- {}: {}", field.path, field.types.join(" | "));
    }
    if fields.is_empty() {
        fields.push_str("(unknown: use the field names the request mentions)\n");
    }
    format!(
        r#"You translate requests into MongoDB find queries for the collection "{collection}".
Answer with one JSON object and nothing else:
{{"filter": {{...}}, "sort": {{...}} or null, "projection": {{...}} or null, "limit": number or null}}

Fields (path: types):
{fields}
Rules:
- Use only the fields listed, with dot notation for nested fields. Copy values as the request writes them.
- Add a condition only for what the request asks; "top", "newest", "cheapest" alone need no filter, so filter is {{}}.
- "between A and B" is {{"$gte": A, "$lte": B}}; "more than", "over", "after" are $gt; "less than", "under", "before" are $lt.
- "has X" or "with X" is {{"X": {{"$ne": null}}}}; "without X" is {{"X": {{"$exists": false}}}}; "no X" for an array is {{"$size": 0}}.
- An array field matches one value directly: {{"tags": "vip"}}; several required values use $all; exactly N elements use $size.
- Text: "contains" is {{"$regex": "word", "$options": "i"}}, "starts with" is "^word", "ends with" is "word$".
- Dates are {{"$date": "YYYY-MM-DDTHH:MM:SSZ"}}; today is {today}. A 24-hex id is {{"$oid": "..."}}.
- "newest", "latest", "most recent" sort by a date descending; "top N", "first N", "N most" set limit to N; "the oldest", "the cheapest" set limit to 1.
- Set projection only when the request names the fields to show.
- Never use $where, $function or $accumulator.

Examples (for a "books" collection, not this one):
Request: available books longer than 300 pages
{{"filter": {{"available": true, "pages": {{"$gt": 300}}}}, "sort": null, "projection": null, "limit": null}}
Request: 3 most recently published books
{{"filter": {{}}, "sort": {{"publishedAt": -1}}, "projection": null, "limit": 3}}
Request: books published before 2001 by author 65aa00000000000000000001, only title and pages
{{"filter": {{"publishedAt": {{"$lt": {{"$date": "2001-01-01T00:00:00Z"}}}}, "authorId": {{"$oid": "65aa00000000000000000001"}}}}, "sort": null, "projection": {{"title": 1, "pages": 1}}, "limit": null}}
Request: books without an isbn or whose title ends with "war"
{{"filter": {{"$or": [{{"isbn": {{"$exists": false}}}}, {{"title": {{"$regex": "war$", "$options": "i"}}}}]}}, "sort": null, "projection": null, "limit": null}}"#,
        collection = request.collection,
    )
}

/// GBNF for llama.cpp: exactly the answer object, keys in a fixed order, bounded whitespace
/// so sampling cannot run away.
pub const ANSWER_GRAMMAR: &str = r#"root    ::= "{" ws "\"filter\":" ws object "," ws "\"sort\":" ws (object | "null") "," ws "\"projection\":" ws (object | "null") "," ws "\"limit\":" ws (integer | "null") ws "}"
value   ::= object | array | string | number | "true" | "false" | "null"
object  ::= "{" ws ( string ":" ws value ( "," ws string ":" ws value )* )? ws "}"
array   ::= "[" ws ( value ( "," ws value )* )? ws "]"
string  ::= "\"" ( [^"\\\x7F\x00-\x1F] | "\\" ( ["\\/bfnrt] | "u" [0-9a-fA-F]{4} ) )* "\""
number  ::= "-"? ( "0" | [1-9] [0-9]{0,15} ) ( "." [0-9]+ )? ( [eE] [-+]? [0-9]+ )?
integer ::= [1-9] [0-9]{0,8}
ws      ::= [ \t\n]{0,8}
"#;

/// The same shape as a JSON schema, for engines that take one (Ollama's `format`).
#[must_use]
pub fn answer_schema() -> serde_json::Value {
    let document_or_null =
        serde_json::json!({ "anyOf": [{ "type": "object" }, { "type": "null" }] });
    serde_json::json!({
        "type": "object",
        "properties": {
            "filter": { "type": "object" },
            "sort": document_or_null,
            "projection": document_or_null,
            "limit": { "anyOf": [{ "type": "integer", "minimum": 1 }, { "type": "null" }] }
        },
        "required": ["filter", "sort", "projection", "limit"]
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::FieldHint;

    #[test]
    fn lists_paths_and_types_only() {
        let request = QueryRequest {
            prompt: "x".into(),
            collection: "users".into(),
            fields: vec![FieldHint {
                path: "address.city".into(),
                types: vec!["string".into(), "null".into()],
            }],
        };
        let prompt = system_prompt(&request, "2026-10-18");
        assert!(prompt.contains("- address.city: string | null"));
        assert!(prompt.contains(r#"collection "users""#));
        assert!(prompt.contains("today is 2026-10-18"));
    }
}
