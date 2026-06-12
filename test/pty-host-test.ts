// End-to-end test of the PTY host: spawn `node -e <host source>`, send init over
// stdin, expect {ready}, then run a command and confirm its echo comes back —
// proving a real PTY (the shell's own line discipline) is active.
import { PTY_HOST_SOURCE } from "../src/pty-host-source";
import { spawn } from "node:child_process";

const modulePath =
	"C:/Users/noob/OneDrive/Documentos/Obsidian Vault/.obsidian/plugins/fztermfile/node_modules/@lydell/node-pty";

const proc = spawn(process.execPath, ["-e", PTY_HOST_SOURCE], { windowsHide: true });
let buf = "";
let out = "";
let gotReady = false;
let gotData = false;
let gotEcho = false;

proc.stdout.setEncoding("utf8");
proc.stdout.on("data", (chunk: string) => {
	buf += chunk;
	let i: number;
	while ((i = buf.indexOf("\n")) >= 0) {
		const line = buf.slice(0, i);
		buf = buf.slice(i + 1);
		if (!line) continue;
		let m: { t: string; [k: string]: unknown };
		try {
			m = JSON.parse(line);
		} catch {
			continue;
		}
		if (m.t === "ready") {
			gotReady = true;
			proc.stdin.write(
				JSON.stringify({
					t: "data",
					d: Buffer.from("echo hostptyok123\r", "utf8").toString("base64"),
				}) + "\n"
			);
		} else if (m.t === "data") {
			gotData = true;
			out += Buffer.from(String(m.d), "base64").toString("utf8");
			if (out.includes("hostptyok123")) gotEcho = true;
		} else if (m.t === "fatal") {
			console.log("FATAL: " + String(m.m));
			process.exit(1);
		}
	}
});
proc.stderr.setEncoding("utf8");
proc.stderr.on("data", (d: string) => process.stderr.write("[host stderr] " + d));
proc.on("error", (e: Error) => {
	console.log("PROC ERROR: " + e.message);
	process.exit(1);
});

proc.stdin.write(
	JSON.stringify({
		t: "init",
		modulePath,
		file: "pwsh.exe",
		args: ["-NoLogo"],
		cols: 80,
		rows: 24,
		cwd: "C:/Users/noob",
	}) + "\n"
);

setTimeout(() => {
	console.log("ready=" + gotReady + " data=" + gotData + " echo=" + gotEcho);
	console.log(gotReady && gotData && gotEcho ? "PTY_HOST_TEST_PASS" : "PTY_HOST_TEST_FAIL");
	try {
		proc.stdin.write(JSON.stringify({ t: "kill" }) + "\n");
		proc.kill();
	} catch {
		/* ignore */
	}
	process.exit(gotReady && gotEcho ? 0 : 1);
}, 4000);
