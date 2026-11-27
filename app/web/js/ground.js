// Carte de sol d'une case : un motif (damier, grille, points, lignes, lavis ou uni) pose sur le sol et vu en perspective
// dans l'image, jusqu'a la ligne d'horizon. panel.ground = { on, pat, hz (horizon, fraction de la hauteur de la case),
// sc (taille des carreaux), col (couleur), a (opacite), m (place du motif sur le sol, voir groundMap) }. Le meme trace dans
// la case, au montage (image, isometrique, 3D) et dans l'image aplatie.
// Plaque de sol (« Make Ground ») : gr.ext = [u0, u1, v0, v1], ses bords sur le sol (u : de cote, v : devant la camera, les
// deux divises par la hauteur de la camera, comme groundMap) ; sans ext le sol va jusqu'a l'horizon. gr.fill : couleur de
// la plaque (pleine, sous le motif ; "none" : seulement le motif). gr.pm : repere de la plaque sur le sol (plateMap).
import { tt } from "./i18n.js";

export const PATS = { damier: tt("Damier"), grille: tt("Grille"), points: tt("Points"), lignes: tt("Lignes (bandes)"), lavis: tt("Lavis (aquarelle)"), uni: tt("Uni") };
export const GROUND0 = { on: true, pat: "damier", sc: 0.5, col: "#000000", a: 0.22 };
const patOf = (gr) => (gr.pat === "taches" ? "lavis" : gr.pat || "damier");   // les anciennes « taches » deviennent du lavis

/** Horizon estime d'apres les personnages : camera a hauteur d'homme, l'horizon passe a hauteur de leurs yeux (pied moins
 *  90 % de la hauteur), mediane des elements ; jamais sous le pied le plus haut. Sans element : 0,45. */
export function estimateHorizon(pan) {
  const ls = (pan.layers || []).filter((l) => typeof l.y === "number" && l.y > 0.05);
  if (!ls.length) return 0.45;
  const eyes = ls.map((l) => l.y - 0.9 * (l.s || 0.5)).sort((a, b) => a - b), mid = eyes[Math.floor(eyes.length / 2)];
  const hz = Math.min(mid, Math.min(...ls.map((l) => l.y)) - 0.03);
  return Math.round(Math.max(0.05, Math.min(0.85, hz)) * 1000) / 1000;
}

/** Place du motif sur le sol. Un point du sol vu de la camera de la case : u = ecart a droite, v = distance devant, les deux
 *  divises par la hauteur de la camera ; focale = largeur de la case (champ de 53°). Le motif y est (m0 u + m1 v + m4,
 *  m2 u + m3 v + m5). Sans gr.m (sol jamais recalcule) : le motif d'origine, carreaux alignes sur la case. ratio : h / w. */
export function groundMap(gr, ratio) {
  if (Array.isArray(gr.m) && gr.m.length === 6) return gr.m;
  return [1, 0, 0, (1 - (gr.hz ?? 0.45)) * ratio, 0, 0];
}
const inv2 = (m) => { const det = m[0] * m[3] - m[1] * m[2] || 1e-9; return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det]; };

