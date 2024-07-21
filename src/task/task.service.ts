import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { ProducerService } from '@app/kafka/producer/producer.service';
import { KafkaMessage } from 'kafkajs';
import { get } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { HttpService } from '@nestjs/axios';
import { NodeRepository } from '@libs/repositories/node/node.repository';
import { EdgeRepository } from '@libs/repositories/edge/edge.repository';
import { TaskRepository } from '@libs/repositories/task/task.repository';
import { VariableRepository } from '@libs/repositories/variable/variable.repository';
import { MemberRepository } from '@libs/repositories/member';
import { ProviderRepository } from '@libs/repositories/provider';
import {
  ChannelTypeEnum,
  decryptCredentials,
  IContent,
  IMember,
  INextJob,
  INodeData,
  INodeEntity,
  IOverridesDataTrigger,
  IProvider,
  ITargetTrigger,
  IVariable,
  IWebhookData,
  makeid,
  PlatformException,
  TaskStatus,
  transformContent,
  WfNodeType,
} from '@wolf/stateless';
import { ChatFactory, MailFactory, SmsFactory } from '@wolf/providers';
import * as process from 'process';
import { CreateNotiDto } from '../../../tk-wolf/packages/stateless/src';

@Injectable()
export class TaskService {
  private logger = new Logger('TaskService');

  constructor(
    private readonly sender: ProducerService,
    private readonly nodeRepository: NodeRepository,
    private readonly edgeRepository: EdgeRepository,
    private readonly taskRepository: TaskRepository,
    private readonly providerRepository: ProviderRepository,
    private readonly memberRepository: MemberRepository,
    private readonly variableRepository: VariableRepository,
    private readonly httpService: HttpService,
    private readonly producerService: ProducerService,
  ) {}

  async nextJob(
    workflowId: string,
    workflowName: string,
    orgId: string,
    envId: string,
    target: ITargetTrigger,
    overrides: IOverridesDataTrigger,
    userId: string,
    type: string,
    previousNodeId: string | undefined,
  ) {
    let node: INodeEntity;
    if (type === 'starter') {
      node = await this.nodeRepository.findOneByWorkflowIdAndType(
        workflowId,
        WfNodeType.starter,
      );
    } else {
      node = await this.nodeRepository.findById(previousNodeId);
    }

    if (node == null)
      throw new NotFoundException('Workflow not have starter node');

    const edges = await this.edgeRepository.findBySource(node._id);

    if (edges.length > 0) {
      const nodesTarget = await this.nodeRepository.findByIdIn(
        edges.map((e) => e.target),
      );
      for (const n of nodesTarget) {
        const dataTransfer: INextJob = {
          currentNodeId: n._id,
          organizationId: orgId,
          environmentId: envId,
          target: target,
          workflowId,
          workflowName,
          userId,
          overrides: overrides,
        };

        await this.sender.produce({
          messages: [
            {
              key: userId,
              value: JSON.stringify(dataTransfer),
            },
          ],
          topic: process.env.KAFKA_NEXT_JOB_TOPIC ?? '',
        });
      }
    }
  }

  async exeNextJob({
    topic,
    partition,
    message,
  }: {
    topic: string;
    partition: number;
    message: KafkaMessage;
  }) {
    this.logger.log(`Next job with topic ${topic} , partition ${partition}`);

    const strData = message.value.toString();

    if (strData) {
      const data: INextJob = JSON.parse(strData);

      if (data.currentNodeId) {
        const node = await this.nodeRepository.findById(
          data.currentNodeId,
          '_providerId deleted data type',
        );

        if (!node) return;

        const provider = await this.providerRepository.findById(
          node._providerId,
          'channel credentials active name identifier primary conditions _environmentId _organizationId providerId',
        );

        let members: any[] = [];
        try {
          members = await this.memberRepository.getOrganizationMembers(
            data.organizationId,
          );
        } catch (e) {
          this.logger.log('Not members in workflow org');
        }

        let variables = null;
        switch (node.type) {
          case ChannelTypeEnum.EMAIL:
            variables = await this.variableRepository.findByWfId(
              data.workflowId,
            );
            await this.executeEmail(provider, node, data, members, variables);
            break;
          case ChannelTypeEnum.DELAY:
            await this.executeDelay(node.data, strData, data.userId);
            break;
          case ChannelTypeEnum.WEBHOOK:
            await this.executeWebhook(node, data);
            break;
          case ChannelTypeEnum.SMS:
            variables = await this.variableRepository.findByWfId(
              data.workflowId,
            );
            await this.executeSms(provider, node, data, members, variables);
            break;
          case ChannelTypeEnum.CHAT:
            variables = await this.variableRepository.findByWfId(
              data.workflowId,
            );
            await this.executeChatMessage(
              provider,
              node,
              data,
              members,
              variables,
            );
            break;
          default:
            return;
        }
      } else {
        this.logger.error('Message not node id');
      }
    }
  }

