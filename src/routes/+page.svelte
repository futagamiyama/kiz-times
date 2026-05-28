<script lang="ts">
	import { tick } from 'svelte';

	type Status = 'memorized' | 'vague' | 'wrong';
	type Quiz = { a: number; b: number };
	type Result = Quiz & { status: Status; userAnswer: number | null; time: number };
	type Phase = 'idle' | 'playing' | 'feedback' | 'finished';

	const DEFAULT_QUESTION_COUNT = 10;
	const TIME_LIMIT = 5; // seconds — fixed
	const MEMORIZED_LIMIT = TIME_LIMIT;
	const ANSWER_LIMIT = TIME_LIMIT * 2;
	const FEEDBACK_MS = 1400;

	function randInt(min: number, max: number) {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}

	function randomQuizzes(n: number): Quiz[] {
		return Array.from({ length: n }, () => ({ a: randInt(2, 9), b: randInt(2, 9) }));
	}

	async function generateQuizzes(n: number): Promise<Quiz[]> {
		try {
			const res = await fetch(`/api/quizzes?count=${n}`);
			if (res.ok) {
				const data = (await res.json()) as Quiz[];
				if (Array.isArray(data) && data.length > 0) return data.slice(0, n);
			}
		} catch (e) {
			console.warn('weighted quiz fetch failed; using random fallback', e);
		}
		return randomQuizzes(n);
	}

	let questionCount = $state(DEFAULT_QUESTION_COUNT);
	let resetting = $state(false);
	let loadingQuizzes = $state(false);

	let phase = $state<Phase>('idle');
	let quizzes = $state<Quiz[]>([]);
	let currentIndex = $state(0);
	let input = $state('');
	let results = $state<Result[]>([]);
	let elapsed = $state(0);
	let feedbackStatus = $state<Status | null>(null);
	let round = $state(1);
	let inputEl = $state<HTMLInputElement | null>(null);

	let rafId: number | null = null;
	let feedbackTimer: ReturnType<typeof setTimeout> | null = null;
	let startTime = 0;

	const current = $derived(quizzes[currentIndex]);
	const correctAnswer = $derived(current ? current.a * current.b : 0);
	const retryCount = $derived(results.filter((r) => r.status !== 'memorized').length);

	function updateTimer() {
		if (phase !== 'playing') return;
		elapsed = (performance.now() - startTime) / 1000;
		if (elapsed >= ANSWER_LIMIT) {
			elapsed = ANSWER_LIMIT;
			submitResult('wrong', null);
			return;
		}
		rafId = requestAnimationFrame(updateTimer);
	}

	async function startQuestion() {
		input = '';
		feedbackStatus = null;
		elapsed = 0;
		phase = 'playing';
		startTime = performance.now();
		rafId = requestAnimationFrame(updateTimer);
		await tick();
		inputEl?.focus();
	}

	async function start() {
		if (loadingQuizzes) return;
		const n = Math.max(1, Math.floor(Number(questionCount) || DEFAULT_QUESTION_COUNT));
		questionCount = n;
		loadingQuizzes = true;
		try {
			quizzes = await generateQuizzes(n);
		} finally {
			loadingQuizzes = false;
		}
		round = 1;
		currentIndex = 0;
		results = [];
		startQuestion();
	}

	async function recordAnswerTime(a: number, b: number, answerTime: number) {
		try {
			await fetch('/api/answertimes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ a, b, answerTime })
			});
		} catch (e) {
			console.warn('recordAnswerTime failed', e);
		}
	}

	function submitResult(status: Status, userAns: number | null) {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		const q = current;
		const time = elapsed;
		results = [...results, { a: q.a, b: q.b, status, userAnswer: userAns, time }];
		feedbackStatus = status;
		phase = 'feedback';
		if (round === 1) {
			const recordedTime = status === 'wrong' ? ANSWER_LIMIT : time;
			void recordAnswerTime(q.a, q.b, recordedTime);
		}
		feedbackTimer = setTimeout(() => {
			feedbackTimer = null;
			if (currentIndex + 1 >= quizzes.length) {
				phase = 'finished';
			} else {
				currentIndex++;
				startQuestion();
			}
		}, FEEDBACK_MS);
	}

	function handleSubmit() {
		if (phase !== 'playing') return;
		const trimmed = input.trim();
		if (trimmed === '') return;
		const userAns = Number(trimmed);
		if (!Number.isInteger(userAns)) return;
		if (userAns === correctAnswer) {
			submitResult(elapsed < MEMORIZED_LIMIT ? 'memorized' : 'vague', userAns);
		} else {
			submitResult('wrong', userAns);
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleSubmit();
		}
	}

	function retry() {
		const retryList = results.filter((r) => r.status !== 'memorized').map(({ a, b }) => ({ a, b }));
		if (retryList.length === 0) return;
		quizzes = retryList;
		round++;
		currentIndex = 0;
		results = [];
		startQuestion();
	}

	async function practiceAgain() {
		if (rafId !== null) cancelAnimationFrame(rafId);
		if (feedbackTimer !== null) clearTimeout(feedbackTimer);
		await start();
	}

	function handleGlobalKeydown(e: KeyboardEvent) {
		if (phase === 'finished' && e.key === 'Enter') {
			e.preventDefault();
			if (retryCount > 0) {
				retry();
			} else {
				void practiceAgain();
			}
		}
	}

	async function resetDatabase() {
		if (resetting) return;
		const ok = confirm('データベースを ぜんぶ リセットします。よろしいですか？');
		if (!ok) return;
		resetting = true;
		try {
			const res = await fetch('/api/answertimes', { method: 'DELETE' });
			if (!res.ok) {
				alert('リセットに しっぱいしました');
				return;
			}
			alert('リセットしました');
		} catch (e) {
			console.warn('resetDatabase failed', e);
			alert('リセットに しっぱいしました');
		} finally {
			resetting = false;
		}
	}

	function statusLabel(s: Status) {
		if (s === 'memorized') return '○ おぼえてる';
		if (s === 'vague') return '△ うろおぼえ';
		return '× まちがい';
	}

	function statusColor(s: Status) {
		if (s === 'memorized') return 'border-green-300 bg-green-50 text-green-700';
		if (s === 'vague') return 'border-yellow-300 bg-yellow-50 text-yellow-700';
		return 'border-red-300 bg-red-50 text-red-700';
	}
