import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { TaskModule } from './task/task.module';
import { TerminusModule } from '@nestjs/terminus';
import { DbService } from '@libs/repositories/DbService';

export const dbService = {
  provide: DbService,
  useFactory: async () => {
    const service = new DbService();
    await service.connect(String(process.env.MONGO_URL));

    return service;
  },
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TerminusModule,
    TaskModule,
  ],
  providers: [AppService, dbService],
  exports: [dbService],
})
export class AppModule {}
