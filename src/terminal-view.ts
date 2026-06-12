import { ItemView, Notice, ViewStateResult, WorkspaceLeaf } from "obsidian";
import { ITheme, Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import {
	FZ_DEFAULT_TITLE,
	FZ_TERMINAL_ICON,
	FZ_TERMINAL_VIEW_TYPE,
} from "./constants";
import { TerminalBackend, TerminalExitInfo } from "./terminal-backend";
import { LocalPtyBackend } from "./pty-backend";
import { ChildProcessBackend } from "./child-process-backend";
import { SshBackend } from "./ssh-backend";
import { LineEditor } from "./line-editor";
import { TerminalProfile } from "./types";
import { t } from "./i18n";
// import type avoids a runtime dependency cycle (main imports this view).
import type FzTermFilePlugin from "./main";

// Persisted leaf state: just the id of the profile it shows.
interface TerminalViewState {
	profileId?: string;
}

// View (leaf) hosting one xterm.js terminal bound to a back-end (local PTY,
// child_process fallback, or remote SSH). Each open terminal is one instance.
export class TerminalView extends ItemView {
	private term: Terminal | null = null;
	private fitAddon: FitAddon | null = null;
	private searchAddon: SearchAddon | null = null;
	private backend: TerminalBackend | null = null;
	private lineEditor: LineEditor | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private resizeRaf: number | null = null;
	private terminalEl: HTMLElement | null = null;

	private profile: TerminalProfile | null = null;
	private profileId: string | null = null;
	private uiReady = false;
	private started = false;
	private dead = false; // backend has exited; ignore further input
	private pendingInput: string[] = []; // keystrokes typed before backend is ready

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: FzTermFilePlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return FZ_TERMINAL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.profile ? this.profile.name : FZ_DEFAULT_TITLE;
	}

	getIcon(): string {
		return FZ_TERMINAL_ICON;
	}

	// --- Leaf state persistence (which profile) ------------------------------

	getState(): Record<string, unknown> {
		return { profileId: this.profileId ?? undefined };
	}

	async setState(state: TerminalViewState, result: ViewStateResult): Promise<void> {
		if (state && typeof state.profileId === "string") {
			this.profileId = state.profileId;
		}
		await super.setState(state, result);
		this.tryStart();
	}

	// --- View lifecycle ------------------------------------------------------

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("fztermfile-view");
		this.terminalEl = root.createDiv({ cls: "fztermfile-terminal" });

		const settings = this.plugin.settings;

		this.term = new Terminal({
			fontFamily: settings.fontFamily,
			fontSize: settings.fontSize,
			cursorStyle: settings.cursorStyle,
			cursorBlink: settings.cursorBlink,
			scrollback: settings.scrollback,
			allowProposedApi: true,
			theme: this.buildTheme(),
		});

		this.fitAddon = new FitAddon();
		this.searchAddon = new SearchAddon();
		this.term.loadAddon(this.fitAddon);
		this.term.loadAddon(new WebLinksAddon());
		this.term.loadAddon(this.searchAddon);

		this.term.open(this.terminalEl);
		this.fit();

		// All user input flows through one dispatcher (handles the input race and
		// fallback line editing).
		this.term.onData((data) => this.handleInput(data));

		// Follow Obsidian theme changes (light/dark, theme switch).
		this.registerEvent(
			this.app.workspace.on("css-change", () => {
				if (this.term) this.term.options.theme = this.buildTheme();
			})
		);

		this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
		this.resizeObserver.observe(this.terminalEl);

		this.uiReady = true;
		this.tryStart();
		this.term.focus();
	}

	async onClose(): Promise<void> {
		if (this.resizeRaf !== null) {
			cancelAnimationFrame(this.resizeRaf);
			this.resizeRaf = null;
		}
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;

		if (this.backend) {
			if (this.backend instanceof SshBackend) {
				this.plugin.unregisterSshBackend(this.backend);
			}
			this.backend.dispose();
			this.backend = null;
		}
		this.lineEditor = null;

		this.term?.dispose();
		this.term = null;
		this.started = false;
	}

	focusTerminal(): void {
		this.term?.focus();
	}

	// --- Input ---------------------------------------------------------------

	private handleInput(data: string): void {
		if (this.dead) return;
		if (!this.backend) {
			// Backend not ready yet (PTY spawn / SSH connect in flight): buffer.
			this.pendingInput.push(data);
			return;
		}
		if (this.lineEditor) this.lineEditor.feed(data);
		else this.backend.write(data);
	}

	private flushPendingInput(): void {
		if (this.pendingInput.length === 0) return;
		const buffered = this.pendingInput.join("");
		this.pendingInput = [];
		if (this.lineEditor) this.lineEditor.feed(buffered);
		else this.backend?.write(buffered);
	}

	// --- Internals -----------------------------------------------------------

	private tryStart(): void {
		if (!this.uiReady || this.started || !this.profileId || !this.term) {
			return;
		}

		const profile = this.plugin.getProfile(this.profileId);
		if (!profile) {
			this.term.writeln("\x1b[31m" + t("view.profileNotFound") + "\x1b[0m");
			return;
		}
		this.profile = profile;
		this.started = true;

		void this.startBackend(profile);
	}

	// Wire the common callbacks (output and exit) to a back-end.
	private wire(backend: TerminalBackend): TerminalBackend {
		backend.onData((data) => this.term?.write(data));
		backend.onExit((info) => this.handleExit(info));
		return backend;
	}

	private handleExit(info: TerminalExitInfo): void {
		this.dead = true;
		this.lineEditor?.reset();
		const codePart = info.code != null ? t("exit.code", info.code) : "";
		this.term?.writeln(
			`\r\n\x1b[33m[${info.reason ?? t("exit.ended")}${codePart}]\x1b[0m`
		);
	}

	// Once a backend is chosen and started, install it as the active backend,
	// set up the line editor when needed, and flush any buffered keystrokes.
	private activate(backend: TerminalBackend): void {
		this.backend = backend;
		this.dead = false;
		if (backend.localEcho) {
			this.lineEditor = new LineEditor({
				write: (d) => this.term?.write(d),
				onLine: (line) => this.backend?.write(line + "\n"),
				onInterrupt: () => this.backend?.write("\x03"),
				onEof: () => this.backend?.endInput?.(),
			});
		} else {
			this.lineEditor = null;
		}
		this.flushPendingInput();
	}

	private async startBackend(profile: TerminalProfile): Promise<void> {
		if (!this.term) return;
		const size = { cols: this.term.cols, rows: this.term.rows };
		const settings = this.plugin.settings;

		// SSH profile: remote back-end (pure JS, nothing native).
		if (profile.kind === "ssh") {
			const backend = new SshBackend(profile);
			this.wire(backend);
			this.plugin.registerSshBackend(backend);
			this.activate(backend);
			try {
				await backend.start(size);
				this.fit();
			} catch (e) {
				this.reportError(e);
			}
			return;
		}

		// Local profile: use the native PTY if available; otherwise (or on
		// failure) fall back automatically to compatibility mode (child_process).
		const cwd = this.plugin.getVaultBasePath();
		const pluginDir = this.plugin.getPluginDir();
		const hasNative = this.plugin.binaryManager.checkInstalled();

		if (hasNative) {
			const native = new LocalPtyBackend(
				profile,
				settings.defaultWindowsShell,
				cwd,
				pluginDir
			);
			this.wire(native);
			this.activate(native);
			try {
				await native.start(size);
				this.fit();
				return;
			} catch (e) {
				native.dispose();
				this.backend = null;
				// Surface the real reason so PTY/renderer issues are diagnosable,
				// then transparently fall back to compatibility mode below.
				const detail = e instanceof Error ? e.message : String(e);
				console.error("fzSSHTermFile: native PTY failed, using fallback:", e);
				this.term?.writeln("\r\n\x1b[90m[node-pty: " + detail + "]\x1b[0m");
				new Notice("fzSSHTermFile: " + t("view.nativeFailed"));
			}
		}

		const fallback = new ChildProcessBackend(
			profile,
			settings.defaultWindowsShell,
			cwd
		);
		this.wire(fallback);
		this.activate(fallback);
		try {
			await fallback.start(size);
			this.fit();
		} catch (e) {
			this.reportError(e);
		}
	}

	private reportError(e: unknown): void {
		const msg = e instanceof Error ? e.message : String(e);
		new Notice("fzSSHTermFile: " + msg);
		this.term?.writeln("\r\n\x1b[31m" + msg + "\x1b[0m");
	}

	private scheduleFit(): void {
		// Debounce resize storms during pane drags via requestAnimationFrame.
		if (this.resizeRaf !== null) return;
		this.resizeRaf = requestAnimationFrame(() => {
			this.resizeRaf = null;
			this.fit();
		});
	}

	private fit(): void {
		if (!this.fitAddon || !this.term) return;
		try {
			this.fitAddon.fit();
			if (this.term.cols < 1 || this.term.rows < 1) return;
			this.backend?.resize({ cols: this.term.cols, rows: this.term.rows });
		} catch {
			// During layout transitions the container can have size 0.
		}
	}

	private buildTheme(): ITheme {
		// Read CSS variables from the view's own element so colors resolve
		// correctly even in pop-out windows (their own document).
		const style = getComputedStyle(this.containerEl);
		const pick = (variable: string, fallback: string): string => {
			const value = style.getPropertyValue(variable).trim();
			return value || fallback;
		};
		return {
			background: pick("--background-primary", "#1e1e1e"),
			foreground: pick("--text-normal", "#dcddde"),
			cursor: pick("--text-accent", "#ffffff"),
			selectionBackground: pick("--text-selection", "rgba(255,255,255,0.2)"),
		};
	}
}
