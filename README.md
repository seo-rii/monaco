# @seorii/monaco

Svelte 5 wrappers for Monaco Editor and Monaco Diff Editor with model loading, LSP, TextMate grammars, Yjs collaboration, configurable language providers, markers, snippets, and decorations.

## Install

```bash
npm install @seorii/monaco monaco-editor
```

The package includes `vscode-textmate`, `vscode-oniguruma`, `y-monaco`, and Yjs, but loads those adapters only when their extension is enabled.

## Basic editor

```svelte
<script lang="ts">
	import Monaco from '@seorii/monaco';
</script>

<Monaco
	active="main.py"
	provider={async () => [
		'print("hello")',
		'python',
		'file:///workspace/main.py'
	]}
	setting={{ automaticLayout: true }}
/>
```

## Runtime and extension configuration

Use the module singleton when multiple components should share registrations. Use `createMonacoRuntime()` for tests or isolated editor groups. No Svelte context provider is required.

```ts
import { getMonacoRuntime } from '@seorii/monaco';
import { createTextMateExtension } from '@seorii/monaco/textmate';

const runtime = getMonacoRuntime();
const textMateRegistration = runtime.use(
	createTextMateExtension({
		id: 'project-textmate',
		enabled: true,
		wasm: () => fetch('/onig.wasm'),
		grammars: [{ language: 'rust', scopeName: 'source.rust' }],
		loadGrammar: async (scopeName) => {
			if (scopeName !== 'source.rust') return;
			return fetch('/grammars/rust.tmLanguage.json').then((response) => response.json());
		}
	})
);

// Remove the extension from every editor using this runtime.
textMateRegistration.dispose();
```

An extension can also be local to one component:

```svelte
<Monaco {extensions} />
```

Every extension has `enabled?: boolean`. Setting `enabled: false`, omitting it from the runtime, or disposing its registration disables it and cleans up its editor/model hooks.

## Built-in feature switches

Existing integrations remain enabled by default for compatibility. They can be switched off independently:

```svelte
<Monaco
	features={{
		aonohakoLanguages: false,
		snippets: false,
		keybindings: false,
		powerMode: false,
		lsp: true
	}}
/>
```

`features={false}` disables every package-managed built-in integration while leaving the Monaco editor itself available. TextMate, Yjs, and custom providers are opt-in extensions and therefore default to disabled.

## TextMate grammars

Import TextMate support from `@seorii/monaco/textmate`. The application controls the Oniguruma WASM and grammar URLs, so CSP, offline assets, and cache hashing remain application concerns.

```ts
import { createTextMateExtension } from '@seorii/monaco/textmate';

const textmate = createTextMateExtension({
	wasm: () => fetch(new URL('./onig.wasm', import.meta.url)),
	theme: rawTextMateTheme,
	grammars: [
		{
			language: 'my-language',
			scopeName: 'source.my-language',
			embeddedLanguages: {
				'meta.embedded.block.javascript': 'javascript'
			}
		}
	],
	loadGrammar: (scopeName) => grammarMap.get(scopeName)
});
```

TextMate tokenization and LSP semantic tokens can be enabled together. Monaco's token color map is global; use one TextMate theme per Monaco module instance. Set `applyColorMap: false` if the application manages encoded token colors itself.

If a TextMate grammar replaces an Aonohako Monarch tokenizer for the same language, disable `aonohakoLanguages` before mounting the editor.

## Yjs collaboration

Import collaboration from `@seorii/monaco/yjs`. The caller owns `Y.Doc`, network providers, awareness, and any supplied `Y.UndoManager`. The extension owns only Monaco bindings and managers it creates.

```ts
import * as Y from 'yjs';
import { createYMonacoExtension } from '@seorii/monaco/yjs';

const document = new Y.Doc();
const text = document.getText('main.ts');

const collaboration = createYMonacoExtension({
	enabled: true,
	resolve: ({ model }) => {
		if (model.uri.path !== '/workspace/main.ts') return;
		return {
			text,
			awareness: provider.awareness,
			undo: {
				keybindings: true
			}
		};
	}
});
```

`Y.Text` is authoritative and immediately replaces the Monaco model value. Seed or synchronize the Yjs document before binding. The adapter normalizes models to LF by default. Set `normalizeEol: false` only when every peer uses a compatible EOL policy.