const f1 = (n) => n.toFixed(1);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// ---------------------------------------------------------------------------------- lavis : bruit fractal
const hash = (i, j, s) => { let h = (i * 374761393 + j * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(i, j, s), b = hash(i + 1, j, s), c = hash(i, j + 1, s), d = hash(i + 1, j + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
/** Bruit fractal (somme d'octaves). fp : taille d'un pixel en unites du bruit ; les octaves plus fines que le pixel sont
 *  remplacees par leur moyenne (pas de fourmillement vers l'horizon). */
function fbm(x, y, s, oct, fp) {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < oct; o++) {
    const w = clamp(0.5 / (f * fp) - 1, 0, 1);
    v += amp * (w > 0 ? w * vnoise(x * f + o * 17.3, y * f - o * 9.1, s + o) + (1 - w) * 0.5 : 0.5);
    amp *= 0.5; f *= 2.03;
  }
  return v + amp;                                          // le reste des octaves, a sa moyenne : v reste autour de 0,5
}
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Opacite du lavis (0 a 1) au point (x, y) du motif, en unites de taille des taches. Deux couches qui se chevauchent,
 *  formes deformees par un second bruit (bords dechiquetes, a la Mandelbrot), bord plus fonce la ou l'eau a seche, grain
 *  du papier. gr.dn : couverture, gr.sf : douceur des bords, gr.seed : tirage. */
function lavisAt(x, y, fp, dn, w, seed) {
  const wx = fbm(x + 5.2, y + 1.3, seed + 11, 3, fp), wy = fbm(x + 1.7, y + 9.2, seed + 23, 3, fp);
  const qx = x + 2.2 * (wx - 0.5), qy = y + 2.2 * (wy - 0.5);
  const n = fbm(qx, qy, seed, 5, fp), t = 0.5 + (0.5 - dn) * 0.3;
  const a1 = smooth(t - w, t + w, n), rim = a1 * Math.exp(-(((n - t - w) / (0.03 + w * 0.5)) ** 2));
  const n2 = fbm(qx * 0.55 + 31.7, qy * 0.55 - 12.4, seed + 37, 4, fp * 0.55), a2 = smooth(t + 0.03 - w, t + 0.03 + w, n2);
  const grain = fp < 0.06 ? 0.8 + 0.4 * vnoise(x * 11.3, y * 11.3, seed + 51) : 1;
  return clamp((0.62 * a1 + 0.38 * rim + 0.4 * a2 * (1 - 0.6 * a1)) * grain, 0, 1);
}
const lavisCache = new Map();
/** Image du lavis (data URL). at(i, j) -> [motif x, motif y, taille du pixel en unites du motif] ou null (rien a peindre). */
function lavisImage(key, gr, wpx, hpx, at) {
  let url = lavisCache.get(key);
  if (url) return url;
  const cv = document.createElement("canvas");
  cv.width = wpx; cv.height = hpx;
  const ctx = cv.getContext("2d"), img = ctx.createImageData(wpx, hpx), px = img.data;
  const col = (gr.col || "#000000").replace("#", ""), R = parseInt(col.slice(0, 2), 16) || 0, G = parseInt(col.slice(2, 4), 16) || 0, B = parseInt(col.slice(4, 6), 16) || 0;
  const lam = Math.max(0.05, (gr.sc ?? 0.5) * 2 * (gr.ts ?? 1)), dn = clamp(gr.dn ?? 0.45, 0, 1), w = 0.008 + 0.05 * clamp(gr.sf ?? 0.5, 0, 2), seed = (gr.seed ?? 1) | 0;
  for (let j = 0; j < hpx; j++) for (let i = 0; i < wpx; i++) {
    const p = at(i + 0.5, j + 0.5);
    if (!p) continue;
    const k = (j * wpx + i) * 4, v = lavisAt(p[0] / lam, p[1] / lam, p[2] / lam, dn, w, seed);
    px[k] = R; px[k + 1] = G; px[k + 2] = B; px[k + 3] = Math.round(v * 255);
  }
  ctx.putImageData(img, 0, 0);
  url = cv.toDataURL("image/png");
  if (lavisCache.size > 1500) lavisCache.clear();
  lavisCache.set(key, url);
  return url;
}
const lavisKey = (gr, m, extra) => JSON.stringify([m, gr.sc, gr.ts, gr.dn, gr.sf, gr.seed, gr.col, extra]);

/** Sol en perspective dans une boite {x, y, w, h} (unites de la case). id : prefixe unique pour les degrades. */
export function groundSvg(gr, box, id = "gr", vis = box) {
  if (!gr || !gr.on) return "";
  const hz = gr.hz ?? 0.45, sc = Math.max(0.1, gr.sc ?? 0.5), col = gr.col || "#000000", a = gr.a ?? 0.22, pat = patOf(gr);
  const yH = box.y + hz * box.h, yB = Math.max(box.y + box.h, vis.y + vis.h), F = box.w, cx = box.x + box.w / 2;
  const m = groundMap(gr, box.h / box.w), mi = inv2(m);
  const vN = F / Math.max(1e-6, yB - yH), vF = vN * 14;      // du bas de la case a loin vers l'horizon
  const img = (u, v) => [cx + F * u / v, yH + F / v];
  const toUV = (px, pz) => { const dx = px - m[4], dz = pz - m[5]; return [mi[0] * dx + mi[1] * dz, mi[2] * dx + mi[3] * dz]; };
  const sx = Math.hypot(m[0], m[2]) || 1;                  // unites du motif par unite de u
  let d = "", body = "";
  if (pat === "uni") d = `M${f1(vis.x)} ${f1(yH)}H${f1(vis.x + vis.w)}V${f1(yB)}H${f1(vis.x)}Z`;
  else if (pat === "lavis") {
    const wpx = Math.round(clamp(vis.w, 200, 640)), s = vis.w / wpx, hpx = Math.max(1, Math.ceil((yB - yH) / s));
    const url = lavisImage(lavisKey(gr, m, [box.w, box.h, hz, wpx, vis.x, vis.w, yB]), gr, wpx, hpx, (i, j) => {
      const x = vis.x + i * s, dy = j * s;
      if (dy < 0.3 * s) return null;
      const v = F / dy, u = (x - cx) / dy;
      if (v > vF * 1.2) return null;
      const du = s / dy, dv = F * s / (dy * dy), duy = Math.abs(x - cx) * s / (dy * dy);
      const fp = Math.max(Math.hypot(m[0] * du, m[2] * du), Math.hypot(m[0] * duy + m[1] * dv, m[2] * duy + m[3] * dv));
      return [m[0] * u + m[1] * v + m[4], m[2] * u + m[3] * v + m[5], fp];
    });
    body = `<image href="${url}" x="${f1(vis.x)}" y="${f1(yH)}" width="${f1(vis.w)}" height="${f1(hpx * s)}" preserveAspectRatio="none"/>`;
  } else {
    // les cases du motif qui touchent la partie visible du sol
    const uw = (v) => (Math.max(cx - vis.x, vis.x + vis.w - cx) + 4) * v / F, ps = [[-uw(vN), vN], [uw(vN), vN], [-uw(vF), vF], [uw(vF), vF]].map(([u, v]) => [m[0] * u + m[1] * v + m[4], m[2] * u + m[3] * v + m[5]]);
    const i0 = Math.floor(Math.min(...ps.map((p) => p[0])) / sc) - 1, i1 = Math.ceil(Math.max(...ps.map((p) => p[0])) / sc) + 1;
    const j0 = Math.floor(Math.min(...ps.map((p) => p[1])) / sc) - 1, j1 = Math.ceil(Math.max(...ps.map((p) => p[1])) / sc) + 1;
    const step = Math.max(1, Math.ceil(Math.sqrt(((i1 - i0) * (j1 - j0)) / 60000)));   // garde-fou : jamais plus de ~60 000 cases
    const P = (i, j) => { const [u, v] = toUV(i * sc, j * sc); return v > vN * 0.02 ? img(u, v) : null; };
    const far = (i, j) => toUV(i * sc, j * sc)[1] > vF;
    const lw = Math.max(0.6, box.h * 0.0025);
    for (let j = j0; j < j1; j += step) for (let i = i0; i < i1; i += step) {
      if (far(i, j) && far(i + step, j) && far(i, j + step) && far(i + step, j + step)) continue;
      const a1 = P(i, j), b1 = P(i + step, j), c1 = P(i + step, j + step), d1 = P(i, j + step);
      if (pat === "points") {
        if (!a1) continue;
        const r = Math.max(0.4, 0.012 * F / toUV(i * sc, j * sc)[1] / sx);
        if (a1[0] < vis.x - r || a1[0] > vis.x + vis.w + r || a1[1] > yB + r) continue;
        d += `M${f1(a1[0] - r)} ${f1(a1[1])}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0Z`;
        continue;
      }
      if (!a1 || !b1 || !c1 || !d1) continue;
      const xs = [a1[0], b1[0], c1[0], d1[0]], ys = [a1[1], b1[1], c1[1], d1[1]];
      if (Math.max(...xs) < vis.x || Math.min(...xs) > vis.x + vis.w || Math.min(...ys) > yB) continue;
      if (pat === "grille") { d += `M${f1(d1[0])} ${f1(d1[1])}L${f1(a1[0])} ${f1(a1[1])}L${f1(b1[0])} ${f1(b1[1])}`; continue; }
      const on = pat === "lignes" ? (((j / step) % 2) + 2) % 2 === 0 : ((((i + j) / step) % 2) + 2) % 2 === 0;
      if (on) d += `M${f1(a1[0])} ${f1(a1[1])}L${f1(b1[0])} ${f1(b1[1])}L${f1(c1[0])} ${f1(c1[1])}L${f1(d1[0])} ${f1(d1[1])}Z`;
    }
    body = pat === "grille" ? `<path d="${d}" fill="none" stroke="${col}" stroke-width="${lw.toFixed(2)}"/>` : "";
  }
  if (!body) body = `<path d="${d}" fill="${col}"/>`;
  // plaque de sol : son contour en perspective decoupe le sol ; sa couleur pleine passe sous le motif
  let plate = "", pclip = "";
  if (Array.isArray(gr.ext) && gr.ext.length === 4) {
    const P = plateCorners(gr, box);
    if (P.length < 3) return "";                           // la plaque est toute entiere derriere la camera
    const pd = "M" + P.map((q) => f1(q[0]) + " " + f1(q[1])).join("L") + "Z";
    pclip = `<clipPath id="${id}-p"><path d="${pd}"/></clipPath>`;
    if (gr.fill !== "none") plate = `<g clip-path="url(#${id}-c)" style="pointer-events:none"><path d="${pd}" fill="${gr.fill || PLATE0}"/></g>`;
    body = `<g clip-path="url(#${id}-p)">${body}</g>`;
  }
  // vers l'horizon le motif s'efface (trop fin pour etre dessine)
  const yFar = yH + F / vF, yMid = yH + F / (vF / 4);
  return `<defs><linearGradient id="${id}-fade" gradientUnits="userSpaceOnUse" x1="0" y1="${f1(yFar)}" x2="0" y2="${f1(yMid)}"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient>` +
    `<mask id="${id}-m" maskUnits="userSpaceOnUse" x="${f1(vis.x)}" y="${f1(yH)}" width="${f1(vis.w)}" height="${f1(yB - yH)}"><rect x="${f1(vis.x)}" y="${f1(yH)}" width="${f1(vis.w)}" height="${f1(yB - yH)}" fill="url(#${id}-fade)"/></mask>` +
    `<clipPath id="${id}-c"><rect x="${f1(vis.x)}" y="${f1(yH)}" width="${f1(vis.w)}" height="${f1(yB - yH)}"/></clipPath>${pclip}</defs>` + plate +
    `<g clip-path="url(#${id}-c)" mask="url(#${id}-m)" opacity="${a}" style="pointer-events:none">${body}</g>`;
}

export const PLATE0 = "#e6e1d6";
/** Plaque de sol de depart : du bas de la case jusqu'a mi-distance, un peu moins large que le champ (ses bords se voient). ratio : h / w. */
export function plateDefault(gr, ratio) {
  const vN = 1 / Math.max(0.05, (1 - (gr.hz ?? 0.45)) * ratio);
  return [-vN * 0.42, vN * 0.42, vN * 0.95, vN * 4].map((x) => +x.toFixed(3));
}
/** Repere de la plaque : gr.pm = [a, b, c, d, e, g] fait passer du sol vu de la camera de la case (u, v) aux coordonnees
 *  de la plaque (p, q) = (a u + b v + e, c u + d v + g) ; gr.ext y est un rectangle. Sans pm (plaque jamais recalculee) :
 *  les memes coordonnees. Quand la camera change (« Recalculer la perspective »), pm suit : la plaque reste au meme endroit
 *  du sol, elle peut alors etre tournee, et passer en partie derriere la camera. */
export function plateMap(gr) { return Array.isArray(gr.pm) && gr.pm.length === 6 ? gr.pm : [1, 0, 0, 1, 0, 0]; }
export function toPlate(gr, u, v) { const m = plateMap(gr); return [m[0] * u + m[1] * v + m[4], m[2] * u + m[3] * v + m[5]]; }
export function fromPlate(gr, p, q) {
  const m = plateMap(gr), mi = inv2(m), dp = p - m[4], dq = q - m[5];
  return [mi[0] * dp + mi[1] * dq, mi[2] * dp + mi[3] * dq];
}
/** Les quatre coins de la plaque sur le sol (u, v) : pres gauche, pres droit, loin droit, loin gauche (dans son repere). */
export function plateGround(gr) {
  const [u0, u1, v0, v1] = gr.ext;
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([p, q]) => fromPlate(gr, p, q));
}
const VMIN = 0.03;                                         // plus pres que ca, le sol passe derriere la camera : on coupe
/** Contour de la plaque dans la boite, coupe la ou il passe derriere la camera (3 a 8 points, ou aucun). */
export function plateCorners(gr, box) {
  const hz = gr.hz ?? 0.45, yH = box.y + hz * box.h, F = box.w, cx = box.x + box.w / 2;
  const G = plateGround(gr), out = [];
  for (let i = 0; i < G.length; i++) {
    const a = G[i], b = G[(i + 1) % G.length], ina = a[1] >= VMIN, inb = b[1] >= VMIN;
    if (ina) out.push(a);
    if (ina !== inb) { const k = (VMIN - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * k, VMIN]); }
  }
  return out.map(([u, v]) => [cx + F * u / v, yH + F / v]);
}
/** Point du sol (u, v) -> point de la boite ; null s'il est derriere la camera. */
export function groundImg(gr, box, u, v) {
  if (v < VMIN) return null;
  const hz = gr.hz ?? 0.45;
  return [box.x + box.w / 2 + box.w * u / v, box.y + hz * box.h + box.w / v];
}
/** Composer un repere du sol (m, comme groundMap ou plateMap) avec le passage nouveau sol -> ancien sol
 *  (u = a u' + b v' + e, v = c u' + d v' + g). */
