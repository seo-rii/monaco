import * as M from 'monaco-editor';
import type {
	IMonacoLspConnection,
	IMonacoLspClientOptions,
	IMonacoLspMessage,
	IMonacoLspMessageTransports,
	IMonacoLspNativeTransport,
	IMonacoLspProviderResult,
	IMonacoLspServerHandle
} from '$lib/MonacoTypes.js';

type NativeConnectionState = IMonacoLspNativeTransport['state']['value'];
type NativeStateChangeEvent = IMonacoLspNativeTransport['state']['onChange'];
type MessageListener = Parameters<IMonacoLspNativeTransport['setListener']>[0];

interface ResolvedDocumentSyncOptions {
	model: M.editor.ITextModel;
	openDelayMs: number;
	initializedDelayMs: number;
	workspaceName: string;
}

const languages: Record<string, M.languages.ILanguageExtensionPoint> = {
	python: {
		id: 'python',
		extensions: ['.py', '.pyi'],
		aliases: ['Python', 'python'],
		mimetypes: ['text/x-python']
	},
	json: {
		id: 'json',
		extensions: ['.json', '.bowerrc', '.jshintrc', '.jscsrc', '.eslintrc', '.babelrc'],
		aliases: ['JSON', 'json'],
		mimetypes: ['application/json']
	},
	javascript: {
		id: 'javascript',
		extensions: ['.js', '.mjs', '.cjs', '.jsx'],
		aliases: ['JavaScript', 'javascript', 'js'],
		mimetypes: ['text/javascript']
	},
	typescript: {
		id: 'typescript',
		extensions: ['.ts', '.tsx'],
		aliases: ['TypeScript', 'typescript', 'ts'],
		mimetypes: ['text/typescript']
	},
	cpp: {
		id: 'cpp',
		extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'],
		aliases: ['C++', 'cpp'],
		mimetypes: ['text/x-c++src']
	},
	csharp: {
		id: 'csharp',
		extensions: ['.cs'],
		aliases: ['C#', 'csharp'],
		mimetypes: ['text/x-csharp']
	},
	fsharp: {
		id: 'fsharp',
		extensions: ['.fs', '.fsx', '.fsi'],
		aliases: ['F#', 'fsharp'],
		mimetypes: ['text/x-fsharp']
	},
	vb: {
		id: 'vb',
		extensions: ['.vb'],
		aliases: ['Visual Basic', 'VB', 'vb'],
		mimetypes: ['text/x-vb']
	},
	gleam: {
		id: 'gleam',
		extensions: ['.gleam'],
		aliases: ['Gleam', 'gleam'],
		mimetypes: ['text/x-gleam']
	},
	go: {
		id: 'go',
		extensions: ['.go'],
		aliases: ['Go', 'golang', 'go'],
		mimetypes: ['text/x-go']
	},
	rust: {
		id: 'rust',
		extensions: ['.rs'],
		aliases: ['Rust', 'rust'],
		mimetypes: ['text/x-rustsrc']
	},
	wat: {
		id: 'wat',
		extensions: ['.wat'],
		aliases: ['WebAssembly Text', 'wat'],
		mimetypes: ['text/x-wat']
	},
	assemblyscript: {
		id: 'assemblyscript',
		extensions: ['.as.ts'],
		aliases: ['AssemblyScript', 'assemblyscript'],
		mimetypes: ['text/x-assemblyscript']
	}
};

const registeredLanguages = new Set<string>();
const clientFeatureStores = new WeakMap<M.lsp.MonacoLspClient, M.IDisposable>();

class ValueWithChangeEvent<T> {
	#value: T;
	#listeners = new Set<(value: T) => void>();

	constructor(value: T) {
		this.#value = value;
	}

	get value() {
		return this.#value;
	}

