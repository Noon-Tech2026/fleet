# GeoTruck — suivi et pilotage de flotte

*Your fleet under control.*

Suivi et contrôle d'une flotte de tracteurs SHACMAN F3000, entièrement auto-hébergé.
Aucune dépendance à un SaaS tiers, aucun abonnement fabricant. Le client possède
ses données, son serveur et ses boîtiers ; les seuls coûts récurrents sont la
carte SIM des boîtiers et le VPS.

---

## Démarrer

Le projet tourne **sans aucun matériel** : un simulateur intégré fabrique des
positions, des niveaux de carburant et déclenche les scénarios d'alerte. Il
faut en revanche une base MySQL 8, qui porte les comptes, l'audit, le
répertoire des véhicules, l'entretien et la comptabilité.

> Pour une installation détaillée avec MAMP, XAMPP ou phpMyAdmin,
> voir [docs/mysql-phpmyadmin.md](docs/mysql-phpmyadmin.md).

```bash
# 1. Base de données (Docker, optionnel)
docker compose up -d mysql
# Avec l'interface phpMyAdmin :
#   docker compose --profile tools up -d mysql phpmyadmin
# Le mapping de port a changé lors de l'isolation de la pile de prod :
# MySQL répond sur l'hôte en 3307 (pas 3306) et phpMyAdmin en 8083.
# Si vous utilisez ce docker-compose pour le dev, mettez DB_PORT=3307
# dans backend/.env — sinon gardez une instance MySQL locale sur 3306.

# 2. API
cd backend
cp .env.example .env
# Renseigner DB_PASSWORD et générer JWT_SECRET :
#   openssl rand -base64 48
npm install
npm run seed               # crée le schéma + l'administrateur + une flotte de démo
npm run start:dev          # http://localhost:3000

# 3. Dashboard
cd ../frontend
npm install
npm run dev                # http://localhost:5173
```

`npm run seed` affiche l'identifiant et le mot de passe de l'administrateur
**une seule fois**. Si `ADMIN_PASSWORD` est vide, un mot de passe est généré
aléatoirement — notez-le à ce moment-là. Le script est **idempotent** : le
relancer après l'ajout d'une entité recrée le schéma manquant sans dupliquer
ni écraser les données existantes.

Le bandeau « Données simulées » reste affiché tant que la source n'est pas réelle.

---

## Architecture

```
Boîtier FMC650 ──4G──> Traccar ──WebSocket──> API NestJS ──SSE──> Dashboard React
                        (ingestion Codec 8)   (règles métier)      (affichage)
```

Trois couches, et une règle qui ne se négocie pas : **le navigateur ne parle
jamais directement à Traccar**. Tout passe par l'API, qui est le seul endroit
où les décisions de sécurité sont prises.

| Couche          | Responsabilité                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Traccar         | Décodage Codec 8, positions brutes, envoi des commandes GPRS                                                              |
| API NestJS      | Authentification, répertoire des véhicules, calibration carburant, geofencing, règles d'alerte, immobiliseur, entretien, comptabilité, audit |
| MySQL           | Comptes, sessions, audit des commandes moteur, positions, entretien, référentiels comptables (16 tables)                  |
| Dashboard React | Vue d'ensemble, carte, fiches véhicules, journal d'alertes, entretien, comptabilité, gestion des comptes                 |

### Pourquoi SSE plutôt que WebSocket

Le trafic temps réel est unidirectionnel : le serveur pousse, le navigateur
écoute. Les commandes partent en `POST` classique. `EventSource` gère la
reconnexion tout seul et le flux traverse les proxys HTTP sans configuration.

Un point à retenir : le WebSocket de Traccar est lié à une session utilisateur
et supporte mal les connexions multiples. L'API en ouvre **une seule** et
rediffuse à tous les navigateurs — c'est aussi là que les règles métier
s'exécutent, une fois pour toute la flotte, pas une fois par onglet ouvert.

---

## La règle de sécurité

Elle vit dans `backend/src/immobilizer/immobilizer.service.ts`, méthode
`isSafeToBlock()`, et nulle part ailleurs.

Le système **ne coupe jamais un moteur en marche**. Couper l'alimentation d'un
ensemble de 40 tonnes en roulage supprime la direction assistée et
l'assistance de freinage. La seule action autorisée est le blocage du
démarreur, et uniquement quand `speed <= 3 && !ignition`.

