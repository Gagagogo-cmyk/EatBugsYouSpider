
# Exploration et recherche — Arts numériques (Art audio)

## Alexandre Gagné — Programme général

# Sommaire

**Titre**                                   
Eat Bugs You Spiders!  
                                                                                                                                                                                                                            
**Résumé**                                  
Création d’une plateforme musicale open source combinant un outil d’exploration et de création musicale enrichi par le machine learning et une infrastructure communautaire pour relier, partager et documenter les différentes scènes numériques. 

**Montant demandé**                         
15 765 $ 
                                                                                                                                                                                                                                         
**Date**                                    
2026-09-29 au 2027-03-31                                                                                                                                                                                                                          

**Lieu de réalisation**                     
Montréal                                                                                                                                                                                                                                          

**Mode d’évaluation**                       

**Utilisation des technologies numériques** 
Oui  
                                                                                                                                                                                                                                             
**Jeune public**                            
Non                                                                                                                                                                                                                                                

### Utilisation des technologies numériques

**Oui, en excluant les outils bureautiques.**

### Jeune public

Le projet :

* vise le jeune public de 0 à 4 ans : **Non**
* vise le jeune public de 4 à 11 ans : **Non**
* vise le jeune public de 12 à 17 ans : **Non**

---

# Projet

## Décrivez votre projet

Le projet consiste à développer **Eat Bugs You Spiders! (EBYS)**, un instrument de remixing audio open source combinant audio analysis, machine learning et contrôle par langage naturel, ainsi qu'une plateforme web destinée à documenter les communautés de musique électronique et de culture rave.

Inspiré du lecteur musical Winamp, EBYS transforme la bibliothèque musicale en un espace d'exploration : le logiciel en analyse le contenu, en apprend les relations musicales et permet de générer de nouvelles combinaisons à partir des goûts de ses utilisateurs.

Le projet est pensé comme une infrastructure communautaire. EBYS privilégie une architecture où les bibliothèques audio des utilisateurs restent sur leurs propres ordinateurs, tandis que les modèles, classifications et autres contributions peuvent être partagés entre les membres d'une communauté.

En parallèle, une plateforme web et un web crawler intelligent permettent de documenter les événements et les relations entre communautés.

## EBYS

L'instrument fonctionne à partir d'une bibliothèque de tracks.

Chaque track est soumise à **DEMUCS**, un modèle de stem separation qui la divise en quatre stems :

* drums
* bass
* melody
* vocals

Les stems sont ensuite analysées avec différents outils.

**FluCoMa** fournit la descriptor analysis, notamment :

* spectral centroid
* loudness
* spectral flatness
* pitch
* timbre

**Essentia** fournit une première analyse de genre et **madmom** analyse :

* le tempo
* la métrique
* les downbeats

Les stems sont ensuite découpées en slices portant leurs propres descriptors.

Une bass provenant d'une track peut ainsi être associée aux drums d'une autre, à la melody d'une troisième et aux vocals d'une quatrième. Les stems deviennent une matière première permettant de construire de nouvelles combinaisons.

### Les quatre catégories de stems

DEMUCS suppose qu'une pièce peut être décrite à travers quatre catégories. Cette limite est intéressante pour les musiques électroniques, expérimentales ou abstraites, où les fonctions musicales sont parfois moins définies.

Les quatre stems peuvent néanmoins être considérées comme des familles fonctionnelles :

* **drums** : domaine principalement rythmique et atonal
* **bass** : domaine principalement tonal
* **melody** : domaine principalement tonal
* **vocals** : domaine principalement tonal

### Analyse automatique et connaissance humaine

Les analyses automatiques ne sont pas considérées comme des autorités.

Essentia fournit une classification de départ, mais les utilisateurs peuvent définir leurs propres genres et catégories. De même, un artiste qui connaît déjà le tempo de sa track peut le fournir directement.

Le système combine donc **analyse automatique et connaissance humaine**.

---

## Le modèle de goût

Le machine learning intervient lorsque l'utilisateur — une personne ou une communauté — entraîne son propre modèle à partir de **« bakes »**.

Chaque bake associe une combinaison de stems à un prompt.

Exemple :

> « rise »

Les descriptors des stems « baked » seront comparés afin que le modèle apprenne les caractéristiques correspondant aux choix effectués.

Après plusieurs bakes, le modèle peut inférer de nouvelles combinaisons.

Il devient une représentation du vocabulaire musical et des goûts de la personne ou du groupe qui l'a entraîné.

L'utilisateur peut ensuite communiquer avec EBYS en langage naturel :

> « rise moustique sur 4 bars, drop bourdon sur 8 bars »

