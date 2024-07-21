import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TaskModule } from './task/task.module';
import { TerminusModule } from '@nestjs/terminus';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TerminusModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URL'),
        maxPoolSize: configService.get<number>('MONGO_MAX_POOL_SIZE'),
        minPoolSize: configService.get<number>('MONGO_MIN_POOL_SIZE'),
      }),
      inject: [ConfigService],
    }),
    TaskModule,
  ],
  providers: [AppService],
})
export class AppModule {}
