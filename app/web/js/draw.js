// Fond dessine d'une case : formes simples et traces en noir et blanc, avec des gris en trame (points, lignes, croix)
// unis ou en degrade. panel.draw = { shapes: [...] }. Une forme :
//   { id, t (primitive ou trace, voir PRIMS et PATHS), p: [[x, y]...] en fraction de la case, r (rotation en degres),
//     stroke: "#111111" | "#ffffff" | "none", sw (epaisseur), fill: none | white | black | tone | grad,
//     tone, tone2 (0 = blanc, 1 = noir), ga (angle du degrade), dot (taille de la trame), form: points | lignes | croix,
//     ha (angle de la trame) }
// La trame est faite par le navigateur : un motif en « cones » de gris + le ton voulu, puis un seuil. Les points
// grossissent donc tout seuls la ou le ton fonce, sans dessiner chaque point.
import { swatch } from "./colors.js";
import { h, modal, toast } from "./api.js";

export const W = 1000;                                   // largeur de travail ; la hauteur suit le format de la case
const uid = () => Math.random().toString(36).slice(2, 8);
const f1 = (n) => (+n).toFixed(1);
// primitives : se tracent en glissant d'un coin a l'autre
export const PRIMS = { rect: ["Rectangle", "▭"], rrect: ["Rectangle arrondi", "▢"], ellipse: ["Ellipse", "◯"], tri: ["Triangle", "△"],
                       diamond: ["Losange", "◇"], hexa: ["Hexagone", "⬡"], star: ["Étoile", "☆"], arrow: ["Flèche pleine", "➤"],
                       half: ["Demi-cercle", "◓"], cloud: ["Nuage", "☁"] };
// traces : ligne, main levee, ou point par point
export const PATHS = { line: ["Ligne", "╱"], free: ["Tracé libre", "✎"], blob: ["Forme libre", "⬟"], poly: ["Forme point par point", "⬠"],
                       polyline: ["Ligne brisée point par point", "⌇"] };
const OPEN = new Set(["line", "free", "polyline"]);       // sans remplissage
const MANY = new Set(["free", "blob", "poly", "polyline"]);
const FILLS = { none: "Aucun", white: "Blanc", black: "Noir", color: "Couleur", tone: "Gris en trame", grad: "Dégradé en trame" };
const FORMS = { points: "Points", lignes: "Lignes", croix: "Croisillons" };
const DEF = { stroke: "#111111", sw: 1, fill: "none", tone: 0.4, tone2: 0.9, ga: 90, dot: 14, form: "points", ha: 45, hand: 0, hw: 4, col: "#808080" };   // hand : tremble du trait a la main (0 = net), hw : longueur des ondulations

