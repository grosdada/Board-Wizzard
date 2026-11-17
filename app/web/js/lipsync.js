// Lip sync sans calcul lourd : le navigateur ecoute la voix (volume et couleur du son, 12 fois par seconde) et appelle
// une des neuf bouches dessinees au trait. Animation limitee : chaque bouche tient au moins deux images.
//   lip.mode : "simple" (par defaut : fermee, ouverte, ronde, tirees des memes reperes) ou "detail" (les neuf bouches).
//   calque.lip = { on, src (fichier son du storyboard), name, dur, fps, cues ("XXAAEEMM…", une lettre par image),
//                  off (decalage en secondes), x, y (place de la bouche, fraction de la boite du personnage vu de face),
//                  s (largeur, fraction de la hauteur), hw (rayon de l'axe de la tete, fraction de la hauteur), r (inclinaison),
//                  ow, oh (largeur et hauteur de la bouche ouverte, jeu « trait et capsule »),
//                  set (jeu de bouches : dessin | graphique), lw (epaisseur du trait), hand, wave (tremble du trait), bg (masque blanc), mw, mh, mx, my (son reglage) }
// La bouche est accrochee a un axe vertical qui tourne avec l'orbite : de trois quarts elle glisse sur le cote et se
// resserre, de dos elle disparait.

export const MOUTHS = {
  X: "Repos (fermée)", M: "M · B · P", A: "A · I ouvert", E: "É · I · sourire", O: "O", U: "OU · W", F: "F · V", D: "C · D · G · K · N · R · S", L: "L · T · TH",
};
const INK = `stroke="#111" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"`;
const SHAPES = {
  X: `<path d="M-38 0Q0 9 38 0" fill="none" ${INK}/>`,
  M: `<path d="M-33 1L33 1" fill="none" ${INK}/><path d="M-22 -7Q0 -1 22 -7" fill="none" stroke="#111" stroke-width="4" stroke-linecap="round"/>`,
  A: `<path d="M-42 -10Q0 -34 42 -10Q0 62 -42 -10Z" fill="#111" ${INK}/><path d="M-30 -11Q0 -24 30 -11L27 -2Q0 -10 -27 -2Z" fill="#fff"/><path d="M-16 30Q0 16 16 30Q0 40 -16 30Z" fill="#fff"/>`,
  E: `<path d="M-46 -8Q0 -20 46 -8Q0 30 -46 -8Z" fill="#fff" ${INK}/><path d="M-40 -1Q0 9 40 -1" fill="none" stroke="#111" stroke-width="4"/>`,
  O: `<ellipse rx="21" ry="27" fill="#111" ${INK}/>`,
  U: `<ellipse rx="11" ry="13" fill="#111" ${INK}/>`,
  F: `<path d="M-34 4Q0 14 34 4" fill="none" ${INK}/><path d="M-22 -8H22V3Q0 9 -22 3Z" fill="#fff" stroke="#111" stroke-width="4" stroke-linejoin="round"/>`,
  D: `<path d="M-38 -6Q0 -18 38 -6Q0 26 -38 -6Z" fill="#fff" ${INK}/><path d="M-33 0Q0 6 33 0" fill="none" stroke="#111" stroke-width="4"/><path d="M-20 12Q0 18 20 12" fill="none" stroke="#111" stroke-width="3"/>`,
  L: `<path d="M-36 -8Q0 -24 36 -8Q0 40 -36 -8Z" fill="#111" ${INK}/><path d="M-26 -9Q0 -20 26 -9L24 -1Q0 -8 -24 -1Z" fill="#fff"/><ellipse cy="12" rx="13" ry="9" fill="#fff"/>`,
};

