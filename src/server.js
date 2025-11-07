/**
 * Universal Image Pipeline API Server
 * Provides /v1/pipeline and /v1/run endpoints alongside legacy /mask and /process
 */

import express from 'express';
import axios from 'axios';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { executePipeline } from './pipeline.js';
import { loadProfile, clearProfileCache, listCachedProfiles } from './profiles.js';
import { SCHEMA } from './schema.js';

const execFileAsync = promisify(execFile);
const app = express();

app.use(express.json({ limit: '10mb' }));

const TEMP_DIR = '/tmp/imagemagick-api';

// Ensure temp directory exists
(async () => {
  await fs.promises.mkdir(TEMP_DIR, { recursive: true });
})();

// Auth middleware
function authMiddleware(req, res, next) {
  if (process.env.API_KEY && req.get('X-API-Key') !== process.env.API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

/**
 * Health check
 */
app.get('/health', (req, res) => res.json({ ok: true }));

/**
 * ImageMagick version
 */
app.get('/version', async (req, res) => {
  try {
    const { stdout } = await execFileAsync('magick', ['-version']);
    res.type('text/plain').send(stdout);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Schema documentation
 */
app.get('/v1/spec', (req, res) => {
  res.json(SCHEMA);
});

/**
 * POST /v1/pipeline
 * Execute a complete pipeline with inline definition
 * Body: { pipeline: {...}, params: {...} }
 */
app.post('/v1/pipeline', authMiddleware, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { pipeline, params = {} } = req.body || {};
    
    if (!pipeline) {
      return res.status(400).json({ error: 'pipeline required' });
    }

    const result = await executePipeline(pipeline, params, TEMP_DIR);
    
    // Return first output as response if no S3 exports
    const firstOutput = result.outputs[0];
    if (firstOutput && firstOutput.buffer) {
      res.set('Content-Type', firstOutput.contentType);
      res.set('X-Processing-Time', String(Date.now() - startTime));
      res.set('X-Steps-Executed', String(result.stats.stepsExecuted));
      return res.send(firstOutput.buffer);
    }

    // Otherwise return metadata
    res.json({
      outputs: result.outputs.map(o => ({
        s3: o.s3,
        contentType: o.contentType,
        size: o.size
      })),
      stats: result.stats,
      processingTime: Date.now() - startTime
    });
    
  } catch (e) {
    res.status(500).json({
      error: e.message,
      stderr: e.stderr,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});

/**
 * POST /v1/run?profile=<name>
 * Execute a named profile loaded from configured source
 * Body: { inputs: {...}, params: {...} }
 * Query: ?profile=<name>&source=<s3://...>
 */
app.post('/v1/run', authMiddleware, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const profileName = req.query.profile;
    const profileSource = req.query.source || process.env.PROFILE_SOURCE;
    
    if (!profileName) {
      return res.status(400).json({ error: 'profile query parameter required' });
    }
    
    if (!profileSource) {
      return res.status(400).json({ error: 'profile source not configured (set PROFILE_SOURCE or pass ?source=...)' });
    }

    // Load profile
    const profile = await loadProfile(profileSource);
    
    if (profile.name !== profileName) {
      return res.status(404).json({ error: `profile "${profileName}" not found in source` });
    }

    const { inputs, params = {} } = req.body || {};
    
    if (!inputs) {
      return res.status(400).json({ error: 'inputs required' });
    }

    // Merge profile inputs with request inputs
    const mergedPipeline = {
      ...profile,
      inputs
    };

    const result = await executePipeline(mergedPipeline, params, TEMP_DIR);
    
    // Return first output as response if buffer present
    const firstOutput = result.outputs[0];
    if (firstOutput && firstOutput.buffer) {
      res.set('Content-Type', firstOutput.contentType);
      res.set('X-Processing-Time', String(Date.now() - startTime));
      res.set('X-Profile', profileName);
      return res.send(firstOutput.buffer);
    }

    // Otherwise return metadata
    res.json({
      profile: profileName,
      outputs: result.outputs.map(o => ({
        s3: o.s3,
        contentType: o.contentType,
        size: o.size
      })),
      stats: result.stats,
      processingTime: Date.now() - startTime
    });
    
  } catch (e) {
    res.status(500).json({
      error: e.message,
      stderr: e.stderr,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});

/**
 * POST /admin/reload
 * Clear profile cache
 */
app.post('/admin/reload', authMiddleware, async (req, res) => {
  const { source } = req.body || {};
  const result = clearProfileCache(source);
  res.json({ ok: true, ...result });
});

/**
 * GET /admin/profiles
 * List cached profiles
 */
app.get('/admin/profiles', authMiddleware, (req, res) => {
  const profiles = listCachedProfiles();
  res.json({ profiles });
});

/**
 * Legacy /mask endpoint (backwards compatibility)
 */
app.post('/mask', authMiddleware, async (req, res) => {
  try {
    const { originalUrl, alphaUrl } = req.body || {};
    if (!originalUrl || !alphaUrl) {
      return res.status(400).json({ error: 'originalUrl and alphaUrl required' });
    }

    const ts = Date.now();
    const tmpDir = TEMP_DIR;
    const originalPath = path.join(tmpDir, `original-${ts}.tiff`);
    const alphaPath = path.join(tmpDir, `alpha-${ts}.png`);
    const outPath = path.join(tmpDir, `masked-${ts}.tiff`);

    const download = async (url, dest) => {
      const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
      fs.writeFileSync(dest, r.data);
    };

    await download(originalUrl, originalPath);
    await download(alphaUrl, alphaPath);

    await execFileAsync('magick', [
      originalPath,
      alphaPath,
      '-compose', 'CopyOpacity', '-composite',
      '-alpha', 'set', '-compress', 'lzw',
      outPath
    ], { timeout: 20000 });

    const out = fs.readFileSync(outPath);
    res.set('Content-Type', 'image/tiff');
    res.send(out);

    try { fs.unlinkSync(originalPath); } catch {}
    try { fs.unlinkSync(alphaPath); } catch {}
    try { fs.unlinkSync(outPath); } catch {}
  } catch (e) {
    res.status(500).json({ error: e.message, stderr: e.stderr });
  }
});

/**
 * Legacy /process endpoint (backwards compatibility)
 */
app.post('/process', authMiddleware, async (req, res) => {
  try {
    const { url, command } = req.body || {};
    if (!url || !command) {
      return res.status(400).json({ error: 'url and command required' });
    }
    
    const ts = Date.now();
    const tmp = TEMP_DIR;
    const inPath = path.join(tmp, `in-${ts}`);
    const outPath = path.join(tmp, `out-${ts}`);

    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    fs.writeFileSync(inPath, r.data);

    // Split command cautiously (no commas or complex tokens)
    const args = [inPath, ...command.split(/\s+/).filter(Boolean), outPath];
    await execFileAsync('magick', args, { timeout: 60000, maxBuffer: 50 * 1024 * 1024 });

    const buf = fs.readFileSync(outPath);
    
    // Detect MIME
    let mime = 'application/octet-stream';
    try {
      const { stdout } = await execFileAsync('magick', ['identify', '-format', '%m', outPath]);
      const fmt = stdout.trim().toLowerCase();
      if (fmt === 'jpeg' || fmt === 'jpg') mime = 'image/jpeg';
      else if (fmt === 'png') mime = 'image/png';
      else if (fmt === 'webp') mime = 'image/webp';
      else if (fmt === 'tiff' || fmt === 'tif') mime = 'image/tiff';
      else if (fmt === 'svg') mime = 'image/svg+xml';
      else if (fmt === 'pdf') mime = 'application/pdf';
    } catch {}
    
    res.set('Content-Type', mime).send(buf);

    try { fs.unlinkSync(inPath); } catch {}
    try { fs.unlinkSync(outPath); } catch {}
  } catch (e) {
    res.status(500).json({ error: e.message, stderr: e.stderr });
  }
});

app.listen(process.env.PORT || 8080, '0.0.0.0', () => {
  console.log(`ImageMagick Pipeline API running on port ${process.env.PORT || 8080}`);
});

