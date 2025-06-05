#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}ℹ ${1}${NC}"
}

log_success() {
    echo -e "${GREEN}✅ ${1}${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  ${1}${NC}"
}

log_error() {
    echo -e "${RED}❌ ${1}${NC}"
}

log_section() {
    echo -e "\n${BLUE}=== ${1} ===${NC}"
}

# Function to disable corepack if it's causing issues
disable_corepack_if_needed() {
    if command -v corepack >/dev/null 2>&1; then
        log_info "Disabling corepack to avoid network issues..."
        corepack disable || true
    fi
}

# Function to detect and setup package manager
setup_package_manager() {
    log_section "PACKAGE MANAGER SETUP"
    
    # First, try to disable corepack to avoid 503 errors
    disable_corepack_if_needed
    
    # Check if pnpm is available without corepack
    if command -v pnpm >/dev/null 2>&1; then
        PKG_MGR="pnpm"
        log_success "Found existing pnpm installation"
    else
        # Try to install pnpm directly via npm (bypass corepack)
        log_info "Installing pnpm via npm (bypassing corepack)..."
        if npm install -g pnpm 2>/dev/null; then
            PKG_MGR="pnpm"
            log_success "Installed pnpm successfully"
        else
            log_warning "Failed to install pnpm, falling back to npm"
            PKG_MGR="npm"
        fi
    fi
    
    log_info "Using package manager: $PKG_MGR"
}

# Function to check prerequisites
check_prerequisites() {
    log_section "CHECKING PREREQUISITES"
    
    # Check Node.js
    if ! command -v node >/dev/null 2>&1; then
        log_error "Node.js is not installed. Please install Node.js (https://nodejs.org/)"
        exit 1
    fi
    log_success "Node.js found: $(node --version)"
    
    # Check npm
    if ! command -v npm >/dev/null 2>&1; then
        log_error "npm is not installed. Please install npm"
        exit 1
    fi
    log_success "npm found: $(npm --version)"
    
    # Check Python (optional for livekit-backend)
    if command -v python3 >/dev/null 2>&1; then
        log_success "Python found: $(python3 --version)"
        PYTHON_CMD="python3"
    elif command -v python >/dev/null 2>&1; then
        log_success "Python found: $(python --version)"
        PYTHON_CMD="python"
    else
        log_warning "Python not found - skipping backend setup"
        PYTHON_CMD=""
    fi
    
    # Check pip
    if [ -n "$PYTHON_CMD" ]; then
        if command -v pip3 >/dev/null 2>&1; then
            PIP_CMD="pip3"
        elif command -v pip >/dev/null 2>&1; then
            PIP_CMD="pip"
        else
            log_warning "pip not found - skipping backend setup"
            PIP_CMD=""
        fi
        
        if [ -n "$PIP_CMD" ]; then
            log_success "pip found: $PIP_CMD"
        fi
    fi
}

# Function to install Node dependencies
install_node_dependencies() {
    log_section "INSTALLING NODE DEPENDENCIES"
    
    # Clear package manager cache first
    if [ "$PKG_MGR" = "pnpm" ]; then
        log_info "Clearing pnpm cache..."
        pnpm store prune || true
    else
        log_info "Clearing npm cache..."
        npm cache clean --force || true
    fi
    
    # Install main dependencies
    log_info "Installing main dependencies..."
    if [ "$PKG_MGR" = "pnpm" ]; then
        pnpm install --frozen-lockfile || pnpm install
    else
        npm ci || npm install
    fi
    
    # Install TypeScript SDK for tests
    log_info "Installing @tambo-ai/typescript-sdk for tests..."
    if [ "$PKG_MGR" = "pnpm" ]; then
        pnpm add -D @tambo-ai/typescript-sdk
    else
        npm install --save-dev @tambo-ai/typescript-sdk
    fi
    
    log_success "Node dependencies installed"
}