	set value(value: T) {
		if (Object.is(this.#value, value)) return;
		this.#value = value;
		for (const listener of this.#listeners) listener(value);
	}

	get onChange(): NativeStateChangeEvent {
		return ((listener: (value: T) => void) => {
			this.#listeners.add(listener);
			return {
				dispose: () => this.#listeners.delete(listener)
			};
		}) as NativeStateChangeEvent;
	}
}

abstract class DisposableNativeTransport implements IMonacoLspNativeTransport {
	#state = new ValueWithChangeEvent<NativeConnectionState>({
		state: 'connecting'
	});

	readonly state = this.#state as IMonacoLspNativeTransport['state'];

	#pendingMessages: IMonacoLspMessage[] = [];
	#listener: MessageListener;

	setListener(listener: MessageListener) {
		this.#listener = listener;
		if (!listener) return;
		while (this.#pendingMessages.length > 0 && this.#listener) {
			const message = this.#pendingMessages.shift();
			if (message) this.#listener(message);
		}
	}

	send(message: IMonacoLspMessage): Promise<void> {
		return this.sendMessage(message);
	}

	protected receive(message: IMonacoLspMessage) {
		if (this.#pendingMessages.length === 0 && this.#listener) {
			this.#listener(message);
			return;
		}
		this.#pendingMessages.push(message);
	}

	protected open() {
		this.#state.value = { state: 'open' };
	}

	protected close(error?: Error) {
		this.#state.value = {
			state: 'closed',
			error
		};
	}

	protected abstract sendMessage(message: IMonacoLspMessage): Promise<void>;
	abstract toString(): string;
}

class BrowserWebSocketTransport extends DisposableNativeTransport implements M.IDisposable {
	#socket: WebSocket;
	#openPromise: Promise<void>;
	#resolveOpen: (() => void) | undefined;
	#rejectOpen: ((error: Error) => void) | undefined;
	#disposed = false;