  private async executeDelay(data: INodeData, strData: string, userId: string) {
    if (data.delayTime && data.period) {
      await this.sender.produce({
        topic: process.env.KAFKA_DELAY_JOB,
        messages: [
          {
            key: userId,
            value: JSON.stringify({
              delayTime: data.delayTime,
              period: data.period,
              data: strData,
            }),
          },
        ],
      });
    }
  }

  private async executeWebhook(node: INodeEntity, inp: INextJob) {
    if (node.data?.webhookUrl && node.data?.method) {
      const task = await this.taskRepository.create({
        _userId: inp.userId,
        _environmentId: inp.environmentId,
        _organizationId: inp.organizationId,
        _workflowId: node._workflowId,
        workflowName: inp.workflowName,
        _nodeId: node._id,
        _providerId: null,
        providerName: 'Webhook',
        payload: node.data,
        channel: null,
        code: 'TASK-' + makeid(8),
        name: 'Webhook',
        type: node.type,
        status: TaskStatus.in_process,
        priority: 'medium',
        email: inp.target.email,
      });

      const dataSend: IWebhookData = {
        _workflowId: inp.workflowId,
        _userId: inp.userId,
        requestData: inp,
        taskId: task._id,
      };

      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const _this = this;
      try {
        this.httpService
          .request({
            method: node.data.method,
            url: node.data.webhookUrl,
            data: node.data.method === 'get' ? null : dataSend,
            headers: {
              'Content-Type': 'application/json',
            },
            params: node.data.method === 'get' ? dataSend : null,
            validateStatus: null,
          })
          .toPromise()
          .then((response) => {
            _this.taskRepository.updateStatus(
              task._id,
              response.status < 300 && response.status >= 200
                ? TaskStatus.done
                : TaskStatus.cancel,
              null,
              response.data,
            );
          });
      } catch (e) {
        await this.taskRepository.updateStatus(
          task._id,
          TaskStatus.cancel,
          e,
          null,
        );
      }
    }
  }

  private async executeSms(
    provider: IProvider,
    node: INodeEntity,
    inp: INextJob,
    members: IMember[],
    variables: IVariable[],
    overrides: Record<string, any> = {},
  ) {
    if (!provider) return;
    // * validate sms
    const content: IContent = get(node.data, 'content');
    const phone = overrides.to || inp.target.phone;

    if (!content)
      throw new PreconditionFailedException('Content sms provider is required');
    if (!phone)
      throw new PreconditionFailedException(
        'Target phone number of sms provider is required',
      );
    let contentPlainText = overrides.content || content.plainText;
    contentPlainText = transformContent(variables, contentPlainText, {
      ...inp.target,
      ...inp.overrides,
    });

    const task = await this.taskRepository.create({
      _userId: inp.userId,
      _environmentId: inp.environmentId,
      _organizationId: inp.organizationId,
      _workflowId: node._workflowId,
      workflowName: inp.workflowName,
      _nodeId: node._id,
      _providerId: null,
      providerName: provider.name,
      payload: node.data,
      channel: null,
      code: 'TASK-' + makeid(8),
      name: provider.name,
      type: node.type,
      status: TaskStatus.in_process,
      priority: 'medium',
      email: inp.target.email,
      phone: inp.target.phone,
    });
    try {
      const identifier = uuidv4();
      const overrides = inp.overrides ?? {};

      const smsFactory = new SmsFactory();
      const smsHandler = smsFactory.getHandler(
        this.buildFactoryIntegration(provider),
      );
      if (!smsHandler) {
        throw new PlatformException(
          `Sms handler for provider ${provider.providerId} is  not found`,
        );
      }

      const result = await smsHandler.send({
        to: phone,
        from: overrides.from || provider.credentials.from,
        content: contentPlainText,
        id: identifier,
        customData: overrides.customData || {},
      });

      if (!result?.id) {
        return;
      }

      await this.taskRepository.updateStatus(
        task._id,
        TaskStatus.done,
        null,
        undefined,
      );
    } catch (e) {
      // await this.sendErrorStatus(
      //   message,
      //   'error',
      //   'unexpected_sms_error',
      //   e.message || e.name || 'Un-expect SMS provider error',
      //   command,
      //   LogCodeEnum.SMS_ERROR,
      //   e,
      // );

      this.logger.error(e);
      await this.taskRepository.updateStatus(
        task._id,
        TaskStatus.cancel,
        e.toString(),
        undefined,
      );
    }
  }

