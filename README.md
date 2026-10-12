# Todo list pilotable par Claude

Une todo list simple avec :

- des **catégories** ;
- des **tâches et sous-tâches** imbriquées ;
- des **labels** transversaux (`urgent`, `achat`…) qui permettent de regrouper les tâches de toutes les catégories ;
- un **journal** par tâche, où toi et Claude notez l'avancement ;
- un **serveur MCP** pour que Claude lise et modifie la liste, et exécute les tâches marquées `claude`.

## Démarrer

```bash
npm install
npm start          # http://127.0.0.1:3000
npm test
```

En local, les données sont stockées dans `data/todos.json`, qui n'est pas versionné. Tu peux changer l'emplacement avec la variable `TODO_DATA`.

## Configuration

| Variable | Rôle |
|---|---|
| `APP_PASSWORD` | Protège l'interface et l'API par un mot de passe. Sans elle, le serveur n'écoute que sur `127.0.0.1`. |
| `MCP_TOKEN` | Active l'endpoint MCP distant sur `/mcp/<MCP_TOKEN>`. |
| `STORAGE=dynamodb` + `TABLE_NAME` | Stocke les données dans DynamoDB au lieu du fichier local. |
| `TODO_DATA` | Chemin du fichier JSON local. |
| `PORT`, `HOST` | Adresse d'écoute (par défaut `3000`). |

## Hébergement sur AWS

Architecture : une fonction **Lambda** avec une Function URL publique, et une table **DynamoDB**. Pour un usage personnel, le coût reste dans l'offre gratuite. La table est conservée même si la stack est supprimée, et la restauration à un instant donné (point-in-time recovery) est activée.

Prérequis : la CLI AWS configurée avec des identifiants qui peuvent créer des ressources CloudFormation, Lambda, DynamoDB, IAM et S3.

```bash
# Premier déploiement (région par défaut : eu-west-3, Paris)
APP_PASSWORD='un-mot-de-passe-long' MCP_TOKEN="$(openssl rand -hex 32)" npm run deploy

# Mises à jour : le mot de passe et le jeton déjà configurés sont conservés
npm run deploy
```

Garde le `MCP_TOKEN` en lieu sûr : quiconque connaît l'URL MCP peut lire et modifier ta liste. Le script affiche à la fin l'adresse de l'interface et celle du MCP.

### Connecter Claude (claude.ai, appli mobile)

Dans claude.ai : **Paramètres → Connecteurs → Ajouter un connecteur personnalisé**, puis colle l'URL `https://…lambda-url…/mcp/<MCP_TOKEN>`. La todo list est alors accessible depuis toutes tes conversations, y compris sur mobile.

Pour Claude Code :

```bash
claude mcp add --transport http todo-list https://…lambda-url…/mcp/<MCP_TOKEN>
```

## Utiliser avec Claude Code en local

Le fichier `.mcp.json` déclare le serveur `todo-list` (stdio, données locales). Lance `claude` dans ce dossier et accepte le serveur MCP. Tu peux ensuite demander par exemple :

- « Qu'est-ce que j'ai d'urgent ? »
- « Ajoute "acheter du café" dans Maison avec le label achat. »
- « Lance les missions claude. »

Pour confier une mission à Claude, ajoute le label **`claude`** à une tâche et écris tes instructions dans ses notes. Claude passe la tâche en *en cours*, la découpe en sous-tâches si besoin, rend compte dans le journal, puis la marque *fait*. Le détail du protocole est dans `CLAUDE.md`.

Pour l'utiliser depuis un autre projet, ajoute le serveur avec un chemin absolu :

```bash
claude mcp add todo-list -- node /chemin/vers/app/src/mcp.js
```

## Outils MCP

| Outil | Rôle |
|---|---|
| `list_categories`, `create_category`, `rename_category`, `delete_category` | Catégories |
| `list_labels` | Labels et leur nombre de tâches |
| `list_tasks` | Filtres par catégorie, label, statut, texte |
| `get_task`, `get_category_tree` | Détail et arborescence |
| `create_task`, `update_task`, `delete_task` | Tâches et sous-tâches |
| `add_log` | Compte rendu dans le journal |
