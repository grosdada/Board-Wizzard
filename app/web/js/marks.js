// Indications de storyboard posees sur une case : fleches (droite, courbe, dessinee), fleche de rotation, cadre en
// pointilles. Une indication : { id, type, pts: [[x, y]...] en fraction de la case, color, w (epaisseur), dash, both, cw,
// ol (false : sans contour), ow (taille du contour), oc (couleur du contour, sinon blanc, ou noir sur un trait blanc),
// pv (rotation : perspective en degres, 0 = cercle vu de face), pa (rotation : inclinaison de l'ellipse, en degres) }.
//   arrow : depart, arrivee            curve : depart, point de passage, arrivee      free : trace a main levee
//   turn  : centre, depart de l'arc    frame : deux coins opposes
import { tt, tr } from "./i18n.js";

export const MARKS = {
  arrow: [tt("Flèche"), "→"], curve: [tt("Flèche courbe"), "⤴"], free: [tt("Flèche dessinée"), "✎"],
  turn: [tt("Rotation"), "↻"], frame: [tt("Cadre pointillé"), "⬚"],
};
export const MARK_COLORS = { "#111111": tt("Noir"), "#ffffff": tt("Blanc"), "#d6262b": tt("Rouge"), "#1d5fd6": tt("Bleu") };
const TURN_SWEEP = 285 * Math.PI / 180;

const px = (bb, p) => [bb.x0 + p[0] * bb.w, bb.y0 + p[1] * bb.h];
const f1 = (n) => n.toFixed(1);

function headPts(tip, dir, size, wide = 0.48) {      // pointe pleine : triangle un peu creuse
  const n = Math.hypot(dir[0], dir[1]) || 1, ux = dir[0] / n, uy = dir[1] / n;
  const bx = tip[0] - ux * size, by = tip[1] - uy * size, wx = -uy * size * wide, wy = ux * size * wide;
  const nx = tip[0] - ux * size * 0.72, ny = tip[1] - uy * size * 0.72;
  return [tip, [bx + wx, by + wy], [nx, ny], [bx - wx, by - wy]];
}
const ptsStr = (Q) => Q.map((q) => `${f1(q[0])},${f1(q[1])}`).join(" ");
const head = (tip, dir, size) => ptsStr(headPts(tip, dir, size));

/** Contour d'une indication : null si retire, sinon { color, extra (largeur ajoutee, en unites de page) }. */
export function markOutline(m, k) {
  if (m.ol === false) return null;
  const col = m.color || "#111111";
  return { color: m.oc || (col === "#ffffff" ? "#111111" : "#ffffff"), extra: 5 * k * (m.ow ?? 1) };
}

