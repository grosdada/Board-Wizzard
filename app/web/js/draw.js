// Fond dessine d'une case : formes simples et traces en noir et blanc, avec des gris en trame (points, lignes, croix)
// unis ou en degrade. panel.draw = { shapes: [...] }. Une forme :
//   { id, t (primitive ou trace, voir PRIMS et PATHS), p: [[x, y]...] en fraction de la case, r (rotation en degres),
//     stroke: "#111111" | "#ffffff" | "none", sw (epaisseur), fill: none | white | black | tone | grad,
//     tone, tone2 (0 = blanc, 1 = noir), ga (angle du degrade), dot (taille de la trame), tc (couleur du fonce de la trame, noir par defaut), form: points | lignes | croix | triple | carres | cercles | vagues | grain,
//     ha (angle de la trame), mx (primitive retournee gauche-droite par « Miroir ») }
// La trame est faite par le navigateur : un motif en « cones » de gris + le ton voulu, puis un seuil. Les points
// grossissent donc tout seuls la ou le ton fonce, sans dessiner chaque point.
import { tt, tr } from "./i18n.js";
import { swatch } from "./colors.js";
import { h, modal, toast, history } from "./api.js";

export const W = 1000;                                   // largeur de travail ; la hauteur suit le format de la case
const uid = () => Math.random().toString(36).slice(2, 8);
const f1 = (n) => (+n).toFixed(1);
// primitives : se tracent en glissant d'un coin a l'autre
export const PRIMS = { rect: [tt("Rectangle"), "▭"], rrect: [tt("Rectangle arrondi"), "▢"], ellipse: [tt("Ellipse"), "◯"], tri: [tt("Triangle"), "△"],
                       diamond: [tt("Losange"), "◇"], hexa: [tt("Hexagone"), "⬡"], star: [tt("Étoile"), "☆"], arrow: [tt("Flèche pleine"), "➤"],
                       half: [tt("Demi-cercle"), "◓"], cloud: [tt("Nuage"), "☁"] };
// traces : forme libre (l'outil par defaut, en tete), ligne, main levee, ou point par point
export const PATHS = { blob: [tt("Forme libre"), "⬟"], line: [tt("Ligne"), "╱"], free: [tt("Tracé libre"), "✎"], poly: [tt("Forme point par point"), "⬠"],
                       polyline: [tt("Ligne brisée point par point"), "⌇"] };
const OPEN = new Set(["line", "free", "polyline"]);       // sans remplissage
const MANY = new Set(["free", "blob", "poly", "polyline"]);
// Remplissage d'une forme : fon (remplie ou non), col (couleur, blanc par defaut), tr (trame posee par-dessus la couleur).
const TRAMES = { none: tt("Sans trame"), tone: tt("Trame"), grad: tt("Trame en dégradé") };
/** Remplissage d'une forme, anciennes formes comprises (fill : none | white | black | color | tone | grad). */
export function fillOf(sh) {
  const ok = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : null);
  if (sh.fon !== undefined) return { on: !!sh.fon, col: ok(sh.col) || "#ffffff", tr: TRAMES[sh.tr] ? sh.tr : "none" };
  const f = sh.fill;
  if (f === "none") return { on: false, col: "#ffffff", tr: "none" };
  if (f === "black") return { on: true, col: "#111111", tr: "none" };
  if (f === "color") return { on: true, col: ok(sh.col) || "#808080", tr: "none" };
  if (f === "tone" || f === "grad") return { on: true, col: "#ffffff", tr: f };
  return { on: true, col: "#ffffff", tr: "none" };
}
const FORMS = { points: tt("Points"), lignes: tt("Lignes"), croix: tt("Croisillons"), triple: tt("Hachures en trois sens"), carres: tt("Carrés"),
                cercles: tt("Cercles concentriques"), vagues: tt("Lignes ondulées"), grain: tt("Grain") };
const DEF = { stroke: "#111111", sw: 1, fon: true, tr: "none", tone: 0.4, tone2: 0.9, ga: 90, dot: 14, form: "points", ha: 45, hand: 0, hw: 4, col: "#ffffff" };   // hand : tremble du trait a la main (0 = net), hw : longueur des ondulations

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
  const w = x1 - x0, hh = y1 - y0, cy = (y0 + y1) / 2, at = (u, v) => [x0 + (sh.mx ? 1 - u : u) * w, y0 + v * hh];   // mx : retournee
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

