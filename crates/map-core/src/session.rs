//! Semantic edit operations, atomic transactions, undo/redo and dirty tracking.

use serde::{Deserialize, Serialize};

use crate::assets::{Asset, Resource, check_resources};
use crate::model::{Document, Edge, EdgeStyle, Layer, Node, NodeStyle, check_label, check_position, check_size};
use crate::rich::RichNode;
use crate::{Error, Result};
use std::sync::Arc;

const MAX_HISTORY: usize = 500;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Op {
    AddNode {
        node: Node,
        #[serde(default)]
        index: Option<usize>,
    },
    /// Also removes every connection attached to the node.
    RemoveNode {
        id: String,
    },
    AddEdge {
        edge: Edge,
        #[serde(default)]
        index: Option<usize>,
    },
    RemoveEdge {
        id: String,
    },
    MoveNode {
        id: String,
        x: f64,
        y: f64,
    },
    ResizeNode {
        id: String,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    /// Sets plain text and drops any formatting.
    SetNodeLabel {
        id: String,
        label: String,
    },
    /// Sets formatted text; the label becomes its plain-text projection.
    SetNodeText {
        id: String,
        text: RichNode,
    },
    /// Replaces a node's URL/file references.
    SetNodeResources {
        id: String,
        resources: Vec<Resource>,
    },
    /// Shows an embedded image (added with `Session::add_image`) on a node, or removes it.
    SetNodeImage {
        id: String,
        #[serde(default)]
        image: Option<String>,
    },
    SetNodeStyle {
        id: String,
        style: NodeStyle,
    },
    SetEdgeLabel {
        id: String,
        label: String,
    },
    SetEdgeStyle {
        id: String,
        style: EdgeStyle,
    },
    /// Puts top-level concept nodes into a new group, fitted around them.
    Group {
        group: Node,
        children: Vec<String>,
        #[serde(default)]
        index: Option<usize>,
    },
    /// Removes a group, keeping its members in place. Same as RemoveNode on a group.
    Ungroup {
        id: String,
    },
    AddLayer {
        layer: Layer,
        #[serde(default)]
        index: Option<usize>,
    },
    /// Deletes a layer. Its contents move to `into`, which is required when it has any.
    RemoveLayer {
        id: String,
        #[serde(default)]
        into: Option<String>,
    },
    /// Renames, shows/hides, or locks/unlocks a layer.
    UpdateLayer {
        id: String,
        name: String,
        visible: bool,
        locked: bool,
    },
    MoveLayer {
        id: String,
        index: usize,
    },
    /// Moves a node or connection to another layer. Moving a group moves its members.
    SetLayer {
        id: String,
        layer: String,
    },
}

/// One user-meaningful edit. `base_revision` must equal the session revision the
/// edit was made against, so a stale or reordered commit cannot overwrite newer state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub base_revision: u64,
    pub label: String,
    pub ops: Vec<Op>,
}

#[derive(Debug, Clone)]
struct Entry {
    label: String,
    /// Ops that take the document to the other side of this history step.
    ops: Vec<Op>,
    /// State id on the other side of this step.
    state: u64,
}

#[derive(Debug, Clone)]
pub struct Session {
    doc: Document,
    revision: u64,
    undo: Vec<Entry>,
    redo: Vec<Entry>,
    state: u64,
    next_state: u64,
    saved_state: u64,
}

impl Default for Session {
    fn default() -> Self {
        Self::new(Document::default())
    }
}

impl Session {
    pub fn new(doc: Document) -> Self {
        Self {
            doc,
            revision: 0,
            undo: Vec::new(),
            redo: Vec::new(),
            state: 0,
            next_state: 0,
            saved_state: 0,
        }
    }

    pub fn document(&self) -> &Document {
        &self.doc
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn dirty(&self) -> bool {
        self.state != self.saved_state
    }
    pub fn mark_saved(&mut self) {
        self.saved_state = self.state;
    }
    /// Stores validated image bytes and returns the asset id. Content-addressed and
    /// immutable, so it needs no history: undo only changes which node shows it, and
    /// unreferenced images are dropped when saving.
    pub fn add_image(&mut self, bytes: &[u8]) -> Result<String> {
        let (id, asset) = Asset::image(bytes)?;
        self.doc.assets.entry(id.clone()).or_insert_with(|| Arc::new(asset));
        Ok(id)
    }

    pub fn undo_label(&self) -> Option<&str> {
        self.undo.last().map(|e| e.label.as_str())
    }
    pub fn redo_label(&self) -> Option<&str> {
        self.redo.last().map(|e| e.label.as_str())
    }

    /// Applies all ops or none. A transaction that changes nothing adds no history.
    pub fn apply(&mut self, tx: Transaction) -> Result<()> {
        if tx.base_revision != self.revision {
            return Err(Error::Stale);
        }
        let before = self.doc.clone();
        let inverse = match apply_all(&mut self.doc, tx.ops) {
            Ok(inv) => inv,
            Err(e) => {
                self.doc = before;
                return Err(e);
            }
        };
        if self.doc == before {
            return Ok(());
        }
        self.undo.push(Entry {
            label: tx.label,
            ops: inverse,
            state: self.state,
        });
        if self.undo.len() > MAX_HISTORY {
            self.undo.remove(0);
        }
        self.redo.clear();
        self.next_state += 1;
        self.state = self.next_state;
        self.revision += 1;
        Ok(())
    }

    /// Returns false when there was nothing to undo.
    pub fn undo(&mut self) -> Result<bool> {
        self.step(true)
    }

    pub fn redo(&mut self) -> Result<bool> {
        self.step(false)
    }

    fn step(&mut self, undo: bool) -> Result<bool> {
        let (from, to) = if undo {
            (&mut self.undo, &mut self.redo)
        } else {
            (&mut self.redo, &mut self.undo)
        };
        let Some(entry) = from.pop() else { return Ok(false) };
        let before = self.doc.clone();
        match apply_all(&mut self.doc, entry.ops.clone()) {
            Ok(inverse) => {
                to.push(Entry {
                    label: entry.label,
                    ops: inverse,
                    state: self.state,
                });
                self.state = entry.state;
                self.revision += 1;
                Ok(true)
            }
            Err(e) => {
                self.doc = before;
                from.push(entry);
                Err(e)
            }
        }
    }
}

/// Applies ops in order; returns ops that revert them. Leaves `doc` partially
/// modified on error, so callers restore from a copy.
fn apply_all(doc: &mut Document, ops: Vec<Op>) -> Result<Vec<Op>> {
    let mut inverse = Vec::new();
    for op in ops {
        let mut inv = apply_op(doc, op)?;
        inv.append(&mut inverse);
        inverse = inv;
    }
    Ok(inverse)
}

fn node_mut<'a>(doc: &'a mut Document, id: &str) -> Result<&'a mut Node> {
    doc.nodes
        .iter_mut()
        .find(|n| n.id == id)
        .ok_or_else(|| Error::Invalid(format!("node {id} does not exist")))
}

