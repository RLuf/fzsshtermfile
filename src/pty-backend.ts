import {
	TerminalBackend,
	TerminalExitInfo,
	TerminalSize,
} from "./terminal-backend";
import { LocalProfile } from "./types";
import { resolveLocalShell } from "./shell-resolver";
import { t } from "./i18n";

// Minimal typing of node-pty (avoids depending on the package's own types).
interface IPty {
	pid: number;
	onData(cb: (data: string) => void): void;
	onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(): void;
}

interface NodePtyModule {
	spawn(
		file: string,
		args: string[],
		options: {
			name?: string;
			cols?: number;
			rows?: number;
			cwd?: string;
			env?: { [key: string]: string };
			useConpty?: boolean;
		}
	): IPty;
}

// Load node-pty at runtime (kept external in the bundle). Tries the explicit
// path inside the plugin's node_modules first (for each supported package name),
// then bare requires. node-pty is a native module that must match Obsidian's
// Electron ABI, so it is not bundled — the user installs it manually (see README)
// and we detect it here. Throws a friendly error if none is present/loadable.
function loadNodePty(pluginDir: string): NodePtyModule {
	const path = require("path") as typeof import("node:path");
	// Order matters: maintained forks first, the legacy package last.
	const packages = [
		"@homebridge/node-pty-prebuilt-multiarch",
		"@lydell/node-pty",
		"node-pty",
		"node-pty-prebuilt-multiarch",
	];

	let lastError: unknown = null;
	for (const pkg of packages) {
		const explicit = path.join(pluginDir, "node_modules", pkg);
		try {
			return require(explicit) as NodePtyModule;
		} catch (e) {
			lastError = e;
		}
		try {
			return require(pkg) as NodePtyModule;
		} catch (e) {
			lastError = e;
		}
	}

	throw new Error(
		"node-pty not found or failed to load. Install it in the plugin folder " +
			"to enable a real PTY (see the README), then reopen Obsidian. Detail: " +
			(lastError instanceof Error ? lastError.message : String(lastError))
	);
}

// High-fidelity LOCAL terminal back-end: a real PTY via node-pty. On Windows it
// opens WSL (bash) by default; on Linux/macOS it uses $SHELL.
export class LocalPtyBackend implements TerminalBackend {
	readonly localEcho = false;

	private pty: IPty | null = null;
	private dataCb: ((data: string) => void) | null = null;
	private exitCb: ((info: TerminalExitInfo) => void) | null = null;
	private disposed = false;
	// Buffer output/exit that arrive before the view attaches its callbacks, so
	// the first prompt/banner is never lost.
	private pendingData: string[] = [];
	private pendingExit: TerminalExitInfo | null = null;

	constructor(
		private readonly profile: LocalProfile,
		private readonly defaultWindowsShell: string,
		private readonly fallbackCwd: string,
		private readonly pluginDir: string
	) {}

	async start(size: TerminalSize): Promise<void> {
		const pty = loadNodePty(this.pluginDir);
		const { file, args } = resolveLocalShell(this.profile, this.defaultWindowsShell);
		const cwd = this.profile.cwd || this.fallbackCwd;

		// Sanitized env (drop undefined values; force a sane TERM). Passing the
		// live process.env can confuse some PTY backends and shares a mutable ref.
		const env: { [key: string]: string } = {};
		for (const [k, v] of Object.entries(process.env)) {
			if (typeof v === "string") env[k] = v;
		}
		env.TERM = "xterm-256color";

		this.pty = pty.spawn(file, args, {
			name: "xterm-256color",
			cols: Math.max(1, size.cols | 0),
			rows: Math.max(1, size.rows | 0),
			cwd,
			env,
			// Let node-pty choose its Windows backend. Modern node-pty defaults to
			// ConPTY (Win10 1809+), which is correct; the old useConpty:false
			// (winpty) advice is outdated and breaks input on current Node/Electron.
		});

		this.pty.onData((data) => {
			if (this.disposed) return;
			if (this.dataCb) this.dataCb(data);
			else this.pendingData.push(data);
		});
		this.pty.onExit(({ exitCode, signal }) => {
			if (this.disposed) return;
			const info: TerminalExitInfo = {
				code: exitCode,
				reason: signal ? t("exit.bySignal", signal) : t("exit.processEnded"),
			};
			if (this.exitCb) this.exitCb(info);
			else this.pendingExit = info;
		});

		const startup = this.profile.startupCommand?.trim();
		if (startup) {
			// A real PTY expects CR for Enter.
			this.pty.write(startup + "\r");
		}
	}

	write(data: string): void {
		this.pty?.write(data);
	}

	resize(size: TerminalSize): void {
		if (this.pty && size.cols > 0 && size.rows > 0) {
			this.pty.resize(size.cols, size.rows);
		}
	}

	onData(cb: (data: string) => void): void {
		this.dataCb = cb;
		if (this.pendingData.length) {
			const buffered = this.pendingData.join("");
			this.pendingData = [];
			cb(buffered);
		}
	}

	onExit(cb: (info: TerminalExitInfo) => void): void {
		this.exitCb = cb;
		if (this.pendingExit) {
			const info = this.pendingExit;
			this.pendingExit = null;
			cb(info);
		}
	}

	dispose(): void {
		this.disposed = true;
		this.dataCb = null;
		this.exitCb = null;
		try {
			this.pty?.kill();
		} catch {
			// Ignore errors killing an already-exited process.
		}
		this.pty = null;
	}
}
