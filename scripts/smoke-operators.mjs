import { OperatorNodeDefinitions } from '../src/core/operators/OperatorNodes.js';
import { geologyColorForKey, GEOLOGY_PALETTE } from '../src/core/operators/shared/OperatorRuntimeUtils.js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseAst } from 'rollup/parseAst';

const failures = [];

const globalNames = new Set([
  'Array',
  'Blob',
  'Boolean',
  'Date',
  'Error',
  'Event',
  'File',
  'FileReader',
  'Float32Array',
  'HTMLElement',
  'Infinity',
  'Intl',
  'JSON',
  'Map',
  'Math',
  'MouseEvent',
  'NaN',
  'Number',
  'Object',
  'Promise',
  'RangeError',
  'RegExp',
  'ResizeObserver',
  'Set',
  'String',
  'Symbol',
  'TextDecoder',
  'TextEncoder',
  'TypeError',
  'URL',
  'Uint8Array',
  'WeakMap',
  'WeakSet',
  'cancelAnimationFrame',
  'clearInterval',
  'clearTimeout',
  'console',
  'crypto',
  'document',
  'fetch',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'performance',
  'requestAnimationFrame',
  'setInterval',
  'setTimeout',
  'structuredClone',
  'undefined',
  'window'
]);

function collectJavaScriptFiles(root, files = []) {
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) collectJavaScriptFiles(path, files);
    else if (path.endsWith('.js')) files.push(path);
  }
  return files;
}

function addPatternName(scope, node) {
  if (!node) return;
  if (node.type === 'Identifier') scope.add(node.name);
  else if (node.type === 'RestElement') addPatternName(scope, node.argument);
  else if (node.type === 'AssignmentPattern') addPatternName(scope, node.left);
  else if (node.type === 'ArrayPattern') node.elements.forEach((element) => addPatternName(scope, element));
  else if (node.type === 'ObjectPattern') {
    node.properties.forEach((property) => addPatternName(scope, property.value || property.argument));
  }
}

function collectDeclarationNames(node, scope) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'ImportDeclaration') {
    node.specifiers.forEach((specifier) => scope.add(specifier.local.name));
  } else if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
    if (node.id) scope.add(node.id.name);
  } else if (node.type === 'VariableDeclaration') {
    node.declarations.forEach((declaration) => addPatternName(scope, declaration.id));
  }
}

function isDeclared(scopes, name) {
  return globalNames.has(name) || scopes.some((scope) => scope.has(name));
}

function isDeclarationIdentifier(node, parent) {
  return (
    parent &&
    ((parent.type === 'VariableDeclarator' && parent.id === node) ||
      (parent.type === 'FunctionDeclaration' && parent.id === node) ||
      (parent.type === 'FunctionExpression' && parent.id === node) ||
      (parent.type === 'ClassDeclaration' && parent.id === node) ||
      (parent.type === 'ClassExpression' && parent.id === node) ||
      parent.type === 'ImportSpecifier' ||
      parent.type === 'ImportDefaultSpecifier' ||
      parent.type === 'ImportNamespaceSpecifier')
  );
}

