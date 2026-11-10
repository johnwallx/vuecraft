//! Rich node text: a small, validated subset of ProseMirror JSON. Never HTML.
//!
//! Allowed: doc > (paragraph | bulletList | orderedList)*, paragraph > (text | hardBreak)*,
//! lists > listItem+ > (paragraph | list)*. Marks: bold, italic, link{href}. Link targets
//! must be http, https or mailto; nothing is fetched or opened by the engine.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{Error, Result};

const MAX_DEPTH: usize = 16;
const MAX_NODES: usize = 5_000;
const MAX_URL_LEN: usize = 2_048;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RichNode {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<RichNode>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub marks: Vec<RichMark>,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub attrs: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RichMark {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub attrs: Map<String, Value>,
}

fn bad(msg: impl Into<String>) -> Error {
    Error::Invalid(format!("rich text: {}", msg.into()))
}

/// http(s) or mailto, no whitespace or control characters.
pub fn is_safe_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    url.len() <= MAX_URL_LEN
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
        && ((lower.starts_with("https://") || lower.starts_with("http://")) && url.len() > 8
            || lower.starts_with("mailto:") && url.len() > 7)
}

impl RichNode {
    /// Validates a whole document (`type: "doc"`).
    pub fn check_doc(&self) -> Result<()> {
        if self.kind != "doc" {
            return Err(bad("the root must be a doc"));
        }
        let mut count = 0;
        self.check(0, &mut count)
    }

    fn check(&self, depth: usize, count: &mut usize) -> Result<()> {
        *count += 1;
        if depth > MAX_DEPTH || *count > MAX_NODES {
            return Err(bad("too deeply nested or too large"));
        }
        let children: &[&str] = match self.kind.as_str() {
            "doc" => &["paragraph", "bulletList", "orderedList"],
            "paragraph" => &["text", "hardBreak"],
            "bulletList" | "orderedList" => &["listItem"],
            "listItem" => &["paragraph", "bulletList", "orderedList"],
            "text" | "hardBreak" => &[],
            other => return Err(bad(format!("unsupported element {other:?}"))),
        };
        match self.kind.as_str() {
            "text" => match &self.text {
                Some(t) if !t.is_empty() => {}
                _ => return Err(bad("text nodes need text")),
            },
            _ if self.text.is_some() => return Err(bad(format!("{} cannot hold text", self.kind))),
            _ => {}
        }
        if self.kind != "text" && !self.marks.is_empty() {
            return Err(bad("only text can carry formatting"));
        }
        for (k, v) in &self.attrs {
            let ok =
                self.kind == "orderedList" && k == "start" && v.as_u64().is_some_and(|n| (1..=1_000_000).contains(&n));
            if !ok {
                return Err(bad(format!("unsupported attribute {k:?} on {}", self.kind)));
            }
        }
        for (i, m) in self.marks.iter().enumerate() {
            match m.kind.as_str() {
                "bold" | "italic" if m.attrs.is_empty() => {}
                "link" => {
                    let href = m.attrs.get("href").and_then(Value::as_str);
                    if m.attrs.len() != 1 || !href.is_some_and(is_safe_url) {
                        return Err(bad("links need an http, https or mailto address"));
                    }
                }
                other => return Err(bad(format!("unsupported formatting {other:?}"))),
            }
            if self.marks[..i].iter().any(|p| p.kind == m.kind) {
                return Err(bad("repeated formatting"));
            }
        }
        if matches!(self.kind.as_str(), "bulletList" | "orderedList") && self.content.is_empty() {
            return Err(bad("lists need at least one item"));
        }
        for c in &self.content {
            if !children.contains(&c.kind.as_str()) {
                return Err(bad(format!("{} cannot contain {}", self.kind, c.kind)));
            }
            c.check(depth + 1, count)?;
        }
        Ok(())
    }

    /// Visible text, one line per paragraph or list item; used for labels, search and export.
    pub fn plain_text(&self) -> String {
        let mut lines = Vec::new();
        for block in &self.content {
            block_lines(block, "", &mut lines);
        }
        lines.join("\n")
    }
}

