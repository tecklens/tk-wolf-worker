import { NodeId } from '@libs/repositories/node/types';
import {
  Position,
  XYPosition,
} from '@libs/shared/entities/workflow/position.interface';

export interface INodeEntity {
  id?: NodeId;

  _workflowId: string;
  _providerId: string;

  position: XYPosition;
  data: any;
  type?: string;
  sourcePosition?: Position;
  targetPosition?: Position;
  hidden?: boolean;
  width?: number | null;
  height?: number | null;
  /** @deprecated - use `parentId` instead */
  parentNode?: string;
  parentId?: string;
  zIndex?: number;
  extent?: string;
  expandParent?: boolean;
  positionAbsolute?: XYPosition;
  ariaLabel?: string;
  focusable?: boolean;
  className?: string;
  style?: any;

  deleted: boolean;
  connected: boolean;

  deletedAt?: string;

  deletedBy?: string;

  createdAt: string;

  updatedAt?: string;
}

export enum WfNodeType {
  starter = 'starter',
  sms = 'sms',
  email = 'email',
  delay = 'delay',
  webhook = 'webhook',
}