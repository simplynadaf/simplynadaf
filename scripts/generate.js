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
        repositories(first:100, ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC){
          totalCount
          nodes{
            name description stargazerCount forkCount isArchived url pushedAt
            primaryLanguage{ name }
            repositoryTopics(first:4){ nodes{ topic{ name } } }
          }
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

  // Dynamic project cards: top repos by stars, then recency; skip archived + the profile repo.
  const ranked = repos
    .filter(r => !r.isArchived && r.name.toLowerCase() !== USER.toLowerCase() && r.description)
    .sort((a, b) => (b.stargazerCount - a.stargazerCount) || (new Date(b.pushedAt) - new Date(a.pushedAt)))
    .slice(0, 4);
  writeCards(ranked);

  // Dev.to writing section (optional).
  const devUser = process.env.DEVTO_USER;
  if (devUser) {
    try {
      const r = await fetch(`https://dev.to/api/articles?username=${encodeURIComponent(devUser)}&per_page=4`);
      if (r.ok) {
        const arts = await r.json();
        if (Array.isArray(arts) && arts.length) writeWriting(arts.slice(0, 4));
      }
    } catch (e) { console.warn('Dev.to fetch failed:', e.message); }
  }

  console.log('Regenerated stats, city, cards' + (devUser ? ', writing' : ''));
}

