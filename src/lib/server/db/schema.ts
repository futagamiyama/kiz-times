import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const task = sqliteTable('task', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	title: text('title').notNull(),
	priority: integer('priority').notNull().default(1)
});

export const answerTimes = sqliteTable(
	'answer_times',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		a: integer('a').notNull(),
		b: integer('b').notNull(),
		answerTime: real('answer_time').notNull(),
		avgAnswerTime: real('avg_answer_time').notNull().default(0),
		tries: integer('tries').notNull().default(0),
		updated: integer('updated', { mode: 'timestamp' }).notNull()
	},
	(t) => [uniqueIndex('uniq_a_b').on(t.a, t.b)]
);
