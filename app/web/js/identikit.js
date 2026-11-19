// Portrait-robot, a la maniere des coffrets de la police : un visage se monte en superposant des elements dessines
// (forme du visage, cheveux, yeux, sourcils, nez, bouche, oreilles, moustache, barbe, lunettes, signes, couvre-chef).
// Les elements viennent de la banque d'elements (data/parts, /api/parts) ; on peut en dessiner de nouveaux dans l'atelier.
// Le visage monte part dans la banque comme une image a part entiere.
import { tt, tr } from "./i18n.js";
import { h, get, del, upload, toast, modal, history } from "./api.js";
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

export async function openIdentikit(bankUI) {
  let cats;
  try { cats = await get("parts"); } catch (e) { return toast(tt("Banque d'éléments indisponible : ") + e.message, "error"); }
  for (const c of cats) { c.label = tr(c.label); for (const it of c.items) if (!it.mine) it.name = tr(it.name); }   // noms venus du serveur : traduits a l'affichage
  let cur = cats.find((c) => c.key === "visage") || cats[0], layers = [], sel = null, drag = null, uidN = 1;
  const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${S} ${S}`); svg.setAttribute("class", "idk-stage");
  const name = h("input", { type: "text", placeholder: tt("Nom du personnage") });
  const tabs = h("div.idk-tabs"), grid = h("div.idk-grid"), knobs = h("div.idk-knobs"), bricksBox = h("div.idk-bricks");
  let pinned = false, brickSig = "", userSel = false;   // userSel : choisi a la main (clic, brique), pas seulement pose                // pinned : choisi par sa brique, il se deplace meme s'il est recouvert
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
        (sel === l.n ? `<rect x="${-bw / 2}" y="${-hh / 2}" width="${bw}" height="${hh}" fill="none" stroke="#10b5e0" stroke-width="2" stroke-dasharray="8 6" pointer-events="none"/>` : "") + `</g>`;
    }
    svg.innerHTML = `<defs>${defs}</defs><rect width="${S}" height="${S}" fill="#fff"/>` + acc + grips();
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
  const bricks = () => {
    const sig = sorted().map((l) => l.n + ":" + l.file + ":" + nameOf(l)).join(",") + "|" + sel;
    if (sig === brickSig) return;
    brickSig = sig; bricksBox.textContent = "";
    if (!layers.length) return;
    bricksBox.append(...sorted().map((l) => {
      const label = nameOf(l);
      return h("div.idk-brick" + (l.n === sel ? ".on" : ""), { title: tt`${label} · ${l.name} : cliquer pour le choisir, même s'il est caché sous un autre`,
        on: { click: () => { sel = l.n; pinned = true; userSel = true; const c = cats.find((k) => k.key === l.cat); if (c && c !== cur) { cur = c; showCat(); } paint(); props(); } } },
        h("img", { src: url(l), alt: "", draggable: false }), h("span", label),
        h("i", { title: tt("Retirer du visage"), on: { click: (e) => { e.stopPropagation(); sel = l.n; removeSel(); } } }, "✕"));
    }));
  };
  // poignees autour de l'element choisi : coins = taille, cotes = etirer, rond du haut = tourner ; taille constante a l'ecran
  const unit = () => { const r = svg.getBoundingClientRect(); return r.width ? S / r.width : 2; };
  const grips = () => {
    const l = layers.find((x) => x.n === sel);
    if (!l) return "";
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
  const removeSel = () => { layers = layers.filter((x) => x.n !== sel); sel = null; pinned = false; paint(); props(); marks(); };
  const range = (label, key, min, max, step, title) => {
    const l = layers.find((x) => x.n === sel), out = h("output", (+l[key]).toFixed(step < 1 ? 2 : 0));
    return h("label.row.range", { title: title || "" }, label, h("input", { type: "range", min, max, step, value: l[key], "data-k": key, on: { input: (e) => { l[key] = +e.target.value; out.textContent = (+l[key]).toFixed(step < 1 ? 2 : 0); paint(); } } }), out);
  };
  const props = () => {
    knobs.textContent = "";
    const l = layers.find((x) => x.n === sel);
    if (!l) { knobs.append(h("p.muted", tt("Clique un élément dans la liste pour le poser. Sur le visage : glisser pour le déplacer, molette pour sa taille ; poignées des coins = taille, des côtés = étirer, rond du haut = tourner (Maj : crans de 15°). Flèches : déplacer (Maj : de dix). Suppr : retirer. Clic droit : miroir, empilement. Un seul élément par catégorie (sauf les signes) : en choisir un autre le remplace à la même place."))); return; }
    knobs.append(h("b", `${nameOf(l)} · ${l.name}`),
      range(tt("Taille"), "w", 30, 950, 1), range(tt("Largeur"), "kx", 0.2, 4, 0.01, tt("Étire ou resserre l'élément en largeur")), range(tt("Hauteur"), "ky", 0.2, 4, 0.01, tt("Étire ou tasse l'élément en hauteur")),
      range(tt("Rotation"), "rot", -180, 180, 1),
      h("div.row.wrap", h("button.mini", { on: { click: () => { l.flip = !l.flip; paint(); } } }, tt("⇋ Miroir")),
        h("button.mini", { title: tt("Remet la taille et la place de départ"), on: { click: () => { home(l); paint(); props(); } } }, tt("↺ Place de départ")),
        SPLIT.has(l.cat) && !l.half ? h("button.mini", { title: tt("Coupe la paire en deux : chaque côté se place, se règle et se retire séparément (un œil plus haut que l'autre…)"), on: { click: () => split(l) } }, tt("✂ Séparer")) : null,
        l.half ? h("button.mini", { title: tt("Remet la paire entière, à sa place de départ"), on: { click: () => join(l) } }, tt("⧉ Réunir")) : null,
        h("button.mini.danger", { title: tt("Ou touche Suppr"), on: { click: removeSel } }, tt("Retirer du visage"))));
  };
  // place de depart d'un calque : celle de son element (p0), sinon celle de la categorie ; le jumeau d'une oreille garde son miroir
  const halfOff = (l, p) => (l.half ? (l.half === "l" ? -1 : 1) * p[2] / 4 : 0);      // une moitie se place a un quart de la largeur
  const home = (l) => { const p = l.p0 || PLACE[l.cat] || [500, 500, 300]; Object.assign(l, { x: p[0] + halfOff(l, p), y: p[1], w: p[2], kx: 1, ky: 1, rot: 0, flip: !!l.twin }); };
  const put = async (cat, it, quiet) => {
    const r = await ratioOf(it.file, it.t);
    const spot = (twin) => { const p = it.place || PLACE[cat] || [500, 500, 300]; return twin ? [S - p[0], p[1], p[2]] : [p[0], p[1], p[2]]; };
    const fresh = (twin) => { const p = spot(twin); return { n: uidN++, cat, id: it.id, name: it.name, file: it.file, t: it.t || 0, cap: it.cap || null, r,
      x: p[0], y: p[1], w: p[2], kx: 1, ky: 1, rot: 0, flip: twin, twin, p0: p }; };
    const swapIn = (l) => {                         // meme categorie : le nouvel element prend la place de l'ancien
      const p = spot(!!(l.twin && it.pair)), old = l.p0 || PLACE[cat] || [l.x, l.y, l.w];
      const ox = old[0] + halfOff(l, old), nx = p[0] + halfOff(l, p);             // une moitie : par rapport a la place de sa moitie
      if (l.x === ox && l.y === old[1] && l.w === old[2] && l.kx === 1 && l.ky === 1) Object.assign(l, { x: nx, y: p[1], w: p[2] });
      else Object.assign(l, { x: l.x + nx - ox, y: l.y + p[1] - old[1], w: Math.round(l.w * p[2] / old[2]) });   // regle a la main : decalage et echelle gardes
      if (!it.pair && l.twin) l.flip = false;
      Object.assign(l, { id: it.id, name: it.name, file: it.file, t: it.t || 0, cap: it.cap || null, r, p0: p, twin: !!(l.twin && it.pair) });
    };
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
    tabs.append(...cats.map((c) => h("button.mini" + (c === cur ? ".on" : ""), { on: { click: () => { cur = c; showCat(); } } }, c.label, h("span.count", String(c.items.length)))));
    grid.textContent = "";
    grid.append(...cur.items.map((it) => h("button.idk-el", { "data-id": it.id, title: it.name + (it.mine ? tt(" (dessiné ici)") : ""), on: { click: () => put(cur.key, it) } },
      h("img", { src: `/parts/${it.file}?t=${it.t || 0}`, loading: "lazy", alt: "" }), h("span", it.name),
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
        try { const it = await upload(`parts/${cat.key}?name=${encodeURIComponent(nm)}`, blob); cat.items.push(it); cur = cat; showCat(); put(cat.key, it); }
        catch (e) { toast(tt("Élément refusé : ") + e.message, "error"); }
      } });
  };
  // souris : glisser un element pose, molette pour sa taille
  const pt = (e) => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * S, y: (e.clientY - r.top) / r.height * S }; };
  svg.addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;                     // clic droit : le menu s'en charge
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
  svg.addEventListener("pointerup", () => { if (drag) { drag = null; hist.snap(); } });   // un glisser fini = une etape
  svg.addEventListener("wheel", (e) => { const l = layers.find((x) => x.n === sel); if (!l) return; e.preventDefault(); l.w = Math.round(Math.min(950, Math.max(30, l.w * (e.deltaY < 0 ? 1.05 : 0.95)))); paint(); sync(); }, { passive: false });
  // clic droit sur un element pose : petit menu
  svg.addEventListener("contextmenu", (e) => {
    const n = +(e.target.dataset && e.target.dataset.n), l = layers.find((x) => x.n === n) || (e.target.dataset?.h && layers.find((x) => x.n === sel));
    e.preventDefault();
    if (!l) return;
    if (sel !== l.n) { sel = l.n; paint(); props(); }
    const same = sorted().filter((x) => x.cat === l.cat), i = same.indexOf(l);
    const swap = (o) => { [l.n, o.n] = [o.n, l.n]; sel = l.n; paint(); props(); };
    const items = [[tt("⇋ Miroir"), () => { l.flip = !l.flip; paint(); }],
      [tt("↺ Place de départ"), () => { home(l); paint(); props(); }],
      SPLIT.has(l.cat) && !l.half ? [tt("✂ Séparer"), () => split(l)] : null,
      l.half ? [tt("⧉ Réunir"), () => join(l)] : null,
      i < same.length - 1 ? [tt("▲ Monter d'un cran"), () => swap(same[i + 1])] : null,
      i > 0 ? [tt("▼ Descendre d'un cran"), () => swap(same[i - 1])] : null,
      [tt("✕ Retirer du visage"), removeSel, true]].filter(Boolean);
    document.querySelector(".menu")?.remove();
    const box = h("div.menu.mt-menu", items.map(([label, fn, danger]) => h("button" + (danger ? ".danger" : ""), { on: { click: () => { box.remove(); fn(); hist.snap(); } } }, label)));
    document.body.append(box);
    const r = box.getBoundingClientRect();
    box.style.left = Math.max(4, Math.min(e.clientX, innerWidth - r.width - 6)) + "px";
    box.style.top = Math.max(4, Math.min(e.clientY, innerHeight - r.height - 6)) + "px";
    const close = (ev) => { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener("pointerdown", close, true); } };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  });
  // annuler (Ctrl+Z, 15 pas) : ajout, retrait, deplacement, taille, rotation, miroir des elements ; pas la selection
  const hist = history(() => layers, (st) => {
    layers = st; if (!layers.some((l) => l.n === sel)) { sel = null; pinned = false; }
    uidN = Math.max(uidN, ...layers.map((l) => l.n + 1)); paint(); props(); marks();
  }, 15);
  // clavier, tant que l'atelier est ouvert : Ctrl+Z / Ctrl+Y annulent, Suppr retire, fleches deplacent
  const onKey = (e) => {
    if (!document.body.contains(svg)) return document.removeEventListener("keydown", onKey);
    const backs = document.querySelectorAll(".modal-back");
    if (backs[backs.length - 1] !== svg.closest(".modal-back")) return;          // une autre fenetre (dessin) est par-dessus
    if (hist.keydown(e)) return;                    // dans un champ de texte, c'est l'annulation du navigateur qui joue
    if (e.target.closest && e.target.closest("input, textarea, select, [contenteditable]")) return;
    const l = layers.find((x) => x.n === sel);
    if (!l) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeSel(); hist.snap(); return; }
    const d = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
    if (mv) { e.preventDefault(); l.x += mv[0]; l.y += mv[1]; paint(); hist.snap(); }
  };
  document.addEventListener("keydown", onKey);

  const random = async () => {
    layers = []; sel = null;
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
  const render = async () => {                     // l'image du visage monte : fond blanc, elements dans l'ordre
    const N = 1024, k = N / S, c = document.createElement("canvas"); c.width = c.height = N;
    const a = document.createElement("canvas"); a.width = a.height = N;            // les calques, sur fond transparent
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
    const out = c.getContext("2d"); out.fillStyle = "#fff"; out.fillRect(0, 0, N, N); out.drawImage(a, 0, 0);
    return new Promise((ok) => c.toBlob(ok, "image/png"));
  };
  const m = modal(tt("Portrait-robot"), h("div.idk",
    h("div.idk-left", svg, bricksBox, h("div.row.wrap", h("button.mini", { title: tt("Tire un visage au hasard dans la banque"), on: { click: random } }, tt("🎲 Au hasard")),
      h("button.mini", { on: { click: () => { layers = []; sel = null; paint(); props(); marks(); } } }, tt("Tout retirer"))), knobs),
    h("div.idk-right", h("label.row", tt("Nom"), name), tabs, grid)),
    [{ label: tt("Fermer") }, { label: tt("Ajouter à la banque"), primary: true, click: async () => {
      if (!layers.length) { toast(tt("Pose au moins un élément."), "error"); return false; }
      const nm = name.value.trim() || tt("Portrait-robot");
      const orbit = confirm(tt("Calculer aussi son orbite 360° (environ 3 minutes sur une machine) ?\nAnnuler : il reste une image fixe, tu pourras lancer l'orbite plus tard depuis sa fiche."));
      try {
        sel = null; paint();
        const blob = await render();
        const it = await upload("bank?" + new URLSearchParams({ kind: "character", name: nm, style: "dessin", facing: "face", orbit: orbit ? "1" : "0", file: "portrait.png", folder: "Portraits-robots" }), blob);
        bankUI.tab = "character"; await bankUI.reload(); bankUI.reveal(it.id); bankUI.app.pollSoon();
        toast(tt`« ${nm} » est dans la banque, dossier Portraits-robots.` + (orbit ? tt(" Son orbite est en calcul.") : ""));
      } catch (e) { toast(tt("Portrait refusé : ") + e.message, "error", 9000); return false; }
    } }]);
  m.box.classList.add("wide", "idk-box");
  hist.watch(m.box);                                // chaque geste dans la fenetre note l'etat (souris, curseurs, menus)
  showCat(); paint(); props();
}
