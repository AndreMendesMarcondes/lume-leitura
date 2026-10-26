// Lume para VS Code — leitura com foco
// Sem dependências: só a API do VS Code + Node.
const vscode = require("vscode");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PROSE = new Set(["markdown", "plaintext", "latex", "restructuredtext", "asciidoc", "mdx"]);
const HASH_COMMENT = new Set(["python", "shellscript", "yaml", "powershell", "dockerfile", "ruby", "perl", "r", "toml", "makefile", "coffeescript"]);
const cfg = () => vscode.workspace.getConfiguration("lume");

let ctx;
const state = { guided: false, reading: null, timer: null, readingModeBackup: null };

// ───────────────────────── Decorações ─────────────────────────
let deco = {};
function createDecorations() {
  Object.values(deco).forEach((d) => d.dispose && d.dispose());
  const c = cfg();
  deco = {
    bold: vscode.window.createTextEditorDecorationType({ fontWeight: "700" }),
    fade: vscode.window.createTextEditorDecorationType({ opacity: "0.62" }),
    dim: vscode.window.createTextEditorDecorationType({ opacity: String(c.get("focus.dimOpacity")) }),
    word: vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(255, 213, 79, 0.55)", borderRadius: "2px", color: "#111"
    }),
    sentence: vscode.window.createTextEditorDecorationType({ backgroundColor: "rgba(120, 180, 255, 0.14)", isWholeLine: false }),
    guided: vscode.window.createTextEditorDecorationType({
      isWholeLine: true, borderWidth: "0 0 0 3px", borderStyle: "solid", borderColor: "rgba(255, 193, 7, 0.9)"
    }),
    hl: {
      yellow: vscode.window.createTextEditorDecorationType({ backgroundColor: "rgba(255, 230, 0, 0.35)", overviewRulerColor: "#e6c800", overviewRulerLane: vscode.OverviewRulerLane.Right }),
      green: vscode.window.createTextEditorDecorationType({ backgroundColor: "rgba(110, 231, 120, 0.35)", overviewRulerColor: "#3fbf4a", overviewRulerLane: vscode.OverviewRulerLane.Right }),
      pink: vscode.window.createTextEditorDecorationType({ backgroundColor: "rgba(255, 128, 191, 0.35)", overviewRulerColor: "#ff5aa8", overviewRulerLane: vscode.OverviewRulerLane.Right }),
      blue: vscode.window.createTextEditorDecorationType({ backgroundColor: "rgba(110, 180, 255, 0.35)", overviewRulerColor: "#3d8bfd", overviewRulerLane: vscode.OverviewRulerLane.Right })
    }
  };
  deco.hl.dispose = () => Object.values(deco.hl).forEach((d) => d.dispose());
}

