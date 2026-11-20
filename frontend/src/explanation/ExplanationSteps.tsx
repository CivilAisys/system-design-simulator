import { Fragment, useId } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { STALE_RESULT_NOTE } from '@/canvas/format'
import { cn } from '@/lib/utils'
import {
  explanationLines,
  explanationState,
  formatResult,
  hasTerms,
  substitutedFormula,
  symbolicFormula,
  type ExplanationLine,
  type ExplanationStep,
} from './explanation'
import { useShowFormula } from './showFormula'

type ExplanationBodyProps = {
  steps: ExplanationStep[] | undefined
  unconnected: boolean
  // 上次 Run 驗證失敗，沒有計算結果
  invalid: boolean
  // 拓撲在上次 Run 之後改過：算式照樣顯示，畫淡並註明
  stale: boolean
  // 沒有外面的標題時（容量估算表）自己寫一個，開關緊接在它旁邊
  heading?: string
} & Omit<ExplanationStepsProps, 'steps'>

// 屬性面板和容量估算表共用：依狀態（explanationState）顯示訊息或算式；驗證錯誤、沒有結果時不顯示
export function ExplanationBody({
  steps,
  unconnected,
  invalid,
  stale,
  heading,
  nodeName,
  onSelectNode,
}: ExplanationBodyProps) {
  const state = explanationState({ steps, unconnected, invalid })
  if (state === 'hidden') return null
  if (state === 'unconnected') return <Note>未連線，沒有計算</Note>
  if (state === 'pending' || !steps) return <Note>Run 之後顯示</Note>
  return (
    <>
      <ShowFormulaSwitch heading={heading} />
      {stale && <Note>{STALE_RESULT_NOTE}</Note>}
      <div className={cn(stale && 'opacity-50')}>
        <ExplanationSteps steps={steps} nodeName={nodeName} onSelectNode={onSelectNode} />
      </div>
    </>
  )
}

// 預設白話；打開後每一行底下多一行灰色的公式。屬性面板和容量估算表共用同一個開關。
// 屬性面板的標題在外面（可以收合的按鈕），開關在下一行靠右；有 heading 時開關接在標題後面
function ShowFormulaSwitch({ heading }: { heading?: string }) {
  const [showFormula, setShowFormula] = useShowFormula()
  const id = useId()
  return (
    <div className={cn('flex items-center gap-2', heading ? 'gap-4' : 'justify-end')}>
      {heading && <h4 className="text-xs font-semibold">{heading}</h4>}
      <div className="flex items-center gap-2">
        <Switch id={id} size="sm" checked={showFormula} onCheckedChange={setShowFormula} />
        <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
          看公式
        </Label>
      </div>
    </div>
  )
}

function Note({ children }: { children: string }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}

type ExplanationStepsProps = {
  steps: ExplanationStep[]
  // 代入值來自別的節點時顯示它的名稱；找不到（例如已經刪掉）時只顯示數字
  nodeName: (id: string) => string | undefined
  onSelectNode: (id: string) => void
}

// 計算說明（spec 4.9）：依分組列出，每一步一句白話；看公式時底下多一行「名稱 = 公式 = 代入值 = 結果」。
// 太長時換行，不出現水平捲軸
export function ExplanationSteps({ steps, nodeName, onSelectNode }: ExplanationStepsProps) {
  const [showFormula] = useShowFormula()
  return (
    <div className="grid gap-3">
      {explanationLines(steps, showFormula).map(({ group, lines }, i) => (
        <section key={i} className="grid gap-2">
          <h4 className="text-xs font-semibold text-muted-foreground">{group}</h4>
          {lines.map((line, j) => (
            <Line key={j} line={line} showFormula={showFormula} nodeName={nodeName} onSelectNode={onSelectNode} />
          ))}
        </section>
      ))}
    </div>
  )
}

type LineProps = { line: ExplanationLine; showFormula: boolean } & Omit<ExplanationStepsProps, 'steps'>

function Line({ line, showFormula, nodeName, onSelectNode }: LineProps) {
  return (
    <div className="grid gap-0.5 border-l-2 pl-2 text-xs leading-relaxed break-words">
      {line.plain.length > 0 && (
        <p>
          {line.prefix && <span className="font-medium">{line.prefix}</span>}
          {line.plain.map((part, i) =>
            part.kind === 'text' ? (
              <Fragment key={i}>{part.text}</Fragment>
            ) : (
              <NodeName key={i} id={part.nodeId} name={nodeName(part.nodeId)} onSelect={onSelectNode} />
            ),
          )}
        </p>
      )}
      {showFormula &&
        line.formulas.map((step, i) => <Formula key={i} step={step} nodeName={nodeName} onSelectNode={onSelectNode} />)}
    </div>
  )
}

// 原本的公式：灰色小字。只在看公式顯示的步驟（例如 Erlang C 的中間值）只有這一行
function Formula({ step, nodeName, onSelectNode }: { step: ExplanationStep } & Omit<ExplanationStepsProps, 'steps'>) {
  const result = <span className="font-semibold">{formatResult(step)}</span>
  return (
    <p className="text-[11px] text-muted-foreground">
      <span className="font-medium">{step.label}</span>
      {hasTerms(step) ? (
        <>
          {' = '}
          {symbolicFormula(step)}
          {' = '}
          {substitutedFormula(step).map((part, i) => (
            <Fragment key={i}>
              {part.text}
              {part.kind === 'term' && part.nodeId != null && (
                <NodeLink id={part.nodeId} name={nodeName(part.nodeId)} onSelect={onSelectNode} />
              )}
            </Fragment>
          ))}
          {' = '}
          {result}
        </>
      ) : (
        // 純文字說明，例如過載時延遲沒有定義：結果後面接著說明
        <>
          {' = '}
          {result}（{step.formula}）
        </>
      )}
    </p>
  )
}

type NodeLinkProps = { id: string; name: string | undefined; onSelect: (id: string) => void }

const LINK_CLASS =
  'rounded-sm text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

// 公式裡代入值旁邊的節點名稱，點了就選取那個節點，屬性面板換成它的算式
function NodeLink({ id, name, onSelect }: NodeLinkProps) {
  if (name === undefined) return null
  return (
    <button type="button" className={LINK_CLASS} title={`選取 ${name}，看它的算式`} onClick={() => onSelect(id)}>
      （{name}）
    </button>
  )
}

// 白話裡的節點名稱（模板的 {@符號}），一樣可以點；節點已經刪掉時寫成一般文字
function NodeName({ id, name, onSelect }: NodeLinkProps) {
  if (name === undefined) return <>已刪除的節點</>
  return (
    <button type="button" className={LINK_CLASS} title={`選取 ${name}，看它的算式`} onClick={() => onSelect(id)}>
      {name}
    </button>
  )
}
