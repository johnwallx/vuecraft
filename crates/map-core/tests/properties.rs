//! Property tests: random sequences of edits (valid and invalid, over a small id space
//! so they collide) must keep every document invariant, leave rejected transactions
//! without effect, serialize deterministically and losslessly, and undo/redo exactly.
use map_core::model::Layer;
use map_core::{Edge, Node, Op, Session, Transaction, io};
use proptest::prelude::*;

const NODES: &[&str] = &["n0", "n1", "n2", "n3", "n4"];
const MOVABLE: &[&str] = &["n0", "n1", "n2", "n3", "n4", "g0", "g1"];
const EDGES: &[&str] = &["e0", "e1", "e2", "e3"];
const GROUPS: &[&str] = &["g0", "g1"];
const LAYERS: &[&str] = &["layer-1", "l1", "l2"];

fn pick(pool: &'static [&'static str]) -> impl Strategy<Value = String> {
    prop::sample::select(pool).prop_map(String::from)
}

fn op() -> impl Strategy<Value = Op> {
    let c = || (-400i32..400).prop_map(f64::from);
    prop_oneof![
        3 => (pick(NODES), c(), c()).prop_map(|(id, x, y)| Op::AddNode { node: Node::new(id, "n", x, y), index: None }),
        1 => pick(MOVABLE).prop_map(|id| Op::RemoveNode { id }),
        2 => (pick(EDGES), pick(MOVABLE), pick(NODES)).prop_map(|(id, s, t)| Op::AddEdge { edge: Edge::new(id, s, t), index: None }),
        1 => pick(EDGES).prop_map(|id| Op::RemoveEdge { id }),
        2 => (pick(MOVABLE), c(), c()).prop_map(|(id, x, y)| Op::MoveNode { id, x, y }),
        1 => (pick(NODES), "[a-z ]{0,8}").prop_map(|(id, label)| Op::SetNodeLabel { id, label }),
        1 => (pick(GROUPS), prop::sample::subsequence(MOVABLE.to_vec(), 0..=3)).prop_map(|(g, kids)| Op::Group {
            group: Node::group(g, "g"),
            children: kids.into_iter().map(String::from).collect(),
            index: None,
        }),
        1 => pick(GROUPS).prop_map(|id| Op::Ungroup { id }),
        1 => pick(LAYERS).prop_map(|l| Op::AddLayer { layer: Layer::new(l.clone(), l), index: None }),
        1 => (pick(LAYERS), any::<bool>(), any::<bool>()).prop_map(|(id, visible, locked)| Op::UpdateLayer { name: id.clone(), id, visible, locked }),
        1 => (pick(LAYERS), 0usize..3).prop_map(|(id, index)| Op::MoveLayer { id, index }),
        1 => (pick(MOVABLE), pick(LAYERS)).prop_map(|(id, layer)| Op::SetLayer { id, layer }),
        1 => (pick(LAYERS), prop::option::of(pick(LAYERS))).prop_map(|(id, into)| Op::RemoveLayer { id, into }),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 300, ..ProptestConfig::default() })]

    #[test]
    fn random_edits_keep_invariants_and_undo_exactly(txs in prop::collection::vec(prop::collection::vec(op(), 1..4), 1..30)) {
        let mut s = Session::default();
        let mut states = vec![s.document().clone()];
        for ops in txs {
            let (before, rev) = (s.document().clone(), s.revision());
            let tx = Transaction { base_revision: rev, label: "edit".into(), ops };
            match s.apply(tx) {
                Ok(()) if s.document() != &before => states.push(s.document().clone()),
                Ok(()) => prop_assert_eq!(s.revision(), rev, "no-op adds no history"),
                Err(_) => {
                    prop_assert_eq!(s.document(), &before, "rejected transactions change nothing");
                    prop_assert_eq!(s.revision(), rev);
                }
            }
            // No dangling links, unique ids, valid groups and layers.
            if let Err(e) = s.document().validate() {
                return Err(TestCaseError::fail(format!("invalid document after edits: {e}")));
            }
            let json = io::to_json(s.document()).unwrap();
            prop_assert_eq!(&io::to_json(s.document()).unwrap(), &json, "serialization is deterministic");
            prop_assert_eq!(&io::parse(&json).unwrap(), s.document(), "save/load is lossless");
        }
        for expected in states.iter().rev().skip(1) {
            prop_assert!(s.undo().unwrap());
            prop_assert_eq!(s.document(), expected);
        }
        prop_assert!(!s.undo().unwrap(), "history fully unwound");
        for expected in states.iter().skip(1) {
            prop_assert!(s.redo().unwrap());
            prop_assert_eq!(s.document(), expected);
        }
        prop_assert!(!s.dirty() || states.len() > 1);
    }
}
