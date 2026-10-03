// Source ZIPs have no Git history. Pin the independent historical generators
// and their sole shared dependency without invoking Git or production code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('frozen regression generators and shared Three dependency retain reviewed source bytes', async () => {
  const sources = {
    './fixtures/abyss-sim-283be2a.mjs': '1aa802b5d4251da4917a17b5f04d42a896a60b6df227489a5ba14054aa950661',
    './fixtures/abyss-world-229ad9d.mjs': '9f9c894f4642022d6d36f08661160fa44fc70db27b61e5b30616c46000043a43',
    '../dist/vendor/three.module.js': '08fd7545d13d2c7fb65ab691530a802dafefd638596501854f267d0fb13c39e7'
  };
  for (const [path, expected] of Object.entries(sources)) {
    const source = await readFile(new URL(path, import.meta.url));
    assert.equal(createHash('sha256').update(source).digest('hex'), expected, `${path}: frozen source changed; review the historical baseline explicitly`);
  }
});
