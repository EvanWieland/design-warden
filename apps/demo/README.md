# Acme Console (demo app)

Acme Console is a small order-management UI for the fictional retailer Acme Retail. It is the fixture Design Warden is evaluated against: the app as committed passes its own policy, `design-warden.policy.json`, and seeded violation scenarios are layered on top of it.

Rendering is deterministic so screenshots can be compared: fixed data, no network, timers, random values or web fonts, and the only animation is the CSS spinner.

## Routes

| Path | Page | Pattern |
| --- | --- | --- |
| `/` | Overview | Dashboard summary |
| `/orders` | Orders | Filterable list |
| `/orders/new` | New order | Form page |
| `/settings` | Settings | |
| anything else | Page not found | |

## Forcing data states

`/orders` reads the `state` query parameter:

| URL | Shows |
| --- | --- |
| `/orders` | The 12 fixture orders, filtered by search and status |
| `/orders?state=loading` | Loading spinner (never resolves) |
| `/orders?state=error` | Error alert with "Try again" |
| `/orders?state=empty` | Empty state |

On `/orders/new`, submitting the empty form shows the validation errors.

## Run

From the repository root:

```sh
corepack pnpm --filter @design-warden/demo dev        # http://localhost:5173
corepack pnpm --filter @design-warden/demo build      # writes apps/demo/dist
corepack pnpm --filter @design-warden/demo preview    # serves dist on http://localhost:4173
corepack pnpm --filter @design-warden/demo typecheck
corepack pnpm design-warden check --policy apps/demo/design-warden.policy.json
corepack pnpm design-warden capture --policy apps/demo/design-warden.policy.json --serve apps/demo/dist --out .design-warden/captures
```

## Layout

- `src/design-system/`: `tokens.css` (the only place literal values live), `base.css` and the components
- `src/pages/`: one page per route; the reference patterns named in the policy
- `src/data/`: fixture orders and the `useOrders` hook
- `src/legacy/PartnerPromo.*`: a partner promotion in the partner's brand colors, allowed by the `legacy-partner-promo` policy exception
- `.claude/skills/acme-design-system/`: the design guidance coding agents follow; Design Warden findings link to it
