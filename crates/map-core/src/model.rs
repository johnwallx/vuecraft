//! Persistent document model and integrity rules.

use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::assets::{Asset, Resource, check_resources};
use crate::rich::RichNode;
use crate::{Error, Result};

pub const FORMAT: &str = "vuecraft";
/// Format marker of development-era files (working name Mapwright). Read, then saved as `FORMAT`.
pub const LEGACY_FORMAT: &str = "mapwright";
/// Version written on save. Older versions listed in `READABLE_VERSIONS` are upgraded on load.
pub const SCHEMA_VERSION: u64 = 2;
pub const READABLE_VERSIONS: std::ops::RangeInclusive<u64> = 1..=SCHEMA_VERSION;

/// Space between a group's outline and its members (top leaves room for the title).
/// Layer given to objects from files written before layers existed.
pub const DEFAULT_LAYER: &str = "layer-1";
const MAX_NAME_LEN: usize = 200;

pub const GROUP_PAD: f64 = 20.0;
pub const GROUP_PAD_TOP: f64 = 36.0;

pub const MIN_SIZE: f64 = 8.0;
const MAX_SIZE: f64 = 100_000.0;
const MAX_COORD: f64 = 10_000_000.0;
const MAX_ID_LEN: usize = 128;
const MAX_LABEL_LEN: usize = 100_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub format: String,
    pub schema_version: u64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub nodes: Vec<Node>,
    #[serde(default)]
    pub edges: Vec<Edge>,
    /// Bottom to top. Never empty once loaded.
    #[serde(default)]
    pub layers: Vec<Layer>,
    /// Embedded images by SHA-256. Shared (Arc) so history snapshots stay cheap.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub assets: BTreeMap<String, Arc<Asset>>,
    /// Fields this version does not understand; written back unchanged on save.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    #[serde(default)]
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default, skip_serializing_if = "NodeKind::is_concept")]
    pub kind: NodeKind,
    /// Group containing this node (one level only). Positions stay absolute.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    /// Empty only in files written before layers existed (filled in on load).
    #[serde(default)]
    pub layer: String,
    /// Formatted text. When present, `label` is its plain-text projection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<RichNode>,
    /// URL and file references, opened only on explicit user action.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resources: Vec<Resource>,
    /// Embedded image (asset id).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default)]
    pub style: NodeStyle,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    #[default]
    Concept,
    /// A container whose bounds are fitted around its members.
    Group,
}

