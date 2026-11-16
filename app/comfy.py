"""ComfyUI par HTTP : graphes de Board Wizzard (orbite H3 + detourage, edition Qwen, image Z-Image), envoi, suivi.

Bibliotheque standard seulement. Cote machine : ComfyUI >= 0.33, noeud comfyui-h3-orbital (H3OrbitalConditioning),
LoRA 360 Orbit, BiRefNet (RemoveBackground natif), Qwen-Image-Edit 2509 + LoRA Lightning, Z-Image Turbo.
Le client HTTP (upload, submit, poll, download) vient d'Alive-Comics.
"""

import json
import mimetypes
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

H3_UNET = "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
H3_LORA = "minimax_h3_flf2v_lora_v1.safetensors"
H3_CLIP = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
H3_VAE = "minimax_h3_video_vae_fp16.safetensors"
QWEN_UNET = "qwen_image_edit_2509_fp8_e4m3fn.safetensors"            # Apache-2.0
QWEN_LORA = "Qwen-Image-Edit-2509-Lightning-8steps-V1.0-bf16.safetensors"
QWEN_CLIP = "qwen_2.5_vl_7b_fp8_scaled.safetensors"
QWEN_VAE = "qwen_image_vae.safetensors"
ZIMG_UNET = "z_image_turbo_bf16.safetensors"                          # Apache-2.0
ZIMG_CLIP = "qwen_3_4b.safetensors"
ZIMG_VAE = "ae.safetensors"
BIREFNET = "birefnet.safetensors"                                     # MIT

# Prompt de l'auteur du LoRA 360 Orbit (Pablo Dawson), mot pour mot. Le noeud H3OrbitalConditioning l'ajoute lui-meme
# en local ; fal a besoin du texte complet.
ORBIT_PROMPT = (
    "One frozen instant. Only the camera moves. In a continuous 360 orbit. Preserve every person and "
    "object in exactly the same world position, orientation, shape and pose throughout the shot. Airborne "
    "objects remain suspended at the captured height and angle: no wobbling, shaking, spinning, drifting, "
    "falling or continued action. Keep faces, hands, clothing, liquids and the background motionless while "
    "retaining their natural appearance. Camera parallax is the only source of apparent movement. No cuts, "
    "zoom, morphing or added objects."
)


class ComfyError(RuntimeError):
    pass


