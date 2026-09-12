import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	ReleaseError,
	assertArchiveMatchesDist,
	assertCleanReleaseState,
	isExactSemver,
	parseArguments,
	runRelease,
	validatePackedPackage
} from './release-npm.mjs';

const baseManifest = {
	name: '@seorii/monaco',
	version: '0.2.0',
	scripts: { build: 'example' },
	files: ['dist'],
	exports: { '.': { types: './dist/index.d.ts', svelte: './dist/index.js' } },
	svelte: './dist/index.js',
	types: './dist/index.d.ts'
};

test('accepts exact stable and prerelease versions, including the current version', () => {
	assert.equal(isExactSemver('0.2.0'), true);
	assert.equal(isExactSemver('1.0.0-rc.1+build.5'), true);
	for (const invalid of ['v1.2.3', '1.2', '01.2.3', '^1.2.3', '1.2.3-01']) {
		assert.equal(isExactSemver(invalid), false, invalid);
	}
	assert.deepEqual(parseArguments(['0.2.0', '--publish']), {
		help: false,
		publish: true,
		resume: false,
		tag: 'latest',
		version: '0.2.0'
	});
	assert.equal(parseArguments(['1.0.0-rc.1', '--tag', 'next']).tag, 'next');
	assert.equal(parseArguments(['1.0.0', '--tag=stable']).tag, 'stable');
	assert.equal(parseArguments(['1.0.0+build-test']).tag, 'latest');
	assert.equal(parseArguments(['1.0.0', '--resume']).resume, true);
	assert.throws(() => parseArguments(['1.0.0-rc.1']), /non-latest dist-tag/);
	assert.throws(() => parseArguments(['0.3.0', '--unknown']), ReleaseError);
	assert.throws(() => parseArguments(['0.3.0', '--publish', '--dry-run']), ReleaseError);
});

test('allows only a rerunnable, unstaged package.json version change', () => {
	const bumped = { ...baseManifest, version: '0.3.0' };
	assert.doesNotThrow(() =>
		assertCleanReleaseState(' M package.json\0', baseManifest, bumped, '0.3.0')
	);
	assert.throws(
		() => assertCleanReleaseState('M  package.json\0', baseManifest, bumped, '0.3.0'),
		ReleaseError
	);
	assert.throws(
		() =>
			assertCleanReleaseState(
				' M package.json\0?? notes.txt\0',
				baseManifest,
				bumped,
				'0.3.0'
			),
		(error) => error instanceof ReleaseError && error.message.includes('notes.txt')
	);
	assert.throws(
		() =>
			assertCleanReleaseState(
				' M package.json\0',
				baseManifest,
				{ ...bumped, scripts: { build: 'changed' } },
				'0.3.0'
			),
		ReleaseError
	);
});

test('validates tarball identity, files, and all published entry points', () => {
	const files = [
		{ path: 'package.json' },
		{ path: 'dist/index.js' },
		{ path: 'dist/index.d.ts' }
	];
	assert.doesNotThrow(() =>
		validatePackedPackage({
			archiveEntries: files.map((file) => `package/${file.path}`),
			manifest: { ...baseManifest, version: '0.3.0' },
			packResult: { name: '@seorii/monaco', version: '0.3.0', files },
			expectedName: '@seorii/monaco',
			expectedVersion: '0.3.0'
		})
	);
	assert.throws(
		() =>
			validatePackedPackage({
				archiveEntries: ['package/package.json', 'package/dist/index.js'],
				manifest: { ...baseManifest, version: '0.3.0' },
				packResult: {
					name: '@seorii/monaco',
					version: '0.3.0',
					files: [{ path: 'package.json' }, { path: 'dist/index.js' }]
				},
				expectedName: '@seorii/monaco',
				expectedVersion: '0.3.0'
			}),
		/missing published entry point: dist\/index\.d\.ts/
	);
});

async function createFixture() {
	const projectRoot = await mkdtemp(path.join(tmpdir(), 'monaco-release-test-'));
	await mkdir(path.join(projectRoot, 'dist'), { recursive: true });
	await writeFile(
		path.join(projectRoot, 'package.json'),
		`${JSON.stringify(baseManifest, null, '\t')}\n`
	);
	await writeFile(path.join(projectRoot, 'dist/index.js'), 'export {};\n');
	await writeFile(path.join(projectRoot, 'dist/index.d.ts'), 'export {};\n');
	return projectRoot;
}

