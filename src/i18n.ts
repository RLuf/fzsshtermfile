// Minimal internationalization layer for fzSSHTermFile.
//
// The community store expects English UI text by default; here we ship English
// as the base language and Portuguese (Brazil) as an optional translation the
// user can pick in the settings. Every user-facing string in the plugin goes
// through t(); missing keys fall back to English and then to the raw key, so a
// forgotten translation degrades gracefully instead of crashing.

// Supported interface languages.
export type Lang = "en" | "pt-br";

// A flat dictionary keyed by dotted string ids (e.g. "settings.fontSize").
type Dict = Record<string, string>;

// English (base) strings. Keep this object complete — it is the fallback for
// every other language.
const en: Dict = {
	// Commands + ribbon (main.ts)
	"cmd.openPicker": "Open terminal (choose profile)",
	"cmd.newLocal": "New local terminal",
	"cmd.openClaude": "Open Claude Code",
	"cmd.openFileBrowser": "Open file browser (local + remote)",
	"ribbon.openTerminal": "Open terminal",

	// Built-in profile names
	"profile.quickLocalName": "Local terminal",
	"profile.claudeName": "Claude Code",

	// Picker (profile-suggest-modal.ts)
	"picker.placeholder": "Choose a terminal to open…",
	"picker.tagSsh": "SSH",
	"picker.tagLocal": "local",

	// Terminal view (terminal-view.ts) + backend exit reasons
	"view.profileNotFound": "Profile not found (was it deleted?).",
	"view.nativeFailed": "Native PTY failed — using compatibility mode.",
	"view.shellOpenError": "Failed to open the shell: {0}",
	"exit.ended": "ended",
	"exit.code": " (code {0})",
	"exit.processEnded": "Process ended",
	"exit.processEndedCompat": "Process ended (compatibility mode)",
	"exit.bySignal": "Ended by signal {0}",
	"exit.sshClosed": "SSH connection closed",
	"exit.sshSessionEnded": "SSH session ended",
	"exit.sshError": "SSH error: {0}",

	// Settings (settings.ts)
	"settings.appearance": "Appearance",
	"settings.font": "Font",
	"settings.fontDesc": "Monospace font family for the terminal.",
	"settings.fontSize": "Font size",
	"settings.cursorStyle": "Cursor style",
	"settings.cursorBlock": "Block",
	"settings.cursorUnderline": "Underline",
	"settings.cursorBar": "Bar",
	"settings.cursorBlink": "Cursor blink",
	"settings.scrollback": "Scrollback",
	"settings.scrollbackDesc": "Number of lines kept in the scroll history (100–100000).",
	"settings.language": "Language",
	"settings.languageDesc": "Language of the plugin interface.",
	"settings.langEn": "English",
	"settings.langPtBr": "Portuguese (Brazil)",
	"settings.defaultShell": "Default shell on Windows",
	"settings.defaultShellDesc":
		"Used by local profiles that do not define a shell. Examples: wsl, pwsh, cmd, or a full command line such as 'pwsh.exe -c wsl.exe'.",
	"settings.claudeCommand": "Claude Code command",
	"settings.claudeCommandDesc": 'Command run by the "Open Claude Code" action.',
	"settings.nativeHeading": "Native local terminal (node-pty)",
	"settings.nativeTitle": "PTY support (node-pty)",
	"settings.nativeStatusInstalled":
		"Detected — local terminals use a real PTY (high fidelity, full TUI/Claude Code support).",
	"settings.nativeStatusMissing":
		"Not detected — local terminals use compatibility mode (built-in line editing). SSH and everything else work normally.",
	"settings.nativeHowtoDesc":
		"node-pty is a native module and must match Obsidian's Electron version, so it is not bundled. To enable a real PTY, install it manually in the plugin folder (see the README), then reopen Obsidian.",
	"settings.openPluginFolder": "Open plugin folder",
	"settings.copyInstallCmd": "Copy install command",
	"settings.copied": "Install command copied to clipboard.",
	"settings.profilesHeading": "Terminal profiles",
	"settings.addProfile": "Add profile",
	"settings.addProfileDesc": "Create a local terminal or a remote SSH connection.",
	"settings.addLocal": "+ Local",
	"settings.addSsh": "+ SSH",
	"settings.noProfiles": "No profiles yet. Add a local or SSH terminal above.",
	"settings.open": "Open",
	"settings.favorite": "Favorite",
	"settings.unfavorite": "Unfavorite",
	"settings.edit": "Edit",
	"settings.delete": "Delete",
	"settings.descSsh": "SSH — {0}@{1}:{2}",
	"settings.descLocalShell": "Local — {0}",
	"settings.descLocalAuto": "Local — automatic shell",

	// Profile modal (profile-modal.ts)
	"modal.newProfile": "New profile",
	"modal.editProfile": "Edit profile",
	"modal.name": "Name",
	"modal.nameDesc": "Name shown in the picker and the terminal tab.",
	"modal.favorite": "Favorite",
	"modal.favoriteDesc": "Favorites appear at the top of the picker.",
	"modal.startupCommand": "Startup command",
	"modal.startupCommandDesc": "Run automatically on open (e.g. claude). Optional.",
	"modal.shell": "Shell / command line",
	"modal.shellDesc":
		"Empty = automatic (WSL on Windows, $SHELL on Linux/macOS). Accepts a full command line, e.g. \"pwsh.exe -c wsl.exe\" or \"/bin/bash\".",
	"modal.args": "Extra arguments",
	"modal.argsDesc":
		"Appended after the command above. Space-separated; quote arguments that contain spaces. Example: -d Ubuntu",
	"modal.cwd": "Working directory",
	"modal.cwdDesc": "Empty = vault root.",
	"modal.host": "Host",
	"modal.port": "Port",
	"modal.username": "Username",
	"modal.password": "Password",
	"modal.passwordDesc": "Leave empty if using a private key.",
	"modal.privateKey": "Private key (path)",
	"modal.privateKeyDesc": "Path to a PEM/OpenSSH key file. Optional.",
	"modal.passphrase": "Key passphrase",
	"modal.passphraseDesc": "Optional, if the key is protected.",
	"modal.remoteHome": "Initial remote directory",
	"modal.remoteHomeDesc": "Used by the file browser (SFTP). e.g. /home/user",
	"modal.credentialWarning":
		"Passwords and passphrases are stored unencrypted in this vault's data.json. Prefer key-file authentication.",
	"modal.cancel": "Cancel",
	"modal.save": "Save",
	"modal.errNameRequired": "Enter a name for the profile.",
	"modal.errSshHostUser": "SSH requires a host and a username.",
	"modal.errSshAuth": "Enter a password or a private key for SSH.",
	"modal.errPort": "Port must be an integer between 1 and 65535.",

	// File browser (file-browser-modal.ts)
	"fs.title": "Files (local + remote)",
	"fs.local": "Local",
	"fs.remotePrefix": "Remote: {0}",
	"fs.remoteNoSession": "Remote (no session)",
	"fs.up": "Up",
	"fs.dirTag": "[dir] ",
	"fs.download": "Download to local folder",
	"fs.upload": "Upload to remote",
	"fs.listError": "List error: {0}",
	"fs.noSshSession": "No active SSH session. Open an SSH terminal first.",
	"fs.sftpUnavailable": "SFTP unavailable: {0}",
	"fs.downloaded": "Downloaded to: {0}",
	"fs.downloadFailed": "Download failed: {0}",
	"fs.uploaded": "Uploaded to: {0}",
	"fs.uploadFailed": "Upload failed: {0}",
	"fs.noSshUpload": "No SSH session for upload.",
	"fs.overwritePrompt": '"{0}" already exists at the destination. Overwrite it?',
	"fs.overwrite": "Overwrite",
	"fs.cancelled": "Cancelled.",
};

