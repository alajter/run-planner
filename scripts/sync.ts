// Local sync: `npm run sync` (add `-- --full` to re-read the whole history and analyze every run).
import { sync } from "../src/lib/sync";
sync(process.argv.includes("--full") ? { full: true, analyzeLimit: 1000 } : {}).then(r => { console.log(JSON.stringify(r, null, 1)); process.exit(r.errors.length ? 1 : 0); });