/** Geometrie d'une indication, en pixels de page : { d, heads: [points], dash, width, handles: [[x, y, index]] } */
export function markShape(m, bb, k) {
  const w = (m.w || 1), width = 5 * k * w, hs = 30 * k * Math.sqrt(w);
  const P = (m.pts || []).map((p) => px(bb, p));
  const out = { d: "", heads: [], dash: m.dash ? `${f1(width * 3)} ${f1(width * 2.2)}` : null, width, handles: [] };
  if (P.length < 2) return out;
  const back = (tip, dir) => [tip[0] - dir[0], tip[1] - dir[1]];
  const cut = (tip, dir, len) => { const n = Math.hypot(dir[0], dir[1]) || 1; return [tip[0] - dir[0] / n * len, tip[1] - dir[1] / n * len]; };
  if (m.type === "frame") {
    const x = Math.min(P[0][0], P[1][0]), y = Math.min(P[0][1], P[1][1]), ww = Math.abs(P[1][0] - P[0][0]), hh = Math.abs(P[1][1] - P[0][1]);
    out.d = `M ${f1(x)} ${f1(y)} h ${f1(ww)} v ${f1(hh)} h ${f1(-ww)} Z`;
    out.dash = m.dash === false ? null : `${f1(width * 3)} ${f1(width * 2.2)}`;
    out.handles = [[P[0][0], P[0][1], 0], [P[1][0], P[1][1], 1]];
    return out;
  }
  if (m.type === "turn") {
    // trace dans le plan du cercle, puis mis en perspective : ecrase par cos(pv), tourne de pa ; la pointe suit le meme plan
    const c = P[0], cv = Math.cos(Math.min(85, Math.max(0, m.pv || 0)) * Math.PI / 180), pa = (m.pa || 0) * Math.PI / 180;
    const ca = Math.cos(pa), sa = Math.sin(pa);
    const T = (q) => { const v = q[1] * cv; return [c[0] + q[0] * ca - v * sa, c[1] + q[0] * sa + v * ca]; };
    const dx = P[1][0] - c[0], dy = P[1][1] - c[1], lu = dx * ca + dy * sa, lv = (-dx * sa + dy * ca) / cv;
    const r = Math.hypot(lu, lv) || 1, a0 = Math.atan2(lv, lu);
    const s = m.cw === false ? -1 : 1, a1 = a0 + s * TURN_SWEEP, at = (a) => [Math.cos(a) * r, Math.sin(a) * r];
    const beta = Math.min(0.9, hs / r), stop = a1 - s * beta * 0.62;          // la pointe suit la corde : elle epouse l'arc
    const steps = Math.max(12, Math.ceil(Math.abs(stop - a0) / 0.08));
    let d = "";
    for (let i = 0; i <= steps; i++) { const q = T(at(a0 + (stop - a0) * i / steps)); d += (i ? " L " : "M ") + f1(q[0]) + " " + f1(q[1]); }
    out.d = d;
    // pointe a plat a l'ecran (sinon elle s'efface en perspective), le long de la corde ; plus grosse devant, plus petite au fond
    const tip = T(at(a1)), base = T(at(a1 - s * beta)), depth = 1 + 0.35 * Math.sqrt(1 - cv * cv) * Math.sin(a1);
    out.heads.push(ptsStr(headPts(tip, [tip[0] - base[0], tip[1] - base[1]], hs * 1.1 * depth, 0.5)));
    out.handles = [[c[0], c[1], 0], [P[1][0], P[1][1], 1]];
    return out;
  }
  let first, last, d0, d1;
  if (m.type === "curve" && P.length >= 3) {
    const c = [2 * P[1][0] - (P[0][0] + P[2][0]) / 2, 2 * P[1][1] - (P[0][1] + P[2][1]) / 2];   // la courbe passe par P[1]
    d1 = [P[2][0] - c[0], P[2][1] - c[1]]; d0 = [P[0][0] - c[0], P[0][1] - c[1]];
    first = m.both ? cut(P[0], d0, hs * 0.7) : P[0]; last = cut(P[2], d1, hs * 0.7);
    out.d = `M ${f1(first[0])} ${f1(first[1])} Q ${f1(c[0])} ${f1(c[1])} ${f1(last[0])} ${f1(last[1])}`;
    out.heads.push(head(P[2], d1, hs));
    if (m.both) out.heads.push(head(P[0], d0, hs));
    out.handles = P.map((p, i) => [p[0], p[1], i]);
    return out;
  }
  const n = P.length, far = (i, step) => { let j = i; while (j + step >= 0 && j + step < n && Math.hypot(P[j][0] - P[i][0], P[j][1] - P[i][1]) < hs * 0.9) j += step; return P[j]; };
  const a = far(n - 1, -1), b = far(0, 1);
  d1 = [P[n - 1][0] - a[0], P[n - 1][1] - a[1]]; d0 = [P[0][0] - b[0], P[0][1] - b[1]];
  const Q = P.slice();
  Q[n - 1] = cut(P[n - 1], d1, hs * 0.7);
  if (m.both) Q[0] = cut(P[0], d0, hs * 0.7);
  if (n === 2) out.d = `M ${f1(Q[0][0])} ${f1(Q[0][1])} L ${f1(Q[1][0])} ${f1(Q[1][1])}`;
  else {                                              // trace lisse : chaque point sert de controle, on passe par les milieux
    let d = `M ${f1(Q[0][0])} ${f1(Q[0][1])}`;
    for (let i = 1; i < n - 1; i++) d += ` Q ${f1(Q[i][0])} ${f1(Q[i][1])} ${f1((Q[i][0] + Q[i + 1][0]) / 2)} ${f1((Q[i][1] + Q[i + 1][1]) / 2)}`;
    out.d = d + ` L ${f1(Q[n - 1][0])} ${f1(Q[n - 1][1])}`;
  }
  out.heads.push(head(P[n - 1], d1, hs));
  if (m.both) out.heads.push(head(P[0], d0, hs));
  out.handles = [[P[0][0], P[0][1], 0], [P[n - 1][0], P[n - 1][1], n - 1]];
  return out;
}

/** Indication neuve, posee autour d'un point de la case (fraction). */
export function newMark(type, id, at) {
  const [x, y] = at || [0.5, 0.5];
  const m = { id, type, color: "#111111", w: 1 };
  if (type === "arrow") m.pts = [[x - 0.15, y], [x + 0.15, y]];
  else if (type === "curve") m.pts = [[x - 0.16, y + 0.05], [x, y - 0.07], [x + 0.16, y + 0.05]];
  else if (type === "free") m.pts = [[x - 0.16, y], [x - 0.05, y - 0.06], [x + 0.05, y + 0.06], [x + 0.16, y]];
  else if (type === "turn") m.pts = [[x, y], [x + 0.09, y]];
  else m.pts = [[x - 0.2, y - 0.2], [x + 0.2, y + 0.2]];
  return m;
}

/** Allege un trace a main levee : au plus `max` points, regulierement repartis. */
export function thin(pts, max = 28) {
  if (pts.length <= max) return pts;
  const out = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * (pts.length - 1) / (max - 1))]);
  return out;
}
