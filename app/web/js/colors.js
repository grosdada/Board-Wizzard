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

// couleur CSS quelconque (rgb(), rgba(), nom) -> #rrggbb, ou null si transparente
function toHex(c) {
  const n = norm(c); if (n) return n;
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?/i.exec(c || "");
  if (!m) return null;
  const a = m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4];
  if (a < 0.05) return null;
  return "#" + [m[1], m[2], m[3]].map((v) => Math.round(+v).toString(16).padStart(2, "0")).join("");
}
const imgCache = new Map();
function loadImg(url) {
  if (!imgCache.has(url)) imgCache.set(url, new Promise((ok) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = url; }));
  return imgCache.get(url);
}
// pixel d'une image sous le pointeur : <img> ou <image> SVG (cadrage preserveAspectRatio respecte, rotation ignoree)
async function imagePixel(el, x, y) {
  const url = el.tagName.toLowerCase() === "img" ? el.currentSrc || el.src : el.getAttribute("href") || el.getAttribute("xlink:href");
  if (!url) return null;
  const im = await loadImg(new URL(url, location.href).href);
  if (!im || !im.naturalWidth) return null;
  const r = el.getBoundingClientRect(), iw = im.naturalWidth, ih = im.naturalHeight;
  const par = (el.getAttribute("preserveAspectRatio") || (el.tagName.toLowerCase() === "img" ? "none" : "xMidYMid meet")).trim();
  let w = r.width, hh = r.height, ox = r.left, oy = r.top;
  if (!/^none/.test(par)) {
    const k = /slice/.test(par) ? Math.max(r.width / iw, r.height / ih) : Math.min(r.width / iw, r.height / ih);
    w = iw * k; hh = ih * k;
    const fx = /xMin/.test(par) ? 0 : /xMax/.test(par) ? 1 : 0.5, fy = /YMin/.test(par) ? 0 : /YMax/.test(par) ? 1 : 0.5;
    ox = r.left + (r.width - w) * fx; oy = r.top + (r.height - hh) * fy;
  }
  const px = Math.floor((x - ox) / w * iw), py = Math.floor((y - oy) / hh * ih);
  if (px < 0 || py < 0 || px >= iw || py >= ih) return null;
  const cv = document.createElement("canvas"); cv.width = 1; cv.height = 1;
  const g = cv.getContext("2d"); g.drawImage(im, px, py, 1, 1, 0, 0, 1, 1);
  let d; try { d = g.getImageData(0, 0, 1, 1).data; } catch (e) { return null; }
  return d[3] > 20 ? "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("") : null;
}
// couleur de ce qui est sous le pointeur : image, forme SVG (son remplissage), fond d'un element HTML
async function colorAt(x, y, skip) {
  for (const el of document.elementsFromPoint(x, y)) {
    if (skip && skip.contains(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === "img" || tag === "image") { const c = await imagePixel(el, x, y); if (c) return c; continue; }
    if (el instanceof SVGGraphicsElement && tag !== "svg" && tag !== "g") {
      const f = getComputedStyle(el).fill; const c = f && !/^url|none/.test(f) ? toHex(f) : null;
      if (c && el.getAttribute("fill") !== "transparent") return c;
      continue;
    }
    const c = toHex(getComputedStyle(el).backgroundColor);
    if (c) return c;
  }
  return null;
}
// pipette : celle du navigateur (tout l'ecran) quand il l'a ; sinon (Firefox, page servie en http sur le reseau local) un clic
// dans la page lit la couleur sous le pointeur
function eyedrop(skip) {
  if (window.EyeDropper && window.isSecureContext) return new window.EyeDropper().open().then((r) => toHex(r.sRGBHex), () => null);
  return new Promise((ok) => {
    document.body.classList.add("eyedrop");
    toast(tt("Pipette : clique sur la couleur à prendre (Échap pour annuler)."));
    const end = (c) => { document.body.classList.remove("eyedrop"); document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); ok(c); };
    const down = async (e) => { e.preventDefault(); e.stopPropagation(); end(await colorAt(e.clientX, e.clientY, skip)); };
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(null); } };
    setTimeout(() => { document.addEventListener("pointerdown", down, true); document.addEventListener("keydown", key, true); }, 0);
  });
}

// ---- fond d'affichage des ateliers (dessin, portrait-robot) : damier (voir la transparence) ou une couleur ; seulement a
// l'ecran, rien n'est enregistre avec le dessin. Retenu par le navigateur (bw.stageBg).
const STAGE = "bw.stageBg";
export function stageBg() { return localStorage.getItem(STAGE) || "#ffffff"; }
/** Remplissage SVG du fond : une couleur, ou le damier (le motif est rendu par stagePattern, a mettre dans les defs). */
export function stageFill() { const v = stageBg(); return v === "damier" ? "url(#bwstage)" : v; }
export function stagePattern(cell = 16) {
  return `<pattern id="bwstage" width="${2 * cell}" height="${2 * cell}" patternUnits="userSpaceOnUse"><rect width="${2 * cell}" height="${2 * cell}" fill="#ffffff"/>` +
    `<rect width="${cell}" height="${cell}" fill="#d9d9d9"/><rect x="${cell}" y="${cell}" width="${cell}" height="${cell}" fill="#d9d9d9"/></pattern>`;
}
/** Reglage « Fond » : un bouton damier et une pastille de couleur. onChange() apres chaque changement. */
export function stageBgControl(onChange) {
  const cur = stageBg();
  const chk = h("button.mini" + (cur === "damier" ? ".on" : ""), { type: "button", title: tt("Fond transparent : un damier montre ce qui est vide") }, tt("▦ Transparent"));
  const sw = swatch(cur === "damier" ? "#ffffff" : cur, (c) => { localStorage.setItem(STAGE, c); chk.classList.remove("on"); onChange(); });
  chk.addEventListener("click", () => { const on = stageBg() !== "damier"; localStorage.setItem(STAGE, on ? "damier" : "#ffffff"); chk.classList.toggle("on", on); onChange(); });
  return h("div.row.stagebg", { title: tt("Fond de l'atelier, seulement à l'écran : il n'est pas enregistré avec le dessin.") }, h("span", tt("Fond")), chk, sw);
}

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
    const drop = h("button.mini.cp-drop", { type: "button", title: tt("Pipette : prendre une couleur à l'écran (un personnage, un décor, une case…)"), on: { click: async () => {
      open.picking = true; box.style.visibility = "hidden";
      const c = await eyedrop(box);
      box.style.visibility = ""; setTimeout(() => { if (open) open.picking = false; }, 0);
      if (c) { set(c); hex.value = c; native.value = c; draw(); } else toast(tt("Pas de couleur prise."));
    } } }, tt("💧 Pipette"));
    box.append(body, h("div.cp-foot", h("label", tt("Code"), hex), h("label", tt("Nuancier"), native), drop));
    draw();
    document.body.append(box);
    const r = btn.getBoundingClientRect(), b = box.getBoundingClientRect();
    box.style.left = Math.max(6, Math.min(r.left, innerWidth - b.width - 8)) + "px";
    box.style.top = Math.max(6, Math.min(r.bottom + 6, innerHeight - b.height - 8)) + "px";
    const out = (ev) => { if (open && open.picking) return; if (!box.contains(ev.target) && ev.target !== btn) { close(); if (onDone) onDone(); } };
    const esc = (ev) => { if (open && open.picking) return; if (ev.key === "Escape") { close(); if (onDone) onDone(); } };
    open = { box, btn, out, esc };
    document.addEventListener("pointerdown", out, true);
    document.addEventListener("keydown", esc, true);
  });
  return btn;
}