// Portuguese (Brazil) translations. Any key missing here falls back to English.
const ptBr: Dict = {
	"cmd.openPicker": "Abrir terminal (escolher perfil)",
	"cmd.newLocal": "Novo terminal local",
	"cmd.openClaude": "Abrir Claude Code",
	"cmd.openFileBrowser": "Abrir navegador de arquivos (local + remoto)",
	"ribbon.openTerminal": "Abrir terminal",

	"profile.quickLocalName": "Terminal local",
	"profile.claudeName": "Claude Code",

	"picker.placeholder": "Escolha um terminal para abrir…",
	"picker.tagSsh": "SSH",
	"picker.tagLocal": "local",

	"view.profileNotFound": "Perfil não encontrado (foi excluído?).",
	"view.nativeFailed": "PTY nativo falhou — usando modo compatível.",
	"view.shellOpenError": "Falha ao abrir o shell: {0}",
	"exit.ended": "encerrado",
	"exit.code": " (código {0})",
	"exit.processEnded": "Processo encerrado",
	"exit.processEndedCompat": "Processo encerrado (modo compatível)",
	"exit.bySignal": "Encerrado pelo sinal {0}",
	"exit.sshClosed": "Conexão SSH fechada",
	"exit.sshSessionEnded": "Sessão SSH encerrada",
	"exit.sshError": "Erro de SSH: {0}",

	"settings.appearance": "Aparência",
	"settings.font": "Fonte",
	"settings.fontDesc": "Família de fonte monoespaçada do terminal.",
	"settings.fontSize": "Tamanho da fonte",
	"settings.cursorStyle": "Estilo do cursor",
	"settings.cursorBlock": "Bloco",
	"settings.cursorUnderline": "Sublinhado",
	"settings.cursorBar": "Barra",
	"settings.cursorBlink": "Cursor piscante",
	"settings.scrollback": "Histórico de rolagem",
	"settings.scrollbackDesc": "Número de linhas mantidas no histórico de rolagem (100–100000).",
	"settings.language": "Idioma",
	"settings.languageDesc": "Idioma da interface do plugin.",
	"settings.langEn": "Inglês",
	"settings.langPtBr": "Português (Brasil)",
	"settings.defaultShell": "Shell padrão no Windows",
	"settings.defaultShellDesc":
		"Usado por perfis locais sem shell definido. Ex.: wsl, pwsh, cmd, ou uma linha de comando completa como 'pwsh.exe -c wsl.exe'.",
	"settings.claudeCommand": "Comando do Claude Code",
	"settings.claudeCommandDesc": 'Comando executado pela ação "Abrir Claude Code".',
	"settings.nativeHeading": "Terminal local nativo (node-pty)",
	"settings.nativeTitle": "Suporte a PTY (node-pty)",
	"settings.nativeStatusInstalled":
		"Detectado — terminais locais usam PTY real (alta fidelidade, suporte completo a TUI/Claude Code).",
	"settings.nativeStatusMissing":
		"Não detectado — terminais locais usam o modo compatível (edição de linha embutida). SSH e o restante funcionam normalmente.",
	"settings.nativeHowtoDesc":
		"O node-pty é um módulo nativo e precisa casar com a versão do Electron do Obsidian, por isso não é embutido. Para ativar um PTY real, instale-o manualmente na pasta do plugin (veja o README) e reabra o Obsidian.",
	"settings.openPluginFolder": "Abrir pasta do plugin",
	"settings.copyInstallCmd": "Copiar comando de instalação",
	"settings.copied": "Comando de instalação copiado para a área de transferência.",
	"settings.profilesHeading": "Perfis de terminal",
	"settings.addProfile": "Adicionar perfil",
	"settings.addProfileDesc": "Crie um terminal local ou uma conexão SSH remota.",
	"settings.addLocal": "+ Local",
	"settings.addSsh": "+ SSH",
	"settings.noProfiles": "Nenhum perfil ainda. Adicione um terminal local ou SSH acima.",
	"settings.open": "Abrir",
	"settings.favorite": "Favoritar",
	"settings.unfavorite": "Desfavoritar",
	"settings.edit": "Editar",
	"settings.delete": "Excluir",
	"settings.descSsh": "SSH — {0}@{1}:{2}",
	"settings.descLocalShell": "Local — {0}",
	"settings.descLocalAuto": "Local — shell automático",

	"modal.newProfile": "Novo perfil",
	"modal.editProfile": "Editar perfil",
	"modal.name": "Nome",
	"modal.nameDesc": "Nome exibido no seletor e na aba do terminal.",
	"modal.favorite": "Favorito",
	"modal.favoriteDesc": "Favoritos aparecem no topo do seletor.",
	"modal.startupCommand": "Comando inicial",
	"modal.startupCommandDesc": "Executado automaticamente ao abrir (ex.: claude). Opcional.",
	"modal.shell": "Shell / linha de comando",
	"modal.shellDesc":
		"Vazio = automático (WSL no Windows, $SHELL no Linux/macOS). Aceita uma linha de comando completa, ex.: \"pwsh.exe -c wsl.exe\" ou \"/bin/bash\".",
	"modal.args": "Argumentos extras",
	"modal.argsDesc":
		"Acrescentados após o comando acima. Separados por espaço; use aspas para argumentos com espaços. Ex.: -d Ubuntu",
	"modal.cwd": "Diretório inicial",
	"modal.cwdDesc": "Vazio = raiz do vault.",
	"modal.host": "Host",
	"modal.port": "Porta",
	"modal.username": "Usuário",
	"modal.password": "Senha",
	"modal.passwordDesc": "Deixe vazio se usar chave privada.",
	"modal.privateKey": "Chave privada (caminho)",
	"modal.privateKeyDesc": "Caminho do arquivo PEM/OpenSSH. Opcional.",
	"modal.passphrase": "Passphrase da chave",
	"modal.passphraseDesc": "Opcional, se a chave for protegida.",
	"modal.remoteHome": "Diretório remoto inicial",
	"modal.remoteHomeDesc": "Usado no navegador de arquivos (SFTP). Ex.: /home/usuario",
	"modal.credentialWarning":
		"Senhas e passphrases são gravadas sem criptografia no data.json deste vault. Prefira autenticação por chave.",
	"modal.cancel": "Cancelar",
	"modal.save": "Salvar",
	"modal.errNameRequired": "Informe um nome para o perfil.",
	"modal.errSshHostUser": "SSH exige host e usuário.",
	"modal.errSshAuth": "Informe senha ou chave privada para o SSH.",
	"modal.errPort": "A porta deve ser um inteiro entre 1 e 65535.",

	"fs.title": "Arquivos (local + remoto)",
	"fs.local": "Local",
	"fs.remotePrefix": "Remoto: {0}",
	"fs.remoteNoSession": "Remoto (sem sessão)",
	"fs.up": "Acima",
	"fs.dirTag": "[dir] ",
	"fs.download": "Baixar para a pasta local",
	"fs.upload": "Enviar para o remoto",
	"fs.listError": "Erro ao listar: {0}",
	"fs.noSshSession": "Nenhuma sessão SSH ativa. Abra um terminal SSH primeiro.",
	"fs.sftpUnavailable": "SFTP indisponível: {0}",
	"fs.downloaded": "Baixado para: {0}",
	"fs.downloadFailed": "Falha ao baixar: {0}",
	"fs.uploaded": "Enviado para: {0}",
	"fs.uploadFailed": "Falha ao enviar: {0}",
	"fs.noSshUpload": "Sem sessão SSH para envio.",
	"fs.overwritePrompt": '"{0}" já existe no destino. Sobrescrever?',
	"fs.overwrite": "Sobrescrever",
	"fs.cancelled": "Cancelado.",
};

// Currently active language; updated from settings on load and on change.
let current: Lang = "en";

// Switch the active interface language. Unknown values fall back to English.
export function setLanguage(lang: Lang): void {
	current = lang === "pt-br" ? "pt-br" : "en";
}

// Current active language (useful for the settings dropdown value).
export function getLanguage(): Lang {
	return current;
}

// Translate a key, interpolating positional placeholders {0}, {1}, … with the
// provided arguments. Falls back to English, then to the raw key.
export function t(key: string, ...args: (string | number)[]): string {
	const dict = current === "pt-br" ? ptBr : en;
	let s = dict[key] ?? en[key] ?? key;
	for (let i = 0; i < args.length; i++) {
		s = s.split("{" + i + "}").join(String(args[i]));
	}
	return s;
}