// Jeu « dessiné » : des levres au trait fin, un peu irregulieres, presque sans aplat noir. Le jeu « graphique » ci-dessus
// est plus plein, facon pate a modeler.
const PEN = `fill="none" stroke="#111" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"`;
const PEN2 = `fill="none" stroke="#111" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"`;
const LIP = `fill="#fff" stroke="#111" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"`;
const DRAWN = {
  X: `<path d="M-34 2C-18 6 -6 -2 4 3S26 6 36 0" ${PEN}/><path d="M-10 14Q2 18 14 13" ${PEN2}/>`,
  M: `<path d="M-30 0C-14 -4 -4 4 6 0S24 -3 32 1" ${PEN}/><path d="M-35 -4L-30 2M35 -3L31 3" ${PEN2}/><path d="M-8 12Q2 15 12 11" ${PEN2}/>`,
  A: `<path d="M-36 -8C-20 -24 18 -26 36 -9C30 28 12 44 -2 44C-20 42 -32 22 -36 -8Z" ${LIP}/><path d="M-27 -4C-10 5 14 5 29 -5C16 13 -12 13 -27 -4Z" fill="#111"/>` +
     `<path d="M-28 -6C-10 2 14 2 30 -7" ${PEN2}/><path d="M-15 37C-6 28 8 28 17 37" ${PEN2}/>`,
  E: `<path d="M-42 -6C-22 -16 20 -17 42 -7C26 16 -22 18 -42 -6Z" ${LIP}/><path d="M-34 0C-12 6 14 6 36 -1" ${PEN2}/><path d="M-13 -12L-12 3M2 -13L2 4M16 -12L15 3" ${PEN2}/>`,
  O: `<path d="M-2 -26C16 -27 24 -10 22 4C20 22 10 30 -2 30C-16 29 -24 16 -23 0C-22 -16 -14 -25 -2 -26Z" ${LIP}/>` +
     `<path d="M-2 -18C10 -19 16 -7 15 3C14 16 7 22 -2 22C-11 21 -17 12 -16 1C-15 -10 -10 -17 -2 -18Z" fill="#111"/><path d="M-9 12C-4 7 3 7 8 12" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`,
  U: `<path d="M0 -12C9 -12 13 -4 12 3C11 11 6 14 0 14C-7 14 -12 8 -12 1C-12 -7 -7 -12 0 -12Z" ${LIP}/><path d="M0 -8C6 -8 8 -2 8 2C7 8 4 10 0 10C-5 10 -8 6 -8 1C-8 -4 -5 -8 0 -8Z" fill="#111"/>` +
     `<path d="M-21 -7L-16 -3M-22 6L-16 4M21 -7L16 -3M22 6L16 4" ${PEN2}/>`,
  F: `<path d="M-32 -5C-14 -11 14 -11 32 -5" ${PEN}/><path d="M-20 -6L-19 6C-6 9 8 9 20 6L20 -6" ${LIP}/><path d="M-7 -7L-7 7M6 -7L6 7" ${PEN2}/><path d="M-24 13C-8 19 10 19 24 12" ${PEN2}/>`,
  D: `<path d="M-36 -4C-18 -13 18 -14 36 -5C22 14 -20 15 -36 -4Z" ${LIP}/><path d="M-28 0C-10 5 12 5 30 -1" ${PEN2}/><path d="M-20 8C-8 11 10 11 22 7" ${PEN2}/>`,
  L: `<path d="M-32 -8C-16 -22 16 -23 32 -9C26 22 10 32 -2 32C-18 30 -28 16 -32 -8Z" ${LIP}/><path d="M-24 -5C-8 2 12 2 26 -6" ${PEN2}/>` +
     `<path d="M-12 15C-9 -1 9 -1 13 14C6 21 -6 21 -12 15Z" ${LIP}/>`,
};
// Jeu par defaut, le plus simple : fermee = un trait, ouverte = une capsule noire. Rien d'autre.
const LINE = `<path d="M-30 0L30 0" fill="none" stroke="#111" stroke-width="8" stroke-linecap="round"/>`;
const CAPSULE = `<rect x="-30" y="-15" width="60" height="30" rx="15" fill="#111" stroke="#111" stroke-width="3" stroke-linejoin="round"/>`;
const PLAIN = { X: LINE, M: LINE, F: LINE, A: CAPSULE, E: CAPSULE, O: CAPSULE, U: CAPSULE, D: CAPSULE, L: CAPSULE };
// Jeux en images : des cartes decoupees d'une planche par tools/mouths.py (app/web/mouths/<planche>/nNN.png au trait
// noir et blanc, cNN.png en couleurs d'origine), toutes dans un cadre 360 x 240 donc a la meme echelle.
// [nom affiche, dossier/prefixe, numero de la carte pour chaque bouche]
const IMG_SETS = {
  pate: ["Pâte à modeler · au trait, avec dents", "pate/n", { X: 12, M: 9, A: 2, E: 4, O: 0, U: 3, F: 11, D: 6, L: 7 }],
  pate2: ["Pâte à modeler · au trait, bouches rondes", "pate/n", { X: 12, M: 10, A: 5, E: 1, O: 0, U: 3, F: 11, D: 6, L: 8 }],
  patec: ["Pâte à modeler · couleurs, avec dents", "pate/c", { X: 12, M: 9, A: 2, E: 4, O: 0, U: 3, F: 11, D: 6, L: 7 }],
  pate2c: ["Pâte à modeler · couleurs, bouches rondes", "pate/c", { X: 12, M: 10, A: 5, E: 1, O: 0, U: 3, F: 11, D: 6, L: 8 }],
  toon: ["Cartoon · au trait, par sons", "toon/n", { X: 5, M: 5, A: 0, E: 7, O: 1, U: 10, F: 6, D: 2, L: 4 }],
  toon2: ["Cartoon · au trait, souriant", "toon/n", { X: 23, M: 13, A: 19, E: 14, O: 20, U: 11, F: 18, D: 22, L: 17 }],
  toon3: ["Cartoon · au trait, dents serrées", "toon/n", { X: 5, M: 23, A: 12, E: 9, O: 11, U: 10, F: 21, D: 15, L: 8 }],
  toonc: ["Cartoon · couleurs, par sons", "toon/c", { X: 5, M: 5, A: 0, E: 7, O: 1, U: 10, F: 6, D: 2, L: 4 }],
  toon2c: ["Cartoon · couleurs, souriant", "toon/c", { X: 23, M: 13, A: 19, E: 14, O: 20, U: 11, F: 18, D: 22, L: 17 }],
  expr: ["Expressif · au trait, par sons", "expr/n", { X: 29, M: 20, A: 22, E: 27, O: 5, U: 16, F: 15, D: 18, L: 6 }],
  expr2: ["Expressif · au trait, joyeux", "expr/n", { X: 38, M: 37, A: 39, E: 17, O: 21, U: 11, F: 7, D: 28, L: 25 }],
  expr3: ["Expressif · au trait, en colère", "expr/n", { X: 59, M: 56, A: 50, E: 51, O: 24, U: 48, F: 46, D: 57, L: 9 }],
  expr4: ["Expressif · au trait, triste", "expr/n", { X: 41, M: 42, A: 30, E: 31, O: 34, U: 53, F: 36, D: 33, L: 32 }],
  exprc: ["Expressif · couleurs, par sons", "expr/c", { X: 29, M: 20, A: 22, E: 27, O: 5, U: 16, F: 15, D: 18, L: 6 }],
  expr2c: ["Expressif · couleurs, joyeux", "expr/c", { X: 38, M: 37, A: 39, E: 17, O: 21, U: 11, F: 7, D: 28, L: 25 }],
  noir: ["Tordu · au trait", "noir/n", { X: 2, M: 11, A: 0, E: 4, O: 1, U: 10, F: 3, D: 6, L: 5 }],
  noir2: ["Tordu · au trait, de travers", "noir/n", { X: 11, M: 2, A: 9, E: 7, O: 10, U: 13, F: 3, D: 8, L: 12 }],
  noirc: ["Tordu · couleurs", "noir/c", { X: 2, M: 11, A: 0, E: 4, O: 1, U: 10, F: 3, D: 6, L: 5 }],
};
const CARD = (path, n) => `<image href="/web/mouths/${path}${String(n).padStart(2, "0")}.png" x="-60" y="-40" width="120" height="80"/>`;
export const SETS = { capsule: "Trait et capsule", dessin: "Dessiné (trait fin)", graphique: "Graphique (plein)" };
const SETMAP = { capsule: PLAIN, dessin: DRAWN, graphique: SHAPES };
for (const [k, [name, path, map]] of Object.entries(IMG_SETS)) { SETS[k] = name; SETMAP[k] = Object.fromEntries(Object.entries(map).map(([c, n]) => [c, CARD(path, n)])); }
/** Dessin d'une bouche en traces, centree sur l'origine, large d'environ 100.
 *  o : { cache (masque blanc derriere), lw (epaisseur du trait, 1 = normale), hand (tremble, 0 = net), wave (longueur
 *        des ondulations), mw, mh (largeur et hauteur du masque), mx, my (decalage du masque), id (pour le filtre) } */
