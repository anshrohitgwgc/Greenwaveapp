# Environment Variables Reference

| Variable | Scope | Description | Development Default |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | API / Web | Execution environment (`development`, `production`, `test`) | `development` |
| `PORT` | API | HTTP listening port | `3000` |
| `DB_HOST` | API | PostgreSQL host | `localhost` (Docker: `postgres`) |
| `DB_PORT` | API | PostgreSQL port | `5432` |
| `DB_USERNAME` | API | PostgreSQL database user | `greenwave_dev` |
| `DB_PASSWORD` | API | PostgreSQL user password | `localdevpass123` |
| `DB_DATABASE` | API | PostgreSQL database name | `greenwave_dev` |
| `REDIS_HOST` | API | Redis host | `localhost` (Docker: `redis`) |
| `REDIS_PORT` | API | Redis port | `6379` |
| `MINIO_ENDPOINT` | API | MinIO S3 host | `localhost` (Docker: `minio`) |
| `MINIO_PORT` | API | MinIO S3 port | `9000` |
| `MINIO_USE_SSL` | API | Enable HTTPS for S3 | `false` |
| `MINIO_ACCESS_KEY` | API | MinIO Access Key | `minioadmin` |
| `MINIO_SECRET_KEY` | API | MinIO Secret Key | `minioadmin123` |
| `MINIO_BUCKET_NAME`| API | Default S3 bucket | `greenwave-photos` |
| `JWT_SECRET` | API | Secret for signing JWT access tokens | `local-dev-jwt-secret-do-not-use-in-prod` |
| `JWT_EXPIRATION` | API | JWT token lifetime | `86400s` |
| `VITE_API_URL` | Web | Backend API base URL for frontend | `http://localhost:3000` |
| `EXPO_PUBLIC_API_URL`| Mobile | Backend API base URL for mobile app | `http://localhost:3000` |
