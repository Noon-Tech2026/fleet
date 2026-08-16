# Système de gestion de flotte — squelette du projet

Suivi et contrôle d'une flotte de tracteurs SHACMAN F3000, entièrement auto-hébergé.
Aucune dépendance à un SaaS tiers, aucun abonnement fabricant.

---

## Démarrer

Le projet tourne **sans aucun matériel** : un simulateur intégré fabrique des
positions, des niveaux de carburant et déclenche les scénarios d'alerte.
Il faut en revanche une base MySQL, qui porte les comptes et le journal d'audit.

> Pour une installation détaillée avec MAMP, XAMPP ou phpMyAdmin,
> voir [docs/mysql-phpmyadmin.md](docs/mysql-phpmyadmin.md).

```bash
# 1. Base de données (Docker)
docker compose up -d mysql
# Avec l'interface phpMyAdmin sur http://localhost:8081 :
#   docker compose --profile tools up -d mysql phpmyadmin

# 2. API
cd backend
cp .env.example .env
# Renseigner DB_PASSWORD et générer JWT_SECRET :
#   openssl rand -base64 48
npm install
npm run seed               # crée le premier administrateur
npm run start:dev          # http://localhost:3000

# 3. Dashboard
cd ../frontend
npm install
npm run dev                # http://localhost:5173
```

`npm run seed` affiche l'identifiant et le mot de passe de l'administrateur
**une seule fois**. Si `ADMIN_PASSWORD` est vide, un mot de passe est généré
aléatoirement — notez-le à ce moment-là.

Le bandeau « Données simulées » reste affiché tant que la source n'est pas réelle.

---

## Architecture

```
Boîtier FMC650 ──4G──> Traccar ──WebSocket──> API NestJS ──SSE──> Dashboard React
                        (ingestion)          (règles métier)      (affichage)
```

Trois couches, et une règle qui ne se négocie pas : **le navigateur ne parle
jamais directement à Traccar**. Tout passe par l'API, qui est le seul endroit
où les décisions de sécurité sont prises.


| Couche          | Responsabilité                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Traccar         | Décodage Codec 8, positions brutes, envoi des commandes GPRS                                      |
| API NestJS      | Authentification, calibration carburant, geofencing métier, règles d'alerte, immobiliseur, audit |
| MySQL           | Comptes, sessions, journal d'audit des commandes moteur                                            |
| Dashboard React | Carte, fiches véhicules, journal, commandes                                                       |

### Pourquoi SSE plutôt que WebSocket

Le trafic temps réel est unidirectionnel : le serveur pousse, le navigateur
écoute. Les commandes partent en `POST` classique. `EventSource` gère la
reconnexion tout seul et le flux traverse les proxys HTTP sans configuration.

Un point à retenir : le WebSocket de Traccar est lié à une session utilisateur
et supporte mal les connexions multiples. L'API en ouvre **une seule** et
rediffuse à tous les navigateurs.

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

## La règle de sécurité

Elle vit dans `backend/src/immobilizer/immobilizer.service.ts` et nulle part ailleurs.

Le système **ne coupe jamais un moteur en marche**. Couper l'alimentation d'un
ensemble de 40 tonnes en roulage supprime la direction assistée et l'assistance
de freinage. La seule action autorisée est le blocage du démarreur, et
uniquement véhicule à l'arrêt, contact coupé.

Une demande émise dans d'autres conditions n'est pas refusée : elle est **mise
en file d'attente** et exécutée automatiquement au prochain arrêt. L'API répond
alors `applied: false`, ce qui n'est pas une erreur.

Cette vérification est côté serveur par nécessité, pas par élégance. Un bouton
grisé dans le navigateur se contourne avec un `curl`.

---

## API


| Méthode | Route                                 | Rôle                                              |
| -------- | ------------------------------------- | -------------------------------------------------- |
| `GET`    | `/api/stream`                         | Flux SSE : snapshot, positions, alertes, commandes |
| `GET`    | `/api/vehicles`                       | État courant de la flotte                         |
| `GET`    | `/api/zones`                          | Zones (stations et zones interdites)               |
| `GET`    | `/api/alerts`                         | Alertes récentes                                  |
| `POST`   | `/api/vehicles/:id/starter/block`     | Demande de blocage (motif obligatoire)             |
| `POST`   | `/api/vehicles/:id/starter/release`   | Réautorisation                                    |
| `POST`   | `/api/vehicles/:id/departure/confirm` | Confirmation de départ                            |
| `GET`    | `/api/vehicles/:id/commands`          | Journal d'audit des commandes                      |
| `POST`   | `/api/auth/login`                     | Connexion (public)                                 |
| `POST`   | `/api/auth/refresh`                   | Rotation des jetons (public)                       |
| `POST`   | `/api/auth/logout`                    | Déconnexion                                       |
| `GET`    | `/api/auth/me`                        | Utilisateur courant                                |
| `GET`    | `/api/users`                          | Liste des comptes (admin)                          |
| `POST`   | `/api/users`                          | Création d'un compte (admin)                      |
| `PATCH`  | `/api/users/:id`                      | Rôle, nom, activation (admin)                     |

---

## Authentification et rôles

Toute route est protégée **par défaut** : `JwtAuthGuard` est appliquée
globalement et il faut un `@Public()` explicite pour ouvrir une route. Protéger
route par route finit toujours par laisser un trou.


| Rôle        | Peut                                         |
| ------------ | -------------------------------------------- |
| `viewer`     | Consulter la carte, les fiches, les alertes  |
| `operator`   | + confirmer un départ, acquitter une alerte |
| `supervisor` | + bloquer et réautoriser un démarreur      |
| `admin`      | + créer et gérer les comptes               |

La hiérarchie est cumulative : un `admin` peut tout ce que peut un `viewer`.

### Sessions par cookies httpOnly

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

## Ce qui n'est pas encore fait

1. **Migrations.** `synchronize: true` laisse TypeORM modifier le schéma tout
   seul. Acceptable en développement, à remplacer par des migrations avant
   toute mise en service.
2. **Historique des positions.** L'état des véhicules vit encore en mémoire et
   disparaît au redémarrage. Seuls les comptes et l'audit sont persistés.
3. **Écran superviseur.** Saisie du chargement et de la destination à la sortie,
   liée à la confirmation du chauffeur.
4. **Rapports.** Consommation, distance, temps de trajet, incidents.
5. **Fond cartographique.** La carte fonctionne sans serveur de tuiles ; il
   suffit de renseigner `VITE_MAP_STYLE` pour un vrai fond.
6. **Limitation des tentatives de connexion.** Rien ne freine aujourd'hui une
   attaque par force brute sur `/api/auth/login`.

---

## Scénarios du simulateur

Au bout de quelques minutes, sans intervention :

- **C-03** quitte le dépôt sans appui du bouton chauffeur → alerte critique et
  blocage programmé au prochain arrêt.
- **C-04** s'arrête sur l'accotement puis perd 14 L/min sur le réservoir
  principal → détection de siphonnage.
- **C-02** et **C-05** traversent des zones interdites.
