import type * as M from 'monaco-editor';

export type IMonacoModelSource = [code: string, language: string, uri: string];

export interface IMonacoSnippet {
	label: string;
	insertText: string;
	detail?: string;
	documentation?: string;
	sortText?: string;
	filterText?: string;
	kind?: M.languages.CompletionItemKind;
	insertTextRules?: M.languages.CompletionItemInsertTextRule;
}

export type IMonacoSnippetMap = Record<string, IMonacoSnippet[]>;
export type IMonacoSnippetRegister = (language: string, snippets: IMonacoSnippet[]) => void;
export type IMonacoSnippetLoader =
	| ((register: IMonacoSnippetRegister) => void | M.IDisposable | (() => void))
	| undefined;

export interface IMonacoDiffSourcePair {
	original: IMonacoModelSource;
	modified: IMonacoModelSource;
}

export type IMonacoDiffProviderResult =
	| IMonacoDiffSourcePair
	| [original: IMonacoModelSource, modified: IMonacoModelSource];
