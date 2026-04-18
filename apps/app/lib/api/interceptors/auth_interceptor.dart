import 'package:dio/dio.dart';
import 'package:tianzhiling_app/api/auth_session_store.dart';

class AuthInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final session = AuthSessionStore.session.value;

    if (session != null) {
      options.headers['Authorization'] =
          '${session.tokenType} ${session.accessToken}';
    }

    handler.next(options);
  }
}
