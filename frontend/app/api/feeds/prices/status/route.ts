import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function getBackendUrl() {
  return process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
}

export async function GET() {
  try {
    const res = await fetch(`${getBackendUrl()}/feeds/prices/status`, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ status: 'idle', active_skus: 0, latest_snapshot_rows: 0 }, { status: 200 });
    }
    const text = await res.text();
    return new NextResponse(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return NextResponse.json({ status: 'idle', active_skus: 0, latest_snapshot_rows: 0, error: String(e), backend_url: getBackendUrl() }, { status: 200 });
  }
}