export function mouthSvg(shape, o = {}) {
  const lw = o.lw ?? 1;
  const set = SETMAP[o.set] || PLAIN;
  let d = set[shape] || set.X;
  if (d === CAPSULE) {                                      // ouverture reglable : plus etroite que le trait par defaut
    const w = 60 * (o.ow ?? 0.55), hh = 30 * (o.oh ?? 1);
    d = `<rect x="${(-w / 2).toFixed(1)}" y="${(-hh / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${hh.toFixed(1)}" rx="${(Math.min(w, hh) / 2).toFixed(1)}" fill="#111" stroke="#111" stroke-width="3" stroke-linejoin="round"/>`;
  }
  if (lw !== 1) d = d.replace(/stroke-width="([\d.]+)"/g, (m, v) => `stroke-width="${(v * lw).toFixed(2)}"`);
  let out = "";
  // le masque ne change pas d'une bouche a l'autre : une fois aligne sur le personnage, il le reste
  if (o.cache !== false) out += `<ellipse cx="${(o.mx || 0).toFixed(1)}" cy="${(6 + (o.my || 0)).toFixed(1)}" rx="${(54 * (o.mw ?? 1)).toFixed(1)}" ry="${(38 * (o.mh ?? 1)).toFixed(1)}" fill="${o.mask || "#ffffff"}" data-mask="1"/>`;
  if (o.hand > 0 && o.id) {                                 // trait a la main : un bruit doux deplace le trace, different pour chaque bouche
    const seed = 3 + "XMAEOUFDL".indexOf(shape) * 7;
    out += `<filter id="${o.id}" filterUnits="userSpaceOnUse" x="-90" y="-80" width="180" height="170" color-interpolation-filters="sRGB">` +
      `<feTurbulence type="fractalNoise" baseFrequency="${(0.09 / Math.max(0.5, o.wave ?? 4)).toFixed(4)}" numOctaves="2" seed="${seed}"/><feDisplacementMap in="SourceGraphic" scale="${(o.hand * 2.2).toFixed(1)}" xChannelSelector="R" yChannelSelector="G"/></filter>` +
      `<g filter="url(#${o.id})">${d}</g>`;
  } else out += d;
  return out;
}
export const mouthIcon = (shape, set) => `<svg viewBox="-56 -44 112 100" width="30" height="27">${mouthSvg(shape, { cache: false, set })}</svg>`;

