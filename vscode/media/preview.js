// Lume no preview de Markdown do VS Code
(function () {
  const SKIP = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "KBD", "SAMP", "SVG", "MATH", "TEXTAREA", "INPUT", "BUTTON"]);
  const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
  const BLOCK_SEL = "p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, td, th";
  const html = document.documentElement;

  function readCfg() {
    const el = document.getElementById("lume-cfg");
    try { return JSON.parse(el.dataset.cfg); } catch (_) { return null; }
  }
  function skippable(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (SKIP.has(n.tagName) || n.classList.contains("katex") || n.id === "lume-ui") return true;
    }
    return false;
  }
  function bionic(cfg) {
    const nodes = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p || skippable(p) || p.closest(".lume-bw")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach((tn) => {
      const text = tn.nodeValue; WORD_RE.lastIndex = 0;
      let m, last = 0, changed = false;
      const frag = document.createDocumentFragment();
      while ((m = WORD_RE.exec(text))) {
        const len = m[0].length; if (len < 2) continue;
        const n = len <= 3 ? 1 : Math.max(1, Math.min(len - 1, Math.ceil(len * cfg.strength)));
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const b = document.createElement("b"); b.className = "lume-b"; b.textContent = m[0].slice(0, n);
        const r = document.createElement("span"); r.className = "lume-r"; r.textContent = m[0].slice(n);
        frag.append(b, r); last = m.index + len; changed = true;
      }
      if (!changed) return;
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      const span = document.createElement("span"); span.className = "lume-bw"; span.appendChild(frag);
      tn.parentNode.replaceChild(span, tn);
    });
  }
  function unbionic() {
    document.querySelectorAll("span.lume-bw").forEach((s) => s.replaceWith(document.createTextNode(s.textContent)));
    document.body.normalize();
  }

  // UI: régua, filtro, progresso
  let ui = document.getElementById("lume-ui");
  function ensureUi() {
    if (ui && ui.isConnected) return;
    ui = document.createElement("div"); ui.id = "lume-ui";
    ui.innerHTML = `<div class="lume-tint"></div><div class="lume-ruler"></div><div class="lume-progress"></div>`;
    document.body.appendChild(ui);
  }
  let mouseY = innerHeight / 2;
  addEventListener("mousemove", (e) => { mouseY = e.clientY; const r = ui && ui.querySelector(".lume-ruler"); if (r) r.style.top = (mouseY - 21) + "px"; }, { passive: true });
  addEventListener("scroll", () => {
    const p = ui && ui.querySelector(".lume-progress"); if (!p) return;
    const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    p.style.width = Math.min(100, (scrollY / max) * 100) + "%";
  }, { passive: true });

  // leitura guiada: Alt+↓ / Alt+↑ ou clique
  let blocks = [], idx = 0;
  function guidedSetup(on) {
    document.querySelectorAll(".lume-blk").forEach((b) => b.classList.remove("lume-blk", "lume-cur"));
    html.classList.toggle("lume-guided", on);
    if (!on) return;
    const all = [...document.querySelectorAll(BLOCK_SEL)].filter((b) => b.textContent.trim() && !b.closest("#lume-ui"));
    const set = new Set(all);
    blocks = all.filter((b) => ![...b.querySelectorAll(BLOCK_SEL)].some((c) => set.has(c)));
    blocks.forEach((b) => b.classList.add("lume-blk"));
    idx = Math.max(0, blocks.findIndex((b) => b.getBoundingClientRect().bottom > 40));
    setCur(idx, false);
  }
  function setCur(i, scroll = true) {
    if (!blocks.length) return;
    idx = Math.max(0, Math.min(blocks.length - 1, i));
    blocks.forEach((b) => b.classList.remove("lume-cur"));
    blocks[idx].classList.add("lume-cur");
    if (scroll) blocks[idx].scrollIntoView({ block: "center", behavior: "smooth" });
  }
  addEventListener("keydown", (e) => {
    if (!html.classList.contains("lume-guided") || !e.altKey) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCur(idx + 1); }
    if (e.key === "ArrowUp") { e.preventDefault(); setCur(idx - 1); }
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".lume-blk");
    if (b && html.classList.contains("lume-guided")) setCur(blocks.indexOf(b), false);
  });

  function apply() {
    const cfg = readCfg();
    if (!cfg || !cfg.enabled) { html.removeAttribute("data-lume-font"); html.classList.remove("lume-on", "lume-fade", "lume-guided"); unbionic(); return; }
    ensureUi();
    html.classList.add("lume-on");
    if (cfg.font && cfg.font !== "default") html.setAttribute("data-lume-font", cfg.font); else html.removeAttribute("data-lume-font");
    html.classList.toggle("lume-fade", !!(cfg.bionic && cfg.fade));
    if (cfg.bionic) bionic(cfg); else unbionic();
    ui.querySelector(".lume-ruler").style.display = cfg.ruler ? "block" : "none";
    const tint = ui.querySelector(".lume-tint");
    tint.style.display = cfg.tint ? "block" : "none"; if (cfg.tint) tint.style.background = cfg.tint;
    guidedSetup(!!cfg.guided);
  }

  window.addEventListener("vscode.markdown.updateContent", () => setTimeout(apply, 0));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply); else apply();
})();
