import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import * as process from 'process';

export default async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const configService = app.get<string>(ConfigService);

  // * cors
  app.use(helmet());

  console.log(process.env.PORT, "process.env.PORT");

  const port = process.env.PORT ?? 4000;

  await app.listen(3000);

  Logger.log(`Starting UserApplication using Nestjs 10.0.0 on port: ${port}`);
  Logger.log('BOOTSTRAPPED SUCCESSFULLY');
}
