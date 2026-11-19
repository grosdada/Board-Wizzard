// Portrait-robot : une tete en traces, assemblee a partir de pieces (forme, yeux, sourcils, nez, bouche, cheveux,
// accessoires), qui tourne avec l'orbite du corps sans aucun calcul. Elle est posee sur la tete du mannequin, suivie
// image par image dans head.json.
//
//   face = { forme, yeux, sourcils, nez, bouche, cheveux, lunettes, moustache, barbe, oreilles,
//            k (taille de la tete : 1 = celle du mannequin), dx, dy (decalage, en demi-hauteurs de tete),
//            peau, poil (couleurs ; vides = couleur du corps et couleur du trait), lw (epaisseur du trait, 1 = normal) }
//
// Repere de la tete : centre (0, 0), demi-hauteur 1, y vers le bas. Un point du visage est donne par son azimut a
// (0 = devant, pi/2 = cote droit de l'ecran quand la tete est de face, pi = derriere) et sa hauteur y.
// psi : orientation de la tete en radians (0 = de face, positif = elle tourne vers la gauche de l'ecran, comme l'orbite).

import { sprite, vecReady, variantOf, frameToAngle } from "./model.js";

export const FORMES = { ovale: ["Ovale", 0.76, 2, 2, 0.12], rond: ["Rond", 0.92, 2, 2.2, 0], carre: ["Carré", 0.82, 2.6, 3.2, 0.04],
  long: ["Long", 0.64, 2, 2.3, 0.1], coeur: ["Triangle", 0.86, 2.2, 1.7, 0.3], poire: ["Poire", 0.7, 2, 2.7, -0.28] };
export const YEUX = { points: "Points", ronds: "Ronds", grands: "Grands", amandes: "Amandes", traits: "Traits", arcs: "Rieurs" };
export const SOURCILS = { aucun: "Aucun", droits: "Droits", arques: "Arqués", fronces: "Froncés", tristes: "Tristes", epais: "Épais" };
export const NEZ = { trait: "Trait", rond: "Rond", pointu: "Pointu", patate: "Patate", points: "Deux points", aucun: "Aucun" };
export const BOUCHES = { sourire: "Sourire", neutre: "Neutre", moue: "Moue", ouverte: "Ouverte", grand: "Grand sourire" };
// cheveux : [nom, haut du front, largeur du visage degage (radians), niveau de la nuque (au-dela : peau), pente de la raie]
export const CHEVEUX = { chauve: ["Chauve"], court: ["Courts", -0.55, 1.2, 0.4, 0], raie: ["Raie", -0.5, 1.15, 0.4, 0.2],
  frange: ["Frange", -0.26, 1.08, 0.4, 0], degarni: ["Dégarni", -1.3, 1.1, 0.35, 0], carre: ["Carré", -0.3, 1.0, 2, 0],
  long: ["Longs", -0.5, 0.98, 2, 0.12], chignon: ["Chignon", -0.55, 1.15, 2, 0], queue: ["Queue", -0.55, 1.15, 2, 0],
  afro: ["Afro", -0.42, 1.05, 2, 0], herisse: ["Hérissés", -0.6, 1.2, 0.4, 0], crete: ["Crête"] };
export const LUNETTES = { aucune: "Aucune", rondes: "Rondes", carrees: "Carrées" };
export const DEFAUT = { forme: "ovale", yeux: "points", sourcils: "droits", nez: "trait", bouche: "sourire", cheveux: "court",
  lunettes: "aucune", moustache: false, barbe: false, oreilles: true, k: 1.15, dx: 0, dy: 0, peau: "", poil: "", lw: 1 };
export const PIECES = [["forme", "Tête", FORMES], ["cheveux", "Cheveux", CHEVEUX], ["yeux", "Yeux", YEUX], ["sourcils", "Sourcils", SOURCILS],
  ["nez", "Nez", NEZ], ["bouche", "Bouche", BOUCHES], ["lunettes", "Lunettes", LUNETTES]];
const nameOf = (v) => (Array.isArray(v) ? v[0] : v);
export const labelOf = (table, key) => nameOf(table[key]);

