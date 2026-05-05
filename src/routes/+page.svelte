<script lang="ts">
	import { onMount } from 'svelte';

	type Landscape = {
		name: string;
		kind: string;
		location: string;
		description: string | null;
		lon: number | null;
		lat: number | null;
	};

	let current = $state<Landscape | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let lastRollAt = $state<string | null>(null);

	let dbModule: typeof import('$lib/db') | null = null;

	const formatCoord = (value: number | null) =>
		value === null ? '—' : value.toFixed(5);

	const formatTime = (date: Date) =>
		date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

	async function ensureDb() {
		if (!dbModule) {
			dbModule = await import('$lib/db');
			await dbModule.initDb();
		}
		return dbModule;
	}

	async function roll() {
		loading = true;
		error = null;

		try {
			const { getRandomLandscape } = await ensureDb();
			const result = await getRandomLandscape();
			if (!result) {
				throw new Error('データが見つかりませんでした');
			}
			current = result;
			lastRollAt = formatTime(new Date());
		} catch (err) {
			error = err instanceof Error ? err.message : '読み込みに失敗しました';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		roll();
	});
</script>

<main class="page">
	<section class="hero">
		<p class="eyebrow">GSI GeoJSON × DuckDB Spatial</p>
		<h1>日本の地形ガチャ</h1>
		<p class="lead">基準点データからランダムに1件を引き当てます。</p>
	</section>

	<section class="panel">
		<div class="panel-head">
			<button class="roll" onclick={roll} disabled={loading}>
				{loading ? '読み込み中…' : 'ガチャを回す'}
			</button>
			{#if lastRollAt}
				<p class="timestamp">更新 {lastRollAt}</p>
			{/if}
		</div>

		{#if error}
			<div class="card error">
				<p>{error}</p>
			</div>
		{:else if loading}
			<div class="card skeleton">
				<div class="line"></div>
				<div class="line"></div>
				<div class="line"></div>
				<div class="line"></div>
			</div>
		{:else if current}
			<div class="card">
				<div class="row">
					<span class="label">名前</span>
					<span class="value">{current.name}</span>
				</div>
				<div class="row">
					<span class="label">種類</span>
					<span class="value">{current.kind}</span>
				</div>
				<div class="row">
					<span class="label">場所</span>
					<span class="value">{current.location}</span>
				</div>
				<div class="row">
					<span class="label">説明</span>
					<span class="value">{current.description ?? '—'}</span>
				</div>
				<div class="row">
					<span class="label">座標</span>
					<span class="value">
						緯度 {formatCoord(current.lat)} / 経度 {formatCoord(current.lon)}
					</span>
				</div>
			</div>
		{/if}
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: 'Hiragino Mincho ProN', 'Yu Mincho', 'MS Mincho', serif;
		background: radial-gradient(circle at top, #fff4e0 0%, #f3e9db 45%, #eadcc8 100%);
		color: #2b2016;
	}

	.page {
		min-height: 100vh;
		display: grid;
		grid-template-rows: auto 1fr;
		gap: 2rem;
		padding: 3.5rem clamp(1.5rem, 4vw, 5rem) 4rem;
		background-image: radial-gradient(circle at 10% 20%, rgba(255, 255, 255, 0.6), transparent 40%),
			radial-gradient(circle at 80% 0%, rgba(255, 227, 196, 0.6), transparent 45%);
	}

	.hero {
		max-width: 720px;
	}

	.eyebrow {
		letter-spacing: 0.25em;
		text-transform: uppercase;
		font-size: 0.75rem;
		color: #7a5c3a;
		margin-bottom: 0.5rem;
	}

	h1 {
		font-size: clamp(2.3rem, 4vw, 3.4rem);
		margin: 0 0 0.75rem;
	}

	.lead {
		font-size: 1.05rem;
		line-height: 1.7;
		color: #4a3523;
	}

	.panel {
		background: rgba(255, 255, 255, 0.7);
		border-radius: 24px;
		padding: 2rem;
		box-shadow: 0 28px 60px rgba(66, 44, 20, 0.18);
		backdrop-filter: blur(6px);
	}

	.panel-head {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.roll {
		border: none;
		border-radius: 999px;
		padding: 0.9rem 2rem;
		font-size: 1rem;
		font-weight: 600;
		background: linear-gradient(120deg, #1f140b, #4c2b10);
		color: #f9efe3;
		cursor: pointer;
		transition: transform 0.2s ease, box-shadow 0.2s ease;
	}

	.roll:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.roll:not(:disabled):hover {
		transform: translateY(-2px);
		box-shadow: 0 12px 24px rgba(58, 37, 16, 0.3);
	}

	.timestamp {
		font-size: 0.85rem;
		color: #6e4f33;
	}

	.card {
		background: #fffaf2;
		border-radius: 18px;
		padding: 1.5rem;
		display: grid;
		gap: 1rem;
		animation: float-in 0.4s ease;
	}

	.card.error {
		background: #ffe4db;
		color: #7b2e20;
		font-weight: 600;
	}

	.row {
		display: grid;
		grid-template-columns: 80px 1fr;
		gap: 1rem;
		align-items: baseline;
		border-bottom: 1px solid rgba(115, 85, 51, 0.15);
		padding-bottom: 0.75rem;
	}

	.row:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}

	.label {
		font-size: 0.85rem;
		letter-spacing: 0.1em;
		color: #7a5c3a;
	}

	.value {
		font-size: 1.05rem;
		color: #2b2016;
	}

	.skeleton {
		background: linear-gradient(120deg, #f0e4d6, #f7efe3);
	}

	.skeleton .line {
		height: 14px;
		background: rgba(122, 92, 58, 0.2);
		border-radius: 999px;
		animation: pulse 1.2s ease-in-out infinite;
	}

	.skeleton .line:nth-child(2) {
		width: 80%;
	}

	.skeleton .line:nth-child(3) {
		width: 65%;
	}

	.skeleton .line:nth-child(4) {
		width: 50%;
	}

	@keyframes float-in {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.6;
		}
		50% {
			opacity: 1;
		}
	}

	@media (max-width: 700px) {
		.page {
			padding: 2.5rem 1.5rem 3rem;
		}

		.panel {
			padding: 1.5rem;
		}

		.row {
			grid-template-columns: 1fr;
		}
	}
</style>
