// Lip sync sans calcul lourd : le navigateur ecoute la voix (volume et couleur du son, 12 fois par seconde) et appelle
// une des neuf bouches dessinees au trait. Animation limitee : chaque bouche tient au moins deux images.
//   calque.lip = { on, src (fichier son du storyboard), name, dur, fps, cues ("XXAAEEMM…", une lettre par image),
//                  off (decalage en secondes), x, y (place de la bouche, fraction de la boite du personnage vu de face),
//                  s (largeur, fraction de la hauteur), hw (rayon de l'axe de la tete, fraction de la hauteur), bg (cache blanc) }
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
/** Dessin d'une bouche, centree sur l'origine, large d'environ 100. cache : pastille blanche qui couvre la bouche d'origine. */
export function mouthSvg(shape, cache = true) {
  return (cache ? `<ellipse rx="54" ry="${shape === "A" || shape === "L" || shape === "O" ? 42 : 30}" cy="${shape === "A" || shape === "L" ? 12 : 4}" fill="#fff"/>` : "") + (SHAPES[shape] || SHAPES.X);
}
export const mouthIcon = (shape) => `<svg viewBox="-56 -44 112 100" width="30" height="27">${mouthSvg(shape, false)}</svg>`;

/** Lettre de la bouche a l'instant t. */
export function cueAt(lip, t) {
  if (!lip || !lip.cues) return "X";
  const i = Math.floor((t - (lip.off || 0)) * (lip.fps || 12));
  return (i >= 0 && i < lip.cues.length && lip.cues[i]) || "X";
}

/** Balisage SVG de la bouche d'un calque. box : boite du calque ; angle : orientation de l'orbite en radians (0 = de face). */
export function lipMarkup(lip, box, flip, t, angle = 0) {
  if (!lip || !lip.on) return "";
  const c = Math.cos(angle);
  if (c < -0.12) return "";                                 // de dos : la bouche est derriere la tete
  const size = (lip.s ?? 0.035) * box.h, kx = Math.max(0.32, Math.abs(c));
  let cx = box.x + (lip.x ?? 0.5) * box.w - Math.sin(angle) * (lip.hw ?? 0.03) * box.h;   // l'axe tourne : la bouche part sur le cote
  const cy = box.y + (lip.y ?? 0.13) * box.h;
  if (flip) cx = 2 * box.cx - cx;
  return `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${(size / 100 * kx).toFixed(4)} ${(size / 100).toFixed(4)})" style="pointer-events:none">${mouthSvg(cueAt(lip, t), lip.bg !== false)}</g>`;
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
