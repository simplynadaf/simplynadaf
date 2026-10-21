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
        createdAt
        followers{totalCount}
        mergedPRs: pullRequests(states:MERGED){ totalCount }
        allPRs: pullRequests{ totalCount }
        repositories(first:100, ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC){
          totalCount
          nodes{
            name description stargazerCount forkCount isArchived url pushedAt
            primaryLanguage{ name }
            languages(first:10, orderBy:{field:SIZE, direction:DESC}){
              edges{ size node{ name } }
            }
            repositoryTopics(first:4){ nodes{ topic{ name } } }
          }
        }
        contributionsCollection{
          totalCommitContributions
          totalPullRequestContributions
          totalPullRequestReviewContributions
          pullRequestContributionsByRepository(maxRepositories:100){
            repository{ nameWithOwner isPrivate owner{ login } }
            contributions{ totalCount }
          }
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
    prs: u.allPRs.totalCount, mergedPRs: u.mergedPRs.totalCount,
    cur, longest, createdAt: u.createdAt,
  });
  writeCity(days, { total: cal.totalContributions, busiest });

  // Dynamic project cards: top repos by stars, then recency; skip archived + the profile repo.
  const ranked = repos
    .filter(r => !r.isArchived && r.name.toLowerCase() !== USER.toLowerCase() && r.description)
    .sort((a, b) => (b.stargazerCount - a.stargazerCount) || (new Date(b.pushedAt) - new Date(a.pushedAt)))
    .slice(0, 4);
  writeCards(ranked);

  // ---- C) language spectrum (bytes across all repos) ----
  const langBytes = {};
  for (const r of repos) {
    for (const e of (r.languages?.edges || [])) {
      langBytes[e.node.name] = (langBytes[e.node.name] || 0) + e.size;
    }
  }
  const langTotal = Object.values(langBytes).reduce((a, b) => a + b, 0) || 1;
  const langs = Object.entries(langBytes)
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([name, size]) => ({ name, pct: size / langTotal }));
  writeSpectrum(langs);

  // ---- D) now-building ticker (most recently pushed non-archived, non-profile repo) ----
  const latest = repos
    .filter(r => !r.isArchived && r.name.toLowerCase() !== USER.toLowerCase())
    .sort((a, b) => new Date(b.pushedAt) - new Date(a.pushedAt))[0];
  writeTicker(latest, { repos: u.repositories.totalCount });

  // ---- E) open-source radar: PRs opened in OTHER people's repos ----
  const external = (cc.pullRequestContributionsByRepository || [])
    .filter(x => !x.repository.isPrivate && x.repository.owner.login.toLowerCase() !== USER.toLowerCase())
    .map(x => ({ repo: x.repository.nameWithOwner, count: x.contributions.totalCount }))
    .sort((a, b) => b.count - a.count).slice(0, 8);
  writeRadar(external, { reviews: cc.totalPullRequestReviewContributions });

  // Dev.to writing section (optional) — also feeds the B) signal oscilloscope + Dev stats block.
  const devUser = process.env.DEVTO_USER;
  if (devUser) {
    try {
      const r = await fetch(`https://dev.to/api/articles?username=${encodeURIComponent(devUser)}&per_page=1000`);
      let profile = null;
      try {
        const pr = await fetch(`https://dev.to/api/users/by_username?url=${encodeURIComponent(devUser)}`);
        if (pr.ok) profile = await pr.json();
      } catch {}
      if (r.ok) {
        const all = await r.json();
        if (Array.isArray(all) && all.length) {
          writeWriting(all.slice(0, 4));
          writeSignal(all.slice(0, 16));
          const totals = {
            articles: all.length,
            reactions: all.reduce((a, x) => a + (x.public_reactions_count || 0), 0),
            comments: all.reduce((a, x) => a + (x.comments_count || 0), 0),
            joined: profile ? profile.joined_at : null,
          };
          writeDevStats(totals);
        }
      }
    } catch (e) { console.warn('Dev.to fetch failed:', e.message); }
  }

  console.log('Regenerated stats, city, cards, spectrum, ticker, radar' + (devUser ? ', writing, signal, devstats' : ''));
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

function fmt(n) { return Number(n).toLocaleString('en-US'); }

// boxed glow stat tile (George-style)
function statTile(x, y, w, label, big, sub) {
  return `<rect x="${x}" y="${y}" width="${w}" height="92" fill="#00d9ff" fill-opacity=".035" stroke="#00d9ff" stroke-opacity=".35"/>
<path d="M${x} ${y + 12}V${y}H${x + 12}" fill="none" stroke="#00d9ff" stroke-width="2"/>
<text x="${x + 16}" y="${y + 24}" letter-spacing="1.5" class="dim" style="font-size:10.5px">${esc(label)}</text>
<text x="${x + 16}" y="${y + 52}" font-weight="700" fill="#00d9ff" filter="url(#g)" opacity=".55" style="font-size:28px">${esc(big)}</text>
<text x="${x + 16}" y="${y + 52}" font-weight="700" fill="#00d9ff" style="font-size:28px">${esc(big)}</text>
<text x="${x + 16}" y="${y + 80}" fill="#6e7681" style="font-size:12px">${esc(sub)}</text>`;
}

