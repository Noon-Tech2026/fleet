# Documentation technique — Système de gestion de flotte

Version du 16 août 2026 · Phase : développement, avant pilote terrain

---

## Table des matières

1. [Contexte et objectifs](#1-contexte-et-objectifs)
2. [Le véhicule et son équipement](#2-le-véhicule-et-son-équipement)
3. [Architecture générale](#3-architecture-générale)
4. [La règle de sécurité](#4-la-règle-de-sécurité)
5. [Le backend, module par module](#5-le-backend-module-par-module)
6. [Modèle de données](#6-modèle-de-données)
7. [Authentification et autorisations](#7-authentification-et-autorisations)
8. [Le temps réel](#8-le-temps-réel)
9. [Le frontend](#9-le-frontend)
10. [Référence de l'API](#10-référence-de-lapi)
11. [Installation et exploitation](#11-installation-et-exploitation)
12. [Du simulateur au matériel réel](#12-du-simulateur-au-matériel-réel)
13. [Limites connues et feuille de route](#13-limites-connues-et-feuille-de-route)

---

## 1. Contexte et objectifs

### Le besoin

Une entreprise de transport exploite des tracteurs SHACMAN F3000 et veut suivre
sa flotte sans dépendre d'un prestataire. Les solutions du marché imposent un
abonnement mensuel par véhicule, hébergent les données chez le fabricant, et
cessent de fonctionner le jour où l'on arrête de payer.

Huit fonctions ont été demandées :

1. Position en temps réel et historique des trajets
2. Niveau de carburant par réservoir, avec détection de vol
3. Distance parcourue et odomètre
4. Zones interdites avec alerte à l'entrée
5. Confirmation de départ par bouton physique du chauffeur
6. Contrôle du démarrage à distance
7. Écran superviseur pour enregistrer chargement et destination
8. État moteur en marche / arrêt

### Le principe directeur

**Propriété totale.** Les boîtiers envoient leurs trames directement au serveur
de l'entreprise, en protocole Teltonika Codec 8. Aucune donnée ne transite par
le fabricant. Le serveur, la base et le code appartiennent au client. Les seuls
coûts récurrents sont les cartes SIM et le VPS.

Ce principe explique plusieurs décisions techniques qui suivent : le choix de
Traccar (open source) plutôt qu'une plateforme SaaS, le fond cartographique
optionnel plutôt qu'un service de tuiles payant, et l'absence de toute
dépendance à une API externe dans le chemin critique.

---

## 2. Le véhicule et son équipement

### Le tracteur

| | |
|---|---|
| Modèle | SHACMAN F3000 430HP, tracteur 6×4 |
| Moteur | Weichai WP12, 430E 201, **EuroII**, 420 ch |
| Électricité | **24 V**, batterie 165 Ah |
| Réservoirs | **700 L + 300 L**, aluminium, séparés |
| Remorque | Container flatbed, 3 essieux, sans tracking propre |

La norme EuroII a une conséquence directe : le bus CAN de ce moteur n'expose
probablement pas le niveau de carburant. C'est pourquoi le système repose sur
des sondes analogiques externes plutôt que sur une lecture CAN. À vérifier
malgré tout à l'installation — un test CAN coûte une heure et économiserait
deux sondes par camion.

### Le matériel embarqué

| Composant | Rôle | Entrée / sortie du boîtier |
|---|---|---|
| Teltonika FMC650 | Tracking, lecture, contrôle | — |
| SIM 4G (une seule) | Connexion ; la tablette partage via le hotspot WiFi du boîtier | — |
| Relais 24 V SPDT (EHDIS JD2912-1Z, 40 A) | Coupure du circuit démarreur | **DOUT1** |
| 2× sondes capacitives tubulaires, sortie 0–5 V | Niveau de chaque réservoir | **AIN1**, **AIN2** |
| Bouton poussoir momentané, métal étanche 24 V | Confirmation de départ | **DIN2** |
| Fil d'allumage | État moteur | **DIN1** |

Tout est alimenté par la batterie du camion, via convertisseur DC-DC 24→5 V
pour la tablette éventuelle. Le mode Deep Sleep du boîtier est indispensable :
un camion à l'arrêt une semaine ne doit pas revenir avec une batterie vide.

### Pourquoi un bouton plutôt qu'un écran

Un écran tactile dans une cabine de camion, c'est un objet à casser, à voler, à
recharger, et une interface à former. Le besoin réel se résume à un bit
d'information : *le chauffeur a-t-il pris le départ volontairement ?* Un bouton
poussoir métal étanche répond à la question pour quelques euros, sans
maintenance, et fonctionne avec des gants.

---

## 3. Architecture générale

```
┌─────────────┐   4G    ┌──────────┐  WebSocket  ┌────────────┐   SSE   ┌───────────┐
│  FMC650     │────────>│ Traccar  │────────────>│ API NestJS │────────>│ Dashboard │
│  (camion)   │ Codec 8 │          │             │            │         │  React    │
└─────────────┘         └──────────┘<────────────└────────────┘<────────└───────────┘
       ^                              commandes         │          HTTP
       │                                GPRS            v
       └──────────────── setdigout ──────────      ┌──────────┐
                                                   │  MySQL   │
                                                   └──────────┘
```

### Responsabilité de chaque couche

**Traccar** décode le protocole Teltonika, stocke les positions brutes et relaie
les commandes GPRS vers les boîtiers. Il fait très bien ce travail et il est
inutile de le réécrire. En revanche il ignore tout du métier : il ne sait pas ce
qu'est une « sortie de station sans confirmation du chauffeur ».

**L'API NestJS** porte toute la logique métier : conversion des tensions en
litres, évaluation des zones, règles d'alerte, contrôle du démarreur,
authentification, audit. C'est le seul composant qui décide.

**MySQL** porte ce qui doit survivre à un redémarrage : comptes, sessions,
répertoire des véhicules, zones, courbes de calibration, fiches de départ,
historique des positions, journal d'audit.

**Le dashboard React** affiche et commande. Il ne contient aucune règle de
sécurité — il reflète les décisions du serveur.

### Deux invariants qui structurent tout

**Le navigateur ne parle jamais directement à Traccar.** Toute requête passe par
l'API. C'est ce qui permet d'imposer l'authentification, les rôles et la règle
de sécurité en un seul endroit.

**L'API maintient une connexion unique vers Traccar.** Le WebSocket de Traccar
est lié à une session utilisateur et supporte mal les connexions multiples. Une
seule est ouverte ; les événements sont traités une fois, puis rediffusés à tous
les navigateurs. Sans cela, dix onglets ouverts déclencheraient dix fois chaque
règle d'alerte.

---

## 4. La règle de sécurité

> Le système ne coupe **jamais** un moteur en marche.

Couper l'alimentation d'un moteur pendant que le camion roule supprime la
direction assistée et l'assistance de freinage d'un ensemble de 40 tonnes. Sur
une descente ou en virage, c'est un accident mortel.

La seule action autorisée est le blocage du **démarreur** : empêcher le
redémarrage après un arrêt naturel du véhicule.

### Comment c'est implémenté

`ImmobilizerService.isSafeToBlock()` vérifie `speed <= 3 && !ignition`. Le seuil
de 3 km/h absorbe le bruit GPS d'un véhicule immobile.

Une demande émise dans d'autres conditions n'est pas refusée — elle est **mise
en file d'attente**. L'API répond `applied: false`, et `reconcile()` est appelé
à chaque nouvelle position : dès que les conditions sont réunies, la commande
part.

Ce comportement est visible dans l'interface : l'état passe à
« Blocage en attente d'arrêt » plutôt que « Bloqué ».

### Pourquoi côté serveur

Un bouton grisé dans le navigateur n'est pas une protection. Il suffit d'un
`curl` pour appeler la route directement. La vérification doit donc vivre dans
le service, pas dans le composant React.

Le test qui le prouve, exécuté pendant le développement :

```
POST /api/vehicles/C-01/starter/block   (camion à 70 km/h)
→ { "applied": false, "vehicleSpeedAtRequest": 70, "ignitionAtRequest": true }
→ starter = "pending_block"
```

### Traçabilité

Chaque commande produit une ligne dans `command_logs`, avec l'auteur, le motif
obligatoire, et l'état du véhicule au moment de la demande. En cas de litige sur
une immobilisation, c'est cette table qui répond.

---

## 5. Le backend, module par module

### `telemetry/` — d'où viennent les données

L'interface `TelemetrySource` définit ce que l'API attend d'une source :
`start(onPosition)` et `setDigitalOutput(vehicleId, output, active)`.

Deux implémentations :

**`SimulatorSource`** fabrique cinq camions circulant sur trois itinéraires,
avec consommation proportionnelle à la distance et trois scénarios scriptés :
une sortie de dépôt sans appui du bouton, un siphonnage à l'arrêt, et des
traversées de zones interdites.

**`TraccarSource`** ouvre une session HTTP, charge la liste des boîtiers, se
connecte au WebSocket et convertit les trames. La reconnexion utilise un délai
exponentiel plafonné à 60 secondes.

Le choix se fait par la variable `TELEMETRY_SOURCE`. Le reste du backend ignore
laquelle est active — c'est ce qui permet de développer la totalité du système
avant l'arrivée du matériel.

### `fleet/` — l'état et l'historique

**`FleetService`** tient l'état courant en mémoire et orchestre le traitement de
chaque trame :

```
conversion → état → règles métier → immobiliseur → persistance → diffusion
```

L'état courant n'est volontairement pas en base : il change chaque seconde et
seule la dernière valeur compte.

**`VehiclesService`** porte le répertoire, avec cache en mémoire. Un boîtier
absent du répertoire est signalé une fois puis ignoré — sans ce garde-fou, un
IMEI mal saisi créerait un camion fantôme.

**`PositionsService`** décide de ce qui mérite une ligne en base. C'est le point
le plus important de ce module, détaillé en section 6.

**`DeparturesService`** gère les fiches du superviseur. Une seule fiche ouverte
par camion à la fois : en ouvrir une seconde signalerait soit une erreur de
saisie, soit un trajet non soldé.

### `geofence/` — les zones

Cercles et polygones cohabitent dans une seule table. Distance par haversine,
appartenance à un polygone par ray casting. Les zones sont **mises en cache** :
`locate()` est appelé à chaque trame de chaque camion, une requête SQL à cet
endroit serait le premier goulot du système.

Une zone n'est jamais supprimée, seulement désactivée — les positions déjà
enregistrées la référencent.

### `fuel/` — carburant

**Conversion.** Chaque camion a une courbe tension → litres par réservoir,
interpolée linéairement entre les points relevés. Une courbe unique pour toute
la flotte ne tiendrait pas : les sondes sont montées à des hauteurs légèrement
différentes, et un réservoir aluminium n'a pas une section constante sur sa
hauteur.

**Détection de siphonnage.** Une chute de plus de 25 L en 10 minutes, véhicule
à l'arrêt, déclenche une alerte critique. La condition « à l'arrêt » est
essentielle : une baisse en roulage est de la consommation normale.

Les deux réservoirs sont lus et affichés **séparément**, jamais additionnés.
C'est la lecture séparée qui rend un vol visible.

### `rules/` — le moteur métier

Trois règles évaluées à chaque position :

**Transition de zone** — entrée en zone interdite (alerte critique), sortie
(information).

**Sortie sans confirmation** — un camion quitte une station sans que le bouton
ait été pressé. Une alerte critique part, et un blocage est *demandé*, jamais
appliqué immédiatement : le camion roule au moment de la détection.

**Carburant** — chute anormale, autonomie faible.

Ces règles vivent ici et non dans Traccar parce que Traccar sait détecter une
entrée de geofence, mais ignore ce qu'est un bouton de confirmation chauffeur.

### `immobilizer/` — le contrôle du démarreur

Voir section 4. Ce service est le seul à appeler `setDigitalOutput`.

### `events/` — le bus interne

Tous les modules publient sur un `Subject` RxJS. Le contrôleur SSE est le seul
consommateur exposé au réseau. Cette indirection permet d'ajouter un
destinataire (notification, webhook, journalisation) sans toucher aux modules
producteurs.

### `auth/` et `users/` — voir section 7.

---

## 6. Modèle de données

Huit tables.

| Table | Rôle |
|---|---|
| `users` | Comptes et rôles |
| `refresh_sessions` | Sessions ouvertes |
| `command_logs` | Audit des commandes moteur |
| `vehicles` | Répertoire de la flotte |
| `zones` | Stations et zones interdites |
| `positions` | Historique des trajets |
| `fuel_calibrations` | Courbes tension → litres |
| `departures` | Fiches du superviseur |

Le schéma SQL complet et commenté est dans `infra/sql/schema.sql`.

### Choix qui méritent une explication

**Pas de clés étrangères sur `command_logs`.** Le journal doit survivre à la
suppression d'un compte — sinon un administrateur efface sa propre trace en
supprimant son utilisateur. `actor_id` vaut `NULL` quand c'est une règle
automatique qui a agi.

**`positions.id` en `BIGINT`, pas en UUID.** Sur plusieurs millions de lignes,
un UUID aléatoire fragmente l'index InnoDB et double la taille des index
secondaires. Les autres tables restent en UUID, où le volume ne pose pas ce
problème.

**Index composé `(vehicle_id, recorded_at)`.** Il sert la requête dominante :
« le trajet du camion X entre deux dates ». Sans lui, chaque affichage
d'historique ferait un balayage complet de la table.

**`refresh_sessions.token_hash`.** On stocke un SHA-256 du jeton, jamais le
jeton. Une fuite de la base ne permet pas de rejouer une session. Bcrypt serait
inutile ici : le jeton fait déjà 48 octets aléatoires, il n'y a rien à deviner.

**Désactivation plutôt que suppression** pour `vehicles` et `zones`. Les
positions enregistrées référencent ces identifiants.

### Le filtrage des positions

C'est la décision qui a le plus d'effet sur la viabilité du système à long
terme.

Enregistrer chaque trame paraît évident, et c'est une erreur. Cinq camions
émettant toutes les 30 secondes produisent environ 14 000 lignes par jour, soit
5 millions par an. Un camion à l'arrêt moteur coupé écrirait une ligne identique
toute la nuit — des milliers de lignes sans aucune information.

`PositionsService.shouldPersist()` ne garde qu'une trame qui raconte quelque
chose :

| Motif (`kept_because`) | Déclencheur |
|---|---|
| `first` | première trame connue du véhicule |
| `ignition` | changement de contact — borne un trajet, jamais filtré |
| `zone` | entrée ou sortie de zone — doit être datable à la trame près |
| `moved` | déplacement ≥ 60 m |
| `interval` | point de contrôle toutes les 3 min — prouve que le boîtier émettait |

La colonne `kept_because` conserve le motif retenu, ce qui permet de comprendre
plus tard pourquoi un trajet comporte plus ou moins de points.

Mesure faite sur 25 secondes de simulation : un camion à l'arrêt a produit 15
lignes contre 25 pour un camion en roulage. La nuit, l'écart devient massif.

---

## 7. Authentification et autorisations

### Rôles

Hiérarchie cumulative — un rôle donne accès à tout ce qu'autorisent les rôles
inférieurs.

| Rôle | Ajoute |
|---|---|
| `viewer` | Carte, fiches, alertes, historique |
| `operator` | Confirmer un départ, acquitter une alerte, ouvrir une fiche |
| `supervisor` | Bloquer et réautoriser un démarreur, gérer zones et calibrations |
| `admin` | Gérer les comptes et le répertoire des véhicules |

### Protection par défaut

`JwtAuthGuard` est déclarée globalement. Toute route est protégée ; il faut un
`@Public()` explicite pour l'ouvrir. L'inverse — protéger route par route —
finit toujours par laisser un trou.

### Sessions par cookies httpOnly

Le jeton d'accès (15 min) et le jeton de rafraîchissement (7 jours) sont des
cookies `httpOnly` + `sameSite=strict`. Trois conséquences :

- une faille XSS dans le dashboard ne permet pas de voler une session ;
- aucun site tiers ne peut déclencher un blocage de démarreur par CSRF ;
- **le flux SSE s'authentifie tout seul** — `EventSource` n'accepte pas
  d'en-tête `Authorization`, mais envoie les cookies.

Ce dernier point est la raison principale du choix. Avec un jeton en
`localStorage`, il aurait fallu le passer en paramètre d'URL, où il finit dans
les logs du serveur et l'historique du navigateur.

### Rotation et détection de vol

Le jeton de rafraîchissement tourne à chaque utilisation : l'ancien est révoqué
et remplacé. Si un jeton déjà révoqué est présenté, **toutes** les sessions de
l'utilisateur sont coupées — c'est la signature d'un jeton volé et rejoué.

### Revalidation en base

Le garde recharge l'utilisateur depuis la base à chaque requête. Normalement on
fait confiance au JWT pendant sa durée de vie ; ici, 15 minutes de délai avant
qu'une révocation prenne effet, sur un système capable de couper un démarreur,
c'est trop long. Le coût est une requête SQL par appel — acceptable.

Conséquence pratique : désactiver un compte le déconnecte dans la seconde.

### Mots de passe

Bcrypt, 12 tours. Minimum 12 caractères pour tout compte créé via l'API. Le
message d'échec de connexion est identique que l'adresse existe ou non, avec
une comparaison à vide pour garder un temps de réponse constant — sinon
l'écart de latence transforme le formulaire en annuaire de comptes valides.

---

## 8. Le temps réel

### Pourquoi SSE et non WebSocket

Le trafic est unidirectionnel : le serveur pousse, le navigateur écoute. Les
commandes partent en `POST` classique. Dans ce cas, `EventSource` a trois
avantages sur un WebSocket :

- reconnexion automatique gérée par le navigateur, sans code ;
- traversée des proxys HTTP sans configuration ;
- authentification par cookie, sans bricolage.

### Le contrat

À la connexion, le client reçoit un `snapshot` complet. Ensuite, des messages
incrémentaux :

```ts
type StreamMessage =
  | { type: 'snapshot'; vehicles: VehicleState[]; alerts: Alert[] }
  | { type: 'position'; vehicle: VehicleState }
  | { type: 'alert';    alert: Alert }
  | { type: 'command';  audit: CommandAudit }
  | { type: 'heartbeat'; at: string }
```

Le `heartbeat` toutes les 20 secondes évite qu'un proxy coupe une connexion
jugée inactive quand la flotte est à l'arrêt.

---

## 9. Le frontend

React 18 + TypeScript + Vite. MapLibre GL pour la carte.

### La carte sans serveur de tuiles

Le style par défaut est un fond neutre sans aucune requête réseau. La carte
fonctionne donc hors ligne, et les zones comme les véhicules s'affichent via des
sources GeoJSON. Renseigner `VITE_MAP_STYLE` bascule sur un vrai fond
cartographique sans autre modification.

Ce choix est cohérent avec le principe de propriété totale : le système ne
dépend d'aucun service externe pour fonctionner.

### Gestion de session

`useFleetStream` ouvre une seule connexion SSE pour toute l'application et
expose l'état de connexion, affiché en permanence dans la barre du haut. Un
exploitant doit savoir si ce qu'il regarde est encore à jour.

Le client HTTP tente un rafraîchissement silencieux au premier 401, puis rejoue
la requête une fois. Un verrou évite que dix appels simultanés lancent dix
rafraîchissements concurrents — la rotation des jetons les ferait tous échouer
sauf un, et couperait la session.

### Permissions dans l'interface

`useAuth().can('supervisor')` masque les actions inaccessibles. C'est du
confort, pas une protection : le serveur refuse indépendamment.

---

## 10. Référence de l'API

### Session

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/auth/login` | public |
| `POST` | `/api/auth/refresh` | public |
| `POST` | `/api/auth/logout` | authentifié |
| `GET` | `/api/auth/me` | authentifié |

### Temps réel

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/stream` | authentifié — flux SSE |

### Flotte

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/vehicles` | viewer |
| `GET` | `/api/vehicles/:id` | viewer |
| `GET` | `/api/vehicles/:id/history` | viewer |
| `GET` | `/api/fleet/vehicles` | viewer |
| `POST` | `/api/fleet/vehicles` | admin |
| `PATCH` | `/api/fleet/vehicles/:id` | admin |

### Contrôle moteur

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/vehicles/:id/starter/block` | **supervisor** |
| `POST` | `/api/vehicles/:id/starter/release` | **supervisor** |
| `GET` | `/api/vehicles/:id/commands` | viewer |

Motif obligatoire, 5 caractères minimum. La réponse contient `applied` :
`false` signifie mise en file d'attente, pas erreur.

### Zones, carburant, départs

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/zones` | viewer |
| `POST` | `/api/zones` | supervisor |
| `PATCH` | `/api/zones/:id` | supervisor |
| `GET` | `/api/vehicles/:id/calibration` | viewer |
| `POST` | `/api/vehicles/:id/calibration` | supervisor |
| `GET` | `/api/departures` | viewer |
| `POST` | `/api/vehicles/:id/departure` | operator |
| `POST` | `/api/departures/:id/close` | operator |

### Comptes

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/users` | admin |
| `POST` | `/api/users` | admin |
| `PATCH` | `/api/users/:id` | admin |

---

## 11. Installation et exploitation

### Développement

```bash
# Base
docker compose up -d mysql
# ou MySQL local — voir docs/mysql-phpmyadmin.md

cd backend
cp .env.example .env          # renseigner DB_* et JWT_SECRET
npm install
npm run seed                  # schéma + admin + flotte de démonstration
npm run start:dev             # http://localhost:3000

cd ../frontend
npm install
npm run dev                   # http://localhost:5173
```

`JWT_SECRET` se génère avec `openssl rand -base64 48`. Le changer invalide
toutes les sessions ouvertes.

`npm run seed` est idempotent — le relancer après chaque ajout d'entité ne
duplique rien.

### Production

Trois points non négociables avant mise en service :

**Désactiver `synchronize`.** `NODE_ENV=production` suffit. Une modification
d'entité pourrait sinon supprimer une colonne et ses données.

**Ne pas exposer phpMyAdmin.** Cible d'attaques automatisées permanente. Y
accéder par tunnel SSH : `ssh -L 8081:localhost:8081 user@vps`.

**Sauvegarder `command_logs`.** C'est la trace exploitable en cas de litige sur
une immobilisation.

```bash
docker compose exec mysql mysqldump -u fleet -p fleet > sauvegarde-$(date +%F).sql
```

### Ports à ouvrir sur le VPS

| Port | Usage |
|---|---|
| 5027 TCP/UDP | Protocole Teltonika — à renseigner dans le FMC650 |
| 5055 | OsmAnd — injection de positions de test depuis un téléphone |
| 443 | Dashboard, derrière un reverse proxy avec TLS |

Les ports 8082 (Traccar), 3306 (MySQL) et 3000 (API) ne doivent **pas** être
exposés publiquement.

---

## 12. Du simulateur au matériel réel

### La bascule

```bash
TELEMETRY_SOURCE=traccar
TRACCAR_URL=http://traccar:8082
TRACCAR_USER=...
TRACCAR_PASSWORD=...
```

Aucun autre changement. C'est tout l'intérêt de l'abstraction `TelemetrySource`.

### À valider sur le camion pilote

Dans cet ordre, avant d'écrire la moindre ligne d'interface supplémentaire :

1. **Les positions remontent-elles ?** Vérifiable dans l'interface web de
   Traccar, sans passer par l'API.
2. **`in1` reflète-t-il l'état moteur ?** Contact mis / coupé.
3. **`in2` produit-il un événement à l'appui du bouton ?**
4. **`adc1` et `adc2` donnent-elles une tension exploitable ?** Relever la
   valeur réservoir vide, puis à chaque quart de remplissage mesuré à la pompe.
   Cinq points minimum par réservoir.
5. **Une commande `setdigout` active-t-elle le relais ?** À tester camion à
   l'arrêt, dans l'atelier, jamais en exploitation.
6. **Le Deep Sleep préserve-t-il la batterie ?** Laisser le camion à l'arrêt
   plusieurs jours et mesurer.

La correspondance des attributs Teltonika dans `TraccarSource.map()` est une
hypothèse tant que le point 2 n'est pas validé.

### Test sans matériel

Traccar accepte le protocole OsmAnd sur le port 5055. Une application mobile ou
un simple `curl` permet d'injecter des positions réelles avant l'arrivée des
boîtiers.

---

## 13. Limites connues et feuille de route

### Ce qui manque, par ordre de gravité

**1. Aucune limitation des tentatives de connexion.** Rien ne freine une attaque
par force brute sur `/api/auth/login`. C'est le trou le plus directement
exploitable du système en l'état.

**2. `synchronize: true` hors production.** TypeORM modifie le schéma tout seul.
À remplacer par des migrations avant toute mise en service.

**3. Écrans frontend manquants.** L'API expose zones, calibrations, fiches de
départ et historique ; aucune interface ne les consomme encore. C'est ce qui
sépare le système d'un outil utilisable par le client.

**4. Purge des positions non planifiée.** `purgeBefore()` existe mais rien ne
l'appelle. Effacer des données doit rester une décision explicite, pas un effet
de bord du démarrage — mais une politique de rétention doit être décidée.

**5. Rapports absents.** Consommation, distance, temps de trajet, incidents.

**6. Calibrations carburant fausses.** Celles du seed sont linéaires par
construction. Elles permettent de démarrer, pas de facturer.

### Ce qui est validé

Authentification et rôles, testés contre un vrai MySQL. Persistance des huit
tables. Règles métier avec les trois scénarios de démonstration. Immobiliseur
avec la règle de sécurité vérifiée par appel HTTP direct. Flux SSE. Dashboard de
suivi et de contrôle.

### Approche recommandée pour la suite

Un camion pilote, validé de bout en bout, avant d'équiper le reste de la flotte.
Le contrôle moteur en dernier — c'est la fonction la plus risquée et elle ne se
teste que sur un système déjà stable.
