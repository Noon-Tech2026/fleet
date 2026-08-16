# CLAUDE.md

Contexte du projet pour Claude Code. Lire avant toute modification.

---

## Ce qu'est ce projet

Système auto-hébergé de suivi et de contrôle d'une flotte de tracteurs SHACMAN
F3000. Le client possède ses données, son serveur et ses boîtiers. Aucun SaaS
tiers, aucun abonnement fabricant. Coûts récurrents : SIM et VPS uniquement.

Trois couches :

```
Boîtier FMC650 ──4G──> Traccar ──WebSocket──> API NestJS ──SSE──> Dashboard React
                     (ingestion Codec 8)     (règles métier)     (affichage)
```

Stack : NestJS + TypeScript + TypeORM + MySQL 8 côté serveur, React + TypeScript
+ Vite + MapLibre côté client.

---

## Règle de sécurité — ne jamais contourner

**Le système ne coupe jamais un moteur en marche.** Couper l'alimentation d'un
ensemble de 40 tonnes en roulage supprime la direction assistée et l'assistance
de freinage. Conséquence potentielle : mort.

La seule action autorisée est le blocage du **démarreur**, et uniquement quand
`speed <= 3 && !ignition`. Toute demande émise dans d'autres conditions est mise
en file d'attente et exécutée au prochain arrêt.

Ce contrôle vit dans `backend/src/immobilizer/immobilizer.service.ts`, méthode
`isSafeToBlock()`. Il est **côté serveur par nécessité** : un bouton grisé dans
le navigateur se contourne avec un `curl`.

Ne jamais ajouter de route, de paramètre ou de mode qui permette de forcer
l'envoi immédiat d'un `setdigout` sans passer par cette vérification. Si une
tâche semble le demander, s'arrêter et le signaler plutôt que de l'implémenter.

---

## Commandes

```bash
# Backend (depuis backend/)
npm install
npm run seed          # crée le schéma + admin + flotte de démonstration
npm run start:dev     # http://localhost:3000
npm run build
npm run typecheck

# Frontend (depuis frontend/)
npm install
npm run dev           # http://localhost:5173
npm run build
npm run typecheck

# Base (Docker, optionnel)
docker compose up -d mysql
docker compose --profile tools up -d mysql phpmyadmin   # + phpMyAdmin sur :8081
```

`npm run seed` est **idempotent** : le relancer après chaque ajout d'entité ne
duplique rien et n'écrase rien.

---

## Structure

```
backend/src/
  auth/            authentification, rôles, entités users/sessions/audit
  common/types.ts  contrat de données partagé avec le frontend
  database/        connexion MySQL, liste unique des entités
  events/          bus interne + contrôleur SSE
  fleet/           état courant, répertoire, positions, fiches de départ
  fuel/            calibration des sondes, détection de siphonnage
  geofence/        zones, point-dans-polygone, haversine
  immobilizer/     contrôle du démarreur — voir règle de sécurité
  rules/           moteur de règles métier, alertes
  telemetry/       source abstraite + simulateur + client Traccar
  seed.ts

frontend/src/
  api/             client HTTP, hook SSE
  auth/            contexte d'authentification, page de connexion
  components/      carte, liste, fiche véhicule, jauges, dialogue
  lib/types.ts     miroir de backend/src/common/types.ts
```

---

## Invariants d'architecture

**Le navigateur ne parle jamais à Traccar.** Tout passe par l'API, seul endroit
où les décisions de sécurité sont prises. Ne pas ajouter d'appel direct depuis
le frontend.

**Une seule connexion vers Traccar.** Son WebSocket est lié à une session
utilisateur et supporte mal les connexions multiples. L'API en ouvre une et
rediffuse en SSE à N navigateurs. C'est aussi là que les règles s'exécutent —
une fois, pas une par onglet ouvert.

**`TelemetrySource` est une abstraction, pas un détail.** `SimulatorSource` et
`TraccarSource` implémentent la même interface. Le reste du backend ignore d'où
viennent les données. Ne jamais importer `TraccarSource` ailleurs que dans
`telemetry.module.ts` — cela casserait le développement sans matériel.

