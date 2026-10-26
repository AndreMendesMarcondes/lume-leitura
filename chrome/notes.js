let pages = [];

async function load() {
  const all = await chrome.storage.local.get(null);
  pages = Object.entries(all)
    .filter(([k, v]) => k.startsWith("hl:") && v && v.items && v.items.length)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.updated - a.updated);
  render();
}

function render() {
  const q = document.getElementById("q").value.trim().toLowerCase();
  const list = document.getElementById("list");
  list.innerHTML = "";
  const shown = pages
    .map((p) => ({ ...p, items: p.items.filter((h) => !q || (h.text + " " + (h.note || "") + " " + p.title).toLowerCase().includes(q)) }))
    .filter((p) => p.items.length);
  if (!shown.length) { list.innerHTML = `<div class="empty">${q ? "Nada encontrado." : "Nenhuma marcação ainda. Selecione um texto em qualquer site e escolha uma cor."}</div>`; return; }
  shown.forEach((p) => {
    const sec = document.createElement("section");
    const head = document.createElement("header");
    const a = document.createElement("a"); a.href = p.url; a.textContent = p.title || p.url; a.target = "_blank";
    const date = document.createElement("small"); date.textContent = new Date(p.updated).toLocaleDateString("pt-BR");
    const del = document.createElement("button"); del.textContent = "Apagar";
    del.onclick = async () => { if (confirm("Apagar as marcações desta página?")) { await chrome.storage.local.remove(p.key); load(); } };
    head.append(a, date, del);
    sec.appendChild(head);
    p.items.forEach((h) => {
      const bq = document.createElement("blockquote"); bq.dataset.c = h.color; bq.textContent = h.text;
      sec.appendChild(bq);
      if (h.note) { const n = document.createElement("div"); n.className = "note"; n.textContent = "✎ " + h.note; sec.appendChild(n); }
    });
    list.appendChild(sec);
  });
}

function toMarkdown() {
  return pages.map((p) => [`## ${p.title || p.url}`, "", `<${p.url}>`, "",
    ...p.items.flatMap((h) => [`> ${h.text.replace(/\s+/g, " ").trim()}`, ...(h.note ? ["", `**Nota:** ${h.note}`] : []), ""])].join("\n")).join("\n");
}

document.getElementById("q").addEventListener("input", render);
document.getElementById("exportAll").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["# Marcações do Lume\n\n" + toMarkdown()], { type: "text/markdown" }));
  a.download = "lume-marcacoes.md"; a.click();
};
chrome.storage.onChanged.addListener((c, area) => { if (area === "local") load(); });
load();