Le LLM agit comme une couche d'interprétation entre cette intention et le système musical. Il identifie les modèles et paramètres correspondants et permet à EBYS d'exécuter la séquence.

Le résultat dépend directement du training : le modèle généralise les relations apprises à de nouvelles combinaisons.

Le training devient ainsi une pratique musicale.

L'utilisateur ne reçoit pas un modèle censé savoir ce qui est « bon » : il construit progressivement un instrument qui apprend ce que certains mots et certaines intentions signifient pour lui ou pour sa communauté.

---

## Une taxonomie musicale vivante

La plateforme permettra aux utilisateurs de classifier leur musique selon leurs propres catégories.

Une communauté peut :

* développer son vocabulaire ;
* créer de nouveaux genres ou sous-genres ;
* modifier les relations entre ceux-ci.

À mesure que les utilisateurs contribuent, ces classifications pourront former un **arbre taxonomique vivant**.

L'objectif n'est pas de produire une classification définitive de la musique, mais d'observer l'évolution des genres, leurs croisements et leur hybridation.

Cette taxonomie pourra elle-même devenir une archive de la culture musicale qui l'a produite.

Le projet s'inspire également du travail de *Every Noise at Once*, en explorant une cartographie des genres et des communautés musicales, mais sans être dépendant de Spotify ou autre plateforme propriétaire.

---

## Pourquoi la musique électronique et la culture rave ?

Le projet se concentre volontairement sur la musique électronique et la culture rave.

Ce choix est lié aux pratiques propres à ces scènes : remix, sampling, réutilisation et transformation de matériaux existants y occupent depuis longtemps une place importante.

Un instrument qui déconstruit les tracks et les recombine s'inscrit donc directement dans ces pratiques.

Le projet est également adapté à une culture numérique. Son fonctionnement repose sur :

* des bibliothèques numériques ;
* la stem separation ;
* l'analyse de descripteurs ;
* le machine learning ;
* les interfaces logicielles ;
* le web.

Ce n'est qu'une question de vibe.

Rien n'empêcherait cependant d'y intégrer des styles acoustiques ou d'autres traditions musicales.

---

## Une radio autonome

Une évolution possible est d'intégrer une **radio autonome** à la plateforme web.

Celle-ci utiliserait les modèles et classifications développés par les utilisateurs afin de générer en continu un flux musical sans intervention constante d'un DJ.

Elle pourrait servir à la fois :

* de démonstration publique ;
* de lieu d'expérimentation pour les différents modèles de goût.

Une question reste cependant à résoudre :

> **D'où provient le corpus musical de cette radio ?**

Le projet privilégie une architecture où les bibliothèques audio restent localement sur les ordinateurs des utilisateurs plutôt que d'être centralisées sur un serveur.

La radio devra donc constituer un corpus public sans reproduire une plateforme centralisée de stockage musical.

---

## Le web crawler intelligent

Le web crawler d'EBYS est pensé comme une infrastructure sans frontière, mais développé et expérimenté localement à Montréal.

Il permet de recenser les spectacles d'une communauté en ajoutant simplement l'URL générale d'une venue.

**Colly** et **Ollama** effectuent une *discovery run* afin d'identifier où les shows sont recensés dans le site, puis le système conserve ce chemin afin d'accélérer les collectes suivantes.

Si la structure du site change, une nouvelle *discovery run* permet de la redécouvrir.

Ollama agit comme une couche de décision entre le crawler et les pages web. Il aide à déterminer :

* quelle page visiter ;
* où se trouvent les informations pertinentes ;
* quand les données nécessaires ont été trouvées.

Le crawler reste responsable de la navigation et de la collecte.

### Un réseau de communautés autonomes

Le projet n'a toutefois pas pour objectif de rassembler toutes les scènes musicales du monde dans une même base de données.

Une carte des villes fonctionnerait plutôt comme un **réseau de communautés autonomes**.

EBYS représenterait ici Montréal, ou peut-être le Québec. Une communauté à Tokyo pourrait créer sa propre instance, avec :

* ses propres données ;
* ses propres skins ;
* ses propres catégories.

La carte pourrait simplement rediriger vers cette autre plateforme.

Le code est open source : chaque communauté peut reprendre EBYS, modifier certaines parties, n'utiliser que certains outils ou simplement en « scavenge for parts ».

**DIY.**

Une instance pourrait conserver le crawler mais abandonner l'instrument de remixing; une autre pourrait utiliser uniquement la taxonomie.

Les instances peuvent ainsi évoluer indépendamment tout en partageant une infrastructure commune.

