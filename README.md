# EBCORE — « L’Algérie, dans chaque bouchée. »

Publicité de **10 secondes exactement** pour EBCORE, chocolat premium inspiré de l’Algérie, en
**MP4 9:16 (1080×1920)** et **MP4 16:9 (1920×1080)**, 30 i/s, son AAC stéréo 48 kHz.

La version principale est construite à partir des **vraies photos** fournies : la boîte
« L’Algérie · 4 régions · 4 saveurs » et le coucher de soleil sur le Sahara. Les photos sont
animées en 2,5D (parallaxe par carte de profondeur, profondeur de champ, lumière, reflets sur les
dorures, particules) et montées sur une bande‑son composée et synchronisée à l’image.

![Storyboard](ad/export/storyboard.jpg)

## Fichiers livrés

| Fichier | Contenu |
| --- | --- |
| `ad/export/ebcore-9x16.mp4` | Version verticale TikTok / Reels / Shorts (photos réelles) |
| `ad/export/ebcore-16x9.mp4` | Version horizontale (photos réelles) |
| `ad/export/ebcore-soundtrack.wav` | Bande‑son seule (16 bits, 48 kHz) |
| `ad/export/ebcore-3d-*.mp4` | Première version, entièrement en 3D procédurale |
| `ad/index.html` | Lecteur interactif (bascule 9:16 / 16:9 ; `?film=3d` pour la version 3D) |

## Découpage

| Temps | Plan | Image | Son |
| --- | --- | --- | --- |
| 0,0–2,0 s | **Le mystère** | Noir ; un halo de lumière chaude glisse sur le couvercle, les dorures s’allument une à une. Travelling avant lent, poussière de cacao. | Sub grave en ré, souffle qui monte |
| 2,0–4,0 s | **La révélation** | Un faisceau doré balaie la boîte et l’éclaire entièrement, puis la caméra plonge vers le chocolat‑datte, la mise au point se resserre. | Whoosh, coup sourd, scintillement doré, pulsation |
| 4,0–7,0 s | **Les quatre saveurs** | Quatre gros plans sur le temps, un par chocolat : Désert (dattes de Biskra), Mer (fleur de sel), Forêt (miel de chêne de Kabylie), Montagne (amandes des Aurès). | Un accent par plan, montée dans le mode Hijaz |
| 7,0–9,0 s | **La signature algérienne** | La photo du Sahara en arrière‑plan (soleil, caravane), légère brume de chaleur ; le chocolat‑datte flotte au premier plan. | Phrase d’oud en mode Hijaz, darbouka (maqsum), montée |
| 9,0–10,0 s | **Le plan final** | Packshot de la boîte, caméra qui se pose. Logo EBCORE et signature. | Une respiration de silence, puis impact grave + accord et cloches |

## Lancer le projet

```bash
npm install
npm run preview          # lecteur temps réel → http://localhost:8080/
npm run render           # réexporte les deux MP4 + la bande-son dans ad/export/
npm run render:vertical  # 9:16 seulement
node tools/render.mjs --film 3d   # version 3D procédurale
```

Prérequis de l’export : Node 18+, `ffmpeg` (libx264 + aac) et un Chromium.
Le script utilise le *headless shell* Playwright ; indiquez un autre binaire via `CHROMIUM_PATH=/chemin/vers/chrome`.
Le rendu passe par le moteur logiciel SwiftShader, il fonctionne donc aussi sans GPU (~3 s par image).

Les ressources de `ad/assets/` sont générées depuis les photos par
`python3 tools/prepare_assets.py BOITE.png SAHARA.jpg` (Pillow + NumPy). Les photos ont d’abord été
agrandies ×4 avec le modèle de super‑résolution EDSR d’OpenCV (`cv2.dnn_superres`).
Pour changer de photo de boîte avec un cadrage différent, ajustez les coordonnées en tête du script
(chocolats, couvercle) et les points d’intérêt `P` dans `ad/src/film-photo.js`.

Débogage : `ad/index.html?t=5.6&format=16x9` affiche une image fixe à l’instant voulu, et
`node tools/render.mjs --stills 2.5,5.6 --format 9x16 --out /tmp/stills` exporte des images PNG.

## Architecture

```
ad/
  index.html          lecteur (le son sert d’horloge maîtresse : l’image suit l’audio)
  src/film-photo.js   version photo : calques 2,5D, cadrages, lumière, montage des 5 plans
  src/film.js         version 3D procédurale + shaders communs (particules, étalonnage)
  src/audio.js        bande-son synthétisée (OfflineAudioContext) + encodeur WAV
  src/title.js        carton final et légendes (typographie, balayage doré)
  assets/             photos préparées : boîte, flou, profondeur, masque des dorures, datte détourée, Sahara
  src/textures.js     textures procédurales : couvercle, étoile khatam, feuille d’or, normal maps
  src/util.js         easing, splines temporelles, bruit, PRNG déterministe
  fonts/              Cinzel & Cormorant Garamond (SIL Open Font License)
  vendor/three/       Three.js r169 (MIT)
tools/
  render.mjs          export image par image (Chromium headless → ffmpeg)
  serve.mjs           serveur statique du lecteur
  prepare_assets.py   génère ad/assets/ depuis les photos
```

Toute l’animation est une fonction pure du temps (aléatoire à graine fixe) : le lecteur et l’export
produisent exactement les mêmes images, et la bande‑son est identique à l’échantillon près.

## Ce qui est réel, ce qui ne l’est pas

- **Les images sont les vraies photos fournies**, agrandies par super‑résolution puis animées :
  mouvements de caméra, parallaxe, mise au point, lumière et reflets. Rien n’y est redessiné.
- **Pas de mouvement physique du produit.** À partir de photos fixes, la boîte ne peut pas s’ouvrir
  et les chocolats ne peuvent pas se briser ou couler. Ces actions demandent des plans filmés ou
  générés par IA vidéo (par exemple Higgsfield, ~35 crédits par plan de 5 s ; le compte connecté en
  avait 9,88).
- **Correspondance chocolat ↔ région déduite des formes** (datte → Désert, étoile → Mer,
  bonbon à la noisette/amande → Montagne, chocolat blanc → Forêt). À vérifier : elle se modifie dans
  `TOUR` (`ad/src/film-photo.js`).
- Les photos sources sont en basse définition (623×624 et 736×1313) : les gros plans restent un peu
  doux. Des photos haute définition de chaque chocolat amélioreraient directement le plan 3.
- La version 3D d’origine (`ebcore-3d-*.mp4`) utilise un packaging prototype, sans lien avec la
  vraie boîte.
