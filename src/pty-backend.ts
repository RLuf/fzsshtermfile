import { Platform } from "obsidian";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
	TerminalBackend,
	TerminalExitInfo,
	TerminalSize,
} from "./terminal-backend";
import { LocalProfile } from "./types";
import { resolveLocalShell } from "./shell-resolver";
import { PTY_HOST_SOURCE } from "./pty-host-source";
import { t } from "./i18n";

// node-pty packages the runtime loader knows how to require, best first.
const SUPPORTED_PACKAGES = [
	"@lydell/node-pty",
	"@homebridge/node-pty-prebuilt-multiarch",
	"node-pty",
	"node-pty-prebuilt-multiarch",
];

// High-fidelity LOCAL terminal back-end: a real PTY via node-pty, run in a
// SEPARATE Node process (the "PTY host").
//
// node-pty cannot run in the Obsidian renderer because ConPTY needs a Worker
// thread and the renderer's V8 platform forbids Workers ("Failed to construct
// 'Worker'"). So we spawn the user's Node (`node -e <embedded host source>`) and
// proxy the terminal over stdio as newline-delimited JSON. This mirrors how the
// community "Terminal" plugin bridges through an external runtime. Nothing is
// downloaded and nothing executable is written to disk — the host is the
// plugin's own code passed via -e. If Node or node-pty is unavailable, start()
// rejects and the view falls back to compatibility mode.
export class LocalPtyBackend implements TerminalBackend {
	readonly localEcho = false;

	private proc: ChildProcessWithoutNullStreams | null = null;
	private dataCb: ((data: string) => void) | null = null;
	private exitCb: ((info: TerminalExitInfo) => void) | null = null;
	private disposed = false;

