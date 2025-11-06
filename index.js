import express from 'express';
import axios from 'axios';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);
const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/version', async (req, res) => {
  try {
    const { stdout } = await execFileAsync('magick', ['-version']);
    res.type('text/plain').send(stdout);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/mask', async (req, res) => {
  try {
    if (process.env.API_KEY && req.get('X-API-Key') !== process.env.API_KEY) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const { originalUrl, alphaUrl } = req.body || {};
    if (!originalUrl || !alphaUrl) {
      return res.status(400).json({ error: 'originalUrl and alphaUrl required' });
    }

    const ts = Date.now();
    const tmp = '/tmp';
    const originalPath = path.join(tmp, `original-${ts}.tiff`);
    const alphaPath = path.join(tmp, `alpha-${ts}.png`);
    const outPath = path.join(tmp, `masked-${ts}.tiff`);

    const dl = async (url, dest) => {
      const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
      fs.writeFileSync(dest, r.data);
    };

    await dl(originalUrl, originalPath);
    await dl(alphaUrl, alphaPath);

    await execFileAsync('magick', [
      originalPath,
      alphaPath,
      '-compose', 'CopyOpacity', '-composite',
      '-alpha', 'set', '-compress', 'lzw',
      outPath
    ], { timeout: 60000 });

    const buf = fs.readFileSync(outPath);
    res.set('Content-Type', 'image/tiff').send(buf);

    try { fs.unlinkSync(originalPath); } catch {}
    try { fs.unlinkSync(alphaPath); } catch {}
    try { fs.unlinkSync(outPath); } catch {}
  } catch (e) {
    res.status(500).json({ error: e.message, stderr: e.stderr });
  }
});

app.post('/process', async (req, res) => {
  try {
    if (process.env.API_KEY && req.get('X-API-Key') !== process.env.API_KEY) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const { url, command } = req.body || {};
    if (!url || !command) {
      return res.status(400).json({ error: 'url and command required' });
    }
    const ts = Date.now();
    const tmp = '/tmp';
    const inPath = path.join(tmp, `in-${ts}`);
    const outPath = path.join(tmp, `out-${ts}`);

    const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    fs.writeFileSync(inPath, r.data);

    // Build command: magick "inPath" <command tokens> "outPath"
    // Split command string cautiously (simple split by spaces; callers should avoid unescaped spaces in tokens)
    const args = [inPath, ...command.split(' ').filter(Boolean), outPath];
    await execFileAsync('magick', args, { timeout: 60000, maxBuffer: 50 * 1024 * 1024 });

    const buf = fs.readFileSync(outPath);
    // crude format detect by 'identify -format %m'
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

app.listen(process.env.PORT || 8080, '0.0.0.0');


