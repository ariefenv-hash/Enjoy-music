import { useEffect, useRef, useState } from 'react'
import { subscribeTick } from '../core/player'

/** 每帧获取播放时间（驱动歌词渲染） */
export function usePlayTime(getTime: () => number, active: boolean): number {
  const [t, setT] = useState(0)
  const getRef = useRef(getTime)
  getRef.current = getTime
  useEffect(() => {
    if (!active) return
    return subscribeTick(() => setT(getRef.current()))
  }, [active])
  return t
}

/** 状态层：每帧渲染时使用（歌词舞台用直写 DOM 方式，不经 React 状态） */
export function useRafFrame(cb: () => void, active = true): void {
  const ref = useRef(cb)
  ref.current = cb
  useEffect(() => {
    if (!active) return
    return subscribeTick(() => ref.current())
  }, [active])
}
