// Hash every lock-key template the code takes for the mix business, to match
// against pg_locks objids.
import { Client } from "pg";

const pg = new Client({ connectionString: "postgres://pos:pos@localhost:5433/pos_load" });
await pg.connect();
const biz = (await pg.query('SELECT "id" FROM "Business" ORDER BY "createdAt" DESC LIMIT 1')).rows[0].id;
const keys = [
  `sales:${biz}`,
  `billing:${biz}`,
  `refunds:${biz}:sale1`,
  `register:${biz}:reg1`,
  `shift:${biz}:shift1`,
  `${biz}::prod1`,
  `rate-limit:${biz}:complete`,
  `rate-limit:${biz}:reconcile`,
  `transfer:${biz}:t1`,
];
for (const k of keys) {
  const h = (await pg.query("SELECT hashtext($1)::text AS h", [k])).rows[0].h;
  console.log(h, "←", k);
}
await pg.end();
