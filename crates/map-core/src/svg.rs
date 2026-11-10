//! Whole-document SVG export, framed to content bounds.
//!
//! Edge geometry here is the canonical definition; `src/canvas/geometry.ts`
//! implements the same formulas for on-screen rendering.

use std::fmt::Write;

use crate::model::{Arrow, Curve, Document, Edge, Node, Shape, is_hex_color};

const PAD: f64 = 24.0;
const FONT_SIZE: f64 = 14.0;
const LINE_HEIGHT: f64 = 18.0;
// shortcut: text width is estimated, not measured; wrapping can differ slightly from the canvas.
const CHAR_WIDTH: f64 = 7.4;
const CURVE_BEND: f64 = 0.2;
const ARROW_LEN: f64 = 11.0;
const ARROW_HALF_WIDTH: f64 = 5.0;

const DEFAULT_FILL: &str = "#ffffff";
const DEFAULT_STROKE: &str = "#6b7280";
const DEFAULT_EDGE: &str = "#4b5563";
const DARK_TEXT: &str = "#1f2328";
const LIGHT_TEXT: &str = "#ffffff";

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pt {
    pub x: f64,
    pub y: f64,
}

fn pt(x: f64, y: f64) -> Pt {
    Pt { x, y }
}

pub fn center(n: &Node) -> Pt {
    pt(n.x + n.width / 2.0, n.y + n.height / 2.0)
}

/// Point where a ray from the node's center toward `toward` leaves its shape.
pub fn boundary_point(n: &Node, toward: Pt) -> Pt {
    let c = center(n);
    let (dx, dy) = (toward.x - c.x, toward.y - c.y);
    if dx == 0.0 && dy == 0.0 {
        return c;
    }
    let (hw, hh) = (n.width / 2.0, n.height / 2.0);
    let t = match n.style.shape {
        Shape::Rectangle | Shape::Rounded => {
            let tx = if dx == 0.0 { f64::INFINITY } else { hw / dx.abs() };
            let ty = if dy == 0.0 { f64::INFINITY } else { hh / dy.abs() };
            tx.min(ty)
        }
        Shape::Ellipse => 1.0 / ((dx / hw).powi(2) + (dy / hh).powi(2)).sqrt(),
        Shape::Diamond => 1.0 / (dx.abs() / hw + dy.abs() / hh),
    };
    pt(c.x + dx * t, c.y + dy * t)
}

pub struct EdgeGeometry {
    pub start: Pt,
    pub end: Pt,
    /// Quadratic control point for curved edges.
    pub control: Option<Pt>,
    pub label: Pt,
}

pub fn edge_geometry(src: &Node, tgt: &Node, curve: Curve) -> EdgeGeometry {
    let (a, b) = (center(src), center(tgt));
    match curve {
        Curve::Straight => {
            let (start, end) = (boundary_point(src, b), boundary_point(tgt, a));
            EdgeGeometry {
                start,
                end,
                control: None,
                label: pt((start.x + end.x) / 2.0, (start.y + end.y) / 2.0),
            }
        }
        Curve::Curved => {
            // Bend to the left of the travel direction, so A->B and B->A separate.
            let (dx, dy) = (b.x - a.x, b.y - a.y);
            let ctrl = pt((a.x + b.x) / 2.0 + dy * CURVE_BEND, (a.y + b.y) / 2.0 - dx * CURVE_BEND);
            let (start, end) = (boundary_point(src, ctrl), boundary_point(tgt, ctrl));
            let label = pt(
                0.25 * start.x + 0.5 * ctrl.x + 0.25 * end.x,
                0.25 * start.y + 0.5 * ctrl.y + 0.25 * end.y,
            );
            EdgeGeometry {
                start,
                end,
                control: Some(ctrl),
                label,
            }
        }
    }
}

