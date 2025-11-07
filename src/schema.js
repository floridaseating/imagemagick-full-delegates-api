/**
 * Pipeline JSON Schema and Validators
 * Defines the complete structure for image processing pipelines
 */

// Supported operations
export const OPERATIONS = {
  maskAlpha: {
    description: 'Apply alpha channel mask to an image',
    required: ['src', 'mask', 'out'],
    optional: ['compress'],
    defaults: { compress: 'lzw' }
  },
  measure: {
    description: 'Measure image dimensions (exposes w, h, trimW, trimH)',
    required: ['src', 'out'],
    optional: []
  },
  trimRepage: {
    description: 'Trim image and reset virtual canvas',
    required: ['src', 'out'],
    optional: []
  },
  padToAspect: {
    description: 'Pad image to target aspect ratio with specified background',
    required: ['src', 'aspect', 'padPct', 'bg', 'out'],
    optional: ['gravity'],
    defaults: { gravity: 'center' }
  },
  flatten: {
    description: 'Flatten image layers with background color',
    required: ['src', 'bg', 'out'],
    optional: []
  },
  resize: {
    description: 'Resize image',
    required: ['src', 'mode', 'value', 'out'],
    optional: ['filter'],
    modes: ['width', 'height', 'percent', 'fit']
  },
  colorspace: {
    description: 'Convert colorspace',
    required: ['src', 'space', 'out'],
    optional: [],
    spaces: ['sRGB', 'RGB', 'CMYK', 'Gray']
  },
  format: {
    description: 'Convert format',
    required: ['src', 'format', 'out'],
    optional: ['quality', 'compress', 'density'],
    formats: ['tiff', 'jpg', 'jpeg', 'png', 'webp']
  },
  composite: {
    description: 'Composite two images',
    required: ['base', 'overlay', 'mode', 'out'],
    optional: ['gravity', 'geometry'],
    modes: ['Over', 'Multiply', 'Screen', 'Overlay', 'CopyOpacity']
  },
  export: {
    description: 'Export image to response or S3',
    required: ['src'],
    optional: ['as', 'tiff', 'jpg', 'png', 'webp', 's3', 'contentType', 'metadata'],
    formats: ['tiff', 'jpg', 'jpeg', 'png', 'webp']
  }
};

// Input types
export const INPUT_TYPES = {
  url: 'HTTP/HTTPS URL',
  s3: 'S3 object (bucket, region, key, credentials)',
  base64: 'Base64-encoded image data',
  multipart: 'Multipart form field name'
};

// Validate pipeline structure
export function validatePipeline(pipeline) {
  const errors = [];
  
  if (!pipeline || typeof pipeline !== 'object') {
    return { valid: false, errors: ['Pipeline must be an object'] };
  }

  // Validate inputs
  if (!pipeline.inputs || typeof pipeline.inputs !== 'object') {
    errors.push('Pipeline must have "inputs" object');
  } else {
    for (const [name, spec] of Object.entries(pipeline.inputs)) {
      if (typeof spec === 'string') {
        // Accept actual URLs or type declarations
        const isUrl = spec.startsWith('http://') || spec.startsWith('https://');
        const isTypeName = INPUT_TYPES[spec];
        if (!isUrl && !isTypeName) {
          errors.push(`Input "${name}": unknown type "${spec}"`);
        }
      } else if (typeof spec === 'object') {
        // Accept { type: 's3', ... } or { type: 'base64', ... }
        if (!spec.type || !INPUT_TYPES[spec.type]) {
          errors.push(`Input "${name}": missing or invalid type`);
        }
      } else {
        errors.push(`Input "${name}": must be string or object`);
      }
    }
  }

  // Validate steps
  if (!Array.isArray(pipeline.steps)) {
    errors.push('Pipeline must have "steps" array');
  } else {
    const images = new Set(Object.keys(pipeline.inputs || {}));
    
    for (let i = 0; i < pipeline.steps.length; i++) {
      const step = pipeline.steps[i];
      
      if (!step.op) {
        errors.push(`Step ${i}: missing "op" field`);
        continue;
      }

      const opDef = OPERATIONS[step.op];
      if (!opDef) {
        errors.push(`Step ${i}: unknown operation "${step.op}"`);
        continue;
      }

      // Check required fields
      for (const field of opDef.required) {
        if (step[field] === undefined) {
          errors.push(`Step ${i} (${step.op}): missing required field "${field}"`);
        }
      }

      // Validate source references
      const srcFields = ['src', 'base', 'overlay', 'mask'];
      for (const field of srcFields) {
        if (step[field] && !images.has(step[field])) {
          errors.push(`Step ${i} (${step.op}): "${field}" references unknown image "${step[field]}"`);
        }
      }

      // Track output if specified
      if (step.out) {
        if (images.has(step.out)) {
          errors.push(`Step ${i} (${step.op}): output "${step.out}" conflicts with existing image`);
        }
        images.add(step.out);
      }

      // Validate format-specific fields
      if (step.op === 'format' && !opDef.formats.includes(step.format)) {
        errors.push(`Step ${i}: invalid format "${step.format}"`);
      }
      if (step.op === 'colorspace' && !opDef.spaces.includes(step.space)) {
        errors.push(`Step ${i}: invalid colorspace "${step.space}"`);
      }
      if (step.op === 'resize' && !opDef.modes.includes(step.mode)) {
        errors.push(`Step ${i}: invalid resize mode "${step.mode}"`);
      }

      // Validate aspect ratio format
      if (step.aspect) {
        const parts = step.aspect.split(':');
        if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
          errors.push(`Step ${i}: invalid aspect ratio "${step.aspect}" (use w:h format)`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// Validate profile structure
export function validateProfile(profile) {
  const errors = [];

  if (!profile.name) errors.push('Profile must have "name"');
  if (!profile.steps) errors.push('Profile must have "steps" array');

  const pipelineValidation = validatePipeline(profile);
  errors.push(...pipelineValidation.errors);

  return { valid: errors.length === 0, errors };
}

// Schema for /v1/spec endpoint
export const SCHEMA = {
  version: 1,
  operations: OPERATIONS,
  inputTypes: INPUT_TYPES,
  examples: {
    maskWeb: {
      name: 'mask-web',
      description: 'Apply alpha mask, export TIFF with alpha and web JPG with white background',
      inputs: { original: 'url', alpha: 'url' },
      params: { runId: 'string', base: 'string' },
      steps: [
        { op: 'maskAlpha', src: 'original', mask: 'alpha', out: 'masked' },
        { op: 'measure', src: 'masked', out: 'm' },
        { op: 'export', src: 'masked', as: 'tiff', tiff: { compress: 'lzw' }, s3: { key: '${runId}/final/${base}.tiff', contentType: 'image/tiff' } },
        { op: 'trimRepage', src: 'masked', out: 't1' },
        { op: 'padToAspect', src: 't1', aspect: '3:4', padPct: 0.06, bg: 'white', out: 't2' },
        { op: 'export', src: 't2', as: 'jpg', jpg: { quality: 95 }, s3: { key: '${runId}/final/${base}.jpg', contentType: 'image/jpeg' } }
      ]
    }
  }
};

