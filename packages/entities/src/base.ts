import { ObjectIdColumn } from "typeorm";
import { ObjectId as MongoObjectId } from "mongodb";

export { MongoObjectId };

export enum TableName {
  user = "user",
  user_account = "user_account",
  admin_user = "admin_user",
  admin_account = "admin_account",
  agent = "agent",
  agent_memory_fact = "agent_memory_fact",
  agent_profile_fact = "agent_profile_fact",
  agent_relationship_signal = "agent_relationship_signal",
  agent_share_invite = "agent_share_invite",
  agent_share_member = "agent_share_member",
  agent_sub = "agent_sub",
  conversation = "conversation",
  conversation_chat_import_batch = "conversation_chat_import_batch",
  conversation_chat_import_item = "conversation_chat_import_item",
  conversation_emotion_state = "conversation_emotion_state",
  conversation_message_feedback = "conversation_message_feedback",
  conversation_deliberate_reply_task = "conversation_deliberate_reply_task",
  conversation_reply_turn = "conversation_reply_turn",
  chat_trace = "chat_trace",
  chat_span = "chat_span",
  message = "message",
  messenger_call_event = "messenger_call_event",
  post = "post",
  post_comment = "post_comment",
  post_comment_notification = "post_comment_notification",
  post_like = "post_like",
  post_notification = "post_notification",
  vip_plan = "vip_plan",
  order = "order",
  order_refund = "order_refund",
  user_membership = "user_membership",
  agent_entitlement = "agent_entitlement",
  free_chat_agent_ledger = "free_chat_agent_ledger",
  coupon_ledger = "coupon_ledger",
  voice_package = "voice_package",
  voice_service_session = "voice_service_session",
  voice_training_task = "voice_training_task",
  voice_timbre = "voice_timbre",
  voice_timbre_material = "voice_timbre_material",
  quota_trigger_event = "quota_trigger_event",
}

export class BaseEntity {
  @ObjectIdColumn()
  id!: MongoObjectId;
}
