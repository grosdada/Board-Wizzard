// Langue de l'interface : francais (par defaut) ou anglais, choisie par le bouton du haut et gardee dans ce navigateur.
// Les textes du code restent en francais : tt("Fermer") ou tt`${n} pose(s)` rendent le francais tel quel, et en anglais
// la traduction trouvee dans /web/i18n/en.json ("ui", cle = le francais, {0} {1}... a la place des ${...}).
// tr(message) traduit un texte venu du serveur (erreurs, noms de poses, elements) : "server" de en.json, ou %s, %d.
// Controle de ce qui manque : python tools/i18n.py. Langue "xx" (localStorage bw.lang = "xx") : chaque texte traduit
// s'affiche entre ⟦ ⟧, pour reperer a l'ecran ce qui a echappe a la traduction.

const pick = () => { try { const v = localStorage.getItem("bw.lang"); return v === "en" || v === "xx" ? v : "fr"; } catch (e) { return "fr"; } };
export const LANG = pick();
const DICT = LANG === "en"
  ? await fetch("/web/i18n/en.json", { cache: "no-store" }).then((r) => r.json()).catch(() => ({ ui: {}, server: {} }))
  : { ui: {}, server: {} };
DICT.ui = DICT.ui || {}; DICT.server = DICT.server || {};
if (LANG !== "fr") document.documentElement.lang = "en";

const fill = (s, vals) => s.replace(/\{(\d+)\}/g, (m, i) => (+i < vals.length ? String(vals[+i]) : m));

/** Texte de l'interface. tt("Fermer") ; en gabarit : tt`${n} son(s) ajouté(s)` (cle « {0} son(s) ajouté(s) »). */
export function tt(s, ...vals) {
  if (Array.isArray(s) && s.raw) {
    if (LANG === "fr") return s.reduce((a, p, i) => a + p + (i < vals.length ? String(vals[i]) : ""), "");
    const key = s.reduce((a, p, i) => a + p + (i < vals.length ? "{" + i + "}" : ""), "");
    if (LANG === "xx") return "⟦" + fill(key, vals) + "⟧";
    return fill(DICT.ui[key] ?? key, vals);
  }
  if (LANG === "fr") return s;
  if (LANG === "xx") return "⟦" + s + "⟧";
  return DICT.ui[s] ?? s;
}

// gabarits du serveur (« variante inconnue : %s ») -> expressions regulieres, les plus longs d'abord
let PATS = null;
const patterns = () => PATS || (PATS = Object.entries(DICT.server).filter(([k]) => /%[sd]|%\.\d+f/.test(k))
  .sort((a, b) => b[0].length - a[0].length)
  .map(([k, en]) => {
    const bits = k.split(/(%s|%d|%\.\d+f)/);
    const src = bits.map((b, i) => (i % 2 ? (b === "%s" ? (i === bits.length - 2 && !bits[i + 1] ? "(.*)" : "(.+?)") : "(-?[\\d.]+)") : b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("");
    return [new RegExp(src), en];
  }));

function trs(s) {
  if (DICT.server[s] != null) return DICT.server[s];
  if (DICT.ui[s] != null) return DICT.ui[s];
  for (const [re, en] of patterns()) {
    const m = s.match(re);
    if (!m) continue;
    let i = 0;
    const out = en.replace(/%s|%d|%\.\d+f/g, () => { i++; const g = m[i] ?? ""; return /^-?[\d.]+$/.test(g) ? g : trs(g); });
    return s.slice(0, m.index) + out + s.slice(m.index + m[0].length);
  }
  return s;
}

/** Texte venu du serveur (message d'erreur, nom de pose, d'element, de categorie) : traduit s'il est connu. */
export function tr(msg) {
  if (LANG === "fr" || msg == null || msg === "") return msg;
  if (LANG === "xx") return "⟦" + msg + "⟧";
  return trs(String(msg));
}

// bibliotheque des bulles (lib/alive-bubbles.js, script classique charge avant) : ses noms affiches suivent la langue
window.BW_tt = tt;
if (LANG !== "fr" && window.AliveBubbles) {
  const A = window.AliveBubbles;
  for (const o of [A.COLOR_NAMES, A.TYPES, A.ANIMS]) for (const k of Object.keys(o || {})) o[k] = tt(o[k]);
  for (const k of Object.keys(A.FONTS || {})) A.FONTS[k][0] = tt(A.FONTS[k][0]);
}

/** Change de langue : laisse partir l'enregistrement en attente, puis recharge la page. */
export function setLang(lang) {
  try { localStorage.setItem("bw.lang", lang); } catch (e) { /* navigateur sans stockage : on reste */ }
  setTimeout(() => location.reload(), 900);
}
