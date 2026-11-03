// Console-style focus navigation shared by the controller loop and arrow keys: D-pad moves focus to the nearest
// control in that direction, Cross activates it, Circle goes back. Dialogs mark their root with data-nav-scope so
// focus stays inside the topmost one.

export type NavDirection = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function currentScope(): HTMLElement | null {
  const scopes = Array.from(document.querySelectorAll<HTMLElement>('[data-nav-scope]')).filter(isVisible);
  return scopes[scopes.length - 1] || null;
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function candidates(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !(el as HTMLButtonElement).disabled && isVisible(el)
  );
}

export function markGamepadInput(active: boolean) {
  document.documentElement.toggleAttribute('data-gamepad-nav', active);
}

function focus(el: HTMLElement) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

// Moves focus to the closest control in the given direction, favouring controls that are lined up with the current
// one. Returns false when nothing lies in that direction.
export function moveFocus(direction: NavDirection, root: ParentNode = currentScope() || document): boolean {
  const items = candidates(root);
  if (items.length === 0) return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body || !items.includes(active)) {
    focus(items[0]);
    return true;
  }
  const from = active.getBoundingClientRect();
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === active) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - fx;
    const dy = r.top + r.height / 2 - fy;
    const primary = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy;
    const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (primary <= 1) continue;
    const score = primary + secondary * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (!best) return false;
  focus(best);
  return true;
}

// Cross / A: press the focused control. Selects step through their options with Left/Right instead (see stepSelect).
export function activateFocused(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return false;
  active.click();
  return true;
}

// Left/Right on a focused <select> changes its value, since a native dropdown cannot be opened from a controller.
export function stepSelect(direction: NavDirection): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLSelectElement) || (direction !== 'left' && direction !== 'right')) return false;
  const next = el.selectedIndex + (direction === 'right' ? 1 : -1);
  if (next < 0 || next >= el.options.length) return true;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(el, el.options[next].value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

// Circle / B: close the topmost dialog through its own close control, otherwise behave like Escape.
export function goBack(): void {
  const scope = currentScope();
  if (scope) {
    const explicit = scope.querySelector<HTMLElement>('[data-nav-back]');
    const close = explicit || candidates(scope).find((el) =>
      el.querySelector('svg.lucide-x') || /^(close|cancel|back|not now|later)\b/i.test((el.textContent || el.title || '').trim())
    );
    close?.click();
    return;
  }
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}
