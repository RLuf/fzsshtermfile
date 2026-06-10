// Quote-aware command-line parsing shared by the shell resolver and the profile
// UI. The goal is that a single text field can accept a full command line such
// as `pwsh.exe -c wsl.exe` or `"C:\Program Files\PowerShell\7\pwsh.exe" -NoLogo`
// and be split into an executable + argv that child_process / node-pty accept.
//
// Design choice: backslash is NOT treated as an escape character. On Windows it
// is a path separator (C:\Users\…), so escaping would break the common case.
// Grouping of arguments containing spaces is done with single or double quotes,
// which is what users expect on both Windows and POSIX shells.

// Split a command-line string into tokens, honoring single and double quotes.
// Empty quotes ("") produce an explicit empty-string token. Whitespace (spaces
// and tabs) separates tokens outside of quotes.
export function tokenizeCommandLine(input: string): string[] {
	const tokens: string[] = [];
	let cur = "";
	let started = false; // whether the current token has any content yet
	let inSingle = false;
	let inDouble = false;

	for (const ch of input) {
		if (inSingle) {
			if (ch === "'") inSingle = false;
			else cur += ch;
			continue;
		}
		if (inDouble) {
			if (ch === '"') inDouble = false;
			else cur += ch;
			continue;
		}
		if (ch === "'") {
			inSingle = true;
			started = true;
			continue;
		}
		if (ch === '"') {
			inDouble = true;
			started = true;
			continue;
		}
		if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
			if (started) {
				tokens.push(cur);
				cur = "";
				started = false;
			}
			continue;
		}
		cur += ch;
		started = true;
	}
	if (started) tokens.push(cur);
	return tokens;
}

// Resolve a command-line string plus optional extra arguments into the
// { file, args } shape expected by the terminal backends. The first token is
// the executable; remaining tokens, followed by any extraArgs, are the argv.
export function resolveCommandLine(
	commandLine: string,
	extraArgs: string[] = []
): { file: string; args: string[] } {
	const tokens = tokenizeCommandLine(commandLine.trim());
	const file = tokens[0] ?? "";
	const args = [...tokens.slice(1), ...extraArgs];
	return { file, args };
}
