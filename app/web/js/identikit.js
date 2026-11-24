// Portrait-robot, a la maniere des coffrets de la police : un visage se monte en superposant des elements dessines
// (forme du visage, cheveux, yeux, sourcils, nez, bouche, oreilles, moustache, barbe, lunettes, signes, couvre-chef).
// Les elements viennent de la banque d'elements (data/parts, /api/parts) ; on peut en dessiner de nouveaux dans l'atelier.
// Le visage monte part dans la banque comme une image a part entiere ; sa composition (item.identikit = { v, layers, off,
// body }) y est gardee pour le rouvrir ici (« Editer dans le portrait-robot » sur sa fiche).
import { tt, tr } from "./i18n.js";
import { h, get, post, del, upload, toast, modal, history, put as apiPut } from "./api.js";
import { openDrawEditor, drawImage } from "./draw.js";
import { stageFill, stagePattern, stageBgControl } from "./colors.js";

const S = 1000;                                  // largeur de la feuille, en unites (la hauteur depend du kit : SH)
// Deux kits sur le meme atelier : le visage (portrait-robot, feuille 1000 x 1000) et le corps (generateur de corps,
// feuille 1000 x 2000, celle des corps encres de app/bodydraw.py). Pour chacun :
//   PLACE : place et taille de depart d'une categorie (centre x, y ; largeur), quand l'element n'a pas la sienne
//   ORDER : ordre d'empilement, du dessous vers le dessus (les oreilles restent sous la forme du visage)
//   MANY : categories ou l'on peut poser plusieurs elements ; SPLIT : paires separables en deux moities
const KITS = {
  visage: { SH: 1000, start: "visage",
    PLACE: { oreilles: [500, 500, 700], visage: [500, 540, 560], barbe: [500, 740, 400], bouche: [500, 670, 210], moustache: [500, 625, 230],
             nez: [500, 545, 130], yeux: [500, 445, 300], sourcils: [500, 385, 320], signes: [640, 560, 90], lunettes: [500, 445, 350],
             cheveux: [500, 330, 620], "couvre-chef": [500, 220, 560] },
    ORDER: ["oreilles", "visage", "barbe", "bouche", "moustache", "nez", "yeux", "sourcils", "signes", "lunettes", "cheveux", "couvre-chef"],
    MANY: new Set(["signes"]), SPLIT: new Set(["yeux", "sourcils", "moustache", "lunettes"]), PAIRCATS: ["yeux", "sourcils", "oreilles", "moustache", "lunettes"],
    random: [["visage", "oreilles", "yeux", "sourcils", "nez", "bouche", "cheveux"], ["moustache", "barbe", "lunettes"]] },
  corps: { SH: 2000, start: "silhouette",
    PLACE: { silhouette: [500, 1000, 1000], tete: [500, 265, 609], torse: [500, 850, 560], bras: [500, 900, 760], mains: [500, 1230, 800],
             jambes: [500, 1520, 340], chaussures: [500, 1790, 460], accessoires: [500, 900, 200] },
    ORDER: ["silhouette", "jambes", "chaussures", "torse", "bras", "mains", "tete", "accessoires"],
    MANY: new Set(["accessoires"]), SPLIT: new Set(["bras", "mains", "jambes", "chaussures"]), PAIRCATS: ["bras", "mains", "jambes", "chaussures"],
    random: [["tete"], ["torse", "bras", "mains", "jambes", "chaussures"]], whole: "silhouette", follow: { bras: "torse", mains: "torse", chaussures: "jambes" } },   // chaussures : a la hauteur des chevilles de leurs jambes
};
const ratios = new Map();                        // fichier -> hauteur / largeur
const ratioOf = (file, t) => new Promise((ok) => {
  const key = file + "?t=" + (t || 0);                 // un element refait garde son nom : la version fait la difference
  if (ratios.has(key)) return ok(ratios.get(key));
  const im = new Image(); im.onload = () => { ratios.set(key, im.naturalHeight / im.naturalWidth); ok(ratios.get(key)); }; im.onerror = () => ok(1); im.src = "/parts/" + key;
});
const url = (l) => `/parts/${l.file}?t=${l.t || 0}`;
// cadre d'un calque : une moitie (half « l » ou « r » : moitie gauche ou droite de l'image) n'a que la moitie de la largeur
const boxW = (l) => l.w * l.kx * (l.half ? 0.5 : 1), boxH = (l) => l.w * l.r * l.ky;
// ou poser l'image entiere pour que la moitie montree soit centree sur le calque (le reste est coupe)
const imgX = (l) => { const W = l.w * l.kx; return l.half === "l" ? -W / 4 : l.half === "r" ? -3 * W / 4 : -W / 2; };
// trait constant : l.tk = epaisseur du trait (unites de la feuille) gardee quelle que soit la taille de l'element. L'image
// est redessinee a sa taille affichee, puis son encre est epaissie ou amincie (min / max de voisinage, en octogone)
const imgCache = new Map();
const loadImg = (src) => { if (!imgCache.has(src)) imgCache.set(src, new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; })); return imgCache.get(src); };
const inkW = new Map();                          // fichier -> epaisseur du trait de l'image d'origine (pixels de l'image)
async function nativeInk(l) {
  const key = url(l);
  if (inkW.has(key)) return inkW.get(key);
  const im = await loadImg(key); if (!im) return 2;
  const w = im.naturalWidth, h = im.naturalHeight, c = document.createElement("canvas"); c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0);
  const d = x.getImageData(0, 0, w, h).data, ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const a = d[i * 4 + 3] / 255, lum = (0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]) * a + 255 * (1 - a); ink[i] = lum < 110 ? 1 : 0; }
  let area = 0, per = 0;                         // epaisseur ~ 2 x surface / perimetre de l'encre
  for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) { const i = y * w + xx; if (!ink[i]) continue; area++; if (!ink[i - 1] || !ink[i + 1] || !ink[i - w] || !ink[i + w]) per++; }
  const v = per ? Math.max(1, 2 * area / per) : 2;
  inkW.set(key, v); return v;
}
// passes de rayon 1 (carre puis croix, en alternance) : thick = l'encre s'etale (couleur : min, opacite : max), sinon elle maigrit
function morph(d, w, h, n, thick) {
  let src = d, dst = new Uint8ClampedArray(d.length);
  for (let it = 0; it < n; it++) {
    const sq = it % 2 === 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r = src[o], g = src[o + 1], b = src[o + 2], a = src[o + 3];
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || (!sq && dx && dy)) continue;
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const q = (yy * w + xx) * 4;
          if (thick) { if (src[q] < r) r = src[q]; if (src[q + 1] < g) g = src[q + 1]; if (src[q + 2] < b) b = src[q + 2]; if (src[q + 3] > a) a = src[q + 3]; }
          else { if (src[q] > r) r = src[q]; if (src[q + 1] > g) g = src[q + 1]; if (src[q + 2] > b) b = src[q + 2]; if (src[q + 3] < a) a = src[q + 3]; }
        }
      }
      dst[o] = r; dst[o + 1] = g; dst[o + 2] = b; dst[o + 3] = a;
    }
    [src, dst] = [dst, src];
  }
  return src;
}
/** Image de l'element au trait constant, pour q pixels par unite de la feuille : { canvas, pad } (pad : marge ajoutee
 *  autour de l'image, en unites de la feuille, pour que le contour epaissi ne soit pas coupe) ou null (image absente). */
async function strokeCanvas(l, q) {
  const im = await loadImg(url(l)); if (!im) return null;
  const W = l.w * l.kx, hh = boxH(l);
  q = Math.min(q, 1400 / Math.max(W, hh));
  const nat = await nativeInk(l), cur = nat * (W * q) / im.naturalWidth, want = l.tk * q;
  const n = Math.max(-40, Math.min(40, Math.round((want - cur) / 2)));      // rayon : on gagne (ou perd) 2 px de trait par pas
  const p = Math.max(0, n) + 1, wp = Math.max(1, Math.round(W * q)), hp = Math.max(1, Math.round(hh * q));
  const c = document.createElement("canvas"); c.width = wp + 2 * p; c.height = hp + 2 * p;
  const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, p, p, wp, hp);
  if (n) {
    const img = x.getImageData(0, 0, c.width, c.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; d[i] = d[i] * a + 255 * (1 - a); d[i + 1] = d[i + 1] * a + 255 * (1 - a); d[i + 2] = d[i + 2] * a + 255 * (1 - a); }   // transparent = blanc pour la couleur
    img.data.set(morph(d, c.width, c.height, Math.abs(n), n > 0)); x.putImageData(img, 0, 0);
  }
  return { canvas: c, pad: p / q, sx: (wp / q) / W, sy: (hp / q) / hh };
}
const tkCache = new Map();                       // cle -> { url, pad } (ecran)
const tkKey = (l) => `${url(l)}|${(l.w * l.kx).toFixed(1)}|${boxH(l).toFixed(1)}|${l.tk}`;
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

