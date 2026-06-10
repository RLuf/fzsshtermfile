import { FileSystemAdapter, Plugin } from "obsidian";
import {
	FZ_TERMINAL_ICON,
	FZ_TERMINAL_VIEW_TYPE,
	QUICK_LOCAL_PROFILE_ID,
} from "./constants";
import {
	DEFAULT_SETTINGS,
	FzSettings,
	LocalProfile,
	TerminalProfile,
} from "./types";
import { generateId } from "./terminal-backend";
import { TerminalView } from "./terminal-view";
import { ProfileSuggestModal } from "./profile-suggest-modal";
import { FileBrowserModal } from "./file-browser-modal";
import { FzSettingTab } from "./settings";
import { SshBackend } from "./ssh-backend";
import { BinaryManager } from "./binary-manager";
import { setLanguage, t, Lang } from "./i18n";

// Main fzTermFile plugin. Registers the terminal view, ribbon, commands and the
// settings tab, and exposes the API used by views/modals.
export default class FzTermFilePlugin extends Plugin {
	settings: FzSettings = DEFAULT_SETTINGS;

	// Detects the native node-pty binary (check only; never auto-installs).
	binaryManager!: BinaryManager;

	// Active SSH sessions, used by the hybrid file browser (SFTP).
	private activeSsh: Set<SshBackend> = new Set();

	// In-memory, non-persisted profiles (e.g. the transient Claude Code profile),
	// kept out of settings.profiles so they never pollute data.json or race with
	// the settings UI.
	private ephemeralProfiles: Map<string, TerminalProfile> = new Map();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.binaryManager = new BinaryManager(this.getPluginDir());
		this.binaryManager.checkInstalled();

		// Register the terminal view type (each terminal is a leaf).
		this.registerView(
			FZ_TERMINAL_VIEW_TYPE,
			(leaf) => new TerminalView(leaf, this)
		);

		// Ribbon icon: opens the profile picker.
		this.addRibbonIcon(FZ_TERMINAL_ICON, t("ribbon.openTerminal"), () =>
			this.openTerminalPicker()
		);

		// Command palette entries -------------------------------------------
		this.addCommand({
			id: "open-terminal-picker",
			name: t("cmd.openPicker"),
			callback: () => this.openTerminalPicker(),
		});

		this.addCommand({
			id: "open-quick-local-terminal",
			name: t("cmd.newLocal"),
			callback: () => void this.openQuickLocalTerminal(),
		});

		this.addCommand({
			id: "open-claude-code",
			name: t("cmd.openClaude"),
			callback: () => void this.openClaudeCode(),
		});

		this.addCommand({
			id: "open-file-browser",
			name: t("cmd.openFileBrowser"),
			callback: () => this.openFileBrowser(),
		});

		// Settings tab.
		this.addSettingTab(new FzSettingTab(this.app, this));
	}

	onunload(): void {
		// Per Obsidian guidelines we do NOT detach leaves here; each
		// TerminalView.onClose() already tears down its back-end.
		this.activeSsh.clear();
		this.ephemeralProfiles.clear();
	}

	// --- Persistence ---------------------------------------------------------

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<FzSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
		if (!Array.isArray(this.settings.profiles)) {
			this.settings.profiles = [];
		}
		this.applyLanguage(this.settings.language);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// Apply (and normalize) the interface language.
	applyLanguage(lang: Lang): void {
		const normalized: Lang = lang === "pt-br" ? "pt-br" : "en";
		this.settings.language = normalized;
		setLanguage(normalized);
	}

	// --- API used by views/modals -------------------------------------------

	getProfile(id: string): TerminalProfile | null {
		return (
			this.settings.profiles.find((p) => p.id === id) ??
			this.ephemeralProfiles.get(id) ??
			null
		);
	}

	// Absolute path of the vault root (desktop only). Used as the default cwd of
	// local terminals and as the SFTP download base.
	getVaultBasePath(): string {
		const adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return "";
	}

	// Absolute path of this plugin's folder (where node_modules with the native
	// node-pty would live).
	getPluginDir(): string {
		const path = require("path") as typeof import("node:path");
		return path.join(
			this.getVaultBasePath(),
			this.app.vault.configDir,
			"plugins",
			this.manifest.id
		);
	}

	registerSshBackend(backend: SshBackend): void {
		this.activeSsh.add(backend);
	}

	unregisterSshBackend(backend: SshBackend): void {
		this.activeSsh.delete(backend);
	}

	// --- Open actions --------------------------------------------------------

	async openTerminalForProfile(profileId: string): Promise<void> {
		const leaf = this.app.workspace.getLeaf(true);
		await leaf.setViewState({
			type: FZ_TERMINAL_VIEW_TYPE,
			active: true,
			state: { profileId },
		});
		this.app.workspace.revealLeaf(leaf);
	}

	openTerminalPicker(): void {
		if (this.settings.profiles.length === 0) {
			void this.openQuickLocalTerminal();
			return;
		}
		new ProfileSuggestModal(this.app, this.settings.profiles, (p) =>
			void this.openTerminalForProfile(p.id)
		).open();
	}

	async openQuickLocalTerminal(): Promise<void> {
		const profile = this.ensureQuickLocalProfile();
		await this.openTerminalForProfile(profile.id);
	}

	async openClaudeCode(): Promise<void> {
		// Transient, in-memory profile (not persisted): avoids corrupting settings
		// and the read race the previous push/remove approach had.
		const id = generateId();
		const profile: LocalProfile = {
			id,
			name: t("profile.claudeName"),
			kind: "local",
			favorite: false,
			shell: "",
			args: [],
			cwd: "",
			startupCommand: this.settings.claudeCommand || "claude",
		};
		this.ephemeralProfiles.set(id, profile);
		await this.openTerminalForProfile(id);
	}

	openFileBrowser(): void {
		const remote = this.activeSsh.values().next().value ?? null;
		new FileBrowserModal(this.app, this, remote).open();
	}

	private ensureQuickLocalProfile(): LocalProfile {
		// Match by stable id so renaming or a language change never spawns dupes.
		const existing = this.settings.profiles.find(
			(p): p is LocalProfile =>
				p.kind === "local" && p.id === QUICK_LOCAL_PROFILE_ID
		);
		if (existing) return existing;

		const profile: LocalProfile = {
			id: QUICK_LOCAL_PROFILE_ID,
			name: t("profile.quickLocalName"),
			kind: "local",
			favorite: false,
			shell: "",
			args: [],
			cwd: "",
			startupCommand: "",
		};
		this.settings.profiles.push(profile);
		void this.saveSettings();
		return profile;
	}
}
