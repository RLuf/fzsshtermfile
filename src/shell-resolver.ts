import { Platform } from "obsidian";
import { LocalProfile } from "./types";
import { resolveCommandLine } from "./command-line";

// Decide which shell executable to launch and with which arguments, based on the
// platform and the profile. Shared by the local back-ends (PTY and fallback).
// An empty shell field means automatic detection.
//
// Both the per-profile `shell` field and the global `defaultWindowsShell` accept
// a FULL command line (e.g. "pwsh.exe -c wsl.exe"); it is tokenized — honoring
// quotes — into an executable plus argv. Any `profile.args` are appended after.
export function resolveLocalShell(
	profile: LocalProfile,
	defaultWindowsShell: string
): { file: string; args: string[] } {
	const extraArgs = profile.args ?? [];

	// 1) Explicit shell/command line on the profile has top priority.
	const explicit = (profile.shell ?? "").trim();
	if (explicit.length > 0) {
		return resolveCommandLine(explicit, extraArgs);
	}

	// 2) Windows: use the default Windows shell from settings (wsl by default).
	if (Platform.isWin) {
		const raw = (defaultWindowsShell || "").trim();
		const choice = (raw || "wsl").toLowerCase();

		if (choice === "wsl") {
			// Open the bash of the default WSL distribution.
			return { file: "wsl.exe", args: extraArgs };
		}
		if (choice === "pwsh" || choice === "powershell") {
			// -NoLogo keeps the fallback session clean; overridable via args.
			return {
				file: choice + ".exe",
				args: extraArgs.length ? extraArgs : ["-NoLogo"],
			};
		}
		if (choice === "cmd") {
			return { file: "cmd.exe", args: extraArgs };
		}
		// Custom value: treat it as a full command line (path + flags).
		return resolveCommandLine(raw, extraArgs);
	}

	// 3) Linux/macOS: use $SHELL (login shell) or fall back to /bin/bash.
	const shell = process.env.SHELL || "/bin/bash";
	return { file: shell, args: extraArgs.length ? extraArgs : ["-l"] };
}