function writeStats(s) {
  const W = 880, H = 300;
  const age = s.createdAt ? `${new Date().getFullYear() - new Date(s.createdAt).getFullYear()}y on GitHub` : '';
  const since = s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
  const tiles = [
    statTile(40, 78, 182, 'CONTRIBUTIONS 2026', fmt(s.yearContribs), 'this year'),
    statTile(238, 78, 182, 'TOTAL STARS', fmt(s.stars), 'across all repos'),
    statTile(436, 78, 182, 'PULL REQUESTS', fmt(s.prs), `${fmt(s.mergedPRs)} merged`),
    statTile(634, 78, 182, 'CURRENT STREAK', `${s.cur}d`, `longest: ${s.longest}d`),
  ].join('\n');
  const line2 = [
    statTile(40, 182, 182, 'PUBLIC REPOS', fmt(s.repos), 'owned, non-fork'),
    statTile(238, 182, 182, 'FOLLOWERS', fmt(s.followers), 'on GitHub'),
    statTile(436, 182, 380, 'MEMBER SINCE', since, age),
  ].join('\n');
  const body = `${tiles}\n${line2}
<text x="40" y="292" class="dim" style="font-size:12px"><tspan class="gr">$</tspan> auto-updated daily via GitHub Actions</text>`;
  fs.writeFileSync(path.join(ROOT, 'assets', 'stats.svg'),
    panel(W, H, `GitHub stats: ${fmt(s.yearContribs)} contributions this year, ${fmt(s.stars)} stars, ${fmt(s.prs)} PRs (${fmt(s.mergedPRs)} merged), ${fmt(s.followers)} followers, ${fmt(s.repos)} repos.`, body));
}

// Dev.to stats block (George-style tiles)
function writeDevStats(d) {
  const W = 880, H = 196;
  const joined = d.joined || '';
  const tiles = [
    statTile(40, 78, 182, 'ARTICLES', fmt(d.articles), 'published'),
    statTile(238, 78, 182, 'REACTIONS', fmt(d.reactions), 'total hearts'),
    statTile(436, 78, 182, 'COMMENTS', fmt(d.comments), 'conversations'),
    statTile(634, 78, 182, 'AVG / POST', fmt(Math.round(d.reactions / Math.max(1, d.articles))), 'reactions'),
  ].join('\n');
  const body = `${tiles}
<text x="40" y="186" class="dim" style="font-size:12px"><tspan class="gr">$</tspan> dev.to/${esc(DEVTO_USER_LABEL)} · writing since ${esc(joined)}</text>`;
  fs.writeFileSync(path.join(ROOT, 'assets', 'devstats.svg'),
    panelCmd('$ dev stats --live', W, H,
      `Dev.to stats: ${fmt(d.articles)} articles, ${fmt(d.reactions)} reactions, ${fmt(d.comments)} comments.`, body));
}
const DEVTO_USER_LABEL = process.env.DEVTO_USER || 'sarvar_04';

