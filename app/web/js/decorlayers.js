// Decor retouche en calques. L'atelier de dessin s'ouvre sur l'image du decor (ou sur une version deja en calques, qu'il
// rouvre telle quelle) ; l'enregistrement en fait une version du decor : une variante de plus, qui garde le document de
// l'atelier (retouch.draw) et un fichier par calque (planes). Posee dans une case, le calque du bas devient le fond
// (pan.bg.v = "<version>~<plan>") et chacun des autres un element de la case (meme notation dans l.v), avec sa
// profondeur l.d : il se deplace a la souris, se regle dans la vue de dessus « Profondeur », bouge en parallaxe au
// montage et s'aplatit comme n'importe quel element. Un decor 360 : seule l'image vue est retouchee, la version est fixe.
import { tt, tr } from "./i18n.js";
import { post, upload, toast } from "./api.js";
import { openDrawEditor, drawImage } from "./draw.js";
import { sprite, uid, placement, depthOf } from "./model.js";

/** Calque de case qui est un plan d'un decor en calques. */
export const isPlane = (l) => !!l && typeof l.v === "string" && l.v.includes("~");
/** La version (variante) d'un identifiant de plan "<version>~<plan>". */
export const versionOf = (v) => String(v || "base").split("~")[0];
const f4 = (x) => +(+x).toFixed(4);

