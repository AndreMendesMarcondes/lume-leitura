importScripts("defaults.js");

async function getSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  return lumeMerge(LUME_DEFAULTS, settings || {});
}
async function saveSettings(s) { await chrome.storage.sync.set({ settings: s }); }

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
async function sendToTab(msg, tabId) {
  const id = tabId ?? (await activeTab())?.id;
  if (id == null) return;
  try { await chrome.tabs.sendMessage(id, msg); } catch (_) { /* página sem content script (chrome://, loja etc.) */ }
}

// ---------- Atalhos ----------
chrome.commands.onCommand.addListener(async (cmd) => {
  const s = await getSettings();
  switch (cmd) {
    case "toggle-bionic": s.bionic.on = !s.bionic.on; await saveSettings(s); break;
    case "toggle-ruler":  s.ruler.on = !s.ruler.on; await saveSettings(s); break;
    case "toggle-guided": s.guided.on = !s.guided.on; await saveSettings(s); break;
    case "toggle-reader": sendToTab({ type: "reader-toggle" }); break;
    case "tts-toggle":    sendToTab({ type: "tts-toggle" }); break;
    case "highlight-selection": sendToTab({ type: "highlight-selection" }); break;
    case "toggle-timer":  toggleTimer(); break;
  }
});

// ---------- Menu de contexto ----------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "lume-read-from", title: "Lume: ler em voz alta a partir daqui", contexts: ["selection", "page"] });
    chrome.contextMenus.create({ id: "lume-highlight", title: "Lume: marcar seleção", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "lume-reader", title: "Lume: abrir modo leitor", contexts: ["page"] });
  });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const map = { "lume-read-from": "tts-from-selection", "lume-highlight": "highlight-selection", "lume-reader": "reader-toggle" };
  sendToTab({ type: map[info.menuItemId] }, tab?.id);
});

// ---------- Timer de foco ----------
// Estado em storage.local para todas as abas mostrarem a mesma contagem.
async function toggleTimer() {
  const { timer } = await chrome.storage.local.get("timer");
  if (timer && timer.endAt > Date.now()) return stopTimer();
  return startTimer("focus");
}
async function startTimer(phase) {
  const s = await getSettings();
  const min = phase === "focus" ? s.timer.focusMin : s.timer.breakMin;
  const endAt = Date.now() + min * 60_000;
  await chrome.storage.local.set({ timer: { phase, endAt, total: min * 60_000 } });
  await chrome.alarms.clear("lume-timer");
  chrome.alarms.create("lume-timer", { when: endAt });
}
async function stopTimer() {
  await chrome.alarms.clear("lume-timer");
  await chrome.storage.local.set({ timer: null });
}
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "lume-timer") return;
  const { timer } = await chrome.storage.local.get("timer");
  if (!timer) return;
  const s = await getSettings();
  if (timer.phase === "focus") {
    chrome.notifications.create({
      type: "basic", iconUrl: "icons/icon128.png",
      title: "Bloco de foco concluído",
      message: `Boa! Pausa de ${s.timer.breakMin} min: levanta, bebe água, olha longe.`
    });
    startTimer("break");
  } else {
    chrome.notifications.create({
      type: "basic", iconUrl: "icons/icon128.png",
      title: "Pausa acabou",
      message: "Hora de voltar. Clique no timer quando estiver pronto para outro bloco."
    });
    stopTimer();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "timer-toggle") { toggleTimer().then(() => reply(true)); return true; }
  if (msg.type === "timer-start")  { startTimer("focus").then(() => reply(true)); return true; }
  if (msg.type === "timer-stop")   { stopTimer().then(() => reply(true)); return true; }
});
