import 'package:tianzhiling_app/api/api_client.dart';
import 'package:tianzhiling_app/api/auth_session_store.dart';
import 'package:tianzhiling_app/models/auth_models.dart';

export 'package:tianzhiling_app/api/api_exception.dart';
export 'package:tianzhiling_app/api/auth_session_store.dart';
export 'package:tianzhiling_app/models/auth_models.dart';

class AuthApi {
  static final ApiClient _client = ApiClient.instance;

  static Future<SendSmsCodeResult> sendSmsCode(String phone) async {
    final data = await _client.post(
      '/api/user/sms-code',
      body: <String, dynamic>{'phone': phone},
    );

    return SendSmsCodeResult.fromJson(data);
  }

  static Future<AuthSessionData> phoneLogin({
    required String phone,
    required String code,
  }) async {
    final data = await _client.post(
      '/api/user/phone-login',
      body: <String, dynamic>{'phone': phone, 'code': code},
    );
    final session = AuthSessionData.fromJson(data);
    await AuthSessionStore.save(session);
    return session;
  }

  static Future<AuthSessionData> passwordLogin({
    required String account,
    required String password,
  }) async {
    final data = await _client.post(
      '/api/user/password-login',
      body: <String, dynamic>{'account': account, 'password': password},
    );
    final session = AuthSessionData.fromJson(data);
    await AuthSessionStore.save(session);
    return session;
  }

  static Future<AuthUser> getCurrentUser() async {
    final data = await _client.get('/api/user/me');
    final user = AuthUser.fromJson(data);
    final session = AuthSessionStore.session.value;

    if (session != null) {
      await AuthSessionStore.save(session.copyWith(user: user));
    }

    return user;
  }

  static Future<AuthUser> updateDisplayName(String name) async {
    final data = await _client.patch(
      '/api/user/me/name',
      body: <String, dynamic>{'name': name},
    );
    final user = AuthUser.fromJson(data);
    final session = AuthSessionStore.session.value;

    if (session != null) {
      await AuthSessionStore.save(session.copyWith(user: user));
    }

    return user;
  }

  static Future<AuthUser> updateAvatar(String avatar) async {
    final data = await _client.patch(
      '/api/user/me/avatar',
      body: <String, dynamic>{'avatar': avatar},
    );
    final user = AuthUser.fromJson(data);
    final session = AuthSessionStore.session.value;

    if (session != null) {
      await AuthSessionStore.save(session.copyWith(user: user));
    }

    return user;
  }

  static Future<void> logout() async {
    await _client.post('/api/user/logout');
  }
}
