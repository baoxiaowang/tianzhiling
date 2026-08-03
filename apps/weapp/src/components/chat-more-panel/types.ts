export type ChatMoreAction =
  | 'photo'
  | 'camera'
  | 'memorial-photo'
  | 'chat-import'

export type ChatMoreActionItem = {
  key: ChatMoreAction
  label: string
}
