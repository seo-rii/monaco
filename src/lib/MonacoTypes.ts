import type * as M from 'monaco-editor';

export type IMonacoModelSource = [code: string, language: string, uri: string];
export type IMonacoDecoration = M.editor.IModelDeltaDecoration;
export type IMonacoDecorationHover = string | M.IMarkdownString | M.IMarkdownString[];

export interface IMonacoLineHighlightOptions
	extends Omit<M.editor.IModelDecorationOptions, 'isWholeLine' | 'hoverMessage' | 'glyphMarginHoverMessage'> {
	hoverMessage?: IMonacoDecorationHover;
	glyphMarginHoverMessage?: IMonacoDecorationHover;
}

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

export type IMonacoLspNativeTransport = ConstructorParameters<typeof M.lsp.MonacoLspClient>[0];
export type IMonacoLspMessage = Parameters<IMonacoLspNativeTransport['send']>[0];

export interface IMonacoLspMessageReader {
	listen(callback: (message: IMonacoLspMessage) => void): M.IDisposable;
	onClose?: (listener: () => void) => M.IDisposable;
	dispose?: () => void;
}

export interface IMonacoLspMessageWriter {
	write(message: IMonacoLspMessage): Promise<void>;
	dispose?: () => void;
	end?: () => void;
}

export interface IMonacoLspMessageTransports {
	reader: IMonacoLspMessageReader;
	writer: IMonacoLspMessageWriter;
	dispose?: () => void;
}

export interface IMonacoLspServerHandle {
	transport: IMonacoLspMessageTransports;
	dispose?: () => void;
}

export type IMonacoLspConnection =
	| string
	| IMonacoLspNativeTransport
	| IMonacoLspMessageTransports
	| IMonacoLspServerHandle;

export type IMonacoLspProviderResult = IMonacoLspConnection | null | undefined;
export type IMonacoLspProvider = (
	language: string
) => IMonacoLspProviderResult | Promise<IMonacoLspProviderResult>;
