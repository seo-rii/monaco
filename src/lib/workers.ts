type WorkerConstructor = new () => Worker;
type WorkerModule = { default: WorkerConstructor };
type WorkerLoader = () => Promise<WorkerModule>;

export const loadEditorWorker: WorkerLoader = () =>
	import('monaco-editor/esm/vs/editor/editor.worker?worker') as Promise<WorkerModule>;
export const loadJsonWorker: WorkerLoader = () =>
	import('monaco-editor/esm/vs/language/json/json.worker?worker') as Promise<WorkerModule>;
export const loadCssWorker: WorkerLoader = () =>
	import('monaco-editor/esm/vs/language/css/css.worker?worker') as Promise<WorkerModule>;
export const loadHtmlWorker: WorkerLoader = () =>
	import('monaco-editor/esm/vs/language/html/html.worker?worker') as Promise<WorkerModule>;
export const loadTsWorker: WorkerLoader = () =>
	import(
		'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
	) as Promise<WorkerModule>;

const workerModuleCache = new Map<WorkerLoader, Promise<WorkerModule>>();

function resolveWorkerLoader(label: string): WorkerLoader {
	if (label === 'json') return loadJsonWorker;
	if (label === 'css' || label === 'scss' || label === 'less') return loadCssWorker;
	if (label === 'html' || label === 'handlebars' || label === 'razor') return loadHtmlWorker;
	if (label === 'typescript' || label === 'javascript') return loadTsWorker;
	return loadEditorWorker;
}

async function loadWorkerModule(loader: WorkerLoader): Promise<WorkerModule> {
	const cached = workerModuleCache.get(loader);
	if (cached) return cached;
	const next = loader();
	workerModuleCache.set(loader, next);
	return next;
}

export async function createMonacoWorker(label: string): Promise<Worker> {
	const workerModule = await loadWorkerModule(resolveWorkerLoader(label));
	return new workerModule.default();
}

export function createMonacoEnvironment() {
	return {
		async getWorker(_: unknown, label: string) {
			return createMonacoWorker(label);
		}
	};
}
