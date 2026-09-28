'use strict';

const {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
} = require('node:fs');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const defaultApp = path.join(root, 'release', 'TorLink.app');
const defaultZip = path.join(root, 'release', 'TorLink-macOS-Apple-Silicon.zip');
const app = path.resolve(process.argv[2] || defaultApp);
const zip = path.resolve(process.argv[3] || defaultZip);
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLockPath = path.join(root, 'package-lock.json');
const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf8'));
const expectedIcon = readFileSync(path.join(root, 'assets', 'app-icon', 'TorLink.icns'));
const bundleId = 'com.maskwasam.torlink.portable';
const nodeVersion = 'v22.23.2';
const nodeArchiveSha256 = '61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6';
const transmissionVersion = '4.1.3';
const transmissionSha256 = '860b7a35132035c51baca6e3fe149e6a6b63c7b43c0bf8f7c8ef3b3ec5de184d';
const transmissionLibrarySha256 = new Map([
  ['libevent-2.1.7.dylib', '2435769970a3828931999e0d411f68b80375521425afa2de0d6f3740c3966b68'],
  ['libpsl.5.dylib', '6e5904cc174b7daabbe87b647bb76e9a9ef1a3cda252b15416e23a16c8a9f275'],
  ['libminiupnpc.21.dylib', 'f70697e780797eb499b914bc1293a0c6c85b1771ec976381bd093197d62a7bc5'],
]);
const manifestName = 'release-manifest.json';
const allowFinderMetadata = process.env.TORLINK_ALLOW_FINDER_METADATA === '1';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.trim();
}

