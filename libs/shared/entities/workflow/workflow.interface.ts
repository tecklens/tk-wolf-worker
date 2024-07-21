import {
  IOverridesDataTrigger,
  ITargetTrigger,
} from '@libs/shared/trigger/target-trigger.dto';

export interface IWorkflowEntity {
  _id?: string;

  _organizationId: string;

  _environmentId: string;
  _userId: string;

  active: boolean;
  name: string;
  identifier: string;
  description: string;
  tags: string[];

  deleted: boolean;

  deletedAt?: string;

  deletedBy?: string;

  createdAt: string;

  updatedAt?: string;
  viewport: any;
}

export interface INextJob {
  workflowId: string;
  workflowName: string;
  currentNodeId: string;
  organizationId: string;
  environmentId: string;
  userId: string;

  target: ITargetTrigger;
  overrides?: IOverridesDataTrigger;
}

export interface IWebhookData {
  _workflowId: string;
  _userId: string;
  requestData: any;
  taskId: string;
}
