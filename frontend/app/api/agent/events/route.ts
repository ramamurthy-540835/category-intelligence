import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function getBackendUrl() {
  return process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8001';
}

export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get('run_id') || '';
  if (!runId) return NextResponse.json({ run_id: runId, events: [] }, { status: 200 });
  try {
    const res = await fetch(`${getBackendUrl()}/agent/events?run_id=${encodeURIComponent(runId)}`, { cache: 'no-store' });
    const text = await res.text();
    return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return NextResponse.json({ run_id: runId, events: [], error: String(e), backend_url: getBackendUrl() }, { status: 502 });
  }
}
