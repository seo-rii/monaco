import {
	MonacoLanguageClient,
	CloseAction,
	ErrorAction,
	MonacoServices,
	MessageTransports
} from 'monaco-languageclient';
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

export default async function (language: keyof typeof languages, url: string) {
	MonacoServices.install(M);
	const { default: ReconnectingWebsocket } = await import('reconnecting-websocket');
	const webSocket = new ReconnectingWebsocket(url) as WebSocket;
	webSocket.onopen = () => {
		const socket = toSocket(webSocket);
		const reader = new WebSocketMessageReader(socket);
		const writer = new WebSocketMessageWriter(socket);
		const languageClient = createLanguageClient({ reader, writer }, language);
		languageClient.start();
		reader.onClose(() => languageClient.stop());
	};
	return () => {
		webSocket.close();
	};
}
