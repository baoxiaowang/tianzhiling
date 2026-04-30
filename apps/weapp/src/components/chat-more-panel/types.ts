export type ChatMoreAction =
  | 'photo'
  | 'camera'
  | 'videoCall'
  | 'location'
  | 'redPacket'
  | 'gift'
  | 'transfer'

export type ChatMoreActionItem = {
  key: ChatMoreAction
  label: string
}
