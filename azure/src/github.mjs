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

/**
 * Read and parse a JSON file from the repo. A file that isn't there yet is not
 * an error — `fallback` is returned — so the first next-meeting mail works on a
 * repo that has never had one.
 */
export async function loadJson(path, fallback = undefined) {
  const gh = client();
  const { owner, repo: r, branch } = repo();
  try {
    const res = await gh.repos.getContent({ owner, repo: r, path, ref: branch });
    return JSON.parse(Buffer.from(res.data.content, 'base64').toString('utf8'));
  } catch (e) {
    if (e.status === 404 && fallback !== undefined) return fallback;
    throw e;
  }
}

export async function loadBooksJson() {
  return loadJson('src/data/books.json');
}

/** Is this path already in the repo? Used to leave an existing cover alone. */
export async function fileExists(path) {
  const gh = client();
  const { owner, repo: r, branch } = repo();
  try {
    await gh.repos.getContent({ owner, repo: r, path, ref: branch });
    return true;
  } catch (e) {
    if (e.status === 404) return false;
    throw e;
  }
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