	private outBuf = ""; // stdout line buffer (NDJSON)
	private stderrTail = ""; // last stderr for diagnostics
	private settled = false; // start() promise settled
	private exitReported = false;
	private readyResolve: (() => void) | null = null;
	private readyReject: ((e: Error) => void) | null = null;
	private readyTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly profile: LocalProfile,
		private readonly defaultWindowsShell: string,
		private readonly fallbackCwd: string,
		private readonly pluginDir: string
	) {}

	async start(size: TerminalSize): Promise<void> {
		const cp = require("child_process") as typeof import("node:child_process");
		const { file, args } = resolveLocalShell(this.profile, this.defaultWindowsShell);
		const cwd = this.profile.cwd || this.fallbackCwd;
		const modulePath = this.resolveModulePath(); // throws if node-pty missing
		const nodeExec = this.resolveNodeExec();

		// Sanitized env for the SHELL (drop undefined; force TERM; never leak the
		// host-only ELECTRON_RUN_AS_NODE into the child).
		const env: { [key: string]: string } = {};
		for (const [k, v] of Object.entries(process.env)) {
			if (typeof v === "string") env[k] = v;
		}
		env.TERM = "xterm-256color";
		delete env.ELECTRON_RUN_AS_NODE;

		this.proc = cp.spawn(nodeExec, ["-e", PTY_HOST_SOURCE], { windowsHide: true });
		this.proc.stdout.setEncoding("utf8");
		this.proc.stderr.setEncoding("utf8");
		this.proc.stdout.on("data", (chunk: string) => this.onHostStdout(chunk));
		this.proc.stderr.on("data", (chunk: string) => {
			this.stderrTail = (this.stderrTail + chunk).slice(-2000);
		});
		this.proc.on("error", (err: Error) => this.onHostError(err));
		this.proc.on("exit", (code: number | null) => this.onHostProcExit(code));

		// Send the init message (config + sanitized env) over stdin.
		const init = {
			t: "init",
			modulePath,
			file,
			args,
			cols: Math.max(1, size.cols | 0),
			rows: Math.max(1, size.rows | 0),
			cwd,
			env,
		};
		try {
			this.proc.stdin.write(JSON.stringify(init) + "\n");
		} catch (e) {
			throw new Error("PTY host stdin write failed: " + (e instanceof Error ? e.message : String(e)));
		}

		// Resolve on {t:"ready"}, reject on {t:"fatal"} / early exit / timeout.
		await new Promise<void>((resolve, reject) => {
			this.readyResolve = resolve;
			this.readyReject = reject;
			this.readyTimer = setTimeout(() => {
				this.settleReject(
					new Error(
						"PTY host did not become ready in time (is Node.js installed and on PATH?)"
					)
				);
			}, 10000);
		});
	}

	write(data: string): void {
		if (!this.proc || this.disposed) return;
		try {
			this.proc.stdin.write(
				JSON.stringify({ t: "data", d: Buffer.from(data, "utf8").toString("base64") }) + "\n"
			);
		} catch {
			// host stdin may be closed
		}
	}

	resize(size: TerminalSize): void {
		if (!this.proc || this.disposed || size.cols < 1 || size.rows < 1) return;
		try {
			this.proc.stdin.write(
				JSON.stringify({ t: "resize", cols: size.cols, rows: size.rows }) + "\n"
			);
		} catch {
			// ignore
		}
	}

	onData(cb: (data: string) => void): void {
		this.dataCb = cb;
	}

	onExit(cb: (info: TerminalExitInfo) => void): void {
		this.exitCb = cb;
	}

	dispose(): void {
		this.disposed = true;
		this.dataCb = null;
		this.exitCb = null;
		if (this.readyTimer) {
			clearTimeout(this.readyTimer);
			this.readyTimer = null;
		}
		const proc = this.proc;
		this.proc = null;
		if (!proc) return;
		try {
			proc.stdin.write(JSON.stringify({ t: "kill" }) + "\n");
		} catch {
			// ignore
		}
		try {
			proc.kill();
		} catch {
			// already exited
		}
	}

	// --- Host I/O ------------------------------------------------------------

	private onHostStdout(chunk: string): void {
		this.outBuf += chunk;
		let idx: number;
		while ((idx = this.outBuf.indexOf("\n")) >= 0) {
			const line = this.outBuf.slice(0, idx);
			this.outBuf = this.outBuf.slice(idx + 1);
			if (!line) continue;
			let msg: { t: string; [k: string]: unknown };
			try {
				msg = JSON.parse(line);
			} catch {
				continue;
			}
			this.handleHostMessage(msg);
		}
	}

	private handleHostMessage(msg: { t: string; [k: string]: unknown }): void {
		switch (msg.t) {
			case "ready":
				this.settleResolve();
				return;
			case "fatal":
				this.settleReject(new Error("PTY host: " + String(msg.m ?? "unknown") + this.tail()));
				return;
			case "data": {
				if (this.disposed) return;
				const b64 = typeof msg.d === "string" ? msg.d : "";
				this.dataCb?.(Buffer.from(b64, "base64").toString("utf8"));
				return;
			}
			case "exit": {
				const code = typeof msg.code === "number" ? msg.code : undefined;
				const signal = typeof msg.signal === "number" ? msg.signal : undefined;
				this.reportExit({
					code,
					reason: signal ? t("exit.bySignal", signal) : t("exit.processEnded"),
				});
				return;
			}
			default:
				return;
		}
	}

	private onHostError(err: Error): void {
		if (!this.settled) {
			this.settleReject(
				new Error("PTY host could not start (" + err.message + ")" + this.tail())
			);
		} else {
			this.reportExit({ reason: err.message });
		}
	}

	private onHostProcExit(code: number | null): void {
		if (!this.settled) {
			this.settleReject(
				new Error("PTY host exited (code " + String(code) + ")" + this.tail())
			);
		} else {
			this.reportExit({ code: code ?? undefined, reason: t("exit.processEnded") });
		}
	}

	private reportExit(info: TerminalExitInfo): void {
		if (this.exitReported || this.disposed) return;
		this.exitReported = true;
		this.exitCb?.(info);
	}

	private settleResolve(): void {
		if (this.settled) return;
		this.settled = true;
		if (this.readyTimer) {
			clearTimeout(this.readyTimer);
			this.readyTimer = null;
		}
		this.readyResolve?.();
	}

	private settleReject(err: Error): void {
		if (this.settled) return;
		this.settled = true;
		if (this.readyTimer) {
			clearTimeout(this.readyTimer);
			this.readyTimer = null;
		}
		this.readyReject?.(err);
	}

	private tail(): string {
		const s = this.stderrTail.trim();
		return s ? " — " + s : "";
	}

	// Find an installed node-pty package directory inside the plugin folder.
	private resolveModulePath(): string {
		const path = require("path") as typeof import("node:path");
		const fs = require("fs") as typeof import("node:fs");
		for (const pkg of SUPPORTED_PACKAGES) {
			const dir = path.join(this.pluginDir, "node_modules", pkg);
			try {
				if (fs.existsSync(path.join(dir, "package.json"))) return dir;
			} catch {
				// keep looking
			}
		}
		throw new Error(
			"node-pty not installed in the plugin folder. Install it to enable a " +
				"real PTY (see the README), then reopen Obsidian."
		);
	}

	// Find a Node executable to host node-pty. Prefers known absolute locations
	// (since the Obsidian renderer's PATH may be minimal), then falls back to PATH.
	private resolveNodeExec(): string {
		const fs = require("fs") as typeof import("node:fs");
		const candidates: string[] = [];
		const envNode = process.env.FZ_TERMFILE_NODE;
		if (envNode) candidates.push(envNode);
		if (Platform.isWin) {
			if (process.env.ProgramFiles) candidates.push(process.env.ProgramFiles + "\\nodejs\\node.exe");
			candidates.push("C:\\Program Files\\nodejs\\node.exe");
			if (process.env.LOCALAPPDATA)
				candidates.push(process.env.LOCALAPPDATA + "\\Programs\\nodejs\\node.exe");
		} else {
			candidates.push("/usr/local/bin/node", "/usr/bin/node", "/opt/homebrew/bin/node");
		}
		for (const c of candidates) {
			try {
				if (c && fs.existsSync(c)) return c;
			} catch {
				// keep looking
			}
		}
		return Platform.isWin ? "node.exe" : "node"; // last resort: rely on PATH
	}
}
