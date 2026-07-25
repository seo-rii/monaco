import Keybind from '$lib/extensions/keybind.js';
import setTheme from '$lib/extensions/theme.js';

export { Keybind, setTheme };
export {
	createMonacoExtensionHost,
	createMonacoRuntime,
	getMonacoRuntime
} from './runtime.js';
export {
	createMonacoFeatureActions,
	createMonacoLanguageFeaturesExtension,
	getMonacoProblems,
	isMonacoBuiltinFeatureEnabled,
	queryMonacoWorkspaceSymbols
} from './features.js';
export type {
	IMonacoEditorKind,
	IMonacoEditorSide,
	IMonacoExtension,
	IMonacoExtensionCleanup,
	IMonacoExtensionContext,
	IMonacoExtensionHost,
	IMonacoExtensionHostOptions,
	IMonacoExtensionResult,
	IMonacoExtensions,
	IMonacoModelExtensionContext,
	IMonacoRuntime
} from './runtime.js';
export type {
	IMonacoBuiltinFeature,
	IMonacoBuiltinFeatureOptions,
	IMonacoBuiltinFeatures,
	IMonacoCodeActionContribution,
	IMonacoFeatureActionOptions,
	IMonacoLanguageFeatureContributions,
	IMonacoLanguageFeaturesExtensionOptions,
	IMonacoProviderContribution,
	IMonacoWorkspaceSymbolProvider
} from './features.js';