L'enjeu est de créer un système **sans frontière mais non centralisé** : une constellation de plateformes locales plutôt qu'une plateforme mondiale unique.

La diversité des scènes reste ainsi dans leur autonomie, leur esthétique et leur manière de documenter leur propre culture musicale.

---

## Open source et communauté

Le projet sera distribué en open source.

EBYS pourra être utilisé, modifié et adapté par différentes communautés.

Son fonctionnement, ses outils d'analyse, son système de training et sa structure de données seront documentés afin que d'autres personnes puissent comprendre le système et participer à son évolution.

La première implantation prendra comme terrain d'expérimentation la musique électronique et la culture rave montréalaise.

Le web crawler permettra de documenter les événements de cette scène, tandis qu'EBYS pourra être utilisé localement par les artistes, DJs et communautés qui souhaitent expérimenter avec leurs bibliothèques et leurs modèles de goût.

Le projet n'impose donc ni modèle musical ni taxonomie prédéfinie.

Il fournit une infrastructure à partir de laquelle une communauté peut développer :

* ses propres catégories ;
* son propre vocabulaire ;
* ses propres modèles de goût.

À terme, les contributions pourront former une **carte taxonomique de la musique électronique** : une structure évolutive permettant d'observer comment les genres apparaissent, se transforment et s'hybrident.

Cette carte ne chercherait pas à définir ce que sont les genres, mais à documenter la manière dont les communautés les définissent elles-mêmes.

Le projet réunit ainsi deux fonctions :

1. **un instrument de remixing local**, entraîné par ses utilisateurs ;
2. **une plateforme communautaire**, où les scènes peuvent définir leur propre taxonomie de genres, documenter leurs événements, découvrir des shows et développer leurs réseaux.

Le code open source permet à d'autres villes et communautés de créer leur propre instance, de l'adapter à leur scène musicale locale et de la connecter à l'instance de Montréal.

---

# Retombées attendues

## Présentez les retombées attendues de la réalisation du projet sur l'évolution de votre oeuvre ou de votre carrière.

Ce projet est né d'un problème personnel : je crée beaucoup de musique, mais je ne finis presque rien.

Quatre bars, parfois plus, parfois moins. Des fragments qui s'accumulent sans jamais trouver leur forme finale.

Ce n'est pas par manque d'intérêt : j'aime rechercher et explorer.

Ce qui m'intéresse aujourd'hui, c'est de trouver une manière de les allonger en les remixant avec autre chose, d'explorer les différentes alternatives que j'aurais pu choisir.

EBYS est d'abord une réponse à ça — un outil d'exploration qui me permet de comprendre ma propre musique, de la transformer et d'en découvrir les possibilités.

Mais en développant l'outil, une évidence s'est imposée : tant qu'à le faire pour moi, pourquoi ne pas le faire pour tout le monde?

L'idée de recomposer et d'hybrider mes propres fragments, issus de différents genres et directions musicales, s'est progressivement extrapolée à une autre échelle : rassembler différentes scènes et sous-cultures musicales dans un même espace numérique afin d'observer et de documenter leurs croisements et leur hybridation au fil du temps.

Le site devient ainsi à la fois un espace de rencontre et un outil permettant de conserver une trace de ces transformations.

EBYS devient ainsi une façon de créer les conditions dans lesquelles ma pratique, et celle de mon groupe d'amis open source, peuvent exister.

Ce projet me force à habiter l'intersection entre :

* composition musicale ;
* ingénierie sonore ;
* architecture logicielle ;
* taxonomie.

La retombée la plus directe sur ma carrière est de développer un instrument que j'utiliserai moi-même pour performer et me connecter à une scène musicale : non seulement en y produisant de la musique, mais en contribuant au code source de l'écosystème.

---

# Rémunération

## Expliquez comment vous avez établi votre rémunération et celle des artistes impliqués dans votre projet.

Le projet est initié et développé par moi, avec l’objectif de construire une infrastructure open source pouvant être investie par les communautés de musique électronique et de culture rave.

J’en assure :

* la conception ;
* la composition ;
* l’ingénierie sonore ;
* la conception du système ;
* le développement général.

C’est actuellement moi qui prends le temps de réaliser ces différentes tâches, jusqu’à ce que d’autres personnes se joignent au projet.

Un ami développeur m’a fourni le code initial du scraper, que j’ai ensuite modifié, notamment en y intégrant Ollama comme moteur de décision.

Le projet étant ouvert, il est libre de contribuer de la manière qui lui convient. Son implication future reste à définir et pourra être rémunérée si elle devient récurrente.

L’objectif est de cultiver des communautés plutôt que de faire du code sa principale source de valeur économique.

