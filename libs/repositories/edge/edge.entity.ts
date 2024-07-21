import { NodeId } from '@libs/repositories/node/types';
import { IEdgeEntity } from '@libs/shared/entities/workflow/edge.interface';

export class EdgeEntity implements IEdgeEntity {
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
  data?: any;
  className?: string;
  zIndex?: number;
  ariaLabel?: string;
  interactionWidth?: number;
  updatable?: any;

  deleted: boolean;

  deletedAt?: string;

  deletedBy?: string;

  createdAt: string;

  updatedAt?: string;
}

export type EdgeDBModel = EdgeEntity;