/** Un visage tire au hasard (meme graine = meme visage). */
export function hasard(seed = Math.random() * 1e9) {
  let s = Math.floor(seed) % 2147483647 || 7;
  const rnd = () => (s = s * 48271 % 2147483647) / 2147483647, pick = (t) => { const k = Object.keys(t); return k[Math.floor(rnd() * k.length)]; };
  return Object.assign({}, DEFAUT, { forme: pick(FORMES), yeux: pick(YEUX), sourcils: pick(SOURCILS), nez: pick(NEZ), bouche: pick(BOUCHES),
    cheveux: pick(CHEVEUX), lunettes: rnd() < 0.25 ? pick(LUNETTES) : "aucune", moustache: rnd() < 0.15, barbe: rnd() < 0.12 });
}

const PI = Math.PI, f1 = (v) => (Math.round(v * 10) / 10).toString();
const norm = (a) => { a = (a + PI) % (2 * PI); return (a < 0 ? a + 2 * PI : a) - PI; };

// ---- suivi de la tete du corps : head.json a cote de l'orbite, charge une fois puis garde
const heads = new Map();
/** Tete du mannequin dans l'image affichee : { cx, top, h } en fractions de l'image, ou null (pas encore charge, ou pas de suivi). */
export function headFrame(sp, onReady) {
  if (!sp || !sp.head) return null;
  let e = heads.get(sp.head);
  if (!e) {
    e = { data: null, wait: [] };
    heads.set(sp.head, e);
    fetch(sp.head).then((r) => (r.ok ? r.json() : null)).then((d) => {
      const fr = d && (d.frames || []).filter(Boolean);
      if (fr && fr.length) { const hs = fr.map((q) => q[3]).sort((a, b) => a - b); e.data = { frames: d.frames, h: hs[Math.floor(hs.length / 2)] }; } else e.data = false;
      e.wait.splice(0).forEach((f) => f());
    }).catch(() => { e.data = false; });
    if (heads.size > 60) heads.delete(heads.keys().next().value);
  }
  if (e.data === null) { if (onReady && e.wait.length < 4) e.wait.push(onReady); return null; }
  if (!e.data) return null;
  const q = e.data.frames[sp.i] || e.data.frames.find(Boolean);
  return { cx: q[0], top: q[1] - q[3] / 2, h: e.data.h };       // le haut du crane est stable ; la hauteur, non (le cou) : on prend la mediane de l'orbite
}
export function headReady(sp) { return new Promise((ok) => { const f = headFrame(sp, () => ok(headFrame(sp))); if (f || !sp || !sp.head || (heads.get(sp.head) || {}).data === false) ok(f); }); }

// ---- traces
const line = (pts, close) => pts.map((p, i) => (i ? "L" : "M") + f1(p[0]) + " " + f1(p[1])).join("") + (close ? "Z" : "");
function curve(pts, close) {                                 // courbe douce passant pres des points (milieux relies par des quadratiques)
  const n = pts.length;
  if (n < 3) return line(pts, close);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d;
  if (close) {
    const m0 = mid(pts[n - 1], pts[0]);
    d = "M" + f1(m0[0]) + " " + f1(m0[1]);
    for (let i = 0; i < n; i++) { const m = mid(pts[i], pts[(i + 1) % n]); d += "Q" + f1(pts[i][0]) + " " + f1(pts[i][1]) + " " + f1(m[0]) + " " + f1(m[1]); }
    return d + "Z";
  }
  d = "M" + f1(pts[0][0]) + " " + f1(pts[0][1]);
  for (let i = 1; i < n - 1; i++) { const m = i === n - 2 ? pts[n - 1] : mid(pts[i], pts[i + 1]); d += "Q" + f1(pts[i][0]) + " " + f1(pts[i][1]) + " " + f1(m[0]) + " " + f1(m[1]); }
  return d;
}

/**
 * Les traces de la tete. hd : { cx, top, h } de headFrame ; w, h : taille du dessin du corps (ses unites) ;
 * o : { peau, trait (couleurs du corps), lw (epaisseur de base), bouche (faux : sans la bouche, le lip sync la dessine) }.
 * Rend { under, over, mouth } : under se dessine avant le corps (cheveux longs vus de face), over par-dessus ;
 * chaque trace = { d, fill, stroke, sw }. mouth = { x, y, s, vis } : ou poser la bouche du lip sync (unites du dessin).
 */