// ───────────────────────── Bionic ─────────────────────────
const WORD_RE = /[\p{L}\p{N}_]+(?:['’][\p{L}]+)*/gu;
const SUB_RE = /\p{Lu}?[\p{Ll}\p{M}]+|\p{Lu}+(?![\p{Ll}])|\p{N}+|[\p{L}\p{M}]+/gu;

function boldCount(len, strength) {
  if (len <= 3) return 1;
  return Math.max(1, Math.min(len - 1, Math.ceil(len * strength)));
}

// Devolve [início, fim) dos trechos de comentário de uma linha (aproximado, sem tokenizer).
function commentSpans(lang, text, inBlock) {
  const spans = [];
  let i = 0, block = inBlock;
  if (HASH_COMMENT.has(lang)) {
    const k = text.search(/(^|\s)#/);
    if (k >= 0) spans.push([k, text.length]);
    return { spans, block: false };
  }
  while (i < text.length) {
    if (block) {
      const end = text.indexOf("*/", i);
      if (end < 0) { spans.push([i, text.length]); return { spans, block: true }; }
      spans.push([i, end + 2]); i = end + 2; block = false; continue;
    }
    const lc = text.indexOf("//", i), bc = text.indexOf("/*", i);
    if (lc < 0 && bc < 0) break;
    if (lc >= 0 && (bc < 0 || lc < bc)) {
      // ignora "//" de URL (http://)
      if (lc > 0 && text[lc - 1] === ":") { i = lc + 2; continue; }
      spans.push([lc, text.length]); break;
    }
    block = true; i = bc;
  }
  return { spans, block };
}

function bionicRanges(editor) {
  const c = cfg();
  const doc = editor.document;
  const strength = c.get("bionic.strength");
  const scope = c.get("bionic.scope");
  const split = c.get("bionic.splitIdentifiers");
  const isProse = PROSE.has(doc.languageId);
  if (scope === "prose" && !isProse) return { bold: [], fade: [] };
  const onlyComments = scope === "comments" && !isProse;

  const bold = [], fade = [];
  for (const vr of editor.visibleRanges) {
    const from = Math.max(0, vr.start.line - 30), to = Math.min(doc.lineCount - 1, vr.end.line + 30);
    let inBlock = false;
    if (onlyComments) { // descobre se começamos dentro de /* */ olhando até 300 linhas acima
      for (let l = Math.max(0, from - 300); l < from; l++) inBlock = commentSpans(doc.languageId, doc.lineAt(l).text, inBlock).block;
    }
    for (let line = from; line <= to; line++) {
      const text = doc.lineAt(line).text;
      if (text.length > 2000) continue;
      let allowed = null;
      if (onlyComments) { const r = commentSpans(doc.languageId, text, inBlock); inBlock = r.block; allowed = r.spans; if (!allowed.length) continue; }
      WORD_RE.lastIndex = 0;
      let m;
      while ((m = WORD_RE.exec(text))) {
        if (allowed && !allowed.some(([a, b]) => m.index >= a && m.index < b)) continue;
        const parts = [];
        if (split && !isProse) {
          SUB_RE.lastIndex = 0; let s;
          while ((s = SUB_RE.exec(m[0]))) parts.push([m.index + s.index, s[0].length]);
        } else parts.push([m.index, m[0].length]);
        for (const [start, len] of parts) {
          if (len < 2) continue;
          const n = boldCount(len, strength);
          bold.push(new vscode.Range(line, start, line, start + n));
          fade.push(new vscode.Range(line, start + n, line, start + len));
        }
      }
    }
  }
  return { bold, fade };
}

// ───────────────────────── Foco / guiada ─────────────────────────
function paragraphAt(doc, line) {
  const blank = (l) => doc.lineAt(l).isEmptyOrWhitespace;
  if (blank(line)) return { start: line, end: line };
  let s = line, e = line;
  while (s > 0 && !blank(s - 1)) s--;
  while (e < doc.lineCount - 1 && !blank(e + 1)) e++;
  return { start: s, end: e };
}

function focusRanges(editor) {
  const mode = state.guided ? "paragraph" : cfg().get("focus.mode");
  if (mode === "off") return { dim: [], guided: [] };
  const doc = editor.document;
  const line = editor.selection.active.line;
  const p = mode === "line" ? { start: line, end: line } : paragraphAt(doc, line);
  const dim = [];
  if (p.start > 0) dim.push(new vscode.Range(0, 0, p.start, 0));
  if (p.end < doc.lineCount - 1) dim.push(new vscode.Range(p.end + 1, 0, doc.lineCount, 0));
  const guided = state.guided ? [new vscode.Range(p.start, 0, p.end, 0)] : [];
  return { dim, guided };
}

function moveParagraph(dir) {
  const ed = vscode.window.activeTextEditor; if (!ed) return;
  const doc = ed.document;
  let l = ed.selection.active.line;
  const cur = paragraphAt(doc, l);
  l = dir > 0 ? cur.end + 1 : cur.start - 1;
  while (l >= 0 && l < doc.lineCount && doc.lineAt(l).isEmptyOrWhitespace) l += dir;
  if (l < 0 || l >= doc.lineCount) return;
  const p = paragraphAt(doc, l);
  const pos = new vscode.Position(p.start, doc.lineAt(p.start).firstNonWhitespaceCharacterIndex);
  ed.selection = new vscode.Selection(pos, pos);
  ed.revealRange(new vscode.Range(p.start, 0, p.end, 0), vscode.TextEditorRevealType.InCenter);
}

// ───────────────────────── Marcações ─────────────────────────
const HL_KEY = "lume.highlights";
function allHl() { return ctx.workspaceState.get(HL_KEY, {}); }
function hlFor(uri) { return allHl()[uri.toString()] || []; }
async function setHlFor(uri, list) {
  const all = allHl();
  if (list.length) all[uri.toString()] = list; else delete all[uri.toString()];
  await ctx.workspaceState.update(HL_KEY, all);
}

// acha o texto mais perto da posição antiga (sobrevive a edições acima do trecho)
function anchor(doc, h) {
  const text = doc.getText();
  let best = -1, dist = Infinity, i = text.indexOf(h.text);
  while (i >= 0) {
    const d = Math.abs(i - (h.offset || 0));
    if (d < dist) { dist = d; best = i; }
    i = text.indexOf(h.text, i + 1);
  }
  if (best < 0) return null;
  h.offset = best;
  return new vscode.Range(doc.positionAt(best), doc.positionAt(best + h.text.length));
}

function highlightDecorations(editor) {
  const out = { yellow: [], green: [], pink: [], blue: [] };
  for (const h of hlFor(editor.document.uri)) {
    const r = anchor(editor.document, h);
    if (!r) continue;
    const md = h.note ? new vscode.MarkdownString(`**Nota (Lume):** ${h.note}`) : undefined;
    (out[h.color] || out.yellow).push({ range: r, hoverMessage: md });
  }
  return out;
}

async function addHighlight(withNote) {
  const ed = vscode.window.activeTextEditor; if (!ed || ed.selection.isEmpty) return;
  const color = await vscode.window.showQuickPick(
    [{ label: "🟨 Amarelo", c: "yellow" }, { label: "🟩 Verde", c: "green" }, { label: "🟪 Rosa", c: "pink" }, { label: "🟦 Azul", c: "blue" }],
    { placeHolder: "Cor da marcação" });
  if (!color) return;
  let note = "";
  if (withNote) { note = await vscode.window.showInputBox({ prompt: "Nota para este trecho" }); if (note === undefined) return; }
  const doc = ed.document;
  const list = hlFor(doc.uri);
  list.push({ id: Date.now().toString(36), color: color.c, note, text: doc.getText(ed.selection), offset: doc.offsetAt(ed.selection.start), line: ed.selection.start.line, created: Date.now() });
  await setHlFor(doc.uri, list);
  refreshAll();
}

async function removeHighlight() {
  const ed = vscode.window.activeTextEditor; if (!ed) return;
  const pos = ed.selection.active;
  const list = hlFor(ed.document.uri);
  const keep = list.filter((h) => { const r = anchor(ed.document, h); return !(r && r.contains(pos)); });
  if (keep.length === list.length) return vscode.window.showInformationMessage("Nenhuma marcação sob o cursor.");
  await setHlFor(ed.document.uri, keep);
  refreshAll();
}

async function exportHighlights() {
  const all = allHl();
  const files = Object.keys(all);
  if (!files.length) return vscode.window.showInformationMessage("Nenhuma marcação ainda.");
  const lines = ["# Marcações do Lume", ""];
  for (const f of files) {
    const uri = vscode.Uri.parse(f);
    lines.push(`## ${vscode.workspace.asRelativePath(uri)}`, "");
    for (const h of all[f].sort((a, b) => (a.offset || 0) - (b.offset || 0))) {
      lines.push(`> ${h.text.replace(/\s+/g, " ").trim()}`, "", `<sub>linha ${h.line + 1}</sub>`);
      if (h.note) lines.push("", `**Nota:** ${h.note}`);
      lines.push("");
    }
  }
  const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: lines.join("\n") });
  vscode.window.showTextDocument(doc, { preview: false });
}

// ───────────────────────── Voz alta ─────────────────────────
// Windows: System.Speech via PowerShell, que informa a posição de cada palavra → destacamos no editor.
// macOS/Linux: 'say' / 'spd-say' sem destaque de palavra.
const PS_SPEAK = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $env:LUME_VOICE
if ($v) { try { $s.SelectVoice($v) } catch {} }
else {
  $pt = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'pt-BR' } | Select-Object -First 1
  if ($pt) { $s.SelectVoice($pt.VoiceInfo.Name) }
}
$s.Rate = [int]$env:LUME_RATE
$text = [IO.File]::ReadAllText($env:LUME_FILE, [Text.Encoding]::UTF8)
Register-ObjectEvent -InputObject $s -EventName SpeakProgress -SourceIdentifier LumeP | Out-Null
Register-ObjectEvent -InputObject $s -EventName SpeakCompleted -SourceIdentifier LumeC | Out-Null
$null = $s.SpeakAsync($text)
while ($true) {
  $e = Wait-Event
  $id = $e.SourceIdentifier
  if ($id -eq 'LumeP') { [Console]::Out.WriteLine('W ' + $e.SourceEventArgs.CharacterPosition + ' ' + $e.SourceEventArgs.CharacterCount); [Console]::Out.Flush() }
  Remove-Event -EventIdentifier $e.EventIdentifier
  if ($id -eq 'LumeC') { break }
}
[Console]::Out.WriteLine('END')
`;
const PS_VOICES = `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }`;
const encodePs = (s) => Buffer.from(s, "utf16le").toString("base64");

// Troca sintaxe de Markdown por espaços do MESMO tamanho: a voz não lê "asterisco",
// e as posições continuam batendo com o texto do editor.
function speakable(text, lang) {
  if (lang !== "markdown" && lang !== "mdx") return text;
  return text
    .replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length))                        // blocos de código
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, (m, t) => " " + t + " ".repeat(m.length - t.length - 1)) // [texto](url)
    .replace(/<[^>\n]+>/g, (m) => " ".repeat(m.length))                               // tags html
    .replace(/[#*_`>|~]/g, " ");
}