impl NodeKind {
    pub fn is_concept(&self) -> bool {
        *self == NodeKind::Concept
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct NodeStyle {
    #[serde(default)]
    pub shape: Shape,
    /// `None` means the theme default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Shape {
    Rectangle,
    #[default]
    Rounded,
    Ellipse,
    Diamond,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Edge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub layer: String,
    #[serde(default)]
    pub style: EdgeStyle,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Layer {
    pub id: String,
    pub name: String,
    #[serde(default = "yes")]
    pub visible: bool,
    /// Locked content stays visible but cannot be edited.
    #[serde(default)]
    pub locked: bool,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn yes() -> bool {
    true
}

impl Layer {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            visible: true,
            locked: false,
            extra: Map::new(),
        }
    }

    pub(crate) fn check(&self) -> Result<()> {
        check_id(&self.id)?;
        if self.name.trim().is_empty() || self.name.len() > MAX_NAME_LEN {
            return Err(invalid(format!(
                "layer {} needs a name of 1 to {MAX_NAME_LEN} characters",
                self.id
            )));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct EdgeStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub arrow: Arrow,
    #[serde(default)]
    pub curve: Curve,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Arrow {
    None,
    #[default]
    End,
    Both,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Curve {
    #[default]
    Straight,
    Curved,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            format: FORMAT.into(),
            schema_version: SCHEMA_VERSION,
            title: String::new(),
            nodes: Vec::new(),
            edges: Vec::new(),
            layers: vec![Layer::new(DEFAULT_LAYER, "Layer 1")],
            assets: BTreeMap::new(),
            extra: Map::new(),
        }
    }
}

impl Node {
    pub fn new(id: impl Into<String>, label: impl Into<String>, x: f64, y: f64) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            x,
            y,
            width: 160.0,
            height: 56.0,
            kind: NodeKind::Concept,
            parent: None,
            layer: DEFAULT_LAYER.into(),
            text: None,
            resources: Vec::new(),
            image: None,
            style: NodeStyle::default(),
            extra: Map::new(),
        }
    }

    pub fn group(id: impl Into<String>, label: impl Into<String>) -> Self {
        Self {
            kind: NodeKind::Group,
            ..Self::new(id, label, 0.0, 0.0)
        }
    }

    pub fn is_group(&self) -> bool {
        self.kind == NodeKind::Group
    }
}

impl Edge {
    pub fn new(id: impl Into<String>, source: impl Into<String>, target: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            source: source.into(),
            target: target.into(),
            label: String::new(),
            layer: DEFAULT_LAYER.into(),
            style: EdgeStyle::default(),
            extra: Map::new(),
        }
    }
}

fn invalid(msg: impl Into<String>) -> Error {
    Error::Invalid(msg.into())
}

pub(crate) fn check_id(id: &str) -> Result<()> {
    if id.is_empty() || id.len() > MAX_ID_LEN || id.chars().any(char::is_control) {
        return Err(invalid(format!("invalid identifier {id:?}")));
    }
    Ok(())
}

pub(crate) fn check_label(label: &str) -> Result<()> {
    if label.len() > MAX_LABEL_LEN {
        return Err(invalid("label is too long"));
    }
    Ok(())
}

/// Colors end up in SVG attributes, so only `#rgb` / `#rrggbb` are accepted.
pub(crate) fn check_color(c: &Option<String>) -> Result<()> {
    match c {
        Some(s) if !is_hex_color(s) => Err(invalid(format!("invalid color {s:?}; expected #rrggbb"))),
        _ => Ok(()),
    }
}

pub fn is_hex_color(s: &str) -> bool {
    let hex = s.strip_prefix('#').unwrap_or("");
    matches!(hex.len(), 3 | 6) && hex.bytes().all(|b| b.is_ascii_hexdigit())
}

pub(crate) fn check_position(id: &str, x: f64, y: f64) -> Result<()> {
    if !(x.is_finite() && y.is_finite() && x.abs() <= MAX_COORD && y.abs() <= MAX_COORD) {
        return Err(invalid(format!("node {id} has an invalid position")));
    }
    Ok(())
}

pub(crate) fn check_size(id: &str, w: f64, h: f64) -> Result<()> {
    let ok = |v: f64| v.is_finite() && (MIN_SIZE..=MAX_SIZE).contains(&v);
    if !(ok(w) && ok(h)) {
        return Err(invalid(format!("node {id} has an invalid size {w}x{h}")));
    }
    Ok(())
}

impl NodeStyle {
    pub(crate) fn check(&self) -> Result<()> {
        check_color(&self.fill)?;
        check_color(&self.stroke)
    }
}

impl EdgeStyle {
    pub(crate) fn check(&self) -> Result<()> {
        check_color(&self.color)
    }
}

impl Node {
    pub(crate) fn check(&self) -> Result<()> {
        check_id(&self.id)?;
        check_label(&self.label)?;
        check_position(&self.id, self.x, self.y)?;
        check_size(&self.id, self.width, self.height)?;
        if let Some(t) = &self.text {
            if self.is_group() {
                return Err(invalid(format!("group {} cannot hold formatted text", self.id)));
            }
            t.check_doc()?;
        }
        check_resources(&self.resources)?;
        if self.image.is_some() && self.is_group() {
            return Err(invalid(format!("group {} cannot hold an image", self.id)));
        }
        self.style.check()
    }
}

impl Document {
    pub fn node(&self, id: &str) -> Option<&Node> {
        self.nodes.iter().find(|n| n.id == id)
    }

    pub fn edge(&self, id: &str) -> Option<&Edge> {
        self.edges.iter().find(|e| e.id == id)
    }

    pub(crate) fn id_in_use(&self, id: &str) -> bool {
        self.node(id).is_some() || self.edge(id).is_some()
    }

    pub(crate) fn check_edge(&self, e: &Edge) -> Result<()> {
        check_id(&e.id)?;
        check_label(&e.label)?;
        e.style.check()?;
        self.check_layer_ref(&e.id, &e.layer)?;
        for end in [&e.source, &e.target] {
            match self.node(end) {
                None => return Err(invalid(format!("connection {} refers to missing node {end}", e.id))),
                Some(n) if n.is_group() => {
                    return Err(invalid(format!("connection {} cannot attach to group {end}", e.id)));
                }
                Some(_) => {}
            }
        }
        if e.source == e.target {
            return Err(invalid(format!("connection {} links a node to itself", e.id)));
        }
        Ok(())
    }

