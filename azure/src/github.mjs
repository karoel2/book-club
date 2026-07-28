// Read books.json from the repo and commit changes back via the GitHub Git Data
// API — all files in a SINGLE commit so one push triggers one Pages build.
// Requires a fine-grained PAT (contents: read & write on this repo only).
import { Octokit } from '@octokit/rest';

function repo() {
  const [owner, name] = (process.env.GITHUB_REPO || '').split('/');
  if (!owner || !name) throw new Error('GITHUB_REPO must be "owner/name"');
  return { owner, repo: name, branch: process.env.GITHUB_BRANCH || 'main' };
}

function client() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');
  return new Octokit({ auth: token });
}

export async function loadBooksJson() {
  const gh = client();
  const { owner, repo: r, branch } = repo();
  const res = await gh.repos.getContent({ owner, repo: r, path: 'src/data/books.json', ref: branch });
  const content = Buffer.from(res.data.content, 'base64').toString('utf8');
  return JSON.parse(content);
}

/**
 * Commit a set of files in one commit.
 * @param {Array<{path:string, content?:string, buf?:Buffer}>} files
 *        text files pass `content`; binary (covers) pass `buf`.
 */
export async function commitChanges(files, message) {
  const gh = client();
  const { owner, repo: r, branch } = repo();
  const ref = `heads/${branch}`;

  const { data: refData } = await gh.git.getRef({ owner, repo: r, ref });
  const parent = refData.object.sha;
  const { data: parentCommit } = await gh.git.getCommit({ owner, repo: r, commit_sha: parent });

  const tree = [];
  for (const f of files) {
    const blob = f.buf
      ? await gh.git.createBlob({ owner, repo: r, content: f.buf.toString('base64'), encoding: 'base64' })
      : await gh.git.createBlob({ owner, repo: r, content: f.content, encoding: 'utf-8' });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.data.sha });
  }

  const { data: newTree } = await gh.git.createTree({ owner, repo: r, base_tree: parentCommit.tree.sha, tree });
  const { data: commit } = await gh.git.createCommit({ owner, repo: r, message, tree: newTree.sha, parents: [parent] });
  await gh.git.updateRef({ owner, repo: r, ref, sha: commit.sha });
  return commit.sha;
}