function stopReading() {
  const r = state.reading;
  state.reading = null;
  vscode.commands.executeCommand("setContext", "lume.reading", false);
  if (r) {
    try { r.proc.kill(); } catch (_) {}
    try { fs.unlinkSync(r.file); } catch (_) {}
    if (r.editor) { r.editor.setDecorations(deco.word, []); r.editor.setDecorations(deco.sentence, []); }
  }
  updateStatus();
}

function readAloud() {
  const ed = vscode.window.activeTextEditor; if (!ed) return;
  stopReading();
  const doc = ed.document;
  const start = ed.selection.isEmpty ? doc.offsetAt(new vscode.Position(ed.selection.active.line, 0)) : doc.offsetAt(ed.selection.start);
  const end = ed.selection.isEmpty ? doc.getText().length : doc.offsetAt(ed.selection.end);
  const raw = doc.getText().slice(start, end);
  const text = speakable(raw, doc.languageId);
  if (!text.trim()) return;
  const file = path.join(os.tmpdir(), `lume-tts-${Date.now()}.txt`);
  fs.writeFileSync(file, text, "utf8");
  const c = cfg();
  let proc;
  if (process.platform === "win32") {
    proc = cp.spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePs(PS_SPEAK)], {
      env: { ...process.env, LUME_VOICE: c.get("tts.voice") || "", LUME_RATE: String(c.get("tts.rate")), LUME_FILE: file }, windowsHide: true
    });
  } else if (process.platform === "darwin") {
    proc = cp.spawn("say", ["-r", String(180 + c.get("tts.rate") * 15), "-f", file]);
  } else {
    proc = cp.spawn("spd-say", ["-w", "-l", "pt-BR", "-r", String(c.get("tts.rate") * 10), text]);
  }
  const reading = { proc, file, editor: ed, base: start, docVersion: doc.version };
  state.reading = reading;
  vscode.commands.executeCommand("setContext", "lume.reading", true);
  updateStatus();

  let buf = "";
  proc.stdout && proc.stdout.on("data", (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (state.reading !== reading) return;
      const m = /^W (\d+) (\d+)/.exec(line);
      if (m) showWord(reading, Number(m[1]), Number(m[2]));
      if (line === "END") stopReading();
    }
  });
  let err = "";
  proc.stderr && proc.stderr.on("data", (d) => { err += d.toString(); });
  proc.on("error", (e) => { vscode.window.showErrorMessage("Lume: não consegui iniciar a voz (" + e.message + ")."); stopReading(); });
  proc.on("exit", (code) => {
    if (code && state.reading === reading && err) vscode.window.showErrorMessage("Lume (voz): " + err.split("\n")[0]);
    if (state.reading === reading) stopReading();
  });
}

