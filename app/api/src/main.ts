import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';

import { AppModule } from './app.module';

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (
    isProduction &&
    (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('dev'))
  ) {
    throw new Error(
      'JWT_SECRET must be set to a real secret in production (refusing to boot with a dev/default value)',
    );
  }

  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`GreenWave API listening on port ${port}`, 'Bootstrap');
}

void bootstrap();
