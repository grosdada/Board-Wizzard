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
  const id = item.src || item.id;                           // personnage assemble : les images sont celles de son corps
  if (v.orbit && v.orbit.n) {
    const n = v.orbit.n, i = ((Math.round(f || 0) % n) + n) % n;
    return { url: `/bank/${id}/${v.orbit.dir}/${pad3(i)}.webp?t=${v.orbit.t || 0}`, w: v.orbit.w, h: v.orbit.h, n, i, orbit: true,
             vec: v.orbit.vec ? `/bank/${id}/${v.orbit.dir}/vec.json?v=${v.orbit.vt || 0}` : null,
             head: v.orbit.head ? `/bank/${id}/${v.orbit.dir}/head.json?v=${v.orbit.vt || 0}` : null };   // tete suivie (corps de mannequin)
  }
  if (v.cut) return { url: `/bank/${id}/${v.cut}?t=${v.t || 0}`, w: v.cw || item.w, h: v.ch || item.h, n: 1, i: 0 };
  return { url: `/bank/${id}/${v.ref}?t=${v.t || 0}`, w: item.w || 1, h: item.h || 1, n: 1, i: 0, raw: true };
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
  return fr ? { w: e.data.w, h: e.data.h, sw: e.data.sw || 0, body: fr.body, ink: fr.ink, parts: fr.parts || [] } : null;
}
export function vecReady(sp) { return new Promise((ok) => { const f = vecFrame(sp, () => ok(vecFrame(sp))); if (f || !sp || !sp.vec || (vecs.get(sp.vec) || {}).data === false) ok(f); }); }
/** Ombre graphique d'un dessin en traces, sans calcul : la silhouette moins elle-meme decalee vers la lumiere laisse
 *  un aplat gris du cote oppose. sh = { on, g (gris 0 = noir, 1 = blanc), w (largeur, en % de la hauteur), a (angle d'ou
 *  vient la lumiere, degres : 0 = droite, 90 = haut, 180 = gauche) }. Renvoie { fill, dx, dy } en unites du dessin, ou null. */
/** Tremble d'un dessin en traces (personnage, asset, decor) : un bruit doux deplace le trait. hand : force (0 = net),
 *  wave : longueur des ondulations. w, h : taille du dessin dans ses unites. Rend le balisage du filtre SVG, ou "". */
