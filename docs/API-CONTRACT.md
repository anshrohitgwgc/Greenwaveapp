# API Specification & Contracts

## Base URL
- **Local Development**: `http://localhost:3000/api`
- **Production API**: `https://api.gwgcservers.ca/api`

---

## 1. Authentication Endpoints

### `POST /auth/login`
Authenticates an application user and returns a signed JWT access token.

- **Request Body**:
```json
{
  "email": "driver@greenwave.local",
  "password": "Password123!"
}
```

- **Response (200 OK)**:
```json
{
  "access_token": "eyJhbGciOi...",
  "user": {
    "id": 4,
    "fullName": "Fleet Driver",
    "email": "driver@greenwave.local",
    "role": "driver"
  }
}
```

- **Error Responses**:
  - `401 Unauthorized`: `{"message": "Invalid credentials"}`
  - `400 Bad Request`: `{"message": "Email and password are required"}`

---

## 2. User Management Endpoints

### `GET /users/me`
- **Headers**: `Authorization: Bearer <token>`
- **Response (200 OK)**: Current user profile object.

---

## 3. Pickup Logistics Endpoints

### `GET /pickups`
- **Headers**: `Authorization: Bearer <token>`
- **Query Params**: `status` (optional), `limit` (default 50), `page` (default 1)
- **Response (200 OK)**:
```json
[
  {
    "id": 1,
    "userId": 3,
    "address": "123 Ocean View Ave, Vancouver, BC",
    "status": "pending",
    "wasteType": "electronics",
    "estimatedWeightKg": 45.0,
    "assignedDriverId": null,
    "scheduledDate": "2026-08-23T10:00:00.000Z"
  }
]
```

### `POST /pickups`
- **Headers**: `Authorization: Bearer <token>`
- **Request Body**:
```json
{
  "address": "789 Broadway St, Vancouver, BC",
  "wasteType": "commercial-plastics",
  "estimatedWeightKg": 150.0,
  "scheduledDate": "2026-08-24T14:00:00.000Z"
}
```

---

## 4. Media & Photo Storage Endpoints

### `POST /storage/upload`
Uploads a photo for a pickup job to MinIO S3 object storage.
- **Headers**: `Authorization: Bearer <token>`, `Content-Type: multipart/form-data`
- **Form Data**: `file: <binary>`, `pickupId: 1`
- **Response (201 Created)**:
```json
{
  "id": 1,
  "objectKey": "pickups/1/photo_uuid.jpg",
  "bucketName": "greenwave-photos",
  "url": "https://storage.gwgcservers.ca/greenwave-photos/pickups/1/photo_uuid.jpg"
}
```

---

## 5. Health & Diagnostic Endpoints

### `GET /health`
Public liveness and readiness probe.
- **Response (200 OK)**:
```json
{
  "status": "ok"
}
```
