import { json } from '@sveltejs/kit';
import { desc } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { answerTimes } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

// Returns multiplication facts ordered by weighted-average answer time DESC —
// i.e. the "weakest" (slowest on average) ones first.
export const GET: RequestHandler = async () => {
	const rows = await db.select().from(answerTimes).orderBy(desc(answerTimes.avgAnswerTime));
	return json(
		rows.map((r, i) => ({
			rank: i + 1,
			question: `${r.a}x${r.b}`,
			a: r.a,
			b: r.b,
			avgAnswerTime: Number(r.avgAnswerTime.toFixed(3)),
			answerTime: r.answerTime,
			try: r.tries,
			updated: r.updated
		}))
	);
};
