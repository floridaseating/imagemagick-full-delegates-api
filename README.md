# ImageMagick Full Delegates API

Universal image processing pipeline with ImageMagick 7.1+ and complete delegate support (JPEG, PNG, TIFF, WebP, RAW, SVG, HEIF, OpenEXR, and more).

## Features

- **Universal Pipeline API**: `/v1/pipeline` executes declarative JSON workflows
- **Hot-loaded Profiles**: `/v1/run?profile=<name>` loads reusable workflows from S3/GitHub (no rebuild)
- **Legacy Compatibility**: `/mask` and `/process` endpoints for backward compatibility
- **Full Delegates**: Compiled from source with JPEG, PNG, TIFF, WebP, RAW, SVG, HEIF, OpenEXR, JPEG2000, color management, fonts
- **Multi-output**: Generate multiple formats (TIFF with alpha + web JPG) in one call
- **S3 Integration**: Import from and export to S3 with correct Content-Type
- **Safe Execution**: No shell commands; all args built programmatically
- **Fast Updates**: Split base (delegates) and API (code) images; API rebuilds in ~2 minutes

## Quick Start

### Deploy on Railway

1. Create new service → Deploy from image
2. Image: `floridaseating/imagemagick-full-delegates-api:latest`
3. Environment variables:
   - `PORT=8080` (auto-set by Railway)
   - `API_KEY=<your-secret-key>`
   - `PROFILE_SOURCE=s3://your-bucket/profiles/mask-web.json` (optional)

### Test Endpoints

```bash
BASE_URL=https://your-service.up.railway.app
API_KEY=your-api-key

# Health check
curl $BASE_URL/health

# Version
curl -H "X-API-Key: $API_KEY" $BASE_URL/version

# Legacy mask endpoint
curl -X POST $BASE_URL/mask \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"originalUrl": "https://...tiff", "alphaUrl": "https://...png"}' \
  --output masked.tiff

# Universal pipeline
curl -X POST $BASE_URL/v1/pipeline \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d @pipeline.json

# Profile-based run
curl -X POST "$BASE_URL/v1/run?profile=mask-web" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": {
      "original": "https://bucket.s3.region.amazonaws.com/original.tiff",
      "alpha": "https://bucket.s3.region.amazonaws.com/alpha.png"
    },
    "params": {
      "runId": "12345",
      "base": "chair"
    }
  }'
```

## API Reference

### GET /health
Health check. Returns `{"ok": true}`.

### GET /version
ImageMagick version info (text/plain).

### GET /v1/spec
Returns the complete pipeline schema, operations, and examples (JSON).

### POST /v1/pipeline
Execute an inline pipeline.

**Request body**:
```json
{
  "pipeline": {
    "inputs": {
      "original": "https://example.com/image.tiff",
      "alpha": "https://example.com/mask.png"
    },
    "steps": [
      {"op": "maskAlpha", "src": "original", "mask": "alpha", "out": "masked"},
      {"op": "export", "src": "masked", "as": "tiff", "tiff": {"compress": "lzw"}}
    ]
  },
  "params": {
    "runId": "123",
    "base": "product"
  }
}
```

**Response**: Image binary (if first export has buffer) or JSON metadata with S3 keys.

### POST /v1/run?profile=<name>
Execute a named profile.

**Query params**:
- `profile`: Profile name (required)
- `source`: Profile source URL (optional; defaults to `PROFILE_SOURCE` env)

**Request body**:
```json
{
  "inputs": {
    "original": "https://...",
    "alpha": "https://..."
  },
  "params": {
    "runId": "123",
    "base": "chair"
  }
}
```

**Response**: Same as `/v1/pipeline`.

### POST /admin/reload
Clear profile cache. Optionally pass `{"source": "s3://..."}` to clear specific profile.

### GET /admin/profiles
List cached profiles with metadata.

## Supported Operations

### maskAlpha
Apply alpha channel mask to an image.

```json
{"op": "maskAlpha", "src": "original", "mask": "alpha", "out": "masked", "compress": "lzw"}
```

### measure
Measure image dimensions (w, h, trimW, trimH). Exposes variables for subsequent steps.

```json
{"op": "measure", "src": "image", "out": "m"}
```

### trimRepage
Trim image and reset virtual canvas.

```json
{"op": "trimRepage", "src": "image", "out": "trimmed"}
```

### padToAspect
Pad image to target aspect ratio with background.

```json
{"op": "padToAspect", "src": "trimmed", "aspect": "3:4", "padPct": 0.06, "bg": "white", "out": "padded"}
```

### flatten
Flatten image layers with background.

```json
{"op": "flatten", "src": "image", "bg": "white", "out": "flat"}
```

### resize
Resize image.

```json
{"op": "resize", "src": "image", "mode": "width", "value": 800, "out": "resized"}
```

Modes: `width`, `height`, `percent`, `fit`.

### colorspace
Convert colorspace.

