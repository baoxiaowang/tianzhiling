<template>
  <div class="admin-register">
    <div class="admin-register__panel">
      <div class="admin-register__brand">
        <img
          alt="logo"
          src="//p3-armor.byteimg.com/tos-cn-i-49unhts6dw/dfdba5317c0c20ce20e64fac803d52bc.svg~tplv-49unhts6dw-image.image"
        />
        <span>天之灵 Admin</span>
      </div>
      <div class="admin-register__header">
        <div class="admin-register__title">初始化超级管理员</div>
        <div class="admin-register__subtitle">
          当前还没有检测到后台超级管理员，请创建第一个管理员账号。
        </div>
      </div>

      <a-alert
        v-if="userStore.bootstrapChecked && userStore.hasSuperAdmin === false"
        type="warning"
        show-icon
        content="该入口仅用于首次初始化，创建成功后将回到登录页。"
      />

      <a-form
        class="admin-register__form"
        :model="form"
        layout="vertical"
        @submit="handleSubmit"
      >
        <a-form-item
          field="name"
          label="管理员名称"
          :rules="[{ required: true, message: '请输入管理员名称' }]"
        >
          <a-input v-model="form.name" placeholder="例如：超级管理员">
            <template #prefix>
              <icon-user />
            </template>
          </a-input>
        </a-form-item>
        <a-form-item
          field="account"
          label="登录账号"
          :rules="[{ required: true, message: '请输入登录账号' }]"
        >
          <a-input v-model="form.account" placeholder="请输入登录账号">
            <template #prefix>
              <icon-safe />
            </template>
          </a-input>
        </a-form-item>
        <a-form-item
          field="password"
          label="登录密码"
          :rules="[{ required: true, message: '请输入登录密码' }]"
        >
          <a-input-password
            v-model="form.password"
            placeholder="请输入登录密码"
            allow-clear
          >
            <template #prefix>
              <icon-lock />
            </template>
          </a-input-password>
        </a-form-item>
        <a-form-item
          field="confirmPassword"
          label="确认密码"
          :rules="[{ required: true, message: '请再次输入登录密码' }]"
        >
          <a-input-password
            v-model="form.confirmPassword"
            placeholder="请再次输入登录密码"
            allow-clear
          >
            <template #prefix>
              <icon-lock />
            </template>
          </a-input-password>
        </a-form-item>

        <a-button type="primary" html-type="submit" long :loading="loading">
          创建超级管理员
        </a-button>
        <a-button
          type="text"
          long
          class="admin-register__login-btn"
          @click="goLogin"
        >
          返回登录
        </a-button>
      </a-form>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { reactive } from 'vue';
  import { useRouter } from 'vue-router';
  import { Message } from '@arco-design/web-vue';
  import { useUserStore } from '@/store';
  import { registerAdminBootstrap } from '@/api/user';
  import useLoading from '@/hooks/loading';

  const router = useRouter();
  const userStore = useUserStore();
  const { loading, setLoading } = useLoading();

  const form = reactive({
    name: '',
    account: '',
    password: '',
    confirmPassword: '',
  });

  const handleSubmit = async ({
    errors,
  }: {
    errors: Record<string, unknown> | undefined;
  }) => {
    if (loading.value || errors) {
      return;
    }

    if (
      form.password &&
      form.confirmPassword &&
      form.password !== form.confirmPassword
    ) {
      Message.error('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    try {
      await registerAdminBootstrap({
        name: form.name,
        account: form.account,
        password: form.password,
      });
      Message.success('超级管理员创建成功，请登录');
      await userStore.checkAdminBootstrapStatus();
      router.push({ name: 'login' });
    } finally {
      setLoading(false);
    }
  };

  const goLogin = () => {
    router.push({ name: 'login' });
  };
</script>

<style scoped lang="less">
  .admin-register {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: linear-gradient(
        135deg,
        rgb(22 93 255 / 12%),
        rgb(20 201 201 / 8%)
      ),
      var(--color-bg-1);

    &__panel {
      width: 420px;
      max-width: calc(100vw - 48px);
      padding: 40px;
      background: var(--color-bg-2);
      border: 1px solid var(--color-border-2);
      border-radius: 8px;
      box-shadow: 0 12px 36px rgb(29 33 41 / 8%);
    }

    &__brand {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      color: var(--color-text-1);
      font-weight: 500;
      font-size: 18px;

      img {
        width: 28px;
        height: 28px;
      }
    }

    &__header {
      margin: 32px 0 24px;
    }

    &__title {
      color: var(--color-text-1);
      font-weight: 600;
      font-size: 26px;
      line-height: 34px;
    }

    &__subtitle {
      margin-top: 8px;
      color: var(--color-text-3);
      font-size: 14px;
      line-height: 22px;
    }

    &__form {
      margin-top: 20px;
    }

    &__login-btn {
      margin-top: 8px;
      color: var(--color-text-3) !important;
    }
  }
</style>
