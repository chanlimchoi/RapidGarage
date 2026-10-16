# Backend Starter Code


## Setup

- Edit `package.json`
    + Add your project name, version, description, authors
    + Add any other packages you may need

- Edit `config/config.json`
    + Add your username, password, and database names


## Explanations

- `/config/config.json`
    + This file contains the credentials for connecting to your postgres database. You need to make sure these details match your DB setup.
- `/controllers`
    + This is where you should store all the logic handling URL routes and business logic for your app.
    + `index.js` is where you load up the different files
    + You can write your controller code in many styles. I've provided you two options in the `home.js` and the `alt.js` files. Pick one style and use it for all of your controllers. This is really a matter of preference.
- `/models`
    + This is where your sequelize models will go.
    + `index.js`: you **do not** have to modify this file. This file connects to the Postgres database for you, loads up all models in the folder, and sets up all associations.
- `app.js`
    + This file sets up the basic packages for our projects. Feel free to add more as you see fit.
    + This file already loads up your controllers, so no additional loading is necessary for that to work.

## Upgrading an existing database (backup first)

The 2026 migrations add `Users.email NOT NULL` + `UNIQUE`, and `Posts.userId NOT NULL`
with a foreign key to `Users(id)`. Existing data that violates these makes `npm run migrate`
fail. Before migrating a database that already has data:

1. **Back up first.** `pg_dump "$DATABASE_URL" -Fc -f rapidgarage-$(date +%Y%m%d-%H%M).dump`
   and confirm it restores: `pg_restore -l <file> | head`. Stop the app (or put it in
   maintenance) so nothing writes during the upgrade.
2. **Check (read-only):** `npm run db:precheck`. Prints a report; exits 1 if the migrations would fail.
3. **Preview the fix (dry run, changes nothing):** `npm run db:cleanup`
4. **Apply:** `npm run db:cleanup -- --apply` (optionally `--orphan-owner-id=<userId>` or
   `ORPHAN_POST_OWNER_ID=<userId>`). All changes run in one transaction; on any error or if
   blockers remain, everything is rolled back.
5. `npm run db:precheck` again (should print `OK`), then `npm run migrate`.
6. To undo the cleanup, restore the backup: `pg_restore --clean --if-exists -d "$DATABASE_URL" <file>`.

Cleanup rules (conservative; users are never deleted):

- **Duplicate emails** (compared trimmed + case-insensitive): the oldest account
  (`createdAt`, then lowest id) is kept. Posts of the other accounts are reassigned to it, and
  their emails are renamed to `local+dup-<id>@domain` so they stay unique and traceable.
- **NULL / empty / whitespace emails:** set to `missing-email+<id>@invalid.invalid`
  (`.invalid` is a reserved domain, so nothing is ever emailed there).
- **Remaining emails** are trimmed and lower-cased; login lower-cases input, so mixed-case
  emails could not sign in anyway.
- **Posts with no owner / a missing owner:** reassigned to the configured owner id (must be an
  existing user). If none is set they are reported and left alone, and the command exits 1
  because the migration would still fail.
- `Subscribers.zipCode` INTEGER→VARCHAR and the new `googleId` / `role` columns cannot fail on
  existing data, so they need no cleanup.

## Optional

- If you want to add views and handlebars to your server side
    + Uncomment the corresponding code in `app.js`
    + Add a `/views` folder and the appropriate templates



