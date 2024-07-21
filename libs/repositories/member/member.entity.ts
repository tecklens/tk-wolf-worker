import { Types } from 'mongoose';

import {
  ChangePropsValueType,
  IMemberInvite,
  MemberRoleEnum,
  MemberStatusEnum,
  OrganizationId,
  IUser,
} from '@wolfxlabs/stateless';

export class MemberEntity {
  _id: string;

  _userId: string;

  user?: Pick<IUser, 'firstName' | '_id' | 'lastName' | 'email'>;

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
