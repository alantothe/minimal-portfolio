/**
 * The ordered schema history.
 *
 * Discipline, enforced by the runner in `migrator.ts`:
 *
 * - Migrations are append-only. Never edit or renumber one that has shipped;
 *   the runner checksums applied migrations and refuses to start if one changed
 *   underneath it.
 * - Changes are additive (expand-contract). Add a column or table, backfill,
 *   move reads, and only drop the old shape in a later migration once no
 *   running release depends on it. A deploy replaces one running container, so
 *   for a moment neither release should be broken by the schema.
 */

export interface Migration {
  id: number;
  name: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "create_system_state",
    statements: [
      // The cutover from repository content to database content runs through an
      // explicit persisted phase rather than an informal flag, so a restart can
      // never lose track of which content source is authoritative. Slice 2 only
      // establishes it; `legacy` means nothing reads from this database yet.
      `CREATE TABLE system_state (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         cutover_phase TEXT NOT NULL
           CHECK (cutover_phase IN (
             'legacy',
             'shadow',
             'sqlite-observation',
             'sealed'
           )),
         updated_at TEXT NOT NULL
       )`,
      `INSERT INTO system_state (id, cutover_phase, updated_at)
       VALUES (1, 'legacy', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    ],
  },
];
