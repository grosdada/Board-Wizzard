// Fond dessine d'une case : formes simples et traces en noir et blanc, avec des gris en trame (points, lignes, croix)
// unis ou en degrade. panel.draw = { shapes: [...] }. Une forme :
//   { id, t (primitive ou trace, voir PRIMS et PATHS), p: [[x, y]...] en fraction de la case, r (rotation en degres),
//     stroke: "#111111" | "#ffffff" | "none", sw (epaisseur), fill: none | white | black | tone | grad,
//     tone, tone2 (0 = blanc, 1 = noir), ga (angle du degrade), dot (taille de la trame), tc (couleur du fonce de la trame, noir par defaut), form: points | lignes | croix | triple | carres | cercles | vagues | grain,
//     ha (angle de la trame), mx (primitive retournee gauche-droite par « Miroir ») }
// La trame est faite par le navigateur : un motif en « cones » de gris + le ton voulu, puis un seuil. Les points
// grossissent donc tout seuls la ou le ton fonce, sans dessiner chaque point.
import { tt, tr } from "./i18n.js";
import { swatch, stageFill, stagePattern, stageBgControl } from "./colors.js";
import { h, modal, toast, history, upload } from "./api.js";
import { PRESETS, PRESET_CATS, presetPath, presetThumb } from "./presets.js";

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
// pinceaux de l'atelier d'elements (option kit de l'editeur) : se tracent a main levee
//   brush : pinceau qui finit en pointe, epaisseur bsw, pointes tp, pw = force de chaque point (pression ou vitesse)
//   paint : pinceau de fond, couleur pc, largeur bw, opacite op, lavis soft (bords flous et irreguliers)
//   erase : gomme (efface ce qui est dessous dans le meme calque), largeur bw
//   stamp : pinceau-tampon, l'image href (importee) posee le long du trace, taille ss, ecart gap
// et l'image importee : { t: "img", href, p: [coin, coin], ink: none | clair (blanc transparent) | encre, iop }
//   hair : poils ou pointille, semes le long du trace : densite hd, etalement hs, longueur hl (0 = des points), epaisseur hz,
//          desordre hj (degres), direction ho (degres par rapport au trace : 0 = le long, 90 = en travers)
export const BRUSHES = { brush: [tt("Pinceau en pointe"), "🖌"], paint: [tt("Pinceau de fond (aplat, lavis)"), "🎨"], erase: [tt("Gomme"), "⌫"],
                         stamp: [tt("Pinceau-tampon (image importée)"), "✺"], hair: [tt("Poils / pointillé (barbe, cheveux)"), "✳"] };
const OPEN = new Set(["line", "free", "polyline", "brush", "paint", "erase", "stamp", "hair"]);       // sans remplissage
const MANY = new Set(["free", "blob", "poly", "polyline", "brush", "paint", "erase", "stamp", "hair"]);
const SPECIAL = new Set(["brush", "paint", "erase", "stamp", "img", "hair"]);
const BRUSH_KEYS = ["bsw", "tp", "sv", "pc", "bw", "op", "soft", "ss", "gap", "ink", "iop", "pw", "hd", "hs", "hl", "hz", "hj", "ho"];
// pinceaux enregistres (bw.brushes) : { n : nom, t : type de pinceau, v : ses reglages }
const BRUSH_SAVE = { brush: ["stroke", "bsw", "tp", "sv"], paint: ["pc", "bw", "op", "soft"], stamp: ["href", "ar", "ss", "gap", "ink", "stroke"],
                     hair: ["stroke", "hd", "hs", "hl", "hz", "hj", "ho"], erase: ["bw"] };
const savedBrushes = () => { try { return JSON.parse(localStorage.getItem("bw.brushes") || "[]") || []; } catch (e) { return []; } };
const storeBrushes = (l) => localStorage.setItem("bw.brushes", JSON.stringify(l.slice(0, 60)));
let clip = null;                                           // formes copiees (Ctrl+C), gardees d'un atelier a l'autre
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
const DEF = { stroke: "#111111", sw: 1, fon: true, tr: "none", tone: 0.4, tone2: 0.9, ga: 90, dot: 14, form: "points", ha: 45, hand: 0, hw: 4, col: "#ffffff",   // hand : tremble du trait a la main (0 = net), hw : longueur des ondulations
              bsw: 2.5, tp: 0.3, sv: 0.6, pc: "#7d8c99", bw: 12, op: 0.55, soft: 0.3, ss: 25, gap: 0.3, ink: "clair", iop: 1,   // pinceaux (voir BRUSHES)
              hd: 8, hs: 5, hl: 5, hz: 0.6, hj: 25, ho: 90 };
