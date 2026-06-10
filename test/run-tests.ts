// Standalone behavior tests for the pure logic modules (no Obsidian runtime).
// Bundled with esbuild and run under Node. Exits non-zero on any failure.
import { tokenizeCommandLine, resolveCommandLine } from "../src/command-line";
import { LineEditor } from "../src/line-editor";

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok   ${label}`);
	} else {
		failures++;
		console.log(`  FAIL ${label}\n        expected ${e}\n        actual   ${a}`);
	}
}

console.log("tokenizeCommandLine / resolveCommandLine:");
eq("simple", tokenizeCommandLine("pwsh.exe -c wsl.exe"), ["pwsh.exe", "-c", "wsl.exe"]);
eq(
	"quoted path with spaces",
	tokenizeCommandLine('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo'),
	["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "-NoLogo"]
);
eq("single-quoted group", tokenizeCommandLine("-c 'wsl -d Ubuntu'"), ["-c", "wsl -d Ubuntu"]);
eq("empty string", tokenizeCommandLine(""), []);
eq("backslash kept literal", tokenizeCommandLine("C:\\Users\\me\\bin"), ["C:\\Users\\me\\bin"]);
eq(
	"resolve splits file+args",
	resolveCommandLine("pwsh.exe -c wsl.exe"),
	{ file: "pwsh.exe", args: ["-c", "wsl.exe"] }
);
eq(
	"resolve appends extra args",
	resolveCommandLine("wsl.exe", ["-d", "Ubuntu"]),
	{ file: "wsl.exe", args: ["-d", "Ubuntu"] }
);

console.log("LineEditor:");
// Helper: drive a LineEditor and collect the lines it submits.
function run(steps: string[]): string[] {
	const lines: string[] = [];
	const ed = new LineEditor({
		write: () => {}, // discard echo
		onLine: (l) => lines.push(l),
	});
	for (const s of steps) ed.feed(s);
	return lines;
}

eq("plain line", run(["ls -la\r"]), ["ls -la"]);
eq("backspace deletes last char", run(["abc", "\x7f", "d", "\r"]), ["abd"]);
eq("BS (0x08) also deletes", run(["abc", "\x08", "\r"]), ["ab"]);
eq("backspace at start is no-op", run(["\x7f", "x", "\r"]), ["x"]);
eq("cursor-left then insert", run(["ac", "\x1b[D", "b", "\r"]), ["abc"]);
eq("home then insert", run(["bc", "\x1b[H", "a", "\r"]), ["abc"]);
eq("delete-forward", run(["abc", "\x1b[D", "\x1b[3~", "\r"]), ["ab"]);
eq("ctrl+u clears line", run(["xyz", "\x15", "q", "\r"]), ["q"]);
eq("ctrl+w deletes word", run(["foo bar", "\x17", "\r"]), ["foo "]);
eq("crlf submits once", run(["hi\r\n"]), ["hi"]);
eq("two lines in one paste", run(["a\nb\n"]), ["a", "b"]);
eq(
	"history up recalls previous",
	run(["first\r", "second\r", "\x1b[A", "\x1b[A", "\r"]),
	["first", "second", "first"]
);

console.log("");
if (failures === 0) {
	console.log("ALL TESTS PASSED");
	process.exit(0);
} else {
	console.log(`${failures} TEST(S) FAILED`);
	process.exit(1);
}
