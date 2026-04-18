# tianzhiling_node

## QuickStart

This service uses Midway + Koa + TypeORM (MongoDB).

### Development

```bash
$ npm i
$ cp .env.example .env
$ npm run dev
$ open http://localhost:7001/api/system/health
```

### Deploy

```bash
$ npm start
```

### npm scripts

- Use `npm run lint` to check code style.
- Use `npm test` to run unit test.

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
