import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  PreconditionFailedException,
} from '@nestjs/common';
import { KafkaMessage } from 'kafkajs';
import { HttpService } from '@nestjs/axios';
import { get } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { ProducerService } from '@app/kafka/producer/producer.service';
import { NodeRepository } from '@libs/repositories/node';
import { EdgeRepository } from '@libs/repositories/edge';
import { TaskRepository } from '@libs/repositories/task';
import { ProviderRepository } from '@libs/repositories/provider';
import { MemberRepository } from '@libs/repositories/member';
import { VariableRepository } from '@libs/repositories/variable';
import {
  ChannelTypeEnum,
  CreateNotiDto,
  decryptCredentials,
  EventTypes,
  IContent,
  IEventQueue,
  IMember,
  INextJob,
  INodeData,
  INodeEntity,
  IProvider,
  ISendMessageSuccessResponse,
  ITaskTimeline,
  IVariable,
  IWebhookData,
  makeid,
  PlatformException,
  TaskStatus,
  transformContent,
  WfNodeType,
} from '@wolfxlabs/stateless';
import { TaskTimelineRepository } from '@libs/repositories/task-timeline';
import { ChatFactory, MailFactory, SmsFactory } from '@wolfxlabs/providers';
import * as process from 'process';
import { ConsumerService } from '@app/kafka/consumer/consumer.service';

@Injectable()
export class TaskService implements OnModuleInit {
  private logger = new Logger('TaskService');
  private readonly topicTaskTimeline: string;

  constructor(
    private readonly sender: ProducerService,
    private readonly consumerService: ConsumerService,
    private readonly nodeRepository: NodeRepository,
    private readonly edgeRepository: EdgeRepository,
    private readonly taskRepository: TaskRepository,
    private readonly providerRepository: ProviderRepository,
    private readonly memberRepository: MemberRepository,
    private readonly variableRepository: VariableRepository,
    private readonly taskTimelineRepository: TaskTimelineRepository,
    private readonly httpService: HttpService,
  ) {
    this.topicTaskTimeline = process.env.KAFKA_LOG_TASK_TIMELINE;
  }

