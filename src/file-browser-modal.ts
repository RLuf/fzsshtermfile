import { App, Modal, Notice } from "obsidian";
import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { FileEntry, SFTPWrapper } from "ssh2";
import { SshBackend } from "./ssh-backend";
import { t } from "./i18n";
// import type avoids a runtime dependency cycle.
import type FzTermFilePlugin from "./main";

// Normalized entry (name + whether it is a directory) valid for both local and
// remote listings.
interface Entry {
	name: string;
	isDir: boolean;
}

// Decide whether an SFTP entry is a directory using the POSIX mode type bits
// (S_IFDIR); falls back to the `longname` ("ls -l") leading 'd'.
function isDirEntry(f: FileEntry): boolean {
	const S_IFMT = 0o170000;
	const S_IFDIR = 0o040000;
	if (f.attrs && typeof f.attrs.mode === "number") {
		return (f.attrs.mode & S_IFMT) === S_IFDIR;
	}
	return typeof f.longname === "string" && f.longname.charAt(0) === "d";
}

// Small confirm dialog (Overwrite / Cancel) used to guard against data loss.
class ConfirmModal extends Modal {
	private decided = false;
	constructor(
		app: App,
		private readonly message: string,
		private readonly confirmLabel: string,
		private readonly onResult: (ok: boolean) => void
	) {
		super(app);
	}
	onOpen(): void {
		this.contentEl.empty();
		this.contentEl.createEl("p", { text: this.message });
		const row = this.contentEl.createDiv({ cls: "fztermfile-confirm-row" });
		const cancel = row.createEl("button", { text: t("modal.cancel") });
		const ok = row.createEl("button", { text: this.confirmLabel });
		ok.addClass("mod-warning");
		cancel.onclick = () => this.finish(false);
		ok.onclick = () => this.finish(true);
	}
	onClose(): void {
		// If dismissed via Esc/overlay, treat as cancel.
		this.finish(false);
		this.contentEl.empty();
	}
	private finish(ok: boolean): void {
		if (this.decided) return;
		this.decided = true;
		this.onResult(ok);
		this.close();
	}
}

// HYBRID file browser: toggles between the LOCAL file system (node:fs) and the
// REMOTE one (SFTP, reusing the active SSH session), allowing download
// (remote -> local folder) and upload (local -> remote).
export class FileBrowserModal extends Modal {
	private source: "local" | "remote";
	private localPath: string;
	private remotePath: string;
	private sftp: SFTPWrapper | null = null;
	private listEl: HTMLElement | null = null;
	private pathEl: HTMLElement | null = null;
	// Sequence token so a slow listing cannot overwrite a newer one.
	private reqSeq = 0;

	constructor(
		app: App,
		private readonly plugin: FzTermFilePlugin,
		// Active SSH session (or null when no SSH terminal is open).
		private readonly remote: SshBackend | null
	) {
		super(app);
		this.localPath = resolve(plugin.getVaultBasePath() || homedir());
		this.remotePath = remote ? remote.getProfile().remoteHome || "." : ".";
		// Start on the remote side if there is a session; otherwise local.
		this.source = remote ? "remote" : "local";
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("fztermfile-fs");
		contentEl.createEl("h2", { text: t("fs.title") });

		// Source switch: Local <-> Remote.
		const switcher = contentEl.createDiv({ cls: "fztermfile-fs-switch" });
		const localBtn = switcher.createEl("button", { text: t("fs.local") });
		const remoteLabel = this.remote
			? t("fs.remotePrefix", this.remote.getProfile().name)
			: t("fs.remoteNoSession");
		const remoteBtn = switcher.createEl("button", { text: remoteLabel });
		remoteBtn.disabled = !this.remote;
		localBtn.onclick = () => void this.setSource("local");
		remoteBtn.onclick = () => void this.setSource("remote");

		// Path bar + "up one level" button.
		const bar = contentEl.createDiv({ cls: "fztermfile-fs-bar" });
		const upBtn = bar.createEl("button", { text: t("fs.up") });
		upBtn.onclick = () => void this.goUp();
		this.pathEl = bar.createDiv({ cls: "fztermfile-fs-path" });

		// Entry list.
		this.listEl = contentEl.createDiv({ cls: "fztermfile-fs-list" });

		if (this.source === "remote" && this.remote) {
			await this.ensureSftp();
		}
		await this.refresh();
	}

	onClose(): void {
		this.contentEl.empty();
		// This SFTP channel was opened by THIS modal; close it (the SSH connection
		// itself stays open, owned by the terminal session).
		try {
			(this.sftp as unknown as { end?: () => void })?.end?.();
		} catch {
			// ignore
		}
		this.sftp = null;
	}

	private async setSource(source: "local" | "remote"): Promise<void> {
		if (source === "remote" && !this.remote) {
			new Notice(t("fs.noSshSession"));
			return;
		}
		this.source = source;
		if (source === "remote") await this.ensureSftp();
		await this.refresh();
	}

	private async ensureSftp(): Promise<void> {
		if (this.sftp || !this.remote) return;
		try {
			this.sftp = await this.remote.openSftp();
		} catch (e) {
			new Notice(t("fs.sftpUnavailable", e instanceof Error ? e.message : String(e)));
		}
	}

	private currentPath(): string {
		return this.source === "local" ? this.localPath : this.remotePath;
	}

