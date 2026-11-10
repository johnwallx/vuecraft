# Security policy

## Supported versions

VUECraft is in beta. Only the latest beta release receives security fixes.

| Version | Supported |
|---|---|
| Latest beta (currently 0.1.0-beta.1) | Yes |
| Anything older | No |

## Reporting a vulnerability

Please don't report security problems in public issues, discussions or pull
requests.

Report them privately through GitHub's private vulnerability reporting: open
the repository's **Security** tab and choose **Report a vulnerability**
([direct link](https://github.com/johnwallx/vuecraft/security/advisories/new)).

If that button is missing, private reporting hasn't been enabled yet. Open a
discussion asking for a private contact, without any details of the problem.

Please include:

- the VUECraft version and your Windows version;
- what the problem is and what an attacker could do with it;
- steps to reproduce, ideally with a minimal map file or clipboard content
  that triggers it (remove anything private first);
- whether the problem is already public, and how you'd like to be credited.

VUECraft is maintained by volunteers, so responses are best effort and there
is no guaranteed response time. We'll confirm the report, keep you updated,
and publish a GitHub security advisory once a fix is released. Please allow
reasonable time for a fix before disclosing the problem.

## Security model

VUECraft is a local desktop app with no accounts and no server. It relies on
the following protections.

- **Documents and pasted text are treated as untrusted.** The Rust engine
  validates every file before opening it: format marker, schema version,
  unique ids, valid link endpoints, geometry bounds, colors, the rich-text
  allowlist (http, https and mailto links only, with depth and size limits),
  and the type, size and checksum of embedded images. Files over 64 MB are
  refused. Every edit from the interface is validated again and applied
  completely or not at all. Pasted formatted text goes through the same
  rich-text schema, so scripts, images and unknown markup are dropped.
- **Links and files open only when you ask.** Links inside labels are inert.
  Attachments are opened by the Rust side of the app, and only after you
  confirm: links go to your default browser, and files are only shown in
  their folder, never run. The interface (the webview) has no permission to
  open links or files itself. Missing-file checks skip network paths, so
  opening a document never contacts a remote server.
- **No network use and no telemetry.** The app sends no data anywhere and has
  no update check. The webview's Content Security Policy loads scripts only
  from the app itself and allows connections only to the app's internal IPC
  channel. On a system without the WebView2 runtime, the installer downloads
  Microsoft's bootstrapper; Windows 11 already includes the runtime.
- **Narrow permissions.** The webview has Tauri's core defaults, can set the
  window title and close the window, and can show the native Open and Save
  dialogs. It has no direct file-system access and works through a short list
  of app commands.
- **No test interfaces in releases.** The embedded WebDriver server and the
  file-path test seam used by the desktop tests are compiled in only for test
  builds. For the beta, a scan of the release binary confirmed neither is
  present.

Known limits:

- The installer and executable are not code-signed, so Windows SmartScreen
  warns before running them. Download VUECraft only from the
  [Releases page](https://github.com/johnwallx/vuecraft/releases) and compare
  the SHA-256 checksum published with the release.
- No independent security review has been done yet.
- Accepted dependency advisories are listed in
  [docs/RISK_REGISTER.md](docs/RISK_REGISTER.md).
