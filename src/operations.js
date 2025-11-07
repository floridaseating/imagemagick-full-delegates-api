/**
 * ImageMagick operation builders
 * Each function returns an array of magick CLI arguments (no shell)
 */

import { evaluateExpression, compileToFx } from './expressions.js';

/**
 * Build args for maskAlpha operation
 * Composites alpha channel onto image
 */
export function buildMaskAlpha(step, images, vars) {
  const original = images.get(step.src);
  const alpha = images.get(step.mask);
  
  if (!original || !alpha) {
    throw new Error(`maskAlpha: missing src "${step.src}" or mask "${step.mask}"`);
  }

  const compress = step.compress || 'lzw';
  
  return {
    inputs: [original, alpha],
    args: [
      '-compose', 'CopyOpacity',
      '-composite',
      '-alpha', 'set',
      '-compress', compress
    ]
  };
}

/**
 * Build args for measure operation
 * Runs identify to get dimensions, then optionally trim dimensions
 */
export function buildMeasure(step, images, vars) {
  const src = images.get(step.src);
  if (!src) throw new Error(`measure: missing src "${step.src}"`);

  // Measure happens at execution time via identify
  return {
    inputs: [src],
    measure: true,
    args: [] // Special case: measure via identify, not magick convert
  };
}

/**
 * Build args for trimRepage
 */
export function buildTrimRepage(step, images, vars) {
  const src = images.get(step.src);
  if (!src) throw new Error(`trimRepage: missing src "${step.src}"`);

  return {
    inputs: [src],
    args: ['-trim', '+repage']
  };
}

/**
 * Build args for padToAspect
 * Dynamically calculates extent based on aspect ratio and padding
 */
export function buildPadToAspect(step, images, vars) {
  const src = images.get(step.src);
  if (!src) throw new Error(`padToAspect: missing src "${step.src}"`);

  const [w, h] = step.aspect.split(':').map(Number);
  if (!w || !h) throw new Error(`Invalid aspect ratio: ${step.aspect}`);
  
  const aspectRatio = w / h;
  const padPct = step.padPct || 0;
  const padFactor = 1 / (1 - padPct);
  const bg = step.bg || 'white';
  const gravity = step.gravity || 'center';

  // Build expressions for target dimensions
  // padW = trimW / (1 - padPct), padH = trimH / (1 - padPct)
  // targetW = max(padW, padH * aspectRatio)
  // targetH = targetW / aspectRatio
  
  return {
    inputs: [src],
    args: [
      '-set', 'option:trimW', '%[w]',
      '-set', 'option:trimH', '%[h]',
      '-set', 'option:padW', `%[fx:trimW/${padFactor}]`,
      '-set', 'option:padH', `%[fx:trimH/${padFactor}]`,
      '-set', 'option:targetW', `%[fx:max(padW,padH*${aspectRatio})]`,
      '-set', 'option:targetH', `%[fx:targetW/${aspectRatio}]`,
      '-background', bg,
      '-gravity', gravity,
      '-extent', '%[targetW]x%[targetH]'
    ]
  };
}

/**
 * Build args for flatten
 */
export function buildFlatten(step, images, vars) {
  const src = images.get(step.src);
  if (!src) throw new Error(`flatten: missing src "${step.src}"`);

  const bg = step.bg || 'white';
  
  return {
    inputs: [src],
    args: ['-background', bg, '-flatten']
  };
}

/**
 * Build args for resize
 */
export function buildResize(step, images, vars) {
  const src = images.get(step.src);
  if (!src) throw new Error(`resize: missing src "${step.src}"`);

  const { mode, value, filter } = step;
  let geometry;

  switch (mode) {
    case 'width':
      geometry = `${value}x`;
      break;
    case 'height':
      geometry = `x${value}`;
      break;
    case 'percent':
      geometry = `${value}%`;
      break;
    case 'fit':
      geometry = `${value}`;
      break;
    default:
      throw new Error(`Unknown resize mode: ${mode}`);
  }

  const args = ['-resize', geometry];
  if (filter) args.push('-filter', filter);

  return { inputs: [src], args };
}

/**
 * Build args for colorspace
 */
export function buildColorspace(step, images, vars) {
  const src = images.get(step.src);
  if (!src) throw new Error(`colorspace: missing src "${step.src}"`);

  return {
    inputs: [src],
    args: ['-colorspace', step.space]
  };
}

/**
 * Build args for format conversion
 */
export function buildFormat(step, images, vars) {
  const src = images.get(step.src);
  if (!src) throw new Error(`format: missing src "${step.src}"`);

  const args = [];
  
  if (step.quality) args.push('-quality', String(step.quality));
  if (step.compress) args.push('-compress', step.compress);
  if (step.density) args.push('-density', String(step.density));
  
  return { inputs: [src], args, outputFormat: step.format };
}

/**
 * Build args for composite
 */
export function buildComposite(step, images, vars) {
  const base = images.get(step.base);
  const overlay = images.get(step.overlay);
  
  if (!base || !overlay) {
    throw new Error(`composite: missing base "${step.base}" or overlay "${step.overlay}"`);
  }

  const args = ['-compose', step.mode];
  if (step.gravity) args.push('-gravity', step.gravity);
  if (step.geometry) args.push('-geometry', step.geometry);
  args.push('-composite');

  return { inputs: [base, overlay], args };
}

/**
 * Operation dispatcher
 */
export function buildOperation(step, images, vars) {
  switch (step.op) {
    case 'maskAlpha':
      return buildMaskAlpha(step, images, vars);
    case 'measure':
      return buildMeasure(step, images, vars);
    case 'trimRepage':
      return buildTrimRepage(step, images, vars);
    case 'padToAspect':
      return buildPadToAspect(step, images, vars);
    case 'flatten':
      return buildFlatten(step, images, vars);
    case 'resize':
      return buildResize(step, images, vars);
    case 'colorspace':
      return buildColorspace(step, images, vars);
    case 'format':
      return buildFormat(step, images, vars);
    case 'composite':
      return buildComposite(step, images, vars);
    default:
      throw new Error(`Unknown operation: ${step.op}`);
  }
}