fn edge_mut<'a>(doc: &'a mut Document, id: &str) -> Result<&'a mut Edge> {
    doc.edges
        .iter_mut()
        .find(|e| e.id == id)
        .ok_or_else(|| Error::Invalid(format!("connection {id} does not exist")))
}

fn ensure_unused(doc: &Document, id: &str) -> Result<()> {
    if doc.id_in_use(id) {
        return Err(Error::Invalid(format!("identifier {id} is already in use")));
    }
    Ok(())
}

fn node_index(doc: &Document, id: &str) -> Result<usize> {
    doc.nodes
        .iter()
        .position(|n| n.id == id)
        .ok_or_else(|| Error::Invalid(format!("node {id} does not exist")))
}

/// Re-fits `group` around its members. Returns the op that restores the previous
/// bounds, so inverses can undo exactly even when stored bounds were not fitted.
fn refit(doc: &mut Document, group: Option<&str>) -> Result<Option<Op>> {
    let Some(gid) = group else { return Ok(None) };
    let Some((x, y, width, height)) = doc.fitted_bounds(gid) else {
        return Ok(None);
    };
    check_position(gid, x, y)?;
    check_size(gid, width, height)?;
    let Some(g) = doc.nodes.iter_mut().find(|n| n.id == gid) else {
        return Ok(None);
    };
    if (g.x, g.y, g.width, g.height) == (x, y, width, height) {
        return Ok(None);
    }
    let old = Op::ResizeNode {
        id: g.id.clone(),
        x: g.x,
        y: g.y,
        width: g.width,
        height: g.height,
    };
    (g.x, g.y, g.width, g.height) = (x, y, width, height);
    Ok(Some(old))
}

/// Removes a group but keeps its members where they are.
fn ungroup(doc: &mut Document, id: &str) -> Result<Vec<Op>> {
    let i = node_index(doc, id)?;
    if !doc.nodes[i].is_group() {
        return Err(Error::Invalid(format!("node {id} is not a group")));
    }
    let group = doc.nodes.remove(i);
    let mut children = Vec::new();
    for c in doc.nodes.iter_mut().filter(|c| c.parent.as_deref() == Some(id)) {
        c.parent = None;
        children.push(c.id.clone());
    }
    if children.is_empty() {
        return Ok(vec![Op::AddNode {
            node: group,
            index: Some(i),
        }]);
    }
    let bounds = Op::ResizeNode {
        id: group.id.clone(),
        x: group.x,
        y: group.y,
        width: group.width,
        height: group.height,
    };
    Ok(vec![
        Op::Group {
            group,
            children,
            index: Some(i),
        },
        bounds,
    ])
}

/// Layers whose content `op` would change, including cascades.
fn touched_layers(doc: &Document, op: &Op) -> Vec<String> {
    let node_layer = |id: &str| doc.node(id).map(|n| n.layer.clone());
    let edge_layer = |id: &str| doc.edge(id).map(|e| e.layer.clone());
    match op {
        Op::AddNode { node, .. } => vec![node.layer.clone()],
        Op::RemoveNode { id } => node_layer(id)
            .into_iter()
            .chain(
                doc.edges
                    .iter()
                    .filter(|e| e.source == *id || e.target == *id)
                    .map(|e| e.layer.clone()),
            )
            .collect(),
        Op::AddEdge { edge, .. } => vec![edge.layer.clone()],
        Op::RemoveEdge { id } | Op::SetEdgeLabel { id, .. } | Op::SetEdgeStyle { id, .. } => {
            edge_layer(id).into_iter().collect()
        }
        Op::MoveNode { id, .. }
        | Op::ResizeNode { id, .. }
        | Op::SetNodeLabel { id, .. }
        | Op::SetNodeText { id, .. }
        | Op::SetNodeResources { id, .. }
        | Op::SetNodeImage { id, .. }
        | Op::SetNodeStyle { id, .. }
        | Op::Ungroup { id } => node_layer(id).into_iter().collect(),
        Op::Group { group, children, .. } => std::iter::once(group.layer.clone())
            .chain(children.iter().filter_map(|c| node_layer(c)))
            .collect(),
        Op::SetLayer { id, layer } => node_layer(id)
            .or_else(|| edge_layer(id))
            .into_iter()
            .chain([layer.clone()])
            .collect(),
        Op::RemoveLayer { id, into } => std::iter::once(id.clone()).chain(into.clone()).collect(),
        Op::AddLayer { .. } | Op::UpdateLayer { .. } | Op::MoveLayer { .. } => Vec::new(),
    }
}

fn layer_index(doc: &Document, id: &str) -> Result<usize> {
    doc.layers
        .iter()
        .position(|l| l.id == id)
        .ok_or_else(|| Error::Invalid(format!("layer {id} does not exist")))
}

/// The op that brings back a node's previous text, formatted or plain.
fn restore_text(id: String, label: String, text: Option<RichNode>) -> Op {
    match text {
        Some(text) => Op::SetNodeText { id, text },
        None => Op::SetNodeLabel { id, label },
    }
}

