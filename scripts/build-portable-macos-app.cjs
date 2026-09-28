'use strict';

const {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release');
const outputApp = path.join(releaseDir, 'TorLink.app');
const outputZip = path.join(releaseDir, 'TorLink-macOS-Apple-Silicon.zip');
const cacheDir = path.join(root, 'macos', '.runtime-cache');
const icon = path.join(root, 'assets', 'app-icon', 'TorLink.icns');
const launcherSource = path.join(root, 'macos', 'portable-launcher.m');
const commandSource = path.join(root, 'macos', 'portable-launch.command');
const packageLock = path.join(root, 'package-lock.json');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const bundleId = 'com.maskwasam.torlink.portable';
const nodeVersion = '22.23.2';
const nodeArchiveName = `node-v${nodeVersion}-darwin-arm64.tar.gz`;
const nodeArchiveUrl = `https://nodejs.org/dist/v${nodeVersion}/${nodeArchiveName}`;
const nodeArchiveSha256 = '61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6';
const transmissionVersion = '4.1.3';
const transmissionSha256 = '860b7a35132035c51baca6e3fe149e6a6b63c7b43c0bf8f7c8ef3b3ec5de184d';
const defaultTransmissionDaemon = '/opt/homebrew/bin/transmission-daemon';
const transmissionLibrarySha256 = new Map([
  ['libevent-2.1.7.dylib', '2435769970a3828931999e0d411f68b80375521425afa2de0d6f3740c3966b68'],
  ['libpsl.5.dylib', '6e5904cc174b7daabbe87b647bb76e9a9ef1a3cda252b15416e23a16c8a9f275'],
  ['libminiupnpc.21.dylib', 'f70697e780797eb499b914bc1293a0c6c85b1771ec976381bd093197d62a7bc5'],
]);
const manifestName = 'release-manifest.json';

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
  const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function assertReplaceableApp(app) {
  if (!existsSync(app)) return;
  const plist = path.join(app, 'Contents', 'Info.plist');
  const manifestPath = path.join(app, 'Contents', 'Resources', manifestName);
  if (
    !existsSync(plist)
    || plistValue(plist, 'CFBundleIdentifier') !== bundleId
    || !existsSync(manifestPath)
  ) {
    throw new Error(`Refusing to replace an unrecognized app at ${app}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.bundleIdentifier !== bundleId) {
    throw new Error(`Refusing to replace an app with an unrecognized release manifest at ${app}`);
  }
}

function assertReplaceableZip(zip) {
  if (!existsSync(zip)) return;
  if (!statSync(zip).isFile()) {
    throw new Error(`Refusing to replace a non-file at ${zip}`);
  }

  const extraction = mkdtempSync(path.join(os.tmpdir(), 'torlink-existing-release-'));
  try {
    run('/usr/bin/ditto', ['-x', '-k', zip, extraction]);
    const priorApp = path.join(extraction, 'TorLink.app');
    const priorPlist = path.join(priorApp, 'Contents', 'Info.plist');
    const priorManifest = path.join(priorApp, 'Contents', 'Resources', manifestName);
    if (
      !existsSync(priorPlist)
      || plistValue(priorPlist, 'CFBundleIdentifier') !== bundleId
      || !existsSync(priorManifest)
    ) {
      throw new Error('missing the expected TorLink bundle identity or release manifest');
    }
    const parsed = JSON.parse(readFileSync(priorManifest, 'utf8'));
    if (parsed.schemaVersion !== 1 || parsed.bundleIdentifier !== bundleId) {
      throw new Error('has an unrecognized TorLink release manifest');
    }
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', priorApp]);
  } catch (error) {
    throw new Error(`Refusing to replace an unrecognized ZIP at ${zip}: ${error.message}`);
  } finally {
    rmSync(extraction, { recursive: true, force: true });
  }
}

function executableArchitecture(file) {
  return run('/usr/bin/lipo', ['-archs', file]);
}

function dependencies(file) {
  const output = run('/usr/bin/otool', ['-L', file]);
  return output
    .split('\n')
    .slice(1)
    .map((line) => line.trim().match(/^(\S+)\s+\(compatibility version/)?.[1])
    .filter(Boolean);
}

function isSystemDependency(file) {
  return file.startsWith('/usr/lib/') || file.startsWith('/System/Library/');
}

function cellarPackage(file) {
  const parts = realpathSync(file).split(path.sep);
  const index = parts.indexOf('Cellar');
  if (index < 0 || !parts[index + 1] || !parts[index + 2]) return null;
  return {
    name: parts[index + 1],
    root: path.sep + path.join(...parts.slice(1, index + 3)),
  };
}

function copyAvailableLicenses(sourceFile, licensesDir, label) {
  const pkg = cellarPackage(sourceFile);
  if (!pkg) return;
  const candidates = ['LICENSE', 'COPYING', 'COPYRIGHT', 'NOTICE'];
  for (const name of candidates) {
    const source = path.join(pkg.root, name);
    if (existsSync(source) && statSync(source).isFile()) {
      copyFileSync(source, path.join(licensesDir, `${label}-${name}.txt`));
    }
  }
}

function productionPackagePaths(installRoot) {
  const modulesRoot = path.join(installRoot, 'node_modules');
  return run('npm', ['ls', '--omit=dev', '--parseable', '--all'], { cwd: installRoot })
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${modulesRoot}${path.sep}`));
}

function containsNativeAddon(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (containsNativeAddon(target)) return true;
    } else if (entry.isFile() && entry.name.endsWith('.node')) {
      return true;
    }
  }
  return false;
}

