import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { extname, normalize, resolve, sep } from 'path';
import { Context, NextFunction } from '@midwayjs/koa';

const publicRoot = resolve(__dirname, '..', '..', 'public');
const publicPrefix = '/public/';

function resolvePublicFilePath(requestPath: string) {
  const relativePath = normalize(
    decodeURIComponent(requestPath.slice(publicPrefix.length))
  );
  const resolvedPath = resolve(publicRoot, relativePath);

  if (
    resolvedPath !== publicRoot &&
    !resolvedPath.startsWith(`${publicRoot}${sep}`)
  ) {
    return null;
  }

  return resolvedPath;
}

export async function servePublicAsset(ctx: Context, next: NextFunction) {
  if (
    (ctx.method !== 'GET' && ctx.method !== 'HEAD') ||
    !ctx.path.startsWith(publicPrefix)
  ) {
    await next();
    return;
  }

  const filePath = resolvePublicFilePath(ctx.path);

  if (!filePath) {
    ctx.status = 404;
    return;
  }

  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      ctx.status = 404;
      return;
    }

    ctx.set('Cache-Control', 'public, max-age=86400');
    ctx.type = extname(filePath);
    ctx.length = fileStat.size;

    if (ctx.method === 'HEAD') {
      ctx.status = 200;
      return;
    }

    ctx.body = createReadStream(filePath);
  } catch {
    ctx.status = 404;
  }
}