function showWord(r, pos, len) {
  const ed = vscode.window.visibleTextEditors.find((e) => e.document === r.editor.document);
  if (!ed) return;
  r.editor = ed;
  const doc = ed.document;
  const a = doc.positionAt(r.base + pos), b = doc.positionAt(r.base + pos + Math.max(1, len));
  const w = new vscode.Range(a, b);
  ed.setDecorations(deco.word, [w]);
  // frase atual: do último . ! ? até o próximo
  const full = doc.getText();
  const off = r.base + pos;
  let s = off, e = off;
  while (s > r.base && !/[.!?\n]/.test(full[s - 1])) s--;
  while (e < full.length && !/[.!?\n]/.test(full[e])) e++;
  ed.setDecorations(deco.sentence, [new vscode.Range(doc.positionAt(s), doc.positionAt(Math.min(full.length, e + 1)))]);
  if (cfg().get("tts.follow") && !ed.visibleRanges.some((vr) => vr.contains(w))) {
    ed.revealRange(w, vscode.TextEditorRevealType.InCenter);
  }
  if (state.guided && (ed.selection.active.line < paragraphAt(doc, a.line).start || ed.selection.active.line > paragraphAt(doc, a.line).end)) {
    ed.selection = new vscode.Selection(a, a);
  }
}

