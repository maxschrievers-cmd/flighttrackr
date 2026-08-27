const base = process.env.APP_BASE_URL;
if (!base) {
  console.error('APP_BASE_URL is required');
  process.exit(1);
}
const url = `${base.replace(/\/$/, '')}/api/monitor/run`;
const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-monitor-key': process.env.MONITOR_KEY || '' } });
const body = await res.text();
console.log(res.status, body);
if (!res.ok) process.exit(1);
