//! Links found in documents, opened in the user's browser or mail app.

use crate::error::CoreError;

/// Accepts web and mail links only: a value in a document must never launch a
/// local file or another application's URL scheme.
pub fn checked_link(text: &str) -> Result<&str, CoreError> {
    let link = text.trim();
    let lower = link.to_ascii_lowercase();
    let allowed = ["http://", "https://", "mailto:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme) && link.len() > scheme.len());
    if !allowed || link.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(CoreError::Validation(
            "only http, https and mailto links can be opened".into(),
        ));
    }
    Ok(link)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_web_and_mail_links() {
        assert_eq!(
            checked_link(" https://example.com/a?b=1 ").unwrap(),
            "https://example.com/a?b=1"
        );
        assert!(checked_link("HTTP://example.com").is_ok());
        assert!(checked_link("mailto:ada@example.com").is_ok());
    }

    #[test]
    fn rejects_everything_else() {
        for link in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "vscode://open",
            "https://",
            "https://example.com/a b",
            "https://example.com/\nx",
            "example.com",
        ] {
            assert!(checked_link(link).is_err(), "{link}");
        }
    }
}
