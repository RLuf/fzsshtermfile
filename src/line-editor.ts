// Plugin-side "cooked mode" line editor for the no-TTY fallback backend.
//
// When the native PTY is unavailable, the shell is spawned with piped stdio
// instead of a real terminal. A pipe has no line discipline, so the shell does
// not echo typed characters and does not interpret Backspace — which is exactly
// why backspace "did not work" in pwsh.exe. This editor restores a usable
// experience entirely on the front-end: it echoes keystrokes to xterm.js, lets
// the user edit the current line (Backspace/Delete, cursor moves, history), and
// only hands a COMPLETE line to the shell's stdin when Enter is pressed.
//
// Limitation: this is a line-oriented editor, so full-screen TUI programs
// (vim, htop, Claude Code's interactive UI) are NOT supported in fallback mode —
// those require the real PTY backend. Plain commands and scripts work well.

// Callbacks wired by the consumer (TerminalView).
export interface LineEditorHooks {
	// Write raw bytes/escape sequences to the xterm.js terminal (the echo).
	write(data: string): void;
	// A full line was submitted with Enter (without the trailing newline).
	onLine(line: string): void;
	// Ctrl+C pressed: the current input line is abandoned.
	onInterrupt?: () => void;
	// Ctrl+D pressed on an empty line: end-of-input.
	onEof?: () => void;
}

// Escape sequences we recognize, longest-first so e.g. "\x1b[1~" is matched
// before any shorter prefix. Names map to editor actions.
const ESCAPES: ReadonlyArray<readonly [string, string]> = [
	["\x1b[1~", "home"],
	["\x1b[4~", "end"],
	["\x1b[7~", "home"],
	["\x1b[8~", "end"],
	["\x1b[3~", "delete"],
	["\x1b[2~", "insert"], // ignored
	["\x1b[A", "up"],
	["\x1b[B", "down"],
	["\x1b[C", "right"],
	["\x1b[D", "left"],
	["\x1b[H", "home"],
	["\x1b[F", "end"],
	["\x1bOA", "up"],
	["\x1bOB", "down"],
	["\x1bOC", "right"],
	["\x1bOD", "left"],
	["\x1bOH", "home"],
	["\x1bOF", "end"],
];

export class LineEditor {
	private buf = "";
	private cursor = 0; // 0..buf.length
	private readonly history: string[] = [];
	private historyIndex: number | null = null; // null = editing a fresh line
	private pending = ""; // the in-progress line stashed while browsing history

	constructor(private readonly hooks: LineEditorHooks) {}

	// Feed raw xterm.js input (one or more keystrokes / a paste) into the editor.
	feed(data: string): void {
		let i = 0;
		while (i < data.length) {
			const ch = data[i] as string;

			// Enter: accept "\r", "\n" or "\r\n" as a single submit.
			if (ch === "\r") {
				this.submit();
				if (data[i + 1] === "\n") i++;
				i++;
				continue;
			}
			if (ch === "\n") {
				this.submit();
				i++;
				continue;
			}

			// Escape sequences (arrow keys, Home/End, Delete).
			if (ch === "\x1b") {
				const match = this.matchEscape(data, i);
				if (match) {
					this.handleAction(match[1]);
					i += match[0].length;
					continue;
				}
				// Unknown escape: drop the ESC byte and continue.
				i++;
				continue;
			}

			this.handleChar(ch);
			i++;
		}
	}

	// Discard the current line buffer (e.g. when the backend exits). Does not
	// emit anything to the shell.
	reset(): void {
		this.buf = "";
		this.cursor = 0;
		this.historyIndex = null;
		this.pending = "";
	}

	// --- Input dispatch ------------------------------------------------------

	private handleChar(ch: string): void {
		const code = ch.charCodeAt(0);
		switch (code) {
			case 0x7f: // DEL (xterm Backspace)
			case 0x08: // BS
				this.backspace();
				return;
			case 0x03: // Ctrl+C
				this.interrupt();
				return;
			case 0x15: // Ctrl+U: kill whole line
				this.killLine();
				return;
			case 0x0b: // Ctrl+K: kill to end of line
				this.killToEnd();
				return;
			case 0x17: // Ctrl+W: delete previous word
				this.deleteWord();
				return;
			case 0x01: // Ctrl+A: home
				this.home();
				return;
			case 0x05: // Ctrl+E: end
				this.end();
				return;
			case 0x04: // Ctrl+D: EOF on empty line, else delete-forward
				if (this.buf.length === 0) this.hooks.onEof?.();
				else this.deleteForward();
				return;
			case 0x09: // Tab: no completion in cooked mode
			case 0x0c: // Ctrl+L: ignored (no screen clear in line mode)
				return;
			default:
				if (code >= 0x20) this.insert(ch); // printable
				return;
		}
	}