  async onModuleInit() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const nextTopicDelay = `${process.env.KAFKA_PREFIX_JOB_TOPIC}.delay`;
    await this.consumerService.consume(
      {
        topics: [
          process.env.KAFKA_NEXT_JOB_TOPIC,
          process.env.KAFKA_LOG_TASK_TIMELINE,
          nextTopicDelay,
        ],
      },
      {
        eachBatchAutoResolve: true,
        eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
          for (const message of batch.messages) {
            const topic = batch.topic,
              partition = batch.partition;
            if (topic === process.env.KAFKA_NEXT_JOB_TOPIC) {
              this.exeNextJob({
                topic,
                partition,
                message,
              }).then(() => {});
            } else if (topic === nextTopicDelay) {
              const data: INextJob = JSON.parse(message.value.toString());
              if (data.workflowId && data.organizationId) {
                this.nextJob({
                  workflowId: data.workflowId,
                  workflowName: data.workflowName,
                  orgId: data.organizationId,
                  envId: data.environmentId,
                  target: data.target,
                  overrides: data.overrides,
                  userId: data.userId,
                  type: 'delay',
                  previousNodeId: data.currentNodeId,
                  transactionId: data.transactionId,
                }).then(() => {});
              }
            } else if (topic === process.env.KAFKA_LOG_TASK_TIMELINE) {
              this.saveTaskTimeline(message).then(() => {});
            }

            resolveOffset(message.offset);
            await heartbeat();
          }
        },
        autoCommitInterval: 500,
      },
    );
  }

  async saveTaskTimeline(message: KafkaMessage) {
    const strData = message.value.toString();

    const data: IEventQueue<ITaskTimeline> = JSON.parse(strData);

    await this.taskTimelineRepository.create({
      event: data.type,
      createdAt: data.createdAt,
      ...data.data,
    });
  }

  async nextJob({
    workflowId,
    workflowName,
    orgId,
    envId,
    target,
    overrides,
    userId,
    type,
    previousNodeId,
    transactionId,
  }: any) {
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
          transactionId: transactionId,
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
        await this.markCancelTask(task._id, inp.userId, inp.workflowId);
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
      transactionId: inp.transactionId,
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

      const result: ISendMessageSuccessResponse = await smsHandler.send({
        to: phone,
        from: overrides.from || provider.credentials.from,
        content: contentPlainText,
        id: identifier,
        customData: overrides.customData || {},
      });

      if (!result?.id) {
        await this.markCancelTask(task._id, inp.userId, inp.workflowId);
        return;
      }

      await this.markDoneTask(task._id, inp.userId, inp.workflowId);
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
      await this.markCancelTask(task._id, inp.userId, inp.workflowId);
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
        transactionId: inp.transactionId,
      });
      try {
        // const identifier = uuidv4();
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

        const result: ISendMessageSuccessResponse = await chatHandler.send({
          webhookUrl: chatWebhookUrl,
          channel: plainProvider.credentials?.channel,
          content: contentPlainText,
          chatId: plainProvider.credentials.chatId,
          token: plainProvider.credentials.token,
          baseUrl: plainProvider.credentials.baseUrl,
          testEnvironment: plainProvider.credentials.testEnvironment,
        });

        if (!result?.id) {
          await this.markCancelTask(task._id, inp.userId, inp.workflowId);
          return;
        }

        await this.markDoneTask(task._id, inp.userId, inp.workflowId);
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
        await this.markCancelTask(task._id, inp.userId, inp.workflowId);
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
          transactionId: inp.transactionId,
        });
        this.sendLogTaskTimeline(
          EventTypes['message.in_process'],
          inp.userId,
          task._id,
          inp.workflowId,
        );
        try {
          const html = transformContent(variables, data.designHtml, {
            ...inp.target,
            ...inp.overrides,
          });
          // const script = `<img src="http://localhost:5000/wolf/v1/events/email/tracking/${task._id}?type=message.link_clicked&tx_id=${task.transactionId}" alt="" style="display:none;"></img>`;
          // html = html.replace(/(<\s*\/\s*table)/, `${script}\n$1`);

          const result = await mailHandler.send({
            from: data.sender,
            to: [inp.target.email],
            html: html,
            subject: data.subject,
          });
          if (!result?.id) {
            await this.markCancelTask(task._id, inp.userId, inp.workflowId);
            throw new BadRequestException(
              'Error when send email. Check log task id: ' + task._id,
            );
          }
          await this.markDoneTask(task._id, inp.userId, inp.workflowId);

          this.sender.sendAny<CreateNotiDto>(
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
          await this.markCancelTask(task._id, inp.userId, inp.workflowId);
        }

        this.logger.verbose('Email message has been sent');
        // * send websocket
        await this.nextJob({
          workflowId: inp.workflowId,
          workflowName: inp.workflowName,
          orgId: inp.organizationId,
          envId: inp.environmentId,
          target: inp.target,
          overrides: inp.overrides,
          userId: inp.userId,
          type: node.type,
          previousNodeId: node._id,
          transactionId: inp.transactionId,
        });
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

  public buildFactoryIntegration(integration: IProvider): IProvider {
    return {
      ...integration,
      credentials: {
        ...decryptCredentials(integration.credentials),
      },
      providerId: integration.providerId,
    };
  }

  private async markDoneTask(
    taskId: string,
    userId: string,
    workflowId: string,
  ) {
    await this.taskRepository.updateStatus(
      taskId,
      TaskStatus.done,
      null,
      undefined,
    );

    this.sendLogTaskTimeline(
      EventTypes['message.done'],
      userId,
      taskId,
      workflowId,
    );
  }

  private async markCancelTask(
    taskId: string,
    userId: string,
    workflowId: string,
  ) {
    await this.taskRepository.updateStatus(
      taskId,
      TaskStatus.cancel,
      null,
      undefined,
    );

    this.sendLogTaskTimeline(
      EventTypes['message.cancel'],
      userId,
      taskId,
      workflowId,
    );
  }

  private sendLogTaskTimeline(
    type: EventTypes,
    userId: string,
    taskId: string,
    workflowId: string,
  ) {
    this.sender.sendEvent<ITaskTimeline>(this.topicTaskTimeline, {
      type: type,
      createdAt: new Date(),
      data: {
        _userId: userId,
        _taskId: taskId,
        _workflowId: workflowId,
        createdBy: userId,
      },
    });
  }
}
