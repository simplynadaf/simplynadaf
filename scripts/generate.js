#!/usr/bin/env node
/**
 * Regenerates assets/stats.svg and assets/contribution-city.svg from live GitHub data.
 * Requires env: GH_TOKEN (a token with read:user), GH_USER (defaults to simplynadaf).
 * Uses only Node built-ins (fetch available in Node 18+). No external deps.
 */
const fs = require('fs');
const path = require('path');

const USER = process.env.GH_USER || 'simplynadaf';
const TOKEN = process.env.GH_TOKEN;
const ROOT = path.resolve(__dirname, '..');
function safeRead(p) { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; } }
// Self-contained: fontface is committed alongside the script.
const FF = safeRead(path.join(ROOT, 'scripts', 'fontface.css')) || safeRead('/tmp/fontface.css');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function gh(query, variables) {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`GraphQL ${r.status}: ${await r.text()}`);
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

async function main() {
  if (!TOKEN) throw new Error('GH_TOKEN is required');

  const data = await gh(`
    query($login:String!){
      user(login:$login){
        followers{totalCount}
        repositories(first:100, ownerAffiliations:OWNER, isFork:false){
          totalCount
          nodes{ stargazerCount forkCount }
        }
        contributionsCollection{
          totalCommitContributions
          totalPullRequestContributions
          contributionCalendar{
            totalContributions
            weeks{ contributionDays{ contributionCount date weekday } }
          }
        }
      }
    }`, { login: USER });

  const u = data.user;
  const repos = u.repositories.nodes;
  const stars = repos.reduce((a, r) => a + r.stargazerCount, 0);
  const forks = repos.reduce((a, r) => a + r.forkCount, 0);
  const cc = u.contributionsCollection;
  const cal = cc.contributionCalendar;
  const days = cal.weeks.flatMap(w => w.contributionDays);

  // streaks
  let cur = 0, longest = 0, run = 0;
  for (const d of days) {
    if (d.contributionCount > 0) { run++; longest = Math.max(longest, run); }
    else run = 0;
  }
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) cur++; else break;
  }
  const busiest = days.reduce((m, d) => d.contributionCount > m.contributionCount ? d : m, days[0]);

  writeStats({
    stars, forks, followers: u.followers.totalCount,
    repos: u.repositories.totalCount,
    yearContribs: cal.totalContributions,
    prs: cc.totalPullRequestContributions,
    cur, longest,
  });
  writeCity(days, { total: cal.totalContributions, busiest });
  console.log('Regenerated stats.svg and contribution-city.svg');
}

