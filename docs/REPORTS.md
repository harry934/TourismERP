# Department reports

Daily / weekly / monthly reports scoped by department, matching the Report Matrix. PDF export is deferred; CSV (Excel) is supported.

## API

`generateDepartmentReport(payload, session)` and `exportReportCsv` with the same filters.

| Input | Rules |
| --- | --- |
| `period` | `daily` \| `weekly` \| `monthly` (Admin may also use `custom` with `startDate`/`endDate`) |
| `date` | Anchor day in `Africa/Dar_es_Salaam` (drives which day / week / month) |
| `department` | Staff: forced to `departmentForRole_(roleId)`. Admin: one of Sales / Reservations / Accounts / Operations or `ALL` |
| `staffId` | Optional. Staff: self or same-department colleagues. Admin: any |
| `stage` / `status` | Optional filters on enquiry stage / `fileStatus` |

Timezone for period math: `APP_CONFIG.TIMEZONE` (`Africa/Dar_es_Salaam`).

### Period ranges

| Period | Range |
| --- | --- |
| Daily | Selected calendar day |
| Weekly | Monday–Sunday containing the selected day |
| Monthly | Calendar month of the selected day |

### File inclusion

A file is included when `createdAt`, `updatedAt`, or `startDate` falls in the range (date part only). Operations travel KPIs also emphasise `startDate` in range.

Client spoofing of department is rejected on the server.

## KPIs by department

| Department | Typical KPIs |
| --- | --- |
| Sales | New enquiries, quoting, follow-ups due/overdue, accepted, closed, estimated value (if permitted) |
| Reservations | Confirmed received, in progress, supplier completed, missing booking ref, pending handovers |
| Accounts | Awaiting payment, paid, unpaid milestones, payment exceptions |
| Operations | Ops in progress, upcoming travel, completed, open issues, ready to close |
| Admin ALL | Combined KPI sets; files counted once in the detail table |

Response shape: `header`, `kpis[]`, `byStage`, `exceptions`, `records[]` (capped), `handovers[]`, `activities[]`, `payments[]`, `reportRef`.

## UI

`#/reports` → period select, date, department (locked for staff), optional staff/stage/status → **Generate** → on-screen layout → **Download Excel** using the same filters.

## Related

- Permissions: [`RBAC.md`](RBAC.md) (`runReports` action)
- System map: [`SYSTEM.md`](SYSTEM.md)
