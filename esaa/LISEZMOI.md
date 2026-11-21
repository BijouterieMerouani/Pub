# ESAA — film de l'événement (30 s, 9:16)

Projet associatif de l'ESAA : l'économie et la finance expliquées aux enfants.

- `export/esaa-30s-9x16.mp4` : film final, 1080×1920, 30 i/s, H.264 + AAC 48 kHz (−14 LUFS).

## Montage

| Temps | Plan |
| --- | --- |
| 0 – 4,1 s | Préparation (lettres BIENVENUE). Titre **ESAA · Projet associatif** sur l'intro de la musique. |
| 4,1 – 6,6 s | Accueil : buffet, ballons, stand. |
| 6,6 – 11,7 s | L'économie en jeu : billets, stand « 2 pour 1 jeton ». |
| 11,7 – 17,7 s | Ateliers. |
| 17,7 – 24,3 s | Remise des diplômes. |
| 24,3 – 26,9 s | Panoramique sur la photo de groupe. |
| 26,9 – 30 s | Carte de fin ; au BOUM (27,6 s) : « L'économie et la finance expliquées aux enfants ». |

Toutes les coupes tombent sur les accents de la musique (94,9 BPM, motif 3+3+2).
La musique (24 s) est allongée à 30 s en rejouant deux mesures (même accord) ; le BOUM final
est prolongé par une réverbération.

## Refaire le film

```
python3 esaa/tools/build.py
```

Les vidéos sources sont lues depuis le dossier des fichiers envoyés (`ESAA_UPLOADS`).
Changer un plan : modifier `TIMELINE` dans `tools/build.py` (source, point d'entrée en s,
nombre d'accents). La grille de la musique est dans `music.json`
(`python3 esaa/tools/music.py --analyse` pour la recalculer, nécessite librosa).
