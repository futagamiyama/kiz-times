import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

let instance: LibSQLDatabase<typeof schema> | undefined;

function getDb(): LibSQLDatabase<typeof schema> {
	if (instance) return instance;
	if (!env.TURSO_DATABASE_URL) throw new Error('TURSO_DATABASE_URL is not set');
	const client = createClient({
		url: env.TURSO_DATABASE_URL,
		authToken: env.TURSO_AUTH_TOKEN
	});
	instance = drizzle(client, { schema });
	return instance;
}

export const db = new Proxy({} as LibSQLDatabase<typeof schema>, {
	get(_target, prop, receiver) {
		const value = Reflect.get(getDb(), prop, receiver);
		return typeof value === 'function' ? value.bind(getDb()) : value;
	}
});