async function chooseVoice() {
  if (process.platform !== "win32") return vscode.window.showInformationMessage("A escolha de voz está disponível no Windows. No macOS/Linux é usada a voz padrão do sistema.");
  cp.execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePs(PS_VOICES)], { windowsHide: true }, async (err, out) => {
    if (err) return vscode.window.showErrorMessage("Lume: não consegui listar as vozes.");
    const items = out.split(/\r?\n/).filter(Boolean).map((l) => { const [name, lang] = l.split("|"); return { label: name, description: lang }; });
    items.sort((a, b) => (b.description === "pt-BR") - (a.description === "pt-BR"));
    items.unshift({ label: "Automática", description: "melhor voz pt-BR instalada", value: "" });
    const pick = await vscode.window.showQuickPick(items, { placeHolder: "Voz para leitura em voz alta" });
    if (pick) await cfg().update("tts.voice", pick.value === "" ? "" : pick.label, vscode.ConfigurationTarget.Global);
  });
}

// ───────────────────────── Timer ─────────────────────────
function toggleTimer() {
  if (state.timer) { clearInterval(state.timer.int); state.timer = null; return updateStatus(); }
  startTimer("focus");
}
function startTimer(phase) {
  const min = cfg().get(phase === "focus" ? "timer.focusMinutes" : "timer.breakMinutes");
  if (state.timer) clearInterval(state.timer.int);
  state.timer = { phase, endAt: Date.now() + min * 60000, int: setInterval(tick, 1000) };
  updateStatus();
}
function tick() {
  if (!state.timer) return;
  if (Date.now() >= state.timer.endAt) {
    const phase = state.timer.phase;
    clearInterval(state.timer.int); state.timer = null;
    if (phase === "focus") {
      vscode.window.showInformationMessage(`Bloco de foco concluído. Pausa de ${cfg().get("timer.breakMinutes")} min: levanta, bebe água, olha longe.`);
      startTimer("break");
    } else {
      vscode.window.showInformationMessage("Pausa acabou. Pronto para outro bloco?", "Começar").then((a) => a && startTimer("focus"));
      updateStatus();
    }
    return;
  }
  updateStatus();
}

