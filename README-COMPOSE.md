# CableGen Docker Compose

Docker Compose setup for CableGen with Nginx reverse proxy and ACME certificate support.

## Pre-built Docker Images

Docker images are automatically built and published to the GitHub Container Registry via GitHub Actions whenever changes are pushed to the main branch.

To use the pre-built image:
```bash
docker pull ghcr.io/tenstorrent/tt-cablegen:main
```

Available tags:
- `main` - Latest build from main branch
- `sha-<commit>` - Specific commit builds

## Architecture

This setup provides:
- **CableGen Flask Application**: Runs on internal port 5000
- **Nginx Reverse Proxy**: Handles SSL termination and ACME certificates on ports 80/443
- **Automatic SSL**: ACME certificate provisioning via Vault
- **Health Checks**: Service monitoring and dependency management

## Quick Start

1. **Setup environment**:
   ```bash
   make setup
   ```
   This copies `env.example` to `.env` if it doesn't exist, then edit `.env` with your values.

2. **Build and run**:
   ```bash
   make build
   make up
   ```

## Environment Variables

Required variables in `.env`:

```bash
# ACME Certificate Configuration
VAULT_ACME_DIRECTORY_URL=https://vault.yourcompany.com/v1/pki/acme/directory
VAULT_ACME_CONTACT=it@yourcompany.com

# Domain Configuration  
FQDN=cablegen.yourcompany.com
```

### Variable Descriptions

- **VAULT_ACME_DIRECTORY_URL**: Your Vault server's ACME directory endpoint for certificate provisioning
- **VAULT_ACME_CONTACT**: Email address for ACME certificate registration
- **FQDN**: Fully qualified domain name that will be used for the SSL certificate


## Management Commands

```bash
make setup     # Copy env.example to .env (if .env doesn't exist)
make build     # Build all Docker images
make up        # Start all services
make down      # Stop all services
make logs      # View logs from all services
make status    # Check status of all services
make restart   # Restart all services
make clean     # Remove containers, networks, and volumes
make shell     # Open shell in cablegen container
make nginx-shell # Open shell in nginx container
```

## Troubleshooting

- **Certificate issues**: Check that your FQDN resolves to the server and Vault ACME is accessible
- **Service won't start**: Run `make logs` to see error messages
- **Port conflicts**: Ensure ports 80 and 443 are available on the host
- **Build failures**: Check that all required files are present in the nginx/ directory