import {
  UPLOAD_MEDIA_TYPES,
  isAllowedUploadContentType,
  normalizeUploadContentType,
  resolveUploadMediaType,
} from '../../src/common/upload-media-types';

describe('上传媒体类型白名单', () => {
  it('覆盖入库白名单里的全部扩展名', () => {
    const busboyWhitelist = [
      'jpg',
      'jpeg',
      'png',
      'webp',
      'gif',
      'heic',
      'heif',
      'bmp',
      'm4a',
      'aac',
      'mp3',
      'wav',
      'ogg',
      'webm',
      'amr',
      'silk',
      'mp4',
      'm4v',
      'mov',
    ];

    busboyWhitelist.forEach(extension => {
      expect(UPLOAD_MEDIA_TYPES[extension]).toBeTruthy();
    });
    expect(Object.keys(UPLOAD_MEDIA_TYPES).sort()).toEqual(
      busboyWhitelist.slice().sort()
    );
  });

  it('按扩展名推导存储类型（与小程序端映射一致）', () => {
    expect(resolveUploadMediaType('照片.JPG')).toBe('image/jpeg');
    expect(resolveUploadMediaType('a.png')).toBe('image/png');
    expect(resolveUploadMediaType('录音.mp3')).toBe('audio/mpeg');
    expect(resolveUploadMediaType('录屏.mp4')).toBe('video/mp4');
    expect(resolveUploadMediaType('voice.silk')).toBe('audio/silk');
  });

  it('拒绝非媒体扩展名', () => {
    expect(resolveUploadMediaType('index.html')).toBeUndefined();
    expect(resolveUploadMediaType('shell.php')).toBeUndefined();
    expect(resolveUploadMediaType('DHCJzU')).toBeUndefined();
    expect(resolveUploadMediaType(undefined)).toBeUndefined();
  });

  it('声明类型必须是白名单内的媒体类型', () => {
    expect(isAllowedUploadContentType('image/jpeg')).toBe(true);
    expect(isAllowedUploadContentType('image/jpeg; charset=utf-8')).toBe(true);
    expect(isAllowedUploadContentType('IMAGE/PNG')).toBe(true);
    expect(isAllowedUploadContentType('text/html')).toBe(false);
    expect(isAllowedUploadContentType('application/javascript')).toBe(false);
    expect(isAllowedUploadContentType(undefined)).toBe(false);
  });

  it('归一化去掉参数并转小写', () => {
    expect(normalizeUploadContentType(' Image/JPEG ; charset=x ')).toBe(
      'image/jpeg'
    );
    expect(normalizeUploadContentType(undefined)).toBe('');
  });
});
