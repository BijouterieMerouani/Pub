# EBCORE — « L’Algérie, dans chaque bouchée. »

Publicité cinématographique de **10 secondes exactement** pour EBCORE, chocolat premium inspiré de l’Algérie.
Le film est une vraie séquence 3D temps réel (Three.js / WebGL, shaders, post‑production) avec une bande‑son
entièrement synthétisée et synchronisée à l’image. Il est rendu image par image en **MP4 9:16 (1080×1920)**
et **MP4 16:9 (1920×1080)**, 30 i/s, son AAC stéréo 48 kHz.

![Storyboard](ad/export/storyboard.jpg)

## Fichiers livrés

| Fichier | Contenu |
| --- | --- |
| `ad/export/ebcore-9x16.mp4` | Version verticale TikTok / Reels / Shorts |
| `ad/export/ebcore-16x9.mp4` | Version horizontale |
| `ad/export/ebcore-soundtrack.wav` | Bande‑son seule (16 bits, 48 kHz) |
| `ad/index.html` | Lecteur interactif temps réel (bascule 9:16 / 16:9) |

## Découpage

| Temps | Plan | Image | Son |
| --- | --- | --- | --- |
| 0,0–2,0 s | **Le mystère** | Noir ; les contre‑jours dorés dessinent la boîte, puis la lumière de face la révèle. Travelling avant lent, poussière de cacao. Caméra basse : le logo du couvercle reste caché. | Sub grave en ré, souffle qui monte |
| 2,0–4,0 s | **La révélation** | Le couvercle s’ouvre (charnière, léger rebond), un faisceau traverse l’écrin, la caméra s’élève puis plonge vers le bonbon central. | Whoosh, coup sourd, scintillement doré, pulsation |
| 4,0–7,0 s | **L’explosion gourmande** | Raccord dans la matière : macro du bonbon, balayage de lumière, pression, fissure en zigzag, éclats au ralenti, caramel qui s’étire en fil, puis fine coulée de chocolat. | Tension, craquement multi‑couches + boom, éclats cristallins, coulée |
| 7,0–9,0 s | **La signature algérienne** | Praline gravée d’une étoile à huit branches (khatam), en rotation au‑dessus des dunes du Sahara au crépuscule ; ciel traversé d’un treillis géométrique doré. | Phrase d’oud en mode Hijaz, darbouka (maqsum), montée |
| 9,0–10,0 s | **Le plan final** | Packshot : la boîte au centre, quelques chocolats autour, caméra qui se pose. Logo EBCORE et signature. | Une respiration de silence, puis impact grave + accord et cloches |

## Lancer le projet

```bash
npm install
npm run preview          # lecteur temps réel → http://localhost:8080/
npm run render           # réexporte les deux MP4 + la bande-son dans ad/export/
npm run render:vertical  # 9:16 seulement
```

Prérequis de l’export : Node 18+, `ffmpeg` (libx264 + aac) et un Chromium.
Le script utilise le *headless shell* Playwright ; indiquez un autre binaire via `CHROMIUM_PATH=/chemin/vers/chrome`.
Le rendu passe par le moteur logiciel SwiftShader, il fonctionne donc aussi sans GPU (~3 s par image).

Débogage : `ad/index.html?t=5.6&format=16x9` affiche une image fixe à l’instant voulu, et
`node tools/render.mjs --stills 2.5,5.6 --format 9x16 --out /tmp/stills` exporte des images PNG.

## Architecture

```
ad/
  index.html          lecteur (le son sert d’horloge maîtresse : l’image suit l’audio)
  src/film.js         décors, matériaux, animation des 5 plans, caméra, post-production
  src/audio.js        bande-son synthétisée (OfflineAudioContext) + encodeur WAV
  src/title.js        carton final (typographie, balayage doré)
  src/textures.js     textures procédurales : couvercle, étoile khatam, feuille d’or, normal maps
  src/util.js         easing, splines temporelles, bruit, PRNG déterministe
  fonts/              Cinzel & Cormorant Garamond (SIL Open Font License)
  vendor/three/       Three.js r169 (MIT)
tools/
  render.mjs          export image par image (Chromium headless → ffmpeg)
  serve.mjs           serveur statique du lecteur
```

Toute l’animation est une fonction pure du temps (aléatoire à graine fixe) : le lecteur et l’export
produisent exactement les mêmes images, et la bande‑son est identique à l’échantillon près.

## Ce qui est réel, ce qui ne l’est pas

- **Aucune vidéo générée par IA.** Le projet ne contenait aucune ressource et le compte de génération vidéo
  disponible (Higgsfield) n’avait que 9,88 crédits pour un coût de 70 crédits par clip de 10 s.
  Tout est donc rendu en 3D procédurale, avec un rendu réaliste mais qui reste de l’image de synthèse temps réel,
  pas du tournage macro.
- **La boîte EBCORE est un prototype.** Aucune photo ni charte de la vraie boîte n’était fournie : le packaging
  (couvercle cacao, filets dorés, médaillon khatam, mention « CHOCOLAT ») est une proposition cohérente avec
  l’univers demandé. Pour utiliser le vrai packaging, remplacez la texture du couvercle (`lidTextures()` dans
  `ad/src/textures.js`) par le visuel officiel, ou fournissez un modèle 3D de la boîte.
- Pour aller vers un rendu « tournage » : des plans macro filmés ou générés par IA (Higgsfield, Kling,
  Seedance…) pourraient remplacer le plan 3 en gardant ce montage, ce rythme et cette bande‑son, une fois
  des crédits disponibles.
