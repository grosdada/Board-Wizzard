// Poignees d'un personnage (calque) choisi, communes aux cases (editor.js) et au montage (montage.js) :
// glisser le personnage = le deplacer ; anneau au centre = orbite ; fleche en haut au milieu = le pencher ;
// une boule par coin = sa taille, le coin oppose restant en place. Taille fixe a l'ecran (u = unites par pixel).

const f2 = (v) => v.toFixed(2);
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------------------------------------------------------------- icones (pixels, centre 0 0)
// Un arc epais termine par une pointe pleine : la pointe est posee sur la tangente au dernier point de l'arc, sa base
// centree sur le trait ; l'ensemble (arc, pointe) est recentre dans la pastille.
const HEAD_L = 6.8, HEAD_W = 4.9;                          // longueur et demi-largeur de la pointe
const arcIcon = (pt, t0, t1, n = 40) => {                  // pt(t) : point de la courbe ; de t0 a t1, pointe au bout
  const P = Array.from({ length: n + 1 }, (_, i) => pt(t0 + (t1 - t0) * i / n));
  const e = P[n], q = pt(t1 - (t1 - t0) * 1e-3), tl = Math.hypot(e[0] - q[0], e[1] - q[1]) || 1;
  const ux = (e[0] - q[0]) / tl, uy = (e[1] - q[1]) / tl;  // tangente au bout, dans le sens du trace
  const H = [[e[0] + ux * HEAD_L, e[1] + uy * HEAD_L], [e[0] - uy * HEAD_W, e[1] + ux * HEAD_W], [e[0] + uy * HEAD_W, e[1] - ux * HEAD_W]];
  const all = P.concat(H), xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const dx = -(Math.min(...xs) + Math.max(...xs)) / 2, dy = -(Math.min(...ys) + Math.max(...ys)) / 2;   // recentrage
  const mv = (p) => f2(p[0] + dx) + " " + f2(p[1] + dy);
  return { arc: P.map((p, i) => (i ? "L" : "M") + mv(p)).join(""), head: "M" + H.map(mv).join("L") + "Z" };
};
// inclinaison : trois quarts de cercle, dans le sens des aiguilles d'une montre
const ICON_R = arcIcon((t) => [7 * Math.cos(t), 7 * Math.sin(t)], -215 * DEG, 45 * DEG);
// orbite : un anneau aplati vu en perspective ; il passe derriere par le haut et revient devant, pointe vers la gauche
const ICON_O = arcIcon((t) => [11.5 * Math.cos(t), 5.6 * Math.sin(t)], 118 * DEG, 412 * DEG);

/** Balisage SVG des poignees. box : {x, y, w, h, cx} du calque (non penche) ; rz : son inclinaison en degres ;
 *  u : unites du repere par pixel d'ecran ; view : rectangle visible {x0, y0, x1, y1} (les poignees se calent sur la
 *  partie visible d'un gros plan) ; bounds : rectangle ou les garder (sinon elles seraient coupees) ; orbit : il tourne ;
 *  attrs : attributs ajoutes au groupe (ex. data-layer). Les poignees portent data-h = move | rot | turn | corner (+ data-c). */
