# tianzhiling_node

## QuickStart

This service uses Midway + Koa + TypeORM (MongoDB).

### Development

```bash
$ pnpm install
$ cp ../../.env.example ../../.env
$ pnpm run dev
$ open http://localhost:7001/api/system/health
```

### Deploy

```bash
$ pnpm start
```

### pnpm scripts

- Use `pnpm run lint` to check code style.
- Use `pnpm test` to run unit test.

### API convention

- All endpoints live under `/api/...`
- Success response shape:

```json
{
  "success": true,
  "code": "OK",
  "message": "OK",
  "data": {},
  "timestamp": 1710000000000
}
```

- Error response shape:

```json
{
  "success": false,
  "code": "RESOURCE_NOT_FOUND",
  "message": "Requested resource was not found",
  "data": null,
  "timestamp": 1710000000000
}
```

[midway]: https://midwayjs.org
