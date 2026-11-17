// Ce que l'editeur et l'aplatissement partagent : images d'un element de banque, axes d'une orbite, placements.

// dans l'ordre ou l'orbite les parcourt ; gauche / droite = cote de l'ecran vers lequel le sujet regarde (comme sprites.py)
export const AXES = ["face", "3/4 face gauche", "profil gauche", "3/4 dos gauche", "dos", "3/4 dos droite", "profil droit",
                     "3/4 face droite"];
export const pad3 = (n) => String(n).padStart(3, "0");
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const uid = () => Math.random().toString(36).slice(2, 8);

export function variantOf(item, vid) {
  return (item && item.variants && (item.variants[vid] || item.variants.base)) || null;
}

// image a afficher pour (element, variante, image de l'orbite) : orbite > detourage fixe > image d'origine
export function sprite(item, vid, f) {
  const v = variantOf(item, vid);
  if (!v) return null;
  if (v.orbit && v.orbit.n) {
    const n = v.orbit.n, i = ((Math.round(f || 0) % n) + n) % n;
    return { url: `/bank/${item.id}/${v.orbit.dir}/${pad3(i)}.webp`, w: v.orbit.w, h: v.orbit.h, n, i, orbit: true,
             vec: v.orbit.vec ? `/bank/${item.id}/${v.orbit.dir}/vec.json` : null };
  }
  if (v.cut) return { url: `/bank/${item.id}/${v.cut}?t=${v.t || 0}`, w: v.cw || item.w, h: v.ch || item.h, n: 1, i: 0 };
  return { url: `/bank/${item.id}/${v.ref}`, w: item.w || 1, h: item.h || 1, n: 1, i: 0, raw: true };
}

// ---- dessins en traces : vec.json d'une orbite = { w, h, frames: [{ body, ink }] }, charge une fois puis garde
const vecs = new Map();
/** Traces de l'image affichee, ou null tant qu'ils ne sont pas charges (l'image WebP sert en attendant). */
export function vecFrame(sp, onReady) {
  if (!sp || !sp.vec) return null;
  let e = vecs.get(sp.vec);
  if (!e) {
    e = { data: null, wait: [] };
    vecs.set(sp.vec, e);
    fetch(sp.vec).then((r) => (r.ok ? r.json() : null)).then((d) => { e.data = d || false; e.wait.splice(0).forEach((f) => f()); })
      .catch(() => { e.data = false; });
    if (vecs.size > 40) vecs.delete(vecs.keys().next().value);
  }
  if (e.data === null) { if (onReady && e.wait.length < 4) e.wait.push(onReady); return null; }
  if (!e.data) return null;
  const fr = e.data.frames[sp.i];
  return fr ? { w: e.data.w, h: e.data.h, body: fr.body, ink: fr.ink } : null;
}
export function vecReady(sp) { return new Promise((ok) => { const f = vecFrame(sp, () => ok(vecFrame(sp))); if (f || !sp || !sp.vec || (vecs.get(sp.vec) || {}).data === false) ok(f); }); }
/** Ombre graphique d'un dessin en traces, sans calcul : la silhouette moins elle-meme decalee vers la lumiere laisse
 *  un aplat gris du cote oppose. sh = { on, g (gris 0 = noir, 1 = blanc), w (largeur, en % de la hauteur), a (angle d'ou
 *  vient la lumiere, degres : 0 = droite, 90 = haut, 180 = gauche) }. Renvoie { fill, dx, dy } en unites du dessin, ou null. */
export function shadeOf(sh, h) {
  if (!sh || !sh.on) return null;
  const g = Math.round(255 * clamp(sh.g ?? 0.72, 0, 1)), d = (sh.w ?? 5) / 100 * h, a = (sh.a ?? 135) * Math.PI / 180;
  return { fill: `rgb(${g},${g},${g})`, dx: Math.cos(a) * d, dy: -Math.sin(a) * d };
}
/** Trait d'un dessin en traces : epaisseur ajoutee (lw > 0 : plus epais, < 0 : plus fin), en unites du dessin. */
export function inkStroke(lw) { const t = +lw || 0; return { color: t >= 0 ? "#111111" : "#ffffff", width: Math.abs(t), outline: 0 }; }   // pas de contour de silhouette : il inventerait des traits la ou le dessin n'en a pas

export function frameUrls(item, vid) {
  const v = variantOf(item, vid);
  if (!v || !v.orbit) return [];
  return Array.from({ length: v.orbit.n }, (_, i) => `/bank/${item.id}/${v.orbit.dir}/${pad3(i)}.webp`);
}