// edit : { item } a rouvrir avec sa composition ; opts.kit : "visage" (portrait-robot) ou "corps" (generateur de corps) ;
// opts.head : une tete (element de la categorie « tete ») a poser tout de suite sur le corps
const NANO_TAIL = "Do not apply realistic human anatomy. This is NOT a human, it is a DRAWING DESIGN with intentional non-realistic proportions.";
const REAL_PROMPT = "Turn this drawing into an ultra-realistic photograph of the same subject, with zero redesign of its shapes. The drawing is a deliberate caricature: every proportion is intentional. Read the drawn lines ONLY as indications of shape, edges and features, never as marks to reproduce: the final image contains NO ink lines, NO outlines, NO contour strokes, NO drawn hatching and NO pen texture anywhere. Each line becomes what it describes: the outline of the head becomes the natural edge of real skin against the background, with soft light and shadow; drawn eyebrows, moustache and beard become real hair; wrinkle lines become real skin folds; hair strokes become real hair strands. Keep the exact silhouette and every internal shape where the lines put them: same skull volume and head size, same face width and height, nose length and shape, hairline, ear shape and position, mouth size, eye size, spacing and position, eyebrows, wrinkles and asymmetries. Do not fix anatomy, do not beautify, do not make the face more symmetrical, younger or more average. Keep the identical composition, scale, perspective, pose and framing, and the same head-to-body ratio. Do not add anything that is not drawn: if only a head is drawn, show only the head and neck, with no added clothing, collar or body. Use the colors of the drawing where it has some; otherwise natural, believable colors (real skin with pores, real hair, real materials). Lighting: professional studio lighting on a plain light-beige seamless background. Lens: 80 mm macro look with tilt-shift shallow depth of field (subject sharp, gentle bokeh). If uncertain, do not invent details: stay subtle and neutral. Shape fidelity over everything else, but rendered as a real photograph, not as a drawing. MANDATORY: no text on the image, no captions, no labels, no watermarks, no overlays, no visible lines. Pure photographic imagery only.";
export async function openIdentikit(bankUI, edit = null, opts = {}) {
  const comp00 = edit && edit.item && edit.item.identikit;
  const kit = opts.kit || (comp00 && comp00.kit) || "visage", K = KITS[kit] || KITS.visage, BODYKIT = kit === "corps";
  const { SH, PLACE, ORDER, MANY, SPLIT } = K, DEFPLACE = [500, SH / 2, 300];
  // banques d'elements : la Banque Claude (celle d'origine) et celles de David, chacune dans son onglet
  let banks = [], bank = localStorage.getItem("bw.idk.bank." + kit) || "claude", cats;
  const loadCats = async () => {
    const cs = await get(`parts?${new URLSearchParams({ bank, kit })}`);
    for (const c of cs) { c.label = tr(c.label); for (const it of c.items) { it.bank = bank; if (!it.mine) it.name = tr(it.name); } }   // noms venus du serveur : traduits a l'affichage
    return cs;
  };
  try { banks = await get("parts/banks"); if (!banks.some((b) => b.id === bank)) bank = "claude"; cats = await loadCats(); }
  catch (e) { return toast(tt("Banque d'éléments indisponible : ") + e.message, "error"); }
  let cur = cats.find((c) => c.key === K.start) || cats[0], layers = [], sel = null, drag = null, uidN = 1;
  const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${S} ${SH}`); svg.setAttribute("class", "idk-stage"); svg.style.aspectRatio = `${S} / ${SH}`;
  const name = h("input", { type: "text", placeholder: tt("Nom du personnage") });
  const tabs = h("div.idk-tabs"), grid = h("div.idk-grid"), knobs = h("div.idk-knobs"), bricksBox = h("div.idk-bricks"), bankTabs = h("div.idk-banks");
  let pinned = false, brickSig = "", userSel = false;
  let photo = null;                                  // portrait transpose, montre en fond pour comparer : {url, w, h, M (2 x 3), on, op}
  const BODY = { key: "__corps", label: tt("🧍 Corps"), items: [] };
  let multi = new Set(), moveAll = false, band = null;   // selection de groupe (rectangle, Maj+clic) ; « Deplacer tout » ; rectangle en cours
  let off = { x: 0, y: 0 };                          // decalage de tout le visage (« Deplacer tout ») : les places de depart le suivent
  let bodies = null, bodyPick = null, bodyUrl = null;   // corps choisi pour le personnage entier, et son apercu   // userSel : choisi a la main (clic, brique), pas seulement pose                // pinned : choisi par sa brique, il se deplace meme s'il est recouvert
  const comp0 = comp00;
  if (comp0 && Array.isArray(comp0.layers)) {        // reedition : la composition gardee dans l'element
    layers = JSON.parse(JSON.stringify(comp0.layers));
    uidN = Math.max(1, ...layers.map((l) => (l.n || 0) + 1));
    off = Object.assign({ x: 0, y: 0 }, comp0.off);
    bodyPick = comp0.body || null;
    name.value = edit.item.name || "";
  }
  // ordre d'empilement : par categorie (ORDER) tant qu'on n'y a pas touche ; des qu'on deplace un element, chaque calque
  // garde un rang z (petit = derriere). Un element pose ensuite prend place apres son voisin de categorie.
  const defCmp = (a, b) => ORDER.indexOf(a.cat) - ORDER.indexOf(b.cat) || a.n - b.n;
  const sorted = () => {
    if (layers.some((l) => l.z != null) && layers.some((l) => l.z == null)) {
      const d = layers.slice().sort(defCmp), k = d.findIndex((l) => l.z != null), z0 = d[k].z;
      let last = null;
      d.forEach((l, i) => { if (l.z != null) { last = l.z; return; } l.z = last == null ? z0 - (k - i) : (last += 0.01); });
    }
    return layers.slice().sort((a, b) => (a.z != null && b.z != null ? a.z - b.z : 0) || defCmp(a, b));
  };
  // place l a la position i de l'ordre (0 = tout derriere), et renumerote
  const restack = (l, i) => {
    const s = sorted().filter((x) => x !== l);
    s.splice(Math.max(0, Math.min(s.length, i)), 0, l);
    s.forEach((x, j) => { x.z = j; });
    paint(); hist.snap();
  };
  const unstack = () => { layers.forEach((l) => { delete l.z; }); paint(); hist.snap(); };
  const tf = (l) => `translate(${l.x} ${l.y}) rotate(${l.rot}) scale(${l.flip ? -1 : 1} 1)`;
  // gomme : l.er = [{ w, p: [[u, v], ...] }], coordonnees de l'image de l'element (0..1), epaisseur en hauteur d'image
  const erasePts = (l, s) => { const W = l.w * l.kx, hh = boxH(l); return s.p.map(([u, v]) => [imgX(l) + u * W, -hh / 2 + v * hh]); };
  const eraseSvg = (l) => (l.er || []).map((s) => { const q = erasePts(l, s), hh = boxH(l);
    return q.length === 1 ? `<circle cx="${q[0][0].toFixed(1)}" cy="${q[0][1].toFixed(1)}" r="${(s.w * hh / 2).toFixed(1)}" fill="#000"/>`
      : `<polyline points="${q.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}" fill="none" stroke="#000" stroke-width="${(s.w * hh).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`; }).join("");
  let erasing = false, eraseW = 28;                         // gomme allumee, epaisseur (unites de la feuille)
  const tkLast = new Map(), tkBusy = new Set();               // calque -> derniere image au trait constant ; calculs en cours
  const tkHref = (l) => {
    if (!l.tk) return null;
    const k = tkKey(l), got = tkCache.get(k);
    if (got) { tkLast.set(l.n, got); return got; }
    if (!tkBusy.has(k)) {
      tkBusy.add(k);
      setTimeout(async () => {
        if (!layers.includes(l) || tkKey(l) !== k) { tkBusy.delete(k); return; }   // la taille a encore change : le suivant
        const r = await strokeCanvas(l, 1.5);
        if (r) { const blob = await new Promise((ok) => r.canvas.toBlob(ok)); tkCache.set(k, { url: URL.createObjectURL(blob), pad: r.pad });
          if (tkCache.size > 80) { const [k0, v0] = tkCache.entries().next().value; URL.revokeObjectURL(v0.url); tkCache.delete(k0); } }
        tkBusy.delete(k); paint();
      }, 120);
    }
    return tkLast.get(l.n) || null;
  };
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
      if ((l.er || []).length) defs += `<mask id="idker${l.n}" maskUnits="userSpaceOnUse" x="${imgX(l) - 2}" y="${-hh / 2 - 2}" width="${W + 4}" height="${hh + 4}"><rect x="${imgX(l) - 2}" y="${-hh / 2 - 2}" width="${W + 4}" height="${hh + 4}" fill="#fff"/>${eraseSvg(l)}</mask>`;
      const tk = tkHref(l), pd = tk ? tk.pad : 0;
      acc += `<g transform="${tf(l)}" data-n="${l.n}"><image href="${tk ? tk.url : url(l)}" x="${imgX(l) - pd}" y="${-hh / 2 - pd}" width="${W + 2 * pd}" height="${hh + 2 * pd}" preserveAspectRatio="none"${l.lock ? ` pointer-events="none"` : ` data-n="${l.n}"`}${l.half ? ` clip-path="url(#idkh${l.n})"` : ""}${(l.er || []).length ? ` mask="url(#idker${l.n})"` : ""}/>` +
        (sel === l.n || multi.has(l.n) ? `<rect x="${-bw / 2}" y="${-hh / 2}" width="${bw}" height="${hh}" fill="none" stroke="#10b5e0" stroke-width="2" stroke-dasharray="8 6" pointer-events="none"/>` : "") + `</g>`;
    }
    const ph = !BODYKIT && photo && photo.on ? (() => { const M = photo.M; return `<image href="${photo.url}" width="${photo.w}" height="${photo.h}" preserveAspectRatio="none" opacity="${photo.op}" pointer-events="none" transform="matrix(${M[0][0]} ${M[1][0]} ${M[0][1]} ${M[1][1]} ${M[0][2]} ${M[1][2]})"/>`; })() : "";
    const bd = band ? `<rect x="${Math.min(band.x0, band.x1)}" y="${Math.min(band.y0, band.y1)}" width="${Math.abs(band.x1 - band.x0)}" height="${Math.abs(band.y1 - band.y0)}" fill="rgba(16,181,224,0.08)" stroke="#10b5e0" stroke-width="${1.5 * unit()}" stroke-dasharray="6 4" pointer-events="none"/>` : "";
    svg.innerHTML = `<defs>${defs}${stagePattern(Math.max(8, S / 50))}</defs><rect width="${S}" height="${SH}" fill="${stageFill()}"/>` + ph + acc + grips() + bd;
    svg.style.cursor = moveAll ? "move" : "";
    bricks();
  };
  // nom d'un calque : sa categorie, ou le cote pour une moitie de paire et pour chaque oreille (cote de l'ecran)
  const HALVES = { yeux: [tt("Œil gauche"), tt("Œil droit")], sourcils: [tt("Sourcil gauche"), tt("Sourcil droit")],
    moustache: [tt("Moustache, côté gauche"), tt("Moustache, côté droit")], lunettes: [tt("Verre gauche"), tt("Verre droit")], oreilles: [tt("Oreille gauche"), tt("Oreille droite")],
    bras: [tt("Bras gauche"), tt("Bras droit")], mains: [tt("Main gauche"), tt("Main droite")], jambes: [tt("Jambe gauche"), tt("Jambe droite")], chaussures: [tt("Chaussure gauche"), tt("Chaussure droite")] };
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
    const sig = sorted().map((l) => l.n + ":" + l.file + ":" + nameOf(l) + (l.lock ? ":L" : "")).join(",") + "|" + sel + "|" + [...multi].join(",");
    if (sig === brickSig) return;
    brickSig = sig; bricksBox.textContent = "";
    if (!layers.length) return;
    const front = sorted().reverse();               // comme la liste du clic droit : la premiere brique est devant
    bricksBox.append(h("span.idk-bricks-cap.muted", { title: tt("Glisser une brique pour changer l'ordre : à gauche, devant ; à droite, derrière.") }, tt("devant ▸")),
      ...front.map((l) => {
      const label = nameOf(l);
      return h("div.idk-brick" + (l.n === sel || multi.has(l.n) ? ".on" : ""), { title: tt`${label} · ${l.name} : cliquer pour le choisir, même s'il est caché sous un autre ; glisser pour le passer devant ou derrière`,
        "data-n": l.n,
        on: { click: (e) => { if (brickDrag && brickDrag.moved) return; pickLayer(l); }, pointerdown: (e) => brickDown(e, l),
              contextmenu: (e) => { e.preventDefault(); lockMenu(e, l); } } },
        h("img", { src: url(l), alt: "", draggable: false }), h("span", (l.lock ? "🔒 " : "") + label),
        h("i", { title: tt("Retirer du visage"), on: { pointerdown: (e) => e.stopPropagation(), click: (e) => { e.stopPropagation(); sel = l.n; removeSel(); } } }, "✕"));
    }), h("span.idk-bricks-cap.muted", tt("◂ derrière")));
  };
  // verrou : un element verrouille ne se prend plus sur le portrait (les clics passent au travers) et ne bouge plus ; on le
  // choisit encore par sa brique, pour le regler ou le deverrouiller
  const toggleLock = (l) => { if (l.lock) delete l.lock; else l.lock = true; if (l.lock && sel === l.n) { sel = null; props(); } brickSig = ""; paint(); hist.snap(); };
  const lockMenu = (e, l) => {
    document.querySelector(".menu")?.remove();
    const box = h("div.menu", h("button", { on: { click: () => { box.remove(); toggleLock(l); } } }, l.lock ? tt("🔓 Déverrouiller") : tt("🔒 Verrouiller (ne plus le prendre ni le bouger par erreur)")));
    document.body.append(box);
    const r = box.getBoundingClientRect();
    box.style.left = Math.max(4, Math.min(e.clientX, innerWidth - r.width - 6)) + "px"; box.style.top = Math.max(4, Math.min(e.clientY, innerHeight - r.height - 6)) + "px";
    const off = (ev) => { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener("pointerdown", off, true); } };
    setTimeout(() => document.addEventListener("pointerdown", off, true), 0);
  };
  // glisser une brique : au-dela de 5 px on la deplace ; un trait bleu montre ou elle ira
  let brickDrag = null;
  const brickDown = (e, l) => {
    if (e.button !== 0) return;
    brickDrag = { l, x: e.clientX, y: e.clientY, moved: false, to: null };
    const move = (ev) => {
      const d = brickDrag;
      if (!d) return;
      if (!d.moved && Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 5) return;
      d.moved = true;
      const all = [...bricksBox.querySelectorAll(".idk-brick")];
      all.forEach((b) => b.classList.remove("drop-before", "drop-after", "dragging"));
      bricksBox.querySelector(`.idk-brick[data-n="${l.n}"]`)?.classList.add("dragging");
      let best = null, bd = Infinity;                // la brique la plus proche, et de quel cote de son milieu
      for (const b of all) { const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dist = Math.hypot((ev.clientX - cx) / 2, ev.clientY - cy); if (dist < bd) { bd = dist; best = { b, after: ev.clientX > cx }; } }
      d.to = best;
      if (best) best.b.classList.add(best.after ? "drop-after" : "drop-before");
    };
    const up = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
      const d = brickDrag;
      setTimeout(() => { brickDrag = null; }, 0);   // le clic qui suit un glisser ne choisit pas l'element
      if (!d || !d.moved || !d.to) { bricksBox.querySelectorAll(".idk-brick").forEach((b) => b.classList.remove("drop-before", "drop-after", "dragging")); return; }
      const front = sorted().reverse(), tl = layers.find((x) => x.n === +d.to.b.dataset.n);
      const rest = front.filter((x) => x !== l);
      let at = rest.indexOf(tl); if (at < 0) at = rest.length; else if (d.to.after) at++;
      brickSig = "";
      restack(l, rest.length - at);                  // position dans la liste « devant d'abord » -> rang depuis le fond
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
  };
  // poignees autour de l'element choisi : coins = taille, cotes = etirer, rond du haut = tourner ; taille constante a l'ecran
  const unit = () => { const r = svg.getBoundingClientRect(); return r.width ? S / vz / r.width : 2; };
  // loupe : on montre une partie du cadre (zoom vz, centre vc) ; le portrait, l'export et les places ne changent pas
  let vz = 1, vc = [S / 2, SH / 2], vpan = null, spaceZ = false;
  const view = () => {
    const w = S / vz, hh = SH / vz;
    vc = [Math.max(w / 2, Math.min(S - w / 2, vc[0])), Math.max(hh / 2, Math.min(SH - hh / 2, vc[1]))];
    svg.setAttribute("viewBox", `${(vc[0] - w / 2).toFixed(1)} ${(vc[1] - hh / 2).toFixed(1)} ${w.toFixed(1)} ${hh.toFixed(1)}`);
    if (zoomOut) zoomOut.textContent = Math.round(vz * 100) + " %";
    paint();
  };
  let zoomOut = null;
  const zoomAt = (k, cx, cy) => {
    const z1 = Math.max(1, Math.min(8, vz * k));
    if (z1 === vz) return;
    if (cx != null) { const q = ptAt(cx, cy); vc = [q.x + (vc[0] - q.x) * vz / z1, q.y + (vc[1] - q.y) * vz / z1]; }
    vz = z1; view();
  };
  const grips = () => {
    const l = layers.find((x) => x.n === sel);
    if (!l || multi.size > 1 || l.lock) return "";
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
  // trait constant : coche a cote de la taille ; l'epaisseur de depart est celle que le trait a a ce moment
  const tkRow = (l) => {
    const out = h("output", l.tk ? (+l.tk).toFixed(1) : "");
    const rg = h("input", { type: "range", min: 0.5, max: 30, step: 0.5, value: l.tk || 3, disabled: !l.tk, title: tt("Épaisseur du trait gardée quelle que soit la taille de l'élément (unités de la feuille)"),
      on: { input: (e) => { l.tk = +e.target.value; out.textContent = l.tk.toFixed(1); paint(); }, change: () => hist.snap() } });
    const cb = h("input", { type: "checkbox", checked: !!l.tk, on: { change: async (e) => {
      if (e.target.checked) {
        const im = await loadImg(url(l)), nat = await nativeInk(l);
        l.tk = Math.max(0.5, Math.min(30, Math.round(2 * nat * (l.w * l.kx) / ((im && im.naturalWidth) || 1)) / 2));
        rg.value = l.tk; rg.disabled = false; out.textContent = l.tk.toFixed(1);
      } else { delete l.tk; rg.disabled = true; out.textContent = ""; }
      paint(); hist.snap();
    } } });
    return h("label.row.range.idk-tk", { title: tt("Trait constant : agrandir ou réduire l'élément ne change plus l'épaisseur de son trait") }, cb, tt("Trait constant"), rg, out);
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
      range(tt("Taille"), "w", 30, 950, 1), tkRow(l), range(tt("Largeur"), "kx", 0.2, 4, 0.01, tt("Étire ou resserre l'élément en largeur")), range(tt("Hauteur"), "ky", 0.2, 4, 0.01, tt("Étire ou tasse l'élément en hauteur")),
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
    const spot = (twin) => { const p = it.place || PLACE[cat] || DEFPLACE; return twin ? [S - p[0] + off.x, p[1] + off.y, p[2]] : [p[0] + off.x, p[1] + off.y, p[2]]; };
    const swapIn = (l) => {
      const p = spot(!!(l.twin && it.pair)), old = l.p0 || PLACE[cat] || [l.x, l.y, l.w];
      const ox = old[0] + halfOff(l, old), nx = p[0] + halfOff(l, p);             // une moitie : par rapport a la place de sa moitie
      if (l.x === ox && l.y === old[1] && l.w === old[2] && l.kx === 1 && l.ky === 1) Object.assign(l, { x: nx, y: p[1], w: p[2] });
      else Object.assign(l, { x: l.x + nx - ox, y: l.y + p[1] - old[1], w: Math.round(l.w * p[2] / old[2]) });   // regle a la main : decalage et echelle gardes
      if (!it.pair && l.twin) l.flip = false;
      Object.assign(l, { id: it.id, bank: it.bank || bank, name: it.name, file: it.file, t: it.t || 0, cap: it.cap || null, r, p0: p, twin: !!(l.twin && it.pair) });
    };
    return { spot, swapIn };
  };
  // place de depart d'un calque : celle de son element (p0), sinon celle de la categorie ; le jumeau d'une oreille garde son miroir
  const halfOff = (l, p) => (l.half ? (l.half === "l" ? -1 : 1) * p[2] / 4 : 0);      // une moitie se place a un quart de la largeur
  const home = (l) => { const p = l.p0 || (PLACE[l.cat] ? [PLACE[l.cat][0] + off.x, PLACE[l.cat][1] + off.y, PLACE[l.cat][2]] : DEFPLACE); Object.assign(l, { x: p[0] + halfOff(l, p), y: p[1], w: p[2], kx: 1, ky: 1, rot: 0, flip: !!l.twin }); };
  const put = async (cat, it, quiet) => {
    const r = await ratioOf(it.file, it.t);
    const { spot, swapIn } = swapper(cat, it, r);
    const fresh = (twin) => { const p = spot(twin); return { n: uidN++, cat, id: it.id, bank: it.bank || bank, name: it.name, file: it.file, t: it.t || 0, cap: it.cap || null, r,
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
  const ofBank = (l) => (l.bank || "claude") === bank;
  const marks = () => grid.querySelectorAll("[data-id]").forEach((b) => b.classList.toggle("on", layers.some((l) => l.cat === cur.key && l.id === b.dataset.id && ofBank(l))));
  // onglets des banques : la Banque Claude d'origine, puis celles de David ; ＋ en cree une, ✎ et 🗑 pour celle qui est ouverte
  const bankName = (b) => (b.builtin ? tt("Banque Claude") : b.name);
  const showBanks = () => {
    bankTabs.textContent = "";
    const now = banks.find((b) => b.id === bank) || banks[0];
    bankTabs.append(...banks.map((b) => h("button.mini.idk-bank" + (b.id === bank ? ".on" : ""), { title: b.builtin ? tt("La banque d'origine, faite par Claude") : tt("Une banque à toi : dessine ses éléments avec ✏ Dessiner…"),
      on: { click: () => switchBank(b.id) } }, bankName(b))),
      h("button.mini", { title: tt("Créer une banque vide, dans un nouvel onglet : tu y dessines tes propres éléments"), on: { click: newBank } }, tt("＋ Nouvelle banque")),
      now && !now.builtin ? h("button.mini", { title: tt("Renommer cette banque"), on: { click: renameBank } }, "✎") : "",
      now && !now.builtin ? h("button.mini.danger", { title: tt("Supprimer cette banque (elle est mise de côté, pas détruite)"), on: { click: removeBank } }, "🗑") : "");
  };
  const switchBank = async (id) => {
    if (id === bank && cats) return;
    const was = bank;
    bank = id;
    try { cats = await loadCats(); } catch (e) { bank = was; return toast(e.message, "error"); }
    localStorage.setItem("bw.idk.bank." + kit, bank);
    cur = cur === BODY ? BODY : cats.find((c) => c.key === (cur && cur.key)) || cats[0];
    showBanks(); showCat();
  };
  const newBank = async () => {
    const nm = (prompt(tt("Nom de la nouvelle banque :"), "") || "").trim();
    if (!nm) return;
    try { const b = await post("parts/banks", { name: nm }); banks.push(b); await switchBank(b.id); toast(tt`Banque « ${nm} » créée : dessine ses éléments avec ✏ Dessiner… dans chaque catégorie.`); }
    catch (e) { toast(e.message, "error"); }
  };
  const renameBank = async () => {
    const b = banks.find((x) => x.id === bank);
    const nm = (prompt(tt("Nouveau nom de la banque :"), b ? b.name : "") || "").trim();
    if (!nm || !b) return;
    try { await apiPut("parts/banks/" + bank, { name: nm }); b.name = nm; showBanks(); } catch (e) { toast(e.message, "error"); }
  };
  const removeBank = async () => {
    const b = banks.find((x) => x.id === bank);
    if (!b || !confirm(tt`Supprimer la banque « ${b.name} » ? Elle est mise de côté (data/parts/_retires), pas détruite ; les portraits et corps déjà enregistrés gardent leurs éléments.`)) return;
    try { await del("parts/banks/" + bank); banks = banks.filter((x) => x.id !== b.id); await switchBank("claude"); } catch (e) { toast(e.message, "error"); }
  };
  const showCat = () => {
    tabs.textContent = "";
    tabs.append(...cats.map((c) => h("button.mini" + (c === cur ? ".on" : ""), { on: { click: () => { cur = c; showCat(); } } }, c.label, h("span.count", String(c.items.length)))),
      BODYKIT ? "" : h("button.mini.idk-bodytab" + (cur === BODY ? ".on" : ""), { title: tt("Poser la tête sur un corps : le personnage entier part dans la banque"), on: { click: () => { cur = BODY; showCat(); } } }, BODY.label));
    grid.textContent = "";
    if (cur === BODY) { showBodies(); return; }
    const fixed = (it) => BODYKIT && bank === "claude" && !it.mine;   // corps encres d'origine et leurs elements decoupes : ils restent
    grid.append(...cur.items.map((it) => h("button.idk-el", { "data-id": it.id, title: it.name + (it.mine ? tt(" (dessiné ici)") : ""), on: { click: () => put(cur.key, it) } },
      h("img", { src: `/parts/${it.file}?t=${it.t || 0}`, loading: "lazy", alt: "" }), h("span", it.name),
      h("b.edit", { title: it.mine && it.editable ? tt("Éditer ce dessin (ses calques se rouvrent)") : tt("Éditer : retoucher par-dessus cette image ; donne un nouvel élément, l'original reste"), on: { click: (e) => { e.stopPropagation(); editElement(cur.key, it); } } }, "✏"),
      fixed(it) ? "" : h("i", { title: tt("Retirer cet élément de la banque (il est mis de côté, pas détruit)"), on: { click: async (e) => {
        e.stopPropagation();
        if (!confirm(tt`Retirer « ${it.name} » de la banque d'éléments ?`)) return;
        try { await del(`parts/${cur.key}/${it.id}?bank=${encodeURIComponent(bank)}`); cur.items = cur.items.filter((x) => x !== it); layers = layers.filter((l) => !(l.cat === cur.key && l.id === it.id && ofBank(l))); paint(); props(); showCat(); }
        catch (err) { toast(err.message, "error"); }
      } } }, "✕"))),
      h("button.idk-el.add", { title: tt("Dessiner soi-même un élément de cette catégorie, avec calques, pinceaux et images importées : il s'ajoute à la banque ouverte"), on: { click: () => editElement(cur.key, null) } }, h("b", "✏"), h("span", tt("Dessiner…"))));
    if (!cur.items.length) grid.prepend(h("p.muted", bank === "claude" ? tt("Aucun élément dans cette catégorie pour l'instant.") : tt("Banque encore vide dans cette catégorie : ✏ Dessiner… pour créer le premier élément.")));
    marks();
  };
  // l'element dessine, en PNG transparent couvrant toute la feuille (1000 pixels de large) : l'image retouchee dessous
  const pngOf = async (d, under) => {
    const wpx = 1000, hpx = Math.round(1000 * SH / S), c = document.createElement("canvas"); c.width = wpx; c.height = hpx;
    const x = c.getContext("2d");
    if (under) {                                    // l'image retouchee, a sa place, sous le dessin
      const u = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = under.url; });
      if (u) x.drawImage(u, under.x * wpx, under.y * hpx, under.w * wpx, under.h * hpx);
    }
    const im = d.shapes.length ? await drawImage(d, wpx, hpx) : null;
    if (d.shapes.length && !im) return null;
    if (im) x.drawImage(im, 0, 0, wpx, hpx);
    return new Promise((ok) => c.toBlob(ok, "image/png"));
  };
  // dessiner un element (it = null) ou l'editer : un dessin de l'atelier se rouvre avec ses calques et se remplace ; un
  // element tout fait (ou un ancien dessin sans formes) s'ouvre en fond et donne un NOUVEL element, l'original reste intact.
  // Un nouvel element va dans la banque ouverte ; l'enregistrement est un PNG transparent, couleurs gardees.
  const editElement = async (catKey, it) => {
    const cat = cats.find((c) => c.key === catKey);
    if (!cat) return;
    const eb = (it && it.bank) || bank;
    let meta = null;
    if (it && it.mine && it.editable) { try { meta = await get(`parts/${catKey}/${it.id}?bank=${encodeURIComponent(eb)}`); } catch (e) { meta = null; } }
    const own = !!(meta && ((meta.layers || []).length || (meta.shapes || []).length)), pair = !!((it && it.pair) || (meta && meta.pair));
    let under = null;
    if (own) under = meta.under || null;
    else if (it) { const r = await ratioOf(it.file, it.t), p = it.place || PLACE[catKey] || DEFPLACE;
      under = { url: `/parts/${it.file}?t=${it.t || 0}`, x: (p[0] - p[2] / 2) / S, y: (p[1] - p[2] * r / 2) / SH, w: p[2] / S, h: p[2] * r / SH }; }
    const fillBox = h("input", { type: "checkbox", checked: meta && meta.fill != null ? !!meta.fill : !!cat.fill });
    const extra = h("label.row.check.idk-fill", { title: tt("Coché : le blanc enfermé par le contour devient opaque et cache ce qui est dessous (un visage, des cheveux). Décoché : seul ce qui est dessiné compte, le reste est transparent.") },
      fillBox, tt("Intérieur des contours opaque (blanc)"));
    const draw = own ? ((meta.layers || []).length ? { layers: meta.layers } : { shapes: meta.shapes }) : null;
    openDrawEditor({ draw, ratio: SH / S, backdrop: null, under, axis: K.PAIRCATS.includes(catKey), layers: true, kit: true, extra,
      title: it ? tt`Éditer : ${it.name}` : tt`Dessiner : ${cat.label}`,
      saveLabel: own ? tt("Enregistrer l'élément") : it ? tt("Enregistrer comme nouvel élément") : tt("Ajouter à la banque d'éléments"),
      onSave: async (d) => {
        if (!d.shapes.length && !under) return toast(tt("Rien à enregistrer : le dessin est vide."), "error");
        let nm = it ? it.name : "";
        if (!own) {
          nm = (prompt(it ? tt("Nom du nouvel élément (l'original reste dans la banque) :") : tt("Nom de cet élément :"), it ? tt`${it.name} (retouché)` : cat.label + tt(" dessiné")) || "").trim();
          if (!nm) return;
        }
        const tb = own ? eb : bank;
        const blob = await pngOf(d, under);
        if (!blob) return toast(tt("Le dessin n'a pas pu être converti en image."), "error");
        try {
          const q = new URLSearchParams({ name: nm, bank: tb, fill: fillBox.checked ? "1" : "0" });
          if (own) q.set("replace", it.id);
          const nu = await upload(`parts/${catKey}?${q}`, blob);
          await apiPut(`parts/${catKey}/${nu.id}?bank=${encodeURIComponent(tb)}`, { layers: d.layers || [{ name: tt("Calque 1"), shapes: d.shapes }], under, pair, fill: fillBox.checked });
          nu.editable = true; nu.pair = pair; nu.bank = tb;
          if (tb === bank) { const i = cat.items.findIndex((x) => x.id === nu.id); if (i >= 0) cat.items[i] = nu; else cat.items.push(nu); }
          if (it) {
            const nr = await ratioOf(nu.file, nu.t), { swapIn } = swapper(catKey, nu, nr);
            layers.filter((l) => l.cat === catKey && l.id === it.id && (l.bank || "claude") === eb).forEach(swapIn);   // les calques passent a l'element edite
          }
          brickSig = ""; cur = cat; showCat(); paint(); props(); hist.snap();
          if (!it) put(catKey, nu);
          toast(own ? tt`« ${nm} » est mis à jour.` : it ? tt`« ${nm} » est ajouté à la banque d'éléments ; l'original n'a pas changé.` : tt`« ${nm} » est ajouté à la banque.`);
        } catch (e) { toast(tt("Élément refusé : ") + e.message, "error"); }
      } });
  };
  const editPart = editElement;
  const itemOf = (l) => (ofBank(l) && (cats.find((c) => c.key === l.cat) || { items: [] }).items.find((x) => x.id === l.id)) || { id: l.id, bank: l.bank || "claude", name: l.name, file: l.file, t: l.t, mine: false, place: l.p0 };
  // souris : glisser un element pose, molette pour sa taille
  const ptAt = (cx, cy) => { const m = svg.getScreenCTM(); if (m) { const q = new DOMPoint(cx, cy).matrixTransform(m.inverse()); return { x: q.x, y: q.y }; } const r = svg.getBoundingClientRect(); return { x: (cx - r.left) / r.width * S, y: (cy - r.top) / r.height * SH }; };
  const pt = (e) => ptAt(e.clientX, e.clientY);
  svg.addEventListener("pointerdown", (e) => {
    if (e.button === 1 || (spaceZ && e.button === 0)) {   // loupe : faire glisser la vue
      e.preventDefault(); const m = svg.getScreenCTM(); vpan = { x: e.clientX, y: e.clientY, c: vc.slice(), k: m ? m.a : 1 }; svg.setPointerCapture(e.pointerId); return;
    }
    if (e.button === 2) return;                     // clic droit : le menu s'en charge
    if (moveAll) {                                  // « Deplacer tout » : le visage entier suit la souris
      if (!layers.length) return;
      svg.setPointerCapture(e.pointerId); drag = { all: true, p: pt(e), done: { x: 0, y: 0 } };
      e.preventDefault(); return;
    }
    const tn = +(e.target.dataset && e.target.dataset.n), tl = layers.find((x) => x.n === tn);
    if (erasing) {                                  // gomme : sur l'element choisi, sinon celui qu'on touche
      const l = layers.find((x) => x.n === sel) || tl;
      if (!l) { toast(tt("Gomme : choisis d'abord l'élément à gommer (clic dessus).")); return; }
      if (sel !== l.n) { sel = l.n; props(); }
      const q = local(l, pt(e)), W = l.w * l.kx, hh = boxH(l);
      const s = { w: +(eraseW / hh).toFixed(4), p: [[+((q.x - imgX(l)) / W).toFixed(4), +((q.y + hh / 2) / hh).toFixed(4)]] };
      (l.er = l.er || []).push(s);
      svg.setPointerCapture(e.pointerId); drag = { erase: s, l }; paint(); e.preventDefault(); return;
    }
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
    if (vpan) { vc = [vpan.c[0] - (e.clientX - vpan.x) / vpan.k, vpan.c[1] - (e.clientY - vpan.y) / vpan.k]; view(); return; }
    if (!drag) return;
    const p = pt(e), l = drag.l;
    if (drag.erase) {
      const q = local(l, p), W = l.w * l.kx, hh = boxH(l), u = +((q.x - imgX(l)) / W).toFixed(4), v = +((q.y + hh / 2) / hh).toFixed(4), last = drag.erase.p[drag.erase.p.length - 1];
      if (Math.hypot((u - last[0]) * W, (v - last[1]) * hh) > 2) { drag.erase.p.push([u, v]); paint(); }
      return;
    }
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
    if (vpan) { vpan = null; return; }
    if (drag && drag.band) {                        // les elements touches par le rectangle
      const x0 = Math.min(band.x0, band.x1), x1 = Math.max(band.x0, band.x1), y0 = Math.min(band.y0, band.y1), y1 = Math.max(band.y0, band.y1);
      band = null; drag = null;
      if (x1 - x0 > 4 || y1 - y0 > 4) {
        const hit = layers.filter((l) => { const b = aabb(l); return !l.lock && b[0] < x1 && b[2] > x0 && b[1] < y1 && b[3] > y0; });
        if (hit.length === 1) { sel = hit[0].n; userSel = true; } else hit.forEach((l) => multi.add(l.n));
      }
      paint(); props(); return;
    }
    if (drag) { drag = null; hist.snap(); }
  });
  svg.addEventListener("wheel", (e) => { const l = layers.find((x) => x.n === sel);
    if (e.ctrlKey || e.metaKey || !l || multi.size > 1) { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0016), e.clientX, e.clientY); return; }   // loupe
    if (l.lock) return; e.preventDefault(); l.w = Math.round(Math.min(950, Math.max(30, l.w * (e.deltaY < 0 ? 1.05 : 0.95)))); paint(); sync(); }, { passive: false });
  // clic droit dans le portrait : les gestes de l'element sous la souris (s'il y en a un), puis la liste de tous les
  // elements poses, pour en choisir un sans le chercher dans les briques du bas (meme cache sous un autre)
  svg.addEventListener("contextmenu", (e) => {
    const n = +(e.target.dataset && e.target.dataset.n), l = layers.find((x) => x.n === n) || (e.target.dataset?.h && layers.find((x) => x.n === sel));
    e.preventDefault();
    if (!l && !layers.length) return;
    if (l && (sel !== l.n || multi.size)) { sel = l.n; multi.clear(); paint(); props(); }
    const same = l ? sorted().filter((x) => x.cat === l.cat) : [], i = l ? same.indexOf(l) : -1;
    const swap = (o) => { [l.n, o.n] = [o.n, l.n]; [l.z, o.z] = [o.z, l.z]; if (l.z == null) delete l.z; if (o.z == null) delete o.z; sel = l.n; paint(); props(); };
    const items = !l ? [] : [[tt("⇋ Miroir"), () => { l.flip = !l.flip; paint(); }],
      [tt("↺ Place de départ"), () => { home(l); paint(); props(); }],
      [tt("✏ Éditer"), () => editPart(l.cat, itemOf(l))],
      SPLIT.has(l.cat) && !l.half ? [tt("✂ Séparer"), () => split(l)] : null,
      l.half ? [tt("⧉ Réunir"), () => join(l)] : null,
      i < same.length - 1 ? [tt("▲ Monter d'un cran"), () => swap(same[i + 1])] : null,
      i > 0 ? [tt("▼ Descendre d'un cran"), () => swap(same[i - 1])] : null,
      [l.lock ? tt("🔓 Déverrouiller") : tt("🔒 Verrouiller"), () => toggleLock(l)],
      [tt("✕ Retirer du visage"), removeSel, true]].filter(Boolean);
    document.querySelector(".menu")?.remove();
    // la liste, du devant vers le derriere ; ▲ / ▼ changent l'ordre sans fermer le menu
    const listBox = h("div.idk-ctx-list");
    const fill = () => {
      listBox.textContent = "";
      const list = sorted().reverse(), N = list.length;
      const step = (e, x, d) => { e.stopPropagation(); const i = list.indexOf(x); restack(x, N - 1 - (i + d)); fill(); };
      listBox.append(...list.map((x, i) => h("div.idk-ctx-row" + (x.n === sel || multi.has(x.n) ? ".on" : ""), { title: tt`${nameOf(x)} · ${x.name} : le choisir, même s'il est caché sous un autre`,
        on: { click: () => { box.remove(); pickLayer(x); } } }, h("img", { src: url(x), alt: "", draggable: false }), h("span", nameOf(x)), h("small.muted", x.name),
        h("button.idk-ord", { type: "button", title: tt("Passer devant l'élément du dessus"), disabled: i === 0, on: { click: (e) => step(e, x, -1) } }, "▲"),
        h("button.idk-ord", { type: "button", title: tt("Passer derrière l'élément du dessous"), disabled: i === N - 1, on: { click: (e) => step(e, x, 1) } }, "▼"))));
    };
    fill();
    const N0 = layers.length;
    const box = h("div.menu.mt-menu.idk-ctx", items.map(([label, fn, danger]) => h("button" + (danger ? ".danger" : ""), { on: { click: () => { box.remove(); fn(); hist.snap(); } } }, label)),
      N0 ? h("div.mhead", tt`Éléments du visage (${N0}) · en haut = devant`) : "", N0 ? listBox : "",
      N0 && layers.some((x) => x.z != null) ? h("button", { title: tt("Remet l'empilement d'origine : visage derrière, puis bouche, nez, yeux, sourcils, cheveux…"), on: { click: () => { unstack(); fill(); } } }, tt("↺ Ordre par défaut")) : "");
    document.body.append(box);
    const r = box.getBoundingClientRect();
    box.style.left = Math.max(4, Math.min(e.clientX, innerWidth - r.width - 6)) + "px";
    box.style.top = Math.max(4, Math.min(e.clientY, innerHeight - r.height - 6)) + "px";
    const close = (ev) => { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener("pointerdown", close, true); } };
    setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
  });
  // annuler (Ctrl+Z, 15 pas) : ajout, retrait, deplacement, taille, rotation, miroir des elements ; pas la selection
  const hist = history(() => ({ layers, off, pm: photo ? [photo.M[0][2], photo.M[1][2]] : null }), (st) => {
    layers = st.layers; off = st.off || { x: 0, y: 0 }; document.querySelector(".idk-ctx")?.remove();   // une liste ouverte ne montrerait plus le bon ordre
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
    if (mv) { e.preventDefault(); const mov = (group || [l]).filter((x) => !x.lock); if (!mov.length) return; shiftBy(mov, mv[0], mv[1], false); paint(); hist.snap(); }
  };
  document.addEventListener("keydown", onKey);

  const random = async () => {
    layers = []; sel = null; multi.clear();
    const got = {};                                 // bras et mains suivent le torse tire : les epaules d'un corps vont avec ses bras
    const pick = async (key) => {
      const c = cats.find((k) => k.key === key);
      if (!c || !c.items.length) return;
      const lead = K.follow && got[K.follow[key]], it = (lead && c.items.find((x) => x.id === lead)) || c.items[Math.floor(Math.random() * c.items.length)];
      got[key] = it.id;
      await put(key, it, true);
    };
    // corps : un corps entier, ou bien un torse, des bras, des jambes… tires chacun dans un corps different
    const parts = K.random[1].filter((key) => (cats.find((k) => k.key === key) || { items: [] }).items.length);
    const whole = K.whole && (!parts.length || Math.random() < 0.35);
    if (whole) await pick(K.whole);
    for (const key of K.random[0]) await pick(key);
    if (!whole) for (const key of K.random[1]) if (K.whole || Math.random() < 0.3) await pick(key);
    sel = null; paint(); props(); hist.snap();                      // un tirage = une seule etape
  };
  // l'image du visage monte, elements dans l'ordre : wpx x hpx pixels, k = wpx / 1000 ; white : fond blanc (sinon
  // transparent, pour poser la tete sur un corps : cadre 1000 x 1300 de l'atelier, menton en y = 880)
  // crop : l'image est rognee autour du dessin, avec une marge (le corps n'occupe pas toute sa feuille)
  const render = async (wpx = 1024, hpx = Math.round(1024 * SH / S), white = true, type = "image/png", crop = false) => {
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
      const tkc = l.tk ? await strokeCanvas(l, k) : null;
      const im = tkc ? tkc.canvas : await loadImg(url(l));
      if (!im) continue;
      const W = l.w * l.kx * k, hh = boxH(l) * k, bw = boxW(l) * k, pk = tkc ? tkc.pad * k : 0;
      const er = (l.er || []).length, lc = er ? document.createElement("canvas") : null;
      if (lc) { lc.width = wpx; lc.height = hpx; }
      const y = lc ? lc.getContext("2d") : x;
      y.save(); y.translate(l.x * k, l.y * k); y.rotate(l.rot * Math.PI / 180); y.scale(l.flip ? -1 : 1, 1);
      if (l.half) { y.beginPath(); y.rect(-bw / 2, -hh / 2, bw, hh); y.clip(); }      // une moitie : seulement sa moitie de l'image
      y.drawImage(im, imgX(l) * k - pk, -hh / 2 - pk, W + 2 * pk, hh + 2 * pk);
      if (lc) {                                     // gomme : les coups effacent l'element seul
        y.globalCompositeOperation = "destination-out"; y.strokeStyle = "#000"; y.fillStyle = "#000"; y.lineCap = "round"; y.lineJoin = "round";
        for (const s of l.er) {
          const q = erasePts(l, s).map(([a, b]) => [a * k, b * k]); y.lineWidth = s.w * boxH(l) * k;
          if (q.length === 1) { y.beginPath(); y.arc(q[0][0], q[0][1], y.lineWidth / 2, 0, 7); y.fill(); }
          else { y.beginPath(); q.forEach((p, i) => (i ? y.lineTo(p[0], p[1]) : y.moveTo(p[0], p[1]))); y.stroke(); }
        }
      }
      y.restore();
      if (lc) x.drawImage(lc, 0, 0);
    }
    let src = a;
    if (crop) {                                     // la boite du dessin, plus 4 % de marge
      const px = x.getImageData(0, 0, wpx, hpx).data;
      let x0 = wpx, y0 = hpx, x1 = -1, y1 = -1;
      for (let yy = 0; yy < hpx; yy += 2) for (let xx = 0; xx < wpx; xx += 2) if (px[(yy * wpx + xx) * 4 + 3] > 16) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
      if (x1 > x0 && y1 > y0) {
        const m = Math.round(0.04 * Math.max(x1 - x0, y1 - y0));
        x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(wpx, x1 + m); y1 = Math.min(hpx, y1 + m);
        src = document.createElement("canvas"); src.width = x1 - x0; src.height = y1 - y0;
        src.getContext("2d").drawImage(a, -x0, -y0);
        c.width = src.width; c.height = src.height;
      }
    }
    const out = c.getContext("2d");
    if (white) { out.fillStyle = "#fff"; out.fillRect(0, 0, c.width, c.height); }
    out.drawImage(src, 0, 0);
    return new Promise((ok) => c.toBlob(ok, type, 0.92));
  };
  // la tete composee, envoyee au generateur de corps : rangee dans « Tête » (Banque Claude), posee sur un corps a choisir
  const toBody = async () => {
    if (!layers.length) return toast(tt("Pose d'abord une tête."), "error");
    try {
      sel = null; multi.clear(); paint();
      const head = await upload(`parts/heads?${new URLSearchParams({ name: name.value.trim() || tt("Tête") })}`, await render(1000, 1000, false));
      openIdentikit(bankUI, null, { kit: "corps", head: Object.assign(head, { bank: "claude" }), name: name.value.trim() });
    } catch (e) { toast(e.message, "error"); }
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
  // gomme : efface des bouts de l'element choisi (un bout de cheveux...) ; Ctrl+Z annule un coup
  const eraseBtn = h("button.mini", { title: tt("Gomme : glisser sur l'élément choisi efface ses parties (un bout de cheveux…). Ctrl+Z annule un coup. Clic encore : arrêter.") }, tt("⌫ Gomme"));
  const eraseOut = h("output", String(eraseW));
  const eraseRange = h("input", { type: "range", min: 4, max: 120, step: 1, value: eraseW, title: tt("Taille de la gomme"), on: { input: (e) => { eraseW = +e.target.value; eraseOut.textContent = String(eraseW); } } });
  const eraseClear = h("button.mini", { title: tt("Remet l'élément choisi entier : retire tous ses coups de gomme") , on: { click: () => { const l = layers.find((x) => x.n === sel); if (!l || !(l.er || []).length) return toast(tt("Rien à rétablir sur cet élément.")); delete l.er; paint(); hist.snap(); } } }, tt("↺ Dégommer"));
  const eraseBox = h("span.row.idk-erase", eraseBtn, eraseRange, eraseOut, eraseClear);
  eraseBtn.addEventListener("click", () => { erasing = !erasing; eraseBtn.classList.toggle("on", erasing); svg.style.cursor = erasing ? "crosshair" : ""; if (erasing) toast(tt("Gomme : glisse sur l'élément choisi.")); });
  zoomOut = h("output.idk-zoomval", "100 %");
  const zoomBar = h("div.idk-zoom", { title: tt("Loupe : Ctrl + molette (ou molette sans élément choisi) autour du pointeur ; se déplacer : bouton du milieu, ou Espace + glisser") },
    h("button.mini", { type: "button", on: { click: () => zoomAt(1 / 1.4) } }, "－"), zoomOut, h("button.mini", { type: "button", on: { click: () => zoomAt(1.4) } }, "＋"),
    h("button.mini", { type: "button", title: tt("Tout le portrait"), on: { click: () => { vz = 1; vc = [S / 2, SH / 2]; view(); } } }, "⤢"));
  const keyZ = (e) => { if (!document.body.contains(svg)) { document.removeEventListener("keydown", keyZ, true); document.removeEventListener("keyup", keyZ, true); return; }
    if (e.key !== " " || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return; e.preventDefault(); spaceZ = e.type === "keydown"; svg.style.cursor = spaceZ ? "grab" : ""; };
  document.addEventListener("keydown", keyZ, true); document.addEventListener("keyup", keyZ, true);
  const moveBtn = h("button.mini.idk-moveall", { title: tt("Déplacer tout : tant que ce bouton est allumé, glisser sur le portrait déplace tous les éléments ensemble (Échap pour arrêter)"),
    on: { click: () => { moveAll = !moveAll; moveBtn.classList.toggle("on", moveAll); if (moveAll) { sel = null; multi.clear(); } paint(); props(); } } }, "✥");
  // exporter le portrait compose : PNG transparent ou JPEG sur blanc, 2 pixels par unite du cadre
  const exportMenu = (e) => {
    document.querySelector(".menu")?.remove();
    const go = async (fmt) => {
      box.remove();
      if (!layers.length) return toast(tt("Pose au moins un élément."), "error");
      const jpg = fmt === "jpg", blob = await render(2 * S, 2 * SH, jpg, jpg ? "image/jpeg" : "image/png", BODYKIT);
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
  // rendu photoreliste du portrait affiche (GPT Image 2.6 Sunburst, fal) : la forme du dessin est gardee a l'identique
  // trois modeles a comparer, chacun son gros bouton et sa colonne de resultat
  const REAL_MODELS = [["gpt", tt("Généré par GPT Image 2.6"), "≈ 0,06 $"], ["seedream", tt("Généré par Seedream 5.5"), "≈ 0,04 $"]];
  const realistic = () => {
    const prompt = h("textarea", { rows: 7 }); prompt.value = REAL_PROMPT;
    const cols = h("div.idk-realcols");
    const column = ([key, label, cost]) => {
      const out = h("div.idk-real"), go = h("button.primary.idk-realgo", { type: "button" }, `${label} · ${cost}`);
      let last = null;
      go.addEventListener("click", async () => {
      if (!layers.length) return toast(tt("Le portrait est vide."), "error");
      go.disabled = true; go.textContent = tt("⏳ Génération… (environ une minute)");
      try {
        const blob = await render(1024, Math.round(1024 * SH / S), true);
        const uri = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
        const txt = prompt.value.trim() + (key !== "gpt" ? " " + NANO_TAIL : "");      // Seedream redresse l'anatomie : on leur rappelle que c'est un dessin
        const r = await post("portrait/realistic", { image: uri, prompt: txt, model: key });
        last = r.image;
        out.textContent = "";
        out.append(h("img", { src: r.image, alt: "" }), h("div.row.wrap",
          h("button.mini", { type: "button", on: { click: () => { const a = h("a", { href: last, download: (name.value.trim() || "portrait") + "-photo.png" }); document.body.append(a); a.click(); a.remove(); } } }, tt("⬇ Télécharger")),
          h("button.mini", { type: "button", title: tt("Range la photo comme nouveau personnage (rendu photoréaliste) dans la banque"), on: { click: async () => {
            const nm = window.prompt(tt("Nom du personnage :"), (name.value.trim() || tt("Portrait")) + tt(" (photo)"));
            if (!nm) return;
            const b = await (await fetch(last)).blob();
            try { await upload("bank?" + new URLSearchParams({ kind: "character", name: nm.trim(), style: "photo", facing: "face", orbit: "0", target: "auto", file: "photo.png" }), b);
              bankUI.tab = "character"; await bankUI.reload(); toast(tt`« ${nm.trim()} » est dans la banque (Personnages).`); } catch (e) { toast(tt("Refusé : ") + e.message, "error"); }
          } } }, tt("⇪ Ranger dans la banque"))));
      } catch (e) { toast(label + " : " + e.message, "error"); }
      go.disabled = false; go.textContent = `${label} · ${cost}`;
      });
      return h("div.idk-realcol", go, out);
    };
    REAL_MODELS.forEach((mdl) => cols.append(column(mdl)));
    modal(tt("Portrait en photo : comparer deux modèles"), h("div.form.idk-realform",
      h("p.muted", tt("Le portrait tel qu'il est affiché part à fal avec cette consigne. Chaque bouton lance son modèle (payant, une minute environ) ; on peut lancer les deux et comparer.")),
      h("label.col", tt("Consigne"), prompt), cols), [{ label: tt("Fermer") }]).box.classList.add("wide");
  };
  // composition gardee dans l'element de banque, pour le rouvrir ici
  const composition = (withBody) => Object.assign({ v: 1, layers: JSON.parse(JSON.stringify(layers)), off, body: withBody ? bodyPick : null }, BODYKIT ? { kit: "corps" } : null);
  // petit choix a deux reponses (null si on annule)
  const choose = (title, text, opts, warn) => new Promise((ok) => {
    modal(title, h("div.form", h("p", text), warn ? h("p.idk-warn", warn) : null), [{ label: tt("Annuler"), click: () => ok(null) }, ...opts.map(([v, l]) => ({ label: l, primary: true, click: () => ok(v) }))]);
  });
  const head = BODYKIT ? tt("Générateur de corps") : tt("Portrait-robot");
  const m = modal(edit && edit.item ? `${head} : ${edit.item.name}` : head, h("div.idk" + (BODYKIT ? ".idk-corps" : ""),
    h("div.idk-left", h("div.idk-stagewrap", svg, moveBtn, zoomBar), stageBgControl(() => paint()), bricksBox, h("div.row.wrap", h("button.mini", { title: BODYKIT ? tt("Tire un corps au hasard dans la banque ouverte") : tt("Tire un visage au hasard dans la banque"), on: { click: random } }, tt("🎲 Au hasard")),
      BODYKIT ? "" : h("button.mini", { title: tt("Reconstruit le visage d'une photo de face avec les éléments du portrait-robot. La photo reste dans ce navigateur : seuls les points du visage partent."), on: { click: () => fileIn.click() } }, tt("📷 Transposer un portrait…")), BODYKIT ? "" : fileIn,
      h("button.mini", { on: { click: () => { layers = []; sel = null; multi.clear(); paint(); props(); marks(); } } }, tt("Tout retirer")),
      eraseBox,
      h("button.mini", { title: tt("Télécharge le portrait tel qu'il est affiché, en pleine définition, sans les poignées"), on: { click: (e) => exportMenu(e) } }, tt("⬇ Exporter le portrait ▾")),
      h("button.mini", { title: tt("Rendu photoréaliste du portrait tel qu'il est, en gardant exactement la forme du dessin (GPT Image 2.6 Sunburst sur fal, payant)"), on: { click: () => realistic() } }, tt("✨ Generate (photo)"))), photoBox, knobs),
    h("div.idk-right", h("label.row", tt("Nom"), name), bankTabs, tabs, grid)),
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
      if (bodyPick && !BODYKIT) {
        const c = await choose(tt("Ajouter à la banque"), tt("Le personnage entier, avec le corps choisi, ou seulement la tête ?"), [["head", tt("Tête seule")], ["body", tt("Avec ce corps")]]);
        if (!c) return false;
        withBody = c === "body";
      }
      if (replace) {
        try {
          sel = null; multi.clear(); paint();
          const blob = withBody ? await composeBody() : await render(1024, Math.round(1024 * SH / S), true, "image/png", BODYKIT);
          const id = edit.item.id;
          await upload(`bank/${id}/rebase`, blob);
          edit.item = await apiPut("bank/" + id, { identikit: composition(withBody) });
          bankUI.tab = "character"; await bankUI.reload(); bankUI.reveal(id);
          toast(tt`L'image de base de « ${edit.item.name} » est remplacée. Rien n'est relancé : détourage et orbite se refont depuis sa fiche.`, "info", 9000);
        } catch (e) { toast(tt("Portrait refusé : ") + e.message, "error", 9000); }
        return false;                               // l'atelier reste ouvert
      }
      const orbit = confirm(tt("Préparer sa tournette 360° ?\nD'abord sa planche de vues (dos, profil, trois-quarts dos), contrôlée contre le dessin ; la tournette ne part qu'une fois la planche validée (dans sa fiche si le contrôle automatique n'est pas là).\nAnnuler : il reste une image fixe."));
      try {
        sel = null; multi.clear(); paint();
        const blob = withBody ? await composeBody() : await render(1024, Math.round(1024 * SH / S), true, "image/png", BODYKIT);
        const it = await upload("bank?" + new URLSearchParams({ kind: "character", name: nm, style: "dessin", facing: "face", orbit: "0", file: withBody || BODYKIT ? "personnage.png" : "portrait.png", folder: "Portraits-robots" }), blob);
        try { await apiPut("bank/" + it.id, { identikit: composition(withBody) }); }   // pour le rouvrir dans l'atelier
        catch (e) { toast(tt("Composition non gardée : ") + e.message, "error"); }
        if (orbit) await post(`bank/${it.id}/sheet`, { gate: true, target: "auto" });   // planche controlee d'abord, la tournette apres validation
        bankUI.tab = "character"; await bankUI.reload(); bankUI.reveal(it.id); bankUI.app.pollSoon();
        toast(tt`« ${nm} » est dans la banque, dossier Portraits-robots.` + (orbit ? tt(" Sa planche de vues est en calcul ; la tournette partira une fois la planche validée.") : ""));
      } catch (e) { toast(tt("Portrait refusé : ") + e.message, "error", 9000); return false; }
    } }]);
  m.box.classList.add("wide", "idk-box");
  // « Composer un corps » : le bouton important, en bas a droite a cote de « Fermer »
  if (!BODYKIT) m.box.querySelector("footer").prepend(h("button.idk-tobody", { title: tt("Ouvre le générateur de corps avec cette tête : torse, bras, jambes, chaussures… à assembler ou à dessiner"), on: { click: toBody } }, tt("🧍 Composer un corps…")));
  hist.watch(m.box);                                // chaque geste dans la fenetre note l'etat (souris, curseurs, menus)
  if (BODYKIT) m.box.classList.add("idk-corpsbox");
  if (opts.name && !name.value) name.value = opts.name;
  showBanks(); showCat(); paint(); props();
  if (opts.head) { const tc = cats.find((c) => c.key === "tete"); if (tc && bank === "claude" && !tc.items.some((x) => x.id === opts.head.id)) tc.items.push(opts.head); await put("tete", opts.head); }
}

