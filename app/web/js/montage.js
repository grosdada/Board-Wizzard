// Mode montage d'une case (maquette) : une visionneuse, une timeline avec une piste par element et une piste camera,
// des poses cles. panel.anim = { dur (secondes), tracks: { cam: [cles], <id du calque>: [cles] } }.
//   cle d'un calque : { t, x, y, s, f (image de l'orbite), v (pose), lw (trait), shg, shw, sha (ombre : gris, largeur,
//                       angle), e (interpolation pour arriver sur cette cle : doux | lin | fixe) }
//   cle de camera   : { t, cx, cy (centre du cadre, fraction de la case), z (zoom), rot (degres),
//                       e }
// Profondeur de champ : panel.dof = { on, focus, amount } comme dans la case. Deux pistes l'animent :
//   tracks.fo : [{ t, fo (mise au point, 0 devant a 1 fond), e }]   ·   tracks.bl : [{ t, bl (force du flou), e }]
// Sans cle, une piste garde ses valeurs de la case. Entre deux cles les valeurs sont interpolees.
import { h, modal, toast, history } from "./api.js";
import { sprite, preload, placement, layerBox, background, vecFrame, inkStroke, shadeOf, shadeShapes, clamp, variantOf, depthOf, groundShadow } from "./model.js";
import { drawSvg, W } from "./draw.js";

