// Banque de formes de l'atelier « Dessiner le fond » : une centaine de silhouettes toutes faites (objets, nature, ville,
// vehicules, etres, signes, formes abstraites) a poser en aplat ou au trait, comme une primitive (on glisse d'un coin a
// l'autre). Chaque forme est un trace SVG en coordonnees absolues, avec seulement M, L, C, Q et Z : draw.js le recale dans
// la boite de la forme en transformant chaque paire de nombres. Les parties pleines tournent toutes dans le meme sens (un
// chevauchement reste plein) ; les trous tournent dans l'autre (un trou reste vide).
import { tt } from "./i18n.js";

const R = (n) => Math.round(n * 10) / 10;
const area = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const orient = (pts, hole) => ((area(pts) > 0) === !hole ? pts : pts.slice().reverse());
const P = (s) => s.trim().split(/\s+/).map((q) => q.split(",").map(Number));
/** contour a angles vifs */
const poly = (pts, hole = false) => { const q = orient(typeof pts === "string" ? P(pts) : pts, hole); return "M" + q.map((p) => R(p[0]) + " " + R(p[1])).join("L") + "Z"; };
/** contour lisse passant par les points (Catmull-Rom) */
function smooth(pts, hole = false) {
  const q = orient(typeof pts === "string" ? P(pts) : pts, hole), n = q.length, g = (i) => q[(i + n) % n];
  let d = `M${R(q[0][0])} ${R(q[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = g(i - 1), p1 = g(i), p2 = g(i + 1), p3 = g(i + 2);
    d += `C${R(p1[0] + (p2[0] - p0[0]) / 6)} ${R(p1[1] + (p2[1] - p0[1]) / 6)} ${R(p2[0] - (p3[0] - p1[0]) / 6)} ${R(p2[1] - (p3[1] - p1[1]) / 6)} ${R(p2[0])} ${R(p2[1])}`;
  }
  return d + "Z";
}
const ring = (cx, cy, rx, ry = rx, n = 16, a0 = 0) => Array.from({ length: n }, (_, i) => { const a = a0 + i * 2 * Math.PI / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
const circ = (cx, cy, rx, ry = rx, hole = false) => smooth(ring(cx, cy, rx, ry), hole);
const rect = (x, y, w, h, hole = false) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], hole);
function rrect(x, y, w, h, r, hole = false) {                // rectangle arrondi : coins en quarts de cercle echantillonnes
  r = Math.min(r, w / 2, h / 2);
  const c = (cx, cy, a0) => Array.from({ length: 5 }, (_, i) => { const a = a0 + i * Math.PI / 8; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  return poly([...c(x + w - r, y + r, -Math.PI / 2), ...c(x + w - r, y + h - r, 0), ...c(x + r, y + h - r, Math.PI / 2), ...c(x + r, y + r, Math.PI)], hole);
}
const starPts = (cx, cy, ro, ri, n, rot = -90) => Array.from({ length: 2 * n }, (_, i) => { const a = (rot + i * 180 / n) * Math.PI / 180, r = i % 2 ? ri : ro; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
function rng(seed) { let a = (seed * 2654435761) >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const blobPts = (seed, n = 9, irr = 0.35, cx = 50, cy = 50, rx = 45, ry = rx) => { const r = rng(seed); return Array.from({ length: n }, (_, i) => { const a = i * 2 * Math.PI / n + (r() - 0.5) * 0.5, k = 1 - irr + r() * irr; return [cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]; }); };
/** feuille en amande de a vers b, largeur w */
function leaf(a, b, w) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * w, ny = dx / l * w;
  const pts = [a, [mx + nx, my + ny], b, [mx - nx, my - ny]];
  const q = orient(pts), s = (p) => `${R(p[0])} ${R(p[1])}`;
  return `M${s(q[0])}Q${s(q[1])} ${s(q[2])}Q${s(q[3])} ${s(q[0])}Z`;
}
/** bande le long d'une ligne de points, largeur w(t) (t de 0 a 1) */
function band(line, w) {
  const n = line.length, L = [], Rr = [];
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, ww = w(i / (n - 1));
    L.push([line[i][0] - dy / l * ww, line[i][1] + dx / l * ww]); Rr.push([line[i][0] + dy / l * ww, line[i][1] - dx / l * ww]);
  }
  return poly([...L, ...Rr.reverse()]);
}
const sample = (n, f) => Array.from({ length: n }, (_, i) => f(i / (n - 1)));
function crescent(r1, dx, dy, r2) {                         // disque moins un disque decale
  const out = ring(50, 50, r1, r1, 90).filter((p) => Math.hypot(p[0] - 50 - dx, p[1] - 50 - dy) > r2);
  const inn = ring(50 + dx, 50 + dy, r2, r2, 90).filter((p) => Math.hypot(p[0] - 50, p[1] - 50) < r1);
  const cut = (arr, keep) => { let k = 0; for (let i = 1; i < arr.length; i++) if (Math.hypot(arr[i][0] - arr[i - 1][0], arr[i][1] - arr[i - 1][1]) > keep) { k = i; break; } return arr.slice(k).concat(arr.slice(0, k)); };
  const o = cut(out, r1 * 0.2), ii = cut(inn, r2 * 0.2).reverse();
  return poly([...o, ...ii]);
}
function gear(n, ro, ri, hole) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = i * 2 * Math.PI / n, s = Math.PI / n; for (const [da, r] of [[-0.5 * s, ri], [-0.3 * s, ro], [0.3 * s, ro], [0.5 * s, ri]]) pts.push([50 + r * Math.cos(a + da), 50 + r * Math.sin(a + da)]); }
  return poly(pts) + (hole ? circ(50, 50, hole, hole, true) : "");
}
const wheel = (cx, cy, r) => circ(cx, cy, r);

// ------------------------------------------------------------------------------------------------- les formes
const CATS = { nature: tt("Nature"), ville: tt("Ville et bâtiments"), objets: tt("Objets"), vehicules: tt("Véhicules"), etres: tt("Êtres"), signes: tt("Signes"), abstrait: tt("Abstrait") };
const L = [];
const add = (c, k, n, d) => L.push({ c, k, n, d });

// nature
add("nature", "arbre", tt("Arbre"), smooth(starPts(50, 36, 36, 29, 9)) + poly("44,58 56,58 57,94 63,100 37,100 43,94"));
add("nature", "arbre-rond", tt("Arbre rond"), circ(50, 34, 32) + poly("46,60 54,60 55,100 45,100"));
add("nature", "sapin", tt("Sapin"), poly("50,0 66,24 58,24 74,48 63,48 82,74 54,74 54,100 46,100 46,74 18,74 37,48 26,48 42,24 34,24"));
add("nature", "cypres", tt("Cyprès"), smooth("50,0 60,20 63,50 60,80 50,92 40,80 37,50 40,20") + rect(47, 88, 6, 12));
add("nature", "palmier", tt("Palmier"), smooth("47,100 45,70 47,42 52,22 56,22 53,42 52,70 56,100") + leaf([54, 21], [14, 34], 7) + leaf([54, 21], [24, 4], 7) + leaf([54, 21], [56, 0], 6) + leaf([54, 21], [86, 6], 7) + leaf([54, 21], [96, 34], 7));
add("nature", "buisson", tt("Buisson"), smooth([...sample(9, (t) => { const a = Math.PI + t * Math.PI, r = (Math.round(t * 8) % 2 ? 0.86 : 1); return [50 + 48 * r * Math.cos(a), 70 + 52 * r * Math.sin(a)]; }), [96, 100], [4, 100]]));
add("nature", "touffe", tt("Touffe d'herbe"), poly("0,100 8,40 16,100 20,100 30,20 38,100 42,100 52,4 60,100 64,100 74,28 80,100 84,100 94,48 100,100"));
add("nature", "rocher", tt("Rocher"), poly("8,100 4,72 16,44 38,28 60,30 80,46 96,74 92,100"));
add("nature", "rochers", tt("Rochers"), poly("0,100 4,70 22,52 42,56 50,78 48,100") + poly("40,100 46,72 64,48 86,50 100,76 98,100"));
add("nature", "galet", tt("Galet"), smooth(blobPts(11, 8, 0.15, 50, 50, 48, 30)));
add("nature", "montagne", tt("Montagne"), poly("0,100 38,10 47,24 55,14 100,100"));
add("nature", "montagnes", tt("Chaîne de montagnes"), poly("0,80 22,36 34,50 56,10 72,34 82,24 104,52 116,40 140,66 160,80"));
add("nature", "colline", tt("Colline"), "M0 80C45 5 115 5 160 80Z");
add("nature", "collines", tt("Collines"), smooth("0,80 20,40 55,30 80,52 110,26 145,34 160,60 160,80"));
add("nature", "nuage", tt("Nuage"), circ(30, 60, 22) + circ(55, 44, 28) + circ(80, 62, 20) + rect(30, 60, 50, 22));
add("nature", "nuage-long", tt("Nuage allongé"), circ(30, 50, 26, 16) + circ(62, 42, 30, 22) + circ(100, 50, 26, 16) + circ(132, 54, 18, 12) + rect(30, 50, 102, 14));
add("nature", "soleil", tt("Soleil"), poly(starPts(50, 50, 50, 30, 12)) + circ(50, 50, 30));
add("nature", "lune", tt("Lune"), crescent(45, 22, -12, 40));
add("nature", "goutte", tt("Goutte d'eau"), "M50 0C50 0 90 50 90 68C90 90 72 100 50 100C28 100 10 90 10 68C10 50 50 0 50 0Z");
add("nature", "feuille", tt("Feuille"), leaf([50, 92], [50, 0], 30) + rect(48, 88, 4, 12));
add("nature", "feuille-ronde", tt("Feuille ronde"), smooth("50,0 78,18 92,48 80,78 52,90 22,80 8,50 20,18") + rect(48, 86, 4, 14));
add("nature", "fleur", tt("Fleur"), ring(50, 50, 28, 28, 6).map((p) => circ(p[0], p[1], 20)).join("") + circ(50, 50, 18));
add("nature", "tulipe", tt("Tulipe"), smooth("30,10 40,26 50,8 60,26 70,10 74,40 64,58 50,62 36,58 26,40") + rect(48, 60, 4, 40) + leaf([50, 100], [24, 66], 8));
add("nature", "champignon", tt("Champignon"), "M4 52C4 8 96 8 96 52C70 46 30 46 4 52Z" + rrect(38, 46, 24, 54, 8));
add("nature", "cactus", tt("Cactus"), rrect(40, 8, 20, 92, 10) + rrect(12, 36, 14, 34, 7) + rrect(12, 58, 34, 12, 6) + rrect(74, 22, 14, 32, 7) + rrect(54, 44, 34, 12, 6));
add("nature", "vagues", tt("Vagues"), "M0 60C15 40 35 40 50 60C65 80 85 80 100 60L100 100L0 100Z");
add("nature", "flamme", tt("Flamme"), "M50 0C60 25 85 40 80 70C78 90 62 100 50 100C38 100 22 90 20 70C18 50 35 45 38 25C45 40 48 30 50 0Z");
add("nature", "ile", tt("Île"), smooth("0,90 20,72 45,66 70,70 100,90") + rect(0, 88, 100, 12) + smooth("62,70 60,40 64,22 68,22 66,40 68,70") + leaf([66, 22], [40, 26], 5) + leaf([66, 22], [90, 24], 5) + leaf([66, 22], [62, 2], 4));

// ville et batiments
add("ville", "maison", tt("Maison"), poly("10,45 50,8 90,45 82,45 82,100 18,100 18,45") + poly("64,14 76,14 76,34 64,24"));
add("ville", "maison-porte", tt("Maison avec porte et fenêtres"), poly("10,45 50,8 90,45 82,45 82,100 18,100 18,45") + rect(42, 66, 16, 34, true) + rect(24, 52, 12, 12, true) + rect(64, 52, 12, 12, true));
add("ville", "immeuble", tt("Immeuble"), rect(20, 0, 60, 100) + Array.from({ length: 15 }, (_, i) => rect(28 + (i % 3) * 16, 8 + Math.floor(i / 3) * 17, 10, 10, true)).join(""));
add("ville", "gratte-ciel", tt("Gratte-ciel"), poly("30,100 30,30 40,30 40,15 47,15 47,0 53,0 53,15 60,15 60,30 70,30 70,100"));
add("ville", "ville", tt("Ville (silhouette)"), (() => { const r = rng(5), pts = [[0, 100]]; let x = 0; while (x < 200) { const w = 10 + r() * 18, hh = 25 + r() * 60; pts.push([x, 100 - hh], [Math.min(200, x + w), 100 - hh]); x += w; } pts.push([200, 100]); return poly(pts); })());
add("ville", "chateau", tt("Tour crénelée"), poly("25,100 25,30 20,30 20,10 30,10 30,18 40,18 40,10 50,10 50,18 60,18 60,10 70,10 70,18 80,18 80,10 80,30 75,30 75,100") + poly("44,100 44,78 50,70 56,78 56,100", true));
add("ville", "chateau-fort", tt("Château fort"), poly("0,100 0,30 6,30 6,22 12,22 12,30 18,30 18,22 24,22 24,30 30,30 30,50 70,50 70,30 76,30 76,22 82,22 82,30 88,30 88,22 94,22 94,30 100,30 100,100") + poly("40,100 40,78 50,68 60,78 60,100", true));
add("ville", "eglise", tt("Église"), poly("10,100 10,55 40,40 40,25 50,0 60,25 60,100") + poly("60,55 90,55 90,100 60,100") + poly("46,100 46,82 50,76 54,82 54,100", true));
add("ville", "usine", tt("Usine"), poly("0,100 0,50 20,35 20,50 40,35 40,50 60,35 60,50 70,50 70,10 80,10 80,50 100,50 100,100"));
add("ville", "phare", tt("Phare"), poly("38,100 42,30 58,30 62,100") + rect(38, 22, 24, 10) + poly("42,22 42,12 50,4 58,12 58,22"));
add("ville", "moulin", tt("Moulin à vent"), poly("38,100 42,40 58,40 62,100") + poly("40,42 50,30 60,42") + [0, 90, 180, 270].map((a) => { const r = (a + 35) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return poly([[50 - 3 * s, 34 + 3 * c], [50 + 3 * s, 34 - 3 * c], [50 + 3 * s + 34 * c, 34 - 3 * c + 34 * s], [50 - 3 * s + 34 * c, 34 + 3 * c + 34 * s]]); }).join(""));
add("ville", "tente", tt("Tente"), poly("0,100 50,10 100,100") + poly("40,100 50,62 60,100", true));
add("ville", "pyramides", tt("Pyramides"), poly("0,100 38,30 76,100") + poly("50,100 80,50 110,100"));
add("ville", "arche", tt("Porte voûtée"), rect(0, 0, 100, 100) + poly([[25, 100], [25, 50], ...sample(13, (t) => [50 - 25 * Math.cos(Math.PI * t), 50 - 25 * Math.sin(Math.PI * t)]), [75, 50], [75, 100]], true));
add("ville", "colonne-antique", tt("Colonne"), rect(20, 0, 60, 10) + rect(30, 10, 40, 80) + rect(20, 90, 60, 10));
add("ville", "pont", tt("Pont"), rect(0, 20, 200, 80) + [0, 1, 2].map((i) => poly([[18 + i * 60, 100], ...sample(13, (t) => [42 + i * 60 - 24 * Math.cos(Math.PI * t), 70 - 30 * Math.sin(Math.PI * t)]).reverse().reverse(), [66 + i * 60, 100]], true)).join(""));
add("ville", "palissade", tt("Palissade"), Array.from({ length: 6 }, (_, i) => poly([[i * 18, 100], [i * 18, 20], [i * 18 + 6, 10], [i * 18 + 12, 20], [i * 18 + 12, 100]])).join("") + rect(0, 34, 102, 8) + rect(0, 72, 102, 8));
add("ville", "lampadaire", tt("Lampadaire"), rect(47, 18, 6, 82) + rect(38, 96, 24, 4) + poly("36,18 64,18 58,4 42,4"));
add("ville", "feu", tt("Feu de circulation"), rrect(34, 0, 32, 66, 6) + circ(50, 12, 7, 7, true) + circ(50, 33, 7, 7, true) + circ(50, 54, 7, 7, true) + rect(47, 66, 6, 34));
add("ville", "banc", tt("Banc"), rect(0, 40, 100, 8) + rect(0, 20, 100, 8) + rect(8, 28, 4, 12) + rect(88, 28, 4, 12) + rect(6, 48, 6, 22) + rect(88, 48, 6, 22));
add("ville", "panneau", tt("Panneau"), rect(47, 30, 6, 70) + rect(10, 6, 80, 32));
add("ville", "fenetre", tt("Fenêtre"), rect(0, 0, 100, 120) + rect(10, 10, 36, 46, true) + rect(54, 10, 36, 46, true) + rect(10, 64, 36, 46, true) + rect(54, 64, 36, 46, true));
add("ville", "porte", tt("Porte"), poly([[0, 120], [0, 40], ...sample(13, (t) => [50 - 50 * Math.cos(Math.PI * t), 40 - 40 * Math.sin(Math.PI * t)]), [100, 40], [100, 120]]) + circ(80, 74, 5, 5, true));
add("ville", "escalier", tt("Escalier"), poly("0,100 0,80 20,80 20,60 40,60 40,40 60,40 60,20 80,20 80,0 100,0 100,100"));
add("ville", "dome", tt("Dôme"), poly([[10, 100], [10, 60], ...sample(17, (t) => [50 - 40 * Math.cos(Math.PI * t), 60 - 44 * Math.sin(Math.PI * t)]), [90, 60], [90, 100]]) + rect(48, 4, 4, 14));
add("ville", "cabane", tt("Cabane sur pilotis"), poly("10,50 50,20 90,50") + rect(18, 50, 64, 26) + rect(22, 76, 5, 24) + rect(73, 76, 5, 24) + rect(44, 58, 12, 18, true));

// objets
add("objets", "chaise", tt("Chaise"), poly("20,0 30,0 30,52 80,52 80,62 76,62 76,100 68,100 68,62 32,62 32,100 24,100 24,62 20,62"));
add("objets", "table", tt("Table"), rect(0, 30, 100, 8) + rect(8, 38, 6, 62) + rect(86, 38, 6, 62));
add("objets", "canape", tt("Canapé"), rrect(0, 30, 16, 50, 6) + rrect(84, 30, 16, 50, 6) + rrect(10, 10, 80, 44, 8) + rect(10, 50, 80, 26) + rect(6, 78, 6, 12) + rect(88, 78, 6, 12));
add("objets", "lit", tt("Lit"), rect(0, 20, 8, 80) + rect(0, 56, 100, 22) + rect(92, 44, 8, 56) + rrect(10, 44, 22, 12, 5));
add("objets", "lampe", tt("Lampe"), poly("22,40 78,40 64,4 36,4") + rect(47, 40, 6, 50) + rrect(30, 90, 40, 10, 4));
add("objets", "bouteille", tt("Bouteille"), smooth("42,0 58,0 58,24 70,38 72,96 50,100 28,96 30,38 42,24"));
add("objets", "verre", tt("Verre à pied"), poly("20,0 80,0 70,40 54,52 54,90 74,96 74,100 26,100 26,96 46,90 46,52 30,40"));
add("objets", "tasse", tt("Tasse"), poly("10,20 70,20 66,96 14,96") + circ(76, 50, 18, 20) + circ(76, 50, 9, 11, true) + rect(0, 96, 80, 4));
add("objets", "vase", tt("Vase"), smooth("38,0 62,0 60,12 80,40 72,80 58,100 42,100 28,80 20,40 40,12"));
add("objets", "parapluie", tt("Parapluie"), poly([...sample(17, (t) => [50 - 50 * Math.cos(Math.PI * t), 46 - 42 * Math.sin(Math.PI * t)]), ...Array.from({ length: 4 }, (_, i) => [[100 - i * 25 - 12.5, 38], [100 - (i + 1) * 25, 46]]).flat()]) + rect(48, 44, 4, 46) + band(sample(9, (t) => [50 - 12 * Math.sin(Math.PI * t), 90 + 8 * Math.sin(Math.PI * t * 0.9)]), () => 2));
add("objets", "livre", tt("Livre"), poly("0,10 50,20 50,100 0,90") + poly("50,20 100,10 100,90 50,100"));
add("objets", "cle", tt("Clé"), circ(22, 50, 22) + circ(22, 50, 10, 10, true) + rect(42, 46, 58, 8) + rect(80, 54, 6, 14) + rect(92, 54, 6, 10));
add("objets", "horloge", tt("Horloge"), circ(50, 50, 50) + circ(50, 50, 42, 42, true) + rect(48, 18, 4, 34) + poly("48,48 72,62 70,66 48,54"));
add("objets", "television", tt("Téléviseur"), rrect(0, 24, 100, 72, 8) + rrect(10, 32, 64, 56, 6, true) + band([[50, 24], [30, 0]], () => 1.5) + band([[50, 24], [70, 0]], () => 1.5));
add("objets", "ampoule", tt("Ampoule"), smooth("50,0 78,12 88,38 74,64 64,74 36,74 26,64 12,38 22,12") + rect(36, 72, 28, 18) + rect(42, 90, 16, 10));
add("objets", "bougie", tt("Bougie"), rect(36, 40, 28, 60) + "M50 0C58 14 64 22 60 32C58 38 42 38 40 32C36 22 44 14 50 0Z");
add("objets", "couronne", tt("Couronne"), poly("0,30 25,60 50,10 75,60 100,30 90,100 10,100"));
add("objets", "epee", tt("Épée"), poly("46,0 54,0 54,70 46,70") + poly("50,-6 54,0 46,0") + rect(30, 70, 40, 6) + rect(46, 76, 8, 18) + circ(50, 97, 5));
add("objets", "bouclier", tt("Bouclier"), "M10 0L90 0C90 50 80 80 50 100C20 80 10 50 10 0Z");
add("objets", "drapeau", tt("Drapeau"), rect(6, 0, 5, 100) + smooth("11,4 30,0 50,8 70,12 90,6 90,46 70,52 50,48 30,40 11,44"));
add("objets", "ballon", tt("Ballon de baudruche"), smooth("50,0 76,10 84,36 70,62 50,74 30,62 16,36 24,10") + poly("46,74 54,74 50,80") + band(sample(9, (t) => [50 + 6 * Math.sin(t * 6), 80 + 20 * t]), () => 0.8));
add("objets", "valise", tt("Valise"), rrect(0, 24, 100, 70, 8) + rrect(32, 4, 36, 26, 6) + rrect(40, 10, 20, 16, 3, true));
add("objets", "seau", tt("Seau"), poly("10,30 90,30 80,100 20,100") + band(sample(17, (t) => [10 + 80 * t, 30 - 26 * Math.sin(Math.PI * t)]), () => 2));
add("objets", "marteau", tt("Marteau"), rect(46, 22, 8, 78) + poly("14,0 80,0 86,10 86,24 14,24 4,12"));
add("objets", "ancre", tt("Ancre"), circ(50, 10, 10) + circ(50, 10, 5, 5, true) + rect(46, 20, 8, 70) + rect(30, 28, 40, 6) + band(sample(17, (t) => [10 + 80 * t, 70 + 22 * Math.sin(Math.PI * t)]), () => 4) + poly("2,60 18,70 4,78") + poly("98,60 82,70 96,78"));
add("objets", "coeur", tt("Cœur"), "M50 26C50 10 30 0 18 6C2 14 0 36 10 52C20 68 50 92 50 100C50 92 80 68 90 52C100 36 98 14 82 6C70 0 50 10 50 26Z");

// vehicules
add("vehicules", "voiture", tt("Voiture"), smooth("4,60 6,44 30,38 42,22 76,22 92,38 120,42 124,60") + rect(4, 54, 120, 10) + wheel(28, 64, 12) + wheel(100, 64, 12));
add("vehicules", "camion", tt("Camion"), rect(0, 10, 100, 54) + poly("100,24 124,24 140,44 140,64 100,64") + wheel(24, 66, 12) + wheel(70, 66, 12) + wheel(120, 66, 12));
add("vehicules", "bus", tt("Bus"), rrect(0, 0, 160, 60, 10) + Array.from({ length: 5 }, (_, i) => rect(10 + i * 28, 10, 20, 18, true)).join("") + wheel(32, 62, 12) + wheel(128, 62, 12));
add("vehicules", "voilier", tt("Voilier"), poly("4,74 96,74 82,96 18,96") + poly("48,0 52,0 52,74 48,74") + poly("54,6 92,66 54,66") + poly("46,14 46,66 14,66"));
add("vehicules", "cargo", tt("Cargo"), poly("0,50 160,50 148,80 10,80") + rect(110, 20, 30, 30) + rect(118, 6, 8, 14) + rect(20, 32, 24, 18) + rect(46, 32, 24, 18) + rect(72, 32, 24, 18));
add("vehicules", "avion", tt("Avion"), smooth("0,46 30,40 120,40 150,46 120,52 30,52") + poly("60,44 90,44 70,0 58,0") + poly("60,48 90,48 70,92 58,92") + poly("4,44 18,44 10,20 2,20"));
add("vehicules", "fusee", tt("Fusée"), smooth("50,0 66,24 68,70 32,70 34,24") + poly("34,52 18,80 34,76") + poly("66,52 82,80 66,76") + poly("40,70 60,70 54,90 46,90") + circ(50, 36, 7, 7, true));
add("vehicules", "montgolfiere", tt("Montgolfière"), smooth("50,0 82,14 92,42 76,70 58,80 42,80 24,70 8,42 18,14") + poly("42,80 46,90 54,90 58,80") + rect(40, 88, 20, 12));
add("vehicules", "locomotive", tt("Locomotive"), rect(0, 30, 90, 40) + rect(90, 10, 40, 60) + rect(20, 4, 14, 26) + poly("16,4 38,4 34,0 20,0") + wheel(20, 74, 12) + wheel(52, 74, 12) + wheel(108, 74, 12) + poly("130,60 146,76 130,76"));
add("vehicules", "velo", tt("Vélo"), circ(24, 60, 22) + circ(24, 60, 18, 18, true) + circ(106, 60, 22) + circ(106, 60, 18, 18, true) + band([[24, 60], [52, 26], [90, 26], [106, 60]], () => 2.5) + band([[52, 26], [62, 60], [24, 60]], () => 2.5) + band([[62, 60], [90, 26]], () => 2.5) + rect(44, 18, 16, 6) + rect(86, 14, 14, 5));

// etres
add("etres", "personne", tt("Personne debout"), circ(50, 10, 10) + poly("34,24 66,24 70,60 62,60 60,100 52,100 50,64 48,100 40,100 38,60 30,60"));
add("etres", "marcheur", tt("Personne qui marche"), circ(52, 10, 10) + poly("40,24 62,24 74,56 66,58 60,44 60,64 72,100 62,100 52,72 40,100 30,100 44,62 42,44 36,58 28,54"));
add("etres", "foule", tt("Foule"), Array.from({ length: 7 }, (_, i) => { const x = i * 26 + 13, y = i % 2 ? 26 : 32; return circ(x, y, 11) + smooth([[x - 18, 100], [x - 16, y + 22], [x, y + 14], [x + 16, y + 22], [x + 18, 100]]); }).join(""));
add("etres", "oiseau", tt("Oiseau en vol"), "M0 30C20 10 40 14 50 34C60 14 80 10 100 30C80 24 62 28 50 46C38 28 20 24 0 30Z");
add("etres", "poisson", tt("Poisson"), smooth("0,40 30,14 70,20 96,40 70,60 30,66") + poly("90,40 130,10 122,40 130,70") + circ(22, 34, 4, 4, true));
add("etres", "chat", tt("Chat assis"), smooth("30,100 22,70 30,44 34,26 30,6 40,18 50,16 60,18 70,6 66,26 70,44 78,70 70,100") + band(sample(9, (t) => [70 + 26 * t, 96 - 40 * t * t]), (t) => 4 - 2 * t));
add("etres", "papillon", tt("Papillon"), smooth("50,40 30,4 6,10 8,40 30,50") + smooth("50,40 70,4 94,10 92,40 70,50") + smooth("50,46 28,52 16,80 36,86 50,60") + smooth("50,46 72,52 84,80 64,86 50,60") + rrect(47, 30, 6, 52, 3));
add("etres", "lapin", tt("Lapin"), smooth("30,100 26,70 40,52 34,8 42,6 48,46 54,6 62,8 58,52 72,70 70,100") + circ(76, 92, 8));
add("etres", "cheval", tt("Cheval"), poly("10,40 20,30 70,30 82,12 92,10 100,22 96,30 88,28 84,46 80,58 78,100 72,100 70,62 30,62 26,100 20,100 18,62 8,58 4,70 0,66 6,46"));

// signes
add("signes", "eclair", tt("Éclair"), poly("60,0 20,56 46,56 30,100 82,38 54,38 70,0"));
add("signes", "bulle", tt("Bulle de parole"), smooth(ring(56, 40, 44, 36, 14)) + poly("24,64 6,96 44,72"));
add("signes", "bulle-cri", tt("Bulle criée"), poly(starPts(50, 50, 50, 36, 14)));
add("signes", "bulle-pensee", tt("Bulle de pensée"), smooth(starPts(56, 38, 44, 36, 10).map(([x, y]) => [x, 38 + (y - 38) * 0.8])) + circ(22, 80, 8) + circ(10, 94, 5));
add("signes", "fleche-courbe", tt("Flèche courbe"), band(sample(17, (t) => [10 + 70 * t, 80 - 60 * Math.sin(Math.PI * t * 0.75)]), () => 6) + poly("64,14 100,22 76,48"));
add("signes", "croix", tt("Croix"), rect(36, 0, 28, 100) + rect(0, 36, 100, 28));
add("signes", "croix-x", tt("Croix en X"), poly("0,14 14,0 50,36 86,0 100,14 64,50 100,86 86,100 50,64 14,100 0,86 36,50"));
add("signes", "anneau", tt("Anneau"), circ(50, 50, 50) + circ(50, 50, 30, 30, true));
add("signes", "cible", tt("Cible"), circ(50, 50, 50) + circ(50, 50, 38, 38, true) + circ(50, 50, 28) + circ(50, 50, 16, 16, true) + circ(50, 50, 7));
add("signes", "exclamation", tt("Point d'exclamation"), poly("36,0 64,0 58,66 42,66") + circ(50, 86, 12));
add("signes", "etoile", tt("Étoile"), poly(starPts(50, 50, 50, 20, 5)));
add("signes", "etoile-filante", tt("Étoile filante"), poly(starPts(80, 22, 22, 9, 5)) + poly("66,30 2,92 0,82 60,22"));
add("signes", "note", tt("Note de musique"), circ(26, 82, 16, 12) + rect(38, 6, 6, 78) + poly("44,6 80,20 80,34 44,20"));

// abstrait
for (let i = 0; i < 8; i++) add("abstrait", "tache-" + (i + 1), tt`Tache ${i + 1}`, smooth(blobPts(101 + i * 17, 7 + (i % 4), 0.25 + (i % 3) * 0.12)));
for (let i = 0; i < 4; i++) add("abstrait", "eclabousse-" + (i + 1), tt`Éclaboussure ${i + 1}`, (() => { const r = rng(300 + i * 7), n = 12 + i * 2, pts = Array.from({ length: 2 * n }, (_, j) => { const a = j * Math.PI / n, rr = j % 2 ? 24 + r() * 8 : 34 + r() * 16; return [50 + rr * Math.cos(a), 50 + rr * Math.sin(a)]; }); return smooth(pts) + Array.from({ length: 4 }, () => { const a = r() * 6.28, d = 42 + r() * 8; return circ(50 + d * Math.cos(a), 50 + d * Math.sin(a), 2 + r() * 3); }).join(""); })());
add("abstrait", "etoile-4", tt("Étoile à 4 branches"), poly(starPts(50, 50, 50, 14, 4)));
add("abstrait", "etoile-6", tt("Étoile à 6 branches"), poly(starPts(50, 50, 50, 28, 6)));
add("abstrait", "etoile-8", tt("Étoile à 8 branches"), poly(starPts(50, 50, 50, 30, 8)));
add("abstrait", "eclat", tt("Éclat"), poly(starPts(50, 50, 50, 18, 16)));
add("abstrait", "soleil-doux", tt("Soleil doux"), smooth(starPts(50, 50, 50, 38, 10)));
add("abstrait", "engrenage", tt("Engrenage"), gear(10, 50, 40, 16));
add("abstrait", "engrenage-fin", tt("Engrenage fin"), gear(18, 50, 44, 26));
add("abstrait", "spirale", tt("Spirale"), band(sample(120, (t) => { const a = t * 5.5 * Math.PI, r = 4 + 42 * t; return [50 + r * Math.cos(a), 50 + r * Math.sin(a)]; }), (t) => 1 + 3.5 * t));
add("abstrait", "zigzag", tt("Zigzag"), band([[0, 50], [20, 20], [40, 80], [60, 20], [80, 80], [100, 20], [120, 80], [140, 50]], () => 6));
add("abstrait", "ruban", tt("Ruban ondulé"), band(sample(40, (t) => [160 * t, 40 + 26 * Math.sin(t * 4 * Math.PI)]), () => 9));
add("abstrait", "coup-pinceau", tt("Coup de pinceau"), band(sample(30, (t) => [180 * t, 50 - 14 * Math.sin(Math.PI * t)]), (t) => 3 + 14 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1)), 0.6)));
add("abstrait", "dechirure", tt("Papier déchiré"), (() => { const r = rng(77), top = sample(30, (t) => [160 * t, 20 + r() * 14]); return poly([...top, [160, 100], [0, 100]]); })());
add("abstrait", "pentagone", tt("Pentagone"), poly(ring(50, 50, 50, 50, 5, -Math.PI / 2)));
add("abstrait", "octogone", tt("Octogone"), poly(ring(50, 50, 50, 50, 8, Math.PI / 8)));
add("abstrait", "trapeze", tt("Trapèze"), poly("20,0 80,0 100,100 0,100"));
add("abstrait", "parallelogramme", tt("Parallélogramme"), poly("30,0 130,0 100,70 0,70"));
add("abstrait", "chevron", tt("Chevron"), poly("0,0 30,0 70,50 30,100 0,100 40,50"));
add("abstrait", "chevrons", tt("Chevrons"), [0, 36, 72].map((x) => poly([[x, 0], [x + 24, 0], [x + 56, 50], [x + 24, 100], [x, 100], [x + 32, 50]])).join(""));
add("abstrait", "croissant", tt("Croissant fin"), crescent(46, 14, 0, 40));
add("abstrait", "haricot", tt("Haricot"), smooth("10,40 30,10 70,10 92,36 86,70 60,76 46,58 30,72 12,66"));
add("abstrait", "amibe", tt("Amibe"), smooth("20,30 40,8 52,26 74,10 92,30 78,52 96,76 66,92 50,72 26,94 6,70 22,52"));
add("abstrait", "rose", tt("Rosace"), poly(sample(240, (t) => { const a = t * 2 * Math.PI, r = 14 + 36 * Math.abs(Math.cos(3 * a)); return [50 + r * Math.cos(a), 50 + r * Math.sin(a)]; })));
add("abstrait", "trefle", tt("Trèfle"), circ(50, 28, 22) + circ(28, 62, 22) + circ(72, 62, 22) + poly("46,60 54,60 58,100 42,100"));
add("abstrait", "points", tt("Semis de points"), (() => { const r = rng(9); return Array.from({ length: 18 }, () => circ(8 + r() * 84, 8 + r() * 84, 2 + r() * 6)).join(""); })());
add("abstrait", "eclats-verre", tt("Éclats de verre"), (() => { const r = rng(21); return Array.from({ length: 7 }, () => { const x = 10 + r() * 80, y = 10 + r() * 80, s = 6 + r() * 14; return poly([[x, y - s], [x + s * (0.4 + r()), y + s * r()], [x - s * (0.3 + r() * 0.6), y + s * (0.5 + r() * 0.5)]]); }).join(""); })());
add("abstrait", "cercles", tt("Cercles concentriques"), circ(50, 50, 50) + circ(50, 50, 42, 42, true) + circ(50, 50, 34) + circ(50, 50, 26, 26, true) + circ(50, 50, 18) + circ(50, 50, 10, 10, true));
add("abstrait", "carres", tt("Carrés imbriqués"), rect(0, 0, 100, 100) + rect(10, 10, 80, 80, true) + rect(20, 20, 60, 60) + rect(30, 30, 40, 40, true));
add("abstrait", "losanges", tt("Losanges en chaîne"), [0, 1, 2, 3].map((i) => poly([[i * 40, 30], [i * 40 + 22, 0], [i * 40 + 44, 30], [i * 40 + 22, 60]])).join(""));
add("abstrait", "goutte-double", tt("Gouttes"), "M30 0C30 0 56 40 56 56C56 72 44 80 30 80C16 80 4 72 4 56C4 40 30 0 30 0Z" + "M74 30C74 30 96 60 96 74C96 88 86 96 74 96C62 96 52 88 52 74C52 60 74 30 74 30Z");
add("abstrait", "vague-pleine", tt("Grande vague"), smooth("0,100 10,60 40,20 76,8 100,24 92,40 76,30 66,46 80,70 100,100"));
add("abstrait", "fumee", tt("Volute de fumée"), smooth("40,100 46,80 34,64 40,44 30,28 40,10 56,0 52,16 60,30 50,46 60,62 52,80 56,100"));
add("abstrait", "nuage-orage", tt("Nuage d'orage"), circ(30, 40, 22) + circ(56, 30, 26) + circ(80, 44, 18) + rect(30, 40, 50, 20) + poly("50,56 36,82 50,82 42,100 66,70 52,70 60,56"));

/** Les formes, chacune avec sa boite (en unites de son trace) : { k, n (nom), c (famille), d, box: [x, y, w, h] } */
export const PRESETS = {};
for (const s of L) {
  const nums = s.d.match(/-?\d+(?:\.\d+)?/g).map(Number), xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  PRESETS[s.k] = Object.assign(s, { box: [x0, y0, Math.max(1, Math.max(...xs) - x0), Math.max(1, Math.max(...ys) - y0)] });
}
export const PRESET_CATS = CATS;
/** Le trace d'une forme toute faite recale dans la boite (x0, y0, w, h) ; mx : retournee gauche-droite. */
export function presetPath(k, x0, y0, w, h, mx) {
  const s = PRESETS[k] || PRESETS.arbre, [bx, by, bw, bh] = s.box;
  let i = 0;
  return s.d.replace(/-?\d+(?:\.\d+)?/g, (m) => {
    const v = +m, even = i++ % 2 === 0;
    if (even) { const u = (v - bx) / bw; return (x0 + (mx ? 1 - u : u) * w).toFixed(1); }
    return (y0 + (v - by) / bh * h).toFixed(1);
  });
}
/** Petite image de la forme (pour la palette) */
export function presetThumb(k, size = 44) {
  const s = PRESETS[k], [bx, by, bw, bh] = s.box, pad = Math.max(bw, bh) * 0.06;
  return `<svg viewBox="${bx - pad} ${by - pad} ${bw + 2 * pad} ${bh + 2 * pad}" width="${size}" height="${size}"><path d="${s.d}" fill="currentColor"/></svg>`;
}
