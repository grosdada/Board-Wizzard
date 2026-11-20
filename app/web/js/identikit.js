// Portrait-robot, a la maniere des coffrets de la police : un visage se monte en superposant des elements dessines
// (forme du visage, cheveux, yeux, sourcils, nez, bouche, oreilles, moustache, barbe, lunettes, signes, couvre-chef).
// Les elements viennent de la banque d'elements (data/parts, /api/parts) ; on peut en dessiner de nouveaux dans l'atelier.
// Le visage monte part dans la banque comme une image a part entiere ; sa composition (item.identikit = { v, layers, off,
// body }) y est gardee pour le rouvrir ici (« Editer dans le portrait-robot » sur sa fiche).
import { tt, tr } from "./i18n.js";
import { h, get, post, del, upload, toast, modal, history, put as apiPut } from "./api.js";
import { openDrawEditor, drawImage } from "./draw.js";

const S = 1000;                                  // cote de la feuille, en unites
// place et taille de depart d'une categorie (centre x, y ; largeur), quand l'element n'a pas la sienne ("place" de /api/parts)
const PLACE = { oreilles: [500, 500, 700], visage: [500, 540, 560], barbe: [500, 740, 400], bouche: [500, 670, 210], moustache: [500, 625, 230],
                nez: [500, 545, 130], yeux: [500, 445, 300], sourcils: [500, 385, 320], signes: [640, 560, 90], lunettes: [500, 445, 350],
                cheveux: [500, 330, 620], "couvre-chef": [500, 220, 560] };
// ordre d'empilement, du dessous vers le dessus : les oreilles restent sous la forme du visage
const ORDER = ["oreilles", "visage", "barbe", "bouche", "moustache", "nez", "yeux", "sourcils", "signes", "lunettes", "cheveux", "couvre-chef"];
const MANY = new Set(["signes"]);                // categories ou l'on peut poser plusieurs elements
const ratios = new Map();                        // fichier -> hauteur / largeur
const ratioOf = (file, t) => new Promise((ok) => {
  const key = file + "?t=" + (t || 0);                 // un element refait garde son nom : la version fait la difference
  if (ratios.has(key)) return ok(ratios.get(key));
  const im = new Image(); im.onload = () => { ratios.set(key, im.naturalHeight / im.naturalWidth); ok(ratios.get(key)); }; im.onerror = () => ok(1); im.src = "/parts/" + key;
});
const url = (l) => `/parts/${l.file}?t=${l.t || 0}`;
// elements dessines en paire (deux yeux sur une image) : separables en deux moities reglables chacune
const SPLIT = new Set(["yeux", "sourcils", "moustache", "lunettes"]);
// cadre d'un calque : une moitie (half « l » ou « r » : moitie gauche ou droite de l'image) n'a que la moitie de la largeur
const boxW = (l) => l.w * l.kx * (l.half ? 0.5 : 1), boxH = (l) => l.w * l.r * l.ky;
// ou poser l'image entiere pour que la moitie montree soit centree sur le calque (le reste est coupe)
const imgX = (l) => { const W = l.w * l.kx; return l.half === "l" ? -W / 4 : l.half === "r" ? -3 * W / 4 : -W / 2; };
// masque au-dessus d'une coupe (ou d'un couvre-chef) : "cap" = hauteur du dessus de la coupe (part de la hauteur de
// l'image, 0 = haut) a 48 abscisses regulieres. Rend des polygones, dans le repere de l'element, du ciel jusqu'au profil.
function capPolys(l) {
  const cap = l.cap;
  if (!Array.isArray(cap) || !cap.length) return [];
  const n = cap.length, v = cap.slice(), w = l.w * l.kx, hh = l.w * l.r * l.ky, TOP = -4 * S;
  for (let i = 0; i < n; i++) if (v[i] == null) {           // trou entre deux colonnes connues : on interpole ; un bord sans voisin reste libre
    let a = i - 1, b = i + 1;
    while (a >= 0 && cap[a] == null) a--;
    while (b < n && cap[b] == null) b++;
    if (a >= 0 && b < n) v[i] = cap[a] + (cap[b] - cap[a]) * (i - a) / (b - a);
  }
  const X = (i) => -w / 2 + i / n * w, Y = (y) => -hh / 2 + y * hh, out = [];
  for (let i = 0; i < n; i++) {
    if (v[i] == null) continue;
    let j = i;
    while (j + 1 < n && v[j + 1] != null) j++;
    const pts = [[X(i), TOP], [X(i), Y(v[i])]];
    for (let k = i; k <= j; k++) pts.push([X(k + 0.5), Y(v[k])]);
    pts.push([X(j + 1), Y(v[j])], [X(j + 1), TOP]);
    out.push(pts);
    i = j;
  }
  return out;
}

