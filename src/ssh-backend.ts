import { readFile } from "node:fs/promises";
import type {
	Client as SshClient,
	ClientChannel,
	ConnectConfig,
	SFTPWrapper,
} from "ssh2";
import {
	TerminalBackend,
	TerminalExitInfo,
	TerminalSize,
} from "./terminal-backend";
import { SshProfile, DEFAULT_SSH_PORT } from "./types";
import { t } from "./i18n";

// Subset of the ssh2 module we use (we only need the Client constructor).
interface Ssh2Module {
	Client: new () => SshClient;
}

// Lazy-load ssh2, like node-pty. Kept external in the bundle so the optional
// native ssh2 addons are not pulled in.
function loadSsh2(): Ssh2Module {
	try {
		return require("ssh2") as Ssh2Module;
	} catch (e) {
		throw new Error(
			"ssh2 not found. Run 'npm install' in the plugin folder " +
				"(see the README). Detail: " +
				(e instanceof Error ? e.message : String(e))
		);
	}
}

// REMOTE terminal back-end: connects over SSH and opens an interactive shell.
// The SAME authenticated connection is reused to open SFTP channels (hybrid FS).
export class SshBackend implements TerminalBackend {
	readonly localEcho = false;

	private client: SshClient | null = null;
	private channel: ClientChannel | null = null;
	private dataCb: ((data: string) => void) | null = null;
	private exitCb: ((info: TerminalExitInfo) => void) | null = null;
	private ready = false;
	private settled = false; // start()'s promise has resolved/rejected
	private exited = false; // exit has been reported once
	private lastSize: TerminalSize | null = null;

	constructor(private readonly profile: SshProfile) {}

	async start(size: TerminalSize): Promise<void> {
		const { Client } = loadSsh2();
		// Build the connect config (may read a key file) BEFORE creating the
		// client, so a key-read failure never leaks an unconnected Client.
		const config = await this.buildConnectConfig();

		const client = new Client();
		this.client = client;
		this.lastSize = size;

		await new Promise<void>((resolve, reject) => {
			client
				.on("ready", () => {
					// Open an interactive shell with a PTY at the current size.
					client.shell(
						{ term: "xterm-256color", cols: size.cols, rows: size.rows },
						(err, channel) => {
							if (err) {
								this.ready = false;
								this.settled = true;
								reject(err);
								return;
							}
							this.channel = channel;
							this.ready = true;

							// Remote shell stdout/stderr -> front-end.
							channel.on("data", (d: Buffer) => this.dataCb?.(d.toString("utf8")));
							channel.stderr?.on("data", (d: Buffer) =>
								this.dataCb?.(d.toString("utf8"))
							);
							channel.on("close", () => this.fireExit({ reason: t("exit.sshSessionEnded") }));

							// Apply any resize requested while connecting.
							if (this.lastSize) {
								channel.setWindow(this.lastSize.rows, this.lastSize.cols, 0, 0);
							}

							// Optional startup command (CR = Enter for a real PTY).
							const startup = this.profile.startupCommand?.trim();
							if (startup) channel.write(startup + "\r");

							this.settled = true;
							resolve();
						}
					);
				})
				.on("error", (err: Error) => {
					if (this.settled) {
						// Late error (after connect): surface it, don't drop it.
						this.dataCb?.("\r\n\x1b[31m" + t("exit.sshError", err.message) + "\x1b[0m\r\n");
						this.fireExit({ reason: t("exit.sshError", err.message) });
					} else {
						this.ready = false;
						this.settled = true;
						reject(err);
					}
				})
				.on("close", () => {
					this.ready = false;
					this.fireExit({ reason: t("exit.sshClosed") });
				});

			// Start the actual TCP/SSH connection.
			client.connect(config);
		});
	}

	write(data: string): void {
		this.channel?.write(data);
	}

	resize(size: TerminalSize): void {
		this.lastSize = size;
		if (this.channel && size.cols > 0 && size.rows > 0) {
			// ssh2 signature: setWindow(rows, cols, height, width).
			this.channel.setWindow(size.rows, size.cols, 0, 0);
		}
	}

	onData(cb: (data: string) => void): void {
		this.dataCb = cb;
	}

	onExit(cb: (info: TerminalExitInfo) => void): void {
		this.exitCb = cb;
	}

	dispose(): void {
		this.exited = true; // suppress any further exit callbacks
		try {
			this.channel?.end();
		} catch {
			// ignore
		}
		try {
			this.client?.end();
		} catch {
			// ignore
		}
		this.channel = null;
		this.client = null;
		this.ready = false;
	}

	// Open an SFTP channel reusing the already-authenticated SSH connection.
	openSftp(): Promise<SFTPWrapper> {
		return new Promise((resolve, reject) => {
			if (!this.client || !this.ready) {
				reject(new Error("SSH connection not ready for SFTP."));
				return;
			}
			this.client.sftp((err, sftp) => {
				if (err) reject(err);
				else resolve(sftp);
			});
		});
	}

	isReady(): boolean {
		return this.ready;
	}

	getProfile(): SshProfile {
		return this.profile;
	}

	// Report exit at most once (channel close and client close both fire on a
	// normal disconnect; dispose() also suppresses it).
	private fireExit(info: TerminalExitInfo): void {
		if (this.exited) return;
		this.exited = true;
		this.exitCb?.(info);
	}

	// Build the ssh2 connect config from the profile, reading the private key
	// from disk when provided. Accepts password and/or key.
	private async buildConnectConfig(): Promise<ConnectConfig> {
		const config: ConnectConfig = {
			host: this.profile.host,
			port: this.profile.port || DEFAULT_SSH_PORT,
			username: this.profile.username,
			// Keep the session alive and detect dead links within a bounded time.
			keepaliveInterval: 15000,
			keepaliveCountMax: 3,
		};

		if (this.profile.password) {
			config.password = this.profile.password;
		}

		if (this.profile.privateKeyPath) {
			config.privateKey = await readFile(this.profile.privateKeyPath);
			if (this.profile.passphrase) {
				config.passphrase = this.profile.passphrase;
			}
		}

		return config;
	}
}
