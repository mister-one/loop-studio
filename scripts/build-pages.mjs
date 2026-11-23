import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';

const repository = process.env.GITHUB_REPOSITORY;
if (repository && !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
  throw new Error('Use owner/repository for GITHUB_REPOSITORY.');
}
const server = new URL(process.env.GITHUB_SERVER_URL || 'https://github.com');
const repoUrl = repository ? new URL(repository, server.origin + '/').href : '';
const source = new URL('../site/', import.meta.url);
const output = new URL('../dist/', import.meta.url);
await mkdir(output, { recursive: true });
await cp(new URL('site.css', source), new URL('site.css', output));

let html = await readFile(new URL('index.html', source), 'utf8');
if (repoUrl) {
  const repo = repoUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  html = html
    .replace('href="#install">Get the code', `href="${repo}">View on GitHub`)
    .replace(/<!-- REPOSITORY_LINKS -->.*?<!-- \/REPOSITORY_LINKS -->/,
      `<a class="source" href="${repo}">View source</a><a class="source" href="${repo}/archive/HEAD.zip">Download ZIP</a>`);
}
await writeFile(new URL('index.html', output), html);
