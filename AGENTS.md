# TianZhiLing Project Notes

## General

- This project does not need multilingual/i18n handling. When adding or changing UI copy, use the project’s primary Chinese text directly unless the user explicitly asks for locale support.

## Admin

- After changing files under `apps/admin`, run eslint against the changed admin files before finishing.

## Node

- `apps/node` uses TypeORM `MongoRepository`. For Mongo repositories, `count()` takes a raw Mongo query as its first argument, not a `FindManyOptions` object. Use `model.count({ userId, isRead: false })`, not `model.count({ where: { userId, isRead: false } })`; the latter searches for a literal `where` field and returns wrong counts.

## Mini Program Compatibility

- This is a WeChat mini program project with live users on older released clients. When changing backend services, API responses, DTOs, database fields, enums, auth flows, or payment/order logic, keep existing mini program versions backward compatible.
- Do not remove or rename response fields, enum values, routes, query/body parameters, or error codes that older mini program versions may still depend on. Prefer additive changes, optional fields, default values, and tolerant parsing.
- If a breaking backend change is unavoidable, add an explicit compatibility path or version gate first, and call out the affected mini program versions and migration plan before implementing.

## Weapp

- For `apps/weapp`, prefer `@nutui/nutui-taro` components first when building forms, buttons, tabs, dialogs, lists, feedback, and other common UI.
- Use raw Taro primitives only when NutUI does not provide a suitable component, or when the user explicitly asks for custom rendering.
- In `apps/weapp` styles, prefer `px` units by default unless the task explicitly requires another unit system.
- Keep weapp API and auth logic aligned with the existing `src/api` and `src/auth` structure instead of scattering request code inside page components.
- For mini program pages, do not place primary actions or custom controls in the top-right navigation area because the native capsule can cover them; prefer bottom action areas or content-level controls.
- For `apps/weapp` avatar or profile-image uploads, call the WeChat/Taro image editor (`Taro.editImage`) after image selection and upload the edited temporary file instead of the raw selected file.
