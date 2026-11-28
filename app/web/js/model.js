// Ce que l'editeur et l'aplatissement partagent : images d'un element de banque, axes d'une orbite, placements.

// dans l'ordre ou l'orbite les parcourt ; gauche / droite = cote de l'ecran vers lequel le sujet regarde (comme sprites.py)
export const AXES = ["face", "3/4 face gauche", "profil gauche", "3/4 dos gauche", "dos", "3/4 dos droite", "profil droit",
                     "3/4 face droite"];
export const pad3 = (n) => String(n).padStart(3, "0");
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const uid = () => Math.random().toString(36).slice(2, 8);

export function variantOf(item, vid) {
  if (item && item.variants && typeof vid === "string" && vid.includes("~")) {   // plan d'un decor retouche en calques : "<version>~<plan>"
    const [a, k] = vid.split("~"), pl = item.variants[a] && (item.variants[a].planes || []).find((x) => x.id === k);
    // version ou calque supprime : le plan ne dessine plus rien (le fond, lui, retombe sur la base : background)
    return pl || { label: "—", missing: true };
  }
  return (item && item.variants && (item.variants[vid] || item.variants.base)) || null;
}

// image a afficher pour (element, variante, image de l'orbite) : orbite > detourage fixe > image d'origine
export function sprite(item, vid, f) {
  const v = variantOf(item, vid);
  if (!v || v.missing) return null;
  const id = item.src || item.id;                           // personnage assemble : les images sont celles de son corps
  if (v.orbit && v.orbit.n) {
    const n = v.orbit.n, i = ((Math.round(f || 0) % n) + n) % n;
    return { url: `/bank/${id}/${v.orbit.dir}/${pad3(i)}.webp?t=${v.orbit.t || 0}`, w: v.orbit.w, h: v.orbit.h, n, i, orbit: true,
             vec: v.orbit.vec && item.style === "dessin" ? `/bank/${id}/${v.orbit.dir}/vec.json?v=${v.orbit.vt || 0}` : null,
             // les autres styles : le trait existe aussi, mais seulement sur demande, calque par calque (l.tr)
             vecAlt: v.orbit.vec && item.style !== "dessin" ? `/bank/${id}/${v.orbit.dir}/vec.json?v=${v.orbit.vt || 0}` : null,
             head: v.orbit.head ? `/bank/${id}/${v.orbit.dir}/head.json?v=${v.orbit.vt || 0}` : null,   // tete suivie (corps de mannequin)
             mouth: v.orbit.mouth ? `/bank/${id}/${v.orbit.dir}/mouth.json?v=${v.orbit.mt || 0}` : null,
             lips: v.orbit.mouth && v.orbit.lips ? `/bank/${id}/${v.orbit.dir}/lips.json?v=${v.orbit.lips}` : null,
             expr: v.orbit.mouth && v.orbit.expr ? `/bank/${id}/${v.orbit.dir}/expr.json?v=${v.orbit.expr}` : null, exprs: v.orbit.exprs || null, dir: `/bank/${id}/${v.orbit.dir}` };   // bouches dessinees dans le style du personnage (tools/levres.py)   // bouche du dessin, suivie (lip sync « trace »)   // expressions : app/exprcards.py
  }
  if (v.cut) return { url: `/bank/${id}/${v.cut}?t=${v.t || 0}`, w: v.cw || item.w, h: v.ch || item.h, n: 1, i: 0 };
  return { url: `/bank/${id}/${v.ref}?t=${v.t || 0}`, w: item.w || 1, h: item.h || 1, n: 1, i: 0, raw: true };
}

/** Le sprite tel que le calque le montre : l.ill = l'illustration (images de l'orbite) plutot que le trait ; l.tr = le
 *  trait d'un element qui n'est pas un dessin (par defaut, on y voit l'illustration). */
