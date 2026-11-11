import React, { useState, useRef } from 'react';
import { Upload, FileCode, CheckCircle, AlertTriangle, Download, ArrowRight } from 'lucide-react';
import { parseDatabasesJson } from '../utils/backupEngine';

interface JsonInputPanelProps {
  onDatabasesLoaded: (databaseNames: string[]) => void;
  currentDatabasesCount: number;
}

const PRESET_TRUENAS_APPS = `{
  "server": "truenas-scale-core",
  "comment": "Self-hosted PostgreSQL databases on TrueNAS",
  "databases": [
    "nextcloud_db",
    "vaultwarden_db",
    "homeassistant_db",
    "immich_db",
    "gitea_db",
    "authentik_db",
    "paperless_db",
    "mastodon_db"
  ]
}`;

const PRESET_SIMPLE_ARRAY = `[
  "production_users",
  "production_orders",
  "analytics_events",
  "inventory_warehouse",
  "billing_ledger"
]`;

export const JsonInputPanel: React.FC<JsonInputPanelProps> = ({
  onDatabasesLoaded,
  currentDatabasesCount,
}) => {
  const [jsonText, setJsonText] = useState<string>(PRESET_TRUENAS_APPS);
  const [fileName, setFileName] = useState<string | null>('sample-databases.json');
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
    count?: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleProcessJson = (text: string, sourceName?: string) => {
    const { databases, error } = parseDatabasesJson(text);
    if (error) {
      setStatusMessage({
        type: 'error',
        text: error,
      });
      return false;
    }

    if (databases.length === 0) {
      setStatusMessage({
        type: 'error',
        text: 'No valid database names found in the JSON file.',
      });
      return false;
    }

    if (sourceName) {
      setFileName(sourceName);
    }

    setStatusMessage({
      type: 'success',
      text: `Successfully extracted ${databases.length} database targets`,
      count: databases.length,
    });

    onDatabasesLoaded(databases);
    return true;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setJsonText(content);
      handleProcessJson(content, file.name);
    };
    reader.readAsText(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.includes('json') || file.name.endsWith('.json'))) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setJsonText(content);
        handleProcessJson(content, file.name);
      };
      reader.readAsText(file);
    } else {
      setStatusMessage({
        type: 'error',
        text: 'Please drop a valid .json file.',
      });
    }
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: `Cannot format invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const downloadSampleTemplate = () => {
    const blob = new Blob([PRESET_TRUENAS_APPS], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample-databases.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Input Databases JSON File
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Provide a JSON file or paste the list of PostgreSQL databases to back up and download sequentially.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadSampleTemplate}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Template</span>
            </button>
          </div>
        </div>

        {/* Drag and Drop Zone */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`mt-4 border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
            dragActive
              ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20'
              : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-slate-50/50 dark:bg-slate-900/40'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="flex flex-col items-center justify-center space-y-2">
            <div className="p-3 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
              <Upload className="w-6 h-6" />
            </div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {fileName ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-mono">
                  {fileName}
                </span>
              ) : (
                'Drop your database list JSON file here'
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Supports <code className="font-mono text-slate-700 dark:text-slate-300">.json</code> with array of database names or structured object
            </p>
          </div>
        </div>

        {/* Status Message */}
        {statusMessage && (
          <div
            className={`mt-4 p-3 rounded-lg border text-xs flex items-center gap-2 ${
              statusMessage.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Preset Buttons */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">Load Preset:</span>
          <button
            onClick={() => {
              setJsonText(PRESET_TRUENAS_APPS);
              handleProcessJson(PRESET_TRUENAS_APPS, 'truenas-services.json');
            }}
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            TrueNAS Self-Hosted Apps
          </button>
          <button
            onClick={() => {
              setJsonText(PRESET_SIMPLE_ARRAY);
              handleProcessJson(PRESET_SIMPLE_ARRAY, 'simple-array.json');
            }}
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            Simple String Array
          </button>
          <button
            onClick={handleFormat}
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ml-auto"
          >
            Prettify JSON
          </button>
        </div>

        {/* Raw JSON Code Area */}
        <div className="mt-3 relative">
          <textarea
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setStatusMessage(null);
            }}
            rows={10}
            className="w-full p-4 font-mono text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 transition-all resize-y leading-relaxed"
            placeholder="Paste your JSON database list here..."
            spellCheck={false}
          />
        </div>

        {/* Load into Queue Action */}
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Currently in queue: <strong className="font-mono text-slate-700 dark:text-slate-300">{currentDatabasesCount}</strong> databases
          </div>
          <button
            onClick={() => handleProcessJson(jsonText)}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors flex items-center gap-2"
          >
            <FileCode className="w-4 h-4" />
            <span>Load Databases into Queue</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
