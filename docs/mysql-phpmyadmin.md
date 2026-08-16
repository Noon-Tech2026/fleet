# Intégration de l'authentification avec MySQL et phpMyAdmin

Guide pas à pas pour brancher l'API sur une base MySQL administrée via phpMyAdmin.

---

## Ce qu'il faut comprendre d'abord

**phpMyAdmin n'est pas une base de données.** C'est une interface web écrite en PHP qui se connecte à un serveur MySQL. L'API, elle, se connecte au **même serveur MySQL**, directement, sans passer par phpMyAdmin.

```
                    ┌──────────────┐
                    │  Serveur     │
   phpMyAdmin ────► │  MySQL       │ ◄──── API NestJS
   (port 8081)      │  (port 3306) │       (port 3000)
                    └──────────────┘
```

Conséquence pratique : **aucune ligne de code ne change**. phpMyAdmin sert à *regarder* et *administrer* la base ; l'application, elle, y écrit toute seule.

---

## Étape 1 — Choisir votre serveur MySQL

Trois situations possibles sur Mac. Prenez celle qui correspond à ce que vous avez déjà.

### Option A — Docker (recommandée)

Tout est déjà configuré dans `docker-compose.yml` :

```bash
cd ~/Projets/fleet

# Créer le fichier d'environnement de Docker Compose
cat > .env << 'EOF'
DB_PASSWORD=UnMotDePasseSolide2026
DB_ROOT_PASSWORD=UnAutreMotDePasseRoot2026
JWT_SECRET=
EOF

# Générer le secret JWT et l'insérer
echo "JWT_SECRET=$(openssl rand -base64 48)" >> .env

# Démarrer MySQL + phpMyAdmin
docker compose --profile tools up -d mysql phpmyadmin
```

phpMyAdmin est alors sur **http://localhost:8081** — identifiants `fleet` / le `DB_PASSWORD` choisi.

La base `fleet` et l'utilisateur `fleet` sont créés automatiquement par l'image MySQL. Passez à l'étape 3.

### Option B — MAMP

MAMP est déjà installé chez beaucoup de développeurs PHP. Démarrez les serveurs depuis l'application, puis notez ce détail qui fait perdre du temps à tout le monde :

**MAMP écoute sur le port 8889, pas 3306.** L'identifiant par défaut est `root` / `root`.

phpMyAdmin est accessible depuis la page de démarrage de MAMP, ou sur `http://localhost:8888/phpMyAdmin`.

### Option C — XAMPP

Démarrez MySQL depuis le panneau de contrôle. Port **3306**, utilisateur `root` **sans mot de passe** par défaut.

Ce mot de passe vide est acceptable en local, mais devient inadmissible dès que la machine est accessible depuis un réseau.

---

## Étape 2 — Créer la base et l'utilisateur (options B et C)

Avec Docker, sautez cette étape : c'est déjà fait.

Ouvrez phpMyAdmin, onglet **SQL**, et exécutez :

```sql
CREATE DATABASE IF NOT EXISTS fleet
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'fleet'@'localhost'
  IDENTIFIED BY 'UnMotDePasseSolide2026';

GRANT ALL PRIVILEGES ON fleet.* TO 'fleet'@'localhost';
FLUSH PRIVILEGES;
```

Deux choses méritent une explication.

**`utf8mb4`** et non `utf8`. Le jeu `utf8` de MySQL est tronqué à 3 octets et ne stocke ni les emojis, ni certains caractères. Les noms de chauffeurs et les motifs d'immobilisation passeront par cette base : autant que tout soit stockable.

**Un utilisateur dédié** plutôt que `root`. Si l'API est compromise, l'attaquant n'a accès qu'à la base `fleet`, pas à l'ensemble du serveur MySQL.

---

## Étape 3 — Configurer l'API

```bash
cd ~/Projets/fleet/backend
cp .env.example .env
```

Ouvrez `.env` et renseignez la section base de données selon votre option :

