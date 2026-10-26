const workflows = 'https://api.github.com/repos/Mona-kecil/vibe-idx/actions/workflows';

export default {
  fetch() {
    return new Response(null, { status: 404 });
  },
  async scheduled(controller, env) {
    const headers = {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'vibe-idx-dispatch',
    };
    const workflow = controller.cron === '17 10 * * *' ? 'ingest.yml' : 'brokers.yml';
    if (workflow === 'brokers.yml') {
      const response = await fetch(`${workflows}/brokers.yml/runs?per_page=10`, { headers });
      if (!response.ok) throw new Error(`GitHub workflow runs HTTP ${response.status}`);
      const { workflow_runs } = await response.json();
      if (workflow_runs.some((run) => ['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(run.status))) return;
    }
    const response = await fetch(`${workflows}/${workflow}/dispatches`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'master' }),
    });
    if (!response.ok) throw new Error(`GitHub dispatch ${workflow} HTTP ${response.status}`);
  },
};
