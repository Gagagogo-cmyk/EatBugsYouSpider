# Partage décentralisé — aperçu de l'architecture

> Note d'exploration, pas un plan de construction. Rien de ce qui suit n'est
> implémenté. À lire avec `docs/protocol/SPLIT_EQUATION.md` (graphe de follow),
> `docs/instrument/LINK.md` (transport multicast déjà en place) et `XREF.md`.

## Où en est EBYS aujourd'hui
EBYS est déjà à moitié décentralisé, par accident plutôt que par design. Côté
instrument, chaque deck est un nœud autonome complet : bibliothèque locale dans
`data/`, analyse locale (Demucs → madmom/Essentia → FluCoMa), index local
(`ebys.db`, `ebys_index.json`), moteur de sélection local. Aucun script de
`src/demucs/` ne contacte `src/backend/` ; tout circule par des fichiers.

La centralisation est ailleurs, et elle est concentrée sur trois points :
le backend Express + Postgres sur Railway (journal de session, équation de
partage, payouts), Stripe (l'argent, le KYC), et Icecast/Liquidsoap (le flux).

La question utile n'est donc pas « comment décentraliser EBYS » — l'instrument
l'est déjà — mais **ce qui circulerait entre deux decks, et sous quelle forme**.

## Ce qui circule : trois couches, pas une
Le réflexe est de raisonner en « partage de fichiers musicaux ». Pour EBYS
c'est la mauvaise granularité : ce qui a de la valeur et ce qui a du risque ne
sont pas dans la même couche.

| Couche | Contenu | Poids | Risque juridique | Fédérable |
|---|---|---|---|---|
| **Descripteurs** | slices, `C S E F P H T`, `M0–M5`, downbeats, genres, bpm, key — le contenu de `ebys.db` | ~100 octets par slice | Donnée dérivée, non reconstructible en audio | Oui, largement |
| **Stems** | sortie Demucs, 4 pistes par morceau | Taille de la piste × 4 | Œuvre dérivée directe | Cercle restreint seulement |
| **Audio source** | `data/raw_uploads/` | Taille de la piste | Identique à un partage de fichiers classique | Non |

L'observation qui compte : **le coût réel n'est pas le transfert audio, c'est
l'analyse**. Séparer, tagger et découper une piste prend des heures de CPU/GPU
locale. Deux decks qui ingèrent la même piste refont deux fois le même calcul.
Partager la couche descripteurs a donc plus de valeur pratique que partager
l'audio — et c'est justement la couche la moins problématique à distribuer.

## Technologies connexes
- **BitTorrent / WebTorrent** — fichiers découpés en morceaux hachés, pairs
  découverts par tracker ou DHT. Décentralise le transfert, pas la persistance :
  la disponibilité dépend des seeders. Pertinent seulement pour la couche stems.
- **libp2p** — pile P2P générique (découverte, hole-punching NAT, transport).
  Plus lourd que ce que demande une portée LAN, plus adapté si la portée devient
  publique.
- **ActivityPub** — fédération de métadonnées entre serveurs indépendants.
  Le modèle de fédération est le bon ; le protocole lui-même est surdimensionné
  pour un échange d'index de slices entre quelques decks.
- **Stockage sur blockchain** (Filecoin, Arweave) — résout la persistance par
  incitation économique, au prix d'une couche de jetons. **Non pertinent ici**,
  et pas seulement pour des raisons techniques : `docs/protocol/TIPPING_PROTOCOL.md`
  pose comme principe que les auditeurs paient en dollars, « no crypto required,
  ever », et `docs/protocol/TOKEN.md` range explicitement CRKT dans le
  spéculatif. Une couche de stockage à jetons contredirait le protocole actif.

## Architecture proposée : fédération de métadonnées + P2P optionnel
Le point clé : **presque toutes les primitives nécessaires existent déjà** sous
un autre nom. L'exercice consiste à les rebrancher, pas à en inventer.

**1. Le pod, c'est le deck.** Pas besoin d'un nouveau serveur : `ws_server.js`
tient déjà l'index en mémoire et écoute sur `:8080`. Ce qui manque est une
surface de lecture (authentifiée) sur cet index, pas un processus de plus.
Prérequis technique connu — voir `notes.md`, §1 « To fix » point 2 : `ebys.db` n'a
aujourd'hui aucun lecteur JS, seul `import_library.py` y écrit. Toute fédération passe par
là d'abord.

**2. Le graphe de fédération, c'est le graphe de follow.**
`docs/protocol/SPLIT_EQUATION.md` définit déjà *following* comme « je reconnais
l'influence et j'accepte la participation au partage ». La même arête peut
porter « j'accepte de partager mon index ». Ne pas construire un second graphe
social à côté du premier : le graphe de partage et le graphe de rémunération
doivent être le même objet, sinon on peut jouer les slices de quelqu'un sans
qu'il soit dans le split.

**3. LINK est le précurseur, et il est déjà écrit.** `src/tui/link_server.js`
fait déjà de la découverte multicast UDP entre decks sur un LAN, en processus
séparé. La première étape réaliste est donc une fédération **à portée de salle**
— deux decks dans la même pièce échangent leurs index — sans NAT, sans relais,
sans DHT, et testable en conditions live. La portée internet est une extension
ultérieure, pas le point de départ.

**4. L'adressage par contenu est le vrai prérequis manquant.** Aujourd'hui
l'identité d'une piste est son nom de fichier : `tracks.name TEXT UNIQUE` dans
`ebys.db`, et côté backend `src/backend/db/queries.js:57` le dit explicitement —
« EBYS identifies tracks by filename — we use that as the fingerprint ». Or
`TIPPING_PROTOCOL.md` fait reposer l'escrow des artistes non réclamés sur cette
« audio fingerprint ». Deux decks qui ont la même piste sous deux noms
différents ne peuvent ni dédupliquer, ni s'accorder sur qui doit être payé.

Un hash du contenu audio décodé (ou une empreinte perceptuelle, si on veut
résister au ré-encodage) règle trois problèmes d'un coup : déduplication entre
decks, identité d'artiste stable pour le split, et clé de cache pour réutiliser
une analyse déjà faite ailleurs. **C'est le premier chantier, et il a de la
valeur même si la fédération ne se fait jamais.**

**5. Le transfert P2P vient en dernier.** Une fois qu'un pair est identifié via
la fédération et qu'un contenu est adressé par hash, le transfert direct
(WebTorrent ou libp2p) est un problème résolu par ailleurs. Il ne devient
intéressant qu'une fois les points 1 à 4 en place.

## Ce qui reste centralisé — et pourquoi c'est acceptable
- **Stripe** — l'argent et le KYC ne se décentralisent pas, et le protocole
  assume ce choix.
- **Le backend** — journal de session, équation de partage, payouts. La bonne
  réponse n'est pas le P2P mais l'**auto-hébergement** : une instance par
  collectif ou par radio, fédérée avec les autres. Le projet est sous AGPL-3.0,
  ce qui rend l'auto-hébergement d'une version modifiée cohérent avec la licence.
- **Icecast / Liquidsoap** — la diffusion est du un-vers-plusieurs. Le streaming
  P2P (WebRTC) est un autre problème, hors périmètre ici.

Formulation honnête de la cible : **fédéré là où vivent les métadonnées,
centralisé là où circule l'argent.**

## Compromis
- **Disponibilité** — un deck éteint est un index injoignable. Envisager un
  miroir optionnel de la couche descripteurs à l'intérieur du cercle (elle est
  assez légère pour être répliquée intégralement, contrairement aux stems).
