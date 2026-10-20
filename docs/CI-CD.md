# CI/CD — Verification Network

How a change gets from a pull request to staging, what each workflow checks,
which secrets they need, and how to roll back.

```
pull request ──▶ ci (lint, build, unit, e2e, contracts) + commitlint
merge to main ─▶ ci ─▶ image (build → scan → push to GHCR) ─▶ staging-deploy
tag vX.Y.Z ────▶ release (GitHub release) + image (semver tags)
```

## Workflows

All workflows live in `.github/workflows/`.

### `ci.yml` — every pull request and every push to `main`

Runs are cancelled when a newer commit lands on the same ref.

| Job | What it does |
|---|---|
| `lint` | `npx eslint "{src,test}/**/*.ts" --max-warnings 0` (config in `.eslintrc.json`). The `lint` npm script is not used because it passes `--fix`. |
| `build` | `npx tsc --noEmit -p tsconfig.json` (sources **and** tests), then `npm run build`. |
| `unit` | `npm run test:cov`; publishes a coverage table to the job summary, uploads `coverage/` as an artifact and fails below the thresholds in `package.json`. |
| `e2e` | Starts a `postgres:16-alpine` service container, builds, applies the TypeORM migrations with `npm run migration:run`, then runs `npm run test:e2e`. |
| `contracts` | Checks out the `forge-std` submodule, installs Foundry, runs `forge build --sizes`, `forge test -vvv` and a build with `FOUNDRY_PROFILE=testnet`. |

Details worth knowing:

- **Coverage is a ratchet.** The `coverageThreshold` block in `package.json`
  sits just under the measured numbers (statements 15, branches 14, functions
  13, lines 16 when the gate was added). Raise it when coverage goes up; do not
  lower it to get a red build through.
- **E2E runs against migrations, not `synchronize`.** The job sets
  `NODE_ENV=test`, so the schema is exactly what `src/migrations/` builds. An
  entity change without a migration fails here. `test/setup-env.ts` raises the
  rate limits for the suites, and `test/helpers/csrf.ts` obtains the CSRF token
  that mutating routes require.
- **`testnet-fork.e2e-spec.ts` is skipped** unless `FORK_RPC_URL` and
  `VERDICT_REGISTRY_ADDRESS` are set; CI never talks to a real chain.
- **Contracts job placeholders.** `contracts/foundry.toml` interpolates
  `PROM_TESTNET_*` variables; the job sets harmless placeholders so the config
  resolves without testnet secrets.
- **Caching.** `actions/setup-node` caches `~/.npm` keyed on
  `package-lock.json`; `contracts/out` and `contracts/cache` are cached keyed on
  the Solidity sources and `foundry.toml`.

Run the same checks locally before pushing:

```bash
npx eslint "{src,test}/**/*.ts" --max-warnings 0
npx tsc --noEmit -p tsconfig.json
npm run test:cov
# needs PostgreSQL (docker-compose.dev.yml exposes one on 5433)
NODE_ENV=test DATABASE_PORT=5433 npm run build
NODE_ENV=test DATABASE_PORT=5433 npm run migration:run
NODE_ENV=test DATABASE_PORT=5433 npm run test:e2e
cd contracts && forge test -vvv
```

### `commitlint.yml` — pull requests

