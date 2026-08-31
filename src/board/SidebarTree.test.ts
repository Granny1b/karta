import { describe, expect, it } from 'vitest';
import { DEFAULT_NODE_SIZE, type BoardNode } from '@/domain/board';
import { makeBoardLink, makeCard, makeNote } from '@/state/factories';
import { freeSpotForLink } from '@/board/SidebarTree';

/**
 * Creating a child board from the tree now leaves a `boardLink` on the parent,
 * because a board reachable only from the sidebar is a board the canvas cannot
 * see — and spec 5.2 wants the parent to read as a dashboard.
 *
 * Which means the placement has to be right without anybody looking: the user
 * is navigated into the child the moment it exists and does not see where the
 * doorway landed. A link dropped on top of a card, or a thousand pixels off the
 * side of everything, is only found later and by accident.
 */

const LINK = DEFAULT_NODE_SIZE.boardLink;

/** A node of a given box, so a board can be described as boxes. */
function at(x: number, y: number, w = LINK.w, h = LINK.h): BoardNode {
  return makeCard({ position: { x, y }, size: { w, h } });
}

function overlapsAny(spot: { x: number; y: number }, nodes: readonly BoardNode[]): boolean {
  return nodes.some(
    (node) =>
      spot.x < node.position.x + node.size.w &&
      node.position.x < spot.x + LINK.w &&
      spot.y < node.position.y + node.size.h &&
      node.position.y < spot.y + LINK.h,
  );
}

describe('freeSpotForLink', () => {
  it('puts the first node on an empty board where an extract puts its content', () => {
    expect(freeSpotForLink([])).toEqual({ x: 80, y: 80 });
  });

  it('continues a row of board links rather than starting somewhere new', () => {
    // The template's root board: five links in a row (Appendix A).
    const row = [0, 1, 2, 3, 4].map((i) =>
      makeBoardLink({ targetBoardId: `b${i}`, position: { x: i * 264, y: 0 } }),
    );
    expect(freeSpotForLink(row)).toEqual({ x: 5 * 264, y: 0 });
  });

  it('fills a hole in the arrangement before it grows the board', () => {
    const row = [at(0, 0), at(264 * 2, 0)];
    // The gap between them is exactly one slot wide, so that is where it goes.
    expect(freeSpotForLink(row)).toEqual({ x: 264, y: 0 });
  });

  it('never lands on anything, wherever the content is', () => {
    const boards: BoardNode[][] = [
      [at(0, 0)],
      [at(-500, -300, 480, 360), at(-100, 40)],
      [at(3, 7), at(261, 9)], // positions off the grid, from a drag with Alt held
      [at(0, 0, 1200, 900)], // one huge frame
      Array.from({ length: 40 }, (_, i) => at((i % 8) * 264, Math.floor(i / 8) * 144)),
    ];

    for (const nodes of boards) {
      const spot = freeSpotForLink(nodes);
      expect(overlapsAny(spot, nodes), JSON.stringify(spot)).toBe(false);
    }
  });

  it('lands on the canvas grid, so the link lines up with everything dragged', () => {
    const spot = freeSpotForLink([at(3, 7), makeNote({ position: { x: 101, y: 205 } })]);
    expect(spot.x % 8).toBe(0);
    expect(spot.y % 8).toBe(0);
  });

  it('goes below everything once the search area is exhausted', () => {
    // A packed field far larger than the bounded walk: 30 × 30 slots, and the
    // walk stops at 24. Below the lot is always free, and always found.
    const packed: BoardNode[] = [];
    for (let row = 0; row < 30; row += 1) {
      for (let col = 0; col < 30; col += 1) packed.push(at(col * 264, row * 144));
    }

    const spot = freeSpotForLink(packed);
    expect(overlapsAny(spot, packed)).toBe(false);
    expect(spot.y).toBeGreaterThanOrEqual(29 * 144 + LINK.h);
  });

  it('measures the whole node, not its corner', () => {
    // A frame is 480 × 360: a slot placed on its corner would sit inside it.
    const frame = at(0, 0, 480, 360);
    const spot = freeSpotForLink([frame]);
    expect(overlapsAny(spot, [frame])).toBe(false);
    expect(spot.x).toBeGreaterThanOrEqual(480);
  });
});
