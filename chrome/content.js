/* Lume — content script
 * Organização:
 *  1. Estado e utilidades
 *  2. UI flutuante (shadow DOM): régua, overlay, progresso, dock, barra de seleção, painel de notas
 *  3. Bionic reading
 *  4. Fontes, espaçamento, movimento
 *  5. Blocos de texto (base da leitura guiada e da voz)
 *  6. Leitura guiada
 *  7. Voz alta com palavra destacada
 *  8. Marca-texto e notas
 *  9. Modo leitor
 * 10. Timer e progresso
 * 11. Aplicar configurações / mensagens
 */
(() => {
  if (window.__lumeLoaded) return;
  window.__lumeLoaded = true;

  // ───────────────────────── 1. Estado e utilidades ─────────────────────────
  let S = lumeMerge(LUME_DEFAULTS, {});
  let active = false;
  const html = document.documentElement;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE",
    "KBD", "SAMP", "SVG", "MATH", "CANVAS", "IFRAME", "OBJECT", "TEMPLATE", "BUTTON"]);

  const pageKey = () => "hl:" + location.origin + location.pathname + location.search;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 200 }) : setTimeout(fn, 16));

  function isSkippable(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (SKIP_TAGS.has(n.tagName)) return true;
      if (n.id === "lume-host") return true;
      if (n.isContentEditable) return true;
    }
    return false;
  }

  // Lista de nós de texto "legíveis" dentro de root.
  function textNodes(root) {
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p || isSkippable(p)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }

  // Índice linear do texto de root: permite converter offset <-> (nó, posição).
  function buildIndex(root) {
    const nodes = [];
    let text = "";
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || isSkippable(p)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (w.nextNode()) {
      const n = w.currentNode;
      nodes.push({ node: n, start: text.length });
      text += n.nodeValue;
    }
    return { nodes, text };
  }
  function posAt(index, offset) {
    // busca binária do nó que contém offset
    let lo = 0, hi = index.nodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (index.nodes[mid].start <= offset) lo = mid; else hi = mid - 1;
    }
    const e = index.nodes[lo];
    if (!e) return null;
    return { node: e.node, offset: Math.min(offset - e.start, e.node.nodeValue.length) };
  }
  function rangeFromOffsets(index, start, end) {
    const a = posAt(index, start), b = posAt(index, Math.max(start, end - 1));
    if (!a || !b) return null;
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, Math.min(b.offset + 1, b.node.nodeValue.length));
    return r;
  }

  function contentRoot() {
    return document.querySelector("#lume-reader .lr-body") || document.body;
  }

  // ───────────────────────── 2. UI flutuante ─────────────────────────
  const host = document.createElement("div");
  host.id = "lume-host";
  host.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .hide { display: none !important; }
    #tint { position: fixed; inset: 0; pointer-events: none; mix-blend-mode: multiply; }
    #ruler { position: fixed; left: 0; right: 0; pointer-events: none; mix-blend-mode: multiply; }
    #maskTop, #maskBot { position: fixed; left: 0; right: 0; pointer-events: none; background: rgba(0,0,0,.55); }
    #maskTop { top: 0; } #maskBot { bottom: 0; }
    #progress { position: fixed; top: 0; left: 0; height: 3px; background: #ffb300; width: 0; pointer-events: none; transition: width .15s; }

    #dock { position: fixed; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 4px;
      background: #1f2328; color: #f2f2f2; border-radius: 999px; padding: 4px 6px; box-shadow: 0 6px 24px rgba(0,0,0,.25);
      font-size: 13px; user-select: none; }
    #dock button { all: unset; cursor: pointer; padding: 6px 8px; border-radius: 999px; line-height: 1; font-size: 13px; color: inherit; }
    #dock button:hover { background: rgba(255,255,255,.12); }
    #dock .sep { width: 1px; height: 18px; background: rgba(255,255,255,.18); }
    #dock .muted { opacity: .7; padding: 0 6px; font-variant-numeric: tabular-nums; }
    #dock.min > :not(#dockToggle) { display: none; }
    #timer.on { color: #ffd54f; font-weight: 600; font-variant-numeric: tabular-nums; }
    #timer.break { color: #81c784; }

    #selbar { position: fixed; display: flex; gap: 4px; background: #1f2328; padding: 5px; border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0,0,0,.25); }
    #selbar button { all: unset; cursor: pointer; width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center;
      font-size: 14px; color: #fff; }
    #selbar button:hover { background: rgba(255,255,255,.12); }
    #selbar .dot { width: 16px; height: 16px; border-radius: 50%; }

    #panel { position: fixed; top: 0; right: 0; width: 360px; max-width: 92vw; height: 100vh; background: #fbfbfa; color: #1d1d1f;
      box-shadow: -8px 0 30px rgba(0,0,0,.18); display: flex; flex-direction: column; font-size: 14px; }
    #panel header { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid #e7e7e7; }
    #panel header b { flex: 1; font-size: 15px; }
    #panel button { all: unset; cursor: pointer; padding: 6px 10px; border-radius: 8px; border: 1px solid #ddd; font-size: 12px; }
    #panel button:hover { background: #f0f0f0; }
    #panel .list { flex: 1; overflow: auto; padding: 8px 16px 24px; }
    #panel .item { border-left: 4px solid #ccc; padding: 8px 10px; margin: 10px 0; background: #fff; border-radius: 6px;
      box-shadow: 0 1px 2px rgba(0,0,0,.06); }
    #panel .item .t { cursor: pointer; line-height: 1.45; }
    #panel .item textarea { width: 100%; margin-top: 8px; min-height: 44px; border: 1px solid #e3e3e3; border-radius: 6px; padding: 6px;
      font-size: 13px; resize: vertical; }
    #panel .item .row { display: flex; justify-content: flex-end; margin-top: 6px; }
    #panel .empty { opacity: .6; padding: 24px 0; text-align: center; }

    #toast { position: fixed; left: 50%; bottom: 72px; transform: translateX(-50%); background: #1f2328; color: #fff;
      padding: 10px 14px; border-radius: 10px; font-size: 13px; box-shadow: 0 6px 24px rgba(0,0,0,.25); }
  </style>
  <div id="tint" class="hide"></div>
  <div id="maskTop" class="hide"></div><div id="maskBot" class="hide"></div>
  <div id="ruler" class="hide"></div>
  <div id="progress" class="hide"></div>
  <div id="dock" class="hide">
    <button id="dockToggle" title="Minimizar/expandir">◐</button>
    <button id="ttsPlay" title="Ler em voz alta / pausar">▶</button>
    <button id="ttsStop" title="Parar leitura">■</button>
    <button id="ttsSlower" title="Mais devagar">−</button>
    <span id="ttsRate" class="muted">1.0×</span>
    <button id="ttsFaster" title="Mais rápido">+</button>
    <span class="sep"></span>
    <button id="timer" title="Timer de foco (clique para iniciar/parar)">⏱ foco</button>
    <span id="remain" class="muted" title="Tempo estimado de leitura restante"></span>
    <span class="sep"></span>
    <button id="guidedBtn" title="Leitura guiada (Alt+Shift+G)">¶</button>
    <button id="readerBtn" title="Modo leitor (Alt+Shift+L)">📖</button>
    <button id="notesBtn" title="Minhas marcações nesta página">✎</button>
  </div>
  <div id="selbar" class="hide">
    <button data-color="yellow" title="Marcar amarelo"><span class="dot" style="background:#ffe600"></span></button>
    <button data-color="green" title="Marcar verde"><span class="dot" style="background:#6ee778"></span></button>
    <button data-color="pink" title="Marcar rosa"><span class="dot" style="background:#ff80bf"></span></button>
    <button data-color="blue" title="Marcar azul"><span class="dot" style="background:#6eb4ff"></span></button>
    <button id="selNote" title="Marcar com nota">✎</button>
    <button id="selRead" title="Ler em voz alta a partir daqui">🔊</button>
  </div>
  <div id="panel" class="hide">
    <header><b>Marcações</b><button id="pExport">Exportar .md</button><button id="pCopy">Copiar</button><button id="pClose">✕</button></header>
    <div class="list"></div>
  </div>
  <div id="toast" class="hide"></div>`;
  const $ = (id) => root.getElementById(id);
  (document.body || html).appendChild(host);

  let toastT;
  function toast(msg, ms = 2600) {
    const t = $("toast"); t.textContent = msg; t.classList.remove("hide");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hide"), ms);
  }

  // ───────────────────────── 3. Bionic reading ─────────────────────────
  const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
  let bionicOn = false;

  function boldCount(len) {
    if (len <= 3) return 1;
    return Math.max(1, Math.min(len - 1, Math.ceil(len * S.bionic.strength)));
  }

  function bionicNode(tn, color) {
    const text = tn.nodeValue;
    WORD_RE.lastIndex = 0;
    let m, last = 0, changed = false;
    const frag = document.createDocumentFragment();
    while ((m = WORD_RE.exec(text))) {
      const w = m[0];
      if (w.length < S.bionic.minWord) continue;
      const n = boldCount(w.length);
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const b = document.createElement("b");
      b.className = "lume-b";
      b.textContent = w.slice(0, n);
      frag.appendChild(b);
      frag.appendChild(document.createTextNode(w.slice(n)));
      last = m.index + w.length;
      changed = true;
    }
    if (!changed) return;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    const span = document.createElement("span");
    span.className = "lume-bw";
    if (color) span.style.setProperty("--lume-c", color);
    span.appendChild(frag);
    tn.parentNode.replaceChild(span, tn);
  }

  function bionicApply(rootEl) {
    const nodes = textNodes(rootEl).filter((n) => !n.parentElement.closest(".lume-bw"));
    let i = 0;
    const step = () => {
      if (!bionicOn) return;
      const chunk = nodes.slice(i, i + 250);
      i += chunk.length;
      // lê cores primeiro, escreve depois (evita recalcular layout a cada nó)
      const colors = chunk.map((n) => (n.isConnected ? getComputedStyle(n.parentElement).color : null));
      observer.disconnect();
      chunk.forEach((n, k) => { if (n.isConnected) bionicNode(n, colors[k]); });
      observe();
      if (i < nodes.length) idle(step);
    };
    step();
  }

  function bionicRemove() {
    observer.disconnect();
    const parents = new Set();
    document.querySelectorAll("b.lume-b").forEach((b) => { b.replaceWith(...b.childNodes); });
    document.querySelectorAll("span.lume-bw").forEach((s) => { parents.add(s.parentNode); s.replaceWith(...s.childNodes); });
    parents.forEach((p) => p && p.normalize && p.normalize());
    observe();
  }

  // Conteúdo que chega depois (scroll infinito, SPA)
  const pending = new Set();
  const flushPending = debounce(() => {
    const items = [...pending]; pending.clear();
    if (bionicOn) items.forEach((el) => el.isConnected && bionicApply(el));
    if (S.guided.on) guidedRefresh();
    progressRecount();
  }, 400);
  const observer = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1) {
        if (n.id === "lume-host" || n.classList?.contains("lume-bw") || n.classList?.contains("lume-b") || n.tagName === "MARK") continue;
        pending.add(n);
      } else if (n.nodeType === 3 && n.parentElement && !n.parentElement.closest(".lume-bw")) {
        pending.add(n.parentElement);
      }
    }
    if (pending.size) flushPending();
  });
  function observe() { if (document.body) observer.observe(document.body, { childList: true, subtree: true }); }

  // ───────────────────────── 4. Fontes, espaçamento, movimento ─────────────────────────
  const FONTS = {
    lexend: '"Lume Lexend", sans-serif',
    atkinson: '"Lume Atkinson", sans-serif',
    opendyslexic: '"Lume OpenDyslexic", sans-serif',
    arial: "Arial, Helvetica, sans-serif",
    verdana: "Verdana, Geneva, sans-serif"
  };
  function applyTypography() {
    const f = active && FONTS[S.font.family];
    if (f) { html.setAttribute("data-lume-font", S.font.family); html.style.setProperty("--lume-font", f); }
    else { html.removeAttribute("data-lume-font"); html.style.removeProperty("--lume-font"); }

    const sp = active && S.spacing.on;
    html.classList.toggle("lume-spacing", !!sp);
    if (sp) {
      html.style.setProperty("--lume-lh", S.spacing.lineHeight);
      html.style.setProperty("--lume-ls", S.spacing.letterSpacing + "em");
      html.style.setProperty("--lume-ws", S.spacing.wordSpacing + "em");
    }
    const still = active && S.motion.reduce;
    html.classList.toggle("lume-still", !!still);
    if (still) document.querySelectorAll("video[autoplay]").forEach((v) => { try { v.pause(); } catch (_) {} });
    html.classList.toggle("lume-fade", !!(active && S.bionic.on && S.bionic.fadeRest));
  }

  // ───────────────────────── 5. Blocos de texto ─────────────────────────
  const BLOCK_SEL = "p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, figcaption, td, th, pre";
  function getBlocks() {
    const r = contentRoot();
    const inReader = !!document.querySelector("#lume-reader");
    let list = [...r.querySelectorAll(BLOCK_SEL)].filter((el) => {
      if (el.closest("#lume-host")) return false;
      if (!inReader && el.closest("nav, footer, aside, header, [role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true]")) return false;
      if ((el.textContent || "").trim().length < 2) return false;
      if (!el.getClientRects().length) return false;
      return true;
    });
    // remove blocos que contêm outro bloco (ex.: <li><p>…</p></li> → fica o <p>)
    const set = new Set(list);
    list = list.filter((el) => ![...el.querySelectorAll(BLOCK_SEL)].some((c) => set.has(c)));
    return list;
  }
  function firstVisibleIndex(blocks) {
    const i = blocks.findIndex((b) => b.getBoundingClientRect().bottom > 80);
    return i < 0 ? 0 : i;
  }

  // ───────────────────────── 6. Leitura guiada ─────────────────────────
  let gBlocks = [], gIdx = -1;
  function guidedEnable() {
    html.classList.add("lume-guided");
    guidedRefresh(true);
  }
  function guidedRefresh(reset) {
    const cur = gBlocks[gIdx];
    gBlocks.forEach((b) => b.classList.remove("lume-blk", "lume-cur"));
    gBlocks = getBlocks();
    gBlocks.forEach((b) => b.classList.add("lume-blk"));
    gIdx = !reset && cur ? gBlocks.indexOf(cur) : -1;
    if (gIdx < 0) gIdx = firstVisibleIndex(gBlocks);
    guidedSet(gIdx, false);
  }
  function guidedDisable() {
    html.classList.remove("lume-guided");
    gBlocks.forEach((b) => b.classList.remove("lume-blk", "lume-cur"));
    gBlocks = []; gIdx = -1;
  }
  function guidedSet(i, scroll = true) {
    if (!gBlocks.length) return;
    gIdx = Math.max(0, Math.min(gBlocks.length - 1, i));
    gBlocks.forEach((b) => b.classList.remove("lume-cur"));
    const el = gBlocks[gIdx];
    el.classList.add("lume-cur");
    if (scroll) el.scrollIntoView({ block: "center", behavior: S.motion.reduce ? "auto" : "smooth" });
  }
  document.addEventListener("keydown", (e) => {
    if (!active) return;
    const tag = (e.target.tagName || "");
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.target.isContentEditable) return;
    if (S.guided.on && e.altKey && !e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      guidedSet(gIdx + (e.key === "ArrowDown" ? 1 : -1));
    }
    if (e.key === "Escape") {
      if (!$("panel").classList.contains("hide")) $("panel").classList.add("hide");
      else if (readerOpen) readerClose();
    }
  }, true);
  document.addEventListener("click", (e) => {
    if (!active || !S.guided.on) return;
    const b = e.target.closest && e.target.closest(".lume-blk");
    if (b && !e.target.closest("a")) guidedSet(gBlocks.indexOf(b), false);
  }, true);

  // ───────────────────────── 7. Voz alta ─────────────────────────
  const synth = window.speechSynthesis;
  const hasHL = !!(window.CSS && CSS.highlights && window.Highlight);
  let tts = { playing: false, paused: false, session: 0, blocks: [], i: 0 };

  function pickVoice() {
    const voices = synth.getVoices();
    if (!voices.length) return null;
    if (S.tts.voiceURI) { const v = voices.find((x) => x.voiceURI === S.tts.voiceURI); if (v) return v; }
    const pt = voices.filter((v) => /^pt(-|_)BR/i.test(v.lang));
    return pt.find((v) => /natural|online/i.test(v.name)) || pt.find((v) => /google/i.test(v.name)) || pt[0]
      || voices.find((v) => v.default) || voices[0];
  }
  function clearSpeechHL() {
    if (!hasHL) return;
    CSS.highlights.delete("lume-word"); CSS.highlights.delete("lume-sentence");
  }
  // Divide em pedaços curtos (frases): o Chrome corta falas longas (~15 s) em algumas vozes.
  function chunks(text) {
    const out = [];
    const re = /[^.!?;:\n]+[.!?;:\n]*\s*/g;
    let m;
    while ((m = re.exec(text))) {
      let s = m[0], base = m.index;
      while (s.length > 220) {
        let cut = s.lastIndexOf(" ", 220); if (cut < 80) cut = 220;
        out.push({ text: s.slice(0, cut), base }); base += cut; s = s.slice(cut);
      }
      if (s.trim()) out.push({ text: s, base });
    }
    return out;
  }

  function ttsStart(fromBlock) {
    ttsStop(true);
    const blocks = getBlocks();
    if (!blocks.length) return toast("Não achei texto para ler aqui.");
    let i = fromBlock ? blocks.indexOf(fromBlock) : -1;
    if (i < 0 && S.guided.on && gBlocks[gIdx]) i = blocks.indexOf(gBlocks[gIdx]);
    if (i < 0) i = firstVisibleIndex(blocks);
    tts = { playing: true, paused: false, session: tts.session + 1, blocks, i };
    updateDock();
    speakBlock(tts.session);
  }
  function speakBlock(session) {
    if (session !== tts.session || !tts.playing) return;
    const block = tts.blocks[tts.i];
    if (!block) { ttsStop(); toast("Fim da leitura."); return; }
    if (!block.isConnected) { tts.i++; return speakBlock(session); }
    if (S.guided.on) { const g = gBlocks.indexOf(block); if (g >= 0) guidedSet(g, false); }
    if (S.tts.followScroll) block.scrollIntoView({ block: "center", behavior: S.motion.reduce ? "auto" : "smooth" });

    const index = buildIndex(block);
    const parts = chunks(index.text);
    let k = 0;
    const next = () => {
      if (session !== tts.session || !tts.playing) return;
      if (k >= parts.length) { tts.i++; return speakBlock(session); }
      const part = parts[k++];
      const u = new SpeechSynthesisUtterance(part.text);
      const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "pt-BR";
      u.rate = S.tts.rate;
      if (hasHL) {
        const sr = rangeFromOffsets(index, part.base, part.base + part.text.trimEnd().length);
        if (sr) CSS.highlights.set("lume-sentence", new Highlight(sr));
      }
      u.onboundary = (e) => {
        if (!hasHL || session !== tts.session || e.name && e.name !== "word") return;
        const start = part.base + e.charIndex;
        let len = e.charLength;
        if (!len) { const m = /^[^\s]+/.exec(part.text.slice(e.charIndex)); len = m ? m[0].length : 1; }
        const r = rangeFromOffsets(index, start, start + len);
        if (r) CSS.highlights.set("lume-word", new Highlight(r));
      };
      u.onend = () => next();
      u.onerror = (e) => { if (e.error !== "interrupted" && e.error !== "canceled") next(); };
      synth.speak(u);
    };
    next();
  }
  function ttsPauseResume() {
    if (!tts.playing) return ttsStart();
    if (tts.paused) { synth.resume(); tts.paused = false; } else { synth.pause(); tts.paused = true; }
    updateDock();
  }
  function ttsStop(silent) {
    tts.session++; tts.playing = false; tts.paused = false;
    synth.cancel(); clearSpeechHL();
    if (!silent) updateDock();
  }
  function blockOfSelection() {
    const sel = getSelection();
    if (!sel || !sel.rangeCount) return null;
    let n = sel.getRangeAt(0).startContainer;
    if (n.nodeType === 3) n = n.parentElement;
    const blocks = getBlocks();
    return blocks.find((b) => b.contains(n)) || null;
  }
  synth.onvoiceschanged = () => {};

  // ───────────────────────── 8. Marca-texto e notas ─────────────────────────
  let highlights = [];
  const uid = () => Math.random().toString(36).slice(2, 10);

  async function loadHighlights() {
    const key = pageKey();
    const data = await chrome.storage.local.get(key);
    highlights = (data[key] && data[key].items) || [];
  }
  async function saveHighlights() {
    const key = pageKey();
    if (!highlights.length) return chrome.storage.local.remove(key);
    await chrome.storage.local.set({ [key]: { url: location.href, title: document.title, updated: Date.now(), items: highlights } });
  }

  function wrapRange(range, h) {
    // Envolve cada pedaço de texto do range num <mark>. Funciona mesmo cruzando vários elementos.
    const nodes = [];
    const w = document.createTreeWalker(range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT);
    while (w.nextNode()) if (range.intersectsNode(w.currentNode)) nodes.push(w.currentNode);
    const sc = range.startContainer, so = range.startOffset, ec = range.endContainer, eo = range.endOffset;
    nodes.forEach((n) => {
      if (isSkippable(n.parentElement)) return;
      // espaço em branco só entra se estiver dentro de texto corrido (não entre blocos)
      if (!n.nodeValue.trim() && !getComputedStyle(n.parentElement).display.startsWith("inline")) return;
      let s = n === sc ? so : 0, e = n === ec ? eo : n.nodeValue.length;
      if (e <= s) return;
      let target = n;
      if (e < target.nodeValue.length) target.splitText(e);
      if (s > 0) target = target.splitText(s);
      const m = document.createElement("mark");
      m.className = "lume-hl"; m.dataset.id = h.id; m.dataset.color = h.color; m.dataset.note = h.note || "";
      if (h.note) m.title = h.note;
      target.parentNode.replaceChild(m, target);
      m.appendChild(target);
    });
  }
  function unwrapHighlight(id) {
    document.querySelectorAll(`mark.lume-hl[data-id="${id}"]`).forEach((m) => { const p = m.parentNode; m.replaceWith(...m.childNodes); p.normalize(); });
  }

  function anchorHighlight(index, h) {
    // procura o texto exato; desempata pelo contexto antes/depois
    let best = -1, bestScore = -1, from = 0;
    for (;;) {
      const at = index.text.indexOf(h.text, from);
      if (at < 0) break;
      const pre = index.text.slice(Math.max(0, at - h.prefix.length), at);
      const suf = index.text.slice(at + h.text.length, at + h.text.length + h.suffix.length);
      const score = (pre === h.prefix ? 2 : pre.endsWith(h.prefix.slice(-8)) ? 1 : 0) + (suf === h.suffix ? 2 : suf.startsWith(h.suffix.slice(0, 8)) ? 1 : 0);
      if (score > bestScore) { best = at; bestScore = score; }
      from = at + 1;
    }
    if (best < 0) return false;
    const r = rangeFromOffsets(index, best, best + h.text.length);
    if (!r) return false;
    wrapRange(r, h);
    return true;
  }
  function renderHighlights() {
    document.querySelectorAll("mark.lume-hl").forEach((m) => { const p = m.parentNode; m.replaceWith(...m.childNodes); p.normalize(); });
    if (!highlights.length) return;
    observer.disconnect();
    highlights.forEach((h) => anchorHighlight(buildIndex(contentRoot()), h));
    observe();
  }

  function rangeToOffsets(index, range) {
    let start = -1, end = -1;
    for (const e of index.nodes) {
      if (!range.intersectsNode(e.node)) continue;
      const s = e.node === range.startContainer ? range.startOffset : 0;
      const en = e.node === range.endContainer ? range.endOffset : e.node.nodeValue.length;
      if (start < 0) start = e.start + s;
      end = e.start + en;
    }
    return start < 0 || end <= start ? null : { start, end };
  }

  async function highlightSelection(color, withNote) {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return toast("Selecione um trecho primeiro.");
    const range = sel.getRangeAt(0);
    const index = buildIndex(contentRoot());
    const off = rangeToOffsets(index, range);
    if (!off) return;
    // apara espaços nas pontas
    let { start, end } = off;
    while (start < end && /\s/.test(index.text[start])) start++;
    while (end > start && /\s/.test(index.text[end - 1])) end--;
    if (end <= start) return;
    const note = withNote ? (prompt("Nota para este trecho:") || "") : "";
    const h = {
      id: uid(), color: color || S.highlightColor, note, created: Date.now(),
      text: index.text.slice(start, end),
      prefix: index.text.slice(Math.max(0, start - 32), start),
      suffix: index.text.slice(end, end + 32)
    };
    observer.disconnect();
    const r = rangeFromOffsets(index, start, end);
    if (r) wrapRange(r, h);
    observe();
    sel.removeAllRanges();
    highlights.push(h);
    await saveHighlights();
    hideSelbar();
    if (!$("panel").classList.contains("hide")) renderPanel();
  }

  // barra que aparece ao selecionar texto
  function hideSelbar() { $("selbar").classList.add("hide"); }
  document.addEventListener("mouseup", (e) => {
    if (!active || e.composedPath().includes(host)) return;
    setTimeout(() => {
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || sel.toString().trim().length < 2) return hideSelbar();
      const a = sel.anchorNode && (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode);
      if (a && (isSkippable(a) && !a.closest("pre, code"))) return hideSelbar();
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const bar = $("selbar");
      bar.classList.remove("hide");
      const top = rect.top > 50 ? rect.top - 42 : rect.bottom + 8;
      bar.style.top = top + "px";
      bar.style.left = Math.max(8, Math.min(innerWidth - 230, rect.left + rect.width / 2 - 110)) + "px";
    }, 10);
  });
  document.addEventListener("mousedown", (e) => { if (!e.composedPath().includes(host)) hideSelbar(); });
  root.querySelectorAll("#selbar [data-color]").forEach((b) =>
    b.addEventListener("mousedown", (e) => { e.preventDefault(); highlightSelection(b.dataset.color, false); }));
  $("selNote").addEventListener("mousedown", (e) => { e.preventDefault(); highlightSelection(null, true); });
  $("selRead").addEventListener("mousedown", (e) => { e.preventDefault(); const b = blockOfSelection(); hideSelbar(); ttsStart(b); });

  // clicar numa marcação abre o painel nela
  document.addEventListener("click", (e) => {
    const m = e.target.closest && e.target.closest("mark.lume-hl");
    if (!m || !active) return;
    openPanel(m.dataset.id);
  });

  const COLOR_HEX = { yellow: "#e6c800", green: "#3fbf4a", pink: "#ff5aa8", blue: "#3d8bfd" };
  function renderPanel(focusId) {
    const list = root.querySelector("#panel .list");
    list.innerHTML = "";
    if (!highlights.length) {
      list.innerHTML = `<div class="empty">Nenhuma marcação ainda.<br>Selecione um trecho e escolha uma cor.</div>`;
      return;
    }
    highlights.forEach((h) => {
      const it = document.createElement("div");
      it.className = "item"; it.style.borderLeftColor = COLOR_HEX[h.color] || "#ccc";
      const t = document.createElement("div"); t.className = "t"; t.textContent = h.text;
      t.title = "Ir até o trecho";
      t.onclick = () => {
        const m = document.querySelector(`mark.lume-hl[data-id="${h.id}"]`);
        if (m) { m.scrollIntoView({ block: "center" }); m.classList.add("lume-flash"); setTimeout(() => m.classList.remove("lume-flash"), 1200); }
      };
      const ta = document.createElement("textarea"); ta.placeholder = "Nota…"; ta.value = h.note || "";
      ta.onchange = async () => {
        h.note = ta.value; await saveHighlights();
        document.querySelectorAll(`mark.lume-hl[data-id="${h.id}"]`).forEach((m) => { m.dataset.note = h.note; m.title = h.note; });
      };
      const row = document.createElement("div"); row.className = "row";
      const del = document.createElement("button"); del.textContent = "Remover";
      del.onclick = async () => { unwrapHighlight(h.id); highlights = highlights.filter((x) => x.id !== h.id); await saveHighlights(); renderPanel(); };
      row.appendChild(del);
      it.append(t, ta, row);
      list.appendChild(it);
      if (focusId === h.id) setTimeout(() => { it.scrollIntoView({ block: "center" }); ta.focus(); }, 30);
    });
  }
  function openPanel(focusId) { $("panel").classList.remove("hide"); renderPanel(focusId); }
  function toMarkdown() {
    const lines = [`# ${document.title}`, "", `<${location.href}>`, ""];
    highlights.forEach((h) => { lines.push(`> ${h.text.replace(/\s+/g, " ").trim()}`); if (h.note) lines.push("", `**Nota:** ${h.note}`); lines.push(""); });
    return lines.join("\n");
  }
  $("pClose").onclick = () => $("panel").classList.add("hide");
  $("pCopy").onclick = async () => { await navigator.clipboard.writeText(toMarkdown()); toast("Copiado em Markdown."); };
  $("pExport").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toMarkdown()], { type: "text/markdown" }));
    a.download = (document.title || "marcacoes").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) + ".md";
    root.appendChild(a); a.click(); a.remove();
  };

  // ───────────────────────── 9. Modo leitor ─────────────────────────
  let readerOpen = false, readerScroll = 0;
  function readerOpenFn() {
    let art = null;
    try {
      // limpa o clone das nossas marcações antes de extrair (Readability remove classes)
      const clone = document.cloneNode(true);
      clone.getElementById("lume-host")?.remove();
      clone.querySelectorAll("b.lume-b, span.lume-bw, mark.lume-hl").forEach((el) => el.replaceWith(...el.childNodes));
      clone.body && clone.body.normalize();
      art = new Readability(clone, { charThreshold: 300 }).parse();
    } catch (_) {}
    if (!art || !art.content) return toast("Não consegui achar o texto principal desta página.");
    ttsStop(true);
    readerScroll = scrollY;
    const r = document.createElement("div");
    r.id = "lume-reader";
    r.innerHTML = `
      <div class="lr-bar">
        <button data-act="smaller" title="Diminuir texto">A−</button>
        <button data-act="bigger" title="Aumentar texto">A+</button>
        <button data-act="narrow" title="Coluna mais estreita">⇥⇤</button>
        <button data-act="wide" title="Coluna mais larga">⇤⇥</button>
        <button data-act="theme" title="Trocar tema">Tema</button>
        <button data-act="close" title="Fechar (Esc)">Fechar ✕</button>
      </div>
      <div class="lr-wrap">
        <h1 class="lr-title"></h1>
        <div class="lr-meta"></div>
        <div class="lr-body"></div>
      </div>`;
    r.querySelector(".lr-title").textContent = art.title || document.title;
    const words = (art.textContent || "").trim().split(/\s+/).length;
    r.querySelector(".lr-meta").textContent = [art.byline, art.siteName, `~${Math.max(1, Math.round(words / S.progress.wpm))} min de leitura`].filter(Boolean).join(" · ");
    r.querySelector(".lr-body").innerHTML = art.content;
    r.querySelector(".lr-bar").addEventListener("click", (e) => {
      const act = e.target.closest("button")?.dataset.act;
      if (!act) return;
      if (act === "close") return readerClose();
      const s = lumeMerge(S, {});
      if (act === "smaller") s.reader.size = Math.max(14, s.reader.size - 1);
      if (act === "bigger") s.reader.size = Math.min(34, s.reader.size + 1);
      if (act === "narrow") s.reader.width = Math.max(40, s.reader.width - 5);
      if (act === "wide") s.reader.width = Math.min(110, s.reader.width + 5);
      if (act === "theme") s.reader.theme = { light: "sepia", sepia: "dark", dark: "light" }[s.reader.theme] || "sepia";
      chrome.storage.sync.set({ settings: s });
    });
    observer.disconnect();
    document.body.appendChild(r);
    observe();
    readerOpen = true;
    html.classList.add("lume-reading");
    applyReaderVars();
    scrollTo(0, 0);
    afterContentChange();
  }
  function readerClose() {
    ttsStop(true);
    document.getElementById("lume-reader")?.remove();
    html.classList.remove("lume-reading", "lume-theme-light", "lume-theme-sepia", "lume-theme-dark");
    readerOpen = false;
    scrollTo(0, readerScroll);
    afterContentChange();
  }
  function applyReaderVars() {
    if (!readerOpen) return;
    html.classList.remove("lume-theme-light", "lume-theme-sepia", "lume-theme-dark");
    html.classList.add("lume-theme-" + S.reader.theme);
    html.style.setProperty("--lr-width", S.reader.width + "ch");
    html.style.setProperty("--lr-size", S.reader.size + "px");
  }
  function afterContentChange() {
    if (bionicOn && readerOpen) bionicApply(contentRoot());
    renderHighlights();
    if (S.guided.on && active) guidedRefresh(true);
    progressRecount();
    updateDock();
  }

  // ───────────────────────── 10. Timer e progresso ─────────────────────────
  let timerState = null;
  async function loadTimer() { timerState = (await chrome.storage.local.get("timer")).timer || null; renderTimer(); }
  function renderTimer() {
    const el = $("timer");
    if (!timerState || timerState.endAt <= Date.now()) { el.textContent = "⏱ foco"; el.className = ""; return; }
    const left = Math.max(0, timerState.endAt - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    el.textContent = (timerState.phase === "break" ? "☕ " : "⏱ ") + `${m}:${String(s).padStart(2, "0")}`;
    el.className = timerState.phase === "break" ? "on break" : "on";
  }
  setInterval(() => {
    if (active && timerState) renderTimer();
    if (!host.isConnected && document.body) document.body.appendChild(host); // SPA trocou o body
  }, 1000);
  $("timer").onclick = () => chrome.runtime.sendMessage({ type: "timer-toggle" });

  let totalWords = 0;
  const progressRecount = debounce(() => {
    const r = contentRoot();
    totalWords = (r.innerText || "").trim().split(/\s+/).filter(Boolean).length;
    progressUpdate();
  }, 300);
  function progressUpdate() {
    if (!active || !S.progress.on) return;
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const f = Math.min(1, Math.max(0, scrollY / max));
    $("progress").style.width = (f * 100).toFixed(1) + "%";
    const min = Math.round((totalWords * (1 - f)) / S.progress.wpm);
    $("remain").textContent = totalWords > 150 ? (min < 1 ? "<1 min" : `~${min} min`) : "";
  }
  addEventListener("scroll", () => requestAnimationFrame(progressUpdate), { passive: true });

  // régua segue o mouse
  let mouseY = innerHeight / 2;
  function placeRuler() {
    if (!active || !S.ruler.on) return;
    const h = S.ruler.height, top = Math.max(0, mouseY - h / 2);
    if (S.ruler.mode === "mask") {
      $("maskTop").style.height = top + "px";
      $("maskBot").style.height = Math.max(0, innerHeight - top - h) + "px";
    } else {
      $("ruler").style.top = top + "px";
    }
  }
  addEventListener("mousemove", (e) => { mouseY = e.clientY; requestAnimationFrame(placeRuler); }, { passive: true });

  // ───────────────────────── dock ─────────────────────────
  function updateDock() {
    $("ttsPlay").textContent = tts.playing && !tts.paused ? "❚❚" : "▶";
    $("ttsRate").textContent = S.tts.rate.toFixed(1) + "×";
    $("guidedBtn").style.color = S.guided.on ? "#ffd54f" : "";
    $("readerBtn").style.opacity = readerOpen ? "1" : ".85";
  }
  $("dockToggle").onclick = () => {
    $("dock").classList.toggle("min");
    chrome.storage.local.set({ dockMin: $("dock").classList.contains("min") });
  };
  $("ttsPlay").onclick = () => ttsPauseResume();
  $("ttsStop").onclick = () => ttsStop();
  const setRate = (d) => {
    const s = lumeMerge(S, {}); s.tts.rate = Math.round(Math.min(2.5, Math.max(0.5, s.tts.rate + d)) * 10) / 10;
    chrome.storage.sync.set({ settings: s });
    if (tts.playing) { const i = tts.i; ttsStop(true); tts.i = i; setTimeout(() => ttsStart(tts.blocks[i] || null), 50); }
  };
  $("ttsSlower").onclick = () => setRate(-0.1);
  $("ttsFaster").onclick = () => setRate(+0.1);
  $("guidedBtn").onclick = () => { const s = lumeMerge(S, {}); s.guided.on = !s.guided.on; chrome.storage.sync.set({ settings: s }); };
  $("readerBtn").onclick = () => (readerOpen ? readerClose() : readerOpenFn());
  $("notesBtn").onclick = () => ($("panel").classList.contains("hide") ? openPanel() : $("panel").classList.add("hide"));

  // ───────────────────────── 11. Aplicar configurações ─────────────────────────
  function apply(prev) {
    active = S.enabled && !S.disabledSites.includes(location.hostname);

    applyTypography();

    // bionic
    const wantBionic = active && S.bionic.on;
    const strengthChanged = prev && (prev.bionic.strength !== S.bionic.strength || prev.bionic.minWord !== S.bionic.minWord);
    if (wantBionic && (!bionicOn || strengthChanged)) { if (bionicOn) bionicRemove(); bionicOn = true; bionicApply(document.body); }
    else if (!wantBionic && bionicOn) { bionicOn = false; bionicRemove(); }

    // overlay de cor
    const tint = $("tint");
    tint.classList.toggle("hide", !(active && S.tint.on));
    tint.style.background = S.tint.color; tint.style.opacity = S.tint.opacity;

    // régua
    const rulerOn = active && S.ruler.on;
    $("ruler").classList.toggle("hide", !(rulerOn && S.ruler.mode === "line"));
    $("maskTop").classList.toggle("hide", !(rulerOn && S.ruler.mode === "mask"));
    $("maskBot").classList.toggle("hide", !(rulerOn && S.ruler.mode === "mask"));
    $("ruler").style.height = S.ruler.height + "px";
    $("ruler").style.background = S.ruler.color;
    $("ruler").style.opacity = S.ruler.opacity;
    placeRuler();

    // guiada
    if (active && S.guided.on) { if (!html.classList.contains("lume-guided")) guidedEnable(); }
    else if (html.classList.contains("lume-guided")) guidedDisable();

    // progresso e dock
    $("progress").classList.toggle("hide", !(active && S.progress.on));
    $("dock").classList.toggle("hide", !active);
    if (!active) { ttsStop(true); hideSelbar(); $("panel").classList.add("hide"); if (readerOpen) readerClose(); }

    applyReaderVars();
    updateDock();
    progressRecount();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) {
      const prev = S;
      S = lumeMerge(LUME_DEFAULTS, changes.settings.newValue || {});
      apply(prev);
    }
    if (area === "local" && changes.timer) { timerState = changes.timer.newValue || null; renderTimer(); }
  });

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    switch (msg.type) {
      case "reader-toggle": readerOpen ? readerClose() : readerOpenFn(); break;
      case "tts-toggle": ttsPauseResume(); break;
      case "tts-from-selection": ttsStart(blockOfSelection()); break;
      case "tts-stop": ttsStop(); break;
      case "highlight-selection": highlightSelection(null, false); break;
      case "notes-open": openPanel(); break;
      case "status": reply({ readerOpen, playing: tts.playing, host: location.hostname }); return;
    }
    reply && reply(true);
  });

  (async () => {
    const { settings } = await chrome.storage.sync.get("settings");
    S = lumeMerge(LUME_DEFAULTS, settings || {});
    const { dockMin } = await chrome.storage.local.get("dockMin");
    if (dockMin) $("dock").classList.add("min");
    await loadHighlights();
    apply(null);
    renderHighlights();
    loadTimer();
    observe();
  })();
})();
