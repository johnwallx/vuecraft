//! Deterministic benchmark maps and engine timings.
//!
//!   cargo run --release -p map-core --example bench -- <output-dir>
//!
//! Writes bench-{100,500,1000}.vuecraft (n nodes, 2n edges) to <output-dir> for the
//! desktop benchmark, and prints median engine timings for parse+validate, save
//! and SVG export.

use std::path::PathBuf;
use std::time::{Duration, Instant};

use map_core::{Document, Edge, Node, Op, Session, Transaction, io, svg};

/// Grid layout; each node i links to i+1 and to the node below it (2n edges total).
fn generate(n: usize) -> Document {
    let cols = (n as f64).sqrt().ceil() as usize;
    let mut doc = Document {
        title: format!("Benchmark {n}"),
        ..Default::default()
    };
    for i in 0..n {
        let (r, c) = (i / cols, i % cols);
        doc.nodes.push(Node::new(
            format!("n{i}"),
            format!("Concept {i}"),
            c as f64 * 220.0,
            r as f64 * 120.0,
        ));
    }
    let mut k = 0;
    for i in 0..n {
        for j in [(i + 1) % n, (i + cols) % n] {
            if j == i {
                continue;
            }
            let mut e = Edge::new(format!("e{k}"), format!("n{i}"), format!("n{j}"));
            e.label = if k % 5 == 0 { "relates to".into() } else { String::new() };
            doc.edges.push(e);
            k += 1;
        }
    }
    doc
}

fn median(mut f: impl FnMut()) -> Duration {
    let mut runs: Vec<Duration> = (0..15)
        .map(|_| {
            let t = Instant::now();
            f();
            t.elapsed()
        })
        .collect();
    runs.sort();
    runs[runs.len() / 2]
}

fn ms(d: Duration) -> String {
    format!("{:.2}", d.as_secs_f64() * 1000.0)
}

fn main() {
    let out = PathBuf::from(std::env::args().nth(1).unwrap_or_else(|| "target/bench".into()));
    std::fs::create_dir_all(&out).expect("create output dir");
    println!("| nodes | edges | file KB | parse+validate ms | save ms | SVG export ms | 100-node move tx + undo ms |");
    println!("|---|---|---|---|---|---|---|");
    for n in [100, 500, 1000] {
        let doc = generate(n);
        doc.validate().expect("generated map is valid");
        let path = out.join(format!("bench-{n}.vuecraft"));
        io::save(&path, &doc).expect("save");
        let json = std::fs::read_to_string(&path).expect("read");

        let parse = median(|| {
            io::parse(&json).unwrap();
        });
        let save = median(|| io::save(&path, &doc).unwrap());
        let export = median(|| {
            svg::export_svg(&doc);
        });
        let mut session = Session::new(doc.clone());
        let tx_undo = median(|| {
            let ops = (0..100.min(n))
                .map(|i| Op::MoveNode {
                    id: format!("n{i}"),
                    x: i as f64,
                    y: 5.0,
                })
                .collect();
            let tx = Transaction {
                base_revision: session.revision(),
                label: "move".into(),
                ops,
            };
            session.apply(tx).unwrap();
            session.undo().unwrap();
        });
        println!(
            "| {n} | {} | {} | {} | {} | {} | {} |",
            doc.edges.len(),
            json.len() / 1024,
            ms(parse),
            ms(save),
            ms(export),
            ms(tx_undo)
        );
    }
}
