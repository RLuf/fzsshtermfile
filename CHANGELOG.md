# Changelog

All notable changes to fzTermFile are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-06-10

### Fixed
- **Backspace / typing in the compatibility (no-PTY) fallback**, most visibly with
  `pwsh.exe`. A piped shell has no TTY, so it neither echoes input nor interprets
  Backspace — the old `DEL→BS` translation could not fix this. The fallback now
  has a front-end **line editor** (local echo, Backspace/Delete, ←/→, Home/End,
  history ↑/↓, Ctrl+C/U/W, Enter), so ordinary commands and scripts behave
  correctly without any native module.
- **The shell field now accepts a full command line with parameters**, e.g.
  `pwsh.exe -c wsl.exe` or `"C:\Program Files\PowerShell\7\pwsh.exe" -NoLogo`
  (quotes honored). Previously the entire string was treated as one executable
  name and failed with ENOENT.
- Early keystrokes typed before the backend finished starting are no longer lost
  (input is buffered); early PTY output (the first prompt/banner) is no longer
  dropped.
- UTF-8 output is no longer corrupted when a multibyte character is split across
  read chunks (accented characters, box-drawing glyphs, spinners).
- SSH: a single, correct exit notification (no more double "session ended" +
  "connection closed"); `ready` is reported only after the shell channel opens;
  late errors after connect are surfaced instead of silently swallowed; resizes
  requested while connecting are applied; `keepaliveCountMax` set.
- File browser (data-safety): downloads now land in the **folder you are viewing**
  (not always the vault root), and both download and upload **ask before
  overwriting** an existing file. Added a re-entrancy guard and absolute-path
  normalization.
- "Open Claude Code" no longer pushes a transient profile into your saved
  settings (which could leave junk profiles or fail due to a read race); it uses
  an in-memory ephemeral profile instead.
- Windows: closing a terminal now kills the whole child process tree
  (`taskkill /T`), avoiding orphaned `wsl.exe`/distro processes.

### Changed
- **UI is now English by default**, with an optional **Português (Brasil)**
  translation selectable in settings.
- The terminal theme follows live Obsidian theme changes (light/dark / theme
  switch) and reads CSS variables from the view (works in pop-out windows).
- Resize is debounced (no resize storms while dragging panes).
- On Windows the native PTY now uses **ConPTY** (modern node-pty default) instead
  of forcing the outdated `useConpty: false` (winpty), which broke input on
  current Node/Electron.

### Removed
- **Runtime `npm install` of node-pty was removed.** Installing/compiling native
  code from inside a plugin is a common community-store rejection trigger. The
  plugin now only **detects** a user-installed node-pty and otherwise uses the
  compatibility fallback. See *Native PTY* in the README for how to enable a real
  PTY manually.

### Added — real PTY via an external "PTY host"
Full-screen TUIs and **Claude Code**'s interactive UI need a real PTY. Two
obstacles: (1) node-pty is native and must match Obsidian's Electron (32 → 34 →
**39**), and the store ships JS only; (2) even with a correct binary, node-pty's
ConPTY backend needs a **Worker thread**, which the Obsidian **renderer forbids**
(`Failed to construct 'Worker'`). fzTermFile solves this with a **PTY host**: it
spawns the user's **Node.js** running the plugin's own host code (passed
in-memory via `node -e` — nothing written to disk, nothing downloaded), which
runs node-pty in that separate process and proxies the terminal over stdio. This
is the same external-runtime bridge the community **Terminal** plugin uses (it
bridges through Python). Requirements: **Node.js installed** + a node-pty module
in the plugin folder (recommended: **`@lydell/node-pty`**, N-API prebuilds — no
rebuild). If either is missing, the terminal falls back to compatibility mode
(which still has the Backspace fix). The runtime loader also accepts `node-pty`,
`@homebridge/node-pty-prebuilt-multiarch`, and `node-pty-prebuilt-multiarch`.

## [1.0.0] - 2026
- Initial version: hybrid local + SSH terminal with xterm.js, SFTP file browser,
  profiles, and a Claude Code shortcut.