fn arrowhead(tip: Pt, from: Pt) -> [Pt; 3] {
    let (dx, dy) = (tip.x - from.x, tip.y - from.y);
    let len = (dx * dx + dy * dy).sqrt().max(f64::EPSILON);
    let (ux, uy) = (dx / len, dy / len);
    let base = pt(tip.x - ux * ARROW_LEN, tip.y - uy * ARROW_LEN);
    [
        tip,
        pt(base.x - uy * ARROW_HALF_WIDTH, base.y + ux * ARROW_HALF_WIDTH),
        pt(base.x + uy * ARROW_HALF_WIDTH, base.y - ux * ARROW_HALF_WIDTH),
    ]
}

pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\t' => out.push(' '),
            c if c.is_control() => {} // not allowed in XML 1.0
            c => out.push(c),
        }
    }
    out
}

fn color<'a>(c: &'a Option<String>, default: &'a str) -> &'a str {
    match c {
        Some(s) if is_hex_color(s) => s,
        _ => default,
    }
}

/// Black or white text, whichever reads better on `fill`.
pub fn text_color(fill: &str) -> &'static str {
    let hex = fill.trim_start_matches('#');
    let full: String = if hex.len() == 3 {
        hex.chars().flat_map(|c| [c, c]).collect()
    } else {
        hex.to_string()
    };
    let ch = |i: usize| u8::from_str_radix(full.get(i..i + 2).unwrap_or("ff"), 16).unwrap_or(255) as f64 / 255.0;
    let lum = 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
    if lum > 0.5 { DARK_TEXT } else { LIGHT_TEXT }
}

pub fn wrap(text: &str, max_width: f64) -> Vec<String> {
    let max_chars = ((max_width / CHAR_WIDTH).floor() as usize).max(1);
    let mut lines = Vec::new();
    for para in text.split('\n') {
        let mut line = String::new();
        for word in para.split(' ') {
            let mut word = word.to_string();
            while word.chars().count() > max_chars {
                if !line.is_empty() {
                    lines.push(std::mem::take(&mut line));
                }
                let cut: String = word.chars().take(max_chars).collect();
                word = word.chars().skip(max_chars).collect();
                lines.push(cut);
            }
            let need = line.chars().count() + usize::from(!line.is_empty()) + word.chars().count();
            if need > max_chars && !line.is_empty() {
                lines.push(std::mem::take(&mut line));
            }
            if !line.is_empty() {
                line.push(' ');
            }
            line.push_str(&word);
        }
        lines.push(line);
    }
    lines
}

fn text_block(out: &mut String, lines: &[String], cx: f64, cy: f64, fill: &str) {
    let top = cy - (lines.len() as f64 - 1.0) * LINE_HEIGHT / 2.0;
    let _ = write!(
        out,
        r#"<text text-anchor="middle" dominant-baseline="central" fill="{fill}">"#
    );
    for (i, line) in lines.iter().enumerate() {
        let _ = write!(
            out,
            r#"<tspan x="{cx:.2}" y="{:.2}">{}</tspan>"#,
            top + i as f64 * LINE_HEIGHT,
            escape(line)
        );
    }
    out.push_str("</text>");
}

/// Horizontal space available for text inside a shape.
pub fn text_width(n: &Node) -> f64 {
    let factor = match n.style.shape {
        Shape::Rectangle | Shape::Rounded => 1.0,
        Shape::Ellipse => 0.72,
        Shape::Diamond => 0.5,
    };
    (n.width * factor - 16.0).max(CHAR_WIDTH)
}

