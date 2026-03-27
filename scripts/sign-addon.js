#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

require('dotenv').config({ path: path.join(rootDir, '.env') });
let sourceDir = process.env.SOURCE_DIR || rootDir;
let artifactsDir = process.env.ARTIFACTS_DIR || path.join(rootDir, 'web-ext-artifacts');
let channel = process.env.CHANNEL || 'unlisted';
let amoMetadataFile = process.env.AMO_METADATA_FILE || '';
const webExtBin = process.env.WEB_EXT_BIN || '';

function usage(exitCode = 0) {
  process.stdout.write(`Usage:
  ./scripts/sign-addon.js [--channel unlisted|listed] [--metadata path/to/amo-metadata.json] [--artifacts-dir path]

Environment variables:
  WEB_EXT_API_KEY / WEB_EXT_API_SECRET
    Preferred AMO API credentials for web-ext.

  AMO_JWT_ISSUER / AMO_JWT_SECRET
    Supported aliases. Used only if WEB_EXT_API_KEY / WEB_EXT_API_SECRET are unset.

  CHANNEL
    Defaults to "unlisted".

  AMO_METADATA_FILE
    Optional path to AMO metadata JSON. Usually needed for first listed submission.

Examples:
  ./scripts/sign-addon.js
  CHANNEL=listed AMO_METADATA_FILE=./amo-metadata.json ./scripts/sign-addon.js
`);
  process.exit(exitCode);
}

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (arg === '--channel') {
    channel = argv[i + 1] || '';
    i += 1;
    continue;
  }
  if (arg === '--metadata') {
    amoMetadataFile = argv[i + 1] || '';
    i += 1;
    continue;
  }
  if (arg === '--artifacts-dir') {
    artifactsDir = argv[i + 1] || '';
    i += 1;
    continue;
  }
  if (arg === '--help' || arg === '-h') {
    usage(0);
  }
  process.stderr.write(`Unknown argument: ${arg}\n`);
  usage(1);
}

if (channel !== 'unlisted' && channel !== 'listed') {
  process.stderr.write(`Unsupported channel: ${channel}\n`);
  process.exit(1);
}

const apiKey = process.env.WEB_EXT_API_KEY || process.env.AMO_JWT_ISSUER || '';
const apiSecret = process.env.WEB_EXT_API_SECRET || process.env.AMO_JWT_SECRET || '';

if (!apiKey || !apiSecret) {
  process.stderr.write('Missing AMO credentials.\n');
  process.stderr.write('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET, or AMO_JWT_ISSUER and AMO_JWT_SECRET.\n');
  process.exit(1);
}

if (!fs.existsSync(path.join(sourceDir, 'manifest.json'))) {
  process.stderr.write(`manifest.json not found in source dir: ${sourceDir}\n`);
  process.exit(1);
}

if (amoMetadataFile && !fs.existsSync(amoMetadataFile)) {
  process.stderr.write(`Metadata file not found: ${amoMetadataFile}\n`);
  process.exit(1);
}

fs.mkdirSync(artifactsDir, { recursive: true });

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

let command = '';
let commandArgs = [];
if (webExtBin) {
  command = webExtBin;
} else if (commandExists('web-ext')) {
  command = 'web-ext';
} else if (commandExists('npx')) {
  command = 'npx';
  commandArgs = ['--yes', 'web-ext@^8'];
} else {
  process.stderr.write('web-ext is not installed and npx is unavailable.\n');
  process.exit(1);
}

const ignoreFiles = [
  '.claude/*',
  '.idea/*',
  '.git/*',
  '.gitignore',
  '.tool-versions',
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'spec.md',
  'scripts/*',
  'web-ext-artifacts/*',
  'dist/*',
];

const signArgs = [
  ...commandArgs,
  'sign',
  '--source-dir', sourceDir,
  '--artifacts-dir', artifactsDir,
  '--channel', channel,
  '--api-key', apiKey,
  '--api-secret', apiSecret,
  '--ignore-files',
  ...ignoreFiles,
];

if (amoMetadataFile) {
  signArgs.push('--amo-metadata', amoMetadataFile);
}

process.stdout.write('Signing Firefox add-on\n');
process.stdout.write(`  channel:       ${channel}\n`);
process.stdout.write(`  source dir:    ${sourceDir}\n`);
process.stdout.write(`  artifacts dir: ${artifactsDir}\n`);
if (amoMetadataFile) {
  process.stdout.write(`  metadata:      ${amoMetadataFile}\n`);
}

const result = spawnSync(command, signArgs, { stdio: 'inherit' });
if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}
if (typeof result.status === 'number' && result.status !== 0) {
  process.exit(result.status);
}

process.stdout.write('\nSigned artifact(s) should be in:\n');
process.stdout.write(`  ${artifactsDir}\n`);
