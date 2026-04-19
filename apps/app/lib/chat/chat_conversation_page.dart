import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:audio_session/audio_session.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/gestures.dart' show LongPressDownDetails;
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:just_audio/just_audio.dart';
import 'package:tianzhiling_app/agent/agent_detail_page.dart';
import 'package:tianzhiling_app/api/agent_api.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/api/conversation_api.dart';
import 'package:tianzhiling_app/api/media_asset.dart';
import 'package:tianzhiling_app/api/storage_api.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';
import 'package:tianzhiling_app/chat/chat_image_editor_page.dart';
import 'package:tianzhiling_app/chat/widgets/chat_composer_bar.dart';
import 'package:tianzhiling_app/chat/widgets/chat_more_panel.dart';
import 'package:tianzhiling_app/chat/widgets/emoji_picker_panel.dart';
import 'package:tianzhiling_app/chat/widgets/voice_recording_overlay.dart';
import 'package:tianzhiling_app/models/agent_models.dart';
import 'package:tianzhiling_app/models/conversation_models.dart';
import 'package:tianzhiling_app/user/app_avatar.dart';
import 'package:record/record.dart';

class ChatConversationPage extends StatefulWidget {
  const ChatConversationPage({super.key, required this.conversation});

  final ConversationSummary conversation;

  @override
  State<ChatConversationPage> createState() => _ChatConversationPageState();
}

class _ChatConversationPageState extends State<ChatConversationPage> {
  static const List<String> _typingDotFrames = <String>['.', '..', '...', '.'];
  static const List<String> _commonEmojis = <String>[
    '😀',
    '😄',
    '😁',
    '🥹',
    '😊',
    '😉',
    '😍',
    '😘',
    '🥰',
    '😋',
    '🤔',
    '😎',
    '🥳',
    '😭',
    '😂',
    '😤',
    '😴',
    '🙄',
    '😅',
    '🥲',
    '😇',
    '🤗',
    '🤭',
    '🤩',
    '😌',
    '😔',
    '😢',
    '😡',
    '👍',
    '👋',
    '🙏',
    '❤️',
    '💔',
    '🎉',
    '🎂',
    '🌹',
    '🌈',
    '☀️',
    '🌙',
    '⭐️',
    '🍎',
    '🍜',
    '☕️',
    '🎵',
    '🎈',
    '🐶',
    '🐱',
    '🐼',
  ];

  final TextEditingController _inputController = TextEditingController();
  final FocusNode _inputFocusNode = FocusNode();
  final ScrollController _scrollController = ScrollController();
  final GlobalKey _pageContentKey = GlobalKey();
  final AudioRecorder _audioRecorder = AudioRecorder();
  final AudioPlayer _voicePlayer = AudioPlayer();
  final ImagePicker _imagePicker = ImagePicker();

  bool _isLoading = true;
  bool _isSending = false;
  bool _isTranscribingVoice = false;
  bool _isUploadingVoice = false;
  bool _isUploadingImage = false;
  String? _errorMessage;
  List<ConversationMessage> _messages = const [];
  AgentSummary? _agentDetail;
  double _lastKeyboardInset = 0;
  Timer? _typingDotsTimer;
  int _typingDotsFrameIndex = 0;
  bool _isEmojiPickerVisible = false;
  bool _isMorePanelVisible = false;
  bool _isVoiceMode = false;
  bool _isVoicePressing = false;
  bool _isVoicePressPreviewing = false;
  bool _inputHasText = false;
  VoiceDragTarget _voiceDragTarget = VoiceDragTarget.send;
  Offset? _voiceGestureStartPosition;
  String? _activeRecordingPath;
  DateTime? _recordingStartedAt;
  String? _activeVoiceMessageId;
  bool _isVoicePlaybackLoading = false;
  bool _isVoicePlaying = false;
  final Map<String, String> _voicePlaybackCachePaths = <String, String>{};

  @override
  void initState() {
    super.initState();
    _inputHasText = _inputController.text.trim().isNotEmpty;
    _inputController.addListener(_handleInputChanged);
    _inputFocusNode.addListener(_handleInputFocusChanged);
    _voicePlayer.playerStateStream.listen(_handleVoicePlayerStateChanged);
    unawaited(_configureAudioSession());
    _loadAgentDetail();
    _loadMessages();
  }

  @override
  void dispose() {
    _typingDotsTimer?.cancel();
    unawaited(_audioRecorder.dispose());
    unawaited(_voicePlayer.dispose());
    unawaited(_disposeVoicePlaybackCache());
    _inputController
      ..removeListener(_handleInputChanged)
      ..dispose();
    _inputFocusNode
      ..removeListener(_handleInputFocusChanged)
      ..dispose();
    _scrollController.dispose();
    super.dispose();
  }

  bool get _canSend =>
      !_isSending && !_isUploadingVoice && !_isUploadingImage && _inputHasText;

  String get _typingDots => _typingDotFrames[_typingDotsFrameIndex];

  bool get _isVoiceGestureActive =>
      _isVoicePressing || _isVoicePressPreviewing;

  bool get _isVoiceOverlayVisible => _isVoiceMode && _isVoiceGestureActive;

  Future<void> _loadAgentDetail() async {
    try {
      final agent = await AgentApi.getAgentDetail(widget.conversation.agentId);

      if (!mounted) {
        return;
      }

      setState(() {
        _agentDetail = agent;
      });
    } on ApiException catch (error) {
      if (error.requiresReLogin) {
        await AuthSessionStore.clear();
        if (!mounted) {
          return;
        }
        Navigator.of(
          context,
        ).pushNamedAndRemoveUntil(AuthPage.routeName, (_) => false);
      }
    } catch (_) {
      // Keep the conversation snapshot as fallback when profile refresh fails.
    }
  }

  Future<void> _loadMessages({bool showLoading = true}) async {
    if (showLoading) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    } else {
      setState(() {
        _errorMessage = null;
      });
    }

    try {
      final messages = await ConversationApi.getMessages(
        widget.conversation.id,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _messages = messages;
        _isLoading = false;
      });

      _syncActiveVoiceMessage(messages);

