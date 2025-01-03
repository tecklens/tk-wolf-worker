import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';

export default async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get<any>(ConfigService);

  // * cors
  app.use(helmet());

  const port = configService.get('PORT')
    ? parseInt(configService.get('PORT'))
    : 4000;

  await app.listen(port);

  Logger.log(`Starting UserApplication using Nestjs 10.0.0 on port: ${port}`);
  Logger.log('BOOTSTRAPPED SUCCESSFULLY');
}
