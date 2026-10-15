/**
 * 通用「宽表格 → 手机卡片」适配。
 *
 * 管理端列表页有几十张 a-table，逐页改造成本高且容易漏。这里在手机模式下统一：
 *   1. 读取表头文本，写到每个 td 的 data-label 上；
 *   2. 给表格加 m-table-cards 类；
 * 再由 responsive.less 用 data-label 把每一行渲染成一张卡片（左侧字段名、右侧值）。
 * 回到电脑版会移除这些标记，桌面渲染完全不受影响。
 */
import { onBeforeUnmount, watch, type Ref } from 'vue';

const CARD_CLASS = 'm-table-cards';

function decorateTable(table: Element) {
  // 实测 DOM：<table class="arco-table-element"> 里是原生 <thead>/<tbody>，
  // 表头单元格 .arco-table-th、表体行 .arco-table-tr（不同 Arco 版本类名不一，这里都兼容）
  const headerCells = table.querySelectorAll(
    'thead .arco-table-th, .arco-table-thead .arco-table-th, .arco-table-header .arco-table-th'
  );
  const bodyRows = table.querySelectorAll(
    'tbody > .arco-table-tr, .arco-table-body > .arco-table-tr, .arco-table-tbody > .arco-table-tr'
  );
  if (!headerCells.length || !bodyRows.length) return;
  const headers = Array.from(headerCells).map((th) =>
    (th.textContent || '').replace(/\s+/g, ' ').trim()
  );
  table.classList.add(CARD_CLASS);
  bodyRows.forEach((tr) => {
    Array.from(tr.children).forEach((cell, index) => {
      const label = headers[index] || '';
      if (label) {
        (cell as HTMLElement).setAttribute('data-label', label);
      } else {
        (cell as HTMLElement).removeAttribute('data-label');
      }
    });
  });
}

function decorateAll(root: ParentNode = document) {
  root.querySelectorAll('.arco-table').forEach((table) => decorateTable(table));
}

function clearAll(root: ParentNode = document) {
  root.querySelectorAll(`.${CARD_CLASS}`).forEach((table) => {
    table.classList.remove(CARD_CLASS);
    table.querySelectorAll('[data-label]').forEach((cell) => {
      cell.removeAttribute('data-label');
    });
  });
}

export default function useTableCards(isMobile: Ref<boolean>) {
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleDecorate = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      decorateAll();
    }, 120);
  };

  const stop = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearAll();
  };

  const start = () => {
    decorateAll();
    // 列表分页 / 筛选 / 抽屉里的表格都会重建 DOM，需要跟着重新打标
    observer = new MutationObserver(scheduleDecorate);
    observer.observe(document.body, { childList: true, subtree: true });
  };

  watch(
    isMobile,
    (mobile) => {
      if (mobile) start();
      else stop();
    },
    { immediate: true }
  );

  onBeforeUnmount(stop);
}
