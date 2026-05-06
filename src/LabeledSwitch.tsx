import { useId } from 'react'

// @ink:ux Shared buy-zone / flash-mode toggles; DOM order must stay input → .toggle-switch for App.css sibling rules.
export function LabeledSwitch({
  checked,
  onChange,
  label,
  id: idProp,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  id?: string
}) {
  const reactId = useId()
  const inputId = idProp ?? `ls-${reactId.replace(/:/g, '')}`

  return (
    <label className="toggle-control" htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-switch" aria-hidden="true" />
      <span className="toggle-label">{label}</span>
    </label>
  )
}