Une demande émise dans d'autres conditions n'est pas refusée : elle est **mise
en file d'attente** et exécutée automatiquement au prochain arrêt. L'API répond
alors `applied: false`, ce qui n'est pas une erreur.

Cette vérification est côté serveur par nécessité, pas par élégance. Un bouton
grisé dans le navigateur se contourne avec un `curl`.

---

## Modules du dashboard

La barre de navigation adapte ses onglets et ses actions au rôle connecté (le
serveur refuse de toute façon toute action non autorisée, l'affichage n'est
qu'un confort) :

| Onglet / action                  | Contenu                                                                                                   | Rôle minimal   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------- |
| **Vue d'ensemble**                | Cartes par camion : état, jauges carburant animées, moteur, synthèse financière ; historique des voyages en plein écran | `viewer`       |
| — bouton *Nouveau camion*         | Création d'un véhicule (id, plaque, IMEI, capacités des réservoirs) — sans affectation de chauffeur, le chauffeur se choisit à la création d'un voyage | `admin`        |
| **Supervision**                   | Carte temps réel, liste de la flotte, fiche véhicule détaillée, journal d'alertes                          | `viewer`       |
| **Entretien**                     | Échéances par camion et par type d'intervention, journal des interventions réalisées                      | `viewer`       |
| **Comptabilité**                  | Synthèse financière de la flotte, détail par camion (voyages, conteneurs, charges, investissements)        | `viewer`       |
| — boutons *Ajouter chauffeur* / *Ajouter client* | Référentiels utilisés à la saisie d'un voyage                                              | `supervisor`   |
| **Utilisateurs**                  | Gestion des comptes (création, rôle, activation, mot de passe)                                             | `admin`        |

---

## Répertoire des véhicules

Géré depuis `backend/src/fleet/fleet-admin.controller.ts` et
`vehicles.service.ts` :

- `POST /api/fleet/vehicles` (admin) crée un véhicule à partir de son
  identifiant, sa plaque, son IMEI et — optionnellement — la capacité de ses
  réservoirs. Aucun chauffeur n'est fixé à la création : il est choisi à
  chaque voyage, pas au véhicule.
- `PATCH /api/fleet/vehicles/:id` (admin) met à jour plaque, chauffeur, IMEI,
  capacités ou notes.
- `POST /api/fleet/vehicles/:id/deactivate` (admin) retire un véhicule sans
  supprimer son historique.

En simulateur, un véhicule créé depuis le répertoire est automatiquement
rattaché à la flotte simulée au démarrage de l'API et à sa création — sans
cette synchronisation, un camion sans boîtier réel ne « roulait » jamais et
restait invisible en Vue d'ensemble.

---

## Comptabilité

Module `backend/src/accounting/` : référentiels clients et chauffeurs, voyages
facturés (avec leurs conteneurs, 20 ou 40 pieds), charges et investissements
par véhicule, et une synthèse financière (`revenue`, `expenses`,
`investments`, `netResult`) consultable par camion ou pour toute la flotte.

Les montants sont affichés en **MRU (ouguiya)**, `fr-FR` pour le séparateur
décimal — voir `frontend/src/lib/accounting.ts`.

Répartition des droits :

- `operator` crée et modifie les voyages (origine, destination, montant,
  conteneurs).
- `supervisor` ajoute clients, chauffeurs, charges et investissements — une
  charge ou un chauffeur mal saisi fausse le résultat net de tout un camion.
- La fiche détail d'un camion se résout via le répertoire des véhicules
  (`/api/fleet/vehicles`), pas via la télémétrie en direct : un camion sans
  position récente doit rester consultable.

---

## Entretien

Catalogue de référence pour un SHACMAN F3000 en service carrière
(`backend/src/maintenance/maintenance.catalog.ts`) : vidange moteur, cartouche
huile, cartouche gasoil, décanteur d'eau, filtre à air, huile de boîte, huile
de ponts, graissage général, contrôle du freinage — chacun avec une
périodicité en kilomètres, heures moteur et/ou jours. Ce sont des valeurs de
départ, réglables par camion depuis l'interface, pas une doctrine figée.

- `operator` consigne une intervention réalisée.
- `supervisor` règle les périodicités par véhicule et désactive un plan.

Les alertes d'entretien ne se déclenchent qu'au **franchissement** d'une
échéance : `detectTransitions()` amorce son état en silence à la première
évaluation. Au démarrage de l'API, un parc dont la moitié des vidanges est en
retard ne noie donc pas le fil d'événements — cet état permanent se lit dans
l'onglet Entretien, pas dans les alertes.

---

## Rôles

Hiérarchie cumulative : `viewer` < `operator` < `supervisor` < `admin`. Un
`admin` peut tout ce que peut un `viewer`.

| Rôle         | Ajoute                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| `viewer`     | Carte, fiches véhicules, alertes, historique, entretien, comptabilité — en lecture                    |
| `operator`   | Confirmer un départ, acquitter une alerte, ouvrir/clore une fiche de départ, consigner un entretien réalisé, saisir un voyage |
| `supervisor` | Bloquer/réautoriser un démarreur, gérer les zones, les calibrations carburant, les périodicités d'entretien, les référentiels clients/chauffeurs, les charges et investissements |
| `admin`      | Gérer les comptes utilisateurs et le répertoire des véhicules                                        |

Décorateur : `@RequireRole(Role.Supervisor)` sur la méthode ou la classe.
Masquer un bouton dans le frontend est du confort, pas une protection — le
serveur refuse toujours indépendamment.

---

## Sessions par cookies httpOnly

Le jeton d'accès (15 min) et le jeton de rafraîchissement (7 jours) sont des
cookies `httpOnly` + `sameSite=strict`. Trois conséquences :

- une faille XSS dans le dashboard ne permet pas de voler une session,
- aucun site tiers ne peut déclencher un blocage de démarreur par CSRF,
- **le flux SSE s'authentifie tout seul** — `EventSource` n'accepte pas
  d'en-tête `Authorization`, mais envoie les cookies.

Le jeton de rafraîchissement est stocké **haché** en base et tourne à chaque
utilisation. Si un jeton déjà révoqué est présenté, toutes les sessions de
l'utilisateur sont coupées : c'est la signature d'un vol de jeton.

Enfin, le garde revalide le compte en base à chaque requête. Désactiver un
utilisateur le déconnecte immédiatement, sans attendre l'expiration du jeton.

---

## Anti brute-force

Deux niveaux de limitation (`@nestjs/throttler`, `backend/src/app.module.ts`) :

- **global** : 100 requêtes par minute et par IP sur toute l'API,
- **`POST /api/auth/login`** : 5 tentatives par minute — au-delà, `429`.

---

## API

| Méthode  | Route                                        | Rôle                                                |
| -------- | --------------------------------------------- | ---------------------------------------------------- |
| `GET`    | `/api/stream`                                 | Flux SSE : snapshot, positions, alertes, commandes  |
| `GET`    | `/api/vehicles`                               | État courant de la flotte                            |
| `GET`    | `/api/vehicles/:id`                           | État courant d'un véhicule                           |
| `GET`    | `/api/zones`                                  | Zones actives (stations et zones interdites)         |
| `GET`    | `/api/alerts`                                 | Alertes récentes                                     |
| `POST`   | `/api/alerts/:id/acknowledge`                 | Acquittement d'une alerte (operator)                 |
| `POST`   | `/api/vehicles/:id/departure/confirm`         | Confirmation de départ (operator)                    |
| `POST`   | `/api/vehicles/:id/starter/block`             | Demande de blocage du démarreur, motif obligatoire (supervisor) |
| `POST`   | `/api/vehicles/:id/starter/release`           | Réautorisation (supervisor)                          |
| `GET`    | `/api/vehicles/:id/commands`                  | Journal d'audit des commandes                        |
| `GET`    | `/api/fleet/vehicles`                         | Répertoire des véhicules                             |
| `POST`   | `/api/fleet/vehicles`                         | Création d'un véhicule (admin)                       |
| `PATCH`  | `/api/fleet/vehicles/:id`                     | Mise à jour d'un véhicule (admin)                     |
| `POST`   | `/api/fleet/vehicles/:id/deactivate`          | Retrait d'un véhicule (admin)                        |
| `GET`    | `/api/vehicles/:id/history`                   | Trajet entre deux dates (défaut : 24 h, 5000 points max) |
| `GET`    | `/api/vehicles/:id/positions/count`           | Nombre de points de position persistés               |
| `GET`    | `/api/zones/all`                              | Toutes les zones, actives ou non (admin)              |
| `POST`   | `/api/zones`                                  | Création d'une zone (supervisor)                     |
| `PATCH`  | `/api/zones/:id`                              | Mise à jour d'une zone (supervisor)                  |
| `POST`   | `/api/zones/:id/deactivate`                   | Désactivation d'une zone (supervisor)                |
| `GET`    | `/api/vehicles/:id/calibration`               | Courbe de calibration carburant                      |
| `POST`   | `/api/vehicles/:id/calibration`               | Enregistrement d'une courbe (supervisor)             |
| `GET`    | `/api/departures`                             | Fiches de départ                                     |
| `GET`    | `/api/departures/open`                        | Fiches de départ ouvertes                            |
| `GET`    | `/api/vehicles/:id/departure`                 | Fiche de départ courante d'un véhicule                |
| `POST`   | `/api/vehicles/:id/departure`                 | Ouverture d'une fiche de départ (operator)            |
| `POST`   | `/api/departures/:id/close`                   | Clôture d'une fiche de départ (operator)              |
| `GET`    | `/api/maintenance/catalog`                    | Catalogue des types d'entretien                       |
| `GET`    | `/api/maintenance`                            | Échéances de toute la flotte                          |
| `GET`    | `/api/maintenance/logs`                       | Journal des interventions réalisées                   |
| `GET`    | `/api/vehicles/:id/maintenance`               | Échéances d'un véhicule                               |
| `GET`    | `/api/vehicles/:id/maintenance/logs`          | Interventions réalisées sur un véhicule               |
| `POST`   | `/api/vehicles/:id/maintenance/:kind/service` | Consigner une intervention réalisée (operator)        |
| `POST`   | `/api/vehicles/:id/maintenance/:kind`         | Réglage de la périodicité pour un véhicule (supervisor) |
| `POST`   | `/api/vehicles/:id/maintenance`               | Initialisation des plans d'un véhicule (supervisor)   |
| `POST`   | `/api/maintenance/plans/:planId/deactivate`   | Désactivation d'un plan (supervisor)                  |
| `GET`    | `/api/accounting/clients`                     | Référentiel clients                                   |
| `POST`   | `/api/accounting/clients`                     | Création d'un client (supervisor)                     |
| `PATCH`  | `/api/accounting/clients/:id`                 | Mise à jour d'un client (supervisor)                  |
| `GET`    | `/api/accounting/drivers`                     | Référentiel chauffeurs                                |
| `POST`   | `/api/accounting/drivers`                     | Création d'un chauffeur (supervisor)                  |
| `PATCH`  | `/api/accounting/drivers/:id`                 | Mise à jour d'un chauffeur (supervisor)               |
| `GET`    | `/api/accounting/trips`                       | Voyages, filtrables par véhicule/client/chauffeur/période |
| `POST`   | `/api/accounting/trips`                       | Création d'un voyage avec ses conteneurs (operator)   |
| `PATCH`  | `/api/accounting/trips/:id`                   | Mise à jour d'un voyage (operator)                    |
| `GET`    | `/api/vehicles/:id/trips`                     | Voyages d'un véhicule                                 |
| `GET`    | `/api/vehicles/:id/expenses`                  | Charges d'un véhicule                                 |
| `POST`   | `/api/vehicles/:id/expenses`                  | Ajout d'une charge (supervisor)                       |
| `GET`    | `/api/vehicles/:id/investments`               | Investissements d'un véhicule                         |
| `POST`   | `/api/vehicles/:id/investments`               | Ajout d'un investissement (supervisor)                |
| `GET`    | `/api/vehicles/:id/accounting-summary`        | Synthèse financière d'un véhicule                     |
| `GET`    | `/api/accounting/summary`                     | Synthèse financière de toute la flotte                |
| `POST`   | `/api/auth/login`                             | Connexion (public, 5 tentatives/min)                  |
| `POST`   | `/api/auth/refresh`                           | Rotation des jetons (public)                          |
| `POST`   | `/api/auth/logout`                            | Déconnexion                                           |
| `GET`    | `/api/auth/me`                                | Utilisateur courant                                   |
| `GET`    | `/api/users`                                  | Liste des comptes (admin)                             |
| `POST`   | `/api/users`                                  | Création d'un compte (admin)                          |
| `PATCH`  | `/api/users/:id`                              | Rôle, nom, activation (admin)                         |
| `POST`   | `/api/users/:id/password`                     | Réinitialisation de mot de passe (admin)              |

---

## Basculer sur le matériel réel

Une seule variable change :

```bash
# backend/.env
TELEMETRY_SOURCE=traccar
TRACCAR_URL=http://traccar:8082
TRACCAR_USER=...
TRACCAR_PASSWORD=...
```

`SimulatorSource` et `TraccarSource` implémentent la même interface
(`telemetry.source.ts`). Le reste du backend ignore d'où viennent les données.

Avant la bascule, à vérifier sur le camion pilote :

- correspondance des attributs Teltonika (`in1`, `in2`, `out1`, `adc1`, `adc2`)
- courbe tension → litres de chaque réservoir, relevée à la pompe
- accusé de réception d'une commande `setdigout`

---

## Déploiement (Docker, production)

`docker-compose.yml` assemble une pile isolée sur son propre réseau
(`fleet-net`), sans dépendance à d'autres piles Docker de la machine :

| Service      | Rôle                                   | Port exposé sur l'hôte |
| ------------ | --------------------------------------- | ------------------------ |
| `mysql`      | MySQL 8.4, volume persistant             | `127.0.0.1:3307` → 3306  |
| `phpmyadmin` | Administration de la base (profil `tools`, optionnel) | `127.0.0.1:8083` → 80    |
| `traccar`    | Ingestion Codec 8 (GPRS 5027, HTTP 5055) | `8082`, `5027`, `5055`   |
| `api`        | Backend NestJS, `NODE_ENV=production`    | `127.0.0.1:3001` → 3000  |

Variables requises dans un `.env` à la racine : `DB_PASSWORD`,
`DB_ROOT_PASSWORD`, `JWT_SECRET`, et, pour basculer sur le matériel réel,
`TELEMETRY_SOURCE=traccar`, `TRACCAR_USER`, `TRACCAR_PASSWORD`. Les ports ne
sont bindés que sur `127.0.0.1` (sauf Traccar) : un reverse proxy TLS reste à
mettre devant pour une exposition publique.

---

## Ce qui n'est pas encore fait

1. **Migrations.** `synchronize: true` laisse TypeORM modifier le schéma tout
   seul. Acceptable en développement, à remplacer par des migrations avant
   toute mise en service.
2. **Écrans frontend manquants** pour la création de zones, la saisie d'une
   courbe de calibration carburant, et l'ouverture d'une fiche de départ
   complète (chauffeur, destination, chargement) — l'API les expose déjà,
   aucune interface ne les consomme encore.
3. **Historique cartographique.** L'historique disponible en Vue d'ensemble
   couvre les voyages facturés, pas le rejeu des positions GPS
   (`/api/vehicles/:id/history` existe côté API, sans écran de tracé).
4. **Purge planifiée** de la table `positions` — `purgeBefore()` existe, rien
   ne l'appelle.
5. **Rapports** — consommation, distance, temps de trajet, incidents.
6. **Calibrations carburant du seed.** Linéaires par construction, alors
   qu'un réservoir aluminium de 700 L n'a pas une section constante : elles
   permettent de démarrer, pas de facturer.
7. **Validation terrain** sur le camion pilote avant tout déploiement.

---

## Scénarios du simulateur

Au bout de quelques minutes, sans intervention :

- **C-03** quitte le dépôt sans appui du bouton chauffeur → alerte critique et
  blocage programmé au prochain arrêt.
- **C-04** s'arrête sur l'accotement puis perd 14 L/min sur le réservoir
  principal → détection de siphonnage.
- **C-02** et **C-05** traversent des zones interdites.

Un véhicule créé depuis le répertoire (Vue d'ensemble → *Nouveau camion*) est
automatiquement intégré à la flotte simulée dès sa création.

