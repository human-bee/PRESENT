# Selected-project work integration

The coordinator should import `handleProjectRequest` from `./projects/routes.js` in `server/index.ts` and, after the existing same-origin/local-request gate, add:

```ts
if (await handleProjectRequest(req, res)) return;
```

Place it before the generic `/api` fallback (next to `handleWorkRequest` is suitable). The route is read-only: `GET /api/projects` returns only `{ id, name, description }` and never a source path.

Configure local projects in the server data directory as `projects.json`:

```json
{
  "projects": [
    {
      "id": "present",
      "name": "PRESENT",
      "description": "Optional short label",
      "directory": "/absolute/path/to/registered/git-repository-root"
    }
  ]
}
```

`directory` stays server-private. Each selected job stores the registered ID plus an immutable committed snapshot identity; the browser sends only `projectId`. Existing work cards retain their project snapshot for every follow-up.
