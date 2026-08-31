import type { Edge as FlowEdge, Node as FlowNode } from '@xyflow/react';
import type {
  BoardLinkNode,
  BoardNode,
  CardNode,
  Edge as BoardEdge,
  GroupNode,
  ImageNode,
  NodeKind,
  NoteNode,
} from '@/domain/board';

/**
 * React Flow shapes for the board document (spec 7.3).
 *
 * A flow node carries its board node verbatim in `data.node` — nothing is
 * copied out, so a node re-renders exactly when its document object changes.
 */
export type KartaNodeData<T extends BoardNode = BoardNode> = { node: T };

export type KartaFlowNode = FlowNode<KartaNodeData, NodeKind>;
export type CardFlowNode = FlowNode<KartaNodeData<CardNode>, 'card'>;
export type NoteFlowNode = FlowNode<KartaNodeData<NoteNode>, 'note'>;
export type ImageFlowNode = FlowNode<KartaNodeData<ImageNode>, 'image'>;
export type BoardLinkFlowNode = FlowNode<KartaNodeData<BoardLinkNode>, 'boardLink'>;
export type GroupFlowNode = FlowNode<KartaNodeData<GroupNode>, 'group'>;

export type KartaEdgeData = { edge: BoardEdge };
export type KartaFlowEdge = FlowEdge<KartaEdgeData, 'semantic'>;
