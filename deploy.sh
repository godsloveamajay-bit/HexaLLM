#!/bin/bash
# Deploy NebulaX AI to ai.nebualax.co.uk using Cloudflare Tunnel
# Run this script on your production server

set -e

DOMAIN="ai.nebualax.co.uk"

echo "🚀 Deploying NebulaX AI to $DOMAIN via Cloudflare Tunnel"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (use sudo)"
    exit 1
fi

# Install Docker and Docker Compose if not present
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com | sh
fi

if ! command -v docker-compose &> /dev/null; then
    echo "📦 Installing Docker Compose..."
    apt-get update && apt-get install -y docker-compose
fi

# Create project directory
PROJECT_DIR="/opt/nebulaxai"
mkdir -p $PROJECT_DIR
cd $PROJECT_DIR

# Create required directories
mkdir -p data/models data/datasets data/uploads

# Create .env file with secrets
if [ ! -f .env ]; then
    echo "🔐 Generating secure secret key..."
    SECRET_KEY=$(openssl rand -hex 32)
    cat > .env << EOF
SECRET_KEY=$SECRET_KEY
DOMAIN=$DOMAIN
# Get this from Cloudflare Zero Trust Dashboard -> Access -> Tunnels
# Create a tunnel pointing to http://frontend:80 (for web) and http://backend:8000 (for API)
CLOUDFLARE_TUNNEL_TOKEN=your_tunnel_token_here
EOF
    echo "⚠️  Save this SECRET_KEY: $SECRET_KEY"
    echo "⚠️  Edit .env and add your CLOUDFLARE_TUNNEL_TOKEN from Cloudflare Dashboard"
    exit 1
fi

# Source environment
source .env

# Validate required vars
if [ -z "$CLOUDFLARE_TUNNEL_TOKEN" ] || [ "$CLOUDFLARE_TUNNEL_TOKEN" = "your_tunnel_token_here" ]; then
    echo "❌ CLOUDFLARE_TUNNEL_TOKEN not set in .env"
    echo "Get it from: https://one.dash.cloudflare.com/ -> Zero Trust -> Networks -> Tunnels"
    exit 1
fi

# Build and start all services
echo "🏗️  Building and starting services..."
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to start..."
sleep 30

# Run database migrations
echo "🗄️  Running database migrations..."
docker-compose -f docker-compose.prod.yml exec -T backend alembic upgrade head

echo "✅ Deployment complete!"
echo "🌐 Your app is now available at: https://$DOMAIN"
echo ""
echo "📋 Useful commands:"
echo "  View logs:    docker-compose -f docker-compose.prod.yml logs -f"
echo "  Restart:      docker-compose -f docker-compose.prod.yml restart"
echo "  Stop:         docker-compose -f docker-compose.prod.yml down"
echo "  Update:       git pull && docker-compose -f docker-compose.prod.yml build && docker-compose -f docker-compose.prod.yml up -d"