function geom(sh, H) {
  const P = sh.p.map(([x, y]) => [x * W, y * H]);
  if (P.length < 2) return "";
  const pts = (list) => "M" + list.map(([x, y]) => `${f1(x)} ${f1(y)}`).join("L") + "Z";
  if (sh.t === "line") return `M${f1(P[0][0])} ${f1(P[0][1])}L${f1(P[1][0])} ${f1(P[1][1])}`;
  if (sh.t === "poly") return pts(P);
  if (sh.t === "polyline") return pts(P).slice(0, -1);
  if (MANY.has(sh.t)) {                                    // main levee : trace lisse, on passe par les milieux
    let d = `M${f1(P[0][0])} ${f1(P[0][1])}`;
    for (let i = 1; i < P.length - 1; i++) d += `Q${f1(P[i][0])} ${f1(P[i][1])} ${f1((P[i][0] + P[i + 1][0]) / 2)} ${f1((P[i][1] + P[i + 1][1]) / 2)}`;
    d += `L${f1(P[P.length - 1][0])} ${f1(P[P.length - 1][1])}`;
    return sh.t === "blob" ? d + "Z" : d;
  }
  const [a, b] = P, x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const w = x1 - x0, hh = y1 - y0, cy = (y0 + y1) / 2, at = (u, v) => [x0 + u * w, y0 + v * hh];
  switch (sh.t) {
    case "rrect": { const r = Math.min(w, hh) * 0.2; return `M${f1(x0 + r)} ${f1(y0)}H${f1(x1 - r)}Q${f1(x1)} ${f1(y0)} ${f1(x1)} ${f1(y0 + r)}V${f1(y1 - r)}Q${f1(x1)} ${f1(y1)} ${f1(x1 - r)} ${f1(y1)}H${f1(x0 + r)}Q${f1(x0)} ${f1(y1)} ${f1(x0)} ${f1(y1 - r)}V${f1(y0 + r)}Q${f1(x0)} ${f1(y0)} ${f1(x0 + r)} ${f1(y0)}Z`; }
    case "ellipse": return `M${f1(x0)} ${f1(cy)}a${f1(w / 2)} ${f1(hh / 2)} 0 1 0 ${f1(w)} 0a${f1(w / 2)} ${f1(hh / 2)} 0 1 0 ${f1(-w)} 0Z`;
    case "tri": return pts([at(0.5, 0), at(1, 1), at(0, 1)]);
    case "diamond": return pts([at(0.5, 0), at(1, 0.5), at(0.5, 1), at(0, 0.5)]);
    case "hexa": return pts([at(0.25, 0), at(0.75, 0), at(1, 0.5), at(0.75, 1), at(0.25, 1), at(0, 0.5)]);
    case "star": return pts(Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 0.2 : 0.5, an = -Math.PI / 2 + i * Math.PI / 5; return at(0.5 + r * Math.cos(an), 0.5 + r * Math.sin(an)); }));
    case "arrow": return pts([at(0, 0.3), at(0.6, 0.3), at(0.6, 0), at(1, 0.5), at(0.6, 1), at(0.6, 0.7), at(0, 0.7)]);
    case "half": return `M${f1(x0)} ${f1(y1)}A${f1(w / 2)} ${f1(hh)} 0 0 1 ${f1(x1)} ${f1(y1)}Z`;
    case "cloud": { const q = (u, v) => at(u, v).map(f1).join(" "); return `M${q(0.2, 0.9)}C${q(-0.05, 0.9)} ${q(-0.05, 0.5)} ${q(0.2, 0.5)}C${q(0.15, 0.15)} ${q(0.5, 0.05)} ${q(0.6, 0.35)}C${q(0.8, 0.2)} ${q(1.02, 0.4)} ${q(0.88, 0.6)}C${q(1.05, 0.7)} ${q(1, 0.9)} ${q(0.82, 0.9)}Z`; }
    default: return pts([at(0, 0), at(1, 0), at(1, 1), at(0, 1)]);          // rectangle
  }
}
const grey = (t) => { const v = Math.round(255 * (1 - Math.max(0, Math.min(1, t)))); return `rgb(${v},${v},${v})`; };
/** Boite d'une forme (avant rotation) et son centre, dans le repere W x H. */
export function boxOf(sh, H) {
  const xs = sh.p.map((p) => p[0] * W), ys = sh.p.map((p) => p[1] * H);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(1, Math.max(...xs) - x), hh = Math.max(1, Math.max(...ys) - y);
  return { x, y, w, h: hh, cx: x + w / 2, cy: y + hh / 2 };
}

