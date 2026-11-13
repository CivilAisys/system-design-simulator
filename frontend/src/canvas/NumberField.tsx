import { useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { checkNumber, fromSlider, parseDraft, sliderRange, syncDraft, toSlider, type NumberSpec } from './params'

type NumberFieldProps = {
  spec: NumberSpec
  value: number
  onChange: (value: number) => void
  // 預設只檢查 spec 的範圍；instances、concurrency 另外要看乘積
  check?: (value: number) => string | null
}

// Input 和 Slider 改的是同一個值。Input 打到一半（空白、超出範圍）時只顯示錯誤，
// 不把不合法的值寫進拓撲，所以送去 Run 的參數一定通過 spec 4.5 的範圍檢查。
// 不合法的草稿在失焦時還原成目前的值，輸入框不會長期和實際的值不一致
export function NumberField({ spec, value, onChange, check = (next) => checkNumber(spec, next) }: NumberFieldProps) {
  const id = useId()
  const [draft, setDraft] = useState(String(value))
  const [shown, setShown] = useState(value)

  // 值從外面改變（拖 slider）時同步輸入框；"1." 這類還在打的字串對應同一個值，保持不動
  if (value !== shown) {
    setShown(value)
    setDraft(syncDraft(draft, value))
  }

  const error = check(parseDraft(draft))

  function onInput(text: string) {
    setDraft(text)
    const next = parseDraft(text)
    if (check(next) === null) {
      onChange(next)
    }
  }

  // slider 的範圍都在上限內，但乘積仍可能超過（instances 打 1000 後把 concurrency 拖到 10000），這時不動
  function onSlide(position: number) {
    const next = fromSlider(spec, position)
    if (check(next) === null) {
      onChange(next)
    }
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{spec.label}</Label>
        {spec.unit && <span className="text-xs text-muted-foreground">{spec.unit}</span>}
      </div>
      <Input
        id={id}
        inputMode="decimal"
        value={draft}
        onChange={(event) => onInput(event.target.value)}
        onBlur={() => setDraft(syncDraft(draft, value))}
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <Slider
        {...sliderRange(spec)}
        value={[toSlider(spec, value)]}
        onValueChange={([position]) => onSlide(position)}
        aria-label={spec.label}
      />
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
