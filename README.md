# fzTermFile

A **hybrid terminal** for Obsidian: a **local shell** (WSL on Windows, native shell on Linux/macOS) and **remote SSH** sessions, rendered with **xterm.js**. Manage and favorite terminal profiles, browse **local and remote files over SFTP**, and run **Claude Code** from inside Obsidian.

- **Author:** Roger Luft — <roger@webstorage.com.br>
- **License:** MIT • **Desktop only** (`isDesktopOnly: true`)
- **UI language:** English by default, with an optional **Português (Brasil)** translation in settings.
- **Stack:** TypeScript, the Obsidian API, xterm.js, ssh2 (SSH/SFTP), optional node-pty (real PTY), bundled with esbuild.

> **What this plugin does on your machine (disclosure).** It spawns local shell processes (e.g. `wsl.exe`, `pwsh.exe`, `/bin/bash`) and, for SSH profiles, opens outbound network connections to the host you configure and can transfer files over SFTP. It does **not** download or execute any code from the internet on its own, and it has no telemetry. SSH passwords/passphrases you enter are stored **unencrypted** in this vault's `data.json` — prefer key-file authentication.

## Features

- **Local terminal** with two modes (see *Native PTY* below):
  - **Real PTY** via `node-pty` when you install it — full fidelity, supports interactive TUIs (vim, htop, **Claude Code**'s UI).
  - **Compatibility mode** (no native module) with built-in **line editing** — typing, **Backspace**, history (↑/↓), cursor moves, Ctrl+C/U/W work for ordinary commands and scripts.
- **Remote SSH terminals** (ssh2) with a full interactive PTY on the server.
- **Profiles** with full CRUD: add, edit, delete and **favorite** (local and SSH).
- The **shell / command-line field accepts parameters**, e.g. `pwsh.exe -c wsl.exe` or `"C:\Program Files\PowerShell\7\pwsh.exe" -NoLogo` (quotes are honored).
- **Quick picker** (favorites first) + ribbon icon + commands.
- **Hybrid file browser** (local + remote via SFTP): browse, **download to a local folder**, and **upload to the remote**, with an **overwrite confirmation** so you never silently clobber a file.
- **"Open Claude Code"** action.
- Appearance follows the **active Obsidian theme** (and updates live on theme change).

## Requirements

- Obsidian **1.7.2+** (desktop).
- **Windows:** WSL installed (for the default bash shell), or set another shell.
- **SSH:** network access to the host; password **or** private key.
- **Real PTY (optional):** Node.js + npm to install `node-pty` (see below).

## Install

### From the community store (when published)
Search for **fzTermFile** in *Settings → Community plugins* and install. SSH works immediately; the local terminal runs in compatibility mode until you optionally enable the native PTY.

### Manually / via BRAT
1. Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/fztermfile/`.
2. Enable it in *Settings → Community plugins*.

## Native PTY (node-pty) and the Electron ABI problem — please read

A terminal can run **interactive full-screen programs** (vim, htop, **Claude Code**'s UI) and give you a true shell line editor (the shell's own Backspace, tab-completion, etc.) only when it is backed by a **real PTY**. On the desktop that means the native `node-pty` module.

**Why fzTermFile does not bundle node-pty:**

1. The Obsidian community store distributes only `main.js` + `manifest.json` + `styles.css` — **no binaries**.
2. `node-pty` is a **native module** that must be compiled for the **exact Electron version** Obsidian ships. Obsidian moves fast: it has gone Electron 32 → 34 → **39** (Obsidian 1.12.x). A prebuilt binary that matches one version stops loading after an Electron bump (`NODE_MODULE_VERSION` mismatch).
3. Downloading or `npm install`-ing native code **at runtime from inside a plugin** is a common reason for **rejection** from the community store (it resembles a self-update / remote-code mechanism), so fzTermFile **never** does that.

**How the popular `terminal` plugin (by polyipseity) handles it — and what fzTermFile does:** that plugin also ships JS only and does **not** bundle a PTY; for true PTY/resize behavior it asks the **user** to install a helper themselves (Python 3.9+, plus `psutil`/`pywinctl` on Windows). fzTermFile follows the same philosophy: **nothing is downloaded at runtime**, and the native PTY is an **opt-in dependency you install once**.

### Working around it: enable a real PTY (recommended for Claude Code)

The simplest option is **`@lydell/node-pty`**, whose prebuilt binaries are **N-API** — ABI-stable across Electron versions, so they load on Obsidian's current Electron **without any rebuild or C++ toolchain**. To enable the full TUI / Claude Code experience:

1. Open *Settings → fzTermFile → Native local terminal (node-pty)* and click **Copy install command** (and **Open plugin folder**). The command is, in effect:
   ```bash
   npm install --prefix "<vault>/.obsidian/plugins/fztermfile" @lydell/node-pty
   ```
2. Run it in a **real terminal** (PowerShell/bash) on the machine. It downloads only your platform's prebuilt (e.g. `@lydell/node-pty-win32-x64`, which bundles ConPTY/OpenConsole on Windows).
3. **Reopen Obsidian.** fzTermFile auto-detects the module and switches local terminals to the real PTY (the settings status will say *Detected*).

If `@lydell/node-pty` ever lacks a prebuild for your platform/arch, alternatives are `node-pty` (official, needs `npx @electron/rebuild -v <obsidian-electron-version>` and a C++ toolchain) or `@homebridge/node-pty-prebuilt-multiarch`. Read Obsidian's Electron version from *Help → About*.

Until then, **compatibility mode** is used automatically — and it already fixes the classic "Backspace doesn't work in pwsh.exe" problem by doing the line editing on the front end. Its only limitation is full-screen TUIs.

## Usage

- **Ribbon** icon or command **"Open terminal (choose profile)"**.
- **Commands** (Ctrl/Cmd+P): open terminal, new local terminal, open Claude Code, open file browser.
- **Profiles:** *Settings → fzTermFile → Terminal profiles → + Local / + SSH* (edit, delete, favorite there).
  - **Shell / command line:** leave empty for auto-detection, or type a full command line such as `pwsh.exe -c wsl.exe`. Use **Extra arguments** for additional argv (e.g. `-d Ubuntu` to pick a WSL distro).
- **SSH:** host, port, username and **password** *or* **private key** (+ passphrase) and an initial remote directory.
- **File browser:** switch **Local/Remote**; click folders; **download**/**upload** files (the remote side uses the open SSH session). Existing files trigger an **overwrite confirmation**.
- **Claude Code:** have `claude` available in the target shell; the action opens a local terminal and runs it. For Claude Code's interactive UI, enable the **real PTY** (above).

### WSL on Windows
Local profiles open `wsl.exe` (default distribution) by default. To pick a distro, set **Extra arguments** to `-d Ubuntu`. For PowerShell/cmd, set **Default shell on Windows** or the profile's **Shell / command line** field.

## Build from source (development)

```bash
npm install      # JS deps; node-pty is optional and may be skipped
npm run dev      # watch (rebuilds on save)
npm run build    # production build (emits main.js)
node test/run-tests.cjs   # run the pure-logic tests (after bundling test/run-tests.ts)
```

## Community guidelines compliance

`manifest.json` has a unique lowercase id and `isDesktopOnly: true`; `main.js`/`node_modules` are out of version control (`.gitignore`); each terminal frees its resources on close; uses `this.app`; DOM is built with `createEl`/`createDiv` (no `innerHTML`); styles live in `styles.css`; UI text is English (with optional pt-BR) in sentence case; no default hotkeys; no auto-update mechanism; **no code is downloaded or executed at runtime** — the optional native PTY is installed by the user.

## License

MIT © 2026 Roger Luft. xterm.js and dependencies are MIT (see `styles.css`).
