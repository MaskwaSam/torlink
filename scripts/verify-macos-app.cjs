'use strict';

const { accessSync, constants, existsSync, readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = path.resolve(process.argv[2] || path.join(root, 'macos', 'TorLink.app'));
const contents = path.join(app, 'Contents');
const plist = path.join(contents, 'Info.plist');
const resources = path.join(contents, 'Resources');
const expectedIcon = path.join(root, 'assets', 'app-icon', 'TorLink.icns');
const expectedLauncher = path.join(root, 'Open TorLink.command');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const forbiddenMetadata = [
  'CFBundleIconName',
  'LSMinimumSystemVersionByArchitecture',
  'LSRequiresCarbon',
  'NSAppleEventsUsageDescription',
  'NSAppleMusicUsageDescription',
  'NSCalendarsUsageDescription',
  'NSCameraUsageDescription',
  'NSContactsUsageDescription',
  'NSHomeKitUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSRemindersUsageDescription',
  'NSSiriUsageDescription',
  'NSSystemAdministrationUsageDescription',
];

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.trim();
}

function plistValue(key) {
  return run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]);
}

function optionalPlistValue(key) {
  const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], {
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

if (process.platform !== 'darwin') throw new Error('TorLink.app verification requires macOS.');
if (!existsSync(plist)) throw new Error(`No app bundle found at ${app}`);

run('/usr/bin/plutil', ['-lint', plist]);
if (plistValue('CFBundleIdentifier') !== 'com.maskwasam.torlink') {
  throw new Error('Unexpected TorLink.app bundle identifier.');
}
if (plistValue('CFBundleName') !== 'TorLink') throw new Error('Unexpected app name.');
if (plistValue('CFBundlePackageType') !== 'APPL') throw new Error('Unexpected bundle type.');
if (plistValue('CFBundleShortVersionString') !== packageJson.version) {
  throw new Error('The app version does not match package.json.');
}
if (plistValue('CFBundleVersion') !== packageJson.version) {
  throw new Error('The app build version does not match package.json.');
}
if (plistValue('LSUIElement') !== 'true') throw new Error('TorLink.app must be an agent app.');
if (plistValue('CFBundleIconFile') !== 'TorLink.icns') throw new Error('Unexpected icon file.');
for (const key of forbiddenMetadata) {
  if (optionalPlistValue(key) !== null) {
    throw new Error(`Unused inherited bundle metadata remains: ${key}`);
  }
}

const executable = path.join(contents, 'MacOS', plistValue('CFBundleExecutable'));
accessSync(executable, constants.X_OK);
const executableType = run('/usr/bin/file', [executable]);
if (!executableType.includes('Mach-O') && !executableType.includes('universal binary')) {
  throw new Error(`The app executable is not native: ${executableType}`);
}

const projectRoot = readFileSync(path.join(resources, 'project-root'), 'utf8').trim();
if (projectRoot !== root) throw new Error(`App points to the wrong checkout: ${projectRoot}`);
accessSync(expectedLauncher, constants.X_OK);

const builtIcon = readFileSync(path.join(resources, 'TorLink.icns'));
if (!builtIcon.equals(readFileSync(expectedIcon))) throw new Error('The bundled icon is stale.');

const script = run('/usr/bin/osadecompile', [path.join(resources, 'Scripts', 'main.scpt')]);
if (!script.includes('com.apple.Terminal') || !script.includes('Open TorLink.command')) {
  throw new Error('The applet does not delegate to the Terminal launcher.');
}

run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
console.log(`Verified ${app}`);
console.log(`Launch target: ${expectedLauncher}`);
