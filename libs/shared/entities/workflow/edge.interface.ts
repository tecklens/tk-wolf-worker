import { NodeId } from '@libs/repositories/node/types';

export interface IEdgeEntity {
  id?: NodeId;

  _workflowId: string;

  type?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  style?: any;
  animated?: boolean;
  hidden?: boolean;
  deletable?: boolean;
  data?: any;
  className?: string;
  selected?: boolean;
  markerStart?: any;
  markerEnd?: any;
  zIndex?: number;
  ariaLabel?: string;
  interactionWidth?: number;
  focusable?: boolean;
  updatable?: any;

  deleted: boolean;

  deletedAt?: string;

  deletedBy?: string;

  createdAt: string;

  updatedAt?: string;
}