# Function to install Python dependencies
install_python_dependencies() {
    if [ -n "$PYTHON_CMD" ] && [ -n "$PIP_CMD" ] && [ -f "livekit-backend/requirements.txt" ]; then
        log_section "INSTALLING PYTHON DEPENDENCIES"
        
        log_info "Installing Python requirements for livekit-backend..."
        
        # Set pip cert if proxy cert is available
        PIP_ARGS=""
        if [ -n "${CODEX_PROXY_CERT:-}" ]; then
            PIP_ARGS="--cert $CODEX_PROXY_CERT"
        fi
        
        $PIP_CMD install $PIP_ARGS -r livekit-backend/requirements.txt
        log_success "Python dependencies installed"
    else
        log_warning "Skipping Python dependencies (missing python/pip or requirements.txt)"
    fi
}

# Function to clean up problematic packages
cleanup_problematic_packages() {
    log_section "CLEANING UP PROBLEMATIC PACKAGES"
    
    # Remove @types/dompurify if present (known to cause issues)
    log_info "Removing @types/dompurify if present..."
    if [ "$PKG_MGR" = "pnpm" ]; then
        pnpm remove @types/dompurify || true
    else
        npm uninstall @types/dompurify || true
    fi
    
    log_success "Cleanup completed"
}

# Function to clear build artifacts
clear_build_artifacts() {
    log_section "CLEARING BUILD ARTIFACTS"
    
    log_info "Removing .next directory..."
    rm -rf .next
    
    log_info "Removing node_modules/.cache..."
    rm -rf node_modules/.cache
    
    log_info "Removing TypeScript build info..."
    rm -f tsconfig.tsbuildinfo
    
    log_success "Build artifacts cleared"
}

# Function to set environment variables
setup_environment_variables() {
    log_section "SETTING UP ENVIRONMENT VARIABLES"
    
    # Handle proxy certificates
    if [ -n "${CODEX_PROXY_CERT:-}" ]; then
        export NODE_EXTRA_CA_CERTS="$CODEX_PROXY_CERT"
        export PIP_CERT="$CODEX_PROXY_CERT"
        log_success "Set proxy certificates for Node.js and pip"
    fi
    
    # Set NODE_ENV if not already set
    if [ -z "${NODE_ENV:-}" ]; then
        export NODE_ENV="development"
        log_info "Set NODE_ENV to development"
    fi
    
    # Disable Next.js telemetry in CI
    if [ -n "${CI:-}" ]; then
        export NEXT_TELEMETRY_DISABLED=1
        log_info "Disabled Next.js telemetry for CI"
    fi
}

# Function to verify tools
verify_tools() {
    log_section "VERIFYING TOOLS"
    
    # Show versions
    log_info "Node version: $(node --version)"
    log_info "npm version: $(npm --version)"
    
    if [ "$PKG_MGR" = "pnpm" ]; then
        log_info "pnpm version: $(pnpm --version)"
    fi
    
    # Test ESLint
    if [ "$PKG_MGR" = "pnpm" ]; then
        pnpm dlx eslint --version >/dev/null 2>&1 && log_success "ESLint available" || log_warning "ESLint not available"
    else
        npx eslint --version >/dev/null 2>&1 && log_success "ESLint available" || log_warning "ESLint not available"
    fi
    
    # Test TypeScript
    if [ "$PKG_MGR" = "pnpm" ]; then
        pnpm tsc --version >/dev/null 2>&1 && log_success "TypeScript available" || log_warning "TypeScript not available"
    else
        npx tsc --version >/dev/null 2>&1 && log_success "TypeScript available" || log_warning "TypeScript not available"
    fi
}

# Function to build the project
build_project() {
    log_section "BUILDING PROJECT"
    
    log_info "Starting build process..."
    if [ "$PKG_MGR" = "pnpm" ]; then
        pnpm build
    else
        npm run build
    fi
    
    log_success "Build completed successfully!"
}

# Main execution
main() {
    log_section "ENVIRONMENT SETUP START"
    log_info "Starting environment setup for PRESENT project"
    
    # Run setup steps
    check_prerequisites
    setup_package_manager
    setup_environment_variables
    clear_build_artifacts
    install_node_dependencies
    cleanup_problematic_packages
    install_python_dependencies
    verify_tools
    build_project
    
    log_section "SETUP COMPLETE"
    log_success "Environment setup completed successfully!"
    log_info "You can now run: $PKG_MGR dev"
}

# Error handling
trap 'log_error "Setup failed at line $LINENO. Check the output above for details."' ERR

# Run main function
main "$@" 