| | Docker | MAMP | XAMPP |
|---|---|---|---|
| `DB_HOST` | `127.0.0.1` | `127.0.0.1` | `127.0.0.1` |
| `DB_PORT` | `3306` | **`8889`** | `3306` |
| `DB_USER` | `fleet` | `root` | `root` |
| `DB_PASSWORD` | votre `DB_PASSWORD` | `root` | *(vide)* |
| `DB_NAME` | `fleet` | `fleet` | `fleet` |

Utilisez `127.0.0.1` plutôt que `localhost`. Sur Mac, `localhost` peut être résolu en IPv6 (`::1`) alors que MySQL n'écoute qu'en IPv4 — ça produit un `ECONNREFUSED` déroutant alors que le serveur tourne parfaitement.

Générez ensuite le secret de signature des jetons :

```bash
openssl rand -base64 48
```

Collez le résultat dans `JWT_SECRET`. Ce secret signe les jetons de session : le changer déconnecte tout le monde, le partager permet à quiconque de fabriquer un jeton d'administrateur.

---

## Étape 4 — Créer les tables et le premier compte

```bash
npm install
npm run seed
```

Le script fait deux choses : il crée les tables si elles n'existent pas, puis le compte administrateur. Sortie attendue :

```
  Compte administrateur cree
  ---------------------------------------------
  Email        : admin@fleet.local
  Mot de passe : rK3nP8vQ2mXt
  ---------------------------------------------

  Notez-le maintenant : il ne sera plus affiche.
```

Si vous préférez créer les tables vous-même, importez `infra/sql/schema.sql` depuis l'onglet **Importer** de phpMyAdmin avant de lancer le seed.

---

## Étape 5 — Vérifier dans phpMyAdmin

Rafraîchissez phpMyAdmin et ouvrez la base `fleet`. Vous devez voir trois tables :

| Table | Contenu |
|---|---|
| `users` | Les comptes |
| `refresh_sessions` | Les sessions ouvertes |
| `command_logs` | Le journal d'audit des commandes moteur |

Ouvrez `users` et regardez la colonne `password_hash`. Elle doit commencer par **`$2a$12$`** suivi d'une longue chaîne :

```
$2a$12$QW0/oNqZhYg1ZJrKs3...
```

C'est un hash bcrypt à 12 tours. Si vous voyez le mot de passe en clair, ou une chaîne courte de 32 caractères hexadécimaux (ce serait du MD5), quelque chose ne va pas — arrêtez-vous et vérifiez.

---

## Étape 6 — Lancer et tester

```bash
# Terminal 1
cd ~/Projets/fleet/backend
npm run start:dev

# Terminal 2
cd ~/Projets/fleet/frontend
npm install
npm run dev
```

Ouvrez **http://localhost:5173**. L'écran de connexion doit apparaître. Connectez-vous avec le compte du seed.

Vérifiez ensuite dans phpMyAdmin :

- `users` → la colonne `last_login_at` s'est remplie ;
- `refresh_sessions` → une ligne est apparue, avec un `token_hash` et votre `user_agent`.

Cliquez sur « Se déconnecter », puis rafraîchissez `refresh_sessions` : la colonne `revoked_at` de cette ligne est maintenant datée. La session est fermée côté serveur, pas seulement dans le navigateur.

---

## Le piège à ne pas tomber dedans

> **Ne créez jamais un utilisateur directement depuis phpMyAdmin.**

C'est tentant : la table est là, le bouton « Insérer » aussi. Mais la colonne `password_hash` attend un hash bcrypt. Un mot de passe saisi en clair produira un compte qui **ne pourra jamais se connecter**, sans message d'erreur explicite — la comparaison bcrypt échouera simplement, et vous chercherez longtemps.

Pour créer un compte, deux voies correctes :

**Depuis l'interface**, connecté en administrateur — c'est la voie normale.

**En ligne de commande** :

```bash
curl -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{
    "email": "superviseur@fleet.local",
    "password": "MotDePasseDuSuperviseur2026",
    "fullName": "M. Belkacem",
    "role": "supervisor"
  }'
```

