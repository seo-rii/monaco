import type * as M from 'monaco-editor';
import type { MonacoBinding } from 'y-monaco';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import type { IMonacoExtension, IMonacoModelExtensionContext } from './runtime.js';

export interface IYMonacoUndoOptions {
	manager?: Y.UndoManager;
	options?: ConstructorParameters<typeof Y.UndoManager>[1];
	keybindings?: boolean;
}

export interface IYMonacoBindingConfig {
	text: Y.Text;
	awareness?: Awareness | null;
	undo?: false | IYMonacoUndoOptions;
	normalizeEol?: boolean;
	clearAwarenessSelection?: boolean;
}

export type IYMonacoBindingResolver =
	| IYMonacoBindingConfig
	| ((
			context: IMonacoModelExtensionContext
	  ) =>
			| IYMonacoBindingConfig
			| null
			| undefined
			| Promise<IYMonacoBindingConfig | null | undefined>);

export interface IYMonacoExtensionOptions {
	id?: string;
	enabled?: boolean;
	resolve: IYMonacoBindingResolver;
}

function trackedEditor(
	editor: M.editor.IStandaloneCodeEditor,
	disposables: M.IDisposable[]
): M.editor.IStandaloneCodeEditor {
	return new Proxy(editor, {
		get(target, property, receiver) {
			if (property === 'onDidChangeCursorSelection') {
				return (listener: Parameters<typeof editor.onDidChangeCursorSelection>[0]) => {
					const disposable = target.onDidChangeCursorSelection(listener);
					disposables.push(disposable);
					return disposable;
				};
			}
			const value = Reflect.get(target, property, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
}

async function createBinding(
	context: IMonacoModelExtensionContext,
	config: IYMonacoBindingConfig
): Promise<M.IDisposable> {
	if (!config.text.doc) {
		throw new Error('Y.Text must be attached to a Y.Doc before creating a Monaco binding');
	}
	if (config.normalizeEol !== false && context.model.getEOL() !== '\n') {
		context.model.setEOL(context.monaco.editor.EndOfLineSequence.LF);
	}

	const [{ MonacoBinding }, yjs] = await Promise.all([import('y-monaco'), import('yjs')]);
	const editorDisposables: M.IDisposable[] = [];
	const editor = trackedEditor(context.editor, editorDisposables);
	const binding: MonacoBinding = new MonacoBinding(
		config.text,
		context.model,
		new Set([editor]),
		config.awareness
	);

	let ownsUndoManager = false;
	let undoManager = config.undo && config.undo.manager;
	if (config.undo && !undoManager) {
		const trackedOrigins = new Set(config.undo.options?.trackedOrigins ?? []);
		trackedOrigins.add(binding);
		undoManager = new yjs.UndoManager(config.text, {
			...config.undo.options,
			trackedOrigins
		});
		ownsUndoManager = true;
	} else if (undoManager) {
		undoManager.addTrackedOrigin(binding);
	}

	const actionDisposables: M.IDisposable[] = [];
	if (undoManager && config.undo && config.undo.keybindings !== false) {
		const actionPrefix = `seorii.yjs.${context.side}`;
		actionDisposables.push(
			context.editor.addAction({
				id: `${actionPrefix}.undo`,
				label: 'Yjs Undo',
				keybindings: [context.monaco.KeyMod.CtrlCmd | context.monaco.KeyCode.KeyZ],
				run: () => undoManager?.undo()
			}),
			context.editor.addAction({
				id: `${actionPrefix}.redo`,
				label: 'Yjs Redo',
				keybindings: [
					context.monaco.KeyMod.CtrlCmd |
						context.monaco.KeyMod.Shift |
						context.monaco.KeyCode.KeyZ,
					context.monaco.KeyMod.CtrlCmd | context.monaco.KeyCode.KeyY
				],
				run: () => undoManager?.redo()
			})
		);
	}

	let disposed = false;
	return {
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const disposable of actionDisposables.reverse()) disposable.dispose();
			for (const [target, decorations] of binding._decorations) {
				if (!context.model.isDisposed()) target.deltaDecorations(decorations, []);
			}
			if (!context.model.isDisposed()) binding.destroy();
			for (const disposable of editorDisposables.reverse()) disposable.dispose();
			if (undoManager) {
				undoManager.removeTrackedOrigin(binding);
				if (ownsUndoManager) undoManager.destroy();
			}
			if (config.awareness && config.clearAwarenessSelection !== false) {
				config.awareness.setLocalStateField('selection', null);
			}
		}
	};
}

export function createYMonacoExtension({
	id = 'yjs',
	enabled = true,
	resolve
}: IYMonacoExtensionOptions): IMonacoExtension {
	return {
		id,
		enabled,
		async attachModel(context) {
			const config = typeof resolve === 'function' ? await resolve(context) : resolve;
			if (!config || context.signal.aborted) return;
			return createBinding(context, config);
		}
	};
}