// ───────────────────────── Modo leitura ─────────────────────────
const RM_KEYS = ["editor.fontFamily", "editor.fontSize", "editor.lineHeight", "editor.letterSpacing", "editor.wordWrap", "editor.minimap.enabled", "editor.renderWhitespace", "editor.cursorBlinking"];
async function toggleReadingMode() {
  const ed = vscode.workspace.getConfiguration();
  const backup = ctx.globalState.get("lume.rmBackup");
  const c = cfg();
  if (backup) {
    for (const k of RM_KEYS) await ed.update(k, backup[k], vscode.ConfigurationTarget.Global);
    await ctx.globalState.update("lume.rmBackup", undefined);
    if (c.get("readingMode.zen")) await vscode.commands.executeCommand("workbench.action.toggleZenMode");
    vscode.window.setStatusBarMessage("Lume: modo leitura desligado", 2500);
  } else {
    const b = {};
    for (const k of RM_KEYS) b[k] = ed.inspect(k).globalValue;
    await ctx.globalState.update("lume.rmBackup", b);
    const size = c.get("readingMode.fontSize");
    const vals = {
      "editor.fontFamily": c.get("readingMode.fontFamily"), "editor.fontSize": size,
      "editor.lineHeight": Math.round(size * c.get("readingMode.lineHeight")), "editor.letterSpacing": c.get("readingMode.letterSpacing"),
      "editor.wordWrap": "on", "editor.minimap.enabled": false, "editor.renderWhitespace": "none", "editor.cursorBlinking": "solid"
    };
    for (const k of RM_KEYS) await ed.update(k, vals[k], vscode.ConfigurationTarget.Global);
    if (c.get("readingMode.zen")) await vscode.commands.executeCommand("workbench.action.toggleZenMode");
    vscode.window.setStatusBarMessage("Lume: modo leitura ligado (Alt+L L para sair)", 3500);
  }
  updateStatus();
}