export function layerSp(sp, l) {
  if (!sp || !l) return sp;
  if (l.ill) return sp.vec ? Object.assign({}, sp, { vec: null }) : sp;
  if (l.tr && sp.vecAlt) return Object.assign({}, sp, { vec: sp.vecAlt });
  return sp;
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
// ---- bouche du dessin : mouth.json d'une orbite = { w, h, src, frames: [null | { up, lo, w, stroke, drop, open, cover }] }
const mouths = new Map();
/** Bouche suivie sur l'image affichee : { w, h, m (null = pas suivie sur cette image) }, ou null tant que le fichier
 *  n'est pas charge (onReady est rappele quand il arrive) ou s'il n'y en a pas. */
export function mouthFrame(sp, onReady) {
  if (!sp || !sp.mouth) return null;
  let e = mouths.get(sp.mouth);
  if (!e) {
    e = { data: null, wait: [] };
    mouths.set(sp.mouth, e);
    fetch(sp.mouth).then((r) => (r.ok ? r.json() : null)).then((d) => { e.data = d || false; e.wait.splice(0).forEach((f) => f()); })
      .catch(() => { e.data = false; });
    if (mouths.size > 40) mouths.delete(mouths.keys().next().value);
  }
  if (e.data === null) { if (onReady && e.wait.length < 4) e.wait.push(onReady); return null; }
  return e.data ? { w: e.data.w, h: e.data.h, m: e.data.frames[sp.i] || null, all: e.data.frames, lips: lipsOf(sp, onReady), expr: cardsFile(sp.expr, sp.dir, onReady) } : null;
}
// ---- expressions : expr.json d'une orbite, meme forme que lips.json (cartes par image-cle : { f, x, y, s, cards: { joie, ... } })
const cardsFiles = new Map();
function cardsFile(url, dir, onReady) {
  if (!url) return null;
  let e = cardsFiles.get(url);
  if (!e) {
    e = { data: null };
    cardsFiles.set(url, e);
    fetch(url).then((r) => (r.ok ? r.json() : null)).then((d) => {
      e.data = d ? Object.assign(d, { base: dir, v: url.split("?v=")[1] || "0" }) : false;
      if (d) for (const k of d.keys) for (const f of Object.values(k.cards)) new Image().src = `${dir}/${f}?v=${e.data.v}`;
      if (onReady) onReady();
    }).catch(() => { e.data = false; });
    if (cardsFiles.size > 40) cardsFiles.delete(cardsFiles.keys().next().value);
  }
  return e.data || null;
}
// ---- bouches dessinees : lips.json d'une orbite = { w, h, keys: [{ f, x, y, s, cards: { A, O, E, D }, gom?: { A, ... } }] } (tools/levres.py ; gom : gommes)
const lipsFiles = new Map();
function lipsOf(sp, onReady) {
  if (!sp.lips) return null;
  let e = lipsFiles.get(sp.lips);
  if (!e) {
    e = { data: null };
    lipsFiles.set(sp.lips, e);
    fetch(sp.lips).then((r) => (r.ok ? r.json() : null)).then((d) => {
      e.data = d ? Object.assign(d, { base: sp.dir, v: sp.lips.split("?v=")[1] || "0" }) : false;
      if (d) for (const k of d.keys) for (const f of Object.values(k.cards).concat(Object.values(k.gom || {}))) new Image().src = `${sp.dir}/${f}?v=${e.data.v}`;   // deja en memoire quand la voix demarre
      if (onReady) onReady();
    }).catch(() => { e.data = false; });
    if (lipsFiles.size > 40) lipsFiles.delete(lipsFiles.keys().next().value);
  }
  return e.data || null;
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
/** Epaisseur aleatoire du trait (amt 0..10) : par plages, le trait s'epaissit ou s'amincit, comme a la plume. Un bruit lent
 *  dit ou ; dilatation et erosion de l'encre (feMorphology) aux endroits choisis. sw : epaisseur du trait du dessin. */
export function jitterFilter(id, amt, w, h, sw, seed = 7) {
  if (!(amt > 0)) return "";
  const base = sw > 0 ? sw : Math.max(w, h) / 400, r = (amt / 10) * base * 1.1, pad = r + 4, f = 9 / Math.max(60, Math.min(w, h));
  const m = (a, b) => `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${a} 0 0 0 ${b}" result="${a > 0 ? "hi" : "lo"}"/>`;
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="${(-pad).toFixed(1)}" y="${(-pad).toFixed(1)}" width="${(w + 2 * pad).toFixed(1)}" height="${(h + 2 * pad).toFixed(1)}" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${f.toFixed(5)}" numOctaves="1" seed="${seed}" result="n"/>` + m(12, -6.6) + m(-12, 5.4) +
    `<feMorphology in="SourceGraphic" operator="dilate" radius="${r.toFixed(2)}" result="fat"/><feMorphology in="SourceGraphic" operator="erode" radius="${Math.min(r * 0.4, base * 0.22).toFixed(2)}" result="slim"/>` +
    `<feComposite in="SourceGraphic" in2="lo" operator="out" result="keep"/><feComposite in="slim" in2="lo" operator="in" result="thin"/><feComposite in="fat" in2="hi" operator="in" result="thick"/>` +
    `<feMerge><feMergeNode in="keep"/><feMergeNode in="thin"/><feMergeNode in="thick"/></feMerge>` +
    `<feGaussianBlur stdDeviation="${(r * 0.2 + 0.3).toFixed(2)}"/><feComponentTransfer><feFuncA type="linear" slope="2.2" intercept="-0.45"/></feComponentTransfer></filter>`;
}
/** Couleur unie d'un dessin en traces (l.col) : blanc par defaut. */
// Camera dans la profondeur : au repos elle est a CAM_BACK devant le premier plan (profondeur 0). dz l'avance : a 1 elle
// atteint le premier plan, a 2 le decor. Un plan a la profondeur d grossit de (d + CAM_BACK) / (d + CAM_BACK - dz) :
// ce qui est pres grossit plus vite que le fond, et ce que la camera a depasse disparait (0).
export const CAM_BACK = 1;
export const perspOf = (d, dz) => { const den = d + CAM_BACK - (dz || 0); return den <= 0.04 ? 0 : Math.min(60, (d + CAM_BACK) / den); };
/** Cadrage de la case (pan.frame = { cx, cy, z, rot, dz, par, view }) : la camera du montage reportee sur la case (« 1re image
 *  → case ») ou reglee dans la planche. dz : la camera avance dans la profondeur ; par : force de la parallaxe (0 : sans) ;
 *  view : place du decor quand elle est animee dans le montage. Rend { m (transform SVG du contenu), z, rot, fwd (point du
 *  contenu -> point de la page), inv (l'inverse), dm(d) (transform SVG d'un plan a la profondeur d, comme dans le montage ;
 *  "" : rien a faire, null : la camera l'a depasse), k(d), at(d) ({ z, inv } d'un plan : page -> repere du plan) } ou null. */
export function frameT(pan, bb) {
  const f = pan && pan.frame;
  if (!f) return null;
  const z = f.z || 1, rot = f.rot || 0, cx = f.cx ?? 0.5, cy = f.cy ?? 0.5, dz = f.dz || 0, ps = f.par || 0;
  const centred = Math.abs(cx - 0.5) < 1e-4 && Math.abs(cy - 0.5) < 1e-4;
  if (Math.abs(z - 1) < 1e-3 && Math.abs(rot) < 0.01 && centred && Math.abs(dz) < 1e-3 && !f.view) return null;
  const a = rot * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const C = [bb.x0 + bb.w / 2, bb.y0 + bb.h / 2], c = [bb.x0 + cx * bb.w, bb.y0 + cy * bb.h];
  const inv = (p) => { const dx = (p.x - C[0]) / z, dy = (p.y - C[1]) / z; return { x: c[0] + dx * cs - dy * sn, y: c[1] + dx * sn + dy * cs }; };
  // plan a la profondeur d : point du plan q -> c + k (q - c) + o (avancee de la camera, parallaxe), comme montage.js
  const dep = (d) => { const par = ps * (d - 0.5); return { k: perspOf(d, dz), ox: (cx - 0.5) * par * bb.w, oy: (cy - 0.5) * par * bb.h }; };
  const dm = (d) => {
    const q = dep(d);
    if (!q.k) return null;
    if (Math.abs(q.k - 1) < 1e-5 && Math.abs(q.ox) < 1e-4 && Math.abs(q.oy) < 1e-4) return "";
    return `translate(${(c[0] + q.ox).toFixed(3)} ${(c[1] + q.oy).toFixed(3)}) scale(${q.k.toFixed(5)}) translate(${(-c[0]).toFixed(3)} ${(-c[1]).toFixed(3)})`;
  };
  const at = (d) => { const q = dep(d), k = q.k || 1; return { z: z * k, inv: (p) => { const r = inv(p); return { x: c[0] + (r.x - c[0] - q.ox) / k, y: c[1] + (r.y - c[1] - q.oy) / k }; } }; };
  return { z, rot, C, c, dep, dm, at, k: (d) => dep(d).k, view: f.view || null,
    m: `translate(${C[0].toFixed(3)} ${C[1].toFixed(3)}) scale(${z.toFixed(5)}) rotate(${(-rot).toFixed(3)}) translate(${(-c[0]).toFixed(3)} ${(-c[1]).toFixed(3)})`,
    fwd: (p) => { const dx = p.x - c[0], dy = p.y - c[1]; return { x: C[0] + z * (dx * cs + dy * sn), y: C[1] + z * (-dx * sn + dy * cs) }; },
    inv };
}
/** Sol vu par la camera d'une case : la partie visible quand la camera recule ou dezoome (bb : la case), comme le montage. */
export function groundVis(f, bb) {
  const z = (f && f.z) || 1, kv = perspOf(1, (f && f.dz) || 0) * z, hv = kv > 0 && kv < 1 ? 0.75 / kv : 0.5;
  const cx = f ? f.cx ?? 0.5 : 0.5, cy = f ? f.cy ?? 0.5 : 0.5;
  return hv > 0.5 ? { x: bb.x0 + (cx - hv) * bb.w, y: bb.y0 + (cy - hv) * bb.h, w: 2 * hv * bb.w, h: 2 * hv * bb.h } : { x: bb.x0, y: bb.y0, w: bb.w, h: bb.h };
}
export function bodyFill(l) { return l && /^#[0-9a-f]{6}$/i.test(l.col || "") ? l.col : "#ffffff"; }
/** Colorize d'une image (l.tint = { on, c }) : la couleur posee en produit dans la decoupe ; le blanc la prend,
 *  traits et peinture restent visibles. null : pas de colorize. */
export function tintOf(l) { return l && l.tint && l.tint.on && /^#[0-9a-f]{6}$/i.test(l.tint.c || "") ? l.tint.c : null; }
export function tintFilter(id, c) {
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feFlood flood-color="${c}"/>` +
    `<feBlend in2="SourceGraphic" mode="multiply"/><feComposite in2="SourceGraphic" operator="in"/></filter>`;
}
/** Colorimetrie a la Photoshop (Teinte / Saturation / Luminosite, plus Contraste) et colorize, en une seule matrice de
 *  couleur affine : g = {h: -180..180, s, l, c: -100..100}, tint = "#rrggbb" (en produit) ou null. Rend 12 nombres (3 lignes
 *  r g b + decalage, decalage entre 0 et 1) ou null quand il n'y a rien a faire. La meme matrice sert au SVG (feColorMatrix)
 *  et aux pixels d'un canvas (aplatissement) : les trois rendus sont identiques. */
export function colorMatrix(g, tint) {
  const h = +(g && g.h) || 0, sa = +(g && g.s) || 0, li = +(g && g.l) || 0, co = +(g && g.c) || 0;
  if (!h && !sa && !li && !co && !tint) return null;
  const mul = (A, B) => [0, 1, 2].flatMap((r) => [0, 1, 2, 3].map((c) => A[r * 4] * B[c] + A[r * 4 + 1] * B[4 + c] + A[r * 4 + 2] * B[8 + c] + (c === 3 ? A[r * 4 + 3] : 0)));
  const diag = (k, o) => [k[0], 0, 0, o[0], 0, k[1], 0, o[1], 0, 0, k[2], o[2]];
  let M = diag([1, 1, 1], [0, 0, 0]);
  if (h) { const a = h * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    M = mul([0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0,
             0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283, 0,
             0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0], M); }
  if (sa) { const s = Math.max(0, 1 + sa / 100);
    M = mul([0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0,
             0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0], M); }
  if (co) { const k = Math.max(0, 1 + co / 100); M = mul(diag([k, k, k], [0.5 - 0.5 * k, 0.5 - 0.5 * k, 0.5 - 0.5 * k]), M); }
  if (li) { const L = clamp(li / 100, -1, 1), k = L > 0 ? 1 - L : 1 + L, o = L > 0 ? L : 0; M = mul(diag([k, k, k], [o, o, o]), M); }   // vers le blanc / vers le noir
  if (tint) { const t = [1, 3, 5].map((i) => parseInt(tint.slice(i, i + 2), 16) / 255); M = mul(diag(t, [0, 0, 0]), M); }
  return M;
}
export function hslOf(o) { const g = o || {}; return (+g.h || +g.s || +g.l || +g.c) ? g : null; }
export function cmFilter(id, M) {
  const v = [0, 1, 2].map((r) => `${M[r * 4].toFixed(4)} ${M[r * 4 + 1].toFixed(4)} ${M[r * 4 + 2].toFixed(4)} 0 ${M[r * 4 + 3].toFixed(4)}`).join(" ") + " 0 0 0 1 0";
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${v}"/></filter>`;
}
/** La meme matrice sur les pixels d'un canvas (sur place). */
export function cmPixels(cv, M) {
  const g = cv.getContext("2d"), d = g.getImageData(0, 0, cv.width, cv.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], gg = p[i + 1], b = p[i + 2];
    p[i] = r * M[0] + gg * M[1] + b * M[2] + 255 * M[3];
    p[i + 1] = r * M[4] + gg * M[5] + b * M[6] + 255 * M[7];
    p[i + 2] = r * M[8] + gg * M[9] + b * M[10] + 255 * M[11];
  }
  g.putImageData(d, 0, 0);
  return cv;
}
/** Colorimetrie et colorize d'un element (calque) ou du decor d'une case. */
//  extra : une couleur de plus en produit (le clignoteur du montage, qui rougit aussi les personnages)
export function layerCM(l, vec, extra) {
  const own = vec ? null : tintOf(l);
  return colorMatrix(hslOf(l && l.hsl), extra ? (own ? mulHex(own, extra) : extra) : own);
}
const mulHex = (a, b) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * parseInt(b.slice(i, i + 2), 16) / 255).toString(16).padStart(2, "0")).join("");
/** Le clignoteur sur les elements et le sol (anim.blink.chars, coche par defaut) : sa couleur a l'instant t, ou null. */
export function blinkAll(pan, t) { const a = pan && pan.anim; return a && a.bgAnim && a.blink && a.blink.chars !== false ? blinkTint(a.blink, t) : null; }
/** Clignoteur du colorize du decor (montage, anim.blink = { on, a, b, hz, soft }) : a l'instant t (secondes), la couleur
 *  va de a a b et revient, hz fois par seconde ; soft 0 = net (allume / eteint), 1 = en douceur. Commence sur b. */
export function blinkTint(bl, t) {
  if (!bl || !bl.on || t == null) return null;
  const hx = (c, d) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : d), A = hx(bl.a, "#ffffff"), B = hx(bl.b, "#ff3b30");
  const ph = ((t * Math.max(0.05, +bl.hz || 1.5)) % 1 + 1) % 1, soft = clamp(+bl.soft || 0, 0, 1);
  const k = soft * (0.5 + 0.5 * Math.cos(2 * Math.PI * ph)) + (1 - soft) * (ph < 0.5 ? 1 : 0);
  return "#" + [1, 3, 5].map((i) => Math.round(parseInt(A.slice(i, i + 2), 16) * (1 - k) + parseInt(B.slice(i, i + 2), 16) * k).toString(16).padStart(2, "0")).join("");
}
/** t : instant du montage ; le clignoteur du decor y remplace le colorize fixe quand le decor est anime. */
export function bgCM(pan, t) {
  const bl = pan && pan.anim && pan.anim.bgAnim ? blinkTint(pan.anim.blink, t) : null;
  return colorMatrix(hslOf(pan && pan.bghsl), bl || tintOf(pan && { tint: pan.bgtint }));
}
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
/** Trait d'un decor en traces : couleur (pan.bgink, noir par defaut) et epaisseur (pan.bglw, de -12 a 6). Vers la gauche le
 *  trait s'amincit jusqu'a effacer les plus fins ; l'aminci est un liseré blanc, comme le fond du dessin. */
