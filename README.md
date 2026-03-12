# @seorii/monaco

Svelte wrapper components for Monaco Editor and Monaco Diff Editor with model loading, markers, snippets, LSP hooks, and model decorations.

## Install

```bash
npm install @seorii/monaco monaco-editor
```

## Monaco

```svelte
<script lang="ts">
	import Monaco, { createLineHighlightDecoration, type IMonacoDecoration } from '@seorii/monaco';

	let pausedLine = 4;

	const decorations: IMonacoDecoration[] = [
		createLineHighlightDecoration(pausedLine, {
			className: 'debug-line-highlight',
			linesDecorationsClassName: 'debug-line-gutter',
			glyphMarginClassName: 'debug-line-glyph',
			glyphMarginHoverMessage: 'Paused here'
		}),
		{
			range: {
				startLineNumber: pausedLine,
				startColumn: 1,
				endLineNumber: pausedLine,
				endColumn: 1
			},
			options: {
				showIfCollapsed: true,
				before: {
					content: '  // active',
					inlineClassName: 'debug-inline-hint',
					inlineClassNameAffectsLetterSpacing: true
				}
			}
		}
	];
</script>

<Monaco
	setting={{ automaticLayout: true, glyphMargin: true }}
	active="main.py"
	provider={async () => [
		`def accumulate(values):
    total = 0
    for value in values:
        total += value
    return total`,
		'python',
		'/workspace/main.py'
	]}
	{decorations}
/>

<style>
	:global(.debug-line-highlight) {
		background: rgba(56, 189, 248, 0.14);
		box-shadow: inset 3px 0 0 rgba(2, 132, 199, 0.85);
	}

	:global(.debug-line-gutter) {
		border-left: 3px solid #0ea5e9;
	}

	:global(.debug-line-glyph) {
		background: #0ea5e9;
		border-radius: 999px;
	}

	:global(.debug-inline-hint) {
		color: #0369a1;
		font-style: italic;
	}
</style>
```

## Diff

`MonacoDiff` supports the same model-level decoration flow per side:

- `originalDecorations`
- `modifiedDecorations`

Use Monaco's standard `IModelDeltaDecoration` objects for arbitrary ranges, injected text, gutter glyphs, and whole-line highlights.

## Exports

- `createModel`
- `upsertModel`
- `getModelByUri`
- `setModelLanguage`
- `setModelDecorations`
- `createLineHighlightDecoration`

## Notes

- Decoration styling is class-based. Add matching global CSS in the consuming app.
- Empty-range injected text should usually include `showIfCollapsed: true`.
- Decorations are applied to the active model and cleaned up automatically when the model changes or the component unmounts.
