#!/usr/bin/env bash
# Developer-owned: isolated populated PostgreSQL migration/query-plan rehearsal.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null
run_dir=$(mktemp -d "${TMPDIR:-/tmp}/moda-arch019.XXXXXXXX")
container_name="moda-arch019-$(basename "$run_dir" | tr '[:upper:]' '[:lower:]')"
container_created=false
cleanup() {
  if [[ "$container_created" == true ]]; then docker rm -f "$container_name" >/dev/null; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
exec > >(tee "$run_dir/full.log") 2>&1
printf 'Evidence: %s\nRevision: %s\n' "$run_dir" "$(git rev-parse HEAD)"
git status --short
# No host ports/volumes, no external DATABASE_URL and no existing database touched.
docker run --detach --name "$container_name" --network none \
  -e POSTGRES_PASSWORD=fixture-only -e POSTGRES_DB=arch019_fixture postgres:16 >/dev/null
container_created=true
ready=false
for ((attempt=0; attempt<60; attempt++)); do
  if docker exec "$container_name" pg_isready -U postgres -d arch019_fixture >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || { echo 'Fixture PostgreSQL did not become ready'; exit 1; }
docker image inspect postgres:16 --format '{{json .RepoDigests}}'
psql_fixture() { docker exec -i "$container_name" psql -X -U postgres -d arch019_fixture -v ON_ERROR_STOP=1 "$@"; }
psql_fixture -c 'SELECT version();'
migration='prisma/migrations/20260920120000_arch019_merchant_recovery_read_indexes/migration.sql'
found=false
for previous in prisma/migrations/*/migration.sql; do
  if [[ "$previous" == "$migration" ]]; then found=true; break; fi
  printf 'Apply prerequisite %s\n' "$previous"
  psql_fixture < "$previous"
done
[[ "$found" == true ]] || { echo 'Target migration not found'; exit 1; }
psql_fixture < scripts/fixtures/arch019-recovery-indexes-seed.sql
echo 'BEFORE migration: EXPLAIN (ANALYZE, BUFFERS)'
psql_fixture < scripts/fixtures/arch019-recovery-indexes-plans.sql
echo 'Apply ARCH-019 migration to populated tables'
psql_fixture --single-transaction < "$migration"
psql_fixture < scripts/fixtures/arch019-recovery-indexes-assert.sql
echo 'AFTER migration: EXPLAIN (ANALYZE, BUFFERS), default planner settings'
psql_fixture < scripts/fixtures/arch019-recovery-indexes-plans.sql
echo 'PASS: populated migration/data preservation and query plans recorded. exit=0'
