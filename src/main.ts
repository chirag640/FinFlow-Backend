import { config as dotenvConfig } from "dotenv";
import { join } from "path";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import * as cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import {
  idempotencyMiddleware,
  requestContextMiddleware,
} from "./common/middleware/request-context.middleware";

// Load .env using __dirname — works regardless of process CWD
dotenvConfig({ path: join(__dirname, "..", ".env") });

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn", "log"],
  });

  // Security
  app.use(helmet());
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  app.use(idempotencyMiddleware);

  // CORS — allow Flutter web + mobile dev proxy
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? ["http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Idempotency-Key",
      "X-Request-Id",
    ],
  });

  // Global prefix + URI versioning  →  /api/v1/...
  app.setGlobalPrefix("api");
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger  →  /api/docs  (dev only — not exposed in production)
  if (process.env.NODE_ENV !== "production") {
    const config = new DocumentBuilder()
      .setTitle("FinFlow API")
      .setDescription("FinFlow — Your All-in-One Financial OS")
      .setVersion("1.0")
      .addBearerAuth(
        { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        "access-token",
      )
      .build();
    const doc = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, doc, {
      swaggerOptions: { persistAuthorization: true },
    });
    console.log(
      `📚  Swagger      →  http://localhost:${process.env.PORT ?? 3000}/api/docs`,
    );
  }

  // Enable graceful shutdown — triggers OnModuleDestroy (e.g. DB close) on SIGTERM
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  // Listen on all interfaces so Docker port-mapping works
  await app.listen(port, "0.0.0.0");
  console.log(`🚀  FinFlow API  →  http://localhost:${port}/api/v1`);
}

bootstrap();
