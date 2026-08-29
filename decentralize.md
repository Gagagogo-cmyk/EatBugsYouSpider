# Partage décentralisé — aperçu de l'architecture

> Note d'exploration, pas un plan de construction. Rien de ce qui suit n'est implémenté. À lire avec `docs/protocol/SPLIT_EQUATION.md` (graphe de follow), `docs/instrument/LINK.md` (transport multicast déjà en place) et `XREF.md`.

## Où en est EBYS aujourd'hui

EBYS est déjà à moitié décentralisé, par accident plutôt que par design. Côté instrument, chaque deck est un nœud autonome complet : bibliothèque locale dans `data/`, analyse locale (Demucs → madmom/Essentia → FluCoMa), index local (`ebys.db`, `ebys_index.json`), moteur de sélection local. Aucun script de `src/demucs/` ne contacte `src/backend/` ; tout circule par des fichiers.

La centralisation est ailleurs, et elle est concentrée sur trois points : le backend Express + Postgres sur Railway (journal de session, équation de partage, payouts), Stripe (l'argent, le KYC), et Icecast/Liquidsoap (le flux).

La question utile n'est donc pas « comment décentraliser EBYS » — l'instrument l'est déjà — mais **ce qui pourrait circuler entre deux decks ou entre deux communautés, et sous quelle forme**.

## Ce qui circule : trois couches, pas une

Le réflexe est de raisonner en « partage de fichiers musicaux ». Pour EBYS, c'est la mauvaise granularité : ce qui a de la valeur et ce qui présente un risque ne se trouvent pas dans la même couche.

| Couche           | Contenu                                                                                 |                  Poids | Risque juridique                             | Fédérable                  |
| ---------------- | --------------------------------------------------------------------------------------- | ---------------------: | -------------------------------------------- | -------------------------- |
| **Descripteurs** | slices, `C S E F P H T`, `M0–M5`, downbeats, genres, BPM, key — le contenu de `ebys.db` |  ~100 octets par slice | Donnée dérivée, non reconstructible en audio | Oui, largement             |
| **Stems**        | sortie Demucs, 4 pistes par morceau                                                     | Taille de la piste × 4 | Œuvre dérivée directe                        | Cercle restreint seulement |
| **Audio source** | `data/raw_uploads/`                                                                     |     Taille de la piste | Identique à un partage de fichiers classique | Non                        |

L'observation qui compte : **le coût réel n'est pas le transfert audio, c'est l'analyse**. Séparer, tagger et découper une piste prend des heures de CPU/GPU locale. Deux decks qui ingèrent la même piste refont deux fois le même calcul.

Partager la couche descripteurs a donc plus de valeur pratique que partager l'audio — et c'est justement la couche la moins problématique à distribuer.

## Métadonnées comme connaissance partageable

L'idée centrale de cette architecture est que les instances EBYS peuvent **partager sur le réseau les connaissances produites par l'analyse de leurs contenus**, sans avoir à partager les contenus audio eux-mêmes.

Chaque deck conserve localement ses fichiers audio et ses stems, mais son index peut être rendu accessible à d'autres decks ou à d'autres communautés. Une communauté pourrait ainsi partager ses analyses **de communauté en communauté**, directement sur le réseau ou par l'intermédiaire de son propre serveur, selon la topologie retenue.

On peut considérer les métadonnées comme une sorte de **moule de la musique** : une représentation de son comportement dans EBYS qui peut être transmise et réutilisée ailleurs sans transmettre l'objet sonore original.

Par exemple, une instance pourrait annoncer qu'elle possède une analyse correspondant à un certain content hash :

```text
content hash: XYZ
BPM: 132
key: F minor
slices: 428
downbeats: [...]
descriptors: [...]
```

Un autre deck qui possède déjà le même contenu audio pourrait alors récupérer cette analyse et éviter de refaire le calcul. Le fichier audio n'a pas besoin de quitter la machine qui le possède.

Cette distinction permet également de limiter la circulation de matériel protégé par le droit d'auteur. Le réseau n'est pas conçu pour distribuer les œuvres sonores, mais pour distribuer les informations produites par leur analyse. Cela ne constitue toutefois pas un contournement automatique du droit d'auteur : la nature juridique des données dérivées dépend de ce qu'elles contiennent et de la juridiction concernée. La mitigation vient principalement de la **séparation entre audio local et connaissance analytique partageable**, et non de la topologie décentralisée elle-même.

La conséquence conceptuelle est importante :

> **L'audio reste local ; la connaissance produite par son analyse peut circuler.**

EBYS ne devient donc pas nécessairement un réseau de partage de musique. Il devient plutôt un réseau dans lequel les communautés peuvent **mettre en commun leur connaissance analytique de la musique qu'elles possèdent**.

## Fédération de communautés

Le partage ne doit pas nécessairement être pensé comme un seul grand réseau public. Chaque communauté peut posséder son propre espace de fédération et décider avec qui elle partage ses métadonnées.

Une communauté pourrait par exemple avoir son propre serveur :

```text
             Communauté Montréal
                    │
             ┌──────┴──────┐
             │ serveur EBYS │
             └──────┬──────┘
                    │
          ┌─────────┼─────────┐
          │         │         │
        Deck A    Deck B    Deck C
```

Ce serveur pourrait ensuite échanger des métadonnées avec le serveur d'une autre communauté :

```text
      Communauté Montréal          Communauté Berlin
      ┌────────────────┐           ┌────────────────┐
      │ serveur EBYS A │◄─────────►│ serveur EBYS B │
      └────────────────┘ metadata  └────────────────┘
```

La communauté contrôle alors son propre niveau d'ouverture :

* **Public** — les métadonnées peuvent être découvertes par n'importe quelle communauté ou instance.
* **Communautaire** — seules les instances membres peuvent accéder à l'index.
* **Cercle de confiance** — les métadonnées sont partagées avec certaines communautés ou personnes suivies.
* **Local** — aucune fédération ; l'index reste uniquement sur le deck.

Un serveur communautaire n'est donc pas nécessairement un endroit où la musique est stockée. Il peut simplement être un **nœud de coordination et de partage de métadonnées**.

Le serveur d'une communauté pourrait être auto-hébergé par un collectif, une radio, un lieu ou une autre organisation. Il pourrait également être public ou privé selon les choix de cette communauté.

## Technologies connexes

* **BitTorrent / WebTorrent** — fichiers découpés en morceaux hachés, pairs découverts par tracker ou DHT. Décentralise le transfert, pas la persistance : la disponibilité dépend des seeders. Pertinent seulement pour la couche stems si celle-ci devient partageable.
* **libp2p** — pile P2P générique (découverte, hole-punching NAT, transport). Plus lourd que ce que demande une portée LAN, plus adapté si la portée devient publique.
* **ActivityPub** — fédération de métadonnées entre serveurs indépendants. Le modèle de fédération est pertinent ; le protocole lui-même est probablement surdimensionné pour un échange d'index de slices entre quelques communautés.
* **Stockage sur blockchain** (Filecoin, Arweave) — résout la persistance par incitation économique, au prix d'une couche de jetons. **Non pertinent ici**, et pas seulement pour des raisons techniques : `docs/protocol/TIPPING_PROTOCOL.md` pose comme principe que les auditeurs paient en dollars, « no crypto required, ever », et `docs/protocol/TOKEN.md` range explicitement CRKT dans le spéculatif. Une couche de stockage à jetons contredirait le protocole actif.

## Architecture proposée : fédération de métadonnées + P2P optionnel

Le point clé : **presque toutes les primitives nécessaires existent déjà sous un autre nom**. L'exercice consiste à les rebrancher, pas à en inventer.

### 1. Le pod, c'est le deck

Pas besoin d'un nouveau serveur pour commencer : `ws_server.js` tient déjà l'index en mémoire et écoute sur `:8080`. Ce qui manque est une surface de lecture (authentifiée) sur cet index, pas nécessairement un processus de plus.

Prérequis technique connu — voir `notes.md`, §1 « To fix » point 2 : `ebys.db` n'a aujourd'hui aucun lecteur JS, seul `import_library.py` y écrit.

Toute fédération passe par là d'abord.

À terme, le deck peut donc agir comme le **pod local** de ses propres données. Un serveur communautaire devient une couche supplémentaire de fédération lorsqu'une communauté veut regrouper ou relayer les index de plusieurs decks.

### 2. Le graphe de fédération, c'est le graphe de follow

`docs/protocol/SPLIT_EQUATION.md` définit déjà *following* comme « je reconnais l'influence et j'accepte la participation au partage ».

La même arête peut porter « j'accepte de partager mon index ». Ne pas construire un second graphe social à côté du premier : le graphe de partage et le graphe de rémunération doivent être le même objet, sinon on peut jouer les slices de quelqu'un sans qu'il soit dans le split.

Cela permettrait aussi de représenter naturellement les relations entre communautés : une communauté pourrait choisir de fédérer son index avec certaines communautés qu'elle suit ou auxquelles elle accorde sa confiance.

### 3. LINK est le précurseur, et il est déjà écrit

`src/tui/link_server.js` fait déjà de la découverte multicast UDP entre decks sur un LAN, en processus séparé.

La première étape réaliste est donc une fédération **à portée de salle** : deux decks dans la même pièce découvrent leur présence et peuvent éventuellement échanger leurs index, sans NAT, sans relais, sans DHT, et avec la possibilité de tester le système en conditions live.

La portée internet est une extension ultérieure, pas le point de départ.

### 4. L'adressage par contenu est le vrai prérequis manquant

Aujourd'hui l'identité d'une piste est son nom de fichier : `tracks.name TEXT UNIQUE` dans `ebys.db`, et côté backend `src/backend/db/queries.js:57` le dit explicitement — « EBYS identifies tracks by filename — we use that as the fingerprint ».

Or `TIPPING_PROTOCOL.md` fait reposer l'escrow des artistes non réclamés sur cette « audio fingerprint ».

Deux decks qui ont la même piste sous deux noms différents ne peuvent donc ni dédupliquer correctement, ni s'accorder de manière fiable sur l'identité du contenu ou sur les paiements associés.

Un hash du contenu audio décodé (ou une empreinte perceptuelle, si on veut résister au ré-encodage) règle trois problèmes d'un coup :

* déduplication entre decks ;
* identité de piste stable pour le split ;
* clé de cache pour réutiliser une analyse déjà faite ailleurs.

**C'est le premier chantier, et il a de la valeur même si la fédération ne se fait jamais.**

### 5. Le transfert P2P vient en dernier

Une fois qu'un pair est identifié via la fédération et qu'un contenu est adressé par hash, un transfert direct devient possible.

WebTorrent ou libp2p pourraient alors être utilisés pour transférer des stems dans un cercle autorisé.

Mais cette couche est **optionnelle et distincte de la fédération des métadonnées**.

Le système n'a pas besoin de transférer l'audio pour bénéficier du partage d'analyse.

Le P2P est donc un moyen possible de faire circuler certaines données, tandis que la fédération décrit l'organisation du partage entre communautés indépendantes.

## Ce qui reste centralisé — et pourquoi c'est acceptable

* **Stripe** — l'argent et le KYC ne se décentralisent pas, et le protocole assume ce choix.
* **Le backend** — journal de session, équation de partage, payouts. La bonne réponse n'est pas nécessairement le P2P mais l'**auto-hébergement** : une instance par collectif ou par radio, fédérée avec les autres. Le projet est sous AGPL-3.0, ce qui rend l'auto-hébergement d'une version modifiée cohérent avec la licence.
* **Icecast / Liquidsoap** — la diffusion est du un-vers-plusieurs. Le streaming P2P (WebRTC) est un autre problème, hors périmètre ici.

La cible peut donc être formulée ainsi :

> **Fédéré là où vivent les métadonnées, local là où vivent les fichiers audio, centralisé là où circule l'argent.**

## Compromis

* **Disponibilité** — un deck éteint est un index injoignable. Envisager un miroir optionnel de la couche descripteurs à l'intérieur du cercle : elle est assez légère pour être répliquée intégralement, contrairement aux stems.
* **Traversée NAT** — non applicable en portée LAN. Ne devient un problème qu'avec une portée internet : relais STUN/TURN ou hole-punching libp2p.
* **Juridique** — la décentralisation ne change rien à la responsabilité en matière de droit d'auteur. La vraie mitigation est la stratification des trois couches ci-dessus, pas la topologie réseau.
* **AGPL** — un pod exposé sur le réseau déclenche précisément la clause réseau de l'AGPL-3.0 : toute instance modifiée accessible à des tiers doit publier ses sources. C'est cohérent avec le projet, mais à assumer explicitement.
* **Charge sur le deck en live** — le pod ne doit jamais disputer du CPU au moteur temps réel. Processus séparé, sur le modèle de `link_server.js`.
* **Disponibilité des communautés** — une communauté qui héberge son propre serveur doit décider si elle accepte d'être un point de fédération permanent ou si son index n'est disponible que lorsque son infrastructure est en ligne.

## Terminologie

* **Pod** — dans le vocabulaire EBYS : le deck lui-même, exposant son index.
* **Fédération** — échange de métadonnées entre decks ou serveurs indépendants.
* **Communauté** — groupe d'instances EBYS partageant une infrastructure, un graphe de confiance ou des règles communes.
* **Serveur communautaire** — nœud optionnel permettant à une communauté de regrouper, exposer ou fédérer ses métadonnées.
* **Cercle** — sous-ensemble du graphe de follow autorisé à lire un index.
* **P2P** — communication ou transfert direct entre appareils ou nœuds, notamment pour une éventuelle couche stems.
* **Adressage par contenu** — identification d'une piste par hash ou empreinte de son contenu audio, en remplacement du nom de fichier.
* **Moule** — métaphore pour désigner l'ensemble des données analytiques produites à partir d'un contenu audio et pouvant circuler indépendamment de celui-ci.

## Décisions à prendre

* **Portée** — salle (LAN) / cercle de confiance / découverte publique. Cette décision détermine tout le reste : transport, NAT, exposition juridique.
* **Structure des communautés** — deck seul, serveur communautaire optionnel, ou serveur obligatoire pour chaque communauté ?
* **Ouverture** — chaque communauté peut-elle choisir librement entre serveur public, privé ou réservé à certains cercles ?
* **Que fédère-t-on d'abord** — index de slices seul, ou index + stems ? (Recommandation : index seul. Utile immédiatement, risque minimal.)
* **Quelle est l'identité fédérée** — le deck, le DJ, l'artiste ou la communauté ? LINK raisonne en decks, l'équation de partage raisonne en artistes. Les deux devront se rejoindre.
* **Transport** — réutiliser le multicast UDP de LINK pour le LAN, puis HTTP/libp2p pour une portée plus large ?
* **Prérequis à trancher avant tout le reste** — hash de contenu pour l'identité des pistes, et lecteur JS pour `ebys.db`. Rien de sérieux ne se construit au-dessus d'une identité par nom de fichier.
* **Persistance** — les index doivent-ils être répliqués automatiquement entre membres d'un cercle, ou rester disponibles uniquement depuis les decks/serveurs qui les produisent ?

