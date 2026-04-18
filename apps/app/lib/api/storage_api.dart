import 'dart:io';

import 'package:dio/dio.dart';
import 'package:image_picker/image_picker.dart';
import 'package:tianzhiling_app/api/api_client.dart';
import 'package:tianzhiling_app/api/api_exception.dart';

class OssSignedUploadTicket {
  const OssSignedUploadTicket({
    required this.uploadUrl,
    required this.publicUrl,
    required this.objectKey,
    required this.method,
    required this.headers,
  });

  final String uploadUrl;
  final String publicUrl;
  final String objectKey;
  final String method;
  final Map<String, String> headers;

  factory OssSignedUploadTicket.fromJson(Map<String, dynamic> json) {
    return OssSignedUploadTicket(
      uploadUrl: json['uploadUrl'] as String? ?? '',
      publicUrl: json['publicUrl'] as String? ?? '',
      objectKey: json['objectKey'] as String? ?? '',
      method: json['method'] as String? ?? 'PUT',
      headers:
          (json['headers'] as Map?)?.map(
            (key, value) => MapEntry('$key'.trim(), '$value'.trim()),
          ) ??
          const <String, String>{},
    );
  }
}

class UploadedStorageAsset {
  const UploadedStorageAsset({
    required this.objectKey,
    required this.publicUrl,
  });

  final String objectKey;
  final String publicUrl;
}

typedef UploadedImageAsset = UploadedStorageAsset;

class StorageApi {
  StorageApi._();

  static final ApiClient _client = ApiClient.instance;
  static final Dio _uploadClient = Dio(
    BaseOptions(
      connectTimeout: const Duration(minutes: 2),
      sendTimeout: const Duration(minutes: 5),
      receiveTimeout: const Duration(minutes: 2),
      responseType: ResponseType.plain,
      validateStatus: (_) => true,
    ),
  );

  static Future<OssSignedUploadTicket> createOssSignedUpload({
    required String fileName,
    required String folder,
    String? contentType,
  }) async {
    final data = await _client.post(
      '/api/storage/cos/sign-upload',
      body: <String, dynamic>{
        'fileName': fileName.trim(),
        'folder': folder.trim(),
        if (contentType != null && contentType.trim().isNotEmpty)
          'contentType': contentType.trim(),
      },
    );

    return OssSignedUploadTicket.fromJson(data);
  }

  static Future<UploadedImageAsset> uploadImage(
    XFile file, {
    String folder = 'moments',
  }) async {
    return uploadFile(
      file,
      folder: folder,
      contentType: _detectContentType(_extractFileName(file)),
    );
  }

  static Future<UploadedStorageAsset> uploadFile(
    XFile file, {
    required String folder,
    String? contentType,
  }) async {
    final fileName = _extractFileName(file);
    final ticket = await createOssSignedUpload(
      fileName: fileName,
      folder: folder,
      contentType: contentType,
    );

    if (ticket.uploadUrl.isEmpty || ticket.publicUrl.isEmpty) {
      throw ApiException('上传地址生成失败，请稍后重试');
    }

    if (ticket.method.toUpperCase() != 'PUT') {
      throw ApiException('暂不支持当前上传方式，请稍后重试');
    }

    final bytes = await file.readAsBytes();
    final headers = <String, dynamic>{
      ...ticket.headers,
      Headers.contentLengthHeader: bytes.length,
    };

    if (!_containsContentType(headers)) {
      headers[Headers.contentTypeHeader] = contentType;
    }

    final response = await _uploadClient.put<dynamic>(
      ticket.uploadUrl,
      data: bytes,
      options: Options(headers: headers),
    );

    final statusCode = response.statusCode ?? 0;

    if (statusCode != 200 && statusCode != 201 && statusCode != 204) {
      throw ApiException(
        '图片上传失败，请稍后重试',
        details:
            'statusCode=$statusCode objectKey=${ticket.objectKey} '
            'uploadUrl=${ticket.uploadUrl}',
      );
    }

    return UploadedImageAsset(
      objectKey: ticket.objectKey,
      publicUrl: ticket.publicUrl,
    );
  }

