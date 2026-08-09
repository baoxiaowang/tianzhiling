import 'package:flutter/foundation.dart';
import 'package:tianzhiling_app/api/conversation_api.dart';
import 'package:tianzhiling_app/models/conversation_models.dart';

/// Tracks which agent/conversation is currently active in the chat tab.
class ActiveConversationStore {
  ActiveConversationStore._();

  static final ValueNotifier<ConversationSummary?> active =
      ValueNotifier<ConversationSummary?>(null);

  static final ValueNotifier<List<ConversationSummary>> conversations =
      ValueNotifier<List<ConversationSummary>>(const []);

  /// Load conversations and auto-select the first one if nothing is active.
  static Future<void> load() async {
    try {
      final list = await ConversationApi.getConversations();
      conversations.value = list;

      if (active.value == null && list.isNotEmpty) {
        active.value = list.first;
      } else if (active.value != null) {
        final match = list.cast<ConversationSummary?>().firstWhere(
          (c) => c?.id == active.value?.id,
          orElse: () => null,
        );
        if (match != null) {
          active.value = match;
        } else if (list.isNotEmpty) {
          active.value = list.first;
        }
      }
    } catch (_) {
      // Keep current values on failure
    }
  }

  static void select(ConversationSummary conversation) {
    active.value = conversation;
  }

  static void clear() {
    active.value = null;
    conversations.value = const [];
  }
}
