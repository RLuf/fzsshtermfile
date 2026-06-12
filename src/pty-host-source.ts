// Source of the out-of-process "PTY host".
//
// Why this exists: the Obsidian renderer runs on a V8 platform that forbids
// creating Worker threads, and node-pty's ConPTY backend builds a Worker for its
// conout socket ("Failed to construct 'Worker'"). So node-pty cannot run in the
// renderer. This host runs node-pty in a SEPARATE Node process (where Workers
// work) and proxies the terminal over stdio. This is the same approach the
// community "Terminal" plugin uses (it bridges through an external runtime).
//
// It is passed to the user's Node via `node -e <thisSource>` — it is the
// plugin's OWN code, never downloaded, and nothing executable is written to
// disk. All configuration and I/O go over stdio as newline-delimited JSON:
//   plugin -> host (stdin):  {t:"init",...cfg} | {t:"data",d:<b64>} | {t:"resize",cols,rows} | {t:"kill"}
//   host -> plugin (stdout): {t:"ready",pid} | {t:"data",d:<b64>} | {t:"exit",code,signal} | {t:"fatal",m}
// init cfg = { modulePath, file, args, cols, rows, cwd, env }.
export const PTY_HOST_SOURCE = `'use strict';
function send(o){ try { process.stdout.write(JSON.stringify(o) + '\\n'); } catch (e) {} }
var term = null, buf = '';
function startTerm(cfg){
  var pty;
  try { pty = require(cfg.modulePath); }
  catch (e) { send({ t: 'fatal', m: 'require: ' + ((e && e.message) || e) }); process.exit(1); }
  try {
    term = pty.spawn(cfg.file, cfg.args || [], {
      name: 'xterm-256color',
      cols: cfg.cols || 80,
      rows: cfg.rows || 24,
      cwd: cfg.cwd || undefined,
      env: cfg.env || process.env
    });
  } catch (e) { send({ t: 'fatal', m: 'spawn: ' + ((e && e.message) || e) }); process.exit(1); }
  send({ t: 'ready', pid: term.pid });
  term.onData(function (d) { send({ t: 'data', d: Buffer.from(d, 'utf8').toString('base64') }); });
  term.onExit(function (e) {
    send({ t: 'exit', code: e.exitCode, signal: e.signal });
    setTimeout(function () { process.exit(0); }, 20);
  });
}
function handle(m){
  if (m.t === 'init') { startTerm(m); return; }
  if (!term) return;
  if (m.t === 'data') { try { term.write(Buffer.from(m.d, 'base64').toString('utf8')); } catch (e) {} }
  else if (m.t === 'resize') { try { term.resize(m.cols, m.rows); } catch (e) {} }
  else if (m.t === 'kill') { try { term.kill(); } catch (e) {} process.exit(0); }
}
process.stdin.on('data', function (chunk) {
  buf += chunk.toString('utf8');
  var idx;
  while ((idx = buf.indexOf('\\n')) >= 0) {
    var line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line) continue;
    var m;
    try { m = JSON.parse(line); } catch (e) { continue; }
    handle(m);
  }
});
process.stdin.on('end', function () { try { if (term) term.kill(); } catch (e) {} process.exit(0); });
process.stdin.resume();
`;
