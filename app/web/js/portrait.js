// Portrait-robot : la fenetre ou l'on assemble un personnage. On choisit un corps de la banque (les mannequins, avec
// toutes leurs poses et leurs orbites), puis la tete piece par piece. Rien n'est calcule : la tete est en traces et
// tourne avec le corps. Le personnage est range dans la banque comme les autres ; il emprunte les images de son corps.
import { h, post, put, del, toast, modal } from "./api.js";
import { sprite, preload, variantOf } from "./model.js";
import { PIECES, DEFAUT, hasard, labelOf, portraitSvg } from "./face.js";

const isBody = (it) => it.kind === "character" && !it.body && (it.tags || []).includes("mannequin") && variantOf(it, "base")?.orbit?.head;

/** Ouvre la fenetre. item : un personnage assemble a modifier (sinon on en cree un). */
export function openPortrait(ui, item) {
  const app = ui.app, bank = app.bank, bodies = [...bank.values()].filter(isBody);
  if (!bodies.length) { toast("Aucun corps de mannequin dans la banque (éléments étiquetés « mannequin », avec une orbite)."); return; }
  let body = (item && bank.get(item.body)) || bodies[0], face = Object.assign({}, DEFAUT, item && item.face), vid = "base", frame = 0, tick = 0;
  const cur = () => ({ id: "apercu", src: body.id, variants: body.variants, w: body.w, h: body.h, face });
  const stage = h("div.pr-stage", { title: "Glisser à gauche ou à droite : le personnage tourne" });
  const show = async () => {
    const my = ++tick, svg = await portraitSvg(cur(), vid, frame);
    if (my === tick) stage.innerHTML = svg || "<p class='muted'>Chargement…</p>";
  };
  let drag = null;
  stage.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, f: frame }; stage.setPointerCapture(e.pointerId); e.preventDefault(); });
  stage.addEventListener("pointermove", (e) => {
    const n = variantOf(body, vid)?.orbit?.n;
    if (!drag || !n) return;
    const f = (((drag.f - Math.round((e.clientX - drag.x) / 5)) % n) + n) % n;
    if (f !== frame) { frame = f; show(); }
  });
  stage.addEventListener("pointerup", () => { drag = null; });

  const name = h("input", { type: "text", value: item ? item.name : "", placeholder: "Nom du personnage" });
  const poseSel = h("select", { title: "Pose montrée dans l'aperçu (le personnage les aura toutes)", on: { change: () => { vid = poseSel.value; frame = 0; preload(cur(), vid); show(); } } });
  const poses = () => { poseSel.textContent = ""; for (const [k, v] of Object.entries(body.variants)) if (v.orbit) poseSel.append(h("option", { value: k, selected: k === vid }, v.label)); };
  const bodyBox = h("div.pr-bodies");
  const paintBodies = () => {
    bodyBox.textContent = "";
    for (const b of bodies) bodyBox.append(h("button.pr-body" + (b.id === body.id ? ".on" : ""), { type: "button", title: b.name + " · " + Object.keys(b.variants).length + " poses",
      on: { click: () => { body = b; if (!body.variants[vid]) vid = "base"; frame = 0; poses(); paintBodies(); preload(cur(), vid); show(); } } },
      h("img", { src: sprite(b, "base", 0).url, loading: "lazy", draggable: false, alt: "" })));
  };
  const parts = h("div.pr-parts");
  const paintParts = () => {
    parts.textContent = "";
    for (const [key, label, table] of PIECES) parts.append(h("div.pr-row", h("span.pr-label", label),
      h("div.pr-chips", Object.keys(table).map((k) => h("button.mini" + (face[key] === k ? ".on" : ""), { type: "button", on: { click: () => { face[key] = k; paintParts(); show(); } } }, labelOf(table, k))))));
    const check = (key, label) => h("label.pr-check", h("input", { type: "checkbox", checked: !!face[key], on: { change: (e) => { face[key] = e.target.checked; show(); } } }), label);
    parts.append(h("div.pr-row", h("span.pr-label", "En plus"), h("div.pr-chips", check("moustache", "Moustache"), check("barbe", "Barbe"), check("oreilles", "Oreilles"))));
    const range = (label, key, min, max, step, title) => { const out = h("span.muted", (+face[key]).toFixed(2));
      return h("label.pr-row", { title }, h("span.pr-label", label), h("input", { type: "range", min, max, step, value: face[key], on: { input: (e) => { face[key] = +e.target.value; out.textContent = face[key].toFixed(2); show(); } } }), out); };
    parts.append(range("Taille", "k", 0.85, 1.7, 0.01, "Taille de la tête : 1 = celle du mannequin. Un peu plus grosse donne le style naïf."),
      range("Position ↔", "dx", -0.6, 0.6, 0.01, "Décale la tête sur le cou"), range("Position ↕", "dy", -0.6, 0.6, 0.01, "Monte ou descend la tête sur le cou"),
      range("Trait", "lw", 0.4, 2.5, 0.05, "Épaisseur du trait de la tête"));
    const color = (label, key, title) => { const on = /^#[0-9a-f]{6}$/i.test(face[key] || "");
      const pick = h("input", { type: "color", value: on ? face[key] : (key === "peau" ? "#ffffff" : "#111111"), on: { input: (e) => { face[key] = e.target.value; show(); } } });
      return h("label.pr-row", { title }, h("span.pr-label", label), pick, h("button.mini", { type: "button", title: "Revenir à la couleur du dessin", on: { click: () => { face[key] = ""; paintParts(); show(); } } }, "Auto")); };
    parts.append(color("Peau", "peau", "Couleur de la peau du visage. Auto : la couleur du corps (blanc, ou celle réglée dans la case)."),
      color("Cheveux", "poil", "Couleur des cheveux, de la barbe et de la moustache. Auto : la couleur du trait."));
  };
  const save = async () => {
    const nm = name.value.trim() || "Personnage";
    try {
      if (item) await put("bank/" + item.id, { name: nm, face, body: body.id });
      else await post("bank/assemble", { name: nm, body: body.id, face, folder: ui.tab === "character" && ui.folder && ui.folder !== "·" && !/^Corps/.test(ui.folder) ? ui.folder : "Personnages assemblés" });
      await ui.reload(); app.editor.render(true);
      toast(`« ${nm} » est dans la banque : toutes les poses du corps, sans calcul.`);
    } catch (e) { toast(e.message); return false; }
  };
  const left = h("div.pr-left", stage, h("label.row", "Pose", poseSel),
    h("button.mini", { type: "button", title: "Tire un visage au hasard", on: { click: () => { const keep = { k: face.k, dx: face.dx, dy: face.dy, peau: face.peau, poil: face.poil, lw: face.lw }; face = Object.assign(hasard(), keep); paintParts(); show(); } } }, "🎲 Au hasard"));
  const right = h("div.pr-right", h("label.row", "Nom", name), h("h4", "Corps"), bodyBox, h("h4", "Tête"), parts);
  const buttons = [{ label: item ? "Enregistrer" : "Ajouter à la banque", primary: true, click: save }, { label: "Fermer" }];
  if (item) buttons.splice(1, 0, { label: "Retirer de la banque", click: async () => { if (!confirm(`Retirer « ${item.name} » de la banque ? Son corps reste dans la banque.`)) return false; await del("bank/" + item.id); await ui.reload(); } });
  const m = modal(item ? "Portrait-robot · " + item.name : "Portrait-robot : assembler un personnage", h("div.pr", left, right), buttons);
  m.box.classList.add("wide");
  poses(); paintBodies(); paintParts(); preload(cur(), vid); show();
}

/** Vignette d'un personnage assemble (corps + tete), dessinee dans el. */
export function portraitThumb(el, item, vid = "base", crop = 0.5) {
  portraitSvg(item, vid, 0, { crop }).then((svg) => { if (svg) el.innerHTML = svg; });
  return el;
}