// Lip sync simple (par defaut) : deux bouches seulement. Fermee sur les silences ; des que ca parle, elle alterne
// ouverte et fermee (lip.flap battements par seconde, 4 par defaut) pour imiter le mouvement.
export const MODES = { simple: "Simple : la bouche bat quand ça parle", mix: "Varié : elle bat, et s'ouvre selon le son", detail: "Détaillé : neuf bouches" };
export const SIMPLE = ["X", "A"];
const simpleCache = new Map();
export function simplify(cues, rate = 4, varied = false) {
  const key = rate + (varied ? "v|" : "|") + cues;
  let out = simpleCache.get(key);
  if (out) return out;
  // tant que ca parle, la bouche bat : ouverte puis fermee, `rate` fois par seconde (12 images par seconde) ; chaque
  // prise de parole commence bouche ouverte. Sur les silences elle reste fermee.
  const period = Math.max(2, Math.round(12 / Math.max(0.5, rate))), open = Math.max(1, Math.min(period - 1, Math.ceil(period * 0.6)));
  let n = 0;
  out = [...cues].map((c) => { if (c === "X" || c === "M" || c === "F") { n = 0; return "X"; } return n++ % period < open ? (varied ? c : "A") : "X"; }).join("");   // varie : la bouche ouverte est celle du son
  if (simpleCache.size > 200) simpleCache.clear();
  simpleCache.set(key, out);
  return out;
}
/** Partie gardee de la voix : [debut, fin] en secondes dans le fichier (lip.in, lip.out : la decoupe). */
export function voiceSpan(lip) { const a = Math.max(0, lip.in || 0), b = Math.min(lip.dur || 1e9, lip.out ?? lip.dur ?? 1e9); return [a, Math.max(a, b)]; }
/** Instant dans le fichier son qui correspond a l'instant t du plan, ou -1 hors de la voix. */
export function voiceTime(lip, t) { const [a, b] = voiceSpan(lip), tt = t - (lip.off || 0); return tt < 0 || tt >= b - a ? -1 : tt + a; }
/** Numero de l'image de bouche a l'instant t, ou -1. */
export function cueIndex(lip, t) { const v = voiceTime(lip, t), i = Math.floor(v * (lip.fps || 12)); return v < 0 || !lip.cues || i >= lip.cues.length ? -1 : i; }
/** Lettre de la bouche a l'instant t. */
export function cueAt(lip, t) {
  if (!lip || !lip.cues) return "X";
  const i = cueIndex(lip, t);
  return (i >= 0 && (lip.mode === "detail" ? lip.cues : simplify(lip.cues, lip.flap ?? 4, lip.mode === "mix"))[i]) || "X";
}

