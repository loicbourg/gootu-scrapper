# Gootu Menu Scraper

Ce projet récupère le menu du jour de Gootu via l'API publique de `api.gootu.fr` et publie un message texte sur Slack.

Le scraping Facebook/Playwright n'est plus utilisé.

## Fonctionnalités

- Interroge l'API Gootu en HTTP simple
- Filtre uniquement les catégories utiles pour Slack:
  - `plats-du-jour`
  - `desserts`
- Inclut aussi les plats `snacking` du jour marqués `en_avant` (ex: quiche) sauf s'ils ressemblent a des burgers/wraps/sandwichs
- Ignore les catégories non pertinentes (`boissons`, `sandwichs`, `salades`), donc les burgers/wraps/sandwichs restent exclus du message Slack
- Ne poste qu'une fois par jour sur Slack
- Exécute une collecte toutes les 15 minutes de 9h à 11h45
- Conserve des snapshots API (JSON) pour debug et tests
- Purge automatiquement les snapshots de plus de 30 jours

## Prérequis

- [devenv](https://devenv.sh/) ou Node.js 22+
- Un bot Slack avec les permissions suivantes:
  - `channels:read`
  - `chat:write`
  - `groups:read`
  - `im:read`
  - `mpim:read`

## Installation

1. Cloner le repository:

```bash
git clone https://github.com/loicbourg/gootu-scrapper.git
cd gootu-scrapper
```

2. Créer le fichier `.env`:

```dotenv
SLACK_TOKEN=xoxb-your-bot-token
SLACK_CHANNEL=your-channel-or-channel-id
```

3. Installer les dépendances:

```bash
yarn
```

## Utilisation

Exécution normale (cron interne):

```bash
node main.ts
```

Exécution forcée (ignore fenêtre horaire):

```bash
node main.ts --force
```

Simulation de date:

```bash
node main.ts --force --date 09/03/2026
```

## Snapshots API

Les snapshots JSON sont stockés sous:

- `snapshots/gootu-api/YYYY-MM-DD/HH-mm/`
- `snapshots/gootu-api/latest/`

Fichiers générés:

- `categories.json`
- `catalog.json`
- `menus.json`
- `menu-plat-du-jour.json`
- `meta.json`

Ces snapshots servent de base pour les tests unitaires d'extraction.

## Configuration systemd

1. Copier le service:

```bash
sudo cp gootu-menu.service /etc/systemd/system/
```

2. Recharger systemd:

```bash
sudo systemctl daemon-reload
```

3. Démarrer/activer:

```bash
sudo systemctl start gootu-menu
sudo systemctl enable gootu-menu
```

## Logs

```bash
sudo systemctl status gootu-menu
journalctl -u gootu-menu -f
```

## Structure

- `main.ts`: orchestration cron, snapshot, et envoi Slack
- `gootu-api.ts`: appels API Gootu + filtrage métier
- `snapshots.ts`: sauvegarde et rétention des snapshots
- `tests/`: tests unitaires extraction et rétention
- `last_post.json`: anti-doublon quotidien

## Licence

MIT
