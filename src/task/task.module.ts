import { Module } from '@nestjs/common';
import { KafkaModule } from '@app/kafka/kafka.module';
import { HttpModule } from '@nestjs/axios';
import { TaskService } from '@app/task/task.service';
import { NodeRepository } from '@libs/repositories/node/node.repository';
import { EdgeRepository } from '@libs/repositories/edge/edge.repository';
import { TaskRepository } from '@libs/repositories/task/task.repository';
import { ProviderRepository } from '@libs/repositories/provider';
import { MemberRepository } from '@libs/repositories/member';
import { VariableRepository } from '@libs/repositories/variable';

@Module({
  imports: [
    KafkaModule,
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 2,
    }),
  ],
  providers: [
    TaskService,
    NodeRepository,
    EdgeRepository,
    TaskRepository,
    ProviderRepository,
    MemberRepository,
    VariableRepository,
  ],
})
export class TaskModule {}
