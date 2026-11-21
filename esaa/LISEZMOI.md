# ESAA — film de l'événement (30 s, 9:16)

Projet associatif de l'ESAA : l'économie et la finance expliquées aux enfants.

- `export/esaa-30s-9x16.mp4` : film 1, 1080×1920, 30 i/s, H.264 + AAC 48 kHz (−14 LUFS).

## Montage

Règle (les deux films) : chaque plan montre quelqu'un qui fait coucou ou une vraie action —
pas de préparation de salle, pas de décor vide, pas de gens qui attendent, pas de poses figées.

| Temps | Plan |
| --- | --- |
| 0 – 4,1 s | Premiers coucous (trio, équipe sous BIENVENUE). Titre **ESAA · Projet associatif** sur l'intro de la musique. |
| 4,1 – 6,6 s | Coucous (deux garçons, la chaise qui vole derrière). |
| 6,6 – 11,7 s | L'économie en jeu : coucou devant les billets, stand « 2 pour 1 jeton ». |
| 11,7 – 17,7 s | Ateliers. |
| 17,7 – 24,3 s | Remise des diplômes : on vient le chercher, on le reçoit, on saute devant la caméra. |
| 24,3 – 26,9 s | Zooms sur trois parties de la photo de groupe 6921 (gauche, centre, droite), un par accent. |
| 26,9 – 30 s | Carte de fin avec la photo 6921 entière ; au BOUM (27,6 s, notre propre impact : le son de fin de la vidéo TikTok était le jingle du logo) : « L’économie et la finance expliquées aux enfants ». |

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

---

# Film 2 — « aftermovie » (57 s, 16:9 et 9:16), sur le modèle « CAREER EXPO »

- `export/esaa-aftermovie-16x9.mp4` : 1920×1080 (bande horizontale de chaque vidéo verticale).
- `export/esaa-aftermovie-9x16.mp4` : 1080×1920.

Même musique que le modèle, coupée à 57,2 s, juste avant le jingle du logo TikTok (57,28 s).
Analyse : 93,2 BPM (un temps = 0,644 s), groove à partir de 5,57 s, phrases de 4 mesures
qui commencent à 6,9 / 17,2 / 27,5 / 37,8 / 48,1 s (basse plus forte au début de chaque phrase).

| Temps | Chapitre |
| --- | --- |
| 0 – 5,6 s | Intro assombrie : premiers coucous. **ESAA** apparaît sur le 1er coup (0,35 s) ; de 1,0 à 2,9 s la police change à chaque coup, puis se fixe ; sous-titre « Projet associatif · L'économie et la finance expliquées aux enfants ». |
| 5,6 – 17,2 s | Les coucous (ralentis 50 % sur les vidéos 4K à 60 i/s). |
| 17,2 – 27,5 s | Les stands et l'économie : billets, stand « 2 pour 1 jeton », fous rires devant « Les Petits Génies de la Finance ». |
| 27,5 – 37,8 s | Ateliers (photo du pouce levé en 9:16). |
| 37,8 – 48,1 s | Remise des diplômes : les moments où ça bouge. |
| 48,1 – 55,9 s | Photos de groupe en rafale, zooms sur trois parties de la photo 6921 (la plus nette), puis la photo entière qui se dévoile (dézoom), jusqu'au noir. |
| 55,9 – 57,2 s | Noir, **ESAA · Projet associatif**. |

Look : LUT `tools/look.py` (contraste en S, ombres bleu-vert, tons moyens chauds, blancs crème,
couleurs plus denses, peaux protégées), vignettage et grain à l'encodage.

```
python3 esaa/tools/build2.py               # les deux formats
python3 esaa/tools/build2.py --preview     # planche des cadrages
```
Le cadrage 16:9 de chaque plan se règle avec `cy` dans `ACTS` (0 = haut, 1 = bas).