function createCommandRunner(commands, { publishedDist } = {}) {
	return async (command, args, options) => {
		commands.push({ command, args: [...args], options });
		if (command === 'git' && args[0] === 'status')
			return { stdout: '', stderr: '', exitCode: 0 };
		if (command === 'npm' && args[0] === 'whoami') {
			return { stdout: 'release-user\n', stderr: '', exitCode: 0 };
		}
		if (command === 'npm' && args[0] === 'view') {
			if (publishedDist) {
				return { stdout: `${JSON.stringify(publishedDist)}\n`, stderr: '', exitCode: 0 };
			}
			const error = new ReleaseError('npm view failed with E404');
			error.stderr = 'npm error code E404';
			throw error;
		}
		if (command === 'npm' && args[0] === 'run') return { stdout: '', stderr: '', exitCode: 0 };
		if (command === 'npm' && args[0] === 'pack' && args.includes('--dry-run')) {
			return {
				stdout: JSON.stringify([
					{
						name: '@seorii/monaco',
						version: '0.2.0',
						files: [
							{ path: 'package.json' },
							{ path: 'dist/index.js' },
							{ path: 'dist/index.d.ts' }
						]
					}
				]),
				stderr: '',
				exitCode: 0
			};
		}
		if (command === 'npm' && args[0] === 'pack') {
			const artifactRoot = args[args.indexOf('--pack-destination') + 1];
			const filename = 'seorii-monaco-0.3.0.tgz';
			await writeFile(path.join(artifactRoot, filename), 'test archive');
			return {
				stdout: JSON.stringify([
					{
						name: '@seorii/monaco',
						version: '0.3.0',
						filename,
						files: [
							{ path: 'package.json' },
							{ path: 'dist/index.js' },
							{ path: 'dist/index.d.ts' }
						]
					}
				]),
				stderr: '',
				exitCode: 0
			};
		}
		if (command === 'npm' && args[0] === 'publish') {
			return { stdout: '', stderr: '', exitCode: 0 };
		}
		throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
	};
}

test('dry run stages and verifies the requested version without mutation or publish', async () => {
	const projectRoot = await createFixture();
	const commands = [];
	let verifiedMode;
	await runRelease({
		argv: ['0.3.0'],
		projectRoot,
		runCommand: createCommandRunner(commands),
		verifyTarball: async ({ tarballPath, expectedVersion }) => {
			verifiedMode = (await stat(tarballPath)).mode & 0o777;
			assert.equal(expectedVersion, '0.3.0');
		},
		log: () => {}
	});

	const manifest = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
	assert.equal(manifest.version, '0.2.0');
	assert.equal(verifiedMode, 0o444);
	assert.deepEqual(
		commands
			.filter(({ command, args }) => command === 'npm' && args[0] === 'run')
			.map(({ args }) => args[1]),
		['check', 'build']
	);
	assert.equal(
		commands.some(({ command, args }) => command === 'npm' && args[0] === 'publish'),
		false
	);
});

test('--publish bumps package.json and publishes only the verified tarball', async () => {
	const projectRoot = await createFixture();
	const commands = [];
	let verified = false;
	await runRelease({
		argv: ['0.3.0', '--publish'],
		projectRoot,
		runCommand: createCommandRunner(commands),
		verifyTarball: async () => {
			verified = true;
		},
		log: () => {}
	});

	const manifest = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
	assert.equal(manifest.version, '0.3.0');
	const publishCommand = commands.find(
		({ command, args }) => command === 'npm' && args[0] === 'publish'
	);
	assert.equal(verified, true);
	assert.ok(publishCommand);
	assert.equal(publishCommand.args.includes('--ignore-scripts'), true);
	assert.equal(publishCommand.args.includes('--tag=latest'), true);
	assert.equal(publishCommand.args[1].endsWith('.tgz'), true);
});

test('--resume accepts matching npm integrity in dry-run mode and skips publish', async () => {
	const projectRoot = await createFixture();
	const commands = [];
	const archive = Buffer.from('test archive');
	const publishedDist = {
		integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
		shasum: createHash('sha1').update(archive).digest('hex')
	};
	const result = await runRelease({
		argv: ['0.3.0', '--resume'],
		projectRoot,
		runCommand: createCommandRunner(commands, { publishedDist }),
		verifyTarball: async () => {},
		log: () => {}
	});

	assert.deepEqual(result, { existing: true, published: false, version: '0.3.0' });
	assert.equal(
		commands.some(({ command, args }) => command === 'npm' && args[0] === 'publish'),
		false
	);
	const manifest = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
	assert.equal(manifest.version, '0.2.0');
});

test('an existing target fails before build unless --resume is supplied', async () => {
	const projectRoot = await createFixture();
	const commands = [];
	await assert.rejects(
		() =>
			runRelease({
				argv: ['0.3.0'],
				projectRoot,
				runCommand: createCommandRunner(commands, {
					publishedDist: { integrity: 'sha512-existing', shasum: 'existing-sha1' }
				}),
				verifyTarball: async () => {},
				log: () => {}
			}),
		/already published/
	);
	assert.equal(
		commands.some(({ command, args }) => command === 'npm' && args[0] === 'run'),
		false
	);
});

test('--resume requires both npm hashes to match', () => {
	assert.throws(
		() =>
			assertArchiveMatchesDist(
				{ integrity: 'sha512-matching', shasum: 'local-sha1' },
				{ integrity: 'sha512-matching', shasum: 'remote-sha1' }
			),
		/both|SHA-512/
	);
});