function stageProductionPackages(appDir, installRoot) {
  const modulesRoot = path.join(installRoot, 'node_modules');
  const destinationRoot = path.join(appDir, 'node_modules');
  const inventory = [];
  for (const source of productionPackagePaths(installRoot)) {
    const relative = path.relative(modulesRoot, source);
    const destination = path.join(destinationRoot, relative);
    const metadataPath = path.join(source, 'package.json');
    if (!existsSync(metadataPath)) {
      throw new Error(`Production dependency has no package.json: ${source}`);
    }
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true, dereference: true });
    inventory.push({
      path: relative.split(path.sep).join('/'),
      name: metadata.name,
      version: metadata.version,
    });
  }
  if (containsNativeAddon(destinationRoot)) {
    throw new Error('The production dependency set unexpectedly contains a native .node add-on.');
  }
  return inventory.sort((left, right) => left.path.localeCompare(right.path));
}

function createLockedBuildWorkspace(temporaryDirectory) {
  const workspace = path.join(temporaryDirectory, 'locked-build-workspace');
  const workspaceScripts = path.join(workspace, 'scripts');
  mkdirSync(workspaceScripts, { recursive: true });

  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsup.config.ts']) {
    copyFileSync(path.join(root, name), path.join(workspace, name));
  }
  cpSync(path.join(root, 'src'), path.join(workspace, 'src'), {
    recursive: true,
    dereference: true,
  });
  for (const name of ['postbuild.cjs', 'cli-entry.cjs']) {
    copyFileSync(path.join(root, 'scripts', name), path.join(workspaceScripts, name));
  }

  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: workspace });
  run('npm', ['run', 'build'], { cwd: workspace });
  const builtDist = path.join(workspace, 'dist');
  if (!existsSync(path.join(builtDist, 'cli.cjs')) || !existsSync(path.join(builtDist, 'index.js'))) {
    throw new Error('The locked production JavaScript build was not produced.');
  }
  return { workspace, builtDist };
}