// poils ou pointille le long d'un trace : semis au hasard mais toujours le meme pour une forme (graine = son identifiant)
function hairSvg(sh, H, tag, d) {
  const P = sh.p.map(([x, y]) => [x * W, y * H]);
  if (P.length < 2) return "";
  let seed = [...String(sh.id || "h")].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 2147483647, 11) || 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const dens = Math.max(0.2, +sh.hd || 0), spread = Math.max(0, +sh.hs || 0) * 4, len = Math.max(0, +sh.hl || 0) * 4, th = Math.max(0.2, +sh.hz || 0) * 2;
  const jit = (+sh.hj || 0) * Math.PI / 180, dir = (+sh.ho || 0) * Math.PI / 180;
  let dots = "", lines = "", carry = 0;
  for (let k = 1; k < P.length; k++) {
    const a = P[k - 1], b = P[k], dx = b[0] - a[0], dy = b[1] - a[1], seg = Math.hypot(dx, dy);
    if (seg < 0.01) continue;
    const nx = -dy / seg, ny = dx / seg, base = Math.atan2(dy, dx) + dir;
    let n = seg * dens / 10 + carry;
    const count = Math.floor(n); carry = n - count;
    for (let j = 0; j < count; j++) {
      const t = rnd(), off = (rnd() + rnd() + rnd() - 1.5) / 1.5 * spread;
      const px = a[0] + dx * t + nx * off, py = a[1] + dy * t + ny * off;
      if (len <= 0) { const r = th / 2 * (0.6 + 0.8 * rnd()); dots += `M${f1(px - r)} ${f1(py)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`; }
      else { const an = base + (rnd() - 0.5) * 2 * jit, L = len * (0.5 + rnd()); lines += `M${f1(px)} ${f1(py)}l${f1(Math.cos(an) * L)} ${f1(Math.sin(an) * L)}`; }
    }
  }
  const col = hex6(sh.stroke, "#111111");
  return `<g ${tag}>` + (dots ? `<path d="${dots}" fill="${col}"/>` : "") + (lines ? `<path d="${lines}" fill="none" stroke="${col}" stroke-width="${f1(th)}" stroke-linecap="round"/>` : "") +
    `</g><path ${tag} d="${d}" fill="none" stroke="#000" stroke-opacity="0.001" stroke-width="${f1(Math.max(8, spread * 2))}"/>`;
}
// force d'un point du pinceau en pointe : pression d'un stylet, sinon vitesse de la souris (v en unites par ms, vite = fin)
const force = (e, v, sv) => (e.pointerType === "pen" && e.pressure > 0 ? 0.15 + 1.05 * e.pressure : Math.max(0.3, Math.min(1.2, 1.2 - (sv ?? 0.6) * v / 1.6)));
const hex6 = (c, def) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : def);
// contour plein d'un trait de pinceau en pointe : la largeur suit la force de chaque point et s'affine aux deux bouts
function brushPath(sh, H) {
  const P = sh.p.map(([x, y]) => [x * W, y * H]), n = P.length, base = Math.max(0.3, sh.bsw) * 4, pw = sh.pw || [];
  if (n < 2) return "";
  const s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const L = s[n - 1] || 1, tl = Math.max(0, Math.min(0.5, sh.tp)) * L;
  const wid = (i) => { let k = pw[i] ?? 1; if (tl > 0.5) k *= Math.pow(Math.max(0.04, Math.min(1, s[i] / tl, (L - s[i]) / tl)), 0.65); return Math.max(0.15, base * k) / 2; };
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1, w = wid(i);
    left.push([P[i][0] - dy / m * w, P[i][1] + dx / m * w]); right.push([P[i][0] + dy / m * w, P[i][1] - dx / m * w]);
  }
  const side = (Q) => { let d = ""; for (let i = 1; i < Q.length - 1; i++) d += `Q${f1(Q[i][0])} ${f1(Q[i][1])} ${f1((Q[i][0] + Q[i + 1][0]) / 2)} ${f1((Q[i][1] + Q[i + 1][1]) / 2)}`; return d + `L${f1(Q[Q.length - 1][0])} ${f1(Q[Q.length - 1][1])}`; };
  const R = right.reverse();
  return `M${f1(left[0][0])} ${f1(left[0][1])}` + side(left) + `L${f1(R[0][0])} ${f1(R[0][1])}` + side(R) + "Z";
}
// filtre d'une image importee : clair = le blanc du papier devient transparent ; encre = idem, le trait prend la couleur c
function inkFilter(id, ink, c) {
  if (ink !== "clair" && ink !== "encre") return "";
  const A = "-0.48 -0.94 -0.18 0 1.6", ch = [1, 3, 5].map((k) => (parseInt(hex6(c, "#111111").slice(k, k + 2), 16) / 255).toFixed(3));
  const rgb = ink === "encre" ? `0 0 0 0 ${ch[0]} 0 0 0 0 ${ch[1]} 0 0 0 0 ${ch[2]}` : "1 0 0 0 0 0 1 0 0 0 0 0 1 0 0";
  return `<filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${rgb} ${A}" result="a"/><feComposite in="a" in2="SourceAlpha" operator="in"/></filter>`;
}

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
  if (sh.t === "pre") return presetPath(sh.k, x0, y0, w, hh, sh.mx);   // forme toute faite (presets.js), recalee dans sa boite
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
//  draw.layers (atelier d'elements) : [{ id, name, hidden, op, shapes }], du dessous vers le dessus ; sinon draw.shapes.
//  opt.live : indice du calque en cours (les autres ne prennent pas la souris) ; opt.hrefs : adresse -> data: des images.
export function drawSvg(draw, H, pre, opt = {}) {
  const lays = draw && Array.isArray(draw.layers) ? draw.layers : null;
  if (lays) {
    let out = "";
    lays.forEach((l, i) => {
      if (l.hidden || !(l.shapes || []).length) return;
      const op = l.op == null ? 1 : Math.max(0, Math.min(1, +l.op));
      out += `<g data-layer="${i}"${op < 1 ? ` opacity="${op}"` : ""}${opt.live != null && opt.live !== i ? ` style="pointer-events:none"` : ""}>${shapesSvg(l.shapes, H, pre + "l" + i, opt.hrefs)}</g>`;
    });
    return out + fxSvg(draw.fx, H, pre);
  }
  const shapes = (draw && draw.shapes) || [];
  if (!shapes.length) return fxSvg(draw && draw.fx, H, pre);
  return shapesSvg(shapes, H, pre, opt.hrefs) + fxSvg(draw.fx, H, pre);          // les lignes d'effet par-dessus les formes
}
function shapesSvg(shapes, H, pre, hrefs) {
  let defs = `<filter id="${pre}th" color-interpolation-filters="sRGB" x="-5%" y="-5%" width="110%" height="110%"><feComponentTransfer>` +
    ["R", "G", "B"].map((c) => `<feFunc${c} type="linear" slope="26" intercept="-12.5"/>`).join("") + `</feComponentTransfer></filter>`;
  let body = "";
  shapes.forEach((raw, i) => {
    const sh = Object.assign({}, DEF, raw), d = sh.t === "img" ? "M0 0" : geom(sh, H), id = pre + "s" + i, tag = `data-shape="${sh.id}"`;
    if (!d) return;
    const open = OPEN.has(sh.t), bx = boxOf(sh, H), fl = fillOf(raw);
    let one = "";
    const rot = (s) => (sh.r ? `<g transform="rotate(${f1(sh.r)} ${f1(bx.cx)} ${f1(bx.cy)})">${s}</g>` : s);
    if (sh.t === "erase") {                                // gomme : masque tout ce qui est deja dessine dans ce calque
      const B = 8 * Math.max(W, H), w = f1(Math.max(1, sh.bw) * 4);
      defs += `<mask id="${id}m" maskUnits="userSpaceOnUse" x="${-B}" y="${-B}" width="${2 * B}" height="${2 * B}"><rect x="${-B}" y="${-B}" width="${2 * B}" height="${2 * B}" fill="#fff"/>` +
        rot(`<path d="${d}" fill="none" stroke="#000" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`) + `</mask>`;
      body = `<g mask="url(#${id}m)">${body}</g>` + rot(`<path ${tag} d="${d}" fill="none" stroke="#000" stroke-opacity="0.001" stroke-width="${w}" stroke-linecap="round"/>`);
      return;
    }
    if (SPECIAL.has(sh.t)) {
      if (sh.t === "brush") one = `<path ${tag} d="${brushPath(sh, H)}" fill="${hex6(sh.stroke, "#111111")}"/>`;
      else if (sh.t === "hair") one = hairSvg(sh, H, tag, d);
      else if (sh.t === "paint") {
        const w = Math.max(1, sh.bw) * 4, soft = Math.max(0, Math.min(1, sh.soft)), pad = w * 2;
        let flt = "";
        if (soft > 0) {                                    // lavis : bord irregulier puis flou
          defs += `<filter id="${id}w" filterUnits="userSpaceOnUse" x="${f1(bx.x - pad)}" y="${f1(bx.y - pad)}" width="${f1(bx.w + 2 * pad)}" height="${f1(bx.h + 2 * pad)}" color-interpolation-filters="sRGB">` +
            `<feTurbulence type="fractalNoise" baseFrequency="${(1.2 / w).toFixed(4)}" numOctaves="2" seed="${[...String(sh.id || i)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 997, 7)}"/>` +
            `<feDisplacementMap in="SourceGraphic" scale="${f1(soft * w * 0.6)}" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="${f1(soft * w * 0.18)}"/></filter>`;
          flt = ` filter="url(#${id}w)"`;
        }
        one = `<path ${tag} d="${d}" fill="none" stroke="${hex6(sh.pc, "#7d8c99")}" stroke-opacity="${Math.max(0.02, Math.min(1, sh.op))}" stroke-width="${f1(w)}" stroke-linecap="round" stroke-linejoin="round"${flt}/>`;
      } else if (sh.t === "img") {
        const src = (hrefs && hrefs[sh.href]) || sh.href || "", ft = inkFilter(id + "i", sh.ink, sh.stroke);
        defs += ft;
        const ftA = ft ? ` filter="url(#${id}i)"` : "", mxA = sh.mx ? ` transform="translate(${f1(2 * bx.cx)} 0) scale(-1 1)"` : "";
        one = `<image ${tag} href="${src}" x="${f1(bx.x)}" y="${f1(bx.y)}" width="${f1(bx.w)}" height="${f1(bx.h)}" preserveAspectRatio="none" opacity="${Math.max(0.05, Math.min(1, sh.iop))}"${ftA}${mxA}/>`;
      } else if (sh.t === "stamp") {                       // l'image posee le long du trace, tournee dans son sens
        const src = (hrefs && hrefs[sh.href]) || sh.href || "", ft = inkFilter(id + "i", sh.ink, sh.stroke), sz = Math.max(1, sh.ss) * 4, ar = sh.ar || 1;
        const P = sh.p.map(([x, y]) => [x * W, y * H]), step = Math.max(1.5, sz * Math.max(0.05, sh.gap)), pw = sh.pw || [];
        defs += ft + `<image id="${id}i0" href="${src}" width="${f1(sz)}" height="${f1(sz * ar)}" preserveAspectRatio="none"${ft ? ` filter="url(#${id}i)"` : ""}/>`;
        let acc = 0, uses = "";
        for (let k = 1; k < P.length; k++) {
          const a = P[k - 1], b = P[k], seg = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
          let t = k === 1 ? 0 : step - acc;
          for (; t <= seg; t += step) {
            const x = a[0] + (b[0] - a[0]) * t / (seg || 1), y = a[1] + (b[1] - a[1]) * t / (seg || 1), sc = Math.max(0.15, pw[k] ?? 1);
            uses += `<use href="#${id}i0" transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(ang)}) scale(${sc.toFixed(2)}) translate(${f1(-sz / 2)} ${f1(-sz * ar / 2)})"/>`;
          }
          acc = (acc + seg) % step;
        }
        one = `<g ${tag}>${uses}</g><path ${tag} d="${d}" fill="none" stroke="#000" stroke-opacity="0.001" stroke-width="${f1(sz)}"/>`;
      }
      if (sh.hand > 0 && sh.t !== "img") {
        const amp = sh.hand * 3, pad = amp + 40, seed = [...String(sh.id || i)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 997, 7);
        defs += `<filter id="${id}h" filterUnits="userSpaceOnUse" x="${f1(bx.x - pad)}" y="${f1(bx.y - pad)}" width="${f1(bx.w + 2 * pad)}" height="${f1(bx.h + 2 * pad)}" color-interpolation-filters="sRGB">` +
          `<feTurbulence type="fractalNoise" baseFrequency="${(0.06 / Math.max(0.5, sh.hw)).toFixed(4)}" numOctaves="2" seed="${seed}"/><feDisplacementMap in="SourceGraphic" scale="${f1(amp)}" xChannelSelector="R" yChannelSelector="G"/></filter>`;
        one = `<g filter="url(#${id}h)">${one}</g>`;
      }
      body += rot(one);
      return;
    }
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
  return `<defs>${defs}</defs>${body}`;
}

// une image chargee par un SVG lui-meme charge comme image ne va pas chercher ses images : on les met dedans (data:)
const inlined = new Map();
const inline = (href) => {
  if (!href || href.startsWith("data:")) return Promise.resolve(href);
  if (!inlined.has(href)) inlined.set(href, fetch(href).then((r) => r.blob()).then((b) => new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ok(href); fr.readAsDataURL(b); })).catch(() => href));
  return inlined.get(href);
};
/** Image (pour l'aplatissement) du fond dessine d'une case de wpx x hpx pixels. */
export async function drawImage(draw, wpx, hpx) {
  const all = ((draw && draw.layers) || []).flatMap((l) => l.shapes || []).concat((draw && draw.shapes) || []), hrefs = {};
  for (const s of all) if ((s.t === "img" || s.t === "stamp") && s.href && !hrefs[s.href]) hrefs[s.href] = await inline(s.href);
  const H = W * hpx / wpx, inner = drawSvg(draw, H, "f", { hrefs });
  if (!inner) return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(wpx)}" height="${Math.round(hpx)}" viewBox="0 0 ${W} ${f1(H)}">${inner}</svg>`;
  return new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
}

