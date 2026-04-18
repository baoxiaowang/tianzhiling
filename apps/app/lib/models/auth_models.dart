class AuthSessionData {
  const AuthSessionData({
    required this.accessToken,
    required this.tokenType,
    required this.expiresAt,
    required this.user,
    required this.isNewUser,
  });

  final String accessToken;
  final String tokenType;
  final int expiresAt;
  final AuthUser user;
  final bool isNewUser;

  AuthSessionData copyWith({
    String? accessToken,
    String? tokenType,
    int? expiresAt,
    AuthUser? user,
    bool? isNewUser,
  }) {
    return AuthSessionData(
      accessToken: accessToken ?? this.accessToken,
      tokenType: tokenType ?? this.tokenType,
      expiresAt: expiresAt ?? this.expiresAt,
      user: user ?? this.user,
      isNewUser: isNewUser ?? this.isNewUser,
    );
  }

  factory AuthSessionData.fromJson(Map<String, dynamic> json) {
    return AuthSessionData(
      accessToken: json['accessToken'] as String? ?? '',
      tokenType: json['tokenType'] as String? ?? 'Bearer',
      expiresAt: json['expiresAt'] as int? ?? 0,
      user: AuthUser.fromJson(
        (json['user'] as Map?)?.cast<String, dynamic>() ?? const {},
      ),
      isNewUser: json['isNewUser'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'accessToken': accessToken,
      'tokenType': tokenType,
      'expiresAt': expiresAt,
      'user': user.toJson(),
      'isNewUser': isNewUser,
    };
  }
}

class AuthUser {
  const AuthUser({
    required this.id,
    required this.name,
    required this.avatar,
    required this.account,
    required this.phone,
    required this.phoneVerified,
  });

  final String id;
  final String name;
  final String avatar;
  final String account;
  final String phone;
  final bool phoneVerified;

  AuthUser copyWith({
    String? id,
    String? name,
    String? avatar,
    String? account,
    String? phone,
    bool? phoneVerified,
  }) {
    return AuthUser(
      id: id ?? this.id,
      name: name ?? this.name,
      avatar: avatar ?? this.avatar,
      account: account ?? this.account,
      phone: phone ?? this.phone,
      phoneVerified: phoneVerified ?? this.phoneVerified,
    );
  }

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      avatar: json['avatar'] as String? ?? '',
      account: json['account'] as String? ?? '',
      phone: json['phone'] as String? ?? '',
      phoneVerified: json['phoneVerified'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'avatar': avatar,
      'account': account,
      'phone': phone,
      'phoneVerified': phoneVerified,
    };
  }
}

class SendSmsCodeResult {
  const SendSmsCodeResult({
    required this.expiresInSeconds,
    required this.resendAfterSeconds,
    this.debugCode,
  });

  final int expiresInSeconds;
  final int resendAfterSeconds;
  final String? debugCode;

  factory SendSmsCodeResult.fromJson(Map<String, dynamic> json) {
    return SendSmsCodeResult(
      expiresInSeconds: json['expiresInSeconds'] as int? ?? 300,
      resendAfterSeconds: json['resendAfterSeconds'] as int? ?? 60,
      debugCode: json['debugCode'] as String?,
    );
  }
}
