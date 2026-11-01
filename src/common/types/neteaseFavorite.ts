export interface NeteaseFavoriteRequest {
  songId: string
  /** add 收藏到「我喜欢的音乐」，remove 取消收藏 */
  action?: 'add' | 'remove'
}

export interface NeteaseFavoriteResult {
  provider: 'wy'
  status: 'added' | 'removed' | 'login_required' | 'unsupported' | 'unavailable' | 'rejected' | 'unconfirmed'
  code?: number
  accountId?: string
}