</script>

<svelte:head>
	<title>かけ算れんしゅう</title>
</svelte:head>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="min-h-screen bg-gradient-to-b from-sky-50 to-indigo-100 p-4">
	<div class="mx-auto max-w-2xl">
		<h1 class="my-6 text-center text-4xl font-bold text-indigo-700">かけ算れんしゅう</h1>

		{#if phase === 'idle'}
			<div class="rounded-3xl bg-white p-8 shadow-xl">
				<div class="mb-8 space-y-6">
					<div>
						<label for="qcount" class="mb-2 block text-lg font-bold text-gray-700">
							もんだいの かず
						</label>
						<input
							id="qcount"
							type="number"
							min="1"
							max="50"
							step="1"
							bind:value={questionCount}
							class="w-full rounded-xl border-2 border-indigo-200 p-3 text-center text-3xl font-bold text-indigo-700 outline-none focus:border-indigo-500"
						/>
					</div>
					<p class="text-center text-sm text-gray-500">
						せいげんじかん：{MEMORIZED_LIMIT} びょういないで かいとう ／ {ANSWER_LIMIT}
						びょうで タイムアウト
					</p>
				</div>
				<button
					onclick={start}
					disabled={loadingQuizzes}
					class="mb-6 block w-full rounded-2xl bg-indigo-600 py-5 text-3xl font-bold text-white shadow-lg transition hover:bg-indigo-700 active:scale-95 disabled:opacity-60"
				>
					{loadingQuizzes ? 'よみこみちゅう…' : 'スタート'}
				</button>
				<div class="border-t border-gray-200 pt-4">
					<button
						onclick={resetDatabase}
						disabled={resetting}
						class="block w-full rounded-xl border-2 border-red-300 bg-red-50 py-2 text-sm font-bold text-red-600 transition hover:bg-red-100 active:scale-95 disabled:opacity-50"
					>
						{resetting ? 'リセットちゅう…' : 'データベースを オール リセット'}
					</button>
				</div>
			</div>
		{:else if phase === 'playing' || phase === 'feedback'}
			<div class="rounded-3xl bg-white p-8 shadow-xl">
				<div class="mb-3 flex justify-between text-sm font-semibold text-gray-500">
					<span>もんだい {currentIndex + 1} / {quizzes.length}</span>
				</div>

				<div class="mb-8 text-center text-7xl font-bold tracking-wider text-gray-800">
					{current.a} × {current.b} = ?
				</div>

				<input
					bind:this={inputEl}
					bind:value={input}
					onkeydown={handleKeydown}
					disabled={phase === 'feedback'}
					type="text"
					inputmode="numeric"
					autocomplete="off"
					class="w-full rounded-2xl border-4 border-indigo-200 bg-white p-5 text-center text-5xl font-bold text-indigo-700 outline-none focus:border-indigo-500 disabled:bg-gray-50"
					placeholder="?"
				/>
				<p class="mt-2 text-center text-sm text-gray-500">こたえをかいて Enter</p>

				{#if phase === 'feedback' && feedbackStatus}
					<div class="mt-6 text-center text-3xl font-bold">
						{#if feedbackStatus === 'memorized'}
							<span class="text-green-600">○ おぼえてる！</span>
							<span class="ml-2 text-xl text-green-500">{elapsed.toFixed(2)} 秒</span>
						{:else if feedbackStatus === 'vague'}
							<span class="text-yellow-600">△ うろおぼえ</span>
							<span class="ml-2 text-xl text-yellow-500">{elapsed.toFixed(2)} 秒</span>
						{:else}
							<span class="text-red-600">× せいかいは {correctAnswer}</span>
						{/if}
					</div>
				{/if}
			</div>
		{:else if phase === 'finished'}
			<div class="rounded-3xl bg-white p-8 shadow-xl">
				<h2 class="mb-6 text-center text-3xl font-bold text-indigo-700">
					ラウンド {round} けっか
				</h2>
				<div class="mb-6 space-y-2">
					{#each results as r, i (i)}
						<div
							class="flex items-center justify-between rounded-xl border-2 p-3 {statusColor(
								r.status
							)}"
						>
							<span class="text-xl font-bold">
								{r.a} × {r.b} = {r.a * r.b}
							</span>
							<span class="text-sm font-semibold">
								{statusLabel(r.status)}
								{#if r.status === 'wrong'}
									（{r.userAnswer ?? 'じかんぎれ'}）
								{:else}
									（{r.time.toFixed(2)} 秒）
								{/if}
							</span>
						</div>
					{/each}
				</div>

				{#if retryCount > 0}
					<button
						onclick={retry}
						class="block w-full rounded-2xl bg-orange-500 py-4 text-2xl font-bold text-white shadow-lg transition hover:bg-orange-600 active:scale-95"
					>
						もういちど（{retryCount} もん）（Enter）
					</button>
				{:else}
					<p
						class="mb-3 rounded-xl bg-green-100 py-4 text-center text-2xl font-bold text-green-700"
					>
						ぜんもんおぼえてる！すごい！
					</p>
					<button
						onclick={practiceAgain}
						class="block w-full rounded-2xl bg-indigo-600 py-4 text-xl font-bold text-white shadow-lg transition hover:bg-indigo-700 active:scale-95"
					>
						もういちど れんしゅう する（Enter）
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>
