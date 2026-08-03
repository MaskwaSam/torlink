'use strict';

const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const macosDir = path.join(root, 'macos');
const outputApp = path.join(macosDir, 'TorLink.app');
const sourceScript = path.join(macosDir, 'launcher.applescript');
const sourceIcon = path.join(root, 'assets', 'app-icon', 'TorLink.icns');
const commandLauncher = path.join(root, 'Open TorLink.command');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const bundleId = 'com.maskwasam.torlink';
const inheritedMetadataToRemove = [
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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.trim();
}

function plistSet(plist, key, type, value) {
  const setResult = spawnSync(
    '/usr/libexec/PlistBuddy',
    ['-c', `Set :${key} ${value}`, plist],
    { encoding: 'utf8' },
  );
  if (setResult.status !== 0) {
    run('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${type} ${value}`, plist]);
  }
}

function plistDelete(plist, key) {
  spawnSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plist], {
    encoding: 'utf8',
  });
}

function directoryContainsFiles(directory) {
  if (!existsSync(directory)) return false;
  for (const entry of readdirSync(directory)) {
    const target = path.join(directory, entry);
    if (statSync(target).isDirectory()) {
      if (directoryContainsFiles(target)) return true;
    } else {
      return true;
    }
  }
  return false;
}

if (process.platform !== 'darwin') {
  throw new Error('TorLink.app can only be built on macOS.');
}
if (!existsSync(sourceScript) || !existsSync(sourceIcon)) {
  throw new Error('The AppleScript launcher or TorLink icon is missing.');
}
if (!existsSync(commandLauncher) || !(statSync(commandLauncher).mode & 0o111)) {
  throw new Error('Open TorLink.command must exist and be executable.');
}

mkdirSync(macosDir, { recursive: true });

if (existsSync(outputApp) && directoryContainsFiles(outputApp)) {
  const plist = path.join(outputApp, 'Contents', 'Info.plist');
  let existingId = '';
  if (existsSync(plist)) {
    const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist], {
      encoding: 'utf8',
    });
    if (result.status === 0) existingId = result.stdout.trim();
  }
  if (existingId !== bundleId) {
    throw new Error(`Refusing to replace an unrecognized app at ${outputApp}`);
  }
}

const temporaryDirectory = mkdtempSync(path.join(macosDir, '.torlink-app-build-'));
const temporaryApp = path.join(temporaryDirectory, 'TorLink.app');
let preserveTemporaryDirectory = false;

try {
  run('/usr/bin/osacompile', ['-o', temporaryApp, sourceScript]);

  const contents = path.join(temporaryApp, 'Contents');
  const resources = path.join(contents, 'Resources');
  const plist = path.join(contents, 'Info.plist');
  mkdirSync(resources, { recursive: true });
  copyFileSync(sourceIcon, path.join(resources, 'TorLink.icns'));
  writeFileSync(path.join(resources, 'project-root'), `${root}\n`, 'utf8');

  plistSet(plist, 'CFBundleName', 'string', 'TorLink');
  plistSet(plist, 'CFBundleDisplayName', 'string', 'TorLink');
  plistSet(plist, 'CFBundleIdentifier', 'string', bundleId);
  plistSet(plist, 'CFBundleShortVersionString', 'string', packageJson.version);
  plistSet(plist, 'CFBundleVersion', 'string', packageJson.version);
  for (const key of inheritedMetadataToRemove) plistDelete(plist, key);
  plistSet(plist, 'CFBundleIconFile', 'string', 'TorLink.icns');
  plistSet(plist, 'LSMinimumSystemVersion', 'string', '12.0');
  plistSet(plist, 'LSApplicationCategoryType', 'string', 'public.app-category.utilities');
  plistSet(plist, 'LSUIElement', 'bool', 'true');
  plistSet(plist, 'NSHighResolutionCapable', 'bool', 'true');

  run('/usr/bin/plutil', ['-lint', plist]);
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', temporaryApp]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', temporaryApp]);

  const previousApp = path.join(temporaryDirectory, 'Previous-TorLink.app');
  const hadPreviousApp = existsSync(outputApp);
  if (hadPreviousApp) renameSync(outputApp, previousApp);
  try {
    renameSync(temporaryApp, outputApp);
  } catch (error) {
    if (hadPreviousApp && !existsSync(outputApp)) {
      try {
        renameSync(previousApp, outputApp);
      } catch (restoreError) {
        preserveTemporaryDirectory = true;
        throw new AggregateError(
          [error, restoreError],
          `Could not install the new app or restore the previous app. Backup: ${previousApp}`,
        );
      }
    }
    throw error;
  }
} finally {
  if (!preserveTemporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

console.log(`Built ${outputApp}`);
