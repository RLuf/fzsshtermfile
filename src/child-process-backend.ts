import { Platform } from "obsidian";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
	TerminalBackend,
	TerminalExitInfo,
	TerminalSize,
} from "./terminal-backend";
import { LocalProfile } from "./types";
import { resolveLocalShell } from "./shell-resolver";
import { t } from "./i18n";

// LOCAL FALLBACK back-end: opens the shell via child_process (pipes), with no
// native module. Works on any install (including straight from the store, before
// node-pty is present). Because a pipe is not a real TTY, line editing/echo is
// provided by the front-end (LineEditor) and complete lines are written here;
// fully interactive TUIs (vim, htop, Claude Code's UI) need the PTY back-end.
export class ChildProcessBackend implements TerminalBackend {
	readonly localEcho = true;

	private proc: ChildProcessWithoutNullStreams | null = null;
	private dataCb: ((data: string) => void) | null = null;
	private exitCb: ((info: TerminalExitInfo) => void) | null = null;
	private disposed = false;

	constructor(
		private readonly profile: LocalProfile,
		private readonly defaultWindowsShell: string,
		private readonly fallbackCwd: string
	) {}

	async start(size: TerminalSize): Promise<void> {
		const cp = require("child_process") as typeof import("node:child_process");
		const { file, args } = resolveLocalShell(this.profile, this.defaultWindowsShell);
		const cwd = this.profile.cwd || this.fallbackCwd;

		// No TTY for resize, so pass dimensions via env (COLUMNS/LINES). Many
		// shells ignore these over a pipe, but harmless to provide.
		const env: NodeJS.ProcessEnv = {
			...process.env,
			TERM: "xterm-256color",
			COLUMNS: String(Math.max(1, size.cols)),
			LINES: String(Math.max(1, size.rows)),
		};

		this.proc = cp.spawn(file, args, { cwd, env, windowsHide: true });

		// setEncoding('utf8') makes Node buffer partial multibyte sequences across
		// chunks, so accented characters / box-drawing glyphs are not corrupted.
		this.proc.stdout.setEncoding("utf8");
		this.proc.stderr.setEncoding("utf8");
		this.proc.stdout.on("data", (d: string) => {
			if (!this.disposed) this.dataCb?.(d);
		});
		this.proc.stderr.on("data", (d: string) => {
			if (!this.disposed) this.dataCb?.(d);
		});
		this.proc.on("exit", (code: number | null, signal: string | null) => {
			if (this.disposed) return;
			this.exitCb?.({
				code: code ?? undefined,
				reason: signal
					? t("exit.bySignal", signal)
					: t("exit.processEndedCompat"),
			});
		});
		this.proc.on("error", (err: Error) => {
			if (this.disposed) return;
			// Surface the failure both visually and through the exit lifecycle, so
			// a bad shell path does not leave a silently-dead pane.
			this.dataCb?.("\r\n\x1b[31m" + t("view.shellOpenError", err.message) + "\x1b[0m\r\n");
			this.exitCb?.({ reason: t("view.shellOpenError", err.message) });
		});

		const startup = this.profile.startupCommand?.trim();
		if (startup) {
			this.proc.stdin.write(startup + "\n");
		}
	}

	write(data: string): void {
		try {
			this.proc?.stdin.write(data);
		} catch {
			// stdin may already be closed.
		}
	}

	endInput(): void {
		try {
			this.proc?.stdin.end();
		} catch {
			// already closed
		}
	}

	resize(_size: TerminalSize): void {
		// No real TTY, so no PTY resize. Intentional no-op (documented limitation).
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
		const proc = this.proc;
		this.proc = null;
		if (!proc) return;
		try {
			proc.stdout.removeAllListeners();
			proc.stderr.removeAllListeners();
			proc.removeAllListeners();
		} catch {
			// ignore
		}
		try {
			if (Platform.isWin && typeof proc.pid === "number") {
				// SIGTERM often leaves the Windows child tree (e.g. wsl.exe → distro)
				// orphaned; taskkill /T kills the whole tree.
				const cp = require("child_process") as typeof import("node:child_process");
				cp.spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
					windowsHide: true,
				});
			} else {
				proc.kill();
			}
		} catch {
			// process may already have exited
		}
	}
}