  static Future<UploadedStorageAsset> uploadFilePath(
    String filePath, {
    required String folder,
    String? fileName,
    String? contentType,
  }) async {
    final file = File(filePath);

    if (!await file.exists()) {
      throw ApiException('待上传文件不存在');
    }

    final resolvedFileName = (fileName != null && fileName.trim().isNotEmpty)
        ? fileName.trim()
        : _extractFileNameFromPath(filePath);
    final resolvedContentType =
        contentType ?? _detectContentType(resolvedFileName);
    final ticket = await createOssSignedUpload(
      fileName: resolvedFileName,
      folder: folder,
      contentType: resolvedContentType,
    );

    if (ticket.uploadUrl.isEmpty || ticket.publicUrl.isEmpty) {
      throw ApiException('上传地址生成失败，请稍后重试');
    }

    if (ticket.method.toUpperCase() != 'PUT') {
      throw ApiException('暂不支持当前上传方式，请稍后重试');
    }

    final bytes = await file.readAsBytes();
    final headers = <String, dynamic>{
      ...ticket.headers,
      Headers.contentLengthHeader: bytes.length,
    };

    if (!_containsContentType(headers)) {
      headers[Headers.contentTypeHeader] = resolvedContentType;
    }

    final response = await _uploadClient.put<dynamic>(
      ticket.uploadUrl,
      data: bytes,
      options: Options(headers: headers),
    );

    final statusCode = response.statusCode ?? 0;

    if (statusCode != 200 && statusCode != 201 && statusCode != 204) {
      throw ApiException(
        '文件上传失败，请稍后重试',
        details:
            'statusCode=$statusCode objectKey=${ticket.objectKey} '
            'uploadUrl=${ticket.uploadUrl}',
      );
    }

    return UploadedStorageAsset(
      objectKey: ticket.objectKey,
      publicUrl: ticket.publicUrl,
    );
  }

  static bool _containsContentType(Map<String, dynamic> headers) {
    for (final entry in headers.entries) {
      if (entry.key.toLowerCase() == Headers.contentTypeHeader) {
        final value = '${entry.value}'.trim();
        return value.isNotEmpty;
      }
    }

    return false;
  }

  static String _extractFileName(XFile file) {
    final name = file.name.trim();

    if (name.isNotEmpty) {
      return name;
    }

    final parts = file.path.split(RegExp(r'[\\/]'));
    return parts.isNotEmpty ? parts.last : 'image.jpg';
  }

  static String _extractFileNameFromPath(String filePath) {
    final parts = filePath.split(RegExp(r'[\\/]'));
    return parts.isNotEmpty ? parts.last : 'upload.bin';
  }

  static String _detectContentType(String fileName) {
    final lower = fileName.toLowerCase();

    if (lower.endsWith('.png')) {
      return 'image/png';
    }
    if (lower.endsWith('.webp')) {
      return 'image/webp';
    }
    if (lower.endsWith('.gif')) {
      return 'image/gif';
    }
    if (lower.endsWith('.heic')) {
      return 'image/heic';
    }
    if (lower.endsWith('.heif')) {
      return 'image/heif';
    }
    if (lower.endsWith('.bmp')) {
      return 'image/bmp';
    }
    if (lower.endsWith('.m4a')) {
      return 'audio/mp4';
    }
    if (lower.endsWith('.aac')) {
      return 'audio/aac';
    }
    if (lower.endsWith('.mp3')) {
      return 'audio/mpeg';
    }
    if (lower.endsWith('.wav')) {
      return 'audio/wav';
    }
    if (lower.endsWith('.ogg')) {
      return 'audio/ogg';
    }
    if (lower.endsWith('.webm')) {
      return 'audio/webm';
    }

    return 'image/jpeg';
  }
}
