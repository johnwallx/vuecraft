//! VUECraft document engine. Independent of Tauri and any UI.

pub mod assets;
pub mod io;
pub mod model;
pub mod rich;
pub mod session;
pub mod svg;

pub use model::{Arrow, Curve, Document, Edge, EdgeStyle, Node, NodeStyle, Shape};
pub use session::{Op, Session, Transaction};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Invalid(String),
    #[error("this file is not a VUECraft document")]
    NotADocument,
    #[error(
        "this document uses schema version {found}, but this version of VUECraft reads versions 1 to {}; update VUECraft to open it",
        model::SCHEMA_VERSION
    )]
    UnsupportedVersion { found: u64 },
    #[error("the document changed before this edit was applied; the edit was discarded")]
    Stale,
    #[error("the file is not valid JSON ({0})")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
