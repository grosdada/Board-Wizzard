// Mode montage d'une case (maquette) : une visionneuse, une timeline avec une piste par element et une piste camera,
// des poses cles. panel.anim = { dur (secondes), tracks: { cam: [cles], <id du calque>: [cles] } }.
//   (rz : rotation de l'element dans le plan de l'image, en degres, autour de son centre : il penche, il bascule)
//   cle d'un calque : { t, x, y, s, rz, f (image de l'orbite), v (pose), lw (trait), shg, shw, sha (ombre : gris, largeur,
//                       angle), e (interpolation pour arriver sur cette cle : doux | lin | fixe) }
//   cle de camera   : { t, cx, cy (centre du cadre, fraction de la case), z (zoom), rot (degres),
//                       e }
// Profondeur de champ : panel.dof = { on, focus, amount } comme dans la case. Deux pistes l'animent :
//   tracks.fo : [{ t, fo (mise au point, 0 devant a 1 fond), e }]   ·   tracks.bl : [{ t, bl (force du flou), e }]
// Sans cle, une piste garde ses valeurs de la case. Entre deux cles les valeurs sont interpolees.
import { tt, tr } from "./i18n.js";
import { h, modal, toast, history, upload, get, post, put, del } from "./api.js";
import { MOUTHS, SETS, MODES, SIMPLE, PERSO, PERSO_NAME, TRACE, TRACE_NAME, usesTrace, traceMarkup, cardMarkup, cardGom, hasPerso, cardKey, mouthIcon, lipMarkup, analyse, locateMouth, cueAt, cueIndex, voiceSpan, voiceTime, segsOf, exprMarkup, exprGom, exprAt, exprName } from "./lipsync.js";
import { swatch } from "./colors.js";
import { groundSvg, groundTile, groundMap, estimateHorizon, PATS, GROUND0 } from "./ground.js";
import { markupReady } from "./model.js";
import { sprite, preload, placement, layerBox, background, vecFrame, mouthFrame, inkStroke, shadeOf, shadeShapes, clamp, variantOf, depthOf, groundShadow, AXES, frameToAngle, angleToFrame, bodyFill, inkFill, wiggleFilter, thinMask, lineWidth, cmFilter, layerCM, bgCM } from "./model.js";
import { drawSvg, fxSvg, boxOf, W, PRIMS, PATHS, openDrawEditor } from "./draw.js";
import { PRESETS } from "./presets.js";
import { faceFor, opsSvg } from "./face.js";
import { handlesSvg, cornerStart, cornerFactor, cornerFeet } from "./handles.js";

const f1 = (n) => (+n).toFixed(1), f3 = (n) => +(+n).toFixed(3);
const CAM0 = { cx: 0.5, cy: 0.5, z: 1, rot: 0, dz: 0 };
// Camera dans la profondeur : au repos elle est a CAM_BACK devant le premier plan (profondeur 0). dz l'avance : a 1 elle
// atteint le premier plan, a 2 le decor. Un plan a la profondeur d grossit de (d + CAM_BACK) / (d + CAM_BACK - dz) :
// ce qui est pres grossit plus vite que le fond, et ce que la camera a depasse disparait.
export const CAM_BACK = 1;
export const perspOf = (d, dz) => { const den = d + CAM_BACK - (dz || 0); return den <= 0.04 ? 0 : Math.min(60, (d + CAM_BACK) / den); };
// doux : depart et arrivee amortis · lin : vitesse reguliere · fixe : pas d'intermediaire, on saute a la cle (paliers)
export const EASES = { doux: tt("En douceur"), lin: tt("Régulière"), fixe: tt("Fixe (par paliers, sans intermédiaire)") };
const ease = (u, e) => (e === "fixe" ? 0 : e === "lin" ? u : u * u * (3 - 2 * u));
const NUM = ["x", "y", "s", "rz", "cx", "cy", "z", "rot", "dz", "fo", "bl", "fx", "lw", "shg", "shw", "sha", "zoom", "ox", "oy"];
// mouvements de camera prets : [nom, depart, arrivee]
export const MOVES = {
  "trav-d": [tt("Travelling vers la droite"), { cx: 0.38, z: 1.35 }, { cx: 0.62, z: 1.35 }],
  "trav-g": [tt("Travelling vers la gauche"), { cx: 0.62, z: 1.35 }, { cx: 0.38, z: 1.35 }],
  "avant": [tt("Travelling avant (on s'approche)"), { z: 1 }, { z: 1.7 }],
  "arriere": [tt("Travelling arrière (on s'éloigne)"), { z: 1.7 }, { z: 1 }],
  "pano-h": [tt("Panoramique vers le haut"), { cy: 0.62, z: 1.35 }, { cy: 0.38, z: 1.35 }],
  "pano-b": [tt("Panoramique vers le bas"), { cy: 0.38, z: 1.35 }, { cy: 0.62, z: 1.35 }],
  "zoom": [tt("Zoom avant rapide"), { z: 1 }, { z: 2.4 }],
  "dolly": [tt("Avancer dans la profondeur (les plans se détachent)"), { dz: 0 }, { dz: 0.7 }],
  "dolly-r": [tt("Reculer dans la profondeur"), { dz: 0.7 }, { dz: 0 }],
  "dutch": [tt("Bascule (caméra qui penche)"), { rot: -6, z: 1.25 }, { rot: 6, z: 1.25 }],
  "fixe": [tt("Plan fixe (retire le mouvement)"), null, null],
};

// Canaux de la camera, quand on les deploie dans la timeline (clic droit sur la piste Camera)
export const CHANNELS = [["cx", tt("Cadre ↔")], ["cy", tt("Cadre ↕")], ["z", tt("Zoom")], ["rot", tt("Inclinaison")], ["dz", tt("Avancer")]];
/** Valeurs d'une piste a l'instant t. base : valeurs sans cle. n : nombre d'images de l'orbite (pour tourner au plus court).
 *  Une cle peut ne valoir que pour certains canaux : k.skip = canaux ou elle ne compte pas (canaux deployes). Chaque canal
 *  s'interpole alors entre les cles qui le portent. */
export function valueAt(keys, base, t, n) {
  if (!keys || !keys.length) return Object.assign({}, base);
  if (keys.some((k) => k.skip && k.skip.length)) {
    const out = valueAt(keys.map((k) => (k.skip ? Object.fromEntries(Object.entries(k).filter(([q]) => q !== "skip")) : k)), base, t, n);
    for (const p of NUM) {
      const ks = keys.filter((k) => k[p] != null && !(k.skip || []).includes(p));
      if (!ks.length) { if (keys.some((k) => k[p] != null)) out[p] = base[p]; continue; }
      if (t <= ks[0].t) { out[p] = ks[0][p]; continue; }
      if (t >= ks[ks.length - 1].t) { out[p] = ks[ks.length - 1][p]; continue; }
      let i = 0;
      while (i < ks.length - 2 && ks[i + 1].t <= t) i++;
      const a = ks[i], b = ks[i + 1], u = ease((t - a.t) / Math.max(1e-6, b.t - a.t), b.e);
      out[p] = a[p] + (b[p] - a[p]) * u;
    }
    for (const p of ["f", "v"]) {                            // angle de l'orbite (au plus court) et pose (par paliers)
      const ks = keys.filter((k) => k[p] != null && !(k.skip || []).includes(p));
      if (!ks.length) { if (keys.some((k) => k[p] != null)) out[p] = base[p]; continue; }
      if (p === "v") { let v = ks[0].v; for (const k of ks) if (k.t <= t) v = k.v; out.v = v; continue; }
      if (t <= ks[0].t) { out.f = ks[0].f; continue; }
      if (t >= ks[ks.length - 1].t) { out.f = ks[ks.length - 1].f; continue; }
      let i = 0;
      while (i < ks.length - 2 && ks[i + 1].t <= t) i++;
      const a = ks[i], b = ks[i + 1];
      if (b.e === "fixe") { out.f = a.f; continue; }
      const u = ease((t - a.t) / Math.max(1e-6, b.t - a.t), b.e);
      let d = b.f - a.f;
      if (n) { d = ((d % n) + n) % n; if (d > n / 2) d -= n; }
      out.f = Math.round(a.f + d * u);
      if (n) out.f = ((out.f % n) + n) % n;
    }
    return out;
  }
  const ks = keys;
  if (t <= ks[0].t) return Object.assign({}, base, ks[0]);
  if (t >= ks[ks.length - 1].t) return Object.assign({}, base, ks[ks.length - 1]);
  let i = 0;
  while (i < ks.length - 2 && ks[i + 1].t <= t) i++;
  const a = ks[i], b = ks[i + 1], u = ease((t - a.t) / Math.max(1e-6, b.t - a.t), b.e);
  const out = Object.assign({}, base, a);
  // une cle posee avant qu'un reglage existe (ou sans lui) vaut la valeur de base : l'interpolation se fait quand meme
  for (const k of NUM) { const av = a[k] ?? base[k], bv = b[k] ?? base[k]; if (av != null && bv != null) out[k] = av + (bv - av) * u; }
  if (a.f != null && b.f != null && b.e !== "fixe") {
    let d = b.f - a.f;
    if (n) { d = ((d % n) + n) % n; if (d > n / 2) d -= n; }      // l'orbite boucle : on tourne par le plus court chemin
    out.f = Math.round(a.f + d * u);
    if (n) out.f = ((out.f % n) + n) % n;
  }
  return out;
}

/** Scene d'une case animee : tout ce qu'il faut pour la dessiner a un instant donne (montage et deck). */
export function makeScene(app, pg, pan, ratio, pre = "mt") {
  const H = W * ratio, bb = { x0: 0, y0: 0, w: W, h: H };
  pan.layers = pan.layers || [];
  const anim = pan.anim || { dur: 4, tracks: {} };
  const bgInfo = background(pan, app.bank, app.project.id);
  for (const l of pan.layers) { const it = app.bank.get(l.item); if (it) preload(it, l.v); }
  const itemOf = (l) => app.bank.get(l.item);
  const nOf = (l, v) => { const it = itemOf(l), vv = it && variantOf(it, v || l.v); return vv && vv.orbit ? vv.orbit.n : 0; };
  const keysOf = (id) => (anim.tracks || {})[id] || [];
  // orientation du personnage a cette image de l'orbite, en radians (0 = de face) : la bouche tourne avec lui
  const angleOf = (l, v, f) => { const it = itemOf(l), vv = it && variantOf(it, v || l.v); return vv && vv.orbit && vv.orbit.n ? frameToAngle(vv.orbit, f || 0) * Math.PI / 180 : 0; };
  const baseOf = (l) => { const sh = l.sh || {}; return { x: l.x, y: l.y, s: l.s, rz: l.rz || 0, f: l.f || 0, v: l.v, lw: l.lw || 0, shg: sh.g ?? 0.72, shw: sh.w ?? 5, sha: sh.a ?? 135 }; };
  // piste muette (anim.mute = { id: instant }) : son animation est figee a l'instant ou on l'a coupee
  const tm = (id, t) => { const q = anim.mute && anim.mute[id]; return q != null ? q : t; };
  // valeurs propres d'un element (ses cles), sans son parent
  const localOf = (l, t) => { t = tm(l.id, t); const k = keysOf(l.id), b = baseOf(l), v0 = valueAt(k, b, t, 0); return valueAt(k, b, t, nOf(l, v0.v)); };
  // nulls (anim.nulls = [{ id, name, x, y, s, rz }]) : des reperes animables, invisibles a l'image, sur lesquels on parente
  // des elements (anim.par = { idElement: { id: idNull, x, y, s, rz } }, valeurs du null au moment du parentage). L'element
  // suit ce que le null a fait depuis : deplacement, rotation autour du null, echelle ; a sa pose de parentage, rien ne change.
  const nullOf = (id) => (anim.nulls || []).find((n) => n.id === id);
  const nullLocal = (n, t) => valueAt(keysOf(n.id), { x: n.x, y: n.y, s: n.s ?? 1, rz: n.rz || 0 }, tm(n.id, t), 0);
  const xfOf = (id, t, depth = 0) => {                     // transformation heritee du parent (en pixels de l'image), ou null
    const par = anim.par && anim.par[id], n = par && nullOf(par.id);
    if (!n || depth > 8) return null;
    const P = nullWorld(n, t, depth + 1), dr = P.rz - (par.rz || 0);
    return { th: dr * Math.PI / 180, dr, k: (P.s || 1) / (par.s || 1), ox: par.x * W, oy: par.y * H, nx: P.x * W, ny: P.y * H };
  };
  const movePt = (X, Y, q) => { const dx = X - q.ox, dy = Y - q.oy, c = Math.cos(q.th), s = Math.sin(q.th); return [q.nx + q.k * (c * dx - s * dy), q.ny + q.k * (s * dx + c * dy)]; };
  function nullWorld(n, t, depth = 0) {
    const s = nullLocal(n, t), q = xfOf(n.id, t, depth);
    if (!q) return s;
    const [X, Y] = movePt(s.x * W, s.y * H, q);
    return Object.assign({}, s, { x: X / W, y: Y / H, s: s.s * q.k, rz: s.rz + q.dr });
  }
  // element a l'image : ses valeurs, emmenees par son null (le centre de l'element tourne autour du null)
  const stateOf = (l, t) => {
    const s = localOf(l, t), q = xfOf(l.id, t);
    if (!q) return s;
    const [X, Y] = movePt(s.x * W, (s.y - s.s / 2) * H, q), s1 = s.s * q.k;
    return Object.assign({}, s, { x: X / W, y: Y / H + s1 / 2, s: s1, rz: (s.rz || 0) + q.dr });
  };
  // un deplacement a l'image (fractions de la case) ramene dans le repere de l'element parente
  const unDelta = (id, t, dx, dy) => {
    const q = xfOf(id, t);
    if (!q) return [dx, dy];
    const X = dx * W, Y = dy * H, c = Math.cos(-q.th), s = Math.sin(-q.th);
    return [(c * X - s * Y) / q.k / W, (s * X + c * Y) / q.k / H];
  };
  const viewAt = (t) => {                                   // taille et place du decor : fixes, ou piste « Décor » (anim.bgAnim)
    const v = pan.view || {}, base = { zoom: v.zoom || 1, ox: v.ox || 0, oy: v.oy || 0 };
    if (!anim.bgAnim || !keysOf("bg").length) return base;
    const q = valueAt(keysOf("bg"), base, tm("bg", t), 0);
    return { zoom: q.zoom, ox: q.ox, oy: q.oy };
  };
  const camAt = (t) => {
    const d = pan.dof || {}, c = valueAt(keysOf("cam"), CAM0, tm("cam", t), 0);
    c.fo = valueAt(keysOf("fo"), { fo: c.fo ?? d.focus ?? 0.3 }, tm("fo", t), 0).fo;
    c.bl = valueAt(keysOf("bl"), { bl: c.bl ?? d.amount ?? 12 }, tm("bl", t), 0).bl;
    const fx = pan.draw && pan.draw.fx;                      // lignes d'effet du fond : leur force, animable
    c.fx = fx && fx.on ? (fx.anim ? valueAt(keysOf("fx"), { fx: fx.force ?? 1 }, tm("fx", t), 0).fx : (fx.force ?? 1)) : 0;
    return c;
  };
  /** Camera a l'epaule (anim.shake = { on, a : amplitude en % de la largeur, v : vitesse, r : roulis en degres }) : le cadre
   *  tangue en douceur (somme de sinus de periodes sans rapport simple : jamais deux fois le meme mouvement), avec un leger
   *  zoom pour que les bords du decor ne se voient pas. Ajoute a l'image seulement : les cles de la camera n'en gardent rien. */
  const shaken = (c, t) => {
    const k = anim.shake;
    if (!k || !k.on) return c;
    const a = (k.a ?? 1) / 100, v = k.v ?? 1, r = k.r ?? 1, T = t * v;
    const n = (s) => 0.55 * Math.sin(T * 1.13 * s + s * 3.1) + 0.3 * Math.sin(T * 2.71 * s + s * 1.7) + 0.15 * Math.sin(T * 6.07 * s + s * 5.3);
    const z = c.z * (1 + 2.2 * a);
    return Object.assign({}, c, { z, cx: c.cx + a * n(1) / z, cy: c.cy + a * n(1.37) * W / H / z, rot: (c.rot || 0) + r * n(1.91) });
  };
  // formes dessinees sur le decor : dans le montage chacune a sa profondeur (forme.d, 1 = collee au decor), pour la
  // parallaxe. Elles ne bougent qu'en profondeur ; leur dessin se regle dans « Dessiner le fond ».
  const shapesOf = () => (pan.draw && pan.draw.shapes) || [];
  const shapeCache = new Map();
  const shapeSvg = (sh, i) => { const key = i + JSON.stringify(sh, (k, v) => (k === "d" ? undefined : v)); let x = shapeCache.get(key); if (!x) { if (shapeCache.size > 300) shapeCache.clear(); x = drawSvg({ shapes: [sh] }, H, `${pre}d${i}`); shapeCache.set(key, x); } return x; };
  /** Balisage SVG de la case a l'instant t. sel : calque a encadrer. again : rappele quand des traces finissent de charger.
   *  px : pixels d'ecran par unite de l'image (taille des poignees). */
  function markup(t, sel, again, px) {
    const c = shaken(camAt(t), t), dofOn = !!(pan.dof && pan.dof.on), blurs = {};
    // profondeur de champ : plus un plan est loin de la mise au point, plus il est flou
    const dofBlur = (depth) => (dofOn ? c.bl / 1000 * H * Math.abs(depth - c.fo) : 0);
    const blur = (depth, more = 0) => {
      const a = dofBlur(depth) + more;
      if (!(a > 0.4)) return "";
      const q = Math.round(a * 4);
      blurs[q] = `<filter id="${pre}bl${q}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${q / 4}"/></filter>`;
      return ` filter="url(#${pre}bl${q})"`;
    };
    let o = `<defs><clipPath id="${pre}clip"><rect width="${W}" height="${f1(H)}"/></clipPath></defs><rect width="${W}" height="${f1(H)}" fill="${pg.page.fill || "#fff"}"/>` +
      `<g clip-path="url(#${pre}clip)"><g transform="translate(${W / 2} ${f1(H / 2)}) rotate(${f1(-c.rot)}) scale(${f3(c.z)}) translate(${f1(-c.cx * W)} ${f1(-c.cy * H)})">`;
    // un plan a la profondeur d : il glisse avec la parallaxe et grossit quand la camera avance (le decor, d = 1, a peine)
    const plane = (d, inner) => {
      const par = anim.parallax ? (anim.pstr ?? 0.4) * (d - 0.5) : 0, k = perspOf(d, c.dz);
      return k ? `<g transform="translate(${f1((c.cx - 0.5) * par * W + c.cx * W)} ${f1((c.cy - 0.5) * par * H + c.cy * H)}) scale(${f3(k)}) translate(${f1(-c.cx * W)} ${f1(-c.cy * H)})"><g${blur(d)}>${inner}</g></g>` : "";
    };
    let bgIn = "";
    { const o0 = o; o = "";
    if (bgInfo) {
      const pl = placement(bb, bgInfo.w || 16, bgInfo.h || 9, viewAt(t)), vf = vecFrame(bgInfo, again);
      if (vf) { const st = inkStroke(pan.bglw), bw = wiggleFilter(`${pre}wgb`, pan.bghand, pan.bgwave, vf.w, vf.h, 11); o += `<g transform="translate(${f1(pl.x)} ${f1(pl.y)}) scale(${f3(pl.w / vf.w)} ${f3(pl.h / vf.h)})">${bw}<path d="${vf.body}" fill="#fff"/><path d="${vf.ink}"${bw ? ` filter="url(#${pre}wgb)"` : ""} fill="#111" fill-rule="evenodd" stroke="${st.color}" stroke-width="${st.width}"/></g>`; }
      else o += `<image href="${bgInfo.url}" x="${f1(pl.x)}" y="${f1(pl.y)}" width="${f1(pl.w)}" height="${f1(pl.h)}" preserveAspectRatio="none"/>`;
      const bcm = bgCM(pan);                               // colorimetrie et colorize du decor
      if (bcm) o = cmFilter(`${pre}bcm`, bcm) + `<g filter="url(#${pre}bcm)">` + o + "</g>";
    }
    o += groundSvg(pan.ground, { x: 0, y: 0, w: W, h: H }, pre + "gr");          // carte de sol, en perspective (ground.js)
    bgIn = o; o = o0 + plane(1, bgIn); }
    const drawLayer = (l, li) => {
      const s = stateOf(l, t), it = itemOf(l), sp = it && sprite(it, s.v, s.f);
      if (!sp) return;
      // parallaxe : quand la camera se deplace, le premier plan glisse plus que le fond (profondeur 0 = devant, 1 = fond)
      const par = anim.parallax ? (anim.pstr ?? 0.4) * (depthOf(pan, li) - 0.5) : 0, bl = blur(depthOf(pan, li));
      const kp = perspOf(depthOf(pan, li), c.dz);
      if (!kp) return;                                     // la camera l'a depasse
      const box = layerBox(bb, Object.assign({}, l, s, { x: c.cx + (s.x - c.cx) * kp + (c.cx - 0.5) * par, y: c.cy + (s.y - c.cy) * kp + (c.cy - 0.5) * par, s: s.s * kp }), sp), vf = vecFrame(l.ill ? null : sp, again);
      const flip = l.flip ? `translate(${f1(2 * box.cx)} 0) scale(-1 1) ` : "";
      const gsd = groundShadow(l, box);                    // ombre portee : sous l'element
      const rz = s.rz || 0;                 // ce qui suit (dessin, bouche, cadre, poignees) tourne autour du centre
      if (gsd) o += `<path d="${gsd.d}" fill="${gsd.col}" opacity="${f3(gsd.a)}" style="pointer-events:none"${blur(depthOf(pan, li), gsd.blur)}/>`;
      const o1 = o.length;
      let lipAt = l.lip;
      if (vf) {
        const sc = Math.min(box.w / vf.w, box.h / vf.h), tx = box.x + (box.w - vf.w * sc) / 2, ty = box.y + box.h - vf.h * sc, col = bodyFill(l), ink = inkFill(l), st = inkStroke(s.lw, col, ink, vf.sw), tm = thinMask(`${pre}m-${l.id}`, vf.body, st.thin);
        const shd = shadeOf(l.sh && l.sh.on ? Object.assign({}, l.sh, { g: s.shg, w: s.shw, a: s.sha }) : null, vf.h, col, ink);
        let inner = "";
        if (shd) shadeShapes(l.sh, vf).forEach((pd, i) => { inner += `<clipPath id="${pre}s-${l.id}-${i}"><path d="${pd}"/></clipPath><g clip-path="url(#${pre}s-${l.id}-${i})"><path d="${pd}" fill="${shd.fill}"/><path d="${pd}" fill="${col}" transform="translate(${f1(l.flip ? -shd.dx : shd.dx)} ${f1(shd.dy)})"/></g>`; });
        // tremble anime (l.boil = { on, a : intensite, v : changements par seconde }) : le trait change de tremble en boucle, sur 4 dessins
        const boil = l.boil && l.boil.on ? l.boil : null;
        const lwf = wiggleFilter(`${pre}wg-${l.id}`, boil ? (boil.a ?? 2) : l.hand, l.wave, vf.w, vf.h, boil ? 5 + (Math.floor(t * (boil.v ?? 8)) % 4) * 13 : 5);
        // portrait-robot : la tete en traces, tournee comme le corps ; si le personnage parle, c'est la bouche du lip sync qui s'y pose
        const fo = faceFor(it, sp, vf, angleOf(l, s.v, s.f), { peau: col, trait: ink, lw: lineWidth(vf.sw, s.lw), bouche: !(l.lip && l.lip.on) }, again), fattr = ` data-layer="${l.id}"`;
        if (fo && !(l.lip && l.lip.set === PERSO && hasPerso(it))) lipAt = Object.assign({}, l.lip, { x: (tx + fo.mouth.x * sc - box.x) / box.w, y: (ty + fo.mouth.y * sc - box.y) / box.h, hw: 0, s: l.lip && l.lip.s != null ? l.lip.s : fo.mouth.s * sc / box.h });
        o += `<g${bl}><g data-layer="${l.id}" transform="${flip}translate(${f1(tx)} ${f1(ty)}) scale(${f3(sc)})">${lwf}<g${lwf ? ` filter="url(#${pre}wg-${l.id})"` : ""}>${fo ? opsSvg(fo.under, fattr) : ""}${tm}<g${tm ? ` mask="url(#${pre}m-${l.id})"` : ""}><clipPath id="${pre}c-${l.id}"><path d="${vf.body}"/></clipPath><path d="${vf.body}" fill="${col}" data-layer="${l.id}"/>` +
          `<g clip-path="url(#${pre}c-${l.id})" style="pointer-events:none">${inner}<path d="${vf.ink}" fill="${ink}" fill-rule="evenodd" stroke="${st.color}" stroke-width="${st.width}" stroke-linejoin="round"/></g></g>${fo ? opsSvg(fo.over, fattr) : ""}</g></g></g>`;
      } else o += `<image${bl} data-layer="${l.id}" href="${sp.url}" x="${f1(box.x)}" y="${f1(box.y)}" width="${f1(box.w)}" height="${f1(box.h)}" preserveAspectRatio="xMidYMax meet"${flip ? ` transform="${flip}"` : ""}/>`;
      const o2 = o.length;                                 // fin du dessin : la gomme de la bouche s'y applique
      const exk = sp.orbit && sp.expr ? exprAt(l, t) : "";
      let egm = "";                                        // gomme de l'expression : <g transform>...</g> a poser dans le masque du dessin
      if (exk) {                                           // expression du visage ; pendant que la voix joue, exprAt n'en donne pas (la bouche l'emporte)
        const ef = mouthFrame(sp, again);
        if (ef && ef.expr) { const esc = Math.min(box.w / ef.w, box.h / ef.h), et = `${flip}translate(${f1(box.x + (box.w - ef.w * esc) / 2)} ${f1(box.y + box.h - ef.h * esc)}) scale(${f3(esc)})`;
          o += `<g${bl}><g data-expr="${l.id}" transform="${et}" style="pointer-events:none">${exprMarkup(exk, ef.expr, ef.all, sp.i)}</g></g>`;
          const g0 = exprGom(exk, ef.expr, ef.all, sp.i);
          if (g0) egm = `<g transform="${et}">${g0}</g>`; }
      }
      const gomWrap = (inner) => {                         // le dessin (o1..o2) sous un masque : les gommes y sont posees en noir
        const gid = `${pre}gm-${l.id}`, mg = box.h;
        o = o.slice(0, o1) + `<mask id="${gid}" maskUnits="userSpaceOnUse" x="${f1(box.x - mg)}" y="${f1(box.y - mg)}" width="${f1(box.w + 2 * mg)}" height="${f1(box.h + 2 * mg)}"><rect x="${f1(box.x - mg)}" y="${f1(box.y - mg)}" width="${f1(box.w + 2 * mg)}" height="${f1(box.h + 2 * mg)}" fill="#fff"/>${inner}</mask>` +
          `<g mask="url(#${gid})">${o.slice(o1, o2)}</g>` + o.slice(o2);
      };
      let gomDone = false;
      if (l.lip && l.lip.on) {                             // lip sync : la bouche qui parle
        const tr = usesTrace(l.lip, sp);
        if (!tr) o += `<g${bl}>${lipMarkup(lipAt, box, l.flip, t, angleOf(l, s.v, s.f), `${pre}lp-${l.id}`, bodyFill(l), it)}</g>`;
        if (sp.orbit) {                                    // groupe en pixels de l'image d'orbite, pose comme elle : la bouche du dessin s'y dessine, et l'outil « Tracer la bouche » y lit le trait
          const mf = tr ? mouthFrame(sp, again) : null, mw = mf ? mf.w : sp.w, mh = mf ? mf.h : sp.h, msc = Math.min(box.w / mw, box.h / mh);
          const mt = `${flip}translate(${f1(box.x + (box.w - mw * msc) / 2)} ${f1(box.y + box.h - mh * msc)}) scale(${f3(msc)})`;
          // gomme de la carte (tools/levres_dzine.py) : efface le dessin d'origine la ou la tete redessinee est plus etroite
          // (menton, joue) ; posee comme la carte, en noir dans un masque du dessin
          const gm = mf && mf.lips ? cardGom(l.lip, mf.lips, mf.all, sp.i, t) : "";
          if (gm || egm) { gomWrap((gm ? `<g transform="${mt}">${gm}</g>` : "") + egm); gomDone = true; }
          o += `<g${bl}><g data-mouth="${l.id}" transform="${mt}" style="pointer-events:none">${mf ? (cardMarkup(l.lip, mf.lips, mf.all, sp.i, t) ?? traceMarkup(l.lip, mf.m, t, `${pre}lp-${l.id}`, bodyFill(l))) : ""}</g></g>`;
        }
      }
      if (egm && !gomDone) gomWrap(egm);                   // gomme de l'expression, sans lip sync
      const cm = layerCM(l, !!vf);                         // colorize et colorimetrie : l'image et ses bouches prennent la meme couleur
      if (cm) o = o.slice(0, o1) + cmFilter(`${pre}tn-${l.id}`, cm) + `<g filter="url(#${pre}tn-${l.id})">` + o.slice(o1) + "</g>";
      if (rz) o = o.slice(0, o1) + `<g transform="rotate(${f1(rz)} ${f1(box.cx)} ${f1(box.y + box.h / 2)})">` + o.slice(o1) + "</g>";
      if (sel === l.id) {                                  // poignees : les memes que dans les cases (handles.js)
        const u = 1 / ((px || 1 / 2.4) * c.z), hx = W / 2 / c.z, hy = H / 2 / c.z;
        const vis = c.rot ? null : { x0: c.cx * W - hx, x1: c.cx * W + hx, y0: c.cy * H - hy, y1: c.cy * H + hy };   // le cadre de la camera
        o += handlesSvg({ box, rz, u, view: vis, bounds: vis, orbit: !!sp.orbit, attrs: ` data-layer="${l.id}"` });
      }
    };
    // formes du decor et elements, du plus loin au plus pres ; a profondeur egale, les formes passent derriere
    const order = [];
    shapesOf().forEach((sh, i) => order.push({ d: sh.d ?? 1, k: 0, i }));
    pan.layers.forEach((l, i) => order.push({ d: depthOf(pan, i), k: 1, i }));
    const fxd = pan.draw && pan.draw.fx;
    if (fxd && fxd.on) order.push({ d: 1, k: 0.5, i: 0 });  // les lignes d'effet : sur le decor, sous les elements
    order.sort((a, b) => b.d - a.d || a.k - b.k || a.i - b.i);
    for (const e of order) {
      if (e.k === 0.5) {                                   // fixes a l'ecran (la camera ne les deplace pas) ; animables, elles vibrent a 12 images par seconde
        o += `<g transform="translate(${f1(c.cx * W)} ${f1(c.cy * H)}) scale(${f3(1 / c.z)}) rotate(${f1(c.rot)}) translate(${f1(-W / 2)} ${f1(-H / 2)})">${fxSvg(fxd, H, pre, c.fx, fxd.anim ? Math.floor(t * 12) : 0)}</g>`;
        continue;
      }
      if (e.k) { drawLayer(pan.layers[e.i], e.i); continue; }
      const sh = shapesOf()[e.i], b = sel === "s:" + sh.id ? boxOf(sh, H) : null;
      o += plane(e.d, shapeSvg(sh, e.i) + (b ? `<rect x="${f1(b.x - 4)}" y="${f1(b.y - 4)}" width="${f1(b.w + 8)}" height="${f1(b.h + 8)}" class="mt-sel" transform="rotate(${f1(sh.r || 0)} ${f1(b.cx)} ${f1(b.cy)})"/>` : ""));
    }
    if (pre === "mt") for (const n of anim.nulls || []) {     // les nulls : une croix dans un carre, invisibles au rendu
      const P = nullWorld(n, t), u = 1 / ((px || 1 / 2.4) * c.z), r = 14 * u, col = sel === n.id ? "#ff8a1f" : "#e0457b";
      o += `<g data-null="${n.id}" class="mt-null" transform="translate(${f1(P.x * W)} ${f1(P.y * H)})"><g transform="rotate(${f1(P.rz)}) scale(${f3(P.s)})">` +
        `<rect data-null="${n.id}" x="${f1(-r)}" y="${f1(-r)}" width="${f1(2 * r)}" height="${f1(2 * r)}" fill="rgba(255,255,255,0.06)" stroke="${col}" stroke-width="${f1(2 * u)}" vector-effect="non-scaling-stroke"/>` +
        `<path data-null="${n.id}" d="M${f1(-2 * r)} 0H${f1(2 * r)}M0 ${f1(-2 * r)}V${f1(2 * r)}" stroke="${col}" stroke-width="${f1(2 * u)}" vector-effect="non-scaling-stroke"/></g>` +
        `<text data-null="${n.id}" x="${f1(r + 4 * u)}" y="${f1(-r - 4 * u)}" font-size="${f1(12 * u)}" fill="${col}" style="font-family:sans-serif">${String(n.name || "Null").replace(/[<&]/g, "")}</text></g>`;
    }
    return o + `</g></g><defs>${Object.values(blurs).join("")}</defs><rect width="${W}" height="${f1(H)}" class="mt-frame"/>`;
  }
  return { H, anim, markup, stateOf, localOf, camAt, viewAt, nOf, itemOf, keysOf, angleOf, nullOf, nullLocal, nullWorld, xfOf, unDelta };
}

