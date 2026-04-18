import 'package:tianzhiling_app/api/api_config.dart';

class MediaAsset {
  MediaAsset._();

  static String resolveUrl({String? objectKey, String? url}) {
    final directUrl = (url ?? '').trim();
    if (directUrl.isNotEmpty) {
      return directUrl;
    }

    final key = (objectKey ?? '').trim();
    if (key.isEmpty) {
      return '';
    }

    final encoded = key
        .split('/')
        .where((segment) => segment.trim().isNotEmpty)
        .map(Uri.encodeComponent)
        .join('/');
    return '${ApiConfig.mediaBaseUrl}/$encoded';
  }
}
