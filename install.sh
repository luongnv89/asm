#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# agent-skill-manager Installer
# The universal skill manager for AI coding agents.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/luongnv89/agent-skill-manager/main/install.sh | bash
#   wget -qO- https://raw.githubusercontent.com/luongnv89/agent-skill-manager/main/install.sh | bash
# ============================================================================

TOOL_NAME="agent-skill-manager"
NODE_MIN_VERSION="18.0.0"
NPM_MIN_VERSION="9.0.0"

# --- Color Output ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { printf "${BLUE}[INFO]${NC}  %s\n" "$*"; }
ok()    { printf "${GREEN}[ OK ]${NC}  %s\n" "$*"; }
warn()  { printf "${YELLOW}[WARN]${NC}  %s\n" "$*"; }
err()   { printf "${RED}[ERR ]${NC}  %s\n" "$*" >&2; }
die()   { err "$@"; exit 1; }

# --- OS / Arch Detection ---
detect_os() {
    local os
    os="$(uname -s | tr '[:upper:]' '[:lower:]')"
    case "$os" in
        linux*)  echo "linux" ;;
        darwin*) echo "macos" ;;
        mingw*|msys*|cygwin*) echo "windows" ;;
        *)       die "Unsupported operating system: $os" ;;
    esac
}

detect_arch() {
    local arch
    arch="$(uname -m)"
    case "$arch" in
        x86_64|amd64)  echo "x86_64" ;;
        aarch64|arm64) echo "arm64" ;;
        armv7l)        echo "armv7" ;;
        *)             die "Unsupported architecture: $arch" ;;
    esac
}

# --- Version Comparison ---
# Returns 0 if $1 >= $2 (semver). Strips a leading "v" and any pre-release/build
# suffix (e.g. "20.1.0-nightly" → "20.1.0") before comparing.
version_gte() {
    local IFS=.
    local v1_clean v2_clean
    v1_clean="${1#v}"; v1_clean="${v1_clean%%-*}"
    v2_clean="${2#v}"; v2_clean="${v2_clean%%-*}"
    # Intentional word-splitting on IFS=. to turn "20.1.0" into array elements.
    # shellcheck disable=SC2206
    local i ver1=($v1_clean) ver2=($v2_clean)
    for ((i=0; i<${#ver2[@]}; i++)); do
        local p1="${ver1[i]:-0}"
        local p2="${ver2[i]:-0}"
        # Drop any non-numeric remainder so arithmetic comparison is safe.
        p1="${p1%%[!0-9]*}"; p2="${p2%%[!0-9]*}"
        if ((10#${p1:-0} > 10#${p2:-0})); then return 0; fi
        if ((10#${p1:-0} < 10#${p2:-0})); then return 1; fi
    done
    return 0
}

# --- Node.js Detection ---
check_node() {
    if ! command -v node &>/dev/null; then
        err "Node.js is not installed."
        err "agent-skill-manager requires Node.js >= $NODE_MIN_VERSION."
        err "Install it from https://nodejs.org/ (or via nvm, fnm, Homebrew, apt, …),"
        err "then re-run this script."
        return 1
    fi

    local node_version
    node_version="$(node --version 2>/dev/null || echo "0.0.0")"
    if version_gte "$node_version" "$NODE_MIN_VERSION"; then
        ok "Node.js $node_version found (>= $NODE_MIN_VERSION required)"
        return 0
    fi

    err "Node.js $node_version found but >= $NODE_MIN_VERSION is required."
    err "Upgrade Node.js (https://nodejs.org/) and re-run this script."
    return 1
}

# --- npm Detection ---
check_npm() {
    if ! command -v npm &>/dev/null; then
        err "npm is not installed."
        err "npm ships with Node.js — reinstall Node.js from https://nodejs.org/,"
        err "then re-run this script."
        return 1
    fi

    local npm_version
    npm_version="$(npm --version 2>/dev/null || echo "0.0.0")"
    if version_gte "$npm_version" "$NPM_MIN_VERSION"; then
        ok "npm $npm_version found (>= $NPM_MIN_VERSION required)"
        return 0
    fi

    warn "npm $npm_version found but >= $NPM_MIN_VERSION is recommended."
    warn "Upgrade with: npm install -g npm@latest"
    return 0
}

# --- Install agent-skill-manager ---
install_asm() {
    info "Installing $TOOL_NAME globally via npm..."
    npm install -g "$TOOL_NAME"
    ok "$TOOL_NAME installed globally"
}

# --- Verification ---
verify_installation() {
    info "Verifying installation..."
    local found=false

    # npm's `bin` field installs both `asm` and `agent-skill-manager`.
    for cmd in agent-skill-manager asm; do
        if command -v "$cmd" &>/dev/null; then
            ok "$cmd is available"
            found=true
        fi
    done

    if [ "$found" = false ]; then
        warn "No commands found in PATH"
        warn "Add npm's global bin to your PATH. Find it with:"
        warn "  npm prefix -g"
        warn "then add its 'bin' subdirectory to PATH in your shell profile."
        return 1
    fi

    detect_path_shadowing

    return 0
}

# --- PATH shadowing detection ---
# Warns when multiple `asm` binaries live on different PATH entries (e.g. a stale
# global install left over from a previous package manager). The first match in
# PATH wins, so an older install can silently outrun a fresh one.
detect_path_shadowing() {
    local IFS=':'
    local -a hits=()
    local -a seen_real=()
    local dir candidate real already

    for dir in $PATH; do
        [ -z "$dir" ] && continue
        candidate="$dir/asm"
        [ -x "$candidate" ] || continue
        real="$(realpath "$candidate" 2>/dev/null || readlink -f "$candidate" 2>/dev/null || echo "$candidate")"
        already=false
        for r in "${seen_real[@]}"; do
            if [ "$r" = "$real" ]; then
                already=true
                break
            fi
        done
        if [ "$already" = false ]; then
            seen_real+=("$real")
            hits+=("$candidate")
        fi
    done

    if [ "${#hits[@]}" -gt 1 ]; then
        echo ""
        warn "Detected ${#hits[@]} \`asm\` binaries on PATH — newer install may be shadowed:"
        warn "  resolved: ${hits[0]}"
        local i=1
        while [ $i -lt ${#hits[@]} ]; do
            warn "  shadowed: ${hits[$i]}"
            i=$((i + 1))
        done
        warn "Remove the stale install and keep only one:"
        warn "  npm uninstall -g agent-skill-manager"
    fi
}

# --- Entry Point ---
main() {
    echo ""
    info "============================================"
    info " $TOOL_NAME Installer"
    info "============================================"
    echo ""

    local os arch
    os="$(detect_os)"
    arch="$(detect_arch)"
    info "OS: $os | Arch: $arch"
    echo ""

    # Step 1: Ensure Node.js and npm are present (instruct on failure; we do not
    # auto-install a runtime via curl|bash).
    check_node || exit 1
    check_npm || exit 1
    echo ""

    # Step 2: Install agent-skill-manager (npm installs both `asm` and
    # `agent-skill-manager` from package.json's `bin` field).
    install_asm
    echo ""

    # Step 3: Verify
    if verify_installation; then
        echo ""
        info "============================================"
        ok "Installation complete!"
        info "============================================"
        echo ""
        info "Get started:"
        info "  asm                    # Launch interactive TUI (shorthand)"
        info "  agent-skill-manager    # Launch interactive TUI"
        info "  asm --help             # Show help"
        echo ""
    else
        echo ""
        warn "Installation finished but verification had warnings."
        warn "Try restarting your terminal, then run: agent-skill-manager"
        echo ""
    fi
}

main "$@"