	constructor(url: string) {
		super();
		this.#socket = new WebSocket(url);
		this.#openPromise = new Promise((resolve, reject) => {
			this.#resolveOpen = resolve;
			this.#rejectOpen = reject;
		});
		this.#socket.addEventListener('open', () => {
			this.open();
			this.#resolveOpen?.();
		});
		this.#socket.addEventListener('message', (event) => {
			try {
				if (typeof event.data !== 'string')
					throw new Error('LSP WebSocket only supports text JSON-RPC messages');
				this.receive(JSON.parse(event.data) as IMonacoLspMessage);
			} catch (error) {
				console.warn('[Monaco LSP] Failed to read WebSocket message:', error);
			}
		});
		this.#socket.addEventListener('error', () => {
			const error = new Error(`LSP WebSocket failed: ${url}`);
			this.#rejectOpen?.(error);
			this.close(error);
		});
		this.#socket.addEventListener('close', () => {
			this.#rejectOpen?.(new Error(`LSP WebSocket closed before opening: ${url}`));
			this.close();
		});
	}

	protected async sendMessage(message: IMonacoLspMessage): Promise<void> {
		if (this.#disposed) throw new Error('LSP WebSocket transport is disposed');
		if (this.#socket.readyState !== WebSocket.OPEN) await this.#openPromise;
		this.#socket.send(JSON.stringify(message));
	}

	dispose() {
		this.#disposed = true;
		if (
			this.#socket.readyState === WebSocket.CONNECTING ||
			this.#socket.readyState === WebSocket.OPEN
		) {
			this.#socket.close();
		}
		this.close();
	}

	toString() {
		return 'BrowserWebSocketTransport';
	}
}

class ReaderWriterTransport extends DisposableNativeTransport implements M.IDisposable {
	#transports: IMonacoLspMessageTransports;
	#readerDisposable: M.IDisposable | undefined;
	#closeDisposable: M.IDisposable | undefined;

	constructor(transports: IMonacoLspMessageTransports) {
		super();
		this.#transports = transports;
		this.#readerDisposable = transports.reader.listen((message) => this.receive(message));
		this.#closeDisposable = transports.reader.onClose?.(() => this.close());
		this.open();
	}

	protected sendMessage(message: IMonacoLspMessage): Promise<void> {
		return this.#transports.writer.write(message);
	}

	dispose() {
		this.#readerDisposable?.dispose();
		this.#closeDisposable?.dispose();
		this.#transports.writer.end?.();
		this.#transports.reader.dispose?.();
		this.#transports.writer.dispose?.();
		this.#transports.dispose?.();
		this.close();
	}

	toString() {
		return 'ReaderWriterTransport';
	}
}

class ManagedMonacoLspClient extends M.lsp.MonacoLspClient implements M.IDisposable {
	protected createFeatures(): M.IDisposable {
		const store = super.createFeatures();
		clientFeatureStores.set(this, store);
		return store;
	}

	dispose() {
		clientFeatureStores.get(this)?.dispose();
		clientFeatureStores.delete(this);
	}
}

function registerLanguage(language: string) {
	const extensionPoint = languages[language];
	if (!extensionPoint || registeredLanguages.has(extensionPoint.id)) return;
	M.languages.register(extensionPoint);
	registeredLanguages.add(extensionPoint.id);
}

function isServerHandle(connection: IMonacoLspConnection): connection is IMonacoLspServerHandle {
	return typeof connection === 'object' && connection !== null && 'transport' in connection;
}

function isReaderWriterTransport(connection: unknown): connection is IMonacoLspMessageTransports {
	return (
		typeof connection === 'object' &&
		connection !== null &&
		'reader' in connection &&
		'writer' in connection
	);
}

function isNativeTransport(connection: unknown): connection is IMonacoLspNativeTransport {
	return (
		typeof connection === 'object' &&
		connection !== null &&
		'state' in connection &&
		'send' in connection &&
		'setListener' in connection
	);
}

function resolveDocumentSyncOptions(
	options: IMonacoLspClientOptions | undefined
): ResolvedDocumentSyncOptions | null {
	const documentSync = options?.documentSync;
	if (documentSync === false || !options?.model) return null;
	if (typeof documentSync === 'object' && documentSync.enabled === false) return null;
	return {
		model: options.model,
		openDelayMs:
			typeof documentSync === 'object' && documentSync.openDelayMs !== undefined
				? documentSync.openDelayMs
				: 2000,
		initializedDelayMs:
			typeof documentSync === 'object' && documentSync.initializedDelayMs !== undefined
				? documentSync.initializedDelayMs
				: 1200,
		workspaceName:
			typeof documentSync === 'object' && documentSync.workspaceName
				? documentSync.workspaceName
				: 'workspace'
	};
}

function traceMessage(
	options: IMonacoLspClientOptions | undefined,
	direction: 'in' | 'out',
	message: IMonacoLspMessage
) {
	options?.trace?.({ direction, message });
}

function withMessageInterceptors(
	transports: IMonacoLspMessageTransports,
	options: IMonacoLspClientOptions | undefined
): IMonacoLspMessageTransports {
	const documentSync = resolveDocumentSyncOptions(options);
	if (!documentSync && !options?.trace) return transports;

	const model = documentSync?.model;
	const documentUri = model?.uri.toString(true).toLowerCase() ?? '';
	const workspaceUri = documentUri.replace(/\/[^/]*$/u, '') || 'file:///workspace';
	let disposed = false;
	let opened = false;
	let openTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
	let modelContentDisposable: M.IDisposable | null = null;
	const clearOpenTimer = () => {
		if (openTimer === null) return;
		globalThis.clearTimeout(openTimer);
		openTimer = null;
	};
	const write = (message: IMonacoLspMessage) => {
		traceMessage(options, 'out', message);
		void transports.writer.write(message).catch(() => {});
	};
	const openDocument = () => {
		if (!documentSync || !model || disposed || opened || model.isDisposed()) return;
		opened = true;
		write({
			jsonrpc: '2.0',
			method: 'textDocument/didOpen',
			params: {
				textDocument: {
					uri: documentUri,
					languageId: model.getLanguageId(),
					version: model.getVersionId(),
					text: model.getValue()
				}
			}
		} as IMonacoLspMessage);
		modelContentDisposable = model.onDidChangeContent(() => {
			if (disposed || model.isDisposed()) return;
			write({
				jsonrpc: '2.0',
				method: 'textDocument/didChange',
				params: {
					textDocument: {
						uri: documentUri,
						version: model.getVersionId()
					},
					contentChanges: [{ text: model.getValue() }]
				}
			} as IMonacoLspMessage);
		});
	};
	const scheduleOpenDocument = (delay: number) => {
		if (!documentSync) return;
		clearOpenTimer();
		openTimer = globalThis.setTimeout(() => {
			openTimer = null;
			openDocument();
		}, delay);
	};
	return {
		reader: {
			listen(callback) {
				const disposable = transports.reader.listen((message) => {
					traceMessage(options, 'in', message);
					callback(message);
				});
				scheduleOpenDocument(documentSync?.openDelayMs ?? 0);
				return disposable;
			},
			onClose: transports.reader.onClose?.bind(transports.reader),
			dispose: transports.reader.dispose?.bind(transports.reader)
		},
		writer: {
			write(message) {
				const record = message as unknown as Record<string, unknown>;
				const outgoing =
					documentSync &&
					record &&
					typeof record === 'object' &&
					record.method === 'initialize' &&
					record.params &&
					typeof record.params === 'object'
						? ({
								...record,
								params: {
									...(record.params as Record<string, unknown>),
									rootUri: workspaceUri,
									workspaceFolders: [
										{
											uri: workspaceUri,
											name: documentSync.workspaceName
										}
									]
								}
							} as unknown as IMonacoLspMessage)
						: message;
				const outgoingRecord = outgoing as unknown as Record<string, unknown>;
				const method =
					outgoingRecord && typeof outgoingRecord.method === 'string'
						? outgoingRecord.method
						: '';
				const params =
					outgoingRecord && typeof outgoingRecord.params === 'object'
						? (outgoingRecord.params as Record<string, unknown>)
						: null;
				const textDocument =
					params && typeof params.textDocument === 'object'
						? (params.textDocument as Record<string, unknown>)
						: null;
				const outgoingUri =
					typeof textDocument?.uri === 'string' ? textDocument.uri.toLowerCase() : '';
				if (documentSync && outgoingUri === documentUri) {
					if (method === 'textDocument/didOpen') {
						if (opened) return Promise.resolve();
						opened = true;
						clearOpenTimer();
					} else if (method === 'textDocument/didChange' && modelContentDisposable) {
						return Promise.resolve();
					} else if (method === 'textDocument/didClose') {
						opened = false;
						modelContentDisposable?.dispose();
						modelContentDisposable = null;
					}
				}
				traceMessage(options, 'out', outgoing);
				const result = transports.writer.write(outgoing);
				if (documentSync && method === 'initialized') {
					scheduleOpenDocument(documentSync.initializedDelayMs);
				}
				return result;
			},
			dispose: transports.writer.dispose?.bind(transports.writer),
			end: transports.writer.end?.bind(transports.writer)
		},
		dispose() {
			disposed = true;
			clearOpenTimer();
			modelContentDisposable?.dispose();
			modelContentDisposable = null;
			transports.dispose?.();
		}
	};
}

function withClientOptions(
	connection: IMonacoLspConnection,
	options: IMonacoLspClientOptions | undefined
): IMonacoLspConnection {
	if (!options?.trace && !resolveDocumentSyncOptions(options)) return connection;
	if (isServerHandle(connection)) {
		return {
			transport: withMessageInterceptors(connection.transport, options),
			dispose: () => connection.dispose?.()
		};
	}
	if (isReaderWriterTransport(connection)) {
		return withMessageInterceptors(connection, options);
	}
	return connection;
}

function resolveTransport(connection: IMonacoLspConnection): {
	transport: IMonacoLspNativeTransport;
	dispose?: () => void;
} {
	if (typeof connection === 'string') {
		const transport = new BrowserWebSocketTransport(connection);
		return {
			transport,
			dispose: () => transport.dispose()
		};
	}

	if (isNativeTransport(connection)) {
		return {
			transport: connection,
			dispose:
				'dispose' in connection ? () => (connection as M.IDisposable).dispose() : undefined
		};
	}

	if (isServerHandle(connection)) {
		const transport = new ReaderWriterTransport(connection.transport);
		return {
			transport,
			dispose: () => {
				transport.dispose();
				connection.dispose?.();
			}
		};
	}

	if (isReaderWriterTransport(connection)) {
		const transport = new ReaderWriterTransport(connection);
		return {
			transport,
			dispose: () => transport.dispose()
		};
	}

	throw new Error('Unsupported LSP connection');
}

export default async function (
	language: string,
	connection: Exclude<IMonacoLspProviderResult, null | undefined>,
	options?: IMonacoLspClientOptions
) {
	registerLanguage(language);
	const { transport, dispose } = resolveTransport(withClientOptions(connection, options));
	const languageClient = new ManagedMonacoLspClient(transport);

	return () => {
		languageClient.dispose();
		dispose?.();
	};
}
