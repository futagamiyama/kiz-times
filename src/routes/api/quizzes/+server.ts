import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { answerTimes } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

const MIN_FACTOR = 2;
const MAX_FACTOR = 9;
// Weight assigned to multiplications we have no data for yet — same as the
// quiz timeout, so unseen problems are prioritised as "weakest".
const UNSEEN_WEIGHT = 10;
const DEFAULT_COUNT = 10;
const MAX_COUNT = (MAX_FACTOR - MIN_FACTOR + 1) ** 2; // 64

// Efraimidis–Spirakis weighted reservoir: for each item generate
// key = u^(1/w) with u ~ Uniform(0,1), then take the n items with the
// largest keys. This is sampling-without-replacement with probability
// proportional to weight.
function weightedSampleWithoutReplacement<T>(items: T[], weights: number[], n: number): T[] {
	const keyed = items.map((item, i) => {
		const w = Math.max(weights[i], 1e-9);
		const u = Math.random();
		return { item, key: Math.log(u) / w };
	});
	// Largest key wins. Using log(u)/w (always ≤ 0) is numerically more stable
	// than u^(1/w) when weights span a wide range, and ranks identically.
	keyed.sort((a, b) => b.key - a.key);
	return keyed.slice(0, n).map((k) => k.item);
}

export const GET: RequestHandler = async ({ url }) => {
	const raw = Number(url.searchParams.get('count'));
	const requested = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_COUNT;
	const n = Math.min(MAX_COUNT, Math.max(1, requested));

	// Full multiplication table (a, b) ∈ [MIN..MAX]²
	const all: { a: number; b: number }[] = [];
	for (let a = MIN_FACTOR; a <= MAX_FACTOR; a++) {
		for (let b = MIN_FACTOR; b <= MAX_FACTOR; b++) {
			all.push({ a, b });
		}
	}

	// Lookup avg_answer_time for facts we have data for.
	const rows = await db.select().from(answerTimes);
	const lookup = new Map<string, number>();
	for (const r of rows) {
		lookup.set(`${r.a}x${r.b}`, r.avgAnswerTime);
	}

	// Weight = avg time for known facts, UNSEEN_WEIGHT for unseen.
	const weights = all.map((q) => lookup.get(`${q.a}x${q.b}`) ?? UNSEEN_WEIGHT);

	const picked = weightedSampleWithoutReplacement(all, weights, n);
	return json(picked);
};
