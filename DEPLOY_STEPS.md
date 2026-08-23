# ProjectSignal England territory update — deploy steps

The Supabase schema migrations for this update have already been applied to the connected production ProjectSignal database during the build session. These migration files are included here so the repo records the database state.

## 1. Copy this project over the local ProjectSignal folder

Do not delete your existing `.env.local`, `.git`, `.vercel`, or `node_modules` folders. Extract/copy these updated files over the repo so changed source files are replaced while local secrets and Git history remain in place.

## 2. Install and verify

```powershell
cd C:\Users\jbran\OneDrive\Desktop\projectsignal-app
npm install
npm test
npm run typecheck
npm run build
```

Expected test result: 25 tests passing.

## 3. Review changed files

```powershell
git status
git diff --stat
```

Do not commit `.env.local` or any secret values.

## 4. Commit and push

```powershell
git add app lib supabase tests docs package.json package-lock.json tsconfig.json vercel.json DEPLOY_STEPS.md
git commit -m "Build England county territory and national planning scanner"
git push
```

If Vercel is connected to the GitHub repo, the push should create a deployment. Otherwise run:

```powershell
npx vercel --prod
```

## 5. Production checks

1. Open `/dashboard/territory` on the existing active test account.
2. Choose up to three counties and lock them once.
3. Confirm the page becomes view-only after saving.
4. Manually trigger `/api/cron/scan-wigan` with the existing CRON secret, or wait for `/api/cron/scan-planning` to run from Vercel cron.
5. Confirm Wigan source succeeds in Supabase, then mark Wigan coverage live only after the generic worker has proven it.

## Notes

- ProjectSignal Pro remains £79/month and includes three counties.
- Only active subscriptions receive new leads.
- Existing radius fields remain temporarily for backward compatibility.
- New county entitlements do not unlock applications first seen before the entitlement start time.
- Wigan now runs through the generic source registry and CSV adapter.
