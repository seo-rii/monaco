import type * as M from 'monaco-editor';
import type { IOptions as OnigurumaOptions } from 'vscode-oniguruma';
import type {
	IEmbeddedLanguagesMap,
	IGrammar,
	IGrammarConfiguration,
	IRawGrammar,
	IRawTheme,
	ITokenTypeMap,
	Registry,
	StateStack
} from 'vscode-textmate';
import type { IMonacoExtension } from './runtime.js';

export type IMonacoTextMateWasm =
	| OnigurumaOptions
	| ArrayBuffer
	| ArrayBufferView
	| Response
	| (() =>
			| OnigurumaOptions
			| ArrayBuffer
			| ArrayBufferView
			| Response
			| Promise<OnigurumaOptions | ArrayBuffer | ArrayBufferView | Response>);

export interface IMonacoTextMateGrammar {
	language: string;
	scopeName: string;
	embeddedLanguages?: Record<string, string | number>;
	tokenTypes?: ITokenTypeMap;
	balancedBracketSelectors?: string[];
	unbalancedBracketSelectors?: string[];
	registerLanguage?: boolean;
}

export interface IMonacoTextMateOptions {
	wasm: IMonacoTextMateWasm;
	grammars: readonly IMonacoTextMateGrammar[];
	loadGrammar(
		scopeName: string
	): IRawGrammar | null | undefined | Promise<IRawGrammar | null | undefined>;
	getInjections?(scopeName: string): string[] | undefined;
	theme?: IRawTheme;
	colorMap?: string[];
	applyColorMap?: boolean;
	timeLimitMs?: number;
}

export interface IMonacoTextMateExtensionOptions extends IMonacoTextMateOptions {
	id?: string;
	enabled?: boolean;
}

class TextMateState implements M.languages.IState {
	constructor(readonly ruleStack: StateStack) {}

	clone() {
		return new TextMateState(this.ruleStack.clone());
	}

	equals(other: M.languages.IState) {
		return other instanceof TextMateState && this.ruleStack.equals(other.ruleStack);
	}
}

let onigurumaPromise:
	| Promise<{
			createOnigScanner(patterns: string[]): import('vscode-textmate').OnigScanner;
			createOnigString(value: string): import('vscode-textmate').OnigString;
	  }>
	| undefined;

async function resolveWasm(wasm: IMonacoTextMateWasm) {
	return typeof wasm === 'function' ? await wasm() : wasm;
}

function loadOniguruma(wasm: IMonacoTextMateWasm) {
	onigurumaPromise ??= (async () => {
		const oniguruma = await import('vscode-oniguruma');
		await oniguruma.loadWASM(await resolveWasm(wasm));
		return {
			createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
			createOnigString: (value: string) => new oniguruma.OnigString(value)
		};
	})().catch((error) => {
		onigurumaPromise = undefined;
		throw error;
	});
	return onigurumaPromise;
}

const installations = new WeakMap<
	IMonacoTextMateOptions,
	{
		monaco: typeof M;
		references: number;
		promise: Promise<M.IDisposable>;
	}
>();

async function installTextMate(
	monaco: typeof M,
	options: IMonacoTextMateOptions
): Promise<M.IDisposable> {
	const textmate = await import('vscode-textmate');
	const registry: Registry = new textmate.Registry({
		onigLib: loadOniguruma(options.wasm),
		theme: options.theme,
		colorMap: options.colorMap,
		loadGrammar: options.loadGrammar,
		getInjections: options.getInjections
	});
	if (options.applyColorMap !== false && options.theme) {
		monaco.languages.setColorMap(registry.getColorMap());
	}

	const disposables: M.IDisposable[] = [];
	for (const definition of options.grammars) {
		if (
			definition.registerLanguage !== false &&
			!monaco.languages.getLanguages().some((language) => language.id === definition.language)
		) {
			monaco.languages.register({ id: definition.language });
		}
		const embeddedLanguages: IEmbeddedLanguagesMap = {};
		for (const [scope, language] of Object.entries(definition.embeddedLanguages ?? {})) {
			embeddedLanguages[scope] =
				typeof language === 'number'
					? language
					: monaco.languages.getEncodedLanguageId(language);
		}
		const configuration: IGrammarConfiguration = {
			embeddedLanguages,
			tokenTypes: definition.tokenTypes,
			balancedBracketSelectors: definition.balancedBracketSelectors,
			unbalancedBracketSelectors: definition.unbalancedBracketSelectors
		};
		disposables.push(
			monaco.languages.registerTokensProviderFactory(definition.language, {
				async create() {
					const grammar: IGrammar | null = await registry.loadGrammarWithConfiguration(
						definition.scopeName,
						monaco.languages.getEncodedLanguageId(definition.language),
						configuration
					);
					if (!grammar) {
						throw new Error(`TextMate grammar not found: ${definition.scopeName}`);
					}
					return {
						getInitialState: () => new TextMateState(textmate.INITIAL),
						tokenizeEncoded(line, state) {
							if (!(state instanceof TextMateState)) {
								throw new Error('Invalid TextMate tokenizer state');
							}
							const result = grammar.tokenizeLine2(
								line,
								state.ruleStack,
								options.timeLimitMs
							);
							return {
								tokens: result.tokens,
								endState: new TextMateState(result.ruleStack)
							};
						}
					};
				}
			})
		);
	}

	return {
		dispose() {
			for (const disposable of disposables.reverse()) disposable.dispose();
			registry.dispose();
		}
	};
}

async function acquireTextMate(
	monaco: typeof M,
	options: IMonacoTextMateOptions
): Promise<M.IDisposable> {
	let installation = installations.get(options);
	if (!installation) {
		installation = {
			monaco,
			references: 0,
			promise: installTextMate(monaco, options)
		};
		installations.set(options, installation);
	} else if (installation.monaco !== monaco) {
		throw new Error('A TextMate options object cannot be shared across Monaco module instances');
	}
	installation.references += 1;
	let disposed = false;
	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			const current = installations.get(options);
			if (!current) return;
			current.references -= 1;
			if (current.references > 0) return;
			installations.delete(options);
			void current.promise.then((value) => value.dispose());
		}
	};
}

export function createTextMateExtension({
	id = 'textmate',
	enabled = true,
	...options
}: IMonacoTextMateExtensionOptions): IMonacoExtension {
	return {
		id,
		enabled,
		activate: ({ monaco }) => acquireTextMate(monaco, options)
	};
}
