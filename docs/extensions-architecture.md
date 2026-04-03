# Adapter Extensions Architecture

## Why revisit this now

The adapter already has two different extension mechanisms, but they solve different problems:

- Boot-time capability selection is hard-wired in the app bootstrap through `PROVIDER_TYPE` and direct provider-specific config parsing.
- Runtime flow customization is routed through `PluginManager`, which is currently focused on plan approval, payments, asset creation, and transaction hooks.

That split is visible in the current code:

- `src/config.ts` parses provider-specific config using a `switch` on `PROVIDER_TYPE`.
- `src/app.ts` creates a `PluginManager`, but custody is still selected through a separate `switch` and injected before services are assembled.
- `src/services/direct/custody-provider.ts` defines a `CustodyProvider` abstraction that is consumed deeply by direct-mode services.

This makes custody a natural candidate for extraction, but not as "just another plugin" under the current `PluginManager`.

## What the current design tells us

### 1. Custody is a boot-time capability, not a request-time hook

`CustodyProvider` is required before the adapter can:

- build mapping validation for custody account IDs
- choose direct-mode services
- create token, escrow, health, and omnibus delegates
- expose provider-specific capabilities such as address resolution and asset registration

That means custody participates in adapter assembly, not only in business callbacks.

### 2. The existing plugin manager is too narrow for the next wave of extensions

Today `PluginManager` is effectively a single-slot registry:

- one asset creation plugin
- one plan approval plugin
- one payments plugin
- one transaction hook

That is workable for a single DTCC-like deposit flow or a single whitelist validator, but it breaks down once we want combinations such as:

- custody provider + token-standard validator
- custody provider + deposit integration
- token-standard validator + auto-whitelisting + transaction observability

The problem is not only loading. It is composition.

### 3. Dynamic loading is not the right default

For this adapter, loading arbitrary code at runtime creates more problems than it solves:

- security review becomes much harder
- operational support becomes unclear
- version compatibility becomes implicit instead of explicit
- the adapter is likely to run in tightly controlled environments where predictable binaries matter

### 4. Custom builds alone are too expensive

At the other extreme, creating one build per combination does not scale:

- too many combinations to test and distribute
- deploy-time behavior is opaque
- the difference between "supported", "compiled", and "activated" becomes hard to reason about

## Recommended direction

Use an embedded extension registry with config-driven activation.

In practice this means:

- all supported extensions are compiled into the adapter image
- the adapter exposes a typed internal registry of known extension factories
- deployment config selects which extensions are active
- activation is validated at startup
- only declared, compiled-in extension IDs can be enabled

This keeps the safety and operability of a fixed binary while avoiding custom builds for every deployment shape.

## Key design choice: separate extension categories

Do not force every extension through the same abstraction.

We should separate at least two categories:

### A. Capability modules

These participate in bootstrapping and usually own a slot exclusively.

Examples:

- `custody/fireblocks`
- `custody/dfns`
- `custody/blockdaemon`

Properties:

- activated at startup
- usually one active module per slot
- can contribute factories, validators, routes, and service dependencies
- can require provider-specific config and compatibility checks

### B. Flow and policy modules

These decorate or extend request handling and are often composable.

Examples:

- `plan-approval/erc3643-whitelist`
- `plan-approval/auto-whitelist`
- `payments/dtcc-deposit`
- `hooks/audit-log`

Properties:

- activated at startup, executed at runtime
- can often be combined in an ordered pipeline
- should be isolated by extension point rather than by vendor

## Proposed model

### 1. Embedded registry

Add a local registry that maps stable IDs to typed factories, for example:

```ts
type ExtensionId =
  | 'custody/fireblocks'
  | 'custody/dfns'
  | 'custody/blockdaemon'
  | 'plan-approval/erc3643-whitelist'
  | 'payments/dtcc';
```

Each extension should declare:

- `id`
- `kind`
- `version`
- `supportedModes`
- `supportedAccountModels`
- `configSchema`
- `dependencies`
- `conflicts`
- `activate(context, config)`

### 2. Explicit extension points

Instead of a single generic plugin bucket, define typed contribution points:

- `custodyProvider`
- `planApprovalRules`
- `paymentsHandler`
- `transactionHooks`
- `mappingAugmenters`
- `assetLifecycleHooks`
- `routes`

This is important because not every extension contributes the same thing.

### 3. Composition rules per extension point

Each extension point needs an explicit composition rule:

- `custodyProvider`: exactly one
- `paymentsHandler`: zero or one owner, or one composite owner
- `planApprovalRules`: many, ordered
- `transactionHooks`: many, ordered
- `mappingAugmenters`: many
- `routes`: many

This avoids the current ambiguity where "plugin" can mean either "replace behavior" or "add behavior".

### 4. Composite adapters over the existing `PluginManager`

The current `PluginManager` in the skeleton adapter only accepts one plugin per category.

That does not mean we need to replace it immediately.

