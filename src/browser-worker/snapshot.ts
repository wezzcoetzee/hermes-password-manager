/** Runs inside the page. Must stay self-contained: Playwright serialises it. */
export interface RawElement {
  ref: string
  role: string
  name: string
  type?: string
  href?: string
  options?: string[]
  selected?: string
  checked?: boolean
  filled?: boolean
  disabled?: boolean
}

export interface RawSnapshot { title: string; url: string; text: string; elements: RawElement[] }

export function collectSnapshot(refAttr: string): RawSnapshot {
  const visible = (el: Element) => {
    const style = getComputedStyle(el)
    return el.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
  }
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)

  document.querySelectorAll(`[${refAttr}]`).forEach((el) => el.removeAttribute(refAttr))
  const elements: RawElement[] = []
  const candidates = document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=option]')
  let n = 0
  for (const el of candidates) {
    if (!visible(el) || n >= 300) continue
    const ref = `e${++n}`
    el.setAttribute(refAttr, ref)
    const html = el as HTMLElement
    const input = el as HTMLInputElement
    const labels = 'labels' in input && input.labels ? Array.from(input.labels).map((l) => l.textContent).join(' ') : ''
    const item: RawElement = {
      ref,
      role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
      name: clean(el.getAttribute('aria-label') || labels || html.innerText || input.placeholder || (input.type === 'submit' ? input.value : '') || el.getAttribute('name') || el.getAttribute('title')),
    }
    if (el instanceof HTMLAnchorElement) item.href = el.href.slice(0, 300)
    if (el instanceof HTMLInputElement) {
      item.type = el.type
      if (el.type === 'checkbox' || el.type === 'radio') item.checked = el.checked
      // Field values are never returned: they may hold secrets the agent did not type.
      else if (el.type !== 'submit' && el.type !== 'button') item.filled = el.value.length > 0
    }
    if (el instanceof HTMLTextAreaElement) item.filled = el.value.length > 0
    if (el instanceof HTMLSelectElement) {
      item.options = Array.from(el.options).slice(0, 50).map((o) => clean(o.label))
      item.selected = clean(el.selectedOptions[0]?.label)
    }
    if ((el as HTMLButtonElement).disabled) item.disabled = true
    elements.push(item)
  }
  return { title: document.title.slice(0, 200), url: location.href, text: document.body?.innerText ?? '', elements }
}
