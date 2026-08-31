import type { NodeTypes } from '@xyflow/react';
import BoardLinkNode from '@/canvas/nodes/BoardLinkNode';
import CardNode from '@/canvas/nodes/CardNode';
import GroupNode from '@/canvas/nodes/GroupNode';
import ImageNode from '@/canvas/nodes/ImageNode';
import NoteNode from '@/canvas/nodes/NoteNode';
import ShapeNode from '@/canvas/nodes/ShapeNode';
import TextNode from '@/canvas/nodes/TextNode';

/** Keyed by `BoardNode['kind']` so the mapping needs no translation table. */
export const nodeTypes: NodeTypes = {
  card: CardNode,
  note: NoteNode,
  image: ImageNode,
  boardLink: BoardLinkNode,
  group: GroupNode,
  text: TextNode,
  shape: ShapeNode,
};

export { BoardLinkNode, CardNode, GroupNode, ImageNode, NoteNode, ShapeNode, TextNode };
