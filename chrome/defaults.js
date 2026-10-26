// Configuração padrão compartilhada por popup, background e content script.
// Fica em globalThis para funcionar nos três contextos sem módulo.
globalThis.LUME_DEFAULTS = {
  enabled: true,
  disabledSites: [],

  bionic: { on: false, strength: 0.45, fadeRest: false, minWord: 2 },

  font: { family: "default", scale: 100 },          // default | lexend | atkinson | opendyslexic | arial | verdana
  spacing: { on: false, lineHeight: 1.8, letterSpacing: 0.03, wordSpacing: 0.12 },

  ruler: { on: false, mode: "line", height: 42, color: "#ffd54f", opacity: 0.35 }, // mode: line | mask
  tint: { on: false, color: "#fff3c4", opacity: 0.25 },

  reader: { theme: "sepia", width: 70, size: 20 },   // theme: light | sepia | dark ; width em ch ; size em px
  guided: { on: false },
  motion: { reduce: false },

  tts: { voiceURI: "", rate: 1.0, followScroll: true },

  progress: { on: true, wpm: 200 },
  timer: { focusMin: 15, breakMin: 5 },

  highlightColor: "yellow"
};

globalThis.lumeMerge = function lumeMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!extra || typeof extra !== "object") return out;
  for (const k of Object.keys(extra)) {
    const b = base ? base[k] : undefined;
    const e = extra[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) && e && typeof e === "object" && !Array.isArray(e)
      ? lumeMerge(b, e) : e;
  }
  return out;
};
