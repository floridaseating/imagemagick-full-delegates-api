/**
 * Profile loader and cache
 * Loads pipeline profiles from S3/GitHub with TTL caching
 */

import axios from 'axios';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { validateProfile } from './schema.js';

const profileCache = new Map();
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load profile from S3
 */
async function loadFromS3(bucket, key, region = 'us-east-1') {
  const s3 = new S3Client({ region });
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await s3.send(cmd);
  
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf-8');
  return JSON.parse(text);
}

/**
 * Load profile from GitHub
 * URL format: github://owner/repo/path/to/profile.json[@ref]
 */
async function loadFromGitHub(url) {
  const match = url.match(/^github:\/\/([^/]+)\/([^/]+)\/(.+?)(?:@(.+))?$/);
  if (!match) throw new Error('Invalid GitHub URL format');
  
  const [, owner, repo, filePath, ref] = match;
  const branch = ref || 'main';
  
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  const response = await axios.get(rawUrl, { timeout: 10000 });
  return response.data;
}

/**
 * Load profile from HTTP(S) URL
 */
async function loadFromHttp(url) {
  const response = await axios.get(url, { timeout: 10000 });
  return response.data;
}

/**
 * Load and cache profile
 * source can be:
 *  - s3://bucket/key
 *  - github://owner/repo/path/file.json[@ref]
 *  - https://example.com/profile.json
 *  - { bucket, key, region } for S3 object
 */
export async function loadProfile(source, ttl = DEFAULT_TTL) {
  const cacheKey = typeof source === 'string' ? source : JSON.stringify(source);
  
  // Check cache
  if (profileCache.has(cacheKey)) {
    const cached = profileCache.get(cacheKey);
    if (Date.now() - cached.timestamp < ttl) {
      return cached.profile;
    }
    profileCache.delete(cacheKey);
  }

  // Load profile
  let profile;
  
  if (typeof source === 'string') {
    if (source.startsWith('s3://')) {
      const match = source.match(/^s3:\/\/([^/]+)\/(.+)$/);
      if (!match) throw new Error('Invalid S3 URL format');
      const [, bucket, key] = match;
      profile = await loadFromS3(bucket, key);
    } else if (source.startsWith('github://')) {
      profile = await loadFromGitHub(source);
    } else if (source.startsWith('http://') || source.startsWith('https://')) {
      profile = await loadFromHttp(source);
    } else {
      throw new Error('Unsupported profile source');
    }
  } else if (typeof source === 'object') {
    if (source.bucket && source.key) {
      profile = await loadFromS3(source.bucket, source.key, source.region);
    } else {
      throw new Error('Invalid profile source object');
    }
  } else {
    throw new Error('Profile source must be string or object');
  }

  // Validate
  const validation = validateProfile(profile);
  if (!validation.valid) {
    throw new Error(`Invalid profile: ${validation.errors.join('; ')}`);
  }

  // Cache
  profileCache.set(cacheKey, {
    profile,
    timestamp: Date.now()
  });

  return profile;
}

/**
 * Clear profile cache
 */
export function clearProfileCache(source = null) {
  if (source) {
    const cacheKey = typeof source === 'string' ? source : JSON.stringify(source);
    profileCache.delete(cacheKey);
    return { cleared: 1 };
  }
  
  const count = profileCache.size;
  profileCache.clear();
  return { cleared: count };
}

/**
 * List cached profiles
 */
export function listCachedProfiles() {
  const profiles = [];
  for (const [key, value] of profileCache.entries()) {
    profiles.push({
      source: key,
      name: value.profile.name,
      cachedAt: new Date(value.timestamp).toISOString(),
      age: Date.now() - value.timestamp
    });
  }
  return profiles;
}

