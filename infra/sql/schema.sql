-- =============================================================================
-- Schema de reference du systeme de gestion de flotte
-- =============================================================================
--
-- Ce fichier N'EST PAS necessaire au fonctionnement : en developpement,
-- TypeORM cree les tables tout seul au premier demarrage de l'API
-- (option `synchronize`).
--
-- Il sert a deux choses :
--   1. lire le schema sans lancer l'application ;
--   2. creer les tables a la main quand `synchronize` est desactive
--      (ce qui doit etre le cas en production).
--
-- A importer depuis l'onglet « Importer » de phpMyAdmin, base `fleet`.
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- Comptes utilisateurs
-- -----------------------------------------------------------------------------
-- ATTENTION : ne jamais inserer de ligne ici a la main depuis phpMyAdmin.
-- La colonne password_hash attend un hash bcrypt (12 tours). Un mot de passe
-- en clair, en MD5 ou en SHA1 produira un compte qui ne pourra jamais se
-- connecter. Utiliser `npm run seed` ou POST /api/users.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`            CHAR(36)     NOT NULL,
  `email`         VARCHAR(190) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `full_name`     VARCHAR(120) NOT NULL,
  `role`          ENUM('viewer','operator','supervisor','admin') NOT NULL DEFAULT 'viewer',
  `active`        TINYINT(1)   NOT NULL DEFAULT 1,
  `last_login_at` DATETIME     NULL DEFAULT NULL,
  `created_at`    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Sessions ouvertes (jetons de rafraichissement)
-- -----------------------------------------------------------------------------
-- On stocke le HACHE du jeton, jamais le jeton lui-meme : une fuite de la
-- base ne permet pas de rejouer une session.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `refresh_sessions` (
  `id`         CHAR(36)     NOT NULL,
  `user_id`    VARCHAR(36)  NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME     NOT NULL,
  `revoked_at` DATETIME     NULL DEFAULT NULL,
  `user_agent` VARCHAR(255) NULL DEFAULT NULL,
  `ip_address` VARCHAR(64)  NULL DEFAULT NULL,
  `created_at` DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_refresh_user` (`user_id`),
  KEY `idx_refresh_token` (`token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Journal d'audit des commandes moteur
-- -----------------------------------------------------------------------------
-- Table en ecriture seule du point de vue de l'application : aucune route
-- ne permet de la modifier ni de la vider. C'est la seule trace permettant
-- de repondre a « qui a bloque ce camion, quand, et pourquoi ».
--
-- applied = 0 signifie que la commande a ete mise en file d'attente parce que
-- le camion roulait — elle n'a pas ete envoyee au boitier a cet instant.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `command_logs` (
  `id`                  CHAR(36)     NOT NULL,
  `vehicle_id`          VARCHAR(32)  NOT NULL,
  `action`              VARCHAR(32)  NOT NULL,
  `actor_email`         VARCHAR(190) NOT NULL,
  `actor_id`            VARCHAR(36)  NULL DEFAULT NULL,
  `reason`              VARCHAR(255) NOT NULL,
  `applied`             TINYINT(1)   NOT NULL,
  `speed_at_request`    INT          NOT NULL,
  `ignition_at_request` TINYINT(1)   NOT NULL,
  `created_at`          DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_command_vehicle` (`vehicle_id`),
  KEY `idx_command_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Repertoire de la flotte
-- -----------------------------------------------------------------------------
-- La cle primaire est le code d'exploitation (C-01...), pas un UUID : c'est
-- l'identifiant utilise par les chauffeurs, le superviseur, et renvoye par
-- Traccar comme nom de boitier.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `vehicles` (
  `id`                  VARCHAR(32)  NOT NULL,
  `plate`               VARCHAR(32)  NOT NULL,
  `driver`              VARCHAR(120) NOT NULL,
  `imei`                VARCHAR(32)  NOT NULL,
  `model`               VARCHAR(64)  NOT NULL DEFAULT 'SHACMAN F3000',
  `tank_main_capacity`  INT          NOT NULL DEFAULT 700,
  `tank_aux_capacity`   INT          NOT NULL DEFAULT 300,
  `active`              TINYINT(1)   NOT NULL DEFAULT 1,
  `notes`               TEXT         NULL,
  `created_at`          DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`          DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vehicles_imei` (`imei`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Zones geographiques
-- -----------------------------------------------------------------------------
-- Cercle et polygone cohabitent dans une seule table : une zone est toujours
-- l'un ou l'autre, jamais les deux. Deux tables auraient impose une jointure
-- a chaque evaluation de position.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `zones` (
  `id`         CHAR(36)     NOT NULL,
  `name`       VARCHAR(120) NOT NULL,
  `kind`       VARCHAR(16)  NOT NULL,
  `shape`      VARCHAR(16)  NOT NULL,
  `lat`        DOUBLE       NULL,
  `lon`        DOUBLE       NULL,
  `radius`     INT          NULL,
  `points`     JSON         NULL,
  `active`     TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at` DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Historique des positions
-- -----------------------------------------------------------------------------
-- Table appelee a grossir. Deux choix de conception :
--   - cle primaire BIGINT auto-incrementee et non UUID : un UUID aleatoire
--     fragmente l'index InnoDB sur plusieurs millions de lignes ;
--   - index compose (vehicle_id, recorded_at) : sert la requete dominante,
--     « le trajet du camion X entre deux dates ».
-- Toutes les trames ne sont pas conservees, voir PositionsService.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `positions` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `vehicle_id`    VARCHAR(32)  NOT NULL,
  `lat`           DOUBLE       NOT NULL,
  `lon`           DOUBLE       NOT NULL,
  `speed`         SMALLINT     NOT NULL,
  `course`        SMALLINT     NOT NULL,
  `ignition`      TINYINT(1)   NOT NULL,
  `fuel_main`     SMALLINT     NOT NULL,
  `fuel_aux`      SMALLINT     NOT NULL,
  `odometer`      INT          NOT NULL,
  `engine_hours`  INT          NOT NULL,
  `zone_id`       VARCHAR(36)  NULL,
  `kept_because`  VARCHAR(24)  NOT NULL,
  `recorded_at`   DATETIME     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_positions_vehicle_time` (`vehicle_id`, `recorded_at`),
  KEY `idx_positions_recorded` (`recorded_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Courbes de calibration carburant
-- -----------------------------------------------------------------------------
-- Une courbe par reservoir et par camion. Une courbe unique pour la flotte
-- ne tiendrait pas : sondes montees a des hauteurs differentes, et section
-- non constante d'un reservoir aluminium.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `fuel_calibrations` (
  `id`             CHAR(36)     NOT NULL,
  `vehicle_id`     VARCHAR(32)  NOT NULL,
  `tank`           VARCHAR(8)   NOT NULL,
  `capacity`       INT          NOT NULL,
  `points`         JSON         NOT NULL,
  `calibrated_by`  VARCHAR(190) NULL,
  `calibrated_at`  DATETIME     NULL,
  `created_at`     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_calibration_vehicle_tank` (`vehicle_id`, `tank`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Fiches de depart du superviseur
-- -----------------------------------------------------------------------------
-- confirmed_at et departed_at sont volontairement distincts : une sortie sans
-- fiche et une fiche sans appui bouton sont deux anomalies differentes.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `departures` (
  `id`            CHAR(36)     NOT NULL,
  `vehicle_id`    VARCHAR(32)  NOT NULL,
  `driver`        VARCHAR(120) NOT NULL,
  `destination`   VARCHAR(190) NOT NULL,
  `cargo`         VARCHAR(190) NULL,
  `cargo_weight`  INT          NULL,
  `recorded_by`   VARCHAR(190) NOT NULL,
  `confirmed_at`  DATETIME     NULL,
  `departed_at`   DATETIME     NULL,
  `closed_at`     DATETIME     NULL,
  `notes`         TEXT         NULL,
  `created_at`    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_departures_vehicle` (`vehicle_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
