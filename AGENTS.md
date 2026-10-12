# TianZhiLing repository facts

- Use Chinese copy unless localization is requested; validate the changed dependency closure and lint changed admin source.
- `MongoRepository` count operations use the raw query.
- Preserve older-client compatibility additively.
- Keep brand model, messenger, payment, review, and domain configuration separate; verify live policy instead of inferring it.
- In weapp, reuse existing API/auth patterns and NutUI, use `px`, avoid the capsule, and use `Taro.editImage` for image editing.
- Weapp payment routing is identical for every brand: non-iOS (Android/HarmonyOS/Windows) uses WeChat mini-program virtual payment only, iOS uses ordinary WeChat Pay only, and neither falls back to the other channel. Build branded packages with `sh scripts/build-brand.sh <brand> weapp`; domain, appid and the payment-channel release check come from `brand/<brand>.json` and `apps/weapp/scripts/verify-weapp-release.mjs`.
- Voice work preserves existing handoff records and updates them only when the contract changes.
- Actual production work uses the production-release skill; voice training and data mutation require separate authority.
- Discover reusable task capabilities with `node scripts/taskctl.mjs capabilities`; methods are optional, declared effects and acceptance evidence are authoritative.