Remote changes trigger normal `onchange` and `oninput` callbacks. Yjs undo keybindings can be disabled with `undo: { keybindings: false }` when Vim or Emacs manages undo.

## Language providers

Monaco document providers can be installed as one configurable extension. Every field accepts one contribution, an array, `false`, or omission.

```ts
import { createMonacoLanguageFeaturesExtension } from '@seorii/monaco/extensions';

const providers = createMonacoLanguageFeaturesExtension({
	enabled: true,
	features: {
		documentSymbols: { selector: 'typescript', provider: symbolProvider },
		references: false,
		rename: { selector: 'typescript', provider: renameProvider },
		codeActions: { selector: 'typescript', provider: codeActionProvider },
		documentFormatting: { selector: 'typescript', provider: formatter },
		inlayHints: { selector: 'typescript', provider: inlayHintProvider },
		semanticTokens: { selector: 'typescript', provider: semanticTokenProvider },
		codeLens: { selector: 'typescript', provider: codeLensProvider },
		inlineCompletions: { selector: 'typescript', provider: inlineProvider },
		workspaceSymbols: workspaceSymbolProvider
	}
});
```

The supported registrations are:

- Document symbols and Outline data
- References and Rename
- Code Actions
- Document, range, and on-type formatting
- Inlay Hints
- Document and range Semantic Tokens
- CodeLens
- Inline Completions
- Headless workspace symbols

Monaco standalone has no public workspace-symbol registry or palette. `queryMonacoWorkspaceSymbols(query)` queries package-registered providers so an application can render its own palette.

## Problems and editor actions

`getMonacoProblems(monaco, filter)` returns Monaco markers for a Problems panel. `createMonacoFeatureActions(editor, options)` exposes the built-in Problems navigation, quick Outline, Rename, References, Code Actions, and Format commands. Each action can be disabled in `options`.

```ts
const actions = createMonacoFeatureActions(editor, {
	references: false
});

await actions.outline();
```

## LSP feature switches

Native Monaco LSP features remain enabled by default when `lsp` or `lspurl` is provided. Disable individual capabilities with `lspOptions.features`:

```svelte
<Monaco
	{lsp}
	lspOptions={{
		features: {
			diagnostics: true,
			documentSymbols: true,
			references: false,
			rename: false,
			codeActions: true,
			documentFormatting: true,
			rangeFormatting: false,
			onTypeFormatting: false,
			inlayHints: true,
			semanticTokens: true,
			codeLens: false,
			workspaceSymbols: false,
			inlineCompletions: false
		}
	}}
/>
```

`features: false` disables all advertised native LSP capabilities and filters pushed diagnostics. Monaco 0.55's native client implements document features but not workspace symbols or inline completions; use the custom provider extension for those two features.

## Diff editor

`MonacoDiff` supports the same runtime and local extension API. Model extensions receive `side: 'original' | 'modified'`, allowing resolvers to opt into either side. Existing LSP behavior remains scoped to the modified model.

It also supports:

- `originalDecorations`
- `modifiedDecorations`
- `originalMarkers`
- `modifiedMarkers`

## Decorations

```ts
import { createLineHighlightDecoration } from '@seorii/monaco';

const decorations = [
	createLineHighlightDecoration(4, {
		className: 'debug-line-highlight',
		glyphMarginClassName: 'debug-line-gutter',
		glyphMarginHoverMessage: 'Paused here'
	})
];
```

Decoration styling is class-based. Add matching global CSS in the consuming application.

## Worker setup

Vite applications can import `createMonacoEnvironment` from `@seorii/monaco/workers` and assign it before loading Monaco:

```ts
import { createMonacoEnvironment } from '@seorii/monaco/workers';

self.MonacoEnvironment = createMonacoEnvironment();
```

## Main exports

- `Monaco`
- `MonacoDiff`
- `createMonacoRuntime`
- `getMonacoRuntime`
- `createMonacoLanguageFeaturesExtension`
- `createMonacoFeatureActions`
- `getMonacoProblems`
- `queryMonacoWorkspaceSymbols`
- `createModel`
- `upsertModel`
- `getModelByUri`
- `setModelLanguage`
- `setModelDecorations`
- `createLineHighlightDecoration`
