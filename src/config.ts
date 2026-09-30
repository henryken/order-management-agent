import * as dotenv from 'dotenv';

// Load .env before reading any values, so every entry point (worker, client,
// MCP server) sees the same configuration.
dotenv.config();

function env(name: string, fallback: string): string {
    return process.env[name] || fallback;
}

export const config = {
    temporalAddress: env('TEMPORAL_ADDRESS', 'localhost:7233'),
    temporalNamespace: env('TEMPORAL_NAMESPACE', 'default'),
};

export const temporalConnectionOptions = {address: config.temporalAddress};