export function openMontage(app, pid) {
  const pg = app.page(), src = pg.panels[pid] || {}, g = app.geo(pid);
  if (!g) return;
  const H = W * g.bbox.h / g.bbox.w, bb = { x0: 0, y0: 0, w: W, h: H };
  const pan = JSON.parse(JSON.stringify(src));            // copie de travail : rien ne change avant « Enregistrer »
  pan.layers = pan.layers || [];
  const anim = pan.anim = Object.assign({ dur: 4, tracks: {} }, pan.anim);
  const dof = pan.dof = Object.assign({ on: false, focus: 0.3, amount: 12 }, pan.dof);
  anim.tracks = anim.tracks || {};
  let t = 0, sel = "cam", selKey = null, playing = false, loop = true, auto = localStorage.getItem("bw.autokey") !== "0", raf = 0, last = 0, drag = null;
  let recArmed = false, recAct = null, recRaf = 0, recBtn = null;      // Rec Action (voir recStart)
  const picked = new Set();                                // cles prises au lasso (ou Ctrl + clic) : elles bougent et s'effacent ensemble
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  const pen = (on) => svg.classList.toggle("tracing", !!on);   // curseur crayon pendant le trace de la bouche
  svg.setAttribute("viewBox", `0 0 ${W} ${f1(H)}`); svg.setAttribute("class", "mt-stage");
  const scene = makeScene(app, pg, pan, g.bbox.h / g.bbox.w);
  const layerOf = (id) => pan.layers.find((l) => l.id === id);
  const itemOf = scene.itemOf, nOf = scene.nOf;
  const keysOf = (id) => anim.tracks[id] || [];
  const stateOf = (l) => scene.localOf(l, t);              // valeurs propres (cles, reglages) ; worldOf : a l'image (parent compris)
  const worldOf = (l) => scene.stateOf(l, t);
  const nullOf = (id) => scene.nullOf(id);
  function addNull() {                                     // un null au centre de l'image
    stop();
    const ns = anim.nulls = anim.nulls || [], c = camAt();
    let k = ns.length + 1; while (ns.some((n) => n.name === tt`Null ${k}`)) k++;
    const n = { id: "n" + Math.random().toString(36).slice(2, 8), name: tt`Null ${k}`, x: f3(c.cx), y: f3(c.cy), s: 1, rz: 0 };
    ns.push(n); sel = n.id; selKey = null;
    hist.snap(); paint(); lanes(); props();
    toast(tt("Null ajouté : parente des éléments dessus (clic droit sur un élément › Parent, ou son panneau)."));
  }
  function removeNull(n) {                                 // ses enfants restent, a leur place sans lui
    anim.nulls = (anim.nulls || []).filter((x) => x !== n);
    if (!anim.nulls.length) delete anim.nulls;
    delete anim.tracks[n.id];
    if (anim.par) { for (const [k, v] of Object.entries(anim.par)) if (v.id === n.id) delete anim.par[k]; if (!Object.keys(anim.par).length) delete anim.par; }
    if (sel === n.id) sel = "cam";
    selKey = null; hist.snap(); paint(); lanes(); props();
  }
  function parentTo(id, nid) {                             // parenter : le null tel qu'il est maintenant devient la pose de reference
    const n = nullOf(nid); if (!n) return;
    const P = scene.nullWorld(n, t);
    anim.par = anim.par || {};
    anim.par[id] = { id: nid, x: f3(P.x), y: f3(P.y), s: +(+P.s).toFixed(4), rz: +(+P.rz).toFixed(2) };
    hist.snap(); paint(); lanes(); props();
  }
  function unparent(id) {
    if (!anim.par || !anim.par[id]) return;
    delete anim.par[id]; if (!Object.keys(anim.par).length) delete anim.par;
    hist.snap(); paint(); lanes(); props();
  }
  const parentOf = (id) => (anim.par && anim.par[id] ? nullOf(anim.par[id].id) : null);
  function renameNull(n) { const v = window.prompt(tt("Nom du null :"), n.name || ""); if (v && v.trim()) { n.name = v.trim().slice(0, 40); hist.snap(); paint(); lanes(); props(); } }
  const KEYED = ["x", "y", "s", "rz", "f", "v", "lw", "shg", "shw", "sha"];
  const camAt = () => scene.camAt(t);
  let focusPick = false, focusBtn = null;                  // cible : le prochain clic sur un element fait la mise au point sur lui
  const setFocusPick = (on) => { focusPick = !!on; svg.classList.toggle("focus-pick", focusPick); if (focusBtn) focusBtn.classList.toggle("on", focusPick); };
  let camLock = false;                                       // « Bouger la camera » verrouille : tout geste dans l'image deplace le cadre
  const muteOf = (id) => { const q = anim.mute && anim.mute[id]; return q != null ? q : null; };
  function toggleMute(id) {                                  // couper une piste : elle reste figee a l'instant de la tete de lecture
    if (muteOf(id) != null) { delete anim.mute[id]; if (!Object.keys(anim.mute).length) delete anim.mute; }
    else (anim.mute = anim.mute || {})[id] = f3(t);
    hist.snap(); paint(); lanes(); props();
  }
  let stretchOn = false;                                     // « Resize » : une barre a deux poignees etire ou resserre les cles prises
  // canaux deployes dans la timeline : la camera et chaque element (clic droit sur sa piste) ; une piste par reglage
  const chanOpen = new Set((() => { try { return JSON.parse(localStorage.getItem("bw.chanOpen") || "[]"); } catch (e) { return []; } })());
  if (localStorage.getItem("bw.camChannels") === "1") chanOpen.add("cam");
  const chanToggle = (id) => { if (chanOpen.has(id)) chanOpen.delete(id); else chanOpen.add(id);
    localStorage.setItem("bw.camChannels", chanOpen.has("cam") ? "1" : ""); localStorage.setItem("bw.chanOpen", JSON.stringify([...chanOpen].slice(-60))); lanes(); };
  const LAYER_CHANNELS = [["x", tt("Position ↔")], ["y", tt("Position ↕")], ["s", tt("Taille")], ["rz", tt("Inclinaison")], ["f", tt("Angle (orbite)")], ["v", tt("Pose")],
    ["lw", tt("Trait")], ["shg", tt("Ombre : gris")], ["shw", tt("Ombre : largeur")], ["sha", tt("Ombre : lumière")]];
  const BG_CHANNELS = [["zoom", tt("Taille")], ["ox", tt("Position ↔")], ["oy", tt("Position ↕")]];
  const chansOf = (id) => (id === "cam" ? CHANNELS : id === "bg" ? BG_CHANNELS : layerOf(id) ? LAYER_CHANNELS : nullOf(id) ? LAYER_CHANNELS.slice(0, 4) : []);
  const CAMS = { cam: tt("Caméra"), fo: tt("Mise au point"), bl: tt("Flou"), fx: tt("Lignes d'effet"), bg: tt("Décor") };      // pistes de la camera ; fo et bl : profondeur de champ

  // ------------------------------------------------------------------------------------------ visionneuse
  // pastille de la bouche (panneau de droite) : verte = une bouche calculee pour cette orientation, rouge = aucune. Mise a jour a chaque image (l'orientation peut etre animee).
  let mouthDot = null;
  function mouthStatus(l) {
    const lip = l.lip || {}, st = stateOf(l), it = itemOf(l), sp = it && sprite(it, st.v, st.f);
    if (!sp) return ["red", tt("Pas d'image pour cette pose.")];
    if (lip.set && lip.set !== TRACE && lip.set !== PERSO) return ["green", tt("Bouches dessinées toutes faites : posées sur le visage, à tous les angles de face.")];
    if (lip.set === PERSO || (!lip.set && !sp.mouth && hasPerso(it))) return Math.cos(scene.angleOf(l, st.v, st.f)) >= -0.12 ? ["green", tt("Les bouches du personnage lui-même.")] : ["red", tt("De dos : ses propres bouches ne se montrent pas à cet angle.")];
    const mf = sp.mouth ? mouthFrame(sp, () => updMouthDot()) : null;
    if (!sp.mouth) return ["red", tt("Pas de bouche tracée pour cette pose (montage : « Tracer la bouche »).")];
    if (!mf) return ["grey", tt("Chargement…")];
    const ck = cardKey(mf.lips, mf.all, sp.i), m = mf.m;
    if (ck) return ["green", tt`Bouche calculée disponible à cet angle (image ${sp.i}, carte de l'image ${ck.key.f}${ck.key.dos ? tt(", de dos") : ""}).`];
    return ["red", tt`Pas de bouche calculée à cet angle (image ${sp.i}).`];
  }
  function updMouthDot() {
    if (!mouthDot || !mouthDot.isConnected) { mouthDot = null; return; }
    const l = layerOf(mouthDot.dataset.l);
    if (!l) return;
    const [c, why] = mouthStatus(l);
    if (mouthDot.dataset.c !== c) { mouthDot.dataset.c = c; mouthDot.className = "mdot " + c; }
    if (mouthDot.title !== why) mouthDot.title = why;
  }
  // la meme pastille en haut a droite du cadre de l'element choisi : on voit en le tournant s'il a une bouche a cet angle
  function boxDot() {
    const g = svg.querySelector(".lh[data-layer]"), bx = g && g.querySelector(".lh-box"), l = g && layerOf(g.dataset.layer);
    if (!bx || !l) return;
    const st = stateOf(l), it = itemOf(l), sp = it && sprite(it, st.v, st.f), lip = l.lip || {};
    if (!sp || !(lip.on || sp.mouth || lip.set)) return;      // pas de bouche en jeu (accessoire, decor) : pas de pastille
    const [c, why] = mouthStatus(l), m = g.getScreenCTM(), u = m ? 1 / (Math.hypot(m.a, m.b) || 1) : 1;
    // a cote de la boule du coin en haut a droite (elle reste dans la partie visible du cadre)
    const pts = [...g.querySelectorAll('g[data-h="corner"]')].map((e) => (e.getAttribute("transform").match(/translate\(([-\d.e]+) ([-\d.e]+)\)/) || []).slice(1).map(Number)).filter((q) => q.length === 2);
    const tr = pts.length ? pts.reduce((a, q) => (q[0] - q[1] > a[0] - a[1] ? q : a)) : [+bx.getAttribute("x") + +bx.getAttribute("width"), +bx.getAttribute("y")];
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", (tr[0] - 22 * u).toFixed(3)); dot.setAttribute("cy", (tr[1] + 22 * u).toFixed(3)); dot.setAttribute("r", (6.5 * u).toFixed(3));
    dot.setAttribute("fill", c === "green" ? "#3ecf6a" : c === "red" ? "#e5484d" : "#888");
    dot.setAttribute("stroke", "rgba(0,0,0,.45)"); dot.setAttribute("stroke-width", (2 * u).toFixed(3));
    dot.setAttribute("class", "lh-mdot"); dot.setAttribute("pointer-events", "none");
    const tt_ = document.createElementNS(NS, "title"); tt_.textContent = why; dot.append(tt_);
    g.append(dot);
  }
  function paint() {
    recSync();
    updMouthDot();
    const mk = isoView ? isoMarkup() : depthView ? topView() : v3 ? `<rect width="${W}" height="${f1(H)}" fill="#26292d"/>` : scene.markup(t, playing ? null : sel, paint, (svg.getScreenCTM() || {}).a);
    if (!(playing && !markupReady(mk) && svg.firstChild)) svg.innerHTML = mk;   // en lecture, une image pas prete : on garde la precedente
    boxDot();
    if (v3) render3(); else box3.style.display = "none";
    if (showMask && !playing) svg.querySelectorAll('[data-mask]').forEach((e) => { e.setAttribute("fill", "#ff5fa2"); e.setAttribute("fill-opacity", "0.55"); });
  }

  // ------------------------------------------------------------------------------------------ vue de dessus (profondeur)
  // Schema vu d'en haut : la camera en bas, le fond en haut, chaque element est une carte posee a sa profondeur.
  // Glisser une carte : gauche / droite = sa position, haut / bas = sa profondeur (0 devant, 1 au fond).
  let depthView = false;
  const DY0 = 0.8, DY1 = 0.14;                             // hauteur (fraction) de la profondeur 0 et de la profondeur 1
  const esc = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const depthNow = (l) => depthOf(pan, pan.layers.indexOf(l));
  const fixDepths = () => pan.layers.forEach((l, i) => { if (l.d == null) l.d = f3(depthOf(pan, i)); });
  function setDepth(l, d) {                                // l'ordre d'empilement suit la profondeur : le plus loin est dessine d'abord
    fixDepths();
    l.d = f3(clamp(d, 0, 1));
    pan.layers.sort((a, b) => b.d - a.d);
  }
  // place de la camera sur le schema : au repos un peu sous le premier plan ; dz = 1 la pose sur le premier plan
  const camD = (dz) => (dz <= 1 ? -0.2 + 0.2 * dz : dz - 1), camDz = (d) => clamp(d <= 0 ? (d + 0.2) / 0.2 : d + 1, -2, 1.95);
  const shapes = () => (pan.draw && pan.draw.shapes) || [];
  const fxAnim = () => !!(pan.draw && pan.draw.fx && pan.draw.fx.on && pan.draw.fx.anim);
  const shapeOf = (id) => (typeof id === "string" && id.startsWith("s:") ? shapes().find((x) => "s:" + x.id === id) : null);
  const shapeName = (sh, i) => tt`Forme ${i + 1} (${((sh.t === "pre" && PRESETS[sh.k] ? [PRESETS[sh.k].n] : null) || PRIMS[sh.t] || PATHS[sh.t] || ["forme"])[0].toLowerCase()})`;
  function topView() {
    const c = camAt(), yOf = (d) => H * (DY0 + (DY1 - DY0) * d), fs = Math.max(11, H * 0.03), camY = yOf(camD(c.dz || 0)), camX = c.cx * W, half = 0.5 / c.z * W;
    let o = `<rect width="${W}" height="${f1(H)}" fill="#f3f1ec"/>`;
    o += `<polygon points="${f1(camX)},${f1(camY)} ${f1(camX - half)},${f1(yOf(1))} ${f1(camX + half)},${f1(yOf(1))}" fill="#3b82f6" fill-opacity="0.09" stroke="#3b82f6" stroke-opacity="0.5" stroke-dasharray="6 5"/>`;
    for (const d of [0, 0.25, 0.5, 0.75, 1])
      o += `<line x1="0" x2="${W}" y1="${f1(yOf(d))}" y2="${f1(yOf(d))}" stroke="#b9b4a8" stroke-width="1" stroke-dasharray="${d === 0 || d === 1 ? "none" : "3 6"}"/>` +
        `<text x="6" y="${f1(yOf(d) - 4)}" font-size="${f1(fs * 0.75)}" fill="#8a8578">${d === 0 ? tt("Devant · 0") : d === 1 ? tt("Fond · 1") : d}</text>`;
    o += `<rect x="0" y="${f1(yOf(1) - H * 0.035)}" width="${W}" height="${f1(H * 0.035)}" fill="#cfcabd"/>` +
      tt`<text x="${W / 2}" y="${f1(yOf(1) - H * 0.045)}" font-size="${f1(fs * 0.8)}" fill="#8a8578" text-anchor="middle">DÉCOR</text>`;
    if (dof.on) o += `<line x1="0" x2="${W}" y1="${f1(yOf(c.fo))}" y2="${f1(yOf(c.fo))}" stroke="#16a34a" stroke-width="2.5"/>` +
      tt`<text x="${W - 6}" y="${f1(yOf(c.fo) - 5)}" font-size="${f1(fs * 0.75)}" fill="#16a34a" text-anchor="end">MISE AU POINT · ${c.fo.toFixed(2)}</text>` +
      `<line x1="0" x2="${W}" y1="${f1(yOf(c.fo))}" y2="${f1(yOf(c.fo))}" stroke="transparent" stroke-width="${f1(Math.max(16, H * 0.03))}" data-focus="1" style="cursor:ns-resize"><title>${tt("Glisser : déplacer la mise au point")}</title></line>`;
    const th = H * 0.03;
    shapes().forEach((sh, i) => {                           // formes du decor : des cartes plus fines, a glisser en profondeur et en travers
      const b = boxOf(sh, H), y = yOf(sh.d ?? 1), on = sel === "s:" + sh.id;
      o += `<g data-shape="${sh.id}" style="cursor:move"><rect x="${f1(b.x)}" y="${f1(y - th * 0.3)}" width="${f1(Math.max(b.w, 14))}" height="${f1(th * 0.6)}" rx="${f1(th / 5)}" fill="${on ? "#e2603a" : "#9a7b2e"}" stroke="#fff" stroke-width="1.2" data-shape="${sh.id}"/>` +
        (on || (sh.d ?? 1) < 0.999 ? `<text x="${f1(b.cx)}" y="${f1(y - th * 0.45)}" font-size="${f1(fs * 0.7)}" fill="${on ? "#b8431f" : "#7a6325"}" text-anchor="middle" data-shape="${sh.id}">${esc(shapeName(sh, i))} · ${(sh.d ?? 1).toFixed(2)}</text>` : "") + `</g>`;
    });
    pan.layers.forEach((l, li) => {
      const st = worldOf(l), it = itemOf(l), sp = it && sprite(it, st.v, st.f);
      if (!sp) return;
      const box = layerBox(bb, Object.assign({}, l, st), sp), y = yOf(depthOf(pan, li)), on = sel === l.id, ih = H * 0.11, iw = ih * sp.w / sp.h;
      o += `<g data-layer="${l.id}" style="cursor:grab">` +
        `<image href="${sp.url}" x="${f1(box.cx - iw / 2)}" y="${f1(y - th / 2 - ih - 2)}" width="${f1(iw)}" height="${f1(ih)}" opacity="${on ? 1 : 0.75}" data-layer="${l.id}"/>` +
        `<rect x="${f1(box.x)}" y="${f1(y - th / 2)}" width="${f1(Math.max(box.w, 14))}" height="${f1(th)}" rx="${f1(th / 3)}" fill="${on ? "#e2603a" : "#2f2d2a"}" stroke="#fff" stroke-width="1.5" data-layer="${l.id}"/>` +
        `<text x="${f1(box.cx)}" y="${f1(y + th / 2 + fs * 0.9)}" font-size="${f1(fs * 0.8)}" fill="${on ? "#b8431f" : "#444"}" text-anchor="middle" data-layer="${l.id}">${esc(it.name)} · ${depthOf(pan, li).toFixed(2)}</text></g>`;
    });
    o += `<g transform="translate(${f1(camX)} ${f1(camY)})"><rect x="${f1(-fs * 1.1)}" y="${f1(-fs * 0.5)}" width="${f1(fs * 2.2)}" height="${f1(fs * 1.3)}" rx="3" fill="${sel === "cam" ? "#3b82f6" : "#5b6472"}"/>` +
      `<polygon points="${f1(-fs * 0.5)},${f1(-fs * 0.5)} ${f1(fs * 0.5)},${f1(-fs * 0.5)} ${f1(fs * 0.8)},${f1(-fs * 1.1)} ${f1(-fs * 0.8)},${f1(-fs * 1.1)}" fill="${sel === "cam" ? "#3b82f6" : "#5b6472"}"/>` +
      tt`<text y="${f1(fs * 1.75)}" font-size="${f1(fs * 0.8)}" fill="#5b6472" text-anchor="middle">CAMÉRA</text></g>`;
    return o + `<rect width="${W}" height="${f1(H)}" class="mt-frame"/>`;
  }

  // ------------------------------------------------------------------------------------------ vue isometrique
  // La scene posee sur son sol : X = place dans la case (0 a gauche, 1 a droite), Z = profondeur (0 devant, 1 au fond).
  // Vue par defaut : d'en haut, decalee vers la droite. Glisser dans la vue : changer un peu de point de vue (sans faire
  // le tour), molette : zoom, double-clic : vue par defaut. Les elements sont des decoupes plates, debout a leur place.
  // Clic sur le sol : la carte de sol (un motif vu en perspective dans l'image).
  let isoView = false, isoDrag = null;
  const ISO0 = { yaw: 34, pitch: 36, zoom: 1 }, ZD = 1.2;  // ZD : la profondeur 1 vaut 1,2 largeur de case
  const iso = Object.assign({}, ISO0, (() => { try { return JSON.parse(localStorage.getItem("bw.iso") || "{}"); } catch (e) { return {}; } })());
  function isoProj() {
    const ya = iso.yaw * Math.PI / 180, pa = iso.pitch * Math.PI / 180, S = W * 0.6 * iso.zoom;
    return (X, Y, Z) => {
      const x = X - 0.5, z = (Z - 0.5) * ZD, xr = x * Math.cos(ya) - z * Math.sin(ya), zr = x * Math.sin(ya) + z * Math.cos(ya);
      return [W / 2 + xr * S, H * 0.6 - (Y * Math.cos(pa) + zr * Math.sin(pa)) * S, zr * Math.cos(pa) - Y * Math.sin(pa)];
    };
  }
  const mat = (o, a, b, sa = 1, sb = 1) => `matrix(${((a[0] - o[0]) / sa).toFixed(4)} ${((a[1] - o[1]) / sa).toFixed(4)} ${((b[0] - o[0]) / sb).toFixed(4)} ${((b[1] - o[1]) / sb).toFixed(4)} ${f1(o[0])} ${f1(o[1])})`;
  function isoMarkup() {
    const P = isoProj(), c = camAt(), hw = H / W, pa = iso.pitch * Math.PI / 180;
    let o = `<defs><clipPath id="mt-isowall"><rect width="${W}" height="${f1(H)}"/></clipPath></defs><rect width="${W}" height="${f1(H)}" fill="#26292d"/>`;
    // sol : un parallelogramme (vue sans perspective), en unites du sol
    const gm = mat(P(0, 0, 0), P(1, 0, 0), P(0, 0, 1)), X0 = -0.2, X1 = 1.2, Z0 = -0.45, Z1 = 1.08;
    o += `<g transform="${gm}"><rect x="${X0}" y="${Z0}" width="${X1 - X0}" height="${Z1 - Z0}" fill="#d8d4cb" data-ground="1" style="cursor:pointer"/>` +
      (pan.ground && pan.ground.on ? `<g data-ground="1" style="cursor:pointer">${groundTile(pan.ground, { x0: X0, y0: Z0, w: X1 - X0, hh: Z1 - Z0, camY: rebuild3().camY, zs: ZD, ratio: H / W, id: "mt-isopat", px: 320 })}</g>` : "") +
      `<rect x="0" y="0" width="1" height="1" fill="none" stroke="#5fc4a8" stroke-width="1.2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" pointer-events="none"/></g>`;
    // le decor de la case, en mur au fond
    const bgI = background(pan, app.bank, app.project.id);
    if (bgI) {
      const pl = placement(bb, bgI.w || 16, bgI.h || 9, scene.viewAt(t));
      o += `<g transform="${mat(P(0, hw, 1.02), P(1, hw, 1.02), P(0, 0, 1.02), W, H)}" opacity="0.9"><g clip-path="url(#mt-isowall)"><rect width="${W}" height="${f1(H)}" fill="#fff"/>` +
        `<image href="${bgI.url}" x="${f1(pl.x)}" y="${f1(pl.y)}" width="${f1(pl.w)}" height="${f1(pl.h)}" preserveAspectRatio="none"/></g></g>`;
    }
    // elements et camera, du plus loin au plus pres
    const items = [];
    for (const l of pan.layers) {
      const s = worldOf(l), it = itemOf(l), sp = it && sprite(it, s.v, s.f);
      if (!sp) continue;
      const g = P(s.x, 0, depthNow(l)), top = P(s.x, (s.s || 0.5) * hw, depthNow(l)), hp = Math.max(4, g[1] - top[1]), wp = hp * (sp.w || 1) / (sp.h || 1);
      const fl = l.flip ? ` transform="translate(${f1(2 * g[0])} 0) scale(-1 1)"` : "";
      items.push([g[2], `<ellipse cx="${f1(g[0])}" cy="${f1(g[1])}" rx="${f1(wp * 0.35)}" ry="${f1(wp * 0.35 * Math.sin(pa))}" fill="#000" opacity="0.18"/>` +
        `<image href="${sp.url}" x="${f1(g[0] - wp / 2)}" y="${f1(g[1] - hp)}" width="${f1(wp)}" height="${f1(hp)}" preserveAspectRatio="xMidYMax meet"${fl}/>` +
        (sel === l.id ? `<rect x="${f1(g[0] - wp / 2)}" y="${f1(g[1] - hp)}" width="${f1(wp)}" height="${f1(hp)}" class="mt-sel"/>` : "")]);
    }
    const cz = camD(c.dz || 0) - 0.15, cp = P(c.cx, 0.12, cz), half = 0.5 / (c.z || 1), fa = P(c.cx - half, 0, 0), fb = P(c.cx + half, 0, 0);
    items.push([cp[2], `<path d="M${f1(cp[0])} ${f1(cp[1])}L${f1(fa[0])} ${f1(fa[1])}L${f1(fb[0])} ${f1(fb[1])}Z" fill="#5fc4a8" opacity="0.18"/>` +
      `<g transform="translate(${f1(cp[0])} ${f1(cp[1])})"><rect x="-14" y="-9" width="22" height="18" rx="3" fill="#5fc4a8"/><path d="M8 -5L16 -9V9L8 5Z" fill="#5fc4a8"/></g>`]);
    items.sort((a, b) => b[0] - a[0]);
    o += items.map((x) => x[1]).join("");
    const fs = Math.max(9, Math.min(H * 0.026, W * 0.019));
    o += `<text x="${f1(W / 2)}" y="${f1(H - fs * 0.8)}" font-size="${f1(fs)}" fill="#9aa3ad" text-anchor="middle" style="pointer-events:none">${tt("Clic sur le sol : carte de sol · glisser : changer de point de vue · molette : zoom · double-clic : vue par défaut")}</text>`;
    return o;
  }
  function isoSave() { localStorage.setItem("bw.iso", JSON.stringify(iso)); }
  // ------------------------------------------------------------------------------------------ vue 3D
  // La scene en vraie perspective : chaque element est une carte plate, debout dans l'espace, face a la camera de la case.
  // Reconstruction d'apres la case : camera de la case en (0,5 ; hauteur des yeux ; -D0), regard horizontal, horizon a la
  // hauteur hz de la case ; une carte a la profondeur d est a z = d x ZD ; sa place et sa taille sont celles qui redonnent
  // exactement l'image (la vue 3D de depart = l'image). On deplace ensuite la camera : orbite sur 120 degres autour de la
  // scene (glisser), hauteur (glisser haut / bas), plongee (Maj + glisser), distance (molette), focale (curseur).
  // « Recalculer la perspective » : chaque carte prend la place, la taille et la profondeur vues par la nouvelle camera,
  // et l'image de sa tournette qui correspond a l'angle sous lequel la camera la voit desormais.
  let v3 = false, v3drag = null;
  const FOV0 = 53.13, D0 = 0.5 / Math.tan(FOV0 * Math.PI / 360);      // camera de la case : la case entiere a 1 de distance
  const CAM3 = { yaw: 0, crane: 0, pitch: 0, dolly: 1, fov: FOV0 };
  const cam3 = Object.assign({}, CAM3);
  const box3 = h("div.mt-3d", { style: { display: "none" } });
  const hzOf = () => (pan.ground && pan.ground.hz != null ? pan.ground.hz : estimateHorizon(pan));
  /** Les cartes de la case dans l'espace (unites : largeur de la case). */
  function rebuild3() {
    const hw = H / W, hz = hzOf(), cards = [];
    for (const l of pan.layers) {
      const s = worldOf(l), it = itemOf(l), sp = it && sprite(it, s.v, s.f);
      if (!sp) continue;
      const z = depthNow(l) * ZD, zc = z + D0, Hc = (s.s || 0.5) * hw * zc / D0;
      cards.push({ l, s, sp, z, X: 0.5 + (s.x - 0.5) * zc / D0, Hc, Wc: Hc * (sp.w || 1) / (sp.h || 1), yf: s.y, zc });
    }
    const eyes = cards.map((c) => (c.yf - hz) * hw * c.zc / D0).filter((v) => v > 0.01).sort((a, b) => a - b);
    const camY = eyes.length ? eyes[Math.floor(eyes.length / 2)] : 0.3 * hw;
    // avec une carte de sol, les pieds sont poses sur le sol : la profondeur se deduit de leur hauteur dans la case (la case
    // reste la meme vue de sa camera). Sauf les elements qui volent (l.fly) ou dont les pieds sont au-dessus de l'horizon.
    const glue = !!(pan.ground && pan.ground.on);
    for (const c of cards) {
      const below = (c.yf - hz) * hw;
      if (glue && !c.l.fly && below > 0.004) {
        const zc = camY * D0 / below;
        c.X = 0.5 + (c.s.x - 0.5) * zc / D0; c.Hc = (c.s.s || 0.5) * hw * zc / D0; c.Wc = c.Hc * (c.sp.w || 1) / (c.sp.h || 1);
        c.zc = zc; c.z = zc - D0; c.Y = 0; c.glued = true;
      } else c.Y = camY - below * c.zc / D0;               // les pieds : la ou la case les montre
    }
    const zMid = cards.length ? cards.reduce((a, c) => a + c.z, 0) / cards.length : ZD / 2;
    return { hw, hz, camY, zMid, cards };
  }
  /** Camera deplacee : position, axes (droite, haut, avant), focale (en largeurs de case). */
  function camera3(rb) {
    const ya = cam3.yaw * Math.PI / 180, pa = cam3.pitch * Math.PI / 180, R = (rb.zMid + D0) * cam3.dolly;
    const C = [0.5 + R * Math.sin(ya), rb.camY + cam3.crane, rb.zMid - R * Math.cos(ya)];
    const fw = [-Math.sin(ya) * Math.cos(pa), -Math.sin(pa), Math.cos(ya) * Math.cos(pa)], r = [Math.cos(ya), 0, Math.sin(ya)];
    const u = [fw[1] * r[2] - fw[2] * r[1], fw[2] * r[0] - fw[0] * r[2], fw[0] * r[1] - fw[1] * r[0]];
    return { C, fw, r, u, f: 0.5 / Math.tan(cam3.fov * Math.PI / 360) };
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const camOf = (cm, p) => { const d = sub(p, cm.C); return [dot(cm.r, d), dot(cm.u, d), dot(cm.fw, d)]; };
  /** Point de l'espace -> place dans la case (fractions de largeur et de hauteur), et sa distance. */
  const proj3 = (cm, rb, p) => { const c = camOf(cm, p); return { x: 0.5 + c[0] * cm.f / c[2], y: rb.hz - c[1] * cm.f / c[2] / rb.hw, zc: c[2] }; };
  function render3() {
    const vr = svg.parentElement.getBoundingClientRect(), ctm = svg.getScreenCTM();
    if (!ctm) return;
    const Wp = W * ctm.a, Hp = H * ctm.d;
    Object.assign(box3.style, { display: "", left: (ctm.e - vr.left) + "px", top: (ctm.f - vr.top) + "px", width: Wp + "px", height: Hp + "px" });
    const rb = rebuild3(), cm = camera3(rb), P = cm.f * Wp;
    const stage = h("div.mt-3d-stage", { style: { perspective: P + "px", perspectiveOrigin: `50% ${(rb.hz * 100).toFixed(2)}%` } });
    // un plan : son coin p0, ses axes ex, ey (par pixel de l'element) -> matrix3d ; null s'il passe derriere la camera
    const plane = (p0, ex, ey, wpx, hpx) => {
      for (const q of [p0, [p0[0] + ex[0] * wpx, p0[1] + ex[1] * wpx, p0[2] + ex[2] * wpx], [p0[0] + ey[0] * hpx, p0[1] + ey[1] * hpx, p0[2] + ey[2] * hpx]])
        if (camOf(cm, q)[2] < 0.03) return null;
      const L = (e) => [dot(cm.r, e) * Wp, -dot(cm.u, e) * Wp, -dot(cm.fw, e) * Wp], k = camOf(cm, p0);
      const a = L(ex), b = L(ey);
      // troisieme colonne : la normale du plan (avec 0, 0, 1 un sol vu de face donne une matrice non inversible, que le
      // navigateur ne dessine pas)
      const nx = a[1] * b[2] - a[2] * b[1], ny = a[2] * b[0] - a[0] * b[2], nz = a[0] * b[1] - a[1] * b[0], nn = Math.hypot(nx, ny, nz) || 1;
      return `matrix3d(${[a[0], a[1], a[2], 0, b[0], b[1], b[2], 0, nx / nn, ny / nn, nz / nn, 0, k[0] * Wp, -k[1] * Wp, P - k[2] * Wp, 1].map((v) => +v.toFixed(5)).join(",")})`;
    };
    const put = (el, tr, w, hh) => { if (!tr) return; Object.assign(el.style, { width: w + "px", height: hh + "px", transform: tr }); el.classList.add("w3"); stage.append(el); };
    // le decor de la case : un mur au fond, a la taille qui redonne l'image depuis la camera de la case
    const bgI = background(pan, app.bank, app.project.id);
    // le mur passe derriere l'element le plus loin (colles au sol, certains peuvent etre plus loin que la profondeur 1)
    const zW = Math.max(ZD * 1.05, ...rb.cards.map((c) => c.z + 0.15));
    // le sol va jusqu'au mur ; sans decor, presque jusqu'a l'horizon
    const zEnd = bgI ? zW : 40;
    if (bgI) {
      const zc = zW + D0, ww = zc / D0, hh = rb.hw * zc / D0, top = rb.camY + rb.hz * rb.hw * zc / D0;
      const pl = placement(bb, bgI.w || 16, bgI.h || 9, scene.viewAt(t)), el = h("div");
      el.innerHTML = `<svg viewBox="0 0 ${W} ${f1(H)}" width="400" height="${f1(400 * H / W)}" preserveAspectRatio="none" style="display:block"><rect width="${W}" height="${f1(H)}" fill="#fff"/><image href="${bgI.url}" x="${f1(pl.x)}" y="${f1(pl.y)}" width="${f1(pl.w)}" height="${f1(pl.h)}" preserveAspectRatio="none"/></svg>`;
      put(el, plane([0.5 - ww / 2, top, zW], [ww / 400, 0, 0], [0, -hh / (400 * H / W), 0], 400, 400 * H / W), 400, 400 * H / W);
    }
    // sol (devant le mur) : des dalles (celles qui passent derriere la camera sont omises), motif de la carte de sol s'il y en a une
    // dalles de plus en plus grandes vers le fond, sur une largeur qui suit le champ de la camera
    const TP = 60, gr = pan.ground && pan.ground.on ? pan.ground : null;
    for (let gz = -1.5, TS = 0.25; gz < zEnd - 1e-6; gz += TS) {
      TS = 0.25 * Math.max(1, Math.round((gz + D0) / 1.5));
      const TZ = Math.min(TS, zEnd - gz), half = Math.max(2.5, 1.5 * (gz + TS + D0)), n = Math.ceil(half / TS);
      for (let q = -n; q < n; q++) {
        const gx = 0.5 + q * TS, tr = plane([gx, 0, gz], [TS / TP, 0, 0], [0, 0, TZ / TP], TP, TP);
        if (!tr) continue;
        const id = `mt3g${Math.round(gx * 100)}_${Math.round(gz * 100)}`.replace(/-/g, "m");
        const el = h("div");
        el.innerHTML = `<svg viewBox="${gx} ${gz} ${TS} ${TZ}" width="${TP}" height="${TP}" preserveAspectRatio="none" style="display:block"><rect x="${gx}" y="${gz}" width="${TS}" height="${TZ}" fill="#d8d4cb"/>${gr ? groundTile(gr, { x0: gx, y0: gz, w: TS, hh: TZ, camY: rb.camY, ratio: H / W, id, px: 40 }) : ""}` +
          (gx >= 0 && gx < 1 && gz >= 0 && gz < ZD ? `<rect x="${gx}" y="${gz}" width="${TS}" height="${TZ}" fill="none" stroke="#5fc4a8" stroke-opacity=".35" stroke-width=".004"/>` : "") + "</svg>";
        put(el, tr, TP, TP);
      }
    }
    // les cartes, de la plus loin a la plus proche
    const order = rb.cards.map((c) => ({ c, d: camOf(cm, [c.X, c.Y + c.Hc / 2, c.z])[2] })).sort((a, b) => b.d - a.d);
    for (const { c } of order) {
      const hp = 200, wp = hp * c.Wc / c.Hc, fl = !!c.l.flip;
      const img = h("img", { src: c.sp.url, draggable: false });
      if (sel === c.l.id) img.classList.add("on");
      put(img, plane([c.X + (fl ? c.Wc / 2 : -c.Wc / 2), c.Y + c.Hc, c.z], [(fl ? -1 : 1) * c.Wc / wp, 0, 0], [0, -c.Hc / hp, 0], wp, hp), wp, hp);
    }
    box3.textContent = "";
    box3.append(stage, bar3());
  }
  function bar3() {
    const moved = cam3.yaw || cam3.crane || cam3.pitch || cam3.dolly !== 1 || cam3.fov !== FOV0;
    const fov = h("input", { type: "range", min: 20, max: 100, step: 1, value: cam3.fov, title: tt("Focale : petit angle = téléobjectif (peu de perspective), grand angle = perspective forte"),
      on: { input: (e) => { cam3.fov = +e.target.value; paint(); }, pointerdown: (e) => e.stopPropagation() } });
    return h("div.mt-3d-bar", { on: { pointerdown: (e) => e.stopPropagation(), wheel: (e) => e.stopPropagation() } },
      h("button.mini" + (moved ? ".star" : ""), { title: tt("Chaque carte prend la place, la taille et la profondeur vues par cette caméra, et l'image de sa tournette qui correspond à ce nouvel angle"), on: { click: recalc3 } }, tt("↻ Recalculer la perspective")),
      h("button.mini", { title: tt("Revenir à la caméra de la case (double-clic dans la vue)"), on: { click: () => { Object.assign(cam3, CAM3); paint(); } } }, tt("⟲ Caméra de la case")),
      h("label.mt-3d-fov", tt("Focale"), fov, h("span", Math.round(cam3.fov) + "°")),
      pan.ground && pan.ground.on && layerOf(sel) ? h("button.mini" + (layerOf(sel).fly ? ".on" : ""), { title: tt("Avec une carte de sol, les éléments ont les pieds sur le sol. Coché : celui-ci vole, il garde sa profondeur."),
        on: { click: () => { const l = layerOf(sel); if (l.fly) delete l.fly; else l.fly = true; hist.snap(); paint(); } } }, layerOf(sel).fly ? tt("🕊 Vole (pas collé au sol)") : tt("🕊 Laisser voler")) : "",
      h("span.mt-3d-info", tt`Orbite ${Math.round(cam3.yaw)}° · plongée ${Math.round(cam3.pitch)}°`));
  }
  function recalc3() {
    const rb = rebuild3(), cm = camera3(rb), base = { C: [0.5, rb.camY, -D0] };
    if (!rb.cards.length) return toast(tt("Aucun élément à recalculer dans cette case."), "error");
    let n = 0;
    for (const c of rb.cards) {
      const feet = proj3(cm, rb, [c.X, c.Y, c.z]), top = proj3(cm, rb, [c.X, c.Y + c.Hc, c.z]);
      if (feet.zc < 0.05) continue;
      const patch = { x: f3(feet.x), y: f3(feet.y), s: f3(Math.max(0.02, feet.y - top.y)) };
      // l'angle sous lequel la camera voit la carte a tourne de da (vu de dessus) : la tournette tourne d'autant
      const an = (p) => Math.atan2(p[2], p[0]) * 180 / Math.PI;
      let da = an(sub(cm.C, [c.X, 0, c.z])) - an(sub(base.C, [c.X, 0, c.z]));
      da = ((da + 540) % 360) - 180;
      const it = itemOf(c.l), vv = it && variantOf(it, c.s.v);
      if (vv && vv.orbit && vv.orbit.n > 1) {
        const a = frameToAngle(vv.orbit, c.s.f || 0);
        patch.f = angleToFrame(vv.orbit, c.l.flip ? a - da : a + da);
      }
      change(c.l.id, patch);
      setDepth(c.l, clamp((feet.zc - D0) / ZD, 0, 1));
      n++;
    }
    if (pan.ground) groundRecalc(rb, cm);
    Object.assign(cam3, CAM3);                               // la case montre maintenant ce que voyait la camera : elle redevient la reference
    hist.snap(); paint(); lanes(); props();
    toast(tt`Perspective recalculée : ${n} élément(s), place, taille, profondeur et image de tournette.`);
  }
  /** La carte de sol vue par la nouvelle camera. Le motif est pose sur le sol (Y = 0) ; gr.m le relie aux coordonnees du sol
   *  vues de la camera de la case, divisees par sa hauteur (ground.js) : on y compose le passage a la nouvelle camera
   *  (orbite, hauteur, distance, focale). La plongee deplace l'horizon. */
  function groundRecalc(rb, cm) {
    const gr = pan.ground, m0 = groundMap(gr, H / W), ya = cam3.yaw * Math.PI / 180, cy = Math.cos(ya), sy = Math.sin(ya);
    const hc = Math.max(0.02, cm.C[1]), f = cm.f / D0, k = hc / rb.camY;
    // sol de la nouvelle camera (u', v') -> sol de l'ancienne (u, v) : u = a*u' + b*v' + e, v = c*u' + d*v' + g
    const a = k * cy, b = -k * sy * f, c = k * sy, d = k * cy * f, e = (cm.C[0] - 0.5) / rb.camY, g = (cm.C[2] + D0) / rb.camY;
    const [A, B, C, Dd, E, G] = m0;                         // motif = (A*u + B*v + E, C*u + Dd*v + G)
    gr.m = [A * a + B * c, A * b + B * d, C * a + Dd * c, C * b + Dd * d, A * e + B * g + E, C * e + Dd * g + G].map((x) => +x.toFixed(5));
    gr.hz = f3(clamp(rb.hz - (cam3.pitch ? cm.f * Math.tan(cam3.pitch * Math.PI / 180) / rb.hw : 0), 0.02, 0.95));
  }
  box3.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    stop(); box3.setPointerCapture(e.pointerId);
    v3drag = { x: e.clientX, y: e.clientY, yaw: cam3.yaw, crane: cam3.crane, pitch: cam3.pitch, shift: e.shiftKey };
    box3.style.cursor = "grabbing";
  });
  box3.addEventListener("pointermove", (e) => {
    if (!v3drag) return;
    const dx = (e.clientX - v3drag.x) / box3.clientWidth, dy = (e.clientY - v3drag.y) / box3.clientHeight;
    cam3.yaw = clamp(v3drag.yaw - dx * 140, -60, 60);        // un arc de 120 degres autour de la scene
    if (v3drag.shift) cam3.pitch = clamp(v3drag.pitch + dy * 60, -20, 45);
    else cam3.crane = clamp(v3drag.crane - dy * 0.8, -0.4, 1.2);   // vers le haut : la camera monte
    paint();
  });
  box3.addEventListener("pointerup", () => { v3drag = null; box3.style.cursor = ""; });
  box3.addEventListener("dblclick", () => { Object.assign(cam3, CAM3); paint(); });
  box3.addEventListener("wheel", (e) => { e.preventDefault(); cam3.dolly = clamp(cam3.dolly * Math.exp(e.deltaY * 0.0012), 0.35, 2.5); paint(); }, { passive: false });
  // l'atelier de dessin du fond (le meme que dans la planche) ; enregistre dans la copie de travail du montage
  function drawDecor() {
    stop();
    const bgI = background(pan, app.bank, app.project.id);
    const ghosts = pan.layers.map((l) => { const s = worldOf(l), it = itemOf(l), sp = it && sprite(it, s.v, s.f); return sp && { url: sp.url, x: s.x, y: s.y, s: s.s, ar: sp.w / sp.h, flip: l.flip }; }).filter(Boolean);
    openDrawEditor({ draw: pan.draw, ratio: H / W, backdrop: bgI ? bgI.url : null, ghosts, title: tt("Dessiner le fond de la case"),
      onSave: (d) => { if (d.shapes.length || (d.fx && d.fx.on)) pan.draw = d; else delete pan.draw; hist.snap(); paint(); lanes(); props(); } });
  }
  // carte de sol : un motif sur le sol, vu en perspective dans l'image jusqu'a l'horizon
  function groundDialog() {
    if (!pan.ground) pan.ground = Object.assign({}, GROUND0, { hz: estimateHorizon(pan) });
    const gr = pan.ground, upd = () => { paint(); };
    const range = (label, k, min, max, step, title) => { const out = h("output", (+gr[k]).toFixed(2));
      return h("label.row.range", title ? { title } : {}, label, h("input", { type: "range", min, max, step, value: gr[k], on: { input: (e) => { gr[k] = +e.target.value; out.textContent = (+gr[k]).toFixed(2); upd(); } } }), out); };
    if (gr.hz == null) gr.hz = estimateHorizon(pan);
    // lavis (aquarelle) : ses reglages, montres seulement pour ce motif
    if (gr.pat === "taches") gr.pat = "lavis";
    for (const [k, v] of [["dn", 0.45], ["ts", 1], ["sf", 0.5], ["seed", 1]]) if (gr[k] == null) gr[k] = v;
    const stainBox = h("div", { style: { display: gr.pat === "lavis" ? "" : "none" } },
      range(tt("Couverture"), "dn", 0.03, 1, 0.01, tt("Part du sol couverte par le lavis")),
      range(tt("Taille des taches"), "ts", 0.2, 4, 0.01),
      range(tt("Douceur des bords"), "sf", 0, 2, 0.01, tt("0 : bords nets, auréole foncée comme une aquarelle qui a séché ; 2 : bords fondus")),
      h("button.mini", { title: tt("Un autre tirage du lavis, mêmes réglages"), on: { click: () => { gr.seed = Math.floor(Math.random() * 9999) + 1; upd(); } } }, tt("🎲 Autre tirage")));
    const hzRow = range(tt("Horizon ⓘ"), "hz", 0.02, 0.95, 0.005, tt("Hauteur de la ligne d'horizon dans la case (0 en haut, 1 en bas) : le sol s'arrête là. Estimée d'après les personnages : à hauteur de leurs yeux, comme une caméra à hauteur d'homme."));
    modal(tt("Carte de sol"), h("div.form",
      h("p.muted", tt("Un motif posé sur le sol de la case, vu en perspective dans l'image, sous les personnages. Il se voit dans la case, au montage et dans les images exportées.")),
      h("label.row.check", h("input", { type: "checkbox", checked: !!gr.on, on: { change: (e) => { gr.on = e.target.checked; upd(); } } }), tt("Sol dans l'image")),
      h("label.row", tt("Motif"), h("select", { on: { change: (e) => { gr.pat = e.target.value; stainBox.style.display = gr.pat === "lavis" ? "" : "none"; upd(); } } }, Object.entries(PATS).map(([k, n]) => h("option", { value: k, selected: (gr.pat || "damier") === k }, n)))),
      stainBox,
      hzRow,
      h("button.mini", { title: tt("Replace l'horizon à hauteur des yeux des personnages"), on: { click: () => { gr.hz = estimateHorizon(pan); hzRow.querySelector("input").value = gr.hz; hzRow.querySelector("output").textContent = gr.hz.toFixed(2); upd(); } } }, tt("◎ Estimer l'horizon")),
      range(tt("Taille du motif"), "sc", 0.12, 2, 0.01, tt("Taille des carreaux, des points ou des taches de lavis")),
      range(tt("Opacité"), "a", 0.03, 1, 0.01),
      h("label.row", tt("Couleur"), h("input", { type: "color", value: gr.col || "#000000", on: { input: (e) => { gr.col = e.target.value; upd(); } } }))), [
      { label: tt("Retirer la carte de sol"), click: () => { delete pan.ground; paint(); hist.snap(); } },
      { label: tt("Voir dans l'image"), click: () => { hist.snap(); setView("image"); } },
      { label: tt("✓ Garder le sol dans l'image"), primary: true, click: () => { gr.on = true; hist.snap(); setView("image"); } }]);
  }

  // ------------------------------------------------------------------------------------------ cles
  const near = (id) => keysOf(id).find((k) => Math.abs(k.t - t) < 0.04);
  function setKey(id, patch) {                             // piste muette : on regle ce qu'on voit, la cle de l'instant fige
    const mt = muteOf(id);
    if (mt == null) return setKey0(id, patch);
    const t0 = t; t = mt;
    try { setKey0(id, patch); } finally { t = t0; }
  }
  function fullOf(id) {                                    // valeurs de la piste a l'instant affiche
    const nl = nullOf(id);
    return id === "bg" ? scene.viewAt(t) : CAMS[id] ? camAt() : nl ? scene.nullLocal(nl, t) : stateOf(layerOf(id));
  }
  function shiftTrack(id, patch) {                         // sans cle auto, hors d'une cle : toute l'animation de la piste bouge d'autant
    const cur = fullOf(id), keys = keysOf(id);
    for (const [c, v] of Object.entries(patch)) {
      const d = typeof v === "number" && typeof cur[c] === "number" ? v - cur[c] : null;
      for (const k of keys) {
        if (d != null && typeof k[c] === "number") k[c] = f3(k[c] + d);
        else if (d == null && c in k) k[c] = v;
      }
      const o = layerOf(id) || nullOf(id);                   // reglage que les cles ne portent pas : sur l'element lui-meme
      if (o && !keys.some((k) => c in k)) o[c] = v;
    }
  }
  function setKey0(id, patch) {                            // pose ou met a jour la cle de la piste a l'instant courant
    const keys = anim.tracks[id] || (anim.tracks[id] = []);
    let k = near(id);
    if (!k) {
      const nl = nullOf(id), full = fullOf(id);
      const base = id === "bg" ? { zoom: full.zoom, ox: full.ox, oy: full.oy } : id === "cam" ? { cx: full.cx, cy: full.cy, z: full.z, rot: full.rot, dz: full.dz || 0 } : CAMS[id] ? { [id]: full[id] } : nl ? { x: full.x, y: full.y, s: full.s, rz: full.rz } : Object.fromEntries(KEYED.map((q) => [q, full[q]]));
      if (!keys.length && t > 0.04) keys.push(Object.assign({ t: 0 }, base));     // premiere cle posee plus loin : on garde le depart
      k = Object.assign({ t: f3(t) }, base);
      if (chanOpen.has(id) && keys.length && chansOf(id).some(([c]) => c in patch)) k.skip = chansOf(id).map(([c]) => c).filter((c) => !(c in patch));   // canaux deployes : la cle ne porte que ce qu'on regle
      keys.push(k); keys.sort((a, b) => a.t - b.t);
    }
    Object.assign(k, patch);
    if (k.skip) { k.skip = k.skip.filter((c) => !(c in patch)); if (!k.skip.length) delete k.skip; }
    selKey = k;
  }
  function change(id, patch) {                             // un reglage bouge : cle automatique, ou valeur de base
    if (recArmed && !recAct && vdrag && vdrag.id === id && (layerOf(id) || nullOf(id))) recStart(id);   // Rec Action : le premier mouvement lance l'horloge
    if (recAct && recAct.id === id) {                       // en enregistrement : toujours une cle, a l'instant qui avance
      t = recNow();
      recAct.patch = Object.assign(recAct.patch || {}, patch);
      setKey(id, patch); recAct.keys.add(selKey);
      paint(); lanes(); syncProps(); return;
    }
    if (id === "bg" && !anim.bgAnim) pan.view = Object.assign({ zoom: 1, ox: 0, oy: 0 }, pan.view, patch);   // decor fixe : sa place, sans cle
    else if (auto || (keysOf(id).length && near(id))) setKey(id, patch);   // cle auto, ou la cle sous la tete de lecture
    else if (keysOf(id).length && muteOf(id) == null) shiftTrack(id, patch);
    else if (keysOf(id).length) setKey(id, patch);
    else if (id === "bg") pan.view = Object.assign({ zoom: 1, ox: 0, oy: 0 }, pan.view, patch);
    else if (id === "fo") dof.focus = patch.fo;
    else if (id === "bl") dof.amount = patch.bl;
    else if (id === "fx") pan.draw.fx.force = patch.fx;
    else if (id !== "cam") Object.assign(layerOf(id) || nullOf(id), patch);
    else setKey(id, patch);
    if (CAMS[id] && CAMS[sel] && sel !== id) { sel = id; keyBar(); }      // camera, mise au point, flou : la piste reglee devient la piste choisie
    paint(); lanes(); syncProps();
  }

  // ------------------------------------------------------------------------------------------ reglages (droite)
  const side = h("div.mt-side");
  let syncProps = () => {};
  const folds = { sh: true, gs: true, voice: true, mouth: true, lipt: false, lipm: false, tts: false, wig: false };
  const fold = (key, label, ...rows) => h("details.fold", { open: !!folds[key], on: { toggle: (e) => { folds[key] = e.target.open; } } }, h("summary", label), ...rows);
                    // depliants ouverts ou fermes
  function props() {
    side.textContent = "";
    const shp = shapeOf(sel);
    if (shp) {                                             // forme du decor : seule sa profondeur se regle ici
      const inp = h("input", { type: "range", min: 0, max: 1, step: 0.01, value: shp.d ?? 1, on: { input: (e) => { shp.d = +e.target.value; out.textContent = shp.d.toFixed(2); paint(); } } }), out = h("output", (shp.d ?? 1).toFixed(2));
      side.append(h("h4", shapeName(shp, shapes().indexOf(shp))),
        h("label.row.range", { title: tt("1 = collée au décor. Plus près de 0, la forme se détache : elle glisse et grossit davantage quand la caméra bouge (parallaxe).") }, tt("Profondeur ⓘ"), inp, out),
        h("div.row.wrap", h("button.mini", { on: { click: () => { shp.d = 1; paint(); props(); } } }, tt("Recoller au décor")),
          h("button.mini", { title: tt("Toutes les formes reviennent sur le décor"), on: { click: () => { for (const x of shapes()) delete x.d; paint(); props(); } } }, tt("Tout recoller"))),
        h("div.muted", { title: tt("Dans la vue « Profondeur », glisser la carte d'une forme la déplace en profondeur (haut / bas) et en travers (gauche / droite). Sa hauteur, sa taille et son dessin se règlent dans « Dessiner le fond ».") }, tt("Forme du décor : profondeur et place en travers ⓘ")));
      syncProps = () => { if (document.activeElement !== inp) inp.value = shp.d ?? 1; out.textContent = (shp.d ?? 1).toFixed(2); };
      keyBar();
      return;
    }
    const nl = nullOf(sel);
    if (nl) {                                              // null : place, echelle, rotation (animables) et ses enfants
      const cur = () => scene.nullLocal(nl, t), outs = [];
      const rg = (label, k, min, max, step, fmt = (x) => (+x).toFixed(2)) => {
        const out = h("output", fmt(cur()[k])), inp = h("input", { type: "range", min, max, step, value: cur()[k], on: { input: (e) => { change(nl.id, { [k]: +e.target.value }); out.textContent = fmt(+e.target.value); }, change: () => hist.snap() } });
        outs.push(() => { const v = cur()[k]; if (document.activeElement !== inp) inp.value = v; out.textContent = fmt(v); });
        return h("label.row.range", label, inp, out);
      };
      const kids = pan.layers.filter((x) => anim.par && anim.par[x.id] && anim.par[x.id].id === nl.id);
      side.append(h("h4", "✛ ", nl.name, " ", h("button.mini", { on: { click: () => renameNull(nl) } }, tt("Renommer"))),
        h("p.muted", tt("Repère invisible à l'image : les éléments parentés le suivent (déplacement, rotation autour de lui, échelle).")),
        rg(tt("Position ↔"), "x", -1, 2, 0.005), rg(tt("Position ↕"), "y", -1, 3, 0.005), rg(tt("Échelle"), "s", 0.05, 10, 0.01), rg(tt("Rotation"), "rz", -360, 360, 1, (x) => Math.round(x) + "°"),
        h("h4", tt("Enfants")),
        kids.length ? h("div.row.wrap", kids.map((x) => h("button.mini", { title: tt("Choisir cet élément"), on: { click: () => { sel = x.id; paint(); lanes(); props(); } } }, (itemOf(x) || {}).name || tt("élément")))) : h("p.muted", tt("Aucun : clic droit sur un élément › Parent, ou « Parent » dans son panneau.")),
        h("div.row.wrap", h("button.mini.danger", { title: tt("Ses enfants restent, sans parent"), on: { click: () => removeNull(nl) } }, tt("Supprimer le null"))));
      syncProps = () => outs.forEach((f) => f());
      keyBar();
      return;
    }
    const isCam = !!CAMS[sel], l = isCam ? null : layerOf(sel);
    if (!isCam && !l) { sel = "cam"; return props(); }
    const cur = () => (isCam ? camAt() : stateOf(l));
    const rows = [];
    const range = (label, k, min, max, step, fmt = (x) => (+x).toFixed(2), track = isCam ? "cam" : sel) => {
      const inp = h("input", { type: "range", min, max, step, value: cur()[k], on: { input: (e) => change(track, { [k]: +e.target.value }) } }), out = h("output", fmt(cur()[k]));
      rows.push(() => { const v = cur()[k]; if (document.activeElement !== inp) inp.value = v; out.textContent = fmt(v); });
      return h("label.row.range", label, inp, out);
    };
    side.append(h("h4", isCam ? tt("🎥 Caméra") : (itemOf(l) ? itemOf(l).name : tt("Élément"))));
    if (isCam) {
      side.append(range(tt("Cadre ↔"), "cx", -0.5, 1.5, 0.005), range(tt("Cadre ↕"), "cy", -0.5, 1.5, 0.005), range(tt("Zoom"), "z", 0.4, 5, 0.01),
        h("div", { title: tt("Avance ou recule la caméra dans la profondeur : ce qui est près grossit plus vite que le fond, et ce qu'elle dépasse disparaît. 1 = elle atteint le premier plan, 2 = le décor. Dans l'image : Alt + molette. Dans la vue « Profondeur » : glisser la caméra vers le haut.") }, range(tt("Avancer ⓘ"), "dz", -2, 1.95, 0.01)), range(tt("Inclinaison"), "rot", -45, 45, 0.5, (x) => Math.round(x) + "°"),
        h("h4", { title: tt("Un mouvement prêt pose deux clés, au début et à la fin. Tu peux ensuite les régler ou en ajouter.") }, tt("Mouvements prêts ⓘ")),
        h("select", { on: { change: (e) => { applyMove(e.target.value); e.target.value = ""; } } }, h("option", { value: "" }, tt("Choisir un mouvement…")), Object.entries(MOVES).map(([k, [name]]) => h("option", { value: k }, name))),
        h("h4", { title: tt("0 = tout devant, 1 = le décor. Quand le flou est coché, la mise au point et le flou ont chacun leur piste dans la timeline, avec leurs propres clés : la mise au point peut passer d'un personnage à l'autre. La vue « Profondeur » montre le plan net.") }, tt("Profondeur de champ ⓘ")),
        h("label.row.check", h("input", { type: "checkbox", checked: !!dof.on, on: { change: (e) => { dof.on = e.target.checked; if (!dof.on && (sel === "fo" || sel === "bl")) sel = "cam"; paint(); lanes(); props(); } } }), tt("Flou de profondeur")));
      if (dof.on) {
        const rf = range(tt("Mise au point"), "fo", 0, 1, 0.01, undefined, "fo");
        focusBtn = h("button.mini.target" + (focusPick ? ".on" : ""), { title: tt("Cible : clique ensuite sur un personnage ou un élément dans l'image, la mise au point se fait sur lui. Avec des clés (ou la clé automatique), elle se pose à la tête de lecture : la mise au point passe d'un personnage à l'autre. Échap : annuler."),
          on: { click: (e) => { e.preventDefault(); setFocusPick(!focusPick); } } }, "🎯");
        rf.append(focusBtn);
        side.append(rf, range(tt("Flou"), "bl", 0, 60, 1, (x) => String(Math.round(x)), "bl"));
      }
      side.append(
        fxAnim() ? h("h4", { title: tt("Les lignes d'effet dessinées dans le fond de la case. 0 : aucune ; 1 : pleines ; au-delà : plus épaisses. Se pose en clés sur la piste « Lignes d'effet » : elles arrivent, grossissent, disparaissent.") }, tt("⚡ Lignes d'effet ⓘ")) : "",
        fxAnim() ? range(tt("Force"), "fx", 0, 2.5, 0.01, undefined, "fx") : "",
        h("h4", { title: tt("Quand la caméra se déplace, le premier plan glisse plus vite que le fond, selon la profondeur des éléments : le bouton « Profondeur » sous l'image les montre vus de dessus pour les placer.") }, tt("Parallaxe ⓘ")),
        h("label.row.check", h("input", { type: "checkbox", checked: !!anim.parallax, on: { change: (e) => { anim.parallax = e.target.checked; paint(); props(); } } }), tt("Parallaxe automatique")),
        anim.parallax ? h("label.row.range", tt("Force"), h("input", { type: "range", min: 0, max: 3, step: 0.01, value: anim.pstr ?? 0.4, on: { input: (e) => { anim.pstr = +e.target.value; e.target.nextSibling.textContent = (+e.target.value).toFixed(2); paint(); } } }), h("output", (anim.pstr ?? 0.4).toFixed(2))) : "",
        h("h4", { title: tt("Le cadre tangue doucement, comme une caméra tenue à l'épaule. S'ajoute aux mouvements de la caméra sans toucher à ses clés.") }, tt("Caméra à l'épaule ⓘ")),
        h("label.row.check", h("input", { type: "checkbox", checked: !!(anim.shake && anim.shake.on), on: { change: (e) => { anim.shake = Object.assign({ a: 1, v: 1, r: 1 }, anim.shake, { on: e.target.checked }); paint(); props(); } } }), tt("Tremblé de caméra")),
        ...(anim.shake && anim.shake.on ? [[tt("Amplitude"), "a", 0, 5, 0.05, tt("Ampleur du tremblé, en % de la largeur de l'image")], [tt("Vitesse"), "v", 0.1, 4, 0.05, tt("Lent : on respire ; rapide : on court")], [tt("Roulis"), "r", 0, 4, 0.05, tt("Inclinaison qui oscille, en degrés")]].map(([lab, k, min, max, step, title]) =>
          h("label.row.range", { title }, lab, h("input", { type: "range", min, max, step, value: anim.shake[k] ?? 1, on: { input: (e) => { anim.shake[k] = +e.target.value; e.target.nextSibling.textContent = (+e.target.value).toFixed(2); paint(); } } }), h("output", (+(anim.shake[k] ?? 1)).toFixed(2)))) : []),
        h("h4", tt("Décor")),
        pan.bg ? (() => {                                     // taille et place du decor ; animables (piste « Décor ») quand c'est coche
          const bgI = background(pan, app.bank, app.project.id) || {};
          // course du decor de chaque cote : la reglette le pousse dans son sens (100 = a fond vers la droite / le bas)
          const travel = (v) => { const pl = placement(bb, bgI.w || 16, bgI.h || 9, v); return { mx: Math.abs(pl.w - W) / (2 * W), my: Math.abs(pl.h - H) / (2 * H), pl }; };
          const pos = (a) => { const v = scene.viewAt(t), tr = travel(v), m = a === "x" ? tr.mx : tr.my, o = a === "x" ? tr.pl.ox : tr.pl.oy; return m > 1e-4 ? Math.round(o / m * 100) : 0; };
          const setPos = (a, x) => { const tr = travel(scene.viewAt(t)); change("bg", a === "x" ? { ox: f3(x / 100 * tr.mx) } : { oy: f3(x / 100 * tr.my) }); };
          const rg = (label, title, get, min, max, step, set, fmt) => {
            const out = h("output", fmt(get())), inp = h("input", { type: "range", min, max, step, value: get(), on: { input: (e) => { set(+e.target.value); out.textContent = fmt(+e.target.value); }, change: () => hist.snap() } });
            rows.push(() => { const v = get(), tr = travel(scene.viewAt(t)), free = label === "z" || (label === "x" ? tr.mx : tr.my) > 1e-4; if (document.activeElement !== inp) inp.value = v; out.textContent = fmt(v); inp.disabled = !free; });
            return h("label.row.range", { title }, label === "z" ? tt("Taille du décor") : label === "x" ? tt("Position ↔") : tt("Position ↕"), inp, out);
          };
          return h("div",
            rg("z", tt("Agrandir ou rétrécir le décor de la case (1 : il remplit juste la case ; moins : plus petit que la case)"), () => scene.viewAt(t).zoom, 0.25, 6, 0.01, (x) => change("bg", { zoom: x }), (x) => (+x).toFixed(2)),
            rg("x", tt("Pousser le décor vers la gauche ou vers la droite (-100 / 100 : à fond). Il faut qu'il soit plus grand ou plus petit que la case pour pouvoir bouger."), () => pos("x"), -100, 100, 1, (x) => setPos("x", x), (x) => String(Math.round(x))),
            rg("y", tt("Pousser le décor vers le haut ou vers le bas (-100 / 100 : à fond). Il faut qu'il soit plus grand ou plus petit que la case pour pouvoir bouger."), () => pos("y"), -100, 100, 1, (x) => setPos("y", x), (x) => String(Math.round(x))),
            h("label.row.check", { title: tt("Coché : la taille et la place du décor se posent en clés sur la piste « Décor » de la timeline (zoom, glissement du fond). Décoché : le décor reste fixe, ses clés sont gardées.") },
              h("input", { type: "checkbox", checked: !!anim.bgAnim, on: { change: (e) => { if (e.target.checked) anim.bgAnim = true; else delete anim.bgAnim; if (!anim.bgAnim && sel === "bg") sel = "cam"; hist.snap(); paint(); lanes(); props(); } } }), tt("Animer le décor ⓘ")),
            h("button.mini", { title: tt("Taille 1, décor centré"), on: { click: () => { change("bg", { zoom: 1, ox: 0, oy: 0 }); hist.snap(); paint(); props(); } } }, tt("Recentrer le décor")));
        })() : "",
        h("button.mini", { title: tt("Ouvre l'atelier de dessin du fond de cette case : formes simples, tracés, gris en trame, lignes d'effet (touche Q)"), on: { click: drawDecor } }, pan.draw ? tt("✎ Modifier le fond dessiné") : tt("✎ Dessiner le fond")));
    } else {
      const it = itemOf(l), n = nOf(l, cur().v);
      side.append(range(tt("Position ↔"), "x", -1, 2, 0.005), range(tt("Position ↕"), "y", -1, 3, 0.005), range(tt("Taille"), "s", 0.05, 6, 0.01),
        range(tt("Inclinaison"), "rz", -180, 180, 1, (x) => Math.round(x) + "°"));
      if ((anim.nulls || []).length) {                     // parent : un null qu'il suit
        const pp = anim.par && anim.par[l.id];
        side.append(h("label.row", { title: tt("L'élément suit le null : ses déplacements, sa rotation (autour du null) et son échelle. Ses propres clés restent.") }, tt("Parent"),
          h("select", { on: { change: (e) => (e.target.value ? parentTo(l.id, e.target.value) : unparent(l.id)) } },
            h("option", { value: "" }, tt("(aucun)")), (anim.nulls || []).map((n) => h("option", { value: n.id, selected: !!pp && pp.id === n.id }, "✛ " + n.name)))));
      }
      if (n) side.append(range(tt("Axe (rotation)"), "f", 0, n - 1, 1, (x) => Math.round(x * 360 / n) + "°"));
      {
        const inp = h("input", { type: "range", min: 0, max: 1, step: 0.01, value: depthNow(l), on: { input: (e) => { setDepth(l, +e.target.value); paint(); lanes(); syncProps(); } } }), out = h("output", depthNow(l).toFixed(2));
        rows.push(() => { const v = depthNow(l); if (document.activeElement !== inp) inp.value = v; out.textContent = v.toFixed(2); });
        side.append(h("label.row.range", { title: tt("0 = tout devant, 1 = au fond. Sert à la parallaxe, au flou de profondeur et à l'ordre des éléments.") }, tt("Profondeur"), inp, out));
      }
      if (sprite(it, cur().v, cur().f)?.vec) {
        const wig = (label, k, min, max, def) => { const out = h("output", (l[k] ?? def).toFixed(1)); return h("label.row.range", label, h("input", { type: "range", min, max, step: 0.1, value: l[k] ?? def, on: { input: (e) => { l[k] = +e.target.value; out.textContent = (+e.target.value).toFixed(1); paint(); } } }), out); };
        side.append(range(tt("Trait"), "lw", -12, 6, 0.1, (x) => (+x).toFixed(1)), fold("wig", tt("Tremblé du trait"), wig(tt("Tremblé"), "hand", 0, 10, 0), wig(tt("Ondulation"), "wave", 0.5, 12, 4)),
          h("label.row.check", { title: tt("Le trait tremble en boucle pendant la lecture, comme un dessin refait à chaque image") }, h("input", { type: "checkbox", checked: !!(l.boil && l.boil.on), on: { change: (e) => { l.boil = Object.assign({ a: 2, v: 8 }, l.boil, { on: e.target.checked }); paint(); props(); } } }), tt("Animer le tremblé")),
          h("div.row.colrow", { title: tt("Couleur unie du personnage (le blanc du dessin). L'ombre et le masque de la bouche suivent.") }, h("span", tt("Couleur")),
            swatch(l.col || "#ffffff", (c) => { l.col = c; paint(); }),
            l.col && l.col.toLowerCase() !== "#ffffff" ? h("button.mini", { on: { click: () => { delete l.col; paint(); props(); } } }, tt("Blanc")) : ""),
          h("div.row.colrow", { title: tt("Couleur du trait : tout ce qui est noir dans le dessin prend cette couleur.") }, h("span", tt("Contour")),
            swatch(l.ink || "#111111", (c) => { l.ink = c; paint(); }),
            l.ink && l.ink.toLowerCase() !== "#111111" ? h("button.mini", { on: { click: () => { delete l.ink; paint(); props(); } } }, tt("Noir")) : ""));
      } else if (sprite(it, cur().v, cur().f)) {               // colorize : la couleur en produit dans la decoupe, bouches comprises
        const tn = l.tint || {};
        const cb = h("input", { type: "checkbox", checked: !!tn.on, on: { change: (e) => { l.tint = Object.assign({ c: "#e9b98f" }, l.tint, { on: e.target.checked }); hist.snap(); paint(); } } });
        side.append(h("div.row.colrow", { title: tt("Pose une couleur en produit sur le personnage, dans sa découpe : le blanc prend la couleur, les traits et la peinture restent visibles. Les bouches du lip sync prennent la même couleur.") },
          h("label.row.check", cb, tt("Colorize ⓘ")),
          swatch(tn.c || "#e9b98f", (c) => { l.tint = { on: true, c }; cb.checked = true; paint(); })));
      }
      side.append(voiceBox(l));
      if (l.boil && l.boil.on && sprite(it, cur().v, cur().f)?.vec) {
        const bo = (label, k, min, max, step, def, fmt) => { const out = h("output", fmt(l.boil[k] ?? def)); return h("label.row.range", label, h("input", { type: "range", min, max, step, value: l.boil[k] ?? def, on: { input: (e) => { l.boil[k] = +e.target.value; out.textContent = fmt(+e.target.value); paint(); } } }), out); };
        const at = [...side.children].find((x) => x.matches && x.matches("label.check") && /Animer le tremblé/.test(x.textContent));
        const box = h("div.fold-in", bo(tt("Intensité"), "a", 0.3, 8, 0.1, 2, (x) => (+x).toFixed(1)), bo(tt("Rapidité"), "v", 1, 24, 1, 8, (x) => Math.round(x) + " /s"));
        if (at) at.after(box); else side.append(box);
      }
      const move = (d) => reorder(l, d);
      side.append(h("h4", tt("Ordre")), h("div.row.wrap", h("button.mini", { on: { click: () => move(1) } }, tt("Avancer")), h("button.mini", { on: { click: () => move(-1) } }, tt("Reculer")),
        h("button.mini", { on: { click: () => move("top") } }, tt("Premier plan")), h("button.mini", { on: { click: () => move("bottom") } }, tt("Arrière-plan"))));
      if (it && Object.keys(it.variants).length > 1) side.append(h("label.row", tt("Pose"), h("select", { on: { change: (e) => { const vv = variantOf(it, e.target.value); preload(it, e.target.value); change(sel, { v: e.target.value, f: vv && vv.orbit ? Math.min(cur().f, vv.orbit.n - 1) : 0 }); props(); } } },
        Object.entries(it.variants).map(([k, vv]) => h("option", { value: k, selected: k === cur().v }, (vv.orbit ? "↻ " : "▫ ") + tr(vv.label))))));
      // ombre et ombre portee : en dernier, apres la profondeur et le reste
      if (sprite(it, cur().v, cur().f)?.vec) {
        const sh = l.sh || {};
        side.append(h("label.row.check", h("input", { type: "checkbox", checked: !!sh.on, on: { change: (e) => { l.sh = Object.assign({ on: true, g: 0.72, w: 5, a: 135, k: 0 }, l.sh, { on: e.target.checked }); paint(); props(); } } }), tt("Ombre")));
        if (sh.on) side.append(fold("sh", tt("Réglages de l'ombre"),
          h("label.row.check", { title: tt("L'ombre prend la couleur choisie pour le contour du dessin, au lieu d'assombrir la couleur du corps") }, h("input", { type: "checkbox", checked: !!sh.ink, on: { change: (e) => { l.sh.ink = e.target.checked; paint(); } } }), tt("Couleur du contour")),
          range(tt("Gris"), "shg", 0.2, 0.95, 0.01), range(tt("Largeur"), "shw", 0.5, 25, 0.1, (x) => (+x).toFixed(1)), range(tt("Lumière (angle)"), "sha", 0, 360, 1, (x) => Math.round(x) + "°"),
          h("label.row.range", { title: tt("0 : ombre sur la silhouette seule. Monter ajoute une ombre aux plus grandes formes du dessin, une par cran.") }, tt("Formes détaillées ⓘ"), h("input", { type: "range", min: 0, max: 8, step: 1, value: sh.k || 0, on: { input: (e) => { l.sh.k = +e.target.value; e.target.nextSibling.textContent = e.target.value; paint(); } } }), h("output", String(sh.k || 0)))));
      }
      {
        const gs = l.gs || {}, putg = (k, x) => { l.gs = Object.assign({ on: true, a: 0.35, w: 0.8 }, l.gs, { [k]: x }); paint(); };
        const plain = (label, k, min, max, def) => { const out = h("output", (gs[k] ?? def).toFixed(2)); return h("label.row.range", label, h("input", { type: "range", min, max, step: 0.01, value: gs[k] ?? def, on: { input: (e) => { putg(k, +e.target.value); out.textContent = (+e.target.value).toFixed(2); } } }), out); };
        side.append(h("div.row.wrap", h("label.row.check", { title: tt("Une tache sombre et floue sous l'élément, pour le poser au sol") }, h("input", { type: "checkbox", checked: !!gs.on, on: { change: (e) => { putg("on", e.target.checked); props(); } } }), tt("Ombre portée")),
          gs.on ? h("label.row.check", { title: tt("Au mur : l'ombre se dresse à la verticale sur le côté, derrière le personnage, au lieu d'être couchée au sol. Mêmes réglages.") }, h("input", { type: "checkbox", checked: !!gs.wall, on: { change: (e) => putg("wall", e.target.checked) } }), tt("Au mur")) : ""));
        if (gs.on) side.append(fold("gs", tt("Réglages de l'ombre portée"),
          h("div.row.colrow", { title: tt("Couleur de l'ombre portée. « Cloner la couleur de contour », s'il est coché, l'emporte sur elle.") }, h("span", tt("Couleur")), swatch(gs.c || "#000000", (c) => putg("c", c))),
          h("label.row.check", { title: tt("L'ombre prend la couleur choisie pour le contour du dessin, au lieu du noir") }, h("input", { type: "checkbox", checked: !!gs.ink, on: { change: (e) => putg("ink", e.target.checked) } }), tt("Couleur du contour")),
          plain(tt("Opacité"), "a", 0.05, 1, 0.35), h("div", { title: tt("0 : bord net. Vers la droite : de plus en plus floue.") }, plain(tt("Flou ⓘ"), "b", 0, 4, 1)), plain(tt("Largeur"), "w", 0.2, 2.5, 0.8), plain(tt("Épaisseur"), "h", 0.2, 4, 1),
          h("div", { title: tt("Pour la caler sous les pieds quand le personnage a l'air de flotter") }, plain(tt("Décalage ↔ ⓘ"), "dx", -0.6, 0.6, 0), plain(tt("Décalage ↕"), "dy", -0.6, 0.6, 0)),
          h("div", { title: tt("Déforme le contour de l'ombre. 0 : ovale net. Tout à droite : une tache abstraite. Ondulation courte = bord déchiqueté, longue = grandes vagues. Forme : une autre tache, au hasard.") },
            plain(tt("Tremblé ⓘ"), "hand", 0, 10, 0), plain(tt("Ondulation"), "wave", 0.5, 12, 4), plain(tt("Forme"), "seed", 0, 40, 0))));
      }
    }
    keyBar();
    syncProps = () => rows.forEach((f) => f());
  }
  // boutons de cle : juste au-dessus de la timeline
  const keyBox = h("div.mt-keys");
  function keyBar() {
    keyBox.textContent = "";
    if (shapeOf(sel)) { keyBox.append(h("span.muted", tt("Forme du décor : elle se place en profondeur, sans clés."))); return; }
    const k = selKey && keysOf(sel).includes(selKey) ? selKey : near(sel), name = CAMS[sel] || (nullOf(sel) || {}).name || (itemOf(layerOf(sel)) || {}).name || tt("élément");
    keyBox.append(
      h("button.mini", { title: tt("Aller à la clé précédente (Alt + ←). Piste choisie ; si elle n'a pas de clé, toutes les pistes."), on: { click: () => jumpKey(-1) } }, "◀◆"),
      h("button.mini", { title: tt("Aller à la clé suivante (Alt + →)"), on: { click: () => jumpKey(1) } }, "◆▶"),
      h("span.muted", name + " :"),
      h("button.mini", { title: tt("Enregistre les réglages de cet instant"), on: { click: () => { setKey(sel, {}); paint(); lanes(); props(); } } }, tt("◆ Poser une clé")),
      h("button.mini.danger", { disabled: !k, title: tt("Retire la clé sous la tête de lecture"), on: { click: () => { anim.tracks[sel] = keysOf(sel).filter((x) => x !== k); selKey = null; paint(); lanes(); props(); } } }, tt("Retirer cette clé")),
      h("button.mini.danger", { disabled: !keysOf(sel).length, on: { click: () => { delete anim.tracks[sel]; selKey = null; paint(); lanes(); props(); } } }, tt("Vider la piste")),
      k ? h("label.row", tt("Interpolation"), h("select", { title: tt("Façon d'arriver sur cette clé"), on: { change: (e) => { for (const q of picked.has(k) && picked.size > 1 ? [...picked] : [k]) q.e = e.target.value; paint(); lanes(); } } }, Object.entries(EASES).map(([v, n]) => h("option", { value: v, selected: (k.e || "doux") === v }, n)))) : "");
  }
  function jumpKey(dir) {                                   // de cle en cle : celles de la piste choisie, sinon toutes
    stop();
    const own = keysOf(sel), all = own.length ? own : Object.values(anim.tracks).flat();
    const ts = [...new Set(all.map((k) => k.t))].sort((a, b) => a - b);
    const to = dir > 0 ? ts.find((x) => x > t + 0.02) : [...ts].reverse().find((x) => x < t - 0.02);
    if (to == null) return toast(ts.length ? (dir > 0 ? tt("Pas de clé après.") : tt("Pas de clé avant.")) : tt("Aucune clé posée."));
    picked.clear(); selKey = own.find((k) => k.t === to) || null;
    seek(to, true);
  }
  function reorder(l, d) {                                 // avancer, reculer, premier plan, arriere-plan
    const i = pan.layers.indexOf(l), j = d === "top" ? pan.layers.length - 1 : d === "bottom" ? 0 : i + d;
    if (j < 0 || j >= pan.layers.length || j === i) return;
    const has = pan.layers.some((x) => x.d != null);       // profondeurs reglees : elles restent rangees dans l'ordre
    if (has) fixDepths();
    const ds = pan.layers.map((x) => x.d).sort((a, b) => b - a);
    pan.layers.splice(i, 1); pan.layers.splice(j, 0, l);
    if (has) pan.layers.forEach((x, q) => { x.d = ds[q]; });
    paint(); lanes(); props();
  }
  // menu du clic droit dans l'image : a peu pres celui des cases (pose, axe, ordre, ombres…), plus les cles
  function ctxMenu(e, items) {
    document.querySelector(".mt-menu")?.remove();
    const box = h("div.menu.mt-menu");
    for (const it of items) {
      if (!it) continue;
      if (it.head) { box.append(h("div.mhead", it.head)); continue; }
      if (it.note) { box.append(h("div.mnote", it.note)); continue; }
      box.append(h("button" + (it.half ? ".half" : "") + (it.checked ? ".on" : "") + (it.danger ? ".danger" : ""), { on: { click: () => { box.remove(); it.click(); } } }, it.checked ? "✓ " : "", it.label));
    }
    document.body.append(box);
    const r = box.getBoundingClientRect();
    box.style.left = Math.max(4, Math.min(e.clientX, innerWidth - r.width - 6)) + "px";
    box.style.top = Math.max(4, Math.min(e.clientY, innerHeight - r.height - 6)) + "px";
    const close = (ev) => { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener("pointerdown", close, true); } };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  }
  function layerMenu(e, l) {
    const it = itemOf(l), st = stateOf(l), vv = it && variantOf(it, st.v), items = [{ head: it ? it.name : tt("Élément") }];
    items.push({ label: tt("◆ Poser une clé ici"), click: () => { setKey(l.id, {}); paint(); lanes(); props(); } });
    if (it && Object.keys(it.variants).length > 1) {
      items.push({ head: tt("Pose") });
      for (const [k, v] of Object.entries(it.variants)) items.push({ label: (v.orbit ? "↻ " : "▫ ") + tr(v.label), checked: k === st.v, click: () => { preload(it, k); change(l.id, { v: k, f: v.orbit ? Math.min(st.f, v.orbit.n - 1) : 0 }); props(); } });
      items.push({ note: tt("↻ orbite prête · ▫ image fixe") });
    }
    if (vv && vv.orbit && vv.orbit.n) {
      const curAx = AXES[Math.round(frameToAngle(vv.orbit, st.f) / 45) % 8];
      items.push({ head: tt("Axe") });
      AXES.forEach((ax, i) => items.push({ label: tr(ax), half: true, checked: ax === curAx, click: () => change(l.id, { f: angleToFrame(vv.orbit, i * 45) }) }));
    }
    if ((anim.nulls || []).length) {
      const pp = anim.par && anim.par[l.id];
      items.push({ head: tt("Parent") }, { label: tt("(aucun)"), checked: !pp, click: () => unparent(l.id) });
      for (const n of anim.nulls) items.push({ label: "✛ " + n.name, checked: !!pp && pp.id === n.id, click: () => parentTo(l.id, n.id) });
    }
    items.push({ head: tt("Ordre") },
      { label: tt("Avancer"), half: true, click: () => reorder(l, 1) }, { label: tt("Reculer"), half: true, click: () => reorder(l, -1) },
      { label: tt("Premier plan"), half: true, click: () => reorder(l, "top") }, { label: tt("Arrière-plan"), half: true, click: () => reorder(l, "bottom") },
      { head: tt("Élément") },
      { label: tt("Retourner (miroir)"), checked: !!l.flip, click: () => { l.flip = !l.flip; paint(); } });
    if (sprite(it, st.v, st.f)?.vec) items.push({ label: tt("Ombre"), checked: !!(l.sh && l.sh.on), click: () => { l.sh = Object.assign({ on: true, g: 0.72, w: 5, a: 135, k: 0 }, l.sh, { on: !(l.sh && l.sh.on) }); paint(); props(); } },
      { label: tt("Animer le tremblé"), checked: !!(l.boil && l.boil.on), click: () => { l.boil = Object.assign({ a: 2, v: 8 }, l.boil, { on: !(l.boil && l.boil.on) }); paint(); props(); } });
    items.push({ label: tt("Ombre portée"), checked: !!(l.gs && l.gs.on), click: () => { l.gs = Object.assign({ on: true, a: 0.35, w: 0.8 }, l.gs, { on: !(l.gs && l.gs.on) }); paint(); props(); } },
      { label: tt("Bouche qui parle"), checked: !!(l.lip && l.lip.on), click: async () => { l.lip = Object.assign({ off: 0, bg: true }, l.lip, { on: !(l.lip && l.lip.on) }); await persoFirst(l); paint(); props(); } },
      l.lip && l.lip.on ? { label: tt("✛ Placer la bouche à la main"), click: () => { placing = l.id; svg.style.cursor = "crosshair"; props(); } } : null,
      { head: tt("Clés") },
      keysOf(l.id).length ? { label: tt("Vider sa piste"), danger: true, click: () => { delete anim.tracks[l.id]; selKey = null; paint(); lanes(); props(); } } : { note: tt("Aucune clé sur cet élément") });
    ctxMenu(e, items);
  }
  function camMenu(e) {
    const items = [{ head: tt("Caméra") }, { label: tt("◆ Poser une clé ici"), click: () => { setKey("cam", {}); sel = "cam"; paint(); lanes(); props(); } }, { head: tt("Mouvements prêts") }];
    for (const [k, [name]] of Object.entries(MOVES)) items.push({ label: name, click: () => applyMove(k) });
    items.push({ head: tt("Plan") },
      { label: tt("Flou de profondeur"), checked: !!dof.on, click: () => { dof.on = !dof.on; paint(); lanes(); props(); } },
      { label: tt("Parallaxe automatique"), checked: !!anim.parallax, click: () => { anim.parallax = !anim.parallax; paint(); props(); } },
      { label: tt("Tremblé de caméra (à l'épaule)"), checked: !!(anim.shake && anim.shake.on), click: () => { anim.shake = Object.assign({ a: 1, v: 1, r: 1 }, anim.shake, { on: !(anim.shake && anim.shake.on) }); sel = "cam"; paint(); props(); } },
      { label: pan.draw ? tt("✎ Modifier le fond dessiné") : tt("✎ Dessiner le fond"), click: drawDecor },
      { label: depthView || isoView ? tt("🖼 Voir l'image") : tt("⬒ Vue de dessus (profondeur)"), click: () => setView(depthView || isoView ? "image" : "depth") });
    ctxMenu(e, items);
  }
  const chanOn = (k, c) => k[c] != null && !(k.skip || []).includes(c);
  function dropChannel(k, c, id = "cam") {                  // la cle ne compte plus pour ce canal ; sans canal, elle disparait
    k.skip = [...new Set([...(k.skip || []), c])];
    if (chansOf(id).every(([q]) => !chanOn(k, q))) anim.tracks[id] = keysOf(id).filter((x) => x !== k);
  }
  function splitChannel(k, c, id = "cam") {                 // deplacer un seul canal : il part dans sa propre cle, au meme instant
    if (chansOf(id).every(([q]) => q === c || !chanOn(k, q))) return k;
    const n = { t: k.t, [c]: k[c], skip: chansOf(id).map(([q]) => q).filter((q) => q !== c) };
    if (k.e) n.e = k.e;
    dropChannel(k, c, id);
    keysOf(id).push(n); keysOf(id).sort((a, b) => a.t - b.t);
    return n;
  }
  // copier / coller des cles (Ctrl+C, Ctrl+V, « Dupliquer » au clic droit) : elles gardent leurs ecarts ; la premiere se
  // pose a la tete de lecture. Les cles d'un seul element se collent sur l'element choisi s'il en est un autre.
  let keyClip = null;
  const trackOf = (k) => Object.keys(anim.tracks).find((id) => anim.tracks[id].includes(k));
  const keysSel = () => (picked.size ? [...picked] : selKey ? [selKey] : []);
  function copyKeys(quiet) {
    const ks = keysSel().map((k) => ({ id: trackOf(k), k })).filter((x) => x.id);
    if (!ks.length) return false;
    const t0 = Math.min(...ks.map((x) => x.k.t));
    keyClip = ks.map(({ id, k }) => ({ id, dt: k.t - t0, k: JSON.parse(JSON.stringify(k)) }));
    if (!quiet) toast(ks.length > 1 ? tt`${ks.length} clés copiées.` : tt("Clé copiée."));
    return true;
  }
  function pasteKeys(at) {
    if (!keyClip || !keyClip.length) return toast(tt("Aucune clé copiée (Ctrl+C sur une clé)."), "error");
    const ids = [...new Set(keyClip.map((x) => x.id))], one = ids.length === 1 && layerOf(ids[0]) && layerOf(sel) ? sel : null;
    const made = [];
    for (const { id, dt, k } of keyClip) {
      const to = one || id;
      if (!CAMS[to] && !layerOf(to) && !nullOf(to)) continue;               // element retire depuis
      const nk = Object.assign(JSON.parse(JSON.stringify(k)), { t: f3(clamp(at + dt, 0, anim.dur)) });
      const ks = (anim.tracks[to] = (anim.tracks[to] || []).filter((x) => Math.abs(x.t - nk.t) > 0.02));   // une cle au meme instant est remplacee
      ks.push(nk); ks.sort((a, b) => a.t - b.t);
      made.push(nk);
    }
    if (!made.length) return toast(tt("Les pistes de ces clés n'existent plus."), "error");
    picked.clear(); if (made.length > 1) made.forEach((k) => picked.add(k));
    selKey = made[0]; if (one) sel = one;
    hist.snap(); paint(); lanes(); props();
  }
  function keyMenu(e, id, k, ch) {                          // clic droit sur une cle : son interpolation ; ch : canal deploye de la camera
    e.preventDefault();
    document.querySelector(".mt-menu")?.remove();
    const group = picked.has(k) && picked.size > 1 ? [...picked] : [k];   // plusieurs cles selectionnees : elles prennent toutes le choix
    const box = h("div.menu.mt-menu", h("div.mhead", group.length > 1 ? tt`${group.length} clés sélectionnées · arrivée` : tt`Clé à ${k.t.toFixed(2)} s · arrivée`),
      Object.entries(EASES).map(([v, n]) => h("button" + ((k.e || "doux") === v ? ".on" : ""), { on: { click: () => { for (const q of group) q.e = v; box.remove(); paint(); lanes(); props(); } } }, ((k.e || "doux") === v ? "✓ " : "") + n)),
      ch ? h("button.danger", { on: { click: () => { dropChannel(k, ch, id); selKey = null; box.remove(); paint(); lanes(); props(); } } }, tt`Retirer cette clé du canal « ${(chansOf(id).find(([c]) => c === ch) || [ch, ch])[1]} »`) : "",
      h("button", { title: tt("La copie se pose à la tête de lecture (une demi-seconde plus loin si la tête est sur la clé)"), on: { click: () => {
        box.remove(); if (!picked.has(k)) { picked.clear(); selKey = k; }
        const t0 = Math.min(...group.map((q) => q.t)), at = Math.abs(t - t0) < 0.02 ? t0 + 0.5 : t;
        if (copyKeys(true)) pasteKeys(at);
      } } }, group.length > 1 ? tt`⧉ Dupliquer les ${group.length} clés` : tt("⧉ Dupliquer la clé")),
      h("button", { on: { click: () => { box.remove(); if (!picked.has(k)) { picked.clear(); selKey = k; } copyKeys(); } } }, tt("Copier (Ctrl+C)")),
      keyClip ? h("button", { on: { click: () => { box.remove(); pasteKeys(t); } } }, tt("Coller à la tête de lecture (Ctrl+V)")) : "",
      group.length > 1 ? h("button", { title: tt("Une barre apparaît au-dessus des pistes, de la première à la dernière clé prise : tirer une poignée élargit ou rétrécit leur durée, en gardant leurs proportions ; glisser la barre les déplace toutes"), on: { click: () => { box.remove(); stretchOn = true; lanes(); } } }, tt("⟷ Resize (durée des clés)")) : "",
      h("button.danger", { on: { click: () => { anim.tracks[id] = keysOf(id).filter((x) => x !== k); selKey = null; box.remove(); paint(); lanes(); props(); } } }, ch ? tt("Retirer la clé (tous les canaux)") : tt("Retirer cette clé")));
    document.body.append(box);
    const r = box.getBoundingClientRect();
    box.style.left = Math.max(4, Math.min(e.clientX, innerWidth - r.width - 6)) + "px";
    box.style.top = Math.max(4, Math.min(e.clientY, innerHeight - r.height - 6)) + "px";
    const close = (ev) => { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener("pointerdown", close, true); } };
    document.addEventListener("pointerdown", close, true);
  }
  function applyMove(k) {
    if (!MOVES[k]) return;
    const [, a, b] = MOVES[k];
    if (!a) delete anim.tracks.cam;
    else anim.tracks.cam = [Object.assign({ t: 0 }, CAM0, a), Object.assign({ t: f3(anim.dur) }, CAM0, b)];
    sel = "cam"; selKey = null; paint(); lanes(); props();
  }

  // ------------------------------------------------------------------------------------------ voix et bouche (lip sync)
  const players = new Map();                               // un lecteur de son par calque qui parle
  let placing = null, rec = null, showMask = false;
  const voiceUrl = (lip) => `/projects/${app.project.id}/${lip.src}`;
  function voices(on) {                                    // pendant la lecture, chaque voix suit la tete de lecture
    for (const l of pan.layers) {
      const lip = l.lip;
      if (!lip || !lip.src) continue;
      let a = players.get(l.id);
      if (!a || a.dataset.src !== lip.src) { if (a) a.pause(); a = new Audio(voiceUrl(lip)); a.dataset.src = lip.src; a.preload = "auto"; players.set(l.id, a); }
      const want = voiceTime(lip, t);
      if (!on || want < 0) { if (!a.paused) a.pause(); continue; }
      if (a.paused) { try { a.currentTime = want; } catch (e) { /* pas encore charge */ } a.play().catch(() => {}); }
      else if (Math.abs(a.currentTime - want) > 0.25) a.currentTime = want;
    }
    if (!on) for (const a of players.values()) a.pause();
  }
  async function setVoice(l, blob, name, file) {           // un son arrive (fichier, micro ou voix generee) : on le range, on l'ecoute, on pose les bouches
    try {
      toast(tt("Écoute de la voix…"));
      const [r, res] = await Promise.all([file ? (typeof file === "string" ? { file } : file) : upload(`projects/${app.project.id}/audio?name=${encodeURIComponent(name)}&source=${/^micro\./.test(name) ? "micro" : "import"}`, blob), blob.arrayBuffer().then((b) => analyse(b))]);
      if (r.audio) { put("audio/" + r.audio, { dur: res.dur }).catch(() => {}); if (app.bankUI) app.bankUI.reload(); libAudio = null; }   // la voix est aussi rangee dans la banque audio
      const first = !l.lip || l.lip.x == null;
      l.lip = Object.assign({ on: true, off: 0, bg: true }, l.lip, { src: r.file, name, dur: res.dur, fps: res.fps, cues: res.cues });
      delete l.lip.in; delete l.lip.out; delete l.lip.segs;
      if (first || (hasPerso(itemOf(l)) && !l.lip.set)) await autoMouth(l, true);
      if ((l.lip.off || 0) + res.dur > anim.dur) { anim.dur = Math.min(60, Math.ceil(((l.lip.off || 0) + res.dur) * 2) / 2); dur.value = anim.dur; }
      hist.snap(); paint(); lanes(); props();
      toast(tt`Voix posée : ${res.dur.toFixed(1)} s, ${new Set(res.cues).size} bouches différentes.`);
    } catch (e) { toast(tt("Voix refusée : ") + e.message, "error"); }
  }
  // voix de synthese ElevenLabs : un texte, une voix du compte, et le son arrive comme une voix importee
  let ttsVoices = null, ttsBusy = false, libAudio = null;
  function libBox(l) {                                     // reprendre une voix deja rangee dans la banque audio : menu en cascade par dossier
    const take = async (id) => {
      try {
        const r = await post(`projects/${app.project.id}/audio-from`, { id });
        await setVoice(l, await (await fetch(`/projects/${app.project.id}/${r.file}`)).blob(), r.name, r.file);
      } catch (err) { toast(tt("Son non repris : ") + err.message, "error"); }
    };
    const label = () => (libAudio ? (libAudio.length ? tt("📁 Prendre dans la banque audio…") : tt("Banque audio vide")) : tt("Banque audio…"));
    const btn = h("button.mt-libpick", { title: tt("Les voix importées, enregistrées ou générées sont rangées dans l'onglet Audio de la banque"), on: { click: () => { if (libAudio && libAudio.length) cascade(btn, libAudio, take); } } }, label());
    if (!libAudio) get("audio").then((v) => { libAudio = v || []; btn.textContent = label(); }).catch(() => {});
    return btn;
  }
  let casPlayer = null, casPlaying = null, casBtn = null;   // ecoute d'un son du menu en cascade
  function listen(a, btn) {
    if (!casPlayer) casPlayer = new Audio();
    const same = casPlaying === a.id && !casPlayer.paused;
    casPlayer.pause();
    if (casBtn && casBtn.isConnected) casBtn.textContent = "▶";
    if (same) { casPlaying = null; return; }
    casPlayer.src = `/audio/${a.file}`; casPlayer.currentTime = 0;
    casPlayer.onended = () => { if (btn.isConnected) btn.textContent = "▶"; casPlaying = null; };
    casPlayer.play().catch((e) => toast(tt("Lecture impossible : ") + e.message, "error"));
    casPlaying = a.id; casBtn = btn; btn.textContent = "■";
  }
  /** Menu en cascade des sons de la banque : les dossiers d'abord (survol : leur contenu s'ouvre a cote), puis les sons. */
  function cascade(anchor, list, onPick) {
    document.querySelectorAll(".mt-casc").forEach((m) => m.remove());
    const root = { dirs: new Map(), files: [] };
    for (const a of list) {
      let n = root;
      for (const part of (a.folder || "").split("/").map((s) => s.trim()).filter(Boolean)) {
        if (!n.dirs.has(part)) n.dirs.set(part, { dirs: new Map(), files: [] });
        n = n.dirs.get(part);
      }
      n.files.push(a);
    }
    const count = (n) => n.files.length + [...n.dirs.values()].reduce((s, d) => s + count(d), 0);
    const levels = [];
    const closeFrom = (i) => { while (levels.length > i) levels.pop().remove(); };
    const closeAll = () => { if (casPlayer) casPlayer.pause(); casPlaying = null; closeFrom(0); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", esc, true); };
    const outside = (ev) => { if (!levels.some((m) => m.contains(ev.target)) && ev.target !== anchor) closeAll(); };
    const esc = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); closeAll(); } };
    function open(node, depth, x, y, leftEdge) {
      closeFrom(depth);
      const box = h("div.menu.mt-menu.mt-casc");
      for (const [name, d] of [...node.dirs.entries()].sort((p, q) => p[0].localeCompare(q[0]))) {
        const row = h("button.dir", { title: name }, h("span", "📁 " + name), h("small", `${count(d)} ▸`));
        const go = () => {
          box.querySelectorAll(".dir.open").forEach((r) => r.classList.remove("open"));
          row.classList.add("open");
          const r = row.getBoundingClientRect();
          open(d, depth + 1, r.right + 2, r.top - 6, r.left - 2);
        };
        row.addEventListener("pointerenter", go);
        row.addEventListener("click", go);
        box.append(row);
      }
      for (const a of node.files) {
        // ▶ : ecouter le son avant de le prendre (un clic sur le nom le prend)
        const play = h("i.mt-cplay", { title: tt("Écouter avant de choisir") }, casPlaying === a.id && casPlayer && !casPlayer.paused ? "■" : "▶");
        play.addEventListener("click", (ev) => { ev.stopPropagation(); ev.preventDefault(); listen(a, play); });
        const row = h("button.snd", { title: a.text || a.name, on: { click: () => { closeAll(); onPick(a.id); } } }, play, h("span", a.name), a.dur ? h("small", `${a.dur.toFixed(1)} s`) : "");
        row.addEventListener("pointerenter", () => { closeFrom(depth + 1); box.querySelectorAll(".dir.open").forEach((r) => r.classList.remove("open")); });
        box.append(row);
      }
      if (!node.dirs.size && !node.files.length) box.append(h("div.mnote", tt("(dossier vide)")));
      document.body.append(box);
      levels.push(box);
      const r = box.getBoundingClientRect();
      const left = x + r.width > innerWidth - 6 && leftEdge != null ? leftEdge - r.width : x;
      box.style.left = Math.max(4, Math.min(left, innerWidth - r.width - 6)) + "px";
      box.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + "px";
    }
    const r = anchor.getBoundingClientRect();
    open(root, 0, r.left, r.bottom + 2, null);
    setTimeout(() => { document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", esc, true); }, 0);
  }
  const tts = { text: "", voice: localStorage.getItem("bw.ttsVoice") || "" };
  function ttsBox(l) {
    const area = h("textarea", { rows: 3, placeholder: tt("Ce que dit le personnage…"), style: { width: "100%", boxSizing: "border-box" }, on: { input: (e) => { tts.text = e.target.value; } } });
    area.value = tts.text;
    const pick = h("select", { on: { change: (e) => { tts.voice = e.target.value; localStorage.setItem("bw.ttsVoice", tts.voice); } } }, h("option", { value: "" }, ttsVoices ? tt("Choisir une voix…") : tt("Chargement des voix…")));
    const fill = () => { pick.textContent = ""; pick.append(h("option", { value: "" }, tt("Choisir une voix…")), ...ttsVoices.map((v) => h("option", { value: v.id, selected: v.id === tts.voice && !v.empty, title: tr(v.info), disabled: !!v.empty }, v.name + (v.info ? " · " + tr(v.info) : "")))); };
    if (ttsVoices) fill();
    else get("tts/voices").then((v) => { ttsVoices = v; fill(); }).catch((e) => { pick.textContent = ""; pick.append(h("option", { value: "" }, tt("Voix indisponibles"))); note.textContent = e.message; });
    const note = h("div.muted", "");
    const go = h("button.mini", { disabled: ttsBusy, on: { click: async () => {
      if (!tts.text.trim()) return toast(tt("Écris d'abord le texte à dire."), "error");
      if (!tts.voice) return toast(tt("Choisis une voix."), "error");
      ttsBusy = true; go.disabled = true; go.textContent = tt("Génération…");
      try {
        const vn = (ttsVoices || []).find((v) => v.id === tts.voice), label = `${vn ? vn.name : "voix"} : ${tts.text.trim().slice(0, 30)}`;
        const r = await post(`projects/${app.project.id}/tts`, { text: tts.text.trim(), voice: tts.voice, voice_name: vn ? vn.name : "", name: label });
        const blob = await (await fetch(`/projects/${app.project.id}/${r.file}`)).blob();
        ttsBusy = false;
        await setVoice(l, blob, label, r);
      } catch (e) { ttsBusy = false; toast(tt("Voix non générée : ") + e.message, "error"); if (go.isConnected) { go.disabled = false; go.textContent = tt("✨ Générer la voix"); } }
    } } }, ttsBusy ? tt("Génération…") : tt("✨ Générer la voix"));
    return fold("tts", tt("✨ Générer une voix (ElevenLabs)"), area, h("label.row", tt("Voix"), pick), h("div.row", go), note);
  }
  function trimBlanks(l) {                                 // coupe le silence du debut et de la fin (d'apres les bouches trouvees)
    const lip = l.lip, c = lip.cues || "", fps = lip.fps || 12, first = c.search(/[^X]/);
    if (first < 0) return toast(tt("Cette voix est muette : rien à garder."));
    let last = c.length - 1; while (last > first && c[last] === "X") last--;
    delete lip.segs;                                       // la voix redevient d'un seul morceau
    lip.in = f3(Math.max(0, first / fps - 0.06)); lip.out = f3(Math.min(lip.dur || 1e9, (last + 1) / fps + 0.12));
    hist.snap(); paint(); lanes(); props();
    toast(tt`Blancs coupés : ${(lip.out - lip.in).toFixed(1)} s gardées sur ${(lip.dur || 0).toFixed(1)}.`);
  }
  async function autoMouth(l, quiet) {                     // reperage automatique sur l'image de face
    const it = itemOf(l), st = stateOf(l), vv = it && variantOf(it, st.v);
    const sp = it && sprite(it, st.v, vv && vv.orbit ? angleToFrame(vv.orbit, 0) : 0);
    let found = sp && await locateMouth(sp.url);
    const lip0 = l.lip || {};
    if (hasPerso(it) && (!lip0.set || lip0.set === PERSO)) {   // ses propres bouches : place et taille mesurees sur la variante base
      const m = it.mouths, base = !st.v || st.v === "base" || !(it.variants || {})[st.v];
      found = base ? { x: m.x, y: m.y, s: m.s, hw: (found && found.hw) || 0.03 } : Object.assign({ x: 0.5, y: 0.13, hw: 0.03 }, found, { s: m.s });
      found.set = PERSO;
    }
    l.lip = Object.assign({ on: true, off: 0, bg: true }, l.lip, found || { x: 0.5, y: 0.13, s: 0.035, hw: 0.03 });
    if (!quiet) { paint(); props(); toast(found ? tt("Bouche repérée sur l'image de face. Ajuste au besoin, ou place-la à la main.") : tt("Repérage impossible sur cette image : place la bouche à la main.")); }
  }
  // a la premiere activation de la bouche d'un element qui a ses propres bouches : on les prend, a leur place
  async function persoFirst(l) { if (l.lip && l.lip.on && !l.lip.set && hasPerso(itemOf(l))) { await autoMouth(l, true); hist.snap(); } }
  function placeMouth(e) {                                 // placement a la main : un clic dans l'image, la ou est la bouche
    const l = layerOf(placing); placing = null; svg.style.cursor = "";
    if (!l) return;
    const p = ptOf(e), c = camAt(), a = c.rot * Math.PI / 180, X0 = (p[0] - 0.5) * W, Y0 = (p[1] - 0.5) * H;
    const X = (X0 * Math.cos(a) - Y0 * Math.sin(a)) / c.z + c.cx * W, Y = (X0 * Math.sin(a) + Y0 * Math.cos(a)) / c.z + c.cy * H;   // du cadre de la camera vers la case
    const st = stateOf(l), it = itemOf(l), sp = it && sprite(it, st.v, st.f);
    if (!sp) return;
    const box = layerBox(bb, Object.assign({}, l, st), sp), ang = scene.angleOf(l, st.v, st.f);
    const lip = l.lip = Object.assign({ on: true, off: 0, bg: true, s: 0.035, hw: 0.03 }, l.lip);
    const px = l.flip ? 2 * box.cx - X : X;
    lip.x = f3((px + Math.sin(ang) * (lip.hw ?? 0.03) * box.h - box.x) / box.w);       // ramene a la vue de face
    lip.y = f3((Y - box.y) / box.h);
    hist.snap(); paint(); props();
  }
  // Bouche du dessin : l'utilisateur trace un trait d'un coin de la bouche a l'autre sur le personnage, au crayon ou en
  // droite ; le serveur l'accroche a la bouche dessinee et la suit dans l'orbite (mouth.json de la variante affichee).
  // Le trace vaut pour l'element et sa variante : tous les calques qui l'utilisent en profitent.
  let tracing = null, traceMode = localStorage.getItem("bw.traceMode") || "crayon", tdraw = null;
  const spriteNow = (l) => { const st = stateOf(l), it = itemOf(l); return it && sprite(it, st.v, st.f); };
  const mouthGroup = (id) => svg.querySelector(`[data-mouth="${id}"]`);
  function traceDown(e) {
    const l = layerOf(tracing);
    if (!l || !mouthGroup(l.id)) { tracing = null; pen(false); props(); return toast(tt("Cet élément n'a pas d'orbite : rien à tracer."), "error"); }
    const pt = (ev) => { const g = mouthGroup(l.id), m = g && g.getScreenCTM(); if (!m) return null; const q = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse()); return [q.x, q.y]; };
    const p = pt(e);
    if (!p) return;
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
    tdraw = { l, pt, pts: [p], line: null };
    traceShow();
  }
  function traceShow() {                                   // le trait en cours, dans le groupe de l'image (il suit l'image si elle est redessinee)
    const g = mouthGroup(tdraw.l.id);
    if (!g) return;
    if (!tdraw.line || !tdraw.line.isConnected) { tdraw.line = document.createElementNS(NS, "polyline"); tdraw.line.setAttribute("class", "mt-trace"); g.appendChild(tdraw.line); }
    tdraw.line.setAttribute("points", tdraw.pts.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" "));
  }
  function traceMove(e) {
    const p = tdraw.pt(e);
    if (!p) return;
    if (traceMode === "droite") tdraw.pts = [tdraw.pts[0], p];
    else { const a = tdraw.pts[tdraw.pts.length - 1]; if (Math.hypot(p[0] - a[0], p[1] - a[1]) > 0.7) tdraw.pts.push(p); }
    traceShow();
  }
  async function traceUp() {
    const { l, pts } = tdraw; tdraw = null;
    const span = pts.length > 1 ? Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) : 0;
    if (span < 3) { paint(); return toast(tt("Trait trop court : trace d'un coin de la bouche à l'autre."), "error"); }
    const step = Math.max(1, Math.ceil(pts.length / 40)), line = pts.filter((q, i) => i % step === 0 || i === pts.length - 1).map((q) => [+q[0].toFixed(1), +q[1].toFixed(1)]);
    const it = itemOf(l), sp = spriteNow(l), st = stateOf(l), vid = st.v && (it.variants || {})[st.v] ? st.v : "base";
    toast(tt("Recherche de la bouche dans l'orbite…"));
    try {
      const r = await post(`bank/${encodeURIComponent(it.id)}/mouth`, { variant: vid, f: sp.i, line });
      if (r.item) app.bank.set(it.id, r.item);
      if (r.frames) {
        l.lip = Object.assign({ on: true, off: 0, bg: true }, l.lip, { set: TRACE }); tracing = null; pen(false); hist.snap();
        toast(r.poses ? tt`Bouche suivie sur ${r.frames} images sur ${sp.n}, et reportée sur ${r.poses} autres poses.` : tt`Bouche suivie sur ${r.frames} images sur ${sp.n}.`);
      } else toast(tt("Rien trouvé sous le trait : trace sur la bouche dessinée, d'un coin à l'autre."), "error");
    } catch (err) { toast(tt("Tracé refusé : ") + err.message, "error"); }
    paint(); props();
  }
  // Retouche des bouches calculees (tools/levres.py) : l'image-cle la plus proche de l'image affichee. Deplacer et
  // agrandir la carte (les quatre bouches ensemble), corriger son detourage (lasso vider / remettre, gomme), la
  // deformer (Pousser, facon Fluidite). Vue : molette ou curseur pour zoomer, Espace ou clic droit + glisser pour se
  // deplacer, oeil pour cacher la bouche. Enregistre dans le personnage (POST bank/<id>/lips) : vaut pour tous les storyboards.
  let lipsCv = null;                                         // vue de l'editeur des bouches calculees, quand il est ouvert
  async function editLips(l) {
    const it = itemOf(l), sp = spriteNow(l), st = stateOf(l), vid = st.v && (it.variants || {})[st.v] ? st.v : "base";
    const mf = sp && mouthFrame(sp), L = mf && mf.lips;
    if (!L || !L.keys.length) return toast(tt("Bouches calculées pas encore chargées : réessaie dans un instant."), "error");
    const n = sp.n || 72, dist = (k) => { const d = Math.abs(k.f - sp.i); return Math.min(d, n - d); };
    const keys = L.keys.filter((k) => !k.up0).sort((a, b) => a.f - b.f);
    if (!keys.length) return toast(tt("Ces bouches viennent d'une autre pose : retouche-les sur cette pose-là."), "error");
    let ki = keys.indexOf(keys.reduce((a, b) => (dist(b) < dist(a) ? b : a))), shape = "A", tool = "move", bg = "#7fd47f", shown = true;
    const SZ = 440, cv = h("canvas", { width: SZ, height: SZ, style: { border: "1px solid #555", touchAction: "none", cursor: "move", maxWidth: "100%" } });
    lipsCv = cv;                                             // tant qu'il est ouvert, Ctrl+Z et Espace sont a lui, pas au montage
    const ctx = cv.getContext("2d"), info = h("div.muted"), shapes = h("div.row.wrap"), tools = h("div.row.wrap");
    let K, box, frame, cards, orig, goms, gdirty, undo, dirty, vz = 1, vc = [0, 0], hover = null, space = false;
    // couche travaillee : la bouche ajoutee, ou le masque du dessin (gomme : la part du dessin d'origine effacee sous la
    // bouche, lips/kFFF_X_g.webp, noire, meme place que la carte ; c'est elle qui fait le menton du resultat final)
    let layer = "bouche", full = {};                         // bouche | bmasque (masque de la bouche) | masque (masque du dessin)
    const tgt = () => (layer === "masque" ? goms[shape] : cards[shape]);
    const blank = (c) => { const g = document.createElement("canvas"); g.width = c.width; g.height = c.height; return g; };
    const load = (u) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = u; });
    const toCanvas = (im) => { const c = document.createElement("canvas"); c.width = im ? im.naturalWidth : 256; c.height = im ? im.naturalHeight : 256; if (im) c.getContext("2d").drawImage(im, 0, 0); return c; };
    const zoomIn = h("input", { type: "range", min: 0.5, max: 8, step: 0.05, value: 1, on: { input: (e) => { vz = +e.target.value; draw(); } } });
    const sizeIn = h("input", { type: "range", min: 0.4, max: 2.5, step: 0.01, value: 1, on: { pointerdown: () => snap(), input: (e) => { const cx = box.x + box.s / 2, cy = box.y + box.s / 2; box.s = K.s * +e.target.value; box.x = cx - box.s / 2; box.y = cy - box.s / 2; draw(); } } });
    async function openKey() {
      K = keys[ki]; box = { x: K.x, y: K.y, s: K.s }; cards = {}; orig = {}; goms = {}; undo = []; dirty = new Set(); gdirty = new Set();
      vz = 1; vc = [K.x + K.s / 2, K.y + K.s / 2]; zoomIn.value = 1; sizeIn.value = 1;
      frame = await load(`${sp.dir}/${String(K.f).padStart(3, "0")}.webp`);
      full = {};
      await Promise.all(Object.entries(K.cards).map(async ([k, f]) => {
        const im = await load(`${L.base}/${f}?v=${L.v}`), o = await load(`${L.base}/lips/orig/${f.split("/").pop()}?v=${L.v}`);
        cards[k] = toCanvas(im); orig[k] = o && im && o.naturalWidth === im.naturalWidth ? toCanvas(o) : toCanvas(im);
        const fc = toCanvas(null); fc.width = orig[k].width; fc.height = orig[k].height;   // masque de la bouche ouvert : tout ce que la carte d'origine porte
        const og = orig[k].getContext("2d").getImageData(0, 0, fc.width, fc.height), D = og.data;
        for (let q = 3; q < D.length; q += 4) D[q] = D[q] > 6 ? 255 : 0;
        fc.getContext("2d").putImageData(og, 0, 0); full[k] = fc;
      }));
      await Promise.all(Object.keys(cards).map(async (k) => {   // masque du dessin, a la taille de la carte (vide s'il n'y en a pas)
        const g = blank(cards[k]), f = (K.gom || {})[k], im = f && await load(`${L.base}/${f}?v=${L.v}`);
        if (im) g.getContext("2d").drawImage(im, 0, 0, g.width, g.height);
        goms[k] = g;
      }));
      if (!cards[shape]) shape = Object.keys(cards)[0];
      bar(); draw();
    }
    // vue : un carre de 2 x s (divise par le zoom) centre sur vc, en pixels de l'orbite
    const view = () => { const s0 = K.s * 2 / vz; return { x: vc[0] - s0 / 2, y: vc[1] - s0 / 2, k: SZ / s0 }; };
    const toOrbit = (e) => { const r = cv.getBoundingClientRect(), v = view(); return [v.x + (e.clientX - r.left) * (SZ / r.width) / v.k, v.y + (e.clientY - r.top) * (SZ / r.height) / v.k]; };
    const toCard = (p, c = cards[shape]) => { return [(p[0] - box.x) / box.s * c.width, (p[1] - box.y) / box.s * c.height]; };
    let lasso = null;
    function draw() {
      const v = view();
      ctx.imageSmoothingEnabled = vz < 3;                  // de pres : les pixels nets, pour bien voir le detourage
      ctx.fillStyle = bg; ctx.fillRect(0, 0, SZ, SZ);
      const bx = (box.x - v.x) * v.k, by = (box.y - v.y) * v.k, bs = box.s * v.k, gm = goms[shape];
      if (frame) {                                          // le dessin, gomme par son masque comme dans le resultat final
        const fc = document.createElement("canvas"); fc.width = fc.height = SZ;
        const fg = fc.getContext("2d"); fg.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
        fg.drawImage(frame, -v.x * v.k, -v.y * v.k, frame.naturalWidth * v.k, frame.naturalHeight * v.k);
        if (gm && (shown || layer === "masque")) { fg.globalCompositeOperation = "destination-out"; fg.drawImage(gm, bx, by, bs, bs); }
        ctx.drawImage(fc, 0, 0);
      }
      const c = cards[shape];
      if (c && shown) ctx.drawImage(c, bx, by, bs, bs);
      if (c && layer === "bmasque") {                       // masque de la bouche : ce qui se voit en bleu, ce qu'on peut remettre en pointille bleu pale
        const mc = document.createElement("canvas"); mc.width = mc.height = SZ;
        const mg = mc.getContext("2d");
        if (full[shape]) { mg.globalAlpha = 0.16; mg.drawImage(full[shape], bx, by, bs, bs); mg.globalAlpha = 1; }
        mg.drawImage(c, bx, by, bs, bs); mg.globalCompositeOperation = "source-in"; mg.fillStyle = "rgba(60,140,255,.42)"; mg.fillRect(0, 0, SZ, SZ);
        ctx.drawImage(mc, 0, 0);
      }
      if (gm && layer === "masque") {                       // le masque en rouge transparent, par-dessus
        const mc = document.createElement("canvas"); mc.width = mc.height = SZ;
        const mg = mc.getContext("2d"); mg.drawImage(gm, bx, by, bs, bs); mg.globalCompositeOperation = "source-in"; mg.fillStyle = "rgba(255,40,80,.45)"; mg.fillRect(0, 0, SZ, SZ);
        ctx.drawImage(mc, 0, 0);
      }
      ctx.strokeStyle = "rgba(95,196,168,.9)"; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
      ctx.strokeRect((box.x - v.x) * v.k, (box.y - v.y) * v.k, box.s * v.k, box.s * v.k); ctx.setLineDash([]);
      if (lasso && lasso.length > 1) { ctx.strokeStyle = "#ff3b8d"; ctx.lineWidth = 1.5; ctx.beginPath(); lasso.forEach((p, i) => { const q = [(p[0] - v.x) * v.k, (p[1] - v.y) * v.k]; if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.stroke(); }
      if (hover && (tool === "gomme" || tool === "pousser" || tool === "crayon")) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc((hover[0] - v.x) * v.k, (hover[1] - v.y) * v.k, rad * v.k, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = "#000"; ctx.beginPath(); ctx.arc((hover[0] - v.x) * v.k, (hover[1] - v.y) * v.k, rad * v.k + 1, 0, Math.PI * 2); ctx.stroke(); }
      info.textContent = tt`Image-clé ${ki + 1} sur ${keys.length} (image ${K.f} de l'orbite) · taille ${Math.round(box.s)} px`;
    }
    const snap = () => { const c = tgt(); undo.push({ c, shape, data: c.getContext("2d").getImageData(0, 0, c.width, c.height), box: { ...box } }); if (undo.length > 30) undo.shift(); };
    const touch = () => (layer === "masque" ? gdirty : dirty).add(shape);
    function applyLasso(pts, mode) {
      const c = tgt(), g = c.getContext("2d"), q = pts.map((p) => toCard(p, c));
      snap(); g.save(); g.beginPath(); q.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.clip();
      g.clearRect(0, 0, c.width, c.height);
      if (layer === "masque") { if (mode === "vider") { g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height); } }   // vider : le dessin s'efface la ; remettre : il revient
      else if (mode === "remettre") g.drawImage(layer === "bmasque" ? full[shape] : orig[shape], 0, 0);   // la bouche d'origine (bmasque : sans son fondu)
      g.restore(); touch();
    }
    function brush(p, r) {                                   // gomme : efface la bouche, ou (masque) efface le dessin
      const c = tgt(), g = c.getContext("2d"), q = toCard(p, c), rr = r / box.s * c.width;
      g.save(); if (layer === "masque") g.fillStyle = "#000"; else g.globalCompositeOperation = "destination-out";
      g.beginPath(); g.arc(q[0], q[1], rr, 0, Math.PI * 2); g.fill(); g.restore(); touch();
    }
    // Crayon : trait rond de la couleur choisie, sur la bouche choisie (Alt + clic : prendre une couleur dans la vue)
    function pencil(a, b) {                                  // sur le masque : pinceau qui remet le dessin
      const c = tgt(), g = c.getContext("2d"), p0 = toCard(a, c), p1 = toCard(b, c);
      if (layer === "bmasque") {                               // masque de la bouche : le pinceau fait revenir la bouche d'origine
        const t = document.createElement("canvas"); t.width = c.width; t.height = c.height; const tg = t.getContext("2d");
        tg.lineWidth = rad / box.s * c.width * 2; tg.lineCap = tg.lineJoin = "round"; tg.beginPath(); tg.moveTo(p0[0], p0[1]); tg.lineTo(p1[0] + 0.01, p1[1]); tg.stroke();
        tg.globalCompositeOperation = "source-in"; tg.drawImage(full[shape], 0, 0);
        g.drawImage(t, 0, 0); touch(); return;
      }
      g.save(); g.strokeStyle = g.fillStyle = ink; if (layer === "masque") { g.globalCompositeOperation = "destination-out"; g.strokeStyle = "#000"; } g.lineWidth = rad / box.s * c.width * 2; g.lineCap = g.lineJoin = "round";
      g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0] + 0.01, p1[1]); g.stroke(); g.restore(); touch();
    }
    function pick(e) {
      const r = cv.getBoundingClientRect(), x = Math.round((e.clientX - r.left) * SZ / r.width), y = Math.round((e.clientY - r.top) * SZ / r.height);
      hover = null; draw(); const d = ctx.getImageData(x, y, 1, 1).data;
      ink = "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join(""); inkIn.value = ink; draw();
    }
    // Pousser (facon Fluidite) : les pixels sous le pinceau suivent la souris, fort au centre, nul au bord. Le pinceau
    // deplace un champ de deformation (ws.DX, ws.DY : ou chaque pixel va chercher sa couleur dans l'image du debut du coup
    // de pinceau) ; l'image est recalculee depuis cet original, une seule fois, en bicubique : le trait reste net, il ne
    // se brouille plus a chaque petit pas.
    const pushWs = new Map();                                 // par carte : l'original et le champ de « Pousser »
    const cubic = (a, b, c, d, t) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
    function push(a, b) {
      const c = cards[shape], g = c.getContext("2d"), W0 = c.width, H0 = c.height;
      if (!drag.ws || drag.ws.c !== c) {                      // debut du coup : on reprend le champ des coups precedents si
        const cur = g.getImageData(0, 0, W0, H0).data;         // rien d'autre n'a touche la bouche depuis (un seul recalcul en tout)
        let ws = pushWs.get(c);
        if (!ws || !ws.last || ws.last.length !== cur.length || ws.last.some((v, q) => v !== cur[q])) ws = { c, src: g.getImageData(0, 0, W0, H0), DX: new Float32Array(W0 * H0), DY: new Float32Array(W0 * H0) };
        pushWs.set(c, ws); drag.ws = ws;
      }
      const { src, DX, DY } = drag.ws, S = src.data;
      const p0 = toCard(a), p1 = toCard(b), R = rad / box.s * W0, steps = Math.max(1, Math.ceil(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / (R / 4)));
      let X0 = W0, Y0 = H0, X1 = 0, Y1 = 0;
      const field = (A, x, y) => {                            // le champ, lu entre ses points (il est lisse : pas de flou)
        x = Math.min(W0 - 1.001, Math.max(0, x)); y = Math.min(H0 - 1.001, Math.max(0, y));
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, k = iy * W0 + ix;
        return (A[k] * (1 - fx) + A[k + 1] * fx) * (1 - fy) + (A[k + W0] * (1 - fx) + A[k + W0 + 1] * fx) * fy;
      };
      for (let st = 1; st <= steps; st++) {
        const qa = [p0[0] + (p1[0] - p0[0]) * (st - 1) / steps, p0[1] + (p1[1] - p0[1]) * (st - 1) / steps], dx = (p1[0] - p0[0]) / steps * force, dy = (p1[1] - p0[1]) / steps * force;
        const x0 = Math.max(0, Math.floor(qa[0] - R - 2)), y0 = Math.max(0, Math.floor(qa[1] - R - 2)), x1 = Math.min(W0, Math.ceil(qa[0] + R + 2)), y1 = Math.min(H0, Math.ceil(qa[1] + R + 2));
        if (x1 <= x0 || y1 <= y0) continue;
        const rw = x1 - x0, nx = new Float32Array(rw * (y1 - y0)), ny = new Float32Array(rw * (y1 - y0));
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const k = (y - y0) * rw + (x - x0), dd = Math.hypot(x + 0.5 - qa[0] - dx, y + 0.5 - qa[1] - dy) / R;
          if (dd >= 1) { nx[k] = DX[y * W0 + x]; ny[k] = DY[y * W0 + x]; continue; }
          const w = (1 - dd * dd) * (1 - dd * dd), px = x - dx * w, py = y - dy * w;   // ce pixel prend ce qu'il y avait en (px, py)
          nx[k] = px - x + field(DX, px, py); ny[k] = py - y + field(DY, px, py);
        }
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const k = (y - y0) * rw + (x - x0); DX[y * W0 + x] = nx[k]; DY[y * W0 + x] = ny[k]; }
        X0 = Math.min(X0, x0); Y0 = Math.min(Y0, y0); X1 = Math.max(X1, x1); Y1 = Math.max(Y1, y1);
      }
      if (X1 <= X0 || Y1 <= Y0) return;
      // l'image, recalculee depuis l'original du coup de pinceau (bicubique, couleurs premultipliees : pas de liseré sombre)
      const out = g.createImageData(X1 - X0, Y1 - Y0), O = out.data, px = (xi, yi, ch) => {
        xi = xi < 0 ? 0 : xi >= W0 ? W0 - 1 : xi; yi = yi < 0 ? 0 : yi >= H0 ? H0 - 1 : yi;
        const q = (yi * W0 + xi) * 4;
        return ch === 3 ? S[q + 3] : S[q + ch] * S[q + 3] / 255;
      };
      for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
        const sx = x + DX[y * W0 + x], sy = y + DY[y * W0 + x], ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy, o = ((y - Y0) * (X1 - X0) + (x - X0)) * 4;
        const v = [0, 0, 0, 0];
        for (let ch = 0; ch < 4; ch++) {
          const r = [];
          for (let m = -1; m <= 2; m++) r.push(cubic(px(ix - 1, iy + m, ch), px(ix, iy + m, ch), px(ix + 1, iy + m, ch), px(ix + 2, iy + m, ch), fx));
          v[ch] = cubic(r[0], r[1], r[2], r[3], fy);
        }
        const al = Math.max(0, Math.min(255, v[3]));
        O[o + 3] = al;
        for (let ch = 0; ch < 3; ch++) O[o + ch] = al > 0.5 ? Math.max(0, Math.min(255, v[ch] * 255 / al)) : 0;
      }
      g.putImageData(out, X0, Y0);
      dirty.add(shape);
    }
    let drag = null, rad = 4, force = 0.7, ink = "#3a1a14";
    const inkIn = h("input", { type: "color", value: ink, title: tt("Couleur du crayon (Alt + clic dans la vue : prendre une couleur)"), on: { input: (e) => { ink = e.target.value; } } });
    // taille du pinceau (crayon, gomme, pousser), dans la barre d'outils ; touches [ et ] aussi
    const radVal = h("span.muted", { style: { minWidth: "3.2em", display: "inline-block" } }, rad.toFixed(1));
    const radIn = h("input", { type: "range", min: 0.3, max: 30, step: 0.1, value: rad, style: { width: "110px" }, title: tt("Taille du pinceau : crayon, gomme et « Pousser » (touches [ et ])"), on: { input: (e) => { setRad(+e.target.value); } } });
    const setRad = (r) => { rad = Math.max(0.3, Math.min(30, Math.round(r * 10) / 10)); radIn.value = rad; radVal.textContent = rad.toFixed(1); draw(); };
    // « Regenerer la bouche » : la forme choisie de cette image-cle, redessinee par fal (tools/levres.py), en tete de file
    let regen = null;                                        // { shape, f, job } pendant le calcul
    async function refetch(f) {                              // la cle f relue dans lips.json (nouvelle bouche, autre version)
      try {
        const nd = await (await fetch(`${L.base}/lips.json?t=${Date.now()}`)).json();
        const nk = nd.keys.find((k) => k.f === f), ok = keys.find((k) => k.f === f);
        if (nk && ok) { for (const q of Object.keys(ok)) delete ok[q]; Object.assign(ok, nk); }
        L.v = String(Date.now());
      } catch (e) { /* la vue garde l'ancienne bouche */ }
    }
    // appui long (ou clic droit) sur une lettre : les versions de cette bouche, quand elle a ete regeneree
    const versOf = (k) => ((K && K.vers) || {})[k] || [];
    function versMenu(btn, k) {
      const vs = versOf(k);
      if (vs.length < 2) return;
      document.querySelector(".lips-vers")?.remove();
      const cur = ((K.cur || {})[k]) ?? vs.length - 1, name = k === "E" ? "É" : k;
      const box = h("div.menu.mt-menu.lips-vers", h("div.mhead", tt`Versions de la bouche « ${name} »`),
        ...vs.map((f, i) => h("button" + (i === cur ? ".on" : ""), { on: { click: async () => {
          box.remove();
          if (i === cur) return;
          if (dirty.has(k) && !confirm(tt("Les retouches non enregistrées de cette bouche seront perdues. Continuer ?"))) return;
          try {
            const r = await post(`bank/${encodeURIComponent(it.id)}/lips-version`, { variant: vid, f: K.f, shape: k, i });
            if (r.item) app.bank.set(it.id, r.item);
            await refetch(K.f); shape = k; await openKey(); paint(); props();
          } catch (err) { toast(err.message, "error"); }
        } } }, h("img", { src: `${L.base}/${f}?v=${L.v}`, style: { width: "44px", height: "44px", objectFit: "contain", background: bg, borderRadius: "4px", verticalAlign: "middle", marginRight: "8px" } }),
          (i === cur ? "✓ " : "") + tt`Version ${i + 1}` + (i === 0 ? tt(" (d'origine)") : i === vs.length - 1 ? tt(" (la plus récente)") : ""))));
      document.body.append(box);
      const r = btn.getBoundingClientRect(), b = box.getBoundingClientRect();
      box.style.left = Math.max(4, Math.min(r.left, innerWidth - b.width - 6)) + "px";
      box.style.top = Math.max(4, Math.min(r.bottom + 4, innerHeight - b.height - 6)) + "px";
      const close = (ev) => { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener("pointerdown", close, true); } };
      setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
    }
    function shapeBtn(k) {
      const many = versOf(k).length > 1;
      let timer = 0, long = false;
      const b = h("button.mini" + (k === shape ? ".on" : ""), { title: (MOUTHS[k] || k) + (many ? tt(" · rester appuyé : choisir une autre version") : ""), on: {
        pointerdown: () => { long = false; if (many) timer = setTimeout(() => { long = true; versMenu(b, k); }, 420); },
        pointerup: () => clearTimeout(timer), pointerleave: () => clearTimeout(timer),
        contextmenu: (e) => { e.preventDefault(); versMenu(b, k); },
        click: () => { if (long) return; shape = k; bar(); draw(); } } }, (k === "E" ? "É" : k) + (many ? " ▾" : ""));
      return b;
    }
    async function regenerate() {
      if (regen) return;
      const sh = shape, name = sh === "E" ? "É" : sh;
      if (!confirm(tt`Régénérer la bouche « ${name} » de cette image-clé ?

Payant : 1 image GPT Image 2.5 sur fal, environ 0,02 $. La tâche passe en tête de la file.`)) return;
      if (touched() && !confirm(tt("Les retouches non enregistrées de cette image-clé seront perdues quand la nouvelle bouche arrivera. Continuer ?"))) return;
      try {
        const r = await post(`bank/${encodeURIComponent(it.id)}/lips-regen`, { variant: vid, f: K.f, shape: sh });
        regen = { shape: sh, f: K.f, job: r.job }; bar(); app.pollSoon();
        toast(tt`Bouche « ${name} » en régénération, en tête de la file.`);
      } catch (err) { toast(tt("Bouche non régénérée : ") + err.message, "error"); return; }
      const wait = async () => {
        if (!cv.isConnected) return;
        const j = (app.jobs || []).find((x) => x.id === regen.job);
        if (!j || j.status === "queued" || j.status === "running") { if (!j || !app.jobs.some((x) => x.status === "queued" || x.status === "running")) app.pollSoon(); setTimeout(wait, 2500); return; }
        const done = regen; regen = null;
        if (j.status !== "done") { bar(); return toast(tt("Bouche non régénérée : ") + (j.error || j.status), "error"); }
        await refetch(done.f);
        if (K.f === done.f) { shape = done.shape; await openKey(); } else bar();
        paint(); props();
        toast(tt`Nouvelle bouche « ${done.shape === "E" ? "É" : done.shape} » arrivée.`);
      };
      setTimeout(wait, 2500);
    }
    const doUndo = () => { const u = undo.pop(); if (!u) return toast(tt("Rien à annuler")); u.c.getContext("2d").putImageData(u.data, 0, 0); box = u.box; sizeIn.value = box.s / K.s; draw(); };
    const panning = (e) => space || e.button === 1 || e.button === 2;
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    cv.addEventListener("pointerdown", (e) => {
      cv.setPointerCapture(e.pointerId); const p = toOrbit(e);
      if (panning(e)) { drag = { pan: true, x: e.clientX, y: e.clientY, c: [...vc] }; return; }
      if (tool === "move") { snap(); drag = { p, x: box.x, y: box.y }; }
      else if (tool === "gomme") { snap(); drag = { p }; brush(p, rad); draw(); }
      else if (tool === "pousser") { if (layer !== "bouche") return; snap(); drag = { p, last: p }; }
      else if (tool === "crayon") { if (e.altKey && layer === "bouche") { pick(e); return; } snap(); drag = { p, last: p }; pencil(p, p); draw(); }
      else { lasso = [p]; drag = { p }; }
    });
    cv.addEventListener("pointermove", (e) => {
      const p = toOrbit(e); hover = p;
      if (!drag) { if (tool === "gomme" || tool === "pousser" || tool === "crayon") draw(); return; }
      if (drag.pan) { const r = cv.getBoundingClientRect(), v = view(); vc = [drag.c[0] - (e.clientX - drag.x) * (SZ / r.width) / v.k, drag.c[1] - (e.clientY - drag.y) * (SZ / r.height) / v.k]; }
      else if (tool === "move") { box.x = drag.x + p[0] - drag.p[0]; box.y = drag.y + p[1] - drag.p[1]; }
      else if (tool === "gomme") brush(p, rad);
      else if (tool === "pousser") { push(drag.last, p); drag.last = p; }
      else if (tool === "crayon") { pencil(drag.last, p); drag.last = p; }
      else lasso.push(p);
      draw();
    });
    cv.addEventListener("pointerleave", () => { hover = null; if (!drag) draw(); });
    cv.addEventListener("pointerup", () => {
      if (!drag) return;
      if (drag.ws) { const c = drag.ws.c; drag.ws.last = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; }   // pour reconnaitre la carte au coup suivant
      drag = null;
      if (lasso) { if (lasso.length > 2) applyLasso(lasso, tool); lasso = null; }
      draw();
    });
    // molette : zoom de la vue, vers le pointeur
    cv.addEventListener("wheel", (e) => {
      e.preventDefault(); const p = toOrbit(e), z = Math.max(0.5, Math.min(8, vz * (e.deltaY < 0 ? 1.15 : 1 / 1.15))), f = vz / z;
      vc = [p[0] + (vc[0] - p[0]) * f, p[1] + (vc[1] - p[1]) * f]; vz = z; zoomIn.value = z; draw();
    }, { passive: false });
    const keyFn = (e) => {
      if (!cv.isConnected) { window.removeEventListener("keydown", keyFn); window.removeEventListener("keyup", keyFn); return; }
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement && e.target.type === "text")) { space = e.type === "keydown"; cv.style.cursor = space ? "grab" : curOf(tool); e.preventDefault(); }
      if (e.type !== "keydown" || /^(TEXTAREA)$/.test(e.target.tagName) || (e.target instanceof HTMLInputElement && e.target.type === "text")) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); e.stopPropagation(); doUndo(); }   // Ctrl+Z / Cmd+Z
      else if (e.key === "[" || e.key === "]") { e.preventDefault(); setRad(rad * (e.key === "]" ? 1.25 : 0.8)); }
    };
    window.addEventListener("keydown", keyFn); window.addEventListener("keyup", keyFn);
    const curOf = (k) => (k === "move" ? "move" : k === "gomme" || k === "pousser" || k === "crayon" ? "none" : "crosshair");
    function bar() {
      shapes.textContent = "";
      shapes.append(h("span.muted", tt("Bouche : ")), ...Object.keys(cards).sort((a, b) => "AOED".indexOf(a) - "AOED".indexOf(b)).map(shapeBtn),
        h("button.mini", { title: tt("Image-clé précédente"), on: { click: () => change(-1) } }, "◀"), h("button.mini", { title: tt("Image-clé suivante"), on: { click: () => change(1) } }, "▶"),
        h("button.mini" + (shown ? ".on" : ""), { title: tt("Montre ou cache la bouche ajoutée, pour comparer avec le dessin et voir les défauts de détourage"), on: { click: () => { shown = !shown; bar(); draw(); } } }, shown ? tt("👁 Bouche visible") : tt("👁 Bouche cachée")));
      tools.textContent = "";
      const M = layer === "masque", BM = layer === "bmasque";
      tools.append(h("span.muted", tt("Couche : ")),
        h("button.mini" + (layer === "bouche" ? ".on" : ""), { title: tt("Retouche la bouche ajoutée"), on: { click: () => { layer = "bouche"; bar(); draw(); } } }, tt("Bouche")),
        h("button.mini" + (BM ? ".on" : ""), { title: tt("Masque de la bouche : ce qui se voit de la bouche ajoutée, en bleu ; en bleu pâle, ce que la bouche d'origine porte et qu'on peut faire revenir. Gomme et lasso « vider » cachent ; pinceau et lasso « remettre » font revenir la bouche d'origine, sans fondu."), on: { click: () => { layer = "bmasque"; if (tool === "pousser") tool = "crayon"; cv.style.cursor = curOf(tool); bar(); draw(); } } }, tt("Masque de la bouche ⓘ")),
        h("button.mini" + (M ? ".on" : ""), { title: tt("Masque du dessin : la part du dessin d'origine effacée sous la bouche (menton, joue), en rouge. Gomme et lasso « effacer » effacent le dessin ; pinceau et lasso « remettre » le font revenir. Il suit la place et la taille de la bouche."), on: { click: () => { layer = "masque"; if (tool === "pousser") tool = "gomme"; cv.style.cursor = curOf(tool); bar(); draw(); } } }, tt("Masque du dessin ⓘ")),
        h("span", { style: { flexBasis: "100%", height: 0 } }));
      const tb = (k, label, title) => h("button.mini" + (tool === k ? ".on" : ""), { title, on: { click: () => { tool = k; cv.style.cursor = curOf(k); bar(); } } }, label);
      tools.append(tb("move", tt("✥ Déplacer"), tt("Glisser : déplace la bouche (les quatre bouches de cette image-clé ensemble). Sa taille : le curseur « Taille de la bouche ».")),
        M || BM ? "" : tb("pousser", tt("👆 Pousser"), tt("Comme l'outil Fluidité : les pixels sous le pinceau suivent la souris. Pour ajuster la forme de la bouche au visage, par petites touches.")),
        M ? tb("vider", tt("✂ Lasso : effacer le dessin"), tt("Entoure une part du dessin d'origine : elle disparaît sous la bouche choisie.")) : tb("vider", tt("✂ Lasso : vider"), tt("Entoure à la souris ce qui dépasse de la bouche : cela devient transparent, sur la bouche choisie.")),
        M ? tb("remettre", tt("🩹 Lasso : remettre le dessin"), tt("Entoure une part du dessin effacée à tort : elle revient.")) : tb("remettre", tt("🩹 Lasso : remettre"), tt("Entoure une zone vidée à tort : la bouche d'origine y revient.")),
        M ? tb("gomme", tt("◌ Gommer le dessin"), tt("Efface au pinceau le dessin d'origine sous la bouche choisie")) : tb("gomme", tt("◌ Gomme"), tt("Efface au pinceau, sur la bouche choisie")),
        M ? tb("crayon", tt("🖌 Remettre le dessin"), tt("Au pinceau : le dessin d'origine revient là où il était effacé.")) : BM ? tb("crayon", tt("🖌 Remettre la bouche"), tt("Au pinceau : la bouche d'origine revient, pleinement opaque, là où elle avait quelque chose.")) : tb("crayon", tt("✏ Crayon"), tt("Dessine sur la bouche choisie, à la taille du pinceau et dans la couleur choisie. Alt + clic : prendre une couleur dans la vue.")), M || BM ? "" : inkIn,
        h("label.row", { style: { gap: "4px", margin: 0 }, title: tt("Taille du pinceau : crayon, gomme et « Pousser » (touches [ et ])") }, h("span.muted", tt("Taille")), radIn, radVal),
        h("button.mini", { title: tt("Annule la dernière retouche (Ctrl+Z)"), on: { click: doUndo } }, tt("↶ Annuler (Ctrl+Z)")),
        h("button.mini", { disabled: !!regen, title: tt("Redessine la bouche choisie de cette image-clé (GPT Image 2.5 sur fal, environ 0,02 $) ; la tâche passe en tête de la file"), on: { click: regenerate } },
          regen ? tt`⏳ Bouche « ${regen.shape === "E" ? "É" : regen.shape} » en calcul…` : tt`🔄 Régénérer la bouche « ${shape === "E" ? "É" : shape} »`),
        h("select", { title: tt("Fond de la vue, pour bien voir le détourage"), on: { change: (e) => { bg = e.target.value; draw(); } } }, [["#7fd47f", tt("Fond vert")], ["#ff6fd0", tt("Fond rose")], ["#222222", tt("Fond noir")], ["#ffffff", tt("Fond blanc")]].map(([c, nm]) => h("option", { value: c, selected: bg === c }, nm))));
    }
    const touched = () => dirty.size || gdirty.size || box.x !== K.x || box.y !== K.y || box.s !== K.s;
    async function change(d) {
      if (touched() && !confirm(tt("Quitter cette image-clé sans enregistrer ses retouches ?"))) return;
      ki = (ki + d + keys.length) % keys.length; await openKey();
    }
    const send = async (body) => {
      const r = await post(`bank/${encodeURIComponent(it.id)}/lips`, Object.assign({ variant: vid, f: K.f }, body));
      if (r.item) app.bank.set(it.id, r.item);
      paint(); props();
    };
    const range = (label, inp, title) => h("label.row.range", title ? { title } : {}, label, inp);
    modal(tt("Retoucher les bouches calculées"), h("div.form",
      h("p.muted", tt("Chaque image-clé porte quatre bouches (A, O, É, D) dessinées pour ce personnage. Corrige leur place, leur taille, leur forme ou leur détourage ; « Enregistrer » les garde dans le personnage, pour tous les storyboards.")),
      shapes, tools, cv, info,
      range(tt("Zoom ⓘ"), zoomIn, tt("Agrandit la vue (ou molette). Pour se déplacer dans la vue : Espace tenue + glisser, ou clic droit + glisser.")),
      range(tt("Taille de la bouche"), sizeIn),
      range(tt("Force de « Pousser »"), h("input", { type: "range", min: 0.1, max: 1, step: 0.05, value: force, on: { input: (e) => { force = +e.target.value; } } }))), [
      { label: tt("Revenir à l'original"), click: async () => { if (!confirm(tt("Remettre les bouches d'origine de cette image-clé (place, taille et détourage) ?"))) return false; try { await send({ original: true }); toast(tt("Bouches d'origine remises.")); } catch (err) { toast(err.message, "error"); return false; } } },
      { label: tt("Annuler") },
      { label: tt("Enregistrer dans le personnage"), primary: true, click: async () => {
        if (!touched()) return;
        const c = {}, g = {}; for (const k of dirty) c[k] = cards[k].toDataURL("image/png");
        for (const k of gdirty) g[k] = goms[k].toDataURL("image/png");
        try { await send({ x: box.x, y: box.y, s: box.s, cards: c, goms: g }); toast(tt("Bouches retouchées, enregistrées dans le personnage.")); } catch (err) { toast(tt("Retouche non enregistrée : ") + err.message, "error"); return false; }
      } }]);
    await openKey();
  }
  async function traceClear(l) {
    const it = itemOf(l), st = stateOf(l), vid = st.v && (it.variants || {})[st.v] ? st.v : "base";
    try {
      const r = await del(`bank/${encodeURIComponent(it.id)}/mouth?variant=${encodeURIComponent(vid)}`);
      if (r.item) app.bank.set(it.id, r.item);
      if (l.lip && l.lip.set === TRACE) delete l.lip.set;
      hist.snap(); paint(); props();
      toast(tt("Tracé de la bouche effacé."));
    } catch (err) { toast(tt("Tracé non effacé : ") + err.message, "error"); }
  }
  async function micro(l, btn) {                           // enregistrement direct au micro
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }), parts = [];
      rec = new MediaRecorder(stream);
      rec.ondataavailable = (ev) => { if (ev.data.size) parts.push(ev.data); };
      rec.onstop = () => { stream.getTracks().forEach((x) => x.stop()); const type = rec.mimeType || "audio/webm"; rec = null; if (btn.isConnected) { btn.textContent = tt("● Micro"); btn.classList.remove("danger"); }
        if (parts.length) setVoice(l, new Blob(parts, { type }), "micro" + (type.includes("ogg") ? ".ogg" : type.includes("mp4") ? ".mp4" : ".webm")); };
      rec.start();
      btn.textContent = tt("■ Arrêter l'enregistrement"); btn.classList.add("danger");
    } catch (e) { rec = null; toast(tt("Micro indisponible : ") + e.message, "error"); }
  }
  function voiceBox(l) {
    const lip = l.lip || {}, put = (k, x) => { l.lip = Object.assign({ on: true, off: 0, bg: true }, l.lip, { [k]: x }); paint(); };
    const plain = (label, k, min, max, step, def, fmt = (x) => (+x).toFixed(3)) => { const out = h("output", fmt(lip[k] ?? def));
      return h("label.row.range", label, h("input", { type: "range", min, max, step, value: lip[k] ?? def, on: { input: (e) => { put(k, +e.target.value); out.textContent = fmt(+e.target.value); } } }), out); };
    const file = h("input", { type: "file", accept: "audio/*,video/mp4,.webm", style: { display: "none" }, on: { change: (e) => { const f = e.target.files[0]; if (f) setVoice(l, f, f.name); e.target.value = ""; } } });
    const micBtn = h("button.mini", { title: tt("Enregistre ta voix au micro ; clique encore pour arrêter"), on: { click: () => micro(l, micBtn) } }, rec ? tt("■ Arrêter l'enregistrement") : tt("● Micro"));
    const vrows = [h("div.row.wrap", h("button.mini", { title: tt("Fichier son : wav, mp3, m4a, ogg, webm"), on: { click: () => file.click() } }, lip.src ? tt("Changer la voix…") : tt("Importer une voix…")), micBtn, file,
      lip.src ? h("button.mini.danger", { title: tt("Retire la voix et ses bouches (la place de la bouche est gardée)"), on: { click: () => { const a = players.get(l.id); if (a) a.pause(); players.delete(l.id); delete l.lip.src; delete l.lip.cues; delete l.lip.name; delete l.lip.dur; delete l.lip.in; delete l.lip.out; delete l.lip.segs; paint(); lanes(); props(); } } }, tt("Retirer")) : "")];
    vrows.push(libBox(l), ttsBox(l));
    if (lip.src) {
      const [va, vb] = voiceSpan(lip), sg = segsOf(lip), kept = sg.reduce((n, s) => n + s.b - s.a, 0);
      vrows.push(h("div.muted", { title: lip.name || "" }, `🔊 ${(lip.name || "voix").slice(0, 22)} · ${kept.toFixed(1)} s` + (kept < (lip.dur || 0) - 0.01 ? tt` sur ${(lip.dur || 0).toFixed(1)}` : "") + (lip.segs ? tt` · ${sg.length} morceaux` : "")),
        h("div.row.wrap",
          h("button.mini", { title: tt("Retire le silence avant le premier son et après le dernier"), on: { click: () => { trimBlanks(l); } } }, tt("✂ Couper les blancs")),
          lip.segs ? h("button.mini", { title: tt("Remet la voix d'un seul tenant, à sa place d'origine"), on: { click: () => { delete l.lip.segs; hist.snap(); paint(); lanes(); props(); } } }, tt("Recoller les morceaux")) : "",
          lip.segs ? "" : h("button.mini", { title: tt("Coupe la voix à la tête de lecture : ce qui vient après n'est plus joué"), on: { click: () => { const v = voiceTime(lip, t); if (v < 0) return toast(tt("Place la tête de lecture dans la voix.")); put("out", f3(v)); lanes(); props(); } } }, tt("✂ Couper ici")),
          !lip.segs && vb - va < (lip.dur || 0) - 0.01 ? h("button.mini", { title: tt("Retrouve la voix entière"), on: { click: () => { delete l.lip.in; delete l.lip.out; paint(); lanes(); props(); } } }, tt("Entière")) : ""),
        h("div", { title: tt("Décale la voix (et la bouche qui la suit) dans le plan") }, plain(tt("Décalage (s)"), "off", 0, Math.max(1, anim.dur), 0.01, 0, (x) => (+x).toFixed(2))));
    }
    // --- bouche : ce qui la fait parler. Bouches generees (dessinees dans le style du personnage, ou ses propres
    // cartes) d'office quand elles existent ; un interrupteur passe aux formes simples (trait et capsule, cartoon...).
    const rows = [h("label.row.check", { title: tt("La bouche du personnage bouge sur la voix") }, h("input", { type: "checkbox", checked: !!lip.on, on: { change: async (e) => { put("on", e.target.checked); await persoFirst(l); paint(); props(); } } }), tt("Bouche qui parle"))];
    const sp0 = spriteNow(l), trace = usesTrace(lip, sp0), it0 = itemOf(l) || {};
    const genLips = !!(sp0 && sp0.lips), gen = genLips || hasPerso(it0), graphic = !!lip.set && lip.set !== TRACE && lip.set !== PERSO;
    if (lip.on && gen) {
      const pick = async (g) => {
        if (g === graphic) return;
        const was = (l.lip || {}).set === PERSO, to = g ? (lip.gset || "capsule") : (genLips ? TRACE : PERSO);
        put("set", to);
        if (was !== (to === PERSO)) await autoMouth(l, true);
        hist.snap(); paint(); props();
      };
      rows.push(h("div.seg", { title: tt("Bouches calculées : générées pour ce personnage, dans son dessin. Bouches dessinées : des formes toutes faites (trait et capsule, cartoon, pâte à modeler…) posées sur le visage.") },
        h("button" + (graphic ? "" : ".on"), { on: { click: () => pick(false) } }, tt("Bouches calculées")),
        h("button" + (graphic ? ".on" : ""), { on: { click: () => pick(true) } }, tt("Bouches dessinées"))));
      if (!graphic) rows.push(h("div.muted", genLips ? tt("Générées dans le style du personnage ; elles suivent la bouche tracée.") : tt("Les bouches du personnage lui-même (générées).")),
        genLips ? h("button.mini", { title: tt("Retoucher la place, la taille ou le détourage des bouches calculées de l'image-clé la plus proche ; enregistré dans le personnage."), on: { click: () => editLips(l) } }, tt("✎ Éditer les bouches")) : "");
    }
    if (lip.on && sp0 && sp0.orbit && !it0.body && !(gen && graphic)) {   // bouche du dessin : la tracer sur le personnage
      const on = tracing === l.id;
      rows.push(h("div.row.wrap",
        h("button.mini" + (on ? ".on" : ""), { title: tt("Trace un trait sur la bouche du personnage, d'un coin à l'autre, sur l'image affichée : elle est retrouvée puis suivie quand il tourne. Vaut pour cet élément et cette pose, dans tous les calques qui l'utilisent."), on: { click: () => { tracing = on ? null : l.id; placing = null; svg.style.cursor = ""; pen(tracing); props(); } } }, on ? tt("Trace sur la bouche…") : tt("✎ Tracer la bouche")),
        h("select", { title: tt("Crayon : tracé libre. Droite : cliquer-glisser d'un coin de la bouche à l'autre."), on: { change: (e) => { traceMode = e.target.value; localStorage.setItem("bw.traceMode", traceMode); } } },
          [["crayon", tt("Crayon")], ["droite", tt("Droite")]].map(([k, n]) => h("option", { value: k, selected: traceMode === k }, n))),
        sp0.mouth ? h("button.mini.danger", { title: tt("Retire la bouche suivie de cette pose (pour tous les calques qui l'utilisent)"), on: { click: () => traceClear(l) } }, tt("Effacer le tracé")) : ""));
    }
    const calc = gen && !graphic;                          // bouches calculees : ni ouverture ni trait a regler
    if (lip.on && trace) {                                 // bouche du dessin : pas de place, d'axe ni de masque a regler
      rows.push(
        h("label.row", { title: tt("Simple : fermée sur les silences ; dès que ça parle, elle alterne ouverte et fermée. Varié : pareil, mais la bouche ouverte change selon le son. Détaillé : les neuf bouches, sans battement.") }, tt("Lip sync"),
          h("select", { on: { change: (e) => { put("mode", e.target.value); lanes(); props(); } } }, Object.entries(MODES).map(([k, n]) => h("option", { value: k, selected: (lip.mode || "simple") === k }, n)))),
        lip.mode !== "detail" ? h("div", { title: tt("Nombre de battements de bouche par seconde pendant que ça parle") }, plain(tt("Rythme ⓘ"), "flap", 1.5, 6, 0.5, 4, (x) => (+x).toFixed(1) + " /s")) : "",
        calc ? "" : h("div", { title: tt("Bouche en trait : de combien la lèvre du bas descend (↕) et la largeur de la bouche ouverte (↔). Une bouche déjà ouverte dans le dessin garde sa forme.") }, plain(tt("Ouverture ↔ ⓘ"), "ow", 0.3, 1.3, 0.01, 1, (x) => (+x).toFixed(2)), plain(tt("Ouverture ↕"), "oh", 0.2, 5, 0.01, 1, (x) => (+x).toFixed(2))));
    }
    if (lip.on) {
      const opts = gen ? Object.entries(SETS) : [...(sp0 && sp0.mouth || lip.set === TRACE ? [[TRACE, TRACE_NAME]] : []), ...Object.entries(SETS)];
      rows.push(!gen || graphic ? h("label.row", { title: tt("Le dessin des bouches") }, tt("Jeu de bouches"), h("select", { on: { change: (e) => { put("set", e.target.value); if (SETS[e.target.value]) l.lip.gset = e.target.value; props(); } } }, opts.map(([k, n]) => h("option", { value: k, selected: (lip.set || (trace ? TRACE : "capsule")) === k }, n)))) : "",
        trace && !calc ? fold("lipt", tt("Trait de la bouche"), plain(tt("Épaisseur"), "lw", 0.2, 4, 0.05, 1, (x) => (+x).toFixed(2)), plain(tt("Tremblé"), "hand", 0, 10, 0.1, 0, (x) => (+x).toFixed(1)), plain(tt("Ondulation"), "wave", 0.5, 12, 0.1, 4, (x) => (+x).toFixed(1))) : "");
    }
    if (lip.on && !trace) {
      rows.push(h("div.row.wrap",
        h("button.mini", { title: tt("Cherche la tête sur l'image de face et vise la bouche"), on: { click: () => autoMouth(l) } }, tt("◎ Repérer la bouche")),
        h("button.mini" + (placing === l.id ? ".on" : ""), { title: tt("Puis clique dans l'image, à l'endroit de la bouche"), on: { click: () => { placing = placing === l.id ? null : l.id; svg.style.cursor = placing ? "crosshair" : ""; props(); } } }, placing === l.id ? tt("Clique sur la bouche…") : tt("✛ Placer à la main"))),
        plain(tt("Taille"), "s", 0.005, 0.2, 0.001, 0.035), plain(tt("Position ↔"), "x", 0, 1, 0.002, 0.5), plain(tt("Position ↕"), "y", 0, 1, 0.002, 0.13),
        h("div", { title: tt("Rayon de l'axe sur lequel la bouche tourne avec l'orbite : plus il est grand, plus la bouche part sur le côté quand le personnage tourne.") }, plain(tt("Axe de la tête ⓘ"), "hw", 0, 0.15, 0.001, 0.03)),
        plain(tt("Inclinaison"), "r", -60, 60, 1, 0, (x) => Math.round(x) + "°"),
        h("label.row", { title: tt("Simple : fermée sur les silences ; dès que ça parle, elle alterne ouverte et fermée. Varié : pareil, mais la bouche ouverte change selon le son. Détaillé : les neuf bouches, sans battement.") }, tt("Lip sync"),
          h("select", { on: { change: (e) => { put("mode", e.target.value); lanes(); props(); } } }, Object.entries(MODES).map(([k, n]) => h("option", { value: k, selected: (lip.mode || "simple") === k }, n)))),
        lip.mode !== "detail" ? h("div", { title: tt("Nombre de battements de bouche par seconde pendant que ça parle") }, plain(tt("Rythme ⓘ"), "flap", 1.5, 6, 0.5, 4, (x) => (+x).toFixed(1) + " /s")) : "",
        (lip.set || "capsule") === "capsule" || lip.set === TRACE ? h("div", { title: tt("Taille de la bouche ouverte, par rapport au trait de la bouche fermée") }, plain(tt("Ouverture ↔ ⓘ"), "ow", 0.15, 1.2, 0.01, 0.55, (x) => (+x).toFixed(2)), plain(tt("Ouverture ↕"), "oh", 0.2, 2.5, 0.01, 1, (x) => (+x).toFixed(2))) : "",
        calc ? "" : fold("lipt", tt("Trait de la bouche"), plain(tt("Épaisseur"), "lw", 0.2, 4, 0.05, 1, (x) => (+x).toFixed(2)), plain(tt("Tremblé"), "hand", 0, 10, 0.1, 0, (x) => (+x).toFixed(1)), plain(tt("Ondulation"), "wave", 0.5, 12, 0.1, 4, (x) => (+x).toFixed(1))),
        h("label.row.check", { title: tt("Une forme derrière la bouche, pour couvrir celle du dessin. Elle prend la couleur choisie pour le personnage (blanc s'il n'en a pas).") }, h("input", { type: "checkbox", checked: lip.bg !== false, on: { change: (e) => { put("bg", e.target.checked); props(); } } }), tt("Masque de peau")));
      if (lip.bg !== false) rows.push(fold("lipm", tt("Réglages du masque"), plain(tt("Largeur"), "mw", 0.1, 4, 0.02, 1, (x) => (+x).toFixed(2)), plain(tt("Hauteur"), "mh", 0.1, 4, 0.02, 1, (x) => (+x).toFixed(2)),
        plain(tt("Décalage ↔"), "mx", -120, 120, 1, 0, (x) => String(Math.round(x))), plain(tt("Décalage ↕"), "my", -120, 120, 1, 0, (x) => String(Math.round(x))),
        h("label.row.check", { title: tt("Montre le masque en rose le temps de l'aligner") }, h("input", { type: "checkbox", checked: !!showMask, on: { change: (e) => { showMask = e.target.checked; paint(); } } }), tt("Voir le masque"))));
    }
    if (lip.on) {
      if (lip.cues) {
        const simple = lip.mode !== "detail" && lip.mode !== "mix", force = (sh) => { const i = cueIndex(lip, t); if (i < 0) return toast(tt("La tête de lecture est hors de la voix.")); const c = lip.cues.split(""); for (let q = i; q < Math.min(c.length, i + 2); q++) c[q] = sh; put("cues", c.join("")); props(); };
        // bouches generees ou bouche du dessin : des boutons en lettres, pas les formes simples qui preteraient a confusion
        const word = trace ? (simple ? { X: tt("Fermée"), A: tt("Ouverte") } : { X: tt("Fermée"), M: "M", A: "A", E: "É", O: "O", U: "OU", F: "F", D: "D", L: "L" }) : null;
        rows.push(
          h("div.muted", { title: tt("Clique une bouche pour l'imposer à l'instant affiché (deux images). Pour corriger une bouche mal devinée.") }, tt`Bouche à cet instant ⓘ : ${MOUTHS[cueAt(lip, t)]} · clic = la forcer ici`),
          h("div.row.wrap.mouths", (simple ? SIMPLE : Object.keys(MOUTHS)).map((k) => { const b = h("button.mini" + (cueAt(lip, t) === k ? ".on" : ""), { title: MOUTHS[k], on: { click: () => force(k) } }); if (word) b.textContent = word[k]; else b.innerHTML = mouthIcon(k, lip.set, itemOf(l)); b.style.background = cueAt(lip, t) === k ? "#bfeee0" : "#fff"; b.style.color = "#111"; b.style.padding = word ? "2px 8px" : "1px 3px"; return b; })));
      }
    }
    setTimeout(updMouthDot, 0);                            // la pastille, une fois le panneau pose
    return h("div.mt-voice",
      fold("voice", tt("🔊 Voix"), h("div.muted", tt("La bande son : une voix de la banque audio, générée, ou enregistrée au micro.")), ...vrows),
      fold("mouth", h("span", tt("👄 Bouche"), mouthDot = h("span.mdot", { "data-l": l.id })), lip.src ? "" : h("div.muted", tt("Sans voix, la bouche reste fermée.")), ...rows),
      exprBox(l));
  }
  // --- expressions du visage (app/exprcards.py) : posees a la tete de lecture, elles tiennent jusqu'a la suivante ; la
  // bouche du lip sync passe toujours par-dessus
  function exprBox(l) {
    const sp = spriteNow(l), keys = sp && sp.exprs || [], ks = (l.ex && l.ex.keys) || [], cur = exprAt(l, t);
    const setAt = (k) => {
      const list = ks.filter((q) => Math.abs(q.t - t) > 0.02);
      list.push({ t: +t.toFixed(3), k });
      list.sort((a, b) => a.t - b.t);
      l.ex = { keys: list }; hist.snap(); paint(); props();
    };
    const rows = [];
    if (!sp || !sp.orbit) rows.push(h("div.muted", tt("Pas d'orbite pour cette pose : pas d'expressions.")));
    else if (!sp.expr || !keys.length) rows.push(h("div.muted", tt("Pas encore d'expressions pour ce personnage : elles sont à générer (il faut aussi sa bouche suivie).")));
    else {
      rows.push(h("div.muted", { title: tt("Clique une expression : elle est posée à la tête de lecture et tient jusqu'à la suivante. Pendant que le personnage parle, elle s'enlève : la bouche du lip sync prend le dessus, sur la tête de base.") }, tt`À cet instant ⓘ : ${exprName(cur)}`),
        h("div.row.wrap.mouths", ["", ...keys].map((k) => h("button.mini" + (cur === k ? ".on" : ""), { on: { click: () => setAt(k) } }, exprName(k)))));
      if (ks.length) rows.push(h("div.exkeys", ks.map((q, i) => h("div.row", h("button.mini", { title: tt("Aller à cet instant"), on: { click: () => { t = q.t; paint(); props(); } } }, `${q.t.toFixed(2)} s`),
        h("span", exprName(q.k)), h("button.mini.danger", { title: tt("Retirer"), on: { click: () => { ks.splice(i, 1); if (!ks.length) delete l.ex; hist.snap(); paint(); props(); } } }, "✕")))));
    }
    return fold("expr", h("span", tt("😊 Expressions"), keys.length ? h("span.muted", ` ${keys.length}`) : ""), ...rows);
  }

  // ------------------------------------------------------------------------------------------ timeline (bas)
  const tl = h("div.mt-timeline"), clock = h("span.mt-clock");
  const pct = (x) => (x / anim.dur * 100).toFixed(3) + "%";
  function lanes() {
    tl.textContent = "";
    const ticks = []; for (let s = 0; s <= anim.dur + 1e-6; s += anim.dur > 8 ? 1 : 0.5) ticks.push(s);
    const ruler = h("div.mt-lane.ruler", { "data-lane": "ruler" }, ticks.map((s) => h("span.tick", { style: `left:${pct(s)}` }, Number.isInteger(s) ? s + " s" : "")));
    tl.append(h("div.mt-row", h("div.mt-name", ""), ruler));
    if (stretchOn && picked.size < 2) stretchOn = false;
    if (stretchOn) {                                       // Resize : de la premiere a la derniere cle prise
      const ts = [...picked].map((k) => k.t), a = Math.min(...ts), b = Math.max(...ts);
      const bar = h("div.mt-clip.stretch", { "data-stretch": "1", title: tt`${picked.size} clés · ${(b - a).toFixed(2)} s · tirer un bout pour élargir ou rétrécir, glisser pour déplacer`, style: `left:${pct(a)};width:${pct(b - a)}` },
        h("span.dk-h.l", { "data-edge": "l" }), h("span.dk-h.r", { "data-edge": "r" }), h("span.len", (b - a).toFixed(2) + " s"));
      tl.append(h("div.mt-row.voice.stretch", h("div.mt-name", { title: tt("Clic sur la croix ou Échap : fermer la barre") }, "⟷ ", tt("Resize"), " ", h("button.mini", { on: { click: () => { stretchOn = false; lanes(); } } }, "✕")), h("div.mt-lane", { "data-lane": "stretch" }, bar)));
    }
    const muteBtn = (id) => { const on = muteOf(id) != null; return h("button.mt-mute" + (on ? ".on" : ""), { title: on ? tt`Muette : figée à ${muteOf(id).toFixed(2)} s. Clic : remettre son animation` : tt("Mute : figer cette piste à l'instant de la tête de lecture (son animation ne joue plus)"), on: { click: (e) => { e.stopPropagation(); toggleMute(id); } } }, "M"); };
    const row = (id, name, ico) => {
      const lane = h("div.mt-lane" + (muteOf(id) != null ? ".muted" : ""), { "data-lane": id }, keysOf(id).map((k) => { const d = h("span.key" + (k === selKey || picked.has(k) ? ".on" : "") + "." + (k.e || "doux"), { style: `left:${pct(k.t)}`, title: tt`${k.t.toFixed(2)} s · ${EASES[k.e || "doux"]} (clic droit pour changer)` }); d.__key = k; d.dataset.key = id; return d; }));
      tl.append(h("div.mt-row" + (sel === id ? ".on" : ""), h("div.mt-name", { on: { click: () => { sel = id; selKey = null; paint(); lanes(); props(); } } }, muteBtn(id), ico, " ", name, keysOf(id).length ? h("span.count", String(keysOf(id).length)) : ""), lane));
    };
    const chanRows = (id) => {                                // canaux deployes : une piste par reglage (camera ou element)
      if (!chanOpen.has(id)) return;
      const l = layerOf(id), it = l && itemOf(l);
      for (const [c, name] of chansOf(id)) {
        const ks = keysOf(id).filter((k) => chanOn(k, c));
        if (l && !ks.length) {                                // element : on ne montre que les reglages qui le concernent
          if (c === "f" && !(nOf(l, stateOf(l).v) > 0)) continue;
          if (c === "v" && !(it && Object.keys(it.variants || {}).length > 1)) continue;
          if (c.startsWith("sh") && !l.sh) continue;
        }
        if (l && (c === "lw" || c.startsWith("sh")) && new Set(ks.map((k) => String(k[c]))).size <= 1 && !ks.some((k) => k.skip)) continue;   // trait, ombre : seulement s'ils bougent
        const fmt = (k) => (typeof k[c] === "number" ? (+k[c]).toFixed(2) : String(k[c]));
        const lane = h("div.mt-lane", { "data-lane": id, "data-ch": c }, ks.map((k) => { const d = h("span.key" + (k === selKey || picked.has(k) ? ".on" : "") + "." + (k.e || "doux"), { style: `left:${pct(k.t)}`, title: tt`${k.t.toFixed(2)} s · ${name} = ${fmt(k)} (glisser : ce canal seul ; clic droit : retirer)` }); d.__key = k; d.dataset.key = id; d.dataset.ch = c; return d; }));
        tl.append(h("div.mt-row.chan" + (sel === id ? ".on" : ""), h("div.mt-name", { title: tt("Canal : clic droit sur la piste pour replier") }, "\u00a0\u00a0└ ", name, ks.length ? h("span.count", String(ks.length)) : ""), lane));
      }
    };
    row("cam", tt("Caméra"), "🎥");
    chanRows("cam");
    for (const n of anim.nulls || []) { row(n.id, n.name, "✛"); chanRows(n.id); }
    if (dof.on) { row("fo", tt("Mise au point"), "◎"); row("bl", tt("Flou"), "◌"); }
    if (fxAnim()) row("fx", tt("Lignes d'effet"), "⚡");
    if (anim.bgAnim && pan.bg) { row("bg", tt("Décor"), "🖼"); chanRows("bg"); }
    for (const l of [...pan.layers].reverse()) {
      const name = itemOf(l) ? itemOf(l).name : tt("élément");
      const pn = parentOf(l.id);
      row(l.id, name + (pn ? " ⤷ " + pn.name : ""), "●");
      chanRows(l.id);
      const lip = l.lip;
      if (lip && lip.src) {                                // la voix du personnage : un bloc a deplacer et a raccourcir par ses deux bouts
        const fps = lip.fps || 12, c = lip.cues || "";
        // un bloc par morceau de la voix (clic droit : scinder) ; chacun se deplace et se raccourcit par ses deux bouts
        const clips = segsOf(lip).map((sg) => {
          const i0 = Math.floor(sg.a * fps), i1 = Math.max(i0 + 1, Math.ceil(sg.b * fps));
          let bars = "";
          for (let i = i0; i < i1; i++) if (c[i] && c[i] !== "X") bars += `<rect x="${i - i0}" y="${c[i] === "M" ? 0.35 : "AOL".includes(c[i]) ? 0.05 : 0.2}" width="1.05" height="${c[i] === "M" ? 0.3 : "AOL".includes(c[i]) ? 0.9 : 0.6}"/>`;
          const clip = h("div.mt-clip", { "data-clip": l.id, "data-seg": sg.j, title: tt`${lip.name || "voix"} · glisser pour déplacer, tirer un bout pour raccourcir, clic droit pour scinder`, style: `left:${pct((lip.off || 0) + sg.o)};width:${pct(sg.b - sg.a)}` },
            h("span.dk-h.l", { "data-edge": "in" }), h("span.dk-h.r", { "data-edge": "out" }));
          clip.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 ${i1 - i0} 1" preserveAspectRatio="none">${bars}</svg>`);
          return clip;
        });
        tl.append(h("div.mt-row.voice", h("div.mt-name", { title: tt`Voix de ${name}`, on: { click: () => { sel = l.id; selKey = null; paint(); lanes(); props(); } } }, "🔊 ", name), h("div.mt-lane", { "data-lane": l.id }, ...clips)));
      }
    }
    tl.append(h("div.mt-head", { style: `left:calc(var(--mt-name) + var(--mt-pad) + (100% - var(--mt-name) - 2 * var(--mt-pad)) * ${t / anim.dur})` }));
    clock.textContent = `${t.toFixed(2)} s / ${anim.dur.toFixed(1)} s`;
  }
  const head = () => { const hd = tl.querySelector(".mt-head"); if (hd) hd.style.left = `calc(var(--mt-name) + var(--mt-pad) + (100% - var(--mt-name) - 2 * var(--mt-pad)) * ${t / anim.dur})`; clock.textContent = `${t.toFixed(2)} s / ${anim.dur.toFixed(1)} s`; };
  const seek = (x, full) => { t = clamp(x, 0, anim.dur); paint(); if (full) { lanes(); props(); } else { head(); syncProps(); } };
  // Maj enfonce : la tete de lecture s'aimante sur la cle la plus proche (toutes pistes confondues)
  const timeAt = (e, lane, skip) => {
    const r = lane.getBoundingClientRect();
    let x = clamp((e.clientX - r.left) / r.width, 0, 1) * anim.dur;
    if (e.shiftKey) {
      let best = null;
      for (const ks of Object.values(anim.tracks)) for (const k of ks) if (k !== skip && (best === null || Math.abs(k.t - x) < Math.abs(best - x))) best = k.t;
      for (const edge of [0, anim.dur]) if (best === null || Math.abs(edge - x) < Math.abs(best - x)) best = edge;
      if (best !== null) x = best;
    }
    return x;
  };
  tl.addEventListener("contextmenu", (e) => {
    if (e.target.__key) { sel = e.target.dataset.key; selKey = e.target.__key; keyMenu(e, sel, selKey, e.target.dataset.ch); lanes(); return; }
    e.preventDefault();
    const row = e.target.closest(".mt-row"), lane = row && row.querySelector(".mt-lane");
    const clipEl = e.target.closest(".mt-clip");
    if (clipEl) {                                          // bloc de voix : le scinder la ou on a clique, retirer un morceau, recoller
      const l = layerOf(clipEl.dataset.clip), lip = l && l.lip;
      if (!lip) return;
      const T = timeAt(e, clipEl.parentNode), j = +clipEl.dataset.seg;
      const split = () => {
        if (!lip.segs) { const [a, b] = voiceSpan(lip); lip.segs = [{ in: f3(a), out: f3(b), o: 0 }]; delete lip.in; delete lip.out; }
        const k = j < 0 ? 0 : j, sg = lip.segs[k], a = Math.max(0, sg.in || 0), u = T - (lip.off || 0) - (sg.o || 0);
        if (u < 0.05 || u > (sg.out ?? lip.dur) - a - 0.05) return toast(tt("Clique plus loin des bouts du morceau pour le scinder."));
        lip.segs.splice(k + 1, 0, { in: f3(a + u), out: sg.out, o: f3((sg.o || 0) + u) });
        sg.out = f3(a + u);
        hist.snap(); paint(); lanes(); props();
        toast(tt("Voix scindée : glisse un morceau pour le déplacer."));
      };
      const items = [{ head: tt`Voix · ${lip.name || "voix"}` }, { label: tt("✂ Scinder ici"), click: split }];
      if (lip.segs && lip.segs.length > 1 && j >= 0) items.push({ label: tt("Retirer ce morceau"), click: () => { lip.segs.splice(j, 1); hist.snap(); paint(); lanes(); props(); } });
      if (lip.segs) items.push({ label: tt("Recoller les morceaux"), click: () => { delete lip.segs; hist.snap(); paint(); lanes(); props(); } });
      items.push({ label: tt("🗑 Retirer ce son"), danger: true, click: () => {   // la voix entiere et ses bouches ; la place de la bouche est gardee
        const a = players.get(l.id); if (a) a.pause(); players.delete(l.id);
        for (const q of ["src", "cues", "name", "dur", "in", "out", "segs"]) delete lip[q];
        hist.snap(); paint(); lanes(); props(); toast(tt("Son retiré (Ctrl+Z pour le remettre).")); } });
      sel = l.id; ctxMenu(e, items);
      return;
    }
    const lid = lane && !row.classList.contains("voice") ? lane.dataset.lane : null;   // piste Camera ou d'un element (ou un de ses canaux)
    if (lid === "cam")
      ctxMenu(e, [{ head: tt("Caméra") }, { label: chanOpen.has("cam") ? tt("Replier les canaux") : tt("Déployer les canaux (cadre, zoom, inclinaison, avancer)"), click: () => chanToggle("cam") }]);
    else if (lid === "bg")
      ctxMenu(e, [{ head: tt("Décor") }, { label: chanOpen.has("bg") ? tt("Replier les canaux") : tt("Déployer les canaux (taille, position)"), click: () => chanToggle("bg") }]);
    else if (lid && nullOf(lid)) {
      const n = nullOf(lid);
      ctxMenu(e, [{ head: "✛ " + n.name }, { label: chanOpen.has(lid) ? tt("Replier les canaux") : tt("Déployer les canaux (position, échelle, rotation)"), click: () => chanToggle(lid) },
        { label: tt("Renommer"), click: () => renameNull(n) }, { label: tt("Supprimer le null"), click: () => removeNull(n) }]);
    }
    else if (lid && layerOf(lid))
      ctxMenu(e, [{ head: itemOf(layerOf(lid)) ? itemOf(layerOf(lid)).name : tt("élément") }, { label: chanOpen.has(lid) ? tt("Replier les canaux") : tt("Déployer les canaux (position, taille, inclinaison, angle, pose, trait, ombre)"), click: () => chanToggle(lid) }]);
  });
  tl.addEventListener("pointerdown", (e) => {
    // les marges a gauche et a droite des pistes comptent aussi : on peut y commencer un lasso pour prendre les cles des bouts
    const rowEl = e.target.closest(".mt-row"), lane = e.target.closest(".mt-lane") || (rowEl && !e.target.closest(".mt-name") ? rowEl.querySelector(".mt-lane") : null);
    if (!lane || e.button !== 0) return;
    stop();
    try { tl.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
    if (lane.dataset.lane === "stretch") {                 // barre Resize : tirer un bout, ou glisser la barre
      if (!e.target.closest(".mt-clip")) return;
      const ts = [...picked].map((k) => k.t);
      drag = { kind: "stretch", mode: e.target.dataset.edge || "move", x0: e.clientX, w: lane.getBoundingClientRect().width, a: Math.min(...ts), b: Math.max(...ts), start: new Map([...picked].map((q) => [q, q.t])) };
      return;
    }
    const clipEl = e.target.closest(".mt-clip");
    if (clipEl) {                                          // bloc de voix : le deplacer, ou le raccourcir par un bout
      const l = layerOf(clipEl.dataset.clip), [va, vb] = voiceSpan(l.lip), j = +clipEl.dataset.seg, sg = j >= 0 && l.lip.segs ? l.lip.segs[j] : null;
      picked.clear(); selKey = null; sel = l.id;
      drag = { kind: "clip", l, mode: e.target.dataset.edge || "move", x0: e.clientX, w: lane.getBoundingClientRect().width, off: l.lip.off || 0, a: va, b: vb,
               sg, o0: sg ? sg.o || 0 : 0, a0: sg ? Math.max(0, sg.in || 0) : 0, b0: sg ? (sg.out ?? l.lip.dur) : 0 };
      return;
    }
    if (e.target.__key) {
      const k = e.target.__key;
      if (e.ctrlKey || e.metaKey) {                        // Ctrl + clic : ajoute ou retire la cle de la selection
        if (selKey) picked.add(selKey);
        if (picked.has(k)) picked.delete(k); else picked.add(k);
        sel = e.target.dataset.key; selKey = picked.has(k) ? k : null; lanes(); props(); return;
      }
      if (picked.has(k) && picked.size > 1) {              // une cle de la selection : elles glissent toutes ensemble
        drag = { kind: "keys", t0: timeAt({ clientX: e.clientX }, lane), start: new Map([...picked].map((q) => [q, q.t])) }; return;
      }
      picked.clear();
      sel = e.target.dataset.key; selKey = e.target.dataset.ch ? splitChannel(k, e.target.dataset.ch, e.target.dataset.key) : k; drag = { kind: "key", key: selKey, lane }; paint(); lanes(); props(); return;   // la tete de lecture ne suit pas : seule la regle la bouge
    }
    if (lane.dataset.lane === "ruler") { picked.clear(); selKey = null; drag = { kind: "seek", lane }; seek(timeAt(e, lane), true); return; }
    drag = { kind: "box", lane, x0: e.clientX, y0: e.clientY };  // dans une piste : simple clic = aller a cet instant, glisser = lasso
  });
  tl.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (drag.kind === "box") {
      if (!drag.el && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
      if (!drag.el) { drag.el = h("div", { style: "position:fixed;z-index:9999;border:1px dashed #7dd3c0;background:rgba(125,211,192,.16);pointer-events:none" }); document.body.append(drag.el); }
      const x = Math.min(drag.x0, e.clientX), y = Math.min(drag.y0, e.clientY), w = Math.abs(e.clientX - drag.x0), hh = Math.abs(e.clientY - drag.y0);
      Object.assign(drag.el.style, { left: x + "px", top: y + "px", width: w + "px", height: hh + "px" });
      picked.clear(); selKey = null;
      tl.querySelectorAll(".key").forEach((d) => { const r = d.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const inb = cx >= x && cx <= x + w && cy >= y && cy <= y + hh; d.classList.toggle("on", inb); if (inb) picked.add(d.__key); });
      return;
    }
    if (drag.kind === "clip") {
      const lip = drag.l.lip, dt = (e.clientX - drag.x0) / drag.w * anim.dur, sg = drag.sg;
      if (sg) {                                            // un morceau de la voix scindee
        if (drag.mode === "move") sg.o = f3(clamp(drag.o0 + dt, -drag.off, anim.dur - drag.off));
        else if (drag.mode === "in") { const a = clamp(drag.a0 + dt, Math.max(0, drag.a0 - drag.off - drag.o0), drag.b0 - 0.1); sg.in = f3(a); sg.o = f3(drag.o0 + a - drag.a0); }   // le son garde sa place
        else sg.out = f3(clamp(drag.b0 + dt, drag.a0 + 0.1, lip.dur || 1e9));
        paint(); lanes(); return;
      }
      if (drag.mode === "move") lip.off = f3(clamp(drag.off + dt, 0, anim.dur));
      else if (drag.mode === "in") { const a = clamp(drag.a + dt, Math.max(0, drag.a - drag.off), drag.b - 0.1); lip.in = f3(a); lip.off = f3(drag.off + a - drag.a); }   // le son garde sa place, le debut recule
      else lip.out = f3(clamp(drag.b + dt, drag.a + 0.1, lip.dur || 1e9));
      paint(); lanes(); return;
    }
    if (drag.kind === "stretch") {                         // les cles gardent leurs proportions entre les deux bouts
      const { a, b } = drag, dt = (e.clientX - drag.x0) / drag.w * anim.dur, span = Math.max(b - a, 1e-6), MIN = 0.05;
      let na = a, nb = b;
      if (drag.mode === "r") nb = clamp(b + dt, a + MIN, anim.dur);
      else if (drag.mode === "l") na = clamp(a + dt, 0, b - MIN);
      else { const d = clamp(dt, -a, anim.dur - b); na = a + d; nb = b + d; }
      for (const [k, t0] of drag.start) k.t = f3(b - a < 1e-6 ? t0 + na - a : na + (t0 - a) / span * (nb - na));
      for (const ks of Object.values(anim.tracks)) ks.sort((p, q) => p.t - q.t);
      paint(); lanes(); return;
    }
    if (drag.kind === "keys") {
      const dt = timeAt({ clientX: e.clientX }, tl.querySelector(".mt-lane")) - drag.t0;
      for (const [k, t0] of drag.start) k.t = f3(clamp(t0 + dt, 0, anim.dur));
      for (const ks of Object.values(anim.tracks)) ks.sort((a, b) => a.t - b.t);
      paint(); lanes(); return;
    }
    if (drag.kind === "seek") { if (drag.lane.isConnected) seek(timeAt(e, drag.lane)); else { const ln = tl.querySelector(".mt-lane"); seek(timeAt(e, ln)); } }
    else { const ln = tl.querySelector(`.mt-lane[data-lane="${sel}"]`) || tl.querySelector(".mt-lane"); drag.key.t = f3(timeAt(e, ln, drag.key)); keysOf(sel).sort((a, b) => a.t - b.t); paint(); lanes(); }
  });
  tl.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === "stretch") hist.snap();
    if (d.kind === "box") {
      if (d.el) { d.el.remove(); if (picked.size === 1) { selKey = [...picked][0]; picked.clear(); } }
      else { picked.clear(); sel = d.lane.dataset.lane; selKey = null; paint(); }
    }
    lanes(); props();
  });
  tl.addEventListener("dblclick", (e) => { const lane = e.target.closest(".mt-lane"); if (lane && lane.dataset.lane !== "ruler" && !e.target.__key) { sel = lane.dataset.lane; t = timeAt(e, lane); const c = lane.dataset.ch; setKey(sel, c ? { [c]: (sel === "cam" ? camAt() : sel === "bg" ? scene.viewAt(t) : layerOf(sel) ? stateOf(layerOf(sel)) : nullOf(sel) ? scene.nullLocal(nullOf(sel), t) : {})[c] } : {}); paint(); lanes(); props(); } });

  // ------------------------------------------------------------------------------------------ gestes dans l'image
  // point de la souris en fraction de l'image. On passe par la matrice du SVG : son cadre a l'ecran peut etre plus grand
  // que l'image (bandes sur les cotes), et une simple regle de trois sur le cadre fausserait les gestes.
  const ptOf = (e) => {
    const m = svg.getScreenCTM();
    if (!m) { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; }
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [q.x / W, q.y / H];
  };
  let vdrag = null;
  // vue isometrique : glisser = point de vue, clic sur le sol = carte de sol, molette = zoom
  svg.addEventListener("pointerdown", (e) => { if (!isoView) return; stop(); try { svg.setPointerCapture(e.pointerId); } catch (err) { /* rien */ } isoDrag = { x: e.clientX, y: e.clientY, yaw: iso.yaw, pitch: iso.pitch, ground: !!e.target.closest("[data-ground]"), moved: false }; svg.style.cursor = "grabbing"; });
  svg.addEventListener("pointermove", (e) => {
    if (!isoView || !isoDrag) return;
    const dx = e.clientX - isoDrag.x, dy = e.clientY - isoDrag.y;
    if (!isoDrag.moved && Math.hypot(dx, dy) < 4) return;
    isoDrag.moved = true; iso.yaw = clamp(isoDrag.yaw + dx * 0.35, -80, 80); iso.pitch = clamp(isoDrag.pitch + dy * 0.3, 6, 88); paint();
  });
  svg.addEventListener("pointerup", () => { if (!isoView || !isoDrag) return; const d = isoDrag; isoDrag = null; svg.style.cursor = "grab"; if (d.moved) isoSave(); else if (d.ground) groundDialog(); });
  svg.addEventListener("dblclick", () => { if (!isoView) return; Object.assign(iso, ISO0); isoSave(); paint(); });
  svg.addEventListener("pointerdown", (e) => {
    if (isoView) return;
    stop();
    if (placing) { placeMouth(e); return; }
    if (tracing && e.button === 0) { traceDown(e); return; }
    if (focusPick && e.button === 0) {                     // cible : mise au point sur l'element clique (cle a la tete de lecture)
      const fid = (e.target.closest("[data-layer]") || {}).dataset?.layer, fl = fid && layerOf(fid);
      setFocusPick(false);
      if (fl) { dof.on = true; change("fo", { fo: f3(depthNow(fl)) }); sel = "fo"; paint(); lanes(); props(); }
      return;
    }
    if (depthView && e.button === 0 && e.target.closest("[data-focus]")) {   // vue de dessus : la ligne verte de mise au point se glisse
      sel = "fo"; selKey = null; vdrag = { focus: true, p: ptOf(e), fo: camAt().fo };
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
      paint(); lanes(); props(); vdrag.p = ptOf(e);
      return;
    }
    const lockCam = camLock && !depthView;                 // camera verrouillee : on ne prend ni personnage ni forme
    const nid = lockCam || depthView ? null : (e.target.closest("[data-null]") || {}).dataset?.null;
    if (nid && nullOf(nid)) {                              // un null : on le prend et on le deplace
      sel = nid; selKey = null;
      if (e.button === 2) { vdrag = null; paint(); lanes(); props(); return; }
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
      vdrag = { id: nid, p: ptOf(e), s: scene.nullLocal(nullOf(nid), t), z: camAt().z };
      paint(); lanes(); props(); vdrag.p = ptOf(e);
      return;
    }
    const id = lockCam ? null : e.target.dataset.layer || (e.target.closest("[data-layer]") || {}).dataset?.layer;
    const shId = id || lockCam ? null : (e.target.closest("[data-shape]") || {}).dataset?.shape, shp = shId ? shapeOf("s:" + shId) : null;
    sel = id || (shp ? "s:" + shId : "cam"); selKey = null;
    const p = ptOf(e), c = camAt();
    if (e.button === 2) { vdrag = null; paint(); lanes(); props(); return; }       // clic droit : on choisit, le menu s'ouvre (contextmenu)
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
    const hEl = e.target.closest("[data-h]"), hk = hEl ? hEl.dataset.h : "";   // poignees (handles.js) : rot, turn, corner, move
    if (id && hk === "rot") { const s = stateOf(layerOf(id)); vdrag = { id, p, s, rot: true, rz0: s.rz || 0 }; }      // centre et angle de depart : apres le rendu
    else if (id && hk === "corner") vdrag = { id, p, s: stateOf(layerOf(id)), corner: +hEl.dataset.c };
    else if (id) { const s = stateOf(layerOf(id)); vdrag = { id, p, s, turn: !depthView && e.button === 0 && (hk === "turn" || (e.altKey && !hk)) && nOf(layerOf(id), s.v) > 0, sx: e.clientX, z: depthView ? 1 : c.z, d: depthNow(layerOf(id)) }; }
    else if (shp && depthView) vdrag = { id: sel, shape: shp, p, d: shp.d ?? 1, p0: shp.p.map((q) => q.slice()) };   // carte d'une forme : en profondeur, et de gauche a droite
    else vdrag = { id: "cam", p, c };                      // dans le vide (ou sur une forme du decor, dans l'image) : on deplace le cadre de la camera
    paint(); lanes(); props();
    if (vdrag) vdrag.p = ptOf(e);                          // le panneau de droite vient de changer : l'image a pu bouger a l'ecran
    const hb = vdrag && (vdrag.rot || vdrag.corner != null) ? svg.querySelector(".lh-box") : null;
    if (hb && vdrag.rot) {                                  // fleche du haut : rotation dans le plan, autour du centre de l'element
      const r = hb.getBoundingClientRect(); vdrag.cx = r.left + r.width / 2; vdrag.cy = r.top + r.height / 2;
      vdrag.a0 = Math.atan2(e.clientY - vdrag.cy, e.clientX - vdrag.cx);
    } else if (hb) {                                        // boule de coin : le coin oppose reste en place (repere de l'image)
      const Mi = hb.parentNode.getScreenCTM().inverse(), toS = (ev) => { const q = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(Mi); return [q.x, q.y]; };
      const bx = { x: +hb.getAttribute("x"), y: +hb.getAttribute("y"), w: +hb.getAttribute("width"), h: +hb.getAttribute("height") }; bx.cx = bx.x + bx.w / 2;
      Object.assign(vdrag, cornerStart(bx, vdrag.s.rz || 0, vdrag.corner), { toS, start: toS(e), kp: bx.h / (vdrag.s.s * H) || 1, F0: [bx.cx, bx.y + bx.h] });
    } else if (vdrag && (vdrag.rot || vdrag.corner != null)) vdrag = null;
  });
  svg.addEventListener("pointermove", (e) => {
    if (isoView) return;
    if (tdraw) { traceMove(e); return; }
    if (!vdrag) return;
    const p = ptOf(e), dx = p[0] - vdrag.p[0], dy = p[1] - vdrag.p[1];
    if (vdrag.focus) { change("fo", { fo: f3(clamp(vdrag.fo - dy / (DY0 - DY1), 0, 1)) }); return; }
    if (vdrag.shape) {                                      // haut / bas : sa profondeur ; gauche / droite : sa place en travers
      vdrag.shape.d = f3(clamp(vdrag.d - dy / (DY0 - DY1), 0, 1));
      vdrag.shape.p = vdrag.p0.map(([x, y]) => [+(x + dx).toFixed(4), y]);
      paint(); syncProps(); return;
    }
    if (vdrag.corner != null) {                             // taille par un coin ; les pieds suivent pour que le coin oppose ne bouge pas
      const s1 = clamp(vdrag.s.s * cornerFactor(vdrag, vdrag.toS(e)), 0.03, 40), F = cornerFeet(vdrag, s1 / vdrag.s.s);
      const [ux, uy] = scene.unDelta(vdrag.id, t, (F[0] - vdrag.F0[0]) / (vdrag.kp * W), (F[1] - vdrag.F0[1]) / (vdrag.kp * H));
      change(vdrag.id, { s: f3(s1), x: f3(vdrag.s.x + ux), y: f3(vdrag.s.y + uy) });
      return;
    }
    if (vdrag.rot) {                                        // Maj : par crans de 15 degres
      let rz = vdrag.rz0 + (Math.atan2(e.clientY - vdrag.cy, e.clientX - vdrag.cx) - vdrag.a0) * 180 / Math.PI;
      rz = ((rz + 180) % 360 + 360) % 360 - 180;
      if (e.shiftKey) rz = Math.round(rz / 15) * 15;
      change(vdrag.id, { rz: +rz.toFixed(1) }); return;
    }
    if (depthView && vdrag.id === "cam") change("cam", { cx: f3(vdrag.c.cx + dx), dz: f3(camDz(camD(vdrag.c.dz || 0) - dy / (DY0 - DY1))) });   // gauche / droite : le cadre ; haut / bas : la camera avance ou recule
    else if (depthView && !vdrag.turn) { setDepth(layerOf(vdrag.id), vdrag.d - dy / (DY0 - DY1)); change(vdrag.id, { x: f3(vdrag.s.x + dx) }); }
    else if (vdrag.id === "cam") change("cam", { cx: f3(vdrag.c.cx - dx / vdrag.c.z), cy: f3(vdrag.c.cy - dy / vdrag.c.z) });
    else if (vdrag.turn) { const n = nOf(layerOf(vdrag.id), vdrag.s.v); if (n) change(vdrag.id, { f: (((vdrag.s.f + Math.round((e.clientX - vdrag.sx) / 6)) % n) + n) % n }); }
    else { const [ux, uy] = scene.unDelta(vdrag.id, t, dx / vdrag.z, dy / vdrag.z); change(vdrag.id, { x: f3(vdrag.s.x + ux), y: f3(vdrag.s.y + uy) }); }   // parente : ramene dans son repere
  });
  svg.addEventListener("pointerup", () => { vdrag = null; if (recAct) recStop(); if (tdraw) traceUp(); });
  svg.addEventListener("lostpointercapture", () => { if (recAct) { vdrag = null; recStop(); } });
  svg.addEventListener("contextmenu", (e) => {                           // clic droit : le menu de l'element, ou celui de la camera
    e.preventDefault();
    if (isoView) return;
    const l = layerOf(sel);
    const nl = nullOf(sel);
    if (nl) ctxMenu(e, [{ head: "✛ " + nl.name }, { label: tt("Renommer"), click: () => renameNull(nl) }, { label: tt("Supprimer le null"), click: () => removeNull(nl) }]);
    else if (l) layerMenu(e, l); else camMenu(e);
  });
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (isoView) { iso.zoom = clamp(iso.zoom * Math.exp(-e.deltaY * 0.0015), 0.4, 4); isoSave(); paint(); return; }
    const k = Math.exp(-e.deltaY * 0.0015);
    if (e.altKey || (depthView && CAMS[sel])) change("cam", { dz: f3(clamp((camAt().dz || 0) - e.deltaY * 0.0012, -2, 1.95)) });   // Alt + molette : la camera avance ou recule
    else if (sel === "cam") change("cam", { z: f3(clamp(camAt().z * k, 0.4, 5)) });
    else if (layerOf(sel)) change(sel, { s: f3(clamp(stateOf(layerOf(sel)).s * k, 0.05, 6)) });
  }, { passive: false });

  // ------------------------------------------------------------------------------------------ lecture
  const playBtn = h("button.mini.mt-play", { on: { click: () => (playing ? stop() : play()) } }, tt("▶ Lecture"));
  function tick(now) {
    if (!playing) return;
    if (!m.box.isConnected) return done();                 // fenetre fermee (croix, clic a cote) : plus de son ni d'image
    t += (now - last) / 1000; last = now;
    if (t >= anim.dur) { if (loop) t = 0; else { t = anim.dur; paint(); head(); return stop(); } }
    paint(); head(); voices(true);
    raf = requestAnimationFrame(tick);
  }
  function play() {
    if (t >= anim.dur - 0.01) t = 0;
    for (let k = 0; k <= anim.dur * 12; k++) markupReady(scene.markup(k / 12, null, () => {}));   // toutes les images de l'animation se chargent des maintenant
    playing = true; playBtn.textContent = tt("⏸ Pause"); last = performance.now(); raf = requestAnimationFrame(tick); }
  function stop() { if (!playing) return; playing = false; voices(false); cancelAnimationFrame(raf); playBtn.textContent = tt("▶ Lecture"); paint(); lanes(); props(); }
  // Rec Action : bouton arme, puis un geste sur le personnage choisi (deplacer, tourner, pencher, taille) est enregistre en
  // temps reel : la tete de lecture avance depuis l'instant affiche, une cle tous les 1/12 s (meme souris immobile, pour
  // tenir la pose), jusqu'a ce que le bouton de la souris soit relache. Les anciennes cles de sa piste sur ce passage partent.
  const REC_STEP = 1 / 12;
  recBtn = h("button.mini.mt-rec", { title: tt("Enregistrer une action : choisis un personnage (ou un null), arme ce bouton, puis fais le geste dans l'image (déplacer, tourner, pencher, taille). Le temps avance pendant le geste et chaque instant devient une clé, jusqu'à ce que tu relâches la souris. La voix et la lecture suivent."),
    on: { click: () => { recArmed = !recArmed && !!(layerOf(sel) || nullOf(sel)); recSync(); } } }, tt("● Rec Action"));
  function recSync() {
    if (!recBtn) return;
    if (recArmed && !layerOf(sel) && !nullOf(sel)) recArmed = false;
    recBtn.disabled = !layerOf(sel) && !nullOf(sel) && !recArmed;
    recBtn.classList.toggle("on", recArmed);
    recBtn.classList.toggle("live", !!recAct);
  }
  function recStart(id) {
    stop();
    recAct = { id, t0: t, start: performance.now(), keys: new Set(), patch: null, lastT: -1 };
    recSync(); voices(true);
    recRaf = setInterval(recTick, 40);                      // horloge reelle (25 fois par seconde), meme fenetre en arriere-plan
  }
  const recNow = () => Math.min(anim.dur, recAct.t0 + (performance.now() - recAct.start) / 1000);
  function recTick() {
    if (!recAct) return;
    if (!m.box.isConnected) { clearInterval(recRaf); recAct = null; return done(); }
    t = recNow();
    if (recAct.patch && t - recAct.lastT >= REC_STEP - 1e-6) { setKey(recAct.id, recAct.patch); recAct.keys.add(selKey); recAct.lastT = t; }
    paint(); head(); voices(true);
    if (t >= anim.dur) return recStop();                    // fin du plan : l'enregistrement s'arrete
  }
  function recStop() {
    const r = recAct;
    if (!r) return;
    t = recNow(); recAct = null; clearInterval(recRaf); voices(false);
    if (r.patch) { setKey(r.id, r.patch); r.keys.add(selKey); }   // la derniere pose, a l'instant du lacher
    const t1 = t, ks = keysOf(r.id);
    if (anim.tracks[r.id]) anim.tracks[r.id] = ks.filter((k) => r.keys.has(k) || k.t < r.t0 - 1e-6 || k.t > t1 + 1e-6);
    recSync(); hist.snap(); paint(); lanes(); props();
    toast(tt`Action enregistrée : ${(t1 - r.t0).toFixed(2)} s, ${r.keys.size} clés.`);
  }
  // Ctrl+Z / Ctrl+Y : les 5 dernieres actions (elements, cles, camera, profondeur de champ)
  const hist = history(() => ({ layers: pan.layers, anim, dof, draw: pan.draw || null, ground: pan.ground || null }), (st) => {
    if (st.draw) pan.draw = st.draw;
    if (st.ground) pan.ground = st.ground; else delete pan.ground;
    pan.layers = st.layers;
    for (const k of Object.keys(anim)) delete anim[k];
    Object.assign(anim, st.anim);
    Object.assign(dof, st.dof);
    selKey = null; drag = null; vdrag = null; picked.clear(); t = Math.min(t, anim.dur);
    if (!CAMS[sel] && !layerOf(sel) && !shapeOf(sel)) sel = "cam";
    dur.value = anim.dur;
    paint(); lanes(); props();
  });
  const key = (e) => {
    // fenetre fermee sans « Annuler » ni « Enregistrer » (croix, clic a cote) : ce montage ne doit plus rien jouer. Sinon
    // la barre d'espace relancait sa copie de la case, avec des voix retirees depuis : une voix fantome, sans piste.
    if (!m.box.isConnected) return done();
    if (lipsCv && lipsCv.isConnected) return;               // editeur des bouches ouvert : ses touches (Ctrl+Z, Espace) a lui
    if (hist.keydown(e)) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === " ") { e.preventDefault(); e.stopPropagation(); return playing ? stop() : play(); }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "q" || e.key === "Q") && [...document.querySelectorAll(".modal-back")].pop() === m.box.parentNode) {   // Q : dessiner le fond, comme sur la planche
      e.preventDefault(); e.stopPropagation(); stop(); drawDecor(); return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "c" || e.key === "C") && !isoView && !v3) { e.preventDefault(); e.stopPropagation(); setCamLock(!camLock); return; }
    if (e.key === "Escape" && focusPick) { e.preventDefault(); e.stopPropagation(); setFocusPick(false); return; }
    if (e.key === "Escape" && stretchOn) { e.preventDefault(); e.stopPropagation(); stretchOn = false; lanes(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "c" && keysSel().length && !String(getSelection())) { e.preventDefault(); e.stopPropagation(); copyKeys(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "v" && keyClip) { e.preventDefault(); e.stopPropagation(); stop(); pasteKeys(t); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && picked.size) {
      e.preventDefault(); e.stopPropagation();
      for (const id of Object.keys(anim.tracks)) anim.tracks[id] = anim.tracks[id].filter((x) => !picked.has(x));
      picked.clear(); selKey = null; paint(); lanes(); props(); return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selKey) { e.preventDefault(); e.stopPropagation(); anim.tracks[sel] = keysOf(sel).filter((x) => x !== selKey); selKey = null; paint(); lanes(); props(); }
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); e.stopPropagation(); return jumpKey(e.key === "ArrowRight" ? 1 : -1); }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); seek(t + (e.key === "ArrowRight" ? 1 : -1) / 24, true); }
  };
  document.addEventListener("keydown", key, true);
  const done = () => { playing = false; voices(false); if (rec) { try { rec.stop(); } catch (e) { /* rien */ } } cancelAnimationFrame(raf); document.removeEventListener("keydown", key, true); };

  const dur = h("input", { type: "number", min: 0.5, max: 60, step: 0.5, value: anim.dur, title: tt("Durée du plan, en secondes"),
    on: { change: (e) => { const d = clamp(+e.target.value || 4, 0.5, 60); anim.dur = d; /* seule la timeline change : les cles gardent leur instant (« Resize » pour les etirer) */ t = Math.min(t, d); paint(); lanes(); props(); } } });
  const fullBtn = h("button.mini", { title: tt("La fenêtre de montage prend tout l'écran"), on: { click: () => { const on = m.box.classList.toggle("modal-full"); fullBtn.textContent = on ? tt("🗗 Fenêtre") : tt("⛶ Plein écran"); } } }, tt("⛶ Plein écran"));
  // quatre vues : l'image, la profondeur (schema vu de dessus), l'isometrique, la 3D
  const VIEWS = [["image", tt("🖼 Image"), tt("L'image de la case, comme elle sera montrée")], ["depth", tt("⬒ Profondeur"), tt("Schéma vu de dessus : chaque élément est une carte, à glisser vers le fond ou vers la caméra")],
    ["iso", tt("◇ Isométrique"), tt("La scène sur son sol, vue d'en haut et de côté : glisser pour changer de point de vue, clic sur le sol pour la carte de sol")],
    ["3d", tt("🧊 3D"), tt("La scène en vraie perspective, avec des cartes plates : glisser pour tourner autour (120°), molette pour avancer, puis « Recalculer la perspective »")]];
  const viewSeg = h("div.mt-views");
  const camLockBtn = h("button.mini.mt-camlock", { title: tt("Verrouillé : dans l'image, tout geste déplace le cadre de la caméra, même sur un personnage (touche C). Déverrouiller pour reprendre les personnages."),
    on: { click: () => setCamLock(!camLock) } }, tt("🎥 Bouger la caméra"));
  function setCamLock(on) {
    camLock = on; camLockBtn.classList.toggle("on", on); camLockBtn.textContent = on ? tt("🔒 Caméra verrouillée") : tt("🎥 Bouger la caméra");
    if (on) { sel = "cam"; selKey = null; paint(); lanes(); props(); }
  }
  function setView(v) {
    depthView = v === "depth"; isoView = v === "iso"; isoDrag = null; v3 = v === "3d"; v3drag = null;
    viewSeg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
    svg.style.cursor = isoView ? "grab" : "";
    paint();
  }
  viewSeg.append(...VIEWS.map(([k, n, title]) => h("button" + (k === "image" ? ".on" : ""), { "data-view": k, title, on: { click: () => setView(k) } }, n)));
  const save = () => {
    done();
    const real = pg.panels[pid] || (pg.panels[pid] = {});
    real.layers = pan.layers;
    real.dof = dof;
    if (pan.draw) { if (JSON.stringify(real.draw) !== JSON.stringify(pan.draw)) real.show = "layers"; real.draw = pan.draw; } else delete real.draw;   // fond dessine (atelier ou profondeur des formes)
    if (pan.ground) real.ground = pan.ground; else delete real.ground;   // carte de sol : gardee dans la case
    if (pan.frame) real.frame = pan.frame; else delete real.frame;       // cadrage de la case (« 1re image → case »)
    if (pan.view) real.view = pan.view; else delete real.view;           // taille et place du decor
    for (const id of Object.keys(anim.tracks)) if (!anim.tracks[id].length) delete anim.tracks[id];
    real.anim = anim;
    app.commit("montage"); app.editor.render(); app.refreshInspector();
  };
  const bar = h("div.mt-bar", h("button.mini", { title: tt("Revenir au début"), on: { click: () => { stop(); seek(0, true); } } }, "⏮"), playBtn, recBtn,
    h("button.mini.mt-null", { title: tt("Ajoute un null : un repère animable, invisible à l'image, sur lequel parenter des éléments"), on: { click: addNull } }, tt("✛ Null")),
    h("label.row.check", { title: tt("Coché : chaque réglage pose une clé à l'instant affiché. Décoché : on règle sans poser de clé ; sur une clé, on la modifie ; ailleurs, toute l'animation de l'élément bouge d'autant. Dans l'image, sur un élément : glisser = le déplacer ; glisser l'anneau au centre = le faire tourner (orbite, ou Alt + glisser) ; glisser la flèche du haut = le pencher (Maj : crans de 15°) ; glisser une boule de coin = sa taille ; molette = taille ; clic droit = son menu.") },
      h("input", { type: "checkbox", checked: auto, on: { change: (e) => { auto = e.target.checked; localStorage.setItem("bw.autokey", auto ? "1" : "0"); } } }), tt("Autokey ⓘ")),
    h("label.row.check", h("input", { type: "checkbox", checked: loop, on: { change: (e) => { loop = e.target.checked; } } }), tt("En boucle")), clock,
    h("span.muted", { title: tt("Dans une piste : glisser trace un lasso qui prend les clés, Ctrl + clic en ajoute une. Les clés prises se déplacent ensemble et s'effacent avec Suppr. La règle des secondes déplace la tête de lecture.") }, tt("Maj : aimant sur les clés · glisser : lasso ⓘ")),
    h("span.spacer"),
    h("button.mini.danger", { title: tt("Retire toutes les clés de toutes les pistes : chaque élément et la caméra reviennent à leur place de départ. Ctrl+Z pour revenir en arrière."), on: { click: () => {
      const n = Object.values(anim.tracks).reduce((q, ks) => q + ks.length, 0);
      if (!n) return toast(tt("Aucune clé à effacer."));
      if (!confirm(tt`Effacer toute l'animation de cette case ?
${n} clé${n > 1 ? "s" : ""} sur ${Object.keys(anim.tracks).filter((k) => anim.tracks[k].length).length} piste(s). Les voix et les réglages des éléments sont gardés.`)) return;
      stop(); hist.snap();
      for (const k of Object.keys(anim.tracks)) delete anim.tracks[k];
      picked.clear(); selKey = null; hist.snap(); paint(); lanes(); props();
      toast(tt("Animation effacée. Ctrl+Z pour la retrouver."));
    } } }, tt("🧹 Effacer l'animation")),
    h("button.mini", { title: tt("La case de la planche prend la pose, la place, la taille et l'orientation de chaque élément à la première image du montage, et le cadrage de la caméra. L'animation ne change pas."), on: { click: () => {
      stop(); hist.snap();
      let n = 0;
      const c0 = scene.camAt(0);                           // le cadrage de la camera a la 1re image : la case le garde (pan.frame)
      if (Math.abs(c0.z - 1) > 1e-3 || Math.abs(c0.rot || 0) > 0.01 || Math.abs(c0.cx - 0.5) > 1e-4 || Math.abs(c0.cy - 0.5) > 1e-4) pan.frame = { cx: f3(c0.cx), cy: f3(c0.cy), z: f3(c0.z), rot: f3(c0.rot || 0) };
      else delete pan.frame;
      for (const l of pan.layers) {
        if (!keysOf(l.id).length) continue;
        const st = scene.localOf(l, 0);
        for (const k of ["x", "y", "s", "rz", "f", "v", "lw"]) if (st[k] != null) l[k] = st[k];
        if (l.sh || st.shg !== 0.72 || st.shw !== 5 || st.sha !== 135) l.sh = Object.assign({}, l.sh, { g: st.shg, w: st.shw, a: st.sha });
        n++;
      }
      hist.snap(); paint(); props();
      toast((n ? tt`Première image reportée sur ${n} élément(s)` : tt("Aucun élément animé")) + (pan.frame ? tt(", et le cadrage de la caméra") : "") + tt(" : la case la montrera une fois le montage enregistré."));
    } } }, tt("⤓ 1re image → case")),
    h("button.mini.photo-go", { title: tt("L'image à la tête de lecture (poses, places, cadrage de la caméra) rendue en photo : GPT Image 2.6 et Seedream 5.5 à comparer (fal, payant)"), on: { click: () => {
      stop();
      const o = JSON.parse(JSON.stringify(pan)), c = scene.camAt(t);
      if (Math.abs(c.z - 1) > 1e-3 || Math.abs(c.rot || 0) > 0.01 || Math.abs(c.cx - 0.5) > 1e-4 || Math.abs(c.cy - 0.5) > 1e-4) o.frame = { cx: f3(c.cx), cy: f3(c.cy), z: f3(c.z), rot: f3(c.rot || 0) }; else delete o.frame;
      pan.layers.forEach((l, i) => { const st = scene.stateOf(l, t), q = o.layers[i];
        for (const k of ["x", "y", "s", "rz", "f", "v", "lw"]) if (st[k] != null) q[k] = st[k];
        if (l.sh || st.shg !== 0.72 || st.shw !== 5 || st.sha !== 135) q.sh = Object.assign({}, l.sh, { g: st.shg, w: st.shw, a: st.sha }); });
      delete o.anim;
      app.casePhoto(pid, o);
    } } }, tt("📷 Générer photo")),
    h("label.row", tt("Durée (s)"), dur));
  paint(); lanes(); props();
  // quitter sans enregistrer : on previent (Annuler, croix, clic a cote, fermeture de l'onglet) si le montage a change
  const stateNow = () => JSON.stringify({ layers: pan.layers, anim, dof, draw: pan.draw || null, ground: pan.ground || null, view: pan.view || null });
  const state0 = stateNow();
  let leaving = false;
  const dirty = () => !leaving && stateNow() !== state0;
  const askLeave = () => new Promise((ok) => {
    let got = "stay";
    const q = modal(tt("Montage non enregistré"), h("p", tt("Tu as modifié ce montage sans l'enregistrer. Si tu quittes maintenant, l'animation est perdue.")),
      [{ label: tt("Rester dans le montage"), click: () => { got = "stay"; } },
       { label: tt("Quitter sans enregistrer"), click: () => { got = "quit"; } },
       { label: tt("Enregistrer le montage"), primary: true, click: () => { got = "save"; } }]);
    q.box.classList.add("modal-ask");
    new MutationObserver((_, ob) => { if (!q.box.isConnected) { ob.disconnect(); ok(got); } }).observe(document.body, { childList: true });
  });
  async function leave(how) {                              // how : ce que demande le geste ; rend true si la fenetre se ferme
    if (dirty()) {
      stop();
      const r = await askLeave();
      if (r === "stay") return false;
      if (r === "save") { save(); toast(tt("Montage enregistré.")); leaving = true; return true; }
    }
    leaving = true; done(); return true;
  }
  const beforeUnload = (e) => { if (m.box.isConnected && dirty()) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", beforeUnload);
  const m = modal(tt`Montage · case ${g.order}`, h("div.mt-editor", h("div.mt-top", h("div.mt-view", svg, box3), side), bar, keyBox, tl),
    [{ label: tt("Annuler"), click: async () => (await leave()) ? undefined : false },
     { label: tt("Enregistrer le montage"), click: () => { save(); toast(tt("Montage enregistré.")); } },
     { label: tt("Enregistrer et envoyer dans le deck ▸"), primary: true, click: () => { save(); app.sendToDeck(pid); } }]);
  m.box.classList.add("modal-wide", "modal-montage");
  { const hd = m.box.querySelector("header"); hd.insertBefore(viewSeg, hd.querySelector("h2").nextSibling); viewSeg.after(camLockBtn); }   // les trois vues : a cote du titre
  { const hd = m.box.querySelector("header"); fullBtn.classList.add("head-full"); hd.insertBefore(fullBtn, hd.querySelector("button.icon")); }   // plein ecran : en haut a droite, a cote de la croix
  hist.watch(m.box);
  // la croix et le clic a cote passent aussi par la question
  const guard = (e) => { e.stopImmediatePropagation(); e.preventDefault(); leave().then((go) => { if (go) { m.close(); window.removeEventListener("beforeunload", beforeUnload); } }); };
  m.box.querySelector("header button.icon").addEventListener("click", guard, true);
  m.box.parentNode.addEventListener("pointerdown", (e) => { if (e.target === m.box.parentNode) guard(e); }, true);
  new MutationObserver((_, ob) => { if (!m.box.isConnected) { ob.disconnect(); window.removeEventListener("beforeunload", beforeUnload); } }).observe(document.body, { childList: true });
  return m;
}
