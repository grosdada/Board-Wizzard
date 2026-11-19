"""Points du visage d'une image, pour mettre au point « Transposer » du portrait-robot (voir app/transpose.py).

Ce script ne sert qu'au travail par lot : dans l'appli, le reperage se fait dans le navigateur, avec le meme modele
(app/web/vendor/mediapipe/face_landmarker.task). Il lui faut MediaPipe, qui n'est PAS installe dans le Python de l'appli
(il y remplacerait numpy et OpenCV) : le lancer avec un environnement a part, par exemple
    %USERPROFILE%\\.board-wizzard\\venv-face\\Scripts\\python tools/facepoints.py data/tmp/tpdne/*.jpg

Pour chaque image, ecrit a cote <nom>.json : {w, h, points: [[x, y, z] x 478] en pixels, shapes: {nom: score} (expressions),
matrix: 4 x 4 (pose de la tete)}. Rien si aucun visage.
"""
import glob
import json
import sys
from pathlib import Path

import mediapipe as mp
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision

MODEL = Path(__file__).resolve().parent.parent / "app" / "web" / "vendor" / "mediapipe" / "face_landmarker.task"


def main():
    files = [f for a in sys.argv[1:] for f in (glob.glob(a) or [a])]
    opt = vision.FaceLandmarkerOptions(base_options=mpp.BaseOptions(model_asset_buffer=MODEL.read_bytes()), num_faces=1,
                                       output_face_blendshapes=True, output_facial_transformation_matrixes=True)
    with vision.FaceLandmarker.create_from_options(opt) as det:
        for f in files:
            im = mp.Image.create_from_file(f)
            r = det.detect(im)
            if not r.face_landmarks:
                print("aucun visage :", f, flush=True)
                continue
            pts = [[round(p.x * im.width, 2), round(p.y * im.height, 2), round(p.z * im.width, 2)] for p in r.face_landmarks[0]]
            out = {"w": im.width, "h": im.height, "points": pts,
                   "shapes": {b.category_name: round(b.score, 4) for b in (r.face_blendshapes[0] if r.face_blendshapes else [])},
                   "matrix": [[round(float(v), 5) for v in row] for row in (r.facial_transformation_matrixes[0] if r.facial_transformation_matrixes else [])]}
            Path(f).with_suffix(".json").write_text(json.dumps(out), encoding="utf-8")
            print("ok", f, len(pts), "points", flush=True)


if __name__ == "__main__":
    main()
