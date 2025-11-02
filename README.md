# Gootu Menu Scraper

Ce projet est un script qui récupère automatiquement le menu du jour du restaurant Gootu depuis leur page Facebook et le poste sur un canal Slack spécifié.

## Fonctionnalités

- Vérifie la page Facebook de Gootu toutes les heures entre 9h et 12h
- Détecte les nouveaux posts contenant le menu du jour
- Extrait l'image du menu
- Poste le menu sur un canal Slack spécifié
- Ne poste qu'une seule fois par jour
- Fonctionne comme un service systemd

## Prérequis

- [devenv](https://devenv.sh/)
- Un bot Slack avec les permissions suivantes :
  - `channels:read` : Voir les informations de base sur les canaux publics
  - `chat:write` : Envoyer des messages en tant que bot
  - `files:write` : Uploader, éditer et supprimer des fichiers
  - `groups:read` : Voir les informations de base sur les canaux privés où le bot est invité
  - `im:read` : Voir les informations de base sur les messages directs
  - `mpim:read` : Voir les informations de base sur les messages de groupe
- Le bot doit être invité dans le canal où vous souhaitez poster les menus

## Installation

1. Cloner le repository :
```bash
git clone https://github.com/loicbourg/gootu-scrapper.git
cd gootu-scrapper
```

2. Créer un fichier `.env` avec les informations de configuration Slack :
```
SLACK_TOKEN=xoxb-your-bot-token
SLACK_CHANNEL=your-channel-name
```

3. Installer les dépendances:
```bash
yarn
```

## Configuration du service systemd

1. Copier le fichier de service dans le répertoire systemd :
```bash
sudo cp gootu-menu.service /etc/systemd/system/
```

2. Recharger la configuration systemd :
```bash
sudo systemctl daemon-reload
```

3. Démarrer le service :
```bash
sudo systemctl start gootu-menu
```

4. Activer le service au démarrage :
```bash
sudo systemctl enable gootu-menu
```

## Vérification et logs

Pour vérifier l'état du service :
```bash
sudo systemctl status gootu-menu
```

Pour voir les logs en temps réel :
```bash
journalctl -u gootu-menu -f
```

## Structure du projet

- `main.ts` : Script principal qui gère le scraping et l'envoi sur Slack
- `gootu-menu.service` : Configuration du service systemd
- `.env` : Configuration des variables d'environnement (non versionné)
- `last_post.json` : Fichier de suivi des posts (créé automatiquement)
- `images/` : Dossier temporaire pour le traitement des images (créé automatiquement)

## Fonctionnement

Le script :
1. Vérifie la page Facebook de Gootu toutes les heures entre 9h et 12h
2. Recherche les posts contenant le menu du jour
3. Extrait l'image du menu si trouvée
4. Télécharge temporairement l'image
5. Poste l'image sur le canal Slack spécifié
6. Enregistre la date du post pour éviter les doublons
7. Nettoie les fichiers temporaires

## Dépannage

### Le menu n'est pas posté

1. Vérifier les logs du service :
```bash
journalctl -u gootu-menu -n 50
```

2. Vérifier que le bot a les bonnes permissions sur Slack

3. Vérifier que le fichier `.env` est correctement configuré

4. Vérifier que le bot est bien invité dans le canal Slack

### Le service ne démarre pas

1. Vérifier les chemins dans le fichier `gootu-menu.service`
2. Vérifier les logs systemd pour plus de détails :
```bash
journalctl -u gootu-menu -n 50
```

## Licence

MIT