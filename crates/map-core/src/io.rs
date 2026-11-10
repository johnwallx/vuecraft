//! Native file format: versioned JSON, validated on load, written atomically.

use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

use serde_json::Value;

use crate::model::{DEFAULT_LAYER, Document, FORMAT, LEGACY_FORMAT, Layer, READABLE_VERSIONS, SCHEMA_VERSION};
use crate::{Error, Result};

/// Development-era files use `.mapw`; the app's Open dialog accepts both.
pub const EXTENSION: &str = "vuecraft";
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

pub fn parse(json: &str) -> Result<Document> {
    let value: Value = serde_json::from_str(json)?;
    let obj = value.as_object().ok_or(Error::NotADocument)?;
    if !matches!(obj.get("format").and_then(Value::as_str), Some(FORMAT | LEGACY_FORMAT)) {
        return Err(Error::NotADocument);
    }
    match obj.get("schemaVersion").and_then(Value::as_u64) {
        Some(v) if READABLE_VERSIONS.contains(&v) => {}
        Some(found) => return Err(Error::UnsupportedVersion { found }),
        None => return Err(Error::Invalid("missing or invalid schemaVersion".into())),
    }
    let doc: Document =
        serde_json::from_value(value).map_err(|e| Error::Invalid(format!("unsupported or malformed content: {e}")))?;
    let doc = migrate(doc);
    doc.validate()?;
    Ok(doc)
}

/// Upgrades an older document to the current schema before validation.
/// v1 -> v2 adds only optional data: groups need nothing, and objects without a
/// layer go to the bottom layer (a default "Layer 1" when the file has none).
fn migrate(mut doc: Document) -> Document {
    doc.format = FORMAT.into();
    doc.schema_version = SCHEMA_VERSION;
    if doc.layers.is_empty() {
        doc.layers.push(Layer::new(DEFAULT_LAYER, "Layer 1"));
    }
    let bottom = doc.layers[0].id.clone();
    for n in doc.nodes.iter_mut() {
        if n.layer.is_empty() {
            n.layer = bottom.clone();
        }
        // The label is always the visible text of formatted content.
        if let Some(t) = &n.text {
            n.label = t.plain_text();
        }
    }
    for e in doc.edges.iter_mut().filter(|e| e.layer.is_empty()) {
        e.layer = bottom.clone();
    }
    doc
}

pub fn to_json(doc: &Document) -> Result<String> {
    Ok(serde_json::to_string_pretty(doc)?)
}

pub fn read(path: &Path) -> Result<Document> {
    if fs::metadata(path)?.len() > MAX_FILE_BYTES {
        return Err(Error::Invalid(format!(
            "file is larger than {} MB",
            MAX_FILE_BYTES >> 20
        )));
    }
    parse(&fs::read_to_string(path)?)
}

pub fn save(path: &Path, doc: &Document) -> Result<()> {
    doc.validate()?;
    // Images no node shows any more (removed, undone) are not written.
    let used = doc.referenced_assets();
    let mut out = doc.clone();
    out.assets.retain(|id, _| used.contains(id.as_str()));
    write_atomic(path, to_json(&out)?.as_bytes())
}

