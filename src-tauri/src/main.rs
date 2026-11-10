// Desktop shell: holds the single open document session and exposes it to the UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use map_core::assets::{MAX_IMAGE_BYTES, Resource, ResourceKind, is_network_path};
use map_core::{Document, Session, Transaction, io, svg};
use serde::Serialize;
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
struct App {
    session: Session,
    path: Option<PathBuf>,
}

type AppState<'a> = tauri::State<'a, Mutex<App>>;
type CmdResult<T> = Result<T, String>;

/// Canonical state returned after every command; the UI reconciles against it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    /// Without embedded image data; the UI fetches each image once by id.
    document: Document,
    /// Ids of the images this session can show (including ones no node uses yet).
    images: Vec<String>,
    revision: u64,
    path: Option<String>,
    dirty: bool,
    undo_label: Option<String>,
    redo_label: Option<String>,
}

fn snapshot(app: &App) -> Snapshot {
    let s = &app.session;
    Snapshot {
        document: s.document().without_assets(),
        images: s.document().assets.keys().cloned().collect(),
        revision: s.revision(),
        path: app.path.as_ref().map(|p| p.display().to_string()),
        dirty: s.dirty(),
        undo_label: s.undo_label().map(str::to_owned),
        redo_label: s.redo_label().map(str::to_owned),
    }
}

/// Diagnostics for the desktop test harness: with VUECRAFT_LOG set, IPC dispatches and
/// slow session-lock waits are written to stderr (start time of the process as zero).
static LOG: LazyLock<Option<Instant>> = LazyLock::new(|| std::env::var_os("VUECRAFT_LOG").map(|_| Instant::now()));

fn log(what: std::fmt::Arguments) {
    if let Some(t0) = *LOG {
        eprintln!("[{:>9.3}s] {what}", t0.elapsed().as_secs_f64());
    }
}

fn lock<'a>(state: &'a AppState) -> std::sync::MutexGuard<'a, App> {
    let started = Instant::now();
    // A panic elsewhere must not make the document unreachable.
    let guard = state.lock().unwrap_or_else(|e| e.into_inner());
    if started.elapsed() > Duration::from_millis(100) {
        log(format_args!("session lock waited {} ms", started.elapsed().as_millis()));
    }
    guard
}

fn name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| p.display().to_string())
}

#[tauri::command]
async fn doc_get(state: AppState<'_>) -> CmdResult<Snapshot> {
    Ok(snapshot(&lock(&state)))
}

#[tauri::command]
async fn doc_new(state: AppState<'_>) -> CmdResult<Snapshot> {
    let mut app = lock(&state);
    *app = App::default();
    Ok(snapshot(&app))
}

#[tauri::command]
async fn doc_apply(state: AppState<'_>, tx: Transaction) -> CmdResult<Snapshot> {
    let mut app = lock(&state);
    app.session.apply(tx).map_err(|e| format!("Edit rejected: {e}"))?;
    Ok(snapshot(&app))
}

#[tauri::command]
async fn doc_undo(state: AppState<'_>) -> CmdResult<Snapshot> {
    let mut app = lock(&state);
    app.session.undo().map_err(|e| format!("Undo failed: {e}"))?;
    Ok(snapshot(&app))
}

#[tauri::command]
async fn doc_redo(state: AppState<'_>) -> CmdResult<Snapshot> {
    let mut app = lock(&state);
    app.session.redo().map_err(|e| format!("Redo failed: {e}"))?;
    Ok(snapshot(&app))
}

#[tauri::command]
async fn doc_open(state: AppState<'_>, path: PathBuf) -> CmdResult<Snapshot> {
    let doc = io::read(&path).map_err(|e| format!("Could not open \"{}\": {e}", name(&path)))?;
    let mut app = lock(&state);
    *app = App {
        session: Session::new(doc),
        path: Some(path),
    };
    Ok(snapshot(&app))
}

/// Saves to `path`, or to the current path when `path` is None (plain Save).
#[tauri::command]
async fn doc_save(state: AppState<'_>, path: Option<PathBuf>) -> CmdResult<Snapshot> {
    let mut app = lock(&state);
    let path = path.or_else(|| app.path.clone()).ok_or("No file chosen for Save")?;
    io::save(&path, app.session.document()).map_err(|e| format!("Could not save \"{}\": {e}", name(&path)))?;
    app.session.mark_saved();
    app.path = Some(path);
    Ok(snapshot(&app))
}

#[tauri::command]
async fn export_svg(state: AppState<'_>, path: PathBuf) -> CmdResult<()> {
    let svg = svg::export_svg(lock(&state).session.document());
    io::write_atomic(&path, svg.as_bytes()).map_err(|e| format!("Could not export \"{}\": {e}", name(&path)))
}

