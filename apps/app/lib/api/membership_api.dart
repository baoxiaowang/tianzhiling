import 'package:tianzhiling_app/api/api_client.dart';
import 'package:tianzhiling_app/models/membership_models.dart';

class MembershipApi {
  MembershipApi._();

  static MembershipCenter? _cached;
  static DateTime? _cacheExpiresAt;
  static Future<MembershipCenter>? _pending;

  static Future<MembershipCenter> getPurchaseCenter() async {
    if (_cached != null && _cacheExpiresAt != null && _cacheExpiresAt!.isAfter(DateTime.now())) {
      return _cached!;
    }

    if (_pending != null) {
      return _pending!;
    }

    _pending = _fetch();
    try {
      final result = await _pending!;
      _cached = result;
      _cacheExpiresAt = DateTime.now().add(const Duration(seconds: 30));
      return result;
    } finally {
      _pending = null;
    }
  }

  static void invalidateCache() {
    _cached = null;
    _cacheExpiresAt = null;
  }

  static Future<MembershipCenter> _fetch() async {
    final data = await ApiClient.instance.get('/api/membership/purchase-center');
    return MembershipCenter.fromJson(data);
  }
}
