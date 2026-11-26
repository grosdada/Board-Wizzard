// « Recalculer la perspective » depuis l'orbite de la case : la camera de l'orbite a tourne de yaw degres autour de la
// scene. Meme reconstruction que la vue 3D du montage (montage.js : rebuild3, camera3, recalc3, groundRecalc), appliquee
// aux calques fixes de la case : chaque element prend la place, la taille et la profondeur vues par la camera tournee, et
// l'image de sa tournette qui correspond a ce nouvel angle. Garder les deux calculs identiques.
import { sprite, variantOf, depthOf, clamp, frameToAngle, angleToFrame } from "./model.js";
import { estimateHorizon, groundMap } from "./ground.js";

const FOV0 = 53.13, D0 = 0.5 / Math.tan(FOV0 * Math.PI / 360), ZD = 1.2;
const f3 = (x) => +(+x).toFixed(3);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** pan : la case telle qu'a l'image 0 de l'orbite ; ratio : hauteur / largeur de la case ; yaw en degres.
 *  Rend { out: [{ l, x, y, s, f?, d }], skipped, ground: { m, hz } | null }, sans rien modifier. */
export function orbitPerspective(pan, ratio, bank, yaw, opt = {}) {
  // opt (orbite sans generation, main.js panelOrbitLocal) : glue = les pieds donnent la profondeur meme sans carte de sol ;
  // tele = la camera recule d'autant et sa focale s'allonge d'autant (memes tailles au milieu de la scene, moins de
  // perspective : tout pres, un personnage devenait geant au demi-tour)
  const tele = Math.max(1, +opt.tele || 1);
  const hw = ratio, hz = pan.ground && pan.ground.hz != null ? pan.ground.hz : estimateHorizon(pan), cards = [];
  (pan.layers || []).forEach((l, i) => {
    const it = bank.get(l.item), sp = it && sprite(it, l.v, l.f || 0);
    if (!sp) return;
    const z = depthOf(pan, i) * ZD, zc = z + D0, Hc = (l.s || 0.5) * hw * zc / D0;
    cards.push({ l, it, z, X: 0.5 + ((l.x ?? 0.5) - 0.5) * zc / D0, Hc, sp, yf: l.y ?? 0.9, zc });
  });
  const eyes = cards.map((c) => (c.yf - hz) * hw * c.zc / D0).filter((v) => v > 0.01).sort((a, b) => a - b);
  const camY = eyes.length ? eyes[Math.floor(eyes.length / 2)] : 0.3 * hw;
  const glue = !!(opt.glue || (pan.ground && pan.ground.on));
  for (const c of cards) {
    const below = (c.yf - hz) * hw;
    if (glue && !c.l.fly && below > 0.004) {
      const zc = camY * D0 / below;
      c.X = 0.5 + ((c.l.x ?? 0.5) - 0.5) * zc / D0; c.Hc = (c.l.s || 0.5) * hw * zc / D0;
      c.zc = zc; c.z = zc - D0; c.Y = 0;
    } else c.Y = camY - below * c.zc / D0;
  }
  const zMid = cards.length ? cards.reduce((a, c) => a + c.z, 0) / cards.length : ZD / 2;
  // camera tournee autour du milieu de la scene, a la meme distance, regard horizontal, meme focale
  const ya = yaw * Math.PI / 180, R = (zMid + D0) * tele;
  const C = [0.5 + R * Math.sin(ya), camY, zMid - R * Math.cos(ya)];
  const fw = [-Math.sin(ya), 0, Math.cos(ya)], r = [Math.cos(ya), 0, Math.sin(ya)];
  const u = [fw[1] * r[2] - fw[2] * r[1], fw[2] * r[0] - fw[0] * r[2], fw[0] * r[1] - fw[1] * r[0]];
  const f = tele * 0.5 / Math.tan(FOV0 * Math.PI / 360);
  const proj = (p) => { const d = sub(p, C), x = dot(r, d), y = dot(u, d), zc = dot(fw, d); return { x: 0.5 + x * f / zc, y: hz - y * f / zc / hw, zc }; };
  const base = [0.5, camY, zMid - R], an = (p) => Math.atan2(p[2], p[0]) * 180 / Math.PI;
  const out = [];
  let skipped = 0;
  for (const c of cards) {
    const feet = proj([c.X, c.Y, c.z]), top = proj([c.X, c.Y + c.Hc, c.z]);
    if (feet.zc < 0.05) { skipped++; continue; }
    const o = { l: c.l, x: f3(feet.x), y: f3(feet.y), s: f3(Math.max(0.02, feet.y - top.y)), d: f3(clamp((feet.zc - (R - zMid)) / ZD, 0, 1)) };
    let da = an(sub(C, [c.X, 0, c.z])) - an(sub(base, [c.X, 0, c.z]));
    da = ((da + 540) % 360) - 180;
    const vv = variantOf(c.it, c.l.v);
    if (vv && vv.orbit && vv.orbit.n > 1) {
      const a = frameToAngle(vv.orbit, c.l.f || 0);
      o.f = angleToFrame(vv.orbit, c.l.flip ? a - da : a + da);
    }
    out.push(o);
  }
  let ground = null;
  if (pan.ground) {                                          // la carte de sol vue de la camera tournee (montage.js groundRecalc)
    const gr = pan.ground, m0 = groundMap(gr, hw), cy = Math.cos(ya), sy = Math.sin(ya), k = 1, ff = 1;
    const a = k * cy, b = -k * sy * ff, c = k * sy, d = k * cy * ff, e = (C[0] - 0.5) / camY, g = (C[2] + D0) / camY;
    const [A, B, Cc, Dd, E, G] = m0;
    ground = { m: [A * a + B * c, A * b + B * d, Cc * a + Dd * c, Cc * b + Dd * d, A * e + B * g + E, Cc * e + Dd * g + G].map((x) => +x.toFixed(5)), hz: f3(clamp(hz, 0.02, 0.95)) };
  }
  return { out, skipped, ground };
}