export async function openIdentikit(bankUI, edit = null) {   // edit : { item } a rouvrir avec sa composition
  let cats;
  try { cats = await get("parts"); } catch (e) { return toast(tt("Banque d'éléments indisponible : ") + e.message, "error"); }
  for (const c of cats) { c.label = tr(c.label); for (const it of c.items) if (!it.mine) it.name = tr(it.name); }   // noms venus du serveur : traduits a l'affichage
  let cur = cats.find((c) => c.key === "visage") || cats[0], layers = [], sel = null, drag = null, uidN = 1;
  const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${S} ${S}`); svg.setAttribute("class", "idk-stage");
  const name = h("input", { type: "text", placeholder: tt("Nom du personnage") });
  const tabs = h("div.idk-tabs"), grid = h("div.idk-grid"), knobs = h("div.idk-knobs"), bricksBox = h("div.idk-bricks");
  let pinned = false, brickSig = "", userSel = false;
  let photo = null;                                  // portrait transpose, montre en fond pour comparer : {url, w, h, M (2 x 3), on, op}
  const BODY = { key: "__corps", label: tt("🧍 Corps"), items: [] };
  let multi = new Set(), moveAll = false, band = null;   // selection de groupe (rectangle, Maj+clic) ; « Deplacer tout » ; rectangle en cours
  let off = { x: 0, y: 0 };                          // decalage de tout le visage (« Deplacer tout ») : les places de depart le suivent
  let bodies = null, bodyPick = null, bodyUrl = null;   // corps choisi pour le personnage entier, et son apercu   // userSel : choisi a la main (clic, brique), pas seulement pose                // pinned : choisi par sa brique, il se deplace meme s'il est recouvert
  const comp0 = edit && edit.item && edit.item.identikit;
  if (comp0 && Array.isArray(comp0.layers)) {        // reedition : la composition gardee dans l'element
    layers = JSON.parse(JSON.stringify(comp0.layers));
    uidN = Math.max(1, ...layers.map((l) => (l.n || 0) + 1));
    off = Object.assign({ x: 0, y: 0 }, comp0.off);
    bodyPick = comp0.body || null;
    name.value = edit.item.name || "";
  }
  const sorted = () => layers.slice().sort((a, b) => ORDER.indexOf(a.cat) - ORDER.indexOf(b.cat) || a.n - b.n);
  const tf = (l) => `translate(${l.x} ${l.y}) rotate(${l.rot}) scale(${l.flip ? -1 : 1} 1)`;
  const paint = () => {
    // chaque coupe (ou couvre-chef) masque, au-dessus de son profil, tout ce qui est pose dessous : le crane ne depasse pas
    let acc = "", defs = "";
    for (const l of sorted()) {
      const polys = capPolys(l);
      if (polys.length && acc) {
        const id = "idkcap" + l.n, B = 4 * S;
        defs += `<mask id="${id}" maskUnits="userSpaceOnUse" x="${-B}" y="${-B}" width="${3 * B}" height="${3 * B}"><rect x="${-B}" y="${-B}" width="${3 * B}" height="${3 * B}" fill="#fff"/>` +
          `<g transform="${tf(l)}">${polys.map((p) => `<polygon points="${p.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" ")}" fill="#000"/>`).join("")}</g></mask>`;
        acc = `<g mask="url(#${id})">${acc}</g>`;
      }
      const W = l.w * l.kx, hh = boxH(l), bw = boxW(l);
      if (l.half) defs += `<clipPath id="idkh${l.n}"><rect x="${-bw / 2}" y="${-hh / 2}" width="${bw}" height="${hh}"/></clipPath>`;
      acc += `<g transform="${tf(l)}" data-n="${l.n}"><image href="${url(l)}" x="${imgX(l)}" y="${-hh / 2}" width="${W}" height="${hh}" preserveAspectRatio="none" data-n="${l.n}"${l.half ? ` clip-path="url(#idkh${l.n})"` : ""}/>` +
        (sel === l.n || multi.has(l.n) ? `<rect x="${-bw / 2}" y="${-hh / 2}" width="${bw}" height="${hh}" fill="none" stroke="#10b5e0" stroke-width="2" stroke-dasharray="8 6" pointer-events="none"/>` : "") + `</g>`;
    }
    const ph = photo && photo.on ? (() => { const M = photo.M; return `<image href="${photo.url}" width="${photo.w}" height="${photo.h}" preserveAspectRatio="none" opacity="${photo.op}" pointer-events="none" transform="matrix(${M[0][0]} ${M[1][0]} ${M[0][1]} ${M[1][1]} ${M[0][2]} ${M[1][2]})"/>`; })() : "";
    const bd = band ? `<rect x="${Math.min(band.x0, band.x1)}" y="${Math.min(band.y0, band.y1)}" width="${Math.abs(band.x1 - band.x0)}" height="${Math.abs(band.y1 - band.y0)}" fill="rgba(16,181,224,0.08)" stroke="#10b5e0" stroke-width="${1.5 * unit()}" stroke-dasharray="6 4" pointer-events="none"/>` : "";
    svg.innerHTML = `<defs>${defs}</defs><rect width="${S}" height="${S}" fill="#fff"/>` + ph + acc + grips() + bd;
    svg.style.cursor = moveAll ? "move" : "";
    bricks();
  };
  // nom d'un calque : sa categorie, ou le cote pour une moitie de paire et pour chaque oreille (cote de l'ecran)
  const HALVES = { yeux: [tt("Œil gauche"), tt("Œil droit")], sourcils: [tt("Sourcil gauche"), tt("Sourcil droit")],
    moustache: [tt("Moustache, côté gauche"), tt("Moustache, côté droit")], lunettes: [tt("Verre gauche"), tt("Verre droit")], oreilles: [tt("Oreille gauche"), tt("Oreille droite")] };
  const nameOf = (l) => {
    const two = HALVES[l.cat];
    if (two && (l.half || (l.cat === "oreilles" && layers.filter((x) => x.cat === "oreilles").length === 2))) {
      const left = l.half ? (l.half === "l") !== !!l.flip : l.x < S / 2;
      return two[left ? 0 : 1];
    }
    return (cats.find((c) => c.key === l.cat) || {}).label || l.cat;
  };
  // separer une paire : deux calques, chacun montre sa moitie, centre au milieu de SA moitie ; rien ne bouge a l'ecran
  const split = (l) => {
    if (!l || l.half || !SPLIT.has(l.cat)) return;
    const W = l.w * l.kx, s = l.flip ? -1 : 1, a = l.rot * Math.PI / 180;
    const at = (lx) => ({ x: l.x + Math.cos(a) * s * lx, y: l.y + Math.sin(a) * s * lx });
    const mk = (half, lx) => Object.assign({}, l, at(lx), { n: uidN++, half, pair: l.n });
    const L = mk("l", -W / 4), R = mk("r", W / 4);
    layers = layers.filter((x) => x !== l).concat([L, R]);
    sel = L.n; userSel = true; paint(); props(); marks(); hist.snap();
  };
  // reunir : la paire entiere revient, a sa place de depart
  const join = (l) => {
    if (!l || !l.half) return;
    const both = layers.filter((x) => x.half && x.pair === l.pair && x.cat === l.cat);
    const f = Object.assign({}, l, { n: uidN++ });
    delete f.half; delete f.pair; home(f);
    layers = layers.filter((x) => !both.includes(x)).concat([f]);
    sel = f.n; userSel = true; paint(); props(); marks(); hist.snap();
  };
  // briques : une par element pose, pour choisir celui qu'un autre recouvre (des sourcils sous une coupe)
  const pickLayer = (l) => { sel = l.n; multi.clear(); pinned = true; userSel = true; const c = cats.find((k) => k.key === l.cat); if (c && c !== cur) { cur = c; showCat(); } paint(); props(); };
  const bricks = () => {
    const sig = sorted().map((l) => l.n + ":" + l.file + ":" + nameOf(l)).join(",") + "|" + sel + "|" + [...multi].join(",");
    if (sig === brickSig) return;
    brickSig = sig; bricksBox.textContent = "";
    if (!layers.length) return;
    bricksBox.append(...sorted().map((l) => {
      const label = nameOf(l);
      return h("div.idk-brick" + (l.n === sel || multi.has(l.n) ? ".on" : ""), { title: tt`${label} · ${l.name} : cliquer pour le choisir, même s'il est caché sous un autre`,
        on: { click: () => pickLayer(l) } },
        h("img", { src: url(l), alt: "", draggable: false }), h("span", label),
        h("i", { title: tt("Retirer du visage"), on: { click: (e) => { e.stopPropagation(); sel = l.n; removeSel(); } } }, "✕"));
    }));
  };
  // poignees autour de l'element choisi : coins = taille, cotes = etirer, rond du haut = tourner ; taille constante a l'ecran
  const unit = () => { const r = svg.getBoundingClientRect(); return r.width ? S / r.width : 2; };
  const grips = () => {
    const l = layers.find((x) => x.n === sel);
    if (!l || multi.size > 1) return "";
    const u = unit(), w = boxW(l) / 2, hh = boxH(l) / 2, g = 5 * u, top = -hh - 26 * u;
    const sq = (k, x, y, cur) => `<rect class="idk-grip" data-h="${k}" x="${x - g}" y="${y - g}" width="${2 * g}" height="${2 * g}" style="cursor:${cur}" stroke-width="${1.5 * u}"/>`;
    return `<g transform="${tf(l)}">` +
      `<line x1="0" y1="${-hh}" x2="0" y2="${top}" stroke="#10b5e0" stroke-width="${1.5 * u}" pointer-events="none"/>` +
      `<circle class="idk-grip" data-h="rot" cx="0" cy="${top}" r="${g * 1.2}" stroke-width="${1.5 * u}" style="cursor:grab"/>` +
      sq("c", -w, -hh, "nwse-resize") + sq("c", w, -hh, "nesw-resize") + sq("c", -w, hh, "nesw-resize") + sq("c", w, hh, "nwse-resize") +
      sq("x", -w, 0, "ew-resize") + sq("x", w, 0, "ew-resize") + sq("y", 0, -hh, "ns-resize") + sq("y", 0, hh, "ns-resize") + `</g>`;
  };
  const local = (l, p) => {                       // point de la feuille -> repere de l'element (sans rotation ni miroir)
    const a = -l.rot * Math.PI / 180, dx = p.x - l.x, dy = p.y - l.y;
    const x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a);
    return { x: l.flip ? -x : x, y };
  };
  const clampK = (v) => Math.min(4, Math.max(0.2, v));
  const sync = () => {                            // les curseurs suivent les poignees, la molette et le clavier
    const l = layers.find((x) => x.n === sel);
    if (!l) return;
    knobs.querySelectorAll("input[data-k]").forEach((i) => { const k = i.dataset.k; i.value = l[k]; i.nextElementSibling.textContent = (+l[k]).toFixed(+i.step < 1 ? 2 : 0); });
  };
  const removeSel = () => { layers = layers.filter((x) => x.n !== sel && !multi.has(x.n)); sel = null; multi.clear(); pinned = false; paint(); props(); marks(); };
  // deplacer ensemble : le groupe choisi, ou tout le visage (alors ses places de depart suivent : off, et la photo)
  const shiftBy = (ls, dx, dy, all) => {
    for (const l of ls) { l.x += dx; l.y += dy; if (all && l.p0) l.p0 = [l.p0[0] + dx, l.p0[1] + dy, l.p0[2]]; }
    if (all) { off = { x: off.x + dx, y: off.y + dy }; if (photo) { photo.M[0][2] += dx; photo.M[1][2] += dy; } }
  };
  // cadre d'un calque dans la feuille (rotation comprise), pour la selection au rectangle
  const aabb = (l) => {
    const a = l.rot * Math.PI / 180, c = Math.abs(Math.cos(a)), s2 = Math.abs(Math.sin(a)), w = boxW(l) / 2, hh = boxH(l) / 2;
    const ex = w * c + hh * s2, ey = w * s2 + hh * c;
    return [l.x - ex, l.y - ey, l.x + ex, l.y + ey];
  };
  const range = (label, key, min, max, step, title) => {
    const l = layers.find((x) => x.n === sel), out = h("output", (+l[key]).toFixed(step < 1 ? 2 : 0));
    return h("label.row.range", { title: title || "" }, label, h("input", { type: "range", min, max, step, value: l[key], "data-k": key, on: { input: (e) => { l[key] = +e.target.value; out.textContent = (+l[key]).toFixed(step < 1 ? 2 : 0); paint(); } } }), out);
  };
  const props = () => {
    knobs.textContent = "";
    if (multi.size > 1) {
      knobs.append(h("b", tt`${multi.size} éléments choisis`), h("p.muted", tt("Tire l'un d'eux pour les déplacer ensemble ; flèches : déplacer (Maj : de dix) ; Suppr : les retirer. Maj+clic : ajouter ou ôter un élément. Clic dans le vide : tout désélectionner.")),
        h("div.row.wrap", h("button.mini.danger", { on: { click: () => { removeSel(); hist.snap(); } } }, tt("Retirer ces éléments"))));
      return;
    }
    const l = layers.find((x) => x.n === sel);
    if (!l) { knobs.append(h("p.muted", tt("Clique un élément dans la liste pour le poser. Sur le visage : glisser pour le déplacer, molette pour sa taille ; poignées des coins = taille, des côtés = étirer, rond du haut = tourner (Maj : crans de 15°). Flèches : déplacer (Maj : de dix). Suppr : retirer. Clic droit : miroir, empilement. Un seul élément par catégorie (sauf les signes) : en choisir un autre le remplace à la même place. Glisser depuis le vide : choisir plusieurs éléments d'un coup ; ✥ en haut à droite : déplacer tout le visage."))); return; }
    knobs.append(h("b", `${nameOf(l)} · ${l.name}`),
      range(tt("Taille"), "w", 30, 950, 1), range(tt("Largeur"), "kx", 0.2, 4, 0.01, tt("Étire ou resserre l'élément en largeur")), range(tt("Hauteur"), "ky", 0.2, 4, 0.01, tt("Étire ou tasse l'élément en hauteur")),
      range(tt("Rotation"), "rot", -180, 180, 1),
      h("div.row.wrap", h("button.mini", { on: { click: () => { l.flip = !l.flip; paint(); } } }, tt("⇋ Miroir")),
        h("button.mini", { title: tt("Remet la taille et la place de départ"), on: { click: () => { home(l); paint(); props(); } } }, tt("↺ Place de départ")),
        h("button.mini", { title: tt("Éditer cet élément dans l'éditeur de dessin"), on: { click: () => editPart(l.cat, itemOf(l)) } }, tt("✏ Éditer")),
        SPLIT.has(l.cat) && !l.half ? h("button.mini", { title: tt("Coupe la paire en deux : chaque côté se place, se règle et se retire séparément (un œil plus haut que l'autre…)"), on: { click: () => split(l) } }, tt("✂ Séparer")) : null,
        l.half ? h("button.mini", { title: tt("Remet la paire entière, à sa place de départ"), on: { click: () => join(l) } }, tt("⧉ Réunir")) : null,
        h("button.mini.danger", { title: tt("Ou touche Suppr"), on: { click: removeSel } }, tt("Retirer du visage"))));
  };
  // remplacer l'element d'un calque par un autre (meme categorie, ou le meme refait) : place du nouveau si le calque n'a
  // pas ete touche, sinon son decalage et son echelle sont gardes
  const swapper = (cat, it, r) => {
    const spot = (twin) => { const p = it.place || PLACE[cat] || [500, 500, 300]; return twin ? [S - p[0] + off.x, p[1] + off.y, p[2]] : [p[0] + off.x, p[1] + off.y, p[2]]; };
    const swapIn = (l) => {
      const p = spot(!!(l.twin && it.pair)), old = l.p0 || PLACE[cat] || [l.x, l.y, l.w];
      const ox = old[0] + halfOff(l, old), nx = p[0] + halfOff(l, p);             // une moitie : par rapport a la place de sa moitie
      if (l.x === ox && l.y === old[1] && l.w === old[2] && l.kx === 1 && l.ky === 1) Object.assign(l, { x: nx, y: p[1], w: p[2] });
      else Object.assign(l, { x: l.x + nx - ox, y: l.y + p[1] - old[1], w: Math.round(l.w * p[2] / old[2]) });   // regle a la main : decalage et echelle gardes
      if (!it.pair && l.twin) l.flip = false;
      Object.assign(l, { id: it.id, name: it.name, file: it.file, t: it.t || 0, cap: it.cap || null, r, p0: p, twin: !!(l.twin && it.pair) });
    };
    return { spot, swapIn };
  };
  // place de depart d'un calque : celle de son element (p0), sinon celle de la categorie ; le jumeau d'une oreille garde son miroir
  const halfOff = (l, p) => (l.half ? (l.half === "l" ? -1 : 1) * p[2] / 4 : 0);      // une moitie se place a un quart de la largeur
  const home = (l) => { const p = l.p0 || (PLACE[l.cat] ? [PLACE[l.cat][0] + off.x, PLACE[l.cat][1] + off.y, PLACE[l.cat][2]] : [500, 500, 300]); Object.assign(l, { x: p[0] + halfOff(l, p), y: p[1], w: p[2], kx: 1, ky: 1, rot: 0, flip: !!l.twin }); };
  const put = async (cat, it, quiet) => {
    const r = await ratioOf(it.file, it.t);
    const { spot, swapIn } = swapper(cat, it, r);
    const fresh = (twin) => { const p = spot(twin); return { n: uidN++, cat, id: it.id, name: it.name, file: it.file, t: it.t || 0, cap: it.cap || null, r,
      x: p[0], y: p[1], w: p[2], kx: 1, ky: 1, rot: 0, flip: twin, twin, p0: p }; };
    let l;
    if (it.pair) {                                  // oreilles : l'image est celle de droite ; deux calques, le jumeau en miroir
      const ears = layers.filter((x) => x.cat === cat), mine = userSel && ears.find((x) => x.n === sel);
      if (!ears.length) { l = fresh(false); layers.push(l, fresh(true)); }
      else if (mine && ears.length > 1) { swapIn(mine); l = mine; }   // une oreille choisie a la main : on ne remplace qu'elle
      else { ears.forEach(swapIn); if (ears.length === 1) layers.push(fresh(!ears[0].twin)); l = ears[0]; }
    } else if (layers.some((x) => x.cat === cat && x.half)) {   // paire separee : les deux moities changent, chacune garde son reglage
      const halves = layers.filter((x) => x.cat === cat && x.half);
      halves.forEach(swapIn); l = halves.find((x) => x.n === sel) || halves[0];
    } else {
      l = MANY.has(cat) ? null : layers.find((x) => x.cat === cat);
      if (cat === "oreilles" && l) layers = layers.filter((x) => x.cat !== cat || x === l);   // une oreille dessinee seule remplace la paire
      if (l) swapIn(l); else { l = fresh(false); layers.push(l); }
    }
    sel = l.n; userSel = false; paint(); props(); marks();
    if (!quiet) hist.snap();
  };
  const marks = () => grid.querySelectorAll("[data-id]").forEach((b) => b.classList.toggle("on", layers.some((l) => l.cat === cur.key && l.id === b.dataset.id)));
  const showCat = () => {
    tabs.textContent = "";
    tabs.append(...cats.map((c) => h("button.mini" + (c === cur ? ".on" : ""), { on: { click: () => { cur = c; showCat(); } } }, c.label, h("span.count", String(c.items.length)))),
      h("button.mini.idk-bodytab" + (cur === BODY ? ".on" : ""), { title: tt("Poser la tête sur un corps : le personnage entier part dans la banque"), on: { click: () => { cur = BODY; showCat(); } } }, BODY.label));
    grid.textContent = "";
    if (cur === BODY) { showBodies(); return; }
    grid.append(...cur.items.map((it) => h("button.idk-el", { "data-id": it.id, title: it.name + (it.mine ? tt(" (dessiné ici)") : ""), on: { click: () => put(cur.key, it) } },
      h("img", { src: `/parts/${it.file}?t=${it.t || 0}`, loading: "lazy", alt: "" }), h("span", it.name),
      h("b.edit", { title: it.mine && it.editable ? tt("Éditer ce dessin (ses formes se rouvrent)") : tt("Éditer : retoucher par-dessus cette image ; donne un nouvel élément, l'original reste"), on: { click: (e) => { e.stopPropagation(); editPart(cur.key, it); } } }, "✏"),
      h("i", { title: tt("Retirer cet élément de la banque (il est mis de côté, pas détruit)"), on: { click: async (e) => {
        e.stopPropagation();
        if (!confirm(tt`Retirer « ${it.name} » de la banque d'éléments ?`)) return;
        try { await del(`parts/${cur.key}/${it.id}`); cur.items = cur.items.filter((x) => x !== it); layers = layers.filter((l) => !(l.cat === cur.key && l.id === it.id)); paint(); props(); showCat(); }
        catch (err) { toast(err.message, "error"); }
      } } }, "✕"))),
      h("button.idk-el.add", { title: tt("Dessiner soi-même un élément de cette catégorie : il s'ajoute à la banque"), on: { click: () => drawOne() } }, h("b", "✏"), h("span", tt("Dessiner…"))));
    if (!cur.items.length) grid.prepend(h("p.muted", tt("Aucun élément dans cette catégorie pour l'instant.")));
    marks();
  };
  const pngOf = async (d, under) => {
    const c = document.createElement("canvas"); c.width = c.height = 768;
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 768, 768);
    if (under) {                                    // l'image retouchee, a sa place, sous le dessin
      const u = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = under.url; });
      if (u) x.drawImage(u, under.x * 768, under.y * 768, under.w * 768, under.h * 768);
    }
    const im = d.shapes.length ? await drawImage(d, 768, 768) : null;
    if (d.shapes.length && !im) return null;
    if (im) x.drawImage(im, 0, 0, 768, 768);
    return new Promise((ok) => c.toBlob(ok, "image/png"));
  };
  const PAIRCATS = ["yeux", "sourcils", "oreilles", "moustache", "lunettes"];
  // editer un element : un dessin de l'atelier se rouvre avec ses formes et se remplace ; un element de la banque (ou un
  // ancien dessin sans formes) s'ouvre en fond dans le cadre et donne un NOUVEL element, l'original reste intact
  const editPart = async (catKey, it) => {
    const cat = cats.find((c) => c.key === catKey);
    if (!cat || !it) return;
    let meta = null;
    if (it.mine && it.editable) { try { meta = await get(`parts/${catKey}/${it.id}`); } catch (e) { meta = null; } }
    const own = !!(meta && Array.isArray(meta.shapes) && meta.shapes.length), pair = !!(it.pair || (meta && meta.pair));
    const r = await ratioOf(it.file, it.t), p = it.place || PLACE[catKey] || [500, 500, 300];
    const under = own ? (meta.under || null) : { url: `/parts/${it.file}?t=${it.t || 0}`, x: (p[0] - p[2] / 2) / S, y: (p[1] - p[2] * r / 2) / S, w: p[2] / S, h: p[2] * r / S };
    openDrawEditor({ draw: { shapes: own ? meta.shapes : [] }, ratio: 1, backdrop: null, under, axis: PAIRCATS.includes(catKey),
      title: tt`Éditer : ${it.name}`, saveLabel: own ? tt("Enregistrer l'élément") : tt("Enregistrer comme nouvel élément"),
      onSave: async (d) => {
        let nm = it.name;
        if (!own) { nm = (prompt(tt("Nom du nouvel élément (l'original reste dans la banque) :"), tt`${it.name} (retouché)`) || "").trim(); if (!nm) return; }
        const blob = await pngOf(d, under);
        if (!blob) return toast(tt("Le dessin n'a pas pu être converti en image."), "error");
        try {
          const q = new URLSearchParams({ name: nm });
          if (own) q.set("replace", it.id);
          const nu = await upload(`parts/${catKey}?${q}`, blob);
          await apiPut(`parts/${catKey}/${nu.id}`, { shapes: d.shapes, under, pair });
          nu.editable = true; nu.pair = pair;
          const i = cat.items.findIndex((x) => x.id === nu.id);
          if (i >= 0) cat.items[i] = nu; else cat.items.push(nu);
          const nr = await ratioOf(nu.file, nu.t), { swapIn } = swapper(catKey, nu, nr);
          layers.filter((l) => l.cat === catKey && l.id === it.id).forEach(swapIn);   // les calques passent a l'element edite
          brickSig = ""; cur = cat; showCat(); paint(); props(); hist.snap();
          toast(own ? tt`« ${nm} » est mis à jour.` : tt`« ${nm} » est ajouté à la banque d'éléments ; l'original n'a pas changé.`);
        } catch (e) { toast(tt("Élément refusé : ") + e.message, "error"); }
      } });
  };
  const itemOf = (l) => (cats.find((c) => c.key === l.cat) || { items: [] }).items.find((x) => x.id === l.id) || { id: l.id, name: l.name, file: l.file, t: l.t, mine: false, place: l.p0 };
  const drawOne = () => {
    const cat = cur;
    openDrawEditor({ draw: null, ratio: 1, backdrop: null, title: tt`Dessiner : ${cat.label}`, saveLabel: tt("Ajouter à la banque d'éléments"),
      axis: ["yeux", "sourcils", "oreilles", "moustache", "lunettes"].includes(cat.key),
      onSave: async (d) => {
        if (!d.shapes.length) return;
        const nm = (prompt(tt("Nom de cet élément :"), cat.label + tt(" dessiné")) || "").trim();
        if (!nm) return;
        const im = await drawImage(d, 768, 768);
        if (!im) return toast(tt("Le dessin n'a pas pu être converti en image."), "error");
        const c = document.createElement("canvas"); c.width = c.height = 768;
        const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 768, 768); x.drawImage(im, 0, 0, 768, 768);
        const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
        try { const it = await upload(`parts/${cat.key}?name=${encodeURIComponent(nm)}`, blob); await apiPut(`parts/${cat.key}/${it.id}`, { shapes: d.shapes, under: null });
          it.editable = true; cat.items.push(it); cur = cat; showCat(); put(cat.key, it); }
        catch (e) { toast(tt("Élément refusé : ") + e.message, "error"); }
      } });
  };
  // souris : glisser un element pose, molette pour sa taille
  const pt = (e) => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * S, y: (e.clientY - r.top) / r.height * S }; };
  svg.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;                     // clic droit : le menu s'en charge
    if (moveAll) {                                  // « Deplacer tout » : le visage entier suit la souris
      if (!layers.length) return;
      svg.setPointerCapture(e.pointerId); drag = { all: true, p: pt(e), done: { x: 0, y: 0 } };
      e.preventDefault(); return;
    }
    const tn = +(e.target.dataset && e.target.dataset.n), tl = layers.find((x) => x.n === tn);
    if (tl && e.shiftKey) {                         // Maj+clic : ajouter ou oter un element du groupe
      if (!multi.size && sel != null) multi.add(sel);
      if (multi.has(tl.n)) multi.delete(tl.n); else multi.add(tl.n);
      sel = null; if (multi.size === 1) { sel = [...multi][0]; multi.clear(); }
      paint(); props(); e.preventDefault(); return;
    }
    if (tl && multi.size > 1 && multi.has(tl.n)) {  // un element du groupe : tout le groupe suit
      svg.setPointerCapture(e.pointerId); drag = { group: layers.filter((x) => multi.has(x.n)), p: pt(e), done: { x: 0, y: 0 } };
      e.preventDefault(); return;
    }
    if (!tl && !(e.target.dataset && e.target.dataset.h)) {   // depuis le vide : rectangle de selection (un simple clic : tout deselectionner)
      const p = pt(e); multi.clear(); sel = null; pinned = false;
      band = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      svg.setPointerCapture(e.pointerId); drag = { band: true };
      paint(); props(); e.preventDefault(); return;
    }
    multi.clear();
    const grip = e.target.dataset && e.target.dataset.h, cl = layers.find((x) => x.n === sel);
    if (grip && cl) {                               // poignee de l'element choisi
      svg.setPointerCapture(e.pointerId);
      drag = { l: cl, grip, p0: local(cl, pt(e)), w: cl.w, kx: cl.kx, ky: cl.ky };
      e.preventDefault(); return;
    }
    if (pinned && cl) {                             // choisi par sa brique : on le prend s'il est sous la souris, meme recouvert
      const q = local(cl, pt(e));
      if (Math.abs(q.x) <= boxW(cl) / 2 && Math.abs(q.y) <= boxH(cl) / 2) {
        svg.setPointerCapture(e.pointerId); const p = pt(e); drag = { l: cl, dx: cl.x - p.x, dy: cl.y - p.y };
        e.preventDefault(); return;
      }
    }
    pinned = false;
    const n = +(e.target.dataset && e.target.dataset.n), l = layers.find((x) => x.n === n);
    sel = l ? l.n : null; userSel = !!l;
    if (l) { svg.setPointerCapture(e.pointerId); const p = pt(e); drag = { l, dx: l.x - p.x, dy: l.y - p.y }; const c = cats.find((k) => k.key === l.cat); if (c && c !== cur) { cur = c; showCat(); } }
    paint(); props(); e.preventDefault();
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = pt(e), l = drag.l;
    if (drag.band) { band.x1 = p.x; band.y1 = p.y; paint(); return; }
    if (drag.all || drag.group) {
      const dx = Math.round(p.x - drag.p.x) - drag.done.x, dy = Math.round(p.y - drag.p.y) - drag.done.y;
      if (dx || dy) { shiftBy(drag.all ? layers : drag.group, dx, dy, !!drag.all); drag.done.x += dx; drag.done.y += dy; paint(); }
      return;
    }
    if (!drag.grip) { l.x = Math.round(p.x + drag.dx); l.y = Math.round(p.y + drag.dy); paint(); return; }
    if (drag.grip === "rot") {
      let a = Math.atan2(p.y - l.y, p.x - l.x) * 180 / Math.PI + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      a = ((Math.round(a) + 540) % 360) - 180; l.rot = a;
    } else {                                        // etirement depuis le centre : la poignee suit la souris
      const q = local(l, p), q0 = drag.p0;
      if (drag.grip === "c") l.w = Math.round(Math.min(950, Math.max(30, drag.w * Math.hypot(q.x, q.y) / Math.max(1, Math.hypot(q0.x, q0.y)))));
      if (drag.grip === "x") l.kx = +clampK(drag.kx * Math.abs(q.x) / Math.max(1, Math.abs(q0.x))).toFixed(2);
      if (drag.grip === "y") l.ky = +clampK(drag.ky * Math.abs(q.y) / Math.max(1, Math.abs(q0.y))).toFixed(2);
    }
    paint(); sync();
  });
  svg.addEventListener("pointerup", () => {         // un glisser fini = une etape
    if (drag && drag.band) {                        // les elements touches par le rectangle
      const x0 = Math.min(band.x0, band.x1), x1 = Math.max(band.x0, band.x1), y0 = Math.min(band.y0, band.y1), y1 = Math.max(band.y0, band.y1);
      band = null; drag = null;
      if (x1 - x0 > 4 || y1 - y0 > 4) {
        const hit = layers.filter((l) => { const b = aabb(l); return b[0] < x1 && b[2] > x0 && b[1] < y1 && b[3] > y0; });
        if (hit.length === 1) { sel = hit[0].n; userSel = true; } else hit.forEach((l) => multi.add(l.n));
      }
      paint(); props(); return;
    }
    if (drag) { drag = null; hist.snap(); }
  });
  svg.addEventListener("wheel", (e) => { const l = layers.find((x) => x.n === sel); if (!l || multi.size > 1) return; e.preventDefault(); l.w = Math.round(Math.min(950, Math.max(30, l.w * (e.deltaY < 0 ? 1.05 : 0.95)))); paint(); sync(); }, { passive: false });
  // clic droit dans le portrait : les gestes de l'element sous la souris (s'il y en a un), puis la liste de tous les
  // elements poses, pour en choisir un sans le chercher dans les briques du bas (meme cache sous un autre)
  svg.addEventListener("contextmenu", (e) => {
    const n = +(e.target.dataset && e.target.dataset.n), l = layers.find((x) => x.n === n) || (e.target.dataset?.h && layers.find((x) => x.n === sel));
    e.preventDefault();
    if (!l && !layers.length) return;
    if (l && (sel !== l.n || multi.size)) { sel = l.n; multi.clear(); paint(); props(); }
    const same = l ? sorted().filter((x) => x.cat === l.cat) : [], i = l ? same.indexOf(l) : -1;
    const swap = (o) => { [l.n, o.n] = [o.n, l.n]; sel = l.n; paint(); props(); };
    const items = !l ? [] : [[tt("⇋ Miroir"), () => { l.flip = !l.flip; paint(); }],
      [tt("↺ Place de départ"), () => { home(l); paint(); props(); }],
      [tt("✏ Éditer"), () => editPart(l.cat, itemOf(l))],
      SPLIT.has(l.cat) && !l.half ? [tt("✂ Séparer"), () => split(l)] : null,
      l.half ? [tt("⧉ Réunir"), () => join(l)] : null,
      i < same.length - 1 ? [tt("▲ Monter d'un cran"), () => swap(same[i + 1])] : null,
      i > 0 ? [tt("▼ Descendre d'un cran"), () => swap(same[i - 1])] : null,
      [tt("✕ Retirer du visage"), removeSel, true]].filter(Boolean);
    document.querySelector(".menu")?.remove();
    const list = sorted().slice().reverse();          // du dessus vers le dessous, comme on les voit
    const box = h("div.menu.mt-menu.idk-ctx", items.map(([label, fn, danger]) => h("button" + (danger ? ".danger" : ""), { on: { click: () => { box.remove(); fn(); hist.snap(); } } }, label)),
      list.length ? h("div.mhead", tt`Éléments du visage (${list.length})`) : "",
      list.length ? h("div.idk-ctx-list", list.map((x) => h("button.idk-ctx-row" + (x.n === sel || multi.has(x.n) ? ".on" : ""), { type: "button", title: tt`${nameOf(x)} · ${x.name} : le choisir, même s'il est caché sous un autre`,
        on: { click: () => { box.remove(); pickLayer(x); } } }, h("img", { src: url(x), alt: "", draggable: false }), h("span", nameOf(x)), h("small.muted", x.name)))) : "");
    document.body.append(box);
    const r = box.getBoundingClientRect();
    box.style.left = Math.max(4, Math.min(e.clientX, innerWidth - r.width - 6)) + "px";
    box.style.top = Math.max(4, Math.min(e.clientY, innerHeight - r.height - 6)) + "px";
    const close = (ev) => { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener("pointerdown", close, true); } };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  });
  // annuler (Ctrl+Z, 15 pas) : ajout, retrait, deplacement, taille, rotation, miroir des elements ; pas la selection
  const hist = history(() => ({ layers, off, pm: photo ? [photo.M[0][2], photo.M[1][2]] : null }), (st) => {
    layers = st.layers; off = st.off || { x: 0, y: 0 };
    if (photo && st.pm) { photo.M[0][2] = st.pm[0]; photo.M[1][2] = st.pm[1]; }
    multi = new Set([...multi].filter((n) => layers.some((l) => l.n === n)));
    if (!layers.some((l) => l.n === sel)) { sel = null; pinned = false; }
    uidN = Math.max(uidN, ...layers.map((l) => l.n + 1)); paint(); props(); marks();
  }, 15);
  // clavier, tant que l'atelier est ouvert : Ctrl+Z / Ctrl+Y annulent, Suppr retire, fleches deplacent
  const onKey = (e) => {
    if (!document.body.contains(svg)) return document.removeEventListener("keydown", onKey);
    const backs = document.querySelectorAll(".modal-back");
    if (backs[backs.length - 1] !== svg.closest(".modal-back")) return;          // une autre fenetre (dessin) est par-dessus
    if (hist.keydown(e)) return;                    // dans un champ de texte, c'est l'annulation du navigateur qui joue
    if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "Escape" && (moveAll || multi.size)) { e.preventDefault(); e.stopPropagation(); moveAll = false; multi.clear(); moveBtn.classList.remove("on"); paint(); props(); return; }
    const l = layers.find((x) => x.n === sel), group = multi.size > 1 ? layers.filter((x) => multi.has(x.n)) : null;
    if (!l && !group) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeSel(); hist.snap(); return; }
    const d = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    if (mv) { e.preventDefault(); shiftBy(group || [l], mv[0], mv[1], false); paint(); hist.snap(); }
  };
  document.addEventListener("keydown", onKey);

  const random = async () => {
    layers = []; sel = null; multi.clear();
    for (const key of ["visage", "oreilles", "yeux", "sourcils", "nez", "bouche", "cheveux"]) {
      const c = cats.find((k) => k.key === key);
      if (c && c.items.length) await put(key, c.items[Math.floor(Math.random() * c.items.length)], true);
    }
    for (const key of ["moustache", "barbe", "lunettes"]) {
      const c = cats.find((k) => k.key === key);
      if (c && c.items.length && Math.random() < 0.3) await put(key, c.items[Math.floor(Math.random() * c.items.length)], true);
    }
    sel = null; paint(); props(); hist.snap();                      // un tirage = une seule etape
  };
  // l'image du visage monte, elements dans l'ordre : wpx x hpx pixels, k = wpx / 1000 ; white : fond blanc (sinon
  // transparent, pour poser la tete sur un corps : cadre 1000 x 1300 de l'atelier, menton en y = 880)
  const render = async (wpx = 1024, hpx = 1024, white = true, type = "image/png") => {
    const k = wpx / S, c = document.createElement("canvas"); c.width = wpx; c.height = hpx;
    const a = document.createElement("canvas"); a.width = wpx; a.height = hpx;     // les calques, sur fond transparent
    const x = a.getContext("2d");
    for (const l of sorted()) {
      const polys = capPolys(l);
      if (polys.length) {                           // comme a l'ecran : la coupe rabote ce qui depasse au-dessus d'elle
        x.save(); x.globalCompositeOperation = "destination-out";
        x.translate(l.x * k, l.y * k); x.rotate(l.rot * Math.PI / 180); x.scale((l.flip ? -1 : 1) * k, k);
        for (const p of polys) { x.beginPath(); p.forEach((q, i) => (i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]))); x.closePath(); x.fill(); }
        x.restore();
      }
      const im = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = url(l); });
      if (!im) continue;
      const W = l.w * l.kx * k, hh = boxH(l) * k, bw = boxW(l) * k;
      x.save(); x.translate(l.x * k, l.y * k); x.rotate(l.rot * Math.PI / 180); x.scale(l.flip ? -1 : 1, 1);
      if (l.half) { x.beginPath(); x.rect(-bw / 2, -hh / 2, bw, hh); x.clip(); }      // une moitie : seulement sa moitie de l'image
      x.drawImage(im, imgX(l) * k, -hh / 2, W, hh); x.restore();
    }
    const out = c.getContext("2d");
    if (white) { out.fillStyle = "#fff"; out.fillRect(0, 0, wpx, hpx); }
    out.drawImage(a, 0, 0);
    return new Promise((ok) => c.toBlob(ok, type, 0.92));
  };
  // ---- corps : la tete posee sur un des corps encres (le serveur compose, comme pour la banque)
  const composeBody = async () => {
    const head = await render(1000, 1300, false);
    const r = await fetch("/api/bodies/compose?body=" + encodeURIComponent(bodyPick), { method: "POST", body: head });
    if (!r.ok) { let msg = tt("erreur ") + r.status; try { msg = tr((await r.json()).error); } catch (e) { /* message par defaut */ } throw new Error(msg); }
    return r.blob();
  };
  const showBodies = async () => {
    grid.textContent = "";
    if (!bodies) { try { bodies = await get("bodies"); } catch (e) { grid.append(h("p.muted", e.message)); return; } }
    if (cur !== BODY) return;
    grid.textContent = "";
    grid.append(h("div.idk-bodyprev", !bodyPick ? h("p.muted", tt("Choisis un corps : l'aperçu montre le personnage entier, avec la tête du portrait-robot. « Ajouter à la banque » proposera alors la tête seule ou le personnage entier."))
        : !layers.length ? h("p.muted", tt("Pose d'abord une tête : l'aperçu la mettra sur ce corps."))
        : bodyUrl ? h("img", { src: bodyUrl, alt: "" }) : h("p.muted", tt("Composition…"))),
      ...bodies.map((b) => h("button.idk-el" + (b.id === bodyPick ? ".on" : ""), { disabled: !b.ready, title: b.ready ? tr(b.name) : tt("Ce corps n'est pas encore encré"), on: { click: () => pickBody(b.id) } },
        b.ready ? h("img", { src: `/bodies/${b.id}.png`, loading: "lazy", alt: "" }) : null, h("span", tr(b.name)))));
    if (bodyPick) grid.append(h("div.row.idk-bodyacts", h("button.mini", { title: tt("Recompose l'aperçu avec la tête telle qu'elle est maintenant"), on: { click: () => pickBody(bodyPick, true) } }, tt("↻ Actualiser l'aperçu")),
      h("button.mini", { title: tt("Ne plus proposer de corps : la tête seule part dans la banque"), on: { click: () => { bodyPick = null; bodyUrl = null; showBodies(); } } }, tt("Sans corps"))));
  };
  const pickBody = async (id, again) => {
    if (!again && bodyPick === id) { bodyPick = null; bodyUrl = null; return showBodies(); }
    bodyPick = id; bodyUrl = null; showBodies();
    if (!layers.length) return;
    try { bodyUrl = URL.createObjectURL(await composeBody()); } catch (e) { toast(e.message, "error"); }
    if (cur === BODY) showBodies();
  };
  // ---- transposer un portrait : reperage du visage dans le navigateur (MediaPipe), la photo ne part jamais ;
  // le serveur trace visage, yeux, sourcils, nez et bouche a partir des seuls points
  let detector = null;
  const getDetector = async () => {
    if (detector) return detector;
    const mp = await import("/web/vendor/mediapipe/vision_bundle.mjs");
    const files = await mp.FilesetResolver.forVisionTasks("/web/vendor/mediapipe/wasm");
    detector = await mp.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: "/web/vendor/mediapipe/face_landmarker.task" },
      runningMode: "IMAGE", numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
    return detector;
  };
  const photoBox = h("div.idk-photo");
  const photoUi = () => {
    photoBox.textContent = "";
    if (!photo) return;
    const op = h("input", { type: "range", min: 0.05, max: 1, step: 0.05, value: photo.op, on: { input: (e) => { photo.op = +e.target.value; paint(); } } });
    photoBox.append(h("label.check", h("input", { type: "checkbox", checked: photo.on, on: { change: (e) => { photo.on = e.target.checked; paint(); } } }), tt("Photo en fond")),
      h("label.row.range", tt("Opacité"), op),
      h("p.muted", tt("Cheveux, barbe, lunettes et oreilles restent à choisir à la main.")));
  };
  const transposeFile = async (f) => {
    const src = URL.createObjectURL(f);
    let img;
    try { img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error(tt("image illisible"))); i.src = src; }); }
    catch (e) { return toast(e.message, "error"); }
    toast(tt("Repérage du visage…"));
    let r;
    try { r = (await getDetector()).detect(img); }
    catch (e) { return toast(tt("Le repérage du visage n'a pas pu démarrer : ") + e.message, "error", 9000); }
    const lm = r.faceLandmarks && r.faceLandmarks[0];
    if (!lm) return toast(tt("Aucun visage trouvé sur cette image."), "error", 7000);
    const W = img.naturalWidth, H = img.naturalHeight;
    const points = lm.map((p) => [p.x * W, p.y * H, p.z * W]);
    const shapes = Object.fromEntries((((r.faceBlendshapes || [])[0] || {}).categories || []).map((c) => [c.categoryName, c.score]));
    const mt = (r.facialTransformationMatrixes || [])[0];
    const matrix = mt ? [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => mt.data[j * 4 + i])) : null;   // rangee par colonnes dans MediaPipe
    let res;
    try { res = await post("transpose", { points, shapes, matrix }); }
    catch (e) { return toast(e.message, "error", 9000); }
    const repl = new Set(res.calques.map((c) => c.cat));
    layers = layers.filter((l) => !repl.has(l.cat));
    for (const c of res.calques) {
      const ratio = await ratioOf(c.file, 0);
      layers.push({ n: uidN++, cat: c.cat, id: "transpose-" + c.cat, name: tr(c.name), file: c.file, t: 0, cap: null, r: ratio,
        x: c.place[0], y: c.place[1], w: c.place[2], kx: 1, ky: 1, rot: 0, flip: false, p0: c.place });
    }
    photo = { url: src, w: W, h: H, M: res.photo, on: true, op: photo ? photo.op : 0.35 };
    sel = null; paint(); props(); marks(); hist.snap(); photoUi();
    const e = res.etat || {};
    toast(tt("Visage transposé : forme du visage, yeux, sourcils, nez et bouche. Cheveux, barbe, lunettes et oreilles restent à choisir à la main.") +
      (e.sourire > 0.5 || e.bouche_ouverte > 0.3 ? " " + tt("La photo souriait ou avait la bouche ouverte : la bouche a été ramenée au repos.") : ""), "info", 10000);
  };
  const fileIn = h("input", { type: "file", accept: "image/*", style: { display: "none" }, on: { change: (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) transposeFile(f); } } });
  // « Deplacer tout » : tant qu'il est allume, glisser deplace tout le visage (pour le recentrer)
  const moveBtn = h("button.mini.idk-moveall", { title: tt("Déplacer tout : tant que ce bouton est allumé, glisser sur le portrait déplace tous les éléments ensemble (Échap pour arrêter)"),
    on: { click: () => { moveAll = !moveAll; moveBtn.classList.toggle("on", moveAll); if (moveAll) { sel = null; multi.clear(); } paint(); props(); } } }, "✥");
  // exporter le portrait compose : PNG transparent ou JPEG sur blanc, 2 pixels par unite du cadre
  const exportMenu = (e) => {
    document.querySelector(".menu")?.remove();
    const go = async (fmt) => {
      box.remove();
      if (!layers.length) return toast(tt("Pose au moins un élément."), "error");
      const jpg = fmt === "jpg", blob = await render(2 * S, 2 * S, jpg, jpg ? "image/jpeg" : "image/png");
      const a = h("a", { href: URL.createObjectURL(blob), download: (name.value.trim() || tt("portrait-robot")).replace(/[\\/:*?"<>|]+/g, "_") + (jpg ? ".jpg" : ".png") });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    };
    const box = h("div.menu.mt-menu", h("button", { on: { click: () => go("png") } }, tt("PNG (fond transparent)")), h("button", { on: { click: () => go("jpg") } }, tt("JPEG (fond blanc)")));
    document.body.append(box);
    const r = box.getBoundingClientRect();
    box.style.left = Math.max(4, Math.min(e.clientX, innerWidth - r.width - 6)) + "px";
    box.style.top = Math.max(4, Math.min(e.clientY, innerHeight - r.height - 6)) + "px";
    const close = (ev) => { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener("pointerdown", close, true); } };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  };
  // composition gardee dans l'element de banque, pour le rouvrir ici
  const composition = (withBody) => ({ v: 1, layers: JSON.parse(JSON.stringify(layers)), off, body: withBody ? bodyPick : null });
  // petit choix a deux reponses (null si on annule)
  const choose = (title, text, opts, warn) => new Promise((ok) => {
    modal(title, h("div.form", h("p", text), warn ? h("p.idk-warn", warn) : null), [{ label: tt("Annuler"), click: () => ok(null) }, ...opts.map(([v, l]) => ({ label: l, primary: true, click: () => ok(v) }))]);
  });
  const m = modal(edit && edit.item ? tt`Portrait-robot : ${edit.item.name}` : tt("Portrait-robot"), h("div.idk",
    h("div.idk-left", h("div.idk-stagewrap", svg, moveBtn), bricksBox, h("div.row.wrap", h("button.mini", { title: tt("Tire un visage au hasard dans la banque"), on: { click: random } }, tt("🎲 Au hasard")),
      h("button.mini", { title: tt("Reconstruit le visage d'une photo de face avec les éléments du portrait-robot. La photo reste dans ce navigateur : seuls les points du visage partent."), on: { click: () => fileIn.click() } }, tt("📷 Transposer un portrait…")), fileIn,
      h("button.mini", { on: { click: () => { layers = []; sel = null; multi.clear(); paint(); props(); marks(); } } }, tt("Tout retirer")),
      h("button.mini", { title: tt("Télécharge le portrait tel qu'il est affiché, en pleine définition, sans les poignées"), on: { click: (e) => exportMenu(e) } }, tt("⬇ Exporter le portrait ▾"))), photoBox, knobs),
    h("div.idk-right", h("label.row", tt("Nom"), name), tabs, grid)),
    [{ label: tt("Fermer") }, { label: edit && edit.item ? tt("Enregistrer…") : tt("Ajouter à la banque"), primary: true, click: async () => {
      if (!layers.length) { toast(tt("Pose au moins un élément."), "error"); return false; }
      const nm = name.value.trim() || tt("Portrait-robot");
      let replace = false;
      if (edit && edit.item) {                      // reedition : remplacer l'image de base, ou un nouveau personnage
        const old = edit.item, poses = Object.keys(old.variants || {}).filter((k) => k !== "base").length, orb = !!((old.variants || {}).base || {}).orbit;
        const warn = poses || orb ? "⚠ " + tt`Attention : « ${old.name} » a déjà ${poses} pose(s)${orb ? tt(" et une orbite") : ""}. En remplaçant l'image de base, elles gardent l'ancien visage et deviennent périmées. Son détourage, son orbite de base et sa planche de vues sont retirés (l'ancienne image est gardée dans data/backup) ; rien n'est relancé : refais-les depuis sa fiche quand tu veux.` : "";
        const c = await choose(tt("Enregistrer le portrait"), tt`Remplacer l'image de base de « ${old.name} », ou en faire un nouveau personnage ?`, [["replace", tt("Remplacer l'image de base")], ["new", tt("Nouveau personnage")]], warn);
        if (!c) return false;
        replace = c === "replace";
      }
      let withBody = false;
      if (bodyPick) {
        const c = await choose(tt("Ajouter à la banque"), tt("Le personnage entier, avec le corps choisi, ou seulement la tête ?"), [["head", tt("Tête seule")], ["body", tt("Avec ce corps")]]);
        if (!c) return false;
        withBody = c === "body";
      }
      if (replace) {
        try {
          sel = null; multi.clear(); paint();
          const blob = withBody ? await composeBody() : await render();
          const id = edit.item.id;
          await upload(`bank/${id}/rebase`, blob);
          edit.item = await apiPut("bank/" + id, { identikit: composition(withBody) });
          bankUI.tab = "character"; await bankUI.reload(); bankUI.reveal(id);
          toast(tt`L'image de base de « ${edit.item.name} » est remplacée. Rien n'est relancé : détourage et orbite se refont depuis sa fiche.`, "info", 9000);
        } catch (e) { toast(tt("Portrait refusé : ") + e.message, "error", 9000); }
        return false;                               // l'atelier reste ouvert
      }
      const orbit = confirm(tt("Calculer aussi son orbite 360° (environ 3 minutes sur une machine) ?\nAnnuler : il reste une image fixe, tu pourras lancer l'orbite plus tard depuis sa fiche."));
      try {
        sel = null; multi.clear(); paint();
        const blob = withBody ? await composeBody() : await render();
        const it = await upload("bank?" + new URLSearchParams({ kind: "character", name: nm, style: "dessin", facing: "face", orbit: orbit ? "1" : "0", file: withBody ? "personnage.png" : "portrait.png", folder: "Portraits-robots" }), blob);
        try { await apiPut("bank/" + it.id, { identikit: composition(withBody) }); }   // pour le rouvrir dans l'atelier
        catch (e) { toast(tt("Composition non gardée : ") + e.message, "error"); }
        bankUI.tab = "character"; await bankUI.reload(); bankUI.reveal(it.id); bankUI.app.pollSoon();
        toast(tt`« ${nm} » est dans la banque, dossier Portraits-robots.` + (orbit ? tt(" Son orbite est en calcul.") : ""));
      } catch (e) { toast(tt("Portrait refusé : ") + e.message, "error", 9000); return false; }
    } }]);
  m.box.classList.add("wide", "idk-box");
  hist.watch(m.box);                                // chaque geste dans la fenetre note l'etat (souris, curseurs, menus)
  showCat(); paint(); props();
}
