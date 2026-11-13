# Issues found in the project V1

## 1. Dashboard shows only the total across accounts
**Problem:** the "Património Líquido Total" hero card shows only the summed balance.
**Fix:** keep the total and add a per-account breakdown inside the card (one row per
account: name + balance), so the total is immediately explainable.
- Files: `client/src/pages/DashboardPage.jsx` (UI only — `/api/accounts/balances` already returns per-account balances).
**Status: done**

## 2. Account type cannot be changed after creation
**Problem:** `AccountModal.jsx` is create-only; there is no way to edit an existing account.
**Fix:** edit mode for the account modal + edit button on each account card.
- `client/src/components/AccountModal.jsx`: accept an optional `account` prop → edit mode
  ("Editar Conta"), pre-filled fields, submits `PATCH /api/accounts/:id` (`api.updateAccount`).
- `client/src/pages/AccountsPage.jsx`: "Editar" button on each account card.
- Backend: no change needed — `PATCH /api/accounts/:id` and `updateAccountSchema` already
  accept `name`, `type`, `initial_balance_cents`.
- Note in the modal: editing the initial balance retroactively shifts all historical balances.
**Status: done**

## 3. Investment accounts: interest rate (%) and periodicity, auto-generate income
**Problem:** investment accounts have no interest rate or periodicity.
**Fix (user decision: auto-generate confirmed income transactions):**
- Migration `server/src/migrations/003_account_interest.sql`:
  - `ALTER TABLE accounts ADD COLUMN interest_rate REAL` (percent, e.g. `2.85`)
  - `ALTER TABLE accounts ADD COLUMN interest_period TEXT` (`'monthly'` | `'annual'` | NULL)
- Backend:
  - `server/src/schemas/account.js`: optional `interest_rate` (0–100) and `interest_period`;
    only allowed when `type === 'investment'`.
  - `server/src/services/accountService.js`: persist/return the new fields (create, update,
    and include in the balances SELECT).
  - New interest generator (called from the daily generator run):
    - Monthly: first run of each month posts a **confirmed** income transaction
      "Juros — <conta>" dated the last day of the previous month;
      amount = `round(balance_at_period_end × rate/100 / 12)`.
    - Annual: first run of each January, dated Dec 31; amount = `round(balance × rate/100)`.
    - Balance at period end = initial balance + confirmed transactions up to that date.
    - Idempotency: new `interest_postings` table with `UNIQUE(account_id, period)`.
    - Money stays as integer cents.
- Frontend:
  - `AccountModal`: when type = investment → "Taxa de juro (%)" + periodicity select
    ("Mensal"/"Anual"); fields hidden for other types.
  - Account cards (`AccountsPage`, `DashboardPage`): rate badge
    ("2,85% ao ano") + estimated periodic yield.
**Status: done**

## 4. Categories are not editable
**Problem:** the categories page is read-only; no create/edit/delete. Backend has `PATCH`
but no `DELETE` route or service method.
**Fix (user decision: archive when in use):**
- Backend:
  - `DELETE /api/categories/:id` semantics:
    - Has transactions or active children → **archive** (soft delete, history intact);
      archiving a parent cascades to its children.
    - Unused leaf (no transactions, no children) → hard delete.
  - `categoryService.deleteCategory(id)` implementing the above.
- Frontend:
  - New `CategoryModal.jsx` for create/edit (name, kind, parent, budget group; max 2 levels,
    no cycles).
  - `CategoriesPage.jsx`: "Nova Categoria" button + edit/delete buttons on every node;
    delete confirm dialog explains the archive-vs-delete outcome.
**Status: done**
