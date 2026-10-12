// Backends de stockage. Toute la todo list est un seul document JSON :
// - fichier local (développement, usage sur ta machine) ;
// - un item DynamoDB (hébergement AWS), protégé par un numéro de version
//   pour que deux écritures simultanées ne s'écrasent pas.
// Interface : read() -> { db, version } ; write(db, version) lève ConflictError
// si le document a changé depuis la lecture.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class ConflictError extends Error {}

const DEFAULT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'todos.json');

export function fileBackend(path = DEFAULT_PATH) {
  return {
    describe: () => `fichier ${path}`,
    async read() {
      if (!existsSync(path)) return { db: null, version: 0 };
      return { db: JSON.parse(readFileSync(path, 'utf8')), version: 0 };
    },
    async write(db) {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n');
      renameSync(tmp, path);
    },
  };
}

// `client` est un DynamoDBDocumentClient ; injectable pour les tests.
export async function dynamoBackend({ tableName, client }) {
  const { GetCommand, PutCommand } = await import('@aws-sdk/lib-dynamodb');
  if (!client) {
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');
    client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  const Key = { pk: 'todo-list' };

  return {
    describe: () => `DynamoDB ${tableName}`,
    async read() {
      const { Item } = await client.send(new GetCommand({ TableName: tableName, Key, ConsistentRead: true }));
      return Item ? { db: JSON.parse(Item.data), version: Item.version } : { db: null, version: 0 };
    },
    async write(db, version) {
      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: { ...Key, version: version + 1, data: JSON.stringify(db) },
            ConditionExpression: 'attribute_not_exists(pk) OR version = :v',
            ExpressionAttributeValues: { ':v': version },
          }),
        );
      } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') throw new ConflictError('Document modifié entre-temps');
        throw err;
      }
    },
  };
}

// Choisit le backend selon l'environnement : STORAGE=dynamodb + TABLE_NAME, sinon fichier.
export async function backendFromEnv(env = process.env) {
  if (env.STORAGE === 'dynamodb') {
    if (!env.TABLE_NAME) throw new Error('TABLE_NAME est requis avec STORAGE=dynamodb');
    return dynamoBackend({ tableName: env.TABLE_NAME });
  }
  return fileBackend(env.TODO_DATA || DEFAULT_PATH);
}