	private async goUp(): Promise<void> {
		if (this.source === "local") {
			this.localPath = resolve(join(this.localPath, ".."));
		} else {
			const cur = this.remotePath.replace(/\/+$/, "");
			const idx = cur.lastIndexOf("/");
			if (idx > 0) this.remotePath = cur.slice(0, idx);
			else if (idx === 0) this.remotePath = "/";
			else this.remotePath = "."; // relative base: stay relative
		}
		await this.refresh();
	}

	private async refresh(): Promise<void> {
		if (!this.listEl || !this.pathEl) return;
		const seq = ++this.reqSeq;
		this.pathEl.setText(`[${this.source}] ${this.currentPath()}`);

		let entries: Entry[] = [];
		try {
			entries =
				this.source === "local"
					? await this.listLocal(this.localPath)
					: await this.listRemote(this.remotePath);
		} catch (e) {
			if (seq !== this.reqSeq) return; // superseded
			this.listEl.empty();
			this.listEl.createDiv({
				cls: "fztermfile-fs-error",
				text: t("fs.listError", e instanceof Error ? e.message : String(e)),
			});
			return;
		}

		if (seq !== this.reqSeq) return; // a newer navigation won

		// Directories first, then files; both alphabetical.
		entries.sort((a, b) => {
			if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
			return a.name.localeCompare(b.name);
		});

		this.listEl.empty();
		for (const entry of entries) {
			const row = this.listEl.createDiv({ cls: "fztermfile-fs-row" });
			const label = (entry.isDir ? t("fs.dirTag") : "") + entry.name;
			const nameEl = row.createDiv({ cls: "fztermfile-fs-name", text: label });

			if (entry.isDir) {
				nameEl.addClass("fztermfile-fs-dir");
				nameEl.onclick = () => void this.enterDir(entry.name);
			} else if (this.source === "remote") {
				const dl = row.createEl("button", { text: t("fs.download") });
				dl.onclick = () => void this.downloadRemote(entry.name);
			} else if (this.remote) {
				const up = row.createEl("button", { text: t("fs.upload") });
				up.onclick = () => void this.uploadLocal(entry.name);
			}
		}
	}

	private async enterDir(name: string): Promise<void> {
		if (this.source === "local") {
			this.localPath = resolve(join(this.localPath, name));
		} else {
			this.remotePath = this.joinRemote(this.remotePath, name);
		}
		await this.refresh();
	}

	private joinRemote(dir: string, name: string): string {
		const base = dir === "/" ? "" : dir.replace(/\/+$/, "");
		return base + "/" + name;
	}

	private async listLocal(path: string): Promise<Entry[]> {
		const dirents = await readdir(path, { withFileTypes: true });
		return dirents.map((d) => ({ name: d.name, isDir: d.isDirectory() }));
	}

	private async listRemote(path: string): Promise<Entry[]> {
		const sftp = this.sftp;
		if (!sftp) throw new Error("SFTP not connected.");
		const list = await new Promise<FileEntry[]>((resolveList, reject) => {
			sftp.readdir(path, (err, l) => (err ? reject(err) : resolveList(l)));
		});
		return list.map((f) => ({ name: f.filename, isDir: isDirEntry(f) }));
	}

	private async downloadRemote(name: string): Promise<void> {
		const sftp = this.sftp;
		if (!sftp) return;
		const remoteFile = this.joinRemote(this.remotePath, name);
		// Download into the folder currently shown on the local side.
		const localDest = join(this.localPath, name);
		if (await this.localExists(localDest)) {
			if (!(await this.confirmOverwrite(name))) {
				new Notice(t("fs.cancelled"));
				return;
			}
		}
		try {
			await new Promise<void>((res, reject) => {
				sftp.fastGet(remoteFile, localDest, (err) => (err ? reject(err) : res()));
			});
			new Notice(t("fs.downloaded", localDest));
		} catch (e) {
			new Notice(t("fs.downloadFailed", e instanceof Error ? e.message : String(e)));
		}
	}

	private async uploadLocal(name: string): Promise<void> {
		const sftp = this.sftp;
		if (!sftp || !this.remote) {
			new Notice(t("fs.noSshUpload"));
			return;
		}
		const localFile = join(this.localPath, name);
		const remoteDest = this.joinRemote(this.remotePath, name);
		if (await this.remoteExists(sftp, remoteDest)) {
			if (!(await this.confirmOverwrite(name))) {
				new Notice(t("fs.cancelled"));
				return;
			}
		}
		try {
			await new Promise<void>((res, reject) => {
				sftp.fastPut(localFile, remoteDest, (err) => (err ? reject(err) : res()));
			});
			new Notice(t("fs.uploaded", remoteDest));
		} catch (e) {
			new Notice(t("fs.uploadFailed", e instanceof Error ? e.message : String(e)));
		}
	}

	private async localExists(path: string): Promise<boolean> {
		try {
			await access(path);
			return true;
		} catch {
			return false;
		}
	}

	private remoteExists(sftp: SFTPWrapper, path: string): Promise<boolean> {
		return new Promise((res) => sftp.stat(path, (err) => res(!err)));
	}

	private confirmOverwrite(name: string): Promise<boolean> {
		return new Promise((res) => {
			new ConfirmModal(
				this.app,
				t("fs.overwritePrompt", name),
				t("fs.overwrite"),
				res
			).open();
		});
	}
}