fn apply_op(doc: &mut Document, op: Op) -> Result<Vec<Op>> {
    for layer in touched_layers(doc, &op) {
        doc.ensure_unlocked(&layer)?;
    }
    Ok(match op {
        Op::AddNode { mut node, index } => {
            node.check()?;
            if let Some(t) = &node.text {
                node.label = t.plain_text();
            }
            ensure_unused(doc, &node.id)?;
            doc.check_layer_ref(&node.id, &node.layer)?;
            doc.check_image_ref(&node)?;
            doc.check_parent(&node)?;
            let (id, parent) = (node.id.clone(), node.parent.clone());
            let i = index.unwrap_or(doc.nodes.len()).min(doc.nodes.len());
            doc.nodes.insert(i, node);
            let mut inverse = vec![Op::RemoveNode { id }];
            inverse.extend(refit(doc, parent.as_deref())?);
            inverse
        }
        Op::RemoveNode { id } => {
            let i = node_index(doc, &id)?;
            if doc.nodes[i].is_group() {
                // Deleting a group keeps its contents (same as Ungroup).
                return ungroup(doc, &id);
            }
            let node = doc.nodes.remove(i);
            let parent = node.parent.clone();
            let mut inverse = vec![Op::AddNode { node, index: Some(i) }];
            // Re-adding in ascending index order restores the original edge order.
            let mut k = 0;
            let mut original = 0;
            while k < doc.edges.len() {
                if doc.edges[k].source == id || doc.edges[k].target == id {
                    inverse.push(Op::AddEdge {
                        edge: doc.edges.remove(k),
                        index: Some(original),
                    });
                } else {
                    k += 1;
                }
                original += 1;
            }
            inverse.extend(refit(doc, parent.as_deref())?);
            inverse
        }
        Op::AddEdge { edge, index } => {
            doc.check_edge(&edge)?;
            ensure_unused(doc, &edge.id)?;
            let id = edge.id.clone();
            let i = index.unwrap_or(doc.edges.len()).min(doc.edges.len());
            doc.edges.insert(i, edge);
            vec![Op::RemoveEdge { id }]
        }
        Op::RemoveEdge { id } => {
            let i = doc
                .edges
                .iter()
                .position(|e| e.id == id)
                .ok_or_else(|| Error::Invalid(format!("connection {id} does not exist")))?;
            vec![Op::AddEdge {
                edge: doc.edges.remove(i),
                index: Some(i),
            }]
        }
        Op::MoveNode { id, x, y } => {
            check_position(&id, x, y)?;
            let n = node_mut(doc, &id)?;
            let (dx, dy) = (x - n.x, y - n.y);
            let mut inverse = vec![Op::MoveNode {
                id: id.clone(),
                x: n.x,
                y: n.y,
            }];
            (n.x, n.y) = (x, y);
            let (is_group, parent) = (n.is_group(), n.parent.clone());
            if is_group {
                // Members move with their group, so the fit is unchanged.
                for c in doc
                    .nodes
                    .iter_mut()
                    .filter(|c| c.parent.as_deref() == Some(id.as_str()))
                {
                    (c.x, c.y) = (c.x + dx, c.y + dy);
                    check_position(&c.id, c.x, c.y)?;
                }
            } else {
                inverse.extend(refit(doc, parent.as_deref())?);
            }
            inverse
        }
        Op::ResizeNode {
            id,
            x,
            y,
            width,
            height,
        } => {
            check_position(&id, x, y)?;
            check_size(&id, width, height)?;
            let n = node_mut(doc, &id)?;
            let mut inverse = vec![Op::ResizeNode {
                id,
                x: n.x,
                y: n.y,
                width: n.width,
                height: n.height,
            }];
            (n.x, n.y, n.width, n.height) = (x, y, width, height);
            let parent = n.parent.clone();
            inverse.extend(refit(doc, parent.as_deref())?);
            inverse
        }
        Op::SetNodeLabel { id, label } => {
            check_label(&label)?;
            let n = node_mut(doc, &id)?;
            let old_label = std::mem::replace(&mut n.label, label);
            vec![restore_text(id, old_label, n.text.take())]
        }
        Op::SetNodeResources { id, resources } => {
            check_resources(&resources)?;
            let n = node_mut(doc, &id)?;
            vec![Op::SetNodeResources {
                id,
                resources: std::mem::replace(&mut n.resources, resources),
            }]
        }
        Op::SetNodeImage { id, image } => {
            if let Some(a) = &image
                && !doc.assets.contains_key(a)
            {
                return Err(Error::Invalid(format!("image {a} has not been added")));
            }
            let n = node_mut(doc, &id)?;
            if n.is_group() && image.is_some() {
                return Err(Error::Invalid("groups cannot hold an image".into()));
            }
            vec![Op::SetNodeImage {
                id,
                image: std::mem::replace(&mut n.image, image),
            }]
        }
        Op::SetNodeText { id, text } => {
            text.check_doc()?;
            let label = text.plain_text();
            check_label(&label)?;
            let n = node_mut(doc, &id)?;
            if n.is_group() {
                return Err(Error::Invalid("groups cannot hold formatted text".into()));
            }
            let old_label = std::mem::replace(&mut n.label, label);
            let old_text = n.text.replace(text);
            vec![restore_text(id, old_label, old_text)]
        }
        Op::SetNodeStyle { id, style } => {
            style.check()?;
            let n = node_mut(doc, &id)?;
            vec![Op::SetNodeStyle {
                id,
                style: std::mem::replace(&mut n.style, style),
            }]
        }
        Op::SetEdgeLabel { id, label } => {
            check_label(&label)?;
            let e = edge_mut(doc, &id)?;
            vec![Op::SetEdgeLabel {
                id,
                label: std::mem::replace(&mut e.label, label),
            }]
        }
        Op::SetEdgeStyle { id, style } => {
            style.check()?;
            let e = edge_mut(doc, &id)?;
            vec![Op::SetEdgeStyle {
                id,
                style: std::mem::replace(&mut e.style, style),
            }]
        }
        Op::Group { group, children, index } => {
            if !group.is_group() || group.parent.is_some() {
                return Err(Error::Invalid(format!("{} is not a top-level group", group.id)));
            }
            group.check()?;
            ensure_unused(doc, &group.id)?;
            doc.check_layer_ref(&group.id, &group.layer)?;
            if children.is_empty() {
                return Err(Error::Invalid("a group needs at least one member".into()));
            }
            for (k, cid) in children.iter().enumerate() {
                let c = doc
                    .node(cid)
                    .ok_or_else(|| Error::Invalid(format!("node {cid} does not exist")))?;
                if c.is_group() {
                    return Err(Error::Invalid(
                        "groups cannot contain other groups (nesting is not supported)".into(),
                    ));
                }
                if c.parent.is_some() {
                    return Err(Error::Invalid(format!(
                        "node {cid} is already in a group; ungroup it first"
                    )));
                }
                if children[..k].contains(cid) {
                    return Err(Error::Invalid(format!("node {cid} is listed twice")));
                }
                if c.layer != group.layer {
                    return Err(Error::Invalid(format!(
                        "node {cid} must be on the group's layer before grouping"
                    )));
                }
            }
            let id = group.id.clone();
            let i = index.unwrap_or(doc.nodes.len()).min(doc.nodes.len());
            doc.nodes.insert(i, group);
            for c in doc.nodes.iter_mut().filter(|c| children.contains(&c.id)) {
                c.parent = Some(id.clone());
            }
            refit(doc, Some(&id))?;
            vec![Op::Ungroup { id }]
        }
        Op::Ungroup { id } => ungroup(doc, &id)?,
        Op::AddLayer { layer, index } => {
            layer.check()?;
            if doc.layer(&layer.id).is_some() {
                return Err(Error::Invalid(format!("layer {} already exists", layer.id)));
            }
            let id = layer.id.clone();
            let i = index.unwrap_or(doc.layers.len()).min(doc.layers.len());
            doc.layers.insert(i, layer);
            vec![Op::RemoveLayer { id, into: None }]
        }
        Op::RemoveLayer { id, into } => {
            let i = layer_index(doc, &id)?;
            if doc.layers.len() == 1 {
                return Err(Error::Invalid("a document needs at least one layer".into()));
            }
            let occupied = doc.nodes.iter().any(|n| n.layer == id) || doc.edges.iter().any(|e| e.layer == id);
            let mut restore = Vec::new();
            if occupied {
                let target =
                    into.ok_or_else(|| Error::Invalid("this layer has content; choose a layer to move it to".into()))?;
                if target == id {
                    return Err(Error::Invalid("cannot move a layer's content into itself".into()));
                }
                layer_index(doc, &target)?;
                for n in doc.nodes.iter_mut().filter(|n| n.layer == id) {
                    // Members follow their group when the reassignment is undone.
                    if n.parent.is_none() {
                        restore.push(Op::SetLayer {
                            id: n.id.clone(),
                            layer: id.clone(),
                        });
                    }
                    n.layer = target.clone();
                }
                for e in doc.edges.iter_mut().filter(|e| e.layer == id) {
                    restore.push(Op::SetLayer {
                        id: e.id.clone(),
                        layer: id.clone(),
                    });
                    e.layer = target.clone();
                }
            }
            let layer = doc.layers.remove(i);
            let mut inverse = vec![Op::AddLayer { layer, index: Some(i) }];
            inverse.extend(restore);
            inverse
        }
        Op::UpdateLayer {
            id,
            name,
            visible,
            locked,
        } => {
            let i = layer_index(doc, &id)?;
            let updated = Layer {
                name,
                visible,
                locked,
                ..doc.layers[i].clone()
            };
            updated.check()?;
            let old = std::mem::replace(&mut doc.layers[i], updated);
            vec![Op::UpdateLayer {
                id,
                name: old.name,
                visible: old.visible,
                locked: old.locked,
            }]
        }
        Op::MoveLayer { id, index } => {
            let i = layer_index(doc, &id)?;
            let layer = doc.layers.remove(i);
            doc.layers.insert(index.min(doc.layers.len()), layer);
            vec![Op::MoveLayer { id, index: i }]
        }
        Op::SetLayer { id, layer } => {
            doc.check_layer_ref(&id, &layer)?;
            if let Some(n) = doc.nodes.iter_mut().find(|n| n.id == id) {
                if n.parent.is_some() {
                    return Err(Error::Invalid(
                        "a grouped node shares its group's layer; move the group instead".into(),
                    ));
                }
                let old = std::mem::replace(&mut n.layer, layer.clone());
                for c in doc
                    .nodes
                    .iter_mut()
                    .filter(|c| c.parent.as_deref() == Some(id.as_str()))
                {
                    c.layer = layer.clone();
                }
                vec![Op::SetLayer { id, layer: old }]
            } else {
                let e = edge_mut(doc, &id)?;
                let old = std::mem::replace(&mut e.layer, layer);
                vec![Op::SetLayer { id, layer: old }]
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{GROUP_PAD, GROUP_PAD_TOP, Layer, Shape};

    fn tx(s: &Session, ops: Vec<Op>) -> Transaction {
        Transaction {
            base_revision: s.revision(),
            label: "test".into(),
            ops,
        }
    }

    fn add(s: &mut Session, ops: Vec<Op>) {
        let t = tx(s, ops);
        s.apply(t).unwrap();
    }

    fn three_nodes() -> Session {
        let mut s = Session::default();
        add(
            &mut s,
            vec![
                Op::AddNode {
                    node: Node::new("a", "Research Question", 0.0, 0.0),
                    index: None,
                },
                Op::AddNode {
                    node: Node::new("b", "Evidence", 300.0, 0.0),
                    index: None,
                },
                Op::AddNode {
                    node: Node::new("c", "Conclusion", 600.0, 0.0),
                    index: None,
                },
                Op::AddEdge {
                    edge: Edge::new("ab", "a", "b"),
                    index: None,
                },
                Op::AddEdge {
                    edge: Edge::new("bc", "b", "c"),
                    index: None,
                },
            ],
        );
        s
    }

    #[test]
    fn new_session_is_clean_and_valid() {
        let s = Session::default();
        assert!(!s.dirty());
        assert!(s.document().validate().is_ok());
        assert_eq!(s.undo_label(), None);
    }

    #[test]
    fn create_node_undo_redo() {
        let mut s = Session::default();
        add(
            &mut s,
            vec![Op::AddNode {
                node: Node::new("n1", "Idea", 10.0, 20.0),
                index: None,
            }],
        );
        assert!(s.dirty());
        assert_eq!(s.document().nodes.len(), 1);
        assert!(s.undo().unwrap());
        assert!(s.document().nodes.is_empty());
        assert!(!s.dirty(), "undo back to the saved state is clean");
        assert!(s.redo().unwrap());
        assert_eq!(s.document().node("n1").unwrap().label, "Idea");
    }

    #[test]
    fn duplicate_ids_are_rejected_across_nodes_and_edges() {
        let mut s = three_nodes();
        let t = tx(
            &s,
            vec![Op::AddNode {
                node: Node::new("ab", "x", 0.0, 0.0),
                index: None,
            }],
        );
        assert!(matches!(s.apply(t), Err(Error::Invalid(_))));
        let t = tx(
            &s,
            vec![Op::AddEdge {
                edge: Edge::new("a", "b", "c"),
                index: None,
            }],
        );
        assert!(s.apply(t).is_err());
    }

    #[test]
    fn edges_require_existing_distinct_endpoints() {
        let mut s = three_nodes();
        for e in [Edge::new("x", "a", "missing"), Edge::new("y", "a", "a")] {
            let t = tx(&s, vec![Op::AddEdge { edge: e, index: None }]);
            assert!(s.apply(t).is_err());
        }
        assert_eq!(s.document().edges.len(), 2);
    }

    #[test]
    fn removing_node_removes_its_edges_and_undo_restores_order() {
        let mut s = three_nodes();
        let original = s.document().clone();
        add(&mut s, vec![Op::RemoveNode { id: "b".into() }]);
        assert!(s.document().edges.is_empty());
        assert!(s.document().validate().is_ok());
        s.undo().unwrap();
        assert_eq!(s.document(), &original);
    }

    #[test]
    fn failed_transaction_is_atomic_and_adds_no_history() {
        let mut s = three_nodes();
        let before = s.document().clone();
        let rev = s.revision();
        let t = tx(
            &s,
            vec![
                Op::MoveNode {
                    id: "a".into(),
                    x: 50.0,
                    y: 50.0,
                },
                Op::MoveNode {
                    id: "nope".into(),
                    x: 0.0,
                    y: 0.0,
                },
            ],
        );
        assert!(s.apply(t).is_err());
        assert_eq!(s.document(), &before);
        assert_eq!(s.revision(), rev);
        s.undo().unwrap(); // only the setup transaction is in history
        assert!(s.document().nodes.is_empty());
    }

    #[test]
    fn multi_node_move_is_one_undo_step() {
        let mut s = three_nodes();
        add(
            &mut s,
            vec![
                Op::MoveNode {
                    id: "a".into(),
                    x: 10.0,
                    y: 100.0,
                },
                Op::MoveNode {
                    id: "b".into(),
                    x: 310.0,
                    y: 100.0,
                },
            ],
        );
        s.undo().unwrap();
        let d = s.document();
        assert_eq!((d.node("a").unwrap().y, d.node("b").unwrap().y), (0.0, 0.0));
        s.redo().unwrap();
        let d = s.document();
        assert_eq!((d.node("a").unwrap().x, d.node("b").unwrap().x), (10.0, 310.0));
        assert_eq!(
            d.node("a").unwrap().label,
            "Research Question",
            "move must not alter labels"
        );
        assert_eq!(d.edges.len(), 2, "move must not alter edges");
    }

    #[test]
    fn label_style_and_resize_round_trip_through_undo() {
        let mut s = three_nodes();
        let original = s.document().clone();
        add(
            &mut s,
            vec![
                Op::SetNodeLabel {
                    id: "a".into(),
                    label: "Line 1\nLine 2".into(),
                },
                Op::SetEdgeLabel {
                    id: "ab".into(),
                    label: "supports".into(),
                },
                Op::SetNodeStyle {
                    id: "a".into(),
                    style: NodeStyle {
                        shape: Shape::Ellipse,
                        fill: Some("#ffeeaa".into()),
                        stroke: None,
                    },
                },
                Op::SetEdgeStyle {
                    id: "ab".into(),
                    style: EdgeStyle {
                        color: Some("#336699".into()),
                        ..Default::default()
                    },
                },
                Op::ResizeNode {
                    id: "a".into(),
                    x: -5.0,
                    y: -5.0,
                    width: 200.0,
                    height: 90.0,
                },
            ],
        );
        assert_eq!(s.document().node("a").unwrap().label, "Line 1\nLine 2");
        s.undo().unwrap();
        assert_eq!(s.document(), &original);
    }

    #[test]
    fn invalid_values_are_rejected() {
        let mut s = three_nodes();
        let bad = [
            Op::MoveNode {
                id: "a".into(),
                x: f64::NAN,
                y: 0.0,
            },
            Op::ResizeNode {
                id: "a".into(),
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 10.0,
            },
            Op::SetNodeStyle {
                id: "a".into(),
                style: NodeStyle {
                    fill: Some("red\"/><script>".into()),
                    ..Default::default()
                },
            },
        ];
        for op in bad {
            let t = tx(&s, vec![op]);
            assert!(s.apply(t).is_err());
        }
    }

    #[test]
    fn stale_transactions_are_rejected() {
        let mut s = three_nodes();
        let stale = tx(
            &s,
            vec![Op::MoveNode {
                id: "a".into(),
                x: 1.0,
                y: 1.0,
            }],
        );
        add(
            &mut s,
            vec![Op::MoveNode {
                id: "b".into(),
                x: 2.0,
                y: 2.0,
            }],
        );
        assert!(matches!(s.apply(stale), Err(Error::Stale)));
        assert_eq!(s.document().node("a").unwrap().x, 0.0);
    }

    #[test]
    fn noop_transaction_adds_no_history() {
        let mut s = three_nodes();
        let rev = s.revision();
        add(
            &mut s,
            vec![Op::MoveNode {
                id: "a".into(),
                x: 0.0,
                y: 0.0,
            }],
        );
        assert_eq!(s.revision(), rev);
        assert_eq!(s.undo_label(), Some("test"));
        s.undo().unwrap();
        assert!(s.document().nodes.is_empty());
    }

    #[test]
    fn new_edit_clears_redo_and_dirty_tracks_saved_state() {
        let mut s = three_nodes();
        s.mark_saved();
        add(
            &mut s,
            vec![Op::MoveNode {
                id: "a".into(),
                x: 5.0,
                y: 5.0,
            }],
        );
        assert!(s.dirty());
        s.undo().unwrap();
        assert!(!s.dirty());
        add(
            &mut s,
            vec![Op::MoveNode {
                id: "b".into(),
                x: 5.0,
                y: 5.0,
            }],
        );
        assert_eq!(s.redo_label(), None);
        assert!(!s.redo().unwrap());
        assert!(s.dirty());
    }

    #[test]
    fn ops_deserialize_from_frontend_json() {
        let json = r##"{"baseRevision":0,"label":"Add","ops":[
            {"op":"addNode","node":{"id":"n","label":"","x":1,"y":2,"width":160,"height":56,"layer":"layer-1","style":{"shape":"diamond","fill":"#fff"}}},
            {"op":"resizeNode","id":"n","x":0,"y":0,"width":100,"height":50}]}"##;
        let t: Transaction = serde_json::from_str(json).unwrap();
        let mut s = Session::default();
        s.apply(t).unwrap();
        assert_eq!(s.document().node("n").unwrap().style.shape, Shape::Diamond);
    }

    fn grouped() -> Session {
        let mut s = three_nodes();
        add(
            &mut s,
            vec![Op::Group {
                group: Node::group("g", "Group"),
                children: vec!["a".into(), "b".into()],
                index: None,
            }],
        );
        s
    }

    fn pos(d: &Document, id: &str) -> (f64, f64) {
        let n = d.node(id).unwrap();
        (n.x, n.y)
    }

    #[test]
    fn grouping_fits_bounds_without_moving_members() {
        let before = three_nodes().document().clone();
        let s = grouped();
        let d = s.document();
        let g = d.node("g").unwrap();
        assert_eq!(
            (g.x, g.y, g.width, g.height),
            (
                -GROUP_PAD,
                -GROUP_PAD_TOP,
                460.0 + 2.0 * GROUP_PAD,
                56.0 + GROUP_PAD + GROUP_PAD_TOP
            )
        );
        for id in ["a", "b", "c"] {
            assert_eq!(pos(d, id), pos(&before, id));
        }
        assert_eq!(d.node("a").unwrap().parent.as_deref(), Some("g"));
        assert_eq!(d.node("c").unwrap().parent, None);
        assert!(d.validate().is_ok());
        let mut s = s;
        s.undo().unwrap();
        assert_eq!(s.document(), &before, "grouping is one undo step");
        s.redo().unwrap();
        assert!(s.document().node("g").is_some());
    }

    #[test]
    fn moving_a_group_moves_members_and_is_one_undo_step() {
        let mut s = grouped();
        let before = s.document().clone();
        add(
            &mut s,
            vec![Op::MoveNode {
                id: "g".into(),
                x: 80.0,
                y: 64.0,
            }],
        );
        let d = s.document();
        assert_eq!(pos(d, "a"), (100.0, 100.0));
        assert_eq!(pos(d, "b"), (400.0, 100.0));
        assert_eq!(pos(d, "c"), (600.0, 0.0), "outside node unaffected");
        assert_eq!(d.edges, before.edges);
        s.undo().unwrap();
        assert_eq!(s.document(), &before);
    }

    #[test]
    fn moving_a_member_refits_the_group_and_undo_is_exact() {
        let mut s = grouped();
        // Stored bounds that are not fitted, as a hand-edited file might have.
        add(
            &mut s,
            vec![Op::ResizeNode {
                id: "g".into(),
                x: -100.0,
                y: -100.0,
                width: 900.0,
                height: 400.0,
            }],
        );
        let before = s.document().clone();
        add(
            &mut s,
            vec![Op::MoveNode {
                id: "b".into(),
                x: 300.0,
                y: 200.0,
            }],
        );
        let g = s.document().node("g").unwrap().clone();
        assert_eq!(
            (g.x, g.y, g.height),
            (-GROUP_PAD, -GROUP_PAD_TOP, 256.0 + GROUP_PAD + GROUP_PAD_TOP)
        );
        s.undo().unwrap();
        assert_eq!(s.document(), &before);
        s.redo().unwrap();
        assert_eq!(s.document().node("g").unwrap(), &g);
    }

    #[test]
    fn ungroup_and_deleting_a_group_keep_members_in_place() {
        for op in [Op::Ungroup { id: "g".into() }, Op::RemoveNode { id: "g".into() }] {
            let mut s = grouped();
            let before = s.document().clone();
            add(&mut s, vec![op]);
            let d = s.document();
            assert!(d.node("g").is_none());
            assert_eq!(d.nodes.len(), 3);
            assert!(d.nodes.iter().all(|n| n.parent.is_none()));
            assert_eq!(pos(d, "a"), (0.0, 0.0));
            assert_eq!(d.edges.len(), 2);
            s.undo().unwrap();
            assert_eq!(s.document(), &before);
            s.redo().unwrap();
            assert!(s.document().node("g").is_none());
        }
    }

    #[test]
    fn removing_and_adding_members_refits() {
        let mut s = grouped();
        let before = s.document().clone();
        add(&mut s, vec![Op::RemoveNode { id: "b".into() }]);
        assert_eq!(s.document().node("g").unwrap().width, 160.0 + 2.0 * GROUP_PAD);
        s.undo().unwrap();
        assert_eq!(s.document(), &before);
        let child = Node {
            parent: Some("g".into()),
            ..Node::new("d", "D", 0.0, 300.0)
        };
        add(
            &mut s,
            vec![Op::AddNode {
                node: child,
                index: None,
            }],
        );
        assert_eq!(
            s.document().node("g").unwrap().height,
            356.0 + GROUP_PAD + GROUP_PAD_TOP
        );
    }

    #[test]
    fn nesting_regrouping_and_links_to_groups_are_rejected() {
        let mut s = grouped();
        let before = s.document().clone();
        let cases = [
            Op::Group {
                group: Node::group("g2", ""),
                children: vec!["g".into(), "c".into()],
                index: None,
            },
            Op::Group {
                group: Node::group("g3", ""),
                children: vec!["a".into(), "c".into()],
                index: None,
            },
            Op::Group {
                group: Node::group("g4", ""),
                children: vec![],
                index: None,
            },
            Op::Group {
                group: Node::group("g5", ""),
                children: vec!["c".into(), "c".into()],
                index: None,
            },
            Op::Group {
                group: Node::new("g6", "", 0.0, 0.0),
                children: vec!["c".into()],
                index: None,
            },
            Op::AddEdge {
                edge: Edge::new("eg", "g", "c"),
                index: None,
            },
            Op::AddNode {
                node: Node {
                    parent: Some("c".into()),
                    ..Node::new("x", "", 0.0, 0.0)
                },
                index: None,
            },
            Op::AddNode {
                node: Node {
                    parent: Some("g".into()),
                    ..Node::group("g7", "")
                },
                index: None,
            },
            Op::Ungroup { id: "a".into() },
        ];
        for op in cases {
            let t = tx(&s, vec![op.clone()]);
            assert!(s.apply(t).is_err(), "{op:?} should be rejected");
        }
        assert_eq!(s.document(), &before);
    }

    fn add_top_layer(s: &mut Session) {
        add(
            s,
            vec![Op::AddLayer {
                layer: Layer::new("top", "Top"),
                index: None,
            }],
        );
    }

    fn set_lock(s: &mut Session, id: &str, locked: bool) {
        let l = s.document().layer(id).unwrap().clone();
        add(
            s,
            vec![Op::UpdateLayer {
                id: l.id,
                name: l.name,
                visible: l.visible,
                locked,
            }],
        );
    }

    #[test]
    fn layers_add_rename_hide_lock_reorder_with_exact_undo() {
        let mut s = three_nodes();
        let before = s.document().clone();
        add_top_layer(&mut s);
        add(
            &mut s,
            vec![Op::UpdateLayer {
                id: "top".into(),
                name: "Notes".into(),
                visible: false,
                locked: true,
            }],
        );
        add(
            &mut s,
            vec![Op::MoveLayer {
                id: "top".into(),
                index: 0,
            }],
        );
        let d = s.document();
        assert_eq!(
            d.layers.iter().map(|l| l.name.as_str()).collect::<Vec<_>>(),
            ["Notes", "Layer 1"]
        );
        assert!(!d.layers[0].visible && d.layers[0].locked);
        for _ in 0..3 {
            s.undo().unwrap();
        }
        assert_eq!(s.document(), &before);
        for bad in [
            Op::UpdateLayer {
                id: "layer-1".into(),
                name: " ".into(),
                visible: true,
                locked: false,
            },
            Op::AddLayer {
                layer: Layer::new("layer-1", "Again"),
                index: None,
            },
            Op::RemoveLayer {
                id: "layer-1".into(),
                into: None,
            },
            Op::MoveLayer {
                id: "nope".into(),
                index: 0,
            },
        ] {
            let t = tx(&s, vec![bad.clone()]);
            assert!(s.apply(t).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn locked_layers_reject_every_kind_of_edit() {
        let mut s = three_nodes();
        add_top_layer(&mut s);
        add(
            &mut s,
            vec![Op::SetLayer {
                id: "c".into(),
                layer: "top".into(),
            }],
        );
        set_lock(&mut s, "layer-1", true);
        let before = s.document().clone();
        let rejected = [
            Op::MoveNode {
                id: "a".into(),
                x: 9.0,
                y: 9.0,
            },
            Op::ResizeNode {
                id: "a".into(),
                x: 0.0,
                y: 0.0,
                width: 99.0,
                height: 99.0,
            },
            Op::SetNodeLabel {
                id: "a".into(),
                label: "x".into(),
            },
            Op::SetNodeStyle {
                id: "a".into(),
                style: NodeStyle::default(),
            },
            Op::RemoveNode { id: "a".into() },
            // c is unlocked, but deleting it would delete link bc on the locked layer.
            Op::RemoveNode { id: "c".into() },
            Op::RemoveEdge { id: "ab".into() },
            Op::SetEdgeLabel {
                id: "ab".into(),
                label: "x".into(),
            },
            Op::SetEdgeStyle {
                id: "ab".into(),
                style: EdgeStyle::default(),
            },
            Op::AddNode {
                node: Node::new("n", "", 0.0, 0.0),
                index: None,
            },
            Op::AddEdge {
                edge: Edge::new("x", "a", "c"),
                index: None,
            },
            Op::SetLayer {
                id: "a".into(),
                layer: "top".into(),
            },
            Op::SetLayer {
                id: "c".into(),
                layer: "layer-1".into(),
            },
            Op::Group {
                group: Node::group("g", ""),
                children: vec!["a".into(), "b".into()],
                index: None,
            },
            Op::RemoveLayer {
                id: "layer-1".into(),
                into: Some("top".into()),
            },
        ];
        for op in rejected {
            let t = tx(&s, vec![op.clone()]);
            let err = s.apply(t).unwrap_err().to_string();
            assert!(err.contains("locked"), "{op:?}: {err}");
        }
        assert_eq!(s.document(), &before);
        // Unlocked content stays editable, and links may point at locked nodes.
        let link = Edge {
            layer: "top".into(),
            ..Edge::new("x", "c", "a")
        };
        add(
            &mut s,
            vec![
                Op::MoveNode {
                    id: "c".into(),
                    x: 5.0,
                    y: 5.0,
                },
                Op::AddEdge {
                    edge: link,
                    index: None,
                },
            ],
        );
        set_lock(&mut s, "layer-1", false);
        add(
            &mut s,
            vec![Op::MoveNode {
                id: "a".into(),
                x: 1.0,
                y: 1.0,
            }],
        );
    }

    #[test]
    fn deleting_a_layer_moves_its_content_and_undo_restores() {
        let mut s = three_nodes();
        add_top_layer(&mut s);
        add(
            &mut s,
            vec![
                Op::SetLayer {
                    id: "c".into(),
                    layer: "top".into(),
                },
                Op::SetLayer {
                    id: "bc".into(),
                    layer: "top".into(),
                },
            ],
        );
        let before = s.document().clone();
        let t = tx(
            &s,
            vec![Op::RemoveLayer {
                id: "top".into(),
                into: None,
            }],
        );
        assert!(s.apply(t).unwrap_err().to_string().contains("choose a layer"));
        add(
            &mut s,
            vec![Op::RemoveLayer {
                id: "top".into(),
                into: Some("layer-1".into()),
            }],
        );
        let d = s.document();
        assert_eq!(d.layers.len(), 1);
        assert!(d.nodes.iter().all(|n| n.layer == "layer-1") && d.edges.iter().all(|e| e.layer == "layer-1"));
        s.undo().unwrap();
        assert_eq!(s.document(), &before);
    }

    #[test]
    fn groups_keep_members_on_their_layer() {
        let mut s = grouped();
        add_top_layer(&mut s);
        let t = tx(
            &s,
            vec![Op::SetLayer {
                id: "a".into(),
                layer: "top".into(),
            }],
        );
        assert!(s.apply(t).unwrap_err().to_string().contains("move the group"));
        let before = s.document().clone();
        add(
            &mut s,
            vec![Op::SetLayer {
                id: "g".into(),
                layer: "top".into(),
            }],
        );
        assert!(
            ["g", "a", "b"]
                .iter()
                .all(|id| s.document().node(id).unwrap().layer == "top")
        );
        s.undo().unwrap();
        assert_eq!(s.document(), &before);
        add(
            &mut s,
            vec![
                Op::Ungroup { id: "g".into() },
                Op::SetLayer {
                    id: "c".into(),
                    layer: "top".into(),
                },
            ],
        );
        let mixed = Op::Group {
            group: Node::group("g2", ""),
            children: vec!["a".into(), "c".into()],
            index: None,
        };
        let t = tx(&s, vec![mixed]);
        assert!(s.apply(t).unwrap_err().to_string().contains("layer"));
        // Moving members onto the group's layer first, in the same transaction, works.
        add(
            &mut s,
            vec![
                Op::SetLayer {
                    id: "c".into(),
                    layer: "layer-1".into(),
                },
                Op::Group {
                    group: Node::group("g2", ""),
                    children: vec!["a".into(), "c".into()],
                    index: None,
                },
            ],
        );
        // Deleting the layer of a group carries the whole group.
        add(
            &mut s,
            vec![Op::SetLayer {
                id: "g2".into(),
                layer: "top".into(),
            }],
        );
        add(
            &mut s,
            vec![Op::RemoveLayer {
                id: "top".into(),
                into: Some("layer-1".into()),
            }],
        );
        assert!(s.document().validate().is_ok());
        s.undo().unwrap();
        assert!(
            ["g2", "a", "c"]
                .iter()
                .all(|id| s.document().node(id).unwrap().layer == "top")
        );
        assert!(s.document().validate().is_ok());
    }

    fn rich(json: &str) -> crate::rich::RichNode {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn formatted_and_plain_text_edits_undo_into_each_other() {
        let mut s = three_nodes();
        let before = s.document().clone();
        let text = rich(
            r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Bold claim","marks":[{"type":"bold"}]}]},
            {"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"point"}]}]}]}]}"#,
        );
        add(
            &mut s,
            vec![Op::SetNodeText {
                id: "a".into(),
                text: text.clone(),
            }],
        );
        let a = s.document().node("a").unwrap();
        assert_eq!(
            (a.label.as_str(), a.text.as_ref()),
            ("Bold claim\n• point", Some(&text))
        );
        add(
            &mut s,
            vec![Op::SetNodeLabel {
                id: "a".into(),
                label: "plain again".into(),
            }],
        );
        assert_eq!(
            s.document().node("a").unwrap().text,
            None,
            "plain edit drops formatting"
        );
        s.undo().unwrap();
        assert_eq!(s.document().node("a").unwrap().text.as_ref(), Some(&text));
        s.undo().unwrap();
        assert_eq!(s.document(), &before);
        s.redo().unwrap();
        assert_eq!(s.document().node("a").unwrap().label, "Bold claim\n• point");
        let unsafe_link = rich(
            r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]}]}]}"#,
        );
        let t = tx(
            &s,
            vec![Op::SetNodeText {
                id: "a".into(),
                text: unsafe_link,
            }],
        );
        assert!(s.apply(t).is_err());
    }

    #[test]
    fn attachments_and_images_undo_and_unused_images_are_not_saved() {
        use crate::assets::{Resource, ResourceKind, tests::PNG};
        let mut s = three_nodes();
        let before = s.document().clone();
        let links = vec![
            Resource {
                kind: ResourceKind::Url,
                target: "https://example.org/paper".into(),
                title: "Paper".into(),
            },
            Resource {
                kind: ResourceKind::File,
                target: r"C:\data\notes.txt".into(),
                title: String::new(),
            },
        ];
        add(
            &mut s,
            vec![Op::SetNodeResources {
                id: "a".into(),
                resources: links.clone(),
            }],
        );
        assert_eq!(s.document().node("a").unwrap().resources, links);
        // Adding image bytes is not an edit; showing it on a node is.
        let (rev, undo) = (s.revision(), s.undo_label().map(str::to_owned));
        let img = s.add_image(PNG).unwrap();
        assert_eq!(s.add_image(PNG).unwrap(), img, "same bytes, same id");
        assert_eq!((s.revision(), s.undo_label().map(str::to_owned)), (rev, undo));
        add(
            &mut s,
            vec![Op::SetNodeImage {
                id: "b".into(),
                image: Some(img.clone()),
            }],
        );
        assert_eq!(s.document().node("b").unwrap().image.as_deref(), Some(img.as_str()));
        s.document().validate().unwrap();
        // Unknown image ids, images on groups and unsafe links are refused.
        for bad in [
            Op::SetNodeImage {
                id: "c".into(),
                image: Some("f".repeat(64)),
            },
            Op::SetNodeResources {
                id: "c".into(),
                resources: vec![Resource {
                    kind: ResourceKind::Url,
                    target: "javascript:x".into(),
                    title: String::new(),
                }],
            },
        ] {
            let t = tx(&s, vec![bad]);
            assert!(s.apply(t).is_err());
        }
        s.undo().unwrap();
        s.undo().unwrap();
        let mut stripped = s.document().clone();
        stripped.assets.clear();
        assert_eq!(stripped, before, "undo restores everything but the unused image");
        // Saving drops images no node shows; redo after reopening is not possible anyway.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("m.vuecraft");
        crate::io::save(&path, s.document()).unwrap();
        assert!(crate::io::read(&path).unwrap().assets.is_empty());
        s.redo().unwrap();
        s.redo().unwrap();
        crate::io::save(&path, s.document()).unwrap();
        let back = crate::io::read(&path).unwrap();
        assert_eq!(&back, s.document());
        assert!(s.document().without_assets().assets.is_empty());
    }
}