Instead, the adapter can build composites internally:

- a `CompositePlanApprovalPlugin`
- a `CompositePaymentsPlugin`
- a `CompositeTransactionHook`

The embedded registry can activate multiple extensions, then the adapter can collapse them into the single plugin slots expected by the current skeleton package.

This gives us a compatible migration path.

## Why custody should be a registry slot, not a generic plugin

Custody is special because it affects:

- startup config parsing
- adapter service wiring
- account mapping behavior
- asset registration callbacks
- wallet resolution semantics
- omnibus support
- gas funding

This is already encoded in `CustodyProvider`.

So the right move is:

- keep `CustodyProvider` as the service-level contract
- stop hard-coding providers directly in `app.ts`
- resolve the provider from a typed embedded registry instead

In other words, treat the existing `CustodyProvider` interface as the stable adapter contract and make provider selection pluggable behind it.

## Suggested config shape

Short term, keep compatibility with `PROVIDER_TYPE`, but normalize it into the new registry model internally.

Example:

```env
PROVIDER_TYPE=fireblocks
ENABLED_EXTENSIONS=plan-approval/erc3643-whitelist,payments/dtcc
```

Longer term, move to a structured config value so plugin-specific settings are namespaced:

```json
{
  "capabilities": {
    "custody": {
      "id": "custody/fireblocks"
    }
  },
  "extensions": [
    { "id": "plan-approval/erc3643-whitelist" },
    { "id": "payments/dtcc" }
  ]
}
```

If env-only configuration remains a requirement, use prefixed namespaces, for example:

- `EXT_CUSTODY_ID=custody/fireblocks`
- `EXT_PLAN_APPROVAL_0_ID=plan-approval/erc3643-whitelist`
- `EXT_PAYMENTS_0_ID=payments/dtcc`

But a structured JSON config is easier to validate and evolve.

## Activation flow

Recommended startup flow:

1. Parse base adapter config.
2. Resolve the active custody capability from the embedded registry.
3. Resolve all enabled flow/policy extensions.
4. Validate dependencies, conflicts, account model support, and adapter mode support.
5. Activate extensions and collect contributions.
6. Build composites for the current skeleton `PluginManager`.
7. Assemble services using the activated custody provider and collected contributions.

This keeps activation deterministic and fail-fast.

## Compatibility strategy

To avoid "too many combinations", define supported combinations explicitly instead of allowing arbitrary mixes.

The registry should support:

- extension-level compatibility declarations
- startup validation for conflicts and missing dependencies
- a small set of tested deployment profiles

Examples of profiles:

- `direct-fireblocks-basic`
- `direct-dfns-basic`
- `direct-fireblocks-dtcc`
- `direct-dfns-erc3643`

Profiles are not custom builds. They are tested activation bundles on top of the same binary.

## Proposed migration path

### Phase 1. Formalize custody selection as a registry

Refactor the current provider `switch` into an internal registry:

- keep existing Fireblocks and DFNS implementations
- add Blockdaemon as another registry entry when ready
- preserve `CustodyProvider` as the internal contract
- keep env compatibility

This is low risk because it mostly replaces a hard-coded selection mechanism with a typed lookup.

### Phase 2. Add extension activation and composites

Introduce an internal extension loader that:

- resolves enabled extension IDs from config
- activates them from the embedded registry
- builds composite plan approval, payments, and transaction plugins
- registers those composites into the existing `PluginManager`

This unlocks multiple policy/flow modules without changing the skeleton adapter first.

### Phase 3. Expand extension points where needed

Only after real use cases appear, add more contribution points such as:

- inbound transfer hooks
- custom mapping fields
- custom routes
- asset registration lifecycle

This keeps the design grounded in actual extension demand.

### Phase 4. Consider internal control-plane APIs later

If an internal API is introduced later, it should not load arbitrary code.

It should only:

- enable or disable compiled-in extension IDs
- update namespaced config for those extension IDs
- validate compatibility before applying changes
- preferably require restart or controlled reconfiguration boundaries

The control plane should manage activation, not distribution.

## Practical recommendation for this repo

For the Ethereum adapter specifically, the next implementation step should be:

1. Create a local embedded registry for custody modules.
2. Move Fireblocks and DFNS registration behind that registry.
3. Preserve `CustodyProvider` as the direct-service dependency.
4. Introduce config-driven extension activation for plan approval and payments as a second step.
5. Use composite plugins so multiple extensions can coexist without forking the skeleton adapter immediately.

## Bottom line

The right mental model is not "a plugin system" in the singular.

It is:

- one embedded capability registry for boot-time adapter assembly
- several typed extension points for runtime behavior
- config-driven activation of compiled-in modules
- compatibility validation at startup

That gives us:

- no unsafe dynamic loading
- no explosion of custom builds
- support for multiple extension combinations
- a clean path to custody providers, token-standard policies, and deposit-flow integrations
