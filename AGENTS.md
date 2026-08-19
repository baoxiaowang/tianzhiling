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

## Mini Program Release Payments

- TianZhiLing and Weiliaoyan use different payment policies during WeChat review. Never copy one brand's review payment configuration to the other brand.
- TianZhiLing review submissions may keep the normal WeChat Pay flow. Do not force TianZhiLing to use WeChat Mini Program Virtual Payment unless the user explicitly requests it.
- Weiliaoyan review submissions must use official WeChat Mini Program Virtual Payment for all visible virtual-goods and membership purchase entries before submitting for review.
- Before a Weiliaoyan review submission, back up the current production payment configuration, verify the selected Royal TSX connection is the Weiliaoyan server, enable the production virtual-payment environment, and ensure every active plan has a published and verified virtual-payment product ID. Temporarily disable plans whose product IDs cannot be verified so they cannot fall back to normal WeChat Pay.
- After Weiliaoyan passes review, restore its pre-review normal WeChat Pay configuration from the recorded backup and verify the public health endpoint and visible plans again.
- When only the backend-managed payment switch changes, do not rebuild, upload, or redeploy the mini program. Resubmit the existing version in the WeChat public platform after verifying the live configuration.

## Weapp

- For `apps/weapp`, prefer `@nutui/nutui-taro` components first when building forms, buttons, tabs, dialogs, lists, feedback, and other common UI.
- Use raw Taro primitives only when NutUI does not provide a suitable component, or when the user explicitly asks for custom rendering.
- In `apps/weapp` styles, prefer `px` units by default unless the task explicitly requires another unit system.
- Keep weapp API and auth logic aligned with the existing `src/api` and `src/auth` structure instead of scattering request code inside page components.
- For mini program pages, do not place primary actions or custom controls in the top-right navigation area because the native capsule can cover them; prefer bottom action areas or content-level controls.
- For `apps/weapp` avatar or profile-image uploads, call the WeChat/Taro image editor (`Taro.editImage`) after image selection and upload the edited temporary file instead of the raw selected file.

## Voice Service

- Before changing the voice-material, clipping, review, training, preview, or voice-package flow, read `docs/voice-service-workflow-handoff.md` and update it when product decisions, states, APIs, providers, persistence fields, or known risks change.
- Preserve the complete voice-service business record. Do not silently discard uploaded materials, clip-review decisions, messages, events, task identifiers, training output, failure details, or the selected agent. Add fields and events compatibly when the workflow grows.

## Backend Release Scope

- Define a release by runtime and product dependency, not by filename or exact feature-name matching. Include completed transitive dependencies, backward-compatible entity fields, tests, and low-risk adjacent fixes when they are needed for the released workflow or reduce operational risk.
- Do not over-fragment a completed feature merely because its changes touch shared chat, memory, storage, queue, or client modules. The main exclusion criterion is unrelated scope or unfinished functionality; identify and exclude those explicitly before assembling the release.
- Treat voice training as an independent release scope. Unless the user explicitly instructs you to publish voice training, exclude its services, controllers, processors, queues, entities, configuration, dependencies, admin changes, gateway changes, tests, and documentation from backend release commits and server deployments.
- A general request to publish backend updates does not authorize publishing voice training. Keep unfinished voice-training work in the local working tree while assembling and verifying a separate non-voice backend release.
- When voice training is explicitly authorized for release, publish it as a separately identified scope and verify FFmpeg/runtime dependencies, queues, persistence, provider configuration, admin workflows, and rollback behavior before deployment.

## Remote Release Access

- Royal TSX Shareware Mode may be used for manual SSH connections, terminal output, and command pasting within its free limits.
- Do not invoke Royal TSX's paid AppleScript or licensed automation interface by default. Use it only after the user explicitly authorizes paid Royal automation for the current task; otherwise use authorized free/shareware UI interaction with an already-open Royal terminal or saved TianZhiLing connection.
- Before any Royal mutation, use short read-only commands to verify the visible session is `root@VM-0-12-centos`, the repository is `/opt/tianzhiling`, the branch and full commit are expected, and the worktree is clean. Never type, read back, log, or transmit a password or secret.
- Keep every command entered through Royal TSX short and independently verifiable, targeting no more than 500 characters. Never paste Base64 payloads, generated scripts, heredocs, or full multi-stage release commands through Royal; install or reuse a root-owned helper and let direct restricted SSH perform the release instead.
- Prefer direct SSH with an authorized public key for deployments and production checks.
- TianZhiLing direct access must use `tzl_deploy@1.13.18.200` with `/Users/m4/.ssh/id_ed25519_tianzhiling_deploy_20260802`; do not attempt direct `root` SSH. The server gateway only accepts `status`, `logs [1-60]`, and `release <YYYYMMDD> <40-hex-commit>`.
- The restricted release gateway rejects infrastructure, dependency, database/entity, authentication, payment/order/member, and voice-training changes. These scopes require the user's explicit approval and manual root access through the verified TianZhiLing Royal TSX connection.
- For a protected release, keep the Royal action to a short command bound to the exact immutable commit, confirm a clear success marker, and then continue verification through restricted SSH. Codex may enter that command through authorized free/shareware UI interaction; if such interaction is unavailable, ask the user to run it. If a required action cannot fit safely in a short command, stop and create a reusable server-side helper before continuing.
- If direct SSH is not authorized, prepare the shortest possible single-line diagnostic or setup command for a verified Royal TSX connection. After explicit user authorization, Codex may select the saved connection and enter the command through free/shareware UI interaction; if safe free-mode interaction is unavailable, ask the user to run it manually.
