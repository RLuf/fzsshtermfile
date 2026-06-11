// Detects whether a native node-pty package is present in the plugin folder.
//
// IMPORTANT (community-store compliance): the plugin does NOT download or build
// native code at runtime. node-pty is a native module that must match Obsidian's
// Electron ABI, so it cannot be bundled and is not auto-installed (running
// `npm install` from inside a plugin is a common review rejection). Instead, the
// plugin ships the JS-only child_process fallback (with front-end line editing)
// and merely DETECTS a user-installed node-pty to enable the high-fidelity PTY.
// See the README for manual install instructions.

// Recommended package to vendor for a real PTY. @lydell/node-pty ships N-API
// prebuilds, which are ABI-stable across Electron versions — so it loads on
// Obsidian's Electron without any @electron/rebuild or C++ toolchain. The user
// may also use node-pty, @homebridge/node-pty-prebuilt-multiarch, etc.
const RECOMMENDED_PACKAGE = "@lydell/node-pty";

// Packages the runtime loader (pty-backend) knows how to require.
const SUPPORTED_PACKAGES = [
	"@homebridge/node-pty-prebuilt-multiarch",
	"@lydell/node-pty",
	"node-pty",
	"node-pty-prebuilt-multiarch",
];

export class BinaryManager {
	private readonly fs: typeof import("node:fs");
	private readonly path: typeof import("node:path");
	private installed = false;

	constructor(private readonly pluginDir: string) {
		this.fs = require("fs") as typeof import("node:fs");
		this.path = require("path") as typeof import("node:path");
	}

	// True if any supported node-pty package is physically present in the plugin
	// folder. The actual load (and ABI validation) happens in pty-backend; if it
	// fails there, the view falls back to compatibility mode automatically.
	checkInstalled(): boolean {
		this.installed = SUPPORTED_PACKAGES.some((pkg) => {
			try {
				const pkgJson = this.path.join(
					this.pluginDir,
					"node_modules",
					pkg,
					"package.json"
				);
				return this.fs.existsSync(pkgJson);
			} catch {
				return false;
			}
		});
		return this.installed;
	}

	isInstalled(): boolean {
		return this.installed;
	}

	// Absolute path of the plugin folder (where node_modules would live).
	getPluginDir(): string {
		return this.pluginDir;
	}

	// A copy-pasteable command the user can run in a real terminal to install the
	// native PTY into this plugin's folder.
	getInstallCommand(): string {
		return `npm install --prefix "${this.pluginDir}" ${RECOMMENDED_PACKAGE}`;
	}
}