	private handleAction(action: string): void {
		switch (action) {
			case "left":
				this.left();
				return;
			case "right":
				this.right();
				return;
			case "home":
				this.home();
				return;
			case "end":
				this.end();
				return;
			case "delete":
				this.deleteForward();
				return;
			case "up":
				this.historyPrev();
				return;
			case "down":
				this.historyNext();
				return;
			default:
				return; // insert and anything else: ignore
		}
	}

	// --- Editing primitives --------------------------------------------------

	private insert(ch: string): void {
		this.buf = this.buf.slice(0, this.cursor) + ch + this.buf.slice(this.cursor);
		const tail = this.buf.slice(this.cursor + 1);
		this.hooks.write(ch + tail);
		if (tail.length) this.hooks.write("\x1b[" + tail.length + "D");
		this.cursor++;
	}

	private backspace(): void {
		if (this.cursor === 0) return;
		this.cursor--;
		const tail = this.buf.slice(this.cursor + 1);
		this.buf = this.buf.slice(0, this.cursor) + tail;
		// Move left, rewrite the tail, erase the now-stray last cell, reposition.
		this.hooks.write("\b" + tail + " " + "\x1b[" + (tail.length + 1) + "D");
	}

	private deleteForward(): void {
		if (this.cursor >= this.buf.length) return;
		const tail = this.buf.slice(this.cursor + 1);
		this.buf = this.buf.slice(0, this.cursor) + tail;
		this.hooks.write(tail + " " + "\x1b[" + (tail.length + 1) + "D");
	}

	private left(): void {
		if (this.cursor > 0) {
			this.cursor--;
			this.hooks.write("\x1b[D");
		}
	}

	private right(): void {
		if (this.cursor < this.buf.length) {
			this.cursor++;
			this.hooks.write("\x1b[C");
		}
	}

	private home(): void {
		if (this.cursor > 0) {
			this.hooks.write("\x1b[" + this.cursor + "D");
			this.cursor = 0;
		}
	}

	private end(): void {
		const delta = this.buf.length - this.cursor;
		if (delta > 0) {
			this.hooks.write("\x1b[" + delta + "C");
			this.cursor = this.buf.length;
		}
	}

	private killLine(): void {
		this.replaceLine("");
	}

	private killToEnd(): void {
		if (this.cursor >= this.buf.length) return;
		this.buf = this.buf.slice(0, this.cursor);
		this.hooks.write("\x1b[K"); // erase from cursor to end of line
	}

	private deleteWord(): void {
		if (this.cursor === 0) return;
		let start = this.cursor;
		// Skip trailing spaces, then the word.
		while (start > 0 && this.buf[start - 1] === " ") start--;
		while (start > 0 && this.buf[start - 1] !== " ") start--;
		const removed = this.cursor - start;
		const tail = this.buf.slice(this.cursor);
		this.buf = this.buf.slice(0, start) + tail;
		this.hooks.write("\x1b[" + removed + "D"); // move to new position
		this.hooks.write(tail + " ".repeat(removed));
		this.hooks.write("\x1b[" + (tail.length + removed) + "D");
		this.cursor = start;
	}

	private interrupt(): void {
		this.hooks.write("^C\r\n");
		this.buf = "";
		this.cursor = 0;
		this.historyIndex = null;
		this.hooks.onInterrupt?.();
	}

	private submit(): void {
		this.hooks.write("\r\n");
		const line = this.buf;
		if (line.trim().length > 0) {
			// De-duplicate consecutive identical history entries.
			if (this.history[this.history.length - 1] !== line) {
				this.history.push(line);
			}
		}
		this.buf = "";
		this.cursor = 0;
		this.historyIndex = null;
		this.pending = "";
		this.hooks.onLine(line);
	}

	// --- History -------------------------------------------------------------

	private historyPrev(): void {
		if (this.history.length === 0) return;
		if (this.historyIndex === null) {
			this.pending = this.buf;
			this.historyIndex = this.history.length - 1;
		} else if (this.historyIndex > 0) {
			this.historyIndex--;
		} else {
			return;
		}
		this.replaceLine(this.history[this.historyIndex] ?? "");
	}

	private historyNext(): void {
		if (this.historyIndex === null) return;
		if (this.historyIndex < this.history.length - 1) {
			this.historyIndex++;
			this.replaceLine(this.history[this.historyIndex] ?? "");
		} else {
			this.historyIndex = null;
			this.replaceLine(this.pending);
		}
	}

	// Clear the visible line and replace it with newText, cursor at end.
	private replaceLine(newText: string): void {
		if (this.cursor > 0) this.hooks.write("\x1b[" + this.cursor + "D");
		this.hooks.write("\x1b[K");
		this.hooks.write(newText);
		this.buf = newText;
		this.cursor = newText.length;
	}

	// --- Escape matching -----------------------------------------------------

	private matchEscape(data: string, at: number): readonly [string, string] | null {
		for (const entry of ESCAPES) {
			if (data.startsWith(entry[0], at)) return entry;
		}
		return null;
	}
}
