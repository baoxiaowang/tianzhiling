import type { Router, LocationQueryRaw } from 'vue-router';
import NProgress from 'nprogress'; // progress bar

import { useUserStore } from '@/store';
import { isLogin } from '@/utils/auth';

export default function setupUserLoginInfoGuard(router: Router) {
  router.beforeEach(async (to, from, next) => {
    NProgress.start();
    const userStore = useUserStore();
    if (isLogin()) {
      if (userStore.role) {
        next();
      } else {
        try {
          await userStore.info();
          next();
        } catch (error) {
          await userStore.logout();
          next({
            name: 'login',
            query: {
              redirect: to.name,
              ...to.query,
            } as LocationQueryRaw,
          });
        }
      }
    } else {
      if (to.name === 'login') {
        try {
          await userStore.checkAdminBootstrapStatus();
          if (userStore.bootstrapChecked && userStore.hasSuperAdmin === false) {
            next({
              name: 'adminRegister',
            });
            return;
          }
        } catch {
          // Keep the login route reachable even when the bootstrap check fails.
        }
        next();
        return;
      }
      if (to.name === 'adminRegister') {
        try {
          await userStore.checkAdminBootstrapStatus();
          if (userStore.bootstrapChecked && userStore.hasSuperAdmin === true) {
            next({
              name: 'login',
            });
            return;
          }
        } catch {
          // Keep the register route reachable even when the bootstrap check fails.
        }
        next();
        return;
      }
      next({
        name: 'login',
        query: {
          redirect: to.name,
          ...to.query,
        } as LocationQueryRaw,
      });
    }
  });
}