def http_json(url, payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8") or "null")


def upload(server, path, subfolder="boardwizzard"):
    """POST /upload/image ; renvoie 'sous-dossier/nom' pour LoadImage.image."""
    path = Path(path)
    boundary = "----boardwizzard-" + uuid.uuid4().hex
    mime = mimetypes.guess_type(path.name)[0] or "image/png"

    def part(name, value, ctype=None, filename=None):
        head = '--%s\r\nContent-Disposition: form-data; name="%s"' % (boundary, name)
        if filename:
            head += '; filename="%s"' % filename
        if ctype:
            head += "\r\nContent-Type: %s" % ctype
        body = value if isinstance(value, bytes) else str(value).encode()
        return head.encode() + b"\r\n\r\n" + body + b"\r\n"

    name = "%s_%s" % (uuid.uuid4().hex[:8], path.name)
    body = b"".join([part("image", path.read_bytes(), mime, name), part("type", "input"),
                     part("subfolder", subfolder), part("overwrite", "true"), ("--%s--\r\n" % boundary).encode()])
    req = urllib.request.Request(server.rstrip("/") + "/upload/image", data=body, method="POST",
                                 headers={"Content-Type": "multipart/form-data; boundary=" + boundary})
    with urllib.request.urlopen(req, timeout=120) as r:
        res = json.loads(r.read().decode("utf-8"))
    return "%s/%s" % (res["subfolder"], res["name"]) if res.get("subfolder") else res["name"]


# ------------------------------------------------------------------ graphes
def orbit_graph(start, prefix, length=73, seed=1, megapixels=0.6, prompt="", steps=28, matte=True, refs=None):
    """Orbite 360 H3 en boucle (1re image = derniere). Sorties : video couleur (noeud 16) et, si matte, video du
    masque BiRefNet image par image (noeud 44, blanc = sujet). refs : {"character": [noms], "set": [noms]}."""
    g = {
        "1": {"class_type": "LoadImage", "inputs": {"image": start}},
        "2": {"class_type": "ImageScaleToTotalPixels", "inputs": {"image": ["1", 0], "upscale_method": "lanczos",
                                                                  "megapixels": float(megapixels),
                                                                  "resolution_steps": 32}},
        "4": {"class_type": "UNETLoader", "inputs": {"unet_name": H3_UNET, "weight_dtype": "default"}},
        "5": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["4", 0], "lora_name": H3_LORA,
                                                               "strength_model": 1.0}},
        "6": {"class_type": "CLIPLoader", "inputs": {"clip_name": H3_CLIP, "type": "minimax", "device": "default"}},
        "7": {"class_type": "VAELoader", "inputs": {"vae_name": H3_VAE}},
        "9": {"class_type": "RandomNoise", "inputs": {"noise_seed": int(seed)}},
        "10": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "res_multistep"}},
        "11": {"class_type": "BasicScheduler", "inputs": {"model": ["5", 0], "scheduler": "simple",
                                                          "steps": int(steps), "denoise": 1.0}},
        "12": {"class_type": "BasicGuider", "inputs": {"model": ["5", 0], "conditioning": ["8", 0]}},
        "13": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["9", 0], "guider": ["12", 0],
                                                                 "sampler": ["10", 0], "sigmas": ["11", 0],
                                                                 "latent_image": ["8", 1]}},
        "14": {"class_type": "VAEDecode", "inputs": {"samples": ["13", 0], "vae": ["7", 0]}},
        "15": {"class_type": "CreateVideo", "inputs": {"images": ["14", 0], "fps": 24, "bit_depth": 8}},
        "16": {"class_type": "SaveVideo", "inputs": {"video": ["15", 0], "filename_prefix": prefix + "_rgb",
                                                     "format": "auto", "codec": "auto"}},
    }
    cond = {"clip": ["6", 0], "vae": ["7", 0], "start_image": ["2", 0], "mode": "orbit", "prompt": prompt,
            "length": int(length), "ref_image_size": "match", "mirror": False}
    for kind, base in (("character", 21), ("set", 31)):
        for i, name in enumerate(((refs or {}).get(kind) or [])[:4]):
            g[str(base + i)] = {"class_type": "LoadImage", "inputs": {"image": name}}
            cond["%s_%d" % (kind, i + 1)] = [str(base + i), 0]
    g["8"] = {"class_type": "H3OrbitalConditioning", "inputs": cond}
    if matte:
        g.update({
            "40": {"class_type": "LoadBackgroundRemovalModel", "inputs": {"bg_removal_name": BIREFNET}},
            "41": {"class_type": "RemoveBackground", "inputs": {"bg_removal_model": ["40", 0], "image": ["14", 0]}},
            "42": {"class_type": "MaskToImage", "inputs": {"mask": ["41", 0]}},
            "43": {"class_type": "CreateVideo", "inputs": {"images": ["42", 0], "fps": 24, "bit_depth": 8}},
            "44": {"class_type": "SaveVideo", "inputs": {"video": ["43", 0], "filename_prefix": prefix + "_matte",
                                                         "format": "auto", "codec": "auto"}},
        })
    return g


def matte_graph(image, prefix):
    """Detourage d'une image fixe : PNG avec transparence (noeud 5)."""
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": image}},
        "2": {"class_type": "LoadBackgroundRemovalModel", "inputs": {"bg_removal_name": BIREFNET}},
        "3": {"class_type": "RemoveBackground", "inputs": {"bg_removal_model": ["2", 0], "image": ["1", 0]}},
        "6": {"class_type": "InvertMask", "inputs": {"mask": ["3", 0]}},
        "4": {"class_type": "JoinImageWithAlpha", "inputs": {"image": ["1", 0], "alpha": ["6", 0]}},
        "5": {"class_type": "SaveImage", "inputs": {"images": ["4", 0], "filename_prefix": prefix}},
    }


