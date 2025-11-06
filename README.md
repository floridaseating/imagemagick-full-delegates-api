# ImageMagick Mask Service (full delegates)

Minimal HTTP API to:
- Apply an alpha mask to a source image → LZW-compressed TIFF with transparency (`/mask`)
- Run general ImageMagick conversions with a single input (`/process`)

Exposes:
- `GET /health` → `{ ok: true }`
- `GET /version` → ImageMagick version and delegates
- `POST /mask` → JSON `{ originalUrl, alphaUrl }` → `image/tiff` (alpha + LZW)
- `POST /process` → JSON `{ url, command }` → processed binary

Env:
- `API_KEY` (optional) → require header `X-API-Key`
- `PORT` (default 8080)

Docker Hub deploy (Railway):
1) Build & push image
2) Create Railway service from image `docker.io/<USER>/imagemagick-mask-service:latest`
3) Set `API_KEY` and `PORT=8080`
4) Test `/health`, `/version`, `/mask`


