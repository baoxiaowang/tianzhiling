import 'package:tianzhiling_app/api/api_client.dart';
import 'package:tianzhiling_app/api/auth_session_store.dart';
import 'package:tianzhiling_app/models/auth_models.dart';

export 'package:tianzhiling_app/api/api_exception.dart';
export 'package:tianzhiling_app/api/auth_session_store.dart';
export 'package:tianzhiling_app/models/auth_models.dart';

class AuthApi {
  static final ApiClient _client = ApiClient.instance;

  /// App 微信登录：用微信开放平台授权 code 换后端会话。
  ///
  /// 后端按 unionid 复用 weapp/App 同一账号，未命中时创建 `wechat:<openid>` 新账号；
  /// 会话保存复用 [AuthSessionStore.save]。
  static Future<AuthSessionData> wechatLogin({required String code}) async {
    final data = await _client.post(
      '/api/user/wechat-login',
      body: <String, dynamic>{'code': code},
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
