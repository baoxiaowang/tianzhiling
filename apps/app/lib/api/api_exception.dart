class ApiException implements Exception {
  ApiException(this.message, {this.code, this.details});

  final String message;
  final String? code;
  final String? details;

  bool get requiresReLogin {
    return code == 'USER_NOT_FOUND' ||
        code == 'UNAUTHORIZED' ||
        code == 'INVALID_AUTHORIZATION' ||
        code == 'INVALID_TOKEN' ||
        code == 'TOKEN_REVOKED' ||
        code == 'TOKEN_EXPIRED';
  }

  factory ApiException.fromCode(
    String? code, {
    required String fallback,
    String? details,
  }) {
    return ApiException(
      _messageForCode(code, fallback: fallback),
      code: code,
      details: details,
    );
  }

  @override
  String toString() => details == null ? message : '$message\n$details';

  static String _messageForCode(String? code, {required String fallback}) {
    switch (code) {
      case 'USER_NOT_FOUND':
        return '用户信息不存在，请重新登录';
      case 'UNAUTHORIZED':
      case 'INVALID_AUTHORIZATION':
      case 'INVALID_TOKEN':
      case 'TOKEN_REVOKED':
      case 'TOKEN_EXPIRED':
        return '登录状态已失效，请重新登录';
      case 'INVALID_USER_NAME':
        return '昵称格式不正确，请重新输入';
      case 'INVALID_AGENT_NAME':
        return '请输入 30 个字以内的纪念对象名称';
      case 'INVALID_AGENT_SEX':
        return '请选择 TA 的性别';
      case 'INVALID_I_CALL_AGENT':
        return '请输入你对 TA 的称呼';
      case 'INVALID_AGENT_CALL_ME':
        return '请输入 TA 对你的称呼';
      case 'POST_NOT_FOUND':
        return '这条动态不存在或已被删除';
      case 'COMMENT_NOT_FOUND':
        return '这条评论不存在或已被删除';
      case 'INVALID_COMMENT_CONTENT':
        return '请输入 500 个字以内的评论内容';
      default:
        return fallback;
    }
  }
}
