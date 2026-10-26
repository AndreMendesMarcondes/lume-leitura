let S;
const get = (o, path) => path.split(".").reduce((a, k) => a?.[k], o);
const set = (o, path, v) => { const ks = path.split("."); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
const FMT = {
  pct: (v) => Math.round(v * 100) + "%", px: (v) => v + "px", x: (v) => Number(v).toFixed(1) + "×",
  em: (v) => Number(v).toFixed(2), wpm: (v) => v + " ppm", min: (v) => v + " min"
};

let saveT;
function save() { clearTimeout(saveT); saveT = setTimeout(() => chrome.storage.sync.set({ settings: S }), 120); renderOutputs(); renderDemo(); }

function renderOutputs() {
  document.querySelectorAll("output[data-o]").forEach((o) => { o.textContent = FMT[o.dataset.fmt](get(S, o.dataset.o)); });
  document.querySelectorAll("[data-sw]").forEach((box) => {
    box.querySelectorAll("button").forEach((b) => b.classList.toggle("sel", b.dataset.c === get(S, box.dataset.sw)));
  });
}

function renderDemo() {
  const txt = "Ler com foco fica bem mais fácil quando o olho tem âncoras.";
  const el = document.getElementById("bionicDemo");
  el.innerHTML = "";
  txt.split(/(\s+)/).forEach((w) => {
    if (!w.trim()) return el.append(w);
    const core = w.replace(/[.,]$/, ""), tail = w.slice(core.length);
    const n = core.length <= 3 ? 1 : Math.max(1, Math.min(core.length - 1, Math.ceil(core.length * S.bionic.strength)));
    const b = document.createElement("b"); b.textContent = core.slice(0, n);
    const r = document.createElement("span"); r.textContent = core.slice(n) + tail;
    if (S.bionic.fadeRest) r.style.opacity = ".62";
    el.append(b, r);
  });
}

function bind() {
  document.querySelectorAll("[data-k]").forEach((el) => {
    const k = el.dataset.k, v = get(S, k);
    if (el.type === "checkbox") el.checked = !!v; else el.value = v;
    el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", () => {
      let nv = el.type === "checkbox" ? el.checked : el.value;
      if (el.type === "range") nv = Number(nv);
      set(S, k, nv); save();
    });
  });
  // interruptores dentro do <summary> não devem abrir/fechar a seção
  document.querySelectorAll("summary .sw").forEach((sw) => sw.addEventListener("click", (e) => e.stopPropagation()));
  document.querySelectorAll("[data-sw]").forEach((box) => {
    box.dataset.colors.split(",").forEach((c) => {
      const b = document.createElement("button"); b.style.background = c; b.dataset.c = c; b.title = c;
      b.onclick = () => { set(S, box.dataset.sw, c); save(); };
      box.appendChild(b);
    });
  });
}

function loadVoices() {
  const sel = document.getElementById("voice");
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return;
  sel.innerHTML = "";
  const auto = new Option("Automática (melhor pt-BR)", ""); sel.add(auto);
  const sorted = [...voices].sort((a, b) => {
    const pa = /^pt/i.test(a.lang) ? 0 : 1, pb = /^pt/i.test(b.lang) ? 0 : 1;
    return pa - pb || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name);
  });
  sorted.forEach((v) => sel.add(new Option(`${v.name} (${v.lang})`, v.voiceURI)));
  sel.value = S.tts.voiceURI || "";
}

async function tab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t; }
async function send(type) {
  const t = await tab();
  try { await chrome.tabs.sendMessage(t.id, { type }); window.close(); }
  catch (_) { alert("O Lume não funciona nesta página (páginas internas do Chrome e a Web Store são bloqueadas). Se a aba já estava aberta antes de instalar, recarregue-a."); }
}

(async () => {
  const { settings } = await chrome.storage.sync.get("settings");
  S = lumeMerge(LUME_DEFAULTS, settings || {});
  bind(); renderOutputs(); renderDemo();
  loadVoices(); speechSynthesis.onvoiceschanged = loadVoices;

  const t = await tab();
  let hostName = "";
  try { hostName = new URL(t.url).hostname; } catch (_) {}
  document.getElementById("siteName").textContent = hostName || "esta página";
  const siteOn = document.getElementById("siteOn");
  siteOn.checked = !S.disabledSites.includes(hostName);
  siteOn.onchange = () => {
    S.disabledSites = S.disabledSites.filter((h) => h !== hostName);
    if (!siteOn.checked && hostName) S.disabledSites.push(hostName);
    save();
  };

  document.getElementById("qReader").onclick = () => send("reader-toggle");
  document.getElementById("qTts").onclick = () => send("tts-toggle");
  document.getElementById("qNotes").onclick = () => send("notes-open");
  document.getElementById("qTimer").onclick = async () => { await chrome.runtime.sendMessage({ type: "timer-toggle" }); window.close(); };
  document.getElementById("allNotes").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("notes.html") });
  document.getElementById("shortcuts").onclick = () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
})();
