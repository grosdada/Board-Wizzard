// « Générer photo » d'une case (carte de la case, et mode montage : l'image a la tete de lecture) : la case aplatie part
// a fal, rendue en photo par deux modeles a comparer (GPT Image 2.6, Seedream 5.5). Et la galerie de toutes les
// generations IA gardees par le serveur (data/generations).
import { tt } from "./i18n.js";
import { h, get, post, toast, modal } from "./api.js";

export const CASE_PROMPT = "Turn this storyboard panel into a photorealistic cinematic film still of the same scene, with zero redesign. Keep the exact composition and framing, the same camera angle, height, perspective and lens feel, the position, size, pose, gesture and orientation of every character and object, and the layout of the set. The panel mixes drawings and cut-out images: read drawn lines ONLY as indications of shape, edges and features, never as marks to reproduce: the final image contains NO ink lines, NO outlines, NO hatching and NO pen texture. Every character keeps their design, their proportions (caricature proportions are intentional), their clothing, colors, hairstyle and accessories; do not beautify, do not average faces, do not fix anatomy. Unify everything into one real photograph: coherent natural lighting matching the scene, real shadows and contact shadows on the ground, real materials and textures, believable depth of field. Do not add characters, objects or text that are not in the panel; plain or empty areas stay simple and believable. MANDATORY: no speech bubbles, no captions, no arrows, no frame borders, no text, no watermark, no visible lines. Pure photographic imagery only.";
const TAIL = "Do not apply realistic human anatomy to the characters: their proportions are an intentional DRAWING DESIGN, keep them exactly.";
export const PHOTO_MODELS = [["gpt", tt("Généré par GPT Image 2.6"), "≈ 0,06 $"], ["seedream", tt("Généré par Seedream 5.5"), "≈ 0,04 $"]];

const toUri = (blob) => new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
const save = (href, name) => { const a = h("a", { href, download: name }); document.body.append(a); a.click(); a.remove(); };

/** Fenetre « Générer photo ». snap() : Blob de l'image a envoyer ; project, panel : la photo est rangee aussi dans le
 *  storyboard (integ/) ; keep(rel) : « Garder comme image de la case » ; name : nom des fichiers telecharges. */
export function photoDialog({ title, intro, snap, project, panel, keep, name = "case" }) {
  const prompt = h("textarea", { rows: 7 }); prompt.value = CASE_PROMPT;
  const cols = h("div.idk-realcols");
  let uri = null;                                           // l'image envoyee : la meme pour les deux modeles
  const column = ([key, label, cost]) => {
    const out = h("div.idk-real"), go = h("button.primary.idk-realgo", { type: "button" }, `${label} · ${cost}`);
    go.addEventListener("click", async () => {
      go.disabled = true; go.textContent = tt("⏳ Génération… (environ une minute)");
      try {
        if (!uri) { const b = await snap(); if (!b) throw new Error(tt("rien à envoyer")); uri = await toUri(b); }
        const txt = prompt.value.trim() + (key !== "gpt" ? " " + TAIL : "");
        const r = await post("portrait/realistic", { image: uri, prompt: txt, model: key, project, panel });
        out.textContent = "";
        out.append(h("img", { src: r.image, alt: "" }), h("div.row.wrap",
          h("button.mini", { type: "button", on: { click: () => save(r.image, `${name}-photo-${key}.png`) } }, tt("⬇ Télécharger")),
          keep && r.rel ? h("button.mini", { type: "button", title: tt("La case montre cette photo (comme une image Integrate) ; ses calques restent disponibles"),
            on: { click: (e) => { keep(r.rel); e.currentTarget.disabled = true; e.currentTarget.textContent = tt("✓ Gardée pour la case"); } } }, tt("✓ Garder comme image de la case")) : ""));
      } catch (e) { toast(label + " : " + e.message, "error"); }
      go.disabled = false; go.textContent = `${label} · ${cost}`;
    });
    return h("div.idk-realcol", go, out);
  };
  PHOTO_MODELS.forEach((m) => cols.append(column(m)));
  modal(title || tt("Générer photo"), h("div.form.idk-realform",
    h("p.muted", intro || tt("La case telle qu'elle est affichée (sans les bulles) part à fal avec cette consigne. Chaque bouton lance son modèle (payant, une minute environ) ; on peut lancer les deux et comparer. Toutes les photos sont aussi gardées dans « 🗂 Générations ».")),
    h("label.col", tt("Consigne"), prompt), cols), [{ label: tt("Fermer") }]).box.classList.add("wide");
}

/** Galerie de toutes les generations IA gardees par le serveur (data/generations), par jour, les plus recentes d'abord. */
export async function openGenerations() {
  let r;
  try { r = await get("generations"); } catch (e) { return toast(tt("Générations illisibles : ") + e.message, "error"); }
  const items = r.items || [];
  const byDay = new Map();
  for (const it of items) { const d = it.path.split("/")[0]; if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(it); }
  const isVid = (p) => /\.(mp4|webm|mov)$/i.test(p);
  const body = h("div.gen-list");
  for (const [day, list] of byDay) {
    body.append(h("h4", `${day} · ${list.length}`), h("div.gen-grid", list.map((it) => {
      const src = "/generations/" + it.path.split("/").map(encodeURIComponent).join("/"), nm = it.path.split("/")[1];
      return h("div.gen-cell", { title: nm },
        isVid(it.path) ? h("video", { src, muted: true, preload: "metadata", controls: true }) : h("a", { href: src, target: "_blank" }, h("img", { src, loading: "lazy", alt: "" })),
        h("div.row", h("span.muted.gen-name", nm.replace(/^\d{6}_/, "").slice(0, 40)), h("a.mini", { href: src + "?dl=1", title: tt("Télécharger") }, "⬇")));
    })));
  }
  modal(tt("Générations IA"), h("div.form",
    h("p.muted", tt`Chaque image ou vidéo rendue par fal ou par les machines est gardée ici, téléchargée ou non. Dossier sur le poste : ${r.dir}`),
    items.length ? body : h("p", tt("Rien pour l'instant : les prochaines générations arriveront ici."))), [{ label: tt("Fermer") }]).box.classList.add("wide");
}
