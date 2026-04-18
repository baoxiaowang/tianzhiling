import 'package:flutter/cupertino.dart';
import 'package:flutter/gestures.dart' show GestureLongPressDownCallback;
import 'package:flutter/material.dart';

class ChatComposerBar extends StatelessWidget {
  const ChatComposerBar({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.canSend,
    required this.isSending,
    required this.isEmojiPickerVisible,
    required this.isMorePanelVisible,
    required this.isVoiceMode,
    required this.isVoicePressing,
    required this.onSend,
    required this.onEmojiTap,
    required this.onMoreTap,
    required this.onVoiceModeTap,
    required this.onVoiceLongPressDown,
    required this.onVoiceLongPressStart,
    required this.onVoiceLongPressMoveUpdate,
    required this.onVoiceLongPressEnd,
    required this.onVoiceLongPressCancel,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool canSend;
  final bool isSending;
  final bool isEmojiPickerVisible;
  final bool isMorePanelVisible;
  final bool isVoiceMode;
  final bool isVoicePressing;
  final Future<void> Function() onSend;
  final VoidCallback onEmojiTap;
  final VoidCallback onMoreTap;
  final VoidCallback onVoiceModeTap;
  final GestureLongPressDownCallback onVoiceLongPressDown;
  final GestureLongPressStartCallback onVoiceLongPressStart;
  final GestureLongPressMoveUpdateCallback onVoiceLongPressMoveUpdate;
  final GestureLongPressEndCallback onVoiceLongPressEnd;
  final VoidCallback onVoiceLongPressCancel;

  @override
  Widget build(BuildContext context) {
    const double barHeight = 42;
    final showSendButton = canSend && !isVoiceMode;

    return Container(
      padding: const EdgeInsets.fromLTRB(10, 7, 10, 10),
      decoration: const BoxDecoration(
        color: Color(0xFFF7F7F7),
        border: Border(top: BorderSide(color: Color(0xFFD9D9D9), width: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          GestureDetector(
            onTap: onVoiceModeTap,
            behavior: HitTestBehavior.opaque,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: isVoiceMode ? const Color(0xFFEAF9F0) : Colors.white,
                shape: BoxShape.circle,
                border: Border.all(
                  color: isVoiceMode
                      ? const Color(0xFF07C160)
                      : const Color(0xFFD5D5D5),
                  width: 0.8,
                ),
              ),
              alignment: Alignment.center,
              child: Icon(
                isVoiceMode ? CupertinoIcons.keyboard : CupertinoIcons.waveform,
                size: 18,
                color: isVoiceMode
                    ? const Color(0xFF07C160)
                    : const Color(0xFF303133),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: isVoiceMode
                ? _HoldToTalkButton(
                    height: barHeight,
                    isPressing: isVoicePressing,
                    onLongPressDown: onVoiceLongPressDown,
                    onLongPressStart: onVoiceLongPressStart,
                    onLongPressMoveUpdate: onVoiceLongPressMoveUpdate,
                    onLongPressEnd: onVoiceLongPressEnd,
                    onLongPressCancel: onVoiceLongPressCancel,
                  )
                : Container(
                    height: barHeight,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: const Color(0xFFE5E5E5),
                        width: 0.6,
                      ),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x0A000000),
                          blurRadius: 6,
                          offset: Offset(0, 1),
                        ),
                      ],
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Expanded(
                          child: TextField(
                            controller: controller,
                            focusNode: focusNode,
                            maxLines: 1,
                            textInputAction: TextInputAction.send,
                            textAlignVertical: TextAlignVertical.center,
                            onSubmitted: (_) => onSend(),
                            decoration: InputDecoration(
                              hintText: '输入消息',
                              hintStyle: const TextStyle(
                                color: Color(0xFFB7B7B7),
                                fontSize: 15,
                                height: 22 / 15,
                              ),
                              border: InputBorder.none,
                              isDense: true,
                              contentPadding: EdgeInsets.zero,
                              suffixIcon: canSend
                                  ? null
                                  : const _ComposerActionIcon(
                                      icon: CupertinoIcons.mic,
                                      size: 18,
                                    ),
                              suffixIconConstraints: const BoxConstraints(
                                minWidth: 22,
                                minHeight: 30,
                              ),
                            ),
                            style: const TextStyle(
                              color: Color(0xFF111111),
                              fontSize: 15,
                              height: 22 / 15,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
          ),
          const SizedBox(width: 10),
          if (!showSendButton) ...[
            _ComposerActionIcon(
              icon: CupertinoIcons.smiley,
              size: 21,
              isSelected: isEmojiPickerVisible,
              onTap: onEmojiTap,
            ),
            const SizedBox(width: 10),
            _ComposerActionIcon(
              icon: CupertinoIcons.add,
              size: 22,
              isSelected: isMorePanelVisible,
              onTap: onMoreTap,
            ),
          ] else
            GestureDetector(
              onTap: canSend ? onSend : null,
              behavior: HitTestBehavior.opaque,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                height: 30,
                width: 60,
                decoration: BoxDecoration(
                  color: const Color(0xFF07C160),
                  borderRadius: BorderRadius.circular(16),
                ),
                alignment: Alignment.center,
                child: isSending
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text(
                        '发送',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
              ),
            ),
        ],
      ),
    );
  }
}

class _HoldToTalkButton extends StatelessWidget {
  const _HoldToTalkButton({
    required this.height,
    required this.isPressing,
    required this.onLongPressDown,
    required this.onLongPressStart,
    required this.onLongPressMoveUpdate,
    required this.onLongPressEnd,
    required this.onLongPressCancel,
  });

  final double height;
  final bool isPressing;
  final GestureLongPressDownCallback onLongPressDown;
  final GestureLongPressStartCallback onLongPressStart;
  final GestureLongPressMoveUpdateCallback onLongPressMoveUpdate;
  final GestureLongPressEndCallback onLongPressEnd;
  final VoidCallback onLongPressCancel;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onLongPressDown: onLongPressDown,
      onLongPressStart: onLongPressStart,
      onLongPressMoveUpdate: onLongPressMoveUpdate,
      onLongPressEnd: onLongPressEnd,
      onLongPressCancel: onLongPressCancel,
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        height: height,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: isPressing ? const Color(0xFFE2E2E2) : Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isPressing
                ? const Color(0xFFBCBCBC)
                : const Color(0xFFE5E5E5),
            width: 0.8,
          ),
          boxShadow: const [
            BoxShadow(
              color: Color(0x0A000000),
              blurRadius: 6,
              offset: Offset(0, 1),
            ),
          ],
        ),
        child: Text(
          isPressing ? '松开 发送' : '按住 说话',
          style: TextStyle(
            color: const Color(0xFF111111),
            fontSize: 15,
            fontWeight: isPressing ? FontWeight.w600 : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

class _ComposerActionIcon extends StatelessWidget {
  const _ComposerActionIcon({
    required this.icon,
    required this.size,
    this.onTap,
    this.isSelected = false,
  });

  final IconData icon;
  final double size;
  final VoidCallback? onTap;
  final bool isSelected;

  @override
  Widget build(BuildContext context) {
    final child = SizedBox(
      width: 22,
      height: 30,
      child: Center(
        child: Icon(
          icon,
          size: size,
          color: isSelected ? const Color(0xFF07C160) : const Color(0xFF303133),
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
