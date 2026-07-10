import connectLsp, { disposeLspConnection } from '$lib/extensions/lsp.js';
import type * as M from 'monaco-editor';
import type {
	IMonacoLspClientOptions,
	IMonacoLspProvider,
	IMonacoLspStatus,
	IMonacoLspStatusHandler
} from '$lib/MonacoTypes.js';

interface MonacoLspSessionOptions {
	model: M.editor.ITextModel;
	provider?: IMonacoLspProvider;
	urlProvider?: (language: string) => string;
	clientOptions?: IMonacoLspClientOptions;
	onStatus?: IMonacoLspStatusHandler;
	onError: (error: unknown, context: string) => void;
}

export function startMonacoLspSession({
	model,
	provider,
	urlProvider,
	clientOptions,
	onStatus,
	onError
}: MonacoLspSessionOptions) {
	const language = model.getLanguageId();
	const uri = model.uri.toString(true);
	const controller = new AbortController();
	let disposeClient: (() => void) | undefined;
	let statusState: IMonacoLspStatus['state'] | undefined;
	let stopped = false;
	const emitStatus = (status: IMonacoLspStatus) => {
		if (statusState === status.state) return;
		statusState = status.state;
		try {
			onStatus?.(status);
		} catch (error) {
			onError(error, 'onlspstatus callback failed');
		}
	};

	emitStatus({ state: 'connecting', language, uri });
	void (async () => {
		try {
			const connection = provider
				? await provider(language, { language, model, uri, signal: controller.signal })
				: urlProvider && (await urlProvider(language));
			if (!connection) {
				if (!controller.signal.aborted) emitStatus({ state: 'disabled', language, uri });
				return;
			}
			if (controller.signal.aborted) {
				disposeLspConnection(connection);
				return;
			}
			const dispose = await connectLsp(language, connection, {
				...clientOptions,
				model
			});
			if (controller.signal.aborted) {
				dispose?.();
				return;
			}
			disposeClient = dispose;
			emitStatus({ state: 'ready', language, uri });
		} catch (error) {
			if (controller.signal.aborted) return;
			const normalizedError = error instanceof Error ? error : new Error(String(error));
			emitStatus({ state: 'error', language, uri, error: normalizedError });
			onError(normalizedError, 'LSP connection failed');
		}
	})();

	return () => {
		if (stopped) return;
		stopped = true;
		controller.abort();
		const dispose = disposeClient;
		disposeClient = undefined;
		dispose?.();
		emitStatus({ state: 'disabled', language, uri });
	};
}
