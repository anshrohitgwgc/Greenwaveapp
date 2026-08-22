# High-Availability & Failover Verification Scenarios

## Scenario 1: NGINX Upstream Node Outage
- **Action**: Stop `api-1` container or host.
- **Expected Outcome**: Ingress load balancer automatically detects node failure via `max_fails=3 fail_timeout=10s` and redirects all HTTP traffic seamlessly to `api-2` without dropping client requests (HTTP 200).

## Scenario 2: Redis Broker Network Blip
- **Action**: Pause Redis container for 5 seconds.
- **Expected Outcome**: NestJS API triggers automatic reconnect with exponential backoff; requests requiring cache gracefully fall back to direct PostgreSQL queries.

## Scenario 3: MinIO S3 Temporary Unavailability
- **Action**: Simulate MinIO timeout.
- **Expected Outcome**: Photo upload endpoint returns structured `503 Service Unavailable` with clean diagnostic detail without exposing S3 access keys or crashing the server.
