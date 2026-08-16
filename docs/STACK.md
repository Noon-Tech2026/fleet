# Note technique — Technologies, langages et frameworks

Projet : système auto-hébergé de gestion de flotte
Date : 16 août 2026 · Phase : développement, avant pilote terrain

---

## 1. Vue d'ensemble

| Couche | Technologie | Langage |
|---|---|---|
| Boîtier embarqué | Teltonika FMC650 | firmware constructeur |
| Ingestion GPS | Traccar 6.x | Java |
| API métier | NestJS 10 | TypeScript |
| Base de données | MySQL 8.4 | SQL |
| Dashboard web | React 18 + Vite 6 | TypeScript |
| Déploiement | Docker Compose | YAML |

**Un seul langage applicatif : TypeScript.** Le backend et le frontend partagent
la même syntaxe, le même typage, et surtout le même fichier de contrat de
données. Un développeur qui connaît une moitié du projet peut travailler sur
l'autre. C'est le principal argument qui a écarté Python/FastAPI, qui aurait été
un choix également valable techniquement.

---

## 2. Langages

### TypeScript 5.7

Langage unique de l'application, backend et frontend.

JavaScript avec un système de types vérifié à la compilation. Sur un système qui
peut immobiliser un camion, cette vérification n'est pas un confort : une erreur
de type sur un booléen `ignition` ou un `speed` produirait un comportement
silencieusement faux. Le mode `strict` est activé, et aucun `any` n'est toléré
dans le code de production.

### SQL

Requêtes générées par TypeORM dans le cas courant, écrites à la main pour le
schéma de référence (`infra/sql/schema.sql`) et les opérations d'administration.

### Java

Uniquement à travers Traccar, qui est utilisé tel quel. Aucun développement Java
n'est prévu.

---

## 3. Backend

### NestJS 10.4

Framework Node.js structuré en modules, avec injection de dépendances et
décorateurs.

Retenu pour deux raisons. D'abord la structure imposée : sur un projet qui
mélange authentification, règles métier, télémétrie et contrôle matériel,
l'organisation en modules empêche le code de se transformer en un fichier
`server.ts` de 3000 lignes. Ensuite l'injection de dépendances, qui rend
possible l'abstraction `TelemetrySource` — le cœur de la stratégie de
développement sans matériel.

Express est le serveur HTTP sous-jacent (`@nestjs/platform-express`).

### TypeORM 0.3

ORM. Les tables sont décrites par des classes TypeScript annotées, ce qui garde
le schéma et le code typé en un seul endroit.

**Réserve assumée** : `synchronize: true` est actif hors production et laisse
TypeORM modifier le schéma tout seul. Pratique en développement, dangereux
ensuite — une modification d'entité peut supprimer une colonne et ses données.
Le passage aux migrations TypeORM est un prérequis à la mise en service.

### mysql2 3.11

Pilote MySQL. Gère l'authentification `caching_sha2_password` de MySQL 8 et 9,
ce qui évite d'avoir à rétrograder le mode d'authentification du serveur.

### RxJS 7.8

Programmation réactive. Utilisé pour le bus d'événements interne et le flux SSE.
Livré avec NestJS, pas ajouté.

### Sécurité

| Bibliothèque | Rôle |
|---|---|
| `@nestjs/jwt` 10.2 | Signature et vérification des jetons de session |
| `bcryptjs` 2.4 | Hachage des mots de passe, 12 tours |
| `cookie-parser` 1.4 | Lecture des cookies httpOnly |
| `class-validator` 0.14 | Validation des données entrantes |
| `class-transformer` 0.5 | Conversion des payloads en objets typés |

`bcryptjs` est l'implémentation JavaScript pure de bcrypt, choisie plutôt que
le module natif `bcrypt` : pas de compilation à l'installation, donc pas
d'échec de `npm install` selon la version de Node ou le système. Le coût est
une lenteur d'environ 30 % au hachage — sans importance sur une opération qui
n'a lieu qu'à la connexion.

### ws 8.18

Client WebSocket, utilisé uniquement pour la connexion sortante vers Traccar.
L'API ne **sert** pas de WebSocket ; elle diffuse en SSE.

---

## 4. Frontend

### React 18.3

Bibliothèque d'interface. Choisie pour l'écosystème cartographique, la
disponibilité des développeurs, et la facilité de reprise du projet par un
tiers.

Pas de bibliothèque de gestion d'état externe (ni Redux, ni Zustand) : l'état de
l'application tient dans un hook `useFleetStream` et un contexte
d'authentification. Ajouter une couche de plus serait de la complexité sans
contrepartie.

### Vite 6.0

Outil de build et serveur de développement. Démarrage en moins d'une seconde,
rechargement à chaud instantané, et un proxy intégré qui transmet `/api` vers le
backend — ce qui permet au navigateur de voir une seule origine et donc aux
cookies de session de fonctionner sans configuration CORS complexe.

### MapLibre GL JS 4.7

Moteur cartographique. Fork libre de Mapbox GL JS, sous licence BSD, **sans clé
d'API ni facturation à l'usage**.

C'est un point de cohérence avec le principe de propriété totale du projet :
Mapbox ou Google Maps auraient introduit une dépendance payante et un compteur
de requêtes dans un système censé n'avoir aucun coût récurrent hors SIM et VPS.

Le style par défaut n'effectue **aucune requête réseau** — la carte fonctionne
hors ligne, zones et véhicules affichés en GeoJSON. Renseigner `VITE_MAP_STYLE`
bascule sur un fond cartographique réel sans autre modification.

### CSS

Feuille de style unique, variables CSS natives, mode sombre. Pas de framework
CSS : les besoins se limitent à un tableau de bord dense, et une dépendance de
plus n'apporterait rien.

---