/** Balisage SVG du fond dessine, dans un repere W x H. pre : prefixe des identifiants (unique par case). */
export function drawSvg(draw, H, pre) {
  const shapes = (draw && draw.shapes) || [];
  if (!shapes.length) return "";
  let defs = `<filter id="${pre}th" color-interpolation-filters="sRGB" x="-5%" y="-5%" width="110%" height="110%"><feComponentTransfer>` +
    ["R", "G", "B"].map((c) => `<feFunc${c} type="linear" slope="26" intercept="-12.5"/>`).join("") + `</feComponentTransfer></filter>`;
  let body = "";
  shapes.forEach((raw, i) => {
    const sh = Object.assign({}, DEF, raw), d = geom(sh, H), id = pre + "s" + i, tag = `data-shape="${sh.id}"`;
    if (!d) return;
    const open = OPEN.has(sh.t), bx = boxOf(sh, H);
    let one = "";
    if (!open && (sh.fill === "tone" || sh.fill === "grad")) {
      const s = Math.max(4, sh.dot), rot = `rotate(${f1(sh.ha)})`;
      const cell = (pid, grad) => `<pattern id="${pid}" width="${f1(s)}" height="${f1(s)}" patternUnits="userSpaceOnUse" patternTransform="${rot}${grad === "l2" ? " rotate(90)" : ""}"><rect width="${f1(s)}" height="${f1(s)}" fill="url(#${id}${grad === "l2" ? "l" : grad})"/></pattern>`;
      defs += `<radialGradient id="${id}r" cx="0.5" cy="0.5" r="0.72"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>` +
        `<linearGradient id="${id}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="0.5" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>` +
        `<clipPath id="${id}c"><path d="${d}"/></clipPath>`;
      const rect = (fill, extra = "") => `<rect x="${f1(bx.x)}" y="${f1(bx.y)}" width="${f1(bx.w)}" height="${f1(bx.h)}" fill="${fill}"${extra}/>`;
      let cone;
      if (sh.form === "lignes") { defs += cell(id + "p", "l"); cone = rect(`url(#${id}p)`); }
      else if (sh.form === "croix") { defs += cell(id + "p", "l") + cell(id + "q", "l2"); cone = rect(`url(#${id}p)`) + rect(`url(#${id}q)`, ` style="mix-blend-mode:darken"`); }
      else { defs += cell(id + "p", "r"); cone = rect(`url(#${id}p)`); }
      let tone;
      if (sh.fill === "grad") {
        const a = sh.ga * Math.PI / 180, dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
        defs += `<linearGradient id="${id}g" x1="${f1(0.5 - dx)}" y1="${f1(0.5 - dy)}" x2="${f1(0.5 + dx)}" y2="${f1(0.5 + dy)}"><stop offset="0" stop-color="${grey(sh.tone)}"/><stop offset="1" stop-color="${grey(sh.tone2)}"/></linearGradient>`;
        tone = `url(#${id}g)`;
      } else tone = grey(sh.tone);
      // moyenne du motif et du ton, puis seuil a mi-gris : noir la ou le motif est plus sombre que le ton demande
      one += `<g ${tag} filter="url(#${pre}th)"><g clip-path="url(#${id}c)" style="isolation:isolate">${rect("#fff")}${cone}${rect(tone, ` opacity="0.5"`)}</g></g>`;
    } else if (!open && sh.fill === "color") {
      one += `<path ${tag} d="${d}" fill="${/^#[0-9a-f]{3,8}$/i.test(sh.col) ? sh.col : "#808080"}"/>`;
    } else if (!open && (sh.fill === "white" || sh.fill === "black")) {
      one += `<path ${tag} d="${d}" fill="${sh.fill === "white" ? "#ffffff" : "#111111"}"/>`;
    }
    if (sh.stroke !== "none" && sh.sw > 0) one += `<path ${tag} d="${d}" fill="none" stroke="${sh.stroke}" stroke-width="${f1(sh.sw * 4)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    else if (open || sh.fill === "none") one += `<path ${tag} d="${d}" fill="none" stroke="#111111" stroke-opacity="0.001" stroke-width="12"/>`;
    if (!open && sh.fill === "none") one += `<path ${tag} d="${d}" fill="#000" fill-opacity="0.001"/>`;    // attrapable a la souris
    if (sh.hand > 0) {                                     // trait a la main : un bruit doux deplace le contour, propre a chaque forme
      const amp = sh.hand * 3, pad = amp + sh.sw * 4 + 4, seed = [...String(sh.id || i)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 997, 7);
      defs += `<filter id="${id}h" filterUnits="userSpaceOnUse" x="${f1(bx.x - pad)}" y="${f1(bx.y - pad)}" width="${f1(bx.w + 2 * pad)}" height="${f1(bx.h + 2 * pad)}" color-interpolation-filters="sRGB">` +
        `<feTurbulence type="fractalNoise" baseFrequency="${(0.06 / Math.max(0.5, sh.hw)).toFixed(4)}" numOctaves="2" seed="${seed}"/><feDisplacementMap in="SourceGraphic" scale="${f1(amp)}" xChannelSelector="R" yChannelSelector="G"/></filter>`;
      one = `<g filter="url(#${id}h)">${one}</g>`;
    }
    body += sh.r ? `<g transform="rotate(${f1(sh.r)} ${f1(bx.cx)} ${f1(bx.cy)})">${one}</g>` : one;
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
export function openDrawEditor({ draw, ratio, backdrop, title, onSave, ghosts = [] }) {
  const H = W * ratio;
  const shapes = JSON.parse(JSON.stringify((draw && draw.shapes) || []));
  let tool = "rect", prim = "rect", path = "free", sel = null, drag = null, building = null, hover = null;
  const cur = Object.assign({}, DEF);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${f1(H)}`); svg.setAttribute("class", "draw-stage");
  const art = document.createElementNS(NS, "g"), over = document.createElementNS(NS, "g");
  const back = document.createElementNS(NS, "g");
  back.innerHTML = `<rect width="${W}" height="${f1(H)}" fill="#ffffff"/>` + (backdrop ? `<image href="${backdrop}" width="${W}" height="${f1(H)}" preserveAspectRatio="xMidYMid slice" opacity="0.35"/>` : "");
  // fantome : les personnages de la case par-dessus le dessin, en transparence, pour dessiner autour d'eux
  const ghost = document.createElementNS(NS, "g");
  ghost.setAttribute("style", "pointer-events:none");
  ghost.innerHTML = ghosts.map((q) => { const hh = q.s * H, ww = hh * q.ar, cx = q.x * W, x = cx - ww / 2, y = q.y * H - hh;
    return `<image href="${q.url}" x="${f1(x)}" y="${f1(y)}" width="${f1(ww)}" height="${f1(hh)}" preserveAspectRatio="xMidYMax meet"${q.flip ? ` transform="translate(${f1(2 * cx)} 0) scale(-1 1)"` : ""}/>`; }).join("");
  const gs = Object.assign({ on: true, a: 0.45 }, JSON.parse(localStorage.getItem("bw.ghost") || "{}"));
  const ghostSync = () => { ghost.setAttribute("opacity", gs.a); ghost.setAttribute("display", gs.on ? "inline" : "none"); localStorage.setItem("bw.ghost", JSON.stringify(gs)); };
  ghostSync();
  const gOut = h("output", Math.round(gs.a * 100) + " %");
  const ghostBar = ghosts.length ? h("div.row.draw-ghost", { title: "Montre les personnages de la case par-dessus le dessin, pour s'en servir de repère. Ils ne font pas partie du fond." },
    h("label.row.check", h("input", { type: "checkbox", checked: gs.on, on: { change: (e) => { gs.on = e.target.checked; ghostSync(); } } }), "👻 Personnages en fantôme"),
    h("label.row.range", "Opacité", h("input", { type: "range", min: 0.05, max: 1, step: 0.01, value: gs.a, on: { input: (e) => { gs.a = +e.target.value; gOut.textContent = Math.round(gs.a * 100) + " %"; ghostSync(); } } }), gOut)) : "";
  svg.append(back, art, ghost, over);
  const side = h("div.draw-side"), bar = h("div.draw-tools");
  const target = () => (sel ? shapes.find((s) => s.id === sel) : null);
  const val = (k) => { const t = target(); return t && t[k] !== undefined ? t[k] : cur[k]; };
  const set = (k, v) => { const t = target(); if (t) t[k] = v; cur[k] = v; paint(); };
  const rotPt = (p, c, deg) => { const a = deg * Math.PI / 180, x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a)]; };

  function paint() {
    art.innerHTML = drawSvg({ shapes }, H, "e");
    let o = "";
    const t = target();
    if (t && t !== building) {
      const b = boxOf(t, H), top = b.y - 6;
      const corners = MANY.has(t.t) ? "" : t.p.map((p, i) => `<circle cx="${f1(p[0] * W)}" cy="${f1(p[1] * H)}" r="9" class="draw-pt" data-pt="${i}"/>`).join("");
      // poignee de rotation : au-dessus de la forme, elle tourne avec elle
      o += `<g transform="rotate(${f1(t.r || 0)} ${f1(b.cx)} ${f1(b.cy)})"><rect x="${f1(b.x - 6)}" y="${f1(top)}" width="${f1(b.w + 12)}" height="${f1(b.h + 12)}" class="draw-sel"/>` +
        `<line x1="${f1(b.cx)}" y1="${f1(top)}" x2="${f1(b.cx)}" y2="${f1(top - 30)}" class="draw-sel"/>` +
        `<g class="draw-rot" data-rot="1" transform="translate(${f1(b.cx)} ${f1(top - 44)})"><circle r="15" data-rot="1"/><path d="M-7 -3A8 8 0 1 1 -5 6M-7 -3L-11 -8M-7 -3L-1 -4"/></g>${corners}</g>`;
    }
    if (building) {                                        // forme point par point en cours
      const P = building.p.map(([x, y]) => [x * W, y * H]), last = hover ? [hover[0] * W, hover[1] * H] : P[P.length - 1];
      o += `<path d="M${P.map((p) => f1(p[0]) + " " + f1(p[1])).join("L")}L${f1(last[0])} ${f1(last[1])}" class="draw-build"/>` +
        P.map((p, i) => `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="${i ? 6 : 11}" class="draw-pt${i ? "" : " first"}" style="pointer-events:none"/>`).join("");
    }
    over.innerHTML = o;
  }
  function finish(keep) {                                  // termine la forme point par point
    const b = building; building = null; hover = null;
    if (!b) return;
    if (!keep || b.p.length < (b.t === "poly" ? 3 : 2)) { shapes.splice(shapes.indexOf(b), 1); sel = null; }
    else sel = b.id;
    props(); paint();
  }
  function props() {
    side.textContent = "";
    const t = target(), kind = t ? t.t : tool, open = OPEN.has(kind);
    const range = (label, k, min, max, step) => { const out = h("output", String(val(k) ?? 0));
      return h("label.row.range", label, h("input", { type: "range", min, max, step, value: val(k) ?? 0, on: { input: (e) => { set(k, +e.target.value); out.textContent = e.target.value; } } }), out); };
    const pick = (label, k, opts) => h("label.row", label, h("select", { on: { change: (e) => { set(k, e.target.value); props(); } } }, Object.entries(opts).map(([v, n]) => h("option", { value: v, selected: val(k) === v }, n))));
    side.append(h("h4", t ? "Forme choisie" : "Prochaine forme"),
      pick("Trait", "stroke", { "#111111": "Noir", "#ffffff": "Blanc", none: "Aucun" }));
    if (val("stroke") !== "none") side.append(range("Épaisseur", "sw", 0.2, 12, 0.1));
    side.append(h("h4", "Trait à la main"), range("Tremblé", "hand", 0, 10, 0.1), range("Ondulation", "hw", 0.5, 12, 0.1),
      h("p.muted", "Tremblé à 0 : trait net. Ondulation courte = trait nerveux, longue = lignes qui flottent."));
    if (!open) {
      side.append(pick("Remplissage", "fill", FILLS));
      const fill = val("fill");
      if (fill === "color") side.append(h("div.row.colrow", h("span", "Couleur"), swatch(val("col") || "#808080", (c) => set("col", c))));
      if (fill === "tone" || fill === "grad") {
        side.append(h("h4", "Trame"), pick("Motif", "form", FORMS), range("Taille", "dot", 4, 60, 0.5), range("Angle de la trame", "ha", 0, 180, 1),
          range(fill === "grad" ? "Gris au départ" : "Gris", "tone", 0, 1, 0.01));
        if (fill === "grad") side.append(range("Gris à l'arrivée", "tone2", 0, 1, 0.01), range("Sens du dégradé", "ga", 0, 360, 1));
      }
    }
    if (t) {
      const out = h("output.rot-out", Math.round(t.r || 0) + "°");
      side.append(h("label.row.range", "Rotation", h("input.rot-in", { type: "range", min: -180, max: 180, step: 1, value: Math.round(t.r || 0), on: { input: (e) => { t.r = +e.target.value; out.textContent = e.target.value + "°"; paint(); } } }), out),
        h("h4", "Ordre"), h("div.row.wrap",
        h("button.mini", { on: { click: () => { const i = shapes.indexOf(t); if (i < shapes.length - 1) { shapes.splice(i, 1); shapes.splice(i + 1, 0, t); paint(); } } } }, "Avancer"),
        h("button.mini", { on: { click: () => { const i = shapes.indexOf(t); if (i > 0) { shapes.splice(i, 1); shapes.splice(i - 1, 0, t); paint(); } } } }, "Reculer"),
        h("button.mini", { on: { click: () => { const c = JSON.parse(JSON.stringify(t)); c.id = uid(); c.p = c.p.map((p) => [p[0] + 0.03, p[1] + 0.03]); shapes.push(c); sel = c.id; paint(); props(); } } }, "Dupliquer"),
        h("button.mini.danger", { on: { click: () => { shapes.splice(shapes.indexOf(t), 1); sel = null; paint(); props(); } } }, "Supprimer")));
    }
    const tip = tool === "poly" || tool === "polyline" ? "Clique pour poser chaque point. Double-clic, Entrée ou clic sur le premier point : la forme se termine" + (tool === "poly" ? " et se ferme toute seule." : ".") + " Échap annule."
      : "Choisis un outil puis glisse dans le cadre. « Sélection » : clic sur une forme pour la régler, glisser pour la déplacer, points ronds pour l'étirer, poignée ↻ pour la tourner (Maj : par crans de 15°). Suppr efface.";
    side.append(h("p.muted", tip));
  }
  function tools() {
    bar.textContent = "";
    const pickTool = (k) => { finish(false); tool = k; if (PRIMS[k]) prim = k; if (PATHS[k]) path = k; if (k !== "select") sel = null; tools(); props(); paint(); };
    const drop = (label, list, current) => {              // bouton en deux moities : l'outil en cours, et la liste
      const [name, ico] = list[current];
      const wrap = h("div.draw-drop" + (tool === current ? ".on" : ""));
      const menu = h("div.draw-menu", Object.entries(list).map(([k, [n, i]]) => h("button" + (k === current ? ".on" : ""), { type: "button", on: { click: (e) => { e.stopPropagation(); wrap.classList.remove("open"); pickTool(k); } } }, h("span.ico", i), n)));
      wrap.append(h("button.mini.main", { type: "button", title: `${label} : ${name}`, on: { click: () => pickTool(current) } }, `${ico} ${name}`),
        h("button.mini.caret", { type: "button", title: "Choisir parmi les " + label.toLowerCase(), on: { click: (e) => { e.stopPropagation(); const was = wrap.classList.contains("open"); bar.querySelectorAll(".draw-drop.open").forEach((x) => x.classList.remove("open")); wrap.classList.toggle("open", !was); } } }, label + " ▾"), menu);
      return wrap;
    };
    bar.append(h("button.mini" + (tool === "select" ? ".on" : ""), { type: "button", title: "Choisir, déplacer, étirer, tourner", on: { click: () => pickTool("select") } }, "↖ Sélection"),
      drop("Primitives", PRIMS, prim), drop("Tracés", PATHS, path),
      h("button.mini.danger", { type: "button", title: "Retirer toutes les formes", on: { click: () => { if (shapes.length && confirm("Effacer tout le dessin de ce fond ?")) { building = null; shapes.length = 0; sel = null; paint(); props(); } } } }, "Tout effacer"));
  }
  const at = (e) => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const centerOf = (t) => { const b = boxOf(t, H); return [b.cx / W, b.cy / H]; };
  // pointeur ramene dans le repere de la forme (avant sa rotation)
  const local = (t, p, c) => { if (!t.r) return p; const q = rotPt([p[0] * W, p[1] * H], [c[0] * W, c[1] * H], -t.r); return [q[0] / W, q[1] / H]; };

  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const p = at(e);
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* pointeur deja relache */ }
    if (tool === "poly" || tool === "polyline") {         // point par point
      if (!building) { building = Object.assign({ id: uid(), t: tool, p: [p] }, JSON.parse(JSON.stringify(cur))); shapes.push(building); hover = p; return paint(); }
      const f = building.p[0], near = Math.hypot((p[0] - f[0]) * W, (p[1] - f[1]) * H) < 16;
      if (near && building.p.length >= 2) return finish(true);
      const l = building.p[building.p.length - 1];
      if (Math.hypot((p[0] - l[0]) * W, (p[1] - l[1]) * H) > 3) building.p.push(p);
      return paint();
    }
    if (tool === "select") {
      const t0 = target();
      if (e.target.dataset.rot && t0) { drag = { kind: "rot", c: centerOf(t0) }; return; }
      if (e.target.dataset.pt != null && t0) { drag = { kind: "pt", i: +e.target.dataset.pt, c: centerOf(t0) }; return; }
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
    const p = at(e);
    if (building) { hover = p; return paint(); }
    if (!drag) return;
    const t = target();
    if (!t) return;
    if (drag.kind === "new") {
      if (MANY.has(t.t)) { const l = t.p[t.p.length - 1]; if (Math.hypot((p[0] - l[0]) * W, (p[1] - l[1]) * H) > 5) t.p.push(p); }
      else t.p[1] = p;
    } else if (drag.kind === "rot") {
      let a = Math.atan2((p[1] - drag.c[1]) * H, (p[0] - drag.c[0]) * W) * 180 / Math.PI + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      t.r = Math.round(((a + 540) % 360) - 180);
      const inp = side.querySelector(".rot-in"), out = side.querySelector(".rot-out");
      if (inp) inp.value = t.r;
      if (out) out.textContent = t.r + "°";
    } else if (drag.kind === "pt") t.p[drag.i] = local(t, p, drag.c);
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
  svg.addEventListener("dblclick", (e) => { if (building) { e.preventDefault(); finish(true); } });
  const key = (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (building && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); return finish(true); }
    if (building && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return finish(false); }
    if ((e.key === "Delete" || e.key === "Backspace") && target()) { e.preventDefault(); e.stopPropagation(); shapes.splice(shapes.indexOf(target()), 1); sel = null; paint(); props(); }
  };
  document.addEventListener("keydown", key, true);
  const away = () => bar.querySelectorAll(".draw-drop.open").forEach((x) => x.classList.remove("open"));
  document.addEventListener("click", away);
  const done = () => { document.removeEventListener("keydown", key, true); document.removeEventListener("click", away); };
  tools(); props(); paint();
  const m = modal(title || "Dessiner le fond", h("div.draw-editor", h("div.draw-main", bar, ghostBar, h("div.draw-frame", svg)), side),
    [{ label: "Annuler", click: done },
     { label: "Enregistrer le fond", primary: true, click: () => { finish(true); done(); onSave({ shapes }); toast("Fond dessiné enregistré."); } }]);
  m.box.classList.add("modal-wide");
  return m;
}
