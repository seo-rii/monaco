#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const NPM_REGISTRY = 'https://registry.npmjs.org/';

const PACKAGE_NAME = '@seorii/monaco';
const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const USAGE = `Usage: npm run release:npm -- <version> [--tag <dist-tag>] [--resume] [--publish]

Without --publish, the command authenticates, checks npm, builds, packs, and
validates the requested version without changing package.json or publishing it.
Add --publish to retain the version bump and publish the verified tarball.
Use --resume to verify and skip a target version that npm already contains.`;

export class ReleaseError extends Error {}

export function isExactSemver(version) {
	return SEMVER_PATTERN.test(version);
}

export function parseArguments(argv) {
	let publish = false;
	let dryRun = false;
	let help = false;
	let resume = false;
	let tag = 'latest';
	const positional = [];

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--publish') {
			publish = true;
		} else if (argument === '--dry-run') {
			dryRun = true;
		} else if (argument === '--resume') {
			resume = true;
		} else if (argument === '--tag') {
			tag = argv[index + 1];
			index += 1;
		} else if (argument.startsWith('--tag=')) {
			tag = argument.slice('--tag='.length);
		} else if (argument === '--help' || argument === '-h') {
			help = true;
		} else if (argument.startsWith('-')) {
			throw new ReleaseError(`Unknown option: ${argument}\n\n${USAGE}`);
		} else {
			positional.push(argument);
		}
	}

	if (help) {
		return { help: true, publish: false, resume: false, tag: 'latest', version: undefined };
	}
	if (publish && dryRun) {
		throw new ReleaseError('--publish and --dry-run cannot be used together.');
	}
	if (positional.length !== 1) {
		throw new ReleaseError(`Exactly one version is required.\n\n${USAGE}`);
	}
	if (!isExactSemver(positional[0])) {
		throw new ReleaseError(`Version must be an exact SemVer value: ${positional[0]}`);
	}
	if (typeof tag !== 'string' || !/^[a-z][a-z0-9._-]*$/.test(tag)) {
		throw new ReleaseError(`Invalid npm dist-tag: ${tag ?? '(missing)'}`);
	}
	if (positional[0].split('+', 1)[0].includes('-') && tag === 'latest') {
		throw new ReleaseError(
			'Prerelease versions require a non-latest dist-tag, for example --tag next.'
		);
	}

	return { help: false, publish, resume, tag, version: positional[0] };
}

