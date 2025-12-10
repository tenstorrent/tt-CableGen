# TenstorrentCableGen Docker Compose Management

.PHONY: help build up down logs shell clean restart status
.PHONY: build-local up-local down-local logs-local shell-local clean-local restart-local status-local
.PHONY: up-local-dev down-local-dev logs-local-dev shell-local-dev restart-local-dev status-local-dev

# Default target
help:
	@echo "CableGen Docker Compose Management"
	@echo ""
	@echo "Production targets (with OAuth2 authentication):"
	@echo "  build       - Build all Docker images"
	@echo "  up          - Start all services (with OAuth2)"
	@echo "  down        - Stop all services"
	@echo "  logs        - Show logs from all services"
	@echo "  shell       - Open shell in cablegen container"
	@echo "  nginx-shell - Open shell in nginx container"
	@echo "  oauth-shell - Open shell in oauth2-proxy container"
	@echo "  clean       - Remove containers, networks, and volumes"
	@echo "  restart     - Restart all services"
	@echo "  status      - Show status of all services"
	@echo ""
	@echo "Local development targets (no authentication):"
	@echo "  build-local - Build Docker images for local development"
	@echo "  up-local    - Start services without OAuth2 (localhost only)"
	@echo "  down-local  - Stop local services"
	@echo "  logs-local  - Show logs from local services"
	@echo "  shell-local - Open shell in local cablegen container"
	@echo "  clean-local - Remove local containers and volumes"
	@echo "  restart-local - Restart local services"
	@echo "  status-local - Show status of local services"
	@echo ""
	@echo "Local development with volume mounts (live code reload):"
	@echo "  up-local-dev    - Start services with volume mounts for live development"
	@echo "  down-local-dev  - Stop local dev services"
	@echo "  logs-local-dev  - Show logs from local dev services"
	@echo "  shell-local-dev - Open shell in local dev cablegen container"
	@echo "  restart-local-dev - Restart local dev services"
	@echo "  status-local-dev - Show status of local dev services"
	@echo ""
	@echo "Setup:"
	@echo "  setup       - Copy env.example to .env if it doesn't exist"

# Build all images
build:
	docker compose build

# Start all services
up:
	docker compose up -d

# Stop all services
down:
	docker compose down

# Show logs
logs:
	docker compose logs -f

# Open shell in cablegen container
shell:
	docker compose exec cablegen /bin/bash

# Open shell in nginx container
nginx-shell:
	docker compose exec nginx /bin/bash

# Open shell in oauth2-proxy container
oauth-shell:
	docker compose exec oauth2-proxy /bin/sh

# Clean up everything
clean:
	docker compose down -v --remove-orphans
	docker system prune -f

# Restart services
restart: down up

# Show service status
status:
	docker compose ps

# ============================================================================
# Local Development Targets (no authentication)
# ============================================================================

# Build local images
build-local:
	docker compose -f docker-compose.local.yml build

# Start local services
up-local:
	docker compose -f docker-compose.local.yml up -d

# Stop local services
down-local:
	docker compose -f docker-compose.local.yml down

# Show local logs
logs-local:
	docker compose -f docker-compose.local.yml logs -f

# Open shell in local cablegen container
shell-local:
	docker compose -f docker-compose.local.yml exec cablegen /bin/bash

# Clean up local environment
clean-local:
	docker compose -f docker-compose.local.yml down -v --remove-orphans
	docker system prune -f

# Restart local services
restart-local: down-local up-local

# Show local service status
status-local:
	docker compose -f docker-compose.local.yml ps

# ============================================================================
# Local Development with Volume Mounts (Live Code Reload)
# ============================================================================

# Start local services with volume mounts for live development
up-local-dev:
	docker compose -f docker-compose.local.yml -f docker-compose.dev.override.yml up -d

# Stop local dev services
down-local-dev:
	docker compose -f docker-compose.local.yml -f docker-compose.dev.override.yml down

# Show local dev logs
logs-local-dev:
	docker compose -f docker-compose.local.yml -f docker-compose.dev.override.yml logs -f

# Open shell in local dev cablegen container
shell-local-dev:
	docker compose -f docker-compose.local.yml -f docker-compose.dev.override.yml exec cablegen /bin/bash

# Restart local dev services
restart-local-dev: down-local-dev up-local-dev

# Show local dev service status
status-local-dev:
	docker compose -f docker-compose.local.yml -f docker-compose.dev.override.yml ps

# ============================================================================
# Setup
# ============================================================================

# Setup environment file
setup:
	@if [ ! -f .env ]; then \
		cp env.example .env; \
		echo "Created .env file from env.example"; \
		echo "Please edit .env with your configuration"; \
	else \
		echo ".env file already exists"; \
	fi