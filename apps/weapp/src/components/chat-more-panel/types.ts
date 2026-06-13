export type ChatMoreAction =
  | 'photo'
  | 'camera'
  | 'memorial-photo'

export type ChatMoreActionItem = {
  key: ChatMoreAction
  label: string
}
