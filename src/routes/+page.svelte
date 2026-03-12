<script lang="ts">
	import Monaco, {
		createLineHighlightDecoration,
		type IMonacoDecoration
	} from '$lib';

	let id = $state('test');
	let lang = $state('python');
	let highlightedLine = $state(4);

	const previewSource = $derived.by(() => {
		if (lang === 'typescript') {
			return `function accumulate(values: number[]) {
	let total = 0;
	for (const value of values) {
		total += value;
	}
	return total;
}

console.log(accumulate([1, 2, 3]));`;
		}
		return `def accumulate(values):
    total = 0
    for value in values:
        total += value
    return total

print(accumulate([1, 2, 3]))`;
	});

	const decorations = $derived.by((): IMonacoDecoration[] => {
		const lineNumber = Math.max(1, Number(highlightedLine) || 1);
		return [
			createLineHighlightDecoration(lineNumber, {
				className: 'demo-line-highlight',
				linesDecorationsClassName: 'demo-line-gutter',
				glyphMarginClassName: 'demo-line-glyph',
				glyphMarginHoverMessage: 'Highlighted line'
			}),
			{
				range: {
					startLineNumber: lineNumber,
					startColumn: 1,
					endLineNumber: lineNumber,
					endColumn: 1
				},
				options: {
					showIfCollapsed: true,
					before: {
						content: '  // active',
						inlineClassName: 'demo-inline-hint',
						inlineClassNameAffectsLetterSpacing: true
					}
				}
			}
		];
	});
</script>

<input bind:value={id} />
{id}
<input bind:value={lang} />
<label>
	highlight line
	<input type="number" bind:value={highlightedLine} min="1" />
</label>
<Monaco
	setting={{
		power: true,
		automaticLayout: true,
		glyphMargin: true,
		renderWhitespace: 'all',
		lightbulb: { enabled: 'on' as any },
		fontLigatures: true
	}}
	provider={async () => [
		previewSource,
		lang,
		`/workspace/${id}.${lang === 'typescript' ? 'ts' : 'py'}`
	]}
	lspurl={(language: string) => `ws://localhost:2500/${language}`}
	active={`${id}:${lang}`}
	{decorations}
/>

<style>
	:global(html, body, body > div) {
		margin: 0;
		padding: 0;
		height: 100%;
	}

	:global(.demo-line-highlight) {
		background: rgba(56, 189, 248, 0.14);
		box-shadow: inset 3px 0 0 rgba(2, 132, 199, 0.85);
	}

	:global(.demo-line-gutter) {
		border-left: 3px solid #0ea5e9;
		margin-left: 4px;
	}

	:global(.demo-line-glyph) {
		background: #0ea5e9;
		border-radius: 999px;
		width: 10px !important;
		height: 10px !important;
		margin-left: 5px;
	}

	:global(.demo-inline-hint) {
		color: #0369a1;
		font-style: italic;
	}
</style>
