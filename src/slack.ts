/**
 * Slack integration module for slack-ticket.
 *
 * Handles:
 * - Slack URL parsing (channel ID + timestamp extraction)
 * - Thread fetching via conversations.replies (for `create`)
 * - Single message fetching via conversations.history (for `update`)
 * - Image downloading to OS temp directory
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CLIError } from './error.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SlackFile {
    id: string;
    name: string;
    mimetype: string;
    url_private: string;
}

export interface SlackMessage {
    ts: string;
    text: string;
    files?: SlackFile[];
}

export interface ParsedSlackUrl {
    channelId: string;
    timestamp: string;
    /** The original URL, used as the thread link in issue footer */
    originalUrl: string;
}

export interface DownloadedImage {
    filePath: string;
    filename: string;
}

export interface FetchThreadResult {
    messages: SlackMessage[];
    imageInfo: {
        downloaded: DownloadedImage | null;
        totalCount: number;
    };
}

// ─── URL Parsing ───────────────────────────────────────────────────────────────

/**
 * Parses a Slack thread URL into its channel ID and timestamp.
 *
 * Supported format:
 *   https://workspace.slack.com/archives/C12345678/p1739828340001200
 *
 * Timestamp conversion:
 *   p1739828340001200 → strip 'p' → insert '.' after 10th digit → 1739828340.001200
 */
export function parseSlackUrl(url: string): ParsedSlackUrl {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throwUrlError(url);
    }

    // Must be a slack.com domain
    if (!parsed!.hostname.endsWith('slack.com')) {
        throwUrlError(url);
    }

    // Path format: /archives/{channelId}/{pTimestamp}
    const match = parsed!.pathname.match(/^\/archives\/([A-Z0-9]+)\/(p\d+)$/i);
    if (!match) {
        throwUrlError(url);
    }

    const [, channelId, pTimestamp] = match!;

    // Convert pTimestamp → slack ts
    // e.g. p1739828340001200 → strip 'p' → 1739828340001200 → 1739828340.001200
    const digits = pTimestamp.slice(1); // remove 'p'
    if (digits.length < 11) {
        throwUrlError(url);
    }
    const timestamp = `${digits.slice(0, 10)}.${digits.slice(10)}`;

    return { channelId, timestamp, originalUrl: url };
}

function throwUrlError(url: string): never {
    const err = new Error(
        `Invalid Slack URL: ${url}\nExpected format: https://workspace.slack.com/archives/<channel-id>/p<timestamp>`
    );
    (err as any).exitCode = 1;
    throw err;
}

// ─── HTTP helper ───────────────────────────────────────────────────────────────

/**
 * Internal helper for Slack GET requests.
 */
export async function slackGet(
    method: string,
    params: Record<string, string | number>,
    token: string
): Promise<any> {
    const query = new URLSearchParams(
        Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))
    ).toString();
    const url = `https://slack.com/api/${method}?${query}`;

    return new Promise((resolve, reject) => {
        const req = https.request(
            url,
            {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        reject(new Error(`Failed to parse Slack API response for ${method}`));
                    }
                });
            }
        );
        req.on('error', reject);
        req.end();
    });
}


// ─── Error helpers ─────────────────────────────────────────────────────────────

/**
 * Handles Slack API errors according to PRD §12.4.
 * Throws a CLIError with exit code 2.
 */
function handleSlackError(response: any, contextInfo: string): void {
    if (response.ok) return;

    const error = response.error as string;
    const detail = response.detail as string | undefined;

    if (error === 'not_in_channel' || error === 'channel_not_found') {
        const channelName = detail ?? 'the channel';
        throw new CLIError(`Bot not in channel. Invite the bot to ${channelName} first, then retry.`, 2);
    }

    if (error === 'ratelimited') {
        const retryAfter = response.headers?.['retry-after'] ?? response.response_metadata?.retry_after ?? 'a few';
        throw new CLIError(`Slack rate limited. Retry after ${retryAfter} seconds.`, 2);
    }

    if (error === 'invalid_auth' || error === 'token_revoked' || error === 'not_authed') {
        throw new CLIError(`Slack token validation failed (${error}). Check your bot token.`, 2);
    }

    if (error === 'message_not_found' || error === 'thread_not_found') {
        throw new CLIError(`Slack ${contextInfo} not found. Verify the URL is correct.`, 2);
    }

    throw new CLIError(`Slack API Error during ${contextInfo}: ${error || 'Unknown error'}`, 2);
}