def edit_graph(images, prompt, prefix, seed=1, megapixels=1.0, fast=True):
    """Qwen-Image-Edit 2509 : jusqu'a 3 images (la 1re fixe le format de sortie). Sert aux poses, aux vues,
    a « Integrate ». Sortie : noeud 20."""
    g = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": QWEN_UNET, "weight_dtype": "default"}},
        "3": {"class_type": "CLIPLoader", "inputs": {"clip_name": QWEN_CLIP, "type": "qwen_image", "device": "default"}},
        "4": {"class_type": "VAELoader", "inputs": {"vae_name": QWEN_VAE}},
    }
    model = ["1", 0]
    if fast:
        g["2"] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": model, "lora_name": QWEN_LORA,
                                                                   "strength_model": 1.0}}
        model = ["2", 0]
    g["9"] = {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": model, "shift": 3.0}}
    pos = {"clip": ["3", 0], "prompt": prompt, "vae": ["4", 0]}
    neg = {"clip": ["3", 0], "prompt": "", "vae": ["4", 0]}
    for i, name in enumerate(images[:3]):
        g[str(50 + i)] = {"class_type": "LoadImage", "inputs": {"image": name}}
        g[str(60 + i)] = {"class_type": "ImageScaleToTotalPixels", "inputs": {
            "image": [str(50 + i), 0], "upscale_method": "lanczos", "megapixels": float(megapixels),
            "resolution_steps": 16}}
        pos["image%d" % (i + 1)] = neg["image%d" % (i + 1)] = [str(60 + i), 0]
    g.update({
        "10": {"class_type": "TextEncodeQwenImageEditPlus", "inputs": pos},
        "11": {"class_type": "TextEncodeQwenImageEditPlus", "inputs": neg},
        "12": {"class_type": "VAEEncode", "inputs": {"pixels": ["60", 0], "vae": ["4", 0]}},
        "13": {"class_type": "KSampler", "inputs": {
            "model": ["9", 0], "seed": int(seed), "steps": 8 if fast else 24, "cfg": 1.0 if fast else 2.5,
            "sampler_name": "euler", "scheduler": "simple", "positive": ["10", 0], "negative": ["11", 0],
            "latent_image": ["12", 0], "denoise": 1.0}},
        "14": {"class_type": "VAEDecode", "inputs": {"samples": ["13", 0], "vae": ["4", 0]}},
        "20": {"class_type": "SaveImage", "inputs": {"images": ["14", 0], "filename_prefix": prefix}},
    })
    return g


def t2i_graph(prompt, prefix, width=1024, height=1024, seed=1, steps=9):
    """Z-Image Turbo : une image a partir d'un texte (assets, personnages, decors). Sortie : noeud 9."""
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": ZIMG_UNET, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": ZIMG_CLIP, "type": "lumina2", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": ZIMG_VAE}},
        "4": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["1", 0], "shift": 3.0}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": prompt}},
        "6": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["5", 0]}},
        "7": {"class_type": "EmptySD3LatentImage", "inputs": {"width": int(width) // 16 * 16,
                                                               "height": int(height) // 16 * 16, "batch_size": 1}},
        "8": {"class_type": "KSampler", "inputs": {
            "model": ["4", 0], "seed": int(seed), "steps": int(steps), "cfg": 1.0, "sampler_name": "res_multistep",
            "scheduler": "simple", "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["7", 0],
            "denoise": 1.0}},
        "10": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["10", 0], "filename_prefix": prefix}},
    }


# ------------------------------------------------------------------ execution
def submit(server, graph):
    try:
        res = http_json(server.rstrip("/") + "/prompt", {"prompt": graph, "client_id": str(uuid.uuid4())})
    except urllib.error.HTTPError as e:
        raise ComfyError("ComfyUI a refuse le graphe : " + e.read().decode("utf-8", "replace")[:1500])
    return res["prompt_id"]