function buildDylibClosure(binary, binDir, libDir, licensesDir) {
  const destinationBinary = path.join(binDir, 'transmission-daemon');
  copyFileSync(realpathSync(binary), destinationBinary);
  chmodSync(destinationBinary, 0o755);

  const queue = [realpathSync(binary)];
  const copied = new Map();
  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependency of dependencies(current)) {
      if (isSystemDependency(dependency)) continue;
      if (dependency.startsWith('@')) {
        throw new Error(`Unsupported relocatable dependency in Transmission source: ${dependency}`);
      }
      if (!existsSync(dependency)) {
        throw new Error(`Missing Transmission dependency: ${dependency}`);
      }
      if (copied.has(dependency)) continue;
      const realDependency = realpathSync(dependency);
      const libraryName = path.basename(dependency);
      const expectedSha = transmissionLibrarySha256.get(libraryName);
      if (!expectedSha) {
        throw new Error(`Unpinned Transmission library dependency: ${dependency}`);
      }
      const actualSha = sha256(realDependency);
      if (actualSha !== expectedSha) {
        throw new Error(
          `Transmission library checksum mismatch for ${libraryName}: expected ${expectedSha}, got ${actualSha}`,
        );
      }
      const destination = path.join(libDir, path.basename(dependency));
      if (existsSync(destination) && realpathSync(destination) !== realDependency) {
        throw new Error(`Two bundled libraries share the name ${path.basename(dependency)}`);
      }
      copyFileSync(realDependency, destination);
      chmodSync(destination, 0o755);
      copied.set(dependency, { source: realDependency, destination, sourceSha256: actualSha });
      queue.push(realDependency);
      const pkg = cellarPackage(realDependency);
      copyAvailableLicenses(realDependency, licensesDir, pkg?.name ?? path.basename(dependency));
    }
  }

  const copiedNames = new Set([...copied.values()].map((entry) => path.basename(entry.destination)));
  for (const expectedName of transmissionLibrarySha256.keys()) {
    if (!copiedNames.has(expectedName)) {
      throw new Error(`Pinned Transmission library was not present in the dependency closure: ${expectedName}`);
    }
  }
  if (copiedNames.size !== transmissionLibrarySha256.size) {
    throw new Error('The Transmission dependency closure does not match the pinned library set.');
  }

  const stagedFiles = [destinationBinary, ...[...copied.values()].map((entry) => entry.destination)];
  for (const staged of stagedFiles) {
    const original = staged === destinationBinary
      ? realpathSync(binary)
      : [...copied.values()].find((entry) => entry.destination === staged).source;
    for (const dependency of dependencies(original)) {
      if (!copied.has(dependency)) continue;
      const replacement = staged === destinationBinary
        ? `@executable_path/../lib/${path.basename(dependency)}`
        : `@loader_path/${path.basename(dependency)}`;
      run('/usr/bin/install_name_tool', ['-change', dependency, replacement, staged]);
    }
    if (staged !== destinationBinary) {
      run('/usr/bin/install_name_tool', ['-id', `@rpath/${path.basename(staged)}`, staged]);
    }
  }

  copyAvailableLicenses(binary, licensesDir, 'Transmission');
  return {
    binary: destinationBinary,
    libraries: [...copied.values()]
      .map((entry) => ({
        name: path.basename(entry.destination),
        source: entry.source,
        sourceSha256: entry.sourceSha256,
        destination: entry.destination,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    stagedFiles,
  };
}

function machoMinimumVersions(file) {
  const output = run('/usr/bin/otool', ['-l', file]);
  return [...output.matchAll(/\bminos\s+([0-9]+(?:\.[0-9]+){1,2})/g)].map((match) => match[1]);
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

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

if (process.platform !== 'darwin') throw new Error('The portable macOS app can only be built on macOS.');
for (const source of [icon, launcherSource, commandSource, packageLock]) {
  if (!existsSync(source)) throw new Error(`Required source is missing: ${source}`);
}

mkdirSync(releaseDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });
assertReplaceableApp(outputApp);
assertReplaceableZip(outputZip);

const configuredArchive = process.env.TORLINK_NODE_ARCHIVE;
const nodeArchive = configuredArchive ? path.resolve(configuredArchive) : path.join(cacheDir, nodeArchiveName);
if (configuredArchive && !existsSync(nodeArchive)) {
  throw new Error(`TORLINK_NODE_ARCHIVE does not exist: ${nodeArchive}`);
}
if (!existsSync(nodeArchive)) {
  const partialArchive = `${nodeArchive}.download-${process.pid}`;
  try {
    run('/usr/bin/curl', ['--fail', '--location', '--output', partialArchive, nodeArchiveUrl]);
    const downloadedSha = sha256(partialArchive);
    if (downloadedSha !== nodeArchiveSha256) {
      throw new Error(`Downloaded Node archive checksum mismatch: expected ${nodeArchiveSha256}, got ${downloadedSha}`);
    }
    renameSync(partialArchive, nodeArchive);
  } finally {
    if (existsSync(partialArchive)) rmSync(partialArchive, { force: true });
  }
}
const actualNodeSha = sha256(nodeArchive);
if (actualNodeSha !== nodeArchiveSha256) {
  throw new Error(`Node archive checksum mismatch: expected ${nodeArchiveSha256}, got ${actualNodeSha}`);
}

const transmissionCandidate = process.env.TORLINK_TRANSMISSION_DAEMON
  || defaultTransmissionDaemon;
if (!existsSync(transmissionCandidate)) {
  throw new Error(
    `Pinned Transmission ${transmissionVersion} was not found at ${transmissionCandidate}. `
    + 'Install transmission-cli or set TORLINK_TRANSMISSION_DAEMON to the exact pinned binary.',
  );
}
const transmissionBinary = realpathSync(transmissionCandidate);
if (executableArchitecture(transmissionBinary).trim() !== 'arm64') {
  throw new Error('The portable release requires an arm64-only transmission-daemon.');
}
const actualTransmissionSha = sha256(transmissionBinary);
if (actualTransmissionSha !== transmissionSha256) {
  throw new Error(
    `Transmission checksum mismatch: expected ${transmissionSha256}, got ${actualTransmissionSha}`,
  );
}
const actualTransmissionVersion = combinedOutput(transmissionBinary, ['--version']);
if (!actualTransmissionVersion.startsWith(`transmission-daemon ${transmissionVersion} (`)) {
  throw new Error(
    `Transmission version mismatch: expected ${transmissionVersion}, got ${actualTransmissionVersion}`,
  );
}

const temporaryDirectory = mkdtempSync(path.join(releaseDir, '.torlink-portable-build-'));
const temporaryApp = path.join(temporaryDirectory, 'TorLink.app');
const temporaryZip = path.join(temporaryDirectory, path.basename(outputZip));
let preserveTemporaryDirectory = false;

try {
  const lockedBuild = createLockedBuildWorkspace(temporaryDirectory);
  const contents = path.join(temporaryApp, 'Contents');
  const macosDir = path.join(contents, 'MacOS');
  const resources = path.join(contents, 'Resources');
  const binDir = path.join(resources, 'bin');
  const libDir = path.join(resources, 'lib');
  const appDir = path.join(resources, 'app');
  const licensesDir = path.join(resources, 'Licenses');
  const provenanceDir = path.join(resources, 'Provenance');
  for (const directory of [macosDir, binDir, libDir, appDir, licensesDir, provenanceDir]) {
    mkdirSync(directory, { recursive: true });
  }

  const launcher = path.join(macosDir, 'TorLink');
  run('/usr/bin/clang', [
    '-fobjc-arc',
    '-framework', 'AppKit',
    '-arch', 'arm64',
    '-arch', 'x86_64',
    '-mmacosx-version-min=12.0',
    '-o', launcher,
    launcherSource,
  ]);

  const nodeExtract = path.join(temporaryDirectory, 'node-runtime');
  mkdirSync(nodeExtract, { recursive: true });
  const nodePrefix = `node-v${nodeVersion}-darwin-arm64`;
  run('/usr/bin/tar', [
    '-xzf', nodeArchive,
    '-C', nodeExtract,
    `${nodePrefix}/bin/node`,
    `${nodePrefix}/LICENSE`,
  ]);
  const nodeBinary = path.join(binDir, 'node');
  copyFileSync(path.join(nodeExtract, nodePrefix, 'bin', 'node'), nodeBinary);
  chmodSync(nodeBinary, 0o755);
  copyFileSync(path.join(nodeExtract, nodePrefix, 'LICENSE'), path.join(licensesDir, 'Node-LICENSE.txt'));

  cpSync(lockedBuild.builtDist, path.join(appDir, 'dist'), { recursive: true });
  const productionPackages = stageProductionPackages(appDir, lockedBuild.workspace);
  writeFileSync(
    path.join(appDir, 'package.json'),
    `${JSON.stringify({ name: packageJson.name, version: packageJson.version, type: 'module' }, null, 2)}\n`,
    'utf8',
  );
  copyFileSync(commandSource, path.join(resources, 'Open TorLink.command'));
  chmodSync(path.join(resources, 'Open TorLink.command'), 0o755);
  copyFileSync(icon, path.join(resources, 'TorLink.icns'));
  copyFileSync(path.join(root, 'LICENSE'), path.join(licensesDir, 'TorLink-LICENSE.txt'));
  copyFileSync(packageLock, path.join(provenanceDir, 'package-lock.json'));

  const transmissionRuntime = buildDylibClosure(transmissionBinary, binDir, libDir, licensesDir);
  const machos = [launcher, nodeBinary, ...transmissionRuntime.stagedFiles];
  const minimumMacOS = machos
    .flatMap(machoMinimumVersions)
    .reduce((highest, value) => compareVersions(value, highest) > 0 ? value : highest, '12.0');

  const readme = [
    'TorLink portable macOS app',
    '',
    'Requirements:',
    '- Apple-silicon Mac',
    `- macOS ${minimumMacOS} or later`,
    '',
    'Node.js and the Transmission command-line backend are included.',
    'TorLink stores settings, queue data, and download history in this Mac user account.',
    'Copying the app does not copy data from the computer that built it.',
    'Surfshark protection is required by default; press v in TorLink to change that setting.',
    '',
    'This is an ad-hoc signed local build, not a notarized public release.',
    'After copying it to another Mac, right-click TorLink.app and choose Open the first time.',
    '',
    'Bundled runtime license texts are in Contents/Resources/Licenses.',
    'JavaScript package licenses remain with their packages under Contents/Resources/app/node_modules.',
  ].join('\n');
  writeFileSync(path.join(resources, 'README.txt'), `${readme}\n`, 'utf8');

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key><string>TorLink</string>
  <key>CFBundleExecutable</key><string>TorLink</string>
  <key>CFBundleIconFile</key><string>TorLink.icns</string>
  <key>CFBundleIdentifier</key><string>${bundleId}</string>
  <key>CFBundleName</key><string>TorLink</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${xmlEscape(packageJson.version)}</string>
  <key>CFBundleVersion</key><string>${xmlEscape(packageJson.version)}</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
  <key>LSMinimumSystemVersion</key><string>${xmlEscape(minimumMacOS)}</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;
  const plistPath = path.join(contents, 'Info.plist');
  writeFileSync(plistPath, plist, 'utf8');
  run('/usr/bin/plutil', ['-lint', plistPath]);

  for (const macho of [...transmissionRuntime.stagedFiles].reverse()) {
    run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', macho]);
  }
  run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', nodeBinary]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', launcher]);

  const manifest = {
    schemaVersion: 1,
    bundleIdentifier: bundleId,
    appVersion: packageJson.version,
    platform: 'darwin',
    architecture: 'arm64',
    minimumMacOS,
    node: {
      version: nodeVersion,
      archiveSha256: nodeArchiveSha256,
      bundledSha256: sha256(nodeBinary),
    },
    transmission: {
      version: transmissionVersion,
      sourceSha256: transmissionSha256,
      bundledSha256: sha256(transmissionRuntime.binary),
    },
    libraries: transmissionRuntime.libraries.map((library) => ({
      name: library.name,
      sourceSha256: library.sourceSha256,
      bundledSha256: sha256(library.destination),
    })),
    applicationRuntime: {
      sha256: sha256Tree(appDir),
      packageLockSha256: sha256(packageLock),
      productionPackages,
    },
  };
  writeFileSync(
    path.join(resources, manifestName),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', temporaryApp]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', temporaryApp]);

  run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', temporaryApp, temporaryZip]);

  const previousApp = path.join(temporaryDirectory, 'Previous-TorLink.app');
  const previousZip = path.join(temporaryDirectory, 'Previous-TorLink.zip');
  const hadApp = existsSync(outputApp);
  const hadZip = existsSync(outputZip);
  if (hadApp) renameSync(outputApp, previousApp);
  if (hadZip) renameSync(outputZip, previousZip);
  try {
    renameSync(temporaryApp, outputApp);
    renameSync(temporaryZip, outputZip);
  } catch (error) {
    if (existsSync(outputApp)) rmSync(outputApp, { recursive: true, force: true });
    if (existsSync(outputZip)) rmSync(outputZip, { force: true });
    try {
      if (hadApp) renameSync(previousApp, outputApp);
      if (hadZip) renameSync(previousZip, outputZip);
    } catch (restoreError) {
      preserveTemporaryDirectory = true;
      throw new AggregateError(
        [error, restoreError],
        `Could not install the portable release or restore its backup. Backup: ${temporaryDirectory}`,
      );
    }
    throw error;
  }
} finally {
  if (!preserveTemporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log(`Built ${outputApp}`);
console.log(`Built ${outputZip}`);
