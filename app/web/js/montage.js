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
import { MOUTHS, SETS, MODES, SIMPLE, PERSO, PERSO_NAME, TRACE, TRACE_NAME, usesTrace, traceMarkup, hasPerso, mouthIcon, lipMarkup, analyse, locateMouth, cueAt, cueIndex, voiceSpan, voiceTime } from "./lipsync.js";
import { swatch } from "./colors.js";
import { sprite, preload, placement, layerBox, background, vecFrame, mouthFrame, inkStroke, shadeOf, shadeShapes, clamp, variantOf, depthOf, groundShadow, AXES, frameToAngle, angleToFrame, bodyFill, inkFill, wiggleFilter, thinMask, lineWidth } from "./model.js";
import { drawSvg, fxSvg, boxOf, W, PRIMS, PATHS } from "./draw.js";
import { faceFor, opsSvg } from "./face.js";

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
const NUM = ["x", "y", "s", "rz", "cx", "cy", "z", "rot", "dz", "fo", "bl", "fx", "lw", "shg", "shw", "sha"];
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

/** Valeurs d'une piste a l'instant t. base : valeurs sans cle. n : nombre d'images de l'orbite (pour tourner au plus court). */
export function valueAt(keys, base, t, n) {
  if (!keys || !keys.length) return Object.assign({}, base);
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
  const stateOf = (l, t) => { const k = keysOf(l.id), b = baseOf(l), v0 = valueAt(k, b, t, 0); return valueAt(k, b, t, nOf(l, v0.v)); };
  const camAt = (t) => {
    const d = pan.dof || {}, c = valueAt(keysOf("cam"), CAM0, t, 0);
    c.fo = valueAt(keysOf("fo"), { fo: c.fo ?? d.focus ?? 0.3 }, t, 0).fo;
    c.bl = valueAt(keysOf("bl"), { bl: c.bl ?? d.amount ?? 12 }, t, 0).bl;
    const fx = pan.draw && pan.draw.fx;                      // lignes d'effet du fond : leur force, animable
    c.fx = fx && fx.on ? (fx.anim ? valueAt(keysOf("fx"), { fx: fx.force ?? 1 }, t, 0).fx : (fx.force ?? 1)) : 0;
    return c;
  };
  // formes dessinees sur le decor : dans le montage chacune a sa profondeur (forme.d, 1 = collee au decor), pour la
  // parallaxe. Elles ne bougent qu'en profondeur ; leur dessin se regle dans « Dessiner le fond ».
  const shapesOf = () => (pan.draw && pan.draw.shapes) || [];
  const shapeCache = new Map();
  const shapeSvg = (sh, i) => { const key = i + JSON.stringify(sh, (k, v) => (k === "d" ? undefined : v)); let x = shapeCache.get(key); if (!x) { if (shapeCache.size > 300) shapeCache.clear(); x = drawSvg({ shapes: [sh] }, H, `${pre}d${i}`); shapeCache.set(key, x); } return x; };
  /** Balisage SVG de la case a l'instant t. sel : calque a encadrer. again : rappele quand des traces finissent de charger. */
  function markup(t, sel, again) {
    const c = camAt(t), dofOn = !!(pan.dof && pan.dof.on), blurs = {};
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
      const pl = placement(bb, bgInfo.w || 16, bgInfo.h || 9, pan.view), vf = vecFrame(bgInfo, again);
      if (vf) { const st = inkStroke(pan.bglw), bw = wiggleFilter(`${pre}wgb`, pan.bghand, pan.bgwave, vf.w, vf.h, 11); o += `<g transform="translate(${f1(pl.x)} ${f1(pl.y)}) scale(${f3(pl.w / vf.w)} ${f3(pl.h / vf.h)})">${bw}<path d="${vf.body}" fill="#fff"/><path d="${vf.ink}"${bw ? ` filter="url(#${pre}wgb)"` : ""} fill="#111" fill-rule="evenodd" stroke="${st.color}" stroke-width="${st.width}"/></g>`; }
      else o += `<image href="${bgInfo.url}" x="${f1(pl.x)}" y="${f1(pl.y)}" width="${f1(pl.w)}" height="${f1(pl.h)}" preserveAspectRatio="none"/>`;
    }
    bgIn = o; o = o0 + plane(1, bgIn); }
    const drawLayer = (l, li) => {
      const s = stateOf(l, t), it = itemOf(l), sp = it && sprite(it, s.v, s.f);
      if (!sp) return;
      // parallaxe : quand la camera se deplace, le premier plan glisse plus que le fond (profondeur 0 = devant, 1 = fond)
      const par = anim.parallax ? (anim.pstr ?? 0.4) * (depthOf(pan, li) - 0.5) : 0, bl = blur(depthOf(pan, li));
      const kp = perspOf(depthOf(pan, li), c.dz);
      if (!kp) return;                                     // la camera l'a depasse
      const box = layerBox(bb, Object.assign({}, l, s, { x: c.cx + (s.x - c.cx) * kp + (c.cx - 0.5) * par, y: c.cy + (s.y - c.cy) * kp + (c.cy - 0.5) * par, s: s.s * kp }), sp), vf = vecFrame(sp, again);
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
      if (l.lip && l.lip.on) {                             // lip sync : la bouche qui parle
        const tr = usesTrace(l.lip, sp);
        if (!tr) o += `<g${bl}>${lipMarkup(lipAt, box, l.flip, t, angleOf(l, s.v, s.f), `${pre}lp-${l.id}`, bodyFill(l), it)}</g>`;
        if (sp.orbit) {                                    // groupe en pixels de l'image d'orbite, pose comme elle : la bouche du dessin s'y dessine, et l'outil « Tracer la bouche » y lit le trait
          const mf = tr ? mouthFrame(sp, again) : null, mw = mf ? mf.w : sp.w, mh = mf ? mf.h : sp.h, msc = Math.min(box.w / mw, box.h / mh);
          o += `<g${bl}><g data-mouth="${l.id}" transform="${flip}translate(${f1(box.x + (box.w - mw * msc) / 2)} ${f1(box.y + box.h - mh * msc)}) scale(${f3(msc)})" style="pointer-events:none">${mf ? traceMarkup(l.lip, mf.m, t, `${pre}lp-${l.id}`, bodyFill(l)) : ""}</g></g>`;
        }
      }
      if (sel === l.id) {
        o += `<rect x="${f1(box.x)}" y="${f1(box.y)}" width="${f1(box.w)}" height="${f1(box.h)}" class="mt-sel"/>`;
        { // croix au milieu : la glisser deplace l'element (comme dans les cases) ; partout ailleurs sur lui, glisser le fait tourner
          const k = 2.4 / c.z;
          o += `<g class="mt-move" data-layer="${l.id}" data-move="1" transform="translate(${f1(box.cx)} ${f1(box.y + box.h / 2)}) scale(${f3(k)})"><circle r="15" data-layer="${l.id}"/><path d="M-9 0H9M0 -9V9M-9 0l3.5 -3.5M-9 0l3.5 3.5M9 0l-3.5 -3.5M9 0l-3.5 3.5M0 -9l-3.5 3.5M0 -9l3.5 3.5M0 9l-3.5 -3.5M0 9l3.5 -3.5"/></g>`;
        }
        {                                                  // pastille ↻ au-dessus : la glisser fait pencher l'element (rotation dans le plan, comme une forme dessinee)
          const k = 2.4 / c.z, r = 15 * k, ry = box.y - r - 4;
          o += `<line x1="${f1(box.cx)}" y1="${f1(box.y)}" x2="${f1(box.cx)}" y2="${f1(ry + r)}" class="mt-sel"/><g class="mt-rot" data-layer="${l.id}" data-rot="1" transform="translate(${f1(box.cx)} ${f1(ry)}) scale(${f3(k)})"><circle r="15" data-layer="${l.id}" data-rot="1"/><path d="M-7 -3A8 8 0 1 1 -5 6M-7 -3L-11 -8M-7 -3L-1 -4" data-layer="${l.id}"/></g>`;
        }
      }
      if (rz) o = o.slice(0, o1) + `<g transform="rotate(${f1(rz)} ${f1(box.cx)} ${f1(box.y + box.h / 2)})">` + o.slice(o1) + "</g>";
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
    return o + `</g></g><defs>${Object.values(blurs).join("")}</defs><rect width="${W}" height="${f1(H)}" class="mt-frame"/>`;
  }
  return { H, anim, markup, stateOf, camAt, nOf, itemOf, keysOf, angleOf };
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
  let t = 0, sel = "cam", selKey = null, playing = false, loop = true, auto = true, raf = 0, last = 0, drag = null;
  const picked = new Set();                                // cles prises au lasso (ou Ctrl + clic) : elles bougent et s'effacent ensemble
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  const pen = (on) => svg.classList.toggle("tracing", !!on);   // curseur crayon pendant le trace de la bouche
  svg.setAttribute("viewBox", `0 0 ${W} ${f1(H)}`); svg.setAttribute("class", "mt-stage");
  const scene = makeScene(app, pg, pan, g.bbox.h / g.bbox.w);
  const layerOf = (id) => pan.layers.find((l) => l.id === id);
  const itemOf = scene.itemOf, nOf = scene.nOf;
  const keysOf = (id) => anim.tracks[id] || [];
  const stateOf = (l) => scene.stateOf(l, t);
  const KEYED = ["x", "y", "s", "rz", "f", "v", "lw", "shg", "shw", "sha"];
  const camAt = () => scene.camAt(t);
  const CAMS = { cam: tt("Caméra"), fo: tt("Mise au point"), bl: tt("Flou"), fx: tt("Lignes d'effet") };      // pistes de la camera ; fo et bl : profondeur de champ

  // ------------------------------------------------------------------------------------------ visionneuse
  function paint() {
    svg.innerHTML = depthView ? topView() : scene.markup(t, playing ? null : sel, paint);
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
  const shapeName = (sh, i) => tt`Forme ${i + 1} (${((PRIMS[sh.t] || PATHS[sh.t] || ["forme"])[0]).toLowerCase()})`;
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
      tt`<text x="${W - 6}" y="${f1(yOf(c.fo) - 5)}" font-size="${f1(fs * 0.75)}" fill="#16a34a" text-anchor="end">MISE AU POINT · ${c.fo.toFixed(2)}</text>`;
    const th = H * 0.03;
    shapes().forEach((sh, i) => {                           // formes du decor : des cartes plus fines, a glisser en profondeur et en travers
      const b = boxOf(sh, H), y = yOf(sh.d ?? 1), on = sel === "s:" + sh.id;
      o += `<g data-shape="${sh.id}" style="cursor:move"><rect x="${f1(b.x)}" y="${f1(y - th * 0.3)}" width="${f1(Math.max(b.w, 14))}" height="${f1(th * 0.6)}" rx="${f1(th / 5)}" fill="${on ? "#e2603a" : "#9a7b2e"}" stroke="#fff" stroke-width="1.2" data-shape="${sh.id}"/>` +
        (on || (sh.d ?? 1) < 0.999 ? `<text x="${f1(b.cx)}" y="${f1(y - th * 0.45)}" font-size="${f1(fs * 0.7)}" fill="${on ? "#b8431f" : "#7a6325"}" text-anchor="middle" data-shape="${sh.id}">${esc(shapeName(sh, i))} · ${(sh.d ?? 1).toFixed(2)}</text>` : "") + `</g>`;
    });
    pan.layers.forEach((l, li) => {
      const st = stateOf(l), it = itemOf(l), sp = it && sprite(it, st.v, st.f);
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

  // ------------------------------------------------------------------------------------------ cles
  const near = (id) => keysOf(id).find((k) => Math.abs(k.t - t) < 0.04);
  function setKey(id, patch) {                             // pose ou met a jour la cle de la piste a l'instant courant
    const keys = anim.tracks[id] || (anim.tracks[id] = []);
    let k = near(id);
    if (!k) {
      const l = layerOf(id), full = CAMS[id] ? camAt() : stateOf(l);
      const base = id === "cam" ? { cx: full.cx, cy: full.cy, z: full.z, rot: full.rot, dz: full.dz || 0 } : CAMS[id] ? { [id]: full[id] } : Object.fromEntries(KEYED.map((q) => [q, full[q]]));
      if (!keys.length && t > 0.04) keys.push(Object.assign({ t: 0 }, base));     // premiere cle posee plus loin : on garde le depart
      k = Object.assign({ t: f3(t) }, base);
      keys.push(k); keys.sort((a, b) => a.t - b.t);
    }
    Object.assign(k, patch);
    selKey = k;
  }
  function change(id, patch) {                             // un reglage bouge : cle automatique, ou valeur de base
    if (auto || keysOf(id).length) setKey(id, patch);
    else if (id === "fo") dof.focus = patch.fo;
    else if (id === "bl") dof.amount = patch.bl;
    else if (id === "fx") pan.draw.fx.force = patch.fx;
    else if (id !== "cam") Object.assign(layerOf(id), patch);
    else setKey(id, patch);
    if (CAMS[id] && CAMS[sel] && sel !== id) { sel = id; keyBar(); }      // camera, mise au point, flou : la piste reglee devient la piste choisie
    paint(); lanes(); syncProps();
  }

  // ------------------------------------------------------------------------------------------ reglages (droite)
  const side = h("div.mt-side");
  let syncProps = () => {};
  const folds = { sh: true, gs: true, lip: true, lipt: false, lipm: false, tts: false, wig: false };
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
      if (dof.on) side.append(range(tt("Mise au point"), "fo", 0, 1, 0.01, undefined, "fo"), range(tt("Flou"), "bl", 0, 60, 1, (x) => String(Math.round(x)), "bl"));
      side.append(
        fxAnim() ? h("h4", { title: tt("Les lignes d'effet dessinées dans le fond de la case. 0 : aucune ; 1 : pleines ; au-delà : plus épaisses. Se pose en clés sur la piste « Lignes d'effet » : elles arrivent, grossissent, disparaissent.") }, tt("⚡ Lignes d'effet ⓘ")) : "",
        fxAnim() ? range(tt("Force"), "fx", 0, 2.5, 0.01, undefined, "fx") : "",
        h("h4", { title: tt("Quand la caméra se déplace, le premier plan glisse plus vite que le fond, selon la profondeur des éléments : le bouton « Profondeur » sous l'image les montre vus de dessus pour les placer.") }, tt("Parallaxe ⓘ")),
        h("label.row.check", h("input", { type: "checkbox", checked: !!anim.parallax, on: { change: (e) => { anim.parallax = e.target.checked; paint(); props(); } } }), tt("Parallaxe automatique")),
        anim.parallax ? h("label.row.range", tt("Force"), h("input", { type: "range", min: 0, max: 3, step: 0.01, value: anim.pstr ?? 0.4, on: { input: (e) => { anim.pstr = +e.target.value; e.target.nextSibling.textContent = (+e.target.value).toFixed(2); paint(); } } }), h("output", (anim.pstr ?? 0.4).toFixed(2))) : "");
    } else {
      const it = itemOf(l), n = nOf(l, cur().v);
      side.append(range(tt("Position ↔"), "x", -1, 2, 0.005), range(tt("Position ↕"), "y", -1, 3, 0.005), range(tt("Taille"), "s", 0.05, 6, 0.01),
        range(tt("Inclinaison"), "rz", -180, 180, 1, (x) => Math.round(x) + "°"));
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
        side.append(h("label.row.check", { title: tt("Une tache sombre et floue sous l'élément, pour le poser au sol") }, h("input", { type: "checkbox", checked: !!gs.on, on: { change: (e) => { putg("on", e.target.checked); props(); } } }), tt("Ombre portée")));
        if (gs.on) side.append(fold("gs", tt("Réglages de l'ombre portée"),
          h("label.row.check", { title: tt("L'ombre prend la couleur choisie pour le contour du dessin, au lieu du noir") }, h("input", { type: "checkbox", checked: !!gs.ink, on: { change: (e) => putg("ink", e.target.checked) } }), tt("Couleur du contour")),
          plain(tt("Opacité"), "a", 0.05, 1, 0.35), h("div", { title: tt("0 : bord net. Vers la droite : de plus en plus floue.") }, plain(tt("Flou ⓘ"), "b", 0, 4, 1)), plain(tt("Largeur"), "w", 0.2, 2.5, 0.8), plain(tt("Épaisseur"), "h", 0.2, 4, 1),
          h("div", { title: tt("Pour la caler sous les pieds quand le personnage a l'air de flotter") }, plain(tt("Décalage ↔ ⓘ"), "dx", -0.6, 0.6, 0), plain(tt("Décalage ↕"), "dy", -0.6, 0.6, 0)),
          h("div", { title: tt("Déforme le contour de l'ombre. 0 : ovale net. Tout à droite : une tache abstraite. Ondulation courte = bord déchiqueté, longue = grandes vagues. Forme : une autre tache, au hasard.") },
            plain(tt("Tremblé ⓘ"), "hand", 0, 10, 0), plain(tt("Ondulation"), "wave", 0.5, 12, 4), plain(tt("Forme"), "seed", 0, 40, 0))));
      }
    }
    keyBar();
    side.append(h("label.row.check", { title: tt("Dans l'image, sur un élément : glisser = le faire tourner (orbite) ; glisser la croix ✥ au milieu = le déplacer (ou Maj + glisser) ; glisser la pastille ↻ au-dessus = le pencher (Maj : crans de 15°) ; molette = taille ; clic droit = son menu (pose, axe, ordre, ombres…). Dans le vide : glisser déplace le cadre. Alt + molette : la caméra avance ou recule. En vue « Profondeur » : glisser une carte vers le haut l'éloigne, vers le bas la rapproche ; glisser la caméra la déplace. Avec la clé automatique, chaque geste pose une clé à l'instant affiché.") }, h("input", { type: "checkbox", checked: auto, on: { change: (e) => { auto = e.target.checked; } } }), tt("Clé automatique à chaque réglage ⓘ")));
    syncProps = () => rows.forEach((f) => f());
  }
  // boutons de cle : juste au-dessus de la timeline
  const keyBox = h("div.mt-keys");
  function keyBar() {
    keyBox.textContent = "";
    if (shapeOf(sel)) { keyBox.append(h("span.muted", tt("Forme du décor : elle se place en profondeur, sans clés."))); return; }
    const k = near(sel), name = CAMS[sel] || (itemOf(layerOf(sel)) || {}).name || tt("élément");
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
    items.push({ head: tt("Ordre") },
      { label: tt("Avancer"), half: true, click: () => reorder(l, 1) }, { label: tt("Reculer"), half: true, click: () => reorder(l, -1) },
      { label: tt("Premier plan"), half: true, click: () => reorder(l, "top") }, { label: tt("Arrière-plan"), half: true, click: () => reorder(l, "bottom") },
      { head: tt("Élément") },
      { label: tt("Retourner (miroir)"), checked: !!l.flip, click: () => { l.flip = !l.flip; paint(); } });
    if (sprite(it, st.v, st.f)?.vec) items.push({ label: tt("Ombre"), checked: !!(l.sh && l.sh.on), click: () => { l.sh = Object.assign({ on: true, g: 0.72, w: 5, a: 135, k: 0 }, l.sh, { on: !(l.sh && l.sh.on) }); paint(); props(); } },
      { label: tt("Animer le tremblé"), checked: !!(l.boil && l.boil.on), click: () => { l.boil = Object.assign({ a: 2, v: 8 }, l.boil, { on: !(l.boil && l.boil.on) }); paint(); props(); } });
    items.push({ label: tt("Ombre portée"), checked: !!(l.gs && l.gs.on), click: () => { l.gs = Object.assign({ on: true, a: 0.35, w: 0.8 }, l.gs, { on: !(l.gs && l.gs.on) }); paint(); props(); } },
      { label: tt("Bouche dessinée"), checked: !!(l.lip && l.lip.on), click: async () => { l.lip = Object.assign({ off: 0, bg: true }, l.lip, { on: !(l.lip && l.lip.on) }); await persoFirst(l); paint(); props(); } },
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
      { label: depthView ? tt("🖼 Voir l'image") : tt("⬒ Vue de dessus (profondeur)"), click: () => depthBtn.click() });
    ctxMenu(e, items);
  }
  function keyMenu(e, id, k) {                              // clic droit sur une cle : son interpolation
    e.preventDefault();
    document.querySelector(".mt-menu")?.remove();
    const group = picked.has(k) && picked.size > 1 ? [...picked] : [k];   // plusieurs cles selectionnees : elles prennent toutes le choix
    const box = h("div.menu.mt-menu", h("div.mhead", group.length > 1 ? tt`${group.length} clés sélectionnées · arrivée` : tt`Clé à ${k.t.toFixed(2)} s · arrivée`),
      Object.entries(EASES).map(([v, n]) => h("button" + ((k.e || "doux") === v ? ".on" : ""), { on: { click: () => { for (const q of group) q.e = v; box.remove(); paint(); lanes(); props(); } } }, ((k.e || "doux") === v ? "✓ " : "") + n)),
      h("button.danger", { on: { click: () => { anim.tracks[id] = keysOf(id).filter((x) => x !== k); selKey = null; box.remove(); paint(); lanes(); props(); } } }, tt("Retirer cette clé")));
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
      delete l.lip.in; delete l.lip.out;
      if (first || (hasPerso(itemOf(l)) && !l.lip.set)) await autoMouth(l, true);
      if ((l.lip.off || 0) + res.dur > anim.dur) { anim.dur = Math.min(60, Math.ceil(((l.lip.off || 0) + res.dur) * 2) / 2); dur.value = anim.dur; }
      hist.snap(); paint(); lanes(); props();
      toast(tt`Voix posée : ${res.dur.toFixed(1)} s, ${new Set(res.cues).size} bouches différentes.`);
    } catch (e) { toast(tt("Voix refusée : ") + e.message, "error"); }
  }
  // voix de synthese ElevenLabs : un texte, une voix du compte, et le son arrive comme une voix importee
  let ttsVoices = null, ttsBusy = false, libAudio = null;
  function libBox(l) {                                     // reprendre une voix deja rangee dans la banque audio
    const pick = h("select", { title: tt("Les voix importées, enregistrées ou générées sont rangées dans l'onglet Audio de la banque"), on: { change: async (e) => {
      const id = e.target.value; e.target.value = "";
      if (!id) return;
      try {
        const r = await post(`projects/${app.project.id}/audio-from`, { id });
        await setVoice(l, await (await fetch(`/projects/${app.project.id}/${r.file}`)).blob(), r.name, r.file);
      } catch (err) { toast(tt("Son non repris : ") + err.message, "error"); }
    } } }, h("option", { value: "" }, libAudio ? (libAudio.length ? tt("📁 Prendre dans la banque audio…") : tt("Banque audio vide")) : tt("Banque audio…")));
    const fill = () => pick.append(...libAudio.map((a) => h("option", { value: a.id, title: a.text || "" }, (a.folder ? a.folder + " / " : "") + a.name + (a.dur ? ` · ${a.dur.toFixed(1)} s` : ""))));
    if (libAudio) fill();
    else get("audio").then((v) => { libAudio = v || []; pick.options[0].textContent = libAudio.length ? tt("📁 Prendre dans la banque audio…") : tt("Banque audio vide"); fill(); }).catch(() => {});
    return pick;
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
    const rows = [h("div.row.wrap", h("button.mini", { title: tt("Fichier son : wav, mp3, m4a, ogg, webm"), on: { click: () => file.click() } }, lip.src ? tt("Changer la voix…") : tt("Importer une voix…")), micBtn, file,
      lip.src ? h("button.mini.danger", { title: tt("Retire la voix et ses bouches (la place de la bouche est gardée)"), on: { click: () => { const a = players.get(l.id); if (a) a.pause(); players.delete(l.id); delete l.lip.src; delete l.lip.cues; delete l.lip.name; delete l.lip.dur; delete l.lip.in; delete l.lip.out; paint(); lanes(); props(); } } }, tt("Retirer")) : "")];
    rows.push(libBox(l), ttsBox(l));
    if (lip.src) {
      const [va, vb] = voiceSpan(lip);
      rows.push(h("div.muted", { title: lip.name || "" }, `🔊 ${(lip.name || "voix").slice(0, 22)} · ${(vb - va).toFixed(1)} s` + (vb - va < (lip.dur || 0) - 0.01 ? tt` sur ${(lip.dur || 0).toFixed(1)}` : "")),
        h("div.row.wrap",
          h("button.mini", { title: tt("Retire le silence avant le premier son et après le dernier"), on: { click: () => { trimBlanks(l); } } }, tt("✂ Couper les blancs")),
          h("button.mini", { title: tt("Coupe la voix à la tête de lecture : ce qui vient après n'est plus joué"), on: { click: () => { const v = voiceTime(lip, t); if (v < 0) return toast(tt("Place la tête de lecture dans la voix.")); put("out", f3(v)); lanes(); props(); } } }, tt("✂ Couper ici")),
          vb - va < (lip.dur || 0) - 0.01 ? h("button.mini", { title: tt("Retrouve la voix entière"), on: { click: () => { delete l.lip.in; delete l.lip.out; paint(); lanes(); props(); } } }, tt("Entière")) : ""));
    }
    rows.push(h("label.row.check", { title: tt("Affiche la bouche dessinée sur le personnage") }, h("input", { type: "checkbox", checked: !!lip.on, on: { change: async (e) => { put("on", e.target.checked); await persoFirst(l); paint(); props(); } } }), tt("Bouche dessinée")));
    const sp0 = spriteNow(l), trace = usesTrace(lip, sp0);
    if (lip.on && sp0 && sp0.orbit && !(itemOf(l) || {}).body) {   // bouche du dessin : la tracer sur le personnage
      const on = tracing === l.id;
      rows.push(h("div.row.wrap",
        h("button.mini" + (on ? ".on" : ""), { title: tt("Trace un trait sur la bouche du personnage, d'un coin à l'autre, sur l'image affichée : elle est retrouvée puis suivie quand il tourne. Vaut pour cet élément et cette pose, dans tous les calques qui l'utilisent."), on: { click: () => { tracing = on ? null : l.id; placing = null; svg.style.cursor = ""; pen(tracing); props(); } } }, on ? tt("Trace sur la bouche…") : tt("✎ Tracer la bouche")),
        h("select", { title: tt("Crayon : tracé libre. Droite : cliquer-glisser d'un coin de la bouche à l'autre."), on: { change: (e) => { traceMode = e.target.value; localStorage.setItem("bw.traceMode", traceMode); } } },
          [["crayon", tt("Crayon")], ["droite", tt("Droite")]].map(([k, n]) => h("option", { value: k, selected: traceMode === k }, n))),
        sp0.mouth ? h("button.mini.danger", { title: tt("Retire la bouche suivie de cette pose (pour tous les calques qui l'utilisent)"), on: { click: () => traceClear(l) } }, tt("Effacer le tracé")) : ""));
    }
    if (lip.on && trace) {                                 // bouche du dessin : pas de place, d'axe ni de masque a regler
      rows.push(
        h("label.row", { title: tt("Simple : fermée sur les silences ; dès que ça parle, elle alterne ouverte et fermée. Varié : pareil, mais la bouche ouverte change selon le son. Détaillé : les neuf bouches, sans battement.") }, tt("Lip sync"),
          h("select", { on: { change: (e) => { put("mode", e.target.value); lanes(); props(); } } }, Object.entries(MODES).map(([k, n]) => h("option", { value: k, selected: (lip.mode || "simple") === k }, n)))),
        lip.mode !== "detail" ? h("div", { title: tt("Nombre de battements de bouche par seconde pendant que ça parle") }, plain(tt("Rythme ⓘ"), "flap", 1.5, 6, 0.5, 4, (x) => (+x).toFixed(1) + " /s")) : "",
        h("div", { title: tt("Bouche en trait : de combien la lèvre du bas descend (↕) et la largeur de la bouche ouverte (↔). Une bouche déjà ouverte dans le dessin garde sa forme.") }, plain(tt("Ouverture ↔ ⓘ"), "ow", 0.3, 1.3, 0.01, 1, (x) => (+x).toFixed(2)), plain(tt("Ouverture ↕"), "oh", 0.2, 5, 0.01, 1, (x) => (+x).toFixed(2))));
    }
    if (lip.on) {
      rows.push(h("label.row", { title: tt("Le dessin des bouches") }, tt("Jeu de bouches"), h("select", { on: { change: async (e) => { const was = (l.lip || {}).set === PERSO; put("set", e.target.value); if (was !== (e.target.value === PERSO)) { await autoMouth(l, true); hist.snap(); paint(); } props(); } } }, [...(sp0 && sp0.mouth || lip.set === TRACE ? [[TRACE, TRACE_NAME]] : []), ...(hasPerso(itemOf(l)) ? [[PERSO, PERSO_NAME]] : []), ...Object.entries(SETS)].map(([k, n]) => h("option", { value: k, selected: (lip.set || (trace ? TRACE : "capsule")) === k }, n)))),
        trace ? fold("lipt", tt("Trait de la bouche"), plain(tt("Épaisseur"), "lw", 0.2, 4, 0.05, 1, (x) => (+x).toFixed(2)), plain(tt("Tremblé"), "hand", 0, 10, 0.1, 0, (x) => (+x).toFixed(1)), plain(tt("Ondulation"), "wave", 0.5, 12, 0.1, 4, (x) => (+x).toFixed(1))) : "");
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
        fold("lipt", tt("Trait de la bouche"), plain(tt("Épaisseur"), "lw", 0.2, 4, 0.05, 1, (x) => (+x).toFixed(2)), plain(tt("Tremblé"), "hand", 0, 10, 0.1, 0, (x) => (+x).toFixed(1)), plain(tt("Ondulation"), "wave", 0.5, 12, 0.1, 4, (x) => (+x).toFixed(1))),
        h("label.row.check", { title: tt("Une forme derrière la bouche, pour couvrir celle du dessin. Elle prend la couleur choisie pour le personnage (blanc s'il n'en a pas).") }, h("input", { type: "checkbox", checked: lip.bg !== false, on: { change: (e) => { put("bg", e.target.checked); props(); } } }), tt("Masque de peau")));
      if (lip.bg !== false) rows.push(fold("lipm", tt("Réglages du masque"), plain(tt("Largeur"), "mw", 0.1, 4, 0.02, 1, (x) => (+x).toFixed(2)), plain(tt("Hauteur"), "mh", 0.1, 4, 0.02, 1, (x) => (+x).toFixed(2)),
        plain(tt("Décalage ↔"), "mx", -120, 120, 1, 0, (x) => String(Math.round(x))), plain(tt("Décalage ↕"), "my", -120, 120, 1, 0, (x) => String(Math.round(x))),
        h("label.row.check", { title: tt("Montre le masque en rose le temps de l'aligner") }, h("input", { type: "checkbox", checked: !!showMask, on: { change: (e) => { showMask = e.target.checked; paint(); } } }), tt("Voir le masque"))));
    }
    if (lip.on) {
      if (lip.cues) {
        const simple = lip.mode !== "detail" && lip.mode !== "mix", force = (sh) => { const i = cueIndex(lip, t); if (i < 0) return toast(tt("La tête de lecture est hors de la voix.")); const c = lip.cues.split(""); for (let q = i; q < Math.min(c.length, i + 2); q++) c[q] = sh; put("cues", c.join("")); props(); };
        rows.push(plain(tt("Décalage (s)"), "off", 0, Math.max(1, anim.dur), 0.01, 0, (x) => (+x).toFixed(2)),
          h("div.muted", { title: tt("Clique une bouche pour l'imposer à l'instant affiché (deux images). Pour corriger une bouche mal devinée.") }, tt`Bouche à cet instant ⓘ : ${MOUTHS[cueAt(lip, t)]}`),
          h("div.row.wrap.mouths", (simple ? SIMPLE : Object.keys(MOUTHS)).map((k) => { const b = h("button.mini" + (cueAt(lip, t) === k ? ".on" : ""), { title: MOUTHS[k], on: { click: () => force(k) } }); b.innerHTML = mouthIcon(k, lip.set, itemOf(l)); b.style.background = cueAt(lip, t) === k ? "#bfeee0" : "#fff"; b.style.padding = "1px 3px"; return b; })));
      }
    }
    return h("div", h("h4", { title: tt("Une voix importée ou enregistrée fait parler le personnage : le navigateur écoute le son et appelle la bonne bouche, sans calcul sur les machines.") }, tt("🗣 Voix et bouche ⓘ")), fold("lip", tt("Réglages de la voix"), ...rows));
  }

  // ------------------------------------------------------------------------------------------ timeline (bas)
  const tl = h("div.mt-timeline"), clock = h("span.mt-clock");
  const pct = (x) => (x / anim.dur * 100).toFixed(3) + "%";
  function lanes() {
    tl.textContent = "";
    const ticks = []; for (let s = 0; s <= anim.dur + 1e-6; s += anim.dur > 8 ? 1 : 0.5) ticks.push(s);
    const ruler = h("div.mt-lane.ruler", { "data-lane": "ruler" }, ticks.map((s) => h("span.tick", { style: `left:${pct(s)}` }, Number.isInteger(s) ? s + " s" : "")));
    tl.append(h("div.mt-row", h("div.mt-name", ""), ruler));
    const row = (id, name, ico) => {
      const lane = h("div.mt-lane", { "data-lane": id }, keysOf(id).map((k) => { const d = h("span.key" + (k === selKey || picked.has(k) ? ".on" : "") + "." + (k.e || "doux"), { style: `left:${pct(k.t)}`, title: tt`${k.t.toFixed(2)} s · ${EASES[k.e || "doux"]} (clic droit pour changer)` }); d.__key = k; d.dataset.key = id; return d; }));
      tl.append(h("div.mt-row" + (sel === id ? ".on" : ""), h("div.mt-name", { on: { click: () => { sel = id; selKey = null; paint(); lanes(); props(); } } }, ico, " ", name, keysOf(id).length ? h("span.count", String(keysOf(id).length)) : ""), lane));
    };
    row("cam", tt("Caméra"), "🎥");
    if (dof.on) { row("fo", tt("Mise au point"), "◎"); row("bl", tt("Flou"), "◌"); }
    if (fxAnim()) row("fx", tt("Lignes d'effet"), "⚡");
    for (const l of [...pan.layers].reverse()) {
      const name = itemOf(l) ? itemOf(l).name : tt("élément");
      row(l.id, name, "●");
      const lip = l.lip;
      if (lip && lip.src) {                                // la voix du personnage : un bloc a deplacer et a raccourcir par ses deux bouts
        const [va, vb] = voiceSpan(lip), fps = lip.fps || 12, c = lip.cues || "", i0 = Math.floor(va * fps), i1 = Math.max(i0 + 1, Math.ceil(vb * fps));
        let bars = "";
        for (let i = i0; i < i1; i++) if (c[i] && c[i] !== "X") bars += `<rect x="${i - i0}" y="${c[i] === "M" ? 0.35 : "AOL".includes(c[i]) ? 0.05 : 0.2}" width="1.05" height="${c[i] === "M" ? 0.3 : "AOL".includes(c[i]) ? 0.9 : 0.6}"/>`;
        const clip = h("div.mt-clip", { "data-clip": l.id, title: tt`${lip.name || "voix"} · glisser pour déplacer, tirer un bout pour raccourcir`, style: `left:${pct(lip.off || 0)};width:${pct(vb - va)}` },
          h("span.dk-h.l", { "data-edge": "in" }), h("span.dk-h.r", { "data-edge": "out" }));
        clip.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 ${i1 - i0} 1" preserveAspectRatio="none">${bars}</svg>`);
        tl.append(h("div.mt-row.voice", h("div.mt-name", { title: tt`Voix de ${name}`, on: { click: () => { sel = l.id; selKey = null; paint(); lanes(); props(); } } }, "🔊 ", name), h("div.mt-lane", { "data-lane": l.id }, clip)));
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
  tl.addEventListener("contextmenu", (e) => { if (e.target.__key) { sel = e.target.dataset.key; selKey = e.target.__key; keyMenu(e, sel, selKey); lanes(); } else e.preventDefault(); });
  tl.addEventListener("pointerdown", (e) => {
    // les marges a gauche et a droite des pistes comptent aussi : on peut y commencer un lasso pour prendre les cles des bouts
    const rowEl = e.target.closest(".mt-row"), lane = e.target.closest(".mt-lane") || (rowEl && !e.target.closest(".mt-name") ? rowEl.querySelector(".mt-lane") : null);
    if (!lane || e.button !== 0) return;
    stop();
    try { tl.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
    const clipEl = e.target.closest(".mt-clip");
    if (clipEl) {                                          // bloc de voix : le deplacer, ou le raccourcir par un bout
      const l = layerOf(clipEl.dataset.clip), [va, vb] = voiceSpan(l.lip);
      picked.clear(); selKey = null; sel = l.id;
      drag = { kind: "clip", l, mode: e.target.dataset.edge || "move", x0: e.clientX, w: lane.getBoundingClientRect().width, off: l.lip.off || 0, a: va, b: vb };
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
      sel = e.target.dataset.key; selKey = k; drag = { kind: "key", key: selKey, lane }; seek(selKey.t, true); return;
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
      const lip = drag.l.lip, dt = (e.clientX - drag.x0) / drag.w * anim.dur;
      if (drag.mode === "move") lip.off = f3(clamp(drag.off + dt, 0, anim.dur));
      else if (drag.mode === "in") { const a = clamp(drag.a + dt, Math.max(0, drag.a - drag.off), drag.b - 0.1); lip.in = f3(a); lip.off = f3(drag.off + a - drag.a); }   // le son garde sa place, le debut recule
      else lip.out = f3(clamp(drag.b + dt, drag.a + 0.1, lip.dur || 1e9));
      paint(); lanes(); return;
    }
    if (drag.kind === "keys") {
      const dt = timeAt({ clientX: e.clientX }, tl.querySelector(".mt-lane")) - drag.t0;
      for (const [k, t0] of drag.start) k.t = f3(clamp(t0 + dt, 0, anim.dur));
      for (const ks of Object.values(anim.tracks)) ks.sort((a, b) => a.t - b.t);
      paint(); lanes(); return;
    }
    if (drag.kind === "seek") { if (drag.lane.isConnected) seek(timeAt(e, drag.lane)); else { const ln = tl.querySelector(".mt-lane"); seek(timeAt(e, ln)); } }
    else { const ln = tl.querySelector(`.mt-lane[data-lane="${sel}"]`) || tl.querySelector(".mt-lane"); drag.key.t = f3(timeAt(e, ln, drag.key)); keysOf(sel).sort((a, b) => a.t - b.t); t = drag.key.t; paint(); lanes(); }
  });
  tl.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === "box") {
      if (d.el) { d.el.remove(); if (picked.size === 1) { selKey = [...picked][0]; picked.clear(); } }
      else { picked.clear(); sel = d.lane.dataset.lane; selKey = null; t = clamp(timeAt(e, d.lane), 0, anim.dur); paint(); }
    }
    lanes(); props();
  });
  tl.addEventListener("dblclick", (e) => { const lane = e.target.closest(".mt-lane"); if (lane && lane.dataset.lane !== "ruler" && !e.target.__key) { sel = lane.dataset.lane; t = timeAt(e, lane); setKey(sel, {}); paint(); lanes(); props(); } });

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
  svg.addEventListener("pointerdown", (e) => {
    stop();
    if (placing) { placeMouth(e); return; }
    if (tracing && e.button === 0) { traceDown(e); return; }
    const id = e.target.dataset.layer || (e.target.closest("[data-layer]") || {}).dataset?.layer;
    const shId = id ? null : (e.target.closest("[data-shape]") || {}).dataset?.shape, shp = shId ? shapeOf("s:" + shId) : null;
    sel = id || (shp ? "s:" + shId : "cam"); selKey = null;
    const p = ptOf(e), c = camAt();
    if (e.button === 2) { vdrag = null; paint(); lanes(); props(); return; }       // clic droit : on choisit, le menu s'ouvre (contextmenu)
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
    if (id && e.target.closest("[data-rot]")) {            // pastille ↻ : rotation dans le plan, autour du centre de l'element
      const s = stateOf(layerOf(id)), box = svg.querySelector(".mt-move") || svg.querySelector(".mt-sel"), r = box.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      vdrag = { id, p, s, rot: true, cx, cy, a0: Math.atan2(e.clientY - cy, e.clientX - cx), rz0: s.rz || 0 };
    } else
    if (id) { const s = stateOf(layerOf(id)); vdrag = { id, p, s, turn: !depthView && e.button === 0 && !e.shiftKey && !e.target.closest("[data-move]") && nOf(layerOf(id), s.v) > 0, sx: e.clientX, z: depthView ? 1 : c.z, d: depthNow(layerOf(id)) }; }
    else if (shp && depthView) vdrag = { id: sel, shape: shp, p, d: shp.d ?? 1, p0: shp.p.map((q) => q.slice()) };   // carte d'une forme : en profondeur, et de gauche a droite
    else vdrag = { id: "cam", p, c };                      // dans le vide (ou sur une forme du decor, dans l'image) : on deplace le cadre de la camera
    paint(); lanes(); props();
    if (vdrag) vdrag.p = ptOf(e);                          // le panneau de droite vient de changer : l'image a pu bouger a l'ecran
  });
  svg.addEventListener("pointermove", (e) => {
    if (tdraw) { traceMove(e); return; }
    if (!vdrag) return;
    const p = ptOf(e), dx = p[0] - vdrag.p[0], dy = p[1] - vdrag.p[1];
    if (vdrag.shape) {                                      // haut / bas : sa profondeur ; gauche / droite : sa place en travers
      vdrag.shape.d = f3(clamp(vdrag.d - dy / (DY0 - DY1), 0, 1));
      vdrag.shape.p = vdrag.p0.map(([x, y]) => [+(x + dx).toFixed(4), y]);
      paint(); syncProps(); return;
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
    else change(vdrag.id, { x: f3(vdrag.s.x + dx / vdrag.z), y: f3(vdrag.s.y + dy / vdrag.z) });
  });
  svg.addEventListener("pointerup", () => { vdrag = null; if (tdraw) traceUp(); });
  svg.addEventListener("contextmenu", (e) => {                           // clic droit : le menu de l'element, ou celui de la camera
    e.preventDefault();
    const l = layerOf(sel);
    if (l) layerMenu(e, l); else camMenu(e);
  });
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
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
  function play() { if (t >= anim.dur - 0.01) t = 0; playing = true; playBtn.textContent = tt("⏸ Pause"); last = performance.now(); raf = requestAnimationFrame(tick); }
  function stop() { if (!playing) return; playing = false; voices(false); cancelAnimationFrame(raf); playBtn.textContent = tt("▶ Lecture"); paint(); lanes(); props(); }
  // Ctrl+Z / Ctrl+Y : les 5 dernieres actions (elements, cles, camera, profondeur de champ)
  const hist = history(() => ({ layers: pan.layers, anim, dof, draw: pan.draw || null }), (st) => {
    if (st.draw) pan.draw = st.draw;
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
    if (hist.keydown(e)) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === " ") { e.preventDefault(); e.stopPropagation(); return playing ? stop() : play(); }
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
    on: { change: (e) => { const d = clamp(+e.target.value || 4, 0.5, 60), k = d / anim.dur; if (confirm(tt("Étirer aussi les clés sur la nouvelle durée ?\nAnnuler : les clés gardent leur instant."))) for (const ks of Object.values(anim.tracks)) for (const x of ks) x.t = f3(x.t * k); anim.dur = d; t = Math.min(t, d); paint(); lanes(); props(); } } });
  const fullBtn = h("button.mini", { title: tt("La fenêtre de montage prend tout l'écran"), on: { click: () => { const on = m.box.classList.toggle("modal-full"); fullBtn.textContent = on ? tt("🗗 Fenêtre") : tt("⛶ Plein écran"); } } }, tt("⛶ Plein écran"));
  const depthBtn = h("button.mini", { title: tt("Schéma vu de dessus : chaque élément est une carte, à glisser vers le fond ou vers la caméra"),
    on: { click: () => { depthView = !depthView; depthBtn.textContent = depthView ? tt("🖼 Image") : tt("⬒ Profondeur"); depthBtn.classList.toggle("on", depthView); paint(); } } }, tt("⬒ Profondeur"));
  const save = () => {
    done();
    const real = pg.panels[pid] || (pg.panels[pid] = {});
    real.layers = pan.layers;
    real.dof = dof;
    if (pan.draw) real.draw = pan.draw;                   // profondeur des formes du decor
    for (const id of Object.keys(anim.tracks)) if (!anim.tracks[id].length) delete anim.tracks[id];
    real.anim = anim;
    app.commit("montage"); app.editor.render(); app.refreshInspector();
  };
  const bar = h("div.mt-bar", h("button.mini", { title: tt("Revenir au début"), on: { click: () => { stop(); seek(0, true); } } }, "⏮"), playBtn,
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
    h("button.mini", { title: tt("La case de la planche prend la pose, la place, la taille et l'orientation de chaque élément à la première image du montage. L'animation ne change pas. La caméra n'est pas reportée."), on: { click: () => {
      stop(); hist.snap();
      let n = 0;
      for (const l of pan.layers) {
        if (!keysOf(l.id).length) continue;
        const st = scene.stateOf(l, 0);
        for (const k of ["x", "y", "s", "rz", "f", "v", "lw"]) if (st[k] != null) l[k] = st[k];
        if (l.sh || st.shg !== 0.72 || st.shw !== 5 || st.sha !== 135) l.sh = Object.assign({}, l.sh, { g: st.shg, w: st.shw, a: st.sha });
        n++;
      }
      hist.snap(); paint(); props();
      toast(n ? tt`Première image reportée sur ${n} élément(s) : la case la montrera une fois le montage enregistré.` : tt("Aucun élément animé : la case montre déjà la première image."));
    } } }, tt("⤓ 1re image → case")),
    depthBtn, h("label.row", tt("Durée (s)"), dur));
  paint(); lanes(); props();
  const m = modal(tt`Montage · case ${g.order}`, h("div.mt-editor", h("div.mt-top", h("div.mt-view", svg), side), bar, keyBox, tl),
    [{ label: tt("Annuler"), click: done },
     { label: tt("Enregistrer le montage"), click: () => { save(); toast(tt("Montage enregistré.")); } },
     { label: tt("Enregistrer et envoyer dans le deck ▸"), primary: true, click: () => { save(); app.sendToDeck(pid); } }]);
  m.box.classList.add("modal-wide", "modal-montage");
  { const hd = m.box.querySelector("header"); fullBtn.classList.add("head-full"); hd.insertBefore(fullBtn, hd.querySelector("button.icon")); }   // plein ecran : en haut a droite, a cote de la croix
  hist.watch(m.box);
  return m;
}