      _scheduleScrollToBottom();
    } on ApiException catch (error) {
      await _handleApiError(error, fallbackMessage: '加载消息失败，请稍后重试');
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() {
        _errorMessage = '加载消息失败，请稍后重试';
        _isLoading = false;
      });
    }
  }

  Future<void> _sendMessage() async {
    final content = _inputController.text.trim();
    if (content.isEmpty) {
      return;
    }

    await _sendTextMessageContent(
      content,
      clearInputBeforeRequest: true,
      restoreInputOnFailure: true,
    );
  }

  Future<void> _sendTextMessageContent(
    String rawContent, {
    bool clearInputBeforeRequest = false,
    bool restoreInputOnFailure = false,
  }) async {
    final content = rawContent.trim();
    if (content.isEmpty || _isSending || _isUploadingVoice) {
      return;
    }

    final tempId = 'local-${DateTime.now().microsecondsSinceEpoch}';
    final now = DateTime.now();
    final tempMessage = ConversationMessage(
      id: tempId,
      conversationId: widget.conversation.id,
      role: 'user',
      type: 'text',
      content: content,
      segments: <String>[content],
      status: 'sent',
      createdAt: now,
      updatedAt: now,
    );

    setState(() {
      _messages = [..._messages, tempMessage];
      _isSending = true;
      _errorMessage = null;
    });
    _startTypingDots();
    if (clearInputBeforeRequest) {
      _inputController.clear();
    }
    _scheduleScrollToBottom();

    try {
      final result = await ConversationApi.sendMessage(
        widget.conversation.id,
        content: content,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        final updatedMessages = [..._messages];
        final tempIndex = updatedMessages.indexWhere(
          (message) => message.id == tempId,
        );

        if (tempIndex >= 0) {
          updatedMessages[tempIndex] = result.userMessage;
        } else {
          updatedMessages.add(result.userMessage);
        }
        _messages = updatedMessages;
      });

      final assistantMessage = result.assistantMessage;
      if (assistantMessage != null) {
        final assistantParts = assistantMessage.segments.isNotEmpty
            ? assistantMessage.segments
            : <String>[assistantMessage.content];
        await _appendAssistantSegments(assistantMessage, assistantParts);
      } else {
        setState(() {
          _isSending = false;
        });
        _stopTypingDots();
      }
      _scheduleScrollToBottom();
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isSending = false;
      });
      _stopTypingDots();

      if (restoreInputOnFailure) {
        _inputController.text = content;
        _inputController.selection = TextSelection.fromPosition(
          TextPosition(offset: _inputController.text.length),
        );
      }

      await _handleApiError(
        error,
        fallbackMessage: '发送消息失败，请稍后重试',
        asSnackBar: true,
      );
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isSending = false;
      });
      _stopTypingDots();

      if (restoreInputOnFailure) {
        _inputController.text = content;
        _inputController.selection = TextSelection.fromPosition(
          TextPosition(offset: _inputController.text.length),
        );
      }
      _showSnackBar('发送消息失败，请稍后重试');
    }
  }

  Future<void> _appendAssistantSegments(
    ConversationMessage assistantMessage,
    List<String> assistantParts,
  ) async {
    if (!mounted) {
      return;
    }

    for (var index = 0; index < assistantParts.length; index++) {
      final part = assistantParts[index].trim();
      if (part.isEmpty || !mounted) {
        continue;
      }

      if (index > 0) {
        await Future<void>.delayed(
          Duration(milliseconds: 2000 + ((index - 1) % 2) * 1000),
        );
        if (!mounted) {
          return;
        }
      }

      final nextMessage = assistantMessage.copyWith(
        id: '${assistantMessage.id}-$index',
        content: part,
        segments: <String>[part],
      );

      setState(() {
        _messages = [..._messages, nextMessage];
      });
      _scheduleScrollToBottom();
    }

    if (!mounted) {
      return;
    }

    setState(() {
      _isSending = false;
    });
    _stopTypingDots();
  }

  void _startTypingDots() {
    _typingDotsTimer?.cancel();
    _typingDotsFrameIndex = 0;
    _typingDotsTimer = Timer.periodic(const Duration(milliseconds: 450), (_) {
      if (!mounted || !_isSending) {
        _stopTypingDots();
        return;
      }

      setState(() {
        _typingDotsFrameIndex =
            (_typingDotsFrameIndex + 1) % _typingDotFrames.length;
      });
    });
  }

  void _stopTypingDots() {
    _typingDotsTimer?.cancel();
    _typingDotsTimer = null;
    if (!mounted) {
      return;
    }

    setState(() {
      _typingDotsFrameIndex = 0;
    });
  }

  Future<void> _handleApiError(
    ApiException error, {
    required String fallbackMessage,
    bool asSnackBar = false,
  }) async {
    if (error.requiresReLogin) {
      await AuthSessionStore.clear();
      if (!mounted) {
        return;
      }
      Navigator.of(
        context,
      ).pushNamedAndRemoveUntil(AuthPage.routeName, (_) => false);
      return;
    }

    if (!mounted) {
      return;
    }

    if (asSnackBar) {
      _showSnackBar(error.message.isNotEmpty ? error.message : fallbackMessage);
      return;
    }

    setState(() {
      _errorMessage = error.message.isNotEmpty
          ? error.message
          : fallbackMessage;
      _isLoading = false;
    });
  }

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
      );
  }

  void _handleVoicePlayerStateChanged(PlayerState state) {
    if (!mounted) {
      return;
    }

    final isLoading =
        state.processingState == ProcessingState.loading ||
        state.processingState == ProcessingState.buffering;
    final isCompleted = state.processingState == ProcessingState.completed;

    if (isCompleted) {
      unawaited(_voicePlayer.pause());
      unawaited(_voicePlayer.seek(Duration.zero));
    }

    setState(() {
      _isVoicePlaybackLoading = isLoading;
      _isVoicePlaying =
          state.playing && state.processingState == ProcessingState.ready;
      if (isCompleted) {
        _activeVoiceMessageId = null;
        _isVoicePlaybackLoading = false;
        _isVoicePlaying = false;
      }
    });
  }

  Future<void> _configureAudioSession() async {
    try {
      final session = await AudioSession.instance;
      await session.configure(
        AudioSessionConfiguration(
          avAudioSessionCategory: AVAudioSessionCategory.playAndRecord,
          avAudioSessionCategoryOptions:
              AVAudioSessionCategoryOptions.defaultToSpeaker |
              AVAudioSessionCategoryOptions.allowBluetooth |
              AVAudioSessionCategoryOptions.allowBluetoothA2dp,
          avAudioSessionMode: AVAudioSessionMode.spokenAudio,
          androidAudioAttributes: const AndroidAudioAttributes(
            contentType: AndroidAudioContentType.speech,
            usage: AndroidAudioUsage.voiceCommunication,
          ),
          androidAudioFocusGainType: AndroidAudioFocusGainType.gainTransient,
          androidWillPauseWhenDucked: true,
        ),
      );
    } catch (_) {
      // Keep best-effort session configuration; playback may still work.
    }
  }

  void _syncActiveVoiceMessage(List<ConversationMessage> messages) {
    final activeId = _activeVoiceMessageId;
    if (activeId == null) {
      return;
    }

    final stillExists = messages.any((message) => message.id == activeId);
    if (stillExists) {
      return;
    }

    setState(() {
      _activeVoiceMessageId = null;
      _isVoicePlaybackLoading = false;
      _isVoicePlaying = false;
    });
    unawaited(_voicePlayer.stop());
  }

  void _handleInputChanged() {
    final nextHasText = _inputController.text.trim().isNotEmpty;
    if (_inputHasText == nextHasText || !mounted) {
      return;
    }

    setState(() {
      _inputHasText = nextHasText;
    });
  }

  void _handleInputFocusChanged() {
    if (_inputFocusNode.hasFocus) {
      if (_isEmojiPickerVisible || _isMorePanelVisible) {
        setState(() {
          _isEmojiPickerVisible = false;
          _isMorePanelVisible = false;
        });
      }
      _scheduleScrollToBottom();
    }
  }

  void _toggleEmojiPicker() {
    FocusScope.of(context).unfocus();
    setState(() {
      _isEmojiPickerVisible = !_isEmojiPickerVisible;
      if (_isEmojiPickerVisible) {
        _isVoiceMode = false;
        _isMorePanelVisible = false;
      }
    });
    _scheduleScrollToBottom();
  }

  void _toggleMorePanel() {
    FocusScope.of(context).unfocus();
    setState(() {
      _isMorePanelVisible = !_isMorePanelVisible;
      if (_isMorePanelVisible) {
        _isEmojiPickerVisible = false;
        _isVoiceMode = false;
      }
    });
    _scheduleScrollToBottom();
  }

  void _toggleVoiceMode() {
    if (_isUploadingVoice) {
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _isVoiceMode = !_isVoiceMode;
      _isEmojiPickerVisible = false;
      _isMorePanelVisible = false;
    });
  }

  void _handleVoiceLongPressStart(LongPressStartDetails details) {
    unawaited(_startVoiceRecording(details));
  }

  void _handleVoiceLongPressDown(LongPressDownDetails details) {
    if (_isSending || _isUploadingVoice) {
      return;
    }

    FocusScope.of(context).unfocus();
    setState(() {
      _isEmojiPickerVisible = false;
      _isMorePanelVisible = false;
      _isVoicePressPreviewing = true;
      _voiceGestureStartPosition = details.globalPosition;
      _voiceDragTarget = _resolveVoiceDragTarget(details.globalPosition);
    });
  }

  Future<void> _startVoiceRecording(LongPressStartDetails details) async {
    if (_isSending || _isUploadingVoice) {
      return;
    }

    FocusScope.of(context).unfocus();
    setState(() {
      _isEmojiPickerVisible = false;
      _isMorePanelVisible = false;
      _isVoicePressing = true;
      _isVoicePressPreviewing = false;
      _voiceGestureStartPosition = details.globalPosition;
      _voiceDragTarget = _resolveVoiceDragTarget(details.globalPosition);
    });

    final hasPermission = await _audioRecorder.hasPermission();
    if (!mounted) {
      return;
    }

    if (!hasPermission) {
      setState(() {
        _isVoicePressing = false;
        _isVoicePressPreviewing = false;
        _voiceDragTarget = VoiceDragTarget.send;
        _voiceGestureStartPosition = null;
      });
      _showSnackBar('请先开启麦克风权限');
      return;
    }

    final recordDirectory = Directory(
      '${Directory.systemTemp.path}/tianzhiling_voice',
    );
    await recordDirectory.create(recursive: true);
    final startedAt = DateTime.now();
    final path =
        '${recordDirectory.path}/voice_${startedAt.millisecondsSinceEpoch}.m4a';

    try {
      await _audioRecorder.start(
        const RecordConfig(
          encoder: AudioEncoder.aacLc,
          bitRate: 128000,
          sampleRate: 44100,
        ),
        path: path,
      );

      if (!mounted) {
        return;
      }

      if (!_isVoicePressing) {
        await _audioRecorder.stop();
        await _deleteLocalFile(path);
        return;
      }

      setState(() {
        _activeRecordingPath = path;
        _recordingStartedAt = startedAt;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isVoicePressing = false;
        _isVoicePressPreviewing = false;
        _voiceDragTarget = VoiceDragTarget.send;
        _voiceGestureStartPosition = null;
        _activeRecordingPath = null;
        _recordingStartedAt = null;
      });
      _showSnackBar('录音启动失败，请稍后重试');
    }
  }

  void _handleVoiceLongPressMoveUpdate(LongPressMoveUpdateDetails details) {
    if (!_isVoiceGestureActive) {
      return;
    }

    final nextTarget = _resolveVoiceDragTarget(details.globalPosition);
    if (nextTarget == _voiceDragTarget) {
      return;
    }

    setState(() {
      _voiceDragTarget = nextTarget;
    });
  }

  void _handleVoiceLongPressCancel() {
    if (_isVoicePressing) {
      unawaited(_finishVoiceGesture(cancelledBySystem: true));
      return;
    }

    if (!_isVoicePressPreviewing) {
      return;
    }

    setState(() {
      _isVoicePressPreviewing = false;
      _voiceDragTarget = VoiceDragTarget.send;
      _voiceGestureStartPosition = null;
    });
  }

  void _handleVoiceLongPressEnd(LongPressEndDetails details) {
    unawaited(_finishVoiceGesture());
  }

  Future<void> _finishVoiceGesture({bool cancelledBySystem = false}) async {
    if (!_isVoicePressing) {
      return;
    }

    final target = _voiceDragTarget;
    final startedAt = _recordingStartedAt;
    final fallbackPath = _activeRecordingPath;
    setState(() {
      _isVoicePressing = false;
      _isVoicePressPreviewing = false;
      _voiceDragTarget = VoiceDragTarget.send;
      _voiceGestureStartPosition = null;
      _activeRecordingPath = null;
      _recordingStartedAt = null;
    });

    String? recordedPath;
    try {
      recordedPath = await _audioRecorder.stop();
    } catch (_) {
      recordedPath = null;
    }

    final resolvedPath = (recordedPath ?? fallbackPath ?? '').trim();

    if (cancelledBySystem || target == VoiceDragTarget.cancel) {
      await _deleteLocalFile(resolvedPath);
      _showSnackBar('已取消录音');
      return;
    }

    if (resolvedPath.isEmpty) {
      _showSnackBar('录音失败，请稍后重试');
      return;
    }

    final durationMs = startedAt == null
        ? 0
        : DateTime.now().difference(startedAt).inMilliseconds;
    if (durationMs < 500) {
      await _deleteLocalFile(resolvedPath);
      _showSnackBar('说话时间太短');
      return;
    }

    if (target == VoiceDragTarget.transcribe) {
      await _sendVoiceTranscription(filePath: resolvedPath);
      return;
    }

    await _sendVoiceMessage(filePath: resolvedPath, durationMs: durationMs);
  }

  VoiceDragTarget _resolveVoiceDragTarget(Offset globalPosition) {
    final renderObject =
        _pageContentKey.currentContext?.findRenderObject() as RenderBox?;
    if (renderObject == null) {
      return VoiceDragTarget.send;
    }

    final local = renderObject.globalToLocal(globalPosition);
    final size = renderObject.size;
    final bottomSafeArea = MediaQuery.paddingOf(context).bottom;
    final chipWidth = math.min(174.0, size.width * 0.44);
    const chipHeight = 70.0;
    const chipSideInset = 8.0;
    final chipBottom = 102.0 + bottomSafeArea;
    final chipTop = size.height - chipBottom - chipHeight;
    final activationPadding = _voiceDragTarget == VoiceDragTarget.send
        ? 18.0
        : 28.0;
    final cancelRect = Rect.fromLTWH(
      chipSideInset,
      chipTop,
      chipWidth,
      chipHeight,
    ).inflate(activationPadding);
    final transcribeRect = Rect.fromLTWH(
      size.width - chipSideInset - chipWidth,
      chipTop,
      chipWidth,
      chipHeight,
    ).inflate(activationPadding);
    final movedUpEnough =
        _voiceGestureStartPosition != null &&
        globalPosition.dy < _voiceGestureStartPosition!.dy - 72;

    if (transcribeRect.contains(local)) {
      return VoiceDragTarget.transcribe;
    }

    if (cancelRect.contains(local) || movedUpEnough) {
      return VoiceDragTarget.cancel;
    }

    return VoiceDragTarget.send;
  }

  Future<void> _sendVoiceMessage({
    required String filePath,
    required int durationMs,
  }) async {
    final tempId = 'local-voice-${DateTime.now().microsecondsSinceEpoch}';
    final now = DateTime.now();
    final tempMessage = ConversationMessage(
      id: tempId,
      conversationId: widget.conversation.id,
      role: 'user',
      type: 'voice',
      content: '[语音]',
      segments: const <String>[],
      status: 'sending',
      voice: ConversationVoicePayload(
        url: filePath,
        mimeType: 'audio/mp4',
        durationMs: durationMs,
      ),
      createdAt: now,
      updatedAt: now,
    );

    setState(() {
      _messages = [..._messages, tempMessage];
      _isUploadingVoice = true;
      _errorMessage = null;
    });
    _scheduleScrollToBottom();

    try {
      final uploaded = await StorageApi.uploadFilePath(
        filePath,
        folder: 'conversation-voice',
        contentType: 'audio/mp4',
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _messages = _messages.map((message) {
          if (message.id != tempId) {
            return message;
          }
          return message.copyWith(
            status: 'sent',
            voice: ConversationVoicePayload(
              objectKey: uploaded.objectKey,
              url: message.voice?.url,
              mimeType: 'audio/mp4',
              durationMs: durationMs,
              transcript: message.voice?.transcript,
            ),
          );
        }).toList();
        _isUploadingVoice = false;
        _isSending = true;
      });
      _startTypingDots();

      final result = await ConversationApi.sendMessage(
        widget.conversation.id,
        type: 'voice',
        objectKey: uploaded.objectKey,
        mimeType: 'audio/mp4',
        durationMs: durationMs,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _messages = _messages.map((message) {
          if (message.id != tempId) {
            return message;
          }
          return result.userMessage;
        }).toList();
      });

      final assistantMessage = result.assistantMessage;
      if (assistantMessage != null) {
        final assistantParts = assistantMessage.segments.isNotEmpty
            ? assistantMessage.segments
            : <String>[assistantMessage.content];
        await _appendAssistantSegments(assistantMessage, assistantParts);
      } else {
        setState(() {
          _isSending = false;
        });
        _stopTypingDots();
      }
      _scheduleScrollToBottom();
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _messages = _messages.map((message) {
          if (message.id != tempId) {
            return message;
          }
          return message.copyWith(status: 'failed');
        }).toList();
        _isUploadingVoice = false;
        _isSending = false;
      });
      _stopTypingDots();
      await _handleApiError(
        error,
        fallbackMessage: '发送语音失败，请稍后重试',
        asSnackBar: true,
      );
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _messages = _messages.map((message) {
          if (message.id != tempId) {
            return message;
          }
          return message.copyWith(status: 'failed');
        }).toList();
        _isUploadingVoice = false;
        _isSending = false;
      });
      _stopTypingDots();
      _showSnackBar('发送语音失败，请稍后重试');
    } finally {
      await _deleteLocalFile(filePath);
    }
  }

  Future<void> _sendVoiceTranscription({required String filePath}) async {
    setState(() {
      _isUploadingVoice = true;
      _isTranscribingVoice = true;
      _errorMessage = null;
    });

    try {
      final uploaded = await StorageApi.uploadFilePath(
        filePath,
        folder: 'conversation-voice',
        contentType: 'audio/mp4',
      );

      final transcript = await ConversationApi.transcribeVoice(
        widget.conversation.id,
        objectKey: uploaded.objectKey,
        mimeType: 'audio/mp4',
      );

      if (!mounted) {
        return;
      }

      final content = transcript.trim();
      setState(() {
        _isUploadingVoice = false;
        _isTranscribingVoice = false;
      });

      if (content.isEmpty) {
        _showSnackBar('暂未识别到语音内容');
        return;
      }

      await _sendTextMessageContent(content);
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isUploadingVoice = false;
        _isTranscribingVoice = false;
      });

      await _handleApiError(
        error,
        fallbackMessage: '语音转文字失败，请稍后重试',
        asSnackBar: true,
      );
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isUploadingVoice = false;
        _isTranscribingVoice = false;
      });
      _showSnackBar('语音转文字失败，请稍后重试');
    } finally {
      await _deleteLocalFile(filePath);
    }
  }

  Future<void> _deleteLocalFile(String path) async {
    final trimmed = path.trim();
    if (trimmed.isEmpty) {
      return;
    }

    final file = File(trimmed);
    if (!await file.exists()) {
      return;
    }

    try {
      await file.delete();
    } catch (_) {
      // Ignore temp file cleanup failures.
    }
  }

  Future<void> _disposeVoicePlaybackCache() async {
    final cachedPaths = _voicePlaybackCachePaths.values.toList(growable: false);
    _voicePlaybackCachePaths.clear();

    for (final path in cachedPaths) {
      await _deleteLocalFile(path);
    }
  }

  Future<String> _resolvePlayableVoicePath(ConversationMessage message) async {
    final source = MediaAsset.resolveUrl(
      objectKey: message.voice?.objectKey,
      url: message.voice?.url,
    );
    if (source.isEmpty) {
      throw const FileSystemException('Voice source is empty');
    }

    final localFile = File(source);
    if (await localFile.exists()) {
      return localFile.path;
    }

    final cachedPath = _voicePlaybackCachePaths[message.id];
    if (cachedPath != null && cachedPath.trim().isNotEmpty) {
      final cachedFile = File(cachedPath);
      if (await cachedFile.exists()) {
        return cachedFile.path;
      }
      _voicePlaybackCachePaths.remove(message.id);
    }

    final uri = Uri.tryParse(source);
    if (uri == null || !uri.hasScheme) {
      throw const FileSystemException('Voice source is invalid');
    }

    final playbackDirectory = Directory(
      '${Directory.systemTemp.path}/tianzhiling_voice_playback',
    );
    await playbackDirectory.create(recursive: true);

    final suffix = _guessVoicePlaybackSuffix(message, uri);
    final localPath = '${playbackDirectory.path}/voice_${message.id}_$suffix';
    final request = await HttpClient().getUrl(uri);
    final response = await request.close();

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw HttpException(
        'Unexpected voice response: ${response.statusCode}',
        uri: uri,
      );
    }

    final bytesBuilder = BytesBuilder(copy: false);
    await for (final chunk in response) {
      bytesBuilder.add(chunk);
    }
    final bytes = bytesBuilder.takeBytes();
    if (bytes.isEmpty) {
      throw const FileSystemException('Voice payload is empty');
    }

    final file = File(localPath);
    await file.writeAsBytes(bytes, flush: true);
    _voicePlaybackCachePaths[message.id] = file.path;
    return file.path;
  }

  String _guessVoicePlaybackSuffix(ConversationMessage message, Uri uri) {
    final mimeType = message.voice?.mimeType?.trim().toLowerCase() ?? '';
    if (mimeType.contains('mpeg')) {
      return 'cache.mp3';
    }
    if (mimeType.contains('aac')) {
      return 'cache.aac';
    }
    if (mimeType.contains('ogg')) {
      return 'cache.ogg';
    }
    if (mimeType.contains('wav')) {
      return 'cache.wav';
    }
    if (mimeType.contains('webm')) {
      return 'cache.webm';
    }

    final lastSegment = uri.pathSegments.isEmpty ? '' : uri.pathSegments.last;
    final dotIndex = lastSegment.lastIndexOf('.');
    if (dotIndex > 0 && dotIndex < lastSegment.length - 1) {
      final extension = lastSegment.substring(dotIndex + 1).trim();
      if (extension.isNotEmpty) {
        return 'cache.$extension';
      }
    }

    return 'cache.m4a';
  }

  Future<void> _toggleVoicePlayback(ConversationMessage message) async {
    if (message.isSending) {
      return;
    }

    final source = MediaAsset.resolveUrl(
      objectKey: message.voice?.objectKey,
      url: message.voice?.url,
    );
    if (source.isEmpty) {
      _showSnackBar('语音文件不可用');
      return;
    }

    try {
      await _configureAudioSession();

      if (_activeVoiceMessageId == message.id) {
        if (_isVoicePlaying) {
          await _voicePlayer.pause();
        } else {
          await _voicePlayer.play();
        }
        return;
      }

      setState(() {
        _activeVoiceMessageId = message.id;
        _isVoicePlaybackLoading = true;
        _isVoicePlaying = false;
      });

      await _voicePlayer.stop();

      final playablePath = await _resolvePlayableVoicePath(message);
      await _voicePlayer.setFilePath(playablePath);
      await _voicePlayer.play();
    } catch (error, stackTrace) {
      debugPrint('Voice playback failed: $error\n$stackTrace');
      if (!mounted) {
        return;
      }

      setState(() {
        _activeVoiceMessageId = null;
        _isVoicePlaybackLoading = false;
        _isVoicePlaying = false;
      });
      _showSnackBar('语音播放失败，请稍后重试');
    }
  }

  void _insertEmoji(String emoji) {
    final value = _inputController.value;
    final selection = value.selection;
    final text = value.text;

    final start = selection.isValid ? selection.start : text.length;
    final end = selection.isValid ? selection.end : text.length;
    final safeStart = start < 0 ? text.length : start;
    final safeEnd = end < 0 ? text.length : end;
    final nextText = text.replaceRange(safeStart, safeEnd, emoji);

    _inputController.value = TextEditingValue(
      text: nextText,
      selection: TextSelection.collapsed(offset: safeStart + emoji.length),
    );
  }

  void _deleteEmojiOrCharacter() {
    final value = _inputController.value;
    final selection = value.selection;
    final text = value.text;

    if (text.isEmpty) {
      return;
    }

    if (selection.isValid && selection.start != selection.end) {
      _inputController.value = TextEditingValue(
        text: text.replaceRange(selection.start, selection.end, ''),
        selection: TextSelection.collapsed(offset: selection.start),
      );
      return;
    }

    final cursor = selection.isValid ? selection.start : text.length;
    if (cursor <= 0) {
      return;
    }

    final left = text.characters.take(cursor).toString();
    final right = text.characters.skip(cursor).toString();
    final trimmedLeft = left.characters.skipLast(1).toString();

    _inputController.value = TextEditingValue(
      text: '$trimmedLeft$right',
      selection: TextSelection.collapsed(offset: trimmedLeft.length),
    );
  }

  bool _isScrolledNearBottom() {
    if (!_scrollController.hasClients) {
      return true;
    }

    final position = _scrollController.position;
    return position.maxScrollExtent - position.pixels <= 80;
  }

  void _handleKeyboardInsetChanged(double keyboardInset) {
    final keyboardOpened = _lastKeyboardInset <= 0 && keyboardInset > 0;
    final keyboardExpanded =
        keyboardInset > _lastKeyboardInset && _inputFocusNode.hasFocus;

    if (keyboardOpened || (keyboardExpanded && _isScrolledNearBottom())) {
      _scheduleScrollToBottom();
    }

    _lastKeyboardInset = keyboardInset;
  }

  void _scheduleScrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scrollToBottom();

      Future<void>.delayed(const Duration(milliseconds: 260), () {
        if (!mounted) {
          return;
        }

        _scrollToBottom(animated: false);
      });
    });
  }

  void _scrollToBottom({bool animated = true}) {
    if (!_scrollController.hasClients) {
      return;
    }

    final targetOffset = _scrollController.position.maxScrollExtent;

    if (animated) {
      _scrollController.animateTo(
        targetOffset,
        duration: const Duration(milliseconds: 240),
        curve: Curves.easeOutCubic,
      );
      return;
    }

    _scrollController.jumpTo(targetOffset);
  }

  Future<void> _openAgentDetail() async {
    await AgentDetailPage.open(context, widget.conversation);

    if (!mounted) {
      return;
    }

    await _loadAgentDetail();
  }

  void _handleMoreActionTap(ChatMoreAction action) {
    if (action == ChatMoreAction.photo) {
      unawaited(_pickPhotoMessage());
      return;
    }

    late final String label;
    switch (action) {
      case ChatMoreAction.photo:
        label = '照片';
        break;
      case ChatMoreAction.camera:
        label = '拍摄';
        break;
      case ChatMoreAction.videoCall:
        label = '视频通话';
        break;
      case ChatMoreAction.location:
        label = '位置';
        break;
      case ChatMoreAction.redPacket:
        label = '红包';
        break;
      case ChatMoreAction.gift:
        label = '礼物';
        break;
      case ChatMoreAction.transfer:
        label = '转账';
        break;
      case ChatMoreAction.voiceInput:
        label = '语音输入';
        break;
    }
    _showSnackBar('$label 功能待接入');
  }

  Future<void> _pickPhotoMessage() async {
    if (_isUploadingImage || _isUploadingVoice) {
      return;
    }

    try {
      final selected = await _imagePicker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 92,
        maxWidth: 2048,
      );

      if (!mounted || selected == null) {
        return;
      }

      final nextAction = await _showImageSendOptions(selected);
      if (!mounted || nextAction == null) {
        return;
      }

      XFile target = selected;
      if (nextAction == _ImageSendAction.edit) {
        final edited = await ChatImageEditorPage.edit(context, selected);
        if (!mounted || edited == null) {
          return;
        }
        target = edited;
      }

      await _sendImageMessage(target);
    } catch (_) {
      if (!mounted) {
        return;
      }
      _showSnackBar('选择图片失败，请稍后重试');
    }
  }

  Future<_ImageSendAction?> _showImageSendOptions(XFile file) {
    return showModalBottomSheet<_ImageSendAction>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return SafeArea(
          top: false,
          child: Container(
            margin: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            decoration: BoxDecoration(
              color: const Color(0xFFF7F7F7),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(height: 14),
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    image: DecorationImage(
                      image: FileImage(File(file.path)),
                      fit: BoxFit.cover,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  '这张图片要怎么发？',
                  style: TextStyle(
                    color: Color(0xFF111111),
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 14),
                _ImageSendSheetAction(
                  label: '编辑后发送',
                  onTap: () {
                    Navigator.of(context).pop(_ImageSendAction.edit);
                  },
                ),
                const Divider(height: 1, color: Color(0xFFEAEAEA)),
                _ImageSendSheetAction(
                  label: '直接发送',
                  onTap: () {
                    Navigator.of(context).pop(_ImageSendAction.send);
                  },
                ),
                const SizedBox(height: 8),
                Container(height: 8, color: const Color(0xFFF1F1F1)),
                _ImageSendSheetAction(
                  label: '取消',
                  isDestructive: true,
                  onTap: () {
                    Navigator.of(context).pop();
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _sendImageMessage(XFile file) async {
    final sourcePath = file.path.trim();
    if (sourcePath.isEmpty) {
      _showSnackBar('图片文件不可用');
      return;
    }

    final tempId = 'local-image-${DateTime.now().microsecondsSinceEpoch}';
    final now = DateTime.now();
    final mimeType = (file.mimeType?.trim().isNotEmpty ?? false)
        ? file.mimeType!.trim()
        : _guessImageMimeType(file.name, sourcePath);
    final tempMessage = ConversationMessage(
      id: tempId,
      conversationId: widget.conversation.id,
      role: 'user',
      type: 'image',
      content: '[图片]',
      segments: const <String>[],
      status: 'sending',
      image: ConversationImagePayload(url: sourcePath, mimeType: mimeType),
      createdAt: now,
      updatedAt: now,
    );

    setState(() {
      _messages = [..._messages, tempMessage];
      _isUploadingImage = true;
      _errorMessage = null;
      _isMorePanelVisible = false;
    });
    _scheduleScrollToBottom();

    try {
      final uploaded = await StorageApi.uploadFilePath(
        sourcePath,
        folder: 'conversation-images',
        fileName: file.name.trim().isEmpty ? null : file.name.trim(),
        contentType: mimeType,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _messages = _messages.map((message) {
          if (message.id != tempId) {
            return message;
          }
          return message.copyWith(
            status: 'sent',
            image: ConversationImagePayload(
              objectKey: uploaded.objectKey,
              url: message.image?.url,
              mimeType: mimeType,
              analysis: message.image?.analysis,
            ),
          );
        }).toList();
        _isUploadingImage = false;
        _isSending = true;
      });
      _startTypingDots();

      final result = await ConversationApi.sendMessage(
        widget.conversation.id,
        type: 'image',
        objectKey: uploaded.objectKey,
        mimeType: mimeType,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _messages = _messages.map((message) {
          if (message.id != tempId) {
            return message;
          }
          return result.userMessage;
        }).toList();
      });

      final assistantMessage = result.assistantMessage;
      if (assistantMessage != null) {
        final assistantParts = assistantMessage.segments.isNotEmpty
            ? assistantMessage.segments
            : <String>[assistantMessage.content];
        await _appendAssistantSegments(assistantMessage, assistantParts);
      } else {
        setState(() {
          _isSending = false;
        });
        _stopTypingDots();
      }
      _scheduleScrollToBottom();
    } on ApiException catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _messages = _messages.map((message) {
          if (message.id != tempId) {
            return message;
          }
          return message.copyWith(status: 'failed');
        }).toList();
        _isUploadingImage = false;
        _isSending = false;
      });
      _stopTypingDots();
      await _handleApiError(
        error,
        fallbackMessage: '发送图片失败，请稍后重试',
        asSnackBar: true,
      );
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _messages = _messages.map((message) {
          if (message.id != tempId) {
            return message;
          }
          return message.copyWith(status: 'failed');
        }).toList();
        _isUploadingImage = false;
        _isSending = false;
      });
      _stopTypingDots();
      _showSnackBar('发送图片失败，请稍后重试');
    }
  }

  String _guessImageMimeType(String fileName, String filePath) {
    final lower = (fileName.trim().isNotEmpty ? fileName : filePath)
        .toLowerCase();
    if (lower.endsWith('.png')) {
      return 'image/png';
    }
    if (lower.endsWith('.webp')) {
      return 'image/webp';
    }
    if (lower.endsWith('.heic')) {
      return 'image/heic';
    }
    return 'image/jpeg';
  }

  void _previewImageMessage(ConversationMessage message) {
    final source = MediaAsset.resolveUrl(
      objectKey: message.image?.objectKey,
      url: message.image?.url,
    );
    if (source.isEmpty) {
      _showSnackBar('图片不可用');
      return;
    }

    showDialog<void>(
      context: context,
      builder: (context) {
        final isLocal = File(source).existsSync();
        final image = isLocal
            ? Image.file(File(source), fit: BoxFit.contain)
            : Image.network(source, fit: BoxFit.contain);

        return Dialog.fullscreen(
          backgroundColor: Colors.black,
          child: GestureDetector(
            onTap: () => Navigator.of(context).maybePop(),
            child: Stack(
              children: [
                Positioned.fill(
                  child: InteractiveViewer(
                    minScale: 0.8,
                    maxScale: 4,
                    child: Center(child: image),
                  ),
                ),
                Positioned(
                  top: 48,
                  left: 16,
                  child: SafeArea(
                    child: IconButton(
                      onPressed: () => Navigator.of(context).maybePop(),
                      icon: const Icon(
                        CupertinoIcons.back,
                        color: Colors.white,
                        size: 24,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final keyboardInset = mediaQuery.viewInsets.bottom;
    final bottomSafeArea = mediaQuery.padding.bottom;
    final currentUserAvatar = AuthSessionStore.session.value?.user.avatar ?? '';
    final agentName = _agentDetail?.name.trim().isNotEmpty == true
        ? _agentDetail!.name.trim()
        : widget.conversation.agentName;
    final agentAvatar = _agentDetail?.avatar.trim().isNotEmpty == true
        ? _agentDetail!.avatar.trim()
        : widget.conversation.agentAvatar;
    final agentSex = _agentDetail?.sex ?? widget.conversation.agentSex;

    _handleKeyboardInsetChanged(keyboardInset);

    return GestureDetector(
      onTap: () => FocusScope.of(context).unfocus(),
      child: Scaffold(
        backgroundColor: Colors.white,
        body: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 393),
            child: SizedBox(
              key: _pageContentKey,
              width: double.infinity,
              height: double.infinity,
              child: Stack(
                children: [
                  ColoredBox(
                    color: const Color(0xFFF7F7F7),
                    child: SafeArea(
                      bottom: false,
                      child: Column(
                        children: [
                          _ConversationNavBar(
                            title: _isSending
                                ? '对方正在输入$_typingDots'
                                : _isTranscribingVoice
                                ? '正在转文字...'
                                : agentName,
                            onMoreTap: _openAgentDetail,
                          ),
                          Expanded(
                            child: _ConversationBody(
                              isLoading: _isLoading,
                              errorMessage: _errorMessage,
                              messages: _messages,
                              isSending: _isSending,
                              activeVoiceMessageId: _activeVoiceMessageId,
                              isVoicePlaying: _isVoicePlaying,
                              isVoicePlaybackLoading: _isVoicePlaybackLoading,
                              currentUserAvatar: currentUserAvatar,
                              agentAvatar: agentAvatar,
                              agentName: agentName,
                              agentSex: agentSex,
                              onAgentTap: _openAgentDetail,
                              onVoiceTap: _toggleVoicePlayback,
                              onImageTap: _previewImageMessage,
                              scrollController: _scrollController,
                              onRetry: _loadMessages,
                            ),
                          ),
                          AnimatedPadding(
                            duration: const Duration(milliseconds: 220),
                            curve: Curves.easeOut,
                            padding: EdgeInsets.only(bottom: bottomSafeArea),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                ChatComposerBar(
                                  controller: _inputController,
                                  focusNode: _inputFocusNode,
                                  canSend: _canSend,
                                  isSending:
                                      _isSending ||
                                      _isUploadingVoice ||
                                      _isUploadingImage,
                                  isEmojiPickerVisible: _isEmojiPickerVisible,
                                  isMorePanelVisible: _isMorePanelVisible,
                                  isVoiceMode: _isVoiceMode,
                                  isVoicePressing: _isVoiceGestureActive,
                                  onSend: _sendMessage,
                                  onEmojiTap: _toggleEmojiPicker,
                                  onMoreTap: _toggleMorePanel,
                                  onVoiceModeTap: _toggleVoiceMode,
                                  onVoiceLongPressDown:
                                      _handleVoiceLongPressDown,
                                  onVoiceLongPressStart:
                                      _handleVoiceLongPressStart,
                                  onVoiceLongPressMoveUpdate:
                                      _handleVoiceLongPressMoveUpdate,
                                  onVoiceLongPressEnd: _handleVoiceLongPressEnd,
                                  onVoiceLongPressCancel:
                                      _handleVoiceLongPressCancel,
                                ),
                                EmojiPickerPanel(
                                  isVisible: _isEmojiPickerVisible,
                                  emojis: _commonEmojis,
                                  onEmojiTap: (emoji) {
                                    _insertEmoji(emoji);
                                    _scheduleScrollToBottom();
                                  },
                                  onBackspaceTap: _deleteEmojiOrCharacter,
                                ),
                                ChatMorePanel(
                                  isVisible: _isMorePanelVisible,
                                  onActionTap: _handleMoreActionTap,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (_isVoiceOverlayVisible)
                    Positioned.fill(
                      child: IgnorePointer(
                        child: VoiceRecordingOverlay(
                          dragTarget: _voiceDragTarget,
                          bottomSafeArea: bottomSafeArea,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ConversationNavBar extends StatelessWidget {
  const _ConversationNavBar({required this.title, required this.onMoreTap});

  final String title;
  final VoidCallback onMoreTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 53,
      decoration: const BoxDecoration(
        color: Color(0xFFF7F7F7),
        border: Border(
          bottom: BorderSide(color: Color(0xFFD9D9D9), width: 0.5),
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: [
          SizedBox(
            width: 48,
            child: Align(
              alignment: Alignment.centerLeft,
              child: InkWell(
                onTap: () => Navigator.of(context).maybePop(),
                borderRadius: BorderRadius.circular(20),
                child: const Padding(
                  padding: EdgeInsets.all(4),
                  child: Icon(
                    CupertinoIcons.back,
                    size: 21,
                    color: Color(0xFF111111),
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: Text(
              title.trim().isEmpty ? '对话' : title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF111111),
                fontSize: 18,
                height: 28 / 18,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          SizedBox(
            width: 48,
            child: Align(
              alignment: Alignment.centerRight,
              child: InkWell(
                onTap: onMoreTap,
                borderRadius: BorderRadius.circular(20),
                child: const Padding(
                  padding: EdgeInsets.all(4),
                  child: Icon(
                    CupertinoIcons.ellipsis,
                    size: 22,
                    color: Color(0xFF111111),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ConversationBody extends StatelessWidget {
  const _ConversationBody({
    required this.isLoading,
    required this.errorMessage,
    required this.messages,
    required this.isSending,
    required this.activeVoiceMessageId,
    required this.isVoicePlaying,
    required this.isVoicePlaybackLoading,
    required this.currentUserAvatar,
    required this.agentAvatar,
    required this.agentName,
    required this.agentSex,
    required this.onAgentTap,
    required this.onVoiceTap,
    required this.onImageTap,
    required this.scrollController,
    required this.onRetry,
  });

  final bool isLoading;
  final String? errorMessage;
  final List<ConversationMessage> messages;
  final bool isSending;
  final String? activeVoiceMessageId;
  final bool isVoicePlaying;
  final bool isVoicePlaybackLoading;
  final String currentUserAvatar;
  final String agentAvatar;
  final String agentName;
  final int agentSex;
  final VoidCallback onAgentTap;
  final ValueChanged<ConversationMessage> onVoiceTap;
  final ValueChanged<ConversationMessage> onImageTap;
  final ScrollController scrollController;
  final Future<void> Function({bool showLoading}) onRetry;

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFFFF9B26)),
      );
    }

    if (errorMessage != null && messages.isEmpty) {
      return _ChatFeedbackState(
        title: errorMessage!,
        actionLabel: '重新加载',
        onActionTap: () => onRetry(),
      );
    }

    if (messages.isEmpty) {
      return const _ChatFeedbackState(
        title: '还没有消息',
        subtitle: '和 TA 打个招呼，开始第一句对话吧',
      );
    }

    return ListView.builder(
      controller: scrollController,
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(12, 16, 12, 18),
      physics: const BouncingScrollPhysics(),
      itemCount: messages.length,
      itemBuilder: (context, index) {
        return _MessageRow(
          message: messages[index],
          activeVoiceMessageId: activeVoiceMessageId,
          isVoicePlaying: isVoicePlaying,
          isVoicePlaybackLoading: isVoicePlaybackLoading,
          currentUserAvatar: currentUserAvatar,
          agentAvatar: agentAvatar,
          agentName: agentName,
          agentSex: agentSex,
          onAgentTap: onAgentTap,
          onVoiceTap: onVoiceTap,
          onImageTap: onImageTap,
        );
      },
    );
  }
}

class _ChatFeedbackState extends StatelessWidget {
  const _ChatFeedbackState({
    required this.title,
    this.subtitle,
    this.actionLabel,
    this.onActionTap,
  });

  final String title;
  final String? subtitle;
  final String? actionLabel;
  final VoidCallback? onActionTap;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              CupertinoIcons.chat_bubble_2,
              size: 40,
              color: Color(0xFFB5BDC8),
            ),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF344054),
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 8),
              Text(
                subtitle!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFF98A2B3),
                  fontSize: 14,
                  height: 20 / 14,
                ),
              ),
            ],
            if (actionLabel != null && onActionTap != null) ...[
              const SizedBox(height: 14),
              TextButton(
                onPressed: onActionTap,
                child: Text(
                  actionLabel!,
                  style: const TextStyle(
                    color: Color(0xFFFF9B26),
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MessageRow extends StatelessWidget {
  const _MessageRow({
    required this.message,
    required this.activeVoiceMessageId,
    required this.isVoicePlaying,
    required this.isVoicePlaybackLoading,
    required this.currentUserAvatar,
    required this.agentAvatar,
    required this.agentName,
    required this.agentSex,
    required this.onAgentTap,
    required this.onVoiceTap,
    required this.onImageTap,
  });

  final ConversationMessage message;
  final String? activeVoiceMessageId;
  final bool isVoicePlaying;
  final bool isVoicePlaybackLoading;
  final String currentUserAvatar;
  final String agentAvatar;
  final String agentName;
  final int agentSex;
  final VoidCallback onAgentTap;
  final ValueChanged<ConversationMessage> onVoiceTap;
  final ValueChanged<ConversationMessage> onImageTap;

  @override
  Widget build(BuildContext context) {
    final isUser = message.isUser;
    final segments = message.segments.isNotEmpty
        ? message.segments
        : <String>[message.content];

    if (!message.isVoice &&
        !message.isImage &&
        !isUser &&
        segments.length > 1) {
      return Column(
        children: [
          for (var index = 0; index < segments.length; index++)
            Padding(
              padding: EdgeInsets.only(
                bottom: index == segments.length - 1 ? 20 : 8,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _AgentBubbleAvatar(
                    name: agentName,
                    sex: agentSex,
                    imageUrl: agentAvatar,
                    onTap: onAgentTap,
                  ),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 276),
                        child: _MessageBubble(
                          text: segments[index],
                          isUser: false,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      );
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: isUser
            ? MainAxisAlignment.end
            : MainAxisAlignment.start,
        children: [
          if (!isUser) ...[
            _AgentBubbleAvatar(
              name: agentName,
              sex: agentSex,
              imageUrl: agentAvatar,
              onTap: onAgentTap,
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Column(
              crossAxisAlignment: isUser
                  ? CrossAxisAlignment.end
                  : CrossAxisAlignment.start,
              children: [
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 276),
                  child: message.isVoice
                      ? _VoiceMessageBubble(
                          message: message,
                          isUser: isUser,
                          isActive: activeVoiceMessageId == message.id,
                          isPlaying:
                              activeVoiceMessageId == message.id &&
                              isVoicePlaying,
                          isLoading:
                              activeVoiceMessageId == message.id &&
                              isVoicePlaybackLoading,
                          onTap: () => onVoiceTap(message),
                        )
                      : message.isImage
                      ? _ImageMessageBubble(
                          message: message,
                          onTap: () => onImageTap(message),
                        )
                      : _MessageBubble(text: segments.first, isUser: isUser),
                ),
                if (message.isFailed) ...[
                  const SizedBox(height: 4),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        '发送失败',
                        style: TextStyle(
                          color: Color(0xFFE5484D),
                          fontSize: 11,
                          height: 16 / 11,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          if (isUser) ...[
            const SizedBox(width: 8),
            _BubbleAvatar(label: '我', imageUrl: currentUserAvatar),
          ],
        ],
      ),
    );
  }
}

class _ImageMessageBubble extends StatelessWidget {
  const _ImageMessageBubble({required this.message, required this.onTap});

  final ConversationMessage message;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final source = MediaAsset.resolveUrl(
      objectKey: message.image?.objectKey,
      url: message.image?.url,
    );
    final isLocal = source.isNotEmpty && File(source).existsSync();

    return GestureDetector(
      onTap: source.isEmpty ? null : onTap,
      behavior: HitTestBehavior.opaque,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Container(
          constraints: const BoxConstraints(maxWidth: 180, maxHeight: 240),
          color: const Color(0xFFF1F2F4),
          child: source.isEmpty
              ? const SizedBox(
                  width: 140,
                  height: 140,
                  child: Center(
                    child: Icon(
                      CupertinoIcons.photo,
                      color: Color(0xFF98A2B3),
                      size: 28,
                    ),
                  ),
                )
              : Stack(
                  children: [
                    isLocal
                        ? Image.file(
                            File(source),
                            width: 180,
                            height: 240,
                            fit: BoxFit.cover,
                          )
                        : Image.network(
                            source,
                            width: 180,
                            height: 240,
                            fit: BoxFit.cover,
                            loadingBuilder: (context, child, progress) {
                              if (progress == null) {
                                return child;
                              }
                              return const SizedBox(
                                width: 180,
                                height: 180,
                                child: Center(
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Color(0xFFFF9B26),
                                  ),
                                ),
                              );
                            },
                            errorBuilder: (context, error, stackTrace) {
                              return const SizedBox(
                                width: 140,
                                height: 140,
                                child: Center(
                                  child: Icon(
                                    CupertinoIcons.exclamationmark_triangle,
                                    color: Color(0xFFE5484D),
                                    size: 26,
                                  ),
                                ),
                              );
                            },
                          ),
                    if (message.isSending)
                      Positioned.fill(
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.22),
                          ),
                          child: const Center(
                            child: CircularProgressIndicator(
                              strokeWidth: 2.2,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
        ),
      ),
    );
  }
}

class _VoiceMessageBubble extends StatelessWidget {
  const _VoiceMessageBubble({
    required this.message,
    required this.isUser,
    required this.isActive,
    required this.isPlaying,
    required this.isLoading,
    required this.onTap,
  });

  final ConversationMessage message;
  final bool isUser;
  final bool isActive;
  final bool isPlaying;
  final bool isLoading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final rawSeconds = message.voice?.durationSeconds ?? 1;
    final seconds = rawSeconds.clamp(1, 60);
    final normalizedSeconds = seconds.clamp(2, 60);
    final progress = (normalizedSeconds - 2) / 58;
    final bubbleWidth = (84 + progress * 132).clamp(84, 216).toDouble();
    final bubbleColor = isUser ? const Color(0xFF95EC69) : Colors.white;
    final iconColor = const Color(0xFF111111);
    final textColor = message.isSending
        ? const Color(0xFF111111).withValues(alpha: 0.52)
        : const Color(0xFF111111);
    final bubbleShadow = isUser
        ? const Color(0x1407C160)
        : const Color(0x0A000000);

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: ConstrainedBox(
        constraints: BoxConstraints.tightFor(width: bubbleWidth, height: 40),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: bubbleColor,
            borderRadius: BorderRadius.circular(6),
            boxShadow: [
              BoxShadow(
                color: bubbleShadow,
                blurRadius: 4,
                offset: const Offset(0, 1),
              ),
            ],
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              mainAxisAlignment: isUser
                  ? MainAxisAlignment.end
                  : MainAxisAlignment.start,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                if (!isUser) ...[
                  _VoicePlaybackIndicator(
                    isSending: message.isSending,
                    isLoading: isLoading,
                    isPlaying: isPlaying,
                    iconColor: iconColor,
                    isUser: isUser,
                  ),
                  const SizedBox(width: 6),
                ],
                Text(
                  '$seconds"',
                  maxLines: 1,
                  overflow: TextOverflow.visible,
                  style: TextStyle(
                    color: textColor,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    height: 1,
                  ),
                ),
                if (isUser) ...[
                  const Spacer(),
                  const SizedBox(width: 6),
                  _VoicePlaybackIndicator(
                    isSending: message.isSending,
                    isLoading: isLoading,
                    isPlaying: isPlaying,
                    iconColor: iconColor,
                    isUser: isUser,
                  ),
                ] else ...[
                  const Spacer(),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

enum _ImageSendAction { edit, send }

class _ImageSendSheetAction extends StatelessWidget {
  const _ImageSendSheetAction({
    required this.label,
    required this.onTap,
    this.isDestructive = false,
  });

  final String label;
  final VoidCallback onTap;
  final bool isDestructive;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: SizedBox(
        height: 56,
        width: double.infinity,
        child: Center(
          child: Text(
            label,
            style: TextStyle(
              color: isDestructive
                  ? const Color(0xFF576B95)
                  : const Color(0xFF111111),
              fontSize: 17,
              fontWeight: isDestructive ? FontWeight.w500 : FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}

class _VoicePlaybackIndicator extends StatelessWidget {
  const _VoicePlaybackIndicator({
    required this.isSending,
    required this.isLoading,
    required this.isPlaying,
    required this.iconColor,
    required this.isUser,
  });

  final bool isSending;
  final bool isLoading;
  final bool isPlaying;
  final Color iconColor;
  final bool isUser;

  @override
  Widget build(BuildContext context) {
    if (isSending || isLoading) {
      return SizedBox(
        width: 14,
        height: 14,
        child: CircularProgressIndicator(strokeWidth: 2, color: iconColor),
      );
    }

    return Icon(
      isPlaying
          ? (isUser
                ? CupertinoIcons.waveform_path_badge_minus
                : CupertinoIcons.waveform_path)
          : (isUser ? CupertinoIcons.speaker_2_fill : CupertinoIcons.speaker_2),
      size: 16,
      color: iconColor,
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.text, required this.isUser});

  final String text;
  final bool isUser;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: isUser ? const Color(0xFF95EC69) : Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F101828),
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Text(
          text,
          style: const TextStyle(
            color: Color(0xFF111111),
            fontSize: 16,
            height: 22 / 16,
          ),
        ),
      ),
    );
  }
}

class _BubbleAvatar extends StatelessWidget {
  const _BubbleAvatar({required this.label, this.imageUrl = '', this.onTap});

  final String label;
  final String imageUrl;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final child = imageUrl.trim().isNotEmpty
        ? AppAvatar(
            imageUrl: imageUrl,
            size: 36,
            borderRadius: BorderRadius.circular(10),
            iconSize: 16,
          )
        : Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFFFFD28D), Color(0xFFFF9B26)],
              ),
            ),
            alignment: Alignment.center,
            child: Text(
              label,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          );

    if (onTap == null) {
      return child;
    }

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: child,
    );
  }
}

class _AgentBubbleAvatar extends StatelessWidget {
  const _AgentBubbleAvatar({
    required this.name,
    required this.sex,
    this.imageUrl = '',
    this.onTap,
  });

  final String name;
  final int sex;
  final String imageUrl;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final trimmedUrl = imageUrl.trim();
    final child = trimmedUrl.isNotEmpty
        ? ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: SizedBox(
              width: 36,
              height: 36,
              child: Image.network(
                trimmedUrl,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) {
                  return _AgentInitialAvatar(name: name, sex: sex);
                },
              ),
            ),
          )
        : _AgentInitialAvatar(name: name, sex: sex);

    if (onTap == null) {
      return child;
    }

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: child,
    );
  }
}

class _AgentInitialAvatar extends StatelessWidget {
  const _AgentInitialAvatar({required this.name, required this.sex});

  final String name;
  final int sex;

  @override
  Widget build(BuildContext context) {
    final trimmedName = name.trim();
    final title = trimmedName.isEmpty ? 'A' : trimmedName.substring(0, 1);
    final isMale = sex == 1;

    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: isMale
              ? const [Color(0xFFB6DBFF), Color(0xFF5D8FFF)]
              : const [Color(0xFFFFD9E5), Color(0xFFFF8DAA)],
        ),
      ),
      alignment: Alignment.center,
      child: Text(
        title,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 16,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
