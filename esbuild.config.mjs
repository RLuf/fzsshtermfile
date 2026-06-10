import esbuild from "esbuild";
import process from "process";
import { builtinModules as builtins } from "node:module";

const prod = process.argv[2] === "production";

// Builtins do Node externalizados nas duas formas: "fs" e "node:fs".
const nodeBuiltins = [...builtins, ...builtins.map((m) => `node:${m}`)];

/*
 * fzTermFile build configuration ("dois em um").
 *
 * BUNDLADO no main.js (entra na loja sem arquivos extras):
 *   - xterm.js + addons
 *   - ssh2 (JS puro) -> terminais SSH e SFTP funcionam direto, sem nada nativo.
 *     Os addons nativos OPCIONAIS do ssh2 ficam external (ele cai p/ JS puro):
 *     "cpu-features" e qualquer ".node".
 *
 * EXTERNAL (carregado em runtime, quando presente na pasta do plugin):
 *   - node-pty-prebuilt-multiarch / node-pty -> PTY local de alta fidelidade.
 *     Instalado via npm (botão nas configurações) ou junto do plugin.
 *     Quando ausente, o plugin usa o back-end de fallback (child_process).
 */
const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		// Native PTY (resolved at runtime, never bundled). All supported package
		// names are externalized so esbuild does not try to pull them in.
		"@homebridge/node-pty-prebuilt-multiarch",
		"@lydell/node-pty",
		"node-pty-prebuilt-multiarch",
		"node-pty",
		// Addons nativos opcionais do ssh2 (mantém o ssh2 em JS puro):
		"cpu-features",
		"*.node",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...nodeBuiltins,
	],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: prod,
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