```json
{"op": "colorspace", "src": "image", "space": "sRGB", "out": "converted"}
```

Spaces: `sRGB`, `RGB`, `CMYK`, `Gray`.

### format
Convert format with quality/compression options.

```json
{"op": "format", "src": "image", "format": "jpg", "quality": 95, "out": "converted"}
```

### composite
Composite two images.

```json
{"op": "composite", "base": "bg", "overlay": "fg", "mode": "Over", "gravity": "center", "out": "result"}
```

### export
Export to response or S3.

```json
{
  "op": "export",
  "src": "image",
  "as": "jpg",
  "jpg": {"quality": 95},
  "s3": {
    "bucket": "my-bucket",
    "key": "${runId}/final/${base}.jpg",
    "contentType": "image/jpeg",
    "region": "us-east-1"
  }
}
```

## Profile Format

Profiles are JSON files with:
- `name`: Profile identifier
- `description`: Human-readable description
- `schemaVersion`: API version (currently 1)
- `inputs`: Map of input names to types (`url`, `s3`, `base64`, `multipart`)
- `steps`: Array of operations

See `profiles/mask-web.json` for a complete example.

## Profile Sources

- **S3**: `s3://bucket/path/profile.json`
- **GitHub**: `github://owner/repo/path/profile.json[@branch]`
- **HTTP(S)**: `https://example.com/profile.json`
- **Object**: `{"bucket": "...", "key": "...", "region": "..."}`

Set `PROFILE_SOURCE` environment variable or pass `?source=...` query parameter.

## Development

### Local Build (base + api)

```bash
# Build base (once)
docker build -f Dockerfile.base -t imagemagick-base:local .

# Build API (fast)
docker build -f Dockerfile.api --build-arg BASE_IMAGE=imagemagick-base:local -t imagemagick-api:local .

# Run
docker run -p 8080:8080 -e API_KEY=test imagemagick-api:local
```

### CI/CD

- **Base image**: Push tag `base-v7.1.2` to trigger base build (~30min, rare)
- **API image**: Push to main to trigger API build (~2min, frequent)
- **GitHub Actions**: Builds multi-arch (amd64, arm64) with layer caching

### Directory Structure

```
imagemagick-full-delegates-api/
├── .github/workflows/dockerhub.yml  # CI for base + API
├── Dockerfile.base                  # Heavy: ImageMagick + delegates
├── Dockerfile.api                   # Light: Node.js app code
├── src/
│   ├── server.js                    # Express app + endpoints
│   ├── pipeline.js                  # Pipeline executor
│   ├── operations.js                # Operation builders
│   ├── schema.js                    # Validation
│   ├── expressions.js               # Safe expression engine
│   ├── io.js                        # Import/export adapters
│   └── profiles.js                  # Profile loader + cache
├── profiles/
│   └── mask-web.json                # Example profile
├── package.json
└── README.md
```

## n8n Integration

Replace multi-step CloudConvert workflow with one HTTP Request node:

**Node**: HTTP Request  
**Method**: POST  
**URL**: `https://your-service.up.railway.app/v1/pipeline`  
**Headers**: `X-API-Key: {{$vars.imageMagickApiKey}}`  
**Body** (JSON):
```json
{
  "pipeline": {
    "inputs": {
      "original": "{{$json.originalTiffUrl}}",
      "alpha": "{{$json.alphaUrl}}"
    },
    "steps": [
      {"op": "maskAlpha", "src": "original", "mask": "alpha", "out": "masked"},
      {"op": "export", "src": "masked", "as": "tiff", "tiff": {"compress": "lzw"}, "s3": {"bucket": "{{$vars.s3Bucket}}", "key": "product-photos/{{$execution.id}}/final/{{$json.srcName}}.tiff", "contentType": "image/tiff", "region": "{{$vars.s3Region}}", "accessKeyId": "{{$vars.awsAccessKeyId}}", "secretAccessKey": "{{$vars.awsSecretAccessKey}}"}},
      {"op": "trimRepage", "src": "masked", "out": "t1"},
      {"op": "padToAspect", "src": "t1", "aspect": "3:4", "padPct": 0.06, "bg": "white", "out": "t2"},
      {"op": "colorspace", "src": "t2", "space": "sRGB", "out": "t3"},
      {"op": "export", "src": "t3", "as": "jpg", "jpg": {"quality": 95}, "s3": {"bucket": "{{$vars.s3Bucket}}", "key": "product-photos/{{$execution.id}}/final/{{$json.srcName}}.jpg", "contentType": "image/jpeg", "region": "{{$vars.s3Region}}", "accessKeyId": "{{$vars.awsAccessKeyId}}", "secretAccessKey": "{{$vars.awsSecretAccessKey}}"}}
    ]
  },
  "params": {
    "runId": "{{$execution.id}}",
    "base": "{{$json.srcName}}"
  }
}
```

Or use a profile for cleaner code.

## License

MIT