(Il faut d'abord se connecter avec `curl -c cookies.txt -X POST .../api/auth/login` pour obtenir la session.)

---

## Ce que phpMyAdmin sert vraiment à faire ici

phpMyAdmin est excellent pour **lire** et pour les opérations d'urgence. Quelques requêtes utiles à garder sous la main.

**Qui a immobilisé quoi, et quand :**

```sql
SELECT created_at, vehicle_id, action, actor_email, applied,
       speed_at_request, ignition_at_request, reason
FROM command_logs
ORDER BY created_at DESC
LIMIT 50;
```

**Les sessions actuellement ouvertes :**

```sql
SELECT u.email, u.role, s.created_at, s.expires_at, s.ip_address
FROM refresh_sessions s
JOIN users u ON u.id = s.user_id
WHERE s.revoked_at IS NULL AND s.expires_at > NOW()
ORDER BY s.created_at DESC;
```

**Urgence — couper toutes les sessions d'un utilisateur :**

```sql
UPDATE refresh_sessions
SET revoked_at = NOW()
WHERE user_id = (SELECT id FROM users WHERE email = 'compte@compromis.fr')
  AND revoked_at IS NULL;

UPDATE users SET active = 0 WHERE email = 'compte@compromis.fr';
```

La deuxième requête compte autant que la première : le jeton d'accès reste valide jusqu'à 15 minutes après la révocation du jeton de rafraîchissement, mais le garde revalide `active` en base à chaque requête. Désactiver le compte coupe l'accès dans la seconde.

**Récupérer un accès administrateur perdu :**

```sql
UPDATE users SET role = 'admin', active = 1 WHERE email = 'votre@email.fr';
```

C'est le seul cas où modifier la table `users` à la main se justifie — parce que le rôle, contrairement au mot de passe, est une valeur simple.

---

## Sur le VPS de production

Trois règles, dans l'ordre d'importance.

**Ne jamais exposer phpMyAdmin sur Internet.** C'est une cible d'attaques automatisées permanente. Dans `docker-compose.yml`, le port est déjà lié à `127.0.0.1` — il n'est joignable que depuis la machine elle-même. Pour y accéder à distance, passez par un tunnel SSH :

```bash
ssh -L 8081:localhost:8081 utilisateur@votre-vps
```

Puis ouvrez `http://localhost:8081` sur votre Mac. Le trafic passe chiffré dans le tunnel SSH, et rien n'est ouvert au monde extérieur.

**Désactiver `synchronize`.** Avec `NODE_ENV=production`, TypeORM cesse de modifier le schéma tout seul. C'est déjà le comportement configuré, mais vérifiez que la variable est bien positionnée : une modification d'entité pourrait sinon supprimer une colonne et ses données.

**Sauvegarder.** La table `command_logs` est votre trace légale en cas de litige sur une immobilisation :

```bash
docker compose exec mysql \
  mysqldump -u fleet -p fleet > sauvegarde-$(date +%F).sql
```

---

## En cas de blocage

**`ECONNREFUSED 127.0.0.1:3306`** — le serveur MySQL ne tourne pas, ou pas sur ce port. Avec MAMP, c'est presque toujours le port : essayez `8889`.

**`ER_ACCESS_DENIED_ERROR`** — mauvais identifiants, ou l'utilisateur n'a pas le droit de se connecter depuis cet hôte. Vérifiez dans phpMyAdmin, onglet **Comptes utilisateurs**, que `fleet` existe bien avec le bon nom d'hôte (`localhost` ou `%`).

**`ER_BAD_DB_ERROR: Unknown database 'fleet'`** — la base n'a pas été créée. Retournez à l'étape 2.

**Les tables n'apparaissent pas** — l'API ne les crée qu'au démarrage, et seulement si `NODE_ENV` n'est pas `production`. Lancez `npm run seed`, qui les crée dans tous les cas.

**« Identifiants invalides » alors que le mot de passe est bon** — regardez `password_hash` dans phpMyAdmin. S'il ne commence pas par `$2a$` ou `$2b$`, le compte a probablement été créé à la main. Supprimez la ligne et recréez le compte via l'API.