function panel(w, h, title, bodyLines) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d">
<title id="t">Stats</title><desc id="d">${esc(title)}</desc>
<style>
${FF}
text{font-family:'JBM',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace}
.cy{fill:#00d9ff}.fg{fill:#c9d1d9}.dim{fill:#8b949e}.gr{fill:#3fb950}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.dot{animation:pulse 2.4s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<defs>
<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#00d9ff" stroke-opacity=".05"/></pattern>
<filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter>
</defs>
<rect x="16" y="8" width="${w - 32}" height="${h - 16}" rx="4" fill="#03040a" stroke="#00d9ff" stroke-opacity=".4"/>
<rect x="16" y="8" width="${w - 32}" height="${h - 16}" fill="url(#grid)"/>
<rect x="16" y="8" width="${w - 32}" height="30" fill="#00d9ff" fill-opacity=".08"/>
<line x1="16" y1="38" x2="${w - 16}" y2="38" stroke="#00d9ff" stroke-opacity=".4"/>
<text x="32" y="28" class="cy" letter-spacing="2" style="font-size:13px">$ gh stats --live</text>
<circle class="dot" cx="${w - 34}" cy="23" r="3.5" fill="#3fb950"/>
<circle class="dot" cx="${w - 34}" cy="23" r="3.5" fill="#3fb950" filter="url(#g)"/>
${bodyLines}
</svg>\n`;
}

function writeStats(s) {
  const row = (x, y, label, val) =>
    `<text x="${x}" y="${y}" class="gr" style="font-size:13px">${esc(label)}</text>` +
    `<text x="${x + 150}" y="${y}" class="fg" font-weight="700" style="font-size:16px">${esc(val)}</text>`;
  const body = [
    row(40, 82, '[contributions]', `${s.yearContribs} this year`),
    row(40, 122, '[stars]', `${s.stars}`),
    row(40, 162, '[pull requests]', `${s.prs}`),
    row(440, 82, '[followers]', `${s.followers}`),
    row(440, 122, '[repos]', `${s.repos}`),
    row(440, 162, '[streak]', `${s.cur}d · max ${s.longest}d`),
    `<text x="40" y="206" class="dim" style="font-size:12px"><tspan class="gr">$</tspan> last sync — auto-updated daily via GitHub Actions</text>`,
  ].join('\n');
  fs.writeFileSync(path.join(ROOT, 'assets', 'stats.svg'), panel(880, 230, 'GitHub stats', body));
}

function writeCity(days, meta) {
  // isometric skyline: one building per day of the last ~year
  const W = 880, H = 260;
  const max = Math.max(1, ...days.map(d => d.contributionCount));
  const n = days.length;
  const bw = 7, gap = 1.6, baseY = 210, originX = 40;
  const colFor = c => c === 0 ? '#0a1a24' : c < max * .25 ? '#0e4f5f' : c < max * .5 ? '#0f7f99' : c < max * .75 ? '#00b3d6' : '#00d9ff';
  let bars = '';
  days.forEach((d, i) => {
    const x = originX + i * (bw + gap);
    if (x > W - 40) return;
    const hgt = d.contributionCount === 0 ? 2 : 4 + (d.contributionCount / max) * 150;
    const y = baseY - hgt;
    const col = colFor(d.contributionCount);
    // building face + top highlight
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${hgt.toFixed(1)}" fill="${col}" opacity="${d.contributionCount ? 0.9 : 0.5}"/>`;
    if (d.contributionCount) bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="2" fill="#f0fbff" opacity=".8"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">Contribution city</title>
<desc id="d">A neon skyline with one building per day of the last year. ${meta.total} contributions, busiest day ${esc(meta.busiest.date)} with ${meta.busiest.contributionCount}.</desc>
<style>
${FF}
text{font-family:'JBM',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace}
.cy{fill:#00d9ff}.dim{fill:#8b949e}.gr{fill:#3fb950}
</style>
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03040a"/><stop offset="1" stop-color="#061018"/></linearGradient>
<filter id="cityglow" x="-5%" y="-20%" width="110%" height="160%"><feGaussianBlur stdDeviation="2.2"/></filter>
</defs>
<rect x="16" y="8" width="${W - 32}" height="${H - 16}" rx="4" fill="url(#sky)" stroke="#00d9ff" stroke-opacity=".4"/>
<rect x="16" y="8" width="${W - 32}" height="30" fill="#00d9ff" fill-opacity=".08"/>
<line x1="16" y1="38" x2="${W - 16}" y2="38" stroke="#00d9ff" stroke-opacity=".4"/>
<text x="32" y="28" class="cy" letter-spacing="2" style="font-size:13px">$ render ./contribution-city --year</text>
<text x="${W - 34}" y="28" text-anchor="end" class="dim" style="font-size:12px">${meta.total} commits</text>
<g filter="url(#cityglow)">${bars}</g>
<line x1="${40}" y1="210" x2="${W - 40}" y2="210" stroke="#00d9ff" stroke-opacity=".4"/>
<text x="40" y="238" class="dim" style="font-size:12px"><tspan class="gr">$</tspan> busiest day <tspan class="cy">${esc(meta.busiest.date)}</tspan> — ${meta.busiest.contributionCount} contributions</text>
</svg>\n`;
  fs.writeFileSync(path.join(ROOT, 'assets', 'contribution-city.svg'), svg);
}

main().catch(e => { console.error(e); process.exit(1); });
