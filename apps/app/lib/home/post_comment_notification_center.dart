import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:tianzhiling_app/api/post_api.dart';
import 'package:tianzhiling_app/models/post_models.dart';

class PostCommentNotificationCenter {
  PostCommentNotificationCenter._();

  static final PostCommentNotificationCenter instance =
      PostCommentNotificationCenter._();

  final ValueNotifier<PostCommentNotificationSummary?> summaryNotifier =
      ValueNotifier<PostCommentNotificationSummary?>(null);

  Timer? _pollingTimer;
  bool _isRefreshing = false;

  void startPolling() {
    _pollingTimer ??= Timer.periodic(
      const Duration(seconds: 10),
      (_) => refresh(),
    );
    unawaited(refresh());
  }

  void stopPolling() {
    _pollingTimer?.cancel();
    _pollingTimer = null;
  }

  Future<void> refresh() async {
    if (_isRefreshing) {
      return;
    }

    _isRefreshing = true;
    try {
      final summary = await PostApi.getCommentNotificationSummary();
      summaryNotifier.value = summary;
    } catch (_) {
      // Keep the latest successful summary and ignore transient polling errors.
    } finally {
      _isRefreshing = false;
    }
  }
}