  private async executeChatMessage(
    provider: IProvider,
    node: INodeEntity,
    inp: INextJob,
    members: IMember[],
    variables: IVariable[],
    overrides: Record<string, any> = {},
  ) {
    try {
      if (!provider) return;
      // * validate sms
      const content: IContent = get(node.data, 'content');
      const phone = overrides.to || inp.target.phone;

      if (!content)
        throw new PreconditionFailedException(
          'Content sms provider is required',
        );
      if (!phone)
        throw new PreconditionFailedException(
          'Target phone number of sms provider is required',
        );
      let contentPlainText = overrides.content || content.plainText;
      contentPlainText = transformContent(variables, contentPlainText, {
        ...inp.target,
        ...inp.overrides,
      });

      const task = await this.taskRepository.create({
        _userId: inp.userId,
        _environmentId: inp.environmentId,
        _organizationId: inp.organizationId,
        _workflowId: node._workflowId,
        workflowName: inp.workflowName,
        _nodeId: node._id,
        _providerId: null,
        providerName: provider.name,
        payload: node.data,
        channel: null,
        code: 'TASK-' + makeid(8),
        name: provider.name,
        type: node.type,
        status: TaskStatus.in_process,
        priority: 'medium',
        email: inp.target.email,
        phone: inp.target.phone,
      });
      try {
        const overrides = inp.overrides ?? {};
        const plainProvider = this.buildFactoryIntegration(provider);

        const chatFactory = new ChatFactory();
        const chatHandler = chatFactory.getHandler(plainProvider);
        if (!chatHandler) {
          throw new PlatformException(
            `Chat message handler for provider ${provider.providerId} is  not found`,
          );
        }

        const chatWebhookUrl =
          overrides?.baseUrl || provider.credentials?.baseUrl;

        const result = await chatHandler.send({
          webhookUrl: chatWebhookUrl,
          channel: plainProvider.credentials?.channel,
          content: contentPlainText,
          chatId: plainProvider.credentials.chatId,
          token: plainProvider.credentials.token,
          baseUrl: plainProvider.credentials.baseUrl,
          testEnvironment: plainProvider.credentials.testEnvironment,
        });
        // TODO setup properties of chat sender

        if (!result?.id) {
          return;
        }

        await this.taskRepository.updateStatus(
          task._id,
          TaskStatus.done,
          null,
          undefined,
        );
      } catch (e) {
        // await this.sendErrorStatus(
        //   message,
        //   'error',
        //   'unexpected_sms_error',
        //   e.message || e.name || 'Un-expect SMS provider error',
        //   command,
        //   LogCodeEnum.SMS_ERROR,
        //   e,
        // );

        this.logger.error(e);
        await this.taskRepository.updateStatus(
          task._id,
          TaskStatus.cancel,
          e.toString(),
          undefined,
        );
      }
    } catch (e) {
      this.logger.debug(e);
    }
  }

  private async executeEmail(
    provider: IProvider,
    node: INodeEntity,
    inp: INextJob,
    members: IMember[],
    variables: IVariable[],
  ) {
    if (!provider) {
      this.logger.error('Error missing providerId in node');
      return;
    }
    const mailFactory = new MailFactory();
    const data: INodeData = node.data;
    if (data.sender && data.subject && data.designHtml) {
      const mailHandler = mailFactory.getHandler(
        this.buildFactoryIntegration(provider),
        data.sender,
      );

      try {
        const task = await this.taskRepository.create({
          _userId: inp.userId,
          _environmentId: inp.environmentId,
          _organizationId: inp.organizationId,
          _workflowId: node._workflowId,
          workflowName: inp.workflowName,
          _nodeId: node._id,
          _providerId: provider._id,
          providerName: provider.name,
          payload: data,
          channel: provider.channel,
          code: 'TASK-' + makeid(8),
          name: provider.name,
          type: node.type,
          status: TaskStatus.in_process,
          priority: 'medium',
          email: inp.target.email,
        });
        try {
          const html = transformContent(variables, data.designHtml, {
            ...inp.target,
            ...inp.overrides,
          });
          const result = await mailHandler.send({
            from: data.sender,
            to: [inp.target.email],
            html: html,
            subject: data.subject,
          });
          if (!result?.id) {
            throw new BadRequestException(
              'Error when send email. Check log task id: ' + task._id,
            );
          }
          await this.taskRepository.updateStatus(
            task._id,
            TaskStatus.done,
            null,
            undefined,
          );

          await this.sender.sendAny<CreateNotiDto>(
            process.env.KAFKA_NOTIFICATION_TASK_TOPIC,
            {
              userId: inp.userId,
              environmentId: provider._environmentId,
              organizationId: inp.organizationId,
              title: 'Trigger execute 2',
              description: 'Trigger execute',
            },
          );
        } catch (e) {
          this.logger.error(e);
          await this.taskRepository.updateStatus(
            task._id,
            TaskStatus.cancel,
            e.toString(),
            undefined,
          );
        }

        this.logger.verbose('Email message has been sent');
        // * send websocket
        await this.nextJob(
          inp.workflowId,
          inp.workflowName,
          inp.organizationId,
          inp.environmentId,
          inp.target,
          inp.overrides,
          inp.userId,
          node.type,
          node._id,
        );
      } catch (error) {
        // * send websocket error
        // TODO save log error
        // TODO update task status
        console.log(error);

        return;
      }
    } else {
      this.logger.error('Missing sender, subject, content of mail');
    }
  }

  public buildFactoryIntegration(integration: IProvider) {
    return {
      ...integration,
      credentials: {
        ...decryptCredentials(integration.credentials),
      },
      providerId: integration.providerId,
    };
  }
}