function formatManifest(manifest, originalSource) {
	const indentation = originalSource.match(/\n([\t ]+)"/)?.[1] ?? '\t';
	const trailingNewline = originalSource.endsWith('\n') ? '\n' : '';
	return `${JSON.stringify(manifest, null, indentation)}${trailingNewline}`;
}

function withoutVersion(manifest) {
	const copy = structuredClone(manifest);
	delete copy.version;
	return copy;
}

export function isOnlyIntendedVersionChange(headManifest, currentManifest, targetVersion) {
	return (
		currentManifest.version === targetVersion &&
		JSON.stringify(withoutVersion(headManifest)) ===
			JSON.stringify(withoutVersion(currentManifest))
	);
}

export function assertCleanReleaseState(
	statusOutput,
	headManifest,
	currentManifest,
	targetVersion
) {
	const entries = statusOutput.split('\0').filter(Boolean);
	if (entries.length === 0) return;

	const onlyUnstagedPackageJson =
		entries.length === 1 &&
		entries[0].slice(0, 2) === ' M' &&
		entries[0].slice(3) === 'package.json';
	if (
		onlyUnstagedPackageJson &&
		headManifest &&
		isOnlyIntendedVersionChange(headManifest, currentManifest, targetVersion)
	) {
		return;
	}

	const dirtyPaths = entries.map((entry) => entry.slice(3)).join('\n  - ');
	throw new ReleaseError(
		`The worktree must be clean. Commit or stash these paths first:\n  - ${dirtyPaths}\nA previous release attempt may leave only the requested package.json version change.`
	);
}

function parseJsonOutput(output, description) {
	try {
		return JSON.parse(output.trim());
	} catch {
		throw new ReleaseError(`${description} returned invalid JSON.`);
	}
}

function parsePackResult(output) {
	const parsed = parseJsonOutput(output, 'npm pack');
	if (!Array.isArray(parsed) || parsed.length !== 1 || typeof parsed[0] !== 'object') {
		throw new ReleaseError('npm pack returned an unexpected result.');
	}
	return parsed[0];
}

function normalizePublishedDist(output) {
	if (!output.trim()) throw new ReleaseError('npm view returned no dist metadata.');
	const parsed = parseJsonOutput(output, 'npm view');
	if (
		!parsed ||
		typeof parsed !== 'object' ||
		typeof parsed.integrity !== 'string' ||
		typeof parsed.shasum !== 'string'
	) {
		throw new ReleaseError('npm view returned incomplete dist integrity metadata.');
	}
	return { integrity: parsed.integrity, shasum: parsed.shasum };
}

export async function computeArchiveHashes(filename) {
	const archive = await readFile(filename);
	return {
		integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
		shasum: createHash('sha1').update(archive).digest('hex')
	};
}

export function assertArchiveMatchesDist(archiveHashes, publishedDist) {
	if (
		archiveHashes.integrity !== publishedDist.integrity ||
		archiveHashes.shasum !== publishedDist.shasum
	) {
		throw new ReleaseError(
			'The locally packed tarball does not match the existing npm SHA-512 integrity and SHA-1 shasum.'
		);
	}
}

function safePackagePath(relativePath) {
	return (
		typeof relativePath === 'string' &&
		relativePath.length > 0 &&
		!relativePath.startsWith('/') &&
		!relativePath.includes('\\') &&
		!relativePath.split('/').includes('..')
	);
}

function collectManifestTargets(value, targets = new Set()) {
	if (typeof value === 'string') {
		if (value.startsWith('./')) targets.add(value.slice(2));
		return targets;
	}
	if (value && typeof value === 'object') {
		for (const nested of Object.values(value)) collectManifestTargets(nested, targets);
	}
	return targets;
}

export function validatePackedPackage({
	archiveEntries,
	manifest,
	packResult,
	expectedName,
	expectedVersion
}) {
	if (packResult.name !== expectedName || packResult.version !== expectedVersion) {
		throw new ReleaseError(
			`Packed metadata mismatch: expected ${expectedName}@${expectedVersion}, got ${packResult.name}@${packResult.version}.`
		);
	}
	if (manifest.name !== expectedName || manifest.version !== expectedVersion) {
		throw new ReleaseError(
			'The package.json inside the tarball has unexpected name or version metadata.'
		);
	}

	const files = packResult.files?.map((file) => file.path);
	if (
		!Array.isArray(files) ||
		files.length === 0 ||
		files.some((file) => !safePackagePath(file))
	) {
		throw new ReleaseError('npm pack reported an invalid or empty file list.');
	}

	const archiveFiles = archiveEntries.filter((entry) => !entry.endsWith('/'));
	if (
		archiveFiles.some(
			(entry) =>
				!entry.startsWith('package/') || !safePackagePath(entry.slice('package/'.length))
		)
	) {
		throw new ReleaseError('The tarball contains an unsafe path.');
	}

	const expectedArchiveFiles = new Set(files.map((file) => `package/${file}`));
	const actualArchiveFiles = new Set(archiveFiles);
	if (
		expectedArchiveFiles.size !== actualArchiveFiles.size ||
		[...expectedArchiveFiles].some((file) => !actualArchiveFiles.has(file))
	) {
		throw new ReleaseError('The tarball contents differ from the npm pack file manifest.');
	}

	if (!actualArchiveFiles.has('package/package.json')) {
		throw new ReleaseError('The tarball does not contain package.json.');
	}
	if (![...actualArchiveFiles].some((file) => file.startsWith('package/dist/'))) {
		throw new ReleaseError('The tarball does not contain built dist files.');
	}
	if ([...actualArchiveFiles].some((file) => /\.(?:test|spec)\.[^/]+$/.test(file))) {
		throw new ReleaseError('The tarball contains test or spec files.');
	}

	const publishedTargets = collectManifestTargets({
		exports: manifest.exports,
		svelte: manifest.svelte,
		types: manifest.types
	});
	for (const target of publishedTargets) {
		if (!actualArchiveFiles.has(`package/${target}`)) {
			throw new ReleaseError(`The tarball is missing published entry point: ${target}`);
		}
	}
}

export async function defaultRunCommand(command, args, { cwd, stdio = 'pipe' } = {}) {
	return await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			stdio: stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe']
		});
		let stdout = '';
		let stderr = '';

		if (stdio !== 'inherit') {
			child.stdout.setEncoding('utf8');
			child.stderr.setEncoding('utf8');
			child.stdout.on('data', (chunk) => (stdout += chunk));
			child.stderr.on('data', (chunk) => (stderr += chunk));
		}

		child.on('error', reject);
		child.on('close', (exitCode) => {
			if (exitCode === 0) {
				resolve({ stdout, stderr, exitCode });
				return;
			}
			const error = new ReleaseError(
				`${command} ${args.join(' ')} failed with exit code ${exitCode}.${stderr ? `\n${stderr.trim()}` : ''}`
			);
			error.exitCode = exitCode;
			error.stdout = stdout;
			error.stderr = stderr;
			reject(error);
		});
	});
}

