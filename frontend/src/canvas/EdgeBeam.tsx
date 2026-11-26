import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { Beam } from '@/skin'
import type { EdgeKind } from './catalog'
import type { Congestion } from './RpsEdge'
import type { Particles } from './flow'

// 原型：C 紙感的流量呈現（見 skin.ts 的 BEAMS），顏色和動畫在 skins.css。
// level 是實際 RPS 的對數級距（1 rps → 0、100 萬 rps → 1），決定顏色（--beam-heat，青 → 電光紫）、
// 粗細、掃光數量和速度，不同拓撲之間也能比。
// 只有原版「霓虹管」照上一版，顏色和速度看這條邊 / 全圖最大的邊（flow）

type EdgeBeamProps = {
  beam: Beam
  path: string
  flow: number
  rps: number
  moving: Particles
  kind: EdgeKind
  congestion?: Congestion
  targetX: number
  targetY: number
}

function rpsLevel(rps: number): number {
  return Math.min(1, Math.max(0, Math.log10(Math.max(rps, 1)) / 6))
}

type BeamContext = EdgeBeamProps & { level: number }

export function EdgeBeam(props: EdgeBeamProps) {
  const level = rpsLevel(props.rps)
  const relative = props.beam === 'neon'
  const style = {
    '--beam-heat': `${Math.round((relative ? props.flow : level) * 100)}%`,
    // 掃光走完一條邊的秒數：級距越高越快（3.4s → 1.2s）
    '--beam-dur': `${relative ? props.moving.durationS : (3.4 - 2.2 * level).toFixed(2)}s`,
  } as CSSProperties
  return (
    <g
      className={cn(
        'sim-edge-beam pointer-events-none',
        `beam-${props.beam}`,
        props.kind === 'ASYNC' && 'is-async',
        props.congestion && `is-${props.congestion}`,
      )}
      style={style}
    >
      {props.congestion
        ? CONGESTION_RENDERERS[props.congestion]({ ...props, level })
        : BEAM_RENDERERS[props.beam]({ ...props, level })}
    </g>
  )
}

// 霓虹燈管本體：外光暈 + 彩色燈管 + 白色燈芯。width 是燈管粗細
function NeonTube({ path, width }: { path: string; width: number }) {
  return (
    <>
      <path d={path} className="beam-neon-halo" style={{ strokeWidth: width * 2.8 }} />
      <path d={path} className="beam-neon-tube" style={{ strokeWidth: width }} />
      <path d={path} className="beam-neon-core" style={{ strokeWidth: Math.max(0.6, width * 0.35) }} />
    </>
  )
}

// 掃光的 stroke-dasharray 都用 pathLength={100}：長度、間隔以整條邊為 100，和邊的實際長度無關
const BEAM_RENDERERS: Record<Beam, (c: BeamContext) => ReactNode> = {
  // 細管線（對照）：只留液體，粗細 1.5～6px，表面有慢慢流動的反光
  tube: ({ path, level }) => {
    const width = 1.5 + 4.5 * level
    return (
      <>
        <path d={path} className="beam-tube" style={{ strokeWidth: width }} />
        <path d={path} className="beam-pipe-ripple" style={{ strokeWidth: Math.max(0.8, width * 0.3) }} />
      </>
    )
  },

  // 霓虹管（原版）：粗細固定，一道白光從頭掃到尾
  neon: ({ path }) => (
    <>
      <NeonTube path={path} width={3.5} />
      <path d={path} pathLength={100} className="beam-neon-sweep" />
    </>
  ),

  // 細霓虹：燈管粗細跟著流量（1.5～4.5px），光暈收斂，掃光也跟著變細，整體比較安靜
  'neon-thin': ({ path, level }) => {
    const width = 1.5 + 3 * level
    return (
      <>
        <NeonTube path={path} width={width} />
        <path
          d={path}
          pathLength={100}
          className="beam-neon-sweep beam-sweep-thin"
          style={{ strokeWidth: width + 1 }}
        />
      </>
    )
  },

  // 多道掃光：掃光的數量就是流量（1～4 道），量越大，同時在線上跑的白光越多
  'neon-multi': ({ path, level }) => {
    const count = 1 + Math.round(3 * level)
    const period = 100 / count
    return (
      <>
        <NeonTube path={path} width={2.5} />
        <path
          d={path}
          pathLength={100}
          className="beam-neon-sweep beam-sweep-multi"
          style={
            {
              strokeDasharray: `7 ${period - 7}`,
              '--sweep-period': period,
              '--sweep-count': count,
            } as CSSProperties
          }
        />
      </>
    )
  },

  // 拖尾掃光：掃光後面拖著一段漸淡的尾巴，像光在燈管裡流動，方向感最強。
  // 四段長短不同、頭對齊的光疊起來，越長的越淡
  'neon-trail': ({ path }) => (
    <>
      <NeonTube path={path} width={2.5} />
      {[
        { length: 24, opacity: 0.18 },
        { length: 14, opacity: 0.35 },
        { length: 7, opacity: 0.6 },
        { length: 3, opacity: 1 },
      ].map(({ length, opacity }) => (
        <path
          key={length}
          d={path}
          pathLength={100}
          className="beam-neon-sweep beam-sweep-trail"
          style={
            {
              strokeDasharray: `${length} ${100 - length}`,
              '--sweep-shift': 24 - length,
              opacity,
            } as CSSProperties
          }
        />
      ))}
    </>
  ),

  // LED 燈條：燈管換成一格一格的 LED，亮燈像跑馬燈一樣一格一格往前跳
  'neon-led': ({ path, level }) => (
    <>
      <path d={path} className="beam-neon-halo" style={{ strokeWidth: 7 }} />
      <path d={path} className="beam-led-off" />
      <path d={path} className="beam-led-on" style={{ animationDuration: `${(1.6 - 1.0 * level).toFixed(2)}s` }} />
    </>
  ),
}

// 過載節點前後的邊，不管選哪種樣式都改用這兩種畫法
const CONGESTION_RENDERERS: Record<Congestion, (c: BeamContext) => ReactNode> = {
  // 壅塞：燈管轉橘紅；光點一開始快、越接近過載節點越慢（ease-out），在入口前擠成一團，
  // 入口處有一個慢慢脈動的堵塞光點
  jam: ({ path, targetX, targetY }) => (
    <>
      <NeonTube path={path} width={3} />
      {Array.from({ length: JAM_DOTS }, (_, i) => (
        <circle key={i} r={2.4} className="beam-jam-dot motion-reduce:hidden">
          <animateMotion
            dur={`${JAM_DUR_S}s`}
            begin={`${(-i * JAM_DUR_S) / JAM_DOTS}s`}
            repeatCount="indefinite"
            path={path}
            calcMode="spline"
            keyTimes="0;1"
            keyPoints="0;1"
            keySplines="0.05 0.7 0.1 1"
          />
        </circle>
      ))}
      <circle cx={targetX} cy={targetY} r={7} className="beam-jam-pile" />
    </>
  ),

  // 受限：燈管變暗、偏灰，只有一道很慢的細掃光
  starved: ({ path }) => (
    <>
      <NeonTube path={path} width={2} />
      <path d={path} pathLength={100} className="beam-neon-sweep beam-sweep-thin beam-sweep-starved" />
    </>
  ),
}

const JAM_DOTS = 7
const JAM_DUR_S = 2.6
