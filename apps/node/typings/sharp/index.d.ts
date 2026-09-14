/** TS 4.8/node resolution cannot select sharp's conditional CJS types.
 * Reuse the package's complete legacy declaration; no runtime deep import.
 */
declare module 'sharp' {
  import sharp = require('sharp/lib');
  export = sharp;
}
