# Security, privacy, and governance

Status: Proposed. A formal threat model is required before implementation GA.

## Trust boundaries

1. Client to Cosmy edge
2. Edge to router cell
3. Router to control-plane dependencies
4. Router to provider
5. Router to customer tools
6. Services to telemetry and storage
7. Administrators to control plane
8. Tenant boundary inside every shared service

## Primary threats

- Stolen project or provider credentials
- Cross-tenant data access
- Prompt content leaking through logs
- Policy bypass through request overrides
- SSRF through provider, attachment, or tool URLs
- Malicious tool definitions or results
- Prompt injection influencing router policy
- Dependency and adapter supply-chain compromise
- Billing abuse and denial of wallet
- Model substitution or alias drift
- Replay of administrative actions
- Training or evaluation data poisoning

## Core principle

Model output and classifier output are untrusted data. They cannot modify policy, credentials, registry state, budgets, or deployment without ordinary authenticated control-plane authorization.

## Authentication and authorization

- Use short-lived credentials where possible.
- Hash project API keys at rest.
- Scope credentials to tenant, project, environment, and actions.
- Evaluate authorization at the resource boundary.
- Require stronger authentication for administrative actions.
- Support immediate revocation.
- Record principal and reason for every mutation.

## Provider credentials

- Store in a dedicated secret manager or hardware-backed vault.
- Encrypt with tenant and provider context.
- Deliver short-lived material only to the selected adapter.
- Never return credentials through APIs.
- Redact authorization headers and signed query parameters.
- Rotate without application deployment.
- Detect unexpected credential use and geographic origin.

## Data policy

Effective policy defines:

- Allowed providers and regions
- Retention mode
- Content logging permission
- Provider training/retention constraints
- Allowed tools and external destinations
- Encryption requirements
- Data classification ceiling
- Human-review permission
- Shadow and evaluation permission

Deny rules override allow rules. Request hints may tighten, never relax, policy.

## Zero-retention mode

In zero-retention mode:

- Do not persist prompt or response content.
- Do not use semantic response caches.
- Store only policy-approved metadata and digests.
- Select only provider configurations compatible with the required retention posture.
- Prevent content-bearing telemetry export.
- Ensure diagnostic tooling follows the same rule.

## Tool security

- Tool execution is outside the model process.
- Validate arguments against schema and business policy.
- Authorize each tool call using user and application context.
- Use destination allowlists and egress controls.
- Apply time, memory, output, and call-count limits.
- Treat tool results as untrusted content.
- Require confirmation for configured high-impact actions.
- Preserve call IDs and audit evidence.

## Prompt injection boundary

Prompts may influence task execution but cannot redefine router policy. Routing feature extraction uses bounded schemas and policy-controlled instructions. External documents and tool output are marked as data, not control instructions.

## Network security

- TLS everywhere
- Mutual workload identity between services
- Restricted provider egress
- Private connectivity option for enterprise deployments
- No public control-plane databases
- Separate administrative ingress
- Rate limiting and web application firewall at edge

## Software supply chain

- Locked dependencies and provenance
- Signed build artifacts
- Software bill of materials
- Vulnerability and secret scanning
- Reproducible or attestable builds
- Minimal runtime images
- Admission policy for production deployments
- Isolated adapter dependencies where practical

## Administrative governance

Dual approval is recommended for:

- Enabling a new provider for sensitive data
- Relaxing retention or region policy
- Promoting a model to active globally
- Changing billing rules
- Exporting customer content
- Rotating root signing keys

Emergency disable remains single-action but requires post-incident review.

## Audit records

Audit events include actor, action, target, old/new version, time, source, approval, reason, and correlation ID. High-value logs use tamper-evident storage and restricted deletion.

PostgreSQL administrative mutations use the implemented SHA-256 predecessor chain and authenticated verification endpoint described in [tamper-evident administrative audit](41-tamper-evident-audit.md). External anchoring is required to defend against an attacker who can rewrite the database and every stored hash.

## Privacy rights

The data model supports:

- Tenant export
- Content deletion
- Principal deletion where legally applicable
- Retention override for legal hold
- Processing-region evidence
- Subprocessor/provider reporting

Deletion workflows remove content while preserving non-content financial and security evidence where legally required.

## Abuse and financial controls

- Per-key and per-tenant quotas
- Maximum request and output sizes
- Spend velocity alerts
- Anomaly detection
- Tool-call ceilings
- New-account restrictions
- Emergency budget cutoff
- Idempotency against replayed billable requests

## Security testing

- Threat modeling per trust-boundary change
- Static and dependency analysis
- Secret scanning
- Tenant-isolation tests
- Authorization matrix tests
- Fuzzing request and stream parsers
- SSRF and egress tests
- Prompt-injection tests
- Billing abuse simulations
- External penetration testing before GA

## Incident response

Security incidents require containment controls for credential revocation, model/provider disable, tenant isolation, snapshot rollback, content-access review, and customer notification workflows.