// ─── Thread Fetching (for `create`) ───────────────────────────────────────────

/**
 * Fetches thread messages via conversations.replies.
 * Always includes the parent message (inclusive: true).
 * Returns up to `depth` messages in chronological order.
 * Also handles image collection if imageHandling is enabled.
 */
export async function fetchThread(
    parsed: ParsedSlackUrl,
    depth: number,
    token: string,
    imageHandling: boolean
): Promise<FetchThreadResult> {
    const response = await slackGet(
        'conversations.replies',
        {
            channel: parsed.channelId,
            ts: parsed.timestamp,
            limit: depth,
            inclusive: 'true',
        },
        token
    );

    handleSlackError(response, 'thread fetch');

    const messages: SlackMessage[] = (response.messages ?? []).slice(0, depth);

    let downloaded: DownloadedImage | null = null;
    let totalCount = 0;

    if (imageHandling) {
        // Collect all images across all fetched messages
        const images: SlackFile[] = [];
        for (const msg of messages) {
            if (msg.files) {
                images.push(...msg.files.filter((f) => f.mimetype?.startsWith('image/')));
            }
        }
        totalCount = images.length;

        if (images.length > 0) {
            downloaded = await downloadImage(images[0], token);
        }
    }

    return { messages, imageInfo: { downloaded, totalCount } };
}

// ─── Single Message Fetching (for `update`) ───────────────────────────────────

/**
 * Fetches a specific Slack message by URL using conversations.history.
 * Sets both oldest and latest to the same timestamp with inclusive: true
 * to reliably fetch exactly that one message. (PRD §10.4)
 */
export async function fetchSingleMessage(
    parsed: ParsedSlackUrl,
    token: string
): Promise<SlackMessage> {
    const response = await slackGet(
        'conversations.history',
        {
            channel: parsed.channelId,
            oldest: parsed.timestamp,
            latest: parsed.timestamp,
            inclusive: 'true',
            limit: 1,
        },
        token
    );

    handleSlackError(response, 'message fetch');

    const messages: SlackMessage[] = response.messages ?? [];
    if (messages.length === 0) {
        const err = new Error(`Slack message not found. Verify the URL is correct.`);
        (err as any).exitCode = 2;
        throw err;
    }

    return messages[0];
}

// ─── Image Downloading ─────────────────────────────────────────────────────────

/**
 * Downloads a Slack image to OS temp directory using the bot token for auth.
 * Returns the local file path, or null on failure (caller should warn and continue).
 */
async function downloadImage(file: SlackFile, token: string): Promise<DownloadedImage | null> {
    const tempDir = os.tmpdir();
    const filename = `slack-ticket-${file.id}-${file.name}`;
    const filePath = path.join(tempDir, filename);

    return new Promise((resolve) => {
        const req = https.request(
            file.url_private,
            {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` },
            },
            (res) => {
                // Follow redirect if needed
                if (res.statusCode === 302 || res.statusCode === 301) {
                    const location = res.headers.location;
                    if (location) {
                        // Re-download from redirect location (without auth header)
                        const redir = https.request(location, { method: 'GET' }, (rRes) => {
                            const out = fs.createWriteStream(filePath);
                            rRes.pipe(out);
                            out.on('finish', () => resolve({ filePath, filename }));
                            out.on('error', () => resolve(null));
                        });
                        redir.on('error', () => resolve(null));
                        redir.end();
                        return;
                    }
                }

                if (res.statusCode !== 200) {
                    resolve(null);
                    return;
                }

                const out = fs.createWriteStream(filePath);
                res.pipe(out);
                out.on('finish', () => resolve({ filePath, filename }));
                out.on('error', () => resolve(null));
            }
        );
        req.on('error', () => resolve(null));
        req.end();
    });
}

// ─── Text Extraction ───────────────────────────────────────────────────────────

/**
 * Combines text from multiple messages into a single string for the AI prompt.
 * Messages are joined by a blank line.
 */
export function combineMessageText(messages: SlackMessage[]): string {
    return messages
        .map((m) => m.text?.trim())
        .filter(Boolean)
        .join('\n\n');
}