/** Balisage SVG de la bouche d'un calque. box : boite du calque ; angle : orientation de l'orbite en radians (0 = de face). */
export function lipMarkup(lip, box, flip, t, angle = 0, id = "", mask = "#ffffff") {
  if (!lip || !lip.on) return "";
  const c = Math.cos(angle);
  if (c < -0.12) return "";                                 // de dos : la bouche est derriere la tete
  const size = (lip.s ?? 0.035) * box.h, kx = Math.max(0.32, Math.abs(c));
  let cx = box.x + (lip.x ?? 0.5) * box.w - Math.sin(angle) * (lip.hw ?? 0.03) * box.h;   // l'axe tourne : la bouche part sur le cote
  const cy = box.y + (lip.y ?? 0.13) * box.h;
  if (flip) cx = 2 * box.cx - cx;
  const o = { cache: lip.bg !== false, lw: lip.lw, hand: lip.hand, wave: lip.wave, mw: lip.mw, mh: lip.mh, mx: lip.mx, my: lip.my, id, mask, set: lip.set, ow: lip.ow, oh: lip.oh };
  return `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${((flip ? -1 : 1) * (lip.r || 0)).toFixed(1)}) scale(${(size / 100 * kx).toFixed(4)} ${(size / 100).toFixed(4)})" style="pointer-events:none">${mouthSvg(cueAt(lip, t), o)}</g>`;
}

// ------------------------------------------------------------------------------------------------ ecoute de la voix
function fft(re, im) {                                       // transformee de Fourier, taille puissance de 2, sur place
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** Ecoute un fichier son (ArrayBuffer) et rend { cues, dur, fps }. Tout se passe dans le navigateur, en une seconde ou deux. */
export async function analyse(buf, fps = 12) {
  const AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
  let au;
  try { au = await ac.decodeAudioData(buf.slice(0)); } finally { ac.close(); }
  const sr = au.sampleRate, total = au.length, a = au.getChannelData(0), b = au.numberOfChannels > 1 ? au.getChannelData(1) : null;
  const N = sr > 30000 ? 2048 : 1024, hop = sr / fps, frames = Math.max(1, Math.ceil(total / hop));
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  const bin = (hz) => Math.min(N / 2 - 1, Math.round(hz * N / sr));
  const vol = [], cen = [], hiss = [], low = [];
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let f = 0; f < frames; f++) {
    const s0 = Math.floor(f * hop), s1 = Math.min(total, Math.floor((f + 1) * hop));
    let e = 0;
    for (let i = s0; i < s1; i++) { const x = b ? (a[i] + b[i]) / 2 : a[i]; e += x * x; }
    vol.push(Math.sqrt(e / Math.max(1, s1 - s0)));
    const start = Math.floor((s0 + s1) / 2 - N / 2);
    for (let i = 0; i < N; i++) { const q = start + i, x = q >= 0 && q < total ? (b ? (a[q] + b[q]) / 2 : a[q]) : 0; re[i] = x * win[i]; im[i] = 0; }
    fft(re, im);
    let sum = 0, wsum = 0, hi = 0, lo = 0, all = 0;
    for (let k = bin(150); k <= bin(10000); k++) {
      const m = Math.hypot(re[k], im[k]), hz = k * sr / N;
      all += m;
      if (hz <= 4000) { sum += m; wsum += m * hz; }
      if (hz >= 4000) hi += m;
      if (hz <= 450) lo += m;
    }
    cen.push(sum ? wsum / sum : 0); hiss.push(all ? hi / all : 0); low.push(all ? lo / all : 0);
  }
  const sorted = [...vol].sort((x, y) => x - y), ref = sorted[Math.floor(sorted.length * 0.92)] || 1e-6;
  const v = vol.map((x) => Math.min(1.5, x / Math.max(ref, 1e-6)));
  const quiet = ref < 0.004;                                 // fichier muet
  let raw = v.map((x, i) => {
    if (quiet || x < 0.09) return "X";
    if (hiss[i] > 0.5) return x < 0.35 ? "F" : "D";          // souffle : f, v, s, ch
    if (low[i] > 0.72 && x < 0.5) return "M";                // nasale, presque tout dans le grave : m, n
    const c = cen[i];
    if (c < 620) return x < 0.55 ? "U" : "O";
    if (c < 900) return "O";
    if (c < 1500) return x > 0.38 ? "A" : "D";
    return x > 0.3 ? "E" : "D";
  });
  for (let i = 1; i < raw.length - 1; i++)                   // creux bref entre deux sons forts : les levres se ferment (m, b, p)
    if (v[i] < 0.32 && v[i - 1] > 0.45 && v[i + 1] > 0.45) raw[i] = "M";
  for (let i = 1; i < raw.length; i++)                       // attaque apres un silence : une bouche a demi ouverte d'abord
    if (raw[i - 1] === "X" && (raw[i] === "A" || raw[i] === "O") && v[i] < 0.6) raw[i] = "D";
  // animation limitee : une bouche tient au moins deux images (sauf la fermeture breve)
  const out = [];
  let run = 0;
  for (let i = 0; i < raw.length; i++) {
    const prev = out[i - 1];
    if (i && raw[i] !== prev && run < 2 && prev !== "M" && raw[i] !== "X") { out.push(prev); run++; }
    else { run = raw[i] === prev ? run + 1 : 1; out.push(raw[i]); }
  }
  return { cues: out.join(""), dur: +(total / sr).toFixed(2), fps };
}

