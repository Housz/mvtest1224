import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const EXCLUDED_PREFIXES = [
  'DataGenerator/',
  'node_modules/',
  'dist/',
  '.git/',
  '.codex-backups/'
];
const HAN_PATTERN = /\p{Script=Han}/u;
const unicodeEscapePrefix = '\\\\' + 'u';
const UNICODE_ESCAPE_PATTERN = new RegExp(
  unicodeEscapePrefix + '(?:[{]([0-9a-fA-F]{1,6})[}]|([0-9a-fA-F]{4}))',
  'g'
);

function normalizePath(filePath) {
  return filePath.replaceAll('\\\\', '/');
}

function isExcluded(filePath) {
  return EXCLUDED_PREFIXES.some((prefix) => filePath === prefix.slice(0, -1) || filePath.startsWith(prefix));
}

function decodeUnicodeEscapes(value) {
  return value.replace(UNICODE_ESCAPE_PATTERN, (match, braced, fixed) => {
    const codePoint = Number.parseInt(braced || fixed, 16);
    if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) return match;
    return String.fromCodePoint(codePoint);
  });
}

function findHan(text) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const decoded = decodeUnicodeEscapes(lines[index]);
    const match = decoded.match(HAN_PATTERN);
    if (match) {
      return {
        line: index + 1,
        character: match[0],
        excerpt: decoded.trim().slice(0, 180) || match[0]
      };
    }
  }
  return null;
}

function listProjectFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: ROOT, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }
  );
  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(normalizePath)
    .filter((filePath) => !isExcluded(filePath));
}

const violations = [];
for (const filePath of listProjectFiles()) {
  const pathIssue = filePath.match(HAN_PATTERN);
  if (pathIssue) {
    violations.push({
      filePath,
      line: 0,
      character: pathIssue[0],
      excerpt: filePath
    });
  }

  const absolutePath = path.join(ROOT, filePath);
  if (!existsSync(absolutePath)) continue;

  const buffer = readFileSync(absolutePath);
  if (buffer.includes(0)) continue;

  const issue = findHan(buffer.toString('utf8'));
  if (issue) violations.push({ filePath, ...issue });
}

if (violations.length) {
  console.error('English-only check failed. CJK text was found outside DataGenerator:');
  for (const issue of violations) {
    const location = issue.line ? issue.filePath + ':' + issue.line : issue.filePath;
    console.error('  ' + location + ' [' + issue.character + '] ' + issue.excerpt);
  }
  process.exitCode = 1;
} else {
  console.log('English-only check passed.');
}