// ------------------------------------------------------------------------------------------------ l'atelier
/** Ouvre l'atelier de dessin pour une case. ratio = hauteur / largeur ; backdrop : url du decor a montrer dessous. */
//  Atelier d'elements (portrait-robot, corps) : layers = calques ; kit = pinceaux, gomme, import d'image, pinceau-tampon ;
//  extra = noeud ajoute sous la barre d'outils (reglages propres a l'appelant).
export function openDrawEditor({ draw, ratio, backdrop, title, onSave, ghosts = [], saveLabel = tt("Enregistrer le fond"), axis = false, under = null, layers: useLayers = false, kit = false, extra = null }) {
  const H = W * ratio;
  // calques : du dessous vers le dessus ; « shapes » est toujours le tableau du calque en cours
  let layers = useLayers ? JSON.parse(JSON.stringify(draw && Array.isArray(draw.layers) && draw.layers.length ? draw.layers
    : [{ id: uid(), name: tt("Calque 1"), shapes: (draw && draw.shapes) || [] }])) : null;
  let cl = layers ? layers.length - 1 : 0;
  let shapes = layers ? layers[cl].shapes : JSON.parse(JSON.stringify((draw && draw.shapes) || []));
  const allShapes = () => (layers ? layers.flatMap((l) => l.shapes) : shapes);
  let tool = "blob", prim = "rect", path = "blob", brushT = "brush", sel = null, drag = null, building = null, hover = null;
  let preK = "arbre";                                      // forme toute faite en cours (banque de formes, presets.js)
  let sym = false;                                         // symetrie : chaque forme tracee a son jumeau en miroir (tw), qui suit ses retouches
  let multi = [];                                          // formes choisies ensemble (rectangle de selection, Maj+clic)
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
    back.innerHTML = `<defs>${stagePattern(Math.max(8, W / 60))}</defs><rect x="${f1(x0)}" y="${f1(y0)}" width="${f1(ww)}" height="${f1(hh)}" fill="${big ? "#ebe8e0" : stageFill()}"/><rect width="${W}" height="${f1(H)}" fill="${stageFill()}"/>` +
      (backdrop ? `<image href="${backdrop}" width="${W}" height="${f1(H)}" preserveAspectRatio="xMidYMid slice" opacity="0.35"/>` : "") +
      // retouche d'une image : elle est posee a sa place dans le cadre, pleinement visible, et on dessine par-dessus
      (under ? `<image href="${under.url}" x="${f1(under.x * W)}" y="${f1(under.y * H)}" width="${f1(under.w * W)}" height="${f1(under.h * H)}" preserveAspectRatio="none"/>` : "");
    const k = ww / W;                                       // le cadre de la case reste lisible quand on dezoome
    guide.innerHTML = (big ? `<rect width="${W}" height="${f1(H)}" fill="none" stroke="#e2603a" stroke-width="${f1(2.5 * k)}" stroke-dasharray="${f1(12 * k)} ${f1(8 * k)}"/>` +
      tt`<text x="${f1(6 * k)}" y="${f1(-6 * k)}" font-size="${f1(15 * k)}" fill="#e2603a">la case</text>` : "") +
      // element en paire (yeux, oreilles…) : l'axe du milieu, pour dessiner un cote puis « Miroir » ; il n'est pas enregistre
      (axis || sym ? `<line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${f1(H)}" stroke="#2bb3a3" stroke-opacity="0.55" stroke-width="${f1(1.5 * k)}" stroke-dasharray="${f1(10 * k)} ${f1(8 * k)}"/>` : "");
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
    for (const sh of allShapes()) for (const [x, y] of sh.p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
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
  const chosen = () => { const t = target(), ids = new Set(multi); if (t) ids.add(t.id); return shapes.filter((s) => ids.has(s.id)); };
  const set = (k, v) => { for (const t of chosen()) { t[k] = v; syncTwin(t); } cur[k] = v; paint(); };
  // retourne une forme gauche-droite par rapport au milieu du cadre (sur place)
  const flipShape = (c) => {
    c.p = c.p.map(([x, y]) => [1 - x, y]);
    if (c.r) c.r = -c.r;
    if (PRIMS[c.t] || c.t === "img" || c.t === "pre") c.mx = !c.mx;                          // une primitive se dessine dans sa boite : on la retourne
    if (c.ga != null) c.ga = (540 - c.ga) % 360;
    if (c.ha != null) c.ha = (180 - c.ha + 180) % 180;
    if (c.ho != null) c.ho = -c.ho;
    return c;
  };
  // symetrie : le jumeau (tw) prend la place, la forme et les reglages de la forme, en miroir
  function syncTwin(t) {
    if (!t || !t.tw) return;
    const o = shapes.find((x) => x.id === t.tw);
    if (!o) { delete t.tw; return; }
    const c = flipShape(JSON.parse(JSON.stringify(t)));
    c.id = o.id; c.tw = t.id;
    for (const k of Object.keys(o)) delete o[k];
    Object.assign(o, c);
  }
  function addTwin(t) {                                    // mode symetrie : le jumeau d'une forme qui vient d'etre tracee
    if (!sym || !t || t.tw) return;
    const c = flipShape(JSON.parse(JSON.stringify(t)));
    c.id = uid(); c.tw = t.id; t.tw = c.id;
    shapes.splice(shapes.indexOf(t) + 1, 0, c);
  }
  function removeShapes(list) {                            // efface des formes, et leur jumeau en mode symetrie (sinon le lien est defait)
    const gone = new Set(list.map((s) => s.id));
    for (const s of list) if (s.tw) { if (sym) gone.add(s.tw); else { const o = shapes.find((x) => x.id === s.tw); if (o) delete o.tw; } }
    for (let i = shapes.length - 1; i >= 0; i--) if (gone.has(shapes[i].id)) shapes.splice(i, 1);
    sel = null; multi = [];
    paint(); props(); hist.snap();
  }
  function copyShapes() {
    const list = chosen();
    if (!list.length) return false;
    clip = JSON.parse(JSON.stringify(list));
    toast(list.length > 1 ? tt`${list.length} formes copiées.` : tt("Forme copiée."));
    return true;
  }
  function pasteShapes(src = clip) {                       // a cote de l'original ; les jumeaux colles ensemble restent lies
    if (!src || !src.length) return false;
    const ids = new Map(src.map((s) => [s.id, uid()]));
    const out = src.map((s) => { const c = JSON.parse(JSON.stringify(s)); c.id = ids.get(s.id); c.p = c.p.map(([x, y]) => [x + 0.03, y + 0.03]); if (c.tw) { if (ids.has(c.tw)) c.tw = ids.get(c.tw); else delete c.tw; } return c; });
    shapes.push(...out);
    multi = out.map((s) => s.id); sel = out[0].id; tool = "select";
    tools(); props(); paint(); hist.snap();
    return true;
  }
  function ctxMenu(e, items) {                             // menu du clic droit (meme allure que celui de la page)
    document.querySelector(".menu")?.remove();
    const box = h("div.menu");
    for (const it of items) box.append(h("button" + (it.danger ? ".danger" : ""), { on: { click: () => { box.remove(); it.click(); } } }, it.label));
    document.body.append(box);
    const r = box.getBoundingClientRect();
    box.style.left = Math.max(4, Math.min(e.clientX, innerWidth - r.width - 6)) + "px";
    box.style.top = Math.max(4, Math.min(e.clientY, innerHeight - r.height - 6)) + "px";
    const off = (ev) => { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener("pointerdown", off, true); } };
    setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
  }
  const rotPt = (p, c, deg) => { const a = deg * Math.PI / 180, x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a)]; };

  function paint() {
    art.innerHTML = drawSvg(layers ? { layers } : { shapes }, H, "e", { live: layers ? cl : null });
    let o = "";
    const t = target();
    if (t && t !== building) {
      const b = boxOf(t, H), top = b.y - 6;
      const corners = MANY.has(t.t) && !(t.t === "poly" || t.t === "polyline" || t.ed) ? "" : t.p.map((p, i) => `<circle cx="${f1(p[0] * W)}" cy="${f1(p[1] * H)}" r="9" class="draw-pt" data-pt="${i}"/>`).join("");
      // poignee de rotation : au-dessus de la forme, elle tourne avec elle
      o += `<g transform="rotate(${f1(t.r || 0)} ${f1(b.cx)} ${f1(b.cy)})"><rect x="${f1(b.x - 6)}" y="${f1(top)}" width="${f1(b.w + 12)}" height="${f1(b.h + 12)}" class="draw-sel"/>` +
        `<line x1="${f1(b.cx)}" y1="${f1(top)}" x2="${f1(b.cx)}" y2="${f1(top - 30)}" class="draw-sel"/>` +
        `<g class="draw-rot" data-rot="1" transform="translate(${f1(b.cx)} ${f1(top - 44)})"><circle r="15" data-rot="1"/><path d="M-7 -3A8 8 0 1 1 -5 6M-7 -3L-11 -8M-7 -3L-1 -4"/></g>${corners}` +
        // carre au coin bas droit : le glisser agrandit ou reduit toute la forme autour de son centre (Maj : en largeur seulement, Alt : en hauteur seulement)
        `<g class="draw-scale" data-scale="1" transform="translate(${f1(b.x + b.w + 20)} ${f1(b.y + b.h + 20)})"><rect x="-11" y="-11" width="22" height="22" rx="4" data-scale="1"/><path d="M-5 -5L5 5M5 5H0M5 5V0M-5 -5H0M-5 -5V0" data-scale="1"/></g></g>`;
    }
    for (const s of chosen()) {                            // les autres formes choisies ensemble
      if (t && s.id === t.id) continue;
      const b = boxOf(s, H);
      o += `<g transform="rotate(${f1(s.r || 0)} ${f1(b.cx)} ${f1(b.cy)})"><rect x="${f1(b.x - 6)}" y="${f1(b.y - 6)}" width="${f1(b.w + 12)}" height="${f1(b.h + 12)}" class="draw-sel"/></g>`;
    }
    if (drag && drag.kind === "band") {                    // rectangle de selection
      const x0 = Math.min(drag.a[0], drag.b[0]) * W, y0 = Math.min(drag.a[1], drag.b[1]) * H;
      o += `<rect x="${f1(x0)}" y="${f1(y0)}" width="${f1(Math.abs(drag.b[0] - drag.a[0]) * W)}" height="${f1(Math.abs(drag.b[1] - drag.a[1]) * H)}" class="draw-band"/>`;
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
    const copies = src.map((sh) => { const c = flipShape(JSON.parse(JSON.stringify(sh))); c.id = uid(); delete c.tw; return c; });
    shapes.push(...copies);
    sel = copies.length === 1 ? copies[0].id : null;
    paint(); props(); hist.snap();
  }
  // forme de la banque -> formes a points (une par contour plein ; les trous sont laisses) : poly pour les contours droits,
  // forme libre lissee (blob) pour les courbes. La rotation et le retournement sont appliques aux points.
  function editPoints(t) {
    const d = geom(t, H), bx = boxOf(t, H), a = (t.r || 0) * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
    const subs = [];
    for (const part of d.split(/(?=M)/)) {
      const tok = part.match(/[MLCQZ]|-?\d+(?:\.\d+)?/g) || [];
      const pts = [];
      let curve = false, cmd = "", nums = [];
      const flush = () => { if (cmd === "M" || cmd === "L") for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]); else if (cmd === "C" || cmd === "Q") { const n = cmd === "C" ? 6 : 4; for (let i = 0; i + n - 1 < nums.length; i += n) pts.push([nums[i + n - 2], nums[i + n - 1]]); curve = true; } nums = []; };
      for (const x of tok) { if (/[MLCQZ]/.test(x)) { flush(); cmd = x; } else nums.push(+x); }
      flush();
      if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.5) pts.pop();
      if (pts.length < 3) continue;
      let ar = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; ar += p[0] * q[1] - q[0] * p[1]; }
      subs.push({ pts, curve, ar: ar / 2 });
    }
    if (!subs.length) return toast(tt("Cette forme ne se transforme pas en points."), "error");
    const sign = Math.sign(subs.reduce((m, s) => (Math.abs(s.ar) > Math.abs(m.ar) ? s : m)).ar);
    const keep = subs.filter((s) => Math.sign(s.ar) === sign);            // les contours pleins ; les trous partent
    const base = JSON.parse(JSON.stringify(t));
    for (const k of ["id", "t", "k", "p", "mx", "r"]) delete base[k];
    const made = keep.map((s) => Object.assign({}, JSON.parse(JSON.stringify(base)), { id: uid(), t: s.curve ? "blob" : "poly", ed: 1,
      p: s.pts.map(([x, y]) => { const dx = x - bx.cx, dy = y - bx.cy; return [+((bx.cx + dx * cs - dy * sn) / W).toFixed(4), +((bx.cy + dx * sn + dy * cs) / H).toFixed(4)]; }) }));
    const i = shapes.indexOf(t);
    shapes.splice(i, 1, ...made);
    tool = "select"; sel = made[0].id;
    tools(); props(); paint(); hist.snap();
    toast(made.length > 1 ? tt`Forme en ${made.length} morceaux : tire les ronds pour déplacer les points.` : tt("Tire les ronds pour déplacer les points."));
  }
  function finish(keep) {                                  // termine la forme point par point
    const b = building; building = null; hover = null;
    if (!b) return;
    if (!keep || b.p.length < (b.t === "poly" ? 3 : 2)) { shapes.splice(shapes.indexOf(b), 1); sel = null; }
    else { sel = b.id; addTwin(b); }
    props(); paint();
  }
  function props() {
    side.textContent = "";
    const t = target(), kind = t ? t.t : tool, open = OPEN.has(kind);
    const range = (label, k, min, max, step) => { const out = h("output", String(val(k) ?? 0));
      return h("label.row.range", label, h("input", { type: "range", min, max, step, value: val(k) ?? 0, on: { input: (e) => { set(k, +e.target.value); out.textContent = e.target.value; } } }), out); };
    const pick = (label, k, opts) => h("label.row", label, h("select", { on: { change: (e) => { set(k, e.target.value); props(); } } }, Object.entries(opts).map(([v, n]) => h("option", { value: v, selected: val(k) === v }, n))));
    side.append(h("h4", t ? tt("Forme choisie") : tt("Prochaine forme")));
    if (SPECIAL.has(kind)) specialProps(kind, range, pick);
    else {                                                 // contour : une coche (avec ou sans) et sa couleur, au nuancier
      const on = val("stroke") !== "none", col = /^#[0-9a-f]{6}$/i.test(val("stroke") || "") ? val("stroke") : (val("sk") || "#111111");
      side.append(h("div.row.fillrow",
        h("label.row.check", { title: tt("Décoché : la forme n'a pas de contour") }, h("input", { type: "checkbox", checked: on, on: { change: (e) => { if (!e.target.checked) set("sk", col); set("stroke", e.target.checked ? col : "none"); props(); hist.snap(); } } }), tt("Contour")),
        on ? swatch(col, (c) => { set("stroke", c); set("sk", c); }, () => hist.snap()) : ""));
    }
    if (!SPECIAL.has(kind) && val("stroke") !== "none") side.append(range(tt("Épaisseur"), "sw", 0.2, 12, 0.1));
    if (kind !== "img" && kind !== "erase") side.append(h("h4", tt("Trait à la main")), range(tt("Tremblé"), "hand", 0, 10, 0.1), range(tt("Ondulation"), "hw", 0.5, 12, 0.1),
      h("p.muted", tt("Tremblé à 0 : trait net. Ondulation courte = trait nerveux, longue = lignes qui flottent.")));
    if (!open && kind !== "img") {
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
        t.t === "pre" ? h("button.mini", { title: tt("Transforme la forme en points à tirer un par un (outil Sélection, ronds sur la forme)"), on: { click: () => editPoints(t) } }, tt("✎ Éditer les points")) : "",
        h("h4", tt("Ordre")), h("div.row.wrap",
        h("button.mini", { on: { click: () => { const i = shapes.indexOf(t); if (i < shapes.length - 1) { shapes.splice(i, 1); shapes.splice(i + 1, 0, t); paint(); } } } }, tt("Avancer")),
        h("button.mini", { on: { click: () => { const i = shapes.indexOf(t); if (i > 0) { shapes.splice(i, 1); shapes.splice(i - 1, 0, t); paint(); } } } }, tt("Reculer")),
        h("button.mini", { on: { click: () => { const c = JSON.parse(JSON.stringify(t)); c.id = uid(); c.p = c.p.map((p) => [p[0] + 0.03, p[1] + 0.03]); shapes.push(c); sel = c.id; paint(); props(); } } }, tt("Dupliquer")),
        h("button.mini.danger", { on: { click: () => { shapes.splice(shapes.indexOf(t), 1); sel = null; paint(); props(); } } }, tt("Supprimer"))));
    }
    const tip = tool === "poly" || tool === "polyline" ? tt("Clique pour poser chaque point. Double-clic, Entrée ou clic sur le premier point : la forme se termine") + (tool === "poly" ? tt(" et se ferme toute seule.") : ".") + tt(" Échap annule.")
      : (MANY.has(tool) && tool !== "poly" && tool !== "polyline" ? tt("Main levée : Ctrl enfoncé trace une droite depuis le dernier point ; Ctrl relâché, on repart à main levée. ") : "") + tt("Choisis un outil puis glisse dans le cadre. « Sélection » : clic sur une forme pour la régler, glisser pour la déplacer, carré ⤡ du coin pour l'agrandir, points ronds pour l'étirer, poignée ↻ pour la tourner (Maj : par crans de 15°). Suppr efface.");
    side.append(h("p.muted", BRUSHES[tool] ? brushTip(tool) + " " + tip : tip));
    if (layers) { side.append(layBox); layUi(); }
  }
  // reglages des pinceaux et de l'image importee
  function specialProps(kind, range, pick) {
    const col = (label, k, def, title) => h("span.row.colrow", { title: title || "" }, label, swatch(val(k) || def, (c) => set(k, c), () => hist.snap()));
    const inkPick = () => pick(tt("Blanc du papier"), "ink", { none: tt("Gardé (image telle quelle)"), clair: tt("Transparent (le trait reste)"), encre: tt("Transparent, trait recoloré") });
    if (kind === "brush") side.append(col(tt("Couleur"), "stroke", "#111111"), range(tt("Épaisseur"), "bsw", 0.3, 30, 0.1),
      range(tt("Pointes"), "tp", 0, 0.5, 0.01), range(tt("Sensibilité à la vitesse"), "sv", 0, 1, 0.01));
    if (kind === "paint") side.append(col(tt("Couleur"), "pc", "#7d8c99"), range(tt("Largeur"), "bw", 1, 80, 0.5), range(tt("Opacité"), "op", 0.03, 1, 0.01),
      range(tt("Lavis"), "soft", 0, 1, 0.01));
    if (kind === "erase") side.append(range(tt("Largeur"), "bw", 1, 80, 0.5));
    if (kind === "hair") side.append(col(tt("Couleur"), "stroke", "#111111"), range(tt("Densité"), "hd", 0.5, 60, 0.5), range(tt("Étalement"), "hs", 0, 40, 0.5),
      range(tt("Longueur (0 = points)"), "hl", 0, 30, 0.5), range(tt("Épaisseur"), "hz", 0.2, 6, 0.1), range(tt("Direction (°)"), "ho", -90, 90, 1), range(tt("Désordre (°)"), "hj", 0, 90, 1));
    if (BRUSH_SAVE[kind]) {                                // pinceaux enregistres : les reglages d'un pinceau, gardes sous un nom
      const mine = savedBrushes().filter((b) => b.t === kind);
      const pickB = h("select", { on: { change: (e) => { const b = e.target.value === "" ? null : mine[+e.target.value]; if (!b) return; for (const [k, v] of Object.entries(b.v)) set(k, v); if (b.v.href) { cur.href = b.v.href; cur.ar = b.v.ar || 1; } props(); } } },
        h("option", { value: "" }, mine.length ? tt("Mes pinceaux…") : tt("Aucun pinceau enregistré")), mine.map((b, i) => h("option", { value: i }, b.n)));
      side.append(h("div.row.wrap", { title: tt("Enregistre les réglages de ce pinceau sous un nom, pour les reprendre d'un clic (gardés dans ce navigateur)") }, pickB,
        h("button.mini", { type: "button", on: { click: () => { const n = (prompt(tt("Nom du pinceau :")) || "").trim(); if (!n) return;
          const v = Object.fromEntries(BRUSH_SAVE[kind].map((k) => [k, val(k) ?? cur[k]]).filter(([, x]) => x !== undefined));
          storeBrushes([...savedBrushes().filter((b) => !(b.t === kind && b.n === n)), { n, t: kind, v }]); toast(tt("Pinceau enregistré.")); props(); } } }, tt("＋ Enregistrer ce pinceau")),
        mine.length ? h("button.mini", { type: "button", title: tt("Retirer le pinceau choisi dans la liste"), on: { click: () => { const b = pickB.value === "" ? null : mine[+pickB.value]; if (!b) return toast(tt("Choisis d'abord un pinceau dans la liste.")); storeBrushes(savedBrushes().filter((x) => x !== b && !(x.t === b.t && x.n === b.n))); props(); } } }, "✕") : ""));
    }
    if (kind === "img" || kind === "stamp") {
      side.append(inkPick());
      if (val("ink") === "encre") side.append(col(tt("Couleur du trait"), "stroke", "#111111"));
    }
    if (kind === "img") {
      const t = target();
      side.append(range(tt("Opacité"), "iop", 0.05, 1, 0.01));
      if (t) side.append(h("button.mini", { type: "button", title: tt("Cette image devient la pointe du pinceau-tampon"), on: { click: () => { cur.href = t.href; cur.ar = t.ar || 1; brushT = "stamp"; tool = "stamp"; sel = null; toast(tt("Image prise comme pointe du pinceau-tampon.")); tools(); props(); paint(); } } }, tt("✺ Pointe du tampon")));
    }
    if (kind === "stamp") {
      const src = val("href");
      side.append(range(tt("Taille"), "ss", 1, 60, 0.5), range(tt("Écart"), "gap", 0.05, 2, 0.01),
        h("div.row.wrap", src ? h("img.draw-tip", { src, alt: "" }) : h("span.muted", tt("aucune pointe")),
          h("button.mini", { type: "button", on: { click: () => importImg(true) } }, tt("🖼 Choisir la pointe…"))));
    }
  }
  function brushTip(k) {
    return { brush: tt("Pinceau en pointe : le trait s'affine au début et à la fin ; avec un stylet, il suit la pression, à la souris la vitesse (vite = fin)."),
      paint: tt("Pinceau de fond : pour poser des aplats ou un lavis, sur un calque du dessous, puis repasser le trait sur un calque au-dessus."),
      erase: tt("Gomme : efface ce qui est déjà dessiné dans le calque en cours, pas dans les autres."),
      stamp: tt("Pinceau-tampon : l'image de la pointe est posée tout le long du tracé (un trait de crayon scanné, une texture)."),
      hair: tt("Poils / pointillé : des poils ou des points semés le long du tracé, pour une barbe, des cheveux, un grain. Longueur 0 : des points.") }[k] || "";
  }
  // ---- calques : du dessus (en haut de la liste) vers le dessous ; on dessine dans le calque en cours
  const layBox = h("div.draw-layers");
  const setLayer = (i) => { finish(true); cl = Math.max(0, Math.min(layers.length - 1, i)); shapes = layers[cl].shapes; sel = null; props(); paint(); };
  function layUi() {
    layBox.textContent = "";
    const rows = layers.map((l, i) => [l, i]).reverse();
    layBox.append(h("h4", tt("Calques")), ...rows.map(([l, i]) => h("div.draw-layer" + (i === cl ? ".on" : "") + (l.hidden ? ".off" : ""), { title: tt("Cliquer : dessiner dans ce calque. Double-clic sur le nom : le renommer."), on: { click: () => setLayer(i) } },
      h("button.mini.eye", { type: "button", title: l.hidden ? tt("Montrer ce calque") : tt("Masquer ce calque (il ne part pas dans l'élément)"), on: { click: (e) => { e.stopPropagation(); l.hidden = !l.hidden; if (l.hidden && i === cl) sel = null; paint(); layUi(); hist.snap(); } } }, l.hidden ? "◌" : "👁"),
      h("span.lname", { on: { dblclick: (e) => { e.stopPropagation(); const n = (prompt(tt("Nom du calque :"), l.name) || "").trim(); if (n) { l.name = n; layUi(); hist.snap(); } } } }, l.name),
      h("small.muted", String(l.shapes.length)),
      h("input", { type: "range", min: 0.05, max: 1, step: 0.05, value: l.op == null ? 1 : l.op, title: tt("Opacité du calque"), on: { click: (e) => e.stopPropagation(), input: (e) => { l.op = +e.target.value; paint(); } } }),
      h("button.mini", { type: "button", title: tt("Monter (passer devant)"), disabled: i === layers.length - 1, on: { click: (e) => { e.stopPropagation(); moveLayer(i, 1); } } }, "▲"),
      h("button.mini", { type: "button", title: tt("Descendre (passer derrière)"), disabled: i === 0, on: { click: (e) => { e.stopPropagation(); moveLayer(i, -1); } } }, "▼"),
      h("button.mini.danger", { type: "button", title: tt("Supprimer ce calque"), disabled: layers.length < 2, on: { click: (e) => { e.stopPropagation(); if (l.shapes.length && !confirm(tt`Supprimer le calque « ${l.name} » et ce qu'il contient ?`)) return; layers.splice(i, 1); hist.snap(); setLayer(Math.min(cl, layers.length - 1)); } } }, "✕"))),
      h("div.row.wrap", h("button.mini", { type: "button", title: tt("Nouveau calque au-dessus du calque en cours"), on: { click: () => { layers.splice(cl + 1, 0, { id: uid(), name: tt`Calque ${layers.length + 1}`, shapes: [] }); hist.snap(); setLayer(cl + 1); } } }, tt("＋ Calque")),
        h("button.mini", { type: "button", title: tt("Copie du calque en cours, juste au-dessus"), on: { click: () => { const c = JSON.parse(JSON.stringify(layers[cl])); c.id = uid(); c.name += tt(" (copie)"); c.shapes.forEach((x) => { x.id = uid(); }); layers.splice(cl + 1, 0, c); hist.snap(); setLayer(cl + 1); } } }, tt("Dupliquer")),
        cl > 0 ? h("button.mini", { type: "button", title: tt("Verse le calque en cours dans celui du dessous"), on: { click: () => { const up = layers[cl], dn = layers[cl - 1]; dn.shapes.push(...up.shapes); layers.splice(cl, 1); hist.snap(); setLayer(cl - 1); } } }, tt("Fusionner vers le bas")) : ""));
  }
  const moveLayer = (i, d) => { const j = i + d; if (j < 0 || j >= layers.length) return; const [l] = layers.splice(i, 1); layers.splice(j, 0, l); if (cl === i) cl = j; else if (cl === j) cl = i; shapes = layers[cl].shapes; paint(); layUi(); hist.snap(); };
  // ---- image importee (crayon scanne, forme a reprendre) : envoyee au serveur, posee au milieu ; ou pointe du tampon
  const fileIn = h("input", { type: "file", accept: "image/*", style: { display: "none" } });
  let asTip = false;
  const importImg = (tip) => { asTip = !!tip; fileIn.click(); };
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files[0]; fileIn.value = "";
    if (!f) return;
    let r;
    try { r = await upload("parts/assets", f); } catch (e) { return toast(tt("Image refusée : ") + e.message, "error"); }
    const ar = r.h / Math.max(1, r.w);
    if (asTip) { cur.href = r.url; cur.ar = ar; brushT = "stamp"; tool = "stamp"; sel = null; tools(); props(); return; }
    finish(true); hist.snap();
    const bw = Math.min(0.6 * W, 0.6 * H / ar), bh = bw * ar, cx = W / 2, cy = H / 2;
    const sh = { id: uid(), t: "img", href: r.url, ar, ink: "clair", iop: 1, stroke: "#111111", p: [[(cx - bw / 2) / W, (cy - bh / 2) / H], [(cx + bw / 2) / W, (cy + bh / 2) / H]] };
    if (layers && layers[cl].hidden) layers[cl].hidden = false;
    shapes.push(sh); tool = "select"; sel = sh.id; tools(); props(); paint(); hist.snap();
  });
  // banque de formes : une palette par familles ; un clic choisit la forme (et remplace celle de la forme selectionnee)
  function presetDrop() {
    const wrap = h("div.draw-drop" + (tool === "pre" ? ".on" : ""));
    const pick = (k) => {
      preK = k; wrap.classList.remove("open");
      const s0 = tool === "select" && sel ? shapes.find((x) => x.id === sel) : null;
      if (s0 && s0.t === "pre") { s0.k = k; paint(); props(); hist.snap(); tools(); return; }
      finish(false); tool = "pre"; sel = null; tools(); props(); paint();
    };
    const menu = h("div.draw-menu.draw-presets", Object.entries(PRESET_CATS).map(([c, name]) => {
      const ks = Object.keys(PRESETS).filter((k) => PRESETS[k].c === c);
      return h("div.pcat", h("div.phead", name), h("div.pgrid", ks.map((k) => {
        const b = h("button" + (k === preK ? ".on" : ""), { type: "button", title: PRESETS[k].n, on: { click: (e) => { e.stopPropagation(); pick(k); } } });
        b.innerHTML = presetThumb(k, 34);
        return b;
      })));
    }));
    const cur0 = PRESETS[preK];
    const ico = h("span.pico"); ico.innerHTML = presetThumb(preK, 16);
    wrap.append(h("button.mini.main", { type: "button", title: tt("Banque de formes : ") + cur0.n + tt(". Glisser dans le cadre pour la poser (Maj : sans garder ses proportions). Aplat ou trait : réglages de la forme, à droite."), on: { click: () => { finish(false); tool = "pre"; sel = null; tools(); props(); paint(); } } }, ico, " ", cur0.n),
      h("button.mini.caret", { type: "button", title: tt("Choisir une forme dans la banque (une centaine : objets, nature, ville, véhicules, êtres, signes, formes abstraites)"), on: { click: (e) => { e.stopPropagation(); const was = wrap.classList.contains("open"); bar.querySelectorAll(".draw-drop.open").forEach((x) => x.classList.remove("open")); wrap.classList.toggle("open", !was); } } }, tt("Formes ▾")), menu);
    return wrap;
  }
  function tools() {
    bar.textContent = "";
    const pickTool = (k) => { finish(false); tool = k; if (PRIMS[k]) prim = k; if (PATHS[k]) path = k; if (BRUSHES[k]) brushT = k; if (k !== "select") sel = null; tools(); props(); paint(); };
    const drop = (label, list, current) => {              // bouton en deux moities : l'outil en cours, et la liste
      const [name, ico] = list[current];
      const wrap = h("div.draw-drop" + (tool === current ? ".on" : ""));
      const menu = h("div.draw-menu", Object.entries(list).map(([k, [n, i]]) => h("button" + (k === current ? ".on" : ""), { type: "button", on: { click: (e) => { e.stopPropagation(); wrap.classList.remove("open"); pickTool(k); } } }, h("span.ico", i), n)));
      wrap.append(h("button.mini.main", { type: "button", title: `${label} : ${name}`, on: { click: () => pickTool(current) } }, `${ico} ${name}`),
        h("button.mini.caret", { type: "button", title: tt("Choisir parmi les ") + label.toLowerCase(), on: { click: (e) => { e.stopPropagation(); const was = wrap.classList.contains("open"); bar.querySelectorAll(".draw-drop.open").forEach((x) => x.classList.remove("open")); wrap.classList.toggle("open", !was); } } }, label + " ▾"), menu);
      return wrap;
    };
    bar.append(h("button.mini" + (tool === "select" ? ".on" : ""), { type: "button", title: tt("Choisir, déplacer, étirer, tourner"), on: { click: () => pickTool("select") } }, tt("↖ Sélection")),
      drop(tt("Primitives"), PRIMS, prim), presetDrop(), drop(tt("Tracés"), PATHS, path), kit ? drop(tt("Pinceaux"), BRUSHES, brushT) : "",
      kit ? h("button.mini", { type: "button", title: tt("Importer une image (crayon scanné, forme, texture) : elle se pose au milieu, à déplacer et étirer avec la Sélection ; le blanc du papier devient transparent"), on: { click: () => importImg(false) } }, tt("🖼 Importer une image…")) : "", kit ? fileIn : "",
      h("button.mini", { type: "button", title: tt("Ajoute une copie en miroir gauche-droite (par rapport au milieu du cadre) de tout le dessin, ou seulement de la forme choisie avec l'outil Sélection : un œil dessiné à gauche donne son jumeau à droite"), on: { click: mirror } }, tt("⇋ Miroir")),
      h("button.mini" + (sym ? ".on" : ""), { type: "button", title: tt("Symétrie : chaque forme tracée a son jumeau en miroir de l'autre côté de l'axe. Déplacer, tourner, agrandir ou régler l'une fait suivre l'autre, en miroir (yeux, oreilles, visage)."),
        on: { click: () => { sym = !sym; zone(); tools(); paint(); toast(sym ? tt("Symétrie : ce que tu traces a son jumeau en face.") : tt("Symétrie coupée : les jumeaux déjà faits restent liés.")); } } }, sym ? tt("✓ Symétrie") : tt("⫼ Symétrie")),
      layers ? h("button.mini.danger", { type: "button", title: tt("Retirer toutes les formes du calque en cours"), on: { click: () => { if (shapes.length && confirm(tt("Effacer tout ce calque ?"))) { building = null; shapes.length = 0; sel = null; paint(); props(); hist.snap(); } } } }, tt("Effacer le calque"))
        : h("button.mini.danger", { type: "button", title: tt("Retirer toutes les formes"), on: { click: () => { if (shapes.length && confirm(tt("Effacer tout le dessin de ce fond ?"))) { building = null; shapes.length = 0; sel = null; paint(); props(); } } } }, tt("Tout effacer")));
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
      if (!id) { sel = null; multi = []; drag = { kind: "band", a: p, b: p }; props(); paint(); return; }   // dans le vide : rectangle de selection
      if (e.shiftKey) multi = multi.includes(id) ? multi.filter((x) => x !== id) : [...new Set([...multi, sel, id].filter(Boolean))];
      else if (!multi.includes(id)) multi = [id];
      sel = id; props(); paint();
      const many = chosen(), ids = new Set(many.map((s) => s.id));
      drag = { kind: "move", start: p, pts: target().p.map((q) => q.slice()), many: many.filter((s) => s.id !== id).map((s) => ({ s, pts: s.p.map((q) => q.slice()), solo: !(s.tw && ids.has(s.tw)) })),
               solo: !(target().tw && ids.has(target().tw)) };
      return;
    }
    if (tool === "stamp" && !cur.href) { toast(tt("Choisis d'abord l'image de la pointe du tampon (importer, ou « Pointe du tampon » sur une image importée)."), "error"); return; }
    if (layers && layers[cl].hidden) { layers[cl].hidden = false; layUi(); }
    const sh = Object.assign({ id: uid(), t: tool, p: [p, p] }, JSON.parse(JSON.stringify(cur)));
    if (tool === "pre") sh.k = preK;
    if (sh.t !== "stamp") { delete sh.href; delete sh.ar; }
    if (!SPECIAL.has(sh.t)) for (const k of BRUSH_KEYS) delete sh[k];   // une forme ordinaire (fond de case) ne garde pas les reglages des pinceaux
    if (sh.t === "brush" || sh.t === "stamp") sh.pw = [force(e, 0, cur.sv), force(e, 0, cur.sv)];
    shapes.push(sh); sel = sh.id; drag = { kind: "new", sh, keep: [], a: null, lt: e.timeStamp, lp: p, f: sh.pw ? sh.pw[0] : 1 };   // keep : coins des droites (Ctrl), gardes a l'allegement
    paint();
  });
  svg.addEventListener("pointermove", (e) => {
    const p = at(e);
    if (fxAim) { if (fxDrag) { fx.cx = +p[0].toFixed(3); fx.cy = +p[1].toFixed(3); fxPaint(); } return; }
    if (building) { hover = p; return paint(); }
    if (!drag) return;
    if (drag.kind === "band") { drag.b = p; return paint(); }
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
          const l = t.p[t.p.length - 1], dd = Math.hypot((p[0] - l[0]) * W, (p[1] - l[1]) * H);
          if (dd > (t.pw ? 3 : 5)) {
            t.p.push(p);
            if (t.pw) {                                    // force du point : pression du stylet, sinon vitesse (vite = fin), lissee
              const v = dd / Math.max(1, e.timeStamp - drag.lt);
              drag.f = drag.f * 0.6 + force(e, v, t.sv) * 0.4; drag.lt = e.timeStamp;
              t.pw.length = t.p.length - 1; t.pw.push(+drag.f.toFixed(2));
            }
          }
        }
      }
      else if (t.t === "pre" && !e.shiftKey && PRESETS[t.k]) {      // forme toute faite : ses proportions (Maj : libres)
        const [, , bw, bh] = PRESETS[t.k].box, a = t.p[0], dx = (p[0] - a[0]) * W, dy = (p[1] - a[1]) * H, ar = bw / bh;
        const s = Math.max(Math.abs(dx), Math.abs(dy) * ar);
        t.p[1] = [a[0] + Math.sign(dx || 1) * s / W, a[1] + Math.sign(dy || 1) * s / ar / H];
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
    else {
      const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
      t.p = drag.pts.map((q) => [q[0] + dx, q[1] + dy]);
      for (const m of drag.many || []) { m.s.p = m.pts.map((q) => [q[0] + dx, q[1] + dy]); if (m.solo) syncTwin(m.s); }
      if (drag.solo === false) { paint(); return; }
    }
    if (drag.kind !== "new") syncTwin(t);                  // symetrie : le jumeau suit en miroir
    paint();
  });
  svg.addEventListener("pointerup", () => {
    fxDrag = false;
    const d = drag; drag = null;
    if (d && d.kind === "band") {                          // les formes touchees par le rectangle
      const x0 = Math.min(d.a[0], d.b[0]) * W, x1 = Math.max(d.a[0], d.b[0]) * W, y0 = Math.min(d.a[1], d.b[1]) * H, y1 = Math.max(d.a[1], d.b[1]) * H;
      if (x1 - x0 > 3 || y1 - y0 > 3) multi = shapes.filter((s) => { const b = boxOf(s, H); return b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0; }).map((s) => s.id);
      sel = multi[0] || null; props(); paint(); return;
    }
    if (d && d.kind !== "new" && layers) { hist.snap(); return; }
    if (!d || d.kind !== "new") return;
    const t = d.sh, a = t.p[0], b = t.p[t.p.length - 1];
    if (t.p.length <= 2 && Math.hypot((b[0] - a[0]) * W, (b[1] - a[1]) * H) < 6) { shapes.splice(shapes.indexOf(t), 1); sel = null; }   // simple clic : rien
    else if (t.p.length > (t.pw ? 160 : SPECIAL.has(t.t) ? 90 : 40)) {   // allege la main levee, sans toucher aux coins des droites
      const N = t.pw ? 160 : SPECIAL.has(t.t) ? 90 : 40;
      if (d.a != null) d.keep.push(d.a, d.a + 1);
      const ix = new Set([...d.keep.filter((i) => i < t.p.length), ...Array.from({ length: N }, (_, i) => Math.round(i * (t.p.length - 1) / (N - 1)))]);
      const keep = [...ix].sort((x, y) => x - y);
      if (t.pw) t.pw = keep.map((i) => t.pw[i] ?? 1);
      t.p = keep.map((i) => t.p[i]);
    }
    if (shapes.includes(t)) addTwin(t);                    // mode symetrie : son jumeau en miroir
    props(); paint();
    if (layers) hist.snap();                               // atelier d'elements : chaque trait est une etape d'annulation
  });
  svg.addEventListener("dblclick", (e) => { if (building) { e.preventDefault(); finish(true); } });
  svg.addEventListener("contextmenu", (e) => {             // clic droit : dupliquer, copier, coller, ordre, supprimer
    e.preventDefault();
    if (building) return;
    const id = e.target.dataset.shape || (e.target.closest("[data-shape]") || {}).dataset?.shape;
    if (id && !chosen().some((s) => s.id === id)) { multi = [id]; sel = id; }
    if (id && tool !== "select") { tool = "select"; tools(); }
    props(); paint();
    const n = chosen().length, items = [];
    if (n) items.push({ label: n > 1 ? tt`Dupliquer les ${n} formes (Ctrl+D)` : tt("Dupliquer la forme (Ctrl+D)"), click: () => pasteShapes(JSON.parse(JSON.stringify(chosen()))) },
      { label: tt("Copier (Ctrl+C)"), click: copyShapes });
    if (clip) items.push({ label: tt`Coller (Ctrl+V) · ${clip.length}`, click: () => pasteShapes() });
    if (n) items.push({ label: tt("Miroir gauche-droite"), click: () => mirror() },
      { label: tt("Au premier plan"), click: () => { const l = chosen(); for (const s of l) { shapes.splice(shapes.indexOf(s), 1); shapes.push(s); } paint(); hist.snap(); } },
      { label: tt("À l'arrière-plan"), click: () => { const l = chosen().reverse(); for (const s of l) { shapes.splice(shapes.indexOf(s), 1); shapes.unshift(s); } paint(); hist.snap(); } },
      { label: n > 1 ? tt`Supprimer les ${n} formes` : tt("Supprimer"), danger: true, click: () => removeShapes(chosen()) });
    if (items.length) ctxMenu(e, items);
  });
  // Ctrl+Z / Ctrl+Y : les 5 dernieres actions
  const live = (x) => x !== building && !(drag && drag.kind === "new" && drag.sh === x);   // pas de forme a moitie tracee dans l'historique
  const hist = history(() => (layers ? { layers: layers.map((l) => Object.assign({}, l, { shapes: l.shapes.filter(live) })), cl } : shapes.filter(live)),
    (st) => { building = null; hover = null; drag = null;
      if (layers) { layers = st.layers; cl = Math.max(0, Math.min(layers.length - 1, st.cl)); shapes = layers[cl].shapes; }
      else shapes.splice(0, shapes.length, ...st);
      if (!target()) sel = null; props(); paint(); });
  const key = (e) => {
    if (hist.keydown(e)) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (building && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); return finish(true); }
    if (building && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return finish(false); }
    if ((e.key === "Delete" || e.key === "Backspace") && chosen().length) { e.preventDefault(); e.stopPropagation(); removeShapes(chosen()); return; }
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "c" && chosen().length) { e.preventDefault(); e.stopPropagation(); copyShapes(); return; }
    if ((e.ctrlKey || e.metaKey) && k === "v" && clip) { e.preventDefault(); e.stopPropagation(); pasteShapes(); return; }
    if ((e.ctrlKey || e.metaKey) && k === "d" && chosen().length) { e.preventDefault(); e.stopPropagation(); pasteShapes(JSON.parse(JSON.stringify(chosen()))); return; }
    if ((e.ctrlKey || e.metaKey) && k === "a" && tool === "select") { e.preventDefault(); e.stopPropagation(); multi = shapes.map((s) => s.id); sel = multi[0] || null; props(); paint(); }
  };
  document.addEventListener("keydown", key, true);
  const away = () => bar.querySelectorAll(".draw-drop.open").forEach((x) => x.classList.remove("open"));
  document.addEventListener("click", away);
  const done = () => { document.removeEventListener("keydown", key, true); document.removeEventListener("click", away); };
  tools(); props(); paint();
  // un element (kit) n'a ni zone agrandie ni lignes d'effet : son cadre est celui de l'atelier
  const m = modal(title || tt("Dessiner le fond"), h("div.draw-editor", h("div.draw-main", bar, h("div.row.wrap", extra || "", stageBgControl(() => zone())), ghostBar, kit ? "" : extBar, h("div.draw-frame", svg), kit ? "" : fxBox), side),
    [{ label: tt("Annuler"), click: done },
     { label: saveLabel, primary: true, click: () => { finish(true); done();
       const out = layers ? { shapes: layers.filter((l) => !l.hidden).flatMap((l) => l.shapes), layers } : { shapes };
       onSave(Object.assign(out, ext.l + ext.r + ext.t + ext.b > 0 ? { ext } : null, fx.on ? { fx } : null)); if (saveLabel === tt("Enregistrer le fond")) toast(tt("Fond dessiné enregistré.")); } }]);   // ailleurs, l'appelant dit lui-meme ce qui est fait

  m.box.classList.add("modal-wide");
  hist.watch(m.box);
  return m;
}
