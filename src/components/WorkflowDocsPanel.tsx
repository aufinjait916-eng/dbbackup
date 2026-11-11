import React, { useState } from 'react';
import { Copy, Check, GitBranch, Package, HardDrive, Terminal } from 'lucide-react';

export const WorkflowDocsPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'pages' | 'docker' | 'truenas' | 'env'>('pages');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const pagesWorkflow = `name: Deploy to GitHub Pages

on:
  push:
    branches:
      - main
      - master
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: 'pages'
  cancel-in-progress: true

jobs:
  build:
    name: Build Web Application
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build frontend application
        run: npm run build

      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: './dist'

  deploy:
    name: Deploy to GitHub Pages
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4`;

  const dockerWorkflow = `name: Build & Publish Docker Container

on:
  push:
    branches:
      - main
      - master
    tags:
      - 'v*'
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: \${{ github.repository }}

jobs:
  docker:
    name: Build & Push Docker Image
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: \${{ env.REGISTRY }}
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: \${{ env.REGISTRY }}/\${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest,enable=\${{ github.ref == 'refs/heads/main' || github.ref == 'refs/heads/master' }}
            type=ref,event=tag

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max`;

  const dockerCompose = `services:
  truenas-postgres-backup:
    image: ghcr.io/\${GITHUB_REPOSITORY_OWNER}/truenas-postgres-backup:latest
    container_name: truenas-postgres-backup
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - POSTGRES_HOST=192.168.1.100
      - POSTGRES_PORT=5432
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=your_secure_password
      - POSTGRES_DATABASE=postgres
      - POSTGRES_SSL=false
      - NODE_ENV=production`;

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              GitHub Actions Deployment & Workflows
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Ready-to-use workflows in <code className="font-mono text-emerald-600 dark:text-emerald-400">.github/workflows/</code> to publish this webapp to GitHub Pages or GitHub Container Registry for TrueNAS SCALE.
            </p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium">
          <button
            onClick={() => setActiveTab('pages')}
            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
              activeTab === 'pages'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>GitHub Pages (.github/workflows/deploy.yml)</span>
          </button>
          <button
            onClick={() => setActiveTab('docker')}
            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
              activeTab === 'docker'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>GHCR Docker Publish (docker-publish.yml)</span>
          </button>
          <button
            onClick={() => setActiveTab('truenas')}
            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
              activeTab === 'truenas'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>TrueNAS SCALE App Setup</span>
          </button>
          <button
            onClick={() => setActiveTab('env')}
            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
              activeTab === 'env'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Environment Variables Spec</span>
          </button>
        </div>

        {/* Tab 1: Pages */}
        {activeTab === 'pages' && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <span>Path: <strong className="font-mono text-slate-900 dark:text-slate-200">.github/workflows/deploy.yml</strong></span>
              <button
                onClick={() => copyToClipboard(pagesWorkflow, 'pages')}
                className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-colors"
              >
                {copiedKey === 'pages' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'pages' ? 'Copied' : 'Copy Workflow YAML'}</span>
              </button>
            </div>
            <pre className="p-4 rounded-lg bg-slate-950 text-slate-200 font-mono text-xs overflow-x-auto leading-relaxed max-h-96">
              {pagesWorkflow}
            </pre>
            <div className="p-3.5 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-xs text-slate-700 dark:text-slate-300">
              <strong>How to enable GitHub Pages in your repository:</strong>
              <ol className="list-decimal ml-4 mt-1.5 space-y-1">
                <li>Push this repository to GitHub (<code className="font-mono">git push origin main</code>).</li>
                <li>Go to <strong>Settings → Pages</strong> in your GitHub repository.</li>
                <li>Under <strong>Build and deployment → Source</strong>, select <strong>GitHub Actions</strong>.</li>
                <li>The workflow will trigger automatically on push and publish your site!</li>
              </ol>
            </div>
          </div>
        )}

        {/* Tab 2: Docker publish */}
        {activeTab === 'docker' && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
              <span>Path: <strong className="font-mono text-slate-900 dark:text-slate-200">.github/workflows/docker-publish.yml</strong></span>
              <button
                onClick={() => copyToClipboard(dockerWorkflow, 'docker')}
                className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-colors"
              >
                {copiedKey === 'docker' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'docker' ? 'Copied' : 'Copy Workflow YAML'}</span>
              </button>
            </div>
            <pre className="p-4 rounded-lg bg-slate-950 text-slate-200 font-mono text-xs overflow-x-auto leading-relaxed max-h-96">
              {dockerWorkflow}
            </pre>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              This workflow automatically builds multi-arch container images (<code className="font-mono">amd64</code> &amp; <code className="font-mono">arm64</code>) and pushes them to <code className="font-mono">ghcr.io/&lt;user&gt;/&lt;repo&gt;:latest</code>.
            </p>
          </div>
        )}

        {/* Tab 3: TrueNAS SCALE App Setup */}
        {activeTab === 'truenas' && (
          <div className="mt-4 space-y-4 text-xs text-slate-700 dark:text-slate-300">
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
              <h4 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                Deploying onto TrueNAS SCALE (Apps → Custom App)
              </h4>
              <p>
                In TrueNAS SCALE web dashboard:
              </p>
              <ol className="list-decimal ml-4 space-y-1.5">
                <li>Navigate to <strong>Apps</strong> → click <strong>Discover Apps</strong> → <strong>Custom App</strong> (or Launch Docker Image).</li>
                <li>Application Name: <code className="font-mono bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded">truenas-postgres-backup</code></li>
                <li>Image repository: <code className="font-mono bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded">ghcr.io/your-github-username/truenas-postgres-backup</code></li>
                <li>Image Tag: <code className="font-mono bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded">latest</code></li>
                <li>Port Forwarding: Web Port <code className="font-mono bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded">3000</code> to Container Port <code className="font-mono bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded">3000</code></li>
                <li>Under <strong>Environment Variables</strong>, add your PostgreSQL server credentials (see Environment Variables Spec tab).</li>
                <li>Click <strong>Save</strong> and wait for TrueNAS to start the container!</li>
              </ol>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-semibold text-slate-900 dark:text-slate-100">docker-compose.yml for TrueNAS SCALE:</span>
                <button
                  onClick={() => copyToClipboard(dockerCompose, 'compose')}
                  className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center gap-1.5 transition-colors"
                >
                  {copiedKey === 'compose' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'compose' ? 'Copied' : 'Copy Docker Compose'}</span>
                </button>
              </div>
              <pre className="p-4 rounded-lg bg-slate-950 text-slate-200 font-mono text-xs overflow-x-auto leading-relaxed">
                {dockerCompose}
              </pre>
            </div>
          </div>
        )}

        {/* Tab 4: Environment Variables Spec */}
        {activeTab === 'env' && (
          <div className="mt-4 space-y-3">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase text-[11px]">
                  <th className="py-2.5 px-3">Environment Variable</th>
                  <th className="py-2.5 px-3">Description</th>
                  <th className="py-2.5 px-3">Default</th>
                  <th className="py-2.5 px-3">Example</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                <tr>
                  <td className="py-2.5 px-3 font-mono font-medium text-emerald-600 dark:text-emerald-400">POSTGRES_HOST</td>
                  <td className="py-2.5 px-3">IP address or domain of TrueNAS / Postgres server</td>
                  <td className="py-2.5 px-3 font-mono">localhost</td>
                  <td className="py-2.5 px-3 font-mono">192.168.1.100</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-mono font-medium text-emerald-600 dark:text-emerald-400">POSTGRES_PORT</td>
                  <td className="py-2.5 px-3">PostgreSQL port</td>
                  <td className="py-2.5 px-3 font-mono">5432</td>
                  <td className="py-2.5 px-3 font-mono">5432</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-mono font-medium text-emerald-600 dark:text-emerald-400">POSTGRES_USER</td>
                  <td className="py-2.5 px-3">Username with backup/read privileges</td>
                  <td className="py-2.5 px-3 font-mono">postgres</td>
                  <td className="py-2.5 px-3 font-mono">truenas_backup</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-mono font-medium text-emerald-600 dark:text-emerald-400">POSTGRES_PASSWORD</td>
                  <td className="py-2.5 px-3">Password for the user</td>
                  <td className="py-2.5 px-3 font-mono">None</td>
                  <td className="py-2.5 px-3 font-mono">SecureVaultPass123!</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-mono font-medium text-emerald-600 dark:text-emerald-400">POSTGRES_DATABASE</td>
                  <td className="py-2.5 px-3">Initial database to query metadata</td>
                  <td className="py-2.5 px-3 font-mono">postgres</td>
                  <td className="py-2.5 px-3 font-mono">postgres</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-mono font-medium text-emerald-600 dark:text-emerald-400">POSTGRES_SSL</td>
                  <td className="py-2.5 px-3">Enable SSL connection mode</td>
                  <td className="py-2.5 px-3 font-mono">false</td>
                  <td className="py-2.5 px-3 font-mono">true / require</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
