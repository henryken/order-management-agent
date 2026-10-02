import {createRequire} from 'node:module';
import * as dotenv from 'dotenv';
import {Worker} from '@temporalio/worker';
import {GoogleAdkPlugin} from '@temporalio/google-adk-agents';
import webpack from 'webpack';
import {OpenAiLlm} from './openai-llm.js';

// Load environment variables (OpenAI endpoint) before the worker starts
// executing model Activities that need them.
dotenv.config();

const require = createRequire(import.meta.url);

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

async function runWorker() {
    const worker = await Worker.create({
        workflowsPath: require.resolve('./workflow'),
        taskQueue: 'order-agent-queue',
        plugins: [
            // Injects the TemporalModel activities and bundler configs
          new GoogleAdkPlugin({
            modelProvider: () => new OpenAiLlm({
                    model: requireEnv('OPENAI_MODEL'),
                    baseURL: requireEnv('OPENAI_BASE_URL'),
                    apiKey: requireEnv('OPENAI_API_KEY'),
                }),
            }),
        ],
        bundlerOptions: {
            webpackConfigHook: (config) => {
                config.plugins ??= [];
                // @google/adk's barrel re-exports FileArtifactService (used only for
                // file:// artifact URIs, which this Workflow never touches), and it
                // needs fileURLToPath/pathToFileURL. The Workflow sandbox's `url` shim
                // only exposes URL/URLSearchParams (see @temporalio/worker's
                // module-overrides), so the real module can't bundle. Since it's an
                // eager `export ... from` re-export, IgnorePlugin isn't enough (it
                // throws "Cannot find module" as soon as the barrel loads) — redirect
                // it to an inline stub that satisfies the re-export instead.
                const stub =
                    'data:text/javascript;base64,' +
                    Buffer.from('export class FileArtifactService {}\n').toString('base64');
                config.plugins.push(
                    new webpack.NormalModuleReplacementPlugin(/(^|[/\\])file_artifact_service\.js$/, stub)
                );
                return config;
            },
        },
    });

    // Let the Worker finish in-flight Workflow/Activity tasks before exiting
    // instead of being killed mid-task.
    const shutdown = () => worker.shutdown();
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    console.log('👷 Starting Temporal ADK Worker...');
    await worker.run();
}

runWorker().catch(console.error);