// ------------------------------------------------------------------------------------------------ lignes d'effet
// Lignes de manga posees sur le fond, facon generateur de « koukasen » en version simple.
//   draw.fx = { on, type (focus : lignes de concentration · speed : lignes de vitesse · flash : eclat plein),
//               cx, cy (centre, fraction de la case), n (nombre), inner (zone libre au centre, 0..1), w (epaisseur),
//               vari (irregularite, 0..1), ang (sens des lignes de vitesse), col (couleur des lignes), seed,
//               bgon, bg (fond colore derriere les lignes ; sinon elles sont sur fond transparent),
//               anim (animable dans le montage : piste « Lignes d'effet »), force (force de base, 1 = pleine) }
export const FX_TYPES = { focus: tt("Lignes de concentration"), speed: tt("Lignes de vitesse"), flash: tt("Éclat plein") };
export const FX_DEF = { on: false, type: "focus", cx: 0.5, cy: 0.5, n: 90, inner: 0.45, w: 1, vari: 0.6, ang: 0, col: "#111111", seed: 7, anim: false, force: 1 };
export const hasDraw = (draw) => !!(draw && (((draw.shapes || []).length) || (draw.fx && draw.fx.on)));
function rng(seed) { let a = (seed * 2654435761) >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** Balisage SVG des lignes d'effet, dans le repere W x H de la case. force : 0 (rien) a 1 (pleines), au-dela plus
 *  epaisses. tick : change le tirage (les lignes vibrent quand on l'incremente pendant la lecture). */
export function fxSvg(fx0, H, pre, force, tick = 0) {
  if (!fx0 || !fx0.on) return "";
  const fx = Object.assign({}, FX_DEF, fx0), f = Math.max(0, force ?? fx.force ?? 1);
  if (f <= 0.005) return "";
  const rnd = rng((fx.seed || 1) + tick * 101), cx = fx.cx * W, cy = fx.cy * H, n = Math.max(3, Math.round(fx.n)), v = Math.max(0, Math.min(1, fx.vari));
  const reach = Math.min(1, f), fat = Math.max(1, f);       // en dessous de 1 les lignes s'arretent plus loin du centre ; au-dessus elles grossissent
  const R = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) * 1.08, base = Math.min(W, H) * 0.62;
  const R0 = base * (fx.inner + (1 - reach) * (R / base - fx.inner));     // rayon libre : celui du reglage a pleine force, hors cadre a force 0
  let d = "", extra = "";
  if (fx.type === "speed") {
    const diag = Math.hypot(W, H);
    for (let i = 0; i < n; i++) {
      const y = (rnd() - 0.5) * diag, len = diag * (0.2 + rnd() * 0.8) * (0.25 + 0.75 * reach), x0 = (rnd() - 0.5) * diag * 1.3 - len / 2, th = fx.w * fat * (0.6 + rnd() * 2.6 * (0.3 + v));
      d += `M${f1(x0)} ${f1(y)}L${f1(x0 + len)} ${f1(y - th / 2)}L${f1(x0 + len)} ${f1(y + th / 2)}Z`;
    }
    extra = ` transform="translate(${f1(W / 2)} ${f1(H / 2)}) rotate(${f1(fx.ang || 0)})"`;
  } else if (fx.type === "flash") {
    const m = Math.max(8, n);
    d = `M${f1(-W)} ${f1(-H)}H${f1(2 * W)}V${f1(2 * H)}H${f1(-W)}Z`;
    for (let i = 0; i < m * 2; i++) {
      const a = (i + (rnd() - 0.5) * v * 0.8) / (m * 2) * Math.PI * 2, r = R0 * (i % 2 ? 1 + 0.28 * (0.4 + rnd() * v) : 1 - 0.3 * rnd() * v);
      d += `${i ? "L" : "M"}${f1(cx + Math.cos(a) * r)} ${f1(cy + Math.sin(a) * r)}`;
    }
    d += "Z";
  } else {
    for (let i = 0; i < n; i++) {
      const a = (i + (rnd() - 0.5) * v * 1.6) / n * Math.PI * 2, r = R0 * (1 + (rnd() - 0.5) * v * 0.9), hw = fx.w * fat * 0.0065 * (0.35 + rnd() * (0.3 + v));
      d += `M${f1(cx + Math.cos(a) * r)} ${f1(cy + Math.sin(a) * r)}L${f1(cx + Math.cos(a - hw) * R)} ${f1(cy + Math.sin(a - hw) * R)}L${f1(cx + Math.cos(a + hw) * R)} ${f1(cy + Math.sin(a + hw) * R)}Z`;
    }
  }
  const hex = (c, def) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : def);
  return `<clipPath id="${pre}fxc"><rect width="${W}" height="${f1(H)}"/></clipPath><g clip-path="url(#${pre}fxc)" style="pointer-events:none">` +
    (fx.bgon ? `<rect width="${W}" height="${f1(H)}" fill="${hex(fx.bg, "#ffffff")}"/>` : "") + `<path d="${d}" fill="${hex(fx.col, "#111111")}" fill-rule="${fx.type === "flash" ? "evenodd" : "nonzero"}"${extra}/></g>`;   // nonzero : deux lignes qui se chevauchent restent pleines
}