export function faceOps(face, hd, w, h, psi = 0, o = {}) {
  psi = norm(psi);
  const F = Object.assign({}, DEFAUT, face), sh = FORMES[F.forme] || FORMES.ovale;
  const skin = /^#[0-9a-f]{6}$/i.test(F.peau || "") ? F.peau : (o.peau || "#ffffff"), ink = o.trait || "#111111";
  const hair = /^#[0-9a-f]{6}$/i.test(F.poil || "") ? F.poil : ink;
  const B = hd.h * h * (F.k || 1.15) / 2;                    // demi-hauteur de la tete, dans les unites du dessin
  const X0 = hd.cx * w + (F.dx || 0) * B, Y0 = hd.top * h + hd.h * h - B + (F.dy || 0) * B;   // le menton reste sur le cou : la tete grossit vers le haut
  const sw = Math.max(0.6, (o.lw || h * 0.0055) * (F.lw || 1));
  const sn = Math.sin(psi), cs = Math.cos(psi), deep = 1 + 0.1 * sn * sn;                    // de profil, le crane est un peu plus profond
  const [, W, nt, nb, jaw] = sh;
  const hw = (y) => { const a = Math.min(1, Math.abs(y)), n = y < 0 ? nt : nb; return W * Math.pow(Math.max(0, 1 - Math.pow(a, n)), 1 / n) * (y > 0 ? 1 - jaw * y : 1); };
  const cx = (y) => sn * W * (0.1 - 0.3 * Math.pow(Math.max(0, y), 1.5));                  // de profil : crane en arriere, menton en avant
  const P = (a, y, r = 1) => { const yy = Math.max(-0.999, Math.min(0.999, y)); return [X0 + B * (cx(y) + hw(yy) * r * deep * Math.sin(a - psi)), Y0 + B * y]; };
  const Z = (a) => Math.cos(a - psi);                         // > 0 : du cote visible
  const V = (a, y, r = 1) => { const d = norm(a - psi); return P(psi + Math.max(-PI / 2, Math.min(PI / 2, d)), y, r); };   // ramene au bord si c'est derriere
  const under = [], pre = [], over = [];
  const put = (list, d, fill, stroke, k = 1) => { if (d) list.push({ d, fill: fill || "none", stroke: stroke || "none", sw: stroke ? sw * k : 0 }); };
  const ell = (a0, y0, ra, ry, n = 14) => { const p = []; for (let i = 0; i < n; i++) { const t = i / n * 2 * PI; p.push(V(a0 + ra * Math.cos(t), y0 + ry * Math.sin(t))); } return curve(p, true); };
  const blob = (x, y, rx, ry, n = 14) => { const p = []; for (let i = 0; i < n; i++) { const t = i / n * 2 * PI; p.push([X0 + B * (x + rx * Math.cos(t)), Y0 + B * (y + ry * Math.sin(t))]); } return curve(p, true); };

  // contour de la tete
  const rows = 26, ys = Array.from({ length: rows + 1 }, (_, i) => -Math.cos(i / rows * PI));
  const outline = ys.map((y) => P(psi + PI / 2, y)).concat(ys.slice().reverse().map((y) => P(psi - PI / 2, y)));
  const cv = CHEVEUX[F.cheveux] || CHEVEUX.court, hairy = cv.length > 1;

  // ---- cheveux qui depassent du crane
  const back = cs < 0;                                        // on voit l'arriere de la tete
  if (F.cheveux === "long" || F.cheveux === "carre") {
    const bot = F.cheveux === "long" ? 1.75 : 1.02, hwid = W * 1.08, p = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10, y = -0.55 + t * (bot + 0.55); p.push([X0 + B * (cx(-0.2) + hwid * (0.86 + 0.14 * Math.sin(t * PI))), Y0 + B * y]); }
    for (let i = 10; i >= 0; i--) { const t = i / 10, y = -0.55 + t * (bot + 0.55); p.push([X0 + B * (cx(-0.2) - hwid * (0.86 + 0.14 * Math.sin(t * PI))), Y0 + B * y]); }
    put(back ? pre : under, curve(p, true), hair, ink);
    if (back) put(over, curve(p, true), hair, ink);           // de dos, ils couvrent la nuque et les epaules
  }
  if (F.cheveux === "afro") put(pre, blob(cx(-0.3), -0.34, W * 1.5, 1.08, 18), hair, ink);
  if (F.cheveux === "chignon") put(back ? over : pre, blob(cx(-0.8) + sn * W * 0.62, -0.98 + 0.12 * Math.abs(cs), 0.34, 0.32), hair, ink);
  if (F.cheveux === "queue") {
    const x = cx(-0.5) + sn * W * 1.02, s2 = 0.2;
    put(back ? over : pre, curve([[x, -0.72], [x + s2, -0.45], [x + s2 * 0.9, 0.3], [x, 0.95], [x - s2 * 0.9, 0.3], [x - s2, -0.45]].map(([a, b]) => [X0 + B * a, Y0 + B * b]), true), hair, ink);
  }
  if (F.cheveux === "herisse") {
    const p = [];
    for (let i = 0; i <= 14; i++) { const t = -0.5 * PI + (i / 14 - 0.5) * PI * 1.25, r = i % 2 ? 1.32 : 1.0; p.push([X0 + B * (cx(-0.5) + W * deep * r * Math.cos(t)), Y0 + B * (-0.1 + r * Math.sin(t) * 0.95)]); }
    put(pre, line(p, true), hair, ink);
  }
  if (F.cheveux === "crete") {
    const L = W * (0.12 + 0.82 * Math.abs(sn)), p = [], n = 8;
    for (let i = 0; i <= n; i++) { const t = i / n, x = cx(-0.9) - L + 2 * L * t, base = -Math.sqrt(Math.max(0, 1 - Math.pow((x - cx(-0.9)) / W, 2))) * 0.97; p.push([X0 + B * x, Y0 + B * (base - (i % 2 ? 0.42 : 0.1))]); }
    p.push([X0 + B * (cx(-0.9) + L), Y0 + B * -0.55], [X0 + B * (cx(-0.9) - L), Y0 + B * -0.55]);
    put(pre, line(p, true), hair, ink);
  }
  // oreilles : derriere le crane, elles depassent sur les cotes
  if (F.oreilles !== false) for (const s of [-1, 1]) { const c = P(s * PI / 2, 0.08, 0.97); put(pre, blobAt(c, 0.13 * B, 0.2 * B), skin, ink); }
  // nez vu de trois-quarts dos : il depasse encore, le crane le cache en partie
  const nose = () => {
    if (F.nez === "aucun" || cs < -0.3) return;
    const list = cs < 0.05 ? pre : over, p = { trait: 0.2, rond: 0.16, pointu: 0.36, patate: 0.24, points: 0 }[F.nez] ?? 0.2, fl = 0.1 * cs * cs;
    if (F.nez === "points") { if (cs > 0.25) for (const s of [-1, 1]) put(list, ell(s * 0.09, 0.3, 0.03, 0.03, 8), ink); return; }
    const X = (r, y, k) => [X0 + B * (cx(y) - hw(y) * r * deep * sn + fl * k), Y0 + B * y];
    if (F.nez === "rond") { const c = X(1 + p * 0.55, 0.27, 0.2); put(list, blobAt(c, (0.13 + 0.03 * Math.abs(sn)) * B, 0.13 * B), skin, ink); return; }
    const a = X(0.99, 0.0, 0), t = X(1 + p, F.nez === "patate" ? 0.26 : 0.3, 1), b = X(0.99, 0.4, 0.15), a2 = X(0.86, 0.0, -0.5), b2 = X(0.86, 0.4, -0.5);
    put(list, line([a2, a, t, b, b2], true), skin);          // aplat couleur peau : il efface le contour de la tete sous le nez
    put(list, F.nez === "patate" ? curve([a, [(a[0] + t[0]) / 2, (a[1] + t[1]) / 2 + 0.05 * B], t, [t[0], t[1] + 0.1 * B], b]) : line([a, t, b]), "", ink);
  };
  if (cs < 0.05) nose();

  // ---- crane : couleur des cheveux, puis le visage degage par-dessus (rien a decouper : tout est calcule sur la sphere)
  put(pre, curve(outline, true), hairy ? hair : skin, ink);
  if (hairy) {
    const [, yh, As, yn, tilt] = cv, A = (y) => (y >= yn ? 9 : As * Math.sqrt(Math.max(0, Math.min(1, (y - yh) / 0.42))));
    for (const turn of [-2 * PI, 0, 2 * PI]) {               // la partie visible du visage : un ou deux morceaux (les joues, vues de dos)
      const L = [], R = [];
      for (let i = 0; i <= 40; i++) {
        const y = -0.999 + i / 40 * 1.998, aL = -A(y + (tilt || 0) * 0.5), aR = A(y - (tilt || 0) * 0.5);
        if (aR - aL < 0.02) { if (L.length) break; continue; }
        const lo = Math.max(aL, psi - PI / 2 + turn), hi = Math.min(aR, psi + PI / 2 + turn);
        if (aR - aL > 6) { if (turn) continue; L.push(P(psi - PI / 2, y)); R.push(P(psi + PI / 2, y)); continue; }
        if (hi - lo < 0.01) { if (L.length) break; continue; }
        L.push(P(lo, y)); R.push(P(hi, y));
      }
      if (L.length > 1) put(pre, curve(R.concat(L.reverse()), true), skin, ink, 0.8);
    }
  }
  const seen = (a, m = 0.08) => Z(a) > m;
  // barbe : le bas du visage, couleur des cheveux
  if (F.barbe && cs > -0.6) {
    const L = [], R = [];
    for (let i = 0; i <= 14; i++) { const y = 0.32 + i / 14 * 0.667, A = 1.35 * Math.min(1, 0.55 + (y - 0.32) * 3), lo = Math.max(-A, psi - PI / 2), hi = Math.min(A, psi + PI / 2); if (hi - lo > 0.01) { L.push(P(lo, y)); R.push(P(hi, y)); } }
    if (L.length > 1) put(over, curve(R.concat(L.reverse()), true), hair, ink, 0.8);
  }
  // ---- yeux, sourcils
  const eu = 0.42, ey = 0.0;
  for (const s of [-1, 1]) {
    const a0 = s * Math.asin(eu);
    if (!seen(a0)) continue;
    const yx = F.yeux;
    if (yx === "ronds") { put(over, ell(a0, ey, 0.2, 0.17), "#ffffff", ink, 0.8); put(over, ell(a0 + 0.03 * s * -1, ey + 0.02, 0.07, 0.07, 8), ink); }
    else if (yx === "grands") put(over, ell(a0, ey, 0.085, 0.15), ink);
    else if (yx === "amandes") { put(over, curve([V(a0 - 0.22, ey), V(a0, ey - 0.12), V(a0 + 0.22, ey), V(a0, ey + 0.1)], true), "#ffffff", ink, 0.8); put(over, ell(a0, ey - 0.005, 0.065, 0.07, 8), ink); }
    else if (yx === "traits") put(over, line([V(a0 - 0.17, ey), V(a0 + 0.17, ey)]), "", ink, 1.15);
    else if (yx === "arcs") put(over, curve([V(a0 - 0.17, ey + 0.05), V(a0, ey - 0.09), V(a0 + 0.17, ey + 0.05)]), "", ink, 1.15);
    else put(over, ell(a0, ey, 0.075, 0.08, 10), ink);
    const by = ey - 0.27, t = { droits: 0, arques: 0, fronces: 0.09, tristes: -0.08, epais: 0 }[F.sourcils];
    if (F.sourcils !== "aucun" && t != null) {
      const p = [V(a0 - 0.22, by - s * t), V(a0, by - (F.sourcils === "arques" ? 0.09 : 0)), V(a0 + 0.22, by + s * t)];
      put(over, F.sourcils === "arques" ? curve(p) : line([p[0], p[2]]), "", ink, F.sourcils === "epais" ? 2.4 : 1.25);
    }
    if (F.lunettes !== "aucune") {
      const ra = 0.27, ry = 0.23;
      put(over, F.lunettes === "carrees" ? line([V(a0 - ra, ey - ry), V(a0 + ra, ey - ry), V(a0 + ra, ey + ry), V(a0 - ra, ey + ry)], true) : ell(a0, ey, ra, ry, 16), "", ink, 1.2);
      const br = []; for (let i = 0; i <= 6; i++) { const a = a0 + s * (ra + (PI / 2 - Math.abs(a0) - ra) * i / 6); if (seen(a, 0)) br.push(P(a, ey - 0.03)); }
      if (br.length > 1) put(over, line(br), "", ink, 1.1);   // branche, jusqu'a l'oreille
    }
  }
  if (F.lunettes !== "aucune" && seen(0, -0.2)) put(over, line([V(-Math.asin(eu) + 0.27, ey - 0.03), V(Math.asin(eu) - 0.27, ey - 0.03)]), "", ink, 1.2);
  if (cs >= 0.05) nose();
  // ---- bouche
  const my = 0.58, mwid = 0.3, mvis = cs > -0.12;
  const mc = P(0, my, 0.97), mouth = { x: X0 + B * (cx(my) - hw(my) * deep * sn * 0.82), y: mc[1], s: B * 0.5, vis: mvis };
  if (F.moustache && mvis) put(over, curve([V(-0.3, 0.5), V(-0.12, 0.4), V(0, 0.43), V(0.12, 0.4), V(0.3, 0.5), V(0.1, 0.48), V(0, 0.5), V(-0.1, 0.48)], true), hair, ink, 0.6);
  if (o.bouche !== false && mvis) {
    const col = F.barbe && hair === ink ? skin : ink, bo = F.bouche;
    if (bo === "neutre") put(over, line([V(-mwid * 0.8, my), V(mwid * 0.8, my)]), "", col, 1.2);
    else if (bo === "moue") put(over, curve([V(-mwid * 0.8, my + 0.06), V(0, my - 0.05), V(mwid * 0.8, my + 0.06)]), "", col, 1.2);
    else if (bo === "ouverte") put(over, ell(0, my + 0.02, 0.14, 0.1, 12), col);
    else if (bo === "grand") put(over, curve([V(-mwid, my - 0.06), V(mwid, my - 0.06), V(mwid * 0.6, my + 0.14), V(-mwid * 0.6, my + 0.14)], true), "#ffffff", col, 1.1);
    else put(over, curve([V(-mwid, my - 0.05), V(0, my + 0.09), V(mwid, my - 0.05)]), "", col, 1.2);
  }
  // oreille vue de cote : un petit C sur le crane
  if (F.oreilles !== false && !hairy || (hairy && cv[3] < 1 && F.oreilles !== false)) for (const s of [-1, 1]) {
    if (Z(s * PI / 2) > 0.45 && cs > -0.45) { const c = P(s * PI / 2, 0.08, 0.2 + 0.75 * (1 - Z(s * PI / 2))); put(over, blobAt(c, 0.12 * B, 0.2 * B), skin, ink, 0.8); }
  }
  return { under, over: pre.concat(over), mouth };

  function blobAt(c, rx, ry, n = 12) { const p = []; for (let i = 0; i < n; i++) { const t = i / n * 2 * PI; p.push([c[0] + rx * Math.cos(t), c[1] + ry * Math.sin(t)]); } return curve(p, true); }
}

