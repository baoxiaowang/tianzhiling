import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:tianzhiling_app/api/api_exception.dart';
import 'package:tianzhiling_app/api/auth_session_store.dart';
import 'package:tianzhiling_app/api/post_api.dart';
import 'package:tianzhiling_app/models/post_models.dart';

class PostCommentNotificationCenter {
  PostCommentNotificationCenter._() {
    AuthSessionStore.session.addListener(_handleSessionChanged);
  }

  static final PostCommentNotificationCenter instance =
      PostCommentNotificationCenter._();

  final ValueNotifier<PostCommentNotificationSummary?> summaryNotifier =
      ValueNotifier<PostCommentNotificationSummary?>(null);

  Timer? _pollingTimer;
  bool _isRefreshing = false;

  void startPolling() {
    if (AuthSessionStore.session.value == null) {
      stopPolling(clearSummary: true);
      return;
    }

    _pollingTimer ??= Timer.periodic(
      const Duration(seconds: 10),
      (_) => refresh(),
    );
    unawaited(refresh());
  }

  void stopPolling({bool clearSummary = false}) {
    _pollingTimer?.cancel();
    _pollingTimer = null;

    if (clearSummary) {
      summaryNotifier.value = null;
    }
  }

  Future<void> refresh() async {
    if (_isRefreshing) {
      return;
    }

    if (AuthSessionStore.session.value == null) {
      stopPolling(clearSummary: true);
      return;
    }

    _isRefreshing = true;
    try {
      final summary = await PostApi.getCommentNotificationSummary();
      summaryNotifier.value = summary;
    } on ApiException catch (error) {
      if (error.requiresReLogin) {
        stopPolling(clearSummary: true);
        await AuthSessionStore.clear();
        return;
      }
    } catch (_) {
      // Keep the latest successful summary and ignore transient polling errors.
    } finally {
      _isRefreshing = false;
    }
  }

  void _handleSessionChanged() {
    if (AuthSessionStore.session.value != null) {
      return;
    }

    stopPolling(clearSummary: true);
  }
}
