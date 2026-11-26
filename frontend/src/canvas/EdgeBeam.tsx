import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { EdgeKind } from './catalog'
import type { Congestion } from './congestion'
import { ASYNC_DASH } from './edgeStyle'
import { beamOf, type Beam } from './beam'

type EdgeBeamProps = {
  path: string
  // 這條邊的 rps；還沒 Run 或結果有驗證錯誤時沒有
  rps?: number
  kind: EdgeKind
  selected?: boolean
  // 有驗證錯誤：紅色燈管，不畫白光
  invalid: boolean
  // 結果過期：燈管畫淡、白光和光點停住
  stale?: boolean
  // 過載節點前後的邊（congestion.ts），取代一般的白光
  congestion?: Congestion
  // 邊的終點：壅塞時入口的那團光
  targetX: number
  targetY: number
}

// 一道白光的長度，以整條邊為 100（pathLength），和邊的實際長度無關
const SWEEP_LENGTH = 7

// 壅塞、受限的燈管顏色。受限是偏灰的青色，整根再畫暗（index.css 的 .beam-starved）
const CONGESTION_COLOR: Record<Congestion, string> = {
  jam: '#ff5a2e',
  starved: 'color-mix(in oklab, #00c2ff 30%, #a19db0)',
}

// 壅塞的光點數量和走完一條邊的秒數
const JAM_DOTS = 7
const JAM_DURATION_S = 2.6
// 受限的那道細白光走完一條邊的秒數
const STARVED_DURATION_S = 4.5

// 霓虹燈管加多道掃光（spec 第 6 節），樣式在 index.css 的 .beam-*。
// 燈管三層：外光暈、彩色燈管、白色燈芯；白光數量、速度、燈管顏色看 beam.ts 的級距。
// 過載節點前後的邊改畫壅塞（光點擠在入口）或受限（變暗、一道很慢的白光）
export function EdgeBeam({ path, rps, kind, selected, invalid, stale, congestion, targetX, targetY }: EdgeBeamProps) {
  const beam = rps == null ? null : beamOf(rps)
  // 0 rps 或還沒 Run：只有底下的淡線
  if (!invalid && !beam) {
    return null
  }
  const dash = kind === 'ASYNC' ? ASYNC_DASH : undefined
  // 驗證錯誤時沒有計算結果，不會有壅塞或受限
  const color = invalid || !beam ? 'var(--destructive)' : congestion ? CONGESTION_COLOR[congestion] : beam.color
  return (
    <g className="pointer-events-none">
      {/* 燈管蓋住了底下連線的選取色，外面另加一圈主色。放在畫淡的那一層外面，結果過期時也看得出選到哪一條 */}
      {selected && <path d={path} className="beam-selected" />}
      <g className={cn(stale && 'opacity-35')} style={{ '--beam': color } as CSSProperties}>
        <g className={cn(congestion === 'starved' && 'beam-starved')}>
          <path d={path} className="beam-halo" strokeDasharray={dash} />
          <path d={path} className="beam-tube" strokeDasharray={dash} />
          <path d={path} className="beam-core" strokeDasharray={dash} />
          {!invalid && beam && flowMarks(path, beam, congestion, stale ?? false, targetX, targetY)}
        </g>
      </g>
    </g>
  )
}

function flowMarks(
  path: string,
  beam: Beam,
  congestion: Congestion | undefined,
  stale: boolean,
  targetX: number,
  targetY: number,
): ReactNode {
  // 過期時白光、光點停在原地
  const paused = stale && '[animation-play-state:paused]'
  switch (congestion) {
    // 壅塞：光點一開始快、越接近過載節點越慢（ease-out，見 .beam-jam-dot），在入口前擠成一團；
    // 入口有一團慢慢脈動的橘紅光。光點是長度幾乎是 0 的圓頭虛線，用 CSS 動畫移動，過期時才停得住
    case 'jam':
      return (
        <>
          {Array.from({ length: JAM_DOTS }, (_, i) => (
            <path
              key={i}
              d={path}
              pathLength={100}
              className={cn('beam-jam-dot', paused)}
              style={{
                animationDuration: `${JAM_DURATION_S}s`,
                // 負的延遲讓光點一開始就分布在線上，而不是從起點一個個出發
                animationDelay: `${(-i * JAM_DURATION_S) / JAM_DOTS}s`,
              }}
            />
          ))}
          <circle cx={targetX} cy={targetY} r={7} className={cn('beam-jam-pile', paused)} />
        </>
      )
    // 受限：只有一道很慢的細白光
    case 'starved':
      return (
        <Sweep
          path={path}
          sweeps={1}
          length={10}
          durationS={STARVED_DURATION_S}
          className={cn('beam-sweep-starved', paused)}
        />
      )
    default:
      return (
        <Sweep path={path} sweeps={beam.sweeps} length={SWEEP_LENGTH} durationS={beam.durationS} className={paused} />
      )
  }
}

type SweepProps = {
  path: string
  sweeps: number
  // 一道白光的長度（pathLength = 100）
  length: number
  // 一道白光走完整條邊的秒數
  durationS: number
  className?: string | false
}

// 平均分布的白光：每道間隔 period，一起往前移一個間隔就無縫循環
function Sweep({ path, sweeps, length, durationS, className }: SweepProps) {
  const period = 100 / sweeps
  return (
    <path
      d={path}
      pathLength={100}
      className={cn('beam-sweep', className)}
      style={
        {
          strokeDasharray: `${length} ${period - length}`,
          '--sweep-period': period,
          animationDuration: `${durationS / sweeps}s`,
        } as CSSProperties
      }
    />
  )
}
