import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(process.cwd());

test('backend api routes directory exists', () => {
  const apiDir = path.join(rootDir, 'app', 'api');
  assert.equal(fs.existsSync(apiDir), true);
});

test('prisma schema exists', () => {
  const schemaPath = path.join(rootDir, 'prisma', 'schema.prisma');
  assert.equal(fs.existsSync(schemaPath), true);
});
