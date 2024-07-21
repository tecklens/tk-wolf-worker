import { Types } from 'mongoose';

import {
  ChangePropsValueType,
  IMember,
  IMemberInvite,
  IUserEntity,
  MemberRoleEnum,
  MemberStatusEnum,
  OrganizationId,
} from '@wolf/stateless';

export class MemberEntity implements IMember {
  _id: string;

  _userId: string;

  user?: Pick<IUserEntity, 'firstName' | '_id' | 'lastName' | 'email'>;

  roles: MemberRoleEnum[];

  invite?: IMemberInvite;

  memberStatus: MemberStatusEnum;

  _organizationId: OrganizationId;

  isDefault: boolean;
}

export type MemberDBModel = ChangePropsValueType<
  Omit<MemberEntity, 'invite'>,
  '_userId' | '_organizationId'
> & {
  invite?: IMemberInvite & {
    _inviterId: Types.ObjectId;
  };
};
