# Docker Deployment

This setup runs:
- `db`: Postgres 15
- `backend`: FastAPI + Alembic + optional demo-data bootstrap
- `frontend`: Vite build served by nginx

## Ports

The compose file uses the old `ultra_demo` frontend port:
- `8082 -> frontend nginx :80`

The backend and database stay internal to Docker by default, which avoids host-port conflicts on a busy server.

## Files

- [docker-compose.yml](/Users/shubhambharambe/Desktop/quick_fix/Ultra/docker-compose.yml)
- [backend/Dockerfile](/Users/shubhambharambe/Desktop/quick_fix/Ultra/backend/Dockerfile)
- [backend/docker/entrypoint.sh](/Users/shubhambharambe/Desktop/quick_fix/Ultra/backend/docker/entrypoint.sh)
- [backend/docker/bootstrap.py](/Users/shubhambharambe/Desktop/quick_fix/Ultra/backend/docker/bootstrap.py)
- [frontend/Dockerfile](/Users/shubhambharambe/Desktop/quick_fix/Ultra/frontend/Dockerfile)
- [frontend/nginx.conf](/Users/shubhambharambe/Desktop/quick_fix/Ultra/frontend/nginx.conf)
- [.env.docker.example](/Users/shubhambharambe/Desktop/quick_fix/Ultra/.env.docker.example)

## Demo data bootstrap

On backend startup:
1. waits for Postgres
2. runs Alembic migrations
3. creates a superuser if `users` is empty
4. seeds demo data if business tables are empty

The demo seed is skipped automatically if contractor / part master / work order / invoice data already exists.

## Server usage

1. Copy `.env.docker.example` to `.env.docker`
2. Adjust secrets and DB password
3. Start:

```bash
docker compose --env-file .env.docker up -d --build
```

4. Open:

```text
http://SERVER_IP:8082
```

## Notes

- Frontend API calls are built against `/api`, and nginx rewrites `/api/*` to the backend.
- Uploads are proxied from `/uploads/*` to the backend container.
- Swagger is available through the frontend container at `/docs`.