// variant of panel() with a custom command label
function panelCmd(cmd, w, h, title, bodyLines) {
  return panel(w, h, title, bodyLines).replace('$ gh stats --live', esc(cmd));
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

// shared console panel chrome with an animated scanline (A)
function consolePanel(file, W, H, cmd, right, inner, descText, title) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title><desc id="d">${esc(descText)}</desc>
<style>
${FF}
text{font-family:'JBM',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace}
.cy{fill:#00d9ff}.fg{fill:#c9d1d9}.dim{fill:#8b949e}.gr{fill:#3fb950}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes scan{0%{transform:translateY(0)}100%{transform:translateY(${H - 50}px)}}
.dot{animation:pulse 2.4s ease-in-out infinite}
.scan{animation:scan 7s linear infinite}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<defs>
<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#00d9ff" stroke-opacity=".05"/></pattern>
<filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter>
<linearGradient id="scanfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00d9ff" stop-opacity="0"/><stop offset="1" stop-color="#00d9ff" stop-opacity=".35"/></linearGradient>
<clipPath id="clip${title.replace(/\W/g,'')}"><rect x="18" y="40" width="${W - 36}" height="${H - 48}"/></clipPath>
</defs>
<rect x="16" y="8" width="${W - 32}" height="${H - 16}" rx="4" fill="#03040a" stroke="#00d9ff" stroke-opacity=".4"/>
<rect x="16" y="8" width="${W - 32}" height="${H - 16}" fill="url(#grid)"/>
<g clip-path="url(#clip${title.replace(/\W/g,'')})">
<rect class="scan" x="18" y="40" width="${W - 36}" height="26" fill="url(#scanfade)" opacity=".4"/>
</g>
<rect x="16" y="8" width="${W - 32}" height="30" fill="#00d9ff" fill-opacity=".08"/>
<line x1="16" y1="38" x2="${W - 16}" y2="38" stroke="#00d9ff" stroke-opacity=".4"/>
<text x="32" y="28" class="cy" letter-spacing="2" style="font-size:13px">${esc(cmd)}</text>
${right ? `<text x="${W - 34}" y="28" text-anchor="end" class="dim" style="font-size:12px">${esc(right)}</text>` : ''}
<circle class="dot" cx="${right ? W - 170 : W - 34}" cy="23" r="3.5" fill="#3fb950"/>
<circle class="dot" cx="${right ? W - 170 : W - 34}" cy="23" r="3.5" fill="#3fb950" filter="url(#g)"/>
${inner}
</svg>\n`;
  fs.writeFileSync(path.join(ROOT, 'assets', file), svg);
}

// ---- C) language spectrum ----
function writeSpectrum(langs) {
  const W = 880, H = 150, x0 = 40, barW = W - 80, y = 78;
  let seg = '', legend = '', cx = x0;
  const colors = ['#00d9ff', '#3fb950', '#ff2bd6', '#f0b429', '#9d6bff', '#2bb0ff'];
  langs.forEach((l, i) => {
    const w = Math.max(2, l.pct * barW);
    seg += `<rect x="${cx.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="16" fill="${colors[i % colors.length]}" opacity=".9"/>`;
    seg += `<rect x="${cx.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="3" fill="#f0fbff" opacity=".5"/>`;
    cx += w + 2;
    const lx = x0 + (i % 3) * 280, ly = 116 + Math.floor(i / 3) * 20;
    legend += `<circle cx="${lx}" cy="${ly - 4}" r="4" fill="${colors[i % colors.length]}"/>`;
    legend += `<text x="${lx + 12}" y="${ly}" class="fg" style="font-size:12.5px">${esc(l.name)} <tspan class="dim">${(l.pct * 100).toFixed(1)}%</tspan></text>`;
  });
  const inner = `${seg}${legend}`;
  consolePanel('spectrum.svg', W, H, '$ spectralyze --languages',
    `${langs.length} detected`, inner,
    'Language spectrum: ' + langs.map(l => `${l.name} ${(l.pct*100).toFixed(1)}%`).join(', '),
    'Language spectrum');
}

// ---- D) now-building ticker ----
function writeTicker(repo, meta) {
  const W = 880, H = 70;
  const name = repo ? esc(repo.name) : '—';
  const desc = repo && repo.description ? esc(repo.description.slice(0, 60)) : '';
  const when = repo ? new Date(repo.pushedAt).toISOString().slice(0, 10) : '';
  const inner = `
<circle class="dot" cx="42" cy="40" r="5" fill="#3fb950"/>
<circle class="dot" cx="42" cy="40" r="5" fill="#3fb950" filter="url(#g)"/>
<text x="58" y="45" class="gr" style="font-size:14px">&gt;</text>
<text x="78" y="45" class="fg" font-weight="700" style="font-size:14px">currently shipping: <tspan class="cy">${name}</tspan></text>
<text x="${W - 34}" y="45" text-anchor="end" class="dim" style="font-size:12px">pushed ${esc(when)}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">Now building</title><desc id="d">Currently shipping ${name}${desc ? ' — ' + desc : ''}, pushed ${esc(when)}.</desc>
<style>
${FF}
text{font-family:'JBM',ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace}
.cy{fill:#00d9ff}.fg{fill:#c9d1d9}.dim{fill:#8b949e}.gr{fill:#3fb950}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.dot{animation:pulse 1.8s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
<defs><filter id="g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter></defs>
<rect x="16" y="8" width="${W - 32}" height="${H - 16}" rx="4" fill="#03040a" stroke="#00d9ff" stroke-opacity=".4"/>
<rect x="16" y="8" width="${W - 32}" height="${H - 16}" rx="4" fill="#00d9ff" fill-opacity=".04"/>
${inner}
</svg>\n`;
  fs.writeFileSync(path.join(ROOT, 'assets', 'ticker.svg'), svg);
}