pub fn export_svg(doc: &Document) -> String {
    let mut body = String::new();
    let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    let mut grow = |p: Pt, rx: f64, ry: f64| {
        x0 = x0.min(p.x - rx);
        y0 = y0.min(p.y - ry);
        x1 = x1.max(p.x + rx);
        y1 = y1.max(p.y + ry);
    };

    // Visible layers only, bottom to top; within a layer groups sit behind
    // connections, which sit behind concepts.
    for layer in doc.layers.iter().filter(|l| l.visible) {
        let on_layer = |n: &&Node| n.layer == layer.id;
        for g in doc.nodes.iter().filter(|n| n.is_group()).filter(on_layer) {
            grow(center(g), g.width / 2.0, g.height / 2.0);
            write_group(&mut body, g);
        }
        for e in doc.edges.iter().filter(|e| e.layer == layer.id && doc.edge_visible(e)) {
            let (Some(src), Some(tgt)) = (doc.node(&e.source), doc.node(&e.target)) else {
                continue;
            };
            write_edge(&mut body, e, src, tgt, &mut grow);
        }
        for n in doc.nodes.iter().filter(|n| !n.is_group()).filter(on_layer) {
            grow(center(n), n.width / 2.0, n.height / 2.0);
            write_node(
                &mut body,
                n,
                n.image.as_ref().and_then(|id| doc.assets.get(id)).map(|a| a.data_url()),
            );
        }
    }

    if x0 > x1 {
        (x0, y0, x1, y1) = (0.0, 0.0, 0.0, 0.0);
    }
    let (vx, vy, w, h) = (x0 - PAD, y0 - PAD, x1 - x0 + 2.0 * PAD, y1 - y0 + 2.0 * PAD);
    let mut out = String::new();
    let _ = write!(
        out,
        r##"<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{w:.0}" height="{h:.0}" viewBox="{vx:.2} {vy:.2} {w:.2} {h:.2}" font-family="system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="{FONT_SIZE}">
<title>{}</title>
<rect x="{vx:.2}" y="{vy:.2}" width="{w:.2}" height="{h:.2}" fill="#ffffff"/>
"##,
        escape(&doc.title)
    );
    out.push_str(&body);
    out.push_str("</svg>\n");
    out
}

fn write_edge(out: &mut String, e: &Edge, src: &Node, tgt: &Node, grow: &mut impl FnMut(Pt, f64, f64)) {
    let g = edge_geometry(src, tgt, e.style.curve);
    let stroke = color(&e.style.color, DEFAULT_EDGE);
    let d = match g.control {
        Some(c) => format!(
            "M{:.2},{:.2} Q{:.2},{:.2} {:.2},{:.2}",
            g.start.x, g.start.y, c.x, c.y, g.end.x, g.end.y
        ),
        None => format!("M{:.2},{:.2} L{:.2},{:.2}", g.start.x, g.start.y, g.end.x, g.end.y),
    };
    let _ = write!(
        out,
        r#"<g class="edge"><path d="{d}" fill="none" stroke="{stroke}" stroke-width="1.5"/>"#
    );
    if let Some(c) = g.control {
        grow(c, 0.0, 0.0);
    }
    let mut heads = Vec::new();
    if matches!(e.style.arrow, Arrow::End | Arrow::Both) {
        heads.push(arrowhead(g.end, g.control.unwrap_or(g.start)));
    }
    if e.style.arrow == Arrow::Both {
        heads.push(arrowhead(g.start, g.control.unwrap_or(g.end)));
    }
    for [a, b, c] in heads {
        let _ = write!(
            out,
            r#"<path d="M{:.2},{:.2} L{:.2},{:.2} L{:.2},{:.2} Z" fill="{stroke}"/>"#,
            a.x, a.y, b.x, b.y, c.x, c.y
        );
    }
    if !e.label.is_empty() {
        let lines = wrap(&e.label, 220.0);
        let w = lines.iter().map(|l| l.chars().count()).max().unwrap_or(0) as f64 * CHAR_WIDTH + 10.0;
        let h = lines.len() as f64 * LINE_HEIGHT + 4.0;
        grow(g.label, w / 2.0, h / 2.0);
        let _ = write!(
            out,
            r##"<rect x="{:.2}" y="{:.2}" width="{w:.2}" height="{h:.2}" rx="3" fill="#ffffff" fill-opacity="0.9"/>"##,
            g.label.x - w / 2.0,
            g.label.y - h / 2.0
        );
        text_block(out, &lines, g.label.x, g.label.y, DARK_TEXT);
    }
    out.push_str("</g>\n");
}

const GROUP_FILL: &str = "#f3f4f6";
const GROUP_STROKE: &str = "#9ca3af";

