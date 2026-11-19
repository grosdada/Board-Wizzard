// Choix d'une couleur : une pastille qui ouvre une petite fenetre (palette prete, couleurs enregistrees, code, pipette
// du navigateur en dernier recours). Les couleurs enregistrees restent dans ce navigateur (bw.palette).
import { tt, tr } from "./i18n.js";
import { h, toast } from "./api.js";

export const PRESETS = [
  [tt("Papier et encre"), ["#ffffff", "#f6f2e8", "#ece5d3", "#d9d4c7", "#9a9a96", "#5a5a58", "#2b2b2b", "#111111"]],
  [tt("Storyboard"), ["#fff8dc", "#ffe9a8", "#f4c95d", "#e98a4b", "#d6262b", "#8c1c2c", "#1d5fd6", "#12305e"]],
  [tt("Ambiances"), ["#dfeaf2", "#a9c7dc", "#5c8aa8", "#243b55", "#e8dfd0", "#b9a27f", "#6b7f5a", "#2f3d2c"]],
];
const KEY = "bw.palette";
const norm = (c) => { const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((c || "").trim()); if (!m) return null; let x = m[1].toLowerCase(); if (x.length === 3) x = x.replace(/./g, "$&$&"); return "#" + x; };

export function savedColors() { try { return (JSON.parse(localStorage.getItem(KEY) || "[]") || []).map(norm).filter(Boolean); } catch (e) { return []; } }
function store(list) { localStorage.setItem(KEY, JSON.stringify([...new Set(list)].slice(0, 32))); }

let open = null;
function close() { if (open) { open.box.remove(); document.removeEventListener("pointerdown", open.out, true); document.removeEventListener("keydown", open.esc, true); open = null; } }

/** Pastille de couleur. onChange(couleur) a chaque essai, onDone() quand la fenetre se ferme. */
export function swatch(value, onChange, onDone) {
  let cur = norm(value) || "#ffffff";
  const btn = h("button.swatch", { type: "button", title: tt("Choisir une couleur"), style: `background:${cur}` });
  const set = (c, quiet) => { c = norm(c); if (!c) return; cur = c; btn.style.background = c; if (!quiet) onChange(c); };
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    if (open && open.btn === btn) return close();
    close();
    const box = h("div.colorpop");
    const hex = h("input", { type: "text", value: cur, maxlength: 7, spellcheck: "false" });
    const native = h("input", { type: "color", value: cur, title: tt("Nuancier du navigateur") });
    const chip = (c, mine) => h("button.chip" + (c === cur ? ".on" : ""), { type: "button", title: c + (mine ? tt(" (clic droit : retirer)") : ""), style: `background:${c}`,
      on: { click: () => { set(c); hex.value = c; native.value = c; draw(); },
            contextmenu: (ev) => { if (!mine) return; ev.preventDefault(); store(savedColors().filter((x) => x !== c)); draw(); } } });
    const body = h("div");
    const draw = () => {
      body.textContent = "";
      const mine = savedColors();
      body.append(h("div.cp-head", tt("Mes couleurs")),
        h("div.chips", mine.length ? mine.map((c) => chip(c, true)) : h("span.muted", tt("Aucune pour l'instant.")),
          h("button.chip.add", { type: "button", title: tt("Enregistrer la couleur en cours dans ma palette"), on: { click: () => { store([...savedColors(), cur]); toast(tt("Couleur enregistrée dans ta palette.")); draw(); } } }, "+")));
      for (const [name, list] of PRESETS) body.append(h("div.cp-head", name), h("div.chips", list.map((c) => chip(c))));
    };
    hex.addEventListener("input", () => { const c = norm(hex.value); if (c) { set(c); native.value = c; draw(); } });
    native.addEventListener("input", () => { set(native.value); hex.value = native.value; draw(); });
    box.append(body, h("div.cp-foot", h("label", tt("Code"), hex), h("label", tt("Nuancier"), native)));
    draw();
    document.body.append(box);
    const r = btn.getBoundingClientRect(), b = box.getBoundingClientRect();
    box.style.left = Math.max(6, Math.min(r.left, innerWidth - b.width - 8)) + "px";
    box.style.top = Math.max(6, Math.min(r.bottom + 6, innerHeight - b.height - 8)) + "px";
    const out = (ev) => { if (!box.contains(ev.target) && ev.target !== btn) { close(); if (onDone) onDone(); } };
    const esc = (ev) => { if (ev.key === "Escape") { close(); if (onDone) onDone(); } };
    open = { box, btn, out, esc };
    document.addEventListener("pointerdown", out, true);
    document.addEventListener("keydown", esc, true);
  });
  return btn;
}
