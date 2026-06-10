import { App, FuzzySuggestModal } from "obsidian";
import { TerminalProfile } from "./types";
import { t } from "./i18n";

// Picker (with fuzzy search) to choose which terminal profile to open.
// Favorites appear first.
export class ProfileSuggestModal extends FuzzySuggestModal<TerminalProfile> {
	private readonly sorted: TerminalProfile[];

	constructor(
		app: App,
		profiles: TerminalProfile[],
		private readonly onChoose: (profile: TerminalProfile) => void
	) {
		super(app);
		this.setPlaceholder(t("picker.placeholder"));
		// Sort once; the profile list is immutable for the modal's lifetime.
		this.sorted = [...profiles].sort((a, b) => {
			if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
	}

	getItems(): TerminalProfile[] {
		return this.sorted;
	}

	getItemText(p: TerminalProfile): string {
		const star = p.favorite ? "★ " : "";
		const tag = p.kind === "ssh" ? "  [" + t("picker.tagSsh") + "]" : "  [" + t("picker.tagLocal") + "]";
		return star + p.name + tag;
	}

	onChooseItem(p: TerminalProfile): void {
		this.onChoose(p);
	}
}