fn write_group(out: &mut String, g: &Node) {
    let fill = color(&g.style.fill, GROUP_FILL);
    let stroke = color(&g.style.stroke, GROUP_STROKE);
    let _ = write!(
        out,
        r#"<g class="group"><rect x="{:.2}" y="{:.2}" width="{:.2}" height="{:.2}" rx="8" fill="{fill}" fill-opacity="0.7" stroke="{stroke}" stroke-width="1.5" stroke-dasharray="6 4"/>"#,
        g.x, g.y, g.width, g.height
    );
    let title = wrap(&g.label, (g.width - 24.0).max(CHAR_WIDTH))
        .into_iter()
        .next()
        .unwrap_or_default();
    if !title.is_empty() {
        let _ = write!(
            out,
            r#"<text x="{:.2}" y="{:.2}" font-weight="600" fill="{}">{}</text>"#,
            g.x + 12.0,
            g.y + 22.0,
            text_color(fill),
            escape(&title)
        );
    }
    out.push_str(
        "</g>
",
    );
}

/// Inset of an embedded image inside its node; matches `.concept.has-image` in styles.css.
const IMAGE_INSET: f64 = 6.0;

fn write_node(out: &mut String, n: &Node, image: Option<String>) {
    let fill = color(&n.style.fill, DEFAULT_FILL);
    let stroke = color(&n.style.stroke, DEFAULT_STROKE);
    let c = center(n);
    let paint = format!(r#"fill="{fill}" stroke="{stroke}" stroke-width="1.5""#);
    out.push_str(r#"<g class="node">"#);
    let _ = match n.style.shape {
        Shape::Rectangle => write!(
            out,
            r#"<rect x="{:.2}" y="{:.2}" width="{:.2}" height="{:.2}" {paint}/>"#,
            n.x, n.y, n.width, n.height
        ),
        Shape::Rounded => write!(
            out,
            r#"<rect x="{:.2}" y="{:.2}" width="{:.2}" height="{:.2}" rx="{:.2}" {paint}/>"#,
            n.x,
            n.y,
            n.width,
            n.height,
            (n.height / 2.0).min(10.0)
        ),
        Shape::Ellipse => write!(
            out,
            r#"<ellipse cx="{:.2}" cy="{:.2}" rx="{:.2}" ry="{:.2}" {paint}/>"#,
            c.x,
            c.y,
            n.width / 2.0,
            n.height / 2.0
        ),
        Shape::Diamond => write!(
            out,
            r#"<path d="M{:.2},{:.2} L{:.2},{:.2} L{:.2},{:.2} L{:.2},{:.2} Z" {paint}/>"#,
            c.x,
            n.y,
            n.x + n.width,
            c.y,
            c.x,
            n.y + n.height,
            n.x,
            c.y
        ),
    };
    let lines = if n.label.is_empty() {
        Vec::new()
    } else {
        wrap(&n.label, text_width(n))
    };
    let mut text_y = c.y;
    if let Some(href) = image {
        // Picture on top, label below it (label block = lines + 12px padding).
        let text_h = if lines.is_empty() {
            0.0
        } else {
            lines.len() as f64 * LINE_HEIGHT + 12.0
        };
        let _ = write!(
            out,
            r#"<image x="{:.2}" y="{:.2}" width="{:.2}" height="{:.2}" preserveAspectRatio="xMidYMid meet" href="{href}"/>"#,
            n.x + IMAGE_INSET,
            n.y + IMAGE_INSET,
            (n.width - 2.0 * IMAGE_INSET).max(0.0),
            (n.height - 2.0 * IMAGE_INSET - text_h).max(0.0),
        );
        text_y = n.y + n.height - IMAGE_INSET - text_h / 2.0;
    }
    if !lines.is_empty() {
        text_block(out, &lines, c.x, text_y, text_color(fill));
    }
    out.push_str("</g>\n");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, x: f64, y: f64, shape: Shape) -> Node {
        let mut n = Node::new(id, id, x, y);
        n.width = 100.0;
        n.height = 50.0;
        n.style.shape = shape;
        n
    }

    #[test]
    fn boundary_points_lie_on_each_shape() {
        let east = pt(1000.0, 25.0);
        let diag = pt(150.0, 125.0); // 45 degrees from center (50,25)
        let r = node("r", 0.0, 0.0, Shape::Rectangle);
        assert_eq!(boundary_point(&r, east), pt(100.0, 25.0));
        assert_eq!(boundary_point(&r, diag), pt(75.0, 50.0));
        let e = node("e", 0.0, 0.0, Shape::Ellipse);
        let p = boundary_point(&e, diag);
        assert!(((p.x - 50.0) / 50.0).powi(2) + ((p.y - 25.0) / 25.0).powi(2) - 1.0 < 1e-9);
        let d = node("d", 0.0, 0.0, Shape::Diamond);
        let p = boundary_point(&d, diag);
        assert!(((p.x - 50.0).abs() / 50.0 + (p.y - 25.0).abs() / 25.0 - 1.0).abs() < 1e-9);
        assert_eq!(boundary_point(&r, center(&r)), center(&r));
    }

    #[test]
    fn curved_edges_bend_left_and_label_sits_on_curve() {
        let (a, b) = (
            node("a", 0.0, 0.0, Shape::Rectangle),
            node("b", 400.0, 0.0, Shape::Rectangle),
        );
        let g = edge_geometry(&a, &b, Curve::Curved);
        let c = g.control.unwrap();
        assert!(c.y < 25.0, "bends upward (left of eastward travel)");
        assert!((g.label.y - (0.25 * g.start.y + 0.5 * c.y + 0.25 * g.end.y)).abs() < 1e-9);
    }

    #[test]
    fn wrap_respects_newlines_and_width() {
        assert_eq!(wrap("a\nb", 100.0), vec!["a", "b"]);
        let lines = wrap("the quick brown fox jumps over the lazy dog", 75.0);
        assert!(lines.iter().all(|l| l.chars().count() <= 10), "{lines:?}");
        assert_eq!(lines.join(" "), "the quick brown fox jumps over the lazy dog");
        assert_eq!(wrap("abcdefghijklmnopqrstuvwxyz", 75.0).len(), 3);
    }

    #[test]
    fn text_contrast() {
        assert_eq!(text_color("#ffffff"), DARK_TEXT);
        assert_eq!(text_color("#000"), LIGHT_TEXT);
        assert_eq!(text_color("#1e3a8a"), LIGHT_TEXT);
    }

    #[test]
    fn export_is_well_formed_framed_and_complete() {
        let mut doc = Document {
            title: "T & <co>".into(),
            ..Default::default()
        };
        doc.nodes.push(node("a", -5000.0, -3000.0, Shape::Ellipse));
        doc.nodes.push(node("b", 8000.0, 6000.0, Shape::Diamond));
        doc.nodes[0].label = "Research <Question> & \"quotes\"\u{1}".into();
        doc.nodes[0].width = 600.0; // one line, so text nodes concatenate verbatim
        let mut e = Edge::new("ab", "a", "b");
        e.label = "leads to".into();
        e.style.arrow = Arrow::Both;
        e.style.curve = Curve::Curved;
        doc.edges.push(e);

        let svg = export_svg(&doc);
        let xml = roxmltree::Document::parse(&svg).expect("well-formed XML");
        let root = xml.root_element();
        let vb: Vec<f64> = root
            .attribute("viewBox")
            .unwrap()
            .split(' ')
            .map(|v| v.parse().unwrap())
            .collect();
        assert!(
            vb[0] <= -5000.0 - PAD + 1e-6 && vb[1] <= -3000.0 - PAD + 1e-6,
            "includes far top-left node"
        );
        assert!(
            vb[0] + vb[2] >= 8100.0 + PAD - 1e-6 && vb[1] + vb[3] >= 6050.0 + PAD - 1e-6,
            "includes far bottom-right node"
        );
        let text: String = xml
            .descendants()
            .filter(|n| n.is_text())
            .map(|n| n.text().unwrap())
            .collect();
        assert!(text.contains("Research <Question> & \"quotes\""));
        assert!(text.contains("leads to"));
        assert_eq!(
            xml.descendants()
                .filter(|n| n.attribute("class") == Some("node"))
                .count(),
            2
        );
        // path + 2 arrowheads
        let edge = xml
            .descendants()
            .find(|n| n.attribute("class") == Some("edge"))
            .unwrap();
        assert_eq!(edge.children().filter(|n| n.has_tag_name("path")).count(), 3);
    }

    #[test]
    fn export_of_empty_document_is_valid() {
        assert!(roxmltree::Document::parse(&export_svg(&Document::default())).is_ok());
    }

    #[test]
    fn groups_export_behind_their_members() {
        let mut doc = Document::default();
        let mut g = Node::group("g", "Cluster & co");
        (g.x, g.y, g.width, g.height) = (-20.0, -36.0, 200.0, 112.0);
        doc.nodes.push(node("a", 0.0, 0.0, Shape::Rounded));
        doc.nodes.push(g);
        let svg = export_svg(&doc);
        let xml = roxmltree::Document::parse(&svg).unwrap();
        let classes: Vec<_> = xml.descendants().filter_map(|n| n.attribute("class")).collect();
        assert_eq!(classes, ["group", "node"]);
        assert!(svg.contains("Cluster &amp; co"));
    }

    #[test]
    fn export_includes_visible_layers_only_in_layer_order() {
        let mut doc = Document::default();
        let mut top = crate::model::Layer::new("top", "Top");
        doc.nodes.push(node("a", 0.0, 0.0, Shape::Rounded));
        doc.nodes.push(node("b", 300.0, 0.0, Shape::Rounded));
        let mut c = node("c", 600.0, 0.0, Shape::Rounded);
        c.layer = "top".into();
        doc.nodes.push(c);
        doc.edges.push(Edge::new("ab", "a", "b"));
        doc.edges.push(Edge::new("bc", "b", "c"));
        doc.layers.push(top.clone());
        // Visible: top layer draws after the bottom one.
        let svg = export_svg(&doc);
        assert!(svg.find(">c<").unwrap() > svg.find(">b<").unwrap());
        // Hidden: its node and the link touching it disappear; the frame shrinks.
        top.visible = false;
        doc.layers[1] = top;
        let svg = export_svg(&doc);
        let xml = roxmltree::Document::parse(&svg).unwrap();
        let texts: Vec<_> = xml
            .descendants()
            .filter(|n| n.is_text())
            .filter_map(|n| n.text())
            .collect();
        assert!(!texts.contains(&"c"));
        assert_eq!(
            xml.descendants()
                .filter(|n| n.attribute("class") == Some("edge"))
                .count(),
            1
        );
        let width: f64 = xml.root_element().attribute("width").unwrap().parse().unwrap();
        assert!(width < 600.0);
    }

    #[test]
    fn embedded_images_export_above_the_label() {
        let mut s = crate::session::Session::default();
        let id = s.add_image(crate::assets::tests::PNG).unwrap();
        let mut doc = s.document().clone();
        let mut a = node("a", 0.0, 0.0, Shape::Rounded);
        (a.width, a.height, a.image) = (160.0, 140.0, Some(id));
        doc.nodes.push(a);
        let svg = export_svg(&doc);
        let xml = roxmltree::Document::parse(&svg).unwrap();
        let img = xml.descendants().find(|n| n.has_tag_name("image")).unwrap();
        assert!(
            img.attribute("href")
                .unwrap()
                .starts_with("data:image/png;base64,iVBOR")
        );
        assert_eq!(img.attribute("y"), Some("6.00"));
        let label_y: f64 = xml
            .descendants()
            .find(|n| n.has_tag_name("tspan"))
            .and_then(|t| t.attribute("y"))
            .unwrap()
            .parse()
            .unwrap();
        let img_bottom = 6.0 + img.attribute("height").unwrap().parse::<f64>().unwrap();
        assert!(
            label_y > img_bottom && label_y < 140.0,
            "label {label_y} below image {img_bottom}"
        );
    }
}
