import { App, Modal, Notice, Setting } from "obsidian";
import { generateId } from "./terminal-backend";
import { LocalProfile, SshProfile, TerminalProfile, DEFAULT_SSH_PORT } from "./types";
import { tokenizeCommandLine } from "./command-line";
import { t } from "./i18n";

// Modal to create or edit a terminal profile (local or SSH). On save, calls
// onSubmit with the resulting profile (the caller persists the list).
export class ProfileModal extends Modal {
	private working: TerminalProfile;
	private readonly isNew: boolean;
	// Raw port text, validated on submit (so typos are not silently coerced).
	private portText: string;

	constructor(
		app: App,
		existing: TerminalProfile | null,
		kindForNew: "local" | "ssh",
		private readonly onSubmit: (profile: TerminalProfile) => void
	) {
		super(app);
		this.isNew = existing === null;

		if (existing) {
			// Clone so cancelling has no side effects.
			this.working = JSON.parse(JSON.stringify(existing)) as TerminalProfile;
		} else if (kindForNew === "local") {
			this.working = {
				id: generateId(),
				name: "",
				kind: "local",
				favorite: false,
				shell: "",
				args: [],
				cwd: "",
				startupCommand: "",
			};
		} else {
			this.working = {
				id: generateId(),
				name: "",
				kind: "ssh",
				favorite: false,
				host: "",
				port: DEFAULT_SSH_PORT,
				username: "",
				password: "",
				privateKeyPath: "",
				passphrase: "",
				remoteHome: "",
				startupCommand: "",
			};
		}
		this.portText =
			this.working.kind === "ssh" ? String(this.working.port) : String(DEFAULT_SSH_PORT);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(this.isNew ? t("modal.newProfile") : t("modal.editProfile"));

		// Fields common to all profile types.
		new Setting(contentEl)
			.setName(t("modal.name"))
			.setDesc(t("modal.nameDesc"))
			.addText((c) =>
				c.setValue(this.working.name).onChange((v) => (this.working.name = v))
			);

		new Setting(contentEl)
			.setName(t("modal.favorite"))
			.setDesc(t("modal.favoriteDesc"))
			.addToggle((c) =>
				c.setValue(this.working.favorite).onChange((v) => (this.working.favorite = v))
			);

		new Setting(contentEl)
			.setName(t("modal.startupCommand"))
			.setDesc(t("modal.startupCommandDesc"))
			.addText((c) =>
				c
					.setValue(this.working.startupCommand ?? "")
					.onChange((v) => (this.working.startupCommand = v))
			);

		// Type-specific fields.
		if (this.working.kind === "local") {
			this.renderLocalFields(contentEl, this.working);
		} else {
			this.renderSshFields(contentEl, this.working);
		}

		// Action buttons.
		new Setting(contentEl)
			.addButton((b) => b.setButtonText(t("modal.cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(t("modal.save"))
					.setCta()
					.onClick(() => this.submit())
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderLocalFields(parent: HTMLElement, p: LocalProfile): void {
		new Setting(parent)
			.setName(t("modal.shell"))
			.setDesc(t("modal.shellDesc"))
			.addText((c) => c.setValue(p.shell ?? "").onChange((v) => (p.shell = v.trim())));

		new Setting(parent)
			.setName(t("modal.args"))
			.setDesc(t("modal.argsDesc"))
			.addText((c) =>
				c.setValue((p.args ?? []).join(" ")).onChange((v) => {
					// Quote-aware tokenization so arguments with spaces survive.
					p.args = tokenizeCommandLine(v);
				})
			);

		new Setting(parent)
			.setName(t("modal.cwd"))
			.setDesc(t("modal.cwdDesc"))
			.addText((c) => c.setValue(p.cwd ?? "").onChange((v) => (p.cwd = v.trim())));
	}

	private renderSshFields(parent: HTMLElement, p: SshProfile): void {
		new Setting(parent)
			.setName(t("modal.host"))
			.addText((c) =>
				c
					.setPlaceholder("192.168.0.10")
					.setValue(p.host)
					.onChange((v) => (p.host = v.trim()))
			);

		new Setting(parent)
			.setName(t("modal.port"))
			.addText((c) =>
				c.setValue(this.portText).onChange((v) => (this.portText = v.trim()))
			);

		new Setting(parent)
			.setName(t("modal.username"))
			.addText((c) => c.setValue(p.username).onChange((v) => (p.username = v.trim())));

		new Setting(parent)
			.setName(t("modal.password"))
			.setDesc(t("modal.passwordDesc"))
			.addText((c) => {
				c.setValue(p.password ?? "").onChange((v) => (p.password = v));
				c.inputEl.type = "password";
			});

		new Setting(parent)
			.setName(t("modal.privateKey"))
			.setDesc(t("modal.privateKeyDesc"))
			.addText((c) =>
				c.setValue(p.privateKeyPath ?? "").onChange((v) => (p.privateKeyPath = v.trim()))
			);

		new Setting(parent)
			.setName(t("modal.passphrase"))
			.setDesc(t("modal.passphraseDesc"))
			.addText((c) => {
				c.setValue(p.passphrase ?? "").onChange((v) => (p.passphrase = v));
				c.inputEl.type = "password";
			});

		new Setting(parent)
			.setName(t("modal.remoteHome"))
			.setDesc(t("modal.remoteHomeDesc"))
			.addText((c) =>
				c.setValue(p.remoteHome ?? "").onChange((v) => (p.remoteHome = v.trim()))
			);

		// Make the plaintext-credential storage explicit to the user.
		parent.createEl("p", {
			cls: "fztermfile-warning",
			text: t("modal.credentialWarning"),
		});
	}

	private submit(): void {
		if (!this.working.name.trim()) {
			new Notice(t("modal.errNameRequired"));
			return;
		}
		if (this.working.kind === "ssh") {
			if (!this.working.host.trim() || !this.working.username.trim()) {
				new Notice(t("modal.errSshHostUser"));
				return;
			}
			const port = parseInt(this.portText, 10);
			if (!Number.isInteger(port) || port < 1 || port > 65535) {
				new Notice(t("modal.errPort"));
				return;
			}
			this.working.port = port;
			if (!this.working.password && !this.working.privateKeyPath) {
				new Notice(t("modal.errSshAuth"));
				return;
			}
		}
		this.working.name = this.working.name.trim();
		this.onSubmit(this.working);
		this.close();
	}
}
