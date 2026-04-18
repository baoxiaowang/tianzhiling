import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tianzhiling_app/models/auth_models.dart';

class AuthSessionStore {
  static const String _storageKey = 'auth_session';
  static final ValueNotifier<AuthSessionData?> session =
      ValueNotifier<AuthSessionData?>(null);
  static SharedPreferences? _preferences;

  static Future<void> save(AuthSessionData value) async {
    session.value = value;
    try {
      final preferences = await _getPreferences();
      await preferences.setString(_storageKey, jsonEncode(value.toJson()));
    } on MissingPluginException {
      debugPrint(
        'shared_preferences plugin is not registered yet; skip saving session.',
      );
    }
  }

  static Future<void> restore() async {
    SharedPreferences preferences;
    try {
      preferences = await _getPreferences();
    } on MissingPluginException {
      debugPrint(
        'shared_preferences plugin is not registered yet; skip restoring session.',
      );
      return;
    }

    final rawSession = preferences.getString(_storageKey);

    if (rawSession == null || rawSession.isEmpty) {
      return;
    }

    try {
      final decoded = jsonDecode(rawSession);
      final restoredSession = decoded is Map<String, dynamic>
          ? AuthSessionData.fromJson(decoded)
          : decoded is Map
          ? AuthSessionData.fromJson(decoded.cast<String, dynamic>())
          : null;

      if (restoredSession == null) {
        throw const FormatException('Invalid auth session payload');
      }

      if (restoredSession.expiresAt <= DateTime.now().millisecondsSinceEpoch) {
        await preferences.remove(_storageKey);
        return;
      }

      session.value = restoredSession;
      return;
    } catch (_) {
      // Ignore corrupted local cache and clear it below.
    }

    await preferences.remove(_storageKey);
  }

  static Future<void> clear() async {
    session.value = null;
    try {
      final preferences = await _getPreferences();
      await preferences.remove(_storageKey);
    } on MissingPluginException {
      debugPrint(
        'shared_preferences plugin is not registered yet; skip clearing session.',
      );
    }
  }

  static Future<SharedPreferences> _getPreferences() async {
    _preferences ??= await SharedPreferences.getInstance();
    return _preferences!;
  }
}
