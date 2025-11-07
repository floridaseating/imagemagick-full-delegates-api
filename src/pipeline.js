/**
 * Pipeline executor
 * Orchestrates image processing steps and manages intermediate files
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { validatePipeline } from './schema.js';
import { buildOperation } from './operations.js';
import { importImage, exportImage, detectMimeType } from './io.js';
import { substituteVars } from './expressions.js';

const execFileAsync = promisify(execFile);

/**
 * Execute a complete pipeline
 * Returns: { outputs: [...], stats: {...}, realizedSteps: [...] }
 */
export async function executePipeline(pipeline, params = {}, tmpDir = '/tmp') {
  const startTime = Date.now();
  const validation = validatePipeline(pipeline);
  
  if (!validation.valid) {
    throw new Error(`Invalid pipeline: ${validation.errors.join('; ')}`);
  }

  // Merge params into vars for substitution
  const vars = { ...params };
  const images = new Map(); // name → path
  const cleanups = []; // cleanup functions
  const realizedSteps = [];
  const outputs = [];

  try {
    // Import inputs
    for (const [name, spec] of Object.entries(pipeline.inputs)) {
      const imported = await importImage(spec, tmpDir);
      images.set(name, imported.path);
      cleanups.push(imported.cleanup);
      realizedSteps.push({ op: 'import', name, path: imported.path });
    }

    // Execute steps
    for (let i = 0; i < pipeline.steps.length; i++) {
      const step = pipeline.steps[i];
      const stepStart = Date.now();

      // Handle export specially
      if (step.op === 'export') {
        const srcPath = images.get(step.src);
        if (!srcPath) throw new Error(`export: missing src "${step.src}"`);

        // Apply format conversion if specified
        let finalPath = srcPath;
        if (step.as) {
          const ts = Date.now();
          const outputPath = path.join(tmpDir, `export-${ts}-${i}.${step.as}`);
          const args = [srcPath];
          
          // Add format-specific args
          if (step.tiff) {
            if (step.tiff.compress) args.push('-compress', step.tiff.compress);
          }
          if (step.jpg || step.jpeg) {
            const opts = step.jpg || step.jpeg;
            if (opts.quality) args.push('-quality', String(opts.quality));
          }
          if (step.png) {
            if (step.png.compression) args.push('-quality', String(step.png.compression));
          }
          if (step.webp) {
            if (step.webp.quality) args.push('-quality', String(step.webp.quality));
          }
          
          args.push(outputPath);
          
          await execFileAsync('magick', args, { timeout: 60000, maxBuffer: 100 * 1024 * 1024 });
          finalPath = outputPath;
          cleanups.push(() => { try { fs.unlinkSync(outputPath); } catch {} });
        }

        const exported = await exportImage(finalPath, step, vars);
        outputs.push(exported);
        
        realizedSteps.push({
          op: 'export',
          src: step.src,
          ...exported,
          duration: Date.now() - stepStart
        });
        
        continue;
      }

      // Handle measure
      if (step.op === 'measure') {
        const srcPath = images.get(step.src);
        if (!srcPath) throw new Error(`measure: missing src "${step.src}"`);

        // Get current dimensions
        const { stdout: dims } = await execFileAsync('magick', ['identify', '-format', '%w %h', srcPath]);
        const [w, h] = dims.trim().split(' ').map(Number);
        
        // Get trim dimensions
        const trimPath = path.join(tmpDir, `trim-${Date.now()}-${i}`);
        await execFileAsync('magick', [srcPath, '-trim', '+repage', trimPath], { timeout: 20000 });
        const { stdout: trimDims } = await execFileAsync('magick', ['identify', '-format', '%w %h', trimPath]);
        const [trimW, trimH] = trimDims.trim().split(' ').map(Number);
        
        // Store in vars
        vars.w = w;
        vars.h = h;
        vars.trimW = trimW;
        vars.trimH = trimH;
        
        // Clean up trim temp
        try { fs.unlinkSync(trimPath); } catch {}
        
        realizedSteps.push({
          op: 'measure',
          src: step.src,
          measured: { w, h, trimW, trimH },
          duration: Date.now() - stepStart
        });
        
        continue;
      }

      // Build operation
      const built = buildOperation(step, images, vars);
      const { inputs, args } = built;
      
      if (!inputs || inputs.length === 0) {
        throw new Error(`Step ${i} (${step.op}): no inputs`);
      }

      // Execute magick command
      const ts = Date.now();
      const outputPath = path.join(tmpDir, `step-${ts}-${i}${built.outputFormat ? '.' + built.outputFormat : ''}`);
      
      const magickArgs = [...inputs, ...args, outputPath];
      
      await execFileAsync('magick', magickArgs, {
        timeout: 60000,
        maxBuffer: 100 * 1024 * 1024
      });

      // Store output
      if (step.out) {
        images.set(step.out, outputPath);
        cleanups.push(() => { try { fs.unlinkSync(outputPath); } catch {} });
      }

      realizedSteps.push({
        op: step.op,
        out: step.out,
        args: magickArgs,
        duration: Date.now() - stepStart
      });
    }

    return {
      outputs,
      stats: {
        totalDuration: Date.now() - startTime,
        stepsExecuted: pipeline.steps.length,
        imagesProcessed: images.size
      },
      realizedSteps
    };

  } finally {
    // Cleanup all temp files
    for (const cleanup of cleanups) {
      cleanup();
    }
  }
}

