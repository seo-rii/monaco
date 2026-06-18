import * as M from 'monaco-editor';
import type {
	IMonacoLspConnection,
	IMonacoLspMessage,
	IMonacoLspMessageTransports,
	IMonacoLspNativeTransport,
	IMonacoLspProviderResult,
	IMonacoLspServerHandle
} from '$lib/MonacoTypes.js';

type NativeConnectionState = IMonacoLspNativeTransport['state']['value'];
type NativeStateChangeEvent = IMonacoLspNativeTransport['state']['onChange'];
type MessageListener = Parameters<IMonacoLspNativeTransport['setListener']>[0];

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
				if (typeof event.data !== 'string') throw new Error('LSP WebSocket only supports text JSON-RPC messages');
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
		if (this.#socket.readyState === WebSocket.CONNECTING || this.#socket.readyState === WebSocket.OPEN) {
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
			dispose: 'dispose' in connection ? () => (connection as M.IDisposable).dispose() : undefined
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
	connection: Exclude<IMonacoLspProviderResult, null | undefined>
) {
	registerLanguage(language);
	const { transport, dispose } = resolveTransport(connection);
	const languageClient = new ManagedMonacoLspClient(transport);

	return () => {
		languageClient.dispose();
		dispose?.();
	};
}
