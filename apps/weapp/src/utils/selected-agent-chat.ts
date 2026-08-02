import Taro from "@tarojs/taro";
import { ApiException } from "../api/api-exception";
import {
  getCachedConversations,
  getConversations,
  getEntryConversation,
  parseConversationSummary,
  type ConversationSummary,
} from "../apis/conversation";
import { authSession, restoreAuthSession } from "../auth/session";
import { openAgentCreatePage } from "./agent-create-navigation";

export interface OpenSelectedAgentChatOptions {
  forceRefresh?: boolean;
  requestTimeout?: number;
  showLoading?: boolean;
}

const SELECTED_CONVERSATION_STORAGE_KEY = "tzl_selected_conversation_v1";

let openingSelectedChatPromise: Promise<boolean> | null = null;

interface StoredSelectedConversation {
  ownerId: string;
  conversation: Record<string, unknown>;
}

export function resolveConversationName(conversation: ConversationSummary) {
  const name = conversation.agentName.trim();
  return name || "未命名联系人";
}

export function sortConversationsForSelection(items: ConversationSummary[]) {
  return [...items].sort((left, right) => {
    if (left.agentIsDefault !== right.agentIsDefault) {
      return left.agentIsDefault ? -1 : 1;
    }

    return (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0);
  });
}

export function resolveSelectedConversation(items: ConversationSummary[]) {
  const sortedItems = sortConversationsForSelection(items);
  return sortedItems.find((item) => item.agentIsDefault) ?? sortedItems[0];
}

export function buildConversationChatUrl(conversation: ConversationSummary) {
  const query = [
    ["conversationId", conversation.id],
    ["agentId", conversation.agentId],
    ["agentName", resolveConversationName(conversation)],
    ["agentAvatar", conversation.agentAvatar],
    ["agentSex", String(conversation.agentSex)],
    ["agentCallMe", conversation.agentCallMe],
    ["iCallAgent", conversation.iCallAgent],
    ["preview", conversation.preview],
    ["createdAt", conversation.createdAt?.toISOString() ?? ""],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");

  return `/pages/chat/index?${query}`;
}

export function rememberSelectedConversation(
  conversation: ConversationSummary
) {
  const ownerId = authSession.value?.user.id.trim() ?? "";

  if (!ownerId || !conversation.id || !conversation.agentId) {
    return;
  }

  const stored: StoredSelectedConversation = {
    ownerId,
    conversation: {
      id: conversation.id,
      agentId: conversation.agentId,
      agentName: conversation.agentName,
      agentAvatar: conversation.agentAvatar,
      agentSex: conversation.agentSex,
      agentCallMe: conversation.agentCallMe,
      iCallAgent: conversation.iCallAgent,
      agentIsDefault: conversation.agentIsDefault,
      agentAccessRole: conversation.agentAccessRole,
      preview: "",
      createdAt: conversation.createdAt?.toISOString() ?? "",
      updatedAt: conversation.updatedAt?.toISOString() ?? "",
    },
  };

  try {
    Taro.setStorageSync(
      SELECTED_CONVERSATION_STORAGE_KEY,
      JSON.stringify(stored)
    );
  } catch {
    // Storage failure must not block opening the conversation.
  }
}

export function getRememberedSelectedConversation() {
  const ownerId = authSession.value?.user.id.trim() ?? "";

  if (!ownerId) {
    return undefined;
  }

  try {
    const raw = Taro.getStorageSync<string>(SELECTED_CONVERSATION_STORAGE_KEY);
    const stored = raw
      ? (JSON.parse(raw) as Partial<StoredSelectedConversation>)
      : undefined;

    if (stored?.ownerId !== ownerId || !stored.conversation) {
      return undefined;
    }

    const conversation = parseConversationSummary(stored.conversation);
    return conversation.id && conversation.agentId ? conversation : undefined;
  } catch {
    return undefined;
  }
}

export function openSelectedAgentChat(
  options: OpenSelectedAgentChatOptions = {}
) {
  if (openingSelectedChatPromise) {
    return openingSelectedChatPromise;
  }

  openingSelectedChatPromise = navigateToSelectedAgentChat(options).finally(
    () => {
      openingSelectedChatPromise = null;
    }
  );

  return openingSelectedChatPromise;
}

async function navigateToSelectedAgentChat(
  options: OpenSelectedAgentChatOptions
) {
  await restoreAuthSession();

  if (!authSession.value) {
    await openAgentCreatePage();
    return true;
  }

  let conversations = getCachedConversations();
  const rememberedConversation = getRememberedSelectedConversation();
  const rememberedAvailableConversation = rememberedConversation
    ? conversations.find((item) => item.id === rememberedConversation.id)
    : undefined;
  const immediatelyAvailableConversation =
    rememberedAvailableConversation ??
    resolveSelectedConversation(conversations) ??
    rememberedConversation;

  if (immediatelyAvailableConversation) {
    return navigateToConversation(immediatelyAvailableConversation);
  }

  let loadingTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    if (!conversations.length) {
      if (options.showLoading !== false) {
        loadingTimer = setTimeout(() => {
          void Taro.showLoading({ title: "正在进入聊天", mask: true });
        }, 180);
      }
      try {
        const entryConversation = await getEntryConversation({
          timeout: options.requestTimeout,
        });

        if (entryConversation) {
          return navigateToConversation(entryConversation);
        }
      } catch (error) {
        if (
          !(error instanceof ApiException) ||
          error.code !== "RESOURCE_NOT_FOUND"
        ) {
          throw error;
        }

        conversations = await getConversations({
          force: options.forceRefresh,
          timeout: options.requestTimeout,
        });
      }
    }
  } catch (error) {
    await Taro.showToast({
      title:
        error instanceof ApiException
          ? error.message
          : "聊天对象加载失败，请稍后重试",
      icon: "none",
      duration: 1800,
    });
    return false;
  } finally {
    if (loadingTimer) {
      clearTimeout(loadingTimer);
      void Taro.hideLoading();
    }
  }

  const refreshedRememberedConversation = getRememberedSelectedConversation();
  const selectedConversation =
    (refreshedRememberedConversation
      ? conversations.find(
          (item) => item.id === refreshedRememberedConversation.id
        )
      : undefined) ?? resolveSelectedConversation(conversations);

  if (!selectedConversation) {
    await openAgentCreatePage();
    return true;
  }

  return navigateToConversation(selectedConversation);
}

async function navigateToConversation(conversation: ConversationSummary) {
  try {
    rememberSelectedConversation(conversation);
    await Taro.navigateTo({ url: buildConversationChatUrl(conversation) });
    return true;
  } catch {
    await Taro.showToast({
      title: "页面打开失败，请稍后重试",
      icon: "none",
      duration: 1800,
    });
    return false;
  }
}
