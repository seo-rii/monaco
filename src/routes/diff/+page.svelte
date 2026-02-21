<script lang="ts">
	import { MonacoDiff } from '$lib';
	import type { IMonacoDiffProviderResult } from '$lib';

	const models: any = {};

	let fileId = 'sample.ts';
	let language = 'typescript';
	let revision = 1;
	let readonly = false;

	let originalCode = `function sum(a, b) {
	return a + b;
}

console.log(sum(1, 2));`;

	let modifiedCode = `function sum(a: number, b: number): number {
	return a + b;
}

console.log(sum(1, 3));`;

	let diffCount = 0;
	let lastInput = '-';
	let lastCursor = '-';
	let focusState = '-';

	$: active = `${fileId}@${revision}`;

	const provider: (id: string) => Promise<IMonacoDiffProviderResult> = async (id: string) => {
		const original: [string, string, string] = [
			originalCode,
			language,
			`inmemory://diff/${encodeURIComponent(id)}/original.${language}`
		];
		const modified: [string, string, string] = [
			modifiedCode,
			language,
			`inmemory://diff/${encodeURIComponent(id)}/modified.${language}`
		];
		return { original, modified };
	};

	function reloadDiff() {
		revision += 1;
	}
</script>

<main>
	<h1>MonacoDiff Demo</h1>
	<p>
		`Apply`를 누르면 현재 입력값으로 새로운 diff model을 만들고, `readonly`를 켜면 수정 편집이
		막힙니다.
	</p>

	<section class="toolbar">
		<label>
			File ID
			<input bind:value={fileId} />
		</label>
		<label>
			Language
			<input bind:value={language} />
		</label>
		<label class="toggle">
			<input type="checkbox" bind:checked={readonly} />
			readonly
		</label>
		<button onclick={reloadDiff}>Apply</button>
	</section>

	<section class="inputs">
		<div>
			<h2>Original</h2>
			<textarea bind:value={originalCode}></textarea>
		</div>
		<div>
			<h2>Modified</h2>
			<textarea bind:value={modifiedCode}></textarea>
		</div>
	</section>

	<section class="status">
		<div><strong>active</strong>: {active}</div>
		<div><strong>lineChanges</strong>: {diffCount}</div>
		<div><strong>lastInput</strong>: {lastInput}</div>
		<div><strong>lastCursor</strong>: {lastCursor}</div>
		<div><strong>focus</strong>: {focusState}</div>
	</section>

	<div class="diff">
		<MonacoDiff
			{models}
			{active}
			{provider}
			{readonly}
			onupdate={(lineChanges) => (diffCount = lineChanges?.length ?? 0)}
			oninput={(event) => {
				lastInput = `${event.side}:${event.reason} (${event.value.length} chars)`;
			}}
			oncursor={(event) => {
				lastCursor = `${event.side}:L${event.position.lineNumber}:C${event.position.column}`;
			}}
			onfocus={(event) => {
				focusState = `focus:${event.side}`;
			}}
			onblur={(event) => {
				focusState = `blur:${event.side}`;
			}}
			setting={{
				automaticLayout: true,
				renderSideBySide: true,
				originalEditable: false,
				minimap: { enabled: false },
				renderWhitespace: 'all',
				fontLigatures: true
			}}
		>
			<div class="fallback">Loading MonacoDiff...</div>
		</MonacoDiff>
	</div>
</main>

<style>
	:global(html, body, body > div) {
		margin: 0;
		padding: 0;
		height: 100%;
	}

	main {
		height: 100%;
		display: grid;
		gap: 12px;
		padding: 12px;
		box-sizing: border-box;
		grid-template-rows: auto auto auto auto minmax(320px, 1fr);
	}

	h1,
	h2,
	p {
		margin: 0;
	}

	.toolbar {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}

	.toolbar label {
		display: flex;
		gap: 6px;
		align-items: center;
	}

	.toolbar input {
		padding: 4px 8px;
	}

	.toolbar button {
		padding: 6px 12px;
	}

	.inputs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		min-height: 180px;
	}

	.inputs > div {
		display: grid;
		gap: 6px;
	}

	textarea {
		width: 100%;
		height: 180px;
		resize: vertical;
		font-family: 'JetBrains Mono', monospace;
		padding: 8px;
		box-sizing: border-box;
	}

	.status {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		font-family: monospace;
	}

	.diff {
		min-height: 320px;
		height: 100%;
		border: 1px solid #ccc;
	}

	.fallback {
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	@media (max-width: 900px) {
		main {
			grid-template-rows: auto auto auto auto minmax(280px, 1fr);
		}

		.inputs {
			grid-template-columns: 1fr;
		}

		textarea {
			height: 140px;
		}
	}
</style>