export function bgInk(pan) { return pan && /^#[0-9a-f]{6}$/i.test(pan.bgink || "") ? pan.bgink : "#111111"; }
export function bgStroke(pan) { const t = Math.max(-12, Math.min(6, +(pan && pan.bglw) || 0)), ink = bgInk(pan); return { ink, color: t >= 0 ? ink : "#ffffff", width: Math.abs(t) }; }
export function inkFill(l) { return l && /^#[0-9a-f]{6}$/i.test(l.ink || "") ? l.ink : "#111111"; }   // pas de contour de silhouette : il inventerait des traits la ou le dessin n'en a pas

export function frameUrls(item, vid) {
  const v = variantOf(item, vid);
  if (!v || !v.orbit) return [];
  return Array.from({ length: v.orbit.n }, (_, i) => `/bank/${item.src || item.id}/${v.orbit.dir}/${pad3(i)}.webp?t=${v.orbit.t || 0}`);
}

const keep = new Map();                       // images gardees en memoire : le glisser-tourner ne clignote pas
// Images pretes pour la lecture : a chaque image d'une animation, tout le dessin est refait ; une image pas encore chargee
// (ou sortie du cache) laissait une case blanche le temps d'une image. On garde ici les images chargees et decodees, et la
// lecture ne montre une image de l'animation que quand toutes les siennes sont pretes (sinon la precedente reste).
const READY = new Map();
export function imgReady(url) {
  let e = READY.get(url);
  if (e) { READY.delete(url); READY.set(url, e); return e.ok; }   // la plus recente en dernier : les vieilles partent d'abord
  const im = new Image();
  e = { im, ok: false };
  im.onload = () => { e.ok = true; if (im.decode) im.decode().catch(() => {}); };   // decode() ne revient pas toujours : on ne l'attend pas
  im.onerror = () => { e.ok = true; };                     // image introuvable : ne pas bloquer la lecture
  im.src = url;
  READY.set(url, e);
  if (READY.size > 2500) READY.delete(READY.keys().next().value);
  return false;
}
/** Toutes les images d'un balisage SVG sont-elles pretes ? Lance le chargement de celles qui manquent. */
export function markupReady(markup) {
  let ok = true;
  for (const m of markup.matchAll(/href="([^"#][^"]*)"/g)) {
    if (m[1].startsWith("data:")) continue;
    if (!imgReady(m[1].replace(/&amp;/g, "&"))) ok = false;
  }
  return ok;
}
// Lecture sans flash blanc : remplacer tout le dessin (innerHTML) a chaque image recreait chaque <image>, decor compris,
// et une <image> neuve reste vide le temps de se charger, meme depuis le cache : la case passait au blanc. Ici on garde
// les noeuds en place et on ne change que ce qui differe d'une image a l'autre (une <image> dont l'adresse change garde
// l'ancienne image jusqu'a ce que la nouvelle soit prete).
const SVGNS = "http://www.w3.org/2000/svg";
let morphTpl = null;
export function morphSvg(el, markup) {
  morphTpl = morphTpl || document.createElementNS(SVGNS, "svg");
  morphTpl.innerHTML = markup;
  morphKids(el, morphTpl);
  morphTpl.textContent = "";
}
function morphKids(a, b) {
  const an = a.childNodes, bn = Array.from(b.childNodes);
  for (let i = 0; i < bn.length; i++) {
    const x = an[i], y = bn[i];
    if (!x) { a.appendChild(y); continue; }
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { a.replaceChild(y, x); continue; }
    if (x.nodeType === 1) {
      for (const at of Array.from(x.attributes)) if (!y.hasAttributeNS(at.namespaceURI, at.localName)) x.removeAttributeNS(at.namespaceURI, at.localName);
      for (const at of y.attributes) if (x.getAttributeNS(at.namespaceURI, at.localName) !== at.value) x.setAttributeNS(at.namespaceURI, at.name, at.value);
      morphKids(x, y);
    } else if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue;
  }
  while (an.length > bn.length) a.removeChild(a.lastChild);
}
export function preload(item, vid) {
  const key = item.id + "/" + vid + "/" + ((variantOf(item, vid) || {}).orbit || {}).dir;
  if (keep.has(key)) return keep.get(key);
  keep.set(key, frameUrls(item, vid).map((u) => { const im = new Image(); im.src = u; return im; }));
  if (keep.size > 14) keep.delete(keep.keys().next().value);
  return keep.get(key);                     // les images, pour savoir lesquelles sont deja arrivees
}

// ---- axes : les reperes (snaps) d'une orbite donnent l'angle de chaque image, par morceaux
// orbite qui tourne a l'envers (apres la face, le sujet regarde vers la droite de l'ecran : ses reperes decroissent dans
// l'ordre des AXES) : on lit ses images en sens inverse, f -> n - f, et tout le reste marche pareil
function reversed(orbit) {
  const n = orbit.n, s = orbit.snaps || {}, fr = AXES.map((a) => s[a]).filter((v) => v != null);
  let back = 0, fwd = 0;
  for (let k = 0; k < fr.length; k++) { const d = (((fr[(k + 1) % fr.length] - fr[k]) % n) + n) % n; if (d) (d > n / 2 ? back++ : fwd++); }
  return back > fwd;
}
const flipF = (n, f) => (n - (((f % n) + n) % n)) % n;
function table(orbit) {
  if (reversed(orbit)) return table(Object.assign({}, orbit, { snaps: Object.fromEntries(Object.entries(orbit.snaps).map(([a, f]) => [a, flipF(orbit.n, f)])), rev: true }));
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
  if (t && reversed(orbit)) f = flipF(n, f);
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
  const rv = reversed(orbit);
  for (const aa of [ang, ang + 360]) {
    for (let k = 0; k < t.length - 1; k++) {
      if (aa >= t[k][0] && aa <= t[k + 1][0]) {
        const u = (aa - t[k][0]) / Math.max(1e-6, t[k + 1][0] - t[k][0]), fr = Math.round(t[k][1] + u * (t[k + 1][1] - t[k][1])) % n;
        return rv ? flipF(n, fr) : fr;
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
  const zoom = Math.max(0.2, v.zoom || 1);                  // < 1 : le decor plus petit que la case
  const s = Math.max(bb.w / iw, bb.h / ih) * zoom;
  const dw = iw * s, dh = ih * s;
  const mx = Math.abs(dw - bb.w) / (2 * bb.w), my = Math.abs(dh - bb.h) / (2 * bb.h);
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
  let rx = box.w * 0.5 * (g.w ?? 0.8), ry = Math.max(1.5, rx * 0.17 * (g.h ?? 1)), cx = (box.cx ?? box.x + box.w / 2), cy = box.y + box.h - ry * 0.15;
  if (g.wall) {                                             // au mur : debout sur le cote, derriere (largeur = hauteur de l'ombre)
    ry = box.h * 0.5 * (g.w ?? 0.8); rx = Math.max(1.5, ry * 0.3 * (g.h ?? 1));
    cx += (l.flip ? -1 : 1) * (box.w * 0.3 + rx * 0.5); cy = box.y + box.h - ry;
  }
  const q = { cx: cx + (g.dx || 0) * box.h, cy: cy + (g.dy || 0) * box.h, rx, ry, a: g.a ?? 0.35,
              blur: Math.min(rx, ry) * 0.4 * (g.b ?? 1), col: g.ink ? inkFill(l) : (/^#[0-9a-f]{6}$/i.test(g.c || "") ? g.c : "#000000") };   // cloner le contour l'emporte sur la couleur choisie
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
  const sp = sprite(item, bg.v || "base", bg.f || 0) || (String(bg.v || "").includes("~") ? sprite(item, "base", 0) : null);   // version en calques supprimee : la base
  return sp && { url: sp.url, w: sp.w, h: sp.h, orbit: sp.orbit, n: sp.n, item, vec: sp.vec, i: sp.i };
}