Je souhaite néanmoins être rémunéré par le financement public pour le temps consacré à initier, développer et guider le projet.

Les autres contributions au code resteront volontaires et non rémunérées dans le cadre de cette demande.

Les communautés pourront utiliser l’infrastructure pour développer leur scène et organiser leurs activités.

Ma rémunération est établie à **30 $/h**, selon une estimation du temps consacré au projet sur six mois.

---

# Participants

| Participant                             | Documents                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Alexandre Gagné** — Artiste demandeur | [Curriculum vitae](https://www.pes.gouv.qc.ca/) · [Dossier de presse](https://www.pes.gouv.qc.ca/) |

---

# Échéancier

| Période                      | Étape                                                  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Lieu             |
| ---------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **2026-09-29 au 2026-10-13** | **Migration Max/MSP → Pure Data**                      | Migration de l'environnement de développement d'un modèle propriétaire par abonnement (Max/MSP) vers Pure Data, solution open source. Restructuration du pipeline audio pour assurer la compatibilité avec le flux de webradio continu. Mise au point, débogage et stabilisation du modèle et de son architecture de base.                                                                                                                                  | Montréal, Québec |
| **2026-09-29 au 2027-01-01** | **Raffinage des systèmes de training et de remixage**  | Développement et expérimentation des outils de training et de remixage. Observation et ajustement des comportements, calibration des données, descripteurs audio et slices. Développement des interfaces de training et de performance et implémentation des skins visuels. Exploration de la relation entre les deux modèles afin de déterminer s’ils peuvent fonctionner ensemble ou nécessitent des systèmes distincts. Documentation de l’architecture. | Montréal, Québec |
| **2026-09-29 au 2027-01-01** | **Raffinage de l’infrastructure web et communautaire** | Raffinage du crawler pour assurer la collecte fiable des informations sur les spectacles et amélioration du filtrage de la base de données. Développement des fonctions communautaires : chat, amis et comptes, arbre phylogénétique des genres créés. Exploration d’une radio autonome intégrée au site. Développement d’un éditeur ou protocole d’importation de skins. Raffinage, tests, débogage et stabilisation de la plateforme.                     | Montréal, Québec |
| **2027-01-01 au 2027-03-31** | **Lancement progressif et diffusion**                  | Déploiement par étapes et débogage en conditions réelles. La documentation technique étant intégrée directement dans EBYS via un modèle Ollama loadé dans le chat/console, le lancement est lui-même la diffusion du manuel. Documentation en continu du code sur GitHub.                                                                                                                                                                                   | Montréal, Québec |

---

# Budget

## Revenus

### Fonds publics

| Source                                                      |      Montant |
| ----------------------------------------------------------- | -----------: |
| Conseil des arts et des lettres du Québec — Montant demandé | **15 765 $** |

### Autres

| Source                   | Statut   |     Montant |
| ------------------------ | -------- | ----------: |
| Contribution personnelle | Confirmé | **5 255 $** |

### Total des revenus

**21 020 $**

---

## Dépenses

### Frais de création

| Dépense                                                                    |      Montant |
| -------------------------------------------------------------------------- | -----------: |
| Rémunération du candidat — Développement de EBYS — 672 h × 30 $/h (6 mois) | **20 160 $** |

### Frais de réalisation

| Dépense                                               |   Montant |
| ----------------------------------------------------- | --------: |
| Adobe 480 $ + Claude 120 $ + VPS 240 $ + domaine 20 $ | **860 $** |

### Total des dépenses

**21 020 $**

---

# Documents requis

## Contrat, confirmation ou intention

Aucun.

## Site Web

Aucun.

---

# Matériel d'appui

## Eat Bugs You Spiders! — 2026

**Concepteur**

Site web de diffusion de Eat Bugs You Spiders! Utilisé en ce moment comme dossier de presse.

Markdown files conceptuels, schémas et présentation du prototype. Vue overall du système.

**Site :** https://eatbugsyouspiders.org

## Portfolio du demandeur — 2026

**Concepteur**

* Posters de shows animés.
* Projets UI/UX et motion réalisés dans le passé.
* Sketches musicaux pour un futur album.

**Site :** https://gagnealexandre.com

## Répertoire de code source — EBYS — 2026

**Concepteur**

Code source du projet.

**GitHub :** https://github.com/Gagagogo-cmyk/EatBugsYouSpider

---

# Transmission

## Consentement

Advenant l'obtention d'une bourse pour la réalisation d'un projet, je soussigné(e) consens à ce que le CALQ transmette à la Société de télédiffusion du Québec (Télé-Québec) les renseignements nominatifs suivants : mon nom, mon adresse civique, mon numéro de téléphone, mon adresse courriel, le titre et la description de mon projet et la date prévue de sa réalisation.

Ces renseignements seront fournis à Télé-Québec dans le but de favoriser une meilleure promotion, à la télévision ou sur le web, des activités artistiques et littéraires soutenues par le CALQ dans toutes les régions du Québec.

Ainsi, je consens également à ce qu'un(e) représentant(e) de Télé-Québec communique directement avec moi en vue de promouvoir mon projet dans la mesure où celui-ci est sélectionné par le télédiffuseur.

**Réponse : Oui**

---

## Aide aux personnes handicapées pour la présentation d'une demande de bourse

> Cette section sera retirée du dossier lors du processus d'évaluation par les pairs et sera évaluée à l'interne.

Je consens à ce que le CALQ recueille le renseignement personnel de la présente section. En effet, conformément à son Plan d'action à l'égard des personnes handicapées, le CALQ offre un soutien financier pour faciliter l’étape de production d'une demande de bourse.

Cette aide peut couvrir en tout ou en partie les dépenses engagées par une personne handicapée pour l’obtention de services facilitant la présentation d’une demande.

Les services nécessaires à la préparation et à la rédaction de la demande ainsi que les services requis pour la production du rapport d’utilisation d’une bourse sont admissibles.

Ce renseignement personnel ne sera jamais communiqué et ne sera qu’évalué à l’interne par le CALQ.

L’aide financière est accordée automatiquement si la demande principale est reconnue admissible.

**Je désire obtenir une aide pour la présentation de cette demande.**

**Réponse : Non**

---

## Supplément pour personne handicapée — Réalisation du projet

> Cette section sera retirée du dossier lors du processus d'évaluation par les pairs et sera évaluée à l'interne.

Je consens à ce que le CALQ recueille le renseignement personnel de la présente section.

En effet, cette aide supplémentaire vise à couvrir une partie des dépenses du projet liées à des besoins spécifiques selon le handicap. Elle est accordée dans le cadre d'un projet financé par le CALQ.

Advenant l'obtention de cette aide, les factures justificatives devront être soumises au moment de la production du rapport d'utilisation de la bourse.

Ce renseignement personnel ne sera jamais communiqué et ne sera qu’évalué à l’interne par le CALQ.

**Je désire obtenir un montant supplémentaire pour assurer l'accessibilité d'une ou plusieurs personnes handicapées liées au projet.**

**Réponse : Non**

---

# Engagement

Conformément aux conditions générales d'admissibilité du programme, je déclare :

* Être un citoyen canadien ou un résident permanent au sens de l'article 2 (1) de la Loi sur l'immigration et la protection des réfugiés.
* Avoir résidé habituellement au Québec au cours des 12 derniers mois.

Je consens à ce que le CALQ communique aux appréciatrices ou aux appréciateurs et aux membres des jurys mes renseignements personnels, tels qu'ils sont définis par la Loi sur l'accès aux documents des organismes publics et sur la protection des renseignements personnels, dans la mesure où ces renseignements sont nécessaires à l'exercice de leurs fonctions.

J'autorise le CALQ à faire les vérifications nécessaires auprès des autres subventionneurs ainsi qu’à leur communiquer tout renseignement utile contenu dans ma demande de bourse ou les documents qui y sont joints, incluant mes renseignements personnels, et ce pour s’assurer que les sommes accordées dans le cadre de cette demande ne couvrent aucune dépense reliée à un projet déjà soutenu dans le cadre d'un programme d'un autre organisme, quel qu'il soit.

De plus, lorsque nécessaire, j’autorise le CALQ à communiquer, partiellement ou dans leur entièreté, ma demande de bourse et les documents qui y sont joints, incluant mes renseignements personnels, à ses partenaires qui contribuent financièrement aux subventions offertes dans le cadre du programme dans lequel s’inscrit ma demande.

J'accepte les règles telles que stipulées dans le [programme](https://www.calq.gouv.qc.ca/aide-financiere/pes/?prog=SARTRECH&disc=NUME&lang=fr) et je conviens de respecter la décision du CALQ qui est finale et sans appel.

Advenant l’obtention de la bourse, je m’engage à réaliser le projet prévu et à respecter les modalités reliées à l’attribution d’une bourse.

De plus, je m’engage à fournir un rapport détaillé d’utilisation de la bourse dans les trois mois suivant la réalisation du projet.

Je certifie, en toute bonne foi, que les renseignements fournis sont exacts et que je n'ai omis aucun fait essentiel.

**Réponse : Oui**
