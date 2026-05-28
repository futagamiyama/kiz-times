import { json, error } from '@sveltejs/kit';
import { desc, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { answerTimes } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

// Weight on the newest attempt for the EWMA (荷重平均).
// new_avg = ALPHA * latest + (1 - ALPHA) * old_avg
const ALPHA = 0.5;

export const GET: RequestHandler = async () => {
	const rows = await db.select().from(answerTimes).orderBy(desc(answerTimes.updated));
	return json(
		rows.map((r) => ({
			question: `${r.a}x${r.b}`,
			a: r.a,
			b: r.b,
			answerTime: r.answerTime,
			avgAnswerTime: r.avgAnswerTime,
			try: r.tries,
			updated: r.updated
		}))
	);
};

export const DELETE: RequestHandler = async () => {
	await db.delete(answerTimes);
	return json({ ok: true });
};

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}

	const b = body as { a?: unknown; b?: unknown; answerTime?: unknown };
	const a = Number(b.a);
	const bNum = Number(b.b);
	const answerTime = Number(b.answerTime);

	if (!Number.isInteger(a) || !Number.isInteger(bNum) || !Number.isFinite(answerTime)) {
		throw error(400, 'Invalid payload — require integer a, b and numeric answerTime');
	}

	const now = new Date();

	await db
		.insert(answerTimes)
		.values({ a, b: bNum, answerTime, avgAnswerTime: answerTime, tries: 1, updated: now })
		.onConflictDoUpdate({
			target: [answerTimes.a, answerTimes.b],
			set: {
				answerTime,
				avgAnswerTime: sql`${ALPHA} * ${answerTime} + ${1 - ALPHA} * ${answerTimes.avgAnswerTime}`,
				tries: sql`${answerTimes.tries} + 1`,
				updated: now
			}
		});

	return json({ ok: true });
};
