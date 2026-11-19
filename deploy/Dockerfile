# Board Wizzard : l'image ne contient que Python, ffmpeg et les bibliothèques.
# Le code (app/, tools/) est monté en lecture seule depuis le clone git : une mise à jour = git pull + redémarrage.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "pillow>=10" "numpy>=1.26" "opencv-python-headless>=4.8"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TMPDIR=/bw/tmp

WORKDIR /bw
USER 1000:1000
EXPOSE 8795
CMD ["python", "-m", "app", "--no-browser", "--host", "0.0.0.0", "--port", "8795"]
