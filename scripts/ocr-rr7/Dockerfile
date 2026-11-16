# Linux/amd64 execution environment for the exact rr.7 managed OCR binary.
#
# Base: Ubuntu 24.04 (the preferred qualification platform). Node 24.13.1 is
# the frozen M2-A base runtime. The image only supplies Node, git, strace and
# loopback tooling; it contains no provider credentials or external endpoints.
FROM ubuntu:24.04

ARG NODE_VERSION=24.13.1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates curl git strace procps iproute2 xz-utils \
    && curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && rm -rf /var/lib/apt/lists/*

# Unprivileged qualification user. Ubuntu 24.04 reserves uid 1000 for `ubuntu`,
# so the qualification user takes the next free uid. The OCR child and its
# private HOME run as this user, so root-owned canaries under /forbidden are
# unreadable.
RUN useradd --create-home --uid 1001 --shell /bin/bash qual

# Root-owned, mode 0700 forbidden tree: synthetic stand-ins for truth, the
# anonymization map/salt, oracle receipts, scorer internals, other candidates
# and the parent experiment checkout. The qualification test proves the child
# cannot read them and that it never attempts to.
RUN mkdir -p /forbidden/oracle-receipts /forbidden/scorer /forbidden/other-candidates /forbidden/parent-checkout \
    && printf '%s\n' 'SYNTHETIC CANARY - sealed truth must never reach OCR' > /forbidden/truth-v1.json \
    && printf '%s\n' 'SYNTHETIC CANARY - anonymization map/salt' > /forbidden/anonymization-map.json \
    && printf '%s\n' 'SYNTHETIC CANARY - oracle receipt' > /forbidden/oracle-receipts/receipt.json \
    && printf '%s\n' 'SYNTHETIC CANARY - scorer internals' > /forbidden/scorer/scorer.ts \
    && printf '%s\n' 'SYNTHETIC CANARY - other candidate' > /forbidden/other-candidates/S1-C1.ts \
    && printf '%s\n' 'SYNTHETIC CANARY - parent experiment checkout' > /forbidden/parent-checkout/README.md \
    && chown -R root:root /forbidden \
    && chmod -R 0700 /forbidden

WORKDIR /m2
USER qual
