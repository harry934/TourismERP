# Role-based access (RBAC)

Developer reference for the Tourism Operations Role-Based Access & Dashboard Matrix, implemented on the Lamai Google Sheets app.

## Role IDs

| Role ID | Derived from | Department |
| --- | --- | --- |
| `ADMIN` | `Users.role === Super Admin` | — |
| `SALES` | Staff + `workLabel` Sales | Sales |
| `RESERVATIONS` | Staff + `workLabel` Reservations | Reservations |
| `ACCOUNTS` | Staff + `workLabel` Accounts | Accounts |
| `OPERATIONS` | Staff + `workLabel` Operations or Guide | Operations |

Resolution: `resolveRoleId_(session)` in [`src/PermissionService.gs`](../src/PermissionService.gs). Bootstrap returns `permissions: { roleId, department, modules, stages, fields, actions }`.

## Access check order

1. Authenticated and active
2. Module permission (`canAccessModule_`)
3. Record scope (`canViewRecord_` / `filterEnquiriesForSession_`)
4. Field permission (`fieldPolicy_` / `applyFieldMask_`)
5. Workflow / stage transition (`assertStageTransition_`)
6. Audit / diary on major changes

**Rule:** never rely on hiding UI alone. Every write is enforced server-side.

## Modules

| Module | ADMIN | SALES | RESERVATIONS | ACCOUNTS | OPERATIONS |
| --- | --- | --- | --- | --- | --- |
| dashboard | yes | yes | yes | yes | yes |
| enquiries | yes | yes | yes | yes | yes |
| clients | yes | yes | yes | yes | yes |
| pipeline | yes | yes | yes | yes | yes |
| work | yes | yes | yes | yes | yes |
| handovers | yes | yes | yes | yes | yes |
| payments | yes | no | no | yes | no |
| reports | yes | scoped | scoped | scoped | scoped |
| archive | yes | limited | limited | limited | limited |
| settings | yes | no | no | no | no |

Department-period reports (Daily/Weekly/Monthly), department lock, and CSV export: see [`REPORTS.md`](REPORTS.md).

## Field groups

Values: `full` | `read` | `summary` | `none`

| Group | SALES | RESERVATIONS | ACCOUNTS | OPERATIONS |
| --- | --- | --- | --- | --- |
| client / salesQuote | full | read | read | read |
| supplier | read | full | read | read |
| finance / payments | summary | summary | full | summary |
| budgetAmount | full | read | read | summary |
| operations | read | read | read | full |

## Record scope

Staff see:

- Files they own
- Unassigned files in their department
- Files linked by handover (handed to / handed by)

Admin sees all. Cross-department detail is masked (payment amounts hidden for non-Accounts).

## Stage bands

| Role | Editable stages |
| --- | --- |
| SALES | New enquiry → Accepted |
| RESERVATIONS | Confirmed booking → Supplier booking completed |
| ACCOUNTS | Awaiting payment, Paid |
| OPERATIONS | Operations in progress, Travel completed, Closed |
| ADMIN | All (including Archived) |

Jumping into another department’s stage without a handover is rejected with a plain-language message.

## Handover rule

Manual handovers require reason + recipient. Ownership moves to the recipient **on acknowledge**, not on create.

## Key files

- [`src/PermissionService.gs`](../src/PermissionService.gs) — maps and helpers
- [`src/EnquiryService.gs`](../src/EnquiryService.gs) — scoping, field mask, stage guards
- [`src/PaymentService.gs`](../src/PaymentService.gs) — Accounts/Admin only for mark paid
- [`src/HandoverService.gs`](../src/HandoverService.gs) — ack ownership transfer
- [`web/src/assets/js/app.js`](../web/src/assets/js/app.js) — nav, dashboard widgets, form read-only
- [`web/src/index.html`](../web/src/index.html) — `data-module` nav

## Acceptance smoke list

- Sales: no Settings nav; Settings URL denied; payment amounts summarised
- Reservations: can edit booking ref; cannot mark payment paid
- Accounts: Payments + mark received; cannot edit Operations issue fields (server strips)
- Operations: can edit operations issue / completion; cannot edit payment amounts
- Admin: full access + Settings
- Staff handover: receiver must acknowledge; appears on both dashboards while pending
