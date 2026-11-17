// Fond dessine d'une case : formes simples et traces en noir et blanc, avec des gris en trame (points, lignes, croix)
// unis ou en degrade. panel.draw = { shapes: [...] }. Une forme :
//   { id, t: rect | ellipse | tri | line | free | blob, p: [[x, y]...] en fraction de la case,
//     stroke: "#111111" | "#ffffff" | "none", sw (epaisseur), fill: none | white | black | tone | grad,
//     tone, tone2 (0 = blanc, 1 = noir), ga (angle du degrade), dot (taille de la trame), form: points | lignes | croix,
//     ha (angle de la trame) }
// La trame est faite par le navigateur : un motif en « cones » de gris + le ton voulu, puis un seuil. Les points
// grossissent donc tout seuls la ou le ton fonce, sans dessiner chaque point.
import { h, modal, toast } from "./api.js";
import { swatch } from "./colors.js";

export const W = 1000;                                   // largeur de travail ; la hauteur suit le format de la case
const uid = () => Math.random().toString(36).slice(2, 8);
const f1 = (n) => (+n).toFixed(1);
export const TOOLS = { select: ["Sélection", "↖"], rect: ["Rectangle", "▭"], ellipse: ["Ellipse", "◯"], tri: ["Triangle", "△"],
                       line: ["Ligne", "╱"], free: ["Tracé libre", "✎"], blob: ["Forme libre", "⬟"] };
const FILLS = { none: "Aucun", white: "Blanc", black: "Noir", tone: "Gris en trame", grad: "Dégradé en trame" };
const FORMS = { points: "Points", lignes: "Lignes", croix: "Croisillons" };
const DEF = { stroke: "#111111", sw: 1, fill: "none", tone: 0.4, tone2: 0.9, ga: 90, dot: 14, form: "points", ha: 45 };

function geom(sh, H) {
  const P = sh.p.map(([x, y]) => [x * W, y * H]);
  if (P.length < 2) return "";
  const [a, b] = P, x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  if (sh.t === "rect") return `M${f1(x0)} ${f1(y0)}H${f1(x1)}V${f1(y1)}H${f1(x0)}Z`;
  if (sh.t === "ellipse") { const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2; return `M${f1(x0)} ${f1(y0 + ry)}a${f1(rx)} ${f1(ry)} 0 1 0 ${f1(rx * 2)} 0a${f1(rx)} ${f1(ry)} 0 1 0 ${f1(-rx * 2)} 0Z`; }
  if (sh.t === "tri") return `M${f1((x0 + x1) / 2)} ${f1(y0)}L${f1(x1)} ${f1(y1)}L${f1(x0)} ${f1(y1)}Z`;
  if (sh.t === "line") return `M${f1(a[0])} ${f1(a[1])}L${f1(b[0])} ${f1(b[1])}`;
  let d = `M${f1(P[0][0])} ${f1(P[0][1])}`;                // trace lisse : on passe par les milieux
  for (let i = 1; i < P.length - 1; i++) d += `Q${f1(P[i][0])} ${f1(P[i][1])} ${f1((P[i][0] + P[i + 1][0]) / 2)} ${f1((P[i][1] + P[i + 1][1]) / 2)}`;
  d += `L${f1(P[P.length - 1][0])} ${f1(P[P.length - 1][1])}`;
  return sh.t === "blob" ? d + "Z" : d;
}
const grey = (t) => { const v = Math.round(255 * (1 - Math.max(0, Math.min(1, t)))); return `rgb(${v},${v},${v})`; };

