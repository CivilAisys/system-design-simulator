// 參數名稱「中文（英文）」：英文是 API 的欄位名稱，用較淡的顏色。
// 包成一個 span：Label 是 flex + gap，分開的子元素中間會多出空隙
export function ParamLabel({ label, labelEn }: { label: string; labelEn: string }) {
  return (
    <span>
      {label}
      <span className="font-normal text-muted-foreground">（{labelEn}）</span>
    </span>
  )
}