// ───────────────────────── Barra de status ─────────────────────────
let sbMain, sbTimer, sbProgress, sbRead;
function updateStatus() {
  const c = cfg();
  const on = [];
  if (c.get("bionic.enabled")) on.push("bionic");
  if (state.guided) on.push("guiada"); else if (c.get("focus.mode") !== "off") on.push("foco");
  if (ctx.globalState.get("lume.rmBackup")) on.push("leitura");
  sbMain.text = "$(eye) Lume" + (on.length ? ": " + on.join(" · ") : "");
  sbMain.tooltip = "Lume — clique para o menu (Alt+L M)";

  if (state.timer) {
    const left = Math.max(0, state.timer.endAt - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    sbTimer.text = `${state.timer.phase === "break" ? "$(coffee)" : "$(watch)"} ${m}:${String(s).padStart(2, "0")}`;
    sbTimer.backgroundColor = state.timer.phase === "focus" ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
  } else { sbTimer.text = "$(watch) foco"; sbTimer.backgroundColor = undefined; }

  sbRead.text = state.reading ? "$(debug-stop) parar leitura" : "$(unmute) ler";
  sbRead.tooltip = state.reading ? "Parar leitura (Esc)" : "Ler em voz alta a partir do cursor (Alt+L R)";
  sbRead.command = state.reading ? "lume.stopReading" : "lume.readAloud";

  const ed = vscode.window.activeTextEditor;
  if (ed && c.get("progress.enabled") && PROSE.has(ed.document.languageId) && ed.visibleRanges.length) {
    const doc = ed.document;
    const last = ed.visibleRanges[ed.visibleRanges.length - 1].end.line;
    const pct = Math.round(((last + 1) / doc.lineCount) * 100);
    const rest = doc.getText(new vscode.Range(last + 1, 0, doc.lineCount, 0));
    const words = (rest.match(/\S+/g) || []).length;
    const min = Math.round(words / c.get("progress.wpm"));
    sbProgress.text = `$(book) ${pct}%` + (words ? ` · ~${min < 1 ? "<1" : min} min` : "");
    sbProgress.tooltip = "Quanto do arquivo você já passou e tempo estimado restante";
    sbProgress.show();
  } else sbProgress.hide();
}

// ───────────────────────── Render ─────────────────────────
function render(editor) {
  if (!editor) return;
  const c = cfg();
  if (c.get("bionic.enabled")) {
    const { bold, fade } = bionicRanges(editor);
    editor.setDecorations(deco.bold, bold);
    editor.setDecorations(deco.fade, c.get("bionic.fadeRest") ? fade : []);
  } else { editor.setDecorations(deco.bold, []); editor.setDecorations(deco.fade, []); }
  const f = focusRanges(editor);
  editor.setDecorations(deco.dim, f.dim);
  editor.setDecorations(deco.guided, f.guided);
  const hl = highlightDecorations(editor);
  for (const k of Object.keys(hl)) editor.setDecorations(deco.hl[k], hl[k]);
}
let renderT;
function refreshAll(delay = 60) {
  clearTimeout(renderT);
  renderT = setTimeout(() => { vscode.window.visibleTextEditors.forEach(render); updateStatus(); }, delay);
}

// ───────────────────────── Menu ─────────────────────────
async function menu() {
  const c = cfg();
  const items = [
    { label: `$(bold) Bionic reading`, description: c.get("bionic.enabled") ? "ligado" : "desligado", cmd: "lume.toggleBionic" },
    { label: `$(target) Foco`, description: c.get("focus.mode"), cmd: "lume.cycleFocus" },
    { label: `$(list-ordered) Leitura guiada`, description: state.guided ? "ligada (Alt+J / Alt+K)" : "desligada", cmd: "lume.toggleGuided" },
    { label: `$(unmute) Ler em voz alta a partir do cursor`, cmd: "lume.readAloud" },
    { label: `$(book) Modo leitura (fonte, espaçamento, zen)`, cmd: "lume.toggleReadingMode" },
    { label: `$(watch) Timer de foco`, description: state.timer ? "rodando" : "", cmd: "lume.toggleTimer" },
    { label: `$(symbol-color) Marcar seleção`, cmd: "lume.highlight" },
    { label: `$(note) Marcar com nota`, cmd: "lume.addNote" },
    { label: `$(export) Exportar marcações`, cmd: "lume.exportHighlights" },
    { label: `$(open-preview) Abrir preview de Markdown com Lume`, cmd: "markdown.showPreviewToSide" },
    { label: `$(settings-gear) Configurações do Lume`, cmd: "workbench.action.openSettings", arg: "lume" }
  ];
  const pick = await vscode.window.showQuickPick(items, { placeHolder: "Lume" });
  if (pick) vscode.commands.executeCommand(pick.cmd, pick.arg);
}

// ───────────────────────── Preview de Markdown ─────────────────────────
function previewConfig() {
  const c = cfg();
  return {
    enabled: c.get("preview.enabled"), bionic: c.get("bionic.enabled"), strength: c.get("bionic.strength"), fade: c.get("bionic.fadeRest"),
    font: c.get("preview.font"), ruler: c.get("preview.ruler"), tint: c.get("preview.tint"), guided: state.guided,
    wpm: c.get("progress.wpm")
  };
}
function markdownItPlugin(md) {
  md.core.ruler.push("lume_cfg", (st) => {
    const t = new st.Token("html_block", "", 0);
    const json = JSON.stringify(previewConfig()).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    t.content = `<div id="lume-cfg" data-cfg="${json}" style="display:none"></div>\n`;
    st.tokens.unshift(t);
  });
  return md;
}
const refreshPreview = () => vscode.commands.executeCommand("markdown.preview.refresh").then(undefined, () => {});

// ───────────────────────── Ativação ─────────────────────────
function activate(context) {
  ctx = context;
  createDecorations();
  vscode.commands.executeCommand("setContext", "lume.guided", false);

  sbMain = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101); sbMain.command = "lume.menu"; sbMain.show();
  sbRead = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100); sbRead.show();
  sbTimer = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99); sbTimer.command = "lume.toggleTimer"; sbTimer.tooltip = "Timer de foco (Alt+L T)"; sbTimer.show();
  sbProgress = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
  context.subscriptions.push(sbMain, sbRead, sbTimer, sbProgress);

  const toggleSetting = async (key) => { await cfg().update(key, !cfg().get(key), vscode.ConfigurationTarget.Global); };
  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg("lume.menu", menu);
  reg("lume.toggleBionic", () => toggleSetting("bionic.enabled"));
  reg("lume.cycleFocus", async () => {
    const order = ["off", "line", "paragraph"];
    const next = order[(order.indexOf(cfg().get("focus.mode")) + 1) % order.length];
    await cfg().update("focus.mode", next, vscode.ConfigurationTarget.Global);
    vscode.window.setStatusBarMessage(`Lume: foco = ${{ off: "desligado", line: "linha", paragraph: "parágrafo" }[next]}`, 2000);
  });
  reg("lume.toggleGuided", () => {
    state.guided = !state.guided;
    vscode.commands.executeCommand("setContext", "lume.guided", state.guided);
    if (state.guided) vscode.window.setStatusBarMessage("Lume: leitura guiada — Alt+J próximo, Alt+K anterior", 4000);
    refreshAll(0); refreshPreview();
  });
  reg("lume.guidedNext", () => moveParagraph(1));
  reg("lume.guidedPrev", () => moveParagraph(-1));
  reg("lume.readAloud", readAloud);
  reg("lume.stopReading", stopReading);
  reg("lume.chooseVoice", chooseVoice);
  reg("lume.highlight", () => addHighlight(false));
  reg("lume.addNote", () => addHighlight(true));
  reg("lume.removeHighlight", removeHighlight);
  reg("lume.exportHighlights", exportHighlights);
  reg("lume.toggleTimer", toggleTimer);
  reg("lume.toggleReadingMode", toggleReadingMode);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => refreshAll(0)),
    vscode.window.onDidChangeVisibleTextEditors(() => refreshAll(0)),
    vscode.window.onDidChangeTextEditorVisibleRanges(() => refreshAll(80)),
    vscode.window.onDidChangeTextEditorSelection(() => refreshAll(30)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (state.reading && e.document === state.reading.editor.document) stopReading(); // posições mudaram
      if (vscode.window.visibleTextEditors.some((ed) => ed.document === e.document)) refreshAll(150);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("lume")) return;
      if (e.affectsConfiguration("lume.focus.dimOpacity")) createDecorations();
      refreshAll(0); refreshPreview();
    }),
    { dispose: () => { stopReading(); if (state.timer) clearInterval(state.timer.int); } }
  );
  refreshAll(0);
  return { extendMarkdownIt: markdownItPlugin };
}

function deactivate() { stopReading(); }

module.exports = { activate, deactivate, _test: { boldCount, commentSpans, speakable, paragraphAt } };
