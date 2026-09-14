import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPadToAspect } from '../src/operations.js';

const images = new Map([['t1', '/tmp/t1.tiff']]);

test('padToAspect pads the trimmed subject so it fills (1 - padPct) of the constraining side', () => {
  const { args } = buildPadToAspect({ op: 'padToAspect', src: 't1', aspect: '3:4', padPct: 0.091, bg: 'white' }, images, {});
  const padW = args[args.indexOf('option:padW') + 1];
  const padH = args[args.indexOf('option:padH') + 1];
  // 1 / (1 - 0.091) = 1.1001...: the canvas must be LARGER than the subject, never smaller.
  assert.match(padW, /^%\[fx:trimW\*1\.10/);
  assert.match(padH, /^%\[fx:trimH\*1\.10/);
  assert.ok(!padW.includes('/'), 'padW must multiply, dividing by padFactor crops the subject');
  assert.equal(args[args.indexOf('-extent') + 1], '%[targetW]x%[targetH]');
});

test('padToAspect with padPct 0 keeps the subject size (factor 1)', () => {
  const { args } = buildPadToAspect({ op: 'padToAspect', src: 't1', aspect: '3:4', padPct: 0 }, images, {});
  assert.equal(args[args.indexOf('option:padW') + 1], '%[fx:trimW*1]');
});

test('padToAspect rejects a padPct outside [0, 1)', () => {
  assert.throws(() => buildPadToAspect({ op: 'padToAspect', src: 't1', aspect: '3:4', padPct: 1.2 }, images, {}), /Invalid padPct/);
});
