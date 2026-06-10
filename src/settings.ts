import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { ProfileModal } from "./profile-modal";
import { CursorStyle, TerminalProfile } from "./types";
import { Lang, t } from "./i18n";
// import type avoids a runtime dependency cycle.
import type FzTermFilePlugin from "./main";

// Reveal a folder in the OS file manager via Electron's shell. Accessed through
// window.require so tsc does not attempt to type-resolve the "electron" module
// (it is provided by Obsidian's runtime and kept external in the bundle).
function openInFileManager(path: string): void {
	// Bind the loader to a non-"require" name so tsc does not treat this as a
	// CommonJS require("electron") (which it would try, and fail, to resolve).
	const w = window as unknown as Record<string, unknown>;
	const load = w["require"] as ((id: string) => unknown) | undefined;
	if (!load) return;
	const moduleId = "electron";
	const electron = load(moduleId) as
		| { shell?: { openPath(p: string): Promise<string> } }
		| undefined;
	void electron?.shell?.openPath(path);
}

// Plugin settings tab: terminal appearance + profile management (full CRUD:
// add, edit, delete, favorite).
export class FzSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: FzTermFilePlugin
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ----- Appearance ----------------------------------------------------
		new Setting(containerEl).setName(t("settings.appearance")).setHeading();

		new Setting(containerEl)
			.setName(t("settings.language"))
			.setDesc(t("settings.languageDesc"))
			.addDropdown((d) =>
				d
					.addOptions({ en: t("settings.langEn"), "pt-br": t("settings.langPtBr") })
					.setValue(this.plugin.settings.language)
					.onChange(async (v) => {
						this.plugin.applyLanguage(v as Lang);
						await this.plugin.saveSettings();
						this.display(); // re-render the tab in the new language
					})
			);

		new Setting(containerEl)
			.setName(t("settings.font"))
			.setDesc(t("settings.fontDesc"))
			.addText((c) =>
				c.setValue(this.plugin.settings.fontFamily).onChange(async (v) => {
					this.plugin.settings.fontFamily = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName(t("settings.fontSize")).addSlider((s) =>
			s
				.setLimits(8, 28, 1)
				.setDynamicTooltip()
				.setValue(this.plugin.settings.fontSize)
				.onChange(async (v) => {
					this.plugin.settings.fontSize = v;
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl).setName(t("settings.cursorStyle")).addDropdown((d) =>
			d
				.addOptions({
					block: t("settings.cursorBlock"),
					underline: t("settings.cursorUnderline"),
					bar: t("settings.cursorBar"),
				})
				.setValue(this.plugin.settings.cursorStyle)
				.onChange(async (v) => {
					this.plugin.settings.cursorStyle = v as CursorStyle;
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl).setName(t("settings.cursorBlink")).addToggle((c) =>
			c.setValue(this.plugin.settings.cursorBlink).onChange(async (v) => {
				this.plugin.settings.cursorBlink = v;
				await this.plugin.saveSettings();
			})
		);

		new Setting(containerEl)
			.setName(t("settings.scrollback"))
			.setDesc(t("settings.scrollbackDesc"))
			.addText((c) =>
				c
					.setValue(String(this.plugin.settings.scrollback))
					.onChange(async (v) => {
						const n = Math.round(Number(v));
						if (!Number.isNaN(n) && n > 0) {
							// Clamp to a sane range to avoid huge xterm buffers.
							this.plugin.settings.scrollback = Math.min(100000, Math.max(100, n));
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName(t("settings.defaultShell"))
			.setDesc(t("settings.defaultShellDesc"))
			.addText((c) =>
				c
					.setValue(this.plugin.settings.defaultWindowsShell)
					.onChange(async (v) => {
						// Persist the raw trimmed value; the resolver applies the default.
						this.plugin.settings.defaultWindowsShell = v.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.claudeCommand"))
			.setDesc(t("settings.claudeCommandDesc"))
			.addText((c) =>
				c.setValue(this.plugin.settings.claudeCommand).onChange(async (v) => {
					this.plugin.settings.claudeCommand = v.trim();
					await this.plugin.saveSettings();
				})
			);

		// ----- Native local terminal (node-pty) ------------------------------
		new Setting(containerEl).setName(t("settings.nativeHeading")).setHeading();

		const bm = this.plugin.binaryManager;
		const installed = bm.checkInstalled();
		const statusText = installed
			? t("settings.nativeStatusInstalled")
			: t("settings.nativeStatusMissing");

		const nativeSetting = new Setting(containerEl)
			.setName(t("settings.nativeTitle"))
			.setDesc(statusText);

		if (!installed) {
			// No runtime npm install (store policy). Offer a copyable command and a
			// shortcut to the plugin folder so the user can install it themselves.
			new Setting(containerEl)
				.setDesc(t("settings.nativeHowtoDesc"))
				.addButton((b) =>
					b.setButtonText(t("settings.copyInstallCmd")).onClick(async () => {
						await navigator.clipboard.writeText(bm.getInstallCommand());
						new Notice("fzTermFile: " + t("settings.copied"));
					})
				)
				.addButton((b) =>
					b.setButtonText(t("settings.openPluginFolder")).onClick(() => {
						openInFileManager(bm.getPluginDir());
					})
				);
		} else {
			nativeSetting.addButton((b) =>
				b.setButtonText(t("settings.openPluginFolder")).onClick(() => {
					openInFileManager(bm.getPluginDir());
				})
			);
		}

		// ----- Profiles ------------------------------------------------------
		new Setting(containerEl).setName(t("settings.profilesHeading")).setHeading();

		new Setting(containerEl)
			.setName(t("settings.addProfile"))
			.setDesc(t("settings.addProfileDesc"))
			.addButton((b) =>
				b.setButtonText(t("settings.addLocal")).onClick(() => {
					new ProfileModal(this.app, null, "local", async (p) => {
						this.plugin.settings.profiles.push(p);
						await this.plugin.saveSettings();
						this.display();
					}).open();
				})
			)
			.addButton((b) =>
				b
					.setButtonText(t("settings.addSsh"))
					.setCta()
					.onClick(() => {
						new ProfileModal(this.app, null, "ssh", async (p) => {
							this.plugin.settings.profiles.push(p);
							await this.plugin.saveSettings();
							this.display();
						}).open();
					})
			);

		if (this.plugin.settings.profiles.length === 0) {
			containerEl.createEl("p", {
				cls: "fztermfile-empty",
				text: t("settings.noProfiles"),
			});
			return;
		}

		// Profile list with actions: open, favorite, edit, delete.
		for (const profile of this.sortedProfiles()) {
			const setting = new Setting(containerEl)
				.setName((profile.favorite ? "★ " : "") + profile.name)
				.setDesc(this.describe(profile));

			setting.addExtraButton((b) =>
				b
					.setIcon("play")
					.setTooltip(t("settings.open"))
					.onClick(() => void this.plugin.openTerminalForProfile(profile.id))
			);

			setting.addExtraButton((b) =>
				b
					.setIcon("star")
					.setTooltip(profile.favorite ? t("settings.unfavorite") : t("settings.favorite"))
					.onClick(async () => {
						profile.favorite = !profile.favorite;
						await this.plugin.saveSettings();
						this.display();
					})
			);

			setting.addExtraButton((b) =>
				b
					.setIcon("pencil")
					.setTooltip(t("settings.edit"))
					.onClick(() => {
						new ProfileModal(this.app, profile, profile.kind, async (updated) => {
							const i = this.plugin.settings.profiles.findIndex(
								(x) => x.id === profile.id
							);
							if (i >= 0) this.plugin.settings.profiles[i] = updated;
							await this.plugin.saveSettings();
							this.display();
						}).open();
					})
			);

			setting.addExtraButton((b) =>
				b
					.setIcon("trash")
					.setTooltip(t("settings.delete"))
					.onClick(async () => {
						this.plugin.settings.profiles = this.plugin.settings.profiles.filter(
							(x) => x.id !== profile.id
						);
						await this.plugin.saveSettings();
						this.display();
					})
			);
		}
	}

	// Favorites first, then alphabetical order.
	private sortedProfiles(): TerminalProfile[] {
		return [...this.plugin.settings.profiles].sort((a, b) => {
			if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
	}

	private describe(p: TerminalProfile): string {
		if (p.kind === "ssh") {
			return t("settings.descSsh", p.username, p.host, p.port);
		}
		return p.shell
			? t("settings.descLocalShell", p.shell)
			: t("settings.descLocalAuto");
	}
}