async function readManifest(filename) {
	const source = await readFile(filename, 'utf8');
	return { manifest: JSON.parse(source), source };
}

async function checkWorktree(projectRoot, manifest, targetVersion, runCommand) {
	const { stdout: statusOutput } = await runCommand(
		'git',
		['status', '--porcelain=v1', '-z', '--untracked-files=all'],
		{ cwd: projectRoot }
	);

	let headManifest;
	if (statusOutput) {
		try {
			const { stdout } = await runCommand('git', ['show', 'HEAD:package.json'], {
				cwd: projectRoot
			});
			headManifest = JSON.parse(stdout);
		} catch {
			throw new ReleaseError('Could not compare the changed package.json with HEAD.');
		}
	}

	assertCleanReleaseState(statusOutput, headManifest, manifest, targetVersion);
}

async function checkNpm(projectRoot, packageName, version, resume, runCommand) {
	let whoami;
	try {
		whoami = await runCommand('npm', ['whoami', `--registry=${NPM_REGISTRY}`], {
			cwd: projectRoot
		});
	} catch {
		throw new ReleaseError(
			`npm authentication failed for ${NPM_REGISTRY}. Run npm login and try again.`
		);
	}
	if (!whoami.stdout.trim()) {
		throw new ReleaseError(`npm authentication returned no user for ${NPM_REGISTRY}.`);
	}

	let publishedDist;
	try {
		const result = await runCommand(
			'npm',
			['view', `${packageName}@${version}`, 'dist', '--json', `--registry=${NPM_REGISTRY}`],
			{ cwd: projectRoot }
		);
		publishedDist = normalizePublishedDist(result.stdout);
	} catch (error) {
		if (!/\bE404\b|404 Not Found/i.test(`${error.stderr ?? ''}\n${error.message ?? ''}`))
			throw error;
	}

	if (publishedDist && !resume) {
		throw new ReleaseError(`${packageName}@${version} is already published to npm.`);
	}
	return publishedDist;
}

async function copyPackFiles(projectRoot, stagingRoot, packResult, stagedManifestSource) {
	for (const file of packResult.files ?? []) {
		if (!safePackagePath(file.path))
			throw new ReleaseError(`npm pack reported an unsafe path: ${file.path}`);
		const source = path.resolve(projectRoot, file.path);
		const destination = path.resolve(stagingRoot, file.path);
		if (
			!source.startsWith(`${projectRoot}${path.sep}`) ||
			!destination.startsWith(`${stagingRoot}${path.sep}`)
		) {
			throw new ReleaseError(`Refusing to stage path outside the package: ${file.path}`);
		}
		await mkdir(path.dirname(destination), { recursive: true });
		if (file.path === 'package.json') await writeFile(destination, stagedManifestSource);
		else await copyFile(source, destination);
	}
}

export async function verifyPackedTarball({
	tarballPath,
	packResult,
	expectedName,
	expectedVersion,
	runCommand = defaultRunCommand
}) {
	const { stdout: entryOutput } = await runCommand('tar', ['-tzf', tarballPath], {
		cwd: path.dirname(tarballPath)
	});
	const { stdout: manifestOutput } = await runCommand(
		'tar',
		['-xOzf', tarballPath, 'package/package.json'],
		{ cwd: path.dirname(tarballPath) }
	);
	const archiveEntries = entryOutput.split('\n').filter(Boolean);
	const manifest = JSON.parse(manifestOutput);
	validatePackedPackage({ archiveEntries, manifest, packResult, expectedName, expectedVersion });
}