/** Balisage SVG d'une liste de traces. attr : attributs ajoutes a chaque trace (data-layer…). */
export function opsSvg(ops, attr = "") {
  return ops.map((q) => `<path d="${q.d}" fill="${q.fill}" stroke="${q.stroke}" stroke-width="${f1(q.sw)}" stroke-linejoin="round" stroke-linecap="round"${attr}/>`).join("");
}
/** Les memes traces dans un canvas (le contexte est deja dans le repere du dessin). */
export function opsCanvas(ctx, ops) {
  for (const q of ops) {
    const p = new Path2D(q.d);
    if (q.fill !== "none") { ctx.fillStyle = q.fill; ctx.fill(p); }
    if (q.stroke !== "none" && q.sw > 0) { ctx.strokeStyle = q.stroke; ctx.lineWidth = q.sw; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke(p); }
  }
}

/** La tete d'un element pour l'image affichee, ou null (pas un assemblage, ou suivi pas encore charge : onReady rappellera). */
export function faceFor(item, sp, vf, psi, o, onReady) {
  if (!item || !item.face || !vf) return null;
  const hd = headFrame(sp, onReady);
  return hd ? faceOps(item.face, hd, vf.w, vf.h, psi, o) : null;
}

/** Dessin complet (corps + tete) d'un personnage assemble, pour une vignette ou un apercu : balisage <svg>, ou "" si pas pret. */
export async function portraitSvg(item, vid = "base", f = 0, o = {}) {
  const sp = sprite(item, vid, f), vf = await vecReady(sp);
  if (!vf) return "";
  const hd = item.face ? await headReady(sp) : null, orb = (variantOf(item, vid) || {}).orbit;
  const fo = hd ? faceOps(item.face, hd, vf.w, vf.h, orb ? frameToAngle(orb, sp.i) * Math.PI / 180 : 0, {}) : { under: [], over: [] };
  const mx = vf.w * 0.3, top = o.crop ? vf.h * 0.06 : vf.h * 0.1, hh = o.crop ? vf.h * o.crop : vf.h;
  return `<svg viewBox="${f1(-mx)} ${f1(-top)} ${f1(vf.w + 2 * mx)} ${f1(hh + top)}" preserveAspectRatio="xMidYMax meet">${opsSvg(fo.under)}<path d="${vf.body}" fill="#fff"/>` +
    `<path d="${vf.ink}" fill="#111" fill-rule="evenodd"/>${opsSvg(fo.over)}</svg>`;
}
