import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:tianzhiling_app/home/contacts_page.dart';
import 'package:tianzhiling_app/home/moments_page.dart';
import 'package:tianzhiling_app/home/my_page.dart';
import 'package:tianzhiling_app/home/post_comment_notification_center.dart';
import 'package:tianzhiling_app/models/post_models.dart';

class MainTabPage extends StatefulWidget {
  const MainTabPage({super.key});

  static const String routeName = '/main-tabs';

  @override
  State<MainTabPage> createState() => _MainTabPageState();
}

class _MainTabPageState extends State<MainTabPage> {
  int _currentIndex = 0;
  final Set<int> _loadedIndexes = <int>{0};

  @override
  void initState() {
    super.initState();
    PostCommentNotificationCenter.instance.startPolling();
  }

  @override
  void dispose() {
    PostCommentNotificationCenter.instance.stopPolling();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<PostCommentNotificationSummary?>(
      valueListenable: PostCommentNotificationCenter.instance.summaryNotifier,
      builder: (context, summary, _) {
        return Scaffold(
          body: IndexedStack(
            index: _currentIndex,
            children: List<Widget>.generate(3, (index) {
              if (!_loadedIndexes.contains(index)) {
                return const SizedBox.shrink();
              }
              return switch (index) {
                0 => const MomentsPage(),
                1 => const ContactsPage(),
                _ => const MyPage(),
              };
            }),
          ),
          bottomNavigationBar: _BottomTabBar(
            currentIndex: _currentIndex,
            momentsUnreadCount: summary?.unreadCount ?? 0,
            onTap: (index) {
              setState(() {
                _currentIndex = index;
                _loadedIndexes.add(index);
              });
            },
          ),
        );
      },
    );
  }
}

class _BottomTabBar extends StatelessWidget {
  const _BottomTabBar({
    required this.currentIndex,
    required this.momentsUnreadCount,
    required this.onTap,
  });

  final int currentIndex;
  final int momentsUnreadCount;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Color(0xFFE5E7EB), width: 1)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 72,
          child: Row(
            children: [
              Expanded(
                child: _BottomTabItem(
                  label: '朋友圈',
                  icon: const _MomentsTabIcon(),
                  activeIcon: const _MomentsTabIcon(isSelected: true),
                  isSelected: currentIndex == 0,
                  badgeCount: momentsUnreadCount,
                  onTap: () => onTap(0),
                ),
              ),
              Expanded(
                child: _BottomTabItem(
                  label: '通讯录',
                  icon: const _ContactsTabIcon(),
                  activeIcon: const _ContactsTabIcon(isSelected: true),
                  isSelected: currentIndex == 1,
                  onTap: () => onTap(1),
                ),
              ),
              Expanded(
                child: _BottomTabItem(
                  label: '我',
                  icon: const Icon(Icons.person_outline_rounded),
                  activeIcon: const Icon(Icons.person_rounded),
                  isSelected: currentIndex == 2,
                  onTap: () => onTap(2),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BottomTabItem extends StatelessWidget {
  const _BottomTabItem({
    required this.label,
    required this.icon,
    required this.activeIcon,
    required this.isSelected,
    this.badgeCount = 0,
    required this.onTap,
  });

  final String label;
  final Widget icon;
  final Widget activeIcon;
  final bool isSelected;
  final int badgeCount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = isSelected
        ? const Color(0xFF00A63E)
        : const Color(0xFF4A5565);

    return InkWell(
      onTap: onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              IconTheme(
                data: IconThemeData(size: 24, color: color),
                child: isSelected ? activeIcon : icon,
              ),
              if (badgeCount > 0)
                Positioned(
                  right: -12,
                  top: -6,
                  child: Container(
                    constraints: const BoxConstraints(minWidth: 18),
                    height: 18,
                    padding: const EdgeInsets.symmetric(horizontal: 5),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFF4D4F),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(color: Colors.white, width: 1.5),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      badgeCount > 99 ? '99+' : '$badgeCount',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 10,
                        height: 1,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              height: 16 / 12,
              fontWeight: FontWeight.w500,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

class _MomentsTabIcon extends StatelessWidget {
  const _MomentsTabIcon({this.isSelected = false});

  final bool isSelected;

  @override
  Widget build(BuildContext context) {
    final color = IconTheme.of(context).color ?? const Color(0xFF4A5565);

    return Container(
      width: 31,
      height: 31,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: color, width: 1.6),
      ),
      padding: const EdgeInsets.all(7),
      child: Container(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: isSelected ? color : const Color(0xFFB8C1CC),
        ),
      ),
    );
  }
}

class _ContactsTabIcon extends StatelessWidget {
  const _ContactsTabIcon({this.isSelected = false});

  final bool isSelected;

  @override
  Widget build(BuildContext context) {
    final color = IconTheme.of(context).color ?? const Color(0xFF4A5565);

    return SizedBox(
      width: 28,
      height: 24,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Align(
            alignment: Alignment.bottomLeft,
            child: Icon(
              isSelected
                  ? CupertinoIcons.person_2_fill
                  : CupertinoIcons.person_2,
              size: 24,
              color: color,
            ),
          ),
          Positioned(
            right: -1,
            top: -1,
            child: Container(
              width: 9,
              height: 9,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white,
                border: Border.all(color: color, width: 1.2),
              ),
              child: Center(
                child: Container(width: 1.2, height: 5, color: color),
              ),
            ),
          ),
          Positioned(
            right: 1.1,
            top: 2.9,
            child: Container(width: 5, height: 1.2, color: color),
          ),
        ],
      ),
    );
  }
}

class SimpleTabPage extends StatelessWidget {
  const SimpleTabPage({super.key, required this.title, required this.icon});

  final String title;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF3F3F3),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        centerTitle: true,
        title: Text(
          title,
          style: const TextStyle(
            color: Color(0xFF111111),
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      body: Center(child: Icon(icon, size: 68, color: const Color(0xFFB7B7B7))),
    );
  }
}