def poll(server, prompt_id):
    """None tant que ce n'est pas fini ; sinon l'entree d'historique. Leve ComfyError si erreur."""
    entry = http_json("%s/history/%s" % (server.rstrip("/"), prompt_id)).get(prompt_id)
    if not entry:
        return None
    status = entry.get("status") or {}
    if status.get("status_str") == "error":
        msgs = [m for m in status.get("messages", []) if m and m[0] == "execution_error"]
        detail = msgs[0][1].get("exception_message", "") if msgs else ""
        raise ComfyError("rendu en erreur : " + (detail or json.dumps(msgs))[:1500])
    return entry if status.get("completed") else None


def node_files(entry, node):
    """Fichiers produits par un noeud de sortie."""
    out = (entry.get("outputs") or {}).get(str(node)) or {}
    return [item for key in ("images", "videos", "gifs") for item in out.get(key) or []]


def download(server, item, dest):
    q = urllib.parse.urlencode({"filename": item["filename"], "subfolder": item.get("subfolder", ""),
                                "type": item.get("type", "output")})
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen("%s/view?%s" % (server.rstrip("/"), q), timeout=600) as r:
        dest.write_bytes(r.read())
    return dest


def queue_load(server):
    q = http_json(server.rstrip("/") + "/queue", timeout=8)
    return len(q.get("queue_running", [])) + len(q.get("queue_pending", []))


def cancel(server, prompt_id):
    try:
        http_json(server.rstrip("/") + "/queue", {"delete": [prompt_id]}, timeout=8)
        q = http_json(server.rstrip("/") + "/queue", timeout=8)
        if any(item[1] == prompt_id for item in q.get("queue_running", [])):
            http_json(server.rstrip("/") + "/interrupt", {}, timeout=8)
    except (OSError, ValueError):
        pass


def preflight(server):
    """{online, version, gpu, load, orbit, matte, edit, t2i, missing} : ce que la machine sait faire."""
    out = {"online": False, "version": "", "gpu": "", "load": 0, "orbit": False, "matte": False, "edit": False,
           "t2i": False, "missing": []}
    base = server.rstrip("/")
    try:
        stats = http_json(base + "/system_stats", timeout=6)
    except (OSError, ValueError) as exc:
        out["missing"] = ["injoignable (%s)" % exc.__class__.__name__]
        return out
    out["online"] = True
    out["version"] = stats.get("system", {}).get("comfyui_version", "")
    devs = stats.get("devices") or []
    if devs:
        name = re.sub(r"^cuda:\d+\s*", "", devs[0].get("name", "")).split(" : ")[0]
        out["gpu"] = name.replace("NVIDIA GeForce ", "")[:30]

    def has(node, field=None, fname=None):
        try:
            info = http_json("%s/object_info/%s" % (base, node), timeout=10)
        except (OSError, ValueError):
            return False
        if node not in info:
            return False
        if field:
            spec = info[node]["input"]["required"][field]
            opts = spec[1].get("options", []) if spec[0] == "COMBO" else spec[0]
            return fname in opts
        return True

    checks = {
        "orbit": [("H3OrbitalConditioning",), ("UNETLoader", "unet_name", H3_UNET),
                  ("LoraLoaderModelOnly", "lora_name", H3_LORA), ("CLIPLoader", "clip_name", H3_CLIP)],
        "matte": [("RemoveBackground",), ("LoadBackgroundRemovalModel", "bg_removal_name", BIREFNET)],
        "edit": [("TextEncodeQwenImageEditPlus",), ("UNETLoader", "unet_name", QWEN_UNET),
                 ("CLIPLoader", "clip_name", QWEN_CLIP), ("LoraLoaderModelOnly", "lora_name", QWEN_LORA)],
        "t2i": [("UNETLoader", "unet_name", ZIMG_UNET), ("CLIPLoader", "clip_name", ZIMG_CLIP)],
    }
    for key, items in checks.items():
        out[key] = all(has(*c) for c in items)
        if not out[key]:
            out["missing"].append(key)
    try:
        out["load"] = queue_load(base)
    except (OSError, ValueError):
        pass
    return out
