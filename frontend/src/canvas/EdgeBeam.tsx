import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import type { EdgeKind } from './catalog'
import { ASYNC_DASH } from './edgeStyle'
import { beamOf } from './beam'

type EdgeBeamProps = {
  path: string
  // 這條邊的 rps；還沒 Run 或結果有驗證錯誤時沒有
  rps?: number
  kind: EdgeKind
  selected?: boolean
  // 有驗證錯誤：紅色燈管，不畫白光
  invalid: boolean
  // 結果過期：燈管畫淡、白光停住
  stale?: boolean
}

// 一道白光的長度，以整條邊為 100（pathLength），和邊的實際長度無關
const SWEEP_LENGTH = 7

// 霓虹燈管加多道掃光（spec 第 6 節），樣式在 index.css 的 .beam-*。
// 燈管三層：外光暈、彩色燈管、白色燈芯；白光數量、速度、燈管顏色看 beam.ts 的級距
export function EdgeBeam({ path, rps, kind, selected, invalid, stale }: EdgeBeamProps) {
  const beam = rps == null ? null : beamOf(rps)
  // 0 rps 或還沒 Run：只有底下的淡線
  if (!invalid && !beam) {
    return null
  }
  const dash = kind === 'ASYNC' ? ASYNC_DASH : undefined
  const period = beam ? 100 / beam.sweeps : 100
  return (
    <g className="pointer-events-none">
      {/* 燈管蓋住了底下連線的選取色，外面另加一圈主色。放在畫淡的那一層外面，結果過期時也看得出選到哪一條 */}
      {selected && <path d={path} className="beam-selected" />}
      <g
        className={cn(stale && 'opacity-35')}
        style={{ '--beam': invalid || !beam ? 'var(--destructive)' : beam.color } as CSSProperties}
      >
        <path d={path} className="beam-halo" strokeDasharray={dash} />
        <path d={path} className="beam-tube" strokeDasharray={dash} />
        <path d={path} className="beam-core" strokeDasharray={dash} />
        {/* 每道白光間隔 period，一起往前移一個間隔就無縫循環 */}
        {!invalid && beam && (
          <path
            d={path}
            pathLength={100}
            className={cn('beam-sweep', stale && '[animation-play-state:paused]')}
            style={
              {
                strokeDasharray: `${SWEEP_LENGTH} ${period - SWEEP_LENGTH}`,
                '--sweep-period': period,
                animationDuration: `${beam.durationS / beam.sweeps}s`,
              } as CSSProperties
            }
          />
        )}
      </g>
    </g>
  )
}
