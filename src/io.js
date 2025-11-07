/**
 * I/O adapters for importing and exporting images
 * Supports: HTTP(S), S3, base64, multipart
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Import image from various sources
 * Returns: { path: string, cleanup: () => void }
 */
export async function importImage(spec, tmpDir) {
  const ts = Date.now();
  const rand = Math.random().toString(36).substring(7);
  
  // URL (http/https)
  if (typeof spec === 'string' && (spec.startsWith('http://') || spec.startsWith('https://'))) {
    let ext = '';
    try {
      const u = new URL(spec);
      const p = u.pathname || '';
      const e = path.extname(p) || '';
      if (e && e.length <= 10) ext = e.toLowerCase();
    } catch {}
    const destPath = path.join(tmpDir, `import-${ts}-${rand}${ext}`);
    const response = await axios.get(spec, { responseType: 'arraybuffer', timeout: 30000 });
    fs.writeFileSync(destPath, response.data);
    return {
      path: destPath,
      cleanup: () => { try { fs.unlinkSync(destPath); } catch {} }
    };
  }

  // S3
  if (typeof spec === 'object' && spec.type === 's3') {
    const { bucket, region, key, accessKeyId, secretAccessKey } = spec;
    const s3 = new S3Client({
      region: region || 'us-east-1',
      credentials: accessKeyId && secretAccessKey ? {
        accessKeyId,
        secretAccessKey
      } : undefined
    });

    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3.send(cmd);
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    // Preserve extension from key if present (ensures RAW like .arw uses libraw)
    let ext = '';
    try {
      const e = path.extname(key || '') || '';
      if (e && e.length <= 10) ext = e.toLowerCase();
    } catch {}
    const destPath = path.join(tmpDir, `import-${ts}-${rand}${ext}`);
    fs.writeFileSync(destPath, buffer);
    
    return {
      path: destPath,
      cleanup: () => { try { fs.unlinkSync(destPath); } catch {} }
    };
  }

  // Base64
  if (typeof spec === 'object' && spec.type === 'base64') {
    const buffer = Buffer.from(spec.data, 'base64');
    const destPath = path.join(tmpDir, `import-${ts}-${rand}`);
    fs.writeFileSync(destPath, buffer);
    return {
      path: destPath,
      cleanup: () => { try { fs.unlinkSync(destPath); } catch {} }
    };
  }

  // Multipart (handled at request level, passed as Buffer)
  if (spec instanceof Buffer) {
    const destPath = path.join(tmpDir, `import-${ts}-${rand}`);
    fs.writeFileSync(destPath, spec);
    return {
      path: destPath,
      cleanup: () => { try { fs.unlinkSync(destPath); } catch {} }
    };
  }

  throw new Error('Unsupported import spec');
}

/**
 * Export image to response or S3
 * Returns: { buffer?: Buffer, s3?: {bucket, key}, contentType: string }
 */
export async function exportImage(imagePath, step, vars) {
  const buffer = fs.readFileSync(imagePath);
  
  // Detect content type
  let contentType = 'application/octet-stream';
  try {
    const { stdout } = await execFileAsync('magick', ['identify', '-format', '%m', imagePath]);
    const fmt = stdout.trim().toLowerCase();
    if (fmt === 'jpeg' || fmt === 'jpg') contentType = 'image/jpeg';
    else if (fmt === 'png') contentType = 'image/png';
    else if (fmt === 'webp') contentType = 'image/webp';
    else if (fmt === 'tiff' || fmt === 'tif') contentType = 'image/tiff';
    else if (fmt === 'svg') contentType = 'image/svg+xml';
    else if (fmt === 'pdf') contentType = 'application/pdf';
  } catch {}

  // Override if specified
  if (step.contentType) {
    contentType = step.contentType;
  }

  // S3 export
  if (step.s3) {
    const { bucket, region, key, accessKeyId, secretAccessKey, contentType: s3ContentType } = step.s3;
    
    const s3 = new S3Client({
      region: region || process.env.AWS_REGION || 'us-east-1',
      credentials: accessKeyId && secretAccessKey ? {
        accessKeyId,
        secretAccessKey
      } : undefined
    });

    const resolvedKey = typeof key === 'string' ? substituteVars(key, vars) : key;
    const resolvedContentType = s3ContentType || contentType;

    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: resolvedKey,
      Body: buffer,
      ContentType: resolvedContentType,
      ...(step.s3.metadata && { Metadata: step.s3.metadata })
    });

    await s3.send(cmd);
    
    return {
      s3: { bucket, key: resolvedKey, region: region || 'us-east-1' },
      contentType: resolvedContentType,
      size: buffer.length
    };
  }

  // Return buffer for response
  return {
    buffer,
    contentType,
    size: buffer.length
  };
}

/**
 * Simple template variable substitution
 */
function substituteVars(template, vars) {
  if (typeof template !== 'string') return template;
  
  return template.replace(/\$\{(\w+)\}/g, (match, varName) => {
    if (vars[varName] !== undefined) return String(vars[varName]);
    return match;
  });
}

/**
 * Detect MIME type from file
 */
export async function detectMimeType(filePath) {
  try {
    const { stdout } = await execFileAsync('magick', ['identify', '-format', '%m', filePath]);
    const fmt = stdout.trim().toLowerCase();
    
    const mimeMap = {
      jpeg: 'image/jpeg',
      jpg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      tiff: 'image/tiff',
      tif: 'image/tiff',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      gif: 'image/gif',
      bmp: 'image/bmp'
    };
    
    return mimeMap[fmt] || 'application/octet-stream';
  } catch {
    return 'application/octet-stream';
  }
}