/** Balisage SVG du fond dessine, dans un repere W x H. pre : prefixe des identifiants (unique par case). */
export function drawSvg(draw, H, pre) {
  const shapes = (draw && draw.shapes) || [];
  if (!shapes.length) return "";
  let defs = `<filter id="${pre}th" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%"><feComponentTransfer>` +
    ["R", "G", "B"].map((c) => `<feFunc${c} type="linear" slope="26" intercept="-12.5"/>`).join("") + `</feComponentTransfer></filter>`;
  let body = "";
  shapes.forEach((raw, i) => {
    const sh = Object.assign({}, DEF, raw), d = geom(sh, H), id = pre + "s" + i, tag = `data-shape="${sh.id}"`;
    if (!d) return;
    const open = sh.t === "line" || sh.t === "free";
    if (!open && (sh.fill === "tone" || sh.fill === "grad")) {
      const s = Math.max(4, sh.dot), rot = `rotate(${f1(sh.ha)})`;
      const cell = (pid, grad) => `<pattern id="${pid}" width="${f1(s)}" height="${f1(s)}" patternUnits="userSpaceOnUse" patternTransform="${rot}${grad === "l2" ? " rotate(90)" : ""}"><rect width="${f1(s)}" height="${f1(s)}" fill="url(#${id}${grad === "l2" ? "l" : grad})"/></pattern>`;
      defs += `<radialGradient id="${id}r" cx="0.5" cy="0.5" r="0.72"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>` +
        `<linearGradient id="${id}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="0.5" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>` +
        `<clipPath id="${id}c"><path d="${d}"/></clipPath>`;
      const xs = sh.p.map((p) => p[0] * W), ys = sh.p.map((p) => p[1] * H);
      const bx = Math.min(...xs), by = Math.min(...ys), bw = Math.max(1, Math.max(...xs) - bx), bh = Math.max(1, Math.max(...ys) - by);
      let cone;
      if (sh.form === "lignes") { defs += cell(id + "p", "l"); cone = `<rect x="${f1(bx)}" y="${f1(by)}" width="${f1(bw)}" height="${f1(bh)}" fill="url(#${id}p)"/>`; }
      else if (sh.form === "croix") {
        defs += cell(id + "p", "l") + cell(id + "q", "l2");
        cone = `<rect x="${f1(bx)}" y="${f1(by)}" width="${f1(bw)}" height="${f1(bh)}" fill="url(#${id}p)"/><rect x="${f1(bx)}" y="${f1(by)}" width="${f1(bw)}" height="${f1(bh)}" fill="url(#${id}q)" style="mix-blend-mode:darken"/>`;
      } else { defs += cell(id + "p", "r"); cone = `<rect x="${f1(bx)}" y="${f1(by)}" width="${f1(bw)}" height="${f1(bh)}" fill="url(#${id}p)"/>`; }
      let tone;
      if (sh.fill === "grad") {
        const a = sh.ga * Math.PI / 180, dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
        defs += `<linearGradient id="${id}g" x1="${f1(0.5 - dx)}" y1="${f1(0.5 - dy)}" x2="${f1(0.5 + dx)}" y2="${f1(0.5 + dy)}"><stop offset="0" stop-color="${grey(sh.tone)}"/><stop offset="1" stop-color="${grey(sh.tone2)}"/></linearGradient>`;
        tone = `url(#${id}g)`;
      } else tone = grey(sh.tone);
      // moyenne du motif et du ton, puis seuil a mi-gris : noir la ou le motif est plus sombre que le ton demande
      body += `<g ${tag} filter="url(#${pre}th)"><g clip-path="url(#${id}c)" style="isolation:isolate"><rect x="${f1(bx)}" y="${f1(by)}" width="${f1(bw)}" height="${f1(bh)}" fill="#fff"/>${cone}<rect x="${f1(bx)}" y="${f1(by)}" width="${f1(bw)}" height="${f1(bh)}" fill="${tone}" opacity="0.5"/></g></g>`;
    } else if (!open && (sh.fill === "white" || sh.fill === "black")) {
      body += `<path ${tag} d="${d}" fill="${sh.fill === "white" ? "#ffffff" : "#111111"}"/>`;
    }
    if (sh.stroke !== "none" && sh.sw > 0) body += `<path ${tag} d="${d}" fill="none" stroke="${sh.stroke}" stroke-width="${f1(sh.sw * 4)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    else if (open || sh.fill === "none") body += `<path ${tag} d="${d}" fill="none" stroke="#111111" stroke-opacity="0.001" stroke-width="12"/>`;
    if (!open && sh.fill === "none") body += `<path ${tag} d="${d}" fill="#000" fill-opacity="0.001"/>`;    // attrapable a la souris
  });
  return `<defs>${defs}</defs>${body}`;
}

/** Image (pour l'aplatissement) du fond dessine d'une case de wpx x hpx pixels. */
export function drawImage(draw, wpx, hpx) {
  const H = W * hpx / wpx, inner = drawSvg(draw, H, "f");
  if (!inner) return Promise.resolve(null);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(wpx)}" height="${Math.round(hpx)}" viewBox="0 0 ${W} ${f1(H)}">${inner}</svg>`;
  return new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
}

// ------------------------------------------------------------------------------------------------ l'atelier
/** Ouvre l'atelier de dessin pour une case. ratio = hauteur / largeur ; backdrop : url du decor a montrer dessous. */
export function openDrawEditor({ draw, ratio, backdrop, title, onSave }) {
  const H = W * ratio;
  const shapes = JSON.parse(JSON.stringify((draw && draw.shapes) || []));
  let tool = "rect", sel = null, cur = Object.assign({}, DEF), drag = null;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${f1(H)}`); svg.setAttribute("class", "draw-stage");
  const art = document.createElementNS(NS, "g"), over = document.createElementNS(NS, "g");
  const back = document.createElementNS(NS, "g");
  back.innerHTML = `<rect width="${W}" height="${f1(H)}" fill="#ffffff"/>` + (backdrop ? `<image href="${backdrop}" width="${W}" height="${f1(H)}" preserveAspectRatio="xMidYMid slice" opacity="0.35"/>` : "");
  svg.append(back, art, over);
  const side = h("div.draw-side"), bar = h("div.draw-tools");
  const target = () => (sel ? shapes.find((s) => s.id === sel) : null);
  const val = (k) => { const t = target(); return t && t[k] !== undefined ? t[k] : cur[k]; };
  const set = (k, v) => { const t = target(); if (t) t[k] = v; cur[k] = v; paint(); };

  function paint() {
    art.innerHTML = drawSvg({ shapes }, H, "e");
    over.innerHTML = "";
    const t = target();
    if (t) {
      const pts = t.t === "free" || t.t === "blob" ? [t.p[0], t.p[t.p.length - 1]] : t.p;
      const xs = t.p.map((p) => p[0] * W), ys = t.p.map((p) => p[1] * H);
      over.innerHTML = `<rect x="${f1(Math.min(...xs) - 6)}" y="${f1(Math.min(...ys) - 6)}" width="${f1(Math.max(...xs) - Math.min(...xs) + 12)}" height="${f1(Math.max(...ys) - Math.min(...ys) + 12)}" class="draw-sel"/>` +
        (t.t === "free" || t.t === "blob" ? "" : pts.map((p, i) => `<circle cx="${f1(p[0] * W)}" cy="${f1(p[1] * H)}" r="9" class="draw-pt" data-pt="${i}"/>`).join(""));
    }
  }
  function props() {
    side.textContent = "";
    const t = target(), kind = t ? t.t : tool, open = kind === "line" || kind === "free";
    const range = (label, k, min, max, step) => { const out = h("output", String(val(k)));
      return h("label.row.range", label, h("input", { type: "range", min, max, step, value: val(k), on: { input: (e) => { set(k, +e.target.value); out.textContent = e.target.value; } } }), out); };
    const pick = (label, k, opts) => h("label.row", label, h("select", { on: { change: (e) => { set(k, e.target.value); props(); } } }, Object.entries(opts).map(([v, n]) => h("option", { value: v, selected: val(k) === v }, n))));
    side.append(h("h4", t ? "Forme choisie" : "Prochaine forme"),
      pick("Trait", "stroke", { "#111111": "Noir", "#ffffff": "Blanc", none: "Aucun" }));
    if (val("stroke") !== "none") side.append(range("Épaisseur", "sw", 0.2, 12, 0.1));
    if (!open) {
      side.append(pick("Remplissage", "fill", FILLS));
      const fill = val("fill");
      if (fill === "tone" || fill === "grad") {
        side.append(h("h4", "Trame"), pick("Motif", "form", FORMS), range("Taille", "dot", 4, 60, 0.5), range("Angle de la trame", "ha", 0, 180, 1),
          range(fill === "grad" ? "Gris au départ" : "Gris", "tone", 0, 1, 0.01));
        if (fill === "grad") side.append(range("Gris à l'arrivée", "tone2", 0, 1, 0.01), range("Sens du dégradé", "ga", 0, 360, 1));
      }
    }
    if (t) side.append(h("h4", "Ordre"), h("div.row.wrap",
      h("button.mini", { on: { click: () => { const i = shapes.indexOf(t); if (i < shapes.length - 1) { shapes.splice(i, 1); shapes.splice(i + 1, 0, t); paint(); } } } }, "Avancer"),
      h("button.mini", { on: { click: () => { const i = shapes.indexOf(t); if (i > 0) { shapes.splice(i, 1); shapes.splice(i - 1, 0, t); paint(); } } } }, "Reculer"),
      h("button.mini", { on: { click: () => { const c = JSON.parse(JSON.stringify(t)); c.id = uid(); c.p = c.p.map((p) => [p[0] + 0.03, p[1] + 0.03]); shapes.push(c); sel = c.id; paint(); props(); } } }, "Dupliquer"),
      h("button.mini.danger", { on: { click: () => { shapes.splice(shapes.indexOf(t), 1); sel = null; paint(); props(); } } }, "Supprimer")));
    side.append(h("p.muted", "Choisis un outil puis glisse dans le cadre. « Sélection » : clic sur une forme pour la régler, glisser pour la déplacer, points ronds pour l'étirer. Suppr efface la forme choisie."));
  }
  function tools() {
    bar.textContent = "";
    for (const [k, [name, ico]] of Object.entries(TOOLS)) bar.append(h("button.mini" + (tool === k ? ".on" : ""), { title: name, on: { click: () => { tool = k; if (k !== "select") sel = null; tools(); props(); paint(); } } }, `${ico} ${name}`));
    bar.append(h("button.mini.danger", { title: "Retirer toutes les formes", on: { click: () => { if (shapes.length && confirm("Effacer tout le dessin de ce fond ?")) { shapes.length = 0; sel = null; paint(); props(); } } } }, "Tout effacer"));
  }
  const at = (e) => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const p = at(e);
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* pointeur deja relache */ }
    if (tool === "select") {
      if (e.target.dataset.pt != null && target()) { drag = { kind: "pt", i: +e.target.dataset.pt }; return; }
      const id = e.target.dataset.shape || (e.target.closest("[data-shape]") || {}).dataset?.shape;
      sel = id || null; props(); paint();
      if (sel) drag = { kind: "move", start: p, pts: target().p.map((q) => q.slice()) };
      return;
    }
    const sh = Object.assign({ id: uid(), t: tool, p: [p, p] }, JSON.parse(JSON.stringify(cur)));
    shapes.push(sh); sel = sh.id; drag = { kind: "new", sh };
    paint();
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = at(e), t = target();
    if (!t) return;
    if (drag.kind === "new") {
      if (t.t === "free" || t.t === "blob") { const l = t.p[t.p.length - 1]; if (Math.hypot((p[0] - l[0]) * W, (p[1] - l[1]) * H) > 5) t.p.push(p); }
      else t.p[1] = p;
    } else if (drag.kind === "pt") t.p[drag.i] = p;
    else t.p = drag.pts.map((q) => [q[0] + p[0] - drag.start[0], q[1] + p[1] - drag.start[1]]);
    paint();
  });
  svg.addEventListener("pointerup", () => {
    const d = drag; drag = null;
    if (!d || d.kind !== "new") return;
    const t = d.sh, a = t.p[0], b = t.p[t.p.length - 1];
    if (t.p.length <= 2 && Math.hypot((b[0] - a[0]) * W, (b[1] - a[1]) * H) < 6) { shapes.splice(shapes.indexOf(t), 1); sel = null; }   // simple clic : rien
    else if (t.p.length > 40) t.p = Array.from({ length: 40 }, (_, i) => t.p[Math.round(i * (t.p.length - 1) / 39)]);
    props(); paint();
  });
  const key = (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if ((e.key === "Delete" || e.key === "Backspace") && target()) { e.preventDefault(); e.stopPropagation(); shapes.splice(shapes.indexOf(target()), 1); sel = null; paint(); props(); }
  };
  document.addEventListener("keydown", key, true);
  tools(); props(); paint();
  const m = modal(title || "Dessiner le fond", h("div.draw-editor", h("div.draw-main", bar, h("div.draw-frame", svg)), side),
    [{ label: "Annuler", click: () => { document.removeEventListener("keydown", key, true); } },
     { label: "Enregistrer le fond", primary: true, click: () => { document.removeEventListener("keydown", key, true); onSave({ shapes }); toast("Fond dessiné enregistré."); } }]);
  m.box.classList.add("modal-wide");
  return m;
}
