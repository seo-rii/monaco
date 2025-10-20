import {
	MonacoLanguageClient,
	CloseAction,
	ErrorAction,
	MonacoServices,
	MessageTransports
} from '@hancomac/monaco-languageclient';
import {
	toSocket,
	WebSocketMessageReader,
	WebSocketMessageWriter
} from '@codingame/monaco-jsonrpc';
import * as M from 'monaco-editor';

const languages = {
	python: {
		id: 'python',
		extensions: ['.py', '.pyi'],
		aliases: ['python'],
		mimetypes: ['application/text']
	},
	json: {
		id: 'json',
		extensions: ['.json', '.bowerrc', '.jshintrc', '.jscsrc', '.eslintrc', '.babelrc'],
		aliases: ['JSON', 'json'],
		mimetypes: ['application/json']
	},
	typescript: {
		id: 'typescript',
		extensions: ['.ts'],
		aliases: ['TypeScript', 'typescript', 'ts'],
		mimetypes: ['text/typescript']
	},
	cpp: {
		id: 'cpp',
		extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'],
		aliases: ['C++', 'cpp'],
		mimetypes: ['text/x-c++src']
	}
};

function createLanguageClient(
	transports: MessageTransports,
	language: keyof typeof languages
): MonacoLanguageClient {
	if (languages[language]) M.languages.register(languages[language]);
	return new MonacoLanguageClient({
		name: 'Sample Language Client',
		clientOptions: {
			documentSelector: [language],
			errorHandler: {
				error: () => ({ action: ErrorAction.Continue }),
				closed: () => ({ action: CloseAction.DoNotRestart })
			},
			workspaceFolder: {
				index: 0,
				name: 'workspace',
				uri: M.Uri.parse('/workspace')
			}
		},
		connectionProvider: {
			get: () => {
				return Promise.resolve(transports);
			}
		}
	});
}

let svcInstalled = false;

export default async function (
	language: keyof typeof languages,
	fr: string | { reader: any; writer: any }
) {
	if (!svcInstalled) {
		MonacoServices.install(M);
		svcInstalled = true;
	}
	const { default: ReconnectingWebsocket } = await import('reconnecting-websocket');
	if (typeof fr === 'string') {
		const webSocket = new ReconnectingWebsocket(fr) as WebSocket;
		let languageClient: MonacoLanguageClient;
		webSocket.onopen = () => {
			const socket = toSocket(webSocket);
			const reader = new WebSocketMessageReader(socket);
			const writer = new WebSocketMessageWriter(socket);
			languageClient = createLanguageClient({ reader, writer }, language);
			languageClient.start();
			reader.onClose(() => languageClient.stop());
		};
		return () => {
			webSocket.close();
			languageClient.stop();
		};
	} else {
		const { reader, writer } = fr;
		const languageClient = createLanguageClient({ reader, writer }, language);
		languageClient.start();
		reader.onClose(() => languageClient.stop());
		return () => {
			languageClient.stop();
		};
	}
}