    /// One level of grouping: a node's parent must be an existing group, and groups have no parent.
    pub(crate) fn check_parent(&self, n: &Node) -> Result<()> {
        let Some(pid) = &n.parent else { return Ok(()) };
        if n.is_group() {
            return Err(invalid(format!(
                "group {} cannot be inside another group (nesting is not supported)",
                n.id
            )));
        }
        match self.node(pid) {
            Some(p) if p.is_group() && p.layer != n.layer => Err(invalid(format!(
                "node {} must be on the same layer as its group {pid}",
                n.id
            ))),
            Some(p) if p.is_group() => Ok(()),
            Some(_) => Err(invalid(format!("node {} has parent {pid}, which is not a group", n.id))),
            None => Err(invalid(format!("node {} refers to missing group {pid}", n.id))),
        }
    }

    pub fn layer(&self, id: &str) -> Option<&Layer> {
        self.layers.iter().find(|l| l.id == id)
    }

    pub(crate) fn check_layer_ref(&self, owner: &str, layer: &str) -> Result<()> {
        match self.layer(layer) {
            Some(_) => Ok(()),
            None => Err(invalid(format!("{owner} refers to missing layer {layer:?}"))),
        }
    }

    /// Rejects edits to content on a locked layer.
    pub(crate) fn ensure_unlocked(&self, layer: &str) -> Result<()> {
        match self.layer(layer) {
            Some(l) if l.locked => Err(invalid(format!("layer \"{}\" is locked", l.name))),
            _ => Ok(()),
        }
    }

    /// A node is shown when its layer is visible.
    pub fn node_visible(&self, n: &Node) -> bool {
        self.layer(&n.layer).is_some_and(|l| l.visible)
    }

    /// A connection is shown when its own layer and both endpoints are visible.
    pub fn edge_visible(&self, e: &Edge) -> bool {
        self.layer(&e.layer).is_some_and(|l| l.visible)
            && [&e.source, &e.target]
                .iter()
                .all(|id| self.node(id).is_some_and(|n| self.node_visible(n)))
    }

    pub fn children<'a>(&'a self, group: &'a str) -> impl Iterator<Item = &'a Node> + 'a {
        self.nodes.iter().filter(move |n| n.parent.as_deref() == Some(group))
    }

    /// Bounds that enclose a group's members with padding, or None for an empty group.
    pub fn fitted_bounds(&self, group: &str) -> Option<(f64, f64, f64, f64)> {
        let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for c in self.children(group) {
            x0 = x0.min(c.x);
            y0 = y0.min(c.y);
            x1 = x1.max(c.x + c.width);
            y1 = y1.max(c.y + c.height);
        }
        (x0 <= x1).then_some((
            x0 - GROUP_PAD,
            y0 - GROUP_PAD_TOP,
            x1 - x0 + 2.0 * GROUP_PAD,
            y1 - y0 + GROUP_PAD + GROUP_PAD_TOP,
        ))
    }

    pub(crate) fn check_image_ref(&self, n: &Node) -> Result<()> {
        match &n.image {
            Some(id) if !self.assets.contains_key(id) => {
                Err(invalid(format!("node {} refers to a missing image", n.id)))
            }
            _ => Ok(()),
        }
    }

    /// Copy without embedded image data: what the UI receives with each snapshot.
    pub fn without_assets(&self) -> Document {
        Document {
            assets: BTreeMap::new(),
            ..self.clone()
        }
    }

    /// Embedded images still referenced by a node.
    pub fn referenced_assets(&self) -> HashSet<&str> {
        self.nodes.iter().filter_map(|n| n.image.as_deref()).collect()
    }

    /// Full integrity check used when loading and before saving.
    pub fn validate(&self) -> Result<()> {
        if self.format != FORMAT {
            return Err(Error::NotADocument);
        }
        if !READABLE_VERSIONS.contains(&self.schema_version) {
            return Err(Error::UnsupportedVersion {
                found: self.schema_version,
            });
        }
        if self.layers.is_empty() {
            return Err(invalid("a document needs at least one layer"));
        }
        for (id, asset) in &self.assets {
            asset.check(id)?;
        }
        let mut layer_ids = HashSet::new();
        for l in &self.layers {
            l.check()?;
            if !layer_ids.insert(l.id.as_str()) {
                return Err(invalid(format!("duplicate layer {}", l.id)));
            }
        }
        let mut seen = HashSet::new();
        for n in &self.nodes {
            n.check()?;
            self.check_layer_ref(&n.id, &n.layer)?;
            self.check_image_ref(n)?;
            self.check_parent(n)?;
            if !seen.insert(n.id.as_str()) {
                return Err(invalid(format!("duplicate identifier {}", n.id)));
            }
        }
        for e in &self.edges {
            self.check_edge(e)?;
            if !seen.insert(e.id.as_str()) {
                return Err(invalid(format!("duplicate identifier {}", e.id)));
            }
        }
        Ok(())
    }
}
