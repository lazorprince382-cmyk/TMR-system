# Harmoniq — Training Management & Reporting System

A responsive Node.js and PostgreSQL application for daily trainer reporting, learner attendance, and automated weekly, monthly, and annual analysis.

## Included

- Role-based access for HR/Admin, voice, instrument, and vocal/choir trainers
- Daily session reports with per-learner attendance
- Automatic period summaries and attendance statistics
- Trainer, learner, program, enrollment, and audit data models
- PDF and Excel exports plus print-friendly reports
- Responsive HR and trainer dashboards
- Transaction-safe report submission

## Run locally

1. Create a PostgreSQL database named `tmr_system`.
2. Copy `.env.example` to `.env` and update `DATABASE_URL` and `JWT_SECRET`.
3. Install and initialize:

   ```powershell
   npm install
   npm run db:setup
   npm start
   ```

4. Open <http://localhost:3000>.

Demo administrator: `admin@tmr.local` / `Welcome123!`

Trainer demo accounts use `voice@tmr.local`, `instrument@tmr.local`, or `choir@tmr.local` with the same password.

## Reporting rules

- Weekly periods begin on the selected date and span seven days.
- Monthly and annual reports use calendar periods.
- `present` and `late` count as attended; `absent` and `excused` do not.
- Only completed sessions appear in analytics.

For production, serve behind HTTPS, set a strong `JWT_SECRET`, use a managed PostgreSQL database, and add scheduled backups.
