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

Les données sont stockées dans `data/todos.json`, qui n'est pas versionné. Tu peux changer l'emplacement avec la variable `TODO_DATA`.

## Utiliser avec Claude Code

Le fichier `.mcp.json` déclare le serveur `todo-list`. Lance `claude` dans ce dossier et accepte le serveur MCP. Tu peux ensuite demander par exemple :

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
