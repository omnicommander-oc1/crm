# OCRM — Frappe CRM self-host (omnicommander-oc1/crm fork)

This fork carries the Frappe CRM app source plus the CI that builds our custom
image and deploys it to the SaaSDev Docker host. Infra lives in `oc-live-infra`
(`430611422514-SaaSDev/us-west-2/{rds-ocrm-mariadb,ec2-ocrm}`).

## CI/CD

`.github/workflows/build-deploy.yml` (manual dispatch or `v*` tag):
1. Assumes `github-backend-role` via OIDC.
2. Builds the custom image (frappe `version-15` + this fork's `crm`) using
   `frappe_docker`'s `images/custom/Containerfile` and `apps.json`.
3. Pushes `…/ocrm:dev-latest` to ECR.
4. SSM `SendCommand` → `/opt/ocrm/compose.sh pull && up -d` on the `Service=ocrm`
   EC2 instance.

Pin `FRAPPE_BRANCH` / `CRM_BRANCH` to release tags before relying on this for
anything beyond dev.

## One-time site creation (WS-4)

After the first image is in ECR and `ec2-ocrm` is up, create the site once via
Session Manager (SSM) on the instance. Pull the MariaDB master creds from
Secrets Manager (`ocrm-mariadb-dev`) and run inside the backend container:

```bash
# on the EC2 host, via: aws ssm start-session --target <instance-id>
DB_HOST=$(grep '^DB_HOST=' /opt/ocrm/.env | cut -d= -f2)
# fetch master creds (the instance role can read the secret)
SECRET=$(aws secretsmanager get-secret-value --secret-id ocrm-mariadb-dev \
  --query SecretString --output text --region us-west-2)
DB_USER=$(echo "$SECRET" | python3 -c 'import sys,json;print(json.load(sys.stdin)["username"])')
DB_PASS=$(echo "$SECRET" | python3 -c 'import sys,json;print(json.load(sys.stdin)["password"])')

cd /opt/ocrm/frappe_docker
docker compose --project-name ocrm --env-file /opt/ocrm/.env \
  -f compose.yaml -f overrides/compose.redis.yaml \
  exec backend \
  bench new-site dev-ocrm.omnicommando.com \
    --db-host "$DB_HOST" --db-port 3306 \
    --db-root-username "$DB_USER" --db-root-password "$DB_PASS" \
    --no-mariadb-socket \
    --admin-password '<choose-strong-admin-pw>' \
    --install-app crm

# make it the default site so the frontend serves it
docker compose --project-name ocrm --env-file /opt/ocrm/.env \
  -f compose.yaml -f overrides/compose.redis.yaml \
  exec backend bench use dev-ocrm.omnicommando.com
```

> ⚠ RDS gotcha: `--db-root-username` is the **RDS master user** (not literal
> `root`). `--no-mariadb-socket` forces host `%` so the per-site DB user works
> over TCP. If RDS rejects the privileged grants, fall back to running MariaDB
> as a local container on the EBS volume.

## Day-2

- Redeploy: re-run the workflow (or `/opt/ocrm/compose.sh pull && up -d`).
- Logs/status over SSM: `/opt/ocrm/compose.sh ps`, `/opt/ocrm/compose.sh logs -f <svc>`.
- DNS: `dev-ocrm.omnicommando.com` is an A-alias to `public-lb` (created out of band).
