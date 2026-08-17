export function hasVisibleOpacity(element, getComputedStyle) {
  for (let current = element; current; current = current.parentElement) {
    const opacity = Number.parseFloat(getComputedStyle(current).opacity);
    if (Number.isFinite(opacity) && opacity <= 0) return false;
  }
  return true;
}
