export interface ITargetTrigger {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  locale: string;
}

export interface IOverridesDataTrigger {
  content?: string;
  to?: string;
  from?: string;
  customData?: any;

  webhookUrl?: string;
  baseUrl?: string;
}