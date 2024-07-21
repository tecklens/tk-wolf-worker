
export interface ITaskEntity {
  id?: string;

  _workflowId: string;
  _userId: string;
  _environmentId: string;
  _organizationId: string;
  workflowName: string;
  _nodeId: string;
  _providerId: string;
  providerName: string;
  payload: any;
  channel: string;

  code: string;
  name: string;
  type: string;
  status: number;
  priority: string;
  subscriberId: string;
  email: string;
  phone: string;
  errorDetail: any;
  bodyWebhook: any;

  deletedAt?: Date;
  deletedBy?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt?: Date;
}
