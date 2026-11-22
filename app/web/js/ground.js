// Carte de sol d'une case : un motif (damier, grille, points, lignes ou uni) pose sur le sol et vu en perspective dans
// l'image, jusqu'a la ligne d'horizon. panel.ground = { on, pat, hz (horizon, fraction de la hauteur de la case),
// sc (taille des carreaux), col (couleur), a (opacite) }. Le meme trace dans la case, au montage et dans l'image aplatie.
import { tt } from "./i18n.js";

export const PATS = { damier: tt("Damier"), grille: tt("Grille"), points: tt("Points"), lignes: tt("Lignes (bandes)"), uni: tt("Uni") };
export const GROUND0 = { on: true, pat: "damier", sc: 0.5, col: "#000000", a: 0.22 };

/** Horizon estime d'apres les personnages : camera a hauteur d'homme, l'horizon passe a hauteur de leurs yeux (pied moins
 *  90 % de la hauteur), mediane des elements ; jamais sous le pied le plus haut. Sans element : 0,45. */
export function estimateHorizon(pan) {
  const ls = (pan.layers || []).filter((l) => typeof l.y === "number" && l.y > 0.05);
  if (!ls.length) return 0.45;
  const eyes = ls.map((l) => l.y - 0.9 * (l.s || 0.5)).sort((a, b) => a - b), mid = eyes[Math.floor(eyes.length / 2)];
  const hz = Math.min(mid, Math.min(...ls.map((l) => l.y)) - 0.03);
  return Math.round(Math.max(0.05, Math.min(0.85, hz)) * 1000) / 1000;
}

const f1 = (n) => n.toFixed(1);
/** Sol en perspective dans une boite {x, y, w, h} (unites de la case). id : prefixe unique pour les degrades. */
export function groundSvg(gr, box, id = "gr") {
  if (!gr || !gr.on) return "";
  const hz = gr.hz ?? 0.45, sc = Math.max(0.1, gr.sc ?? 0.5), col = gr.col || "#000000", a = gr.a ?? 0.22, pat = gr.pat || "damier";
  const yH = box.y + hz * box.h, f = Math.max(1, (1 - hz) * box.h), cx = box.x + box.w / 2;
  const Z0 = 0.5, ZMAX = 14, P = (X, Z) => [cx + f * X / Z, yH + f / Z];
  const xmax = (Z) => (box.w / 2 + 4) * Z / f;
  let d = "";
  const quad = (a1, b1, c1, d1) => { d += `M${f1(a1[0])} ${f1(a1[1])}L${f1(b1[0])} ${f1(b1[1])}L${f1(c1[0])} ${f1(c1[1])}L${f1(d1[0])} ${f1(d1[1])}Z`; };
  const rows = [];
  for (let Z = Z0; Z < ZMAX; Z += sc) rows.push(Z);
  if (pat === "uni") d = `M${f1(box.x)} ${f1(yH)}H${f1(box.x + box.w)}V${f1(box.y + box.h)}H${f1(box.x)}Z`;
  else if (pat === "damier" || pat === "lignes") {
    rows.forEach((Z, i) => {
      const Z2 = Z + sc;
      if (pat === "lignes") { if (i % 2 === 0) { const y1 = P(0, Z)[1], y2 = P(0, Z2)[1]; d += `M${f1(box.x)} ${f1(y2)}H${f1(box.x + box.w)}V${f1(y1)}H${f1(box.x)}Z`; } return; }
      const n = Math.ceil(xmax(Z2) / sc);
      for (let j = -n; j < n; j++) if (((i + j) % 2 + 2) % 2 === 0) quad(P(j * sc, Z), P((j + 1) * sc, Z), P((j + 1) * sc, Z2), P(j * sc, Z2));
    });
  } else if (pat === "grille") {
    const n = Math.ceil(xmax(ZMAX) / sc), w = Math.max(0.6, box.h * 0.0025);
    for (let j = -n; j <= n; j++) { const p1 = P(j * sc, Z0), p2 = P(j * sc, ZMAX); d += `M${f1(p1[0])} ${f1(p1[1])}L${f1(p2[0])} ${f1(p2[1])}`; }
    for (const Z of rows) { const y = P(0, Z)[1]; d += `M${f1(box.x)} ${f1(y)}H${f1(box.x + box.w)}`; }
    d = `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w.toFixed(2)}"/>`;
  } else if (pat === "points") {
    for (const Z of rows) {
      const n = Math.ceil(xmax(Z) / sc), r = Math.max(0.4, f * 0.012 / Z);
      for (let j = -n; j <= n; j++) { const p = P(j * sc, Z); d += `M${f1(p[0] - r)} ${f1(p[1])}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0Z`; }
    }
  }
  const body = pat === "grille" ? d : `<path d="${d}" fill="${col}"/>`;
  // vers l'horizon le motif s'efface (trop fin pour etre dessine)
  const yFar = P(0, ZMAX)[1], yMid = P(0, ZMAX / 4)[1];
  return `<defs><linearGradient id="${id}-fade" gradientUnits="userSpaceOnUse" x1="0" y1="${f1(yFar)}" x2="0" y2="${f1(yMid)}"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient>` +
    `<mask id="${id}-m" maskUnits="userSpaceOnUse" x="${f1(box.x)}" y="${f1(yH)}" width="${f1(box.w)}" height="${f1(box.y + box.h - yH)}"><rect x="${f1(box.x)}" y="${f1(yH)}" width="${f1(box.w)}" height="${f1(box.y + box.h - yH)}" fill="url(#${id}-fade)"/></mask>` +
    `<clipPath id="${id}-c"><rect x="${f1(box.x)}" y="${f1(yH)}" width="${f1(box.w)}" height="${f1(box.y + box.h - yH)}"/></clipPath></defs>` +
    `<g clip-path="url(#${id}-c)" mask="url(#${id}-m)" opacity="${a}" style="pointer-events:none">${body}</g>`;
}

/** Motif du sol pour la vue isometrique, en unites du sol (1 = largeur de la case). */
export function groundPattern(gr, id) {
  const g = Object.assign({}, GROUND0, gr), sc = Math.max(0.1, g.sc) * 0.25, col = g.col, a = g.a;
  const s = sc.toFixed(4), hs = (sc / 2).toFixed(4);
  const inner = g.pat === "damier" ? `<rect width="${hs}" height="${hs}" fill="${col}"/><rect x="${hs}" y="${hs}" width="${hs}" height="${hs}" fill="${col}"/>`
    : g.pat === "grille" ? `<path d="M0 0H${s}M0 0V${s}" fill="none" stroke="${col}" stroke-width="${(sc * 0.06).toFixed(4)}"/>`
    : g.pat === "points" ? `<circle cx="0" cy="0" r="${(sc * 0.07).toFixed(4)}" fill="${col}"/>`
    : g.pat === "lignes" ? `<rect width="${s}" height="${hs}" fill="${col}"/>` : `<rect width="${s}" height="${s}" fill="${col}"/>`;
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${s}" height="${s}"><g opacity="${a}">${inner}</g></pattern>`;
}