const f1 = (n) => (+n).toFixed(1), f3 = (n) => +(+n).toFixed(3);
const CAM0 = { cx: 0.5, cy: 0.5, z: 1, rot: 0 };
// doux : depart et arrivee amortis · lin : vitesse reguliere · fixe : pas d'intermediaire, on saute a la cle (paliers)
export const EASES = { doux: "En douceur", lin: "Régulière", fixe: "Fixe (par paliers, sans intermédiaire)" };
const ease = (u, e) => (e === "fixe" ? 0 : e === "lin" ? u : u * u * (3 - 2 * u));
const NUM = ["x", "y", "s", "cx", "cy", "z", "rot", "fo", "bl", "lw", "shg", "shw", "sha"];
// mouvements de camera prets : [nom, depart, arrivee]
export const MOVES = {
  "trav-d": ["Travelling vers la droite", { cx: 0.38, z: 1.35 }, { cx: 0.62, z: 1.35 }],
  "trav-g": ["Travelling vers la gauche", { cx: 0.62, z: 1.35 }, { cx: 0.38, z: 1.35 }],
  "avant": ["Travelling avant (on s'approche)", { z: 1 }, { z: 1.7 }],
  "arriere": ["Travelling arrière (on s'éloigne)", { z: 1.7 }, { z: 1 }],
  "pano-h": ["Panoramique vers le haut", { cy: 0.62, z: 1.35 }, { cy: 0.38, z: 1.35 }],
  "pano-b": ["Panoramique vers le bas", { cy: 0.38, z: 1.35 }, { cy: 0.62, z: 1.35 }],
  "zoom": ["Zoom avant rapide", { z: 1 }, { z: 2.4 }],
  "dutch": ["Bascule (caméra qui penche)", { rot: -6, z: 1.25 }, { rot: 6, z: 1.25 }],
  "fixe": ["Plan fixe (retire le mouvement)", null, null],
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
  for (const k of NUM) if (a[k] != null && b[k] != null) out[k] = a[k] + (b[k] - a[k]) * u;
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
  const baseOf = (l) => { const sh = l.sh || {}; return { x: l.x, y: l.y, s: l.s, f: l.f || 0, v: l.v, lw: l.lw || 0, shg: sh.g ?? 0.72, shw: sh.w ?? 5, sha: sh.a ?? 135 }; };
  const stateOf = (l, t) => { const k = keysOf(l.id), b = baseOf(l), v0 = valueAt(k, b, t, 0); return valueAt(k, b, t, nOf(l, v0.v)); };
  const camAt = (t) => {
    const d = pan.dof || {}, c = valueAt(keysOf("cam"), CAM0, t, 0);
    c.fo = valueAt(keysOf("fo"), { fo: c.fo ?? d.focus ?? 0.3 }, t, 0).fo;
    c.bl = valueAt(keysOf("bl"), { bl: c.bl ?? d.amount ?? 12 }, t, 0).bl;
    return c;
  };
  const drawBg = pan.draw && (pan.draw.shapes || []).length ? drawSvg(pan.draw, H, pre) : "";
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
    const bpar = anim.parallax ? (anim.pstr ?? 0.4) * 0.5 : 0, bdx = (c.cx - 0.5) * bpar * W, bdy = (c.cy - 0.5) * bpar * H;   // le fond suit un peu la camera
    o += `<g transform="translate(${f1(bdx)} ${f1(bdy)})"><g${blur(1)}>`;
    if (bgInfo) {
      const pl = placement(bb, bgInfo.w || 16, bgInfo.h || 9, pan.view), vf = vecFrame(bgInfo, again);
      if (vf) { const st = inkStroke(pan.bglw); o += `<g transform="translate(${f1(pl.x)} ${f1(pl.y)}) scale(${f3(pl.w / vf.w)} ${f3(pl.h / vf.h)})"><path d="${vf.body}" fill="#fff"/><path d="${vf.ink}" fill="#111" fill-rule="evenodd" stroke="${st.color}" stroke-width="${st.width}"/></g>`; }
      else o += `<image href="${bgInfo.url}" x="${f1(pl.x)}" y="${f1(pl.y)}" width="${f1(pl.w)}" height="${f1(pl.h)}" preserveAspectRatio="none"/>`;
    }
    o += "</g>" + (drawBg ? `<g${blur(0.9)}>${drawBg}</g>` : "") + "</g>";
    pan.layers.forEach((l, li) => {
      const s = stateOf(l, t), it = itemOf(l), sp = it && sprite(it, s.v, s.f);
      if (!sp) return;
      // parallaxe : quand la camera se deplace, le premier plan glisse plus que le fond (profondeur 0 = devant, 1 = fond)
      const par = anim.parallax ? (anim.pstr ?? 0.4) * (depthOf(pan, li) - 0.5) : 0, bl = blur(depthOf(pan, li));
      const box = layerBox(bb, Object.assign({}, l, s, { x: s.x + (c.cx - 0.5) * par, y: s.y + (c.cy - 0.5) * par }), sp), vf = vecFrame(sp, again);
      const flip = l.flip ? `translate(${f1(2 * box.cx)} 0) scale(-1 1) ` : "";
      const gsd = groundShadow(l, box);                    // ombre portee : sous l'element
      if (gsd) o += `<ellipse cx="${f1(gsd.cx)}" cy="${f1(gsd.cy)}" rx="${f1(gsd.rx)}" ry="${f1(gsd.ry)}" fill="#000" opacity="${f3(gsd.a)}" style="pointer-events:none"${blur(depthOf(pan, li), gsd.blur)}/>`;
      if (vf) {
        const sc = Math.min(box.w / vf.w, box.h / vf.h), tx = box.x + (box.w - vf.w * sc) / 2, ty = box.y + box.h - vf.h * sc, st = inkStroke(s.lw);
        const shd = shadeOf(l.sh && l.sh.on ? Object.assign({}, l.sh, { g: s.shg, w: s.shw, a: s.sha }) : null, vf.h);
        let inner = "";
        if (shd) shadeShapes(l.sh, vf).forEach((pd, i) => { inner += `<clipPath id="${pre}s-${l.id}-${i}"><path d="${pd}"/></clipPath><g clip-path="url(#${pre}s-${l.id}-${i})"><path d="${pd}" fill="${shd.fill}"/><path d="${pd}" fill="#fff" transform="translate(${f1(l.flip ? -shd.dx : shd.dx)} ${f1(shd.dy)})"/></g>`; });
        o += `<g${bl}><g data-layer="${l.id}" transform="${flip}translate(${f1(tx)} ${f1(ty)}) scale(${f3(sc)})"><clipPath id="${pre}c-${l.id}"><path d="${vf.body}"/></clipPath><path d="${vf.body}" fill="#fff" data-layer="${l.id}"/>` +
          `<g clip-path="url(#${pre}c-${l.id})" style="pointer-events:none">${inner}<path d="${vf.ink}" fill="#111" fill-rule="evenodd" stroke="${st.color}" stroke-width="${st.width}" stroke-linejoin="round"/></g></g></g>`;
      } else o += `<image${bl} data-layer="${l.id}" href="${sp.url}" x="${f1(box.x)}" y="${f1(box.y)}" width="${f1(box.w)}" height="${f1(box.h)}" preserveAspectRatio="xMidYMax meet"${flip ? ` transform="${flip}"` : ""}/>`;
      if (sel === l.id) o += `<rect x="${f1(box.x)}" y="${f1(box.y)}" width="${f1(box.w)}" height="${f1(box.h)}" class="mt-sel"/>`;
    });
    return o + `</g></g><defs>${Object.values(blurs).join("")}</defs><rect width="${W}" height="${f1(H)}" class="mt-frame"/>`;
  }
  return { H, anim, markup, stateOf, camAt, nOf, itemOf, keysOf };
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
  svg.setAttribute("viewBox", `0 0 ${W} ${f1(H)}`); svg.setAttribute("class", "mt-stage");
  const scene = makeScene(app, pg, pan, g.bbox.h / g.bbox.w);
  const layerOf = (id) => pan.layers.find((l) => l.id === id);
  const itemOf = scene.itemOf, nOf = scene.nOf;
  const keysOf = (id) => anim.tracks[id] || [];
  const stateOf = (l) => scene.stateOf(l, t);
  const KEYED = ["x", "y", "s", "f", "v", "lw", "shg", "shw", "sha"];
  const camAt = () => scene.camAt(t);
  const CAMS = { cam: "Caméra", fo: "Mise au point", bl: "Flou" };      // pistes de la camera ; fo et bl : profondeur de champ

  // ------------------------------------------------------------------------------------------ visionneuse
  function paint() { svg.innerHTML = depthView ? topView() : scene.markup(t, playing ? null : sel, paint); }

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
  function topView() {
    const c = camAt(), yOf = (d) => H * (DY0 + (DY1 - DY0) * d), fs = Math.max(11, H * 0.03), camY = H * 0.93, camX = c.cx * W, half = 0.5 / c.z * W;
    let o = `<rect width="${W}" height="${f1(H)}" fill="#f3f1ec"/>`;
    o += `<polygon points="${f1(camX)},${f1(camY)} ${f1(camX - half)},${f1(yOf(1))} ${f1(camX + half)},${f1(yOf(1))}" fill="#3b82f6" fill-opacity="0.09" stroke="#3b82f6" stroke-opacity="0.5" stroke-dasharray="6 5"/>`;
    for (const d of [0, 0.25, 0.5, 0.75, 1])
      o += `<line x1="0" x2="${W}" y1="${f1(yOf(d))}" y2="${f1(yOf(d))}" stroke="#b9b4a8" stroke-width="1" stroke-dasharray="${d === 0 || d === 1 ? "none" : "3 6"}"/>` +
        `<text x="6" y="${f1(yOf(d) - 4)}" font-size="${f1(fs * 0.75)}" fill="#8a8578">${d === 0 ? "Devant · 0" : d === 1 ? "Fond · 1" : d}</text>`;
    o += `<rect x="0" y="${f1(yOf(1) - H * 0.035)}" width="${W}" height="${f1(H * 0.035)}" fill="#cfcabd"/>` +
      `<text x="${W / 2}" y="${f1(yOf(1) - H * 0.045)}" font-size="${f1(fs * 0.8)}" fill="#8a8578" text-anchor="middle">DÉCOR</text>`;
    if (dof.on) o += `<line x1="0" x2="${W}" y1="${f1(yOf(c.fo))}" y2="${f1(yOf(c.fo))}" stroke="#16a34a" stroke-width="2.5"/>` +
      `<text x="${W - 6}" y="${f1(yOf(c.fo) - 5)}" font-size="${f1(fs * 0.75)}" fill="#16a34a" text-anchor="end">MISE AU POINT · ${c.fo.toFixed(2)}</text>`;
    const th = H * 0.03;
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
      `<text y="${f1(fs * 1.75)}" font-size="${f1(fs * 0.8)}" fill="#5b6472" text-anchor="middle">CAMÉRA</text></g>`;
    return o + `<rect width="${W}" height="${f1(H)}" class="mt-frame"/>`;
  }

  // ------------------------------------------------------------------------------------------ cles
  const near = (id) => keysOf(id).find((k) => Math.abs(k.t - t) < 0.04);
  function setKey(id, patch) {                             // pose ou met a jour la cle de la piste a l'instant courant
    const keys = anim.tracks[id] || (anim.tracks[id] = []);
    let k = near(id);
    if (!k) {
      const l = layerOf(id), full = CAMS[id] ? camAt() : stateOf(l);
      const base = id === "cam" ? { cx: full.cx, cy: full.cy, z: full.z, rot: full.rot } : CAMS[id] ? { [id]: full[id] } : Object.fromEntries(KEYED.map((q) => [q, full[q]]));
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
    else if (id !== "cam") Object.assign(layerOf(id), patch);
    else setKey(id, patch);
    if (CAMS[id] && CAMS[sel] && sel !== id) { sel = id; keyBar(); }      // camera, mise au point, flou : la piste reglee devient la piste choisie
    paint(); lanes(); syncProps();
  }

  // ------------------------------------------------------------------------------------------ reglages (droite)
  const side = h("div.mt-side");
  let syncProps = () => {};
  const folds = { sh: true, gs: true };                    // depliants ouverts ou fermes
  function props() {
    side.textContent = "";
    const isCam = !!CAMS[sel], l = isCam ? null : layerOf(sel);
    if (!isCam && !l) { sel = "cam"; return props(); }
    const cur = () => (isCam ? camAt() : stateOf(l));
    const rows = [];
    const range = (label, k, min, max, step, fmt = (x) => (+x).toFixed(2), track = isCam ? "cam" : sel) => {
      const inp = h("input", { type: "range", min, max, step, value: cur()[k], on: { input: (e) => change(track, { [k]: +e.target.value }) } }), out = h("output", fmt(cur()[k]));
      rows.push(() => { const v = cur()[k]; if (document.activeElement !== inp) inp.value = v; out.textContent = fmt(v); });
      return h("label.row.range", label, inp, out);
    };
    const fold = (key, label, ...rows) => h("details.fold", { open: !!folds[key], on: { toggle: (e) => { folds[key] = e.target.open; } } }, h("summary", label), ...rows);
    side.append(h("h4", isCam ? "🎥 Caméra" : (itemOf(l) ? itemOf(l).name : "Élément")));
    if (isCam) {
      side.append(range("Cadre ↔", "cx", -0.5, 1.5, 0.005), range("Cadre ↕", "cy", -0.5, 1.5, 0.005), range("Zoom", "z", 0.4, 5, 0.01), range("Inclinaison", "rot", -45, 45, 0.5, (x) => Math.round(x) + "°"),
        h("h4", { title: "Un mouvement prêt pose deux clés, au début et à la fin. Tu peux ensuite les régler ou en ajouter." }, "Mouvements prêts ⓘ"),
        h("select", { on: { change: (e) => { applyMove(e.target.value); e.target.value = ""; } } }, h("option", { value: "" }, "Choisir un mouvement…"), Object.entries(MOVES).map(([k, [name]]) => h("option", { value: k }, name))),
        h("h4", { title: "0 = tout devant, 1 = le décor. Quand le flou est coché, la mise au point et le flou ont chacun leur piste dans la timeline, avec leurs propres clés : la mise au point peut passer d'un personnage à l'autre. La vue « Profondeur » montre le plan net." }, "Profondeur de champ ⓘ"),
        h("label.row.check", h("input", { type: "checkbox", checked: !!dof.on, on: { change: (e) => { dof.on = e.target.checked; if (!dof.on && (sel === "fo" || sel === "bl")) sel = "cam"; paint(); lanes(); props(); } } }), "Flou de profondeur"));
      if (dof.on) side.append(range("Mise au point", "fo", 0, 1, 0.01, undefined, "fo"), range("Flou", "bl", 0, 60, 1, (x) => String(Math.round(x)), "bl"));
      side.append(
        h("h4", { title: "Quand la caméra se déplace, le premier plan glisse plus vite que le fond, selon la profondeur des éléments : le bouton « Profondeur » sous l'image les montre vus de dessus pour les placer." }, "Parallaxe ⓘ"),
        h("label.row.check", h("input", { type: "checkbox", checked: !!anim.parallax, on: { change: (e) => { anim.parallax = e.target.checked; paint(); props(); } } }), "Parallaxe automatique"),
        anim.parallax ? h("label.row.range", "Force", h("input", { type: "range", min: 0, max: 1.5, step: 0.01, value: anim.pstr ?? 0.4, on: { input: (e) => { anim.pstr = +e.target.value; e.target.nextSibling.textContent = (+e.target.value).toFixed(2); paint(); } } }), h("output", (anim.pstr ?? 0.4).toFixed(2))) : "");
    } else {
      const it = itemOf(l), n = nOf(l, cur().v);
      side.append(range("Position ↔", "x", -1, 2, 0.005), range("Position ↕", "y", -1, 3, 0.005), range("Taille", "s", 0.05, 6, 0.01));
      if (n) side.append(range("Axe (rotation)", "f", 0, n - 1, 1, (x) => Math.round(x * 360 / n) + "°"));
      {
        const inp = h("input", { type: "range", min: 0, max: 1, step: 0.01, value: depthNow(l), on: { input: (e) => { setDepth(l, +e.target.value); paint(); lanes(); syncProps(); } } }), out = h("output", depthNow(l).toFixed(2));
        rows.push(() => { const v = depthNow(l); if (document.activeElement !== inp) inp.value = v; out.textContent = v.toFixed(2); });
        side.append(h("label.row.range", { title: "0 = tout devant, 1 = au fond. Sert à la parallaxe, au flou de profondeur et à l'ordre des éléments." }, "Profondeur", inp, out));
      }
      if (sprite(it, cur().v, cur().f)?.vec) {
        side.append(range("Trait", "lw", -2, 6, 0.1, (x) => (+x).toFixed(1)));
        const sh = l.sh || {};
        side.append(h("label.row.check", h("input", { type: "checkbox", checked: !!sh.on, on: { change: (e) => { l.sh = Object.assign({ on: true, g: 0.72, w: 5, a: 135, k: 0 }, l.sh, { on: e.target.checked }); paint(); props(); } } }), "Ombre"));
        if (sh.on) side.append(fold("sh", "Réglages de l'ombre", range("Gris", "shg", 0.2, 0.95, 0.01), range("Largeur", "shw", 0.5, 25, 0.1, (x) => (+x).toFixed(1)), range("Lumière (angle)", "sha", 0, 360, 1, (x) => Math.round(x) + "°"),
          h("label.row.range", { title: "0 : ombre sur la silhouette seule. Monter ajoute une ombre aux plus grandes formes du dessin, une par cran." }, "Formes détaillées ⓘ", h("input", { type: "range", min: 0, max: 8, step: 1, value: sh.k || 0, on: { input: (e) => { l.sh.k = +e.target.value; e.target.nextSibling.textContent = e.target.value; paint(); } } }), h("output", String(sh.k || 0)))));
      }
      {
        const gs = l.gs || {}, putg = (k, x) => { l.gs = Object.assign({ on: true, a: 0.35, w: 0.8 }, l.gs, { [k]: x }); paint(); };
        const plain = (label, k, min, max, def) => { const out = h("output", (gs[k] ?? def).toFixed(2)); return h("label.row.range", label, h("input", { type: "range", min, max, step: 0.01, value: gs[k] ?? def, on: { input: (e) => { putg(k, +e.target.value); out.textContent = (+e.target.value).toFixed(2); } } }), out); };
        side.append(h("label.row.check", { title: "Une tache sombre et floue sous l'élément, pour le poser au sol" }, h("input", { type: "checkbox", checked: !!gs.on, on: { change: (e) => { putg("on", e.target.checked); props(); } } }), "Ombre portée"));
        if (gs.on) side.append(fold("gs", "Réglages de l'ombre portée", plain("Force", "a", 0.05, 0.9, 0.35), plain("Largeur", "w", 0.2, 2.5, 0.8)));
      }
      const move = (d) => { const i = pan.layers.indexOf(l), j = d === "top" ? pan.layers.length - 1 : d === "bottom" ? 0 : i + d; if (j < 0 || j >= pan.layers.length || j === i) return;
        const has = pan.layers.some((x) => x.d != null);       // profondeurs reglees : elles restent rangees dans l'ordre
        if (has) fixDepths();
        const ds = pan.layers.map((x) => x.d).sort((a, b) => b - a);
        pan.layers.splice(i, 1); pan.layers.splice(j, 0, l);
        if (has) pan.layers.forEach((x, q) => { x.d = ds[q]; });
        paint(); lanes(); props(); };
      side.append(h("h4", "Ordre"), h("div.row.wrap", h("button.mini", { on: { click: () => move(1) } }, "Avancer"), h("button.mini", { on: { click: () => move(-1) } }, "Reculer"),
        h("button.mini", { on: { click: () => move("top") } }, "Premier plan"), h("button.mini", { on: { click: () => move("bottom") } }, "Arrière-plan")));
      if (it && Object.keys(it.variants).length > 1) side.append(h("label.row", "Pose", h("select", { on: { change: (e) => { const vv = variantOf(it, e.target.value); preload(it, e.target.value); change(sel, { v: e.target.value, f: vv && vv.orbit ? Math.min(cur().f, vv.orbit.n - 1) : 0 }); props(); } } },
        Object.entries(it.variants).map(([k, vv]) => h("option", { value: k, selected: k === cur().v }, (vv.orbit ? "↻ " : "▫ ") + vv.label)))));
    }
    keyBar();
    side.append(h("label.row.check", { title: "Dans l'image : glisser un élément le déplace, molette = taille, Maj + glisser = le faire tourner. En vue « Profondeur » : glisser une carte vers le haut l'éloigne, vers le bas la rapproche. Avec la clé automatique, chaque geste pose une clé à l'instant affiché." }, h("input", { type: "checkbox", checked: auto, on: { change: (e) => { auto = e.target.checked; } } }), "Clé automatique à chaque réglage ⓘ"));
    syncProps = () => rows.forEach((f) => f());
  }
  // boutons de cle : juste au-dessus de la timeline
  const keyBox = h("div.mt-keys");
  function keyBar() {
    keyBox.textContent = "";
    const k = near(sel), name = CAMS[sel] || (itemOf(layerOf(sel)) || {}).name || "élément";
    keyBox.append(h("span.muted", name + " :"),
      h("button.mini", { title: "Enregistre les réglages de cet instant", on: { click: () => { setKey(sel, {}); paint(); lanes(); props(); } } }, "◆ Poser une clé"),
      h("button.mini.danger", { disabled: !k, title: "Retire la clé sous la tête de lecture", on: { click: () => { anim.tracks[sel] = keysOf(sel).filter((x) => x !== k); selKey = null; paint(); lanes(); props(); } } }, "Retirer cette clé"),
      h("button.mini.danger", { disabled: !keysOf(sel).length, on: { click: () => { delete anim.tracks[sel]; selKey = null; paint(); lanes(); props(); } } }, "Vider la piste"),
      k ? h("label.row", "Interpolation", h("select", { title: "Façon d'arriver sur cette clé", on: { change: (e) => { k.e = e.target.value; paint(); lanes(); } } }, Object.entries(EASES).map(([v, n]) => h("option", { value: v, selected: (k.e || "doux") === v }, n)))) : "");
  }
  function keyMenu(e, id, k) {                              // clic droit sur une cle : son interpolation
    e.preventDefault();
    document.querySelector(".mt-menu")?.remove();
    const box = h("div.menu.mt-menu", h("div.mhead", `Clé à ${k.t.toFixed(2)} s · arrivée`),
      Object.entries(EASES).map(([v, n]) => h("button" + ((k.e || "doux") === v ? ".on" : ""), { on: { click: () => { k.e = v; box.remove(); paint(); lanes(); props(); } } }, ((k.e || "doux") === v ? "✓ " : "") + n)),
      h("button.danger", { on: { click: () => { anim.tracks[id] = keysOf(id).filter((x) => x !== k); selKey = null; box.remove(); paint(); lanes(); props(); } } }, "Retirer cette clé"));
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

  // ------------------------------------------------------------------------------------------ timeline (bas)
  const tl = h("div.mt-timeline"), clock = h("span.mt-clock");
  const pct = (x) => (x / anim.dur * 100).toFixed(3) + "%";
  function lanes() {
    tl.textContent = "";
    const ticks = []; for (let s = 0; s <= anim.dur + 1e-6; s += anim.dur > 8 ? 1 : 0.5) ticks.push(s);
    const ruler = h("div.mt-lane.ruler", { "data-lane": "ruler" }, ticks.map((s) => h("span.tick", { style: `left:${pct(s)}` }, Number.isInteger(s) ? s + " s" : "")));
    tl.append(h("div.mt-row", h("div.mt-name", ""), ruler));
    const row = (id, name, ico) => {
      const lane = h("div.mt-lane", { "data-lane": id }, keysOf(id).map((k) => { const d = h("span.key" + (k === selKey || picked.has(k) ? ".on" : "") + "." + (k.e || "doux"), { style: `left:${pct(k.t)}`, title: `${k.t.toFixed(2)} s · ${EASES[k.e || "doux"]} (clic droit pour changer)` }); d.__key = k; d.dataset.key = id; return d; }));
      tl.append(h("div.mt-row" + (sel === id ? ".on" : ""), h("div.mt-name", { on: { click: () => { sel = id; selKey = null; paint(); lanes(); props(); } } }, ico, " ", name, keysOf(id).length ? h("span.count", String(keysOf(id).length)) : ""), lane));
    };
    row("cam", "Caméra", "🎥");
    if (dof.on) { row("fo", "Mise au point", "◎"); row("bl", "Flou", "◌"); }
    for (const l of [...pan.layers].reverse()) row(l.id, itemOf(l) ? itemOf(l).name : "élément", "●");
    tl.append(h("div.mt-head", { style: `left:calc(var(--mt-name) + (100% - var(--mt-name)) * ${t / anim.dur})` }));
    clock.textContent = `${t.toFixed(2)} s / ${anim.dur.toFixed(1)} s`;
  }
  const head = () => { const hd = tl.querySelector(".mt-head"); if (hd) hd.style.left = `calc(var(--mt-name) + (100% - var(--mt-name)) * ${t / anim.dur})`; clock.textContent = `${t.toFixed(2)} s / ${anim.dur.toFixed(1)} s`; };
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
    const lane = e.target.closest(".mt-lane");
    if (!lane || e.button !== 0) return;
    stop();
    try { tl.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
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
  const ptOf = (e) => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  let vdrag = null;
  svg.addEventListener("pointerdown", (e) => {
    stop();
    const id = e.target.dataset.layer || (e.target.closest("[data-layer]") || {}).dataset?.layer;
    sel = id || "cam"; selKey = null;
    const p = ptOf(e), c = camAt();
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
    if (id) { const s = stateOf(layerOf(id)); vdrag = { id, p, s, turn: e.shiftKey, sx: e.clientX, z: depthView ? 1 : c.z, d: depthNow(layerOf(id)) }; }
    else vdrag = { id: "cam", p, c };                      // dans le vide : on deplace le cadre de la camera
    paint(); lanes(); props();
  });
  svg.addEventListener("pointermove", (e) => {
    if (!vdrag) return;
    const p = ptOf(e), dx = p[0] - vdrag.p[0], dy = p[1] - vdrag.p[1];
    if (depthView && vdrag.id === "cam") change("cam", { cx: f3(vdrag.c.cx + dx) });
    else if (depthView && !vdrag.turn) { setDepth(layerOf(vdrag.id), vdrag.d - dy / (DY0 - DY1)); change(vdrag.id, { x: f3(vdrag.s.x + dx) }); }
    else if (vdrag.id === "cam") change("cam", { cx: f3(vdrag.c.cx - dx / vdrag.c.z), cy: f3(vdrag.c.cy - dy / vdrag.c.z) });
    else if (vdrag.turn) { const n = nOf(layerOf(vdrag.id), vdrag.s.v); if (n) change(vdrag.id, { f: (((vdrag.s.f + Math.round((e.clientX - vdrag.sx) / 6)) % n) + n) % n }); }
    else change(vdrag.id, { x: f3(vdrag.s.x + dx / vdrag.z), y: f3(vdrag.s.y + dy / vdrag.z) });
  });
  svg.addEventListener("pointerup", () => { vdrag = null; });
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const k = Math.exp(-e.deltaY * 0.0015);
    if (sel === "cam") change("cam", { z: f3(clamp(camAt().z * k, 0.4, 5)) });
    else if (layerOf(sel)) change(sel, { s: f3(clamp(stateOf(layerOf(sel)).s * k, 0.05, 6)) });
  }, { passive: false });

  // ------------------------------------------------------------------------------------------ lecture
  const playBtn = h("button.mini.mt-play", { on: { click: () => (playing ? stop() : play()) } }, "▶ Lecture");
  function tick(now) {
    if (!playing) return;
    t += (now - last) / 1000; last = now;
    if (t >= anim.dur) { if (loop) t = 0; else { t = anim.dur; paint(); head(); return stop(); } }
    paint(); head();
    raf = requestAnimationFrame(tick);
  }
  function play() { if (t >= anim.dur - 0.01) t = 0; playing = true; playBtn.textContent = "⏸ Pause"; last = performance.now(); raf = requestAnimationFrame(tick); }
  function stop() { if (!playing) return; playing = false; cancelAnimationFrame(raf); playBtn.textContent = "▶ Lecture"; paint(); lanes(); props(); }
  // Ctrl+Z / Ctrl+Y : les 5 dernieres actions (elements, cles, camera, profondeur de champ)
  const hist = history(() => ({ layers: pan.layers, anim, dof }), (st) => {
    pan.layers = st.layers;
    for (const k of Object.keys(anim)) delete anim[k];
    Object.assign(anim, st.anim);
    Object.assign(dof, st.dof);
    selKey = null; drag = null; vdrag = null; picked.clear(); t = Math.min(t, anim.dur);
    if (!CAMS[sel] && !layerOf(sel)) sel = "cam";
    dur.value = anim.dur;
    paint(); lanes(); props();
  });
  const key = (e) => {
    if (hist.keydown(e)) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === " ") { e.preventDefault(); e.stopPropagation(); return playing ? stop() : play(); }
    if ((e.key === "Delete" || e.key === "Backspace") && picked.size) {
      e.preventDefault(); e.stopPropagation();
      for (const id of Object.keys(anim.tracks)) anim.tracks[id] = anim.tracks[id].filter((x) => !picked.has(x));
      picked.clear(); selKey = null; paint(); lanes(); props(); return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selKey) { e.preventDefault(); e.stopPropagation(); anim.tracks[sel] = keysOf(sel).filter((x) => x !== selKey); selKey = null; paint(); lanes(); props(); }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); seek(t + (e.key === "ArrowRight" ? 1 : -1) / 24, true); }
  };
  document.addEventListener("keydown", key, true);
  const done = () => { playing = false; cancelAnimationFrame(raf); document.removeEventListener("keydown", key, true); };

  const dur = h("input", { type: "number", min: 0.5, max: 60, step: 0.5, value: anim.dur, title: "Durée du plan, en secondes",
    on: { change: (e) => { const d = clamp(+e.target.value || 4, 0.5, 60), k = d / anim.dur; if (confirm("Étirer aussi les clés sur la nouvelle durée ?\nAnnuler : les clés gardent leur instant.")) for (const ks of Object.values(anim.tracks)) for (const x of ks) x.t = f3(x.t * k); anim.dur = d; t = Math.min(t, d); paint(); lanes(); props(); } } });
  const fullBtn = h("button.mini", { title: "La fenêtre de montage prend tout l'écran", on: { click: () => { const on = m.box.classList.toggle("modal-full"); fullBtn.textContent = on ? "🗗 Fenêtre" : "⛶ Plein écran"; } } }, "⛶ Plein écran");
  const depthBtn = h("button.mini", { title: "Schéma vu de dessus : chaque élément est une carte, à glisser vers le fond ou vers la caméra",
    on: { click: () => { depthView = !depthView; depthBtn.textContent = depthView ? "🖼 Image" : "⬒ Profondeur"; depthBtn.classList.toggle("on", depthView); paint(); } } }, "⬒ Profondeur");
  const save = () => {
    done();
    const real = pg.panels[pid] || (pg.panels[pid] = {});
    real.layers = pan.layers;
    real.dof = dof;
    for (const id of Object.keys(anim.tracks)) if (!anim.tracks[id].length) delete anim.tracks[id];
    real.anim = anim;
    app.commit("montage"); app.editor.render(); app.refreshInspector();
  };
  const bar = h("div.mt-bar", h("button.mini", { title: "Revenir au début", on: { click: () => { stop(); seek(0, true); } } }, "⏮"), playBtn,
    h("label.row.check", h("input", { type: "checkbox", checked: loop, on: { change: (e) => { loop = e.target.checked; } } }), "En boucle"), clock,
    h("span.muted", { title: "Dans une piste : glisser trace un lasso qui prend les clés, Ctrl + clic en ajoute une. Les clés prises se déplacent ensemble et s'effacent avec Suppr. La règle des secondes déplace la tête de lecture." }, "Maj : aimant sur les clés · glisser : lasso ⓘ"),
    h("span.spacer"), depthBtn, h("label.row", "Durée (s)", dur), fullBtn);
  paint(); lanes(); props();
  const m = modal(`Montage · case ${g.order}`, h("div.mt-editor", h("div.mt-top", h("div.mt-view", svg), side), bar, keyBox, tl),
    [{ label: "Annuler", click: done },
     { label: "Enregistrer le montage", click: () => { save(); toast("Montage enregistré."); } },
     { label: "Enregistrer et envoyer dans le deck ▸", primary: true, click: () => { save(); app.sendToDeck(pid); } }]);
  m.box.classList.add("modal-wide", "modal-montage");
  hist.watch(m.box);
  return m;
}
