import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const monacoMockId = '\0monaco-editor-custom-language-test';

function compileMonarchRegex(regex, language) {
	let source = regex.source.replace(/@@/g, '\u0001');
	for (let expansion = 0; expansion < 5; expansion += 1) {
		let expanded = false;
		source = source.replace(/@(\w+)/g, (_match, attribute) => {
			expanded = true;
			const value = language[attribute];
			if (typeof value === 'string') return `(?:${value})`;
			if (value instanceof RegExp) return `(?:${value.source})`;
			throw new Error(`missing Monarch attribute: ${attribute}`);
		});
		if (!expanded) break;
	}
	return new RegExp(source.split('\u0001').join('@'));
}

test('all custom tokenizers compile and Objective-C++ recognizes @ keywords', async (context) => {
	const server = await createServer({
		appType: 'custom',
		configFile: false,
		logLevel: 'silent',
		root: projectRoot,
		ssr: { noExternal: ['monaco-editor'] },
		plugins: [
			{
				name: 'mock-monaco-editor',
				enforce: 'pre',
				resolveId(id) {
					if (id === 'monaco-editor') return monacoMockId;
				},
				load(id) {
					if (id === monacoMockId) return 'export const languages = {}';
				}
			}
		]
	});
	context.after(() => server.close());

	const { registerAonohakoLanguages } = await server.ssrLoadModule('/src/lib/customLanguages.ts');
	const tokenizers = new Map();
	const disposable = { dispose() {} };
	const monaco = {
		languages: {
			getLanguages: () => [],
			register: () => disposable,
			setLanguageConfiguration: () => disposable,
			setMonarchTokensProvider(id, language) {
				tokenizers.set(id, language);
				return disposable;
			}
		}
	};

	registerAonohakoLanguages(monaco);
	for (const [id, language] of tokenizers) {
		for (const rules of Object.values(language.tokenizer)) {
			for (const [regex] of rules) {
				assert.doesNotThrow(() => compileMonarchRegex(regex, language), id);
			}
		}
	}

	const objectiveCpp = tokenizers.get('objective-cpp');
	assert.ok(objectiveCpp);
	const [keywordRegex] = objectiveCpp.tokenizer.root.find((rule) => rule[1] === 'keyword');
	const compiledKeywordRegex = compileMonarchRegex(keywordRegex, objectiveCpp);
	assert.equal(compiledKeywordRegex.test('@class'), true);
	assert.equal(compiledKeywordRegex.test('@classification'), false);
	assert.equal(compiledKeywordRegex.test('class'), true);
	assert.equal(compiledKeywordRegex.test('className'), false);
});
