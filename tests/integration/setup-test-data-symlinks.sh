#!/usr/bin/env bash
# Re-apply symlinks so test-data subdirs point to defined_topologies.
# Run from repo root: ./tests/integration/setup-test-data-symlinks.sh
# Or: bash tests/integration/setup-test-data-symlinks.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DATA_DIR="${SCRIPT_DIR}/test-data"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DEFINED="${REPO_ROOT}/defined_topologies"

cd "${TEST_DATA_DIR}"
ln -sf ../../../defined_topologies/CablingDescriptors cabling-descriptors
ln -sf ../../../defined_topologies/CablingGuides cabling-guides
ln -sf ../../../defined_topologies/DeploymentDescriptors deployment-descriptors
echo "Symlinks created: cabling-descriptors, cabling-guides, deployment-descriptors -> defined_topologies/"
