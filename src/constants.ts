// Shared identifiers and constants for fzSSHTermFile.

// View (leaf) type used by the terminal panel in the Obsidian workspace.
export const FZ_TERMINAL_VIEW_TYPE = "fztermfile-terminal-view";

// Icon (Lucide set, bundled with Obsidian) used in the ribbon, the view tab and
// the profile picker.
export const FZ_TERMINAL_ICON = "terminal-square";

// Friendly name shown in the tab when no profile is set yet.
export const FZ_DEFAULT_TITLE = "fzSSHTermFile";

// Stable id of the auto-created "quick local terminal" profile. Matching by id
// (instead of by localized display name) keeps a single quick profile even if
// the user renames it or switches the UI language.
export const QUICK_LOCAL_PROFILE_ID = "fztermfile-quick-local";
