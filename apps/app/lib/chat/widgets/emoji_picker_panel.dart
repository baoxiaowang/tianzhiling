import 'dart:math' as math;

import 'package:flutter/cupertino.dart';

class EmojiPickerPanel extends StatelessWidget {
  const EmojiPickerPanel({
    super.key,
    required this.isVisible,
    required this.emojis,
    required this.onEmojiTap,
    required this.onBackspaceTap,
  });

  final bool isVisible;
  final List<String> emojis;
  final ValueChanged<String> onEmojiTap;
  final VoidCallback onBackspaceTap;

  @override
  Widget build(BuildContext context) {
    const panelPadding = EdgeInsets.fromLTRB(10, 10, 10, 12);
    const int crossAxisCount = 8;
    const double mainAxisSpacing = 8;
    const double crossAxisSpacing = 6;

    return AnimatedCrossFade(
      duration: const Duration(milliseconds: 180),
      crossFadeState: isVisible
          ? CrossFadeState.showFirst
          : CrossFadeState.showSecond,
      firstChild: Container(
        height: 216,
        decoration: const BoxDecoration(
          color: Color(0xFFF7F7F7),
          border: Border(top: BorderSide(color: Color(0xFFE6E6E6), width: 0.5)),
        ),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final innerWidth =
                constraints.maxWidth - panelPadding.left - panelPadding.right;
            final cellSize =
                (innerWidth - (crossAxisCount - 1) * crossAxisSpacing) /
                crossAxisCount;
            final innerHeight =
                constraints.maxHeight - panelPadding.top - panelPadding.bottom;
            final visibleRows = math.max(
              1,
              ((innerHeight + mainAxisSpacing) / (cellSize + mainAxisSpacing))
                  .floor(),
            );
            final deleteTop =
                panelPadding.top +
                (visibleRows - 1) * (cellSize + mainAxisSpacing);
            final deleteRight = panelPadding.right;

            return Stack(
              children: [
                Padding(
                  padding: panelPadding,
                  child: GridView.builder(
                    physics: const BouncingScrollPhysics(),
                    gridDelegate:
                        const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: crossAxisCount,
                          mainAxisSpacing: mainAxisSpacing,
                          crossAxisSpacing: crossAxisSpacing,
                        ),
                    itemCount: emojis.length,
                    itemBuilder: (context, index) {
                      final emoji = emojis[index];
                      return _EmojiCell(
                        onTap: () => onEmojiTap(emoji),
                        child: Text(
                          emoji,
                          style: const TextStyle(fontSize: 28, height: 1),
                        ),
                      );
                    },
                  ),
                ),
                Positioned(
                  top: deleteTop,
                  right: deleteRight,
                  width: cellSize,
                  height: cellSize,
                  child: _EmojiCell(
                    onTap: onBackspaceTap,
                    child: const Icon(
                      CupertinoIcons.delete_left,
                      size: 20,
                      color: Color(0xFF576071),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
      secondChild: const SizedBox.shrink(),
    );
  }
}

class _EmojiCell extends StatelessWidget {
  const _EmojiCell({required this.child, required this.onTap});

  final Widget child;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: const Color(0xFFF7F7F7),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Center(child: child),
      ),
    );
  }
}