export async function runRelease({
	argv,
	projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
	runCommand = defaultRunCommand,
	verifyTarball = verifyPackedTarball,
	log = console.log
} = {}) {
	const options = parseArguments(argv ?? process.argv.slice(2));
	if (options.help) {
		log(USAGE);
		return { help: true };
	}

	const manifestPath = path.join(projectRoot, 'package.json');
	const { manifest, source: manifestSource } = await readManifest(manifestPath);
	if (manifest.name !== PACKAGE_NAME) {
		throw new ReleaseError(
			`Expected ${PACKAGE_NAME}, found ${manifest.name ?? 'an unnamed package'}.`
		);
	}
	if (manifest.private === true) throw new ReleaseError(`${PACKAGE_NAME} is marked private.`);

	await checkWorktree(projectRoot, manifest, options.version, runCommand);
	log(`[release:npm] checking npm authentication and ${PACKAGE_NAME}@${options.version}`);
	const publishedDist = await checkNpm(
		projectRoot,
		PACKAGE_NAME,
		options.version,
		options.resume,
		runCommand
	);

	const releaseManifest = { ...manifest, version: options.version };
	const releaseManifestSource = formatManifest(releaseManifest, manifestSource);
	if (options.publish && manifest.version !== options.version) {
		await writeFile(manifestPath, releaseManifestSource);
		log(`[release:npm] updated package.json: ${manifest.version} -> ${options.version}`);
	}

	let temporaryRoot;
	try {
		log('[release:npm] checking, building, and validating the package');
		await runCommand('npm', ['run', 'check'], { cwd: projectRoot, stdio: 'inherit' });
		await runCommand('npm', ['run', 'build'], { cwd: projectRoot, stdio: 'inherit' });

		const { stdout: dryPackOutput } = await runCommand(
			'npm',
			['pack', '--dry-run', '--json', '--ignore-scripts'],
			{ cwd: projectRoot }
		);
		const dryPackResult = parsePackResult(dryPackOutput);
		temporaryRoot = await mkdtemp(path.join(tmpdir(), 'seorii-monaco-release-'));
		const stagingRoot = path.join(temporaryRoot, 'package');
		const artifactRoot = path.join(temporaryRoot, 'artifact');
		await mkdir(stagingRoot, { recursive: true });
		await mkdir(artifactRoot, { recursive: true });
		await copyPackFiles(projectRoot, stagingRoot, dryPackResult, releaseManifestSource);

		const { stdout: packOutput } = await runCommand(
			'npm',
			['pack', stagingRoot, '--json', '--ignore-scripts', '--pack-destination', artifactRoot],
			{ cwd: projectRoot }
		);
		const packResult = parsePackResult(packOutput);
		if (!packResult.filename || path.basename(packResult.filename) !== packResult.filename) {
			throw new ReleaseError('npm pack returned an unsafe tarball filename.');
		}
		const tarballPath = path.join(artifactRoot, packResult.filename);
		await stat(tarballPath);
		await chmod(tarballPath, 0o444);
		await verifyTarball({
			tarballPath,
			packResult,
			expectedName: PACKAGE_NAME,
			expectedVersion: options.version,
			runCommand
		});
		const archiveHashes = await computeArchiveHashes(tarballPath);
		log(`[release:npm] verified ${packResult.filename} (${packResult.files.length} files)`);
		if (publishedDist) {
			assertArchiveMatchesDist(archiveHashes, publishedDist);
			log(
				`[release:npm] ${PACKAGE_NAME}@${options.version} already exists with matching integrity; skipping publish`
			);
			return { existing: true, published: false, version: options.version };
		}

		if (options.publish) {
			log(
				`[release:npm] publishing ${PACKAGE_NAME}@${options.version} with tag ${options.tag}`
			);
			await runCommand(
				'npm',
				[
					'publish',
					tarballPath,
					'--access=public',
					`--tag=${options.tag}`,
					'--ignore-scripts',
					`--registry=${NPM_REGISTRY}`
				],
				{ cwd: projectRoot, stdio: 'inherit' }
			);
			log(`[release:npm] published ${PACKAGE_NAME}@${options.version}`);
		} else {
			log(
				'[release:npm] dry run complete; package.json was not changed and nothing was published'
			);
			log(`Run npm run release:npm -- ${options.version} --publish to publish this version.`);
		}

		return { published: options.publish, version: options.version };
	} finally {
		if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
	}
}

const isDirectExecution =
	process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectExecution) {
	runRelease().catch((error) => {
		console.error(`[release:npm] ${error.message}`);
		process.exitCode = 1;
	});
}