/// Writes to a sibling temp file, syncs it, then renames over the target, so a
/// failure at any point leaves the previous file untouched.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let name = path
        .file_name()
        .ok_or_else(|| Error::Invalid("path has no file name".into()))?;
    let tmp = path.with_file_name(format!(".{}.{}.tmp", name.to_string_lossy(), std::process::id()));
    let result = (|| {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    Ok(result?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Edge, Node, Shape};

    fn sample() -> Document {
        let mut d = Document {
            title: "Sample".into(),
            ..Default::default()
        };
        let mut a = Node::new("a", "Research Question\nsecond line", 10.5, -20.0);
        a.style.shape = Shape::Ellipse;
        a.style.fill = Some("#ffeeaa".into());
        d.nodes.push(a);
        d.nodes.push(Node::new("b", "Evidence & <data>", 300.0, 40.0));
        let mut e = Edge::new("ab", "a", "b");
        e.label = "supports".into();
        d.edges.push(e);
        d
    }

    #[test]
    fn round_trip_preserves_document() {
        let d = sample();
        assert_eq!(parse(&to_json(&d).unwrap()).unwrap(), d);
    }

    #[test]
    fn unknown_fields_survive_round_trip() {
        let json = r##"{"format":"vuecraft","schemaVersion":1,"futureThing":{"a":1},
            "nodes":[{"id":"a","x":0,"y":0,"width":100,"height":40,"tags":["x"]}],"edges":[]}"##;
        let d = parse(json).unwrap();
        let out: Value = serde_json::from_str(&to_json(&d).unwrap()).unwrap();
        assert_eq!(out["futureThing"]["a"], 1);
        assert_eq!(out["nodes"][0]["tags"][0], "x");
    }

    #[test]
    fn rejects_bad_documents_with_useful_errors() {
        let cases = [
            ("not json", "not valid JSON"),
            ("[1,2]", "not a VUECraft document"),
            (r#"{"format":"other","schemaVersion":1}"#, "not a VUECraft document"),
            (r#"{"format":"vuecraft","schemaVersion":99}"#, "version 99"),
            (r#"{"format":"vuecraft"}"#, "schemaVersion"),
            (r#"{"format":"vuecraft","schemaVersion":99}"#, "version 99"),
            (r#"{"format":"vuecraft","schemaVersion":0}"#, "version 0"),
            (
                r#"{"format":"vuecraft","schemaVersion":2,"nodes":[{"id":"a","x":0,"y":0,"width":10,"height":10,
                "text":{"type":"doc","content":[{"type":"script"}]}}]}"#,
                "cannot contain script",
            ),
            (
                r#"{"format":"vuecraft","schemaVersion":2,"layers":[{"id":"L","name":"L"}],
                "nodes":[{"id":"a","x":0,"y":0,"width":10,"height":10,"layer":"gone"}]}"#,
                "missing layer",
            ),
            (
                r#"{"format":"vuecraft","schemaVersion":2,"layers":[{"id":"L","name":"L"},{"id":"L","name":"M"}]}"#,
                "duplicate layer",
            ),
            (
                r#"{"format":"vuecraft","schemaVersion":2,"layers":[{"id":"L","name":"L"},{"id":"M","name":"M"}],
                "nodes":[{"id":"g","kind":"group","x":0,"y":0,"width":10,"height":10,"layer":"L"},
                {"id":"a","x":0,"y":0,"width":10,"height":10,"layer":"M","parent":"g"}]}"#,
                "same layer as its group",
            ),
            (
                r#"{"format":"vuecraft","schemaVersion":2,"nodes":[{"id":"a","x":0,"y":0,"width":10,"height":10,"parent":"nope"}]}"#,
                "missing group nope",
            ),
            (
                r#"{"format":"vuecraft","schemaVersion":2,"nodes":[{"id":"a","x":0,"y":0,"width":10,"height":10},
                {"id":"b","x":0,"y":0,"width":10,"height":10,"parent":"a"}]}"#,
                "is not a group",
            ),
            (
                r#"{"format":"vuecraft","schemaVersion":2,"nodes":[{"id":"g","kind":"group","x":0,"y":0,"width":10,"height":10},
                {"id":"h","kind":"group","x":0,"y":0,"width":10,"height":10,"parent":"g"}]}"#,
                "cannot be inside another group",
            ),
            (
                r#"{"format":"vuecraft","schemaVersion":2,"nodes":[{"id":"g","kind":"group","x":0,"y":0,"width":10,"height":10},
                {"id":"a","x":0,"y":0,"width":10,"height":10}],"edges":[{"id":"e","source":"a","target":"g"}]}"#,
                "cannot attach to group",
            ),
            (
                r#"{"format":"vuecraft","schemaVersion":1,"nodes":[{"id":"a","x":0,"y":0,"width":10,"height":10}],
                "edges":[{"id":"e","source":"a","target":"ghost"}]}"#,
                "missing node ghost",
            ),
            (
                r#"{"format":"vuecraft","schemaVersion":1,"nodes":[{"id":"a","x":0,"y":0,"width":10,"height":10},
                {"id":"a","x":0,"y":0,"width":10,"height":10}]}"#,
                "duplicate identifier",
            ),
            (
                r#"{"format":"vuecraft","schemaVersion":1,"nodes":[{"id":"a","x":0,"y":0,"width":10,"height":10,
                "style":{"shape":"hexagon"}}]}"#,
                "hexagon",
            ),
        ];
        for (json, needle) in cases {
            let msg = parse(json).unwrap_err().to_string();
            assert!(msg.contains(needle), "{json}: {msg}");
        }
    }

    #[test]
    fn save_and_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("map.vuecraft");
        save(&path, &sample()).unwrap();
        assert_eq!(read(&path).unwrap(), sample());
        save(&path, &Document::default()).unwrap(); // overwrite existing
        assert!(read(&path).unwrap().nodes.is_empty());
        let leftovers: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(leftovers.len(), 1, "no temp files left behind");
    }

    #[test]
    fn failed_save_keeps_previous_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("map.vuecraft");
        save(&path, &sample()).unwrap();
        // An invalid document is refused before anything is written.
        let mut bad = sample();
        bad.edges[0].target = "ghost".into();
        assert!(save(&path, &bad).is_err());
        // A rename onto a directory fails after the temp file is written.
        let blocked = dir.path().join("blocked");
        fs::create_dir(&blocked).unwrap();
        fs::write(blocked.join("keep"), "x").unwrap();
        assert!(save(&blocked, &sample()).is_err());
        assert_eq!(read(&path).unwrap(), sample());
        let names: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names.len(), 2, "temp file cleaned up: {names:?}");
    }

    #[test]
    fn missing_file_reports_io_error() {
        let err = read(Path::new("definitely/not/here.vuecraft")).unwrap_err();
        assert!(matches!(err, Error::Io(_)));
    }

    #[test]
    fn writes_the_vuecraft_format_marker() {
        let out: Value = serde_json::from_str(&to_json(&sample()).unwrap()).unwrap();
        assert_eq!(out["format"], "vuecraft");
    }

    /// Development-era files (working name Mapwright, `.mapw`) open and are saved as VUECraft files.
    #[test]
    fn legacy_mapwright_documents_open_and_save_as_vuecraft() {
        let dir = tempfile::tempdir().unwrap();
        let legacy = dir.path().join("old.mapw");
        let mut json: Value = serde_json::from_str(&to_json(&sample()).unwrap()).unwrap();
        json["format"] = "mapwright".into();
        fs::write(&legacy, json.to_string()).unwrap();
        let doc = read(&legacy).unwrap();
        assert_eq!(doc, sample());
        save(&legacy, &doc).unwrap();
        let written: Value = serde_json::from_str(&fs::read_to_string(&legacy).unwrap()).unwrap();
        assert_eq!(written["format"], "vuecraft");
        json["format"] = "vuecraft".into();
        assert_eq!(written, json, "nothing but the marker changes");
    }

    /// Development-era R1 document saved by the app (group, two layers, a connection, rich text,
    /// a web link and a file attachment, an embedded image): opens; saving changes only the marker.
    #[test]
    fn r1_development_document_opens_and_saves_losslessly() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/native/r1-full.mapw");
        let original: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let doc = read(&path).unwrap();
        assert_eq!((doc.nodes.len(), doc.edges.len(), doc.layers.len()), (4, 1, 2));
        assert!(doc.nodes.iter().any(|n| n.is_group()));
        let written: Value = serde_json::from_str(&to_json(&doc).unwrap()).unwrap();
        let mut expected = original;
        expected["format"] = "vuecraft".into();
        assert_eq!(written, expected);
    }

    /// The demo map used for the README screenshots stays a valid document.
    #[test]
    fn readme_demo_map_is_valid() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/assets/screenshots/demo-coral-reef.vuecraft");
        let doc = read(&path).unwrap();
        assert_eq!((doc.nodes.len(), doc.edges.len(), doc.layers.len()), (11, 9, 2));
    }

    #[test]
    fn r0_documents_open_and_upgrade_losslessly() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/native/r0-research.mapw");
        let original: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(original["schemaVersion"], 1);
        let doc = read(&path).unwrap();
        assert_eq!(doc.schema_version, SCHEMA_VERSION);
        assert_eq!((doc.nodes.len(), doc.edges.len()), (3, 2));
        let written: Value = serde_json::from_str(&to_json(&doc).unwrap()).unwrap();
        let mut expected = original;
        expected["schemaVersion"] = SCHEMA_VERSION.into();
        expected["format"] = "vuecraft".into(); // development-era marker, upgraded on load
        assert_subset(&expected, &written, "$");
        // The only new data is the default layer.
        assert_eq!(written["layers"][0]["id"], crate::model::DEFAULT_LAYER);
        assert!(
            written["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .all(|n| n["layer"] == crate::model::DEFAULT_LAYER)
        );
    }

    /// Every value in `old` appears unchanged in `new` (which may add fields).
    fn assert_subset(old: &Value, new: &Value, at: &str) {
        match (old, new) {
            (Value::Object(o), Value::Object(n)) => {
                for (k, v) in o {
                    assert_subset(v, n.get(k).unwrap_or(&Value::Null), &format!("{at}.{k}"));
                }
            }
            (Value::Array(o), Value::Array(n)) => {
                assert_eq!(o.len(), n.len(), "{at}");
                for (i, (a, b)) in o.iter().zip(n).enumerate() {
                    assert_subset(a, b, &format!("{at}[{i}]"));
                }
            }
            _ => assert_eq!(old, new, "{at}"),
        }
    }

    #[test]
    fn groups_round_trip() {
        let mut d = sample();
        let mut g = crate::model::Node::group("g", "Cluster");
        (g.x, g.y, g.width, g.height) = (-20.0, -56.0, 400.0, 200.0);
        d.nodes.insert(0, g);
        d.nodes[1].parent = Some("g".into());
        let json = to_json(&d).unwrap();
        assert!(json.contains(r#""kind": "group""#) && json.contains(r#""parent": "g""#));
        assert_eq!(parse(&json).unwrap(), d);
    }

    #[test]
    fn layer_state_round_trips_and_unlayered_objects_get_the_bottom_layer() {
        let json = r#"{"format":"vuecraft","schemaVersion":2,
            "layers":[{"id":"base","name":"Base"},{"id":"top","name":"Top","visible":false,"locked":true}],
            "nodes":[{"id":"a","x":0,"y":0,"width":10,"height":10},{"id":"b","x":0,"y":0,"width":10,"height":10,"layer":"top"}],
            "edges":[{"id":"e","source":"a","target":"b"}]}"#;
        let d = parse(json).unwrap();
        assert_eq!(
            (
                d.nodes[0].layer.as_str(),
                d.nodes[1].layer.as_str(),
                d.edges[0].layer.as_str()
            ),
            ("base", "top", "base")
        );
        assert!(!d.layers[1].visible && d.layers[1].locked);
        assert_eq!(parse(&to_json(&d).unwrap()).unwrap(), d);
    }

    #[test]
    fn tampered_or_dangling_images_are_rejected() {
        let (id, asset) = crate::assets::Asset::image(crate::assets::tests::PNG).unwrap();
        let doc = |key: &str, data: &str, image: &str| {
            format!(
                r#"{{"format":"vuecraft","schemaVersion":2,"assets":{{"{key}":{{"mime":"image/png","data":"{data}"}}}},
                "nodes":[{{"id":"a","x":0,"y":0,"width":10,"height":10,"image":"{image}"}}]}}"#
            )
        };
        let good = parse(&doc(&id, &asset.data, &id)).unwrap();
        assert_eq!(parse(&to_json(&good).unwrap()).unwrap(), good);
        let other = "0".repeat(64);
        for (json, needle) in [
            (doc(&other, &asset.data, &other), "checksum"),
            (doc(&id, "PHN2Zz4=", &id), "not the image/png"),
            (doc(&id, "@@@", &id), "base64"),
            (doc(&id, &asset.data, &other), "missing image"),
        ] {
            let msg = parse(&json).unwrap_err().to_string();
            assert!(msg.contains(needle), "{msg}");
        }
    }

    #[test]
    fn formatted_text_round_trips_and_label_follows_it() {
        let json = r#"{"format":"vuecraft","schemaVersion":2,"nodes":[{"id":"a","x":0,"y":0,"width":10,"height":10,
            "label":"stale","text":{"type":"doc","content":[{"type":"paragraph","content":[
            {"type":"text","text":"see "},{"type":"text","text":"source","marks":[{"type":"italic"},{"type":"link","attrs":{"href":"https://example.org"}}]}]}]}}]}"#;
        let d = parse(json).unwrap();
        assert_eq!(d.nodes[0].label, "see source");
        assert_eq!(parse(&to_json(&d).unwrap()).unwrap(), d);
    }
}
