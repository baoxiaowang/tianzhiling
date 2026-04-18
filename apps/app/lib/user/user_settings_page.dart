import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:tianzhiling_app/api/auth_api.dart';
import 'package:tianzhiling_app/api/storage_api.dart';
import 'package:tianzhiling_app/auth/auth_page.dart';
import 'package:tianzhiling_app/user/app_avatar.dart';
import 'package:tianzhiling_app/user/avatar_editor_page.dart';
import 'package:tianzhiling_app/user/user_name_edit_page.dart';

class UserSettingsPage extends StatefulWidget {
  const UserSettingsPage({super.key});

  static const String routeName = '/user-settings';

  @override
  State<UserSettingsPage> createState() => _UserSettingsPageState();
}

class _UserSettingsPageState extends State<UserSettingsPage> {
  final ImagePicker _imagePicker = ImagePicker();
  bool _isLoggingOut = false;
  bool _isUpdatingAvatar = false;

  void _showSnackBar(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _handleLogout() async {
    if (_isLoggingOut) {
      return;
    }

    setState(() {
      _isLoggingOut = true;
    });

    try {
      await AuthApi.logout();
      await AuthSessionStore.clear();

      if (!mounted) {
        return;
      }

      Navigator.of(
        context,
      ).pushNamedAndRemoveUntil(AuthPage.routeName, (_) => false);
    } on ApiException catch (error) {
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

      _showSnackBar(error.message);
    } catch (_) {
      _showSnackBar('退出登录失败，请稍后重试');
    } finally {
      if (mounted) {
        setState(() {
          _isLoggingOut = false;
        });
      }
    }
  }

  Future<void> _handleAvatarTap() async {
    if (_isUpdatingAvatar) {
      return;
    }

    try {
      final selected = await _imagePicker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 92,
        maxWidth: 2048,
        requestFullMetadata: false,
      );

      if (selected == null) {
        return;
      }

      if (!mounted) {
        return;
      }

      final uploadSource = await AvatarEditorPage.edit(context, selected);

      if (uploadSource == null) {
        return;
      }

      setState(() {
        _isUpdatingAvatar = true;
      });

      final upload = await StorageApi.uploadImage(
        XFile(
          uploadSource.path,
          mimeType: 'image/jpeg',
          name: _buildAvatarFileName(selected),
        ),
        folder: 'avatars',
      );

      await AuthApi.updateAvatar(upload.objectKey);

      _showSnackBar('头像已更新');
    } on ApiException catch (error) {
      if (error.requiresReLogin) {
        await AuthSessionStore.clear();

        if (!mounted) {
          return;
        }

        _showSnackBar(error.message);
        await Future<void>.delayed(const Duration(milliseconds: 500));

        if (!mounted) {
          return;
        }

        Navigator.of(
          context,
        ).pushNamedAndRemoveUntil(AuthPage.routeName, (_) => false);
        return;
      }

      _showSnackBar(error.message);
    } catch (_) {
      _showSnackBar('头像上传失败，请稍后重试');
    } finally {
      if (mounted) {
        setState(() {
          _isUpdatingAvatar = false;
        });
      }
    }
  }

  String _buildAvatarFileName(XFile selected) {
    final name = selected.name.trim();

    if (name.isNotEmpty) {
      return name;
    }

    return 'avatar_${DateTime.now().millisecondsSinceEpoch}.jpg';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F7),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        centerTitle: true,
        title: const Text(
          '个人资料',
          style: TextStyle(
            color: Color(0xFF1A1A1A),
            fontSize: 17,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      body: ValueListenableBuilder<AuthSessionData?>(
        valueListenable: AuthSessionStore.session,
        builder: (context, session, _) {
          final user = session?.user;
          final displayName = (user?.name.trim().isNotEmpty ?? false)
              ? user!.name
              : '放学别走';
          final phone = user?.phone ?? '';

          return ListView(
            padding: const EdgeInsets.only(top: 10),
            children: [
              _ProfileInfoTile(
                title: '头像',
                trailing: _AvatarPreview(
                  imageUrl: user?.avatar ?? '',
                  isLoading: _isUpdatingAvatar,
                ),
                height: 58,
                onTap: _handleAvatarTap,
              ),
              _ProfileInfoTile(
                title: '名字',
                value: displayName,
                onTap: () {
                  Navigator.of(context).pushNamed(UserNameEditPage.routeName);
                },
              ),
              const _ProfileInfoTile(title: '性别', value: '男'),
              const _ProfileInfoTile(title: '地区', value: '中国大陆'),
              _ProfileInfoTile(title: '手机号', value: _maskPhone(phone)),
              const SizedBox(height: 24),
              _LogoutTile(isLoading: _isLoggingOut, onTap: _handleLogout),
            ],
          );
        },
      ),
    );
  }

  static String _maskPhone(String phone) {
    if (phone.length < 7) {
      return phone.isEmpty ? '' : phone;
    }

    return '${phone.substring(0, 3)}******${phone.substring(phone.length - 2)}';
  }
}

class _LogoutTile extends StatelessWidget {
  const _LogoutTile({required this.isLoading, required this.onTap});

  final bool isLoading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: isLoading ? null : onTap,
      child: Container(
        height: 56,
        color: Colors.white,
        alignment: Alignment.center,
        child: Text(
          isLoading ? '退出中...' : '退出登录',
          style: TextStyle(
            color: isLoading
                ? const Color(0xFFD84C4C)
                : const Color(0xFFE54848),
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _ProfileInfoTile extends StatelessWidget {
  const _ProfileInfoTile({
    required this.title,
    this.value,
    this.trailing,
    this.height = 56,
    this.onTap,
  });

  final String title;
  final String? value;
  final Widget? trailing;
  final double height;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        height: height,
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(
            bottom: BorderSide(color: Color(0xFFF0F0F0), width: 0.5),
          ),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(
          children: [
            Text(
              title,
              style: const TextStyle(
                color: Color(0xFF333333),
                fontSize: 16,
                height: 24 / 16,
                fontWeight: FontWeight.w500,
              ),
            ),
            const Spacer(),
            trailing ??
                Text(
                  value ?? '',
                  style: const TextStyle(
                    color: Color(0xFF999999),
                    fontSize: 16,
                    height: 24 / 16,
                    fontWeight: FontWeight.w400,
                  ),
                ),
            const SizedBox(width: 6),
            const Icon(
              Icons.chevron_right_rounded,
              size: 18,
              color: Color(0xFFCFCFCF),
            ),
          ],
        ),
      ),
    );
  }
}

class _AvatarPreview extends StatelessWidget {
  const _AvatarPreview({required this.imageUrl, required this.isLoading});

  final String imageUrl;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.center,
      children: [
        AppAvatar(
          imageUrl: imageUrl,
          size: 36,
          borderRadius: BorderRadius.circular(6),
          iconSize: 18,
        ),
        if (isLoading)
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: const Color(0x99000000),
              borderRadius: BorderRadius.circular(6),
            ),
            alignment: Alignment.center,
            child: const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
              ),
            ),
          ),
      ],
    );
  }
}