## 5. Base de données

### MySQL 8.4

Huit tables. Retenu à la demande du client, qui dispose déjà de compétences
MySQL et d'un environnement phpMyAdmin.

PostgreSQL aurait été légèrement préférable sur deux points — le partitionnement
natif de la table `positions` et le type `geometry` de PostGIS pour les zones.
Ces deux avantages ne sont pas décisifs ici : le volume reste modeste et le
calcul géométrique se fait en mémoire, dans le service, pas en SQL.

Encodage `utf8mb4` partout, jamais `utf8` : le jeu `utf8` de MySQL est tronqué à
3 octets et ne stocke pas certains caractères.

### Traccar 6.x

Serveur GPS open source. Décode nativement le protocole Teltonika Codec 8, gère
plus de 200 autres protocoles, et expose une API REST et un WebSocket.

Utilisé **tel quel**, sans modification. Il occupe la couche d'ingestion ; toute
la logique métier vit dans l'API NestJS. Ce découpage permettrait de remplacer
Traccar par un parseur Codec 8 maison sans toucher au reste — option envisagée
puis écartée, réécrire un décodeur de protocole éprouvé n'apporterait rien.

---

## 6. Matériel et protocoles

| Élément | Détail |
|---|---|
| Boîtier | Teltonika FMC650, série professionnelle poids lourds |
| Protocole données | Teltonika **Codec 8**, TCP/UDP port 5027 |
| Protocole commandes | Commandes GPRS Teltonika (`setdigout`) |
| Réseau | 4G LTE, une SIM par camion |
| Entrées utilisées | DIN1 (allumage), DIN2 (bouton), AIN1/AIN2 (sondes carburant) |
| Sortie utilisée | DOUT1 (relais démarreur 24 V) |
| Protocole de test | OsmAnd, port 5055 — injection de positions sans matériel |

---

## 7. Outils de développement

| Outil | Usage |
|---|---|
| Node.js 22 LTS | Environnement d'exécution — version de validation |
| npm | Gestion des dépendances |
| Docker Compose | MySQL, Traccar, phpMyAdmin en développement |
| phpMyAdmin 5.2 | Administration de la base, profil optionnel |
| Git | Versionnement |
| `tsc --noEmit` | Vérification de types, backend et frontend |

Node 22 est la version LTS sur laquelle le projet a été validé. Les versions
plus récentes fonctionnent, mais ne sont pas la référence.

---

## 8. Licences et coûts

**Toutes les briques logicielles sont libres et gratuites**, sans limitation
d'usage commercial ni de nombre de véhicules.

| Composant | Licence |
|---|---|
| Traccar | Apache 2.0 |
| NestJS | MIT |
| React | MIT |
| Vite | MIT |
| TypeORM | MIT |
| MapLibre GL JS | BSD-3-Clause |
| MySQL Community | GPL v2 |
| Node.js | MIT |

### Structure de coûts

| Poste | Nature |
|---|---|
| Boîtiers FMC650 | achat unique, ~1 par camion |
| Sondes, relais, boutons | achat unique |
| Cartes SIM 4G | **récurrent**, 1 par camion |
| VPS | **récurrent**, ~20 $/mois pour démarrer |
| Licences logicielles | **aucune** |
| Abonnement fabricant | **aucun** |

C'est la différence de fond avec une solution SaaS : le coût récurrent ne
dépend pas du nombre de camions suivis, et le système continue de fonctionner
si l'on arrête de payer quoi que ce soit — hormis la connectivité.

---

## 9. Ce qui a été écarté, et pourquoi

**Python + FastAPI** — techniquement équivalent, écarté pour garder un langage
unique sur tout le projet.

**Mapbox / Google Maps** — clé d'API, facturation à l'usage, dépendance externe.
Contraire au principe de propriété totale.

**WebSocket pour le temps réel** — le trafic est unidirectionnel. SSE offre la
reconnexion automatique, la traversée des proxys, et l'authentification par
cookie sans bricolage.

**Jeton en `localStorage`** — `EventSource` n'accepte pas d'en-tête
`Authorization`. Il aurait fallu passer le jeton en paramètre d'URL, où il finit
dans les journaux du serveur et l'historique du navigateur. Les cookies
httpOnly règlent le problème et protègent en plus contre le vol de session par
XSS.

**PostgreSQL** — légèrement supérieur sur le partitionnement et la géométrie,
mais MySQL correspond aux compétences du client.

**Parseur Codec 8 maison** — réécrire un décodeur de protocole éprouvé pour
remplacer Traccar n'apporterait aucun bénéfice.

**Framework CSS (Tailwind, Bootstrap)** — une dépendance de plus pour un
tableau de bord dont les besoins visuels sont limités.

---

## 10. Compétences nécessaires pour reprendre le projet

Un développeur reprenant ce projet doit maîtriser :

- **TypeScript** — indispensable, c'est tout le code applicatif
- **NestJS** — modules, injection de dépendances, gardes, décorateurs
- **React** — hooks, contexte
- **SQL et notions d'ORM** — TypeORM masque l'essentiel, mais comprendre les
  index reste nécessaire sur la table `positions`
- **Notions réseau** — TCP/UDP, ports, reverse proxy, TLS

Ne sont **pas** nécessaires : Java, Python, développement mobile, ou
connaissance préalable du protocole Teltonika, encapsulé dans un seul fichier
(`traccar.source.ts`).

---

## Documents liés

| Fichier | Contenu |
|---|---|
| `docs/ARCHITECTURE.md` | Documentation technique détaillée |
| `docs/mysql-phpmyadmin.md` | Installation de la base |
| `infra/sql/schema.sql` | Schéma SQL commenté |
| `CLAUDE.md` | Contexte pour assistance IA — invariants et pièges |
