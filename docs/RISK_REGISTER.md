# Dependency risk register

Every exception in `deny.toml` is listed here. An exception is an accepted, open risk, not a
resolved one. Review each entry when the depending crate is upgraded and before each release.

| Advisory | Crate (version) | Pulled in by | Platform | Kind | Risk assessment | Possible replacement | Reviewed |
|---|---|---|---|---|---|---|---|
| RUSTSEC-2024-0370 | proc-macro-error 1.0.4 | glib-macros 0.18 → gtk-rs 0.18 → Tauri's Linux backend (muda, wry, tao) | Linux build only | Unmaintained (no known vulnerability) | Low: a compile-time proc macro; it does not ship in the binary. Fixes would need a new upstream release. | Goes away when Tauri moves to gtk-rs ≥ 0.19 / gtk4. Track Tauri releases. | 2026-11-09 |
| RUSTSEC-2026-0370 | zvariant 5.15.1 | zbus 5.19 → tauri-plugin-opener 2.7.2 | Linux only (D-Bus "show in folder") | Unmaintained (no known vulnerability) | Low to moderate: runtime code that parses D-Bus messages from the session bus on Linux only. Not compiled into Windows builds. No safe upgrade published. | A maintained zbus line; or on Linux, reveal files via `xdg-open` on the parent folder instead of the opener plugin's D-Bus call. | 2026-11-09 |
| RUSTSEC-2026-0371 | zbus_names 4.3.5 | zbus 5.19 → tauri-plugin-opener 2.7.2 | Linux only | Unmaintained (no known vulnerability) | Low: name validation helpers for the same D-Bus path. | As above. | 2026-11-09 |
| RUSTSEC-2026-0372 | zvariant_derive 5.15.1 | zvariant 5.15 → zbus 5.19 | Linux build only | Unmaintained (no known vulnerability) | Low: compile-time derive macro. | As above. | 2026-11-09 |

Open follow-up: investigate a maintained alternative for the Linux "show in folder" path
before the first Linux release (no Linux build is shipped yet).
