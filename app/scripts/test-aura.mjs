import assert from 'node:assert/strict';
import { createAuraEnvelope } from '../src/aura-envelope.mjs';

const envelope = createAuraEnvelope();
const samples = new Float32Array(512);
assert.equal(envelope(samples), 0, 'Silence must not generate artificial beats');
let peak = 0, trough = 0;
for (let cycle = 0; cycle < 4; cycle++) {
  samples.fill(.16);
  for (let i = 0; i < 5; i++) peak = envelope(samples);
  samples.fill(.001);
  for (let i = 0; i < 12; i++) trough = envelope(samples);
}
assert(peak - trough > .5, 'Strong and weak audio must produce visibly different levels');
assert(1 + .22 * peak > 1.15, 'Strong beats must visibly expand the halo');
samples.fill(0);
for (let i = 0; i < 60; i++) trough = envelope(samples);
assert(trough < .001, 'Halo must settle after silence');
console.log('PASS 4 aura envelope checks');
