import 'dart:async';

import 'package:dio/dio.dart';
import 'package:tianzhiling_app/api/api_config.dart';
import 'package:tianzhiling_app/api/api_exception.dart';
import 'package:tianzhiling_app/api/api_response.dart';
import 'package:tianzhiling_app/api/interceptors/auth_interceptor.dart';

class ApiClient {
  static const Duration _connectTimeout = Duration(minutes: 2);
  static const Duration _sendTimeout = Duration(minutes: 2);
  static const Duration _receiveTimeout = Duration(minutes: 2);

  ApiClient._()
    : _dio = Dio(
        BaseOptions(
          baseUrl: ApiConfig.baseUrl,
          connectTimeout: _connectTimeout,
          sendTimeout: _sendTimeout,
          receiveTimeout: _receiveTimeout,
          contentType: Headers.jsonContentType,
          responseType: ResponseType.json,
          headers: const {'Accept': 'application/json'},
          validateStatus: (_) => true,
        ),
      ) {
    _dio.interceptors.add(AuthInterceptor());
  }

  static final ApiClient instance = ApiClient._();

  final Dio _dio;

  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? queryParameters,
  }) {
    return request(path, queryParameters: queryParameters);
  }

  Future<Map<String, dynamic>> post(String path, {Map<String, dynamic>? body}) {
    return request(path, method: 'POST', body: body);
  }

  Future<Map<String, dynamic>> patch(
    String path, {
    Map<String, dynamic>? body,
  }) {
    return request(path, method: 'PATCH', body: body);
  }

  Future<Map<String, dynamic>> request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? queryParameters,
    Map<String, dynamic>? body,
  }) async {
    try {
      final response = await _dio.request<dynamic>(
        path,
        queryParameters: queryParameters,
        data: body,
        options: Options(method: method),
      );

      return ApiResponse.fromRaw(
        response.data,
        statusCode: response.statusCode,
      ).requireMapData();
    } on DioException catch (error) {
      throw _mapDioException(error);
    }
  }

  ApiException _mapDioException(DioException error) {
    final uri = error.requestOptions.uri.toString();
    final statusCode = error.response?.statusCode;
    final errorDetails =
        'uri=$uri type=${error.type.name} '
        'statusCode=${statusCode ?? '-'} '
        'error=${error.error ?? error.message ?? 'unknown'}';

    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return ApiException('请求超时，请稍后重试', details: errorDetails);
      case DioExceptionType.connectionError:
        return ApiException(
          '无法连接到服务端，请确认 node 服务已启动并检查 API_BASE_URL 配置',
          details: errorDetails,
        );
      case DioExceptionType.cancel:
        return ApiException('请求已取消', details: errorDetails);
      case DioExceptionType.badResponse:
        final response = error.response;
        if (response != null) {
          try {
            ApiResponse.fromRaw(
              response.data,
              statusCode: response.statusCode,
            ).requireMapData();
          } on ApiException catch (apiError) {
            return ApiException(
              apiError.message,
              code: apiError.code,
              details: apiError.details ?? errorDetails,
            );
          }
        }
        return ApiException('请求失败，请稍后重试', details: errorDetails);
      case DioExceptionType.badCertificate:
        return ApiException('证书校验失败，请检查服务端配置', details: errorDetails);
      case DioExceptionType.unknown:
        if ('${error.error}'.contains('SocketException')) {
          return ApiException(
            '无法连接到服务端，请确认 node 服务已启动并检查 API_BASE_URL 配置',
            details: errorDetails,
          );
        }
        if (error.error is TimeoutException) {
          return ApiException('请求超时，请稍后重试', details: errorDetails);
        }
        return ApiException('请求失败，请稍后重试', details: errorDetails);
    }
  }
}