Lints every commit of the pull request against `.commitlintrc.json`
(`@commitlint/config-conventional`, header up to 100 characters). Allowed
types: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`,
`revert`, `style`, `test`. Dependabot pull requests are skipped because their
commit bodies carry long changelog links.

### `image.yml` — push to `main`, tags `v*`, manual dispatch

Builds `docker/Dockerfile` (target `runtime`) and publishes it to
`ghcr.io/<owner>/<repo>`.

1. Build into the local daemon as `verification-network:scan`.
2. Trivy scan (`CRITICAL,HIGH`, fixed vulnerabilities only) written as SARIF and
   uploaded to the Security tab. The upload is allowed to fail: it needs GitHub
   Advanced Security, which private mirrors do not have.
3. **Gate:** a second Trivy pass fails the job on any fixable `CRITICAL`
   finding. Nothing is pushed when it fails.
4. Push, reusing the layer cache from step 1.

Tags produced:

| Tag | When | Use |
|---|---|---|
| `sha-<40-char commit>` | every build | immutable; what staging deploys and what rollbacks use |
| `main` / `latest` | builds of `main` | convenience only, never deploy these |
| `X.Y.Z`, `X.Y` | `vX.Y.Z` tags | releases |

The runtime image runs as the unprivileged `node` user under `tini`, contains
production dependencies only, and has npm removed. Its health check reads
`ready` from `GET /health/ready`.

### `staging-deploy.yml` — after `image` succeeds on `main`, or manually

Triggered by `workflow_run` so it never races the image build. It:

1. resolves the tag (`sha-<commit>` of the image run, or the `image_tag` input
   of a manual run);
2. copies `docker-compose.staging.yml` from the deployed commit to the host;
3. runs `docker compose pull` and `up -d --wait` over SSH with `IMAGE_TAG` and
   `IMAGE_REPOSITORY` set, and appends the tag to `deployed-tags.log`;
4. calls `/health` inside the container and fails unless `status` is `ok`.

When the staging secrets are not configured the job logs a notice and exits
successfully without deploying.

`docker-compose.staging.yml` pins every image: PostgreSQL by version, the
service by the mandatory `IMAGE_TAG`. The service starts with
`NODE_ENV=production`, which applies pending migrations at boot.

### `release.yml` — tags `vX.Y.Z`

Validates that the tag is a semantic version and equals the `version` in
`package.json`, then creates a GitHub release with generated notes (marked as a
pre-release for `-rc`-style suffixes). The same tag makes `image.yml` publish
the `X.Y.Z` and `X.Y` image tags.

```bash
npm version minor -m "chore: release v%s"   # bumps package.json, commits, tags
git push origin main --follow-tags
```

### Dependabot

`.github/dependabot.yml` opens weekly pull requests for npm, GitHub Actions and
the Docker base image. NestJS, typescript-eslint, commitlint and OpenTelemetry
packages are grouped; major bumps of NestJS, TypeORM and ESLint are ignored and
done by hand.

## Secrets and variables

The `ci`, `commitlint`, `image` and `release` workflows need nothing beyond the
built-in `GITHUB_TOKEN` (with `packages: write` for `image`, `contents: write`
for `release`).

`staging-deploy` uses the `staging` environment:

| Name | Kind | Purpose |
|---|---|---|
| `STAGING_SSH_HOST` | secret | staging host name or address |
| `STAGING_SSH_USER` | secret | deploy user, member of the `docker` group |
| `STAGING_SSH_KEY` | secret | private key of the deploy user |
| `STAGING_SSH_KNOWN_HOSTS` | secret, recommended | pinned host key line; without it the key is trusted on first use |
| `STAGING_DEPLOY_PATH` | variable, optional | directory on the host, default `/opt/verification-network` |

Application secrets never pass through GitHub. They live on the staging host in
`<deploy path>/.env.staging` (template: `.env.staging.example`):
`POSTGRES_PASSWORD`, `JWT_SECRET`, `CSRF_SECRET`, `BLOCKCHAIN_RPC_URL`,
`BLOCKCHAIN_PRIVATE_KEY` and the four contract addresses from
`docs/TESTNET.md`. Create the file once with mode `600`; the workflow only
supplies the image coordinates.

Protect the `staging` environment with required reviewers if deploys should be
approved by a person.

## Rollback

### Service

Images are immutable per commit, so a rollback is a redeploy of an older tag.

- **From GitHub:** run `staging-deploy` manually (*Actions → staging-deploy →
  Run workflow*) with `image_tag` set to the previous `sha-<commit>`.
- **From the host:**

  ```bash
  cd /opt/verification-network
  tail -n 5 deployed-tags.log        # the line before the last is the previous tag
  IMAGE_REPOSITORY=<owner>/<repo> IMAGE_TAG=sha-<previous commit> \
    docker compose --env-file .env.staging -f docker-compose.staging.yml up -d --wait
  ```

Then revert the offending commit on `main`; otherwise the next merge redeploys
it.

### Database

Migrations run forward automatically at boot and are **not** reverted by
deploying an older image. Older code keeps working as long as a migration only
adds tables or nullable/defaulted columns, which is the rule for this
repository. If a migration has to be undone, stop the service and revert it
explicitly with the image that contains it:

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml stop verification-network
docker compose --env-file .env.staging -f docker-compose.staging.yml run --rm verification-network \
  node node_modules/typeorm/cli.js migration:revert -d dist/config/data-source.js
```

Take a `pg_dump` first; `down` migrations drop the columns and tables they
added.

### Contracts

Contracts are not upgradeable. Rolling back means repointing the service at the
previous deployment addresses in `.env.staging`; see *Rollback* in
`docs/TESTNET.md`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `e2e` fails with `column ... does not exist` | an entity changed without a migration |
| `unit` fails with `coverage threshold ... not met` | new code landed without tests; add tests rather than lowering the threshold |
| `image` fails at *Fail on critical findings* | a fixable critical CVE in the base image or a dependency; bump it (Dependabot usually has a PR open) |
| `commitlint` fails | a commit subject is not `type: description`; reword with `git rebase -i` |
| `staging-deploy` is green but nothing changed | the staging secrets are missing; the summary says "Deploy skipped" |
| `release` fails at *Validate version* | the tag does not match `package.json`; use `npm version` to create it |
