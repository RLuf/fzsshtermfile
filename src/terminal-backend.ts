// Common contract between the front-end (xterm.js) and the terminal back-ends
// (local PTY, the line-editing fallback, or a remote SSH channel). TerminalView
// only knows this interface, so adding new terminal kinds later does not require
// changing the view.

export interface TerminalSize {
	cols: number;
	rows: number;
}

// Termination info delivered to the onExit() callback.
export interface TerminalExitInfo {
	code?: number; // process exit code, when available
	reason?: string; // friendly message (e.g. SSH connection error)
}

export interface TerminalBackend {
	// True when the back-end is NOT a real terminal and therefore needs the
	// front-end to provide local echo and line editing (the child_process
	// fallback). PTY and SSH back-ends are real terminals and set this false.
	readonly localEcho: boolean;

	// Start the back-end and begin producing data. The Promise rejects on an
	// initialization error (e.g. node-pty missing, SSH connect failure).
	start(size: TerminalSize): Promise<void>;

	// Send data to the process / remote terminal. For the fallback back-end this
	// receives complete lines (the front-end did the editing); for PTY/SSH it
	// receives raw keystrokes.
	write(data: string): void;

	// Inform the process/PTY/remote of a new size (columns/rows).
	resize(size: TerminalSize): void;

	// Register the callback that receives process output (stdout/stderr merged).
	onData(cb: (data: string) => void): void;

	// Register the process/connection termination callback.
	onExit(cb: (info: TerminalExitInfo) => void): void;

	// Optional: close the input stream (EOF / Ctrl+D). Implemented by back-ends
	// where it makes sense (the fallback closes child stdin).
	endInput?(): void;

	// Terminate the process/connection and release all resources.
	dispose(): void;
}

// Generates unique ids for profiles without extra dependencies (uuid, etc.).
export function generateId(): string {
	return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}