function combinedOutput(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} failed${detail ? `: ${detail}` : ''}`);
  }
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function sha256Tree(directory) {
  const hash = createHash('sha256');

  function visit(current, relative) {
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      const childRelative = relative
        ? `${relative}/${entry.name}`
        : entry.name;
      const stat = lstatSync(target);
      if (entry.isDirectory()) {
        hash.update(`D\0${childRelative}\0${stat.mode & 0o777}\0`);
        visit(target, childRelative);
      } else if (entry.isSymbolicLink()) {
        hash.update(`L\0${childRelative}\0${stat.mode & 0o777}\0${readlinkSync(target)}\0`);
      } else if (entry.isFile()) {
        hash.update(`F\0${childRelative}\0${stat.mode & 0o777}\0${stat.size}\0`);
        hash.update(readFileSync(target));
        hash.update('\0');
      } else {
        throw new Error(`Unsupported entry in portable runtime: ${target}`);
      }
    }
  }

  visit(directory, '');
  return hash.digest('hex');
}

function plistValue(plist, key) {
  return run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]);
}

function architectures(file) {
  return run('/usr/bin/lipo', ['-archs', file]).split(/\s+/).filter(Boolean);
}

function dependencies(file) {
  return run('/usr/bin/otool', ['-L', file])
    .split('\n')
    .slice(1)
    .map((line) => line.trim().match(/^(\S+)\s+\(compatibility version/)?.[1])
    .filter(Boolean);
}

function isSystemDependency(file) {
  return file.startsWith('/usr/lib/') || file.startsWith('/System/Library/');
}

function lockedProductionPackages() {
  return Object.entries(packageLock.packages)
    .filter(([packagePath, metadata]) => packagePath.startsWith('node_modules/') && metadata.dev !== true)
    .map(([packagePath, metadata]) => ({
      path: packagePath.slice('node_modules/'.length),
      name: metadata.name ?? packagePath.split('node_modules/').at(-1),
      version: metadata.version,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function minimumVersions(file) {
  return [...run('/usr/bin/otool', ['-l', file]).matchAll(/\bminos\s+([0-9]+(?:\.[0-9]+){1,2})/g)]
    .map((match) => match[1]);
}

function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function verifyApp(target, options = {}) {
  const contents = path.join(target, 'Contents');
  const resources = path.join(contents, 'Resources');
  const plist = path.join(contents, 'Info.plist');
  const manifestPath = path.join(resources, manifestName);
  if (!existsSync(plist)) throw new Error(`No app bundle found at ${target}`);
  if (!existsSync(manifestPath)) throw new Error(`Release manifest is missing from ${target}`);

  const signatureArgs = ['--verify', '--deep'];
  if (!options.allowFinderMetadata) signatureArgs.push('--strict');
  run('/usr/bin/codesign', [...signatureArgs, target]);

  run('/usr/bin/plutil', ['-lint', plist]);
  if (plistValue(plist, 'CFBundleIdentifier') !== bundleId) throw new Error('Unexpected bundle identifier.');
  if (plistValue(plist, 'CFBundlePackageType') !== 'APPL') throw new Error('Unexpected bundle type.');
  if (plistValue(plist, 'CFBundleShortVersionString') !== packageJson.version) {
    throw new Error('The app version does not match package.json.');
  }
  if (plistValue(plist, 'CFBundleVersion') !== packageJson.version) {
    throw new Error('The app build version does not match package.json.');
  }
  if (plistValue(plist, 'LSUIElement') !== 'true') throw new Error('The launcher must be an agent app.');
  if (plistValue(plist, 'CFBundleIconFile') !== 'TorLink.icns') throw new Error('Unexpected icon metadata.');
  if (!readFileSync(path.join(resources, 'TorLink.icns')).equals(expectedIcon)) {
    throw new Error('The portable icon is stale.');
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error('Unexpected release manifest schema.');
  if (manifest.bundleIdentifier !== bundleId) throw new Error('Manifest bundle identifier is incorrect.');
  if (manifest.appVersion !== packageJson.version) throw new Error('Manifest app version is incorrect.');
  if (manifest.platform !== 'darwin' || manifest.architecture !== 'arm64') {
    throw new Error('Manifest platform or architecture is incorrect.');
  }
  if (manifest.minimumMacOS !== plistValue(plist, 'LSMinimumSystemVersion')) {
    throw new Error('Manifest minimum macOS version does not match Info.plist.');
  }

  const launcher = path.join(contents, 'MacOS', plistValue(plist, 'CFBundleExecutable'));
  const node = path.join(resources, 'bin', 'node');
  const transmission = path.join(resources, 'bin', 'transmission-daemon');
  const command = path.join(resources, 'Open TorLink.command');
  const torlink = path.join(resources, 'app', 'dist', 'cli.cjs');
  const appRuntime = path.join(resources, 'app');
  for (const executable of [launcher, node, transmission, command]) {
    accessSync(executable, constants.X_OK);
  }
  if (!existsSync(torlink)) throw new Error('The portable TorLink JavaScript build is missing.');

  const launcherArchitectures = architectures(launcher);
  if (!launcherArchitectures.includes('arm64') || !launcherArchitectures.includes('x86_64')) {
    throw new Error(`The launcher is not universal: ${launcherArchitectures.join(', ')}`);
  }
  if (architectures(node).join(' ') !== 'arm64') throw new Error('Bundled Node is not arm64-only.');
  if (architectures(transmission).join(' ') !== 'arm64') {
    throw new Error('Bundled transmission-daemon is not arm64-only.');
  }
  if (
    manifest.node?.version !== nodeVersion.slice(1)
    || manifest.node?.archiveSha256 !== nodeArchiveSha256
    || manifest.node?.bundledSha256 !== sha256(node)
  ) {
    throw new Error('Bundled Node does not match the pinned release manifest.');
  }
  if (run(node, ['--version']) !== nodeVersion) throw new Error('Unexpected bundled Node version.');
  if (run(node, [torlink, '--version'], { cwd: os.tmpdir() }) !== `torlink v${packageJson.version}`) {
    throw new Error('The isolated portable TorLink bundle did not report the expected version.');
  }
  if (
    manifest.transmission?.version !== transmissionVersion
    || manifest.transmission?.sourceSha256 !== transmissionSha256
    || manifest.transmission?.bundledSha256 !== sha256(transmission)
  ) {
    throw new Error('Bundled Transmission does not match the pinned release manifest.');
  }
  const reportedTransmissionVersion = combinedOutput(transmission, ['--version']);
  if (!reportedTransmissionVersion.startsWith(`transmission-daemon ${transmissionVersion} (`)) {
    throw new Error(`Unexpected bundled Transmission version: ${reportedTransmissionVersion}`);
  }

  if (!Array.isArray(manifest.libraries)) throw new Error('Manifest library inventory is missing.');
  const manifestLibraryNames = manifest.libraries.map((entry) => entry.name).sort();
  const expectedLibraryNames = [...transmissionLibrarySha256.keys()].sort();
  if (JSON.stringify(manifestLibraryNames) !== JSON.stringify(expectedLibraryNames)) {
    throw new Error('Manifest library inventory does not match the pinned Transmission closure.');
  }

  const libraryDirectory = path.join(resources, 'lib');
  const libraryNames = readdirSync(libraryDirectory).sort();
  if (JSON.stringify(libraryNames) !== JSON.stringify(expectedLibraryNames)) {
    throw new Error('Bundled library directory does not match the pinned Transmission closure.');
  }
  const libraries = libraryNames.map((name) => path.join(libraryDirectory, name));
  if (libraries.length === 0) throw new Error('No Transmission runtime libraries were bundled.');
  for (const entry of manifest.libraries) {
    const expectedSourceSha = transmissionLibrarySha256.get(entry.name);
    const library = path.join(libraryDirectory, entry.name);
    if (entry.sourceSha256 !== expectedSourceSha || entry.bundledSha256 !== sha256(library)) {
      throw new Error(`Bundled library does not match the pinned manifest: ${entry.name}`);
    }
  }

  if (
    typeof manifest.applicationRuntime?.sha256 !== 'string'
    || manifest.applicationRuntime.sha256 !== sha256Tree(appRuntime)
  ) {
    throw new Error('The staged JavaScript runtime does not match its release manifest.');
  }
  if (
    !Array.isArray(manifest.applicationRuntime.productionPackages)
    || manifest.applicationRuntime.productionPackages.length === 0
  ) {
    throw new Error('The production package inventory is missing.');
  }
  const embeddedPackageLock = path.join(resources, 'Provenance', 'package-lock.json');
  const expectedPackageLockSha = sha256(packageLockPath);
  if (
    !existsSync(embeddedPackageLock)
    || manifest.applicationRuntime.packageLockSha256 !== expectedPackageLockSha
    || sha256(embeddedPackageLock) !== expectedPackageLockSha
  ) {
    throw new Error('The embedded npm lockfile does not match the source-controlled release input.');
  }
  const expectedPackages = lockedProductionPackages();
  if (
    JSON.stringify(manifest.applicationRuntime.productionPackages)
    !== JSON.stringify(expectedPackages)
  ) {
    throw new Error('The production package inventory does not match package-lock.json.');
  }
  for (const entry of manifest.applicationRuntime.productionPackages) {
    if (
      typeof entry.path !== 'string'
      || path.isAbsolute(entry.path)
      || entry.path.split('/').includes('..')
    ) {
      throw new Error('The production package inventory contains an unsafe path.');
    }
    const metadataPath = path.join(appRuntime, 'node_modules', ...entry.path.split('/'), 'package.json');
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    if (metadata.name !== entry.name || metadata.version !== entry.version) {
      throw new Error(`Production package inventory mismatch: ${entry.path}`);
    }
  }
  for (const macho of [launcher, node, transmission, ...libraries]) {
    const archs = architectures(macho);
    if (macho !== launcher && !archs.includes('arm64')) {
      throw new Error(`Bundled runtime is missing arm64: ${macho}`);
    }
  }

  for (const macho of [launcher, node]) {
    for (const dependency of dependencies(macho)) {
      if (!isSystemDependency(dependency)) {
        throw new Error(`${path.basename(macho)} has an unsupported dependency: ${dependency}`);
      }
    }
  }
  for (const dependency of dependencies(transmission)) {
    if (isSystemDependency(dependency)) continue;
    const prefix = '@executable_path/../lib/';
    if (!dependency.startsWith(prefix) || !expectedLibraryNames.includes(dependency.slice(prefix.length))) {
      throw new Error(`Transmission has an unsupported dependency: ${dependency}`);
    }
  }
  for (const library of libraries) {
    const ownId = `@rpath/${path.basename(library)}`;
    for (const dependency of dependencies(library)) {
      if (isSystemDependency(dependency) || dependency === ownId) continue;
      const prefix = '@loader_path/';
      if (!dependency.startsWith(prefix) || !expectedLibraryNames.includes(dependency.slice(prefix.length))) {
        throw new Error(`${path.basename(library)} has an unsupported dependency: ${dependency}`);
      }
    }
  }

  const declaredMinimum = plistValue(plist, 'LSMinimumSystemVersion');
  for (const macho of [launcher, node, transmission, ...libraries]) {
    for (const actualMinimum of minimumVersions(macho)) {
      if (compareVersions(actualMinimum, declaredMinimum) > 0) {
        throw new Error(`${path.basename(macho)} needs macOS ${actualMinimum}, above declared ${declaredMinimum}`);
      }
    }
  }

  const commandText = readFileSync(command, 'utf8');
  if (!commandText.includes('${BASH_SOURCE[0]}') || !commandText.includes('$RESOURCES/bin/node')) {
    throw new Error('The bundled command does not resolve its runtime relative to itself.');
  }
  if (commandText.includes(root) || existsSync(path.join(resources, 'project-root'))) {
    throw new Error('The portable app still contains a checkout marker.');
  }
  for (const required of ['Node-LICENSE.txt', 'TorLink-LICENSE.txt', 'Transmission-COPYING.txt']) {
    if (!existsSync(path.join(resources, 'Licenses', required))) {
      throw new Error(`Required license is missing: ${required}`);
    }
  }

  return { declaredMinimum, node, torlink };
}

if (process.platform !== 'darwin') throw new Error('Portable TorLink verification requires macOS.');
const verified = verifyApp(app, { allowFinderMetadata });
if (!existsSync(zip)) throw new Error(`Transfer ZIP is missing: ${zip}`);

const extraction = mkdtempSync(path.join(os.tmpdir(), 'torlink-portable-verify-'));
try {
  run('/usr/bin/ditto', ['-x', '-k', zip, extraction]);
  const extractedApp = path.join(extraction, 'TorLink.app');
  verifyApp(extractedApp);
} finally {
  rmSync(extraction, { recursive: true, force: true });
}

const zipSha = createHash('sha256').update(readFileSync(zip)).digest('hex');
console.log(`Verified ${app}`);
console.log(`Verified extracted copy from ${zip}`);
console.log(`Requires Apple silicon and macOS ${verified.declaredMinimum} or later`);
console.log(`ZIP SHA-256: ${zipSha}`);
