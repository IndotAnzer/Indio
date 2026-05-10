# api-enhanced Cloud Run

Use this folder when WeChat Cloud Run asks for a source folder with a Dockerfile.

Before uploading, prepare the local api-enhanced source:

```bash
npm run prepare:api-enhanced-cloudrun
```

If your api-enhanced checkout is not at `/Users/indot/api-enhanced`, run:

```bash
NETEASE_API_ENHANCED_DIR=/path/to/api-enhanced npm run prepare:api-enhanced-cloudrun
```

The command copies source files into `source/` and excludes `.git`, `node_modules`, tests, examples, and local env files. The Docker build no longer clones GitHub, so Cloud Run startup/build is faster and less dependent on GitHub availability.

Service name:

```text
netease-api
```

Port:

```text
3000
```

Environment variables:

```bash
NODE_ENV=production
ENABLE_GENERAL_UNBLOCK=true
```

If upstream certificate verification fails, add:

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0
```