const loadImg = (url) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = url; });
// l'image de depart copiee dans les images de l'atelier (nommees par leur contenu) : la version se rouvre meme si la
// variante d'origine est refaite ou supprimee
async function stableHref(url) {
  try {
    const b = await (await fetch(url)).blob();
    return (await upload("parts/assets", new File([b], "decor.png", { type: b.type || "image/png" }))).url;
  } catch (e) { return url; }
}
const canvasOf = async (layers, w, h) => {
  const im = await drawImage({ layers }, w, h);
  if (!im) return null;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(im, 0, 0, w, h);
  return c;
};
// boite de ce que contient un calque (pixels non transparents), un peu elargie ; null s'il est vide
function alphaBox(c) {
  const w = c.width, h = c.height, a = c.getContext("2d").getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) if (a[row + x * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(w - 1, x1 + 2); y1 = Math.min(h - 1, y1 + 2);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** « Retoucher le décor (calques) » : ouvre l'atelier sur la variante vid (image f de son orbite) du decor itemId, ou
 *  rouvre ses calques si c'est deja une version en calques. onSaved(nouvelle version, element) a l'enregistrement. */
export async function openDecorRetouch(app, { itemId, vid = "base", f = 0, onSaved }) {
  const item = app.bank.get(itemId);
  if (!item || item.kind !== "decor") return toast(tt("Ce n'est pas un décor de la banque."), "error");
  const ver = item.variants[versionOf(vid)] ? versionOf(vid) : "base", v = item.variants[ver];
  let draw, iw, ih, from = ver;
  const rt = v.retouch;
  if (rt && rt.draw && (rt.draw.layers || []).length) {
    draw = JSON.parse(JSON.stringify(rt.draw)); iw = rt.w; ih = rt.h; f = rt.f || 0; from = v.from || ver;
  } else {
    const sp = sprite(item, ver, f), im = sp && await loadImg(sp.url);
    if (!im) return toast(tt("L'image du décor n'a pas pu être chargée."), "error");
    iw = im.naturalWidth; ih = im.naturalHeight;
    draw = { layers: [
      { id: uid(), name: tt("Décor"), shapes: [{ id: uid(), t: "img", href: await stableHref(sp.url), p: [[0, 0], [1, 1]], ink: "none", iop: 1, ar: ih / iw }] },
      { id: uid(), name: tt("Calque 2"), shapes: [] }] };
  }
  const n = v.orbit && v.orbit.n;
  const title = tt`Retoucher le décor en calques : ${item.name} · ${tr(v.label)}` + (n ? tt` · image ${(f % n) + 1}/${n} (la version sera une image fixe, sans orbite)` : "") +
    (rt ? tt(" · version en calques rouverte") : "");
  openDrawEditor({ draw, ratio: ih / iw, backdrop: null, layers: true, kit: true, title, saveLabel: tt("💾 Enregistrer la version…"),
    extra: h2(tt("Chaque calque visible devient un plan du décor : posé dans une case, le calque du bas fait le fond, chacun des autres se déplace et se règle en profondeur comme un élément. Lasso : couper une partie du décor et la coller dans un nouveau calque.")),
    onSave: async (d) => {
      const vis = (d.layers || []).filter((l) => !l.hidden && (l.shapes || []).length);
      if (!vis.length) { toast(tt("Rien à enregistrer : tous les calques sont vides ou masqués."), "error"); return false; }
      const name = (prompt(tt("Nom de la nouvelle version du décor :"), tr(v.label) + (rt ? "" : tt(" retouché"))) || "").trim();
      if (!name) return false;
      const k = Math.min(1, 2400 / Math.max(iw, ih)), w = Math.round(iw * k), hh = Math.round(ih * k);
      toast(tt`Enregistrement de ${vis.length} calque(s)…`);
      const planes = [];
      for (let i = 0; i < vis.length; i++) {
        const c = await canvasOf([vis[i]], w, hh);
        if (!c) { toast(tt`Le calque « ${vis[i].name} » n'a pas pu être converti en image.`, "error"); return false; }
        if (i === 0) { planes.push({ id: vis[i].id, name: vis[i].name, png: c.toDataURL("image/png"), box: [0, 0, 1, 1] }); continue; }   // le fond : l'image entiere
        const b = alphaBox(c);
        if (!b) continue;
        const cc = document.createElement("canvas"); cc.width = b.w; cc.height = b.h;
        cc.getContext("2d").drawImage(c, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
        planes.push({ id: vis[i].id, name: vis[i].name, png: cc.toDataURL("image/png"), box: [b.x / w, b.y / hh, b.w / w, b.h / hh] });
      }
      const flat = await canvasOf(vis, w, hh);
      if (!flat) { toast(tt("Le dessin n'a pas pu être converti en image."), "error"); return false; }
      let r;
      try { r = await post(`bank/${itemId}/layered`, { name, from, f, draw: { layers: d.layers }, flat: flat.toDataURL("image/png"), planes }); }
      catch (e) { toast(tt("Enregistrement refusé : ") + e.message, "error"); return false; }
      if (r.item) app.bank.set(itemId, r.item);
      await app.bankUI.reload();
      toast(tt`Version « ${name} » ajoutée au décor ${item.name} : ${planes.length} calque(s).`);
      if (onSaved) onSaved(r.variant, app.bank.get(itemId));
    } });
}
function h2(text) { const p = document.createElement("p"); p.className = "muted"; p.style.margin = "0"; p.textContent = text; return p; }

// profondeur par defaut des plans (du calque juste au-dessus du fond vers celui du dessus) : derriere tous les elements
// deja poses (lo = juste au-dela du plus lointain), jusqu'a 0,98
const defaultDepth = (k, n, lo) => { const a = Math.min(0.97, lo), b = 0.98; return n <= 1 ? (a + b) / 2 : b - (b - a) * (k - 1) / (n - 1); };

/** Pose la version ver (en calques) du decor itemId dans la case pid : le fond, puis les plans en elements. Les plans
 *  deja poses gardent leur profondeur (meme calque de l'atelier d'une version a l'autre). */
export function poseDecorVersion(app, pid, itemId, ver) {
  const pg = app.page(), pan = pg.panels[pid] || (pg.panels[pid] = {}), item = app.bank.get(itemId), v = item && item.variants[ver];
  if (!v) return;
  const same = pan.bg && pan.bg.item === itemId;
  if (!(v.planes || []).length) { dropPlanes(pan); pan.bg = { item: itemId, v: ver, f: 0 }; if (!same) pan.view = { zoom: 1, ox: 0, oy: 0 }; return; }
  pan.bg = { item: itemId, v: ver + "~" + v.planes[0].id, f: 0 };
  if (!same) pan.view = { zoom: 1, ox: 0, oy: 0 };
  layoutPlanes(app, pid, false);
}
/** Retire de la case les plans d'un decor en calques (le fond change). */
export function dropPlanes(pan) {
  if (pan.layers) pan.layers = pan.layers.filter((l) => !isPlane(l));
}
/** Les plans de la version posee en fond, a leur place sur le fond (meme cadrage : zoom et decalage du fond). reset :
 *  recaler aussi ceux qu'on a deplaces (miroir et inclinaison retires) ; la profondeur reste. */
export function layoutPlanes(app, pid, reset = true) {
  const pan = app.page().panels[pid], g = app.geo(pid);
  if (!pan || !g || !pan.bg || !isPlane({ v: pan.bg.v })) return 0;
  const item = app.bank.get(pan.bg.item), ver = versionOf(pan.bg.v), v = item && item.variants[ver];
  if (!v || !(v.planes || []).length) return 0;
  const bb = g.bbox, pl = placement(bb, v.planes[0].cw, v.planes[0].ch, pan.view);
  const old = new Map((pan.layers || []).filter(isPlane).map((l) => [l.v.split("~")[1], l]));
  const rest = (pan.layers || []).filter((l) => !isPlane(l));
  rest.forEach((x, i) => { if (x.d == null) x.d = +depthOf({ layers: rest }, i).toFixed(3); });   // les profondeurs implicites ne bougent pas
  const ups = v.planes.slice(1), out = [], lo = rest.length ? Math.max(...rest.map((x) => x.d)) + 0.03 : 0.65;
  ups.forEach((p, i) => {
    const [bx, by, bw, bh] = p.box || [0, 0, 1, 1], o = old.get(p.id);
    const pos = { x: f4((pl.x + (bx + bw / 2) * pl.w - bb.x0) / bb.w), y: f4((pl.y + (by + bh) * pl.h - bb.y0) / bb.h), s: f4(bh * pl.h / bb.h) };
    if (o && o.item === pan.bg.item && !reset && versionOf(o.v) === ver) { out.push(o); return; }   // deja posee : elle reste ou on l'a mise
    // nouvelle version : le plan reprend sa place sur le fond (il a pu bouger dans l'atelier), mais garde sa profondeur
    const l = Object.assign(o && o.item === pan.bg.item ? o : { id: uid(), f: 0 }, { item: pan.bg.item, v: ver + "~" + p.id }, pos,
      { d: o && o.d != null ? o.d : +defaultDepth(i + 1, ups.length, lo).toFixed(3) });
    if (reset) { delete l.flip; delete l.rz; }
    out.push(l);
  });
  pan.layers = out.concat(rest).sort((a, b) => b.d - a.d);     // l'ordre d'empilement suit la profondeur, comme dans « Profondeur »
  pan.show = "layers";
  return out.length;
}