function isStaticPropertyName(node, parent) {
  return (
    parent &&
    ((parent.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
      (parent.type === 'Property' && parent.key === node && !parent.computed) ||
      (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed))
  );
}

function collectFreeIdentifiers(node, scopes, freeIdentifiers, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child) => collectFreeIdentifiers(child, scopes, freeIdentifiers, parent));
    return;
  }

  collectDeclarationNames(node, scopes[0]);

  if (node.type === 'Identifier') {
    if (!isDeclarationIdentifier(node, parent) && !isStaticPropertyName(node, parent) && !isDeclared(scopes, node.name)) {
      freeIdentifiers.add(node.name);
    }
    return;
  }

  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
    const functionScope = new Set();
    if (node.type === 'FunctionExpression' && node.id) functionScope.add(node.id.name);
    node.params?.forEach((param) => addPatternName(functionScope, param));
    collectFreeIdentifiers(node.body, [functionScope, ...scopes], freeIdentifiers, node);
    return;
  }

  if (node.type === 'ClassExpression') {
    const classScope = node.id ? new Set([node.id.name]) : new Set();
    collectFreeIdentifiers(node.body, classScope.size ? [classScope, ...scopes] : scopes, freeIdentifiers, node);
    return;
  }

  if (node.type === 'VariableDeclarator') {
    collectFreeIdentifiers(node.init, scopes, freeIdentifiers, node);
    return;
  }

  if (node.type === 'ImportDeclaration') return;

  if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
    if (node.declaration) collectFreeIdentifiers(node.declaration, scopes, freeIdentifiers, node);
    return;
  }

  if (node.type === 'Property') {
    if (node.computed) collectFreeIdentifiers(node.key, scopes, freeIdentifiers, node);
    collectFreeIdentifiers(node.value, scopes, freeIdentifiers, node);
    return;
  }

  if (node.type === 'MemberExpression') {
    collectFreeIdentifiers(node.object, scopes, freeIdentifiers, node);
    if (node.computed) collectFreeIdentifiers(node.property, scopes, freeIdentifiers, node);
    return;
  }

  if (node.type === 'MethodDefinition') {
    if (node.computed) collectFreeIdentifiers(node.key, scopes, freeIdentifiers, node);
    collectFreeIdentifiers(node.value, scopes, freeIdentifiers, node);
    return;
  }

  if (node.type === 'CatchClause') {
    const catchScope = new Set();
    addPatternName(catchScope, node.param);
    collectFreeIdentifiers(node.body, [catchScope, ...scopes], freeIdentifiers, node);
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    collectFreeIdentifiers(value, scopes, freeIdentifiers, node);
  }
}

function smokeFreeIdentifiers() {
  const files = [
    ...collectJavaScriptFiles('src/core/operators'),
    ...collectJavaScriptFiles('src/ui').filter((file) => /Runtime|RoadwayHazardViews/.test(file))
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const ast = parseAst(source, { jsx: false });
    const moduleScope = new Set();
    ast.body.forEach((node) => collectDeclarationNames(node, moduleScope));
    const freeIdentifiers = new Set();
    collectFreeIdentifiers(ast, [moduleScope], freeIdentifiers);
    if (freeIdentifiers.size) {
      failures.push(`${file}: free identifiers: ${[...freeIdentifiers].sort().join(', ')}`);
    }
  }
}

if (!Array.isArray(OperatorNodeDefinitions) || OperatorNodeDefinitions.length === 0) {
  failures.push('OperatorNodeDefinitions is empty or not an array.');
}

smokeFreeIdentifiers();

for (const definition of OperatorNodeDefinitions) {
  try {
    if (!definition?.typeId) throw new Error('missing typeId');
    if (typeof definition.createRuntime !== 'function') throw new Error('missing createRuntime');
    const runtimeFactory = definition.createRuntime();
    if (typeof runtimeFactory?.createOperator !== 'function') throw new Error('missing createOperator');
    const operator = runtimeFactory.createOperator(
      {
        id: `smoke_${definition.typeId}`,
        typeId: definition.typeId,
        label: definition.label,
        params: { ...(definition.defaultParams || {}) }
      },
      {}
    );
    if (!operator) throw new Error('createOperator returned empty operator');
    if (typeof operator.attach !== 'function') throw new Error('missing attach');
    if (operator.renderControls !== undefined && typeof operator.renderControls !== 'function') {
      throw new Error('renderControls exists but is not a function');
    }
  } catch (error) {
    failures.push(`${definition?.typeId || '<unknown>'}: ${error.message}`);
  }
}

if (geologyColorForKey('coal') !== '#111111') {
  failures.push('geologyColorForKey failed to resolve coal color.');
}

if (!Array.isArray(GEOLOGY_PALETTE) || GEOLOGY_PALETTE.length === 0) {
  failures.push('GEOLOGY_PALETTE is empty or not exported.');
}

if (failures.length) {
  console.error('Operator smoke test failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Operator smoke test passed: ${OperatorNodeDefinitions.length} definitions constructed.`);
