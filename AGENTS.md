# TianZhiLing Project Notes

## General

- This project does not need multilingual/i18n handling. When adding or changing UI copy, use the project’s primary Chinese text directly unless the user explicitly asks for locale support.

## Admin

- After changing files under `apps/admin`, run eslint against the changed admin files before finishing.

## Weapp

- For `apps/weapp`, prefer `@nutui/nutui-taro` components first when building forms, buttons, tabs, dialogs, lists, feedback, and other common UI.
- Use raw Taro primitives only when NutUI does not provide a suitable component, or when the user explicitly asks for custom rendering.
- In `apps/weapp` styles, prefer `px` units by default unless the task explicitly requires another unit system.
- Keep weapp API and auth logic aligned with the existing `src/api` and `src/auth` structure instead of scattering request code inside page components.
- For mini program pages, do not place primary actions or custom controls in the top-right navigation area because the native capsule can cover them; prefer bottom action areas or content-level controls.
- For `apps/weapp` avatar or profile-image uploads, call the WeChat/Taro image editor (`Taro.editImage`) after image selection and upload the edited temporary file instead of the raw selected file.
