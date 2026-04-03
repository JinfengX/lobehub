import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

// MIME type mapping for static assets
const MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Serves static files from public/_spa/ directory.
 *
 * In Next.js standalone mode (Docker), static files from `public/` are not
 * automatically served. This route handler explicitly serves SPA assets
 * that were built by Vite and copied to `public/_spa/`.
 *
 * The Vite build sets `base: '/_spa/'`, so all asset references in the
 * built HTML point to `/_spa/assets/*.js`, `/_spa/assets/*.css`, etc.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await params;

  if (!path || path.length === 0) {
    return new Response('Not Found', { status: 404 });
  }

  // Prevent directory traversal attacks
  const relativePath = path.join('/');
  if (relativePath.includes('..') || relativePath.includes('\0')) {
    return new Response('Bad Request', { status: 400 });
  }

  // Resolve file path relative to project root
  // In Docker standalone: /app/public/_spa/...
  // In development: ./public/_spa/...
  const publicDir = process.cwd();
  const filePath = join(publicDir, 'public', '_spa', relativePath);

  // Ensure the resolved path is still within public/_spa/
  const spaRoot = join(publicDir, 'public', '_spa');
  if (!filePath.startsWith(spaRoot)) {
    return new Response('Bad Request', { status: 400 });
  }

  try {
    // Check if file exists and is a regular file
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      return new Response('Not Found', { status: 404 });
    }

    const content = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    return new Response(content, {
      headers: {
        // Match caching headers from vercel.json for /_spa/* assets
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800, stale-if-error=86400, immutable',
        'CDN-Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800, stale-if-error=86400, immutable',
        'Content-Type': contentType,
      },
    });
  } catch (error) {
    // File not found or read error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Response('Not Found', { status: 404 });
    }
    return new Response('Internal Server Error', { status: 500 });
  }
}
