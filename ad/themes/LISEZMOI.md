# Images des thèmes ASSEL

Déposez une image par thème dans ce dossier, puis associez-la à son chocolat dans
`themes.json`. Le film les charge telles quelles : elles sont seulement agrandies
uniformément pour couvrir l’écran, jamais déformées ni retouchées.

```jsonc
{
  "id": "mer",              // identifiant libre (sert aussi à choisir l'ambiance sonore : mer, foret, montagne, desert)
  "chocolate": "star",      // chocolat associé : date | white | star | round
  "image": "mer.jpg",       // fichier image dans ce dossier
  "title": "MER",           // légende affichée
  "subtitle": "Fleur de sel de la Méditerranée",
  "focus": [0.4, 0.62],     // point à garder au centre quand l'image est recadrée (0..1, depuis le coin haut-gauche)
  "light": "#9fd8ff",       // couleur de la lumière portée sur le chocolat et des rayons
  "rays": [0.3, 0.24],      // origine des rayons de lumière dans l'image (0..1)
  "particles": "spray"      // spray | pollen | snow | sand | gold
}
```

- Les commentaires ci-dessus sont explicatifs : le vrai fichier est du JSON sans commentaires.
- Il faut exactement un thème par chocolat (4). L’ordre dans `themes.json` est l’ordre d’apparition (6–9 s, 9–12 s, 12–15 s, 15–18 s).
- Format conseillé : vertical, au moins 1080×1920 px. Une image plus petite fonctionne mais sera plus douce.
- Après un changement, relancez `npm run render` pour réexporter les MP4.
- La marque et le slogan du carton final se règlent aussi dans `themes.json` (`brand`, `slogan`).

Images actuelles : vos quatre photos. `mer.jpg` et `montagne.jpg` ont été agrandies ×4
(super‑résolution EDSR) puis réduites à 1440 px de large ; `foret.jpg` et `desert.jpg` sont
les originaux, réenregistrés en JPEG sans recadrage.