/** Reperage automatique de la bouche sur l'image de face d'un personnage detoure : on prend la tete en haut de la
 *  silhouette et on vise un peu au-dessus du menton. Rend { x, y, s, hw } ou null si l'image n'a pas de transparence. */
export function locateMouth(url) {
  return new Promise((ok) => {
    const im = new Image();
    im.onerror = () => ok(null);
    im.onload = () => {
      try {
        const hh = 360, ww = Math.max(8, Math.round(hh * im.naturalWidth / im.naturalHeight)), cv = document.createElement("canvas");
        cv.width = ww; cv.height = hh;
        const cx = cv.getContext("2d", { willReadFrequently: true });
        cx.drawImage(im, 0, 0, ww, hh);
        const d = cx.getImageData(0, 0, ww, hh).data, span = (y) => { let a = -1, b = -1; for (let x = 0; x < ww; x++) if (d[(y * ww + x) * 4 + 3] > 60) { if (a < 0) a = x; b = x; } return a < 0 ? null : [a, b]; };
        let top = 0; while (top < hh && !span(top)) top++;
        let bot = hh - 1; while (bot > top && !span(bot)) bot--;
        if (top >= hh - 4 || (top === 0 && span(0) && span(0)[1] - span(0)[0] > ww * 0.9)) return ok(null);
        const tall = bot - top;
        // la tete : on descend depuis le haut en gardant la plus grande largeur, jusqu'au cou (la ou la silhouette se
        // resserre nettement) ; sans cou, on s'arrete au premier cinquieme, avant les epaules
        let wide = 0, x0 = 0, x1 = 0, neck = top + Math.round(tall * 0.2);
        for (let y = top; y < top + Math.round(tall * 0.24); y++) {
          const sp = span(y);
          if (!sp) continue;
          const w = sp[1] - sp[0];
          if (y - top > tall * 0.05 && w < wide * 0.72) { neck = y; break; }
          if (y - top > tall * 0.1 && w > wide * 1.35) { neck = y; break; }      // les epaules arrivent sans cou marque
          if (w > wide) { wide = w; x0 = sp[0]; x1 = sp[1]; }
        }
        // une tete fait environ 1,3 fois sa largeur ; un menton etroit ne doit pas la raccourcir
        const headH = Math.min(Math.max(neck - top, wide * 1.3), tall * 0.3) || wide * 1.3;
        ok({ x: +((x0 + x1) / 2 / ww).toFixed(4), y: +((top + headH * 0.79) / hh).toFixed(4), s: +(Math.max(0.012, wide * 0.3 / hh)).toFixed(4), hw: +(wide * 0.36 / hh).toFixed(4) });
      } catch (e) { ok(null); }
    };
    im.src = url;
  });
}
