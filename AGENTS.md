# TianZhiLing Project Notes

## Weapp

- For `apps/weapp`, prefer `@nutui/nutui-taro` components first when building forms, buttons, tabs, dialogs, lists, feedback, and other common UI.
- Use raw Taro primitives only when NutUI does not provide a suitable component, or when the user explicitly asks for custom rendering.
- In `apps/weapp` styles, prefer `px` units by default unless the task explicitly requires another unit system.
- Keep weapp API and auth logic aligned with the existing `src/api` and `src/auth` structure instead of scattering request code inside page components.
