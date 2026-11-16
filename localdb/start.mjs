import EmbeddedPostgres from 'embedded-postgres';
const pg = new EmbeddedPostgres({ databaseDir: '/tmp/pgdata/d', user: 'postgres', password: 'pw', port: 5433, persistent: true });
const fs = await import('fs');
if (!fs.existsSync('/tmp/pgdata/d/PG_VERSION')) await pg.initialise();
await pg.start();
console.log('pg up');
setInterval(()=>{}, 1<<30);