export function wiggleFilter(id, hand, wave, w, h, seed = 5) {
  if (!(hand > 0)) return "";
  const amp = hand * h / 380, pad = amp + 4, px = pad + w * 0.3, top = pad + h * 0.15;   // large : une tete du portrait-robot depasse du dessin du corps
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="${(-px).toFixed(1)}" y="${(-top).toFixed(1)}" width="${(w + 2 * px).toFixed(1)}" height="${(h + top + pad).toFixed(1)}" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${(55 / (Math.max(0.5, wave ?? 4) * h)).toFixed(5)}" numOctaves="2" seed="${seed}"/>` +
    `<feDisplacementMap in="SourceGraphic" scale="${amp.toFixed(2)}" xChannelSelector="R" yChannelSelector="G"/></filter>`;
}
/** Couleur unie d'un dessin en traces (l.col) : blanc par defaut. */
export function bodyFill(l) { return l && /^#[0-9a-f]{6}$/i.test(l.col || "") ? l.col : "#ffffff"; }
/** Ombre d'un dessin : la couleur du corps assombrie (un gris sur un corps blanc), decalee vers la lumiere. */
export function shadeOf(sh, h, col = "#ffffff", ink = "#111111") {
  if (!sh || !sh.on) return null;
  if (sh.ink) { const d0 = (sh.w ?? 5) / 100 * h, a0 = (sh.a ?? 135) * Math.PI / 180; return { fill: ink, dx: Math.cos(a0) * d0, dy: -Math.sin(a0) * d0 }; }   // ombre a la couleur du contour
  const g = clamp(sh.g ?? 0.72, 0, 1), d = (sh.w ?? 5) / 100 * h, a = (sh.a ?? 135) * Math.PI / 180;
  const c = [1, 3, 5].map((i) => Math.round(parseInt(col.slice(i, i + 2), 16) * g));
  return { fill: `rgb(${c[0]},${c[1]},${c[2]})`, dx: Math.cos(a) * d, dy: -Math.sin(a) * d };
}
/** Formes a ombrer : toujours la silhouette entiere, plus les sh.k plus grandes formes fermees par le trait (0 = aucune :
 *  l'ombre rough, sur la silhouette seule ; les formes sont rangees de la plus grande a la plus petite). */
export function shadeShapes(sh, vf) { return [vf.body].concat((vf.parts || []).slice(0, Math.max(0, Math.round((sh && sh.k) || 0)))); }
/** Trait d'un dessin en traces : epaisseur ajoutee (lw > 0 : plus epais, < 0 : plus fin), en unites du dessin. */
export function inkStroke(lw, col = "#ffffff", ink = "#111111", sw = 0) { const t = thinMax(+lw || 0, sw); return { color: t >= 0 ? ink : col, width: Math.abs(t), outline: 0, thin: t < 0 ? -t : 0 }; }
/** Un trait ne s'affine pas jusqu'a disparaitre : il en reste toujours un filet (sw : epaisseur du trait du dessin, si connue). */
export function thinMax(lw, sw) { return lw < 0 ? Math.max(lw, sw > 0 ? -(sw - 0.45) : -2) : lw; }
/** Trait affine : la silhouette recule d'autant, sinon un lisere de la couleur du corps deborde du trait. Rend le balisage
 *  d'un masque SVG (a poser avant le dessin) ou "". */
export function thinMask(id, body, thin) { return thin > 0 ? `<mask id="${id}" maskUnits="userSpaceOnUse" x="-50" y="-50" width="4000" height="4000"><path d="${body}" fill="#fff" stroke="#000" stroke-width="${thin.toFixed(2)}" stroke-linejoin="round"/></mask>` : ""; }
/** Epaisseur du trait affiche d'un dessin (celle du dessin, plus le reglage du calque), pour accorder ce qu'on lui ajoute. */
export function lineWidth(sw, lw) { return sw > 0 ? Math.max(0.45, sw + thinMax(+lw || 0, sw)) : 0; }
/** Couleur du trait d'un dessin en traces (l.ink) : noir par defaut. Tout ce qui est noir dans le dessin la prend. */
export function inkFill(l) { return l && /^#[0-9a-f]{6}$/i.test(l.ink || "") ? l.ink : "#111111"; }   // pas de contour de silhouette : il inventerait des traits la ou le dessin n'en a pas

export function frameUrls(item, vid) {
  const v = variantOf(item, vid);
  if (!v || !v.orbit) return [];
  return Array.from({ length: v.orbit.n }, (_, i) => `/bank/${item.src || item.id}/${v.orbit.dir}/${pad3(i)}.webp?t=${v.orbit.t || 0}`);
}

const keep = new Map();                       // images gardees en memoire : le glisser-tourner ne clignote pas
export function preload(item, vid) {
  const key = item.id + "/" + vid + "/" + ((variantOf(item, vid) || {}).orbit || {}).dir;
  if (keep.has(key)) return keep.get(key);
  keep.set(key, frameUrls(item, vid).map((u) => { const im = new Image(); im.src = u; return im; }));
  if (keep.size > 14) keep.delete(keep.keys().next().value);
  return keep.get(key);                     // les images, pour savoir lesquelles sont deja arrivees
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
/** Ombre portee : une tache sombre aux pieds. l.gs = { on, a (opacite), w (largeur, en largeurs du sujet), h (epaisseur),
 *  b (flou : 0 = bord net, 1 = doux), ink (vrai : elle prend la couleur du contour du dessin, sinon noir), dx, dy (decalage, en hauteurs du sujet : pour la caler sous les pieds) }. */
export function groundShadow(l, box) {
  const g = l.gs;
  if (!g || !g.on) return null;
  const rx = box.w * 0.5 * (g.w ?? 0.8), ry = Math.max(1.5, rx * 0.17 * (g.h ?? 1));
  const q = { cx: (box.cx ?? box.x + box.w / 2) + (g.dx || 0) * box.h, cy: box.y + box.h - ry * 0.15 + (g.dy || 0) * box.h, rx, ry, a: g.a ?? 0.35,
              blur: Math.min(rx, ry) * 0.4 * (g.b ?? 1), col: g.ink ? inkFill(l) : "#000000" };
  q.d = blobPath(q, g.hand || 0, g.wave ?? 4, g.seed || 0);
  return q;
}
/** Contour d'une ombre portee : l'ellipse, ou la meme deformee (hand : force 0..10, wave : longueur des ondulations,
 *  seed : autre forme). Un trace et non un filtre : le meme dans la case, au montage et dans l'image aplatie. */
export function blobPath(q, hand, wave, seed = 0) {
  const f = (x) => x.toFixed(1);
  if (!(hand > 0)) return `M${f(q.cx - q.rx)} ${f(q.cy)}a${f(q.rx)} ${f(q.ry)} 0 1 0 ${f(2 * q.rx)} 0a${f(q.rx)} ${f(q.ry)} 0 1 0 ${f(-2 * q.rx)} 0Z`;
  const rnd = (i) => { const x = Math.sin((seed + 1) * 127.1 + i * 311.7) * 43758.5453; return x - Math.floor(x); };
  const f0 = Math.max(1, Math.round(12 / Math.max(0.5, wave))), A = hand / 10;
  const hs = [[f0, 1], [f0 * 2 + 1, 0.5], [f0 * 3 + 2, 0.28], [1, 0.6]];             // lobes, puis leurs details, puis un grand desequilibre
  const noise = (t, k) => hs.reduce((n, [fr, am], i) => n + am * Math.sin(fr * t + rnd(i + k) * 6.283), 0) / 2.38;
  const N = 180, pts = [];
  for (let i = 0; i < N; i++) {
    const t = i / N * Math.PI * 2, r = Math.max(0.06, 1 + A * 1.5 * noise(t, 0));
    pts.push([q.cx + Math.cos(t) * q.rx * r + A * q.rx * 0.35 * noise(t, 20), q.cy + Math.sin(t) * q.ry * r + A * q.rx * 0.45 * noise(t, 40)]);
  }
  return "M" + pts.map((p) => f(p[0]) + " " + f(p[1])).join("L") + "Z";
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