**Toute route est protégée par défaut.** `JwtAuthGuard` est appliquée
globalement dans `app.module.ts`. Il faut un `@Public()` explicite pour ouvrir
une route. Protéger route par route finit toujours par laisser un trou.

**Sessions par cookies httpOnly, pas de jeton en `localStorage`.** `EventSource`
n'accepte pas d'en-tête `Authorization` : le cookie est ce qui permet au flux
SSE de s'authentifier. Toute requête frontend doit porter
`credentials: 'include'`.

**Les caches sont volontaires.** `VehiclesService`, `GeofenceService` et
`FuelService` gardent leurs données en mémoire et exposent `reload()`. Ces
services sont appelés à chaque trame de chaque camion : une requête SQL à cet
endroit serait le premier goulot. Toute écriture doit appeler `reload()`.

---

## Rôles

Hiérarchie cumulative : `viewer` < `operator` < `supervisor` < `admin`.

| Rôle | Ajoute |
|---|---|
| `viewer` | carte, fiches, alertes, historique |
| `operator` | confirmer un départ, acquitter une alerte, ouvrir une fiche |
| `supervisor` | bloquer/réautoriser un démarreur, gérer zones et calibrations |
| `admin` | gérer les comptes et le répertoire des véhicules |

Décorateur : `@RequireRole(Role.Supervisor)` sur la méthode ou la classe.

Masquer un bouton dans le frontend est du confort, pas une protection. Le
serveur doit toujours refuser indépendamment.

---

## Conventions

Le code, les commentaires et les messages d'erreur sont **en français** —
l'équipe et le client le sont. Les identifiants restent en anglais.

Les commentaires expliquent **pourquoi**, pas quoi. Un commentaire qui
paraphrase la ligne suivante est du bruit. Les blocs longs sont réservés aux
décisions non évidentes (voir `positions.service.ts`, `immobilizer.service.ts`).

Validation systématique par `class-validator` sur les DTO. `ValidationPipe` est
global avec `whitelist` et `forbidNonWhitelisted`.

Aucun `any` dans le code de production. `strict` est activé.

---

## Pièges connus

**Ne jamais créer un utilisateur directement en SQL.** `password_hash` attend
un hash bcrypt à 12 tours. Un mot de passe en clair produit un compte qui ne
peut jamais se connecter, sans message d'erreur explicite. Passer par
`npm run seed` ou `POST /api/users`.

**`synchronize: true` est actif hors production.** Une modification d'entité
peut supprimer une colonne et ses données. À remplacer par des migrations avant
mise en service.

**La table `positions` grossit vite.** `PositionsService.shouldPersist()` filtre
en amont : changement de contact, transition de zone, déplacement ≥ 60 m, ou
point de contrôle toutes les 3 minutes. Ne pas retirer ce filtre.

**Les calibrations carburant du seed sont fausses.** Linéaires par construction,
alors qu'un réservoir aluminium de 700 L n'a pas une section constante. Elles
permettent de démarrer, pas de facturer.

**`frontend/src/lib/types.ts` est un miroir manuel** de
`backend/src/common/types.ts`. Modifier l'un sans l'autre casse le contrat
silencieusement.

---

## État actuel

Fait : authentification et rôles, persistance MySQL (8 tables), simulateur,
règles métier (geofence, départ non confirmé, siphonnage), immobiliseur avec
audit, flux SSE, dashboard de base.

Reste, par ordre de priorité :

1. **Rate limiting sur `/api/auth/login`** — rien ne freine une attaque par
   force brute aujourd'hui. Trou le plus directement exploitable.
2. **Migrations TypeORM** à la place de `synchronize`.
3. **Écrans frontend** pour zones, calibrations, fiches de départ, historique —
   l'API les expose, aucune interface ne les consomme.
4. **Purge planifiée** de `positions` — `purgeBefore()` existe, rien ne
   l'appelle.
5. **Rapports** — consommation, distance, temps de trajet, incidents.
6. **Validation terrain** sur le camion pilote avant tout déploiement.

---

## Avant de proposer du code

Vérifier que la modification ne contourne pas la règle de sécurité, ne casse pas
l'abstraction `TelemetrySource`, et n'ouvre pas une route sans `@RequireRole`
quand elle écrit quelque chose.

Lancer `npm run typecheck` dans les deux projets avant de considérer une tâche
terminée.