export function composeGround(m, a, b, c, d, e, g) {
  const [A, B, C, Dd, E, G] = m;
  return [A * a + B * c, A * b + B * d, C * a + Dd * c, C * b + Dd * d, A * e + B * g + E, C * e + Dd * g + G].map((x) => +x.toFixed(5));
}
/** Point de la boite -> point du sol (u, v) ; null au-dessus de l'horizon. */
export function groundAt(gr, box, x, y) {
  const hz = gr.hz ?? 0.45, yH = box.y + hz * box.h, F = box.w, cx = box.x + box.w / 2;
  if (y <= yH + 0.5) return null;
  const v = F / (y - yH);
  return [(x - cx) * v / F, v];
}

/** Le sol vu de dessus (vue isometrique, dalles de la vue 3D) : un rectangle (x0, y0, w, hh) en unites de l'appelant, ou
 *  x = X du sol (largeur de case, camera de la case en 0,5) et y * zs = Z du sol (profondeur, camera en -1). camY : hauteur
 *  de la camera de la case ; ratio : h / w de la case. Le motif tombe au meme endroit que dans l'image de la case. */
export function groundTile(gr, { x0, y0, w, hh, camY, zs = 1, ratio, id, px = 64 }) {
  if (!gr || !gr.on) return "";
  const g = Object.assign({}, GROUND0, gr), pat = patOf(g), sc = Math.max(0.1, g.sc), col = g.col, a = g.a, m = groundMap(g, ratio);
  // (x, y) de l'appelant -> motif : L (x, y) + t
  const L = [m[0] / camY, m[1] * zs / camY, m[2] / camY, m[3] * zs / camY];
  const t = [m[4] + (-0.5 * m[0] + 1 * m[1]) / camY, m[5] + (-0.5 * m[2] + 1 * m[3]) / camY];
  if (pat === "lavis") {
    const n = Math.max(8, Math.round(px)), sx = w / n, sy = hh / n;
    const fp = Math.max(Math.hypot(L[0] * sx, L[2] * sx), Math.hypot(L[1] * sy, L[3] * sy));
    const url = lavisImage(lavisKey(g, m, [x0, y0, w, hh, camY, zs, n]), g, n, n, (i, j) => { const x = x0 + i * sx, y = y0 + j * sy; return [L[0] * x + L[1] * y + t[0], L[2] * x + L[3] * y + t[1], fp]; });
    return `<image href="${url}" x="${x0}" y="${y0}" width="${w}" height="${hh}" preserveAspectRatio="none" opacity="${a}"/>`;
  }
  // motif -> appelant : l'inverse, en patternTransform
  const li = inv2(L), e = -(li[0] * t[0] + li[1] * t[1]), f = -(li[2] * t[0] + li[3] * t[1]);
  const s2 = (2 * sc).toFixed(4), s1 = sc.toFixed(4), sx = Math.hypot(m[0], m[2]) || 1;
  const inner = pat === "damier" ? `<rect width="${s1}" height="${s1}" fill="${col}"/><rect x="${s1}" y="${s1}" width="${s1}" height="${s1}" fill="${col}"/>`
    : pat === "grille" ? `<path d="M0 0H${s2}M0 0V${s2}M0 ${s1}H${s2}M${s1} 0V${s2}" fill="none" stroke="${col}" stroke-width="${(sc * 0.05).toFixed(4)}"/>`
    : pat === "points" ? [[0, 0], [sc, 0], [0, sc], [sc, sc]].map(([x, y]) => `<circle cx="${x.toFixed(4)}" cy="${y.toFixed(4)}" r="${(0.012 / sx).toFixed(4)}" fill="${col}"/>`).join("")
    : pat === "lignes" ? `<rect width="${s2}" height="${s1}" fill="${col}"/>`
    : `<rect width="${s2}" height="${s2}" fill="${col}"/>`;
  const mat = [li[0], li[2], li[1], li[3], e, f].map((v) => +v.toFixed(6)).join(" ");
  return `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="${s2}" height="${s2}" patternTransform="matrix(${mat})"><g opacity="${a}">${inner}</g></pattern></defs>` +
    `<rect x="${x0}" y="${y0}" width="${w}" height="${hh}" fill="url(#${id})"/>`;
}
