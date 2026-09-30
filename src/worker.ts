import {createRequire} from 'node:module';
import * as dotenv from 'dotenv';
import {Client, Connection} from '@temporalio/client';
import {Worker} from '@temporalio/worker';
import {GoogleAdkPlugin} from '@temporalio/google-adk-agents';
import webpack from 'webpack';
import {createActivities} from './activities.js';

// Load environment variables (e.g., GEMINI_API_KEY) before the worker starts
// executing model Activities that need them.
dotenv.config();

const require = createRequire(import.meta.url);

// Must match the port src/mcp-server.ts listens on. That server is a
// separately-run long-lived process (`npm run mcp-server`), not something
// this Worker spawns — the plugin just needs its URL.
const MCP_SERVER_PORT = Number(process.env.MCP_SERVER_PORT ?? 3100);

async function runWorker() {
    const connection = await Connection.connect({address: 'localhost:7233'});
    const client = new Client({connection});

    const worker = await Worker.create({
        workflowsPath: require.resolve('./workflow'),
        taskQueue: 'order-agent-queue',
        activities: createActivities(client),
        plugins: [
            // Injects the TemporalModel activities and bundler configs, and
            // registers the orderManagement MCP toolset, consumed via
            // TemporalMCPToolset({name: 'orderManagement'}) in a Workflow.
            new GoogleAdkPlugin({
                mcpToolsets: {
                    orderManagement: () => ({
                        type: 'StreamableHTTPConnectionParams',
                        url: `http://localhost:${MCP_SERVER_PORT}/mcp`,
                    }),
                },
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
    await connection.close();
}

runWorker().catch(console.error);
