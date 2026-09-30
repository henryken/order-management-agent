// Standalone MCP server exposing the same three order-management operations
// as activities.ts (getOrderStatus / cancelOrder / approveOrder), for the
// TemporalMCPToolset path. It reuses createActivities so the
// Temporal Client logic — connecting, resolving the "order-<id>" workflow ID,
// handling WorkflowNotFoundError — isn't duplicated between the two paths.
//
// Runs over Streamable HTTP (stateless, one server/transport pair per
// request — no session or SSE resumption needed for these fire-and-forget
// tool calls) rather than stdio, so it's a long-lived process other MCP
// hosts can point a URL at instead of something the Worker spawns.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {createMcpExpressApp} from '@modelcontextprotocol/sdk/server/express.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {Client, Connection} from '@temporalio/client';
import {z} from 'zod';
import {createActivities} from './activities.js';

const PORT = Number(process.env.MCP_SERVER_PORT ?? 3100);

function jsonResult(value: unknown) {
    return {content: [{type: 'text' as const, text: JSON.stringify(value)}]};
}

async function main() {
    const connection = await Connection.connect({address: 'localhost:7233'});
    const client = new Client({connection});
    const activities = createActivities(client);

    // Stateless mode creates a fresh McpServer/transport pair per request, so
    // build one on demand rather than sharing a single instance across calls.
    function buildServer(): McpServer {
        const server = new McpServer({name: 'order-management', version: '1.0.0'});

        server.registerTool(
            'getOrderStatus',
            {
                description:
                    'Get the current status of an order, given its order ID. ' +
                    "Returns {found: true, status: <order status>} if the order exists, or {found: false} if it doesn't.",
                inputSchema: {
                    // The activity adds the "order-" workflow-ID prefix itself, so the
                    // model should only ever pass the bare order ID here.
                    orderId: z.string().describe('The bare order ID, without any prefix.'),
                },
            },
            async ({orderId}) => jsonResult(await activities.getOrderStatusActivity({orderId}))
        );

        server.registerTool(
            'cancelOrder',
            {
                description:
                    'Cancel an order, given its order ID and a reason for the cancellation. ' +
                    "Returns {found: true} if the order exists and the cancellation was signaled, or {found: false} if it doesn't.",
                inputSchema: {
                    orderId: z.string().describe('The bare order ID, without any prefix.'),
                    reason: z.string().describe('The reason the order is being cancelled.'),
                },
            },
            async ({orderId, reason}) => jsonResult(await activities.cancelOrderActivity({orderId, reason}))
        );

        server.registerTool(
            'approveOrder',
            {
                description:
                    'Approve an order for dispatch, given its order ID and the email address of the approver. ' +
                    "Returns {found: true} if the order exists and the approval was signaled, or {found: false} if it doesn't.",
                inputSchema: {
                    orderId: z.string().describe('The bare order ID, without any prefix.'),
                    approverEmail: z.string().describe('The email address of the person approving the order.'),
                },
            },
            async ({orderId, approverEmail}) =>
                jsonResult(await activities.approveDispatchActivity({orderId, approverEmail}))
        );

        return server;
    }

    const app = createMcpExpressApp();

    app.post('/mcp', async (req, res) => {
        try {
            const server = buildServer();
            // Omitting sessionIdGenerator (rather than passing it as `undefined`)
            // is equivalent at runtime and satisfies exactOptionalPropertyTypes.
            const transport = new StreamableHTTPServerTransport({});
            res.on('close', () => {
                transport.close();
                server.close();
            });
            // StreamableHTTPServerTransport's onclose/onerror accessors are typed
            // `T | undefined` while Transport declares them as plain optional `T`,
            // which only conflicts under this project's exactOptionalPropertyTypes.
            await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
            await transport.handleRequest(req, res, req.body);
        } catch (err) {
            console.error('Error handling MCP request:', err);
            if (!res.headersSent) {
                res.status(500).json({jsonrpc: '2.0', error: {code: -32603, message: 'Internal server error'}, id: null});
            }
        }
    });

    // Stateless mode has no server-initiated stream or session to resume/close.
    const methodNotAllowed = (_req: unknown, res: import('express').Response) =>
        res.status(405).json({jsonrpc: '2.0', error: {code: -32000, message: 'Method not allowed.'}, id: null});
    app.get('/mcp', methodNotAllowed);
    app.delete('/mcp', methodNotAllowed);

    const httpServer = app.listen(PORT, () => {
        console.log(`🔌 Order-management MCP server listening on http://localhost:${PORT}/mcp`);
    });

    const shutdown = async () => {
        httpServer.close();
        await connection.close();
        process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
