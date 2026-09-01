/**
 * "Did that click land outside the thing?"
 *
 * Sounds trivial and is the source of a whole family of bugs: a menu rendered
 * through a portal is not a descendant of the control that opened it, so a
 * dismiss handler that only knows about the button treats every click on the
 * menu as an outside click. It closes on `pointerdown`, and the `click` that
 * would have chosen something never reaches a mounted element. The menu appears
 * to work and does nothing — which is exactly how the board tile's settings
 * shipped.
 *
 * So the answer takes *every* element that counts as inside, not just the one
 * that owns the state.
 */

/** The slice of `Node` this needs: enough that a test can stand in for one. */
export interface ContainerLike {
  contains(node: unknown): boolean;
}

/**
 * Whether a pointer event should dismiss something anchored to `anchors`.
 *
 * An event with no element target — synthesised, or fired at the document —
 * counts as outside: a menu that cannot prove the click was its own should
 * close rather than persist.
 */
export function clickedOutside(
  target: unknown,
  anchors: readonly (ContainerLike | null | undefined)[],
): boolean {
  if (target === null || target === undefined) return true;
  return !anchors.some((anchor) => anchor?.contains(target) === true);
}
