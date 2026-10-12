# Todo list — consignes pour Claude

Cette application est la todo list de l'utilisateur. Claude y accède via le serveur
MCP `todo-list` : en local par stdio (`.mcp.json`), ou en ligne par HTTP sur
`/mcp/<MCP_TOKEN>`. Ne jamais éditer `data/todos.json` ni la table DynamoDB à la main.

## Modèle

- **Catégorie** : regroupe des tâches (ex. Maison, Travail).
- **Tâche** : `title`, `notes` (contexte / instructions), `labels`, `status` (`todo` | `doing` | `done`),
  `log` (journal horodaté). Une tâche avec `parentId` est une sous-tâche ; elle reste
  dans la catégorie de son parent. L'imbrication peut être profonde.
- **Label** : tag transversal (`urgent`, `achat`…), en minuscules, créé à la volée.

## Missions confiées à Claude

Une tâche portant le label **`claude`** est une mission pour Claude. Quand l'utilisateur
dit « lance les missions », « occupe-toi de mes tâches claude », etc. :

1. `list_tasks` avec `label: "claude"` et `status: "todo"`, puis `get_task` pour lire les notes.
2. Passer la tâche en `doing` avant de commencer.
3. Si la mission est vaste, la découper en sous-tâches (`create_task` avec `parentId`).
4. Rendre compte avec `add_log` : résultat, liens, fichiers produits, ou question bloquante.
5. Passer en `done` seulement si le travail est réellement terminé. En cas de blocage ou de
   question, laisser en `doing` et expliquer dans le journal.

Ne pas supprimer de tâche ou de catégorie sans que l'utilisateur l'ait demandé.

## Développement

- `npm start` : interface web sur http://127.0.0.1:3000
- `npm test` : tests (`node:test`)
- `npm run deploy` : déploiement AWS (`template.yaml`, `scripts/deploy.sh`)

Architecture :
- `src/store.js` : logique métier, asynchrone. Toute la liste est un seul document JSON,
  relu puis réécrit à chaque modification ; l'opération est rejouée en cas d'écriture concurrente.
- `src/backends.js` : stockage, fichier local ou un item DynamoDB versionné (écriture conditionnelle).
- `src/mcp-tools.js` : outils MCP, partagés entre `src/mcp.js` (stdio) et `src/server.js` (HTTP, sans état).
- `src/server.js` : API REST, interface statique, mot de passe (`APP_PASSWORD`), endpoint MCP.
- `src/lambda.js` : adaptateur Lambda, qui relaie chaque événement de la Function URL vers le serveur HTTP.