fn inline(n: &RichNode, out: &mut String) {
    match n.kind.as_str() {
        "text" => out.push_str(n.text.as_deref().unwrap_or("")),
        "hardBreak" => out.push('\n'),
        _ => n.content.iter().for_each(|c| inline(c, out)),
    }
}

fn block_lines(n: &RichNode, indent: &str, lines: &mut Vec<String>) {
    match n.kind.as_str() {
        "paragraph" => {
            let mut s = String::new();
            inline(n, &mut s);
            lines.push(format!("{indent}{s}"));
        }
        "bulletList" | "orderedList" => {
            let start = n.attrs.get("start").and_then(Value::as_u64).unwrap_or(1);
            for (i, item) in n.content.iter().enumerate() {
                let marker = if n.kind == "bulletList" {
                    "• ".to_string()
                } else {
                    format!("{}. ", start + i as u64)
                };
                for (j, child) in item.content.iter().enumerate() {
                    let prefix = if j == 0 {
                        format!("{indent}{marker}")
                    } else {
                        format!("{indent}  ")
                    };
                    match child.kind.as_str() {
                        "paragraph" => {
                            let mut s = String::new();
                            inline(child, &mut s);
                            // Continuation lines (after a line break) align under the item text.
                            lines.push(format!("{prefix}{}", s.replace('\n', &format!("\n{indent}  "))));
                        }
                        _ => block_lines(child, &format!("{indent}  "), lines),
                    }
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> RichNode {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn plain_text_projection() {
        let doc = parse(
            r#"{"type":"doc","content":[
            {"type":"paragraph","content":[{"type":"text","text":"Claim "},{"type":"text","text":"strong","marks":[{"type":"bold"}]},
                {"type":"hardBreak"},{"type":"text","text":"line two"}]},
            {"type":"bulletList","content":[
                {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]},
                    {"type":"orderedList","attrs":{"start":3},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"deep"}]}]}]}]},
                {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"b","marks":[{"type":"link","attrs":{"href":"https://example.org"}}]},{"type":"hardBreak"},{"type":"text","text":"b2"}]}]}]},
            {"type":"paragraph"}]}"#,
        );
        doc.check_doc().unwrap();
        assert_eq!(doc.plain_text(), "Claim strong\nline two\n• a\n  3. deep\n• b\n  b2\n");
    }

    #[test]
    fn rejects_unsafe_or_unknown_content() {
        let cases = [
            r#"{"type":"paragraph"}"#,
            r#"{"type":"doc","content":[{"type":"heading","content":[]}]}"#,
            r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]}]}]}"#,
            r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"https://a.b","onclick":"x"}}]}]}]}"#,
            r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"code"}]}]}]}"#,
            r#"{"type":"doc","content":[{"type":"paragraph","attrs":{"style":"x"}}]}"#,
            r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":""}]}]}"#,
            r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"paragraph"}]}]}"#,
            r#"{"type":"doc","content":[{"type":"bulletList"}]}"#,
            r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"bold"},{"type":"bold"}]}]}]}"#,
        ];
        for json in cases {
            assert!(parse(json).check_doc().is_err(), "{json}");
        }
        let mut deep = r#"{"type":"paragraph"}"#.to_string();
        for _ in 0..20 {
            deep = format!(r#"{{"type":"bulletList","content":[{{"type":"listItem","content":[{deep}]}}]}}"#);
        }
        assert!(
            parse(&format!(r#"{{"type":"doc","content":[{deep}]}}"#))
                .check_doc()
                .is_err()
        );
    }

    #[test]
    fn url_rules() {
        for ok in [
            "https://example.org/a?b=c",
            "http://x.y",
            "mailto:a@b.c",
            "HTTPS://EXAMPLE.ORG",
        ] {
            assert!(is_safe_url(ok), "{ok}");
        }
        for no in [
            "javascript:x",
            "file:///c:/x",
            "https://",
            "https://a b",
            "data:text/html,x",
            "ftp://x",
            "",
        ] {
            assert!(!is_safe_url(no), "{no}");
        }
    }
}