export function handlesSvg({ box, rz = 0, u, view = null, bounds = null, orbit = false, attrs = "" }) {
  const ra = rz * DEG, ca = Math.cos(ra), sa = Math.sin(ra);
  const bcx = box.cx, bcy = box.y + box.h / 2;
  const P = (x, y) => [bcx + x * ca - y * sa, bcy + x * sa + y * ca];       // repere du calque (centre, non penche) -> repere
  const m = 18 * u;
  const inside = (p) => !bounds || (p[0] >= bounds.x0 + m && p[0] <= bounds.x1 - m && p[1] >= bounds.y0 + m && p[1] <= bounds.y1 - m);
  const keep = (p) => (bounds ? [clamp(p[0], bounds.x0 + m, bounds.x1 - m), clamp(p[1], bounds.y0 + m, bounds.y1 - m)] : p);
  // cadre des poignees : la boite, ou sa partie visible (gros plan non penche), jamais moins de 64 px de cote
  let x0 = box.x, x1 = box.x + box.w, y0 = box.y, y1 = box.y + box.h;
  if (!rz && view) {
    const vx0 = Math.max(x0, view.x0), vx1 = Math.min(x1, view.x1), vy0 = Math.max(y0, view.y0), vy1 = Math.min(y1, view.y1);
    if (vx1 > vx0 && vy1 > vy0) { x0 = vx0; x1 = vx1; y0 = vy0; y1 = vy1; }
  }
  const cx = (x0 + x1) / 2 - bcx, cy = (y0 + y1) / 2 - bcy, hw = Math.max((x1 - x0) / 2, 32 * u), hh = Math.max((y1 - y0) / 2, 32 * u);
  const small = Math.min(x1 - x0, y1 - y0) < 70 * u;      // petit personnage : l'orbite passe a cote, le cadre deplace
  const rot = rz ? ` transform="rotate(${f2(rz)} ${f2(bcx)} ${f2(bcy)})"` : "";
  const thin = `stroke-width:${(2 * u).toFixed(4)}px;vector-effect:none`;           // traits fins a tout zoom
  const at = (p, cls, hh_, extra, inner) => { p = keep(p); return `<g class="${cls}" data-h="${hh_}"${extra} transform="translate(${f2(p[0])} ${f2(p[1])}) scale(${u.toFixed(5)})">${inner}</g>`; };
  const ico = (h, r, I) => `<circle r="${r}" data-h="${h}" class="lh-disk"/><path d="${I.arc}" class="lh-ico" data-h="${h}"/><path d="${I.head}" class="lh-ico-head" data-h="${h}"/>`;
  const line = (a, b) => `<line x1="${f2(a[0])}" y1="${f2(a[1])}" x2="${f2(b[0])}" y2="${f2(b[1])}" class="lh-stem" style="${thin}"/>`;
  let o = `<g class="lh"${attrs}>`;
  if (small) o += `<rect x="${f2(bcx + cx - hw)}" y="${f2(bcy + cy - hh)}" width="${f2(2 * hw)}" height="${f2(2 * hh)}" class="lh-move" data-h="move"${rot}/>`;
  o += `<rect x="${f2(box.x)}" y="${f2(box.y)}" width="${f2(box.w)}" height="${f2(box.h)}" class="lh-box"${rot} style="${thin};stroke-dasharray:${(9 * u).toFixed(3)} ${(6 * u).toFixed(3)}"/>`;
  const foot = P(0, box.h / 2);
  o += `<circle cx="${f2(foot[0])}" cy="${f2(foot[1])}" r="${(4 * u).toFixed(3)}" class="lh-foot" style="stroke-width:${u.toFixed(4)}px;vector-effect:none"/>`;
  // inclinaison : en haut au milieu, au bout d'une tige
  const top = P(cx, cy - hh), knob = keep(P(cx, cy - hh - 30 * u));
  o += line(top, knob) + at(knob, "lh-grip lh-rot", "rot", "", ico("rot", 15, ICON_R));
  // taille : une boule par coin (zone de prise plus large que la boule)
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy], i) => {
    o += at(P(cx + sx * hw, cy + sy * hh), "lh-grip lh-corner" + (sx * sy > 0 ? " nw" : " ne"), "corner", ` data-c="${i}"`,
      `<circle r="13" class="lh-hit" data-h="corner" data-c="${i}"/><circle r="6.5" class="lh-ball" data-h="corner" data-c="${i}"/>`);
  });
  // orbite : au centre ; pour un petit personnage, sous les pieds, sinon a droite, sinon a gauche (la ou ca tient)
  if (orbit) {
    const spots = [[P(cx, cy + hh), P(cx, cy + hh + 30 * u)], [P(cx + hw, cy), P(cx + hw + 30 * u, cy)], [P(cx - hw, cy), P(cx - hw - 30 * u, cy)]];
    const pick = small ? spots.find((q) => inside(q[1])) || spots[0] : null, op = small ? keep(pick[1]) : P(cx, cy);
    if (small) o += line(pick[0], op);
    o += at(op, "lh-grip lh-orbit", "turn", "", ico("turn", 17, ICON_O));
  }
  return o + "</g>";
}

/** Debut d'un glisser de coin i (0 haut gauche, 1 haut droit, 2 bas droit, 3 bas gauche) : le coin oppose A de la boite
 *  (penchee de rz), son centre C et sa hauteur h, dans le repere de box. */
export function cornerStart(box, rz, i) {
  const sx = i === 1 || i === 2 ? 1 : -1, sy = i >= 2 ? 1 : -1, ra = (rz || 0) * DEG;
  const C = [box.cx, box.y + box.h / 2], ox = -sx * box.w / 2, oy = -sy * box.h / 2;
  return { A: [C[0] + ox * Math.cos(ra) - oy * Math.sin(ra), C[1] + ox * Math.sin(ra) + oy * Math.cos(ra)], C, h: box.h };
}
/** Facteur de taille d'un glisser de coin : l'avancee de pt le long de la diagonale (depuis A, par le point de depart). */
export function cornerFactor(d, pt) {
  const vx = d.start[0] - d.A[0], vy = d.start[1] - d.A[1], n2 = vx * vx + vy * vy || 1;
  return ((pt[0] - d.A[0]) * vx + (pt[1] - d.A[1]) * vy) / n2;
}
/** Pieds du calque (bas, milieu, avant inclinaison) une fois la taille multipliee par q, le coin A restant en place. */
export function cornerFeet(d, q) {
  const C = [d.A[0] + (d.C[0] - d.A[0]) * q, d.A[1] + (d.C[1] - d.A[1]) * q];
  return [C[0], C[1] + d.h * q / 2];
}
