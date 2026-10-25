import { useEffect, useRef } from 'react'
import { subscribeTick } from '../core/player'

/**
 * rAF 帧回调订阅（驱动歌词渲染/进度条直写 DOM）。
 *
 * 注意：不要在这里做 React setState——每帧 setState 会造成 60fps 全量重渲染。
 * 需要时间数值时直接在回调里读 getTime 并直写 DOM/ref。
 */
export function useRafFrame(cb: () => void, active = true): void {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    if (!active) return
    return subscribeTick(() => ref.current())
  }, [active])
}