/// Reads an image the user chose and stores it in the session; returns its id.
#[tauri::command]
async fn image_import(state: AppState<'_>, path: PathBuf) -> CmdResult<String> {
    let fail = |e: String| format!("Could not insert \"{}\": {e}", name(&path));
    let mut bytes = Vec::new();
    // Read one byte past the limit so oversized files are refused without loading them.
    File::open(&path)
        .and_then(|f| f.take(MAX_IMAGE_BYTES as u64 + 1).read_to_end(&mut bytes))
        .map_err(|e| fail(e.to_string()))?;
    lock(&state).session.add_image(&bytes).map_err(|e| fail(e.to_string()))
}

#[tauri::command]
async fn image_data(state: AppState<'_>, id: String) -> CmdResult<String> {
    let app = lock(&state);
    let asset = app.session.document().assets.get(&id).ok_or("Image not found")?;
    Ok(asset.data_url())
}

fn resources(state: &AppState, node: &str) -> CmdResult<Vec<Resource>> {
    let app = lock(state);
    let n = app.session.document().node(node).ok_or("Node not found")?;
    Ok(n.resources.clone())
}

/// Whether each attached local file exists; None for links and network paths,
/// which are never touched without the user asking.
#[tauri::command]
async fn resource_status(state: AppState<'_>, node: String) -> CmdResult<Vec<Option<bool>>> {
    Ok(resources(&state, &node)?
        .iter()
        .map(|r| (r.kind == ResourceKind::File && !is_network_path(&r.target)).then(|| Path::new(&r.target).exists()))
        .collect())
}

/// Opens a link in the default browser or shows a file in its folder (never runs it).
/// Only attachments stored in the document can be opened; the UI asks first.
#[tauri::command]
async fn resource_open(app: tauri::AppHandle, state: AppState<'_>, node: String, index: usize) -> CmdResult<()> {
    let r = resources(&state, &node)?
        .into_iter()
        .nth(index)
        .ok_or("Attachment not found")?;
    match r.kind {
        ResourceKind::Url => app.opener().open_url(&r.target, None::<&str>),
        ResourceKind::File => app.opener().reveal_item_in_dir(&r.target),
    }
    .map_err(|e| format!("Could not open \"{}\": {e}", r.target))
}

/// The file the app was started with: Windows passes a double-clicked `.vuecraft` as the first
/// argument. Handed out once, so a reloaded page never reopens it over unsaved work.
struct LaunchPath(Mutex<Option<PathBuf>>);

#[tauri::command]
fn launch_path(launch: tauri::State<'_, LaunchPath>) -> Option<PathBuf> {
    launch.0.lock().ok()?.take()
}

/// The desktop E2E suite sets VUECRAFT_TEST_SEAM to get its file-path seam. Only test builds
/// (`--features e2e-webdriver`) honor it; other builds always answer false.
#[tauri::command]
fn test_seam_enabled() -> bool {
    cfg!(feature = "e2e-webdriver") && std::env::var_os("VUECRAFT_TEST_SEAM").is_some()
}

fn main() {
    let handler: fn(tauri::ipc::Invoke) -> bool = tauri::generate_handler![
        doc_get,
        doc_new,
        doc_apply,
        doc_undo,
        doc_redo,
        doc_open,
        doc_save,
        export_svg,
        image_import,
        image_data,
        resource_status,
        resource_open,
        launch_path,
        test_seam_enabled
    ];
    // Options (anything starting with '-') are not files; the shell passes the full path.
    let launch = std::env::args_os()
        .skip(1)
        .find(|a| !a.to_string_lossy().starts_with('-'));
    log(format_args!("start {}", env!("CARGO_PKG_VERSION")));
    let builder = tauri::Builder::default();
    // Test-only embedded WebDriver server (127.0.0.1, TAURI_WEBDRIVER_PORT); compiled in only with
    // --features e2e-webdriver, never in release or normal builds.
    #[cfg(feature = "e2e-webdriver")]
    let builder = builder
        .plugin(tauri_plugin_wdio_webdriver::init())
        .plugin(tauri_plugin_wdio::init());
    builder
        .plugin(tauri_plugin_dialog::init())
        // Used from Rust only; the webview has no opener permissions.
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(App::default()))
        .manage(LaunchPath(Mutex::new(launch.map(PathBuf::from))))
        .invoke_handler(move |invoke: tauri::ipc::Invoke| {
            log(format_args!("ipc {}", invoke.message.command()));
            handler(invoke)
        })
        .run(tauri::generate_context!())
        .expect("failed to start VUECraft");
}