// ---- E) open-source radar ----
function writeRadar(external, meta) {
  const W = 880, H = 230, cx = 150, cy = 120, R = 82;
  let rings = '';
  for (let i = 1; i <= 3; i++) rings += `<circle cx="${cx}" cy="${cy}" r="${(R / 3) * i}" fill="none" stroke="#00d9ff" stroke-opacity=".18"/>`;
  rings += `<line x1="${cx - R}" y1="${cy}" x2="${cx + R}" y2="${cy}" stroke="#00d9ff" stroke-opacity=".18"/>`;
  rings += `<line x1="${cx}" y1="${cy - R}" x2="${cx}" y2="${cy + R}" stroke="#00d9ff" stroke-opacity=".18"/>`;
  // sweeping wedge
  const sweep = `<g style="transform-origin:${cx}px ${cy}px"><path d="M${cx} ${cy} L${cx + R} ${cy} A${R} ${R} 0 0 0 ${cx + R * Math.cos(-0.5)} ${cy + R * Math.sin(-0.5)} Z" fill="url(#sweepgrad)" opacity=".5"><animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="4s" repeatCount="indefinite"/></path></g>`;
  // blips
  const maxc = Math.max(1, ...external.map(e => e.count));
  let blips = '';
  external.forEach((e, i) => {
    const ang = (i / Math.max(1, external.length)) * Math.PI * 2 - Math.PI / 2;
    const rad = 24 + (e.count / maxc) * (R - 28);
    const bx = cx + Math.cos(ang) * rad, by = cy + Math.sin(ang) * rad;
    blips += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="3.4" fill="#3fb950"><animate attributeName="opacity" values="1;.3;1" dur="${(2 + i * 0.2).toFixed(1)}s" repeatCount="indefinite"/></circle>`;
  });
  // list
  let list = '';
  external.slice(0, 6).forEach((e, i) => {
    list += `<text x="300" y="${74 + i * 22}" class="fg" style="font-size:12.5px">${esc(e.repo.slice(0, 46))} <tspan class="gr">×${e.count}</tspan></text>`;
  });
  if (!external.length) list = `<text x="300" y="110" class="dim" style="font-size:13px">No external PRs in this window yet.</text>`;
  const inner = `
<defs><radialGradient id="sweepgrad"><stop offset="0" stop-color="#00d9ff" stop-opacity=".6"/><stop offset="1" stop-color="#00d9ff" stop-opacity="0"/></radialGradient></defs>
${rings}${sweep}${blips}
<text x="300" y="52" class="cy" style="font-size:12px">external pull requests · ${external.length} repos</text>
${list}`;
  consolePanel('radar.svg', W, H, '$ scan --open-source',
    `${meta.reviews} reviews`, inner,
    'Open-source radar: pull requests opened in other maintainers\' repositories.',
    'Open source radar');
}

// ---- B) signal oscilloscope (Dev.to reactions per post) ----
function writeSignal(arts) {
  const W = 880, H = 180, x0 = 44, x1 = W - 40, midY = 108;
  const series = arts.map(a => a.public_reactions_count).reverse();
  const max = Math.max(1, ...series);
  const n = series.length;
  const stepX = (x1 - x0) / Math.max(1, n - 1);
  let pts = series.map((v, i) => `${(x0 + i * stepX).toFixed(1)},${(midY - (v / max) * 68).toFixed(1)}`).join(' ');
  // peak
  let peakI = 0; series.forEach((v, i) => { if (v > series[peakI]) peakI = i; });
  const peak = arts.slice().reverse()[peakI];
  const px = x0 + peakI * stepX, py = midY - (series[peakI] / max) * 68;
  const inner = `
<line x1="${x0}" y1="${midY}" x2="${x1}" y2="${midY}" stroke="#00d9ff" stroke-opacity=".2"/>
<polyline points="${pts}" fill="none" stroke="#00d9ff" stroke-width="2" stroke-linejoin="round" filter="url(#g)"/>
<polyline points="${pts}" fill="none" stroke="#5fe4ff" stroke-width="1.4" stroke-linejoin="round"/>
${series.map((v, i) => `<circle cx="${(x0 + i * stepX).toFixed(1)}" cy="${(midY - (v / max) * 68).toFixed(1)}" r="2.2" fill="#00d9ff"/>`).join('')}
<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5" fill="none" stroke="#3fb950" stroke-width="1.6"><animate attributeName="r" values="5;9;5" dur="2.2s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;.3;1" dur="2.2s" repeatCount="indefinite"/></circle>
<text x="${x0}" y="150" class="dim" style="font-size:12px"><tspan class="gr">$</tspan> peak: <tspan class="cy">"${esc((peak.title || '').slice(0, 42))}"</tspan> — ${series[peakI]} reactions</text>`;
  consolePanel('signal.svg', W, H, '$ scope --writing-engagement',
    `${n} posts`, inner,
    'Signal: reactions per Dev.to post, newest right. Peak ' + series[peakI] + ' reactions.',
    'Writing signal');
}

main().catch(e => { console.error(e); process.exit(1); });