// ---- dynamic project cards ----
function tagFromRepo(r) {
  const topics = (r.repositoryTopics?.nodes || []).map(n => n.topic.name.toUpperCase());
  const pick = topics.filter(t => !['HACKTOBERFEST'].includes(t)).slice(0, 2);
  if (pick.length) return pick.join(' · ');
  return (r.primaryLanguage?.name || 'CODE').toUpperCase();
}
function wrapDesc(s, width = 44) {
  const words = (s || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width) { lines.push(cur.trim()); cur = w; }
    else cur += ' ' + w;
    if (lines.length === 2) break;
  }
  if (cur && lines.length < 2) lines.push(cur.trim());
  while (lines.length < 2) lines.push('');
  if (lines[1].length > width) lines[1] = lines[1].slice(0, width - 1) + '…';
  return lines;
}
function cardSvg(r) {
  const id = r.name.replace(/[^a-z0-9]/gi, '');
  const title = esc(r.name.toUpperCase().slice(0, 22));
  const [d0, d1] = wrapDesc(r.description).map(esc);
  const tag = esc(tagFromRepo(r));
  const lang = esc(r.primaryLanguage?.name || '—');
  const stars = r.stargazerCount;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="430" height="150" viewBox="0 0 430 150" role="img" aria-labelledby="t d">
<title id="t">${title}</title>
<desc id="d">${esc(r.description || r.name)}</desc>
<style>
${FF}
text{font-family:'JBM',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace}
.cy{fill:#00d9ff}.fg{fill:#c9d1d9}.dim{fill:#8b949e}.gr{fill:#3fb950}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.dot{animation:pulse 2.6s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<defs>
<pattern id="grid${id}" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M22 0H0V22" fill="none" stroke="#00d9ff" stroke-opacity=".05"/></pattern>
<filter id="g${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter>
</defs>
<rect x="6" y="8" width="418" height="134" rx="6" fill="#03040a" stroke="#00d9ff" stroke-opacity=".45"/>
<rect x="6" y="8" width="418" height="134" rx="6" fill="url(#grid${id})"/>
<rect x="6" y="8" width="418" height="30" fill="#00d9ff" fill-opacity=".07"/>
<line x1="6" y1="38" x2="424" y2="38" stroke="#00d9ff" stroke-opacity=".35"/>
<text x="22" y="28" class="cy" letter-spacing="1" style="font-size:12px">&gt; ${tag}</text>
<circle class="dot" cx="406" cy="23" r="3.2" fill="#3fb950"/>
<circle class="dot" cx="406" cy="23" r="3.2" fill="#3fb950" filter="url(#g${id})"/>
<text x="22" y="66" class="fg" font-weight="800" style="font-size:18px">${title}</text>
<text x="22" y="92" class="dim" style="font-size:12.5px">${d0}</text>
<text x="22" y="110" class="dim" style="font-size:12.5px">${d1}</text>
<circle cx="26" cy="128" r="4" fill="#00d9ff"/>
<text x="38" y="132" class="dim" style="font-size:12px">${lang}</text>
<text x="150" y="132" class="gr" style="font-size:12px">★ ${stars}</text>
<path d="M398 124h10v10" fill="none" stroke="#00d9ff" stroke-width="1.4"/>
</svg>\n`;
}
function writeCards(repos) {
  const manifest = [];
  repos.forEach(r => {
    const file = `card-${r.name}.svg`;
    fs.writeFileSync(path.join(ROOT, 'assets', file), cardSvg(r));
    manifest.push({ name: r.name, url: r.url, file: `assets/${file}`, desc: r.description || r.name });
  });
  fs.writeFileSync(path.join(ROOT, 'assets', 'cards.json'), JSON.stringify(manifest, null, 2));
}

// ---- Dev.to writing cards ----
function writingCardSvg(a, i) {
  const title = wrapDesc(a.title, 48).map(esc);
  const date = esc((a.published_at || '').slice(0, 10));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="880" height="86" viewBox="0 0 880 86" role="img" aria-labelledby="t d">
<title id="t">${esc(a.title)}</title>
<desc id="d">${esc(a.title)} — published ${date}, ${a.public_reactions_count} reactions, ${a.comments_count} comments.</desc>
<style>
${FF}
text{font-family:'JBM',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace}
.cy{fill:#00d9ff}.fg{fill:#c9d1d9}.dim{fill:#8b949e}.gr{fill:#3fb950}
</style>
<defs><filter id="gw${i}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter></defs>
<rect x="6" y="6" width="868" height="74" rx="6" fill="#03040a" stroke="#00d9ff" stroke-opacity=".4"/>
<rect x="6" y="6" width="868" height="74" rx="6" fill="#00d9ff" fill-opacity=".04"/>
<rect x="18" y="20" width="46" height="24" rx="4" fill="#00d9ff" fill-opacity=".12" stroke="#00d9ff" stroke-opacity=".5"/>
<text x="26" y="37" class="cy" font-weight="800" style="font-size:12px">POST</text>
<text x="82" y="34" class="fg" font-weight="700" style="font-size:14px">${title[0]}</text>
<text x="82" y="54" class="fg" font-weight="700" style="font-size:14px">${title[1]}</text>
<text x="82" y="72" class="dim" style="font-size:11.5px">${date} · <tspan class="gr">♥ ${a.public_reactions_count}</tspan> · <tspan class="cy">${a.comments_count} comments</tspan></text>
<path d="M848 60h10v10" fill="none" stroke="#00d9ff" stroke-width="1.4"/>
</svg>\n`;
}
function writeWriting(arts) {
  // section divider
  fs.writeFileSync(path.join(ROOT, 'assets', 'writing.svg'), sectionDivider('WRITING'));
  const manifest = [];
  arts.forEach((a, i) => {
    const file = `writing/post-${i + 1}.svg`;
    fs.mkdirSync(path.join(ROOT, 'assets', 'writing'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'assets', file), writingCardSvg(a, i));
    manifest.push({ title: a.title, url: a.url, file: `assets/${file}` });
  });
  fs.writeFileSync(path.join(ROOT, 'assets', 'writing', 'posts.json'), JSON.stringify(manifest, null, 2));
}
function sectionDivider(label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="880" height="60" viewBox="0 0 880 60" role="img" aria-labelledby="t">
<title id="t">${esc(label)}</title>
<style>
${FF}
text{font-family:'JBM',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace}
.cy{fill:#00d9ff}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.dot{animation:pulse 2s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<defs><filter id="gd" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter></defs>
<rect width="880" height="60" fill="#03040a"/>
<line x1="16" y1="30" x2="300" y2="30" stroke="#00d9ff" stroke-opacity=".3"/>
<line x1="580" y1="30" x2="864" y2="30" stroke="#00d9ff" stroke-opacity=".3"/>
<circle class="dot" cx="312" cy="30" r="3.5" fill="#00d9ff"/><circle class="dot" cx="312" cy="30" r="3.5" fill="#00d9ff" filter="url(#gd)"/>
<text x="440" y="35" text-anchor="middle" letter-spacing="4" class="cy" font-weight="700" style="font-size:16px">// ${esc(label)}</text>
<circle class="dot" cx="568" cy="30" r="3.5" fill="#00d9ff"/><circle class="dot" cx="568" cy="30" r="3.5" fill="#00d9ff" filter="url(#gd)"/>
</svg>\n`;
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
  // Isometric neon skyline: one building per WEEK of the last year (52 fit cleanly).
  const W = 880, H = 260;
  // aggregate days into weeks of 7
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    const slice = days.slice(i, i + 7);
    weeks.push(slice.reduce((a, d) => a + d.contributionCount, 0));
  }
  const max = Math.max(1, ...weeks);
  const baseY = 206, originX = 42;
  const usable = (W - 34) - originX;
  const depth = 5;                      // isometric depth (side face)
  const gap = 2;
  const fw = Math.max(8, Math.floor((usable - weeks.length * (depth + gap)) / weeks.length));
  const step = fw + depth + gap;

  // tier -> [front, side(darker), top(lighter)]
  const palette = [
    ['#0c2430', '#081820', '#143644'], // zero / idle plots
    ['#0e5566', '#0a3b47', '#1b7f93'], // low
    ['#0f93b0', '#0a6d82', '#28b6d2'], // mid
    ['#00c2e6', '#0090ad', '#5fe4ff'], // high
    ['#00d9ff', '#00a7c4', '#aef4ff'], // peak
  ];
  const tierFor = c => {
    if (c === 0) return 0;
    const r = c / max;
    if (r < 0.25) return 1;
    if (r < 0.5) return 2;
    if (r < 0.75) return 3;
    return 4;
  };

  let buildings = '', glows = '';
  weeks.forEach((c, i) => {
    const x = originX + i * step;
    if (x + fw + depth > W - 34) return;
    const t = tierFor(c);
    const [front, side, top] = palette[t];
    const hgt = c === 0 ? 4 : 18 + Math.sqrt(c / max) * 140;
    const yTop = baseY - hgt;

    // front face
    buildings += `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${fw}" height="${hgt.toFixed(1)}" fill="${front}"/>`;
    // side face (parallelogram, pushed up-right for iso depth)
    buildings += `<path d="M${(x + fw).toFixed(1)} ${baseY} L${(x + fw).toFixed(1)} ${yTop.toFixed(1)} L${(x + fw + depth).toFixed(1)} ${(yTop - depth).toFixed(1)} L${(x + fw + depth).toFixed(1)} ${(baseY - depth).toFixed(1)} Z" fill="${side}"/>`;
    // top face (rhombus)
    buildings += `<path d="M${x.toFixed(1)} ${yTop.toFixed(1)} L${(x + fw).toFixed(1)} ${yTop.toFixed(1)} L${(x + fw + depth).toFixed(1)} ${(yTop - depth).toFixed(1)} L${(x + depth).toFixed(1)} ${(yTop - depth).toFixed(1)} Z" fill="${top}"/>`;
    // lit window strip + glow for taller tiers
    if (t >= 2) {
      glows += `<rect x="${(x + 1.5).toFixed(1)}" y="${yTop.toFixed(1)}" width="${(fw - 3).toFixed(1)}" height="3" fill="#f0fbff" opacity=".9"/>`;
    }
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">Contribution city</title>
<desc id="d">An isometric neon skyline with one building per day of the last year. ${meta.total} contributions, busiest day ${esc(meta.busiest.date)} with ${meta.busiest.contributionCount}.</desc>
<style>
${FF}
text{font-family:'JBM',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace}
.cy{fill:#00d9ff}.dim{fill:#8b949e}.gr{fill:#3fb950}
</style>
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#03040a"/><stop offset="1" stop-color="#061420"/></linearGradient>
<filter id="winglow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.6"/></filter>
</defs>
<rect x="16" y="8" width="${W - 32}" height="${H - 16}" rx="4" fill="url(#sky)" stroke="#00d9ff" stroke-opacity=".4"/>
<rect x="16" y="8" width="${W - 32}" height="30" fill="#00d9ff" fill-opacity=".08"/>
<line x1="16" y1="38" x2="${W - 16}" y2="38" stroke="#00d9ff" stroke-opacity=".4"/>
<text x="32" y="28" class="cy" letter-spacing="2" style="font-size:13px">$ render ./contribution-city --year</text>
<text x="${W - 34}" y="28" text-anchor="end" class="dim" style="font-size:12px">${meta.total} commits</text>
${buildings}
<g filter="url(#winglow)">${glows}</g>
<line x1="40" y1="${baseY}" x2="${W - 40}" y2="${baseY}" stroke="#00d9ff" stroke-opacity=".45"/>
<text x="40" y="238" class="dim" style="font-size:12px"><tspan class="gr">$</tspan> one bar = one week · busiest <tspan class="cy">${esc(meta.busiest.date)}</tspan> (${meta.busiest.contributionCount})</text>
</svg>\n`;
  fs.writeFileSync(path.join(ROOT, 'assets', 'contribution-city.svg'), svg);
}

main().catch(e => { console.error(e); process.exit(1); });
