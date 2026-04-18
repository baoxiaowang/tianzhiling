import 'package:flutter/cupertino.dart';

enum ChatMoreAction {
  photo,
  camera,
  videoCall,
  location,
  redPacket,
  gift,
  transfer,
  voiceInput,
}

class ChatMorePanel extends StatelessWidget {
  const ChatMorePanel({
    super.key,
    required this.isVisible,
    required this.onActionTap,
  });

  final bool isVisible;
  final ValueChanged<ChatMoreAction> onActionTap;

  static const List<_ChatMorePanelActionItem> _items =
      <_ChatMorePanelActionItem>[
        _ChatMorePanelActionItem(
          action: ChatMoreAction.photo,
          label: '照片',
          icon: CupertinoIcons.photo,
        ),
        _ChatMorePanelActionItem(
          action: ChatMoreAction.camera,
          label: '拍摄',
          icon: CupertinoIcons.camera,
        ),
        _ChatMorePanelActionItem(
          action: ChatMoreAction.videoCall,
          label: '视频通话',
          icon: CupertinoIcons.videocam_fill,
        ),
        _ChatMorePanelActionItem(
          action: ChatMoreAction.location,
          label: '位置',
          icon: CupertinoIcons.location_solid,
        ),
        _ChatMorePanelActionItem(
          action: ChatMoreAction.redPacket,
          label: '红包',
          icon: CupertinoIcons.money_dollar_circle_fill,
        ),
        _ChatMorePanelActionItem(
          action: ChatMoreAction.gift,
          label: '礼物',
          icon: CupertinoIcons.gift_fill,
        ),
        _ChatMorePanelActionItem(
          action: ChatMoreAction.transfer,
          label: '转账',
          icon: CupertinoIcons.bolt_fill,
        ),
        _ChatMorePanelActionItem(
          action: ChatMoreAction.voiceInput,
          label: '语音输入',
          icon: CupertinoIcons.mic_fill,
        ),
      ];

  @override
  Widget build(BuildContext context) {
    return AnimatedCrossFade(
      duration: const Duration(milliseconds: 180),
      crossFadeState: isVisible
          ? CrossFadeState.showFirst
          : CrossFadeState.showSecond,
      firstChild: Container(
        height: 228,
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(14, 18, 14, 20),
        decoration: const BoxDecoration(
          color: Color(0xFFF1F1F1),
          border: Border(top: BorderSide(color: Color(0xFFE2E2E2), width: 0.5)),
        ),
        child: GridView.builder(
          physics: const NeverScrollableScrollPhysics(),
          itemCount: _items.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 4,
            mainAxisSpacing: 14,
            crossAxisSpacing: 10,
            mainAxisExtent: 82,
          ),
          itemBuilder: (context, index) {
            final item = _items[index];
            return _ChatMorePanelCell(
              label: item.label,
              icon: item.icon,
              onTap: () => onActionTap(item.action),
            );
          },
        ),
      ),
      secondChild: const SizedBox.shrink(),
    );
  }
}

class _ChatMorePanelActionItem {
  const _ChatMorePanelActionItem({
    required this.action,
    required this.label,
    required this.icon,
  });

  final ChatMoreAction action;
  final String label;
  final IconData icon;
}

class _ChatMorePanelCell extends StatelessWidget {
  const _ChatMorePanelCell({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 58,
            height: 58,
            decoration: BoxDecoration(
              color: const Color(0xFFFCFCFC),
              borderRadius: BorderRadius.circular(16),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x10000000),
                  blurRadius: 10,
                  offset: Offset(0, 2),
                ),
              ],
            ),
            alignment: Alignment.center,
            child: Icon(icon, size: 25, color: const Color(0xFF5B5B5B)),
          ),
          const SizedBox(height: 8),
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF6E6E6E),
              fontSize: 13,
              height: 1.2,
            ),
          ),
        ],
      ),
    );
  }
}