/** Balisage SVG du fond dessine, dans un repere W x H. pre : prefixe des identifiants (unique par case). */
export function drawSvg(draw, H, pre) {
  const shapes = (draw && draw.shapes) || [];
  if (!shapes.length) return fxSvg(draw && draw.fx, H, pre);
  let defs = `<filter id="${pre}th" color-interpolation-filters="sRGB" x="-5%" y="-5%" width="110%" height="110%"><feComponentTransfer>` +
    ["R", "G", "B"].map((c) => `<feFunc${c} type="linear" slope="26" intercept="-12.5"/>`).join("") + `</feComponentTransfer></filter>`;
  let body = "";
  shapes.forEach((raw, i) => {
    const sh = Object.assign({}, DEF, raw), d = geom(sh, H), id = pre + "s" + i, tag = `data-shape="${sh.id}"`;
    if (!d) return;
    const open = OPEN.has(sh.t), bx = boxOf(sh, H), fl = fillOf(raw);
    let one = "";
    if (!open && fl.on) one += `<path ${tag} d="${d}" fill="${fl.col}"/>`;          // la couleur, puis la trame par-dessus
    if (!open && fl.on && fl.tr !== "none") {
      const s = Math.max(4, sh.dot), rot = `rotate(${f1(sh.ha)})`;
      // une case du motif : un champ de gris (noir au coeur du motif), seuille plus bas selon le ton ; turn tourne le motif
      const cell = (pid, grad, turn = 0) => `<pattern id="${pid}" width="${f1(s)}" height="${f1(s)}" patternUnits="userSpaceOnUse" patternTransform="${rot}${turn ? ` rotate(${turn})` : ""}"><rect width="${f1(s)}" height="${f1(s)}" fill="url(#${id}${grad})"/></pattern>`;
      defs += `<radialGradient id="${id}r" cx="0.5" cy="0.5" r="0.72"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>` +
        `<linearGradient id="${id}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="0.5" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>` +
        `<clipPath id="${id}c"><path d="${d}"/></clipPath>`;
      const rect = (fill, extra = "") => `<rect x="${f1(bx.x)}" y="${f1(bx.y)}" width="${f1(bx.w)}" height="${f1(bx.h)}" fill="${fill}"${extra}/>`;
      let cone;
      const pad = s * 2, big = (fill) => `<rect x="${f1(bx.x - pad)}" y="${f1(bx.y - pad)}" width="${f1(bx.w + 2 * pad)}" height="${f1(bx.h + 2 * pad)}" fill="${fill}"/>`;
      const seed = [...String(sh.id || i)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 997, 7);
      if (sh.form === "lignes") { defs += cell(id + "p", "l"); cone = rect(`url(#${id}p)`); }
      else if (sh.form === "croix") { defs += cell(id + "p", "l") + cell(id + "q", "l", 90); cone = rect(`url(#${id}p)`) + rect(`url(#${id}q)`, ` style="mix-blend-mode:darken"`); }
      else if (sh.form === "triple") {                     // trois hachures a 60 degres
        defs += cell(id + "p", "l") + cell(id + "q", "l", 60) + cell(id + "u", "l", 120);
        cone = rect(`url(#${id}p)`) + rect(`url(#${id}q)`, ` style="mix-blend-mode:darken"`) + rect(`url(#${id}u)`, ` style="mix-blend-mode:darken"`);
      } else if (sh.form === "carres") {                   // deux lignes croisees, noir seulement la ou elles se recouvrent
        defs += cell(id + "p", "l") + cell(id + "q", "l", 90); cone = rect(`url(#${id}p)`) + rect(`url(#${id}q)`, ` style="mix-blend-mode:lighten"`);
      } else if (sh.form === "cercles") {                  // anneaux autour du centre de la forme
        defs += `<radialGradient id="${id}o" gradientUnits="userSpaceOnUse" cx="${f1(bx.cx)}" cy="${f1(bx.cy)}" r="${f1(s / 2)}" spreadMethod="reflect"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>`;
        cone = rect(`url(#${id}o)`);
      } else if (sh.form === "vagues") {                   // lignes deplacees par un bruit lent : gravure ondulee
        defs += cell(id + "p", "l") + `<filter id="${id}w" filterUnits="userSpaceOnUse" x="${f1(bx.x - pad)}" y="${f1(bx.y - pad)}" width="${f1(bx.w + 2 * pad)}" height="${f1(bx.h + 2 * pad)}" color-interpolation-filters="sRGB">` +
          `<feTurbulence type="fractalNoise" baseFrequency="${(0.2 / s).toFixed(5)}" numOctaves="2" seed="${seed}"/><feDisplacementMap in="SourceGraphic" scale="${f1(s * 3.5)}" xChannelSelector="R" yChannelSelector="G"/></filter>`;
        cone = `<g filter="url(#${id}w)">${big(`url(#${id}p)`)}</g>`;
      } else if (sh.form === "grain") {                    // grain irregulier, facon aquatinte
        defs += `<filter id="${id}n" filterUnits="userSpaceOnUse" x="${f1(bx.x)}" y="${f1(bx.y)}" width="${f1(bx.w)}" height="${f1(bx.h)}" color-interpolation-filters="sRGB">` +
          `<feTurbulence type="fractalNoise" baseFrequency="${(3 / s).toFixed(4)}" numOctaves="2" seed="${seed}"/>` +
          `<feColorMatrix type="matrix" values="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1"/>` +
          `<feComponentTransfer>${["R", "G", "B"].map((c) => `<feFunc${c} type="linear" slope="3.4" intercept="-1.2"/>`).join("")}</feComponentTransfer></filter>`;
        cone = `<rect x="${f1(bx.x)}" y="${f1(bx.y)}" width="${f1(bx.w)}" height="${f1(bx.h)}" fill="#fff" filter="url(#${id}n)"/>`;
      } else { defs += cell(id + "p", "r"); cone = rect(`url(#${id}p)`); }
      let tone;
      if (fl.tr === "grad") {
        const a = sh.ga * Math.PI / 180, dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
        defs += `<linearGradient id="${id}g" x1="${f1(0.5 - dx)}" y1="${f1(0.5 - dy)}" x2="${f1(0.5 + dx)}" y2="${f1(0.5 + dy)}"><stop offset="0" stop-color="${grey(sh.tone)}"/><stop offset="1" stop-color="${grey(sh.tone2)}"/></linearGradient>`;
        tone = `url(#${id}g)`;
      } else tone = grey(sh.tone);
      // moyenne du motif et du ton, puis seuil a mi-gris : noir la ou le motif est plus sombre que le ton demande
      // le blanc de la trame laisse voir la couleur dessous (multiplication), ses points noirs restent noirs
      // couleur de la trame : apres le seuil, le noir devient tc et le blanc reste blanc (sortie = tc + v (1 - tc))
      let th = `${pre}th`;
      const tc = /^#[0-9a-f]{6}$/i.test(sh.tc || "") ? sh.tc.toLowerCase() : "#000000";
      if (tc !== "#000000") {
        th = id + "k";
        const ch = [1, 3, 5].map((k) => parseInt(tc.slice(k, k + 2), 16) / 255);
        defs += `<filter id="${th}" color-interpolation-filters="sRGB" x="-5%" y="-5%" width="110%" height="110%"><feComponentTransfer>` +
          ["R", "G", "B"].map((c) => `<feFunc${c} type="linear" slope="26" intercept="-12.5"/>`).join("") + `</feComponentTransfer><feComponentTransfer>` +
          ["R", "G", "B"].map((c, k) => `<feFunc${c} type="linear" slope="${(1 - ch[k]).toFixed(4)}" intercept="${ch[k].toFixed(4)}"/>`).join("") + `</feComponentTransfer></filter>`;
      }
      one += `<g ${tag} filter="url(#${th})" style="mix-blend-mode:multiply"><g clip-path="url(#${id}c)" style="isolation:isolate">${rect("#fff")}${cone}${rect(tone, ` opacity="0.5"`)}</g></g>`;
    }
    if (sh.stroke !== "none" && sh.sw > 0) one += `<path ${tag} d="${d}" fill="none" stroke="${sh.stroke}" stroke-width="${f1(sh.sw * 4)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    else if (open || !fl.on) one += `<path ${tag} d="${d}" fill="none" stroke="#111111" stroke-opacity="0.001" stroke-width="12"/>`;
    if (!open && !fl.on) one += `<path ${tag} d="${d}" fill="#000" fill-opacity="0.001"/>`;    // attrapable a la souris
    if (sh.hand > 0) {                                     // trait a la main : un bruit doux deplace le contour, propre a chaque forme
      const amp = sh.hand * 3, pad = amp + sh.sw * 4 + 4, seed = [...String(sh.id || i)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 997, 7);
      defs += `<filter id="${id}h" filterUnits="userSpaceOnUse" x="${f1(bx.x - pad)}" y="${f1(bx.y - pad)}" width="${f1(bx.w + 2 * pad)}" height="${f1(bx.h + 2 * pad)}" color-interpolation-filters="sRGB">` +
        `<feTurbulence type="fractalNoise" baseFrequency="${(0.06 / Math.max(0.5, sh.hw)).toFixed(4)}" numOctaves="2" seed="${seed}"/><feDisplacementMap in="SourceGraphic" scale="${f1(amp)}" xChannelSelector="R" yChannelSelector="G"/></filter>`;
      one = `<g filter="url(#${id}h)">${one}</g>`;
    }
    body += sh.r ? `<g transform="rotate(${f1(sh.r)} ${f1(bx.cx)} ${f1(bx.cy)})">${one}</g>` : one;
  });
  return `<defs>${defs}</defs>${body}` + fxSvg(draw.fx, H, pre);          // les lignes d'effet par-dessus les formes
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
export function openDrawEditor({ draw, ratio, backdrop, title, onSave, ghosts = [], saveLabel = tt("Enregistrer le fond"), axis = false, under = null }) {
  const H = W * ratio;
  const shapes = JSON.parse(JSON.stringify((draw && draw.shapes) || []));
  let tool = "blob", prim = "rect", path = "blob", sel = null, drag = null, building = null, hover = null;
  const cur = Object.assign({}, DEF);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "draw-stage");
  const art = document.createElementNS(NS, "g"), over = document.createElementNS(NS, "g");
  const back = document.createElementNS(NS, "g"), guide = document.createElementNS(NS, "g");
  guide.setAttribute("style", "pointer-events:none");
  // zone de dessin : la case, plus ce qu'on ajoute autour (draw.ext = { l, r, t, b }, en largeurs et hauteurs de case)
  // pour un long travelling. Les formes gardent leurs coordonnees de case : hors de 0..1, elles sont hors cadre.
  const ext = Object.assign({ l: 0, r: 0, t: 0, b: 0 }, draw && draw.ext);
  const zone = () => {
    const x0 = -ext.l * W, y0 = -ext.t * H, ww = W * (1 + ext.l + ext.r), hh = H * (1 + ext.t + ext.b), big = ext.l + ext.r + ext.t + ext.b > 0;
    svg.setAttribute("viewBox", `${f1(x0)} ${f1(y0)} ${f1(ww)} ${f1(hh)}`);
    back.innerHTML = `<rect x="${f1(x0)}" y="${f1(y0)}" width="${f1(ww)}" height="${f1(hh)}" fill="${big ? "#ebe8e0" : "#ffffff"}"/><rect width="${W}" height="${f1(H)}" fill="#ffffff"/>` +
      (backdrop ? `<image href="${backdrop}" width="${W}" height="${f1(H)}" preserveAspectRatio="xMidYMid slice" opacity="0.35"/>` : "") +
      // retouche d'une image : elle est posee a sa place dans le cadre, pleinement visible, et on dessine par-dessus
      (under ? `<image href="${under.url}" x="${f1(under.x * W)}" y="${f1(under.y * H)}" width="${f1(under.w * W)}" height="${f1(under.h * H)}" preserveAspectRatio="none"/>` : "");
    const k = ww / W;                                       // le cadre de la case reste lisible quand on dezoome
    guide.innerHTML = (big ? `<rect width="${W}" height="${f1(H)}" fill="none" stroke="#e2603a" stroke-width="${f1(2.5 * k)}" stroke-dasharray="${f1(12 * k)} ${f1(8 * k)}"/>` +
      tt`<text x="${f1(6 * k)}" y="${f1(-6 * k)}" font-size="${f1(15 * k)}" fill="#e2603a">la case</text>` : "") +
      // element en paire (yeux, oreilles…) : l'axe du milieu, pour dessiner un cote puis « Miroir » ; il n'est pas enregistre
      (axis ? `<line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${f1(H)}" stroke="#2bb3a3" stroke-opacity="0.55" stroke-width="${f1(1.5 * k)}" stroke-dasharray="${f1(10 * k)} ${f1(8 * k)}"/>` : "");
  };
  zone();
  // fantome : les personnages de la case par-dessus le dessin, en transparence, pour dessiner autour d'eux
  const ghost = document.createElementNS(NS, "g");
  ghost.setAttribute("style", "pointer-events:none");
  ghost.innerHTML = ghosts.map((q) => { const hh = q.s * H, ww = hh * q.ar, cx = q.x * W, x = cx - ww / 2, y = q.y * H - hh;
    return `<image href="${q.url}" x="${f1(x)}" y="${f1(y)}" width="${f1(ww)}" height="${f1(hh)}" preserveAspectRatio="xMidYMax meet"${q.flip ? ` transform="translate(${f1(2 * cx)} 0) scale(-1 1)"` : ""}/>`; }).join("");
  const gs = Object.assign({ on: true, a: 0.45 }, JSON.parse(localStorage.getItem("bw.ghost") || "{}"));
  const ghostSync = () => { ghost.setAttribute("opacity", gs.a); ghost.setAttribute("display", gs.on ? "inline" : "none"); localStorage.setItem("bw.ghost", JSON.stringify(gs)); };
  ghostSync();
  const gOut = h("output", Math.round(gs.a * 100) + " %");
  const ghostBar = ghosts.length ? h("div.row.draw-ghost", { title: tt("Montre les personnages de la case par-dessus le dessin, pour s'en servir de repère. Ils ne font pas partie du fond.") },
    h("label.row.check", h("input", { type: "checkbox", checked: gs.on, on: { change: (e) => { gs.on = e.target.checked; ghostSync(); } } }), tt("👻 Personnages en fantôme")),
    h("label.row.range", tt("Opacité"), h("input", { type: "range", min: 0.05, max: 1, step: 0.01, value: gs.a, on: { input: (e) => { gs.a = +e.target.value; gOut.textContent = Math.round(gs.a * 100) + " %"; ghostSync(); } } }), gOut)) : "";
  const fxG = document.createElementNS(NS, "g");
  const fx = Object.assign({}, FX_DEF, draw && draw.fx);
  const fxPaint = () => {
    const k = 1 + ext.l + ext.r;                            // la mire reste lisible quand la zone est agrandie
    fxG.innerHTML = fxSvg(fx, H, "efx") + (fxAim && fx.on ? `<g transform="translate(${f1(fx.cx * W)} ${f1(fx.cy * H)}) scale(${f1(k)})" style="pointer-events:none"><circle r="16" fill="none" stroke="#e2603a" stroke-width="3"/><path d="M-26 0H26M0 -26V26" stroke="#e2603a" stroke-width="3"/></g>` : "");
    svg.style.cursor = fxAim ? "move" : "";
  };
  let fxAim = false, fxDrag = false;                      // mode « centre » : tant qu'il est allume, glisser dans l'image deplace le centre des lignes
  const fxBox = h("details.fold.draw-fx", { open: !!fx.on });
  const fxUi = () => {
    fxBox.textContent = "";
    const rg = (label, k, min, max, step, title) => { const out = h("output", String(fx[k]));
      return h("label.row.range", { title: title || "" }, label, h("input", { type: "range", min, max, step, value: fx[k], on: { input: (e) => { fx[k] = +e.target.value; out.textContent = e.target.value; fxPaint(); } } }), out); };
    fxBox.append(h("summary", tt("⚡ Lignes d'effet (concentration, vitesse, éclat)")),
      h("div.row.wrap", h("label.row.check", h("input", { type: "checkbox", checked: fx.on, on: { change: (e) => { fx.on = e.target.checked; fxPaint(); fxUi(); } } }), tt("Afficher")),
        h("select", { on: { change: (e) => { fx.type = e.target.value; fxPaint(); fxUi(); } } }, Object.entries(FX_TYPES).map(([k, n]) => h("option", { value: k, selected: fx.type === k }, n))),
        h("span.row.colrow", { title: tt("Couleur des lignes (les bandes)") }, tt("Lignes"), swatch(fx.col || "#111111", (c) => { fx.col = c; fxPaint(); })),
        h("label.row.check", { title: tt("Décoché : fond transparent, on voit le décor entre les lignes. Coché : un fond de couleur derrière les lignes.") }, h("input", { type: "checkbox", checked: !!fx.bgon, on: { change: (e) => { fx.bgon = e.target.checked; if (!fx.bg) fx.bg = "#ffffff"; fxPaint(); fxUi(); } } }), tt("Fond")),
        fx.bgon ? swatch(fx.bg || "#ffffff", (c) => { fx.bg = c; fxPaint(); }) : h("span.muted", tt("transparent")),
        h("button.mini", { type: "button", title: tt("Un autre tirage des mêmes lignes"), on: { click: () => { fx.seed = 1 + Math.floor(Math.random() * 9999); fxPaint(); } } }, "🎲")));
    if (!fx.on) return;
    fxBox.append(rg(tt("Nombre"), "n", 8, 400, 1), rg(tt("Épaisseur"), "w", 0.2, 80, 0.1, tt("Tout à droite, les lignes se rejoignent et couvrent tout de noir")), rg(tt("Irrégularité"), "vari", 0, 1, 0.01));
    if (fx.type === "speed") fxBox.append(rg(tt("Sens"), "ang", -180, 180, 1));
    else fxBox.append(rg(tt("Zone libre"), "inner", 0, 1.4, 0.01, tt("Taille de la zone sans lignes autour du centre")),
      h("div.row.wrap", h("button.mini" + (fxAim ? ".on" : ""), { type: "button", title: tt("Allume le mode centre : glisse alors dans l'image pour déplacer le point où les lignes convergent, autant de fois que tu veux. Reclique ce bouton quand c'est bon."), on: { click: () => { fxAim = !fxAim; fxDrag = false; fxPaint(); fxUi(); } } }, fxAim ? tt("✓ Centre trouvé (cliquer pour finir)") : tt("✛ Trouver le centre")),
        h("button.mini", { type: "button", on: { click: () => { fx.cx = 0.5; fx.cy = 0.5; fxPaint(); } } }, tt("Centrer"))));
    fxBox.append(h("label.row.check", { title: tt("Ajoute une piste « Lignes d'effet » dans le montage : un curseur de force à animer par clés (les lignes arrivent, grossissent, disparaissent), et elles vibrent pendant la lecture.") },
      h("input", { type: "checkbox", checked: !!fx.anim, on: { change: (e) => { fx.anim = e.target.checked; } } }), tt("Animable dans le montage ⓘ")));
  };
  fxUi(); fxPaint();
  svg.append(back, art, fxG, ghost, guide, over);
  // agrandir la zone : un demi-format de case a chaque clic, de chaque cote
  const grow = (side, d) => { ext[side] = Math.max(0, Math.min(6, +(ext[side] + d).toFixed(2))); zone(); paint(); extInfo(); };
  const fit = () => {                                     // recadrer : juste ce qu'il faut pour contenir les formes
    let x0 = 0, x1 = 1, y0 = 0, y1 = 1;
    for (const sh of shapes) for (const [x, y] of sh.p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const up = (v) => Math.ceil(Math.max(0, v) * 4 - 1e-6) / 4;
    Object.assign(ext, { l: up(-x0), r: up(x1 - 1), t: up(-y0), b: up(y1 - 1) }); zone(); paint(); extInfo();
  };
  const extOut = h("span.muted", "");
  const extInfo = () => { extOut.textContent = ext.l + ext.r + ext.t + ext.b > 0 ? tt`${(1 + ext.l + ext.r).toFixed(1)} × ${(1 + ext.t + ext.b).toFixed(1)} cases` : tt("taille de la case"); };
  extInfo();
  // marge : la zone de dessin grandit du meme pourcentage de la case de tous les cotes (10 % par defaut)
  let marginPct = 10;
  const addMargin = () => {
    const inp = h("input", { type: "number", min: 1, max: 300, step: 1, value: marginPct, style: { width: "80px" } });
    const m = modal(tt("Créer une marge"), h("div.form", h("label.row", { title: tt("En pourcentage de la case, ajouté à gauche, à droite, en haut et en bas") }, tt("Taille de la marge (%)"), inp)),
      [{ label: tt("Annuler") }, { label: tt("Créer une marge"), primary: true, click: () => {
        const v = Math.max(1, Math.min(300, +inp.value || 10)); marginPct = v;
        for (const k of ["l", "r", "t", "b"]) ext[k] = Math.max(0, Math.min(6, +(ext[k] + v / 100).toFixed(3)));
        zone(); paint(); extInfo();
      } }]);
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); m.box.querySelector("footer button.primary").click(); } });
  };
  const gb = (label, side, title) => h("button.mini", { type: "button", title, on: { click: (e) => grow(side, e.shiftKey ? -0.5 : 0.5) } }, label);
  const extBar = h("div.row.draw-ext", { title: tt("Agrandit la zone de dessin au-delà de la case, pour un long travelling : ce qui est hors du cadre orange n'apparaît que quand la caméra du montage s'y déplace. Maj + clic réduit.") },
    h("span", tt("Zone de dessin ⓘ")), gb("◀＋", "l", tt("Ajouter à gauche (Maj : retirer)")), gb("＋▶", "r", tt("Ajouter à droite (Maj : retirer)")), gb("▲＋", "t", tt("Ajouter en haut (Maj : retirer)")), gb("＋▼", "b", tt("Ajouter en bas (Maj : retirer)")),
    h("button.mini", { type: "button", title: tt("Ajoute une marge tout autour de l'image : la zone de dessin grandit du même pourcentage de chaque côté"), on: { click: addMargin } }, tt("⬚ Marge")),
    h("button.mini", { type: "button", title: tt("Réduit la zone à la case et aux formes déjà dessinées"), on: { click: fit } }, tt("Recadrer")), extOut);
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
        `<g class="draw-rot" data-rot="1" transform="translate(${f1(b.cx)} ${f1(top - 44)})"><circle r="15" data-rot="1"/><path d="M-7 -3A8 8 0 1 1 -5 6M-7 -3L-11 -8M-7 -3L-1 -4"/></g>${corners}` +
        // carre au coin bas droit : le glisser agrandit ou reduit toute la forme autour de son centre (Maj : en largeur seulement, Alt : en hauteur seulement)
        `<g class="draw-scale" data-scale="1" transform="translate(${f1(b.x + b.w + 20)} ${f1(b.y + b.h + 20)})"><rect x="-11" y="-11" width="22" height="22" rx="4" data-scale="1"/><path d="M-5 -5L5 5M5 5H0M5 5V0M-5 -5H0M-5 -5V0" data-scale="1"/></g></g>`;
    }
    if (building) {                                        // forme point par point en cours
      const P = building.p.map(([x, y]) => [x * W, y * H]), last = hover ? [hover[0] * W, hover[1] * H] : P[P.length - 1];
      o += `<path d="M${P.map((p) => f1(p[0]) + " " + f1(p[1])).join("L")}L${f1(last[0])} ${f1(last[1])}" class="draw-build"/>` +
        P.map((p, i) => `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="${i ? 6 : 11}" class="draw-pt${i ? "" : " first"}" style="pointer-events:none"/>`).join("");
    }
    over.innerHTML = o;
  }
  // miroir gauche-droite par rapport a l'axe vertical du milieu de la case : la forme choisie, sinon tout le dessin.
  // Les copies sont des formes ordinaires ; l'original reste.
  function mirror() {
    finish(true);
    hist.snap();                                           // l'etat d'avant : Ctrl+Z retire le miroir d'un coup, et seulement lui
    const src = tool === "select" && sel ? shapes.filter((x) => x.id === sel) : shapes.slice();   // en dessinant : tout le dessin
    if (!src.length) { toast(tt("Rien à retourner : dessine d'abord une forme.")); return; }
    const copies = src.map((sh) => {
      const c = JSON.parse(JSON.stringify(sh));
      c.id = uid(); c.p = c.p.map(([x, y]) => [1 - x, y]);
      if (c.r) c.r = -c.r;
      if (PRIMS[c.t]) c.mx = !c.mx;                          // une primitive se dessine dans sa boite : on la retourne
      if (c.ga != null) c.ga = (540 - c.ga) % 360;
      if (c.ha != null) c.ha = (180 - c.ha + 180) % 180;
      return c;
    });
    shapes.push(...copies);
    sel = copies.length === 1 ? copies[0].id : null;
    paint(); props(); hist.snap();
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
    side.append(h("h4", t ? tt("Forme choisie") : tt("Prochaine forme")),
      pick(tt("Trait"), "stroke", { "#111111": tt("Noir"), "#ffffff": tt("Blanc"), none: tt("Aucun") }));
    if (val("stroke") !== "none") side.append(range(tt("Épaisseur"), "sw", 0.2, 12, 0.1));
    side.append(h("h4", tt("Trait à la main")), range(tt("Tremblé"), "hand", 0, 10, 0.1), range(tt("Ondulation"), "hw", 0.5, 12, 0.1),
      h("p.muted", tt("Tremblé à 0 : trait net. Ondulation courte = trait nerveux, longue = lignes qui flottent.")));
    if (!open) {
      const fl = fillOf(t || cur);
      const write = (o) => { for (const tg of [t, cur]) if (tg) { tg.fon = o.on; tg.col = o.col; tg.tr = o.tr; delete tg.fill; } };
      const setFill = (patch) => { write(Object.assign(fl, patch)); paint(); props(); };
      side.append(h("div.row.fillrow",
        h("label.row.check", { title: tt("Décoché : la forme n'est pas remplie, on voit à travers") }, h("input", { type: "checkbox", checked: fl.on, on: { change: (e) => setFill({ on: e.target.checked }) } }), tt("Remplissage")),
        fl.on ? swatch(fl.col, (c) => { fl.col = c; write(fl); paint(); }) : "",
        fl.on ? h("select", { title: tt("Trame posée par-dessus la couleur"), on: { change: (e) => setFill({ tr: e.target.value }) } }, Object.entries(TRAMES).map(([v, n]) => h("option", { value: v, selected: fl.tr === v }, n))) : ""));
      const fill = fl.on ? fl.tr : "none";
      if (fill === "tone" || fill === "grad") {
        side.append(h("h4", tt("Trame")), pick(tt("Motif"), "form", FORMS),
          h("span.row.colrow", { title: tt("Couleur du foncé de la trame (ses points, lignes, carrés…). Le clair reste transparent sur la couleur de fond.") }, tt("Couleur de la trame"),
            swatch(val("tc") || "#000000", (c) => set("tc", c), () => hist.snap())),
          range(tt("Taille"), "dot", 4, 60, 0.5), range(tt("Angle de la trame"), "ha", 0, 180, 1),
          range(fill === "grad" ? tt("Gris au départ") : tt("Gris"), "tone", 0, 1, 0.01));
        if (fill === "grad") side.append(range(tt("Gris à l'arrivée"), "tone2", 0, 1, 0.01), range(tt("Sens du dégradé"), "ga", 0, 360, 1));
      }
    }
    if (t) {
      const out = h("output.rot-out", Math.round(t.r || 0) + "°");
      side.append(h("label.row.range", tt("Rotation"), h("input.rot-in", { type: "range", min: -180, max: 180, step: 1, value: Math.round(t.r || 0), on: { input: (e) => { t.r = +e.target.value; out.textContent = e.target.value + "°"; paint(); } } }), out),
        h("h4", tt("Ordre")), h("div.row.wrap",
        h("button.mini", { on: { click: () => { const i = shapes.indexOf(t); if (i < shapes.length - 1) { shapes.splice(i, 1); shapes.splice(i + 1, 0, t); paint(); } } } }, tt("Avancer")),
        h("button.mini", { on: { click: () => { const i = shapes.indexOf(t); if (i > 0) { shapes.splice(i, 1); shapes.splice(i - 1, 0, t); paint(); } } } }, tt("Reculer")),
        h("button.mini", { on: { click: () => { const c = JSON.parse(JSON.stringify(t)); c.id = uid(); c.p = c.p.map((p) => [p[0] + 0.03, p[1] + 0.03]); shapes.push(c); sel = c.id; paint(); props(); } } }, tt("Dupliquer")),
        h("button.mini.danger", { on: { click: () => { shapes.splice(shapes.indexOf(t), 1); sel = null; paint(); props(); } } }, tt("Supprimer"))));
    }
    const tip = tool === "poly" || tool === "polyline" ? tt("Clique pour poser chaque point. Double-clic, Entrée ou clic sur le premier point : la forme se termine") + (tool === "poly" ? tt(" et se ferme toute seule.") : ".") + tt(" Échap annule.")
      : (MANY.has(tool) && tool !== "poly" && tool !== "polyline" ? tt("Main levée : Ctrl enfoncé trace une droite depuis le dernier point ; Ctrl relâché, on repart à main levée. ") : "") + tt("Choisis un outil puis glisse dans le cadre. « Sélection » : clic sur une forme pour la régler, glisser pour la déplacer, carré ⤡ du coin pour l'agrandir, points ronds pour l'étirer, poignée ↻ pour la tourner (Maj : par crans de 15°). Suppr efface.");
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
        h("button.mini.caret", { type: "button", title: tt("Choisir parmi les ") + label.toLowerCase(), on: { click: (e) => { e.stopPropagation(); const was = wrap.classList.contains("open"); bar.querySelectorAll(".draw-drop.open").forEach((x) => x.classList.remove("open")); wrap.classList.toggle("open", !was); } } }, label + " ▾"), menu);
      return wrap;
    };
    bar.append(h("button.mini" + (tool === "select" ? ".on" : ""), { type: "button", title: tt("Choisir, déplacer, étirer, tourner"), on: { click: () => pickTool("select") } }, tt("↖ Sélection")),
      drop(tt("Primitives"), PRIMS, prim), drop(tt("Tracés"), PATHS, path),
      h("button.mini", { type: "button", title: tt("Ajoute une copie en miroir gauche-droite (par rapport au milieu du cadre) de tout le dessin, ou seulement de la forme choisie avec l'outil Sélection : un œil dessiné à gauche donne son jumeau à droite"), on: { click: mirror } }, tt("⇋ Miroir")),
      h("button.mini.danger", { type: "button", title: tt("Retirer toutes les formes"), on: { click: () => { if (shapes.length && confirm(tt("Effacer tout le dessin de ce fond ?"))) { building = null; shapes.length = 0; sel = null; paint(); props(); } } } }, tt("Tout effacer")));
  }
  // point de la souris en fraction de la case, par la matrice du SVG : juste meme si l'image n'occupe pas tout son cadre a l'ecran
  const at = (e) => {
    const m = svg.getScreenCTM();
    if (m) { const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()); return [q.x / W, q.y / H]; }
    const r = svg.getBoundingClientRect();
    return [-ext.l + (e.clientX - r.left) / r.width * (1 + ext.l + ext.r), -ext.t + (e.clientY - r.top) / r.height * (1 + ext.t + ext.b)];
  };
  const centerOf = (t) => { const b = boxOf(t, H); return [b.cx / W, b.cy / H]; };
  // pointeur ramene dans le repere de la forme (avant sa rotation)
  const local = (t, p, c) => { if (!t.r) return p; const q = rotPt([p[0] * W, p[1] * H], [c[0] * W, c[1] * H], -t.r); return [q[0] / W, q[1] / H]; };

  svg.addEventListener("pointerdown", (e) => {
    if (fxAim) { const q = at(e); fx.cx = +q[0].toFixed(3); fx.cy = +q[1].toFixed(3); fxDrag = true; try { svg.setPointerCapture(e.pointerId); } catch (err) { /* rien */ } fxPaint(); return; }
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
      if (e.target.dataset.scale && t0) { const c = centerOf(t0); drag = { kind: "scale", c, pts: t0.p.map((q) => q.slice()), d0: Math.hypot((p[0] - c[0]) * W, (p[1] - c[1]) * H) || 1 }; return; }
      if (e.target.dataset.pt != null && t0) { drag = { kind: "pt", i: +e.target.dataset.pt, c: centerOf(t0) }; return; }
      const id = e.target.dataset.shape || (e.target.closest("[data-shape]") || {}).dataset?.shape;
      sel = id || null; props(); paint();
      if (sel) drag = { kind: "move", start: p, pts: target().p.map((q) => q.slice()) };
      return;
    }
    const sh = Object.assign({ id: uid(), t: tool, p: [p, p] }, JSON.parse(JSON.stringify(cur)));
    shapes.push(sh); sel = sh.id; drag = { kind: "new", sh, keep: [], a: null };   // keep : coins des droites (Ctrl), gardes a l'allegement
    paint();
  });
  svg.addEventListener("pointermove", (e) => {
    const p = at(e);
    if (fxAim) { if (fxDrag) { fx.cx = +p[0].toFixed(3); fx.cy = +p[1].toFixed(3); fxPaint(); } return; }
    if (building) { hover = p; return paint(); }
    if (!drag) return;
    const t = target();
    if (!t) return;
    if (drag.kind === "new") {
      if (MANY.has(t.t)) {
        // main levee ; Ctrl enfonce : droite elastique depuis le dernier point. Chaque bout est double : le lissage
        // passe alors exactement par lui, la droite reste droite et ses coins nets.
        if (e.ctrlKey) {
          if (drag.a == null) { const l = t.p[t.p.length - 1]; t.p.push(l.slice()); drag.a = t.p.length; drag.keep.push(drag.a - 2, drag.a - 1); }
          t.p.length = drag.a; t.p.push(p, p.slice());
        } else {
          if (drag.a != null) { drag.keep.push(drag.a, drag.a + 1); drag.a = null; }
          const l = t.p[t.p.length - 1]; if (Math.hypot((p[0] - l[0]) * W, (p[1] - l[1]) * H) > 5) t.p.push(p);
        }
      }
      else t.p[1] = p;
    } else if (drag.kind === "rot") {
      let a = Math.atan2((p[1] - drag.c[1]) * H, (p[0] - drag.c[0]) * W) * 180 / Math.PI + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      t.r = Math.round(((a + 540) % 360) - 180);
      const inp = side.querySelector(".rot-in"), out = side.querySelector(".rot-out");
      if (inp) inp.value = t.r;
      if (out) out.textContent = t.r + "°";
    } else if (drag.kind === "scale") {
      const k = Math.max(0.03, Math.hypot((p[0] - drag.c[0]) * W, (p[1] - drag.c[1]) * H) / drag.d0), kx = e.altKey ? 1 : k, ky = e.shiftKey ? 1 : k;
      t.p = drag.pts.map((q) => [drag.c[0] + (q[0] - drag.c[0]) * kx, drag.c[1] + (q[1] - drag.c[1]) * ky]);
    } else if (drag.kind === "pt") t.p[drag.i] = local(t, p, drag.c);
    else t.p = drag.pts.map((q) => [q[0] + p[0] - drag.start[0], q[1] + p[1] - drag.start[1]]);
    paint();
  });
  svg.addEventListener("pointerup", () => {
    fxDrag = false;
    const d = drag; drag = null;
    if (!d || d.kind !== "new") return;
    const t = d.sh, a = t.p[0], b = t.p[t.p.length - 1];
    if (t.p.length <= 2 && Math.hypot((b[0] - a[0]) * W, (b[1] - a[1]) * H) < 6) { shapes.splice(shapes.indexOf(t), 1); sel = null; }   // simple clic : rien
    else if (t.p.length > 40) {                           // allege la main levee, sans toucher aux coins des droites
      if (d.a != null) d.keep.push(d.a, d.a + 1);
      const ix = new Set([...d.keep.filter((i) => i < t.p.length), ...Array.from({ length: 40 }, (_, i) => Math.round(i * (t.p.length - 1) / 39))]);
      t.p = [...ix].sort((x, y) => x - y).map((i) => t.p[i]);
    }
    props(); paint();
  });
  svg.addEventListener("dblclick", (e) => { if (building) { e.preventDefault(); finish(true); } });
  // Ctrl+Z / Ctrl+Y : les 5 dernieres actions
  const hist = history(() => shapes.filter((x) => x !== building), (st) => { building = null; hover = null; drag = null; shapes.splice(0, shapes.length, ...st); if (!target()) sel = null; props(); paint(); });
  const key = (e) => {
    if (hist.keydown(e)) return;
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
  const m = modal(title || tt("Dessiner le fond"), h("div.draw-editor", h("div.draw-main", bar, ghostBar, extBar, h("div.draw-frame", svg), fxBox), side),
    [{ label: tt("Annuler"), click: done },
     { label: saveLabel, primary: true, click: () => { finish(true); done(); onSave(Object.assign({ shapes }, ext.l + ext.r + ext.t + ext.b > 0 ? { ext } : null, fx.on ? { fx } : null)); if (saveLabel === tt("Enregistrer le fond")) toast(tt("Fond dessiné enregistré.")); } }]);   // ailleurs, l'appelant dit lui-meme ce qui est fait
  m.box.classList.add("modal-wide");
  hist.watch(m.box);
  return m;
}
