import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { clampResultsHeight, maxResultsHeight, MIN_RESULTS_HEIGHT, useViewportHeight } from './resultsHeight'

// 方向鍵每按一次調整的高度
const KEY_STEP = 16

type ResultsResizerProps = {
  // 結果面板的 id，給 aria-controls
  panelId: string
  height: number
  onResize: (height: number) => void
}

// 結果面板上緣的分隔線：拖動或聚焦後用方向鍵調整高度（↑ 變高、↓ 變矮，Home／End 到最矮／最高）
export function ResultsResizer({ panelId, height, onResize }: ResultsResizerProps) {
  const viewportHeight = useViewportHeight()
  const maxHeight = maxResultsHeight(viewportHeight)
  // 存下來的高度可能比現在視窗允許的高（視窗縮小過），畫面上看到的是 max-height 截過的高度，從那裡開始調
  const shownHeight = clampResultsHeight(height, viewportHeight)
  const drag = useRef<{ startY: number; startHeight: number } | null>(null)
  // 拖動時每一幀最多調整一次：pointermove 可能比畫面更新頻繁，每次調整都會重畫整個畫面
  const frame = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  function resize(next: number) {
    onResize(clampResultsHeight(next, viewportHeight))
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return
    }
    // 拖動時不要選到頁面上的文字；preventDefault 也擋掉聚焦，所以自己聚焦，接著可以用方向鍵微調
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startY: event.clientY, startHeight: shownHeight }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current) {
      return
    }
    const clientY = event.clientY
    if (frame.current != null) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      resize(current.startHeight + current.startY - clientY)
    })
  }

  function endDrag() {
    drag.current = null
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const targets: Record<string, number> = {
      ArrowUp: shownHeight + KEY_STEP,
      ArrowDown: shownHeight - KEY_STEP,
      Home: MIN_RESULTS_HEIGHT,
      End: maxHeight,
    }
    if (event.key in targets) {
      event.preventDefault()
      resize(targets[event.key])
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-controls={panelId}
      aria-label="調整結果面板高度"
      aria-valuemin={MIN_RESULTS_HEIGHT}
      aria-valuemax={maxHeight}
      aria-valuenow={shownHeight}
      title="拖動或用方向鍵調整結果面板高度"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className="h-1.5 shrink-0 cursor-row-resize touch-none border-t bg-background outline-none transition-colors hover:bg-primary/40 focus-visible:bg-primary/60"
    />
  )
}