- **Traversée NAT** — non applicable en portée LAN. Ne devient un problème
  qu'avec une portée internet : relais STUN/TURN ou hole-punching libp2p.
- **Juridique** — la décentralisation ne change rien à la responsabilité en
  matière de droit d'auteur. La vraie mitigation est la stratification des trois
  couches ci-dessus, pas la topologie réseau.
- **AGPL** — un pod exposé sur le réseau déclenche précisément la clause réseau
  de l'AGPL-3.0 : toute instance modifiée accessible à des tiers doit publier
  ses sources. C'est cohérent avec le projet, mais à assumer explicitement.
- **Charge sur le deck en live** — le pod ne doit jamais disputer du CPU au
  moteur temps réel. Processus séparé, sur le modèle de `link_server.js`.

## Terminologie
- **Pod** — dans le vocabulaire EBYS : le deck lui-même, exposant son index
- **Fédération** — échange de métadonnées entre decks indépendants
- **Cercle** — sous-ensemble du graphe de follow autorisé à lire un index
- **P2P** — transfert direct d'appareil à appareil (couche stems uniquement)
- **Adressage par contenu** — identification d'une piste par hash de son audio,
  en remplacement du nom de fichier

## Décisions à prendre
- **Portée** — salle (LAN) / cercle de confiance / découverte publique. Cette
  décision détermine tout le reste : transport, NAT, exposition juridique.
- **Que fédère-t-on d'abord** — index de slices seul, ou index + stems ?
  (Recommandation : index seul. Utile immédiatement, risque minimal.)
- **Quelle est l'identité fédérée** — le deck, le DJ, ou l'artiste ? LINK
  raisonne en decks, l'équation de partage raisonne en artistes. Les deux devront
  se rejoindre.
- **Transport** — réutiliser le multicast UDP de LINK, ou passer à HTTP/libp2p ?
- **Prérequis à trancher avant tout le reste** — hash de contenu pour l'identité
  des pistes, et lecteur JS pour `ebys.db`. Rien de sérieux ne se construit
  au-dessus d'une identité par nom de fichier.