const keep = new Map();                       // images gardees en memoire : le glisser-tourner ne clignote pas
export function preload(item, vid) {
  const key = item.id + "/" + vid + "/" + ((variantOf(item, vid) || {}).orbit || {}).dir;
  if (keep.has(key)) return;
  keep.set(key, frameUrls(item, vid).map((u) => { const im = new Image(); im.src = u; return im; }));
  if (keep.size > 14) keep.delete(keep.keys().next().value);
}

// ---- axes : les reperes (snaps) d'une orbite donnent l'angle de chaque image, par morceaux
function table(orbit) {
  const n = orbit.n, snaps = orbit.snaps || {};
  const rows = AXES.map((a, k) => [k * 45, snaps[a]]).filter((r) => r[1] != null);
  if (rows.length < 2) return null;
  let prev = rows[0][1];
  const out = rows.map(([ang, fr], k) => { if (k) { while (fr <= prev) fr += n; prev = fr; } return [ang, fr]; });
  if (out[out.length - 1][1] - out[0][1] >= n) return null;          // reperes incoherents
  out.push([out[0][0] + 360, out[0][1] + n]);
  return out;
}
export function frameToAngle(orbit, f) {
  const n = orbit.n, t = table(orbit);
  f = ((f % n) + n) % n;
  if (!t) return f / n * 360;
  for (const ff of [f, f + n]) {
    for (let k = 0; k < t.length - 1; k++) {
      if (ff >= t[k][1] && ff <= t[k + 1][1]) {
        const u = (ff - t[k][1]) / Math.max(1e-6, t[k + 1][1] - t[k][1]);
        return (t[k][0] + u * (t[k + 1][0] - t[k][0])) % 360;
      }
    }
  }
  return f / n * 360;
}
export function angleToFrame(orbit, ang) {
  const n = orbit.n, t = table(orbit);
  ang = ((ang % 360) + 360) % 360;
  if (!t) return Math.round(ang / 360 * n) % n;
  for (const aa of [ang, ang + 360]) {
    for (let k = 0; k < t.length - 1; k++) {
      if (aa >= t[k][0] && aa <= t[k + 1][0]) {
        const u = (aa - t[k][0]) / Math.max(1e-6, t[k + 1][0] - t[k][0]);
        return Math.round(t[k][1] + u * (t[k + 1][1] - t[k][1])) % n;
      }
    }
  }
  return Math.round(ang / 360 * n) % n;
}
export function nearestAxis(orbit, f) {
  const a = frameToAngle(orbit, f);
  return AXES[Math.round(a / 45) % 8];
}

// ---- placements
// fond : couverture * zoom, decalage (ox, oy) en fraction de la boite
export function placement(bb, iw, ih, view) {
  const v = view || {};
  const zoom = Math.max(1, v.zoom || 1);
  const s = Math.max(bb.w / iw, bb.h / ih) * zoom;
  const dw = iw * s, dh = ih * s;
  const mx = (dw - bb.w) / (2 * bb.w), my = (dh - bb.h) / (2 * bb.h);
  const ox = clamp(v.ox || 0, -mx, mx), oy = clamp(v.oy || 0, -my, my);
  return { x: bb.x0 + bb.w / 2 - dw / 2 + ox * bb.w, y: bb.y0 + bb.h / 2 - dh / 2 + oy * bb.h, w: dw, h: dh, ox, oy };
}
// calque : (x, y) = pieds (bas, centre) en fraction de la case ; s = hauteur en fraction de la hauteur de la case
export function layerBox(bb, l, sp) {
  const h = l.s * bb.h, w = h * (sp.w / sp.h);
  const cx = bb.x0 + l.x * bb.w, y1 = bb.y0 + l.y * bb.h;
  return { x: cx - w / 2, y: y1 - h, w, h, cx, y1 };
}
// profondeur 0 (premier plan) a 1 (fond) : par defaut, l'ordre d'empilement
export function depthOf(panel, i) {
  const ls = panel.layers || [], l = ls[i];
  return l && l.d != null ? l.d : 1 - (i + 1) / (ls.length + 1);
}
// flou de profondeur de champ, en unites de page
export function blurOf(panel, depth, bb) {
  const d = panel.dof;
  if (!d || !d.on || !d.amount) return 0;
  return d.amount / 1000 * bb.h * Math.abs(depth - (d.focus ?? 0.3));
}
// fond d'une case : { url, w, h, orbit } ou null
export function background(panel, bank, projectId) {
  const bg = panel.bg;
  if (!bg) return null;
  if (bg.file) return { url: `/projects/${projectId}/${bg.file}`, w: bg.w, h: bg.h };
  const item = bank.get(bg.item);
  if (!item) return null;
  const sp = sprite(item, bg.v || "base", bg.f || 0);
  return sp && { url: sp.url, w: sp.w, h: sp.h, orbit: sp.orbit, n: sp.n, item, vec: sp.vec, i: sp.i };
}
