import { useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { checkNumber, fromSlider, sliderRange, toSlider, type NumberSpec } from './params'

type NumberFieldProps = {
  spec: NumberSpec
  value: number
  onChange: (value: number) => void
}

// Input 和 Slider 改的是同一個值。Input 打到一半（空白、超出範圍）時只顯示錯誤，
// 不把不合法的值寫進拓撲，所以送去 Run 的參數一定通過 spec 4.5 的範圍檢查
export function NumberField({ spec, value, onChange }: NumberFieldProps) {
  const id = useId()
  const [draft, setDraft] = useState(String(value))
  const [shown, setShown] = useState(value)

  // 值從外面改變（拖 slider）時同步輸入框；"1." 這類還在打的字串對應同一個值，保持不動
  if (value !== shown) {
    setShown(value)
    if (Number(draft) !== value) {
      setDraft(String(value))
    }
  }

  const parsed = draft.trim() === '' ? NaN : Number(draft)
  const error = checkNumber(spec, parsed)

  function onInput(text: string) {
    setDraft(text)
    const next = text.trim() === '' ? NaN : Number(text)
    if (checkNumber(spec, next) === null) {
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
        aria-invalid={error !== null}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <Slider
        {...sliderRange(spec)}
        value={[toSlider(spec, value)]}
        onValueChange={([position]) => onChange(fromSlider(spec, position))}
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
